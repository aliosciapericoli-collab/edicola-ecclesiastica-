'use strict';
/**
 * genio-l6-collisions.js — L6 Genio Giuridico: Collision Detector
 *
 * Individua norme "contese" — quelle coinvolte in contrasti interpretativi aperti
 * tra sentenze della Cassazione.
 *
 * Fonti dati:
 *   - giuridica.db: relazioni_sentenze (tipo='contrasto_aperto'), news, norme_citate
 *   - cassazione.db: sentenze (metadati: sezione, data_decisione, oggetto, massima)
 *
 * TUTTO SINCRONO — better-sqlite3 è sincrono, niente async/await.
 */

const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH   = path.join(__dirname, '..', 'data', 'giuridica.db');
const CASS_PATH = path.join(__dirname, '..', 'data', 'cassazione.db');

// ─── Connessioni ────────────────────────────────────────────────────────────
let _db     = null;
let _cassDb = null;

function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('cache_size = -16000');
    // ALTER TABLE se la colonna non esiste ancora
    try {
      _db.exec('ALTER TABLE news ADD COLUMN scalata_l6_collisions TEXT');
    } catch(e) { /* colonna già esiste — ok */ }
  }
  return _db;
}

function getCassDb() {
  if (!_cassDb) {
    try {
      _cassDb = new Database(CASS_PATH, { readonly: true });
      _cassDb.pragma('cache_size = -16000');
    } catch(e) {
      console.error('[L6] cassazione.db non disponibile:', e.message);
    }
  }
  return _cassDb;
}

// ─── Normalizzazione norme ───────────────────────────────────────────────────
// Riduce varianti tipografiche a una forma canonica per il raggruppamento
function normalizeNorma(s) {
  if (!s) return '';
  return s
    .replace(/,\s*/g, ' ')           // virgole → spazio
    .replace(/\s+/g, ' ')            // spazi multipli → uno
    .replace(/primo\s+comma/gi, 'comma 1')
    .replace(/secondo\s+comma/gi, 'comma 2')
    .replace(/terzo\s+comma/gi, 'comma 3')
    .replace(/\bn\.\s*/gi, 'n. ')    // "n." con spazio
    .replace(/comma\s+(\d)/gi, 'comma $1')
    .trim()
    .toLowerCase();
}

// Raggruppa chiavi normalizzate → stringa canonica (la più comune nel gruppo)
function canonicalize(normaRaw) {
  return normaRaw ? normaRaw.trim() : normaRaw;
}

// ─── A) detectCollisions() ───────────────────────────────────────────────────
/**
 * Legge tutti i contrasti da relazioni_sentenze WHERE tipo='contrasto_aperto'.
 * Raggruppa per norma_comune normalizzata.
 * Restituisce Map: normaKey → { norma, contrasti[], sentenze_ids[] }
 */
function detectCollisions() {
  const db     = getDb();
  const cassDb = getCassDb();

  // 1. Leggi tutti i contrasti con norma_comune
  const rows = db.prepare(`
    SELECT id, sentenza_a, sentenza_b, norma_comune, creato_il
    FROM relazioni_sentenze
    WHERE tipo = 'contrasto_aperto' AND norma_comune IS NOT NULL AND norma_comune != ''
    ORDER BY creato_il DESC
  `).all();

  // 2. Raggruppa per norma normalizzata
  const byNorma = new Map(); // normaKey → { norma_canonica, contrasti[] }

  for (const row of rows) {
    const key = normalizeNorma(row.norma_comune);
    if (!key) continue;
    if (!byNorma.has(key)) {
      byNorma.set(key, {
        norma_key:     key,
        norma_canonica: canonicalize(row.norma_comune),
        contrasti: [],
        sentenze_ids: new Set(),
      });
    }
    const entry = byNorma.get(key);
    entry.contrasti.push({
      id: row.id,
      sentenza_a: row.sentenza_a,
      sentenza_b: row.sentenza_b,
      creato_il:  row.creato_il,
    });
    entry.sentenze_ids.add(row.sentenza_a);
    entry.sentenze_ids.add(row.sentenza_b);
  }

  // 3. Arricchisci con metadati sentenze (lazily, solo un campione per performance)
  if (cassDb) {
    const stmtSent = cassDb.prepare(
      'SELECT id, data_decisione, sezione, oggetto FROM sentenze WHERE id = ?'
    );
    for (const [, entry] of byNorma) {
      // Prendi max 2 contrasti per il campione
      for (const c of entry.contrasti.slice(0, 2)) {
        const sa = stmtSent.get(c.sentenza_a);
        const sb = stmtSent.get(c.sentenza_b);
        if (sa) c.meta_a = { data: sa.data_decisione, sezione: sa.sezione, oggetto: (sa.oggetto||'').substring(0,120) };
        if (sb) c.meta_b = { data: sb.data_decisione, sezione: sb.sezione, oggetto: (sb.oggetto||'').substring(0,120) };
      }
      entry.sentenze_ids = [...entry.sentenze_ids]; // converte Set → Array
    }
  } else {
    for (const [, entry] of byNorma) {
      entry.sentenze_ids = [...entry.sentenze_ids];
    }
  }

  return byNorma;
}

