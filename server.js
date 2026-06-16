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

const app = express()

// ========== MORGAN MIDDLEWARE ==========
// Configurar Morgan para usar Winston (logs de HTTP requests)
app.timeout = 120000; // 2 minutos
app.use(morgan('combined', {
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

const server = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: true,   // 👈 Necesario para que el Playground funcione en producción
  playground: true,      // 👈 Habilita la interfaz gráfica de GraphQL
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

// Función principal para iniciar el servidor
async function startServer() {
  try {
    // 1. Iniciar Apollo Server
    await server.start()
    logger.info('✅ Apollo Server iniciado')
    console.log('✅ Apollo Server iniciado')

    // 2. Aplicar middleware a Express
    server.applyMiddleware({ app, cors: corsOptions })
    logger.info('✅ Middleware de Apollo aplicado')
    console.log('✅ Middleware de Apollo aplicado')

    // 3. Rutas adicionales
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

    // 4. Puerto y host
    const PORT = process.env.PORT || 4000
    const HOST = '0.0.0.0'

    // 5. Iniciar servidor HTTP
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

// Ejecutar
startServer()
