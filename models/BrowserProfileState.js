const mongoose = require('mongoose')

const BrowserProfileStateSchema = new mongoose.Schema(
  {
    cookies: { type: mongoose.Schema.Types.Mixed, default: [] },
    localStorageEntries: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
)

module.exports = mongoose.model('BrowserProfileState', BrowserProfileStateSchema)