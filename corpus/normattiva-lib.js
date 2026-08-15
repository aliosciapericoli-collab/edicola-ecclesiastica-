/**
 * lib.js — utilità dello scraper corpus Normativa (Normattiva).
 * HTTP con sessione/cookie + anti-ban + retromarcia, download AKN, parser AKN→articoli,
 * metadati via API opendata, guardie disco/finestra, log. Vedi DISCOVERY.md.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const HOST = "www.normattiva.it";
const API_HOST = "api.normattiva.it";
const UA = "EdicolaEcclesiastica-Archiver/1.0";
const PERMALINK = (urn) => `https://${HOST}/uri-res/N2Ls?${urn}`;
const OPENDATA = `https://${API_HOST}/t/normattiva.api/bff-opendata/v1/api/v1`;
const API_DETTAGLIO = `${OPENDATA}/atto/dettaglio-atto-urn`;
const API_COLLEZIONI = `${OPENDATA}/collections/collection-predefinite`;
const API_COLLEZIONE_DOWNLOAD = `${OPENDATA}/collections/download/collection-preconfezionata`;

const LOG_PATH = path.join(__dirname, "scrape.log");

const agent = new https.Agent({ keepAlive: true, maxSockets: 2 });

/* ------------------------------- LOG -------------------------------- */
function log(level, msg, extra) {
  const rec = { t: new Date().toISOString(), level, msg, ...(extra || {}) };
  const line = JSON.stringify(rec);
  process.stdout.write(line + "\n");
  try { fs.appendFileSync(LOG_PATH, line + "\n"); } catch (_) {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --- Retromarcia automatica (come corpus Cassazione) ----------------- */
const _throttle = { banSignals: 0, slowdown: 1 };
function banSignalCount() { return _throttle.banSignals; }
function resetBanSignals() { _throttle.banSignals = 0; }
function setSlowdown(f) { _throttle.slowdown = Math.max(1, f || 1); }
function getSlowdown() { return _throttle.slowdown; }

/** Ritardo educato 3–5 s con jitter, moltiplicato dal fattore di retromarcia. */
function politeDelay() {
  const base = 3000 + Math.floor(Math.random() * 2000);
  return sleep(base * _throttle.slowdown);
}

/* ------------------------- cookie jar minimale ---------------------- */
function newJar() { return {}; }
function absorbCookies(jar, headers) {
  const sc = headers["set-cookie"];
  if (!sc) return;
  for (const line of sc) {
    const [pair] = line.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
}
function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

/* --------------------------- HTTP core ------------------------------ */
function rawRequest(urlStr, { method = "GET", body = null, headers = {}, jar = null, timeoutMs = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    if (u.hostname !== HOST && u.hostname !== API_HOST) return reject(new Error(`Host non consentito: ${u.hostname}`));
    const h = { "User-Agent": UA, Accept: "*/*", ...headers };
    if (jar && Object.keys(jar).length) h["Cookie"] = cookieHeader(jar);
    if (body != null) h["Content-Length"] = Buffer.byteLength(body);
    const req = https.request(
      { method, hostname: u.hostname, path: u.pathname + u.search, agent, headers: h, timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (jar) absorbCookies(jar, res.headers);
          resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) });
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    if (body != null) req.write(body);
    req.end();
  });
}

const BAN_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000];
const NET_RETRY_MS = [5_000, 15_000];
const SRV_RETRY_MS = [5_000];

function taggedError(msg, kind, status) {
  const e = new Error(msg); e.kind = kind; if (status) e.status = status; return e;
}

/**
 * Fetch con backoff differenziato. err.kind: 'ban'(403/429) | 'network' | 'server'(5xx) | 'client'(4xx).
 * Ogni 403/429 incrementa il contatore ban (retromarcia). 30-min backoff solo su ban.
 */
