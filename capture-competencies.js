/**
 * CAPTURA DE COMPETENCIAS - Script de descubrimiento
 * 
 * Uso: node capture-competencies.js
 * 
 * Salida: competencias.json en la raíz del proyecto
 */

const fs = require('fs');
const path = require('path');

const { ScrapService } = require('./utils/plugins/puppeteer.plugin');
const { wait } = require('./utils/plugins/wait');

const COMPETENCIAS = [
    { id: '1', nombre: 'Corte Suprema' },
    { id: '2', nombre: 'Corte Apelaciones' },
    { id: '3', nombre: 'Civil' },
    { id: '4', nombre: 'Laboral' },
    { id: '5', nombre: 'Penal' },
    { id: '6', nombre: 'Cobranza' },
    { id: '7', nombre: 'Familia' }
];

const SELECTORES_A_CAPTURAR = [
    { selector: 'select#conCorte', nombre: 'corte', dependeDe: null },
    { selector: 'select#conTribunal', nombre: 'tribunal', dependeDe: 'corte' },
    { selector: 'select#conTipoBus', nombre: 'tipoBusqueda', dependeDe: null, soloPara: ['1'] },
    { selector: 'select#conTipoBusApe', nombre: 'tipoBusquedaApelaciones', dependeDe: null, soloPara: ['2'] },
    { selector: 'select#conTipoCausa', nombre: 'libroTipo', dependeDe: null },
    { selector: '#rolConTipoCausa', nombre: 'rolAnio', esSeccion: true },
    { selector: '#rucConTipoCausa', nombre: 'ruc', esSeccion: true },
    { selector: '#busRitPenalTipo', nombre: 'tipoBusquedaPenal', esSeccion: true, soloPara: ['5'] },
    { selector: 'input#conRolCausa', nombre: 'rol', esInput: true },
    { selector: 'input#conEraCausa', nombre: 'anio', esInput: true },
    { selector: 'input#conCaratulado', nombre: 'caratulado', esInput: true, soloPara: ['1'] }
];

async function extractSelectOptions(page, selector, selectNombre) {
    try {
        const selectElement = await page.$(selector);
        if (!selectElement) {
            console.log(`   ⚠️ Select no encontrado: ${selector}`);
            return null;
        }
        
        const options = await page.evaluate((sel) => {
            const select = document.querySelector(sel);
            if (!select) return [];
            return Array.from(select.options).map(opt => ({
                value: opt.value,
                text: opt.textContent?.trim() || '',
                selected: opt.selected || false
            }));
        }, selector);
        
        const hasOnlyDefault = options.length === 1 && options[0].value === '0';
        
        return {
            selector: selector,
            nombre: selectNombre,
            tipo: 'select',
            tieneOpcionesDinamicas: hasOnlyDefault,
            opciones: options,
            totalOpciones: options.length
        };
    } catch (error) {
        console.log(`   ❌ Error extrayendo ${selector}:`, error.message);
        return null;
    }
}

async function extractSectionInfo(page, selector, nombre) {
    try {
        const isVisible = await page.evaluate((sel) => {
            const element = document.querySelector(sel);
            if (!element) return false;
            const style = window.getComputedStyle(element);
            return style.display !== 'none';
        }, selector);
        
        return {
            selector: selector,
            nombre: nombre,
            tipo: 'seccion',
            visible: isVisible
        };
    } catch (error) {
        return { selector, nombre, tipo: 'seccion', visible: false, error: error.message };
    }
}

async function extractInputInfo(page, selector, nombre) {
    try {
        const isVisible = await page.evaluate((sel) => {
            const element = document.querySelector(sel);
            if (!element) return false;
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && element.offsetParent !== null;
        }, selector);
        
        const isDisabled = await page.evaluate((sel) => {
            const element = document.querySelector(sel);
            return element ? element.disabled : true;
        }, selector);
        
        return {
            selector: selector,
            nombre: nombre,
            tipo: 'input',
            visible: isVisible,
            disabled: isDisabled
        };
    } catch (error) {
        return { selector, nombre, tipo: 'input', visible: false, error: error.message };
    }
}

