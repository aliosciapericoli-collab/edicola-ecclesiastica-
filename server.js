const SERVER_START_TS = Date.now().toString();
const http = require('http');
const https = require('https');
const Database = (() => { try { return require('better-sqlite3'); } catch(e) { return null; } })();
// Scalata v2 — il flag SCALATA_ENABLED governa la Scalata v2 (norme + giurisprudenza + sintesi).
// Default ATTIVA; si spegne solo con SCALATA_ENABLED=false|0. Valutazione lazy: legge process.env
// al momento dell'uso, così l'eventuale valore da .env (caricato più sotto) viene rispettato.
function scalataEnabled() {
  const v = process.env.SCALATA_ENABLED;
  return v !== 'false' && v !== '0' && v !== 'off';
}
// Categorie giuridiche: usate per tenere i "casi simili" in ambito giuridico e non
// far scivolare il matching su cronaca/politica/sport (categorie generiche da GNews).
function isCategoriaGiuridica(cat) {
  const c = String(cat || '').toLowerCase();
  if (!c) return false;
  return /^(diritto_|eu_|gn_|cassazion|giurisprudenz|notizie_giust|quotidiano_giur|generalista_sezione_legale|rivista_accademica|avvocatura|legisl|norme|norma)/.test(c);
}
let _linkBuilder = null;
let _fetchContent = null;
function getFetchContent() {
  if (!_fetchContent) {
    try { _fetchContent = require('./fetch-content'); } catch(e) { _fetchContent = { fetchArticleText: async () => '' }; }
  }
  return _fetchContent;
}
// Sprint 1 — link-builder rimosso (KILL). Vestigiale: ritorna sempre null.
function getLinkBuilder() { return null; }

// Master init dei job KEEP (scraper istituzionali/cassazione, backup, stats).
// Disaccoppiato da getLinkBuilder e invocato una sola volta all'avvio (listen),
// così i cron KEEP partono in modo deterministico dopo la rimozione di link-builder.
let _jobsBooted = false;
function bootJobs() {
  if (_jobsBooted) return;
  _jobsBooted = true;
  {
    // Registra handler Scalata Giuridica (prompt specializzati) — solo se SCALATA abilitata
    if (scalataEnabled()) try {
      const sg = require('./scalata-giuridica');
      const db = getCodiciDBW();
      sg.registerScalataHandlers(_scalataHandlers, db, canCallClaude, synthesisCache);
      console.log('[ScalataGiuridica] Handler registrati:', Object.keys(_scalataHandlers).join(', '));
    } catch(e) { console.warn('[ScalataGiuridica] init err:', e.message); }
    // Modulo 5 — Job notturni (stats refresh; scalata codici settimanale RIMOSSA in Sprint 1)
    try {
      const { refreshAllStats }       = require('./stats-refresh');
      const _db5 = getCodiciDBW();
      (function scheduleStats() {
        const now=new Date(), next=new Date(now);
        next.setHours(2,0,0,0); if(next<=now) next.setDate(next.getDate()+1);
        const d=next-now;
        setTimeout(()=>{ refreshAllStats(_db5); setInterval(()=>refreshAllStats(_db5),86400000); },d);
        console.log('[Jobs] Stats refresh ogni notte 02:00 (fra '+Math.round(d/60000)+' min)');
      })();
      // Backup DB giornaliero alle 03:00
      (function scheduleBackup() {
        const { execFile } = require('child_process');
        const backupScript = require('path').join(__dirname, 'scripts', 'backup-db.sh');
        const now=new Date(), next=new Date(now);
        next.setHours(3,0,0,0); if(next<=now) next.setDate(next.getDate()+1);
        const d=next-now;
        function runBackup() {
          execFile('bash', [backupScript], (err, stdout, stderr) => {
            if (stdout) console.log(stdout.trim());
            if (stderr) console.warn(stderr.trim());
            if (err) console.error('[Backup] Errore:', err.message);
          });
        }
        setTimeout(()=>{ runBackup(); setInterval(runBackup, 86400000); }, d);
        console.log('[Jobs] Backup DB ogni notte 03:00 (fra '+Math.round(d/60000)+' min)');
      })();
      // Auto-aggiornamento dal repository GitHub OGNI 20 MINUTI — se main ha
      // nuovi commit: git pull e riavvio pm2. Così le modifiche pubblicate
      // vanno online da sole entro 20 minuti, senza toccare il server.
      (function scheduleAutoUpdate() {
        const { execFile, spawn } = require('child_process');
        const d = 60 * 1000; // primo controllo 1 minuto dopo il boot
        function runUpdate() {
          execFile('git', ['-C', __dirname, 'fetch', 'origin', 'main'], { timeout: 120000 }, (err) => {
            if (err) { console.warn('[AutoUpdate] fetch:', err.message); return; }
            execFile('git', ['-C', __dirname, 'rev-parse', 'HEAD', 'origin/main'], (err2, out) => {
              if (err2) { console.warn('[AutoUpdate] rev-parse:', err2.message); return; }
              const [local, remote] = out.trim().split('\n');
              if (local === remote) { console.log('[AutoUpdate] Nessun aggiornamento.'); return; }
              console.log('[AutoUpdate] Nuovi commit su main — pull e riavvio…');
              execFile('git', ['-C', __dirname, 'pull', 'origin', 'main'], { timeout: 300000 }, (err3) => {
                if (err3) { console.warn('[AutoUpdate] pull:', err3.message); return; }
                const p = spawn('pm2', ['restart', 'edicola-ecclesiastica'], { detached: true, stdio: 'ignore' });
                p.unref();
              });
            });
          });
        }
        setTimeout(()=>{ runUpdate(); setInterval(runUpdate, 20 * 60 * 1000); }, d);
        console.log('[Jobs] Auto-update da GitHub ogni 20 minuti');
      })();
      // Corpus ecclesiastico: blocco giornaliero da 10.000 unita' alle 02:30,
      // eseguito come processo figlio con log su corpus/run-daily.log.
      (function scheduleCorpus() {
        const { spawn } = require('child_process');
        const fs2 = require('fs');
        const now=new Date(), next=new Date(now);
        next.setHours(2,30,0,0); if(next<=now) next.setDate(next.getDate()+1);
        const d=next-now;
        let running = false;
        function runCorpus() {
          if (running) { console.log('[Corpus] Run precedente ancora attiva, salto.'); return; }
          running = true;
          const logPath = require('path').join(__dirname, 'corpus', 'run-daily.log');
          const log = fs2.createWriteStream(logPath, { flags: 'a' });
          log.write('\n======== ' + new Date().toISOString() + ' — blocco giornaliero ========\n');
          const p = spawn(process.execPath, [require('path').join(__dirname, 'corpus', 'run-daily.js')], { cwd: __dirname });
          p.stdout.pipe(log); p.stderr.pipe(log);
          p.on('close', (code) => { running = false; log.end('\n[Corpus] exit ' + code + '\n'); console.log('[Corpus] Blocco giornaliero terminato (exit ' + code + ')'); });
          console.log('[Corpus] Blocco giornaliero avviato (max 10.000 unita\u0027) — log: corpus/run-daily.log');
        }
        setTimeout(()=>{ runCorpus(); setInterval(runCorpus, 86400000); }, d);
        console.log('[Jobs] Corpus ecclesiastico ogni notte 02:30 (fra '+Math.round(d/60000)+' min)');
        // BONIFICA all'avvio: se il corpus contiene documenti col menù del
        // sito al posto del testo (importati prima dell'estrazione mirata),
        // il giro parte SUBITO invece di aspettare le 02:30 — il budget
        // giornaliero resta comunque il tetto.
        setTimeout(() => {
          try {
            const ndbB = getNormativaBB();
            if (!ndbB) return;
            const sporchi = ndbB.prepare(
              "SELECT COUNT(*) c FROM articoli WHERE atto_urn LIKE 'urn:vatican:magistero:%' AND (testo_vigente LIKE '%Celebrazioni Liturgiche%' OR testo_vigente LIKE '%&ccedil;%')"
            ).get().c;
            if (sporchi > 0) { console.log('[Corpus] Bonifica: ' + sporchi + ' documenti sporchi — avvio subito il giro.'); runCorpus(); }
          } catch (e) { /* tabella assente: niente da bonificare */ }
        }, 3 * 60 * 1000);
      })();
    } catch(e) { console.warn('[Jobs] init err:', e.message); }
    // Modulo 6 — Scraper istituzionali (ogni 30 min)
    try {
      const { runAllScrapers } = require('./scrapers/istituzionali');
      const SCRAPER_INTERVAL = 30 * 60 * 1000; // 30 minuti
      let _scraperCache = [];
      async function runScrapers() {
        try {
          const items = await runAllScrapers();
          // Unisci con cache principale — evita duplicati per URL
          const existingUrls = new Set((cache.articles||[]).map(a => a.url));
          const nuovi = items.filter(i => i.url && !existingUrls.has(i.url));
          if (nuovi.length > 0) {
            // Aggiungi in cima alla cache
            // Classifica area diritto per ogni nuovo articolo
      nuovi.forEach(a => { if (!a.area_diritto) a.area_diritto = classifyArticle(a); });
      cache.articles = [...nuovi, ...(cache.articles||[])].slice(0, 5000);
            console.log('[Scrapers] +'+nuovi.length+' notizie istituzionali in cache');
          }
        } catch(e) { console.warn('[Scrapers] err:', e.message); }
      }
      // Prima run dopo 2 minuti, poi ogni 30 min
      setTimeout(runScrapers, 120000);
      setInterval(runScrapers, SCRAPER_INTERVAL);
      console.log('[Scrapers] Schedulati (ogni 30 min, prima run fra 2 min)');
    } catch(e) { console.warn('[Scrapers] init err:', e.message); }
    // Modulo 7 — Scraper Cassazione dedicato (ogni 30 min)
    try {
      const cassScraper = require('./scrapers/cassazione');
      async function runCassazioneScrapers() {
        try {
          const items = await cassScraper.runAllCassazioneScrapers();
          console.log('[Cassazione] Scraper completato: '+items.length+' items totali');

          // Persisti TUTTI gli items nel DB (INSERT OR IGNORE dedup per url)
          try {
            const dbCass = getCodiciDBW();
            console.log('[Cassazione] DB disponibile:', !!dbCass, 'path:', CODICI_DB_PATH);
            if (dbCass) {
              try { dbCass.prepare('ALTER TABLE news ADD COLUMN full_text TEXT').run(); } catch(e) {}
              const ins = dbCass.prepare('INSERT OR IGNORE INTO news (url,title,description,source_name,published_at,area_diritto,tipo_provvedimento,full_text) VALUES (?,?,?,?,?,?,?,?)');
              const updFt = dbCass.prepare("UPDATE news SET full_text=?, description=?, updated_at=CURRENT_TIMESTAMP WHERE url=? AND (full_text IS NULL OR full_text='')");
              let inserted = 0;
              const tx = dbCass.transaction((rows) => {
                for (const a of rows) {
                  const url = a.url || a.link || '';
                  const title = a.title || '';
                  if (!title || !url) continue;
                  const desc = a.desc || a.snippet || a.description || '';
                  const src = a.source_name || a.source || 'Corte di Cassazione';
                  const date = a.date || a.published_at || '';
                  const area = a.area_diritto || a.category || 'cassazione';
                  const tipo = a.tipo_provvedimento || null;
                  const ft = a.full_text || null;
                  const r = ins.run(url, title, desc, src, date, area, tipo, ft);
                  if (r.changes > 0) inserted++;
                  // Aggiorna full_text se già esisteva senza contenuto
                  if (ft && r.changes === 0) updFt.run(ft, desc, url);
                }
              });
              tx(items);
              console.log('[Cassazione] DB: '+inserted+' nuovi provvedimenti inseriti (su '+items.length+' totali)');
            } else {
              console.warn('[Cassazione] DB non disponibile — items salvati solo in cache');
            }
          } catch(dbErr) { console.error('[Cassazione] DB persist ERRORE:', dbErr.message, dbErr.stack); }

          // Aggiorna cache in memoria
          const existingUrls = new Set((cache.articles||[]).map(a => a.url));
          const nuovi = items.filter(i => i.url && !existingUrls.has(i.url));
          nuovi.forEach(a => {
            if (!a.source) a.source = a.source_name || 'Corte di Cassazione';
            if (!a.area_diritto) a.area_diritto = a.category || classifyArticle(a) || 'cassazione';
          });
          if (nuovi.length > 0) {
            cache.articles = [...nuovi, ...(cache.articles||[])].slice(0, 5000);
            console.log('[Cassazione] +'+nuovi.length+' notizie aggiunte alla cache');
          }
        } catch(e) { console.error('[Cassazione] ERRORE scraper:', e.message, e.stack); }
      }
      setTimeout(runCassazioneScrapers, 180000); // 3 min dopo avvio
      setInterval(runCassazioneScrapers, 30 * 60 * 1000);
      console.log('[Cassazione] Schedulato (ogni 30 min, prima run fra 3 min)');
    } catch(e) { console.warn('[Cassazione] init err:', e.message); }
  }
}
let _codiciBW = null; // writeable DB per link builder
function getCodiciDBW() {
  if (!_codiciBW && Database) {
    try { _codiciBW = new Database(CODICI_DB_PATH); } catch(e) {}
  }
  return _codiciBW;
}
const CODICI_DB_PATH = require('path').join(__dirname, 'data', 'giuridica.db');
let _codiciBB = null;
let _codiciBB_mtime = 0;
function getCodiciBB() {
  if (Database) {
    try {
      const mtime = require('fs').statSync(CODICI_DB_PATH).mtimeMs;
      if (!_codiciBB || mtime > _codiciBB_mtime + 5000) {
        // DB aggiornato — riapri connessione
        if (_codiciBB) { try { _codiciBB.close(); } catch(e) {} }
        _codiciBB = new Database(CODICI_DB_PATH, { readonly: true });
        _codiciBB_mtime = mtime;
      }
    } catch(e) {
      if (!_codiciBB) try { _codiciBB = new Database(CODICI_DB_PATH, { readonly: true }); } catch(e2) {}
    }
  }
  return _codiciBB;
}

// ── Corpus Cassazione (data/cassazione-corpus.db) — SOLA LETTURA ──
const CORPUS_DB_PATH = require('path').join(__dirname, 'data', 'cassazione-corpus.db');
let _corpusBB = null;
let _corpusBB_mtime = 0;
function getCorpusBB() {
  if (!Database) return null;
  try {
    const mtime = require('fs').statSync(CORPUS_DB_PATH).mtimeMs;
    if (!_corpusBB || mtime > _corpusBB_mtime + 5000) {
      if (_corpusBB) { try { _corpusBB.close(); } catch(e) {} }
      _corpusBB = new Database(CORPUS_DB_PATH, { readonly: true });
      _corpusBB_mtime = mtime;
    }
  } catch(e) {
    if (!_corpusBB) { try { _corpusBB = new Database(CORPUS_DB_PATH, { readonly: true }); } catch(e2) { return null; } }
  }
  return _corpusBB;
}

// getCorpusDB: usata dagli endpoint /api/cassazione/corpus/* (merge da feat/corpus-cassazione).
// Alias di getCorpusBB → condivide la stessa connessione readonly con reopen-su-mtime,
// evitando una seconda connessione allo stesso file.
function getCorpusDB() { return getCorpusBB(); }

// ── Corpus Normativa (data/normativa.db) — leggi e decreti da Normattiva ──
const NORMATIVA_DB_PATH = require('path').join(__dirname, 'data', 'normativa.db');
let _normBB = null, _normBB_mtime = 0, _normDBW = null;
function getNormativaBB() {
  if (!Database) return null;
  try {
    if (!require('fs').existsSync(NORMATIVA_DB_PATH)) return null;
    const mtime = require('fs').statSync(NORMATIVA_DB_PATH).mtimeMs;
    if (!_normBB || mtime > _normBB_mtime + 5000) {
      if (_normBB) { try { _normBB.close(); } catch(e) {} }
      _normBB = new Database(NORMATIVA_DB_PATH, { readonly: true });
      _normBB_mtime = mtime;
    }
  } catch(e) {
    if (!_normBB) { try { _normBB = new Database(NORMATIVA_DB_PATH, { readonly: true }); } catch(e2) { return null; } }
  }
  return _normBB;
}
// Connessione in scrittura SOLO per la cache dell'analisi on-demand (analisi_articolo).
function getNormativaDBW() {
  if (!Database) return null;
  try {
    if (!require('fs').existsSync(NORMATIVA_DB_PATH)) return null;
    if (!_normDBW) {
      _normDBW = new Database(NORMATIVA_DB_PATH);
      _normDBW.pragma('journal_mode = WAL');
      // La tabella della cache Analisi AI non fa parte dello schema del
      // downloader (corpus/db.js): senza questa creazione lazy l'endpoint
      // atto-analisi cade con "no such table: analisi_articolo".
      _normDBW.exec(`CREATE TABLE IF NOT EXISTS analisi_articolo (
        atto_urn TEXT NOT NULL,
        numero_articolo TEXT NOT NULL,
        spiegazione TEXT,
        ambito TEXT,
        giurisprudenza TEXT,
        generato_at TEXT,
        UNIQUE(atto_urn, numero_articolo)
      )`);
    }
  } catch(e) { return null; }
  return _normDBW;
}
// ── Tab Cassazione: mapping corpus → item del feed ──────────────────────────
// La tab principale "Cassazione" elenca i provvedimenti del corpus
// (data/cassazione-corpus.db), non più le notizie di stampa in giuridica.db.
// Queste helper traducono una riga di `sentenze` nella forma attesa dal feed.
const CASS_SEZ_LABEL = { U: 'Sezioni Unite', L: 'Lavoro', F: 'Feriale' };
function cassSezioneLabel(sezione, settore) {
  if (sezione && CASS_SEZ_LABEL[sezione]) return CASS_SEZ_LABEL[sezione];
  if (sezione) return 'Sez. ' + sezione;
  return settore === 'penale' ? 'Penale' : settore === 'civile' ? 'Civile' : '';
}
function cassCategoria(row) {
  if (row.sezione === 'U') return 'cassazione_ssuu';
  if (row.sezione === 'L') return 'cassazione_lavoro';
  return row.settore === 'penale' ? 'cassazione_penale' : 'cassazione_civile';
}
// Filtri della pillola "sezione" nella UI → clausole SQL sul corpus.
// 'massimario' non esiste nel corpus (che contiene solo provvedimenti): non è più offerto.
function cassFiltroSezione(sezione) {
  if (sezione === 'ssuu') return { sql: 's.sezione=?', par: ['U'] };
  if (sezione === 'lavoro') return { sql: 's.sezione=?', par: ['L'] };
  if (sezione === 'civile' || sezione === 'penale') return { sql: 's.settore=?', par: [sezione] };
  return null;
}
function cassCorpusItem(row) {
  const foro = row.settore === 'penale' ? 'Cass. pen.' : 'Cass. civ.';
  const sez = cassSezioneLabel(row.sezione, row.settore);
  const testo = (row.snippet || '').replace(/\s+/g, ' ').trim();
  return {
    id: row.id,
    sentenza_id: row.id, // il click apre PannelloSentenza via /api/sentenze/sentenza/:id
    title: `${foro}, ${sez ? sez + ', ' : ''}${row.tipo_atto || 'Provvedimento'} n. ${row.numero}/${row.anno}`,
    desc: testo,
    source: 'Corte di Cassazione' + (row.settore ? ' — ' + (row.settore === 'penale' ? 'Penale' : 'Civile') : ''),
    url: row.url_fonte || '', link: row.url_fonte || '',
    date: row.data_deposito || row.data_decisione || '',
    category: cassCategoria(row),
    sezione: sez,
    numero_sentenza: `${row.numero}/${row.anno}`,
    tipo_atto: row.tipo_atto || '', settore: row.settore || '',
    ecli: row.ecli || '', presidente: row.presidente || '', relatore: row.relatore || '',
  };
}
// Colonne comuni ai due endpoint. `snippet` = incipit del testo, o la nota di
// indisponibilità per i provvedimenti oscurati/non estratti (estratto_ok=0).
const CASS_CORPUS_COLS = `s.id, s.settore, s.tipo_atto, s.sezione, s.anno, s.numero,
  s.data_decisione, s.data_deposito, s.ecli, s.url_fonte, s.presidente, s.relatore`;

// ── Manifesto dinamico — cache in memoria delle "novità" (ultimi merge su main) ──
// git log eseguito con execFile (argomenti fissi, nessun input utente). Cache 10 minuti.
let _novitaCache = { ts: 0, data: null };
function getManifestoNovita(cb) {
  const now = Date.now();
  if (_novitaCache.data && (now - _novitaCache.ts) < 10 * 60 * 1000) {
    return cb(_novitaCache.data);
  }
  const { execFile } = require('child_process');
  execFile('git', [
    '-C', __dirname,
    'log', '--merges', '--first-parent', 'main',
    '--date=short', '--pretty=format:%ad%s', '-n', '10'
  ], { timeout: 4000 }, (err, stdout) => {
    let novita = [];
    if (!err && stdout && stdout.trim()) {
      novita = stdout.trim().split('\n').map(line => {
        const i = line.indexOf('');
        if (i < 0) return null;
        return { data: line.slice(0, i).trim(), titolo: line.slice(i + 1).trim() };
      }).filter(Boolean);
    } else {
      // Fallback: CHANGELOG.md se esiste, altrimenti lista vuota (nessun errore)
      try {
        const chPath = require('path').join(__dirname, 'CHANGELOG.md');
        const raw = require('fs').readFileSync(chPath, 'utf8');
        novita = raw.split('\n')
          .map(l => l.trim())
          .filter(l => /^[-*]\s+/.test(l))
          .slice(0, 10)
          .map(l => ({ data: '', titolo: l.replace(/^[-*]\s+/, '') }));
      } catch(e) { novita = []; }
    }
    _novitaCache = { ts: now, data: novita };
    cb(novita);
  });
}

