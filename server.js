import Fastify from 'fastify';
import axios from 'axios';
import * as cheerio from 'cheerio';
import yts from 'yt-search';
import path from 'path';
import { fileURLToPath } from 'url';
import view from '@fastify/view';
import ejs from 'ejs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fastify = Fastify({ logger: false });

// --- CONFIGURACIÓN DE LLAVES (MODIFÍCALAS AQUÍ) ---
const DATABASE = {
    keys: {
        "ALEX-MASTER-999": { plan: "ADMIN", used: 0, limit: 999999 },
        "ALEX-PRO-888": { plan: "PREMIUM", used: 0, limit: 999999 },
        "ALEX-FREE-777": { plan: "FREE", used: 0, limit: 4000 }
    }
};

// --- REGISTRO DE PLUGINS ---
fastify.register(view, { engine: { ejs }, root: path.join(__dirname, 'views') });

// --- MOTORES DE EXTRACCIÓN (SCRAPERS REALES) ---
const Scrapers = {
    // TIKTOK SIN MARCA DE AGUA
    tiktok: async (url) => {
        const { data } = await axios.post('https://www.tikwm.com/api/', new URLSearchParams({ url, hd: '1' }));
        if (!data || data.code !== 0 || !data.data) throw new Error("No se pudo procesar el video de TikTok");
        return data.data;
    },

    // SPOTIFY (Metadata + Búsqueda de Audio)
    spotify: async (query) => {
        const search = await yts(query);
        const video = search.all[0];
        if (!video) throw new Error("No se encontraron resultados en Spotify Engine");
        return {
            title: video.title,
            author: video.author.name,
            thumbnail: video.thumbnail,
            url: video.url,
            timestamp: video.timestamp
        };
    },

    // FACEBOOK VIDEO
    facebook: async (url) => {
        const { data } = await axios.post('https://getmyfb.com/process', new URLSearchParams({ urls: url, locale: 'en' }));
        const $ = cheerio.load(data);
        const hd = $('.results-item-bundle a[download]').first().attr('href');
        if (!hd) throw new Error("No se pudo extraer el video de Facebook");
        return { video_url: hd };
    },

    // TWITTER / X
    twitter: async (url) => {
        const { data } = await axios.get(`https://api.vreden.my.id/api/twitter?url=${encodeURIComponent(url)}`);
        if (!data || !data.result) throw new Error("No se pudo procesar el tweet");
        return data.result;
    },

    // PINTEREST
    // NOTA: este endpoint externo (expertsphp) está pensado para Facebook, no Pinterest.
    // Puede fallar o traer resultados incorrectos con links de Pinterest reales.
    // Te recomiendo buscar un endpoint dedicado a Pinterest si necesitas que funcione de verdad.
    pinterest: async (url) => {
        const { data } = await axios.get(`https://www.expertsphp.com/facebook-video-downloader.php?url=${encodeURIComponent(url)}`);
        const $ = cheerio.load(data);
        const video = $('video source').attr('src') || $('img.img-fluid').attr('src');
        if (!video) throw new Error("No se pudo extraer contenido de Pinterest");
        return { download_url: video };
    },

    // GOOGLE MAPS
    gmaps: async (query) => {
        // Simulación de extracción estructurada (placeholder, no hace scraping real todavía)
        return {
            search: query,
            results: [{ name: "Alex Business", rating: "5.0", address: "Cyber Street 123", status: "Open" }]
        };
    }
};

// --- SEGURIDAD Y LÍMITES ---
fastify.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/')) {
        const key = req.query.apikey;
        if (!key || !DATABASE.keys[key]) {
            return reply.code(401).send({ status: false, message: "API KEY INVÁLIDA" });
        }
        const account = DATABASE.keys[key];
        if (account.used >= account.limit) {
            return reply.code(429).send({ status: false, message: "LÍMITE DE USO ALCANZADO" });
        }
        account.used++;
    }
});

// --- MANEJO CENTRALIZADO DE ERRORES ---
fastify.setErrorHandler((error, req, reply) => {
    reply.code(500).send({ status: false, message: error.message || "Error interno del servidor" });
});

// --- RUTAS ---
fastify.get('/', (req, reply) => reply.view('portal.ejs', { keys: DATABASE.keys }));

fastify.get('/api/v1/download/tiktok', async (req) => {
    if (!req.query.url) throw new Error("Falta el parámetro 'url'");
    return { status: true, result: await Scrapers.tiktok(req.query.url) };
});

fastify.get('/api/v1/download/spotify', async (req) => {
    if (!req.query.url) throw new Error("Falta el parámetro 'url' (texto de búsqueda)");
    return { status: true, result: await Scrapers.spotify(req.query.url) };
});

fastify.get('/api/v1/download/facebook', async (req) => {
    if (!req.query.url) throw new Error("Falta el parámetro 'url'");
    return { status: true, result: await Scrapers.facebook(req.query.url) };
});

fastify.get('/api/v1/download/twitter', async (req) => {
    if (!req.query.url) throw new Error("Falta el parámetro 'url'");
    return { status: true, result: await Scrapers.twitter(req.query.url) };
});

fastify.get('/api/v1/download/pinterest', async (req) => {
    if (!req.query.url) throw new Error("Falta el parámetro 'url'");
    return { status: true, result: await Scrapers.pinterest(req.query.url) };
});

fastify.get('/api/v1/scraper/gmaps', async (req) => {
    if (!req.query.query) throw new Error("Falta el parámetro 'query'");
    return { status: true, result: await Scrapers.gmaps(req.query.query) };
});

// --- INICIO DEL SERVIDOR PARA RENDER ---
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