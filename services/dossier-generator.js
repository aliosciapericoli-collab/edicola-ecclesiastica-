'use strict';
/**
 * services/dossier-generator.js — Dossier giuridico con Sonnet
 * Raccoglie contesto esteso dal DB locale (testo norma + sentenze specifiche al caso
 * + contrasti + L5 implicazioni) e genera un dossier strutturato con claude-sonnet.
 */

const path      = require('path');
const Anthropic  = require('@anthropic-ai/sdk');

const { getGrafoContext, normaToDbKey } = require('../scalata-giuridica.js');

// ── Estrai keyword rilevanti dalla domanda ────────────────────────────────────
function estraiKeyword(domanda) {
  const STOP = new Set([
    'il','lo','la','le','gli','un','una','dei','del','della','delle','degli',
    'di','da','in','con','su','per','tra','fra','e','è','a','al','che','ho',
    'mio','mia','suo','voglio','cliente','accusato','accusata','primo','grado',
    'siamo','sono','applicare','vorrei','volevo','caso','miei','suoi',
    'questo','questa','questi','queste','anche','come','quando','dove',
    'articolo','norma','legge','reato',
  ]);
  return domanda.toLowerCase()
    .replace(/[^\wàèéìòùa-z\s]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOP.has(w))
    .slice(0, 6);
}

// ── Estrai frammento rilevante dal testo_integrale quando massima=NULL ────────
function estraiFrammento(dbCass, numero, anno, keywords) {
  try {
    const row = dbCass.prepare(
      'SELECT testo_integrale FROM sentenze WHERE numero=? AND anno=? LIMIT 1'
    ).get(numero, anno);
    if (!row || !row.testo_integrale) return null;

    const testo = row.testo_integrale;

    // Cerca la prima keyword trovata nel testo
    for (const kw of keywords) {
      const idx = testo.toLowerCase().indexOf(kw.toLowerCase());
      if (idx >= 0) {
        const start = Math.max(0, idx - 200);
        const end   = Math.min(testo.length, idx + kw.length + 200);
        return '...' + testo.substring(start, end).replace(/\s+/g, ' ').trim() + '...';
      }
    }

    // Fallback: cerca "131-bis" nel testo (norma generica)
    const normIdx = testo.indexOf('131-bis');
    if (normIdx >= 0) {
      const start = Math.max(0, normIdx - 200);
      const end   = Math.min(testo.length, normIdx + 200);
      return '...' + testo.substring(start, end).replace(/\s+/g, ' ').trim() + '...';
    }

    return null;
  } catch(e) {
    console.warn('[estraiFrammento] errore:', e.message);
    return null;
  }
}

// ── Cerca sentenze con strategia a cascata (oggetto prima, testo dopo) ────────
function cercaSentenze(dbCass, artPat, keywords) {
  const kw = keywords.slice(0, 3); // max 3 per le query veloci

  // STEP 1 — oggetto LIKE '%norma%' AND oggetto LIKE '%keyword%' (veloce)
  if (kw.length > 0) {
    try {
      const kwOggettoClauses = kw.map(() => `oggetto LIKE ?`).join(' OR ');
      const params = kw.map(k => `%${k}%`);
      const rows = dbCass.prepare(`
        SELECT numero, anno, sezione,
               substr(oggetto,1,200) AS oggetto,
               substr(massima,1,300) AS massima,
               0 AS generica
        FROM sentenze
        WHERE (testo_integrale LIKE ? OR oggetto LIKE ?)
          AND (${kwOggettoClauses})
        ORDER BY anno DESC, numero DESC
        LIMIT 5
      `).all(artPat, artPat, ...params);
      if (rows.length >= 2) return rows;
    } catch(e) { console.warn('[dossier] Step1 sentenze:', e.message); }
  }

  // STEP 2 — oggetto con keyword singole più comuni (ancora veloce)
  if (kw.length > 0) {
    try {
      const kwClauses = kw.map(() => `oggetto LIKE ?`).join(' OR ');
      const params = kw.map(k => `%${k}%`);
      const rows = dbCass.prepare(`
        SELECT numero, anno, sezione,
               substr(oggetto,1,200) AS oggetto,
               substr(massima,1,300) AS massima,
               0 AS generica
        FROM sentenze
        WHERE (${kwClauses})
          AND (testo_integrale LIKE ? OR oggetto LIKE ?)
        ORDER BY anno DESC, numero DESC
        LIMIT 5
      `).all(...params, artPat, artPat);
      if (rows.length >= 2) return rows;
    } catch(e) { console.warn('[dossier] Step2 sentenze:', e.message); }
  }

  // STEP 3 — testo_integrale LIKE norma AND LIKE keyword (più lento ma preciso)
  // Ordina per numero di keyword presenti nel testo (rilevanza), poi anno DESC
  if (kw.length > 0) {
    try {
      const kwClauses = kw.map(() => `(CASE WHEN testo_integrale LIKE ? THEN 1 ELSE 0 END)`).join(' + ');
      const kwParams  = kw.map(k => `%${k}%`);
      const atLeastOne = kw.map(() => `testo_integrale LIKE ?`).join(' OR ');
      const rows = dbCass.prepare(`
        SELECT numero, anno, sezione,
               substr(oggetto,1,200) AS oggetto,
               substr(massima,1,300) AS massima,
               0 AS generica,
               (${kwClauses}) AS score
        FROM sentenze
        WHERE testo_integrale LIKE ?
          AND (${atLeastOne})
        ORDER BY score DESC, anno DESC
        LIMIT 5
      `).all(...kwParams, artPat, ...kwParams);
      if (rows.length >= 2) return rows;
    } catch(e) { console.warn('[dossier] Step3 sentenze:', e.message); }
  }

  // STEP 4 — fallback: 5 più recenti sulla norma (generiche)
  try {
    const rows = dbCass.prepare(`
      SELECT numero, anno, sezione,
             substr(oggetto,1,200) AS oggetto,
             substr(massima,1,300) AS massima,
             1 AS generica
      FROM sentenze
      WHERE testo_integrale LIKE ?
      ORDER BY anno DESC, numero DESC
      LIMIT 5
    `).all(artPat);
    return rows;
  } catch(e) { console.warn('[dossier] Step4 fallback sentenze:', e.message); }

  return [];
}

// ── Verifica post-generazione: controlla le sentenze citate nel testo ─────────
function verificaSentenzeCitate(testoGenerato, domanda, dbCass, keywords) {
  const RE_SENT = /(?:Cass\.?|Cassazione)\s*(?:(?:Sez(?:ione)?\.?\s*)?(?:\w+\.?\s*){0,3})?n\.?\s*(\d{3,6})[\s/\\](\d{4})/gi;
  const trovate = new Set();
  let m;
  while ((m = RE_SENT.exec(testoGenerato)) !== null) {
    trovate.add(`${m[1]}|${m[2]}`);
  }

  const risultati = [];
  let inventate = 0;
  let nonPertinenti = 0;

  // ── Mappa frammenti: numero|anno → testo frammento dal DB (usato nel secondo passaggio) ──
  const frammentoMap = {};

  for (const key of trovate) {
    const [num, ann] = key.split('|');
    try {
      const row = dbCass.prepare(
        'SELECT id, numero, anno, sezione, substr(oggetto,1,150) AS oggetto, substr(testo_integrale,1,2000) AS frammento FROM sentenze WHERE numero=? AND anno=?'
      ).get(Number(num), Number(ann));

      if (!row) {
        risultati.push({ numero: num, anno: ann, trovata: false, pertinente: false, oggetto: null });
        inventate++;
      } else {
        // Pertinente se l'oggetto o l'inizio testo contengono almeno una keyword del caso
        const haystack = ((row.oggetto||'') + ' ' + (row.frammento||'')).toLowerCase();
        const kw = keywords.slice(0, 5);
        const pertinente = kw.length === 0 || kw.some(k => haystack.includes(k));
        if (!pertinente) nonPertinenti++;

        // ── Verifica sopravvivenza: cerca contrasti aperti in giuridica.db ──────
        let sopravvivenza = null;
        if (row.id) {
          try {
            const Database = require('better-sqlite3');
            const dbGiur = new Database(
              path.join(__dirname, '..', 'data', 'giuridica.db'),
              { readonly: true }
            );
            const contrasti = dbGiur.prepare(
              "SELECT sentenza_b, norma_comune FROM relazioni_sentenze WHERE sentenza_a = ? AND tipo = 'contrasto_aperto' LIMIT 3"
            ).all(row.id);
            dbGiur.close();
            if (contrasti.length > 0) {
              sopravvivenza = 'CONTRASTO APERTO con ' + contrasti.map(c => c.sentenza_b).join(', ');
              console.log(`[dossier] sopravvivenza: ${row.id} → ${sopravvivenza}`);
            }
          } catch(eContrasto) {
            console.warn('[dossier] lookup contrasti fallito per', row.id, ':', eContrasto.message);
          }
        }

        risultati.push({
          numero: num, anno: ann,
          trovata: true, pertinente,
          sezione: row.sezione || '',
          oggetto: row.oggetto || '',
          ...(sopravvivenza ? { sopravvivenza } : {}),
        });
        frammentoMap[key] = (row.frammento || '').toLowerCase();
      }
    } catch(e) {
      risultati.push({ numero: num, anno: ann, trovata: false, pertinente: false, oggetto: null });
      inventate++;
    }
  }

  // ── Secondo passaggio: verifica citazioni normative per sentenza ───────────
  const RE_NORMA = /(?:d\.lgs\.?|d\.l\.?|legge|decreto|riforma)\s*(?:n\.?\s*)?(\d+[\s/]\d{4}|\d+\/\d{4}|del\s+\d{4})/gi;

  // Suddivide il dossier in blocchi per sentenza:
  // ogni blocco inizia alla riga che cita "Cass... n.NUMERO/ANNO" e termina
  // alla riga successiva con "Cass..." oppure a una riga "## "
  const citazioniNonVerificate = [];

  for (const key of Object.keys(frammentoMap)) {
    const [num, ann] = key.split('|');
    const frammento = frammentoMap[key]; // già lowercase

    // Regex per isolare il blocco del dossier relativo a questa sentenza
    const RE_BLOCCO = new RegExp(
      `(?:Cass\\.?|Cassazione)[^\\n]*?n\\.?\\s*${num}[\\s/\\\\]${ann}[\\s\\S]*?(?=(?:Cass\\.?|Cassazione)[^\\n]*?n\\.?\\s*\\d{3,6}[\\s/\\\\]\\d{4}|^##\\s|$)`,
      'im'
    );
    const matchBlocco = testoGenerato.match(RE_BLOCCO);
    if (!matchBlocco) continue;

    const bloccoDossier = matchBlocco[0];

    // Cerca riferimenti normativi nel blocco del dossier
    RE_NORMA.lastIndex = 0;
    let mNorma;
    while ((mNorma = RE_NORMA.exec(bloccoDossier)) !== null) {
      const citazioneCompleta = mNorma[0].trim();
      const citazioneLower = citazioneCompleta.toLowerCase();

      // Verifica se la citazione è presente nel frammento della sentenza
      if (!frammento.includes(citazioneLower)) {
        // Evita duplicati per la stessa coppia sentenza+citazione
        const giàPresente = citazioniNonVerificate.some(
          c => c.sentenza === `${num}/${ann}` && c.citazione.toLowerCase() === citazioneLower
        );
        if (!giàPresente) {
          citazioniNonVerificate.push({
            sentenza: `${num}/${ann}`,
            citazione: citazioneCompleta,
            presente_nel_frammento: false,
          });
        }
      }
    }
  }

  const sentenzeCon = risultati.filter(r => r.sopravvivenza);
  return {
    sentenze_citate: risultati,
    sentenze_inventate: inventate,
    sentenze_non_pertinenti: nonPertinenti,
    sentenze_totali_citate: risultati.length,
    citazioni_non_verificate: citazioniNonVerificate,
    sentenze_con_contrasto: sentenzeCon,
  };
}

// ── Auto-espansione ibrida delle norme ───────────────────────────────────────
// Livello 1: co-citazioni da relazioni_norme (grafo), filtrate per keyword del caso
// Livello 2: COUNT diretta su cassazione.db per lista candidati CP patrimonio
// Ritorna: array norme originali + espanse, max 5 totali, deduplicate
// ── Calcola probabilità storica di successo di un istituto processuale ────────
// Fonte: scalata_l1 (norma citata) + scalata_l2 (sintesi con esito)
// Tutto sincrono — better-sqlite3.
function calcolaProbabilita(norma, dbCass) {
  if (!dbCass || !norma) return null;
  try {
    const normaTrim = norma.trim();
    // Estrai la parte identificativa della norma per il LIKE (es. "131-bis", "162-ter")
    const pat = `%${normaTrim}%`;

    // Conta accolte: scalata_l1 contiene la norma E scalata_l2 segnala accoglimento
    const accolto = dbCass.prepare(`
      SELECT COUNT(*) AS c FROM sentenze
      WHERE scalata_l1 LIKE ?
        AND (scalata_l2 LIKE '%accogli%' OR scalata_l2 LIKE '%annulla%' OR scalata_l2 LIKE '%non punibilit%')
    `).get(pat)?.c || 0;

    // Conta rigettate: scalata_l1 contiene la norma E scalata_l2 segnala rigetto
    const rigettato = dbCass.prepare(`
      SELECT COUNT(*) AS c FROM sentenze
      WHERE scalata_l1 LIKE ?
        AND (scalata_l2 LIKE '%rigett%' OR scalata_l2 LIKE '%inammissibil%' OR scalata_l2 LIKE '%infondato%')
    `).get(pat)?.c || 0;

    const totale = accolto + rigettato;

    if (totale < 10) {
      return { campione_insufficiente: true, totale, accolto, rigettato };
    }

    const probabilita = Math.round((accolto / totale) * 100);
    return { campione_insufficiente: false, probabilita, accolto, rigettato, totale };
  } catch(e) {
    console.warn('[dossier] calcolaProbabilita errore per', norma, ':', e.message);
    return null;
  }
}

