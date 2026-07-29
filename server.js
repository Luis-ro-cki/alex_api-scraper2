import Fastify from 'fastify';
import axios from 'axios';
import * as cheerio from 'cheerio';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import view from '@fastify/view';
import ejs from 'ejs';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import ytdl from '@distube/ytdl-core';
import oauthPlugin from '@fastify/oauth2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fastify = Fastify({ logger: false });

// --- UTILIDADES PARA YOUTUBE (búsqueda propia + info de video) ---
const YT_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36' };

function esEnlace(texto) {
    return /^https?:\/\//i.test(texto.trim());
}

function extraerIdYoutube(url) {
    const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
}

async function infoVideoYoutube(url) {
    const id = extraerIdYoutube(url);
    if (!id) throw new Error("Ese enlace no parece ser de YouTube.");
    const { data } = await axios.get(`https://www.youtube.com/oembed`, { params: { url: `https://www.youtube.com/watch?v=${id}`, format: 'json' }, timeout: 15000 });
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
        params: { search_query: query },
        headers: YT_HEADERS,
        timeout: 15000
    });
    const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
    if (!match) throw new Error("No se pudo leer los resultados de YouTube en este momento. Intenta de nuevo.");

    let data;
    try { data = JSON.parse(match[1]); } catch { throw new Error("Error interpretando los resultados de YouTube."); }

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


// --- CONFIGURACIÓN (variables de entorno, se ponen en Render, NUNCA en el código) ---
const MONGODB_URI = process.env.MONGODB_URI; // ej: mongodb+srv://usuario:pass@cluster0.xxx.mongodb.net/alexScraperDB
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esto-en-produccion';
const PAYPAL_BUSINESS_EMAIL = 'l29472954@gmail.com';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'l29472954@gmail.com').toLowerCase();
const PAYPAL_IPN_URL = 'https://ipnpb.paypal.com/cgi-bin/webscr'; // Live. Para pruebas: https://ipnpb.sandbox.paypal.com/cgi-bin/webscr

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const FREE_LIMIT = 3000;

// --- CONEXIÓN A MONGODB ---
if (!MONGODB_URI) {
    console.error('FALTA la variable de entorno MONGODB_URI. Configúrala en Render > Environment.');
} else {
    mongoose.connect(MONGODB_URI)
        .then(() => console.log('MongoDB conectado correctamente'))
        .catch(err => console.error('Error conectando a MongoDB:', err.message));
}

// --- MODELO DE USUARIO ---
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: null }, // null si el usuario entró con Google/GitHub
    authProvider: { type: String, enum: ['local', 'google', 'github'], default: 'local' },
    apiKey: { type: String, required: true, unique: true },
    plan: { type: String, enum: ['free', 'premium'], default: 'free' },
    requestsUsed: { type: Number, default: 0 },
    periodStart: { type: Date, default: Date.now },
    premiumUntil: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// --- LLAVES ESTÁTICAS DE ADMIN (para tus pruebas propias) ---
const DATABASE = {
    keys: {
        "ALEX-MASTER-999": { plan: "ADMIN", used: 0, limit: 999999 }
    }
};

// --- REGISTRO DE PLUGINS ---
fastify.register(view, { engine: { ejs }, root: path.join(__dirname, 'views') });
fastify.register(cors, { origin: true });
fastify.register(rateLimit, { max: 100, timeWindow: '1 minute' });
fastify.register(cookie);
fastify.register(formbody);

// --- LOGIN SOCIAL: GOOGLE Y GITHUB ---
const APP_URL = 'https://alex-api-scraper2-1.onrender.com';

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    fastify.register(oauthPlugin, {
        name: 'googleOAuth2',
        scope: ['profile', 'email'],
        credentials: {
            client: { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET },
            auth: oauthPlugin.GOOGLE_CONFIGURATION
        },
        startRedirectPath: '/auth/google',
        callbackUri: `${APP_URL}/auth/google/callback`
    });
} else {
    console.log('Login con Google desactivado: faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en Environment.');
}

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    fastify.register(oauthPlugin, {
        name: 'githubOAuth2',
        scope: ['user:email'],
        credentials: {
            client: { id: process.env.GITHUB_CLIENT_ID, secret: process.env.GITHUB_CLIENT_SECRET },
            auth: oauthPlugin.GITHUB_CONFIGURATION
        },
        startRedirectPath: '/auth/github',
        callbackUri: `${APP_URL}/auth/github/callback`
    });
} else {
    console.log('Login con GitHub desactivado: faltan GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET en Environment.');
}

// --- CLIENTE HTTP CON TIMEOUT + REINTENTOS AUTOMÁTICOS ---
const httpClient = axios.create({ timeout: 15000 });

async function conReintentos(fn, intentos = 2) {
    let ultimoError;
    for (let i = 0; i <= intentos; i++) {
        try {
            return await fn();
        } catch (e) {
            ultimoError = e;
            if (i < intentos) await new Promise(r => setTimeout(r, 800));
        }
    }
    throw ultimoError;
}

