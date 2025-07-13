import 'dotenv/config';
// 1. IMPORTAMOS LAS HERRAMIENTAS NECESARIAS
import { GoogleGenerativeAI, GoogleSearchRetriever } from "@google/generative-ai";
import { MongoClient } from 'mongodb';
import cron from 'node-cron';

// --- CONFIGURACIÓN ---
const { GEMINI_API_KEY, MONGO_URI } = process.env;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const mongoClient = new MongoClient(MONGO_URI, { autoSelectFamily: false });

// 2. CREAMOS LA HERRAMIENTA DE BÚSQUEDA
const searchTool = new GoogleSearchRetriever();

const ARTIST_LIST = [
    "Eva Yerbabuena", "Marina Heredia", "Estrella Morente", "Sara Baras", "Argentina",
    "Rocío Márquez", "María Terremoto", "Farruquito", "Pedro El Granaíno", "Miguel Poveda",
    "Antonio Reyes", "Rancapino Chico", "Jesús Méndez", "Arcángel", "Israel Fernández"
]; // He acortado la lista para que las pruebas sean más rápidas

const eventPromptTemplate = (artistName) => `Usando tus herramientas de búsqueda si es necesario, busca conciertos, recitales o actuaciones importantes del artista de flamenco "${artistName}" para los próximos 12 meses en Europa. Devuelve el resultado como un array JSON. Prioriza eventos en teatros, auditorios y festivales importantes. Si, incluso después de buscar, no encuentras ningún evento futuro para este artista, devuelve un array JSON vacío, es decir, '[]'. La estructura por evento debe ser: { "id": "slug-unico-y-descriptivo", "name": "...", "artist": "${artistName}", "description": "...", "date": "YYYY-MM-DD", "time": "HH:MM", "venue": "...", "city": "...", "country": "...", "verified": boolean }`;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAndSaveEvents() {
    console.log("Iniciando ciclo de búsqueda con GOOGLE SEARCH...");
    
    try {
        // 3. INICIALIZAMOS EL MODELO CON LA HERRAMIENTA DE BÚSQUEDA
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-pro", // Usamos el modelo Pro, que funciona mejor con herramientas
            tools: [searchTool],
        });

        await mongoClient.connect();
        console.log("✅ Conexión a MongoDB establecida.");
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");

        for (const artist of ARTIST_LIST) {
            try {
                console.log(`Buscando conciertos para: "${artist}"...`);
                // La llamada a generateContent no cambia
                const result = await model.generateContent(eventPromptTemplate(artist));
                const response = await result.response;
                
                // La respuesta ahora puede ser más compleja, la parseamos con cuidado
                if (response.functionCalls) {
                    // Si la IA usó una herramienta, aquí procesaríamos la respuesta.
                    // Para este caso, el modelo integra la búsqueda automáticamente.
                }
                
                const textResponse = response.text().trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');

                if (!textResponse.startsWith('[') && !textResponse.startsWith('{')) {
                  console.log(`❕ La respuesta para "${artist}" no es un JSON. Omitiendo.`);
                  continue; 
                }

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

// --- EJECUCIÓN ---
cron.schedule('0 3 * * *', () => { fetchAndSaveEvents(); }, { scheduled: true, timezone: "Europe/Madrid" });

console.log("Worker con GOOGLE SEARCH iniciado. Ejecutando una vez para la prueba...");
fetchAndSaveEvents();