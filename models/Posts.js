const mongoose = require('mongoose')

const PostsSchema = new mongoose.Schema({
    title: { type: String, required: true },
    imageUrl: { type: String, required: true },
    categories: { type: [String], required: true },
    description: { type: String, required: true },
    createdDate: { type: Date, default: Date.now() },
    likes: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Users' },
    message: [{
        messageBody: { type: String, required: true },
        messageDate: { type: Date, default: Date.now },
        messageUser: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Users' }
    }]

})

PostsSchema.index({
    '$**': 'text'
})

module.exports = mongoose.model('Posts', PostsSchema)