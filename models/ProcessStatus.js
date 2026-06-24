// models/ProcessStatus.js
const mongoose = require('mongoose')

const processStatusSchema = new mongoose.Schema({
  caseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cases',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Users',
    required: true
  },
  status: {
    type: String,
    enum: ['processing', 'completed', 'error', 'not_found'],
    default: 'processing'
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date,
  errorMessage: String,
  summary: {
    newMovements: { type: Number, default: 0 },
    litigantsChanged: { type: Boolean, default: false },
    mainFieldsChanged: [String]
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 3600000) // 1 hora
  }
})

// Índice TTL para expiración automática
processStatusSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

module.exports = mongoose.model('ProcessStatus', processStatusSchema)