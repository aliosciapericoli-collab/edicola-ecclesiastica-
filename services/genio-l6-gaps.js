'use strict';
/**
 * genio-l6-gaps.js — L6 Genio Giuridico: Gap Giurisprudenziali
 *
 * Identifica norme molto citate nelle news ma con poche/zero sentenze:
 * aree dove il diritto è incerto, in formazione o non ancora consolidato.
 *
 * Fonte dati:
 *   - grafo_norme_stats: tot_notizie, tot_sentenze per norma
 *   - codici_news_link + news: notizie recenti che citano la norma
 *
 * TUTTO SINCRONO — better-sqlite3 è sincrono. Niente async/await.
 */

const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'giuridica.db');

// ─── Connessione ─────────────────────────────────────────────────────────────
let _db = null;
function getDb() {
  if (_db) return _db;
  try {
    const Database = require('better-sqlite3');
    _db = new Database(DB_PATH, { readonly: true });
    _db.pragma('cache_size = -16000');
    return _db;
  } catch(e) {
    console.error('[L6-gaps] DB non disponibile:', e.message);
    return null;
  }
}

// ─── Utility: classificazione area dalla stringa norma ───────────────────────
function areaFromNorma(norma) {
  if (!norma) return 'Altro';
  const n = norma.toLowerCase();
  if (/\bc\.p\.p\./.test(n))                         return 'Cod. Procedura Penale';
  if (/\bc\.p\.c\./.test(n))                         return 'Cod. Procedura Civile';
  if (/\bc\.p\./.test(n) || /^c\.p\b/.test(n))       return 'Codice Penale';
  if (/\bc\.c\./.test(n) || /^art\.\s+c\.c\b/.test(n)) return 'Codice Civile';
  if (/\bcost\b/.test(n))                             return 'Costituzione';
  if (/t\.u\.i\.r\.|tuir/.test(n))                   return 'TUIR';
  if (/gdpr|regolamento ue|ai act/.test(n))          return 'Normativa UE';
  if (/d\.lgs\b/.test(n))                            return 'Decreto Legislativo';
  if (/d\.l\b/.test(n))                              return 'Decreto Legge';
  if (/\bl\.\s*\d/.test(n))                          return 'Legge';
  if (/codice della strada/.test(n))                 return 'Cod. della Strada';
  if (/irap|iva|irpef|tributar/.test(n))             return 'Tributario';
  if (/principio|riforma|legge di bilancio/.test(n)) return 'Principi / Riforme';
  return 'Altro';
}

// ─── Helper: notizie recenti per una norma ───────────────────────────────────
// Cerca in codici_news_link (norma mappata) + relazioni_norme (norma testuale)
function getNotiziePerNorma(db, norma, limit) {
  limit = limit || 3;

  // Prima via: codici_news_link con articolo_ref (testo canonico norma)
  const rows1 = db.prepare(`
    SELECT DISTINCT n.id, n.title, n.published_at, n.source_name
    FROM codici_news_link cnl
    JOIN news n ON n.id = cnl.news_id
    WHERE cnl.articolo_ref = ?
      AND n.title IS NOT NULL AND n.title != ''
    ORDER BY n.published_at DESC
    LIMIT ?
  `).all(norma, limit);

  if (rows1.length >= limit) {
    return rows1.map(r => ({
      id:       r.id,
      title:    (r.title || '').substring(0, 90),
      pub_date: r.published_at ? r.published_at.substring(0, 10) : null,
      source:   r.source_name || '',
    }));
  }

  // Seconda via: relazioni_norme con norma_a testuale
  const rows2 = db.prepare(`
    SELECT DISTINCT n.id, n.title, n.published_at, n.source_name
    FROM relazioni_norme rn
    JOIN news n ON n.id = rn.fonte
    WHERE rn.norma_a = ? AND rn.fonte_tipo = 'news'
      AND n.title IS NOT NULL AND n.title != ''
    ORDER BY n.published_at DESC
    LIMIT ?
  `).all(norma, limit);

  const merged = [...rows1, ...rows2.filter(r2 => !rows1.some(r1 => r1.id === r2.id))];
  return merged.slice(0, limit).map(r => ({
    id:       r.id,
    title:    (r.title || '').substring(0, 90),
    pub_date: r.published_at ? r.published_at.substring(0, 10) : null,
    source:   r.source_name || '',
  }));
}

// ─── A) getJurisprudentialGaps(minNotizie, limit) ────────────────────────────
/**
 * Norme citate almeno minNotizie volte nelle news ma con ZERO sentenze.
 * Queste sono le norme su cui la Cassazione non si è ancora pronunciata
 * nonostante l'attenzione mediatica.
 */
