// src/utils/cache.js
import NodeCache from 'node-cache';

// Caché en memoria para respuestas de scrapers
export const cache = new NodeCache({
  stdTTL: 300, // 5 minutos por defecto
  checkperiod: 60, // Verificar cada minuto
  useClones: false
});

/**
 * Wrapper para cachear resultados de scrapers
 * @param {string} key - Clave única del cache
 * @param {Function} fn - Función async a ejecutar
 * @param {number} ttl - Tiempo de vida en segundos
 * @returns {Promise} Resultado (cacheado o nuevo)
 */
export async function withCache(key, fn, ttl = 300) {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  
  const result = await fn();
  cache.set(key, result, ttl);
  return result;
}