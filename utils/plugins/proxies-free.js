"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProxies = void 0;
const getProxies = async () => {
    const url = "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&country=us&protocol=http&proxy_format=ipport&format=text&timeout=20000";
    // "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&country=cl,ar&protocol=http&proxy_format=ipport&format=text&timeout=9211";
    // "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&country=cl&protocol=http&proxy_format=ipport&format=text&timeout=20000";
    try {
        const response = await fetch(url);
        const text = await response.text();
        // Divide las IPs en un array
        const proxyArray = text.split("\n").filter((ip) => ip.trim() !== "");
        return proxyArray.map((proxy) => proxy.trim());
    }
    catch (error) {
        console.log(error);
        console.log("Proxies default");
        return [
            "45.230.48.131:999",
            "190.195.225.34:80",
            "190.211.163.20:999",
            "181.13.53.38:8081",
            "45.65.227.97:999",
            "190.103.177.131:80",
            "181.23.238.200:8080",
            "164.163.42.13:10000",
            "191.97.68.42:8080",
            "191.102.248.9:8085",
        ];
    }
};
exports.getProxies = getProxies;
