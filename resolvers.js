/* @ts-nocheck */
const { AuthenticationError } = require('apollo-server-express')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const mongoose = require('mongoose')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const { courtNameById, courtIdByName } = require('./utils/seedsjudge')
const { updateCaseIfNeeded, sendUpdateNotification } = require('./utils/case-updater')
const { enqueueCaseUpdate, getPendingCount, MAX_QUEUE_SIZE } = require('./utils/queues/scraping-queue')
const { config } = require('./config/mail')
const { abstractSendMail } = require('./utils/mail')
const { GraphQLUpload } = require('graphql-upload')
const scraperModeConfig = require('./utils/scraper-mode-config')

// Importar desde scrapper.js
const { scrapRawData, scrapMultipleCauses, scrapeAndUpdateCase, updateMultipleCases, closeScrapeInstance, CaseNotFoundError } = require('./utils/scrapper')
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
const ADMIN_ROLE = 1

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
  const safeEmail = sanitizeStringValue(cu.email, 'email', { maxLength: 255 })
  const user = await um.findOne({ email: safeEmail }, { password: false })
  return user
}

function sanitizeStringValue(value, fieldName, { maxLength = 200, allowEmpty = false } = {}) {
  if (value === null || value === undefined) {
    throw new Error(`${fieldName} es obligatorio`)
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    throw new Error(`${fieldName} tiene un formato inválido`)
  }

  const str = String(value).trim()

  if (!allowEmpty && str.length === 0) {
    throw new Error(`${fieldName} no puede estar vacío`)
  }

  if (str.length > maxLength) {
    throw new Error(`${fieldName} supera la longitud máxima permitida`)
  }

  if (/[\$\{\}\[\]\u0000]/.test(str)) {
    throw new Error(`${fieldName} contiene caracteres no permitidos`)
  }

  return str
}

function sanitizeMongoId(value, fieldName) {
  return sanitizeObjectId(value, fieldName)
}

function sanitizeObjectId(value, fieldName) {
  const str = sanitizeStringValue(value, fieldName, { maxLength: 64 })

  if (!/^[a-fA-F0-9]{24}$/.test(str)) {
    throw new Error(`${fieldName} no es un ObjectId válido`)
  }

  return new mongoose.Types.ObjectId(str)
}

function sanitizeNumericId(value, fieldName, { maxLength = 20 } = {}) {
  const str = sanitizeStringValue(value, fieldName, { maxLength })

  if (!/^\d+$/.test(str)) {
    throw new Error(`${fieldName} debe ser numérico`)
  }

  return Number(str)
}

