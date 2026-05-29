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
        console.log(`Starting document processing: ${filename}`);
        try {
            const response = await (0, document_fetch_1.fetchDocument)(url);
            console.log(`Response for ${filename}: ${response.code}`);
            if (response.code !== 200) {
                console.warn(`Failed to fetch ${filename}, code: ${response.code}`);
                await updater(cause, filename); // Notificar el fallo al updater
                return;
            }
            storage.writeDocumentByCause(response.buffer, cause, filename);
            console.log(`Document saved successfully: ${filename}`);
        }
        catch (error) {
            console.error(`Error processing ${filename}:`, error);
            await updater(cause, filename); // Notificar errores inesperados
        }
    };
    const processBatch = async (batch) => {
        console.log(`Processing batch of ${batch.length} documents`);
        await Promise.allSettled(batch.map((item) => processDocument(item)));
        console.log(`Batch processed successfully`);
    };
    // Procesar documentos en lotes
    for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize);
        console.log(`Starting batch ${Math.ceil(i / batchSize) + 1}`);
        await processBatch(batch);
        if (delayMs > 0 && i + batchSize < documents.length) {
            console.log(`Waiting for ${delayMs / 1000} seconds before next batch...`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
    console.log("All documents processed successfully.");
}
