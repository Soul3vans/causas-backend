'use strict'

const EventEmitter = require('events')
const logger = require('./logger')

/**
 * SessionGuard
 *
 * Responsabilidad ÚNICA: vigilar y avisar. Determina el estado de salud
 * de la sesión (VALID / SUSPECT / LOST) y emite el evento correspondiente.
 *
 * NO cierra tabs, NO pausa el pool, NO reautentica, NO decide qué hacer
 * con los workers después del aviso. Esa responsabilidad completa
 * (recibir el aviso, pausar workers, recuperar sesión, devolver el
 * trabajo donde se quedó) es del "jefe de operaciones":
 * browser-session-manager.js.
 *
 * Niveles:
 *  - TRANSIENT: interno, nunca se expone como estado del guard.
 *               Fallo de red aislado -> se resuelve con 1 retry local
 *               por parte de quien detectó el fallo, sin tocar el estado.
 *  - SUSPECT:   el fallo persiste tras el retry, o es un fallo no
 *               clasificado -> dispara quickCheck() en la próxima
 *               adquisición de tab.
 *  - LOST:      señal fuerte -> single source of truth para "hay que
 *               recuperar sesión". Solo dispara el evento UNA VEZ por
 *               transición (los reportes siguientes mientras ya está
 *               en LOST se ignoran, hasta que browser-session-manager.js
 *               confirme la recuperación con markRecovered()).
 */

const STATE = Object.freeze({
  VALID: 'VALID',
  SUSPECT: 'SUSPECT',
  LOST: 'LOST'
})

const DEFAULTS = {
  quickCheckTtlMs: 30 * 1000,      // frescura de la validación liviana
  networkErrorRetries: 1           // reintentos locales antes de escalar a SUSPECT
}

/**
 * Fallo de red aislado y esperable (reset de conexión, timeout puntual,
 * cambio de red). NO implica que la sesión se haya perdido.
 * Quien detecta esto debe reintentar la operación 1 vez localmente
 * antes de reportarlo — SessionGuard lo ignora a nivel de estado.
 *
 * TODAVÍA NO SE USA en el código existente (unified-query.js,
 * puppeteer.plugin.js, etc.) — queda lista para cuando se migren
 * los `throw new Error(...)` actuales en una fase posterior.
 */
class TransientNetworkError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'TransientNetworkError'
    this.cause = options.cause
  }
}

/**
 * Señal fuerte e inequívoca de que la sesión ya no es válida
 * (navegación forzada a home/index.php, formulario ausente, gate de
 * login inesperado, reCAPTCHA no resuelto tras agotar reintentos).
 * Quien la lanza ya hizo la clasificación — SessionGuard no necesita
 * adivinar por texto.
 *
 * TODAVÍA NO SE USA en el código existente — misma nota que arriba.
 */
class SessionLostError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'SessionLostError'
    this.cause = options.cause
  }
}

class SessionGuard extends EventEmitter {
  constructor(options = {}) {
    super()
    this.state = STATE.VALID
    this.lastValidatedAt = null
    this.quickCheckTtlMs = options.quickCheckTtlMs ?? DEFAULTS.quickCheckTtlMs
    this.networkErrorRetries = options.networkErrorRetries ?? DEFAULTS.networkErrorRetries
  }

  getState() {
    return this.state
  }

  isValid() {
    return this.state === STATE.VALID
  }

  /**
   * Chequeo liviano, se llama antes de cada acquireTab().
   * NO golpea el DOM salvo que la validación anterior ya haya expirado (TTL).
   * @param {{ getPage: () => import('puppeteer').Page }} anchorTab - Tab 1
   * @returns {Promise<string>} STATE
   */
  async quickCheck(anchorTab) {
    if (this.state === STATE.LOST) {
      return this.state // ya sabemos que está caída, no hay nada que reutilizar
    }

    const freshEnough = this.lastValidatedAt &&
      (Date.now() - this.lastValidatedAt) < this.quickCheckTtlMs

    if (freshEnough) {
      return this.state
    }

    return this._lightweightValidate(anchorTab)
  }

  /**
   * Chequeo completo, se llama en cada ciclo de keep-alive (~5 min).
   * Sí valida DOM + cookies + localStorage/sessionStorage.
   * @param {{ getPage: () => import('puppeteer').Page }} anchorTab
   * @returns {Promise<string>} STATE
   */
  async fullCheck(anchorTab) {
    try {
      const page = anchorTab.getPage()
      const url = page.url()

      if (url.includes('home/index.php')) {
        return this._markLost('fullCheck: URL en home/index.php, se esperaba sesión activa')
      }

      const result = await page.evaluate(() => {
        const hasForm = document.querySelector('select#competencia') !== null
        const hasLoginGate = document.querySelector('a[onclick*="AutenticaCUnica"]') !== null &&
          !document.querySelector('select#competencia')

        return {
          hasForm,
          hasLoginGate,
          localStorageLoggedIn: localStorage.getItem('logged-in'),
          sessionStorageLoggedIn: sessionStorage.getItem('logged-in')
        }
      })

      if (!result.hasForm || result.hasLoginGate) {
        return this._markLost('fullCheck: formulario ausente o gate de login detectado en indexN.php')
      }

      if (result.localStorageLoggedIn !== 'true') {
        return this._markLost('fullCheck: localStorage logged-in no está en true')
      }

      this._markValid()
      return this.state
    } catch (error) {
      logger.warn('SessionGuard.fullCheck: error evaluando página, se marca SUSPECT', { error: error.message })
      this._markSuspect()
      return this.state
    }
  }

