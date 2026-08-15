#!/usr/bin/env node
/**
 * scraper-eurlex.js — Importa atti EUR-Lex in giuridica.db via SPARQL CELLAR
 *
 * API usata: SPARQL endpoint CELLAR (EUR-Lex/publications.europa.eu)
 *   https://publications.europa.eu/webapi/rdf/sparql
 *   Ontologia CDM: http://publications.europa.eu/ontology/cdm#
 *
 * Tipi scaricati:
 *   - REG       → regolamento
 *   - REG_IMPL  → regolamento
 *   - DIR       → direttiva
 *   - DEC / DEC_IMPL / DEC_ENTSCHEID → decisione
 *   - JUDG      → sentenza (CGUE)
 *
 * Argomenti CLI:
 *   --test             scarica 20 atti e si ferma
 *   --anno=2024        filtra anno specifico (default: ultimi 2 anni + anno corrente)
 *   --anni=2022-2024   range anni
 *   --resume           salta CELEX già presenti nel DB
 *
 * Dipendenze: better-sqlite3, https (nativo Node.js)
 */

'use strict';

const https    = require('https');
const path     = require('path');
const Database = require('better-sqlite3');

// ─── Costanti ─────────────────────────────────────────────────────────────────

const SPARQL_ENDPOINT_HOST = 'publications.europa.eu';
const SPARQL_ENDPOINT_PATH = '/webapi/rdf/sparql';
const EURLEX_BASE          = 'https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:';
const RATE_LIMIT_MS        = 2000;   // 2s tra richieste HTTP (rispetta server EU)
const BATCH_SIZE           = 200;    // record per query SPARQL
const LOG_INTERVAL         = 50;     // log ogni N record inseriti
const TEST_LIMIT           = 20;     // --test: ferma dopo N atti

// Mapping tipo CELLAR → label leggibile + categoria interna
const TIPO_MAP = {
  'REG':             { label: 'regolamento',  cat: 'regolamento' },
  'REG_IMPL':        { label: 'regolamento',  cat: 'regolamento' },
  'REG_DEL':         { label: 'regolamento',  cat: 'regolamento' },
  'DIR':             { label: 'direttiva',    cat: 'direttiva'   },
  'DIR_IMPL':        { label: 'direttiva',    cat: 'direttiva'   },
  'DEC':             { label: 'decisione',    cat: 'decisione'   },
  'DEC_IMPL':        { label: 'decisione',    cat: 'decisione'   },
  'DEC_DEL':         { label: 'decisione',    cat: 'decisione'   },
  'DEC_ENTSCHEID':   { label: 'decisione',    cat: 'decisione'   },
  'DEC_FRAMEV':      { label: 'decisione',    cat: 'decisione'   },
  'JUDG':            { label: 'sentenza',     cat: 'sentenza'    },
  'ORDER':           { label: 'sentenza',     cat: 'sentenza'    },
  'OPIN_AG':         { label: 'sentenza',     cat: 'sentenza'    },
};

// URI resource-type CELLAR per i tipi supportati
const RESOURCE_TYPES_URI = [
  'http://publications.europa.eu/resource/authority/resource-type/REG',
  'http://publications.europa.eu/resource/authority/resource-type/REG_IMPL',
  'http://publications.europa.eu/resource/authority/resource-type/REG_DEL',
  'http://publications.europa.eu/resource/authority/resource-type/DIR',
  'http://publications.europa.eu/resource/authority/resource-type/DIR_IMPL',
  'http://publications.europa.eu/resource/authority/resource-type/DEC',
  'http://publications.europa.eu/resource/authority/resource-type/DEC_IMPL',
  'http://publications.europa.eu/resource/authority/resource-type/DEC_DEL',
  'http://publications.europa.eu/resource/authority/resource-type/DEC_ENTSCHEID',
  'http://publications.europa.eu/resource/authority/resource-type/DEC_FRAMEV',
  'http://publications.europa.eu/resource/authority/resource-type/JUDG',
];

// ─── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { test: false, anni: null, resume: false };

  for (const arg of args) {
    if (arg === '--test') {
      opts.test = true;
    } else if (arg.startsWith('--anno=')) {
      const a = parseInt(arg.slice(7), 10);
      opts.anni = { min: a, max: a };
    } else if (arg.startsWith('--anni=')) {
      const parts = arg.slice(7).split('-').map(Number);
      opts.anni = { min: parts[0], max: parts[1] || parts[0] };
    } else if (arg === '--resume') {
      opts.resume = true;
    }
  }

  if (!opts.anni) {
    const now = new Date().getFullYear();
    opts.anni = { min: now - 1, max: now };
  }

  return opts;
}

