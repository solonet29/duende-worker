import 'dotenv/config';
import { MongoClient } from 'mongodb';
import cron from 'node-cron';
import axios from 'axios';
import * as cheerio from 'cheerio';

// --- CONFIGURACIÓN ---
const { MONGO_URI } = process.env;
const mongoClient = new MongoClient(MONGO_URI, { autoSelectFamily: false });

// ¡AQUÍ ESTÁ LA CORRECCIÓN! APUNTAMOS A LA URL CORRECTA.
const TARGET_URL = 'https://www.deflamenco.com/agenda-de-flamenco.html';

// Función para convertir la fecha en español (ej: "15 de julio de 2025") a formato YYYY-MM-DD
function parseSpanishDate(dateString) {
    const months = {
        'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04', 'mayo': '05', 'junio': '06',
        'julio': '07', 'agosto': '08', 'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
    };
    const parts = dateString.toLowerCase().split(' de ');
    if (parts.length !== 3) return null;
    const day = parts[0].padStart(2, '0');
    const month = months[parts[1]];
    const year = parts[2];
    if (!day || !month || !year) return null;
    return `${year}-${month}-${day}`;
}

async function scrapeAndSaveEvents() {
    console.log(`Iniciando scraping de la URL CORRECTA: ${TARGET_URL}...`);
    
    try {
        const response = await axios.get(TARGET_URL);
        const html = response.data;
        const $ = cheerio.load(html);
        
        const events = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        $('article.item').each((index, element) => {
            const name = $(element).find('h2.item-title a').text().trim();
            const url = $(element).find('h2.item-title a').attr('href');
            // La fecha en esta nueva página está dentro del título del enlace
            const dateMatch = name.match(/(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i) || $(element).find('time.item-published').text().trim().match(/(\d{1,2} de \w+ de \d{4})/);

            if (name && url && dateMatch) {
                const parsedDate = parseSpanishDate(dateMatch[0]);
                if (parsedDate && new Date(parsedDate) >= today) {
                    const locationText = $(element).find('.item-extra-fields-value').eq(0).text().trim();
                    
                    events.push({
                        id: `deflamenco-${url.split('/').pop().replace('.html','')}`,
                        name: name,
                        artist: "Consultar cartel",
                        description: `Evento extraído de deflamenco.com. Ubicación: ${locationText}`,
                        date: parsedDate,
                        time: "21:00",
                        venue: locationText.split(',')[0] || "Consultar web",
                        city: locationText.split(',')[1] || "Consultar web",
                        country: "España",
                        verified: true 
                    });
                }
            }
        });
        
        console.log(`👍 Se han encontrado y filtrado ${events.length} eventos futuros en la página.`);
        
        if (events.length > 0) {
            await mongoClient.connect();
            console.log("✅ Conexión a MongoDB establecida.");
            const db = mongoClient.db("DuendeDB");
            const eventsCollection = db.collection("events");

            for (const event of events) {
                await eventsCollection.updateOne({ id: event.id }, { $set: event }, { upsert: true });
            }
            
            await mongoClient.close();
            console.log("🔌 Conexión a MongoDB cerrada. Eventos guardados.");
        }

    } catch (error) {
        // Añadimos un log más detallado del error de axios si ocurre
        if (error.response) {
            console.error(`💥 ERROR de Red al acceder a la URL: Status ${error.response.status}`);
        } else {
            console.error("💥 ERROR FATAL durante el scraping: ", error);
        }
    }
}

// --- EJECUCIÓN ---
cron.schedule('0 5 * * *', () => { scrapeAndSaveEvents(); }, { scheduled: true, timezone: "Europe/Madrid" });

console.log("Worker SCRAPER (URL corregida) iniciado. Ejecutando una vez para la prueba...");
scrapeAndSaveEvents();