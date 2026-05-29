"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Cause = void 0;
class Cause {
    constructor(civilActiveScrap, civilDetailScrap) {
        this.civilActiveScrap = civilActiveScrap;
        this.civilDetailScrap = civilDetailScrap;
    }
    async getCivilCauses() {
        await this.civilActiveScrap.init();
        await this.civilActiveScrap.navigateToCivilCausesTab();
        await this.civilActiveScrap.applyActiveFilter();
        await this.civilActiveScrap.collectCauses();
        await this.civilActiveScrap.finish();
        return this.civilActiveScrap.getCauses();
    }
    async getCivilCauseDetail(rol) {
        await this.civilDetailScrap.init();
        await this.civilDetailScrap.navigateToCivilCausesTab();
        await this.civilDetailScrap.applyRolFilter(rol);
        await this.civilDetailScrap.collectCauses();
        await this.civilDetailScrap.collectDetails();
        await this.civilDetailScrap.collectDocuments();
        await this.civilDetailScrap.finish();
        return this.civilDetailScrap.getCauseCivil();
    }
    get hasReplaceCivilDetail() {
        return this.civilDetailScrap.hasUpdate;
    }
    getCivilDetailReplacement() {
        return this.civilDetailScrap.getCauseCivil();
    }
}
exports.Cause = Cause;
