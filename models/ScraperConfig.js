const mongoose = require('mongoose')

const SCRAPER_MODES = ['AUTH', 'GUEST']

const ScraperConfigSchema = new mongoose.Schema(
  {
    mode: {
      type: String,
      enum: SCRAPER_MODES,
      default: 'AUTH',
      required: true
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Users',
      required: true
    }
  },
  { timestamps: true }
)

module.exports = mongoose.model('ScraperConfig', ScraperConfigSchema)
module.exports.SCRAPER_MODES = SCRAPER_MODES