async function waitForDynamicSelects(page, competenciaId) {
    console.log(`   ⏳ Esperando carga de selects dinámicos...`);
    
    const waitTime = competenciaId === '1' ? 3000 : 2000;
    await wait(waitTime);
    
    const corteHasOptions = await page.evaluate(() => {
        const select = document.querySelector('select#conCorte');
        if (!select) return false;
        return select.options.length > 1;
    });
    
    if (!corteHasOptions) {
        console.log(`   ⚠️ Los selects aún no se llenaron, esperando más...`);
        await wait(3000);
    }
}

async function captureCompetencia(scrape, competencia) {
    const page = scrape.getPage();
    console.log(`\n📋 Capturando: ${competencia.nombre} (ID: ${competencia.id})`);
    
    await page.select('select#competencia', competencia.id);
    console.log(`   ✅ Seleccionada competencia: ${competencia.nombre}`);
    
    await waitForDynamicSelects(page, competencia.id);
    
    await scrape.ensureRecaptchaTokens();
    await wait(1000);
    
    const resultado = {
        id: competencia.id,
        nombre: competencia.nombre,
        campos: {}
    };
    
    for (const item of SELECTORES_A_CAPTURAR) {
        if (item.soloPara && !item.soloPara.includes(competencia.id)) {
            continue;
        }
        
        if (item.esInput) {
            resultado.campos[item.nombre] = await extractInputInfo(page, item.selector, item.nombre);
        } else if (item.esSeccion) {
            resultado.campos[item.nombre] = await extractSectionInfo(page, item.selector, item.nombre);
        } else {
            resultado.campos[item.nombre] = await extractSelectOptions(page, item.selector, item.nombre);
        }
    }
    
    if (competencia.id === '5') {
        const radios = await page.evaluate(() => {
            const radioRit = document.querySelector('#radioRitPenal');
            const radioRuc = document.querySelector('#radioRucPenal');
            return {
                tipoBusqueda: {
                    tipo: 'radio',
                    opciones: [
                        { id: 'radioRitPenal', value: '1', texto: 'Rol o Rit', checked: radioRit?.checked || false },
                        { id: 'radioRucPenal', value: '2', texto: 'Ruc', checked: radioRuc?.checked || false }
                    ]
                }
            };
        });
        resultado.campos.radioTipoBusqueda = radios.tipoBusqueda;
        
        const libroTipoPenal = await extractSelectOptions(page, 'select#conTipoCausa', 'libroTipoPenal');
        if (libroTipoPenal) {
            resultado.campos.libroTipo = libroTipoPenal;
        }
    }
    
    if (competencia.id === '1') {
        const radiosSuprema = await page.evaluate(() => {
            const radioRit = document.querySelector('#radioRit');
            const radioRuc = document.querySelector('#radioRuc');
            return {
                tipoBusquedaRadios: {
                    tipo: 'radio',
                    opciones: [
                        { id: 'radioRit', value: '1', texto: 'Rol o Rit', checked: radioRit?.checked || false },
                        { id: 'radioRuc', value: '2', texto: 'Ruc', checked: radioRuc?.checked || false }
                    ]
                }
            };
        });
        resultado.campos.radioTipoBusqueda = radiosSuprema.tipoBusquedaRadios;
    }
    
    return resultado;
}

