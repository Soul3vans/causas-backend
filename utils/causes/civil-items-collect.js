"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CivilItemsCollect = void 0;
class CivilItemsCollect {
    constructor(page, scrape) {
        this.page = page;
        this.scrape = scrape;
    }
    async handleDetail(cb) {
        try {
            const { books, ...civilDetail } = await this.extractCauseDetails();
            console.table([books]);
            for (const book of books) {
                await this.simuleClickBook(book.value);
                await this.scrape.timeout(1500);
                await cb(civilDetail, book.label);
            }
        }
        catch (error) {
            console.error("Error extracting details of civil case");
            throw error;
        }
    }
    async simuleClickBook(value) {
        try {
            await this.scrape.waitForSelector("select#selCuaderno", 2000);
            //   await this.page.select("select#selCuaderno", value);
            await this.page.evaluate((value) => {
                const select = document.querySelector("select#selCuaderno");
                if (select) {
                    select.value = value;
                    select.dispatchEvent(new Event("change"));
                }
            }, value);
            await this.scrape.timeout(1500);
        }
        catch (error) {
            console.error("Error select book:", error);
            throw error;
        }
    }
    async extractCauseDetails() {
        try {
            await this.scrape.waitForSelector('div[style="background-color:#F9F9F9"]', 5000);
            const causeDetails = await this.page.evaluate(() => {
                const cells = Array.from(document.querySelectorAll('div[style="background-color:#F9F9F9"] > table:nth-child(1) td') || []).map((cell) => cell.textContent?.trim() || "");
                const selectContainer = document.querySelector("select#selCuaderno");
                const listOptions = Array.from(selectContainer?.querySelectorAll("option") || []);
                return {
                    rol: cells[0]?.replace("ROL:", "").trim() || "",
                    admission: cells[1]?.replace("F. Ing.:", "").trim() || "",
                    cover: cells[2]?.trim() || "",
                    estAdmin: cells[3]?.replace("Est. Adm.:", "").trim() || "",
                    process: cells[4]?.replace("Proc.:", "").trim() || "",
                    location: cells[5]?.replace("Ubicación:", "").trim() || "",
                    processState: cells[6]?.replace("Estado Proc.:", "").trim() || "",
                    stage: cells[7]?.replace("Etapa:", "").trim() || "",
                    court: cells[8]?.replace("Tribunal:", "").trim() || "",
                    books: listOptions.map((item) => ({
                        value: item.value,
                        label: item.textContent?.trim() || "",
                    })),
                };
            });
            return {
                ...causeDetails,
                admission: this.parseDate(causeDetails.admission),
            };
        }
        catch (error) {
            console.error("Error extracting cause details:", error);
            throw error;
        }
    }
    parseDate(dateString) {
        const [day, month, year] = dateString.split("/").map(Number);
        return new Date(year, month - 1, day);
    }
}
exports.CivilItemsCollect = CivilItemsCollect;
