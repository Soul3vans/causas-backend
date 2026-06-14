/**
 * TEST SCRAPER - Script de prueba para validar la extracción de datos
 * 
 * Uso: node scripts/test-scraper.js
 * 
 * Este script realiza una prueba completa del scraper con los siguientes datos:
 * - Competencia: Civil (3)
 * - Corte: C.A. de Santiago (90)
 * - Tribunal: 15º Juzgado Civil de Santiago (273)
 * - Libro/Tipo: C
 * - Rol: 21503
 * - Año: 2024
 * - FullRol: C-21503-2024
 * 
 * El resultado se guarda en test-result.json en la raíz del proyecto
 */

const fs = require('fs');
const path = require('path');

// Importar las clases necesarias - AJUSTAR LAS RUTAS SEGÚN TU ESTRUCTURA
const { ScrapService } = require('../utils/plugins/puppeteer.plugin');
const { UnifiedQuery } = require('../utils/causes/unified-query/unified-query');

// Configuración de la causa de prueba
const TEST_CONFIG = {
    // Datos de búsqueda
    court: '90',           // C.A. de Santiago
    tribune: '273',        // 15º Juzgado Civil de Santiago
    rol: 'C-21503-2024',   // Rol completo
    competencia: '3',      // Civil
    
    // Metadatos para el archivo de salida
    testDate: new Date().toISOString(),
    description: 'Prueba de scraping para causa C-21503-2024 del 15º Juzgado Civil de Santiago'
};

