'use strict'

const logger = require('./logger')
const { BrowserSessionManager } = require('./browser-session-manager')
const { JobDispatcher } = require('./job-dispatcher')
const { updateCaseIfNeeded } = require('./case-updater')

const DEFAULTS = {
  acquireTimeoutMs: 180 * 1000 // 180s, confirmado
}

class PoolRecoveryError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PoolRecoveryError'
  }
}

let sessionManager = null
let jobDispatcher = null
let models = null
/** @type {Set<number>} workerIds con un runner loop activo ahora mismo */
const activeRunners = new Set()

/**
@param {{ Cases, Users, ProcessStatus, ScrapingOverflow }} injectedModels
mismo patrón de inyección que ya usa server.js con
startScrapingWorker({ Cases, Users, ProcessStatus, ScrapingOverflow })
*/
async function initialize(injectedModels) {
  models = injectedModels
  const concurrency = parseInt(process.env.SCRAPING_CONCURRENCY) || 2

  const scraperModeConfig = require('./scraper-mode-config')
  await scraperModeConfig.load()
  const authStrategy = require('./bootstrap/auth-strategy')
  const guestStrategy = require('./bootstrap/guest-strategy') // pendiente (contrato ya definido, implementación real pendiente de diagnóstico)

  sessionManager = new BrowserSessionManager({
    concurrency,
    modeConfig: scraperModeConfig,
    authStrategy,
    guestStrategy
  })

  jobDispatcher = new JobDispatcher({ concurrency })

  // --- cableado desacoplado, mismo patrón que SessionGuard ---
  sessionManager.on('workerClosed', ({ workerId }) => {
    activeRunners.delete(workerId)
    jobDispatcher.handleWorkerClosed(workerId).catch(err =>
      logger.error('Error en handleWorkerClosed:', err.message)
    )
  })

  jobDispatcher.on('jobsAssigned', ({ workerIds }) => {
    for (const workerId of workerIds) {
      _ensureRunnerLoop(workerId)
    }
  })

  await sessionManager.initialize()

  // el AnchorTab (worker 0) siempre tiene loop activo desde el arranque,
  // ya que su tab nunca se cierra — el resto son bajo demanda
  _ensureRunnerLoop(0)

  logger.info(`🚀 scrape-pool inicializado (concurrency=${concurrency})`)
}

function getPoolState() {
  return sessionManager?.getPoolState() ?? 'BOOTSTRAPPING'
}

/**
 * Punto de entrada desde scraping-queue.js. Inserta la causa en
 * ScraperJobs (reparto en cascada) y dispara los runner loops
 * necesarios vía el evento 'jobsAssigned'.
 */
async function enqueueCaseUpdate(jobData) {
  return jobDispatcher.enqueueBatch([jobData])
}

async function enqueueBatch(causesData) {
  return jobDispatcher.enqueueBatch(causesData)
}

async function closeAllInstances() {
  activeRunners.clear()
  if (sessionManager) await sessionManager.closeAll()
}

// ================== RUNNER LOOPS ==================

function _ensureRunnerLoop(workerId) {
  if (activeRunners.has(workerId)) return // ya corriendo, nada que hacer
  activeRunners.add(workerId)
  _runnerLoop(workerId).catch(err => {
    logger.error(`💥 runner loop W${workerId + 1} terminó con error inesperado:`, err.message)
    activeRunners.delete(workerId)
  })
}

/**
 * Bucle persistente de un worker específico. Termina (deja de correr)
 * cuando ya no hay QUEUED ni REQUEUED para su workerId — se reactiva
 * automáticamente vía 'jobsAssigned' cuando le llega trabajo nuevo
 * (enqueueBatch o front-draining). El AnchorTab (workerId=0) nunca
 * encuentra motivo para "no existir", así que su ciclo de espera es
 * más económico dejarlo corriendo indefinidamente.
 */
