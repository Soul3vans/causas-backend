'use strict'
var __importDefault = (this && this.__importDefault) || function (mod) {
  return (mod && mod.__esModule) ? mod : { default: mod }
}
Object.defineProperty(exports, '__esModule', { value: true })
exports.runWorkerDocument = runWorkerDocument
const node_path_1 = __importDefault(require('node:path'))
const node_worker_threads_1 = require('node:worker_threads')

function runWorkerDocument (documents, issue, mode, { timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new node_worker_threads_1.Worker(node_path_1.default.resolve(__dirname, './worker.js'))
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    const timer = setTimeout(() => {
      worker.terminate().catch(() => {})
      finish(reject, new Error(`Worker ${mode} superó ${timeoutMs}ms`))
    }, timeoutMs)
    console.log(`🧑‍💻 Iniciando worker (${documents.length} documentos, modo: ${mode})...`)

    worker.postMessage({ documents, issue, mode })

    worker.on('message', (message) => {
      if (message.status === 'success') {
        const processed = message.processed ?? documents.length
        const failed = Array.isArray(message.failed) ? message.failed : []
        console.log(`✅ Worker completado: ${processed} documentos${failed.length ? `, ${failed.length} con error` : ''}`)
        finish(resolve, { processed, failed })
      } else if (message.status === 'progress') {
        console.log(`📊 Progreso: ${message.current}/${message.total} documentos`)
      } else {
        finish(reject, new Error(message.error || 'Error desconocido'))
      }
    })

    worker.on('error', (error) => {
      console.error('❌ Error en worker:', error.message)
      finish(reject, error)
    })

    worker.on('exit', (code) => {
      finish(reject, new Error(code !== 0 ? `Worker exited with code ${code}` : 'Worker terminó sin reportar resultado'))
    })
  })
}
