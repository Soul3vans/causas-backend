const { mongooseconnet } = require('../../utils/mongoose-connet')
const { getRandomInt } = require('../../utils/random')
const Cases = require('../../models/Cases')
const Users = require('../../models/Users')
const { scrapRawData } = require('../../utils/scrapper')
const { luxonDateTime } = require('../../utils/dateTime')
const readline = require('readline')
const fs = require('fs')
const path = require('path')

require('dotenv').config({ path: 'variables.env' })
const NOMBRE_ARCHIVO = 'files/cases.csv'

// mongoose connet
mongooseconnet()

async function tst() {
  try {
    let lector = readline.createInterface({
      input: fs.createReadStream(path.resolve(__dirname, NOMBRE_ARCHIVO))
    })

    lector.on('line', async linea => {
      let timer = 0
      const lns = linea.split(';')
      const as = {
        rol: lns[0],
        court: lns[1],
        ddor: lns[2]
      }
      console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
      console.log(
        `Iniciando extracion de datos de la causa ${as.rol} de ${as.court}`
      )
      setTimeout(async () => {
        const createdBy = await Users.find({}).limit(1)

        const ccu = await Cases.findOne({
          rol: as.rol,
          court: as.court
        })

        if (!ccu) {
          const scrapData = await scrapRawData({
            rol: as.rol,
            court: as.court
          })

          // // aki

          scrapData.createdBy = createdBy._id

          await new Cases({
            ...scrapData
          }).save()

          // aki

          console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
          console.log(
            `Los datos de la causa ${as.rol} de ${as.court} se añadieron de manera satifastoria`
          )
        } else {
          console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
          console.log(`Los datos de la causa ${as.rol} de ${as.court} existen`)
        }
      }, timer)
      timer += getRandomInt(33, 145)
    })
  } catch (e) {
    console.error(e)
  }
}

tst()
