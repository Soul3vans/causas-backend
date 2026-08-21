'use strict'

/**
 * TabWorker
 *
 * Envuelve una única Page de Puppeteer dentro del Browser/Context único
 * gestionado por BrowserSessionManager. Implementa el MISMO contrato que
 * ScrapService ya expone hoy hacia UnifiedQuery, para que unified-query.js
 * no requiera ningún cambio.
 *
 * Estados (según diseño ya cerrado):
 *   ABSENT -> CREATING -> IDLE <-> BUSY -> CLOSING -> CLOSED
 *
 * El AnchorTab (id=0) es una instancia de esta misma clase con
 * isAnchor=true: nunca transiciona a CLOSING/CLOSED por el mecanismo
 * de idle-timeout ni por recovery — eso se refuerza en close().
 */

const WORKER_STATE = Object.freeze({
  ABSENT: 'ABSENT',
  CREATING: 'CREATING',
  IDLE: 'IDLE',
  BUSY: 'BUSY',
  CLOSING: 'CLOSING',
  CLOSED: 'CLOSED'
})

class TabWorker {
  constructor({ id, page, isAnchor = false }) {
    this.id = id
    this.page = page
    this.isAnchor = isAnchor
    this.state = WORKER_STATE.CREATING
    // Solo aplica al AnchorTab: true cuando volvió a home/index.php
    // por inactividad prolongada, sin trabajo pendiente. Mientras es
    // true, no tiene el formulario de búsqueda listo — hay que rehacer
    // el bootstrap antes de asignarle trabajo.
    this.isResting = false

    // causa (processId/caseId) que está procesando actualmente — permite
    // que browser-session-manager sepa qué causa marcar REQUEUED si esta
    // tab falla por sesión perdida.
    this.currentJob = null

    this.lastReleasedAt = null
    this.idleCloseTimer = null
  }

  // ---------- ciclo de vida / estado ----------

  markBusy(jobRef) {
    this.state = WORKER_STATE.BUSY
    this.currentJob = jobRef
    this._clearIdleTimer()
  }

  markIdle() {
    this.state = WORKER_STATE.IDLE
    this.currentJob = null
    this.lastReleasedAt = Date.now()
  }

  isIdle() { return this.state === WORKER_STATE.IDLE }
  isBusy() { return this.state === WORKER_STATE.BUSY }
  isClosed() { return this.state === WORKER_STATE.CLOSED }

  // ---------- contrato esperado por UnifiedQuery (idéntico a ScrapService) ----------

  getPage() {
    if (!this.page) throw new Error(`TabWorker#${this.id}: página no disponible`)
    return this.page
  }

  async waitForSelector(selector, delay = 1000, visible = true) {
    await this.page.waitForSelector(selector, { timeout: 0, visible })
    await this.timeout(delay)
  }

  async execute(script, delay = 4000) {
    await this.page.evaluate(script => eval(script), script)
    await this.timeout(delay)
  }

  timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Copia fiel de ScrapService.closeModal() — mismos selectores,
   * mismo orden de fallback (button.close -> [data-dismiss=modal] ->
   * .modal-header button -> Escape), solo adaptado a this.page.
   */
  async closeModal() {
    try {
      await this.timeout(500)

      const closedByButton = await this.page.evaluate(() => {
        const closeBtn = document.querySelector('#modalDetalleCivil .close')
        if (closeBtn) { closeBtn.click(); return true }
        return false
      })
      if (closedByButton) { await this.timeout(1000); return true }

      const closedByDismiss = await this.page.evaluate(() => {
        const dismissBtn = document.querySelector('#modalDetalleCivil [data-dismiss="modal"]')
        if (dismissBtn) { dismissBtn.click(); return true }
        return false
      })
      if (closedByDismiss) { await this.timeout(1000); return true }

      const closedByHeader = await this.page.evaluate(() => {
        const headerBtn = document.querySelector('#modalDetalleCivil .modal-header button')
        if (headerBtn) { headerBtn.click(); return true }
        return false
      })
      if (closedByHeader) { await this.timeout(1000); return true }

      await this.page.keyboard.press('Escape')
      await this.timeout(1000)
      return true
    } catch (error) {
      console.error(`TabWorker#${this.id} closeModal error:`, error.message)
      return false
    }
  }

