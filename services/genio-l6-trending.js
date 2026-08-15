'use strict';
/**
 * genio-l6-trending.js — L6 Genio Giuridico: Trending Norms
 *
 * Identifica norme con crescita anomala di citazioni nelle ultime settimane,
 * costruisce timeline mensili e identifica le aree giuridiche più in fermento.
 *
 * Fonti dati:
 *   - codici_news_link + news.published_at  → norme citate per data
 *   - relazioni_norme WHERE fonte_tipo='news' → sorgente alternativa/integrativa
 *   - grafo_norme_stats                      → trend_direzione storico
 *   - news.area_diritto / sub_area           → classificazione per area
 *
 * TUTTO SINCRONO — better-sqlite3 è sincrono. Niente async/await.
 */

const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'giuridica.db');

// ─── Connessione ─────────────────────────────────────────────────────────────
let _db = null;
function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('cache_size = -16000');
  }
  return _db;
}

// ─── Utility: estrae area dalla stringa norma ────────────────────────────────
function areaFromNorma(norma) {
  if (!norma) return 'Altro';
  const n = norma.toLowerCase();
  if (/\bc\.p\.p\./.test(n))                    return 'Cod. Procedura Penale';
  if (/\bc\.p\.c\./.test(n))                    return 'Cod. Procedura Civile';
  if (/\bc\.p\./.test(n))                        return 'Codice Penale';
  if (/\bc\.c\./.test(n))                        return 'Codice Civile';
  if (/\bcost\b/.test(n))                        return 'Costituzione';
  if (/t\.u\.i\.r\.|tuir/.test(n))              return 'TUIR';
  if (/d\.lgs\.\s*\d+\/2001|d\.lgs\.\s*231/.test(n)) return 'D.Lgs. 231/2001';
  if (/d\.lgs\b/.test(n))                        return 'Decreto Legislativo';
  if (/d\.l\b/.test(n))                          return 'Decreto Legge';
  if (/\bl\.\s*\d/.test(n))                      return 'Legge';
  if (/gdpr|regolamento ue/.test(n))             return 'GDPR / UE';
  return 'Altro';
}

// ─── A) getTrendingNorms(days, limit) ────────────────────────────────────────
/**
 * Conta citazioni per norma nel periodo recente vs il periodo precedente uguale.
 * Usa codici_news_link JOIN news.published_at come sorgente principale.
 * Integra con relazioni_norme WHERE fonte_tipo='news' per coprire le norme
 * non mappate in codici_news_link.
 */
