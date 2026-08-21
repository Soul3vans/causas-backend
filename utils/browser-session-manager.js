'use strict'

const EventEmitter = require('events')
const puppeteerExtra = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')()
StealthPlugin.enabledEvasions.delete('user-agent-override')
puppeteerExtra.use(StealthPlugin)

const logger = require('./logger')
const { buildLaunchOptions } = require('./plugins/chrome-launch-options')
const { TabWorker } = require('./tab-worker')
const { SessionGuard } = require('./session-guard')

/**
 * BrowserSessionManager — "jefe de operaciones" de los TabWorkers.
 *
 * Dueño de: Browser único, BrowserContext (sesión única), AnchorTab,
 * TabWorker[] 2..N. Escucha a SessionGuard y decide QUÉ HACER ante un
 * aviso de sesión perdida: pausar el reparto de trabajo nuevo, dejar
 * que las operaciones en curso fallen naturalmente (sin cancelar nada
 * a la fuerza), cerrar tabs 2..N, y ejecutar el bootstrap (AUTH/GUEST)
 * sobre el AnchorTab hasta recuperar sesión.
 *
 * SessionGuard SOLO vigila y avisa — nunca toca tabs directamente.
 *
 * El AnchorTab, además de IDLE/BUSY, tiene un tercer estado lógico:
 * RESTING (worker.isResting = true). Si pasa anchorRestAfterIdleMs sin
 * trabajo nuevo, vuelve a home/index.php SIN cerrar el navegador. El
 * próximo acquireTabOrCreate() que lo tome primero rehace el bootstrap
 * antes de asignarle trabajo.
 */

const POOL_STATE = Object.freeze({
  BOOTSTRAPPING: 'BOOTSTRAPPING',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  RECOVERING: 'RECOVERING'
})

const DEFAULTS = {
  concurrency: 2,
  idleCloseMs: 4 * 60 * 1000,         // 4 min — tabs 2..N
  fullCheckIntervalMs: 5 * 60 * 1000, // 5 min — coherente con keep-alive existente
  acquireRetryDelayMs: 500,
  anchorRestAfterIdleMs: 10 * 60 * 1000, // 10 min — confirmado
  bootstrapMaxRetries: 3,
  bootstrapRetryDelayMs: 30 * 1000       // 30s — confirmado
}

class BrowserSessionManager extends EventEmitter {
  /**
   * @param {object} options
   * @param {number} options.concurrency - SCRAPING_CONCURRENCY, 1:1 con Pages/Workers
   * @param {{ getMode: () => Promise<'AUTH'|'GUEST'> }} options.modeConfig
   * @param {{ bootstrap: (page: import('puppeteer').Page) => Promise<void> }} options.authStrategy
   * @param {{ bootstrap: (page: import('puppeteer').Page) => Promise<void> }} options.guestStrategy
   */
  constructor(options = {}) {
	super()
    this.concurrency = options.concurrency ?? DEFAULTS.concurrency
    this.modeConfig = options.modeConfig
    this.authStrategy = options.authStrategy
    this.guestStrategy = options.guestStrategy
    this.idleCloseMs = options.idleCloseMs ?? DEFAULTS.idleCloseMs
    this.fullCheckIntervalMs = options.fullCheckIntervalMs ?? DEFAULTS.fullCheckIntervalMs
    this.acquireRetryDelayMs = options.acquireRetryDelayMs ?? DEFAULTS.acquireRetryDelayMs
    this.anchorRestAfterIdleMs = options.anchorRestAfterIdleMs ?? DEFAULTS.anchorRestAfterIdleMs
    this.bootstrapMaxRetries = options.bootstrapMaxRetries ?? DEFAULTS.bootstrapMaxRetries
    this.bootstrapRetryDelayMs = options.bootstrapRetryDelayMs ?? DEFAULTS.bootstrapRetryDelayMs

    this.browser = null
    this.context = null
    this.anchorTab = null
    /** @type {Map<number, TabWorker>} */
    this.workers = new Map() // incluye id 0 = anchor, para simplificar recorridos

    this.sessionGuard = new SessionGuard()
    this.poolState = POOL_STATE.BOOTSTRAPPING
    this._recoveryInFlight = false
    this._fullCheckTimer = null
    this._anchorRestTimer = null

    this.sessionGuard.on('sessionLost', (payload) => this._handleSessionLost(payload))
  }

