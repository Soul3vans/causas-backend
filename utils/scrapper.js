/**
 * SCRAPPER UNIFICADO
 * 
 * Este archivo es el punto de entrada único para el scraping de causas.
 * Utiliza la clase UnifiedQuery.
 * 
 * Funciones principales:
 * - scrapRawData: Consulta una sola causa (modo invitado)
 * - scrapMultipleCauses: Consulta múltiples causas (NUEVO)
 * - scrapeAndUpdateCase: Actualiza una causa existente
 * - updateMultipleCases: Actualiza múltiples causas existentes (NUEVO)
 */

const { ScrapService } = require('./plugins/puppeteer.plugin');
const { UnifiedQuery } = require('./causes/unified-query/unified-query');
const logger = require('./logger');

/**
 * Error específico: la causa no existe / no fue encontrada en el sitio del Poder Judicial.
 * Esto NO es una falla del sistema, es un resultado válido de búsqueda.
 */
class CaseNotFoundError extends Error {
  constructor(rol) {
    super(`No se encontró la causa "${rol}" en el sitio del Poder Judicial`);
    this.name = 'CaseNotFoundError';
    this.rol = rol;
  }
}

// Instancia única del navegador (Singleton)
let globalScrapeInstance = null;
let isInitializing = false;

// Configuración de reintentos
const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 5000,      // 5 segundos
  maxDelay: 60000,      // 60 segundos
  backoffMultiplier: 2
};

/**
 * Obtiene o crea una instancia única del ScrapService
 * @returns {Promise<ScrapService>}
 */
async function getScrapeInstance() {
    // Si ya existe una instancia, la reutilizamos
    if (globalScrapeInstance) {
        return globalScrapeInstance;
    }
    
    // Si está inicializando, esperamos
    if (isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return getScrapeInstance();
    }
    
    isInitializing = true;
    try {
        console.log('📍 Creando instancia única del navegador...');
        const scrape = new ScrapService();
        await scrape.init();
        globalScrapeInstance = scrape;
        return globalScrapeInstance;
    } finally {
        isInitializing = false;
    }
}

/**
 * Calcula el tiempo de espera para reintentos (backoff exponencial)
 * @param {number} attempt - Número de intento (1-indexed)
 * @param {Object} config - Configuración de reintentos
 * @returns {number} - Tiempo de espera en milisegundos
 */
function calculateBackoffDelay(attempt, config = DEFAULT_RETRY_CONFIG) {
  const { baseDelay, maxDelay, backoffMultiplier } = config;
  const delay = baseDelay * Math.pow(backoffMultiplier, attempt - 1);
  return Math.min(delay, maxDelay);
}

/**
 * Ejecuta una función con reintentos y rotación de IP
 * @param {Function} fn - Función asíncrona a ejecutar
 * @param {Object} options - Opciones de reintento
 * @param {number} options.maxRetries - Máximo de reintentos
 * @param {string} options.context - Contexto para logs
 * @returns {Promise<any>} - Resultado de la función
 */
