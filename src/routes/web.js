// src/routes/web.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import axios from 'axios';
import { User } from '../models/User.js';
import { config } from '../config.js';
import { requireLogin, requireAdmin } from '../middleware/auth.js';
import { generateApiKey, formatUptime } from '../utils/helpers.js';

export function registerWebRoutes(fastify) {
  // Página principal
  fastify.get('/', (req, reply) => {
    reply.view('portal.ejs', {
      activeScrapers: 20,
      avgLatency: 0,
      uptime: formatUptime(process.uptime())
    });
  });

  // Registro
  fastify.get('/register', (req, reply) => {
    reply.view('register.ejs', { error: null });
  });

  fastify.post('/register', async (req, reply) => {
    const { email, password } = req.body;
    
    if (!email || !password || password.length < 6) {
      return reply.view('register.ejs', {
        error: 'Correo inválido o contraseña muy corta (mínimo 6 caracteres).'
      });
    }
    
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return reply.view('register.ejs', { error: 'Ese correo ya está registrado.' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    const apiKey = generateApiKey();
    
    await User.create({ email, passwordHash, apiKey });
    reply.redirect('/login');
  });

  // Login
  fastify.get('/login', (req, reply) => {
    const errores = {
      google: 'No se pudo iniciar sesión con Google. Intenta de nuevo.',
      github: 'No se pudo iniciar sesión con GitHub. Intenta de nuevo.'
    };
    reply.view('login.ejs', { error: errores[req.query.error] || null });
  });

  fastify.post('/login', async (req, reply) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email: (email || '').toLowerCase() });
    
    if (!user) {
      return reply.view('login.ejs', { error: 'Correo o contraseña incorrectos.' });
    }
    
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return reply.view('login.ejs', { error: 'Correo o contraseña incorrectos.' });
    }
    
    const token = jwt.sign(
      { uid: user._id.toString() },
      config.JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    reply.setCookie('token', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30
    });
    
    reply.redirect('/dashboard');
  });

  // Helper para iniciar sesión social
  async function iniciarSesionComo(email, reply) {
    email = email.toLowerCase();
    let user = await User.findOne({ email });
    
    if (!user) {
      const apiKey = generateApiKey();
      user = await User.create({ email, apiKey, authProvider: 'google' });
    }
    
    const token = jwt.sign(
      { uid: user._id.toString() },
      config.JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    reply.setCookie('token', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30
    });
    
    reply.redirect('/dashboard');
  }

  // Google OAuth callback
  if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
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
  }

  // GitHub OAuth callback
  if (config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET) {
    fastify.get('/auth/github/callback', async (req, reply) => {
      try {
        const { token } = await fastify.githubOAuth2.getAccessTokenFromAuthorizationCodeFlow(req);
        const headers = {
          Authorization: `Bearer ${token.access_token}`,
          'User-Agent': 'AlexScraperAPI'
        };
        
        const { data: perfil } = await axios.get('https://api.github.com/user', { headers });
        let email = perfil.email;
        
        if (!email) {
          const { data: emails } = await axios.get('https://api.github.com/user/emails', { headers });
          email = (emails.find(e => e.primary) || emails[0])?.email;
        }
        
        if (!email) {
          throw new Error('GitHub no devolvió un correo.');
        }
        
        await iniciarSesionComo(email, reply);
      } catch (e) {
        reply.redirect('/login?error=github');
      }
    });
  }

  // Logout
  fastify.get('/logout', (req, reply) => {
    reply.clearCookie('token', { path: '/' });
    reply.redirect('/login');
  });

  // Dashboard
  fastify.get('/dashboard', { preHandler: requireLogin }, async (req, reply) => {
    const user = req.currentUser;
    user.refreshPlan();
    await user.save();
    
    const limit = user.plan === 'premium' ? 'Ilimitadas' : config.FREE_LIMIT;
    
    reply.view('dashboard.ejs', {
      email: user.email,
      apiKey: user.apiKey,
      plan: user.plan,
      requestsUsed: user.requestsUsed,
      limit,
      premiumUntil: user.premiumUntil,
      paypalEmail: config.PAYPAL_BUSINESS_EMAIL,
      baseUrl: `${req.protocol}://${req.hostname}`,
      esAdmin: user.email.toLowerCase() === config.ADMIN_EMAIL
    });
  });

  // Admin panel
  fastify.get('/admin', { preHandler: requireAdmin }, async (req, reply) => {
    const usuarios = await User.find({}).sort({ createdAt: -1 });
    reply.view('admin.ejs', {
      usuarios,
      adminEmail: req.currentUser.email
    });
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

  // Endpoints playground
  const ENDPOINT_LIST = [
    { id: 'tiktok', name: 'TikTok Downloader', path: '/api/v1/download/tiktok', param: 'url', placeholder: 'https://vm.tiktok.com/xxxxx/', desc: 'Descarga video de TikTok sin marca de agua.' },
    { id: 'youtube', name: 'YouTube Search / Info', path: '/api/v1/search/youtube', param: 'q', placeholder: 'daddy yankee gasolina — o pega un enlace de YouTube', desc: 'Busca videos por texto, o pega un enlace de YouTube directo.' },
    { id: 'youtubeMp4', name: 'YouTube MP4 (Video)', path: '/api/v1/download/youtube-mp4', param: 'q', placeholder: 'daddy yankee gasolina', desc: 'Descarga el video en su mejor calidad.' },
    { id: 'youtubeMp3', name: 'YouTube MP3 (Audio)', path: '/api/v1/download/youtube-mp3', param: 'q', placeholder: 'daddy yankee gasolina', desc: 'Descarga solo el audio.' },
    { id: 'facebook', name: 'Facebook Downloader', path: '/api/v1/download/facebook', param: 'url', placeholder: 'https://www.facebook.com/.../videos/...', desc: 'Descarga video de Facebook.' },
    { id: 'twitter', name: 'Twitter / X Downloader', path: '/api/v1/download/twitter', param: 'url', placeholder: 'https://twitter.com/user/status/12345', desc: 'Descarga video de un tweet.' },
    { id: 'pinterest', name: 'Pinterest Downloader', path: '/api/v1/download/pinterest', param: 'url', placeholder: 'https://pin.it/xxxxx', desc: 'Descarga contenido de Pinterest.' },
    { id: 'gmaps', name: 'Google Maps Scraper', path: '/api/v1/scraper/gmaps', param: 'query', placeholder: 'restaurantes en CDMX', desc: 'Busca negocios en Google Maps.' },
    { id: 'identify', name: 'Identificador de Contenido', path: '/api/v1/identify', param: 'url', placeholder: 'Enlace de TikTok, YouTube, Facebook...', desc: 'Identifica si un enlace es video o audio.' },
    { id: 'qr', name: 'Generador de código QR', path: '/api/v1/tools/qr', param: 'q', placeholder: 'https://mi-sitio.com', desc: 'Genera un código QR.' },
    { id: 'acortar', name: 'Acortador de URLs', path: '/api/v1/tools/acortar', param: 'q', placeholder: 'https://un-link-muy-largo.com/xyz123', desc: 'Acorta cualquier link.' },
    { id: 'traducir', name: 'Traductor de Texto', path: '/api/v1/tools/traducir', param: 'q', placeholder: 'hola amigo|en', desc: 'Traduce texto.' },
    { id: 'clima', name: 'Clima Actual', path: '/api/v1/tools/clima', param: 'q', placeholder: 'Ciudad de México', desc: 'Clima en tiempo real.' },
    { id: 'password', name: 'Generador de Contraseñas', path: '/api/v1/tools/password', param: 'q', placeholder: '16', desc: 'Genera contraseña segura.' },
    { id: 'animeFrase', name: 'Frase de Anime', path: '/api/v1/anime/frase', param: 'q', placeholder: '(no necesita nada)', desc: 'Frase random de anime.' },
    { id: 'animeReaccion', name: 'Reacción Anime (GIF)', path: '/api/v1/anime/reaccion', param: 'q', placeholder: 'hug, pat, wave...', desc: 'GIF de reacción anime.' },
    { id: 'animeImagen', name: 'Imagen Anime (Waifu)', path: '/api/v1/anime/imagen', param: 'q', placeholder: 'waifu, neko, shinobu', desc: 'Imagen de anime SFW.' },
    { id: 'ghibli', name: 'Studio Ghibli Info', path: '/api/v1/anime/ghibli', param: 'q', placeholder: 'Totoro, Chihiro', desc: 'Info de películas de Ghibli.' },
    { id: 'animeMeme', name: 'Meme de Anime', path: '/api/v1/anime/meme', param: 'q', placeholder: '(no necesita nada)', desc: 'Meme random de anime.' }
  ];

  fastify.get('/endpoints', { preHandler: requireLogin }, async (req, reply) => {
    reply.view('endpoints.ejs', {
      endpoints: ENDPOINT_LIST,
      apiKey: req.currentUser.apiKey,
      baseUrl: `${req.protocol}://${req.hostname}`
    });
  });
}