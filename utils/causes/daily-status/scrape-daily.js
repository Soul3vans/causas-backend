"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrapeDaily = void 0;
const plugins_1 = require("../../plugins");
const daily_1 = require("./daily");
const scrapeDaily = async (filters, repository) => {
    const scrape = new plugins_1.ScrapService();
    const daily = new daily_1.Daily(scrape);
    await scrape.init();
    await daily.rawData(filters);
    await repository(daily.ccivils);
    await daily.collectDocuments();
};
exports.scrapeDaily = scrapeDaily;
