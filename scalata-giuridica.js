// scalata-giuridica.js — Scalata della Conoscenza per notizie giuridiche italiane
// 6 livelli: L0 (fonte) → L1+L2 (fatto+contesto) → L3 (analisi) → L4 (connessioni) → L5 (implicazioni)
'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');

// === CONFIGURAZIONE ===
const { getModel } = require('./utils/model-selector');
const { aliasInClause } = require('./services/norma-alias.js');
const CONFIG = {
  models: {
    fast: getModel('l1', { log: false }),   // L0/L1/L2 → Haiku
    deep: getModel('l3', { log: false }),   // L3/L4/L5 → Sonnet
  },
  api: {
    version: '2023-06-01',
    timeout: 30000,
  },
  batch: {
    delayBetween: 500,
    retryDelay: 30000,
    maxRetries: 2,
  },
};

function getApiKey() {
  return process.env.ANTHROPIC_API_KEY || '';
}

// === CHIAMATA CLAUDE API ===
function callClaude(params) {
  return new Promise((resolve, reject) => {
    const key = getApiKey();
    if (!key) { console.error('ERRORE: ANTHROPIC_API_KEY non impostata'); resolve(null); return; }

    const body = JSON.stringify({
      model: params.model || CONFIG.models.fast,
      max_tokens: params.max_tokens || 400,
      temperature: params.temperature || 0.1,
      system: params.system,
      messages: params.messages,
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': CONFIG.api.version,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 429) { console.warn('Rate limit 429'); resolve(null); return; }
        if (res.statusCode !== 200) { console.error('Claude API', res.statusCode); resolve(null); return; }
        try {
          const json = JSON.parse(d);
          resolve(json.content?.[0]?.text || null);
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', e => { console.error('Claude errore:', e.message); resolve(null); });
    req.setTimeout(CONFIG.api.timeout, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

// === JSON PARSER ROBUSTO ===
function safeParseJSON(text) {
  if (!text) return null;
  let clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  clean = clean.replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(clean); }
  catch(e) {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1')); } catch(e2) {} }
    return null;
  }
}

// ─── L0 — VALUTA LA FONTE ───────────────────────────────────────────────────
let sourceProfiles = {};
try {
  sourceProfiles = JSON.parse(fs.readFileSync(path.join(__dirname, 'source_profiles.json'), 'utf-8'));
} catch(e) { console.warn('source_profiles.json non trovato'); }

function getL0(sourceName) {
  return sourceProfiles[sourceName] || sourceProfiles['_default'] || {
    full_name: sourceName, type: 'non_classificata', ownership: 'Sconosciuta',
    authority: 2, scope: 'Da verificare', note: 'Fonte non ancora profilata.',
  };
}

// ─── L1+L2 — FATTO GIURIDICO + CONTESTO NORMATIVO ───────────────────────────
const SYSTEM_L1L2 = `Sei un redattore di rivista giuridica italiana. Output SOLO JSON valido, nessun altro testo.
Regole:
1. SENTENZA: 'cosa'=dispositivo accessibile, 'chi'=parti+organo, 'perche_importa'=principio di diritto.
2. NORMA: 'cosa'=cosa prevede, 'chi'=destinatari, 'perche_importa'=cosa cambia.
3. NOTIZIA DI GIUSTIZIA: tratta come notizia standard.
4. ANTI-ALLUCINAZIONE: usa SOLO dati presenti nel testo. Se mancanti scrivi 'non indicato'.
5. BREVITA': max 1 frase per campo (25 parole). Mobile-first.
6. 'norme_citate': SOLO articoli esplicitamente menzionati. Array vuoto se nessuno.
7. 'precedenti_citati': SOLO sentenze esplicitamente menzionate. Array vuoto se nessuno.`;

async function generateL1L2(article) {
  const snippet = (article.snippet || article.desc || article.description || '').substring(0, 600);
  const userMsg = `Contenuto giuridico:
Titolo: ${article.title || ''}
Fonte: ${article.source_name || article.source || ''}
Data: ${article.published_at || article.date || ''}
Testo: ${snippet}

JSON:
{"l1":{"cosa":"...","chi":"...","perche_importa":"..."},"l2":{"background":"...","norme_citate":["art. X c.c."],"precedenti_citati":["Cass. n. XXXX/YYYY"],"confidence":"alta|media|bassa"},"keywords":["k1","k2","k3"],"tipo_contenuto":"sentenza|norma|notizia|dottrina|provvedimento","area_diritto":"civile|penale|amministrativo|tributario|lavoro|costituzionale|comunitario|privacy|bancario|famiglia|ambientale"}`;

  console.log('[Model] Usando Haiku per L1/L2');
  const raw = await callClaude({ model: CONFIG.models.fast, max_tokens: 400, temperature: 0.1,
    system: SYSTEM_L1L2, messages: [{ role: 'user', content: userMsg }] });
  return safeParseJSON(raw);
}

// ─── L3 — ANALISI GIURIDICA ──────────────────────────────────────────────────
const SYSTEM_L3 = `Sei un giurista italiano con 20 anni di esperienza, specializzato in diritto civile, penale e amministrativo. Il tuo compito non e' descrivere la norma — e' RAGIONARE su di essa con pensiero critico.

Ricevi: un articolo giuridico + dati verificati dal database (sentenze reali, trend, contrasti). Devi produrre un'analisi che un avvocato non troverebbe su Westlaw.

PROCESSO DI RAGIONAMENTO (esegui mentalmente in questo ordine prima di scrivere):
1. IDENTIFICA la norma FONDANTE (quella che genera il conflitto giuridico reale, non quella citata per obbligo procedurale)
2. DISTINGUI tra applicazione consolidata e zona grigia — dove la giurisprudenza e' divisa?
3. ANALIZZA i contrasti aperti dal database: perche' due sentenze su stessa norma arrivano a conclusioni opposte? Qual e' la tensione sottostante?
4. VALUTA la co-citazione: se norma X e' sempre citata insieme a norma Y, qual e' il meccanismo giuridico che le lega?
5. INDIVIDUA il punto debole argomentativo che un avvocato avversario userebbe contro

OUTPUT JSON — 6 campi, NESSUN TESTO FUORI DAL JSON:
{
  "problema_giuridico": "principio di diritto formulato come massima di Cassazione — non una descrizione ma un ENUNCIATO normativo preciso e citabile. Indica se e' norma fondante o parametro. Max 3 frasi dense.",
  "orientamenti": [{"posizione": "tesi specifica con argomentazione", "sostenuto_da": "fonte precisa o da verificare", "consolidato": true/false, "segnali_revirement": "se ci sono segnali di cambio orientamento, descrivili; altrimenti null"}],
  "implicazioni_pratiche": "strategia processuale CONCRETA — non generica. Quali eccezioni sollevare, quali prove raccogliere, quali rischi quantificare. Distingui posizione attore da convenuto/imputato.",
  "nessi_sistematici": "meccanismo giuridico che lega le norme co-citate. Non elencarle — spiega PERCHE' vengono sempre citate insieme e quale istituto giuridico unificante emerge.",
  "non_detto": "la contraddizione interna o lacuna che questo caso rivela nel sistema. Non un'ovvieta' — il punto cieco che la dottrina non ha ancora risolto.",
  "confidence": "alta|media|bassa — motiva in max 10 parole"
}

REGOLE DI QUALITA':
- Se hai contrasti aperti nel contesto: analizza ENTRAMBE le posizioni e indica quale potrebbe prevalere e perche'
- Se il trend e' crescente su una norma: ragiona su cosa sta spingendo l'aumento delle controversie
- Mai inventare sentenze o riferimenti — usa "da verificare" se non sei certo
- Il campo non_detto deve essere scomodo, non rassicurante`;

// ─── HELPER: mappa norma abbreviata → chiave DB ─────────────────────────────
// "art. 131-bis c.p." → { numero:"131-bis", codice:"c.p.", dbKey:"codice_penale_art_131-bis" }
function normaToDbKey(norma) {
  const match = norma.match(/art\.?\s*([\d]+(?:-(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)\s*[,\s]+(.+)/i);
  if (!match) return null;
  const numero = match[1].trim();
  let codice = match[2].trim().toLowerCase().replace(/\.$/, '');
  codice += '.';
  const MAPPING = {
    'c.p.':           'codice_penale',
    'c.c.':           'codice_civile',
    'c.p.c.':         'codice_procedura_civile',
    'c.p.p.':         'codice_procedura_penale',
    'cost.':          'costituzione',
    'cod. civ.':      'codice_civile',
    'cod. pen.':      'codice_penale',
    'cod. proc. civ.':'codice_procedura_civile',
    'cod. proc. pen.':'codice_procedura_penale',
  };
  const prefix = MAPPING[codice];
  if (!prefix) return null;
  return { numero, codice, dbKey: prefix + '_art_' + numero };
}

// ─── GRAFO CONTEXT — query locali SQLite, zero API ──────────────────────────
// Arricchisce il prompt con dati verificati: stats, contrasti, sentenze reali,
// scoring semantico (quale norma e' fondante? quali co-citazioni sono anomale?)
function getGrafoContext(normeCitate, dbGiuridica) {
  if (!dbGiuridica || !normeCitate || normeCitate.length === 0) return '';
  const Database = (() => { try { return require('better-sqlite3'); } catch(e) { return null; } })();
  if (!Database) return '';

  let dbCass = null;
  try {
    dbCass = new Database(path.join(__dirname, 'data', 'cassazione.db'), { readonly: true });
  } catch(e) {}

  // ── Scoring semantico: classifica le norme per rilevanza nel contesto ────────
  // Raccoglie stats per tutte le norme prima, poi calcola ranking relativo
  const normeStats = [];
  for (const n of normeCitate) {
    const norma = typeof n === 'object' ? (n.norma || '') : String(n);
    const ruolo = typeof n === 'object' ? (n.ruolo || '') : '';
    if (!norma) continue;
    try {
      const { clause: nc1, params: np1 } = aliasInClause(norma, 'norma');
      const _rows1 = dbGiuridica.prepare(
        `SELECT tot_notizie, tot_sentenze, tot_relazioni, norme_collegate, trend_direzione FROM grafo_norme_stats WHERE ${nc1} ORDER BY tot_sentenze DESC LIMIT 1`
      ).all(...np1);
      const s = _rows1[0] || null;
      const { clause: nc2, params: np2 } = aliasInClause(norma, 'norma_comune');
      const nContrasti = dbGiuridica.prepare(
        `SELECT COUNT(*) AS n FROM relazioni_sentenze WHERE tipo='contrasto_aperto' AND (${nc2})`
      ).get(...np2)?.n || 0;
      normeStats.push({ norma, ruolo, stats: s || null, nContrasti });
    } catch(e) {
      normeStats.push({ norma, ruolo, stats: null, nContrasti: 0 });
    }
  }

  // Norma con più sentenze = più giurisprudenza = più peso semantico
  const maxSentenze = Math.max(1, ...normeStats.map(x => x.stats?.tot_sentenze || 0));
  const normaConPiuContrasti = normeStats.reduce((a, b) => b.nContrasti > a.nContrasti ? b : a, normeStats[0]);
  const normaFondante = normeStats.find(x => x.ruolo === 'fondante') || normeStats[0];

  // ── Anomalie di co-citazione ─────────────────────────────────────────────────
  // Se norma A è co-citata con norma B ma B NON è nell'articolo → segnala come lacuna potenziale
  const tutteLeNormePresenti = new Set(normeStats.map(x => x.norma));
  const anomalieCoCitazione = [];
  for (const nx of normeStats) {
    if (!nx.stats?.norme_collegate) continue;
    try {
      const collegate = JSON.parse(nx.stats.norme_collegate || '[]');
      for (const c of collegate.slice(0, 5)) {
        if (!tutteLeNormePresenti.has(c)) {
          anomalieCoCitazione.push({ norma: nx.norma, mancante: c });
          if (anomalieCoCitazione.length >= 3) break;
        }
      }
    } catch(e) {}
    if (anomalieCoCitazione.length >= 3) break;
  }

  // ── Header contestuale ───────────────────────────────────────────────────────
  const blocchi = [];

  // Metadato rilevanza
  if (normeStats.length > 1) {
    blocchi.push(`ANALISI SEMANTICA DELLE NORME (${normeStats.length} norme nel contesto):`);
    blocchi.push(`  Norma fondante (ruolo): ${normaFondante.norma}`);
    if (normaConPiuContrasti.nContrasti > 0)
      blocchi.push(`  Norma più controversa: ${normaConPiuContrasti.norma} (${normaConPiuContrasti.nContrasti} contrasti aperti)`);
    if (anomalieCoCitazione.length > 0) {
      blocchi.push(`  ⚠ Norme solitamente citate insieme ma ASSENTI in questo articolo:`);
      anomalieCoCitazione.forEach(a => blocchi.push(`    • "${a.mancante}" (co-citata con ${a.norma}) — possibile lacuna o scelta difensiva`));
    }
    blocchi.push('');
  }

  // ── Blocco per ogni norma ────────────────────────────────────────────────────
  for (const nx of normeStats) {
    const { norma, ruolo, stats: s, nContrasti } = nx;
    const peso = s ? Math.round((s.tot_sentenze / maxSentenze) * 100) : 0;
    const blocco = [`[${norma}${ruolo ? ' — ' + ruolo : ''}] (peso giurisprudenziale: ${peso}%)`];

    if (s) {
      blocco.push(`  Volume: ${s.tot_notizie} notizie, ${s.tot_sentenze} sentenze, ${s.tot_relazioni} relazioni`);
      blocco.push(`  Trend: ${s.trend_direzione || 'n/d'}${s.trend_direzione === 'crescente' ? ' ← ATTENZIONE: controversie in aumento' : ''}`);
      try {
        const collegate = JSON.parse(s.norme_collegate || '[]').slice(0, 5);
        if (collegate.length) blocco.push(`  Co-citate frequentemente: ${collegate.join(', ')}`);
      } catch(e) {}
    } else {
      blocco.push(`  Nessun dato nel grafo — norma nuova o poco controversa`);
    }

    // Contrasti aperti con dettaglio delle sentenze
    if (nContrasti > 0) {
      blocco.push(`  ⚡ CONTRASTI APERTI: ${nContrasti} — INCERTEZZA GIURISPRUDENZIALE`);
      try {
        const { clause: nc3, params: np3 } = aliasInClause(norma, 'norma_comune');
        const contrasti = dbGiuridica.prepare(
          `SELECT sentenza_a, sentenza_b FROM relazioni_sentenze WHERE tipo='contrasto_aperto' AND (${nc3}) LIMIT 3`
        ).all(...np3);
        if (dbCass) {
          for (const c of contrasti) {
            try {
              const sa = dbCass.prepare('SELECT numero, anno, sezione, oggetto, massima FROM sentenze WHERE id=?').get(c.sentenza_a);
              const sb = dbCass.prepare('SELECT numero, anno, sezione, oggetto, massima FROM sentenze WHERE id=?').get(c.sentenza_b);
              if (sa && sb) {
                blocco.push(`    POSIZIONE A: n.${sa.numero}/${sa.anno} ${sa.sezione} — ${sa.oggetto}`);
                if (sa.massima) blocco.push(`      "${sa.massima.substring(0, 120).replace(/\n/g,' ')}…"`);
                blocco.push(`    POSIZIONE B: n.${sb.numero}/${sb.anno} ${sb.sezione} — ${sb.oggetto}`);
                if (sb.massima) blocco.push(`      "${sb.massima.substring(0, 120).replace(/\n/g,' ')}…"`);
              }
            } catch(e) {}
          }
        }
      } catch(e) {}
    } else {
      blocco.push(`  Orientamento: nessun contrasto aperto rilevato`);
    }

    // Ultime sentenze recenti (max 3, preferendo le più recenti)
    if (dbCass && s?.tot_sentenze > 0) {
      try {
        const { clause: nc4, params: np4 } = aliasInClause(norma, 'norma_comune');
        const ids = dbGiuridica.prepare(
          `SELECT sentenza_a FROM relazioni_sentenze WHERE (${nc4}) ORDER BY creato_il DESC LIMIT 4`
        ).all(...np4).map(r => r.sentenza_a);
        if (ids.length > 0) {
          const ph = ids.map(() => '?').join(',');
          const sents = dbCass.prepare(
            `SELECT numero, anno, sezione, tipo, oggetto FROM sentenze WHERE id IN (${ph}) ORDER BY anno DESC, numero DESC LIMIT 3`
          ).all(...ids);
          if (sents.length > 0) {
            blocco.push(`  Sentenze recenti Cassazione:`);
            sents.forEach(s2 => blocco.push(`    • Cass. ${s2.tipo} n.${s2.numero}/${s2.anno} ${s2.sezione} — ${(s2.oggetto||'').substring(0,70)}`));
          }
        }
      } catch(e) {}
    }

    blocchi.push(blocco.join('\n'));
  }

  if (dbCass) { try { dbCass.close(); } catch(e) {} }

  // ── BLOCCO A — testo vigente dell'articolo ───────────────────────────────
  for (const n of normeCitate) {
    const norma = typeof n === 'object' ? (n.norma || '') : String(n);
    if (!norma) continue;
    try {
      const parsed = normaToDbKey(norma);
      if (!parsed) continue;
      const row = dbGiuridica.prepare('SELECT titolo, testo FROM articoli_codice WHERE id = ?').get(parsed.dbKey);
      if (row && row.testo) {
        const nota = row.testo.includes('AGGIORNAMENTO') ? ' [con note Corte Cost.]' : '';
        blocchi.push(`[TESTO VIGENTE: ${norma}${nota}]\n${row.testo.substring(0, 800)}`);
      }
    } catch(e) { console.warn('[getGrafoContext] Blocco A errore per ' + norma + ':', e.message); }
  }

  // ── BLOCCO B — notizie recenti con contesto e analisi ───────────────────
  for (const n of normeCitate) {
    const norma = typeof n === 'object' ? (n.norma || '') : String(n);
    if (!norma) continue;
    try {
      const parsed = normaToDbKey(norma);
      if (!parsed) continue;
      const rows = dbGiuridica.prepare(`
        SELECT n.title, cnl.contesto_citazione, n.l3_analisi, n.published_at
        FROM codici_news_link cnl
        JOIN news n ON n.id = cnl.news_id
        WHERE cnl.articolo_id = ?
        ORDER BY n.published_at DESC
        LIMIT 4
      `).all(parsed.dbKey);
      if (rows.length > 0) {
        const lines = [`[NOTIZIE RECENTI SU ${norma}: ${rows.length}]`];
        for (const r of rows) {
          let line = `• [${(r.published_at||'?').substring(0,10)}] ${(r.title||'').substring(0,80)}`;
          if (r.contesto_citazione) line += ` — ${r.contesto_citazione.substring(0,150)}`;
          try {
            if (r.l3_analisi) {
              const l3 = JSON.parse(r.l3_analisi);
              if (l3.problema_giuridico && l3.problema_giuridico !== 'Non disponibile')
                line += ` | PG: ${l3.problema_giuridico.substring(0,100)}`;
            }
          } catch(e2) {}
          lines.push(line);
        }
        blocchi.push(lines.join('\n'));
      }
    } catch(e) { console.warn('[getGrafoContext] Blocco B errore per ' + norma + ':', e.message); }
  }

  // ── BLOCCO C — sentenze Cassazione recenti (nuova connessione, chiusa dopo) ──
  let dbCass2 = null;
  try {
    const Database2 = require('better-sqlite3');
    dbCass2 = new Database2(path.join(__dirname, 'data', 'cassazione.db'), { readonly: true });
  } catch(e) { console.warn('[getGrafoContext] cassazione.db non disponibile per Blocco C:', e.message); }

  if (dbCass2) {
    for (const n of normeCitate) {
      const norma = typeof n === 'object' ? (n.norma || '') : String(n);
      if (!norma) continue;
      try {
        const parsed = normaToDbKey(norma);
        if (!parsed) continue;
        // Pattern sicuro: 'art.%131-bis%' evita falsi positivi su numeri soli
        const pat = `%art.%${parsed.numero}%`;
        const rows = dbCass2.prepare(`
          SELECT numero, anno, sezione,
                 substr(oggetto,1,150)  AS oggetto,
                 substr(massima,1,200)  AS massima
          FROM sentenze
          WHERE testo_integrale LIKE ?
          ORDER BY anno DESC, numero DESC
          LIMIT 3
        `).all(pat);
        if (rows.length > 0) {
          const lines = [`[SENTENZE CASSAZIONE SU ${norma}: top 3 recenti]`];
          for (const r of rows) {
            let line = `• Cass. ${r.sezione||''} n.${r.numero}/${r.anno}`;
            if (r.oggetto) line += ` — ${r.oggetto}`;
            if (r.massima) {
              line += `\n  Massima: ${r.massima}`;
            } else {
              try {
                const tRow = dbCass2.prepare(
                  'SELECT testo_integrale FROM sentenze WHERE numero=? AND anno=? LIMIT 1'
                ).get(r.numero, r.anno);
                if (tRow && tRow.testo_integrale) {
                  const testo = tRow.testo_integrale;
                  const needle = parsed.numero;
                  const idx = testo.indexOf(needle);
                  if (idx >= 0) {
                    const start = Math.max(0, idx - 150);
                    const end   = Math.min(testo.length, idx + needle.length + 150);
                    const fr = '...' + testo.substring(start, end).replace(/\s+/g, ' ').trim() + '...';
                    line += `\n  Frammento: ${fr.substring(0, 300)}`;
                  }
                }
              } catch(e2) { /* silenzioso */ }
            }
            lines.push(line);
          }
          blocchi.push(lines.join('\n'));
        }
      } catch(e) { console.warn('[getGrafoContext] Blocco C errore per ' + norma + ':', e.message); }
    }
    try { dbCass2.close(); } catch(e) {}
  }

  // ── TRONCAMENTO a 4000 chars ─────────────────────────────────────────────
  const risultato = blocchi.join('\n\n');
  if (risultato.length > 4000) {
    return risultato.substring(0, 4000) + '\n[...contesto troncato a 4000 chars]';
  }
  return risultato;
}

async function generateL3(article, l1l2, dbGiuridica) {
  const l1Str  = l1l2?.l1 ? `${l1l2.l1.cosa} ${l1l2.l1.chi} ${l1l2.l1.perche_importa}` : (article.title || '');
  const normeCitate = l1l2?.l2?.norme_citate || [];
  const precStr = (() => {
    const prec = l1l2?.l2?.precedenti_citati || [];
    if (!prec.length) return 'nessuno';
    return prec.map(p => typeof p === 'object' ? `${p.sentenza} (${p.relazione})` : p).join('; ');
  })();

  // Raccogli contesto dal grafo — zero API, solo query locali
  const grafoCtx = getGrafoContext(normeCitate, dbGiuridica);

  const normePerPrompt = normeCitate.map(n =>
    typeof n === 'object' ? `${n.norma} (${n.ruolo})` : n
  ).join(', ') || 'nessuna';

  const userMsg = `ARTICOLO DA ANALIZZARE:
Titolo: ${article.title || ''}
Fonte: ${article.source_name || article.source || ''}
Testo: ${l1l2?.l2?.background || l1Str}

DATI DAL DATABASE (verificati, non inventare altro):
Norme citate: ${normePerPrompt}
Precedenti: ${precStr}
Tipo contenuto: ${l1l2?.tipo_contenuto || 'notizia'}

${grafoCtx ? `PER OGNI NORMA CITATA:\n${grafoCtx}` : ''}

ANALISI RICHIESTA in JSON con campi:
1. problema_giuridico: principio di diritto come massima di Cassazione
2. orientamenti: array {posizione, sostenuto_da, consolidato:true/false} — usa i dati reali sopra, mai inventare
3. implicazioni_pratiche: strategia processuale concreta, rischi e opportunita per l'avvocato, eccezioni possibili
4. nessi_sistematici: come le norme interagiscono tra loro (usa i dati co-citazione sopra), profili costituzionali o UE
5. non_detto: punti deboli, controargomentazioni, lacune; se ci sono contrasti aperti segnalali come rischio
6. confidence: alta (dati abbondanti) | media (dati parziali) | bassa (dati scarsi)

{"l3":{"problema_giuridico":"...","orientamenti":[{"posizione":"...","sostenuto_da":"...","consolidato":true}],"implicazioni_pratiche":"...","nessi_sistematici":"...","non_detto":"...","confidence":"alta|media|bassa"}}`;

  console.log('[L3] Contesto grafo: ' + (grafoCtx ? grafoCtx.split('\n').length + ' righe' : 'assente'));
  console.log('[Model] Usando Sonnet per L3');
  const raw = await callClaude({ model: CONFIG.models.deep, max_tokens: 1500, temperature: 0.2,
    system: SYSTEM_L3, messages: [{ role: 'user', content: userMsg }] });
  return safeParseJSON(raw);
}

// ─── L5 — IMPLICAZIONI PER LA PRATICA FORENSE ───────────────────────────────
const SYSTEM_L5 = `Sei un giurista italiano con 20 anni di esperienza, specializzato in consulenza strategica per avvocati. Valuta l'analisi giuridica fornita e produci una sintesi operativa verificata.

CAMPI JSON DA PRODURRE:
- impatto_operativo: cosa fare CONCRETAMENTE domani mattina — aggiornare atti, rivedere strategie, informare clienti, verificare scadenze. Operativo e diretto (max 3 frasi).
- scenari: max 2 scenari SE->ALLORA con probabilita' per la pratica forense. Devono essere logicamente derivabili dai fatti, non congetture generiche.
- scadenze: termini concreti, entrate in vigore, decreti attuativi attesi. Array vuoto se nessuno.
- domanda_aperta: la vera questione giuridica irrisolta che potrebbe generare ricorso o rinvio alla Consulta. Deve terminare con ?.
- livello_confidenza: Alto|Medio|Basso con motivazione in 1 frase.
- raccomandazione: "L'avvocato puo' fare affidamento su questa analisi con le seguenti cautele: ..." oppure "Verificare prima di utilizzare perche' ...".

REGOLE:
1. Non dare pareri legali diretti.
2. Usa "potrebbe", "se confermato", "nel caso in cui".
3. Se i dati sono insufficienti, riduci a 1 scenario con probabilita' "bassa".
4. PRIORITA': JSON COMPLETO. Non troncare mai il JSON.
5. Output SOLO JSON valido.
6. Valuta anche: livello di consolidamento dell'orientamento, se ci sono segnali di revirement imminente, e formula una raccomandazione operativa concreta per l'avvocato (aggiornare atti, rivedere strategie, informare clienti, verificare scadenze).`;

async function generateL5(article, l1l2, l3, dbGiuridica) {
  const l1Str     = l1l2?.l1 ? `${l1l2.l1.cosa} ${l1l2.l1.perche_importa}` : (article.title || '');
  const normeCitate = l1l2?.l2?.norme_citate || [];
  const orientStr = l3?.l3?.orientamenti
    ? l3.l3.orientamenti.map(o => `  • ${o.posizione} (${o.sostenuto_da}, consolidato: ${o.consolidato}${o.segnali_revirement ? ', revirement: ' + o.segnali_revirement : ''})`).join('\n')
    : 'N/A';

  // Contesto grafo sintetico per L5 — solo anomalie e trend (no sentenze dettagliate)
  const grafoCtx = getGrafoContext(normeCitate, dbGiuridica);
  const grafoSintetico = grafoCtx
    ? grafoCtx.split('\n').filter(l => l.includes('⚡') || l.includes('Trend:') || l.includes('ATTENZIONE') || l.includes('⚠') || l.includes('mancante')).join('\n')
    : '';

  const normeStr = normeCitate.map(n => typeof n === 'object' ? `${n.norma} (${n.ruolo})` : n).join(', ') || 'n.d.';

  const userMsg = `SCENARIO COMPLETO DA ANALIZZARE:
Fatto: ${l1Str}
Contesto: ${l1l2?.l2?.background || ''}
Norme in gioco: ${normeStr}

ANALISI L3 (già svolta):
Principio: ${l3?.l3?.problema_giuridico || 'N/A'}
Implicazioni identificate: ${l3?.l3?.implicazioni_pratiche || 'N/A'}
Criticita': ${l3?.l3?.non_detto || 'N/A'}
Orientamenti:
${orientStr}

${grafoSintetico ? `SEGNALI DAL DATABASE (trend e contrasti):\n${grafoSintetico}\n` : ''}
JSON:
{"l5":{"impatto_operativo":"cosa fare CONCRETAMENTE — aggiornare atti, rivedere strategie, informare clienti, verificare scadenze (max 3 frasi operative)","scenari":[{"se":"condizione specifica derivabile dai fatti","allora":"conseguenza pratica per l'avvocato","probabilita":"alta|media|bassa"}],"scadenze":["data — adempimento, o array vuoto se nessuno"],"domanda_aperta":"la vera questione irrisolta che potrebbe generare ricorso o rinvio alla Consulta?","livello_confidenza":"Alto|Medio|Basso — motiva in 1 frase","raccomandazione":"L'avvocato puo' fare affidamento... / Verificare prima perche'..."}}`;

  console.log('[Model] Usando Sonnet per L5');
  const raw = await callClaude({ model: CONFIG.models.deep, max_tokens: 1500, temperature: 0.3,
    system: SYSTEM_L5, messages: [{ role: 'user', content: userMsg }] });
  return safeParseJSON(raw);
}

// ─── L4 — INTEGRAZIONE CON LINK BUILDER (zero AI) ───────────────────────────
function linkNormeCitateAlDB(articleId, l1l2, db) {
  if (!l1l2?.l2?.norme_citate?.length) return 0;
  const { estraiRiferimenti, collegaRiferimentiAlDB } = require('./article-matcher');
  const normeStr   = l1l2.l2.norme_citate.join(' ');
  const riferimenti = estraiRiferimenti(normeStr);
  const matches    = collegaRiferimentiAlDB(riferimenti, db);
  const insert     = db.prepare('INSERT OR IGNORE INTO codici_news_link (articolo_id,articolo_ref,news_id,livello_scalata,confidence,tipo_citazione) VALUES (?,?,?,?,?,?)');
  let count = 0;
  for (const m of matches.filter(x => x.trovato)) {
    try { insert.run(m.db_id, m.match_originale, articleId, 'L2', 0.9, 'interpretazione'); count++; }
    catch(e) { /* duplicato */ }
  }
  return count;
}

// ─── BATCH L1+L2 (notizie in-memory) ────────────────────────────────────────
const _batchDoneL1L2 = new Set();
const _batchDoneL3   = new Set();

async function runBatchL1L2(cacheArticles, limit) {
  const nuove = (cacheArticles || [])
    .filter(a => a?.title && !_batchDoneL1L2.has(a.id))
    .slice(0, limit || 20);
  if (!nuove.length) { console.log('▲ Batch L1+L2: nessuna notizia nuova'); return {processati:0,successi:0,errori:0}; }
  console.log(`▲ Batch L1+L2: ${nuove.length} notizie...`);
  let successi=0, errori=0;
  for (let i=0; i<nuove.length; i++) {
    const art = nuove[i];
    try {
      const result = await generateL1L2(art);
      if (result) {
        const key = Buffer.from((art.title+'l1l2').substring(0,70)).toString('base64url');
        if (global._synthesisCache) global._synthesisCache.set(key, {ok:true, level:'l1l2', result});
        _batchDoneL1L2.add(art.id);
        successi++;
      } else errori++;
    } catch(e) { console.error(`❌ Batch L1+L2: ${e.message}`); errori++; if(e.message.includes('429')) await new Promise(r=>setTimeout(r,30000)); }
    if (i < nuove.length-1) await new Promise(r=>setTimeout(r, CONFIG.batch.delayBetween));
    if ((i+1)%10===0) console.log(` ... ${i+1}/${nuove.length} (${successi} ok)`);
  }
  console.log(`▲ Batch L1+L2 completato: ${successi}/${nuove.length}`);
  return {processati:nuove.length, successi, errori};
}

async function runBatchL3Hot(cacheArticles, db, limit) {
  const hot = (cacheArticles||[]).filter(a=>a?.title&&_batchDoneL1L2.has(a.id)&&!_batchDoneL3.has(a.id)).slice(0,limit||10);
  if (!hot.length) return {processati:0};
  console.log(`▲ Batch L3 hot: ${hot.length} notizie...`);
  let successi=0;
  for (const art of hot) {
    try {
      const key   = Buffer.from((art.title+'l1l2').substring(0,70)).toString('base64url');
      const cached= global._synthesisCache?.get(key);
      const l1l2  = cached?.result || null;
      if (!l1l2) continue;
      const result= await generateL3(art, l1l2, db);
      if (result) { _batchDoneL3.add(art.id); successi++; }
      await new Promise(r=>setTimeout(r,600));
    } catch(e) { if(e.message?.includes('429')) await new Promise(r=>setTimeout(r,30000)); }
  }
  console.log(`▲ L3 hot: ${successi}/${hot.length}`);
  return {processati:hot.length, successi};
}

// ─── API ENDPOINTS ───────────────────────────────────────────────────────────
// Usato dal server.js per registrare gli endpoint Express-like
// Il server usa http nativo — setupScalataAPI registra i path nella urlHandlers map
function registerScalataHandlers(urlHandlers, db, canCallClaude, synthesisCache) {
  // L0 — valuta fonte (GET /api/scalata/l0?source=...)
  urlHandlers['/api/scalata/l0'] = (parsedUrl, req, res) => {
    const source = decodeURIComponent(parsedUrl.searchParams.get('source') || '');
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(getL0(source)));
  };

  // L1+L2 — on-demand (POST /api/scalata/l1l2)
  urlHandlers['/api/scalata/l1l2'] = (parsedUrl, req, res) => {
    let body='';
    req.on('data',c=>body+=c);
    req.on('end', async ()=>{
      try {
        if (!canCallClaude()) { res.writeHead(429); res.end(JSON.stringify({error:'Rate limit'})); return; }
        const art = JSON.parse(body||'{}');
        const result = await generateL1L2(art);
        if (!result) { res.writeHead(500); res.end(JSON.stringify({error:'Generazione fallita'})); return; }
        const newLinks = db ? linkNormeCitateAlDB(art.id||'', result, db) : 0;
        res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify({ok:true, result, new_links:newLinks}));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    });
  };

  // L3 — analisi (POST /api/scalata/l3)
  urlHandlers['/api/scalata/l3'] = (parsedUrl, req, res) => {
    let body='';
    req.on('data',c=>body+=c);
    req.on('end', async ()=>{
      try {
        if (!canCallClaude()) { res.writeHead(429); res.end(JSON.stringify({error:'Rate limit'})); return; }
        const {article, l1l2} = JSON.parse(body||'{}');
        const result = await generateL3(article, l1l2, db);
        if (!result) { res.writeHead(500); res.end(JSON.stringify({error:'Generazione L3 fallita'})); return; }
        res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify({ok:true, result}));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    });
  };

  // L5 — implicazioni (POST /api/scalata/l5)
  urlHandlers['/api/scalata/l5'] = (parsedUrl, req, res) => {
    let body='';
    req.on('data',c=>body+=c);
    req.on('end', async ()=>{
      try {
        if (!canCallClaude()) { res.writeHead(429); res.end(JSON.stringify({error:'Rate limit'})); return; }
        const {article, l1l2, l3} = JSON.parse(body||'{}');
        const result = await generateL5(article, l1l2, l3, db);
        if (!result) { res.writeHead(500); res.end(JSON.stringify({error:'Generazione L5 fallita'})); return; }
        res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify({ok:true, result}));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    });
  };
}

module.exports = {
  getL0, generateL1L2, generateL3, generateL5,
  getGrafoContext, normaToDbKey,
  linkNormeCitateAlDB, runBatchL1L2, runBatchL3Hot,
  registerScalataHandlers, safeParseJSON, CONFIG,
};
