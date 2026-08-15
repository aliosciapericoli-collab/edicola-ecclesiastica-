#!/usr/bin/env node
/**
 * link-notizia-sentenza.js — PARTE 2
 * Collega news a sentenze tramite norme in comune (norma-ponte).
 *
 * Strategia:
 *   1. Per ogni news con norme_citate: estrai e normalizza le norme
 *   2. Per ogni norma, trova tutte le sentenze che citano quella stessa norma
 *      (via relazioni_norme WHERE fonte_tipo='sentenza')
 *   3. Match FORTE  (≥2 norme in comune)  → tipo_match='norma_ponte_forte'
 *      Match DEBOLE (1 norma in comune, non generica) → tipo_match='norma_ponte_debole'
 *   4. INSERT OR IGNORE con norma_ponte = lista norme comuni
 *
 * Norme "troppo generiche" escluse dal match debole:
 *   art. 1, art. 2, art. 3, art. 4 dei codici principali, art. 2697 c.c. ecc.
 *
 * CLI:
 *   node link-notizia-sentenza.js           esegue tutto
 *   node link-notizia-sentenza.js --dryrun  solo report, no scritture
 *   node link-notizia-sentenza.js --limit=500
 */
'use strict';

const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = path.join(__dirname, 'data', 'giuridica.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -32000');
db.pragma('temp_store = MEMORY');

const args = process.argv.slice(2).reduce((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v === undefined ? true : v;
  return acc;
}, {});

const DRYRUN = !!args.dryrun;
const LIMIT  = parseInt(args.limit || '0') || 0; // 0 = no limit

function log(msg) { console.log(`[link-ns] ${msg}`); }

// ─────────────────────────────────────────────────────────────────────────────
// Norme troppo generiche da escludere dal match DEBOLE
// (citate in quasi ogni sentenza — non discriminanti)
// ─────────────────────────────────────────────────────────────────────────────
const NORME_GENERICHE = new Set([
  'art. 1 c.c.', 'art. 2 c.c.', 'art. 3 c.c.', 'art. 4 c.c.',
  'art. 1 c.p.', 'art. 2 c.p.', 'art. 3 c.p.', 'art. 4 c.p.',
  'art. 1 c.p.c.', 'art. 2 c.p.c.', 'art. 3 c.p.c.',
  'art. 1 c.p.p.', 'art. 2 c.p.p.', 'art. 3 c.p.p.',
  'art. 2697 c.c.',   // onere della prova — ubiquo
  'art. 115 c.p.c.',  // disponibilità prove — ubiquo
  'art. 116 c.p.c.',  // valutazione prove — ubiquo
  'art. 132 c.p.c.',  // motivazione sentenza — ubiquo
  'art. 360 c.p.c.',  // motivi cassazione — ubiquo
  'art. 112 c.p.c.',  // corrispondenza chiesto/pronunciato — ubiquo
  'art. 111 Cost.',   // giusto processo — ubiquo
  'art. 24 Cost.',    // diritto difesa — ubiquo
  'art. 3 Cost.',     // uguaglianza — ubiquo
]);