  getPoolState() {
    return this.poolState
  }

  // ================== BOOTSTRAP INICIAL ==================

  async initialize() {
    logger.info('📍 BrowserSessionManager: lanzando browser único...')
    this.browser = await this._launchBrowser()
    this.context = this.browser.defaultBrowserContext()

    const anchorPage = await this.context.newPage()
    this.anchorTab = new TabWorker({ id: 0, page: anchorPage, isAnchor: true })
    this.workers.set(0, this.anchorTab)

    await this._runBootstrapWithRetry()

    this.poolState = POOL_STATE.RUNNING
    this.anchorTab.markIdle()
    this._scheduleAnchorRest()
    this._startFullCheckLoop()

    logger.info('✅ BrowserSessionManager: sesión inicial lista, pool RUNNING')
  }

  async _launchBrowser() {
    const envs = require('./plugins/env.plugin').envs
    const isHeadless = process.env.NODE_ENV === 'production' || envs.BROWSER_HEADLESS === true ? 'new' : false
    const launchOptions = buildLaunchOptions({ headless: isHeadless })
    return puppeteerExtra.launch(launchOptions)
  }

  /**
   * Ejecuta la estrategia de bootstrap correspondiente (AUTH/GUEST según
   * ScraperConfig) sobre el AnchorTab. Se usa tanto en la inicialización
   * como en cada recovery y en el despertar desde RESTING.
   */
  async _runBootstrapOnAnchor() {
    const mode = await this.modeConfig.getMode() // 'AUTH' | 'GUEST'
    const page = this.anchorTab.getPage()

    logger.info(`🔐 BrowserSessionManager: bootstrap en modo ${mode}`)

    if (mode === 'AUTH') {
      await this.authStrategy.bootstrap(page)
    } else {
      await this.guestStrategy.bootstrap(page)
    }

    const state = await this.sessionGuard.fullCheck(this.anchorTab)
    if (state !== 'VALID') {
      throw new Error(`Bootstrap (${mode}) no dejó la sesión en estado VALID (quedó en ${state})`)
    }
  }

  /**
   * Envuelve _runBootstrapOnAnchor() con reintentos (3 intentos, 30s
   * entre cada uno — confirmado) — cubre el arranque inicial, cualquier
   * recovery por SESSION_LOST, y el despertar del AnchorTab desde
   * RESTING. Robustece el "llegar a indexN.php" sin depender del
   * mecanismo de eventos que usa ScrapService.pageGoto() en el sistema
   * viejo (10 min entre reintentos, pensado para instancia única sin cola).
   */
  async _runBootstrapWithRetry() {
    let lastError = null

    for (let attempt = 1; attempt <= this.bootstrapMaxRetries; attempt++) {
      try {
        await this._runBootstrapOnAnchor()
        this.anchorTab.isResting = false
        return
      } catch (error) {
        lastError = error
        logger.error(`❌ Bootstrap intento ${attempt}/${this.bootstrapMaxRetries} falló: ${error.message}`)
        if (attempt < this.bootstrapMaxRetries) {
          logger.warn(`⏳ Reintentando bootstrap en ${this.bootstrapRetryDelayMs / 1000}s...`)
          await this._delay(this.bootstrapRetryDelayMs)
        }
      }
    }

    throw new Error(`Bootstrap falló tras ${this.bootstrapMaxRetries} intentos: ${lastError?.message}`)
  }

  // ================== ASIGNACIÓN DE TABS ==================

