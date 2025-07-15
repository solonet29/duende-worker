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
    "Rocío Márquez", "María Terremoto", "Farruquito", "Pedro El Granaíno", "Miguel Poveda",
    "Antonio Reyes", "Rancapino Chico", "Jesús Méndez", "Arcángel", "Israel Fernández"
];

// 1. DEFINIMOS LA ESTRUCTURA DE DATOS EXACTA QUE QUEREMOS
// Esto es como un contrato que la IA está obligada a cumplir.
const eventSchema = {
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
};

// 2. CREAMOS LA "HERRAMIENTA" QUE LA IA DEBE USAR
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
          items: eventSchema
        }
      },
      required: ["eventos"]
    }
  }]
}];

const eventPromptTemplate = (artistName) => `Busca todos los eventos y conciertos futuros del artista de flamenco "${artistName}" en Europa. Recopila toda la información que encuentres. Si no encuentras ningún evento, no llames a la función.`;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAndSaveEvents() {
    console.log("Iniciando ciclo de búsqueda con FUNCTION CALLING...");
    
    try {
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-pro",
            tools: tools,
        });

        await mongoClient.connect();
        console.log("✅ Conexión a MongoDB establecida.");
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");

        for (const artist of ARTIST_LIST) {
            try {
                console.log(`Buscando conciertos para: "${artist}"...`);
                const result = await model.generateContent(eventPromptTemplate(artist));
                const response = await result.response;
                
                // 3. EXTRAEMOS LOS DATOS DE LA LLAMADA A LA FUNCIÓN
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
                            console.log(`👍 Se procesaron y guardaron ${futureEvents.length} conciertos futuros para "${artist}".`);
                        } else {
                            console.log(`ℹ️ La IA devolvió eventos, pero todos eran pasados para "${artist}".`);
                        }
                    } else {
                        console.log(`ℹ️ La IA llamó a la función pero sin eventos para "${artist}".`);
                    }
                } else {
                    console.log(`ℹ️ La IA no encontró información o no llamó a la función para "${artist}".`);
                }
            } catch (error) {
                console.error(`❌ Error procesando la búsqueda para "${artist}":`, error.message);
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

console.log("Worker con FUNCTION CALLING iniciado. Ejecutando una vez para la prueba...");
fetchAndSaveEvents();