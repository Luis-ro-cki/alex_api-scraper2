// src/scrapers/youtube.js
import axios from 'axios';
import crypto from 'crypto';
import { conReintentos } from '../utils/helpers.js';

const YT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

const YT_REGEX = /(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

function extractVideoId(url) {
  const match = String(url || '').match(YT_REGEX);
  return match ? match[1] : null;
}

function esEnlace(texto) {
  return /^https?:\/\//i.test(texto.trim());
}

function withTimeout(promise, ms, errorMsg) {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(errorMsg || `Timeout ${ms}ms`)), ms)
    )
  ]);
}

async function infoVideoYoutube(url) {
  const id = extractVideoId(url);
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

async function buscarYoutube(query) {
  const { data: html } = await axios.get('https://www.youtube.com/results', {
    params: { search_query: query, hl: 'es' },
    headers: {
      ...YT_HEADERS,
      'accept-language': 'es-ES,es;q=0.9'
    },
    timeout: 15000
  });
  
  const match = html.match(/ytInitialData\s*=\s*(\{.+?\});/s);
  if (!match?.[1]) throw new Error("No se pudo leer los resultados de YouTube.");
  
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    throw new Error("Error interpretando los resultados de YouTube.");
  }
  
  const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const items = contents?.[0]?.itemSectionRenderer?.contents || [];
  const results = [];
  
  for (const it of items) {
    const v = it.videoRenderer;
    if (!v?.videoId) continue;
    
    results.push({
      title: v.title?.runs?.map(r => r.text).join('') || 'YouTube',
      videoId: v.videoId,
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      thumbnail: v.thumbnail?.thumbnails?.slice(-1)[0]?.url || '',
      duration: v.lengthText?.simpleText || 'EN VIVO',
      views: v.viewCountText?.simpleText || (v.viewCountText?.runs || []).map(r => r.text).join('') || '0',
      publicado: v.publishedTimeText?.simpleText || '',
      autor: v.ownerText?.runs?.[0]?.text || ''
    });
    
    if (results.length >= 10) break;
  }
  
  if (results.length === 0) throw new Error("No se encontraron resultados.");
  return results;
}

/* ===================================================
   SCRAPER 1: DLSRV (mejorado para video)
   =================================================== */

const DLSRV_BASE = 'https://embed.dlsrv.online';

function dlsrvHeaders(videoId) {
  return {
    'accept': '*/*',
    'accept-language': 'es-419,es;q=0.9',
    'content-type': 'application/json',
    'origin': DLSRV_BASE,
    'referer': `${DLSRV_BASE}/v2/full?videoId=${videoId}`,
    'user-agent': YT_HEADERS['User-Agent']
  };
}

async function dlsrvVideo(url, quality) {
  console.log('[DLSRV] Iniciando descarga de video...');
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('[DLSRV] URL inválida');

  const infoRes = await withTimeout(
    axios.post(`${DLSRV_BASE}/api/info`, 
      { videoId }, 
      { headers: dlsrvHeaders(videoId), timeout: 15000 }
    ),
    15000,
    '[DLSRV] Timeout obteniendo info'
  );
  
  if (infoRes.data?.status !== 'info' || !infoRes.data?.info) {
    throw new Error('[DLSRV] Sin información del video');
  }

  const info = infoRes.data.info;
  const videos = (info.formats || [])
    .filter(f => f.type === 'video')
    .map(f => ({ quality: String(f.quality).replace(/p$/i, ''), size: Number(f.fileSize) || 0 }))
    .sort((a, b) => Number(b.quality) - Number(a.quality));

  const available = videos.map(v => v.quality);
  let q = quality ? String(quality).replace(/p$/i, '') : '720';
  
  if (available.length && !available.includes(q)) {
    q = available.find(a => Number(a) <= Number(q)) || available[available.length - 1];
  }

  console.log(`[DLSRV] Solicitando calidad: ${q}p`);

  const dlRes = await withTimeout(
    axios.post(
      `${DLSRV_BASE}/api/download/mp4`,
      { videoId, format: 'mp4', quality: q },
      { headers: dlsrvHeaders(videoId), timeout: 20000 }
    ),
    20000,
    '[DLSRV] Timeout generando video'
  );

  if (dlRes.data?.status !== 'tunnel' || !dlRes.data?.url) {
    throw new Error('[DLSRV] No se generó el enlace de descarga');
  }

  console.log('[DLSRV] ✅ Enlace generado exitosamente');

  return {
    titulo: info.title || 'YouTube Video',
    autor: 'Desconocido',
    miniatura: info.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    calidad: `${q}p`,
    video_url: dlRes.data.url,
    source: 'dlsrv'
  };
}