async function fetchWithBackoff(urlStr, opts = {}) {
  let banAttempt = 0, netAttempt = 0, srvAttempt = 0;
  while (true) {
    let res;
    try {
      res = await rawRequest(urlStr, opts);
    } catch (netErr) {
      if (netAttempt < NET_RETRY_MS.length) { await sleep(NET_RETRY_MS[netAttempt++]); continue; }
      throw taggedError(`rete: ${netErr.message || netErr}`, "network");
    }
    if (res.status === 429 || res.status === 403) {
      _throttle.banSignals++;
      if (banAttempt < BAN_BACKOFF_MS.length) {
        const wait = BAN_BACKOFF_MS[banAttempt++];
        log("warn", "backoff anti-ban", { attempt: banAttempt, waitMs: wait, status: res.status, banSignals: _throttle.banSignals, url: urlStr });
        await sleep(wait); continue;
      }
      throw taggedError(`HTTP ${res.status} (backoff esaurito)`, "ban", res.status);
    }
    if (res.status >= 500) {
      if (srvAttempt < SRV_RETRY_MS.length) { await sleep(SRV_RETRY_MS[srvAttempt++]); continue; }
      throw taggedError(`HTTP ${res.status}`, "server", res.status);
    }
    if (res.status >= 400) throw taggedError(`HTTP ${res.status}`, "client", res.status);
    return res;
  }
}

/* --------------------------- utilità date --------------------------- */
function ymdOggi() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
function ymdToIso(s) {
  const m = String(s || "").match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/* --------------------- decodifica entità HTML ----------------------- */
const ENT = { "&nbsp;": " ", "&lt;": "<", "&gt;": ">", "&amp;": "&", "&apos;": "'", "&quot;": '"' };
function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;|&lt;|&gt;|&amp;|&apos;|&quot;/g, (m) => ENT[m])
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(+n); } catch { return ""; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCharCode(parseInt(n, 16)); } catch { return ""; } });
}
function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, ""); }
function cleanText(s) {
  return decodeEntities(stripTags(String(s || "").replace(/<br\s*\/?>/gi, "\n")))
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/* --------------------- metadati via API opendata -------------------- */
async function fetchMetaOpendata(urn) {
  try {
    const res = await fetchWithBackoff(API_DETTAGLIO, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ urn }),
    });
    const j = JSON.parse(res.buffer.toString("utf-8"));
    const a = j && j.data && j.data.atto;
    if (!a) return null;
    return {
      titolo: a.titolo || null,
      tipo: a.tipoProvvedimentoDescrizione || null,
      numero: a.numeroProvvedimento || null,
      anno: a.annoProvvedimento || null,
      data_pubblicazione:
        a.annoGU && a.meseGU && a.giornoGU
          ? `${a.annoGU}-${String(a.meseGU).padStart(2, "0")}-${String(a.giornoGU).padStart(2, "0")}`
          : null,
    };
  } catch (_) {
    return null;
  }
}

/* ------------- scarica l'AKN dell'atto (permalink → caricaAKN) ------- */
/**
 * fetchAttoAKN(urn, opts) → { ok, urn, akn, permalink, codiceRedaz, dataGU, dataVigenza }
 * Apre la sessione sul permalink, estrae il link caricaAKN dalla pagina, scarica l'XML AKN.
 * opts.politeBetween: se true, attende politeDelay tra permalink e caricaAKN.
 */
