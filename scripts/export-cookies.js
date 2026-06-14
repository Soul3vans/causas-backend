/**
 * Helper para exportar cookies desde Firefox
 * Ejecutar en la consola de Firefox (F12)
 */

console.log('=== COOKIES PARA SCRAPING ===');
console.log('');

const cookies = document.cookie.split(';').map(c => {
  const [name, value] = c.trim().split('=');
  return { name, value, domain: 'oficinajudicialvirtual.pjud.cl', path: '/' };
});

console.log(JSON.stringify(cookies, null, 2));

console.log('');
console.log('=== COPIA EL JSON DE ARRIBA Y GUÁRDALO COMO cookies-firefox.json ===');