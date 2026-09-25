// src/scrapers/anime.js
import { httpClient, conReintentos } from '../utils/helpers.js';

/**
 * Frase random de anime
 */
export async function scraperAnimeQuote() {
  return conReintentos(async () => {
    let data;
    try {
      ({ data } = await httpClient.get('https://api.animechan.io/v1/quotes/random'));
    } catch (e) {
      throw new Error(`El servicio de frases de anime no respondió: ${e.message}`);
    }
    
    const q = data?.data || data;
    if (!q?.content) {
      throw new Error('No se pudo obtener una frase en este momento.');
    }
    
    return {
      frase: q.content,
      personaje: q.character?.name || 'Desconocido',
      anime: q.anime?.name || 'Desconocido'
    };
  });
}

/**
 * GIF de reacción anime
 */
export async function scraperAnimeReaccion(tipo) {
  const valido = [
    'baka', 'bite', 'blush', 'bored', 'cry', 'cuddle', 'dance', 
    'facepalm', 'feed', 'handhold', 'happy', 'highfive', 'hug', 
    'kick', 'kiss', 'laugh', 'pat', 'poke', 'pout', 'punch', 
    'shrug', 'slap', 'sleep', 'smile', 'smug', 'stare', 'think', 
    'thumbsup', 'tickle', 'wave', 'wink', 'yeet'
  ];
  
  const t = (tipo || 'hug').toLowerCase().trim();
  if (!valido.includes(t)) {
    throw new Error(`Tipo no válido. Usa uno de: ${valido.join(', ')}`);
  }
  
  return conReintentos(async () => {
    let data;
    try {
      ({ data } = await httpClient.get(`https://nekos.best/api/v2/${t}`));
    } catch (e) {
      throw new Error(`El servicio de reacciones no respondió: ${e.message}`);
    }
    
    const resultado = data?.results?.[0];
    if (!resultado?.url) {
      throw new Error('No se encontró una imagen para ese tipo.');
    }
    
    return {
      tipo: t,
      gif_url: resultado.url,
      anime: resultado.anime_name || null
    };
  });
}

/**
 * Imagen de anime (waifu, neko, etc)
 */
export async function scraperAnimeImagen(tipo) {
  const valido = [
    'waifu', 'neko', 'shinobu', 'megumin', 'bully', 'cuddle', 'cry', 
    'hug', 'awoo', 'kiss', 'lick', 'pat', 'smug', 'blush', 'smile', 
    'wave', 'highfive', 'handhold', 'nom', 'bite', 'glomp', 'slap', 
    'happy', 'wink', 'poke', 'dance'
  ];
  
  const t = (tipo || 'waifu').toLowerCase().trim();
  if (!valido.includes(t)) {
    throw new Error(`Tipo no válido. Usa uno de: ${valido.join(', ')}`);
  }
  
  return conReintentos(async () => {
    let data;
    try {
      ({ data } = await httpClient.get(`https://api.waifu.pics/sfw/${t}`));
    } catch (e) {
      throw new Error(`El servicio de imágenes no respondió: ${e.message}`);
    }
    
    if (!data?.url) {
      throw new Error('No se encontró una imagen para ese tipo.');
    }
    
    return {
      tipo: t,
      imagen_url: data.url
    };
  });
}

/**
 * Info de películas de Studio Ghibli
 */
export async function scraperGhibli(nombre) {
  const nombreValidado = nombre ? nombre.toLowerCase().trim() : '';
  if (!nombreValidado) {
    throw new Error('Falta el nombre de la película de Studio Ghibli.');
  }
  
  return conReintentos(async () => {
    let data;
    try {
      ({ data } = await httpClient.get('https://ghibliapi.vercel.app/films'));
    } catch (e) {
      throw new Error('El servicio de Studio Ghibli no respondió. Intenta de nuevo.');
    }
    
    const pelicula = (data || []).find(f => 
      f.title.toLowerCase().includes(nombreValidado)
    );
    
    if (!pelicula) {
      throw new Error('No se encontró ninguna película de Studio Ghibli con ese nombre.');
    }
    
    return {
      titulo: pelicula.title,
      titulo_japones: pelicula.original_title,
      director: pelicula.director,
      año: pelicula.release_date,
      sinopsis: pelicula.description,
      puntuacion: pelicula.rt_score,
      imagen: pelicula.image
    };
  });
}

/**
 * Meme de anime random
 */
export async function scraperAnimeMeme() {
  return conReintentos(async () => {
    let data;
    try {
      ({ data } = await httpClient.get('https://meme-api.com/gimme/wholesomeanimemes'));
    } catch (e) {
      throw new Error(`El servicio de memes no respondió: ${e.message}`);
    }
    
    if (!data?.url) {
      throw new Error('No se encontró ningún meme en este momento.');
    }
    
    return {
      titulo: data.title,
      imagen_url: data.url,
      autor: data.author,
      likes: data.ups
    };
  });
}