const mongoose = require('mongoose')

// Ciclo de vida SEPARADO del de ScraperJobs: el scraping principal puede
// completarse mientras los documentos siguen procesándose en background.
const DocumentProcessingStatusSchema = new mongoose.Schema(
  {
    fullRol: { type: String, required: true },
    // null si el flujo no pasa por un job (ej. scrapeOnce desde addCase)
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cases', default: null },
    processId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProcessStatus', default: null },
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'ScraperJobs', default: null },

    totalDocuments: { type: Number, required: true },
    processedCount: { type: Number, default: 0 },
    status: { type: String, enum: ['PENDING', 'COMPLETED', 'ERROR'], default: 'PENDING' },

    batchErrors: [
      {
        batchNumber: Number,
        message: String,
        occurredAt: { type: Date, default: Date.now }
      }
    ],

    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
)

DocumentProcessingStatusSchema.index({ processId: 1 })
DocumentProcessingStatusSchema.index({ fullRol: 1, createdAt: -1 })

module.exports = mongoose.model('DocumentProcessingStatus', DocumentProcessingStatusSchema)