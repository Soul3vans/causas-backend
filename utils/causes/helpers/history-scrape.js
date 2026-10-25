'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
exports.HistoryScrape = void 0
const wait_1 = require('../../plugins/wait')
const date_calc_1 = require('./date-calc')
const document_persist_helper_1 = require('./document-persist.helper')
const const_1 = require('./const')
const { DateTime } = require('luxon')

class HistoryScrape {
  constructor (page, cause, issue) {
    this.page = page
    this.cause = cause
    this.issue = issue
    this.histories = []
    this.folders = []
    this.anexs = []
  }

  getmovementsHistories () {
    return this.histories
  }

  /**
     * ✅ MODIFICADO: Ahora recibe options para controlar la descarga de documentos
     * @param {Object} options - Opciones de ejecución
     * @param {boolean} options.skipDocumentDownload - Si true, salta la descarga de documentos (solo extrae enlaces)
     */
  async start (options = {}) {
    const { skipDocumentDownload = true } = options // ✅ Por defecto true (solo enlaces)

    console.log(`📜 Extrayendo movimientos... (skipDocumentDownload: ${skipDocumentDownload})`)

    const movements = await this.page.evaluate(() => {
      const container = document.querySelector('div#loadHistCuadernoCiv')
      const table = container?.querySelector('table')
      const rows = Array.from(table?.querySelectorAll('tbody>tr') || [])
      return rows.map((row) => {
        const cells = Array.from(row.querySelectorAll('td'))
        const invoice = cells[0]?.textContent?.trim() || ''
        const folder = cells[2]?.querySelector('a')?.getAttribute('onclick') || ''
        const stage = cells[3]?.textContent?.trim() || ''
        const procedure = cells[4]?.textContent?.trim() || ''
        const descProcedure = cells[5]?.textContent?.trim() || ''
        const dateProcedure = cells[6]?.textContent?.trim() || ''
        const pageNumber = parseInt(cells[7]?.textContent?.trim() || '0', 10)
        const documentForms = Array.from(cells[1]?.querySelectorAll('form') || [])
        const documents = documentForms.map((form) => {
          const action = form.getAttribute('action') || ''
          const input = form.querySelector('input')
          const queryName = input?.getAttribute('name') || ''
          const queryValue = input?.getAttribute('value') || ''
          const url = `${action}?${queryName}=${queryValue}`
          return url
        })
        return {
          guid: crypto.randomUUID(),
          invoice,
          document: documents,
          stage,
          procedure,
          descProcedure,
          dateProcedure,
          page: isNaN(pageNumber) ? 0 : pageNumber,
          folder: folder
        }
      })
    })

    this.histories.push(...movements.map((item) => ({
      dateProcedure: resolveMovementDate(item),
      descProcedure: item.descProcedure,
      document: item.document,
      invoice: item.invoice,
      page: item.page,
      procedure: item.procedure,
      stage: item.stage,
      guid: item.guid
    })))

    this.folders.push(...movements
      .filter((item) => item.folder.length > 0)
      .map((item) => ({
        descProcedure: item.descProcedure,
        procedure: item.procedure,
        script: item.folder,
        guid: item.guid
      })))

    if (this.folders.length === 0) {
      console.log('📭 No contiene carpetas', this.cause)
      return []
    }

    // ✅ Si skipDocumentDownload es true, solo extraemos anexos sin descargar
    if (skipDocumentDownload) {
      console.log(`⏭️ Saltando descarga de documentos (solo enlaces). Carpetas: ${this.folders.length}`)
      // 🔄 EXTRAER ANEXOS SIN DESCARGAR (solo enlaces)
      await this.folderExtractLight()
    } else {
      // 🔄 EXTRAER ANEXOS CON DESCARGA
      await this.folderExtract()
    }

    const persist = new document_persist_helper_1.DocumentAnnexPersistHelper(this.cause, this.anexs, this.issue, this.trackingRefs || {})
    persist.annexsEvaluate()
    return persist.makeFilenames()
  }

  async closeAnnexModal () {
    try {
      await this.page.evaluate(() => {
        const closeBtn = document.querySelector('#modalAnexoSolicitudCivil .close')
        if (closeBtn) closeBtn.click()
      })
      await this.page.waitForFunction(() => {
        const m = document.querySelector('#modalAnexoSolicitudCivil')
        return !m || window.getComputedStyle(m).display === 'none'
      }, { timeout: 3000 }).catch(() => {})
      await (0, wait_1.wait)(200)
    } catch (closeError) {
      console.warn('⚠️ Error cerrando modal de anexo:', closeError.message)
    }
  }