  /**
   * Validación liviana usada dentro de quickCheck() cuando el TTL venció.
   * Solo mira URL + selector clave, sin tocar storage.
   */
  async _lightweightValidate(anchorTab) {
    try {
      const page = anchorTab.getPage()
      const url = page.url()

      if (url.includes('home/index.php')) {
        return this._markLost('quickCheck: URL en home/index.php')
      }

      const hasForm = await page.evaluate(() => document.querySelector('select#competencia') !== null)

      if (!hasForm) {
        return this._markSuspect()
      }

      this._markValid()
      return this.state
    } catch (error) {
      logger.warn('SessionGuard.quickCheck: error en validación liviana, se marca SUSPECT', { error: error.message })
      return this._markSuspect()
    }
  }

  /**
   * Punto de entrada para que cualquier consumidor (scrapRawData, UnifiedQuery,
   * guest-strategy.js) reporte un fallo real detectado durante un job.
   * Esta es la autoridad final: no espera al próximo ciclo de chequeo.
   *
   * Prioridad de clasificación:
   *   1. Tipo explícito (TransientNetworkError / SessionLostError) - cuando
   *      el código que migremos empiece a usarlas.
   *   2. Heurística por texto - fallback temporal mientras el código
   *      existente siga lanzando Error genérico sin tipar.
   *
   * @param {Error} error - el error real capturado
   * @param {object} [context] - info opcional para logging (rol, workerId, etc.)
   */
  reportNavigationFailure(error, context = {}) {
    // 1) Clasificación explícita por tipo, si el caller ya migró a las
    //    clases tipadas. Todavía no ocurre en el código existente.
    if (error instanceof SessionLostError || error?.name === 'SessionLostError') {
      return this._markLost(`reportNavigationFailure (tipado): ${error.message}`, context)
    }

    if (error instanceof TransientNetworkError || error?.name === 'TransientNetworkError') {
      logger.debug('SessionGuard: fallo transitorio tipado, no escala estado', { message: error.message, ...context })
      return this.state
    }

    // 2) Fallback heurístico por texto (comportamiento actual, temporal)
    const message = error?.message || String(error)

    if (this._isTransientNetworkError(message)) {
      logger.debug('SessionGuard: fallo de red transitorio (heurística), no escala estado', { message, ...context })
      return this.state
    }

    if (this._isStrongLostSignal(message)) {
      return this._markLost(`reportNavigationFailure (heurística): ${message}`, context)
    }

    return this._markSuspect(context)
  }

  _isTransientNetworkError(message) {
    const patterns = [
      'ECONNRESET',
      'ERR_CONNECTION_RESET',
      'ERR_NETWORK_CHANGED',
      'net::ERR_',
      'timeout'
    ]
    return patterns.some(p => message.toLowerCase().includes(p.toLowerCase()))
  }

  _isStrongLostSignal(message) {
    const patterns = [
      'home/index.php',
      'No se pudo navegar a indexN.php',
      'reCAPTCHA no resuelto'
    ]
    return patterns.some(p => message.includes(p))
  }

  _markValid() {
    this.state = STATE.VALID
    this.lastValidatedAt = Date.now()
  }

  _markSuspect(context = {}) {
    if (this.state !== STATE.LOST) {
      this.state = STATE.SUSPECT
      logger.warn('SessionGuard: estado SUSPECT', context)
    }
    return this.state
  }

  /**
   * Marca LOST y emite 'sessionLost' UNA SOLA VEZ por transición.
   * Reportes adicionales mientras ya está en LOST se registran en log
   * pero no vuelven a emitir el evento -> browser-session-manager.js
   * no dispara recovery en paralelo por avisos duplicados de distintos
   * workers.
   */
  _markLost(reason, context = {}) {
    const wasAlreadyLost = this.state === STATE.LOST
    this.state = STATE.LOST
    this.lastValidatedAt = null

    if (wasAlreadyLost) {
      logger.debug('SessionGuard: LOST ya reportado, se ignora nuevo aviso', { reason, ...context })
      return this.state
    }

    logger.error('SessionGuard: estado LOST', { reason, ...context })
    this.emit('sessionLost', { reason, context })

    return this.state
  }

  /**
   * Llamado por browser-session-manager.js cuando el recovery completó
   * con éxito y el AnchorTab volvió a validar sesión en indexN.php.
   * Reabre la puerta para que un futuro LOST vuelva a emitir el evento.
   */
  markRecovered() {
    this._markValid()
    this.emit('sessionRecovered')
  }
}

module.exports = {
  SessionGuard,
  SESSION_STATE: STATE,
  TransientNetworkError,
  SessionLostError
}
