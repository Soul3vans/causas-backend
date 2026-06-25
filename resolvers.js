const { AuthenticationError } = require('apollo-server-express')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const mongoose = require('mongoose')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const { courtNameById, courtIdByName } = require('./utils/seedsjudge')
const { config } = require('./config/mail')
const { abstractSendMail } = require('./utils/mail')
const { GraphQLUpload } = require('graphql-upload')

// Importar desde scrapper.js
const { scrapRawData, scrapMultipleCauses, scrapeAndUpdateCase, updateMultipleCases, closeScrapeInstance, getScrapeInstance, CaseNotFoundError } = require('./utils/scrapper')
const { scrapRawDataAuth, keepSessionAlive, closeAuthScrapeInstance, isSessionAlive } = require('./utils/scrapper-auth')

// Importar utilidades de comparación (NUEVO)
const { hasCaseChanged, sortMovementsByDate, getNewMovements } = require('./utils/compareCaseData')

const logger = require('./utils/logger')
const moment = require('moment')
const { DateTime } = require('luxon')

const { cause } = require('./utils/causes')
const plugins = require('./utils/plugins')
const {
  addNewCause
} = require('./workers/mail-sender/templates/add-new-cause.tpl')

// Nueva plantilla para actualizaciones
const { caseUpdated } = require('./workers/mail-sender/templates/update-case.tpl')

puppeteer.use(StealthPlugin())

let globalScrape = null;
let useAuthScraper = false; // Cambiar a true para usar modo autenticado

/**
 * Inicializa la instancia global del navegador (se llama una sola vez al iniciar el servidor)
 * @returns {Promise<ScrapService>}
 */
async function initGlobalScrape() {
    // Si ya existe una instancia, reutilizarla
    if (globalScrape) {
        console.log('♻️ Reutilizando instancia existente del navegador');
        
        // Verificar que la página sigue abierta
        try {
            const page = globalScrape.getPage();
            const url = await page.url();
            console.log(`📍 URL actual de la instancia: ${url}`);
            
            // Si estamos en indexN.php y necesitamos home/index.php, navegar
            if (url.includes('indexN.php')) {
                console.log('🔄 Navegando a home/index.php para mantener sesión...');
                await page.goto('https://oficinajudicialvirtual.pjud.cl/home/index.php', {
                    waitUntil: 'domcontentloaded',
                    timeout: 60000
                });
                await page.evaluate(() => {
                    localStorage.setItem('InitSitioOld', '0');
                    localStorage.setItem('InitSitioNew', '1');
                    localStorage.setItem('logged-in', 'true');
                    localStorage.setItem('acceso-invitado', 'true');
                    sessionStorage.setItem('logged-in', 'true');
                    sessionStorage.setItem('acceso-invitado', 'true');
                });
                console.log('✅ Tokens restablecidos en home/index.php');
            }
        } catch (error) {
            console.warn('⚠️ La instancia existente parece cerrada, creando nueva...');
            // Si la página está cerrada, crear nueva
            globalScrape = null;
        }
        
        // Si globalScrape no es null, retornarla
        if (globalScrape) {
            return globalScrape;
        }
    }
    
    // Crear nueva instancia solo si no existe
    console.log('🚀 Creando nueva instancia del navegador...');
    logger.info('🚀 Inicializando navegador global (solo una vez)...');
    
    if (useAuthScraper) {
        const { getAuthScrapeInstance } = require('./utils/scrapper-auth');
        globalScrape = await getAuthScrapeInstance();
    } else {
        globalScrape = await getScrapeInstance();
    }
    return globalScrape;
}

const createToken = (user, secret, expiresIn) => {
  const { email, rol, name } = user
  return jwt.sign({ email, rol, name }, secret, { expiresIn })
}

function sortByDate(list) {
  list.sort((a, b) => {
    const keyA = a.day
    const keyB = b.day
    if (keyA < keyB) return 1
    if (keyA > keyB) return -1
    return 0
  })
  return list
}

async function gu(um, cu) {
  if (!cu) {
    return null
  }
  const user = await um.findOne({ email: cu.email }, { password: false })
  return user
}

/**
 * Envía notificación por email a usuarios involucrados cuando hay cambios en una causa
 * @param {Object} Users - Modelo de Users
 * @param {Object} caseData - Datos de la causa actualizada
 * @param {Object} changes - Resumen de cambios (de hasCaseChanged)
 */
async function sendUpdateNotification(Users, caseData, changes) {
  try {
    // Buscar usuarios involucrados en la causa
    const InvolvedUsersCase = require('./models/InvolvedUsersCase');
    const involvedUsersDoc = await InvolvedUsersCase.findOne({ case: caseData._id }).populate('involved.userIn');
    
    const usersToNotify = involvedUsersDoc?.involved?.map(i => i.userIn) || [];
    const ownerId = caseData.createdBy?.toString();
    
    // Agregar al dueño de la causa si no está en la lista
    if (ownerId && !usersToNotify.some(u => u._id.toString() === ownerId)) {
      const owner = await Users.findById(ownerId);
      if (owner) usersToNotify.push(owner);
    }
    
    // Construir resumen de cambios para el email
    let changesHtml = '<ul>';
    if (changes.newMovementsCount > 0) {
      changesHtml += `<li><strong>${changes.newMovementsCount}</strong> nuevo(s) movimiento(s)</li>`;
    }
    if (changes.litigantsChanged) {
      changesHtml += '<li>Cambios en la lista de litigantes</li>';
    }
    if (changes.mainFieldsChanged.length > 0) {
      changesHtml += `<li>Campos actualizados: ${changes.mainFieldsChanged.join(', ')}</li>`;
    }
    changesHtml += '</ul>';
    
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
        };
        abstractSendMail(mailOptions);
      }
    }
    
    logger.info(`Notificaciones enviadas para causa ${caseData.rol} a ${usersToNotify.length} usuarios`);
    
  } catch (error) {
    logger.error('Error enviando notificaciones de actualización:', error);
  }
}

/**
 * ACTUALIZA UNA CAUSA EXISTENTE SOLO SI HAY CAMBIOS (MEJORADA)
 * @param {string} caseId - ID de la causa en MongoDB
 * @param {string} fullRol - Rol completo (ej: "C-21503-2024")
 * @param {Object} searchParams - Parámetros de búsqueda
 * @param {Object} models - Modelos de Mongoose
 * @returns {Promise<Object>} - Resultado de la actualización
 */
