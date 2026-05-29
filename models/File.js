const mongoose = require('mongoose')

const FileSchema = new mongoose.Schema({
    filename: { type: String, required: true },
    mimetype: { type: String, required: true },
    path: { type: String, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Users' }
})

FileSchema.index({
    '$**': 'text'
})

module.exports = mongoose.model('File', FileSchema)