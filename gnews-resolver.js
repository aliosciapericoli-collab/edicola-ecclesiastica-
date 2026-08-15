// gnews-resolver.js — Risolvi URL Google News e fetcha full-text con Puppeteer
'use strict';

let puppeteer;
let browser = null;

try {
  puppeteer = require('puppeteer');
} catch(e) {
  try { puppeteer = require('puppeteer-core'); } catch(e2) {}
}

const TIMEOUT = 20000;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  if (!puppeteer) throw new Error('Puppeteer non installato');
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-features=site-per-process'],
    executablePath: '/usr/bin/google-chrome-stable',
  });
  return browser;
}

/**
 * Gestisce la pagina di consenso Google (consent.google.com) cliccando
 * il bottone "Rifiuta tutto" / "Reject all" / "Alle ablehnen" in base
 * alla locale renderizzata. Selector robusti: prova form[action*="save"]
 * e form[action*="consent"], input[type=submit] e <button> per testo.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<boolean>} true se è stato gestito un consent
 */
async function handleGoogleConsent(page) {
  if (!page.url().includes('consent.google.com')) return false;
  const REJECT_LABELS = ['Reject all', 'Rifiuta tutto', 'Alle ablehnen'];
  const submitted = await page.evaluate((labels) => {
    const norm = s => (s || '').trim().toLowerCase();
    const wanted = labels.map(norm);
    const forms = Array.from(document.querySelectorAll('form[action*="save"], form[action*="consent"]'));
    for (const form of forms) {
      const inputs = Array.from(form.querySelectorAll('input[type=submit]'));
      const inp = inputs.find(s => wanted.includes(norm(s.value)));
      if (inp) { form.submit(); return true; }
      const buttons = Array.from(form.querySelectorAll('button'));
      const btn = buttons.find(b => wanted.includes(norm(b.textContent)));
      if (btn) { btn.click(); return true; }
    }
    const allButtons = Array.from(document.querySelectorAll('button'));
    const btn = allButtons.find(b => wanted.includes(norm(b.textContent)));
    if (btn) { btn.click(); return true; }
    return false;
  }, REJECT_LABELS);
  if (submitted) {
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 4000));
    return true;
  }
  return false;
}

/**
 * Risolvi URL Google News → URL reale della testata.
 * Usa Puppeteer per seguire i redirect JavaScript.
 * @param {string} gnUrl - URL Google News (news.google.com/rss/articles/...)
 * @returns {Promise<string|null>} URL risolto o null
 */
async function resolveGoogleNewsUrl(gnUrl) {
  let page;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    // Blocca risorse pesanti
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['image','stylesheet','font','media'].includes(type)) req.abort();
      else req.continue();
    });
    // Naviga e aspetta il redirect
    const response = await page.goto(gnUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await handleGoogleConsent(page);
    const finalUrl = page.url();
    if (finalUrl && !finalUrl.includes('news.google.com') && finalUrl.length > 15) {
      return finalUrl;
    }
    // Fallback: cerca link nella pagina
    const links = await page.evaluate(() => {
      const anchors = document.querySelectorAll('a[href]');
      return Array.from(anchors).map(a => a.href).filter(h => h.startsWith('http') && !h.includes('google.com'));
    });
    if (links.length > 0) return links[0];
    return null;
  } catch(e) {
    console.warn('[GNews Puppeteer] resolve error:', e.message);
    return null;
  } finally {
    if (page) try { await page.close(); } catch(e) {}
  }
}

/**
 * Fetcha il full-text di un articolo dalla URL della testata.
 * Usa Puppeteer per gestire pagine JS-heavy e paywall soft.
 * @param {string} url - URL dell'articolo
 * @returns {Promise<{title:string, text:string, siteName:string}|null>}
 */
async function fetchFullText(url) {
  let page;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['image','stylesheet','font','media'].includes(type)) req.abort();
      else req.continue();
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await handleGoogleConsent(page);
    // Aspetta un attimo per eventuali lazy-load
    await new Promise(r => setTimeout(r, 1500));

    const result = await page.evaluate(() => {
      // Rimuovi noise
      document.querySelectorAll('nav,header,footer,aside,.sidebar,.menu,.share,.social,.cookie,.popup,.newsletter,.adv,.ads,script,style,iframe').forEach(el => el.remove());
      // Trova contenitore articolo
      const selectors = ['[itemprop="articleBody"]','article','.article-content','.post-content','.entry-content','.article-body','.content-body','.text-content','main','.article__body','.story-body','#article-body','#content-main'];
      let container = null;
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().length > 200) { container = el; break; }
      }
      if (!container) container = document.body;
      // Estrai paragrafi
      const nodes = container.querySelectorAll('p, h2, h3, h4, blockquote');
      const texts = [];
      nodes.forEach(el => {
        const text = el.textContent.trim();
        if (text.length < 30) return;
        const links = el.querySelectorAll('a').length;
        const words = text.split(/\s+/).length;
        if (links / Math.max(words, 1) > 0.4) return;
        texts.push(text);
      });
      const title = document.querySelector('h1')?.textContent?.trim() || document.title || '';
      const siteName = document.querySelector('meta[property="og:site_name"]')?.content || '';
      return { title, text: texts.join('\n\n'), siteName };
    });

    if (result.text && result.text.length > 100) return result;
    return null;
  } catch(e) {
    console.warn('[GNews Puppeteer] fetch error:', e.message);
    return null;
  } finally {
    if (page) try { await page.close(); } catch(e) {}
  }
}

/**
 * Risolvi URL Google News + fetcha full-text in un colpo.
 * @param {string} gnUrl
 * @returns {Promise<{resolvedUrl:string, title:string, text:string, siteName:string}|null>}
 */
async function resolveAndFetch(gnUrl) {
  const resolvedUrl = await resolveGoogleNewsUrl(gnUrl);
  if (!resolvedUrl) return null;
  const content = await fetchFullText(resolvedUrl);
  if (!content) return { resolvedUrl, title: '', text: '', siteName: '' };
  return { resolvedUrl, ...content };
}

/** Chiudi il browser (cleanup) */
async function closeBrowser() {
  if (browser) {
    try { await browser.close(); } catch(e) {}
    browser = null;
  }
}

module.exports = { resolveGoogleNewsUrl, fetchFullText, resolveAndFetch, closeBrowser };