function rangeAnni(min, max) {
  const out = [];
  for (let a = min; a <= max; a++) out.push(a);
  return out;
}

// ─── Utilità ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Ricava la sigla tipo dalla URI resource-type */
function uriToTipoKey(uri) {
  return uri ? uri.split('/').pop() : null;
}

/** Traduce in stato leggibile il predicato in-force SPARQL */
function vigoreToStato(vigore) {
  if (vigore === null || vigore === undefined) return 'sconosciuto';
  // CELLAR restituisce "true"/"false" oppure "1"/"0"
  if (vigore === 'true'  || vigore === '1')    return 'vigente';
  if (vigore === 'false' || vigore === '0')    return 'abrogato';
  // Numerico dopo cast a stringa
  if (String(vigore).trim() === '1')  return 'vigente';
  if (String(vigore).trim() === '0')  return 'abrogato';
  return 'sconosciuto';
}

// ─── HTTP/SPARQL ──────────────────────────────────────────────────────────────

function httpsPost(hostname, path, body, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(body, 'utf8');
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Accept':         'application/sparql-results+json',
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': bodyBuf.length,
        'User-Agent':     'EdicolaEcclesiastica/1.0 (+https://edicolaecclesiastica.com)',
      },
    };

    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') })
      );
    });

    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout ${timeoutMs}ms`)));
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

/**
 * Esegue query SPARQL con retry (3 tentativi, backoff 6s).
 * @param {string} sparql
 * @returns {Array} array di binding objects
 */
async function sparql(query) {
  const body = 'query=' + encodeURIComponent(query);
  let lastErr;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { status, body: resp } = await httpsPost(
        SPARQL_ENDPOINT_HOST,
        SPARQL_ENDPOINT_PATH,
        body,
        55000
      );

      if (status !== 200) {
        throw new Error(`HTTP ${status}: ${resp.slice(0, 300)}`);
      }

      const json = JSON.parse(resp);
      return json.results?.bindings ?? [];
    } catch (err) {
      lastErr = err;
      console.warn(`  [SPARQL] tentativo ${attempt}/3 fallito: ${err.message}`);
      if (attempt < 3) await sleep(6000);
    }
  }

  throw lastErr;
}

// ─── Query builder ────────────────────────────────────────────────────────────

/**
 * Costruisce e lancia la query SPARQL per un anno + offset.
 * Restituisce array di oggetti normalizzati.
 */
async function fetchBatch(anno, offset) {
  // Filtri anno via STRSTARTS sul CELEX "3YYYY..."
  // Escludiamo versioni consolidate (celex che contiene "-")
  const typeFilter = RESOURCE_TYPES_URI
    .map(u => `?tipo = <${u}>`)
    .join(' || ');

  const query = `
PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?celex ?tipo ?titolo_it ?data ?vigore
WHERE {
  ?work cdm:resource_legal_id_celex ?celex .
  ?work cdm:work_has_resource-type ?tipo .

  FILTER(${typeFilter})
  FILTER(STRSTARTS(STR(?celex), "3${anno}") || STRSTARTS(STR(?celex), "6${anno}"))
  FILTER(!CONTAINS(STR(?celex), "-"))
  FILTER(!CONTAINS(STR(?celex), "("))

  OPTIONAL { ?work cdm:work_date_document ?data }
  OPTIONAL { ?work cdm:resource_legal_in-force ?vigore }
  OPTIONAL {
    ?expr cdm:expression_belongs_to_work ?work .
    ?expr cdm:expression_title ?titolo_it .
    FILTER(LANG(?titolo_it) = "it")
  }
}
ORDER BY ?celex
LIMIT ${BATCH_SIZE} OFFSET ${offset}`;

  const bindings = await sparql(query);
  return bindings.map(b => {
    const celex   = b.celex?.value    ?? null;
    const tipoUri = b.tipo?.value     ?? null;
    const tipoKey = uriToTipoKey(tipoUri);
    const mapped  = TIPO_MAP[tipoKey] ?? { label: 'altro', cat: 'altro' };

    return {
      id:                 celex,
      celex,
      titolo:             b.titolo_it?.value ?? null,
      tipo:               mapped.cat,
      data_pubblicazione: b.data?.value      ?? null,
      abstract_it:        null,   // non disponibile via SPARQL
      stato:              vigoreToStato(b.vigore?.value ?? null),
      url_fonte:          celex ? `${EURLEX_BASE}${celex}` : null,
    };
  });
}

// ─── DB ──────────────────────────────────────────────────────────────────────

function openDB() {
  const dbPath = path.join(__dirname, '..', 'data', 'giuridica.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS eurlex (
      id                TEXT PRIMARY KEY,
      celex             TEXT UNIQUE,
      titolo            TEXT,
      tipo              TEXT,
      data_pubblicazione TEXT,
      abstract_it       TEXT,
      stato             TEXT,
      url_fonte         TEXT,
      data_import       TEXT DEFAULT (date('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_eurlex_celex ON eurlex(celex);
    CREATE INDEX IF NOT EXISTS idx_eurlex_tipo  ON eurlex(tipo);
    CREATE INDEX IF NOT EXISTS idx_eurlex_data  ON eurlex(data_pubblicazione);
  `);

  return db;
}