async function fetchAttoAKN(urn, opts = {}) {
  const jar = newJar();
  const permalink = PERMALINK(urn);
  const pres = await fetchWithBackoff(permalink, { jar });
  const html = pres.buffer.toString("utf-8");
  const m = html.match(/\/do\/atto\/caricaAKN\?[^"'\s]+/i);
  if (!m) {
    // Due casi ben diversi, che prima finivano entrambi in "atto non risolto":
    //  (a) l'URN non esiste → Normattiva serve la pagina "Errore" (§6.1);
    //  (b) l'URN esiste, la pagina è quella giusta, ma il link caricaAKN NON c'è.
    // Il (b) è la condizione degli atti RECENTISSIMI, non ancora consolidati: verificato il
    // 31/07/2026 su L. 134/2026 — `<title>LEGGE 16 luglio 2026, n. 134 - Normattiva`, 64.667 B,
    // zero occorrenze di caricaAKN. Non è un fallimento definitivo: l'export comparirà. Va
    // quindi distinto, altrimenti l'atto resta marcato 'error' per sempre e non lo si riprende.
    const titolo = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
    const paginaErrore = /errore/i.test(titolo);
    const e = new Error(paginaErrore
      ? "atto non risolto (pagina di errore Normattiva)"
      : "export AKN non ancora pubblicato per questo atto");
    e.kind = paginaErrore ? "client" : "noexport";
    throw e;
  }
  let aknPath = m[0].replace(/&amp;/g, "&");
  // forza dataVigenza a oggi (solo testo vigente), quale che sia quella in pagina
  const dataVigenza = ymdOggi();
  aknPath = aknPath.replace(/dataVigenza=\d+/, `dataVigenza=${dataVigenza}`);
  const codiceRedaz = (aknPath.match(/codiceRedaz=([^&]+)/) || [])[1] || null;
  const dataGU = (aknPath.match(/dataGU=(\d+)/) || [])[1] || null;

  if (opts.politeBetween) await politeDelay();
  const ares = await fetchWithBackoff(`https://${HOST}${aknPath}`, { jar });
  const ct = ares.headers["content-type"] || "";
  const xml = ares.buffer.toString("utf-8");
  if (!/xml/i.test(ct) || !/<akomaNtoso/i.test(xml)) {
    const e = new Error(`export AKN non valido (ct=${ct}, len=${xml.length})`);
    e.kind = "server";
    throw e;
  }
  return { ok: true, urn, akn: xml, permalink, codiceRedaz, dataGU, dataVigenza };
}

/* ========== ENUMERAZIONE DEL CATALOGO (elencoPerData, DISCOVERY §6.2) ========== */
/* Navigazione server-side con stato in SESSIONE: `/anno/<AAAA>` imposta il filtro e dà la
 * prima pagina, `/<N>` dà la pagina successiva dello stesso filtro (indice 0-based, 20 per
 * pagina). Serve lo stesso cookie jar per tutta l'enumerazione di un anno. */
const ELENCO_ANNO = (anno) => `https://${HOST}/ricerca/elencoPerData/anno/${anno}`;
const ELENCO_PAGINA = (idx) => `https://${HOST}/ricerca/elencoPerData/${idx}`;

const MESI_IT = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

/**
 * URN NIR costruito dall'intestazione dell'elenco ("LEGGE 23 Luglio 2026,  n. 135").
 * Serve perché l'elenco NON espone l'URN e il permalink N2Ls è l'unico modo di aprire il
 * contesto d'atto: verificato il 31/07/2026 che `caricaDettaglioAtto` (che pure ha dataGU e
 * codiceRedazionale) NON abilita `caricaAKN` — risponde la stessa pagina d'errore da 32.261 B
 * del caso "nessuna sessione".
 * Il tipo diventa il token dell'URN con la stessa regola di Normattiva: minuscolo, spazi e
 * trattini → punti ("DECRETO-LEGGE" → decreto.legge, "REGIO DECRETO" → regio.decreto).
 * Ritorna null se manca il numero: senza numero l'URN non è costruibile.
 */
function urnDaIntestazione(testo) {
  const t = cleanText(testo).replace(/\s+/g, " ").trim();
  const m = t.match(/^(.*?)\s+(\d{1,2})\s+([A-Za-zàèéìòù]+)\s+(\d{4})\s*,?\s*n\.?\s*(\d{1,5})/i);
  if (!m) return null;
  const mese = MESI_IT[m[3].toLowerCase()];
  if (!mese) return null;
  const tipo = m[1].toLowerCase().replace(/[\s-]+/g, ".").replace(/\.+/g, ".").replace(/^\.|\.$/g, "");
  if (!tipo) return null;
  const data = `${m[4]}-${String(mese).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
  return { urn: `urn:nir:stato:${tipo}:${data};${parseInt(m[5], 10)}`, tipo, data, numero: parseInt(m[5], 10), anno: parseInt(m[4], 10) };
}

/**
 * parseElenco(html) → { totale, items: [{ dataGU, codiceRedaz, intestazione, urn, descrizione }] }
 * `totale` viene dal testo "Sono stati trovati N atti."; gli item dalle ancore
 * caricaDettaglioAtto, che portano già dataGU e codice redazionale.
 */
function parseElenco(html) {
  const tot = html.match(/Sono stati trovati\s*([\d.]+)\s*atti/i);
  const totale = tot ? parseInt(tot[1].replace(/\./g, ""), 10) : null;
  const items = [];
  const visti = new Set();
  const re = /<a\b[^>]*href="\/atto\/caricaDettaglioAtto\?atto\.dataPubblicazioneGazzetta=(\d{4}-\d{2}-\d{2})&(?:amp;)?atto\.codiceRedazionale=([^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const codiceRedaz = decodeEntities(m[2]).trim();
    if (visti.has(codiceRedaz)) continue; // la stessa ancora compare più volte per item
    visti.add(codiceRedaz);
    const intestazione = cleanText(m[3]).replace(/\s+/g, " ").trim();
    const u = urnDaIntestazione(intestazione);
    items.push({
      dataGU: m[1].replace(/-/g, ""),
      codiceRedaz,
      intestazione,
      urn: u ? u.urn : null,
      anno: u ? u.anno : null,
    });
  }
  return { totale, items };
}

/** Pagina 1 dell'anno: imposta il filtro nella sessione. Il jar va riusato per le pagine dopo. */
async function fetchElencoAnno(anno, jar) {
  const res = await fetchWithBackoff(ELENCO_ANNO(anno), { jar });
  return parseElenco(res.buffer.toString("utf-8"));
}
/** Pagina successiva dello stesso filtro. `idx` è 0-based: 0 = pagina 1, 1 = pagina 2, … */
async function fetchElencoPagina(idx, jar) {
  const res = await fetchWithBackoff(ELENCO_PAGINA(idx), { jar });
  return parseElenco(res.buffer.toString("utf-8"));
}

/* ============ COLLEZIONI OPENDATA (canale BULK, vedi DISCOVERY §6.3) ============ */
/**
 * Elenco delle collezioni preconfezionate. Una riga per (collezione × formato di vigenza):
 * { nomeCollezione, formatoCollezione: 'O'|'M'|'V', descrizioneFormatoCollezione,
 *   dataCreazione: 'YYYY-MM-DD', numeroAtti }.
 * `dataCreazione` è la freschezza del pacchetto: al 31/07/2026 quasi tutte sono rigenerate
 * in giornata, quindi è utilizzabile come chiave di refresh (non riscaricare la stessa data).
 */
async function fetchCollezioni() {
  const res = await fetchWithBackoff(API_COLLEZIONI, { headers: { Accept: "application/json" } });
  const j = JSON.parse(res.buffer.toString("utf-8"));
  if (!Array.isArray(j)) throw new Error("collection-predefinite: risposta non è un array");
  return j;
}

/** Solo le collezioni in formato VIGENTE, dalla più piccola alla più grande. */
function collezioniVigenti(tutte) {
  return tutte.filter((c) => c.formatoCollezione === "V").sort((a, b) => a.numeroAtti - b.numeroAtti);
}

/**
 * Scarica un URL su file, in STREAMING (gli ZIP arrivano a qualche GB: bufferizzarli in
 * memoria come fa rawRequest non è praticabile) e seguendo i redirect a mano.
 * L'endpoint `collections/download` risponde 302 verso `…/file-download/v1/download/<token>`,
 * sullo stesso host `api.normattiva.it`, quindi la guardia sugli host resta valida.
 * Ritorna { bytes, redirects, url }.
 */
function scaricaSuFile(urlStr, destPath, { maxRedirect = 5, timeoutMs = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    let redirects = 0;
    const vai = (u) => {
      const url = new URL(u);
      if (url.hostname !== HOST && url.hostname !== API_HOST) return reject(new Error(`Host non consentito: ${url.hostname}`));
      const req = https.request(
        { method: "GET", hostname: url.hostname, path: url.pathname + url.search, agent, timeout: timeoutMs,
          headers: { "User-Agent": UA, Accept: "*/*" } },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume(); // scarta il corpo del redirect
            if (++redirects > maxRedirect) return reject(new Error("troppi redirect"));
            return vai(new URL(res.headers.location, u).toString());
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(taggedError(`HTTP ${res.statusCode} sul download`, res.statusCode === 403 || res.statusCode === 429 ? "ban" : res.statusCode >= 500 ? "server" : "client", res.statusCode));
          }
          const out = fs.createWriteStream(destPath);
          let bytes = 0;
          res.on("data", (c) => { bytes += c.length; });
          res.pipe(out);
          out.on("finish", () => out.close(() => resolve({ bytes, redirects, url: u })));
          out.on("error", reject);
          res.on("error", reject);
        }
      );
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout sul download")); });
      req.end();
    };
    vai(urlStr);
  });
}

/**
 * Scarica il pacchetto di una collezione. ⚠️ I due parametri di formato sono controintuitivi
 * (DISCOVERY §6.3.1): `formato` = ESTENSIONE del pacchetto (AKN, XML, PDF…), `formatoRichiesta`
 * = VIGENZA (O originale, M multivigente, V vigente). Invertirli dà 400 con un messaggio che
 * nomina comunque la vigenza.
 */
function scaricaCollezione(nome, destPath, { formato = "AKN", vigenza = "V" } = {}) {
  const qs = `?nome=${encodeURIComponent(nome)}&formato=${encodeURIComponent(formato)}&formatoRichiesta=${encodeURIComponent(vigenza)}`;
  return scaricaSuFile(API_COLLEZIONE_DOWNLOAD + qs, destPath);
}

/* ----------------------- parser AKN → articoli ---------------------- */
function pulisciRubrica(s) {
  let r = cleanText(s || "").replace(/\(\(|\)\)/g, "").replace(/\s+/g, " ").trim();
  if (/^\(.*\)\.?$/.test(r)) r = r.replace(/^\(\s*/, "").replace(/\s*\)\.?$/, "").trim();
  return r || null;
}

// Articoli dal corpo principale: <article eId="art_...">.
function parseArticoliBody(xml) {
  const out = [];
  const seen = new Set();
  const re = /<article\b([^>]*)>([\s\S]*?)<\/article>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const eId = (m[1].match(/eId="([^"]+)"/) || [])[1] || "";
    const mnum = eId.match(/^art_(.+)$/i);
    if (!mnum) continue;
    const numero_articolo = mnum[1].replace(/_/g, "-").toLowerCase();
    if (seen.has(numero_articolo)) continue;
    seen.add(numero_articolo);
    const inner = m[2] || "";
    const rubrica = pulisciRubrica((inner.match(/<heading\b[^>]*>([\s\S]*?)<\/heading>/i) || [])[1]);
    const ps = [...inner.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((x) => cleanText(x[1]));
    let testo = ps.join("\n").trim();
    if (!testo) testo = cleanText(inner.replace(/<num\b[^>]*>[\s\S]*?<\/num>/i, "").replace(/<heading\b[^>]*>[\s\S]*?<\/heading>/i, ""));
    out.push({ numero_articolo, rubrica, testo_vigente: testo || null });
  }
  return out;
}

// Articoli in allegato: <attachment><doc name="…-art. N">…<mainBody>. Usato per i
// "codici" approvati con decreto breve + codice in allegato (es. Cod. Navigazione,
// Cod. Giustizia Contabile), dove il corpo principale ha solo gli articoli di approvazione.
function parseArticoliAllegato(xml) {
  const out = [];
  const seen = new Set();
  const re = /<attachment>([\s\S]*?)<\/attachment>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const att = m[1];
    const name = (att.match(/<doc\b[^>]*name="([^"]+)"/i) || [])[1] || "";
    const mnum = name.match(/art\.?\s*([0-9]+(?:-(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)\s*$/i);
    if (!mnum) continue; // non è un articolo (potrebbe essere una tabella/allegato non articolato)
    const numero_articolo = mnum[1].toLowerCase();
    if (seen.has(numero_articolo)) continue;
    seen.add(numero_articolo);
    const body = (att.match(/<mainBody\b[^>]*>([\s\S]*?)<\/mainBody>/i) || [])[1] || att;
    // togli il <ref> di intestazione ("CODICE… Art. N") per non sporcare il testo/rubrica
    const bodyNoRef = body.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, "");
    let testo = [...bodyNoRef.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((x) => cleanText(x[1])).join("\n").trim();
    if (!testo) testo = cleanText(bodyNoRef);
    // togli il ". " residuo del <ref> e l'eventuale "Art. N." inline di intestazione
    testo = testo.replace(/^[.\s]+/, "").replace(/^Art\.?\s*[0-9]+(?:-[a-z]+)?\.?\s*/i, "");
    // rubrica: "(...)" o "((...))" iniziale
    let rubrica = null;
    const mr = testo.match(/^\({1,2}\s*([^)]{2,140}?)\s*\){1,2}\s*\.?/);
    if (mr) { rubrica = mr[1].replace(/\s+/g, " ").replace(/\.$/, "").trim(); testo = testo.slice(mr[0].length).trim(); }
    out.push({ numero_articolo, rubrica: rubrica || null, testo_vigente: testo || null });
  }
  return out;
}

/**
 * parseAkn(xml) → { titolo, articoli: [{numero_articolo, rubrica, testo_vigente}] }
 * Usa gli <article> del corpo; se il codice è in allegato (più articoli negli
 * <attachment> che nel corpo), usa quelli.
 */
function parseAkn(xml) {
  const body = parseArticoliBody(xml);
  let articoli = body;
  if (/<attachment>/i.test(xml)) {
    const allegato = parseArticoliAllegato(xml);
    if (allegato.length > body.length) articoli = allegato; // codice in allegato
  }
  const titolo = cleanText((xml.match(/<docTitle\b[^>]*>([\s\S]*?)<\/docTitle>/i) || [])[1] || "") || null;
  return { titolo, articoli };
}

/* --------------------------- GUARDIE -------------------------------- */
function freeSpacePct(targetPath) {
  const out = execFileSync("df", ["-P", targetPath]).toString("utf-8").trim().split("\n");
  const cols = out[out.length - 1].split(/\s+/);
  return 100 - parseInt(cols[4].replace("%", ""), 10);
}
function inWindow(startH = 1, endH = 7) {
  const h = new Date().getHours();
  return h >= startH && h < endH;
}

/* ------------- estrai URN degli ultimi provvedimenti (home) --------- */
async function fetchUrnRecentiHome() {
  const res = await fetchWithBackoff(`https://${HOST}/`, { jar: newJar() });
  const html = res.buffer.toString("utf-8");
  const urns = [...html.matchAll(/N2Ls\?(urn:nir:stato:[^"'&<> ]+)/g)].map((x) => x[1]);
  return [...new Set(urns)];
}

module.exports = {
  HOST, API_HOST, UA, PERMALINK, LOG_PATH,
  log, sleep, politeDelay,
  banSignalCount, resetBanSignals, setSlowdown, getSlowdown,
  fetchWithBackoff, fetchMetaOpendata, fetchAttoAKN, parseAkn,
  fetchUrnRecentiHome,
  fetchCollezioni, collezioniVigenti, scaricaSuFile, scaricaCollezione,
  newJar, parseElenco, urnDaIntestazione, fetchElencoAnno, fetchElencoPagina,
  ymdOggi, ymdToIso, cleanText,
  freeSpacePct, inWindow,
};
