// src/routes/api.js

import axios from 'axios';
import { User } from '../models/User.js';
import { config } from '../config.js';
import { validateApiKey } from '../middleware/auth.js';
import { withCache } from '../utils/cache.js';
import { scraperTiktok, scraperFacebook, scraperTwitter, scraperPinterest } from '../scrapers/social.js';
import { scraperYoutube, scraperYoutubeMp4, scraperYoutubeMp3 } from '../scrapers/youtube.js';
import { scraperSpotify } from '../scrapers/spotify.js';
import { scraperGmaps, scraperIdentificar } from '../scrapers/identify.js';
import { scraperQR, scraperAcortar, scraperTraducir, scraperClima, scraperGenerarPassword } from '../scrapers/tools.js';
import { scraperAnimeQuote, scraperAnimeReaccion, scraperAnimeImagen, scraperGhibli, scraperAnimeMeme } from '../scrapers/anime.js';

export function registerApiRoutes(fastify) {
  // Middleware de autenticación para todas las rutas /api/
  fastify.addHook('preHandler', validateApiKey);

  // PayPal IPN
  fastify.post('/api/paypal/ipn', async (req, reply) => {
    try {
      const body = req.body;
      const verifyParams = new URLSearchParams(body);
      verifyParams.append('cmd', '_notify-validate');

      const { data: verification } = await axios.post(
        config.PAYPAL_IPN_URL,
        verifyParams.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      if (
        verification === 'VERIFIED' &&
        body.payment_status === 'Completed' &&
        body.receiver_email === config.PAYPAL_BUSINESS_EMAIL &&
        parseFloat(body.mc_gross) >= 5
      ) {
        const user = await User.findOne({ apiKey: body.custom });
        if (user) {
          const now = new Date();
          const base = (user.plan === 'premium' && user.premiumUntil && user.premiumUntil > now)
            ? user.premiumUntil
            : now;

          user.plan = 'premium';
          user.premiumUntil = new Date(base.getTime() + config.MONTH_MS);
          await user.save();
        }
      }

      reply.code(200).send('OK');
    } catch (e) {
      reply.code(200).send('OK');
    }
  });

  // TikTok
  fastify.get('/api/v1/download/tiktok', async (req) => {
    if (!req.query.url) throw new Error("Falta el parámetro 'url'");
    const result = await withCache(`tiktok:${req.query.url}`, () => scraperTiktok(req.query.url), 600);
    return { status: true, creator: "Alex", url: req.query.url, result };
  });

  // YouTube Search/Info
  fastify.get('/api/v1/search/youtube', async (req) => {
    if (!req.query.q) throw new Error("Falta el parámetro 'q'");
    const result = await withCache(`youtube:${req.query.q}`, () => scraperYoutube(req.query.q), 300);
    return { status: true, creator: "Alex", query: req.query.q, result };
  });

  // YouTube MP4
  fastify.get('/api/v1/download/youtube-mp4', async (req) => {
    if (!req.query.q) throw new Error("Falta el parámetro 'q'");
    const result = await withCache(`ytmp4:${req.query.q}`, () => scraperYoutubeMp4(req.query.q), 300);
    return { status: true, creator: "Alex", query: req.query.q, result };
  });

  // YouTube MP3
  fastify.get('/api/v1/download/youtube-mp3', async (req) => {
    if (!req.query.q) throw new Error("Falta el parámetro 'q'");
    const result = await withCache(`ytmp3:${req.query.q}`, () => scraperYoutubeMp3(req.query.q), 300);
    return { status: true, creator: "Alex", query: req.query.q, result };
  });

  // Spotify (NUEVO)
  fastify.get('/api/v1/download/spotify', async (req) => {
    if (!req.query.url) throw new Error("Falta el parámetro 'url'");
    const result = await withCache(`spotify:${req.query.url}`, () => scraperSpotify(req.query.url), 600);
    return { status: true, creator: "Alex", url: req.query.url, result };
  });

  // Facebook
  fastify.get('/api/v1/download/facebook', async (req) => {
    if (!req.query.url) throw new Error("Falta el parámetro 'url'");
    const result = await withCache(`fb:${req.query.url}`, () => scraperFacebook(req.query.url), 600);
    return { status: true, creator: "Alex", url: req.query.url, result };
  });

  // Twitter
  fastify.get('/api/v1/download/twitter', async (req) => {
    if (!req.query.url) throw new Error("Falta el parámetro 'url'");
    const result = await withCache(`tw:${req.query.url}`, () => scraperTwitter(req.query.url), 600);
    return { status: true, creator: "Alex", url: req.query.url, result };
  });

  // Pinterest
  fastify.get('/api/v1/download/pinterest', async (req) => {
    if (!req.query.url) throw new Error("Falta el parámetro 'url'");
    const result = await withCache(`pin:${req.query.url}`, () => scraperPinterest(req.query.url), 600);
    return { status: true, creator: "Alex", url: req.query.url, result };
  });

  // Google Maps
  fastify.get('/api/v1/scraper/gmaps', async (req) => {
    if (!req.query.query) throw new Error("Falta el parámetro 'query'");
    return { status: true, creator: "Alex", query: req.query.query, result: await scraperGmaps(req.query.query) };
  });

  // Identificador
  fastify.get('/api/v1/identify', async (req) => {
    if (!req.query.url) throw new Error("Falta el parámetro 'url'");
    const result = await withCache(`identify:${req.query.url}`, () => scraperIdentificar(req.query.url), 300);
    return { status: true, creator: "Alex", url: req.query.url, result };
  });

  // QR
  fastify.get('/api/v1/tools/qr', async (req) => {
    if (!req.query.q) throw new Error("Falta el parámetro 'q'");
    return { status: true, creator: "Alex", query: req.query.q, result: await scraperQR(req.query.q) };
  });

  // Acortar
  fastify.get('/api/v1/tools/acortar', async (req) => {
    if (!req.query.q) throw new Error("Falta el parámetro 'q'");
    return { status: true, creator: "Alex", query: req.query.q, result: await scraperAcortar(req.query.q) };
  });

  // Traducir
  fastify.get('/api/v1/tools/traducir', async (req) => {
    if (!req.query.q) throw new Error("Falta el parámetro 'q'");
    return { status: true, creator: "Alex", query: req.query.q, result: await scraperTraducir(req.query.q) };
  });

  // Clima
  fastify.get('/api/v1/tools/clima', async (req) => {
    if (!req.query.q) throw new Error("Falta el parámetro 'q'");
    const result = await withCache(`clima:${req.query.q}`, () => scraperClima(req.query.q), 300);
    return { status: true, creator: "Alex", query: req.query.q, result };
  });

  // Password
  fastify.get('/api/v1/tools/password', async (req) => {
    return { status: true, creator: "Alex", result: await scraperGenerarPassword(req.query.q || '12') };
  });

  // Anime Frase
  fastify.get('/api/v1/anime/frase', async (req) => {
    const result = await withCache(`animequote`, () => scraperAnimeQuote(), 60);
    return { status: true, creator: "Alex", result };
  });

  // Anime Reacción
  fastify.get('/api/v1/anime/reaccion', async (req) => {
    const tipo = req.query.q || 'hug';
    const result = await withCache(`animereact:${tipo}`, () => scraperAnimeReaccion(tipo), 300);
    return { status: true, creator: "Alex", tipo, result };
  });

  // Anime Imagen
  fastify.get('/api/v1/anime/imagen', async (req) => {
    const tipo = req.query.q || 'waifu';
    const result = await withCache(`animeimg:${tipo}`, () => scraperAnimeImagen(tipo), 300);
    return { status: true, creator: "Alex", tipo, result };
  });

  // Ghibli
  fastify.get('/api/v1/anime/ghibli', async (req) => {
    if (!req.query.q) throw new Error("Falta el parámetro 'q'");
    const result = await withCache(`ghibli:${req.query.q}`, () => scraperGhibli(req.query.q), 3600);
    return { status: true, creator: "Alex", query: req.query.q, result };
  });

  // Anime Meme
  fastify.get('/api/v1/anime/meme', async (req) => {
    const result = await withCache(`animememe`, () => scraperAnimeMeme(), 120);
    return { status: true, creator: "Alex", result };
  });
}