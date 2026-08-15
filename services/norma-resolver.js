'use strict';
/**
 * services/norma-resolver.js
 * Risolve qualsiasi riferimento normativo in forma testuale.
 *
 * Input accettati:
 *   "art. 131-bis c.p."
 *   "131-bis c.p."
 *   "2043 c.c."
 *   "art. 2043 codice civile"
 *   "186 codice della strada"
 *   "73 d.p.r. 309/90"
 *   "art. 1 Cost."
 *
 * Logica:
 *   A) parsing — estrae numero + identificatore codice
 *   B) cerca in articoli_codice (DB locale, veloce)
 *   C) se non trovato → chiama normattiva.js (API esterna, async)
 *   D) se anche Normattiva fallisce → { trovata: false }
 */

const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'giuridica.db');

// ── Mapping abbreviazioni → codice_id della tabella articoli_codice ──────────
// Per i codici già presenti nel DB (14 codici esistenti) il resolver trova il testo localmente.
// Per i codici nuovi (non ancora in DB) il codice_id è definito ma cercaInDB() non troverà
// nulla → il resolver prosegue verso Normattiva (Step C) che ora conosce l'URN.
const ABBR_TO_CODICE = {
  // ── CODICI GIÀ IN DB ─────────────────────────────────────────────────────
  // Codice Penale
  'c.p.':                  'codice_penale',
  'cp':                    'codice_penale',
  'cod. pen.':             'codice_penale',
  'codice penale':         'codice_penale',
  'c. pen.':               'codice_penale',
  // Codice Civile
  'c.c.':                  'codice_civile',
  'cc':                    'codice_civile',
  'cod. civ.':             'codice_civile',
  'codice civile':         'codice_civile',
  'c. civ.':               'codice_civile',
  // CPC
  'c.p.c.':                'cpc',
  'cpc':                   'cpc',
  'cod. proc. civ.':       'cpc',
  'codice di procedura civile': 'cpc',
  'codice procedura civile':    'cpc',
  // CPP
  'c.p.p.':                'cpp',
  'cpp':                   'cpp',
  'cod. proc. pen.':       'cpp',
  'codice di procedura penale': 'cpp',
  'codice procedura penale':    'cpp',
  // Costituzione
  'cost.':                 'costituzione',
  'cost':                  'costituzione',
  'costituzione':          'costituzione',
  'carta costituzionale':  'costituzione',
  // TUIR
  'tuir':                  'tuir',
  'd.p.r. 917':            'tuir',
  'dpr 917':               'tuir',
  // Codice del Consumo
  'cod. cons.':            'codice_consumo',
  'codice del consumo':    'codice_consumo',
  'codice consumo':        'codice_consumo',
  // Codice della Crisi
  'cod. crisi':            'codice_crisi',
  'codice della crisi':    'codice_crisi',
  'codice crisi':          'codice_crisi',
  'c.c.i.i.':              'codice_crisi',
  'ccii':                  'codice_crisi',
  // Codice Privacy
  'cod. privacy':          'codice_privacy',
  'codice privacy':        'codice_privacy',
  'd.lgs. 196':            'codice_privacy',
  'dlgs 196':              'codice_privacy',
  // CAD
  'cad':                   'cad',
  'codice amministrazione digitale': 'cad',
  'd.lgs. 82':             'cad',
  // D.Lgs. 231/2001
  'd.lgs. 231':            'd231_2001',
  'dlgs 231':              'd231_2001',
  'd231':                  'd231_2001',
  'responsabilita enti':   'd231_2001',
  // L. 241/1990
  'l. 241':                'l241_1990',
  'legge 241':             'l241_1990',
  'l241':                  'l241_1990',
  // Statuto dei Lavoratori
  'stat. lav.':            'statuto_lavoratori',
  'statuto lavoratori':    'statuto_lavoratori',
  'statuto dei lavoratori': 'statuto_lavoratori',
  'l. 300':                'statuto_lavoratori',
  'legge 300':             'statuto_lavoratori',
  // Codice PA / CPA
  'cpa':                   'codice_pa_amministrativo',
  'cod. pa':               'codice_pa_amministrativo',
  'codice del processo amministrativo': 'codice_pa_amministrativo',
  'codice processo amministrativo':     'codice_pa_amministrativo',
  'd.lgs. 104':            'codice_pa_amministrativo',

  // ── NUOVI CODICI (non ancora in DB — fallback su Normattiva) ─────────────
  // Codice della Strada — D.Lgs. 285/1992
  'cod. strada':           'codice_strada',
  'cod.strada':            'codice_strada',
  'c.d.s.':               'codice_strada',
  'cds':                   'codice_strada',
  'codice della strada':   'codice_strada',
  'codice stradale':       'codice_strada',
  'd.lgs. 285':            'codice_strada',
  'dlgs 285':              'codice_strada',
  // Codice dell'Ambiente — D.Lgs. 152/2006
  'cod. amb.':             'codice_ambiente',
  'cod. ambiente':         'codice_ambiente',
  'codice dell\'ambiente': 'codice_ambiente',
  'codice ambiente':       'codice_ambiente',
  't.u. ambiente':         'codice_ambiente',
  'tu ambiente':           'codice_ambiente',
  'd.lgs. 152':            'codice_ambiente',
  'dlgs 152':              'codice_ambiente',
  // Codice Antimafia — D.Lgs. 159/2011
  'cod. antimafia':        'codice_antimafia',
  'codice antimafia':      'codice_antimafia',
  'd.lgs. 159':            'codice_antimafia',
  'dlgs 159':              'codice_antimafia',
  // Testo Unico Edilizia — D.P.R. 380/2001
  't.u. edilizia':         'tu_edilizia',
  'tu edilizia':           'tu_edilizia',
  'testo unico edilizia':  'tu_edilizia',
  'd.p.r. 380':            'tu_edilizia',
  'dpr 380':               'tu_edilizia',
  // Testo Unico Sicurezza Lavoro — D.Lgs. 81/2008
  't.u. sicurezza':        'tu_sicurezza',
  'tu sicurezza':          'tu_sicurezza',
  'testo unico sicurezza': 'tu_sicurezza',
  'd.lgs. 81':             'tu_sicurezza',
  'dlgs 81':               'tu_sicurezza',
  // Codice del Terzo Settore — D.Lgs. 117/2017
  'cod. terzo settore':    'codice_terzo_settore',
  'codice terzo settore':  'codice_terzo_settore',
  'cts':                   'codice_terzo_settore',
  'd.lgs. 117':            'codice_terzo_settore',
  'dlgs 117':              'codice_terzo_settore',
  // Codice della Navigazione — R.D. 327/1942
  'cod. nav.':             'codice_navigazione',
  'codice della navigazione': 'codice_navigazione',
  'codice navigazione':    'codice_navigazione',
  'r.d. 327':              'codice_navigazione',
  'rd 327':                'codice_navigazione',
  // Codice delle Comunicazioni Elettroniche — D.Lgs. 259/2003
  'cod. com. el.':         'codice_comunicazioni',
  'codice comunicazioni elettroniche': 'codice_comunicazioni',
  'codice comunicazioni':  'codice_comunicazioni',
  'd.lgs. 259':            'codice_comunicazioni',
  'dlgs 259':              'codice_comunicazioni',
  // Testo Unico Stupefacenti — D.P.R. 309/1990
  't.u. stup.':            'tu_stupefacenti',
  'tu stupefacenti':       'tu_stupefacenti',
  'testo unico stupefacenti': 'tu_stupefacenti',
  'd.p.r. 309':            'tu_stupefacenti',
  'dpr 309':               'tu_stupefacenti',
  'd.p.r. 309/90':         'tu_stupefacenti',
  // Testo Unico Immigrazione — D.Lgs. 286/1998
  't.u. imm.':             'tu_immigrazione',
  'tu immigrazione':       'tu_immigrazione',
  'testo unico immigrazione': 'tu_immigrazione',
  'd.lgs. 286':            'tu_immigrazione',
  'dlgs 286':              'tu_immigrazione',
  // Codice di Giustizia Contabile — D.Lgs. 174/2016
  'cod. giust. cont.':          'giustizia_contabile',
  'codice di giustizia contabile': 'giustizia_contabile',
  'codice giustizia contabile': 'giustizia_contabile',
  'cgc':                        'giustizia_contabile',
  'd.lgs. 174':                 'giustizia_contabile',
  'dlgs 174':                   'giustizia_contabile',
  // Ordinamento Penitenziario — L. 354/1975
  'ord. pen.':             'ordinamento_penitenziario',
  'ordinamento penitenziario': 'ordinamento_penitenziario',
  'l. 354':                'ordinamento_penitenziario',
  'legge 354':             'ordinamento_penitenziario',
};

