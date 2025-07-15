import 'dotenv/config';
import { MongoClient } from 'mongodb';
import cron from 'node-cron';
import axios from 'axios';
import * as cheerio from 'cheerio';

// --- CONFIGURACIÓN ---
const { MONGO_URI } = process.env;
const mongoClient = new MongoClient(MONGO_URI, { autoSelectFamily: false });

// El objetivo de nuestro scraper
const TARGET_URL = 'https://www.deflamenco.com/guia/de-conciertos.html';

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
    console.log(`Iniciando scraping de: ${TARGET_URL}...`);
    
    try {
        // 1. DESCARGAMOS EL HTML DE LA PÁGINA
        const response = await axios.get(TARGET_URL);
        const html = response.data;

        // 2. CARGAMOS EL HTML EN CHEERIO PARA ANALIZARLO
        const $ = cheerio.load(html);
        
        const events = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 3. BUSCAMOS LOS EVENTOS DENTRO DEL HTML
        // Cada evento en la página está dentro de un 'article' con la clase 'item'
        $('article.item').each((index, element) => {
            // Extraemos los datos usando los selectores CSS específicos de la página
            const name = $(element).find('h2.item-title a').text().trim();
            const url = $(element).find('h2.item-title a').attr('href');
            const fullDateText = $(element).find('time.item-published').text().trim();
            const dateMatch = fullDateText.match(/(\d{1,2} de \w+ de \d{4})/);
            
            if (name && dateMatch) {
                const parsedDate = parseSpanishDate(dateMatch[0]);
                if (parsedDate && new Date(parsedDate) >= today) {
                    
                    const locationText = $(element).find('.item-extra-fields-value').eq(0).text().trim();
                    
                    events.push({
                        id: `deflamenco-${url.split('/').pop().replace('.html','')}`, // Creamos un ID único desde la URL del evento
                        name: name,
                        artist: "Consultar cartel", // La web no siempre separa al artista principal
                        description: `Evento extraído de deflamenco.com. Más información en la web original. Ubicación: ${locationText}`,
                        date: parsedDate,
                        time: "21:00", // La web no provee la hora, usamos un placeholder
                        venue: locationText.split(',')[0] || "Consultar web", // Intentamos obtener el lugar
                        city: locationText.split(',')[1] || "Consultar web", // Intentamos obtener la ciudad
                        country: "España", // Asumimos España
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
        console.error("💥 ERROR FATAL durante el scraping: ", error);
    }
}

// --- EJECUCIÓN ---
// Lo programamos para que se ejecute una vez al día
cron.schedule('0 5 * * *', () => { scrapeAndSaveEvents(); }, { scheduled: true, timezone: "Europe/Madrid" });

console.log("Worker SCRAPER para deflamenco.com iniciado. Ejecutando una vez para la prueba...");
scrapeAndSaveEvents();