function getTrendingNorms(days, limit) {
  days  = days  || 7;
  limit = limit || 30;
  const db = getDb();

  // ── Periodo recente: da -days a oggi ──
  const recentRows = db.prepare(`
    SELECT cnl.articolo_ref as norma, cnl.news_id, n.title, n.published_at
    FROM codici_news_link cnl
    JOIN news n ON n.id = cnl.news_id
    WHERE n.published_at >= datetime('now', ? || ' days')
      AND cnl.articolo_ref IS NOT NULL AND cnl.articolo_ref != ''
  `).all(`-${days}`);

  // ── Periodo precedente: da -2*days a -days ──
  const prevRows = db.prepare(`
    SELECT cnl.articolo_ref as norma, COUNT(*) as cnt
    FROM codici_news_link cnl
    JOIN news n ON n.id = cnl.news_id
    WHERE n.published_at >= datetime('now', ? || ' days')
      AND n.published_at <  datetime('now', ? || ' days')
      AND cnl.articolo_ref IS NOT NULL AND cnl.articolo_ref != ''
    GROUP BY cnl.articolo_ref
  `).all(`-${days * 2}`, `-${days}`);

  // ── Integrazione da relazioni_norme (fonte_tipo='news') ──
  // Usa creato_il come proxy della data
  const rnRecent = db.prepare(`
    SELECT norma_a as norma, COUNT(*) as cnt
    FROM relazioni_norme
    WHERE fonte_tipo = 'news'
      AND creato_il >= datetime('now', ? || ' days')
      AND norma_a IS NOT NULL AND norma_a != ''
    GROUP BY norma_a
  `).all(`-${days}`);

  const rnPrev = db.prepare(`
    SELECT norma_a as norma, COUNT(*) as cnt
    FROM relazioni_norme
    WHERE fonte_tipo = 'news'
      AND creato_il >= datetime('now', ? || ' days')
      AND creato_il <  datetime('now', ? || ' days')
      AND norma_a IS NOT NULL AND norma_a != ''
    GROUP BY norma_a
  `).all(`-${days * 2}`, `-${days}`);

  // Normalizza case: "Art. 89 c.p." → "art. 89 c.p."
  function normKey(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }

  // ── Aggrega ──
  const recentMap = new Map();  // norma → { cnt, notizie: [{id, title}], norma_display }
  for (const r of recentRows) {
    const key = normKey(r.norma);
    if (!recentMap.has(key)) recentMap.set(key, { cnt: 0, notizie: [], norma_display: key });
    const e = recentMap.get(key);
    e.cnt++;
    if (e.notizie.length < 3) e.notizie.push({ id: r.news_id, title: (r.title||'').substring(0, 80) });
  }
  // Integra relazioni_norme per norme non ancora in mappa
  for (const r of rnRecent) {
    const key = normKey(r.norma);
    if (!recentMap.has(key)) recentMap.set(key, { cnt: r.cnt, notizie: [], norma_display: key });
    else recentMap.get(key).cnt = Math.max(recentMap.get(key).cnt, r.cnt);
  }

  const prevMap = new Map();  // normaKey → cnt
  for (const r of prevRows) prevMap.set(normKey(r.norma), r.cnt);
  for (const r of rnPrev) {
    const key = normKey(r.norma);
    if (!prevMap.has(key)) prevMap.set(key, r.cnt);
    else prevMap.set(key, Math.max(prevMap.get(key), r.cnt));
  }

  // ── Calcola variazione ──
  const result = [];
  for (const [normaKey, rec] of recentMap) {
    const norma  = rec.norma_display || normaKey;
    const prev   = prevMap.get(normaKey) || 0;
    const recent = rec.cnt;

    let variazione_pct;
    let trend;
    if (prev === 0 && recent >= 3) {
      // "Nuova" solo se ha almeno 3 citazioni recenti (evita rumore da singoli articoli)
      variazione_pct = 999;
      trend = 'nuova';
    } else if (prev === 0) {
      // Poche citazioni senza storia — stabile a basso volume, non segnalare
      continue;
    } else if (prev < 3 && recent >= prev * 3) {
      // Periodo precedente con pochi dati ma forte crescita: considera crescente
      variazione_pct = Math.round(((recent - prev) / prev) * 100);
      trend = 'crescente';
    } else {
      variazione_pct = Math.round(((recent - prev) / prev) * 100);
      if      (variazione_pct >= 50)  trend = 'crescente';
      else if (variazione_pct <= -30) trend = 'calante';
      else                            trend = 'stabile';
    }

    result.push({
      codice_norma:         norma,
      area:                 areaFromNorma(norma),
      citazioni_recenti:    recent,
      citazioni_precedenti: prev,
      variazione_pct,
      trend,
      notizie_esempio:      rec.notizie,
    });
  }

  // Ordina: nuove prima, poi per variazione_pct DESC
  result.sort((a, b) => {
    if (a.variazione_pct === 999 && b.variazione_pct !== 999) return -1;
    if (b.variazione_pct === 999 && a.variazione_pct !== 999) return  1;
    return b.variazione_pct - a.variazione_pct;
  });

  return result.slice(0, limit);
}

// ─── B) getNormTimeline(codice_norma, months) ────────────────────────────────
/**
 * Restituisce le citazioni mensili di una norma negli ultimi N mesi.
 * Usa codici_news_link JOIN news.published_at.
 */
function getNormTimeline(codiceNorma, months) {
  months = months || 6;
  if (!codiceNorma) return { ok: false, error: 'codice norma mancante' };

  const db = getDb();

  // Conta per mese via codici_news_link
  const rows = db.prepare(`
    SELECT strftime('%Y-%m', n.published_at) as mese, COUNT(*) as conteggio
    FROM codici_news_link cnl
    JOIN news n ON n.id = cnl.news_id
    WHERE cnl.articolo_ref = ?
      AND n.published_at >= datetime('now', ? || ' months')
      AND n.published_at IS NOT NULL
    GROUP BY mese
    ORDER BY mese ASC
  `).all(codiceNorma, `-${months}`);

  // Integra da relazioni_norme se la norma ha pochi dati
  const rnRows = db.prepare(`
    SELECT strftime('%Y-%m', creato_il) as mese, COUNT(*) as conteggio
    FROM relazioni_norme
    WHERE norma_a = ? AND fonte_tipo = 'news'
      AND creato_il >= datetime('now', ? || ' months')
    GROUP BY mese
    ORDER BY mese ASC
  `).all(codiceNorma, `-${months}`);

  // Merge: usa il max tra le due sorgenti per mese
  const meseMap = new Map();
  for (const r of rows)   meseMap.set(r.mese, r.conteggio);
  for (const r of rnRows) {
    if (!meseMap.has(r.mese)) meseMap.set(r.mese, r.conteggio);
    else meseMap.set(r.mese, Math.max(meseMap.get(r.mese), r.conteggio));
  }

  // Costruisci serie completa (tutti i mesi, anche quelli a 0)
  const timeline = [];
  const now   = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d    = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mese = d.toISOString().substring(0, 7); // "YYYY-MM"
    timeline.push({ mese, conteggio: meseMap.get(mese) || 0 });
  }

  // Statistiche
  const conteggi  = timeline.map(t => t.conteggio);
  const totale    = conteggi.reduce((a, b) => a + b, 0);
  const mediaMsg  = totale / months;
  const ultimoMese = conteggi[conteggi.length - 1] || 0;
  const penultimoMese = conteggi[conteggi.length - 2] || 0;
  const trendUltimo = ultimoMese > penultimoMese * 1.2 ? 'crescente'
                    : ultimoMese < penultimoMese * 0.8 ? 'calante'
                    : 'stabile';

  return {
    ok:             true,
    norma:          codiceNorma,
    area:           areaFromNorma(codiceNorma),
    mesi_analizzati: months,
    totale_citazioni: totale,
    media_mensile:  Math.round(mediaMsg * 10) / 10,
    trend_ultimo_mese: trendUltimo,
    timeline,
  };
}

