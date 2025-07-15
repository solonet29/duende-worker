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
    "Rocío Márquez", "María Terremoto", "Farruquito", "Pedro El Granaíno", "Miguel Poveda",
    "Antonio Reyes", "Rancapino Chico", "Jesús Méndez", "Arcángel", "Israel Fernández"
];

// --- ¡AQUÍ ESTÁ LA MEJORA! ---
// Hemos añadido búsquedas específicas para ciudades europeas clave.
const GENERAL_QUERIES = [
    "espectáculos de flamenco en tablaos de Madrid",
    "programación de flamenco en teatros de Barcelona",
    "noches de flamenco en cuevas del Sacromonte Granada",
    "festivales de flamenco en Andalucía verano 2025",
    "conciertos de guitarra flamenca en Jerez",
    "espectáculos de flamenco en tablaos de sevilla",
    "espectáculos de flamenco en peñas flamencas",

    // NUEVAS BÚSQUEDAS EUROPEAS
    "espectáculo flamenco en París",
    "conciertos de flamenco en Londres",
    "noches de flamenco en Lisboa",
    "festival de flamenco de Nîmes 2025",
    "gira flamenca en Berlín"
];

const ALL_QUERIES = [...ARTIST_LIST, ...GENERAL_QUERIES];

const eventPromptTemplate = (query) => `Actúa como un agente de booking experto en flamenco. Tu única tarea es buscar en tu base de conocimiento eventos futuros (conciertos, recitales, festivales, actuaciones en tablaos) sobre el siguiente tema o artista: "${query}" en Europa. Tu respuesta debe ser obligatoriamente un array en formato JSON. Si encuentras eventos, inclúyelos en el array. Si no encuentras absolutamente ningún evento futuro y verificable, devuelve un array JSON vacío: []. No incluyas texto, explicaciones o disculpas, solo el array JSON. La estructura para cada evento es: { "id": "slug-unico", "name": "...", "artist": "...", "description": "...", "date": "YYYY-MM-DD", "time": "HH:MM", "venue": "...", "city": "...", "country": "...", "verified": boolean }`;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAndSaveEvents() {
    console.log("Iniciando ciclo de búsqueda HÍBRIDO (Artistas + General + Europa)...");
    
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
        await mongoClient.connect();
        console.log("✅ Conexión a MongoDB establecida.");
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");

        for (const query of ALL_QUERIES) {
            try {
                console.log(`Buscando eventos para: "${query}"...`);
                const result = await model.generateContent(eventPromptTemplate(query));
                const response = await result.response;
                const textResponse = response.text().trim();
                
                if (!textResponse.startsWith('[') && !textResponse.startsWith('{')) {
                  console.log(`❕ La respuesta para "${query}" no es un JSON. Omitiendo.`);
                  continue; 
                }

                const events = JSON.parse(textResponse);
                
                if (Array.isArray(events) && events.length > 0) {
                    for (const event of events) {
                        await eventsCollection.updateOne({ id: event.id }, { $set: event }, { upsert: true });
                    }
                    console.log(`👍 Se procesaron ${events.length} eventos para "${query}".`);
                } else {
                    console.log(`ℹ️ No se encontraron nuevos eventos para "${query}".`);
                }
            } catch (error) {
                console.error(`❌ Error procesando la búsqueda para "${query}":`, error.message);
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

console.log("Worker EUROPEO iniciado. Ejecutando una vez para la prueba...");
fetchAndSaveEvents();