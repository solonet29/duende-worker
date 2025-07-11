import 'dotenv/config';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { MongoClient } from 'mongodb';
import cron from 'node-cron';

// Configuración
const { GEMINI_API_KEY, MONGO_URI } = process.env;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const mongoClient = new MongoClient(MONGO_URI);
const BATCH_OF_QUERIES = ["flamenco en Madrid", "festivales de flamenco en Andalucía", "Tomatito", "Vicente Amigo conciertos", "tablaos en Sevilla"];

// El prompt que le daremos a Gemini
const eventPromptTemplate = (query) => `Busca eventos de flamenco futuros en Europa sobre "${query}" y devuelve el resultado como un array JSON. La estructura por evento debe ser: { "id": "slug-unico", "name": "...", "artist": "...", "description": "...", "date": "YYYY-MM-DD", "time": "HH:MM", "venue": "...", "city": "...", "country": "...", "verified": boolean }`;

async function fetchAndSaveEvents() {
    console.log("Iniciando ciclo de búsqueda de eventos...");
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    for (const query of BATCH_OF_QUERIES) {
        try {
            console.log(`Buscando eventos para: "${query}"...`);
            const result = await model.generateContent(eventPromptTemplate(query));
            const response = await result.response;
            const textResponse = response.text().trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');

            const events = JSON.parse(textResponse);
            if (Array.isArray(events) && events.length > 0) {
                // Conectar a la base de datos
                await mongoClient.connect();
                const db = mongoClient.db("DuendeDB"); // Nombre de tu base de datos
                const eventsCollection = db.collection("events"); // Nombre de la colección

                // Guardar cada evento (si no existe ya)
                for (const event of events) {
                    // 'upsert: true' significa: si un evento con este 'id' ya existe, actualízalo; si no, créalo.
                    await eventsCollection.updateOne({ id: event.id }, { $set: event }, { upsert: true });
                }
                console.log(`Se procesaron ${events.length} eventos para "${query}".`);
            }
        } catch (error) {
            console.error(`Error procesando la búsqueda "${query}":`, error);
        } finally {
            // Asegurarse de cerrar la conexión
            await mongoClient.close();
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
