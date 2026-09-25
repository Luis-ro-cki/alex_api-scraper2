// src/scrapers/tools.js
import { httpClient, conReintentos, generarPassword } from '../utils/helpers.js';
import { validateText } from '../utils/validators.js';

/**
 * Generador de código QR
 */
export async function scraperQR(texto) {
  const textoValidado = validateText(texto, 1000);
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(textoValidado)}`;
  return { texto: textoValidado, imagen_qr: url };
}

/**
 * Acortador de URLs
 */
export async function scraperAcortar(url) {
  const urlValidada = validateText(url, 2000);
  
  return conReintentos(async () => {
    let data;
    try {
      ({ data } = await httpClient.get('https://is.gd/create.php', {
        params: { format: 'json', url: urlValidada }
      }));
    } catch (e) {
      throw new Error('El servicio de acortar enlaces no respondió. Intenta de nuevo.');
    }
    
    if (data.errorcode) {
      throw new Error(data.errormessage || 'No se pudo acortar ese link. Verifica que sea una URL válida.');
    }
    
    return { original: urlValidada, corto: data.shorturl };
  });
}

/**
 * Traductor de texto
 */
export async function scraperTraducir(input) {
  const inputValidado = validateText(input, 2000);
  
  let texto = inputValidado;
  let destino = 'en';
  
  if (inputValidado.includes('|')) {
    const partes = inputValidado.split('|');
    texto = partes[0].trim();
    destino = (partes[1] || 'en').trim();
  }
  
  return conReintentos(async () => {
    let data;
    try {
      ({ data } = await httpClient.get('https://translate.googleapis.com/translate_a/single', {
        params: {
          client: 'gtx',
          sl: 'auto',
          tl: destino,
          dt: 't',
          q: texto
        }
      }));
    } catch (e) {
      throw new Error(`El servicio de traducción no respondió: ${e.message}`);
    }
    
    const traduccion = Array.isArray(data?.[0]) 
      ? data[0].map(seg => seg[0]).join('') 
      : null;
    
    if (!traduccion) {
      throw new Error('No se pudo traducir ese texto. Verifica el formato: "texto|idioma", ej: "hola amigo|en".');
    }
    
    return { 
      texto_original: texto, 
      idioma_destino: destino, 
      traduccion 
    };
  });
}

/**
 * Consulta de clima
 */
export async function scraperClima(ciudad) {
  const ciudadValidada = validateText(ciudad, 100);
  
  return conReintentos(async () => {
    let data;
    try {
      ({ data } = await httpClient.get(`https://wttr.in/${encodeURIComponent(ciudadValidada)}`, {
        params: { format: 'j1' }
      }));
    } catch (e) {
      throw new Error('No se pudo obtener el clima de esa ciudad. Verifica el nombre.');
    }
    
    const actual = data?.current_condition?.[0];
    if (!actual) {
      throw new Error('No se encontró información de clima para esa ciudad.');
    }
    
    return {
      ciudad: ciudadValidada,
      temperatura_c: actual.temp_C,
      sensacion_c: actual.FeelsLikeC,
      descripcion: actual.lang_es?.[0]?.value || actual.weatherDesc?.[0]?.value,
      humedad_porciento: actual.humidity,
      viento_kmh: actual.windspeedKmph
    };
  });
}

/**
 * Generador de contraseñas seguras
 */
export async function scraperGenerarPassword(input) {
  const password = generarPassword(input || '12');
  return { 
    longitud: password.length, 
    password 
  };
}