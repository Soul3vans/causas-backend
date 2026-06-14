"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProxies = void 0;

// Función para validar si un proxy funciona
const validateProxy = async (proxy) => {
    const proxyUrl = `http://${proxy}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 segundos timeout
    
    try {
        const response = await fetch('https://httpbin.org/ip', {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response.ok;
    } catch (error) {
        clearTimeout(timeoutId);
        return false;
    }
};

const getProxies = async () => {
    const url = "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&country=cl,ar&protocol=http&proxy_format=ipport&format=text&timeout=20000";
    
    // Lista de proxies de respaldo (verificados manualmente)
    const fallbackProxies = [
        "45.230.48.131:999",
        "190.195.225.34:80",
        "190.211.163.20:999",
        "181.13.53.38:8081",
        "45.65.227.97:999",
        "190.103.177.131:80",
        "181.23.238.200:8080",
        "164.163.42.13:10000",
        "191.97.68.42:8080",
        "191.102.248.9:8085"
    ];

    try {
        console.log('🌐 Obteniendo lista de proxies desde proxyscrape.com...');
        const response = await fetch(url);
        const text = await response.text();
        
        // Divide las IPs en un array
        let proxyArray = text.split("\n").filter((ip) => ip.trim() !== "");
        
        if (proxyArray.length === 0) {
            console.log('⚠️ No se obtuvieron proxies de la API, usando fallback');
            return fallbackProxies;
        }
        
        // Validar los primeros 10 proxies (para no sobrecargar)
        console.log(`🔍 Validando proxies (0/${Math.min(10, proxyArray.length)})...`);
        const validProxies = [];
        
        for (let i = 0; i < Math.min(10, proxyArray.length); i++) {
            const proxy = proxyArray[i].trim();
            const isValid = await validateProxy(proxy);
            if (isValid) {
                validProxies.push(proxy);
                console.log(`✅ Proxy válido: ${proxy}`);
            } else {
                console.log(`❌ Proxy inválido: ${proxy}`);
            }
        }
        
        if (validProxies.length === 0) {
            console.log('⚠️ No se encontraron proxies válidos, usando fallback');
            return fallbackProxies;
        }
        
        console.log(`📡 Se encontraron ${validProxies.length} proxies válidos`);
        return validProxies;
        
    } catch (error) {
        console.log('❌ Error obteniendo proxies:', error.message);
        console.log("⚠️ Usando proxies default");
        return fallbackProxies;
    }
};

exports.getProxies = getProxies;