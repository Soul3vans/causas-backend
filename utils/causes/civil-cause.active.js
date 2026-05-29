"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CivilCauseActiveScrape = void 0;
const db_1 = require("../db");
const civil_cause_1 = require("./civil-cause");
const pagination_1 = require("./pagination");
class CivilCauseActiveScrape {
    constructor(scrap) {
        this.scrap = scrap;
        this.civils = [];
    }
    async init() {
        try {
            const mostRecent = await db_1.CivilCauseActive.findOne().sort({
                admissionAt: -1,
            });
            this.civilMostRecent = mostRecent
                ? civil_cause_1.CivilCause.create(mostRecent)
                : undefined;
            if (this.civilMostRecent) {
                console.log("Civil most");
                console.table(this.civilMostRecent);
            }
            await this.scrap.init();
            console.log("Capture of active civil cases initialized");
        }
        catch (error) {
            console.error("Error initializing scrap service:", error);
            throw error;
        }
    }
    async navigateToCivilCausesTab() {
        try {
            await this.scrap.clickElement('a[onclick="misCausas();"]', 3500);
            await this.scrap.clickElement("a#civilTab", 3500);
            await this.scrap.simuleBodyAction();
            console.log("Navigated to civil causes tab.");
        }
        catch (error) {
            console.error("Error navigating to civil causes tab:", error);
            throw error;
        }
    }
    async applyActiveFilter() {
        await this.page.evaluate(() => {
            const statusSelect = document.querySelector("#estadoCausaMisCauCiv");
            if (statusSelect) {
                statusSelect.value = "1";
            }
            const search = document.querySelector("#btnConsultaMisCauCiv");
            search?.click();
        });
        console.log("Filters cuases active applied");
        return this.scrap.timeout(1500);
    }
    async collectCauses() {
        try {
            await this.scrap.waitForSelector("tbody#verDetalleMisCauCiv", 3000);
            // await this.scrap.waitForSelector("div.loadTotalCiv");
            await this.scrap.simuleBodyAction();
            await this.scrap.timeout(1500);
            const totalItems = await this.getTotalItems();
            const pagination = pagination_1.Pagination.calculate(totalItems);
            const totalPages = pagination.length;
            console.log(`Total items: ${totalItems}, Total pages: ${totalPages}`);
            let flag = false;
            for (const page of pagination) {
                const rols = await this.collectRit();
                console.table(rols);
                const thisContinue = this.continueWithScrap(rols);
                if (!thisContinue) {
                    flag = true;
                    console.log("Scrap closed, list of causes unchanged");
                    break;
                }
                this.civils.push(...rols);
                if (page < totalPages) {
                    await this.goToNextPage();
                    console.log(`Go to next page: ${page}`);
                }
            }
            if (flag) {
                await this.finish();
                process.exit(0);
            }
            console.log(`Total rol collected: ${this.civils.length}`);
        }
        catch (error) {
            console.error("Error collecting causes:", error);
            throw error;
        }
    }
    continueWithScrap(rols) {
        if (!this.civilMostRecent) {
            return true;
        }
        const mostRecentCauseInput = rols.reduce((mostRecent, current) => current.admissionAt > mostRecent.admissionAt ? current : mostRecent, rols[0]);
        return this.civilMostRecent.admissionAt < mostRecentCauseInput.admissionAt;
    }
    getCauses() {
        return this.civils;
    }
    async collectRit() {
        // await this.scrap.waitForSelector("div.loadTotalCiv>b");
        const causes = await this.page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll("tbody#verDetalleMisCauCiv>tr") || []);
            return rows
                .map((row) => {
                const cells = Array.from(row.querySelectorAll("td"));
                const getData = (index) => cells[index]?.textContent?.trim() || "";
                return {
                    rol: getData(1),
                    court: getData(2),
                    cover: getData(3),
                    admissionAt: getData(4),
                    processBook: getData(5),
                    book: getData(6),
                };
            })
                .filter((item) => item.rol.length > 0 && item.admissionAt.length > 0);
        });
        return causes.map((civil) => ({
            ...civil,
            admissionAt: this.parseDate(civil.admissionAt),
        }));
    }
    async goToNextPage() {
        try {
            await this.page.evaluate(() => {
                const nextButton = document.querySelector("a#sigId");
                nextButton?.click();
            });
            await this.scrap.timeout(3000);
            await this.scrap.waitForSelector("tbody#verDetalleMisCauCiv", 5000);
            console.log("Navigated to next page.");
        }
        catch (error) {
            console.error("Error navigating to next page:", error);
            throw error;
        }
    }
    async getTotalItems() {
        const totalItemsText = await this.page.evaluate(() => {
            return document.querySelector("div.loadTotalCiv>b")?.textContent || "0";
        });
        const totalItems = parseInt(totalItemsText, 10);
        return isNaN(totalItems) ? 0 : totalItems;
    }
    get page() {
        return this.scrap.getPage();
    }
    parseDate(dateString) {
        const [day, month, year] = dateString
            .split("/")
            .map((item) => Number(item));
        return new Date(year, month - 1, day);
    }
    async finish() {
        return this.scrap.close();
    }
}
exports.CivilCauseActiveScrape = CivilCauseActiveScrape;
