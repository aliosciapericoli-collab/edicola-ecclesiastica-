/**
 * services/perplexity-verify.js — Verifica e arricchimento fonti via Perplexity Sonar
 */
'use strict';

const https = require('https');

const API_URL = 'https://api.perplexity.ai/chat/completions';
const MODEL = 'sonar';
const API_KEY = process.env.PERPLEXITY_API_KEY || '';

const MAX_RETRIES = 3;
const RATE_LIMIT_MS = 2000;
let lastCallTs = 0;

function log(...args) { console.log('[PERPLEXITY]', ...args); }
function logErr(...args) { console.error('[PERPLEXITY]', ...args); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function rateWait() {
  const now = Date.now();
  const elapsed = now - lastCallTs;
  if (elapsed < RATE_LIMIT_MS) await sleep(RATE_LIMIT_MS - elapsed);
  lastCallTs = Date.now();
}

function callPerplexity(systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.1,
      max_tokens: 1500
    });

    const opts = {
      hostname: 'api.perplexity.ai',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 30000
    };

    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 300)}`));
        }
        try {
          const json = JSON.parse(body);
          const content = json.choices?.[0]?.message?.content || '';
          resolve(content);
        } catch (e) {
          reject(new Error(`Parse error: ${body.substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

async function callWithRetry(systemPrompt, userMessage) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await rateWait();
      const raw = await callPerplexity(systemPrompt, userMessage);
      // Estrai JSON dalla risposta (potrebbe avere markdown ```json ... ```)
      let cleaned = raw.trim();
      const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) cleaned = jsonMatch[1].trim();
      // Prova a trovare il primo { ... } nella risposta
      const braceStart = cleaned.indexOf('{');
      const braceEnd = cleaned.lastIndexOf('}');
      if (braceStart >= 0 && braceEnd > braceStart) {
        cleaned = cleaned.substring(braceStart, braceEnd + 1);
      }
      return JSON.parse(cleaned);
    } catch (e) {
      lastErr = e;
      logErr(`Tentativo ${attempt}/${MAX_RETRIES} fallito: ${e.message}`);
      if (attempt < MAX_RETRIES) {
        const backoff = Math.pow(2, attempt) * 1000;
        log(`Retry tra ${backoff / 1000}s...`);
        await sleep(backoff);
      }
    }
  }
  throw lastErr;
}

/**
 * Verifica fonti di una news giuridica via Perplexity Sonar
 */
async function verificaFonti(newsTitle, newsSummary) {
  if (!API_KEY) throw new Error('PERPLEXITY_API_KEY non configurata');

  const systemPrompt = 'Sei un verificatore di notizie giuridiche italiane. Data una notizia, trova fonti ufficiali (Gazzetta Ufficiale, normattiva.it, sentenze, comunicati ministeriali) che confermano o smentiscono il contenuto. Rispondi SOLO in JSON con: {"verificato": true/false, "confidenza": 0-100, "fonti": [{"url": "...", "titolo": "...", "tipo": "..."}], "nota": "string"}';

  const userMessage = `Titolo: ${newsTitle}\n\nSommario: ${newsSummary || '(non disponibile)'}`;

  log(`verificaFonti: "${newsTitle.substring(0, 60)}..."`);
  const result = await callWithRetry(systemPrompt, userMessage);
  log(`Risultato: verificato=${result.verificato}, confidenza=${result.confidenza}, fonti=${(result.fonti || []).length}`);
  return result;
}

/**
 * Arricchisci norme estratte dalla Scalata con riferimenti aggiornati
 */
async function arricchisciNorme(newsTitle, normeEstratte) {
  if (!API_KEY) throw new Error('PERPLEXITY_API_KEY non configurata');
  if (!normeEstratte || !normeEstratte.length) return { norme: [] };

  const normeStr = normeEstratte.map(n => typeof n === 'string' ? n : n.norma || JSON.stringify(n)).join(', ');

  const systemPrompt = 'Date queste norme italiane citate in una notizia giuridica, trova per ciascuna: il testo aggiornato su normattiva.it, eventuali modifiche recenti, sentenze correlate della Cassazione. Rispondi SOLO in JSON: {"norme": [{"norma": "...", "url_normattiva": "...", "ultima_modifica": "...", "sentenze_correlate": [{"numero": "...", "data": "...", "massima_breve": "..."}]}]}';

  const userMessage = `Titolo notizia: ${newsTitle}\n\nNorme citate: ${normeStr}`;

  log(`arricchisciNorme: ${normeEstratte.length} norme per "${newsTitle.substring(0, 50)}..."`);
  const result = await callWithRetry(systemPrompt, userMessage);
  log(`Risultato: ${(result.norme || []).length} norme arricchite`);
  return result;
}

module.exports = { verificaFonti, arricchisciNorme };
