"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Daily = void 0;
const node_events_1 = __importDefault(require("node:events"));
const wait_1 = require("../../plugins/wait");
const code_calc_1 = require("../helpers/code-calc");
const date_calc_1 = require("../helpers/date-calc");
const document_all_helper_1 = require("../helpers/document-all.helper");
const history_scrape_1 = require("../helpers/history-scrape");
const parse_string_1 = require("../parse-string");
class Daily extends node_events_1.default {
    constructor(scrape) {
        super();
        this.scrape = scrape;
        this.anchors = [];
        this.civils = [];
        this.annex = [];
        this.evaluateDocument = (doc) => {
            const { url, dateProcedure, descProcedure, index, procedure, rol } = doc;
            const filename = `${(0, parse_string_1.parseStringToCode)(procedure)}_${(0, parse_string_1.parseStringToCode)(descProcedure)}_${(0, code_calc_1.codeUnique)(dateProcedure)}_${index}`;
            return {
                url,
                cause: rol,
                filename,
            };
        };
        this.on("dailyAnchorsEmpty", (msg) => {
            console.log(msg);
            // process.exit();
        });
    }
    async rawData(filters) {
        await this.goMyDailyStatus();
        await this.navToTab();
        await this.applyFilter(filters);
        await this.extractAnchors();
        await this.collectDetails();
    }
    async goMyDailyStatus() {
        try {
            await this.scrape.clickElement('a[onclick="miEstadoDiario();"]', 3500);
            await this.scrape.simuleBodyAction();
            console.log("Navigated to daily status");
        }
        catch (error) {
            console.error("Error navigating to daily status:", error);
            throw error;
        }
    }
    async navToTab() {
        try {
            await this.scrape.clickElement('a[href="#estDiaCivil"]', 3500);
            console.log("Navigated to tab civil cause");
        }
        catch (error) {
            console.error("Error navigating to civil causes tab:", error);
            throw error;
        }
    }
    async applyFilter(options) {
        try {
            await this.scrape.waitForSelector("input#fechaEstDiaCiv");
            await this.page.evaluate(({ day, month, year }) => {
                const dateInput = document.querySelector("input#fechaEstDiaCiv");
                if (dateInput) {
                    dateInput.value = `${day}/${month}/${year}`;
                }
                const search = document.querySelector("button#btnConsultaEstDiaCivil");
                search?.click();
            }, options);
            await (0, wait_1.wait)(3000);
        }
        catch (error) {
            console.error("Error apply filters in date:", error);
            throw error;
        }
    }
    async extractAnchors() {
        await this.scrape.waitForSelector("table#dtaTableDetalleEstDiaCivil", 1500);
        const contentEmpty = "Ningún dato disponible";
        const empty = await this.page.evaluate((content) => {
            return document.body.innerText.includes(content);
        }, contentEmpty);
        if (empty) {
            this.emit("dailyAnchorsEmpty", "No results found...!!!");
        }
        const anchorsOnPage = await this.page.evaluate(() => {
            const table = document.querySelector("table#dtaTableDetalleEstDiaCivil");
            const rows = Array.from(table?.querySelectorAll("tbody>tr") || []);
            return rows
                .map((row) => row
                .querySelector('a[href="#modalDetalleEstDiaCivil"]')
                ?.getAttribute("onclick") || "")
                .filter((script) => script.length > 0);
        });
        const formattedAnchors = anchorsOnPage.map((script) => ({ script }));
        this.anchors.push(...formattedAnchors);
        console.log(`Collected ${formattedAnchors.length} anchors on current page.`);
    }
    async extractCauseDetails() {
        try {
            await this.page.waitForSelector('div[style="background-color:#F9F9F9"]', {
                timeout: 5 * 60 * 1000, // 5min
                visible: true,
            });
            await (0, wait_1.wait)(4000);
            const causeDetails = await this.page.evaluate(() => {
                const getBook = () => Array.from(document.querySelectorAll("select#selCuaderno>option") || [])[0]?.textContent?.trim() || "";
                const cells = Array.from(document.querySelectorAll('div[style="background-color:#F9F9F9"]>table:nth-child(1) td')).map((cell) => cell.textContent?.trim() || "");
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
                    book: getBook(),
                };
            });
            return {
                ...causeDetails,
                admission: (0, date_calc_1.dateCalc)(causeDetails.admission),
            };
        }
        catch (error) {
            console.error("Error extracting cause details:", error);
            throw error;
        }
    }
    async collectDetails() {
        try {
            for (const [index, anchor] of this.anchors.entries()) {
                console.log(`Processing cause ${index + 1}/${this.anchors.length}...`);
                await this.scrape.execute(anchor.script);
                await (0, wait_1.wait)(3500);
                const { book, ...causeDetails } = await this.extractCauseDetails();
                await (0, wait_1.wait)(1000);
                console.log("Book: ", book);
                console.log("Details: ");
                console.table(causeDetails);
                const movements = await this.extractMovementsHistory(causeDetails.rol);
                const movementsHistory = movements.map((item) => ({
                    ...item,
                    book,
                }));
                console.table(movementsHistory.map(({ document, ...histories }) => ({
                    ...histories,
                })));
                const litigants = await this.extractLitigants();
                console.log("Litigants: ");
                console.table(litigants);
                this.civils.push({
                    ...causeDetails,
                    movementsHistory,
                    litigants,
                });
                await this.closeModal();
                await (0, wait_1.wait)(2000);
            }
        }
        catch (error) {
            console.error("Error collecting details:", error);
            throw error;
        }
    }
    async collectDocuments() {
        const docAll = new document_all_helper_1.DocumentAllHelper(this.URLs.map((item) => this.evaluateDocument(item)), "daily");
        await docAll.documentationEvaluate();
    }
    get URLs() {
        const documents = [];
        this.civils.forEach((cause) => {
            cause.movementsHistory.forEach((hisotory) => hisotory.document.forEach((url, index) => {
                documents.push({
                    index,
                    url,
                    dateProcedure: hisotory.dateProcedure,
                    descProcedure: hisotory.descProcedure,
                    procedure: hisotory.procedure,
                    rol: cause.rol,
                });
            }));
        });
        return documents;
    }
    get ccivils() {
        return this.civils.map((cause) => ({
            ...cause,
            movementsHistory: cause.movementsHistory.map(({ document, guid, ...history }) => ({
                ...history,
                document: document.map((_doc, idx) => {
                    return {
                        name: `${history.procedure} ${history.descProcedure}`,
                        file: `${(0, parse_string_1.parseStringToCode)(history.procedure)}_${(0, parse_string_1.parseStringToCode)(history.descProcedure)}_${(0, code_calc_1.codeUnique)(history.dateProcedure)}_${idx}.pdf`,
                        annexs: this.annex.filter((item) => item.guid === guid),
                    };
                }),
            })),
        }));
    }
    async extractLitigants() {
        try {
            await this.page.click('a[href="#litigantesCiv"]');
            await (0, wait_1.wait)(1500);
            const litigants = await this.page.evaluate(() => {
                const rows = Array.from(document.querySelectorAll("div#litigantesCiv table > tbody > tr") ||
                    []);
                return rows.map((row) => {
                    const cells = Array.from(row.querySelectorAll("td"));
                    return {
                        participant: cells[0]?.textContent?.trim() || "",
                        rut: cells[1]?.textContent?.trim() || "",
                        person: cells[2]?.textContent?.trim() || "",
                        name: cells[3]?.textContent?.trim() || "",
                    };
                });
            });
            return litigants;
        }
        catch (error) {
            console.error("Error extracting litigants:", error);
            throw error;
        }
    }
    async extractMovementsHistory(cause) {
        try {
            await this.scrape.waitForSelector("div#loadHistCuadernoCiv", 5000);
            const historyScrape = new history_scrape_1.HistoryScrape(this.page, cause, "daily");
            const annexDocs = await historyScrape.start();
            this.annex.push(...annexDocs);
            const movements = historyScrape.getmovementsHistories();
            return movements;
        }
        catch (error) {
            console.error("Error extracting movements history:", error);
            throw error;
        }
    }
    async closeModal() {
        return this.page.evaluate(() => {
            const close = document.querySelector("button.close");
            close?.click();
        });
    }
    get page() {
        return this.scrape.getPage();
    }
}
exports.Daily = Daily;
