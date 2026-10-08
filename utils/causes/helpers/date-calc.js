'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
exports.dateCalc = void 0
const { DateTime } = require('luxon')
const dateCalc = (dateString) => {
  const [day, month, year] = dateString.split('/').map((item) => Number(item))
  // Validar que year, month y day sean números válidos
  if (Number.isNaN(day) ||
        Number.isNaN(month) ||
        Number.isNaN(year) ||
        year < 1000 ||
        year > 9999 || // Asegurar un rango de año razonable
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > new Date(year, month, 0).getDate() // Verifica que el día esté dentro del rango del mes
  ) {
    return new Date() // Retorna la fecha actual si la validación falla
  }
  // Medianoche de Chile, independiente de la zona del servidor (Render corre en UTC)
  return DateTime.fromObject({ year, month, day }, { zone: 'America/Santiago' }).toJSDate()
}
exports.dateCalc = dateCalc
