"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentAnnexPersistHelper = void 0;
const parse_string_1 = require("../parse-string");
const worker_launch_document_1 = require("../workers/worker-launch-document");
const code_calc_1 = require("./code-calc");
class DocumentAnnexPersistHelper {
    constructor(cause, annexs, issue) {
        this.cause = cause;
        this.annexs = annexs;
        this.issue = issue;
    }
    makeFilenames() {
        const docs = [];
        this.annexs.forEach((item) => {
            docs.push({
                file: `${this.evaluateAnnex(item).filename}.pdf`,
                reference: item.reference,
                date: item.date,
                guid: item.guid,
            });
        });
        return docs;
    }
    annexsEvaluate() {
        console.log(`Starting document download for ${this.annexs.length} documents...`);
        (0, worker_launch_document_1.runWorkerDocument)(this.annexs.map((item) => this.evaluateAnnex(item)), this.issue, "annex");
        console.log("Worker corriendo con las evaluaciones de los anexos...");
    }
    evaluateAnnex(annex) {
        const { date, descProcedure, document, procedure, reference } = annex;
        const filename = `${(0, parse_string_1.parseStringToCode)(procedure)}_${(0, parse_string_1.parseStringToCode)(descProcedure)}_${(0, code_calc_1.codeUnique)(date)}_${(0, parse_string_1.parseStringToCode)(reference)}_anexo`;
        return { filename, url: document, cause: this.cause };
    }
}
exports.DocumentAnnexPersistHelper = DocumentAnnexPersistHelper;
