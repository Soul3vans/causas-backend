'use strict'

/**
 * job-dispatcher.js
 *
 * Dueño de la lógica de asignación de causas a workers:
 *   - enqueueBatch(): reparto en cascada W1→W2→W3 al llegar un lote nuevo;
 *     el excedente que no cabe en la capacidad total se delega a
 *     ScrapingOverflow (mismo colchón que ya usa el sistema hoy)
 *   - getNextJob(): REQUEUED (con afinidad) tiene prioridad sobre QUEUED
 *   - redistributeCascade(): front-draining — cada N completions (default
 *     5), drena trabajo pendiente de workers de índice alto hacia los
 *     de índice bajo
 *   - markRequeued(): pausa una causa por PoolRecoveryError, prioridad 1
 *   - handleWorkerClosed(): reasigna trabajo de un worker que se cerró
 *     (LIFO idle-close) — REQUEUED va a W1 con prioridad 1, QUEUED se
 *     redistribuye por cascada normal
 *
 * Fuente de verdad: ScraperJobs (Opción B, NUNCA expuesta vía GraphQL).
 * Espeja el estado a ProcessStatus (enum ampliado) para que el frontend
 * siga consultando únicamente ese modelo, sin tocar ScraperJobs jamás.
 *
 * Se conecta a BrowserSessionManager de forma DESACOPLADA: quien
 * construye ambos módulos (scrape-pool.js) escucha el evento
 * 'workerClosed' de BrowserSessionManager y llama a
 * jobDispatcher.handleWorkerClosed(workerId) — este módulo no conoce
 * a BrowserSessionManager en absoluto.
 */

const EventEmitter = require('events')
const ScraperJobs = require('../models/ScraperJobs')
const ProcessStatus = require('../models/ProcessStatus')
const ScrapingOverflow = require('../models/ScrapingOverflow')
const logger = require('./logger')

const DEFAULTS = {
  umbralPorWorker: 100,
  drainEveryNCompletions: 5
}

class JobDispatcher extends EventEmitter {
  /**
   * @param {object} options
   * @param {number} options.concurrency - SCRAPING_CONCURRENCY (workers 0..N-1)
   * @param {number} [options.umbralPorWorker] - configurable, default 100
   * @param {number} [options.drainEveryNCompletions] - configurable, default 5
   */
  constructor(options = {}) {
	super()
    this.concurrency = options.concurrency
    this.umbralPorWorker = options.umbralPorWorker ?? DEFAULTS.umbralPorWorker
    this.drainEveryNCompletions = options.drainEveryNCompletions ?? DEFAULTS.drainEveryNCompletions
    this._completionCounter = 0
  }

  // ================== INGRESO DE TRABAJO NUEVO ==================

  /**
   * Reparte un lote nuevo de causas en cascada: llena W1 hasta el
   * umbral, el excedente va a W2, y así sucesivamente. Si el lote
   * completo no cabe en la capacidad total (umbral * concurrency),
   * el remanente se delega a ScrapingOverflow — mismo colchón que ya
   * usa el sistema hoy para MAX_QUEUE_SIZE, no se inventa un mecanismo
   * nuevo de desborde.
   *
   * @param {Array<{caseId, processId, userId, fullRol, searchParams}>} causesData
   */
  async enqueueBatch(causesData) {
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

    // Mirror inicial a ProcessStatus para cada causa realmente encolada
    // (las que fueron a overflow NO se mirrorean aquí como QUEUED, ya
    // que técnicamente todavía no entraron al pool — ver _sendToOverflow)
    await Promise.all(created.map(job => this._mirrorToProcessStatus(job)))
    
    const affectedWorkerIds = [...new Set(created.map(j => j.ownerWorkerId))]
    if (affectedWorkerIds.length > 0) {
      this.emit('jobsAssigned', { workerIds: affectedWorkerIds })
    }

    return created
  }

