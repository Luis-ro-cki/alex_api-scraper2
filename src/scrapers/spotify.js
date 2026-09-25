// src/scrapers/spotify.js
import axios from 'axios';
import { conReintentos } from '../utils/helpers.js';

const API_BASE = 'https://spotifyapi.sistemasolutions.com/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const SP_REGEX = /(?:open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/|spotify:track:)([a-zA-Z0-9]+)/i;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Extrae el ID de track de Spotify
 */
function extractTrackId(input) {
  const m = String(input || '').match(SP_REGEX);
  return m?.[1] || null;
}

/**
 * Normaliza URL de Spotify
 */
function normalizeSpotifyUrl(input) {
  const id = extractTrackId(input);
  if (!id) throw new Error('Enlace de Spotify inválido');
  return `https://open.spotify.com/track/${id}`;
}

/**
 * Resuelve redirects de Spotify (spotify.link, link.tospotify.com)
 */
async function resolveSpotifyUrl(input) {
  let url = input.trim();
  if (/spotify\.link/i.test(url) || /link\.tospotify\.com/i.test(url)) {
    try {
      const res = await axios.get(url, {
        maxRedirects: 5,
        headers: { 'User-Agent': UA },
        timeout: 10000,
        validateStatus: () => true
      });
      if (res.request?.res?.responseUrl) {
        url = res.request.res.responseUrl;
      }
    } catch (e) {
      // Continuar con la URL original si falla el redirect
    }
  }
  return normalizeSpotifyUrl(url);
}

/**
 * Descarga canciones de Spotify en MP3 320kbps
 * API: spotifyapi.sistemasolutions.com
 */
export async function scraperSpotify(input) {
  return conReintentos(async () => {
    const url = await resolveSpotifyUrl(input);
    const trackId = extractTrackId(url);
    
    if (!trackId) {
      throw new Error('Enlace de Spotify inválido. Usa: open.spotify.com/track/...');
    }

    // Iniciar conversión
    const startRes = await axios.post(`${API_BASE}/download`, 
      { url },
      { 
        headers: { 
          'User-Agent': UA,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 30000
      }
    );

    if (!startRes.data?.success && !startRes.data?.id && !startRes.data?.jobId) {
      throw new Error('No se pudo iniciar la descarga de Spotify');
    }

    const jobId = startRes.data.id || startRes.data.jobId || startRes.data.task_id;
    
    if (!jobId) {
      throw new Error('La API no devolvió un ID de trabajo');
    }

    // Polling para esperar la conversión (máximo 3 minutos)
    let attempts = 0;
    const maxAttempts = 60;
    
    while (attempts < maxAttempts) {
      attempts++;
      
      try {
        const statusRes = await axios.get(`${API_BASE}/status/${jobId}`, {
          headers: { 'User-Agent': UA },
          timeout: 15000
        });

        const status = statusRes.data;

        // Si está completo
        if (status.status === 'completed' || 
            status.status === 'done' || 
            status.downloadUrl ||
            status.download_url ||
            status.url) {
          return {
            titulo: status.title || status.name || 'Spotify Track',
            artista: status.artist || status.artists || (status.artists || []).join(', ') || 'Desconocido',
            album: status.album || null,
            duracion: status.duration || null,
            miniatura: status.thumbnail || status.cover || status.image || status.coverUrl || null,
            calidad: '320kbps',
            formato: 'audio/mp3',
            audio_url: status.downloadUrl || status.download_url || status.url || status.link
          };
        }

        // Si falló
        if (status.status === 'failed' || status.status === 'error') {
          throw new Error(status.error || status.message || 'La conversión falló');
        }

        // Esperar 3 segundos antes del siguiente intento
        await sleep(3000);
        
      } catch (e) {
        if (attempts >= maxAttempts) {
          throw new Error('La conversión tardó demasiado tiempo');
        }
        await sleep(3000);
      }
    }

    throw new Error('Timeout: La conversión no se completó en el tiempo esperado');
  });
}