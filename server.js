const express = require('express')
const { ApolloServer, AuthenticationError } = require('apollo-server-express')
const cors = require('cors')
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

// Conectar a MongoDB
MongoDatabase.connect({
  url: envs.MONGO_URI,
  dbName: envs.MONGO_DB_NAME
})

// verificar JWT Token
const getUser = async token => {
  if (token) {
    try {
      return await jwt.verify(token, process.env.SECRET)
    } catch (error) {
      throw new AuthenticationError(
        'Su sesion ha expirado, por favor reingrese sus credenciales'
      )
    }
  }
}

// Tareas programadas (cron jobs)
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
  origin: process.env.CORS_ORIGIN_URI || '*'
}

if (process.env.NODE_ENV === 'production') {
  app.disable('x-powered-by')
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
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
    const token = req.headers['authorization']
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

server.applyMiddleware({ app, cors: corsOptions })

// ============================================================
// 🔥 CAMBIO IMPORTANTE: Usar PORT de Render o 4000 para local
// 🔥 Escuchar en 0.0.0.0 para que Render pueda recibir tráfico
// ============================================================
const PORT = process.env.PORT || 4000
const HOST = '0.0.0.0'

app.listen({ port: PORT, host: HOST }, () =>
  console.log(`🚀 Servidor corriendo en http://${HOST}:${PORT}${server.graphqlPath}`)
)