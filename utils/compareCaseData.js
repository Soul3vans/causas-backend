const logger = require('./logger');

/**
 * Convierte fecha DD/MM/YYYY a objeto Date para comparación
 * @param {string} dateStr - Fecha en formato DD/MM/YYYY
 * @returns {Date|null}
 */
function parseDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);
  
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  
  return new Date(year, month, day);
}

/**
 * Compara dos fechas en formato DD/MM/YYYY
 * @param {string} dateStr1 - Primera fecha
 * @param {string} dateStr2 - Segunda fecha
 * @returns {number} - -1 si date1 < date2, 0 si igual, 1 si date1 > date2
 */
function compareDates(dateStr1, dateStr2) {
  const date1 = parseDate(dateStr1);
  const date2 = parseDate(dateStr2);
  
  if (!date1 && !date2) return 0;
  if (!date1) return -1;
  if (!date2) return 1;
  
  if (date1 < date2) return -1;
  if (date1 > date2) return 1;
  return 0;
}

/**
 * Convierte fecha de movimiento a timestamp para comparación
 * @param {Object} movement - Movimiento con dateProcedure (puede ser Date o string)
 * @returns {number} - Timestamp en milisegundos
 */
function getMovementTimestamp(movement) {
  if (!movement || !movement.dateProcedure) return 0;
  
  let date = movement.dateProcedure;
  
  // Si es string en formato DD/MM/YYYY, convertirlo
  if (typeof date === 'string' && date.includes('/')) {
    const parsed = parseDate(date);
    return parsed ? parsed.getTime() : 0;
  }
  
  // Si ya es objeto Date
  if (date instanceof Date) {
    return date.getTime();
  }
  
  // Intentar convertir
  const timestamp = new Date(date).getTime();
  return isNaN(timestamp) ? 0 : timestamp;
}

/**
 * Obtiene la fecha del movimiento más reciente
 * @param {Array} movements - Array de movimientos
 * @returns {number|null} - Timestamp o null
 */
function getLatestMovementTimestamp(movements) {
  if (!movements || movements.length === 0) return null;
  
  let latestTimestamp = 0;
  for (const movement of movements) {
    const timestamp = getMovementTimestamp(movement);
    if (timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
    }
  }
  return latestTimestamp > 0 ? latestTimestamp : null;
}

/**
 * Ordena movimientos de más reciente a más antiguo
 * @param {Array} movements - Array de movimientos
 * @returns {Array} - Array ordenado (más reciente primero)
 */
function sortMovementsByDate(movements) {
  if (!movements || movements.length === 0) return [];
  
  return [...movements].sort((a, b) => {
    const timestampA = getMovementTimestamp(a);
    const timestampB = getMovementTimestamp(b);
    return timestampB - timestampA; // Descendente: más reciente primero
  });
}

/**
 * Filtra los movimientos nuevos (con fecha posterior a la última fecha conocida)
 * Maneja correctamente el caso cuando no hay fecha previa (null o 0)
 * @param {Array} existingMovements - Movimientos existentes en BD
 * @param {Array} newMovements - Movimientos recién extraídos
 * @returns {Array} - Movimientos nuevos que no estaban en BD (ordenados más reciente primero)
 */
function getNewMovements(existingMovements, newMovements) {
  // Si no hay movimientos nuevos, retornar array vacío
  if (!newMovements || newMovements.length === 0) return [];
  
  // Si no hay movimientos existentes en BD, todos son nuevos
  if (!existingMovements || existingMovements.length === 0) {
    logger.debug(`No hay movimientos existentes, todos los ${newMovements.length} son nuevos`);
    return sortMovementsByDate(newMovements);
  }
  
  // Obtener timestamp del movimiento más reciente en BD
  const latestTimestamp = getLatestMovementTimestamp(existingMovements);
  
  // Si no hay timestamp válido en BD (todos los movimientos tienen fecha inválida)
  if (latestTimestamp === null || latestTimestamp === 0) {
    logger.debug(`No hay fecha válida en BD, todos los ${newMovements.length} movimientos se consideran nuevos`);
    return sortMovementsByDate(newMovements);
  }
  
  // Filtrar movimientos con fecha posterior a la última fecha conocida
  const newMovementsList = [];
  for (const movement of newMovements) {
    const movementTimestamp = getMovementTimestamp(movement);
    
    // Si el movimiento tiene fecha inválida (0), lo incluimos como precaución
    if (movementTimestamp === 0) {
      logger.debug(`Movimiento con fecha inválida, incluyendo como nuevo: ${movement.descProcedure?.substring(0, 50)}`);
      newMovementsList.push(movement);
    } 
    // Si la fecha del movimiento es posterior a la última fecha en BD
    else if (movementTimestamp > latestTimestamp) {
      newMovementsList.push(movement);
    }
  }
  
  if (newMovementsList.length > 0) {
    logger.debug(`Última fecha BD: ${new Date(latestTimestamp).toLocaleDateString()}, Nuevos movimientos encontrados: ${newMovementsList.length}`);
  }
  
  // Ordenar los nuevos movimientos (más reciente primero)
  return sortMovementsByDate(newMovementsList);
}

