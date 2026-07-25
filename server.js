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
        try {
            const { data } = await axios.post('https://www.tikwm.com/api/', new URLSearchParams({ url, hd: '1' }));
            return data.data; // Retorna video sin WM, música, cover, etc.
        } catch (e) { throw new Error("Error en TikTok Scraper"); }
    },

    // SPOTIFY (Metadata + Búsqueda de Audio)
    spotify: async (query) => {
        try {
            const search = await yts(query);
            const video = search.all[0];
            return {
                title: video.title,
                author: video.author.name,
                thumbnail: video.thumbnail,
                url: video.url,
                timestamp: video.timestamp
            };
        } catch (e) { throw new Error("Error en Spotify Engine"); }
    },

    // FACEBOOK VIDEO
    facebook: async (url) => {
        try {
            const { data } = await axios.post('https://getmyfb.com/process', new URLSearchParams({ urls: url, locale: 'en' }));
            const $ = cheerio.load(data);
            const hd = $('.results-item-bundle a[download]').first().attr('href');
            return { video_url: hd };
        } catch (e) { throw new Error("Error en Facebook Scraper"); }
    },

    // TWITTER / X
    twitter: async (url) => {
        try {
            const { data } = await axios.get(`https://api.vreden.my.id/api/twitter?url=${url}`);
            return data.result;
        } catch (e) { throw new Error("Error en Twitter Scraper"); }
    },

    // PINTEREST
    pinterest: async (url) => {
        try {
            const { data } = await axios.get(`https://www.expertsphp.com/facebook-video-downloader.php?url=${url}`);
            const $ = cheerio.load(data);
            const video = $('video source').attr('src') || $('img.img-fluid').attr('src');
            return { download_url: video };
        } catch (e) { throw new Error("Error en Pinterest Scraper"); }
    },

    // GOOGLE MAPS
    gmaps: async (query) => {
        try {
            // Simulación de extracción estructurada
            return {
                search: query,
                results: [{ name: "Alex Business", rating: "5.0", address: "Cyber Street 123", status: "Open" }]
            };
        } catch (e) { throw new Error("Error en G-Maps Scraper"); }
    }
};

// --- RUTAS DE LA API ---

// Middleware de seguridad
fastify.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/')) {
        const key = req.query.apikey;
        if (!key || !DATABASE.keys[key]) {
            return reply.code(401).send({ status: false, message: "API KEY INVÁLIDA" });
        }
        DATABASE.keys[key].used++;
    }
});

// Endpoints
fastify.get('/', (req, reply) => reply.view('portal.ejs', { keys: DATABASE.keys }));

fastify.get('/api/v1/download/tiktok', async (req) => ({ status: true, result: await Scrapers.tiktok(req.query.url) }));
fastify.get('/api/v1/download/spotify', async (req) => ({ status: true, result: await Scrapers.spotify(req.query.url) }));
fastify.get('/api/v1/download/facebook', async (req) => ({ status: true, result: await Scrapers.facebook(req.query.url) }));
fastify.get('/api/v1/download/twitter', async (req) => ({ status: true, result: await Scrapers.twitter(req.query.url) }));
fastify.get('/api/v1/download/pinterest', async (req) => ({ status: true, result: await Scrapers.pinterest(req.query.url) }));
fastify.get('/api/v1/scraper/gmaps', async (req) => ({ status: true, result: await Scrapers.gmaps(req.query.query) }));

// Inicio del servidor para RENDER
const start = async () => {
    try {
        await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
        console.log("ALEX SCRAPER API: RUNNING ON PORT " + (process.env.PORT || 3000));
    } catch (err) { process.exit(1); }
};
start();