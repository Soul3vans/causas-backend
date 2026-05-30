const { mongooseconnet } = require('../../utils/mongoose-connet')
const mongoose = require('mongoose')
const Users = require('../../models/Users')
const Cases = require('../../models/Cases')
const CasesUpdated = require('../../models/CasesUpdated')
// const CauseCivilUpdaters = require('../../models/CauseCivilUpdaters')
const InvolvedUsersCase = require('../../models/InvolvedUsersCase')
const CasesReviews = require('../../models/CasesReviews')
const { casesUpdateds } = require('./templates/cases-updates.tpl')
const { noUpdated } = require('./templates/not-updates.tpl')
const { config } = require('../../config/mail')
const { abstractSendMail } = require('../../utils/mail')
const { DateTime } = require('luxon')
const { luxonDateTime } = require('../../utils/dateTime')
const { compareObjects } = require('../../utils/objectsUtilities')
process.env.NODE_ENV === 'production'
  ? require('dotenv').config({ path: '.env' })
  : require('dotenv').config({ path: 'variables.env' })

// mongoose connet
mongooseconnet()

const casesUpdater = async function () {
  try {
    // aki empieza el mailer
    const totalCases = await Cases.find({})
    const totalCasesToUpdate = await CasesUpdated.find({})
    // const totalCasesToUpdate = await CauseCivilUpdaters.find({})
    let cmm = []

    if (totalCasesToUpdate.length > 0) {
      for (let ind = 0; ind < totalCasesToUpdate.length; ind++) {
        const causeScrapToUpdate = totalCasesToUpdate[ind]
        const arrMo = []
        const arrLi = []
        // console.log('causeScrapToUpdate.rol ', causeScrapToUpdate.rol)
        // console.log('causeScrapToUpdate.court ', causeScrapToUpdate.court)
        const cc = await Cases.findOne({
          rol: causeScrapToUpdate.rol,
          court: causeScrapToUpdate.court
        }).populate('createdBy', '-password -joinDate')

        // console.log('cc ext ', cc)
        if (cc !== null && cc !== undefined) {
          if (
            cc.movementsHistory.length <
              causeScrapToUpdate.movementsHistory.length ||
            cc.litigants.length < causeScrapToUpdate.litigants.length
          ) {
            // console.log('cc ', cc)
            for (
              let mIdx = 0;
              mIdx < causeScrapToUpdate.movementsHistory.length;
              mIdx++
            ) {
              const mCauseElement = causeScrapToUpdate.movementsHistory[mIdx]
              const existMovement = cc.movementsHistory.filter(s => {
                const cS = {
                  invoice: s.invoice,
                  stage: s.stage,
                  procedure: s.procedure,
                  descProcedure: s.descProcedure,
                  dateProcedure: s.dateProcedure,
                  page: s.page,
                  book: s.book
                }
                const mCE = {
                  invoice: mCauseElement.invoice,
                  stage: mCauseElement.stage,
                  procedure: mCauseElement.procedure,
                  descProcedure: mCauseElement.descProcedure,
                  dateProcedure: mCauseElement.dateProcedure,
                  page: mCauseElement.page,
                  book: mCauseElement.book
                }
                return compareObjects(cS, mCE)
              })

              if (existMovement.length === 0) arrMo.push(mCauseElement)
            }

            for (
              let lIdx = 0;
              lIdx < causeScrapToUpdate.litigants.length;
              lIdx++
            ) {
              const lCauseElement = causeScrapToUpdate.litigants[lIdx]
              const existLitigant = cc.litigants.filter(
                s => s.rut === lCauseElement.rut
              )

              if (existLitigant.length === 0) arrLi.push(lCauseElement)
            }

            const upArr = []
            Object.entries(causeScrapToUpdate).forEach(([key, val]) => {
              if (key !== '_id' && key !== '__v') {
                upArr.push([key, val])
              }
            })
            // console.log('arrMo')
            // console.log(arrMo.length)
            const rawccuo = Object.fromEntries(upArr)
            let ccuo = rawccuo._doc ? rawccuo._doc : rawccuo
            delete ccuo._id

            cmm.push({
              _id: cc._id,
              rol: causeScrapToUpdate.rol,
              court: causeScrapToUpdate.court,
              cover: causeScrapToUpdate.cover,
              movementsHistory: arrMo,
              litigants: arrLi,
              createdBy: cc.createdBy
            })

            // console.log('ccuo ', ccuo)

            await Cases.findOneAndUpdate(
              { rol: causeScrapToUpdate.rol, court: causeScrapToUpdate.court },
              { $set: { ...ccuo } },
              { new: true }
            )

            // await CasesUpdated.findOneAndDelete({
            //   rol: causeScrapToUpdate.rol,
            //   court: causeScrapToUpdate.court
            // })
          }
        } else {
          const newCauseParams = { ...causeScrapToUpdate.toObject() }
          delete newCauseParams._id
          // newCauseParams.createdBy = new mongoose.Types.ObjectId(
          //   '60f11ce20679c007a59ae0f7'
          // )
          const adminUsers = await Users.find({ role: 0 })
          const createdBy = adminUsers[0]
          // console.log('createdBy ', createdBy)
          delete createdBy.password
          newCauseParams.createdBy = createdBy._id
          const newCause = new Cases(newCauseParams)
          const savedCause = await newCause.save()
          await savedCause.populate('createdBy', '-password -joinDate')

          const rawAdminUsers = adminUsers.filter((a, idx) => idx !== 0)

          // console.log('rawAdminUsers ', rawAdminUsers)

          const userInvolved = rawAdminUsers.map(a => {
            return {
              status: 'COOPERADOR',
              notification: false,
              userIn: a._id
            }
          })
          const casesInvolved = {
            case: savedCause._id,
            involved: userInvolved
          }

          // console.log('casesInvolved')
          // console.log(casesInvolved)

          // const involved = await new InvolvedUsersCase({
          await new InvolvedUsersCase({
            ...casesInvolved
          }).save()

          // console.log('involved')
          // console.log(involved)

          cmm.push({ ...savedCause })

          if (savedCause) {
            // await CasesUpdated.findOneAndDelete({
            //   rol: causeScrapToUpdate.rol,
            //   court: causeScrapToUpdate.court
            // })

            await CasesReviews.findOneAndUpdate(
              { case: savedCause._id },
              { $set: { case: savedCause._id } },
              { upsert: true }
            )
          }
        }
        // Aki termina el analise mailer
      }
    } else {
      console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
      console.log(`Sin causas que actualizar`)
    }

    // console.log('delay ')

    //  aki empieza el send mail
    /**
     * Borrar esto es solo para pruebas,
     * solo la siguiente linea
     * cmm = []
     */
    // cmm = []
    let scm = []
    if (cmm.length > 0) {
      for (let mIndex = 0; mIndex < cmm.length; mIndex++) {
        let cmmCause
        cmm[mIndex]._doc
          ? (cmmCause = cmm[mIndex]._doc)
          : (cmmCause = cmm[mIndex])

        // console.log('cmmCause ', cmmCause)

        let usersInvolved = await InvolvedUsersCase.findOne({
          case: cmmCause._id
        }).populate('involved.userIn', '-password -joinDate')
        // console.log('a')
        // console.log('cmmCause.createdBy ', cmmCause.createdBy)
        // console.log('cmmCause.createdBy usersInvolved ', usersInvolved)
        let createdBy = cmmCause.createdBy._doc
          ? cmmCause.createdBy._doc
          : cmmCause.createdBy

        if (usersInvolved !== null) {
          usersInvolved.involved.push({
            userIn: {
              ...createdBy
            }
          })
        } else {
          usersInvolved = {
            involved: [
              {
                userIn: {
                  ...createdBy
                }
              }
            ]
          }
        }

        // console.log('usersInvolved.involved ', usersInvolved.involved)

        for (let bIndex = 0; bIndex < usersInvolved.involved.length; bIndex++) {
          let bCause = usersInvolved.involved[bIndex]._doc
            ? usersInvolved.involved[bIndex]._doc
            : usersInvolved.involved[bIndex]
          // console.log('bCause ', bCause)
          // console.log('cmmCause.litigants ', cmmCause.litigants)
          if (bCause.userIn !== null) {
            // a. aki toca el usuario
            cmmCause.userIn = bCause.userIn
            const isExistUser = scm.findIndex(
              c => c.user._id.toString() === bCause.userIn._id.toString()
            )

            if (isExistUser === -1) {
              scm.push({
                user: cmmCause.userIn,
                cases: [
                  {
                    rol: cmmCause.rol,
                    court: cmmCause.court,
                    cover: cmmCause.cover,
                    movementsHistory: cmmCause.movementsHistory,
                    litigants: cmmCause.litigants,
                    createdBy: cmmCause.createdBy
                  }
                ]
              })
              // console.log('aki dentro del -1')
              // console.log('cmmCause ', cmmCause._id)
              // console.log(scm[0])
            } else {
              scm[isExistUser].cases.push({
                rol: cmmCause.rol,
                court: cmmCause.court,
                cover: cmmCause.cover,
                movementsHistory: cmmCause.movementsHistory,
                litigants: cmmCause.litigants,
                createdBy: cmmCause.createdBy
              })
            }
          }
        }
      }
    }

    // console.log('scm ', scm)
    if (scm.length > 0) {
      for (let dIndex = 0; dIndex < scm.length; dIndex++) {
        let dCause = scm[dIndex]._doc ? scm[dIndex]._doc : scm[dIndex]
        dCause.totalCases = totalCases.length
        dCause.totalCasesToUpdate = totalCasesToUpdate.length

        // console.log('dCause ', dCause.cases[0].litigants)

        let mailOptions = {
          from: config.from, // sender address
          to: dCause.user.email,
          subject: `Información de actualización de causas - ${luxonDateTime(
            false,
            DateTime.DATETIME_MED_WITH_WEEKDAY
          )}`,
          html: await casesUpdateds(dCause)
        }
        abstractSendMail(mailOptions)
        // console.log('mailOptions ', mailOptions)
        console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
        console.log(`Enviando correo a ${dCause.user.email}`)
      }
    }
    // console.log('CMM')
    // console.log('mail cmm ', cmm)
    if (cmm.length < 1) {
      console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
      console.log('No hay causas actualizadas')
      const users = await Users.find({}, 'email name')
      for (let eIndex = 0; eIndex < users.length; eIndex++) {
        let eCause = users[eIndex]._doc ? users[eIndex]._doc : users[eIndex]
        // console.log('c')
        // console.log(c)
        csa = {
          ...eCause,
          totalCases: totalCases.length
        }
        // console.log('csa ', csa)
        // console.log(csa)
        // console.log('process.env.MAIL_HOST ', process.env.MAIL_HOST)
        // console.log('process.env.MAIL_PASS ', process.env.MAIL_PASS)
        // console.log('process.env.MAIL_USER ', process.env.MAIL_USER)
        const mailOptions = {
          from: config.from, // sender address
          to: csa.email,
          subject: 'E-legal Cases Info',
          html: await noUpdated(csa)
        }

        // console.log('process.env.MAIL_PORT ', process.env.MAIL_PORT)
        // console.log('process.env.MAIL_HOST ', process.env.MAIL_HOST)
        // console.log('process.env.MAIL_PASS ', process.env.MAIL_PASS)
        // console.log('process.env.MAIL_USER ', process.env.MAIL_USER)

        // console.log('process.env.MAIL_HOST ', process.env.MAIL_HOST)
        // console.log('process.env.MAIL_PASS ', process.env.MAIL_PASS)
        // console.log('process.env.MAIL_USER ', process.env.MAIL_USER)
        abstractSendMail(mailOptions)
        // console.log('mailOptions not', csa.email)
        // let sdf = await noUpdated(csa)
        // console.log(sdf)
        // console.log(csa.name, csa.email)
        // console.log(`Enviando correo a ${a.email}`)
        // console.log(c.totalCases)
      }
    }
    // Aki termina el send mail
  } catch (err) {
    console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
    console.log(err)
  } finally {
    setTimeout(() => {
      console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
      console.log('Proceso Terminado')
      //process.exit()
    }, 60000)
  }
}
// casesUpdater()
module.exports = casesUpdater
