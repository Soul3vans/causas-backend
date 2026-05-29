const config = {
  from: 'no-reply@e-legal.app',
  // Array address
  arrayAddress: ['edar.blanco@gmail.com'],
  server: {
    host: process.env.MAIL_HOST, // local hostname
    // host: 'a2plvcpnl34093.prod.iad2.secureserver.net', // remote hostname
    // host: '107.180.119.31', // remote hostname
    // host: 'smtp-relay.sendinblue.com', // remote hostname
    // host: 'smtp-relay.brevo.com', // remote hostname antiguo sendinblue.com
    // host: '192.168.1.3', // remote hostname
    // secure: true, // use SSL
    // port: 465, // port for secure SMTP
    // port: 587, // port for secure SMTP
    // port: 1025, // port for secure SMTP
    port: process.env.MAIL_PORT, // port for secure SMTP
    // transportMethod: 'SMTP', // default is SMTP. Accepts anything that nodemailer accepts
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS
      // user: 'project.1', // para localhost nodemailer
      // pass: 'secret.1' // para localhost nodemailer
      // user: 'edar.blanco@gmail.com',
      // pass: 'hEA6rpzPG4saUQFY'
      // user: 'no-reply@dealersuites.app',
      // pass: 'Flautoreserve2020'
      // user: 'pepitoperez@hws.sld.cu',
      // pass: 'Qwert123.'
    },
    // tls: {
    //   // do not fail on invalid certs
    //   // rejectUnauthorized: false,
    //   ciphers: 'SSLv3'
    // },
    logger: true,
    debug: true
  }
}

module.exports = { config }
