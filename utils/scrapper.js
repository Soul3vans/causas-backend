/**
 * SCRAPPER UNIFICADO
 * 
 * Este archivo es el punto de entrada único para el scraping de causas.
 * Utiliza la clase UnifiedQuery que ya está probada y funcionando.
 * 
 * Ruta: causas-backend/utils/scrapper.js
 */

const { ScrapService } = require('./plugins/puppeteer.plugin');
const { UnifiedQuery } = require('./causes/unified-query/unified-query');

/**
 * Función principal de scraping
 * @param {Object} params - Parámetros de búsqueda
 * @param {string} params.typeSearch - Tipo de búsqueda ('RESERVADA' o 'UNIFICADA')
 * @param {string} params.rol - Rol completo (ej: "C-21503-2024")
 * @param {string} params.tribune - ID del tribunal (ej: "273")
 * @param {string} params.competencia - ID de competencia (ej: "3" para Civil)
 * @param {string} params.corteId - ID de la corte (ej: "90")
 * @returns {Promise<Object>} - Datos extraídos de la causa
 */
async function scrapRawData({ typeSearch, rol, tribune, competencia, corteId }) {
  console.log('='.repeat(60));
  console.log('INICIANDO SCRAPER UNIFICADO');
  console.log('='.repeat(60));
  console.log('Parámetros recibidos:');
  console.log(`  - typeSearch: ${typeSearch}`);
  console.log(`  - rol: ${rol}`);
  console.log(`  - tribune (ID): ${tribune}`);
  console.log(`  - competencia: ${competencia}`);
  console.log(`  - corteId: ${corteId}`);
  console.log('='.repeat(60));

  const scrape = new ScrapService();
  const storage = null; // Para scraping no necesitamos S3

  try {
    // Inicializar navegador y navegar
    console.log('📍 Inicializando navegador...');
    await scrape.init();
    
    // Crear instancia de UnifiedQuery
    const unifiedQuery = new UnifiedQuery(scrape, storage);
    
    // Configurar filtros para la búsqueda
    const filters = {
      court: corteId || '90',      // ID de la corte (default: C.A. de Santiago)
      tribune: tribune,             // ID del tribunal
      rol: rol,                     // Rol completo ej: "C-21503-2024"
      competencia: competencia || '3'  // Competencia (default: Civil)
    };
    
    console.log('🔍 Aplicando filtros de búsqueda...');
    console.log(`   - Corte ID: ${filters.court}`);
    console.log(`   - Tribunal ID: ${filters.tribune}`);
    console.log(`   - Rol: ${filters.rol}`);
    console.log(`   - Competencia: ${filters.competencia}`);
    
    // Ejecutar el query unificado (todo el flujo de scraping)
    await unifiedQuery.factory(filters);
    
    // Obtener el resultado
    const result = unifiedQuery.getccivil();
    
    if (!result) {
      throw new Error('No se obtuvieron resultados del scraper');
    }
    
    console.log('✅ Scraping completado exitosamente');
    console.log(`   - Litigantes: ${result.litigants?.length || 0}`);
    console.log(`   - Movimientos: ${result.movementsHistory?.length || 0}`);
    console.log(`   - Enlaces: ${result.documentLinks?.length || 0}`);
    
    // Cerrar navegador
    await scrape.close();
    
    return result;
    
  } catch (error) {
    console.error('❌ Error en el scraper:', error.message);
    console.error('Stack trace:', error.stack);
    
    // Asegurar que el navegador se cierre incluso en error
    try {
      await scrape.close();
    } catch (closeError) {
      console.error('Error cerrando navegador:', closeError);
    }
    
    throw error;
  }
}

/**
 * Función para actualizar una causa existente con nuevos datos del scraper
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
    
    // Ejecutar scraper
    const scrapResult = await scrapRawData({
      typeSearch: 'UNIFICADA',
      rol: fullRol,
      tribune: searchParams.tribunalId,
      competencia: searchParams.competencia,
      corteId: searchParams.corteId
    });
    
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
    
    // Actualizar estado de error
    await caseModel.findByIdAndUpdate(caseId, {
      'scrapedData.status': 'error',
      'scrapedData.errorMessage': error.message,
      'scrapedData.retryCount': (await caseModel.findById(caseId))?.scrapedData?.retryCount + 1 || 1
    });
    
    return { success: false, error: error.message };
  }
}

module.exports = {
  scrapRawData,
  scrapeAndUpdateCase
};