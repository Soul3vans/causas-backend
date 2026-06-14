const { DateTime } = require('luxon')
const { luxonDateTime } = require('../../../utils/dateTime')

module.exports = {
  caseUpdated: async ({ name, cause, changes }) => {
    return `<html>
              <head>
                  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
                  <link href="https://fonts.googleapis.com/css?family=Open+Sans:300,400,600,700,800" rel="stylesheet">
                  <link href="https://fonts.googleapis.com/css?family=Poppins:400,700,900" rel="stylesheet">
                  <title>Causa Actualizada - ${luxonDateTime(
                    false,
                    DateTime.DATETIME_MED_WITH_WEEKDAY
                  )} - E-legal</title>
                  <style media="screen">
                    * {
                      box-sizing: border-box;
                      margin: 0;
                      padding: 0;
                    }

                    html,
                    body {
                      font-family: 'Open Sans', sans-serif;
                      font-size: 1em;
                      color: #4a4a4a;
                    }

                    .templates {
                      width: 100%;
                      height: 100%;
                      padding: 100px 0;
                      background: #fafafa;
                    }

                    .templates .templates-content {
                      width: 900px;
                      margin: 0 auto;
                      box-sizing: border-box;
                      background: white;
                      box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
                      border-radius: 5px;
                      overflow: hidden;
                    }

                    .templates .templates-content .templates-header {
                      display: flex;
                      justify-content: space-between;
                      align-items: center;
                      font-family: 'Poppins', sans-serif;
                      background: -webkit-linear-gradient(#0083AE, #1970b9);
                      padding: 30px;
                      color: white;
                    }

                    .templates .templates-content .templates-header h2 {
                      font-family: 'Poppins', sans-serif;
                    }

                    .templates .templates-content .templates-header span {
                      font-weight: bold;
                    }

                    .templates .templates-content .templates-body {
                      padding: 30px;
                    }

                    .templates .templates-content .templates-body div, 
                    .templates .templates-content .templates-footer div {
                      font-size: 1.2em;
                      display: flex;
                      margin-bottom: 25px;
                    }

                    .templates .templates-content .templates-body div p {
                      font-weight: bold;
                      margin-right: 10px;
                    }

                    .templates .templates-content .templates-body div span, 
                    .templates .templates-footer div span {
                      text-align: justify;
                    }

                    .templates .templates-footer {
                      width: 900px;
                      margin: 0 auto;
                      margin-top: 2rem;
                    }

                    .templates .templates-footer div {
                      width: 100%;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                    }

                    div span ul {
                      list-style: none;
                    }

                    .case-title {
                      font-size: 1.1em;
                    }

                    .case-date {
                      font-weight: 200;
                      color: #4a4a4a;
                      font-size: 0.95rem;
                    }

                    li a {
                      text-decoration: none;
                      color: #4a4a4a;
                    }

                    li a:hover {
                      text-decoration: underline;
                      font-size: 1.01em;
                      color: #1970b9;
                    }

                    .changes-box {
                      background-color: #f5f5f5;
                      border-left: 4px solid #1970b9;
                      padding: 15px;
                      margin: 20px 0;
                      border-radius: 5px;
                    }

                    .changes-box ul {
                      margin: 10px 0 0 20px;
                    }

                    .changes-box li {
                      margin: 5px 0;
                    }

                    .badge-new {
                      background-color: #28a745;
                      color: white;
                      padding: 2px 8px;
                      border-radius: 12px;
                      font-size: 0.8em;
                      margin-left: 8px;
                    }

                    .highlight {
                      color: #1970b9;
                      font-weight: bold;
                    }

                    hr {
                      margin: 20px 0;
                      border: none;
                      border-top: 1px solid #e0e0e0;
                    }
                  </style>
              </head>
              <body>
                <div class="templates">
                  <div class="templates-content">
                    <div class="templates-header">
                      <h2>E-legal</h2>
                    </div>
                    <div class="templates-body">
                      <div>
                        <p>Estimado/a: ${name}</p>
                      </div>
                      <div>
                        <p>Le comunicamos que la siguiente causa ha sido <span class="highlight">ACTUALIZADA</span></p>
                      </div>
                      
                      <hr>
                      
                      <div>
                        <p>Causa:</p>
                        <span class="case-title">${cause.rol} | ${cause.cover || 'Sin carátula'}</span>
                      </div>
                      
                      <div>
                        <p>Tribunal:</p>
                        <span>${cause.court}</span>
                      </div>
                      
                      <div>
                        <p>Estado:</p>
                        <span>${cause.processState || cause.stage || 'En trámite'}</span>
                      </div>
                      
                      <div>
                        <p>Última actualización:</p>
                        <span class="case-date">${new Date(cause.scrapedData?.lastScrapedAt || cause.lastUpdate || Date.now()).toLocaleString('es-CL')}</span>
                      </div>
                      
                      <div class="changes-box">
                        <p><strong>📋 Cambios detectados en la causa:</strong></p>
                        <span>${changes || '<p>Se han producido cambios en los datos de la causa.</p>'}</span>
                      </div>
                      
                      <div>
                        <p>🔗 Acceso rápido:</p>
                        <span><a href="${process.env.FRONTEND_URL || 'https://e-legal.app'}/cases/${cause._id}">Ver causa en el sistema</a></span>
                      </div>
                      
                      <hr>
                      
                      <div>
                        <p>ℹ️ Información adicional:</p>
                        <span>Esta notificación se genera automáticamente cuando el sistema detecta cambios en las causas que sigues. 
                        Para modificar tus preferencias de notificación, accede a tu perfil en el sistema.</span>
                      </div>
                    </div>
                  </div>
                  <div class="templates-footer">
                    <div>
                      <span>
                        Atentamente,<br>
                        El equipo de E-legal
                      </span>
                    </div>
                  </div>
                </div>
              </body>
            </html>`
  }
}