async function updateCaseIfNeeded(caseId, fullRol, searchParams, models) {
  const { Cases, Users } = models;
  
  const existingCase = await Cases.findById(caseId);
  
  if (!existingCase) {
    logger.warn(`Causa no encontrada: ${caseId}`);
    return { success: false, error: 'Causa no encontrada' };
  }
  
  logger.info(`🔄 Actualizando causa ${fullRol}...`);
  
  try {
    // Actualizar estado a 'scraping'
    await Cases.findByIdAndUpdate(caseId, {
      'scrapedData.status': 'scraping',
      'scrapedData.lastScrapedAt': new Date(),
      'scrapedData.lastScrapedBy': 'scheduler'
    });
    
    // Ejecutar scraper
    let scrapResult;
    if (useAuthScraper) {
      scrapResult = await scrapRawDataAuth({
        rol: fullRol,
        tribune: searchParams.tribunalId,
        competencia: searchParams.competencia,
        corteId: searchParams.corteId
      });
    } else {
      scrapResult = await scrapRawData({
        typeSearch: 'UNIFICADA',
        rol: fullRol,
        tribune: searchParams.tribunalId,
        competencia: searchParams.competencia,
        corteId: searchParams.corteId
      }, globalScrape);
    }
    
    // Comparar y obtener cambios usando la nueva función hasCaseChanged
    const changes = hasCaseChanged(existingCase, scrapResult);
    
    if (!changes.hasChanges) {
      logger.info(`📭 No hay cambios nuevos para causa ${fullRol}`);
      await Cases.findByIdAndUpdate(caseId, {
        'scrapedData.status': 'success',
        'scrapedData.lastScrapedAt': new Date(),
        'scrapedData.data': scrapResult,
        'scrapedData.errorMessage': null
      });
      return { success: true, updated: false, reason: 'no_changes', data: existingCase };
    }
    
    // Preparar datos de actualización
    const updateData = {
      'scrapedData.status': 'success',
      'scrapedData.lastScrapedAt': new Date(),
      'scrapedData.data': scrapResult,
      'scrapedData.errorMessage': null,
      'scrapedData.retryCount': 0
    };
    
    // Agregar SOLO movimientos nuevos al inicio del array
    if (changes.newMovementsCount > 0) {
      const newMovementsSorted = sortMovementsByDate(changes.newMovements);
      updateData['$push'] = {
        movementsHistory: { $each: newMovementsSorted, $position: 0 }
      };
      logger.info(`➕ Agregando ${changes.newMovementsCount} movimientos nuevos`);
    }
    
    // Actualizar litigantes si cambiaron
    if (changes.litigantsChanged) {
      updateData.litigants = scrapResult.litigants;
      logger.info(`👥 Litigantes actualizados`);
    }
    
    // Actualizar campos principales que cambiaron
    for (const field of changes.mainFieldsChanged) {
      if (scrapResult[field] !== undefined) {
        updateData[field] = scrapResult[field];
        logger.debug(`📝 Campo ${field} actualizado`);
      }
    }
    
    // Ejecutar actualización
    await Cases.findByIdAndUpdate(caseId, { $set: updateData });
    
    // Obtener la causa actualizada para notificaciones
    const updatedCase = await Cases.findById(caseId);
    
    // Enviar notificaciones
    await sendUpdateNotification(Users, updatedCase, changes);
    
    // Mantener sesión viva si se usa autenticación
    if (useAuthScraper) {
      await keepSessionAlive();
    }
    
    logger.info(`✅ Causa ${fullRol} actualizada correctamente con ${changes.newMovementsCount} nuevos movimientos`);
    
    return { 
      success: true, 
      updated: true, 
      newMovements: changes.newMovementsCount,
      litigantsChanged: changes.litigantsChanged,
      mainFieldsChanged: changes.mainFieldsChanged,
      data: updatedCase
    };
    
  } catch (error) {
    logger.error(`❌ Error actualizando causa ${fullRol}`, { error: error.message, stack: error.stack });
    
    await Cases.findByIdAndUpdate(caseId, {
      'scrapedData.status': 'error',
      'scrapedData.errorMessage': error.message,
      'scrapedData.retryCount': (existingCase.scrapedData?.retryCount || 0) + 1
    });
    
    return { success: false, error: error.message };
  }
}

