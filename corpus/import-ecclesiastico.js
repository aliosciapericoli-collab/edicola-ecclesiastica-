/**
 * import-ecclesiastico.js — Diritto ecclesiastico italiano da Normattiva.
 *
 * Riusa il downloader collaudato del progetto madre
 * (scrapers/normativa-corpus/lib.js: sessione+cookie, anti-ban, export Akoma
 * Ntoso, parser articoli) ma scrive nel DB ecclesiastico
 * (ecclesiastica/data/normativa.db) con ordinamento='ecclesiastico_it'.
 *
 * I SEED coprono l'ossatura del diritto ecclesiastico italiano:
 *   - Patti Lateranensi e Accordo di Villa Madama
 *   - legislazione sui "culti ammessi" (1929-1930)
 *   - enti ecclesiastici e 8 per mille (L. 222/1985)
 *   - TUTTE le intese ex art. 8 Cost. approvate con legge
 * La coda è estendibile: enqueue di nuovi URN da CLI o da altre pipeline.
 *
 * Uso:
 *   node corpus/import-ecclesiastico.js --seed          # popola solo la coda
 *   node corpus/import-ecclesiastico.js [--max-atti N]  # seed + download coda
 */

const path = require("path");
const lib = require(path.join(__dirname, "..", "..", "scrapers", "normativa-corpus", "lib.js"));
const store = require("./db");

/** Seed: [urn, etichetta, rank] — rank basso = più prioritario. */
const SEEDS = [
  // ── Fondamenta costituzionali e pattizie ──
  ["urn:nir:stato:legge:1929-05-27;810", "L. 810/1929 — Esecuzione dei Patti Lateranensi (Trattato e Concordato)", 1],
  ["urn:nir:stato:legge:1985-03-25;121", "L. 121/1985 — Ratifica Accordo di Villa Madama (revisione del Concordato)", 2],
  ["urn:nir:stato:legge:1985-05-20;222", "L. 222/1985 — Enti e beni ecclesiastici, sostentamento del clero, 8 per mille", 3],
  ["urn:nir:stato:decreto.del.presidente.della.repubblica:1987-02-13;33", "D.P.R. 33/1987 — Regolamento di esecuzione della L. 222/1985", 4],
  // ── Culti ammessi (confessioni senza intesa) ──
  ["urn:nir:stato:legge:1929-06-24;1159", "L. 1159/1929 — Esercizio dei culti ammessi", 5],
  ["urn:nir:stato:regio.decreto:1930-02-28;289", "R.D. 289/1930 — Attuazione della legge sui culti ammessi", 6],
  // ── Intese ex art. 8, comma 3, Cost. ──
  ["urn:nir:stato:legge:1984-08-11;449", "L. 449/1984 — Intesa con la Tavola valdese", 10],
  ["urn:nir:stato:legge:1993-10-05;409", "L. 409/1993 — Modifica intesa Tavola valdese", 11],
  ["urn:nir:stato:legge:1988-11-22;516", "L. 516/1988 — Intesa con l'Unione delle Chiese cristiane avventiste", 12],
  ["urn:nir:stato:legge:1996-12-20;637", "L. 637/1996 — Modifica intesa avventisti", 13],
  ["urn:nir:stato:legge:1988-11-22;517", "L. 517/1988 — Intesa con le Assemblee di Dio in Italia (ADI)", 14],
  ["urn:nir:stato:legge:1989-03-08;101", "L. 101/1989 — Intesa con l'Unione delle Comunità ebraiche italiane (UCEI)", 15],
  ["urn:nir:stato:legge:1996-12-20;638", "L. 638/1996 — Modifica intesa UCEI", 16],
  ["urn:nir:stato:legge:1995-04-12;116", "L. 116/1995 — Intesa con l'Unione cristiana evangelica battista (UCEBI)", 17],
  ["urn:nir:stato:legge:1995-11-29;520", "L. 520/1995 — Intesa con la Chiesa evangelica luterana in Italia (CELI)", 18],
  ["urn:nir:stato:legge:2012-07-30;126", "L. 126/2012 — Intesa con la Sacra Arcidiocesi ortodossa d'Italia", 19],
  ["urn:nir:stato:legge:2012-07-30;127", "L. 127/2012 — Intesa con la Chiesa di Gesù Cristo dei Santi degli ultimi giorni", 20],
  ["urn:nir:stato:legge:2012-07-30;128", "L. 128/2012 — Intesa con la Chiesa Apostolica in Italia", 21],
  ["urn:nir:stato:legge:2012-12-31;245", "L. 245/2012 — Intesa con l'Unione Buddhista Italiana (UBI)", 22],
  ["urn:nir:stato:legge:2012-12-31;246", "L. 246/2012 — Intesa con l'Unione Induista Italiana", 23],
  ["urn:nir:stato:legge:2016-06-28;130", "L. 130/2016 — Intesa con l'Istituto Buddista Italiano Soka Gakkai", 24],
  // ── Norme collegate ──
  ["urn:nir:stato:legge:2003-07-01;206", "L. 206/2003 — Riconoscimento della funzione sociale degli oratori", 30],
  ["urn:nir:stato:decreto.legislativo:2017-07-03;117", "D.Lgs. 117/2017 — Codice del Terzo settore (rilevante per gli enti religiosi)", 31],
];