// Costruisce una query FTS5 sicura: tokenizza, rimuove operatori/punteggiatura,
// racchiude ogni termine tra virgolette (AND implicito). Ritorna null se vuota.
function buildFtsMatch(q) {
  const terms = (q || '').toLowerCase()
    .split(/\s+/)
    .map(t => t.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(t => t.length >= 2);
  if (!terms.length) return null;
  return terms.map(t => '"' + t + '"').join(' ');
}

const { XMLParser } = require('fast-xml-parser');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const fs = require('fs');

// Carica variabili d'ambiente da .env
try {
  const env = fs.readFileSync(__dirname + '/.env', 'utf8');
  env.split('\n').forEach(line => {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
} catch(e) {}

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const GNEWS_KEY = process.env.GNEWS_API_KEY || '';

// ── GNews API — fetch articoli extra (gratis: 100 chiamate/giorno) ──
// Strategia: 10 topic × 10 articoli = 100 articoli per ciclo
// Ciclo ogni 30 min ma risparmia chiamate: max 10 per ciclo
const GNEWS_TOPICS = [
  { lang: 'it', topic: 'general',    category: 'italia' },
  { lang: 'it', topic: 'world',      category: 'mondo' },
  { lang: 'it', topic: 'business',   category: 'economia' },
  { lang: 'it', topic: 'technology', category: 'tech' },
  { lang: 'it', topic: 'sports',     category: 'sport' },
  { lang: 'en', topic: 'world',      category: 'mondo' },
  { lang: 'en', topic: 'technology', category: 'tech' },
  { lang: 'en', topic: 'science',    category: 'scienza' },
  { lang: 'en', topic: 'health',     category: 'salute' },
  { lang: 'en', topic: 'business',   category: 'economia' },
];

let gnewsDailyCount = 0;
let gnewsDayReset = new Date().toDateString();
const GNEWS_DAILY_MAX = 95; // lascia margine su 100

async function fetchGNewsArticles() {
  if (!GNEWS_KEY) return [];
  // Reset contatore giornaliero
  const today = new Date().toDateString();
  if (today !== gnewsDayReset) { gnewsDailyCount = 0; gnewsDayReset = today; }
  if (gnewsDailyCount >= GNEWS_DAILY_MAX) return [];

  const articles = [];
  const callsLeft = GNEWS_DAILY_MAX - gnewsDailyCount;
  const topicsThisCycle = GNEWS_TOPICS.slice(0, Math.min(callsLeft, 10));

  for (const t of topicsThisCycle) {
    try {
      const url = `https://gnews.io/api/v4/top-headlines?token=${GNEWS_KEY}&lang=${t.lang}&topic=${t.topic}&max=10`;
      const data = await fetchUrl(url, 0, {}, 10000);
      const parsed = JSON.parse(data);
      gnewsDailyCount++;
      if (!parsed.articles) continue;
      for (const a of parsed.articles) {
        if (!a.title || !a.url) continue;
        const id = 'gnews_' + Buffer.from(a.url).toString('base64').substring(0, 16);
        articles.push({
          id, title: a.title,
          link: a.url, url: a.url,
          desc: a.description || '',
          date: a.publishedAt || new Date().toISOString(),
          source: a.source?.name || 'GNews',
          source_name: a.source?.name || 'GNews',
          source_url: a.source?.url || '',
          category: t.category,
          lang: t.lang,
          thumb: a.image || '',
        });
      }
      await new Promise(r => setTimeout(r, 150));
    } catch(e) { /* ignora errori singoli topic */ }
  }
  if (articles.length > 0)
    console.log(`[GNews] +${articles.length} articoli (${gnewsDailyCount}/${GNEWS_DAILY_MAX} chiamate oggi)`);
  return articles;
}

// ── Scalata Engine (modulo separato con nuovi endpoint /api/scalata/*) ──
try {
  const { setupScalataAPI } = require('./scalata-engine');
  // Crea un mini-app Express-like che usa il server http nativo
  // setupScalataAPI usa express.json() — lo passiamo solo per i nuovi path
  // Per ora esponiamo solo /api/scalata/status come test
  console.log('[Scalata Engine] modulo caricato');
} catch(e) {
  console.error('[Scalata Engine] caricamento fallito:', e.message);
}


// Carica source profiles
let sourceProfiles = {};
try {
  sourceProfiles = JSON.parse(fs.readFileSync(__dirname + '/source_profiles.json', 'utf8')).sources || {};
} catch(e) {}

function getSourceProfile(sourceName) {
  if (!sourceName) return sourceProfiles['_default'];
  // Cerca corrispondenza esatta, poi parziale
  if (sourceProfiles[sourceName]) return sourceProfiles[sourceName];
  const lower = sourceName.toLowerCase();
  for (const key of Object.keys(sourceProfiles)) {
    if (key === '_default') continue;
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return sourceProfiles[key];
    }
  }
  return sourceProfiles['_default'];
}

// ── Generazione HTML per alert settimanale ────────────
function generateWeeklyHTML(trending, sentenze, contrasti, totNotizie) {
  const CODICI_ABBR = {codice_civile:"c.c.",codice_penale:"c.p.",cpc:"c.p.c.",cpp:"c.p.p.",costituzione:"Cost.",tuir:"TUIR",codice_crisi:"CCII"};
  let h = '<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;color:#1A1814">';
  h += '<h1 style="color:#9A6F2E;font-size:22px;border-bottom:2px solid #D8D0C4;padding-bottom:12px">Edicola Ecclesiastica — Riepilogo Settimanale</h1>';
  h += '<p style="color:#5C5650;font-size:14px">' + totNotizie + ' notizie analizzate questa settimana.</p>';

  // Norme calde
  h += '<h2 style="color:#8A5A1A;font-size:16px;margin-top:24px">🔥 Top 10 Norme Calde</h2>';
  h += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
  trending.forEach((t, i) => {
    const abbr = CODICI_ABBR[t.codice_id] || t.codice_id;
    const arrow = t.trend === 'aumento' ? '↑' : t.trend === 'diminuzione' ? '↓' : '→';
    h += '<tr style="border-bottom:1px solid #D8D0C4"><td style="padding:6px 0;font-weight:600">' + (i+1) + '. Art. ' + t.numero + ' ' + abbr + '</td>';
    h += '<td style="text-align:right;color:#5C5650">' + t.citazioni + ' cit. ' + arrow + '</td></tr>';
  });
  h += '</table>';

  // Top sentenze
  if (sentenze.length > 0) {
    h += '<h2 style="color:#8B1A1A;font-size:16px;margin-top:24px">⚖️ Top Sentenze</h2>';
    sentenze.forEach(s => {
      h += '<div style="padding:8px 0;border-bottom:1px solid #D8D0C4">';
      h += '<a href="' + (s.url||'#') + '" style="color:#1A1814;text-decoration:none;font-weight:600;font-size:13px">' + s.title + '</a>';
      h += '<div style="font-size:11px;color:#8A8480">' + (s.source||'') + ' · ' + (s.date ? new Date(s.date).toLocaleDateString('it-IT') : '') + '</div>';
      h += '</div>';
    });
  }

  // Contrasti
  if (contrasti.length > 0) {
    h += '<h2 style="color:#C45C5C;font-size:16px;margin-top:24px">⚡ Variazioni Significative</h2>';
    contrasti.forEach(c => {
      const abbr = CODICI_ABBR[c.codice_id] || c.codice_id;
      h += '<div style="padding:6px 0;font-size:13px"><strong>Art. ' + c.numero + ' ' + abbr + '</strong> — ';
      h += (c.variazione_vs_periodo_precedente > 0 ? '+' : '') + c.variazione_vs_periodo_precedente + '%</div>';
    });
  }

  h += '<p style="margin-top:24px;font-size:11px;color:#8A8480;border-top:1px solid #D8D0C4;padding-top:12px">Edicola Ecclesiastica — Notizie Scalabili · Codici Viventi</p>';
  h += '</div>';
  return h;
}

// ── Classificazione articoli per area giuridica ────────────
// Punteggiatura → spazi, così ' papa ' aggancia anche "Papa:" o "(Papa)";
// spazi ai bordi per le chiavi con confini di parola (' cei ').
function _testoNorm(article) {
  return (' ' + ((article.title || '') + ' ' + (article.desc || article.description || '')).toLowerCase()
    .replace(/[^a-z0-9àèéìòùáéíóúüö]/g, ' ') + ' ').replace(/\s+/g, ' ');
}

// Classificazione dal CONTENUTO (titolo+descrizione, che dopo la traduzione è
// in italiano; le chiavi inglesi coprono il pre-traduzione), in ordine di
// specificità. Restituisce null se nessuna chiave aggancia.
function _classifyByContent(t) {
  const ha = (...parole) => parole.some(p => t.includes(p));

  if (ha('diritto canonico', 'rota romana', 'tribunale ecclesiastico', 'nullità matrimonial', 'matrimonio canonico',
         'segnatura apostolica', 'motu proprio', 'codice di diritto canonico', 'processo canonico', 'delitti riservati', 'scomunica',
         'canon law', 'canonical', 'canonist', 'annulment'))
    return 'diritto_canonico';
  if (ha('8 per mille', 'otto per mille', 'concordato', 'patti lateranensi', 'ente ecclesiastico', 'enti ecclesiastici',
         'matrimonio concordatario', 'ora di religione', 'edifici di culto', 'ministro di culto', 'insegnamento della religione') ||
      (ha('intesa', 'intese') && ha('confession', 'religios', 'culto')) ||
      (ha(' imu ', 'esenzion') && ha('chies', 'ecclesiast')))
    return 'stato_chiese';
  if (ha('libertà religiosa', 'libertà di culto', 'persecuzion', 'blasfemia', 'laicità', 'crocifisso', 'apostasia', 'cristiani perseguitati',
         'religious freedom', 'religious liberty', 'blasphemy', 'persecution', 'church attack', 'anti-conversion'))
    return 'liberta_religiosa';
  if (ha('islam', 'moschea', 'imam', 'ucoii', 'corano', 'ramadan', 'ebraismo', 'ebraica', 'ebraiche', 'sinagoga', 'rabbino', 'shoah', 'kasher', 'shofar',
         'valdes', 'metodist', 'luteran', 'ortodoss', 'patriarcato', 'buddhis', 'buddis', 'induis', 'sikh', 'soka gakkai',
         'avventist', 'pentecostal', 'evangelic', 'protestant', 'testimoni di geova', 'antisemitismo', 'islamofobia',
         'mosque', 'synagogue', 'jewish', 'muslim', 'orthodox church', 'hindu', 'buddhist', 'antisemitism') ||
      (ha('battist') && ha('chies', 'church', 'union')))
    return 'religioni_mondo'; // ex 'confessioni_acattoliche': area unificata in "Religioni"
  if (ha(' papa ', 'pontefice', 'santa sede', 'vaticano', 'vatican', 'curia romana', 'conclave', 'nunzio', 'nunziatura',
         'angelus', 'udienza generale', 'concistoro', 'dicastero', 'enciclica', 'esortazione apostolica',
         'pope ', 'pontiff', 'holy see', 'cardinal') || t.startsWith(' papa '))
    return 'santa_sede';
  if (ha(' cei ', 'conferenza episcopale italiana', 'diocesi di', 'arcidiocesi', 'parrocchi', ' oratorio ', 'caritas',
         'azione cattolica', 'otto x mille') ||
      (ha('vescov', 'diocesi', 'dioces') && ha('itali', 'milano', 'roma', 'napoli', 'torino', 'bologna', 'firenze', 'palermo', 'venezia')))
    return 'chiesa_italia';
  if (ha('vescov', 'diocesi', 'diocese', 'bishop', 'archbishop', 'cattedrale', 'cathedral', 'missionari', 'missionary',
         'pellegrinaggi', 'pilgrimage', 'santuario', 'beatificazion', 'canonizzazion', 'liturgi', 'catechis',
         'chiesa cattolica', 'catholic church', 'clergy', 'clero '))
    return 'religioni_mondo';

  return null;
}

function classifyArticle(article) {
  // Aree = santa_sede, diritto_canonico, stato_chiese, chiesa_italia,
  // confessioni_acattoliche, liberta_religiosa, religioni_mondo.
  // Prima il contenuto; la categoria del feed è solo il ripiego finale.
  const hit = _classifyByContent(_testoNorm(article));
  if (hit) return hit;
  const cat = (article.category || '').toLowerCase();
  if (cat === 'confessioni_acattoliche') return 'religioni_mondo'; // area unificata in "Religioni"
  if (['santa_sede','diritto_canonico','stato_chiese','chiesa_italia',
       'liberta_religiosa','religioni_mondo'].includes(cat)) return cat;
  return 'religioni_mondo';
}

// Segnali religiosi FORTI: uno solo, ovunque compaia, prova la connessione
// reale con la materia (istituzioni, ministri, luoghi e pratiche di culto,
// diritto ecclesiastico, comunità confessionali).
// N.B. confini di parola dove serve: 'inchiesta' contiene 'chies',
// 'febbre'/'celebre' contengono 'ebre', 'interprete' contiene 'prete',
// 'occulto' contiene 'culto', 'Islamabad' contiene 'islam'…
const RELIGIOSO_FORTE = [' chies', ' papa ', 'papato', 'papale', 'pontif', 'vescov', 'cardinal', 'monsignor', 'dioces', 'parroc',
  'religio', 'cattolic', 'cristian', 'catholic', 'christian', 'church', 'pope ', 'bishop',
  'gesù', 'vangelo', 'gospel', 'bibbia', 'bible', 'biblic', 'teolog', 'theolog',
  'liturg', 'omelia', 'angelus', 'giubileo', 'jubilee', 'pellegrin', 'pilgrim', 'santuario', 'abbazia', 'convento',
  'monaster', ' monach', ' monaci ', ' suor', 'frate ', 'frati ', 'gesuit', 'jesuit', 'francescan', 'franciscan', 'domenican',
  'salesian', 'benedettin', 'carmelitan', 'clero', 'clergy', 'sacerdot', 'priest', ' prete ', ' preti ', 'seminarist', 'catechis', 'battesim',
  'eucarist', 'sacrament', 'ecumeni', 'interreligio', 'interfaith',
  'sinodo', 'synod', 'concilio', 'conclave', 'curia', 'nunz', 'dicastero', 'enciclica', 'encyclical', 'magistero',
  'canonic', 'canon law', 'vatican', 'santa sede', 'holy see', 'terra santa', 'holy land', 'santo padre', 'holy father',
  ' islam ', ' islami', 'musulman', 'muslim', 'moschea', 'mosque', 'imam ', 'corano', 'quran', 'ramadan', 'halal',
  'ebraic', 'ebraismo', ' ebre', 'jewish', 'judais', 'rabbin', 'rabbi ', 'sinagoga', 'synagogue', 'torah', 'kasher', 'kosher',
  'shoah', 'antisemit', 'shofar', 'hindu', 'induis', 'buddh', 'buddis', 'sikh', 'ortodoss', 'orthodox', 'patriarc',
  'protestant', 'evangelic', 'luteran', 'lutheran', 'valdes', 'metodist', 'methodist', 'pentecost', 'avventist',
  'mormon', 'testimoni di geova', 'laicità', 'laicismo', 'blasfem', 'blasphem', 'apostasia',
  'ateis', 'atheis', 'uaar', '8 per mille', 'otto per mille', '8xmille', 'concordat', 'caritas', 'santa messa',
  'beata vergine', 'vergine maria', 'immacolata', 'cappellan', 'chaplain', 'pillar post', 'libertà religiosa', 'religious freedom',
  'passionist', 'cappuccin', 'agostinian', 'cistercens', 'trappist', 'comboni', 'dehonian', 'focolar', 'neocatecumen', 'opus dei',
  ' cristo ', 'cristolog', 'christ ', 'preghiera', 'prayer', 'tempo ordinario', 'per annum', 'beata ', 'comandament', 'commandment',
  'celebra messa', 'celebrare messa', 'quaresima', 'pentecoste', ' pasqua', ' natale ', 'epifania', 'easter', ' lent ',
  ' mons ', 'prelat', 'leone xiv', 'leone xiii', 'pio xii', 'yad vashem', 'bokertov', 'seminario diocesan', ' seminarist'];

// Segnali DEBOLI: parole che compaiono spesso anche in articoli profani
// ("santo", "fede", "sacro", "spiritual"…). Da sole non bastano: valgono
// solo nel TITOLO, oppure in coppia.
const RELIGIOSO_DEBOLE = ['faith ', ' fede ', ' dio ', ' god ', 'madonna',
  'worship', 'spiritual', 'secolarizz', 'secular', 'culto ', 'santo ', 'santa ', ' sacro ', 'assunzione', 'precetto',
  'martir', 'martyr', 'processione', 'aborto', 'abortion', 'eutanasia', 'euthanasia', 'bioetic', 'bioethic',
  'surrogata', 'surrogacy', 'pastorale', 'anima '];

// Fuori tema: resta in pagina solo chi ha una connessione religiosa REALE.
// Punteggio: forte nel TITOLO = 3 · forte nel testo = 1,5 l'uno · debole nel
// titolo = 1,5 · debole nel testo = 0,5. Si pubblica con almeno 3 punti (o
// se le parole chiave delle aree agganciano il contenuto). Così un solo
// accenno in fondo alla descrizione non basta più: o l'argomento è religioso
// nel titolo, o il testo ne parla davvero (più segnali indipendenti).
function isFuoriTema(article) {
  const tTitolo = _testoNorm({ title: article.title || '' });
  const tTutto = _testoNorm(article);
  if (_classifyByContent(tTutto)) return false;
  let punti = 0;
  for (const p of RELIGIOSO_FORTE) {
    if (tTitolo.includes(p)) { punti = 3; break; }
    if (tTutto.includes(p)) punti += 1.5;
    if (punti >= 3) break;
  }
  if (punti >= 3) return false;
  for (const p of RELIGIOSO_DEBOLE) {
    if (tTitolo.includes(p)) punti += 1.5;
    else if (tTutto.includes(p)) punti += 0.5;
    if (punti >= 3) return false;
  }
  return punti < 3;
}

// "Caso dubbio": è passato dal punteggio ma il TITOLO da solo non prova
// l'attinenza (né segnale forte né classificazione dal contenuto del titolo).
// Sono gli articoli che entrano grazie alla descrizione — dove si annidano i
// crediti di fonte e le trappole. Su questi decide il giudice AI.
function isCasoDubbio(article) {
  const tTitolo = _testoNorm({ title: article.title || '' });
  if (_classifyByContent(tTitolo)) return false;
  return !RELIGIOSO_FORTE.some(p => tTitolo.includes(p));
}

// GIUDICE AI DI ATTINENZA — secondo livello di controllo. I casi dubbi
// vengono giudicati in blocco da Claude Haiku (attinente sì/no alla materia:
// religioni, chiese, diritto canonico/ecclesiastico, rapporti Stato-fedi).
// Verdetti in cache per titolo: ogni articolo si paga UNA volta sola.
// In caso di errore API si tiene l'articolo (fail-open: mai pagina vuota).
const _attinCache = new Map();
const ATTIN_CACHE_MAX = 4000;
function _attinKey(a) {
  return (a.title || '').toLowerCase().replace(/[^a-zà-ù0-9]/g, '').substring(0, 70);
}
async function filtraAttinenzaAI(items) {
  const dubbi = items.filter(a => isCasoDubbio(a) && !_attinCache.has(_attinKey(a)));
  for (let i = 0; i < dubbi.length; i += 25) {
    if (!canCallClaude('other')) break;
    const batch = dubbi.slice(i, i + 25);
    const voci = batch.map(a => ({ t: (a.title || '').substring(0, 160), d: ((a.desc || a.description || '') + '').replace(/<[^>]+>/g, ' ').substring(0, 200) }));
    try {
      const payload = {
        model: 'claude-haiku-4-5', max_tokens: 400, temperature: 0,
        messages: [{ role: 'user', content:
          'Sei il caporedattore di una testata dedicata ESCLUSIVAMENTE a: religioni e confessioni, chiese e comunità di fede, Santa Sede, diritto canonico ed ecclesiastico, rapporti Stato-religioni, libertà religiosa. ' +
          'Per ogni notizia (titolo t, sommario d) rispondi se è attinente alla testata: true solo se la religione è il tema o una componente REALE della notizia, false se è cronaca/sport/scienza/cultura generica dove la religione è solo citata di sfuggita o assente. ' +
          'Rispondi SOLO con un array JSON di booleani, stesso ordine e stesso numero.\n' + JSON.stringify(voci)
        }]
      };
      const resp = await _callClaude(payload, 30000);
      if (resp.status !== 200) continue;
      const txt = ((JSON.parse(resp.body).content || [])[0] || {}).text || '';
      const m = txt.match(/\[[\s\S]*\]/);
      if (!m) continue;
      const arr = JSON.parse(m[0]);
      if (!Array.isArray(arr) || arr.length !== batch.length) continue;
      batch.forEach((a, j) => {
        if (_attinCache.size >= ATTIN_CACHE_MAX) _attinCache.delete(_attinCache.keys().next().value);
        _attinCache.set(_attinKey(a), arr[j] !== false);
      });
    } catch (e) { /* fail-open */ }
  }
  const scartati = items.filter(a => _attinCache.get(_attinKey(a)) === false).length;
  if (scartati) console.log(`[AttinenzaAI] ${scartati} articoli giudicati fuori tema dal giudice AI`);
  return items.filter(a => _attinCache.get(_attinKey(a)) !== false);
}


// Rate limiter per Claude API
const claudeRateLimit = { count: 0, resetAt: Date.now() + 60000 };
// Hard cap giornaliero per categoria — reset a mezzanotte
// Categorie: 'translate','synthesize','scalata','casi-simili','other'
const CLAUDE_CATEGORIES = ['translate', 'synthesize', 'scalata', 'casi-simili', 'analisi-norme', 'other'];
// Semantica cap:
//  - scalata: pool RISERVATO. La scalata si blocca SOLO se le sue 300 sono esaurite,
//    mai per colpa del totale → le altre categorie non possono affamarla.
//  - total (2000): budget delle categorie NON-scalata (translate/synthesize/casi-simili/analisi-norme/other).
//  - synthesize (1500): sotto-cap alla categoria più vorace (batch L1/L2 auto-run, cron ogni 5').
//  - analisi-norme (200): analisi AI on-demand degli articoli di codice (1 chiamata Haiku/articolo, poi cache).
const CLAUDE_CAPS = { total: 2000, scalata: 300, synthesize: 1500, 'analisi-norme': 200 };
const claudeUsage = {
  date: new Date().toDateString(),
  total: 0,
  byCategory: { translate: 0, synthesize: 0, scalata: 0, 'casi-simili': 0, 'analisi-norme': 0, other: 0 },
};
global._claudeUsage = claudeUsage; // esposto per /api/stats
let _lastCapLog = 0;
function _logCapThrottled(msg) {
  const now = Date.now();
  if (now - _lastCapLog >= 60 * 60 * 1000) { console.error(msg); _lastCapLog = now; }
}
function _resetClaudeUsageIfNewDay() {
  const today = new Date().toDateString();
  if (claudeUsage.date !== today) {
    claudeUsage.date = today;
    claudeUsage.total = 0;
    for (const k of CLAUDE_CATEGORIES) claudeUsage.byCategory[k] = 0;
  }
}
// Verifica (senza consumare) se c'è budget per la categoria. Usata come gate
// nei loop batch per non incrementare due volte il contatore.
function claudeCapAvailable(category) {
  const cat = CLAUDE_CATEGORIES.includes(category) ? category : 'other';
  _resetClaudeUsageIfNewDay();
  if (cat === 'scalata') {
    // Pool riservato, indipendente dal totale.
    return claudeUsage.byCategory.scalata < CLAUDE_CAPS.scalata;
  }
  // Non-scalata: budget totale calcolato ESCLUDENDO la scalata (pool riservato intatto).
  const nonScalata = claudeUsage.total - claudeUsage.byCategory.scalata;
  if (nonScalata >= CLAUDE_CAPS.total) return false;
  if (CLAUDE_CAPS[cat] != null && claudeUsage.byCategory[cat] >= CLAUDE_CAPS[cat]) return false;
  return true;
}
function canCallClaude(category) {
  const cat = CLAUDE_CATEGORIES.includes(category) ? category : 'other';
  const now = Date.now();
  _resetClaudeUsageIfNewDay();
  if (cat === 'scalata') {
    // Pool RISERVATO: la scalata si blocca SOLO se le sue 300 sono esaurite.
    // Mai subordinata al totale → nessuna categoria può affamarla.
    if (claudeUsage.byCategory.scalata >= CLAUDE_CAPS.scalata) {
      _logCapThrottled('[Claude] Cap scalata esaurito (' + CLAUDE_CAPS.scalata + '/giorno)');
      return false;
    }
  } else {
    // Categorie non-scalata: condividono il totale, calcolato ESCLUDENDO la scalata,
    // così il consumo di translate/synthesize/ecc. non intacca il pool riservato.
    const nonScalata = claudeUsage.total - claudeUsage.byCategory.scalata;
    if (nonScalata >= CLAUDE_CAPS.total) {
      _logCapThrottled('[Claude] Cap totale non-scalata esaurito (' + CLAUDE_CAPS.total + '/giorno)');
      return false;
    }
    // Sotto-cap per categoria vorace (es. synthesize: batch L1/L2).
    if (CLAUDE_CAPS[cat] != null && claudeUsage.byCategory[cat] >= CLAUDE_CAPS[cat]) {
      _logCapThrottled('[Claude] Cap ' + cat + ' esaurito (' + CLAUDE_CAPS[cat] + '/giorno)');
      return false;
    }
  }
  // Rate limit per minuto
  if (now > claudeRateLimit.resetAt) { claudeRateLimit.count = 0; claudeRateLimit.resetAt = now + 60000; }
  if (claudeRateLimit.count >= 25) return false;
  claudeRateLimit.count++;
  claudeUsage.total++;
  claudeUsage.byCategory[cat]++;
  return true;
}

// Agent HTTPS dedicato alle chiamate Claude della Scalata v2: pool SEPARATO da
// https.globalAgent (avvelenato dai socket a timeout 5s del feed-health-check).
const _claudeAgent = new https.Agent({ keepAlive: false, maxSockets: 4 });
const _dns = require('dns');
// Lookup DNS via c-ares (dns.resolve4) invece di getaddrinfo/threadpool: il threadpool
// di libuv viene saturato dai molti dns.lookup del feed-check, facendo impiccare la
// risoluzione di api.anthropic.com. c-ares gira sull'event-loop, immune alla saturazione.
function _caresLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  _dns.resolve4(hostname, (err, addrs) => {
    if (err || !addrs || !addrs.length) return _dns.lookup(hostname, options, cb); // fallback
    if (options && options.all) return cb(null, addrs.map(a => ({ address: a, family: 4 })));
    cb(null, addrs[0], 4);
  });
}
function _callClaude(payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ps = JSON.stringify(payload);
    const r = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST', agent: _claudeAgent, lookup: _caresLookup,
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(ps) }
    }, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => resolve({ status: resp.statusCode, body: d })); });
    r.on('error', reject);
    r.setTimeout(timeoutMs, () => { r.destroy(); reject(new Error('timeout')); });
    r.write(ps); r.end();
  });
}

// Cache sintesi articoli (evita chiamate duplicate)
const synthesisCache = new Map();
global._synthesisCache = synthesisCache; // esposto per runBatchL1L2
var _scalataHandlers = {}; // scalata giuridica handlers (var per hoisting)

const PORT = 3202;

// ── CIRCUIT BREAKER ──
const feedHealth = {};
const BOOT_TIME = Date.now();
const BOOT_GRACE_MS = 8 * 60 * 1000; // 8 minuti di grazia al boot — no circuit breaker

function isBootPhase() { return Date.now() - BOOT_TIME < BOOT_GRACE_MS; }

function isCircuitOpen(url) {
  if (isBootPhase()) return false; // durante il boot non bloccare nulla
  const h = feedHealth[url];
  if (!h) return false;
  if (h.failures >= 5 && Date.now() < h.disabledUntil) return true;
  return false;
}
function recordFeedSuccess(url) {
  if (feedHealth[url]) feedHealth[url].failures = 0;
}
function recordFeedFailure(url, name) {
  if (isBootPhase()) return; // durante il boot non accumulare failures
  if (!feedHealth[url]) feedHealth[url] = { failures: 0, disabledUntil: 0 };
  feedHealth[url].failures++;
  if (feedHealth[url].failures >= 5) {
    feedHealth[url].disabledUntil = Date.now() + 1800000;
    console.log(`[CIRCUIT OPEN] ${name} — disabled for 30min`);
  }
}
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: '__cdata',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ['item','entry','link'].includes(name),
  processEntities: { enabled: true, maxEntityCount: 5000, maxTotalExpansions: 10000, maxExpandedLength: 500000 },
});

// Feed con campo lang aggiunto
const FEEDS = [
  // === A. SANTA SEDE E VATICANO ===
  {n:'Vatican News IT',u:'https://www.vaticannews.va/it.rss.xml',c:'santa_sede',lang:'it',priority:10},
  {n:'ACI Stampa',u:'https://www.acistampa.com/rss',c:'santa_sede',lang:'it',priority:9},
  {n:'Korazym',u:'https://www.korazym.org/feed/',c:'santa_sede',lang:'it',priority:7},
  {n:'Crux',u:'https://wp.cruxnow.com/feed/',c:'santa_sede',lang:'en',priority:8},
  {n:'The Pillar',u:'https://www.pillarcatholic.com/feed',c:'diritto_canonico',lang:'en',priority:8},

  // === B. CHIESA CATTOLICA IN ITALIA ===
  {n:'AgenSIR',u:'https://www.agensir.it/feed/',c:'chiesa_italia',lang:'it',priority:9},
  {n:'SettimanaNews',u:'https://www.settimananews.it/feed/',c:'chiesa_italia',lang:'it',priority:8},
  {n:'Adista',u:'https://www.adista.it/rss',c:'chiesa_italia',lang:'it',priority:7},

  // === C. CONFESSIONI DIVERSE DALLA CATTOLICA IN ITALIA ===
  {n:'Riforma.it (Valdesi/Protestanti)',u:'https://riforma.it/feed/',c:'confessioni_acattoliche',lang:'it',priority:8},
  {n:'Moked (Ebraismo — UCEI)',u:'https://moked.it/feed/',c:'confessioni_acattoliche',lang:'it',priority:8},
  {n:'UAAR Ultimissime',u:'https://blog.uaar.it/feed/',c:'liberta_religiosa',lang:'it',priority:6},

  // === D. RELIGIONI NEL MONDO ===
  {n:'Religion News Service',u:'https://religionnews.com/feed/',c:'religioni_mondo',lang:'en',priority:8},
  {n:'Catholic News Agency',u:'https://www.ewtnnews.com/rss?redirectedfrom=cna',c:'religioni_mondo',lang:'en',priority:7},

  // === E. GOOGLE NEWS — DIRITTO CANONICO ED ECCLESIASTICO ===
  {n:'GN Diritto Canonico',u:'https://news.google.com/rss/search?q=%22diritto+canonico%22+OR+%22tribunale+ecclesiastico%22+OR+%22Rota+Romana%22&hl=it&gl=IT&ceid=IT:it',c:'diritto_canonico',lang:'it',priority:10},
  {n:'GN Diritto Ecclesiastico',u:'https://news.google.com/rss/search?q=%22diritto+ecclesiastico%22+OR+%22ente+ecclesiastico%22+OR+concordato+chiesa&hl=it&gl=IT&ceid=IT:it',c:'stato_chiese',lang:'it',priority:10},
  {n:'GN 8 per mille',u:'https://news.google.com/rss/search?q=%228+per+mille%22+OR+%22otto+per+mille%22&hl=it&gl=IT&ceid=IT:it',c:'stato_chiese',lang:'it',priority:9},
  {n:'GN Intese confessioni',u:'https://news.google.com/rss/search?q=intesa+confessione+religiosa+OR+%22articolo+8+costituzione%22&hl=it&gl=IT&ceid=IT:it',c:'stato_chiese',lang:'it',priority:9},
  {n:'GN Matrimonio concordatario',u:'https://news.google.com/rss/search?q=%22matrimonio+concordatario%22+OR+delibazione+OR+%22nullit%C3%A0+matrimoniale%22&hl=it&gl=IT&ceid=IT:it',c:'diritto_canonico',lang:'it',priority:9},
  {n:'GN Vaticano Santa Sede',u:'https://news.google.com/rss/search?q=Vaticano+OR+%22Santa+Sede%22+OR+Papa&hl=it&gl=IT&ceid=IT:it',c:'santa_sede',lang:'it',priority:9},
  {n:'GN CEI Vescovi',u:'https://news.google.com/rss/search?q=CEI+vescovi+OR+%22conferenza+episcopale%22&hl=it&gl=IT&ceid=IT:it',c:'chiesa_italia',lang:'it',priority:8},
  {n:'GN Libertà religiosa',u:'https://news.google.com/rss/search?q=%22libert%C3%A0+religiosa%22+OR+%22libert%C3%A0+di+culto%22&hl=it&gl=IT&ceid=IT:it',c:'liberta_religiosa',lang:'it',priority:9},
  {n:'GN Islam Italia',u:'https://news.google.com/rss/search?q=islam+Italia+moschea+OR+imam+OR+UCOII&hl=it&gl=IT&ceid=IT:it',c:'confessioni_acattoliche',lang:'it',priority:8},
  {n:'GN Ebraismo Italia',u:'https://news.google.com/rss/search?q=ebraismo+Italia+OR+sinagoga+OR+%22comunit%C3%A0+ebraica%22&hl=it&gl=IT&ceid=IT:it',c:'confessioni_acattoliche',lang:'it',priority:8},
  {n:'GN Ortodossi Italia',u:'https://news.google.com/rss/search?q=%22chiesa+ortodossa%22+Italia&hl=it&gl=IT&ceid=IT:it',c:'confessioni_acattoliche',lang:'it',priority:7},
  {n:'GN Evangelici Italia',u:'https://news.google.com/rss/search?q=evangelici+OR+valdesi+OR+battisti+OR+luterani+Italia&hl=it&gl=IT&ceid=IT:it',c:'confessioni_acattoliche',lang:'it',priority:7},
  {n:'GN Buddhismo Induismo Italia',u:'https://news.google.com/rss/search?q=buddhismo+OR+induismo+OR+%22Soka+Gakkai%22+Italia&hl=it&gl=IT&ceid=IT:it',c:'confessioni_acattoliche',lang:'it',priority:6},
  {n:'GN Enti ecclesiastici fisco',u:'https://news.google.com/rss/search?q=%22ente+ecclesiastico%22+OR+IMU+chiesa+OR+esenzione+enti+religiosi&hl=it&gl=IT&ceid=IT:it',c:'stato_chiese',lang:'it',priority:8},
  {n:'GN Ora di religione laicità',u:'https://news.google.com/rss/search?q=%22ora+di+religione%22+OR+laicit%C3%A0+Stato+OR+crocifisso+aula&hl=it&gl=IT&ceid=IT:it',c:'liberta_religiosa',lang:'it',priority:7},
  {n:'GN Ministri di culto',u:'https://news.google.com/rss/search?q=%22ministro+di+culto%22+OR+%22edifici+di+culto%22&hl=it&gl=IT&ceid=IT:it',c:'stato_chiese',lang:'it',priority:7},
  {n:'GN Canon Law EN',u:'https://news.google.com/rss/search?q=%22canon+law%22+OR+%22canonical%22+church+trial&hl=en&gl=US&ceid=US:en',c:'diritto_canonico',lang:'en',priority:8},
  {n:'GN Religious Freedom EN',u:'https://news.google.com/rss/search?q=%22religious+freedom%22+OR+%22religious+liberty%22&hl=en&gl=US&ceid=US:en',c:'liberta_religiosa',lang:'en',priority:7},
  {n:'GN Holy See Diplomacy EN',u:'https://news.google.com/rss/search?q=%22Holy+See%22+OR+Vatican+diplomacy+OR+nuncio&hl=en&gl=US&ceid=US:en',c:'santa_sede',lang:'en',priority:7},
  {n:'GN World Religions EN',u:'https://news.google.com/rss/search?q=religion+law+OR+church+state+OR+blasphemy+law&hl=en&gl=US&ceid=US:en',c:'religioni_mondo',lang:'en',priority:6},
];

