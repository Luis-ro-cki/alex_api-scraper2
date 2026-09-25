// src/scrapers/youtube.js
import axios from 'axios';
import { conReintentos } from '../utils/helpers.js';

const YT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
};

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
 * Obtiene info básica de video de YouTube (oEmbed)
 */
async function infoVideoYoutube(url) {
  const id = extraerIdYoutube(url);
  if (!id) throw new Error("Ese enlace no parece ser de YouTube.");
  
  const { data } = await axios.get('https://www.youtube.com/oembed', {
    params: { 
      url: `https://www.youtube.com/watch?v=${id}`, 
      format: 'json' 
    },
    timeout: 15000
  });
  
  return [{
    title: data.title,
    videoId: id,
    url: `https://youtube.com/watch?v=${id}`,
    thumbnail: data.thumbnail_url,
    autor: data.author_name
  }];
}

/**
 * Busca videos en YouTube por texto
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
 * Descarga usando Cobalt.tools API (muy estable)
 */
async function descargarConCobalt(url, formato = 'mp4') {
  const cobaltUrls = [
    'https://api.cobalt.tools/api/json',
    'https://co.wuk.sh/api/json'
  ];
  
  for (const apiUrl of cobaltUrls) {
    try {
      const { data } = await axios.post(apiUrl, {
        url: url,
        vCodec: 'h264',
        vQuality: '720',
        aFormat: 'mp3',
        isAudioOnly: formato === 'mp3'
      }, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      if (data.status === 'stream' || data.status === 'redirect') {
        return {
          url: data.url,
          filename: data.filename || 'video',
          status: 'success'
        };
      }
      
      if (data.status === 'error') {
        throw new Error(data.text || 'Error en Cobalt');
      }
    } catch (e) {
      // Esta API falló, probar la siguiente
      continue;
    }
  }
  
  throw new Error('No se pudo descargar el video. Intenta de nuevo en unos segundos.');
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
 * Export: Descarga de video YouTube (MP4) - USA COBALT
 */
export async function scraperYoutubeMp4(input) {
  return conReintentos(async () => {
    // Obtener URL completa
    let url = input;
    
    if (!esEnlace(input)) {
      const resultados = await buscarYoutube(input);
      url = resultados[0]?.url;
      if (!url) throw new Error("No se encontró ningún video de YouTube con ese término.");
    }
    
    // Obtener info básica primero
    const info = await infoVideoYoutube(url);
    const videoInfo = info[0];
    
    // Descargar usando Cobalt
    const descarga = await descargarConCobalt(url, 'mp4');
    
    return {
      titulo: videoInfo.title,
      autor: videoInfo.autor,
      miniatura: videoInfo.thumbnail,
      video_url: descarga.url,
      nota: 'URL de descarga directa (puede expirar en unas horas)'
    };
  });
}

/**
 * Export: Descarga de audio YouTube (MP3) - USA COBALT
 */
export async function scraperYoutubeMp3(input) {
  return conReintentos(async () => {
    // Obtener URL completa
    let url = input;
    
    if (!esEnlace(input)) {
      const resultados = await buscarYoutube(input);
      url = resultados[0]?.url;
      if (!url) throw new Error("No se encontró ningún video de YouTube con ese término.");
    }
    
    // Obtener info básica primero
    const info = await infoVideoYoutube(url);
    const videoInfo = info[0];
    
    // Descargar usando Cobalt (solo audio)
    const descarga = await descargarConCobalt(url, 'mp3');
    
    return {
      titulo: videoInfo.title,
      autor: videoInfo.autor,
      miniatura: videoInfo.thumbnail,
      formato: 'audio/mp3',
      audio_url: descarga.url,
      nota: 'URL de descarga directa (puede expirar en unas horas)'
    };
  });
}