async function dlsrvAudio(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('[DLSRV] URL inválida');

  const infoRes = await withTimeout(
    axios.post(`${DLSRV_BASE}/api/info`, 
      { videoId }, 
      { headers: dlsrvHeaders(videoId), timeout: 15000 }
    ),
    15000,
    '[DLSRV] Timeout obteniendo info'
  );
  
  if (infoRes.data?.status !== 'info' || !infoRes.data?.info) {
    throw new Error('[DLSRV] Sin información');
  }

  const info = infoRes.data.info;

  const dlRes = await withTimeout(
    axios.post(
      `${DLSRV_BASE}/api/download/mp3`,
      { videoId, format: 'mp3', quality: '128' },
      { headers: dlsrvHeaders(videoId), timeout: 15000 }
    ),
    15000,
    '[DLSRV] Timeout generando audio'
  );
  
  if (dlRes.data?.status !== 'tunnel' || !dlRes.data?.url) {
    throw new Error('[DLSRV] Enlace de audio no generado');
  }

  return {
    titulo: info.title || 'YouTube Video',
    autor: 'Desconocido',
    miniatura: info.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    calidad: '128kbps',
    audio_url: dlRes.data.url,
    source: 'dlsrv'
  };
}

/* ===================================================
   SCRAPER 2: Y2MATE (solo para audio)
   =================================================== */

const Y2MATE_REFERER = 'https://y2mate.tw/';
const Y2MATE_ORIGIN = 'https://y2mate.tw';

function ranHash() {
  return Array.from(crypto.randomBytes(16), b => b.toString(16).padStart(2, '0')).join('');
}

function encUrl(input) {
  const codePoints = [];
  for (let i = 0; i < input.length; i++) codePoints.push(input.charCodeAt(i));
  return codePoints.reverse().join(',');
}

function encodeDecode(input) {
  let out = '';
  for (let i = 0; i < input.length; i++) out += String.fromCharCode(input.charCodeAt(i) ^ 1);
  return out;
}

function apiEndpointY2mate(format, mp3Quality) {
  if (format === '1') return 'https://api5.apiapi2.lat';
  if (mp3Quality === '128') return 'https://api.apiapi2.lat';
  return 'https://api3.apiapi2.lat';
}

async function postJsonY2mate(url, body) {
  try {
    const res = await withTimeout(
      axios.post(url, body, {
        headers: {
          'accept': '*/*',
          'accept-language': 'es-419,es;q=0.9',
          'origin': Y2MATE_ORIGIN,
          'referer': Y2MATE_REFERER,
          'content-type': 'application/json',
          'user-agent': YT_HEADERS['User-Agent']
        },
        timeout: 10000
      }),
      10000,
      '[Y2Mate] Timeout'
    );
    return res.data;
  } catch {
    return false;
  }
}