let cache = { articles: [], ts: 0, sources: 0 };
const CACHE_TTL = 5 * 60 * 1000; // aggiornamento ogni 5 minuti

// ── ARTICOLI PERSISTENTI ──
// Accumula articoli tra i refresh — non butta via quelli non più nel feed
// Key: URL normalizzato → articolo; scadono dopo MAX_AGE
const persistentArticles = new Map(); // url → article
const PERSIST_MAX_AGE_NEWS = 96 * 3600 * 1000;       // 96h per news
const PERSIST_MAX_AGE_EVERGREEN = 7 * 24 * 3600 * 1000; // 7gg per evergreen
const EVERGREEN_CATS = new Set(['sport','cultura','scienza','cinema','gaming','musica','motori','salute','tech']);

function addToPersistent(articles) {
  const now = Date.now();
  for (const a of articles) {
    const key = (a.url || a.link || '');
    if (!key) continue;
    persistentArticles.set(key, { ...a, _addedAt: now });
  }
}

function getPersistentArticles() {
  const now = Date.now();
  const result = [];
  for (const [key, a] of persistentArticles) {
    const maxAge = EVERGREEN_CATS.has(a.category) ? PERSIST_MAX_AGE_EVERGREEN : PERSIST_MAX_AGE_NEWS;
    const articleAge = now - new Date(a.date || a._addedAt).getTime();
    if (articleAge > maxAge) { persistentArticles.delete(key); continue; }
    result.push(a);
  }
  return result;
}

// ── TRADUZIONE BATCH ──
// Traduci in batch con rate limiting per evitare blocchi Google
// Traduzione: LibreTranslate self-hosted (porta 5000) se presente, altrimenti
// fallback su Claude Haiku (categoria budget 'translate').
async function translateOne(text, fromLang, retries = 1) {
  if (!text || text.length < 3) return text;
  const truncated = text.substring(0, 500);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const body = JSON.stringify({ q: truncated, source: fromLang, target: 'it', format: 'text' });
      const result = await postUrl('http://127.0.0.1:5000/translate', body, 8000);
      const data = JSON.parse(result);
      if (data.translatedText && data.translatedText.length > 2) {
        return data.translatedText;
      }
      break; // LibreTranslate risponde ma non traduce → prova Claude
    } catch(e) {
      if (attempt < retries) await new Promise(r => setTimeout(r, 500));
    }
  }
  // Fallback Claude Haiku
  try {
    const batch = await translateBatchClaude([{ t: truncated, d: '' }], fromLang);
    if (batch && batch[0] && batch[0].t) return batch[0].t;
  } catch(_) {}
  return null;
}

// ── Traduzione batch via Claude Haiku ───────────────────────────────────────
// Traduce fino a ~15 titoli+descrizioni per chiamata (JSON in/out). Usata dal
// refresh dei feed per le fonti straniere e come fallback di translateOne.
async function translateBatchClaude(items, fromLang) {
  if (!items.length) return null;
  if (!canCallClaude('translate')) return null;
  // max_tokens proporzionale al testo da tradurre (i blocchi integrali del
  // "tasto Traduci" superano di molto i titoli del refresh).
  const _chars = items.reduce((n, i) => n + ((i.t || '').length + (i.d || '').length), 0);
  const payload = {
    model: 'claude-haiku-4-5', max_tokens: Math.min(8000, Math.max(2500, Math.ceil(_chars * 0.7) + 400)), temperature: 0,
    messages: [{ role: 'user', content:
      'Traduci in italiano giornalistico questi titoli (t) e sommari (d) di notizie (lingua di origine: ' + fromLang + '). ' +
      'Rispondi SOLO con un array JSON nello stesso ordine, stessi campi, senza commenti.\n' +
      JSON.stringify(items.map(i => ({ t: (i.t || '').substring(0, 300), d: (i.d || '').substring(0, 400) })))
    }]
  };
  try {
    const resp = await _callClaude(payload, 30000);
    if (resp.status !== 200) return null;
    const body = JSON.parse(resp.body);
    const txt = ((body.content || [])[0] || {}).text || '';
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) && arr.length === items.length ? arr : null;
  } catch (_) { return null; }
}

// Cache delle traduzioni integrali (tasto "Traduci"): chiave = hash del testo.
// Il secondo lettore dello stesso articolo riceve la traduzione all'istante.
const _translFullCache = new Map();

// Traduzione INTEGRALE di blocchi di testo lunghi (tasto "Traduci articolo").
// Distinta da translateBatchClaude, che è tarata sui titoli e TRONCA a 300
// caratteri: qui i blocchi passano interi e il prompt vieta di riassumere.
async function translateFullClaude(blocchi, fromLang) {
  if (!blocchi.length) return null;
  if (!canCallClaude('translate')) return null;
  const _chars = blocchi.reduce((n, b) => n + b.length, 0);
  const payload = {
    model: 'claude-haiku-4-5',
    max_tokens: Math.min(8000, Math.ceil(_chars * 0.9) + 500),
    temperature: 0,
    messages: [{ role: 'user', content:
      'Traduci INTEGRALMENTE in italiano giornalistico i seguenti blocchi di testo (lingua di origine: ' + fromLang + '). ' +
      'Non riassumere, non omettere frasi, non accorciare: ogni blocco tradotto deve coprire tutto il contenuto del blocco originale. ' +
      'Rispondi SOLO con un array JSON di stringhe, stesso ordine e stesso numero di elementi, senza commenti.\n' +
      JSON.stringify(blocchi)
    }]
  };
  try {
    const resp = await _callClaude(payload, 45000);
    if (resp.status !== 200) return null;
    const body = JSON.parse(resp.body);
    const txt = ((body.content || [])[0] || {}).text || '';
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) && arr.length === blocchi.length ? arr.map(String) : null;
  } catch (_) { return null; }
}

// Cache persistente delle traduzioni (per URL) — evita di ritradurre lo stesso
// articolo a ogni refresh dei feed (ogni 5 min). Salvata su disco
// (data/traduzioni.json) così sopravvive ai riavvii: senza, ogni pm2 restart
// ricostruiva tutto da capo e la home restava vuota per ~2 minuti.
const _translCache = new Map();
const TRANSL_CACHE_MAX = 4000;
const TRANSL_CACHE_PATH = require('path').join(__dirname, 'data', 'traduzioni.json');
try {
  const salvate = JSON.parse(require('fs').readFileSync(TRANSL_CACHE_PATH, 'utf8'));
  for (const [k, v] of salvate) _translCache.set(k, v);
  console.log(`[Traduzioni] ${_translCache.size} traduzioni ricaricate da disco`);
} catch (_) {}
let _translDirty = false;
function salvaTraduzioni() {
  if (!_translDirty) return;
  _translDirty = false;
  try {
    require('fs').mkdirSync(require('path').dirname(TRANSL_CACHE_PATH), { recursive: true });
    require('fs').writeFileSync(TRANSL_CACHE_PATH, JSON.stringify([..._translCache]));
  } catch (_) {}
}
setInterval(salvaTraduzioni, 60 * 1000).unref();
function _translCacheSet(k, v) {
  if (_translCache.size >= TRANSL_CACHE_MAX) {
    const first = _translCache.keys().next().value;
    _translCache.delete(first);
  }
  _translCache.set(k, v);
  _translDirty = true;
}

function postUrl(url, body, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const opts = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: timeoutMs
      };
      const req = mod.request(opts, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
            const buf = Buffer.concat(chunks);
            const ct = (res.headers['content-type'] || '').toLowerCase();
            // Segnala PDF/binario con marker speciale
            if (ct.includes('pdf') || ct.includes('octet-stream') || ct.includes('binary')) {
              resolve('__BINARY__');
            } else {
              // Prova utf8, poi latin1
              const text = buf.toString('utf8');
              resolve(text);
            }
          });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body);
      req.end();
    } catch(e) { reject(e); }
  });
}

async function translateBatch(texts, fromLang) {
  const results = [];
  for (const text of texts) {
    results.push(await translateOne(text, fromLang));
    await new Promise(r => setTimeout(r, 10));
  }
  return results;
}

async function translateArticles(articles, feedName, fromLang) {
  if (!articles.length) return articles;
  // Limita a 200 articoli per ciclo (i più recenti)
  if (articles.length > 200) articles = articles.slice(0, 200);
  const titles = articles.map(a => a.title);
  // Traduco SOLO i titoli (non le desc) per ridurre le chiamate a Google
  try {
    const translatedTitles = await translateBatch(titles, fromLang);
    return articles.map((a, i) => {
      const tTitle = translatedTitles[i];
      if (!tTitle) {
        console.log(`TRADUZIONE FALLITA per ${feedName}: ${a.title.substring(0,50)}`);
        return { ...a, lang: fromLang, translated: false };
      }
      return {
        ...a,
        title: tTitle,
        titleOriginal: a.title,
        lang: fromLang,
        translated: true
      };
    });
  } catch(e) {
    console.log(`TRADUZIONE BATCH FALLITA per ${feedName}: ${e.message}`);
    return articles.map(a => ({ ...a, lang: fromLang, translated: false }));
  }
}

function fetchUrl(url, redirects = 0, extraHeaders = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; EdicolaBot/2.0)',
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*',
          ...extraHeaders
        },
        timeout: timeoutMs
      }, res => {
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          const loc = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          return fetchUrl(loc, redirects + 1, extraHeaders, timeoutMs).then(resolve).catch(reject);
        }
        if (res.statusCode === 403 || res.statusCode === 401) {
          return reject(new Error('HTTP_' + res.statusCode));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
            const buf = Buffer.concat(chunks);
            const ct = (res.headers['content-type'] || '').toLowerCase();
            // Segnala PDF/binario con marker speciale
            if (ct.includes('pdf') || ct.includes('octet-stream') || ct.includes('binary')) {
              resolve('__BINARY__');
            } else {
              // Prova utf8, poi latin1
              const text = buf.toString('utf8');
              resolve(text);
            }
          });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    } catch(e) { reject(e); }
  });
}

function getText(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return getText(val[0]);
  if (typeof val === 'object') {
    if (val['__cdata']) return String(val['__cdata']);
    if (val['#text']) return String(val['#text']);
    if (val['@_href']) return String(val['@_href']);
    if (val['@_url']) return String(val['@_url']);
  }
  return '';
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&apos;/g,"'")
    .replace(/&nbsp;/g,' ').replace(/&rsquo;/g,"'").replace(/&lsquo;/g,"'")
    .replace(/&ldquo;/g,'"').replace(/&rdquo;/g,'"').replace(/&ndash;/g,'–')
    .replace(/&mdash;/g,'—').replace(/&hellip;/g,'…');
}

function stripHtml(s) {
  return decodeEntities(
    String(s)
      .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
      .replace(/<[^>]+>/g, '')
  ).replace(/\s+/g,' ').trim();
}

async function parseFeed(feed) {
  if (isCircuitOpen(feed.u)) {
    return [];
  }
  try {
    const xml = await fetchUrl(feed.u, 0, {}, 8000);
    recordFeedSuccess(feed.u);
    const data = parser.parse(xml);

    let items = [];
    // RSS 2.0 — items sempre array grazie a isArray config
    if (data?.rss?.channel?.item) {
      items = data.rss.channel.item;
    }
    // Atom
    else if (data?.feed?.entry) {
      items = data.feed.entry;
    }
    // RDF
    else if (data?.['rdf:RDF']?.item) {
      items = data['rdf:RDF'].item;
    }

    const articles = [];
    items.slice(0, 50).forEach(it => {
      if (!it || typeof it !== 'object') return;

      const title = stripHtml(getText(it.title));
      if (!title || title.length < 3) return;

      // link: può essere stringa, oggetto con @_href, o array
      let link = '';
      if (Array.isArray(it.link)) {
        const alt = it.link.find(l => l['@_rel'] === 'alternate' || !l['@_rel']);
        link = alt ? (alt['@_href'] || getText(alt)) : getText(it.link[0]);
      } else {
        link = getText(it.link) || it.link?.['@_href'] || '';
      }
      // Google News: il link reale è codificato in base64 nel path dell'URL GN.
      // Formato: https://news.google.com/rss/articles/CBMi<base64>...
      // Possiamo anche cercarlo nel campo <guid> o decodificando il base64 GN (instabile).
      // Soluzione robusta: se feed GN, tenta resolve redirect con fetch HEAD (lazy, solo al momento della Scalata).

      const rawDesc = getText(it.description || it.summary || it['content:encoded'] || it.content || '');
      const desc = stripHtml(rawDesc).substring(0, 800);

      const rawDate = getText(it.pubDate || it.published || it.updated || it['dc:date'] || '');
      let date = rawDate ? new Date(rawDate) : new Date();
      // Correggi date future (max 2 ore nel futuro) — bug di alcuni CMS
      const now = new Date();
      if (date.getTime() > now.getTime() + 2 * 3600 * 1000) date = now;
      const dateStr = isNaN(date.getTime()) ? now.toISOString() : date.toISOString();

      const idSrc = (title + feed.n).substring(0, 80);
      const id = Buffer.from(idSrc).toString('base64url').replace(/[^a-zA-Z0-9]/g,'').substring(0,40);

      // YouTube videoId — presente nei feed YouTube come <yt:videoId>
      let videoId = '';
      if (feed.u.includes('youtube.com/feeds')) {
        videoId = getText(it['yt:videoId'] || '') || '';
        // fallback: estrai da link
        if (!videoId && link.includes('v=')) {
          const m = link.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
          if (m) videoId = m[1];
        }
        if (!videoId && link.includes('youtu.be/')) {
          const m = link.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
          if (m) videoId = m[1];
        }
      }

      // thumbnail YouTube
      let thumb = '';
      if (videoId) thumb = 'https://img.youtube.com/vi/' + videoId + '/mqdefault.jpg';

      // Immagine da enclosure, media:content, media:thumbnail, og:image nel desc
      if (!thumb) {
        // enclosure (RSS standard)
        const enc = it.enclosure;
        if (enc) {
          const encUrl = enc['@_url'] || getText(enc);
          if (encUrl && /\.(jpg|jpeg|png|webp|gif)/i.test(encUrl)) thumb = encUrl;
        }
        // media:content
        if (!thumb) {
          const mc = it['media:content'] || it['media:thumbnail'];
          if (mc) {
            const mcUrl = mc['@_url'] || (Array.isArray(mc) ? mc[0]?.['@_url'] : '');
            if (mcUrl && /\.(jpg|jpeg|png|webp|gif)/i.test(mcUrl)) thumb = mcUrl;
          }
        }
        // og:image nel rawDesc
        if (!thumb) {
          const ogMatch = rawDesc.match(/https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|webp)(\?[^\s"'<>]*)?/i);
          if (ogMatch) thumb = ogMatch[0];
        }
      }

      // Fonte reale: per feed Google News estrai il tag <source> dell'item
      // Google News RSS: <source url="https://www.repubblica.it">La Repubblica</source>
      // fast-xml-parser lo parsa come: { "#text": "La Repubblica", "@_url": "https://..." }
      let sourceName = feed.n;
      const isGoogleNews = feed.u && feed.u.includes('news.google.com');
      if (isGoogleNews && it.source) {
        const gnSource = typeof it.source === 'object'
          ? (it.source['#text'] || it.source['_'] || '')
          : String(it.source);
        if (gnSource && gnSource.length > 1) sourceName = gnSource;
      }

      // Per feed GNews: salva source_url per uso successivo (Scalata, fetch-content)
      let sourceUrl = '';
      if (isGoogleNews && it.source && typeof it.source === 'object') {
        sourceUrl = it.source['@_url'] || it.source['@url'] || '';
      }

      const _artObj = { id, title, link, desc, date: dateStr, source: sourceName, feed_name: feed.n, category: feed.c, lang: feed.lang || 'it', videoId, thumb, source_url: sourceUrl };
      articles.push(_artObj);
      // (Sprint 1) link-builder rimosso — nessun collegamento notizia→codici in fase di parse
    });

    return articles;
  } catch(e) {
    recordFeedFailure(feed.u, feed.n);
    return [];
  }
}

// Pool di fetch con concorrenza limitata
async function pooledFetch(feeds, concurrency = 35) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < feeds.length) {
      const i = idx++;
      try {
        const arts = await parseFeed(feeds[i]);
        results[i] = { status: 'fulfilled', value: arts };
      } catch(e) {
        results[i] = { status: 'rejected', reason: e };
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, feeds.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function refreshFeeds() {
  const start = Date.now();
  const results = await pooledFetch(FEEDS, 35);
  let all = []; let ok = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.length > 0) {
      all.push(...r.value); ok++;
    }
  });

  // GNews API — articoli extra in memoria (ogni ciclo, max 95/giorno)
  const gnewsArts = await fetchGNewsArticles();
  if (gnewsArts.length > 0) all.push(...gnewsArts);

  // Aggiungi articoli persistenti dal ciclo precedente
  const persisted = getPersistentArticles();
  if (persisted.length > 0) all.push(...persisted);

  // Filtra titoli spazzatura (troppo corti, solo numeri, placeholder)
  all = all.filter(a => {
    const t = (a.title || '').trim();
    if (t.length < 12) return false;
    if (/^[\d\s\-_.,]+$/.test(t)) return false;
    if (/^(untitled|no title|breaking|update|live|feed|\.\.\.)$/i.test(t)) return false;
    return true;
  });

  // Dedup per URL PRIMA di quella per titolo: lo stesso articolo può esserci
  // due volte con titoli diversi (fresco in lingua originale + versione in
  // cache già tradotta) e la dedup per titolo non li aggancia. A parità di
  // link vince la copia già tradotta (risparmia anche traduzioni).
  {
    const byLink = new Map();
    const dropLink = new Set();
    all.forEach((a, idx) => {
      const link = (a.link || '').trim();
      if (!link) return;
      if (byLink.has(link)) {
        const prevIdx = byLink.get(link);
        if (!all[prevIdx].translated && a.translated) {
          dropLink.add(prevIdx);
          byLink.set(link, idx);
        } else {
          dropLink.add(idx);
        }
      } else {
        byLink.set(link, idx);
      }
    });
    if (dropLink.size) all = all.filter((_, idx) => !dropLink.has(idx));
  }

  // Dedup aggressiva: normalizza titolo (minuscolo, no punteggiatura, no spazi)
  // Confronta primi 60 chars — cattura duplicati anche con piccole variazioni
  // Per feed Google News: preferisci l'URL diretto rispetto al redirect GN
  const seen = new Map(); // normalized -> index in array
  const toRemove = new Set();
  all.forEach((a, idx) => {
    const normalized = (a.title || '')
      .toLowerCase()
      .replace(/[^a-z0-9àèéìòùáéíóú]/g, '')
      .substring(0, 60);
    if (!normalized) { toRemove.add(idx); return; }
    if (seen.has(normalized)) {
      const prevIdx = seen.get(normalized);
      const prev = all[prevIdx];
      // Preferisci URL diretto (non Google News) rispetto a redirect GN
      const prevIsGN = prev.link && prev.link.includes('news.google.com');
      const currIsGN = a.link && a.link.includes('news.google.com');
      if (prevIsGN && !currIsGN) {
        // Sostituisci il precedente GN con quello diretto
        toRemove.add(prevIdx);
        seen.set(normalized, idx);
      } else {
        toRemove.add(idx);
      }
    } else {
      seen.set(normalized, idx);
    }
  });
  all = all.filter((_, idx) => !toRemove.has(idx));

  // Traduzione articoli stranieri — raggruppa per feed/lingua
  const toTranslate = {};
  const italiani = [];
  all.forEach(a => {
    if (!a.lang || a.lang === 'it') { italiani.push(a); return; }
    if (!toTranslate[a.lang]) toTranslate[a.lang] = [];
    toTranslate[a.lang].push(a);
  });

  // Traduzione automatica in italiano dei titoli/sommari stranieri.
  // Cache per URL (mai due traduzioni dello stesso articolo); batch da 15 per
  // chiamata Claude; se il budget 'translate' è esaurito l'articolo resta in
  // lingua originale e verrà ritentato al refresh successivo.
  const translated = [];
  // Le traduzioni non devono MAI bloccare la pubblicazione: al massimo
  // MAX_BATCH_TRADUZIONE lotti per ciclo di refresh; il resto esce in lingua
  // originale e viene tradotto nei giri successivi (ogni 5 minuti).
  const MAX_BATCH_TRADUZIONE = 8;
  let _lottiFatti = 0;
  for (const [lang, arts] of Object.entries(toTranslate)) {
    const daFare = [];
    for (const a of arts) {
      const key = a.url || a.link || a.title;
      const hit = _translCache.get(key);
      if (hit) {
        translated.push({ ...a, title: hit.t, desc: hit.d || a.desc, title_original: a.title, translated: true });
      } else {
        daFare.push(a);
      }
    }
    for (let i = 0; i < daFare.length; i += 15) {
      const blocco = daFare.slice(i, i + 15);
      if (_lottiFatti >= MAX_BATCH_TRADUZIONE) {
        blocco.forEach((a) => translated.push({ ...a, translated: false }));
        continue;
      }
      let out = null;
      try {
        out = await translateBatchClaude(blocco.map(a => ({ t: a.title, d: a.desc || '' })), lang);
      } catch (_) {}
      _lottiFatti++;
      blocco.forEach((a, j) => {
        const tr = out && out[j];
        if (tr && tr.t) {
          const key = a.url || a.link || a.title;
          _translCacheSet(key, { t: tr.t, d: tr.d || '' });
          translated.push({ ...a, title: tr.t, desc: tr.d || a.desc, title_original: a.title, translated: true });
        } else {
          translated.push({ ...a, translated: false });
        }
      });
    }
  }

  all = [...italiani, ...translated];
  // Riclassificazione a valle della traduzione: il titolo tradotto in italiano
  // permette alle parole chiave di lavorare anche sugli articoli esteri,
  // invece di fidarsi alla cieca della categoria del feed.
  all.forEach(a => { a.area_diritto = classifyArticle(a); });
  // Fuori tema: le fonti specializzate a volte pubblicano pezzi che con la
  // materia ecclesiastica non c'entrano nulla (musica, salute, sport, borsa).
  all = all.filter(a => !isFuoriTema(a));
  // Secondo livello: i casi dubbi (attinenza provata solo dalla descrizione)
  // passano dal giudice AI, con verdetti in cache — vedi filtraAttinenzaAI.
  try { all = await filtraAttinenzaAI(all); } catch (e) { console.warn('[AttinenzaAI] salto:', e.message); }
  // Seconda dedup per titolo, ORA che i titoli sono tutti in italiano
  // (prende la stessa notizia arrivata con link diversi, es. GNews vs diretto).
  {
    const seenT = new Set();
    all = all.filter(a => {
      const norm = (a.title || '').toLowerCase().replace(/[^a-z0-9àèéìòùáéíóú]/g, '').substring(0, 60);
      if (!norm) return false;
      if (seenT.has(norm)) return false;
      seenT.add(norm);
      return true;
    });
  }
  all.sort((a,b) => new Date(b.date) - new Date(a.date));

  // Filtra notizie troppo vecchie dalla homepage (max 96h)
  // Le categorie live non hanno limite
  const cutoff48h = new Date(Date.now() - 96 * 3600 * 1000);
  const cutoff7d  = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const evergreen = new Set(["sport","cultura","scienza","cinema","gaming","musica","motori","salute","tech"]);
  all = all.filter(a => {
    if (a.category === 'live') return true;
    const cutoff = evergreen.has(a.category) ? cutoff7d : cutoff48h;
    return new Date(a.date) >= cutoff;
  });

  // Salva nella cache persistente per il prossimo ciclo
  addToPersistent(all);

  cache = { articles: all, ts: Date.now(), sources: ok };
  // Persisti news nel DB (upsert batch)
  try {
    const dbPersist = getCodiciDBW();
    if (dbPersist) {
      const insertNewsOnly = dbPersist.prepare(
        'INSERT OR IGNORE INTO news (url,title,description,source_name,published_at,area_diritto) VALUES (?,?,?,?,?,?)'
      );
      // Aggiorna source_url per notizie GNews (usato per fetch-content)
      const updateSourceUrl = dbPersist.prepare(
        'UPDATE news SET source_url=? WHERE title=? AND (source_url IS NULL OR source_url = \'\')'
      );
      const updateNewsBase = dbPersist.prepare(
        'UPDATE news SET description=?,area_diritto=?,updated_at=CURRENT_TIMESTAMP WHERE title=? AND l1_fatto IS NULL'
      );
      const txPersist = dbPersist.transaction((items) => {
        for (const a of items) {
          var aUrl = a.url||a.link||'';
          var aTitle = a.title||'';
          var aDesc = a.desc||a.snippet||a.description||'';
          var aSrc = a.source||a.feed_name||'';
          var aDate = a.date||'';
          var aArea = a.area_diritto||classifyArticle(a)||'';
          if (!aTitle) continue;
          insertNewsOnly.run(aUrl, aTitle, aDesc, aSrc, aDate, aArea);
          updateNewsBase.run(aDesc, aArea, aTitle);
          if (a.source_url) updateSourceUrl.run(a.source_url, aTitle);
        }
      });
      txPersist(all);
    }
  } catch(e) { console.warn('[DB] Persist news err:', e.message); }
  const elapsed = ((Date.now()-start)/1000).toFixed(1);
  const trCount = translated.filter(a => a.translated).length;
  console.log(`[${new Date().toLocaleTimeString('it-IT')}] Refresh: ${ok}/${FEEDS.length} fonti OK, ${all.length} articoli (${trCount} tradotti) (${elapsed}s)`);
}

