'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
exports.MongoDatabase = void 0
const mongoose_1 = __importDefault(require('mongoose'))

class MongoDatabase {
  static async connect(options) {
    const { url, dbName } = options
    
    try {
      // Configurar opciones de conexión
      const connectionOptions = {
        // Si la URL NO incluye el nombre de la BD, usamos dbName
        // Si la URL ya lo incluye, no es necesario
        dbName: dbName,
        
        // 🔑 FORZAR IPv4 - SOLUCIONA EL PROBLEMA DE DNS EN WINDOWS
        family: 4,
        
        // Timeouts para evitar que se cuelgue
        serverSelectionTimeoutMS: 30000,  // 30 segundos
        socketTimeoutMS: 45000,           // 45 segundos
        connectTimeoutMS: 30000,          // 30 segundos
        
        // Opciones adicionales para estabilidad
        maxPoolSize: 10,
        minPoolSize: 2,
        retryWrites: true,
        retryReads: true,
      }
      
      // Si la URL ya tiene el nombre de la BD, no usamos dbName en la URL
      let connectionUrl = url
      
      // Si la URL NO contiene el nombre de la BD y tenemos dbName
      if (dbName && !url.includes(dbName) && !url.endsWith('/')) {
        // Asegurarse de que la URL termine con /
        if (!connectionUrl.endsWith('/')) {
          connectionUrl = connectionUrl + '/'
        }
        connectionUrl = connectionUrl + dbName
      }
      
      console.log(`📡 Conectando a MongoDB...`)
      console.log(`🔗 URL: ${connectionUrl.replace(/\/\/[^@]+@/, '//***:***@')}`) // Oculta credenciales
      
      await mongoose_1.default.connect(connectionUrl, connectionOptions)
      
      console.log('✅ MongoDB conectado exitosamente')
      console.log(`📊 Base de datos: ${mongoose_1.default.connection.db.databaseName}`)
      
      // Manejar eventos de conexión
      mongoose_1.default.connection.on('error', (err) => {
        console.error('❌ Error en conexión MongoDB:', err)
      })
      
      mongoose_1.default.connection.on('disconnected', () => {
        console.warn('⚠️ MongoDB desconectado')
      })
      
      mongoose_1.default.connection.on('reconnected', () => {
        console.log('🔄 MongoDB reconectado')
      })
      
    } catch (error) {
      console.error('❌ Error conectando a MongoDB:', error.message)
      console.error('📝 Detalles:', error)
      throw error
    }
  }
  
  // Método adicional para verificar la conexión
  static async ping() {
    try {
      await mongoose_1.default.connection.db.admin().ping()
      return true
    } catch (error) {
      console.error('❌ Error haciendo ping a MongoDB:', error.message)
      return false
    }
  }
}

exports.MongoDatabase = MongoDatabase