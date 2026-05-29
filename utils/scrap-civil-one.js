'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
exports.scrapCivilOne = void 0
const causes_1 = require('./causes')
const const_1 = require('./causes/helpers/const')
const db_1 = require('./db')
const plugins_1 = require('./plugins')
const scrapCivilOne = async rol => {
  try {
    console.log('Capture the details one civil cause initialized...')
    await db_1.MongoDatabase.connect({
      url: plugins_1.envs.MONGO_URI,
      dbName: plugins_1.envs.MONGO_DB_NAME
    })
    // process.exit();
    const collect = await causes_1.cause.getCivilCauseDetail(rol)
    if (causes_1.cause.hasReplaceCivilDetail) {
      await db_1.CauseCivil.replaceOne(
        { rol },
        causes_1.cause.getCivilDetailReplacement()
      )
    } else {
      await db_1.CauseCivil.insertMany(collect)
      console.log('Collect saved')
    }
    console.log('Process finish')
    // process.exit();
  } catch (error) {
    console.error(error)
    process.exit()
  } finally {
    const timeout = setTimeout(() => {
      console.log('Closing of the process...')
      process.exit(0)
    }, const_1.DEFAULT_TIMEOUT_PROCESS)
    timeout.unref()
  }
}
exports.scrapCivilOne = scrapCivilOne
// export { scrapCivilOne };
// scrapCivilOne("C-392-2024");
