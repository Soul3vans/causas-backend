'use strict'

/**
 * bootstrap/guest-strategy.js
 * (ver cabecera de diseño completa en la versión anterior — sin cambios
 * en el resto del contrato, solo se robustece tryNormalHandshake y
 * detectHandshakeFailure con detección multicapa + reintentos)
 */

const logger = require('../logger')

const HOME_URL = 'https://oficinajudicialvirtual.pjud.cl/home/index.php'
const HANDSHAKE_MAX_LOCAL_RETRIES = 2       // antes de escalar a recover()
const HANDSHAKE_RETRY_BACKOFF_MS = [1000, 3000] // backoff creciente entre reintentos locales

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ---------- tryNormalHandshake: detección multicapa ----------

/**
 * Dispara accesoConsultaCausas() y evalúa el resultado combinando TRES
 * señales independientes, para no depender de una sola:
 *   1. 'requestfailed' - fallo a nivel de transporte (ERR_CONNECTION_RESET, etc.)
 *   2. 'response' - respuesta HTTP recibida pero con status de error (4xx/5xx)
 *   3. Verificación final de estado: URL en indexN.php + localStorage seteado
 *      correctamente (no basta con la URL sola — confirma que el
 *      callback de éxito de jQuery realmente corrió)
 *
 * @param {import('puppeteer').Page} page
 * @returns {Promise<{ok: boolean, failureType: 'network'|'http'|'silent'|null, errorText?: string, httpStatus?: number}>}
 */
async function tryNormalHandshake(page) {
  let networkFailure = null
  let httpFailure = null

  const onRequestFailed = (request) => {
    if (request.url().includes('sesion-invitado.php')) {
      networkFailure = request.failure()?.errorText || 'unknown network error'
    }
  }

  const onResponse = (response) => {
    if (response.url().includes('sesion-invitado.php') && response.status() >= 400) {
      httpFailure = response.status()
    }
  }

  page.on('requestfailed', onRequestFailed)
  page.on('response', onResponse)

  try {
    console.log('🔍 guest-strategy: disparando accesoConsultaCausas() (botón "Consulta causas")...')

    const navigationPromise = page.waitForNavigation({
      waitUntil: 'domcontentloaded',
      timeout: 30000
    }).catch(() => null)

    await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      accesoConsultaCausas()
    })

    await navigationPromise
    await timeout(800) // margen para que requestfailed/response terminen de emitirse

    // Capa 1: fallo de transporte
    if (networkFailure) {
      return { ok: false, failureType: 'network', errorText: networkFailure }
    }

    // Capa 2: fallo HTTP (el request llegó, el servidor respondió error)
    if (httpFailure) {
      return { ok: false, failureType: 'http', httpStatus: httpFailure, errorText: `HTTP ${httpFailure} en sesion-invitado.php` }
    }

    // Capa 3: verificación real de estado, no solo la URL
    const currentUrl = page.url()
    if (!currentUrl.includes('indexN.php')) {
      return { ok: false, failureType: 'silent', errorText: `Sin navegación a indexN.php, URL actual: ${currentUrl}` }
    }

    const sessionState = await page.evaluate(() => ({
      loggedIn: localStorage.getItem('logged-in'),
      initSitioNew: localStorage.getItem('InitSitioNew')
    })).catch(() => null)

    if (!sessionState || sessionState.loggedIn !== 'true') {
      // Navegó a indexN.php pero NO por el callback esperado de
      // accesoConsultaCausas() (localStorage no quedó seteado) —
      // estado inconsistente, se trata como fallo silencioso.
      return { ok: false, failureType: 'silent', errorText: 'Navegó a indexN.php pero localStorage.logged-in no quedó en true' }
    }

    console.log('✅ guest-strategy: handshake exitoso, en indexN.php con sesión verificada')
    return { ok: true, failureType: null }
  } finally {
    page.off('requestfailed', onRequestFailed)
    page.off('response', onResponse)
  }
}

// ---------- detectHandshakeFailure: clasificación por tipo de fallo ----------

