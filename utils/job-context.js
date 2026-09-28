'use strict'
const { AsyncLocalStorage } = require('node:async_hooks')

// Contexto del job en curso (jobId, caseId, processId, fullRol). Permite que
// código profundo (ej. document-persist.helper.js) sepa a qué job pertenece
// sin modificar las firmas de la cadena de funciones.
const jobContext = new AsyncLocalStorage()

module.exports = { jobContext }
