// src/scrapers/identify.js
import { httpClient, conReintentos } from '../utils/helpers.js';
import { validateUrl, detectPlatform } from '../utils/validators.js';
import { scraperTiktok, scraperFacebook, scraperTwitter, scraperPinterest } from './social.js';
import { scraperYoutube } from './youtube.js';

/**
 * Identifica el tipo de contenido (video/audio/imagen) y plataforma
 */
export async function scraperIdentificar(url) {
  const validUrl = validateUrl(url);
  const plataforma = detectPlatform(validUrl);
  
  let mediaUrl = null;
  let infoExtra = {};
  
  switch (plataforma) {
    case 'tiktok': {
      const data = await scraperTiktok(validUrl);
      mediaUrl = data.play || data.hdplay || data.wmplay;
      infoExtra = {
        titulo: data.title,
        autor_video: data.author?.nickname,
        cancion: data.music_info?.title || null,
        artista_cancion: data.music_info?.author || null
      };
      break;
    }
    case 'facebook': {
      const data = await scraperFacebook(validUrl);
      mediaUrl = data.video_url;
      break;
    }
    case 'twitter': {
      const data = await scraperTwitter(validUrl);
      mediaUrl = data.url || data.video || data.download || (Array.isArray(data) ? data[0]?.url : null);
      break;
    }
    case 'pinterest': {
      const data = await scraperPinterest(validUrl);
      mediaUrl = data.download_url;
      break;
    }
    case 'youtube': {
      const data = await scraperYoutube(validUrl);
      return {
        plataforma: 'youtube',
        tipo: 'video',
        nota: 'YouTube casi siempre es contenido de video.',
        info: Array.isArray(data) ? data[0] : data
      };
    }
    case 'soundcloud':
      return {
        plataforma: 'soundcloud',
        tipo: 'audio',
        nota: 'SoundCloud es una plataforma exclusivamente de audio.'
      };
    case 'spotify':
      return {
        plataforma: 'spotify',
        tipo: 'audio',
        nota: 'Spotify es una plataforma exclusivamente de audio.'
      };
    default:
      throw new Error('No reconozco esa plataforma. Soportadas: TikTok, Facebook, Twitter/X, Pinterest, YouTube, SoundCloud, Spotify.');
  }
  
  if (!mediaUrl) {
    throw new Error('No se pudo obtener el archivo multimedia de ese enlace.');
  }
  
  let tipo = 'desconocido';
  
  // Intento 1: verificar content-type del servidor
  try {
    const head = await httpClient.head(mediaUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.tiktok.com/'
      }
    });
    
    const ct = head.headers['content-type'] || '';
    if (ct.startsWith('video/')) tipo = 'video';
    else if (ct.startsWith('audio/')) tipo = 'audio';
    else if (ct.startsWith('image/')) tipo = 'imagen';
  } catch (e) {
    // Continuar al intento 2
  }
  
  // Intento 2: verificar extensión en la URL
  if (tipo === 'desconocido') {
    const m = mediaUrl.match(/mime_type=([a-zA-Z0-9_]+)/i) 
      || mediaUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/i);
    
    if (m) {
      const valor = m[1].toLowerCase();
      if (valor.includes('video') || ['mp4', 'mov', 'mkv', 'webm'].includes(valor)) {
        tipo = 'video';
      } else if (valor.includes('audio') || ['mp3', 'wav', 'm4a', 'ogg'].includes(valor)) {
        tipo = 'audio';
      }
    }
  }
  
  if (tipo === 'desconocido') {
    tipo = 'desconocido (no se pudo verificar el tipo de archivo)';
  }
  
  return {
    plataforma,
    tipo,
    media_url: mediaUrl,
    ...infoExtra
  };
}

/**
 * Google Maps scraper (placeholder)
 */
export async function scraperGmaps(query) {
  return {
    search: query,
    results: [{
      name: "Alex Business",
      rating: "5.0",
      address: "Cyber Street 123",
      status: "Open"
    }]
  };
}