const mongoose = require('mongoose')
module.exports = {
  mongooseconnet: () => {
    mongoose
      .connect(`${process.env.MONGO_URI}/${process.env.MONGO_DB_NAME}`, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        family: 4
      })
      .then(() =>
        console.log('Conectado a Mongo correctamente 🚀, BD conectada')
      )
      .catch(err => console.log(err))
  }
}
