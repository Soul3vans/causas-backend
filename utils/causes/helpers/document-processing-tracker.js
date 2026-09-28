'use strict'

const DocumentProcessingStatus = require('../../../models/DocumentProcessingStatus')
const { jobContext } = require('../../job-context')
const logger = require('../../logger')

async function startTracking({ fullRol, totalDocuments }) {
  const ctx = jobContext.getStore()
  if (!ctx) {
    logger.warn(`⚠️ document-processing-tracker: sin contexto de job para ${fullRol} (¿flujo fuera de la cola?), se registra sin caseId/processId`)
  }
  try {
    return await DocumentProcessingStatus.create({
      fullRol,
      totalDocuments,
      caseId: ctx?.caseId ?? null,
      processId: ctx?.processId ?? null,
      jobId: ctx?.jobId ?? null,
      status: 'PENDING'
    })
  } catch (error) {
    logger.warn('⚠️ document-processing-tracker: no se pudo crear el registro:', error.message)
    return null
  }
}

async function incrementProcessed(trackerId, count) {
  if (!trackerId) return
  try {
    await DocumentProcessingStatus.findByIdAndUpdate(trackerId, { $inc: { processedCount: count } })
  } catch (error) {
    logger.warn('⚠️ document-processing-tracker: no se pudo actualizar progreso:', error.message)
  }
}

async function recordBatchError(trackerId, batchNumber, message) {
  if (!trackerId) return
  try {
    await DocumentProcessingStatus.findByIdAndUpdate(trackerId, {
      $push: { batchErrors: { batchNumber, message } }
    })
  } catch (error) {
    logger.warn('⚠️ document-processing-tracker: no se pudo registrar error de lote:', error.message)
  }
}

async function finishTracking(trackerId, { hadErrors }) {
  if (!trackerId) return
  try {
    await DocumentProcessingStatus.findByIdAndUpdate(trackerId, {
      status: hadErrors ? 'ERROR' : 'COMPLETED',
      completedAt: new Date()
    })
  } catch (error) {
    logger.warn('⚠️ document-processing-tracker: no se pudo cerrar el registro:', error.message)
  }
}

module.exports = { startTracking, incrementProcessed, recordBatchError, finishTracking }