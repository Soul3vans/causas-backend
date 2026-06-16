'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
exports.ScrapService = void 0
const puppeteer_extra_1 = __importDefault(require('puppeteer-extra'))
const env_plugin_1 = require('./env.plugin')
const events_1 = __importDefault(require('events'))
const proxyChain = require('proxy-chain')
const { getProxies } = require('./proxies-free')
const user_agent_1 = require('./user-agent')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')();
puppeteer_extra_1.default.use(StealthPlugin)

class ScrapService extends events_1.default {
  constructor() {
    super(...arguments)
    this.browser = null
    this.page = null
    this.isLoggedIn = false
    this.currentProxy = null
    this.anonymizedProxyUrl = null
    this.keepAliveInterval = null
  }

  getBrowser() {
    return this.browser
  }

  /**
   * Obtiene la ruta del ejecutable de Chrome/Chromium según el sistema operativo
   */
  getExecutablePath() {
    if (process.env.NODE_ENV === 'production') {
      console.log('🔧 Modo producción: usando Chromium de Puppeteer');
      return undefined;
    }
    
    const platform = process.platform;
    
    if (platform === 'win32') {
      const possiblePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
      ];
      
      for (const path of possiblePaths) {
        const fs = require('fs');
        if (fs.existsSync(path)) {
          console.log(`🔧 Modo desarrollo (Windows): usando Chrome en ${path}`);
          return path;
        }
      }
      
      console.warn('⚠️ No se encontró Chrome en Windows, usando Chromium de Puppeteer');
      return undefined;
    }
    
    if (platform === 'linux') {
      const { execSync } = require('child_process');
      const possibleCommands = ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium'];
      
      for (const cmd of possibleCommands) {
        try {
          const path = execSync(`which ${cmd}`, { stdio: 'pipe' }).toString().trim();
          if (path && path.length > 0) {
            console.log(`🔧 Modo desarrollo (Linux): usando ${cmd} en ${path}`);
            return path;
          }
        } catch (e) {}
      }
      
      console.warn('⚠️ No se encontró Chrome/Chromium en Linux, usando Chromium de Puppeteer');
      return undefined;
    }
    
    if (platform === 'darwin') {
      const macPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      const fs = require('fs');
      if (fs.existsSync(macPath)) {
        console.log(`🔧 Modo desarrollo (macOS): usando Chrome en ${macPath}`);
        return macPath;
      }
      
      console.warn('⚠️ No se encontró Chrome en macOS, usando Chromium de Puppeteer');
      return undefined;
    }
    