// Cache in memoria (si ricalcola ogni ora al massimo)
let _collisionsCache   = null;
let _collisionsCacheTs = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 ora

function getCollisionsMap() {
  const now = Date.now();
  if (!_collisionsCache || now - _collisionsCacheTs > CACHE_TTL_MS) {
    _collisionsCache   = detectCollisions();
    _collisionsCacheTs = now;
  }
  return _collisionsCache;
}

// ─── B) getCollisionReport(codice_norma) ────────────────────────────────────
/**
 * Per una norma specifica, restituisce tutti i contrasti che la coinvolgono.
 * @param {string} codiceNorma — testo della norma (es. "art. 360 c.p.c.")
 * @returns {{ norma, num_contrasti, contrasti: Array }}
 */
function getCollisionReport(codiceNorma) {
  if (!codiceNorma) return { ok: false, error: 'codice norma mancante' };

  const db     = getDb();
  const cassDb = getCassDb();
  const key    = normalizeNorma(codiceNorma);

  // Cerca in relazioni_sentenze con LIKE per catturare varianti
  const rows = db.prepare(`
    SELECT id, sentenza_a, sentenza_b, norma_comune, creato_il
    FROM relazioni_sentenze
    WHERE tipo = 'contrasto_aperto'
      AND (norma_comune LIKE ? OR norma_comune LIKE ?)
    ORDER BY creato_il DESC
    LIMIT 100
  `).all(`%${codiceNorma}%`, `%${codiceNorma.split(' ').slice(0,3).join(' ')}%`);

  // Dedup per ID
  const seen = new Set();
  const deduped = rows.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });

  const stmtSent = cassDb
    ? cassDb.prepare('SELECT id, numero, anno, data_decisione, sezione, oggetto, massima FROM sentenze WHERE id = ?')
    : null;

  const contrasti = deduped.map(row => {
    const sa = stmtSent ? stmtSent.get(row.sentenza_a) : null;
    const sb = stmtSent ? stmtSent.get(row.sentenza_b) : null;
    return {
      id:         row.id,
      norma:      row.norma_comune,
      creato_il:  row.creato_il,
      sentenza_a: row.sentenza_a,
      sentenza_b: row.sentenza_b,
      data_a:     sa?.data_decisione || null,
      data_b:     sb?.data_decisione || null,
      sezione_a:  sa?.sezione        || null,
      sezione_b:  sb?.sezione        || null,
      oggetto_a:  (sa?.oggetto || '').substring(0, 200),
      oggetto_b:  (sb?.oggetto || '').substring(0, 200),
      massima_a:  (sa?.massima || '').substring(0, 300),
      massima_b:  (sb?.massima || '').substring(0, 300),
      label_a:    sa ? `Cass. n. ${sa.numero}/${sa.anno} ${sa.sezione||''}`.trim() : row.sentenza_a,
      label_b:    sb ? `Cass. n. ${sb.numero}/${sb.anno} ${sb.sezione||''}`.trim() : row.sentenza_b,
    };
  });

  return {
    ok:           true,
    norma:        codiceNorma,
    norma_key:    key,
    num_contrasti: contrasti.length,
    contrasti,
  };
}

// ─── C) getTopCollisions(limit) ─────────────────────────────────────────────
/**
 * Restituisce le norme con più contrasti aperti — le più "pericolose".
 * @param {number} limit — max norme da restituire (default 50)
 * @returns {Array<{codice_norma, num_contrasti, ultimo_contrasto_data, sentenze_esempio}>}
 */
function getTopCollisions(limit) {
  limit = limit || 50;
  const map    = getCollisionsMap();
  const result = [];

  for (const [, entry] of map) {
    const ultContrasto = entry.contrasti[0]; // ordinati per data DESC
    const sentenze_esempio = entry.contrasti
      .slice(0, 3)
      .map(c => ({
        sentenza_a: c.sentenza_a,
        sentenza_b: c.sentenza_b,
        meta_a: c.meta_a || null,
        meta_b: c.meta_b || null,
        data:   c.creato_il,
      }));

    result.push({
      codice_norma:         entry.norma_canonica,
      num_contrasti:        entry.contrasti.length,
      ultimo_contrasto_data: ultContrasto?.creato_il || null,
      num_sentenze_coinvolte: entry.sentenze_ids.length,
      sentenze_esempio,
    });
  }

  // Ordina per numero contrasti DESC
  result.sort((a, b) => b.num_contrasti - a.num_contrasti);
  return result.slice(0, limit);
}

