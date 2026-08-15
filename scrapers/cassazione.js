/**
 * cassazione.js — Stub ecclesiastico dello scraper Cassazione.
 *
 * In Edicola Ecclesiastica la giurisprudenza di legittimità in materia
 * ecclesiastica NON viene scaricata di nuovo: viene filtrata dal corpus già
 * presente nel progetto madre (../data/cassazione-corpus.db) tramite
 * corpus/filtra-giurisprudenza.js. Questo stub mantiene l'interfaccia attesa
 * da server.js restituendo liste vuote.
 */

const SCRAPERS = [];

async function runAllCassazioneScrapers() { return []; }
async function runScraper() { return []; }

module.exports = {
  runAllCassazioneScrapers,
  runScraper,
  SCRAPERS,
};