async function captureAllCompetencies() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║              CAPTURADOR DE COMPETENCIAS - OJV                   ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('🎯 Objetivo: Capturar selects y opciones de cada competencia');
    console.log('📁 Salida: competencias.json');
    console.log('');
    
    const scrape = new ScrapService();
    const resultados = {
        fechaCaptura: new Date().toISOString(),
        url: 'https://oficinajudicialvirtual.pjud.cl/indexN.php',
        competencias: []
    };
    
    try {
        console.log('📍 Inicializando navegador en modo invitado...');
        
        // ========== FLUJO CORRECTO DE INVITADO ==========
        // 1. Ir a home/index.php
        console.log('📍 Navegando a home/index.php...');
        await scrape.init('https://oficinajudicialvirtual.pjud.cl/home/index.php', true);
        
        const page = scrape.getPage();
        await wait(2000);
        
        // 2. Establecer sesión de invitado
        console.log('📍 Estableciendo sesión de invitado...');
        await page.evaluate(() => {
            localStorage.setItem('InitSitioOld', '0');
            localStorage.setItem('InitSitioNew', '1');
            localStorage.setItem('logged-in', 'true');
            sessionStorage.setItem('logged-in', 'true');
        });
        
        // 3. Hacer clic en "Consulta causas"
        console.log('📍 Haciendo clic en "Consulta causas"...');
        
        // Esperar a que el botón esté presente
        await page.waitForSelector('button.dropbtn[onclick*="accesoConsultaCausas"]', { timeout: 10000 });
        
        // Hacer clic
        await page.evaluate(() => {
            const btn = document.querySelector('button.dropbtn[onclick*="accesoConsultaCausas"]');
            if (btn) {
                btn.click();
            }
        });
        
        // 4. Esperar redirección a indexN.php
        console.log('📍 Esperando redirección a indexN.php...');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await wait(2000);
        
        // 5. Verificar que estamos en indexN.php
        const currentUrl = await page.url();
        console.log(`📍 URL actual: ${currentUrl}`);
        
        if (!currentUrl.includes('indexN.php')) {
            throw new Error(`No se pudo navegar a indexN.php. URL actual: ${currentUrl}`);
        }
        
        // 6. Esperar a que el formulario cargue
        await page.waitForSelector('select#competencia', { timeout: 10000, visible: true });
        console.log('✅ Página indexN.php cargada correctamente');
        
        // Capturar cada competencia
        for (const competencia of COMPETENCIAS) {
            if (competencia.id === '7') {
                console.log(`\n⏭️ Saltando: ${competencia.nombre} (ID: ${competencia.id}) - Causas reservadas`);
                resultados.competencias.push({
                    id: competencia.id,
                    nombre: competencia.nombre,
                    reservada: true,
                    mensaje: "Las causas de familia son reservadas"
                });
                continue;
            }
            
            const captura = await captureCompetencia(scrape, competencia);
            resultados.competencias.push(captura);
            await wait(1000);
        }
        
        // Guardar resultados
        const outputPath = path.join(process.cwd(), 'competencias.json');
        fs.writeFileSync(outputPath, JSON.stringify(resultados, null, 2));
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 RESULTADOS:');
        console.log('='.repeat(60));
        
        for (const comp of resultados.competencias) {
            if (comp.reservada) {
                console.log(`\n📌 ${comp.nombre} (ID: ${comp.id}) - RESERVADA`);
            } else {
                console.log(`\n📌 ${comp.nombre} (ID: ${comp.id})`);
                for (const [key, value] of Object.entries(comp.campos)) {
                    if (value && value.tipo === 'select' && value.opciones) {
                        console.log(`   📋 ${key}: ${value.totalOpciones} opciones`);
                        if (value.opciones.length <= 10) {
                            console.log(`      ${value.opciones.map(o => `${o.text}(${o.value})`).join(', ')}`);
                        } else {
                            console.log(`      (primeras 5): ${value.opciones.slice(0, 5).map(o => `${o.text}(${o.value})`).join(', ')}...`);
                        }
                    } else if (value && value.tipo === 'seccion') {
                        console.log(`   📁 ${key}: ${value.visible ? 'visible' : 'oculto'}`);
                    } else if (value && value.tipo === 'input') {
                        console.log(`   📝 ${key}: ${value.visible ? 'visible' : 'oculto'} ${value.disabled ? '(deshabilitado)' : ''}`);
                    }
                }
            }
        }
        
        console.log('\n' + '='.repeat(60));
        console.log(`✅ Captura completada. Archivo guardado en: ${outputPath}`);
        console.log('='.repeat(60));
        
        await scrape.close();
        
    } catch (error) {
        console.error('\n❌ Error durante la captura:', error.message);
        console.error(error.stack);
        
        const errorOutput = {
            fechaCaptura: new Date().toISOString(),
            error: error.message,
            stack: error.stack
        };
        const errorPath = path.join(process.cwd(), 'competencias-error.json');
        fs.writeFileSync(errorPath, JSON.stringify(errorOutput, null, 2));
        console.log(`\n⚠️ Error guardado en: ${errorPath}`);
        
        try {
            await scrape.close();
        } catch (e) {}
    }
}

console.log('');
console.log('🕒 El proceso puede tomar varios minutos...');
console.log('   Capturando competencia por competencia');
console.log('');

captureAllCompetencies();