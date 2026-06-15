const { Date } = require('mongoose')
const mongoose = require('mongoose')

const CasesLogsShema = new mongoose.Schema(
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
      type: Date
    }
  },
  { timestamps: true }
)

module.exports = mongoose.model('CasesLogs', CasesLogsShema)
