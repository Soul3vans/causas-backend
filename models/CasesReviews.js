const mongoose = require('mongoose')

const CasesReviewsSchema = new mongoose.Schema(
  {
    caseId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Cases'
    },
    previousData: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    currentData: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    changes: {
      newMovements: { type: Number, default: 0 },
      litigantsChanged: { type: Boolean, default: false },
      mainFieldsChanged: { type: [String], default: [] }
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Users'
    },
    reviewType: {
      type: String,
      enum: ['MANUAL', 'SCHEDULED', 'AUTO'],
      default: 'MANUAL'
    },
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'ERROR'],
      default: 'PENDING'
    },
    errorMessage: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
)

// Índices
CasesReviewsSchema.index({ caseId: 1, createdAt: -1 })
CasesReviewsSchema.index({ status: 1 })

module.exports = mongoose.model('CasesReviews', CasesReviewsSchema)