const express = require('express')
const { ApolloServer, AuthenticationError } = require('apollo-server-express')
const cors = require('cors')
// const { LoggerExtension } = require('apollo-server-logger')
// const mongoose = require('mongoose')
const { MongoDatabase } = require('./utils/db')
const { envs } = require('./utils/plugins')
const fs = require('fs')
const path = require('path')
const jwt = require('jsonwebtoken')
const cron = require('node-cron')
const typeDefsFilePath = path.join(__dirname, 'gql/typeDefs.gql')
const typeDefs = fs.readFileSync(typeDefsFilePath, 'utf-8')
const resolvers = require('./resolvers')
require('dotenv').config({ path: 'variables.env' })

const Users = require('./models/Users')
const Activity = require('./models/Activity')
const File = require('./models/File')
const Posts = require('./models/Posts')
const Patients = require('./models/Patients')
const Checks = require('./models/Checks')
const Cases = require('./models/Cases')
const CasesViewed = require('./models/CasesViewed')
const CasesSettings = require('./models/CasesSettings')
const Messages = require('./models/Messages')
const InvolvedUsersCase = require('./models/InvolvedUsersCase')
const CasesUpdated = require('./models/CasesUpdated')
const CasesReviews = require('./models/CasesReviews')
const Priority = require('./models/Priority')
const sendActivityReminder = require('./workers/mail-sender/activity-reminder')
const dailyScraps = require('./workers/mail-sender/daily-scraps')
const casesUpdater = require('./workers/mail-sender/cases-updater')

// mongoose
//   .connect(`${process.env.MONGO_URI}/${process.env.MONGO_DB_NAME}`, {
//     // useNewUrlParser: true, // DEROGADO EN VERSION MONGODB 6
//     // useUnifiedTopology: true, // DEROGADO EN VERSION MONGODB 6
//     family: 4 // necesario en arch, por cambios del SO k esta priorizando IPv6 sobre IPv4
//   })
//   .then(() => console.log('Conectado a Mongo correctamente 🚀, BD conectada'))
//   .catch(err => console.log(err))

MongoDatabase.connect({
  url: envs.MONGO_URI,
  dbName: envs.MONGO_DB_NAME
})

// verifi JWT Token passes from client
const getUser = async token => {
  if (token) {
    try {
      // console.log(jwt.decode(token))
      return await jwt.verify(token, process.env.SECRET)
    } catch (error) {
      // console.error(error)
      throw new AuthenticationError(
        'Su sesion ha expirado, por favor reingrese sus credenciales'
      )
    }
  }
}

// task Shedule
cron.schedule('*/30 * * * *', () => sendActivityReminder())
cron.schedule('00 04 * * *', () => dailyScraps(), {
  timezone: 'America/Santiago'
})
cron.schedule('30 06 * * *', () => casesUpdater(), {
  timezone: 'America/Santiago'
})

const app = express()

const corsOptions = {
  credentials: true,
  origin: process.env.CORS_ORIGIN_URI
  // origin: '*'
  // origin: (origin, cb) => {
  //   const whitelist = [
  //     "http://localhost:4000/graphql",
  //     "http://localhost:8080",
  //     "https://localhost:4000/graphql",
  //     "https://localhost:8080",
  //   ]

  //   if (whitelist.indexOf(origin) !== -1) {
  //     cb(null, true)
  //   } else {
  //     cb(new Error("Not allowed by CORS"))
  //   }
  // }
}

// app.use(cors(corsOptions))

if (process.env.NODE_ENV === 'production') {
  app.disable('x-powered-by')
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
  // introspection: true,
  // extensions =[() => new ApolloLogExtension({
  //   level: 'info',
  //   prefix: 'apollo:'
  // })],
  // extensions: [() => new LoggerExtension({
  //   // options
  //   tracing: true
  // })],
  formatError: error => {
    error = {
      name: error.name,
      message: error.message.replace('Context creation failed:', '')
    }

    if (error.message.startsWith('Database Error: ')) {
      return new Error('Internal server error')
    }

    return error
  },
  context: async ({ req }) => {
    // const token = req.headers['authorization'] || ''
    const token = req.headers['authorization']
    // console.log(req.headers)
    // console.log(req.body)
    return {
      Users,
      Posts,
      Patients,
      Checks,
      Cases,
      CasesViewed,
      Activity,
      File,
      CasesSettings,
      Messages,
      InvolvedUsersCase,
      CasesUpdated,
      CasesReviews,
      Priority,
      currentUser: await getUser(token)
    }
  }
})

// await server.start()

server.applyMiddleware({ app, cors: corsOptions })

// server.listen().then(({ url }) => {
//   console.log(`Corriendo en ${url} 🚀`)
// })

// para servir los documentos localmente
// app.use('/documents', express.static(path.join(__dirname, './documents')))

app.listen({ port: 4000 }, () =>
  console.log(`🚀 Corriendo en http://localhost:4000${server.graphqlPath}`)
)
