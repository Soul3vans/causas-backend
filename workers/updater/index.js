const { mongooseconnet } = require('../../utils/mongoose-connet')
const { getRandomInt } = require('../../utils/random')
const Cases = require('../../models/Cases')
const CasesUpdated = require('../../models/CasesUpdated')
const CasesReviews = require('../../models/CasesReviews')
const { scrapRawData } = require('../../utils/scrapper')
const { DateTime } = require('luxon')
const { luxonDateTime } = require('../../utils/dateTime')
require('dotenv').config({ path: 'variables.env' })

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

    const totalCasesToUpdate = await CasesReviews.find({
      // updatedAt: { $lte: new Date('2022-03-26') }
      updatedAt: { $lte: new Date(pp) }
    })

    let limitDocsUpdate
    let casesToUpdate = Math.round(totalCases.length / 3)
    totalCasesToUpdate.length >= casesToUpdate
      ? (limitDocsUpdate = casesToUpdate)
      : (limitDocsUpdate = totalCasesToUpdate.length)

    console.log('limitDocsUpdate')
    console.log(limitDocsUpdate)

    const cDocsUpdate = await CasesReviews.find(
      {
        updatedAt: { $lte: new Date(pp) }
      },
      null,
      { limit: limitDocsUpdate }
    ).populate('case', 'rol court')

    // console.log('cDocsUpdate')
    // console.log(cDocsUpdate)

    if (cDocsUpdate.length > 0) {
      let timer = 0
      cDocsUpdate.forEach(async a => {
        setTimeout(async () => {
          console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
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
      })
    }

    // console.log('casesToUpdate')
    // console.log(casesToUpdate)
    // console.log('totalCases')
    // console.log(totalCasesToUpdate.length)

    // totalCases.forEach(async a => {
    //   await CasesReviews.findOneAndUpdate(
    //     { case: a._id },
    //     { $set: { case: a._id } },
    //     { upsert: true }
    //   )
    // })

    // const cDocsUpdate = await CasesReviews.aggregate([
    //   {
    //     $project: {
    //       updatedAt: 1,
    //       case: 1,
    //       // rol: 1,
    //       // court: 1
    //     }
    //   },
    //   {
    //     $match: {
    //       $and: [
    //         // { updatedAt: { $lte: new Date(pp) } }
    //         { updatedAt: { $lte: new Date('2022-03-26') } }
    //       ]
    //     }
    //   },
    //   {
    //     $project: {
    //       updatedAt: 1
    //       case: 1,
    //       // rol: 1,
    //       // court: 1
    //     }
    //   },
    //   {
    //     $sort: {
    //       updatedAt: 1
    //     }
    //   },
    //   { $limit: limitDocsUpdate }
    // ])
  } catch (err) {
    console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
    console.log(err)
  }
  //   console.log(cs)
  //   for (const i = 0; i < docs.length; i++) console.log(a)
}
console.log('cs1')
tst()
