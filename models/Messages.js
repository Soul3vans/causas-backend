const mongoose = require('mongoose')

const MessagesShema = new mongoose.Schema(
  {
    to: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Users'
    },
    title: {
      type: String,
      required: true
    },
    text: {
      type: String,
      required: true
    },
    status: {
      type: Boolean,
      default: false
    },
    type: {
      type: String
      // required: true
    }
  },
  { timestamps: true }
)

module.exports = mongoose.model('Messages', MessagesShema)
