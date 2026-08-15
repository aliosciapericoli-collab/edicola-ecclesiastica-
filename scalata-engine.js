/**
 * scalata-engine.js — Motore completo della Scalata della Conoscenza
 * Edicola Ecclesiastica · Node.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

// ============================================================
// CONFIGURAZIONE
// ============================================================

const { getModel } = require('./utils/model-selector');

const CONFIG = {
  apiKey: process.env.ANTHROPIC_API_KEY,
  apiUrl: 'https://api.anthropic.com/v1/messages',
  apiVersion: '2023-06-01',

  models: {
    l1l2:       getModel('l1', { log: false }),   // Haiku
    l3:         getModel('l3', { log: false }),   // Sonnet
    l5:         getModel('l5', { log: false }),   // Sonnet
    l0_fallback:getModel('l0', { log: false }),   // Haiku
  },

  maxTokens: {
    l1l2_single: 400,
    l1l2_batch:  2000,
    l3:          1000,
    l5:          1200,
    l0_fallback: 200
  },

  temperature: { l1l2: 0.1, l3: 0.2, l5: 0.3 },
  batchSize: 5,

  dbPath: process.env.DB_PATH || path.join(__dirname, 'data/edicola.db'),
  sourceProfilesPath: path.join(__dirname, 'source_profiles.json')
};

// ============================================================
// SYSTEM PROMPTS
// ============================================================

const PROMPTS = {
  l1l2_system: `Sei un redattore di agenzia stampa. Output SOLO JSON valido, niente altro testo prima o dopo.
Regole ferree:
1. LINGUA: output sempre in italiano, anche se l'articolo e' in inglese/francese/spagnolo. Traduci i contenuti, non i nomi propri.
2. ANTI-ALLUCINAZIONE: usa SOLO informazioni presenti nel titolo e testo forniti. Se una data, un numero o un nome non compare nel testo, NON inserirlo. Il campo timeline accetta array vuoto [] se non ci sono date certe nel testo.
3. BREVITA': ogni campo max 1 frase (max 20 parole). Il lettore e' su mobile.
4. TONO: fattuale, mai opinioni. Mai aggettivi valutativi (storico, incredibile, devastante). Se il dato e' incerto scrivi "secondo [fonte]".`,

  l1l2_user: (title, source, language, date, snippet) =>
    `Articolo:\nTitolo: ${title}\nFonte: ${source}\nLingua: ${language || 'it'}\nData: ${date || 'non specificata'}\nTesto: ${(snippet || '').slice(0, 600)}\n\nJSON esatto:\n{"l1_fatto":{"cosa":"...","chi":"...","perche_importa":"..."},"l2_contesto":{"background":"max 2 frasi","timeline":[],"dati_chiave":[],"confidence":"alta|media|bassa"},"keywords":["k1","k2","k3"]}\n\nRegola confidence: alta = tutti i fatti sono nel testo. media = alcuni fatti sono inferiti. bassa = testo vago o dati non verificabili.`,

  l1l2_batch_system: `Sei un redattore di agenzia stampa. Output SOLO un array JSON valido, niente altro testo.
Regole per TUTTI gli articoli:
1. Output SEMPRE in italiano, qualunque sia la lingua dell'articolo.
2. Mai inventare date, numeri, nomi non presenti nel testo.
3. Se il testo e' troppo vago, usa stringa vuota "".
4. Ogni campo max 1 frase (20 parole). Lettore su mobile.
5. Keywords in italiano, minuscole, max 5.
6. Campo confidence obbligatorio in l2.`,

  l1l2_batch_user: (articles) => {
    const items = articles.map((a, i) =>
      `[${i + 1}] Titolo: ${a.title}\nFonte: ${a.source_name}\nLingua: ${a.language || 'it'}\nTesto: ${(a.snippet || '').slice(0, 400)}`
    ).join('\n\n');
    return `Genera l1+l2 per questi articoli:\n\n${items}\n\nOutput: [{"article_index":1,"l1_fatto":{"cosa":"...","chi":"...","perche_importa":"..."},"l2_contesto":{"background":"...","timeline":[],"dati_chiave":[],"confidence":"alta|media|bassa"},"keywords":["..."]}, ...]`;
  },

  l3_system: `Sei un analista. Output SOLO JSON valido, niente altro testo.
Regole:
1. Basa l'analisi SOLO sul fatto e contesto forniti. Non aggiungere attori, date o eventi non menzionati.
2. Se non puoi identificare posizioni contrapposte credibili, restituisci array vuoto per posizioni.
3. Ogni campo max 2 frasi. Ogni posizione max 1 frase. non_detto esattamente 1 frase.
4. Output in italiano. Attribuisci sempre: "secondo [attore/fonte]".
5. Il campo non_detto identifica un FATTO o ANGOLO assente, non un'opinione.`,

  l3_user: (l1Text, l2Background, l2Confidence, relatedTitles) =>
    `Fatto (L1): ${l1Text}\nContesto (L2): ${l2Background}\nConfidence L2: ${l2Confidence || 'bassa'}\n${relatedTitles ? '\nTitoli correlati:\n' + relatedTitles : ''}\n\nJSON:\n{"l3_analisi":{"cause":"...","posizioni":[{"attore":"...","posizione":"..."}],"non_detto":"...","confidence":"alta|media|bassa"}}`,

  l5_system: `Sei un analista strategico. Output SOLO JSON valido, niente altro testo.
Regole:
1. Gli scenari devono essere LOGICAMENTE derivabili dai fatti forniti, non da conoscenza esterna.
2. Ogni campo "allora" max 1 frase. "chi_vince_chi_perde" max 2 frasi.
3. La domanda_aperta deve terminare con ? e deve essere una VERA domanda per ricerca autonoma — non retorica.
4. Output in italiano. Usa "potrebbe", "se confermato", "nel caso in cui".
5. Se i dati sono insufficienti, riduci a 1 solo scenario con probabilita' "bassa".`,

  l5_user: (l1Text, l2Background, l3Cause, l3Posizioni, relatedTitles) =>
    `CONTESTO COMPLETO:\nFatto: ${l1Text}\nContesto: ${l2Background}\nAnalisi: ${l3Cause || 'Non disponibile'}\nPosizioni: ${l3Posizioni || '[]'}\n${relatedTitles ? 'Titoli correlati:\n' + relatedTitles : ''}\n\nJSON:\n{"l5_implicazioni":{"scenari":[{"se":"...","allora":"...","probabilita":"alta|media|bassa"}],"chi_vince_chi_perde":"...","domanda_aperta":"...?","confidence":"alta|media|bassa"}}`,

  l0_system: `Sei un media analyst. Output SOLO JSON valido. Classifica la testata giornalistica indicata. Se non la conosci con certezza, rispondi con confidence "bassa" e bias null. MAI inventare dati di proprieta'.`,

  l0_user: (sourceName, sourceUrl) =>
    `Classifica questa testata:\nNome: ${sourceName}\nURL: ${sourceUrl || 'non disponibile'}\n\nJSON: {"type":"quotidiano|agenzia|tv|testata_digitale|blog|trade_press|istituzionale|sconosciuto","country":"XX","ownership":"...","bias":null,"reliability":null,"note":"max 1 frase","confidence":"alta|media|bassa"}`
};

// ============================================================
// CHIAMATA API CLAUDE — usa https nativo (no fetch)
// ============================================================

function callClaude(model, systemPrompt, userMessage, maxTokens, temperature) {
  const { HAIKU } = require('./utils/model-selector');
  const modelLabel = model === HAIKU ? 'Haiku' : 'Sonnet';
  // Deriva livello dal contesto (usa il modello come proxy)
  const livelloLabel = model === HAIKU ? 'L1/L2' : 'L3/L5';
  console.log(`[Model] Usando ${modelLabel} per ${livelloLabel}`);

  return new Promise((resolve, reject) => {
    if (!CONFIG.apiKey) {
      return reject(new Error('ANTHROPIC_API_KEY non configurata'));
    }

    const payload = JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.apiKey,
        'anthropic-version': CONFIG.apiVersion,
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (resp) => {
      let body = '';
      resp.on('data', c => body += c);
      resp.on('end', () => {
        try {
          if (resp.statusCode === 401) return reject(new Error('API key invalida o scaduta'));
          if (resp.statusCode === 429) return reject(new Error('Rate limit raggiunto'));
          if (resp.statusCode === 529) return reject(new Error('API sovraccarica'));
          if (resp.statusCode !== 200) return reject(new Error(`Claude API errore ${resp.statusCode}: ${body.slice(0, 200)}`));
          const data = JSON.parse(body);
          const rawText = data.content?.[0]?.text || '';
          if (data.usage) {
            console.log(`[Claude] ${model} | in:${data.usage.input_tokens} out:${data.usage.output_tokens}`);
          }
          resolve(rawText);
        } catch (e) {
          reject(new Error('Risposta Claude non parsabile: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end(payload);
  });
}

// ============================================================
// PARSER JSON ROBUSTO
// ============================================================

function safeParseJSON(text) {
  if (!text || typeof text !== 'string') return null;

  // Rimuovi markdown code fences
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  if (firstBrace === -1 && firstBracket === -1) return null;

  const startIdx = (firstBrace >= 0 && firstBracket >= 0)
    ? Math.min(firstBrace, firstBracket)
    : Math.max(firstBrace, firstBracket);

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

  if (endIdx === -1) { console.error('[safeParseJSON] JSON troncato, depth:', depth); return null; }

  const jsonStr = cleaned.slice(startIdx, endIdx + 1);
  try {
    return JSON.parse(jsonStr);
  } catch {
    try {
      return JSON.parse(jsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'));
    } catch (e2) {
      console.error('[safeParseJSON] Parse fallito:', e2.message, jsonStr.slice(0, 100));
      return null;
    }
  }
}

// ============================================================
// FUNZIONI PER LIVELLO
// ============================================================

async function generateL1L2(article) {
  const raw = await callClaude(
    CONFIG.models.l1l2,
    PROMPTS.l1l2_system,
    PROMPTS.l1l2_user(
      article.title, article.source_name, article.language,
      article.published_at, article.snippet || article.description
    ),
    CONFIG.maxTokens.l1l2_single,
    CONFIG.temperature.l1l2
  );
  const parsed = safeParseJSON(raw);
  if (!parsed) { console.error('[L1L2] Parse fallito per:', article.title?.slice(0, 50)); return null; }
  return parsed;
}

async function generateL1L2Batch(articles) {
  const batch = articles.slice(0, CONFIG.batchSize);
  const raw = await callClaude(
    CONFIG.models.l1l2,
    PROMPTS.l1l2_batch_system,
    PROMPTS.l1l2_batch_user(batch),
    CONFIG.maxTokens.l1l2_batch,
    CONFIG.temperature.l1l2
  );
  const parsed = safeParseJSON(raw);
  if (!Array.isArray(parsed)) {
    console.error('[L1L2 batch] Parse fallito, tentativo singolo...');
    const results = [];
    for (let idx = 0; idx < batch.length; idx++) {
      try {
        const single = await generateL1L2(batch[idx]);
        if (single) results.push({ article_index: idx + 1, ...single });
      } catch (err) {
        console.error('[L1L2 single fallback]', batch[idx].title?.slice(0, 40), err.message);
      }
    }
    return results;
  }
  return parsed;
}

async function generateL3(article, l1Fatto, l2Contesto, relatedTitles) {
  const l1Text = l1Fatto
    ? [l1Fatto.cosa, l1Fatto.chi, l1Fatto.perche_importa].filter(Boolean).join(' ')
    : article.title;

  const raw = await callClaude(
    CONFIG.models.l3,
    PROMPTS.l3_system,
    PROMPTS.l3_user(
      l1Text,
      l2Contesto?.background || '',
      l2Contesto?.confidence || 'bassa',
      Array.isArray(relatedTitles) ? relatedTitles.slice(0, 3).join('\n') : ''
    ),
    CONFIG.maxTokens.l3,
    CONFIG.temperature.l3
  );
  const parsed = safeParseJSON(raw);
  if (!parsed) { console.error('[L3] Parse fallito per:', article.title?.slice(0, 50)); return null; }
  return parsed.l3_analisi || parsed;
}

async function generateL5(article, l1Fatto, l2Contesto, l3Analisi, relatedTitles) {
  const l1Text = l1Fatto
    ? [l1Fatto.cosa, l1Fatto.chi, l1Fatto.perche_importa].filter(Boolean).join(' ')
    : article.title;

  const raw = await callClaude(
    CONFIG.models.l5,
    PROMPTS.l5_system,
    PROMPTS.l5_user(
      l1Text,
      l2Contesto?.background || '',
      l3Analisi?.cause || '',
      l3Analisi?.posizioni ? JSON.stringify(l3Analisi.posizioni) : '[]',
      Array.isArray(relatedTitles) ? relatedTitles.slice(0, 5).join('\n') : ''
    ),
    CONFIG.maxTokens.l5,
    CONFIG.temperature.l5
  );
  const parsed = safeParseJSON(raw);
  if (!parsed) { console.error('[L5] Parse fallito per:', article.title?.slice(0, 50)); return null; }
  return parsed.l5_implicazioni || parsed;
}

async function generateL0Fallback(sourceName, sourceUrl) {
  const raw = await callClaude(
    CONFIG.models.l0_fallback,
    PROMPTS.l0_system,
    PROMPTS.l0_user(sourceName, sourceUrl),
    CONFIG.maxTokens.l0_fallback,
    0.0
  );
  const parsed = safeParseJSON(raw);
  if (!parsed) return null;
  parsed._auto = true;
  parsed._generated_at = new Date().toISOString();
  return parsed;
}

// ============================================================
// L0 — PROFILI FONTE
// ============================================================

let _sourceProfiles = null;

function getSourceProfiles() {
  if (_sourceProfiles) return _sourceProfiles;
  try {
    _sourceProfiles = JSON.parse(fs.readFileSync(CONFIG.sourceProfilesPath, 'utf8'));
    console.log(`[L0] Caricati ${Object.keys(_sourceProfiles.sources || _sourceProfiles).length} profili fonte`);
    return _sourceProfiles;
  } catch (err) {
    console.error('[L0] source_profiles.json non trovato:', err.message);
    _sourceProfiles = { sources: {} };
    return _sourceProfiles;
  }
}

async function getSourceProfile(sourceName, sourceUrl) {
  const profileData = getSourceProfiles();
  const profiles = profileData.sources || profileData;

  if (profiles[sourceName]) return { ...profiles[sourceName], _matched: true };

  for (const [key, profile] of Object.entries(profiles)) {
    if (key === '_default') continue;
    if (sourceName.toLowerCase().includes(key.toLowerCase()) ||
        key.toLowerCase().includes(sourceName.toLowerCase())) {
      return { ...profile, _matched: true, _matched_key: key };
    }
  }

  // Cache per fonti auto-generate
  const cacheFile = path.join(path.dirname(CONFIG.sourceProfilesPath), 'source_profiles_auto_cache.json');
  let autoCache = {};
  try { if (fs.existsSync(cacheFile)) autoCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}

  const cacheKey = sourceName.toLowerCase().trim();
  if (autoCache[cacheKey]) return { ...autoCache[cacheKey], _auto: true, _cached: true };

  console.log(`[L0] Fonte non profilata: "${sourceName}" — genero con AI`);
  const aiProfile = await generateL0Fallback(sourceName, sourceUrl);
  if (aiProfile) {
    autoCache[cacheKey] = { ...aiProfile, full_name: sourceName };
    try { fs.writeFileSync(cacheFile, JSON.stringify(autoCache, null, 2)); } catch {}
    return { ...aiProfile, full_name: sourceName, _auto: true };
  }

  return { ...(profiles._default || {}), full_name: sourceName, _auto: true, confidence: 'bassa' };
}

// ============================================================
// API EXPRESS
// ============================================================

function setupScalataAPI(app) {
  const express = require('express');

  if (!CONFIG.apiKey) {
    console.error('[Scalata] ⚠ ANTHROPIC_API_KEY non configurata!');
  } else {
    console.log(`[Scalata] API key OK (${CONFIG.apiKey.slice(0, 12)}...)`);
    console.log(`[Scalata] Modelli: L1-L3=${CONFIG.models.l1l2} | L5=${CONFIG.models.l5}`);
  }

  app.post('/api/scalata/l1l2', express.json(), async (req, res) => {
    try {
      const result = await generateL1L2(req.body);
      if (!result) return res.status(502).json({ error: 'Generazione fallita' });
      res.json(result);
    } catch (err) { console.error('[API L1L2]', err.message); res.status(500).json({ error: err.message }); }
  });

  app.post('/api/scalata/l3', express.json(), async (req, res) => {
    try {
      const { title, source_name, l1_fatto, l2_contesto, related_titles } = req.body;
      const result = await generateL3({ title, source_name }, l1_fatto, l2_contesto, related_titles);
      if (!result) return res.status(502).json({ error: 'Generazione fallita' });
      res.json({ l3_analisi: result });
    } catch (err) { console.error('[API L3]', err.message); res.status(500).json({ error: err.message }); }
  });

  app.post('/api/scalata/l5', express.json(), async (req, res) => {
    try {
      const { title, source_name, l1_fatto, l2_contesto, l3_analisi, related_titles } = req.body;
      const result = await generateL5({ title, source_name }, l1_fatto, l2_contesto, l3_analisi, related_titles);
      if (!result) return res.status(502).json({ error: 'Generazione fallita' });
      res.json({ l5_implicazioni: result });
    } catch (err) { console.error('[API L5]', err.message); res.status(500).json({ error: err.message }); }
  });

  app.get('/api/scalata/l0/:source_name', async (req, res) => {
    try {
      const profile = await getSourceProfile(decodeURIComponent(req.params.source_name), req.query.url || null);
      res.json(profile);
    } catch (err) { console.error('[API L0]', err.message); res.status(500).json({ error: err.message }); }
  });

  app.get('/api/scalata/status', (req, res) => {
    res.json({
      api_key_configured: !!CONFIG.apiKey,
      models: CONFIG.models,
      source_profiles_loaded: Object.keys((getSourceProfiles().sources || getSourceProfiles())).length,
      estimated_cost_per_article: { l1l2: '$0.0008', l3: '$0.0012', l5: '$0.008' }
    });
  });

  console.log('[Scalata] Endpoints attivi: /api/scalata/{l1l2,l3,l5,l0/:name,status}');
}

// ============================================================
// BATCH PROCESSING
// ============================================================

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function runBatch() {
  console.log('[Batch] Inizio generazione L1+L2...');
  let Database;
  try { Database = require('better-sqlite3'); }
  catch { console.error('[Batch] better-sqlite3 non installato: npm install better-sqlite3'); process.exit(1); }

  const db = new Database(CONFIG.dbPath);

  const pending = db.prepare(`
    SELECT url, title, source_name, snippet, published_at, language, category
    FROM articles
    WHERE status != 'duplicate'
    AND (scalata_json IS NULL OR scalata_json = '')
    ORDER BY published_at DESC
    LIMIT 500
  `).all();

  console.log(`[Batch] ${pending.length} articoli da processare`);
  if (pending.length === 0) { db.close(); return; }

  const updateStmt = db.prepare('UPDATE articles SET scalata_json = ?, keywords_json = ? WHERE url = ?');
  const updateL3Stmt = db.prepare('UPDATE articles SET scalata_json = ? WHERE url = ?');

  let processed = 0, errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < pending.length; i += CONFIG.batchSize) {
    const batch = pending.slice(i, i + CONFIG.batchSize);
    try {
      const results = await generateL1L2Batch(batch);
      if (Array.isArray(results)) {
        for (const result of results) {
          const idx = (result.article_index - 1);
          const article = batch[idx];
          if (!article) continue;
          const scalataData = { scalata: { l1_fatto: result.l1_fatto, l2_contesto: result.l2_contesto } };
          updateStmt.run(JSON.stringify(scalataData), JSON.stringify(result.keywords || []), article.url);
          processed++;
        }
      }
    } catch (err) {
      console.error(`[Batch] Errore batch ${i}-${i + CONFIG.batchSize}:`, err.message);
      errors++;
      if (err.message.includes('Rate limit') || err.message.includes('429')) {
        console.log('[Batch] Rate limit — pausa 30s...');
        await sleep(30000);
      }
    }
    await sleep(200);
    if ((i + CONFIG.batchSize) % 50 === 0 || i + CONFIG.batchSize >= pending.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Batch] ${processed}/${pending.length} processati | ${errors} errori | ${elapsed}s`);
    }
  }

  // Pre-genera L3 per articoli hot (coverage >= 3)
  console.log('\n[Batch] Pre-generazione L3 per articoli hot...');
  const hotArticles = db.prepare(`
    SELECT url, title, source_name, scalata_json
    FROM articles
    WHERE coverage_count >= 3
    AND scalata_json IS NOT NULL
    AND scalata_json NOT LIKE '%l3_analisi%'
    ORDER BY published_at DESC
    LIMIT 50
  `).all();

  console.log(`[Batch] ${hotArticles.length} articoli hot`);
  for (const article of hotArticles) {
    try {
      const scalata = JSON.parse(article.scalata_json);
      const l1 = scalata?.scalata?.l1_fatto;
      const l2 = scalata?.scalata?.l2_contesto;
      if (!l1) continue;
      const l3 = await generateL3(article, l1, l2, []);
      if (l3) {
        scalata.scalata.l3_analisi = l3;
        updateL3Stmt.run(JSON.stringify(scalata), article.url);
        processed++;
      }
      await sleep(300);
    } catch (err) {
      console.error('[Batch L3]', err.message);
      errors++;
      if (err.message.includes('Rate limit')) { await sleep(30000); }
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[Batch] Completato: ${processed} processati, ${errors} errori, ${totalTime}s`);
  db.close();
}


// ═══════════════════════════════════════════════════════════════════
// BATCH FUNCTIONS — spec Modulo 4
// ═══════════════════════════════════════════════════════════════════

// Pre-genera L1+L2 per notizie dalla cache in-memory
async function runBatchL1L2(cacheArticles, limit) {
  const MAX_PER_RUN = limit || 20; // conservativo: 20 haiku = ~$0.01
  // Filtra: notizie senza scalata già generata (controlla synthesisCache)
  const nuove = (cacheArticles || [])
    .filter(a => a && a.title && !runBatchL1L2._done.has(a.id))
    .slice(0, MAX_PER_RUN);

  if (!nuove.length) {
    console.log('▲ Batch L1+L2: nessuna notizia nuova');
    return { processati: 0, successi: 0, errori: 0 };
  }
  console.log(`▲ Batch L1+L2: ${nuove.length} notizie...`);
  let successi = 0, errori = 0;

  for (let i = 0; i < nuove.length; i++) {
    const art = nuove[i];
    try {
      const result = await generateL1L2({
        title: art.title,
        snippet: art.desc || art.snippet || '',
        source_name: art.source || art.source_name || '',
        published_at: art.date || art.published_at || ''
      });
      if (result) {
        // Salva in synthesisCache (già usata dall'on-demand)
        const key = Buffer.from((art.title + 'l1l2').substring(0,70)).toString('base64url');
        if (global._synthesisCache) global._synthesisCache.set(key, { ok:true, level:'l1l2', result });
        runBatchL1L2._done.add(art.id);
        successi++;
      } else { errori++; }
    } catch(e) {
      console.error(` ❌ Batch L1+L2 errore: ${e.message}`);
      errori++;
      if (e.message.includes('429') || e.message.includes('Rate')) await sleep(30000);
    }
    if (i < nuove.length - 1) await sleep(500);
  }
  console.log(`▲ Batch L1+L2 completato: ${successi}/${nuove.length} successi`);
  return { processati: nuove.length, successi, errori };
}
runBatchL1L2._done = new Set();

// Pre-genera L3 per notizie "hot" (citate da più fonti o con norme linkate)
async function runBatchL3Hot(cacheArticles, db, limit) {
  const MAX_L3 = limit || 10;
  // Hot = notizie con ≥2 occorrenze dello stesso evento (coverage) o con norme linkate
  // Per semplicità: prendi le notizie con titoli simili raggruppati
  const hot = (cacheArticles || [])
    .filter(a => a && a.title && runBatchL1L2._done.has(a.id) && !runBatchL3Hot._done.has(a.id))
    .slice(0, MAX_L3);

  if (!hot.length) return { processati: 0 };
  console.log(`▲ Batch L3 hot: ${hot.length} notizie...`);
  let successi = 0;
  for (const art of hot) {
    try {
      const l1Key = Buffer.from((art.title + 'l1l2').substring(0,70)).toString('base64url');
      const cached = global._synthesisCache?.get(l1Key);
      const l1 = cached?.result?.l1_fatto || null;
      if (!l1) continue;
      const result = await generateL3({ title: art.title, snippet: art.desc||'' }, l1, null, []);
      if (result) {
        runBatchL3Hot._done.add(art.id);
        successi++;
      }
      await sleep(600);
    } catch(e) {
      if (e.message.includes('429')) await sleep(30000);
    }
  }
  console.log(`▲ L3 hot: ${successi}/${hot.length}`);
  return { processati: hot.length, successi };
}
runBatchL3Hot._done = new Set();

// ============================================================
// ENTRY POINT
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--batch')) {
    runBatch().catch(err => { console.error('[Batch] Errore fatale:', err); process.exit(1); });
  } else if (args.includes('--test')) {
    (async () => {
      console.log('=== Test Scalata Engine ===\n');
      console.log('API Key:', CONFIG.apiKey ? `OK (${CONFIG.apiKey.slice(0, 12)}...)` : 'MANCANTE');
      console.log('Modello L1-L3:', CONFIG.models.l1l2);
      console.log('Modello L5:', CONFIG.models.l5);
      const profiles = getSourceProfiles();
      console.log('Source profiles:', Object.keys(profiles.sources || profiles).length, 'fonti');
      console.log('DB path:', CONFIG.dbPath, fs.existsSync(CONFIG.dbPath) ? 'OK' : 'NON TROVATO');
      if (CONFIG.apiKey) {
        console.log('\nTest chiamata Haiku...');
        try {
          const test = await callClaude(CONFIG.models.l1l2, 'Rispondi SOLO con JSON valido.', 'Genera: {"test":"ok"}', 50, 0);
          console.log('Risposta:', test);
        } catch (err) { console.log('Errore:', err.message); }
      }
    })();
  } else if (args.includes('--status')) {
    const profiles = getSourceProfiles();
    console.log(JSON.stringify({
      api_key: !!CONFIG.apiKey,
      models: CONFIG.models,
      source_profiles: Object.keys(profiles.sources || profiles).length,
      db_exists: fs.existsSync(CONFIG.dbPath)
    }, null, 2));
  } else {
    console.log('Uso: node scalata-engine.js --test | --batch | --status');
  }
}

// ============================================================
// EXPORT
// ============================================================

module.exports = { setupScalataAPI, generateL1L2, generateL1L2Batch, generateL3, generateL5, getSourceProfile, safeParseJSON, runBatch, runBatchL1L2, runBatchL3Hot, CONFIG };
