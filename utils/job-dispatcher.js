'use strict'

/**
 * job-dispatcher.js
 *
 * Dueño de la lógica de asignación de causas a workers (reparto en cascada,
 * front-draining, REQUEUED con afinidad, cierre de worker).
 *
 * Fuente de verdad: ScraperJobs (NUNCA expuesta vía GraphQL). Espeja el estado
 * a ProcessStatus para que el frontend consulte únicamente ese modelo.
 *
 * Se conecta a BrowserSessionManager de forma DESACOPLADA: scrape-pool.js escucha
 * 'workerClosed' y llama a handleWorkerClosed().
 */

const EventEmitter = require('events')
const os = require('os') // NUEVO
const ScraperJobs = require('../models/ScraperJobs')
const ProcessStatus = require('../models/ProcessStatus')
const ScrapingOverflow = require('../models/ScrapingOverflow')
const logger = require('./logger')

const DEFAULTS = {
  umbralPorWorker: 100,
  drainEveryNCompletions: 5
}

// NUEVO: estados finales. Un job en uno de estos estados no se vuelve a modificar.
const TERMINAL_STATES = ['COMPLETED', 'COMPLETED_NOT_FOUND', 'ERROR']

class JobDispatcher extends EventEmitter {
  constructor (options = {}) {
    super()
    this.concurrency = options.concurrency
    this.umbralPorWorker = options.umbralPorWorker ?? DEFAULTS.umbralPorWorker
    this.drainEveryNCompletions = options.drainEveryNCompletions ?? DEFAULTS.drainEveryNCompletions
    this._completionCounter = 0
    // NUEVO: identifica a este proceso (para saber quién reclamó cada job)
    this.instanceId = options.instanceId ?? `${os.hostname()}:${process.pid}`
  }

  // ================== INGRESO DE TRABAJO NUEVO ==================

  async enqueueBatch (causesData) {
    if (!causesData?.length) return []

    const counts = await this._getQueueCounts()
    const remaining = [...causesData]
    const created = []

    for (let workerId = 0; workerId < this.concurrency && remaining.length > 0; workerId++) {
      const free = this.umbralPorWorker - (counts[workerId] || 0)
      if (free <= 0) continue

      const chunk = remaining.splice(0, free)
      const docs = await ScraperJobs.insertMany(
        chunk.map(c => ({
          ...c,
          ownerWorkerId: workerId,
          status: 'QUEUED',
          priority: 0
        }))
      )

      created.push(...docs)
      counts[workerId] = (counts[workerId] || 0) + chunk.length
      logger.info(`📥 JobDispatcher: ${chunk.length} causas asignadas a W${workerId + 1} (cupo: ${counts[workerId]}/${this.umbralPorWorker})`)
    }

    if (remaining.length > 0) {
      await this._sendToOverflow(remaining)
    }

    await Promise.all(created.map(job => this._mirrorToProcessStatus(job)))

    const affectedWorkerIds = [...new Set(created.map(j => j.ownerWorkerId))]
    if (affectedWorkerIds.length > 0) {
      this.emit('jobsAssigned', { workerIds: affectedWorkerIds })
    }

    return created
  }

  async _sendToOverflow (causesData) {
    await ScrapingOverflow.insertMany(
      causesData.map(c => ({
        caseId: c.caseId,
        processId: c.processId,
        fullRol: c.fullRol,
        searchParams: c.searchParams,
        userId: c.userId
      }))
    )
    logger.warn(`⚠️ JobDispatcher: ${causesData.length} causas exceden la capacidad total (${this.umbralPorWorker * this.concurrency}), enviadas a ScrapingOverflow`)
  }

  // ================== ASIGNACIÓN A UN WORKER LIBRE ==================

  /**
   * Lee Y reclama atómicamente en una sola operación de Mongo.
   * CAMBIO: al reclamar también se guarda quién lo reclamó y el primer latido.
   */
  async getNextJob (workerId) {
    const claim = () => ({
      status: 'PROCESSING',
      startedAt: new Date(),
      claimedBy: this.instanceId, // NUEVO
      heartbeatAt: new Date() // NUEVO
    })

    let job = await ScraperJobs.findOneAndUpdate(
      { ownerWorkerId: workerId, status: 'REQUEUED' },
      claim(),
      { sort: { priority: -1, createdAt: 1 }, new: true }
    )

    if (job) {
      await this._mirrorToProcessStatus(job)
      return job
    }

    job = await ScraperJobs.findOneAndUpdate(
      { ownerWorkerId: workerId, status: 'QUEUED' },
      claim(),
      { sort: { priority: -1, createdAt: 1 }, new: true }
    )

    if (job) await this._mirrorToProcessStatus(job)
    return job
  }