// ========== CONSTRUIR EL OBJETO RESOLVERS ==========
const resolvers = {
  Query: {
    getCurrentUser: async (_, args, { Users, currentUser }) => gu(Users, currentUser),
    getUsers: async (_, args, { Users }) => {
      const usersResult = await Users.find({}, { password: false }).sort({ createdAt: 1 })
      return usersResult
    },
    getInvolvedUsers: async (_, { caseId }, { Users, InvolvedUsersCase }) => {
      try {
        const usersResult = await Users.find({}, { password: false }).sort({ createdAt: 1 })
        
        // Buscar el documento de InvolvedUsersCase para esta causa
        const usersInvResult = await InvolvedUsersCase.findOne(
          { case: caseId },
          'involved'
        ).populate('involved.userIn', '-password')
        
        // Si no existe documento, todos los usuarios están "SELECCIONE"
        const involvedList = usersInvResult?.involved || []
        
        let userInvArray = []
        usersResult.forEach(a => {
          const p = involvedList.find(
            b => b.userIn?._id.toString() === a._id.toString()
          )
          p
            ? userInvArray.push({ userIn: p.userIn, status: p.status })
            : userInvArray.push({ userIn: a, status: 'SELECCIONE' })
        })
        return userInvArray
      } catch (error) {
        console.error('❌ Error en getInvolvedUsers:', error)
        return []
      }
    },
    getUser: async (_, { userId }, { Users }) => {
      const user = await Users.findOne({ _id: userId }, { password: false })
      return user
    },
    /**
     * ✅ MODIFICADO: getCases ahora con paginación
     * Devuelve un objeto CasesPage con cases, total y hasMore
     */
    getCase: async (_, { id }, { Cases }) => {
	  const caseDoc = await Cases.findById(id).populate('createdBy', '-password')
	  if (!caseDoc) {
		throw new Error('Causa no encontrada')
	  }
	  return caseDoc
	},
    getCases: async (_, { limit = 20, offset = 0 }, { Cases }) => {
      try {
        console.log(`📊 getCases: limit=${limit}, offset=${offset}`);
        
        // Obtener total de causas
        const total = await Cases.countDocuments();
        
        // Obtener causas con paginación
        const cases = await Cases.find(
          {},
          '_id rol cover admission court stage debtor estAdmin processState typeSearch'
        )
        .skip(offset)
        .limit(limit)
        .populate('createdBy', '-password')
        .sort({ createdAt: -1 }); // ✅ Más recientes primero
        
        const hasMore = offset + limit < total;
        
        console.log(`📊 getCases: ${cases.length} causas de ${total} total, hasMore: ${hasMore}`);
        
        return {
          cases,
          total,
          hasMore
        };
        
      } catch (error) {
        console.error('❌ Error en getCases:', error);
        return {
          cases: [],
          total: 0,
          hasMore: false
        };
      }
    },
    /**
     * ✅ NUEVO: Obtener el total de causas (para el contador)
     */
    getCasesCount: async (_, args, { Cases }) => {
      try {
        return await Cases.countDocuments();
      } catch (error) {
        console.error('❌ Error en getCasesCount:', error);
        return 0;
      }
    },
    getCaseViewed: async (_, args, { Users, CasesViewed, currentUser }) => {
      const user = await Users.findOne({ email: currentUser.email }, { _id: 1 })
      const cc = await CasesViewed.find(
        { viewedBy: user._id },
        'caseBankruptcy viewedBy'
      ).populate([
        { path: 'caseBankruptcy' },
        {
          path: 'viewedBy',
          select: '_id name email avatar'
        }
      ])
      return cc
    },
    getCasesByUser: async (_, { userId }, { Cases }) => {
      const cc = await Cases.find(
        { createdBy: userId },
        '_id rol cover admission court stage debtor'
      ).populate('createdBy')
      return cc
    },
    getUserUnreadMessages: async (_, { userId }, { Messages }) => {
      const userMessages = await Messages.find({
        to: userId,
        status: false
      }).populate('to', '-password')
      return userMessages
    },
    getUserMessages: async (_, { userId }, { Messages }) => {
      const userMessages = await Messages.find({ to: userId }).populate(
        'to',
        '-password'
      )
      return userMessages
    },
    searchMovements: async (_, { input: { searchTerm } }, { Cases }) => {
      const searchResult = await Cases.find(
        { $text: { $search: `${searchTerm}` } },
        { score: { $meta: 'textScore' } }
      )
        .sort({
          score: { $meta: 'textScore' }
        })
        .limit(5)
      console.log('searchResult')
      console.log(searchResult)
      return searchResult
    },
    searchUsers: async (_, { searchTerm }, { Users }) => {
      if (searchTerm) {
        const searchResult = await Users.find(
          {
            $or: [
              { username: searchTerm },
              { name: searchTerm },
              { card: searchTerm }
            ]
          },
          'name username'
        )
        return searchResult
      }
    },
    infiniteScrollPosts: async (_, { pageNum, pageSize }, { Posts }) => {
      let posts
      if (pageNum === 1) {
        posts = await Posts.find({})
          .sort({ createdDate: 'desc' })
          .populate({
            path: 'createdBy',
            model: 'Users'
          })
          .limit(pageSize)
      } else {
        const skips = pageSize * (pageNum - 1)
        posts = await Posts.find({})
          .sort({ createdDate: 'desc' })
          .populate({
            path: 'createdBy',
            model: 'Users'
          })
          .skip(skips)
          .limit(pageSize)
      }
      const totalDocs = await Posts.countDocuments()
      const hasMore = totalDocs > pageSize * pageNum
      return { posts, hasMore }
    },
    getChecksOfDate: async (_, { day, month, year }, { Checks, Users }) => {
      if (day === null && month === null && year === null) {
        let date = new Date()
        day = date.getDate()
        month = date.getMonth() + 1
        year = date.getFullYear()
      }
      const checksws = Checks.aggregate([
        {
          $lookup: {
            from: 'users',
            localField: 'user',
            foreignField: '_id',
            as: 'fullUser'
          }
        },
        {
          $redact: {
            $cond: [
              {
                $and: [
                  { $eq: [{ $dayOfMonth: '$checkDate' }, day] },
                  { $eq: [{ $month: '$checkDate' }, month] },
                  { $eq: [{ $year: '$checkDate' }, year] }
                ]
              },
              '$$KEEP',
              '$$PRUNE'
            ]
          }
        }
      ])
      return checksws
    },
    getChecksOfUsers: async (_, { id, month, year }, { Checks }) => {
      if (year === null && month === null) {
        const date = new Date()
        month = date.getMonth() + 1
        year = date.getFullYear()
      }
      const checksws = await Checks.aggregate([
        {
          $project: {
            _id: 1,
            user: 1,
            month: { $month: '$checkDate' },
            year: { $year: '$checkDate' },
            section: 1,
            checkDate: 1,
            affectations: 1,
            Observations: 1
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'user',
            foreignField: '_id',
            as: 'fullUser'
          }
        },
        {
          $match: {
            $and: [
              { user: new mongoose.Types.ObjectId(id) },
              { month: Number(month) },
              { year: Number(year) }
            ]
          }
        },
        {
          $project: {
            _id: 1,
            fullUser: 1,
            section: 1,
            checkDate: 1,
            affectations: 1,
            Observations: 1
          }
        },
        {
          $sort: {
            checkDate: 1
          }
        }
      ])
      checksws.map(i => {
        return (i.fullUser = i.fullUser[0])
      })
      return checksws
    },
    getDateOfChecks: async (_, args, { Checks }) => {
      const docsColection = await Checks.aggregate([
        {
          $project: {
            user: 1,
            checkDate: 1,
            day: { $dayOfMonth: '$checkDate' },
            month: { $month: '$checkDate' },
            year: { $year: '$checkDate' }
          }
        },
        {
          $sort: {
            day: 1
          }
        },
        {
          $group: {
            _id: {
              day: { $dayOfMonth: '$checkDate' },
              month: { $month: '$checkDate' },
              year: { $year: '$checkDate' }
            }
          }
        }
      ])
      const checksws = []
      docsColection.forEach(i => {
        checksws.push({
          day: i._id.day,
          month: i._id.month,
          year: i._id.year
        })
      })
      return checksws
    },
    getCasesInfo: async (_, args, { CasesViewed, Users, currentUser }) => {
      const user = await gu(Users, currentUser)
      const docsColection = await CasesViewed.aggregate([
        {
          $project: {
            viewedBy: 1,
            caseBankruptcy: 1
          }
        },
        {
          $lookup: {
            from: 'cases',
            localField: 'caseBankruptcy',
            foreignField: '_id',
            as: 'caseBankruptcyFull'
          }
        },
        {
          $match: { viewedBy: new mongoose.Types.ObjectId(user._id) }
        },
        {
          $project: {
            viewedBy: 1,
            caseBankruptcy: 1,
            'caseBankruptcyFull.status': 1
          }
        },
        {
          $group: { _id: '$caseBankruptcyFull.status', count: { $sum: 1 } }
        }
      ])
      let rawArr = {}
      docsColection.forEach(e => (rawArr[e._id] = e.count))
      return rawArr
    },
    getCasesInfoAdmin: async (_, args, { Cases }) => {
      const docsColection = await Cases.aggregate([
        {
          $group: { _id: '$status', count: { $sum: 1 } }
        }
      ])
      let rawArr = {}
      docsColection.forEach(e => (rawArr[e._id] = e.count))
      return rawArr
    },
    getPriorities: async (_, args, { Priority }) => {
      const priorities = await Priority.find({})
      return priorities
    },
    getActivities: async (_, args, { Activity }) => {
      const rawActivities = await Activity.find({}).populate([
        { path: 'priority' },
        { path: 'caseId', select: '_id cover rol court' },
        { path: 'createdBy', select: '_id name' }
      ])
      const activities = rawActivities.map(e => {
        const startTime = moment(new Date(Number(e.startTime)))
        const endTime = moment(new Date(Number(e.endTime)))
        return {
          _id: e.id,
          name: e.name,
          priority: e.priority,
          caseId: e.caseId,
          startTime,
          endTime,
          createdBy: e.createdBy
        }
      })
      return activities
    },
    getActivitiesByDate: async (_, { days }, { Activity }) => {
      const dd = Date.now()
      const gte = DateTime.fromMillis(dd).toISODate()
      const lte = DateTime.fromMillis(dd).plus({ days }).toISODate()
      const cDocsUpdate = await Activity.find(
        {
          $and: [
            {
              startTime: { $gte: new Date(gte) }
            },
            {
              startTime: { $lt: new Date(lte) }
            }
          ]
        },
        null
      ).populate([
        { path: 'priority' },
        { path: 'caseId', select: '_id cover rol court' },
        { path: 'createdBy', select: '_id name' }
      ])
      const activities = cDocsUpdate.map(e => {
        const startTime = moment(new Date(Number(e.startTime)))
        const endTime = moment(new Date(Number(e.endTime)))
        return {
          _id: e.id,
          name: e.name,
          priority: e.priority,
          caseId: e.caseId,
          startTime: startTime,
          endTime: endTime,
          createdBy: e.createdBy
        }
      })
      return activities
    },
    getProcessStatus: async (_, { processId }, { ProcessStatus }) => {
      try {
        const status = await ProcessStatus.findById(processId)
        
        if (!status) {
          return null
        }
        
        return {
          _id: status._id,
          caseId: status.caseId,
          status: status.status,
          startedAt: status.startedAt ? status.startedAt.toISOString() : null,
          completedAt: status.completedAt ? status.completedAt.toISOString() : null,
          errorMessage: status.errorMessage,
          summary: status.summary || { newMovements: 0, litigantsChanged: false, mainFieldsChanged: [] }
        }
      } catch (error) {
        console.error('❌ Error en getProcessStatus:', error)
        return null
      }
    }
  },
  
  Upload: GraphQLUpload,
  
  Mutation: {
    updateUser: async (_, { userId, name, username, service, card, role }, { Users }) => {
      const checkUser = await Users.findOne({ $or: [{ username }, { card }] })
      if (checkUser && checkUser._id.toString() !== userId.toString()) {
        throw new Error('El usuario o la tarjeta estan en uso')
      }
      const user = await Users.findOneAndUpdate(
        { _id: userId },
        { $set: { userId, name, username, service, card, role } },
        { new: true }
      )
      console.log(user)
      return user
    },
    updateUsers: async (_, { input }, { Users }) => {
      const { userId, email } = input
      const userID = new mongoose.Types.ObjectId(userId)
      const checkUser = await Users.findOne({ email: email })
      if (checkUser && checkUser._id.toString() !== userId.toString()) {
        throw new Error('El usuario esta en uso')
      }
      await Users.findOneAndUpdate(
        { _id: userID },
        {
          $set: {
            ...input
          }
        },
        { new: true }
      )
      return {
        messageBody: 'El usuario de actualizo de manera satisfactoria',
        messageType: 'is-primary',
        messageImage: null
      }
    },
    updateUserPassword: async (_, { params: { userId, currentPassword, password } }, { Users }) => {
      const userID = new mongoose.Types.ObjectId(userId)
      const checkUser = await Users.findById({ _id: userID })
      const isMatch = await checkUser.comparePassword(currentPassword)
      if (!isMatch) {
        throw new Error('La contraseña anterior es incorrecta')
      }
      await Users.findOneAndUpdate(
        { _id: userID },
        { $set: { userID, password } },
        { new: true }
      )
      return {
        messageBody: 'La contraseña se cambio de manera satisfactoria',
        messageType: 'is-primary',
        messageImage: null
      }
    },
    updateUsersPassword: async (_, { input: { userId, password } }, { Users }) => {
      const userID = new mongoose.Types.ObjectId(userId)
      await Users.findOneAndUpdate(
        { _id: userID },
        { $set: { userID, password } },
        { new: true }
      )
      return {
        messageBody: 'La contraseña se cambio de manera satisfactoria',
        messageType: 'is-primary',
        messageImage: null
      }
    },
    deleteUserPost: async (_, { postId }, { Posts }) => {
      const post = await Posts.findOneAndRemove({
        _id: postId
      })
      return post
    },
    deleteUser: async (_, { userId }, { Users }) => {
      await Users.findOneAndRemove({
        _id: userId
      })
      return {
        messageBody: 'El usuario fue eliminado de manera satisfactoria',
        messageType: 'is-primary',
        messageImage: null
      }
    },
    deleteCase: async (_, { caseId }, { Cases, InvolvedUsersCase, CasesViewed, CasesUpdated }) => {
	  try {
		console.log(`🗑️ Eliminando causa: ${caseId}`);
		
		// ✅ 1. Verificar que la causa existe
		const existingCase = await Cases.findById(caseId);
		if (!existingCase) {
		  console.warn(`⚠️ Causa no encontrada: ${caseId}`);
		  return {
			messageBody: 'La causa no existe en el sistema',
			messageType: 'is-warning',
			messageImage: null
		  };
		}
		
		// ✅ 2. Eliminar de Cases (principal)
		await Cases.findOneAndDelete({ _id: caseId });
		console.log(`✅ Causa eliminada de Cases: ${caseId}`);
		
		// ✅ 3. Eliminar de CasesViewed (vistas)
		await CasesViewed.findOneAndDelete({ caseBankruptcy: caseId });
		console.log(`✅ Eliminado de CasesViewed: ${caseId}`);
		
		// ✅ 4. Eliminar de InvolvedUsersCase (usuarios involucrados)
		await InvolvedUsersCase.findOneAndDelete({ case: caseId });
		console.log(`✅ Eliminado de InvolvedUsersCase: ${caseId}`);
		
		// ✅ 5. Eliminar de CasesUpdated (datos del scraper) - con manejo de error
		try {
		  const result = await CasesUpdated.findOneAndDelete({ caseId: caseId });
		  if (result) {
			console.log(`✅ Eliminado de CasesUpdated: ${caseId}`);
		  } else {
			console.log(`ℹ️ No había registro en CasesUpdated para: ${caseId}`);
		  }
		} catch (updatedError) {
		  // Si el modelo no existe o hay error, solo loguear y continuar
		  console.warn(`⚠️ Error eliminando de CasesUpdated: ${updatedError.message}`);
		}
		
		// ✅ 6. También eliminar de ProcessStatus si existe
		try {
		  const ProcessStatus = require('./models/ProcessStatus');
		  await ProcessStatus.findOneAndDelete({ caseId: caseId });
		  console.log(`✅ Eliminado de ProcessStatus: ${caseId}`);
		} catch (processError) {
		  console.warn(`⚠️ Error eliminando de ProcessStatus: ${processError.message}`);
		}
		
		// ✅ 7. También eliminar de CasesReviews si existe
		try {
		  const CasesReviews = require('./models/CasesReviews');
		  await CasesReviews.findOneAndDelete({ caseId: caseId });
		  console.log(`✅ Eliminado de CasesReviews: ${caseId}`);
		} catch (reviewError) {
		  console.warn(`⚠️ Error eliminando de CasesReviews: ${reviewError.message}`);
		}
		
		// ✅ 8. También eliminar de CasesLogs si existe
		try {
		  const CasesLogs = require('./models/CasesLogs');
		  await CasesLogs.findOneAndDelete({ caseId: caseId });
		  console.log(`✅ Eliminado de CasesLogs: ${caseId}`);
		} catch (logError) {
		  console.warn(`⚠️ Error eliminando de CasesLogs: ${logError.message}`);
		}
		
		return {
		  messageBody: 'La causa fue eliminada de manera satisfactoria',
		  messageType: 'is-primary',
		  messageImage: null
		};
		
	  } catch (error) {
		console.error(`❌ Error eliminando causa ${caseId}:`, error.message);
		console.error(error.stack);
		
		return {
		  messageBody: `Error al eliminar la causa: ${error.message}`,
		  messageType: 'is-danger',
		  messageImage: null
		};
	  }
	},
    deleteActivity: async (_, { id }, { Activity }) => {
      try {
        await Activity.findOneAndRemove({
          _id: id
        })
        return {
          messageBody: 'La actividad fue eliminada de manera satisfactoria',
          messageType: 'is-primary',
          messageImage: null
        }
      } catch (error) {
        console.log(error)
      }
    },
    addPostMessage: async (_, { messageBody, userId, postId }, { Posts }) => {
      const newMessage = {
        messageBody,
        messageUser: userId
      }
      const post = await Posts.findOneAndUpdate(
        { _id: postId },
        { $push: { message: { $each: [newMessage], $position: 0 } } },
        { new: true }
      ).populate({
        path: 'message.messageUser',
        model: 'Users'
      })
      return post.message[0]
    },
    signinUsers: async (_, { email, password }, { Users }) => {
      const user = await Users.findOne({ email })
      if (!user) {
        throw new AuthenticationError('El usuario no existe')
      }
      const isValidPassword = await bcrypt.compare(password, user.password)
      console.log(isValidPassword)
      if (!isValidPassword) {
        throw new AuthenticationError('La contraseña es incorrecta')
      }
      return { token: createToken(user, process.env.SECRET, '1hr') }
    },
    signupUsers: async (_, { params }, { Users }) => {
      const user = await Users.findOne({ email: params.email })
      if (user) {
        throw new Error('La cuenta de correo existe')
      }
      console.table({ params })
      await new Users({
        ...params
      }).save()
      return {
        messageBody: 'El usuario se creo de manera satifastoria',
        messageType: 'is-primary',
        messageImage: null
      }
    },
    
    /**
     * ADD CASE - MODIFICADO para soportar múltiples causas
     * Ahora puede recibir un array de causas o una sola
     */
    addCase: async (
      _,
      { input, causes },
      { Users, Cases, InvolvedUsersCase, CasesReviews, CasesLogs }
    ) => {
      try {
        const causesToProcess = causes || [input];
        
        if (!causesToProcess || causesToProcess.length === 0) {
          return {
            messageBody: 'No se proporcionaron causas para agregar',
            messageType: 'is-danger',
            messageImage: null
          };
        }
        
        // Para batch, usar el nuevo scrapMultipleCauses
        if (causesToProcess.length > 1) {
          logger.info(`📋 Procesando lote de ${causesToProcess.length} causas...`);
          
          const scraperCauses = causesToProcess.map(c => ({
            fullRol: `${c.libroTipo}-${c.rolNumber}-${c.year}`,
            tribunalId: c.tribunalId,
            competencia: c.competencia,
            corteId: c.corteId,
            libroTipo: c.libroTipo,
            rolNumber: c.rolNumber,
            year: c.year,
            typeSearch: c.typeSearch || 'UNIFICADA'
          }));
          
          const scrapResults = await scrapMultipleCauses(scraperCauses, {
            continueOnError: true,
            delayBetweenCauses: 2000
          });
          
          const savedResults = [];
          for (let i = 0; i < scrapResults.length; i++) {
            const scrapResult = scrapResults[i];
            const causeInput = causesToProcess[i];
            
            if (scrapResult.status === 'success' && scrapResult.data) {
              const tribunalName = courtNameById(causeInput.tribunalId);
              const fullRol = `${causeInput.libroTipo}-${causeInput.rolNumber}-${causeInput.year}`;
              
              const existingCase = await Cases.findOne({
                rol: fullRol,
                court: tribunalName
              });
              
              if (existingCase) {
                savedResults.push({ rol: fullRol, status: 'already_exists' });
                continue;
              }
              
              const caseData = {
                ...scrapResult.data,
                rol: fullRol,
                court: tribunalName,
                createdBy: new mongoose.Types.ObjectId(causeInput.createdBy),
                typeSearch: causeInput.typeSearch || 'UNIFICADA',
                status: 'ACTIVE',
                searchParams: {
                  competencia: causeInput.competencia,
                  corteId: causeInput.corteId,
                  tribunalId: causeInput.tribunalId,
                  libroTipo: causeInput.libroTipo,
                  rolNumber: causeInput.rolNumber,
                  year: causeInput.year,
                  fullRol: fullRol
                },
                scrapedData: {
                  lastScrapedAt: new Date(),
                  lastScrapedBy: 'manual',
                  status: 'success',
                  errorMessage: null,
                  retryCount: 0,
                  data: scrapResult.data
                }
              };
              
              const newCase = await new Cases(caseData).save();
              
              // ✅ Registrar en CasesLogs (auditoría de creación)
              try {
                await CasesLogs.create({
                  caseId: newCase._id,
                  accesedBy: causeInput.createdBy,
                  action: 'CREATE',
                  details: `Causa ${fullRol} creada por usuario`
                });
              } catch (logError) {
                console.warn('⚠️ Error registrando en CasesLogs:', logError.message);
              }
              
              if (causeInput.involved && causeInput.involved.length > 0) {
                const userInvolved = causeInput.involved.map(a => ({
                  status: 'COOPERADOR',
                  notification: false,
                  userIn: new mongoose.Types.ObjectId(a._id)
                }));
                await new InvolvedUsersCase({
                  case: newCase._id,
                  involved: userInvolved
                }).save();
              }
              
              // ✅ Registrar en CasesReviews
              try {
                await CasesReviews.create({
                  caseId: newCase._id,
                  reviewedBy: causeInput.createdBy,
                  reviewType: 'MANUAL',
                  status: 'COMPLETED',
                  currentData: {
                    cover: scrapResult.data.cover,
                    stage: scrapResult.data.stage,
                    movementsCount: scrapResult.data.movementsHistory?.length || 0,
                    litigantsCount: scrapResult.data.litigants?.length || 0
                  }
                });
              } catch (reviewError) {
                console.warn('⚠️ Error registrando en CasesReviews:', reviewError.message);
              }
              
              savedResults.push({ rol: fullRol, status: 'success', id: newCase._id });
              
            } else {
              savedResults.push({ 
                rol: `${causeInput.libroTipo}-${causeInput.rolNumber}-${causeInput.year}`, 
                status: 'error', 
                error: scrapResult.error 
              });
            }
          }
          
          const users = await Users.find({}, 'email name');
          const successfulCases = savedResults.filter(r => r.status === 'success');
          
          for (const user of users) {
            for (const savedCase of successfulCases) {
              const mailOptions = {
                from: config.from,
                to: user.email,
                subject: 'Nuevas Causas Agregadas',
                html: `<h3>Se agregaron ${successfulCases.length} nuevas causas al sistema</h3>
                       <p>Las siguientes causas fueron importadas:</p>
                       <ul>${successfulCases.map(c => `<li>${c.rol}</li>`).join('')}</ul>`
              };
              abstractSendMail(mailOptions);
            }
          }
          
          const successCount = savedResults.filter(r => r.status === 'success').length;
          
          return {
            messageBody: `Se procesaron ${causesToProcess.length} causas. Éxitos: ${successCount}, Fallos: ${causesToProcess.length - successCount}`,
            messageType: successCount > 0 ? 'is-primary' : 'is-danger',
            messageImage: null,
            results: savedResults
          };
        }
        
        // === PROCESAMIENTO INDIVIDUAL ===
        const { 
          libroTipo, 
          rolNumber, 
          year, 
          competencia, 
          corteId, 
          tribunalId,
          typeSearch = 'UNIFICADA',
          createdBy,
          involved = []
        } = input;
        
        const fullRol = `${libroTipo}-${rolNumber}-${year}`;
        const tribunalName = courtNameById(tribunalId);
        
        logger.info('📋 Creando nueva causa:', { fullRol, competencia, corteId, tribunalId, tribunalName });
        
        const existingCase = await Cases.findOne({
          rol: fullRol,
          court: tribunalName
        });
        
        if (existingCase) {
          return {
            messageBody: 'La causa existe en el sistema',
            messageType: 'is-danger',
            messageImage: null
          };
        }
        
        const scrapeInstance = await initGlobalScrape();
        
        let scrapData = null;
        try {
          logger.info('🕷️ Ejecutando scraper para obtener datos...');
          
          if (useAuthScraper) {
            scrapData = await scrapRawDataAuth({
              rol: fullRol,
              tribune: tribunalId,
              competencia: competencia,
              corteId: corteId
            });
          } else {
            scrapData = await scrapRawData({
              typeSearch,
              rol: fullRol,
              tribune: tribunalId,
              competencia: competencia,
              corteId: corteId
            }, scrapeInstance);
          }
          
          logger.info('✅ Scraper completado exitosamente');
        } catch (scraperError) {
          logger.error('⚠️ Error en scraper (continuando con causa vacía):', { error: scraperError.message });
        }
        
        const caseData = {
          ...(scrapData || {}),
          rol: fullRol,
          court: tribunalName,
          createdBy: new mongoose.Types.ObjectId(createdBy),
          typeSearch: typeSearch,
          status: 'ACTIVE',
          searchParams: {
            competencia: competencia,
            corteId: corteId,
            tribunalId: tribunalId,
            libroTipo: libroTipo,
            rolNumber: rolNumber,
            year: year,
            fullRol: fullRol
          },
          scrapedData: {
            lastScrapedAt: scrapData ? new Date() : null,
            lastScrapedBy: 'manual',
            status: scrapData ? 'success' : 'pending',
            errorMessage: scrapData ? null : 'Scraping inicial falló, pendiente de reintento',
            retryCount: 0,
            data: scrapData || null
          }
        };
        
        const newCase = await new Cases(caseData).save();
        
        // ✅ Registrar en CasesLogs (auditoría de creación)
        try {
          await CasesLogs.create({
            caseId: newCase._id,
            accesedBy: createdBy,
            action: 'CREATE',
            details: `Causa ${fullRol} creada por usuario`
          });
        } catch (logError) {
          console.warn('⚠️ Error registrando en CasesLogs:', logError.message);
        }
        
        if (involved && involved.length > 0) {
          const userInvolved = involved.map(a => ({
            status: 'COOPERADOR',
            notification: false,
            userIn: new mongoose.Types.ObjectId(a._id)
          }));
          await new InvolvedUsersCase({
            case: newCase._id,
            involved: userInvolved
          }).save();
        }
        
        // ✅ Registrar en CasesReviews
        try {
          await CasesReviews.create({
            caseId: newCase._id,
            reviewedBy: createdBy,
            reviewType: 'MANUAL',
            status: 'COMPLETED',
            currentData: {
              cover: scrapData?.cover || null,
              stage: scrapData?.stage || null,
              movementsCount: scrapData?.movementsHistory?.length || 0,
              litigantsCount: scrapData?.litigants?.length || 0
            }
          });
        } catch (reviewError) {
          console.warn('⚠️ Error registrando en CasesReviews:', reviewError.message);
        }
        
        const users = await Users.find({}, 'email name');
        for (const user of users) {
          if (user._id.toString() !== newCase.createdBy.toString()) {
            const mailOptions = {
              from: config.from,
              to: user.email,
              subject: 'Nueva Causa Agregada',
              html: await addNewCause({
                name: user.name,
                cause: newCase
              })
            };
            abstractSendMail(mailOptions);
          }
        }
        
        return {
          messageBody: 'La causa se importó de manera satisfactoria',
          messageType: 'is-primary',
          messageImage: null
        };
        
      } catch (error) {
        logger.error('❌ Error en addCase:', { error: error.message, stack: error.stack });
        return {
          messageBody: 'El servidor no está respondiendo bien, intente en unos minutos',
          messageType: 'is-danger',
          messageImage: null
        };
      }
    },
    
    /**
     * NUEVA MUTATION: Actualizar múltiples causas existentes
     */
    updateMultipleCases: async (
      _,
      { cases },
      { Cases, Users }
    ) => {
      try {
        if (!cases || cases.length === 0) {
          return {
            messageBody: 'No se proporcionaron causas para actualizar',
            messageType: 'is-danger',
            messageImage: null
          };
        }
        
        logger.info(`🔄 Actualizando lote de ${cases.length} causas...`);
        
        const results = [];
        
        for (const caseItem of cases) {
          const { caseId, fullRol, searchParams } = caseItem;
          
          const existingCase = await Cases.findById(caseId);
          if (!existingCase) {
            results.push({ caseId, fullRol, status: 'not_found', error: 'Causa no encontrada' });
            continue;
          }
          
          const updateResult = await updateCaseIfNeeded(caseId, fullRol, searchParams, { Cases, Users });
          
          results.push({
            caseId,
            fullRol,
            status: updateResult.success ? 'success' : 'error',
            updated: updateResult.updated,
            newMovements: updateResult.newMovements || 0,
            error: updateResult.error
          });
        }
        
        const successCount = results.filter(r => r.status === 'success').length;
        
        return {
          messageBody: `Se procesaron ${cases.length} causas. Éxitos: ${successCount}, Fallos: ${cases.length - successCount}`,
          messageType: successCount > 0 ? 'is-primary' : 'is-danger',
          messageImage: null,
          results
        };
        
      } catch (error) {
        logger.error('❌ Error en updateMultipleCases:', error);
        return {
          messageBody: 'Error actualizando múltiples causas',
          messageType: 'is-danger',
          messageImage: null
        };
      }
    },
    
    /**
     * NUEVA MUTATION: Scraping batch de nuevas causas
     */
    scrapeMultipleNewCases: async (
      _,
      { causes, createdBy },
      { Cases, Users, InvolvedUsersCase, CasesReviews, CasesLogs }
    ) => {
      try {
        if (!causes || causes.length === 0) {
          return {
            messageBody: 'No se proporcionaron causas para procesar',
            messageType: 'is-danger',
            messageImage: null
          };
        }
        
        const scraperCauses = causes.map(c => ({
          fullRol: `${c.libroTipo}-${c.rolNumber}-${c.year}`,
          tribunalId: c.tribunalId,
          competencia: c.competencia,
          corteId: c.corteId,
          libroTipo: c.libroTipo,
          rolNumber: c.rolNumber,
          year: c.year,
          typeSearch: c.typeSearch || 'UNIFICADA'
        }));
        
        const scrapResults = await scrapMultipleCauses(scraperCauses, {
          continueOnError: true,
          delayBetweenCauses: 2000
        });
        
        const savedCases = [];
        
        for (let i = 0; i < scrapResults.length; i++) {
          const scrapResult = scrapResults[i];
          const causeInput = causes[i];
          
          if (scrapResult.status === 'success' && scrapResult.data) {
            const tribunalName = courtNameById(causeInput.tribunalId);
            const fullRol = `${causeInput.libroTipo}-${causeInput.rolNumber}-${causeInput.year}`;
            
            const existing = await Cases.findOne({ rol: fullRol });
            if (existing) {
              savedCases.push({ rol: fullRol, status: 'already_exists', id: existing._id });
              continue;
            }
            
            const caseData = {
              ...scrapResult.data,
              rol: fullRol,
              court: tribunalName,
              createdBy: new mongoose.Types.ObjectId(createdBy),
              typeSearch: causeInput.typeSearch || 'UNIFICADA',
              status: 'ACTIVE',
              searchParams: {
                competencia: causeInput.competencia,
                corteId: causeInput.corteId,
                tribunalId: causeInput.tribunalId,
                libroTipo: causeInput.libroTipo,
                rolNumber: causeInput.rolNumber,
                year: causeInput.year,
                fullRol: fullRol
              },
              scrapedData: {
                lastScrapedAt: new Date(),
                lastScrapedBy: 'manual',
                status: 'success',
                errorMessage: null,
                retryCount: 0,
                data: scrapResult.data
              }
            };
            
            const newCase = await new Cases(caseData).save();
            
            if (causeInput.involved && causeInput.involved.length > 0) {
              const userInvolved = causeInput.involved.map(a => ({
                status: 'COOPERADOR',
                notification: false,
                userIn: new mongoose.Types.ObjectId(a._id)
              }));
              await new InvolvedUsersCase({
                case: newCase._id,
                involved: userInvolved
              }).save();
            }
            
            // ✅ Registrar en CasesLogs (auditoría de creación)
            try {
              await CasesLogs.create({
                caseId: newCase._id,
                accesedBy: createdBy,
                action: 'CREATE',
                details: `Causa ${fullRol} creada por usuario (batch)`
              });
            } catch (logError) {
              console.warn('⚠️ Error registrando en CasesLogs:', logError.message);
            }
            
            // ✅ Registrar en CasesReviews
            try {
              await CasesReviews.create({
                caseId: newCase._id,
                reviewedBy: createdBy,
                reviewType: 'MANUAL',
                status: 'COMPLETED',
                currentData: {
                  cover: scrapResult.data.cover,
                  stage: scrapResult.data.stage,
                  movementsCount: scrapResult.data.movementsHistory?.length || 0,
                  litigantsCount: scrapResult.data.litigants?.length || 0
                }
              });
            } catch (reviewError) {
              console.warn('⚠️ Error registrando en CasesReviews:', reviewError.message);
            }
            
            savedCases.push({ rol: fullRol, status: 'success', id: newCase._id });
          } else {
            savedCases.push({
              rol: `${causeInput.libroTipo}-${causeInput.rolNumber}-${causeInput.year}`,
              status: 'error',
              error: scrapResult.error
            });
          }
        }
        
        const successCount = savedCases.filter(s => s.status === 'success').length;
        
        const users = await Users.find({}, 'email name');
        for (const user of users) {
          if (user._id.toString() !== createdBy) {
            const mailOptions = {
              from: config.from,
              to: user.email,
              subject: `Nuevas Causas Agregadas (${successCount})`,
              html: `<h3>Se agregaron ${successCount} nuevas causas al sistema</h3>
                     <p>Las siguientes causas fueron importadas:</p>
                     <ul>${savedCases.filter(s => s.status === 'success').map(c => `<li>${c.rol}</li>`).join('')}</ul>`
            };
            abstractSendMail(mailOptions);
          }
        }
        
        return {
          messageBody: `Se procesaron ${causes.length} causas. Éxitos: ${successCount}`,
          messageType: successCount > 0 ? 'is-primary' : 'is-danger',
          messageImage: null,
          results: savedCases
        };
        
      } catch (error) {
        logger.error('❌ Error en scrapeMultipleNewCases:', error);
        return {
          messageBody: 'Error procesando múltiples causas',
          messageType: 'is-danger',
          messageImage: null
        };
      }
    },
    
    updateCase: async (_, { input }, { Cases, CasesUpdated, CasesReviews, CasesLogs, ProcessStatus, Users }) => {
      console.log('🔴🔴🔴 MUTATION UPDATE CASE RECIBIDA 🔴🔴🔴')
      console.log('Input recibido:', JSON.stringify(input, null, 2))
      
      try {
        // 1. Verificar que la causa existe
        const existingCase = await Cases.findOne({
          rol: input.rol,
          court: input.court
        })
        
        if (!existingCase) {
          return {
            messageBody: 'No se encontró la causa para actualizar',
            messageType: 'is-danger',
            messageImage: null,
            success: false
          }
        }

        // 2. Verificar si ya hay un proceso en curso para esta causa
        const existingProcess = await ProcessStatus.findOne({
          caseId: existingCase._id,
          status: 'processing'
        })
        
        if (existingProcess) {
          return {
            messageBody: '⚠️ Ya hay una actualización en curso para esta causa. Por favor espera.',
            messageType: 'is-warning',
            messageImage: null,
            processId: existingProcess._id.toString(),
            success: false
          }
        }
        
        // 3. Obtener el tribunalId, competencia, corteId de la causa
        const tribunalId = existingCase.searchParams?.tribunalId
        const competencia = existingCase.searchParams?.competencia
        const corteId = existingCase.searchParams?.corteId
        
        if (!tribunalId || !competencia || !corteId) {
          logger.warn('⚠️ La causa no tiene searchParams completos, no se puede actualizar')
          return {
            messageBody: 'No se pueden actualizar los datos porque faltan parámetros de búsqueda',
            messageType: 'is-warning',
            messageImage: null,
            success: false
          }
        }
        
        // 4. Obtener el userId del input (si no viene, usar el creador de la causa)
        const userId = input.userId || existingCase.createdBy
        
        // 5. Crear registro de proceso
        const processId = new mongoose.Types.ObjectId()
        await ProcessStatus.create({
          _id: processId,
          caseId: existingCase._id,
          userId: userId,
          status: 'processing',
          startedAt: new Date()
        })
        
        // ✅ 6. Registrar en CasesLogs (auditoría de inicio de scraping)
        try {
          const user = await Users.findById(userId);
          await CasesLogs.create({
            caseId: existingCase._id,
            accesedBy: userId,
            action: 'SCRAPE',
            details: `Usuario ${user?.name || 'Sistema'} inició scraping de la causa ${existingCase.rol}`
          });
        } catch (logError) {
          console.warn('⚠️ Error registrando en CasesLogs:', logError.message);
        }
        
        // 7. INICIAR SCRAPER EN BACKGROUND (SIN await para no bloquear)
        startScrapingProcess(
          processId,
          existingCase._id,
          input,
          { 
            Cases, 
            CasesUpdated, 
            CasesReviews, 
            CasesLogs,
            ProcessStatus, 
            Users, 
            useAuthScraper, 
            keepSessionAlive 
          }
        ).catch(async (fatalError) => {
          // Red de seguridad: si algo se escapa del try/catch interno de
          // startScrapingProcess, esto evita que tumbe el proceso de Node entero.
          console.error(`💥 [Process ${processId}] Error FATAL no controlado:`, fatalError)
          logger.error('Error fatal no controlado en startScrapingProcess', {
            processId,
            caseId: existingCase._id,
            error: fatalError.message,
            stack: fatalError.stack
          })

          try {
            await ProcessStatus.findByIdAndUpdate(processId, {
              status: 'error',
              errorMessage: 'Error interno inesperado. Contacta al administrador.',
              completedAt: new Date()
            })
          } catch (dbError) {
            console.error('💥 No se pudo ni actualizar ProcessStatus tras el error fatal:', dbError)
          }
        })
        
        // 8. RESPONDER INMEDIATAMENTE
        return {
          messageBody: '🔄 Procesando actualización... Te notificaremos cuando termine',
          messageType: 'is-info',
          messageImage: null,
          processId: processId.toString(),
          success: true
        }
        
      } catch (error) {
        logger.error('❌ Error en updateCase:', { error: error.message, stack: error.stack })
        console.error('❌ Error en updateCase:', error)
        return {
          messageBody: 'Error al iniciar el proceso de actualización',
          messageType: 'is-danger',
          messageImage: null,
          success: false
        }
      }
    },
    
    addInvUsers: async (_, { input }, { InvolvedUsersCase, Users, Cases, Messages }) => {
      try {
        const updtInvUsers = await InvolvedUsersCase.findOneAndUpdate(
          { case: input.caseId },
          { $set: { involved: input.invUsers } },
          { new: true, upsert: true }
        )
        
        input.invUsers.forEach(async e => {
          const userCase = await Cases.findById(input.caseId, '_id createdBy')
          const userToSend = await Users.findById(
            e.userIn._id,
            '_id name email'
          )
          const userPropietary = await Users.findById(
            userCase.createdBy,
            'name'
          )
          const po = updtInvUsers.involved.filter(
            a => a.userIn.toString() === e.userIn._id.toString()
          )
          const pps = {
            name: userToSend.name,
            email: userToSend.email,
            status: po[0].status
          }

          const message = {
            to: userToSend._id,
            title: `Usuarios involucrados causa ${updtInvUsers.rol}`,
            text: `<span>Le enviamos esta notificación para hacerle saber que el usuario <b>${userPropietary.name}</b> propietario de la causa <b>${updtInvUsers.rol}</b> del <b>${updtInvUsers.court}</b> lo agrego como <b>${pps.status}</b> a la misma.</span>`,
            type: false
          }

          await new Messages({
            ...message
          }).save()
        })
        return {
          messageBody: `Se actualizaron los usuarios involucrados en la causa`,
          messageType: 'is-success',
          messageImage: null
        }
      } catch (error) {
        return {
          messageBody: 'El servidor no esta respondiendo bien, intente en unos minutos',
          messageType: 'is-danger',
          messageImage: null
        }
      }
    },
    
    updateVisibilityCase: async (_, { id, visibility }, { Cases }) => {
      try {
        await Cases.findOneAndUpdate(
          { _id: id },
          { $set: { visibility: visibility } },
          { new: true, upsert: true }
        )
        return {
          messageBody: `Se actualizaron los permisos de la causa`,
          messageType: 'is-success',
          messageImage: null
        }
      } catch (error) {
        return {
          messageBody: 'El servidor no esta respondiendo bien, intente en unos minutos',
          messageType: 'is-danger',
          messageImage: null
        }
      }
    },
    
    addPriority: async (_, { input }, { Priority }) => {
      try {
        const { id, name } = input
        const priority = await Priority.findOneAndUpdate(
          { _id: new mongoose.Types.ObjectId(id) },
          { $set: { name } },
          { new: true }
        )
        return {
          priority: priority,
          message: {
            messageBody: `Se actualizó la prioridad`,
            messageType: 'is-success',
            messageImage: null          }
        }
      } catch (error) {
        return {
          messageBody: 'El servidor no esta respondiendo bien, intente en unos minutos',
          messageType: 'is-danger',
          messageImage: null
        }
      }
    },
    
    addActivity: async (_, { input }, { Activity }) => {
      try {
        const { id, priority, caseId } = input
        input.id = new mongoose.Types.ObjectId(id)
        input.priority = new mongoose.Types.ObjectId(priority)
        input.caseId = new mongoose.Types.ObjectId(caseId)
        let activity = await new Activity({
          ...input
        }).save()
        activity = await activity.populate([
          { path: 'priority' },
          { path: 'caseId', select: '_id cover rol court' },
          { path: 'createdBy', select: '_id name' }
        ])
        return {
          activity: activity,
          message: {
            messageBody: `La actividad se añadio de manera satisfactoria`,
            messageType: 'is-success',
            messageImage: null
          }
        }
      } catch (error) {
        console.log('error')
        console.log(error)
        return {
          messageBody: 'El servidor no esta respondiendo bien, intente en unos minutos',
          messageType: 'is-danger',
          messageImage: null
        }
      }
    },
    
    updateActivity: async (_, { input }, { Activity }) => {
      try {
        const { _id } = input
        const upInput = {
          name: input.name,
          priority: new mongoose.Types.ObjectId(input.priority),
          caseId: input.caseId,
          startTime: input.startTime,
          endTime: input.endTime
        }
        let upActivity = await Activity.findOneAndUpdate(
          { _id: new mongoose.Types.ObjectId(_id) },
          { $set: { ...upInput } },
          { new: true }
        )
        let activity = await upActivity.populate([
          { path: 'priority' },
          { path: 'caseId', select: '_id cover rol court' },
          { path: 'createdBy', select: '_id name' }
        ])
        return {
          activity: activity,
          message: {
            messageBody: `La actividad se actualizo de manera satisfactoria`,
            messageType: 'is-success',
            messageImage: null
          }
        }
      } catch (error) {
        console.log('error')
        console.log(error)
        return {
          activity: null,
          message: {
            messageBody: 'El servidor no esta respondiendo bien, intente en unos minutos',
            messageType: 'is-danger',
            messageImage: null
          }
        }
      }
    },
    
    getFileSignedS3Url: async (_, { input }, __) => {
      try {
        const fileSystemService = new plugins.FileSystemService()
        const signedUrl = await fileSystemService.getSignedS3Url(input)
        return {
          url: signedUrl,
          message: null
        }
      } catch (error) {
        console.log('error')
        console.log(error)
        return {
          url: null,
          message: {
            messageBody: 'El servidor no esta respondiendo bien, intente en unos minutos',
            messageType: 'is-danger',
            messageImage: null
          }
        }
      }
    }
  }
}