// --- MOTORES DE EXTRACCIÓN (SCRAPERS REALES) ---
const Scrapers = {
    tiktok: async (url) => conReintentos(async () => {
        let data;
        try {
            ({ data } = await httpClient.post('https://www.tikwm.com/api/', new URLSearchParams({ url, hd: '1' })));
        } catch (e) {
            throw new Error("El servicio de TikTok no respondió a tiempo. Intenta de nuevo en unos segundos.");
        }
        if (!data || data.code !== 0 || !data.data) throw new Error("No se pudo procesar ese video de TikTok. Verifica que el enlace sea correcto y público.");
        return data.data;
    }),
    youtube: async (input) => conReintentos(async () => {
        try {
            if (esEnlace(input)) return await infoVideoYoutube(input);
            return await buscarYoutube(input);
        } catch (e) {
            if (e.message) throw e;
            throw new Error("YouTube no respondió a tiempo. Intenta de nuevo.");
        }
    }),
    youtubeMp4: async (input) => conReintentos(async () => {
        const url = esEnlace(input) ? input : (await buscarYoutube(input))[0]?.url;
        if (!url) throw new Error("No se encontró ningún video de YouTube con ese término.");
        if (!ytdl.validateURL(url)) throw new Error("Ese enlace de YouTube no es válido.");
        let info;
        try {
            info = await ytdl.getInfo(url);
        } catch (e) {
            console.error("[YOUTUBE MP4] Error real:", e.message);
            throw new Error(`YouTube bloqueó o falló la petición: ${e.message}`);
        }
        const formato = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'videoandaudio' })
            || ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'video' });
        if (!formato) throw new Error("No se encontró un formato de video descargable para ese video.");
        return {
            titulo: info.videoDetails.title,
            autor: info.videoDetails.author?.name,
            duracion_segundos: info.videoDetails.lengthSeconds,
            miniatura: info.videoDetails.thumbnails?.slice(-1)[0]?.url,
            video_url: formato.url
        };
    }),
    youtubeMp3: async (input) => conReintentos(async () => {
        const url = esEnlace(input) ? input : (await buscarYoutube(input))[0]?.url;
        if (!url) throw new Error("No se encontró ningún video de YouTube con ese término.");
        if (!ytdl.validateURL(url)) throw new Error("Ese enlace de YouTube no es válido.");
        let info;
        try {
            info = await ytdl.getInfo(url);
        } catch (e) {
            console.error("[YOUTUBE MP3] Error real:", e.message);
            throw new Error(`YouTube bloqueó o falló la petición: ${e.message}`);
        }
        const formato = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
        if (!formato) throw new Error("No se encontró un formato de audio descargable para ese video.");
        return {
            titulo: info.videoDetails.title,
            autor: info.videoDetails.author?.name,
            duracion_segundos: info.videoDetails.lengthSeconds,
            miniatura: info.videoDetails.thumbnails?.slice(-1)[0]?.url,
            formato: 'audio original de YouTube (no es un .mp3 convertido, pero se reproduce igual)',
            audio_url: formato.url
        };
    }),
    facebook: async (url) => conReintentos(async () => {
        let data;
        try {
            ({ data } = await httpClient.post('https://getmyfb.com/process', new URLSearchParams({ urls: url, locale: 'en' })));
        } catch (e) {
            throw new Error("El servicio de Facebook no respondió a tiempo. Intenta de nuevo en unos segundos.");
        }
        const $ = cheerio.load(data);
        const hd = $('.results-item-bundle a[download]').first().attr('href');
        if (!hd) throw new Error("No se pudo extraer ese video de Facebook. Verifica que sea público y el enlace sea correcto.");
        const titulo = $('.results-item-text').first().text().trim() || $('meta[property="og:title"]').attr('content') || null;
        const descripcion = $('meta[property="og:description"]').attr('content') || null;
        return {
            video_url: hd,
            titulo: titulo || 'No disponible',
            descripcion: descripcion || 'No disponible',
            nota: 'Facebook no expone públicamente likes, comentarios, compartidos ni vistas sin autorización oficial de la página dueña del video.'
        };
    }),
    twitter: async (url) => conReintentos(async () => {
        let data;
        try {
            ({ data } = await httpClient.get(`https://api.vreden.my.id/api/twitter?url=${encodeURIComponent(url)}`));
        } catch (e) {
            throw new Error("El servicio de Twitter/X no respondió a tiempo. Intenta de nuevo en unos segundos.");
        }
        if (!data || !data.result) throw new Error("No se pudo procesar ese tweet. Verifica que el enlace sea correcto y público.");
        return data.result;
    }),
    pinterest: async (url) => conReintentos(async () => {
        let data;
        try {
            ({ data } = await httpClient.get(`https://www.expertsphp.com/facebook-video-downloader.php?url=${encodeURIComponent(url)}`));
        } catch (e) {
            throw new Error("El servicio de Pinterest no respondió a tiempo. Intenta de nuevo en unos segundos.");
        }
        const $ = cheerio.load(data);
        const video = $('video source').attr('src') || $('img.img-fluid').attr('src');
        if (!video) throw new Error("No se pudo extraer ese contenido de Pinterest. Verifica que el enlace sea correcto y público.");
        return { download_url: video };
    }),
    gmaps: async (query) => {
        return { search: query, results: [{ name: "Alex Business", rating: "5.0", address: "Cyber Street 123", status: "Open" }] };
    },
    identificar: async (url) => conReintentos(() => identificarContenido(url)),

    qr: async (texto) => {
        const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(texto)}`;
        return { texto, imagen_qr: url };
    },

    acortar: async (url) => conReintentos(async () => {
        let data;
        try {
            ({ data } = await httpClient.get('https://is.gd/create.php', { params: { format: 'json', url } }));
        } catch (e) {
            throw new Error('El servicio de acortar enlaces no respondió. Intenta de nuevo.');
        }
        if (data.errorcode) throw new Error(data.errormessage || 'No se pudo acortar ese link. Verifica que sea una URL válida.');
        return { original: url, corto: data.shorturl };
    }),

    traducir: async (input) => conReintentos(async () => {
        let texto = input, destino = 'en';
        if (input.includes('|')) {
            const partes = input.split('|');
            texto = partes[0].trim();
            destino = (partes[1] || 'en').trim();
        }
        let data;
        try {
            ({ data } = await httpClient.get('https://translate.googleapis.com/translate_a/single', {
                params: { client: 'gtx', sl: 'auto', tl: destino, dt: 't', q: texto }
            }));
        } catch (e) {
            console.error('[TRADUCIR] Error real:', e.response?.status, e.message);
            throw new Error(`El servicio de traducción no respondió: ${e.message}`);
        }
        const traduccion = Array.isArray(data?.[0]) ? data[0].map(seg => seg[0]).join('') : null;
        if (!traduccion) throw new Error('No se pudo traducir ese texto. Verifica el formato: "texto|idioma", ej: "hola amigo|en".');
        return { texto_original: texto, idioma_destino: destino, traduccion };
    }),

    clima: async (ciudad) => conReintentos(async () => {
        let data;
        try {
            ({ data } = await httpClient.get(`https://wttr.in/${encodeURIComponent(ciudad)}`, { params: { format: 'j1' } }));
        } catch (e) {
            throw new Error('No se pudo obtener el clima de esa ciudad. Verifica el nombre.');
        }
        const actual = data?.current_condition?.[0];
        if (!actual) throw new Error('No se encontró información de clima para esa ciudad.');
        return {
            ciudad,
            temperatura_c: actual.temp_C,
            sensacion_c: actual.FeelsLikeC,
            descripcion: actual.lang_es?.[0]?.value || actual.weatherDesc?.[0]?.value,
            humedad_porciento: actual.humidity,
            viento_kmh: actual.windspeedKmph
        };
    }),

    generarPassword: async (input) => {
        const longitud = Math.min(Math.max(parseInt(input, 10) || 12, 6), 64);
        const mayus = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const minus = 'abcdefghijklmnopqrstuvwxyz';
        const numeros = '0123456789';
        const especiales = '!@#$%^&*()_+-=[]{}';
        const todos = mayus + minus + numeros + especiales;
        let password = mayus[Math.floor(Math.random() * mayus.length)]
            + minus[Math.floor(Math.random() * minus.length)]
            + numeros[Math.floor(Math.random() * numeros.length)]
            + especiales[Math.floor(Math.random() * especiales.length)];
        for (let i = password.length; i < longitud; i++) {
            password += todos[Math.floor(Math.random() * todos.length)];
        }
        password = password.split('').sort(() => Math.random() - 0.5).join('');
        return { longitud, password };
    },

    animeQuote: async () => conReintentos(async () => {
        let data;
        try {
            ({ data } = await httpClient.get('https://animechan.io/api/v1/quotes/random'));
        } catch (e) {
            throw new Error('El servicio de frases de anime no respondió. Intenta de nuevo.');
        }
        const q = data?.data || data;
        if (!q?.content) throw new Error('No se pudo obtener una frase en este momento.');
        return { frase: q.content, personaje: q.character?.name || 'Desconocido', anime: q.anime?.name || 'Desconocido' };
    }),

    animeReaccion: async (tipo) => conReintentos(async () => {
        const valido = ['baka', 'bite', 'blush', 'bored', 'cry', 'cuddle', 'dance', 'facepalm', 'feed', 'handhold', 'happy', 'highfive', 'hug', 'kick', 'kiss', 'laugh', 'pat', 'poke', 'pout', 'punch', 'shrug', 'slap', 'sleep', 'smile', 'smug', 'stare', 'think', 'thumbsup', 'tickle', 'wave', 'wink', 'yeet'];
        const t = (tipo || 'hug').toLowerCase().trim();
        if (!valido.includes(t)) throw new Error(`Tipo no válido. Usa uno de: ${valido.join(', ')}`);
        let data;
        try {
            ({ data } = await httpClient.get(`https://nekos.best/api/v2/${t}`));
        } catch (e) {
            console.error('[REACCION] Error real:', e.response?.status, e.message);
            throw new Error(`El servicio de reacciones no respondió: ${e.message}`);
        }
        const resultado = data?.results?.[0];
        if (!resultado?.url) throw new Error('No se encontró una imagen para ese tipo.');
        return { tipo: t, gif_url: resultado.url, anime: resultado.anime_name || null };
    }),

    animeImagen: async (tipo) => conReintentos(async () => {
        const valido = ['waifu', 'maid', 'uniform', 'oldies'];
        const t = (tipo || 'waifu').toLowerCase().trim();
        if (!valido.includes(t)) throw new Error(`Tipo no válido. Usa uno de: ${valido.join(', ')}`);
        let data;
        try {
            ({ data } = await httpClient.get('https://api.waifu.im/search', { params: { included_tags: t, is_nsfw: false } }));
        } catch (e) {
            console.error('[ANIME IMAGEN] Error real:', e.response?.status, e.message);
            throw new Error(`El servicio de imágenes no respondió: ${e.message}`);
        }
        const img = data?.images?.[0];
        if (!img?.url) throw new Error('No se encontró una imagen para ese tipo.');
        return { tipo: t, imagen_url: img.url };
    }),

    ghibli: async (nombre) => conReintentos(async () => {
        let data;
        try {
            ({ data } = await httpClient.get('https://ghibliapi.vercel.app/films'));
        } catch (e) {
            throw new Error('El servicio de Studio Ghibli no respondió. Intenta de nuevo.');
        }
        const termino = nombre.toLowerCase();
        const pelicula = (data || []).find(f => f.title.toLowerCase().includes(termino));
        if (!pelicula) throw new Error('No se encontró ninguna película de Studio Ghibli con ese nombre.');
        return {
            titulo: pelicula.title,
            titulo_japones: pelicula.original_title,
            director: pelicula.director,
            año: pelicula.release_date,
            sinopsis: pelicula.description,
            puntuacion: pelicula.rt_score,
            imagen: pelicula.image
        };
    }),

    animeMeme: async () => conReintentos(async () => {
        let data;
        try {
            ({ data } = await httpClient.get('https://www.reddit.com/r/wholesomeanimemes/random/.json', { headers: { 'User-Agent': 'AlexScraperAPI/1.0' } }));
        } catch (e) {
            throw new Error('El servicio de memes no respondió (puede estar temporalmente limitado). Intenta de nuevo en un momento.');
        }
        const post = data?.[0]?.data?.children?.[0]?.data;
        if (!post) throw new Error('No se encontró ningún meme en este momento.');
        return { titulo: post.title, imagen_url: post.url, autor: post.author, likes: post.ups };
    })
};

