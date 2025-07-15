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
    "espectáculos flamencos Madrid",
    "agenda flamenca Barcelona",
    "festivales de flamenco Andalucía 2025",
    "conciertos flamencos París"
];

const ALL_QUERIES = [...ARTIST_LIST, ...GENERAL_QUERIES];

// --- ESTRUCTURA DE DATOS PARA LA IA (FUNCTION CALLING) ---
const tools = [{
  functionDeclarations: [{
    name: "guardar_eventos_encontrados",
    description: "Guarda una lista de eventos de flamenco que se han encontrado tras analizar las fuentes.",
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
              country: { type: "STRING" }, verified: { type: "BOOLEAN", description: "True si la fuente es fiable (un teatro, un vendedor de entradas), false si es un blog o foro." }
            },
            required: ["id", "name", "artist", "date", "city"]
          }
        }
      },
      required: ["eventos"]
    }
  }]
}];

// --- PROMPT MEJORADO QUE INVITA A USAR LAS HERRAMIENTAS ---
const eventPromptTemplate = (query) => `Tu misión es encontrar eventos de flamenco reales y futuros. Usa la herramienta de búsqueda de Google para encontrar páginas web relevantes sobre la consulta: "${query}". Analiza las páginas más fiables (teatros, webs de artistas, vendedores de entradas) y extrae todos los eventos que encuentres. Llama a la función 'guardar_eventos_encontrados' con los datos. Si tras buscar no encuentras nada, llama a la función con un array vacío.`;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAndSaveEvents() {
    console.log("Iniciando ciclo de búsqueda HÍBRIDO (Google Search + IA)...");
    
    try {
        // 1. INICIALIZAMOS EL MODELO CON ACCESO A HERRAMIENTAS
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-pro",
            tools: tools, // Le pasamos la definición de nuestra función
        });

        await mongoClient.connect();
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const query of ALL_QUERIES) {
            try {
                console.log(`Buscando en Google y analizando para: "${query}"...`);
                const result = await model.generateContent(eventPromptTemplate(query));
                const response = await result.response;
                const functionCall = response.functionCalls?.[0];

                if (functionCall && functionCall.name === "guardar_eventos_encontrados") {
                    const events = functionCall.args.eventos || [];
                    
                    if (events.length > 0) {
                        const futureEvents = events.filter(event => new Date(event.date) >= today);

                        if (futureEvents.length > 0) {
                            for (const event of futureEvents) {
                                await eventsCollection.updateOne({ id: event.id }, { $set: event }, { upsert: true });
                            }
                            console.log(`👍 Se procesaron y guardaron ${futureEvents.length} conciertos futuros para "${query}".`);
                        } else {
                            console.log(`ℹ️ La IA encontró eventos, pero todos eran pasados para "${query}".`);
                        }
                    } else {
                        console.log(`ℹ️ La IA buscó y no encontró nuevos conciertos para "${query}".`);
                    }
                } else {
                    console.log(`❕ La IA no encontró información verificable para llamar a la función para "${query}".`);
                }
            } catch (error) {
                console.error(`❌ Error procesando la búsqueda para "${query}":`, error.message);
            } finally {
                console.log("Pausando por 10 segundos...");
                await delay(10000); // Pausa de 10 segundos entre cada gran búsqueda
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

cron.schedule('0 4 * * *', () => { fetchAndSaveEvents(); }, { scheduled: true, timezone: "Europe/Madrid" });

console.log("Worker HÍBRIDO DEFINITIVO iniciado. Ejecutando una vez para la prueba...");
fetchAndSaveEvents();