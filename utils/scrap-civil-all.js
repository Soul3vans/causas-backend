"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const causes_1 = require("./causes");
const db_1 = require("./db");
const plugins_1 = require("./plugins");
const scrapCivilAll = async () => {
    try {
        console.log("Capture all civil cause initialized...");
        await db_1.MongoDatabase.connect({
            url: plugins_1.envs.MONGO_URI,
            dbName: plugins_1.envs.MONGO_DB_NAME,
        });
        const collect = await causes_1.cause.getCivilCauses();
        await db_1.CivilCauseActive.insertMany(collect);
        console.log("Process finish");
        process.exit(0);
    }
    catch (error) {
        console.error(error);
        process.exit();
    }
};
scrapCivilAll();
