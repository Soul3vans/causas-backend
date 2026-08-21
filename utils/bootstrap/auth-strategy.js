'use strict'

/**
 * bootstrap/auth-strategy.js
 *
 * Estrategia de bootstrap AUTH para BrowserSessionManager.
 * Responsabilidad ÚNICA: dejar al AnchorTab logueado (Clave Única) y
 * con el formulario de búsqueda visible en indexN.php.
 *
 * Extracción LITERAL desde:
 *   - utils/scrapper-auth.js       -> clickConsultaUnificada, waitForSearchForm
 *   - utils/plugins/puppeteer.plugin.js (ScrapService.login())
 *       -> performLogin (mismos selectores, mismos timeouts, mismo
 *          manejo de reCAPTCHA manual, mismo tipeo de RUT/PASS)
 *
 * NO contiene lógica de extracción (applyFilter/extractAnchors/
 * collectDetails) — eso sigue siendo exclusivo de UnifiedQuery.
 */

const logger = require('../logger')
const { envs } = require('../plugins/env.plugin')

// ---------- helpers, copia literal de ScrapService.timeout()/randomDelay() ----------

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function randomDelay(min = 600, max = 3000) {
  const delays = [600, 800, 1000, 1200, 1400, 1600, 2000, 3000]
  const d = delays[Math.floor(Math.random() * delays.length)]
  await timeout(d)
}

// ---------- login real, extracción literal de ScrapService.login() ----------

/**
 * Copia LITERAL de ScrapService.login(), adaptada para recibir `page`
 * como parámetro en vez de usar `this.page`. Mismo flujo exacto:
 * abrir modal Clave Única -> esperar campos -> detectar reCAPTCHA ->
 * esperar resolución manual (hasta 180 intentos x 2s = 6 min) ->
 * tipear RUT/PASS -> clic en login-submit -> esperar redirección.
 *
 * NO incluye el `startKeepAliveWithReload()` final del original — ver
 * nota en bootstrap() sobre por qué se omite aquí (pregunta pendiente
 * al final de este archivo).
 */
async function performLogin(page) {
  logger.info('🔐 Iniciando sesión con Clave Única...')

  // PASO 1: Abrir el modal de Clave Única
  await page.evaluate(() => {
    eval('AutenticaCUnica();')
  })

  console.log('⏳ Esperando que cargue el modal de autenticación...')
  await timeout(4000)

  // PASO 2: Esperar a que los campos estén disponibles
  await page.waitForSelector('input#uname', { timeout: 30000 })
  await page.waitForSelector('input[type="password"]', { timeout: 30000 })

  // PASO 3: Verificar si hay reCAPTCHA visible
  const hasRecaptcha = await page.evaluate(() => {
    const recaptchaFrame = document.querySelector('iframe[src*="recaptcha"]')
    const recaptchaBadge = document.querySelector('.g-recaptcha')
    return recaptchaFrame !== null || recaptchaBadge !== null
  }).catch(() => false)

  if (hasRecaptcha) {
    console.log('\n' + '='.repeat(60))
    console.log('🔐 Se detectó un reCAPTCHA')
    console.log('='.repeat(60))
    console.log('')
    console.log('📋 Por favor, resuelve el reCAPTCHA manualmente en el navegador')
    console.log('   El script esperará hasta que lo resuelvas...')
    console.log('')
    console.log('⏳ Esperando a que el reCAPTCHA sea resuelto...')

    let recaptchaResolved = false
    let attempts = 0

    while (!recaptchaResolved && attempts < 180) {
      await timeout(2000)

      const stillHasRecaptcha = await page.evaluate(() => {
        const recaptchaFrame = document.querySelector('iframe[src*="recaptcha"]')
        const recaptchaBadge = document.querySelector('.g-recaptcha')
        return recaptchaFrame !== null || recaptchaBadge !== null
      }).catch(() => false)

      if (!stillHasRecaptcha) {
        recaptchaResolved = true
        console.log('✅ reCAPTCHA resuelto! Continuando...')
      }
      attempts++
    }

    if (!recaptchaResolved) {
      console.warn('⚠️ Timeout esperando reCAPTCHA, continuando de todos modos...')
    }
  } else {
    console.log('✅ No se detectó reCAPTCHA, continuando con autenticación...')
  }

  // PASO 4: Escribir RUT y contraseña automáticamente
  console.log('📝 Escribiendo RUT y contraseña...')
  await page.type('input#uname', envs.RUT, { delay: 100 + Math.random() * 50 })
  await randomDelay(500, 1500)
  await page.type('input[type="password"]', envs.PASS, { delay: 100 + Math.random() * 50 })
  await randomDelay(800, 2000)

  // PASO 5: Hacer clic en el botón de ingresar
  console.log('🔘 Haciendo clic en el botón de ingresar...')
  await page.click('button#login-submit')

  // PASO 6: Esperar la redirección post-autenticación
  console.log('⏳ Esperando redirección después de autenticación...')
  await page.waitForNavigation({
    waitUntil: 'domcontentloaded',
    timeout: 60000
  })

  console.log('✅ Autenticación completada exitosamente')
  await timeout(2000)
}

