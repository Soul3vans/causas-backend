const mongoose = require('mongoose')

const UsersLogsShema = new mongoose.Schema(
  {
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

module.exports = mongoose.model('UsersLogs', UsersLogsShema)