  // ================== TRANSICIONES DE ESTADO ==================

  /**
   * NUEVO: única puerta para cambiar el estado de un job. Un estado terminal
   * nunca se pisa: si el job ya terminó, el cambio se descarta con un aviso
   * (no lanza error) y se emite 'staleTransition' para el futuro observador.
   */
  async _transition (jobId, update, extra = {}) {
    const job = await ScraperJobs.findOneAndUpdate(
      { _id: jobId, status: { $nin: TERMINAL_STATES } },
      update,
      { new: true }
    )

    if (!job) {
      logger.warn(`⚠️ JobDispatcher: transición a ${update.status} descartada para el job ${jobId} (ya terminal o inexistente)`)
      this.emit('staleTransition', { jobId: String(jobId), attempted: update.status })
      return null
    }

    await this._mirrorToProcessStatus(job, extra)
    return job
  }

  // CAMBIO: usa _transition (antes escribía sin condición de estado)
  async markProcessing (jobId, workerId) {
    return this._transition(jobId, {
      status: 'PROCESSING',
      ownerWorkerId: workerId,
      startedAt: new Date(),
      claimedBy: this.instanceId,
      heartbeatAt: new Date()
    })
  }

  // CAMBIO
  async markCompleted (jobId, summary = {}) {
    const job = await this._transition(jobId, { status: 'COMPLETED', completedAt: new Date() }, { summary })
    if (job) await this._maybeTriggerDrain()
    return job
  }

  // CAMBIO: COMPLETED_NOT_FOUND es terminal válido, no es un error del sistema.
  async markNotFound (jobId, message) {
    const job = await this._transition(
      jobId,
      { status: 'COMPLETED_NOT_FOUND', completedAt: new Date(), errorMessage: message },
      { warningMessage: message }
    )
    if (job) await this._maybeTriggerDrain()
    return job
  }

  // CAMBIO: error real, sin relación a sesión/infraestructura.
  async markError (jobId, message) {
    return this._transition(jobId, { status: 'ERROR', completedAt: new Date(), errorMessage: message })
  }

  // CAMBIO: mantiene la afinidad de worker y sube a prioridad 1.
  async markRequeued (jobId, reason) {
    const job = await this._transition(jobId, {
      status: 'REQUEUED',
      priority: 1,
      errorMessage: reason,
      claimedBy: null,
      $inc: { requeueCount: 1 }
    })
    if (job) {
      logger.warn(`🔁 JobDispatcher: causa ${job.caseId} → REQUEUED (worker afín: W${job.ownerWorkerId + 1}) — ${reason}`)
    }
    return job
  }

  // NUEVO: latido. Lo llama scrape-pool cada 30 s mientras el job está en curso.
  async touch (jobId) {
    try {
      await ScraperJobs.updateOne({ _id: jobId, status: 'PROCESSING' }, { heartbeatAt: new Date() })
    } catch (error) {
      logger.warn(`⚠️ JobDispatcher: no se pudo registrar el latido de ${jobId}: ${error.message}`)
    }
  }

  /**
   * NUEVO: libera cupos. Los jobs PROCESSING sin latido reciente quedaron huérfanos
   * (el proceso que los ejecutaba murió). Si son recientes vuelven a la cola; si son
   * muy antiguos pasan a ERROR.
   */
  async recoverOrphans ({ staleAfterMs = 2 * 60 * 1000, maxRecoverAgeMs = 6 * 60 * 60 * 1000 } = {}) {
    const now = Date.now()
    const cutoff = new Date(now - staleAfterMs)

    const orphans = await ScraperJobs.find({
      status: 'PROCESSING',
      $or: [
        { heartbeatAt: { $lt: cutoff } },
        { heartbeatAt: null, startedAt: { $lt: cutoff } } // jobs viejos sin latido
      ]
    }).select('_id fullRol startedAt')

    for (const job of orphans) {
      const age = now - new Date(job.startedAt).getTime()
      if (age > maxRecoverAgeMs) {
        await this.markError(job._id, 'Huérfano antiguo: interrumpido por cierre del servidor')
      } else {
        await this.markRequeued(job._id, 'Recuperado tras interrupción del proceso que lo ejecutaba')
      }
      logger.warn(`♻️ JobDispatcher: job huérfano ${job.fullRol} (${job._id}) recuperado`)
    }

    return orphans.length
  }

