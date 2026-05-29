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
      await mongoose_1.default.connect(`${url}/${dbName}`)
      console.log('Mongo connected!')
    } catch (error) {
      console.log('Mongo connect error')
      throw error
    }
  }
}
exports.MongoDatabase = MongoDatabase