// --- IDENTIFICADOR DE CONTENIDO (¿es video o audio, y de qué plataforma?) ---
function detectarPlataforma(url) {
    const u = url.toLowerCase();
    if (u.includes('tiktok.com')) return 'tiktok';
    if (u.includes('facebook.com') || u.includes('fb.watch')) return 'facebook';
    if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
    if (u.includes('pinterest.com') || u.includes('pin.it')) return 'pinterest';
    if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
    if (u.includes('soundcloud.com')) return 'soundcloud';
    if (u.includes('spotify.com')) return 'spotify';
    return 'desconocida';
}

async function identificarContenido(url) {
    const plataforma = detectarPlataforma(url);
    let mediaUrl = null;
    let infoExtra = {};

    switch (plataforma) {
        case 'tiktok': {
            const data = await Scrapers.tiktok(url);
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
            const data = await Scrapers.facebook(url);
            mediaUrl = data.video_url;
            break;
        }
        case 'twitter': {
            const data = await Scrapers.twitter(url);
            mediaUrl = data.url || data.video || data.download || (Array.isArray(data) ? data[0]?.url : null);
            break;
        }
        case 'pinterest': {
            const data = await Scrapers.pinterest(url);
            mediaUrl = data.download_url;
            break;
        }
        case 'youtube': {
            const data = await Scrapers.youtube(url);
            return { plataforma: 'youtube', tipo: 'video', nota: 'YouTube casi siempre es contenido de video.', info: Array.isArray(data) ? data[0] : data };
        }
        case 'soundcloud':
            return { plataforma: 'soundcloud', tipo: 'audio', nota: 'SoundCloud es una plataforma exclusivamente de audio.' };
        case 'spotify':
            return { plataforma: 'spotify', tipo: 'audio', nota: 'Spotify es una plataforma exclusivamente de audio.' };
        default:
            throw new Error('No reconozco esa plataforma. Soportadas: TikTok, Facebook, Twitter/X, Pinterest, YouTube, SoundCloud, Spotify.');
    }

    if (!mediaUrl) throw new Error('No se pudo obtener el archivo multimedia de ese enlace para identificar el tipo.');

    let tipo = 'desconocido';

    // Intento 1: pedirle al servidor el tipo real del archivo (content-type)
    try {
        const head = await httpClient.head(mediaUrl, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
                'Referer': 'https://www.tiktok.com/'
            }
        });
        const ct = head.headers['content-type'] || '';
        if (ct.startsWith('video/')) tipo = 'video';
        else if (ct.startsWith('audio/')) tipo = 'audio';
        else if (ct.startsWith('image/')) tipo = 'imagen';
    } catch (e) {
        // El CDN bloqueó la petición directa, seguimos al intento 2
    }

    // Intento 2 (respaldo): muchos enlaces ya traen el tipo en su propia URL, ej: mime_type=video_mp4
    if (tipo === 'desconocido') {
        const m = mediaUrl.match(/mime_type=([a-zA-Z0-9_]+)/i) || mediaUrl.match(/\.(mp4|mov|mkv|webm)(\?|$)/i) || mediaUrl.match(/\.(mp3|wav|m4a|ogg)(\?|$)/i);
        if (m) {
            const valor = m[1].toLowerCase();
            if (valor.includes('video') || ['mp4', 'mov', 'mkv', 'webm'].includes(valor)) tipo = 'video';
            else if (valor.includes('audio') || ['mp3', 'wav', 'm4a', 'ogg'].includes(valor)) tipo = 'audio';
        }
    }

    if (tipo === 'desconocido') tipo = 'desconocido (no se pudo verificar el tipo de archivo)';

    return { plataforma, tipo, media_url: mediaUrl, ...infoExtra };
}