async function withRetryAndIpRotation(fn, options = {}) {
  const { maxRetries = DEFAULT_RETRY_CONFIG.maxRetries, context = 'unknown' } = options;
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 [${context}] Intento ${attempt}/${maxRetries}`);
      return await fn();
    } catch (error) {
      lastError = error;
      console.error(`❌ [${context}] Error en intento ${attempt}:`, error.message);
      
      // Verificar si el error es por bloqueo de IP
      const isBlockError = error.message?.toLowerCase().includes('block') ||
                          error.message?.toLowerCase().includes('timeout') ||
                          error.message?.toLowerCase().includes('403') ||
                          error.message?.toLowerCase().includes('429');
      
      if (isBlockError && globalScrapeInstance) {
        console.log(`⚠️ [${context}] Posible bloqueo detectado, rotando IP...`);
        await globalScrapeInstance.rotateIp();
        // Re-inicializar después de rotar IP
        await globalScrapeInstance.init();
      }
      
      if (attempt < maxRetries) {
        const delay = calculateBackoffDelay(attempt);
        console.log(`⏳ [${context}] Esperando ${delay}ms antes de reintentar...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

/**
 * Función principal de scraping para UNA sola causa
 * @param {Object} params - Parámetros de búsqueda
 * @param {string} params.typeSearch - Tipo de búsqueda ('RESERVADA' o 'UNIFICADA')
 * @param {string} params.rol - Rol completo (ej: "C-21503-2024")
 * @param {string} params.tribune - ID del tribunal (ej: "273")
 * @param {string} params.competencia - ID de competencia (ej: "3" para Civil)
 * @param {string} params.corteId - ID de la corte (ej: "90")
 * @param {Object} existingScrape - Instancia existente del navegador (opcional)
 * @returns {Promise<Object>} - Datos extraídos de la causa
 */
async function scrapRawData({ typeSearch, rol, tribune, competencia, corteId }, existingScrape = null) {
  console.log('='.repeat(60));
  console.log('INICIANDO SCRAPER UNIFICADO - UNA CAUSA');
  console.log('='.repeat(60));
  console.log(`📋 Causa: ${rol}`);
  console.log(`🏛️ Tribunal ID: ${tribune}, Competencia: ${competencia}, Corte: ${corteId}`);
  console.log('='.repeat(60));

  // Usar instancia existente o crear una nueva (solo una vez)
  const scrape = existingScrape || await getScrapeInstance();
  const storage = null;

  // ✅ ACTIVAR BANDERA: Keep-alive pausado
  if (scrape && typeof scrape.setProcessing === 'function') {
    scrape.setProcessing(true);
  } else if (scrape) {
    scrape.isProcessing = true;
    console.log('🔄 Scraper iniciado, keep-alive pausado');
  }

  try {
    // Crear instancia de UnifiedQuery
    const unifiedQuery = new UnifiedQuery(scrape, storage);
    
    // Configurar filtros para la búsqueda
    const filters = {
      court: corteId || '90',
      tribune: tribune,
      rol: rol,
      competencia: competencia || '3'
    };
    
    console.log('🔍 Ejecutando búsqueda...');
    
    // Ejecutar el query unificado (todo el flujo de scraping)
    await unifiedQuery.factory(filters, { autoCloseModal: true, maxResults: 1 });
    
    // Obtener el resultado
    const result = unifiedQuery.getccivil();
    
    if (!result) {
      throw new CaseNotFoundError(rol);
    }
    
    console.log('✅ Scraping completado exitosamente');
    console.log(`   - Litigantes: ${result.litigants?.length || 0}`);
    console.log(`   - Movimientos: ${result.movementsHistory?.length || 0}`);
    console.log(`   - Enlaces: ${result.documentLinks?.length || 0}`);
    
    return result;
    
  } catch (error) {
    if (error instanceof CaseNotFoundError) {
      console.warn('⚠️ Causa no encontrada:', error.message);
      logger.warn('Causa no encontrada en scrapRawData', { rol });   // log nivel warning, no error
    } else {
      console.error('❌ Error en el scraper:', error.message);
      logger.error('Error en scrapRawData', { error: error.message, stack: error.stack, rol });
    }
    throw error;
  } finally {
    // ✅ DESACTIVAR BANDERA: Keep-alive reactivado
    if (scrape && typeof scrape.setProcessing === 'function') {
      scrape.setProcessing(false);
    } else if (scrape) {
      scrape.isProcessing = false;
      console.log('🔄 Scraper finalizado, keep-alive reactivado');
    }
  }
}

/**
 * SCRAPING MÚLTIPLES CAUSAS (NUEVO)
 * Procesa un array de causas con una sola instancia del navegador
 * @param {Array} causes - Array de objetos con parámetros de búsqueda
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Array>} - Array de resultados (ordenados en el mismo orden que la entrada)
 */
async function scrapMultipleCauses(causes, options = {}) {
  const { 
    continueOnError = true,
    delayBetweenCauses = 2000,  // 2 segundos entre causas
    clearFormBetweenCauses = true
  } = options;
  
  console.log('='.repeat(60));
  console.log('INICIANDO SCRAPER MÚLTIPLES CAUSAS');
  console.log('='.repeat(60));
  console.log(`📋 Total de causas a procesar: ${causes.length}`);
  console.log('='.repeat(60));
  
  const results = [];
  let scrapeInstance = null;
  
  try {
    // Inicializar navegador UNA SOLA VEZ
    console.log('🚀 Inicializando navegador (una sola vez para todas las causas)...');
    scrapeInstance = await getScrapeInstance();
    
    // ✅ ACTIVAR BANDERA: Keep-alive pausado durante todo el batch
    if (scrapeInstance) {
      scrapeInstance.isProcessing = true;
      console.log('🔄 Scraper batch iniciado, keep-alive pausado');
    }
    
    // Procesar cada causa
    for (let i = 0; i < causes.length; i++) {
      const cause = causes[i];
      const currentIndex = i + 1;
      
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`📌 Procesando causa ${currentIndex}/${causes.length}: ${cause.rol || cause.fullRol || 'desconocida'}`);
      console.log(`${'─'.repeat(50)}`);
      
      const startTime = Date.now();
      let result = {
        index: currentIndex,
        originalData: cause,
        status: 'pending',
        data: null,
        error: null,
        elapsedMs: 0
      };
      
      try {
        // Ejecutar scraping con reintentos
        const scrapResult = await withRetryAndIpRotation(
          async () => {
            return await scrapRawData({
              typeSearch: cause.typeSearch || 'UNIFICADA',
              rol: cause.fullRol || `${cause.libroTipo}-${cause.rolNumber}-${cause.year}`,
              tribune: cause.tribunalId || cause.tribune,
              competencia: cause.competencia || '3',
              corteId: cause.corteId || cause.court || '90'
            }, scrapeInstance);
          },
          { context: `Causa ${currentIndex}`, maxRetries: options.maxRetriesPerCause || 3 }
        );
        
        result.status = 'success';
        result.data = scrapResult;
        console.log(`✅ Causa ${currentIndex} completada exitosamente en ${Date.now() - startTime}ms`);
        
      } catch (error) {
        result.status = 'error';
        result.error = error.message;
        console.error(`❌ Causa ${currentIndex} falló:`, error.message);
        
        if (!continueOnError) {
          throw new Error(`Deteniendo en causa ${currentIndex} por error: ${error.message}`);
        }
      }
      
      result.elapsedMs = Date.now() - startTime;
      results.push(result);
      
      // Limpiar formulario para la próxima causa (si hay más)
      if (clearFormBetweenCauses && i < causes.length - 1 && result.status === 'success') {
        console.log('🧹 Limpiando formulario para siguiente causa...');
        try {
          await scrapeInstance.clearForm();
        } catch (clearError) {
          console.warn('⚠️ Error limpiando formulario:', clearError.message);
        }
      }
      
      // Esperar entre causas (evitar sobrecarga)
      if (i < causes.length - 1) {
        console.log(`⏳ Esperando ${delayBetweenCauses}ms antes de siguiente causa...`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenCauses));
      }
    }
    
    // Resumen final
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMEN DE SCRAPING MÚLTIPLES CAUSAS');
    console.log('='.repeat(60));
    console.log(`✅ Exitosas: ${successCount}`);
    console.log(`❌ Fallidas: ${errorCount}`);
    console.log(`📋 Total: ${causes.length}`);
    console.log('='.repeat(60));
    
    return results;
    
  } catch (error) {
    console.error('❌ Error fatal en scrapMultipleCauses:', error.message);
    logger.error('Error fatal en scrapMultipleCauses', { error: error.message, stack: error.stack });
    throw error;
  } finally {
    // ✅ DESACTIVAR BANDERA: Keep-alive reactivado
    if (scrapeInstance) {
      scrapeInstance.isProcessing = false;
      console.log('🔄 Scraper batch finalizado, keep-alive reactivado');
    }
  }
}

