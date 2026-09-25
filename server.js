// server.js
import Fastify from 'fastify';
import view from '@fastify/view';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import oauthPlugin from '@fastify/oauth2';
import ejs from 'ejs';
import path from 'path';
import { connectDatabase } from './src/database.js';
import { config } from './src/config.js';
import { registerWebRoutes } from './src/routes/web.js';
import { registerApiRoutes } from './src/routes/api.js';

const fastify = Fastify({
  logger: {
    level: 'info',
    transport: process.env.NODE_ENV !== 'production' ? {
      target: 'pino-pretty',
      options: { colorize: true }
    } : undefined
  }
});

// Registrar plugins
fastify.register(view, {
  engine: { ejs },
  root: config.viewsDir
});

fastify.register(cors, { origin: true });
fastify.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute'
});
fastify.register(cookie);
fastify.register(formbody);

// Configurar OAuth si hay credenciales
if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
  fastify.register(oauthPlugin, {
    name: 'googleOAuth2',
    scope: ['profile', 'email'],
    credentials: {
      client: {
        id: config.GOOGLE_CLIENT_ID,
        secret: config.GOOGLE_CLIENT_SECRET
      },
      auth: oauthPlugin.GOOGLE_CONFIGURATION
    },
    startRedirectPath: '/auth/google',
    callbackUri: `${config.APP_URL}/auth/google/callback`
  });
} else {
  console.log('ℹ️ Login con Google desactivado: faltan credenciales');
}

if (config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET) {
  fastify.register(oauthPlugin, {
    name: 'githubOAuth2',
    scope: ['user:email'],
    credentials: {
      client: {
        id: config.GITHUB_CLIENT_ID,
        secret: config.GITHUB_CLIENT_SECRET
      },
      auth: oauthPlugin.GITHUB_CONFIGURATION
    },
    startRedirectPath: '/auth/github',
    callbackUri: `${config.APP_URL}/auth/github/callback`
  });
} else {
  console.log('ℹ️ Login con GitHub desactivado: faltan credenciales');
}

// Manejador de errores global
fastify.setErrorHandler((error, req, reply) => {
  req.log.error(error);
  reply.code(500).send({
    status: false,
    message: error.message || "Error interno del servidor"
  });
});

// Registrar rutas
registerWebRoutes(fastify);
registerApiRoutes(fastify);

// Iniciar servidor
const start = async () => {
  try {
    await connectDatabase();
    await fastify.listen({ port: config.PORT, host: config.HOST });
    console.log(`🚀 ALEX SCRAPER API: RUNNING ON PORT ${config.PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();