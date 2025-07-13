import 'dotenv/config';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { MongoClient } from 'mongodb';
import cron from 'node-cron';

// --- CONFIGURACIÓN ---
const { GEMINI_API_KEY, MONGO_URI } = process.env;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const mongoClient = new MongoClient(MONGO_URI, { autoSelectFamily: false });

const BATCH_OF_QUERIES = [
  "conciertos guitarra flamenca España",
  "gira Miguel Poveda",
  "conciertos de cante jondo",
  "festivales de verano flamenco 2025",
  "Israel Fernández conciertos",
  "Vicente Sordera 'El Sordera' recitales"
];

// 1. MEJORA EN EL PROMPT: Le damos instrucciones explícitas sobre qué hacer si no encuentra nada.
const eventPromptTemplate = (query) => `Busca CONCIERTOS y RECITALES de flamenco futuros y verificables en Europa sobre "${query}" y devuelve el resultado como un array JSON. Prioriza eventos en teatros, auditorios y festivales importantes. La estructura por evento debe ser: { "id": "slug-unico-y-descriptivo", "name": "...", "artist": "...", "description": "...", "date": "YYYY-MM-DD", "time": "HH:MM", "venue": "...", "city": "...", "country": "...", "verified": boolean }. Si no encuentras ningún evento que coincida con la búsqueda, es MUY IMPORTANTE que devuelvas un array JSON vacío, es decir, '[]'. No devuelvas frases explicativas.`;

// Función para pausas
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAndSaveEvents() {
    console.log("Iniciando ciclo de búsqueda de conciertos MEJORADO...");
    
    try {
        await mongoClient.connect();
        console.log("✅ Conexión a MongoDB establecida.");
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        for (const query of BATCH_OF_QUERIES) {
            try {
                console.log(`Buscando conciertos para: "${query}"...`);
                const result = await model.generateContent(eventPromptTemplate(query));
                const response = await result.response;
                let textResponse = response.text().trim();

                // 2. MEJORA EN EL CÓDIGO: Añadimos una salvaguarda.
                // Antes de intentar interpretar el texto, nos aseguramos de que parece un JSON.
                if (!textResponse.startsWith('[') && !textResponse.startsWith('{')) {
                  console.log(`❕ La respuesta para "${query}" no es un JSON. Omitiendo. Respuesta recibida: "${textResponse}"`);
                  // Saltamos al siguiente elemento del bucle sin hacer nada más.
                  continue; 
                }
                
                // Limpiamos los ```json que a veces añade la IA
                textResponse = textResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                
                const events = JSON.parse(textResponse);
                
                // Comprobamos que es un array y tiene contenido antes de seguir
                if (Array.isArray(events) && events.length > 0) {
                    for (const event of events) {
                        await eventsCollection.updateOne({ id: event.id }, { $set: event }, { upsert: true });
                    }
                    console.log(`👍 Se procesaron ${events.length} conciertos para "${query}".`);
                } else {
                    console.log(`ℹ️ No se encontraron nuevos conciertos para "${query}".`);
                }
            } catch (error) {
                console.error(`❌ Error procesando la búsqueda "${query}":`, error.message);
            } finally {
                console.log("Pausando por 25 segundos...");
                await delay(25000); 
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
cron.schedule('0 3 * * *', () => {
    fetchAndSaveEvents();
}, {
    scheduled: true,
    timezone: "Europe/Madrid"
});

console.log("Worker MEJORADO iniciado. Esperando a la próxima ejecución programada (3 AM).");
console.log("Ejecutando una vez ahora para la prueba inicial...");
fetchAndSaveEvents();