async function espandiNorme(normeInput, domanda, keywords, dbCass) {
  const Database = require('better-sqlite3');

  // Norme di rumore noto da escludere se il topic è penale-patrimonio
  const RUMORE_PENALE = [
    'cost.', '309/1990', 'd.lgs. 74', 'codice della strada',
    'd.lgs. 285', 'art. 385', 'art. 459', 'art. 494', 'art. 5 c.p.',
    'c.p.p.', 'codice di procedura',
  ];

  // Segnali che indicano topic penale-patrimonio nella domanda
  const SEGNALI_PATRIMONIO = [
    'furto', 'supermerc', 'aliment', 'aggravant', 'tenu', 'commisur',
    'rapina', 'ricettaz', 'appropriaz', 'sottra',
  ];

  const topicPatrimonio = keywords.some(k =>
    SEGNALI_PATRIMONIO.some(s => k.includes(s))
  );

  // Lista candidati CP patrimonio per il Livello 2 (hardcoded, stabile)
  const CANDIDATI_CP = [
    { norma: 'art. 624 c.p.',     pat: '%art.%624%'    },
    { norma: 'art. 625 c.p.',     pat: '%625%'         },
    { norma: 'art. 56 c.p.',      pat: '%art.%56 c.p%' },
    { norma: 'art. 62 c.p.',      pat: '%art.%62%'     },
    { norma: 'art. 133 c.p.',     pat: '%133%'         },
    { norma: 'art. 624-bis c.p.', pat: '%624-bis%'     },
  ];

  let candidatiGrafo = [];
  let candidatiL2    = [];

  // ── Livello 1: grafo (relazioni_norme) ────────────────────────────────────
  let db = null;
  try {
    db = new Database(path.join(__dirname, '..', 'data', 'giuridica.db'), { readonly: true });

    for (const normaRaw of normeInput) {
      const norma = typeof normaRaw === 'object' ? (normaRaw.norma || '') : String(normaRaw);
      if (!norma) continue;
      const parsed = normaToDbKey(norma);
      // Pattern LIKE sul numero articolo (es. %131-bis%) — abbastanza specifico
      const numPat = parsed ? `%${parsed.numero}%` : `%${norma}%`;

      try {
        const rows = db.prepare(`
          SELECT
            CASE WHEN norma_a LIKE ? THEN norma_b ELSE norma_a END AS collegata,
            COUNT(*) AS cnt
          FROM relazioni_norme
          WHERE (norma_a LIKE ? OR norma_b LIKE ?)
            AND NOT (norma_a LIKE ? AND norma_b LIKE ?)
            AND tipo = 'co_citazione_sent'
          GROUP BY collegata
          ORDER BY cnt DESC
          LIMIT 15
        `).all(numPat, numPat, numPat, numPat, numPat);

        for (const r of rows) {
          candidatiGrafo.push({ norma: r.collegata, cnt: r.cnt });
        }
      } catch(e) { console.warn('[dossier] espandiNorme L1 errore per ' + norma + ':', e.message); }
    }

    // Filtro anti-rumore se topic patrimonio rilevato
    if (topicPatrimonio) {
      candidatiGrafo = candidatiGrafo.filter(c =>
        !RUMORE_PENALE.some(r => c.norma.toLowerCase().includes(r))
      );
    }
  } catch(e) {
    console.warn('[dossier] espandiNorme giuridica.db non disponibile:', e.message);
  } finally {
    try { if (db) db.close(); } catch(e) {}
  }

  // ── Livello 2: cassazione.db COUNT diretta ────────────────────────────────
  if (dbCass) {
    // Filtra candidati già passati dall'avvocato
    const candidatiAttivi = CANDIDATI_CP.filter(c =>
      !normeInput.some(n => {
        const nStr = typeof n === 'object' ? (n.norma || '') : String(n);
        const parsed = normaToDbKey(c.norma);
        return parsed && nStr.includes(parsed.numero);
      })
    );

    for (const normaRaw of normeInput) {
      const norma = typeof normaRaw === 'object' ? (normaRaw.norma || '') : String(normaRaw);
      if (!norma) continue;
      const parsed = normaToDbKey(norma);
      const artPatBase = parsed ? `%art.%${parsed.numero}%` : `%${norma}%`;

      for (const candidato of candidatiAttivi) {
        try {
          const row = dbCass.prepare(
            'SELECT COUNT(*) AS cnt FROM sentenze WHERE testo_integrale LIKE ? AND testo_integrale LIKE ?'
          ).get(artPatBase, candidato.pat);
          const cnt = row ? row.cnt : 0;
          if (cnt >= 50) {
            // Aggiorna se già presente, altrimenti aggiungi
            const esistente = candidatiL2.find(c => c.norma === candidato.norma);
            if (esistente) {
              esistente.cnt = Math.max(esistente.cnt, cnt);
            } else {
              candidatiL2.push({ norma: candidato.norma, cnt });
            }
          }
        } catch(e) { console.warn('[dossier] espandiNorme L2 errore per ' + candidato.norma + ':', e.message); }
      }
    }

    // Ordina per cnt DESC (più co-citate prima)
    candidatiL2.sort((a, b) => b.cnt - a.cnt);
  }

  // ── Fusione e deduplicazione (L2 prioritario su L1) ───────────────────────
  const normeEspanse = normeInput.map(n => typeof n === 'object' ? (n.norma || '') : String(n)).filter(Boolean);
  const viste = new Set(normeEspanse.map(n => n.toLowerCase()));

  for (const c of [...candidatiL2, ...candidatiGrafo]) {
    if (normeEspanse.length >= 5) break;
    const key = c.norma.toLowerCase();
    if (!viste.has(key)) {
      normeEspanse.push(c.norma);
      viste.add(key);
    }
  }

  console.log('[dossier] norme espanse:', normeEspanse.join(' | '));
  return normeEspanse;
}

// ── Raccolta contesto esteso (max 6.000 chars) ────────────────────────────────
async function raccogliContesto(domanda, norme, dbCass, keywordsEsterne) {
  const Database = require('better-sqlite3');
  let db = null;

  try {
    db = new Database(path.join(__dirname, '..', 'data', 'giuridica.db'), { readonly: true });
  } catch(e) {
    console.warn('[dossier] apertura giuridica.db fallita:', e.message);
    return '';
  }

  // Raccolte separate per ordine di priorità: B→C→D→A
  const blocchiE = []; // sentenze multi-norma (AND tra ≥2 norme) — MASSIMA PRIORITÀ
  const blocchiB = []; // sentenze specifiche al caso   — PRIORITARIE
  const blocchiC = []; // contrasti aperti
  const blocchiD = []; // notizie + l5_implicazioni
  const blocchiA = []; // getGrafoContext (generiche)   — ULTIME

  // Usa keywords passate dall'esterno (già estratte in generaDossier) o riestraifile
  const keywords = (keywordsEsterne && keywordsEsterne.length > 0)
    ? keywordsEsterne
    : estraiKeyword(domanda);
  console.log('[dossier] keywords estratte:', keywords);

  // ── E) Sentenze multi-norma: AND tra ogni coppia (e tripletta) di norme ──────
  // Queste sono le sentenze più preziose: citano simultaneamente ≥2 norme del caso.
  // Esempio: 131-bis AND 624 → 1.026 sentenze; 131-bis AND 62 → 1.577 sentenze.
  if (dbCass && norme.length >= 2) {
    // Costruisci i pattern LIKE per ogni norma — stessa logica del blocco B
    const artPatterns = norme.map(normaRaw => {
      const norma = typeof normaRaw === 'object' ? (normaRaw.norma || '') : String(normaRaw);
      if (!norma) return null;
      const parsed = normaToDbKey(norma);
      return { norma, pat: parsed ? `%art.%${parsed.numero}%` : `%${norma}%` };
    }).filter(Boolean);

    // Query helper: SELECT sentenze che matchano tutti i pattern forniti
    const queryMultiNorma = (patterns, limit) => {
      if (patterns.length < 2) return [];
      const whereClauses = patterns.map(() => 'testo_integrale LIKE ?').join(' AND ');
      const params = patterns.map(p => p.pat);
      return dbCass.prepare(`
        SELECT numero, anno, sezione,
               substr(oggetto,1,200) AS oggetto,
               substr(massima,1,300) AS massima,
               0 AS generica
        FROM sentenze
        WHERE ${whereClauses}
        ORDER BY anno DESC
        LIMIT ${limit}
      `).all(...params);
    };

    // Coppie C(n,2)
    for (let i = 0; i < artPatterns.length - 1; i++) {
      for (let j = i + 1; j < artPatterns.length; j++) {
        const pa = artPatterns[i];
        const pb = artPatterns[j];
        try {
          const rows = queryMultiNorma([pa, pb], 3);
          if (rows.length > 0) {
            const label = `[SENTENZE MULTI-NORMA: ${pa.norma} ∩ ${pb.norma} (citano entrambe)]`;
            const lines = [label];
            for (const r of rows) {
              let line = `• Cass. ${r.sezione||''} n.${r.numero}/${r.anno}`;
              if (r.oggetto) line += ` — ${r.oggetto}`;
              if (r.massima) {
                line += `\n  Massima: ${r.massima}`;
              } else {
                const fr = estraiFrammento(dbCass, r.numero, r.anno, keywords);
                if (fr) line += `\n  Frammento: ${fr.substring(0, 400)}`;
              }
              lines.push(line);
            }
            blocchiE.push(lines.join('\n'));
          }
        } catch(e) { console.warn(`[dossier] Blocco E coppia ${pa.norma}+${pb.norma}:`, e.message); }
      }
    }

    // Tripletta con le prime 3 norme (se presenti)
    if (artPatterns.length >= 3) {
      const tripl = artPatterns.slice(0, 3);
      try {
        const rows = queryMultiNorma(tripl, 2);
        if (rows.length > 0) {
          const label = `[SENTENZE MULTI-NORMA: ${tripl.map(p => p.norma).join(' ∩ ')} (citano tutte e tre)]`;
          const lines = [label];
          for (const r of rows) {
            let line = `• Cass. ${r.sezione||''} n.${r.numero}/${r.anno}`;
            if (r.oggetto) line += ` — ${r.oggetto}`;
            if (r.massima) {
              line += `\n  Massima: ${r.massima}`;
            } else {
              const fr = estraiFrammento(dbCass, r.numero, r.anno, keywords);
              if (fr) line += `\n  Frammento: ${fr.substring(0, 400)}`;
            }
            lines.push(line);
          }
          blocchiE.push(lines.join('\n'));
        }
      } catch(e) { console.warn(`[dossier] Blocco E tripletta:`, e.message); }
    }
  }

  for (const normaRaw of norme) {
    const norma = typeof normaRaw === 'object' ? (normaRaw.norma || '') : String(normaRaw);
    if (!norma) continue;

    // ── A) getGrafoContext standard (stats + testo + notizie + 3 sentenze) ───
    try {
      const grafo = getGrafoContext([norma], db);
      if (grafo) blocchiA.push(grafo);
    } catch(e) { console.warn('[dossier] getGrafoContext errore:', e.message); }

    // ── B) Sentenze specifiche al caso — strategia a cascata ─────────────────
    if (dbCass) {
      try {
        const parsed = normaToDbKey(norma);
        const artPat = parsed ? `%art.%${parsed.numero}%` : `%${norma}%`;

        let rows = cercaSentenze(dbCass, artPat, keywords);

        // ── B2) Filtro imbuto: se tutte le righe sono generiche e keywords >= 2,
        //        tenta query mirata su oggetto+massima per fattispecie simile ────
        const tutteGeneriche = rows.length > 0 && rows.every(r => r.generica);
        if ((tutteGeneriche || rows.length === 0) && keywords.length >= 2) {
          try {
            const kwImbuto = keywords.slice(0, 5); // max 5 keywords
            const keywordClauses = kwImbuto.map(() => '(s.oggetto LIKE ? OR s.massima LIKE ?)').join(' OR ');
            const keywordParams  = kwImbuto.flatMap(k => [`%${k}%`, `%${k}%`]);
            const rowsImbuto = dbCass.prepare(`
              SELECT s.numero, s.anno, s.sezione,
                     substr(s.oggetto,1,200) AS oggetto,
                     substr(s.massima,1,300) AS massima,
                     0 AS generica
              FROM sentenze s
              WHERE (s.testo_integrale LIKE ? OR s.oggetto LIKE ?)
                AND (${keywordClauses})
              ORDER BY s.anno DESC, s.numero DESC
              LIMIT 6
            `).all(artPat, artPat, ...keywordParams);

            if (rowsImbuto.length > 0) {
              // Marca le keywords che matchano per ciascuna sentenza
              const kwMatchate = kwImbuto.filter(k =>
                rowsImbuto.some(r =>
                  (r.oggetto && r.oggetto.toLowerCase().includes(k.toLowerCase())) ||
                  (r.massima && r.massima.toLowerCase().includes(k.toLowerCase()))
                )
              );
              const labelImbuto = `[PERTINENZA ALTA — ${norma} + fattispecie (matcha: ${kwMatchate.slice(0,4).join(', ')})]`;
              const linesImbuto = [labelImbuto];
              for (const r of rowsImbuto) {
                let line = `• Cass. ${r.sezione||''} n.${r.numero}/${r.anno}`;
                if (r.oggetto) line += ` — ${r.oggetto}`;
                if (r.massima) {
                  line += `\n  Massima: ${r.massima}`;
                } else {
                  const fr = estraiFrammento(dbCass, r.numero, r.anno, keywords);
                  if (fr) line += `\n  Frammento: ${fr.substring(0, 400)}`;
                }
                linesImbuto.push(line);
              }
              blocchiB.push(linesImbuto.join('\n'));
              console.log(`[dossier] Blocco B2 imbuto per ${norma}: ${rowsImbuto.length} sentenze (kw: ${kwMatchate.join(', ')})`);
              // Salta il blocco B standard se B2 ha trovato risultati pertinenti
              rows = [];
            }
          } catch(e2) { console.warn('[dossier] Blocco B2 imbuto errore per ' + norma + ':', e2.message); }
        }

        if (rows.length > 0) {
          const anyGenerica = rows.some(r => r.generica);
          const label = anyGenerica
            ? `[SENTENZE RECENTI: ${norma} (generiche — caso non trovato nel DB)]`
            : `[SENTENZE SPECIFICHE: ${norma} + caso (keyword: ${keywords.slice(0,3).join(', ')})]`;
          const lines = [label];
          for (const r of rows) {
            let line = `• Cass. ${r.sezione||''} n.${r.numero}/${r.anno}`;
            if (r.oggetto) line += ` — ${r.oggetto}`;
            if (r.massima) {
              line += `\n  Massima: ${r.massima}`;
            } else {
              const fr = estraiFrammento(dbCass, r.numero, r.anno, keywords);
              if (fr) line += `\n  Frammento: ${fr.substring(0, 400)}`;
            }
            lines.push(line);
          }
          blocchiB.push(lines.join('\n'));
        }
      } catch(e) { console.warn('[dossier] Blocco B errore per ' + norma + ':', e.message); }
    }

    // ── C) Contrasti aperti sulla norma ──────────────────────────────────────
    try {
      const contrasti = db.prepare(`
        SELECT sentenza_a, sentenza_b, norma_comune
        FROM relazioni_sentenze
        WHERE tipo='contrasto_aperto'
          AND norma_comune LIKE ?
        LIMIT 5
      `).all(`%${norma.replace('art. ', '')}%`);

      if (contrasti.length > 0 && dbCass) {
        const lines = [`[CONTRASTI APERTI SU ${norma}: ${contrasti.length}]`];
        for (const c of contrasti) {
          try {
            const sa = dbCass.prepare('SELECT numero, anno, sezione, substr(oggetto,1,150) AS oggetto FROM sentenze WHERE id=?').get(c.sentenza_a);
            const sb = dbCass.prepare('SELECT numero, anno, sezione, substr(oggetto,1,150) AS oggetto FROM sentenze WHERE id=?').get(c.sentenza_b);
            if (sa && sb) {
              lines.push(`• POSIZIONE A: Cass. ${sa.sezione||''} n.${sa.numero}/${sa.anno} — ${sa.oggetto||''}`);
              lines.push(`  POSIZIONE B: Cass. ${sb.sezione||''} n.${sb.numero}/${sb.anno} — ${sb.oggetto||''}`);
            }
          } catch(e2) {}
        }
        blocchiC.push(lines.join('\n'));
      }
    } catch(e) { console.warn('[dossier] Blocco C errore per ' + norma + ':', e.message); }

    // ── D) Notizie con L5 implicazioni avvocato ──────────────────────────────
    try {
      const parsed = normaToDbKey(norma);
      if (parsed) {
        const rows = db.prepare(`
          SELECT n.title, n.l5_implicazioni
          FROM codici_news_link cnl
          JOIN news n ON n.id = cnl.news_id
          WHERE cnl.articolo_id = ?
            AND n.l5_implicazioni IS NOT NULL
            AND n.l5_implicazioni != ''
          ORDER BY n.published_at DESC
          LIMIT 3
        `).all(parsed.dbKey);
        if (rows.length > 0) {
          const lines = [`[IMPLICAZIONI OPERATIVE SU ${norma} (da notizie recenti)]`];
          for (const r of rows) {
            try {
              const l5 = JSON.parse(r.l5_implicazioni);
              const impatto = l5.impatto_operativo || '';
              const scenari = (l5.scenari || []).slice(0, 2)
                .map(s => `  Se ${s.se} → ${s.allora} [prob: ${s.probabilita||'?'}]`).join('\n');
              if (impatto || scenari) {
                lines.push(`• ${(r.title||'').substring(0,70)}`);
                if (impatto) lines.push(`  AZIONE: ${impatto.substring(0,200)}`);
                if (scenari) lines.push(scenari);
              }
            } catch(e2) {}
          }
          blocchiD.push(lines.join('\n'));
        }
      }
    } catch(e) { console.warn('[dossier] Blocco D errore per ' + norma + ':', e.message); }
  }

  // ── BLOCCO F: Pronunce Corte Costituzionale ─────────────────────────────────
  let contestoCorteCostituzionale = '';
  try {
    const BetterSqlite3 = require('better-sqlite3');
    const dbCC = new BetterSqlite3(require('path').join(__dirname, '..', 'data', 'cortecostituzionale.db'), { readonly: true });
    for (const norma of norme) {
      const termineRicerca = (typeof norma === 'object' ? (norma.norma || '') : String(norma))
        .replace(/^art\.\s*/i, '').replace(/^articolo\s*/i, '');
      if (!termineRicerca) continue;
      const rows = dbCC.prepare(
        `SELECT numero, anno, tipo, dispositivo, oggetto FROM pronunce
         WHERE oggetto LIKE ? OR dispositivo LIKE ?
         ORDER BY anno DESC LIMIT 2`
      ).all('%' + termineRicerca + '%', '%' + termineRicerca + '%');
      if (rows.length > 0) {
        const normaLabel = typeof norma === 'object' ? (norma.norma || '') : String(norma);
        contestoCorteCostituzionale += `\n[PRONUNCE CORTE COSTITUZIONALE SU ${normaLabel}]\n`;
        for (const r of rows) {
          const disp = (r.dispositivo || '').slice(0, 100).replace(/\n/g, ' ');
          contestoCorteCostituzionale += `• Corte Cost. ${r.tipo} n.${r.numero}/${r.anno} — ${disp}\n`;
        }
      }
    }
    dbCC.close();
  } catch(e) {
    console.error('[dossier] Corte Cost. lookup error:', e.message);
  }

  // ── Assemblaggio finale: E (multi-norma) → B (specifiche) → C (contrasti) → D (notizie) → A (generiche) ──
  const blocchi = [];

  if (blocchiE.length > 0) {
    blocchi.push('\n[SENTENZE MULTI-NORMA (citano ≥2 norme del caso insieme — MASSIMA PRIORITÀ)]\n');
    blocchi.push(...blocchiE);
  }
  if (blocchiB.length > 0) {
    blocchi.push('\n[SENTENZE SPECIFICHE AL CASO (pertinenti alla fattispecie — PRIORITARIE)]\n');
    blocchi.push(...blocchiB);
  }
  blocchi.push(...blocchiC);
  blocchi.push(...blocchiD);
  if (blocchiA.length > 0) {
    blocchi.push('\n[NOTA: le sentenze sotto sono generiche sulla norma, non specifiche al caso. Privilegia le SENTENZE SPECIFICHE sopra.]\n');
    blocchi.push(...blocchiA);
  }

  try { db.close(); } catch(e) {}

  // Appendi Corte Costituzionale al contesto aggregato
  if (contestoCorteCostituzionale) {
    blocchi.push(contestoCorteCostituzionale);
  }

  // ── BLOCCO G: Normativa UE pertinente (EUR-Lex) ─────────────────────────────
  let contestoEurLex = '';
  try {
    const BetterSqlite3 = require('better-sqlite3');
    const dbEL = new BetterSqlite3(require('path').join(__dirname, '..', 'data', 'eurlex.db'), { readonly: true });
    for (const norma of norme) {
      const normaLabel = typeof norma === 'object' ? (norma.norma || '') : String(norma);
      const termine = normaLabel.replace(/^art\.\s*/i, '').replace(/^articolo\s*/i, '').trim();
      if (termine.length < 3) continue;
      const rows = dbEL.prepare(
        `SELECT celex, COALESCE(titolo_it, titolo) as titolo, tipo_label, anno
         FROM atti
         WHERE (titolo LIKE ? OR titolo_it LIKE ? OR testo_estratto LIKE ?)
         AND in_vigore = 1
         ORDER BY anno DESC LIMIT 2`
      ).all('%'+termine+'%', '%'+termine+'%', '%'+termine+'%');
      if (rows.length > 0) {
        contestoEurLex += `\n[NORMATIVA UE PERTINENTE: ${normaLabel}]\n`;
        for (const r of rows) {
          const tit = (r.titolo || '').slice(0, 100).replace(/\n/g, ' ');
          contestoEurLex += `• ${r.tipo_label || 'Atto'} UE ${r.celex} (${r.anno}) — ${tit}\n`;
        }
      }
    }
    dbEL.close();
  } catch(e) {
    console.error('[dossier] EUR-Lex lookup error:', e.message);
  }

  if (contestoEurLex) {
    blocchi.push(contestoEurLex);
  }

  // Troncamento a 4.000 chars
  const ctx = blocchi.join('\n\n');
  return ctx.length > 4000 ? ctx.substring(0, 4000) + '\n[...contesto troncato a 4000 chars]' : ctx;
}

