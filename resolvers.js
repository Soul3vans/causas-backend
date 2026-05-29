const { AuthenticationError } = require('apollo-server-express')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
// const shortid = require('shortid')
// const { createWriteStream, mkdir } = require('fs')
// const random_useragent = require('random-useragent')
const mongoose = require('mongoose')
// mongoose.set('useFindAndModify', false)
// const puppeteer = require('puppeteer')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const { courtNameById, courtIdByName } = require('./utils/seedsjudge')
// const { csu } = require('./utils/testcases')
// const getFreeProxies = require('get-free-https-proxy')
const { config } = require('./config/mail')
const { abstractSendMail } = require('./utils/mail')
const { GraphQLUpload } = require('graphql-upload')

// const diff = require('deep-diff').diff
// const observableDiff = require('deep-diff').observableDiff
// const applyChange = require('deep-diff').applyChange
const { td } = require('./utils/scrapper')
const moment = require('moment')
const { DateTime } = require('luxon')

const { cause } = require('./utils/causes')
const plugins = require('./utils/plugins')
const {
  addNewCause
} = require('./workers/mail-sender/templates/add-new-cause.tpl')
const { scrapeUnified } = require('./utils/causes/unified-query/scrape-unified')

puppeteer.use(StealthPlugin())

const createToken = (user, secret, expiresIn) => {
  const { email, rol, name } = user
  return jwt.sign({ email, rol, name }, secret, { expiresIn })
}

