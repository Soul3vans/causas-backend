/**
 * test-fingerprint.js
 * -----------------------------------------------------------------
 * Diagnóstico standalone. NO toca el scraper real.
 * Lanza Chrome con EXACTAMENTE la misma config que usa
 * puppeteer.plugin.js hoy (mismo userDataDir, args, headless,
 * executablePath), navega a bot.sannysoft.com, y vuelca:
 *   1. Un screenshot completo (fingerprint-test-result.png)
 *   2. Los valores clave en consola (para pegar en el chat)
 *
 * Uso:
 *   cd causas-backend
 *   node test-fingerprint.js
 * -----------------------------------------------------------------
 */

require('dotenv').config({ path: 'variables.env' }); // igual que server.js

const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const fs = require('fs');

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth')();
StealthPlugin.enabledEvasions.delete('user-agent-override');
puppeteer.use(StealthPlugin);

function getExecutablePath() {
  if (process.env.CHROME_EXECUTABLE_PATH) {
    console.log(`🔧 Usando Chrome fijo: ${process.env.CHROME_EXECUTABLE_PATH}`);
    return process.env.CHROME_EXECUTABLE_PATH;
  }
  if (process.env.NODE_ENV === 'production') {
    console.log('🔧 Modo producción: usando Chromium de Puppeteer');
    return undefined;
  }
  if (process.platform === 'linux') {
    const possibleCommands = ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium'];
    for (const cmd of possibleCommands) {
      try {
        const p = execSync(`which ${cmd}`, { stdio: 'pipe' }).toString().trim();
        if (p) {
          console.log(`🔧 Usando ${cmd} en ${p}`);
          return p;
        }
      } catch (e) {}
    }
  }
  console.warn('⚠️ No se encontró Chrome explícito, usando Chromium de Puppeteer');
  return undefined;
}

(async () => {
  console.log('🔎 process.env.NODE_ENV crudo:', JSON.stringify(process.env.NODE_ENV));
  console.log('🔎 process.env.BROWSER_HEADLESS crudo:', JSON.stringify(process.env.BROWSER_HEADLESS));

  const isHeadless =
    process.env.NODE_ENV === 'production' || process.env.BROWSER_HEADLESS === 'true'
      ? 'new'
      : false;

  const PROFILE_DIR =
    process.env.CHROME_PROFILE_DIR || path.join(os.homedir(), '.causas-chrome-profile');

  console.log('📁 Usando perfil:', PROFILE_DIR);
  console.log('🖥️  Headless:', isHeadless);

  const launchOptions = {
    headless: isHeadless,
    userDataDir: PROFILE_DIR,
    defaultViewport: null,
    slowMo: process.env.NODE_ENV === 'production' ? 0 : 100,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
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
  };

  const executablePath = getExecutablePath();
  if (executablePath) launchOptions.executablePath = executablePath;

  console.log('🚀 Lanzando navegador...\n');
  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();

  console.log('🌐 Navegando a bot.sannysoft.com...');
  await page.goto('https://bot.sannysoft.com/', { waitUntil: 'networkidle2', timeout: 60000 });

  // Dar tiempo a que corran los tests JS de la página
  await new Promise(r => setTimeout(r, 3000));

  const screenshotPath = path.join(__dirname, 'fingerprint-test-result.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`📸 Screenshot guardado en: ${screenshotPath}`);

  const signals = await page.evaluate(() => {
    let webglVendor = null;
    let webglRenderer = null;
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      const dbgInfo = gl && gl.getExtension('WEBGL_debug_renderer_info');
      if (dbgInfo) {
        webglVendor = gl.getParameter(dbgInfo.UNMASKED_VENDOR_WEBGL);
        webglRenderer = gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL);
      }
    } catch (e) {}

    let permissionsState = null;
    try {
      // No podemos await dentro de evaluate síncrono simple, se reporta aparte si hace falta
    } catch (e) {}

    return {
      webdriver: navigator.webdriver,
      userAgent: navigator.userAgent,
      languages: navigator.languages,
      pluginsLength: navigator.plugins.length,
      hasChrome: !!window.chrome,
      chromeRuntime: !!(window.chrome && window.chrome.runtime),
      webglVendor,
      webglRenderer,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory
    };
  });

  console.log('\n===== RESULTADOS =====');
  console.log(JSON.stringify(signals, null, 2));
  console.log('=======================\n');

  console.log('✅ Listo. Revisa el screenshot y pega el bloque RESULTADOS de arriba en el chat.');
  console.log('   Cerrando en 5 segundos...');
  await new Promise(r => setTimeout(r, 5000));

  await browser.close();
})();