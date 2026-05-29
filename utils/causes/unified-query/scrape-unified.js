"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrapeUnified = void 0;
const plugins_1 = require("../../plugins");
const unified_query_1 = require("./unified-query");
const scrapeUnified = async (filters) => {
    const scrape = new plugins_1.ScrapService();
    const storage = new plugins_1.FileSystemService();
    const unifiedQuery = new unified_query_1.UnifiedQuery(scrape, storage);
    await unifiedQuery.factory(filters);
    return unifiedQuery.getccivil();
};
exports.scrapeUnified = scrapeUnified;
