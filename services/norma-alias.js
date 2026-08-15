'use strict';
/**
 * services/norma-alias.js — Espansione alias codici giuridici italiani
 * Permette di cercare "art. 131-bis c.p." trovando anche "art. 131-bis cod. pen.",
 * "art. 131 bis cod.pen.", "art. 131bis cod. pen." ecc.
 */

const ALIAS_MAP = {
  'c.p.':   ['c.p.', 'cod. pen.', 'cod.pen.', 'codice penale'],
  'c.c.':   ['c.c.', 'cod. civ.', 'cod.civ.', 'codice civile'],
  'c.p.c.': ['c.p.c.', 'cod. proc. civ.', 'codice di procedura civile'],
  'c.p.p.': ['c.p.p.', 'cod. proc. pen.', 'codice di procedura penale'],
  'cost.':  ['cost.', 'Cost.', 'costituzione', 'Costituzione'],
};

/**
 * Espande una norma in tutti i suoi alias nel DB.
 * "art. 131-bis c.p." → ["art. 131-bis c.p.", "art. 131-bis cod. pen.",
 *                         "art. 131-bis cod.pen.", "art. 131 bis c.p.", ...]
 */
function espandiAlias(norma) {
  const match = norma.match(/^(art\.?\s*[\d]+(?:[-\s]?bis)?(?:[-\s]?ter)?(?:[-\s]?quater)?)\s+(.+)$/i);
  if (!match) return [norma];

  const prefisso = match[1]; // "art. 131-bis"
  const codice   = match[2].trim(); // "c.p." — NON rimuovere il punto: fa parte dell'abbreviazione

  // Genera varianti del prefisso: trattino, spazio, attaccato
  const num = prefisso.replace(/^art\.?\s*/i, '').trim(); // "131-bis"
  const numVarianti = new Set([
    num,
    num.replace(/-/g, ' '),      // "131 bis"
    num.replace(/[-\s]/g, ''),   // "131bis"
  ]);
  const prefissiVarianti = [...numVarianti].map(v => 'art. ' + v);

  // Trova il gruppo alias per questo codice
  for (const [, aliases] of Object.entries(ALIAS_MAP)) {
    if (aliases.some(a => a.toLowerCase() === codice.toLowerCase())) {
      const risultati = new Set();
      for (const pref of prefissiVarianti) {
        for (const alias of aliases) {
          risultati.add(pref + ' ' + alias);
        }
      }
      return [...risultati];
    }
  }

  return [norma]; // nessun alias trovato
}

/**
 * Clausola WHERE campo IN (?,?,?) con valori esatti — per tabelle indicizzate.
 * Più efficiente di LIKE per ricerche su colonne con indice.
 */
function aliasInClause(norma, campo) {
  const aliases = espandiAlias(norma);
  const ph      = aliases.map(() => '?').join(', ');
  return { clause: `${campo} IN (${ph})`, params: aliases };
}

/**
 * Clausola WHERE campo LIKE ? OR campo LIKE ? — per ricerche parziali.
 */
function aliasLikeClause(norma, campo) {
  const aliases  = espandiAlias(norma);
  const patterns = aliases.map(a => '%' + a + '%');
  const clause   = patterns.map(() => `${campo} LIKE ?`).join(' OR ');
  return { clause: '(' + clause + ')', params: patterns };
}

module.exports = { espandiAlias, aliasInClause, aliasLikeClause, ALIAS_MAP };
