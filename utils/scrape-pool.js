// utils/scrape-pool.js
//
// Pool de instancias independientes de ScrapService (cada una con su
// propio navegador, sesión y keep-alive) para permitir scraping en
// paralelo real, en vez de competir por un único navegador compartido.
//
// El tamaño del pool se controla con SCRAPING_CONCURRENCY (la misma
// variable que ya usa el worker de BullMQ) — deben ir siempre sincronizadas.

const { ScrapService } = require('./plugins/puppeteer.plugin')
const logger = require('./logger')

const POOL_SIZE = parseInt(process.env.SCRAPING_CONCURRENCY) || 1

let pool = [] // [{ id, instance: ScrapService, busy: boolean }]
let isInitializing = false

/**
 * Crea las N instancias del pool la primera vez que se necesita.
 * Llamadas posteriores reutilizan el pool ya creado.
 */
async function initPool() {
  if (pool.length > 0) return pool

  if (isInitializing) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    return initPool()
  }

  isInitializing = true
  try {
    console.log(`📍 Inicializando pool de ${POOL_SIZE} navegador(es)...`)
    logger.info(`Inicializando pool de scraping`, { size: POOL_SIZE })

    for (let i = 0; i < POOL_SIZE; i++) {
      console.log(`📍 Creando navegador #${i} del pool...`)
      const scrape = new ScrapService()
      await scrape.init()
      pool.push({ id: i, instance: scrape, busy: false })
      console.log(`✅ Navegador #${i} del pool listo`)
    }

    return pool
  } finally {
    isInitializing = false
  }
}

/**
 * Toma una instancia libre del pool. Si todas están ocupadas, espera
 * hasta que se libere alguna (polling simple cada 500ms).
 * @returns {Promise<{id: number, instance: ScrapService, busy: boolean}>}
 */
async function acquireInstance() {
  await initPool()

  while (true) {
    const free = pool.find(slot => !slot.busy)
    if (free) {
      free.busy = true
      console.log(`🔓 Navegador #${free.id} del pool asignado`)
      return free
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

/**
 * Libera una instancia para que otro job pueda usarla.
 */
function releaseInstance(slot) {
  slot.busy = false
  console.log(`🔒 Navegador #${slot.id} del pool liberado`)
}

/**
 * Cierra todas las instancias del pool (usado en el logout por
 * inactividad y en el shutdown del servidor).
 */
async function closeAllInstances() {
  console.log(`📍 Cerrando las ${pool.length} instancia(s) del pool...`)
  for (const slot of pool) {
    try {
      await slot.instance.close()
    } catch (error) {
      console.warn(`⚠️ Error cerrando navegador #${slot.id}:`, error.message)
    }
  }
  pool = []
}

/**
 * Hace "Salir" en todas las instancias del pool antes de cerrarlas
 * (equivalente al logoutAndCloseSession original, pero para todo el pool).
 */
async function logoutAllInstances() {
  for (const slot of pool) {
    try {
      const page = slot.instance.getPage()
      console.log(`👋 Cerrando sesión del navegador #${slot.id}...`)
      await page.evaluate(() => {
        const link = Array.from(document.querySelectorAll('a')).find(a =>
          a.getAttribute('onclick')?.includes('salir(')
        )
        if (link) link.click()
      })
      await new Promise(resolve => setTimeout(resolve, 2000))
    } catch (error) {
      console.warn(`⚠️ Error cerrando sesión del navegador #${slot.id}:`, error.message)
    }
  }
}

function getPoolStatus() {
  return pool.map(slot => ({ id: slot.id, busy: slot.busy }))
}

module.exports = {
  initPool,
  acquireInstance,
  releaseInstance,
  closeAllInstances,
  logoutAllInstances,
  getPoolStatus,
  POOL_SIZE
}
