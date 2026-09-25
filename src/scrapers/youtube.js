// src/scrapers/youtube.js
import axios from 'axios';
import { conReintentos } from '../utils/helpers.js';

const YT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
};

// Instancias de Piped (fallbacks en caso de que una falle)
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.projectsegfau.lt',
  'https://pipedapi.in.projectsegfau.lt',
  'https://pipedapi.leptons.xyz'
];

/**
 * Verifica si un texto es una URL
 */
function esEnlace(texto) {
  return /^https?:\/\//i.test(texto.trim());
}

/**
 * Extrae el ID de video de YouTube de una URL
 */
function extraerIdYoutube(url) {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

/**
 * Obtiene info de video usando Piped API (con fallback entre instancias)
 */
async function obtenerInfoPiped(videoId) {
  for (const instancia of PIPED_INSTANCES) {
    try {
      const { data } = await axios.get(`${instancia}/streams/${videoId}`, {
        timeout: 15000
      });
      
      if (data && data.title) {
        return {
          ...data,
          instanciaUsada: instancia
        };
      }
    } catch (e) {
      // Esta instancia falló, probar la siguiente
      continue;
    }
  }
  
  throw new Error('Todas las instancias de Piped fallaron. Intenta de nuevo en unos segundos.');
}

/**
 * Busca videos en YouTube por texto (método original - sigue funcionando)
 */
async function buscarYoutube(query) {
  const { data: html } = await axios.get('https://www.youtube.com/results', {
    params: { search_query: query },
    headers: YT_HEADERS,
    timeout: 15000
  });
  
  const match = html.match(/var ytInitialData = ({.*?});<\/script>/s);
  if (!match) throw new Error("No se pudo leer los resultados de YouTube. Intenta de nuevo.");
  
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    throw new Error("Error interpretando los resultados de YouTube.");
  }
  
  const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const results = [];
  
  for (const section of sections) {
    const items = section?.itemSectionRenderer?.contents || [];
    
    for (const item of items) {
      const vr = item.videoRenderer;
      if (!vr) continue;
      
      results.push({
        title: vr.title?.runs?.[0]?.text || '',
        videoId: vr.videoId,
        url: 'https://youtube.com/watch?v=' + vr.videoId,
        thumbnail: vr.thumbnail?.thumbnails?.slice(-1)[0]?.url || '',
        duration: vr.lengthText?.simpleText || 'EN VIVO',
        views: vr.viewCountText?.simpleText || (vr.viewCountText?.runs || []).map(r => r.text).join('') || '0',
        publicado: vr.publishedTimeText?.simpleText || '',
        autor: vr.ownerText?.runs?.[0]?.text || ''
      });
      
      if (results.length >= 10) break;
    }
    
    if (results.length >= 10) break;
  }
  
  if (results.length === 0) throw new Error("No se encontraron resultados para esa búsqueda.");
  return results;
}

/**
 * Obtiene información de un video de YouTube (info básica)
 */
async function infoVideoYoutube(url) {
  const id = extraerIdYoutube(url);
  if (!id) throw new Error("Ese enlace no parece ser de YouTube.");
  
  const info = await obtenerInfoPiped(id);
  
  return [{
    title: info.title,
    videoId: id,
    url: `https://youtube.com/watch?v=${id}`,
    thumbnail: info.thumbnailUrl || info.thumbnail,
    autor: info.uploader || info.uploaderName || 'Desconocido'
  }];
}

/**
 * Export: Búsqueda o info de YouTube
 */
export async function scraperYoutube(input) {
  return conReintentos(async () => {
    try {
      if (esEnlace(input)) {
        return await infoVideoYoutube(input);
      }
      return await buscarYoutube(input);
    } catch (e) {
      if (e.message) throw e;
      throw new Error("YouTube no respondió a tiempo. Intenta de nuevo.");
    }
  });
}

/**
 * Export: Descarga de video YouTube (MP4) - USA PIPED API
 */
export async function scraperYoutubeMp4(input) {
  return conReintentos(async () => {
    // Obtener videoId desde URL o búsqueda
    let videoId = null;
    
    if (esEnlace(input)) {
      videoId = extraerIdYoutube(input);
      if (!videoId) throw new Error("Ese enlace de YouTube no es válido.");
    } else {
      const resultados = await buscarYoutube(input);
      videoId = resultados[0]?.videoId;
      if (!videoId) throw new Error("No se encontró ningún video de YouTube con ese término.");
    }
    
    // Obtener info completa desde Piped
    const info = await obtenerInfoPiped(videoId);
    
    // Buscar el mejor formato de video con audio
    const videoStream = info.videoStreams?.find(s => 
      s.videoOnly === false && 
      s.mimeType?.includes('video') &&
      (s.quality?.includes('720') || s.quality?.includes('480') || s.quality?.includes('360'))
    ) || info.videoStreams?.find(s => s.videoOnly === false) 
      || info.videoStreams?.[0];
    
    if (!videoStream?.url) {
      throw new Error("No se encontró un formato de video descargable.");
    }
    
    return {
      titulo: info.title,
      autor: info.uploader || info.uploaderName || 'Desconocido',
      duracion_segundos: info.duration || 0,
      miniatura: info.thumbnailUrl || info.thumbnail,
      calidad: videoStream.quality || 'Desconocida',
      video_url: videoStream.url
    };
  });
}

/**
 * Export: Descarga de audio YouTube (MP3) - USA PIPED API
 */
export async function scraperYoutubeMp3(input) {
  return conReintentos(async () => {
    // Obtener videoId desde URL o búsqueda
    let videoId = null;
    
    if (esEnlace(input)) {
      videoId = extraerIdYoutube(input);
      if (!videoId) throw new Error("Ese enlace de YouTube no es válido.");
    } else {
      const resultados = await buscarYoutube(input);
      videoId = resultados[0]?.videoId;
      if (!videoId) throw new Error("No se encontró ningún video de YouTube con ese término.");
    }
    
    // Obtener info completa desde Piped
    const info = await obtenerInfoPiped(videoId);
    
    // Buscar el mejor formato de audio
    const audioStream = info.audioStreams?.find(s => 
      s.mimeType?.includes('audio') && 
      (s.quality?.includes('128') || s.quality?.includes('192') || s.quality?.includes('256'))
    ) || info.audioStreams?.find(s => s.mimeType?.includes('audio'))
      || info.audioStreams?.[0];
    
    if (!audioStream?.url) {
      throw new Error("No se encontró un formato de audio descargable.");
    }
    
    return {
      titulo: info.title,
      autor: info.uploader || info.uploaderName || 'Desconocido',
      duracion_segundos: info.duration || 0,
      miniatura: info.thumbnailUrl || info.thumbnail,
      calidad: audioStream.quality || 'Desconocida',
      formato: audioStream.mimeType || 'audio/webm',
      audio_url: audioStream.url
    };
  });
}