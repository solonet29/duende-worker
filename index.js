import 'dotenv/config';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { MongoClient } from 'mongodb';
import cron from 'node-cron';

// --- INICIO DEL CÓDIGO DE DIAGNÓSTICO ---
try {
  console.log("✅ PASO 1: Script iniciado. Leyendo variables de entorno...");

  const { GEMINI_API_KEY, MONGO_URI } = process.env;

  if (!GEMINI_API_KEY || !MONGO_URI) {
    console.error("❌ ERROR FATAL: Una o ambas variables de entorno (GEMINI_API_KEY, MONGO_URI) no están definidas.");
    throw new Error("Variables de entorno no encontradas.");
  }
  console.log("✅ PASO 2: Variables de entorno leídas correctamente.");

  console.log("  - Inicializando cliente de Gemini...");
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  console.log("✅ PASO 3: Cliente de Gemini inicializado.");

  console.log("  - Inicializando cliente de MongoDB...");
  const mongoClient = new MongoClient(MONGO_URI, { autoSelectFamily: false });
  console.log("✅ PASO 4: Cliente de MongoDB inicializado.");

  // --- FIN DEL CÓDIGO DE DIAGNÓSTICO ---


  const BATCH_OF_QUERIES = ["flamenco en Madrid", "festivales de flamenco en Andalucía", "Tomatito", "Vicente Amigo conciertos", "tablaos en Sevilla"];

  const eventPromptTemplate = (query) => `Busca eventos de flamenco futuros en Europa sobre "${query}" y devuelve el resultado como un array JSON. La estructura por evento debe ser: { "id": "slug-unico", "name": "...", "artist": "...", "description": "...", "date": "YYYY-MM-DD", "time": "HH:MM", "venue": "...", "city": "...", "country": "...", "verified": boolean }`;

  async function fetchAndSaveEvents() {
    console.log("Iniciando ciclo de búsqueda de eventos...");
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

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
          console.log(`Se procesaron ${events.length} eventos para "${query}".`);
        }
      } catch (error) {
        console.error(`Error procesando la búsqueda "${query}":`, error);
      } finally {
        await mongoClient.close();
      }
    }
    console.log("Ciclo de búsqueda de eventos finalizado.");
  }

  cron.schedule('0 3 * * *', () => {
    fetchAndSaveEvents();
  }, {
    scheduled: true,
    timezone: "Europe/Madrid"
  });

  console.log("Worker iniciado. Esperando a la próxima ejecución programada (3 AM).");
  console.log("Ejecutando una vez ahora para la prueba inicial...");
  fetchAndSaveEvents();

} catch (error) {
  console.error("💥 ERROR FATAL DURANTE LA INICIALIZACIÓN 💥:", error.message);
  process.exit(1);
}
// Forzando un nuevo despliegue para actualizar el comando
import 'dotenv/config';