  /**
   * Único punto de entrada para obtener una tab de trabajo. Resuelve
   * los tres caminos posibles en un solo método async:
   *   1) reutilizar cualquier IDLE existente (incluye AnchorTab; si
   *      estaba RESTING, rehace el bootstrap antes de entregarlo)
   *   2) crear una nueva si hay margen bajo SCRAPING_CONCURRENCY
   *   3) esperar (polling) si no hay cupo, hasta que algo se libere
   *
   * NO implementa el timeout duro de 180s / PoolRecoveryError — eso
   * vive en scrape-pool.js, que envuelve esta llamada.
   *
   * @returns {Promise<TabWorker|null>} null si el pool no está RUNNING,
   *          o si falló el despertar del AnchorTab desde RESTING — el
   *          caller decide si sigue esperando o lanza PoolRecoveryError.
   */
  async acquireTabOrCreate() {
    while (true) {
      if (this.poolState !== POOL_STATE.RUNNING) {
        return null
      }

      // 1) reutilizar IDLE existente
      const idleWorker = [...this.workers.values()].find(w => w.isIdle())
      if (idleWorker) {
        if (idleWorker.isAnchor && idleWorker.isResting) {
          logger.info('🔄 AnchorTab estaba en reposo (home/index.php), reanudando sesión antes de asignar trabajo...')
          try {
            await this._runBootstrapWithRetry()
          } catch (error) {
            logger.error('❌ No se pudo reanudar sesión desde reposo:', error.message)
            return null
          }
        }
        if (idleWorker.isAnchor) this._clearAnchorRestTimer()
        idleWorker.markBusy(null) // jobRef real lo setea job-dispatcher
        return idleWorker
      }

      // 2) crear nueva si hay margen
      if (this.workers.size < this.concurrency) {
        const created = await this._createWorker()
        if (created) return created
        continue
      }

      // 3) sin cupo -> esperar y reintentar
      await this._delay(this.acquireRetryDelayMs)
    }
  }
  
  /**
  * Entrega la tab de un workerId específico, creándola si aún no existe
  * y hay margen bajo SCRAPING_CONCURRENCY. A diferencia de
  * acquireTabOrCreate() (genérico), esta va dirigida a un worker en
  * particular — necesario porque JobDispatcher particiona el trabajo
  * por ownerWorkerId, no por "cualquier tab libre".
  *
  * @param {number} workerId
  * @returns {Promise<TabWorker|null>} null si el pool no está RUNNING
  */
  async getOrCreateWorker(workerId) {
    if (this.poolState !== POOL_STATE.RUNNING) return null

    let worker = this.workers.get(workerId)

    if (worker) {
      if (worker.isAnchor && worker.isResting) {
        try {
          await this._runBootstrapWithRetry()
        } catch (error) {
          logger.error('❌ No se pudo reanudar sesión desde reposo:', error.message)
          return null
        }
      }
      if (worker.isAnchor) this._clearAnchorRestTimer()
      return worker // el runner loop es dueño exclusivo de este workerId, no compite con nadie
    }

    if (workerId === 0) {
      // el AnchorTab siempre debe existir tras initialize() — si no está, algo falló antes
      return null
    }

    if (this.workers.size >= this.concurrency) {
      return null // sin margen para crear este worker todavía
    }

    return this._createWorker(workerId)
  }

