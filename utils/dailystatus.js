'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
exports.run = void 0
const scrape_daily_1 = require('./causes/daily-status/scrape-daily')
const const_1 = require('./causes/helpers/const')
const db_1 = require('./db')
const plugins_1 = require('./plugins')
const run = async () => {
  try {
    console.log('Connecting to MongoDB...')
    await db_1.MongoDatabase.connect({
      url: plugins_1.envs.MONGO_URI,
      dbName: plugins_1.envs.MONGO_DB_NAME
    })
    console.log('Starting scrapeDaily process...')
    await (0, scrape_daily_1.scrapeDaily)(
      { day: 23, month: 10, year: 2024 },
      async rawData => {
        console.log(`Processing ${rawData.length} civil cases...`)
        await Promise.all(
          rawData.map(
            async cause =>
              await db_1.CauseCivilUpdater.replaceOne(
                { rol: cause.rol },
                cause,
                {
                  upsert: true
                }
              )
          )
        )
        console.log('Civils cases saved successfully')
      }
    )
    console.log('Process daily query completed.')
  } catch (error) {
    console.error(error)
    process.exit()
  } finally {
    const timeout = setTimeout(() => {
      console.log('Closing of the process...')
      // process.exit(0)
    }, const_1.DEFAULT_TIMEOUT_PROCESS)
    timeout.unref()
  }
}
exports.run = run;
// (0, exports.run)()
