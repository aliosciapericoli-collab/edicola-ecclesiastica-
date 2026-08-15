/**
 * import-magistero.js — Documenti pontifici normativi e magisteriali da vatican.va.
 *
 * Per ogni pontefice e per ogni tipologia (motu proprio, costituzioni
 * apostoliche, encicliche, esortazioni apostoliche) legge l'indice
 * /content/<pontefice>/it/<tipo>.index.html, mette in coda i documenti in
 * italiano (fallback: latino) e ne salva il testo integrale come atto con
 * ordinamento='magistero'.
 *
 * I motu proprio e le costituzioni apostoliche sono la parte NORMATIVA del
 * magistero (modificano il diritto canonico); encicliche ed esortazioni sono
 * incluse come corpus documentale a rank più basso.
 *
 * Uso: node corpus/import-magistero.js [--solo-coda] [--max-atti N]
 */

const { fetchHtml, htmlToText, sleep } = require("./fetch");
const store = require("./db");

const BASE = "https://www.vatican.va";

const PONTEFICI = [
  "leo-xiv", "francesco", "benedict-xvi", "john-paul-ii", "john-paul-i",
  "paul-vi", "john-xxiii", "pius-xii", "pius-xi", "benedict-xv", "pius-x", "leo-xiii",
];

// [tipo URL, tipo atto, rank base] — rank basso = scaricato prima
const TIPI = [
  ["motu_proprio", "MOTU PROPRIO", 100],
  ["apost_constitutions", "COSTITUZIONE APOSTOLICA", 200],
  ["encyclicals", "ENCICLICA", 300],
  ["apost_exhortations", "ESORTAZIONE APOSTOLICA", 400],
];

function slugDaUrl(url) {
  return url.split("/").pop().replace(/\.html$/, "");
}

function annoDaSlug(slug) {
  const m = slug.match(/\b(1[89]\d{2}|20\d{2})\b/) || slug.match(/_(\d{4})\d{4}_/);
  return m ? parseInt(m[1], 10) : null;
}

/** Rimuove la boilerplate di navigazione delle pagine vatican.va. */
function pulisciTesto(text) {
  const righe = text.split("\n");
  const out = [];
  const BOILER = /^(IT|EN|ES|FR|DE|PT|PL|LA|AR|ZH|HU|HR|SW|SQ|BE|CS|SK|UK|RU|RO|LV|MK|SL)$|^\s*(Home|Ricerca|Stampa|Indice|Udienze|Angelus|Discorsi|Omelie|Lettere|Viaggi|Biografia|Elezione|Conclave|© Copyright|Copyright ©|Libreria Editrice Vaticana|La Santa Sede|Sala Stampa)\b/i;
  for (const r of righe) {
    if (BOILER.test(r.trim())) continue;
    out.push(r);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Enumera indici e popola la coda. */
async function costruisciCoda(db) {
  const visti = new Map(); // urn → {url, tipo, pope, rank}
  for (const pope of PONTEFICI) {
    for (const [tipoUrl, tipoAtto, rankBase] of TIPI) {
      const idxUrl = `${BASE}/content/${pope}/it/${tipoUrl}.index.html`;
      let html;
      try {
        html = fetchHtml(idxUrl);
      } catch (e) {
        continue; // il pontefice non ha questa tipologia
      }
      const re = new RegExp(`href="([^"]*/content/${pope}/(it|la)/${tipoUrl}/documents/[^"]+\\.html)"`, "g");
      const perSlug = new Map(); // slug → {it?, la?}
      for (const m of html.matchAll(re)) {
        const url = m[1].startsWith("http") ? m[1] : BASE + m[1];
        const slug = slugDaUrl(url);
        const cur = perSlug.get(slug) || {};
        cur[m[2]] = url;
        perSlug.set(slug, cur);
      }
      for (const [slug, v] of perSlug) {
        const url = v.it || v.la;
        const urn = `urn:vatican:magistero:${pope}:${slug}`;
        if (!visti.has(urn)) visti.set(urn, { url, tipo: tipoAtto, pope, rank: rankBase });
      }
      await sleep(300);
    }
  }
  for (const [urn, v] of visti) {
    store.enqueue(db, {
      urn,
      etichetta: `${v.tipo} — ${slugDaUrl(v.url)} (${v.pope})`,
      fonte: v.pope,
      rank: v.rank,
      ordinamento: "magistero",
    });
  }
  console.log(`[MAG] Coda: ${visti.size} documenti censiti`);
  return visti;
}

async function run({ db, budget, maxAtti = Infinity } = {}) {
  const own = !db;
  if (own) db = store.openDb();

  const catalogo = await costruisciCoda(db);

  let atti = 0;
  for (;;) {
    if (atti >= maxAtti) break;
    if (budget && budget.remaining() <= 0) { console.log("[MAG] Tetto giornaliero raggiunto, mi fermo."); break; }
    const [voce] = store.nextPending(db, "magistero", 1);
    if (!voce) break;
    const info = catalogo.get(voce.urn);
    if (!info) { store.markQueue(db, voce.urn, "error", "URL non più nel catalogo"); continue; }
    try {
      const testo = pulisciTesto(htmlToText(fetchHtml(info.url)));
      if (testo.length < 300) throw new Error(`testo troppo corto (${testo.length} caratteri)`);
      const slug = slugDaUrl(info.url);
      store.upsertAtto(db, {
        urn: voce.urn,
        tipo: info.tipo,
        anno: annoDaSlug(slug),
        titolo: voce.etichetta,
        url_fonte: info.url,
        data_vigenza: store.ymdOggi().replace(/-/g, ""),
        n_articoli: 1,
        ordinamento: "magistero",
      });
      store.saveArticoli(db, voce.urn, [{ numero_articolo: "testo", rubrica: info.tipo, testo_vigente: testo, ordine: 0 }]);
      store.markQueue(db, voce.urn, "done", `${testo.length} caratteri`);
      if (budget) budget.spend(1);
      atti++;
      if (atti % 25 === 0) console.log(`[MAG] ${atti} documenti scaricati…`);
    } catch (e) {
      store.markQueue(db, voce.urn, "error", e.message);
      console.warn(`[MAG] errore ${voce.urn}: ${e.message}`);
    }
    await sleep(600);
  }

  console.log(`[MAG] Fine run: ${atti} documenti`);
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
