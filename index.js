import 'dotenv/config';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { MongoClient } from 'mongodb';
import cron from 'node-cron';
import axios from 'axios';
import * as cheerio from 'cheerio';

// --- CONFIGURACIÓN ---
const { GEMINI_API_KEY, MONGO_URI } = process.env;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const mongoClient = new MongoClient(MONGO_URI, { autoSelectFamily: false });
const AGENDA_URL = 'https://www.deflamenco.com/agenda-de-flamenco.html';
const BASE_URL = 'https://www.deflamenco.com';

// --- ESTRUCTURA DE DATOS PARA LA IA (FUNCTION CALLING) ---
const tools = [{
  functionDeclarations: [{
    name: "guardar_evento_analizado",
    description: "Guarda los detalles de un único evento de flamenco extraídos del texto de una página web.",
    parameters: {
      type: "OBJECT",
      properties: {
        id: { type: "STRING", description: "Un identificador único para el evento, en formato slug. ej: artista-ciudad-fecha" },
        name: { type: "STRING", description: "El nombre oficial del evento." },
        artist: { type: "STRING", description: "El artista o artistas principales." },
        description: { type: "STRING", description: "Una breve descripción del evento." },
        date: { type: "STRING", description: "La fecha del evento en formato YYYY-MM-DD." },
        time: { type: "STRING", description: "La hora del evento en formato HH:MM." },
        venue: { type: "STRING", description: "El nombre del lugar o teatro." },
        city: { type: "STRING", description: "La ciudad del evento." },
        country: { type: "STRING", description: "El país del evento." },
        verified: { type: "BOOLEAN", description: "Poner en 'true' si la información parece oficial." }
      },
      required: ["id", "name", "artist", "date", "city"]
    }
  }]
}];

const eventAnalysisPrompt = (pageText, url) => `Analiza el siguiente texto extraído de la página web '${url}'. Identifica los detalles de un único evento de flamenco (nombre, artista, fecha, hora, lugar, etc.). Luego, llama a la función 'guardar_evento_analizado' con los datos estructurados. Si el texto no parece contener un evento, no llames a la función. Texto a analizar: "${pageText}"`;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function scrapeAndAnalyzeEvents() {
    console.log("Iniciando WORKER HÍBRIDO (Scraper + IA)...");
    let browser = null;
    
    try {
        // --- FASE 1: SCRAPER ENCUENTRA ENLACES ---
        console.log(`FASE 1: Obteniendo enlaces de ${AGENDA_URL}...`);
        const response = await axios.get(AGENDA_URL);
        const $ = cheerio.load(response.data);
        const eventLinks = [];
        $('h2.item-title a').each((index, element) => {
            const url = $(element).attr('href');
            if (url) { eventLinks.push(BASE_URL + url); }
        });
        
        console.log(`Se encontraron ${eventLinks.length} enlaces. Iniciando FASE 2...`);
        if (eventLinks.length === 0) return;

        // --- FASE 2: IA ANALIZA CADA ENLACE ---
        await mongoClient.connect();
        console.log("✅ Conexión a MongoDB establecida.");
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro", tools: tools });
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const link of eventLinks) {
            try {
                console.log(`\nAnalizando subpágina: ${link}`);
                const detailResponse = await axios.get(link);
                const $detail = cheerio.load(detailResponse.data);
                const pageText = $detail('body').text().replace(/\s\s+/g, ' ').trim(); // Extraemos y limpiamos el texto

                const result = await model.generateContent(eventAnalysisPrompt(pageText, link));
                const functionCall = result.response.functionCalls?.[0];

                if (functionCall && functionCall.name === "guardar_evento_analizado") {
                    const event = functionCall.args;
                    if (event.date && new Date(event.date) >= today) {
                        await eventsCollection.updateOne({ id: event.id }, { $set: event }, { upsert: true });
                        console.log(`👍 Evento analizado y guardado: "${event.name}"`);
                    } else {
                        console.log(`ℹ️ Evento omitido (pasado o sin fecha): "${event.name}"`);
                    }
                } else {
                    console.log(`❕ La IA no encontró un evento estructurado en la página.`);
                }
            } catch (pageError) {
                console.error(`❌ Error procesando la subpágina ${link}:`, pageError.message);
            }
            console.log("Pausando 5 segundos...");
            await delay(5000); // Pausa de 5s entre cada análisis de página
        }
    } catch (error) {
        console.error("💥 ERROR FATAL en el worker: ", error);
    } finally {
        if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected()) {
            await mongoClient.close();
        }
        console.log("🔌 Ciclo Híbrido finalizado.");
    }
}

// --- EJECUCIÓN ---
cron.schedule('0 5 * * *', () => { scrapeAndAnalyzeEvents(); }, { scheduled: true, timezone: "Europe/Madrid" });

console.log("Worker HÍBRIDO iniciado. Ejecutando una vez para la prueba...");
scrapeAndAnalyzeEvents();