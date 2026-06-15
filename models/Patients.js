const mongoose = require('mongoose')

const PatientsSchema = new mongoose.Schema({
    name: { type: String, required: true },
    lastname: { type: String, required: true },
    imageUrl: { type: String },
    service: { type: Number, required: true },
    bed: { type: Number, required: true },
    state: { type: String, required: true },
    sex: { type: Number, required: true },
    createdDate: { type: Date, default: Date.now() },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Users' }

})

PatientsSchema.index({
    '$**': 'text'
})

module.exports = mongoose.model('Patients', PatientsSchema)