function sanitizeCourtName(value) {
  const name = sanitizeStringValue(value, 'court', { maxLength: 200 })

  if (!/^[a-zA-Z0-9ÁÉÍÓÚáéíóúÑñÜü\s,.-]+$/.test(name)) {
    throw new Error('court contiene caracteres no permitidos')
  }

  return name
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
        const safeCaseId = sanitizeMongoId(caseId, 'caseId')
        const usersResult = await Users.find({}, { password: false }).sort({ createdAt: 1 })
        
        // Buscar el documento de InvolvedUsersCase para esta causa
        const usersInvResult = await InvolvedUsersCase.findOne(
          { case: safeCaseId },
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
      const safeUserId = sanitizeMongoId(userId, 'userId')
      const user = await Users.findOne({ _id: safeUserId }, { password: false })
      return user
    },
    /**
     * ✅ MODIFICADO: getCases ahora con paginación
     * Devuelve un objeto CasesPage con cases, total y hasMore
     */
    getCase: async (_, { id }, { Cases }) => {
	  const safeId = sanitizeObjectId(id, 'id')
	  const caseDoc = await Cases.findById(safeId).populate('createdBy', '-password')
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
      const safeEmail = sanitizeStringValue(currentUser?.email, 'email', { maxLength: 255 })
      const user = await Users.findOne({ email: safeEmail }, { _id: 1 })
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
      const safeUserId = sanitizeMongoId(userId, 'userId')
      const cc = await Cases.find(
        { createdBy: safeUserId },
        '_id rol cover admission court stage debtor'
      ).populate('createdBy')
      return cc
    },
    getUserUnreadMessages: async (_, { userId }, { Messages }) => {
      const safeUserId = sanitizeObjectId(userId, 'userId')
      const userMessages = await Messages.find({
        to: safeUserId,
        status: false
      }).populate('to', '-password')
      return userMessages
    },
    getUserMessages: async (_, { userId }, { Messages }) => {
      const safeUserId = sanitizeObjectId(userId, 'userId')
      const userMessages = await Messages.find({ to: safeUserId }).populate(
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
        const safeSearchTerm = sanitizeStringValue(searchTerm, 'searchTerm', { maxLength: 100 })
        const searchResult = await Users.find(
          {
            $or: [
              { username: safeSearchTerm },
              { name: safeSearchTerm },
              { card: safeSearchTerm }
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
    getProcessStatus: async (_, { processId }, { ProcessStatus, Users, currentUser }) => {
	  if (!currentUser) {
        throw new AuthenticationError('Debes iniciar sesión')
      }
      try {
		if (!currentUser) {
          throw new AuthenticationError('Debes iniciar sesión')
        }
        
        const safeProcessId = sanitizeObjectId(processId, 'processId')
        const status = await ProcessStatus.findById(safeProcessId)
        
        if (!status) {
          return null
        }
        
        const user = await gu(Users, currentUser)
        const isOwner = status.userId?.toString() === user?._id?.toString()
        const isAdmin = user?.role === ADMIN_ROLE
 
        if (!isOwner && !isAdmin) {
          throw new AuthenticationError('No tienes permiso para ver este proceso')
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
        if (error instanceof AuthenticationError) {
          throw error // no lo absorbas como null, debe llegar al cliente como error real
        }
        console.error('❌ Error en getProcessStatus:', error)
        return null
      }
    },
    
    getScraperMode: async (_, args, { Users, currentUser }) => {
      if (!currentUser) {
        throw new AuthenticationError('Debes iniciar sesión')
      }
      const user = await gu(Users, currentUser)
      if (user?.role !== ADMIN_ROLE) {
        throw new AuthenticationError('No tienes permiso para ver esta configuración')
      }

      return scraperModeConfig.getMode()
    }
  },

  Mutation: {
    updateUser: async (_, { userId, name, username, service, card, role }, { Users }) => {
      const safeUserId = sanitizeObjectId(userId, 'userId')
      const safeUsername = sanitizeStringValue(username, 'username', { maxLength: 100 })
      const safeCard = sanitizeStringValue(card, 'card', { maxLength: 50 })
      const checkUser = await Users.findOne({ $or: [{ username: safeUsername }, { card: safeCard }] })
      if (checkUser && checkUser._id.toString() !== safeUserId.toString()) {
        throw new Error('El usuario o la tarjeta estan en uso')
      }
      const user = await Users.findOneAndUpdate(
        { _id: safeUserId },
        { $set: { userId: safeUserId, name, username: safeUsername, service, card: safeCard, role } },
        { new: true }
      )
      console.log(user)
      return user
    },
    updateUsers: async (_, { input }, { Users }) => {
      const { userId, email } = input
      const safeUserId = sanitizeMongoId(userId, 'userId')
      const safeEmail = sanitizeStringValue(email, 'email', { maxLength: 255 })
      const checkUser = await Users.findOne({ email: safeEmail })
      if (checkUser && checkUser._id.toString() !== safeUserId.toString()) {
        throw new Error('El usuario esta en uso')
      }
      await Users.findOneAndUpdate(
        { _id: safeUserId },
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
      const safeUserId = sanitizeMongoId(userId, 'userId')
      const safeCurrentPassword = sanitizeStringValue(currentPassword, 'currentPassword', { maxLength: 255 })
      const safePassword = sanitizeStringValue(password, 'password', { maxLength: 255 })
      const checkUser = await Users.findById({ _id: safeUserId })
      const isMatch = await checkUser.comparePassword(safeCurrentPassword)
      if (!isMatch) {
        throw new Error('La contraseña anterior es incorrecta')
      }
      await Users.findOneAndUpdate(
        { _id: safeUserId },
        { $set: { userID: safeUserId, password: safePassword } },
        { new: true }
      )
      return {
        messageBody: 'La contraseña se cambio de manera satisfactoria',
        messageType: 'is-primary',
        messageImage: null
      }
    },
    updateUsersPassword: async (_, { input: { userId, password } }, { Users }) => {
      const safeUserId = sanitizeMongoId(userId, 'userId')
      const safePassword = sanitizeStringValue(password, 'password', { maxLength: 255 })
      await Users.findOneAndUpdate(
        { _id: safeUserId },
        { $set: { userID: safeUserId, password: safePassword } },
        { new: true }
      )
      return {
        messageBody: 'La contraseña se cambio de manera satisfactoria',
        messageType: 'is-primary',
        messageImage: null
      }
    },
    deleteUserPost: async (_, { postId }, { Posts }) => {
      const safePostId = sanitizeMongoId(postId, 'postId')
      const post = await Posts.findOneAndRemove({
        _id: safePostId
      })
      return post
    },
    deleteUser: async (_, { userId }, { Users }) => {
      const safeUserId = sanitizeMongoId(userId, 'userId')
      await Users.findOneAndRemove({
        _id: safeUserId
      })
      return {
        messageBody: 'El usuario fue eliminado de manera satisfactoria',
        messageType: 'is-primary',
        messageImage: null
      }
    },
    deleteCase: async (_, { caseId }, { Cases, InvolvedUsersCase, CasesViewed, CasesUpdated }) => {
	  try {
		const safeCaseId = sanitizeObjectId(caseId, 'caseId')
		console.log(`🗑️ Eliminando causa: ${safeCaseId}`);
		
		// ✅ 1. Verificar que la causa existe
		const existingCase = await Cases.findById(safeCaseId);
		if (!existingCase) {
		  console.warn(`⚠️ Causa no encontrada: ${caseId}`);
		  return {
			messageBody: 'La causa no existe en el sistema',
			messageType: 'is-warning',
			messageImage: null
		  };
		}
		
		// ✅ 2. Eliminar de Cases (principal)
		await Cases.findOneAndDelete({ _id: safeCaseId });
		console.log(`✅ Causa eliminada de Cases: ${safeCaseId}`);
		
		// ✅ 3. Eliminar de CasesViewed (vistas)
		await CasesViewed.findOneAndDelete({ caseBankruptcy: safeCaseId });
		console.log(`✅ Eliminado de CasesViewed: ${safeCaseId}`);
		
		// ✅ 4. Eliminar de InvolvedUsersCase (usuarios involucrados)
		await InvolvedUsersCase.findOneAndDelete({ case: safeCaseId });
		console.log(`✅ Eliminado de InvolvedUsersCase: ${safeCaseId}`);
		
		// ✅ 5. Eliminar de CasesUpdated (datos del scraper) - con manejo de error
		try {
		  const result = await CasesUpdated.findOneAndDelete({ caseId: safeCaseId });
		  if (result) {
			console.log(`✅ Eliminado de CasesUpdated: ${safeCaseId}`);
		  } else {
			console.log(`ℹ️ No había registro en CasesUpdated para: ${safeCaseId}`);
		  }
		} catch (updatedError) {
		  // Si el modelo no existe o hay error, solo loguear y continuar
		  console.warn(`⚠️ Error eliminando de CasesUpdated: ${updatedError.message}`);
		}
		
		// ✅ 6. También eliminar de ProcessStatus si existe
		try {
		  const ProcessStatus = require('./models/ProcessStatus');
		  await ProcessStatus.findOneAndDelete({ caseId: safeCaseId });
		  console.log(`✅ Eliminado de ProcessStatus: ${safeCaseId}`);
		} catch (processError) {
		  console.warn(`⚠️ Error eliminando de ProcessStatus: ${processError.message}`);
		}
		
		// ✅ 7. También eliminar de CasesReviews si existe
		try {
		  const CasesReviews = require('./models/CasesReviews');
		  await CasesReviews.findOneAndDelete({ caseId: safeCaseId });
		  console.log(`✅ Eliminado de CasesReviews: ${safeCaseId}`);
		} catch (reviewError) {
		  console.warn(`⚠️ Error eliminando de CasesReviews: ${reviewError.message}`);
		}
		
		// ✅ 8. También eliminar de CasesLogs si existe
		try {
		  const CasesLogs = require('./models/CasesLogs');
		  await CasesLogs.findOneAndDelete({ caseId: safeCaseId });
		  console.log(`✅ Eliminado de CasesLogs: ${safeCaseId}`);
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
        const safeId = sanitizeObjectId(id, 'id')
        await Activity.findOneAndRemove({
          _id: safeId
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
      const safeUserId = sanitizeObjectId(userId, 'userId')
      const safePostId = sanitizeObjectId(postId, 'postId')
      const safeMessageBody = sanitizeStringValue(messageBody, 'messageBody', { maxLength: 2000 })
      const newMessage = {
        messageBody: safeMessageBody,
        messageUser: safeUserId
      }
      const post = await Posts.findOneAndUpdate(
        { _id: safePostId },
        { $push: { message: { $each: [newMessage], $position: 0 } } },
        { new: true }
      ).populate({
        path: 'message.messageUser',
        model: 'Users'
      })
      return post.message[0]
    },
    signinUsers: async (_, { email, password }, { Users }) => {
      const safeEmail = sanitizeStringValue(email, 'email', { maxLength: 255 })
      const safePassword = sanitizeStringValue(password, 'password', { maxLength: 255 })
      const user = await Users.findOne({ email: safeEmail })
      if (!user) {
        throw new AuthenticationError('El usuario no existe')
      }
      const isValidPassword = await bcrypt.compare(safePassword, user.password)
      console.log(isValidPassword)
      if (!isValidPassword) {
        throw new AuthenticationError('La contraseña es incorrecta')
      }
      return { token: createToken(user, process.env.SECRET, '1hr') }
    },
    signupUsers: async (_, { params }, { Users }) => {
      const safeEmail = sanitizeStringValue(params?.email, 'email', { maxLength: 255 })
      const user = await Users.findOne({ email: safeEmail })
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
                status: 'ERROR', 
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
        
        const safeTribunalId = sanitizeNumericId(tribunalId, 'tribunalId')
        const safeCourtName = sanitizeCourtName(courtNameById(safeTribunalId))
        const safeRolNumber = sanitizeStringValue(rolNumber, 'rolNumber', { maxLength: 50 })
        const safeYear = sanitizeStringValue(year, 'year', { maxLength: 20 })
        const safeLibroTipo = sanitizeStringValue(libroTipo, 'libroTipo', { maxLength: 50 })
        const safeCompetencia = sanitizeStringValue(competencia, 'competencia', { maxLength: 50 })
        const safeCorteId = sanitizeStringValue(corteId, 'corteId', { maxLength: 50 })
        const safeCreatedBy = sanitizeObjectId(createdBy, 'createdBy')
        const safeTypeSearch = sanitizeStringValue(typeSearch, 'typeSearch', { maxLength: 50 })
        
        const fullRol = `${safeLibroTipo}-${safeRolNumber}-${safeYear}`;
        const tribunalName = safeCourtName;
        
        logger.info('📋 Creando nueva causa:', { fullRol, competencia: safeCompetencia, corteId: safeCorteId, tribunalId: safeTribunalId, tribunalName });
        
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
        
        const { acquireInstance, releaseInstance } = require('./utils/scrape-pool');
        const poolSlot = await acquireInstance();
        const scrapeInstance = poolSlot.instance;
        
        let scrapData = null;
        try {
          logger.info('🕷️ Ejecutando scraper para obtener datos...');
          
          if (useAuthScraper) {
            scrapData = await scrapRawDataAuth({
              rol: fullRol,
              tribune: safeTribunalId,
              competencia: safeCompetencia,
              corteId: safeCorteId
            });
          } else {
            scrapData = await scrapRawData({
              typeSearch: safeTypeSearch,
              rol: fullRol,
              tribune: safeTribunalId,
              competencia: safeCompetencia,
              corteId: safeCorteId
            }, scrapeInstance);
          }
          
          logger.info('✅ Scraper completado exitosamente');
        } catch (scraperError) {
          logger.error('⚠️ Error en scraper (continuando con causa vacía):', { error: scraperError.message });
          releaseInstance(poolSlot);
        }
        releaseInstance(poolSlot)
        
        const caseData = {
          ...(scrapData || {}),
          rol: fullRol,
          court: tribunalName,
          createdBy: safeCreatedBy,
          typeSearch: safeTypeSearch,
          status: 'ACTIVE',
          searchParams: {
            competencia: safeCompetencia,
            corteId: safeCorteId,
            tribunalId: safeTribunalId,
            libroTipo: safeLibroTipo,
            rolNumber: safeRolNumber,
            year: safeYear,
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
          const safeCaseId = sanitizeObjectId(caseId, 'caseId')
          
          const existingCase = await Cases.findById(safeCaseId);
          if (!existingCase) {
            results.push({ caseId: safeCaseId.toString(), fullRol, status: 'COMPLETED_NOT_FOUND', error: 'Causa no encontrada' });
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
          const safeCreatedBy = sanitizeObjectId(createdBy, 'createdBy')
          
          if (scrapResult.status === 'success' && scrapResult.data) {
            const safeTribunalId = sanitizeNumericId(causeInput.tribunalId, 'tribunalId')
            const safeCourtName = sanitizeCourtName(courtNameById(safeTribunalId));
            const safeLibroTipo = sanitizeStringValue(causeInput.libroTipo, 'libroTipo', { maxLength: 50 })
            const safeRolNumber = sanitizeStringValue(causeInput.rolNumber, 'rolNumber', { maxLength: 50 })
            const safeYear = sanitizeStringValue(causeInput.year, 'year', { maxLength: 20 })
            const safeTypeSearch = sanitizeStringValue(causeInput.typeSearch || 'UNIFICADA', 'typeSearch', { maxLength: 50 })
            const fullRol = `${safeLibroTipo}-${safeRolNumber}-${safeYear}`;
            
            const existing = await Cases.findOne({ rol: fullRol });
            if (existing) {
              savedCases.push({ rol: fullRol, status: 'already_exists', id: existing._id });
              continue;
            }
            
            const caseData = {
              ...scrapResult.data,
              rol: fullRol,
              court: safeCourtName,
              createdBy: safeCreatedBy,
              typeSearch: safeTypeSearch,
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
                userIn: sanitizeObjectId(a?._id, 'involved._id')
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
              status: 'ERROR',
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
        const safeRol = sanitizeStringValue(input?.rol, 'rol', { maxLength: 100 })
        const safeCourt = sanitizeStringValue(input?.court, 'court', { maxLength: 200 })

        // 1. Verificar que la causa existe
        const existingCase = await Cases.findOne({
          rol: safeRol,
          court: safeCourt
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
          status: { $in: ['QUEUED', 'PROCESSING'] }
        })

        if (existingProcess) {
          const STALE_PROCESS_THRESHOLD_MS = 6 * 60 * 1000 // 6 minutos
          const ageMs = Date.now() - existingProcess.startedAt.getTime()

          if (ageMs < STALE_PROCESS_THRESHOLD_MS) {
            // Proceso realmente en curso, ahí sí bloqueamos
            return {
              messageBody: '⚠️ Ya hay una actualización en curso para esta causa. Por favor espera.',
              messageType: 'is-warning',
              messageImage: null,
              processId: existingProcess._id.toString(),
              success: false
            }
          } else {
            // Proceso abandonado (crash/timeout) — lo liberamos y dejamos pasar uno nuevo
            console.warn(`⚠️ Proceso huérfano detectado (${Math.round(ageMs / 1000)}s), liberando...`)
            await ProcessStatus.findByIdAndUpdate(existingProcess._id, {
              status: 'ERROR',
              errorMessage: 'Proceso abandonado (timeout o caída del servidor)',
              completedAt: new Date()
            })
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
          status: 'QUEUED',
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
        
        // 7. ENCOLAR en el pool (mismo sistema que updateCasesBulk)
        await enqueueCaseUpdate({
          caseId: existingCase._id.toString(),
          fullRol: existingCase.searchParams?.fullRol || existingCase.rol,
          searchParams: existingCase.searchParams,
          processId: processId.toString(),
          userId: userId.toString(),
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
    
    updateCasesBulk: async (_, { caseIds }, { Cases, ProcessStatus, ScrapingOverflow, Users, currentUser }) => {
      console.log(`🔵 [${new Date().toISOString()}] updateCasesBulk llamado con caseIds:`, caseIds)
      if (!currentUser) {
        return {
          messageBody: 'Debes iniciar sesión para actualizar causas',
          messageType: 'is-danger',
          messageImage: null,
          queued: [],
          rejected: []
        }
      }

      const user = await gu(Users, currentUser)
      const userId = user._id
      try {
        if (!caseIds || caseIds.length === 0) {
          return {
            messageBody: 'No se proporcionaron causas para actualizar',
            messageType: 'is-danger',
            messageImage: null,
            queued: [],
            rejected: []
          }
        }
        
        // ✅ Deduplicar — sin esto, un mismo ID repetido en el array
		// genera 2 ProcessStatus y 2 entradas de overflow para la misma causa
		caseIds = [...new Set(caseIds.map(id => id.toString()))]

        const pendingCount = await getPendingCount()
        const availableSlots = MAX_QUEUE_SIZE - pendingCount

        const idsToProcess = caseIds.slice(0, Math.max(availableSlots, 0))
        const idsRejectedByLimit = caseIds.slice(Math.max(availableSlots, 0))

        const queued = []
        const rejected = []

        // ✅ Las que no entran por límite YA NO se pierden: van al overflow
		// y se procesan solas cuando se libere espacio en la cola.
		if (idsRejectedByLimit.length > 0) {
		  const casesOverflow = await Cases.find({ _id: { $in: idsRejectedByLimit } })

		  for (const existingCase of casesOverflow) {
			const processStatus = await ProcessStatus.create({
			  caseId: existingCase._id,
			  userId: userId,
			  status: 'QUEUED'
			})

			console.log(`📥 [${new Date().toISOString()}] Creando entrada en overflow para ${existingCase.rol} (caseId: ${existingCase._id})`)
			await ScrapingOverflow.create({
			  caseId: existingCase._id,
			  processId: processStatus._id,
			  fullRol: existingCase.searchParams?.fullRol || existingCase.rol,
			  searchParams: existingCase.searchParams,
			  userId: userId
			})

			queued.push(processStatus._id.toString()) // ✅ cuenta como encolada, no rechazada
		  }
		}

        for (const caseId of idsToProcess) {
          const safeCaseId = sanitizeObjectId(caseId, 'caseId')
          const existingCase = await Cases.findById(safeCaseId)

          if (!existingCase) {
            rejected.push({
              caseId: safeCaseId.toString(),
              rol: 'Desconocida',
              reason: 'no_encontrada'
            })
            continue
          }

          const alreadyProcessing = await ProcessStatus.findOne({
            caseId: existingCase._id,
            status: { $in: ['QUEUED', 'PROCESSING'] }
          })
          if (alreadyProcessing) {
            rejected.push({
              caseId,
              rol: existingCase.rol,
              reason: 'ya_en_proceso'
            })
            continue
          }

          const alreadyInOverflow = await ScrapingOverflow.findOne({ caseId: existingCase._id })
          if (alreadyInOverflow) {
            rejected.push({
              caseId,
              rol: existingCase.rol,
              reason: 'ya_en_proceso'
            })
            continue
          }

          const processStatus = await ProcessStatus.create({
            caseId: existingCase._id,
            userId: userId,
            status: 'QUEUED'
          })

          await enqueueCaseUpdate({
            caseId: existingCase._id.toString(),
            fullRol: existingCase.searchParams?.fullRol || existingCase.rol,
            searchParams: existingCase.searchParams,
            processId: processStatus._id.toString(),
            userId: userId.toString(),
          })

          queued.push(processStatus._id.toString())
        }

        return {
          messageBody: `${queued.length} causa(s) encolada(s) para actualización. ${rejected.length} rechazada(s).`,
          messageType: queued.length > 0 ? 'is-success' : 'is-warning',
          messageImage: null,
          queued,
          rejected
        }
      } catch (error) {
        logger.error('❌ Error en updateCasesBulk:', error)
        return {
          messageBody: 'Error al encolar las causas para actualización',
          messageType: 'is-danger',
          messageImage: null,
          queued: [],
          rejected: (caseIds || []).map(caseId => ({
            caseId,
            rol: 'Desconocida',
            reason: 'error_interno'
          }))
        }
      }
    },
    
    addInvUsers: async (_, { input }, { InvolvedUsersCase, Users, Cases, Messages }) => {
      try {
        const safeCaseId = sanitizeObjectId(input.caseId, 'caseId')
        const safeInvUsers = Array.isArray(input.invUsers) ? input.invUsers.map((u) => ({
          ...u,
          userIn: u?.userIn ? sanitizeObjectId(u.userIn._id || u.userIn, 'userIn._id') : null
        })) : []
        const updtInvUsers = await InvolvedUsersCase.findOneAndUpdate(
          { case: safeCaseId },
          { $set: { involved: safeInvUsers } },
          { new: true, upsert: true }
        )
        
        safeInvUsers.forEach(async e => {
          const userCase = await Cases.findById(safeCaseId, '_id createdBy')
          const userToSend = await Users.findById(
            e.userIn,
            '_id name email'
          )
          const userPropietary = await Users.findById(
            userCase.createdBy,
            'name'
          )
          const po = updtInvUsers.involved.filter(
            a => a.userIn.toString() === e.userIn.toString()
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
        const safeCaseId = sanitizeObjectId(id, 'id')
        await Cases.findOneAndUpdate(
          { _id: safeCaseId },
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
        const safeId = sanitizeObjectId(id, 'id')
        const safeName = sanitizeStringValue(name, 'name', { maxLength: 200 })
        const priority = await Priority.findOneAndUpdate(
          { _id: safeId },
          { $set: { name: safeName } },
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
        input.id = sanitizeObjectId(id, 'id')
        input.priority = sanitizeObjectId(priority, 'priority')
        input.caseId = sanitizeObjectId(caseId, 'caseId')
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
          name: sanitizeStringValue(input.name, 'name', { maxLength: 200 }),
          priority: sanitizeObjectId(input.priority, 'priority'),
          caseId: sanitizeObjectId(input.caseId, 'caseId'),
          startTime: input.startTime,
          endTime: input.endTime
        }
        let upActivity = await Activity.findOneAndUpdate(
          { _id: sanitizeObjectId(_id, '_id') },
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
    },
    setScraperMode: async (_, { mode }, { Users, currentUser }) => {
      if (!currentUser) {
        throw new AuthenticationError('Debes iniciar sesión')
      }
      const user = await gu(Users, currentUser)
      if (user?.role !== ADMIN_ROLE) {
        throw new AuthenticationError('No tienes permiso para modificar esta configuración')
      }
 
      const doc = await scraperModeConfig.setMode(mode, user._id)
 
      return {
        mode: doc.mode,
        updatedBy: doc.updatedBy,
        updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null
      }
    },
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
    const { acquireInstance, releaseInstance } = require('./utils/scrape-pool')
    const poolSlot = await acquireInstance()
    const scrapeInstance = poolSlot.instance
    
    // 2. Obtener datos de la causa
    const existingCase = await Cases.findById(caseId)
    
    if (!existingCase) {
      releaseInstance(poolSlot)
      await ProcessStatus.findByIdAndUpdate(processId, {
        status: 'ERROR',
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
      status: 'COMPLETED',
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
    releaseInstance(poolSlot)
    
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
          status: isNotFound ? 'COMPLETED_NOT_FOUND' : 'ERROR',
          errorMessage: error.message
        });
      } catch (updateError) {
        console.warn(`⚠️ Error actualizando CasesReviews con error:`, updateError.message)
      }
    }

    await ProcessStatus.findByIdAndUpdate(processId, {
      status: isNotFound ? 'COMPLETED_NOT_FOUND' : 'ERROR',   // ✅ status distinto
      errorMessage: error.message || 'Error desconocido en el proceso',
      completedAt: new Date()
    })
    releaseInstance(poolSlot)
  }
}

// ========== EXPORTAR ==========
resolvers.Upload = GraphQLUpload
module.exports = resolvers

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
