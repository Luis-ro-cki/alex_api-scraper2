// src/utils/validators.js

// Lista blanca de dominios permitidos para scraping
const ALLOWED_DOMAINS = [
  'tiktok.com', 'vm.tiktok.com',
  'youtube.com', 'youtu.be',
  'facebook.com', 'fb.watch', 'fb.com',
  'twitter.com', 'x.com',
  'pinterest.com', 'pin.it',
  'soundcloud.com',
  'spotify.com'
];

/**
 * Valida y sanitiza URLs para prevenir SSRF
 * @param {string} url - URL a validar
 * @param {string} platform - Plataforma esperada (opcional)
 * @returns {string} URL validada
 * @throws {Error} Si la URL no es válida
 */
export function validateUrl(url, platform = null) {
  if (!url || typeof url !== 'string') {
    throw new Error('URL requerida');
  }

  const trimmedUrl = url.trim();
  
  try {
    const parsed = new URL(trimmedUrl);
    
    // Solo permitir http y https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Protocolo no permitido. Solo http/https.');
    }
    
    // Bloquear IPs privadas (prevención SSRF)
    const hostname = parsed.hostname;
    if (
      hostname.match(/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/) ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('169.254.')
    ) {
      throw new Error('URL no permitida: IP privada o local');
    }
    
    // Validar dominio si se especifica plataforma
    if (platform) {
      const domainAllowed = ALLOWED_DOMAINS.some(domain => 
        hostname.includes(domain)
      );
      if (!domainAllowed) {
        throw new Error(`Dominio no permitido para ${platform}`);
      }
    }
    
    return parsed.href;
  } catch (err) {
    if (err.message.includes('URL no permitida') || 
        err.message.includes('Protocolo no permitido')) {
      throw err;
    }
    throw new Error('URL inválida. Verifica que sea una URL completa (https://...)');
  }
}

/**
 * Valida parámetros de texto
 * @param {string} text - Texto a validar
 * @param {number} maxLength - Longitud máxima permitida
 * @returns {string} Texto validado
 */
export function validateText(text, maxLength = 500) {
  if (!text || typeof text !== 'string') {
    throw new Error('Texto requerido');
  }
  
  const trimmed = text.trim();
  
  if (trimmed.length === 0) {
    throw new Error('El texto no puede estar vacío');
  }
  
  if (trimmed.length > maxLength) {
    throw new Error(`Texto muy largo. Máximo ${maxLength} caracteres.`);
  }
  
  return trimmed;
}

/**
 * Detecta la plataforma de una URL
 * @param {string} url - URL a analizar
 * @returns {string} Nombre de la plataforma
 */
export function detectPlatform(url) {
  const u = url.toLowerCase();
  
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('facebook.com') || u.includes('fb.watch') || u.includes('fb.com')) return 'facebook';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  if (u.includes('pinterest.com') || u.includes('pin.it')) return 'pinterest';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('soundcloud.com')) return 'soundcloud';
  if (u.includes('spotify.com')) return 'spotify';
  
  return 'desconocida';
}