// ─────────────────────────────────────────────────────────────────────────────
// Normalizzazione norme (stessa logica di normalize_norme.py)
// ─────────────────────────────────────────────────────────────────────────────
function normalizeNorma(s) {
  if (!s) return s;
  s = s.replace(/,?\s+cod\.?\s*pen\./g,       ' c.p.');
  s = s.replace(/\s+cod\.?\s*proc\.?\s*pen\./g, ' c.p.p.');
  s = s.replace(/disp\.?\s*att\.?\s+cod\.?\s*proc\.?\s*pen\./g, 'disp. att. c.p.p.');
  s = s.replace(/\s+cod\.?\s*civ\./g,          ' c.c.');
  s = s.replace(/\s+cod\.?\s*proc\.?\s*civ\./g, ' c.p.c.');
  s = s.replace(/  +/g, ' ').trim();
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Estrai norme da norme_citate (due formati coesistono in DB)
// Formato A: [{"norma":"art. X c.c.","ruolo":"fondante"}, ...]
// Formato B: [{"art":"0110 00","sp":"COD","gen":"CC",...}, ...]
// ─────────────────────────────────────────────────────────────────────────────
const CODICE_MAP = {
  CC: 'c.c.', CP: 'c.p.', PV: 'c.p.p.', CV: 'c.p.c.',
  LS: 'legge', DL: 'd.lgs.', AM: 'disp. att.', CS: 'Cost.',
};

function parseNormeCitate(raw) {
  if (!raw || raw === '[]') return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(item => {
      if (typeof item === 'string') return normalizeNorma(item.trim());
      if (item.norma) return normalizeNorma(item.norma.trim());
      // Formato B: ricostruisci "art. X codice"
      if (item.art) {
        const num = parseInt(item.art, 10);
        const cod = CODICE_MAP[item.gen] || item.gen || '';
        return normalizeNorma(`art. ${num} ${cod}`.trim());
      }
      return null;
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
log('Avvio matching norma-ponte...');
const t0 = Date.now();

// 1. Carica mappa norma → [sentenzaId, ...] da relazioni_norme
log('Caricamento mappa norma → sentenze da relazioni_norme...');
const normaToSentenze = new Map(); // norma (string) → Set<sentenzaId>

const relRows = db.prepare(`
  SELECT norma_a, norma_b, fonte
  FROM relazioni_norme
  WHERE fonte_tipo = 'sentenza' AND fonte IS NOT NULL
`).all();

for (const r of relRows) {
  for (const norma of [r.norma_a, r.norma_b]) {
    if (!norma) continue;
    const n = normalizeNorma(norma);
    if (!normaToSentenze.has(n)) normaToSentenze.set(n, new Set());
    normaToSentenze.get(n).add(r.fonte);
  }
}
log(`  ${normaToSentenze.size} norme distinte con sentenze collegate`);
log(`  RAM: ${Math.round(process.memoryUsage().heapUsed/1024/1024)}MB`);

// 2. News con norme_citate
const newsQuery = LIMIT > 0
  ? `SELECT id, title, norme_citate FROM news WHERE norme_citate IS NOT NULL AND norme_citate != '' AND norme_citate != '[]' LIMIT ${LIMIT}`
  : `SELECT id, title, norme_citate FROM news WHERE norme_citate IS NOT NULL AND norme_citate != '' AND norme_citate != '[]'`;

const newsList = db.prepare(newsQuery).all();
log(`${newsList.length} news con norme_citate`);

// 3. Prepared statement con tipo_match
const stmtInsert = db.prepare(`
  INSERT OR IGNORE INTO relazioni_notizia_sentenza
    (notizia_id, sentenza_id, rilevanza, norma_ponte, tipo_match)
  VALUES (?, ?, ?, ?, ?)
`);

// 4. Matching
let totalForte = 0, totalDebole = 0, totalSkipped = 0;
const esempi = []; // per il report finale

const inserisci = db.transaction((batch) => {
  let n = 0;
  for (const [nId, sId, rilevanza, ponte, tipo] of batch) {
    const info = stmtInsert.run(nId, sId, rilevanza, ponte, tipo);
    if (info.changes > 0) n++;
  }
  return n;
});

let batch = [];
const BATCH_SZ = 1000;

for (const news of newsList) {
  const normeNews = parseNormeCitate(news.norme_citate);
  if (normeNews.length === 0) { totalSkipped++; continue; }

  // Mappa sentenzaId → norme in comune
  const sentenzaNormeMap = new Map(); // sentenzaId → [norma, ...]

  for (const norma of normeNews) {
    const sentenze = normaToSentenze.get(norma);
    if (!sentenze) continue;
    for (const sId of sentenze) {
      if (!sentenzaNormeMap.has(sId)) sentenzaNormeMap.set(sId, []);
      sentenzaNormeMap.get(sId).push(norma);
    }
  }

  for (const [sId, normeComuni] of sentenzaNormeMap) {
    const nonGeneriche = normeComuni.filter(n => !NORME_GENERICHE.has(n));
    const forteCount   = nonGeneriche.length;
    const totalComuni  = normeComuni.length;

    let tipo, rilevanza;
    if (forteCount >= 2 || totalComuni >= 3) {
      tipo = 'norma_ponte_forte';
      rilevanza = 'diretta';
      totalForte++;
    } else if (nonGeneriche.length >= 1) {
      tipo = 'norma_ponte_debole';
      rilevanza = 'indiretta';
      totalDebole++;
    } else {
      // Solo norme generiche in comune — non significativo
      continue;
    }

    const ponteTxt = normeComuni.slice(0, 3).join('; ');
    batch.push([news.id, sId, rilevanza, ponteTxt, tipo]);

    // Raccolta esempi per report
    if (esempi.length < 5 && tipo === 'norma_ponte_forte') {
      esempi.push({ newsId: news.id, newsTitle: news.title, sId, normeComuni: ponteTxt, tipo });
    }

    if (batch.length >= BATCH_SZ) {
      if (!DRYRUN) inserisci(batch);
      batch = [];
    }
  }
}

// Flush finale
if (batch.length > 0 && !DRYRUN) inserisci(batch);

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
log(`\n=== RISULTATI norma-ponte ===`);
log(`  News processate:     ${newsList.length}`);
log(`  News senza norme:    ${totalSkipped}`);
log(`  Link FORTE inseriti: ${DRYRUN ? '(dryrun)' : totalForte}`);
log(`  Link DEBOLE inseriti:${DRYRUN ? '(dryrun)' : totalDebole}`);
log(`  Tempo:               ${elapsed}s`);

if (DRYRUN) {
  log(`  (DRYRUN) avrebbe inserito: forte=${totalForte} debole=${totalDebole}`);
}

// Conteggio finale
const finalCount = db.prepare('SELECT COUNT(*) as c FROM relazioni_notizia_sentenza').get().c;
log(`\n  relazioni_notizia_sentenza TOTALE: ${finalCount}`);

const perTipo = db.prepare('SELECT tipo_match, COUNT(*) as c FROM relazioni_notizia_sentenza GROUP BY tipo_match ORDER BY c DESC').all();
log('  Per tipo:');
for (const r of perTipo) log(`    ${r.tipo_match || 'NULL'}: ${r.c}`);

// 5 esempi match forte
if (esempi.length > 0) {
  log('\n  Esempi match norma_ponte_forte:');
  for (const e of esempi) {
    log(`  📰 "${(e.newsTitle||'').substring(0,60)}"`);
    log(`     ↔ sentenza: ${e.sId}`);
    log(`     norme: ${e.normeComuni}`);
  }
}

db.close();
