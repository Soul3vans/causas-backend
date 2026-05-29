"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentAllHelper = void 0;
const worker_launch_document_1 = require("../workers/worker-launch-document");
class DocumentAllHelper {
    constructor(documents, issue) {
        this.documents = documents;
        this.issue = issue;
    }
    async documentationEvaluate() {
        console.log(`Starting document download for ${this.documents.length} documents...`);
        console.table(this.documents.map(({ cause, filename }) => ({ cause, filename })));
        (0, worker_launch_document_1.runWorkerDocument)(this.documents, this.issue, "doc");
        console.log("Worker corriendo con las evaluaciones de los documentos...");
    }
}
exports.DocumentAllHelper = DocumentAllHelper;