// ── GOOGLE NEWS URL RESOLVER ──
function resolveGoogleNewsUrl(gnUrl) {
  return new Promise((resolve) => {
    // Metodo 1 (primario): segui redirect HTTP con browser-like headers
    const mod = gnUrl.startsWith('https') ? https : http;
    const req = mod.get(gnUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'it-IT,it;q=0.9',
      },
      timeout: 15000,
    }, res => {
      // Redirect diretto
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location;
        if (loc && !loc.includes('news.google.com') && loc.length > 15) {
          res.resume();
          resolve(loc);
          return;
        }
      }
      // Cerca URL nel body (meta refresh, JS redirect, o data-redirect)
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; if (body.length > 50000) res.destroy(); });
      res.on('end', () => {
        // Pattern: data-n-au="https://..." (Google News article URL)
        const dataN = body.match(/data-n-au="(https?:\/\/[^"]+)"/i);
        if (dataN && !dataN[1].includes('news.google.com')) { resolve(dataN[1]); return; }
        // Pattern: meta http-equiv="refresh" content="...url=https://..."
        const meta = body.match(/url=["']?(https?:\/\/[^"'\s>]+)/i);
        if (meta && !meta[1].includes('news.google.com')) { resolve(meta[1]); return; }
        // Pattern: window.location = "..."
        const jsRedir = body.match(/window\.location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)/i);
        if (jsRedir && !jsRedir[1].includes('news.google.com')) { resolve(jsRedir[1]); return; }
        // Pattern: href="https://..." con testo significativo (non nav)
        const allLinks = [];
        const linkRe = /href="(https?:\/\/(?!.*news\.google\.com)[^"]{20,})"/gi;
        let lm;
        while ((lm = linkRe.exec(body)) !== null) {
          if (!/google\.|gstatic|youtube|googleapis/.test(lm[1])) allLinks.push(lm[1]);
        }
        if (allLinks.length === 1) { resolve(allLinks[0]); return; }
        // Metodo 2 (fallback): decodifica base64
        try {
          const gnMatch = gnUrl.match(/\/articles\/([A-Za-z0-9_-]+)/);
          if (gnMatch) {
            const b64 = gnMatch[1].replace(/-/g,'+').replace(/_/g,'/');
            const raw = Buffer.from(b64, 'base64').toString('utf8');
            const found = raw.match(/https?:\/\/[^\x00-\x1f\x7f ]+/);
            if (found) {
              const clean = found[0].replace(/[^a-zA-Z0-9\-._~:\/?#\[\]@!$&'()*+,;=%]+$/, '');
              if (clean.length > 15 && !clean.includes('news.google.com')) { resolve(clean); return; }
            }
          }
        } catch(e) {}
        resolve(null);
      });
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function getHostname(url) {
  try { return new URL(url).hostname.replace('www.',''); } catch(e) { return ''; }
}

// ── ARTICLE CACHE ──
const articleCache = new Map(); // url → { data, ts }
const ARTICLE_TTL = 30 * 60 * 1000; // 30 min

async function fetchArticle(articleUrl) {
  const cached = articleCache.get(articleUrl);
  if (cached && Date.now() - cached.ts < ARTICLE_TTL) return cached.data;

  // Rifiuta URL che non sono pagine web
  if (/\.pdf($|\?)/i.test(articleUrl)) return { success: false, error: 'pdf_not_supported' };

  let html;
  try {
    html = await fetchUrl(articleUrl, 0, {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
    }, 15000);
  } catch(e) {
    return { success: false, error: 'fetch_failed' };
  }

  if (!html || html.length < 200) return { success: false, error: 'empty' };

  // Blocca risposte non-HTML
  if (html === '__BINARY__') return { success: false, error: 'not_html' };
  // Blocca PDF riconoscibili
  const firstBytes = html.substring(0, 500);
  if (firstBytes.includes('%PDF-') || firstBytes.substring(0,4) === '%PDF') {
    return { success: false, error: 'not_html' };
  }

  // Limita a 500kb per evitare pagine enormi
  if (html.length > 500000) html = html.substring(0, 500000);

  let article;
  try {
    const dom = new JSDOM(html, { url: articleUrl });
    const reader = new Readability(dom.window.document);
    article = reader.parse();
  } catch(e) {
    return { success: false, error: 'parse_failed' };
  }

  if (!article || !article.textContent || article.textContent.length < 100) {
    // Fallback: estrai paragrafi direttamente dall'HTML
    try {
      const dom2 = new JSDOM(html, { url: articleUrl });
      const doc = dom2.window.document;
      // Strategia 1: selettori semantici precisi
      const bodySelectors = [
        '[itemprop="articleBody"]',
        '.cassazione-article-wrapper',
        '.article-content',
        'article',
        '.post-content', '.entry-content', '.article-body',
        '.content-body', '.post-body', '.text-content', '.news-content',
        '.article__body', '.article__text', '.story-body', '.story__body',
        '#article-body', '#post-content', '#content-main',
        'main'
      ];
      let container = null;
      for (const sel of bodySelectors) {
        const el = doc.querySelector(sel);
        if (el && el.textContent.trim().length > 200) { container = el; break; }
      }
      const source = container || doc.body;
      // Strategia 2: prendi p + div con testo lungo (≥80 chars, nessun link eccessivo)
      const allNodes = Array.from(source.querySelectorAll('p, h2, h3, blockquote'));
      const texts = allNodes
        .map(el => ({ tag: el.tagName.toLowerCase(), text: el.textContent.trim(), links: el.querySelectorAll('a').length }))
        .filter(({ text, links, tag }) => {
          if (text.length < (tag === 'p' ? 40 : 15)) return false;
          const words = text.split(/\s+/).length;
          if (links / Math.max(words, 1) > 0.4) return false; // troppi link = menu
          return true;
        });
      if (texts.length > 0) {
        const contentHtml = texts.map(({ tag, text }) => {
          if (tag === 'h2' || tag === 'h3') return '<h3>' + text + '</h3>';
          if (tag === 'blockquote') return '<blockquote>' + text + '</blockquote>';
          return '<p>' + text + '</p>';
        }).join('\n');
        article = { content: contentHtml, textContent: texts.map(t=>t.text).join(' '), title: article?.title || '' };
      } else {
        return { success: false, error: 'no_content' };
      }
    } catch(e2) {
      return { success: false, error: 'no_content' };
    }
  }

  // Pulizia HTML Readability
  let content = article.content || '';

  // Estrai immagine principale prima di rimuovere i tag img
  let heroImage = '';
  // 1) og:image dal <head>
  const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (ogMatch && ogMatch[1]) heroImage = ogMatch[1];
  // 2) Prima <img> nell'articolo Readability con src significativo
  if (!heroImage) {
    const imgMatch = content.match(/<img[^>]+src=["']([^"']{10,})["']/i);
    if (imgMatch && imgMatch[1] && /\.(jpg|jpeg|png|webp|gif)/i.test(imgMatch[1])) heroImage = imgMatch[1];
  }
  // 3) twitter:image
  if (!heroImage) {
    const twMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
    if (twMatch && twMatch[1]) heroImage = twMatch[1];
  }

  content = content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '');

  // Rimuovi paragrafi/div che sembrano menu di navigazione:
  // - testo con molte parole brevi separate da spazi (nav items)
  // - blocchi con alta densità di link rispetto al testo
  content = content.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, function(tag, inner) {
    const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length < 10) return '';
    const words = text.split(/\s+/);
    const avgWordLen = text.replace(/\s/g,'').length / Math.max(words.length, 1);
    const linkCount = (inner.match(/<a\b/gi) || []).length;
    const linkDensity = linkCount / Math.max(words.length, 1);
    // Paragrafo menu: avgWordLen bassa + molti link + niente punteggiatura
    const hasPunctuation = /[.,;:!?""''—–]/.test(text);
    if (linkDensity > 0.3 && !hasPunctuation && words.length > 5) return '';
    if (!hasPunctuation && avgWordLen < 6 && words.length > 20) return '';
    return tag;
  });

  const result = {
    success: true,
    content: content,
    textContent: article.textContent ? article.textContent.trim().substring(0, 3000) : '',
    title: article.title || '',
    byline: article.byline || '',
    excerpt: article.excerpt || '',
    siteName: article.siteName || '',
    image: heroImage || '',
    originalUrl: articleUrl
  };
  articleCache.set(articleUrl, { data: result, ts: Date.now() });
  return result;
}

// ── ANTEPRIME NOTIZIE ──────────────────────────────────────────────────
// Estrazione leggera og:image per le card senza thumbnail RSS.
// Solo fetch dell'<head> (nessun Readability/puppeteer). GNews risolto via DB.
const previewCache = new Map(); // url → { image, ts }
const PREVIEW_TTL = 6 * 60 * 60 * 1000; // 6 ore
const PREVIEW_CACHE_MAX = 5000;

function _extractOgImage(html, baseUrl) {
  if (!html || html === '__BINARY__' || html.length < 100) return '';
  const head = html.substring(0, 80000); // og:image sta nell'<head>
  let img = '';
  const og = head.match(/<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i)
          || head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i);
  if (og && og[1]) img = og[1];
  if (!img) {
    const tw = head.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i)
            || head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i);
    if (tw && tw[1]) img = tw[1];
  }
  img = (img || '').trim().replace(/&amp;/g, '&');
  if (!img) return '';
  // Normalizza a URL assoluto
  if (img.startsWith('//')) img = 'https:' + img;
  else if (img.startsWith('/')) { try { img = new URL(baseUrl).origin + img; } catch(e) {} }
  if (!/^https?:\/\//i.test(img)) return '';
  return img;
}

