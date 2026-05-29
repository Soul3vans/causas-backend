"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.codeUnique = codeUnique;
function codeUnique(date) {
    // Obtener la fecha actual
    const year = date.getFullYear().toString().slice(-2); // Últimos dos dígitos del año
    const month = (date.getMonth() + 1).toString().padStart(2, "0"); // Mes con dos dígitos
    const day = date.getDate().toString().padStart(2, "0"); // Día con dos dígitos
    // Generar un número aleatorio de 4 dígitos
    // const randomPart = Math.floor(1000 + Math.random() * 9000).toString();
    const code = `${year}${month}${day}`;
    return code;
}
