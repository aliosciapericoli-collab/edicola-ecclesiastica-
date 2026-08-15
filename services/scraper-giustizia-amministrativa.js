'use strict';
/**
 * services/scraper-giustizia-amministrativa.js
 * Scarica sentenze e ordinanze di TAR e Consiglio di Stato
 * da giustizia-amministrativa.it (portale Liferay + mdp.* backend).
 *
 * Flusso:
 *   1. GET /web/guest/dcsnprr → estrai cookie sessione + p_auth CSRF token
 *   2. POST ricerca per anno/sede/tipo → HTML con lista risultati (20 per pagina)
 *   3. Per ogni risultato, estrai metadati dall'HTML listing
 *   4. Opzionale: GET mdp.* per testo completo (XML)
 *   5. INSERT OR IGNORE in giustizia_amministrativa
 *
 * Esegui: node services/scraper-giustizia-amministrativa.js [--test] [--anno=2025]
 *   --test: solo prime 2 pagine CdS 2025
 *   --anno=NNNN: scarica solo quell'anno (default: 2025..2020)
 */

const Database = require('better-sqlite3');
const path     = require('path');
const https    = require('https');
const http     = require('http');

const DB_PATH  = path.join(__dirname, '..', 'data', 'giuridica.db');

// ── Configurazione ────────────────────────────────────────────────────────────
const BASE_HOST    = 'www.giustizia-amministrativa.it';
const MDP_HOST     = 'mdp.giustizia-amministrativa.it';
const SEARCH_PATH  = '/web/guest/dcsnprr';
const PAGE_SIZE    = 20;
const DELAY_MS     = 1000;   // 1 secondo tra richieste
const FETCH_TESTO  = false;  // true = scarica XML testo completo (molto più lento)

// Argomenti CLI
const args    = process.argv.slice(2);
const IS_TEST = args.includes('--test');
const ANNO_ARG = (args.find(a => a.startsWith('--anno=')) || '').replace('--anno=', '') || null;

// Anni da scaricare (più recente prima)
const ANNI = ANNO_ARG
  ? [parseInt(ANNO_ARG, 10)]
  : [2025, 2024, 2023, 2022, 2021, 2020];

// Sedi da scaricare
const SEDI = [
  'Consiglio di Stato',
  'Roma',
  'Milano',
  'Napoli',
  'Torino',
  'Palermo',
  'Bologna',
  'Firenze',
  'Venezia',
  'Bari',
  'Catania',
  'Catanzaro',
  'Genova',
  'Perugia',
  'Brescia',
  'L\'Aquila',
  'Cagliari',
  'Lecce',
  'Ancona',
  'Trento',
  'Trieste',
  'Bolzano',
  'Salerno',
  'Reggio Calabria',
  'Potenza',
  'Parma',
  'Aosta',
  'Latina',
  'Campobasso',
  'Pescara',
  'C.G.A.R.S',  // CGA Sicilia
];

// In modalità test: solo CdS 2025, 2 pagine
const SEDI_TEST = ['Consiglio di Stato'];

// ── Utility ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

/**
 * Fetch HTTP/HTTPS con gestione cookie, redirect e timeout.
 * Ignora errori SSL (il sito GA ha certificato CA non standard).
 */
