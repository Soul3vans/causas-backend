"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_worker_threads_1 = require("node:worker_threads");
const document_updater_1 = require("../../db/document-updater");
const document_proccess_1 = require("./document-proccess");
if (!node_worker_threads_1.parentPort) {
    throw new Error("This file must be run as a Worker.");
}
node_worker_threads_1.parentPort.on("message", async (data) => {
    const { documents, issue, mode } = data;
    console.log("Cantidad de documents: ", documents.length);
    console.log("Dentro del worker");
    try {
        await (0, document_proccess_1.processDocuments)(documents, async (rol, filename) => {
            console.log(`Init update : ${filename}`);
            await (0, document_updater_1.updateRepository)(rol, filename, mode, issue);
        });
        node_worker_threads_1.parentPort?.postMessage({ status: "success" });
    }
    catch (error) {
        if (error instanceof Error)
            node_worker_threads_1.parentPort?.postMessage({ status: "error", error: error.message });
    }
    finally {
        // Limpieza: cierra el puerto del Worker para liberar recursos
        node_worker_threads_1.parentPort?.close();
    }
});
