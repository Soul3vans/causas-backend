"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyDocumentUpdater = void 0;
const CasesUpdated = require('../../models/CasesUpdated');
const dailyDocumentUpdater = async (rol, filename) => {
    await CasesUpdated.findOneAndUpdate({ rol }, {
        $pull: {
            // Usamos $pull para eliminar un valor específico del array
            "movementsHistory.$[].document": `${filename}.pdf`,
        },
    }, { new: true });
    console.log("Civil case updated", rol);
};
exports.dailyDocumentUpdater = dailyDocumentUpdater;
