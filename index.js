import 'dotenv/config';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { MongoClient } from 'mongodb';
import cron from 'node-cron';

// Configuración
const { GEMINI_API_KEY, MONGO_URI } = process.env;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const mongoClient = new MongoClient(MONGO_URI, { autoSelectFamily: false });

// 1. HEMOS CAMBIADO LAS BÚSQUEDAS PARA ENFOCARLAS EN CONCIERTOS
const BATCH_OF_QUERIES = [
  "conciertos guitarra flamenca España", 
  "gira Miguel Poveda", 
  "conciertos de cante jondo", 
  "festivales de verano flamenco 2025", 
  "Israel Fernández conciertos",
  "Vicente Sordera 'El Sordera' recitales"
];

// 2. HEMOS REFINADO EL PROMPT PARA PRIORIZAR CONCIERTOS
const eventPromptTemplate = (query) => `Busca CONCIERTOS y RECITALES de flamenco futuros en Europa sobre "${query}" y devuelve el resultado como un array JSON. Prioriza eventos en teatros, auditorios y festivales sobre actuaciones regulares en tablaos. La estructura por evento debe ser: { "id": "slug-unico", "name": "...", "artist": "...", "description": "...", "date": "YYYY-MM-DD", "time": "HH:MM", "venue": "...", "city": "...", "country": "...", "verified": boolean }`;

// Pequeña función para crear pausas
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAndSaveEvents() {
    console.log("Iniciando ciclo de búsqueda de conciertos...");
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    for (const query of BATCH_OF_QUERIES) {
        try {
            console.log(`Buscando conciertos para: "${query}"...`);
            const result = await model.generateContent(eventPromptTemplate(query));
            const response = await result.response;
            const textResponse = response.text().trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');

            const events = JSON.parse(textResponse);
            if (Array.isArray(events) && events.length > 0) {
                await mongoClient.connect();
                const db = mongoClient.db("DuendeDB");
                const eventsCollection = db.collection("events");

                for (const event of events) {
                    await eventsCollection.updateOne({ id: event.id }, { $set: event }, { upsert: true });
                }
                console.log(`✅ Se procesaron ${events.length} conciertos para "${query}".`);
            }
        } catch (error) {
            console.error(`❌ Error procesando la búsqueda "${query}":`, error.message);
        } finally {
            await mongoClient.close();
            console.log("Pausando por 20 segundos para no superar la cuota...");
            await delay(20000); // Aumentamos la pausa a 20 segundos para ser más cuidadosos
        }
    }
    console.log("Ciclo de búsqueda de conciertos finalizado.");
}

// Programar la tarea para que se ejecute todos los días a las 3 AM
cron.schedule('0 3 * * *', () => {
    fetchAndSaveEvents();
}, {
    scheduled: true,
    timezone: "Europe/Madrid"
});

console.log("Worker de conciertos iniciado. Ejecutando una vez para la prueba inicial...");
fetchAndSaveEvents();