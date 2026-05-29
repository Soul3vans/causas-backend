"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ccaseDocumentUpdater = void 0;
const CasesUpdated = require('../../models/CasesUpdated');
const ccaseDocumentUpdater = async (rol, filename) => {
    await CasesUpdated.findOneAndUpdate({ rol }, {
        $pull: {
            "movementsHistory.$[].document": `${filename}.pdf`,
        },
    }, { new: true });
    console.log(CasesUpdated.name, "Civil case updated", rol);
};
exports.ccaseDocumentUpdater = ccaseDocumentUpdater;
