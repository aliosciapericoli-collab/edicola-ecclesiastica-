'use strict';
/**
 * services/normattiva.js — Integrazione API Normattiva (open data, no key)
 * POST https://api.normattiva.it/t/normattiva.api/bff-opendata/v1/api/v1/atto/dettaglio-atto-urn
 */

const BASE_URL = 'https://api.normattiva.it/t/normattiva.api/bff-opendata/v1/api/v1/atto/dettaglio-atto-urn';

// Mapping codici principali → base URN
// NOTA: l'API Normattiva restituisce articoloHtml completo solo per leggi post-1948.
// Per i codici storici (c.p., c.c., c.p.c. = regio.decreto) l'API restituisce
// solo metadati interni (idArticolo, codiceRedazionale) senza testo articolo.
// c.p.p. (d.p.r. 1988) e tutte le leggi/d.lgs. moderne funzionano correttamente.
const CODICI_URN = {
  // ── CODICI STORICI (regio.decreto, pre-1948) ⚠️ metadati only — no articoloHtml ──
  'c.p.':                    'urn:nir:stato:regio.decreto:1930-10-19;1398',
  'cod. pen.':               'urn:nir:stato:regio.decreto:1930-10-19;1398',
  'c.c.':                    'urn:nir:stato:regio.decreto:1942-03-16;262',
  'cod. civ.':               'urn:nir:stato:regio.decreto:1942-03-16;262',
  'c.p.c.':                  'urn:nir:stato:regio.decreto:1940-10-28;1443',
  'cod. proc. civ.':         'urn:nir:stato:regio.decreto:1940-10-28;1443',
  'cod. nav.':               'urn:nir:stato:regio.decreto:1942-03-28;327',
  'codice della navigazione':'urn:nir:stato:regio.decreto:1942-03-28;327',

  // ── CODICI MODERNI ✅ testo completo ─────────────────────────────────────
  // Codice di Procedura Penale — D.P.R. 447/1988
  'c.p.p.':                  'urn:nir:stato:decreto.del.presidente.della.repubblica:1988-09-22;447',
  'cod. proc. pen.':         'urn:nir:stato:decreto.del.presidente.della.repubblica:1988-09-22;447',
  // Codice della Strada — D.Lgs. 285/1992
  'cod. strada':             'urn:nir:stato:decreto.legislativo:1992-04-30;285',
  'cod.strada':              'urn:nir:stato:decreto.legislativo:1992-04-30;285',
  'c.d.s.':                  'urn:nir:stato:decreto.legislativo:1992-04-30;285',
  'codice della strada':     'urn:nir:stato:decreto.legislativo:1992-04-30;285',
  'd.lgs. 285':              'urn:nir:stato:decreto.legislativo:1992-04-30;285',
  // T.U. Immigrazione — D.Lgs. 286/1998
  'tu immigrazione':         'urn:nir:stato:decreto.legislativo:1998-07-25;286',
  't.u. imm.':               'urn:nir:stato:decreto.legislativo:1998-07-25;286',
  'd.lgs. 286':              'urn:nir:stato:decreto.legislativo:1998-07-25;286',
  // T.U. Edilizia — D.P.R. 380/2001
  't.u. edilizia':           'urn:nir:stato:decreto.del.presidente.della.repubblica:2001-06-06;380',
  'tu edilizia':             'urn:nir:stato:decreto.del.presidente.della.repubblica:2001-06-06;380',
  'd.p.r. 380':              'urn:nir:stato:decreto.del.presidente.della.repubblica:2001-06-06;380',
  // Codice delle Comunicazioni Elettroniche — D.Lgs. 259/2003
  'codice comunicazioni':    'urn:nir:stato:decreto.legislativo:2003-08-01;259',
  'cod. com. el.':           'urn:nir:stato:decreto.legislativo:2003-08-01;259',
  'd.lgs. 259':              'urn:nir:stato:decreto.legislativo:2003-08-01;259',
  // Codice del Processo Amministrativo — D.Lgs. 104/2010 (già in DB come codice_pa_amministrativo)
  'cpa':                     'urn:nir:stato:decreto.legislativo:2010-07-02;104',
  'd.lgs. 104':              'urn:nir:stato:decreto.legislativo:2010-07-02;104',
  // Codice Antimafia — D.Lgs. 159/2011
  'codice antimafia':        'urn:nir:stato:decreto.legislativo:2011-09-06;159',
  'cod. antimafia':          'urn:nir:stato:decreto.legislativo:2011-09-06;159',
  'd.lgs. 159':              'urn:nir:stato:decreto.legislativo:2011-09-06;159',
  // Codice del Terzo Settore — D.Lgs. 117/2017
  'codice terzo settore':    'urn:nir:stato:decreto.legislativo:2017-07-03;117',
  'cod. terzo settore':      'urn:nir:stato:decreto.legislativo:2017-07-03;117',
  'd.lgs. 117':              'urn:nir:stato:decreto.legislativo:2017-07-03;117',
  // Codice di Giustizia Contabile — D.Lgs. 174/2016
  'codice giustizia contabile': 'urn:nir:stato:decreto.legislativo:2016-10-26;174',
  'cod. giust. cont.':       'urn:nir:stato:decreto.legislativo:2016-10-26;174',
  'd.lgs. 174':              'urn:nir:stato:decreto.legislativo:2016-10-26;174',
  // T.U. Stupefacenti — D.P.R. 309/1990
  'tu stupefacenti':         'urn:nir:stato:decreto.del.presidente.della.repubblica:1990-10-09;309',
  't.u. stup.':              'urn:nir:stato:decreto.del.presidente.della.repubblica:1990-10-09;309',
  'd.p.r. 309':              'urn:nir:stato:decreto.del.presidente.della.repubblica:1990-10-09;309',
  'd.p.r. 309/90':           'urn:nir:stato:decreto.del.presidente.della.repubblica:1990-10-09;309',
  // T.U. Sicurezza Lavoro — D.Lgs. 81/2008
  'tu sicurezza':            'urn:nir:stato:decreto.legislativo:2008-04-09;81',
  't.u. sicurezza':          'urn:nir:stato:decreto.legislativo:2008-04-09;81',
  'd.lgs. 81':               'urn:nir:stato:decreto.legislativo:2008-04-09;81',
  // Codice dell'Ambiente — D.Lgs. 152/2006
  'codice ambiente':         'urn:nir:stato:decreto.legislativo:2006-04-03;152',
  'cod. ambiente':           'urn:nir:stato:decreto.legislativo:2006-04-03;152',
  'tu ambiente':             'urn:nir:stato:decreto.legislativo:2006-04-03;152',
  'd.lgs. 152':              'urn:nir:stato:decreto.legislativo:2006-04-03;152',
  // Ordinamento Penitenziario — L. 354/1975
  'ordinamento penitenziario': 'urn:nir:stato:legge:1975-07-26;354',
  'ord. pen.':               'urn:nir:stato:legge:1975-07-26;354',
  'l. 354':                  'urn:nir:stato:legge:1975-07-26;354',
};

