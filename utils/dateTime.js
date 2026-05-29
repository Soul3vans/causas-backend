const { DateTime } = require('luxon')

const luxonDateTime = (dtp, dtpo) => {
  let dt
  dtp ? (dt = DateTime.fromJSDate(dtp)) : (dt = DateTime.now())
  return (
    dt
      .setZone('America/Santiago')
      // .setZone('America/Havana')
      .setLocale('es')
      /**
       * DATE_MED_WITH_WEEKDAY - Fri, Oct 14, 1983
       * DateTime.DATETIME_MED_WITH_WEEKDAY - 'Fri, Oct 14, 1983, 9:30:33 AM'
       * DateTime.DATETIME_FULL_WITH_SECONDS - 'October 14, 1983, 9:30:33 AM EDT'
       */
      .toLocaleString(dtpo)
  )
}

module.exports = {
  luxonDateTime
}
