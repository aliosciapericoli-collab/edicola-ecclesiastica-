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
  ["apost_letters", "LETTERA APOSTOLICA", 500],
];

// Documenti del Concilio Vaticano II (costituzioni, decreti, dichiarazioni) —
// indice dedicato fuori dallo schema /content/<pontefice>/.
const CONCILIO_BASE = "https://www.vatican.va/archive/hist_councils/ii_vatican_council/";
const CONCILIO_INDEX = CONCILIO_BASE + "index_it.htm";
const CONCILIO_TIPI = { const: "COSTITUZIONE CONCILIARE", decree: "DECRETO CONCILIARE", decl: "DICHIARAZIONE CONCILIARE" };

function slugDaUrl(url) {
  return url.split("/").pop().replace(/\.html$/, "");
}

function annoDaSlug(slug) {
  const m = slug.match(/\b(1[89]\d{2}|20\d{2})\b/) || slug.match(/_(\d{4})\d{4}_/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Estrae il SOLO contenitore del documento dalle pagine vatican.va moderne
 * (<div class="documento">…</div>, chiusura trovata bilanciando i div).
 * Le pagine vecchie (es. Concilio Vaticano II) non hanno il contenitore:
 * si torna alla pagina intera, che pulisciTesto ripulisce riga per riga.
 */
function estraiDocumento(html) {
  const start = html.search(/<div[^>]+class="[^"]*\bdocumento\b[^"]*"/i);
  if (start < 0) return html;
  const re = /<\/?div\b/gi;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (html[m.index + 1] === "/") { depth--; if (depth === 0) return html.slice(start, m.index); }
    else depth++;
  }
  return html.slice(start);
}

/** Rimuove la boilerplate di navigazione delle pagine vatican.va. */
function pulisciTesto(text) {
  const righe = text.split("\n");
  const out = [];
  const BOILER = /^(IT|EN|ES|FR|DE|PT|PL|LA|AR|ZH|HU|HR|SW|SQ|BE|CS|SK|UK|RU|RO|LV|MK|SL)$|^\s*(Home|Ricerca|Stampa|Indice|Udienze|Angelus|Discorsi|Omelie|Lettere|Viaggi|Biografia|Elezione|Conclave|© Copyright|Copyright ©|Libreria Editrice Vaticana|La Santa Sede|Sala Stampa)\b/i;
  const LINGUE = /^-?\s*[A-Z]{2}\s*$|^\[?\s*(?:[A-Z]{2}\s*-\s*)+[A-Z]{2}\s*\]?$/; // "- ES", "[ AR - BE - … ]"
  for (const r of righe) {
    const t = r.trim();
    if (BOILER.test(t) || LINGUE.test(t)) continue;
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
  // Concilio Vaticano II — 16 documenti (rank 50: prima di tutto il resto)
  try {
    const idx = fetchHtml(CONCILIO_INDEX);
    for (const m of idx.matchAll(/href="(?:[^"]*\/)?documents\/(vat-ii_(const|decree|decl)_[^"]+_it\.html)"/g)) {
      const url = CONCILIO_BASE + "documents/" + m[1];
      const urn = `urn:vatican:magistero:concilio-vaticano-ii:${slugDaUrl(url)}`;
      if (!visti.has(urn)) visti.set(urn, { url, tipo: CONCILIO_TIPI[m[2]] || "DOCUMENTO CONCILIARE", pope: "concilio-vaticano-ii", rank: 50 });
    }
  } catch (e) {
    console.warn(`[MAG] Concilio Vaticano II non raggiungibile: ${e.message.split("\n")[0]}`);
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

  // BONIFICA: i documenti scaricati prima dell'estrazione mirata contengono
  // il menù del sito (lingue, "Celebrazioni Liturgiche", entità &ccedil;…).
  // Si rimettono in coda e vengono riscaricati puliti in questo stesso run.
  try {
    const sporchi = db.prepare(`
      SELECT DISTINCT atto_urn FROM articoli
      WHERE atto_urn LIKE 'urn:vatican:magistero:%'
        AND (testo_vigente LIKE '%Celebrazioni Liturgiche%'
          OR testo_vigente LIKE '%&ccedil;%'
          OR testo_vigente LIKE '%&ntilde;%'
          OR testo_vigente LIKE '%&times;%')
    `).all();
    if (sporchi.length) {
      const requeue = db.prepare("UPDATE coda_priorita SET stato='pending', nota='bonifica boilerplate' WHERE urn=?");
      const tx = db.transaction((rows) => { for (const r of rows) requeue.run(r.atto_urn); });
      tx(sporchi);
      console.log(`[MAG] Bonifica: ${sporchi.length} documenti con boilerplate rimessi in coda`);
    }
  } catch (e) { console.warn(`[MAG] Bonifica saltata: ${e.message}`); }

  let atti = 0;
  for (;;) {
    if (atti >= maxAtti) break;
    if (budget && budget.remaining() <= 0) { console.log("[MAG] Tetto giornaliero raggiunto, mi fermo."); break; }
    const [voce] = store.nextPending(db, "magistero", 1);
    if (!voce) break;
    const info = catalogo.get(voce.urn);
    if (!info) { store.markQueue(db, voce.urn, "error", "URL non più nel catalogo"); continue; }
    try {
      const testo = pulisciTesto(htmlToText(estraiDocumento(fetchHtml(info.url))));
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
