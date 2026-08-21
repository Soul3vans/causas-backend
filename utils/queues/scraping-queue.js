// utils/queues/scraping-queue.js
//
// Cola de INGRESO (Redis + BullMQ). Ya no ejecuta scraping directamente:
// su único trabajo es insertar la causa en ScraperJobs (vía scrape-pool),
// que reparte en cascada por worker y dispara los runner loops
// correspondientes. La ejecución real vive en scrape-pool.js.

const { Queue, Worker } = require('bullmq')
const IORedis = require('ioredis')
const logger = require('../logger')
const scrapePool = require('../scrape-pool')

const QUEUE_NAME = 'scraping-queue'
const MAX_QUEUE_SIZE = 100 // límite de ADMISIÓN, sin cambios

const connection = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null
})

connection.on('connect', () => {
  logger.info('✅ Conectado a Redis (scraping-queue)')
})
connection.on('error', (err) => {
  logger.error('❌ Error de conexión a Redis (scraping-queue)', { error: err.message })
})

const scrapingQueue = new Queue(QUEUE_NAME, { connection })

async function getPendingCount() {
  const counts = await scrapingQueue.getJobCounts('waiting', 'active', 'delayed')
  return (counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0)
}

async function enqueueCaseUpdate(jobData) {
  return scrapingQueue.add('update-case', jobData, {
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
    attempts: 1
  })
}

/**
 * Drena ScrapingOverflow directamente hacia scrape-pool (ScraperJobs),
 * ya no reencola uno por uno en BullMQ.
 */
async function drainOverflow(models) {
  const { ScrapingOverflow } = models
  const pending = await getPendingCount()
  const slots = MAX_QUEUE_SIZE - pending
  if (slots <= 0) return

  const overflowItems = await ScrapingOverflow.find().sort({ createdAt: 1 }).limit(slots)
  if (overflowItems.length === 0) return

  await scrapePool.enqueueBatch(
    overflowItems.map(item => ({
      caseId: item.caseId,
      processId: item.processId,
      fullRol: item.fullRol,
      searchParams: item.searchParams,
      userId: item.userId
    }))
  )

  await ScrapingOverflow.deleteMany({ _id: { $in: overflowItems.map(i => i._id) } })
  logger.info(`📤 Drenados ${overflowItems.length} causas desde overflow hacia scrape-pool`)
}

/**
 * Único consumer de BullMQ, concurrency=1. Solo inserta en ScraperJobs
 * (vía scrape-pool.enqueueCaseUpdate) — no ejecuta scraping.
 */
function startScrapingWorker(models) {
  const { ScrapingOverflow } = models

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { caseId, processId, fullRol, searchParams, userId } = job.data
      logger.info(`📥 [Process ${processId}] Ingresando causa ${fullRol} a ScraperJobs...`)
      await scrapePool.enqueueCaseUpdate({ caseId, processId, fullRol, searchParams, userId })
    },
    { connection, concurrency: 1 }
  )

  worker.on('completed', async () => {
    await drainOverflow({ ScrapingOverflow })
  })

  worker.on('failed', async (job, err) => {
    logger.error('Job de ingreso a ScraperJobs falló', {
      jobId: job?.id,
      processId: job?.data?.processId,
      error: err.message
    })
    // Nota: este fallo es de INSERCIÓN (ej. Mongo caído), no de scraping
    // en sí — el ProcessStatus todavía no fue creado como QUEUED, así
    // que no hay nada que "revertir" aquí más allá de loguear.
  })

  logger.info('🚀 Worker de ingreso a scrape-pool iniciado (concurrency: 1)')
  return worker
}

module.exports = {
  scrapingQueue,
  enqueueCaseUpdate,
  getPendingCount,
  startScrapingWorker,
  MAX_QUEUE_SIZE,
  drainOverflow
}
