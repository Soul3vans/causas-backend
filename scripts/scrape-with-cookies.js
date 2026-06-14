/**
 * SCRAPING CON COOKIES EN FORMATO NETSCAPE
 * 
 * Usa el archivo de cookies exportado desde Firefox (formato Netscape)
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { MongoDatabase } = require('../utils/db');
const { envs } = require('../utils/plugins');

// Configuración
const TEST_CONFIG = {
    court: '90',
    tribune: '273',
    rol: 'C-21503-2024',
    competencia: '3'
};

// URL del sitio
const BASE_URL = 'https://oficinajudicialvirtual.pjud.cl';

/**
 * Parsea archivo de cookies en formato Netscape
 * Formato: domain flag path secure expiration name value
 */
function parseNetscapeCookies(fileContent) {
  const cookies = [];
  const lines = fileContent.split('\n');
  
  for (const line of lines) {
    // Saltar comentarios y líneas vacías
    if (line.startsWith('#') || line.trim() === '') continue;
    
    const parts = line.split('\t');
    if (parts.length >= 7) {
      cookies.push({
        domain: parts[0],
        httpOnly: parts[1] === 'TRUE',
        path: parts[2],
        secure: parts[3] === 'TRUE',
        expires: parseInt(parts[4]),
        name: parts[5],
        value: parts[6]
      });
    }
  }
  
  return cookies;
}

/**
 * Cargar cookies desde archivo (formato Netscape o JSON)
 */
function loadCookies() {
  // Probar diferentes formatos
  const netscapePath = path.join(process.cwd(), 'cookies-firefox.txt');
  const jsonPath = path.join(process.cwd(), 'cookies-firefox.json');
  
  let cookies = [];
  let cookieString = '';
  
  // Intentar cargar formato Netscape (.txt)
  if (fs.existsSync(netscapePath)) {
    console.log('📄 Cargando cookies en formato Netscape...');
    const content = fs.readFileSync(netscapePath, 'utf8');
    cookies = parseNetscapeCookies(content);
    console.log(`🍪 Cargadas ${cookies.length} cookies (formato Netscape)`);
  }
  // Intentar cargar formato JSON
  else if (fs.existsSync(jsonPath)) {
    console.log('📄 Cargando cookies en formato JSON...');
    const content = fs.readFileSync(jsonPath, 'utf8');
    cookies = JSON.parse(content);
    console.log(`🍪 Cargadas ${cookies.length} cookies (formato JSON)`);
  }
  else {
    console.error('❌ No se encuentra archivo de cookies');
    console.error('   Opciones:');
    console.error('   1. cookies-firefox.txt (formato Netscape)');
    console.error('   2. cookies-firefox.json (formato JSON)');
    console.error('');
    console.error('   Para exportar cookies desde Firefox:');
    console.error('   - Usa la extensión "Cookie-Editor"');
    console.error('   - Exporta como "JSON" o "Netscape"');
    process.exit(1);
  }
  
  // Convertir a string para header de cookie
  for (const cookie of cookies) {
    cookieString += `${cookie.name}=${cookie.value}; `;
  }
  
  return cookieString;
}

// Cliente axios con cookies
function createAxiosClient(cookieString) {
  const client = axios.create({
    baseURL: BASE_URL,
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
      'Cookie': cookieString
    },
    timeout: 30000,
    maxRedirects: 5
  });
  
  return client;
}