// ── Genera dossier con Sonnet ─────────────────────────────────────────────────
// ── Prepara contesto DB (fase sincrona/CPU-bound) — da chiamare NEL thread prima di res.end() ──
// Ritorna { normeEspanse, contestoConProb, keywords, dbCass } — chiudere dbCass dopo l'uso
async function preparaContestoDossier(domanda, norme) {
  const Database = require('better-sqlite3');
  let dbCass = null;
  try {
    dbCass = new Database(path.join(__dirname, '..', 'data', 'cassazione.db'), { readonly: true });
  } catch(e) { console.warn('[dossier] cassazione.db non disponibile:', e.message); }

  const keywords = estraiKeyword(domanda);

  const normeEspanse = await espandiNorme(norme, domanda, keywords, dbCass);
  console.log(`[dossier] norme: ${norme.length} → ${normeEspanse.length} (espanse)`);

  const contesto = await raccogliContesto(domanda, normeEspanse, dbCass, keywords);

  const righeProb = [];
  for (const normaRaw of normeEspanse) {
    const norma = typeof normaRaw === 'object' ? (normaRaw.norma || '') : String(normaRaw);
    if (!norma) continue;
    const prob = calcolaProbabilita(norma, dbCass);
    if (!prob) continue;
    if (prob.campione_insufficiente) {
      righeProb.push(`[PROBABILITA' STORICA: ${norma} — campione insufficiente (solo ${prob.totale} sentenze). Non calcolare probabilita'.]`);
    } else {
      righeProb.push(`[PROBABILITA' STORICA: ${norma} — accolto in ${prob.probabilita}% dei casi (su ${prob.totale} sentenze analizzate). Campione: ${prob.accolto} accolte, ${prob.rigettato} rigettate.]`);
    }
  }
  const contestoConProb = righeProb.length > 0
    ? contesto + '\n\n' + righeProb.join('\n')
    : contesto;
  if (righeProb.length > 0) console.log('[dossier] probabilità storiche:', righeProb.join(' | '));

  // ── Chiude il DB — i dati sono già in memoria come stringhe ────────────────
  try { if (dbCass) dbCass.close(); } catch(e) {}

  // ── Inietta statistiche reali Cassazione per le norme della domanda ─────────
  // Estrai norme dalla domanda (art. NNN c.p./c.c./c.p.p./etc.) per la query stats
  const contestoConStats = await injectStatsNorme(domanda, normeEspanse, contestoConProb);

  return { normeEspanse, contestoConProb: contestoConStats, keywords };
}

// ── Sanifica query per FTS5 (stessa logica di server.js) ─────────────────────
function sanitizeFtsQuery(q) {
  return q.replace(/[^a-zA-Z0-9àáâãäåæçèéêëìíîïðñòóôõöùúûüýþÿÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖÙÚÛÜÝÞŸ ]/g, ' ').trim();
}

// ── Case matching: trova le sentenze FTS5 più simili al caso descritto ────────
// Ritorna array di { id, numero, anno, sezione, esito, snippet, score }
// limit: numero massimo di risultati (default 5)
function findSimilarCases(descrizioneUtente, limit = 5) {
  if (!descrizioneUtente || descrizioneUtente.trim().length < 10) return [];
  try {
    const Database = require('better-sqlite3');
    const dbCass = new Database(
      path.join(__dirname, '..', 'data', 'cassazione.db'), { readonly: true }
    );

    // ── Costruisci query FTS da keywords della descrizione ────────────────────
    // Usa estraiKeyword per ottenere sostantivi giuridici rilevanti
    const kw = estraiKeyword(descrizioneUtente);
    if (kw.length === 0) { dbCass.close(); return []; }

    // Query FTS: prova prima con AND implicito (tutte le parole), poi OR se 0 risultati
    const qStrict = sanitizeFtsQuery(kw.join(' '));
    // Per FTS5: parole separate da spazio = AND implicito; OR esplicito con OR
    const qFallback = sanitizeFtsQuery(kw.join(' OR '));

    let rows = [];
    for (const qFts of [qStrict, qFallback]) {
      if (!qFts || qFts.length < 3) continue;
      try {
        // JOIN FTS + sentenze con bm25 per ranking di rilevanza
        // bm25 ritorna valori negativi: più negativo = più rilevante → ORDER BY ASC
        rows = dbCass.prepare(`
          SELECT
            s.id, s.numero, s.anno, s.sezione, s.sezione_code, s.esito,
            bm25(sentenze_fts) AS score,
            SUBSTR(COALESCE(
              NULLIF(s.testo_dispositivo, ''),
              NULLIF(s.oggetto, ''),
              NULLIF(s.testo_integrale, '')
            ), 1, 350) AS snippet
          FROM sentenze_fts f
          JOIN sentenze s ON s.rowid = f.rowid
          WHERE sentenze_fts MATCH ?
            AND s.esito IS NOT NULL
          ORDER BY bm25(sentenze_fts)
          LIMIT ?
        `).all(qFts, limit * 2); // prende il doppio per poi filtrare i senza-snippet
        if (rows.length > 0) break;
      } catch (ftsErr) {
        // FTS parse error: skip questa query
      }
    }

    dbCass.close();

    // Filtra righe con snippet significativo e prendi i top `limit`
    return rows
      .filter(r => r.snippet && r.snippet.trim().length > 30)
      .slice(0, limit)
      .map(r => ({
        id:       r.id,
        numero:   r.numero,
        anno:     r.anno,
        sezione:  r.sezione || r.sezione_code || '?',
        esito:    r.esito || 'sconosciuto',
        snippet:  r.snippet.trim(),
        score:    r.score,
      }));
  } catch (e) {
    console.warn('[dossier] findSimilarCases errore:', e.message);
    return [];
  }
}

