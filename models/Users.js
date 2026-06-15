const mongoose = require('mongoose')
const md5 = require('md5')
const bcrypt = require('bcrypt')

const UserShema = new mongoose.Schema({
  email: { type: String, trim: true, unique: true },
  password: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  avatar: { type: String },
  joinDate: { type: Date, default: Date.now },
  role: { type: Number, required: true }
})

UserShema.index({
  '$**': 'text'
})

UserShema.pre('save', function (next) {
  this.avatar = `https://gravatar.com/avatar/${md5(this.email)}?d=identicon`
  next()
})

UserShema.pre('save', function (next) {
  if (!this.isModified('password')) {
    return next()
  }
  bcrypt.genSalt(13, (err, salt) => {
    if (err) return next(err)
    bcrypt.hash(this.password, salt, (err, hash) => {
      if (err) return next(err)
      this.password = hash
      next()
    })
  })
})

UserShema.pre('findOneAndUpdate', function (next) {
  const password = this.getUpdate().$set.password
  if (!password) {
    return next()
  }
  try {
    bcrypt.genSalt(13, (err, salt) => {
      if (err) return next(err)
      bcrypt.hash(password, salt, (err, hash) => {
        if (err) return next(err)
        this.getUpdate().$set.password = hash
        next()
      })
    })
  } catch (error) {
    return next(error)
  }
})

UserShema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password)
}

module.exports = mongoose.model('Users', UserShema)