  /**
   * Delega el excedente que no cabe en la capacidad total del pool
   * (umbralPorWorker * concurrency) a ScrapingOverflow — extracción
   * directa del esquema ya existente (caseId, processId, fullRol,
   * searchParams, userId), sin campos propios de ScraperJobs
   * (status/ownerWorkerId/priority) porque Overflow vive fuera del
   * pool hasta que algún proceso de drenaje ya existente lo reincorpore.
   */
  async _sendToOverflow(causesData) {
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
   * Lee Y reclama atómicamente en una sola operación de Mongo — evita
   * la ventana de carrera entre "leer candidato" y "marcarlo PROCESSING"
   * que existía al ser dos pasos separados. findOneAndUpdate es atómico
   * a nivel de documento: si dos llamadas concurrentes compiten por el
   * mismo filtro, Mongo garantiza que solo UNA la obtiene.
   */
  async getNextJob(workerId) {
    let job = await ScraperJobs.findOneAndUpdate(
      { ownerWorkerId: workerId, status: 'REQUEUED' },
      { status: 'PROCESSING', startedAt: new Date() },
      { sort: { priority: -1, createdAt: 1 }, new: true }
    )

    if (job) {
      await this._mirrorToProcessStatus(job)
      return job
    }

    job = await ScraperJobs.findOneAndUpdate(
      { ownerWorkerId: workerId, status: 'QUEUED' },
      { status: 'PROCESSING', startedAt: new Date() },
      { sort: { priority: -1, createdAt: 1 }, new: true }
    )

    if (job) await this._mirrorToProcessStatus(job)
    return job
  }

  // ================== TRANSICIONES DE ESTADO ==================

  async markProcessing(jobId, workerId) {
    const job = await ScraperJobs.findByIdAndUpdate(
      jobId,
      { status: 'PROCESSING', ownerWorkerId: workerId, startedAt: new Date() },
      { new: true }
    )
    if (job) await this._mirrorToProcessStatus(job)
    return job
  }

  async markCompleted(jobId, summary = {}) {
    const job = await ScraperJobs.findByIdAndUpdate(
      jobId,
      { status: 'COMPLETED', completedAt: new Date() },
      { new: true }
    )
    if (job) await this._mirrorToProcessStatus(job, { summary })
    await this._maybeTriggerDrain()
    return job
  }

  /**
   * COMPLETED_NOT_FOUND: terminal válido, no es un error del sistema.
   */
  async markNotFound(jobId, message) {
    const job = await ScraperJobs.findByIdAndUpdate(
      jobId,
      { status: 'COMPLETED_NOT_FOUND', completedAt: new Date(), errorMessage: message },
      { new: true }
    )
    if (job) await this._mirrorToProcessStatus(job, { warningMessage: message })
    await this._maybeTriggerDrain()
    return job
  }

  /**
   * Error real, sin relación a sesión/infraestructura.
   */
  async markError(jobId, message) {
    const job = await ScraperJobs.findByIdAndUpdate(
      jobId,
      { status: 'ERROR', completedAt: new Date(), errorMessage: message },
      { new: true }
    )
    if (job) await this._mirrorToProcessStatus(job)
    return job
  }

  /**
   * PoolRecoveryError: la causa se detuvo por sesión perdida a mitad de
   * proceso. Mantiene ownerWorkerId (afinidad) y sube a prioridad 1 —
   * nunca se envía al final de la cola.
   */
  async markRequeued(jobId, reason) {
    const job = await ScraperJobs.findByIdAndUpdate(
      jobId,
      {
        status: 'REQUEUED',
        priority: 1,
        errorMessage: reason,
        $inc: { requeueCount: 1 }
      },
      { new: true }
    )
    if (job) {
      logger.warn(`🔁 JobDispatcher: causa ${job.caseId} → REQUEUED (worker afín: W${job.ownerWorkerId + 1}) — ${reason}`)
      await this._mirrorToProcessStatus(job)
    }
    return job
  }

  // ================== FRONT-DRAINING ==================

  /**
   * Se llama tras cada COMPLETED/COMPLETED_NOT_FOUND. Cada
   * drainEveryNCompletions (5, confirmado) dispara la evaluación de cascada.
   */
  async _maybeTriggerDrain() {
    this._completionCounter++
    if (this._completionCounter % this.drainEveryNCompletions === 0) {
      await this.redistributeCascade()
    }
  }

  /**
   * Front-draining: recorre los workers de índice bajo a alto como
   * "destino" (quién tiene cupo libre), y para cada uno toma trabajo
   * QUEUED de los workers de índice alto a bajo como "origen" (quién
   * tiene excedente). Dirección única, W1 nunca cede trabajo.
   * Solo mueve causas QUEUED (nunca PROCESSING, nunca REQUEUED — esas
   * ya tienen afinidad fija y no se tocan aquí).
   */
  async redistributeCascade() {
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

  /**
   * Llamado desde scrape-pool.js al escuchar el evento 'workerClosed'
   * emitido por BrowserSessionManager (conexión desacoplada, mismo
   * patrón que SessionGuard). Reasigna cualquier trabajo que ese worker
   * todavía tuviera:
   *   - REQUEUED -> siempre a W1 (id 0), prioridad 1
   *   - QUEUED   -> se redistribuye por cascada normal (en la práctica
   *                 no debería haber QUEUED remanente si el front-draining
   *                 ya vació al worker antes de que el idle-close disparara,
   *                 pero se cubre por seguridad)
   *
   * @param {number} workerId
   */
  async handleWorkerClosed(workerId) {
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

  /**
   * @returns {Promise<Object<number, number>>} { workerId: cantidadOcupada }
   */
  async _getQueueCounts() {
    const rows = await ScraperJobs.aggregate([
      { $match: { status: { $in: ['QUEUED', 'PROCESSING', 'REQUEUED'] } } },
      { $group: { _id: '$ownerWorkerId', count: { $sum: 1 } } }
    ])
    const counts = {}
    for (const row of rows) counts[row._id] = row.count
    return counts
  }

  /**
   * Espeja el estado de ScraperJobs hacia ProcessStatus (único modelo
   * expuesto vía GraphQL). ScraperJobs sigue siendo la fuente de verdad
   * interna; esto es solo una proyección de solo-lectura para el frontend.
   */
  async _mirrorToProcessStatus(job, extra = {}) {
    try {
      await ProcessStatus.findByIdAndUpdate(job.processId, {
        status: job.status,
        ...(extra.summary ? { summary: extra.summary } : {}),
        ...(extra.warningMessage ? { errorMessage: extra.warningMessage } : {}),
        ...(job.errorMessage ? { errorMessage: job.errorMessage } : {})
      })
    } catch (error) {
      logger.warn(`⚠️ JobDispatcher: no se pudo espejar a ProcessStatus (${job.processId}):`, error.message)
    }
  }
}

module.exports = { JobDispatcher, DEFAULTS }