const INSERT_SQL = `
INSERT OR IGNORE INTO eurlex
  (id, celex, titolo, tipo, data_pubblicazione, abstract_it, stato, url_fonte)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const anni = rangeAnni(opts.anni.min, opts.anni.max);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SCRAPER EUR-LEX — Edicola Ecclesiastica (services/scraper-eurlex)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  API:      SPARQL CELLAR — publications.europa.eu`);
  console.log(`  Target:   giuridica.db → tabella eurlex`);
  console.log(`  Anni:     ${anni.join(', ')}`);
  console.log(`  Tipi:     REG, DIR, DEC, JUDG (e varianti)`);
  console.log(`  Test:     ${opts.test ? `SI (max ${TEST_LIMIT} atti)` : 'NO'}`);
  console.log(`  Resume:   ${opts.resume}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const db         = openDB();
  const stmtInsert = db.prepare(INSERT_SQL);
  const stmtCheck  = db.prepare('SELECT 1 FROM eurlex WHERE celex = ?');

  let totalInserted = 0;
  let totalSkipped  = 0;
  let totalErrors   = 0;
  let stop          = false;
  const startTime   = Date.now();

  for (const anno of anni) {
    if (stop) break;

    console.log(`\n── Anno ${anno} ──────────────────────────────────────────────`);
    let offset = 0;

    while (true) {
      if (stop) break;

      console.log(`  [SPARQL] query anno=${anno} offset=${offset}...`);

      let batch;
      try {
        batch = await fetchBatch(anno, offset);
      } catch (err) {
        console.error(`  [SPARQL] ERRORE anno=${anno} offset=${offset}: ${err.message}`);
        totalErrors++;
        break;
      }

      if (batch.length === 0) {
        console.log(`  [SPARQL] Nessun risultato — prossimo anno`);
        break;
      }

      console.log(`  [SPARQL] Ricevuti ${batch.length} atti`);

      for (const atto of batch) {
        if (stop) break;
        if (!atto.celex) continue;

        // Resume: salta già presenti
        if (opts.resume && stmtCheck.get(atto.celex)) {
          totalSkipped++;
          continue;
        }

        try {
          stmtInsert.run(
            atto.id,
            atto.celex,
            atto.titolo,
            atto.tipo,
            atto.data_pubblicazione,
            atto.abstract_it,
            atto.stato,
            atto.url_fonte
          );
          totalInserted++;
        } catch (err) {
          console.warn(`  [DB] errore insert ${atto.celex}: ${err.message}`);
          totalErrors++;
          continue;
        }

        // Log ogni LOG_INTERVAL record
        if (totalInserted % LOG_INTERVAL === 0) {
          const titolo = (atto.titolo ?? '').slice(0, 55);
          console.log(`  [OK:${totalInserted}] ${atto.celex.padEnd(18)} ${atto.tipo.padEnd(12)} ${atto.stato.padEnd(11)} ${titolo}`);
        }

        // Modalità --test
        if (opts.test && totalInserted >= TEST_LIMIT) {
          console.log(`\n  [TEST] Raggiunto limite ${TEST_LIMIT} atti — stop.`);
          stop = true;
          break;
        }
      }

      if (batch.length < BATCH_SIZE) break;  // ultimo batch

      offset += BATCH_SIZE;

      if (!stop) {
        console.log(`  [RATE]  pausa ${RATE_LIMIT_MS / 1000}s...`);
        await sleep(RATE_LIMIT_MS);
      }
    }

    // Rate limit tra anni
    if (!stop && anni.indexOf(anno) < anni.length - 1) {
      await sleep(RATE_LIMIT_MS);
    }
  }

  db.close();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  IMPORT COMPLETATO');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Atti inseriti:   ${totalInserted}`);
  console.log(`  Atti skippati:   ${totalSkipped}`);
  console.log(`  Errori:          ${totalErrors}`);
  console.log(`  Tempo totale:    ${elapsed}s`);
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
