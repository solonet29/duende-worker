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

// 1. LISTA DE BÚSQUEDAS GENERALES AMPLIADA
// Hemos añadido más tipos de eventos y lugares para "echar una red más grande".
const GENERAL_QUERIES = [
    "espectáculos de flamenco en tablaos de Madrid",
    "programación de flamenco en teatros de Barcelona",
    "noches de flamenco en cuevas del Sacromonte Granada",
    "festivales de flamenco en Andalucía verano 2025",
    "conciertos de guitarra flamenca en Jerez",
    "espectáculo flamenco en París",
    "conciertos de flamenco en Londres",
    "peñas flamencas en Sevilla",
    "ciclos de flamenco en Córdoba",
    "zambombas flamencas en Navidad Jerez"
];

const ALL_QUERIES = [...ARTIST_LIST, ...GENERAL_QUERIES];

// 2. NUEVO PROMPT MENOS RESTRICTIVO Y MÁS AMPLIO
// Le pedimos que incluya todo tipo de eventos y que si no está seguro, lo marque como no verificado.
const eventPromptTemplate = (query) => `Actúa como un investigador exhaustivo de la escena flamenca. Tu única tarea es buscar CUALQUIER tipo de evento de flamenco futuro (próximos 12 meses) sobre el siguiente tema o artista: "${query}" en Europa. Esto incluye grandes conciertos, actuaciones en tablaos, recitales en peñas y festivales. Si la información parece plausible pero no está 100% confirmada, inclúyela de todas formas y pon el campo "verified" en false. Tu respuesta debe ser obligatoriamente un array en formato JSON. Si no encuentras absolutamente nada, devuelve un array JSON vacío: []. No incluyas texto o explicaciones. La estructura para cada evento es: { "id": "slug-unico", "name": "...", "artist": "Artista/s principal/es o 'Varios Artistas'", "description": "...", "date": "YYYY-MM-DD", "time": "HH:MM", "venue": "...", "city": "...", "country": "...", "verified": boolean }`;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAndSaveEvents() {
    console.log("Iniciando ciclo de búsqueda AMPLIA...");
    
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
                let textResponse = response.text().trim();
                
                if (!textResponse.startsWith('[') && !textResponse.startsWith('{')) {
                  console.log(`❕ La respuesta para "${query}" no es un JSON. Omitiendo.`);
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
                await delay(2000); // Ya que estamos en plan de pago, bajamos la pausa a 2s
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

console.log("Worker 'Radar Flamenco' iniciado. Ejecutando una vez para la prueba...");
fetchAndSaveEvents();