/**
 * Actualiza una causa existente con nuevos datos del scraper
 * @param {Object} caseModel - Modelo Mongoose de Cases
 * @param {string} caseId - ID de la causa en MongoDB
 * @param {Object} searchParams - Parámetros de búsqueda
 * @param {string} fullRol - Rol completo
 * @returns {Promise<Object>} - Resultado de la actualización
 */
async function scrapeAndUpdateCase(caseModel, caseId, searchParams, fullRol) {
  console.log(`🔄 Actualizando causa ${fullRol} (ID: ${caseId})...`);
  
  try {
    // Actualizar estado a 'scraping'
    await caseModel.findByIdAndUpdate(caseId, {
      'scrapedData.status': 'scraping',
      'scrapedData.lastScrapedAt': new Date()
    });
    
    // Ejecutar scraper y reutilizar instancia
    const scrapResult = await scrapRawData({
      typeSearch: 'UNIFICADA',
      rol: fullRol,
      tribune: searchParams.tribunalId,
      competencia: searchParams.competencia,
      corteId: searchParams.corteId
    }, globalScrapeInstance);
    
    // Preparar datos para actualizar
    const updateData = {
      'scrapedData.status': 'success',
      'scrapedData.lastScrapedAt': new Date(),
      'scrapedData.data': scrapResult,
      'scrapedData.retryCount': 0,
      'scrapedData.errorMessage': null,
      // Actualizar campos principales
      movementsHistory: scrapResult.movementsHistory,
      litigants: scrapResult.litigants,
      admission: scrapResult.admission,
      extLink: scrapResult.extLink,
      process: scrapResult.process,
      stage: scrapResult.stage,
      processState: scrapResult.processState,
      estAdmin: scrapResult.estAdmin,
      location: scrapResult.location,
      debtor: scrapResult.debtor,
      cover: scrapResult.cover,
      court: scrapResult.court,
      lastUpdate: new Date()
    };
    
    // Actualizar en MongoDB
    const updated = await caseModel.findByIdAndUpdate(caseId, { $set: updateData }, { new: true });
    
    console.log(`✅ Causa ${fullRol} actualizada correctamente`);
    return { success: true, data: updated };
    
  } catch (error) {
    console.error(`❌ Error actualizando causa ${fullRol}:`, error.message);
    logger.error('Error en scrapeAndUpdateCase', { error: error.message, stack: error.stack, fullRol });
    
    // Actualizar estado de error
    const existingCase = await caseModel.findById(caseId);
    await caseModel.findByIdAndUpdate(caseId, {
      'scrapedData.status': 'error',
      'scrapedData.errorMessage': error.message,
      'scrapedData.retryCount': (existingCase?.scrapedData?.retryCount || 0) + 1
    });
    
    return { success: false, error: error.message };
  }
}

