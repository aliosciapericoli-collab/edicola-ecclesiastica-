/**
 * db.js — Storage del corpus di Edicola Ecclesiastica.
 *
 * DB SQLite: ecclesiastica/data/normativa.db, in modalità WAL.
 * STESSO schema di scrapers/normativa-corpus/db.js del progetto madre
 * (atti / articoli / articoli_fts / coda_priorita / meta), così server.js
 * serve il corpus con gli endpoint /api/normativa/* senza alcuna modifica.
 *
 * Differenza: la colonna `ordinamento` su atti e coda_priorita distingue i
 * cinque rami del corpus ecclesiastico:
 *   'canonico'         — CIC 1983, CCEO 1990
 *   'vaticano'         — leggi dello Stato della Città del Vaticano
 *   'ecclesiastico_it' — diritto ecclesiastico italiano (Normattiva)
 *   'magistero'        — documenti pontifici normativi (motu proprio, cost. ap.)
 *   'giurisprudenza'   — (solo coda; i testi vanno in cassazione-corpus.db)
 *
 * Per gli atti non-Normattiva l'URN è sintetico ma stabile:
 *   urn:vatican:cic:1983 · urn:vatican:cceo:1990 ·
 *   urn:vatican:scv:legge:<anno>;<sigla> · urn:vatican:magistero:<slug>
 */

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "..", "data", "normativa.db");

function openDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 30000");
  initSchema(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS atti (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      urn                TEXT NOT NULL UNIQUE,
      tipo               TEXT,
      numero             INTEGER,
      anno               INTEGER,
      data_pubblicazione TEXT,
      titolo             TEXT,
      url_fonte          TEXT,
      codice_redazionale TEXT,
      data_gu            TEXT,
      data_vigenza       TEXT,
      n_articoli         INTEGER DEFAULT 0,
      ordinamento        TEXT DEFAULT 'ecclesiastico_it',
      created_at         TEXT DEFAULT (datetime('now')),
      updated_at         TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_atti_tipo_anno ON atti (tipo, anno);
    CREATE INDEX IF NOT EXISTS idx_atti_numanno   ON atti (numero, anno);
    CREATE INDEX IF NOT EXISTS idx_atti_annonum   ON atti (anno, numero);
    CREATE INDEX IF NOT EXISTS idx_atti_ord       ON atti (ordinamento);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_atti_codred ON atti (codice_redazionale)
      WHERE codice_redazionale IS NOT NULL;

    CREATE TABLE IF NOT EXISTS articoli (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      atto_urn        TEXT NOT NULL,
      numero_articolo TEXT NOT NULL,
      rubrica         TEXT,
      testo_vigente   TEXT,
      ordine          INTEGER DEFAULT 0,
      updated_at      TEXT DEFAULT (datetime('now')),
      UNIQUE (atto_urn, numero_articolo)
    );
    CREATE INDEX IF NOT EXISTS idx_art_atto ON articoli (atto_urn, ordine);

    CREATE VIRTUAL TABLE IF NOT EXISTS articoli_fts USING fts5(
      testo_vigente,
      rubrica,
      content='articoli',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS articoli_ai AFTER INSERT ON articoli BEGIN
      INSERT INTO articoli_fts(rowid, testo_vigente, rubrica) VALUES (new.id, new.testo_vigente, new.rubrica);
    END;
    CREATE TRIGGER IF NOT EXISTS articoli_ad AFTER DELETE ON articoli BEGIN
      INSERT INTO articoli_fts(articoli_fts, rowid, testo_vigente, rubrica) VALUES('delete', old.id, old.testo_vigente, old.rubrica);
    END;
    CREATE TRIGGER IF NOT EXISTS articoli_au AFTER UPDATE ON articoli BEGIN
      INSERT INTO articoli_fts(articoli_fts, rowid, testo_vigente, rubrica) VALUES('delete', old.id, old.testo_vigente, old.rubrica);
      INSERT INTO articoli_fts(rowid, testo_vigente, rubrica) VALUES (new.id, new.testo_vigente, new.rubrica);
    END;

    CREATE TABLE IF NOT EXISTS coda_priorita (
      urn          TEXT PRIMARY KEY,
      etichetta    TEXT,
      frequenza    INTEGER DEFAULT 0,
      fonte        TEXT,
      rank         INTEGER,
      stato        TEXT DEFAULT 'pending',
      tentativi    INTEGER DEFAULT 0,
      nota         TEXT,
      ordinamento  TEXT DEFAULT 'ecclesiastico_it',
      added_at     TEXT DEFAULT (datetime('now')),
      processed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_coda_stato_rank ON coda_priorita (stato, rank);

    CREATE TABLE IF NOT EXISTS meta (
      chiave TEXT PRIMARY KEY,
      valore TEXT
    );
  `);
}

/* ------------------------------ ATTI ------------------------------ */

function upsertAtto(db, a) {
  db.prepare(`
    INSERT INTO atti (urn, tipo, numero, anno, data_pubblicazione, titolo, url_fonte,
                      codice_redazionale, data_gu, data_vigenza, n_articoli, ordinamento)
    VALUES (@urn, @tipo, @numero, @anno, @data_pubblicazione, @titolo, @url_fonte,
            @codice_redazionale, @data_gu, @data_vigenza, @n_articoli, @ordinamento)
    ON CONFLICT(urn) DO UPDATE SET
      tipo=excluded.tipo, numero=excluded.numero, anno=excluded.anno,
      data_pubblicazione=excluded.data_pubblicazione, titolo=excluded.titolo,
      url_fonte=excluded.url_fonte, codice_redazionale=excluded.codice_redazionale,
      data_gu=excluded.data_gu, data_vigenza=excluded.data_vigenza,
      n_articoli=excluded.n_articoli, ordinamento=excluded.ordinamento,
      updated_at=datetime('now')
  `).run({
    tipo: null, numero: null, anno: null, data_pubblicazione: null, titolo: null,
    url_fonte: null, codice_redazionale: null, data_gu: null, data_vigenza: null,
    n_articoli: 0, ordinamento: 'ecclesiastico_it', ...a,
  });
}

function countArticoli(db, urn) {
  return db.prepare("SELECT COUNT(*) c FROM articoli WHERE atto_urn=?").get(urn).c;
}

/**
 * Salva gli articoli/canoni di un atto in un'unica transazione.
 * arts: [{numero_articolo, rubrica, testo_vigente, ordine}]
 * Ritorna il numero di articoli scritti.
 */
function saveArticoli(db, urn, arts) {
  const ins = db.prepare(`
    INSERT INTO articoli (atto_urn, numero_articolo, rubrica, testo_vigente, ordine)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(atto_urn, numero_articolo) DO UPDATE SET
      rubrica=excluded.rubrica, testo_vigente=excluded.testo_vigente,
      ordine=excluded.ordine, updated_at=datetime('now')
  `);
  const tx = db.transaction((rows) => {
    let n = 0;
    for (const r of rows) {
      ins.run(urn, String(r.numero_articolo), r.rubrica || null, r.testo_vigente || '', r.ordine ?? n);
      n++;
    }
    db.prepare("UPDATE atti SET n_articoli=?, updated_at=datetime('now') WHERE urn=?")
      .run(rows.length, urn);
    return n;
  });
  return tx(arts);
}

/* ------------------------------ CODA ------------------------------ */

function enqueue(db, { urn, etichetta, fonte, rank, ordinamento, frequenza }) {
  db.prepare(`
    INSERT INTO coda_priorita (urn, etichetta, fonte, rank, ordinamento, frequenza)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(urn) DO NOTHING
  `).run(urn, etichetta || null, fonte || 'seed', rank ?? 9999, ordinamento || 'ecclesiastico_it', frequenza ?? 0);
}

function nextPending(db, ordinamento, limit = 1) {
  const q = ordinamento
    ? db.prepare("SELECT * FROM coda_priorita WHERE stato='pending' AND ordinamento=? ORDER BY rank, added_at LIMIT ?").all(ordinamento, limit)
    : db.prepare("SELECT * FROM coda_priorita WHERE stato='pending' ORDER BY rank, added_at LIMIT ?").all(limit);
  return q;
}

function markQueue(db, urn, stato, nota) {
  db.prepare(`
    UPDATE coda_priorita SET stato=?, nota=?, tentativi=tentativi+1, processed_at=datetime('now')
    WHERE urn=?
  `).run(stato, nota || null, urn);
}

function queueStats(db) {
  return db.prepare(`
    SELECT ordinamento, stato, COUNT(*) n FROM coda_priorita GROUP BY ordinamento, stato ORDER BY 1,2
  `).all();
}

/* ------------------------------ META ------------------------------ */

function getMeta(db, chiave) {
  const r = db.prepare("SELECT valore FROM meta WHERE chiave=?").get(chiave);
  return r ? r.valore : null;
}

function setMeta(db, chiave, valore) {
  db.prepare("INSERT INTO meta (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore=excluded.valore")
    .run(chiave, String(valore));
}

/* --------------------------- CONTATORE GIORNALIERO --------------------------- */
// Il tetto giornaliero (blocchi da 10.000 unità/giorno) è condiviso da tutti
// gli importer: ogni unità salvata (canone, articolo, documento, sentenza)
// incrementa il contatore del giorno corrente.

function ymdOggi() {
  return new Date().toISOString().slice(0, 10);
}

function unitaOggi(db) {
  return parseInt(getMeta(db, `run:${ymdOggi()}`) || '0', 10);
}

function aggiungiUnita(db, n) {
  const tot = unitaOggi(db) + n;
  setMeta(db, `run:${ymdOggi()}`, tot);
  return tot;
}

function stats(db) {
  return {
    atti: db.prepare("SELECT COUNT(*) c FROM atti").get().c,
    articoli: db.prepare("SELECT COUNT(*) c FROM articoli").get().c,
    per_ordinamento: db.prepare("SELECT ordinamento, COUNT(*) atti, SUM(n_articoli) unita FROM atti GROUP BY ordinamento").all(),
    coda: queueStats(db),
    unita_oggi: unitaOggi(db),
  };
}

module.exports = {
  DB_PATH,
  openDb,
  upsertAtto,
  countArticoli,
  saveArticoli,
  enqueue,
  nextPending,
  markQueue,
  queueStats,
  getMeta,
  setMeta,
  ymdOggi,
  unitaOggi,
  aggiungiUnita,
  stats,
};
