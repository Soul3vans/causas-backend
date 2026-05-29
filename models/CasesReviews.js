const mongoose = require('mongoose')

const CasesReviewsShema = new mongoose.Schema(
  {
    case: { type: mongoose.Schema.Types.ObjectId, ref: 'Cases' }
  },
  { timestamps: true }
)

module.exports = mongoose.model('CasesReviews', CasesReviewsShema)