  // ================== FRONT-DRAINING ==================

  async _maybeTriggerDrain () {
    this._completionCounter++
    if (this._completionCounter % this.drainEveryNCompletions === 0) {
      await this.redistributeCascade()
    }
  }

  async redistributeCascade () {
    const counts = await this._getQueueCounts()
    const touchedTargets = new Set()

    for (let target = 0; target < this.concurrency - 1; target++) {
      let free = this.umbralPorWorker - (counts[target] || 0)
      if (free <= 0) continue

      for (let source = this.concurrency - 1; source > target && free > 0; source--) {
        const available = counts[source] || 0
        if (available <= 0) continue

        const moveCount = Math.min(free, available)
        const jobsToMove = await ScraperJobs.find({ ownerWorkerId: source, status: 'QUEUED' })
          .sort({ createdAt: 1 })
          .limit(moveCount)
          .select('_id')

        if (jobsToMove.length === 0) continue

        const ids = jobsToMove.map(j => j._id)
        await ScraperJobs.updateMany({ _id: { $in: ids } }, { ownerWorkerId: target })
        touchedTargets.add(target)

        counts[target] = (counts[target] || 0) + ids.length
        counts[source] = (counts[source] || 0) - ids.length
        free -= ids.length

        logger.info(`↔️ JobDispatcher: ${ids.length} causas movidas de W${source + 1}→W${target + 1} (front-draining)`)
      }
    }
    if (touchedTargets.size > 0) {
      this.emit('jobsAssigned', { workerIds: [...touchedTargets] })
    }
  }

  // ================== CIERRE DE WORKER (LIFO idle-close) ==================

  async handleWorkerClosed (workerId) {
    const requeuedReassigned = await ScraperJobs.updateMany(
      { ownerWorkerId: workerId, status: 'REQUEUED' },
      { ownerWorkerId: 0, priority: 1 }
    )
    if (requeuedReassigned.modifiedCount > 0) {
      logger.warn(`🔁 JobDispatcher: W${workerId + 1} cerrado, ${requeuedReassigned.modifiedCount} causa(s) REQUEUED reasignadas a W1`)
    }

    const stillQueued = await ScraperJobs.countDocuments({ ownerWorkerId: workerId, status: 'QUEUED' })
    if (stillQueued > 0) {
      logger.warn(`⚠️ JobDispatcher: W${workerId + 1} cerrado con ${stillQueued} causa(s) QUEUED remanentes, redistribuyendo...`)
      await ScraperJobs.updateMany({ ownerWorkerId: workerId, status: 'QUEUED' }, { ownerWorkerId: 0 })
      await this.redistributeCascade()
    }
  }

  // ================== HELPERS ==================

  async _getQueueCounts () {
    const rows = await ScraperJobs.aggregate([
      { $match: { status: { $in: ['QUEUED', 'PROCESSING', 'REQUEUED'] } } },
      { $group: { _id: '$ownerWorkerId', count: { $sum: 1 } } }
    ])
    const counts = {}
    for (const row of rows) counts[row._id] = row.count
    return counts
  }

  /**
   * Espeja el estado de ScraperJobs hacia ProcessStatus (único modelo expuesto vía GraphQL).
   * CAMBIO: al llegar a un estado terminal también se copia completedAt.
   */
  async _mirrorToProcessStatus (job, extra = {}) {
    try {
      await ProcessStatus.findByIdAndUpdate(job.processId, {
        status: job.status,
        ...(TERMINAL_STATES.includes(job.status) && job.completedAt ? { completedAt: job.completedAt } : {}),
        ...(extra.summary ? { summary: extra.summary } : {}),
        ...(extra.warningMessage ? { errorMessage: extra.warningMessage } : {}),
        ...(job.errorMessage ? { errorMessage: job.errorMessage } : {})
      })
    } catch (error) {
      logger.warn(`⚠️ JobDispatcher: no se pudo espejar a ProcessStatus (${job.processId}):`, error.message)
    }
  }
}

module.exports = { JobDispatcher, DEFAULTS, TERMINAL_STATES }
