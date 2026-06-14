/**
 * TEST SCRAPER CON AUTENTICACIÓN
 * 
 * Uso: node test-scraper-auth.js
 */

const fs = require('fs');
const path = require('path');
const { MongoDatabase } = require('../utils/db');
const { envs } = require('../utils/plugins');
const { scrapRawDataAuth, closeAuthScrapeInstance } = require('../utils/scrapper-auth');
const logger = require('../utils/logger');

const TEST_CONFIG = {
    court: '90',
    tribune: '273',
    rol: 'C-21503-2024',
    competencia: '3',
    testDate: new Date().toISOString(),
    description: 'Prueba de scraping con autenticación Clave Única'
};

async function testScraperAuth() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║           TEST SCRAPER CON AUTENTICACIÓN - MODO EXTREMO         ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('⚠️ IMPORTANTE:');
    console.log('   - La PRIMERA VEZ deberás resolver el reCAPTCHA manualmente');
    console.log('   - El script escribirá RUT y contraseña automáticamente');
    console.log('   - La sesión se guardará en BD para futuras ejecuciones');
    console.log('');
    console.log('📋 Configuración de la prueba:');
    console.log(`   - Competencia: ${TEST_CONFIG.competencia} (Civil)`);
    console.log(`   - Corte ID: ${TEST_CONFIG.court} (C.A. de Santiago)`);
    console.log(`   - Tribunal ID: ${TEST_CONFIG.tribune} (15º Juzgado Civil de Santiago)`);
    console.log(`   - Rol completo: ${TEST_CONFIG.rol}`);
    console.log('');

    console.log('🔌 Conectando a MongoDB...');
    try {
        await MongoDatabase.connect({
            url: envs.MONGO_URI,
            dbName: envs.MONGO_DB_NAME
        });
        console.log('✅ Conexión a MongoDB establecida');
    } catch (dbError) {
        console.error('❌ Error conectando a MongoDB:', dbError.message);
        return;
    }

    const startTime = Date.now();

    try {
        console.log('');
        console.log('🚀 Iniciando scraper autenticado...');
        console.log('   El navegador se abrirá en modo visible');
        console.log('');

        const result = await scrapRawDataAuth({
            rol: TEST_CONFIG.rol,
            tribune: TEST_CONFIG.tribune,
            competencia: TEST_CONFIG.competencia,
            corteId: TEST_CONFIG.court
        });

        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

        const output = {
            testMetadata: {
                executedAt: TEST_CONFIG.testDate,
                elapsedSeconds: elapsedTime,
                searchParams: TEST_CONFIG,
                success: true,
                authMethod: 'ClaveUnica'
            },
            extractedData: result
        };

        const outputPath = path.join(process.cwd(), 'test-result-auth.json');
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
        console.log(`   - Litigantes: ${result.litigants?.length || 0}`);
        console.log(`   - Movimientos: ${result.movementsHistory?.length || 0}`);
        
        if (result.movementsHistory && result.movementsHistory.length > 0) {
            const lastMovement = result.movementsHistory[0];
            console.log(`   - Último trámite: ${lastMovement.dateProcedure || 'N/A'}`);
        }

        console.log('');
        console.log('🔍 El navegador permanecerá abierto por 10 segundos...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        await closeAuthScrapeInstance();

    } catch (error) {
        console.error('');
        console.error('╔════════════════════════════════════════════════════════════════╗');
        console.error('║                         ERROR EN SCRAPER                       ║');
        console.error('╚════════════════════════════════════════════════════════════════╝');
        console.error('');
        console.error('❌ Error:', error.message);
        console.error('');
        console.error('Stack trace:');
        console.error(error.stack);

        const errorOutput = {
            testMetadata: {
                executedAt: TEST_CONFIG.testDate,
                searchParams: TEST_CONFIG,
                success: false,
                error: error.message,
                authMethod: 'ClaveUnica'
            },
            extractedData: null
        };

        const outputPath = path.join(process.cwd(), 'test-result-auth-error.json');
        fs.writeFileSync(outputPath, JSON.stringify(errorOutput, null, 2));
        console.log(`⚠️ Información del error guardada en: ${outputPath}`);

        await closeAuthScrapeInstance();
    }
}

console.log('');
console.log('🕒 La prueba puede tomar varios minutos...');
console.log('   IMPORTANTE: Cuando aparezca el reCAPTCHA, resuélvelo manualmente');
console.log('   El resto del proceso es automático');
console.log('');

testScraperAuth();