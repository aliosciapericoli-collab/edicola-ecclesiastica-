/**
 * fetch.js — HTTP del corpus ecclesiastico, basato su curl.
 *
 * Perché curl e non https di Node: gli importer girano sia sul server Hetzner
 * (rete diretta) sia in ambienti dietro proxy HTTPS (variabile HTTPS_PROXY),
 * che curl rispetta nativamente. Gestisce redirect, charset legacy
 * (vatican.va e IntraText servono ISO-8859-1) ed entità HTML.
 */

const { execFileSync } = require("child_process");

const UA = "EdicolaEcclesiastica-Archiver/1.0 (+archivio di studio del diritto canonico)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Scarica bytes. Ritorna Buffer. Lancia su HTTP >= 400. */
function fetchBytes(url, { timeout = 60 } = {}) {
  return execFileSync("curl", [
    "-sSL", "--fail", "--max-time", String(timeout),
    "-A", UA,
    // --retry-all-errors: i siti legacy (IntraText) chiudono la connessione
    // (reset) quando sono sotto carico — un errore transitorio da riprovare.
    "--retry", "4", "--retry-delay", "5", "--retry-all-errors",
    url,
  ], { maxBuffer: 64 * 1024 * 1024 });
}

/** Decodifica HTML rispettando il charset dichiarato (default latin-1 per i siti legacy). */
function decodeHtml(buf) {
  const head = buf.slice(0, 2048).toString("latin1");
  const m = head.match(/charset=["']?([\w-]+)/i);
  const cs = (m ? m[1] : "iso-8859-1").toLowerCase();
  if (cs.includes("utf-8") || cs.includes("utf8")) return buf.toString("utf8");
  return buf.toString("latin1");
}

/** Scarica una pagina HTML come stringa decodificata. */
function fetchHtml(url, opts) {
  return decodeHtml(fetchBytes(url, opts));
}

/* --------------------- Pulizia HTML → testo --------------------- */

const ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  agrave: "à", egrave: "è", eacute: "é", igrave: "ì", ograve: "ò", ugrave: "ù",
  Agrave: "À", Egrave: "È", Eacute: "É", Igrave: "Ì", Ograve: "Ò", Ugrave: "Ù",
  sect: "§", deg: "°", ordm: "º", ordf: "ª", laquo: "«", raquo: "»",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  ndash: "–", mdash: "—", hellip: "…", middot: "·",
};

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name] ?? m);
}

/** Rimuove script/style/tag e normalizza gli spazi mantenendo i paragrafi. */
function htmlToText(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\s*(p|br|div|tr|li|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((r) => r.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = { UA, sleep, fetchBytes, fetchHtml, decodeHtml, decodeEntities, htmlToText };
