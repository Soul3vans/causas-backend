const express = require('express')
const { ApolloServer, AuthenticationError } = require('apollo-server-express')
const cors = require('cors')
const morgan = require('morgan')
const { MongoDatabase } = require('./utils/db')
const { envs } = require('./utils/plugins')
const fs = require('fs')
const path = require('path')
const jwt = require('jsonwebtoken')
const cron = require('node-cron')
const logger = require('./utils/logger')
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
const { startScrapingWorker } = require('./utils/queues/scraping-queue')
const CasesLogs = require('./models/CasesLogs')
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
const ProcessStatus = require('./models/ProcessStatus')

// Conectar a MongoDB con manejo de errores
;(async function connectDB() {
  try {
    await MongoDatabase.connect({
      url: envs.MONGO_URI,
      dbName: envs.MONGO_DB_NAME
    })
    console.log('✅ Conexión a MongoDB establecida correctamente')
  } catch (error) {
    console.error('❌ Error fatal conectando a MongoDB:', error.message)
    console.log('⚠️ El servidor continuará iniciando, pero las consultas a la BD fallarán')
  }
})()

startScrapingWorker({ Cases, Users, ProcessStatus })

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

// Tareas programadas (se ejecutan en segundo plano sin bloquear)
cron.schedule('*/30 * * * *', () => sendActivityReminder())
cron.schedule('00 04 * * *', () => dailyScraps(), { timezone: 'America/Santiago' })
cron.schedule('30 06 * * *', () => casesUpdater(), { timezone: 'America/Santiago' })

// ========== RED DE SEGURIDAD: errores no controlados ==========
// Si algo en background (scraper, cron, etc.) lanza un error que se
// escapa de todos los try/catch, esto lo deja registrado en el log
// en vez de que el proceso muera en silencio sin rastro.
process.on('unhandledRejection', (reason, promise) => {
  logger.error('🔥 Unhandled Rejection no capturada en ningún lado', {
    reason: reason?.message || reason,
    stack: reason?.stack
  })
  console.error('🔥 Unhandled Rejection:', reason)
})

async function gracefulShutdown(signal) {
  logger.info(`📍 Señal ${signal} recibida, cerrando navegador del scraper...`)
  try {
    const { closeScrapeInstance } = require('./utils/scrapper')
    await closeScrapeInstance()
  } catch (e) {
    console.error('Error cerrando navegador en shutdown:', e.message)
  }
  process.exit(0)
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

const app = express()

// ========== MORGAN MIDDLEWARE ==========
app.timeout = 240000; // 4 minutos (aumentado para el scraper)

app.use(morgan('combined', {
  skip: (req, res) => {
	//Para debug descomentar la siguiente linea
	// if (process.env.VERBOSE_LOGS === 'true') return false
    // No loguear preflight CORS
    if (req.method === 'OPTIONS') return true
    // No loguear requests exitosos (200/204) — solo errores
    if (res.statusCode < 400) return true
    return false
  },
  stream: {
    write: (message) => logger.debug(message.trim())
  }
}))
logger.info('📝 Morgan HTTP logging configurado con Winston')

const corsOptions = {
  credentials: true,
  origin: process.env.CORS_ORIGIN_URI || '*'
}

if (process.env.NODE_ENV === 'production') {
  app.disable('x-powered-by')
}

// ========== APOLLO SERVER CON TIMEOUT ==========
const server = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: true,
  playground: true,
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
      CasesLogs,
      CasesViewed,
      Activity,
      File,
      CasesSettings,
      Messages,
      InvolvedUsersCase,
      CasesUpdated,
      CasesReviews,
      Priority,
      ProcessStatus,
      currentUser: await getUser(token)
    }
  },
  // 🔑 TIMEOUT PARA EL SCRAPER (4 minutos)
  timeout: 240000,  // 4 minutos - suficiente para el scraper
})

// Función principal para iniciar el servidor
async function startServer() {
  try {
    await server.start()
    logger.info('✅ Apollo Server iniciado')
    console.log('✅ Apollo Server iniciado')

    server.applyMiddleware({ app, cors: corsOptions })
    logger.info('✅ Middleware de Apollo aplicado')
    console.log('✅ Middleware de Apollo aplicado')

    app.get('/', (req, res) => {
      res.json({
        message: 'Servidor funcionando correctamente',
        status: 'online',
        graphql: `${req.protocol}://${req.get('host')}${server.graphqlPath}`
      })
    })

    app.get('/health', (req, res) => {
      res.status(200).send('OK')
    })

    const PORT = process.env.PORT || 4000
    const HOST = '0.0.0.0'

    app.listen(PORT, HOST, () => {
      console.log(`🚀 Servidor corriendo en http://${HOST}:${PORT}`)
      console.log(`📡 GraphQL endpoint: http://${HOST}:${PORT}${server.graphqlPath}`)
      console.log(`✅ Health check: http://${HOST}:${PORT}/health`)
      logger.info(`🚀 Servidor iniciado en http://${HOST}:${PORT}`)
      logger.info(`📡 GraphQL endpoint: http://${HOST}:${PORT}${server.graphqlPath}`)
    })
  } catch (error) {
    logger.error('❌ Error al iniciar el servidor:', { error: error.message, stack: error.stack })
    console.error('❌ Error al iniciar el servidor:', error)
    process.exit(1)
  }
}

startServer()
