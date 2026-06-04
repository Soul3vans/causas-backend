"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnifiedQuery = void 0;
const wait_1 = require("../../plugins/wait");
const code_calc_1 = require("../helpers/code-calc");
const history_scrape_1 = require("../helpers/history-scrape");
const parse_string_1 = require("../parse-string");
const document_all_helper_1 = require("../helpers/document-all.helper");
const date_calc_1 = require("../helpers/date-calc");

class UnifiedQuery {
    constructor(scrape, storage) {
        this.scrape = scrape;
        this.storage = storage;
        this.anchors = [];
        this.civils = [];
        this.histories = [];
        this.litigants = [];
        this.annex = [];
        this.rit = null;
        this.evaluateDocument = (doc) => {
            const { url, dateProcedure, descProcedure, index, procedure, rol } = doc;
            const filename = `${(0, parse_string_1.parseStringToCode)(procedure)}_${(0, parse_string_1.parseStringToCode)(descProcedure)}_${(0, code_calc_1.codeUnique)(dateProcedure)}_${index}`;
            return {
                url,
                cause: rol,
                filename,
            };
        };
    }

    async factory(filters) {
        this.rit = filters.rol;
        await this.init();
        await (0, wait_1.wait)(1000);
        await this.goUnifiedQuery();
        await this.applyFilter(filters);
        await this.extractAnchors();
        await this.collectDetails();
        await this.collectDocuments();
    }

    async init() {
        console.log("Init unified query...");
        return this.scrape.init();
    }

    async goUnifiedQuery(otherPage) {
        try {
            await this.scrape.clickElement('a[onclick="consultaUnificada();"]', 3500, otherPage);
            await this.scrape.simuleBodyAction(otherPage);
            console.log("Navigated to search by rit");
        } catch (error) {
            console.error("Error navigating to civil causes tab:", error);
            throw error;
        }
    }

    /**
     * Aplica los filtros de búsqueda en el formulario de Búsqueda por RIT
     * MODIFICADO: Ahora recibe competencia como parámetro y asegura tokens de reCAPTCHA
     */
    async applyFilter(options) {
        const { court, tribune, rol, competencia = "3" } = options; // competencia por defecto "3" (Civil)
        
        try {
            // ========== NUEVO: Asegurar tokens de reCAPTCHA antes de llenar el formulario ==========
            await this.scrape.ensureRecaptchaTokens();
            
            await this.page.waitForSelector("select#competencia", {
                timeout: 0,
                visible: true,
            });
            
            // Seleccionar Competencia (ahora dinámico según el parámetro)
            await this.page.select("select#competencia", competencia);
            await (0, wait_1.wait)(500);
            
            // Seleccionar Corte
            await this.page.click("select#conCorte", { delay: 1000 });
            await this.page.select("select#conCorte", court.toString());
            await (0, wait_1.wait)(500);
            
            // Seleccionar Tribunal
            await this.page.click("select#conTribunal", { delay: 1000 });
            await this.page.select("select#conTribunal", tribune.toString());
            await (0, wait_1.wait)(500);
            
            // Separar el rol completo (ej: "C-21503-2024") en tipo y parámetros
            const [type, ...paramsRol] = rol.split("-");
            await this.page.select("select#conTipoCausa", type);
            await (0, wait_1.wait)(1000);
            
            // Llenar Rol, Año y hacer clic en Buscar
            await this.page.evaluate(([role, year]) => {
                const rolInput = document.querySelector("input#conRolCausa");
                const yearInput = document.querySelector("input#conEraCausa");
                const searchBtn = document.querySelector("button#btnConConsulta");
                if (rolInput && yearInput) {
                    rolInput.value = role;
                    yearInput.value = year;
                    searchBtn?.click();
                }
            }, paramsRol);
            
            console.log("Filter applied...");
        } catch (error) {
            console.error("Error apply filters:", error);
            throw error;
        }
    }

