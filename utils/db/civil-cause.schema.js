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
exports.CauseCivilUpdater = exports.CauseCivil = void 0
const mongoose_1 = __importStar(require('mongoose'))
const AnnexSchema = new mongoose_1.Schema({
  reference: { type: String },
  file: { type: String },
  date: { type: Date }
})
const DocSchema = new mongoose_1.Schema({
  name: { type: String },
  file: { type: String },
  annexs: { type: [AnnexSchema], required: true }
})
const MovementSchema = new mongoose_1.Schema({
  invoice: { type: String },
  document: { type: [DocSchema], required: true },
  stage: { type: String },
  procedure: { type: String },
  book: { type: String },
  descProcedure: { type: String },
  dateProcedure: { type: Date },
  page: { type: Number }
})
const LitigantSchema = new mongoose_1.Schema({
  participant: { type: String },
  rut: { type: String },
  person: { type: String },
  name: { type: String }
})
const CauseCivilSchema = new mongoose_1.Schema(
  {
    rol: { type: String },
    cover: { type: String },
    estAdmin: { type: String },
    process: { type: String },
    admission: { type: Date },
    location: { type: String },
    stage: { type: String },
    processState: { type: String },
    court: { type: String },
    status: { type: String, default: 'ACTIVE' },
    visibility: { type: Boolean, default: false },
    movementsHistory: { type: [MovementSchema], required: true },
    litigants: { type: [LitigantSchema], required: true }
  },
  {
    timestamps: true
  }
)
exports.CauseCivil = mongoose_1.default.model('CauseCivil', CauseCivilSchema)
exports.CauseCivilUpdater = mongoose_1.default.model(
  'CauseCivilUpdater',
  CauseCivilSchema
)
