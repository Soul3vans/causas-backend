"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateRepository = void 0;
const civil_cause_schema_1 = require("./civil-cause.schema");
const updateRepository = async (rol, filename, mode, issue) => {
    try {
        // Encuentra el documento que corresponde al `rol`
        const causeCivilDocument = await (issue === "daily"
            ? civil_cause_schema_1.CauseCivilUpdater
            : civil_cause_schema_1.CauseCivil).findOne({ rol });
        if (!causeCivilDocument) {
            throw new Error(`CauseCivilDocument with rol ${rol} not found`);
        }
        // Filtrar documentos y anexos basados en el modo
        causeCivilDocument.movementsHistory =
            causeCivilDocument.movementsHistory.map((movement) => {
                const updatedDocuments = movement.document.filter((doc) => {
                    if (mode === "doc") {
                        // Retorna solo los documentos cuyo archivo no coincide con `filename`
                        return doc.file !== filename;
                    }
                    else if (mode === "annex") {
                        // Filtra los anexos dentro del documento
                        doc.annexs = doc.annexs.filter((annex) => annex.file !== filename);
                        return true; // Mantiene el documento incluso si los anexos cambian
                    }
                    return true; // Si no es ni "doc" ni "annex", no elimina nada
                });
                return {
                    ...movement,
                    document: updatedDocuments,
                };
            });
        // Guarda el documento actualizado en la base de datos
        await causeCivilDocument.save();
        console.log(`Files deleted successfully for rol ${rol} and issue ${issue}`);
    }
    catch (error) {
        console.error("Error deleting files:", error);
    }
};
exports.updateRepository = updateRepository;