// ─── D) enrichNewsWithCollisions(newsId) ────────────────────────────────────
/**
 * Per un articolo con norme_citate, controlla quali norme sono "contese".
 * Salva il risultato in scalata_l6_collisions.
 * @param {string|null} newsId — null = processa tutti gli articoli con norme_citate
 */
function enrichNewsWithCollisions(newsId) {
  const db  = getDb();
  const map = getCollisionsMap();

  // Costruisci indice rapido norma_key → num_contrasti
  const normaIndex = new Map();
  for (const [key, entry] of map) {
    normaIndex.set(key, { num_contrasti: entry.contrasti.length, norma: entry.norma_canonica });
  }

  const query = newsId
    ? db.prepare("SELECT id, norme_citate FROM news WHERE id = ? AND norme_citate IS NOT NULL AND norme_citate != '' AND norme_citate != '[]'")
    : db.prepare("SELECT id, norme_citate FROM news WHERE norme_citate IS NOT NULL AND norme_citate != '' AND norme_citate != '[]' AND (scalata_l6_collisions IS NULL OR scalata_l6_collisions = '')");

  const newsList = newsId ? query.all(newsId) : query.all();

  const stmtUpdate = db.prepare('UPDATE news SET scalata_l6_collisions = ? WHERE id = ?');
  const insertBatch = db.transaction((items) => {
    for (const [id, payload] of items) stmtUpdate.run(payload, id);
  });

  const updates = [];
  let contese = 0;

  for (const news of newsList) {
    let norme = [];
    try {
      const arr = JSON.parse(news.norme_citate);
      norme = arr.map(n => typeof n === 'string' ? n : (n.norma || '')).filter(Boolean);
    } catch(e) { continue; }

    const normeContese = [];
    for (const norma of norme) {
      const key  = normalizeNorma(norma);
      const hit  = normaIndex.get(key);
      if (hit) {
        normeContese.push({ norma, num_contrasti: hit.num_contrasti });
      }
    }

    if (normeContese.length > 0) {
      contese++;
      updates.push([news.id, JSON.stringify({
        norme_contese: normeContese,
        max_contrasti: Math.max(...normeContese.map(n => n.num_contrasti)),
        aggiornato_il: new Date().toISOString(),
      })]);
    }

    if (updates.length >= 500) {
      insertBatch(updates.splice(0));
    }
  }
  if (updates.length > 0) insertBatch(updates);

  return { processate: newsList.length, con_collisione: contese };
}

// ─── E) getNewsCollisions(newsId) ───────────────────────────────────────────
/**
 * Per un articolo specifico: restituisce le norme contese citate nell'articolo.
 */
function getNewsCollisions(newsId) {
  const db = getDb();
  const news = db.prepare('SELECT id, title, norme_citate, scalata_l6_collisions FROM news WHERE id = ?').get(newsId);
  if (!news) return { ok: false, error: 'news non trovata' };

  // Se già calcolato e fresco, usa cache
  if (news.scalata_l6_collisions) {
    try {
      const cached = JSON.parse(news.scalata_l6_collisions);
      if (cached.norme_contese) {
        // Arricchisci con collision report per ogni norma contesa
        const dettagli = cached.norme_contese.map(nc => {
          const report = getCollisionReport(nc.norma);
          return {
            norma:         nc.norma,
            num_contrasti: nc.num_contrasti,
            esempi:        (report.contrasti || []).slice(0, 3),
          };
        });
        return { ok: true, news_id: newsId, title: news.title, norme_contese: dettagli };
      }
    } catch(e) {}
  }

  // Calcola al volo
  enrichNewsWithCollisions(newsId);
  const refreshed = db.prepare('SELECT scalata_l6_collisions FROM news WHERE id = ?').get(newsId);
  if (!refreshed?.scalata_l6_collisions) return { ok: true, news_id: newsId, title: news.title, norme_contese: [] };

  try {
    const data = JSON.parse(refreshed.scalata_l6_collisions);
    return { ok: true, news_id: newsId, title: news.title, norme_contese: data.norme_contese || [] };
  } catch(e) {
    return { ok: false, error: 'parse error' };
  }
}

// ─── Invalida cache (chiamabile dall'esterno se il DB viene aggiornato) ─────
function invalidateCache() {
  _collisionsCache   = null;
  _collisionsCacheTs = 0;
}

module.exports = {
  detectCollisions,
  getCollisionReport,
  getTopCollisions,
  enrichNewsWithCollisions,
  getNewsCollisions,
  invalidateCache,
};
