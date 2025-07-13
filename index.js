import 'dotenv/config';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { MongoClient } from 'mongodb';
import cron from 'node-cron';

// --- CONFIGURACIÓN ---
const { GEMINI_API_KEY, MONGO_URI } = process.env;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const mongoClient = new MongoClient(MONGO_URI, { autoSelectFamily: false });

const ARTIST_LIST = [
    "Eva Yerbabuena", "Marina Heredia", "Estrella Morente", "Sara Baras", "Argentina",
    "Rocío Márquez", "María Terremoto", "María Canea", "Farruquito", "Pedro El Granaíno",
    "Miguel Poveda", "Antonio Reyes", "Rancapino Chico", "Jesús Méndez", "Arcángel",
    "Jeromo Segura", "El Torombo", "Rafael Riqueni", "Israel Fernández", "Pepe Torres",
    "Israel Galván", "David Palomar", "Antonio 'El Farru'", "Juan Carlos Romero",
    "Antonio Rey", "Tomatito", "Moraíto Chico", "José Mercé", "Patricia Guerrero"
];

// 1. PROMPT REFINADO CON LA TÉCNICA DEL EJEMPLO ("ONE-SHOT")
// Le mostramos a la IA exactamente cómo debe responder en ambos casos: cuando encuentra algo y cuando no.
const eventPromptTemplate = (artistName) => `
Tu tarea es actuar como un experto en flamenco y buscar eventos futuros del artista proporcionado. Tu respuesta DEBE ser exclusivamente un array JSON.

EJEMPLO DE RESPUESTA SI ENCUENTRAS EVENTOS:
[
  {
    "id": "ejemplo-artista-ciudad-2025-10-26",
    "name": "Ejemplo de Concierto",
    "artist": "Artista Ejemplo",
    "description": "Descripción del concierto de ejemplo.",
    "date": "2025-10-26",
    "time": "21:00",
    "venue": "Teatro Ejemplo",
    "city": "Ciudad Ejemplo",
    "country": "País Ejemplo",
    "verified": true
  }
]

EJEMPLO DE RESPUESTA SI NO ENCUENTRAS NINGÚN EVENTO:
[]

BAJO NINGUNA CIRCUNSTANCIA respondas con texto normal o explicaciones. Solo el array JSON.

Ahora, por favor, proporciona la información para el siguiente artista: "${artistName}"
`;


const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAndSaveEvents() {
    console.log("Iniciando ciclo de búsqueda con PROMPT MEJORADO...");
    
    try {
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            generationConfig: { responseMimeType: "application/json" },
        });

        await mongoClient.connect();
        console.log("✅ Conexión a MongoDB establecida.");
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");

        for (const artist of ARTIST_LIST) {
            try {
                console.log(`Buscando conciertos para: "${artist}"...`);
                const result = await model.generateContent(eventPromptTemplate(artist));
                const response = await result.response;
                const textResponse = response.text();
                
                const events = JSON.parse(textResponse);
                
                if (Array.isArray(events) && events.length > 0) {
                    for (const event of events) {
                        await eventsCollection.updateOne({ id: event.id }, { $set: event }, { upsert: true });
                    }
                    console.log(`👍 Se procesaron ${events.length} conciertos para "${artist}".`);
                } else {
                    console.log(`ℹ️ No se encontraron nuevos conciertos para "${artist}".`);
                }
            } catch (error) {
                // Ahora que forzamos JSON, un error de parseo es menos probable, pero lo mantenemos.
                console.error(`❌ Error procesando la búsqueda para "${artist}":`, error.message);
            } finally {
                console.log("Pausando por 30 segundos...");
                await delay(30000); 
            }
        }

    } catch (error) {
        console.error("💥 ERROR FATAL en el worker: ", error);
    } finally {
        await mongoClient.close();
        console.log("🔌 Conexión a MongoDB cerrada. Ciclo finalizado.");
    }
}

cron.schedule('0 3 * * *', () => { fetchAndSaveEvents(); }, { scheduled: true, timezone: "Europe/Madrid" });

console.log("Worker con PROMPT MEJORADO iniciado. Ejecutando una vez para la prueba...");
fetchAndSaveEvents();