"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processDocuments = processDocuments;
const plugins_1 = require("../../plugins");
const document_fetch_1 = require("./document-fetch");
async function processDocuments(documents, updater, config = {}) {
    const { batchSize = 10, delayMs = 500 } = config;
    const storage = new plugins_1.FileSystemService();
    const processDocument = async (doc) => {
        const { url, filename, cause } = doc;
        console.log(`Procesando Documento: ${filename}`);
        try {
            const response = await (0, document_fetch_1.fetchDocument)(url);
            console.log(`Respuesta para ${filename}: ${response.code}`);
            if (response.code !== 200) {
                console.warn(`No se pudo obtener ${filename}, code: ${response.code}`);
                await updater(cause, filename); // Notificar el fallo al updater
                return;
            }
            storage.writeDocumentByCause(response.buffer, cause, filename);
            console.log(`Documento guradado satisfactoriamente: ${filename}`);
        }
        catch (error) {
            console.error(`Error al procesar ${filename}:`, error);
            await updater(cause, filename); // Notificar errores inesperados
        }
    };
    const processBatch = async (batch) => {
        console.log(`Procesamiento de lotes de ${batch.length} documentos`);
        await Promise.allSettled(batch.map((item) => processDocument(item)));
        console.log(`Lote procesado exitosamente`);
    };
    // Procesar documentos en lotes
    for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize);
        console.log(`Iniciando lote ${Math.ceil(i / batchSize) + 1}`);
        await processBatch(batch);
        if (delayMs > 0 && i + batchSize < documents.length) {
            console.log(`Esperando por ${delayMs / 1000} secondos antes del siguiente lote...`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
    console.log("Todos los documentos han sido procesados exitosamente.");
}
