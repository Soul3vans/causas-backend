const { Schema, model } = require('mongoose')

const ActivitySchema = new Schema({
  name: { type: String, required: true },
  priority: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'Priority'
  },
  caseId: {
    type: Schema.Types.ObjectId,
    // type: String,
    required: true,
    ref: 'Cases'
  },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  createdBy: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'Users'
  }
})

ActivitySchema.index({
  '$**': 'text'
})

module.exports = model('Activity', ActivitySchema)
