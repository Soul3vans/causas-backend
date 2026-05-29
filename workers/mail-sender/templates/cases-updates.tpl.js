const { DateTime } = require('luxon')
const { luxonDateTime } = require('../../../utils/dateTime')

module.exports = {
  casesUpdateds: async ({ user, cases, totalCases, totalCasesToUpdate }) => {
    let sMo = ''

    for (let cIndex = 0; cIndex < cases.length; cIndex++) {
      const cElement = cases[cIndex]
      if(cElement.rol !== undefined && cElement.rol !== null){
      sMo += `<div>
                <p class="case-title">Causa: ${cElement.rol} | ${cElement.cover} de ${cElement.court}
                </p>
              </div>\n
              <div>
                <span>`
      if (cElement.movementsHistory.length > 0) {
        sMo += `<br />
                  <b>Movimientos</b>
                   <ul>
                `
        for (
          let mIndex = 0;
          mIndex < cElement.movementsHistory.length;
          mIndex++
        ) {
          const mElement = cElement.movementsHistory[mIndex]
          sMo += `<li><b>${mElement.procedure}</b> - <b>${
            mElement.descProcedure
          }</b> - <span class="case-date">${luxonDateTime(
            mElement.dateProcedure,
            DateTime.DATE_MED_WITH_WEEKDAY
          )}</span></li>\n`
        }
        sMo += `</ul>`
      }

      if (cElement.litigants.length > 0) {
        sMo += `<br />
          <b>Litigantes</b>
          <ul>`

        for (let lIndex = 0; lIndex < cElement.litigants.length; lIndex++) {
          const lElement = cElement.litigants[lIndex]
          sMo += `<li><b>${lElement.name}</b> - <b>${lElement.participant}</b></li>\n`
        }
      }
      sMo += `</ul></span></div><br /><hr />`
     }
    }

    return `<html>
              <head>
                  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
                  <link href="https://fonts.googleapis.com/css?family=Open+Sans:300,400,600,700,800" rel="stylesheet">
                  <link href="https://fonts.googleapis.com/css?family=Poppins:400,700,900" rel="stylesheet">
                  <title>Información de actualización de causas - ${luxonDateTime(
                    false,
                    DateTime.DATE_MED_WITH_WEEKDAY
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

        .templates .templates-content .templates-body div, .templates .templates-content .templates-footer div {
            font-size: 1.2em;
            display: flex;
            margin-bottom: 25px;
        }

        .templates .templates-content .templates-body div p {
            font-weight: bold;
            margin-right: 10px;
        }

        .templates .templates-content .templates-body div span, .templates .templates-footer div span {
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
                            <p> Estimado: ${user.name}</p>
                          </div>
                          <div>
                            <p>¡Le queremos informar que; de un total de ${
                              totalCases === 1
                                ? totalCases + ' causa existente '
                                : totalCases + ' causas existentes '
                            } ${
      totalCasesToUpdate === 1
        ? 'se encontro ' + totalCasesToUpdate + ' actualizaci&oacute;n '
        : 'fueron encontradas ' + totalCasesToUpdate + ' actualizaciones '
    } !</p><br />
                          </div>
                          ${sMo !== '' ? sMo : 'nada'}
                     </div>
                    </div>
                    <div class="templates-footer">
                     <div>
                        <span>
                            Atte el equipo de E-legal
                        </span>
                      </div>
                    </div>
                  </div>
                </body>
              </html>
            `
  }
}