/**
 * ACTUALIZA MÚLTIPLES CAUSAS EXISTENTES (NUEVO)
 * @param {Object} caseModel - Modelo Mongoose de Cases
 * @param {Array} casesToUpdate - Array de objetos con caseId y parámetros
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Array>} - Array de resultados
 */
async function updateMultipleCases(caseModel, casesToUpdate, options = {}) {
  const { continueOnError = true, delayBetweenUpdates = 2000 } = options;
  
  console.log('='.repeat(60));
  console.log('INICIANDO ACTUALIZACIÓN MÚLTIPLE DE CAUSAS');
  console.log('='.repeat(60));
  console.log(`📋 Total de causas a actualizar: ${casesToUpdate.length}`);
  console.log('='.repeat(60));
  
  const results = [];
  
  try {
    // Asegurar que el navegador esté inicializado
    await getScrapeInstance();
    
    for (let i = 0; i < casesToUpdate.length; i++) {
      const { caseId, searchParams, fullRol } = casesToUpdate[i];
      const currentIndex = i + 1;
      
      console.log(`\n📌 Actualizando causa ${currentIndex}/${casesToUpdate.length}: ${fullRol}`);
      
      const startTime = Date.now();
      let result = {
        index: currentIndex,
        caseId,
        fullRol,
        status: 'pending',
        updated: false,
        error: null,
        elapsedMs: 0
      };
      
      try {
        const updateResult = await withRetryAndIpRotation(
          async () => {
            return await scrapeAndUpdateCase(caseModel, caseId, searchParams, fullRol);
          },
          { context: `Actualización ${currentIndex}`, maxRetries: options.maxRetriesPerCase || 2 }
        );
        
        result.status = updateResult.success ? 'success' : 'error';
        result.updated = updateResult.success;
        result.error = updateResult.error;
        
        if (updateResult.success) {
          console.log(`✅ Causa ${currentIndex} actualizada exitosamente`);
        } else {
          console.error(`❌ Causa ${currentIndex} falló:`, updateResult.error);
        }
        
      } catch (error) {
        result.status = 'error';
        result.error = error.message;
        console.error(`❌ Causa ${currentIndex} falló:`, error.message);
        
        if (!continueOnError) {
          throw error;
        }
      }
      
      result.elapsedMs = Date.now() - startTime;
      results.push(result);
      
      // Esperar entre actualizaciones
      if (i < casesToUpdate.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenUpdates));
      }
    }
    
    // Resumen
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMEN DE ACTUALIZACIÓN MÚLTIPLE');
    console.log('='.repeat(60));
    console.log(`✅ Exitosas: ${successCount}`);
    console.log(`❌ Fallidas: ${errorCount}`);
    console.log('='.repeat(60));
    
    return results;
    
  } catch (error) {
    console.error('❌ Error fatal en updateMultipleCases:', error.message);
    logger.error('Error fatal en updateMultipleCases', { error: error.message, stack: error.stack });
    throw error;
  }
}

/**
 * Función para cerrar el navegador (llamar al apagar el servidor)
 */
async function closeScrapeInstance() {
  if (globalScrapeInstance) {
      console.log('📍 Cerrando instancia del navegador...');
      await globalScrapeInstance.close();
      globalScrapeInstance = null;
  }
}

/**
 * Función para autenticarse manualmente
 */
async function authenticateScrape() {
  const scrape = await getScrapeInstance();
  if (!scrape.isLoggedIn) {
      console.log('🔐 Autenticando navegador...');
      await scrape.login();
  }
  return scrape;
}

module.exports = {
  scrapRawData,
  scrapMultipleCauses,
  scrapeAndUpdateCase,
  updateMultipleCases,
  closeScrapeInstance,
  getScrapeInstance,
  authenticateScrape,
  withRetryAndIpRotation    // Exportado para uso externo
};