async function scrapeCase(axiosClient, filters) {
  console.log('🔍 Buscando causa:', filters.rol);
  
  // Paso 1: Obtener página de búsqueda
  console.log('📍 Cargando página de búsqueda...');
  const searchPage = await axiosClient.get('/indexN.php');
  console.log('✅ Página cargada');
  
  // Extraer tokens y campos ocultos
  const tokens = extractTokens(searchPage.data);
  console.log('📝 Tokens extraídos:', Object.keys(tokens).length);
  
  // Paso 2: Construir datos del formulario
  const formData = new URLSearchParams();
  formData.append('competencia', filters.competencia);
  formData.append('conCorte', filters.court);
  formData.append('conTribunal', filters.tribune);
  formData.append('conTipoCausa', filters.rol.split('-')[0]);
  formData.append('conRolCausa', filters.rol.split('-')[1]);
  formData.append('conEraCausa', filters.rol.split('-')[2]);
  formData.append('btnConConsulta', 'Buscar');
  
  // Añadir tokens extraídos
  for (const [key, value] of Object.entries(tokens)) {
    formData.append(key, value);
  }
  
  // Paso 3: Enviar búsqueda
  console.log('📤 Enviando formulario de búsqueda...');
  const searchResult = await axiosClient.post('/indexN.php', formData.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  
  console.log('✅ Búsqueda completada');
  
  // Verificar si hubo error
  if (searchResult.data.includes('reCAPTCHA') || searchResult.data.includes('captcha')) {
    console.warn('⚠️ El sitio está pidiendo reCAPTCHA. Las cookies pueden haber expirado.');
    console.warn('   Actualiza las cookies exportando nuevamente desde Firefox.');
  }
  
  // Extraer datos
  const results = extractResults(searchResult.data);
  
  return results;
}

function extractTokens(html) {
  const tokens = {};
  
  // Buscar inputs ocultos
  const inputRegex = /<input[^>]*type=["']hidden["'][^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["']/gi;
  let match;
  
  while ((match = inputRegex.exec(html)) !== null) {
    tokens[match[1]] = match[2];
  }
  
  // Buscar inputs de tipo text/select con valores importantes
  const selectRegex = /<select[^>]*name=["']([^"']+)["'][^>]*>[\s\S]*?<option[^>]*selected[^>]*value=["']([^"']*)["']/gi;
  while ((match = selectRegex.exec(html)) !== null) {
    tokens[match[1]] = match[2];
  }
  
  return tokens;
}

function extractResults(html) {
  const results = {
    rol: null,
    court: null,
    litigants: [],
    movements: []
  };
  
  // Extraer rol de la causa
  const rolMatch = html.match(/ROL[:\s]*([A-Z0-9\-]+)/i);
  if (rolMatch) results.rol = rolMatch[1];
  
  // Extraer tribunal
  const courtMatch = html.match(/Tribunal[:\s]*([^<]+)/i);
  if (courtMatch) results.court = courtMatch[1].trim();
  
  // Buscar tabla de resultados (ajustar según la estructura real)
  const tableMatch = html.match(/<table[^>]*class="[^"]*tabla-resultados[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
  if (tableMatch) {
    console.log('📊 Tabla de resultados encontrada');
  }
  
  return results;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           SCRAPING CON COOKIES EXPORTADAS (SIN PUPPETEER)       ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  // Conectar a MongoDB
  console.log('🔌 Conectando a MongoDB...');
  await MongoDatabase.connect({
    url: envs.MONGO_URI,
    dbName: envs.MONGO_DB_NAME
  });
  console.log('✅ Conexión establecida');
  
  // Cargar cookies (soporta ambos formatos)
  const cookieString = loadCookies();
  const axiosClient = createAxiosClient(cookieString);
  
  try {
    const result = await scrapeCase(axiosClient, TEST_CONFIG);
    
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                         RESULTADOS                             ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('📊 Datos extraídos:');
    console.log(`   - Rol: ${result.rol || 'N/A'}`);
    console.log(`   - Tribunal: ${result.court || 'N/A'}`);
    console.log(`   - Litigantes: ${result.litigants.length}`);
    console.log(`   - Movimientos: ${result.movements.length}`);
    
    // Guardar resultado
    const outputPath = path.join(process.cwd(), 'test-result-cookies.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`📁 Resultado guardado en: ${outputPath}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   URL: ${error.response.config?.url}`);
      
      // Mostrar parte de la respuesta para depuración
      if (error.response.data && error.response.data.length < 500) {
        console.error(`   Respuesta: ${error.response.data}`);
      }
    }
  }
}

main();