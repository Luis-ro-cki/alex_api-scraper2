// src/config.js
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  __dirname,
  rootDir: path.join(__dirname, '..'),
  viewsDir: path.join(__dirname, '..', 'views'),
  
  // MongoDB
  MONGODB_URI: process.env.MONGODB_URI,
  
  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'cambia-esto-en-produccion',
  
  // PayPal
  PAYPAL_BUSINESS_EMAIL: 'l29472954@gmail.com',
  PAYPAL_IPN_URL: 'https://ipnpb.paypal.com/cgi-bin/webscr',
  
  // Admin
  ADMIN_EMAIL: (process.env.ADMIN_EMAIL || 'l29472954@gmail.com').toLowerCase(),
  
  // OAuth
  APP_URL: process.env.APP_URL || 'https://alex-api-scraper2-1.onrender.com',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
  
  // Planes
  WEEK_MS: 7 * 24 * 60 * 60 * 1000,
  MONTH_MS: 30 * 24 * 60 * 60 * 1000,
  FREE_LIMIT: 3000,
  
  // Server
  PORT: process.env.PORT || 3000,
  HOST: '0.0.0.0'
};

// Validación crítica al iniciar
if (!config.MONGODB_URI) {
  console.error('❌ FALTA: MONGODB_URI en variables de entorno de Render');
}