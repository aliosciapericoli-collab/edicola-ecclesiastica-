/**
 * init-db.js — Inizializza i database di Edicola Ecclesiastica.
 *
 * Crea ecclesiastica/data/giuridica.db copiando lo SCHEMA (non i dati) dal
 * database del progetto madre (../data/giuridica.db), così la struttura resta
 * identica a quella che server.js e la pipeline Scalata si aspettano.
 *
 * Uso (dalla cartella ecclesiastica/):
 *   node scripts/init-db.js
 *
 * Idempotente: usa CREATE TABLE IF NOT EXISTS riscrivendo gli statement.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Override con ECCL_GIURIDICA_SRC se il repo non è annidato dentro edicola-giuridica
const SRC = process.env.ECCL_GIURIDICA_SRC ||
  path.join(__dirname, '..', '..', 'data', 'giuridica.db');
const DST_DIR = path.join(__dirname, '..', 'data');
const DST = path.join(DST_DIR, 'giuridica.db');

if (!fs.existsSync(SRC)) {
  console.error(`Database sorgente non trovato: ${SRC}`);
  console.error('Esegui questo script sul server, dove esiste il DB del progetto madre.');
  process.exit(1);
}

fs.mkdirSync(DST_DIR, { recursive: true });

const src = new Database(SRC, { readonly: true });
const dst = new Database(DST);
dst.pragma('journal_mode = WAL');

const rows = src.prepare(
  "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_bak%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 WHEN 'view' THEN 3 END"
).all();

let created = 0;
for (const r of rows) {
  let sql = r.sql;
  // Rende idempotente lo statement
  sql = sql.replace(/^CREATE TABLE /i, 'CREATE TABLE IF NOT EXISTS ');
  sql = sql.replace(/^CREATE INDEX /i, 'CREATE INDEX IF NOT EXISTS ');
  sql = sql.replace(/^CREATE UNIQUE INDEX /i, 'CREATE UNIQUE INDEX IF NOT EXISTS ');
  sql = sql.replace(/^CREATE TRIGGER /i, 'CREATE TRIGGER IF NOT EXISTS ');
  sql = sql.replace(/^CREATE VIEW /i, 'CREATE VIEW IF NOT EXISTS ');
  // Le tabelle "shadow" delle FTS5 (…_data, _idx, _content, _docsize, _config)
  // vengono create automaticamente dal modulo FTS: saltale.
  if (/^CREATE TABLE IF NOT EXISTS '?\w+_(data|idx|content|docsize|config)'?/i.test(sql)) continue;
  try {
    dst.exec(sql);
    created++;
  } catch (e) {
    console.warn(`  skip ${r.type} ${r.name}: ${e.message}`);
  }
}

console.log(`Schema copiato: ${created} oggetti creati in ${DST}`);
src.close();
dst.close();
