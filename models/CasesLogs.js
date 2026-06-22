const mongoose = require('mongoose')

const CasesLogsSchema = new mongoose.Schema(
  {
    caseId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Cases'
    },
    accesedBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Users'
    },
    accessDate: {
      type: Date,
      default: Date.now
    },
    action: {
      type: String,
      enum: ['VIEW', 'UPDATE', 'SCRAPE', 'DELETE', 'CREATE'],
      default: 'VIEW'
    },
    details: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
)

// Índices para búsquedas rápidas
CasesLogsSchema.index({ caseId: 1, accessDate: -1 })
CasesLogsSchema.index({ accesedBy: 1 })

module.exports = mongoose.model('CasesLogs', CasesLogsSchema)