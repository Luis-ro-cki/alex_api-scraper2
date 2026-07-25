import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import view from '@fastify/view';
import ejs from 'ejs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fastify = Fastify({ logger: true });

// --- CONFIGURACIÓN DE LAS API KEYS ---
const DATABASE = {
    keys: {
        "ALEX-PRO-888": { plan: "PREMIUM", limit: "Infinito", used: 0 },
        "ALEX-FREE-777": { plan: "FREE", limit: 4000, used: 0 },
        "ALEX-MASTER-999": { plan: "ADMIN", limit: "Infinito", used: 0 }
    }
};

// --- CONFIGURACIÓN DE FASTIFY ---
fastify.register(cors);
fastify.register(view, { 
    engine: { ejs },
    root: path.join(__dirname, 'views') 
});

fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute'
});

// Middleware: Validación de API KEY
fastify.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/api/')) {
        const key = request.query.apikey || request.headers['x-api-key'];
        
        if (!key || !DATABASE.keys[key]) {
            return reply.code(401).send({ 
                status: false, 
                message: "API KEY NO VÁLIDA" 
            });
        }
        DATABASE.keys[key].used++;
    }
});

// Ruta del Portal (Dashboard)
fastify.get('/', async (request, reply) => {
    return reply.view('portal.ejs', { keys: DATABASE.keys });
});

// --- API ENDPOINTS ---

// YouTube
fastify.get('/api/v1/download/yt', async (request) => {
    const { url } = request.query;
    return {
        status: true,
        author: "Alex Scraper",
        result: {
            title: "Video YouTube",
            url_download: "https://ejemplo.com/dl",
            thumb: "https://i.ytimg.com/vi/example/0.jpg"
        }
    };
});

// TikTok
fastify.get('/api/v1/download/tiktok', async (request) => {
    return {
        status: true,
        result: {
            video: "https://tiktok.com/file.mp4",
            desc: "Descargado con Alex API"
        }
    };
});

// Google Maps
fastify.get('/api/v1/scraper/gmaps', async (request) => {
    return {
        status: true,
        results: [{ name: "Alex Store", phone: "+123", rating: 5.0 }]
    };
});

// INICIO (RENDER COMPATIBLE)
const start = async () => {
    try {
        const port = process.env.PORT || 3000;
        await fastify.listen({ port: port, host: '0.0.0.0' });
        console.log(`ONLINE EN PUERTO: ${port}`);
    } catch (err) {
        process.exit(1);
    }
};
start();