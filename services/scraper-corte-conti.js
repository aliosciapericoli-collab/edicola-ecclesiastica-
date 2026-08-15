'use strict';

/**
 * scraper-corte-conti.js
 * Scarica sentenze dalla Corte dei conti via API JSON
 *
 * Endpoint: POST https://www.corteconti.it/DesktopModules/CdcWebApi/API/Document/GetByIndex
 * Stack: DotNetNuke (DNN) ASP.NET, API JSON proprietaria
 * AreaTematica Sentenze: da8efe60-c4b3-4487-a732-05e5ede4dbec
 * Paginazione: Page 0-based, 20 record/pagina
 *
 * Uso:
 *   node services/scraper-corte-conti.js          # scarica 2020-2025
 *   node services/scraper-corte-conti.js --test   # solo 50 record
 */

const path   = require('path');
const fetch  = require('node-fetch').default;
const Database = require('better-sqlite3');

// ── Config ────────────────────────────────────────────────────────────────────
const DB_PATH        = path.join(__dirname, '..', 'data', 'giuridica.db');
const API_URL        = 'https://www.corteconti.it/DesktopModules/CdcWebApi/API/Document/GetByIndex';
const DETTAGLIO_BASE = 'https://www.corteconti.it/HOME/Documenti/DettaglioDocumenti';
const AREA_SENTENZE  = 'da8efe60-c4b3-4487-a732-05e5ede4dbec';
const ANNO_DAL       = 2020;
const ANNO_AL        = 2025;
const PAGE_SIZE      = 20;         // server-side fisso a 20
const SLEEP_MS       = 1000;       // 1 secondo tra richieste
const LOG_OGNI       = 100;        // log ogni N record
const TEST_LIMIT     = 50;         // --test: max record

const IS_TEST = process.argv.includes('--test');

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function timestamp() {
  return new Date().toTimeString().slice(0, 8); // HH:MM:SS
}

/** Estrae numero e anno dal titolo tipo "Sentenza n. 70/2026 e Massima" */
function parseTitolo(title) {
  if (!title) return { numero: null, anno: null };
  const m = title.match(/n\.\s*(\d+)\s*[\/\-]\s*(\d{4})/i);
  if (m) return { numero: m[1], anno: parseInt(m[2], 10) };
  // Fallback: cerca solo anno a 4 cifre
  const ma = title.match(/(\d{4})/);
  return { numero: null, anno: ma ? parseInt(ma[1], 10) : null };
}

/** Estrae sezione/sede dal campo Owner */
function parseSezione(owner) {
  if (!owner) return { sezione: null, sede: null };
  // Es: "Sezione giurisdizionale regionale Calabria"
  const mRegionale = owner.match(/sezione\s+(.+?)\s+regionale?\s+(.+)/i);
  if (mRegionale) return { sezione: mRegionale[1].trim(), sede: mRegionale[2].trim() };
  // Es: "Sezione I giurisdizionale centrale di Appello"
  const mCentrale = owner.match(/sezione\s+(.+)/i);
  if (mCentrale) return { sezione: mCentrale[1].trim(), sede: 'Centrale' };
  return { sezione: owner, sede: null };
}

/** Ricava tipo dal titolo o dalla descrizione */
function parseTipo(title, description) {
  const testo = (title + ' ' + description).toLowerCase();
  if (testo.includes('sentenza')) return 'sentenza';
  if (testo.includes('ordinanza')) return 'ordinanza';
  if (testo.includes('decreto')) return 'decreto';
  if (testo.includes('delibera')) return 'delibera';
  if (testo.includes('massima')) return 'massima';
  return 'provvedimento';
}

