// const { mongooseconnet } = require('../../utils/mongoose-connet')
const { DateTime } = require('luxon')
const { luxonDateTime } = require('../../utils/dateTime')
const scrapeDaily = require('../../utils/causes/daily-status/scrape-daily')
const CasesUpdated = require('../../models/CasesUpdated')
process.env.NODE_ENV === 'production'
  ? require('dotenv').config({ path: '.env' })
  : require('dotenv').config({ path: 'variables.env' })

// mongoose connet
// mongooseconnet()

const dailyScraps = async function () {
  try {
    console.log('Iniciando Daily Scraping')
    const yesterDay = DateTime.now()
      .setZone('America/Santiago')
      .minus({ days: 1 })
      .toISODate()

    // yesterDay 2024-11-08

    const yesterDayParts = yesterDay.split('-')

    await (0, scrapeDaily.scrapeDaily)(
      {
        day: yesterDayParts[2],
        month: yesterDayParts[1],
        year: yesterDayParts[0]
      },
      async rawData => {
        await Promise.all(
          rawData.map(
            async rawCause => {
              let cause = rawCause._doc ? rawCause._doc : rawCause
              const resCause = await CasesUpdated.findOneAndUpdate(
                { rol: cause.rol, court: cause.court },
                { $set: { ...cause } },
                { upsert: true }
              )
              // console.log('resCause ', resCause)
              return resCause
            }
            // CasesUpdated.replaceOne({ rol: cause.rol }, cause, {
            //   upsert: true
            // })
          )
        )
      }
    )

  } catch (err) {
    console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
    console.log(err)
  } finally {
    setTimeout(() => {
      console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
      console.log('Proceso Terminado')
      process.exit()
    }, 60000)
  }
}
// dailyScraps()
module.exports = dailyScraps
