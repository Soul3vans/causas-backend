"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseStringToCode = void 0;
const parseStringToCode = (value) => {
    const chars = value
        .trim()
        .toLowerCase()
        .replaceAll("ñ", "n")
        .replaceAll("á", "a")
        .replaceAll("é", "e")
        .replaceAll("í", "i")
        .replaceAll("ó", "o")
        .replaceAll("ú", "u")
        .replaceAll("n°", "_")
        .replaceAll("|", "_")
        .replaceAll("/", "_")
        .replaceAll('"', "_")
        .replaceAll("'", "_")
        .replaceAll("`", "_")
        .replaceAll(":", "_")
        .replaceAll("\\", "_")
        .split(" ");
    return chars.join("_");
};
exports.parseStringToCode = parseStringToCode;
