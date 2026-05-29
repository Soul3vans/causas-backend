const nodemailer = require('nodemailer')
const { config } = require('./../config/mail')

const abstractSendMail = _options => {
  const transporter = nodemailer.createTransport(config.server)
  //   transporter.use('compile', nehbs({viewPath: 'views/email', extName: '.hbs'}))
  let reponse
  let mailOptions = {
    from: _options.from, // sender address
    to: _options.to,
    subject: _options.subject,
    html: _options.html
    // template: _options.template, // html body''
    // context: _options.context
  }
  transporter.verify((error, success) => {
    if (error) {
      console.log(error)
      //   if (_options.res.message !== null) {
      //     return _options.res.respuesta.status(200).send({
      //       message: {
      //         type: 'alert',
      //         message: 'notserver',
      //         image: 'alert'
      //       }
      //     })
      //   }
    } else {
      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.log(error)
          //   if (_options.res.message !== null) {
          //     return _options.res.respuesta.status(200).send({
          //       message: {
          //         type: 'alert',
          //         message: 'notserver',
          //         image: 'alert'
          //       }
          //     })
          //   }
        }
        console.log('message sent to ' + mailOptions.to)
        // if (_options.res.message !== null) {
        //   return _options.res.respuesta.status(200).send({
        //     message: {
        //       type: 'success',
        //       message: _options.res.message,
        //       image: 'check'
        //     }
        //   })
        // }
      })
    }
  })
  transporter.close()

  //   return { respond }
}

module.exports = { abstractSendMail }
