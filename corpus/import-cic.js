/**
 * import-cic.js — Codice di Diritto Canonico (CIC 1983), testo italiano ufficiale.
 *
 * Fonte: https://www.vatican.va/archive/cod-iuris-canonici/cic_index_it.html
 * L'indice linka ~250 pagine ita/documents/cic_libro<Lb>_<range>_it.html, ognuna
 * con un intervallo di canoni in <p>Can. NNN - testo</p> (ISO-8859-1).
 *
 * Il Libro VI (diritto penale, riformato dalla cost. ap. "Pascite gregem Dei",
 * 2021) su vatican.va esiste SOLO come PDF: viene estratto con pdftotext se
 * disponibile, altrimenti l'importer lo salta con un avviso (i canoni 1311-1399
 * risulteranno mancanti finché pdftotext non è installato).
 *
 * Atto: urn:vatican:cic:1983 — un articolo per canone (1..1752).
 *
 * Uso: node corpus/import-cic.js [--max-unita N]
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { fetchHtml, fetchBytes, htmlToText, sleep } = require("./fetch");
const store = require("./db");

const BASE = "https://www.vatican.va/archive/cod-iuris-canonici/";
const INDEX = BASE + "cic_index_it.html";
const URN = "urn:vatican:cic:1983";
const PDF_LIBRO_VI = BASE + "ita/documents/cic_libroVI_it.pdf";

/** Estrae i canoni da un testo piano: "Can. 204 - §1. …" → [{numero, testo}] */
function parseCanoni(text) {
  const out = [];
  const re = /(?:^|\n|\s)Can\s*\.?\s*(\d{1,4})\s*[-–—]?\s*/g;
  const hits = [];
  let m;
  while ((m = re.exec(text)) !== null) hits.push({ num: parseInt(m[1], 10), start: m.index, end: re.lastIndex });
  for (let i = 0; i < hits.length; i++) {
    const body = text.slice(hits[i].end, i + 1 < hits.length ? hits[i + 1].start : undefined).trim();
    // Scarta i falsi positivi delle testatine/navigazione (corpo vuoto o brevissimo)
    if (body.length < 20) continue;
    out.push({ numero: hits[i].num, testo: body.replace(/\s*\n\s*/g, "\n").trim() });
  }
  return out;
}

function libroFromPage(page) {
  const m = page.match(/cic_libro([IVX]+)/i);
  return m ? `Libro ${m[1].toUpperCase()}` : null;
}

function pdfToText(buf) {
  const tmp = path.join(os.tmpdir(), `cic-vi-${process.pid}.pdf`);
  fs.writeFileSync(tmp, buf);
  try {
    return execFileSync("pdftotext", ["-layout", tmp, "-"], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

async function run({ db, budget } = {}) {
  const own = !db;
  if (own) db = store.openDb();
  const canoni = new Map(); // numero → {rubrica, testo}

  console.log("[CIC] Scarico indice…");
  const idx = fetchHtml(INDEX);
  const pages = [...new Set(
    [...idx.matchAll(/href="(ita\/documents\/[^"#]+\.html)/g)].map((m) => m[1])
  )];
  console.log(`[CIC] ${pages.length} pagine da scaricare`);

  let scaricate = 0;
  for (const page of pages) {
    if (budget && budget.remaining() <= 0) { console.log("[CIC] Tetto giornaliero raggiunto, mi fermo."); break; }
    try {
      const html = fetchHtml(BASE + page);
      const text = htmlToText(html);
      const rubrica = libroFromPage(page);
      for (const c of parseCanoni(text)) {
        canoni.set(c.numero, { rubrica, testo: c.testo });
      }
      scaricate++;
      if (scaricate % 25 === 0) console.log(`[CIC] ${scaricate}/${pages.length} pagine — ${canoni.size} canoni`);
    } catch (e) {
      console.warn(`[CIC] errore su ${page}: ${e.message}`);
    }
    await sleep(400); // cortesia verso vatican.va
  }

  // Libro VI dal PDF (canoni 1311-1399, testo RIFORMATO 2021 "Pascite gregem Dei").
  // Le pagine HTML dell'indice contengono ancora il testo previgente del 1983:
  // il PDF lo sovrascrive; se pdftotext manca, i canoni vengono marcati come
  // previgenti in rubrica così l'utente non li scambia per il testo in vigore.
  let libroVIAggiornato = false;
  try {
    console.log("[CIC] Libro VI (PDF riforma 2021)…");
    const text = pdfToText(fetchBytes(PDF_LIBRO_VI, { timeout: 120 }));
    let n = 0;
    for (const c of parseCanoni(text)) {
      if (c.numero >= 1311 && c.numero <= 1399) { canoni.set(c.numero, { rubrica: "Libro VI (riforma 2021)", testo: c.testo }); n++; }
    }
    libroVIAggiornato = n > 50;
    console.log(`[CIC] Libro VI: ${n} canoni dal PDF`);
  } catch (e) {
    console.warn(`[CIC] Libro VI saltato (${e.message}). Installa pdftotext (poppler-utils) e rilancia.`);
  }
  if (!libroVIAggiornato) {
    for (const [num, v] of canoni) {
      if (num >= 1311 && num <= 1399) {
        v.rubrica = "Libro VI — ATTENZIONE: testo previgente 1983, riforma 2021 non ancora importata (serve pdftotext)";
      }
    }
  }

  const arts = [...canoni.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([numero, v], i) => ({ numero_articolo: numero, rubrica: v.rubrica, testo_vigente: v.testo, ordine: i }));

  store.upsertAtto(db, {
    urn: URN,
    tipo: "CODICE DI DIRITTO CANONICO",
    anno: 1983,
    data_pubblicazione: "1983-01-25",
    titolo: "Codice di Diritto Canonico (CIC 1983) — testo italiano",
    url_fonte: INDEX,
    data_vigenza: store.ymdOggi().replace(/-/g, ""),
    n_articoli: arts.length,
    ordinamento: "canonico",
  });
  const salvati = store.saveArticoli(db, URN, arts);
  if (budget) budget.spend(salvati);
  console.log(`[CIC] Salvati ${salvati} canoni in ${URN}`);
  if (own) db.close();
  return salvati;
}

if (require.main === module) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run, parseCanoni, URN };
