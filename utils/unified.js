"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const const_1 = require("./causes/helpers/const");
const scrape_unified_1 = require("./causes/unified-query/scrape-unified");
const db_1 = require("./db");
const plugins_1 = require("./plugins");
async function run() {
    try {
        await db_1.MongoDatabase.connect({
            url: plugins_1.envs.MONGO_URI,
            dbName: plugins_1.envs.MONGO_DB_NAME,
        });
        const rol = "C-2624-2024";
        const rawData = await (0, scrape_unified_1.scrapeUnified)({
            court: "Concep",
            tribune: "Juzgado Civil",
            rol,
        });
        await db_1.CauseCivil.findOneAndReplace({ rol }, rawData, {
            upsert: true,
        });
        console.log("Civil cause remplaced...");
        console.log("Proccess finally");
    }
    catch (error) {
        console.error(error);
    }
    finally {
        const timeout = setTimeout(() => {
            console.log("Closing of the process...");
            process.exit(0);
        }, const_1.DEFAULT_TIMEOUT_PROCESS);
        timeout.unref();
    }
}
run();