function sortByDate(list) {
  list.sort((a, b) => {
    const keyA = a.day
    const keyB = b.day
    // Compare the 2 priorities
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

async function scrapRawData({ typeSearch, rol, tribune }) {
  console.log('Capture the details one civil cause initialized...')
  try {
    let scrapCause
    if (typeSearch === 'RESERVADA') {
      scrapCause = await cause.getCivilCauseDetail(rol)
    } else {
      scrapCause = await (0, scrapeUnified)({
        court: '0',
        tribune,
        rol
      })
    }
    return scrapCause
  } catch (error) {
    console.error(error)
  }
}

module.exports = {
  Query: {
    // Users
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
      // console.log('usersResult')
      // console.log(usersResult)
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
    // Case
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
      // const user = await Users.findOne({ email: currentUser.email }, { _id: 1 })
      const viewedUpdated = {
        caseBankruptcy: id,
        viewedBy: user._id
      }

      await CasesViewed.findOneAndUpdate(
        { ...viewedUpdated },
        { $set: { ...viewedUpdated } },
        { new: true, upsert: true }
      )
      // cc.createAt = cc._id.getTimestamp()
      // console.log('viewedUpdated')
      // console.log('cc')
      // console.log(cc)
      return cc
    },
    getUserUnreadMessages: async (_, { userId }, { Messages }) => {
      const userMessages = await Messages.find({
        to: userId,
        status: false
      }).populate('to', '-password')
      // console.log('getUserUnreadMessages')
      // console.log(userMessages)
      return userMessages
    },
    getUserMessages: async (_, { userId }, { Messages }) => {
      const userMessages = await Messages.find({ to: userId }).populate(
        'to',
        '-password'
      )
      // console.log('getUserMessages')
      // console.log(userMessages)
      return userMessages
    },
    // Search
    // searchMovements: async (_, { searchTerm, caseId }, { Cases }) => {
    searchMovements: async (_, { input: { searchTerm } }, { Cases }) => {
      // if (searchTerm) {
      const searchResult = await Cases.find(
        // mongoose.Types.ObjectId(caseId)
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
      // }
    },
    searchUsers: async (_, { searchTerm }, { Users }) => {
      // if (searchTerm) {
      //     const searchResult = await Users.find(
      //         { $text: { $search: searchTerm } },
      //         { score: { $meta: 'textScore' } }
      //     ).sort({
      //         score: { $meta: 'textScore' },
      //         joinDate: 'desc'
      //     })
      //     return searchResult
      // }
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
      // const totalUsers = Users.countDocuments()
      // return { checksws, totalChecks, totalUsers}
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
      // console.log(checksws)
      const sanChecks = sortByDate(checksws)
      return checksws
    },
    getCasesInfo: async (_, args, { CasesViewed, Users, currentUser }) => {
      const user = await gu(Users, currentUser)
      // const user = await Users.findOne({ email: currentUser.email }, { id: 1 })
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
      // console.log('user ', user)
      // console.log('docsColection ', docsColection)
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
      // console.log(activities)
      return activities
    },
    getActivitiesByDate: async (_, { days }, { Activity }) => {
      const dd = Date.now()
      const gte = DateTime.fromMillis(dd).toISODate()
      const lte = DateTime.fromMillis(dd).plus({ days }).toISODate()
      // const gte = DateTime.fromMillis(dd).minus({ days }).toISODate()
      // const lte = DateTime.fromMillis(dd).toISODate()

      // console.log(days)
      // console.log(lte)
      // console.log(gte)

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
      // console.log(activities.length)
      return activities
    }
  },
  Upload: GraphQLUpload,
  Mutation: {
    // uploadFile: async (_, { file }, { File }) => {
    //   // Creates an images folder in the root directory
    //   mkdir('images', { recursive: true }, err => {
    //     if (err) throw err
    //   })
    //   // Process upload
    //   const upload = await processUpload(file)
    //   // await File.create(upload);
    //   console.log(upload)
    //   return {
    //     messageBody: 'El archivo fue cargado de manera satisfactoria',
    //     messageType: 'is-primary',
    //     messageImage: null
    //   }
    // },
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
        // throw new Error({ messageBody: 'La contraseña anterior es incorrecta', messageType: 'success', messageImage: null })
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
        console.log(er)
      }
    },
    deleteActivity: async (_, { id }, { Activity }) => {
      try {
        const asd = await Activity.findOneAndRemove({
          _id: id
        })
        return {
          messageBody: 'La actividad fue eliminada de manera satisfactoria',
          messageType: 'is-primary',
          messageImage: null
        }
      } catch (error) {
        console.log(er)
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
    // addInvolvedUsers: async (_, { caseId }, { Cases, Users }) => {
    //   const newMessage = {
    //     messageBody,
    //     messageUser: userId
    //   }
    //   const post = await Posts.findOneAndUpdate(
    //     { _id: postId },
    //     { $push: { message: { $each: [newMessage], $position: 0 } } },
    //     { new: true }
    //   ).populate({
    //     path: 'message.messageUser',
    //     model: 'Users'
    //   })
    //   return post.message[0]
    // },
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
        const cc = await Cases.findOne({
          rol: `C-${input.rol}-${input.era}`,
          court: courtNameById(input.court)
        })
        if (cc) {
          return {
            messageBody: 'La causa existe en el sistema',
            messageType: 'is-danger',
            messageImage: null
          }
        }

        const cParams = {
          typeSearch: input.typeSearch,
          rol: `C-${input.rol}-${input.era}`,
          tribune: input.court
        }

        console.log('cParams ', cParams)

        // const scrapData = await scrapRawData()
        const scrapData = await scrapRawData(cParams)
        scrapData.createdBy = new mongoose.Types.ObjectId(input.createdBy)
        // console.log('input.createdBy')
        // console.log(input.createdBy)
        const ccr = await new Cases({
          ...scrapData
        }).save()

        const userInvolved = input.involved.map(a => {
          return {
            status: 'COOPERADOR',
            notification: false,
            userIn: a._id
          }
        })

        // console.log('userInvolved')
        // console.log(userInvolved)

        const casesInvolved = {
          case: ccr._id,
          involved: userInvolved
        }

        // console.log('casesInvolved')
        // console.log(casesInvolved)

        // const involved = await new InvolvedUsersCase({
        await new InvolvedUsersCase({
          ...casesInvolved
        }).save()

        await CasesReviews.findOneAndUpdate(
          { case: ccr._id },
          { $set: { case: ccr._id } },
          { upsert: true }
        )

        // console.log('involved')
        // console.log(involved)
        // Para los permisos de usuarios denteo de la causa
        // const cs = await CasesSettings.findOne({ _id: ccr._id })
        // const settings = {
        //   caseBankruptcy: ccr._id,
        //   allowed: [
        //     {
        //       userAllow: input.createdBy,
        //       permisions: 0
        //     }
        //   ]
        // }

        // if (!cs)
        //   await new CasesSettings({
        //     ...settings
        //   }).save()

        const users = await Users.find({}, 'email name')
        for (let eIndex = 0; eIndex < users.length; eIndex++) {
          let eCause = users[eIndex]._doc ? users[eIndex]._doc : users[eIndex]
          if (eCause._id !== ccr.createdBy) {
            // console.log('eCause ', eCause)
            // console.log('ccr ', ccr)
            let eCcr = ccr._doc ? ccr._doc : ccr
            csa = {
              name: eCause.name,
              cause: { ...eCcr }
            }

            const mailOptions = {
              from: config.from, // sender address
              to: eCause.email,
              subject: 'Nueva Causa Agregada',
              html: await addNewCause(csa)
            }

            abstractSendMail(mailOptions)
            // console.log('mail send to ', eCause.email)
          }
        }

        return {
          messageBody: 'La causa se importo de manera satifastoria',
          messageType: 'is-primary',
          messageImage: null
        }
      } catch (error) {
        console.log(error)
        return {
          messageBody:
            'El servidor no esta respondiendo bien, intente en unos minutos',
          messageType: 'is-danger',
          messageImage: null
        }
      }
    },
    updateCase: async (_, { input }, { Cases, CasesUpdated, CasesReviews }) => {
      try {
        const cParams = {
          typeSearch: input.typeSearch,
          rol: input.rol,
          tribune: input.court
        }

        // const scrapData = await scrapRawData()
        const scrapData = await scrapRawData(cParams)
        // scrapData.createdBy = new mongoose.Types.ObjectId(input.createdBy)
        // console.log('input.createdBy')
        // console.log(input.createdBy)
        // const ccr = await new CasesUpdated({
        await new CasesUpdated({
          ...scrapData
        }).save()

        // console.log(scrapData)

        const cc = await Cases.findOne({
          rol: input.rol,
          court: input.court
        })

        const ccu = await CasesUpdated.findOne({
          rol: input.rol,
          court: input.court
        })

        // let arrMo = []
        // let arrLi = []

        await CasesReviews.findOneAndUpdate(
          { case: cc._id },
          { $set: { case: cc._id } },
          { new: true, upsert: true }
        )

        if (
          cc.movementsHistory.length < ccu.movementsHistory.length ||
          cc.litigants.length < ccu.litigants.length
        ) {
          // ccu.movementsHistory.forEach((a, midx) => {
          //   if (midx >= cc.movementsHistory.length) {
          //     arrMo.push(a)
          //   }
          // })
          // ccu.litigants.forEach((a, lidx) => {
          //   if (lidx >= cc.litigants.length) {
          //     arrLi.push(a)
          //   }
          // })

          const upArr = []
          Object.entries(ccu._doc).forEach(([key, val]) => {
            if (key !== '_id' && key !== '__v') {
              upArr.push([key, val])
            }
          })
          const ccuo = Object.fromEntries(upArr)
          // console.log('upArr')
          // console.log(upArr)
          // console.log('object2')
          // console.log(object2)

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

        // console.log('ccr')
        // console.log(ccr)
        // console.log('arr')
        // console.log(arrMo)
        // console.log(arrMo.length)
        // console.log('arrLi')
        // console.log(arrLi)
        // console.log(arrLi.length)

        return {
          messageBody: 'La causa se actualizo de manera satifastoria',
          messageType: 'is-primary',
          messageImage: null
        }
      } catch (error) {
        console.log(error)
        return {
          messageBody:
            'El servidor no esta respondiendo bien, intente en unos minutos',
          messageType: 'is-danger',
          messageImage: null
        }
      }
    },
    addDdor: async (_, args, { Cases }) => {
      const cc = await Cases.find({})
      // console.log(cc)
      let conta = 0
      cc.forEach(async e => {
        const dbt = e.litigants.find(
          i => i.participant === 'DDOR.' || i.participant === 'DDO.'
        )
        const updbt = await Cases.findOneAndUpdate(
          { _id: e._id },
          { $set: { debtor: dbt.name } },
          { new: true }
        )
        conta++
        // console.log(conta)
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
        // console.log(updtInvUsers)
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
          // console.log(userToSend)
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
          // console.log(po)
          // console.log(e)

          // let mailOptions = {
          //   from: config.from, // sender address
          //   to: 'edar.blanco@gmail.com',
          //   subject: 'E-legal Cases Info',
          //   html: `<html>
          //         <head>
          //             <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
          //             <link href="https://fonts.googleapis.com/css?family=Open+Sans:300,400,600,700,800" rel="stylesheet">
          //             <link href="https://fonts.googleapis.com/css?family=Poppins:400,700,900" rel="stylesheet">
          //             <title>{{subject}}</title>
          //             <style media="screen">
          //               *{
          //                 box-sizing: border-box;
          //                 margin: 0;
          //                 padding: 0;
          //               }
          //               html, body{
          //                 font-family: 'Open Sans', sans-serif;
          //                 font-size: 1em;
          //                 color: #4a4a4a;
          //               }
          //               .templates{
          //                 width: 100%;
          //                 height: 100%;
          //                 padding: 100px 0;
          //                 background: #fafafa;
          //               }
          //               .templates .templates-content{
          //                 width: 900px;
          //                 margin: 0 auto;
          //                 box-sizing: border-box;
          //                 background: white;
          //                 box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
          //                 border-radius: 5px;
          //                 overflow: hidden;
          //               }
          //               .templates .templates-content .templates-header{
          //                 display: flex;
          //                 justify-content: space-between;
          //                 align-items: center;
          //                 font-family: 'Poppins', sans-serif;
          //                 background: -webkit-linear-gradient(#0083AE, #1970b9);
          //                 padding: 30px;
          //                 color: white;
          //               }
          //               .templates .templates-content .templates-header h2{
          //                 font-family: 'Poppins', sans-serif;
          //               }
          //               .templates .templates-content .templates-header span{
          //                 font-weight: bold;
          //               }
          //               .templates .templates-content .templates-body{
          //                 padding: 30px;
          //               }
          //               .templates .templates-content .templates-body div{
          //                 font-size: 1.2em;
          //                 display: flex;
          //                 margin-bottom: 25px;
          //               }
          //               .templates .templates-content .templates-body div p{
          //                 font-weight: bold;
          //                 margin-right: 10px;
          //               }
          //               .templates .templates-content .templates-body div span{
          //                 text-align: justify;
          //               }
          //             </style>
          //         </head>
          //           <body>
          //             <div class="templates">
          //               <div class="templates-content">
          //                 <div class="templates-header">
          //                   <h2>E-legal</h2>
          //                   <!-- <span>March 9, 2018 - 10:52 PM</span> -->
          //                 </div>
          //                 <div class="templates-body">
          //                     <div>
          //                       <p> Estimado: ${pps.name}</p>
          //                     </div>
          //                     <div>
          //                       <p>¡Le queremos informar que ha sido añadido a una nueva causa!</p><br />
          //                       <span>Le enviamos esta notificación para hacerle saber que el usuario <b>${userPropietary.name}</b> propietario de la causa <b>${updtInvUsers.rol}</b> del <b>${updtInvUsers.court}</b> lo agrego como <b>${pps.status}</b> a la misma.</span>
          //                     </div>
          //                 </div>
          //               </div>
          //             </div>
          //           </body>
          //         </html>
          //       `
          // }

          // abstractSendMail(mailOptions)
          // console.log(pps)
        })
        return {
          messageBody: `Se actualizaron los usuarios involucrados en la causa`,
          messageType: 'is-success',
          messageImage: null
        }
      } catch (error) {
        return {
          messageBody:
            'El servidor no esta respondiendo bien, intente en unos minutos',
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
          messageBody:
            'El servidor no esta respondiendo bien, intente en unos minutos',
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
            messageImage: null
          }
        }
      } catch (error) {
        return {
          messageBody:
            'El servidor no esta respondiendo bien, intente en unos minutos',
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

        // console.log('activity save')
        // console.log(activity)

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
          messageBody:
            'El servidor no esta respondiendo bien, intente en unos minutos',
          messageType: 'is-danger',
          messageImage: null
        }
      }
    },
    updateActivity: async (_, { input }, { Activity }) => {
      // console.log('input')
      // console.log(input)
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

        activity = await upActivity.populate([
          { path: 'priority' },
          { path: 'caseId', select: '_id cover rol court' },
          { path: 'createdBy', select: '_id name' }
        ])

        // console.log('activity update')
        // console.log(activity)

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
            messageBody:
              'El servidor no esta respondiendo bien, intente en unos minutos',
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
            messageBody:
              'El servidor no esta respondiendo bien, intente en unos minutos',
            messageType: 'is-danger',
            messageImage: null
          }
        }
      }
    }
  }
}
