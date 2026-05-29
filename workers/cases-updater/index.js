const { mongooseconnet } = require('../../utils/mongoose-connet')
const { getRandomInt } = require('../../utils/random')
const Cases = require('../../models/Cases')
const CasesUpdated = require('../../models/CasesUpdated')
const CasesReviews = require('../../models/CasesReviews')
const { scrapRawData } = require('../../utils/scrapper')
const { DateTime } = require('luxon')
const { luxonDateTime } = require('../../utils/dateTime')
require('dotenv').config({ path: 'variables.env' })

const dts = DateTime.now()
const hour = dts.setZone('America/Santiago').hour

if (hour >= 17 && hour <= 22) {
  // mongoose connet
  mongooseconnet()

  async function tst() {
    try {
      const dd = Date.now()
      const pp = DateTime.fromMillis(dd).minus({ days: 3 }).toISODate()

      const totalCases = await Cases.find({
        // $and: [
        //   { stage: { $regex: '^((?!Terminada).)*$', $options: 'i' } },
        //   { stage: { $regex: '^((?!Terminado).)*$', $options: 'i' } },
        //   { stage: { $regex: '^((?!Concluida).)*$', $options: 'i' } },
        //   { stage: { $regex: '^((?!Concluido).)*$', $options: 'i' } }
        // ]
        $nor: [
          { stage: { $regex: /Terminada/i } },
          { stage: { $regex: /Terminado/i } },
          { stage: { $regex: /Concluida/i } },
          { stage: { $regex: /Concluido/i } }
        ]
      })
      // const totalCases = await Cases.find({})

      console.log('totalCases.length')
      console.log(totalCases.length)

      // const totalCasesToUpdate = await CasesReviews.find({
      //   // updatedAt: { $lte: new Date('2022-03-26') }
      //   updatedAt: { $lte: new Date(pp) }
      // })

      // let limitDocsUpdate
      // let casesToUpdate = Math.round(totalCases.length / 3)
      // totalCasesToUpdate.length >= casesToUpdate
      //   ? (limitDocsUpdate = casesToUpdate)
      //   : (limitDocsUpdate = totalCasesToUpdate.length)

      // console.log('limitDocsUpdate')
      // console.log(limitDocsUpdate)

      // totalCases.forEach(async a => {
      //   await CasesReviews.findOneAndUpdate(
      //     { case: a._id },
      //     { $set: { case: a._id } },
      //     { upsert: true }
      //   )
      // })

      const cDocsUpdate = await CasesReviews.find(
        {
          // updatedAt: { $lte: new Date(pp) }
        }
        // null,
        // // { limit: limitDocsUpdate }
        // { limit: 4 }
      ).populate('case', 'rol court')

      console.log('cDocsUpdate')
      console.log(cDocsUpdate.length)

      if (cDocsUpdate.length > 0) {
        let timer = 0
        cDocsUpdate.forEach(async a => {
          if (a.case !== null) {
            setTimeout(async () => {
              console.log(
                luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS)
              )
              console.log(`Opteniendo datos de la causa ${a}`)
              // console.log(`Opteniendo datos de la causa ${a.case}`)
              console.log(`Opteniendo datos de la causa ${a.case.rol}`)
              try {
                // aki empieza el update

                const ccu = await CasesUpdated.findOne({
                  rol: a.case.rol,
                  court: a.case.court
                })

                if (!ccu) {
                  const scrapData = await scrapRawData({
                    rol: a.case.rol,
                    court: a.case.court
                  })

                  // aki

                  await new CasesUpdated({
                    ...scrapData
                  }).save()

                  // aki

                  await CasesReviews.findOneAndUpdate(
                    { case: a.case._id },
                    { $set: { case: a.case._id } },
                    { new: true, upsert: true }
                  )

                  console.log(
                    luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS)
                  )
                  console.log(
                    `Los datos de la causa ${a.case.rol} de ${a.case.court} se extrajeron de manera satifastoria`
                  )
                } else {
                  console.log(
                    luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS)
                  )
                  console.log(
                    `Los datos de la causa ${a.case.rol} de ${a.case.court} existen`
                  )
                }

                // aki termina el update
              } catch (error) {
                console.log(error)
              }
            }, timer)
            // clearTimeout(setTime)
            timer += getRandomInt(80, 255)
          } else {
            const delCaseOrphan = await CasesReviews.findOneAndDelete(a._id)
            if (delCaseOrphan) {
              console.log(
                luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS)
              )
              console.log(`Eliminando datos de la causa huerfana: ${a._id}`)
            }
          }
        })
      } else {
        console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
        console.log('Sin causas que actualizar')
        process.exit()
      }
    } catch (err) {
      console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
      console.log(err)
      process.exit()
    }
  }
  console.log('cs1')
  tst()
} else {
  console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
  console.log('Fuera de rango de horario')
  process.exit()
}