// Función principal de prueba
async function testScraper() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    TEST SCRAPER - UNIFIED QUERY                ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('📋 Configuración de la prueba:');
    console.log(`   - Competencia: ${TEST_CONFIG.competencia} (Civil)`);
    console.log(`   - Corte ID: ${TEST_CONFIG.court} (C.A. de Santiago)`);
    console.log(`   - Tribunal ID: ${TEST_CONFIG.tribune} (15º Juzgado Civil de Santiago)`);
    console.log(`   - Rol completo: ${TEST_CONFIG.rol}`);
    console.log(`   - Fecha prueba: ${TEST_CONFIG.testDate}`);
    console.log('');
    console.log('🚀 Iniciando navegador...');
    
    const scrape = new ScrapService();
    const storage = null; // Para pruebas no necesitamos almacenamiento S3
    
    const startTime = Date.now();
    
    try {
        // Inicializar navegador y navegar a la página
        console.log('📍 Navegando a la Oficina Judicial Virtual...');
        await scrape.init();
        
        // Crear instancia de UnifiedQuery
        const unifiedQuery = new UnifiedQuery(scrape, storage);
        
        // Configurar filtros para la búsqueda
        const filters = {
            court: TEST_CONFIG.court,
            tribune: TEST_CONFIG.tribune,
            rol: TEST_CONFIG.rol,
            competencia: TEST_CONFIG.competencia
        };
        
        console.log('🔍 Ejecutando búsqueda y extracción de datos...');
        console.log('   (Este proceso puede tomar varios segundos)');
        
        // Ejecutar el query unificado (todo el flujo de scraping)
        await unifiedQuery.factory(filters);
        
        // Obtener el resultado
        const result = unifiedQuery.getccivil();
        
        // Calcular tiempo transcurrido
        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
        
        if (!result) {
            console.error('❌ No se obtuvieron resultados del scraper');
            return;
        }
        
        // Construir el objeto de salida completo
        const output = {
            testMetadata: {
                executedAt: TEST_CONFIG.testDate,
                elapsedSeconds: elapsedTime,
                searchParams: TEST_CONFIG,
                success: true
            },
            extractedData: result
        };
        
        // Guardar en archivo JSON
        const outputPath = path.join(process.cwd(), 'test-result.json');
        fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
        
        console.log('');
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║                         RESULTADOS                             ║');
        console.log('╚════════════════════════════════════════════════════════════════╝');
        console.log('');
        console.log(`✅ Scraping completado en ${elapsedTime} segundos`);
        console.log(`📁 Resultado guardado en: ${outputPath}`);
        console.log('');
        console.log('📊 Resumen de datos extraídos:');
        console.log(`   - Rol: ${result.rol || 'N/A'}`);
        console.log(`   - Tribunal: ${result.court || 'N/A'}`);
        console.log(`   - Fecha Ingreso: ${result.admission || 'N/A'}`);
        console.log(`   - Estado Procesal: ${result.processState || 'N/A'}`);
        console.log(`   - Etapa: ${result.stage || 'N/A'}`);
        console.log(`   - Litigantes: ${result.litigants?.length || 0}`);
        console.log(`   - Movimientos/Trámites: ${result.movementsHistory?.length || 0}`);
        console.log(`   - Enlaces a documentos: ${result.documentLinks?.length || 0}`);
        
        // Mostrar tipos de enlaces encontrados
        if (result.documentLinks && result.documentLinks.length > 0) {
            const linkTypes = {};
            result.documentLinks.forEach(link => {
                linkTypes[link.type] = (linkTypes[link.type] || 0) + 1;
            });
            console.log(`   - Tipos de enlaces: ${JSON.stringify(linkTypes)}`);
        }
        
        // Mostrar primeros litigantes (si existen)
        if (result.litigants && result.litigants.length > 0) {
            console.log('');
            console.log('👥 Primeros litigantes:');
            result.litigants.slice(0, 5).forEach((lit, idx) => {
                console.log(`   ${idx + 1}. ${lit.participant} - ${lit.name} (${lit.rut})`);
            });
            if (result.litigants.length > 5) {
                console.log(`   ... y ${result.litigants.length - 5} más`);
            }
        }
        
        // Mostrar resumen de movimientos
        if (result.movementsHistory && result.movementsHistory.length > 0) {
            console.log('');
            console.log('📋 Últimos movimientos:');
            const lastMovements = result.movementsHistory.slice(-5).reverse();
            lastMovements.forEach((mov, idx) => {
                const date = mov.dateProcedure ? new Date(mov.dateProcedure).toLocaleDateString('es-CL') : 'Fecha no disponible';
                console.log(`   ${idx + 1}. ${date} - ${mov.procedure} - ${mov.descProcedure?.substring(0, 50)}${mov.descProcedure?.length > 50 ? '...' : ''}`);
            });
        }
        
        console.log('');
        console.log('🔍 Revisa el archivo test-result.json para ver todos los datos completos');
        console.log('');
        
        // Cerrar navegador
        await scrape.close();
        
    } catch (error) {
        console.error('');
        console.error('╔════════════════════════════════════════════════════════════════╗');
        console.error('║                         ERROR EN SCRAPER                       ║');
        console.error('╚════════════════════════════════════════════════════════════════╝');
        console.error('');
        console.error('❌ Error durante la ejecución del scraper:');
        console.error(`   ${error.message}`);
        console.error('');
        console.error('Stack trace:');
        console.error(error.stack);
        console.error('');
        
        // Guardar información del error
        const errorOutput = {
            testMetadata: {
                executedAt: TEST_CONFIG.testDate,
                searchParams: TEST_CONFIG,
                success: false,
                error: error.message
            },
            extractedData: null
        };
        
        const outputPath = path.join(process.cwd(), 'test-result-error.json');
        fs.writeFileSync(outputPath, JSON.stringify(errorOutput, null, 2));
        console.log(`⚠️ Información del error guardada en: ${outputPath}`);
        
        try {
            await scrape.close();
        } catch (closeError) {
            console.error('Error cerrando el navegador:', closeError);
        }
    }
}

// Ejecutar la prueba
console.log('');
console.log('🕒 La prueba puede tomar varios minutos...');
console.log('   El navegador se abrirá automáticamente (modo headless=false)');
console.log('   No interactúes con el navegador durante la ejecución');
console.log('');

testScraper();