// ── Formatta i casi simili in blocco testo da iniettare nel prompt ────────────
// casi: array da findSimilarCases()
// Ritorna stringa vuota se nessun caso trovato (graceful fallback)
function buildCaseContext(casi) {
  if (!casi || casi.length === 0) return '';

  const righe = [
    '[PRECEDENTI GIURISPRUDENZIALI SIMILI - trovati nel DB ' +
    '270K+ sentenze Cassazione 2021-2026]',
  ];

  // Conta esiti per riepilogo statistico
  const conteggioEsiti = {};
  for (const c of casi) {
    const e = c.esito || 'sconosciuto';
    conteggioEsiti[e] = (conteggioEsiti[e] || 0) + 1;
  }

  // Mappa etichette esito → label leggibile
  const LABEL_ESITO = {
    rigetto:                  'RIGETTO',
    inammissibile:            'INAMMISSIBILE',
    annullamento_con_rinvio:  'ACCOGLIMENTO (annullamento con rinvio)',
    annullamento_senza_rinvio:'ACCOGLIMENTO (annullamento senza rinvio)',
    accoglimento:             'ACCOGLIMENTO',
  };

  casi.forEach((c, i) => {
    const label = LABEL_ESITO[c.esito] || c.esito.toUpperCase();
    // sezione può essere "Sezione V" o "Sezioni Unite" — usiamo direttamente senza doppio prefisso
    const sezioneStr = c.sezione ? c.sezione.replace(/^Sezion[ei]\s*/i, 'Sez. ') : '';
    const ref = ['Cass.', sezioneStr, `n. ${c.numero}/${c.anno}`].filter(Boolean).join(' ');
    righe.push('');
    righe.push(`Caso ${i + 1}: ${ref} — ${label}`);
    // snippet del dispositivo/oggetto (già troncato a 350 chars da query)
    righe.push(`"${c.snippet.replace(/\s+/g, ' ').substring(0, 300)}..."`);
  });

  // Riepilogo statistico
  righe.push('');
  const totale = casi.length;
  const partiRiepilogo = Object.entries(conteggioEsiti)
    .sort((a, b) => b[1] - a[1])
    .map(([esito, n]) => {
      const pct = Math.round((n / totale) * 100);
      return `${LABEL_ESITO[esito] || esito} ${n} (${pct}%)`;
    });
  righe.push(`RIEPILOGO: su ${totale} casi simili trovati — ${partiRiepilogo.join(', ')}.`);
  righe.push(
    'USA QUESTI PRECEDENTI per calibrare la strategia. ' +
    'Cita i numeri di sentenza specifici nel dossier dove pertinenti.'
  );

  return righe.join('\n');
}

// ── PROFILO SEZIONI — dati empirici da cassazione.db (2021-2026) ─────────────
// Fonte: diagnostica su 277.751 sentenze classificate
const PROFILO_SEZIONI = {
  'Sezione I': {
    materia: 'civile',
    label: 'Sezione I Civile',
    oggetti: ['immigrazione','fallimento','banca','separazione divorzio','pubblica amministrazione','filiazione minori','espropriazione','appalto opere pubbliche','brevetto marchio','concorrenza antitrust','societa di capitali','titoli credito'],
    esiti: { inammissibile: 33.5, rigetto: 26.2, accoglimento: 7.8, annullamento_con_rinvio: 16.7, annullamento_senza_rinvio: 4.0, estinzione: 11.8 },
    note: 'Tratta immigrazione (33% del ruolo), fallimenti e banche. Tasso accoglimento 7.8%, annullamento con rinvio 16.7% (totale favorevole 24.5%).',
  },
  'Sezione II': {
    materia: 'civile',
    label: 'Sezione II Civile',
    oggetti: ['proprieta','vendita','sanzioni amministrative','appalto privato','contratto d opera','equa riparazione','immigrazione','servitu','condominio','successioni','distanze','possesso'],
    esiti: { inammissibile: 42.9, rigetto: 21.1, accoglimento: 10.4, annullamento_con_rinvio: 10.3, annullamento_senza_rinvio: 2.6, estinzione: 12.7 },
    note: 'Diritti reali, contratti, sanzioni. Inammissibilità 42.9%. Accoglimento + annullamento 20.7%.',
  },
  'Sezione III': {
    materia: 'civile',
    label: 'Sezione III Civile',
    oggetti: ['responsabilita civile generale','opposizione esecuzione','immigrazione','responsabilita circolazione stradale','responsabilita sanitaria','revocatoria ordinaria','responsabilita civile pa','responsabilita professionisti','assicurazione danni'],
    esiti: { inammissibile: 43.4, rigetto: 20.7, accoglimento: 7.1, annullamento_con_rinvio: 11.7, annullamento_senza_rinvio: 3.8, estinzione: 13.4 },
    note: 'Responsabilità civile e RC auto. Inammissibilità 43.4%. Annullamento con rinvio 11.7%.',
  },
  'Sezione IV': {
    materia: 'penale',
    label: 'Sezione IV Penale',
    oggetti: ['omicidio colposo','lesioni colpose','colpa medica','disastro colposo','infortuni sul lavoro','incidenti stradali penale','sicurezza lavoro'],
    esiti: { inammissibile: 47.6, rigetto: 19.8, accoglimento: 0.0, annullamento_con_rinvio: 19.1, annullamento_senza_rinvio: 13.3, estinzione: 0.0 },
    note: 'Colpa professionale, omicidio/lesioni stradali. ATTENZIONE: 0% accoglimento puro — la via favorevole è annullamento con rinvio (19.1%) o senza rinvio (13.3%). Inammissibilità alta 47.6%.',
  },
  'Sezione V': {
    materia: 'tributario',
    label: 'Sezione V Tributaria',
    oggetti: ['tributi altri','irpef ilor accertamento','iva accertamento','irpeg ires accertamento','tributi locali','irap accertamento','imposte dirette','accertamento fiscale'],
    esiti: { inammissibile: 22.5, rigetto: 26.4, accoglimento: 24.3, annullamento_con_rinvio: 9.5, annullamento_senza_rinvio: 1.8, estinzione: 15.5 },
    note: 'Sezione esclusivamente tributaria. Tasso accoglimento 24.3% — significativamente superiore alla media generale (9.9%). Inammissibilità molto bassa (22.5% vs media 54.5%). Sezione favorevole per i ricorrenti.',
  },
  'Sezione VI': {
    materia: 'misto',
    label: 'Sezione VI (Filtro)',
    oggetti: ['immigrazione','tributi altri','irpef ilor accertamento','contributi previdenza','sanzioni amministrative','fallimento','patrocinio spese stato'],
    esiti: { inammissibile: 43.9, rigetto: 20.1, accoglimento: 18.4, annullamento_con_rinvio: 9.1, annullamento_senza_rinvio: 5.3, estinzione: 3.1 },
    note: 'Sezione filtro/interlocutoria — smista ricorsi e tratta materie eterogenee. Alto accoglimento (18.4%) per le cause che superano il filtro, inammissibilità 43.9%.',
  },
  'Sezione VII': {
    materia: 'filtro_penale',
    label: 'Sezione VII (Filtro Penale)',
    oggetti: ['filtro inammissibilità','ricorsi penali non manifesti','decisioni camera di consiglio'],
    esiti: { inammissibile: 98.1, annullamento_con_rinvio: 1.9, rigetto: 0.0, accoglimento: 0.0 },
    note: 'Camera di consiglio penale — decisione in forma semplificata. 98.1% inammissibilità. Assegnazione qui segnala ricorso a fortissimo rischio.',
  },
  'Sezione Lavoro': {
    materia: 'lavoro',
    label: 'Sezione Lavoro',
    oggetti: ['previdenza altro','contributi previdenza','retribuzione pubblico impiego','retribuzione rapporto privato','licenziamenti','risarcimento pubblico impiego','assistenza','immigrazione lavoro'],
    esiti: { inammissibile: 20.2, rigetto: 41.5, accoglimento: 18.3, annullamento_con_rinvio: 0.9, annullamento_senza_rinvio: 0.1, estinzione: 19.0 },
    note: 'Lavoro, previdenza, pubblico impiego. Inammissibilità bassissima (20.2% vs media 54.5%). Alta frequenza rigetto (41.5%). Accoglimento 18.3%. Sezione dove il merito prevale sulla forma.',
  },
  'Sezioni Unite': {
    materia: 'misto',
    label: 'Sezioni Unite',
    oggetti: ['ricorsi contro decisioni giudici speciali','regolamenti di giurisdizione','disciplinare avvocati','disciplinare magistrati'],
    esiti: { inammissibile: 44.5, rigetto: 25.2, accoglimento: 7.9, annullamento_con_rinvio: 3.2, annullamento_senza_rinvio: 0.3, estinzione: 18.9 },
    note: 'Questioni di giurisdizione, contrasti tra sezioni, disciplinare. Accoglimento 7.9%, prevalentemente rigetto.',
  },
};

// Media generale (base di confronto)
const MEDIA_GENERALE = {
  inammissibile: 54.5, rigetto: 17.2, accoglimento: 9.9,
  annullamento_con_rinvio: 7.8, annullamento_senza_rinvio: 2.5, estinzione: 8.3,
};

// ── detectSezione: inferisce sezione competente da testo + norme citate ───────
// Ritorna { sezione, confidenza, motivazione }
function detectSezione(testoUtente, normeCitate = []) {
  const txt = (testoUtente || '').toLowerCase();
  const norme = normeCitate.map(n => (typeof n === 'object' ? n.norma || '' : String(n)).toLowerCase());
  const tuttoTxt = txt + ' ' + norme.join(' ');

  // ── Segnali materia ───────────────────────────────────────────────────────
  const segnaliTributari = ['irpef','ires','irap','iva','accertamento fiscal','fisco','agenzia entrate','tribut','imposte dirette','accertamento sintetico','redditometro','evasion','dichiarazione dei redditi','sanzione tributaria','avviso di accertamento','cartella esattoriale'];
  const segnaliLavoro    = ['licenziamento','retribuzione','contratto di lavoro','previdenza','inps','inail','tfr','busta paga','pubblico impiego','dipendente','datore di lavoro','ccnl','mobbing','burnout','assegno familiari','pensione','invalidità lavorativa'];
  const segnaliPenaleIV  = ['omicidio colposo','lesioni colpose','colpa medica','malpractice','infortun','sicurezza sul lavoro','d.lgs. 81','incidente stradale','omicidio stradale','d.lgs. 285','art. 590','art. 589','disastro colposo'];
  const segnaliPenaleVII = ['camera di consiglio','manifesta inammissibilità','motivi non consentiti'];
  const segnaliCivileI   = ['fallimento','concordato','liquidazione giudiziale','banca','credito','societa','immigrazione','esproprio','espropriazione','adozione','divorzio','separazione','filiazione','minori','marca','brevetto','antitrust'];
  const segnaliCivileII  = ['proprieta','vendita','compravendita','appalto','condominio','successione','servitu','distanze','possesso','usucapione','sanzione amministrativa','opposizione ordinanza'];
  const segnaliCivileIII = ['responsabilità civile','rc auto','danno','risarcimento','assicurazione','medico','sanitario','professionista','opposizione esecuzione','revocatoria','chirurgo','ospedale'];
  const segnaliSsuu      = ['sezioni unite','conflitto giurisdizione','regolamento giurisdizione','giudice speciale','tar','consiglio di stato','disciplinare avvocato','disciplinare magistrat'];

  function score(segnali) {
    return segnali.filter(s => tuttoTxt.includes(s)).length;
  }

  // Segnali normativi diretti
  const normePenaleIV  = ['art. 589','art. 590','d.lgs. 81','art. 589-bis','art. 590-bis'];
  const normeTribut    = ['irpef','ires','iva','irap','d.p.r. 600','d.p.r. 633','d.lgs. 546','tribut'];
  const normeLavoro    = ['d.lgs. 165','d.lgs. 81/2015','l. 300','art. 18 stat','art. 2094','art. 2119','d.lgs. 23'];

  function scoreNorme(patterns) {
    return patterns.filter(p => tuttoTxt.includes(p)).length;
  }

  const scores = {
    'Sezione V':       score(segnaliTributari) * 3 + scoreNorme(normeTribut) * 4,
    'Sezione Lavoro':  score(segnaliLavoro)    * 3 + scoreNorme(normeLavoro) * 4,
    'Sezione IV':      score(segnaliPenaleIV)  * 3 + scoreNorme(normePenaleIV) * 4,
    'Sezione VII':     score(segnaliPenaleVII) * 5,
    'Sezioni Unite':   score(segnaliSsuu)      * 5,
    'Sezione I':       score(segnaliCivileI)   * 2,
    'Sezione II':      score(segnaliCivileII)  * 2,
    'Sezione III':     score(segnaliCivileIII) * 2,
  };

  // Tiebreak: civile generico → Sez. III (responsabilità civile è la più comune)
  scores['Sezione III'] += 0.5;

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const [sezione, punteggio] = best;

  const confidenza = punteggio >= 8 ? 'alta' : punteggio >= 4 ? 'media' : 'bassa';
  const motivo     = punteggio < 2 ? 'nessun segnale specifico rilevato' :
    (scores['Sezione V'] === punteggio ? 'materia tributaria (IRPEF/IVA/IRES/IRAP)' :
     scores['Sezione Lavoro'] === punteggio ? 'materia lavoro/previdenza' :
     scores['Sezione IV'] === punteggio ? 'colpa penale (omicidio/lesioni colpose)' :
     scores['Sezione VII'] === punteggio ? 'filtro penale (manifesta inammissibilità)' :
     scores['Sezioni Unite'] === punteggio ? 'questione giurisdizione / contrasto' :
     `materia civile (${sezione})`);

  return { sezione, confidenza, punteggio, motivazione: motivo };
}

// ── buildSezioneBlock: costruisce blocco PROFILO SEZIONE da iniettare nel prompt
function buildSezioneBlock(testoUtente, normeCitate = []) {
  try {
    const { sezione, confidenza, punteggio, motivazione } = detectSezione(testoUtente, normeCitate);
    if (punteggio < 2) return ''; // non abbastanza segnali

    const profilo = PROFILO_SEZIONI[sezione];
    if (!profilo) return '';

    const esiti = profilo.esiti;
    const media = MEDIA_GENERALE;

    // Confronto con media generale
    const diffInamm = (esiti.inammissibile - media.inammissibile).toFixed(1);
    const diffAcc   = ((esiti.accoglimento || 0) - media.accoglimento).toFixed(1);
    const totFavorevole = (esiti.accoglimento || 0) + (esiti.annullamento_con_rinvio || 0);
    const diffFav   = (totFavorevole - (media.accoglimento + media.annullamento_con_rinvio)).toFixed(1);

    const confrontoInamm = diffInamm > 0 ? `+${diffInamm}% vs media` : `${diffInamm}% vs media`;
    const confrontoFav   = diffFav   > 0 ? `+${diffFav}% vs media`   : `${diffFav}% vs media`;

    const righe = [
      `[PROFILO SEZIONE COMPETENTE — confidenza ${confidenza} (${motivazione})]`,
      `${profilo.label} (probabile per questo caso):`,
      `- Inammissibilità: ${esiti.inammissibile}% (${confrontoInamm} ${media.inammissibile}%)`,
      `- Rigetto: ${esiti.rigetto}%`,
      `- Accoglimento: ${esiti.accoglimento || 0}%`,
      `- Annullamento con rinvio: ${esiti.annullamento_con_rinvio || 0}% (${confrontoFav} per totale favorevole)`,
    ];
    if (esiti.annullamento_senza_rinvio > 0) {
      righe.push(`- Annullamento senza rinvio: ${esiti.annullamento_senza_rinvio}%`);
    }
    if (esiti.estinzione > 0) {
      righe.push(`- Estinzione/prescrizione: ${esiti.estinzione}%`);
    }
    righe.push(`NOTA SEZIONE: ${profilo.note}`);

    return righe.join('\n');
  } catch(e) {
    console.warn('[dossier] buildSezioneBlock errore:', e.message);
    return '';
  }
}

