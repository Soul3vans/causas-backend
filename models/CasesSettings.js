const mongoose = require('mongoose')

const CasesSettingsShema = new mongoose.Schema(
  {
    caseBankruptcy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Cases'
    },
    alloweds: [
      {
        userAllow: {
          type: mongoose.Schema.Types.ObjectId,
          required: true,
          ref: 'Users'
        },
        permissions: {
          type: Number,
          required: true,
          default: 3
        }
      }
    ]
  },
  { timestamps: true }
)

module.exports = mongoose.model('CasesSettings', CasesSettingsShema)
