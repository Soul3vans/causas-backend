'use strict'

/**
 * browser-profile-state.js
 *
 * Extrae y restaura ÚNICAMENTE cookies + localStorage del perfil de
 * Chrome hacia/desde Mongo — no todo el directorio de perfil (eso no
 * es persistible fuera de disco). Diseñado para compensar la ausencia
 * de Persistent Disk en el free tier de Render: sin esto, el trust
 * acumulado por warm-profile.sh se pierde en cada deploy Y en cada
 * spin-down por inactividad (15 min en free tier).
 *
 * NO persiste sessionStorage (no tiene sentido entre reinicios de
 * proceso, se re-establece como efecto normal del propio bootstrap).
 */

const BrowserProfileState = require('../models/BrowserProfileState')
const logger = require('./logger')

const TARGET_ORIGIN = 'https://oficinajudicialvirtual.pjud.cl'

/**
 * Lee cookies + localStorage de la Page actual y los persiste en Mongo
 * (documento único, upsert). Se llama tras cada bootstrap exitoso
 * (inicial o de recovery) para que el estado se mantenga "fresco".
 *
 * @param {import('puppeteer').Page} page
 */
async function exportState(page) {
  try {
    const cookies = await page.cookies()

    const localStorageEntries = await page.evaluate(() => {
      const entries = {}
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        entries[key] = localStorage.getItem(key)
      }
      return entries
    })

    await BrowserProfileState.findOneAndUpdate(
      {},
      { cookies, localStorageEntries },
      { upsert: true }
    )

    logger.info(`💾 browser-profile-state: exportado (${cookies.length} cookies, ${Object.keys(localStorageEntries).length} claves de localStorage)`)
  } catch (error) {
    logger.warn('⚠️ browser-profile-state: error exportando estado:', error.message)
  }
}

/**
 * Restaura cookies + localStorage guardados hacia una Page recién
 * creada, ANTES de correr el bootstrap real. Si no hay estado
 * guardado (primera vez), no hace nada — el bootstrap corre en frío
 * como hoy.
 *
 * IMPORTANTE: localStorage se inyecta vía evaluateOnNewDocument, que
 * corre ANTES de que cualquier script de la página se ejecute — así
 * el sitio "ve" el localStorage ya poblado desde su primer script,
 * en vez de tener que esperar a setearlo después de cargar (lo cual
 * podría llegar tarde si algún script del sitio ya leyó el valor).
 *
 * @param {import('puppeteer').Page} page - página recién creada, AÚN sin navegar
 * @returns {Promise<boolean>} true si se restauró algo, false si no había nada guardado
 */
async function restoreState(page) {
  try {
    const state = await BrowserProfileState.findOne()

    if (!state || (!state.cookies?.length && !Object.keys(state.localStorageEntries || {}).length)) {
      logger.info('💾 browser-profile-state: sin estado guardado, bootstrap arrancará en frío')
      return false
    }

    if (state.cookies?.length) {
      await page.setCookie(...state.cookies)
    }

    if (state.localStorageEntries && Object.keys(state.localStorageEntries).length) {
      await page.evaluateOnNewDocument((entries) => {
        for (const [key, value] of Object.entries(entries)) {
          try {
            localStorage.setItem(key, value)
          } catch (e) { /* localStorage puede no estar disponible antes de la primera navegación en algunos casos */ }
        }
      }, state.localStorageEntries)
    }

    logger.info(`💾 browser-profile-state: restaurado (${state.cookies?.length || 0} cookies, ${Object.keys(state.localStorageEntries || {}).length} claves de localStorage)`)
    return true
  } catch (error) {
    logger.warn('⚠️ browser-profile-state: error restaurando estado, bootstrap arrancará en frío:', error.message)
    return false
  }
}

module.exports = { exportState, restoreState, TARGET_ORIGIN }