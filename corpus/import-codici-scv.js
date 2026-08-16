/**
 * import-codici-scv.js — Codici penali dello Stato della Città del Vaticano.
 *
 * Lo SCV non ha codici penali propri: con la Legge n. II del 7 giugno 1929
 * ha RECEPITO il Codice penale italiano del 1889 (codice Zanardelli, R.D.
 * 30 giugno 1889 n. 6133) e il Codice di procedura penale italiano del 1913
 * (R.D. 27 febbraio 1913 n. 127), entrambi poi aggiornati da leggi vaticane
 * (Legge n. L/1969, Leggi n. VIII e IX/2013, m.p. 2013/2021/2023, già nel
 * ramo "vaticano" del corpus).
 *
 * Fonti testo:
 *  - Codice penale 1889: OCR della stampa originale (Archive.org, pubblico
 *    dominio). Su Normattiva l'atto espone solo il segnaposto di abrogazione
 *    (D.Lgs. 212/2010) valido per l'ordinamento ITALIANO — nello SCV il
 *    codice resta vigente. Possibili refusi OCR: segnalati in rubrica.
 *  - Codice di procedura penale 1913: nessuna fonte digitale aperta ne
 *    pubblica il testo integrale (Normattiva: segnaposto; Wikisource e
 *    Archive.org: assente). Si importa una scheda con nota e rimandi.
 */

const store = require("./db");
const { fetchBytes } = require("./fetch");

const URN_CP = "urn:vatican:scv:codice-penale-1889";
const URN_CPP = "urn:vatican:scv:codice-procedura-penale-1913";

const OCR_CP_URL =
  "https://archive.org/download/il-codice-penale-per-il-regno-d-italia-1889/Il%20Codice%20Penale%20per%20il%20Regno%20d'Italia%201889_djvu.txt";
// Mirror diretto (il redirect di archive.org a volte risponde 404 sul path canonico)
const OCR_CP_MIRROR =
  "https://ia803206.us.archive.org/20/items/il-codice-penale-per-il-regno-d-italia-1889/Il%20Codice%20Penale%20per%20il%20Regno%20d'Italia%201889_djvu.txt";

const NOTA_RECEPIMENTO =
  "Recepito nello SCV con Legge 7 giugno 1929, n. II sulle fonti del diritto; " +
  "aggiornato dalle leggi vaticane successive (v. ramo Leggi Vaticane: Legge n. L/1969, " +
  "Leggi n. VIII e IX dell'11 luglio 2013, m.p. 8 febbraio 2021, m.p. 12 aprile 2023).";

/** Pulizia OCR: righe di intestazione di pagina, numeri di pagina, sillabazioni. */
function puliziaOcr(raw) {
  const righe = raw.split(/\r?\n/);
  const tenute = [];
  for (const r of righe) {
    const t = r.trim();
    if (!t) { tenute.push(""); continue; }
    if (/^\d{1,3}$/.test(t)) continue;                    // numero di pagina isolato
    if (/^(LIBRO|TITOLO|CAPO)\b.*\d+\s*$/i.test(t) && t.length < 80) continue; // testatina con n. pagina
    if (/^Codice penale\b/i.test(t) && t.length < 60) continue;                // testatina
    // Note di concordanza a margine dell'edizione commentata (rimandi ai
    // codici preunitari: "Prog. 5; Sardo 5, 7; Tosc. 4 … = C. pen. 92.")
    if (/^(Prog\.|Sardo|Tosc\.|Parm\.|Est\.|Nap\.|Franc\.|Austr\.|R\.\s*pont)/i.test(t)) continue;
    if (/=\s*C\.\s*pen\./.test(t) && t.length < 60) continue;
    tenute.push(t);
  }
  let testo = tenute.join("\n");
  testo = testo.replace(/([a-zàèéìòù])-\n([a-zàèéìòù])/g, "$1$2"); // de-sillabazione
  testo = testo.replace(/\n{3,}/g, "\n\n");
  return testo;
}

/** Estrae gli articoli "N. testo…" in sequenza strettamente crescente. */
function parseArticoli(testo) {
  const start = testo.search(/(^|\n)1\.\s+Nessuno può essere punito/);
  if (start < 0) throw new Error("incipit art. 1 non trovato nell'OCR");
  const corpo = testo.slice(start);
  // Ogni articolo comincia a inizio riga con "N. " — teniamo solo la sequenza
  // crescente per scartare i falsi positivi dell'OCR (numeri nel testo).
  const pezzi = [...corpo.matchAll(/(^|\n)(\d{1,3})\.\s/g)];
  // Selezione dei confini: fra tutti i candidati "N. " a inizio riga si
  // sceglie la SOTTOSEQUENZA CRESCENTE PIÙ LUNGA (LIS) dei numeri 1..498 in
  // ordine di posizione nel testo. Così il rumore locale (numeri nel testo,
  // indici, cifre storpiate dall'OCR) non spezza mai la catena: la sequenza
  // riparte da sola dopo ogni danno.
  const cand = pezzi
    .map((m) => ({ num: parseInt(m[2], 10), index: m.index, skip: m[1].length }))
    .filter((c) => c.num >= 1 && c.num <= 498);
  const best = new Array(cand.length).fill(1); // lunghezza LIS che termina in i
  const prev = new Array(cand.length).fill(-1);
  let fineLis = 0;
  for (let i = 0; i < cand.length; i++) {
    for (let j = 0; j < i; j++) {
      if (cand[j].num < cand[i].num && best[j] + 1 > best[i]) { best[i] = best[j] + 1; prev[i] = j; }
    }
    if (best[i] > best[fineLis]) fineLis = i;
  }
  const confini = [];
  for (let i = fineLis; i >= 0; i = prev[i]) { confini.unshift(cand[i]); if (prev[i] === -1) break; }
  const articoli = [];
  for (let i = 0; i < confini.length; i++) {
    const fine = i + 1 < confini.length ? confini[i + 1].index : Math.min(corpo.length, confini[i].index + 20000);
    let testoArt = corpo.slice(confini[i].index + confini[i].skip, fine)
      .replace(/^\d{1,3}\.\s/, "")
      .replace(/\n+/g, "\n")
      .trim();
    if (testoArt.length > 20000) testoArt = testoArt.slice(0, 20000) + " […]";
    articoli.push({ numero: confini[i].num, testo: testoArt });
  }
  return articoli;
}

