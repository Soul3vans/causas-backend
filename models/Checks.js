const mongoose = require('mongoose')
const md5 = require('md5')
const bcrypt = require('bcrypt')

const ChecksShema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Users' },
    section: { type: String, required: true, trim: true },
    checkDate: { type: Date, default: Date.now, required: true },
    affectations: { type: String, default: 0 },
    observations: { type: String },
})

module.exports = mongoose.model('Checks', ChecksShema)
