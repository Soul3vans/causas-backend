const mongoose = require('mongoose')

const scrapingOverflowSchema = new mongoose.Schema({
  caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cases', required: true },
  processId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProcessStatus', required: true },
  fullRol: { type: String, required: true },
  searchParams: { type: mongoose.Schema.Types.Mixed },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Users', required: true },
  createdAt: { type: Date, default: Date.now }
})

scrapingOverflowSchema.index({ createdAt: 1 }) // orden FIFO al drenar

module.exports = mongoose.model('ScrapingOverflow', scrapingOverflowSchema)
