'use strict'

/**
 * scraper-mode-config.js
 *
 * Fuente de verdad en runtime para el modo de bootstrap (AUTH/GUEST)
 * que consume browser-session-manager.js en cada _runBootstrapOnAnchor().
 *
 * Patrón: cache en memoria del proceso, respaldado por models/ScraperConfig.js
 * (Mongo) como persistencia. SIN POLLING — el cache solo se actualiza:
 *   1) una vez al arrancar el proceso (load() en initialize())
 *   2) cuando el resolver de la mutation admin llama setMode() directamente
 *
 * Si el backend llega a correr en más de una instancia (ver limitación
 * ya señalada en rondas anteriores), cada instancia tiene su propio
 * cache y no se sincronizan entre sí automáticamente — asumido y
 * aceptado como limitación conocida por ahora.
 */

const ScraperConfig = require('../models/ScraperConfig')
const logger = require('./logger')

const DEFAULT_MODE = 'AUTH'

let cachedMode = DEFAULT_MODE
let loaded = false

/**
 * Carga el modo persistido en Mongo hacia el cache en memoria.
 * Se llama una sola vez, típicamente desde scrape-pool.initialize()
 * antes de BrowserSessionManager.initialize().
 * Si no existe documento todavía, lo crea con el default (AUTH) y el
 * usuario que lo solicita explícitamente vía initialLoad(userId).
 */
async function load() {
  try {
    const doc = await ScraperConfig.findOne().sort({ updatedAt: -1 })
    if (doc) {
      cachedMode = doc.mode
    } else {
      cachedMode = DEFAULT_MODE
      logger.warn(`⚠️ scraper-mode-config: no hay ScraperConfig en Mongo, usando default en memoria (${DEFAULT_MODE}) sin persistir todavía`)
    }
    loaded = true
    logger.info(`🔧 scraper-mode-config: modo cargado = ${cachedMode}`)
  } catch (error) {
    cachedMode = DEFAULT_MODE
    loaded = true
    logger.error(`❌ scraper-mode-config: error cargando desde Mongo, usando default en memoria (${DEFAULT_MODE})`, { error: error.message })
  }
}

/**
 * Lectura barata, síncrona en la práctica (solo memoria). Es lo que
 * consume browser-session-manager.js en cada bootstrap.
 * @returns {'AUTH'|'GUEST'}
 */
function getMode() {
  if (!loaded) {
    logger.warn('⚠️ scraper-mode-config: getMode() llamado antes de load(), devolviendo default')
  }
  return cachedMode
}

/**
 * Único punto de escritura. Llamado EXCLUSIVAMENTE desde el resolver de
 * la mutation GraphQL protegida (role admin/superuser, ya definido en
 * rondas anteriores). Persiste en Mongo y actualiza el cache en el
 * mismo paso — no hay ventana de inconsistencia entre ambos porque el
 * cache se actualiza inmediatamente después de la escritura exitosa.
 *
 * @param {'AUTH'|'GUEST'} mode
 * @param {string} userId - quien hizo el cambio (ownership/auditoría)
 */
async function setMode(mode, userId) {
  if (mode !== 'AUTH' && mode !== 'GUEST') {
    throw new Error(`scraper-mode-config.setMode: modo inválido "${mode}", debe ser AUTH o GUEST`)
  }

  const doc = await ScraperConfig.findOneAndUpdate(
    {},
    { mode, updatedBy: userId },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )

  cachedMode = doc.mode
  logger.info(`🔧 scraper-mode-config: modo actualizado a ${cachedMode} por usuario ${userId}`)

  return doc
}

module.exports = {
  load,
  getMode,
  setMode,
  DEFAULT_MODE
}
