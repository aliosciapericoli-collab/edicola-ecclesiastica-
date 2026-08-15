// stats-refresh.js — Ricalcola statistiche citazioni per ogni articolo di codice
// Cron: ogni notte alle 02:00. Costo: €0 (solo SQL, zero AI)
// NOTA: le notizie sono in-memory — i link hanno solo news_id (stringa)
//       Le date vengono da codici_news_link.created_at
'use strict';

function refreshAllStats(db) {
  console.log('📊 Stats refresh: inizio...');
  const start = Date.now();

  const articoli = db.prepare('SELECT DISTINCT articolo_id FROM codici_news_link').all();
  if (!articoli.length) {
    console.log('📊 Nessun articolo con citazioni. Nulla da aggiornare.');
    return { aggiornati: 0 };
  }

  const upsert = db.prepare(`
    INSERT INTO codici_stats
    (articolo_id, citazioni_7gg, citazioni_30gg, citazioni_90gg,
     citazioni_365gg, citazioni_totali, trend, variazione_vs_periodo_precedente,
     ultima_notizia_id, ultima_notizia_data, aggiornato_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(articolo_id) DO UPDATE SET
      citazioni_7gg = excluded.citazioni_7gg,
      citazioni_30gg = excluded.citazioni_30gg,
      citazioni_90gg = excluded.citazioni_90gg,
      citazioni_365gg = excluded.citazioni_365gg,
      citazioni_totali = excluded.citazioni_totali,
      trend = excluded.trend,
      variazione_vs_periodo_precedente = excluded.variazione_vs_periodo_precedente,
      ultima_notizia_id = excluded.ultima_notizia_id,
      ultima_notizia_data = excluded.ultima_notizia_data,
      aggiornato_at = CURRENT_TIMESTAMP
  `);

  // Usa created_at del link come proxy per la data della notizia
  const count7    = db.prepare("SELECT COUNT(*) as n FROM codici_news_link WHERE articolo_id=? AND created_at >= datetime('now','-7 days')");
  const count30   = db.prepare("SELECT COUNT(*) as n FROM codici_news_link WHERE articolo_id=? AND created_at >= datetime('now','-30 days')");
  const count90   = db.prepare("SELECT COUNT(*) as n FROM codici_news_link WHERE articolo_id=? AND created_at >= datetime('now','-90 days')");
  const count365  = db.prepare("SELECT COUNT(*) as n FROM codici_news_link WHERE articolo_id=? AND created_at >= datetime('now','-365 days')");
  const countTot  = db.prepare("SELECT COUNT(*) as n FROM codici_news_link WHERE articolo_id=?");
  const countPrev = db.prepare("SELECT COUNT(*) as n FROM codici_news_link WHERE articolo_id=? AND created_at >= datetime('now','-60 days') AND created_at < datetime('now','-30 days')");
  const ultima    = db.prepare("SELECT news_id, created_at FROM codici_news_link WHERE articolo_id=? ORDER BY created_at DESC LIMIT 1");

  const refresh = db.transaction(() => {
    for (const { articolo_id } of articoli) {
      const c7   = count7.get(articolo_id).n;
      const c30  = count30.get(articolo_id).n;
      const c90  = count90.get(articolo_id).n;
      const c365 = count365.get(articolo_id).n;
      const tot  = countTot.get(articolo_id).n;
      const prev = countPrev.get(articolo_id).n;

      let trend = 'stabile', variazione = 0;
      if (prev > 0) {
        variazione = Math.round(((c30 - prev) / prev) * 1000) / 10;
        if (variazione > 20) trend = 'aumento';
        else if (variazione < -20) trend = 'diminuzione';
      } else if (c30 > 0) { trend = 'aumento'; variazione = 100; }

      const ult = ultima.get(articolo_id);
      upsert.run(articolo_id, c7, c30, c90, c365, tot, trend, variazione,
        ult?.news_id || null, ult?.created_at || null);
    }
  });
  refresh();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`📊 Stats aggiornate per ${articoli.length} articoli in ${elapsed}s`);

  // Top 10 trending
  const top10 = db.prepare(`
    SELECT a.codice_id as abbr, a.numero as num, a.titolo as rubrica,
           cs.citazioni_30gg, cs.trend, cs.variazione_vs_periodo_precedente as var
    FROM codici_stats cs
    JOIN articoli_codice a ON cs.articolo_id = a.id
    WHERE cs.citazioni_30gg > 0
    ORDER BY cs.citazioni_30gg DESC LIMIT 10
  `).all();

  if (top10.length) {
    console.log('\n🔥 Top articoli citati (30gg):');
    top10.forEach((t, i) => {
      const arrow = t.trend === 'aumento' ? '↑' : t.trend === 'diminuzione' ? '↓' : '→';
      console.log(` ${i+1}. ${t.abbr} art. ${t.num} — ${t.citazioni_30gg} cit. ${arrow} ${t.var}% — ${t.rubrica || ''}`);
    });
  }
  return { aggiornati: articoli.length, top10 };
}

module.exports = { refreshAllStats };