// --- MÉTRICAS REALES ---
const latencySamples = [];
fastify.addHook('onResponse', (req, reply, done) => {
    latencySamples.push(reply.elapsedTime);
    if (latencySamples.length > 50) latencySamples.shift();
    done();
});
const getAvgLatency = () => {
    if (latencySamples.length === 0) return 0;
    return Math.round(latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length);
};
const formatUptime = (seconds) => {
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
};

// --- AUTENTICACIÓN (para páginas web con cookie) ---
async function requireLogin(req, reply) {
    const token = req.cookies.token;
    if (!token) return reply.redirect('/login');
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(payload.uid);
        if (!user) return reply.redirect('/login');
        req.currentUser = user;
    } catch {
        return reply.redirect('/login');
    }
}

async function requireAdmin(req, reply) {
    await requireLogin(req, reply);
    if (reply.sent) return; // ya redirigió a /login
    if (req.currentUser.email.toLowerCase() !== ADMIN_EMAIL) {
        return reply.code(403).send({ status: false, message: "No tienes acceso a esta sección." });
    }
}

// --- CONTROL DE PLANES (reset semanal / expiración premium) ---
function refreshPlan(user) {
    const now = new Date();
    if (user.plan === 'premium' && user.premiumUntil && user.premiumUntil < now) {
        user.plan = 'free';
        user.premiumUntil = null;
        user.requestsUsed = 0;
        user.periodStart = now;
    }
    if (user.plan === 'free' && (now - user.periodStart) >= WEEK_MS) {
        user.requestsUsed = 0;
        user.periodStart = now;
    }
}

