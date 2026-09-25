// src/scrapers/social.js
import * as cheerio from 'cheerio';
import { httpClient, conReintentos } from '../utils/helpers.js';
import { validateUrl } from '../utils/validators.js';

/**
 * Scraper de TikTok
 */
export async function scraperTiktok(url) {
  const validUrl = validateUrl(url, 'tiktok');
  
  return conReintentos(async () => {
    let data;
    try {
      ({ data } = await httpClient.post(
        'https://www.tikwm.com/api/',
        new URLSearchParams({ url: validUrl, hd: '1' })
      ));
    } catch (e) {
      throw new Error("El servicio de TikTok no respondió a tiempo. Intenta de nuevo en unos segundos.");
    }
    
    if (!data || data.code !== 0 || !data.data) {
      throw new Error("No se pudo procesar ese video de TikTok. Verifica que el enlace sea correcto y público.");
    }
    
    return data.data;
  });
}

/**
 * Scraper de Facebook
 */
export async function scraperFacebook(url) {
  const validUrl = validateUrl(url, 'facebook');
  
  return conReintentos(async () => {
    let data;
    try {
      ({ data } = await httpClient.post(
        'https://getmyfb.com/process',
        new URLSearchParams({ urls: validUrl, locale: 'en' })
      ));
    } catch (e) {
      throw new Error("El servicio de Facebook no respondió a tiempo. Intenta de nuevo en unos segundos.");
    }
    
    const $ = cheerio.load(data);
    const hd = $('.results-item-bundle a[download]').first().attr('href');
    
    if (!hd) {
      throw new Error("No se pudo extraer ese video de Facebook. Verifica que sea público y el enlace sea correcto.");
    }
    
    const titulo = $('.results-item-text').first().text().trim() 
      || $('meta[property="og:title"]').attr('content') 
      || null;
    const descripcion = $('meta[property="og:description"]').attr('content') || null;
    
    return {
      video_url: hd,
      titulo: titulo || 'No disponible',
      descripcion: descripcion || 'No disponible',
      nota: 'Facebook no expone públicamente likes, comentarios, compartidos ni vistas sin autorización oficial.'
    };
  });
}

/**
 * Scraper de Twitter/X
 */
export async function scraperTwitter(url) {
  const validUrl = validateUrl(url, 'twitter');
  
  return conReintentos(async () => {
    let data;
    try {
      ({ data } = await httpClient.get(
        `https://api.vreden.my.id/api/twitter?url=${encodeURIComponent(validUrl)}`
      ));
    } catch (e) {
      throw new Error("El servicio de Twitter/X no respondió a tiempo. Intenta de nuevo en unos segundos.");
    }
    
    if (!data || !data.result) {
      throw new Error("No se pudo procesar ese tweet. Verifica que el enlace sea correcto y público.");
    }
    
    return data.result;
  });
}

/**
 * Scraper de Pinterest
 */
export async function scraperPinterest(url) {
  const validUrl = validateUrl(url, 'pinterest');
  
  return conReintentos(async () => {
    let data;
    try {
      ({ data } = await httpClient.get(
        `https://www.expertsphp.com/facebook-video-downloader.php?url=${encodeURIComponent(validUrl)}`
      ));
    } catch (e) {
      throw new Error("El servicio de Pinterest no respondió a tiempo. Intenta de nuevo en unos segundos.");
    }
    
    const $ = cheerio.load(data);
    const video = $('video source').attr('src') || $('img.img-fluid').attr('src');
    
    if (!video) {
      throw new Error("No se pudo extraer ese contenido de Pinterest. Verifica que el enlace sea correcto y público.");
    }
    
    return { download_url: video };
  });
}