// ── Query diretta DB: norme co-citate con distribuzione esiti combinati ────────
// Accede direttamente ai DB senza HTTP — usata da injectStatsNorme()
function queryNormeCorrelateDB(codice) {
  try {
    const Database = require('better-sqlite3');
    const dbGiur   = new Database(path.join(__dirname, '..', 'data', 'giuridica.db'), { readonly: true });
    // Risolve alias → forma canonica via norma_canonical; fallback LIKE se vuoto
    let canonicaDoss = codice;
    try {
      const cRow = dbGiur.prepare('SELECT canonica FROM norma_canonical WHERE alias = ? LIMIT 1').get(codice.trim());
      if (cRow) canonicaDoss = cRow.canonica;
    } catch(e) { /* tabella non disponibile, usa valore grezzo */ }
    const patBase  = canonicaDoss.replace(/-/g, '%');
    const pat      = '%' + patBase + '%';

    // Top 10 norme co-citate in sentenze reali — prova exact-match, poi LIKE
    let cocitRows = dbGiur.prepare(`
      SELECT
        CASE WHEN norma_a = ? THEN norma_b ELSE norma_a END AS norma_correlata,
        GROUP_CONCAT(DISTINCT fonte) AS fonti_concat,
        COUNT(DISTINCT fonte)        AS co_citazioni
      FROM relazioni_norme
      WHERE tipo = 'co_citazione_sent'
        AND (norma_a = ? OR norma_b = ?)
        AND fonte IS NOT NULL AND fonte != ''
      GROUP BY norma_correlata
      ORDER BY co_citazioni DESC
      LIMIT 10
    `).all(canonicaDoss, canonicaDoss, canonicaDoss);
    if (cocitRows.length === 0) {
      cocitRows = dbGiur.prepare(`
        SELECT
          CASE WHEN norma_a LIKE ? THEN norma_b ELSE norma_a END AS norma_correlata,
          GROUP_CONCAT(DISTINCT fonte) AS fonti_concat,
          COUNT(DISTINCT fonte)        AS co_citazioni
        FROM relazioni_norme
        WHERE tipo = 'co_citazione_sent'
          AND (norma_a LIKE ? OR norma_b LIKE ?)
          AND fonte IS NOT NULL AND fonte != ''
        GROUP BY norma_correlata
        ORDER BY co_citazioni DESC
        LIMIT 10
      `).all(pat, pat, pat);
    }
    dbGiur.close();

    if (cocitRows.length === 0) return [];

    // Esiti combinati da cassazione.db
    let dbCass = null;
    try {
      dbCass = new Database(path.join(__dirname, '..', 'data', 'cassazione.db'), { readonly: true });
    } catch(e) { /* graceful fallback */ }

    const risultato = [];
    for (const row of cocitRows) {
      const ids = (row.fonti_concat || '').split(',').filter(Boolean).slice(0, 900);
      const esitiCombo = {};
      if (ids.length > 0 && dbCass) {
        try {
          const ph  = ids.map(() => '?').join(',');
          const ers = dbCass.prepare(
            `SELECT esito, COUNT(*) as c FROM sentenze WHERE id IN (${ph}) AND esito IS NOT NULL GROUP BY esito`
          ).all(...ids);
          for (const e of ers) { esitiCombo[e.esito] = (esitiCombo[e.esito] || 0) + e.c; }
        } catch(e) { /* ignora errori per singola norma */ }
      }
      risultato.push({
        norma:           row.norma_correlata,
        co_citazioni:    row.co_citazioni,
        esiti_combinati: esitiCombo,
      });
    }
    try { if (dbCass) dbCass.close(); } catch(e) {}
    return risultato;
  } catch(e) {
    console.warn('[dossier] queryNormeCorrelateDB errore:', e.message);
    return [];
  }
}

