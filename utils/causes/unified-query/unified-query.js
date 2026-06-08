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
        console.log("✅ UnifiedQuery: Usando navegador ya inicializado");
        await (0, wait_1.wait)(1000);
        await this.goUnifiedQuery();
        await this.applyFilter(filters);
        await this.extractAnchors();
        await this.collectDetails();
    }

    async goUnifiedQuery(otherPage) {
        try {
            const currentUrl = await this.page.url();
            console.log(`📍 URL actual: ${currentUrl}`);
            
            // Si estamos en la página de inicio (home/index.php)
            if (currentUrl.includes('home/index.php')) {
                console.log('🔍 En página de inicio, haciendo clic en "Consulta causas"...');
                
                // Esperar a que el botón esté presente (hasta 10 segundos)
                await this.page.waitForSelector('button.dropbtn[onclick*="accesoConsultaCausas"]', { timeout: 4000 });
                
                // Hacer clic en el botón "Consulta causas"
                await this.page.evaluate(() => {
                    const btn = document.querySelector('button.dropbtn[onclick*="accesoConsultaCausas"]');
                    if (btn) {
                        btn.click();
                    } else {
                        // Fallback: buscar por el texto
                        const buttons = Array.from(document.querySelectorAll('button.dropbtn'));
                        const consultaBtn = buttons.find(b => b.textContent.includes('Consulta causas'));
                        if (consultaBtn) consultaBtn.click();
                    }
                });
                
                // Esperar a que la redirección ocurra y la nueva página cargue
                console.log('⏳ Esperando redirección a indexN.php...');
                await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 });
                
                // Esperar adicional 2 segundos para asegurar que la página cargue completamente
                await this.timeout(2000);
                
                console.log('✅ Redirección completada, ahora en página de consulta');
            }
            
            // Verificar que estamos en indexN.php
            const newUrl = await this.page.url();
            console.log(`📍 Nueva URL: ${newUrl}`);
            
            if (!newUrl.includes('indexN.php')) {
                throw new Error(`No se pudo navegar a indexN.php. URL actual: ${newUrl}`);
            }
            
            // Aumentar timeout y agregar reintentos
            let retries = 3;
            let selectorFound = false;
            while (retries > 0 && !selectorFound) {
            try {
                await this.page.waitForSelector('select#competencia', { timeout: 30000, visible: true });
                selectorFound = true;
                console.log('✅ Selector select#competencia encontrado');
            } catch (err) {
                retries--;
                console.log(`⚠️ Intento fallido, quedan ${retries} reintentos...`);
                if (retries === 0) throw err;
                await this.timeout(5000);
                // Recargar la página si es necesario
                await this.page.reload({ waitUntil: 'domcontentloaded' });
                await this.timeout(3000);
            }
            }
            
            console.log("✅ Navegación completada, listo para buscar");
            
        } catch (error) {
            console.error("Error en goUnifiedQuery:", error);
            throw error;
        }
    }

    // Helper para timeout
    timeout(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Aplica los filtros de búsqueda en el formulario de Búsqueda por RIT
     */
    async applyFilter(options) {
        const { court, tribune, rol, competencia = "3", corteId } = options;
        
        try {
          // Asegurar tokens de reCAPTCHA antes de llenar el formulario
          await this.scrape.ensureRecaptchaTokens();
          
          // Usar competencia y corteId correctos
          const competenciaValue = competencia || "3";
          const corteValue = corteId || court || "90";
          const tribuneValue = tribune;
          
          console.log(`🔍 Aplicando filtros - Competencia: ${competenciaValue}, Corte: ${corteValue}, Tribunal: ${tribuneValue}`);
          
          await this.page.waitForSelector("select#competencia", {
            timeout: 30000,
            visible: true,
          });
          
          await this.page.select("select#competencia", competenciaValue);
          await (0, wait_1.wait)(500);
          
          await this.page.click("select#conCorte", { delay: 1000 });
          await this.page.select("select#conCorte", corteValue.toString());
          await (0, wait_1.wait)(500);
          
          await this.page.click("select#conTribunal", { delay: 1000 });
          await this.page.select("select#conTribunal", tribuneValue.toString());
          await (0, wait_1.wait)(500);
          
          const [type, ...paramsRol] = rol.split("-");
          await this.page.select("select#conTipoCausa", type);
          await (0, wait_1.wait)(1000);
          
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
          
          console.log("✅ Filtro aplicado correctamente");
        } catch (error) {
          console.error("Error aplicando filtros:", error);
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
            console.log("No se encontraron resultados...!!!");
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
            console.error("Error extrayendo detalles de la causa:", error);
            throw error;
        }
    }

    async extractDocumentLinks() {
        try {
            await this.scrape.waitForSelector("#modalDetalleCivil", 6000, true);
            
            const documentLinks = await this.page.evaluate(() => {
                const links = [];
                const modal = document.querySelector("#modalDetalleCivil");
                if (!modal) return links;
                
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
                    const parentForm = anchor.closest('form');
                    const formHtml = parentForm ? parentForm.outerHTML : null;
                    
                    links.push({
                        id: idx,
                        html: anchor.outerHTML,
                        outerHtml: anchor.outerHTML,
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
            
            console.log(`Extraídos ${documentLinks.length} enlaces a documentos desde el modal (Sin descargar)`);
            return documentLinks;
        } catch (error) {
            console.error("Error extrayendo enlaces a documentoss:", error);
            return [];
        }
    }

    async collectDetails() {
        try {
            if (this.anchors.length === 0) {
                console.log("Proceso terminado: No hay causas para descargar");
                return process.exit();
            }
            
            for (const [index, anchor] of this.anchors.entries()) {
                console.log(`Procesando causa ${index + 1}/${this.anchors.length}...`);
                
                await this.scrape.execute(anchor.script);
                await this.scrape.waitForSelector("#modalDetalleCivil", 6000, true);
                
                const { book, ...causeDetails } = await this.extractCauseDetails();
                await (0, wait_1.wait)(1000);
                
                console.log("Book: ", book);
                console.log("Details: ");
                console.table(causeDetails);
                
                const movementsHistory = await this.extractMovementsHistory(causeDetails.rol);
                const movements = movementsHistory.map((item) => ({
                    ...item,
                    book,
                }));
                
                console.log(`Movimientos extraidos: ${movements.length}`);
                
                const litigants = await this.extractLitigants();
                console.log(`Litigantes extraidos: ${litigants.length}`);
                
                const documentLinks = await this.extractDocumentLinks();
                console.log(`Enlaces a documentos extraidos: ${documentLinks.length}`);
                
                this.civils.push({
                    ...causeDetails,
                    documentLinks,
                    extractedAt: new Date().toISOString(),
                    source: 'unified-query-scraper'
                });
                
                this.histories.push(...movements);
                this.litigants.push(...litigants);
                
                console.log(`Summary - Movements: ${movementsHistory.length}, Litigantes: ${litigants.length}, Enlaces: ${documentLinks.length}`);
                
                await this.closeModal();
                await (0, wait_1.wait)(2000);
            }
        } catch (error) {
            console.error("Error recopilando detalles:", error);
            throw error;
        }
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

    getccivil() {
        const civilcause = this.civils[0];
        if (!civilcause) return null;
        
        return {
            ...civilcause,
            litigants: this.litigants,
            documentLinks: civilcause.documentLinks || [],
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
            console.error("Error extrayendo litigantes:", error);
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
            console.error("Error extrayendo el historial de movimientos:", error);
            throw error;
        }
    }

    async closeModal() {
        return this.page.evaluate(() => {
            const close = document.querySelector("#modalDetalleCivil button.close");
            if (close) {
                close.click();
            } else {
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