import 'dotenv/config';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { MongoClient } from 'mongodb';
import cron from 'node-cron';

// --- CONFIGURACIÓN ---
const { GEMINI_API_KEY, MONGO_URI } = process.env;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const mongoClient = new MongoClient(MONGO_URI, { autoSelectFamily: false });

// 1. EL CORAZÓN DE NUESTRO WORKER: TU LISTA DE ARTISTAS
// A partir de ahora, todas las búsquedas se basarán en esta lista.
// Dejamos solo un artista para una prueba segura
const ARTIST_LIST = [
    "Pedro El Granaíno"
];
// 2. PROMPT ADAPTADO A LA BÚSQUEDA POR ARTISTA
const eventPromptTemplate = (artistName) => `Busca conciertos, recitales o actuaciones importantes del artista de flamenco "${artistName}" para los próximos 12 meses en Europa. Devuelve el resultado como un array JSON. Prioriza eventos en teatros, auditorios y festivales. Si no encuentras ningún evento futuro para este artista, es MUY IMPORTANTE que devuelvas un array JSON vacío, es decir, '[]'. No devuelvas frases explicativas. La estructura por evento debe ser: { "id": "slug-unico-y-descriptivo", "name": "...", "artist": "${artistName}", "description": "...", "date": "YYYY-MM-DD", "time": "HH:MM", "venue": "...", "city": "...", "country": "...", "verified": boolean }`;

// Función para pausas
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAndSaveEvents() {
    console.log("Iniciando ciclo de búsqueda de conciertos por ARTISTA...");
    
    try {
        await mongoClient.connect();
        console.log("✅ Conexión a MongoDB establecida.");
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // 3. EL BUCLE AHORA RECORRE LA LISTA DE ARTISTAS
        for (const artist of ARTIST_LIST) {
            try {
                console.log(`Buscando conciertos para: "${artist}"...`);
                const result = await model.generateContent(eventPromptTemplate(artist));
                const response = await result.response;
                let textResponse = response.text().trim();

                if (!textResponse.startsWith('[') && !textResponse.startsWith('{')) {
                  console.log(`❕ La respuesta para "${artist}" no es un JSON. Omitiendo.`);
                  continue; 
                }
                
                textResponse = textResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
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
                console.error(`❌ Error procesando la búsqueda para "${artist}":`, error.message);
            } finally {
                console.log("Pausando por 30 segundos para no superar la cuota...");
                await delay(30000); // Aumentamos la pausa a 30 segundos para mayor seguridad
            }
        }

    } catch (error) {
        console.error("💥 ERROR FATAL en el worker: ", error);
    } finally {
        await mongoClient.close();
        console.log("🔌 Conexión a MongoDB cerrada. Ciclo finalizado.");
    }
}

// --- EJECUCIÓN PROGRAMADA Y PRUEBA INICIAL ---
cron.schedule('0 3 * * *', () => {
    fetchAndSaveEvents();
}, {
    scheduled: true,
    timezone: "Europe/Madrid"
});

console.log("Worker por ARTISTAS iniciado. Ejecutando una vez para la prueba inicial...");
fetchAndSaveEvents();