// ─── C) getHotTopics(limit) ──────────────────────────────────────────────────
/**
 * Raggruppa le norme trending per area giuridica.
 * Usa una finestra di 14 giorni per avere dati significativi.
 */
function getHotTopics(limit) {
  limit = limit || 10;
  const db = getDb();

  // Conta citazioni per norma nelle ultime 2 settimane
  const rows = db.prepare(`
    SELECT cnl.articolo_ref as norma, COUNT(*) as cnt_recente,
           n.area_diritto, n.sub_area
    FROM codici_news_link cnl
    JOIN news n ON n.id = cnl.news_id
    WHERE n.published_at >= datetime('now', '-14 days')
      AND cnl.articolo_ref IS NOT NULL AND cnl.articolo_ref != ''
    GROUP BY cnl.articolo_ref
    ORDER BY cnt_recente DESC
  `).all();

  // Conta periodo precedente per variazione
  const prevMap = new Map();
  const prevRows = db.prepare(`
    SELECT cnl.articolo_ref as norma, COUNT(*) as cnt
    FROM codici_news_link cnl
    JOIN news n ON n.id = cnl.news_id
    WHERE n.published_at >= datetime('now', '-28 days')
      AND n.published_at <  datetime('now', '-14 days')
      AND cnl.articolo_ref IS NOT NULL
    GROUP BY cnl.articolo_ref
  `).all();
  for (const r of prevRows) prevMap.set(r.norma, r.cnt);

  // Raggruppa per area
  const areaMap = new Map(); // area → { norme: [{norma, cnt, var_pct}] }

  for (const r of rows) {
    const area   = areaFromNorma(r.norma);
    const prev   = prevMap.get(r.norma) || 0;
    const varPct = prev > 0 ? Math.round(((r.cnt_recente - prev) / prev) * 100) : 999;

    if (!areaMap.has(area)) areaMap.set(area, { area, norme: [], totale_citazioni: 0 });
    const entry = areaMap.get(area);
    entry.norme.push({ norma: r.norma, cnt: r.cnt_recente, variazione_pct: varPct });
    entry.totale_citazioni += r.cnt_recente;
  }

  // Calcola statistiche per area
  const result = [];
  for (const [area, entry] of areaMap) {
    entry.norme.sort((a, b) => b.cnt - a.cnt);
    const topNorma   = entry.norme[0];
    const normeTrend = entry.norme.filter(n => n.variazione_pct > 50 || n.variazione_pct === 999).length;
    const varMedia   = entry.norme.reduce((s, n) => s + Math.min(n.variazione_pct, 500), 0) / entry.norme.length;

    result.push({
      area,
      norme_attive:    entry.norme.length,
      norme_trending:  normeTrend,
      totale_citazioni: entry.totale_citazioni,
      variazione_media_pct: Math.round(varMedia),
      top_norma:       topNorma?.norma  || '',
      top_norma_cnt:   topNorma?.cnt    || 0,
      top_norma_var:   topNorma?.variazione_pct ?? null,
      // Top 5 norme dell'area
      top_norme:       entry.norme.slice(0, 5).map(n => ({
        norma: n.norma,
        citazioni: n.cnt,
        variazione_pct: n.variazione_pct,
      })),
    });
  }

  // Ordina per fermento: norme_trending DESC, poi totale_citazioni DESC
  result.sort((a, b) => (b.norme_trending - a.norme_trending) || (b.totale_citazioni - a.totale_citazioni));
  return result.slice(0, limit);
}

// ─── Invalida cache (se necessario in futuro) ────────────────────────────────
function invalidateCache() {
  // nessuna cache persistente per ora — le query sono rapide (~50ms)
}

module.exports = {
  getTrendingNorms,
  getNormTimeline,
  getHotTopics,
  areaFromNorma,
  invalidateCache,
};