function detectHandshakeFailure(handshakeResult) {
  if (handshakeResult.ok) return null

  if (handshakeResult.failureType === 'network') {
    const transientPatterns = ['CONNECTION_RESET', 'NETWORK_CHANGED', 'TIMED_OUT', 'CONNECTION_CLOSED']
    const isTransient = transientPatterns.some(p =>
      (handshakeResult.errorText || '').toUpperCase().includes(p)
    )
    return isTransient ? 'TRANSIENT' : 'SUSPECT'
  }

  if (handshakeResult.failureType === 'http') {
    // 5xx = probablemente transitorio (servidor sobrecargado);
    // 4xx = más serio, posible bloqueo/rechazo -> SUSPECT directo
    return handshakeResult.httpStatus >= 500 ? 'TRANSIENT' : 'SUSPECT'
  }

  // 'silent' (navegó pero estado inconsistente) siempre amerita
  // investigación completa, nunca se trata como transitorio
  return 'SUSPECT'
}

/**
 * Envuelve tryNormalHandshake() con reintentos locales con backoff
 * ANTES de escalar a recover(). Solo aplica cuando el nivel es
 * TRANSIENT — un SUSPECT/nivel más grave escala directo, sin gastar
 * reintentos en algo que probablemente no se resuelva solo.
 */
async function handshakeWithLocalRetries(page) {
  let result = await tryNormalHandshake(page)
  if (result.ok) return result

  let level = detectHandshakeFailure(result)

  for (let attempt = 0; attempt < HANDSHAKE_MAX_LOCAL_RETRIES && level === 'TRANSIENT'; attempt++) {
    const backoff = HANDSHAKE_RETRY_BACKOFF_MS[attempt] || HANDSHAKE_RETRY_BACKOFF_MS.at(-1)
    logger.warn(`🔁 guest-strategy: reintento local ${attempt + 1}/${HANDSHAKE_MAX_LOCAL_RETRIES} en ${backoff}ms (${result.errorText})`)
    await timeout(backoff)

    result = await tryNormalHandshake(page)
    if (result.ok) return result

    level = detectHandshakeFailure(result)
  }

  return result
}

// ---------- recover: secuencia de 7 pasos ya cerrada (sin cambios) ----------

async function recover(page) {
  logger.warn('🔄 guest-strategy: iniciando recuperación tras fallo de handshake...')

  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await timeout(2000)
  await returnToHome(page)

  const isValid = await validateGuestSession(page)
  if (!isValid) {
    throw new Error('guest-strategy.recover: la sesión guest no quedó habilitada tras la recuperación')
  }

  logger.info('✅ guest-strategy: recuperación completada, reintentando handshake...')
  const retryResult = await handshakeWithLocalRetries(page)

  if (!retryResult.ok) {
    throw new Error(`guest-strategy.recover: el handshake volvió a fallar tras recuperación — ${retryResult.errorText}`)
  }
}

async function returnToHome(page) {
  console.log('📍 guest-strategy: navegando a home/index.php...')
  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await timeout(1000)
}

async function validateGuestSession(page) {
  try {
    return await page.evaluate(() =>
      document.querySelector('button.dropbtn[onclick*="accesoConsultaCausas"]') !== null
    )
  } catch (error) {
    logger.warn('⚠️ guest-strategy.validateGuestSession: error evaluando página:', error.message)
    return false
  }
}

// ---------- contrato exigido por BrowserSessionManager ----------

async function bootstrap(page) {
  logger.info('🎫 guest-strategy: iniciando bootstrap GUEST sobre AnchorTab')

  await returnToHome(page)

  const result = await handshakeWithLocalRetries(page)

  if (!result.ok) {
    logger.warn(`⚠️ guest-strategy: handshake agotó reintentos locales — ${result.errorText}`)
    await recover(page)
  }

  const currentUrl = page.url()
  if (!currentUrl.includes('indexN.php')) {
    throw new Error(`guest-strategy.bootstrap: no se alcanzó indexN.php, URL actual: ${currentUrl}`)
  }

  logger.info('✅ guest-strategy: bootstrap GUEST completado')
}

module.exports = {
  bootstrap,
  tryNormalHandshake,
  handshakeWithLocalRetries,
  detectHandshakeFailure,
  recover,
  returnToHome,
  validateGuestSession
}
