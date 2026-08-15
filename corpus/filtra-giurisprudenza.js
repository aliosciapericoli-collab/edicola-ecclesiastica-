/**
 * filtra-giurisprudenza.js — Giurisprudenza in materia ecclesiastica.
 *
 * NON riscarica nulla: filtra il corpus Cassazione del progetto madre
 * (../data/cassazione-corpus.db, ~424k provvedimenti con FTS5) con query
 * full-text canonico-ecclesiastiche e copia i provvedimenti pertinenti in
 * ecclesiastica/data/cassazione-corpus.db, stesso schema. Il server clonato
 * serve così la tab Cassazione con la sola giurisprudenza ecclesiastica.
 *
 * Idempotente: INSERT OR REPLACE per id; ricrea lo schema dalla sorgente.
 *
 * Uso: node corpus/filtra-giurisprudenza.js [--max N]
 */

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const store = require("./db");

// Override con ECCL_CASSAZIONE_SRC se il repo non è annidato dentro edicola-giuridica
const SRC = process.env.ECCL_CASSAZIONE_SRC ||
  path.join(__dirname, "..", "..", "data", "cassazione-corpus.db");
const DST = path.join(__dirname, "..", "data", "cassazione-corpus.db");

/** Query FTS5 (OR implicito tra le voci; frasi tra doppi apici). */
const QUERY_FTS = [
  '"diritto canonico"', '"diritto ecclesiastico"',
  '"matrimonio concordatario"', 'delibazione', '"tribunale ecclesiastico"',
  '"Rota Romana"', '"nullità del matrimonio canonico"', '"matrimonio canonico"',
  '"ente ecclesiastico"', '"enti ecclesiastici"', 'concordato NEAR/5 chiesa',
  '"otto per mille"', '"8 per mille"', '"sostentamento del clero"',
  '"libertà religiosa"', '"libertà di culto"', '"confessione religiosa"',
  '"confessioni religiose"', '"ministro di culto"', '"ministri di culto"',
  '"edificio di culto"', '"edifici di culto"', '"culti ammessi"',
  '"Santa Sede"', '"Città del Vaticano"', '"CEI" NEAR/10 vescovi',
  '"comunità ebraica"', '"tavola valdese"', 'moschea', 'sinagoga',
  '"simboli religiosi"', 'crocifisso NEAR/10 aula',
  '"ora di religione"', '"insegnamento della religione"',
].join(" OR ");

function run({ max = Infinity, budget } = {}) {
  if (!fs.existsSync(SRC)) {
    console.error(`[GIUR] Corpus sorgente non trovato: ${SRC}`);
    console.error("[GIUR] Questo filtro va eseguito sul server, dove esiste il corpus Cassazione.");
    return 0;
  }
  const src = new Database(SRC, { readonly: true });
  fs.mkdirSync(path.dirname(DST), { recursive: true });
  const dst = new Database(DST);
  dst.pragma("journal_mode = WAL");
  dst.pragma("busy_timeout = 30000");

  // 1. Schema copiato dalla sorgente (tabelle + indici + FTS, senza shadow table)
  const objs = src.prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 ELSE 3 END"
  ).all();
  for (const o of objs) {
    let sql = o.sql
      .replace(/^CREATE TABLE /i, "CREATE TABLE IF NOT EXISTS ")
      .replace(/^CREATE (UNIQUE )?INDEX /i, "CREATE $1INDEX IF NOT EXISTS ")
      .replace(/^CREATE TRIGGER /i, "CREATE TRIGGER IF NOT EXISTS ")
      .replace(/^CREATE VIRTUAL TABLE /i, "CREATE VIRTUAL TABLE IF NOT EXISTS ");
    if (/CREATE TABLE IF NOT EXISTS '?\w+_(data|idx|content|docsize|config)'?/i.test(sql)) continue;
    try { dst.exec(sql); } catch (e) { /* shadow/fts già esistenti */ }
  }

  // 2. Trova la tabella FTS e la tabella base della sorgente
  const ftsName = (src.prepare("SELECT name FROM sqlite_master WHERE sql LIKE '%fts5%' AND type='table' LIMIT 1").get() || {}).name;
  if (!ftsName) { console.error("[GIUR] Nessuna tabella FTS5 nella sorgente"); return 0; }
  const baseName = ftsName.replace(/_fts$/, "");

  // 3. Ricerca e copia
  const ids = src.prepare(
    `SELECT rowid FROM ${ftsName} WHERE ${ftsName} MATCH ? LIMIT ?`
  ).all(QUERY_FTS, max === Infinity ? 10_000_000 : max).map((r) => r.rowid);
  console.log(`[GIUR] ${ids.length} provvedimenti pertinenti trovati nel corpus madre`);

  const cols = src.prepare(`PRAGMA table_info(${baseName})`).all().map((c) => c.name);
  const colList = cols.join(", ");
  const sel = src.prepare(`SELECT ${colList} FROM ${baseName} WHERE rowid=?`);
  const ins = dst.prepare(
    `INSERT OR REPLACE INTO ${baseName} (${colList}) VALUES (${cols.map(() => "?").join(", ")})`
  );

  let copiati = 0;
  const tx = dst.transaction((batch) => {
    for (const id of batch) {
      const row = sel.get(id);
      if (!row) continue;
      if (budget && budget.remaining() <= 0) break;
      ins.run(...cols.map((c) => row[c]));
      if (budget) budget.spend(1);
      copiati++;
    }
  });
  for (let i = 0; i < ids.length; i += 500) {
    if (budget && budget.remaining() <= 0) { console.log("[GIUR] Tetto giornaliero raggiunto, mi fermo."); break; }
    tx(ids.slice(i, i + 500));
    if (copiati % 5000 < 500) console.log(`[GIUR] ${copiati} copiati…`);
  }

  console.log(`[GIUR] Copiati ${copiati} provvedimenti in ${DST}`);
  src.close();
  dst.close();
  return copiati;
}

if (require.main === module) {
  const mi = process.argv.indexOf("--max");
  const max = mi > -1 ? parseInt(process.argv[mi + 1], 10) : Infinity;
  run({ max });
}

module.exports = { run, QUERY_FTS };
