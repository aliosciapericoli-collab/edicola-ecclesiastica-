/**
 * import-cceo.js — Codice dei Canoni delle Chiese Orientali (CCEO 1990), it.
 *
 * Fonte: IntraText CT, edizione italiana — https://www.intratext.com/IXT/ITA1881/
 * (vatican.va pubblica il CCEO solo in latino). Le pagine _P1.HTM…_PN.HTM
 * contengono i canoni come "Can. N (…) testo" in ISO-8859-1; i riferimenti
 * paralleli al CIC83 tra parentesi vengono mantenuti nel testo.
 *
 * Atto: urn:vatican:cceo:1990 — un articolo per canone (1..1546).
 *
 * Uso: node corpus/import-cceo.js
 */

const { fetchHtml, htmlToText, sleep } = require("./fetch");
const store = require("./db");

const BASE = "https://www.intratext.com/IXT/ITA1881/";
const URN = "urn:vatican:cceo:1990";

/** IntraText separa "Can . 1" con spazi attorno al punto. */
function parseCanoniIntratext(text) {
  const out = [];
  const re = /(?:^|\n|\s)Can\s*\.\s*(\d{1,4})\s*/g;
  const hits = [];
  let m;
  while ((m = re.exec(text)) !== null) hits.push({ num: parseInt(m[1], 10), start: m.index, end: re.lastIndex });
  for (let i = 0; i < hits.length; i++) {
    let body = text.slice(hits[i].end, i + 1 < hits.length ? hits[i + 1].start : undefined).trim();
    // Coda di navigazione IntraText in fondo all'ultima pagina
    body = body.replace(/Precedente\s*-\s*Successivo[\s\S]*$/i, "").trim();
    if (body.length < 20) continue;
    out.push({ numero: hits[i].num, testo: body.replace(/\s*\n\s*/g, "\n").trim() });
  }
  return out;
}

async function run({ db, budget } = {}) {
  const own = !db;
  if (own) db = store.openDb();

  console.log("[CCEO] Scarico indice…");
  const idx = fetchHtml(BASE);
  // Le pagine IntraText sono numerate in BASE 36: _P1…_P9, _PA…_PZ, _P10…_P3C
  const pages = [...new Set([...idx.matchAll(/href=(_P[0-9A-Z]+\.HTM)/gi)].map((m) => m[1]))]
    .sort((a, b) => parseInt(a.match(/_P([0-9A-Z]+)\./i)[1], 36) - parseInt(b.match(/_P([0-9A-Z]+)\./i)[1], 36));
  console.log(`[CCEO] ${pages.length} pagine di testo`);

  const canoni = new Map();
  let scaricate = 0;
  for (const page of pages) {
    if (budget && budget.remaining() <= 0) { console.log("[CCEO] Tetto giornaliero raggiunto, mi fermo."); break; }
    try {
      const text = htmlToText(fetchHtml(BASE + page));
      for (const c of parseCanoniIntratext(text)) canoni.set(c.numero, c.testo);
      scaricate++;
      if (scaricate % 20 === 0) console.log(`[CCEO] ${scaricate}/${pages.length} pagine — ${canoni.size} canoni`);
    } catch (e) {
      console.warn(`[CCEO] errore su ${page}: ${e.message.split("\n")[0]}`);
      await sleep(5000); // respiro extra dopo un errore
    }
    await sleep(3000); // IntraText resetta le connessioni sotto ~1 richiesta ogni 3s
  }

  const arts = [...canoni.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([numero, testo], i) => ({ numero_articolo: numero, rubrica: null, testo_vigente: testo, ordine: i }));

  store.upsertAtto(db, {
    urn: URN,
    tipo: "CODICE DEI CANONI DELLE CHIESE ORIENTALI",
    anno: 1990,
    data_pubblicazione: "1990-10-18",
    titolo: "Codice dei Canoni delle Chiese Orientali (CCEO 1990) — testo italiano",
    url_fonte: BASE,
    data_vigenza: store.ymdOggi().replace(/-/g, ""),
    n_articoli: arts.length,
    ordinamento: "canonico",
  });
  const salvati = store.saveArticoli(db, URN, arts);
  if (budget) budget.spend(salvati);
  console.log(`[CCEO] Salvati ${salvati} canoni in ${URN}`);
  if (own) db.close();
  return salvati;
}

if (require.main === module) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run, parseCanoniIntratext, URN };