  /**
   * Copia fiel de ScrapService.clearForm().
   */
  async clearForm() {
    try {
      await this.page.waitForSelector('#btnConLimpiar', { timeout: 6000 })
      await this.page.click('#btnConLimpiar')
      await this.timeout(1500)
      return true
    } catch (error) {
      console.error(`TabWorker#${this.id} clearForm error:`, error.message)
      await this.page.reload({ waitUntil: 'domcontentloaded' })
      await this.timeout(3000)
      return false
    }
  }

  /**
   * Copia fiel de ScrapService.ensureRecaptchaTokens() / getRecaptchaTokens() /
   * refreshRecaptchaTokens() — el reCAPTCHA del formulario de búsqueda aplica
   * igual en auth y en guest, es del formulario, no de la sesión.
   */
  async getRecaptchaTokens() {
    return this.page.evaluate(() => ({
      rit: document.getElementById('g-recaptcha-response-rit')?.value || '',
      nombre: document.getElementById('g-recaptcha-response-nombre')?.value || '',
      fecha: document.getElementById('g-recaptcha-response-fecha')?.value || '',
      jur: document.getElementById('g-recaptcha-response-jur')?.value || ''
    }))
  }

  async refreshRecaptchaTokens() {
    try {
      await this.timeout(2000)
      await this.page.evaluate(() => {
        if (typeof recaptchacallbackritv3 === 'function') recaptchacallbackritv3()
        if (typeof recaptchacallbacknombrev3 === 'function') recaptchacallbacknombrev3()
        if (typeof recaptchacallbackfechav3 === 'function') recaptchacallbackfechav3()
        if (typeof recaptchacallbackjurv3 === 'function') recaptchacallbackjurv3()
      })
      await this.timeout(3000)
      return true
    } catch (error) {
      console.error(`TabWorker#${this.id} refreshRecaptchaTokens error:`, error.message)
      return false
    }
  }

  async ensureRecaptchaTokens() {
    try {
      await this.page.waitForSelector('#g-recaptcha-response-rit', { timeout: 30000 }).catch(() => null)

      let tokens = await this.getRecaptchaTokens()
      const isValid = t => t.rit?.length > 10 && t.nombre?.length > 10 && t.fecha?.length > 10 && t.jur?.length > 10

      if (isValid(tokens)) return true

      for (let attempt = 1; attempt <= 3; attempt++) {
        await this.refreshRecaptchaTokens()
        tokens = await this.getRecaptchaTokens()
        if (isValid(tokens)) return true
        await this.timeout(5000)
      }
      return false
    } catch (error) {
      console.error(`TabWorker#${this.id} ensureRecaptchaTokens error:`, error.message)
      return false
    }
  }

  // ---------- cierre ----------

  _clearIdleTimer() {
    if (this.idleCloseTimer) {
      clearTimeout(this.idleCloseTimer)
      this.idleCloseTimer = null
    }
  }

  /**
   * El AnchorTab NUNCA se cierra por este mecanismo — regla dura,
   * reforzada aquí además de en quien orquesta el cierre.
   */
  async close() {
    if (this.isAnchor) {
      console.warn(`TabWorker#${this.id}: intento de cerrar el AnchorTab ignorado`)
      return false
    }

    this._clearIdleTimer()
    this.state = WORKER_STATE.CLOSING
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close()
      }
    } catch (error) {
      console.warn(`TabWorker#${this.id}: error cerrando página:`, error.message)
    } finally {
      this.state = WORKER_STATE.CLOSED
    }
    return true
  }
}

module.exports = { TabWorker, WORKER_STATE }
