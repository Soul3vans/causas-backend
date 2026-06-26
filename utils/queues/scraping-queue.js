// utils/queues/scraping-queue.js
//
// Cola persistente (Redis + BullMQ) para procesar actualizaciones de
// causas en background, sin bloquear la respuesta del resolver GraphQL.
//
// Concurrencia configurable vía env var SCRAPING_CONCURRENCY.
// Empezamos en 1 (secuencial, reutilizando el navegador único que ya
// existe). Subir a 2+ requiere el refactor de pool de navegadores
// (Fase 2) — no lo hagas todavía con SCRAPING_CONCURRENCY=2 sin ese
// refactor, porque ambos jobs competirían por el mismo navegador.

const { Queue, Worker } = require('bullmq')
const IORedis = require('ioredis')
const logger = require('../logger')
const { updateCaseIfNeeded } = require('../case-updater')

const QUEUE_NAME = 'scraping-queue'
const MAX_QUEUE_SIZE = 100

// BullMQ requiere maxRetriesPerRequest: null en la conexión de ioredis
const connection = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null
})

connection.on('connect', () => {
  console.log('✅ Conectado a Redis (scraping-queue)')
  logger.info('✅ Conectado a Redis (scraping-queue)')
})

connection.on('error', (err) => {
  console.error('❌ Error de conexión a Redis:', err.message)
  logger.error('❌ Error de conexión a Redis (scraping-queue)', { error: err.message })
})

const scrapingQueue = new Queue(QUEUE_NAME, { connection })

/**
 * Cuenta cuántos jobs hay actualmente en espera o procesándose.
 * Usado por el resolver para rechazar nuevos envíos si se llega al límite.
 */
async function getPendingCount() {
  const counts = await scrapingQueue.getJobCounts('waiting', 'active', 'delayed')
  return (counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0)
}

/**
 * Encola una causa para actualización en background.
 * @param {Object} jobData - { caseId, fullRol, searchParams, processId }
 */
async function enqueueCaseUpdate(jobData) {
  return scrapingQueue.add('update-case', jobData, {
    removeOnComplete: { age: 3600 }, // limpiar jobs completados después de 1h
    removeOnFail: { age: 86400 },    // mantener fallidos 24h para debug
    attempts: 1                       // sin reintentos automáticos por ahora
  })
}

// ========== WORKER ==========
// Este es el que realmente ejecuta el scraping, job por job.
// models (Cases, Users, ProcessStatus) se inyectan al iniciar el worker
// desde server.js, para no duplicar los requires de los modelos aquí.
function startScrapingWorker(models) {
  const { Cases, Users, ProcessStatus } = models
  const concurrency = parseInt(process.env.SCRAPING_CONCURRENCY) || 1

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { caseId, fullRol, searchParams, processId } = job.data

      console.log(`🕷️ [Process ${processId}] Procesando causa ${fullRol} desde la cola...`)
      logger.info(`🕷️ [Process ${processId}] Procesando causa ${fullRol} desde la cola...`)

      const result = await updateCaseIfNeeded(caseId, fullRol, searchParams, { Cases, Users })

      // Mapear el resultado de updateCaseIfNeeded → ProcessStatus
      if (result.success) {
        await ProcessStatus.findByIdAndUpdate(processId, {
          status: 'completed',
          completedAt: new Date(),
          summary: {
            newMovements: result.newMovements || 0,
            litigantsChanged: result.litigantsChanged || false,
            mainFieldsChanged: result.mainFieldsChanged || []
          }
        })
      } else if (result.notFound) {
        await ProcessStatus.findByIdAndUpdate(processId, {
          status: 'not_found',
          errorMessage: result.error,
          completedAt: new Date()
        })
      } else {
        await ProcessStatus.findByIdAndUpdate(processId, {
          status: 'error',
          errorMessage: result.error || 'Error desconocido',
          completedAt: new Date()
        })
      }

      return result
    },
    { connection, concurrency }
  )

  worker.on('completed', (job) => {
    console.log(`✅ [Job ${job.id}] Completado: ${job.data.fullRol}`)
  })

  worker.on('failed', async (job, err) => {
    // Esto cubre el caso de un error que se escapa incluso de
    // updateCaseIfNeeded (que ya no debería pasar porque ahí no se
    // lanza excepción, pero es la red de seguridad equivalente a la
    // que armamos en updateCase con el .catch()).
    console.error(`💥 [Job ${job?.id}] Falló de forma no controlada:`, err.message)
    logger.error('Job de scraping falló de forma no controlada', {
      jobId: job?.id,
      caseId: job?.data?.caseId,
      processId: job?.data?.processId,
      error: err.message,
      stack: err.stack
    })

    if (job?.data?.processId) {
      try {
        await ProcessStatus.findByIdAndUpdate(job.data.processId, {
          status: 'error',
          errorMessage: 'Error interno inesperado procesando el job.',
          completedAt: new Date()
        })
      } catch (dbError) {
        console.error('No se pudo actualizar ProcessStatus tras fallo del job:', dbError.message)
      }
    }
  })

  console.log(`🚀 Worker de scraping iniciado (concurrencia: ${concurrency})`)
  logger.info(`🚀 Worker de scraping iniciado (concurrencia: ${concurrency})`)

  return worker
}

module.exports = {
  scrapingQueue,
  enqueueCaseUpdate,
  getPendingCount,
  startScrapingWorker,
  MAX_QUEUE_SIZE
}