// Regex per il numero di articolo (inclusi bis/ter/quater/.../decies)
const RE_NUMERO = /(\d+(?:-(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)/i;

// ── Normalizza la stringa per il lookup delle abbreviazioni ───────────────────
function normStr(s) {
  return s.toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[àáâã]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõ]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .trim();
}

/**
 * parseNormaQuery(query)
 * Estrae { numero, codice_id, raw_numero, raw_codice } dalla stringa libera.
 * Ritorna { numero: null, codice_id: null } se non riesce.
 */
function parseNormaQuery(query) {
  const q = normStr(query);

  // Rimuovi "art." / "artt." / "articolo" / "articoli" in testa
  const qClean = q
    .replace(/^artt?\.?\s*/i, '')
    .replace(/^articol[oi]\s+/i, '')
    .trim();

  // Estrai numero
  const numMatch = qClean.match(RE_NUMERO);
  if (!numMatch) return { numero: null, codice_id: null };
  const numero = numMatch[1];

  // Rimuovi il numero dalla stringa per isolare il codice
  const senzaNumero = qClean.replace(numMatch[0], '').trim().replace(/^[,\s]+/, '').trim();

  // Cerca il codice nel mapping (dal più lungo al più corto per evitare match parziali)
  const chiavi = Object.keys(ABBR_TO_CODICE).sort((a, b) => b.length - a.length);
  for (const k of chiavi) {
    if (senzaNumero.includes(normStr(k)) || normStr(k) === senzaNumero) {
      return { numero, codice_id: ABBR_TO_CODICE[k], raw_codice: k };
    }
  }

  // Fallback: prova a riconoscere "codice della strada", "d.p.r. 309", ecc.
  // come norma "non in DB" — ritorna solo il numero, codice_id null
  return { numero, codice_id: null, raw_senza_numero: senzaNumero };
}

/**
 * cercaInDB(codice_id, numero)
 * Cerca exact match, poi LIKE fallback.
 * Ritorna la riga o null.
 */
function cercaInDB(codice_id, numero) {
  let db;
  try {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma('journal_mode = WAL');

    // Exact match
    let row = db.prepare(
      'SELECT codice_id, numero, titolo, testo FROM articoli_codice WHERE codice_id = ? AND numero = ? LIMIT 1'
    ).get(codice_id, numero);
    if (row) return row;

    // LIKE fallback (es. "131 bis" → "131-bis" o varianti)
    const numLike = '%' + numero.replace(/-/g, '%') + '%';
    row = db.prepare(
      'SELECT codice_id, numero, titolo, testo FROM articoli_codice WHERE codice_id = ? AND numero LIKE ? LIMIT 1'
    ).get(codice_id, numLike);
    return row || null;
  } catch(e) {
    return null;
  } finally {
    if (db) try { db.close(); } catch(_) {}
  }
}

/**
 * resolveNorma(query)  →  Promise<{ trovata, fonte, codice, articolo, rubrica, testo, stats, link? }>
 *
 * trovata: true | false
 * fonte:   'db_locale' | 'normattiva' | 'normattiva_link' | 'non_trovata'
 */
async function resolveNorma(query) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return { trovata: false, fonte: 'non_trovata', nota: 'Query vuota.' };
  }

  // ── Step A: parsing ───────────────────────────────────────────────────────
  const parsed = parseNormaQuery(query.trim());

  // ── Step B: DB locale ─────────────────────────────────────────────────────
  if (parsed.codice_id && parsed.numero) {
    const row = cercaInDB(parsed.codice_id, parsed.numero);
    if (row) {
      return {
        trovata:  true,
        fonte:    'db_locale',
        codice:   row.codice_id,
        articolo: row.numero,
        rubrica:  row.titolo  || null,
        testo:    row.testo   || null,
        stats:    null,
      };
    }
  }

  // ── Step C: Normattiva (API esterna) ──────────────────────────────────────
  try {
    const { getNormattiva } = require('./normattiva');
    const result = await getNormattiva(query.trim());

    if (result.ok && !result.metadatiOnly && result.articoloHtml) {
      // Testo HTML → estrai plain text rudimentale
      const plain = result.articoloHtml
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&agrave;/gi, 'à').replace(/&egrave;/gi, 'è')
        .replace(/&igrave;/gi, 'ì').replace(/&ograve;/gi, 'ò')
        .replace(/&ugrave;/gi, 'ù').replace(/&Agrave;/g, 'À')
        .replace(/&Egrave;/g, 'È').replace(/&Igrave;/g, 'Ì')
        .replace(/&Ograve;/g, 'Ò').replace(/&Ugrave;/g, 'Ù')
        .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      return {
        trovata:  true,
        fonte:    'normattiva',
        codice:   parsed.codice_id || null,
        articolo: parsed.numero    || null,
        rubrica:  result.titolo    || null,
        testo:    plain            || null,
        inVigore: result.inVigore  ?? null,
        stats:    null,
        urn:      result.urn       || null,
      };
    }

    // Metadati only (c.p., c.c., c.p.c. — regio.decreto): restituisce link
    if (result.ok && result.metadatiOnly) {
      return {
        trovata:  true,
        fonte:    'normattiva_link',
        codice:   parsed.codice_id || null,
        articolo: parsed.numero    || null,
        rubrica:  null,
        testo:    null,
        stats:    null,
        nota:     'Testo non disponibile via API (codice storico). Consulta il link.',
        link:     result.linkNormattiva || null,
        urn:      result.urn            || null,
      };
    }
  } catch(e) {
    // Normattiva non raggiungibile — continua verso step D
  }

  // ── Step D: non trovata ───────────────────────────────────────────────────
  return {
    trovata: false,
    fonte:   'non_trovata',
    codice:  parsed.codice_id || null,
    articolo: parsed.numero   || null,
    nota:    'Norma non disponibile nel database. Inserire il testo manualmente.',
  };
}

module.exports = { resolveNorma, parseNormaQuery };
