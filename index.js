import 'dotenv/config';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { MongoClient } from 'mongodb';
import cron from 'node-cron';

// --- CONFIGURACIÓN ---
const { GEMINI_API_KEY, MONGO_URI } = process.env;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const mongoClient = new MongoClient(MONGO_URI, { autoSelectFamily: false });

// 1. REINTRODUCIMOS LA ESTRATEGIA HÍBRIDA
const ARTIST_LIST = [
    "Eva Yerbabuena", "Marina Heredia", "Estrella Morente", "Sara Baras", "Argentina",
    "Rocío Márquez", "María Terremoto", "Farruquito", "Pedro El Granaíno", "Miguel Poveda",
    "Antonio Reyes", "Rancapino Chico", "Jesús Méndez", "Arcángel", "Israel Fernández"
];

const GENERAL_QUERIES = [
    "espectáculos de flamenco en tablaos de Madrid",
    "programación de flamenco en teatros de Barcelona",
    "noches de flamenco en cuevas del Sacromonte Granada",
    "festivales de flamenco en Andalucía verano 2025",
    "conciertos de guitarra flamenca en Jerez",
    "espectáculo flamenco en París",
    "conciertos de flamenco en Londres"
];

const ALL_QUERIES = [...ARTIST_LIST, ...GENERAL_QUERIES];


// 2. EL PROMPT MÁS PERSUASIVO
const eventPromptTemplate = (query) => `Tu objetivo es rellenar una base de datos de eventos de flamenco. Analiza la siguiente consulta: "${query}". Busca en tu conocimiento cualquier evento futuro (conciertos, recitales, festivales) que se relacione con esta consulta en Europa. Luego, obligatoriamente, llama a la función 'guardar_eventos_encontrados' con TODOS los resultados que encuentres. Si no encuentras absolutamente nada, llama a la función con un array vacío [].`;

// Definición de la función y su estructura
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
              id: { type: "STRING", description: "Un identificador único para el evento, en formato slug. ej: artista-ciudad-fecha" },
              name: { type: "STRING", description: "El nombre oficial del evento o espectáculo." },
              artist: { type: "STRING", description: "El artista o artistas principales. Si son varios, listarlos." },
              description: { type: "STRING", description: "Una breve descripción del evento." },
              date: { type: "STRING", description: "La fecha del evento en formato YYYY-MM-DD." },
              time: { type: "STRING", description: "La hora del evento en formato HH:MM." },
              venue: { type: "STRING", description: "El nombre del lugar, teatro o festival." },
              city: { type: "STRING", description: "La ciudad donde se realiza el evento." },
              country: { type: "STRING", description: "El país del evento." },
              verified: { type: "BOOLEAN", description: "Poner en 'true' si la información parece oficial, y 'false' si no." }
            },
            required: ["id", "name", "artist", "description", "date", "city", "country"]
          }
        }
      },
      required: ["eventos"]
    }
  }]
}];

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAndSaveEvents() {
    console.log("Iniciando ciclo de búsqueda DEFINITIVO (Híbrido + Function Calling)...");
    
    try {
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-pro",
            tools: tools,
        });

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
        await mongoClient.close();
        console.log("🔌 Conexión a MongoDB cerrada. Ciclo finalizado.");
    }
}

// --- EJECUCIÓN ---
cron.schedule('0 3 * * *', () => { fetchAndSaveEvents(); }, { scheduled: true, timezone: "Europe/Madrid" });

console.log("Worker DEFINITIVO iniciado. Ejecutando una vez para la prueba...");
fetchAndSaveEvents();