// ── Fetch statistiche da /api/stats/norma/:codice (endpoint locale) ───────────
async function fetchStatsNorma(norma) {
  return new Promise((resolve) => {
    try {
      const http = require('http');
      const enc  = encodeURIComponent(norma);
      const opts = { hostname: '127.0.0.1', port: 3202, path: `/api/stats/norma/${enc}`, method: 'GET', timeout: 3000 };
      const req  = http.request(opts, (res) => {
        let body = '';
        res.on('data', c => { body += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch(e) { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    } catch(e) { resolve(null); }
  });
}

// ── Costruisce e inietta il blocco statistiche nel contesto ───────────────────
async function injectStatsNorme(domanda, normeEspanse, contestoAttuale) {
  try {
    // Estrai norme dalla domanda con regex — priorità alle norme esplicite
    const RE_NORMA = /art(?:t)?\.?\s*\d+[\w\-]*(?:\s*(?:c\.p\.p\.|c\.p\.c\.|c\.p\.|c\.c\.|cost\.|Cost\.|d\.lgs\.|l\.))?/gi;
    const normeFromDomanda = (domanda.match(RE_NORMA) || []).slice(0, 3);
    // Unisci con le prime 2 norme espanse (senza duplicati)
    const normeTarget = [...new Set([...normeFromDomanda, ...normeEspanse.slice(0, 2)])].slice(0, 3);
    if (normeTarget.length === 0) return contestoAttuale;

    const righeStats = [];
    for (const norma of normeTarget) {
      const normaStr = typeof norma === 'object' ? (norma.norma || '') : String(norma);
      if (!normaStr || normaStr.length < 4) continue;
      try {
        const stats = await fetchStatsNorma(normaStr);
        if (!stats || !stats.ok || stats.totale_sentenze === 0) {
          // Nessuna statistica empirica — inietta almeno il testo vigente se disponibile in DB
          try {
            const { resolveNorma } = require('./norma-resolver');
            const normaRes = await resolveNorma(normaStr);
            if (normaRes.trovata && normaRes.testo) {
              const testoSnippet = normaRes.testo.slice(0, 400).replace(/\n+/g, ' ').trim();
              righeStats.push(
                `TESTO VIGENTE — ${normaStr} [fonte: ${normaRes.fonte}]:\n` +
                `"${testoSnippet}${normaRes.testo.length > 400 ? '...' : ''}"`
              );
            }
          } catch(_) { /* fallback silenzioso */ }
          continue;
        }
        const trovate = stats.totale_trovate_in_cassazionedb || 0;
        if (trovate === 0) continue;

        const pRig  = stats.percentuale_rigetto       || 0;
        const pInam = stats.percentuale_inammissibile  || 0;

        // Accoglimento puro vs annullamento con rinvio — separati per chiarezza strategica
        const nAccPuro    = stats.distribuzione_esiti?.accoglimento            || 0;
        const nAnnRinvio  = stats.distribuzione_esiti?.annullamento_con_rinvio || 0;
        const nAnnSenza   = stats.distribuzione_esiti?.annullamento_senza_rinvio || 0;
        const pAccPuro    = Math.round((nAccPuro   / trovate) * 1000) / 10;
        const pAnnRinvio  = Math.round((nAnnRinvio / trovate) * 1000) / 10;
        const pAnnSenza   = Math.round((nAnnSenza  / trovate) * 1000) / 10;

        const sezPrev = stats.sezione_prevalente || '—';

        // ── Calcolo trend dall'ultimo biennio disponibile ────────────────────
        const anniObj  = stats.distribuzione_anni || {};
        const anniKeys = Object.keys(anniObj).sort();
        let trendStr = '';
        if (anniKeys.length >= 2) {
          const last = anniObj[anniKeys[anniKeys.length - 1]] || 0;
          const prev = anniObj[anniKeys[anniKeys.length - 2]] || 0;
          if (prev > 0) {
            const delta = Math.round(((last - prev) / prev) * 100);
            trendStr = delta > 20  ? ` Trend: +${delta}% nell'ultimo anno (↑ in crescita).`
                     : delta < -20 ? ` Trend: ${delta}% nell'ultimo anno (↓ in calo).`
                     : ' Trend: stabile.';
          }
        }

        // ── Nota strategica automatica — guida diretta all'AI ────────────────
        let notaStrategica = '';
        if (pInam >= 50) {
          notaStrategica = ' ⚠️ RISCHIO INAMMISSIBILITÀ ALTO (>50%): verifica scrupolosamente i requisiti formali prima di proporre questo motivo.';
        } else if (pRig >= 60) {
          notaStrategica = ' ⚠️ DIFFICILE: rigetto predominante — valuta argomenti alternativi e rafforza la motivazione.';
        } else if ((pAccPuro + pAnnRinvio) >= 30) {
          notaStrategica = ' ✅ OPPORTUNITÀ: tasso di accoglimento/annullamento significativo — motivo solido se ben argomentato.';
        }

        righeStats.push(
          `- ${normaStr}: ${trovate} sentenze trovate. ` +
          `Esiti: inammissibile ${pInam}%, rigetto ${pRig}%, ` +
          `accoglimento ${pAccPuro}%, annullamento con rinvio ${pAnnRinvio}%` +
          (pAnnSenza > 0 ? `, annullamento senza rinvio ${pAnnSenza}%` : '') + `. ` +
          `Sezione prevalente: ${sezPrev}.` +
          trendStr +
          notaStrategica
        );
        console.log(`[dossier] stats ${normaStr}: tot=${trovate} rig=${pRig}% inam=${pInam}% acc=${pAccPuro}% ann_rinvio=${pAnnRinvio}%`);
      } catch(e) {
        console.warn(`[dossier] fetchStats errore per ${normaStr}:`, e.message);
      }
    }

    if (righeStats.length === 0) return contestoAttuale;

    // ── Blocco norme correlate — top co-citate con esiti combinati ────────────
    const righeCorrelate = [];
    for (const norma of normeTarget) {
      const normaStr = typeof norma === 'object' ? (norma.norma || '') : String(norma);
      if (!normaStr || normaStr.length < 4) continue;
      try {
        const correlate = queryNormeCorrelateDB(normaStr);
        if (!correlate || correlate.length === 0) continue;

        righeCorrelate.push(`\nNORME FREQUENTEMENTE CO-CITATE con ${normaStr}:`);
        for (const c of correlate) {
          const tot = Object.values(c.esiti_combinati).reduce((a, b) => a + b, 0);
          let esitiStr = '';
          if (tot > 0) {
            const parti = [];
            for (const [esito, cnt] of Object.entries(c.esiti_combinati).sort((a,b) => b[1]-a[1])) {
              parti.push(`${esito} ${Math.round((cnt/tot)*100)}%`);
            }
            esitiStr = `: quando appaiono insieme, ${parti.join(', ')}`;
          }
          righeCorrelate.push(`- ${c.norma} (${c.co_citazioni} co-citazioni)${esitiStr}`);
        }
        // Suggerimento strategico: norma con miglior tasso accoglimento nella combo
        const migliore = correlate
          .filter(c => {
            const tot = Object.values(c.esiti_combinati).reduce((a, b) => a + b, 0);
            const acc = (c.esiti_combinati.accoglimento || 0) + (c.esiti_combinati.annullamento_con_rinvio || 0);
            return tot >= 3 && acc / (tot || 1) >= 0.20;
          })
          .sort((a, b) => {
            const totA = Object.values(a.esiti_combinati).reduce((x, y) => x + y, 0);
            const totB = Object.values(b.esiti_combinati).reduce((x, y) => x + y, 0);
            const accA = (a.esiti_combinati.accoglimento || 0) + (a.esiti_combinati.annullamento_con_rinvio || 0);
            const accB = (b.esiti_combinati.accoglimento || 0) + (b.esiti_combinati.annullamento_con_rinvio || 0);
            return (accB / (totB || 1)) - (accA / (totA || 1));
          })[0];
        if (migliore) {
          const tot = Object.values(migliore.esiti_combinati).reduce((a, b) => a + b, 0);
          const acc = (migliore.esiti_combinati.accoglimento || 0) + (migliore.esiti_combinati.annullamento_con_rinvio || 0);
          const pAcc = Math.round((acc / tot) * 100);
          righeCorrelate.push(`SUGGERIMENTO: se il caso coinvolge anche ${migliore.norma}, la probabilità di accoglimento/annullamento nella combo sale al ${pAcc}%.`);
        }
      } catch(e) {
        console.warn(`[dossier] correlate errore per ${normaStr}:`, e.message);
      }
    }

    // ── Blocco profilo sezione — inferito da domanda + norme ─────────────────
    const sezioneBlk = buildSezioneBlock(domanda, normeTarget);

    const bloccoStats =
      '\n\n[DATI EMPIRICI DAL DATABASE - 270K sentenze Cassazione 2021-2026]\n' +
      righeStats.join('\n') +
      (righeCorrelate.length > 0 ? '\n' + righeCorrelate.join('\n') : '') +
      '\nUSA QUESTI DATI per calibrare la strategia: se una norma ha alta inammissibilità segnalalo come rischio; se il trend è in crescita segnalalo come opportunità.' +
      (sezioneBlk ? '\n\n' + sezioneBlk : '');
    return bloccoStats + '\n\n' + contestoAttuale;
  } catch(e) {
    console.warn('[dossier] injectStatsNorme errore:', e.message);
    return contestoAttuale;
  }
}

// ── generaDossier — accetta opzioni.contestoPreCalcolato per evitare blocco thread ──
// Se opzioni.contestoPreCalcolato e opzioni.normePreCalcolate sono presenti,
// salta la fase DB (già eseguita nel main thread prima di res.end()).
async function generaDossier(domanda, norme, opzioni) {
  if (!domanda || !norme || norme.length === 0) {
    return { ok: false, errore: 'domanda e norme obbligatorie' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey || apiKey === 'placeholder') {
    return { ok: false, errore: 'ANTHROPIC_API_KEY non configurata' };
  }

  let normeEspanse, contestoConProb, keywords;

  if (opzioni && opzioni.contestoPreCalcolato !== undefined && opzioni.normePreCalcolate) {
    // Fast-path: contesto già pronto — nessuna operazione sincrona su DB
    normeEspanse   = opzioni.normePreCalcolate;
    contestoConProb = opzioni.contestoPreCalcolato;
    keywords        = opzioni.keywords || estraiKeyword(domanda);
  } else {
    // Slow-path (legacy): calcola tutto qui — BLOCCA il thread Node.js
    // Apri cassazione.db una sola volta — usata sia in raccogliContesto che in verifica
    const Database = require('better-sqlite3');
    let dbCass = null;
    try {
      dbCass = new Database(path.join(__dirname, '..', 'data', 'cassazione.db'), { readonly: true });
    } catch(e) { console.warn('[dossier] cassazione.db non disponibile:', e.message); }

    keywords = estraiKeyword(domanda);

    // ── Auto-espansione norme: aggiunge le norme co-citate più rilevanti ────────
    normeEspanse = await espandiNorme(norme, domanda, keywords, dbCass);
    console.log(`[dossier] norme: ${norme.length} → ${normeEspanse.length} (espanse)`);

    // Raccogli contesto con le norme espanse — passa keywords per matching imbuto
    const contesto = await raccogliContesto(domanda, normeEspanse, dbCass, keywords);

    // ── Calcola probabilità storiche per ogni norma (sincrono, sola lettura) ────
    const righeProb = [];
    for (const normaRaw of normeEspanse) {
      const norma = typeof normaRaw === 'object' ? (normaRaw.norma || '') : String(normaRaw);
      if (!norma) continue;
      const prob = calcolaProbabilita(norma, dbCass);
      if (!prob) continue;
      if (prob.campione_insufficiente) {
        righeProb.push(`[PROBABILITA' STORICA: ${norma} — campione insufficiente (solo ${prob.totale} sentenze). Non calcolare probabilita'.]`);
      } else {
        righeProb.push(`[PROBABILITA' STORICA: ${norma} — accolto in ${prob.probabilita}% dei casi (su ${prob.totale} sentenze analizzate). Campione: ${prob.accolto} accolte, ${prob.rigettato} rigettate.]`);
      }
    }
    contestoConProb = righeProb.length > 0
      ? contesto + '\n\n' + righeProb.join('\n')
      : contesto;
    if (righeProb.length > 0) console.log('[dossier] probabilità storiche:', righeProb.join(' | '));

    try { if (dbCass) dbCass.close(); } catch(e) {}
  }

  // ── Case matching: precedenti giurisprudenziali simili al caso ───────────────
  let casiSimiliBlk = '';
  try {
    const casiSimili = findSimilarCases(domanda, 5);
    casiSimiliBlk = buildCaseContext(casiSimili);
    if (casiSimili.length > 0)
      console.log(`[dossier] case-match: ${casiSimili.length} precedenti trovati (score top: ${casiSimili[0].score?.toFixed(2)})`);
  } catch (e) { console.warn('[dossier] case-match errore:', e.message); }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 5000,
    temperature: 0.1,
    system: `Sei un avvocato senior con 30 anni di esperienza in Cassazione. Un collega più giovane ti chiede consiglio su un caso. Non gli fai la lezione di diritto — lui conosce la legge. Gli dici COSA FARE, CON COSA, IN CHE ORDINE, E PERCHÉ.

Il tuo ragionamento è LOGICO-DEDUTTIVO:
1. Parti dal caso concreto (non dalla norma astratta)
2. Identifichi gli elementi critici che determinano vittoria o sconfitta
3. Per ogni elemento, cerchi nel contesto la sentenza che lo supporta o lo nega
4. Costruisci la strategia come una catena di argomenti, ognuno ancorato a un dato reale
5. Segnali i buchi — cosa manca per chiudere il ragionamento

REGOLE FERREE:
- Cita SOLO sentenze presenti nel contesto fornito. MAI inventare.
- Se il frammento di una sentenza non menziona un dato, NON attribuirglielo.
- Usa [DAL TESTO] per dati estratti dai frammenti, [IPOTESI] per ricostruzioni.
- Se un dato è critico ma assente, scrivi: "⚠️ DATO MANCANTE — l'avvocato DEVE acquisire: [cosa] da [dove]"
- NON ripetere il testo vigente per intero — l'avvocato lo conosce. Cita solo i commi rilevanti al caso.
- OGNI sezione ha un budget: rispettalo. Le sezioni operative (4, 5, 6) sono PIÙ IMPORTANTI di quelle descrittive (1, 2).
- Rispondi in italiano, linguaggio tecnico-giuridico, tono diretto.
- CONTRASTO APERTO: Se il contesto segnala che una sentenza ha CONTRASTO APERTO con un'altra sentenza, SEGNALALO esplicitamente nel dossier con: "[ATTENZIONE: questa sentenza e' in contrasto aperto con Cass. n. X/Y — verificare quale orientamento prevale prima di citarla in memoria]". Non omettere mai questo avviso.
- PROBABILITA' STORICA: Se il contesto include righe [PROBABILITA' STORICA: ...], riportale nella sezione MAPPA DEL CASO come riga aggiuntiva con intestazione "📊 Dati storici Cassazione:". NON inventare probabilita'. Usa SOLO i dati forniti. Se il campione e' insufficiente, segnalalo.
- Se il contesto include [PRONUNCE CORTE COSTITUZIONALE], citale nel dossier. Una pronuncia di incostituzionalita' puo' cambiare radicalmente la strategia. Specifica se la norma e' stata dichiarata incostituzionale (totalmente o parzialmente) o se la questione e' stata rigettata.
- Se il contesto include [NORMATIVA UE PERTINENTE], citala. Il diritto UE prevale su quello nazionale (primato). Indica se si tratta di un Regolamento (direttamente applicabile) o Direttiva (necessita recepimento).
- SOGLIA 131-BIS: NON confondere MAI le due formulazioni. La soglia e' "pena detentiva non superiore nel MINIMO a 2 anni" (post riforma L. 37/2022). NON scrivere mai "nel massimo a 5 anni" — quella era la vecchia formulazione. Se scrivi entrambe nello stesso dossier, il PM ti smaschera.
- ART. 56 CO. 2 TENTATIVO: la riduzione e' "da un terzo a due terzi". NON scrivere "fino a 2/3" (suggerisce minimo zero) ne' "di 1/3" (suggerisce importo fisso).
- ART. 168-BIS MAP: Proponi SEMPRE come alternativa per incensurati. E' migliore del patteggiamento perche' non lascia condanna. Ordine subordinate: 131-bis, 162-ter, 168-bis MAP, 444 patteggiamento, 62-bis + 163.
- STATO PROCESSUALE: L'avvocato ti dice in quale grado siamo. Leggi attentamente e NON cambiare grado.

SE "primo grado" (GUP/Tribunale):
- Riesame pieno fatto+diritto
- TUTTE le alternative disponibili: 131-bis (tenuità), 162-ter (condotte riparatorie, solo querela remissibile, entro apertura dibattimento), 168-bis/464-bis (messa alla prova, entro apertura dibattimento, serve UEPE), 444 (patteggiamento), 438 (abbreviato), oblazione (solo contravvenzioni), 62-bis+163 (attenuanti generiche+sospensione condizionale)

SE "appello" (Corte d'Appello):
- Riesame merito con vincoli. Motivi specifici obbligatori art. 581 c.p.p. Divieto reformatio in peius se appella solo imputato.
- DISPONIBILI: 599-bis (concordato in appello, strumento chiave, serve consenso PG, post-Cartabia nessuna preclusione), 131-bis (proponibile anche per prima volta), 162-ter (solo se sopravvenuta procedibilità a querela), rinnovazione istruttoria art. 603 c.p.p.
- NON DISPONIBILI: 444 patteggiamento PRECLUSO, 438 abbreviato PRECLUSO, 464-bis messa alla prova PRECLUSA (Cass. 22104/2015)

SE "Cassazione" (ricorso):
- Solo LEGITTIMITÀ. MAI rivalutare il fatto. Motivi tassativi art. 606 c.p.p.
- 131-bis deducibile per prima volta SOLO se norma non era in vigore durante merito (SS.UU. Tushaj 13681/2016). Se era in vigore e non chiesta = PRECLUSA
- 162-ter tecnicamente proponibile ma senza termini dilatori
- MAI patteggiamento, abbreviato, messa alla prova, concordato

CHECKLIST OBBLIGATORIO — FRAMEWORK UNIVERSALE (applica SEMPRE, per OGNI caso penale):

1. AGGRAVANTI E ATTENUANTI:
   - Mai assumere che non ci siano aggravanti. Per OGNI reato, identifica le aggravanti tipiche della fattispecie concreta (es. furto: art. 625 c.p.; lesioni: art. 583 c.p.; truffa: art. 640 co. 2 c.p.; stupefacenti: art. 80 DPR 309/90).
   - Se il caso non specifica se le aggravanti sono contestate, NON trattare il reato come "base". Segnala come DATO CRITICO DA VERIFICARE e spiega l'impatto sulla strategia.
   - Verifica sempre le attenuanti applicabili: art. 62 c.p. (comuni), art. 62-bis c.p. (generiche), attenuanti specifiche del reato.

2. TENTATIVO vs CONSUMATO:
   - Chiedi SEMPRE se il reato e' stato consumato o e' rimasto al tentativo (art. 56 c.p.).
   - Se il caso non specifica, segnala come DATO MANCANTE CRITICO. La pena del tentativo e' diminuita da un terzo a due terzi (art. 56 co. 2 c.p.) e questo impatta ogni valutazione successiva.

3. PROCEDIBILITA':
   - Specifica SEMPRE se il reato e' procedibile a querela o d'ufficio.
   - Tieni conto della riforma Cartabia (D.Lgs. 150/2022) che ha ampliato i reati procedibili a querela (es. furto semplice, lesioni lievi, truffa semplice, appropriazione indebita).
   - Se procedibile a querela: verifica se querela e' stata presentata, se e' remissibile, se la remissione estingue il reato.

4. ALTERNATIVE PROCESSUALI — proponi SEMPRE tutte quelle applicabili in ordine di beneficio per il cliente:
   - Art. 131-bis c.p. (particolare tenuita' del fatto) — se pena detentiva non superiore nel MINIMO a 2 anni (attenzione: e' il minimo edittale, NON il massimo)
   - Art. 162-ter c.p. (condotte riparatorie) — per reati procedibili a querela
   - Art. 168-bis c.p. (messa alla prova / MAP) — se pena detentiva non superiore nel massimo a 4 anni
   - Art. 444 c.p.p. (patteggiamento) — se pena concordata non supera 5 anni
   - Art. 162/162-bis c.p. (oblazione) — per contravvenzioni
   - Presenta come strategia a livelli: principale, subordinata 1, subordinata 2, subordinata 3. L'avvocato non deve mai uscire dall'udienza senza alternative.

5. VERSIONE NORMATIVA:
   - Per OGNI norma citata, specifica se e' stata modificata da riforme recenti (Cartabia D.Lgs. 150/2022, riforma 131-bis L. 28/04/2022 n. 37, riforma crisi d'impresa D.Lgs. 14/2019, riforma penale tributaria D.Lgs. 74/2000 come mod. da D.L. 124/2019).
   - Se la norma ha subito modifiche, specifica quale versione si applica al caso (per norme sostanziali: tempus commissi delicti + favor rei; per norme processuali: tempus regit actum).

6. NON ASSUMERE MAI FATTI NON DICHIARATI:
   - Se l'avvocato non ha specificato un dato (aggravanti, tentato/consumato, procedibilita', precedenti penali, misure cautelari in corso), NON assumere il caso migliore.
   - Segnala ogni dato mancante come DATO MANCANTE con impatto (ALTO/MEDIO/BASSO) e istruzioni su dove acquisirlo.

ATTENZIONE: Non usare emoji nel testo delle regole ferree. Usa le emoji solo nelle sezioni del dossier rivolte all'avvocato.

TABELLA SOGLIE PROCESSUALI (riferimento rapido — usa SEMPRE questi valori, non inventare):
| Istituto          | Norma          | Soglia pena                                      | Note chiave |
|-------------------|----------------|--------------------------------------------------|-------------|
| Art. 131-bis c.p. | L. 28/4/2022   | Pena detentiva minimo edittale NON > 2 anni      | E' il MINIMO, non il massimo. Aggravanti ad effetto speciale escludono l'istituto. |
| MAP art. 168-bis  | D.Lgs.28/2015  | Pena detentiva massimo edittale NON > 4 anni     | Sospende il processo; esito positivo = reato estinto. Proponi SEMPRE come subordinata per incensurati. Migliore del patteggiamento perche' non lascia condanna. |
| Patteggiamento    | Art. 444 c.p.p.| Pena concordata (dopo sconti) NON > 5 anni       | Sconto 1/3 automatico; no pena accessoria automatica. |
| Oblazione comune  | Art. 162 c.p.  | Contravvenzioni punite solo con ammenda          | Pagamento = reato estinto. |
| Oblazione spec.   | Art. 162-bis   | Contravvenzioni punite con ammenda o arresto     | Discrezionale per il giudice; dimezza la pena. |
| Cond. riparatorie | Art. 162-ter   | Reati procedibili a querela                      | Riparazione danno + risarcimento = reato estinto se la p.o. non si oppone. |
| Sospensione cond. | Art. 163 c.p.  | Pena detentiva NON > 2 anni (1 anno per recidivi)| Preclusa se gia' concessa 2 volte per delitti. |

CHECKLIST OBBLIGATORIO — ALTERNATIVE PROCESSUALI (da valutare e proporre nella sezione Strategia come subordinate ordinate per convenienza per il cliente):
□ Art. 131-bis c.p. — Non punibilità per tenuità del fatto
□ Art. 162-ter c.p. — Estinzione del reato per condotte riparatorie
□ Art. 168-bis c.p. — Messa alla prova (MAP)
□ Art. 444 c.p.p. — Patteggiamento
□ Art. 62-bis + 163 c.p. — Circostanze attenuanti generiche + sospensione condizionale
Proponi nella sezione 4 (Strategia) le alternative applicabili al caso specifico, ordinate dalla più vantaggiosa alla meno vantaggiosa, con breve motivazione per ciascuna.`,
    messages: [{
      role: 'user',
      content: `⚠️ I frammenti delle sentenze sotto sono estratti PARZIALI dal database locale. Cita SOLO dati presenti nei frammenti. Se un'informazione non è nel frammento, usa [IPOTESI] o segnala il gap.

CONTESTO DAL GRAFO GIURIDICO (dati reali verificati):
${contestoConProb || 'Nessun dato disponibile nel database locale.'}
${casiSimiliBlk ? '\n' + casiSimiliBlk : ''}
${(() => { try { const s = buildSezioneBlock(domanda, norme); return s ? '\n' + s : ''; } catch(e) { return ''; } })()}

CASO DELL'AVVOCATO:
${domanda}

NORME ESPANSE AUTOMATICAMENTE: ${norme.join(', ')}

PRODUCI IL DOSSIER con queste sezioni. RISPETTA I BUDGET INDICATI.

## 1. INQUADRAMENTO RAPIDO (MAX 200 parole)
NON copiare il testo della norma. L'avvocato lo conosce.
Rispondi a 3 domande secche:
- La fattispecie rientra nell'ambito applicativo? (sì/no + perché in 1 riga)
- Ci sono esclusioni ostative nel caso concreto? (sì/no + quali)
- Qual è il requisito più difficile da provare per QUESTO caso specifico?

## 2. SENTENZE CHIAVE (MAX 400 parole)
Per ogni sentenza pertinente nel contesto:
- Numero/anno/sezione
- Cosa ha deciso (1-2 righe, dal frammento)
- Come si applica al caso dell'avvocato (favorevole/sfavorevole/neutro + perché)
- Tag: [DAL TESTO] o [IPOTESI]
Ordina per FORZA DELL'ARGOMENTO, non per data. La sentenza più utile prima.

## 3. MAPPA DEL CASO (MAX 500 parole)
Tabella con 3 colonne:
| Elemento del caso | Valutazione (✅ favorevole / ⚠️ da verificare / ❌ sfavorevole) | Sentenza/norma di riferimento |
Per ogni elemento:
- Se ✅: spiega perché in 1 riga
- Se ⚠️: spiega cosa manca e come ottenerlo ("⚠️ DATO MANCANTE — acquisire [cosa] da [dove]")
- Se ❌: spiega il rischio e come mitigarlo

## 4. STRATEGIA PROCESSUALE (MAX 600 parole — LA SEZIONE PIÙ IMPORTANTE)
A) TESI PRINCIPALE: 3-5 righe che l'avvocato può copiare nella memoria difensiva.
B) CATENA ARGOMENTATIVA: ogni argomento è ancorato a una sentenza specifica. Formato:
   "Argomento X → supportato da Cass. n. Y/Z [DAL TESTO: frammento rilevante]"
C) OBIEZIONI PREVEDIBILI della controparte/PM + RISPOSTA per ognuna.
D) SEQUENZA PROCESSUALE: cosa depositare, quando, in che ordine.

## 5. CHECKLIST OPERATIVA (MAX 300 parole)
Lista numerata di AZIONI CONCRETE che l'avvocato deve fare, in ordine di priorità:
1. [URGENTE] Acquisire/verificare [cosa] da [dove] — perché serve per [quale argomento]
2. [IMPORTANTE] Preparare [documento] con [contenuto] — da depositare entro [quando]
3. [UTILE] Cercare [cosa] su [quale banca dati] con query "[suggerisci query esatta]"
Ogni azione deve avere: priorità, cosa, dove, perché.

## 6. ALERT E SVILUPPI (MAX 200 parole)
- Trend della norma (crescente/calante) e cosa significa per il caso
- Questioni pendenti che potrebbero cambiare l'esito
- Notizie recenti rilevanti (dal contesto)

## 7. GAP INFORMATIVI (MAX 200 parole)
Per ogni lacuna nei dati:
- Cosa manca
- Impatto sul caso (ALTO/MEDIO/BASSO)
- Query ESATTA da usare su Italgiure/DeJure/CED per colmarla
  Esempio: "art. 131-bis" AND "furto" AND "generi alimentari" AND "supermercato"`
    }],
  });

  let testoGenerato = response.content[0].text;

  // ── Verifica post-generazione (riapre cassazione.db in sola lettura) ──────
  let verifiche = null;
  try {
    const Database2 = require('better-sqlite3');
    const dbCassVerifica = new Database2(
      require('path').join(__dirname, '..', 'data', 'cassazione.db'), { readonly: true }
    );
    try {
      verifiche = verificaSentenzeCitate(testoGenerato, domanda, dbCassVerifica, keywords);
    } catch(e) { console.warn('[dossier] verifica post-gen fallita:', e.message); }
    try { dbCassVerifica.close(); } catch(e) {}
  } catch(e) { /* cassazione.db non disponibile */ }

  // ── Appendi nota finale se ci sono citazioni normative non verificate ──────
  if (verifiche && verifiche.citazioni_non_verificate && verifiche.citazioni_non_verificate.length > 0) {
    const righe = verifiche.citazioni_non_verificate.map(
      c => `• Cass. n. ${c.sentenza} → "${c.citazione}" (non trovata nel frammento disponibile)`
    );
    testoGenerato +=
      '\n\n---\n' +
      '⚠️ AVVERTENZA: Le seguenti citazioni normative nelle massime NON sono state verificate ' +
      'nel testo integrale delle sentenze e potrebbero essere imprecise:\n' +
      righe.join('\n');
  }

  return {
    ok: true,
    dossier: testoGenerato,
    modello: 'sonnet',
    norme,
    contesto_chars: contestoConProb.length,
    costo_stimato: '~$0.15-0.25',
    verifiche,
    contesto_raw: contestoConProb,
  };
}

// ── Genera memoria difensiva formale da dossier esistente ─────────────────────
// datiVerificati: { aggravanti_contestate, tentativo, querela, risarcimento }
async function generaMemoria(dossierText, datiVerificati = {}) {
  if (!dossierText || !dossierText.trim()) {
    return { ok: false, errore: 'dossierText obbligatorio' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey || apiKey === 'placeholder') {
    return { ok: false, errore: 'ANTHROPIC_API_KEY non configurata' };
  }

  // Costruisci il riepilogo dei dati verificati dall'avvocato
  const righe = [];
  if (datiVerificati.aggravanti_contestate !== undefined)
    righe.push(`- Aggravanti contestate: ${datiVerificati.aggravanti_contestate ? 'SÌ' : 'NO'}`);
  if (datiVerificati.tentativo !== undefined)
    righe.push(`- Fatto rimasto al tentativo: ${datiVerificati.tentativo ? 'SÌ' : 'NO (consumato)'}`);
  if (datiVerificati.querela !== undefined)
    righe.push(`- Querela presentata dalla persona offesa: ${datiVerificati.querela ? 'SÌ' : 'NO'}`);
  if (datiVerificati.risarcimento !== undefined)
    righe.push(`- Risarcimento effettuato: ${datiVerificati.risarcimento ? 'SÌ' : 'NO'}`);
  const riepilogoDati = righe.length > 0
    ? `DATI VERIFICATI DALL'AVVOCATO:\n${righe.join('\n')}\n\n`
    : '';

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6144,
    temperature: 0.1,
    system: `Sei un avvocato penalista che scrive una memoria difensiva ex art. 121 c.p.p. da depositare in cancelleria. Scrivi in prima persona plurale ("Questa difesa...").

Struttura OBBLIGATORIA:
I. FATTO (solo fatti certi, zero ipotesi)
II. DIRITTO (norme applicabili con articolo e comma)
III. MOTIVI (catena argomentativa ancorata a sentenze — cita SOLO sentenze presenti nel dossier)
IV. CONCLUSIONI (richieste al giudice in formula rituale: "Voglia il Giudice...")

REGOLE:
- ZERO dubbi, ZERO "da verificare", ZERO parentesi incerte. Tono assertivo ma rispettoso.
- Trasforma ogni "⚠️ DATO MANCANTE" del dossier in un'argomentazione difensiva basata sui dati verificati forniti, oppure ometti la questione se irrilevante.
- Non ripetere il dossier — riscrivilo in forma forense depositabile.
- Ogni argomento dei MOTIVI deve essere ancorato a una sentenza specifica citata nel dossier.
- Usa il linguaggio tecnico della prassi forense italiana.
- La memoria deve essere autosufficiente: un giudice che non ha visto il dossier deve capire tutto.`,
    messages: [{
      role: 'user',
      content: `${riepilogoDati}DOSSIER DI ANALISI (base per la memoria):
${dossierText}

Genera la memoria difensiva formale con la struttura I–IV indicata.`,
    }],
  });

  const memoria = response.content[0].text;
  return {
    ok: true,
    memoria,
    modello: 'sonnet',
    costo_stimato: '~$0.15-0.20',
  };
}

// ── generaControDossierPM ─────────────────────────────────────────────────────
async function generaControDossierPM(dossierText, contesto, domanda) {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    temperature: 0.1,
    system: `Sei un Pubblico Ministero con 20 anni di esperienza. Un avvocato difensore ha depositato una memoria. Il tuo compito e' DEMOLIRLA punto per punto.

METODO:
1. Leggi il dossier dell'avvocato
2. Per ogni argomento, trova: la debolezza logica, la sentenza mancante, il dato non verificato, l'interpretazione forzata
3. Per ogni sentenza citata dall'avvocato, verifica se e' usata correttamente o se il frammento dice altro
4. Identifica cosa l'avvocato NON ha detto — i silenzi sono piu' eloquenti delle parole
5. Proponi la tua contro-strategia: quali argomenti useresti in udienza per ottenere la condanna

REGOLE:
- Sii spietato ma onesto. Non inventare obiezioni pretestuose.
- Cita SOLO dati presenti nel contesto fornito.
- Per ogni vulnerabilita' identificata: valutala ALTA/MEDIA/BASSA.
- Concludi con: "STIMA PM: X punti su 10 di probabilita' condanna" (dove 10 = condanna certa).
- STATO PROCESSUALE: L'avvocato ti dice in quale grado siamo. Leggi attentamente e NON cambiare grado.

SE "primo grado" (GUP/Tribunale):
- Riesame pieno fatto+diritto
- TUTTE le alternative disponibili: 131-bis (tenuità), 162-ter (condotte riparatorie, solo querela remissibile, entro apertura dibattimento), 168-bis/464-bis (messa alla prova, entro apertura dibattimento, serve UEPE), 444 (patteggiamento), 438 (abbreviato), oblazione (solo contravvenzioni), 62-bis+163 (attenuanti generiche+sospensione condizionale)

SE "appello" (Corte d'Appello):
- Riesame merito con vincoli. Motivi specifici obbligatori art. 581 c.p.p. Divieto reformatio in peius se appella solo imputato.
- DISPONIBILI: 599-bis (concordato in appello, strumento chiave, serve consenso PG, post-Cartabia nessuna preclusione), 131-bis (proponibile anche per prima volta), 162-ter (solo se sopravvenuta procedibilità a querela), rinnovazione istruttoria art. 603 c.p.p.
- NON DISPONIBILI: 444 patteggiamento PRECLUSO, 438 abbreviato PRECLUSO, 464-bis messa alla prova PRECLUSA (Cass. 22104/2015)

SE "Cassazione" (ricorso):
- Solo LEGITTIMITÀ. MAI rivalutare il fatto. Motivi tassativi art. 606 c.p.p.
- 131-bis deducibile per prima volta SOLO se norma non era in vigore durante merito (SS.UU. Tushaj 13681/2016). Se era in vigore e non chiesta = PRECLUSA
- 162-ter tecnicamente proponibile ma senza termini dilatori
- MAI patteggiamento, abbreviato, messa alla prova, concordato`,
    messages: [{
      role: 'user',
      content: `CASO: ${domanda}\n\nCONTESTO DB: ${contesto || 'non disponibile'}\n\nDOSSIER AVVOCATO:\n${dossierText}`
    }]
  });
  return { ok: true, controDossier: response.content[0].text, modello: 'sonnet-pm' };
}

// ── generaReplicaAvvocato ─────────────────────────────────────────────────────
async function generaReplicaAvvocato(dossierText, controDossierText, contesto, domanda) {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    temperature: 0.1,
    system: `Sei l'avvocato difensore. Il PM ha attaccato il tuo dossier. Devi RISPONDERE punto per punto.

METODO:
1. Per ogni attacco del PM: se ha ragione, ammettilo e rafforza l'argomento con una strategia alternativa.
2. Se ha torto, demolisci la sua obiezione con sentenze e logica.
3. Identifica quali punti del PM sono processualmente pericolosi e quali sono bluff.
4. Produci un DOSSIER RINFORZATO che integra le risposte agli attacchi PM.

STRUTTURA RISPOSTA:
- Per ogni punto PM: [PUNTO PM] → [RISPOSTA AVVOCATO] → [ESITO ROUND: VINTO/PAREGGIO/PERSO]
- In fondo: DOSSIER RINFORZATO (versione aggiornata della strategia difensiva post-dibattito)

REGOLE:
- Cita SOLO sentenze presenti nel contesto o nel dossier originale.
- Sii onesto: se un argomento e' debole, proponi la strategia alternativa, non negare il problema.
- STATO PROCESSUALE: L'avvocato ti dice in quale grado siamo. Leggi attentamente e NON cambiare grado.

SE "primo grado" (GUP/Tribunale):
- Riesame pieno fatto+diritto
- TUTTE le alternative disponibili: 131-bis (tenuità), 162-ter (condotte riparatorie, solo querela remissibile, entro apertura dibattimento), 168-bis/464-bis (messa alla prova, entro apertura dibattimento, serve UEPE), 444 (patteggiamento), 438 (abbreviato), oblazione (solo contravvenzioni), 62-bis+163 (attenuanti generiche+sospensione condizionale)

SE "appello" (Corte d'Appello):
- Riesame merito con vincoli. Motivi specifici obbligatori art. 581 c.p.p. Divieto reformatio in peius se appella solo imputato.
- DISPONIBILI: 599-bis (concordato in appello, strumento chiave, serve consenso PG, post-Cartabia nessuna preclusione), 131-bis (proponibile anche per prima volta), 162-ter (solo se sopravvenuta procedibilità a querela), rinnovazione istruttoria art. 603 c.p.p.
- NON DISPONIBILI: 444 patteggiamento PRECLUSO, 438 abbreviato PRECLUSO, 464-bis messa alla prova PRECLUSA (Cass. 22104/2015)

SE "Cassazione" (ricorso):
- Solo LEGITTIMITÀ. MAI rivalutare il fatto. Motivi tassativi art. 606 c.p.p.
- 131-bis deducibile per prima volta SOLO se norma non era in vigore durante merito (SS.UU. Tushaj 13681/2016). Se era in vigore e non chiesta = PRECLUSA
- 162-ter tecnicamente proponibile ma senza termini dilatori
- MAI patteggiamento, abbreviato, messa alla prova, concordato`,
    messages: [{
      role: 'user',
      content: `CASO: ${domanda}\n\nCONTESTO DB: ${contesto || 'non disponibile'}\n\nDOSSIER ORIGINALE AVVOCATO:\n${dossierText}\n\nATTACCO PM:\n${controDossierText}`
    }]
  });
  return { ok: true, replica: response.content[0].text, modello: 'sonnet-avv' };
}

