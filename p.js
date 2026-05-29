const nodemailer = require('nodemailer')

const config = {
  from: 'no-reply@dealersuites.app',
  // Array address
  arrayAddress: ['edar.blanco@gmail.com'],
  server: {
    // host: '127.0.0.1', // local hostname
    host: 'a2plvcpnl34093.prod.iad2.secureserver.net', // remote hostname
    // host: '192.168.1.3', // remote hostname
    secure: true, // use SSL
    port: 465, // port for secure SMTP
    // transportMethod: 'SMTP', // default is SMTP. Accepts anything that nodemailer accepts
    auth: {
      user: 'no-reply@dealersuites.app',
      pass: 'Flautoreserve2020'
      // user: 'pepitoperez@hws.sld.cu',
      // pass: 'Qwert123.'
    },
    tls: {
      // do not fail on invalid certs
      rejectUnauthorized: false
    },
    logger: true,
    debug: true
  }
}

const transporter = nodemailer.createTransport(config.server)
const addr = 'jgonzalez@commonwealth.cl'

let mailOptions = {
  from: config.from, // sender address
  to: addr,
  subject: 'E-legal Cases Info',
  html: `<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <link href="https://fonts.googleapis.com/css?family=Open+Sans:300,400,600,700,800" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css?family=Poppins:400,700,900" rel="stylesheet">
    <title>{{subject}}</title>
    <style media="screen">
      *{
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      html, body{
        font-family: 'Open Sans', sans-serif;
        font-size: 1em;
        color: #4a4a4a;
      }
      .templates{
        width: 100%;
        height: 100%;
        padding: 100px 0;
        background: #fafafa;
      }
      .templates .templates-content{
        width: 900px;
        margin: 0 auto;
        box-sizing: border-box;
        background: white;
        box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
        border-radius: 5px;
        overflow: hidden;
      }
      .templates .templates-content .templates-header{
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-family: 'Poppins', sans-serif;
        background: -webkit-linear-gradient(#0083AE, #1970b9);
        padding: 30px;
        color: white;
      }
      .templates .templates-content .templates-header h2{
        font-family: 'Poppins', sans-serif;
      }
      .templates .templates-content .templates-header span{
        font-weight: bold;
      }
      .templates .templates-content .templates-body{
        padding: 30px;
      }
      .templates .templates-content .templates-body div{
        font-size: 1.2em;
        display: flex;
        margin-bottom: 25px;
      }
      .templates .templates-content .templates-body div p{
        font-weight: bold;
        margin-right: 10px;
      }
      .templates .templates-content .templates-body div span{
        text-align: justify;
      }
    </style>
</head>
  <body>
    <div class="templates">
      <div class="templates-content">
        <div class="templates-header">
          <h2>E-legal</h2>
          <!-- <span>March 9, 2018 - 10:52 PM</span> -->
        </div>
        <div class="templates-body">
            <div>
              <p> Estimado: <b>Jaime Pedro Gonzalez Tobar</b></p>
            </div>
            <div>
              <p>¡Tiene nuevos movimientos pendientes!</p><br />
              <span>Le enviamos esta notificación para hacerle saber que hay nuevos movimientos de sus causas abiertas</span>
            </div>
        </div>
      </div>
    </div>
  </body>
</html>
`
}

transporter.verify(function (error, success) {
  if (error) {
    console.log(error)
  } else {
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.log(error)
      }
    })
    console.log('Server is ready to take our messages')
  }
})

transporter.close()

const a = ['asd', 'sad', 'ytgfh']

for (let [e, i] of a.entries()) {
  console.log(e, i)
}
