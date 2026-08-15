#!/usr/bin/env node
/**
 * sitemap-generator.js — Genera sitemap.xml per Edicola Ecclesiastica
 * Eseguire con cron ogni 6 ore: node /home/work/edicola/sitemap-generator.js
 * Non richiede SQLite — funziona con la struttura attuale
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = '/home/work/edicola/sitemap.xml';
const now = new Date().toISOString().slice(0, 10);

// Pagine statiche sempre presenti
const staticUrls = [
  { loc: 'https://edicolaecclesiastica.com/', lastmod: now, changefreq: 'always', priority: '1.0' },
  { loc: 'https://edicolaecclesiastica.com/manifesto', lastmod: '2026-03-21', changefreq: 'monthly', priority: '0.8' }
];

// Pagine tema — quando esisteranno (da SQLite), aggiungerle qui
// Per ora: array vuoto, pronto per l'espansione
let themeUrls = [];

// In futuro con SQLite:
// try {
//   const Database = require('better-sqlite3');
//   const db = new Database('/home/work/edicola/data/edicola.db', { readonly: true });
//   const themes = db.prepare('SELECT tema_id, updated_at FROM themes WHERE is_active = 1').all();
//   themeUrls = themes.map(t => ({
//     loc: 'https://edicolaecclesiastica.com/tema/' + encodeURIComponent(t.tema_id),
//     lastmod: t.updated_at ? t.updated_at.slice(0, 10) : now,
//     changefreq: 'daily',
//     priority: '0.7'
//   }));
//   db.close();
// } catch(e) { console.log('[sitemap] temi non disponibili:', e.message); }

const allUrls = [...staticUrls, ...themeUrls];

let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

for (const u of allUrls) {
  xml += '  <url>\n';
  xml += '    <loc>' + u.loc + '</loc>\n';
  xml += '    <lastmod>' + u.lastmod + '</lastmod>\n';
  xml += '    <changefreq>' + u.changefreq + '</changefreq>\n';
  xml += '    <priority>' + u.priority + '</priority>\n';
  xml += '  </url>\n';
}

xml += '</urlset>\n';

fs.writeFileSync(OUTPUT_PATH, xml, 'utf8');
console.log('[sitemap] Scritto', OUTPUT_PATH, '(' + xml.length + ' bytes,' , allUrls.length, 'URL)');
