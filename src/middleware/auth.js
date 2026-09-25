// src/middleware/auth.js
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { config } from '../config.js';

/**
 * Middleware para requerir login en páginas web
 */
export async function requireLogin(req, reply) {
  const token = req.cookies.token;
  
  if (!token) {
    return reply.redirect('/login');
  }
  
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    const user = await User.findById(payload.uid);
    
    if (!user) {
      return reply.redirect('/login');
    }
    
    req.currentUser = user;
  } catch (err) {
    return reply.redirect('/login');
  }
}

/**
 * Middleware para requerir acceso de administrador
 */
export async function requireAdmin(req, reply) {
  await requireLogin(req, reply);
  
  if (reply.sent) return;
  
  if (req.currentUser.email.toLowerCase() !== config.ADMIN_EMAIL) {
    return reply.code(403).send({
      status: false,
      message: "No tienes acceso a esta sección."
    });
  }
}

/**
 * Middleware para validar API key en endpoints de la API
 */
export async function validateApiKey(req, reply) {
  if (!req.url.startsWith('/api/') || req.url.startsWith('/api/paypal/')) {
    return;
  }
  
  const key = req.query.apikey;
  
  if (!key) {
    return reply.code(401).send({
      status: false,
      message: "FALTA EL PARÁMETRO 'apikey'"
    });
  }
  
  // Buscar usuario por API key
  const user = await User.findOne({ apiKey: key });
  
  if (!user) {
    return reply.code(401).send({
      status: false,
      message: "API KEY INVÁLIDA"
    });
  }
  
  // Refrescar plan si es necesario
  const planRefreshed = user.refreshPlan();
  
  // Verificar límites
  if (!user.canMakeRequest()) {
    await user.save();
    return reply.code(429).send({
      status: false,
      message: user.plan === 'premium' 
        ? "LÍMITE ALCANZADO" 
        : `LÍMITE SEMANAL ALCANZADO (${config.FREE_LIMIT}/semana). Hazte premium para solicitudes ilimitadas.`
    });
  }
  
  // Incrementar contador
  user.requestsUsed++;
  await user.save();
  
  req.currentUser = user;
}