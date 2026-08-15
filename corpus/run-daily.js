/**
 * run-daily.js — Orchestratore del corpus ecclesiastico a BLOCCHI GIORNALIERI.
 *
 * Scarica al massimo MAX_UNITA_GIORNO unità al giorno (default 10.000; una
 * unità = un canone, un articolo, un documento o una sentenza copiata), in
 * quest'ordine di priorità:
 *
 *   1. canonico         — CIC 1983 + CCEO 1990 (~3.300 canoni, primo giorno)
 *   2. ecclesiastico_it — leggi italiane da Normattiva (seed + coda)
 *   3. vaticano         — leggi/decreti dello SCV (PDF, serve pdftotext)
 *   4. magistero        — motu proprio, costituzioni, encicliche, esortazioni
 *   5. giurisprudenza   — filtro del corpus Cassazione madre
 *
 * Il contatore giornaliero vive nella tabella meta (chiave run:YYYY-MM-DD),
 * quindi la run è riprendibile: rilanciata nello stesso giorno riparte dal
 * budget residuo; il giorno dopo riparte da 10.000. Le code sono persistenti:
 * ciò che non entra nel blocco di oggi esce nel blocco di domani.
 *
 * Uso:
 *   node corpus/run-daily.js                  # blocco giornaliero completo
 *   node corpus/run-daily.js --max 2000       # tetto personalizzato
 *   node corpus/run-daily.js --solo canonico  # un solo ramo
 *   node corpus/run-daily.js --stats          # solo statistiche
 */

const store = require("./db");

const MAX_UNITA_GIORNO = parseInt(process.env.ECCL_MAX_UNITA || "10000", 10);

function makeBudget(db, tetto) {
  return {
    remaining() { return Math.max(0, tetto - store.unitaOggi(db)); },
    spend(n) { store.aggiungiUnita(db, n); },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const mi = argv.indexOf("--max");
  const tetto = mi > -1 ? parseInt(argv[mi + 1], 10) : MAX_UNITA_GIORNO;
  const si = argv.indexOf("--solo");
  const solo = si > -1 ? argv[si + 1] : null;

  const db = store.openDb();

  if (argv.includes("--stats")) {
    console.log(JSON.stringify(store.stats(db), null, 2));
    db.close();
    return;
  }

  const budget = makeBudget(db, tetto);
  console.log(`[RUN] ${store.ymdOggi()} — unità già usate oggi: ${store.unitaOggi(db)}/${tetto}`);
  if (budget.remaining() <= 0) {
    console.log("[RUN] Blocco giornaliero già esaurito. A domani.");
    db.close();
    return;
  }

  const FASI = [
    ["canonico", async () => {
      // I due codici si (ri)scaricano solo se mancanti o incompleti
      const cic = require("./import-cic");
      const cceo = require("./import-cceo");
      let n = 0;
      if (store.countArticoli(db, cic.URN) < 1700) n += await cic.run({ db, budget });
      else console.log("[RUN] CIC già completo, salto");
      if (budget.remaining() > 0) {
        if (store.countArticoli(db, cceo.URN) < 1500) n += await cceo.run({ db, budget });
        else console.log("[RUN] CCEO già completo, salto");
      }
      return n;
    }],
    ["ecclesiastico_it", () => require("./import-ecclesiastico").run({ db, budget })],
    ["vaticano", () => require("./import-vaticano").run({ db, budget })],
    ["magistero", () => require("./import-magistero").run({ db, budget })],
    ["giurisprudenza", () => Promise.resolve(require("./filtra-giurisprudenza").run({ budget }))],
  ];

  for (const [nome, fn] of FASI) {
    if (solo && nome !== solo) continue;
    if (budget.remaining() <= 0) { console.log(`[RUN] Budget esaurito prima di '${nome}'.`); break; }
    console.log(`\n[RUN] ── Fase '${nome}' — budget residuo ${budget.remaining()} ──`);
    try {
      await fn();
    } catch (e) {
      console.error(`[RUN] Fase '${nome}' fallita: ${e.message}`);
    }
  }

  console.log(`\n[RUN] Fine blocco: ${store.unitaOggi(db)}/${tetto} unità usate oggi.`);
  console.log(JSON.stringify(store.stats(db), null, 2));
  db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
