'use strict';
/**
 * services/scalata-v2.js
 * Helper DETERMINISTICI (zero AI) per la Scalata v2.
 *  - estraiNorme: estrae i riferimenti ad articoli di codice dal testo e li risolve
 *    contro giuridica.db (sola lettura). Riferimenti non risolvibili → testo senza link.
 *  - terminiChiave: estrae i termini chiave del titolo per la ricerca FTS in giurisprudenza.
 */

// "art. 2043 c.c." | "art. 131-bis c.p." | "articolo 5 cost." | "artt. 1453 c.c."
// Cattura il numero + i token successivi (senza attraversare newline; possono contenere punti/slash).
const RE_ART = /\bart(?:icol[oi]|t)?\.?[ \t]*(\d+(?:-(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)((?:[ \t]+[a-zàèéìòù0-9.\/]{1,22}){1,4})/gi;
// Indizio che la coda dopo "art. N" contiene davvero un riferimento a codice/legge (non testo qualsiasi)
const RE_INDIZIO_CODICE = /(\bc\.|\bcod|\bcost|\blegge|\bl\.\s?\d|d\.?\s?lgs|d\.?\s?l\.|d\.?\s?p\.?r|\bt\.?u|carta cost)/i;

// Atti normativi interi: "d.lgs 231/2001", "l. 241/1990", "d.l. 34/2020", "d.p.r. 309/90"
const RE_ATTO = /\b(d\.?\s?lgs\.?|d\.?\s?l\.?(?!gs)|d\.?\s?p\.?r\.?|legge|l\.)\s*n?\.?\s*(\d{1,4})\s*\/\s*(\d{2,4})/gi;

const STOPWORD = new Set((
  // Funzionali / congiunzioni / temporali
  'della delle degli dello dei del con per tra fra una uno gli che chi cui non piu sul sulla sulle dai dal dalla nel nella nelle come sono stato stata essere anche dopo prima quando dove perche ecco oggi ieri questo questa questi queste anni anno mesi giorni secondo contro verso circa ogni tutti tutte molto senza sotto sopra mentre durante invece pero quindi allora davvero subito proprio ancora sempre presso oltre entro'
  // Lessico giudiziario troppo generico per la ricerca FTS (matcha quasi tutto il corpus)
  + ' corte suprema sezioni unite giudice giudici sentenza sentenze ordinanza cassazione tribunale'
  // Parole generiche di cronaca / non giuridiche (evitano che la scalata si arrampichi su notizie non giuridiche)
  + ' possibile studio caso casi storia mondo momento punto parte modo cosa cose volta tempo vita giorno settimana persona persone gente uomo donna ragazzo ragazza bambino bambini famiglia lavoro scuola citta paese comune strada notte sera mattina video foto social grande grandi nuovo nuova nuovi nuove primo prima ultimo ultima ultimi ultime grazie contro dopo intanto ormai infatti inoltre insomma comunque'
).split(/\s+/));

/**
 * estraiNorme(testo, dbBB, parseNormaQuery)
 *  testo: titolo + corpo della notizia
 *  dbBB: connessione better-sqlite3 readonly a giuridica.db (getCodiciBB)
 *  parseNormaQuery: funzione da services/norma-resolver.js
 * Ritorna: [{ ref, codice_id?, numero?, titolo?, risolto:bool }]
 */
function estraiNorme(testo, dbBB, parseNormaQuery) {
  const out = [];
  const seen = new Set();
  if (!testo) return out;

  // 1) Articoli di codice → risolvibili a un articolo specifico
  RE_ART.lastIndex = 0;
  let m;
  while ((m = RE_ART.exec(testo)) !== null && out.length < 12) {
    const ref = m[0].replace(/\s+/g, ' ').trim();
    const candidate = (m[1] + ' ' + (m[2] || '')).trim();
    let parsed = null;
    try { parsed = parseNormaQuery(candidate); } catch (e) { parsed = null; }
    if (!parsed || !parsed.numero) continue;

    let risolto = null;
    if (parsed.codice_id && dbBB) {
      try {
        risolto = dbBB.prepare('SELECT codice_id, numero, titolo FROM articoli_codice WHERE codice_id=? AND numero=? LIMIT 1').get(parsed.codice_id, parsed.numero);
        if (!risolto) {
          const numLike = '%' + String(parsed.numero).replace(/-/g, '%') + '%';
          risolto = dbBB.prepare('SELECT codice_id, numero, titolo FROM articoli_codice WHERE codice_id=? AND numero LIKE ? LIMIT 1').get(parsed.codice_id, numLike);
        }
      } catch (e) { risolto = null; }
    }

    if (risolto) {
      const key = risolto.codice_id + ':' + risolto.numero;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ref: 'Art. ' + risolto.numero, codice_id: risolto.codice_id, numero: risolto.numero, titolo: risolto.titolo || null, risolto: true });
    } else {
      // Non risolto: mostralo come testo SOLO se la coda contiene un vero indizio di codice/legge
      // (evita di catturare "art. N" a fine frase seguito da testo qualsiasi).
      if (!RE_INDIZIO_CODICE.test(m[2] || '')) continue;
      const refPulito = ('art. ' + parsed.numero + ' ' + String(m[2] || '').trim()).replace(/\s+/g, ' ').trim().slice(0, 40);
      const key = 't:' + refPulito.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ref: refPulito, risolto: false });
    }
  }

  // 2) Atti normativi interi (d.lgs/l./d.l./d.p.r. N/ANNO) → mostrati come testo (nessun articolo specifico)
  RE_ATTO.lastIndex = 0;
  while ((m = RE_ATTO.exec(testo)) !== null && out.length < 12) {
    const ref = m[0].replace(/\s+/g, ' ').replace(/\s*\/\s*/, '/').trim();
    const key = 't:' + ref.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ref, risolto: false });
  }

  return out;
}

/**
 * terminiChiave(title) → array di max 5 termini significativi per la ricerca FTS.
 */
function terminiChiave(title) {
  const words = String(title || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // togli accenti per lo stopword-match
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 5 && !STOPWORD.has(w) && !/^\d+$/.test(w));
  const uniq = [];
  for (const w of words) {
    if (!uniq.includes(w)) uniq.push(w);
    if (uniq.length >= 5) break;
  }
  return uniq;
}

module.exports = { estraiNorme, terminiChiave };
