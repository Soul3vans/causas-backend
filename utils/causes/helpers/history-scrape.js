"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HistoryScrape = void 0;
const wait_1 = require("../../plugins/wait");
const date_calc_1 = require("./date-calc");
const document_persist_helper_1 = require("./document-persist.helper");
const const_1 = require("./const");
class HistoryScrape {
    constructor(page, cause, issue) {
        this.page = page;
        this.cause = cause;
        this.issue = issue;
        this.histories = [];
        this.folders = [];
        this.anexs = [];
    }
    getmovementsHistories() {
        return this.histories;
    }
    async start() {
        const movements = await this.page.evaluate(() => {
            const container = document.querySelector("div#loadHistCuadernoCiv");
            const table = container?.querySelector("table");
            const rows = Array.from(table?.querySelectorAll("tbody>tr") || []);
            return rows.map((row) => {
                const cells = Array.from(row.querySelectorAll("td"));
                const invoice = cells[0]?.textContent?.trim() || "";
                const folder = cells[2].querySelector("a")?.getAttribute("onclick") || "";
                const stage = cells[3]?.textContent?.trim() || "";
                const procedure = cells[4]?.textContent?.trim() || "";
                const descProcedure = cells[5]?.textContent?.trim() || "";
                const dateProcedure = cells[6]?.textContent?.trim() || "";
                const pageNumber = parseInt(cells[7]?.textContent?.trim() || "0", 10);
                const documentForms = Array.from(cells[1]?.querySelectorAll("form") || []);
                const documents = documentForms.map((form) => {
                    const action = form.getAttribute("action") || "";
                    const input = form.querySelector("input");
                    const queryName = input?.getAttribute("name") || "";
                    const queryValue = input?.getAttribute("value") || "";
                    const url = `${action}?${queryName}=${queryValue}`;
                    return url;
                });
                return {
                    guid: crypto.randomUUID(),
                    invoice,
                    document: documents,
                    stage,
                    procedure,
                    descProcedure,
                    dateProcedure,
                    page: isNaN(pageNumber) ? 0 : pageNumber,
                    folder: folder,
                };
            });
        });
        this.histories.push(...movements.map((item) => ({
            dateProcedure: (0, date_calc_1.dateCalc)(item.dateProcedure),
            descProcedure: item.descProcedure,
            document: item.document,
            invoice: item.invoice,
            page: item.page,
            procedure: item.procedure,
            stage: item.stage,
            guid: item.guid,
        })));
        this.folders.push(...movements
            .filter((item) => item.folder.length > 0)
            .map((item) => ({
            descProcedure: item.descProcedure,
            procedure: item.procedure,
            script: item.folder,
            guid: item.guid,
        })));
        if (this.folders.length === 0) {
            console.log("Not contains folders in", this.cause);
            return [];
        }
        await this.folderExtract();
        const persist = new document_persist_helper_1.DocumentAnnexPersistHelper(this.cause, this.anexs, this.issue);
        persist.annexsEvaluate();
        return persist.makeFilenames();
    }
    async folderExtract() {
        console.log("Folders", this.folders.length);
        for (const folder of this.folders) {
            this.anexs.push(...(await this.rawDataFolder(this.page, folder)));
        }
    }
    async rawDataFolder(page, folder) {
        try {
            console.log("Init evaluate folder in", folder.procedure, folder.descProcedure);
            await page.evaluate((script) => {
                eval(script);
            }, folder.script);
            await page.waitForSelector('div[class="modal in"]', {
                timeout: const_1.DEFAULT_TIMEOUT,
                visible: true,
            });
            await (0, wait_1.wait)(4000);
            const result = await page.$$eval("#modalAnexoSolicitudCivil .modal-body table tbody tr", (rows) => {
                return rows.map((row) => {
                    // Obtén todos los celdas (td) de la fila
                    const cells = row.querySelectorAll("td");
                    // Obtén el valor del token del input hidden
                    const form = row.querySelector("form");
                    const action = form?.getAttribute("action") || "";
                    const input = form?.querySelector("input");
                    const queryName = input?.getAttribute("name") || "";
                    const queryValue = input?.getAttribute("value") || "";
                    const url = `${action}?${queryName}=${queryValue}`;
                    return {
                        document: url,
                        date: cells[1]?.textContent?.trim() || "",
                        reference: cells[2]?.textContent?.trim() || "",
                    };
                });
            });
            console.log("Finish evaluate folder in", folder.procedure, folder.descProcedure);
            console.table(result.map((item) => ({
                reference: item.reference,
                date: item.date,
            })));
            return result.map((item) => ({
                date: (0, date_calc_1.dateCalc)(item.date),
                descProcedure: folder.descProcedure,
                document: item.document,
                procedure: folder.procedure,
                reference: item.reference,
                guid: folder.guid,
            }));
        }
        catch (error) {
            console.warn("Error al renderizar el modal del anexo", HistoryScrape.prototype.rawDataFolder.name);
            if (error instanceof TypeError)
                console.warn(error.message);
            if (error instanceof Error)
                console.warn(error.message);
            return [];
        }
    }
}
exports.HistoryScrape = HistoryScrape;
