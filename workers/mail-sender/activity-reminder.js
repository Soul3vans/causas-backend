// const { mongooseconnet } = require('../../utils/mongoose-connet')
const Activity = require('../../models/Activity')
const { activityReminder } = require('./templates/activity-reminder.tpl')
const { config } = require('../../config/mail')
const { abstractSendMail } = require('../../utils/mail')
const { DateTime } = require('luxon')
const { luxonDateTime } = require('../../utils/dateTime')
process.env.NODE_ENV === 'production'
  ? require('dotenv').config({ path: '.env' })
  : require('dotenv').config({ path: 'variables.env' })

const sendActivityReminder = async function () {
  try {
    console.log('Ejecutando activities reminder')

    // mongoose connet
    // mongooseconnet()
    const dd = Date.now()
    const pps = DateTime.fromMillis(dd).plus({ minutes: 45 }).toISO()
    const ppe = DateTime.fromMillis(dd).plus({ minutes: 120 }).toISO()

    // aki empieza el mailer
    const activitiesByUser = []

    const totalCasesActivities = await Activity.find({
      $and: [
        { startTime: { $gte: new Date(pps) } },
        { startTime: { $lte: new Date(ppe) } }
      ]
    }).populate([
      { path: 'caseId', select: '_id cover rol court' },
      { path: 'createdBy', select: '_id name email' }
    ])

    // let finish = false

    if (totalCasesActivities.length > 0) {
      for (let index = 0; index < totalCasesActivities.length; index++) {
        const activity = totalCasesActivities[index]

        const userIndex = activitiesByUser.findIndex(
          a => a.user._id === activity.createdBy._id
        )

        if (userIndex > -1) {
          activitiesByUser[userIndex].activities.push(activity)
        } else {
          activitiesByUser.push({
            user: activity.createdBy,
            activities: [activity]
          })
        }
        // if (totalCasesActivities.length - 1 === index) finish = true
      }

      // console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
      for (let abu = 0; abu < activitiesByUser.length; abu++) {
        const act = activitiesByUser[abu]
        // console.log('act ', act)

        const mailOptions = {
          from: config.from, // sender address
          to: `"${act.user.name}"<${act.user.email}>`,
          subject: 'E-legal Activities Info',
          html: await activityReminder(act)
        }
        abstractSendMail(mailOptions)
        // console.log('mailOptions send to ', act.user.email)
        // let sdf = await activityReminder(act)
        // console.log(sdf)
        // console.log(csa.name, csa.email)
        // console.log(`Enviando correo a ${a.email}`)
        // console.log(c.totalCases)
      }
    } else console.log('ni pinga ')

    // console.log('activitiesByUser ', activitiesByUser)
  } catch (err) {
    console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
    console.log(err)
    // process.exit()
  } finally {
    // setTimeout(() => {
    //   console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
    //   console.log('Proceso Terminado')
    //   process.exit()
    // }, 60000)
    setTimeout(() => {
      console.log(luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
      console.log('Proceso Terminado')
    }, 60000)
  }
}

module.exports = sendActivityReminder
