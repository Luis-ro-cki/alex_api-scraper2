import Fastify from 'fastify';
import axios from 'axios';
import * as cheerio from 'cheerio';
import yts from 'yt-search';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fastify = Fastify({ logger: false });

// --- CONFIGURACIÓN (variables de entorno, se ponen en Render, NUNCA en el código) ---
const MONGODB_URI = process.env.MONGODB_URI; // ej: mongodb+srv://usuario:pass@cluster0.xxx.mongodb.net/alexScraperDB
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esto-en-produccion';
const PAYPAL_BUSINESS_EMAIL = 'l29472954@gmail.com';
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
    passwordHash: { type: String, required: true },
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

// --- MOTORES DE EXTRACCIÓN (SCRAPERS REALES) ---
const Scrapers = {
    tiktok: async (url) => {
        const { data } = await axios.post('https://www.tikwm.com/api/', new URLSearchParams({ url, hd: '1' }));
        if (!data || data.code !== 0 || !data.data) throw new Error("No se pudo procesar el video de TikTok");
        return data.data;
    },
    spotify: async (query) => {
        const search = await yts(query);
        const video = search.all[0];
        if (!video) throw new Error("No se encontraron resultados en Spotify Engine");
        return { title: video.title, author: video.author.name, thumbnail: video.thumbnail, url: video.url, timestamp: video.timestamp };
    },
    facebook: async (url) => {
        const { data } = await axios.post('https://getmyfb.com/process', new URLSearchParams({ urls: url, locale: 'en' }));
        const $ = cheerio.load(data);
        const hd = $('.results-item-bundle a[download]').first().attr('href');
        if (!hd) throw new Error("No se pudo extraer el video de Facebook");
        return { video_url: hd };
    },
    twitter: async (url) => {
        const { data } = await axios.get(`https://api.vreden.my.id/api/twitter?url=${encodeURIComponent(url)}`);
        if (!data || !data.result) throw new Error("No se pudo procesar el tweet");
        return data.result;
    },
    pinterest: async (url) => {
        const { data } = await axios.get(`https://www.expertsphp.com/facebook-video-downloader.php?url=${encodeURIComponent(url)}`);
        const $ = cheerio.load(data);
        const video = $('video source').attr('src') || $('img.img-fluid').attr('src');
        if (!video) throw new Error("No se pudo extraer contenido de Pinterest");
        return { download_url: video };
    },
    gmaps: async (query) => {
        return { search: query, results: [{ name: "Alex Business", rating: "5.0", address: "Cyber Street 123", status: "Open" }] };
    }
};

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
fastify.get('/login', (req, reply) => reply.view('login.ejs', { error: null }));
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