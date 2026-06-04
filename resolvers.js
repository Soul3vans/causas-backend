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

// ✅ IMPORTAR DESDE SCRAPPER.JS
const { scrapRawData, scrapeAndUpdateCase } = require('./utils/scrapper')
const moment = require('moment')
const { DateTime } = require('luxon')

const { cause } = require('./utils/causes')
const plugins = require('./utils/plugins')
const {
  addNewCause
} = require('./workers/mail-sender/templates/add-new-cause.tpl')

puppeteer.use(StealthPlugin())

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

module.exports = {
  Query: {
    getCurrentUser: async (_, args, { Users, currentUser }) =>
      gu(Users, currentUser),
    getUsers: async (_, args, { Users }) => {
      const usersResult = await Users.find({}, { password: false }).sort({
        createdAt: 1
      })
      return usersResult
    },
    getInvolvedUsers: async (_, { caseId }, { Users, InvolvedUsersCase }) => {
      const usersResult = await Users.find({}, { password: false }).sort({
        createdAt: 1
      })
      const usersInvResult = await InvolvedUsersCase.findOne(
        {
          case: caseId
        },
        'involved'
      ).populate('involved.userIn', '-password')
      let userInvArray = []
      usersResult.forEach(a => {
        const p = usersInvResult.involved.find(
          b => b.userIn._id.toString() === a._id.toString()
        )
        p
          ? userInvArray.push({ userIn: p.userIn, status: p.status })
          : userInvArray.push({ userIn: a, status: 'SELECCIONE' })
      })
      return userInvArray
    },
    getUser: async (_, { userId }, { Users }) => {
      const user = await Users.findOne({ _id: userId }, { password: false })
      return user
    },
    getCases: async (_, args, { Cases }) => {
      const cc = await Cases.find(
        {},
        '_id rol cover admission court stage debtor'
      ).populate('createdBy', '-password')
      return cc
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
    getCase: async (_, { id }, { Users, Cases, CasesViewed, currentUser }) => {
      const cc = await Cases.findOne({ _id: id }).populate({
        path: 'createdBy',
        select: '_id name email avatar'
      })
      const user = await gu(Users, currentUser)
      const viewedUpdated = {
        caseBankruptcy: id,
        viewedBy: user._id
      }
      await CasesViewed.findOneAndUpdate(
        { ...viewedUpdated },
        { $set: { ...viewedUpdated } },
        { new: true, upsert: true }
      )
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
    }
  },
  Upload: GraphQLUpload,
  Mutation: {
    updateUser: async (
      _,
      { userId, name, username, service, card, role },
      { Users }
    ) => {
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
    updateUserPassword: async (
      _,
      { params: { userId, currentPassword, password } },
      { Users }
    ) => {
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
    updateUsersPassword: async (
      _,
      { input: { userId, password } },
      { Users }
    ) => {
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
    deleteCase: async (
      _,
      { caseId },
      { Cases, InvolvedUsersCase, CasesViewed }
    ) => {
      try {
        await Cases.findOneAndRemove({
          _id: caseId
        })
        await CasesViewed.findOneAndRemove({
          caseBankruptcy: caseId
        })
        await InvolvedUsersCase.findOneAndRemove({
          case: caseId
        })
        return {
          messageBody: 'La causa fue eliminada de manera satisfactoria',
          messageType: 'is-primary',
          messageImage: null
        }
      } catch (error) {
        console.log(error)
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
    addCase: async (
      _,
      { input },
      { Users, Cases, InvolvedUsersCase, CasesReviews }
    ) => {
      try {
        // ========== CONSTRUCCIÓN DEL ROL COMPLETO ==========
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
        
        // Construir el rol completo
        const fullRol = `${libroTipo}-${rolNumber}-${year}`;
        
        // ✅ OBTENER EL NOMBRE DEL TRIBUNAL DESDE EL SEED
        const tribunalName = courtNameById(tribunalId);
        
        console.log('📋 Creando nueva causa:', {
          fullRol,
          competencia,
          corteId,
          tribunalId,
          tribunalName
        });
        
        // Verificar si la causa ya existe
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
        
        // ========== EJECUTAR SCRAPER ==========
        let scrapData = null;
        try {
          console.log('🕷️ Ejecutando scraper para obtener datos...');
          scrapData = await scrapRawData({
            typeSearch,
            rol: fullRol,
            tribune: tribunalId,
            competencia: competencia,
            corteId: corteId
          });
          console.log('✅ Scraper completado exitosamente');
        } catch (scraperError) {
          console.error('⚠️ Error en scraper (continuando con causa vacía):', scraperError.message);
        }
        
        // ========== PREPARAR DATOS PARA GUARDAR ==========
        const caseData = {
          ...(scrapData || {}),
          rol: fullRol,
          court: tribunalName,
          createdBy: new mongoose.Types.ObjectId(createdBy),
          typeSearch: typeSearch,
          status: 'ACTIVE',
          
          // Parámetros de búsqueda
          searchParams: {
            competencia: competencia,
            corteId: corteId,
            tribunalId: tribunalId,
            libroTipo: libroTipo,
            rolNumber: rolNumber,
            year: year,
            fullRol: fullRol
          },
          
          // Estado del scraping
          scrapedData: {
            lastScrapedAt: scrapData ? new Date() : null,
            lastScrapedBy: 'manual',
            status: scrapData ? 'success' : 'pending',
            errorMessage: scrapData ? null : 'Scraping inicial falló, pendiente de reintento',
            retryCount: 0,
            data: scrapData || null
          }
        };
        
        // Guardar la causa
        const newCase = await new Cases(caseData).save();
        console.log(`✅ Causa creada con ID: ${newCase._id}`);
        
        // ========== AGREGAR USUARIOS INVOLUCRADOS ==========
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
        
        // Crear registro de revisión
        await CasesReviews.findOneAndUpdate(
          { case: newCase._id },
          { $set: { case: newCase._id } },
          { upsert: true }
        );
        
        // ========== ENVIAR NOTIFICACIONES POR EMAIL ==========
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
        console.error('❌ Error en addCase:', error);
        return {
          messageBody: 'El servidor no está respondiendo bien, intente en unos minutos',
          messageType: 'is-danger',
          messageImage: null
        };
      }
    },
    updateCase: async (_, { input }, { Cases, CasesUpdated, CasesReviews }) => {
      try {
        const cParams = {
          typeSearch: input.typeSearch,
          rol: input.rol,
          tribune: input.court
        }

        const scrapData = await scrapRawData(cParams)
        await new CasesUpdated({
          ...scrapData
        }).save()

        const cc = await Cases.findOne({
          rol: input.rol,
          court: input.court
        })

        const ccu = await CasesUpdated.findOne({
          rol: input.rol,
          court: input.court
        })

        await CasesReviews.findOneAndUpdate(
          { case: cc._id },
          { $set: { case: cc._id } },
          { new: true, upsert: true }
        )

        if (
          cc.movementsHistory.length < ccu.movementsHistory.length ||
          cc.litigants.length < ccu.litigants.length
        ) {
          const upArr = []
          Object.entries(ccu._doc).forEach(([key, val]) => {
            if (key !== '_id' && key !== '__v') {
              upArr.push([key, val])
            }
          })
          const ccuo = Object.fromEntries(upArr)

          const upCaRe = await Cases.findOneAndUpdate(
            { rol: input.rol, court: input.court },
            { $set: { ...ccuo } },
            { new: true }
          )

          if (upCaRe) {
            await CasesUpdated.findOneAndDelete({
              rol: input.rol,
              court: input.court
            })
          }
        } else {
          await CasesUpdated.findOneAndDelete({
            rol: input.rol,
            court: input.court
          })
          return {
            messageBody: 'La causa no tiene cambios publicados, aparentemente',
            messageType: 'is-warning',
            messageImage: null
          }
        }

        return {
          messageBody: 'La causa se actualizo de manera satifastoria',
          messageType: 'is-primary',
          messageImage: null
        }
      } catch (error) {
        console.log(error)
        return {
          messageBody: 'El servidor no esta respondiendo bien, intente en unos minutos',
          messageType: 'is-danger',
          messageImage: null
        }
      }
    },
    addDdor: async (_, args, { Cases }) => {
      const cc = await Cases.find({})
      let conta = 0
      cc.forEach(async e => {
        const dbt = e.litigants.find(
          i => i.participant === 'DDOR.' || i.participant === 'DDO.'
        )
        if (dbt) {
          await Cases.findOneAndUpdate(
            { _id: e._id },
            { $set: { debtor: dbt.name } },
            { new: true }
          )
          conta++
        }
      })
      return {
        messageBody: `Se encotraron y actualizaron ${conta} registros`,
        messageType: 'is-success',
        messageImage: null
      }
    },
    addInvUsers: async (
      _,
      { input },
      { InvolvedUsersCase, Users, Cases, Messages }
    ) => {
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