'use strict'
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k
        var desc = Object.getOwnPropertyDescriptor(m, k)
        if (
          !desc ||
          ('get' in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k]
            }
          }
        }
        Object.defineProperty(o, k2, desc)
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k
        o[k2] = m[k]
      })
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, 'default', { enumerable: true, value: v })
      }
    : function (o, v) {
        o['default'] = v
      })
var __importStar =
  (this && this.__importStar) ||
  function (mod) {
    if (mod && mod.__esModule) return mod
    var result = {}
    if (mod != null)
      for (var k in mod)
        if (k !== 'default' && Object.prototype.hasOwnProperty.call(mod, k))
          __createBinding(result, mod, k)
    __setModuleDefault(result, mod)
    return result
  }
Object.defineProperty(exports, '__esModule', { value: true })
exports.envs = void 0
const env = __importStar(require('env-var'))
const node_path_1 = require('node:path')
const dotenv = __importStar(require('dotenv'))
// if (process.env.NODE_ENV !== 'production') dotenv.config({
//   path: (0, node_path_1.resolve)(__dirname, '../../variables.env')
// })
process.env.NODE_ENV !== 'production'
  ? dotenv.config({
      path: (0, node_path_1.resolve)(__dirname, '../../variables.env')
    })
  : dotenv.config({
      path: (0, node_path_1.resolve)(__dirname, '../../.env')
    })
exports.envs = {
  RUT: env.get('RUT').required().asString(),
  PASS: env.get('PASS').required().asString(),
  BROWSER_HEADLESS: process.env.NODE_ENV === 'production',
  // BROWSER_HEADLESS: env.get('BROWSER_HEADLESS').required().asBool(),
  MONGO_URI: env.get('MONGO_URI').required().asUrlString(),
  MONGO_USER: env.get('MONGO_USER').asString(),
  MONGO_PASS: env.get('MONGO_PASS').asString(),
  MONGO_DB_NAME: env.get('MONGO_DB_NAME').required().asString(),
  NODE_ENV: env.get('NODE_ENV').default('development').asString()
}
