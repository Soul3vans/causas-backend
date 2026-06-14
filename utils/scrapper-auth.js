/**
 * SCRAPER CON AUTENTICACIÓN (Clave Única)
 * 
 * Este archivo implementa el scraping usando autenticación Clave Única.
 * La autenticación se maneja en puppeteer.plugin.js - login()
 * 
 * Flujo:
 * 1. Navegar a home/index.php
 * 2. Establecer localStorage/sessionStorage
 * 3. LLAMAR A login() que maneja reCAPTCHA + RUT/PASS automático
 * 4. Esperar redirección a indexN.php
 * 5. Hacer clic en "Consulta Unificada" en el nav
 * 6. Esperar a que el formulario de búsqueda cargue
 * 7. Continuar con la búsqueda
 */

const { ScrapService } = require('./plugins/puppeteer.plugin');
const { UnifiedQuery } = require('./causes/unified-query/unified-query');
const logger = require('./logger');

// Reutilizar la misma instancia global del navegador
let globalAuthScrapeInstance = null;
let isAuthenticated = false;

/**
 * Obtiene o crea la instancia del navegador para autenticación
 * @returns {Promise<ScrapService>}
 */
async function getAuthScrapeInstance() {
    if (globalAuthScrapeInstance) {
        return globalAuthScrapeInstance;
    }
    
    console.log('📍 Creando instancia del navegador para autenticación...');
    const scrape = new ScrapService();
    
    // Inicializar navegador (modo visible, skipAuth = false para que ejecute login())
    await scrape.init(undefined, false);
    
    globalAuthScrapeInstance = scrape;
    isAuthenticated = true; // login() ya se ejecutó y fue exitoso
    return globalAuthScrapeInstance;
}

/**
 * Hace clic en "Consulta Unificada" en el nav después de autenticarse
 * @param {Object} page - Página de Puppeteer
 * @returns {Promise<boolean>}
 */
