"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cause = void 0;
const plugins_1 = require("../plugins");
const cause_1 = require("./cause");
const civil_cause_rol_collect_1 = require("./civil-cause-rol.collect");
const civil_cause_active_1 = require("./civil-cause.active");

// ✅ Lazy initialization: no crear ScrapService al importar el módulo,
// sino solo cuando se necesite por primera vez.
let _cause = null;

function getCause() {
  if (!_cause) {
    const scrape = new plugins_1.ScrapService();
    const fileService = new plugins_1.FileSystemService();
    const civilCauseActiveScrape = new civil_cause_active_1.CivilCauseActiveScrape(scrape);
    const civilCauseRolCollectScrape = new civil_cause_rol_collect_1.CivilCauseRolCollectScrape(scrape, fileService);
    _cause = new cause_1.Cause(civilCauseActiveScrape, civilCauseRolCollectScrape);
  }
  return _cause;
}

// Mantener compatibilidad con código que usa `cause` directamente
// usando un Proxy que inicializa lazy al primer acceso
exports.cause = new Proxy({}, {
  get(_, prop) {
    return getCause()[prop];
  }
});