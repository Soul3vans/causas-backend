const { Schema, model } = require('mongoose')

const PriorityShema = new Schema({
  name: {
    type: String,
    required: true
  },
  color: {
    type: String,
    required: true
  }
})

module.exports = model('Priority', PriorityShema)