// --- SEGURIDAD DE LA API (apikey por request) ---
fastify.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/') && !req.url.startsWith('/api/paypal/')) {
        const key = req.query.apikey;
        if (!key) return reply.code(401).send({ status: false, message: "FALTA EL PARÁMETRO 'apikey'" });

        if (DATABASE.keys[key]) {
            const acc = DATABASE.keys[key];
            if (acc.used >= acc.limit) return reply.code(429).send({ status: false, message: "LÍMITE ALCANZADO" });
            acc.used++;
            return;
        }

        const user = await User.findOne({ apiKey: key });
        if (!user) return reply.code(401).send({ status: false, message: "API KEY INVÁLIDA" });

        refreshPlan(user);
        const limit = user.plan === 'premium' ? Infinity : FREE_LIMIT;
        if (user.requestsUsed >= limit) {
            await user.save();
            return reply.code(429).send({ status: false, message: user.plan === 'premium' ? "LÍMITE ALCANZADO" : `LÍMITE SEMANAL ALCANZADO (${FREE_LIMIT}/semana). Hazte premium para solicitudes ilimitadas.` });
        }
        user.requestsUsed++;
        await user.save();
        req.currentUser = user;
    }
});

fastify.setErrorHandler((error, req, reply) => {
    reply.code(500).send({ status: false, message: error.message || "Error interno del servidor" });
});

// --- RUTAS WEB: DASHBOARD PRINCIPAL ---
fastify.get('/', (req, reply) => reply.view('portal.ejs', {
    keys: DATABASE.keys,
    activeScrapers: Object.keys(Scrapers).length,
    avgLatency: getAvgLatency(),
    uptime: formatUptime(process.uptime())
}));