  /**
   * Crea una nueva Page dentro del mismo BrowserContext (misma sesión
   * que el AnchorTab). Navega directo a indexN.php confiando en que
   * las cookies de sesión ya están puestas — confirmado: la plataforma
   * asume que el usuario ya está autenticado y solo está accediendo a
   * otra pestaña dentro de la plataforma. Solo si el formulario no
   * aparece se ejecuta el fallback de clic.
   */
  async _createWorker(explicitId) {
    if (this.workers.size >= this.concurrency) return null

    const nextId = explicitId ?? this._nextWorkerId()
    const page = await this.context.newPage()
    const worker = new TabWorker({ id: nextId, page, isAnchor: false })
    this.workers.set(nextId, worker)

    try {
      await page.goto('https://oficinajudicialvirtual.pjud.cl/indexN.php', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      })

      const hasForm = await page.$('select#competencia')
      if (!hasForm) {
        logger.warn(`TabWorker#${nextId}: formulario no visible al llegar a indexN.php, ejecutando fallback de clic`)
        await this._clickConsultaUnificadaFallback(page)
      }

      worker.markBusy(null)
      logger.info(`🆕 TabWorker#${nextId} creado y listo en indexN.php`)
      return worker
    } catch (error) {
      logger.error(`❌ Error creando TabWorker#${nextId}:`, error.message)
      this.workers.delete(nextId)
      await worker.close().catch(() => {})
      throw error
    }
  }

  /**
   * Extracción LITERAL de clickConsultaUnificada() + waitForSearchForm()
   * tal como existen en scrapper-auth.js. Mismo selector de submenú,
   * mismo texto de búsqueda del enlace, mismo fallback, mismo timeout
   * del formulario (30000ms).
   */
  async _clickConsultaUnificadaFallback(page) {
    try {
      console.log('🔍 Buscando enlace "Consulta Unificada" en el nav...')

      const submenuExpanded = await page.evaluate(() => {
        const submenuTrigger = document.querySelector('li.subLi a[href="#misCauSubmenu"]')
        if (submenuTrigger) {
          const isExpanded = submenuTrigger.getAttribute('aria-expanded') === 'true'
          if (!isExpanded) {
            submenuTrigger.click()
            return true
          }
        }
        return false
      })

      if (submenuExpanded) {
        console.log('📂 Submenú expandido')
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      const clicked = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'))
        const unifiedLink = links.find(a =>
          a.textContent.trim() === 'Consulta Unificada' ||
          a.textContent.includes('Unificada')
        )
        if (unifiedLink) {
          unifiedLink.click()
          return true
        }

        const causeLink = document.querySelector('#misCauSubmenu a')
        if (causeLink) {
          causeLink.click()
          return true
        }

        return false
      })

      if (clicked) {
        console.log('✅ "Consulta Unificada" seleccionado')
        await new Promise(resolve => setTimeout(resolve, 2000))
      } else {
        console.warn('⚠️ No se encontró "Consulta Unificada", continuando de todos modos...')
      }

      await page.waitForSelector('select#competencia', { timeout: 30000, visible: true })
    } catch (error) {
      throw new Error(`_clickConsultaUnificadaFallback: no se pudo llegar al formulario de búsqueda — ${error.message}`)
    }
  }

  _nextWorkerId() {
    let id = 1
    while (this.workers.has(id)) id++
    return id
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Libera una tab. Si el pool está PAUSED/RECOVERING, la tab se cierra
   * inmediatamente en vez de pasar a IDLE con timer de 4 min.
   */
  releaseTab(worker) {
    if (worker.isAnchor) {
      worker.markIdle()
      this._scheduleAnchorRest()
      return
    }

    if (this.poolState === POOL_STATE.PAUSED || this.poolState === POOL_STATE.RECOVERING) {
      this.workers.delete(worker.id)
      worker.close().catch(err =>
        logger.warn(`Error cerrando TabWorker#${worker.id} durante recovery:`, err.message)
      )
      return
    }

    worker.markIdle()
    this._scheduleIdleClose(worker)
  }

  _scheduleIdleClose(worker) {
    worker._clearIdleTimer()
    worker.idleCloseTimer = setTimeout(async () => {
      if (worker.isIdle()) {
        this.workers.delete(worker.id)
        await worker.close()
        logger.info(`🔒 TabWorker#${worker.id} cerrado por idle timeout (4 min)`)
        this.emit('workerClosed', { workerId: worker.id })
      }
    }, this.idleCloseMs)
  }

  // ================== ANCHOR: REPOSO EN home/index.php ==================

  /**
   * Programa el "regreso a casa" del AnchorTab tras anchorRestAfterIdleMs
   * (10 min, confirmado) sin trabajo nuevo. El navegador NUNCA se cierra
   * — solo navega a home/index.php y queda marcado isResting=true hasta
   * que llegue el próximo trabajo (acquireTabOrCreate lo detecta y
   * rehace el bootstrap completo antes de usarlo).
   */
  _scheduleAnchorRest() {
    this._clearAnchorRestTimer()
    this._anchorRestTimer = setTimeout(() => {
      if (this.anchorTab && this.anchorTab.isIdle() && !this.anchorTab.isResting) {
        this._sendAnchorHome()
      }
    }, this.anchorRestAfterIdleMs)
  }

  _clearAnchorRestTimer() {
    if (this._anchorRestTimer) {
      clearTimeout(this._anchorRestTimer)
      this._anchorRestTimer = null
    }
  }

  async _sendAnchorHome() {
    try {
      logger.info('😴 AnchorTab: sin trabajo nuevo por un tiempo, regresando a home/index.php (navegador permanece abierto)')
      const page = this.anchorTab.getPage()
      await page.goto('https://oficinajudicialvirtual.pjud.cl/home/index.php', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      })
      this.anchorTab.isResting = true
    } catch (error) {
      logger.warn('⚠️ Error enviando AnchorTab a home/index.php:', error.message)
      // no se marca isResting=true si falló la navegación -> el próximo
      // acquireTabOrCreate lo tratará como IDLE normal; si el formulario
      // no está, fallará de forma visible en vez de quedar ambiguo.
    }
  }

  // ================== RECUPERACIÓN DE SESIÓN ==================

  _handleSessionLost({ reason }) {
    if (this._recoveryInFlight) return

    this._recoveryInFlight = true
    this.poolState = POOL_STATE.PAUSED
    this._clearAnchorRestTimer() // no tiene sentido "ir a descansar" en medio de un recovery
    logger.error(`⛔ BrowserSessionManager: POOL PAUSED por sesión perdida — ${reason}`)

    this._waitForWorkersToDrain()
  }

  _waitForWorkersToDrain() {
    const check = async () => {
      const stillBusy = [...this.workers.values()].some(w => !w.isAnchor && w.isBusy())

      if (stillBusy) {
        setTimeout(check, 1000)
        return
      }

      this.poolState = POOL_STATE.RECOVERING
      await this._recover()
    }
    check()
  }

  /**
   * Un solo ciclo de _runBootstrapWithRetry() (3 intentos internos) por
   * evento de sesión perdida. Si aun así falla, el pool queda bloqueado
   * en RECOVERING/_recoveryInFlight=true hasta intervención — a ajustar
   * si en la práctica hace falta más.
   */
  async _recover() {
    try {
      logger.info('🔄 BrowserSessionManager: iniciando recovery en AnchorTab...')
      await this._runBootstrapWithRetry()

      this.sessionGuard.markRecovered()
      this.poolState = POOL_STATE.RUNNING
      this._recoveryInFlight = false
      this._scheduleAnchorRest()

      logger.info('✅ BrowserSessionManager: sesión recuperada, POOL RUNNING')
    } catch (error) {
      logger.error('❌ BrowserSessionManager: recovery falló', { error: error.message })
      // se deja _recoveryInFlight=true a propósito, sin reintento automático
    }
  }

  // ================== KEEP-ALIVE / FULL CHECK ==================

  _startFullCheckLoop() {
    if (this._fullCheckTimer) clearInterval(this._fullCheckTimer)
    this._fullCheckTimer = setInterval(async () => {
      if (this.poolState !== POOL_STATE.RUNNING) return
      if (this.anchorTab.isResting) return // en reposo en home/index.php, no hay formulario que validar
      await this.sessionGuard.fullCheck(this.anchorTab)
    }, this.fullCheckIntervalMs)
  }

  async closeAll() {
    if (this._fullCheckTimer) clearInterval(this._fullCheckTimer)
    this._clearAnchorRestTimer()
    for (const worker of this.workers.values()) {
      if (!worker.isAnchor) await worker.close().catch(() => {})
    }
    if (this.browser) await this.browser.close()
    this.workers.clear()
    this.anchorTab = null
    this.browser = null
    this.context = null
  }
}

module.exports = { BrowserSessionManager, POOL_STATE }