/** Scarica la pagina di dettaglio e tenta di estrarre il testo */
async function fetchDettaglio(url) {
  try {
    const fullUrl = url.startsWith('http') ? url : `https://www.corteconti.it${url}`;
    const res = await fetch(fullUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
        'Referer': 'https://www.corteconti.it/Home/Ricerca'
      },
      timeout: 15000
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Estrai paragrafi di contenuto: cerca il blocco principale
    // La descrizione è dentro un <p> nella sezione contenuto
    const paragraphs = [];
    const pRegex = /<p[^>]*>([\s\S]{20,2000}?)<\/p>/gi;
    let m;
    while ((m = pRegex.exec(html)) !== null) {
      const testo = m[1]
        .replace(/<[^>]+>/g, ' ')   // strip tag
        .replace(/\s+/g, ' ')
        .trim();
      if (testo.length > 30 && !testo.toLowerCase().includes('cookie') &&
          !testo.toLowerCase().includes('navigazione') &&
          !testo.toLowerCase().includes('javascript')) {
        paragraphs.push(testo);
      }
    }
    return paragraphs.slice(0, 5).join('\n').slice(0, 4000) || null;
  } catch {
    return null;
  }
}

// ── DB Setup ──────────────────────────────────────────────────────────────────
function setupDb() {
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS corte_conti (
      id               TEXT PRIMARY KEY,
      numero           TEXT,
      anno             INTEGER,
      sezione          TEXT,
      sede             TEXT,
      tipo             TEXT,
      oggetto          TEXT,
      testo            TEXT,
      data_pubblicazione TEXT,
      url_fonte        TEXT,
      data_import      TEXT DEFAULT (date('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cc_anno   ON corte_conti(anno);
    CREATE INDEX IF NOT EXISTS idx_cc_sezione ON corte_conti(sezione);
    CREATE INDEX IF NOT EXISTS idx_cc_tipo   ON corte_conti(tipo);
  `);
  return db;
}

// ── API Fetch ─────────────────────────────────────────────────────────────────
async function fetchPage(page, dateDal, dateAl) {
  const body = {
    Filters: {
      DataElementoDal: dateDal,
      DataElementoAl:  dateAl,
      Content:         null,
      AreaTematica:    AREA_SENTENZE,
      EmessoDa:        null,
      FlgDoc:          false,
      FlgWeb:          false,
      Page:            page
    },
    ResultParams: null
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json; charset=utf-8',
      'Accept':           'application/json, text/javascript, */*; q=0.01',
      'User-Agent':       'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer':          'https://www.corteconti.it/Home/Ricerca',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept-Language':  'it-IT,it;q=0.9,en;q=0.8'
    },
    body: JSON.stringify(body),
    timeout: 20000
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} su pagina ${page}`);
  const data = await res.json();
  return data;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[${timestamp()}] ▶ Scraper Corte dei Conti avviato${IS_TEST ? ' [TEST - max 50 record]' : ''}`);
  console.log(`[${timestamp()}] ▶ Range anni: ${ANNO_DAL}-${ANNO_AL}`);

  const db = setupDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO corte_conti
      (id, numero, anno, sezione, sede, tipo, oggetto, testo, data_pubblicazione, url_fonte, data_import)
    VALUES
      (@id, @numero, @anno, @sezione, @sede, @tipo, @oggetto, @testo, @data_pubblicazione, @url_fonte, date('now'))
  `);

  const dateDal = `${ANNO_DAL}-01-01T00:00:00.000Z`;
  const dateAl  = `${ANNO_AL}-12-31T23:59:59.000Z`;

  // Prima pagina per conoscere il totale
  let totalCount = 0;
  let totalPages = 0;
  try {
    const prima = await fetchPage(0, dateDal, dateAl);
    totalCount = prima.TotalCount || 0;
    totalPages = prima.TotalPages || 0;
    console.log(`[${timestamp()}] ℹ Trovati ${totalCount} provvedimenti in ${totalPages} pagine (20/pag)`);

    if (IS_TEST) {
      totalPages = Math.ceil(TEST_LIMIT / PAGE_SIZE);
      console.log(`[${timestamp()}] ℹ Modalità TEST: scarico max ${TEST_LIMIT} record (${totalPages} pagine)`);
    }

    // Processa la prima pagina già scaricata
    await processPage(prima.ResponseItemList || [], insert, db);
  } catch (err) {
    console.error(`[${timestamp()}] ✗ Errore prima pagina: ${err.message}`);
    db.close();
    process.exit(1);
  }

  let scaricati = Math.min((await getCount(db)), totalCount);
  let inseriti  = db.prepare('SELECT COUNT(*) as n FROM corte_conti').get().n;

  // Pagine successive
  for (let page = 1; page < totalPages; page++) {
    // Controllo limite test
    const countOra = db.prepare('SELECT COUNT(*) as n FROM corte_conti').get().n;
    if (IS_TEST && countOra >= TEST_LIMIT) {
      console.log(`[${timestamp()}] ✓ TEST: raggiunto limite ${TEST_LIMIT} record. Stop.`);
      break;
    }

    await sleep(SLEEP_MS);

    try {
      const data = await fetchPage(page, dateDal, dateAl);
      const items = data.ResponseItemList || [];
      await processPage(items, insert, db);

      const nuovoCount = db.prepare('SELECT COUNT(*) as n FROM corte_conti').get().n;
      if (nuovoCount % LOG_OGNI < PAGE_SIZE || nuovoCount >= (totalPages * PAGE_SIZE)) {
        console.log(`[${timestamp()}] ↳ ${nuovoCount}/${totalCount} scaricati...`);
      }
    } catch (err) {
      console.error(`[${timestamp()}] ✗ Errore pagina ${page}: ${err.message} — skip`);
      continue;
    }
  }

  const finale = db.prepare('SELECT COUNT(*) as n FROM corte_conti').get().n;
  console.log(`\n[${timestamp()}] ✓ Completato. Record in DB: ${finale}`);

  // Riepilogo per tipo
  const perTipo = db.prepare('SELECT tipo, COUNT(*) as c FROM corte_conti GROUP BY tipo ORDER BY c DESC').all();
  console.log(`[${timestamp()}] ℹ Distribuzione per tipo:`);
  perTipo.forEach(r => console.log(`   ${r.tipo.padEnd(20)} ${r.c}`));

  db.close();
}

async function getCount(db) {
  return db.prepare('SELECT COUNT(*) as n FROM corte_conti').get().n;
}

async function processPage(items, insert, db) {
  for (const item of items) {
    try {
      // Ricava ID dal URL: DettaglioDocumenti?Id=GUID
      const idMatch = (item.Url || '').match(/Id=([a-f0-9\-]{36})/i);
      if (!idMatch) continue;
      const id = idMatch[1];

      const { numero, anno } = parseTitolo(item.Title);
      const { sezione, sede } = parseSezione(item.Owner);
      const tipo = parseTipo(item.Title, item.Description);

      // Data pubblicazione: ItemData es "2026-03-18T00:00:00Z"
      const dataPub = item.ItemData ? item.ItemData.slice(0, 10) : null;

      // Oggetto: usa Description come oggetto (max 500 chars)
      const oggetto = (item.Description || item.Title || '').slice(0, 500);

      // URL fonte completa
      const urlFonte = item.Url
        ? (item.Url.startsWith('http') ? item.Url : `https://www.corteconti.it${item.Url}`)
        : null;

      // Testo: non scaricarlo per ora nell'iterazione principale
      // (troppo lento con 898 record × 1s = ~15 min extra)
      // Lasciamo testo = oggetto per adesso
      const testo = oggetto;

      insert.run({
        id,
        numero:             numero || null,
        anno:               anno || null,
        sezione:            sezione || null,
        sede:               sede || null,
        tipo,
        oggetto,
        testo,
        data_pubblicazione: dataPub,
        url_fonte:          urlFonte
      });
    } catch (err) {
      // Record malformato: skip e continua
      console.error(`[${timestamp()}] ✗ Skip record malformato: ${err.message}`);
      continue;
    }
  }
}

main().catch(err => {
  console.error(`[${timestamp()}] ✗ Errore fatale: ${err.message}`);
  process.exit(1);
});