/**
 * Proceso en background para actualizar una causa
 * Esta función se ejecuta de forma asíncrona sin bloquear la respuesta
 * 
 * ✅ MODIFICADO: Ahora guarda los datos en CasesUpdated y NO los elimina
 * CasesUpdated contiene los datos completos del scraper (movimientos, litigantes, etc.)
 * Cases contiene solo los datos base creados en el frontend
 */
async function startScrapingProcess(processId, caseId, input, models) {
  const { Cases, CasesUpdated, CasesReviews, CasesLogs, ProcessStatus, Users, useAuthScraper, keepSessionAlive } = models
  
  let review = null;
  
  try {
    console.log(`🔄 [Process ${processId}] Iniciando scraping en background...`)
    
    // 1. Obtener instancia del navegador
    const scrapeInstance = await initGlobalScrape()
    
    // 2. Obtener datos de la causa
    const existingCase = await Cases.findById(caseId)
    
    if (!existingCase) {
      await ProcessStatus.findByIdAndUpdate(processId, {
        status: 'error',
        errorMessage: 'Causa no encontrada',
        completedAt: new Date()
      })
      return
    }
    
    const tribunalId = existingCase.searchParams?.tribunalId
    const competencia = existingCase.searchParams?.competencia
    const corteId = existingCase.searchParams?.corteId
    
    if (!tribunalId || !competencia || !corteId) {
      await ProcessStatus.findByIdAndUpdate(processId, {
        status: 'error',
        errorMessage: 'Faltan parámetros de búsqueda',
        completedAt: new Date()
      })
      return
    }
    
    // ✅ Crear registro en CasesReviews (seguimiento del proceso)
    try {
      review = await CasesReviews.create({
        caseId: caseId,
        reviewedBy: input.userId || existingCase.createdBy,
        reviewType: input.userId ? 'MANUAL' : 'SCHEDULED',
        status: 'PROCESSING',
        previousData: {
          cover: existingCase.cover,
          stage: existingCase.stage,
          movementsCount: existingCase.movementsHistory?.length || 0,
          litigantsCount: existingCase.litigants?.length || 0
        }
      });
      console.log(`📝 [Process ${processId}] Registro en CasesReviews creado: ${review._id}`)
    } catch (reviewError) {
      console.warn(`⚠️ [Process ${processId}] Error creando CasesReviews:`, reviewError.message)
    }
    
    // 3. Ejecutar scraper (esto puede tomar tiempo)
    logger.info(`🕷️ [Process ${processId}] Ejecutando scraper...`)
    
    let scrapData
    if (useAuthScraper) {
      scrapData = await scrapRawDataAuth({
        rol: input.rol,
        tribune: tribunalId,
        competencia: competencia,
        corteId: corteId
      })
    } else {
      scrapData = await scrapRawData({
        typeSearch: input.typeSearch || existingCase.typeSearch || 'UNIFICADA',
        rol: input.rol,
        tribune: tribunalId,
        competencia: competencia,
        corteId: corteId
      }, scrapeInstance)
    }
    
    console.log(`✅ [Process ${processId}] Scraping completado`)
    
    // ✅ 4. GUARDAR en CasesUpdated (datos completos del scraper)
    await new CasesUpdated({
      ...scrapData,
      caseId: caseId,
      rol: input.rol,
      court: input.court,
      createdBy: existingCase.createdBy,
      status: existingCase.status,
      visibility: existingCase.visibility,
      typeSearch: existingCase.typeSearch || 'UNIFICADA'
    }).save()
    
    console.log(`📝 [Process ${processId}] Datos guardados en CasesUpdated`)
    
    // ✅ 5. Actualizar TAMBIÉN Cases con los datos principales
    const updateData = {
      cover: scrapData.cover || existingCase.cover,
      admission: scrapData.admission || existingCase.admission,
      court: scrapData.court || existingCase.court,
      stage: scrapData.stage || existingCase.stage,
      debtor: scrapData.debtor || existingCase.debtor,
      estAdmin: scrapData.estAdmin || existingCase.estAdmin,
      processState: scrapData.processState || existingCase.processState,
      process: scrapData.process || existingCase.process,
      location: scrapData.location || existingCase.location,
      movementsHistory: scrapData.movementsHistory || existingCase.movementsHistory,
      litigants: scrapData.litigants || existingCase.litigants,
      'scrapedData.status': 'success',
      'scrapedData.lastScrapedAt': new Date(),
      'scrapedData.data': scrapData,
      'scrapedData.errorMessage': null
    }
    
    await Cases.findByIdAndUpdate(caseId, { $set: updateData })
    console.log(`✅ [Process ${processId}] Datos principales actualizados en Cases`)
    
    // ✅ 6. Actualizar CasesReviews con los resultados
    if (review) {
      try {
        const oldMovements = existingCase.movementsHistory || []
        const newMovements = scrapData.movementsHistory || []
        const newMovementsCount = newMovements.length - oldMovements.length
        
        await CasesReviews.findByIdAndUpdate(review._id, {
          status: 'COMPLETED',
          currentData: {
            cover: scrapData.cover,
            stage: scrapData.stage,
            movementsCount: newMovements.length,
            litigantsCount: scrapData.litigants?.length || 0
          },
          changes: {
            newMovements: newMovementsCount > 0 ? newMovementsCount : 0,
            litigantsChanged: (existingCase.litigants || []).length !== (scrapData.litigants || []).length,
            mainFieldsChanged: []
          }
        });
        console.log(`✅ [Process ${processId}] CasesReviews actualizado: ${review._id}`)
      } catch (updateReviewError) {
        console.warn(`⚠️ [Process ${processId}] Error actualizando CasesReviews:`, updateReviewError.message)
      }
    }
    
    // ✅ 7. Registrar en CasesLogs (auditoría de finalización)
    try {
      const oldMovements = existingCase.movementsHistory || []
      const newMovements = scrapData.movementsHistory || []
      const newMovementsCount = newMovements.length - oldMovements.length
      
      await CasesLogs.create({
        caseId: caseId,
        accesedBy: input.userId || existingCase.createdBy,
        action: 'UPDATE',
        details: `Scraping completado: ${newMovementsCount > 0 ? newMovementsCount + ' nuevos movimientos, ' : ''}${(existingCase.litigants || []).length !== (scrapData.litigants || []).length ? 'litigantes actualizados' : 'sin cambios en litigantes'}`
      });
    } catch (logError) {
      console.warn(`⚠️ [Process ${processId}] Error registrando en CasesLogs:`, logError.message)
    }
    
    // 8. Resumen de cambios (para el polling y notificaciones)
    let summary = {
      newMovements: scrapData?.movementsHistory?.length || 0,
      litigantsChanged: false,
      mainFieldsChanged: []
    }
    
    // Comparar con datos anteriores si existen
    const oldCase = await Cases.findById(caseId)
    if (oldCase && oldCase.movementsHistory) {
      const oldMovements = oldCase.movementsHistory || []
      const newMovements = scrapData?.movementsHistory || []
      
      if (newMovements.length > oldMovements.length) {
        summary.newMovements = newMovements.length - oldMovements.length
      }
      
      if ((oldCase.litigants || []).length !== (scrapData?.litigants || []).length) {
        summary.litigantsChanged = true
      }
    }
    
    // 9. Actualizar estado del proceso
    await ProcessStatus.findByIdAndUpdate(processId, {
      status: 'completed',
      completedAt: new Date(),
      summary: summary
    })
    
    // 10. Enviar notificaciones por email (si hay cambios significativos)
    if (summary.newMovements > 0 || summary.litigantsChanged) {
      const updatedCase = await Cases.findById(caseId)
      await sendUpdateNotification(Users, updatedCase, {
        newMovementsCount: summary.newMovements,
        litigantsChanged: summary.litigantsChanged,
        mainFieldsChanged: summary.mainFieldsChanged
      })
    }
    
    console.log(`✅ [Process ${processId}] Proceso completado. Datos disponibles en CasesUpdated y Cases actualizados.`)
    
    // 11. Mantener sesión
    if (useAuthScraper && keepSessionAlive) {
      await keepSessionAlive()
    }
    
  } catch (error) {
    const isNotFound = (typeof CaseNotFoundError === 'function' && error instanceof CaseNotFoundError) || error?.name === 'CaseNotFoundError'   // ✅ fallback por nombre, no depende del import

    if (isNotFound) {
      console.warn(`⚠️ [Process ${processId}] Causa no encontrada:`, error.message)
      logger.warn('Causa no encontrada en startScrapingProcess', { processId, caseId, rol: error.rol })
    } else {
      console.error(`❌ [Process ${processId}] Error:`, error.message)
      logger.error('Error en startScrapingProcess', {
        processId,
        caseId,
        error: error.message,
        stack: error.stack
      })
    }

    // ✅ Actualizar CasesReviews con error
    if (review) {
      try {
        await CasesReviews.findByIdAndUpdate(review._id, {
          status: isNotFound ? 'NOT_FOUND' : 'ERROR',
          errorMessage: error.message
        });
      } catch (updateError) {
        console.warn(`⚠️ Error actualizando CasesReviews con error:`, updateError.message)
      }
    }

    await ProcessStatus.findByIdAndUpdate(processId, {
      status: isNotFound ? 'not_found' : 'error',   // ✅ status distinto
      errorMessage: error.message || 'Error desconocido en el proceso',
      completedAt: new Date()
    })
  }
}

// ========== EXPORTAR ==========
module.exports = resolvers

// ========== INICIALIZACIÓN DEL NAVEGADOR GLOBAL ==========
initGlobalScrape().catch(console.error);

// Cerrar navegador cuando el proceso termina
process.on('SIGINT', async () => {
    logger.info('🛑 Cerrando navegador...');
    if (useAuthScraper) {
      await closeAuthScrapeInstance();
    } else {
      await closeScrapeInstance();
    }
    process.exit();
});

process.on('SIGTERM', async () => {
    logger.info('🛑 Cerrando navegador...');
    if (useAuthScraper) {
      await closeAuthScrapeInstance();
    } else {
      await closeScrapeInstance();
    }
    process.exit();
});