async function _runnerLoop(workerId) {
  while (true) {
    const job = await jobDispatcher.getNextJob(workerId)

    if (!job) {
      if (workerId === 0) {
        await _delay(2000) // el AnchorTab sigue "vivo" esperando, nunca termina el loop
        continue
      }
      activeRunners.delete(workerId)
      logger.info(`💤 runner loop W${workerId + 1}: sin trabajo pendiente, loop termina (se reactivará con 'jobsAssigned')`)
      return
    }

    await _processJob(workerId, job)
  }
}

async function _processJob(workerId, job) {
  const { _id: jobId, caseId, fullRol, searchParams, processId } = job

  logger.info(`🕷️ [W${workerId + 1}] Procesando causa ${fullRol} (job ${jobId})...`)

  let tabWorker
  try {
    tabWorker = await _acquireWithTimeout(workerId)
  } catch (error) {
    // No se pudo ni conseguir tab dentro del timeout -> tratar como
    // PoolRecoveryError: se pausa el intento, la causa queda REQUEUED
    // con afinidad a este mismo worker, se reintentará cuando el pool
    // vuelva a RUNNING.
    await jobDispatcher.markRequeued(jobId, error.message)
    return
  }

  await jobDispatcher.markProcessing(jobId, workerId)

  try {
    const { Cases, Users } = models // inyectados en initialize(models), ver abajo

    const result = await updateCaseIfNeeded(caseId, fullRol, searchParams, { Cases, Users }, tabWorker)

    if (result.success) {
      await jobDispatcher.markCompleted(jobId, {
        newMovements: result.newMovements || 0,
        litigantsChanged: result.litigantsChanged || false,
        mainFieldsChanged: result.mainFieldsChanged || []
      })
    } else if (result.notFound) {
      // COMPLETED_NOT_FOUND: terminal válido, nunca relacionado a sesión
      await jobDispatcher.markNotFound(jobId, result.error)
    } else {
      // updateCaseIfNeeded NUNCA lanza excepción — todo error, incluido
      // uno de sesión perdida ocurrido dentro de scrapRawData, llega
      // aquí como result.success=false. Se clasifica por el ESTADO
      // del pool en este instante, no por tipo de excepción:
      const poolState = getPoolState()
      if (poolState === 'PAUSED' || poolState === 'RECOVERING') {
        await jobDispatcher.markRequeued(jobId, result.error || 'Sesión perdida durante el scraping')
      } else {
        await jobDispatcher.markError(jobId, result.error || 'Error desconocido')
      }
    }
  } catch (error) {
	// Red de seguridad para fallos genuinamente no controlados (ej.
    // Mongo caído, excepción fuera del try interno de updateCaseIfNeeded
    // Mongo caído, excepción fuera del try interno de updateCaseIfNeeded
    if (getPoolState() === 'PAUSED' || getPoolState() === 'RECOVERING') {
      await jobDispatcher.markRequeued(jobId, error.message)
    } else {
      await jobDispatcher.markError(jobId, error.message)
    }
  } finally {
    sessionManager.releaseTab(tabWorker)
  }
}

/**
 * Envuelve getOrCreateWorker() con el timeout de 180s -> PoolRecoveryError,
 * tal como se diseñó en las rondas anteriores.
 */
async function _acquireWithTimeout(workerId, timeoutMs = DEFAULTS.acquireTimeoutMs) {
  const start = Date.now()

  while (true) {
    const tabWorker = await sessionManager.getOrCreateWorker(workerId)
    if (tabWorker) return tabWorker

    if (Date.now() - start > timeoutMs) {
      throw new PoolRecoveryError(`Timeout (${timeoutMs}ms) esperando tab disponible para W${workerId + 1}`)
    }
    await _delay(500)
  }
}

function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = {
  initialize,
  getPoolState,
  enqueueCaseUpdate,
  enqueueBatch,
  closeAllInstances,
  PoolRecoveryError
}
