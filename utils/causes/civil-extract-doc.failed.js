"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CivilCauseExtractFailed = void 0;
class CivilCauseExtractFailed {
    constructor(docs, anchors, scrap, urls = []) {
        this.docs = docs;
        this.anchors = anchors;
        this.scrap = scrap;
        this.urls = urls;
    }
    async collectDetails() {
        try {
            for (const [index, anchor] of this.anchors.entries()) {
                console.log(`Processing cause ${index + 1}/${this.anchors.length}...`);
                await this.scrap.execute(anchor.script);
                await this.scrap.timeout(1500);
                for (const doc of this.docs) {
                    const newDoc = await this.extractDocURL(doc);
                    newDoc && this.urls.push(newDoc);
                }
                await this.scrap.timeout(1000);
                await this.closeModal();
                await this.scrap.timeout(2000);
            }
        }
        catch (error) {
            console.error("Error collecting details:", error);
            throw error;
        }
    }
    parseDate(dateString) {
        const [day, month, year] = dateString.split("/").map(Number);
        return new Date(year, month - 1, day);
    }
    async getNewsURLs() {
        await this.collectDetails();
        return this.urls;
    }
    async extractDocURL(doc) {
        const { procedure, descProcedure, index } = doc;
        try {
            await this.scrap.waitForSelector("div#loadHistCuadernoCiv", 5000);
            const movements = await this.scrap.getPage().evaluate(() => {
                const container = document.querySelector("div#loadHistCuadernoCiv");
                const table = container?.querySelector("table");
                const rows = Array.from(table?.querySelectorAll("tbody>tr") || []);
                return rows.map((row) => {
                    const cells = Array.from(row.querySelectorAll("td"));
                    const invoice = cells[0]?.textContent?.trim() || "";
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
                        invoice,
                        document: documents,
                        stage,
                        procedure,
                        descProcedure,
                        dateProcedure,
                        page: isNaN(pageNumber) ? 0 : pageNumber,
                    };
                });
            });
            const newDoc = movements.find((item) => item.procedure === procedure && descProcedure);
            if (!newDoc || !newDoc.document[index])
                return null;
            return {
                index,
                url: newDoc.document[index],
                dateProcedure: this.parseDate(newDoc.dateProcedure),
                descProcedure: newDoc.descProcedure,
                procedure: newDoc.procedure,
            };
        }
        catch (error) {
            console.error("Error extracting movements history:", error);
            throw error;
        }
    }
    async closeModal() {
        return this.scrap.getPage().evaluate(() => {
            const close = document.querySelector("button.close");
            close?.click();
        });
    }
}
exports.CivilCauseExtractFailed = CivilCauseExtractFailed;