function fetchUrl(options, body, cookies) {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const cookieStr = Object.entries(cookies || {}).map(([k,v]) => `${k}=${v}`).join('; ');

    const reqOpts = {
      method:  options.method || 'GET',
      host:    options.host   || BASE_HOST,
      path:    options.path,
      headers: {
        'User-Agent':   'Mozilla/5.0 (compatible; EdicolaEcclesiastica/1.0; research)',
        'Accept':       'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9',
        ...(cookieStr ? { 'Cookie': cookieStr } : {}),
        ...(options.headers || {}),
      },
      agent,
      timeout: 20000,
    };

    if (body) {
      reqOpts.headers['Content-Type']   = 'application/x-www-form-urlencoded';
      reqOpts.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const proto = options.port === 80 ? http : https;
    const req = proto.request(reqOpts, res => {
      // Gestione redirect
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location;
        const newCookies = parseCookies(res.headers['set-cookie'] || [], cookies);
        const url = new URL(loc, `https://${options.host}`);
        return fetchUrl({ host: url.hostname, path: url.pathname + url.search }, null, newCookies)
          .then(resolve).catch(reject);
      }

      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const newCookies = parseCookies(res.headers['set-cookie'] || [], cookies);
        resolve({
          status:  res.statusCode,
          headers: res.headers,
          body:    Buffer.concat(chunks).toString('utf8'),
          cookies: newCookies,
        });
      });
      res.on('error', reject);
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function parseCookies(setCookieHeaders, existing) {
  const result = { ...(existing || {}) };
  for (const h of setCookieHeaders) {
    const part = h.split(';')[0].trim();
    const eq   = part.indexOf('=');
    if (eq > 0) result[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return result;
}

function encodeForm(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

// ── Parser HTML ───────────────────────────────────────────────────────────────

/**
 * Estrae p_auth (token CSRF Liferay) e portlet ID dalla pagina di ricerca.
 * Il portlet ID ha la forma: decisioni_pareri_web_DecisioniPareriWebPortlet_INSTANCE_XXXXXXXXXX
 */
function extractPortletInfo(html) {
  // Cerca il portlet ID con il suffisso istanza
  const portletMatch = html.match(/decisioni_pareri_web_DecisioniPareriWebPortlet_INSTANCE_([A-Za-z0-9]+)/);
  const portletId = portletMatch ? portletMatch[0] : null;

  // Cerca p_auth
  const authMatch = html.match(/p_auth[=\s:"']+([A-Za-z0-9_-]{8,20})/);
  const pAuth = authMatch ? authMatch[1] : null;

  return { portletId, pAuth };
}

/**
 * Estrae totale risultati dall'HTML: "Trovati <strong>71144</strong> risultati"
 */
function extractTotal(html) {
  const m = html.match(/Trovati[^<]*<[^>]+>(\d+)<\/[^>]+>\s*risultati/i)
           || html.match(/(\d+)\s*risultati?/i);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Estrae lista provvedimenti dall'HTML dei risultati.
 * Ogni <article class="ricerca--item"> contiene metadati.
 */
function extractProvvedimenti(html) {
  const results = [];

  // Trova tutti i blocchi article
  const articleRe = /<article[^>]*class="[^"]*ricerca--item[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let am;
  while ((am = articleRe.exec(html)) !== null) {
    const block = am[1];

    try {
      // Link principale con data-attributes
      const linkRe = /<a[^>]+class="[^"]*visited-provvedimenti[^"]*"[^>]*>/i;
      const linkM  = block.match(linkRe);

      let nrg = '', schema = '', idprovv = '', href = '';
      if (linkM) {
        const lTag = linkM[0];
        nrg     = (lTag.match(/data-nrg="([^"]+)"/)    || [])[1] || '';
        schema  = (lTag.match(/data-sede="([^"]+)"/)   || [])[1] || '';
        idprovv = (lTag.match(/data-idprovv="([^"]+)"/) || [])[1] || '';
        href    = (lTag.match(/href="([^"]+)"/)         || [])[1] || '';
      }

      // Testo del link di visualizzazione: "202524201 (ROMA, SEZIONE 5) html"
      const viewLinkM = block.match(/<a[^>]+href="https:\/\/mdp\.[^"]*"[^>]*title="Visualizza[^"]*"[^>]*>([^<]+)<\/a>/i);
      const viewText  = viewLinkM ? viewLinkM[1].trim() : '';

      // Numero provvedimento dal testo del link: primo numero
      const numM      = viewText.match(/^(\d+)/);
      const numero    = numM ? numM[1] : '';

      // Sede e sezione dal testo: "(ROMA, SEZIONE 5)"
      const sedeM     = viewText.match(/\(([^,)]+)(?:,\s*([^)]+))?\)/);
      const sede      = sedeM ? sedeM[1].trim() : '';
      const sezione   = sedeM && sedeM[2] ? sedeM[2].trim() : '';

      // Tipo provvedimento: "<b>SENTENZA</b> sede di" oppure "<b>ORDINANZA COLLEGIALE</b> sede di"
      // Il tipo precede sempre "sede di" oppure " - " nel testo strutturato del metadata
      const tipoM     = block.match(/<b>([A-Z][A-Z\s]{2,40}?)<\/b>\s*(?:sede\s+di|-\s+(?:sede|sezione))/i)
                     || block.match(/<b>(SENTENZA|ORDINANZA[^<]*|DECRETO[^<]*|PARERE[^<]*|ADUNANZA[^<]*)<\/b>/i);
      const tipo      = tipoM ? tipoM[1].trim() : '';

      // Numero ricorso (NRG) dal testo: "Numero ricorso: <b>202507797</b>"
      const nrgTextM  = block.match(/Numero ricorso:\s*<b>(\d+)<\/b>/i);
      const nrgText   = nrgTextM ? nrgTextM[1] : nrg;

      // ECLI: ECLI:IT:TARLAZ:2025:24201SENT
      const ecliM     = block.match(/<b>(ECLI:[^<]+)<\/b>/i);
      const ecli      = ecliM ? ecliM[1].trim() : '';

      // Anno dalla ECLI o dal NRG (primi 4 cifre)
      const ecliAnnoM = ecli.match(/:(\d{4}):/);
      const anno      = ecliAnnoM ? ecliAnnoM[1] : (nrg.slice(0,4) || '');

      // nomeFile dall'href: "202524201_01.html"
      const fileM     = href.match(/nomeFile=([^&]+)/);
      const nomeFile  = fileM ? decodeURIComponent(fileM[1]) : '';

      if (!numero && !nrg) continue; // skip record vuoti

      results.push({
        numero,
        anno,
        sezione,
        sede,
        tipo,
        ecli,
        nrg:     nrgText || nrg,
        schema,
        idprovv,
        nomeFile,
        url:     href,
      });
    } catch(e) {
      // skip record malformato
    }
  }

  return results;
}

// ── Fetch testo completo (XML da mdp.*) ───────────────────────────────────────

async function fetchTesto(schema, nrg, nomeFile, cookies) {
  if (!schema || !nrg || !nomeFile) return null;
  try {
    const p = `/visualizza/?nodeRef=&schema=${encodeURIComponent(schema)}&nrg=${encodeURIComponent(nrg)}&nomeFile=${encodeURIComponent(nomeFile)}&subDir=Provvedimenti`;
    const resp = await fetchUrl({ host: MDP_HOST, path: p }, null, cookies);
    if (resp.status !== 200) return null;

    // Estrai testo dall'XML: strip tag XML/HTML, mantieni solo testo
    const xml = resp.body;
    const text = xml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 8000); // max 8KB per sentenza
    return text || null;
  } catch(e) {
    return null;
  }
}

// ── Estrai oggetto dal testo XML ──────────────────────────────────────────────
function extractOggettoXml(xml) {
  if (!xml) return null;
  const m = xml.match(/<oggetto[^>]*>([\s\S]*?)<\/oggetto>/i);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 500);
}

// ── DB setup ──────────────────────────────────────────────────────────────────
function initDB() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS giustizia_amministrativa (
      id                TEXT PRIMARY KEY,
      numero            TEXT,
      anno              INTEGER,
      sezione           TEXT,
      sede              TEXT,
      tipo              TEXT,
      ecli              TEXT,
      nrg               TEXT,
      oggetto           TEXT,
      testo             TEXT,
      data_pubblicazione TEXT,
      url_fonte         TEXT,
      schema_ga         TEXT,
      data_import       TEXT DEFAULT (date('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ga_anno    ON giustizia_amministrativa(anno);
    CREATE INDEX IF NOT EXISTS idx_ga_sede    ON giustizia_amministrativa(sede);
    CREATE INDEX IF NOT EXISTS idx_ga_tipo    ON giustizia_amministrativa(tipo);
    CREATE INDEX IF NOT EXISTS idx_ga_numero  ON giustizia_amministrativa(numero);
  `);
  return db;
}

function upsert(stmt, rec) {
  const id = `ga_${rec.schema_ga || 'x'}_${rec.nrg || rec.numero}_${rec.anno}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  stmt.run(
    id,
    rec.numero         || null,
    rec.anno ? parseInt(rec.anno, 10) : null,
    rec.sezione        || null,
    rec.sede           || null,
    rec.tipo           || null,
    rec.ecli           || null,
    rec.nrg            || null,
    rec.oggetto        || null,
    rec.testo          || null,
    rec.data_pubbl     || null,
    rec.url            || null,
    rec.schema_ga      || null,
  );
}

// ── Sessione Liferay ──────────────────────────────────────────────────────────

async function initSession() {
  log('Avvio sessione su giustizia-amministrativa.it...');
  const resp = await fetchUrl({ host: BASE_HOST, path: SEARCH_PATH }, null, {});
  if (resp.status !== 200) throw new Error(`Sessione fallita: HTTP ${resp.status}`);

  const cookies   = resp.cookies;
  const { portletId, pAuth } = extractPortletInfo(resp.body);

  if (!portletId) throw new Error('Portlet ID non trovato — struttura pagina cambiata?');
  if (!pAuth)     throw new Error('p_auth non trovato — CSRF token mancante?');

  log(`Sessione OK | portlet: ${portletId} | p_auth: ${pAuth}`);
  return { cookies, portletId, pAuth };
}

/**
 * Rinnova la sessione se scaduta (900s = 15 min).
 * Chiamata ogni ~10 minuti durante lo scraping.
 */
async function renewSession(old) {
  try {
    const fresh = await initSession();
    // Preserva cookie di sessione vecchi + nuovi
    return { ...fresh, cookies: { ...old.cookies, ...fresh.cookies } };
  } catch(e) {
    log(`⚠ Rinnovo sessione fallito: ${e.message} — uso sessione precedente`);
    return old;
  }
}

// ── Ricerca pagina ────────────────────────────────────────────────────────────

async function searchPage(session, { anno, sede, pagina }) {
  const { cookies, portletId, pAuth } = session;
  const P = portletId;

  const params = {
    [`_${P}_javax.portlet.action`]: 'search',
    [`_${P}_searchtextProvvedimenti`]: '',
    [`_${P}_isAdvancedSearch`]:       'false',
    [`_${P}_DataYearItem`]:           String(anno),
    [`_${P}_sedeProvvedimenti`]:      sede,
    [`_${P}_TipoProvvedimentoItem`]:  '',  // tutte le tipologie
    [`_${P}_pageSize`]:               String(PAGE_SIZE),
    [`_${P}_cur`]:                    String(pagina),
    [`_${P}_delta`]:                  String(PAGE_SIZE),
    [`_${P}_changePage`]:             pagina > 1 ? 'true' : 'false',
    [`_${P}_findBtn`]:                'true',
  };

  // Prima pagina: POST; pagine successive: GET con stessi parametri
  const qs = `p_p_id=${encodeURIComponent(P)}&p_p_lifecycle=1&p_p_state=normal&p_p_mode=view&p_auth=${pAuth}`;

  let resp;
  if (pagina === 1) {
    const body = encodeForm(params);
    resp = await fetchUrl(
      { host: BASE_HOST, path: `${SEARCH_PATH}?${qs}`, method: 'POST',
        headers: { 'Referer': `https://${BASE_HOST}${SEARCH_PATH}` } },
      body, cookies
    );
  } else {
    // Paginazione: GET con tutti i parametri nella query string
    const allParams = { ...params, p_auth: pAuth,
      p_p_id: P, p_p_lifecycle: '1', p_p_state: 'normal', p_p_mode: 'view' };
    const fullQs = encodeForm(allParams);
    resp = await fetchUrl(
      { host: BASE_HOST, path: `${SEARCH_PATH}?${fullQs}` },
      null, cookies
    );
  }

  if (resp.status === 403) throw new Error('403 Forbidden — sessione scaduta?');
  if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);

  const total   = extractTotal(resp.body);
  const items   = extractProvvedimenti(resp.body);
  const newCookies = { ...cookies, ...resp.cookies };

  return { total, items, cookies: newCookies };
}

// ── Scraper principale ────────────────────────────────────────────────────────

async function scrapaSede(session, db, stmt, { anno, sede }) {
  log(`\n▶ ${sede} — anno ${anno}`);

  let scaricati = 0;
  let pagina    = 1;
  let totale    = null;
  let sessionRenewAt = Date.now() + 8 * 60 * 1000; // rinnova ogni 8 min

  while (true) {
    // Rinnova sessione se necessario
    if (Date.now() > sessionRenewAt) {
      session = await renewSession(session);
      sessionRenewAt = Date.now() + 8 * 60 * 1000;
    }

    let result;
    try {
      result = await searchPage(session, { anno, sede, pagina });
      // Aggiorna cookies dalla risposta
      session = { ...session, cookies: result.cookies };
    } catch(e) {
      log(`  ⚠ Pagina ${pagina} fallita: ${e.message} — riprovo con sessione rinnovata`);
      await sleep(3000);
      session = await renewSession(session);
      try {
        result = await searchPage(session, { anno, sede, pagina });
        session = { ...session, cookies: result.cookies };
      } catch(e2) {
        log(`  ✗ Pagina ${pagina} fallita definitivamente: ${e2.message}`);
        break;
      }
    }

    if (totale === null) {
      totale = result.total;
      const pageTot = Math.ceil(totale / PAGE_SIZE);
      log(`  Trovati ${totale} risultati (${pageTot} pagine)`);
      if (totale === 0) break;
    }

    if (result.items.length === 0) break;

    for (const item of result.items) {
      // Fetch testo completo (opzionale, lento)
      let testo  = null;
      let oggetto = null;
      if (FETCH_TESTO && item.nomeFile && item.schema) {
        try {
          const xml = await fetchUrl(
            { host: MDP_HOST, path: `/visualizza/?nodeRef=&schema=${item.schema}&nrg=${encodeURIComponent(item.nrg)}&nomeFile=${encodeURIComponent(item.nomeFile)}&subDir=Provvedimenti` },
            null, session.cookies
          );
          if (xml.status === 200) {
            oggetto = extractOggettoXml(xml.body);
            testo   = xml.body.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 8000);
          }
          await sleep(500); // pausa extra per mdp.*
        } catch(e) { /* ignora */ }
      }

      upsert(stmt, {
        numero:     item.numero,
        anno:       item.anno || anno,
        sezione:    item.sezione,
        sede:       sede,
        tipo:       item.tipo,
        ecli:       item.ecli,
        nrg:        item.nrg,
        oggetto,
        testo,
        url:        item.url,
        schema_ga:  item.schema,
      });
      scaricati++;
    }

    if (scaricati % 100 === 0 && scaricati > 0) {
      log(`  ↳ ${scaricati}/${totale} scaricati...`);
    }

    // Fine paginazione
    const pagineTot = Math.ceil(totale / PAGE_SIZE);
    if (pagina >= pagineTot) break;

    // In modalità test: max 2 pagine
    if (IS_TEST && pagina >= 2) {
      log(`  ↷ Modalità test: stop dopo 2 pagine`);
      break;
    }

    pagina++;
    await sleep(DELAY_MS);
  }

  log(`  ✓ ${sede} ${anno}: ${scaricati} provvedimenti scaricati`);
  return scaricati;
}

// ── Entry point ───────────────────────────────────────────────────────────────
(async () => {
  console.log('═══ SCRAPER GIUSTIZIA AMMINISTRATIVA ═══');
  console.log(`Modalità: ${IS_TEST ? 'TEST (2 pagine CdS 2025)' : 'COMPLETA'}`);
  console.log(`Anni: ${ANNI.join(', ')}`);
  console.log(`Fetch testo: ${FETCH_TESTO ? 'SÌ (lento)' : 'NO (solo metadati)'}\n`);

  const db   = initDB();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO giustizia_amministrativa
      (id, numero, anno, sezione, sede, tipo, ecli, nrg, oggetto, testo,
       data_pubblicazione, url_fonte, schema_ga)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let session;
  try {
    session = await initSession();
  } catch(e) {
    console.error('✗ Impossibile avviare sessione:', e.message);
    db.close();
    process.exit(1);
  }

  const sedi   = IS_TEST ? SEDI_TEST : SEDI;
  const report = [];
  let totaleAssoluto = 0;

  for (const anno of ANNI) {
    for (const sede of sedi) {
      try {
        const n = await scrapaSede(session, db, stmt, { anno, sede });
        report.push({ anno, sede, n });
        totaleAssoluto += n;
        await sleep(DELAY_MS);
      } catch(e) {
        log(`✗ ERRORE ${sede} ${anno}: ${e.message}`);
        report.push({ anno, sede, n: 0, errore: e.message });
        // Prova a rinnovare la sessione dopo errore
        try { session = await renewSession(session); } catch(_) {}
      }
    }
  }

  db.close();

  console.log('\n═══ RIEPILOGO ═══');
  for (const r of report) {
    const stato = r.errore ? `✗ ${r.errore}` : `✓ ${r.n}`;
    console.log(`  ${String(r.anno)} ${r.sede.padEnd(25)} ${stato}`);
  }
  console.log(`\nTOTALE scaricati: ${totaleAssoluto}`);

  // Statistiche DB finali
  const db2  = new Database(DB_PATH, { readonly: true });
  db2.pragma('journal_mode = WAL');
  const rows = db2.prepare('SELECT sede, COUNT(*) as c FROM giustizia_amministrativa GROUP BY sede ORDER BY c DESC').all();
  console.log('\n═══ STATO DB ═══');
  for (const r of rows) console.log(`  ${r.sede.padEnd(30)} ${r.c}`);
  const tot = db2.prepare('SELECT COUNT(*) as n FROM giustizia_amministrativa').get().n;
  console.log(`\nTotale in DB: ${tot}`);
  db2.close();
})();
