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

const GENERAL_QUERIES = [
    "espectáculos de flamenco en tablaos de Madrid", "programación de flamenco en teatros de Barcelona",
    "noches de flamenco en cuevas del Sacromonte Granada", "festivales de flamenco en Andalucía verano 2025",
    "conciertos de guitarra flamenca en Jerez", "espectáculo flamenco en París", "conciertos de flamenco en Londres"
];

const ALL_QUERIES = [...ARTIST_LIST, ...GENERAL_QUERIES];

// --- ¡AQUÍ ESTÁ LA MEJORA! PROMPT MÁS FLEXIBLE ---
const eventPromptTemplate = (query) => `Actúa como un documentalista de flamenco. Tu misión es encontrar la mayor cantidad posible de eventos futuros (próximos 12 meses) relacionados con la consulta: "${query}". Incluye conciertos, recitales, actuaciones en tablaos y festivales en Europa.
Tu respuesta debe ser SIEMPRE un array en formato JSON.
INSTRUCCIONES IMPORTANTES:
1.  Si no tienes un dato exacto, indícalo. Por ejemplo, si no sabes la hora, pon "Consultar web". Si no sabes el artista, pon "Varios Artistas".
2.  Lo más importante es que intentes devolver eventos aunque los datos no sean perfectos. Es preferible un evento con datos parciales a no devolver nada.
3.  Si después de tu mejor esfuerzo no encuentras NADA, devuelve un array JSON vacío: [].
La estructura para cada evento es: { "id": "slug-unico", "name": "...", "artist": "...", "description": "...", "date": "YYYY-MM-DD", "time": "HH:MM", "venue": "...", "city": "...", "country": "...", "verified": boolean }`;


const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAndSaveEvents() {
    console.log("Iniciando ciclo de búsqueda con IA FLEXIBLE...");
    
    try {
        // Volvemos a un modelo más simple, sin "tools", solo con el prompt.
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
                let textResponse = response.text().trim();
                
                // Mantenemos la salvaguarda por si la IA devuelve texto plano
                if (!textResponse.startsWith('[') && !textResponse.startsWith('{')) {
                  console.log(`❕ La respuesta para "${query}" no es un JSON. Omitiendo. Respuesta: "${textResponse}"`);
                  continue; 
                }

                let events = JSON.parse(textResponse);
                
                if (Array.isArray(events) && events.length > 0) {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0); 
                    const futureEvents = events.filter(event => new Date(event.date) >= today);

                    if (futureEvents.length > 0) {
                        for (const event of futureEvents) {
                            await eventsCollection.updateOne({ id: event.id }, { $set: event }, { upsert: true });
                        }
                        console.log(`👍 Se procesaron y guardaron ${futureEvents.length} conciertos futuros para "${query}".`);
                    } else {
                        console.log(`ℹ️ La IA devolvió eventos, pero todos eran pasados para "${query}".`);
                    }
                } else {
                    console.log(`ℹ️ No se encontraron nuevos conciertos para "${query}".`);
                }
            } catch (error) {
                console.error(`❌ Error procesando la búsqueda para "${query}":`, error.message);
            } finally {
                console.log("Pausando por 2 segundos...");
                await delay(2000); 
            }
        }
    } catch (error) {
        console.error("💥 ERROR FATAL en el worker: ", error);
    } finally {
        if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected()) {
            await mongoClient.close();
            console.log("🔌 Conexión a MongoDB cerrada. Ciclo finalizado.");
        }
    }
}

cron.schedule('0 3 * * *', () => { fetchAndSaveEvents(); }, { scheduled: true, timezone: "Europe/Madrid" });

console.log("Worker con IA FLEXIBLE iniciado. Ejecutando una vez para la prueba...");
fetchAndSaveEvents();