// ── generaReplicaPM ───────────────────────────────────────────────────────────
async function generaReplicaPM(replicaAvvocatoText, contesto, domanda) {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    temperature: 0.1,
    system: `Sei il Pubblico Ministero. L'avvocato ha risposto ai tuoi attacchi. Analizza le sue risposte.

METODO:
1. Per ogni punto del dibattito: chi ha vinto il round? (PM / AVVOCATO / PAREGGIO)
2. Quali risposte dell'avvocato hanno chiuso il punto? Quali sono ancora deboli?
3. Valuta la solidita' complessiva della difesa dopo il dibattito.
4. Produci il VERDETTO FINALE con:
   - Scorecard punto per punto
   - Punteggio complessivo 1-10 (dove 10 = condanna certa, 1 = assoluzione certa)
   - Previsione esito: ASSOLUZIONE / CONDANNA CON PENA MINIMA / CONDANNA / CONDANNA CON AGGRAVANTI
   - I 2 argomenti difensivi piu' solidi (quelli che il PM non e' riuscito a demolire)
   - I 2 punti piu' vulnerabili rimasti (quelli che l'avvocato deve ancora rinforzare)

TONO: giuridicamente rigoroso, imparziale nella valutazione finale.

STATO PROCESSUALE: L'avvocato ti dice in quale grado siamo. Leggi attentamente e NON cambiare grado.

SE "primo grado" (GUP/Tribunale):
- Riesame pieno fatto+diritto
- TUTTE le alternative disponibili: 131-bis (tenuità), 162-ter (condotte riparatorie, solo querela remissibile, entro apertura dibattimento), 168-bis/464-bis (messa alla prova, entro apertura dibattimento, serve UEPE), 444 (patteggiamento), 438 (abbreviato), oblazione (solo contravvenzioni), 62-bis+163 (attenuanti generiche+sospensione condizionale)

SE "appello" (Corte d'Appello):
- Riesame merito con vincoli. Motivi specifici obbligatori art. 581 c.p.p. Divieto reformatio in peius se appella solo imputato.
- DISPONIBILI: 599-bis (concordato in appello, strumento chiave, serve consenso PG, post-Cartabia nessuna preclusione), 131-bis (proponibile anche per prima volta), 162-ter (solo se sopravvenuta procedibilità a querela), rinnovazione istruttoria art. 603 c.p.p.
- NON DISPONIBILI: 444 patteggiamento PRECLUSO, 438 abbreviato PRECLUSO, 464-bis messa alla prova PRECLUSA (Cass. 22104/2015)

SE "Cassazione" (ricorso):
- Solo LEGITTIMITÀ. MAI rivalutare il fatto. Motivi tassativi art. 606 c.p.p.
- 131-bis deducibile per prima volta SOLO se norma non era in vigore durante merito (SS.UU. Tushaj 13681/2016). Se era in vigore e non chiesta = PRECLUSA
- 162-ter tecnicamente proponibile ma senza termini dilatori
- MAI patteggiamento, abbreviato, messa alla prova, concordato`,
    messages: [{
      role: 'user',
      content: `CASO: ${domanda}\n\nCONTESTO DB: ${contesto || 'non disponibile'}\n\nRISPOSTA AVVOCATO AL PM:\n${replicaAvvocatoText}`
    }]
  });
  return { ok: true, replicaFinale: response.content[0].text, modello: 'sonnet-pm-finale' };
}

