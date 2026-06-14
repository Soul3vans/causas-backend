/**
 * TEST COMPARE DATES - Prueba el helper de comparación de fechas
 * 
 * Uso: node test-compare-dates.js
 */

const { compareDates, getLatestMovementDate, getNewMovements } = require('../utils/compareCaseData');

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║                    TEST COMPARE DATES HELPER                    ║');
console.log('╚════════════════════════════════════════════════════════════════╝');
console.log('');

// Prueba 1: Comparación básica
console.log('📋 Prueba 1: Comparación de fechas');
console.log(`   compareDates('17/12/2024', '07/05/2026') = ${compareDates('17/12/2024', '07/05/2026')} (esperado: -1, 17/12/2024 es menor)`);
console.log(`   compareDates('07/05/2026', '17/12/2024') = ${compareDates('07/05/2026', '17/12/2024')} (esperado: 1, 07/05/2026 es mayor)`);
console.log(`   compareDates('17/12/2024', '17/12/2024') = ${compareDates('17/12/2024', '17/12/2024')} (esperado: 0, iguales)`);
console.log('');

// Prueba 2: Obtener última fecha de movimientos
console.log('📋 Prueba 2: Obtener última fecha de movimientos');
const mockMovements = [
  { dateProcedure: '17/12/2024', procedure: 'Poder acreditado' },
  { dateProcedure: '07/05/2026', procedure: 'Resolución' },
  { dateProcedure: '30/04/2026', procedure: 'Escrito' }
];
const latestDate = getLatestMovementDate(mockMovements);
console.log(`   Movimientos: ${mockMovements.map(m => m.dateProcedure).join(', ')}`);
console.log(`   Última fecha: ${latestDate} (esperado: 07/05/2026)`);
console.log('');

// Prueba 3: Filtrar movimientos nuevos
console.log('📋 Prueba 3: Filtrar movimientos nuevos');
const existingMovements = [
  { dateProcedure: '17/12/2024', procedure: 'Poder acreditado' },
  { dateProcedure: '30/04/2026', procedure: 'Escrito' }
];
const newMovements = [
  { dateProcedure: '07/05/2026', procedure: 'Resolución' },
  { dateProcedure: '08/05/2026', procedure: 'Nuevo trámite' },
  { dateProcedure: '30/04/2026', procedure: 'Escrito (duplicado)' }
];
const onlyNew = getNewMovements(existingMovements, newMovements);
console.log(`   Existentes: ${existingMovements.map(m => m.dateProcedure).join(', ')}`);
console.log(`   Nuevos extraídos: ${newMovements.map(m => m.dateProcedure).join(', ')}`);
console.log(`   Solo nuevos (fecha > última existente): ${onlyNew.map(m => m.dateProcedure).join(', ')}`);
console.log(`   Esperado: 07/05/2026, 08/05/2026`);
console.log('');

// Prueba 4: Sin movimientos existentes
console.log('📋 Prueba 4: Sin movimientos existentes');
const noExisting = [];
const allNew = getNewMovements(noExisting, newMovements);
console.log(`   Existentes: vacío`);
console.log(`   Nuevos extraídos: ${newMovements.length}`);
console.log(`   Resultado: ${allNew.length} (deberían ser todos)`);
console.log('');

console.log('✅ Todas las pruebas completadas');