const mongoose = require('mongoose')

const InvolvedUsersCaseShema = new mongoose.Schema({
  case: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Cases'
  },
  involved: [
    {
      userIn: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Users'
      },
      status: {
        type: String,
        enum: [
          'SELECCIONE',
          'SOCIO',
          'ENCARGADO',
          'COOPERADOR',
          'PROCURADOR',
          'SEGUIDOR',
          'CLIENTE',
          'EXTERNO'
        ],
        default: 'SELECCIONE'
      },
      notification: {
        type: Boolean,
        default: false
      }
    }
  ]
})

module.exports = mongoose.model('InvolvedUsersCase', InvolvedUsersCaseShema)
