'use strict'

/**
 * chrome-launch-options.js
 *
 * Punto único de configuración del lanzamiento de Chrome/Chromium.
 * Extraído de utils/plugins/puppeteer.plugin.js (ScrapService) sin
 * cambiar ningún valor ni comportamiento — es una extracción literal.
 *
 * A partir de ahora, cualquier ajuste de args/flags/executablePath se
 * hace SOLO aquí. Tanto ScrapService (sistema actual) como
 * BrowserSessionManager (sistema nuevo) importan de este único lugar.
 */

const path = require('path')
const os = require('os')

/**
 * Resuelve la ruta del ejecutable de Chrome/Chromium según el sistema
 * operativo. Copia fiel de ScrapService.getExecutablePath().
 * @returns {string|undefined}
 */
function getExecutablePath() {
  if (process.env.CHROME_EXECUTABLE_PATH) {
    console.log(`🔧 Usando Chrome fijo: ${process.env.CHROME_EXECUTABLE_PATH}`)
    return process.env.CHROME_EXECUTABLE_PATH
  }
  if (process.env.NODE_ENV === 'production') {
    console.log('🔧 Modo producción: usando Chromium de Puppeteer')
    return undefined
  }

  const platform = process.platform

  if (platform === 'win32') {
    const possiblePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
    ]
    const fs = require('fs')
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        console.log(`🔧 Modo desarrollo (Windows): usando Chrome en ${p}`)
        return p
      }
    }
    console.warn('⚠️ No se encontró Chrome en Windows, usando Chromium de Puppeteer')
    return undefined
  }

  if (platform === 'linux') {
    const { execSync } = require('child_process')
    const possibleCommands = ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium']
    for (const cmd of possibleCommands) {
      try {
        const p = execSync(`which ${cmd}`, { stdio: 'pipe' }).toString().trim()
        if (p && p.length > 0) {
          console.log(`🔧 Modo desarrollo (Linux): usando ${cmd} en ${p}`)
          return p
        }
      } catch (e) {}
    }
    console.warn('⚠️ No se encontró Chrome/Chromium en Linux, usando Chromium de Puppeteer')
    return undefined
  }

  if (platform === 'darwin') {
    const macPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    const fs = require('fs')
    if (fs.existsSync(macPath)) {
      console.log(`🔧 Modo desarrollo (macOS): usando Chrome en ${macPath}`)
      return macPath
    }
    console.warn('⚠️ No se encontró Chrome en macOS, usando Chromium de Puppeteer')
    return undefined
  }

  console.log(`🔧 Plataforma no reconocida (${platform}), usando Chromium de Puppeteer`)
  return undefined
}

/**
 * Args de lanzamiento — copia fiel del array ya usado en
 * ScrapService.init(). Mismo orden, mismos flags.
 */
const CHROME_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=BlockInsecurePrivateNetworkRequests',
  '--disable-sync',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--disable-breakpad',
  '--disable-client-side-phishing-detection',
  '--disable-crash-reporter',
  '--disable-hang-monitor',
  '--disable-prompt-on-repost',
  '--disable-popup-blocking',
  '--disable-print-preview',
  '--disable-save-password-bubble',
  '--disable-search-geolocation-disclosure',
  '--disable-speech-api',
  '--disable-sync-types',
  '--disable-translate',
  '--disable-voice-input',
  '--hide-scrollbars',
  '--ignore-certificate-errors',
  '--mute-audio',
  '--no-default-browser-check',
  '--no-first-run'
]

const DEFAULT_PROFILE_DIR = () =>
  process.env.CHROME_PROFILE_DIR || path.join(os.homedir(), '.causas-chrome-profile')

/**
 * Arma el objeto launchOptions completo, listo para puppeteer.launch().
 * Copia fiel de la construcción de launchOptions en ScrapService.init(),
 * incluyendo la lógica de isHeadless (que depende de env_plugin, por
 * eso se recibe como parámetro en vez de importarlo aquí directamente
 * — así este módulo no depende de env.plugin.js, y quien lo llama
 * decide qué valor de headless usar).
 *
 * @param {object} [overrides]
 * @param {boolean} [overrides.headless] - si no se pasa, usa 'new' en
 *        producción y false en desarrollo (mismo criterio que ScrapService)
 * @param {string} [overrides.profileDir]
 * @param {string} [overrides.proxyServer] - si viene, se agrega
 *        --proxy-server=... a los args (igual que ScrapService.init)
 * @returns {import('puppeteer').LaunchOptions}
 */
function buildLaunchOptions(overrides = {}) {
  const isHeadless = overrides.headless !== undefined
    ? overrides.headless
    : (process.env.NODE_ENV === 'production' ? 'new' : false)

  const profileDir = overrides.profileDir || DEFAULT_PROFILE_DIR()
  const args = [...CHROME_ARGS]

  if (overrides.proxyServer) {
    args.push(`--proxy-server=${overrides.proxyServer}`)
  }

  const launchOptions = {
    headless: isHeadless,
    userDataDir: profileDir,
    defaultViewport: null,
    slowMo: process.env.NODE_ENV === 'production' ? 0 : 100,
    ignoreDefaultArgs: ['--enable-automation'],
    args
  }

  const executablePath = getExecutablePath()
  if (executablePath) {
    launchOptions.executablePath = executablePath
  }

  return launchOptions
}

module.exports = {
  getExecutablePath,
  buildLaunchOptions,
  CHROME_ARGS,
  DEFAULT_PROFILE_DIR
}