/**
 * Verifica si hay cambios significativos en los litigantes
 * Compara por RUT (asumiendo que es único)
 * @param {Array} existingLitigants - Litigantes existentes
 * @param {Array} newLitigants - Litigantes nuevos
 * @returns {boolean} - True si hay cambios
 */
function haveLitigantsChanged(existingLitigants, newLitigants) {
  // Si no hay litigantes existentes y los nuevos existen → hay cambios
  if (!existingLitigants || existingLitigants.length === 0) {
    return newLitigants && newLitigants.length > 0;
  }
  
  // Si no hay litigantes nuevos pero los existentes sí → hay cambios
  if (!newLitigants || newLitigants.length === 0) {
    return existingLitigants.length > 0;
  }
  
  // Si la cantidad es diferente → hay cambios
  if (existingLitigants.length !== newLitigants.length) return true;
  
  // Comparar por RUT (asumiendo que es único)
  const existingRuts = new Set(existingLitigants.map(l => l.rut).filter(r => r && r.trim() !== ''));
  const newRuts = new Set(newLitigants.map(l => l.rut).filter(r => r && r.trim() !== ''));
  
  if (existingRuts.size !== newRuts.size) return true;
  
  for (const rut of existingRuts) {
    if (!newRuts.has(rut)) return true;
  }
  
  return false;
}

/**
 * Compara campos principales de la causa
 * @param {Object} existingCase - Causa existente en BD
 * @param {Object} newData - Nuevos datos extraídos
 * @returns {Object} - { changed: boolean, fields: string[] }
 */
function compareMainFields(existingCase, newData) {
  const fieldsToCompare = ['admission', 'process', 'stage', 'processState', 'court', 'cover', 'location', 'estAdmin'];
  const changedFields = [];
  
  for (const field of fieldsToCompare) {
    const existingValue = existingCase[field];
    const newValue = newData[field];
    
    // Convertir fechas a string para comparación
    let existingStr = existingValue;
    let newStr = newValue;
    
    if (field === 'admission') {
      if (existingValue instanceof Date) {
        existingStr = existingValue.toISOString().split('T')[0];
      }
      if (newValue instanceof Date) {
        newStr = newValue.toISOString().split('T')[0];
      }
    }
    
    if (existingStr !== newStr) {
      changedFields.push(field);
    }
  }
  
  return {
    changed: changedFields.length > 0,
    fields: changedFields
  };
}

/**
 * Resumen completo de cambios en una causa
 * @param {Object} existingCase - Causa existente en BD
 * @param {Object} newData - Nuevos datos extraídos
 * @returns {Object} - { hasChanges, newMovementsCount, litigantsChanged, mainFieldsChanged, summary }
 */
function hasCaseChanged(existingCase, newData) {
  const newMovements = getNewMovements(existingCase.movementsHistory, newData.movementsHistory);
  const litigantsChanged = haveLitigantsChanged(existingCase.litigants, newData.litigants);
  const mainFieldsComparison = compareMainFields(existingCase, newData);
  
  const hasChanges = newMovements.length > 0 || litigantsChanged || mainFieldsComparison.changed;
  
  return {
    hasChanges,
    newMovementsCount: newMovements.length,
    newMovements: newMovements,
    litigantsChanged,
    mainFieldsChanged: mainFieldsComparison.fields,
    summary: {
      movements: newMovements.length > 0 ? `${newMovements.length} nuevo(s) movimiento(s)` : 'Sin cambios en movimientos',
      litigants: litigantsChanged ? 'Litigantes actualizados' : 'Sin cambios en litigantes',
      mainFields: mainFieldsComparison.fields.length > 0 ? `Campos actualizados: ${mainFieldsComparison.fields.join(', ')}` : 'Sin cambios en campos principales'
    }
  };
}

module.exports = {
  parseDate,
  compareDates,
  getMovementTimestamp,
  getLatestMovementTimestamp,
  sortMovementsByDate,
  getNewMovements,
  haveLitigantsChanged,
  compareMainFields,
  hasCaseChanged
};
