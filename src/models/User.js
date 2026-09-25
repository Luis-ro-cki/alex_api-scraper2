// src/models/User.js
import mongoose from 'mongoose';
import { config } from '../config.js';

const userSchema = new mongoose.Schema({
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true, 
    trim: true 
  },
  passwordHash: { 
    type: String, 
    default: null 
  },
  authProvider: { 
    type: String, 
    enum: ['local', 'google', 'github'], 
    default: 'local' 
  },
  apiKey: { 
    type: String, 
    required: true, 
    unique: true 
  },
  plan: { 
    type: String, 
    enum: ['free', 'premium'], 
    default: 'free' 
  },
  requestsUsed: { 
    type: Number, 
    default: 0 
  },
  periodStart: { 
    type: Date, 
    default: Date.now 
  },
  premiumUntil: { 
    type: Date, 
    default: null 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Método para refrescar el plan
userSchema.methods.refreshPlan = function() {
  const now = new Date();
  
  // Expirar premium si ya pasó la fecha
  if (this.plan === 'premium' && this.premiumUntil && this.premiumUntil < now) {
    this.plan = 'free';
    this.premiumUntil = null;
    this.requestsUsed = 0;
    this.periodStart = now;
    return true;
  }
  
  // Renovar contador semanal para plan free
  if (this.plan === 'free' && (now - this.periodStart) >= config.WEEK_MS) {
    this.requestsUsed = 0;
    this.periodStart = now;
    return true;
  }
  
  return false;
};

// Método para verificar si puede hacer más requests
userSchema.methods.canMakeRequest = function() {
  const limit = this.plan === 'premium' ? Infinity : config.FREE_LIMIT;
  return this.requestsUsed < limit;
};

export const User = mongoose.model('User', userSchema);