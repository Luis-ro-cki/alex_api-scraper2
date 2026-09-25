// src/database.js
import mongoose from 'mongoose';
import { config } from './config.js';

export async function connectDatabase() {
  if (!config.MONGODB_URI) {
    console.error('❌ No se puede conectar a MongoDB: falta MONGODB_URI');
    return false;
  }

  try {
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ MongoDB conectado correctamente');
    return true;
  } catch (err) {
    console.error('❌ Error conectando a MongoDB:', err.message);
    return false;
  }
}