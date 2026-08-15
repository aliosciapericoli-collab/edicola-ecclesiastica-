/**
 * import-vaticano.js — Leggi e decreti dello Stato della Città del Vaticano.
 *
 * Fonte: sezione "Legislazione e normativa" di vaticanstate.va. Ogni sezione
 * elenca documenti PDF con link Phoca Download `?download=<id>:<slug>` e
 * paginazione `?start=N`. L'importer:
 *   1. enumera le sezioni e la paginazione, mette in coda ogni documento
 *      (urn:vatican:scv:<id>) con etichetta ricavata dallo slug;
 *   2. scarica i PDF in coda e ne estrae il testo con pdftotext
 *      (poppler-utils). Senza pdftotext il documento resta in coda ('error',
 *      nota esplicita) e si recupera a strumento installato.
 *
 * Ogni documento = un atto con un unico "articolo" testo integrale
 * (le leggi vaticane sono brevi; la divisione in articoli è una fase 2).
 *
 * Uso: node corpus/import-vaticano.js [--solo-coda] [--max-atti N]
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { fetchHtml, fetchBytes, sleep } = require("./fetch");
const store = require("./db");

const BASE = "https://www.vaticanstate.va";
const SEZIONI = [
  "/it/stato-governo/legislazione-e-normativa/norm-general.html",
  "/it/stato-governo/legislazione-e-normativa/norm-penale-amministrativa.html",
  "/it/stato-governo/legislazione-e-normativa/norm-sanitaria.html",
  "/it/stato-governo/legislazione-e-normativa/normativa-altre-materie.html",
  "/it/stato-governo/legislazione-e-normativa/normativa-persone-giuridiche-vaticane.html",
  "/it/stato-governo/legislazione-e-normativa/normativa-prevenzione-contrasto-in-materia-finanziaria-e-f-t.html",
  "/it/stato-governo/legislazione-e-normativa/normativa-sul-personale-del-governatorato.html",
];
const MAX_PAGINE_SEZIONE = 30; // guardia: 30 pagine × 20 doc = 600 doc per sezione

function titoloDaSlug(slug) {
  return slug
    .replace(/-/g, " ")
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .trim();
}

function pdfToText(buf) {
  const tmp = path.join(os.tmpdir(), `scv-${process.pid}-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, buf);
  try {
    return execFileSync("pdftotext", ["-layout", tmp, "-"], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

/** Enumera tutte le sezioni e popola la coda. Ritorna il n. di documenti visti. */
async function costruisciCoda(db) {
  const visti = new Map(); // id → {slug, sezione, url}
  for (const sez of SEZIONI) {
    for (let start = 0; start < MAX_PAGINE_SEZIONE * 20; start += 20) {
      const url = `${BASE}${sez}${start ? `?start=${start}` : ""}`;
      let html;
      try {
        html = fetchHtml(url);
      } catch (e) {
        console.warn(`[SCV] sezione irraggiungibile ${url}: ${e.message}`);
        break;
      }
      const links = [...html.matchAll(/\?download=(\d+):([\w-]+)/g)];
      let nuovi = 0;
      for (const m of links) {
        const id = m[1];
        if (!visti.has(id)) {
          visti.set(id, { slug: m[2], sezione: sez, url: `${BASE}${sez}?download=${id}:${m[2]}` });
          nuovi++;
        }
      }
      // Se la pagina non aggiunge nulla di nuovo, la paginazione è finita
      if (nuovi === 0) break;
      await sleep(400);
    }
  }
  for (const [id, v] of visti) {
    store.enqueue(db, {
      urn: `urn:vatican:scv:${id}`,
      etichetta: titoloDaSlug(v.slug),
      fonte: v.sezione.split("/").pop().replace(".html", ""),
      rank: parseInt(id, 10),
      ordinamento: "vaticano",
    });
  }
  console.log(`[SCV] Coda: ${visti.size} documenti censiti`);
  return visti;
}

async function run({ db, budget, maxAtti = Infinity } = {}) {
  const own = !db;
  if (own) db = store.openDb();

  const catalogo = await costruisciCoda(db);

  let atti = 0;
  for (;;) {
    if (atti >= maxAtti) break;
    if (budget && budget.remaining() <= 0) { console.log("[SCV] Tetto giornaliero raggiunto, mi fermo."); break; }
    const [voce] = store.nextPending(db, "vaticano", 1);
    if (!voce) break;
    const id = voce.urn.split(":").pop();
    const info = catalogo.get(id);
    const url = info ? info.url : null;
    if (!url) { store.markQueue(db, voce.urn, "error", "URL non più nel catalogo"); continue; }
    try {
      const bytes = fetchBytes(url, { timeout: 120 });
      let testo;
      try {
        testo = pdfToText(bytes);
      } catch (e) {
        store.markQueue(db, voce.urn, "error", `pdftotext non disponibile o PDF illeggibile: ${e.message}`);
        console.warn(`[SCV] ${voce.urn}: serve pdftotext (apt install poppler-utils)`);
        atti++; // conta comunque il tentativo per non ciclare all'infinito
        continue;
      }
      testo = testo.replace(/\f/g, "\n").trim();
      const anno = (testo.match(/\b(19|20)\d{2}\b/) || [])[0] || null;
      store.upsertAtto(db, {
        urn: voce.urn,
        tipo: "LEGGE/DECRETO SCV",
        anno: anno ? parseInt(anno, 10) : null,
        titolo: voce.etichetta,
        url_fonte: url,
        data_vigenza: store.ymdOggi().replace(/-/g, ""),
        n_articoli: 1,
        ordinamento: "vaticano",
      });
      store.saveArticoli(db, voce.urn, [{ numero_articolo: "testo", rubrica: voce.etichetta, testo_vigente: testo, ordine: 0 }]);
      store.markQueue(db, voce.urn, "done", `${testo.length} caratteri`);
      if (budget) budget.spend(1);
      atti++;
      console.log(`[SCV] ok ${voce.urn} — ${voce.etichetta}`);
    } catch (e) {
      store.markQueue(db, voce.urn, "error", e.message);
      console.warn(`[SCV] errore ${voce.urn}: ${e.message}`);
    }
    await sleep(700);
  }

  console.log(`[SCV] Fine run: ${atti} documenti processati`);
  if (own) db.close();
  return atti;
}

if (require.main === module) {
  const soloCoda = process.argv.includes("--solo-coda");
  const mi = process.argv.indexOf("--max-atti");
  const maxAtti = mi > -1 ? parseInt(process.argv[mi + 1], 10) : Infinity;
  if (soloCoda) {
    (async () => { const db = store.openDb(); await costruisciCoda(db); db.close(); })();
  } else {
    run({ maxAtti }).catch((e) => { console.error(e); process.exit(1); });
  }
}

module.exports = { run, costruisciCoda };
