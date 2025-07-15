import 'dotenv/config';
import { MongoClient } from 'mongodb';
import cron from 'node-cron';
import axios from 'axios';
import * as cheerio from 'cheerio';

// --- CONFIGURACIÓN ---
const { MONGO_URI } = process.env;
const mongoClient = new MongoClient(MONGO_URI, { autoSelectFamily: false });

const AGENDA_URL = 'https://www.deflamenco.com/agenda-de-flamenco.html';
const BASE_URL = 'https://www.deflamenco.com';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function parseSpanishDate(dateString) {
    const months = { 'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04', 'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08', 'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12' };
    const parts = dateString.toLowerCase().replace(/,/, '').split(' ');
    if (parts.length < 3) return null;
    const day = parts[0].padStart(2, '0');
    const month = months[parts[2]];
    const year = parts[4];
    if (!day || !month || !year) return null;
    return `${year}-${month}-${day}`;
}

async function scrapeAndSaveEvents() {
    console.log(`Iniciando scraping de 2 FASES desde: ${AGENDA_URL}...`);
    
    try {
        // --- FASE 1: OBTENER LOS ENLACES DE LOS EVENTOS ---
        console.log("FASE 1: Obteniendo lista de enlaces de eventos...");
        const response = await axios.get(AGENDA_URL);
        const $ = cheerio.load(response.data);
        
        const eventLinks = [];
        
        // --- ¡AQUÍ ESTÁ LA CORRECCIÓN! ---
        // El selector correcto para encontrar los enlaces es 'div.col-xs-12 h3 a'.
        $('div.col-xs-12 h3 a').each((index, element) => {
            const url = $(element).attr('href');
            if (url) {
                eventLinks.push(BASE_URL + url);
            }
        });
        
        console.log(`Se encontraron ${eventLinks.length} enlaces a eventos. Iniciando Fase 2...`);
        if (eventLinks.length === 0) {
            console.log("No se encontraron enlaces. La estructura de la web puede haber cambiado. Finalizando ciclo.");
            return;
        }

        // --- FASE 2: VISITAR CADA ENLACE Y EXTRAER LOS DETALLES ---
        await mongoClient.connect();
        console.log("✅ Conexión a MongoDB establecida para procesar detalles.");
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const link of eventLinks) {
            try {
                console.log(`\nProcesando subpágina: ${link}`);
                const detailResponse = await axios.get(link);
                const $detail = cheerio.load(detailResponse.data);

                const name = $detail('h1.item-title').text().trim();
                const dateString = $detail('time[itemprop="startDate"]').attr('datetime');
                
                if (name && dateString && new Date(dateString) >= today) {
                    const artist = $detail('div[itemprop="performer"] a').text().trim() || "Consultar cartel";
                    const venue = $detail('div[itemprop="location"] span[itemprop="name"]').text().trim();
                    const city = $detail('div[itemprop="location"] span[itemprop="addressLocality"]').text().trim();
                    const description = $detail('div[itemprop="description"]').text().trim().substring(0, 400) + '...';
                    const time = $detail('meta[itemprop="doorTime"]').attr('content') || "21:00";
                    
                    const eventData = {
                        id: `deflamenco-${link.split('/').pop().replace('.html','')}`,
                        name: name, artist: artist, description: description, date: dateString,
                        time: time, venue: venue, city: city, country: "España", verified: true
                    };
                    
                    await eventsCollection.updateOne({ id: eventData.id }, { $set: eventData }, { upsert: true });
                    console.log(`👍 Evento guardado: "${name}"`);
                } else {
                    console.log(`ℹ️ Evento omitido (pasado o sin datos suficientes): "${name}"`);
                }

            } catch (pageError) {
                console.error(`❌ Error procesando la subpágina ${link}:`, pageError.message);
            }
            console.log("Pausando 2 segundos entre cada subpágina...");
            await delay(2000);
        }
    } catch (error) {
        console.error("💥 ERROR FATAL en el worker: ", error);
    } finally {
        if (mongoClient) {
            await mongoClient.close();
            console.log("🔌 Conexión a MongoDB cerrada. Ciclo finalizado.");
        }
    }
}

cron.schedule('0 5 * * *', () => { scrapeAndSaveEvents(); }, { scheduled: true, timezone: "Europe/Madrid" });

console.log("Worker SCRAPER (Selector Corregido) iniciado. Ejecutando una vez para la prueba...");
scrapeAndSaveEvents();