async function fetchOgImage(articleUrl) {
  if (!articleUrl || !/^https?:\/\//i.test(articleUrl)) return '';
  if (/\.(pdf|jpg|jpeg|png|webp|gif|mp4)($|\?)/i.test(articleUrl)) return '';
  let target = articleUrl;
  // GNews: risolvi in modo economico via DB (source_url / url_resolved), niente puppeteer
  if (articleUrl.includes('news.google.com/')) {
    let resolved = '';
    const db = getCodiciDBW();
    if (db) {
      try {
        const row = db.prepare("SELECT source_url, url_resolved FROM news WHERE url=? LIMIT 1").get(articleUrl);
        if (row?.source_url && row.source_url.startsWith('http') && !row.source_url.includes('news.google.com')) resolved = row.source_url;
        else if (row?.url_resolved && row.url_resolved.startsWith('http') && !row.url_resolved.includes('news.google.com')) resolved = row.url_resolved;
      } catch(e) {}
    }
    if (!resolved) return ''; // niente URL reale → nessuna anteprima (no fetch costosi)
    target = resolved;
  }
  let html;
  try {
    html = await fetchUrl(target, 0, {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'it-IT,it;q=0.9,en;q=0.7',
      'Accept-Encoding': 'identity',
    }, 9000);
  } catch(e) { return ''; }
  return _extractOgImage(html, target);
}

function getPreviewCached(u) {
  const c = previewCache.get(u);
  if (c && Date.now() - c.ts < PREVIEW_TTL) return c;
  return null;
}
function setPreviewCached(u, image) {
  if (previewCache.size >= PREVIEW_CACHE_MAX) {
    // evizione FIFO grezza
    const firstKey = previewCache.keys().next().value;
    if (firstKey) previewCache.delete(firstKey);
  }
  previewCache.set(u, { image, ts: Date.now() });
}

refreshFeeds();
setInterval(refreshFeeds, CACHE_TTL);


// safeParseJSON — parser robusto per output Claude (gestisce markdown fences, trailing commas, JSON troncato)
function safeParseJSON(text) {
  if (!text || typeof text !== 'string') return null;
  // Step 1: rimuovi markdown code fences (solo all'inizio e alla fine, non multiline)
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();
  // Step 2: trova il primo { o [
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  if (firstBrace === -1 && firstBracket === -1) return null;
  const startIdx = (firstBrace >= 0 && firstBracket >= 0)
    ? Math.min(firstBrace, firstBracket)
    : Math.max(firstBrace, firstBracket);
  // Step 3: trova chiusura bilanciata (ignora caratteri dentro stringhe)
  const isArray = cleaned[startIdx] === '[';
  const openChar = isArray ? '[' : '{';
  const closeChar = isArray ? ']' : '}';
  let depth = 0, endIdx = -1, inString = false, escape = false;
  for (let i = startIdx; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === openChar || c === '{' || c === '[') depth++;
    if (c === closeChar || c === '}' || c === ']') { depth--; if (depth === 0) { endIdx = i; break; } }
  }
  if (endIdx === -1) { console.error("[safeParseJSON] JSON troncato, depth:", depth); return null; }
  const jsonStr = cleaned.slice(startIdx, endIdx + 1);
  try {
    return JSON.parse(jsonStr);
  } catch(e) {
    try {
      // Fix trailing commas (errore frequente LLM)
      const fixed = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
      return JSON.parse(fixed);
    } catch(e2) {
      console.error('[safeParseJSON] failed:', e2.message, 'input:', jsonStr.substring(0,100));
      return null;
    }
  }
}

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const parsedUrl = new URL(req.url, 'http://localhost');
  let url = parsedUrl.pathname;

    // === COMPAT SHIM v2 — 23 mag 2026 ===
  if (url === '/api/articles') { url = '/api/feeds'; }
  else if (url.startsWith('/api/articles?')) {
    var __qs = url.slice('/api/articles?'.length);
    if (/(^|&)id=/.test(__qs)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, fallback: "use limit" }));
    }
    url = '/api/feeds?' + __qs;
  }
  // === FREEZE Scalata (Sprint 1) ===
  // Scalata notizie congelata dietro SCALATA_ENABLED (default false):
  // le route rispondono 503 "sezione in manutenzione". I file restano su disco.
  if (!scalataEnabled()) {
    var __base = url.split('?')[0];
    // /api/scalata/status risponde SEMPRE (serve al frontend per nascondere i bottoni)
    const _isScalataPath = __base === '/api/scalata' || __base.startsWith('/api/scalata/');
    if (__base !== '/api/scalata/status' &&
        (__base === '/api/synthesize' || __base === '/api/casi-simili' || _isScalataPath)) {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "sezione in manutenzione" }));
    }
  }
  // === END FREEZE ===
  if (url === '/api/feeds' || url === '/edicola/api/feeds') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Return flat array for compatibility + wrap with metadata in X-Meta header
    const meta = { sources: cache.sources, total: FEEDS.length, count: cache.articles.length, ts: cache.ts };
    res.setHeader('X-Feed-Meta', JSON.stringify(meta));
    (cache.articles||[]).forEach(function(a){ if(!a.area_diritto) a.area_diritto = classifyArticle(a); });
    res.end(JSON.stringify(cache.articles));
  } else if (url === '/api/preview') {
    // GET /api/preview?url=<articleUrl> — og:image leggera per card senza thumb RSS
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=21600');
    const pu = parsedUrl.searchParams.get('url') || '';
    if (!pu) { res.end(JSON.stringify({ image: '' })); return; }
    const cachedPrev = getPreviewCached(pu);
    if (cachedPrev) { res.end(JSON.stringify({ image: cachedPrev.image, cached: true })); return; }
    (async () => {
      let image = '';
      try { image = await fetchOgImage(pu); } catch(e) {}
      setPreviewCached(pu, image);
      res.end(JSON.stringify({ image }));
    })();
  } else if (url === '/api/article' || url === '/edicola/api/article') {
    const articleUrl = parsedUrl.searchParams.get('url') || parsedUrl.searchParams.get('link');
    if (!articleUrl) {
      res.writeHead(400); res.end(JSON.stringify({ success: false, error: 'Missing url param' }));
      return;
    }
    (async () => {
      try {
        // 1. Controlla se abbiamo full_text nel DB (per qualsiasi URL: originale o risolto)
        const dbCheck = getCodiciDBW();
        if (dbCheck) {
          try { dbCheck.prepare('ALTER TABLE news ADD COLUMN full_text TEXT').run(); } catch(e) {}
          try { dbCheck.prepare('ALTER TABLE news ADD COLUMN url_resolved TEXT').run(); } catch(e) {}
          const localRow = dbCheck.prepare("SELECT full_text, title, source_name, url_resolved FROM news WHERE (url=? OR url_resolved=?) AND full_text IS NOT NULL AND full_text != '' LIMIT 1").get(articleUrl, articleUrl);
          if (localRow && localRow.full_text && localRow.full_text.length > 200) {
            const htmlContent = '<p>' + localRow.full_text.replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br/>') + '</p>';
            res.setHeader('Content-Type','application/json; charset=utf-8');
            res.end(JSON.stringify({ success:true, content:htmlContent, textContent:localRow.full_text, title:localRow.title||'', siteName:localRow.source_name||'', local:true, originalUrl:articleUrl }));
            return;
          }
        }
        // 2. Risolvi Google News URL
        let resolvedUrl = articleUrl;
        const isGNews = articleUrl.includes('news.google.com/');
        if (isGNews) {
          // Prima: cerca source_url nel DB (URL reale dall'RSS description)
          const dbSrc = getCodiciDBW();
          if (dbSrc) {
            try {
              const srcRow = dbSrc.prepare("SELECT source_url, url_resolved FROM news WHERE url=? LIMIT 1").get(articleUrl);
              if (srcRow?.source_url && srcRow.source_url.startsWith('http') && !srcRow.source_url.includes('news.google.com')) {
                resolvedUrl = srcRow.source_url;
                console.log('[Article] GNews risolto via source_url DB:', getHostname(resolvedUrl));
              } else if (srcRow?.url_resolved && srcRow.url_resolved.startsWith('http')) {
                resolvedUrl = srcRow.url_resolved;
                console.log('[Article] GNews risolto via url_resolved DB:', getHostname(resolvedUrl));
              }
            } catch(e) {}
          }
          // Se non trovato nel DB, prova Puppeteer poi HTTP redirect
          if (resolvedUrl === articleUrl) {
            let resolved = null;
            // Metodo A: Puppeteer (segue redirect JS)
            try {
              const gnResolver = require('./gnews-resolver');
              const result = await gnResolver.resolveAndFetch(articleUrl);
              if (result && result.resolvedUrl) {
                resolvedUrl = result.resolvedUrl;
                console.log('[Article] GNews risolto via Puppeteer:', getHostname(resolvedUrl));
                // Se ha anche il full-text, salvalo e restituiscilo subito
                if (result.text && result.text.length > 100) {
                  const htmlC = '<p>' + result.text.replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br/>') + '</p>';
                  // Salva nel DB
                  try {
                    const dbPup = getCodiciDBW();
                    if (dbPup) {
                      try { dbPup.prepare('ALTER TABLE news ADD COLUMN full_text TEXT').run(); } catch(e) {}
                      try { dbPup.prepare('ALTER TABLE news ADD COLUMN url_resolved TEXT').run(); } catch(e) {}
                      dbPup.prepare("UPDATE news SET full_text=?, url_resolved=?, updated_at=CURRENT_TIMESTAMP WHERE url=?").run(result.text.substring(0,50000), resolvedUrl, articleUrl);
                    }
                  } catch(e) {}
                  res.setHeader('Content-Type','application/json; charset=utf-8');
                  res.end(JSON.stringify({ success:true, content:htmlC, textContent:result.text, title:result.title||'', siteName:result.siteName||getHostname(resolvedUrl), resolvedUrl, local:false }));
                  return;
                }
              }
            } catch(e) {
              console.log('[Article] Puppeteer non disponibile:', e.message);
            }
            // Metodo B: HTTP redirect (fallback)
            if (resolvedUrl === articleUrl) {
              resolved = await resolveGoogleNewsUrl(articleUrl);
              if (resolved) {
                resolvedUrl = resolved;
                console.log('[Article] GNews risolto via HTTP:', getHostname(resolved));
              }
            }
          }
          // Se ancora non risolto, cerca per titolo
          if (resolvedUrl === articleUrl) {
            const dbFb = getCodiciDBW();
            if (dbFb) {
              const byTitle = parsedUrl.searchParams.get('title') || '';
              if (byTitle) {
                const row = dbFb.prepare("SELECT description, full_text FROM news WHERE title LIKE ? LIMIT 1").get('%'+byTitle.substring(0,50)+'%');
                if (row && (row.full_text || row.description)) {
                  const text = row.full_text || row.description;
                  const htmlC = '<p>' + text.replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br/>') + '</p>';
                  res.setHeader('Content-Type','application/json');
                  res.end(JSON.stringify({ success:true, content:htmlC, textContent:text, local:true }));
                  return;
                }
              }
            }
            // Se proprio non c'è nulla, restituisci errore ma con messaggio utile
            res.setHeader('Content-Type','application/json');
            res.end(JSON.stringify({ success:false, error:'gnews_unresolvable', message:'Contenuto non disponibile per questo articolo.' }));
            return;
          }
        }
        // 3. Fetch contenuto dalla testata originale
        const data = await fetchArticle(resolvedUrl);
        // Aggiungi info sulla testata
        data.resolvedUrl = resolvedUrl;
        data.siteName = data.siteName || getHostname(resolvedUrl);
        // 4. Salva full_text nel DB (cerca per URL originale O titolo)
        if (data.success && data.textContent && data.textContent.length > 100) {
          try {
            const dbSave = getCodiciDBW();
            if (dbSave) {
              const plainText = data.textContent.substring(0, 50000);
              // Prova match per url originale (Google News)
              let updated = dbSave.prepare("UPDATE news SET full_text=?, url_resolved=?, updated_at=CURRENT_TIMESTAMP WHERE url=? AND (full_text IS NULL OR full_text='')").run(plainText, resolvedUrl, articleUrl);
              // Se no match, prova url risolto
              if (updated.changes === 0) {
                updated = dbSave.prepare("UPDATE news SET full_text=?, url_resolved=?, updated_at=CURRENT_TIMESTAMP WHERE url=? AND (full_text IS NULL OR full_text='')").run(plainText, resolvedUrl, resolvedUrl);
              }
              // Se ancora no match, prova per titolo (ultimo resort)
              if (updated.changes === 0 && data.title) {
                dbSave.prepare("UPDATE news SET full_text=?, url_resolved=?, updated_at=CURRENT_TIMESTAMP WHERE title=? AND (full_text IS NULL OR full_text='')").run(plainText, resolvedUrl, data.title);
              }
            }
          } catch(e) { console.warn('[Article] DB save err:', e.message); }
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(data));
      } catch(e) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    })();
  } else if (url === '/api/reset-circuit' && req.method === 'POST') {
    // Reset tutti i circuit breaker — utile dopo riavvio o per sbloccare feed
    let count = 0;
    for (const key of Object.keys(feedHealth)) {
      feedHealth[key].failures = 0;
      feedHealth[key].disabledUntil = 0;
      count++;
    }
    console.log(`[RESET] Circuit breaker azzerato per ${count} feed`);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, reset: count }));
  } else if (url === '/api/source-profile') {
    const sname = parsedUrl.searchParams.get('source') || '';
    const profile = getSourceProfile(sname);
    const articles = cache.articles || [];
    // Conta copertura: articoli con keyword simili nelle ultime 48h
    const artUrl = parsedUrl.searchParams.get('url') || '';
    const keywords = (parsedUrl.searchParams.get('keywords') || '').split(',').filter(k => k.length > 2);
    let coverage = { sources_covering: 0, sources: [] };
    if (keywords.length > 0) {
      const cutoff = Date.now() - 48 * 3600 * 1000;
      const seen = new Set();
      for (const a of articles) {
        const aUrl = a.url || a.link || '';
        if (aUrl === artUrl) continue;
        if (new Date(a.date).getTime() < cutoff) continue;
        const titleLower = (a.title || '').toLowerCase();
        const descLower = (a.desc || '').toLowerCase();
        let overlap = 0;
        for (const kw of keywords) { if (titleLower.includes(kw) || descLower.includes(kw)) overlap++; }
        if (overlap >= 2 && !seen.has(a.source_name || a.source)) {
          seen.add(a.source_name || a.source);
          coverage.sources.push({ name: a.source_name || a.source, profile: getSourceProfile(a.source_name || a.source) });
        }
      }
      coverage.sources_covering = coverage.sources.length;
      // Calcola diversità bias
      const biasVals = coverage.sources.map(s => s.profile && s.profile.bias != null ? s.profile.bias : null).filter(b => b !== null);
      const hasLeft = biasVals.some(b => b < -0.5);
      const hasCenter = biasVals.some(b => b >= -0.5 && b <= 0.5);
      const hasRight = biasVals.some(b => b > 0.5);
      if (coverage.sources_covering === 0) coverage.diversity = 'fonte_unica';
      else if (hasLeft && hasRight) coverage.diversity = 'bilanciata';
      else if ((hasLeft && hasCenter) || (hasRight && hasCenter)) coverage.diversity = 'parziale';
      else coverage.diversity = 'unilaterale';
    }
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ profile, coverage }));

  } else if (url === '/api/related') {
    // L4 — Connessioni (algoritmo locale, zero AI)
    const artUrl = parsedUrl.searchParams.get('url');
    const keywordsParam = parsedUrl.searchParams.get('keywords');
    const artSource = parsedUrl.searchParams.get('source') || '';
    const artCategory = parsedUrl.searchParams.get('category') || '';
    if (!artUrl || !keywordsParam) { res.writeHead(400); res.end(JSON.stringify({error:'missing params'})); return; }
    const keywords = keywordsParam.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 2);
    if (keywords.length === 0) { res.end(JSON.stringify([])); return; }

    const articles = cache.articles || [];
    const scored = [];
    const seenUrls = new Set([artUrl]);

    for (let i = 0; i < articles.length; i++) {
      const a = articles[i];
      const aUrl = a.url || a.link || '';
      if (!aUrl || seenUrls.has(aUrl)) continue;
      seenUrls.add(aUrl);

      const titleLower = (a.title || '').toLowerCase();
      const descLower = (a.desc || a.description || '').toLowerCase();
      const srcName = (a.source_name || a.source || '').toLowerCase();
      const aLang = (a.lang || a.language || 'it').toLowerCase();

      let overlap = 0;
      let titleHits = 0;
      for (const kw of keywords) {
        const inTitle = titleLower.includes(kw);
        const inDesc = descLower.includes(kw);
        if (inTitle) { overlap += 2; titleHits++; } // peso doppio per titolo
        else if (inDesc) { overlap += 1; }
      }

      // Soglia minima: almeno 1 keyword nel titolo OPPURE 2 nella descrizione
      if (titleHits < 1 && overlap < 2) continue;

      // Boost per lingua diversa (connessione cross-lingue = più interessante)
      const langBoost = aLang !== 'it' ? 1 : 0;

      // Boost per stessa categoria ma fonte diversa
      const catBoost = artCategory && (a.category || a.c || '') === artCategory && srcName !== artSource.toLowerCase() ? 0.5 : 0;

      scored.push({
        title: a.title,
        source: a.source_name || a.source,
        url: aUrl,
        date: a.date || a.published_at,
        lang: a.lang || a.language || 'it',
        relevance: (overlap / (keywords.length * 2)) + langBoost + catBoost
      });
    }
    scored.sort((x,y) => y.relevance - x.relevance);

    // Diversifica: massimo 2 articoli per fonte
    const bySource = {};
    const diverse = [];
    for (const item of scored) {
      const src = item.source || 'unknown';
      bySource[src] = (bySource[src] || 0) + 1;
      if (bySource[src] <= 2) diverse.push(item);
      if (diverse.length >= 8) break;
    }

    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(diverse));


  } else if (url === '/api/scalata/status') {
    // Stato Scalata v2 — il frontend lo usa per mostrare/nascondere i bottoni.
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(JSON.stringify({ enabled: scalataEnabled() }));

  } else if (url === '/api/scalata/v2' && req.method === 'POST') {
    // Scalata v2 — 3 blocchi: NORME (zero AI) + GIURISPRUDENZA (zero AI) + SINTESI (1 call Claude, cache).
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      try {
        const { id, title, content, source, category } = JSON.parse(body || '{}');
        const testo = ((title || '') + '\n' + (content || '')).trim();
        // Categoria giuridica (feed di diritto) vs cronaca generica: modula quanto deve
        // essere forte il segnale FTS per considerare la notizia "agganciata".
        const catGiuridica = !category || isCategoriaGiuridica(category);

        let parseNormaQuery, sv2;
        try { parseNormaQuery = require('./services/norma-resolver').parseNormaQuery; } catch (e) { parseNormaQuery = () => ({ numero: null, codice_id: null }); }
        try { sv2 = require('./services/scalata-v2'); } catch (e) { sv2 = null; }

        // ── BLOCCO 1 — NORME CITATE (deterministico) ──
        let norme = [];
        try { const gdb = getCodiciBB(); if (sv2) norme = sv2.estraiNorme(testo, gdb, parseNormaQuery); } catch (e) {}

        // ── BLOCCO 2 — GIURISPRUDENZA CORRELATA (FTS corpus, deterministico) ──
        // GATE PERTINENZA: la scalata non deve arrampicarsi su notizie non giuridiche.
        // "Aggancio giuridico diretto" = norme citate rilevate OPPURE segnale FTS forte,
        // cioè ALMENO 2 termini chiave che CO-OCCORRONO nella stessa sentenza. Il bm25 da
        // solo non discrimina (premia i termini frequenti/generici), quindi la soglia di
        // rilevanza è la co-occorrenza multi-termine, non il punteggio assoluto.
        let giurisprudenza = [];
        let agganciGiuridici = norme.length > 0;
        try {
          const termini = sv2 ? sv2.terminiChiave(title) : [];
          const cdb = getCorpusBB();
          if (termini.length && cdb) {
            const match = termini.map(t => '"' + t + '"').join(' OR ');
            const rows = cdb.prepare(`
              SELECT s.id, s.settore, s.tipo_atto, s.sezione, s.anno, s.numero, s.data_deposito, s.url_fonte, s.ecli,
                     snippet(sentenze_fts, 0, '[', ']', '…', 16) AS snippet
              FROM sentenze_fts f JOIN sentenze s ON s.id = f.rowid
              WHERE sentenze_fts MATCH ? ORDER BY rank LIMIT 5
            `).all(match);
            giurisprudenza = rows.map(s => ({
              id: s.id,
              titolo: `${s.tipo_atto || 'Provvedimento'} n. ${s.numero}/${s.anno}` + (s.sezione ? ` — Sez. ${s.sezione}` : '') + ` (${s.settore})`,
              numero: s.numero, anno: s.anno, data: s.data_deposito, url: s.url_fonte, ecli: s.ecli, snippet: s.snippet,
            }));

            // Soglia di rilevanza (senza norme): richiedi la CO-OCCORRENZA di ≥2 termini
            // DISCRIMINANTI. Un termine è discriminante se non è troppo frequente nel
            // corpus (df ≤ 15%): parole comuni come "corso"/"contratto" da sole non provano
            // pertinenza, mentre termini specifici che compaiono INSIEME in una sentenza sì.
            if (!agganciGiuridici && termini.length >= 2) {
              try {
                const totCorpus = cdb.prepare('SELECT COUNT(*) AS n FROM sentenze').get().n || 0;
                const maxDf = Math.max(200, Math.floor(totCorpus * 0.15));
                const dfStmt = cdb.prepare('SELECT COUNT(*) AS n FROM sentenze_fts WHERE sentenze_fts MATCH ?');
                const discriminanti = termini.filter(t => {
                  const df = dfStmt.get('"' + t + '"')?.n || 0;
                  return df >= 1 && df <= maxDf;
                });
                if (discriminanti.length >= 2) {
                  const pairs = [];
                  for (let a = 0; a < discriminanti.length; a++)
                    for (let b = a + 1; b < discriminanti.length; b++)
                      pairs.push(`("${discriminanti[a]}" AND "${discriminanti[b]}")`);
                  const cooc = dfStmt.get(pairs.join(' OR '));
                  // Feed giuridico: basta 1 co-occorrenza. Categoria non giuridica (cronaca):
                  // serve un filone giuridico consistente per non arrampicarsi su parole a
                  // doppio senso (es. "partita"/"finale").
                  const sogliaCooc = catGiuridica ? 1 : 6;
                  if (cooc && cooc.n >= sogliaCooc) agganciGiuridici = true;
                }
              } catch (e) {}
            }
          }
        } catch (e) {}

        // Notizia senza agganci giuridici: non forzare risultati né sintesi AI.
        if (!agganciGiuridici) giurisprudenza = [];

        // ── BLOCCO 3 — SINTESI (1 chiamata Claude, categoria 'scalata', cache per notizia) ──
        let sintesi = null, sintesi_stato = 'assente';
        const cacheKey = 'scalatav2:' + Buffer.from(String(id || title || '').substring(0, 90)).toString('base64url');
        if (!agganciGiuridici) {
          sintesi_stato = 'no_agganci';
        } else if (synthesisCache.has(cacheKey)) {
          sintesi = synthesisCache.get(cacheKey); sintesi_stato = 'cache';
        } else if (!ANTHROPIC_KEY) {
          sintesi_stato = 'no_api_key';
        } else if (!canCallClaude('scalata')) {
          sintesi_stato = 'cap_esaurito';
        } else {
          try {
            const normeTxt = norme.map(n => n.risolto ? `${n.ref}${n.titolo ? ' ' + n.titolo : ''}` : n.ref).join('; ') || 'nessuna rilevata';
            const sentTxt = giurisprudenza.map(s => `${s.titolo}: ${(s.snippet || '').replace(/[\[\]]/g, '')}`).join('\n').substring(0, 1500) || 'nessuna';
            const payload = {
              model: 'claude-haiku-4-5', max_tokens: 900, temperature: 0.2,
              system: 'Sei un giurista italiano. Rispondi SOLO con JSON valido, nessun testo fuori dal JSON. Usa ESCLUSIVAMENTE le informazioni fornite (notizia, norme, sentenze). Non inventare riferimenti normativi o giurisprudenziali.',
              messages: [{
                role: 'user',
                content: 'NOTIZIA\nTitolo: ' + (title || '') + '\nFonte: ' + (source || '') + '\nTesto: ' + String(content || '').substring(0, 2500)
                  + '\n\nNORME CITATE (già risolte): ' + normeTxt
                  + '\n\nGIURISPRUDENZA CORRELATA:\n' + sentTxt
                  + '\n\nProduci questo JSON:\n{"inquadramento":"inquadramento giuridico della vicenda in 5-8 righe","principio_diritto":"il principio di diritto se emerge dai materiali, altrimenti stringa vuota","cosa_cambia":"cosa cambia in pratica, massimo 2 righe"}'
              }]
            };
            let claudeRes = null, _lastErr = null;
            for (let att = 0; att < 2 && !claudeRes; att++) {
              try { claudeRes = await _callClaude(payload, 8000); }
              catch (e) { _lastErr = e; }
            }
            if (!claudeRes) throw (_lastErr || new Error('no_response'));
            if (claudeRes.status === 200) {
              const cd = JSON.parse(claudeRes.body);
              const parsed = safeParseJSON((cd.content && cd.content[0] && cd.content[0].text) || '');
              if (parsed) {
                sintesi = parsed; sintesi_stato = 'generata';
                synthesisCache.set(cacheKey, parsed);
                if (synthesisCache.size > 500) synthesisCache.delete(synthesisCache.keys().next().value);
              } else { sintesi_stato = 'parse_error'; }
            } else { sintesi_stato = 'claude_error'; console.error('[ScalataV2] Claude status', claudeRes.status, claudeRes.body.substring(0, 160)); }
          } catch (e) { sintesi_stato = 'errore'; console.error('[ScalataV2] sintesi err:', e.message); }
        }

        res.end(JSON.stringify({ ok: true, agganci: agganciGiuridici, norme, giurisprudenza, sintesi, sintesi_stato }));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });

  } else if (url === '/api/scalata/auto-run' && req.method === 'POST') {
    // Batch auto-scaling notizie senza L1L2
    (async () => {
      try {
        const limit = parseInt(parsedUrl.searchParams.get('limit') || '10');
        const arts = (cache.articles || [])
          .filter(a => !synthesisCache.has(Buffer.from((a.title + 'l1l2').substring(0,70)).toString('base64url')))
          .slice(0, Math.min(limit, 15));
        let processed = 0, failed = 0;
        for (const art of arts) {
          // Il batch di massa consuma la categoria 'synthesize' (via /api/synthesize interno),
          // NON il pool riservato 'scalata'. Gate peek: non incrementa il contatore qui,
          // l'incremento reale avviene dentro /api/synthesize.
          if (!claudeCapAvailable('synthesize')) break;
          try {
            const body = JSON.stringify({
              title: art.title,
              content: art.desc || art.snippet || '',
              source: art.source || '',
              date: art.date || '',
              level: 'l1l2',
              articleUrl: art.link || art.url || ''
            });
            const r = await new Promise((resolve, reject) => {
              const opts = { hostname:'127.0.0.1', port:3202, path:'/api/synthesize', method:'POST',
                headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)} };
              const req2 = http.request(opts, res2 => {
                let d=''; res2.on('data',c=>d+=c);
                res2.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } });
              });
              req2.on('error', reject);
              req2.setTimeout(25000, () => { req2.destroy(); reject(new Error('timeout')); });
              req2.write(body); req2.end();
            });
            if (r && (r.l1_fatto || (r.result && r.result.l1_fatto))) processed++;
            else failed++;
          } catch(e) { failed++; }
          await new Promise(r => setTimeout(r, 800));
        }
        res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify({ ok:true, processed, failed, total_in_cache: (cache.articles||[]).length }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    })();

  } else if (url.startsWith('/api/scalata/')) {
    // Scalata Giuridica specializzata (prompt giuridici)
    const handler = _scalataHandlers[url.split('?')[0]];
    if (handler) {
      handler(parsedUrl, req, res);
    } else {
      res.writeHead(404); res.end(JSON.stringify({error:'Scalata endpoint non trovato: '+url}));
    }


  } else if (url === '/api/sources' || url === '/api/source-profiles') {
    // GET /api/sources o /api/source-profiles — lista fonti con profili
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    try {
      const profiles = JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'source_profiles.json'),'utf8'));
      const sources = Object.entries(profiles)
        .filter(([k]) => k !== '_default' && k !== '_meta')
        .map(([name, p]) => ({name, full_name:p.full_name||name, type:p.type||'', authority:p.authority||2, scope:p.scope||'', note:p.note||'', ownership:p.ownership||''}));
      res.end(JSON.stringify({sources, total:sources.length}));
    } catch(e) { res.end(JSON.stringify({sources:[],error:e.message})); }

  } else if (url === '/api/stats') {
    // GET /api/stats — contatore live per header
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    const dbSt = getCodiciDBW();
    const feedsCount = (cache.articles||[]).length;
    const srcCount = cache.sources || 0;
    _resetClaudeUsageIfNewDay();
    const claudeStats = {
      date: claudeUsage.date,
      total: claudeUsage.total,
      caps: CLAUDE_CAPS,
      by_category: claudeUsage.byCategory,
      scalata_enabled: scalataEnabled(),
    };
    try {
      const scalate = dbSt ? (dbSt.prepare("SELECT COUNT(*) as n FROM news WHERE l1_fatto IS NOT NULL AND l1_fatto != ''").get()?.n || 0) : 0;
      const artCnt = dbSt ? (dbSt.prepare('SELECT COUNT(*) as n FROM articoli_codice').get()?.n || 7068) : 7068;
      const lnkCnt = dbSt ? (dbSt.prepare('SELECT COUNT(*) as n FROM codici_news_link').get()?.n || 0) : 0;
      res.end(JSON.stringify({ notizie:feedsCount, fonti:srcCount, scalate, articoli_codice:artCnt, links_normativi:lnkCnt, claude:claudeStats }));
    } catch(e) { res.end(JSON.stringify({ notizie:feedsCount, fonti:srcCount, articoli_codice:7068, links_normativi:0, claude:claudeStats })); }

  } else if (url === '/api/status') {
    // GET /api/status — stato del sistema
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    const db2 = getCodiciBB();
    const artCount = db2 ? (db2.prepare('SELECT COUNT(*) as n FROM articoli_codice').get()?.n || 0) : 0;
    const codiciCount = db2 ? (db2.prepare('SELECT COUNT(DISTINCT codice_id) as n FROM articoli_codice').get()?.n || 0) : 0;
    const linksCount = db2 ? (db2.prepare('SELECT COUNT(*) as n FROM codici_news_link').get()?.n || 0) : 0;
    const feedsCount = (cache.articles||[]).length;
    const srcCount = (cache.sources||0);
    res.end(JSON.stringify({
      ok:true, articles:feedsCount, sources:srcCount, total_articles:feedsCount,
      active_sources:srcCount, codici:codiciCount, articoli_codice:artCount, links:linksCount,
      ts:new Date().toISOString()
    }));


  } else if (url.startsWith('/api/scalata/l0')) {
    // GET /api/scalata/l0?source=<nome> — profilo fonte per L0
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    const sourceName = parsedUrl.searchParams.get('source') || '';
    const prof = getSourceProfile(sourceName);
    res.end(JSON.stringify({
      name: sourceName,
      full_name: prof.full_name || sourceName,
      type: prof.type || 'testata giornalistica',
      authority: prof.authority || 2,
      scope: prof.scope || '',
      note: prof.note || '',
      ownership: prof.ownership || ''
    }));


  } else if (url === '/api/scrapers/run' && req.method === 'POST') {
    (async () => {
      try {
        const { runAllScrapers } = require('./scrapers/istituzionali');
        const items = await runAllScrapers();
        // Anche Cassazione dedicato
        let cassItems = [];
        try { const cs = require('./scrapers/cassazione'); cassItems = await cs.runAllCassazioneScrapers(); } catch(e) {}
        const allItems = [...items, ...cassItems];
        const existingUrls = new Set((cache.articles||[]).map(a => a.url));
        const nuovi = allItems.filter(i => i.url && !existingUrls.has(i.url));
        nuovi.forEach(a => { if (!a.area_diritto) a.area_diritto = classifyArticle(a); });
        cache.articles = [...nuovi, ...(cache.articles||[])].slice(0, 5000);
        res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify({ ok:true, totale:allItems.length, nuovi:nuovi.length }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    })();

  } else if (url.startsWith('/api/scrapers/test') && req.method === 'GET') {
    const sc = parsedUrl.searchParams.get('scraper') || '';
    (async () => {
      try {
        const { runScraper, runAllScrapers } = require('./scrapers/istituzionali');
        const items = sc ? await runScraper(sc) : await runAllScrapers();
        res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify({ ok:true, count:items.length, items:items.slice(0,5) }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    })();


  } else if (url === '/api/jobs/stats-refresh' && req.method === 'POST') {
    (async () => {
      try {
        const { refreshAllStats } = require('./stats-refresh');
        const db = getCodiciDBW();
        const result = refreshAllStats(db);
        res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify(result));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    })();

  } else if (url === '/api/scalata/batch' && req.method === 'POST') {
    // Pre-genera L1+L2 per le notizie recenti in cache
    (async () => {
      try {
        const { runBatchL1L2 } = require('./scalata-engine');
        const articoli = cache.articles || [];
        const result = await runBatchL1L2(articoli, 10); // max 10 per chiamata manuale
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    })();

  } else if (url === '/api/synthesize' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { title, content, source, date, level, l1, l2, l3, related, articleUrl } = JSON.parse(body);
        if (!title) { res.writeHead(400); res.end(JSON.stringify({error:'missing title'})); return; }
        if (!ANTHROPIC_KEY) { res.writeHead(503); res.end(JSON.stringify({error:'no_api_key'})); return; }
        if (!canCallClaude('synthesize')) { res.writeHead(429); res.end(JSON.stringify({error:'Troppe richieste. Riprova tra qualche secondo.'})); return; }

        const requestLevel = level || 'l1l2';
        const cacheKey = Buffer.from((title + requestLevel).substring(0,70)).toString('base64url');
        if (synthesisCache.has(cacheKey)) {
          const cachedResult = synthesisCache.get(cacheKey);
          // Persisti nel DB se non già presente (cache hit ma DB mancante)
          if (requestLevel === 'l1l2' && title) {
            try {
              const dbCh = getCodiciDBW();
              if (dbCh) {
                const existing = dbCh.prepare('SELECT id FROM news WHERE (url=? OR title=?) AND l1_fatto IS NOT NULL LIMIT 1').get(articleUrl||'', title);
                if (!existing) {
                  const l1c = cachedResult.l1_fatto || {};
                  const l2c = cachedResult.l2_contesto || {};
                  const normec = l2c.norme_citate || [];
                  const matchUrl = articleUrl || '';
                  if (matchUrl) {
                    dbCh.prepare('UPDATE news SET l1_fatto=?,l2_contesto=?,norme_citate=?,tipo_contenuto=?,updated_at=CURRENT_TIMESTAMP WHERE url=?')
                      .run(JSON.stringify(l1c), JSON.stringify(l2c), JSON.stringify(normec), cachedResult.tipo_contenuto||'', matchUrl);
                  } else {
                    dbCh.prepare('UPDATE news SET l1_fatto=?,l2_contesto=?,norme_citate=?,tipo_contenuto=?,updated_at=CURRENT_TIMESTAMP WHERE title=?')
                      .run(JSON.stringify(l1c), JSON.stringify(l2c), JSON.stringify(normec), cachedResult.tipo_contenuto||'', title);
                  }
                }
              }
            } catch(e) { /* silenzioso */ }
          }
          res.setHeader('Content-Type','application/json');
          res.end(JSON.stringify(cachedResult));
          return;
        }

        let payload;
        // Prova a scaricare testo completo se snippet < 600 chars
        let fullText = content || '';
        if (fullText.length < 600) {
          const rawUrl = articleUrl || '';
          const isGNews = rawUrl.includes('news.google.com');
          if (rawUrl && rawUrl.startsWith('http') && !isGNews) {
            try {
              const fetched = await fetchArticle(rawUrl);
              if (fetched && fetched.success && fetched.textContent && fetched.textContent.length > 200) {
                fullText = fetched.textContent.substring(0, 4000);
                console.log('[Synthesize] Testo fetchato (' + fullText.length + ' chars)');
              }
            } catch(e) { /* fallback silenzioso */ }
          }
        }
        // Fallback: usa content (desc) se ancora poco testo, poi title come ultimo resort
        const snippet = (fullText.length > 50 ? fullText : (content || title)).substring(0, 3000);

        if (requestLevel === 'l1l2') {
          // Prompt A — L1+L2 ottimizzato
          payload = {
            model: 'claude-haiku-4-5',
            max_tokens: 1800,
            temperature: 0.1,
            system: 'Sei un redattore di rivista giuridica italiana. Output SOLO JSON valido, nessun testo fuori dal JSON. Regole: 1. Se SENTENZA: cosa=dispositivo accessibile, chi=parti+organo+sezione, perche_importa=principio di diritto. 2. Se NORMA/DECRETO: cosa=cosa prevede, chi=destinatari, perche_importa=cosa cambia. 3. norme_citate: ESTRAI OGNI norma dal testo come array di oggetti [{norma:"art. X c.c.", ruolo:"fondante|parametro|violata|processuale|riferimento"}]. Cerca OGNI pattern art.[numero], D.Lgs., L., D.L. Converti: "codice civile"->c.c., "codice penale"->c.p., "Costituzione"->Cost. Se assenti: []. 4. precedenti_citati: ESTRAI ogni sentenza come [{sentenza:"Cass. SSUU n.X/Y", relazione:"conforme|difforme|superato_da", vincolante:true|false}]. vincolante=true SOLO per SSUU o Adunanza Plenaria. Se assenti: []. 5. tipo_provvedimento: sentenza|ordinanza_sostanziale|ordinanza_rimessione|ordinanza_cautelare|decreto. 6. fase_processuale: primo_grado|appello|cassazione|corte_costituzionale|rinvio. 7. content_authority: 5=SSUU/Adunanza Plenaria, 4=sezione semplice, 3=sezione filtro, 2=merito, 1=altro. 8. sub_area: per civile=obbligazioni_contratti|resp_extracontrattuale|diritti_reali|famiglia_successioni|condominio|locazioni|esecuzioni|concorsuale; per penale=persona|patrimonio|societari_231|pubblica_amministrazione|ambientali|processo_penale; altri=generico. 9. ANTI-ALLUCINAZIONE: usa SOLO dati nel testo. 10. confidence: alta se testo ricco, bassa se solo titolo.',
            messages: [{
              role: 'user',
              content: 'Articolo:\nTitolo: ' + title + '\nFonte: ' + (source||'') + '\nData: ' + (date||'') + '\nTesto: ' + snippet + '\n\nJSON:\n{"l1_fatto":{"cosa":"...","chi":"...","perche_importa":"..."},"l2_contesto":{"background":"...","norme_citate":[{"norma":"art. X c.c.","ruolo":"fondante"}],"precedenti_citati":[{"sentenza":"Cass. n. X/Y","relazione":"conforme","vincolante":false}],"confidence":"alta|media|bassa"},"keywords":["k1","k2"],"tipo_contenuto":"sentenza|ordinanza|decreto_legge|decreto_legislativo|circolare|provvedimento|dottrina|notizia|commento","tipo_provvedimento":"sentenza|ordinanza_sostanziale|ordinanza_rimessione|ordinanza_cautelare|decreto","content_authority":4,"fase_processuale":"primo_grado|appello|cassazione|corte_costituzionale|rinvio","sub_area":"obbligazioni_contratti|resp_extracontrattuale|condominio|processo_penale|generico"}'
            }]
          };
        } else if (requestLevel === 'l3') {
          // Prompt B — L3 Analisi
          const l1obj_l3 = l1 ? (l1.l1_fatto || l1) : null;
          const l1str = l1obj_l3 ? ((l1obj_l3.cosa||'') + ' ' + (l1obj_l3.chi||'') + ' ' + (l1obj_l3.perche_importa||'')) : '';
          const relTitles = (related||[]).slice(0,3).map(r => '- ' + r.title + ' [' + r.source + ']').join('\n');
          payload = {
            model: 'claude-haiku-4-5',
            max_tokens: 1200,
            temperature: 0.2,
            system: 'Sei un analista giurisprudenziale. Output SOLO JSON valido. Regole: 1. problema_giuridico: la QUESTIONE DI DIRITTO, non il fatto di cronaca. 2. orientamenti: orientamenti giurisprudenziali CONTRASTANTI con attribuzione a Cass. SS.UU., sez. semplice, dottrina. 3. non_detto: per sentenze=tema eluso dalla Corte; per norme=aspetto non regolamentato. 4. Se materiale insufficiente: confidence=bassa, scrivi "Insufficiente materiale". 5. ANTI-ALLUCINAZIONE: non inventare orientamenti non presenti nel testo. 6. Se non ci sono orientamenti contrastanti specifici, descrivi il TIPO di questione giuridica: es. "Questione di legittimita costituzionale sulla separazione carriere magistratura" e meglio di "Non disponibile". "Non disponibile" solo se notizia di cronaca senza rilevanza tecnica.',
            messages: [{
              role: 'user',
              content: 'Titolo: ' + title.substring(0,100) + '\nFonte: ' + (source||'') + '\nFatto: ' + l1str.substring(0,200) + '\nNorme: ' + ((l2 && (l2.l2_contesto||l2).norme_citate || []).join(', ') || 'non indicate') + '\n\nJSON (ogni campo MAX 15 parole, max 2 orientamenti):\n{"l3_analisi":{"problema_giuridico":"...","orientamenti":[{"posizione":"...","sostenuto_da":"Cass. SS.UU.|orientamento maggioritario|dottrina prevalente"}],"non_detto":"...","confidence":"alta|media|bassa"}}'
            }]
          };
        } else if (requestLevel === 'l5') {
          // Prompt C — L5 Implicazioni (Sonnet)
          // l1 può arrivare come {l1_fatto:{cosa,chi,...}} o direttamente {cosa,chi,...}
          const l1obj = l1 ? (l1.l1_fatto || l1) : null;
          const l2obj = l2 ? (l2.l2_contesto || l2) : null;
          const l1str = l1obj ? ((l1obj.cosa||'') + ' ' + (l1obj.chi||'') + ' ' + (l1obj.perche_importa||'')) : '';
          const relTitles = (related||[]).slice(0,5).map(r => '- ' + r.title + ' [' + r.source + ']').join('\n');
          payload = {
            model: 'claude-sonnet-4-6',
            max_tokens: 1200,
            temperature: 0.3,
            system: 'Sei un consulente legale strategico per avvocati italiani. Output SOLO JSON valido. Regole: 1. impatto_operativo: cosa fare CONCRETAMENTE, max 2 frasi. 2. scenari: se/allora con probabilita per la pratica forense, max 2 scenari. 3. scadenze: date concrete e adempimenti. Se non ci sono: []. 4. domanda_aperta: vera questione giuridica irrisolta, max 1 frase. 5. Non dare pareri legali. 6. PRIORITA: JSON COMPLETO. Se devi scegliere tra testi lunghi e JSON completo, scegli JSON completo con testi brevi. Non troncare mai il JSON.',
            messages: [{
              role: 'user',
              content: 'Titolo: ' + title.substring(0,100) + '\nFatto: ' + l1str.substring(0,150) + '\nNorme: ' + (l2obj ? (l2obj.norme_citate||[]).join(', ') : 'n.d.') + '\nContesto: ' + (l2obj ? (l2obj.background||'').substring(0,120) : '') + '\nProblema: ' + (l3 ? (l3.l3_analisi||l3).problema_giuridico||'' : '') + '\n\nJSON (max 2 scenari, ogni campo MAX 15 parole):\n{"l5_implicazioni":{"impatto_operativo":"cosa fare concretamente","scenari":[{"se":"...","allora":"...","probabilita":"alta|media|bassa"}],"scadenze":["data — adempimento o []"],"domanda_aperta":"questione giuridica irrisolta?"}}'
            }]
          };
        }

        const claudeRes = await new Promise((resolve, reject) => {
          const payloadStr = JSON.stringify(payload);
          const options = {
            hostname: 'api.anthropic.com',
            path: '/v1/messages',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_KEY,
              'anthropic-version': '2023-06-01',
              'Content-Length': Buffer.byteLength(payloadStr)
            }
          };
          const r = https.request(options, resp => {
            let d = '';
            resp.on('data', c => d += c);
            resp.on('end', () => resolve({ status: resp.statusCode, body: d }));
          });
          r.on('error', reject);
          r.setTimeout(20000, () => { r.destroy(); reject(new Error('timeout')); });
          r.write(payloadStr);
          r.end();
        });

        if (claudeRes.status !== 200) {
          res.writeHead(500);
          res.end(JSON.stringify({error:'claude_error', status: claudeRes.status, body: claudeRes.body.substring(0,200)}));
          return;
        }

        const claudeData = JSON.parse(claudeRes.body);
        const rawText = claudeData.content[0].text || '';
        console.log('[Claude L'+requestLevel+'] raw len:', rawText.length, 'preview:', rawText.substring(0,60).replace(/\n/g,' '));
        const result = safeParseJSON(rawText);
        if (!result) {
          console.error('[Claude] safeParseJSON failed, raw:', rawText.substring(0,300));
          res.writeHead(500); res.end(JSON.stringify({error:'parse_error', raw: rawText.substring(0,200)})); return;
        }

        synthesisCache.set(cacheKey, result);
        if (synthesisCache.size > 500) synthesisCache.delete(synthesisCache.keys().next().value);

        // Persisti Scalata nel DB news + trigger link builder post-L2
        try {
          const dbSynth = getCodiciDBW();
          if (dbSynth && title) {
            if (requestLevel === 'l1l2') {
              const l1s = result.l1_fatto || {};
              const l2s = result.l2_contesto || {};
              const norme = l2s.norme_citate || [];
              // Match per url (più stabile) o titolo
              const artUrl = articleUrl || '';
              const matchBy = artUrl ? 'url' : 'title';
              const matchVal = artUrl || title;
              // Verifica e aggiunge colonne extra se mancanti (idempotente)
              ['tipo_provvedimento','content_authority','fase_processuale','sub_area','full_text'].forEach(function(col){
                try { dbSynth.prepare('ALTER TABLE news ADD COLUMN '+col+' TEXT').run(); } catch(e) {}
              });
              dbSynth.prepare('UPDATE news SET l1_fatto=?,l2_contesto=?,keywords=?,tipo_contenuto=?,norme_citate=?,tipo_provvedimento=?,content_authority=?,fase_processuale=?,sub_area=?,updated_at=CURRENT_TIMESTAMP WHERE '+matchBy+'=?')
                .run(JSON.stringify(l1s), JSON.stringify(l2s), JSON.stringify(result.keywords||[]),
                     result.tipo_contenuto||'', JSON.stringify(norme),
                     result.tipo_provvedimento||null, result.content_authority||null,
                     result.fase_processuale||null, result.sub_area||null,
                     matchVal);
              // Aggiorna scalata_at
              dbSynth.prepare('UPDATE news SET scalata_at=CURRENT_TIMESTAMP WHERE '+matchBy+'=?').run(matchVal);
              // Trigger link builder con le norme estratte da L2
              if (norme.length > 0) {
                try {
                  const lb = getLinkBuilder();
                  // Cerca in cache RAM o in DB
                  let newsRec = (cache.articles||[]).find(a => a.title === title || (artUrl && (a.url||a.link)===artUrl));
                  if (!newsRec && dbSynth) {
                    const dbRec = dbSynth.prepare('SELECT id,url,title,description AS desc,source_name AS source FROM news WHERE '+matchBy+'=? LIMIT 1').get(matchVal);
                    if (dbRec) newsRec = dbRec;
                  }
                  if (lb && lb.buildLinksForArticle && newsRec) {
                    const artWithNorme = Object.assign({}, newsRec, {
                      desc: (newsRec.desc||newsRec.description||'') + ' ' + norme.map(function(n){return typeof n==='object'?n.norma||'':n;}).join(' ') + ' ' + (l2s.precedenti_citati||[]).map(function(p){return typeof p==='object'?p.sentenza||'':p;}).join(' '),
                      l2_contesto: JSON.stringify(l2s)
                    });
                    setImmediate(() => { try { lb.buildLinksForArticle(artWithNorme, getCodiciDBW()); } catch(e){} });
                  }
                } catch(lbErr) { /* silenzioso */ }
              }
            } else if (requestLevel === 'l3') {
              dbSynth.prepare('UPDATE news SET l3_analisi=?,scalata_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE title=?')
                .run(JSON.stringify(result.l3_analisi||result), title);
            } else if (requestLevel === 'l5') {
              dbSynth.prepare('UPDATE news SET l5_implicazioni=?,scalata_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE title=?')
                .run(JSON.stringify(result.l5_implicazioni||result), title);
            }
          }
        } catch(dbPersErr) { /* silenzioso */ }

        res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify(result));
      } catch(e) {
        res.writeHead(500);
        res.end(JSON.stringify({error: e.message}));
      }
    });
  } else if (url === '/api/translate-full' && req.method === 'POST') {
    // Traduzione INTEGRALE on-demand di un articolo straniero ("tasto Traduci").
    // Spezza il testo in blocchi da ~1800 caratteri sui confini di paragrafo e
    // li traduce con Claude Haiku in chiamate da 8 blocchi. Tetto 12.000 caratteri.
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      try {
        const { text, lang } = JSON.parse(body);
        if (!text || !lang || lang === 'it') return res.end(JSON.stringify({ translated: text || '' }));
        const testo = String(text).substring(0, 12000);
        // Blocchi da ~1800 caratteri sui confini di paragrafo; i paragrafi
        // monstre (o il testo senza a-capo) vengono spezzati sulle frasi.
        const paragrafi = [];
        for (const p of testo.split(/\n{2,}/)) {
          if (p.length <= 1800) { paragrafi.push(p); continue; }
          let resto = p;
          while (resto.length > 1800) {
            let cut = resto.lastIndexOf('. ', 1800);
            if (cut < 600) cut = 1800;
            paragrafi.push(resto.slice(0, cut + 1));
            resto = resto.slice(cut + 1).trim();
          }
          if (resto) paragrafi.push(resto);
        }
        const blocchi = [];
        let cur = '';
        for (const p of paragrafi) {
          if ((cur + '\n\n' + p).length > 1800 && cur) { blocchi.push(cur); cur = p; }
          else cur = cur ? cur + '\n\n' + p : p;
        }
        if (cur) blocchi.push(cur);
        // CACHE: stesso articolo, stesso testo → risposta immediata (qualunque lettore)
        const chiave = (() => { let h = 0; for (let i = 0; i < testo.length; i++) h = (h * 31 + testo.charCodeAt(i)) | 0; return h + ':' + testo.length + ':' + lang; })();
        if (_translFullCache.has(chiave)) return res.end(JSON.stringify({ translated: _translFullCache.get(chiave), cached: true }));
        // Lotti IN PARALLELO: il tempo totale è quello del lotto più lento,
        // non la somma — un articolo da 12k scende da ~25s a ~10s.
        const batches = [];
        for (let i = 0; i < blocchi.length; i += 4) batches.push(blocchi.slice(i, i + 4));
        const esiti = await Promise.all(batches.map(b => translateFullClaude(b, lang)));
        const fuori = [];
        esiti.forEach((out, bi) => {
          const batch = batches[bi];
          if (!out) fuori.push(...batch);
          else fuori.push(...out.map((o, j) => o || batch[j]));
        });
        const unito = fuori.join('\n\n');
        if (_translFullCache.size >= 300) _translFullCache.delete(_translFullCache.keys().next().value);
        _translFullCache.set(chiave, unito);
        res.end(JSON.stringify({ translated: unito }));
      } catch(e) {
        res.end(JSON.stringify({ translated: '', error: e.message }));
      }
    });

  } else if (url === '/api/translate' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { text, lang } = JSON.parse(body);
        if (!text || !lang || lang === 'it') {
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ translated: text }));
        }
        const result = await translateOne(text, lang);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ translated: result || text }));
      } catch(e) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ translated: '', error: e.message }));
      }
    });
  } else if (url.startsWith('/api/alert/weekly')) {
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    const db2 = getCodiciBB();
    try {
      // Top 10 norme calde
      const trendingRows = db2 ? db2.prepare(
        'SELECT ac.codice_id, ac.numero, ac.titolo, cs.citazioni_7gg as citazioni, cs.trend, cs.variazione_vs_periodo_precedente ' +
        'FROM codici_stats cs JOIN articoli_codice ac ON cs.articolo_id=ac.id ' +
        'WHERE cs.citazioni_7gg > 0 ORDER BY cs.citazioni_7gg DESC LIMIT 10'
      ).all() : [];

      // Top 5 sentenze (cassazione items from last 7 days)
      const weekAgo = new Date(Date.now() - 7*86400000).toISOString();
      const cassCategories = ['cassazione','cassazione_ssuu','cassazione_massimario','cassazione_penale','cassazione_civile','cassazione_lavoro','istituzionale_cassazione'];
      const topSentenze = (cache.articles||[])
        .filter(a => cassCategories.includes(a.category) && a.date && a.date >= weekAgo)
        .slice(0, 5)
        .map(a => ({title:a.title, source:a.source, url:a.url||a.link, date:a.date, category:a.category}));

      // Contrasti (norme con trend opposti)
      let contrasti = [];
      if (db2) {
        try {
          contrasti = db2.prepare(
            "SELECT ac.codice_id, ac.numero, ac.titolo, cs.trend, cs.variazione_vs_periodo_precedente, cs.citazioni_7gg " +
            "FROM codici_stats cs JOIN articoli_codice ac ON cs.articolo_id=ac.id " +
            "WHERE cs.citazioni_7gg >= 2 AND abs(cs.variazione_vs_periodo_precedente) > 30 " +
            "ORDER BY abs(cs.variazione_vs_periodo_precedente) DESC LIMIT 5"
          ).all();
        } catch(e) {}
      }

      // Total notizie this week
      const notizieSettimana = (cache.articles||[]).filter(a => a.date && a.date >= weekAgo).length;

      // HTML version
      const html = generateWeeklyHTML(trendingRows, topSentenze, contrasti, notizieSettimana);

      res.end(JSON.stringify({
        ok:true,
        settimana: { dal: weekAgo.split('T')[0], al: new Date().toISOString().split('T')[0] },
        notizie_totali: notizieSettimana,
        norme_calde: trendingRows,
        top_sentenze: topSentenze,
        contrasti,
        html,
      }));
    } catch(e) { res.end(JSON.stringify({ok:false, error:e.message})); }

  } else if (url.startsWith('/api/search')) {
    const q = (parsedUrl.searchParams.get('q') || '').trim();
    const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit')||'30',10), 100);
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    if (!q || q.length < 2) { res.end(JSON.stringify({ok:true, results:[], query:q})); return; }
    const terms = q.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    // Search in cache: title, desc/snippet, category, source, l2_contesto
    const results = (cache.articles||[]).filter(a => {
      const hay = ((a.title||'')+ ' ' + (a.desc||a.snippet||'') + ' ' + (a.source||'') + ' ' + (a.l2_contesto||a.l2_norme_citate||'') + ' ' + (a.category||'')).toLowerCase();
      return terms.every(t => hay.includes(t));
    }).slice(0, limit).map(a => ({
      id:a.id, title:a.title, url:a.url||a.link, source:a.source, date:a.date,
      category:a.category, desc:(a.desc||a.snippet||'').substring(0,200),
    }));
    // Also try DB FTS if available
    let dbResults = [];
    const db2 = getCodiciDBW();
    if (db2 && results.length < limit) {
      try {
        const likeQ = '%' + terms.join('%') + '%';
        dbResults = db2.prepare(`
          SELECT id, title, description AS desc, source_name AS source, published_at AS date, area_diritto AS category, url
          FROM news WHERE (title LIKE ? OR description LIKE ? OR l2_contesto LIKE ? OR l3_analisi LIKE ?)
          ORDER BY published_at DESC LIMIT ?
        `).all(likeQ, likeQ, likeQ, likeQ, limit - results.length);
      } catch(e) {}
    }
    // Merge, dedup by title
    const seen = new Set(results.map(r => r.title));
    for (const r of dbResults) {
      if (!seen.has(r.title)) {
        seen.add(r.title);
        results.push({id:r.id, title:r.title, url:r.url, source:r.source, date:r.date, category:r.category, desc:(r.desc||'').substring(0,200)});
      }
    }
    res.end(JSON.stringify({ok:true, query:q, results}));

  } else if (url.startsWith('/api/casi-simili')) {
    const newsId = parsedUrl.searchParams.get('id') || '';
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    if (!newsId) { res.end(JSON.stringify({ok:false, simili:[]})); return; }
    const db2 = getCodiciDBW();
    if (!db2) {
      // Fallback: cerca in cache per stessa category, ma SOLO in ambito giuridico
      // (i "casi simili" non devono scivolare sulla cronaca generica).
      const source = (cache.articles||[]).find(a => String(a.id) === String(newsId));
      if (source && isCategoriaGiuridica(source.category)) {
        const simili = (cache.articles||[]).filter(a => a.id !== source.id && a.category === source.category && isCategoriaGiuridica(a.category)).slice(0,5)
          .map(a => ({id:a.id, title:a.title, url:a.url||a.link, source:a.source, date:a.date, category:a.category, norme_comuni:0}));
        res.end(JSON.stringify({ok:true, simili}));
      } else { res.end(JSON.stringify({ok:true, simili:[]})); }
      return;
    }
    try {
      // Find norme cited by this news article
      const normeIds = db2.prepare('SELECT DISTINCT articolo_id FROM codici_news_link WHERE news_id=?').all(newsId).map(r => r.articolo_id);
      if (normeIds.length === 0) {
        // Fallback: same category from cache, ristretto alle categorie giuridiche.
        const source = (cache.articles||[]).find(a => String(a.id) === String(newsId));
        const simili = (source && isCategoriaGiuridica(source.category))
          ? (cache.articles||[]).filter(a => a.id !== source.id && a.category === source.category && isCategoriaGiuridica(a.category)).slice(0,5)
            .map(a => ({id:a.id, title:a.title, url:a.url||a.link, source:a.source, date:a.date, category:a.category, norme_comuni:0}))
          : [];
        res.end(JSON.stringify({ok:true, simili}));
        return;
      }
      // Find other news that cite the same norme, ranked by number of shared norme
      const placeholders = normeIds.map(()=>'?').join(',');
      const rows = db2.prepare(`
        SELECT cnl.news_id, COUNT(DISTINCT cnl.articolo_id) as norme_comuni
        FROM codici_news_link cnl
        WHERE cnl.articolo_id IN (${placeholders}) AND cnl.news_id != ?
        GROUP BY cnl.news_id
        ORDER BY norme_comuni DESC
        LIMIT 10
      `).all(...normeIds, newsId);
      // Enrich with cache data
      const articlesMap = {};
      (cache.articles||[]).forEach(a => { if (a.id) articlesMap[String(a.id)] = a; });
      const simili = rows.map(r => {
        const cached = articlesMap[String(r.news_id)] || {};
        return {
          id: r.news_id, title: cached.title || '', url: cached.url || cached.link || '',
          source: cached.source || '', date: cached.date || '', category: cached.category || '',
          norme_comuni: r.norme_comuni,
        };
      }).filter(s => s.title);
      res.end(JSON.stringify({ok:true, simili}));
    } catch(e) { res.end(JSON.stringify({ok:false, error:e.message, simili:[]})); }

  } else if (url === '/api/article/local' || url === '/api/article-local') {
    // GET /api/article/local?url=XX — restituisce full_text dal DB se disponibile
    const artUrl = parsedUrl.searchParams.get('url') || '';
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    if (!artUrl) { res.end(JSON.stringify({ok:false})); return; }
    const db2 = getCodiciDBW();
    if (!db2) { res.end(JSON.stringify({ok:false, local:false})); return; }
    try {
      try { db2.prepare('ALTER TABLE news ADD COLUMN full_text TEXT').run(); } catch(e) {}
      try { db2.prepare('ALTER TABLE news ADD COLUMN url_resolved TEXT').run(); } catch(e) {}
      const row = db2.prepare("SELECT id, title, description, source_name, full_text, published_at, area_diritto, url_resolved FROM news WHERE (url=? OR url_resolved=?) AND full_text IS NOT NULL AND full_text != '' LIMIT 1").get(artUrl, artUrl);
      if (row && row.full_text && row.full_text.length > 100) {
        res.end(JSON.stringify({ok:true, local:true, title:row.title, content:row.full_text, source_name:row.source_name, date:row.published_at, site:getHostname(row.url_resolved||artUrl)}));
      } else {
        res.end(JSON.stringify({ok:true, local:false}));
      }
    } catch(e) { res.end(JSON.stringify({ok:false, error:e.message})); }

  } else if (url === '/api/backfill-fulltext' && req.method === 'POST') {
    // POST /api/backfill-fulltext?limit=20 — fetch full_text per TUTTI gli articoli senza contenuto
    const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit')||'20',10), 50);
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    const db2 = getCodiciDBW();
    if (!db2) { res.end(JSON.stringify({ok:false, error:'DB non disponibile'})); return; }
    (async () => {
      try {
        try { db2.prepare('ALTER TABLE news ADD COLUMN full_text TEXT').run(); } catch(e) {}
        try { db2.prepare('ALTER TABLE news ADD COLUMN url_resolved TEXT').run(); } catch(e) {}
        const rows = db2.prepare("SELECT id, url, title, source_url, url_resolved FROM news WHERE (full_text IS NULL OR full_text = '') AND url IS NOT NULL AND url != '' ORDER BY published_at DESC LIMIT ?").all(limit);
        let fetched = 0, failed = 0, resolved = 0;
        const results = [];
        for (const r of rows) {
          try {
            let targetUrl = r.url;
            // Risolvi Google News URL: prima source_url dal DB, poi HTTP redirect
            if (r.url.includes('news.google.com/')) {
              if (r.source_url && r.source_url.startsWith('http') && !r.source_url.includes('news.google.com')) {
                targetUrl = r.source_url; resolved++;
              } else if (r.url_resolved && r.url_resolved.startsWith('http') && !r.url_resolved.includes('news.google.com')) {
                targetUrl = r.url_resolved; resolved++;
              } else {
                // Prova Puppeteer
                let puppeteerOk = false;
                try {
                  const gnR = require('./gnews-resolver');
                  const pr = await gnR.resolveAndFetch(r.url);
                  if (pr && pr.resolvedUrl) {
                    targetUrl = pr.resolvedUrl; resolved++; puppeteerOk = true;
                    if (pr.text && pr.text.length > 100) {
                      db2.prepare('UPDATE news SET full_text=?, url_resolved=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(pr.text.substring(0,50000), targetUrl, r.id);
                      fetched++;
                      results.push({id:r.id, title:(r.title||'').substring(0,50), status:'ok_puppeteer', chars:pr.text.length, site:getHostname(targetUrl)});
                      await new Promise(resolve => setTimeout(resolve, 2000));
                      continue;
                    }
                  }
                } catch(e) {}
                if (!puppeteerOk) {
                  const rUrl = await resolveGoogleNewsUrl(r.url);
                  if (rUrl) { targetUrl = rUrl; resolved++; }
                  else { failed++; results.push({id:r.id, title:(r.title||'').substring(0,50), status:'gnews_unresolvable'}); continue; }
                }
              }
            }
            const data = await fetchArticle(targetUrl);
            if (data.success && data.textContent && data.textContent.length > 100) {
              db2.prepare('UPDATE news SET full_text=?, url_resolved=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
                .run(data.textContent.substring(0,50000), targetUrl, r.id);
              fetched++;
              results.push({id:r.id, title:r.title.substring(0,50), status:'ok', chars:data.textContent.length, site:getHostname(targetUrl)});
            } else {
              failed++;
              results.push({id:r.id, title:r.title.substring(0,50), status:'no_content', error:data.error||''});
            }
          } catch(e) {
            failed++;
            results.push({id:r.id, title:r.title.substring(0,50), status:'error', error:e.message});
          }
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        res.end(JSON.stringify({ok:true, candidati:rows.length, fetchati:fetched, falliti:failed, gnews_risolti:resolved, dettagli:results}));
      } catch(e) { res.end(JSON.stringify({ok:false, error:e.message})); }
    })();

  } else if (url === '/api/cassazione/cleanup' && req.method === 'POST') {
    // POST /api/cassazione/cleanup — rimuovi tag HTML dalle description esistenti
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    const db2 = getCodiciDBW();
    if (!db2) { res.end(JSON.stringify({ok:false, error:'DB non disponibile'})); return; }
    try {
      // Trova tutte le news con HTML nella description
      const dirty = db2.prepare("SELECT id, description FROM news WHERE description LIKE '%<%' AND (source_name LIKE '%Cassaz%' OR source_name LIKE '%Corte di Cass%')").all();
      let cleaned = 0;
      const upd = db2.prepare('UPDATE news SET description=?, updated_at=CURRENT_TIMESTAMP WHERE id=?');
      const tx = db2.transaction((rows) => {
        for (const r of rows) {
          const clean = (r.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (clean !== r.description) {
            upd.run(clean, r.id);
            cleaned++;
          }
        }
      });
      tx(dirty);
      res.end(JSON.stringify({ok:true, trovate:dirty.length, pulite:cleaned}));
    } catch(e) { res.end(JSON.stringify({ok:false, error:e.message})); }

  } else if (url.startsWith('/api/cassazione/corpus/stats')) {
    // GET /api/cassazione/corpus/stats — conteggi corpus per settore/anno (DB dedicato)
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    const cdb = getCorpusDB();
    if (!cdb) { res.end(JSON.stringify({ok:true, totale:0, per_settore:[], per_anno:[]})); return; }
    try {
      const totale = cdb.prepare('SELECT COUNT(*) n FROM sentenze').get().n;
      const perSettore = cdb.prepare('SELECT settore, COUNT(*) n FROM sentenze GROUP BY settore ORDER BY settore').all();
      const perAnno = cdb.prepare('SELECT settore, anno, COUNT(*) n FROM sentenze GROUP BY settore, anno ORDER BY anno DESC, settore').all();
      res.end(JSON.stringify({ok:true, totale, per_settore:perSettore, per_anno:perAnno}));
    } catch(e) { res.end(JSON.stringify({ok:false, error:e.message})); }

  } else if (url.startsWith('/api/cassazione/corpus/search')) {
    // GET /api/cassazione/corpus/search?q=&settore=&anno=&sezione=&tipo=&limit=&offset=
    // FTS5 sul testo integrale del corpus; paginato con totale.
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    const q = (parsedUrl.searchParams.get('q')||'').trim();
    const settore = (parsedUrl.searchParams.get('settore')||'').toLowerCase().trim();
    const anno = parseInt(parsedUrl.searchParams.get('anno')||'0',10);
    const sezione = (parsedUrl.searchParams.get('sezione')||'').trim();
    const tipo = (parsedUrl.searchParams.get('tipo')||'').trim();
    const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit')||'20',10), 100);
    const offset = Math.max(parseInt(parsedUrl.searchParams.get('offset')||'0',10), 0);
    const cdb = getCorpusDB();
    if (!cdb) { res.end(JSON.stringify({ok:true, total:0, count:0, offset, results:[]})); return; }
    try {
      const filters = [];
      const fp = [];
      if (settore === 'civile' || settore === 'penale') { filters.push('s.settore=?'); fp.push(settore); }
      if (anno >= 2000 && anno <= 2100) { filters.push('s.anno=?'); fp.push(anno); }
      if (sezione) { filters.push('s.sezione=?'); fp.push(sezione); }
      if (tipo) { filters.push('s.tipo_atto=?'); fp.push(tipo); }
      let results = [], total = 0;
      const selCols = `s.id, s.settore, s.tipo_atto, s.sezione, s.anno, s.numero,
                       s.data_decisione, s.data_deposito, s.ecli, s.url_fonte, s.presidente, s.relatore, s.materia`;
      if (q && q.length >= 2) {
        // Query FTS: AND dei termini, ciascuno come frase esatta (robusto a caratteri speciali)
        const ftsQ = q.split(/\s+/).filter(Boolean).map(t => '"'+t.replace(/"/g,'')+'"').join(' AND ');
        const whereFts = ['sentenze_fts MATCH ?'].concat(filters).join(' AND ');
        total = cdb.prepare(`SELECT COUNT(*) n FROM sentenze_fts JOIN sentenze s ON s.id=sentenze_fts.rowid WHERE ${whereFts}`).get(ftsQ, ...fp).n;
        results = cdb.prepare(`
          SELECT ${selCols},
                 snippet(sentenze_fts, 0, '<mark>', '</mark>', '…', 18) AS snippet
          FROM sentenze_fts JOIN sentenze s ON s.id=sentenze_fts.rowid
          WHERE ${whereFts}
          ORDER BY s.data_deposito DESC, s.numero DESC
          LIMIT ? OFFSET ?
        `).all(ftsQ, ...fp, limit, offset);
      } else {
        // Nessuna query: elenco filtrato (tab Archivio)
        const whereB = filters.length ? 'WHERE '+filters.join(' AND ') : '';
        total = cdb.prepare(`SELECT COUNT(*) n FROM sentenze s ${whereB}`).get(...fp).n;
        results = cdb.prepare(`
          SELECT ${selCols}, substr(s.testo_integrale,1,240) AS snippet
          FROM sentenze s ${whereB}
          ORDER BY s.data_deposito DESC, s.numero DESC
          LIMIT ? OFFSET ?
        `).all(...fp, limit, offset);
      }
      res.end(JSON.stringify({ok:true, query:q, total, count:results.length, offset, limit, results}));
    } catch(e) { res.end(JSON.stringify({ok:false, error:e.message, results:[]})); }

  } else if (url.startsWith('/api/cassazione/stats')) {
    // GET /api/cassazione/stats — conteggi del corpus (data/cassazione-corpus.db)
    // per settore, sezione, tipo di atto e anno: stessa fonte del feed della tab.
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    const cdb = getCorpusBB();
    if (!cdb) { res.end(JSON.stringify({ok:true, totale:0, per_settore:[], per_sezione:[], per_tipo:[], per_anno:[], per_fonte:[]})); return; }
    try {
      const totale = cdb.prepare('SELECT COUNT(*) n FROM sentenze').get().n;
      const perSettore = cdb.prepare('SELECT settore, COUNT(*) n FROM sentenze GROUP BY settore ORDER BY n DESC').all();
      const perSezione = cdb.prepare('SELECT sezione, COUNT(*) n FROM sentenze GROUP BY sezione ORDER BY n DESC').all()
        .map(r => ({ sezione: r.sezione, label: cassSezioneLabel(r.sezione, null), n: r.n }));
      const perTipo = cdb.prepare('SELECT tipo_atto, COUNT(*) n FROM sentenze GROUP BY tipo_atto ORDER BY n DESC').all();
      const perAnno = cdb.prepare('SELECT anno, COUNT(*) n FROM sentenze GROUP BY anno ORDER BY anno DESC').all();
      // per_fonte: mantenuto per compatibilità con la vecchia forma della risposta.
      const perFonte = perSettore.map(r => ({
        source_name: 'Corte di Cassazione — ' + (r.settore === 'penale' ? 'Penale' : 'Civile'), n: r.n,
      }));
      res.end(JSON.stringify({ok:true, totale, per_settore:perSettore, per_sezione:perSezione, per_tipo:perTipo, per_anno:perAnno, per_fonte:perFonte}));
    } catch(e) { res.end(JSON.stringify({ok:false, error:e.message})); }

  } else if (url.startsWith('/api/cassazione/search')) {
    // GET /api/cassazione/search?q=risarcimento&sezione=&limit=50&offset=0
    // Ricerca FTS5 sul TESTO INTEGRALE del corpus (data/cassazione-corpus.db).
    const q = (parsedUrl.searchParams.get('q')||'').trim();
    const sezione = (parsedUrl.searchParams.get('sezione')||'').toLowerCase().trim();
    const tipo = (parsedUrl.searchParams.get('tipo')||'').trim();
    const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit')||'50',10),100);
    const offset = Math.max(parseInt(parsedUrl.searchParams.get('offset')||'0',10),0);
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    const vuoto = {ok:true, query:q, total:0, count:0, offset, results:[], notizie:[]};
    if (!q || q.length < 2) { res.end(JSON.stringify(vuoto)); return; }
    const cdb = getCorpusBB();
    if (!cdb) { res.end(JSON.stringify(vuoto)); return; }
    try {
      const filtro = cassFiltroSezione(sezione);
      const fp = filtro ? filtro.par.slice() : [];
      const conds = ['sentenze_fts MATCH ?'];
      if (filtro) conds.push(filtro.sql);
      if (tipo) { conds.push('s.tipo_atto=?'); fp.push(tipo); }
      const where = conds.join(' AND ');
      // Termini in AND, ciascuno come frase esatta: robusto ai caratteri speciali.
      const ftsQ = q.split(/\s+/).filter(Boolean).map(t => '"'+t.replace(/"/g,'')+'"').join(' AND ');
      const total = cdb.prepare(`SELECT COUNT(*) n FROM sentenze_fts JOIN sentenze s ON s.id=sentenze_fts.rowid WHERE ${where}`).get(ftsQ, ...fp).n;
      const rows = cdb.prepare(`
        SELECT ${CASS_CORPUS_COLS},
               snippet(sentenze_fts, 0, '', '', '…', 20) AS snippet
        FROM sentenze_fts JOIN sentenze s ON s.id=sentenze_fts.rowid
        WHERE ${where}
        ORDER BY s.data_deposito DESC, s.numero DESC
        LIMIT ? OFFSET ?
      `).all(ftsQ, ...fp, limit, offset);
      const results = rows.map(cassCorpusItem);
      res.end(JSON.stringify({ok:true, query:q, total, count:results.length, offset, results, notizie:results}));
    } catch(e) { res.end(JSON.stringify({ok:false, error:e.message, query:q, total:0, count:0, offset, results:[], notizie:[]})); }

  } else if (url.startsWith('/api/cassazione/provvedimenti')) {
    // GET /api/cassazione/provvedimenti?sezione=&tipo=&limit=50&offset=0
    // Elenco dei provvedimenti del corpus (data/cassazione-corpus.db), dal più recente.
    const sezione = (parsedUrl.searchParams.get('sezione')||'').toLowerCase();
    const tipo = (parsedUrl.searchParams.get('tipo')||'').trim();
    const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit')||'50',10),200);
    const offset = Math.max(parseInt(parsedUrl.searchParams.get('offset')||'0',10),0);
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    const cdb = getCorpusBB();
    if (!cdb) { res.end(JSON.stringify({ok:true, total:0, count:0, offset, notizie:[]})); return; }
    try {
      const filtro = cassFiltroSezione(sezione);
      const fp = filtro ? filtro.par.slice() : [];
      const conds = [];
      if (filtro) conds.push(filtro.sql);
      if (tipo) { conds.push('s.tipo_atto=?'); fp.push(tipo); }
      const whereB = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
      const total = cdb.prepare(`SELECT COUNT(*) n FROM sentenze s ${whereB}`).get(...fp).n;
      const rows = cdb.prepare(`
        SELECT ${CASS_CORPUS_COLS},
               CASE WHEN s.estratto_ok=1 THEN substr(s.testo_integrale,1,300) ELSE s.nota END AS snippet
        FROM sentenze s ${whereB}
        ORDER BY s.data_deposito DESC, s.numero DESC
        LIMIT ? OFFSET ?
      `).all(...fp, limit, offset);
      const notizie = rows.map(cassCorpusItem);
      res.end(JSON.stringify({ok:true, total, count:notizie.length, offset, notizie}));
    } catch(e) { res.end(JSON.stringify({ok:false, error:e.message, total:0, count:0, offset, notizie:[]})); }

  } else if (url.startsWith('/api/cassazione')) {
    // GET /api/cassazione?sezione=ssuu&limit=50&search=risarcimento
    const sezione = (parsedUrl.searchParams.get('sezione') || '').toLowerCase();
    const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit')||'100',10), 200);
    const search = (parsedUrl.searchParams.get('search') || '').toLowerCase().trim();
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    // Filtra dalla cache gli articoli Cassazione
    const cassCategories = ['cassazione','cassazione_ssuu','cassazione_massimario','cassazione_penale','cassazione_civile','cassazione_lavoro','istituzionale_cassazione'];
    let items = (cache.articles||[]).filter(a => cassCategories.includes(a.category));
    if (sezione) {
      if (sezione === 'ssuu') items = items.filter(a => a.category === 'cassazione_ssuu' || /sezion[ie]\s+unit/i.test(a.title||''));
      else if (sezione === 'penale') items = items.filter(a => a.category === 'cassazione_penale' || /penal/i.test(a.title||'') || /penal/i.test(a.category||''));
      else if (sezione === 'civile') items = items.filter(a => a.category === 'cassazione_civile' || /civil/i.test(a.title||''));
      else if (sezione === 'lavoro') items = items.filter(a => a.category === 'cassazione_lavoro' || /lavor/i.test(a.title||''));
      else if (sezione === 'massimario') items = items.filter(a => a.category === 'cassazione_massimario' || /massim/i.test(a.title||''));
    }
    if (search) items = items.filter(a => (a.title||'').toLowerCase().includes(search) || (a.snippet||a.desc||'').toLowerCase().includes(search));
    // Se cache vuota, prova DB
    if (items.length === 0) {
      const db2 = getCodiciDBW();
      if (db2) {
        try {
          let whereC = "source_name LIKE 'Cassazione —%' AND source_name NOT LIKE '%via %'";
          if (search) whereC += ` AND (title LIKE '%${search.replace(/'/g,"")}%' OR description LIKE '%${search.replace(/'/g,"")}%')`;
          items = db2.prepare(`SELECT id, url, title, description AS desc, source_name AS source, published_at AS date, area_diritto AS category FROM news WHERE ${whereC} ORDER BY published_at DESC LIMIT ?`).all(limit)
            .map(r => ({id:r.id,title:r.title,desc:(r.desc||'').substring(0,300),source:r.source||'Cassazione',link:r.url||'',url:r.url||'',date:r.date||'',category:r.category||'cassazione'}));
        } catch(e) {}
      }
    }
    items = items.slice(0, limit);
    res.end(JSON.stringify({ ok:true, count:items.length, sezione: sezione||'tutte', notizie: items }));

  } else if (url.startsWith('/api/sentenze/sentenza/')) {
    // GET /api/sentenze/sentenza/:id — dettaglio di una sentenza del corpus Cassazione.
    // Alimenta il PannelloSentenza aperto dai link "giurisprudenza correlata" (Scalata v2).
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    try {
      const rawId = decodeURIComponent(url.split('?')[0].split('/api/sentenze/sentenza/')[1] || '');
      const sid = parseInt(rawId, 10);
      const cdb = getCorpusBB();
      if (!cdb || !Number.isFinite(sid)) { res.writeHead(404); res.end(JSON.stringify({ ok:false, error:'Documento non disponibile' })); return; }
      const row = cdb.prepare(`SELECT id, settore, tipo_atto, sezione, anno, numero, data_decisione, data_deposito,
                                      ecli, url_fonte, testo_integrale, estratto_ok, nota, presidente, relatore, materia
                               FROM sentenze WHERE id = ?`).get(sid);
      if (!row) { res.writeHead(404); res.end(JSON.stringify({ ok:false, error:'Documento non disponibile' })); return; }
      // Mappa sui nomi di campo attesi dal PannelloSentenza (tipo/sezione_code/… con default lato client).
      const sentenza = {
        id: row.id,
        tipo: row.tipo_atto || 'Provvedimento',
        settore: row.settore,
        sezione: row.sezione ? `Sez. ${row.sezione} ${row.settore || ''}`.trim() : (row.settore || ''),
        sezione_code: row.sezione || null,
        numero: row.numero,
        anno: row.anno,
        data_decisione: row.data_decisione || '',
        data_deposito: row.data_deposito || '',
        ecli: row.ecli || '',
        url_fonte: row.url_fonte || '',
        materia: row.materia || '',
        presidente: row.presidente || '',
        relatore: row.relatore || '',
        testo_integrale: (row.estratto_ok && row.testo_integrale) ? row.testo_integrale : (row.nota || ''),
        scalata_l0: null, scalata_l1: null, scalata_l2: null,
      };
      res.end(JSON.stringify({ ok:true, sentenza }));
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ ok:false, error:'Documento non disponibile' }));
    }

  } else if (url.startsWith('/api/archivio/stats')) {
    // GET /api/archivio/stats — totale + faccette (anno, sede, tipo) su Giustizia Amministrativa
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    const db2 = getCodiciDBW();
    if (!db2) { res.end(JSON.stringify({ ok:false, total:0 })); return; }
    try {
      // Unica scrittura ammessa: indice mancante per il filtro/faccetta sezione
      try { db2.prepare('CREATE INDEX IF NOT EXISTS idx_ga_sezione ON giustizia_amministrativa(sezione)').run(); } catch(e) {}
      const total = db2.prepare('SELECT COUNT(*) n FROM giustizia_amministrativa').get().n;
      const per_anno = db2.prepare('SELECT anno, COUNT(*) n FROM giustizia_amministrativa GROUP BY anno ORDER BY anno DESC').all();
      const per_tipo = db2.prepare('SELECT tipo, COUNT(*) n FROM giustizia_amministrativa GROUP BY tipo ORDER BY n DESC').all();
      const per_sede = db2.prepare('SELECT sede, COUNT(*) n FROM giustizia_amministrativa GROUP BY sede ORDER BY n DESC').all();
      res.end(JSON.stringify({ ok:true, total, per_anno, per_tipo, per_sede }));
    } catch(e) { res.end(JSON.stringify({ ok:false, error:e.message })); }

  } else if (url.startsWith('/api/archivio/provvedimenti')) {
    // GET /api/archivio/provvedimenti?limit=50&offset=0&anno=&sede=&tipo=&sezione=&q=
    // Archivio completo Giustizia Amministrativa (Consiglio di Stato / TAR) — 316.801 provvedimenti
    res.setHeader('Content-Type','application/json');
    res.setHeader('Access-Control-Allow-Origin','*');
    const limit = Math.min(Math.max(parseInt(parsedUrl.searchParams.get('limit')||'50',10),1),200);
    const offset = Math.max(parseInt(parsedUrl.searchParams.get('offset')||'0',10),0);
    const anno = (parsedUrl.searchParams.get('anno')||'').trim();
    const sede = (parsedUrl.searchParams.get('sede')||'').trim();
    const tipo = (parsedUrl.searchParams.get('tipo')||'').trim();
    const sezione = (parsedUrl.searchParams.get('sezione')||'').trim();
    const q = (parsedUrl.searchParams.get('q')||'').trim();
    const db2 = getCodiciDBW();
    if (!db2) { res.end(JSON.stringify({ ok:false, total:0, count:0, offset, provvedimenti:[] })); return; }
    try {
      const conds = [];
      const params = [];
      if (/^\d{4}$/.test(anno)) { conds.push('anno = ?'); params.push(parseInt(anno,10)); }
      if (sede) { conds.push('sede = ?'); params.push(sede); }
      if (tipo) { conds.push('tipo = ?'); params.push(tipo); }
      if (sezione) { conds.push('sezione = ?'); params.push(sezione); }
      if (q) { conds.push('(numero LIKE ? OR ecli LIKE ?)'); params.push('%'+q+'%', '%'+q+'%'); }
      const where = conds.length ? ('WHERE ' + conds.join(' AND ')) : '';
      const total = db2.prepare(`SELECT COUNT(*) n FROM giustizia_amministrativa ${where}`).get(...params).n;
      const rows = db2.prepare(`
        SELECT id, numero, anno, sezione, sede, tipo, ecli, url_fonte
        FROM giustizia_amministrativa ${where}
        ORDER BY anno DESC, rowid DESC LIMIT ? OFFSET ?
      `).all(...params, limit, offset);
      const provvedimenti = rows.map(r => ({
        id: r.id, numero: r.numero||'', anno: r.anno||null, sezione: r.sezione||'',
        sede: r.sede||'', tipo: r.tipo||'', ecli: r.ecli||'', url: r.url_fonte||'',
        title: `${r.tipo||'Provvedimento'} n. ${r.numero||'—'}/${r.anno||''} — ${r.sede||''}${r.sezione ? ' · '+r.sezione : ''}`.trim(),
      }));
      res.end(JSON.stringify({ ok:true, total, count:provvedimenti.length, offset, provvedimenti }));
    } catch(e) { res.end(JSON.stringify({ ok:false, error:e.message, total:0, provvedimenti:[] })); }

  } else if (url === '/api/db-reload' && req.method === 'POST') {
    // Forza reload connessione DB (dopo import esterno)
    res.setHeader('Content-Type','application/json');
    try {
      if (_codiciBB) { try { _codiciBB.close(); } catch(e) {} _codiciBB = null; }
      if (_codiciBW) { try { _codiciBW.close(); } catch(e) {} _codiciBW = null; }
      const db2 = getCodiciBB();
      const cnt = db2.prepare('SELECT COUNT(*) as n FROM articoli_codice').get();
      res.end(JSON.stringify({ok:true, articoli:cnt.n}));
    } catch(e) { res.end(JSON.stringify({error:e.message})); }

  } else if (url === '/api/manifesto-data') {
    // Task D — contatori live + ultime novità (merge su main). Nessuna scrittura.
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    let fonti_attive = null;
    try {
      const disabled = FEEDS.filter(f => feedHealth[f.u] && feedHealth[f.u].failures >= 5 && Date.now() < feedHealth[f.u].disabledUntil).length;
      fonti_attive = FEEDS.length - disabled;
    } catch(e) {}
    // Niente Cassazione in questa testata: il secondo contatore del manifesto
    // (chiave storica sentenze_corpus) è il numero di ATTI del corpus.
    let sentenze_corpus = null;
    try { const ndb0 = getNormativaBB(); if (ndb0) sentenze_corpus = ndb0.prepare('SELECT COUNT(*) AS n FROM atti WHERE n_articoli > 0').get().n; } catch(e) {}
    let articoli_norme = null;
    try { const gdb = getCodiciBB(); if (gdb) articoli_norme = gdb.prepare('SELECT COUNT(*) AS n FROM articoli_codice').get().n; } catch(e) {}
    // Corpus ecclesiastico: canoni e articoli vivono in normativa.db (atti.n_articoli)
    try {
      const ndb = getNormativaBB();
      if (ndb) {
        const c = ndb.prepare('SELECT COALESCE(SUM(n_articoli),0) AS n FROM atti').get().n;
        articoli_norme = (articoli_norme || 0) + c;
      }
    } catch(e) {}
    getManifestoNovita((novita) => {
      res.end(JSON.stringify({ fonti_attive, sentenze_corpus, articoli_norme, novita: novita || [] }));
    });

  } else if (url.startsWith('/api/articolo/')) {
    // GET /api/articolo/:codiceId/:numero — testo dell'articolo + scalata codici (se presente).
    // La scalata (codici_scalata) è OPZIONALE: null quando l'articolo non è stato scalato,
    // così il frontend può mostrare i livelli L1-L5 solo dove ci sono dati reali.
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      const parts = url.split('?')[0].split('/').filter(Boolean); // ['api','articolo',codiceId,numero]
      const codiceId = decodeURIComponent(parts[2] || '');
      const numero = decodeURIComponent(parts[3] || '');
      if (!codiceId || !numero) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'codice e numero richiesti' })); return; }
      const gdb = getCodiciBB();
      if (!gdb) { res.end(JSON.stringify({ ok: false, error: 'db non disponibile' })); return; }
      const articolo = gdb.prepare(`
        SELECT a.id, a.codice_id, a.numero, a.titolo, a.testo, a.libro, a.titolo_sezione, a.capo, a.urn, a.stato,
               c.nome AS codice_nome, c.sigla AS codice_sigla, c.url AS codice_url
        FROM articoli_codice a JOIN codici c ON c.id = a.codice_id
        WHERE a.codice_id = ? AND a.numero = ? LIMIT 1
      `).get(codiceId, numero);
      if (!articolo) { res.writeHead(404); res.end(JSON.stringify({ ok: false, error: 'articolo non trovato' })); return; }
      let scalata = null;
      try { scalata = gdb.prepare('SELECT * FROM codici_scalata WHERE articolo_id = ? LIMIT 1').get(articolo.id) || null; } catch (e) {}
      res.end(JSON.stringify({ ok: true, articolo, scalata }));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message })); }

  } else if (url.startsWith('/api/norme/analisi')) {
    // GET /api/norme/analisi?codice=X&articolo=Y — analisi AI ON-DEMAND di un articolo.
    // Cache-first: se già in codici_scalata la ritorna (0 chiamate); altrimenti 1 chiamata
    // Haiku (categoria 'analisi-norme', sotto-cap 200/g) e salva. Budget esaurito → messaggio pulito.
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const codice = (parsedUrl.searchParams.get('codice') || '').trim();
    const numero = (parsedUrl.searchParams.get('articolo') || '').trim();
    if (!codice || !numero) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'parametri codice e articolo richiesti' })); return; }
    (async () => {
      try {
        const gdb = getCodiciBB();
        if (!gdb) { res.end(JSON.stringify({ ok: false, error: 'db non disponibile' })); return; }
        const art = gdb.prepare('SELECT id, codice_id, numero, titolo, testo FROM articoli_codice WHERE codice_id=? AND numero=? LIMIT 1').get(codice, numero);
        if (!art) { res.writeHead(404); res.end(JSON.stringify({ ok: false, error: 'articolo non trovato' })); return; }

        // 1) CACHE — se l'analisi esiste già, servila senza chiamare Claude.
        const cached = gdb.prepare('SELECT l1_sintesi, l2_coordinamento, l3_orientamento_prevalente, generato_at, aggiornato_at FROM codici_scalata WHERE articolo_id=? LIMIT 1').get(art.id);
        if (cached && cached.l1_sintesi) {
          res.end(JSON.stringify({ ok: true, cached: true, generato_at: cached.aggiornato_at || cached.generato_at || null,
            analisi: { spiegazione: cached.l1_sintesi, ambito: cached.l2_coordinamento || '', giurisprudenza: cached.l3_orientamento_prevalente || '' } }));
          return;
        }

        // 2) GENERAZIONE — 1 sola chiamata Haiku.
        if (!ANTHROPIC_KEY) { res.end(JSON.stringify({ ok: false, stato: 'no_api_key', message: 'Analisi AI non disponibile al momento.' })); return; }
        if (!canCallClaude('analisi-norme')) {
          res.end(JSON.stringify({ ok: false, stato: 'cap_esaurito', message: 'Il limite giornaliero di analisi AI è stato raggiunto: riprende domani.' }));
          return;
        }

        // Materiali documentali: notizie correlate (codici_news_link) + giurisprudenza (FTS corpus).
        let notizieTxt = '';
        try {
          const nz = gdb.prepare(`SELECT n.title, n.source_name FROM codici_news_link cnl JOIN news n ON n.id = cnl.news_id
                                  WHERE cnl.articolo_id = ? ORDER BY n.published_at DESC LIMIT 8`).all(art.id);
          notizieTxt = nz.map(n => `- ${n.title} (${n.source_name || ''})`).join('\n');
        } catch (e) {}
        let sentTxt = '';
        try {
          const cdb = getCorpusBB();
          let sv2 = null; try { sv2 = require('./services/scalata-v2'); } catch (e) {}
          const termini = sv2 ? sv2.terminiChiave((art.titolo || '') + ' ' + (art.testo || '').substring(0, 120)) : [];
          if (cdb && termini.length) {
            const match = termini.map(t => '"' + t + '"').join(' OR ');
            const rows = cdb.prepare(`SELECT s.tipo_atto, s.numero, s.anno, snippet(sentenze_fts, 0, '', '', '…', 12) AS snip
                                      FROM sentenze_fts f JOIN sentenze s ON s.id = f.rowid WHERE sentenze_fts MATCH ? ORDER BY rank LIMIT 4`).all(match);
            sentTxt = rows.map(s => `- ${s.tipo_atto || 'Provv.'} n.${s.numero}/${s.anno}: ${(s.snip || '').replace(/\s+/g, ' ').trim()}`).join('\n');
          }
        } catch (e) {}

        const payload = {
          model: 'claude-haiku-4-5', max_tokens: 700, temperature: 0.2,
          system: 'Sei un docente di diritto italiano: spieghi gli articoli di legge in modo piano e accessibile. Rispondi SOLO con JSON valido, nessun testo fuori dal JSON. Usa ESCLUSIVAMENTE le informazioni fornite; non inventare norme o sentenze. Niente latino non tradotto.',
          messages: [{ role: 'user', content:
            'ARTICOLO\nCodice: ' + art.codice_id + '\nArticolo: ' + art.numero + '\nTitolo: ' + (art.titolo || '') +
            '\nTesto:\n' + String(art.testo || '').substring(0, 1500) +
            (notizieTxt ? '\n\nNOTIZIE CORRELATE:\n' + notizieTxt : '') +
            (sentTxt ? '\n\nGIURISPRUDENZA CORRELATA:\n' + sentTxt : '') +
            '\n\nProduci questo JSON:\n{"spiegazione":"spiegazione piana dell\'articolo in 5-8 righe, linguaggio accessibile","ambito":"ambito di applicazione: a chi e a cosa si applica, 1-2 righe","giurisprudenza":"orientamento giurisprudenziale rilevante SOLO se emerge dai materiali forniti, altrimenti stringa vuota"}'
          }]
        };
        let claudeRes = null, lastErr = null;
        for (let att = 0; att < 2 && !claudeRes; att++) { try { claudeRes = await _callClaude(payload, 12000); } catch (e) { lastErr = e; } }
        if (!claudeRes || claudeRes.status !== 200) {
          console.error('[AnalisiNorme] Claude err:', claudeRes ? claudeRes.status : (lastErr && lastErr.message));
          res.end(JSON.stringify({ ok: false, stato: 'errore', message: 'Analisi non riuscita, riprova tra poco.' }));
          return;
        }
        const cd = JSON.parse(claudeRes.body);
        const parsed = safeParseJSON((cd.content && cd.content[0] && cd.content[0].text) || '');
        if (!parsed || !parsed.spiegazione) {
          res.end(JSON.stringify({ ok: false, stato: 'errore', message: 'Analisi non riuscita, riprova tra poco.' }));
          return;
        }
        const spiegazione = parsed.spiegazione;
        const ambito = parsed.ambito || null;
        const giurisprudenza = parsed.giurisprudenza || null;

        // 3) UPSERT — binding sicuro: parametri undefined → null espliciti (fix del vecchio bug).
        try {
          const wdb = getCodiciDBW();
          if (wdb) {
            wdb.prepare(`INSERT INTO codici_scalata (articolo_id, l1_sintesi, l2_coordinamento, l3_orientamento_prevalente, aggiornato_at)
                         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                         ON CONFLICT(articolo_id) DO UPDATE SET
                           l1_sintesi = excluded.l1_sintesi,
                           l2_coordinamento = excluded.l2_coordinamento,
                           l3_orientamento_prevalente = excluded.l3_orientamento_prevalente,
                           aggiornato_at = CURRENT_TIMESTAMP`)
              .run(art.id, spiegazione ?? null, ambito ?? null, giurisprudenza ?? null);
          }
        } catch (e) { console.error('[AnalisiNorme] upsert err:', e.message); }

        res.end(JSON.stringify({ ok: true, cached: false, generato_at: new Date().toISOString(),
          analisi: { spiegazione, ambito: ambito || '', giurisprudenza: giurisprudenza || '' } }));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, stato: 'errore', message: 'Analisi non disponibile al momento.' }));
      }
    })();

  } else if (url === '/api/norme/codici') {
    // Task B — elenco codici con conteggio articoli reale. Sola lettura.
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      const gdb = getCodiciBB();
      if (!gdb) { res.end(JSON.stringify({ ok: false, stato: 'in_costruzione', motivo: 'db non disponibile', codici: [] })); return; }
      const rows = gdb.prepare(`
        SELECT c.id, c.nome, c.sigla, c.area, COUNT(a.id) AS num_articoli
        FROM codici c LEFT JOIN articoli_codice a ON a.codice_id = c.id
        GROUP BY c.id
        ORDER BY num_articoli DESC, c.nome ASC
      `).all();
      const conArticoli = rows.filter(r => r.num_articoli > 0);
      const totArticoli = conArticoli.reduce((s, r) => s + r.num_articoli, 0);
      // Corpus Normativa (leggi e decreti): contatori per "X articoli · Y codici · Z atti".
      let totale_atti = 0, totale_articoli_atti = 0, atti_pending = 0;
      try {
        const ndb = getNormativaBB();
        if (ndb) {
          totale_atti = ndb.prepare('SELECT COUNT(*) AS n FROM atti').get().n;
          totale_articoli_atti = ndb.prepare('SELECT COUNT(*) AS n FROM articoli').get().n;
          try { atti_pending = ndb.prepare("SELECT COUNT(*) AS n FROM coda_priorita WHERE stato='pending'").get().n; } catch(e) {}
        }
      } catch(e) {}
      res.end(JSON.stringify({
        ok: true,
        stato: conArticoli.length ? 'attivo' : 'in_costruzione',
        totale_codici: conArticoli.length,
        totale_articoli: totArticoli + totale_articoli_atti,
        totale_articoli_codici: totArticoli,
        totale_atti,
        totale_articoli_atti,
        atti_in_costruzione: atti_pending > 0,
        atti_pending,
        codici: rows,
      }));
    } catch(e) { res.end(JSON.stringify({ ok: false, error: e.message, codici: [] })); }

  } else if (url === '/api/norme/articolo') {
    // Task B — testo di un singolo articolo. Sola lettura.
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const codice = (parsedUrl.searchParams.get('codice') || '').trim();
    const numero = (parsedUrl.searchParams.get('numero') || '').trim();
    if (!codice || !numero) { res.end(JSON.stringify({ ok: false, error: 'parametri codice e numero richiesti' })); return; }
    try {
      const gdb = getCodiciBB();
      if (!gdb) { res.end(JSON.stringify({ ok: false, error: 'db non disponibile' })); return; }
      const row = gdb.prepare(`
        SELECT a.id, a.codice_id, a.numero, a.titolo, a.testo, a.libro, a.titolo_sezione, a.capo, a.urn, a.stato,
               c.nome AS codice_nome, c.sigla AS codice_sigla, c.url AS codice_url
        FROM articoli_codice a JOIN codici c ON c.id = a.codice_id
        WHERE a.codice_id = ? AND a.numero = ? LIMIT 1
      `).get(codice, numero);
      if (!row) { res.end(JSON.stringify({ ok: false, error: 'articolo non trovato' })); return; }
      res.end(JSON.stringify({ ok: true, articolo: row }));
    } catch(e) { res.end(JSON.stringify({ ok: false, error: e.message })); }

  } else if (url === '/api/norme/articoli') {
    // Task B — elenco articoli (numero + titolo) di un codice, per il drill-down. Sola lettura.
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const codice = (parsedUrl.searchParams.get('codice') || '').trim();
    const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit') || '500', 10) || 500, 2000);
    const offset = Math.max(parseInt(parsedUrl.searchParams.get('offset') || '0', 10) || 0, 0);
    if (!codice) { res.end(JSON.stringify({ ok: false, error: 'parametro codice richiesto', articoli: [] })); return; }
    try {
      const gdb = getCodiciBB();
      if (!gdb) { res.end(JSON.stringify({ ok: false, error: 'db non disponibile', articoli: [] })); return; }
      const meta = gdb.prepare('SELECT id, nome, sigla, url FROM codici WHERE id = ?').get(codice);
      const totale = gdb.prepare('SELECT COUNT(*) AS n FROM articoli_codice WHERE codice_id = ?').get(codice).n;
      const rows = gdb.prepare(`
        SELECT numero, titolo, libro, titolo_sezione
        FROM articoli_codice WHERE codice_id = ?
        ORDER BY CAST(numero AS INTEGER), numero
        LIMIT ? OFFSET ?
      `).all(codice, limit, offset);
      res.end(JSON.stringify({ ok: true, codice: meta || null, totale, offset, articoli: rows }));
    } catch(e) { res.end(JSON.stringify({ ok: false, error: e.message, articoli: [] })); }

  } else if (url.startsWith('/api/norme/cerca')) {
    // Task B — ricerca FTS negli articoli dei codici. Sola lettura (articoli_fts già presente).
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const q = (parsedUrl.searchParams.get('q') || '').trim();
    const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit') || '30', 10) || 30, 100);
    const match = buildFtsMatch(q);
    if (!match) { res.end(JSON.stringify({ ok: true, query: q, risultati: [] })); return; }
    try {
      const gdb = getCodiciBB();
      if (!gdb) { res.end(JSON.stringify({ ok: false, error: 'db non disponibile', risultati: [] })); return; }
      const rows = gdb.prepare(`
        SELECT a.id, a.codice_id, a.numero, a.titolo,
               c.nome AS codice_nome, c.sigla AS codice_sigla, c.url AS codice_url,
               snippet(articoli_fts, 4, '[', ']', '…', 14) AS snippet
        FROM articoli_fts f
        JOIN articoli_codice a ON a.rowid = f.rowid
        JOIN codici c ON c.id = a.codice_id
        WHERE articoli_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(match, limit);
      // Corpus Normativa (leggi e decreti): stessa ricerca sul secondo DB.
      let attiRows = [];
      try {
        const ndb = getNormativaBB();
        if (ndb) {
          attiRows = ndb.prepare(`
            SELECT a.numero_articolo AS numero, a.rubrica AS titolo, a.atto_urn,
                   t.titolo AS codice_nome, t.tipo AS codice_sigla, t.url_fonte AS codice_url,
                   snippet(articoli_fts, 0, '[', ']', '…', 14) AS snippet
            FROM articoli_fts f
            JOIN articoli a ON a.id = f.rowid
            JOIN atti t ON t.urn = a.atto_urn
            WHERE articoli_fts MATCH ?
            ORDER BY rank LIMIT ?
          `).all(match, limit).map(r => ({ ...r, fonte_corpus: 'atto' }));
        }
      } catch(e) {}
      const risultati = rows.concat(attiRows);
      res.end(JSON.stringify({ ok: true, query: q, totale: risultati.length, risultati }));
    } catch(e) { res.end(JSON.stringify({ ok: false, error: e.message, risultati: [] })); }

  } else if (url === '/api/norme/atti') {
    // Corpus Normativa — elenco atti (gruppo "Leggi e decreti"). Sola lettura.
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      const ndb = getNormativaBB();
      if (!ndb) { res.end(JSON.stringify({ ok: true, stato: 'in_costruzione', totale_atti: 0, atti: [] })); return; }
      // LIMIT obbligatorio da quando il corpus è alimentato dai pacchetti opendata: prima
      // l'endpoint restituiva TUTTI gli atti, cosa sostenibile con 33 righe e non con ~150.000
      // (decine di MB per richiesta, e altrettante card renderizzate dalla UI).
      const limite = Math.min(Math.max(parseInt(parsedUrl.searchParams.get('limit') || '200', 10) || 200, 1), 500);
      // Filtro per ramo del corpus ecclesiastico (canonico | vaticano |
      // ecclesiastico_it | magistero) — colonna `ordinamento` degli atti.
      const ordinamento = (parsedUrl.searchParams.get('ordinamento') || '').trim();
      const whereOrd = ordinamento ? ' AND ordinamento = ?' : '';
      const args = ordinamento ? [ordinamento] : [];
      const totale_atti = ndb.prepare('SELECT COUNT(*) AS n FROM atti WHERE n_articoli > 0' + whereOrd).get(...args).n;
      const atti = ndb.prepare(`
        SELECT urn, tipo, numero, anno, titolo, url_fonte, n_articoli, ordinamento
        FROM atti WHERE n_articoli > 0${whereOrd} ORDER BY anno DESC, numero DESC LIMIT ?
      `).all(...args, limite);
      // Conteggi per ramo (per le card della pagina Codici)
      let per_ordinamento = [];
      try {
        per_ordinamento = ndb.prepare(
          'SELECT ordinamento, COUNT(*) AS atti, SUM(n_articoli) AS unita FROM atti WHERE n_articoli > 0 GROUP BY ordinamento'
        ).all();
      } catch(e) {}
      let pending = 0;
      try { pending = ndb.prepare("SELECT COUNT(*) AS n FROM coda_priorita WHERE stato='pending'").get().n; } catch(e) {}
      res.end(JSON.stringify({
        ok: true, stato: totale_atti ? 'attivo' : 'in_costruzione',
        totale_atti, mostrati: atti.length, limite,
        in_costruzione: pending > 0, pending, atti, per_ordinamento,
      }));
    } catch(e) { res.end(JSON.stringify({ ok: false, error: e.message, atti: [] })); }

  } else if (url === '/api/norme/atto-articoli') {
    // Corpus Normativa — elenco articoli di un atto (drill-down). Sola lettura.
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const urn = (parsedUrl.searchParams.get('urn') || '').trim();
    if (!urn) { res.end(JSON.stringify({ ok: false, error: 'parametro urn richiesto', articoli: [] })); return; }
    try {
      const ndb = getNormativaBB();
      if (!ndb) { res.end(JSON.stringify({ ok: false, error: 'db non disponibile', articoli: [] })); return; }
      const atto = ndb.prepare('SELECT urn, tipo, numero, anno, titolo, url_fonte, n_articoli FROM atti WHERE urn = ?').get(urn);
      const articoli = ndb.prepare('SELECT numero_articolo AS numero, rubrica AS titolo FROM articoli WHERE atto_urn = ? ORDER BY ordine').all(urn);
      res.end(JSON.stringify({ ok: true, atto: atto || null, totale: articoli.length, articoli }));
    } catch(e) { res.end(JSON.stringify({ ok: false, error: e.message, articoli: [] })); }

  } else if (url === '/api/norme/atto-articolo') {
    // Corpus Normativa — testo di un singolo articolo di un atto. Sola lettura.
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const urn = (parsedUrl.searchParams.get('urn') || '').trim();
    const numero = (parsedUrl.searchParams.get('numero') || '').trim();
    if (!urn || !numero) { res.end(JSON.stringify({ ok: false, error: 'parametri urn e numero richiesti' })); return; }
    try {
      const ndb = getNormativaBB();
      if (!ndb) { res.end(JSON.stringify({ ok: false, error: 'db non disponibile' })); return; }
      const row = ndb.prepare(`
        SELECT a.numero_articolo AS numero, a.rubrica AS titolo, a.testo_vigente AS testo,
               t.titolo AS codice_nome, t.tipo AS codice_sigla, t.url_fonte AS codice_url, t.urn AS atto_urn
        FROM articoli a JOIN atti t ON t.urn = a.atto_urn
        WHERE a.atto_urn = ? AND a.numero_articolo = ? LIMIT 1
      `).get(urn, numero);
      if (!row) { res.writeHead(404); res.end(JSON.stringify({ ok: false, error: 'articolo non trovato' })); return; }
      res.end(JSON.stringify({ ok: true, articolo: row }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message })); }

  } else if (url.startsWith('/api/norme/atto-analisi')) {
    // Analisi AI ON-DEMAND di un articolo del corpus Normativa. Cache-first (analisi_articolo),
    // altrimenti 1 chiamata Haiku (categoria 'analisi-norme', stesso cap dei codici).
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const urn = (parsedUrl.searchParams.get('urn') || '').trim();
    const numero = (parsedUrl.searchParams.get('numero') || '').trim();
    if (!urn || !numero) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'parametri urn e numero richiesti' })); return; }
    (async () => {
      try {
        const ndb = getNormativaBB();
        if (!ndb) { res.end(JSON.stringify({ ok: false, error: 'db non disponibile' })); return; }
        const art = ndb.prepare(`SELECT a.numero_articolo, a.rubrica, a.testo_vigente, t.titolo AS atto_titolo
                                 FROM articoli a JOIN atti t ON t.urn=a.atto_urn
                                 WHERE a.atto_urn=? AND a.numero_articolo=? LIMIT 1`).get(urn, numero);
        if (!art) { res.writeHead(404); res.end(JSON.stringify({ ok: false, error: 'articolo non trovato' })); return; }

        // 1) CACHE — tollerante: se la tabella non esiste ancora (viene creata
        // dal primo salvataggio via getNormativaDBW) si genera e basta.
        let cached = null;
        try {
          cached = ndb.prepare('SELECT spiegazione, ambito, giurisprudenza, generato_at FROM analisi_articolo WHERE atto_urn=? AND numero_articolo=? LIMIT 1').get(urn, numero);
        } catch (e) { /* no such table: prima analisi di sempre */ }
        if (cached && cached.spiegazione) {
          res.end(JSON.stringify({ ok: true, cached: true, generato_at: cached.generato_at || null,
            analisi: { spiegazione: cached.spiegazione, ambito: cached.ambito || '', giurisprudenza: cached.giurisprudenza || '' } }));
          return;
        }

        // 2) GENERAZIONE — 1 sola chiamata Haiku (stesso cap dei codici).
        if (!ANTHROPIC_KEY) { res.end(JSON.stringify({ ok: false, stato: 'no_api_key', message: 'Analisi AI non disponibile al momento.' })); return; }
        if (!canCallClaude('analisi-norme')) {
          res.end(JSON.stringify({ ok: false, stato: 'cap_esaurito', message: 'Il limite giornaliero di analisi AI è stato raggiunto: riprende domani.' }));
          return;
        }
        // Giurisprudenza correlata dal corpus Cassazione (FTS).
        let sentTxt = '';
        try {
          const cdb = getCorpusBB();
          let sv2 = null; try { sv2 = require('./services/scalata-v2'); } catch (e) {}
          const termini = sv2 ? sv2.terminiChiave((art.rubrica || '') + ' ' + (art.testo_vigente || '').substring(0, 120)) : [];
          if (cdb && termini.length) {
            const match = termini.map(t => '"' + t + '"').join(' OR ');
            const rows = cdb.prepare(`SELECT s.tipo_atto, s.numero, s.anno, snippet(sentenze_fts, 0, '', '', '…', 12) AS snip
                                      FROM sentenze_fts f JOIN sentenze s ON s.id = f.rowid WHERE sentenze_fts MATCH ? ORDER BY rank LIMIT 4`).all(match);
            sentTxt = rows.map(s => `- ${s.tipo_atto || 'Provv.'} n.${s.numero}/${s.anno}: ${(s.snip || '').replace(/\s+/g, ' ').trim()}`).join('\n');
          }
        } catch (e) {}

        const payload = {
          model: 'claude-haiku-4-5', max_tokens: 700, temperature: 0.2,
          system: 'Sei un docente di diritto italiano: spieghi gli articoli di legge in modo piano e accessibile. Rispondi SOLO con JSON valido, nessun testo fuori dal JSON. Usa ESCLUSIVAMENTE le informazioni fornite; non inventare norme o sentenze. Niente latino non tradotto.',
          messages: [{ role: 'user', content:
            'ARTICOLO\nAtto: ' + (art.atto_titolo || '') + '\nArticolo: ' + art.numero_articolo + '\nRubrica: ' + (art.rubrica || '') +
            '\nTesto:\n' + String(art.testo_vigente || '').substring(0, 1500) +
            (sentTxt ? '\n\nGIURISPRUDENZA CORRELATA:\n' + sentTxt : '') +
            '\n\nProduci questo JSON:\n{"spiegazione":"spiegazione piana dell\'articolo in 5-8 righe, linguaggio accessibile","ambito":"ambito di applicazione: a chi e a cosa si applica, 1-2 righe","giurisprudenza":"orientamento giurisprudenziale rilevante SOLO se emerge dai materiali forniti, altrimenti stringa vuota"}'
          }]
        };
        let claudeRes = null, lastErr = null;
        for (let att = 0; att < 2 && !claudeRes; att++) { try { claudeRes = await _callClaude(payload, 12000); } catch (e) { lastErr = e; } }
        if (!claudeRes || claudeRes.status !== 200) {
          console.error('[AnalisiAtto] Claude err:', claudeRes ? claudeRes.status : (lastErr && lastErr.message));
          res.end(JSON.stringify({ ok: false, stato: 'errore', message: 'Analisi non riuscita, riprova tra poco.' }));
          return;
        }
        const cd = JSON.parse(claudeRes.body);
        const parsed = safeParseJSON((cd.content && cd.content[0] && cd.content[0].text) || '');
        if (!parsed || !parsed.spiegazione) {
          res.end(JSON.stringify({ ok: false, stato: 'errore', message: 'Analisi non riuscita, riprova tra poco.' }));
          return;
        }
        const spiegazione = parsed.spiegazione, ambito = parsed.ambito || null, giurisprudenza = parsed.giurisprudenza || null;
        try {
          const wdb = getNormativaDBW();
          if (wdb) {
            wdb.prepare(`INSERT INTO analisi_articolo (atto_urn, numero_articolo, spiegazione, ambito, giurisprudenza, generato_at)
                         VALUES (?, ?, ?, ?, ?, datetime('now'))
                         ON CONFLICT(atto_urn, numero_articolo) DO UPDATE SET
                           spiegazione=excluded.spiegazione, ambito=excluded.ambito,
                           giurisprudenza=excluded.giurisprudenza, generato_at=datetime('now')`)
              .run(urn, numero, spiegazione ?? null, ambito ?? null, giurisprudenza ?? null);
          }
        } catch (e) { console.error('[AnalisiAtto] upsert err:', e.message); }

        res.end(JSON.stringify({ ok: true, cached: false, generato_at: new Date().toISOString(),
          analisi: { spiegazione, ambito: ambito || '', giurisprudenza: giurisprudenza || '' } }));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, stato: 'errore', message: 'Analisi non disponibile al momento.' }));
      }
    })();

  } else if (url.startsWith('/api/ricerca')) {
    // Task C — ricerca giuridica UNIFICATA: notizie + Cassazione (corpus) + norme. Sola lettura.
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const q = (parsedUrl.searchParams.get('q') || '').trim();
    if (!q || q.length < 2) { res.end(JSON.stringify({ ok: true, query: q, notizie: [], cassazione: [], norme: [] })); return; }
    const terms = q.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    const match = buildFtsMatch(q);

    // ── NOTIZIE: cache in memoria + full_text da news (sola lettura) ──
    let notizie = [];
    try {
      notizie = (cache.articles || []).filter(a => {
        const hay = ((a.title || '') + ' ' + (a.desc || a.snippet || '') + ' ' + (a.source || '') + ' ' + (a.full_text || '') + ' ' + (a.l2_contesto || '')).toLowerCase();
        return terms.every(t => hay.includes(t));
      }).slice(0, 10).map(a => ({
        id: a.id, titolo: a.title, url: a.url || a.link, fonte: a.source || a.source_name || 'Notizia', data: a.date,
      }));
    } catch(e) {}
    if (notizie.length < 10) {
      try {
        const gdb = getCodiciBB();
        if (gdb) {
          const likeQ = '%' + terms.join('%') + '%';
          const dbRows = gdb.prepare(`
            SELECT id, title, url, source_name AS fonte, published_at AS data
            FROM news
            WHERE (title LIKE ? OR description LIKE ? OR full_text LIKE ?)
            ORDER BY published_at DESC LIMIT ?
          `).all(likeQ, likeQ, likeQ, 10 - notizie.length);
          const seen = new Set(notizie.map(n => (n.titolo || '').toLowerCase()));
          for (const r of dbRows) {
            const key = (r.title || '').toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            notizie.push({ id: r.id, titolo: r.title, url: r.url, fonte: r.fonte || 'Notizia', data: r.data });
          }
        }
      } catch(e) {}
    }

    // ── CASSAZIONE: corpus FTS (sola lettura) ──
    let cassazione = [];
    if (match) {
      try {
        const cdb = getCorpusBB();
        if (cdb) {
          const rows = cdb.prepare(`
            SELECT s.id, s.settore, s.tipo_atto, s.sezione, s.anno, s.numero, s.data_deposito, s.url_fonte, s.ecli,
                   snippet(sentenze_fts, 0, '[', ']', '…', 14) AS snippet
            FROM sentenze_fts f JOIN sentenze s ON s.id = f.rowid
            WHERE sentenze_fts MATCH ?
            ORDER BY rank LIMIT 10
          `).all(match);
          cassazione = rows.map(s => ({
            id: s.id,
            titolo: `${s.tipo_atto || 'Provvedimento'} n. ${s.numero}/${s.anno}` + (s.sezione ? ` — Sez. ${s.sezione}` : '') + ` (${s.settore})`,
            url: s.url_fonte, fonte: 'Corte di Cassazione', data: s.data_deposito, ecli: s.ecli, snippet: s.snippet,
          }));
        }
      } catch(e) {}
    }

    // ── NORME: articoli_fts (sola lettura) ──
    let norme = [];
    if (match) {
      try {
        const gdb = getCodiciBB();
        if (gdb) {
          const rows = gdb.prepare(`
            SELECT a.id, a.codice_id, a.numero, a.titolo,
                   c.nome AS codice_nome, c.sigla AS codice_sigla, c.url AS codice_url,
                   snippet(articoli_fts, 4, '[', ']', '…', 14) AS snippet
            FROM articoli_fts f
            JOIN articoli_codice a ON a.rowid = f.rowid
            JOIN codici c ON c.id = a.codice_id
            WHERE articoli_fts MATCH ?
            ORDER BY rank LIMIT 10
          `).all(match);
          norme = rows.map(r => ({
            id: r.id, codice_id: r.codice_id, numero: r.numero,
            titolo: `Art. ${r.numero} ${r.codice_sigla || ''}`.trim() + (r.titolo ? ` — ${r.titolo}` : ''),
            url: r.codice_url, fonte: r.codice_nome, snippet: r.snippet,
          }));
        }
        // Corpus Normativa (leggi e decreti)
        const ndb = getNormativaBB();
        if (ndb) {
          const arows = ndb.prepare(`
            SELECT a.numero_articolo AS numero, a.rubrica AS titolo, a.atto_urn,
                   t.titolo AS atto_titolo, t.tipo AS atto_tipo, t.url_fonte AS url,
                   snippet(articoli_fts, 0, '[', ']', '…', 14) AS snippet
            FROM articoli_fts f JOIN articoli a ON a.id = f.rowid JOIN atti t ON t.urn = a.atto_urn
            WHERE articoli_fts MATCH ? ORDER BY rank LIMIT 10
          `).all(match);
          for (const r of arows) norme.push({
            atto_urn: r.atto_urn, numero: r.numero,
            titolo: `Art. ${r.numero} ${r.atto_tipo || ''}`.trim() + (r.titolo ? ` — ${r.titolo}` : ''),
            url: r.url, fonte: r.atto_titolo, snippet: r.snippet, fonte_corpus: 'atto',
          });
        }
      } catch(e) {}
    }

    res.end(JSON.stringify({ ok: true, query: q, notizie, cassazione, norme }));

  } else if (url === '/api/health') {
    const disabledFeeds = FEEDS
      .filter(f => feedHealth[f.u] && feedHealth[f.u].failures >= 5 && Date.now() < feedHealth[f.u].disabledUntil)
      .map(f => ({ name: f.n, url: f.u, disabledUntil: new Date(feedHealth[f.u].disabledUntil).toISOString() }));
    const activeFeedsNow = FEEDS.length - disabledFeeds.length;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      totalFeeds: FEEDS.length,
      activeFeedsNow,
      disabledFeeds,
      articles: cache.articles.length,
      sources: cache.sources,
      uptime: process.uptime()
    }));
  } else if (url === '/reset-sw' || url === '/reset-sw.html') {
    try {
      const html = fs.readFileSync(require('path').join(__dirname, 'app', 'reset-sw.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.end(html);
    } catch(e) { res.writeHead(404); res.end('Not found'); }
    return;
  } else if (url === '/privacy' || url === '/privacy.html') {
    try { const html = fs.readFileSync(__dirname + '/privacy.html','utf8');
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); res.end(html);
    } catch(e){ res.writeHead(404); res.end('Not found'); }
  } else if (url === '/manifesto' || url === '/manifesto.html') {
    try {
      const html = fs.readFileSync(__dirname + '/manifesto.html', 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.end(html);
    } catch(e) { res.writeHead(404); res.end('Not found'); }
  } else if (url === '/' || url === '/index.html') {
    // SSR per crawler (Googlebot, Bingbot, social scrapers)
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    const isCrawler = /googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|facebot|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|applebot|petalbot|semrushbot|ahrefsbot|ia_archiver|archive\.org_bot|slack/.test(ua);
    if (!isCrawler) {
      try {
        let html = fs.readFileSync(require('path').join(__dirname, 'app', 'index.html'), 'utf8');
        // Inietta version token per cache busting
        html = html.replace('</head>', '<meta name="cache-ts" content="' + SERVER_START_TS + '"></head>');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('ETag', '"' + SERVER_START_TS + '"');
        res.setHeader('Pragma', 'no-cache');
        res.end(html);
      } catch(e) { res.writeHead(404); res.end('Not found'); }
      return;
    }
    // SSR: HTML con articoli reali per i crawler
    const arts = (cache.articles || []).slice(0, 30);
    const artHtml = arts.map(a => {
      const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      const title = esc(a.title || '');
      const source = esc(a.source || a.source_name || '');
      const desc = esc((a.desc || '').substring(0, 250));
      const link = esc(a.url || a.link || '#');
      const cat = esc(a.category || '');
      const dateIso = a.date || '';
      const dateStr = dateIso ? new Date(dateIso).toLocaleDateString('it-IT', {day:'numeric',month:'long',year:'numeric'}) : '';
      return '<article itemscope itemtype="https://schema.org/NewsArticle">'
        + '<h2 itemprop="headline"><a href="' + link + '" itemprop="url" rel="noopener">' + title + '</a></h2>'
        + '<p>'
        + '<span itemprop="publisher" itemscope itemtype="https://schema.org/Organization"><span itemprop="name">' + source + '</span></span>'
        + (dateStr ? ' · <time itemprop="datePublished" datetime="' + dateIso + '">' + dateStr + '</time>' : '')
        + (cat ? ' · <span itemprop="articleSection">' + cat + '</span>' : '')
        + '</p>'
        + (desc ? '<p itemprop="description">' + desc + '</p>' : '')
        + '</article>';
    }).join('\n');
    const ssrHtml = '<!DOCTYPE html>\n<html lang="it">\n<head>\n'
      + '<meta charset="UTF-8">\n'
      + '<title>Edicola Ecclesiastica \u2014 Notizie Scalabili senza algoritmi</title>\n'
      + '<meta name="description" content="Per ogni notizia, 6 livelli di comprensione: dal fatto alle implicazioni. 650+ fonti RSS, aggiornamento ogni 5 minuti. Nessun algoritmo decide cosa leggi.">\n'
      + '<link rel="canonical" href="https://edicolaecclesiastica.com/">\n'
      + '<meta property="og:title" content="Edicola Ecclesiastica \u2014 Notizie Scalabili">\n'
      + '<meta property="og:description" content="Non ti diciamo cosa pensare. Ti diamo 6 livelli per capire. 650+ fonti, zero algoritmi.">\n'
      + '<meta property="og:image" content="https://edicolaecclesiastica.com/og-image.png">\n'
      + '<script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsMediaOrganization","name":"Edicola Ecclesiastica","url":"https://edicolaecclesiastica.com/","publishingPrinciples":"https://edicolaecclesiastica.com/manifesto"}</script>\n'
      + '</head>\n<body>\n'
      + '<header><h1>Edicola Ecclesiastica \u2014 Notizie Scalabili</h1>'
      + '<p>Il primo aggregatore con 6 livelli di comprensione per ogni notizia. <a href="/manifesto">Il Manifesto</a></p></header>\n'
      + '<main>\n<h2>Ultime notizie (' + arts.length + ' articoli)</h2>\n'
      + artHtml
      + '\n</main>\n'
      + '<footer><p>Edicola Ecclesiastica \xb7 <a href="/manifesto">Manifesto</a> \xb7 <a href="/sitemap.xml">Sitemap</a></p></footer>\n'
      + '</body>\n</html>';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-SSR', 'true');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.end(ssrHtml);
  } else if (url === '/app' || url === '/app/') {
    res.writeHead(301, {'Location': '/app/index.html'}); res.end();
  } else if (url.startsWith('/app/')) {
    const fname = url.replace('/app/', '') || 'index.html';
    const fpath = require('path').join(__dirname, 'app', fname);
    const ext = fname.split('.').pop();
    const mimes = {html:'text/html',js:'application/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',ico:'image/x-icon',json:'application/json'};
    res.setHeader('Content-Type', mimes[ext] || 'application/octet-stream');
    if (ext !== 'html') res.setHeader('Cache-Control','public, max-age=31536000');
    try { res.end(require('fs').readFileSync(fpath)); } catch(e) {
      // SPA fallback
      try { res.end(require('fs').readFileSync(require('path').join(__dirname,'app','index.html'))); } catch(e2) { res.writeHead(404); res.end(''); }
    }
  } else if (url === '/sw.js') {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try { res.end(fs.readFileSync(__dirname + '/sw.js','utf8')); } catch(e) { res.end(''); }
  } else if (url === '/manifest.json') {
    res.setHeader('Content-Type', 'application/json');
    try { res.end(fs.readFileSync(__dirname + '/app/manifest.json','utf8')); } catch(e) { res.end('{}'); }
  } else if (url.startsWith('/icons/')) {
    var iconPath = __dirname + '/app' + url;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    try { res.end(fs.readFileSync(iconPath)); } catch(e) { res.writeHead(404); res.end(''); }
  } else if (/^\/(logo-edicola\.png|stemma\.png|logo-tondo\.png|favicon\.png|icon-192\.png|icon-512\.png|icon-maskable-192\.png|icon-maskable-512\.png|og-image\.png|robots\.txt|sitemap\.xml)$/.test(url)) {
    const fname = url.slice(1);
    const ext = fname.split('.').pop();
    const mime = {png:'image/png',jpg:'image/jpeg',txt:'text/plain',xml:'application/xml'}[ext]||'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    try { res.end(fs.readFileSync(__dirname + '/'+fname)); } catch(e) { res.writeHead(404); res.end(''); }
  } else {
    res.writeHead(404); res.end('Not found');
  }



}).listen(PORT, '127.0.0.1', () => {
  console.log(`Edicola Ecclesiastica server on port ${PORT} — ${FEEDS.length} feed configured`);
  // Sprint 1 — avvia i job KEEP (scraper istituzionali/cassazione, backup, stats) all'avvio
  try { bootJobs(); } catch(e) { console.warn('[bootJobs] err:', e.message); }
  // warm-up cache on start
  console.log('Warming up cache...');
  refreshFeeds().then(() => console.log(`Cache ready: ${cache.articles.length} articles from ${cache.sources} sources`));
});

// health check al boot — non bloccante
setTimeout(() => {
  const checkFeed = (feed) => new Promise(resolve => {
    try {
      const mod = feed.u.startsWith('https') ? https : http;
      const req = mod.request(feed.u, { method: 'HEAD', timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EdicolaBot/2.0)' }
      }, res => {
        const ok = res.statusCode >= 200 && res.statusCode < 400;
        res.resume();
        resolve(ok);
      });
      req.on('error', () => { resolve(false); });
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    } catch(e) { resolve(false); }
  });
  console.log('[BOOT] Starting background health check for all feeds…');
  Promise.allSettled(FEEDS.map(f => checkFeed(f))).then(results => {
    const ok = results.filter(r => r.value === true).length;
    const fail = results.filter(r => r.value === false).length;
    console.log(`[BOOT] Health check done. ${ok}/${FEEDS.length} feeds reachable, ${fail} unreachable (not disabled).`);
  });
}, 2000);
