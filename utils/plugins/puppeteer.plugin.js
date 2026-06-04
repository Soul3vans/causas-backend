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
const user_agent_1 = require('./user-agent')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer_extra_1.default.use(StealthPlugin())

class ScrapService extends events_1.default {
  constructor() {
    super(...arguments)
    this.browser = null
    this.page = null
  }

  getBrowser() {
    return this.browser
  }

  async init(url = 'https://oficinajudicialvirtual.pjud.cl/home/index.php') {
    const customUA = (0, user_agent_1.generateRandomUA)()

    this.browser = await puppeteer_extra_1.default.launch({
      headless: env_plugin_1.envs.BROWSER_HEADLESS,
      defaultViewport: null,
      slowMo: 400,
      executablePath: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    })

    this.page = await this.browser.newPage()

    await this.page.setExtraHTTPHeaders({
      'user-agent': `${customUA}`,
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3',
      'accept-encoding': 'gzip, deflate, br',
      'accept-language': 'en-US,en;q=0.9,en;q=0.8'
    })

    // Modificar navigator.webdriver antes de cargar la página
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
    })

    await this.pageGoto(url)
    console.log(`Init scrap to: <${url}>`)
    await this.login()
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

  async login() {
    await this.page?.evaluate(() => {
      eval('AutenticaCUnica();')
    })
    await this.timeout(4000)
    await this.page?.waitForSelector('input#uname', { timeout: 0 })
    await this.page?.waitForSelector('input[type="password"]', { timeout: 0 })
    await this.page?.type('input#uname', env_plugin_1.envs.RUT)
    await this.page?.type('input[type="password"]', env_plugin_1.envs.PASS)
    await this.page?.click('button#login-submit')
    await this.page?.waitForNavigation({
      waitUntil: 'domcontentloaded',
      timeout: 0
    })
    console.log('Authenticated')
    await this.timeout(2000)
  }

  /**
   * ========== NUEVOS MÉTODOS PARA MANEJO DE reCAPTCHA v3 ==========
   */

  /**
   * Refresca los tokens de reCAPTCHA v3 ejecutando las funciones
   * que ya existen en la página (recaptchacallbackritv3, etc.)
   * @returns {Promise<boolean>} - True si se ejecutó correctamente
   */
  async refreshRecaptchaTokens() {
    console.log('Refrescando tokens de reCAPTCHA...')
    
    try {
      const result = await this.page.evaluate(() => {
        // Ejecutar las funciones de refresh que existen en la página
        if (typeof recaptchacallbackritv3 === 'function') {
          recaptchacallbackritv3()
        }
        if (typeof recaptchacallbacknombrev3 === 'function') {
          recaptchacallbacknombrev3()
        }
        if (typeof recaptchacallbackfechav3 === 'function') {
          recaptchacallbackfechav3()
        }
        if (typeof recaptchacallbackjurv3 === 'function') {
          recaptchacallbackjurv3()
        }
        return true
      })
      
      // Esperar a que los tokens se generen
      await this.timeout(3000)
      console.log('Tokens de reCAPTCHA refrescados')
      return result
    } catch (error) {
      console.error('Error refrescando tokens de reCAPTCHA:', error)
      return false
    }
  }

  /**
   * Verifica que los tokens de reCAPTCHA existan y tengan valor
   * Si no existen, los refresca automáticamente
   * @returns {Promise<boolean>} - True si los tokens son válidos
   */
  async ensureRecaptchaTokens() {
    try {
      const hasTokens = await this.page.evaluate(() => {
        const ritToken = document.getElementById('g-recaptcha-response-rit')?.value
        const nombreToken = document.getElementById('g-recaptcha-response-nombre')?.value
        const fechaToken = document.getElementById('g-recaptcha-response-fecha')?.value
        const jurToken = document.getElementById('g-recaptcha-response-jur')?.value
        
        return !!(ritToken && ritToken.length > 10 && 
                  nombreToken && nombreToken.length > 10 &&
                  fechaToken && fechaToken.length > 10 &&
                  jurToken && jurToken.length > 10)
      })
      
      if (!hasTokens) {
        console.log('Tokens de reCAPTCHA no encontrados o inválidos, refrescando...')
        await this.refreshRecaptchaTokens()
      }
      
      return true
    } catch (error) {
      console.error('Error verificando tokens de reCAPTCHA:', error)
      return false
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

  async close() {
    await this.browser?.close()
    console.log('Scrap finish')
  }
}

exports.ScrapService = ScrapService