    async extractAnchors() {
        await this.scrape.waitForSelector("tbody#verDetalle", 1500);
        
        const text = "No se han encontrado resultados";
        const empty = await this.page.evaluate((text) => {
            return document.body.innerText.includes(text);
        }, text);
        
        if (empty) {
            console.log("No results found...!!!");
            return process.exit();
        }
        
        const anchorsOnPage = await this.page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll("tbody#verDetalle>tr")) || [];
            return rows
                .map((row) => row
                    .querySelector('a[href="#modalDetalleCivil"]')
                    ?.getAttribute("onclick") || "")
                .filter((script) => script.length > 0);
        });
        
        const formattedAnchors = anchorsOnPage.map((script) => ({ script }));
        this.anchors.push(...formattedAnchors);
        console.log(`Collected ${formattedAnchors.length} anchors on current page.`);
    }

    async extractCauseDetails() {
        try {
            const causeDetails = await this.page.evaluate(() => {
                const getTextContent = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
                const cells = Array.from(document.querySelectorAll("div.modal-body>div.with-nav-tabs>div.panel-default>table:nth-child(1) td")).map((cell) => cell.textContent?.trim() || "");
                
                return {
                    rol: cells[0]?.replace("ROL:", "").trim() || "",
                    admission: cells[1]?.replace("F. Ing.:", "").trim() || "",
                    cover: cells[2]?.trim() || "",
                    estAdmin: cells[3]?.replace("Est. Adm.:", "").trim() || "",
                    process: cells[4]?.replace("Proc.:", "").trim() || "",
                    location: cells[5]?.replace("Ubicación:", "").trim() || "",
                    processState: cells[6]?.replace("Estado Proc.:", "").trim() || "",
                    stage: cells[7]?.replace("Etapa:", "").trim() || "",
                    court: cells[8]?.replace("Tribunal:", "").trim() || "",
                    book: getTextContent("select#selCuaderno>option[selected]"),
                };
            });
            
            return {
                ...causeDetails,
                admission: (0, date_calc_1.dateCalc)(causeDetails.admission),
            };
        } catch (error) {
            console.error("Error extracting cause details:", error);
            throw error;
        }
    }

    /**
     * ========== NUEVO MÉTODO: Extraer todos los enlaces a documentos del modal ==========
     * Extrae los enlaces como HTML puro para preservar los JWT y acciones JavaScript
     * @returns {Promise<Array>} - Lista de enlaces con su HTML y metadatos
     */
    async extractDocumentLinks() {
        try {
            // Esperar a que el modal esté completamente cargado
            await this.scrape.waitForSelector("#modalDetalleCivil", 20000, true);
            
            const documentLinks = await this.page.evaluate(() => {
                const links = [];
                const modal = document.querySelector("#modalDetalleCivil");
                if (!modal) return links;
                
                // Buscar todos los <a> dentro del modal que contengan acciones relevantes
                // Incluye: anexos, documentos, georeferencias, certificados, ebooks, etc.
                const anchors = modal.querySelectorAll(`
                    a[onclick*="anexo"], 
                    a[onclick*="detalle"], 
                    a[onclick*="geoReferencia"], 
                    a[onclick*="submit"],
                    a[onclick*="receptorCivil"],
                    form a[onclick*="submit"],
                    a[data-toggle="modal"]
                `);
                
                anchors.forEach((anchor, idx) => {
                    // Obtener el formulario padre si existe (para documentos que requieren form)
                    const parentForm = anchor.closest('form');
                    const formHtml = parentForm ? parentForm.outerHTML : null;
                    
                    links.push({
                        id: idx,
                        html: anchor.outerHTML,
                        outerHtml: anchor.outerHTML, // Alias para compatibilidad
                        onclick: anchor.getAttribute('onclick') || '',
                        href: anchor.getAttribute('href') || '',
                        title: anchor.getAttribute('title') || '',
                        text: anchor.textContent?.trim() || '',
                        parentFormHtml: formHtml,
                        type: anchor.querySelector('i')?.className?.includes('fa-file-pdf-o') ? 'pdf' :
                              anchor.querySelector('i')?.className?.includes('fa-folder-open') ? 'folder' :
                              anchor.querySelector('i')?.className?.includes('fa-globe') ? 'georef' : 'link'
                    });
                });
                
                return links;
            });
            
            console.log(`Extraídos ${documentLinks.length} enlaces a documentos desde el modal`);
            return documentLinks;
        } catch (error) {
            console.error("Error extracting document links:", error);
            return [];
        }
    }

    async collectDetails() {
        try {
            if (this.anchors.length === 0) {
                console.log("Process finish: There are no civil cases to download");
                return process.exit();
            }
            
            for (const [index, anchor] of this.anchors.entries()) {
                console.log(`Processing cause ${index + 1}/${this.anchors.length}...`);
                
                // Ejecutar el script que abre el modal
                await this.scrape.execute(anchor.script);
                
                // ========== NUEVO: Esperar a que el modal cargue completamente ==========
                await this.scrape.waitForSelector("#modalDetalleCivil", 20000, true);
                
                // Extraer datos principales de la causa
                const { book, ...causeDetails } = await this.extractCauseDetails();
                await (0, wait_1.wait)(1000);
                
                console.log("Book: ", book);
                console.log("Details: ");
                console.table(causeDetails);
                
                // Extraer historial de movimientos (trámites)
                const movementsHistory = await this.extractMovementsHistory(causeDetails.rol);
                const movements = movementsHistory.map((item) => ({
                    ...item,
                    book,
                }));
                
                console.log(`Movements extracted: ${movements.length}`);
                
                // Extraer litigantes
                const litigants = await this.extractLitigants();
                console.log(`Litigants extracted: ${litigants.length}`);
                
                // ========== NUEVO: Extraer enlaces a documentos ==========
                const documentLinks = await this.extractDocumentLinks();
                console.log(`Document links extracted: ${documentLinks.length}`);
                
                // Almacenar todos los datos extraídos
                this.civils.push({
                    ...causeDetails,
                    documentLinks,        // Añadir los enlaces a documentos
                    extractedAt: new Date().toISOString(),
                    source: 'unified-query-scraper'
                });
                
                this.histories.push(...movements);
                this.litigants.push(...litigants);
                
                console.log(`Summary - Movements: ${movementsHistory.length}, Litigants: ${litigants.length}, Links: ${documentLinks.length}`);
                
                // Cerrar el modal para continuar con la siguiente causa
                await this.closeModal();
                await (0, wait_1.wait)(2000);
            }
        } catch (error) {
            console.error("Error collecting details:", error);
            throw error;
        }
    }

    async collectDocuments() {
        const docAll = new document_all_helper_1.DocumentAllHelper(
            this.URLs.map((item) => this.evaluateDocument(item)), 
            "daily"
        );
        await docAll.documentationEvaluate();
    }

    get URLs() {
        const documents = [];
        this.histories.forEach((movement) => {
            movement.document.forEach((url, index) => {
                documents.push({
                    index,
                    url,
                    dateProcedure: movement.dateProcedure,
                    descProcedure: movement.descProcedure,
                    procedure: movement.procedure,
                    rol: this.civils[0]?.rol || this.rit,
                });
            });
        });
        return documents;
    }

    /**
     * Obtiene el objeto completo de la causa civil con todos los datos extraídos
     * MODIFICADO: Ahora incluye documentLinks en el resultado
     */
    getccivil() {
        const civilcause = this.civils[0];
        if (!civilcause) return null;
        
        return {
            ...civilcause,
            litigants: this.litigants,
            documentLinks: civilcause.documentLinks || [], // Incluir enlaces a documentos
            movementsHistory: this.histories.map(({ guid, document, ...history }) => ({
                ...history,
                document: document.map((_doc, index) => {
                    return {
                        file: `${(0, parse_string_1.parseStringToCode)(history.procedure)}_${(0, parse_string_1.parseStringToCode)(history.descProcedure)}_${(0, code_calc_1.codeUnique)(history.dateProcedure)}_${index}.pdf`,
                        name: `${history.procedure} ${history.descProcedure}`,
                        annexs: this.annex.filter((item) => item.guid === guid),
                    };
                }),
            })),
        };
    }

    async extractLitigants() {
        try {
            // Hacer clic en la pestaña de Litigantes
            await this.page.click('a[href="#litigantesCiv"]');
            await (0, wait_1.wait)(1500);
            
            const litigants = await this.page.evaluate(() => {
                const rows = Array.from(document.querySelectorAll("div#litigantesCiv table > tbody > tr") || []);
                return rows.map((row) => {
                    const cells = Array.from(row.querySelectorAll("td"));
                    return {
                        participant: cells[0]?.textContent?.trim() || "",
                        rut: cells[1]?.textContent?.trim() || "",
                        person: cells[2]?.textContent?.trim() || "",
                        name: cells[3]?.textContent?.trim() || "",
                    };
                });
            });
            
            return litigants;
        } catch (error) {
            console.error("Error extracting litigants:", error);
            throw error;
        }
    }

    async extractMovementsHistory(cause) {
        try {
            await this.scrape.waitForSelector("div#loadHistCuadernoCiv", 5000);
            const historyScrape = new history_scrape_1.HistoryScrape(this.page, cause, "one");
            const annexDocs = await historyScrape.start();
            this.annex.push(...annexDocs);
            return historyScrape.getmovementsHistories();
        } catch (error) {
            console.error("Error extracting movements history:", error);
            throw error;
        }
    }

    async closeModal() {
        return this.page.evaluate(() => {
            const close = document.querySelector("#modalDetalleCivil button.close");
            if (close) {
                close.click();
            } else {
                // Fallback: buscar cualquier botón de cierre
                const anyClose = document.querySelector('#modalDetalleCivil .modal-footer button, #modalDetalleCivil [data-dismiss="modal"]');
                anyClose?.click();
            }
        });
    }

    get page() {
        return this.scrape.getPage();
    }
}

exports.UnifiedQuery = UnifiedQuery;