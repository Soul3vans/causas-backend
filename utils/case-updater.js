// utils/case-updater.js
//
// Extraído de resolvers.js para evitar dependencia circular con
// utils/queues/scraping-queue.js (la cola necesita esta función,
// y resolvers.js necesita la cola para encolar jobs).

const logger = require('./logger')
const { config } = require('../config/mail')
const { abstractSendMail } = require('./mail')
const { caseUpdated } = require('../workers/mail-sender/templates/update-case.tpl')
const { hasCaseChanged, sortMovementsByDate } = require('./compareCaseData')
const { scrapRawData, getScrapeInstance } = require('./scrapper')
const { scrapRawDataAuth, keepSessionAlive } = require('./scrapper-auth')
const InvolvedUsersCase = require('../models/InvolvedUsersCase')

// Mismo flag que tenías en resolvers.js — cámbialo ahí también si lo tocas
const useAuthScraper = false

/**
 * Envía notificaciones por email a los usuarios involucrados en la causa
 * cuando hay cambios tras un scraping exitoso.
 */
async function sendUpdateNotification(Users, caseData, changes) {
  try {
    const involvedUsersDoc = await InvolvedUsersCase.findOne({ case: caseData._id }).populate('involved.userIn')

    const usersToNotify = involvedUsersDoc?.involved?.map(i => i.userIn) || []
    const ownerId = caseData.createdBy?.toString()

    if (ownerId && !usersToNotify.some(u => u._id.toString() === ownerId)) {
      const owner = await Users.findById(ownerId)
      if (owner) usersToNotify.push(owner)
    }

    let changesHtml = '<ul>'
    if (changes.newMovementsCount > 0) {
      changesHtml += `<li><strong>${changes.newMovementsCount}</strong> nuevo(s) movimiento(s)</li>`
    }
    if (changes.litigantsChanged) {
      changesHtml += '<li>Cambios en la lista de litigantes</li>'
    }
    if (changes.mainFieldsChanged.length > 0) {
      changesHtml += `<li>Campos actualizados: ${changes.mainFieldsChanged.join(', ')}</li>`
    }
    changesHtml += '</ul>'

    for (const user of usersToNotify) {
      if (user && user.email) {
        const mailOptions = {
          from: config.from,
          to: user.email,
          subject: `Actualización de Causa: ${caseData.rol}`,
          html: await caseUpdated({
            name: user.name,
            cause: caseData,
            changes: changesHtml
          })
        }
        abstractSendMail(mailOptions)
      }
    }

    logger.info(`Notificaciones enviadas para causa ${caseData.rol} a ${usersToNotify.length} usuarios`)
  } catch (error) {
    logger.error('Error enviando notificaciones de actualización:', error)
  }
}

/**
 * ACTUALIZA UNA CAUSA EXISTENTE SOLO SI HAY CAMBIOS
 * Idéntica a la versión que vivía en resolvers.js — sin cambios de lógica,
 * solo de ubicación.
 */
async function updateCaseIfNeeded(caseId, fullRol, searchParams, models) {
  const { Cases, Users } = models

  const existingCase = await Cases.findById(caseId)

  if (!existingCase) {
    logger.warn(`Causa no encontrada: ${caseId}`)
    return { success: false, error: 'Causa no encontrada' }
  }

  logger.info(`🔄 Actualizando causa ${fullRol}...`)

  try {
    await Cases.findByIdAndUpdate(caseId, {
      'scrapedData.status': 'scraping',
      'scrapedData.lastScrapedAt': new Date(),
      'scrapedData.lastScrapedBy': 'scheduler'
    })

    let scrapResult
    if (useAuthScraper) {
      scrapResult = await scrapRawDataAuth({
        rol: fullRol,
        tribune: searchParams.tribunalId,
        competencia: searchParams.competencia,
        corteId: searchParams.corteId
      })
    } else {
      const globalScrape = await getScrapeInstance()
      scrapResult = await scrapRawData({
        typeSearch: 'UNIFICADA',
        rol: fullRol,
        tribune: searchParams.tribunalId,
        competencia: searchParams.competencia,
        corteId: searchParams.corteId
      }, globalScrape)
    }

    const changes = hasCaseChanged(existingCase, scrapResult)

    if (!changes.hasChanges) {
      logger.info(`📭 No hay cambios nuevos para causa ${fullRol}`)
      await Cases.findByIdAndUpdate(caseId, {
        'scrapedData.status': 'success',
        'scrapedData.lastScrapedAt': new Date(),
        'scrapedData.data': scrapResult,
        'scrapedData.errorMessage': null
      })
      return { success: true, updated: false, reason: 'no_changes', data: existingCase }
    }

    const updateData = {
      'scrapedData.status': 'success',
      'scrapedData.lastScrapedAt': new Date(),
      'scrapedData.data': scrapResult,
      'scrapedData.errorMessage': null,
      'scrapedData.retryCount': 0
    }

    if (changes.newMovementsCount > 0) {
      const newMovementsSorted = sortMovementsByDate(changes.newMovements)
      updateData['$push'] = {
        movementsHistory: { $each: newMovementsSorted, $position: 0 }
      }
      logger.info(`➕ Agregando ${changes.newMovementsCount} movimientos nuevos`)
    }

    if (changes.litigantsChanged) {
      updateData.litigants = scrapResult.litigants
      logger.info('👥 Litigantes actualizados')
    }

    for (const field of changes.mainFieldsChanged) {
      if (scrapResult[field] !== undefined) {
        updateData[field] = scrapResult[field]
        logger.debug(`📝 Campo ${field} actualizado`)
      }
    }

    await Cases.findByIdAndUpdate(caseId, { $set: updateData })

    const updatedCase = await Cases.findById(caseId)

    await sendUpdateNotification(Users, updatedCase, changes)

    if (useAuthScraper) {
      await keepSessionAlive()
    }

    logger.info(`✅ Causa ${fullRol} actualizada correctamente con ${changes.newMovementsCount} nuevos movimientos`)

    return {
      success: true,
      updated: true,
      newMovements: changes.newMovementsCount,
      litigantsChanged: changes.litigantsChanged,
      mainFieldsChanged: changes.mainFieldsChanged,
      data: updatedCase
    }
  } catch (error) {
    logger.error(`❌ Error actualizando causa ${fullRol}`, { error: error.message, stack: error.stack })

    const existing = await Cases.findById(caseId)
    await Cases.findByIdAndUpdate(caseId, {
      'scrapedData.status': 'error',
      'scrapedData.errorMessage': error.message,
      'scrapedData.retryCount': (existing?.scrapedData?.retryCount || 0) + 1
    })

    // ✅ Mantenemos el mismo contrato de retorno que usaban el cron y
    // updateMultipleCases (NO lanzamos excepción), pero agregamos un
    // flag para que el worker de la cola pueda distinguir
    // "causa no encontrada" de un error real, sin afectar a quienes
    // ya consumían esta función.
    return {
      success: false,
      error: error.message,
      notFound: error.name === 'CaseNotFoundError'
    }
  }
}

module.exports = {
  updateCaseIfNeeded,
  sendUpdateNotification
}
