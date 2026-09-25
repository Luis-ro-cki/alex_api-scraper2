// src/utils/helpers.js
import axios from 'axios';
import { randomBytes } from 'crypto';

// Cliente HTTP con timeout y reintentos
export const httpClient = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
  }
});

/**
 * Ejecuta una función con reintentos automáticos
 * @param {Function} fn - Función async a ejecutar
 * @param {number} intentos - Número de reintentos
 * @returns {Promise} Resultado de la función
 */
export async function conReintentos(fn, intentos = 2) {
  let ultimoError;
  
  for (let i = 0; i <= intentos; i++) {
    try {
      return await fn();
    } catch (e) {
      ultimoError = e;
      if (i < intentos) {
        await new Promise(r => setTimeout(r, 800));
      }
    }
  }
  
  throw ultimoError;
}

/**
 * Genera una API key única
 * @returns {string} API key con formato ALEX-XXXX...
 */
export function generateApiKey() {
  return 'ALEX-' + randomBytes(16).toString('hex').toUpperCase();
}

/**
 * Genera una contraseña segura usando crypto
 * @param {number} longitud - Longitud de la contraseña
 * @returns {string} Contraseña generada
 */
export function generarPassword(longitud = 12) {
  const long = Math.min(Math.max(parseInt(longitud, 10) || 12, 6), 64);
  
  const mayus = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const minus = 'abcdefghijklmnopqrstuvwxyz';
  const numeros = '0123456789';
  const especiales = '!@#$%^&*()_+-=[]{}';
  const todos = mayus + minus + numeros + especiales;
  
  // Asegurar al menos uno de cada tipo usando crypto
  const bytes = randomBytes(long);
  
  let password = 
    mayus[bytes[0] % mayus.length] +
    minus[bytes[1] % minus.length] +
    numeros[bytes[2] % numeros.length] +
    especiales[bytes[3] % especiales.length];
  
  for (let i = password.length; i < long; i++) {
    password += todos[bytes[i] % todos.length];
  }
  
  // Mezclar usando Fisher-Yates shuffle con crypto
  const passwordArray = password.split('');
  const shuffleBytes = randomBytes(long * 2);
  
  for (let i = passwordArray.length - 1; i > 0; i--) {
    const j = shuffleBytes[i] % (i + 1);
    [passwordArray[i], passwordArray[j]] = [passwordArray[j], passwordArray[i]];
  }
  
  return passwordArray.join('');
}

/**
 * Formatea el uptime del servidor
 * @param {number} seconds - Segundos de uptime
 * @returns {string} Uptime formateado
 */
export function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}