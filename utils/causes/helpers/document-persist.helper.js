'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
exports.DocumentAnnexPersistHelper = void 0
const parse_string_1 = require('../parse-string')
const worker_launch_document_1 = require('../workers/worker-launch-document')
const code_calc_1 = require('./code-calc')
const tracker = require('./document-processing-tracker')

class DocumentAnnexPersistHelper {
  constructor (cause, annexs, issue, trackingRefs = {}) {
    this.cause = cause
    this.annexs = annexs
    this.issue = issue
    // { caseId, processId, fullRol } — opcional, si no vienen no se trackea
    this.trackingRefs = trackingRefs
  }

  makeFilenames () {
    const docs = []
    this.annexs.forEach((item) => {
      docs.push({
        file: `${this.evaluateAnnex(item).filename}.pdf`,
        reference: item.reference,
        date: item.date,
        guid: item.guid
      })
    })
    return docs
  }

  /**
     * ✅ MODIFICADO: Procesa documentos en lotes de 5 en paralelo
     */
  annexsEvaluate () {
    const total = this.annexs.length
    console.log(`📥 Iniciando procesamiento de ${total} documentos...`)

    if (total === 0) {
      console.log('📭 No hay documentos para procesar')
      return Promise.resolve()
    }

    // Devuelve la promesa, pero history-scrape.js sigue SIN esperarla (fire-and-forget):
    // el seguimiento vive en DocumentProcessingStatus, no bloquea el pool.
    return (async () => {
      const trackerDoc = await tracker.startTracking({ fullRol: this.cause, totalDocuments: total })
      let hadErrors = false

      if (total <= 5) {
        hadErrors = await this._runBatch(this.annexs, 'annex', 1, trackerDoc?._id)
      } else {
        const BATCH_SIZE = 5
        const batches = []
        for (let i = 0; i < total; i += BATCH_SIZE) {
          batches.push(this.annexs.slice(i, i + BATCH_SIZE))
        }
        console.log(`📦 Procesando ${batches.length} lotes de ${BATCH_SIZE} documentos...`)

        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i]
          const batchNumber = i + 1
          console.log(`🔄 Procesando lote ${batchNumber}/${batches.length} (${batch.length} documentos)...`)
          if (await this._runBatch(batch, `annex-batch-${batchNumber}`, batchNumber, trackerDoc?._id)) hadErrors = true
          if (i < batches.length - 1) {
            console.log('⏳ Esperando 0.5 segundos antes del siguiente lote...')
            await new Promise(resolve => setTimeout(resolve, 500))
          }
        }
      }

      if (hadErrors) console.warn('⚠️ Procesamiento de documentos terminó con errores (ver DocumentProcessingStatus)')
      else console.log('✅ Todos los documentos han sido procesados exitosamente.')
      await tracker.finishTracking(trackerDoc?._id, { hadErrors })
    })()
  }

  /** @returns {Promise<boolean>} true si el lote terminó con errores */
  async _runBatch (items, mode, batchNumber, trackerId) {
    let pending = items
    let attempt = 0
    while (true) {
      let result
      try {
        result = await (0, worker_launch_document_1.runWorkerDocument)(
          pending.map((item) => this.evaluateAnnex(item)), this.issue, mode
        )
      } catch (error) {
        console.error(`❌ Error en lote ${batchNumber}:`, error.message)
        await tracker.recordBatchError(trackerId, batchNumber, error.message)
        return true
      }

      const { processed = pending.length, failed = [] } = result || {}
      await tracker.incrementProcessed(trackerId, Math.max(processed - failed.length, 0))

      if (failed.length === 0) {
        console.log(`✅ Lote ${batchNumber} procesado exitosamente`)
        return false
      }

      const failedNames = new Set(failed.map((f) => f.filename))
      if (attempt < MAX_DOC_RETRIES) {
        attempt++
        pending = pending.filter((item) => failedNames.has(this.evaluateAnnex(item).filename))
        console.warn(`🔁 Lote ${batchNumber}: reintentando ${pending.length} documento(s) en ${RETRY_DELAY_MS}ms (intento ${attempt})`)
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
        continue
      }

      const names = [...failedNames].join(', ')
      console.warn(`⚠️ Lote ${batchNumber}: ${failedNames.size} documento(s) siguen fallando: ${names}`)
      await tracker.recordBatchError(trackerId, batchNumber, `Fallaron ${failedNames.size}: ${names}`)
      return true
    }
  }

  evaluateAnnex (annex) {
    const { date, descProcedure, document, procedure, reference } = annex
    const filename = `${(0, parse_string_1.parseStringToCode)(procedure)}_${(0, parse_string_1.parseStringToCode)(descProcedure)}_${(0, code_calc_1.codeUnique)(date)}_${(0, parse_string_1.parseStringToCode)(reference)}_anexo`
    return { filename, url: document, cause: this.cause }
  }
}

exports.DocumentAnnexPersistHelper = DocumentAnnexPersistHelper
