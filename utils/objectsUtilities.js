const compareObjects = function (obj1, obj2) {
  const firstObjectKeys = Object.keys(obj1)
  const secondObjectKeys = Object.keys(obj2)

  if (firstObjectKeys.length !== secondObjectKeys.length) return false

  return firstObjectKeys.every(key => {
    if (obj1[key] === null && obj2[key] === null) return true

    if (obj1[key] === null || obj2[key] === null) return false

    if (typeof obj1[key] === 'object' && typeof obj2[key] === 'object')
      return compareObjects(obj1[key], obj2[key])

    return obj1[key] === obj2[key]
  })
}

module.exports = {
  compareObjects
}
