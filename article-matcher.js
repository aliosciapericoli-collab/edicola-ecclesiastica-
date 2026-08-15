// article-matcher.js v2 — allineato spec Modulo 3
'use strict';

// ─── PATTERN ────────────────────────────────────────────────────────────────
const PATTERNS = [
  // art. 1453 c.c. / art. 612-bis c.p. / art. 700 c.p.c.
  { regex: /\bart(?:t|icolo|icoli)?\.?\s*(\d+(?:\s*-\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies|undecies|duodecies))?)\s+(c\.p\.p\.|c\.p\.c\.|c\.c\.|c\.p\.|c\.d\.s\.|cod\.?\s*cons\.)/gi,
    type:'articolo_codice', getAbbr:m=>m[2].replace(/\s+/g,'').toLowerCase(), getNum:m=>m[1].replace(/\s+/g,'') },

  // art. 1 Cost. / art. 111 della Costituzione
  { regex: /\bart(?:icolo)?\.?\s*(\d+)\s+(?:Cost\.|della\s+Costituzione|Costituzione)/gi,
    type:'articolo_costituzione', getAbbr:()=>'cost.', getNum:m=>m[1] },

  // art. 5 TUIR / art. 73 del TUIR
  { regex: /\bart(?:icolo)?\.?\s*(\d+(?:\s*-\s*\w+)?)\s+(?:del\s+)?TUIR/gi,
    type:'articolo_tuir', getAbbr:()=>'tuir', getNum:m=>m[1].replace(/\s+/g,'') },

  // art. 12 CCII / art. 5 del Codice della crisi
  { regex: /\bart(?:icolo)?\.?\s*(\d+(?:\s*-\s*\w+)?)\s+(?:del\s+)?(?:CCII|[Cc]odice\s+della\s+[Cc]risi)/gi,
    type:'articolo_ccii', getAbbr:()=>'ccii', getNum:m=>m[1].replace(/\s+/g,'') },

  // art. 7 GDPR / art. 13 Reg. UE 2016/679
  { regex: /\bart(?:icolo)?\.?\s*(\d+)\s+(?:del\s+)?(?:GDPR|Reg(?:olamento)?\.?\s*(?:UE\s*)?2016\/679)/gi,
    type:'articolo_gdpr', getAbbr:()=>'GDPR', getNum:m=>m[1] },

  // D.Lgs. 231/2001
  { regex: /(?:[Dd]\.?\s*[Ll]gs\.?|[Dd]ecreto\s+[Ll]egislativo)\s*(?:n\.?\s*)?(\d+)\s*\/\s*(\d{4})/g,
    type:'decreto_legislativo', getAbbr:m=>`D.Lgs. ${m[1]}/${m[2]}`, getNum:()=>null },

  // L. 241/1990
  { regex: /(?:[Ll](?:egge)?\.?\s*(?:n\.?\s*)?)(\d+)\s*\/\s*(\d{4})/g,
    type:'legge', getAbbr:m=>`L. ${m[1]}/${m[2]}`, getNum:()=>null },

  // D.P.R. 380/2001
  { regex: /[Dd]\.?\s*[Pp]\.?\s*[Rr]\.?\s*(?:n\.?\s*)?(\d+)\s*\/\s*(\d{4})/g,
    type:'dpr', getAbbr:m=>`D.P.R. ${m[1]}/${m[2]}`, getNum:()=>null },
];

// ─── ABBR → codice_id ───────────────────────────────────────────────────────
const ABBR_NORMALIZE = {
  'c.c.':'codice_civile', 'c.p.':'codice_penale',
  'c.p.c.':'cpc', 'c.p.p.':'cpp',
  'c.d.s.':'codice_strada', 'cod.cons.':'codice_consumo',
  'cost.':'costituzione', 'tuir':'tuir', 'ccii':'ccii',
};
// Sigla → codice_id
const SIGLA_TO_ID = {
  'c.c.':'codice_civile','c.p.':'codice_penale','c.p.c.':'cpc','c.p.p.':'cpp',
  'cost.':'costituzione','Cost.':'costituzione','TUIR':'tuir','CCII':'ccii',
  'cod.cons.':'codice_consumo',
};

// ─── ESTRAI RIFERIMENTI ──────────────────────────────────────────────────────
function estraiRiferimenti(testo) {
  if (!testo || testo.length < 10) return [];
  const risultati = [];
  const visti = new Set();
  for (const pat of PATTERNS) {
    pat.regex.lastIndex = 0;
    let m;
    while ((m = pat.regex.exec(testo)) !== null) {
      const abbr = pat.getAbbr(m);
      const num  = pat.getNum(m);
      const key  = abbr + '|' + (num||'');
      if (visti.has(key)) continue;
      visti.add(key);
      const s = Math.max(0, m.index-80), e = Math.min(testo.length, m.index+m[0].length+80);
      risultati.push({
        match_originale: m[0],
        abbreviazione: abbr,
        articolo_numero: num,
        tipo: pat.type,
        contesto: testo.substring(s,e).replace(/\s+/g,' ').trim(),
        posizione: m.index,
      });
    }
  }
  return risultati;
}

// ─── COLLEGA AL DB ───────────────────────────────────────────────────────────
function collegaRiferimentiAlDB(riferimenti, db) {
  return riferimenti.map(rif => {
    const codiceId = ABBR_NORMALIZE[rif.abbreviazione.toLowerCase()] || null;
    let articoloDB = null;
    if (codiceId && rif.articolo_numero) {
      articoloDB = db.prepare(
        'SELECT id,codice_id,numero,titolo FROM articoli_codice WHERE codice_id=? AND numero=?'
      ).get(codiceId, rif.articolo_numero)
      || db.prepare(
        'SELECT id,codice_id,numero,titolo FROM articoli_codice WHERE codice_id=? AND numero=?'
      ).get(codiceId, rif.articolo_numero.replace('-',''));
    }
    return { ...rif, codice_id: codiceId, trovato: !!articoloDB,
      db_id: articoloDB?.id, db_rubrica: articoloDB?.titolo };
  });
}

// Alias per compatibilità con codice precedente
function estraiRiferimentiNormativi(testo) { return estraiRiferimenti(testo); }
function collegaAlDB(rif, db) { return collegaRiferimentiAlDB(rif, db); }

// ─── CLASSIFICA CITAZIONE ────────────────────────────────────────────────────
function classificaCitazione(title, snippet) {
  const t = ((title||'')+(snippet||'')).toLowerCase();
  if (t.includes('modifica')||t.includes('novella')||t.includes('sostituito')) return 'modifica';
  if (t.includes('abrog')) return 'abrogazione';
  if (t.includes('sentenza')||t.includes('cassazione')||t.includes('corte')||t.includes('tribunale')) return 'interpretazione';
  return 'menzione';
}

// ─── SALVA LINK (usato dalla Scalata) ────────────────────────────────────────
function salvaLinks(newsId, livello, collegati, db) {
  const trovati = collegati.filter(c => c.trovato);
  if (!trovati.length) return 0;
  const insert = db.prepare(
    'INSERT OR IGNORE INTO codici_news_link (articolo_id, articolo_ref, news_id, livello_scalata, confidence) VALUES (?,?,?,?,?)'
  );
  const tx = db.transaction(() => { for (const c of trovati) insert.run(c.db_id, c.ref||c.match_originale, newsId, livello, 0.9); });
  tx();
  return trovati.length;
}

module.exports = { estraiRiferimenti, estraiRiferimentiNormativi, collegaRiferimentiAlDB, collegaAlDB, classificaCitazione, salvaLinks };