// --- REGISTRO ---
fastify.get('/register', (req, reply) => reply.view('register.ejs', { error: null }));
fastify.post('/register', async (req, reply) => {
    const { email, password } = req.body;
    if (!email || !password || password.length < 6) {
        return reply.view('register.ejs', { error: 'Correo inválido o contraseña muy corta (mínimo 6 caracteres).' });
    }
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return reply.view('register.ejs', { error: 'Ese correo ya está registrado.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const apiKey = 'ALEX-' + crypto.randomBytes(16).toString('hex').toUpperCase();
    await User.create({ email, passwordHash, apiKey });
    reply.redirect('/login');
});

// --- LOGIN ---
fastify.get('/login', (req, reply) => {
    const errores = { google: 'No se pudo iniciar sesión con Google. Intenta de nuevo.', github: 'No se pudo iniciar sesión con GitHub. Intenta de nuevo.' };
    reply.view('login.ejs', { error: errores[req.query.error] || null });
});
fastify.post('/login', async (req, reply) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email: (email || '').toLowerCase() });
    if (!user) return reply.view('login.ejs', { error: 'Correo o contraseña incorrectos.' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return reply.view('login.ejs', { error: 'Correo o contraseña incorrectos.' });

    const token = jwt.sign({ uid: user._id.toString() }, JWT_SECRET, { expiresIn: '30d' });
    reply.setCookie('token', token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
    reply.redirect('/dashboard');
});

async function iniciarSesionComo(email, reply) {
    email = email.toLowerCase();
    let user = await User.findOne({ email });
    if (!user) {
        const apiKey = 'ALEX-' + crypto.randomBytes(16).toString('hex').toUpperCase();
        user = await User.create({ email, apiKey, authProvider: 'google' });
    }
    const token = jwt.sign({ uid: user._id.toString() }, JWT_SECRET, { expiresIn: '30d' });
    reply.setCookie('token', token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
    reply.redirect('/dashboard');
}

fastify.get('/auth/google/callback', async (req, reply) => {
    try {
        const { token } = await fastify.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(req);
        const { data: perfil } = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${token.access_token}` }
        });
        if (!perfil.email) throw new Error('Google no devolvió un correo.');
        await iniciarSesionComo(perfil.email, reply);
    } catch (e) {
        reply.redirect('/login?error=google');
    }
});

fastify.get('/auth/github/callback', async (req, reply) => {
    try {
        const { token } = await fastify.githubOAuth2.getAccessTokenFromAuthorizationCodeFlow(req);
        const headers = { Authorization: `Bearer ${token.access_token}`, 'User-Agent': 'AlexScraperAPI' };
        const { data: perfil } = await axios.get('https://api.github.com/user', { headers });
        let email = perfil.email;
        if (!email) {
            const { data: emails } = await axios.get('https://api.github.com/user/emails', { headers });
            email = (emails.find(e => e.primary) || emails[0])?.email;
        }
        if (!email) throw new Error('GitHub no devolvió un correo (verifica que tengas uno público o verificado).');
        await iniciarSesionComo(email, reply);
    } catch (e) {
        reply.redirect('/login?error=github');
    }
});

fastify.get('/logout', (req, reply) => {
    reply.clearCookie('token', { path: '/' });
    reply.redirect('/login');
});

// --- DASHBOARD DEL USUARIO ---
fastify.get('/dashboard', { preHandler: requireLogin }, async (req, reply) => {
    const user = req.currentUser;
    refreshPlan(user);
    await user.save();
    const limit = user.plan === 'premium' ? 'Ilimitadas' : FREE_LIMIT;
    reply.view('dashboard.ejs', {
        email: user.email,
        apiKey: user.apiKey,
        plan: user.plan,
        requestsUsed: user.requestsUsed,
        limit,
        premiumUntil: user.premiumUntil,
        paypalEmail: PAYPAL_BUSINESS_EMAIL,
        baseUrl: `${req.protocol}://${req.hostname}`,
        esAdmin: user.email.toLowerCase() === ADMIN_EMAIL
    });
});

// --- PANEL DE ADMIN (solo el correo configurado en ADMIN_EMAIL puede entrar) ---
fastify.get('/admin', { preHandler: requireAdmin }, async (req, reply) => {
    const usuarios = await User.find({}).sort({ createdAt: -1 });
    reply.view('admin.ejs', { usuarios, adminEmail: req.currentUser.email });
});

fastify.post('/admin/update-plan', { preHandler: requireAdmin }, async (req, reply) => {
    const { userId, plan, dias } = req.body;
    const user = await User.findById(userId);
    if (user) {
        if (plan === 'premium') {
            const extra = (parseInt(dias, 10) || 30) * 24 * 60 * 60 * 1000;
            user.plan = 'premium';
            user.premiumUntil = new Date(Date.now() + extra);
        } else {
            user.plan = 'free';
            user.premiumUntil = null;
            user.requestsUsed = 0;
            user.periodStart = new Date();
        }
        await user.save();
    }
    reply.redirect('/admin');
});

// --- PLAYGROUND DE ENDPOINTS (probar los scrapers en vivo) ---
const ENDPOINT_LIST = [
    { id: 'tiktok', name: 'TikTok Downloader', path: '/api/v1/download/tiktok', param: 'url', placeholder: 'https://vm.tiktok.com/xxxxx/', desc: 'Descarga video de TikTok sin marca de agua.' },
    { id: 'youtube', name: 'YouTube Search / Info', path: '/api/v1/search/youtube', param: 'q', placeholder: 'daddy yankee gasolina  —  o pega un enlace de YouTube', desc: 'Busca videos por texto, o pega un enlace de YouTube directo para obtener su info.' },
    { id: 'youtubeMp4', name: 'YouTube MP4 (Video)', path: '/api/v1/download/youtube-mp4', param: 'q', placeholder: 'daddy yankee gasolina  —  o un enlace de YouTube', desc: 'Descarga el video en su mejor calidad, por texto o enlace.' },
    { id: 'youtubeMp3', name: 'YouTube MP3 (Audio)', path: '/api/v1/download/youtube-mp3', param: 'q', placeholder: 'daddy yankee gasolina  —  o un enlace de YouTube', desc: 'Descarga solo el audio, por texto o enlace.' },
    { id: 'facebook', name: 'Facebook Downloader', path: '/api/v1/download/facebook', param: 'url', placeholder: 'https://www.facebook.com/.../videos/...', desc: 'Descarga video de Facebook.' },
    { id: 'twitter', name: 'Twitter / X Downloader', path: '/api/v1/download/twitter', param: 'url', placeholder: 'https://twitter.com/user/status/12345', desc: 'Descarga video de un tweet.' },
    { id: 'pinterest', name: 'Pinterest Downloader', path: '/api/v1/download/pinterest', param: 'url', placeholder: 'https://pin.it/xxxxx', desc: 'Descarga contenido de Pinterest.' },
    { id: 'gmaps', name: 'Google Maps Scraper', path: '/api/v1/scraper/gmaps', param: 'query', placeholder: 'restaurantes en CDMX', desc: 'Busca negocios en Google Maps.' },
    { id: 'identify', name: 'Identificador de Contenido', path: '/api/v1/identify', param: 'url', placeholder: 'Enlace de TikTok, YouTube, Facebook, SoundCloud, Spotify...', desc: 'Identifica si un enlace es video o audio, y de qué plataforma es.' },
    { id: 'qr', name: 'Generador de código QR', path: '/api/v1/tools/qr', param: 'q', placeholder: 'https://mi-sitio.com  —  o cualquier texto', desc: 'Genera un código QR de cualquier texto o link.' },
    { id: 'acortar', name: 'Acortador de URLs', path: '/api/v1/tools/acortar', param: 'q', placeholder: 'https://un-link-muy-largo.com/xyz123', desc: 'Acorta cualquier link largo.' },
    { id: 'traducir', name: 'Traductor de Texto', path: '/api/v1/tools/traducir', param: 'q', placeholder: 'hola amigo|en', desc: 'Traduce texto. Formato: texto|idioma_destino (ej: hola|en, hello|es).' },
    { id: 'clima', name: 'Clima Actual', path: '/api/v1/tools/clima', param: 'q', placeholder: 'Ciudad de México', desc: 'Clima en tiempo real de cualquier ciudad.' },
    { id: 'password', name: 'Generador de Contraseñas', path: '/api/v1/tools/password', param: 'q', placeholder: '16  (longitud deseada)', desc: 'Genera una contraseña segura y aleatoria.' },
    { id: 'animeFrase', name: 'Frase de Anime', path: '/api/v1/anime/frase', param: 'q', placeholder: '(no necesita nada, dale a Probar)', desc: 'Frase random con personaje y anime.' },
    { id: 'animeReaccion', name: 'Reacción Anime (GIF)', path: '/api/v1/anime/reaccion', param: 'q', placeholder: 'hug, pat, wave, dance, cry, smile...', desc: 'GIF de reacción tipo anime, SFW.' },
    { id: 'animeImagen', name: 'Imagen Anime (Waifu)', path: '/api/v1/anime/imagen', param: 'q', placeholder: 'waifu, maid, uniform, oldies', desc: 'Imagen bonita de anime, SFW.' },
    { id: 'ghibli', name: 'Studio Ghibli Info', path: '/api/v1/anime/ghibli', param: 'q', placeholder: 'Totoro, Chihiro, Ponyo...', desc: 'Info de películas de Studio Ghibli.' },
    { id: 'animeMeme', name: 'Meme de Anime', path: '/api/v1/anime/meme', param: 'q', placeholder: '(no necesita nada, dale a Probar)', desc: 'Meme random y sano de anime.' }
];

fastify.get('/endpoints', { preHandler: requireLogin }, async (req, reply) => {
    reply.view('endpoints.ejs', {
        endpoints: ENDPOINT_LIST,
        apiKey: req.currentUser.apiKey,
        baseUrl: `${req.protocol}://${req.hostname}`
    });
});

// --- PAYPAL: BOTÓN + IPN (notificación automática de pago) ---
fastify.post('/api/paypal/ipn', async (req, reply) => {
    try {
        const body = req.body;
        const verifyParams = new URLSearchParams(body);
        verifyParams.append('cmd', '_notify-validate');
        const { data: verification } = await axios.post(PAYPAL_IPN_URL, verifyParams.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (verification === 'VERIFIED' && body.payment_status === 'Completed' &&
            body.receiver_email === PAYPAL_BUSINESS_EMAIL && parseFloat(body.mc_gross) >= 5) {
            const user = await User.findOne({ apiKey: body.custom });
            if (user) {
                const now = new Date();
                const base = (user.plan === 'premium' && user.premiumUntil && user.premiumUntil > now) ? user.premiumUntil : now;
                user.plan = 'premium';
                user.premiumUntil = new Date(base.getTime() + MONTH_MS);
                await user.save();
            }
        }
        reply.code(200).send('OK');
    } catch (e) {
        reply.code(200).send('OK'); // Siempre 200 para que PayPal no reintente indefinidamente
    }
});

// --- ENDPOINTS DE SCRAPING (requieren apikey) ---
fastify.get('/api/v1/download/tiktok', async (req) => {
    if (!req.query.url) throw new Error("Falta el parámetro 'url'");
    return { status: true, creator: "Alex", url: req.query.url, result: await Scrapers.tiktok(req.query.url) };
});
fastify.get('/api/v1/search/youtube', async (req) => {
    if (!req.query.q) throw new Error("Falta el parámetro 'q' (texto o enlace de YouTube)");
    return { status: true, creator: "Alex", query: req.query.q, result: await Scrapers.youtube(req.query.q) };
});
fastify.get('/api/v1/download/youtube-mp4', async (req) => {
    if (!req.query.q) throw new Error("Falta el parámetro 'q' (texto o enlace de YouTube)");
    return { status: true, creator: "Alex", query: req.query.q, result: await Scrapers.youtubeMp4(req.query.q) };
});
fastify.get('/api/v1/download/youtube-mp3', async (req) => {
    if (!req.query.q) throw new Error("Falta el parámetro 'q' (texto o enlace de YouTube)");
    return { status: true, creator: "Alex", query: req.query.q, result: await Scrapers.youtubeMp3(req.query.q) };
});
fastify.get('/api/v1/download/facebook', async (req) => {
    if (!req.query.url) throw new Error("Falta el parámetro 'url'");
    return { status: true, creator: "Alex", url: req.query.url, result: await Scrapers.facebook(req.query.url) };
});
fastify.get('/api/v1/download/twitter', async (req) => {
    if (!req.query.url) throw new Error("Falta el parámetro 'url'");
    return { status: true, creator: "Alex", url: req.query.url, result: await Scrapers.twitter(req.query.url) };
});
fastify.get('/api/v1/download/pinterest', async (req) => {
    if (!req.query.url) throw new Error("Falta el parámetro 'url'");
    return { status: true, creator: "Alex", url: req.query.url, result: await Scrapers.pinterest(req.query.url) };
});
fastify.get('/api/v1/scraper/gmaps', async (req) => {
    if (!req.query.query) throw new Error("Falta el parámetro 'query'");
    return { status: true, creator: "Alex", query: req.query.query, result: await Scrapers.gmaps(req.query.query) };
});
fastify.get('/api/v1/identify', async (req) => {
    if (!req.query.url) throw new Error("Falta el parámetro 'url'");
    return { status: true, creator: "Alex", url: req.query.url, result: await Scrapers.identificar(req.query.url) };
});
fastify.get('/api/v1/tools/qr', async (req) => {
    if (!req.query.q) throw new Error("Falta el parámetro 'q' (el texto o link para el QR)");
    return { status: true, creator: "Alex", query: req.query.q, result: await Scrapers.qr(req.query.q) };
});
fastify.get('/api/v1/tools/acortar', async (req) => {
    if (!req.query.q) throw new Error("Falta el parámetro 'q' (la URL a acortar)");
    return { status: true, creator: "Alex", query: req.query.q, result: await Scrapers.acortar(req.query.q) };
});
fastify.get('/api/v1/tools/traducir', async (req) => {
    if (!req.query.q) throw new Error("Falta el parámetro 'q', formato: texto|idioma (ej: hola amigo|en)");
    return { status: true, creator: "Alex", query: req.query.q, result: await Scrapers.traducir(req.query.q) };
});
fastify.get('/api/v1/tools/clima', async (req) => {
    if (!req.query.q) throw new Error("Falta el parámetro 'q' (nombre de la ciudad)");
    return { status: true, creator: "Alex", query: req.query.q, result: await Scrapers.clima(req.query.q) };
});
fastify.get('/api/v1/tools/password', async (req) => {
    return { status: true, creator: "Alex", result: await Scrapers.generarPassword(req.query.q || '12') };
});
fastify.get('/api/v1/anime/frase', async (req) => {
    return { status: true, creator: "Alex", result: await Scrapers.animeQuote() };
});
fastify.get('/api/v1/anime/reaccion', async (req) => {
    return { status: true, creator: "Alex", tipo: req.query.q || 'hug', result: await Scrapers.animeReaccion(req.query.q) };
});
fastify.get('/api/v1/anime/imagen', async (req) => {
    return { status: true, creator: "Alex", tipo: req.query.q || 'waifu', result: await Scrapers.animeImagen(req.query.q) };
});
fastify.get('/api/v1/anime/ghibli', async (req) => {
    if (!req.query.q) throw new Error("Falta el parámetro 'q' (nombre de la película, ej: Totoro)");
    return { status: true, creator: "Alex", query: req.query.q, result: await Scrapers.ghibli(req.query.q) };
});
fastify.get('/api/v1/anime/meme', async (req) => {
    return { status: true, creator: "Alex", result: await Scrapers.animeMeme() };
});

// --- INICIO DEL SERVIDOR ---
const start = async () => {
    try {
        await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
        console.log("ALEX SCRAPER API: RUNNING ON PORT " + (process.env.PORT || 3000));
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};
start();