async function y2mateAudio(url, quality) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('[Y2Mate] URL inválida');

  const mp3Q = quality ? String(quality).replace(/kbps$/i, '') : '128';
  const base = apiEndpointY2mate('0', mp3Q);

  let initData = false;
  for (let i = 0; i < 2 && initData === false; i++) {
    initData = await postJsonY2mate(
      `${base}/${ranHash()}/init/${encUrl(url)}/${ranHash()}/`,
      {
        data: encodeDecode(url),
        format: '0',
        referer: Y2MATE_REFERER,
        mp3Quality: mp3Q,
        mp4Quality: '480',
        userTimeZone: '300'
      }
    );
    if (initData === false) await new Promise(r => setTimeout(r, 800));
  }
  
  if (!initData) throw new Error('[Y2Mate] El servidor no respondió');
  if (initData?.le) throw new Error('[Y2Mate] Video dura más de 4 horas');
  if (initData?.i === 'blacklisted') throw new Error('[Y2Mate] Límite diario alcanzado');
  if (initData?.i === 'invalid') throw new Error('[Y2Mate] URL inválida');

  let finalData = initData;
  if (initData.s !== 'C') {
    let data = false;
    for (let count = 0; count < 15; count++) {
      data = await postJsonY2mate(
        `${base}/${ranHash()}/status/${initData.i}/${ranHash()}/`,
        { data: initData.i }
      );
      if (data === false) {
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      if (data.s === 'C') break;
      await new Promise(r => setTimeout(r, 1500));
    }
    if (!data || data.s !== 'C') throw new Error('[Y2Mate] Conversión tardó demasiado');
    finalData = data;
  }

  const downloadUrl = `${base}/${ranHash()}/download/${finalData.i}/${ranHash()}/`;
  
  return {
    titulo: typeof finalData.t === 'string' ? finalData.t : 'YouTube Video',
    autor: 'Desconocido',
    miniatura: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    calidad: `${mp3Q}kbps`,
    audio_url: downloadUrl,
    source: 'y2mate'
  };
}

/* ===================================================
   SCRAPER 3: SAVETUBE (video y audio)
   =================================================== */

function decodeSavetube(enc) {
  const secretKey = Buffer.from('C5D58EF67A7584E4A29F6C35BBC4EB12', 'hex');
  const data = Buffer.from(enc, 'base64');
  const iv = data.subarray(0, 16);
  const content = data.subarray(16);

  const decipher = crypto.createDecipheriv('aes-128-cbc', secretKey, iv);
  const decrypted = Buffer.concat([decipher.update(content), decipher.final()]);
  return JSON.parse(decrypted.toString());
}

async function savetubeDownload(url, type = 'video', quality) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('[Savetube] URL inválida');

  const isVideo = type === 'video';
  const qual = (quality || (isVideo ? '720' : '128')).replace(/[p|kbps]/gi, '');
  const downloadType = isVideo ? 'video' : 'audio';

  const cdnRes = await withTimeout(
    axios.get('https://media.savetube.vip/api/random-cdn', { timeout: 10000 }),
    10000,
    '[Savetube] Timeout obteniendo CDN'
  );
  
  if (!cdnRes.data?.cdn) throw new Error('[Savetube] CDN ilocalizable');
  const cdn = cdnRes.data.cdn;

  const infoRes = await withTimeout(
    axios.post(
      `https://${cdn}/v2/info`,
      { url: `https://youtube.com/watch?v=${videoId}` },
      {
        headers: {
          'content-type': 'application/json',
          'user-agent': YT_HEADERS['User-Agent'],
          'referer': 'https://save-tube.com/'
        },
        timeout: 15000
      }
    ),
    15000,
    '[Savetube] Timeout obteniendo info'
  );
  
  if (!infoRes.data?.data) throw new Error('[Savetube] Error de metadata');
  const info = decodeSavetube(infoRes.data.data);

  const dlRes = await withTimeout(
    axios.post(
      `https://${cdn}/download`,
      { downloadType, quality: String(qual), key: info.key },
      {
        headers: {
          'content-type': 'application/json',
          'user-agent': YT_HEADERS['User-Agent'],
          'referer': 'https://save-tube.com/'
        },
        timeout: 20000
      }
    ),
    20000,
    '[Savetube] Timeout generando descarga'
  );

  if (!dlRes.data?.data?.downloadUrl) throw new Error('[Savetube] Sin enlace');

  return {
    titulo: info.title || 'YouTube Video',
    autor: 'Desconocido',
    miniatura: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    calidad: isVideo ? `${qual}p` : `${qual}kbps`,
    ...(isVideo ? { video_url: dlRes.data.data.downloadUrl } : { audio_url: dlRes.data.data.downloadUrl }),
    source: 'savetube'
  };
}

/* ===================================================
   ESTRATEGIA DIFERENTE PARA VIDEO Y AUDIO
   =================================================== */

