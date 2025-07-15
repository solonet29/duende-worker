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
    "Rocío Márquez", "María Terremoto", "Farruquito", "Pedro El Granaíno", "Miguel Poveda"
];

const GENERAL_QUERIES = [
    "espectáculos de flamenco en tablaos de Madrid",
    "programación de flamenco en teatros de Barcelona",
    "noches de flamenco en cuevas del Sacromonte Granada",
    "espectáculo flamenco en París",
    "conciertos de flamenco en Londres"
];

const ALL_QUERIES = [...ARTIST_LIST, ...GENERAL_QUERIES];

// Definimos la estructura de datos que la IA debe devolver
const tools = [{
  functionDeclarations: [{
    name: "guardar_eventos_encontrados",
    description: "Guarda una lista de eventos de flamenco que se han encontrado.",
    parameters: {
      type: "OBJECT",
      properties: {
        eventos: {
          type: "ARRAY",
          description: "Un array de objetos, donde cada objeto es un evento de flamenco.",
          items: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING" }, name: { type: "STRING" }, artist: { type: "STRING" },
              description: { type: "STRING" }, date: { type: "STRING", description: "La fecha en formato YYYY-MM-DD." },
              time: { type: "STRING" }, venue: { type: "STRING" }, city: { type: "STRING" },
              country: { type: "STRING" }, verified: { type: "BOOLEAN" }
            },
            required: ["id", "name", "artist", "date", "city", "country"]
          }
        }
      },
      required: ["eventos"]
    }
  }]
}];

const eventPromptTemplate = (query) => `Tu objetivo es rellenar una base de datos de eventos de flamenco. Analiza la siguiente consulta: "${query}". Busca en tu conocimiento cualquier evento futuro (conciertos, recitales, festivales) que se relacione con esta consulta en Europa. Luego, obligatoriamente, llama a la función 'guardar_eventos_encontrados' con TODOS los resultados que encuentres. Si no encuentras absolutamente nada, llama a la función con un array vacío [].`;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAndSaveEvents() {
    console.log("Iniciando ciclo de búsqueda con IA (con Filtro de Fecha)...");
    
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro", tools: tools });
        await mongoClient.connect();
        console.log("✅ Conexión a MongoDB establecida.");
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");

        for (const query of ALL_QUERIES) {
            try {
                console.log(`Buscando eventos para: "${query}"...`);
                const result = await model.generateContent(eventPromptTemplate(query));
                const response = await result.response;
                const functionCall = response.functionCalls?.[0];

                if (functionCall && functionCall.name === "guardar_eventos_encontrados") {
                    const events = functionCall.args.eventos || [];
                    
                    if (events.length > 0) {
                        // --- ¡AQUÍ ESTÁ EL FILTRO DE FECHA QUE PEDÍAS! ---
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        const futureEvents = events.filter(event => new Date(event.date) >= today);
                        // --- FIN DEL FILTRO ---

                        if (futureEvents.length > 0) {
                            for (const event of futureEvents) {
                                await eventsCollection.updateOne({ id: event.id }, { $set: event }, { upsert: true });
                            }
                            console.log(`👍 Se procesaron y guardaron ${futureEvents.length} conciertos futuros para "${query}".`);
                        } else {
                            console.log(`ℹ️ La IA devolvió eventos, pero todos eran pasados para "${query}".`);
                        }
                    } else {
                        console.log(`ℹ️ La IA llamó a la función con 0 eventos para "${query}".`);
                    }
                } else {
                    console.log(`❕ La IA no llamó a la función para "${query}", no se encontró información.`);
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

console.log("Worker con IA (Filtro de fecha) iniciado. Ejecutando una vez para la prueba...");
fetchAndSaveEvents();