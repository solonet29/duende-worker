import 'dotenv/config';
// Corregimos el nombre de la librería en el import
import { GoogleGenerativeAI } from "@google/generative-ai";
import { MongoClient } from 'mongodb';
import cron from 'node-cron';

// Configuración
const { GEMINI_API_KEY, MONGO_URI } = process.env;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// Añadimos la opción de conexión para mayor estabilidad
const mongoClient = new MongoClient(MONGO_URI, { autoSelectFamily: false });
const BATCH_OF_QUERIES = ["flamenco en Madrid", "festivales de flamenco en Andalucía", "Tomatito", "Vicente Amigo conciertos", "tablaos en Sevilla"];

// El prompt que le daremos a Gemini
const eventPromptTemplate = (query) => `Busca eventos de flamenco futuros en Europa sobre "${query}" y devuelve el resultado como un array JSON. La estructura por evento debe ser: { "id": "slug-unico", "name": "...", "artist": "...", "description": "...", "date": "YYYY-MM-DD", "time": "HH:MM", "venue": "...", "city": "...", "country": "...", "verified": boolean }`;

// Pequeña función para crear pausas
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAndSaveEvents() {
    console.log("Iniciando ciclo de búsqueda de eventos...");
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    for (const query of BATCH_OF_QUERIES) {
        try {
            console.log(`Buscando eventos para: "${query}"...`);
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
                console.log(`✅ Se procesaron ${events.length} eventos para "${query}".`);
            }
        } catch (error) {
            console.error(`❌ Error procesando la búsqueda "${query}":`, error.message);
        } finally {
            // Nos aseguramos de cerrar la conexión
            await mongoClient.close();
            // Hacemos una pausa para respetar los límites de la API
            console.log("Pausando por 2 segundos...");
            await delay(2000); 
        }
    }
    console.log("Ciclo de búsqueda de eventos finalizado.");
}

// Programar la tarea para que se ejecute todos los días a las 3 AM
cron.schedule('0 3 * * *', () => {
    fetchAndSaveEvents();
}, {
    scheduled: true,
    timezone: "Europe/Madrid"
});

console.log("Worker iniciado. Esperando a la próxima ejecución programada (3 AM).");
console.log("Ejecutando una vez ahora para la prueba inicial...");
fetchAndSaveEvents(); // Ejecuta la función una vez al iniciar.