function seed(db) {
  let n = 0;
  for (const [urn, etichetta, rank] of SEEDS) {
    store.enqueue(db, { urn, etichetta, rank, fonte: "seed", ordinamento: "ecclesiastico_it" });
    n++;
  }
  console.log(`[ECCL] Coda seed: ${n} atti (nuovi o già presenti)`);
}

async function scaricaAtto(db, voce) {
  const { urn } = voce;
  const res = await lib.fetchAttoAKN(urn, { politeBetween: true });
  const parsed = lib.parseAkn(res.akn);
  const meta = await lib.fetchMetaOpendata(urn);

  store.upsertAtto(db, {
    urn,
    tipo: (meta && meta.tipo) || null,
    numero: (meta && meta.numero) || null,
    anno: (meta && meta.anno) || null,
    data_pubblicazione: (meta && meta.data_pubblicazione) || null,
    titolo: (meta && meta.titolo) || parsed.titolo || voce.etichetta,
    url_fonte: res.permalink,
    codice_redazionale: res.codiceRedaz,
    data_gu: res.dataGU,
    data_vigenza: res.dataVigenza,
    n_articoli: parsed.articoli.length,
    ordinamento: "ecclesiastico_it",
  });
  const salvati = store.saveArticoli(db, urn, parsed.articoli.map((a, i) => ({ ...a, ordine: i })));
  return salvati;
}

async function run({ db, budget, maxAtti = Infinity } = {}) {
  const own = !db;
  if (own) db = store.openDb();
  seed(db);

  let unita = 0;
  let atti = 0;
  for (;;) {
    if (atti >= maxAtti) break;
    if (budget && budget.remaining() <= 0) { console.log("[ECCL] Tetto giornaliero raggiunto, mi fermo."); break; }
    const [voce] = store.nextPending(db, "ecclesiastico_it", 1);
    if (!voce) break;
    try {
      const n = await scaricaAtto(db, voce);
      store.markQueue(db, voce.urn, "done", `${n} articoli`);
      if (budget) budget.spend(n);
      unita += n;
      atti++;
      console.log(`[ECCL] ok ${voce.urn} — ${n} articoli (${voce.etichetta})`);
    } catch (e) {
      // 'noexport' = atto reale ma export AKN non ancora pubblicato → riprovabile
      const stato = e.kind === "noexport" ? "pending" : "error";
      if (stato === "pending") {
        // lascialo in coda ma non ciclare all'infinito nella stessa run
        store.markQueue(db, voce.urn, "attesa", e.message);
      } else {
        store.markQueue(db, voce.urn, "error", e.message);
      }
      console.warn(`[ECCL] ${stato} ${voce.urn}: ${e.message}`);
    }
    await lib.politeDelay();
  }

  // Le voci 'attesa' tornano 'pending' per la prossima run
  db.prepare("UPDATE coda_priorita SET stato='pending' WHERE stato='attesa'").run();

  console.log(`[ECCL] Fine run: ${atti} atti, ${unita} articoli`);
  if (own) db.close();
  return unita;
}

if (require.main === module) {
  const soloSeed = process.argv.includes("--seed");
  const mi = process.argv.indexOf("--max-atti");
  const maxAtti = mi > -1 ? parseInt(process.argv[mi + 1], 10) : Infinity;
  if (soloSeed) {
    const db = store.openDb();
    seed(db);
    db.close();
  } else {
    run({ maxAtti }).catch((e) => { console.error(e); process.exit(1); });
  }
}

module.exports = { run, seed, SEEDS };
