"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CivilCauseDetail = void 0;
class CivilCauseDetail {
    constructor({ rol, cover, estAdmin, process, admission, location, stage, processState, court, book, status, visibility, movementsHistory, litigants, }) {
        this.rol = rol;
        this.cover = cover;
        this.estAdmin = estAdmin;
        this.process = process;
        this.admission = admission;
        this.location = location;
        this.stage = stage;
        this.processState = processState;
        this.court = court;
        this.book = book;
        this.status = status;
        this.visibility = visibility;
        this.movementsHistory = movementsHistory;
        this.litigants = litigants;
    }
    static create(input) {
        return new CivilCauseDetail(input);
    }
}
exports.CivilCauseDetail = CivilCauseDetail;