function getJurisprudentialGaps(minNotizie, limit) {
  minNotizie = minNotizie || 3;
  limit      = limit      || 50;
  const db   = getDb();
  if (!db) return [];

  const rows = db.prepare(`
    SELECT norma, tot_notizie, tot_sentenze, tot_relazioni, trend_direzione
    FROM grafo_norme_stats
    WHERE tot_notizie >= ? AND tot_sentenze = 0
    ORDER BY tot_notizie DESC
    LIMIT ?
  `).all(minNotizie, limit);

  return rows.map(r => ({
    codice_norma:    r.norma,
    area:            areaFromNorma(r.norma),
    tot_notizie:     r.tot_notizie,
    tot_sentenze:    0,
    tot_relazioni:   r.tot_relazioni,
    trend:           r.trend_direzione || 'stabile',
    gap_score:       r.tot_notizie,   // più notizie = gap più rilevante
    notizie_recenti: getNotiziePerNorma(db, r.norma, 3),
    tipo_gap:        'assoluto',      // zero sentenze
  }));
}

// ─── B) getUnderservedNorms(limit) ───────────────────────────────────────────
/**
 * Norme con MOLTE notizie ma POCHE sentenze.
 * Ratio = tot_notizie / (tot_sentenze + 1)
 * Ratio > 10: enorme attenzione mediatica, scarsa risposta giurisprudenziale.
 */
function getUnderservedNorms(limit) {
  limit    = limit || 50;
  const db = getDb();
  if (!db) return [];

  const rows = db.prepare(`
    SELECT norma, tot_notizie, tot_sentenze, tot_relazioni, trend_direzione,
           CAST(tot_notizie AS REAL) / (tot_sentenze + 1) as ratio
    FROM grafo_norme_stats
    WHERE tot_notizie >= 3
      AND CAST(tot_notizie AS REAL) / (tot_sentenze + 1) >= 2.0
    ORDER BY ratio DESC
    LIMIT ?
  `).all(limit);

  return rows.map(r => ({
    codice_norma:    r.norma,
    area:            areaFromNorma(r.norma),
    tot_notizie:     r.tot_notizie,
    tot_sentenze:    r.tot_sentenze,
    ratio:           Math.round(r.ratio * 10) / 10,
    trend:           r.trend_direzione || 'stabile',
    tipo_gap:        r.tot_sentenze === 0 ? 'assoluto' : 'relativo',
    interpretazione: r.tot_sentenze === 0
      ? 'Norma molto discussa, nessuna pronuncia di legittimità'
      : `${r.tot_notizie} notizie vs ${r.tot_sentenze} sentenze — diritto in formazione`,
    notizie_recenti: getNotiziePerNorma(db, r.norma, 2),
  }));
}

// ─── C) getGapsByArea() ──────────────────────────────────────────────────────
/**
 * Raggruppa i gap per area giuridica.
 * Usa tutti i gap (tot_sentenze = 0, tot_notizie >= 1).
 */
function getGapsByArea() {
  const db = getDb();
  if (!db) return [];

  const rows = db.prepare(`
    SELECT norma, tot_notizie, tot_sentenze
    FROM grafo_norme_stats
    WHERE tot_notizie > 0 AND tot_sentenze = 0
    ORDER BY tot_notizie DESC
  `).all();

  // Raggruppa per area
  const areaMap = new Map();
  for (const r of rows) {
    const area = areaFromNorma(r.norma);
    if (!areaMap.has(area)) {
      areaMap.set(area, { area, gap_count: 0, tot_notizie: 0, norme: [] });
    }
    const entry = areaMap.get(area);
    entry.gap_count++;
    entry.tot_notizie += r.tot_notizie;
    if (entry.norme.length < 5) {
      entry.norme.push({ norma: r.norma, notizie: r.tot_notizie });
    }
  }

  const result = [];
  for (const [, entry] of areaMap) {
    const top = entry.norme[0];
    result.push({
      area:          entry.area,
      gap_count:     entry.gap_count,
      tot_notizie:   entry.tot_notizie,
      top_gap:       top?.norma || '',
      top_gap_notizie: top?.notizie || 0,
      top_norme:     entry.norme,
    });
  }

  // Ordina per gap_count DESC, poi tot_notizie DESC
  result.sort((a, b) => (b.gap_count - a.gap_count) || (b.tot_notizie - a.tot_notizie));
  return result;
}

// ─── D) getSummary() ─────────────────────────────────────────────────────────
/**
 * Statistiche riassuntive — quanti gap esistono, distribuzione per soglia.
 */
function getSummary() {
  const db = getDb();
  if (!db) return {};

  const total     = db.prepare("SELECT COUNT(*) as n FROM grafo_norme_stats WHERE tot_notizie > 0 AND tot_sentenze = 0").get().n;
  const hiPriority = db.prepare("SELECT COUNT(*) as n FROM grafo_norme_stats WHERE tot_notizie >= 5 AND tot_sentenze = 0").get().n;
  const underserved = db.prepare("SELECT COUNT(*) as n FROM grafo_norme_stats WHERE tot_notizie >= 3 AND CAST(tot_notizie AS REAL)/(tot_sentenze+1) >= 10").get().n;
  const topGap    = db.prepare("SELECT norma, tot_notizie FROM grafo_norme_stats WHERE tot_sentenze = 0 ORDER BY tot_notizie DESC LIMIT 1").get();

  return { total_gap_assoluti: total, gap_alta_priorita: hiPriority, underserved, top_gap: topGap };
}

module.exports = {
  getJurisprudentialGaps,
  getUnderservedNorms,
  getGapsByArea,
  getSummary,
  areaFromNorma,
};