async function clickConsultaUnificada(page) {
    try {
        console.log('🔍 Buscando enlace "Consulta Unificada" en el nav...');
        
        // Expandir el submenú si es necesario
        const submenuExpanded = await page.evaluate(() => {
            const submenuTrigger = document.querySelector('li.subLi a[href="#misCauSubmenu"]');
            if (submenuTrigger) {
                const isExpanded = submenuTrigger.getAttribute('aria-expanded') === 'true';
                if (!isExpanded) {
                    submenuTrigger.click();
                    return true;
                }
            }
            return false;
        });
        
        if (submenuExpanded) {
            console.log('📂 Submenú expandido');
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Buscar y hacer clic en "Consulta Unificada"
        const clicked = await page.evaluate(() => {
            // Buscar por el texto exacto
            const links = Array.from(document.querySelectorAll('a'));
            const unifiedLink = links.find(a => 
                a.textContent.trim() === 'Consulta Unificada' ||
                a.textContent.includes('Unificada')
            );
            
            if (unifiedLink) {
                unifiedLink.click();
                return true;
            }
            
            // Fallback: buscar en el submenú de causas
            const causeLink = document.querySelector('#misCauSubmenu a');
            if (causeLink) {
                causeLink.click();
                return true;
            }
            
            return false;
        });
        
        if (clicked) {
            console.log('✅ "Consulta Unificada" seleccionado');
            await new Promise(resolve => setTimeout(resolve, 2000));
            return true;
        } else {
            console.warn('⚠️ No se encontró "Consulta Unificada", continuando de todos modos...');
            return false;
        }
        
    } catch (error) {
        console.error('❌ Error haciendo clic en Consulta Unificada:', error.message);
        return false;
    }
}

/**
 * Espera a que el formulario de búsqueda esté visible
 * @param {Object} page - Página de Puppeteer
 * @returns {Promise<boolean>}
 */
async function waitForSearchForm(page) {
    console.log('⏳ Esperando a que cargue el formulario de búsqueda...');
    
    try {
        // Esperar a que el selector select#competencia esté visible
        await page.waitForSelector('select#competencia', { timeout: 30000, visible: true });
        console.log('✅ Formulario de búsqueda visible (select#competencia encontrado)');
        return true;
    } catch (error) {
        console.error('❌ Error esperando formulario de búsqueda:', error.message);
        return false;
    }
}

/**
 * Función principal de scraping con autenticación
 * @param {Object} params - Parámetros de búsqueda
 * @param {string} params.rol - Rol completo (ej: "C-21503-2024")
 * @param {string} params.tribune - ID del tribunal (ej: "273")
 * @param {string} params.competencia - ID de competencia (ej: "3" para Civil)
 * @param {string} params.corteId - ID de la corte (ej: "90")
 * @returns {Promise<Object>} - Datos extraídos de la causa
 */
async function scrapRawDataAuth({ rol, tribune, competencia, corteId }) {
    console.log('='.repeat(60));
    console.log('INICIANDO SCRAPER CON AUTENTICACIÓN');
    console.log('='.repeat(60));
    console.log(`📋 Causa: ${rol}`);
    console.log(`🏛️ Tribunal ID: ${tribune}, Competencia: ${competencia}, Corte: ${corteId}`);
    console.log('='.repeat(60));
    
    let scrape = null;
    
    try {
        // Obtener instancia del navegador (la autenticación ya se hizo en getAuthScrapeInstance)
        scrape = await getAuthScrapeInstance();
        const page = scrape.getPage();
        
        // Verificar la URL actual
        const currentUrl = page.url();
        console.log(`📍 URL actual después de autenticación: ${currentUrl}`);
        
        // Si no estamos en indexN.php, navegar manualmente
        if (!currentUrl.includes('indexN.php')) {
            console.log('📍 Navegando a indexN.php...');
            await page.goto('https://oficinajudicialvirtual.pjud.cl/indexN.php', {
                waitUntil: 'networkidle2',
                timeout: 60000
            });
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        // Hacer clic en "Consulta Unificada"
        await clickConsultaUnificada(page);
        
        // Esperar a que el formulario de búsqueda cargue
        const formReady = await waitForSearchForm(page);
        if (!formReady) {
            throw new Error('No se pudo cargar el formulario de búsqueda después de autenticación');
        }
        
        // Crear UnifiedQuery y usar métodos DIRECTOS
        console.log('🔍 Iniciando búsqueda de la causa...');
        
        const storage = null;
        const unifiedQuery = new UnifiedQuery(scrape, storage);
        
        const filters = {
            court: corteId || '90',
            tribune: tribune,
            rol: rol,
            competencia: competencia || '3'
        };
        
        // Aplicar filtros DIRECTAMENTE
        await unifiedQuery.applyFilter(filters);
        
        // Extraer anchors (resultados de búsqueda)
        await unifiedQuery.extractAnchors();
        
        // Verificar si hay resultados
        if (unifiedQuery.anchors.length === 0) {
            throw new Error('No se encontraron resultados para la causa: ' + rol);
        }
        
        // Extraer detalles de la causa
        await unifiedQuery.collectDetails({ autoCloseModal: true, maxResults: 1 });
        
        // Obtener el resultado
        const result = unifiedQuery.getccivil();
        
        if (!result) {
            throw new Error('No se obtuvieron datos del scraper para la causa: ' + rol);
        }
        
        console.log('✅ Scraping autenticado completado exitosamente');
        console.log(`   - Litigantes: ${result.litigants?.length || 0}`);
        console.log(`   - Movimientos: ${result.movementsHistory?.length || 0}`);
        console.log(`   - Enlaces: ${result.documentLinks?.length || 0}`);
        
        return result;
        
    } catch (error) {
        console.error('❌ Error en scraper autenticado:', error.message);
        logger.error('Error en scrapRawDataAuth', { error: error.message, stack: error.stack, rol });
        throw error;
    }
}

/**
 * Función para mantener la sesión activa
 * @returns {Promise<boolean>}
 */
async function keepSessionAlive() {
    if (!globalAuthScrapeInstance || !isAuthenticated) {
        return false;
    }
    
    try {
        const page = globalAuthScrapeInstance.getPage();
        
        // Hacer una petición ligera para mantener la sesión
        await page.evaluate(() => {
            window.dispatchEvent(new Event('mousemove'));
        });
        
        console.log('🔄 Sesión autenticada mantenida activa');
        return true;
        
    } catch (error) {
        console.warn('⚠️ Error manteniendo sesión:', error.message);
        return false;
    }
}

/**
 * Cierra la instancia del navegador autenticado
 */
async function closeAuthScrapeInstance() {
    if (globalAuthScrapeInstance) {
        console.log('📍 Cerrando instancia del navegador autenticado...');
        await globalAuthScrapeInstance.close();
        globalAuthScrapeInstance = null;
        isAuthenticated = false;
    }
}

/**
 * Verifica si la sesión autenticada sigue activa
 * @returns {Promise<boolean>}
 */
async function isSessionAlive() {
    if (!globalAuthScrapeInstance || !isAuthenticated) return false;
    
    try {
        const page = globalAuthScrapeInstance.getPage();
        const url = page.url();
        return url.includes('indexN.php') || url.includes('inicio');
    } catch (error) {
        return false;
    }
}

module.exports = {
    scrapRawDataAuth,
    closeAuthScrapeInstance,
    getAuthScrapeInstance,
    keepSessionAlive,
    isSessionAlive
};