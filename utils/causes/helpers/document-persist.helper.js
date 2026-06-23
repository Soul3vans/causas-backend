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

    /**
     * ✅ MODIFICADO: Procesa documentos en lotes de 5 en paralelo
     */
    annexsEvaluate() {
        const total = this.annexs.length;
        console.log(`📥 Iniciando procesamiento de ${total} documentos...`);
        
        // Si no hay documentos, salir
        if (total === 0) {
            console.log('📭 No hay documentos para procesar');
            return;
        }

        // ✅ Si hay pocos documentos (≤ 5), procesar en un solo lote
        if (total <= 5) {
            console.log(`📥 Procesando ${total} documentos en un solo lote...`);
            (0, worker_launch_document_1.runWorkerDocument)(
                this.annexs.map((item) => this.evaluateAnnex(item)),
                this.issue,
                "annex"
            );
            return;
        }

        // ✅ Dividir en lotes de 5
        const BATCH_SIZE = 5;
        const batches = [];
        
        for (let i = 0; i < total; i += BATCH_SIZE) {
            const batch = this.annexs.slice(i, i + BATCH_SIZE);
            batches.push(batch);
        }

        console.log(`📦 Procesando ${batches.length} lotes de ${BATCH_SIZE} documentos...`);

        // ✅ Procesar cada lote secuencialmente (pero cada lote en paralelo)
        // Usamos una función asíncrona para esperar a que cada lote termine
        (async () => {
            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                const batchNumber = i + 1;
                console.log(`🔄 Procesando lote ${batchNumber}/${batches.length} (${batch.length} documentos)...`);
                
                try {
                    await (0, worker_launch_document_1.runWorkerDocument)(
                        batch.map((item) => this.evaluateAnnex(item)),
                        this.issue,
                        `annex-batch-${batchNumber}`
                    );
                    console.log(`✅ Lote ${batchNumber} procesado exitosamente`);
                } catch (error) {
                    console.error(`❌ Error en lote ${batchNumber}:`, error.message);
                }
                
                // ✅ Esperar 0.5 segundos entre lotes para no saturar
                if (i < batches.length - 1) {
                    console.log(`⏳ Esperando 0.5 segundos antes del siguiente lote...`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            console.log(`✅ Todos los documentos han sido procesados exitosamente.`);
        })();
    }

    evaluateAnnex(annex) {
        const { date, descProcedure, document, procedure, reference } = annex;
        const filename = `${(0, parse_string_1.parseStringToCode)(procedure)}_${(0, parse_string_1.parseStringToCode)(descProcedure)}_${(0, code_calc_1.codeUnique)(date)}_${(0, parse_string_1.parseStringToCode)(reference)}_anexo`;
        return { filename, url: document, cause: this.cause };
    }
}

exports.DocumentAnnexPersistHelper = DocumentAnnexPersistHelper;