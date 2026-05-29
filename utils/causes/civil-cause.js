"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CivilCause = void 0;
class CivilCause {
    constructor({ rol, court, cover, admissionAt, processBook, book, }) {
        this.rol = rol;
        this.court = court;
        this.cover = cover;
        this.admissionAt = admissionAt;
        this.processBook = processBook;
        this.book = book;
    }
    static create(input) {
        return new CivilCause(input);
    }
}
exports.CivilCause = CivilCause;