    console.log(`🔧 Plataforma no reconocida (${platform}), usando Chromium de Puppeteer`);
    return undefined;
  }

  /**
   * Rotar proxy - selecciona un nuevo proxy de la lista
   */
  async rotateProxy() {
    try {
      // Limpiar proxy anterior si existe
      if (this.anonymizedProxyUrl) {
        await proxyChain.closeAnonymizedProxy(this.anonymizedProxyUrl);
        console.log('🧹 Proxy anterior cerrado');
      }
      
      const proxies = await getProxies();
      console.log(`📡 Obtenidos ${proxies.length} proxies disponibles`);
      
      if (proxies.length > 0) {
        this.currentProxy = proxies[Math.floor(Math.random() * proxies.length)];
        console.log(`🔄 Nuevo proxy seleccionado: ${this.currentProxy}`);
        
        const proxyUrl = `http://${this.currentProxy}`;
        this.anonymizedProxyUrl = await proxyChain.anonymizeProxy(proxyUrl);
        console.log(`✅ Proxy configurado y anonimizado`);
        return this.anonymizedProxyUrl;
      } else {
        console.log('⚠️ No se encontraron proxies, usando IP directa');
        return null;
      }
    } catch (proxyError) {
      console.error('❌ Error configurando proxy:', proxyError.message);
      return null;
    }
  }

  async init(url = 'https://oficinajudicialvirtual.pjud.cl/home/index.php', skipAuth = true) {
    const customUA = (0, user_agent_1.generateRandomUA)()
    const isHeadless = process.env.NODE_ENV === 'production' || env_plugin_1.envs.BROWSER_HEADLESS === true;
    
    // === ROTACIÓN DE PROXY AL INICIAR ===
    //const proxyServer = await this.rotateProxy();
    const proxyServer = null;

    const launchOptions = {
      headless: isHeadless,
      defaultViewport: null,
      slowMo: process.env.NODE_ENV === 'production' ? 0 : 400,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
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
        '--disable-webgl',
        '--hide-scrollbars',
        '--ignore-certificate-errors',
        '--mute-audio',
        '--no-default-browser-check',
        '--no-first-run'
      ]
    };

    if (proxyServer) {
      launchOptions.args.push(`--proxy-server=${proxyServer}`);
    }
    
    const executablePath = this.getExecutablePath();
    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }
    
    console.log('🚀 Lanzando navegador con opciones:', {
      headless: launchOptions.headless,
      args: launchOptions.args,
      executablePath: executablePath || 'default (Chromium de Puppeteer)',
      platform: process.platform,
      nodeEnv: process.env.NODE_ENV
    });

    this.browser = await puppeteer_extra_1.default.launch(launchOptions);
    this.page = await this.browser.newPage();

    // Evitar detección de Puppeteer
    await this.page.evaluateOnNewDocument(() => {
      // Ocultar webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      
      // Ocultar plugins
      const originalPlugins = navigator.plugins;
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          if (originalPlugins.length === 0) {
            return [1, 2, 3, 4, 5];
          }
          return originalPlugins;
        }
      });
      
      // Ocultar lenguajes
      Object.defineProperty(navigator, 'languages', { get: () => ['es-CL', 'es', 'en'] });
      
      // Ocultar Chrome específico
      delete navigator.__proto__.webdriver;
      
      // Ocultar propiedades de Puppeteer
      if (window.chrome) {
        window.chrome.runtime = {};
      }
      
      // Modificar permisos
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });

    // Configurar headers
    await this.page.setExtraHTTPHeaders({
      'user-agent': `${customUA}`,
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3',
      'accept-encoding': 'gzip, deflate, br',
      'accept-language': 'es-CL,es;q=0.9,en;q=0.8'
    })

    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
    })

    if (skipAuth) {
      console.log('🔓 Accediendo como invitado a consulta de causas...')
      
      await this.page.goto('https://oficinajudicialvirtual.pjud.cl/home/index.php', {
        waitUntil: 'networkidle2',
        timeout: 60000
      })
      // Esperar a que la página cargue completamente
      console.log('⏳ Esperando 10 segundos para que cargue la página...');
      await this.timeout(10000);
      
      await this.page.evaluate(() => {
        localStorage.setItem('InitSitioOld', '0');
        localStorage.setItem('InitSitioNew', '1');
        localStorage.setItem('logged-in', 'true');
        sessionStorage.setItem('logged-in', 'true');
        localStorage.setItem('acceso-invitado', 'true');
        sessionStorage.setItem('acceso-invitado', 'true');
      })

        // Verificar que los tokens se establecieron
      const tokens = await this.page.evaluate(() => {
        return {
          loggedIn: localStorage.getItem('logged-in'),
          accesoInvitado: localStorage.getItem('acceso-invitado')
        };
      });
      console.log('✅ Tokens establecidos:', tokens)
      /*
      await this.page.goto('https://oficinajudicialvirtual.pjud.cl/indexN.php', {
        waitUntil: 'domcontentloaded', // Si eso no funciona usar waitUntil: 'networkidle2',
        timeout: 60000
      })
      */

       // Esperar adicional
      await this.timeout(5000);
      // console.log('✅ Acceso como invitado completado, en página de búsqueda')

      console.log('✅ Acceso como invitado completado, permaneciendo en home/index.php');
      console.log('📍 El scraper navegará a indexN.php cuando sea necesario');
      // INICIAR KEEP-ALIVE (sin afectar la lógica existente)
      this.startKeepAliveWithReload(300000); // 5 minutos
    } else {
      await this.pageGoto(url)
      await this.login()
    }
  }

  async login() {
    if (this.isLoggedIn) {
      console.log('✅ Ya hay una sesión activa')
      return
    }
    
    console.log('🔐 Iniciando sesión con Clave Única...')
    
    // PASO 1: Abrir el modal de Clave Única
    await this.page?.evaluate(() => {
      eval('AutenticaCUnica();')
    })
    
    console.log('⏳ Esperando que cargue el modal de autenticación...')
    await this.timeout(4000)
    
    // PASO 2: Esperar a que los campos estén disponibles
    await this.page?.waitForSelector('input#uname', { timeout: 30000 })
    await this.page?.waitForSelector('input[type="password"]', { timeout: 30000 })
    
    // PASO 3: Verificar si hay reCAPTCHA visible
    const hasRecaptcha = await this.page?.evaluate(() => {
      const recaptchaFrame = document.querySelector('iframe[src*="recaptcha"]');
      const recaptchaBadge = document.querySelector('.g-recaptcha');
      return recaptchaFrame !== null || recaptchaBadge !== null;
    }).catch(() => false);
    
    if (hasRecaptcha) {
      console.log('\n' + '='.repeat(60));
      console.log('🔐 Se detectó un reCAPTCHA');
      console.log('='.repeat(60));
      console.log('');
      console.log('📋 Por favor, resuelve el reCAPTCHA manualmente en el navegador');
      console.log('   El script esperará hasta que lo resuelvas...');
      console.log('');
      console.log('⏳ Esperando a que el reCAPTCHA sea resuelto...');
      
      // Esperar a que el reCAPTCHA desaparezca o sea resuelto
      let recaptchaResolved = false;
      let attempts = 0;
      const maxAttempts = 180; // 3 minutos (20 segundos * 180 = 3600 segundos = 60 minutos? vamos a ajustar)
      
      while (!recaptchaResolved && attempts < 180) {
        await this.timeout(2000);
        
        const stillHasRecaptcha = await this.page?.evaluate(() => {
          const recaptchaFrame = document.querySelector('iframe[src*="recaptcha"]');
          const recaptchaBadge = document.querySelector('.g-recaptcha');
          return recaptchaFrame !== null || recaptchaBadge !== null;
        }).catch(() => false);
        
        if (!stillHasRecaptcha) {
          recaptchaResolved = true;
          console.log('✅ reCAPTCHA resuelto! Continuando...');
        }
        attempts++;
      }
      
      if (!recaptchaResolved) {
        console.warn('⚠️ Timeout esperando reCAPTCHA, continuando de todos modos...');
      }
    } else {
      console.log('✅ No se detectó reCAPTCHA, continuando con autenticación...');
    }
    
    // PASO 4: Escribir RUT y contraseña automáticamente
    console.log('📝 Escribiendo RUT y contraseña...');
    await this.page?.type('input#uname', env_plugin_1.envs.RUT, { delay: 100 })
    await this.timeout(500)
    await this.page?.type('input[type="password"]', env_plugin_1.envs.PASS, { delay: 100 })
    await this.timeout(500)
    
    // PASO 5: Hacer clic en el botón de ingresar
    console.log('🔘 Haciendo clic en el botón de ingresar...');
    await this.page?.click('button#login-submit')
    
    // PASO 6: Esperar la redirección post-autenticación
    console.log('⏳ Esperando redirección después de autenticación...');
    await this.page?.waitForNavigation({
      waitUntil: 'domcontentloaded',
      timeout: 60000
    })
    
    this.isLoggedIn = true
    console.log('✅ Autenticación completada exitosamente')
    
    await this.timeout(2000)
    // INICIAR KEEP-ALIVE
    this.startKeepAliveWithReload(300000); // 5 minutos
  }

  async invalidLoadImages() {
    await this.page?.setRequestInterception(true)
    return this.page?.on('request', async request => {
      if (request.resourceType() == 'image') {
        await request.abort()
      } else {
        await request.continue()
      }
    })
  }

  async pageGoto(url) {
    const maxRetries = 3
    const delay = 600000
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Intento ${attempt} load page...`)
        const response = await this.page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 5 * 60 * 1000
        })
        if (response?.ok()) {
          console.log('Pagina cargada correctamente: ', response?.status())
          return
        } else {
          console.log('Error al cargar la pagina: ', response?.status())
        }
      } catch (error) {
        console.log('Error durante la carga de la pagina: ', error)
      }
      if (attempt < maxRetries) {
        this.emit('retryPage', 'Esperando 10min antes del proximo intento...')
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
    this.emit(
      'closeBrowser',
      'Se alcanzo el numero maximo de intentos...',
      this.browser
    )
  }

  async simuleBodyAction(otherPage) {
    return (otherPage || this.page)?.evaluate(() => {
      document.querySelector('body')?.click()
    })
  }

  getPage() {
    if (!this.page) throw new Error('Undefined page property')
    return this.page
  }

  async refreshRecaptchaTokens() {
  console.log('🔄 Refrescando tokens de reCAPTCHA...')
  
  try {
    // Esperar a que los callbacks existan
    await this.timeout(2000);
    
    const result = await this.page.evaluate(() => {
      let success = false;
      
      // Intentar ejecutar los callbacks si existen
      if (typeof recaptchacallbackritv3 === 'function') {
        recaptchacallbackritv3();
        success = true;
      }
      if (typeof recaptchacallbacknombrev3 === 'function') {
        recaptchacallbacknombrev3();
        success = true;
      }
      if (typeof recaptchacallbackfechav3 === 'function') {
        recaptchacallbackfechav3();
        success = true;
      }
      if (typeof recaptchacallbackjurv3 === 'function') {
        recaptchacallbackjurv3();
        success = true;
      }
      
      return success;
    });
    
    // Esperar a que los tokens se generen
    await this.timeout(3000);
    
    // Verificar si los tokens se generaron
    const tokens = await this.getRecaptchaTokens();
    console.log(`📊 Tokens después de refrescar:`, {
      rit: tokens.rit ? `${tokens.rit.substring(0, 20)}...` : 'No',
      nombre: tokens.nombre ? `${tokens.nombre.substring(0, 20)}...` : 'No',
      fecha: tokens.fecha ? `${tokens.fecha.substring(0, 20)}...` : 'No',
      jur: tokens.jur ? `${tokens.jur.substring(0, 20)}...` : 'No'
    });
    
    return result;
  } catch (error) {
    console.error('Error refrescando tokens de reCAPTCHA:', error);
    return false;
  }
}

async getRecaptchaTokens() {
    return await this.page.evaluate(() => {
      const ritToken = document.getElementById('g-recaptcha-response-rit')?.value || '';
      const nombreToken = document.getElementById('g-recaptcha-response-nombre')?.value || '';
      const fechaToken = document.getElementById('g-recaptcha-response-fecha')?.value || '';
      const jurToken = document.getElementById('g-recaptcha-response-jur')?.value || '';
      
      return {
        rit: ritToken,
        nombre: nombreToken,
        fecha: fechaToken,
        jur: jurToken
      };
    });
  }

  async ensureRecaptchaTokens() {
    try {
      console.log('🔐 Verificando tokens de reCAPTCHA...');
      
      // Esperar a que los elementos del DOM existan
      await this.page.waitForSelector('#g-recaptcha-response-rit', { timeout: 30000 }).catch(() => {
        console.log('⚠️ Selector #g-recaptcha-response-rit no encontrado');
        return null;
      });
      
      // Obtener tokens actuales
      let tokens = await this.getRecaptchaTokens();
      
      // Verificar si los tokens son válidos (longitud > 10)
      const hasValidTokens = tokens.rit && tokens.rit.length > 10 && 
                            tokens.nombre && tokens.nombre.length > 10 &&
                            tokens.fecha && tokens.fecha.length > 10 &&
                            tokens.jur && tokens.jur.length > 10;
      
      if (hasValidTokens) {
        console.log('✅ Tokens de reCAPTCHA ya están presentes y válidos');
        return true;
      }
      
      console.log('⚠️ Tokens de reCAPTCHA no válidos o incompletos, refrescando...');
      console.log(`   - rit: ${tokens.rit ? `${tokens.rit.length} chars` : 'vacío'}`);
      console.log(`   - nombre: ${tokens.nombre ? `${tokens.nombre.length} chars` : 'vacío'}`);
      console.log(`   - fecha: ${tokens.fecha ? `${tokens.fecha.length} chars` : 'vacío'}`);
      console.log(`   - jur: ${tokens.jur ? `${tokens.jur.length} chars` : 'vacío'}`);
      
      // Intentar refrescar hasta 3 veces
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`🔄 Intento ${attempt} de refrescar tokens...`);
        await this.refreshRecaptchaTokens();
        
        tokens = await this.getRecaptchaTokens();
        
        const isValid = tokens.rit && tokens.rit.length > 10 && 
                        tokens.nombre && tokens.nombre.length > 10 &&
                        tokens.fecha && tokens.fecha.length > 10 &&
                        tokens.jur && tokens.jur.length > 10;
        
        if (isValid) {
          console.log('✅ Tokens refrescados correctamente');
          return true;
        }
        
        await this.timeout(5000);
      }
      
      console.error('❌ No se pudieron obtener tokens de reCAPTCHA válidos después de 3 intentos');
      return false;
      
    } catch (error) {
      console.error('Error en ensureRecaptchaTokens:', error);
      return false;
    }
  }

  async clickElement(selector, delay = 1000, otherPage) {
    await (otherPage || this.page)?.waitForSelector(selector, { timeout: 0 })
    await (otherPage || this.page)?.click(selector)
    await this.timeout(delay)
  }

  async waitForSelector(selector, delay = 1000, visible = true, otherPage) {
    await (otherPage || this.page)?.waitForSelector(selector, {
      timeout: 0,
      visible
    })
    await this.timeout(delay)
  }

  async execute(script, delay = 4000) {
    await this.page?.evaluate(script => eval(script), script)
    await this.timeout(delay)
  }

  timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // ========== KEEP-ALIVE ==========
  /**
   * Mantiene la sesión activa recargando la página periódicamente
   * @param {number} intervalMs - Intervalo en milisegundos (default: 300000 = 5 minutos)
   * @returns {NodeJS.Timeout}
   */
  startKeepAliveWithReload(intervalMs = 300000) {
    // Limpiar intervalo anterior si existe
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      console.log('🔄 Keep-alive anterior detenido');
    }

    console.log(`🔄 Iniciando keep-alive con recarga cada ${intervalMs / 1000} segundos...`);
    
    this.keepAliveInterval = setInterval(async () => {
      try {
        if (this.page && !this.page.isClosed()) {
          console.log(`🔄 [Keep-Alive] Navegando a home/index.php para mantener sesión...`);
          
          await this.page.goto('https://oficinajudicialvirtual.pjud.cl/home/index.php', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
          });
          
          await this.timeout(3000);
          
          await this.page.evaluate(() => {
            localStorage.setItem('InitSitioOld', '0');
            localStorage.setItem('InitSitioNew', '1');
            localStorage.setItem('logged-in', 'true');
            localStorage.setItem('acceso-invitado', 'true');
            sessionStorage.setItem('logged-in', 'true');
            sessionStorage.setItem('acceso-invitado', 'true');
          });
          
          console.log('✅ [Keep-Alive] Tokens restablecidos en home/index.php');
          console.log('📍 [Keep-Alive] Página mantenida en home/index.php - lista para próxima consulta');
          
        } else {
          console.warn('⚠️ [Keep-Alive] Página cerrada, deteniendo intervalo');
          if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
          }
        }
      } catch (error) {
        console.warn('⚠️ [Keep-Alive] Error:', error.message);
      }
    }, intervalMs);
    
    return this.keepAliveInterval;
  }

  /**
   * Detiene el keep-alive
   */
  stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
      console.log('🛑 Keep-Alive detenido');
    }
  }

  async close() {
    // Detener keep-alive antes de cerrar
    this.stopKeepAlive();
    
    if (this.anonymizedProxyUrl) {
      await proxyChain.closeAnonymizedProxy(this.anonymizedProxyUrl);
      console.log('🧹 Proxy cerrado correctamente');
    }
    await this.browser?.close()
    console.log('Scrap finish')
  }
  // ========== NUEVOS MÉTODOS A AGREGAR EN LA CLASE ScrapService ==========

/**
 * Cierra el modal de detalle de causa civil
 * Usa múltiples selectores como fallback
 * @returns {Promise<boolean>} - True si se cerró correctamente
 */
async closeModal() {
  try {
    console.log('🔒 Cerrando modal de detalle de causa...');
    
    // Esperar un momento para asegurar que el modal está visible
    await this.timeout(500);
    
    // Opción 1: Botón close con clase .close
    const closedByButton = await this.page.evaluate(() => {
      const closeBtn = document.querySelector('#modalDetalleCivil .close');
      if (closeBtn) {
        closeBtn.click();
        return true;
      }
      return false;
    });
    
    if (closedByButton) {
      console.log('✅ Modal cerrado con .close');
      await this.timeout(1000);
      return true;
    }
    
    // Opción 2: Botón con data-dismiss="modal"
    const closedByDismiss = await this.page.evaluate(() => {
      const dismissBtn = document.querySelector('#modalDetalleCivil [data-dismiss="modal"]');
      if (dismissBtn) {
        dismissBtn.click();
        return true;
      }
      return false;
    });
    
    if (closedByDismiss) {
      console.log('✅ Modal cerrado con [data-dismiss="modal"]');
      await this.timeout(1000);
      return true;
    }
    
    // Opción 3: Buscar cualquier botón close dentro del modal-header
    const closedByHeader = await this.page.evaluate(() => {
      const headerBtn = document.querySelector('#modalDetalleCivil .modal-header button');
      if (headerBtn) {
        headerBtn.click();
        return true;
      }
      return false;
    });
    
    if (closedByHeader) {
      console.log('✅ Modal cerrado con .modal-header button');
      await this.timeout(1000);
      return true;
    }
    
    // Opción 4: Escapar con tecla ESC como último recurso
    await this.page.keyboard.press('Escape');
    console.log('⚠️ Modal cerrado con tecla Escape');
    await this.timeout(1000);
    
    // Verificar que el modal se cerró
    const isModalVisible = await this.page.evaluate(() => {
      const modal = document.querySelector('#modalDetalleCivil');
      if (!modal) return false;
      const style = window.getComputedStyle(modal);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    
    if (!isModalVisible) {
      console.log('✅ Modal verificado como cerrado');
      return true;
    } else {
      console.warn('⚠️ El modal podría no haberse cerrado correctamente');
      return false;
    }
    
  } catch (error) {
    console.error('❌ Error cerrando modal:', error.message);
    return false;
  }
}

/**
 * Limpia el formulario de búsqueda usando el botón "Limpiar"
 * @returns {Promise<boolean>} - True si se limpió correctamente
 */
async clearForm() {
  try {
    console.log('🧹 Limpiando formulario de búsqueda...');
    
    // Esperar a que el botón exista
    await this.page.waitForSelector('#btnConLimpiar', { timeout: 10000 });
    
    // Hacer clic en el botón Limpiar
    await this.page.click('#btnConLimpiar');
    await this.timeout(1500);
    
    console.log('✅ Formulario limpiado');
    return true;
    
  } catch (error) {
    console.error('❌ Error limpiando formulario:', error.message);
    
    // Fallback: recargar la página
    console.log('🔄 Fallback: recargando página...');
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.timeout(3000);
    return false;
  }
}

/**
 * Detecta si la IP actual está bloqueada por el sitio
 * @returns {Promise<boolean>} - True si está bloqueado
 */
async isBlocked() {
  try {
    const pageContent = await this.page.content();
    const currentUrl = this.page.url();
    
    // Detectar por código de estado (si podemos acceder)
    const statusCode = await this.page.evaluate(() => {
      return window.performance?.getEntriesByType?.('navigation')[0]?.responseStatus || null;
    }).catch(() => null);
    
    // Lista de indicadores de bloqueo
    const blockIndicators = [
      '403 Forbidden',
      '429 Too Many Requests',
      'Access Denied',
      'Acceso denegado',
      'bloqueado',
      'blocked',
      'IP bloqueada',
      'demasiadas solicitudes',
      'too many requests',
      'captcha',
      'reCAPTCHA',
      'verification required'
    ];
    
    // Verificar contenido
    for (const indicator of blockIndicators) {
      if (pageContent.toLowerCase().includes(indicator.toLowerCase())) {
        console.warn(`⚠️ Bloqueo detectado por indicador: "${indicator}"`);
        return true;
      }
    }
    
    // Verificar código de estado
    if (statusCode === 403 || statusCode === 429) {
      console.warn(`⚠️ Bloqueo detectado por código de estado: ${statusCode}`);
      return true;
    }
    
    // Verificar URL de error
    if (currentUrl.includes('error') || currentUrl.includes('bloqueo')) {
      console.warn(`⚠️ Bloqueo detectado por URL: ${currentUrl}`);
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.error('❌ Error detectando bloqueo:', error.message);
    return false;
  }
}

/**
 * Rota la IP usando diferentes métodos (Tor → DHCP → Manual)
 * @param {Object} options - Opciones de rotación
 * @param {string} options.method - Método específico ('tor', 'dhcp', 'manual')
 * @returns {Promise<boolean>} - True si la rotación fue exitosa
 */
async rotateIp(options = {}) {
  const { method = null } = options;
  
  // Métodos disponibles en orden de preferencia
  const methods = method ? [method] : ['tor', 'dhcp', 'manual'];
  
  for (const currentMethod of methods) {
    console.log(`🔄 Intentando rotar IP con método: ${currentMethod}`);
    
    switch (currentMethod) {
      case 'tor':
        const torSuccess = await this.rotateIpViaTor();
        if (torSuccess) return true;
        break;
        
      case 'dhcp':
        const dhcpSuccess = await this.rotateIpViaDHCP();
        if (dhcpSuccess) return true;
        break;
        
      case 'manual':
        const manualSuccess = await this.rotateIpManual();
        if (manualSuccess) return true;
        break;
        
      default:
        console.warn(`⚠️ Método de rotación desconocido: ${currentMethod}`);
    }
  }
  
  console.error('❌ Todos los métodos de rotación de IP fallaron');
  return false;
}

/**
 * Rotación de IP usando Tor (SOCKS5 proxy)
 * @returns {Promise<boolean>}
 */
async rotateIpViaTor() {
  try {
    console.log('🔰 Intentando rotación con Tor...');
    
    // Verificar si Tor está instalado y corriendo
    const torProxyUrl = process.env.TOR_PROXY || 'socks5://127.0.0.1:9050';
    
    // Solicitar nueva identidad a Tor
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    // Comando para solicitar nueva identidad (depende del SO)
    let command;
    if (process.platform === 'win32') {
      // Windows: usar telnet o señal
      command = 'echo -e "signal NEWNYM\\r\\nquit" | nc -x 127.0.0.1 9051';
    } else {
      // Linux/Mac: usar control port
      command = 'echo -e "AUTHENTICATE \\"\\"\\r\\nSIGNAL NEWNYM\\r\\nQUIT\\r\\n" | nc 127.0.0.1 9051';
    }
    
    try {
      await execPromise(command, { timeout: 5000 });
      console.log('✅ Nueva identidad Tor solicitada');
    } catch (cmdError) {
      console.log('⚠️ No se pudo contactar control de Tor, reintentando con proxy...');
    }
    
    // Configurar proxy SOCKS5
    await this.page.authenticate({ username: '', password: '' });
    
    // Reiniciar la página con el nuevo proxy
    await this.page.goto('https://oficinajudicialvirtual.pjud.cl/home/index.php', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    console.log('✅ Rotación con Tor completada');
    return true;
    
  } catch (error) {
    console.error('❌ Error en rotación Tor:', error.message);
    return false;
  }
}

/**
 * Rotación de IP usando DHCP release/renew
 * @returns {Promise<boolean>}
 */
async rotateIpViaDHCP() {
  try {
    console.log('🌐 Intentando rotación con DHCP release/renew...');
    
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    let command;
    const platform = process.platform;
    
    if (platform === 'win32') {
      // Windows
      command = 'ipconfig /release && ipconfig /renew';
    } else if (platform === 'linux') {
      // Linux (requiere sudo)
      command = 'sudo dhclient -r && sudo dhclient';
    } else if (platform === 'darwin') {
      // macOS
      command = 'sudo ipconfig set en0 DHCP';
    } else {
      console.warn(`⚠️ Plataforma no soportada para DHCP: ${platform}`);
      return false;
    }
    
    console.log(`🖥️ Ejecutando: ${command}`);
    
    try {
      await execPromise(command, { timeout: 30000 });
      console.log('✅ DHCP release/renew ejecutado');
    } catch (cmdError) {
      console.warn('⚠️ Error ejecutando DHCP:', cmdError.message);
      return false;
    }
    
    // Esperar a que la red se estabilice
    await this.timeout(5000);
    
    // Verificar nueva IP
    const newIp = await this.page.evaluate(async () => {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      return data.ip;
    }).catch(() => 'desconocida');
    
    console.log(`✅ Nueva IP (posible): ${newIp}`);
    
    // Reiniciar navegación
    await this.page.goto('https://oficinajudicialvirtual.pjud.cl/home/index.php', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    return true;
    
  } catch (error) {
    console.error('❌ Error en rotación DHCP:', error.message);
    return false;
  }
}

/**
 * Rotación de IP manual (notifica al usuario)
 * @returns {Promise<boolean>}
 */
async rotateIpManual() {
  return new Promise((resolve) => {
    console.log('\n⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️');
    console.log('⚠️   IP BLOQUEADA POR EL SITIO                              ⚠️');
    console.log('⚠️                                                         ⚠️');
    console.log('⚠️   Por favor:                                            ⚠️');
    console.log('⚠️   1. Cambie su IP manualmente (VPN, reiniciar router)   ⚠️');
    console.log('⚠️   2. Presione ENTER para continuar                      ⚠️');
    console.log('⚠️                                                         ⚠️');
    console.log('⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️\n');
    
    process.stdin.once('data', () => {
      console.log('✅ Continuando después de cambio manual de IP...');
      resolve(true);
    });
  });
}

/**
 * Wrapper seguro para waitForNavigation con detección de bloqueo
 * @param {Object} options - Opciones de navegación
 * @returns {Promise<boolean>} - True si la navegación fue exitosa
 */
async waitForNavigationSafe(options = {}) {
  const { timeout = 30000, maxRetries = 2 } = options;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Navegación intento ${attempt}/${maxRetries}...`);
      
      await this.page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: timeout
      });
      
      // Verificar si hubo bloqueo después de la navegación
      const isCurrentlyBlocked = await this.isBlocked();
      if (isCurrentlyBlocked) {
        console.warn(`⚠️ Bloqueo detectado después de navegación (intento ${attempt})`);
        if (attempt < maxRetries) {
          await this.rotateIp();
          continue;
        }
        return false;
      }
      
      return true;
      
    } catch (error) {
      console.error(`❌ Error en navegación (intento ${attempt}):`, error.message);
      
      if (attempt < maxRetries) {
        console.log('🔄 Reintentando navegación...');
        await this.rotateIp();
        await this.timeout(3000);
      } else {
        return false;
      }
    }
  }
  
  return false;
}
}

exports.ScrapService = ScrapService