  /**
     * ✅ NUEVO: Extrae anexos SIN descargar documentos (solo enlaces)
     * Versión ligera que no descarga archivos, solo extrae los enlaces
     */
  async folderExtractLight () {
    console.log(`📂 Carpetas a procesar (solo enlaces): ${this.folders.length}`)

    const ANNEX_ROWS = '#modalAnexoSolicitudCivil .modal-body table tbody tr'
    let previousSignature = null

    for (const folder of this.folders) {
      try {
        console.log(`🔍 Evaluando carpeta: ${folder.procedure} - ${folder.descProcedure}`)

        // 1) Vaciar las filas de la carpeta anterior: una lectura tardía ya no puede devolverlas
        await this.page.evaluate((sel) => {
          document.querySelectorAll(sel).forEach((tr) => tr.remove())
        }, ANNEX_ROWS)

        await this.page.evaluate(folder.script)

        // 2) Esperar las filas de ESTA carpeta, no un tiempo fijo
        await this.page.waitForFunction(
          (sel) => document.querySelectorAll(sel).length > 0,
          { timeout: 15000 },
          ANNEX_ROWS
        )
        await (0, wait_1.wait)(300)

        const result = await this.page.$$eval(ANNEX_ROWS, (rows) => {
          return rows.map((row) => {
            const cells = row.querySelectorAll('td')
            const form = row.querySelector('form')
            const action = form?.getAttribute('action') || ''
            const input = form?.querySelector('input')
            const queryName = input?.getAttribute('name') || ''
            const queryValue = input?.getAttribute('value') || ''
            const url = `${action}?${queryName}=${queryValue}`
            return {
              document: url,
              date: cells[1]?.textContent?.trim() || '',
              reference: cells[2]?.textContent?.trim() || ''
            }
          })
        })

        // 3) Red de seguridad: dos carpetas distintas no comparten los mismos enlaces
        const signature = result.map((r) => r.document).join('|')
        if (signature === previousSignature) {
          console.warn(`⚠️ ${folder.procedure} - ${folder.descProcedure}: anexos idénticos a la carpeta anterior, se descartan (posible lectura obsoleta)`)
          continue
        }
        previousSignature = signature

        console.log(`✅ Carpeta procesada: ${folder.procedure} - ${result.length} anexos (solo enlaces)`)

        this.anexs.push(...result.map((item) => ({
          date: (0, date_calc_1.dateCalc)(item.date),
          descProcedure: folder.descProcedure,
          document: item.document,
          procedure: folder.procedure,
          reference: item.reference,
          guid: folder.guid
        })))
      } catch (error) {
        console.warn(`⚠️ Error procesando carpeta ${folder.procedure}:`, error.message)
      } finally {
        // 4) Cerrar siempre, y esperar a que el modal esté oculto antes de la siguiente carpeta
        await this.closeAnnexModal()
      }
    }

    console.log(`✅ Extracción de anexos completada (solo enlaces). Total: ${this.anexs.length}`)
  }

  /**
     * ✅ MÉTODO ORIGINAL: Extrae anexos CON descarga de documentos
     * Se mantiene para compatibilidad
     */
  async folderExtract () {
    console.log(`📂 Carpetas a procesar (con descarga): ${this.folders.length}`)

    for (const folder of this.folders) {
      try {
        console.log(`📥 Procesando carpeta con descarga: ${folder.procedure} - ${folder.descProcedure}`)

        await this.page.evaluate((script) => {
          const runScript = new Function('"use strict"; ' + script)
          runScript()
        }, folder.script)

        await this.page.waitForSelector('div[class="modal in"]', {
          timeout: const_1.DEFAULT_TIMEOUT,
          visible: true
        })

        await (0, wait_1.wait)(4000)

        const result = await this.page.$$eval('#modalAnexoSolicitudCivil .modal-body table tbody tr', (rows) => {
          return rows.map((row) => {
            const cells = row.querySelectorAll('td')
            const form = row.querySelector('form')
            const action = form?.getAttribute('action') || ''
            const input = form?.querySelector('input')
            const queryName = input?.getAttribute('name') || ''
            const queryValue = input?.getAttribute('value') || ''
            const url = `${action}?${queryName}=${queryValue}`
            return {
              document: url,
              date: cells[1]?.textContent?.trim() || '',
              reference: cells[2]?.textContent?.trim() || ''
            }
          })
        })

        console.log(`✅ Carpeta procesada: ${folder.procedure} - ${result.length} anexos`)

        this.anexs.push(...result.map((item) => ({
          date: (0, date_calc_1.dateCalc)(item.date),
          descProcedure: folder.descProcedure,
          document: item.document,
          procedure: folder.procedure,
          reference: item.reference,
          guid: folder.guid
        })))
      } catch (error) {
        console.warn(`⚠️ Error procesando carpeta ${folder.procedure}:`, error.message)
        if (error instanceof TypeError) { console.warn(error.message) }
        if (error instanceof Error) { console.warn(error.message) }
      }
    }
  }
}

/**
 * Las "Actuación Receptor" no traen fecha en su celda y terminaban con la hora del scrape.
 * La fecha real viene en el texto: "Diligencia:DD/MM/YYYY HH:mm". Se usa medianoche de Chile,
 * igual que las demás fechas del tribunal.
 */
function resolveMovementDate (item) {
  if (item.procedure === 'Actuación Receptor') {
    const match = /Diligencia:(\d{2}\/\d{2}\/\d{4})/.exec(item.descProcedure || '')
    if (match) {
      const parsed = DateTime.fromFormat(match[1], 'dd/MM/yyyy', { zone: 'America/Santiago' })
      if (parsed.isValid) return parsed.toJSDate()
    }
  }
  return (0, date_calc_1.dateCalc)(item.dateProcedure)
}

exports.HistoryScrape = HistoryScrape