// parseNormaToUrn("art. 131-bis c.p.") → "urn:nir:stato:regio.decreto:1930-10-19;1398~art131bis"
// parseNormaToUrn("186 cod. strada")   → "urn:nir:stato:decreto.legislativo:1992-04-30;285~art186"
function parseNormaToUrn(norma) {
  // Step 1: normalizza e rimuovi prefisso "art." / "artt." / "articolo"
  const raw = norma.trim().replace(/^artt?\.?\s*/i, '').replace(/^articol[oi]\s+/i, '');

  // Step 2: estrai numero articolo (con eventuale -bis/-ter/ecc.)
  const numMatch = raw.match(/([\d]+(?:-(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)/i);
  if (!numMatch) return null;
  const numArt = numMatch[1].trim();

  // Step 3: isola il "codice" — tutto ciò che viene dopo il numero
  const dopoNumero = raw.slice(raw.indexOf(numMatch[0]) + numMatch[0].length)
    .trim()
    .replace(/^[,\s]+/, '')
    .trim()
    .toLowerCase();

  // Normalizza: rimuovi accenti e comprimi spazi
  const dopoNorm = dopoNumero
    .replace(/[àáâã]/g, 'a').replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i').replace(/[òóôõ]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/\s+/g, ' ').trim();

  // Step 4: cerca nelle chiavi CODICI_URN (dalla più lunga alla più corta)
  const chiavi = Object.keys(CODICI_URN).sort((a, b) => b.length - a.length);
  let baseUrn = null;
  for (const k of chiavi) {
    const kNorm = k.toLowerCase()
      .replace(/[àáâã]/g, 'a').replace(/[èéêë]/g, 'e')
      .replace(/[ìíîï]/g, 'i').replace(/[òóôõ]/g, 'o')
      .replace(/[ùúûü]/g, 'u')
      .replace(/\s+/g, ' ').trim();
    if (dopoNorm === kNorm || dopoNorm.startsWith(kNorm)) {
      baseUrn = CODICI_URN[k];
      break;
    }
  }
  if (!baseUrn) return null;

  // Step 5: costruisci suffisso articolo (senza trattini) → "131-bis" → "131bis"
  const artSuffix = numArt.replace(/-/g, '');
  return baseUrn + '~art' + artSuffix;
}

// fetchNormattiva(urn) → chiama API
async function fetchNormattiva(urn) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ urn }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    // Leggi sempre il body — l'API restituisce HTTP 404 per i regio.decreto
    // (c.p., c.c., c.p.c.) ma include comunque metadati utili nel body JSON.
    // Solo i veri errori (non-JSON, 5xx) vanno trattati come fallimento.
    let json;
    try {
      json = await res.json();
    } catch(ep) {
      return { ok: false, errore: 'HTTP ' + res.status };
    }
    // Se la risposta è un errore server (5xx) senza dati utili, fallisci
    if (res.status >= 500) return { ok: false, errore: 'HTTP ' + res.status };

    // Risposta completa (leggi post-1948, d.p.r., d.lgs., ecc.)
    if (json.success && json.data && json.data.atto) {
      const atto = json.data.atto;
      return {
        ok: true,
        titolo: atto.titolo,
        articoloHtml: atto.articoloHtml,
        inVigore: atto.articoloDataFineVigenza === '99999999',
        inizioVigenza: atto.articoloDataInizioVigenza,
        tipo: atto.tipoProvvedimentoCodice,
        urn: urn
      };
    }

    // Risposta metadati-only (regio.decreto pre-1948: c.p., c.c., c.p.c.)
    // Il messaggio contiene: "idArticolo:NNN codiceRedazionale:XXX ..."
    if (json.code === null && json.message && json.message.includes('idArticolo:')) {
      const msg = json.message;
      const idArt = (msg.match(/idArticolo:(\d+)/) || [])[1] || '';
      const codRed = (msg.match(/codiceRedazionale:(\S+)/) || [])[1] || '';
      return {
        ok: true,
        titolo: null,
        articoloHtml: null,   // non disponibile via API per codici storici
        metadatiOnly: true,   // segnala al chiamante che non c'è testo
        idArticolo: idArt,
        codiceRedazionale: codRed,
        linkNormattiva: `https://www.normattiva.it/uri-res/N2Ls?${urn}`,
        inVigore: null,       // non determinabile senza il testo
        urn: urn
      };
    }

    // 404 o altro errore
    return { ok: false, errore: json.message || 'Norma non trovata', code: json.code };
  } catch(e) {
    return { ok: false, errore: e.name === 'AbortError' ? 'Timeout' : e.message };
  }
}

// Cache in memoria
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const CACHE_MAX = 500;

async function getNormattiva(norma) {
  const urn = parseNormaToUrn(norma);
  if (!urn) return { ok: false, errore: 'Impossibile costruire URN per: ' + norma };

  // Check cache
  const cached = cache.get(urn);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  // Fetch
  const result = await fetchNormattiva(urn);

  // Cache solo successi
  if (result.ok) {
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(urn, { data: result, ts: Date.now() });
  }

  return result;
}

module.exports = { getNormattiva, parseNormaToUrn, fetchNormattiva, CODICI_URN };