async function run({ db, budget } = {}) {
  let own = false;
  if (!db) { db = store.openDb(); own = true; }

  let salvatiTot = 0;

  // ── 1. Codice penale 1889 (testo integrale da OCR) ──
  const esistenti = store.countArticoli ? store.countArticoli(db, URN_CP) : 0;
  if (esistenti > 400) {
    console.log(`[SCV] Codice penale 1889 già presente (${esistenti} artt.), salto`);
  } else {
    let raw = null;
    for (const url of [OCR_CP_URL, OCR_CP_MIRROR]) {
      try {
        const buf = fetchBytes(url, { timeout: 120 });
        if (buf && buf.length > 100000) { raw = buf.toString("utf-8"); break; }
      } catch (e) { console.warn(`[SCV] fetch OCR fallito (${url.slice(0, 60)}…): ${e.message}`); }
    }
    if (!raw) throw new Error("OCR del Codice penale 1889 non scaricabile");

    const articoli = parseArticoli(puliziaOcr(raw));
    console.log(`[SCV] Codice penale 1889: ${articoli.length}/498 articoli estratti dall'OCR`);

    const arts = articoli.map((a, i) => ({
      numero_articolo: a.numero,
      rubrica: "Testo storico 1889 (OCR d'epoca, possibili refusi). " + NOTA_RECEPIMENTO,
      testo_vigente: a.testo,
      ordine: i,
    }));
    store.upsertAtto(db, {
      urn: URN_CP,
      tipo: "CODICE PENALE (SCV)",
      anno: 1889,
      data_pubblicazione: "1889-06-30",
      titolo: "Codice Penale vigente nello SCV — R.D. 30 giugno 1889, n. 6133 (codice Zanardelli), recepito con L. n. II/1929",
      url_fonte: "https://archive.org/details/il-codice-penale-per-il-regno-d-italia-1889",
      data_vigenza: store.ymdOggi().replace(/-/g, ""),
      n_articoli: arts.length,
      ordinamento: "vaticano",
    });
    const salvati = store.saveArticoli(db, URN_CP, arts);
    if (budget) budget.spend(salvati);
    salvatiTot += salvati;
    console.log(`[SCV] Salvati ${salvati} articoli in ${URN_CP}`);
  }

  // ── 2. Codice di procedura penale 1913 (scheda con nota) ──
  store.upsertAtto(db, {
    urn: URN_CPP,
    tipo: "CODICE DI PROCEDURA PENALE (SCV)",
    anno: 1913,
    data_pubblicazione: "1913-02-27",
    titolo: "Codice di Procedura Penale vigente nello SCV — R.D. 27 febbraio 1913, n. 127, recepito con L. n. II/1929",
    url_fonte: "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1913-02-27;127",
    data_vigenza: store.ymdOggi().replace(/-/g, ""),
    n_articoli: 1,
    ordinamento: "vaticano",
  });
  store.saveArticoli(db, URN_CPP, [{
    numero_articolo: "1",
    rubrica: "Nota sul testo",
    testo_vigente:
      "Il Codice di procedura penale vigente nello Stato della Città del Vaticano è il codice italiano " +
      "approvato con R.D. 27 febbraio 1913, n. 127 (653 articoli). " + NOTA_RECEPIMENTO + "\n\n" +
      "Il testo integrale del codice del 1913 non è oggi pubblicato in alcuna fonte digitale aperta: " +
      "Normattiva espone il solo segnaposto di abrogazione (valido per l'ordinamento italiano, dove è " +
      "stato sostituito dal codice del 1930 e poi del 1988 — non per lo SCV, dove resta vigente), e non " +
      "esistono edizioni digitalizzate complete su Wikisource o Archive.org. Questa scheda verrà " +
      "sostituita dal testo integrale non appena una fonte aperta lo renderà disponibile. " +
      "Le modifiche vaticane (Legge n. L/1969, Leggi n. VIII e IX/2013, m.p. 2021 e 2023) sono " +
      "consultabili per esteso nel ramo Leggi Vaticane di questo corpus.",
    ordine: 0,
  }]);
  if (budget) budget.spend(1);
  salvatiTot += 1;
  console.log(`[SCV] Scheda cpp 1913 salvata in ${URN_CPP}`);

  if (own) db.close();
  return salvatiTot;
}

module.exports = { run, URN_CP, URN_CPP };

if (require.main === module) {
  run().then((n) => console.log(`[SCV] Fatto: ${n} unità`)).catch((e) => { console.error(e); process.exit(1); });
}
