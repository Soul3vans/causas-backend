const mongoose = require('mongoose')

const CasesViewedShema = new mongoose.Schema(
  {
    caseBankruptcy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Cases'
    },
    viewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Users'
    },
    updated: {
      type: Date
    }
  },
  { timestamps: true }
)

module.exports = mongoose.model('CasesViewed', CasesViewedShema)