// Para VIDEO: probar en SECUENCIA (DLSRV → Savetube)
async function downloadVideo(url, quality) {
  console.log('[VIDEO] Iniciando descarga de video en secuencia...');
  
  // Intentar DLSRV primero
  try {
    console.log('[VIDEO] Probando DLSRV...');
    const result = await dlsrvVideo(url, quality);
    console.log('[VIDEO] ✅ DLSRV funcionó');
    return result;
  } catch (e) {
    console.log(`[VIDEO] ❌ DLSRV falló: ${e.message}`);
  }
  
  // Si DLSRV falla, intentar Savetube
  try {
    console.log('[VIDEO] Probando Savetube...');
    const result = await savetubeDownload(url, 'video', quality);
    console.log('[VIDEO] ✅ Savetube funcionó');
    return result;
  } catch (e) {
    console.log(`[VIDEO] ❌ Savetube falló: ${e.message}`);
  }
  
  throw new Error('Todos los scrapers de video fallaron. Intenta con otra URL.');
}

// Para AUDIO: carrera triple (funciona bien)
async function downloadAudio(url, quality) {
  const tasks = [
    dlsrvAudio(url).catch(e => {
      throw new Error(`[DLSRV] ${e.message}`);
    }),
    y2mateAudio(url, quality).catch(e => {
      throw new Error(`[Y2Mate] ${e.message}`);
    }),
    savetubeDownload(url, 'audio', quality).catch(e => {
      throw new Error(`[Savetube] ${e.message}`);
    })
  ];

  try {
    return await withTimeout(
      Promise.any(tasks),
      30000,
      'Timeout en descarga de audio'
    );
  } catch (err) {
    if (err instanceof AggregateError && err.errors?.length) {
      const msgs = err.errors
        .map(e => (e instanceof Error ? e.message : String(e)))
        .join(' · ');
      throw new Error(`Los 3 scrapers de audio fallaron: ${msgs}`);
    }
    throw err;
  }
}

/* ===================================================
   EXPORTS FINALES
   =================================================== */

export async function scraperYoutube(input) {
  return conReintentos(async () => {
    try {
      if (esEnlace(input)) {
        return await infoVideoYoutube(input);
      }
      return await buscarYoutube(input);
    } catch (e) {
      if (e.message) throw e;
      throw new Error("YouTube no respondió a tiempo.");
    }
  });
}

export async function scraperYoutubeMp4(input) {
  return conReintentos(async () => {
    let url = input;
    
    if (!esEnlace(input)) {
      console.log('[MP4] Buscando video en YouTube...');
      const resultados = await withTimeout(
        buscarYoutube(input),
        15000,
        'Timeout buscando en YouTube'
      );
      url = resultados[0]?.url;
      if (!url) throw new Error("No se encontró ningún video.");
      console.log(`[MP4] Video encontrado: ${url}`);
    }

    console.log('[MP4] Iniciando descarga de video...');
    const resultado = await withTimeout(
      downloadVideo(url, '720'),
      45000,
      'La descarga de video tardó demasiado (45s)'
    );
    
    console.log('[MP4] ✅ Descarga completada');
    
    return {
      titulo: resultado.titulo,
      autor: resultado.autor,
      miniatura: resultado.miniatura,
      calidad: resultado.calidad,
      video_url: resultado.video_url,
      motor_usado: resultado.source,
      nota: 'URL de descarga directa (puede expirar en unas horas)'
    };
  }, 1);
}

export async function scraperYoutubeMp3(input) {
  return conReintentos(async () => {
    let url = input;
    
    if (!esEnlace(input)) {
      const resultados = await withTimeout(
        buscarYoutube(input),
        15000,
        'Timeout buscando en YouTube'
      );
      url = resultados[0]?.url;
      if (!url) throw new Error("No se encontró ningún video.");
    }

    const resultado = await downloadAudio(url, '128');
    
    return {
      titulo: resultado.titulo,
      autor: resultado.autor,
      miniatura: resultado.miniatura,
      calidad: resultado.calidad,
      formato: 'audio/mp3',
      audio_url: resultado.audio_url,
      motor_usado: resultado.source,
      nota: 'URL de descarga directa (puede expirar en unas horas)'
    };
  }, 1);
}