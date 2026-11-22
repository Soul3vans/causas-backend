const { test } = require('node:test');
const assert = require('node:assert');
const { luxonDateTime } = require('../utils/dateTime');

test('luxonDateTime devuelve un string no vacío sin argumentos', () => {
  const resultado = luxonDateTime();
  assert.strictEqual(typeof resultado, 'string');
  assert.ok(resultado.length > 0);
});

test('luxonDateTime formatea una fecha específica sin lanzar error', () => {
  const fecha = new Date('2024-01-15T12:00:00Z');
  const resultado = luxonDateTime(fecha);
  assert.strictEqual(typeof resultado, 'string');
});
