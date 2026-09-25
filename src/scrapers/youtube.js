// src/scrapers/youtube.js
import axios from 'axios';
import ytdl from '@distube/ytdl-core';
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
 * Obtiene información de un video de YouTube por su URL
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
 * Obtiene información o busca videos de YouTube
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
 * Descarga video de YouTube en MP4
 */
export async function scraperYoutubeMp4(input) {
  return conReintentos(async () => {
    const url = esEnlace(input) ? input : (await buscarYoutube(input))[0]?.url;
    if (!url) throw new Error("No se encontró ningún video de YouTube con ese término.");
    
    if (!ytdl.validateURL(url)) throw new Error("Ese enlace de YouTube no es válido.");
    
    let info;
    try {
      info = await ytdl.getInfo(url);
    } catch (e) {
      throw new Error(`YouTube bloqueó o falló la petición: ${e.message}`);
    }
    
    const formato = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'videoandaudio' })
      || ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'video' });
    
    if (!formato) throw new Error("No se encontró un formato de video descargable.");
    
    return {
      titulo: info.videoDetails.title,
      autor: info.videoDetails.author?.name,
      duracion_segundos: info.videoDetails.lengthSeconds,
      miniatura: info.videoDetails.thumbnails?.slice(-1)[0]?.url,
      video_url: formato.url
    };
  });
}

/**
 * Descarga audio de YouTube en MP3
 */
export async function scraperYoutubeMp3(input) {
  return conReintentos(async () => {
    const url = esEnlace(input) ? input : (await buscarYoutube(input))[0]?.url;
    if (!url) throw new Error("No se encontró ningún video de YouTube con ese término.");
    
    if (!ytdl.validateURL(url)) throw new Error("Ese enlace de YouTube no es válido.");
    
    let info;
    try {
      info = await ytdl.getInfo(url);
    } catch (e) {
      throw new Error(`YouTube bloqueó o falló la petición: ${e.message}`);
    }
    
    const formato = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
    if (!formato) throw new Error("No se encontró un formato de audio descargable.");
    
    return {
      titulo: info.videoDetails.title,
      autor: info.videoDetails.author?.name,
      duracion_segundos: info.videoDetails.lengthSeconds,
      miniatura: info.videoDetails.thumbnails?.slice(-1)[0]?.url,
      formato: 'audio original de YouTube',
      audio_url: formato.url
    };
  });
}