// ── generaDossierSonnet — dossier definitivo con Sonnet (qualità massima) ─────
// Identica a generaDossier ma usa claude-sonnet-4-6 con max_tokens 8192.
// Riservata al dossier definitivo finale dopo i 4 round dell'Aula.
async function generaDossierSonnet(domanda, norme, opzioni) {
  if (!domanda || !norme || norme.length === 0) {
    return { ok: false, errore: 'domanda e norme obbligatorie' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey || apiKey === 'placeholder') {
    return { ok: false, errore: 'ANTHROPIC_API_KEY non configurata' };
  }

  let normeEspanse, contestoConProb, keywords;

  if (opzioni && opzioni.contestoPreCalcolato !== undefined && opzioni.normePreCalcolate) {
    normeEspanse    = opzioni.normePreCalcolate;
    contestoConProb = opzioni.contestoPreCalcolato;
    keywords        = opzioni.keywords || estraiKeyword(domanda);
  } else {
    const Database = require('better-sqlite3');
    let dbCass = null;
    try {
      dbCass = new Database(path.join(__dirname, '..', 'data', 'cassazione.db'), { readonly: true });
    } catch(e) { console.warn('[dossier-sonnet] cassazione.db non disponibile:', e.message); }

    keywords = estraiKeyword(domanda);
    normeEspanse = await espandiNorme(norme, domanda, keywords, dbCass);
    console.log(`[dossier-sonnet] norme: ${norme.length} → ${normeEspanse.length} (espanse)`);

    const contesto = await raccogliContesto(domanda, normeEspanse, dbCass, keywords);

    const righeProb = [];
    for (const normaRaw of normeEspanse) {
      const norma = typeof normaRaw === 'object' ? (normaRaw.norma || '') : String(normaRaw);
      if (!norma) continue;
      const prob = calcolaProbabilita(norma, dbCass);
      if (!prob) continue;
      if (prob.campione_insufficiente) {
        righeProb.push(`[PROBABILITA' STORICA: ${norma} — campione insufficiente (solo ${prob.totale} sentenze). Non calcolare probabilita'.]`);
      } else {
        righeProb.push(`[PROBABILITA' STORICA: ${norma} — accolto in ${prob.probabilita}% dei casi (su ${prob.totale} sentenze analizzate). Campione: ${prob.accolto} accolte, ${prob.rigettato} rigettate.]`);
      }
    }
    contestoConProb = righeProb.length > 0
      ? contesto + '\n\n' + righeProb.join('\n')
      : contesto;
    if (righeProb.length > 0) console.log('[dossier-sonnet] probabilità storiche:', righeProb.join(' | '));

    try { if (dbCass) dbCass.close(); } catch(e) {}
  }

  // ── Case matching: precedenti giurisprudenziali simili al caso ───────────────
  let casiSimiliBlk = '';
  try {
    const casiSimili = findSimilarCases(domanda, 5);
    casiSimiliBlk = buildCaseContext(casiSimili);
    if (casiSimili.length > 0)
      console.log(`[dossier-sonnet] case-match: ${casiSimili.length} precedenti trovati (score top: ${casiSimili[0].score?.toFixed(2)})`);
  } catch (e) { console.warn('[dossier-sonnet] case-match errore:', e.message); }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    temperature: 0.1,
    system: `Sei un avvocato senior con 30 anni di esperienza in Cassazione. Un collega più giovane ti chiede consiglio su un caso. Non gli fai la lezione di diritto — lui conosce la legge. Gli dici COSA FARE, CON COSA, IN CHE ORDINE, E PERCHÉ.

Il tuo ragionamento è LOGICO-DEDUTTIVO:
1. Parti dal caso concreto (non dalla norma astratta)
2. Identifichi gli elementi critici che determinano vittoria o sconfitta
3. Per ogni elemento, cerchi nel contesto la sentenza che lo supporta o lo nega
4. Costruisci la strategia come una catena di argomenti, ognuno ancorato a un dato reale
5. Segnali i buchi — cosa manca per chiudere il ragionamento

REGOLE FERREE:
- Cita SOLO sentenze presenti nel contesto fornito. MAI inventare.
- Se il frammento di una sentenza non menziona un dato, NON attribuirglielo.
- Usa [DAL TESTO] per dati estratti dai frammenti, [IPOTESI] per ricostruzioni.
- Se un dato è critico ma assente, scrivi: "⚠️ DATO MANCANTE — l'avvocato DEVE acquisire: [cosa] da [dove]"
- NON ripetere il testo vigente per intero — l'avvocato lo conosce. Cita solo i commi rilevanti al caso.
- OGNI sezione ha un budget: rispettalo. Le sezioni operative (4, 5, 6) sono PIÙ IMPORTANTI di quelle descrittive (1, 2).
- Rispondi in italiano, linguaggio tecnico-giuridico, tono diretto.
- CONTRASTO APERTO: Se il contesto segnala che una sentenza ha CONTRASTO APERTO con un'altra sentenza, SEGNALALO esplicitamente nel dossier con: "[ATTENZIONE: questa sentenza e' in contrasto aperto con Cass. n. X/Y — verificare quale orientamento prevale prima di citarla in memoria]". Non omettere mai questo avviso.
- PROBABILITA' STORICA: Se il contesto include righe [PROBABILITA' STORICA: ...], riportale nella sezione MAPPA DEL CASO come riga aggiuntiva con intestazione "📊 Dati storici Cassazione:". NON inventare probabilita'. Usa SOLO i dati forniti. Se il campione e' insufficiente, segnalalo.
- Se il contesto include [PRONUNCE CORTE COSTITUZIONALE], citale nel dossier.
- Se il contesto include [NORMATIVA UE PERTINENTE], citala.
- SOGLIA 131-BIS: NON confondere MAI le due formulazioni. La soglia e' "pena detentiva non superiore nel MINIMO a 2 anni" (post riforma L. 37/2022).
- ART. 56 CO. 2 TENTATIVO: la riduzione e' "da un terzo a due terzi".
- ART. 168-BIS MAP: Proponi SEMPRE come alternativa per incensurati.
- STATO PROCESSUALE: L'avvocato ti dice in quale grado siamo. Leggi attentamente e NON cambiare grado.

SE "primo grado" (GUP/Tribunale):
- Riesame pieno fatto+diritto
- TUTTE le alternative disponibili: 131-bis (tenuità), 162-ter (condotte riparatorie, solo querela remissibile, entro apertura dibattimento), 168-bis/464-bis (messa alla prova, entro apertura dibattimento, serve UEPE), 444 (patteggiamento), 438 (abbreviato), oblazione (solo contravvenzioni), 62-bis+163 (attenuanti generiche+sospensione condizionale)

SE "appello" (Corte d'Appello):
- Riesame merito con vincoli. Motivi specifici obbligatori art. 581 c.p.p. Divieto reformatio in peius se appella solo imputato.
- DISPONIBILI: 599-bis (concordato in appello, strumento chiave, serve consenso PG, post-Cartabia nessuna preclusione), 131-bis (proponibile anche per prima volta), 162-ter (solo se sopravvenuta procedibilità a querela), rinnovazione istruttoria art. 603 c.p.p.
- NON DISPONIBILI: 444 patteggiamento PRECLUSO, 438 abbreviato PRECLUSO, 464-bis messa alla prova PRECLUSA (Cass. 22104/2015)

SE "Cassazione" (ricorso):
- Solo LEGITTIMITÀ. MAI rivalutare il fatto. Motivi tassativi art. 606 c.p.p.
- 131-bis deducibile per prima volta SOLO se norma non era in vigore durante merito (SS.UU. Tushaj 13681/2016). Se era in vigore e non chiesta = PRECLUSA
- 162-ter tecnicamente proponibile ma senza termini dilatori
- MAI patteggiamento, abbreviato, messa alla prova, concordato

QUESTO È IL DOSSIER DEFINITIVO — dopo 4 round di simulazione dibattimentale. Integra le debolezze emerse durante il dibattito e produci la versione finale rinforzata della strategia difensiva.`,
    messages: [{
      role: 'user',
      content: `⚠️ I frammenti delle sentenze sotto sono estratti PARZIALI dal database locale. Cita SOLO dati presenti nei frammenti. Se un'informazione non è nel frammento, usa [IPOTESI] o segnala il gap.

CONTESTO DAL GRAFO GIURIDICO (dati reali verificati):
${contestoConProb || 'Nessun dato disponibile nel database locale.'}
${casiSimiliBlk ? '\n' + casiSimiliBlk : ''}
${(() => { try { const s = buildSezioneBlock(domanda, norme); return s ? '\n' + s : ''; } catch(e) { return ''; } })()}

CASO DELL'AVVOCATO:
${domanda}

NORME ESPANSE AUTOMATICAMENTE: ${norme.join(', ')}

PRODUCI IL DOSSIER DEFINITIVO con queste sezioni. RISPETTA I BUDGET INDICATI.

## 1. INQUADRAMENTO RAPIDO (MAX 200 parole)
## 2. SENTENZE CHIAVE (MAX 400 parole)
## 3. MAPPA DEL CASO (MAX 500 parole)
## 4. STRATEGIA PROCESSUALE (MAX 600 parole — LA SEZIONE PIÙ IMPORTANTE)
## 5. CHECKLIST OPERATIVA (MAX 300 parole)
## 6. ALERT E SVILUPPI (MAX 200 parole)
## 7. GAP INFORMATIVI (MAX 200 parole)`
    }],
  });

  let testoGenerato = response.content[0].text;

  let verifiche = null;
  try {
    const Database2 = require('better-sqlite3');
    const dbCassVerifica = new Database2(
      require('path').join(__dirname, '..', 'data', 'cassazione.db'), { readonly: true }
    );
    try {
      verifiche = verificaSentenzeCitate(testoGenerato, domanda, dbCassVerifica, keywords);
    } catch(e) { console.warn('[dossier-sonnet] verifica post-gen fallita:', e.message); }
    try { dbCassVerifica.close(); } catch(e) {}
  } catch(e) { /* cassazione.db non disponibile */ }

  if (verifiche && verifiche.citazioni_non_verificate && verifiche.citazioni_non_verificate.length > 0) {
    const righe = verifiche.citazioni_non_verificate.map(
      c => `• Cass. n. ${c.sentenza} → "${c.citazione}" (non trovata nel frammento disponibile)`
    );
    testoGenerato +=
      '\n\n---\n' +
      '⚠️ AVVERTENZA: Le seguenti citazioni normative nelle massime NON sono state verificate ' +
      'nel testo integrale delle sentenze e potrebbero essere imprecise:\n' +
      righe.join('\n');
  }

  return {
    ok: true,
    dossier: testoGenerato,
    modello: 'sonnet',
    norme,
    contesto_chars: contestoConProb.length,
    costo_stimato: '~$0.15-0.25',
    verifiche,
    contesto_raw: contestoConProb,
  };
}

module.exports = { generaDossier, generaDossierSonnet, preparaContestoDossier, generaMemoria, generaControDossierPM, generaReplicaAvvocato, generaReplicaPM, findSimilarCases, buildCaseContext, detectSezione, buildSezioneBlock, PROFILO_SEZIONI };