// ---------- extracción literal de scrapper-auth.js ----------

async function clickConsultaUnificada(page) {
  try {
    console.log('🔍 Buscando enlace "Consulta Unificada" en el nav...')

    const submenuExpanded = await page.evaluate(() => {
      const submenuTrigger = document.querySelector('li.subLi a[href="#misCauSubmenu"]')
      if (submenuTrigger) {
        const isExpanded = submenuTrigger.getAttribute('aria-expanded') === 'true'
        if (!isExpanded) {
          submenuTrigger.click()
          return true
        }
      }
      return false
    })

    if (submenuExpanded) {
      console.log('📂 Submenú expandido')
      await timeout(1000)
    }

    const clicked = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'))
      const unifiedLink = links.find(a =>
        a.textContent.trim() === 'Consulta Unificada' ||
        a.textContent.includes('Unificada')
      )

      if (unifiedLink) {
        unifiedLink.click()
        return true
      }

      const causeLink = document.querySelector('#misCauSubmenu a')
      if (causeLink) {
        causeLink.click()
        return true
      }

      return false
    })

    if (clicked) {
      console.log('✅ "Consulta Unificada" seleccionado')
      await timeout(2000)
      return true
    }

    console.warn('⚠️ No se encontró "Consulta Unificada", continuando de todos modos...')
    return false
  } catch (error) {
    console.error('❌ Error haciendo clic en Consulta Unificada:', error.message)
    return false
  }
}

async function waitForSearchForm(page) {
  console.log('⏳ Esperando a que cargue el formulario de búsqueda...')

  try {
    await page.waitForSelector('select#competencia', { timeout: 30000, visible: true })
    console.log('✅ Formulario de búsqueda visible (select#competencia encontrado)')
    return true
  } catch (error) {
    console.error('❌ Error esperando formulario de búsqueda:', error.message)
    return false
  }
}

// ---------- contrato exigido por BrowserSessionManager ----------

/**
 * @param {import('puppeteer').Page} page - la Page del AnchorTab
 */
async function bootstrap(page) {
  logger.info('🔐 auth-strategy: iniciando bootstrap AUTH sobre AnchorTab')

  // Navegación inicial a home/index.php.
  // NOTA: el original (ScrapService.pageGoto) incluye 3 reintentos con
  // espera de 10 MINUTOS entre cada uno, y emite eventos ('retryPage',
  // 'closeBrowser') consumidos en otra parte del sistema. No lo
  // reproduzco tal cual aquí porque BrowserSessionManager no es un
  // EventEmitter hacia esos consumidores — ver pregunta 1 al final.
  await page.goto('https://oficinajudicialvirtual.pjud.cl/home/index.php', {
    waitUntil: 'domcontentloaded',
    timeout: 5 * 60 * 1000
  })

  await performLogin(page)

  const currentUrl = page.url()
  console.log(`📍 URL actual después de autenticación: ${currentUrl}`)

  if (!currentUrl.includes('indexN.php')) {
    console.log('📍 Navegando a indexN.php...')
    await page.goto('https://oficinajudicialvirtual.pjud.cl/indexN.php', {
      waitUntil: 'networkidle2',
      timeout: 60000
    })
    await timeout(3000)
  }

  await clickConsultaUnificada(page)

  const formReady = await waitForSearchForm(page)
  if (!formReady) {
    throw new Error('No se pudo cargar el formulario de búsqueda después de autenticación')
  }

  logger.info('✅ auth-strategy: bootstrap AUTH completado, formulario visible')
}

module.exports = {
  bootstrap,
  performLogin,
  clickConsultaUnificada,
  waitForSearchForm
}
