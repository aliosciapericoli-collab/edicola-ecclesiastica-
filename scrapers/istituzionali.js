/**
 * istituzionali.js — Scraper istituzionali di Edicola Ecclesiastica.
 *
 * Versione ecclesiastica: la copertura istituzionale (Sala Stampa della Santa
 * Sede, Vatican News, CEI, dicasteri) arriva già dai FEED RSS configurati in
 * server.js, quindi qui la lista SCRAPERS parte vuota. Il modulo mantiene la
 * stessa interfaccia dell'originale (runAllScrapers/runScraper/SCRAPERS) così
 * server.js funziona senza modifiche; nuovi scraper dedicati (es. bollettino
 * della Sala Stampa, delibere CEI) si aggiungono alla lista come oggetti
 * { name, fn: async () => [items], interval }.
 */

const SCRAPERS = [];

async function runAllScrapers() {
  const all = [];
  for (const sc of SCRAPERS) {
    try {
      const items = await sc.fn();
      console.log(`  [${sc.name}] ${items.length} notizie`);
      all.push(...items);
    } catch (e) {
      console.warn(`  [${sc.name}] Errore: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return all;
}

async function runScraper(name) {
  const sc = SCRAPERS.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!sc) throw new Error(`Scraper '${name}' non trovato`);
  return sc.fn();
}

module.exports = { runAllScrapers, runScraper, SCRAPERS };
