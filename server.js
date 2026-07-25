import Fastify from 'fastify';
import cors from '@fastify/cors';
import view from '@fastify/view';
import ejs from 'ejs';
import path from 'path';
import { fileURLToPath } from 'url';
import yts from 'yt-search'; // Librería de búsqueda real

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fastify = Fastify({ logger: false });

const DATABASE = {
    keys: {
        "ALEX-PRO-888": { plan: "PREMIUM", limit: "Infinito", used: 0 },
        "ALEX-FREE-777": { plan: "FREE", limit: 4000, used: 0 }
    }
};

fastify.register(cors);
fastify.register(view, { engine: { ejs }, root: path.join(__dirname, 'views') });

// API: Búsqueda en YouTube Real
fastify.get('/api/v1/scraper/ytsearch', async (request, reply) => {
    const { query, apikey } = request.query;
    
    // Validación de Key
    if (!apikey || !DATABASE.keys[apikey]) {
        return reply.code(401).send({ status: false, message: "API KEY INVÁLIDA" });
    }

    if (!query) return { status: false, message: "Falta el parámetro query" };

    try {
        const search = await yts(query); // Busca en YouTube
        const videos = search.videos.slice(0, 10); // Toma los primeros 10 resultados
        
        DATABASE.keys[apikey].used++; // Aumenta uso
        
        return {
            status: true,
            author: "Alex Scraper",
            results: videos.map(v => ({
                title: v.title,
                url: v.url,
                duration: v.timestamp,
                views: v.views,
                thumbnail: v.thumbnail
            }))
        };
    } catch (e) {
        return { status: false, message: "Error en la búsqueda" };
    }
});

// Portal
fastify.get('/', async (req, reply) => reply.view('portal.ejs', { keys: DATABASE.keys }));

const start = async () => {
    try {
        await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    } catch (err) {
        process.exit(1);
    }
};
start();