module.exports = {
  getRandomInt: (min, max) => {
    return (Math.floor(Math.random() * (max - min)) + min) * 1000
  }
}
// const { luxonDateTime } = require('./dateTime')
// const getRandomInt = (min, max) => {
//   return (Math.floor(Math.random() * (max - min)) + min) * 1000
// }

// const sdf = [123, 234, 345, 456]

// let timer = 10
// let setInt
// sdf.forEach(a => {
//   const setTi = setTimeout(() => {
//     console.log('setTimeout', luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
//     console.log('')
//   }, timer)
//   console.log('timer', timer)
//   timer += getRandomInt(2, 10)

//   // setInt = setInterval(() => {
//   //   console.log('timer', timer)
//   //   console.log('setInterval', luxonDateTime(false, DateTime.DATETIME_FULL_WITH_SECONDS))
//   // }, timer)
//   // timer += getRandomInt(2, 5)
// })

// clearInterval(setInt)
