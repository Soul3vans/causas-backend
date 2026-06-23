"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWorkerDocument = runWorkerDocument;
const node_path_1 = __importDefault(require("node:path"));
const node_worker_threads_1 = require("node:worker_threads");

function runWorkerDocument(documents, issue, mode) {
    return new Promise((resolve, reject) => {
        const worker = new node_worker_threads_1.Worker(node_path_1.default.resolve(__dirname, "./worker.js"));
        console.log(`🧑‍💻 Iniciando worker (${documents.length} documentos, modo: ${mode})...`);
        
        worker.postMessage({ documents, issue, mode });
        
        worker.on("message", (message) => {
            if (message.status === "success") {
                console.log(`✅ Worker completado: ${message.processed || documents.length} documentos procesados`);
                resolve();
            } else if (message.status === "progress") {
                console.log(`📊 Progreso: ${message.current}/${message.total} documentos`);
            } else {
                reject(new Error(message.error || "Error desconocido"));
            }
        });
        
        worker.on("error", (error) => {
            console.error(`❌ Error en worker:`, error.message);
            reject(error);
        });
        
        worker.on("exit", (code) => {
            if (code !== 0) {
                reject(new Error(`Worker exited with code ${code}`));
            }
        });
    });
}