import React, { useState, useEffect, useCallback, useRef } from "react";

const API = "";  // stesso dominio

// ── Anteprime notizie: cache client + dedup richieste a /api/preview ──
const _previewCache = new Map();     // url → image ('' = provato, nessuna)
const _previewInflight = new Map();  // url → Promise
function loadPreview(url) {
  if (!url) return Promise.resolve("");
  if (_previewCache.has(url)) return Promise.resolve(_previewCache.get(url));
  if (_previewInflight.has(url)) return _previewInflight.get(url);
  const p = fetch(API + "/api/preview?url=" + encodeURIComponent(url))
    .then(r => (r.ok ? r.json() : { image: "" }))
    .then(j => {
      const img = (j && j.image) || "";
      _previewCache.set(url, img);
      _previewInflight.delete(url);
      return img;
    })
    .catch(() => { _previewCache.set(url, ""); _previewInflight.delete(url); return ""; });
  _previewInflight.set(url, p);
  return p;
}

// Palette "Sala Stampa": fondo neutro caldo (bruno, non più blu-grigio),
// oro invariato, porpora cardinalizia come secondo accento.
const DARK = {
  bg: "#131011",
  surface: "#1D1719",
  surfaceHover: "#251D20",
  border: "#302629",
  accent: "#C8A96E",
  accentDim: "#8B7744",
  porpora: "#C46A7C",
  porporaDeep: "#7E2A3C",
  text: "#E8E4DD",
  textMuted: "#948A87",
  textDim: "#5C5552",
  danger: "#C45C5C",
  success: "#4A9960",
  trending: "#D4A053",
};

const LIGHT = {
  bg: "#F5F1EA",
  surface: "#FFFFFF",
  surfaceHover: "#EFE8DE",
  border: "#DCD2C6",
  accent: "#96702A",
  accentDim: "#C8A96E",
  porpora: "#8C2332",
  porporaDeep: "#8C2332",
  text: "#1E1814",
  textMuted: "#6E645C",
  textDim: "#8A8480",
  danger: "#B04040",
  success: "#2E7A40",
  trending: "#8A5A1A",
};

// Tema globale — aggiornato dal toggle
let _darkMode = true;
const getColors = () => _darkMode ? DARK : LIGHT;
let COLORS = getColors();

const AREA_COLORS = {
  // Aree ecclesiastiche
  "santa_sede": "#C9A45C",
  "diritto_canonico": "#A63A50",
  "stato_chiese": "#7B68A6",
  "chiesa_italia": "#5CA065",
  "confessioni_acattoliche": "#C4835C",
  "liberta_religiosa": "#5CBAC4",
  "religioni_mondo": "#C4835C",
  "penale": "#C45C5C",
  "civile": "#5B9BD5",
  "lavoro": "#5CA065",
  "tributario": "#D4A053",
  "amministrativo": "#9B7EC4",
  "costituzionale": "#C45C8A",
  "privacy": "#5CBAC4",
  "comunitario": "#5B9BD5",
  "diritto_penale": "#C45C5C",
  "diritto_civile": "#5B9BD5",
  "diritto_lavoro": "#5CA065",
  "diritto_tributario": "#D4A053",
  "diritto_amministrativo": "#9B7EC4",
  "notizie_giustizia": "#D4A053",
  "giurisprudenza": "#C45C8A",
  "eu_normativa": "#5B9BD5",
  "cassazione": "#8B1A1A",
  "cassazione_ssuu": "#8B1A1A",
  "cassazione_massimario": "#A0522D",
  "cassazione_penale": "#C45C5C",
  "cassazione_civile": "#5B9BD5",
  "cassazione_lavoro": "#5CA065",
  "istituzionale_cassazione": "#8B1A1A",
};

// ─── CATEGORY LABELS ─────────────────────────────────────────────────
const CATEGORY_LABELS = {
  "tutte": "Tutte",
  "santa_sede": "Santa Sede",
  "diritto_canonico": "Dir. Canonico",
  "stato_chiese": "Stato e Chiese",
  "chiesa_italia": "Chiesa Italia",
  "confessioni_acattoliche": "Religioni",
  "liberta_religiosa": "Libertà religiosa",
  "religioni_mondo": "Religioni",
  "penale": "Penale", "diritto_penale": "Penale", "gn_penale": "Penale",
  "civile": "Civile", "diritto_civile": "Civile", "gn_diritto": "Civile",
  "lavoro": "Lavoro", "diritto_lavoro": "Lavoro", "gn_lavoro": "Lavoro",
  "tributario": "Tributario", "diritto_tributario": "Tributario", "gn_tributario": "Tributario",
  "amministrativo": "Amm.vo", "diritto_amministrativo": "Amm.vo", "gn_amministrativo": "Amm.vo",
  "costituzionale": "Cost.", "gn_costituzionale": "Cost.", "gn_ordinamento": "Ord. Giud.", "gn_legislazione": "Legislazione",
  "privacy": "Privacy", "diritto_privacy": "Privacy", "gn_privacy": "Privacy",
  "bancario": "Bancario", "diritto_bancario": "Bancario", "gn_bancario": "Bancario",
  "gn_vigilanza": "Vigilanza", "gn_adr": "Arbitri",
  "famiglia": "Famiglia", "gn_famiglia": "Famiglia",
  "eu": "UE", "eu_normativa": "UE", "eu_giurisprudenza": "UE", "eu_legislazione": "UE", "gn_diritto_eu": "UE",
  "immigrazione": "Immigraz.", "gn_immigrazione": "Immigraz.",
  "ambientale": "Ambiente", "gn_ambientale": "Ambiente",
  "gn_autorita": "Autorità",
  "gn_ssuu": "Sezioni Unite",
  "gn_crisi_impresa": "Crisi Impresa",
  "giurisprudenza": "Giurisprudenza",
  "cassazione": "Cassazione",
  "cassazione_ssuu": "Sez. Unite",
  "cassazione_massimario": "Massimario",
  "cassazione_penale": "Cass. Penale",
  "cassazione_civile": "Cass. Civile",
  "cassazione_lavoro": "Cass. Lavoro",
  "istituzionale_cassazione": "Cassazione",
  "avvocatura": "Avvocatura",
  "quotidiano_giuridico": "Diritto",
  "generalista_sezione_legale": "Giustizia",
  "agenzia_giustizia": "Giustizia",
  "notizie_giustizia": "Giustizia",
  "gn_sospetto": "Indagini",
  "gilda": "Sindacato",
  "risultato_contabile": "Contabilità",
  "euregolamentazione": "Regolam. UE",
  "istituzionale_gu": "Gazzetta Uff.",
  "istituzionale_corte_cost": "Corte Cost.",
  "istituzionale_cds": "Cons. di Stato",
  "istituzionale_fisco": "Fisco",
  "notizie_avvocatura": "Avvocatura",
  "diritto_bancario": "Bancario",
};
const catLabel = (cat) => CATEGORY_LABELS[cat] || (cat || "").replace(/_/g," ").replace(/\w/g,l=>l.toUpperCase());

const _S = { stroke:"#D4A843", strokeWidth:1.75, strokeLinecap:"round", strokeLinejoin:"round", fill:"none" };
const IcoCostituzione  = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><path d="M3 21h18M3 10h18M12 3 3 10M12 3l9 7M9 21V10M15 21V10"/></svg>;
const IcoCivile        = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><circle cx="12" cy="6" r="1.5"/><path d="M12 7.5v3m-6 0h12M7.5 10.5 6 18h12l-1.5-7.5M6 18H4m16 0h-2"/></svg>;
const IcoPenale        = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><path d="M14 4 5 13l-.5 2.5 2.5-.5L16 6ZM12.5 5.5l3 3M5 19h4M19 19H9"/></svg>;
const IcoProcCivile    = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>;
const IcoProcPenale    = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><rect x="4" y="3" width="12" height="15" rx="2"/><path d="M8 7h4M8 11h4M8 15h2"/><circle cx="17" cy="17" r="3"/><path d="m19.5 19.5 2 2"/></svg>;
const IcoTUIR          = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><circle cx="12" cy="12" r="9"/><path d="M9 12h6M12 9v6"/><path d="M9.5 9.5C10 8.5 10.9 8 12 8s2.5.9 2.5 2.5c0 2-2.5 2.5-2.5 4.5"/><circle cx="12" cy="16.5" r=".5" fill="#D4A843"/></svg>;
const IcoCrisi         = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><rect x="3" y="7" width="18" height="13" rx="1"/><path d="M7 7V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M9 14l2 2 4-4"/></svg>;
const IcoPrivacy       = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><path d="M12 2 4 5v6c0 5 3.6 9.5 8 10.5C16.4 20.5 20 16 20 11V5Z"/><circle cx="12" cy="12" r="2"/><path d="M12 10V8"/></svg>;
const IcoContratti     = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><path d="M6.5 12.5C6.5 12.5 5 11 5 9.5a3.5 3.5 0 1 1 7 0c0 1.5-1.5 3-1.5 3L7 16ZM7 16h4"/><path d="M17.5 12.5C17.5 12.5 19 11 19 9.5a3.5 3.5 0 1 0-7 0c0 1.5 1.5 3 1.5 3L17 16ZM17 16h-4"/><path d="M10 16v1a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-1"/></svg>;
const IcoEnti          = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><path d="M3 21h18M3 10h18M12 3 3 10M12 3l9 7"/><rect x="9" y="13" width="6" height="8"/></svg>;
const IcoConsumo       = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><circle cx="8" cy="18" r="1.5"/><circle cx="17" cy="18" r="1.5"/><path d="M2 3h2l2.5 11h10l2-7H7"/><path d="M12 7v4M10 9h4"/></svg>;
const IcoProcAmm       = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h2"/><circle cx="16" cy="16" r="2.5"/><path d="M16 13.5V11M16 18.5V21M13.5 16H11M18.5 16H21M14.7 14.7 13 13M18.3 18.3 20 20M14.7 17.3 13 19M18.3 13.7 20 12"/></svg>;
const IcoLavoratori    = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><circle cx="9" cy="7" r="3"/><path d="M3 21v-2a6 6 0 0 1 6-6h0"/><circle cx="17" cy="9" r="2.5"/><path d="M13 21v-1.5A4.5 4.5 0 0 1 17.5 15H21v6"/></svg>;
const IcoAmbiente      = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><path d="M17 8C8 10 5.9 16.17 3.82 19.82"/><path d="M10.92 5.08C8.82 3 7.16 2 5.5 2A7.5 7.5 0 0 0 2 8.5C2 12.46 4.21 15.5 7 17.5"/><path d="M6.5 14c2-2.5 5.5-3.5 8.5-3.5s5.5 1.5 7 4.5"/><circle cx="17" cy="19" r="3"/></svg>;
const IcoSicurezza     = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>;
const IcoNavigazione   = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><path d="M3 17h18M7 17 5 9h14l-2 8M12 3v4M9 5h6"/><circle cx="12" cy="20" r="1.5"/></svg>;
const IcoStrada        = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><path d="M19 17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2z"/><path d="M12 7v10M8 9l-1-2M16 9l1-2M7 14h2M15 14h2"/></svg>;
const IcoContabile     = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/><path d="M7 6v12"/></svg>;
const IcoTerzoSettore  = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><path d="M12 21.593c-5.63-5.539-11-10.297-11-14.402C1 3.199 4 1 7.5 1c1.8 0 3.4.9 4.5 2.3C13.1 1.9 14.7 1 16.5 1 20 1 23 3.199 23 7.191c0 4.105-5.37 8.863-11 14.402z"/></svg>;
const IcoAntimafia     = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><path d="M12 2 4 5v7c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V5Z"/><path d="M8 11h8M12 7v8"/></svg>;
const IcoComunicazioni = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/></svg>;
const IcoPenitenziario = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><circle cx="12" cy="9" r="4"/><path d="M3 20v-1a9 9 0 0 1 18 0v1"/><path d="M12 13v8M9 18h6"/></svg>;
const IcoImmigrazione  = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="m8 12 4-4 4 4"/></svg>;
const IcoCad           = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 8h10M7 12h6"/></svg>;

// Mapping codice_id → metadati UI (nome leggibile, abbreviazione, icona)
// La lista CODICI_META è la fonte di verità per UI; il DB è la fonte di verità per i conteggi.
// I codici presenti in DB ma NON in CODICI_META vengono mostrati con icona di default.
const CODICI_META = [
  { id:"codice_civile",          abbr:"c.c.",            nome:"Codice Civile",                         Icon:IcoCivile },
  { id:"codice_ambiente",        abbr:"D.Lgs. 152/2006", nome:"Codice dell'Ambiente",                  Icon:IcoAmbiente },
  { id:"tu_sicurezza",           abbr:"D.Lgs. 81/2008",  nome:"T.U. Sicurezza sul Lavoro",             Icon:IcoSicurezza },
  { id:"codice_navigazione",     abbr:"R.D. 327/1942",   nome:"Codice della Navigazione",              Icon:IcoNavigazione },
  { id:"codice_strada",          abbr:"D.Lgs. 285/1992", nome:"Codice della Strada",                   Icon:IcoStrada },
  { id:"giustizia_contabile",    abbr:"D.Lgs. 174/2016", nome:"Codice di Giustizia Contabile",         Icon:IcoContabile },
  { id:"cpc",                    abbr:"c.p.c.",          nome:"Codice di Procedura Civile",             Icon:IcoProcCivile },
  { id:"codice_penale",          abbr:"c.p.",            nome:"Codice Penale",                         Icon:IcoPenale },
  { id:"cpp",                    abbr:"c.p.p.",          nome:"Codice di Procedura Penale",             Icon:IcoProcPenale },
  { id:"codice_terzo_settore",   abbr:"D.Lgs. 117/2017", nome:"Codice del Terzo Settore",              Icon:IcoTerzoSettore },
  { id:"codice_antimafia",       abbr:"D.Lgs. 159/2011", nome:"Codice Antimafia",                      Icon:IcoAntimafia },
  { id:"codice_comunicazioni",   abbr:"D.Lgs. 259/2003", nome:"Codice Comunicazioni Elettroniche",     Icon:IcoComunicazioni },
  { id:"ordinamento_penitenziario", abbr:"L. 354/1975",  nome:"Ordinamento Penitenziario",             Icon:IcoPenitenziario },
  { id:"codice_crisi",           abbr:"CCII",            nome:"Codice della Crisi d'Impresa",          Icon:IcoCrisi },
  { id:"tu_immigrazione",        abbr:"D.Lgs. 286/1998", nome:"T.U. Immigrazione",                     Icon:IcoImmigrazione },
  { id:"tuir",                   abbr:"TUIR",            nome:"Testo Unico Imposte sui Redditi",        Icon:IcoTUIR },
  { id:"codice_consumo",         abbr:"cod.cons.",       nome:"Codice del Consumo",                    Icon:IcoConsumo },
  { id:"costituzione",           abbr:"Cost.",           nome:"Costituzione della Repubblica",          Icon:IcoCostituzione },
  { id:"codice_privacy",         abbr:"D.Lgs. 196/2003", nome:"Codice della Privacy",                 Icon:IcoPrivacy },
  { id:"d231_2001",              abbr:"D.Lgs. 231/2001", nome:"Responsabilità degli Enti",             Icon:IcoEnti },
  { id:"cad",                    abbr:"D.Lgs. 82/2005",  nome:"Codice Amministrazione Digitale",       Icon:IcoCad },
  { id:"l241_1990",              abbr:"L. 241/1990",     nome:"Procedimento Amministrativo",           Icon:IcoProcAmm },
  { id:"statuto_lavoratori",     abbr:"L. 300/1970",     nome:"Statuto dei Lavoratori",                Icon:IcoLavoratori },
  { id:"codice_pa_amministrativo", abbr:"D.Lgs. 104/2010", nome:"Codice del Processo Amministrativo", Icon:IcoProcAmm },
  { id:"codice_contratti",       abbr:"D.Lgs. 36/2023",  nome:"Codice dei Contratti Pubblici",         Icon:IcoContratti },
];

// Icona di default per codici non mappati
const IcoDefault = () => <svg width="28" height="28" viewBox="0 0 24 24" {..._S}><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>;

// Strip HTML tags lato client (protezione universale)
const cleanHTML = (s) => s ? s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim() : '';

// ── markdown → html (PageGenio/PageAula): versione con sentenza-link e CSS vars ──
function mdToHtml(md) {
  if (!md) return '';
  // Sostituisce riferimenti sentenza con span cliccabile PRIMA dell'escape HTML
  const SENT_RE = /Cass\.?\s*(Sez\.?\s*[IVX]+|SU|SS\.?UU\.?)?\s*n\.?\s*(\d+)\/(\d{4})/gi;
  const mdLinked = md.replace(SENT_RE, (match, _sez, numero, anno) =>
    `<SENTLINK data-numero="${numero}" data-anno="${anno}">${match}</SENTLINK>`
  );
  return mdLinked
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Ripristina i tag SENTLINK dopo l'escape (i < > sono stati escapati, li correggiamo)
    .replace(/&lt;SENTLINK data-numero="(\d+)" data-anno="(\d{4})"&gt;([\s\S]*?)&lt;\/SENTLINK&gt;/g,
      (_m, numero, anno, testo) =>
        `<span class="sentenza-link" data-numero="${numero}" data-anno="${anno}" style="color:#1E6FAB;cursor:pointer;text-decoration:underline;font-weight:600">${testo}</span>`
    )
    .replace(/^#{1,2}\s+(.+)$/gm, '<h2 style="color:var(--eg-accent);font-size:15px;font-weight:800;margin:18px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--eg-border)">$1</h2>')
    .replace(/^#{3}\s+(.+)$/gm, '<h3 style="color:var(--eg-text);font-size:13px;font-weight:700;margin:12px 0 6px">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^[-•]\s+(.+)$/gm, '<li style="margin:3px 0">$1</li>')
    .replace(/(<li[^>]*>.*<\/li>\n?)+/g, m => `<ul style="padding-left:18px;margin:6px 0">${m}</ul>`)
    .replace(/^(?!<[h|u|l])(.*\S.*)$/gm, '<p style="margin:4px 0;line-height:1.6">$1</p>')
    .replace(/(<\/p>)\n(<p)/g, '$1$2')
    .replace(/\n{2,}/g, '<br/>');
}

// ── markdown → html (PageAula): tema scuro con colori fissi ──
function mdToHtmlDark(md) {
  if (!md) return '';
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^#{1,2}\s+(.+)$/gm, '<h2 style="color:#C8A96E;font-size:15px;font-weight:800;margin:18px 0 8px;padding-bottom:4px;border-bottom:1px solid #333">$1</h2>')
    .replace(/^#{3}\s+(.+)$/gm, '<h3 style="color:#e8e4dd;font-size:13px;font-weight:700;margin:12px 0 6px">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^[-•]\s+(.+)$/gm, '<li style="margin:3px 0">$1</li>')
    .replace(/(<li[^>]*>.*<\/li>\n?)+/g, m => `<ul style="padding-left:18px;margin:6px 0">${m}</ul>`)
    .replace(/^(?!<[h|u|l])(.*\S.*)$/gm, '<p style="margin:4px 0;line-height:1.6">$1</p>')
    .replace(/(<\/p>)\n(<p)/g, '$1$2')
    .replace(/\n{2,}/g, '<br/>');
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 3600) return Math.round(diff/60) + "m";
  if (diff < 86400) return Math.round(diff/3600) + "h";
  return Math.round(diff/86400) + "g";
}

// ─── COMPONENTS ───

function TrendBadge({ trend, variazione }) {
  const arrow = trend === "aumento" ? "↑" : trend === "diminuzione" ? "↓" : "→";
  const color = trend === "aumento" ? "var(--eg-success)" : trend === "diminuzione" ? "var(--eg-danger)" : "var(--eg-text-muted)";
  return (
    <span style={{ color, fontSize: 11, fontWeight: 600 }}>
      {arrow} {variazione > 0 ? "+" : ""}{variazione}%
    </span>
  );
}

function AreaTag({ area }) {
  const color = AREA_COLORS[area] || "var(--eg-text-muted)";
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, textTransform: "uppercase",
      letterSpacing: "0.08em", color, background: color + "18",
      padding: "2px 6px", borderRadius: 3,
    }}>{area?.replace(/_/g," ") || "altro"}</span>
  );
}

function NormaChip({ norma, onClick }) {
  return (
    <span onClick={() => onClick && onClick(norma)} style={{
      fontSize: 11, color: "var(--eg-accent)", background: "var(--eg-accent)" + "15",
      border: `1px solid var(--eg-accent)30`, padding: "1px 6px",
      borderRadius: 3, cursor: "pointer", marginRight: 4, marginTop: 3,
      display:"inline-block",
    }}>{norma}</span>
  );
}

function AuthorityDots({ score }) {
  return (
    <span style={{ display:"flex", gap:2, alignItems:"center" }}>
      {[1,2,3,4,5].map(n => (
        <span key={n} style={{
          width:5, height:12, borderRadius:2,
          background: n <= score ? "var(--eg-accent)" : "var(--eg-border)",
          display:"inline-block",
        }}/>
      ))}
    </span>
  );
}


// ─── PERPLEXITY VERIFICATION BADGE ──────────────────────────────────
function VerificationBadge({ score }) {
  if (score === null || score === undefined) return null;
  const s = Number(score);
  let color, bg, icon, label;
  if (s <= 30)      { color='#D32F2F'; bg='#D32F2F18'; icon='⚠️'; label='Non verificato'; }
  else if (s <= 60) { color='#E67E22'; bg='#E67E2218'; icon='🔍'; label='Parzialmente verificato'; }
  else if (s <= 85) { color='#43A047'; bg='#43A04718'; icon='✓';  label='Verificato'; }
  else              { color='#1B5E20'; bg='#1B5E2018'; icon='✅'; label='Fonti certificate'; }
  return (
    <span title={'Confidenza Perplexity: ' + s + '%'} style={{
      display:'inline-flex', alignItems:'center', gap:4,
      fontSize:10, fontWeight:600, color, background:bg,
      padding:'2px 8px', borderRadius:4, border:'1px solid ' + color + '30',
      whiteSpace:'nowrap', cursor:'default'
    }}>
      <span>{icon}</span>
      <span>{label}</span>
      <span style={{opacity:0.7, fontSize:9}}>({s}%)</span>
    </span>
  );
}

// ─── PERPLEXITY DETAIL PANEL (accordion) ─────────────────────────────
function PerplexityDetail({ fontiJson }) {
  const [open, setOpen] = useState(false);
  if (!fontiJson) return null;

  let data;
  try { data = typeof fontiJson === 'string' ? JSON.parse(fontiJson) : fontiJson; } catch(e) { return null; }

  const verifica = data.verifica || {};
  const fonti = verifica.fonti || [];
  const normeArr = (data.norme_arricchite || data.norme || {}).norme || [];
  if (!fonti.length && !normeArr.length && !verifica.nota) return null;

  return (
    <div style={{ marginTop:10, borderRadius:8, border:'1px solid var(--eg-border)', overflow:'hidden' }}>
      <button onClick={() => setOpen(!open)} style={{
        width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'8px 12px', background:'var(--eg-surface-hover)', border:'none',
        cursor:'pointer', fontSize:12, fontWeight:600, color:'var(--eg-text)'
      }}>
        <span>🔎 Verifica Perplexity — {fonti.length} fonti, {normeArr.length} norme</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding:'12px', fontSize:12, lineHeight:1.6, color:'var(--eg-text-muted)' }}>
          {/* Nota */}
          {verifica.nota && (
            <div style={{ marginBottom:10, padding:'8px', borderRadius:6, background:'var(--eg-surface)', border:'1px solid var(--eg-border)', fontStyle:'italic' }}>
              {verifica.nota}
            </div>
          )}

          {/* Fonti */}
          {fonti.length > 0 && (
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--eg-accent)', marginBottom:6 }}>Fonti trovate</div>
              {fonti.map((f, i) => (
                <div key={i} style={{ marginBottom:6, paddingLeft:8, borderLeft:'2px solid var(--eg-accent)30' }}>
                  <a href={f.url} target='_blank' rel='noopener noreferrer'
                    style={{ color:'var(--eg-accent)', textDecoration:'none', fontWeight:600 }}
                    onMouseEnter={e => e.currentTarget.style.textDecoration='underline'}
                    onMouseLeave={e => e.currentTarget.style.textDecoration='none'}
                  >{f.titolo || f.url}</a>
                  {f.tipo && <span style={{ marginLeft:6, fontSize:10, color:'var(--eg-text-dim)', fontStyle:'italic' }}>({f.tipo})</span>}
                </div>
              ))}
            </div>
          )}

          {/* Norme arricchite */}
          {normeArr.length > 0 && (
            <div>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--eg-accent)', marginBottom:6 }}>Norme arricchite</div>
              {normeArr.map((n, i) => (
                <div key={i} style={{ marginBottom:10, padding:'8px', borderRadius:6, background:'var(--eg-surface)', border:'1px solid var(--eg-border)' }}>
                  <div style={{ fontWeight:700, color:'var(--eg-text)', marginBottom:4 }}>
                    {n.norma}
                    {n.url_normattiva && (
                      <a href={n.url_normattiva} target='_blank' rel='noopener noreferrer'
                        style={{ marginLeft:8, fontSize:10, color:'var(--eg-accent)', textDecoration:'none' }}>
                        📖 Normattiva
                      </a>
                    )}
                  </div>
                  {n.ultima_modifica && <div style={{ fontSize:11, color:'var(--eg-text-dim)', marginBottom:4 }}>Ultima modifica: {n.ultima_modifica}</div>}
                  {(n.sentenze_correlate || []).length > 0 && (
                    <div style={{ marginTop:4 }}>
                      <div style={{ fontSize:10, fontWeight:600, color:'var(--eg-text-muted)', marginBottom:2 }}>Sentenze correlate:</div>
                      {(n.sentenze_correlate || []).map((s, j) => (
                        <div key={j} style={{ fontSize:11, color:'var(--eg-text-muted)', marginLeft:8, marginBottom:2 }}>
                          <span style={{ fontWeight:600 }}>Cass. n. {s.numero}</span>
                          {s.data && <span> ({s.data})</span>}
                          {s.massima_breve && <span> — {s.massima_breve}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── CONDIVISIONE ────────────────────────────────────────────────────────────
function useShare() {
  const [popup, setPopup] = useState(null); // null | { title, text, url }

  const share = (title, text, url) => {
    if (navigator.share) {
      navigator.share({ title, text, url }).catch(() => {});
    } else {
      setPopup({ title, text, url });
    }
  };

  return { share, popup, closePopup: () => setPopup(null) };
}

function SharePopup({ popup, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!popup) return null;
  const { title, text, url } = popup;
  const enc = s => encodeURIComponent(s);

  const copyLink = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const BTN = ({ href, label, icon, onClick }) => (
    <a href={href} target={href ? '_blank' : undefined} rel="noopener noreferrer"
      onClick={onClick ? (e) => { e.preventDefault(); onClick(); } : undefined}
      style={{
        display:'flex', flexDirection:'column', alignItems:'center', gap:6,
        padding:'12px 8px', borderRadius:10, background:'var(--eg-surface)',
        border:'1px solid var(--eg-border)', color:'var(--eg-text)', textDecoration:'none',
        fontSize:11, fontWeight:600, cursor:'pointer', minWidth:64, flex:1,
        transition:'background 0.15s',
      }}>
      <span style={{ fontSize:22 }}>{icon}</span>
      {label}
    </a>
  );

  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0, zIndex:10000, background:'rgba(0,0,0,0.55)',
      display:'flex', alignItems:'flex-end', justifyContent:'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width:'100%', maxWidth:480, background:'var(--eg-bg)',
        borderRadius:'16px 16px 0 0', padding:'20px 20px 32px',
        border:'1px solid var(--eg-border)', borderBottom:'none',
        boxShadow:'0 -4px 24px rgba(0,0,0,0.4)',
      }}>
        {/* Handle + header */}
        <div style={{ textAlign:'center', marginBottom:4 }}>
          <div style={{ width:36, height:4, borderRadius:2, background:'var(--eg-border)', margin:'0 auto 14px' }} />
          <div style={{ fontSize:12, fontWeight:700, color:'var(--eg-text)', marginBottom:2,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'90%', margin:'0 auto 12px' }}>
            {title.length > 60 ? title.substring(0, 60) + '…' : title}
          </div>
        </div>
        {/* Bottoni */}
        <div style={{ display:'flex', gap:8, marginBottom:12 }}>
          <BTN href={`mailto:?subject=${enc(title)}&body=${enc(text)}%0A%0A${enc(url)}`}
            label="Email" icon="✉️" />
          <BTN href={`https://wa.me/?text=${enc(text + '\n' + url)}`}
            label="WhatsApp" icon="💬" />
          <BTN href={`https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`}
            label="Telegram" icon="📨" />
          <BTN onClick={copyLink} label={copied ? 'Copiato!' : 'Copia link'} icon={copied ? '✅' : '🔗'} />
        </div>
        <button onClick={onClose} style={{
          width:'100%', padding:'10px', borderRadius:8, background:'transparent',
          border:'1px solid var(--eg-border)', color:'var(--eg-text-muted)',
          fontSize:12, cursor:'pointer', fontWeight:600,
        }}>Chiudi</button>
      </div>
    </div>
  );
}

// SVG inline icona condivisione (freccia su)
const ShareIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
    <polyline points="16 6 12 2 8 6"/>
    <line x1="12" y1="2" x2="12" y2="15"/>
  </svg>
);

function NewsCard({ item, onOpenArticolo }) {
  const [expanded, setExpanded] = useState(false);
  const { share, popup, closePopup } = useShare();
  // Traduzione on-demand della card (tasto "Traduci" per gli articoli stranieri)
  const [trad, setTrad] = useState(null);
  const [tradLoading, setTradLoading] = useState(false);
  const traduciCard = async () => {
    if (tradLoading || trad) return;
    setTradLoading(true);
    try {
      const tr = async (text) => {
        if (!text) return '';
        const r = await fetch(API + '/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang: item.lang }) });
        const d = await r.json();
        return d.translated || text;
      };
      const [tTitle, tDesc] = await Promise.all([tr(item.title), tr(item.desc)]);
      setTrad({ title: tTitle, desc: tDesc });
    } catch (_) {}
    setTradLoading(false);
  };

  // ── Anteprima immagine on-demand quando manca la thumbnail RSS ──
  const hasThumb = !!(item.thumb && item.thumb.startsWith("http"));
  const previewUrl = hasThumb ? "" : (item.link || item.url || "");
  const [preview, setPreview] = useState(hasThumb ? "" : (_previewCache.get(previewUrl) || ""));
  const cardRef = useRef(null);
  useEffect(() => {
    if (hasThumb || !previewUrl || preview || !/^https?:\/\//i.test(previewUrl)) return;
    let cancelled = false;
    const el = cardRef.current;
    const go = () => loadPreview(previewUrl).then(img => { if (!cancelled && img) setPreview(img); });
    if (!el || typeof IntersectionObserver === "undefined") { go(); return () => { cancelled = true; }; }
    const obs = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { obs.disconnect(); go(); }
    }, { rootMargin: "300px" });
    obs.observe(el);
    return () => { cancelled = true; obs.disconnect(); };
  }, [previewUrl, hasThumb]); // eslint-disable-line react-hooks/exhaustive-deps
  const thumbSrc = hasThumb ? item.thumb : preview;

  const norme = (() => {
    try {
      const raw = item.l2_contesto || item.l2_norme_citate || "";
      if (!raw) return [];
      // Prima prova: parse intero l2_contesto come JSON strutturato
      const parsed = JSON.parse(raw);
      const obj = parsed.l2_contesto || parsed;
      const arr = obj.norme_citate || [];
      if (Array.isArray(arr)) return arr.map(n => typeof n === 'object' ? (n.norma || '') : n).filter(Boolean);
    } catch(e) {}
    try {
      // Fallback: regex sul campo norme_citate
      const raw = item.l2_contesto || item.l2_norme_citate || "";
      const m = raw.match(/"norme_citate"\s*:\s*(\[[^\]]*\])/);
      if (m) {
        const arr = JSON.parse(m[1]);
        return arr.map(n => typeof n === 'object' ? (n.norma || '') : n).filter(Boolean);
      }
    } catch(e) {}
    return [];
  })();
  const areaColor = AREA_COLORS[item.area_diritto || item.category] || "var(--eg-accent)";

  // Detect if this is a Cassazione/sentenza item
  const isCassazione = /^cassazione|^istituzionale_cassazione/.test(item.category || "");
  const isSentenza = isCassazione || /sentenz|ordinanz|sezioni\s*unite|massim|Cass\./i.test(item.title || "");

  // Parse sentenza metadata from title
  const sentenzaMeta = (() => {
    if (!isSentenza) return null;
    const meta = {};
    // Numero sentenza: n. 12345/2026 or sent. 12345
    const numM = (item.title||'').match(/n\.?\s*(\d{2,6}(?:\/\d{2,4})?)/i) || (item.title||'').match(/sent(?:enza)?\.?\s*(\d{2,6})/i);
    if (numM) meta.numero = numM[1];
    // Sezione
    const sezM = (item.title||'').match(/(sezion[ie]\s+unit[ae]|sez\.?\s*(?:i{1,3}|iv|v|vi)\s*(?:civil|penal|lavor|tribut)?[ei]?)/i)
      || (item.sezione ? {1:item.sezione} : null);
    if (sezM) meta.sezione = (sezM[1]||'').trim();
    else if (item.category === 'cassazione_ssuu') meta.sezione = 'Sezioni Unite';
    else if (item.category === 'cassazione_penale') meta.sezione = 'Penale';
    else if (item.category === 'cassazione_civile') meta.sezione = 'Civile';
    else if (item.category === 'cassazione_lavoro') meta.sezione = 'Lavoro';
    // Esito
    const esitoM = (item.title||'').match(/(accolt[oa]|rigettat[oa]|cassat[oa]\s+con\s+rinvio|inammissibil[ei]|annullat[oa])/i);
    if (esitoM) meta.esito = esitoM[1];
    // Impatto da l5_implicazioni o l3_analisi
    try {
      if (item.l5_implicazioni) {
        const l5 = typeof item.l5_implicazioni === 'string' ? JSON.parse(item.l5_implicazioni) : item.l5_implicazioni;
        const l5d = l5.l5_implicazioni || l5;
        meta.impatto = l5d.impatto_operativo || '';
      }
      if (!meta.impatto && item.l3_analisi) {
        const l3 = typeof item.l3_analisi === 'string' ? JSON.parse(item.l3_analisi) : item.l3_analisi;
        const l3d = l3.l3_analisi || l3;
        meta.impatto = l3d.problema_giuridico || '';
      }
    } catch(e) {}
    return (meta.numero || meta.sezione || meta.esito) ? meta : null;
  })();

  const cassColor = "#8B1A1A";

  return (
    <div ref={cardRef} style={{
      borderRadius:10, background:"var(--eg-surface)",
      border: isSentenza ? `1px solid ${cassColor}30` : "1px solid var(--eg-border)",
      overflow:"hidden", display:"flex", flexDirection:"column",
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = isSentenza ? cassColor+"70" : "var(--eg-accent)"+"50"}
      onMouseLeave={e => e.currentTarget.style.borderColor = isSentenza ? cassColor+"30" : "var(--eg-border)"}
    >
      {/* Thumbnail (RSS o anteprima og:image on-demand) o barra colorata */}
      {(thumbSrc && thumbSrc.startsWith('http')) ? (
        <div onClick={() => ReaderBus.open(item)} style={{ display:"block", flexShrink:0, cursor:"pointer" }}>
          <img src={thumbSrc} alt={`Immagine articolo: ${item.title||""}`} loading="lazy"
            style={{ width:"100%", height:180, objectFit:"cover", display:"block" }}
            onError={e => {
              // Nasconde il div wrapper e mostra la barra colorata al suo posto
              const wrapper = e.target.parentElement;
              if (wrapper) {
                wrapper.style.display = "none";
                const bar = document.createElement("div");
                bar.style.cssText = `height:${isSentenza?5:4}px;background:linear-gradient(90deg,${isSentenza?cassColor:areaColor},${(isSentenza?cassColor:areaColor)}44);flex-shrink:0`;
                wrapper.parentElement && wrapper.parentElement.insertBefore(bar, wrapper);
              }
            }} />
        </div>
      ) : (
        <div style={{ height: isSentenza ? 5 : 4, background: isSentenza ? `linear-gradient(90deg, ${cassColor}, ${cassColor}44)` : `linear-gradient(90deg, ${areaColor}, ${areaColor}44)`, flexShrink:0 }} />
      )}

      <div style={{ padding:"14px", flex:1, display:"flex", flexDirection:"column" }}>
        {/* Meta row */}
        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8, flexWrap:"wrap" }}>
          <span style={{
            fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em",
            color: isSentenza ? cassColor : areaColor,
            background: (isSentenza ? cassColor : areaColor)+"18",
            padding:"2px 7px", borderRadius:3,
            border:`1px solid ${(isSentenza ? cassColor : areaColor)}28`, whiteSpace:"nowrap"
          }}>{isSentenza ? (sentenzaMeta?.sezione || "Cassazione") : catLabel(item.area_diritto || item.category || "altro")}</span>
          {sentenzaMeta?.numero && (
            <span style={{ fontSize:10, color:cassColor, fontWeight:700, fontFamily:"monospace" }}>n. {sentenzaMeta.numero}</span>
          )}
          {sentenzaMeta?.esito && (
            <span style={{
              fontSize:9, fontWeight:700, padding:"2px 6px", borderRadius:3,
              color: /accolt/i.test(sentenzaMeta.esito) ? "var(--eg-success)" : /rigett|inammiss/i.test(sentenzaMeta.esito) ? "var(--eg-danger)" : "var(--eg-text-muted)",
              background: (/accolt/i.test(sentenzaMeta.esito) ? "var(--eg-success)" : /rigett|inammiss/i.test(sentenzaMeta.esito) ? "var(--eg-danger)" : "var(--eg-text-muted)") + "18",
            }}>{sentenzaMeta.esito}</span>
          )}
          <span style={{ fontSize:11, color:"var(--eg-text-muted)" }}>{item.source}</span>
          <span style={{ fontSize:11, color:"var(--eg-text-dim)", marginLeft:"auto" }}>{timeAgo(item.date)}</span>
          {item.perplexity_verified != null && <VerificationBadge score={item.perplexity_verified} />}
        </div>

        {/* Titolo — apre reader interno */}
        <div onClick={() => ReaderBus.open(item)} style={{ flex:1, cursor:"pointer" }}>
          <h3 style={{ fontSize:15, color:"var(--eg-text)", lineHeight:1.5, fontWeight:600, letterSpacing:"-0.01em", marginBottom:4, margin:0 }}
            onMouseEnter={e => e.currentTarget.style.color = isSentenza ? cassColor : "var(--eg-accent)"}
            onMouseLeave={e => e.currentTarget.style.color="var(--eg-text)"}
          >
            {(trad && trad.title) || item.title}
          </h3>
        </div>

        {/* PERCHÉ È IMPORTANTE — solo per sentenze con impatto */}
        {sentenzaMeta?.impatto && (
          <div style={{
            marginTop:8, padding:"8px 10px", borderRadius:6,
            background: cassColor+"0A", border:`1px solid ${cassColor}20`,
          }}>
            <div style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:cassColor, marginBottom:4 }}>Perché è importante</div>
            <div style={{ fontSize:12, color:"var(--eg-text-muted)", lineHeight:1.5, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:3, WebkitBoxOrient:"vertical" }}>
              {sentenzaMeta.impatto}
            </div>
          </div>
        )}

        {/* Snippet — 2 righe max */}
        {item.desc && !sentenzaMeta?.impatto && (
          <div style={{
            marginTop:8, fontSize:12, color:"var(--eg-text-muted)", lineHeight:1.6,
            overflow:"hidden", display:"-webkit-box",
            WebkitLineClamp: expanded ? 999 : 2, WebkitBoxOrient:"vertical",
          }}>{cleanHTML((trad && trad.desc) || item.desc)}</div>
        )}

        {/* Norme */}
        {norme.length > 0 && (
          <div style={{ marginTop:8, display:"flex", flexWrap:"wrap", gap:3 }}>
            {norme.map((n,i) => {
              const normaStr = typeof n === 'object' ? (n.norma || n.ruolo || '') : n;
              return <NormaChip key={i} norma={normaStr} onClick={(codice) => {
                document.dispatchEvent(new CustomEvent('eg:openNorma', { detail: { codice } }));
              }} />;
            })}
          </div>
        )}

        {/* Perplexity */}
        {item.perplexity_fonti && <PerplexityDetail fontiJson={item.perplexity_fonti} />}

        {/* L6 Badges */}
        {(() => {
          if (!item.scalata_l6) return null;
          let l6;
          try { l6 = typeof item.scalata_l6 === 'string' ? JSON.parse(item.scalata_l6) : item.scalata_l6; } catch(e) { return null; }
          const hasContrasto = (l6?.collisions || []).length > 0;
          const hasGap = (l6?.gaps || []).length > 0;
          const hasTrend = (l6?.trend || []).some(t => t?.direzione === 'crescente' || t?.trend === 'crescente');
          if (!hasContrasto && !hasGap && !hasTrend) return null;
          return (
            <div style={{ marginTop:6, display:'flex', flexWrap:'wrap', gap:4 }}>
              {hasContrasto && (
                <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:10,
                  background:'#7B1E1E', color:'#FFCDD2', border:'1px solid #C45C5C40', whiteSpace:'nowrap' }}>
                  ⚡ Contrasto
                </span>
              )}
              {hasGap && (
                <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:10,
                  background:'#5C4800', color:'#FFE082', border:'1px solid #D4A05340', whiteSpace:'nowrap' }}>
                  ⚠ Gap
                </span>
              )}
              {hasTrend && (
                <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:10,
                  background:'#1B4332', color:'#A7F3D0', border:'1px solid #4A996040', whiteSpace:'nowrap' }}>
                  ↑ Trending
                </span>
              )}
            </div>
          );
        })()}

        {/* Footer */}
        <div style={{ marginTop:10, display:"flex", alignItems:"center", gap:8, paddingTop:8, borderTop:`1px solid var(--eg-border)40` }}>
          <div onClick={() => ReaderBus.open(item)} style={{
            fontSize:12, color:"var(--eg-text)", fontWeight:600, cursor:"pointer",
            background:"var(--eg-surface-hover)", border:"1px solid var(--eg-border)",
            padding:"4px 12px", borderRadius:4, display:"flex", alignItems:"center", gap:5
          }}>
            <span>▲</span><span>Leggi e Scala</span>
          </div>
          <button onClick={() => share(item.title || '', item.desc ? item.title + ' — ' + item.desc.substring(0, 120) : item.title, item.link || 'https://edicolaecclesiastica.com')}
            title="Condividi" style={{
              background:'transparent', border:'1px solid var(--eg-border)', borderRadius:4,
              color:'var(--eg-text-muted)', cursor:'pointer', padding:'4px 8px',
              display:'flex', alignItems:'center', gap:4, fontSize:11
            }}>
            <ShareIcon /> Condividi
          </button>
          {item.lang && item.lang !== 'it' && !item.translated && !trad && (
            <button onClick={traduciCard} disabled={tradLoading} title="Traduci in italiano" style={{
              background:'transparent', border:'1px solid var(--eg-porpora)', borderRadius:4,
              color:'var(--eg-porpora)', cursor:'pointer', padding:'4px 8px', fontSize:11
            }}>{tradLoading ? 'Traduco…' : '🇮🇹 Traduci'}</button>
          )}
          <a href={item.link} target="_blank" rel="noopener noreferrer"
            style={{ fontSize:11, color:"var(--eg-text-muted)", textDecoration:"none", padding:"4px 8px" }}
            title="Articolo originale">↗</a>
          {item.desc && (
            <button onClick={() => setExpanded(!expanded)} style={{
              fontSize:11, color:"var(--eg-text-dim)", background:"transparent", border:"none", cursor:"pointer", padding:0, marginLeft:4
            }}>{expanded ? "▲" : "▼"}</button>
          )}
        </div>
      </div>
      <SharePopup popup={popup} onClose={closePopup} />
    </div>
  );
}


// ─── FORMAT CONTENT (client-side HTML parser) ────────────────────────
function formatContent(html) {
  if (!html) return '';
  // Rimuovi blocchi rumore
  const clean = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<figure[^>]*>[\s\S]*?<\/figure>/gi, '')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
  const tmp = document.createElement('div');
  tmp.innerHTML = clean;
  // Rimuovi nodi menu/nav via JS (più affidabile del regex)
  tmp.querySelectorAll('nav,header,footer,aside,[class*="menu"],[class*="share"],[class*="social"],[class*="related"],[class*="sidebar"],[class*="widget"],[class*="banner"],[class*="cookie"],[class*="popup"],[class*="newsletter"]')
    .forEach(el => el.remove());
  const nodes = tmp.querySelectorAll('p, h2, h3, h4, blockquote');
  const result = [];
  nodes.forEach(el => {
    const text = el.textContent.trim();
    if (text.length < 30) return;
    // Filtra menu: troppi link rispetto al testo
    const linkCount = el.querySelectorAll('a').length;
    const wordCount = text.split(/\s+/).length;
    if (linkCount / Math.max(wordCount, 1) > 0.35) return;
    const tag = el.tagName.toLowerCase();
    const txtColor = 'var(--eg-text)';
    const mutedColor = 'var(--eg-text-muted)';
    const accentColor = 'var(--eg-accent)';
    if (tag === 'h2' || tag === 'h3' || tag === 'h4') {
      result.push('<h3 style="font-size:15px;font-weight:700;color:' + txtColor + ';margin:22px 0 8px;line-height:1.35">' + text + '</h3>');
    } else if (tag === 'blockquote') {
      result.push('<blockquote style="border-left:3px solid ' + accentColor + ';padding:8px 16px;margin:14px 0;color:' + mutedColor + ';font-style:italic;line-height:1.65">' + text + '</blockquote>');
    } else {
      result.push('<p style="margin:0 0 15px;line-height:1.8;color:' + txtColor + ';font-size:15px">' + text + '</p>');
    }
  });
  // Fallback: testo grezzo se nessun <p> trovato
  if (result.length === 0) {
    const rawText = tmp.textContent.replace(/\s+/g, ' ').trim();
    if (rawText.length > 100) {
      return rawText.match(/.{1,600}(?:\.\s|$)/g)
        ?.filter(s => s.trim().length > 40)
        .map(s => '<p style="margin:0 0 15px;line-height:1.8;color:var(--eg-text);font-size:15px">' + s.trim() + '</p>')
        .join('') || '<p style="color:var(--eg-text-muted);font-style:italic">Contenuto estratto non disponibile — leggi l\'articolo originale.</p>';
    }
  }
  // Converti markdown residuo in HTML
  let out = result.join('');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // AutoLink norme — applicato solo nel pannello articolo (non nelle card)
  out = autoLinkNorme(out);
  return out;
}

// ─── AUTO LINK NORME ─────────────────────────────────────────────────────────
// Wrappa le citazioni normative nel testo HTML in span cliccabili.
// Usare SOLO nei pannelli articolo/sentenza — mai nelle card lista.
function normalizeNormaCode(raw) {
  if (!raw) return raw;
  let s = raw;
  s = s.replace(/,?\s+cod\.?\s*pen\./g,        ' c.p.');
  s = s.replace(/\s+cod\.?\s*proc\.?\s*pen\./g, ' c.p.p.');
  s = s.replace(/\s+cod\.?\s*civ\./g,           ' c.c.');
  s = s.replace(/\s+cod\.?\s*proc\.?\s*civ\./g, ' c.p.c.');
  s = s.replace(/  +/g, ' ').trim();
  return s;
}

function autoLinkNorme(html) {
  if (!html || typeof html !== 'string') return html;
  // Pattern: art. X (cod | c.c. | c.p. | c.p.p. | c.p.c. | Cost.)
  // e riferimenti a leggi/decreti tipo D.Lgs. X/YYYY, D.L. X/YYYY, L. X/YYYY
  const RE_NORMA = /(art(?:t)?\.?\s+[\d][\d\-]*(?:bis|ter|quater|quinquies)?(?:\s*(?:comma|co\.)\s*\d+)?(?:\s+(?:c\.c\.|c\.p\.|c\.p\.p\.|c\.p\.c\.|c\.n\.|Cost\.|cod\.pen\.|cod\.proc\.pen\.|cod\.civ\.|t\.u\.|t\.u\.i\.r\.|disp\.att\.c\.p\.p\.|disp\.att\.c\.p\.c\.))?|D\.Lgs\.?\s+\d+\/\d{4}|D\.L\.?\s+\d+\/\d{4}|L\.\s+\d+\/\d{4})/gi;
  // Esegui sostituzione solo fuori dai tag HTML (<...>)
  // Strategia: split su tag HTML, processa solo i nodi testo
  return html.replace(/>([^<]+)</g, (match, text) => {
    const linked = text.replace(RE_NORMA, (found) => {
      const codice = normalizeNormaCode(found.replace(/\s+/g, ' ').trim());
      return `<span class="norma-link" data-norma="${codice}" style="color:var(--eg-accent);cursor:pointer;border-bottom:1px dotted var(--eg-accent);font-weight:500" title="Apri nel grafo: ${codice}">${found}</span>`;
    });
    return '>' + linked + '<';
  });
}

// Handler globale per click su .norma-link — usato da ArticleReaderPanel e PannelloSentenza
// Dispatcher: emette eg:openNorma che l'App root intercetta
function setupNormaLinkHandler(containerEl) {
  if (!containerEl) return;
  const handler = (e) => {
    const el = e.target.closest('.norma-link');
    if (!el) return;
    const codice = el.getAttribute('data-norma');
    if (codice) {
      document.dispatchEvent(new CustomEvent('eg:openNorma', { detail: { codice } }));
    }
  };
  containerEl.addEventListener('click', handler);
  return () => containerEl.removeEventListener('click', handler);
}

// ─── CASI SIMILI ────────────────────────────────────────────────────
function CasiSimili({ item }) {
  const [simili, setSimili] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!item?.id) { setLoading(false); return; }
    fetch(API + `/api/casi-simili?id=${encodeURIComponent(item.id)}`)
      .then(r => r.json())
      .then(d => { setSimili((d.simili || []).slice(0, 5)); setLoading(false); })
      .catch(() => setLoading(false));
  }, [item?.id]);

  if (loading || simili.length === 0) return null;

  return (
    <div style={{ borderTop:"1px solid var(--eg-border)", padding:"16px 20px" }}>
      <div style={{ fontSize:11, fontWeight:700, color:"var(--eg-accent)", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Casi Simili</div>
      {simili.map((s, i) => (
        <div key={i} onClick={() => document.dispatchEvent(new CustomEvent('eg:openArticle', { detail: { id: s.id, item: s } }))} style={{
          display:"block", padding:"8px 0", borderBottom: i < simili.length - 1 ? "1px solid var(--eg-border)" : "none",
          cursor:"pointer",
        }}>
          <div style={{ fontSize:12, color:"var(--eg-text)", lineHeight:1.4 }}
            onMouseEnter={e => e.currentTarget.style.color="var(--eg-accent)"}
            onMouseLeave={e => e.currentTarget.style.color="var(--eg-text)"}
          >{s.title}</div>
          <div style={{ fontSize:10, color:"var(--eg-text-dim)", marginTop:2, display:"flex", gap:8 }}>
            <span>{s.source}</span>
            {s.norme_comuni > 0 && <span style={{ color:"var(--eg-accent)" }}>{s.norme_comuni} norme in comune</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── INTELLIGENZA GIURIDICA (L6) PANEL ──────────────────────────────
function IntelligenzaGiuridicaPanel({ l6 }) {
  const [open, setOpen] = useState(false);
  if (!l6) return null;
  const strategy  = l6?.strategy  || [];
  const collisions= l6?.collisions || [];
  const crossAreas= l6?.cross_areas|| [];
  const chains    = l6?.chains     || [];
  if (!strategy.length && !collisions.length && !crossAreas.length && !chains.length) return null;

  return (
    <div style={{ borderTop:'1px solid var(--eg-border)', background:'var(--eg-surface)' }}>
      <button onClick={() => setOpen(!open)} style={{
        width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'14px 24px', background:'transparent', border:'none', cursor:'pointer',
      }}>
        <div>
          <div style={{ fontSize:13, fontWeight:700, color:'var(--eg-text)', textAlign:'left' }}>🧠 Intelligenza Giuridica</div>
          <div style={{ fontSize:11, color:'var(--eg-text-muted)', marginTop:2, textAlign:'left' }}>
            {strategy.length > 0 && `${strategy.length} consigli · `}
            {collisions.length > 0 && `${collisions.length} contrasti · `}
            {crossAreas.length > 0 && `${crossAreas.length} aree · `}
            {chains.length > 0 && `${chains.length} catene`}
          </div>
        </div>
        <span style={{ color:'var(--eg-text-dim)', fontSize:14 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding:'0 24px 20px' }}>

          {/* Strategia */}
          {strategy.length > 0 && (
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--eg-accent)', marginBottom:8 }}>Strategia</div>
              <ul style={{ margin:0, padding:'0 0 0 18px', listStyle:'disc' }}>
                {(strategy || []).map((s, i) => (
                  <li key={i} style={{ fontSize:13, color:'var(--eg-text)', lineHeight:1.6, marginBottom:4 }}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Contrasti */}
          {collisions.length > 0 && (
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'#C45C5C', marginBottom:8 }}>⚡ Orientamenti in contrasto</div>
              {(collisions || []).map((c, i) => (
                <div key={i} style={{ padding:'8px 10px', borderRadius:6, background:'#C45C5C0A', border:'1px solid #C45C5C20', marginBottom:6 }}>
                  {c.title && <a href={c.url || '#'} target='_blank' rel='noopener noreferrer' style={{ fontSize:12, color:'var(--eg-text)', textDecoration:'none', display:'block', fontWeight:600 }}
                    onMouseEnter={e=>e.currentTarget.style.color='#C45C5C'} onMouseLeave={e=>e.currentTarget.style.color='var(--eg-text)'}>{c.title}</a>}
                  {c.tipo && <span style={{ fontSize:10, color:'#C45C5C', fontWeight:600 }}>{c.tipo}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Cross-area */}
          {crossAreas.length > 0 && (
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'#9B7EC4', marginBottom:8 }}>↔ Applicazione trasversale</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {(crossAreas || []).map((a, i) => (
                  <span key={i} style={{ fontSize:11, padding:'3px 10px', borderRadius:10,
                    background:'#9B7EC415', border:'1px solid #9B7EC430', color:'#9B7EC4', fontWeight:600 }}>
                    {typeof a === 'object' ? (a.norma || a.area || JSON.stringify(a)) : a}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Catene normative */}
          {chains.length > 0 && (
            <div>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'#5C8AC4', marginBottom:8 }}>⛓ Catena normativa</div>
              {(chains || []).map((ch, i) => (
                <div key={i} style={{ fontSize:12, color:'var(--eg-text-muted)', padding:'4px 0', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                  {(Array.isArray(ch) ? ch : [ch]).map((n, j, arr) => (
                    <React.Fragment key={j}>
                      <span style={{ color:'var(--eg-accent)', fontFamily:'monospace', fontSize:11 }}>{n}</span>
                      {j < arr.length - 1 && <span style={{ color:'var(--eg-text-dim)' }}>→</span>}
                    </React.Fragment>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ARTICLE READER PANEL ────────────────────────────────────────────
// ─── SCALATA v2 — 3 blocchi da /api/scalata/v2 (norme + giurisprudenza + sintesi) ───
function ScalataV2({ item }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [off, setOff] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setOff(false); setData(null);
    fetch(API + '/api/scalata/v2', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: item.id, title: item.title,
        content: item.full_text || item.desc || item.snippet || item.l1_fatto || '',
        source: item.source || item.source_name || '', url: item.url || item.link || '',
        category: item.category || item.area_diritto || '',
      }),
    })
      .then(r => { if (r.status === 503) { if (alive) setOff(true); return null; } return r.json(); })
      .then(d => { if (!alive) return; if (d) setData(d); setLoading(false); })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [item]);

  if (off) return null; // Scalata disabilitata → nessun pannello (niente funzioni spente a schermo)

  const apriNorma = (n) => {
    if (!n.risolto || !n.codice_id) return;
    window.__pendingNormaArticolo = { codice_id: n.codice_id, numero: n.numero, codice_nome: n.fonte };
    document.dispatchEvent(new CustomEvent('eg:navigateTo', { detail: { tab: 'norme' } }));
    setTimeout(() => document.dispatchEvent(new CustomEvent('eg:openNormaArticolo', { detail: window.__pendingNormaArticolo })), 90);
  };

  const H = ({ n, children }) => (
    <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--eg-text-muted)', margin: '16px 0 8px' }}>
      {children}{n != null && <span style={{ color: 'var(--eg-accent)', marginLeft: 6 }}>{n}</span>}
    </div>
  );

  return (
    <div style={{ padding: '18px 24px 24px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--eg-text)' }}>▲ Scalata giuridica</div>
      <div style={{ fontSize: 11.5, color: 'var(--eg-text-muted)', marginTop: 2 }}>Norme citate, giurisprudenza correlata e sintesi — solo da fonti ufficiali.</div>

      {loading && <div style={{ fontSize: 12, color: 'var(--eg-text-dim)', marginTop: 14 }}>Analisi in corso…</div>}

      {data && data.agganci === false && (
        <div style={{ marginTop: 16, padding: '14px 16px', background: 'var(--eg-surface)', border: '1px solid var(--eg-border)', borderRadius: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--eg-text)', marginBottom: 4 }}>Questa notizia non ha agganci giuridici diretti</div>
          <div style={{ fontSize: 11.5, color: 'var(--eg-text-muted)', lineHeight: 1.55 }}>
            Non sono state rilevate norme citate né una giurisprudenza chiaramente pertinente. La scalata giuridica si attiva sulle notizie con un contenuto normativo o processuale riconoscibile.
          </div>
        </div>
      )}

      {data && data.agganci !== false && (
        <>
          {/* BLOCCO 1 — NORME CITATE */}
          <H n={data.norme.length}>Norme citate</H>
          {data.norme.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--eg-text-dim)' }}>Nessun riferimento normativo esplicito rilevato.</div>
            : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {data.norme.map((n, i) => n.risolto ? (
                  <button key={i} onClick={() => apriNorma(n)} title={n.titolo || ''}
                    style={{ fontSize: 11.5, padding: '4px 10px', borderRadius: 12, background: 'var(--eg-accent)', border: 'none', color: '#000', fontWeight: 700, cursor: 'pointer' }}>
                    {n.ref}{n.fonte ? ' · ' + (n.fonte.length > 22 ? n.fonte.slice(0, 22) + '…' : n.fonte) : ''}
                  </button>
                ) : (
                  <span key={i} style={{ fontSize: 11.5, padding: '4px 10px', borderRadius: 12, background: 'var(--eg-surface-hover)', border: '1px solid var(--eg-border)', color: 'var(--eg-text-muted)' }}>
                    {n.ref}
                  </span>
                ))}
              </div>}

          {/* BLOCCO 2 — GIURISPRUDENZA CORRELATA */}
          <H n={data.giurisprudenza.length}>Giurisprudenza correlata</H>
          {data.giurisprudenza.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--eg-text-dim)' }}>Nessuna sentenza correlata trovata.</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.giurisprudenza.map((s, i) => (
                  <div key={i} style={{ padding: '10px 12px', border: '1px solid var(--eg-border)', borderRadius: 8, background: 'var(--eg-surface)' }}>
                    <div onClick={() => document.dispatchEvent(new CustomEvent('eg:openSentenza', { detail: { id: s.id, url: s.url } }))}
                      style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--eg-text)', cursor: 'pointer' }}>
                      {s.titolo}{s.data ? <span style={{ fontWeight: 400, color: 'var(--eg-text-dim)' }}> · {s.data}</span> : null}
                    </div>
                    {s.snippet && <div style={{ fontSize: 11.5, color: 'var(--eg-text-muted)', lineHeight: 1.5, marginTop: 3 }}
                      dangerouslySetInnerHTML={{ __html: (s.snippet || '').replace(/\[/g, '<mark style="background:rgba(200,169,110,0.35);color:inherit">').replace(/\]/g, '</mark>') }} />}
                    {s.url && <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10.5, color: 'var(--eg-accent)', textDecoration: 'none' }}>PDF ufficiale ↗</a>}
                  </div>
                ))}
              </div>}

          {/* BLOCCO 3 — SINTESI GIURIDICA */}
          <H>Sintesi giuridica</H>
          {data.sintesi ? (
            <div style={{ fontSize: 12.5, color: 'var(--eg-text)', lineHeight: 1.65 }}>
              {data.sintesi.inquadramento && <p style={{ marginBottom: 10 }}>{data.sintesi.inquadramento}</p>}
              {data.sintesi.principio_diritto && <p style={{ marginBottom: 10 }}><strong style={{ color: 'var(--eg-accent)' }}>Principio di diritto. </strong>{data.sintesi.principio_diritto}</p>}
              {data.sintesi.cosa_cambia && <p><strong style={{ color: 'var(--eg-accent)' }}>Cosa cambia. </strong>{data.sintesi.cosa_cambia}</p>}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--eg-text-muted)', padding: '10px 12px', background: 'rgba(200,169,110,0.10)', borderRadius: 8 }}>
              {data.sintesi_stato === 'cap_esaurito'
                ? '⏳ La sintesi AI ha raggiunto il limite giornaliero: riprende domani. Norme e giurisprudenza qui sopra restano disponibili.'
                : 'Sintesi AI non disponibile al momento. Norme e giurisprudenza restano consultabili.'}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ArticleReaderPanel({ item, onClose, onOpenArticolo }) {
  const { share: shareArticle, popup: sharePopup, closePopup: closeSharePopup } = useShare();
  const [content, setContent] = useState(null);
  const [scalata, setScalata] = useState({ l0:null, l1:null, l2:null, l3:null, related:[] });
  const [scalataLoading, setScalataLoading] = useState(false);
  const [scalataStarted, setScalataStarted] = useState(false);
  const [l3Loading, setL3Loading] = useState(false);
  const [activeScalataTab, setActiveScalataTab] = useState(null);
  const [l7Data, setL7Data] = useState(null);
  const [l7Loading, setL7Loading] = useState(false);
  const [pannelloSentenzaId, setPannelloSentenzaId] = useState(null);
  const [fetchingFull, setFetchingFull] = useState(false);
  const [manualContent, setManualContent] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  // Traduzione integrale on-demand (articoli stranieri)
  const [tradFull, setTradFull] = useState(null);
  const [tradFullLoading, setTradFullLoading] = useState(false);
  const [mostraOriginale, setMostraOriginale] = useState(false);

  const isCassazioneArticle = /cassazione|Cass\./i.test(item?.source || '') || /^cassazione/i.test(item?.category || '');

  // Carica contenuto articolo
  useEffect(() => {
    if (!item) return;
    setContent(null); setScalata({ l0:null, l1:null, l2:null, l3:null, related:[] });
    setScalataStarted(false); setActiveScalataTab(null);
    setManualContent(null); setFetchError(null); setFetchingFull(false);
    setTradFull(null); setTradFullLoading(false); setMostraOriginale(false);
    const url = item.link || item.url || "";
    if (!url) return;
    fetch("/api/article?url=" + encodeURIComponent(url) + "&title=" + encodeURIComponent((item.title||'').substring(0,80)))
      .then(r => r.json())
      .then(d => setContent(d))
      .catch(() => setContent({ error:true }));
  }, [item]);

  function startScalata() {
    if (scalataStarted) return;
    setScalataStarted(true);
    setScalataLoading(true);
    setActiveScalataTab("l1");

    const title = item.title || "";
    const snippet = (content?.content || item.desc || "").substring(0, 800);
    const artUrl = item.link || item.url || "";

    // L0 in parallelo
    if (item.source && artUrl) {
      fetch("/api/source-profile?source=" + encodeURIComponent(item.source) + "&url=" + encodeURIComponent(artUrl) + "&keywords=" + encodeURIComponent(title.split(" ").slice(0,5).join(",")))
        .then(r => r.json())
        .then(d => setScalata(s => ({ ...s, l0: d })))
        .catch(() => {});
    }

    // L1 + L2
    fetch("/api/synthesize", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ title, content: snippet, level:"l1l2" })
    })
    .then(r => r.json())
    .then(d => {
      setScalataLoading(false);
      if (!d.error) {
        setScalata(s => ({ ...s, l1:d.l1_fatto, l2:d.l2_contesto, keywords:d.keywords||[] }));
        // L4 correlati
        if (d.keywords?.length && artUrl) {
          fetch("/api/related?url=" + encodeURIComponent(artUrl) + "&keywords=" + encodeURIComponent(d.keywords.join(",")) + "&source=" + encodeURIComponent(item.source||"") + "&category=" + encodeURIComponent(item.category||""))
            .then(r => r.json())
            .then(rel => setScalata(s => ({ ...s, related: rel||[] })))
            .catch(() => {});
        }
      } else {
        setScalataLoading(false);
      }
    })
    .catch(() => setScalataLoading(false));
  }

  function loadL3() {
    if (scalata.l3) { setActiveScalataTab("l3"); return; }
    setL3Loading(true);
    const title = item.title || "";
    const snippet = (content?.content || item.desc || "").substring(0, 800);
    const artUrl = item.link || item.url || "";
    fetch("/api/synthesize", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ title, content: snippet, level:"l3", source: item.source||"", l1: scalata.l1, l2: scalata.l2, articleUrl: artUrl })
    })
    .then(r => r.json())
    .then(d => {
      setL3Loading(false);
      if (!d.error) {
        const l3data = d.l3_analisi || d;
        setScalata(s => ({ ...s, l3: l3data }));
        setActiveScalataTab("l3");
      }
    })
    .catch(() => setL3Loading(false));
  }

  const [l5Loading, setL5Loading] = useState(false);

  function loadL5() {
    if (scalata.l5) { setActiveScalataTab("l5"); return; }
    // Se non abbiamo L3, prima genera L3 poi L5
    if (!scalata.l3 && !l3Loading) { loadL3(); return; }
    setL5Loading(true);
    const title = item.title || "";
    const snippet = (content?.content || item.desc || "").substring(0, 800);
    const artUrl = item.link || item.url || "";
    fetch("/api/synthesize", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ title, content: snippet, level:"l5", source: item.source||"", l1: scalata.l1, l2: scalata.l2, l3: scalata.l3, articleUrl: artUrl })
    })
    .then(r => r.json())
    .then(d => {
      setL5Loading(false);
      if (!d.error) {
        setScalata(s => ({ ...s, l5: d.l5_implicazioni || d }));
        setActiveScalataTab("l5");
      }
    })
    .catch(() => setL5Loading(false));
  }

  if (!item) return null;
  const areaColor = AREA_COLORS[item.area_diritto || item.category] || "var(--eg-accent)";
  const articleText = manualContent || content?.content;
  const hasContent = articleText && articleText.length > 100;
  const shortDesc = !item.desc || item.desc.length < 200 || item.desc === item.title;


  // L6 — parse from item.scalata_l6
  const l6Raw = item?.scalata_l6;
  let l6 = null;
  if (l6Raw) { try { l6 = typeof l6Raw === 'string' ? JSON.parse(l6Raw) : l6Raw; } catch(e) {} }

  // Norme citate: prendi da l1 (item.norme_citate), scalata.l1, o item direttamente
  const normeItem = (() => {
    const raw = item?.norme_citate || item?.l2_norme_citate || '';
    if (Array.isArray(raw)) return raw.map(n => typeof n==='object'?(n.norma||''):n).filter(Boolean);
    if (typeof raw === 'string' && raw.trim().startsWith('[')) {
      try { const p = JSON.parse(raw); return p.map(n => typeof n==='object'?(n.norma||''):n).filter(Boolean); } catch(e) {}
    }
    if (typeof raw === 'string' && raw.length > 0) return raw.split(/[,;]/).map(s=>s.trim()).filter(Boolean);
    return [];
  })();

  function loadL7() {
    if (l7Data || l7Loading) { setActiveScalataTab('l7'); return; }
    const norme = normeItem.length > 0 ? normeItem : (scalata.l1?.norme_citate||[]).map(n=>typeof n==='object'?(n.norma||''):n).filter(Boolean);
    if (!norme.length) { setL7Data({ empty: true }); setActiveScalataTab('l7'); return; }
    setL7Loading(true);
    setActiveScalataTab('l7');
    // Fetch /api/grafo/norma for up to 5 norme in parallel
    Promise.all(norme.slice(0,5).map(n =>
      fetch(API + '/api/grafo/norma?codice=' + encodeURIComponent(n))
        .then(r => r.json())
        .then(d => ({ norma: n, data: d.ok ? d : null }))
        .catch(() => ({ norma: n, data: null }))
    )).then(results => {
      setL7Data({ norme: results, totalNorme: norme.length });
      setL7Loading(false);
    });
  }

  function loadFullContent() {
    const artUrl = item?.link || item?.url || '';
    if (!artUrl) return;
    setFetchingFull(true);
    setFetchError(null);
    fetch('/api/article/fetch-content?url=' + encodeURIComponent(artUrl))
      .then(r => r.json())
      .then(d => {
        setFetchingFull(false);
        if (d.ok && d.text && d.text.length > 100) {
          setManualContent(d.text);
        } else {
          setFetchError(d.message || 'Contenuto non disponibile (paywall o accesso bloccato)');
        }
      })
      .catch(() => {
        setFetchingFull(false);
        setFetchError('Errore di connessione');
      });
  }

  return (
    <div style={{ position:"fixed", inset:0, zIndex:300, background:"var(--eg-bg)", display:"flex", flexDirection:"column", overflowY:"auto" }}>

        {/* Header */}
        <div style={{ padding:"16px 20px", borderBottom:"1px solid var(--eg-border)", background:"var(--eg-surface)", position:"sticky", top:0, zIndex:10, display:"flex", alignItems:"flex-start", gap:12 }}>
          <button onClick={onClose} style={{ background:"transparent", border:"none", color:"var(--eg-text-muted)", fontSize:22, cursor:"pointer", padding:0, lineHeight:1, flexShrink:0, marginTop:2 }}>←</button>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
              <span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", color:areaColor, background:areaColor+"18", border:`1px solid ${areaColor}30`, padding:"2px 7px", borderRadius:3 }}>
                {(item.category||"").replace(/_/g," ")}
              </span>
              <span style={{ fontSize:11, color:"var(--eg-text-muted)" }}>{item.source}</span>
              <span style={{ fontSize:11, color:"var(--eg-text-dim)" }}>{timeAgo(item.date)}</span>
            </div>
            <div style={{ fontSize:"clamp(14px, 2vw, 18px)", fontWeight:700, color:"var(--eg-text)", lineHeight:1.4, letterSpacing:"-0.02em" }}>
              {item.title}
            </div>
          </div>
          <button onClick={() => shareArticle(item.title || '', item.desc ? item.title + ' — ' + item.desc.substring(0, 120) : item.title, item.link || 'https://edicolaecclesiastica.com')}
            title="Condividi" style={{
              background:'transparent', border:'1px solid var(--eg-border)', borderRadius:6,
              color:'var(--eg-text-muted)', cursor:'pointer', padding:'5px 9px',
              display:'flex', alignItems:'center', gap:5, fontSize:11, flexShrink:0
            }}>
            <ShareIcon /> Condividi
          </button>
          <a href={content?.resolvedUrl || item.link} target="_blank" rel="noopener noreferrer"
            style={{ color:"var(--eg-text-dim)", fontSize:11, textDecoration:"none", flexShrink:0, padding:"4px 0" }}
            title="Vedi originale">↗</a>
        </div>
        <SharePopup popup={sharePopup} onClose={closeSharePopup} />

        {/* Immagine */}
        {(content?.image || item.thumb) && (
          <img src={content?.image || item.thumb} alt={`Immagine articolo: ${item.title||""}`} style={{ width:"100%", maxHeight:320, objectFit:"cover", display:"block" }}
            onError={e => e.target.style.display="none"} />
        )}

        {/* Corpo articolo */}
        <div style={{ padding:"clamp(14px,3vw,28px)", flex:1 }}>
          {!content && (
            <div style={{ fontSize:14, color:"var(--eg-text)", lineHeight:1.7 }}>
              {item.desc ? <p style={{margin:0}}>{cleanHTML(item.desc)}</p> : <p style={{color:"var(--eg-text-muted)"}}>Caricamento articolo...</p>}
            </div>
          )}
          {item.lang && item.lang !== 'it' && hasContent && (
            <div style={{ margin:'0 0 14px', display:'flex', gap:8, alignItems:'center' }}>
              {!tradFull && (
                <button disabled={tradFullLoading} onClick={async () => {
                  setTradFullLoading(true);
                  try {
                    const plain = (manualContent || articleText || '')
                      .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n\n')
                      .replace(/<br[^>]*>/gi, '\n')
                      .replace(/<[^>]+>/g, ' ')
                      .replace(/[ \t]+/g, ' ')
                      .replace(/\n{3,}/g, '\n\n')
                      .trim();
                    // Due richieste in parallelo: la PRIMA porzione (veloce,
                    // ~4s) compare subito; il testo completo la sostituisce
                    // appena pronto. Così il lettore non fissa uno spinner.
                    const primo = plain.slice(0, 1600);
                    const chiama = (t) => fetch(API + '/api/translate-full', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text: t, lang: item.lang }) }).then(r => r.json()).catch(() => null);
                    const pTutto = chiama(plain);
                    if (plain.length > 1700) {
                      const d1 = await chiama(primo);
                      if (d1 && d1.translated) { setTradFull(d1.translated + '\n\n⏳ Traduzione del resto in corso…'); setTradFullLoading(false); }
                    }
                    const d = await pTutto;
                    if (d && d.translated) setTradFull(d.translated);
                  } catch(_) {}
                  setTradFullLoading(false);
                }} style={{ fontSize:12, fontWeight:700, padding:'6px 14px', borderRadius:6, border:'1px solid var(--eg-porpora)', background:'var(--eg-porpora)15', color:'var(--eg-porpora)', cursor:'pointer' }}>
                  {tradFullLoading ? 'Traduco l\u2019articolo\u2026' : '\ud83c\uddee\ud83c\uddf9 Traduci articolo in italiano'}
                </button>
              )}
              {tradFull && (
                <button onClick={() => setMostraOriginale(v => !v)} style={{ fontSize:12, padding:'6px 14px', borderRadius:6, border:'1px solid var(--eg-border)', background:'transparent', color:'var(--eg-text-muted)', cursor:'pointer' }}>
                  {mostraOriginale ? 'Mostra traduzione' : 'Mostra originale'}
                </button>
              )}
            </div>
          )}
          {tradFull && !mostraOriginale && hasContent && (
            <div style={{ fontSize:14, color:'var(--eg-text)', lineHeight:1.75, fontFamily:'Georgia,serif' }}>
              {tradFull.split(/\n{2,}/).filter(p => p.trim()).map((p,i) => (
                <p key={i} style={{ margin:'0 0 14px' }}>{p.trim()}</p>
              ))}
            </div>
          )}
          {(!tradFull || mostraOriginale) && (content || manualContent) && hasContent && (
            manualContent
              ? <div style={{ fontSize:14, color:"var(--eg-text)", lineHeight:1.75, fontFamily:"Georgia,serif" }}>
                  {manualContent.split(/\n{2,}/).filter(p => p.trim().length > 30).map((p,i) => (
                    <p key={i} style={{ margin:"0 0 14px" }}>{p.trim()}</p>
                  ))}
                </div>
              : <div style={{ fontSize:14, color:"var(--eg-text)", lineHeight:1.75, fontFamily:"Georgia,serif" }}
                  dangerouslySetInnerHTML={{ __html: formatContent(articleText) }}
                />
          )}
          {content && !hasContent && (
            <div style={{ fontSize:14, color:"var(--eg-text)", lineHeight:1.7 }}>
              {item.desc && <p style={{margin:"0 0 16px", fontSize:15, lineHeight:1.7}}>{cleanHTML(item.desc)}</p>}
              {(() => {
                const linkUrl = content?.resolvedUrl || item.link || '';
                let hostname = '';
                try { hostname = new URL(linkUrl).hostname.replace('www.',''); } catch(e) {}
                const isGN = linkUrl.includes('news.google.com');
                return (
                  <div style={{ padding:"14px 16px", borderRadius:8, background:"var(--eg-surface)", border:"1px solid var(--eg-border)" }}>
                    {/* Pulsante carica articolo completo — on-demand */}
                    {(shortDesc || !item.desc) && !fetchError && (
                      <button
                        onClick={loadFullContent}
                        disabled={fetchingFull}
                        style={{
                          display:"block", width:"100%", marginBottom:12, padding:"10px 16px",
                          background: fetchingFull ? "var(--eg-surface)" : "var(--eg-accent)18",
                          border:"1px solid var(--eg-accent)55", borderRadius:6,
                          color: fetchingFull ? "var(--eg-text-muted)" : "var(--eg-accent)",
                          fontSize:13, fontWeight:600, cursor: fetchingFull ? "default" : "pointer",
                          textAlign:"left", transition:"all 0.15s",
                        }}
                      >
                        {fetchingFull ? "⏳ Caricamento in corso…" : "⬇ Carica articolo completo"}
                      </button>
                    )}
                    {fetchError && (
                      <div style={{ marginBottom:10, fontSize:12, color:"var(--eg-danger)", padding:"8px 10px", borderRadius:5, background:"var(--eg-danger)10", border:"1px solid var(--eg-danger)30" }}>
                        {fetchError}
                      </div>
                    )}
                    {!isGN && hostname && (
                      <a href={linkUrl} target="_blank" rel="noopener noreferrer" style={{
                        display:"block", marginBottom:10, fontSize:13, color:"var(--eg-accent)", fontWeight:600, textDecoration:"none",
                      }}>Leggi l'originale su {hostname} ↗</a>
                    )}
                    <p style={{margin:0, fontSize:12, color:"var(--eg-text-dim)"}}>
                      Clicca <strong>▲ SCALA</strong> per generare l'analisi AI dal titolo e dallo snippet.
                    </p>
                  </div>
                );
              })()}
            </div>
          )}
          {/* Fonte */}
          <div style={{ marginTop:16, padding:"12px 14px", borderRadius:6, background:"var(--eg-surface)", border:"1px solid var(--eg-border)" }}>
            <div style={{ fontSize:11, color:"var(--eg-text-dim)", marginBottom:4 }}>
              Fonte: <strong style={{color:"var(--eg-text-muted)"}}>{content?.siteName || item.source || "Edicola Ecclesiastica"}</strong>
            </div>
            {(content?.resolvedUrl || item.link) && (() => {
              const linkUrl = content?.resolvedUrl || item.link;
              let hostname = '';
              try { hostname = new URL(linkUrl).hostname.replace('www.',''); } catch(e) {}
              return hostname && !hostname.includes('news.google.com') ? (
                <a href={linkUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize:10, color:"var(--eg-text-dim)", textDecoration:"none" }}>
                  Vedi originale su {hostname} ↗
                </a>
              ) : null;
            })()}
          </div>
        </div>

        {/* ── CASI SIMILI — rimosso dalla vista (componente ed endpoint restano in piedi) ── */}

        {/* ── INTELLIGENZA GIURIDICA (L6) ── */}
        {item.scalata_l6 && (() => {
          let l6;
          try { l6 = typeof item.scalata_l6 === 'string' ? JSON.parse(item.scalata_l6) : item.scalata_l6; } catch(e) { return null; }
          const strategy = l6?.strategy || [];
          const collisions = l6?.collisions || [];
          const crossAreas = l6?.cross_areas || [];
          const chains = l6?.chains || [];
          if (!strategy.length && !collisions.length && !crossAreas.length && !chains.length) return null;
          return <IntelligenzaGiuridicaPanel l6={l6} />;
        })()}

        {/* ── SCALATA v2 (norme + giurisprudenza + sintesi) ── */}
        <div style={{ borderTop:`2px solid var(--eg-border)`, background:"var(--eg-surface)" }}>
          <ScalataV2 item={item} onOpenArticolo={onOpenArticolo} />
        </div>

      {pannelloSentenzaId && <PannelloSentenza id={pannelloSentenzaId} onClose={() => setPannelloSentenzaId(null)} />}
    </div>
  );
}


// ─── TIMELINE ORIENTAMENTI PER NORMA ─────────────────────────────────
function TimelineOrientamenti({ codiceId, numero }) {
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(API + `/api/norma/timeline?codice_id=${encodeURIComponent(codiceId)}&numero=${encodeURIComponent(numero)}`)
      .then(r => r.json())
      .then(d => { setTimeline(d.timeline || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [codiceId, numero]);

  const orientColors = { favorevole:"var(--eg-success)", restrittivo:"var(--eg-danger)", neutro:"var(--eg-text-dim)" };

  return (
    <div>
      <div style={{ fontSize:11, fontWeight:700, color:"#5CA065", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:12 }}>Timeline Orientamenti</div>
      {loading && <div style={{ fontSize:12, color:"var(--eg-text-muted)" }}>Caricamento timeline...</div>}
      {!loading && timeline.length === 0 && <div style={{ fontSize:12, color:"var(--eg-text-muted)" }}>Nessuna notizia collegata ancora.</div>}
      {timeline.map((t, i) => {
        const color = orientColors[t.orientamento] || orientColors.neutro;
        return (
          <div key={i} style={{ display:"flex", gap:12, marginBottom:0 }}>
            {/* Linea verticale + pallino */}
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", width:20, flexShrink:0 }}>
              <div style={{ width:10, height:10, borderRadius:"50%", background:color, border:`2px solid ${color}`, flexShrink:0, marginTop:4 }} />
              {i < timeline.length - 1 && <div style={{ width:2, flex:1, background:"var(--eg-border)", minHeight:20 }} />}
            </div>
            {/* Contenuto */}
            <div style={{ paddingBottom:14, flex:1, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                <span style={{ fontSize:10, color:"var(--eg-text-dim)", fontWeight:600 }}>
                  {t.date ? new Date(t.date).toLocaleDateString("it-IT") : ""}
                </span>
                <span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", color, padding:"1px 5px", borderRadius:3, background:color+"18" }}>
                  {t.orientamento}
                </span>
                {t.tipo_citazione && <span style={{ fontSize:9, color:"var(--eg-accent)", fontWeight:600 }}>{t.tipo_citazione}</span>}
              </div>
              <div style={{ fontSize:12, color:"var(--eg-text)", lineHeight:1.5, marginTop:3 }}>{t.title}</div>
              <div style={{ fontSize:10, color:"var(--eg-text-dim)", marginTop:2 }}>{t.source}</div>
              {t.analisi_breve && <div style={{ fontSize:11, color:"var(--eg-text-muted)", marginTop:3, fontStyle:"italic", lineHeight:1.4 }}>{t.analisi_breve}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ArticoloPanel({ codiceId, numero, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [giurisp, setGiurisp] = useState([]); // sentenze correlate
  const [analisi, setAnalisi] = useState(null); // analisi AI generata al tap {spiegazione,ambito,giurisprudenza}
  const [analisiGeneratoAt, setAnalisiGeneratoAt] = useState(null);
  const [analisiLoading, setAnalisiLoading] = useState(false);
  const [analisiErr, setAnalisiErr] = useState(null);
  const codiceMeta = CODICI_META.find(c => c.id === codiceId) || { abbr: codiceId, nome: codiceId };

  useEffect(() => {
    setLoading(true); setData(null); setGiurisp([]); setAnalisi(null); setAnalisiGeneratoAt(null); setAnalisiErr(null); setAnalisiLoading(false);
    fetch(API + "/api/articolo/" + codiceId + "/" + numero)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
    // Giurisprudenza correlata: usa /api/grafo/norma con la stringa norma costruita
    const abbr = (CODICI_META.find(c => c.id === codiceId) || {}).abbr || codiceId;
    const normaStr = `art. ${numero} ${abbr.toLowerCase()}`;
    fetch(API + '/api/grafo/norma?codice=' + encodeURIComponent(normaStr))
      .then(r => r.json())
      .then(d => { if (d.ok && d.sentenze?.length) setGiurisp(d.sentenze.slice(0,5)); })
      .catch(() => {});
  }, [codiceId, numero]);

  // Analisi AI on-demand: la cache arriva già da /api/articolo (data.scalata); il bottone
  // "Analisi AI" genera solo se manca (1 chiamata Haiku via /api/norme/analisi).
  const sc = data?.scalata;
  const analisiCache = (sc && sc.l1_sintesi)
    ? { spiegazione: sc.l1_sintesi, ambito: sc.l2_coordinamento || '', giurisprudenza: sc.l3_orientamento_prevalente || '' }
    : null;
  const analisiMostrata = analisi || analisiCache;
  const generatoAt = analisi ? analisiGeneratoAt : (sc?.aggiornato_at || sc?.generato_at || null);
  const fmtDataAnalisi = (iso) => { try { return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; } };

  function loadAnalisi() {
    if (analisiLoading || analisiMostrata) return;
    setAnalisiLoading(true); setAnalisiErr(null);
    fetch(API + '/api/norme/analisi?codice=' + encodeURIComponent(codiceId) + '&articolo=' + encodeURIComponent(numero))
      .then(async r => {
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('application/json')) return { ok: false, message: 'Analisi non disponibile al momento.' };
        return r.json().catch(() => ({ ok: false, message: 'Analisi non disponibile al momento.' }));
      })
      .then(d => {
        if (d && d.ok && d.analisi) { setAnalisi(d.analisi); setAnalisiGeneratoAt(d.generato_at); }
        else setAnalisiErr((d && d.message) || 'Analisi non disponibile al momento.');
      })
      .catch(() => setAnalisiErr('Analisi non disponibile al momento.'))
      .finally(() => setAnalisiLoading(false));
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--eg-bg)", zIndex: 400, maxWidth: 430, margin: "0 auto", overflowY: "auto", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid " + "var(--eg-border)", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, background: "var(--eg-surface)", zIndex: 10 }}>
        <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--eg-text-muted)", fontSize: 20, cursor: "pointer", padding: 0 }}>←</button>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--eg-accent)", fontFamily: "'JetBrains Mono',monospace" }}>
            art. {numero} {codiceMeta.abbr}
          </div>
          <div style={{ fontSize: 10, color: "var(--eg-text-dim)" }}>{codiceMeta.nome}</div>
        </div>
      </div>

      {loading && <div style={{ padding: 20, color: "var(--eg-text-muted)", fontSize: 13 }}>Caricamento...</div>}
      {!loading && !data?.ok && <div style={{ padding: 20, color: "var(--eg-danger)", fontSize: 13 }}>Articolo non disponibile nel DB.</div>}

      {data?.ok && (
        <div style={{ padding: "16px", flex: 1 }}>
          {/* Testo articolo */}
          {data.articolo?.titolo && (
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--eg-text-muted)", marginBottom: 10 }}>{data.articolo.titolo}</div>
          )}
          <div style={{ fontSize: 13, color: "var(--eg-text)", lineHeight: 1.7, whiteSpace: "pre-wrap", padding: 14, background: "var(--eg-surface)", borderRadius: 8, border: "1px solid var(--eg-border)" }}>
            {data.articolo?.testo}
          </div>

          {/* Analisi AI on-demand */}
          <div style={{ marginTop: 16 }}>
            {analisiMostrata ? (
              <div style={{ padding: "14px", background: "var(--eg-surface)", borderRadius: 8, border: "1px solid var(--eg-border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: "var(--eg-accent)", textTransform: "uppercase", letterSpacing: "0.06em" }}>&#9889; Analisi AI</span>
                  {generatoAt && <span style={{ fontSize: 10, color: "var(--eg-text-dim)" }}>&mdash; generata il {fmtDataAnalisi(generatoAt)}</span>}
                </div>
                <div style={{ fontSize: 13, color: "var(--eg-text)", lineHeight: 1.7 }}>{analisiMostrata.spiegazione}</div>
                {analisiMostrata.ambito && <div style={{ fontSize: 12, color: "var(--eg-text-muted)", lineHeight: 1.6, marginTop: 10 }}><strong style={{ color: "var(--eg-text-muted)" }}>Ambito di applicazione. </strong>{analisiMostrata.ambito}</div>}
                {analisiMostrata.giurisprudenza && <div style={{ fontSize: 12, color: "var(--eg-text-muted)", lineHeight: 1.6, marginTop: 8 }}><strong style={{ color: "var(--eg-text-muted)" }}>Giurisprudenza. </strong>{analisiMostrata.giurisprudenza}</div>}
                <div style={{ fontSize: 10, color: "var(--eg-text-dim)", fontStyle: "italic", marginTop: 10 }}>Analisi generata da AI su fonti documentali. Non sostituisce il parere legale.</div>
              </div>
            ) : analisiLoading ? (
              <div style={{ padding: "14px", fontSize: 12, color: "var(--eg-text-muted)" }}>&#9889; Generazione analisi in corso&#8230;</div>
            ) : analisiErr ? (
              <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--eg-text-muted)", background: "rgba(200,169,110,0.10)", borderRadius: 8 }}>{analisiErr}</div>
            ) : (
              <button onClick={loadAnalisi} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "11px", fontSize: 13, fontWeight: 700, color: "#000", background: "var(--eg-accent)", border: "none", borderRadius: 8, cursor: "pointer" }}>
                &#9889; Analisi AI
              </button>
            )}
          </div>

          {/* Giurisprudenza correlata (grafo norma) */}
          {giurisp.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--eg-text-muted)", marginBottom: 8 }}>Giurisprudenza correlata</div>
              {giurisp.map((s, i) => (
                <div key={i}
                  onClick={() => document.dispatchEvent(new CustomEvent('eg:openSentenza', { detail: { id: s.id } }))}
                  style={{ padding: '6px 0', borderBottom: i < giurisp.length - 1 ? '1px solid var(--eg-border)' : 'none', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--eg-text)' }}>n. {s.numero}/{s.anno}{s.sezione ? ` \u2014 ${s.sezione}` : ''}</div>
                  {s.oggetto && <div style={{ fontSize: 11, color: 'var(--eg-text-muted)', lineHeight: 1.4, marginTop: 1 }}>{s.oggetto}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ─── PAGES ───

function IntelligencePanel() {
  const [gaps, setGaps] = useState([]);
  const [contrasti, setContrasti] = useState([]);
  const [trending, setTrending] = useState([]);

  useEffect(() => {
    // Gap Normativi
    fetch(API + '/api/genio/gaps?limit=3')
      .then(r => r.json())
      .then(d => setGaps((d.gaps || []).slice(0, 3)))
      .catch(() => {});

    // Contrasti Aperti (via grafo)
    fetch(API + '/api/grafo/contrasti')
      .then(r => r.json())
      .then(d => setContrasti((d.contrasti || []).slice(0, 3)))
      .catch(() => {});

    // Norme Trending
    fetch(API + '/api/genio/trending?days=7&limit=3')
      .then(r => r.json())
      .then(d => setTrending((d.trending || []).slice(0, 3)))
      .catch(() => {});
  }, []);

  // Apre la norma nel Grafo tramite CustomEvent
  const openNorma = (codice) => {
    document.dispatchEvent(new CustomEvent('eg:openNorma', { detail: { codice } }));
  };

  const hasAny = gaps.length > 0 || contrasti.length > 0 || trending.length > 0;
  if (!hasAny) return null;

  const cardStyle = (accentColor) => ({
    flex: '1 1 220px',
    minWidth: 0,
    background: 'var(--eg-surface)',
    borderLeft: `3px solid ${accentColor}`,
    borderRadius: 6,
    padding: '10px 12px',
    boxSizing: 'border-box',
  });

  const titleStyle = {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--eg-text-muted)',
    marginBottom: 8,
    letterSpacing: '0.02em',
  };

  const itemStyle = {
    fontSize: 12,
    color: 'var(--eg-accent)',
    cursor: 'pointer',
    padding: '4px 0',
    borderBottom: '1px solid var(--eg-border)',
    lineHeight: 1.4,
    display: 'block',
    wordBreak: 'break-word',
  };

  const subStyle = {
    fontSize: 10,
    color: 'var(--eg-text-dim)',
    marginTop: 1,
  };

  return (
    <div style={{ padding: '12px 16px 0', borderBottom: '1px solid var(--eg-border)' }}>
      {/* Header sezione */}
      <div style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', color: 'var(--eg-text-dim)', marginBottom: 8, letterSpacing: '0.08em' }}>
        Intelligence
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, paddingBottom: 12 }}>

        {/* CARD 1 — Gap Normativi */}
        {gaps.length > 0 && (
          <div style={cardStyle('#E67E22')}>
            <div style={titleStyle}>Gap Normativi</div>
            {gaps.map((g, i) => (
              <div key={i}>
                <span
                  style={itemStyle}
                  onClick={() => openNorma(g.codice_norma)}
                  title={`${g.tot_notizie} notizie, ${g.tot_sentenze} sentenze`}
                >
                  {g.codice_norma}
                </span>
                <div style={subStyle}>{g.area} · {g.tot_notizie} notizie · 0 sentenze</div>
              </div>
            ))}
          </div>
        )}

        {/* CARD 2 — Contrasti Aperti */}
        {contrasti.length > 0 && (
          <div style={cardStyle('#D4A843')}>
            <div style={titleStyle}>Contrasti Aperti</div>
            {contrasti.map((c, i) => (
              <div key={i}>
                <span
                  style={itemStyle}
                  onClick={() => openNorma(c.norma_comune)}
                  title={`${c.meta_a?.numero ? `Cass. n. ${c.meta_a.numero}/${c.meta_a.anno}` : c.sentenza_a} vs ${c.meta_b?.numero ? `Cass. n. ${c.meta_b.numero}/${c.meta_b.anno}` : c.sentenza_b}`}
                >
                  {c.norma_comune}
                </span>
                <div style={subStyle}>
                  {c.meta_a?.sezione || ''}{c.meta_a?.numero ? ` · n. ${c.meta_a.numero}/${c.meta_a.anno}` : ''} vs {c.meta_b?.sezione || ''}{c.meta_b?.numero ? ` · n. ${c.meta_b.numero}/${c.meta_b.anno}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* CARD 3 — Norme Trending */}
        {trending.length > 0 && (
          <div style={cardStyle('#27AE60')}>
            <div style={titleStyle}>Norme Trending</div>
            {trending.map((t, i) => (
              <div key={i}>
                <span
                  style={itemStyle}
                  onClick={() => openNorma(t.codice_norma)}
                  title={`${t.citazioni_recenti} citazioni negli ultimi 7 giorni`}
                >
                  {t.codice_norma}
                </span>
                <div style={subStyle}>{t.area} · {t.citazioni_recenti} citazioni · {t.trend}</div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

function NormeCalde({ onFilter, filtroNorma }) {
  const [trending, setTrending] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(API + "/api/codici/trending?giorni=7&limit=20")
      .then(r => r.json())
      .then(d => { setTrending(d.trending || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading || trending.length === 0) return null;

  const abbrMap = {};
  CODICI_META.forEach(c => { abbrMap[c.id] = c.abbr; });

  return (
    <div style={{
      padding:"14px 16px 12px",
      borderBottom:"1px solid var(--eg-border)",
      background:"var(--eg-surface)",
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
        <span style={{ fontSize:16, fontWeight:700, color:"var(--eg-trending)" }}>§</span>
        <h2 style={{
          fontSize:11, fontWeight:700, textTransform:"uppercase",
          letterSpacing:"0.1em", color:"var(--eg-trending)", margin:0,
        }}>Trend Normativi</h2>
        <span style={{ fontSize:10, color:"var(--eg-text-dim)", marginLeft:"auto" }}>ultimi 7 giorni</span>
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
        {(trending || []).map((t, i) => {
          const abbr = abbrMap[t.codice_id] || t.codice_id;
          const label = `Art. ${t.numero} ${abbr}`;
          const isActive = filtroNorma?.label === label;
          const warmColor = i < 3 ? "#E8733A" : i < 8 ? "#D4A053" : "#B8956A";
          return (
            <button key={i} onClick={() => onFilter(isActive ? null : { label, codice_id: t.codice_id, numero: t.numero })} style={{
              background: isActive ? warmColor + "30" : "var(--eg-bg)",
              border: `1px solid ${isActive ? warmColor : "var(--eg-border)"}`,
              color: isActive ? warmColor : "var(--eg-text-muted)",
              borderRadius:20, padding:"4px 12px", fontSize:11, fontWeight:600,
              cursor:"pointer", whiteSpace:"nowrap", flexShrink:0,
              transition:"all 0.2s", lineHeight:1.4,
            }}
              onMouseEnter={e => { if (!isActive) { e.currentTarget.style.borderColor = warmColor; e.currentTarget.style.color = warmColor; }}}
              onMouseLeave={e => { if (!isActive) { e.currentTarget.style.borderColor = "var(--eg-border)"; e.currentTarget.style.color = "var(--eg-text-muted)"; }}}
            >
              {label} <span style={{ opacity:0.7, fontSize:10 }}>({t.citazioni})</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PageNotizie({ onOpenArticolo, onNavigate }) {
  const [notizie, setNotizie] = useState([]);
  const [notizieFiltrate, setNotizieFiltrate] = useState(null); // notizie da API per norma selezionata
  const [filtroArea, setFiltroArea] = useState(null);
  const [filtroNorma, setFiltroNorma] = useState(null); // { label, codice_id, numero } | null
  const [normaLoading, setNormaLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [normeFiltrate, setNormeFiltrate] = useState(null);  // {query, notizie[]} da popup norma
  const [normeFiltrateLoading, setNormeFiltrateLoading] = useState(false);

  // Funzione ricerca per norma dal DB (usata sia on-mount che da event listener)
  const cercaPerNorma = React.useCallback((q) => {
    setNormeFiltrateLoading(true);
    fetch(API + '/api/feeds/per-norma?norma=' + encodeURIComponent(q))
      .then(r => r.json())
      .then(d => {
        const arr = Array.isArray(d) ? d : [];
        setNormeFiltrate({ query: q, notizie: arr });
        setNormeFiltrateLoading(false);
      })
      .catch(() => setNormeFiltrateLoading(false));
  }, []);

  // On-mount: legge pendingSearch (prima visita al tab — prima che il listener venga registrato)
  useEffect(() => {
    const pending = window.__pendingSearch;
    if (pending?.target === 'notizie' && pending?.query) {
      window.__pendingSearch = null;
      cercaPerNorma(pending.query);
    }
  }, []);

  // Listener per visite successive (tab già montato, già in memoria)
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.target !== 'notizie') return;
      const qv = e.detail?.query || '';
      if (qv) cercaPerNorma(qv);
    };
    document.addEventListener('eg:searchQuery', handler);
    return () => document.removeEventListener('eg:searchQuery', handler);
  }, [cercaPerNorma]);

  // Feed normale — fetch iniziale + auto-refresh ogni 5 minuti
  useEffect(() => {
    const loadFeeds = () => {
      fetch(API + "/api/feeds")
        .then(r => r.json())
        .then(d => {
          if (Array.isArray(d) && d.length > 0) {
            setNotizie(d);
          }
          setLoading(false);
        })
        .catch(() => setLoading(false)); // mantieni dati vecchi in caso di errore
    };
    loadFeeds();
    const id = setInterval(loadFeeds, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Quando si seleziona una norma, chiama endpoint dedicato
  useEffect(() => {
    if (!filtroNorma) { setNotizieFiltrate(null); return; }
    setNormaLoading(true);
    fetch(API + `/api/codici/notizie-per-norma?codice_id=${encodeURIComponent(filtroNorma.codice_id)}&numero=${encodeURIComponent(filtroNorma.numero)}`)
      .then(r => r.json())
      .then(d => {
        setNotizieFiltrate(d.notizie || []);
        setNormaLoading(false);
      })
      .catch(() => { setNotizieFiltrate([]); setNormaLoading(false); });
  }, [filtroNorma]);

  // Se norma selezionata, mostra notizie dall'API dedicata; altrimenti feed normale
  const source = notizieFiltrate !== null ? (notizieFiltrate || []) : (notizie || []);
  // Filtri per area: ordine canonico fisso (non per frequenza, così i chip non
  // saltellano a ogni refresh) + conteggio articoli. Eventuali aree fuori
  // elenco si accodano per frequenza.
  const AREE_ORDINE = ['santa_sede','chiesa_italia','diritto_canonico','stato_chiese','liberta_religiosa','religioni_mondo'];
  const aree = (() => {
    const freq = {};
    (notizie || []).forEach(n => { const k = n.area_diritto || n.category; if (k) freq[k] = (freq[k] || 0) + 1; });
    const ordinate = AREE_ORDINE.filter(a => freq[a] > 0).map(a => [a, freq[a]]);
    const extra = Object.entries(freq)
      .filter(([k]) => !AREE_ORDINE.includes(k))
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(0, 12 - ordinate.length));
    return [...ordinate, ...extra];
  })();
  const filtered = (() => {
    // Se c'è un filtro norma da popup, usa quei risultati direttamente
    if (normeFiltrate) return normeFiltrate.notizie;
    let f = filtroArea ? source.filter(n => (n.area_diritto || n.category) === filtroArea) : source;
    return f;
  })();

  const [pageNotizie, setPageNotizie] = useState(1);
  const PER_PAGE_NOTIZIE = 30;

  const handleNormaFilter = (norma) => {
    setFiltroNorma(norma);
    setNotizieFiltrate(null);
    if (norma) setFiltroArea(null);
    setPageNotizie(1);
  };

  const isLoading = loading || normaLoading || normeFiltrateLoading;

  return (
    <div>
      {/* Intelligence — Gap Normativi, Contrasti Aperti, Norme Trending */}
      <IntelligencePanel />

      {/* Filtri area */}
      <div style={{ padding:"12px 16px", display:"flex", gap:6, overflowX:"auto", borderBottom:"1px solid var(--eg-border)", scrollbarWidth:"none" }}>
        {normeFiltrate && (
          <button onClick={() => setNormeFiltrate(null)} style={{
            background:"var(--eg-accent)"+"22", border:"1px solid var(--eg-accent)",
            color:"var(--eg-accent)", borderRadius:20, padding:"5px 14px", fontSize:11, fontWeight:600,
            cursor:"pointer", whiteSpace:"nowrap", flexShrink:0,
          }}>🔍 {normeFiltrate.query} ✕</button>
        )}
        {filtroNorma && (
          <button onClick={() => handleNormaFilter(null)} style={{
            background:"var(--eg-trending)"+"22", border:"1px solid var(--eg-trending)",
            color:"var(--eg-trending)", borderRadius:20, padding:"5px 14px", fontSize:11, fontWeight:600,
            cursor:"pointer", whiteSpace:"nowrap", flexShrink:0,
          }}>{filtroNorma.label} ✕</button>
        )}
        {[["__tutte", (notizie || []).length], ...aree].map(([a, n], i) => {
          const isActive = i === 0 ? (!filtroArea && !filtroNorma) : filtroArea === a;
          const color = i === 0 ? "var(--eg-accent)" : (AREA_COLORS[a] || "var(--eg-accent)");
          return (
            <button key={a} onClick={() => {
              if (i === 0) {
                // "Tutte" → resetta tutto
                setFiltroArea(null);
                handleNormaFilter(null);
              } else {
                setFiltroArea(filtroArea === a ? null : a);
              }
              setPageNotizie(1);
            }} style={{
              background: isActive ? color+"22" : "var(--eg-surface)",
              border: `1px solid ${isActive ? color : "var(--eg-border)"}`,
              color: isActive ? color : "var(--eg-text-muted)",
              borderRadius:20, padding:"5px 14px", fontSize:11, fontWeight:600,
              cursor:"pointer", whiteSpace:"nowrap", flexShrink:0,
              transition:"all 0.15s", display:"inline-flex", alignItems:"center", gap:5,
            }}>{i===0 ? "Tutte" : catLabel(a)}<span style={{ opacity:0.55, fontWeight:500, fontSize:9.5 }}>{n}</span></button>
          );
        })}
      </div>

      {/* Contatore + paginazione top */}
      {(() => {
        const pagesN = Math.ceil(filtered.length / PER_PAGE_NOTIZIE);
        return (
          <div style={{ padding:"8px 16px 4px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, flexWrap:"wrap" }}>
            <span style={{ fontSize:11, color:"var(--eg-text-dim)" }}>
              {filtered.length} notizie{filtroNorma ? ` per ${filtroNorma.label}` : ""}
              {pagesN > 1 ? ` · pagina ${pageNotizie}/${pagesN}` : ""}
            </span>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              {pagesN > 1 && (
                <div style={{ display:"flex", gap:4, alignItems:"center" }}>
                  <button disabled={pageNotizie<=1} onClick={() => setPageNotizie(p=>p-1)} style={{ padding:"3px 10px", fontSize:11, borderRadius:4, background:"var(--eg-surface)", border:"1px solid var(--eg-border)", color: pageNotizie<=1 ? "var(--eg-text-dim)" : "var(--eg-text)", cursor: pageNotizie<=1 ? "default" : "pointer" }}>‹</button>
                  <span style={{ fontSize:11, color:"var(--eg-text-muted)" }}>{pageNotizie}/{pagesN}</span>
                  <button disabled={pageNotizie>=pagesN} onClick={() => setPageNotizie(p=>p+1)} style={{ padding:"3px 10px", fontSize:11, borderRadius:4, background:"var(--eg-surface)", border:"1px solid var(--eg-border)", color: pageNotizie>=pagesN ? "var(--eg-text-dim)" : "var(--eg-text)", cursor: pageNotizie>=pagesN ? "default" : "pointer" }}>›</button>
                </div>
              )}
              <span style={{ fontSize:11, color:"var(--eg-text-dim)" }}>Aggiornamento ogni 5 min</span>
            </div>
          </div>
        );
      })()}

      {isLoading ? (
        <div style={{ padding:"40px 20px", textAlign:"center", color:"var(--eg-text-muted)", fontSize:13 }}>
          {normaLoading ? "Ricerca notizie collegate..." : "Caricamento notizie..."}
        </div>
      ) : (
      <div className="news-grid" key={filtroNorma ? `norma-${filtroNorma.codice_id}-${filtroNorma.numero}` : `feed-${pageNotizie}`}>
        {(filtered || []).slice((pageNotizie-1)*PER_PAGE_NOTIZIE, pageNotizie*PER_PAGE_NOTIZIE).map((n, idx) => <NewsCard key={n.id || `n-${idx}`} item={n} onOpenArticolo={onOpenArticolo} />)}
      </div>
      )}
      {!isLoading && filtered.length === 0 && (
        <div style={{ padding:40, textAlign:"center", color:"var(--eg-text-muted)", fontSize:13 }}>
          {filtroNorma ? `Nessuna notizia collegata a ${filtroNorma.label}.` : "Nessuna notizia trovata."}
        </div>
      )}

      {/* Paginazione bottom */}
      {!isLoading && filtered.length > PER_PAGE_NOTIZIE && (() => {
        const pagesN = Math.ceil(filtered.length / PER_PAGE_NOTIZIE);
        return (
          <div style={{ padding:"8px 16px 12px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, flexWrap:"wrap" }}>
            <span style={{ fontSize:11, color:"var(--eg-text-dim)" }}>
              {filtered.length} notizie · pagina {pageNotizie}/{pagesN}
            </span>
            <div style={{ display:"flex", gap:4, alignItems:"center" }}>
              <button disabled={pageNotizie<=1} onClick={() => setPageNotizie(p=>p-1)} style={{ padding:"3px 10px", fontSize:11, borderRadius:4, background:"var(--eg-surface)", border:"1px solid var(--eg-border)", color: pageNotizie<=1 ? "var(--eg-text-dim)" : "var(--eg-text)", cursor: pageNotizie<=1 ? "default" : "pointer" }}>‹</button>
              <span style={{ fontSize:11, color:"var(--eg-text-muted)" }}>{pageNotizie}/{pagesN}</span>
              <button disabled={pageNotizie>=pagesN} onClick={() => setPageNotizie(p=>p+1)} style={{ padding:"3px 10px", fontSize:11, borderRadius:4, background:"var(--eg-surface)", border:"1px solid var(--eg-border)", color: pageNotizie>=pagesN ? "var(--eg-text-dim)" : "var(--eg-text)", cursor: pageNotizie>=pagesN ? "default" : "pointer" }}>›</button>
            </div>
          </div>
        );
      })()}

      <div style={{ height:20 }} />
    </div>
  );
}

// ─── PAGINA CASSAZIONE ──────────────────────────────────────────────────
// Filtri del feed Cassazione — corrispondono ai valori reali del corpus
// (settore civile/penale, sezione U = Sezioni Unite, L = Lavoro).
const CASS_SEZIONI = [
  { id:"", label:"Tutte" },
  { id:"ssuu", label:"Sezioni Unite" },
  { id:"civile", label:"Civile" },
  { id:"penale", label:"Penale" },
  { id:"lavoro", label:"Lavoro" },
];

// ── Archivio Sentenze SentenzeWeb ────────────────────────────────────────────
function PageSentenze() {
  // Archivio Giustizia Amministrativa (Consiglio di Stato / TAR) — 316.801 provvedimenti
  const accent = "#1a5fb4"; // blu istituzionale, distinto dal rosso Cassazione
  const PAGE = 50;
  const selStyle = { padding:"6px 10px", fontSize:11, borderRadius:6, border:"1px solid var(--eg-border)", background:"var(--eg-bg)", color:"var(--eg-text)", outline:"none", cursor:"pointer" };

  const [stats, setStats]     = useState(null);
  const [items, setItems]     = useState([]);
  const [total, setTotal]     = useState(0);
  const [offset, setOffset]   = useState(0);
  const [loading, setLoading] = useState(false);
  const [initial, setInitial] = useState(true);
  const [anno, setAnno]       = useState("");
  const [tipo, setTipo]       = useState("");
  const [sede, setSede]       = useState("");
  const [q, setQ]             = useState("");
  const [qInput, setQInput]   = useState("");
  const sentinelRef = useRef(null);
  const loadingRef  = useRef(false);

  const fmt = (n) => (n || 0).toLocaleString("it-IT");
  const buildParams = (off) => {
    const p = new URLSearchParams();
    p.set("limit", String(PAGE));
    p.set("offset", String(off));
    if (anno) p.set("anno", anno);
    if (tipo) p.set("tipo", tipo);
    if (sede) p.set("sede", sede);
    if (q)    p.set("q", q);
    return p.toString();
  };

  // Faccette (una volta)
  useEffect(() => {
    fetch(API + "/api/archivio/stats").then(r => r.json()).then(d => { if (d && d.ok) setStats(d); }).catch(() => {});
  }, []);

  // Reset + primo blocco al cambio filtri/ricerca
  useEffect(() => {
    let cancelled = false;
    setInitial(true); setLoading(true); loadingRef.current = true;
    fetch(API + "/api/archivio/provvedimenti?" + buildParams(0))
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        const list = (d && d.provvedimenti) || [];
        setItems(list); setTotal((d && d.total) || 0); setOffset(list.length);
        setLoading(false); setInitial(false); loadingRef.current = false;
      })
      .catch(() => { if (!cancelled) { setLoading(false); setInitial(false); loadingRef.current = false; } });
    return () => { cancelled = true; };
  }, [anno, tipo, sede, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = React.useCallback(() => {
    if (loadingRef.current) return;
    setItems(prev => {
      if (prev.length >= total) return prev;
      loadingRef.current = true; setLoading(true);
      fetch(API + "/api/archivio/provvedimenti?" + buildParams(prev.length))
        .then(r => r.json())
        .then(d => {
          const more = (d && d.provvedimenti) || [];
          setItems(cur => [...cur, ...more]);
          setOffset(cur => cur + more.length);
          setLoading(false); loadingRef.current = false;
        })
        .catch(() => { setLoading(false); loadingRef.current = false; });
      return prev;
    });
  }, [total, anno, tipo, sede, q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll infinito
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) loadMore(); }, { rootMargin: "400px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  const submitSearch = (e) => { e.preventDefault(); setQ(qInput.trim()); };
  const filtered = !!(anno || tipo || sede || q);

  return (
    <div>
      {/* Header */}
      <div style={{ padding:"20px 16px 14px", borderBottom:"1px solid var(--eg-border)", background:"var(--eg-surface)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/></svg>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:"var(--eg-text)", letterSpacing:"-0.01em" }}>Archivio Giustizia Amministrativa</div>
            <div style={{ fontSize:11, color:"var(--eg-text-muted)" }}>Consiglio di Stato · TAR — provvedimenti integrali</div>
          </div>
        </div>
        <div style={{ fontSize:13, color:accent, fontWeight:800, margin:"8px 0 12px" }}>
          {fmt(stats ? stats.total : total)} provvedimenti nell'archivio
        </div>
        {/* Ricerca */}
        <form onSubmit={submitSearch} style={{ display:"flex", gap:6, marginBottom:10 }}>
          <input value={qInput} onChange={e => setQInput(e.target.value)} placeholder="Cerca per numero o ECLI…"
            style={{ flex:1, padding:"8px 12px", fontSize:12, borderRadius:6, border:"1px solid var(--eg-border)", background:"var(--eg-bg)", color:"var(--eg-text)", outline:"none" }}
            onFocus={e => e.target.style.borderColor = accent} onBlur={e => e.target.style.borderColor = "var(--eg-border)"} />
          <button type="submit" style={{ padding:"8px 16px", fontSize:11, fontWeight:700, borderRadius:6, background:accent, color:"#fff", border:"none", cursor:"pointer" }}>Cerca</button>
          {q && <button type="button" onClick={() => { setQ(""); setQInput(""); }} style={{ padding:"8px 12px", fontSize:11, borderRadius:6, background:"var(--eg-surface)", border:"1px solid var(--eg-border)", color:"var(--eg-text-muted)", cursor:"pointer" }}>✕</button>}
        </form>
        {/* Filtri */}
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <select value={anno} onChange={e => setAnno(e.target.value)} style={selStyle}>
            <option value="">Tutti gli anni</option>
            {(stats?.per_anno || []).map(a => <option key={a.anno} value={a.anno}>{a.anno} ({fmt(a.n)})</option>)}
          </select>
          <select value={tipo} onChange={e => setTipo(e.target.value)} style={selStyle}>
            <option value="">Tutti i tipi</option>
            {(stats?.per_tipo || []).map(t => <option key={t.tipo} value={t.tipo}>{t.tipo} ({fmt(t.n)})</option>)}
          </select>
          <select value={sede} onChange={e => setSede(e.target.value)} style={selStyle}>
            <option value="">Tutte le sedi</option>
            {(stats?.per_sede || []).map(s => <option key={s.sede} value={s.sede}>{s.sede} ({fmt(s.n)})</option>)}
          </select>
        </div>
      </div>

      {/* Contatore risultati */}
      <div style={{ padding:"8px 16px 2px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontSize:11, color:"var(--eg-text-dim)" }}>{fmt(total)} risultati{filtered ? " (filtrati)" : ""}</span>
        <span style={{ fontSize:11, color:"var(--eg-text-dim)" }}>Fonte: giustizia-amministrativa.it</span>
      </div>

      {/* Lista */}
      <div style={{ padding:"8px 12px" }}>
        {items.map((p, i) => (
          <div key={p.id || i} style={{ padding:"12px 14px", marginBottom:8, borderRadius:8, background:"var(--eg-surface)", border:"1px solid var(--eg-border)", transition:"border-color 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = accent + "70"} onMouseLeave={e => e.currentTarget.style.borderColor = "var(--eg-border)"}>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6, flexWrap:"wrap" }}>
              <span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", color:accent, background:accent + "18", padding:"2px 7px", borderRadius:3, border:`1px solid ${accent}28`, whiteSpace:"nowrap" }}>{p.tipo || "Provvedimento"}</span>
              {p.sezione && <span style={{ fontSize:10, color:"var(--eg-text-muted)", fontWeight:600 }}>{p.sezione}</span>}
              <span style={{ fontSize:11, color:"var(--eg-text-dim)", marginLeft:"auto" }}>{p.anno}</span>
            </div>
            <div style={{ fontSize:14, color:"var(--eg-text)", fontWeight:600, lineHeight:1.5 }}>n. {p.numero}/{p.anno} — {p.sede}</div>
            {p.ecli && <div style={{ fontSize:10.5, color:"var(--eg-text-muted)", marginTop:3, fontFamily:"monospace", wordBreak:"break-all" }}>{p.ecli}</div>}
            {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ display:"inline-block", marginTop:8, fontSize:11, color:accent, fontWeight:600, textDecoration:"none" }}>Apri sul sito ufficiale →</a>}
          </div>
        ))}
      </div>

      {initial && <div style={{ padding:"40px 20px", textAlign:"center", color:"var(--eg-text-muted)", fontSize:13 }}>Caricamento archivio…</div>}
      {!initial && items.length === 0 && <div style={{ padding:"40px 20px", textAlign:"center", color:"var(--eg-text-muted)", fontSize:13 }}>Nessun provvedimento trovato.</div>}

      {/* Scroll infinito + bottone */}
      {items.length < total && (
        <div ref={sentinelRef} style={{ padding:"16px", textAlign:"center" }}>
          <button onClick={loadMore} disabled={loading} style={{ padding:"10px 22px", fontSize:12, fontWeight:700, borderRadius:8, background:loading ? "var(--eg-surface)" : accent, color:loading ? "var(--eg-text-muted)" : "#fff", border:loading ? "1px solid var(--eg-border)" : "none", cursor:loading ? "default" : "pointer" }}>
            {loading ? "Caricamento…" : `Carica altri ${Math.min(PAGE, total - items.length)}`}
          </button>
        </div>
      )}
      <div style={{ height:20 }} />
    </div>
  );
}

// ── Archivio Cassazione (CORPUS testo integrale da SentenzeWeb) ──────────────
function ArchivioCassazioneCorpus() {
  const accent = "#8B1A1A"; // rosso Cassazione
  const PAGE = 20;
  const selStyle = { padding:"6px 10px", fontSize:11, borderRadius:6, border:"1px solid var(--eg-border)", background:"var(--eg-bg)", color:"var(--eg-text)", outline:"none", cursor:"pointer" };

  const [stats, setStats]     = useState(null);
  const [items, setItems]     = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [initial, setInitial] = useState(true);
  const [settore, setSettore] = useState("");
  const [anno, setAnno]       = useState("");
  const [q, setQ]             = useState("");
  const [qInput, setQInput]   = useState("");
  const sentinelRef = useRef(null);
  const loadingRef  = useRef(false);

  const fmt = (n) => (n || 0).toLocaleString("it-IT");
  const buildParams = (off) => {
    const p = new URLSearchParams();
    p.set("limit", String(PAGE));
    p.set("offset", String(off));
    if (settore) p.set("settore", settore);
    if (anno)    p.set("anno", anno);
    if (q)       p.set("q", q);
    return p.toString();
  };

  // Anni distinti dallo stats (somma civ+pen)
  const anniStats = React.useMemo(() => {
    const m = {};
    (stats?.per_anno || []).forEach(r => { m[r.anno] = (m[r.anno] || 0) + r.n; });
    return Object.keys(m).sort((a,b) => b - a).map(a => ({ anno:a, n:m[a] }));
  }, [stats]);

  useEffect(() => {
    fetch(API + "/api/cassazione/corpus/stats").then(r => r.json()).then(d => { if (d && d.ok) setStats(d); }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setInitial(true); setLoading(true); loadingRef.current = true;
    fetch(API + "/api/cassazione/corpus/search?" + buildParams(0))
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        const list = (d && d.results) || [];
        setItems(list); setTotal((d && d.total) || 0);
        setLoading(false); setInitial(false); loadingRef.current = false;
      })
      .catch(() => { if (!cancelled) { setLoading(false); setInitial(false); loadingRef.current = false; } });
    return () => { cancelled = true; };
  }, [settore, anno, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = React.useCallback(() => {
    if (loadingRef.current) return;
    setItems(prev => {
      if (prev.length >= total) return prev;
      loadingRef.current = true; setLoading(true);
      fetch(API + "/api/cassazione/corpus/search?" + buildParams(prev.length))
        .then(r => r.json())
        .then(d => {
          const more = (d && d.results) || [];
          setItems(cur => [...cur, ...more]);
          setLoading(false); loadingRef.current = false;
        })
        .catch(() => { setLoading(false); loadingRef.current = false; });
      return prev;
    });
  }, [total, settore, anno, q]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) loadMore(); }, { rootMargin: "400px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  const submitSearch = (e) => { e.preventDefault(); setQ(qInput.trim()); };
  const filtered = !!(settore || anno || q);

  // Snippet FTS con <mark> — sanificato (XSS-safe): escape totale, poi ri-abilita solo <mark>
  const renderSnippet = (s) => {
    const esc = (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return esc.replace(/&lt;mark&gt;/g, '<mark style="background:#8B1A1A22;color:inherit;padding:0 1px;border-radius:2px">').replace(/&lt;\/mark&gt;/g, "</mark>");
  };
  const sezLabel = (s) => (s === "U" ? "Sez. Unite" : s === "L" ? "Sez. Lavoro" : s === "F" ? "Sez. Feriale" : s ? "Sez. " + s : "");

  return (
    <div>
      {/* Header */}
      <div style={{ padding:"20px 16px 14px", borderBottom:"1px solid var(--eg-border)", background:"var(--eg-surface)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:"var(--eg-text)", letterSpacing:"-0.01em" }}>Archivio Cassazione</div>
            <div style={{ fontSize:11, color:"var(--eg-text-muted)" }}>Sentenze e ordinanze integrali · civile e penale</div>
          </div>
        </div>
        <div style={{ fontSize:13, color:accent, fontWeight:800, margin:"8px 0 12px" }}>
          {fmt(stats ? stats.totale : total)} provvedimenti nel corpus
        </div>
        {/* Ricerca full-text */}
        <form onSubmit={submitSearch} style={{ display:"flex", gap:6, marginBottom:10 }}>
          <input value={qInput} onChange={e => setQInput(e.target.value)} placeholder="Cerca nel testo integrale (es. risarcimento)…"
            style={{ flex:1, padding:"8px 12px", fontSize:12, borderRadius:6, border:"1px solid var(--eg-border)", background:"var(--eg-bg)", color:"var(--eg-text)", outline:"none" }}
            onFocus={e => e.target.style.borderColor = accent} onBlur={e => e.target.style.borderColor = "var(--eg-border)"} />
          <button type="submit" style={{ padding:"8px 16px", fontSize:11, fontWeight:700, borderRadius:6, background:accent, color:"#fff", border:"none", cursor:"pointer" }}>Cerca</button>
          {q && <button type="button" onClick={() => { setQ(""); setQInput(""); }} style={{ padding:"8px 12px", fontSize:11, borderRadius:6, background:"var(--eg-surface)", border:"1px solid var(--eg-border)", color:"var(--eg-text-muted)", cursor:"pointer" }}>✕</button>}
        </form>
        {/* Filtri */}
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <select value={settore} onChange={e => setSettore(e.target.value)} style={selStyle}>
            <option value="">Civile + Penale</option>
            {(stats?.per_settore || []).map(s => <option key={s.settore} value={s.settore}>{s.settore === "civile" ? "Civile" : "Penale"} ({fmt(s.n)})</option>)}
          </select>
          <select value={anno} onChange={e => setAnno(e.target.value)} style={selStyle}>
            <option value="">Tutti gli anni</option>
            {anniStats.map(a => <option key={a.anno} value={a.anno}>{a.anno} ({fmt(a.n)})</option>)}
          </select>
        </div>
      </div>

      {/* Contatore risultati */}
      <div style={{ padding:"8px 16px 2px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontSize:11, color:"var(--eg-text-dim)" }}>{fmt(total)} risultati{filtered ? " (filtrati)" : ""}</span>
        <span style={{ fontSize:11, color:"var(--eg-text-dim)" }}>Fonte: italgiure.giustizia.it</span>
      </div>

      {/* Lista */}
      <div style={{ padding:"8px 12px" }}>
        {items.map((p, i) => (
          <div key={p.id || i} style={{ padding:"12px 14px", marginBottom:8, borderRadius:8, background:"var(--eg-surface)", border:"1px solid var(--eg-border)", transition:"border-color 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = accent + "70"} onMouseLeave={e => e.currentTarget.style.borderColor = "var(--eg-border)"}>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6, flexWrap:"wrap" }}>
              <span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", color:accent, background:accent + "18", padding:"2px 7px", borderRadius:3, border:`1px solid ${accent}28`, whiteSpace:"nowrap" }}>{p.tipo_atto || "Provvedimento"}</span>
              <span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em", color:p.settore === "penale" ? "#C45C5C" : "#5B9BD5" }}>{p.settore}</span>
              {p.sezione && <span style={{ fontSize:10, color:"var(--eg-text-muted)", fontWeight:600 }}>{sezLabel(p.sezione)}</span>}
              <span style={{ fontSize:11, color:"var(--eg-text-dim)", marginLeft:"auto" }}>{p.data_deposito || p.anno}</span>
            </div>
            <div style={{ fontSize:14, color:"var(--eg-text)", fontWeight:600, lineHeight:1.5 }}>Cass. {p.settore === "penale" ? "pen." : "civ."} n. {p.numero}/{p.anno}</div>
            {(p.presidente || p.relatore) && <div style={{ fontSize:10.5, color:"var(--eg-text-muted)", marginTop:2 }}>{p.presidente ? "Pres. " + p.presidente : ""}{p.presidente && p.relatore ? " · " : ""}{p.relatore ? "Rel. " + p.relatore : ""}</div>}
            {p.snippet && <div style={{ fontSize:12, color:"var(--eg-text-muted)", marginTop:6, lineHeight:1.55 }} dangerouslySetInnerHTML={{ __html: renderSnippet(p.snippet) }} />}
            {p.ecli && <div style={{ fontSize:10.5, color:"var(--eg-text-muted)", marginTop:5, fontFamily:"monospace", wordBreak:"break-all" }}>{p.ecli}</div>}
            {p.url_fonte && <a href={p.url_fonte} target="_blank" rel="noopener noreferrer" style={{ display:"inline-block", marginTop:8, fontSize:11, color:accent, fontWeight:600, textDecoration:"none" }}>Apri l'atto originale su SentenzeWeb →</a>}
          </div>
        ))}
      </div>

      {initial && <div style={{ padding:"40px 20px", textAlign:"center", color:"var(--eg-text-muted)", fontSize:13 }}>Caricamento archivio…</div>}
      {!initial && items.length === 0 && <div style={{ padding:"40px 20px", textAlign:"center", color:"var(--eg-text-muted)", fontSize:13 }}>
        {total === 0 && !filtered ? "Archivio in costruzione — nessun provvedimento ancora indicizzato." : "Nessun provvedimento trovato."}
      </div>}

      {items.length < total && (
        <div ref={sentinelRef} style={{ padding:"16px", textAlign:"center" }}>
          <button onClick={loadMore} disabled={loading} style={{ padding:"10px 22px", fontSize:12, fontWeight:700, borderRadius:8, background:loading ? "var(--eg-surface)" : accent, color:loading ? "var(--eg-text-muted)" : "#fff", border:loading ? "1px solid var(--eg-border)" : "none", cursor:loading ? "default" : "pointer" }}>
            {loading ? "Caricamento…" : `Carica altri ${Math.min(PAGE, total - items.length)}`}
          </button>
        </div>
      )}
      <div style={{ height:20 }} />
    </div>
  );
}

function PageCassazione({ onOpenArticolo }) {
  const [subTab, setSubTab] = useState("notizie"); // "notizie" | "archivio" | "corpus"
  const cassColor = "#8B1A1A";

  // ── FEED NOTIZIE state (hooks always called, regardless of subTab) ────────
  const NOTIZIE_PAGE = 50;
  const [notizie, setNotizie] = useState([]);
  const [notTotal, setNotTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sezione, setSezione] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const notSentinelRef = useRef(null);
  const notLoadingRef = useRef(false);

  // Elenco e ricerca leggono entrambi il corpus (data/cassazione-corpus.db):
  // /provvedimenti per la lista filtrata, /search per la FTS5 sul testo integrale.
  // Stesso shape di risposta ⇒ stessa paginazione nei due casi.
  const buildParams = React.useCallback((offset) => {
    const params = new URLSearchParams();
    if (sezione) params.set("sezione", sezione);
    if (search) params.set("q", search);
    params.set("limit", String(NOTIZIE_PAGE)); params.set("offset", String(offset));
    return (search ? "/api/cassazione/search?" : "/api/cassazione/provvedimenti?") + params.toString();
  }, [sezione, search]);

  useEffect(() => {
    setLoading(true); notLoadingRef.current = true;
    let cancelled = false;
    fetch(API + buildParams(0))
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        const list = d.notizie || d.results || [];
        setNotizie(list); setNotTotal(d.total || list.length);
        setLoading(false); notLoadingRef.current = false;
      })
      .catch(() => { if (!cancelled) { setLoading(false); notLoadingRef.current = false; } });
    return () => { cancelled = true; };
  }, [buildParams]);

  const loadMoreNotizie = React.useCallback(() => {
    if (notLoadingRef.current) return;
    setNotizie(prev => {
      if (prev.length >= notTotal) return prev;
      notLoadingRef.current = true; setLoadingMore(true);
      fetch(API + buildParams(prev.length))
        .then(r => r.json())
        .then(d => { setNotizie(cur => [...cur, ...(d.notizie || d.results || [])]); setLoadingMore(false); notLoadingRef.current = false; })
        .catch(() => { setLoadingMore(false); notLoadingRef.current = false; });
      return prev;
    });
  }, [buildParams, notTotal]);

  useEffect(() => {
    const el = notSentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) loadMoreNotizie(); }, { rootMargin: "400px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMoreNotizie]);

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  };

  // Il click apre il PannelloSentenza globale (scheda + testo integrale dal corpus),
  // non il reader delle notizie: questi item sono provvedimenti, non articoli.
  const apriProvvedimento = React.useCallback((n) => {
    const id = n.sentenza_id || n.id;
    if (!id) return;
    document.dispatchEvent(new CustomEvent("eg:showSentenzaPanel", { detail: { id, url: n.url || n.link || null } }));
  }, []);

  // On-mount + listener: cerca sentenze Cassazione per norma (da popup norma)
  const applySearchQuery = React.useCallback((q) => {
    // Il feed cerca nel corpus: la ricerca per norma resta sulla scheda principale.
    setSearchInput(q); setSearch(q); setSubTab('notizie');
  }, []);

  useEffect(() => {
    const pending = window.__pendingSearch;
    if (pending?.target === 'cassazione' && pending?.query) {
      window.__pendingSearch = null;
      applySearchQuery(pending.query);
    }
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.target !== 'cassazione') return;
      const qv = e.detail?.query || '';
      if (qv) applySearchQuery(qv);
    };
    document.addEventListener('eg:searchQuery', handler);
    return () => document.removeEventListener('eg:searchQuery', handler);
  }, [applySearchQuery]);

  // Quando una ricerca full-text arriva dalla topbar (target:'sentenze'), attiva il subTab fulltext
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.target !== 'sentenze') return;
      setSubTab('fulltext');
    };
    document.addEventListener('eg:searchQuery', handler);
    return () => document.removeEventListener('eg:searchQuery', handler);
  }, []);

  // Drain window.__pendingSentenza quando la tab Cassazione viene attivata (da Grafo)
  useEffect(() => {
    const handler = () => {
      const id = window.__pendingSentenza;
      if (!id) return;
      window.__pendingSentenza = null;
      const url = window.__pendingSentenzaUrl || null;
      window.__pendingSentenzaUrl = null;
      setSubTab('notizie');
      // Apri il pannello globale dopo che il subTab si è aggiornato
      setTimeout(() => document.dispatchEvent(new CustomEvent('eg:showSentenzaPanel', { detail: { id, url } })), 50);
    };
    document.addEventListener('eg:cassazioneActivated', handler);
    return () => document.removeEventListener('eg:cassazioneActivated', handler);
  }, []);

  // subTab switcher (nel JSX, non come early return per rispettare hooks rules)
  const SubTabSwitcher = () => (
    <div style={{ display:"flex", borderBottom:"1px solid var(--eg-border)", background:"var(--eg-surface)" }}>
      {[{id:"notizie",label:"Feed notizie"},{id:"corpus",label:"Archivio Cassazione"},{id:"archivio",label:"Archivio Giust. Amm."}].map(t => (
        <button key={t.id} onClick={() => setSubTab(t.id)} style={{
          flex:1, padding:"10px 6px", fontSize:11, fontWeight:600, cursor:"pointer",
          background:"none", border:"none",
          borderBottom: subTab===t.id ? `2px solid ${cassColor}` : "2px solid transparent",
          color: subTab===t.id ? cassColor : "var(--eg-text-muted)",
          transition:"all 0.15s",
        }}>{t.label}</button>
      ))}
    </div>
  );

  if (subTab === "corpus") {
    return (
      <div>
        <SubTabSwitcher />
        <ArchivioCassazioneCorpus />
      </div>
    );
  }

  if (subTab === "archivio") {
    return (
      <div>
        <SubTabSwitcher />
        <PageSentenze />
      </div>
    );
  }

  return (
    <div>
      <SubTabSwitcher />
      {/* Header */}
      <div style={{ padding:"20px 16px 14px", borderBottom:"1px solid var(--eg-border)", background:"var(--eg-surface)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={cassColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:"var(--eg-text)", letterSpacing:"-0.01em" }}>Corte di Cassazione</div>
            <div style={{ fontSize:11, color:"var(--eg-text-muted)" }}>Sentenze e ordinanze depositate · testo integrale</div>
          </div>
        </div>
        {/* Ricerca */}
        <form onSubmit={handleSearch} style={{ display:"flex", gap:6, marginBottom:10 }}>
          <input
            value={searchInput} onChange={e => setSearchInput(e.target.value)}
            placeholder="Cerca nel testo integrale dei provvedimenti..."
            style={{
              flex:1, padding:"8px 12px", fontSize:12, borderRadius:6,
              border:"1px solid var(--eg-border)", background:"var(--eg-bg)",
              color:"var(--eg-text)", outline:"none",
            }}
            onFocus={e => e.target.style.borderColor = cassColor}
            onBlur={e => e.target.style.borderColor = "var(--eg-border)"}
          />
          <button type="submit" style={{
            padding:"8px 16px", fontSize:11, fontWeight:700, borderRadius:6,
            background:cassColor, color:"#fff", border:"none", cursor:"pointer",
          }}>Cerca</button>
          {search && <button type="button" onClick={() => { setSearch(""); setSearchInput(""); }} style={{
            padding:"8px 12px", fontSize:11, borderRadius:6, background:"var(--eg-surface)",
            border:"1px solid var(--eg-border)", color:"var(--eg-text-muted)", cursor:"pointer",
          }}>✕</button>}
        </form>
        {/* Filtri sezione */}
        <div style={{ display:"flex", gap:6, overflowX:"auto", scrollbarWidth:"none" }}>
          {CASS_SEZIONI.map(s => {
            const isActive = sezione === s.id;
            return (
              <button key={s.id} onClick={() => setSezione(s.id)} style={{
                background: isActive ? cassColor+"22" : "var(--eg-bg)",
                border: `1px solid ${isActive ? cassColor : "var(--eg-border)"}`,
                color: isActive ? cassColor : "var(--eg-text-muted)",
                borderRadius:20, padding:"5px 14px", fontSize:11, fontWeight:600,
                cursor:"pointer", whiteSpace:"nowrap", flexShrink:0,
                transition:"all 0.15s",
              }}>{s.label}</button>
            );
          })}
        </div>
      </div>

      {/* Contatore */}
      <div style={{ padding:"8px 16px 2px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontSize:11, color:"var(--eg-text-dim)" }}>{notTotal.toLocaleString("it-IT")} provvedimenti{search ? ` per "${search}"` : ""}</span>
        <span style={{ fontSize:11, color:"var(--eg-text-dim)" }}>Fonte: italgiure.giustizia.it</span>
      </div>

      {loading && (
        <div style={{ padding:"40px 20px", textAlign:"center", color:"var(--eg-text-muted)", fontSize:13 }}>
          Caricamento provvedimenti...
        </div>
      )}

      {/* Lista provvedimenti */}
      <div style={{ padding:"8px 12px" }}>
        {(notizie || []).map((n, i) => {
          const areaColor = AREA_COLORS[n.category] || cassColor;
          const sezioneTag = n.sezione || "";
          return (
            <div key={n.id || i} style={{
              padding:"14px 16px", marginBottom:8, borderRadius:8,
              background:"var(--eg-surface)", border:"1px solid var(--eg-border)",
              transition:"border-color 0.15s",
            }}
              onMouseEnter={e => e.currentTarget.style.borderColor = cassColor+"70"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "var(--eg-border)"}
            >
              {/* Meta */}
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8, flexWrap:"wrap" }}>
                {sezioneTag && (
                  <span style={{
                    fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em",
                    color:areaColor, background:areaColor+"18", padding:"2px 7px", borderRadius:3,
                    border:`1px solid ${areaColor}28`, whiteSpace:"nowrap",
                  }}>{sezioneTag}</span>
                )}
                {n.tipo_atto && (
                  <span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", color:"var(--eg-text-muted)" }}>
                    {n.tipo_atto}
                  </span>
                )}
                {n.numero_sentenza && (
                  <span style={{ fontSize:10, color:"var(--eg-text-muted)", fontWeight:600 }}>
                    n. {n.numero_sentenza}
                  </span>
                )}
                <span style={{ fontSize:11, color:"var(--eg-text-muted)" }}>{n.source || n.source_name || "Cassazione"}</span>
                <span style={{ fontSize:11, color:"var(--eg-text-dim)", marginLeft:"auto" }}>
                  {n.date || n.published_at ? new Date(n.date || n.published_at).toLocaleDateString("it-IT") : ""}
                </span>
              </div>
              {/* Titolo — apre il pannello del provvedimento */}
              <div onClick={() => apriProvvedimento(n)} style={{ cursor:"pointer", marginBottom:6 }}>
                <div style={{ fontSize:14, color:"var(--eg-text)", lineHeight:1.5, fontWeight:600 }}
                  onMouseEnter={e => e.currentTarget.style.color = cassColor}
                  onMouseLeave={e => e.currentTarget.style.color = "var(--eg-text)"}
                >{n.title}</div>
              </div>
              {/* Snippet / massima */}
              {(n.snippet || n.desc) && (
                <div style={{ fontSize:12, color:"var(--eg-text-muted)", lineHeight:1.6, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:3, WebkitBoxOrient:"vertical" }}>
                  {cleanHTML(n.snippet || n.desc)}
                </div>
              )}
              {/* Azioni */}
              <div style={{ marginTop:8, display:"flex", alignItems:"center", gap:10 }}>
                <div onClick={() => apriProvvedimento(n)} style={{
                  fontSize:11, color:cassColor, fontWeight:600, cursor:"pointer",
                  display:"flex", alignItems:"center", gap:4,
                }}>
                  <span>▤</span> Leggi il testo integrale
                </div>
                {(n.url || n.link) && (
                  <a href={n.url || n.link} target="_blank" rel="noopener noreferrer" style={{
                    fontSize:10, color:"var(--eg-text-dim)", textDecoration:"none",
                  }}>fonte originale ↗</a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!loading && notizie.length === 0 && (
        <div style={{ padding:40, textAlign:"center", color:"var(--eg-text-muted)", fontSize:13 }}>
          {search ? `Nessun provvedimento trovato per "${search}".` : "Corpus in costruzione — nessun provvedimento ancora indicizzato."}
        </div>
      )}

      {/* Scroll infinito + bottone (attivo anche sui risultati di ricerca) */}
      {notizie.length > 0 && notizie.length < notTotal && (
        <div ref={notSentinelRef} style={{ padding:"16px", textAlign:"center" }}>
          <button onClick={loadMoreNotizie} disabled={loadingMore} style={{ padding:"10px 22px", fontSize:12, fontWeight:700, borderRadius:8, background:loadingMore ? "var(--eg-surface)" : cassColor, color:loadingMore ? "var(--eg-text-muted)" : "#fff", border:loadingMore ? "1px solid var(--eg-border)" : "none", cursor:loadingMore ? "default" : "pointer" }}>
            {loadingMore ? "Caricamento…" : `Carica altri ${Math.min(NOTIZIE_PAGE, notTotal - notizie.length)}`}
          </button>
        </div>
      )}
      <div style={{ height:20 }} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// PAGE EUR-LEX — Normativa Europea
// ════════════════════════════════════════════════════════════════════

function PannelloEurLex({ celex, onClose }) {
  const EU_COLOR = "#1a5fb4";
  const C = COLORS;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!celex) return;
    setLoading(true); setErr(null); setData(null);
    fetch(API + '/api/eurlex/atto/' + encodeURIComponent(celex))
      .then(r => r.json())
      .then(d => {
        if (d.ok) setData(d.atto);
        else setErr(d.error || 'Atto non trovato');
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [celex]);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const a = data || {};
  const tipoColor = a.tipo === 'R' ? '#1a5fb4' : a.tipo === 'L' ? '#2a9d3c' : a.tipo === 'D' ? '#C87C20' : '#555';
  const eurlexUrl = a.url_eurlex || (celex ? `https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:${celex}` : null);

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:9000, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
      <div onClick={e => e.stopPropagation()} style={{
        width:'100%', maxWidth:780, maxHeight:'92vh', display:'flex', flexDirection:'column',
        background:C.bg, borderRadius:'12px 12px 0 0',
        border:'1px solid '+C.border, borderBottom:'none',
        boxShadow:'0 -8px 40px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'1px solid '+C.border, background:C.surface, borderRadius:'12px 12px 0 0', flexShrink:0 }}>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:EU_COLOR }}>
              {loading ? 'Caricamento…' : a.tipo_label ? `${a.tipo_label} — ${celex}` : celex}
            </div>
            {!loading && a.anno && (
              <div style={{ fontSize:10, color:C.textDim, marginTop:2 }}>
                Anno: {a.anno}{a.istituzione ? ` · Istituzione: ${a.istituzione}` : ''}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:C.textDim, padding:'0 4px', lineHeight:1 }}>✕</button>
        </div>

        {loading && <div style={{ textAlign:'center', color:C.textMuted, padding:40, fontSize:13 }}>Caricamento atto EUR-Lex…</div>}
        {err && <div style={{ color:'#C45C5C', fontSize:13, padding:20 }}>Errore: {err}</div>}

        {data && (
          <div style={{ overflowY:'auto', flex:1, padding:'16px 18px' }}>
            {/* Badge tipo + CELEX */}
            <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:14, alignItems:'center' }}>
              <span style={{
                fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:4,
                background: tipoColor + '22', color: tipoColor,
                border: `1px solid ${tipoColor}44`,
              }}>{a.tipo_label || a.tipo || 'Atto UE'}</span>
              <span style={{ fontSize:11, fontWeight:700, color:C.textMuted, fontFamily:'monospace' }}>{celex}</span>
              {a.anno && <span style={{ fontSize:11, color:C.textDim }}>{a.anno}</span>}
              {a.in_vigore === 1 && <span style={{ fontSize:10, padding:'2px 7px', borderRadius:3, background:'#2a9d3c22', color:'#2a9d3c', border:'1px solid #2a9d3c44', fontWeight:700 }}>In vigore</span>}
              {a.in_vigore === 0 && <span style={{ fontSize:10, padding:'2px 7px', borderRadius:3, background:'#C45C5C22', color:'#C45C5C', border:'1px solid #C45C5C44', fontWeight:700 }}>Non in vigore</span>}
            </div>

            {/* Titolo IT */}
            {(a.titolo_it || a.titolo) && (
              <div style={{ marginBottom:14, borderLeft:'3px solid '+EU_COLOR, paddingLeft:12 }}>
                <div style={{ fontSize:10, fontWeight:700, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>Titolo</div>
                <div style={{ fontSize:13, color:C.text, lineHeight:1.6 }}>{a.titolo_it || a.titolo}</div>
                {a.titolo_it && a.titolo && a.titolo_it !== a.titolo && (
                  <div style={{ fontSize:11, color:C.textDim, marginTop:4, fontStyle:'italic' }}>{a.titolo}</div>
                )}
              </div>
            )}

            {/* ELI */}
            {a.eli && (
              <div style={{ marginBottom:10, fontSize:11, color:C.textDim }}>
                <strong>ELI:</strong> <span style={{ fontFamily:'monospace' }}>{a.eli}</span>
              </div>
            )}

            {/* Data documento */}
            {a.data_documento && (
              <div style={{ marginBottom:10, fontSize:11, color:C.textDim }}>
                <strong>Data:</strong> {a.data_documento}
              </div>
            )}

            {/* Link EUR-Lex */}
            {eurlexUrl && (
              <div style={{ marginBottom:14 }}>
                <a href={eurlexUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize:12, color:EU_COLOR, fontWeight:600, textDecoration:'none', display:'inline-flex', alignItems:'center', gap:5 }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  Apri su EUR-Lex
                </a>
              </div>
            )}

            {/* Testo estratto */}
            {a.testo_estratto && (
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:10, fontWeight:700, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>Testo estratto</div>
                <div style={{ fontSize:12, color:C.textMuted, lineHeight:1.8, whiteSpace:'pre-wrap', maxHeight:400, overflowY:'auto', padding:'10px 14px', background:C.surface, borderRadius:6, border:'1px solid '+C.border }}>
                  {a.testo_estratto}
                </div>
              </div>
            )}

            {/* Footer */}
            <div style={{ paddingTop:12, borderTop:'1px solid '+C.border, marginTop:8 }}>
              <button onClick={onClose} style={{ fontSize:11, fontWeight:600, padding:'6px 14px', borderRadius:5, background:C.surface, border:'1px solid '+C.border, color:C.textMuted, cursor:'pointer' }}>Chiudi</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PageEurLex() {
  const EU_COLOR = "#1a5fb4";
  const [stats, setStats] = useState(null);
  const [risultati, setRisultati] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totale, setTotale] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState('');
  const [anno, setAnno] = useState('');
  const [pannello, setPannello] = useState(null); // celex

  // Carica stats
  useEffect(() => {
    fetch(API + '/api/eurlex/stats')
      .then(r => r.json())
      .then(d => { if (d.ok) setStats(d); })
      .catch(() => {});
  }, []);

  // Carica atti
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q)    params.set('q', q);
    if (tipo) params.set('tipo', tipo);
    if (anno) params.set('anno', anno);
    params.set('page', page);
    params.set('limit', '20');
    fetch(API + '/api/eurlex/search?' + params.toString())
      .then(r => r.json())
      .then(d => {
        setRisultati(d.risultati || []);
        setTotale(d.totale || 0);
        setPages(d.pagine || 1);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [q, tipo, anno, page]);

  const handleSearch = e => { e.preventDefault(); setQ(qInput.trim()); setPage(1); };
  const resetFiltri = () => { setQ(''); setQInput(''); setTipo(''); setAnno(''); setPage(1); };
  const hasFiltri = q || tipo || anno;

  const anniOptions = [];
  for (let y = 2026; y >= 2000; y--) anniOptions.push(y);

  const badgeColor = t => t === 'R' ? '#1a5fb4' : t === 'L' ? '#2a9d3c' : t === 'D' ? '#C87C20' : '#555';

  // Stats bar: Regolamenti / Direttive / Decisioni
  const statsRegolamenti = stats ? (stats.per_tipo || []).find(x => x.tipo === 'R') : null;
  const statsDirettive   = stats ? (stats.per_tipo || []).find(x => x.tipo === 'L') : null;
  const statsDecisioni   = stats ? (stats.per_tipo || []).find(x => x.tipo === 'D') : null;

  const Paginazione = () => (
    pages > 1 ? (
      <div style={{ display:'flex', gap:4, alignItems:'center' }}>
        <button disabled={page<=1} onClick={() => setPage(p=>p-1)} style={{ padding:'3px 10px', fontSize:11, borderRadius:4, background:'var(--eg-surface)', border:'1px solid var(--eg-border)', color: page<=1 ? 'var(--eg-text-dim)' : 'var(--eg-text)', cursor: page<=1 ? 'default' : 'pointer' }}>‹</button>
        <span style={{ fontSize:11, color:'var(--eg-text-muted)' }}>{page}/{pages}</span>
        <button disabled={page>=pages} onClick={() => setPage(p=>p+1)} style={{ padding:'3px 10px', fontSize:11, borderRadius:4, background:'var(--eg-surface)', border:'1px solid var(--eg-border)', color: page>=pages ? 'var(--eg-text-dim)' : 'var(--eg-text)', cursor: page>=pages ? 'default' : 'pointer' }}>›</button>
      </div>
    ) : null
  );

  return (
    <div>
      {/* Header */}
      <div style={{ padding:'16px 16px 12px', borderBottom:'1px solid var(--eg-border)', background:'var(--eg-surface)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={EU_COLOR} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:14, fontWeight:800, color:'var(--eg-text)' }}>Normativa Europea EUR-Lex</div>
            <div style={{ fontSize:10, color:'var(--eg-text-muted)' }}>
              {stats ? `${(stats.totale||0).toLocaleString('it-IT')} atti UE${stats.in_vigore != null ? ` · ${stats.in_vigore.toLocaleString('it-IT')} in vigore` : ''}` : 'Caricamento…'}
            </div>
          </div>
          {/* Stats bar */}
          {stats && (
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {statsRegolamenti && (
                <span style={{ fontSize:9, padding:'2px 7px', borderRadius:3, background:'#1a5fb422', border:'1px solid #1a5fb444', color:'#1a5fb4', fontWeight:700, textTransform:'uppercase' }}>
                  Reg. {(statsRegolamenti.n||0).toLocaleString('it-IT')}
                </span>
              )}
              {statsDirettive && (
                <span style={{ fontSize:9, padding:'2px 7px', borderRadius:3, background:'#2a9d3c22', border:'1px solid #2a9d3c44', color:'#2a9d3c', fontWeight:700, textTransform:'uppercase' }}>
                  Dir. {(statsDirettive.n||0).toLocaleString('it-IT')}
                </span>
              )}
              {statsDecisioni && (
                <span style={{ fontSize:9, padding:'2px 7px', borderRadius:3, background:'#C87C2022', border:'1px solid #C87C2044', color:'#C87C20', fontWeight:700, textTransform:'uppercase' }}>
                  Dec. {(statsDecisioni.n||0).toLocaleString('it-IT')}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Ricerca */}
        <form onSubmit={handleSearch} style={{ display:'flex', gap:6, marginBottom:8 }}>
          <input
            value={qInput} onChange={e => setQInput(e.target.value)}
            placeholder="Cerca in titolo, testo, CELEX…"
            style={{ flex:1, padding:'7px 11px', fontSize:12, borderRadius:6, border:'1px solid var(--eg-border)', background:'var(--eg-bg)', color:'var(--eg-text)', outline:'none' }}
            onFocus={e => e.target.style.borderColor = EU_COLOR}
            onBlur={e => e.target.style.borderColor = 'var(--eg-border)'}
          />
          <button type="submit" style={{ padding:'7px 14px', fontSize:11, fontWeight:700, borderRadius:6, background:EU_COLOR, color:'#fff', border:'none', cursor:'pointer' }}>Cerca</button>
          {hasFiltri && (
            <button type="button" onClick={resetFiltri} style={{ padding:'7px 11px', fontSize:11, borderRadius:6, background:'var(--eg-surface)', border:'1px solid var(--eg-border)', color:'var(--eg-text-muted)', cursor:'pointer' }}>✕</button>
          )}
        </form>

        {/* Filtri */}
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          <select value={tipo} onChange={e => { setTipo(e.target.value); setPage(1); }} style={{ fontSize:11, padding:'4px 8px', borderRadius:4, border:'1px solid var(--eg-border)', background:'var(--eg-bg)', color:'var(--eg-text)', cursor:'pointer' }}>
            <option value="">Tutti i tipi</option>
            <option value="R">Regolamento</option>
            <option value="L">Direttiva</option>
            <option value="D">Decisione</option>
          </select>
          <select value={anno} onChange={e => { setAnno(e.target.value); setPage(1); }} style={{ fontSize:11, padding:'4px 8px', borderRadius:4, border:'1px solid var(--eg-border)', background:'var(--eg-bg)', color:'var(--eg-text)', cursor:'pointer' }}>
            <option value="">Tutti gli anni</option>
            {anniOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {hasFiltri && (
            <button onClick={resetFiltri} style={{ fontSize:10, padding:'4px 10px', borderRadius:4, background:'var(--eg-surface)', border:'1px solid var(--eg-border)', color:'var(--eg-text-muted)', cursor:'pointer' }}>
              Reset filtri
            </button>
          )}
        </div>
      </div>

      {/* Contatore + paginazione superiore */}
      <div style={{ padding:'8px 16px 4px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, flexWrap:'wrap' }}>
        <span style={{ fontSize:11, color:'var(--eg-text-dim)' }}>
          {loading ? 'Caricamento...' : `${totale.toLocaleString('it-IT')} risultati${q ? ` per "${q}"` : ''}`}
        </span>
        <Paginazione />
      </div>

      {loading && (
        <div style={{ padding:'40px 20px', textAlign:'center', color:'var(--eg-text-muted)', fontSize:13 }}>
          Caricamento atti EUR-Lex…
        </div>
      )}

      {/* Lista risultati */}
      {!loading && (
        <div style={{ padding:'8px 12px' }}>
          {risultati.map((r, i) => {
            const bc = badgeColor(r.tipo);
            const titoloMostrato = (r.titolo_it || r.titolo || '');
            const titolo120 = titoloMostrato.slice(0, 120);
            const preview = (r.testo_preview || '').slice(0, 150);
            return (
              <div
                key={r.celex || i}
                onClick={() => setPannello(r.celex)}
                style={{
                  padding:'12px 14px', marginBottom:8, borderRadius:8,
                  background:'var(--eg-surface)', border:'1px solid var(--eg-border)',
                  cursor:'pointer', transition:'border-color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = EU_COLOR+'70'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--eg-border)'}
              >
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6, flexWrap:'wrap' }}>
                  {/* Badge tipo */}
                  <span style={{
                    fontSize:9, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.06em',
                    color:'#fff', background:bc, padding:'2px 6px', borderRadius:3,
                    minWidth:16, textAlign:'center',
                  }}>{r.tipo || '?'}</span>
                  <span style={{ fontSize:12, fontWeight:700, color:'var(--eg-text)', fontFamily:'monospace' }}>
                    {r.celex}
                  </span>
                  {r.anno && <span style={{ fontSize:10, color:'var(--eg-text-muted)' }}>{r.anno}</span>}
                  {r.tipo_label && <span style={{ fontSize:10, color:'var(--eg-text-dim)' }}>{r.tipo_label}</span>}
                  {r.in_vigore === 1 && <span style={{ fontSize:9, padding:'1px 5px', borderRadius:2, background:'#2a9d3c22', color:'#2a9d3c', border:'1px solid #2a9d3c44', fontWeight:700 }}>vigore</span>}
                </div>
                {titolo120 && (
                  <div style={{ fontSize:12, color:'var(--eg-text)', lineHeight:1.5, marginBottom:4 }}>
                    {titolo120}{titoloMostrato.length > 120 ? '…' : ''}
                  </div>
                )}
                {preview && (
                  <div style={{ fontSize:11, color:'var(--eg-text-muted)', lineHeight:1.5 }}>
                    {preview}{(r.testo_preview || '').length >= 150 ? '…' : ''}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && risultati.length === 0 && (
        <div style={{ padding:40, textAlign:'center', color:'var(--eg-text-muted)', fontSize:13 }}>
          {hasFiltri
            ? `Nessun atto trovato${q ? ` per "${q}"` : ''}.`
            : 'Nessun atto nel database EUR-Lex. Popola con lo scraper.'}
        </div>
      )}

      {/* Paginazione inferiore */}
      {!loading && risultati.length > 0 && (
        <div style={{ padding:'8px 16px 16px', display:'flex', justifyContent:'center' }}>
          <Paginazione />
        </div>
      )}

      {/* Pannello dettaglio */}
      {pannello && (
        <PannelloEurLex
          celex={pannello}
          onClose={() => setPannello(null)}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// PAGE CORTE COSTITUZIONALE
// ════════════════════════════════════════════════════════════════════

function PannelloCorteCostituzionale({ anno, numero, onClose }) {
  const CC_COLOR = "#8B1A4A";
  const C = COLORS;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const normaContainerRef = React.useRef(null);

  // Abilita click su .norma-link → eg:openNorma → Grafo
  useEffect(() => {
    const el = normaContainerRef.current;
    if (!el) return;
    return setupNormaLinkHandler(el);
  });

  useEffect(() => {
    if (!anno || !numero) return;
    setLoading(true); setErr(null); setData(null);
    fetch(API + `/api/cortecostituzionale/pronuncia/${encodeURIComponent(anno)}/${encodeURIComponent(numero)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) setData(d.pronuncia);
        else setErr(d.error || 'Errore nel caricamento');
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [anno, numero]);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const p = data || {};
  const isSentenza = (p.tipo || '').toLowerCase().includes('sentenza');
  const normeList = (p.norme_citate || []).map(n => typeof n === 'object' ? (n.norma || '') : n).filter(Boolean);

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:9000, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
      <div onClick={e => e.stopPropagation()} style={{
        width:'100%', maxWidth:780, maxHeight:'92vh', display:'flex', flexDirection:'column',
        background:C.bg, borderRadius:'12px 12px 0 0',
        border:'1px solid '+C.border, borderBottom:'none',
        boxShadow:'0 -8px 40px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'1px solid '+C.border, background:C.surface, borderRadius:'12px 12px 0 0', flexShrink:0 }}>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:CC_COLOR }}>
              {loading ? 'Caricamento…' : p.numero ? `Corte Cost. ${p.tipo||''} n. ${p.numero}/${p.anno}` : `${anno}/${numero}`}
            </div>
            {!loading && p.presidente && (
              <div style={{ fontSize:10, color:C.textDim, marginTop:2 }}>
                Presidente: {p.presidente}{p.relatore ? ` · Relatore: ${p.relatore}` : ''}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:C.textDim, padding:'0 4px', lineHeight:1 }}>✕</button>
        </div>

        {loading && <div style={{ textAlign:'center', color:C.textMuted, padding:40, fontSize:13 }}>Caricamento pronuncia…</div>}
        {err && <div style={{ color:'#C45C5C', fontSize:13, padding:20 }}>Errore: {err}</div>}

        {data && (
          <div ref={normaContainerRef} style={{ overflowY:'auto', flex:1, padding:'16px 18px' }}>
            {/* Badge tipo + anno */}
            <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:14, alignItems:'center' }}>
              <span style={{
                fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:4,
                background: isSentenza ? CC_COLOR+'22' : '#88888822',
                color: isSentenza ? CC_COLOR : C.textMuted,
                border: `1px solid ${isSentenza ? CC_COLOR+'44' : '#88888844'}`,
              }}>{p.tipo || 'Pronuncia'}</span>
              <span style={{ fontSize:11, fontWeight:700, color:C.textMuted }}>n. {p.numero}/{p.anno}</span>
              {p.data_udienza && <span style={{ fontSize:11, color:C.textDim }}>Udienza: {p.data_udienza}</span>}
              {p.data_deposito && <span style={{ fontSize:11, color:C.textDim }}>Deposito: {p.data_deposito}</span>}
            </div>

            {/* Giudici */}
            {p.giudici && (
              <div style={{ marginBottom:12, fontSize:11, color:C.textDim }}>
                <strong>Collegio:</strong> {p.giudici}
              </div>
            )}

            {/* Oggetto */}
            {p.oggetto && (
              <div style={{ marginBottom:14, borderLeft:'3px solid '+CC_COLOR, paddingLeft:12 }}>
                <div style={{ fontSize:10, fontWeight:700, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>Oggetto</div>
                <div style={{ fontSize:13, color:C.text, lineHeight:1.6 }}
                  dangerouslySetInnerHTML={{ __html: autoLinkNorme(
                    (p.oggetto||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br/>')
                  )}}
                />
              </div>
            )}

            {/* Dispositivo — evidenziato */}
            {p.dispositivo && (
              <div style={{ marginBottom:14, padding:'12px 14px', background:CC_COLOR+'0F', borderRadius:6, border:'1px solid '+CC_COLOR+'30' }}>
                <div style={{ fontSize:10, fontWeight:700, color:CC_COLOR, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>Dispositivo</div>
                <div style={{ fontSize:13, color:C.text, lineHeight:1.7 }}
                  dangerouslySetInnerHTML={{ __html: autoLinkNorme(
                    (p.dispositivo||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br/>')
                  )}}
                />
              </div>
            )}

            {/* Norme citate — chips cliccabili */}
            {normeList.length > 0 && (
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:10, fontWeight:700, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>Norme citate</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                  {normeList.map((n, i) => (
                    <span key={i}
                      onClick={() => document.dispatchEvent(new CustomEvent('eg:openNorma', { detail: { codice: n } }))}
                      title={`Apri nel grafo: ${n}`}
                      style={{ fontSize:10, padding:'2px 8px', borderRadius:3, background:CC_COLOR+'12', border:'1px solid '+CC_COLOR+'30', color:'#D4A843', fontFamily:'monospace', cursor:'pointer', transition:'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = CC_COLOR+'28'}
                      onMouseLeave={e => e.currentTarget.style.background = CC_COLOR+'12'}
                    >{n}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Testo completo */}
            {p.testo && (
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:10, fontWeight:700, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>Testo integrale</div>
                <div style={{ fontSize:12, color:C.textMuted, lineHeight:1.8, maxHeight:400, overflowY:'auto', padding:'10px 14px', background:C.surface, borderRadius:6, border:'1px solid '+C.border, wordBreak:'break-word' }}
                  dangerouslySetInnerHTML={{ __html: autoLinkNorme(
                    (p.testo||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br/>')
                  )}}
                />
              </div>
            )}

            {/* Footer */}
            <div style={{ paddingTop:12, borderTop:'1px solid '+C.border, marginTop:8 }}>
              <button onClick={onClose} style={{ fontSize:11, fontWeight:600, padding:'6px 14px', borderRadius:5, background:C.surface, border:'1px solid '+C.border, color:C.textMuted, cursor:'pointer' }}>Chiudi</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PageCorteCostituzionale() {
  const CC_COLOR = "#8B1A4A";
  const [stats, setStats] = useState(null);
  const [risultati, setRisultati] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totale, setTotale] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [anno, setAnno] = useState('');
  const [tipo, setTipo] = useState('');
  const [pannello, setPannello] = useState(null); // { anno, numero }

  // Carica stats
  useEffect(() => {
    fetch(API + '/api/cortecostituzionale/stats')
      .then(r => r.json())
      .then(d => { if (d.ok) setStats(d); })
      .catch(() => {});
  }, []);

  // Carica pronunce
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q)    params.set('q', q);
    if (anno) params.set('anno', anno);
    if (tipo) params.set('tipo', tipo);
    params.set('page', page);
    params.set('limit', '20');
    fetch(API + '/api/cortecostituzionale/search?' + params.toString())
      .then(r => r.json())
      .then(d => {
        setRisultati(d.risultati || d.pronunce || d.results || []);
        setTotale(d.totale || 0);
        setPages(d.pagine || d.pages || 1);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [q, anno, tipo, page]);

  const handleSearch = e => { e.preventDefault(); setQ(qInput.trim()); setPage(1); };
  const resetFiltri = () => { setQ(''); setQInput(''); setAnno(''); setTipo(''); setPage(1); };
  const hasFiltri = q || anno || tipo;

  const anniOptions = [];
  for (let y = 2026; y >= 1956; y--) anniOptions.push(y);

  const Paginazione = () => (
    pages > 1 ? (
      <div style={{ display:'flex', gap:4, alignItems:'center' }}>
        <button disabled={page<=1} onClick={() => setPage(p=>p-1)} style={{ padding:'3px 10px', fontSize:11, borderRadius:4, background:'var(--eg-surface)', border:'1px solid var(--eg-border)', color: page<=1 ? 'var(--eg-text-dim)' : 'var(--eg-text)', cursor: page<=1 ? 'default' : 'pointer' }}>‹</button>
        <span style={{ fontSize:11, color:'var(--eg-text-muted)' }}>{page}/{pages}</span>
        <button disabled={page>=pages} onClick={() => setPage(p=>p+1)} style={{ padding:'3px 10px', fontSize:11, borderRadius:4, background:'var(--eg-surface)', border:'1px solid var(--eg-border)', color: page>=pages ? 'var(--eg-text-dim)' : 'var(--eg-text)', cursor: page>=pages ? 'default' : 'pointer' }}>›</button>
      </div>
    ) : null
  );

  return (
    <div>
      {/* Header */}
      <div style={{ padding:'16px 16px 12px', borderBottom:'1px solid var(--eg-border)', background:'var(--eg-surface)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={CC_COLOR} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/><path d="M3.05 11a9 9 0 1 0 .5-2.69"/></svg>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:14, fontWeight:800, color:'var(--eg-text)' }}>Corte Costituzionale</div>
            <div style={{ fontSize:10, color:'var(--eg-text-muted)' }}>
              {stats ? `${(stats.totale||21264).toLocaleString('it-IT')} pronunce (1956–2026)` : '21.264 pronunce (1956–2026)'}
            </div>
          </div>
          {/* Stats bar */}
          {stats && (
            <div style={{ display:'flex', gap:6 }}>
              {stats.sentenze != null && (
                <span style={{ fontSize:9, padding:'2px 7px', borderRadius:3, background:'var(--eg-bg)', border:'1px solid var(--eg-border)', color:'var(--eg-text-muted)', fontWeight:600, textTransform:'uppercase' }}>
                  Sentenze: {(stats.sentenze||0).toLocaleString('it-IT')}
                </span>
              )}
              {stats.ordinanze != null && (
                <span style={{ fontSize:9, padding:'2px 7px', borderRadius:3, background:'var(--eg-bg)', border:'1px solid var(--eg-border)', color:'var(--eg-text-muted)', fontWeight:600, textTransform:'uppercase' }}>
                  Ordinanze: {(stats.ordinanze||0).toLocaleString('it-IT')}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Ricerca */}
        <form onSubmit={handleSearch} style={{ display:'flex', gap:6, marginBottom:8 }}>
          <input
            value={qInput} onChange={e => setQInput(e.target.value)}
            placeholder="Cerca in oggetto e dispositivo..."
            style={{ flex:1, padding:'7px 11px', fontSize:12, borderRadius:6, border:'1px solid var(--eg-border)', background:'var(--eg-bg)', color:'var(--eg-text)', outline:'none' }}
            onFocus={e => e.target.style.borderColor = CC_COLOR}
            onBlur={e => e.target.style.borderColor = 'var(--eg-border)'}
          />
          <button type="submit" style={{ padding:'7px 14px', fontSize:11, fontWeight:700, borderRadius:6, background:CC_COLOR, color:'#fff', border:'none', cursor:'pointer' }}>Cerca</button>
          {hasFiltri && (
            <button type="button" onClick={resetFiltri} style={{ padding:'7px 11px', fontSize:11, borderRadius:6, background:'var(--eg-surface)', border:'1px solid var(--eg-border)', color:'var(--eg-text-muted)', cursor:'pointer' }}>✕</button>
          )}
        </form>

        {/* Filtri */}
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          <select value={anno} onChange={e => { setAnno(e.target.value); setPage(1); }} style={{ fontSize:11, padding:'4px 8px', borderRadius:4, border:'1px solid var(--eg-border)', background:'var(--eg-bg)', color:'var(--eg-text)', cursor:'pointer' }}>
            <option value="">Tutti gli anni</option>
            {anniOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={tipo} onChange={e => { setTipo(e.target.value); setPage(1); }} style={{ fontSize:11, padding:'4px 8px', borderRadius:4, border:'1px solid var(--eg-border)', background:'var(--eg-bg)', color:'var(--eg-text)', cursor:'pointer' }}>
            <option value="">Tutti i tipi</option>
            <option value="sentenza">Sentenza</option>
            <option value="ordinanza">Ordinanza</option>
          </select>
          {hasFiltri && (
            <button onClick={resetFiltri} style={{ fontSize:10, padding:'4px 10px', borderRadius:4, background:'var(--eg-surface)', border:'1px solid var(--eg-border)', color:'var(--eg-text-muted)', cursor:'pointer' }}>
              Reset filtri
            </button>
          )}
        </div>
      </div>

      {/* Contatore + paginazione superiore */}
      <div style={{ padding:'8px 16px 4px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, flexWrap:'wrap' }}>
        <span style={{ fontSize:11, color:'var(--eg-text-dim)' }}>
          {loading ? 'Caricamento...' : `${totale.toLocaleString('it-IT')} risultati${q ? ` per "${q}"` : ''}`}
        </span>
        <Paginazione />
      </div>

      {loading && (
        <div style={{ padding:'40px 20px', textAlign:'center', color:'var(--eg-text-muted)', fontSize:13 }}>
          Caricamento pronunce...
        </div>
      )}

      {/* Lista risultati */}
      {!loading && (
        <div style={{ padding:'8px 12px' }}>
          {risultati.map((r, i) => {
            const isSent = (r.tipo || '').toLowerCase().includes('sentenza');
            const badgeColor = isSent ? CC_COLOR : '#777';
            const badgeLabel = isSent ? 'S' : 'O';
            const oggetto = (r.oggetto || '').slice(0, 120);
            const dispPreview = (r.dispositivo || '').slice(0, 150);
            return (
              <div
                key={r.id || `${r.anno}-${r.numero}-${i}`}
                onClick={() => setPannello({ anno: r.anno, numero: r.numero })}
                style={{
                  padding:'12px 14px', marginBottom:8, borderRadius:8,
                  background:'var(--eg-surface)', border:'1px solid var(--eg-border)',
                  cursor:'pointer', transition:'border-color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = CC_COLOR+'70'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--eg-border)'}
              >
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6, flexWrap:'wrap' }}>
                  {/* Badge tipo */}
                  <span style={{
                    fontSize:9, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.06em',
                    color:'#fff', background:badgeColor, padding:'2px 6px', borderRadius:3,
                    minWidth:16, textAlign:'center',
                  }}>{badgeLabel}</span>
                  <span style={{ fontSize:12, fontWeight:700, color:'var(--eg-text)' }}>
                    Corte Cost. n. {r.numero}/{r.anno}
                  </span>
                  {r.tipo && (
                    <span style={{ fontSize:10, color:'var(--eg-text-muted)' }}>{r.tipo}</span>
                  )}
                </div>
                {oggetto && (
                  <div style={{ fontSize:12, color:'var(--eg-text)', lineHeight:1.5, marginBottom:4 }}>
                    {oggetto}{(r.oggetto || '').length > 120 ? '…' : ''}
                  </div>
                )}
                {dispPreview && (
                  <div style={{ fontSize:11, color:'var(--eg-text-muted)', lineHeight:1.5 }}>
                    {dispPreview}{(r.dispositivo || '').length > 150 ? '…' : ''}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && risultati.length === 0 && (
        <div style={{ padding:40, textAlign:'center', color:'var(--eg-text-muted)', fontSize:13 }}>
          {hasFiltri
            ? `Nessuna pronuncia trovata${q ? ` per "${q}"` : ''}.`
            : 'Nessuna pronuncia nel database. Popola con lo scraper.'}
        </div>
      )}

      {/* Paginazione inferiore */}
      {!loading && risultati.length > 0 && (
        <div style={{ padding:'8px 16px 16px', display:'flex', justifyContent:'center' }}>
          <Paginazione />
        </div>
      )}

      {/* Pannello dettaglio */}
      {pannello && (
        <PannelloCorteCostituzionale
          anno={pannello.anno}
          numero={pannello.numero}
          onClose={() => setPannello(null)}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// PAGE RICERCA SENTENZE — FTS5 full-text su 424K sentenze Cassazione
// ════════════════════════════════════════════════════════════════════
// ─── PANNELLO DETTAGLIO SENTENZA (modal) ─────────────────────────────────────
function PannelloSentenza({ id, onClose, pdfUrl, query }) {
  const C = COLORS;
  const { share: shareSentenza, popup: sharePopupS, closePopup: closeSharePopupS } = useShare();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [activeView, setActiveView] = useState('scheda'); // 'scheda' | 'testo'

  useEffect(() => {
    if (!id) return;
    setLoading(true); setErr(null); setData(null);
    setActiveView('scheda');
    fetch(`/api/sentenze/sentenza/${encodeURIComponent(id)}`)
      .then(async r => {
        // Difensivo: accetta solo 200 + JSON. Un 404 "Not found" (testo) non deve
        // arrivare a r.json() e produrre un errore tecnico nudo.
        const ct = r.headers.get('content-type') || '';
        if (!r.ok || !ct.includes('application/json')) return { ok: false };
        return r.json().catch(() => ({ ok: false }));
      })
      .then(d => { if (d && d.ok && d.sentenza) setData(d.sentenza); else setErr('unavailable'); })
      .catch(() => setErr('unavailable'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const s = data || {};
  const italgiureUrl = s.id ? `https://italgiure.giustizia.it/sncass/index.html#${s.id}` : null;

  const sezColors = {
    'U':'#9B7EC4','1':'#5B9BD5','2':'#5B9BD5','3':'#5B9BD5',
    'L':'#4A9960','T':'#D4A053','1P':'#C45C5C','2P':'#C45C5C',
    '3P':'#C45C5C','4P':'#C45C5C','5P':'#C45C5C','6P':'#C45C5C',
  };
  const accentColor = s.sezione_code ? (sezColors[s.sezione_code] || C.accent) : C.accent;

  const titoloSentenza = s.numero ? `Cass. ${s.tipo || ''} n. ${s.numero}/${s.anno}` : (id || 'Sentenza');
  const cap = (v) => v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : '';

  // Campi reali della SCHEDA (solo dati presenti nel corpus; i vuoti vengono nascosti).
  const campiScheda = [
    ['Settore',       cap(s.settore)],
    ['Sezione',       s.sezione || ''],
    ['Tipo atto',     s.tipo || ''],
    ['Numero',        s.numero ? `${s.numero}/${s.anno}` : ''],
    ['Data udienza',  s.data_decisione ? s.data_decisione.substring(0,10) : ''],
    ['Data deposito', s.data_deposito ? s.data_deposito.substring(0,10) : ''],
    ['ECLI',          s.ecli || ''],
    ['Materia',       s.materia || ''],
    ['Presidente',    s.presidente || ''],
    ['Relatore',      s.relatore || ''],
  ];

  // Testo integrale con evidenziazione dei termini cercati (se si arriva da una ricerca).
  const terminiRicerca = String(query || '').toLowerCase()
    .split(/\s+/).map(t => t.replace(/[^\p{L}\p{N}]/gu, '')).filter(t => t.length >= 2);
  const renderTesto = (txt) => {
    let html = String(txt || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    if (terminiRicerca.length) {
      const re = new RegExp('(' + terminiRicerca.map(t => t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|') + ')', 'gi');
      html = html.replace(re, '<mark style="background:rgba(200,169,110,0.45);color:inherit;border-radius:2px">$1</mark>');
    }
    return html.replace(/\n/g,'<br/>');
  };
  const testoDisponibile = s.testo_integrale && s.testo_integrale.length > 100 && !s.testo_integrale.includes('oscuramento');

  const doShare = () => {
    const meta = [s.sezione, s.materia].filter(Boolean).join(' · ');
    shareSentenza(titoloSentenza, `${titoloSentenza}${meta ? ' — ' + meta : ''} — via Edicola Ecclesiastica`, 'https://edicolaecclesiastica.com');
  };

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:9000, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
      <div onClick={e => e.stopPropagation()} style={{
        width:'100%', maxWidth:780, maxHeight:'92vh', display:'flex', flexDirection:'column',
        background:C.bg, borderRadius:'12px 12px 0 0',
        border:'1px solid '+C.border, borderBottom:'none',
        boxShadow:'0 -8px 40px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'1px solid '+C.border, background:C.surface, borderRadius:'12px 12px 0 0', flexShrink:0 }}>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:accentColor }}>
              {loading ? 'Caricamento…' : s.numero ? `Cass. ${s.tipo||''} n. ${s.numero}/${s.anno}` : id}
            </div>
            {!loading && s.sezione && <div style={{ fontSize:10, color:C.textDim, marginTop:2 }}>{s.sezione} · {s.data_decisione?.substring(0,10)}</div>}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <button onClick={doShare} title="Condividi" style={{
              background:'transparent', border:`1px solid ${C.border}`, borderRadius:6,
              color:C.textMuted, cursor:'pointer', padding:'4px 8px',
              display:'flex', alignItems:'center', gap:4, fontSize:11
            }}>
              <ShareIcon /> Condividi
            </button>
            <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:C.textDim, padding:'0 4px', lineHeight:1 }}>✕</button>
          </div>
        </div>
        <SharePopup popup={sharePopupS} onClose={closeSharePopupS} />

        {loading && <div style={{ textAlign:'center', color:C.textMuted, padding:40, fontSize:13 }}>Caricamento sentenza…</div>}
        {err && !loading && (
          <div style={{ padding:'28px 20px', textAlign:'center' }}>
            <div style={{ fontSize:26, marginBottom:8 }}>📄</div>
            <div style={{ fontSize:14, fontWeight:700, color:C.text, marginBottom:6 }}>Documento non disponibile</div>
            <div style={{ fontSize:12.5, color:C.textMuted, lineHeight:1.6, maxWidth:420, margin:'0 auto 14px' }}>
              Il dettaglio di questa sentenza non è consultabile in questo momento.
            </div>
            {pdfUrl && (
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer" style={{
                display:'inline-block', fontSize:12.5, fontWeight:700, color:C.accent,
                border:`1px solid ${C.accent}`, borderRadius:8, padding:'8px 16px', textDecoration:'none',
              }}>Apri il PDF ufficiale ↗</a>
            )}
          </div>
        )}

        {data && (<>
          {/* Selettore vista: Scheda / Testo integrale */}
          <div style={{ display:'flex', borderBottom:'1px solid '+C.border, background:C.surface, flexShrink:0 }}>
            {[{id:'scheda',label:'Scheda'},{id:'testo',label:'Testo integrale'}].map(v => {
              const active = activeView === v.id;
              return (
                <button key={v.id} onClick={() => setActiveView(v.id)} style={{
                  flex:1, padding:'11px 4px', background: active?accentColor+'18':'transparent',
                  border:'none', borderBottom: active?`2px solid ${accentColor}`:'2px solid transparent', cursor:'pointer',
                }}>
                  <div style={{ fontSize:12.5, fontWeight:800, color: active?accentColor:C.textDim }}>{v.label}</div>
                </button>
              );
            })}
          </div>

          <div style={{ overflowY:'auto', flex:1, padding:'16px 18px' }}>
            {/* VISTA SCHEDA — solo dati reali del corpus */}
            {activeView === 'scheda' && (<>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:16, alignItems:'center' }}>
                {s.sezione && <span style={{ fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:4, background:accentColor+'22', color:accentColor }}>{s.sezione}</span>}
                {s.tipo && <span style={{ fontSize:11, padding:'3px 8px', borderRadius:4, background:C.surface, border:'1px solid '+C.border, color:C.textMuted }}>{s.tipo}</span>}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:'9px 16px', fontSize:12.5, marginBottom:18 }}>
                {campiScheda.filter(([,v]) => v).map(([k,v]) => (
                  <React.Fragment key={k}>
                    <div style={{ color:C.textDim, fontWeight:600 }}>{k}</div>
                    <div style={{ color:C.text }}>{v}</div>
                  </React.Fragment>
                ))}
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', paddingTop:14, borderTop:'1px solid '+C.border }}>
                {italgiureUrl && (
                  <a href={italgiureUrl} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize:11.5, fontWeight:600, padding:'8px 14px', borderRadius:6, background:'#1a2a4a', border:'1px solid #2a4a7a', color:'#5B9BD5', textDecoration:'none', whiteSpace:'nowrap' }}>
                    ⚖️ Fonte originale (Italgiure)
                  </a>
                )}
                <button onClick={doShare}
                  style={{ fontSize:11.5, fontWeight:600, padding:'8px 14px', borderRadius:6, background:C.surface, border:'1px solid '+C.border, color:C.textMuted, cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
                  <ShareIcon /> Condividi
                </button>
                <button onClick={onClose} style={{ fontSize:11.5, fontWeight:600, padding:'8px 14px', borderRadius:6, background:C.surface, border:'1px solid '+C.border, color:C.textMuted, cursor:'pointer' }}>Chiudi</button>
              </div>
            </>)}

            {/* VISTA TESTO INTEGRALE — dal corpus, con evidenziazione dei termini cercati */}
            {activeView === 'testo' && (
              testoDisponibile ? (
                <div style={{ fontSize:12, color:C.text, lineHeight:1.85, wordBreak:'break-word' }}
                  dangerouslySetInnerHTML={{ __html: renderTesto(s.testo_integrale) }} />
              ) : (
                <div style={{ fontSize:12.5, color:C.textDim, fontStyle:'italic', padding:'8px 0', lineHeight:1.6 }}>
                  Testo integrale non disponibile per questa sentenza (oscurata o non ancora acquisita).
                  {italgiureUrl && <> Consulta la <a href={italgiureUrl} target="_blank" rel="noopener noreferrer" style={{ color:C.accent }}>fonte ufficiale &#8599;</a>.</>}
                </div>
              )
            )}
          </div>
        </>)}
      </div>
    </div>
  );
}

function PageRicercaSentenze() {
  const C = COLORS;
  const [q, setQ]               = useState('');
  const [anno, setAnno]         = useState('');
  const [sezione, setSezione]   = useState('');
  const [tipo, setTipo]         = useState('');
  const [page, setPage]         = useState(1);
  const [risultati, setRisultati] = useState([]);
  const [totale, setTotale]     = useState(0);
  const [pages, setPages]       = useState(0);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [pannelloId, setPannelloId] = useState(null);
  const [autoSearch, setAutoSearch] = useState(null); // trigger esterno
  const inputRef = React.useRef(null);

  // On-mount + listener: cerca sentenze per norma (da popup norma)
  useEffect(() => {
    const pending = window.__pendingSearch;
    if (pending?.target === 'sentenze' && pending?.query) {
      window.__pendingSearch = null;
      setQ(pending.query);
      setAutoSearch(pending.query);
    }
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.target !== 'sentenze') return;
      const qv = e.detail?.query || '';
      if (qv) { setQ(qv); setAutoSearch(qv); }
    };
    document.addEventListener('eg:searchQuery', handler);
    return () => document.removeEventListener('eg:searchQuery', handler);
  }, []);

  const LIMIT = 20;

  const cerca = React.useCallback(async (pg = 1) => {
    if (!q.trim() || q.trim().length < 2) return;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ q: q.trim(), page: pg, limit: LIMIT });
      if (anno)    params.set('anno', anno);
      if (sezione) params.set('sezione', sezione);
      if (tipo)    params.set('tipo', tipo);
      const res  = await fetch(`/api/sentenze/search?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Errore API');
      setRisultati(data.risultati || []);
      setTotale(data.totale || 0);
      setPages(data.pages || 0);
      setPage(pg);
      setExpanded(null);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }, [q, anno, sezione, tipo]);

  const onSubmit = (e) => { e.preventDefault(); cerca(1); };

  // Esegui ricerca automatica quando arriva da evento esterno
  useEffect(() => {
    if (autoSearch && autoSearch.length >= 2) { cerca(1); setAutoSearch(null); }
  }, [autoSearch]);

  const ANNI    = ['', '2026','2025','2024','2023','2022','2021','2020','2019','2018'];
  const SEZIONI = [
    { v:'', l:'Tutte le sezioni' },
    { v:'U', l:'Sezioni Unite' },
    { v:'1', l:'I Sez. Civile' },
    { v:'2', l:'II Sez. Civile' },
    { v:'3', l:'III Sez. Civile' },
    { v:'L', l:'Sez. Lavoro' },
    { v:'T', l:'Sez. Tributaria' },
    { v:'1P', l:'I Sez. Penale' },
    { v:'2P', l:'II Sez. Penale' },
    { v:'3P', l:'III Sez. Penale' },
    { v:'4P', l:'IV Sez. Penale' },
    { v:'5P', l:'V Sez. Penale' },
    { v:'6P', l:'VI Sez. Penale' },
  ];
  const TIPI = ['', 'Sentenza', 'Ordinanza', 'Decreto'];

  function EsitoChip({ esito }) {
    const map = {
      accoglimento: { bg:'#1a4a2a', color:'#4A9960', label:'Accolto' },
      rigetto: { bg:'#4a1a1a', color:'#C45C5C', label:'Rigettato' },
      'cassazione con rinvio': { bg:'#2a2a4a', color:'#7B7BC4', label:'Cass. c/rinvio' },
      'cassazione senza rinvio': { bg:'#2a2a4a', color:'#9B9BC4', label:'Cass. s/rinvio' },
      'dichiarazione inammissibilita': { bg:'#3a2a1a', color:'#C48C4C', label:'Inammissibile' },
      estinzione: { bg:'#1a3a3a', color:'#4CAAAA', label:'Estinto' },
    };
    const m = map[esito?.toLowerCase()] || { bg:'#2a2a2a', color:'#8A8680', label: esito || 'N/D' };
    return (
      <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4, background:m.bg, color:m.color, whiteSpace:'nowrap' }}>
        {m.label}
      </span>
    );
  }

  function NormeList({ norme }) {
    if (!norme?.length) return null;
    return (
      <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginTop:6 }}>
        {norme.slice(0,6).map((n,i) => (
          <span key={i} style={{ fontSize:10, padding:'2px 6px', borderRadius:3, background:C.surface, border:'1px solid '+C.border, color:C.accent, fontFamily:'monospace' }}>
            {typeof n==='object' ? n.norma : n}
          </span>
        ))}
        {norme.length > 6 && <span style={{ fontSize:10, color:C.textMuted }}>+{norme.length-6}</span>}
      </div>
    );
  }

  // Badge sezione con colore per tipo
  function SezioneBadge({ code, nome }) {
    const map = {
      'U':  { bg:'#2a1a4a', color:'#9B7EC4', label:'SS.UU.' },
      '1':  { bg:'#1a2a4a', color:'#5B9BD5', label:'I Civ.' },
      '2':  { bg:'#1a2a4a', color:'#5B9BD5', label:'II Civ.' },
      '3':  { bg:'#1a2a4a', color:'#5B9BD5', label:'III Civ.' },
      'L':  { bg:'#1a3a2a', color:'#4A9960', label:'Lav.' },
      'T':  { bg:'#3a2a1a', color:'#D4A053', label:'Trib.' },
      '1P': { bg:'#3a1a1a', color:'#C45C5C', label:'I Pen.' },
      '2P': { bg:'#3a1a1a', color:'#C45C5C', label:'II Pen.' },
      '3P': { bg:'#3a1a1a', color:'#C45C5C', label:'III Pen.' },
      '4P': { bg:'#3a1a1a', color:'#C45C5C', label:'IV Pen.' },
      '5P': { bg:'#3a1a1a', color:'#C45C5C', label:'V Pen.' },
      '6P': { bg:'#3a1a1a', color:'#C45C5C', label:'VI Pen.' },
    };
    const m = code ? (map[code] || { bg:'#2a2a2a', color:'#8A8680', label:`Sez. ${code}` })
                   : { bg:'#2a2a2a', color:'#8A8680', label: nome || '?' };
    return (
      <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4, background:m.bg, color:m.color, whiteSpace:'nowrap' }}>
        {m.label}
      </span>
    );
  }

  // Copia testo negli appunti con feedback visivo
  function CopyButton({ text, label = 'Copia' }) {
    const [copied, setCopied] = useState(false);
    const copy = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {});
    };
    return (
      <button onClick={copy} style={{
        fontSize:10, fontWeight:600, padding:'3px 8px', borderRadius:4,
        background: copied ? '#1a3a2a' : C.bg,
        border:'1px solid '+(copied ? '#4A9960' : C.border),
        color: copied ? '#4A9960' : C.textMuted,
        cursor:'pointer', transition:'all .2s', whiteSpace:'nowrap',
      }}>
        {copied ? '✓ Copiato' : label}
      </button>
    );
  }

  function SentenzaCard({ s }) {
    const l1 = s.scalata_l1 || {};
    const l2 = s.scalata_l2 || {};
    const l0 = s.scalata_l0 || {};

    return (
      <div
        onClick={() => setPannelloId(s.id)}
        style={{
          background:C.surface,
          border:'1px solid '+C.border,
          borderRadius:8,
          marginBottom:8,
          cursor:'pointer',
          transition:'border-color .15s, box-shadow .15s',
        }}
        onMouseEnter={e => e.currentTarget.style.borderColor = C.accent}
        onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
      >
        <div style={{ padding:'14px 16px' }}>
          <div style={{ display:'flex', alignItems:'flex-start', gap:10, justifyContent:'space-between' }}>
            <div style={{ flex:1, minWidth:0 }}>
              {/* Meta row */}
              <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', marginBottom:5 }}>
                <span style={{ fontSize:12, fontWeight:800, color:C.accent, fontFamily:'monospace' }}>
                  n.{s.numero}/{s.anno}
                </span>
                <SezioneBadge code={s.sezione_code} nome={s.sezione} />
                {s.tipo && (
                  <span style={{ fontSize:10, padding:'2px 6px', borderRadius:3, background:C.bg, border:'1px solid '+C.border, color:C.textDim }}>
                    {s.tipo}
                  </span>
                )}
                {s.data_decisione && (
                  <span style={{ fontSize:10, color:C.textDim }}>
                    {s.data_decisione.substring(0,10)}
                  </span>
                )}
                {l2.esito && <EsitoChip esito={l2.esito} />}
                {l2.confidence === 'alta' && (
                  <span style={{ fontSize:9, padding:'1px 5px', borderRadius:3, background:'#1a2a1a', color:'#4A9960', fontWeight:700 }}>AI ✓</span>
                )}
              </div>
              {/* Oggetto con highlight */}
              <div
                style={{ fontSize:13, fontWeight:600, color:C.text, lineHeight:1.4, marginBottom: l2.questione_giuridica ? 4 : 0 }}
                dangerouslySetInnerHTML={{ __html: s.oggetto_hl || s.oggetto || '—' }}
              />
              {l2.questione_giuridica && (
                <div style={{ fontSize:12, color:C.textMuted, lineHeight:1.4, marginTop:3 }}>
                  {l2.questione_giuridica}
                </div>
              )}
              {l1.principio_di_diritto && (
                <div style={{ fontSize:11, color:C.textDim, lineHeight:1.5, marginTop:5, fontStyle:'italic',
                  borderLeft:'2px solid '+C.accent, paddingLeft:8 }}>
                  {l1.principio_di_diritto.substring(0,180)}{l1.principio_di_diritto.length>180?'…':''}
                </div>
              )}
            </div>
            <span style={{ fontSize:12, color:C.textDim, flexShrink:0, marginTop:2 }}>▶</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding:'0 0 40px' }}>
      {/* Header */}
      <div style={{ padding:'20px 24px 16px', borderBottom:'1px solid '+C.border, background:C.surface }}>
        <h2 style={{ margin:'0 0 4px', fontSize:18, fontWeight:800, color:C.text }}>
          🔍 Ricerca Sentenze Cassazione
        </h2>
        <div style={{ fontSize:12, color:C.textMuted }}>Full-text su 424.000+ sentenze — FTS5, risultati in &lt;5ms</div>
      </div>

      {/* Form ricerca */}
      <div style={{ padding:'16px 24px', background:C.surface, borderBottom:'1px solid '+C.border }}>
        <form onSubmit={onSubmit} style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="es. responsabilità medica, art. 2043, omicidio colposo…"
            autoFocus
            style={{
              flex:'1 1 300px', padding:'10px 14px', fontSize:14,
              background:C.bg, border:'2px solid '+(q ? C.accent : C.border),
              borderRadius:8, color:C.text, outline:'none',
              transition:'border-color .15s',
            }}
          />
          {/* Filtri */}
          {[
            { label:'Anno', val:anno, set:setAnno, opts:ANNI.map(v=>({v,l:v||'Tutti gli anni'})) },
            { label:'Sezione', val:sezione, set:setSezione, opts:SEZIONI.map(s=>({v:s.v,l:s.l})) },
            { label:'Tipo', val:tipo, set:setTipo, opts:TIPI.map(v=>({v,l:v||'Tutti i tipi'})) },
          ].map(f => (
            <select key={f.label} value={f.val} onChange={e=>{ f.set(e.target.value); }}
              style={{ padding:'10px 10px', fontSize:13, background:C.bg, border:'1px solid '+C.border,
                borderRadius:8, color:f.val ? C.text : C.textMuted, cursor:'pointer' }}>
              {f.opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          ))}
          <button type="submit" disabled={loading || q.trim().length < 2}
            style={{ padding:'10px 20px', background:C.accent, color:'#000', border:'none',
              borderRadius:8, fontWeight:800, fontSize:14, cursor:'pointer',
              opacity: (loading || q.trim().length < 2) ? 0.5 : 1 }}>
            {loading ? '…' : 'Cerca'}
          </button>
          {(q||anno||sezione||tipo) && (
            <button type="button" onClick={() => { setQ(''); setAnno(''); setSezione(''); setTipo(''); setRisultati([]); setTotale(0); inputRef.current?.focus(); }}
              style={{ padding:'10px 14px', background:'transparent', color:C.textMuted, border:'1px solid '+C.border, borderRadius:8, cursor:'pointer', fontSize:13 }}>
              ✕ Reset
            </button>
          )}
        </form>
      </div>

      {/* Risultati */}
      <div style={{ padding:'16px 24px' }}>
        {error && (
          <div style={{ padding:'12px 16px', background:'#3a1a1a', borderRadius:8, color:'#C45C5C', fontSize:13, marginBottom:16 }}>
            ⚠️ {error}
          </div>
        )}

        {totale > 0 && (
          <div style={{ fontSize:12, color:C.textMuted, marginBottom:12, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span><strong style={{ color:C.text }}>{totale.toLocaleString('it')}</strong> risultati per "<em>{q}</em>"</span>
            <span>Pagina {page}/{pages}</span>
          </div>
        )}

        {risultati.length === 0 && !loading && totale === 0 && q.trim().length >= 2 && (
          <div style={{ textAlign:'center', padding:'40px 20px', color:C.textMuted }}>
            <div style={{ fontSize:32, marginBottom:12 }}>⚖️</div>
            <div style={{ fontSize:14 }}>Nessuna sentenza trovata per "<strong>{q}</strong>"</div>
            <div style={{ fontSize:12, marginTop:6, color:C.textDim }}>Prova con termini diversi o rimuovi i filtri</div>
          </div>
        )}

        {loading && (
          <div style={{ textAlign:'center', padding:'40px 20px', color:C.textMuted }}>
            <div style={{ fontSize:13 }}>Ricerca in corso…</div>
          </div>
        )}

        {pannelloId && <PannelloSentenza id={pannelloId} query={q} onClose={() => setPannelloId(null)} />}

        {risultati.map(s => <SentenzaCard key={s.id} s={s} />)}

        {/* Paginazione top */}
        {pages > 1 && (
          <div style={{ display:'flex', gap:6, justifyContent:'center', marginTop:20, flexWrap:'wrap' }}>
            {page > 1 && (
              <button onClick={() => cerca(page-1)} style={{ padding:'8px 16px', background:C.surface, border:'1px solid '+C.border, borderRadius:6, color:C.text, cursor:'pointer', fontSize:13 }}>← Prec</button>
            )}
            {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
              const p = Math.max(1, Math.min(pages - 6, page - 3)) + i;
              return (
                <button key={p} onClick={() => cerca(p)}
                  style={{ padding:'8px 12px', background: p===page ? C.accent : C.surface, color: p===page ? '#000' : C.text,
                    border:'1px solid '+(p===page ? C.accent : C.border), borderRadius:6, cursor:'pointer', fontWeight: p===page ? 800 : 400, fontSize:13 }}>
                  {p}
                </button>
              );
            })}
            {page < pages && (
              <button onClick={() => cerca(page+1)} style={{ padding:'8px 16px', background:C.surface, border:'1px solid '+C.border, borderRadius:6, color:C.text, cursor:'pointer', fontSize:13 }}>Succ →</button>
            )}
          </div>
        )}

        {/* Paginazione bottom — duplicata per navigare senza tornare su */}
        {pages > 1 && risultati.length > 0 && (
          <div style={{ display:'flex', gap:6, justifyContent:'center', marginTop:8, marginBottom:8, flexWrap:'wrap' }}>
            {page > 1 && (
              <button onClick={() => cerca(page-1)} style={{ padding:'8px 16px', background:C.surface, border:'1px solid '+C.border, borderRadius:6, color:C.text, cursor:'pointer', fontSize:13 }}>← Prec</button>
            )}
            {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
              const p = Math.max(1, Math.min(pages - 6, page - 3)) + i;
              return (
                <button key={p} onClick={() => cerca(p)}
                  style={{ padding:'8px 12px', background: p===page ? C.accent : C.surface, color: p===page ? '#000' : C.text,
                    border:'1px solid '+(p===page ? C.accent : C.border), borderRadius:6, cursor:'pointer', fontWeight: p===page ? 800 : 400, fontSize:13 }}>
                  {p}
                </button>
              );
            })}
            {page < pages && (
              <button onClick={() => cerca(page+1)} style={{ padding:'8px 16px', background:C.surface, border:'1px solid '+C.border, borderRadius:6, color:C.text, cursor:'pointer', fontSize:13 }}>Succ →</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PageTrending() {
  const [trending, setTrending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedNorma, setSelectedNorma] = useState(null);
  const [normaData, setNormaData] = useState(null);
  const [normaLoading, setNormaLoading] = useState(false);
  const [pannelloSentenzaId, setPannelloSentenzaId] = useState(null);
  const [normattivaData, setNormattivaData] = useState(null);
  const [normattivaLoading, setNormattivaLoading] = useState(false);
  const [normattivaError, setNormattivaError] = useState(null);

  useEffect(() => {
    fetch(API + "/api/codici/trending?periodo=30&limit=20")
      .then(r => r.json())
      .then(d => { setTrending(d.trending || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const openNorma = (codice) => {
    if (!codice) return;
    setSelectedNorma(codice);
    setNormaData(null);
    setNormaLoading(true);
    setNormattivaData(null);
    setNormattivaLoading(false);
    setNormattivaError(null);
    fetch(API + '/api/grafo/norma?codice=' + encodeURIComponent(codice))
      .then(r => r.json())
      .then(d => { setNormaData(d.ok ? d : null); setNormaLoading(false); })
      .catch(() => setNormaLoading(false));
  };

  const fetchNormattivaTrending = () => {
    if (!selectedNorma || normattivaLoading) return;
    setNormattivaLoading(true);
    setNormattivaError(null);
    fetch(API + '/api/normattiva/articolo?norma=' + encodeURIComponent(selectedNorma))
      .then(r => r.json())
      .then(d => {
        setNormattivaLoading(false);
        if (d.ok && d.metadatiOnly) {
          window.open(d.linkNormattiva, '_blank', 'noopener');
          setNormattivaData({ metadatiOnly: true, link: d.linkNormattiva });
        } else if (d.ok && d.articoloHtml) {
          setNormattivaData(d);
        } else {
          setNormattivaError(d.errore || 'Norma non trovata su Normattiva');
        }
      })
      .catch(() => { setNormattivaLoading(false); setNormattivaError('Errore di rete'); });
  };

  const trendIcon = (t) => t === 'crescente' ? '↑' : t === 'calante' ? '↓' : '→';
  const trendColor = (t) => t === 'crescente' ? 'var(--eg-success)' : t === 'calante' ? 'var(--eg-danger)' : 'var(--eg-text-muted)';

  const data = trending.length > 0 ? trending : [];

  return (
    <div>
      <div style={{ padding:"16px 16px 8px", borderBottom:"1px solid var(--eg-border)" }}>
        <div style={{ fontSize:11, color:"var(--eg-text-muted)", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.1em" }}>
          Articoli più citati — ultimi 30 giorni
        </div>
      </div>
      {loading && <div style={{ padding:20, color:"var(--eg-text-muted)", fontSize:13 }}>Caricamento...</div>}
      {data.map((t, i) => {
        const abbr = CODICI_META.find(c=>c.id===t.codice_id)?.abbr || t.codice_id || '';
        const codiceTrending = `art. ${t.numero} ${abbr}`.trim();
        return (
          <div key={i}
            onClick={() => openNorma(codiceTrending)}
            onMouseEnter={e => e.currentTarget.style.background='var(--eg-surface-hover)'}
            onMouseLeave={e => e.currentTarget.style.background='transparent'}
            style={{ padding:"12px 16px", borderBottom:"1px solid var(--eg-border)", display:"flex", alignItems:"center", gap:12, cursor:"pointer" }}>
            <div style={{ width:28, height:28, borderRadius:6, background:"var(--eg-accent)"+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:800, color:"var(--eg-accent)", flexShrink:0 }}>{i+1}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:700, color:"var(--eg-accent)", fontFamily:"'JetBrains Mono',monospace" }}>
                {codiceTrending}
              </div>
              <div style={{ fontSize:11, color:"var(--eg-text-muted)", marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{t.titolo || t.l1_sintesi || "—"}</div>
            </div>
            <div style={{ textAlign:"right", flexShrink:0 }}>
              <div style={{ fontSize:16, fontWeight:700, color:"var(--eg-text)" }}>{t.citazioni || 0}</div>
              {t.trend && <TrendBadge trend={t.trend} variazione={t.variazione_vs_periodo_precedente || 0} />}
            </div>
          </div>
        );
      })}
      {!loading && data.length === 0 && (
        <div style={{ padding:20, color:"var(--eg-text-muted)", fontSize:13 }}>
          Nessun dato ancora — le statistiche si popolano man mano che le notizie citano articoli di codice.
        </div>
      )}
      <div style={{ padding:16, color:"var(--eg-text-dim)", fontSize:11, lineHeight:1.5 }}>
        La classifica mostra gli articoli di legge più citati nelle notizie aggregate. Tocca per aprire il pannello norma.
      </div>

      {/* ── PANNELLO NORMA (inline, slide-in) ── */}
      {selectedNorma && (
        <div style={{
          position:'fixed', inset:0, zIndex:800,
          display:'flex', alignItems:'flex-end', justifyContent:'center',
          background:'rgba(0,0,0,0.5)',
        }} onClick={() => { setSelectedNorma(null); setNormaData(null); setNormattivaData(null); setNormattivaError(null); }}>
          <div onClick={e => e.stopPropagation()} style={{
            width:'100%', maxWidth:640, maxHeight:'88vh',
            background:'var(--eg-surface)', borderRadius:'16px 16px 0 0',
            border:'1px solid var(--eg-border)', overflowY:'auto',
            padding:'20px 20px 32px',
          }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
              <div style={{ fontSize:16, fontWeight:700, color:'var(--eg-accent)', fontFamily:'monospace' }}>{selectedNorma}</div>
              <button onClick={() => { setSelectedNorma(null); setNormaData(null); setNormattivaData(null); setNormattivaError(null); }}
                style={{ background:'transparent', border:'none', color:'var(--eg-text-dim)', cursor:'pointer', fontSize:20, lineHeight:1 }}>✕</button>
            </div>
            {normaLoading && <div style={{ fontSize:13, color:'var(--eg-text-muted)', padding:'20px 0' }}>Caricamento...</div>}
            {normaData && (
              <div>
                {/* Contatori */}
                <div style={{ display:'flex', gap:16, marginBottom:16, flexWrap:'wrap' }}>
                  {[
                    { val: normaData.stats?.tot_notizie ?? (normaData.notizie||[]).length, label:'Notizie',   action: () => { const cn=selectedNorma; setSelectedNorma(null); setNormaData(null); document.dispatchEvent(new CustomEvent('eg:navigateTo',   {detail:{tab:'notizie'}})); document.dispatchEvent(new CustomEvent('eg:searchQuery', {detail:{query:cn, target:'notizie'}})); } },
                    { val: normaData.stats?.tot_sentenze ?? (normaData.sentenze||[]).length, label:'Sentenze', action: () => { const cn=selectedNorma; setSelectedNorma(null); setNormaData(null); document.dispatchEvent(new CustomEvent('eg:navigateTo',   {detail:{tab:'cassazione'}})); document.dispatchEvent(new CustomEvent('eg:searchQuery', {detail:{query:cn, target:'cassazione'}})); } },
                    { val: normaData.stats?.tot_relazioni ?? (normaData.relazioni||[]).length, label:'Relazioni', action: () => { const cn=selectedNorma; setSelectedNorma(null); setNormaData(null); document.dispatchEvent(new CustomEvent('eg:openNorma', {detail:{codice:cn}})); } },
                  ].map((s,i) => (
                    <div key={i}
                      onClick={s.action || undefined}
                      onMouseEnter={e => { if(s.action){ e.currentTarget.style.borderColor='var(--eg-accent)'; e.currentTarget.style.cursor='pointer'; }}}
                      onMouseLeave={e => { e.currentTarget.style.borderColor='var(--eg-border)'; }}
                      style={{ textAlign:'center', minWidth:80, padding:'8px 12px', borderRadius:8, background:'var(--eg-bg)', border:'1px solid var(--eg-border)', cursor: s.action ? 'pointer' : 'default', transition:'border-color 0.15s' }}>
                      <div style={{ fontSize:24, fontWeight:900, color:'var(--eg-accent)', fontFamily:'monospace' }}>{s.val}</div>
                      <div style={{ fontSize:10, color:'var(--eg-text-dim)', textTransform:'uppercase', fontWeight:600 }}>{s.label}</div>
                    </div>
                  ))}
                  {normaData.stats?.trend_direzione && (
                    <div
                      onClick={() => { setSelectedNorma(null); setNormaData(null); document.dispatchEvent(new CustomEvent('eg:navigateTo', {detail:{tab:'genio'}})); }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor='var(--eg-accent)'; e.currentTarget.style.cursor='pointer'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor='var(--eg-border)'; }}
                      style={{ textAlign:'center', minWidth:80, padding:'8px 12px', borderRadius:8, background:'var(--eg-bg)', border:'1px solid var(--eg-border)', cursor:'pointer', transition:'border-color 0.15s' }}>
                      <div style={{ fontSize:24, fontWeight:900, color:trendColor(normaData.stats.trend_direzione), fontFamily:'monospace' }}>{trendIcon(normaData.stats.trend_direzione)}</div>
                      <div style={{ fontSize:10, color:'var(--eg-text-dim)', textTransform:'uppercase', fontWeight:600 }}>Trend ↗</div>
                    </div>
                  )}
                </div>

                {/* ── NORMATTIVA TESTO VIGENTE ── */}
                <div style={{ marginBottom:14 }}>
                  {!normattivaData && !normattivaError && (
                    <button
                      onClick={fetchNormattivaTrending}
                      disabled={normattivaLoading}
                      style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:8, border:'1px solid var(--eg-border)', background:'var(--eg-bg)', color:'var(--eg-text-muted)', fontSize:12, cursor: normattivaLoading ? 'wait' : 'pointer', transition:'border-color 0.15s, color 0.15s' }}
                      onMouseEnter={e => { if(!normattivaLoading){ e.currentTarget.style.borderColor='var(--eg-accent)'; e.currentTarget.style.color='var(--eg-accent)'; }}}
                      onMouseLeave={e => { e.currentTarget.style.borderColor='var(--eg-border)'; e.currentTarget.style.color='var(--eg-text-muted)'; }}>
                      {normattivaLoading ? <span style={{ fontSize:11 }}>⏳ Caricamento...</span> : <><span>📜</span><span>Testo vigente su Normattiva</span></>}
                    </button>
                  )}
                  {normattivaError && (
                    <div style={{ fontSize:11, color:'var(--eg-danger)', padding:'6px 10px', borderRadius:6, background:'var(--eg-danger)10', border:'1px solid var(--eg-danger)30' }}>
                      {normattivaError}
                    </div>
                  )}
                  {normattivaData && !normattivaData.metadatiOnly && normattivaData.articoloHtml && (
                    <div style={{ borderRadius:8, border:'1px solid var(--eg-border)', background:'var(--eg-bg)', overflow:'hidden' }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderBottom:'1px solid var(--eg-border)' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <span style={{ fontSize:11, fontWeight:700, color:'var(--eg-accent)' }}>📜 Testo Normattiva</span>
                          {normattivaData.inVigore === true && <span style={{ fontSize:9, padding:'2px 7px', borderRadius:10, background:'var(--eg-success)20', color:'var(--eg-success)', fontWeight:700 }}>IN VIGORE</span>}
                          {normattivaData.inVigore === false && <span style={{ fontSize:9, padding:'2px 7px', borderRadius:10, background:'var(--eg-danger)20', color:'var(--eg-danger)', fontWeight:700 }}>ABROGATO</span>}
                        </div>
                        <button onClick={() => setNormattivaData(null)} style={{ background:'transparent', border:'none', color:'var(--eg-text-dim)', cursor:'pointer', fontSize:16, lineHeight:1, padding:0 }}>✕</button>
                      </div>
                      <div
                        style={{ padding:'12px 14px', fontSize:12, lineHeight:1.7, color:'var(--eg-text)', maxHeight:320, overflowY:'auto' }}
                        dangerouslySetInnerHTML={{ __html: normattivaData.articoloHtml }} />
                    </div>
                  )}
                  {normattivaData && normattivaData.metadatiOnly && (
                    <div style={{ fontSize:11, color:'var(--eg-text-muted)', padding:'6px 10px', borderRadius:6, background:'var(--eg-surface-hover)', border:'1px solid var(--eg-border)' }}>
                      📜 Testo aperto su Normattiva.it (codice storico)
                      {' '}<a href={normattivaData.link} target="_blank" rel="noopener noreferrer" style={{ color:'var(--eg-accent)' }}>Apri di nuovo</a>
                    </div>
                  )}
                </div>

                {/* Norme collegate */}
                {(normaData.relazioni||[]).length > 0 && (
                  <div style={{ marginBottom:14 }}>
                    <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--eg-text-muted)', marginBottom:8 }}>Norme collegate</div>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                      {(normaData.relazioni||[]).slice(0,12).map((r,i) => (
                        <span key={i}
                          onClick={() => openNorma(r.collega)}
                          onMouseEnter={e => e.currentTarget.style.textDecoration='underline'}
                          onMouseLeave={e => e.currentTarget.style.textDecoration='none'}
                          style={{ fontSize:11, padding:'3px 10px', borderRadius:10, cursor:'pointer', background:'var(--eg-accent)12', border:'1px solid var(--eg-accent)30', color:'var(--eg-accent)', fontFamily:'monospace' }}>{r.collega}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ultime notizie */}
                {(normaData.notizie||[]).length > 0 && (
                  <div style={{ marginBottom:14 }}>
                    <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--eg-text-muted)', marginBottom:8 }}>Ultime notizie</div>
                    {(normaData.notizie||[]).slice(0,5).map((n,i) => (
                      <div key={i}
                        style={{ padding:'8px 0', borderBottom: i < Math.min((normaData.notizie||[]).length,5)-1 ? '1px solid var(--eg-border)30' : 'none', cursor:'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background='var(--eg-surface-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background='transparent'}
                        onClick={() => { setSelectedNorma(null); setNormaData(null); /* open article via event */ document.dispatchEvent(new CustomEvent('eg:openArticle', {detail:{id:n.id}})); }}>
                        <div style={{ fontSize:12, color:'var(--eg-text)', fontWeight:600, lineHeight:1.4 }}>{n.title}</div>
                        <div style={{ fontSize:10, color:'var(--eg-text-dim)', marginTop:2, display:'flex', gap:8 }}>
                          <span>{n.source_name}</span>
                          {n.published_at && <span>{new Date(n.published_at).toLocaleDateString('it-IT')}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Ultime sentenze */}
                {(normaData.sentenze||[]).length > 0 && (
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--eg-text-muted)', marginBottom:8 }}>Ultime sentenze Cassazione</div>
                    {(normaData.sentenze||[]).slice(0,5).map((s,i) => (
                      <div key={i}
                        style={{ padding:'8px 0', borderBottom: i < Math.min((normaData.sentenze||[]).length,5)-1 ? '1px solid var(--eg-border)30' : 'none', cursor:'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background='var(--eg-surface-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background='transparent'}
                        onClick={() => { document.dispatchEvent(new CustomEvent('eg:openSentenza', { detail: { id: s.id } })); }}>
                        <div style={{ fontSize:12, fontWeight:600, color:'var(--eg-text)' }}>n. {s.numero}/{s.anno}{s.sezione ? ` — ${s.sezione}` : ''}</div>
                        {s.oggetto && <div style={{ fontSize:11, color:'var(--eg-text-muted)', lineHeight:1.4, marginTop:2 }}>{s.oggetto}</div>}
                        {s.data_decisione && <div style={{ fontSize:10, color:'var(--eg-text-dim)', marginTop:2 }}>{s.data_decisione}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!normaLoading && !normaData && (
              <div style={{ fontSize:12, color:'var(--eg-text-dim)', fontStyle:'italic', padding:'20px 0' }}>Nessun dato disponibile per questa norma.</div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

// ─── PAGINA NORME (codici e leggi) — self-contained, usa /api/norme/* ──────
// Rami del corpus ecclesiastico mostrati nella pagina Codici, nell'ordine.
const RAMI_CORPUS = [
  { id:'canonico',         label:'Diritto Canonico',                          desc:'Codice di Diritto Canonico (CIC 1983) e Codice dei Canoni delle Chiese Orientali (CCEO 1990)' },
  { id:'ecclesiastico_it', label:'Stato e Chiese — Leggi italiane',           desc:'Patti Lateranensi, Accordo di Villa Madama, enti ecclesiastici, culti ammessi e intese ex art. 8 Cost.' },
  { id:'vaticano',         label:'Leggi dello Stato della Città del Vaticano', desc:'Legge fondamentale, leggi e decreti dello SCV' },
  { id:'magistero',        label:'Magistero Pontificio',                      desc:'Motu proprio, costituzioni apostoliche, encicliche ed esortazioni' },
];

function PageNorme() {
  const [codici, setCodici] = useState([]);
  const [atti, setAtti] = useState([]);          // (legacy, non usato dalla vista a rami)
  const [rami, setRami] = useState({});          // { canonico: {atti,totale}, ... }
  const [soloRamo, setSoloRamo] = useState(window.__pendingRamo || null);
  useEffect(() => {
    const h = (e) => { setSoloRamo(e.detail || null); setSel(null); setArt(null); setRisultati(null); setQ(''); };
    document.addEventListener('eg:ramoChange', h);
    return () => document.removeEventListener('eg:ramoChange', h);
  }, []);
  const [attiInfo, setAttiInfo] = useState({ in_costruzione: false, pending: 0, totale: 0 });
  const [stato, setStato] = useState('loading'); // loading | attivo | in_costruzione | errore
  const [tot, setTot] = useState({ codici: 0, articoli: 0, atti: 0 });
  const [sel, setSel] = useState(null);          // codice o atto selezionato {id,nome,sigla,url,isAtto?,urn?}
  const [articoli, setArticoli] = useState([]);
  const [artLoading, setArtLoading] = useState(false);
  const [art, setArt] = useState(null);          // articolo aperto {numero,titolo,testo,...}
  const [analisi, setAnalisi] = useState(null);  // analisi AI on-demand dell'articolo aperto
  const [analisiStato, setAnalisiStato] = useState('idle'); // idle | loading | ok | errore
  const [q, setQ] = useState('');
  const [risultati, setRisultati] = useState(null); // array | null (null = nessuna ricerca attiva)
  const [searching, setSearching] = useState(false);
  const timer = React.useRef(null);

  useEffect(() => {
    fetch(API + '/api/norme/codici')
      .then(r => r.json())
      .then(d => {
        if (d && d.ok) {
          setCodici(d.codici || []);
          setTot({ codici: d.totale_codici || 0, articoli: d.totale_articoli || 0, atti: d.totale_atti || 0 });
          // Attivo se c'è QUALSIASI contenuto: codici classici O atti del corpus
          // (in Edicola Ecclesiastica i "codici" Normattiva sono zero, ma il
          // corpus canonico/vaticano/magistero vive nella tabella atti).
          setStato(((d.totale_codici || 0) > 0 || (d.totale_atti || 0) > 0) ? 'attivo' : 'in_costruzione');
        } else { setStato('in_costruzione'); }
      })
      .catch(() => setStato('errore'));
    // Corpus ecclesiastico — un fetch per ramo (canonico, Stato-Chiese,
    // vaticano, magistero); ogni ramo diventa una sezione della pagina.
    RAMI_CORPUS.forEach((ramo) => {
      fetch(API + '/api/norme/atti?ordinamento=' + ramo.id + '&limit=60')
        .then(r => r.json())
        .then(d => {
          if (d && d.ok) {
            setRami(prev => ({ ...prev, [ramo.id]: { atti: d.atti || [], totale: d.totale_atti || 0, pending: d.pending || 0 } }));
            setAttiInfo(prev => ({ in_costruzione: prev.in_costruzione || !!d.in_costruzione, pending: d.pending || prev.pending, totale: prev.totale + (d.totale_atti || 0) }));
          }
        })
        .catch(() => {});
    });
  }, []);

  const openAtto = (a) => {
    const meta = { id: a.urn, urn: a.urn, isAtto: true, url: a.url_fonte,
      nome: a.titolo || `${a.tipo || 'Atto'} ${a.numero || ''}${a.anno ? '/' + a.anno : ''}`.trim(),
      sigla: a.numero ? `${a.tipo || ''} ${a.numero}/${a.anno || ''}`.trim() : (a.tipo || ''),
      canoni: a.ordinamento === 'canonico' };
    setSel(meta); setArt(null); setArticoli([]); setArtLoading(true); setRisultati(null); setQ('');
    fetch(API + '/api/norme/atto-articoli?urn=' + encodeURIComponent(a.urn))
      .then(r => r.json())
      .then(d => { setArticoli(d.articoli || []); setArtLoading(false); })
      .catch(() => setArtLoading(false));
  };

  const doSearch = React.useCallback((query) => {
    const term = (query || '').trim();
    if (term.length < 2) { setRisultati(null); return; }
    setSearching(true); setSel(null); setArt(null);
    fetch(API + '/api/norme/cerca?q=' + encodeURIComponent(term) + '&limit=40')
      .then(r => r.json())
      .then(d => { setRisultati(d.risultati || []); setSearching(false); })
      .catch(() => { setRisultati([]); setSearching(false); });
  }, []);

  // Ricezione query dalla barra unificata dell'header (target 'norme')
  useEffect(() => {
    const ps = window.__pendingSearch;
    if (ps && ps.target === 'norme' && ps.query) { setQ(ps.query); doSearch(ps.query); window.__pendingSearch = null; }
    const handler = (e) => { const { query, target } = e.detail || {}; if (target === 'norme' && query) { setQ(query); doSearch(query); } };
    document.addEventListener('eg:searchQuery', handler);
    return () => document.removeEventListener('eg:searchQuery', handler);
  }, [doSearch]);

  const onQueryChange = (v) => {
    setQ(v);
    clearTimeout(timer.current);
    if (!v.trim()) { setRisultati(null); return; }
    timer.current = setTimeout(() => doSearch(v), 300);
  };

  const openCodice = (c) => {
    setSel(c); setArt(null); setArticoli([]); setArtLoading(true); setRisultati(null); setQ('');
    fetch(API + '/api/norme/articoli?codice=' + encodeURIComponent(c.id) + '&limit=2000')
      .then(r => r.json())
      .then(d => { setArticoli(d.articoli || []); setArtLoading(false); })
      .catch(() => setArtLoading(false));
  };

  const openArticolo = React.useCallback((codiceId, numero, codiceMeta) => {
    if (codiceMeta) setSel(codiceMeta);
    setArtLoading(true); setArt(null); setRisultati(null);
    const isAtto = (codiceMeta && codiceMeta.isAtto) || (sel && sel.isAtto);
    const urn = (codiceMeta && codiceMeta.urn) || (sel && sel.urn) || codiceId;
    const endpoint = isAtto
      ? API + '/api/norme/atto-articolo?urn=' + encodeURIComponent(urn) + '&numero=' + encodeURIComponent(numero)
      : API + '/api/norme/articolo?codice=' + encodeURIComponent(codiceId) + '&numero=' + encodeURIComponent(numero);
    setAnalisi(null); setAnalisiStato('idle');
    fetch(endpoint)
      .then(r => r.json())
      .then(d => { if (d && d.ok) setArt({ ...d.articolo, _isAtto: isAtto, _urn: urn }); setArtLoading(false); })
      .catch(() => setArtLoading(false));
  }, [sel]);

  const caricaAnalisi = React.useCallback((a) => {
    if (!a) return;
    setAnalisiStato('loading'); setAnalisi(null);
    const endpoint = a._isAtto
      ? API + '/api/norme/atto-analisi?urn=' + encodeURIComponent(a._urn) + '&numero=' + encodeURIComponent(a.numero)
      : API + '/api/norme/analisi?codice=' + encodeURIComponent(a.codice_id) + '&articolo=' + encodeURIComponent(a.numero);
    fetch(endpoint)
      .then(r => r.json())
      .then(d => {
        if (d && d.ok && d.analisi) { setAnalisi(d.analisi); setAnalisiStato('ok'); }
        else { setAnalisi({ _msg: (d && d.message) || 'Analisi non disponibile al momento.' }); setAnalisiStato('errore'); }
      })
      .catch(() => { setAnalisi({ _msg: 'Analisi non disponibile al momento.' }); setAnalisiStato('errore'); });
  }, []);

  // Apertura diretta di un articolo dalla barra di ricerca unificata
  useEffect(() => {
    const pna = window.__pendingNormaArticolo;
    if (pna && pna.codice_id && pna.numero) {
      openArticolo(pna.codice_id, pna.numero, { id: pna.codice_id, nome: pna.codice_nome, sigla: pna.codice_sigla, url: pna.codice_url });
      window.__pendingNormaArticolo = null;
    }
    const h = (e) => { const d = e.detail || {}; if (d.codice_id && d.numero) openArticolo(d.codice_id, d.numero, { id: d.codice_id, nome: d.codice_nome, sigla: d.codice_sigla, url: d.codice_url }); };
    document.addEventListener('eg:openNormaArticolo', h);
    return () => document.removeEventListener('eg:openNormaArticolo', h);
  }, [openArticolo]);

  const wrap = { maxWidth: 900, margin: '0 auto', padding: '20px 18px 80px' };
  const card = { background: 'var(--eg-surface)', border: '1px solid var(--eg-border)', borderRadius: 10 };

  // Il testo segue lo stato REALE del corpus: dal 31/07/2026 l'archivio non si costruisce più
  // un atto per notte (canale unitario, 2 richieste ad atto) ma è stato caricato in blocco dai
  // pacchetti opendata di Normattiva. Dire ancora "in costruzione" sarebbe falso; resta vero
  // che l'enumerazione del catalogo e l'aggiornamento dalla GU proseguono ogni notte.
  const Nota = () => (
    <div style={{ ...card, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: 'var(--eg-text-muted)', background: 'rgba(200,169,110,0.10)' }}>
      {tot.atti ? (
        <>📜 <strong>Corpus ecclesiastico:</strong> <strong>{tot.atti.toLocaleString('it-IT')}</strong> atti — CIC, CCEO, leggi vaticane, intese Stato-confessioni e magistero — con <strong>{tot.articoli.toLocaleString('it-IT')}</strong> canoni e articoli.
          {attiInfo.pending ? <> Altri <strong>{attiInfo.pending.toLocaleString('it-IT')}</strong> atti sono in coda: lo scaricamento notturno continua.</> : <> Nuovi testi vengono scaricati ogni notte.</>}</>
      ) : (
        <>🏗️ <strong>Corpus in costruzione:</strong> codici, leggi vaticane e magistero vengono scaricati ogni notte a blocchi.</>
      )}
    </div>
  );

  const Header = () => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--eg-text)', margin: 0 }}>Norme</h1>
        {stato === 'attivo' && (
          <div style={{ fontSize: 12, color: 'var(--eg-text-muted)' }}>
            <strong style={{ color: 'var(--eg-accent)' }}>{tot.articoli.toLocaleString('it-IT')}</strong> canoni e articoli{tot.codici ? ` · ${tot.codici} codici` : ''}{tot.atti ? ` · ${tot.atti.toLocaleString('it-IT')} atti` : ''}
          </div>
        )}
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--eg-text-muted)', marginTop: 4 }}>Il corpus canonico ed ecclesiastico: codici, leggi vaticane, intese e magistero.</div>
    </div>
  );

  // JSX semplice, NON un componente: definirlo come componente interno lo
  // ricreava a ogni render, React smontava l'<input> a ogni lettera digitata
  // e su mobile la tastiera spariva (focus perso).
  const searchInput = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--eg-surface-hover)', borderRadius: 8, padding: '9px 14px', marginBottom: 18 }}>
      <span style={{ color: 'var(--eg-text-muted)' }}>🔍</span>
      <input
        type="text" value={q}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Cerca nel corpus (es. matrimonio, parrocchia, can. 1055, libertà religiosa)…"
        style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--eg-text)', fontSize: 14 }}
      />
      {searching && <span style={{ fontSize: 11, color: 'var(--eg-text-dim)' }}>…</span>}
      {q && <button onClick={() => { setQ(''); setRisultati(null); }} style={{ background: 'transparent', border: 'none', color: 'var(--eg-text-dim)', cursor: 'pointer', fontSize: 14 }}>✕</button>}
    </div>
  );

  if (stato === 'loading') {
    return <div style={wrap}><Header /><div style={{ color: 'var(--eg-text-dim)', fontSize: 14 }}>Caricamento codici…</div></div>;
  }
  if (stato === 'in_costruzione' || stato === 'errore') {
    return (
      <div style={wrap}>
        <Header />
        <div style={{ ...card, padding: '28px 22px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--eg-text)', marginBottom: 8 }}>Corpus in costruzione</div>
          <div style={{ fontSize: 13.5, color: 'var(--eg-text-muted)', lineHeight: 1.6 }}>
            Il corpus canonico ed ecclesiastico si sta scaricando.<br/>CIC, CCEO, leggi vaticane, intese e magistero arrivano con i blocchi notturni.
          </div>
        </div>
      </div>
    );
  }

  // Vista articolo aperto
  if (art) {
    return (
      <div style={wrap}>
        <button onClick={() => setArt(null)} style={{ background: 'transparent', border: '1px solid var(--eg-border)', borderRadius: 6, padding: '5px 12px', color: 'var(--eg-text-muted)', cursor: 'pointer', fontSize: 12.5, marginBottom: 16 }}>← Indietro</button>
        <div style={{ ...card, padding: '24px 22px' }}>
          <div style={{ fontSize: 11.5, color: 'var(--eg-text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            {(art.codice_nome || (sel && sel.nome) || '')}{art.codice_sigla ? ` · ${art.codice_sigla}` : ''}
          </div>
          <h2 style={{ fontSize: 21, fontWeight: 800, color: 'var(--eg-text)', margin: '0 0 4px' }}>{String(art.numero) === 'testo' ? 'Testo integrale' : (sel && sel.canoni ? 'Can. ' : 'Art. ') + art.numero}</h2>
          {art.titolo && <div style={{ fontSize: 15, fontStyle: 'italic', color: 'var(--eg-text-muted)', marginBottom: 14 }}>{art.titolo}</div>}
          <div style={{ fontSize: 15.5, lineHeight: 1.75, color: 'var(--eg-text)', whiteSpace: 'pre-wrap' }}>{art.testo}</div>

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--eg-border)', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {analisiStato !== 'ok' && (
              <button onClick={() => caricaAnalisi(art)} disabled={analisiStato === 'loading'}
                style={{ background: 'var(--eg-accent)', border: 'none', borderRadius: 7, padding: '8px 16px', color: '#1a1a1a', fontSize: 13, fontWeight: 700, cursor: analisiStato === 'loading' ? 'default' : 'pointer', opacity: analisiStato === 'loading' ? 0.7 : 1 }}>
                {analisiStato === 'loading' ? 'Analisi in corso…' : 'Analisi AI ⚡'}
              </button>
            )}
            {(art.codice_url || (sel && sel.url)) && (
              <a href={art.codice_url || sel.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: 'var(--eg-accent)', textDecoration: 'none' }}>Vai al testo ufficiale →</a>
            )}
          </div>

          {analisi && (
            <div style={{ marginTop: 16, padding: '16px 18px', background: 'var(--eg-surface-hover)', borderRadius: 10, border: '1px solid var(--eg-border)' }}>
              {analisiStato === 'errore' ? (
                <div style={{ fontSize: 13, color: 'var(--eg-text-muted)' }}>{analisi._msg}</div>
              ) : (
                <>
                  <div style={{ fontSize: 11, color: 'var(--eg-text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Analisi AI</div>
                  {analisi.spiegazione && <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--eg-text)', whiteSpace: 'pre-wrap', marginBottom: analisi.ambito || analisi.giurisprudenza ? 12 : 0 }}>{analisi.spiegazione}</div>}
                  {analisi.ambito && <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--eg-text-muted)', marginBottom: analisi.giurisprudenza ? 10 : 0 }}><strong style={{ color: 'var(--eg-text)' }}>Ambito. </strong>{analisi.ambito}</div>}
                  {analisi.giurisprudenza && <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--eg-text-muted)' }}><strong style={{ color: 'var(--eg-text)' }}>Giurisprudenza. </strong>{analisi.giurisprudenza}</div>}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Vista risultati ricerca
  if (risultati !== null) {
    return (
      <div style={wrap}>
        <Header /><Nota />{searchInput}
        <div style={{ fontSize: 12.5, color: 'var(--eg-text-muted)', marginBottom: 10 }}>{risultati.length} risultati per “{q}”</div>
        {risultati.length === 0 && <div style={{ color: 'var(--eg-text-dim)', fontSize: 14 }}>Nessun articolo trovato.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {risultati.map((r, i) => (
            <div key={i} onClick={() => r.fonte_corpus === 'atto'
                ? openArticolo(r.atto_urn, r.numero, { id: r.atto_urn, urn: r.atto_urn, isAtto: true, nome: r.codice_nome, sigla: r.codice_sigla, url: r.codice_url })
                : openArticolo(r.codice_id, r.numero, { id: r.codice_id, nome: r.codice_nome, sigla: r.codice_sigla, url: r.codice_url })}
              style={{ ...card, padding: '12px 14px', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--eg-surface-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--eg-surface)'}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--eg-text)' }}>{String(r.numero) === 'testo' ? 'Documento' : (/^urn:vatican:(cic|cceo)/.test(r.atto_urn || '') ? 'Can. ' : 'Art. ') + r.numero} <span style={{ color: 'var(--eg-text-muted)', fontWeight: 500 }}>· {r.codice_sigla || r.codice_nome}</span></div>
              {r.titolo && <div style={{ fontSize: 12.5, fontStyle: 'italic', color: 'var(--eg-text-muted)', margin: '2px 0' }}>{r.titolo}</div>}
              {r.snippet && <div style={{ fontSize: 12.5, color: 'var(--eg-text-dim)', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: (r.snippet || '').replace(/\[/g, '<mark style="background:rgba(200,169,110,0.35);color:inherit">').replace(/\]/g, '</mark>') }} />}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Vista articoli di un codice
  if (sel) {
    return (
      <div style={wrap}>
        <button onClick={() => { setSel(null); setArticoli([]); }} style={{ background: 'transparent', border: '1px solid var(--eg-border)', borderRadius: 6, padding: '5px 12px', color: 'var(--eg-text-muted)', cursor: 'pointer', fontSize: 12.5, marginBottom: 16 }}>← Tutti i codici</button>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--eg-text)', margin: '0 0 2px' }}>{sel.nome}</h2>
        <div style={{ fontSize: 12.5, color: 'var(--eg-text-muted)', marginBottom: 16 }}>{sel.sigla ? sel.sigla + ' · ' : ''}{articoli.length} {sel.canoni ? 'canoni' : 'articoli'}</div>
        {artLoading && <div style={{ color: 'var(--eg-text-dim)', fontSize: 14 }}>Caricamento…</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 8 }}>
          {articoli.map((a, i) => (
            <div key={i} onClick={() => openArticolo(sel.id, a.numero)}
              style={{ ...card, padding: '10px 12px', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--eg-surface-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--eg-surface)'}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--eg-accent)' }}>{String(a.numero) === 'testo' ? 'Documento' : (sel.canoni ? 'Can. ' : 'Art. ') + a.numero}</div>
              {a.titolo && <div style={{ fontSize: 12, color: 'var(--eg-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.titolo}</div>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Vista elenco codici
  const GroupTitle = ({ children }) => (
    <div style={{ fontSize: 11, color: 'var(--eg-text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '22px 0 10px' }}>{children}</div>
  );
  return (
    <div style={wrap}>
      <Header /><Nota />{searchInput}
      {codici.filter(c => c.num_articoli > 0).length > 0 && <GroupTitle>Codici</GroupTitle>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 10 }}>
        {codici.filter(c => c.num_articoli > 0).map((c) => (
          <div key={c.id} onClick={() => openCodice(c)}
            style={{ ...card, padding: '14px 16px', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--eg-surface-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--eg-surface)'}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--eg-text)', lineHeight: 1.3 }}>{c.nome}</div>
            <div style={{ fontSize: 11.5, color: 'var(--eg-text-dim)', marginTop: 6, display: 'flex', gap: 8 }}>
              {c.sigla && <span style={{ fontFamily: 'monospace' }}>{c.sigla}</span>}
              <span>{c.num_articoli.toLocaleString('it-IT')} articoli</span>
            </div>
          </div>
        ))}
      </div>

      {soloRamo && (
        <button onClick={() => { window.__pendingRamo = null; setSoloRamo(null); document.dispatchEvent(new CustomEvent('eg:ramoChange', { detail: null })); }} style={{ background:'transparent', border:'1px solid var(--eg-border)', borderRadius:6, padding:'5px 12px', color:'var(--eg-text-muted)', cursor:'pointer', fontSize:12.5, margin:'14px 0 0' }}>← Tutti i rami del corpus</button>
      )}
      {soloRamo && !(rami[soloRamo] && rami[soloRamo].atti && rami[soloRamo].atti.length) && (
        <div style={{ marginTop:18, padding:'16px 18px', background:'var(--eg-surface)', border:'1px solid var(--eg-border)', borderRadius:10, fontSize:13, color:'var(--eg-text-muted)', lineHeight:1.6 }}>
          Questo ramo del corpus è in scaricamento: i testi arrivano con i blocchi notturni (fino a 10.000 unità a notte). Torna a trovarlo tra poco.
        </div>
      )}
      {RAMI_CORPUS.filter(ramo => !soloRamo || ramo.id === soloRamo).map((ramo) => {
        const r = rami[ramo.id];
        if (!r || !r.atti || r.atti.length === 0) return null;
        return (
          <React.Fragment key={ramo.id}>
            <GroupTitle>{ramo.label} <span style={{ color: 'var(--eg-text-dim)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
              {' · ' + r.totale.toLocaleString('it-IT') + (r.totale === 1 ? ' atto' : ' atti')}
              {r.totale > r.atti.length ? ` (mostrati i ${r.atti.length} più recenti — usa la ricerca per gli altri)` : ''}
              {r.pending > 0 ? ' · in aggiornamento' : ''}
            </span></GroupTitle>
            <div style={{ fontSize: 12, color: 'var(--eg-text-muted)', margin: '-4px 0 10px' }}>{ramo.desc}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 10 }}>
              {r.atti.map((a) => (
                <div key={a.urn} onClick={() => openAtto(a)}
                  style={{ ...card, padding: '14px 16px', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--eg-surface-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--eg-surface)'}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--eg-text)', lineHeight: 1.3 }}>{a.titolo || `${a.tipo} ${a.numero}/${a.anno}`}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--eg-text-dim)', marginTop: 6, display: 'flex', gap: 8 }}>
                    <span style={{ fontFamily: 'monospace' }}>{a.numero ? `${a.tipo || ''} ${a.numero}/${a.anno || ''}`.trim() : (a.tipo || '')}</span>
                    <span>{(a.n_articoli || 0).toLocaleString('it-IT')} {a.ordinamento === 'canonico' ? 'canoni' : 'articoli'}</span>
                  </div>
                </div>
              ))}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function PageCodici({ onOpenArticolo }) {
  const [search, setSearch] = useState("");
  const [dbCodici, setDbCodici] = useState([]);

  useEffect(() => {
    fetch(API + "/api/codici/lista")
      .then(r => r.json())
      .then(d => { if (d.codici) setDbCodici(d.codici); })
      .catch(() => {});
  }, []);

  // Costruisce la lista partendo dal DB (fonte di verità per i conteggi).
  // Per ogni codice_id presente nel DB, cerca i metadati UI in CODICI_META.
  // I codici in CODICI_META ma assenti dal DB vengono omessi (no articoli).
  const metaById = Object.fromEntries(CODICI_META.map(c => [c.id, c]));

  const lista = dbCodici.length > 0
    ? dbCodici.map(d => {
        const meta = metaById[d.id] || {};
        return {
          id:           d.id,
          nome:         meta.nome  || d.nome  || d.id,
          abbr:         meta.abbr  || d.sigla || d.id,
          num_articoli: d.num_articoli || 0,
          Icon:         meta.Icon  || IcoDefault,
        };
      })
    : CODICI_META.map(c => ({ ...c, num_articoli: 0 })); // fallback prima che il fetch risponda

  const filtered = search.trim()
    ? lista.filter(c =>
        c.nome.toLowerCase().includes(search.toLowerCase()) ||
        c.abbr.toLowerCase().includes(search.toLowerCase()) ||
        c.id.toLowerCase().includes(search.toLowerCase()))
    : lista;

  const totArticoli = filtered.reduce((s,c) => s + (c.num_articoli||0), 0);

  return (
    <div>
      <div style={{ padding:"12px 16px", borderBottom:"1px solid var(--eg-border)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, background:"var(--eg-surface-hover)", borderRadius:8, padding:"8px 12px" }}>
          <span style={{ color:"var(--eg-text-muted)", fontSize:13 }}>🔍</span>
          <input type="text" value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Cerca codice... (es. penale, strada, ambiente)"
            style={{ flex:1, background:"transparent", border:"none", outline:"none", color:"var(--eg-text)", fontSize:13 }}
          />
        </div>
      </div>
      <div style={{ padding:"12px 16px 6px" }}>
        <div style={{ fontSize:10, color:"var(--eg-text-dim)", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.1em" }}>
          {filtered.length} codici · {totArticoli.toLocaleString()} articoli · Testo vigente
        </div>
      </div>
      {filtered.map((c,i) => (
        <div key={c.id || i} style={{ padding:"14px 16px", borderBottom:"1px solid var(--eg-border)", display:"flex", alignItems:"center", gap:12, cursor:"pointer" }}
          onClick={() => onOpenArticolo && onOpenArticolo(c.id)}>
          <div style={{ width:28, height:28, flexShrink:0 }}><c.Icon /></div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:14, fontWeight:600, color:"var(--eg-text)" }}>{c.nome}</div>
            <div style={{ fontSize:11, color:"var(--eg-text-muted)", marginTop:2 }}>
              {c.abbr} · {(c.num_articoli||0).toLocaleString()} articoli nel DB
            </div>
          </div>
          <div style={{ fontSize:13, color:"var(--eg-text-dim)" }}>→</div>
        </div>
      ))}
    </div>
  );
}

// ─── PAGE GRAFO ───────────────────────────────────────────────────────
function PageGrafo() {
  const [grafStats, setGrafStats] = useState(null);
  const [gaps, setGaps] = useState([]);
  const [contrasti, setContrasti] = useState([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingGaps, setLoadingGaps] = useState(true);
  const [loadingContrasti, setLoadingContrasti] = useState(true);
  const [selectedNorma, setSelectedNorma] = useState(null);
  const [normaData, setNormaData] = useState(null);
  const [normaLoading, setNormaLoading] = useState(false);
  const [normattivaData, setNormattivaData] = useState(null);
  const [normattivaLoading, setNormattivaLoading] = useState(false);
  const [normattivaError, setNormattivaError] = useState(null);
  const [pannelloSentenzaId, setPannelloSentenzaId] = useState(null); // ripristinato dopo Fase 1b

  useEffect(() => {
    fetch(API + '/api/grafo/stats')
      .then(r => r.json())
      .then(d => { setGrafStats(d.ok ? d : null); setLoadingStats(false); })
      .catch(() => setLoadingStats(false));
    fetch(API + '/api/grafo/gaps?limit=20')
      .then(r => r.json())
      .then(d => { setGaps(d.gaps || []); setLoadingGaps(false); })
      .catch(() => setLoadingGaps(false));
    fetch(API + '/api/grafo/contrasti')
      .then(r => r.json())
      .then(d => { setContrasti(d.contrasti || []); setLoadingContrasti(false); })
      .catch(() => setLoadingContrasti(false));
    // Listener per eg:openNorma — apre il pannello norma da qualsiasi componente esterno
    const handleOpenNormaLocal = (e) => {
      const codice = e.detail?.codice;
      if (codice) openNorma(codice);
    };
    // Drain pending norma stashed by root handler quando il tab Grafo viene attivato
    const handleGrafoActivated = () => {
      const pending = window.__pendingNorma;
      if (pending) { window.__pendingNorma = null; openNorma(pending); }
    };
    document.addEventListener('eg:openNorma', handleOpenNormaLocal);
    document.addEventListener('eg:grafoActivated', handleGrafoActivated);
    return () => {
      document.removeEventListener('eg:openNorma', handleOpenNormaLocal);
      document.removeEventListener('eg:grafoActivated', handleGrafoActivated);
    };
  }, []);

  const openNorma = (codice) => {
    if (!codice) return;
    setSelectedNorma(codice);
    setNormaData(null);
    setNormaLoading(true);
    setNormattivaData(null);
    setNormattivaLoading(false);
    setNormattivaError(null);
    fetch(API + '/api/grafo/norma?codice=' + encodeURIComponent(codice))
      .then(r => r.json())
      .then(d => { setNormaData(d.ok ? d : null); setNormaLoading(false); })
      .catch(() => setNormaLoading(false));
  };

  const fetchNormattivaGrafo = () => {
    if (!selectedNorma || normattivaLoading) return;
    setNormattivaLoading(true);
    setNormattivaError(null);
    fetch(API + '/api/normattiva/articolo?norma=' + encodeURIComponent(selectedNorma))
      .then(r => r.json())
      .then(d => {
        setNormattivaLoading(false);
        if (d.ok && d.metadatiOnly) {
          window.open(d.linkNormattiva, '_blank', 'noopener');
          setNormattivaData({ metadatiOnly: true, link: d.linkNormattiva });
        } else if (d.ok && d.articoloHtml) {
          setNormattivaData(d);
        } else {
          setNormattivaError(d.errore || 'Norma non trovata su Normattiva');
        }
      })
      .catch(() => { setNormattivaLoading(false); setNormattivaError('Errore di rete'); });
  };

  const trendIcon = (t) => t === 'crescente' ? '↑' : t === 'calante' ? '↓' : '→';
  const trendColor = (t) => t === 'crescente' ? 'var(--eg-success)' : t === 'calante' ? 'var(--eg-danger)' : 'var(--eg-text-muted)';

  return (
    <div style={{ padding:'clamp(16px,3vw,28px)', maxWidth:900 }}>
      <h2 style={{ fontSize:22, fontWeight:800, color:'var(--eg-text)', marginBottom:4, letterSpacing:'-0.02em' }}>Grafo della Conoscenza</h2>
      <p style={{ fontSize:13, color:'var(--eg-text-muted)', marginBottom:24, lineHeight:1.5 }}>
        Rete di norme, notizie e sentenze. Aggiornato da L6/L7 Intelligence.
      </p>

      {/* ── STATISTICHE GRAFO ── */}
      <div style={{ borderRadius:10, border:'1px solid var(--eg-border)', background:'var(--eg-surface)', padding:'20px', marginBottom:24 }}>
        <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--eg-accent)', marginBottom:16 }}>Rete di Conoscenza</div>
        {loadingStats ? (
          <div style={{ fontSize:13, color:'var(--eg-text-muted)' }}>Caricamento statistiche...</div>
        ) : grafStats ? (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:16 }}>
            {[
              { val: (grafStats.norme_nel_grafo || 0).toLocaleString('it-IT'), label:'Norme tracciate', color:'var(--eg-accent)' },
              { val: (grafStats.relazioni_norme || 0).toLocaleString('it-IT'), label:'Relazioni norme', color:'#9B7EC4' },
              { val: (grafStats.relazioni_sentenze || 0).toLocaleString('it-IT'), label:'Rel. sentenze', color:'#5C8AC4' },
              { val: (grafStats.gap_normativi || 0).toLocaleString('it-IT'), label:'Gap normativi', color:'#D4A053' },
              { val: (grafStats.contrasti_aperti || 0).toLocaleString('it-IT'), label:'Contrasti aperti', color:'#C45C5C' },
            ].map((s, i) => (
              <div key={i} style={{ textAlign:'center', padding:'12px 8px', borderRadius:8, background:'var(--eg-bg)', border:'1px solid var(--eg-border)' }}>
                <div style={{ fontSize:28, fontWeight:900, color:s.color, fontFamily:'monospace', lineHeight:1 }}>{s.val}</div>
                <div style={{ fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--eg-text-muted)', marginTop:6 }}>{s.label}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize:12, color:'var(--eg-text-dim)' }}>Dati non disponibili.</div>
        )}
        {grafStats?.ultimo_aggiornamento && (
          <div style={{ marginTop:12, fontSize:10, color:'var(--eg-text-dim)' }}>
            Aggiornato: {new Date(grafStats.ultimo_aggiornamento).toLocaleString('it-IT')}
          </div>
        )}
        {(grafStats?.tipi_relazione || []).length > 0 && (
          <div style={{ marginTop:14, display:'flex', flexWrap:'wrap', gap:8 }}>
            {(grafStats?.tipi_relazione || []).map((t, i) => (
              <span key={i} style={{ fontSize:10, padding:'2px 8px', borderRadius:10, background:'var(--eg-accent)12', border:'1px solid var(--eg-accent)25', color:'var(--eg-accent)' }}>
                {t.tipo}: {t.c}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── GAP NORMATIVI ── */}
      <div style={{ borderRadius:10, border:'1px solid var(--eg-border)', background:'var(--eg-surface)', padding:'20px', marginBottom:24 }}>
        <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'#D4A053', marginBottom:4 }}>⚠ Gap Normativi</div>
        <div style={{ fontSize:12, color:'var(--eg-text-muted)', marginBottom:14 }}>Norme molto citate nelle notizie senza ancora una pronuncia di Cassazione</div>
        {loadingGaps ? (
          <div style={{ fontSize:13, color:'var(--eg-text-muted)' }}>Caricamento...</div>
        ) : gaps.length === 0 ? (
          <div style={{ fontSize:12, color:'var(--eg-text-dim)', fontStyle:'italic' }}>Nessun gap rilevato.</div>
        ) : (
          <div>
            {(gaps || []).map((g, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 0', borderBottom: i < gaps.length - 1 ? '1px solid var(--eg-border)30' : 'none', cursor:'pointer' }}
                onClick={() => openNorma(g.norma)}
                onMouseEnter={e => e.currentTarget.style.background='var(--eg-surface-hover)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                <div style={{ fontSize:11, color:'var(--eg-text-dim)', minWidth:22, textAlign:'right' }}>{i+1}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <span style={{ fontSize:13, fontWeight:600, color:'var(--eg-accent)', fontFamily:'monospace' }}>{g.norma}</span>
                </div>
                <div style={{ fontSize:11, color:'var(--eg-text-muted)', whiteSpace:'nowrap' }}>{g.tot_notizie} notizie</div>
                <div style={{ fontSize:11, color:'#D4A053', whiteSpace:'nowrap', fontWeight:700 }}>0 sent.</div>
                <div style={{ fontSize:11, color:trendColor(g.trend_direzione), fontWeight:700 }}>{trendIcon(g.trend_direzione)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── CONTRASTI GIURISPRUDENZIALI ── */}
      <div style={{ borderRadius:10, border:'1px solid var(--eg-border)', background:'var(--eg-surface)', padding:'20px', marginBottom:24 }}>
        <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'#C45C5C', marginBottom:14 }}>⚡ Contrasti Giurisprudenziali</div>
        {loadingContrasti ? (
          <div style={{ fontSize:13, color:'var(--eg-text-muted)' }}>Caricamento...</div>
        ) : contrasti.length === 0 ? (
          <div style={{ fontSize:12, color:'var(--eg-text-dim)', fontStyle:'italic', lineHeight:1.6 }}>
            Nessun contrasto rilevato.<br/>
            <span style={{ fontSize:11 }}>I contrasti verranno rilevati automaticamente quando lo scraping delle sentenze sarà completato.</span>
          </div>
        ) : (
          <div>
            {(contrasti || []).map((c, i) => (
              <div key={i} style={{ padding:'12px', borderRadius:8, background:'#C45C5C08', border:'1px solid #C45C5C20', marginBottom:10 }}>
                {c.norma_comune && (
                  <div style={{ fontSize:12, fontWeight:700, color:'var(--eg-accent)', marginBottom:8, fontFamily:'monospace', cursor:'pointer' }}
                    onClick={() => openNorma(c.norma_comune)}>
                    {c.norma_comune}
                  </div>
                )}
                <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                  {[{ id:c.sentenza_a, meta:c.meta_a }, { id:c.sentenza_b, meta:c.meta_b }].map((s, j) => (
                    <div key={j}
                      onClick={() => s.id && setPannelloSentenzaId(s.id)}
                      onMouseEnter={e => e.currentTarget.style.borderColor='var(--eg-accent)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor='var(--eg-border)'}
                      style={{ flex:1, minWidth:180, padding:'8px 10px', borderRadius:6, background:'var(--eg-surface)', border:'1px solid var(--eg-border)', cursor: s.id ? 'pointer' : 'default', transition:'border-color 0.15s' }}>
                      <div style={{ fontSize:10, fontWeight:700, color:'var(--eg-text-muted)', marginBottom:4 }}>Sentenza {j === 0 ? 'A' : 'B'}</div>
                      {s.meta ? (
                        <>
                          <div style={{ fontSize:12, fontWeight:600, color:'var(--eg-text)' }}>n. {s.meta.numero}/{s.meta.anno}</div>
                          {s.meta.sezione && <div style={{ fontSize:11, color:'var(--eg-text-muted)' }}>{s.meta.sezione}</div>}
                          {s.meta.oggetto && <div style={{ fontSize:11, color:'var(--eg-text-muted)', lineHeight:1.4, marginTop:2 }}>{s.meta.oggetto}</div>}
                        </>
                      ) : (
                        <div style={{ fontSize:11, color:'var(--eg-text-dim)', fontFamily:'monospace' }}>{s.id}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── PANNELLO NORMA ── */}
      {selectedNorma && (
        <div style={{ borderRadius:10, border:'1px solid var(--eg-accent)40', background:'var(--eg-surface)', padding:'20px', marginBottom:24 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, flex:1, minWidth:0 }}>
              <div style={{ fontSize:15, fontWeight:700, color:'var(--eg-accent)', fontFamily:'monospace' }}>{selectedNorma}</div>
              {(() => {
                const abbrToId = {"c.c.":"codice_civile","c.p.":"codice_penale","c.p.c.":"cpc","c.p.p.":"cpp","cost.":"costituzione","tuir":"tuir","ccii":"codice_crisi"};
                const m = selectedNorma && selectedNorma.match(/art\.?\s*([\d\w-]+)\s+(.+)/i);
                if (!m) return null;
                const num = m[1]; const abbrRaw = m[2].trim().toLowerCase();
                const cId = abbrToId[abbrRaw];
                if (!cId) return null;
                return (
                  <button
                    onClick={() => document.dispatchEvent(new CustomEvent('eg:openCodice', { detail:{ codice_id: cId, numero: num } }))}
                    style={{ fontSize:10, padding:'3px 9px', borderRadius:4, border:'1px solid var(--eg-accent)40', background:'var(--eg-accent)10', color:'var(--eg-accent)', cursor:'pointer', whiteSpace:'nowrap', flexShrink:0 }}
                  >📖 Vedi nel Codice</button>
                );
              })()}
            </div>
            <button onClick={() => { setSelectedNorma(null); setNormaData(null); setNormattivaData(null); setNormattivaError(null); }} style={{ background:'transparent', border:'none', color:'var(--eg-text-dim)', cursor:'pointer', fontSize:18, lineHeight:1 }}>✕</button>
          </div>
          {normaLoading && <div style={{ fontSize:13, color:'var(--eg-text-muted)' }}>Caricamento...</div>}
          {normaData && (
            <div>
              {/* Contatori */}
              <div style={{ display:'flex', gap:16, marginBottom:16, flexWrap:'wrap' }}>
                {[
                  { val: normaData.stats?.tot_notizie ?? (normaData.notizie || []).length, label:'Notizie',   action: () => { const cn=selectedNorma; setSelectedNorma(null); setNormaData(null); document.dispatchEvent(new CustomEvent('eg:navigateTo',   {detail:{tab:'notizie'}})); document.dispatchEvent(new CustomEvent('eg:searchQuery', {detail:{query:cn, target:'notizie'}})); } },
                  { val: normaData.stats?.tot_sentenze ?? (normaData.sentenze || []).length, label:'Sentenze', action: () => { const cn=selectedNorma; setSelectedNorma(null); setNormaData(null); document.dispatchEvent(new CustomEvent('eg:navigateTo',   {detail:{tab:'cassazione'}})); document.dispatchEvent(new CustomEvent('eg:searchQuery', {detail:{query:cn, target:'cassazione'}})); } },
                  { val: normaData.stats?.tot_relazioni ?? (normaData.relazioni || []).length, label:'Relazioni', action: () => { const cn=selectedNorma; setSelectedNorma(null); setNormaData(null); document.dispatchEvent(new CustomEvent('eg:openNorma', {detail:{codice:cn}})); } },
                ].map((s, i) => (
                  <div key={i}
                    onClick={s.action || undefined}
                    onMouseEnter={e => { if(s.action){ e.currentTarget.style.outline='1px solid var(--eg-accent)'; e.currentTarget.style.cursor='pointer'; }}}
                    onMouseLeave={e => { e.currentTarget.style.outline='none'; }}
                    style={{ textAlign:'center', minWidth:80, cursor: s.action ? 'pointer' : 'default', padding:'4px 8px', borderRadius:6, transition:'outline 0.15s' }}>
                    <div style={{ fontSize:24, fontWeight:900, color:'var(--eg-accent)', fontFamily:'monospace' }}>{s.val}</div>
                    <div style={{ fontSize:10, color:'var(--eg-text-dim)', textTransform:'uppercase', fontWeight:600 }}>{s.label}</div>
                  </div>
                ))}
                {normaData.stats?.trend_direzione && (
                  <div
                    onClick={() => { setSelectedNorma(null); setNormaData(null); document.dispatchEvent(new CustomEvent('eg:navigateTo', {detail:{tab:'genio'}})); }}
                    onMouseEnter={e => { e.currentTarget.style.outline='1px solid var(--eg-accent)'; e.currentTarget.style.cursor='pointer'; }}
                    onMouseLeave={e => { e.currentTarget.style.outline='none'; }}
                    style={{ textAlign:'center', minWidth:80, cursor:'pointer', padding:'4px 8px', borderRadius:6, transition:'outline 0.15s' }}>
                    <div style={{ fontSize:24, fontWeight:900, color:trendColor(normaData.stats.trend_direzione), fontFamily:'monospace' }}>
                      {trendIcon(normaData.stats.trend_direzione)}
                    </div>
                    <div style={{ fontSize:10, color:'var(--eg-text-dim)', textTransform:'uppercase', fontWeight:600 }}>Trend ↗</div>
                  </div>
                )}
              </div>

              {/* ── NORMATTIVA TESTO VIGENTE ── */}
              <div style={{ marginBottom:14 }}>
                {!normattivaData && !normattivaError && (
                  <button
                    onClick={fetchNormattivaGrafo}
                    disabled={normattivaLoading}
                    style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:8, border:'1px solid var(--eg-border)', background:'var(--eg-bg)', color:'var(--eg-text-muted)', fontSize:12, cursor: normattivaLoading ? 'wait' : 'pointer', transition:'border-color 0.15s, color 0.15s' }}
                    onMouseEnter={e => { if(!normattivaLoading){ e.currentTarget.style.borderColor='var(--eg-accent)'; e.currentTarget.style.color='var(--eg-accent)'; }}}
                    onMouseLeave={e => { e.currentTarget.style.borderColor='var(--eg-border)'; e.currentTarget.style.color='var(--eg-text-muted)'; }}>
                    {normattivaLoading ? <span style={{ fontSize:11 }}>⏳ Caricamento...</span> : <><span>📜</span><span>Testo vigente su Normattiva</span></>}
                  </button>
                )}
                {normattivaError && (
                  <div style={{ fontSize:11, color:'var(--eg-danger)', padding:'6px 10px', borderRadius:6, background:'var(--eg-danger)10', border:'1px solid var(--eg-danger)30' }}>
                    {normattivaError}
                  </div>
                )}
                {normattivaData && !normattivaData.metadatiOnly && normattivaData.articoloHtml && (
                  <div style={{ borderRadius:8, border:'1px solid var(--eg-border)', background:'var(--eg-bg)', overflow:'hidden' }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderBottom:'1px solid var(--eg-border)' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ fontSize:11, fontWeight:700, color:'var(--eg-accent)' }}>📜 Testo Normattiva</span>
                        {normattivaData.inVigore === true && <span style={{ fontSize:9, padding:'2px 7px', borderRadius:10, background:'var(--eg-success)20', color:'var(--eg-success)', fontWeight:700 }}>IN VIGORE</span>}
                        {normattivaData.inVigore === false && <span style={{ fontSize:9, padding:'2px 7px', borderRadius:10, background:'var(--eg-danger)20', color:'var(--eg-danger)', fontWeight:700 }}>ABROGATO</span>}
                      </div>
                      <button onClick={() => setNormattivaData(null)} style={{ background:'transparent', border:'none', color:'var(--eg-text-dim)', cursor:'pointer', fontSize:16, lineHeight:1, padding:0 }}>✕</button>
                    </div>
                    <div
                      style={{ padding:'12px 14px', fontSize:12, lineHeight:1.7, color:'var(--eg-text)', maxHeight:320, overflowY:'auto' }}
                      dangerouslySetInnerHTML={{ __html: normattivaData.articoloHtml }} />
                  </div>
                )}
                {normattivaData && normattivaData.metadatiOnly && (
                  <div style={{ fontSize:11, color:'var(--eg-text-muted)', padding:'6px 10px', borderRadius:6, background:'var(--eg-surface-hover)', border:'1px solid var(--eg-border)' }}>
                    📜 Testo aperto su Normattiva.it (codice storico)
                    {' '}<a href={normattivaData.link} target="_blank" rel="noopener noreferrer" style={{ color:'var(--eg-accent)' }}>Apri di nuovo</a>
                  </div>
                )}
              </div>

              {/* Norme collegate */}
              {(normaData.relazioni || []).length > 0 && (
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--eg-text-muted)', marginBottom:8 }}>Norme collegate</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                    {(normaData.relazioni || []).slice(0, 12).map((r, i) => (
                      <span key={i}
                        onClick={() => openNorma(r.collega)}
                        onMouseEnter={e => e.currentTarget.style.textDecoration='underline'}
                        onMouseLeave={e => e.currentTarget.style.textDecoration='none'}
                        style={{ fontSize:11, padding:'3px 10px', borderRadius:10, cursor:'pointer', background:'var(--eg-accent)12', border:'1px solid var(--eg-accent)30', color:'var(--eg-accent)', fontFamily:'monospace' }}>{r.collega}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Ultime notizie */}
              {(normaData.notizie || []).length > 0 && (
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--eg-text-muted)', marginBottom:8 }}>Ultime notizie</div>
                  {(normaData.notizie || []).slice(0, 5).map((n, i) => (
                    <div key={i}
                      style={{ padding:'6px 0', borderBottom: i < Math.min((normaData.notizie||[]).length,5)-1 ? '1px solid var(--eg-border)30' : 'none', cursor:'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background='var(--eg-surface-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}
                      onClick={() => document.dispatchEvent(new CustomEvent('eg:openArticle', {detail:{id:n.id}}))}>
                      <div style={{ fontSize:12, color:'var(--eg-text)', fontWeight:600, lineHeight:1.4 }}>{n.title}</div>
                      <div style={{ fontSize:10, color:'var(--eg-text-dim)', marginTop:2, display:'flex', gap:8 }}>
                        <span>{n.source_name}</span>
                        {n.published_at && <span>{new Date(n.published_at).toLocaleDateString('it-IT')}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Ultime sentenze */}
              {(normaData.sentenze || []).length > 0 && (
                <div>
                  <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--eg-text-muted)', marginBottom:8 }}>Ultime sentenze Cassazione</div>
                  {(normaData.sentenze || []).slice(0, 5).map((s, i) => (
                    <div key={i}
                      style={{ padding:'6px 0', borderBottom: i < Math.min((normaData.sentenze||[]).length,5)-1 ? '1px solid var(--eg-border)30' : 'none', cursor:'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background='var(--eg-surface-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}
                      onClick={() => setPannelloSentenzaId(s.id)}>
                      <div style={{ fontSize:12, fontWeight:600, color:'var(--eg-text)' }}>n. {s.numero}/{s.anno} {s.sezione ? `— ${s.sezione}` : ''}</div>
                      {s.oggetto && <div style={{ fontSize:11, color:'var(--eg-text-muted)', lineHeight:1.4, marginTop:2 }}>{s.oggetto}</div>}
                      {s.data_decisione && <div style={{ fontSize:10, color:'var(--eg-text-dim)', marginTop:2 }}>{s.data_decisione}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* PannelloSentenza per sentenze cliccate */}
      {pannelloSentenzaId && <PannelloSentenza id={pannelloSentenzaId} onClose={() => setPannelloSentenzaId(null)} />}
    </div>
  );
}

const TIPO_LABEL = {
  istituzionale_giurisdizionale: 'Istituzionale',
  istituzionale_legislativa:     'Istituzionale',
  istituzionale:                 'Istituzionale',
  editore_professionale:         'Editore professionale',
  rivista_specializzata:         'Rivista specializzata',
  quotidiano_nazionale:          'Quotidiano nazionale',
  agenzia_stampa:                'Agenzia stampa',
  portale_giuridico:             'Portale giuridico',
  testata:                       'Testata',
  aggregatore:                   'Aggregatore',
};

function FonteRow({ f }) {
  const tipoLabel = TIPO_LABEL[f.type] || f.type || 'Testata';
  const lastDate  = f.latest ? new Date(f.latest).toLocaleDateString('it-IT',{day:'2-digit',month:'short',year:'numeric'}) : null;
  const statusOk  = f.count > 0;
  return (
    <div style={{ padding:"11px 16px", borderBottom:"1px solid var(--eg-border)", display:"flex", alignItems:"center", gap:12 }}>
      {/* stato online */}
      <div style={{ width:7, height:7, borderRadius:'50%', flexShrink:0,
        background: statusOk ? 'var(--eg-success)' : '#555',
        boxShadow: statusOk ? '0 0 4px var(--eg-success)' : 'none' }} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ fontSize:13, fontWeight:600, color:'var(--eg-text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {f.full_name || f.name}
          </div>
          {f.count > 0 && (
            <span style={{ fontSize:10, color:'var(--eg-accent)', fontWeight:700, whiteSpace:'nowrap' }}>
              {f.count.toLocaleString('it-IT')} art.
            </span>
          )}
        </div>
        <div style={{ fontSize:11, color:'var(--eg-text-muted)', marginTop:2, display:'flex', gap:6, flexWrap:'wrap' }}>
          <span>{tipoLabel}</span>
          {f.scope && <span style={{color:'var(--eg-text-dim)'}}>· {f.scope.substring(0,60)}</span>}
          {lastDate  && <span style={{color:'var(--eg-text-dim)', marginLeft:'auto'}}>↻ {lastDate}</span>}
        </div>
      </div>
      <AuthorityDots score={f.authority} />
    </div>
  );
}

function PageFonti() {
  const [fonti, setFonti]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('');

  useEffect(() => {
    fetch(API + '/api/sources')
      .then(r => r.json())
      .then(d => {
        setFonti(d.sources || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const q = filter.toLowerCase();
  const visible = fonti.filter(f =>
    !q ||
    (f.full_name||f.name||'').toLowerCase().includes(q) ||
    (f.type||'').toLowerCase().includes(q) ||
    (f.scope||'').toLowerCase().includes(q)
  );

  const attive   = fonti.filter(f => f.count > 0).length;
  const totalArt = fonti.reduce((s,f) => s + (f.count||0), 0);

  return (
    <div>
      {/* Header */}
      <div style={{ padding:"14px 16px 10px", borderBottom:"1px solid var(--eg-border)" }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:8 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--eg-text)' }}>
              {loading ? 'Caricamento…' : `${attive} fonti attive`}
            </div>
            <div style={{ fontSize:11, color:'var(--eg-text-muted)', marginTop:2 }}>
              {loading ? '' : `${totalArt.toLocaleString('it-IT')} articoli totali · Aggiornamento ogni 5 minuti`}
            </div>
          </div>
        </div>
        <input
          type="search"
          placeholder="Filtra fonti…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            width:'100%', padding:'7px 10px', fontSize:12,
            background:'var(--eg-bg-2)', border:'1px solid var(--eg-border)',
            borderRadius:6, color:'var(--eg-text)', outline:'none', boxSizing:'border-box',
          }}
        />
      </div>
      {/* Lista */}
      {loading
        ? <div style={{ padding:24, textAlign:'center', color:'var(--eg-text-muted)', fontSize:12 }}>Caricamento fonti…</div>
        : visible.length === 0
          ? <div style={{ padding:24, textAlign:'center', color:'var(--eg-text-muted)', fontSize:12 }}>Nessuna fonte trovata</div>
          : visible.map((f,i) => <FonteRow key={f.name||i} f={f} />)
      }
      <div style={{ padding:"12px 16px", color:"var(--eg-text-dim)", fontSize:11, lineHeight:1.6, borderTop:"1px solid var(--eg-border)" }}>
        Autorità 1–5: istituzionale (5), editore professionale (4), testata specializzata (3), generica (2), aggregatore (1).
        Non è un giudizio di valore — è un criterio di citabilità in atti giuridici.
      </div>
    </div>
  );
}

// ─── PAGINA ALERT SETTIMANALE ────────────────────────────────────────
// ── NormaBriefing: riga norma cliccabile con mini-notizie, badges Gap/Contrasto ──
function NormaBriefing({ norma, rank, onOpenNorma, onOpenArticle }) {
  const [grafo, setGrafo] = useState(null);
  const [expanded, setExpanded] = useState(false);

  const abbr = (() => {
    const m = CODICI_META.find(c => c.id === norma.codice_id);
    return m ? m.abbr : (norma.codice_id || '');
  })();
  const codice = `art. ${norma.numero} ${abbr}`.trim();
  const arrow = norma.trend === 'aumento' || norma.trend === 'crescente' ? '↑' : norma.trend === 'diminuzione' || norma.trend === 'calante' ? '↓' : '→';
  const arrowColor = (norma.trend === 'aumento' || norma.trend === 'crescente') ? 'var(--eg-success)' : (norma.trend === 'diminuzione' || norma.trend === 'calante') ? 'var(--eg-danger)' : 'var(--eg-text-dim)';

  function loadGrafo() {
    if (grafo) return;
    fetch(API + '/api/grafo/norma?codice=' + encodeURIComponent(codice))
      .then(r => r.json())
      .then(d => setGrafo(d.ok ? d : { empty: true }))
      .catch(() => setGrafo({ empty: true }));
  }

  function handleClick() {
    loadGrafo();
    onOpenNorma(codice);
  }

  function handleExpand(e) {
    e.stopPropagation();
    if (!expanded) loadGrafo();
    setExpanded(!expanded);
  }

  const hasContrasto = grafo && (grafo.stats?.contrasti_aperti > 0 || (grafo.contrasti||[]).length > 0);
  const hasGap = grafo && (grafo.stats?.tot_sentenze === 0 || (grafo.sentenze||[]).length === 0);
  const showBadges = grafo && !grafo.empty;

  return (
    <div style={{ borderBottom:'1px solid var(--eg-border)', paddingBottom:0 }}>
      {/* Riga principale */}
      <div
        onClick={handleClick}
        onMouseEnter={e => e.currentTarget.style.background='var(--eg-surface-hover)'}
        onMouseLeave={e => e.currentTarget.style.background='transparent'}
        style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 4px', cursor:'pointer' }}>
        {rank !== undefined && <span style={{ fontSize:11, color:'var(--eg-text-dim)', fontWeight:700, width:20, textAlign:'right', flexShrink:0 }}>{rank}.</span>}
        <span style={{ fontSize:13, fontWeight:600, color:'var(--eg-accent)', fontFamily:'monospace', flex:1 }}>{codice}</span>
        {showBadges && hasContrasto && (
          <span style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:3, background:'#C45C5C22', color:'#C45C5C', border:'1px solid #C45C5C40', whiteSpace:'nowrap' }}>⚡ Contrasto</span>
        )}
        {showBadges && hasGap && (
          <span style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:3, background:'#D4A05322', color:'#D4A053', border:'1px solid #D4A05340', whiteSpace:'nowrap' }}>⚠ Gap</span>
        )}
        <span style={{ fontSize:12, color:'var(--eg-text-muted)', flexShrink:0 }}>{norma.citazioni} cit.</span>
        <span style={{ fontSize:13, fontWeight:700, color:arrowColor, flexShrink:0, width:16 }}>{arrow}</span>
        <button onClick={handleExpand} style={{ background:'transparent', border:'none', color:'var(--eg-text-dim)', cursor:'pointer', fontSize:11, padding:'0 2px', flexShrink:0, lineHeight:1 }}>
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {/* Mini-notizie espanse */}
      {expanded && (
        <div style={{ paddingLeft:28, paddingBottom:10 }}>
          {!grafo && <div style={{ fontSize:11, color:'var(--eg-text-dim)', fontStyle:'italic' }}>Caricamento...</div>}
          {grafo && !grafo.empty && (grafo.notizie||[]).length === 0 && (
            <div style={{ fontSize:11, color:'var(--eg-text-dim)', fontStyle:'italic' }}>Nessuna notizia collegata.</div>
          )}
          {grafo && (grafo.notizie||[]).slice(0,2).map((n, i) => (
            <div key={i}
              onClick={e => { e.stopPropagation(); onOpenArticle(n.id); }}
              onMouseEnter={e => e.currentTarget.style.color='var(--eg-accent)'}
              onMouseLeave={e => e.currentTarget.style.color='var(--eg-text)'}
              style={{ fontSize:12, color:'var(--eg-text)', lineHeight:1.4, padding:'4px 0', cursor:'pointer', display:'flex', gap:6, alignItems:'flex-start' }}>
              <span style={{ color:'var(--eg-text-dim)', flexShrink:0, marginTop:1 }}>·</span>
              <span>{n.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PageAlert() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recentiSentenze, setRecentiSentenze] = useState([]);
  const [contrastaGrafo, setContrastaGrafo] = useState([]);
  const [selectedNorma, setSelectedNorma] = useState(null);
  const [normaData, setNormaData] = useState(null);
  const [normaLoading, setNormaLoading] = useState(false);
  const [pannelloSentenzaId, setPannelloSentenzaId] = useState(null);
  const [normattivaData, setNormattivaData] = useState(null);
  const [normattivaLoading, setNormattivaLoading] = useState(false);
  const [normattivaError, setNormattivaError] = useState(null);

  const abbrMap = {};
  CODICI_META.forEach(c => { abbrMap[c.id] = c.abbr; });

  useEffect(() => {
    fetch(API + "/api/alert/weekly")
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));

    // Sentenze recenti
    fetch(API + "/api/sentenze?limit=5")
      .then(r => r.json())
      .then(d => setRecentiSentenze(Array.isArray(d) ? d : (d.sentenze || d.results || [])))
      .catch(() => {});

    // Contrasti dal grafo
    fetch(API + "/api/grafo/contrasti")
      .then(r => r.json())
      .then(d => setContrastaGrafo((d.contrasti || []).slice(0, 5)))
      .catch(() => {});
  }, []);

  function openNorma(codice) {
    if (!codice) return;
    setSelectedNorma(codice);
    setNormaData(null);
    setNormaLoading(true);
    setNormattivaData(null);
    setNormattivaLoading(false);
    setNormattivaError(null);
    fetch(API + '/api/grafo/norma?codice=' + encodeURIComponent(codice))
      .then(r => r.json())
      .then(d => { setNormaData(d.ok ? d : null); setNormaLoading(false); })
      .catch(() => setNormaLoading(false));
  }

  function fetchNormattivaAlert() {
    if (!selectedNorma || normattivaLoading) return;
    setNormattivaLoading(true);
    setNormattivaError(null);
    fetch(API + '/api/normattiva/articolo?norma=' + encodeURIComponent(selectedNorma))
      .then(r => r.json())
      .then(d => {
        setNormattivaLoading(false);
        if (d.ok && d.metadatiOnly) {
          window.open(d.linkNormattiva, '_blank', 'noopener');
          setNormattivaData({ metadatiOnly: true, link: d.linkNormattiva });
        } else if (d.ok && d.articoloHtml) {
          setNormattivaData(d);
        } else {
          setNormattivaError(d.errore || 'Norma non trovata su Normattiva');
        }
      })
      .catch(() => { setNormattivaLoading(false); setNormattivaError('Errore di rete'); });
  }

  function openArticle(id) {
    document.dispatchEvent(new CustomEvent('eg:openArticle', { detail: { id } }));
  }

  const trendIcon = t => t === 'crescente' ? '↑' : t === 'calante' ? '↓' : '→';
  const trendColor = t => t === 'crescente' ? 'var(--eg-success)' : t === 'calante' ? 'var(--eg-danger)' : 'var(--eg-text-muted)';

  return (
    <div style={{ padding:'16px 16px 40px' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:18 }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--eg-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <div>
          <div style={{ fontSize:16, fontWeight:800, color:'var(--eg-text)' }}>Briefing Settimanale</div>
          {data?.settimana && (
            <div style={{ fontSize:11, color:'var(--eg-text-muted)' }}>
              {data.settimana?.dal} — {data.settimana?.al} · {data.notizie_totali || 0} notizie analizzate
            </div>
          )}
        </div>
      </div>

      {loading && <div style={{ color:'var(--eg-text-muted)', fontSize:13, padding:'20px 0' }}>Generazione briefing...</div>}

      {data && (<>

        {/* ── TOP 10 TREND NORMATIVI ── */}
        {(data.norme_calde?.length > 0) && (
          <div style={{ marginBottom:24 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--eg-trending)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10, display:'flex', alignItems:'center', gap:6 }}>
              § Top 10 Trend Normativi
              <span style={{ fontSize:9, fontWeight:400, color:'var(--eg-text-dim)', fontStyle:'italic', textTransform:'none', letterSpacing:0 }}>tocca per aprire il pannello norma</span>
            </div>
            {(data.norme_calde || []).map((t, i) => (
              <NormaBriefing key={i} norma={t} rank={i+1} onOpenNorma={openNorma} onOpenArticle={openArticle} />
            ))}
          </div>
        )}

        {/* ── VARIAZIONI SIGNIFICATIVE ── */}
        {(data.contrasti?.length > 0) && (
          <div style={{ marginBottom:24 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--eg-danger)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 }}>
              ⚡ Variazioni Significative
            </div>
            {(data.contrasti || []).map((c, i) => (
              <NormaBriefing key={i} norma={c} rank={undefined} onOpenNorma={openNorma} onOpenArticle={openArticle} />
            ))}
          </div>
        )}

        {/* ── SENTENZE DELLA SETTIMANA ── */}
        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#5B9BD5', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 }}>
            ⚖️ Sentenze della Settimana
          </div>
          {recentiSentenze.length === 0 && (
            <div style={{ fontSize:12, color:'var(--eg-text-dim)', fontStyle:'italic' }}>Caricamento sentenze recenti...</div>
          )}
          {recentiSentenze.map((s, i) => {
            let l1 = s.scalata_l1; try { if (typeof l1==='string') l1=JSON.parse(l1); } catch(e) { l1=null; }
            let l2 = s.scalata_l2; try { if (typeof l2==='string') l2=JSON.parse(l2); } catch(e) { l2=null; }
            const sezColors = { 'U':'#9B7EC4','L':'#4A9960','T':'#D4A053' };
            const accentColor = s.sezione_code ? (sezColors[s.sezione_code] || '#5B9BD5') : '#5B9BD5';
            return (
              <div key={i}
                onClick={() => setPannelloSentenzaId(s.id)}
                onMouseEnter={e => e.currentTarget.style.background='var(--eg-surface-hover)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}
                style={{ padding:'10px 8px', borderBottom:'1px solid var(--eg-border)', cursor:'pointer', borderRadius:4 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                  <span style={{ fontSize:12, fontWeight:700, color:accentColor, fontFamily:'monospace' }}>
                    n. {s.numero}/{s.anno}
                  </span>
                  {s.sezione && <span style={{ fontSize:10, padding:'1px 5px', borderRadius:3, background:accentColor+'20', color:accentColor, fontWeight:600 }}>{s.sezione}</span>}
                  {l2?.esito && <span style={{ fontSize:9, padding:'1px 5px', borderRadius:3, background:'var(--eg-surface)', border:'1px solid var(--eg-border)', color:'var(--eg-text-muted)' }}>{l2.esito}</span>}
                  <span style={{ fontSize:10, color:'var(--eg-text-dim)', marginLeft:'auto' }}>{s.data_decisione?.substring(0,10)}</span>
                </div>
                {(s.oggetto || l1?.principio_di_diritto) && (
                  <div style={{ fontSize:12, color:'var(--eg-text-muted)', lineHeight:1.4 }}>
                    {(s.oggetto || l1?.principio_di_diritto||'').substring(0,120)}{(s.oggetto||'').length > 120 ? '…' : ''}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── CONTRASTI EMERGENTI ── */}
        {contrastaGrafo.length > 0 && (
          <div style={{ marginBottom:24 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#C45C5C', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 }}>
              ⚡ Contrasti Giurisprudenziali Emergenti
            </div>
            {contrastaGrafo.map((c, i) => (
              <div key={i} style={{ padding:'10px 10px', borderRadius:8, background:'#C45C5C08', border:'1px solid #C45C5C20', marginBottom:10 }}>
                {c.norma_comune && (
                  <div
                    onClick={() => openNorma(c.norma_comune)}
                    style={{ fontSize:12, fontWeight:700, color:'var(--eg-accent)', marginBottom:8, fontFamily:'monospace', cursor:'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.color='#C45C5C'}
                    onMouseLeave={e => e.currentTarget.style.color='var(--eg-accent)'}>
                    {c.norma_comune}
                  </div>
                )}
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  {[{id:c.sentenza_a, meta:c.meta_a}, {id:c.sentenza_b, meta:c.meta_b}].map((s, j) => (
                    <div key={j}
                      onClick={() => s.id && setPannelloSentenzaId(s.id)}
                      onMouseEnter={e => e.currentTarget.style.borderColor='var(--eg-accent)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor='var(--eg-border)'}
                      style={{ flex:1, minWidth:140, padding:'8px 10px', borderRadius:6, background:'var(--eg-surface)', border:'1px solid var(--eg-border)', cursor:s.id?'pointer':'default', transition:'border-color 0.15s' }}>
                      <div style={{ fontSize:10, fontWeight:700, color:'var(--eg-text-muted)', marginBottom:4 }}>Sentenza {j===0?'A':'B'}</div>
                      {s.meta ? (
                        <>
                          <div style={{ fontSize:12, fontWeight:600, color:'var(--eg-text)' }}>n. {s.meta.numero}/{s.meta.anno}</div>
                          {s.meta.sezione && <div style={{ fontSize:10, color:'var(--eg-text-muted)' }}>{s.meta.sezione}</div>}
                          {s.meta.oggetto && <div style={{ fontSize:10, color:'var(--eg-text-muted)', lineHeight:1.4, marginTop:2 }}>{s.meta.oggetto}</div>}
                        </>
                      ) : (
                        <div style={{ fontSize:10, color:'var(--eg-text-dim)', fontFamily:'monospace' }}>{s.id}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {!data.norme_calde?.length && !data.contrasti?.length && recentiSentenze.length === 0 && (
          <div style={{ padding:20, color:'var(--eg-text-muted)', fontSize:13, textAlign:'center' }}>
            Nessun dato disponibile. L'alert si popola man mano che le notizie vengono analizzate.
          </div>
        )}
      </>)}

      {/* ── PANNELLO NORMA ── */}
      {selectedNorma && (
        <div style={{ position:'fixed', inset:0, zIndex:800, display:'flex', alignItems:'flex-end', justifyContent:'center', background:'rgba(0,0,0,0.5)' }}
          onClick={() => { setSelectedNorma(null); setNormaData(null); setNormattivaData(null); setNormattivaError(null); }}>
          <div onClick={e => e.stopPropagation()} style={{
            width:'100%', maxWidth:640, maxHeight:'88vh',
            background:'var(--eg-surface)', borderRadius:'16px 16px 0 0',
            border:'1px solid var(--eg-border)', overflowY:'auto', padding:'20px 20px 32px',
          }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
              <div style={{ fontSize:16, fontWeight:700, color:'var(--eg-accent)', fontFamily:'monospace' }}>{selectedNorma}</div>
              <button onClick={() => { setSelectedNorma(null); setNormaData(null); setNormattivaData(null); setNormattivaError(null); }}
                style={{ background:'transparent', border:'none', color:'var(--eg-text-dim)', cursor:'pointer', fontSize:20, lineHeight:1 }}>✕</button>
            </div>
            {normaLoading && <div style={{ fontSize:13, color:'var(--eg-text-muted)', padding:'20px 0' }}>Caricamento...</div>}
            {normaData && (() => {
              const tI = t => t==='crescente'?'↑':t==='calante'?'↓':'→';
              const tC = t => t==='crescente'?'var(--eg-success)':t==='calante'?'var(--eg-danger)':'var(--eg-text-muted)';
              return (
                <div>
                  {/* Contatori */}
                  <div style={{ display:'flex', gap:12, marginBottom:16, flexWrap:'wrap' }}>
                    {[
                      { val: normaData.stats?.tot_notizie ?? (normaData.notizie||[]).length, label:'Notizie',   action: () => { const cn=selectedNorma; setSelectedNorma(null); setNormaData(null); document.dispatchEvent(new CustomEvent('eg:navigateTo',   {detail:{tab:'notizie'}})); document.dispatchEvent(new CustomEvent('eg:searchQuery', {detail:{query:cn, target:'notizie'}})); } },
                      { val: normaData.stats?.tot_sentenze ?? (normaData.sentenze||[]).length, label:'Sentenze', action: () => { const cn=selectedNorma; setSelectedNorma(null); setNormaData(null); document.dispatchEvent(new CustomEvent('eg:navigateTo',   {detail:{tab:'cassazione'}})); document.dispatchEvent(new CustomEvent('eg:searchQuery', {detail:{query:cn, target:'cassazione'}})); } },
                      { val: normaData.stats?.tot_relazioni ?? (normaData.relazioni||[]).length, label:'Relazioni', action: () => { const cn=selectedNorma; setSelectedNorma(null); setNormaData(null); document.dispatchEvent(new CustomEvent('eg:openNorma', {detail:{codice:cn}})); } },
                    ].map((s,i) => (
                      <div key={i}
                        onClick={s.action}
                        onMouseEnter={e => { e.currentTarget.style.borderColor='var(--eg-accent)'; e.currentTarget.style.cursor='pointer'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor='var(--eg-border)'; }}
                        style={{ textAlign:'center', minWidth:80, padding:'8px 12px', borderRadius:8, background:'var(--eg-bg)', border:'1px solid var(--eg-border)', cursor:'pointer', transition:'border-color 0.15s' }}>
                        <div style={{ fontSize:22, fontWeight:900, color:'var(--eg-accent)', fontFamily:'monospace' }}>{s.val}</div>
                        <div style={{ fontSize:10, color:'var(--eg-text-dim)', textTransform:'uppercase', fontWeight:600 }}>{s.label}</div>
                      </div>
                    ))}
                    {normaData.stats?.trend_direzione && (
                      <div
                        onClick={() => { setSelectedNorma(null); setNormaData(null); document.dispatchEvent(new CustomEvent('eg:navigateTo', {detail:{tab:'genio'}})); }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor='var(--eg-accent)'; e.currentTarget.style.cursor='pointer'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor='var(--eg-border)'; }}
                        style={{ textAlign:'center', minWidth:80, padding:'8px 12px', borderRadius:8, background:'var(--eg-bg)', border:'1px solid var(--eg-border)', cursor:'pointer', transition:'border-color 0.15s' }}>
                        <div style={{ fontSize:22, fontWeight:900, color:tC(normaData.stats.trend_direzione), fontFamily:'monospace' }}>{tI(normaData.stats.trend_direzione)}</div>
                        <div style={{ fontSize:10, color:'var(--eg-text-dim)', textTransform:'uppercase', fontWeight:600 }}>Trend ↗</div>
                      </div>
                    )}
                  </div>

                  {/* ── NORMATTIVA TESTO VIGENTE ── */}
                  <div style={{ marginBottom:14 }}>
                    {!normattivaData && !normattivaError && (
                      <button
                        onClick={fetchNormattivaAlert}
                        disabled={normattivaLoading}
                        style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:8, border:'1px solid var(--eg-border)', background:'var(--eg-bg)', color:'var(--eg-text-muted)', fontSize:12, cursor: normattivaLoading ? 'wait' : 'pointer', transition:'border-color 0.15s, color 0.15s' }}
                        onMouseEnter={e => { if(!normattivaLoading){ e.currentTarget.style.borderColor='var(--eg-accent)'; e.currentTarget.style.color='var(--eg-accent)'; }}}
                        onMouseLeave={e => { e.currentTarget.style.borderColor='var(--eg-border)'; e.currentTarget.style.color='var(--eg-text-muted)'; }}>
                        {normattivaLoading ? <span style={{ fontSize:11 }}>⏳ Caricamento...</span> : <><span>📜</span><span>Testo vigente su Normattiva</span></>}
                      </button>
                    )}
                    {normattivaError && (
                      <div style={{ fontSize:11, color:'var(--eg-danger)', padding:'6px 10px', borderRadius:6, background:'var(--eg-danger)10', border:'1px solid var(--eg-danger)30' }}>
                        {normattivaError}
                      </div>
                    )}
                    {normattivaData && !normattivaData.metadatiOnly && normattivaData.articoloHtml && (
                      <div style={{ borderRadius:8, border:'1px solid var(--eg-border)', background:'var(--eg-bg)', overflow:'hidden' }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderBottom:'1px solid var(--eg-border)' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <span style={{ fontSize:11, fontWeight:700, color:'var(--eg-accent)' }}>📜 Testo Normattiva</span>
                            {normattivaData.inVigore === true && <span style={{ fontSize:9, padding:'2px 7px', borderRadius:10, background:'var(--eg-success)20', color:'var(--eg-success)', fontWeight:700 }}>IN VIGORE</span>}
                            {normattivaData.inVigore === false && <span style={{ fontSize:9, padding:'2px 7px', borderRadius:10, background:'var(--eg-danger)20', color:'var(--eg-danger)', fontWeight:700 }}>ABROGATO</span>}
                          </div>
                          <button onClick={() => setNormattivaData(null)} style={{ background:'transparent', border:'none', color:'var(--eg-text-dim)', cursor:'pointer', fontSize:16, lineHeight:1, padding:0 }}>✕</button>
                        </div>
                        <div
                          style={{ padding:'12px 14px', fontSize:12, lineHeight:1.7, color:'var(--eg-text)', maxHeight:320, overflowY:'auto' }}
                          dangerouslySetInnerHTML={{ __html: normattivaData.articoloHtml }} />
                      </div>
                    )}
                    {normattivaData && normattivaData.metadatiOnly && (
                      <div style={{ fontSize:11, color:'var(--eg-text-muted)', padding:'6px 10px', borderRadius:6, background:'var(--eg-surface-hover)', border:'1px solid var(--eg-border)' }}>
                        📜 Testo aperto su Normattiva.it (codice storico)
                        {' '}<a href={normattivaData.link} target="_blank" rel="noopener noreferrer" style={{ color:'var(--eg-accent)' }}>Apri di nuovo</a>
                      </div>
                    )}
                  </div>

                  {/* Norme collegate */}
                  {(normaData.relazioni||[]).length > 0 && (
                    <div style={{ marginBottom:14 }}>
                      <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--eg-text-muted)', marginBottom:8 }}>Norme collegate</div>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                        {(normaData.relazioni||[]).slice(0,12).map((r,i) => (
                          <span key={i}
                            onClick={() => openNorma(r.collega)}
                            onMouseEnter={e => e.currentTarget.style.textDecoration='underline'}
                            onMouseLeave={e => e.currentTarget.style.textDecoration='none'}
                            style={{ fontSize:11, padding:'3px 10px', borderRadius:10, cursor:'pointer', background:'var(--eg-accent)12', border:'1px solid var(--eg-accent)30', color:'var(--eg-accent)', fontFamily:'monospace' }}>{r.collega}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Ultime notizie */}
                  {(normaData.notizie||[]).length > 0 && (
                    <div style={{ marginBottom:14 }}>
                      <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--eg-text-muted)', marginBottom:8 }}>Ultime notizie</div>
                      {(normaData.notizie||[]).slice(0,5).map((n,i) => (
                        <div key={i}
                          onClick={() => openArticle(n.id)}
                          onMouseEnter={e=>e.currentTarget.style.background='var(--eg-surface-hover)'}
                          onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                          style={{ padding:'6px 4px', borderBottom:i<4?'1px solid var(--eg-border)30':'none', cursor:'pointer' }}>
                          <div style={{ fontSize:12, color:'var(--eg-text)', fontWeight:600, lineHeight:1.4 }}>{n.title}</div>
                          <div style={{ fontSize:10, color:'var(--eg-text-dim)', marginTop:2, display:'flex', gap:8 }}>
                            <span>{n.source_name}</span>
                            {n.published_at && <span>{new Date(n.published_at).toLocaleDateString('it-IT')}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Ultime sentenze */}
                  {(normaData.sentenze||[]).length > 0 && (
                    <div>
                      <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--eg-text-muted)', marginBottom:8 }}>Ultime sentenze Cassazione</div>
                      {(normaData.sentenze||[]).slice(0,5).map((s,i) => (
                        <div key={i}
                          onClick={() => { setSelectedNorma(null); setNormaData(null); setPannelloSentenzaId(s.id); }}
                          onMouseEnter={e=>e.currentTarget.style.background='var(--eg-surface-hover)'}
                          onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                          style={{ padding:'6px 4px', borderBottom:i<4?'1px solid var(--eg-border)30':'none', cursor:'pointer' }}>
                          <div style={{ fontSize:12, fontWeight:600, color:'var(--eg-text)' }}>n. {s.numero}/{s.anno}{s.sezione?` — ${s.sezione}`:''}</div>
                          {s.oggetto && <div style={{ fontSize:11, color:'var(--eg-text-muted)', lineHeight:1.4, marginTop:2 }}>{s.oggetto}</div>}
                          {s.data_decisione && <div style={{ fontSize:10, color:'var(--eg-text-dim)', marginTop:2 }}>{s.data_decisione}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
            {!normaLoading && !normaData && (
              <div style={{ fontSize:12, color:'var(--eg-text-dim)', fontStyle:'italic', padding:'20px 0' }}>Nessun dato disponibile per questa norma.</div>
            )}
          </div>
        </div>
      )}

      {pannelloSentenzaId && <PannelloSentenza id={pannelloSentenzaId} onClose={() => setPannelloSentenzaId(null)} />}
    </div>
  );
}

// ─── DISCLAIMER POPUP ────────────────────────────────────────────────────────
function DisclaimerPopup({ onClose }) {
  return (
    <div onClick={onClose} style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.72)", zIndex:9900,
      display:"flex", alignItems:"center", justifyContent:"center", padding:"16px",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:"var(--eg-surface)", border:"1.5px solid var(--eg-accent)",
        borderRadius:12, maxWidth:600, width:"100%", maxHeight:"85vh",
        display:"flex", flexDirection:"column", overflow:"hidden",
        boxShadow:"0 8px 40px rgba(0,0,0,0.5)",
      }}>
        {/* Header */}
        <div style={{ padding:"18px 22px 14px", borderBottom:"1px solid var(--eg-border)", flexShrink:0 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"var(--eg-accent)", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:4 }}>⚖️ Avvertenze legali</div>
          <div style={{ fontSize:16, fontWeight:700, color:"var(--eg-text)", lineHeight:1.3 }}>Avvertenze sull'uso di Edicola Ecclesiastica</div>
        </div>
        {/* Corpo scrollabile */}
        <div style={{ padding:"18px 22px", overflowY:"auto", flex:1, fontSize:13, color:"var(--eg-text)", lineHeight:1.65 }}>
          <p style={{ marginTop:0 }}>
            Edicola Ecclesiastica utilizza sistemi di intelligenza artificiale per l'analisi, la classificazione e il collegamento di fonti giuridiche.
            In conformità con le <strong>Raccomandazioni del Consiglio Superiore della Magistratura sull'uso dell'intelligenza artificiale nell'amministrazione della giustizia</strong> (8 ottobre 2025), si raccomanda:
          </p>
          {[
            ["1. Supervisione umana", "L'intelligenza artificiale è uno strumento di supporto alla ricerca e all'analisi. Ogni output deve essere verificato da un professionista qualificato prima di qualsiasi utilizzo in sede processuale o consulenziale."],
            ["2. Verificabilità delle fonti", "Le notizie, le sentenze e le analisi presentate sono estratte da fonti pubbliche e banche dati ufficiali. È responsabilità dell'utente verificare l'attualità e la completezza delle informazioni presso le fonti originali (Normattiva, ItalgiureWeb, Gazzetta Ufficiale)."],
            ["3. Limiti dell'analisi automatica", "I livelli di Scalata (L0-L7) utilizzano algoritmi di pattern matching e modelli linguistici che possono produrre errori, omissioni o correlazioni imprecise. Le classificazioni, i contrasti giurisprudenziali e i gap normativi identificati sono indicazioni automatiche, non valutazioni giuridiche."],
            ["4. Dati personali", "Edicola Ecclesiastica non raccoglie dati personali degli utenti. Le sentenze pubblicate sono tratte da archivi pubblici nel rispetto della normativa sulla protezione dei dati."],
            ["5. Non citabilità in atti", "I contenuti generati dall'intelligenza artificiale di Edicola Ecclesiastica non sono citabili come fonti in atti giudiziari o pareri legali. Fare sempre riferimento alla fonte primaria."],
          ].map(([titolo, testo]) => (
            <div key={titolo} style={{ marginBottom:14, padding:"10px 14px", background:"var(--eg-surface-hover)", borderRadius:8, borderLeft:"3px solid var(--eg-accent)" }}>
              <div style={{ fontWeight:700, color:"var(--eg-accent)", marginBottom:4, fontSize:12 }}>{titolo}</div>
              <div style={{ color:"var(--eg-text)" }}>{testo}</div>
            </div>
          ))}
          <p style={{ marginBottom:0, fontSize:12, color:"var(--eg-text-dim)" }}>
            Per approfondimenti:{" "}
            <a href="https://www.rplt.it/wp-content/uploads/2025/11/Csm_ottobre_2025_Raccomandazioni_sull_uso_dell_intelligenza_artificiale_1_.pdf"
               target="_blank" rel="noopener noreferrer"
               style={{ color:"var(--eg-accent)", textDecoration:"underline" }}>
              Raccomandazioni CSM 8 ottobre 2025 sull'uso dell'IA nell'amministrazione della giustizia
            </a>
          </p>
        </div>
        {/* Footer */}
        <div style={{ padding:"14px 22px", borderTop:"1px solid var(--eg-border)", flexShrink:0, display:"flex", justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{
            padding:"9px 24px", background:"var(--eg-accent)", color:"#fff",
            border:"none", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer",
          }}>Ho compreso</button>
        </div>
      </div>
    </div>
  );
}

// ─── PAGINA GENIO GIURIDICO (L6) ────────────────────────────────────
function PageGenio() {
  // ── state ──
  const [activeSection, setActiveSection] = useState('chat'); // 'chat'|'collisions'|'gaps'|'trending'|'rete'
  const [collisions,    setCollisions]    = useState(null);
  const [gaps,          setGaps]          = useState(null);
  const [gapsAreas,     setGapsAreas]     = useState(null);
  const [trending,      setTrending]      = useState(null);
  const [loading,       setLoading]       = useState({});
  const [collisionDetail, setCollisionDetail] = useState(null);
  const [detailLoading,   setDetailLoading]   = useState(false);

  // ── chat state ──
  const [chatInput,      setChatInput]      = useState('');
  const [chatApprofondisci, setChatApprofondisci] = useState(false);
  const [chatLoading,    setChatLoading]    = useState(false);
  const [chatError,      setChatError]      = useState(null);
  const [chatRisposta,   setChatRisposta]   = useState(null); // ultima risposta
  const [chatHistory,    setChatHistory]    = useState([]); // [{domanda,risposta,modello,norme,timestamp}]
  const [chatExpandedIdx, setChatExpandedIdx] = useState(null); // indice history espanso
  const [chatShowCtx,    setChatShowCtx]    = useState(false); // mostra contesto grafo
  const chatEndRef = React.useRef(null);

  // ── dossier state ──
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierResult,  setDossierResult]  = useState(null);
  const [dossierError,   setDossierError]   = useState(null);
  const [dossierPannelloId, setDossierPannelloId] = useState(null);
  const chatInputRef = React.useRef(null);

  // ── memoria state ──
  const [memoriaFormOpen,  setMemoriaFormOpen]  = useState(false);
  const [memoriaLoading,   setMemoriaLoading]   = useState(false);
  const [memoriaResult,    setMemoriaResult]    = useState(null);
  const [memoriaError,     setMemoriaError]     = useState(null);
  const [memoriaForm, setMemoriaForm] = useState({
    aggravanti_contestate: 'non_verificato',
    tentativo: 'non_verificato',
    querela: 'non_verificato',
    merce_recuperata: 'non_verificato',
    risarcimento: 'non_verificato',
  });

  async function memoriaSubmit() {
    if (!dossierResult?.dossier) return;
    setMemoriaLoading(true);
    setMemoriaError(null);
    setMemoriaResult(null);
    setMemoriaFormOpen(false);
    try {
      const datiVerificati = {
        aggravanti_contestate: memoriaForm.aggravanti_contestate === 'si' ? true : memoriaForm.aggravanti_contestate === 'no' ? false : undefined,
        tentativo: memoriaForm.tentativo === 'tentativo' ? true : memoriaForm.tentativo === 'consumato' ? false : undefined,
        querela: memoriaForm.querela === 'si' ? true : memoriaForm.querela === 'no' ? false : undefined,
        merce_recuperata: memoriaForm.merce_recuperata === 'si' ? true : memoriaForm.merce_recuperata === 'no' ? false : undefined,
        risarcimento: memoriaForm.risarcimento === 'si' ? true : memoriaForm.risarcimento === 'no' ? false : undefined,
      };
      // Rimuovi undefined
      Object.keys(datiVerificati).forEach(k => datiVerificati[k] === undefined && delete datiVerificati[k]);

      const startResp = await fetch(API + '/api/genio/memoria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dossier: dossierResult.dossier, dati_verificati: datiVerificati }),
      });
      const startData = await startResp.json();
      if (!startData.ok || !startData.jobId) throw new Error(startData.errore || 'Avvio fallito');

      const jobId = startData.jobId;
      const pollStart = Date.now();
      const pollInterval = setInterval(async () => {
        try {
          if (Date.now() - pollStart > 900000) {
            clearInterval(pollInterval);
            setMemoriaError('Timeout: generazione memoria troppo lunga. Riprova.');
            setMemoriaLoading(false);
            return;
          }
          const pollResp = await fetch(API + '/api/genio/memoria/status?id=' + jobId);
          const pollData = await pollResp.json();
          if (pollData.status === 'done') {
            clearInterval(pollInterval);
            setMemoriaResult(pollData);
            setMemoriaLoading(false);
          } else if (pollData.status === 'error') {
            clearInterval(pollInterval);
            setMemoriaError(pollData.errore || 'Errore generazione memoria');
            setMemoriaLoading(false);
          }
        } catch(e) {
          setMemoriaError('Errore di rete durante polling');
          clearInterval(pollInterval);
          setMemoriaLoading(false);
        }
      }, 5000);
    } catch(e) {
      setMemoriaError(e.message);
      setMemoriaLoading(false);
    }
  }

  // ── chat submit ──
  async function chatSubmit() {
    const testo = chatInput.trim();
    if (!testo || chatLoading) return;
    setChatLoading(true);
    setChatError(null);
    setChatRisposta(null);
    setChatShowCtx(false);
    try {
      const resp = await fetch('/api/genio/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domanda: testo, approfondisci: chatApprofondisci }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.errore || 'Risposta non valida dal server');
      const entry = {
        domanda:       testo,
        risposta:      data.risposta || '',
        modello:       data.modello  || 'unknown',
        auto_fallback: data.auto_fallback || false,
        norme:         data.norme_trovate || [],
        citazioni:     data.citazioni    || [],
        contesto:      data.contesto_usato || '',
        timestamp:     Date.now(),
      };
      setChatRisposta(entry);
      setChatHistory(h => [...h.slice(-19), entry]);
      setChatInput('');
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch(e) {
      setChatError(e.message || 'Errore di rete');
    } finally {
      setChatLoading(false);
    }
  }



  // ── dossier submit — pattern async job + polling ──
  async function dossierSubmit() {
    const testo = chatInput.trim();
    if (!testo || dossierLoading) return;
    setDossierLoading(true);
    setDossierError(null);
    setDossierResult(null);
    try {
      // 1. Avvia il job — risposta immediata con jobId
      const resp = await fetch(API + '/api/genio/dossier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domanda: testo }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.errore || 'Errore avvio dossier');
      const jobId = data.jobId;
      if (!jobId) throw new Error('Nessun jobId ricevuto dal server');

      // 2. Polling ogni 5 secondi — timeout 15 minuti (doppia chiamata Sonnet + 3 DB: avvocato + PM)
      const pollStart = Date.now();
      const pollInterval = setInterval(async () => {
        try {
          if (Date.now() - pollStart > 900000) {
            clearInterval(pollInterval);
            setDossierError('Timeout: il dossier ha impiegato troppo tempo. Riprova.');
            setDossierLoading(false);
            return;
          }
          const pollResp = await fetch(API + '/api/genio/dossier/status?id=' + jobId);
          const pollData = await pollResp.json();
          if (pollData.status === 'done') {
            clearInterval(pollInterval);
            setDossierResult(pollData);
            setDossierLoading(false);
          } else if (pollData.status === 'error') {
            clearInterval(pollInterval);
            setDossierError(pollData.errore || 'Errore generazione dossier');
            setDossierLoading(false);
          }
          // se 'running', continua polling
        } catch(e) {
          clearInterval(pollInterval);
          setDossierError('Errore di rete durante polling');
          setDossierLoading(false);
        }
      }, 5000);

    } catch(e) {
      setDossierError(e.message || 'Errore di rete');
      setDossierLoading(false);
    }
  }

  // ── dossier Sonnet submit — usa claude-sonnet-4-5 per qualità massima ──
  async function dossierSonnetSubmit() {
    const testo = chatInput.trim();
    if (!testo || dossierLoading) return;
    setDossierLoading(true);
    setDossierError(null);
    setDossierResult(null);
    try {
      const resp = await fetch(API + '/api/genio/dossier-sonnet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domanda: testo }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.errore || 'Errore avvio dossier Sonnet');
      const jobId = data.jobId;
      if (!jobId) throw new Error('Nessun jobId ricevuto dal server');

      const pollStart = Date.now();
      const pollInterval = setInterval(async () => {
        try {
          if (Date.now() - pollStart > 900000) {
            clearInterval(pollInterval);
            setDossierError('Timeout: il dossier Sonnet ha impiegato troppo tempo. Riprova.');
            setDossierLoading(false);
            return;
          }
          const pollResp = await fetch(API + '/api/genio/dossier-sonnet/status?id=' + jobId);
          const pollData = await pollResp.json();
          if (pollData.status === 'done') {
            clearInterval(pollInterval);
            setDossierResult(pollData);
            setDossierLoading(false);
          } else if (pollData.status === 'error') {
            clearInterval(pollInterval);
            setDossierError(pollData.errore || 'Errore generazione dossier Sonnet');
            setDossierLoading(false);
          }
        } catch(e) {
          clearInterval(pollInterval);
          setDossierError('Errore di rete durante polling Sonnet');
          setDossierLoading(false);
        }
      }, 5000);

    } catch(e) {
      setDossierError(e.message || 'Errore di rete');
      setDossierLoading(false);
    }
  }

  // ── fetch per sezione ──
  function load(section) {
    if (section === 'chat') return; // chat non ha pre-fetch
    if (section === 'collisions' && !collisions) {
      setLoading(l => ({...l, collisions: true}));
      fetch(API + '/api/genio/collisions?limit=30')
        .then(r => r.json())
        .then(d => { setCollisions(d.collisions || []); setLoading(l => ({...l, collisions: false})); })
        .catch(() => setLoading(l => ({...l, collisions: false})));
    }
    if (section === 'gaps' && !gaps) {
      setLoading(l => ({...l, gaps: true}));
      Promise.all([
        fetch(API + '/api/genio/gaps/underserved?limit=30').then(r => r.json()),
        fetch(API + '/api/genio/gaps/areas').then(r => r.json()),
      ]).then(([gu, ga]) => {
        setGaps(gu.underserved || []);
        setGapsAreas(ga.areas || []);
        setLoading(l => ({...l, gaps: false}));
      }).catch(() => setLoading(l => ({...l, gaps: false})));
    }
    if (section === 'trending' && !trending) {
      setLoading(l => ({...l, trending: true}));
      fetch(API + '/api/genio/trending?limit=30&days=14')
        .then(r => r.json())
        .then(d => { setTrending(d.trending || []); setLoading(l => ({...l, trending: false})); })
        .catch(() => setLoading(l => ({...l, trending: false})));
    }
    if (section === 'rete' && !rete) {
      setLoading(l => ({...l, rete: true}));
      fetch(API + '/api/genio/rete/hub?limit=20')
        .then(r => r.json())
        .then(d => { setRete(d.hub || []); setLoading(l => ({...l, rete: false})); })
        .catch(() => setLoading(l => ({...l, rete: false})));
    }
    if (section === 'suggerimenti' && !suggerimenti) {
      loadSuggerimenti('');
    }
  }

  useEffect(() => { /* chat è la tab default, no pre-fetch necessario */ }, []);

  function switchSection(s) {
    setActiveSection(s);
    if (s !== 'chat') setCollisionDetail(null);
    load(s);
  }

  // ── carica dettaglio contrasto per una norma ──
  function openCollisionDetail(norma) {
    if (collisionDetail?.norma === norma) { setCollisionDetail(null); return; }
    setDetailLoading(true);
    fetch(API + '/api/genio/collisions/norma?codice=' + encodeURIComponent(norma))
      .then(r => r.json())
      .then(d => { setCollisionDetail(d); setDetailLoading(false); })
      .catch(() => setDetailLoading(false));
  }

  // ── helpers visivi ──
  const trendIcon  = t => t === 'nuova' ? '✦' : t === 'crescente' ? '↑' : t === 'calante' ? '↓' : '→';
  const trendColor = t => t === 'nuova' ? '#D4A053' : t === 'crescente' ? 'var(--eg-success)' : t === 'calante' ? 'var(--eg-danger)' : 'var(--eg-text-muted)';
  const gapColor   = tipo => tipo === 'assoluto' ? '#C45C5C' : '#D4A053';
  const gapLabel   = tipo => tipo === 'assoluto' ? 'Zero sentenze' : 'Poche sentenze';

  const [rete,            setRete]            = useState(null);
  const [reteExpanded,    setReteExpanded]    = useState(null);   // id sentenza espansa
  const [reteConnessioni, setReteConnessioni] = useState([]);     // connessioni caricate
  const [reteConnLoading, setReteConnLoading] = useState(false);  // spinner connessioni
  const [reteConnTotale,  setReteConnTotale]  = useState(0);      // totale relazioni hub

  function toggleReteHub(hub) {
    const id = hub.norma_hub;
    if (reteExpanded === id) {
      setReteExpanded(null);
      setReteConnessioni([]);
      setReteConnTotale(0);
      return;
    }
    setReteConnLoading(true);
    setReteExpanded(id);
    setReteConnessioni([]);
    fetch(API + '/api/genio/rete/sentenza/' + encodeURIComponent(id) + '?limit=50')
      .then(r => r.json())
      .then(d => {
        setReteConnessioni(d.relazioni || []);
        setReteConnTotale(d.totale || 0);
        setReteConnLoading(false);
      })
      .catch(() => setReteConnLoading(false));
  }

  // ── suggerimenti state ──────────────────────────────────────────────────────
  const [suggerimenti,        setSuggerimenti]        = useState(null);   // array caricato
  const [sugTipoFiltro,       setSugTipoFiltro]       = useState('');     // '' = tutti
  const [sugLoading,          setSugLoading]          = useState(false);
  const [sugStati,            setSugStati]            = useState({});     // id → {stato, processing}
  const [sugConteggi,         setSugConteggi]         = useState({});     // tipo → totale

  function loadSuggerimenti(tipo) {
    setSugLoading(true);
    const q = tipo ? `?stato=nuovo&tipo=${encodeURIComponent(tipo)}&limit=50` : '?stato=nuovo&limit=50';
    fetch(API + '/api/genio/suggerimenti' + q)
      .then(r => r.json())
      .then(d => {
        const list = (d.suggerimenti || []).sort((a, b) => b.confidenza - a.confidenza);
        setSuggerimenti(list);
        setSugLoading(false);
        // se carichiamo "tutti", aggiorna i conteggi per tipo
        if (!tipo) {
          const cc = {};
          for (const s of list) cc[s.tipo] = (cc[s.tipo] || 0) + 1;
          setSugConteggi(cc);
        }
      })
      .catch(() => setSugLoading(false));
  }

  function sugAction(id, azione, e) {
    e && e.stopPropagation();
    setSugStati(prev => ({ ...prev, [id]: { ...prev[id], processing: true } }));
    fetch(API + '/api/genio/suggerimenti/' + id + '/' + azione, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setSugStati(prev => ({ ...prev, [id]: { stato: azione === 'approva' ? 'approvato' : 'scartato', processing: false } }));
        } else {
          setSugStati(prev => ({ ...prev, [id]: { ...prev[id], processing: false } }));
        }
      })
      .catch(() => setSugStati(prev => ({ ...prev, [id]: { ...prev[id], processing: false } })));
  }

  const SECTIONS = [
    { id:'chat',          label:'💬 Chat',          desc:'Interroga il Genio Giuridico' },
    { id:'collisions',    label:'⚡ Contrasti',      desc:'Norme con interpretazioni opposte' },
    { id:'gaps',          label:'⚠ Gap',             desc:'Norme senza risposta giurisprudenziale' },
    { id:'trending',      label:'↑ Trending',        desc:'Norme in crescita nelle ultime 2 settimane' },
    { id:'rete',          label:'🔗 Rete',           desc:'Norme hub e connessioni tra sentenze' },
    { id:'suggerimenti',  label:'💡 Suggerimenti',   desc:'Il Genio propone, tu decidi' },
  ];

  const isLoading = loading[activeSection];

  return (
    <div style={{ maxWidth:760, margin:'0 auto' }}>

      {/* ── Header ── */}
      <div style={{ padding:'16px 16px 12px', borderBottom:'1px solid var(--eg-border)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
          <span style={{ fontSize:20 }}>⚖</span>
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:'var(--eg-text)' }}>Genio Giuridico</div>
            <div style={{ fontSize:11, color:'var(--eg-text-muted)' }}>Intelligence automatica su contrasti, gap e norme emergenti</div>
          </div>
        </div>
      </div>

      {/* ── Tab section switcher ── */}
      <div style={{ display:'flex', borderBottom:'1px solid var(--eg-border)', background:'var(--eg-surface)' }}>
        {SECTIONS.map(s => {
          const active = activeSection === s.id;
          return (
            <button key={s.id} onClick={() => switchSection(s.id)} style={{
              flex:1, padding:'10px 8px', background:'transparent', border:'none', cursor:'pointer',
              borderBottom: active ? '2px solid var(--eg-accent)' : '2px solid transparent',
              color: active ? 'var(--eg-accent)' : 'var(--eg-text-muted)',
              fontSize:12, fontWeight: active ? 700 : 500, transition:'all 0.15s',
              lineHeight:1.3,
            }}>
              <div>{s.label}</div>
              <div style={{ fontSize:9, opacity:0.7, marginTop:1 }}>{s.desc}</div>
            </button>
          );
        })}
      </div>

      {/* ── Loading ── */}
      {isLoading && (
        <div style={{ padding:32, textAlign:'center', color:'var(--eg-text-muted)', fontSize:13 }}>
          Analisi in corso…
        </div>
      )}

      {/* ══════════════════════════════════════════
          SEZIONE CHAT
      ══════════════════════════════════════════ */}
      {activeSection === 'chat' && (
        <div style={{ display:'flex', flexDirection:'column', minHeight:400 }}>

          {/* ── Storico messaggi ── */}
          {chatHistory.length > 0 && (
            <div style={{ borderBottom:'1px solid var(--eg-border)' }}>
              {chatHistory.slice(0, -1).map((entry, idx) => {
                const isExp = chatExpandedIdx === idx;
                return (
                  <div key={idx} style={{ borderBottom:'1px solid var(--eg-border)' }}>
                    {/* domanda collassata */}
                    <div
                      onClick={() => setChatExpandedIdx(isExp ? null : idx)}
                      style={{
                        padding:'8px 16px', cursor:'pointer', display:'flex', alignItems:'center', gap:8,
                        background: isExp ? 'var(--eg-surface)' : 'transparent',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background='var(--eg-surface-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background= isExp ? 'var(--eg-surface)' : 'transparent'}
                    >
                      <span style={{ fontSize:11, color:'var(--eg-text-dim)', flexShrink:0 }}>
                        {new Date(entry.timestamp).toLocaleTimeString('it-IT', {hour:'2-digit',minute:'2-digit'})}
                      </span>
                      <span style={{ fontSize:12, color:'var(--eg-text-muted)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {entry.domanda}
                      </span>
                      <span style={{
                        fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:3, flexShrink:0,
                        background: entry.modello === 'sonar-auto' ? '#C87C2022' : entry.modello === 'sonar' ? '#1E6FAB22' : '#55555522',
                        color:      entry.modello === 'sonar-auto' ? '#C87C20'   : entry.modello === 'sonar' ? '#1E6FAB'   : 'var(--eg-text-dim)',
                        border:     `1px solid ${entry.modello === 'sonar-auto' ? '#C87C2044' : entry.modello === 'sonar' ? '#1E6FAB44' : 'var(--eg-border)'}`,
                      }}>{entry.modello === 'deep-research' ? '🧠 Deep' : entry.modello === 'sonar-auto' ? '⚡ Sonar (auto)' : entry.modello === 'sonar' ? '🔍 Sonar' : entry.modello === 'sonar-fallback' ? '🔍 Sonar (fb)' : entry.modello === 'sonnet' ? '🔵 Sonnet' : '⚡ Haiku'}</span>
                      <span style={{ fontSize:10, color:'var(--eg-text-dim)' }}>{isExp ? '▲' : '▼'}</span>
                    </div>
                    {/* risposta espansa */}
                    {isExp && (
                      <div style={{ padding:'10px 16px 12px 40px', background:'var(--eg-surface)' }}>
                        <div style={{ fontSize:12, color:'var(--eg-text)', whiteSpace:'pre-wrap', lineHeight:1.6 }}>
                          {entry.risposta}
                        </div>
                        {entry.norme.length > 0 && (
                          <div style={{ marginTop:8, display:'flex', flexWrap:'wrap', gap:4 }}>
                            {entry.norme.map((n,ni) => (
                              <span key={ni}
                                onClick={() => document.dispatchEvent(new CustomEvent('eg:openNorma', {detail:{codice:n}}))}
                                onMouseEnter={e => e.currentTarget.style.textDecoration='underline'}
                                onMouseLeave={e => e.currentTarget.style.textDecoration='none'}
                                style={{ fontSize:10, padding:'1px 6px', borderRadius:3, background:'var(--eg-accent-dim,rgba(212,160,83,0.12))', color:'var(--eg-accent)', border:'1px solid var(--eg-accent-border,rgba(212,160,83,0.3))', fontFamily:"'JetBrains Mono',monospace", cursor:'pointer' }}>{n}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Risposta corrente ── */}
          {chatRisposta && (
            <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--eg-border)', background:'var(--eg-surface)' }}>
              {/* header risposta */}
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom: chatRisposta.auto_fallback ? 8 : 10 }}>
                <span style={{ fontSize:12, fontWeight:700, color:'var(--eg-text-muted)' }}>Risposta</span>
                <span style={{
                  fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4,
                  background: chatRisposta.modello === 'deep-research' ? '🧠 Deep Research'
                 : chatRisposta.modello === 'sonar-auto' ? '#C87C2022'
                            : chatRisposta.modello === 'sonar'      ? '#1E6FAB22'
                            : chatRisposta.modello === 'sonar-fallback' ? '#1E6FAB11' : '#55555518',
                  color:      chatRisposta.modello === 'sonar-auto' ? '#C87C20'
                            : chatRisposta.modello === 'sonar'      ? '#1E6FAB'
                            : chatRisposta.modello === 'sonar-fallback' ? '#4A90C0' : 'var(--eg-text-muted)',
                  border:     `1px solid ${chatRisposta.modello === 'sonar-auto' ? '#C87C2044' : chatRisposta.modello === 'sonar' ? '#1E6FAB44' : 'var(--eg-border)'}`,
                }}>
                  {chatRisposta.modello === 'sonar-auto'    ? '⚡ Sonar (auto)'
                 : chatRisposta.modello === 'sonar'         ? '🔍 Sonar'
                 : chatRisposta.modello === 'sonar-fallback' ? '🔍 Sonar (fallback)'
                 : chatRisposta.modello === 'sonnet' ? '🔵 Sonnet' : '⚡ Haiku'}
                </span>
              </div>

              {/* avviso auto-fallback */}
              {chatRisposta.auto_fallback && (
                <div style={{ marginBottom:10, padding:'7px 10px', background:'rgba(200,124,32,0.08)', border:'1px solid rgba(200,124,32,0.25)', borderRadius:6, fontSize:11, color:'#C87C20', lineHeight:1.5 }}>
                  ⚠️ Il grafo non aveva dati sufficienti su questo tema. Ho cercato fonti esterne automaticamente.
                </div>
              )}

              {/* testo risposta */}
              <div style={{ fontSize:13, color:'var(--eg-text)', whiteSpace:'pre-wrap', lineHeight:1.7 }}>
                {chatRisposta.risposta}
              </div>

              {/* citazioni */}
              {chatRisposta.citazioni.length > 0 && (
                <div style={{ marginTop:12 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'var(--eg-text-muted)', marginBottom:4 }}>Fonti:</div>
                  {chatRisposta.citazioni.map((cit, ci) => (
                    <div key={ci} style={{ fontSize:11, marginBottom:2 }}>
                      <a href={cit} target="_blank" rel="noreferrer" style={{ color:'var(--eg-accent)', textDecoration:'none', wordBreak:'break-all' }}
                        onMouseEnter={e => e.target.style.textDecoration='underline'}
                        onMouseLeave={e => e.target.style.textDecoration='none'}
                      >{cit}</a>
                    </div>
                  ))}
                </div>
              )}

              {/* norme trovate */}
              {chatRisposta.norme.length > 0 && (
                <div style={{ marginTop:10 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'var(--eg-text-muted)', marginBottom:4 }}>Norme trovate:</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                    {chatRisposta.norme.map((n,ni) => (
                      <span key={ni}
                        onClick={() => document.dispatchEvent(new CustomEvent('eg:openNorma', {detail:{codice:n}}))}
                        onMouseEnter={e => { e.currentTarget.style.textDecoration='underline'; e.currentTarget.style.cursor='pointer'; }}
                        onMouseLeave={e => e.currentTarget.style.textDecoration='none'}
                        style={{ fontSize:10, padding:'2px 7px', borderRadius:3, background:'var(--eg-accent-dim,rgba(212,160,83,0.12))', color:'var(--eg-accent)', border:'1px solid var(--eg-accent-border,rgba(212,160,83,0.3))', fontFamily:"'JetBrains Mono',monospace", cursor:'pointer' }}>{n}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* contesto grafo collassabile */}
              {chatRisposta.contesto && (
                <div style={{ marginTop:10 }}>
                  <button
                    onClick={() => setChatShowCtx(v => !v)}
                    style={{ fontSize:10, color:'var(--eg-text-dim)', background:'none', border:'none', cursor:'pointer', padding:0, display:'flex', alignItems:'center', gap:4 }}
                  >
                    <span>{chatShowCtx ? '▲' : '▼'}</span>
                    <span>Contesto dal grafo usato</span>
                  </button>
                  {chatShowCtx && (
                    <div style={{ marginTop:6, padding:'8px 10px', background:'var(--eg-bg)', borderRadius:4, border:'1px solid var(--eg-border)', fontSize:10, color:'var(--eg-text-dim)', fontFamily:"'JetBrains Mono',monospace", whiteSpace:'pre-wrap', lineHeight:1.5, maxHeight:200, overflowY:'auto' }}>
                      {chatRisposta.contesto}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Errore ── */}
          {chatError && (
            <div style={{ margin:'12px 16px', padding:'10px 14px', background:'rgba(196,92,92,0.08)', border:'1px solid rgba(196,92,92,0.3)', borderRadius:6 }}>
              <div style={{ fontSize:12, color:'#C45C5C', marginBottom:6 }}>⚠ {chatError}</div>
              <button
                onClick={() => { setChatError(null); chatSubmit(); }}
                style={{ fontSize:11, padding:'3px 10px', borderRadius:4, background:'#C45C5C', color:'#fff', border:'none', cursor:'pointer' }}
              >Riprova</button>
            </div>
          )}

          {/* ── Loading ── */}
          {chatLoading && (
            <div style={{ padding:'20px 16px', display:'flex', alignItems:'center', gap:10, color:'var(--eg-text-muted)', fontSize:13 }}>
              <span style={{ display:'inline-block', width:14, height:14, borderRadius:'50%', border:'2px solid var(--eg-accent)', borderTopColor:'transparent', animation:'spin 0.8s linear infinite' }}/>
              Il Genio sta analizzando il grafo…
            </div>
          )}

          <div ref={chatEndRef} />

          {/* ── Input area ── */}
          <div style={{ padding:'12px 16px', borderTop:'1px solid var(--eg-border)', background:'var(--eg-bg)', marginTop:'auto' }}>
            {/* textarea + contatore */}
            <div style={{ position:'relative', marginBottom:8 }}>
              <textarea
                ref={chatInputRef}
                value={chatInput}
                onChange={e => setChatInput(e.target.value.substring(0, 500))}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); dossierSonnetSubmit(); } }}
                placeholder="Chiedi al Genio… es: Qual è l'orientamento sul GDPR? Come si impugna con art. 360 c.p.c.?"
                rows={3}
                disabled={chatLoading}
                style={{
                  width:'100%', boxSizing:'border-box', resize:'vertical',
                  padding:'10px 12px', paddingBottom:18,
                  background:'var(--eg-surface)', border:'1px solid var(--eg-border)',
                  borderRadius:6, color:'var(--eg-text)', fontSize:13, lineHeight:1.5,
                  fontFamily:'inherit', outline:'none',
                  opacity: chatLoading ? 0.6 : 1,
                }}
              />
              <span style={{ position:'absolute', bottom:5, right:8, fontSize:9, color:'var(--eg-text-dim)' }}>
                {chatInput.length}/500
              </span>
            </div>

            {/* bottone unico */}
            <div style={{ display:'flex', justifyContent:'flex-end' }}>
              <button
                onClick={dossierSonnetSubmit}
                disabled={dossierLoading || !chatInput.trim()}
                style={{
                  padding:'8px 24px', borderRadius:6, border:'none',
                  cursor: dossierLoading || !chatInput.trim() ? 'not-allowed' : 'pointer',
                  background: dossierLoading || !chatInput.trim() ? 'var(--eg-surface)' : '#D4A843',
                  color:      dossierLoading || !chatInput.trim() ? 'var(--eg-text-dim)' : '#1a1005',
                  fontWeight:700, fontSize:13, transition:'background 0.15s',
                }}
                onMouseEnter={e => { if (!dossierLoading && chatInput.trim()) e.currentTarget.style.background='#e0b84e'; }}
                onMouseLeave={e => { if (!dossierLoading && chatInput.trim()) e.currentTarget.style.background='#D4A843'; }}
              >
                {dossierLoading
                  ? <span style={{ display:'inline-flex', alignItems:'center', gap:7 }}><span style={{ display:'inline-block', width:12, height:12, border:'2px solid #1a1005', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.8s linear infinite' }}/>Analisi in corso…</span>
                  : 'Analizza'}
              </button>
            </div>

            <div style={{ marginTop:8, fontSize:10, color:'var(--eg-text-dim)', lineHeight:1.4 }}>
              Analisi basata su grafo giuridico, sentenze Cassazione e norme.
            </div>
          </div>

          {/* ── DOSSIER LOADING ── */}
          {dossierLoading && (
            <div style={{ margin:'16px 16px 0', padding:'24px 20px', borderRadius:10, border:'1px solid var(--eg-accent)40', background:'var(--eg-surface)', textAlign:'center' }}>
              <div style={{ display:'inline-block', width:28, height:28, border:'3px solid var(--eg-accent)', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.8s linear infinite', marginBottom:12 }} />
              <div style={{ fontSize:13, color:'var(--eg-text)', fontWeight:600 }}>Il Genio sta preparando il dossier…</div>
              <div style={{ fontSize:11, color:'var(--eg-text-muted)', marginTop:4 }}>Può richiedere 30–60 secondi</div>
            </div>
          )}

          {/* ── DOSSIER ERROR ── */}
          {dossierError && (
            <div style={{ margin:'16px 16px 0', padding:'12px 16px', borderRadius:8, border:'1px solid var(--eg-danger)40', background:'var(--eg-danger)10', fontSize:12, color:'var(--eg-danger)' }}>
              ⚠ {dossierError}
            </div>
          )}

          {/* ── DOSSIER RESULT ── */}
          {dossierResult && (
            <div style={{ margin:'16px 16px 0 16px', borderRadius:10, border:'1px solid var(--eg-accent)50', background:'var(--eg-surface)', overflow:'hidden' }}>
              {/* Header */}
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', borderBottom:'1px solid var(--eg-border)', background:'var(--eg-accent)08', flexWrap:'wrap' }}>
                <span style={{ fontSize:13, fontWeight:800, color:'var(--eg-accent)' }}>📋 DOSSIER GIURIDICO</span>
                <span style={{ fontSize:10, padding:'2px 8px', borderRadius:10, background:'#1E6FAB30', color:'#5BA3D9', fontWeight:700 }}>SONNET</span>
                {(dossierResult.norme || []).map((n, i) => (
                  <span key={i} style={{ fontSize:10, padding:'2px 8px', borderRadius:10, background:'var(--eg-accent)15', color:'var(--eg-accent)', fontWeight:600, fontFamily:'monospace' }}>{n}</span>
                ))}
                <span style={{ marginLeft:'auto', fontSize:10, color:'var(--eg-text-dim)' }}>{dossierResult.contesto_chars} chars contesto</span>
              </div>
              {/* Corpo markdown */}
              <div
                style={{ padding:'20px 24px', fontSize:13, lineHeight:1.7, color:'var(--eg-text)', maxHeight:700, overflowY:'auto', maxWidth:860 }}
                dangerouslySetInnerHTML={{ __html: mdToHtml(dossierResult.dossier) }}
                onClick={e => {
                  const t = e.target.closest('.sentenza-link');
                  if (!t) return;
                  const numero = t.dataset.numero;
                  const anno   = t.dataset.anno;
                  if (!numero || !anno) return;
                  fetch(API + `/api/sentenze?numero=${numero}&anno=${anno}&limit=1`)
                    .then(r => r.json())
                    .then(d => {
                      const s = (d.sentenze || [])[0];
                      if (s?.id) setDossierPannelloId(s.id);
                    })
                    .catch(() => {});
                }}
              />
              {/* Azioni */}
              <div style={{ display:'flex', gap:8, padding:'12px 16px', borderTop:'1px solid var(--eg-border)', background:'var(--eg-bg)', flexWrap:'wrap' }}>
                <button
                  onClick={() => navigator.clipboard.writeText(dossierResult.dossier).catch(()=>{})}
                  style={{ padding:'5px 12px', borderRadius:5, border:'1px solid var(--eg-border)', background:'transparent', color:'var(--eg-text-muted)', fontSize:11, cursor:'pointer', transition:'border-color 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor='var(--eg-accent)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor='var(--eg-border)'}
                >📋 Copia testo</button>
                <button
                  onClick={() => { setMemoriaFormOpen(v => !v); setMemoriaResult(null); setMemoriaError(null); }}
                  disabled={memoriaLoading}
                  style={{ padding:'5px 12px', borderRadius:5, border:'1px solid #4A9960', background: memoriaFormOpen ? '#4A996018' : 'transparent', color:'#4A9960', fontSize:11, cursor:'pointer', fontWeight:600, transition:'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background='#4A996020'; }}
                  onMouseLeave={e => { e.currentTarget.style.background= memoriaFormOpen ? '#4A996018' : 'transparent'; }}
                >{memoriaLoading ? '⏳ Generando memoria…' : '⚖️ Genera Memoria Difensiva'}</button>
                <button
                  onClick={() => { setDossierResult(null); setDossierError(null); setMemoriaResult(null); setMemoriaFormOpen(false); setTimeout(() => chatInputRef.current?.focus(), 50); }}
                  style={{ padding:'5px 12px', borderRadius:5, border:'1px solid var(--eg-border)', background:'transparent', color:'var(--eg-text-muted)', fontSize:11, cursor:'pointer', transition:'border-color 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor='var(--eg-accent)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor='var(--eg-border)'}
                >🔄 Nuovo dossier</button>
              </div>

              {/* ── Form dati verificati per la memoria ── */}
              {memoriaFormOpen && !memoriaLoading && (
                <div style={{ padding:'16px', borderTop:'1px solid #4A996030', background:'#4A996008' }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'#4A9960', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:12 }}>Dati da verificare prima della memoria</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 20px', marginBottom:14 }}>

                    {/* Aggravanti */}
                    <div>
                      <label style={{ fontSize:11, color:'var(--eg-text-muted)', display:'block', marginBottom:4 }}>Aggravanti art. 625 contestate?</label>
                      <select value={memoriaForm.aggravanti_contestate}
                        onChange={e => setMemoriaForm(f => ({...f, aggravanti_contestate: e.target.value}))}
                        style={{ fontSize:11, padding:'4px 8px', borderRadius:4, border:'1px solid var(--eg-border)', background:'var(--eg-bg)', color:'var(--eg-text)', width:'100%' }}>
                        <option value="non_verificato">Non verificato</option>
                        <option value="si">Sì — contestate</option>
                        <option value="no">No — solo art. 624</option>
                      </select>
                    </div>

                    {/* Tentativo */}
                    <div>
                      <label style={{ fontSize:11, color:'var(--eg-text-muted)', display:'block', marginBottom:4 }}>Tentativo o consumato?</label>
                      <select value={memoriaForm.tentativo}
                        onChange={e => setMemoriaForm(f => ({...f, tentativo: e.target.value}))}
                        style={{ fontSize:11, padding:'4px 8px', borderRadius:4, border:'1px solid var(--eg-border)', background:'var(--eg-bg)', color:'var(--eg-text)', width:'100%' }}>
                        <option value="non_verificato">Non verificato</option>
                        <option value="tentativo">Tentativo (art. 56)</option>
                        <option value="consumato">Consumato</option>
                      </select>
                    </div>

                    {/* Querela */}
                    <div>
                      <label style={{ fontSize:11, color:'var(--eg-text-muted)', display:'block', marginBottom:4 }}>Querela presentata?</label>
                      <select value={memoriaForm.querela}
                        onChange={e => setMemoriaForm(f => ({...f, querela: e.target.value}))}
                        style={{ fontSize:11, padding:'4px 8px', borderRadius:4, border:'1px solid var(--eg-border)', background:'var(--eg-bg)', color:'var(--eg-text)', width:'100%' }}>
                        <option value="non_verificato">Non verificato</option>
                        <option value="si">Sì</option>
                        <option value="no">No</option>
                      </select>
                    </div>

                    {/* Merce recuperata */}
                    <div>
                      <label style={{ fontSize:11, color:'var(--eg-text-muted)', display:'block', marginBottom:4 }}>Merce recuperata?</label>
                      <select value={memoriaForm.merce_recuperata}
                        onChange={e => setMemoriaForm(f => ({...f, merce_recuperata: e.target.value}))}
                        style={{ fontSize:11, padding:'4px 8px', borderRadius:4, border:'1px solid var(--eg-border)', background:'var(--eg-bg)', color:'var(--eg-text)', width:'100%' }}>
                        <option value="non_verificato">Non verificato</option>
                        <option value="si">Sì — recuperata</option>
                        <option value="no">No</option>
                      </select>
                    </div>

                    {/* Risarcimento */}
                    <div>
                      <label style={{ fontSize:11, color:'var(--eg-text-muted)', display:'block', marginBottom:4 }}>Risarcimento effettuato?</label>
                      <select value={memoriaForm.risarcimento}
                        onChange={e => setMemoriaForm(f => ({...f, risarcimento: e.target.value}))}
                        style={{ fontSize:11, padding:'4px 8px', borderRadius:4, border:'1px solid var(--eg-border)', background:'var(--eg-bg)', color:'var(--eg-text)', width:'100%' }}>
                        <option value="non_verificato">Non verificato</option>
                        <option value="si">Sì</option>
                        <option value="no">No</option>
                      </select>
                    </div>
                  </div>

                  <button
                    onClick={memoriaSubmit}
                    style={{ padding:'7px 18px', borderRadius:6, border:'none', background:'#4A9960', color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer', letterSpacing:'0.04em' }}
                    onMouseEnter={e => e.currentTarget.style.background='#3d8550'}
                    onMouseLeave={e => e.currentTarget.style.background='#4A9960'}
                  >⚖️ Genera Memoria Difensiva</button>
                  <span style={{ marginLeft:10, fontSize:10, color:'var(--eg-text-dim)' }}>~2-3 min · Claude Sonnet</span>
                </div>
              )}
            </div>
          )}

          {/* ── MEMORIA ERROR ── */}
          {memoriaError && (
            <div style={{ margin:'12px 16px 0', padding:'10px 14px', borderRadius:7, border:'1px solid #C45C5C40', background:'#C45C5C0D', fontSize:12, color:'#C45C5C' }}>
              ⚠ {memoriaError}
            </div>
          )}

          {/* ── MEMORIA LOADING ── */}
          {memoriaLoading && (
            <div style={{ margin:'12px 16px 0', padding:'14px 16px', borderRadius:8, border:'1px solid #4A996030', background:'#4A996008', display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontSize:18, animation:'spin 1.2s linear infinite', display:'inline-block' }}>⚖️</span>
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:'#4A9960' }}>Generando memoria difensiva…</div>
                <div style={{ fontSize:11, color:'var(--eg-text-dim)', marginTop:2 }}>Claude Sonnet sta redigendo la memoria ex art. 121 c.p.p. (~2-3 min)</div>
              </div>
            </div>
          )}

          {/* ── MEMORIA RESULT ── */}
          {memoriaResult?.memoria && (
            <div style={{ margin:'12px 16px 0 16px', borderRadius:10, border:'1px solid #4A996050', background:'var(--eg-surface)', overflow:'hidden' }}>
              {/* Header */}
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', borderBottom:'1px solid var(--eg-border)', background:'#4A996010', flexWrap:'wrap' }}>
                <span style={{ fontSize:13, fontWeight:800, color:'#4A9960' }}>⚖️ MEMORIA DIFENSIVA</span>
                <span style={{ fontSize:10, padding:'2px 8px', borderRadius:10, background:'#4A996025', color:'#4A9960', fontWeight:700 }}>SONNET</span>
                <span style={{ fontSize:10, padding:'2px 8px', borderRadius:10, background:'#4A996015', color:'#4A9960', fontWeight:600 }}>ex art. 121 c.p.p.</span>
                <span style={{ marginLeft:'auto', fontSize:10, color:'var(--eg-text-dim)' }}>{memoriaResult.costo_stimato}</span>
              </div>
              {/* Corpo markdown */}
              <div
                style={{ padding:'20px 24px', fontSize:13, lineHeight:1.7, color:'var(--eg-text)', maxHeight:700, overflowY:'auto', maxWidth:860 }}
                dangerouslySetInnerHTML={{ __html: mdToHtml(memoriaResult.memoria) }}
              />
              {/* Azioni */}
              <div style={{ display:'flex', gap:8, padding:'12px 16px', borderTop:'1px solid var(--eg-border)', background:'var(--eg-bg)' }}>
                <button
                  onClick={() => navigator.clipboard.writeText(memoriaResult.memoria).catch(()=>{})}
                  style={{ padding:'5px 12px', borderRadius:5, border:'1px solid var(--eg-border)', background:'transparent', color:'var(--eg-text-muted)', fontSize:11, cursor:'pointer', transition:'border-color 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor='#4A9960'}
                  onMouseLeave={e => e.currentTarget.style.borderColor='var(--eg-border)'}
                >📋 Copia memoria</button>
                <button
                  onClick={() => { setMemoriaResult(null); setMemoriaError(null); setMemoriaFormOpen(true); }}
                  style={{ padding:'5px 12px', borderRadius:5, border:'1px solid var(--eg-border)', background:'transparent', color:'var(--eg-text-muted)', fontSize:11, cursor:'pointer', transition:'border-color 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor='var(--eg-accent)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor='var(--eg-border)'}
                >🔄 Rigenera</button>
              </div>
            </div>
          )}

          {dossierPannelloId && <PannelloSentenza id={dossierPannelloId} onClose={() => setDossierPannelloId(null)} />}

        </div>
      )}

      {/* ══════════════════════════════════════════
          SEZIONE COLLISIONS
      ══════════════════════════════════════════ */}
      {!isLoading && activeSection === 'collisions' && (
        <div>
          <div style={{ padding:'10px 16px', background:'rgba(196,92,92,0.06)', borderBottom:'1px solid var(--eg-border)' }}>
            <span style={{ fontSize:11, color:'#C45C5C', fontWeight:600 }}>
              {collisions ? `${collisions.length} norme con contrasti interpretativi aperti` : '—'}
            </span>
            <span style={{ fontSize:10, color:'var(--eg-text-dim)', marginLeft:8 }}>
              Fonte: relazioni_sentenze Cassazione
            </span>
          </div>

          {(collisions || []).map((c, i) => {
            const isOpen = collisionDetail?.norma === c.codice_norma;
            return (
              <div key={i}>
                {/* Riga principale */}
                <div
                  onClick={() => openCollisionDetail(c.codice_norma)}
                  onMouseEnter={e => e.currentTarget.style.background='var(--eg-surface-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background= isOpen ? 'rgba(196,92,92,0.05)' : 'transparent'}
                  style={{
                    padding:'12px 16px', borderBottom:'1px solid var(--eg-border)',
                    cursor:'pointer', display:'flex', alignItems:'center', gap:12,
                    background: isOpen ? 'rgba(196,92,92,0.05)' : 'transparent',
                  }}>
                  {/* rank */}
                  <div style={{ width:24, height:24, borderRadius:5, background:'#C45C5C22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, color:'#C45C5C', flexShrink:0 }}>
                    {i+1}
                  </div>
                  {/* norma */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div
                      onClick={e => { e.stopPropagation(); document.dispatchEvent(new CustomEvent('eg:openNorma', {detail:{codice:c.codice_norma}})); }}
                      onMouseEnter={e => e.currentTarget.style.textDecoration='underline'}
                      onMouseLeave={e => e.currentTarget.style.textDecoration='none'}
                      style={{ fontSize:13, fontWeight:700, color:'var(--eg-accent)', fontFamily:"'JetBrains Mono',monospace", whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', cursor:'pointer' }}>
                      {c.codice_norma}
                    </div>
                    <div style={{ fontSize:10, color:'var(--eg-text-muted)', marginTop:2 }}>
                      Ultimo contrasto: {c.ultimo_contrasto_data ? c.ultimo_contrasto_data.substring(0,10) : '—'}
                    </div>
                  </div>
                  {/* badges */}
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3, flexShrink:0 }}>
                    <span style={{ fontSize:12, fontWeight:800, color:'#C45C5C' }}>
                      {c.num_contrasti} <span style={{ fontSize:9, fontWeight:500 }}>contrasti</span>
                    </span>
                    <span style={{ fontSize:10, color:'var(--eg-text-dim)' }}>
                      {c.num_sentenze_coinvolte} sentenze
                    </span>
                  </div>
                  <span style={{ color: isOpen ? 'var(--eg-accent)' : 'var(--eg-text-dim)', fontSize:11 }}>{isOpen ? '▲' : '▼'}</span>
                </div>

                {/* Dettaglio espanso */}
                {isOpen && (
                  <div style={{ background:'rgba(196,92,92,0.04)', borderBottom:'1px solid var(--eg-border)', padding:'12px 16px 14px 56px' }}>
                    {detailLoading && <div style={{ fontSize:12, color:'var(--eg-text-muted)', fontStyle:'italic' }}>Caricamento dettagli…</div>}
                    {collisionDetail && !detailLoading && (
                      <>
                        <div style={{ fontSize:11, fontWeight:600, color:'var(--eg-text-muted)', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                          Esempi di contrasto ({collisionDetail.num_contrasti} totali)
                        </div>
                        {(collisionDetail.contrasti || []).slice(0, 4).map((ct, j) => (
                          <div key={j} style={{ marginBottom:10, padding:'8px 10px', background:'var(--eg-surface)', borderRadius:6, border:'1px solid var(--eg-border)' }}>
                            <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
                              {/* Sentenza A */}
                              <div style={{ flex:1, minWidth:0 }}>
                                <div
                                  onClick={() => ct.sentenza_a && document.dispatchEvent(new CustomEvent('eg:openSentenza', {detail:{id:ct.sentenza_a}}))}
                                  onMouseEnter={e => { if(ct.sentenza_a) e.currentTarget.style.textDecoration='underline'; }}
                                  onMouseLeave={e => e.currentTarget.style.textDecoration='none'}
                                  style={{ fontSize:10, fontWeight:700, color:'#5B9BD5', marginBottom:2, cursor: ct.sentenza_a ? 'pointer' : 'default' }}>{ct.label_a || ct.sentenza_a}</div>
                                {ct.data_a && <div style={{ fontSize:9, color:'var(--eg-text-dim)' }}>{ct.data_a?.substring(0,10)} · {ct.sezione_a || '—'}</div>}
                                {ct.oggetto_a && <div style={{ fontSize:10, color:'var(--eg-text-muted)', marginTop:2, lineHeight:1.4 }}>{ct.oggetto_a.substring(0,80)}</div>}
                              </div>
                              <div style={{ color:'#C45C5C', fontWeight:700, fontSize:14, flexShrink:0, paddingTop:2 }}>⚡</div>
                              {/* Sentenza B */}
                              <div style={{ flex:1, minWidth:0 }}>
                                <div
                                  onClick={() => ct.sentenza_b && document.dispatchEvent(new CustomEvent('eg:openSentenza', {detail:{id:ct.sentenza_b}}))}
                                  onMouseEnter={e => { if(ct.sentenza_b) e.currentTarget.style.textDecoration='underline'; }}
                                  onMouseLeave={e => e.currentTarget.style.textDecoration='none'}
                                  style={{ fontSize:10, fontWeight:700, color:'#5B9BD5', marginBottom:2, cursor: ct.sentenza_b ? 'pointer' : 'default' }}>{ct.label_b || ct.sentenza_b}</div>
                                {ct.data_b && <div style={{ fontSize:9, color:'var(--eg-text-dim)' }}>{ct.data_b?.substring(0,10)} · {ct.sezione_b || '—'}</div>}
                                {ct.oggetto_b && <div style={{ fontSize:10, color:'var(--eg-text-muted)', marginTop:2, lineHeight:1.4 }}>{ct.oggetto_b.substring(0,80)}</div>}
                              </div>
                            </div>
                            {/* massime se presenti */}
                            {(ct.massima_a || ct.massima_b) && (
                              <div style={{ marginTop:6, paddingTop:6, borderTop:'1px solid var(--eg-border)', display:'flex', gap:8 }}>
                                {ct.massima_a && <div style={{ flex:1, fontSize:9, color:'var(--eg-text-dim)', fontStyle:'italic', lineHeight:1.5 }}>"{ct.massima_a.substring(0,120)}…"</div>}
                                {ct.massima_b && <div style={{ flex:1, fontSize:9, color:'var(--eg-text-dim)', fontStyle:'italic', lineHeight:1.5 }}>"{ct.massima_b.substring(0,120)}…"</div>}
                              </div>
                            )}
                          </div>
                        ))}
                        {collisionDetail.num_contrasti > 4 && (
                          <div style={{ fontSize:10, color:'var(--eg-text-dim)', fontStyle:'italic' }}>
                            + altri {collisionDetail.num_contrasti - 4} contrasti non mostrati
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {!isLoading && (collisions||[]).length === 0 && (
            <div style={{ padding:24, color:'var(--eg-text-muted)', fontSize:13, textAlign:'center' }}>
              Nessun contrasto rilevato
            </div>
          )}

          <div style={{ padding:'10px 16px', color:'var(--eg-text-dim)', fontSize:10, lineHeight:1.5, borderTop:'1px solid var(--eg-border)' }}>
            I contrasti sono rilevati automaticamente tra sentenze della Cassazione che interpretano diversamente la stessa norma.
            Clicca su una norma per vedere le coppie di sentenze in conflitto.
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          SEZIONE GAPS
      ══════════════════════════════════════════ */}
      {!isLoading && activeSection === 'gaps' && (
        <div>
          {/* Sub-header: mappa aree */}
          {gapsAreas && gapsAreas.length > 0 && (
            <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--eg-border)', display:'flex', flexWrap:'wrap', gap:6 }}>
              {gapsAreas.slice(0,8).map((a, i) => (
                <span key={i} style={{
                  fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:10,
                  background:'rgba(212,160,83,0.12)', color:'#D4A053',
                  border:'1px solid rgba(212,160,83,0.25)',
                }}>
                  {a.area} <span style={{ opacity:0.7 }}>({a.gap_count})</span>
                </span>
              ))}
            </div>
          )}

          <div style={{ padding:'8px 16px', background:'rgba(212,160,83,0.06)', borderBottom:'1px solid var(--eg-border)' }}>
            <span style={{ fontSize:11, color:'#D4A053', fontWeight:600 }}>
              {gaps ? `${gaps.length} norme con alta attenzione mediatica e poca giurisprudenza` : '—'}
            </span>
          </div>

          {(gaps || []).map((g, i) => (
            <div key={i}
              style={{ padding:'11px 16px', borderBottom:'1px solid var(--eg-border)', display:'flex', alignItems:'flex-start', gap:12 }}>
              {/* rank */}
              <div style={{ width:24, height:24, borderRadius:5, background: gapColor(g.tipo_gap)+'22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, color:gapColor(g.tipo_gap), flexShrink:0 }}>
                {i+1}
              </div>
              {/* corpo */}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                  <span
                    onClick={() => document.dispatchEvent(new CustomEvent('eg:openNorma', {detail:{codice:g.codice_norma}}))}
                    onMouseEnter={e => e.currentTarget.style.textDecoration='underline'}
                    onMouseLeave={e => e.currentTarget.style.textDecoration='none'}
                    style={{ fontSize:13, fontWeight:700, color:'var(--eg-accent)', fontFamily:"'JetBrains Mono',monospace", cursor:'pointer' }}>
                    {g.codice_norma}
                  </span>
                  <span style={{ fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:3,
                    background: gapColor(g.tipo_gap)+'22', color: gapColor(g.tipo_gap),
                    border:`1px solid ${gapColor(g.tipo_gap)}40` }}>
                    {gapLabel(g.tipo_gap)}
                  </span>
                  <span style={{ fontSize:9, padding:'1px 6px', borderRadius:3, background:'var(--eg-surface)', color:'var(--eg-text-muted)', border:'1px solid var(--eg-border)' }}>
                    {g.area}
                  </span>
                </div>
                <div style={{ fontSize:10, color:'var(--eg-text-muted)', marginTop:3, lineHeight:1.4 }}>
                  {g.interpretazione}
                </div>
                {/* notizie recenti */}
                {(g.notizie_recenti||[]).length > 0 && (
                  <div style={{ marginTop:5 }}>
                    {g.notizie_recenti.slice(0,2).map((n, j) => (
                      <div key={j}
                        onClick={() => document.dispatchEvent(new CustomEvent('eg:openArticle', {detail:{id:n.id}}))}
                        onMouseEnter={e => e.currentTarget.style.color='var(--eg-accent)'}
                        onMouseLeave={e => e.currentTarget.style.color='var(--eg-text-muted)'}
                        style={{ fontSize:10, color:'var(--eg-text-muted)', cursor:'pointer', lineHeight:1.4, display:'flex', gap:5 }}>
                        <span style={{ flexShrink:0 }}>·</span>
                        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {n.title}{n.pub_date ? <span style={{ color:'var(--eg-text-dim)', marginLeft:4 }}>{n.pub_date}</span> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* metriche destra */}
              <div style={{ textAlign:'right', flexShrink:0 }}>
                <div style={{ fontSize:14, fontWeight:800, color:'var(--eg-text)' }}>{g.ratio}×</div>
                <div style={{ fontSize:9, color:'var(--eg-text-dim)' }}>{g.tot_notizie} notizie</div>
                <div style={{ fontSize:9, color:'var(--eg-text-dim)' }}>{g.tot_sentenze} sent.</div>
              </div>
            </div>
          ))}

          {!isLoading && (gaps||[]).length === 0 && (
            <div style={{ padding:24, color:'var(--eg-text-muted)', fontSize:13, textAlign:'center' }}>Nessun gap rilevato</div>
          )}

          <div style={{ padding:'10px 16px', color:'var(--eg-text-dim)', fontSize:10, lineHeight:1.5, borderTop:'1px solid var(--eg-border)' }}>
            Gap = norme molto citate nelle news ma con poche o zero pronunce di Cassazione.
            Il <strong>ratio</strong> indica quante notizie per ogni sentenza. Più alto = più urgente.
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          SEZIONE TRENDING
      ══════════════════════════════════════════ */}
      {!isLoading && activeSection === 'trending' && (
        <div>
          <div style={{ padding:'8px 16px', background:'rgba(212,160,83,0.06)', borderBottom:'1px solid var(--eg-border)' }}>
            <span style={{ fontSize:11, color:'#D4A053', fontWeight:600 }}>
              {trending ? `${trending.length} norme con crescita anomala di citazioni` : '—'}
            </span>
            <span style={{ fontSize:10, color:'var(--eg-text-dim)', marginLeft:8 }}>Finestra: 14 giorni</span>
          </div>

          {(trending || []).map((t, i) => (
            <div key={i}
              style={{ padding:'11px 16px', borderBottom:'1px solid var(--eg-border)', display:'flex', alignItems:'flex-start', gap:12 }}>
              {/* rank */}
              <div style={{ width:24, height:24, borderRadius:5, background: trendColor(t.trend)+'22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:800, color:trendColor(t.trend), flexShrink:0 }}>
                {trendIcon(t.trend)}
              </div>
              {/* corpo */}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                  <span
                    onClick={() => document.dispatchEvent(new CustomEvent('eg:openNorma', {detail:{codice:t.codice_norma}}))}
                    onMouseEnter={e => e.currentTarget.style.textDecoration='underline'}
                    onMouseLeave={e => e.currentTarget.style.textDecoration='none'}
                    style={{ fontSize:13, fontWeight:700, color:'var(--eg-accent)', fontFamily:"'JetBrains Mono',monospace", cursor:'pointer' }}>
                    {t.codice_norma}
                  </span>
                  <span style={{ fontSize:9, padding:'1px 6px', borderRadius:3, background:'var(--eg-surface)', color:'var(--eg-text-muted)', border:'1px solid var(--eg-border)' }}>
                    {t.area}
                  </span>
                  {t.trend === 'nuova' && (
                    <span style={{ fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:3, background:'rgba(212,160,83,0.15)', color:'#D4A053', border:'1px solid rgba(212,160,83,0.3)' }}>
                      Nuova
                    </span>
                  )}
                </div>
                {/* notizie esempio */}
                {(t.notizie_esempio||[]).filter((n,idx,arr) => arr.findIndex(x=>x.id===n.id)===idx).slice(0,2).map((n, j) => (
                  <div key={j}
                    onClick={() => document.dispatchEvent(new CustomEvent('eg:openArticle', {detail:{id:n.id}}))}
                    onMouseEnter={e => e.currentTarget.style.color='var(--eg-accent)'}
                    onMouseLeave={e => e.currentTarget.style.color='var(--eg-text-muted)'}
                    style={{ fontSize:10, color:'var(--eg-text-muted)', cursor:'pointer', marginTop:3, lineHeight:1.4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    · {n.title}
                  </div>
                ))}
              </div>
              {/* metriche destra */}
              <div style={{ textAlign:'right', flexShrink:0 }}>
                <div style={{ fontSize:14, fontWeight:800, color:trendColor(t.trend) }}>
                  {t.variazione_pct === 999 ? '✦' : (t.variazione_pct > 0 ? '+' : '') + t.variazione_pct + '%'}
                </div>
                <div style={{ fontSize:9, color:'var(--eg-text-dim)' }}>{t.citazioni_recenti} cit.</div>
                {t.citazioni_precedenti > 0 && (
                  <div style={{ fontSize:9, color:'var(--eg-text-dim)' }}>prec. {t.citazioni_precedenti}</div>
                )}
              </div>
            </div>
          ))}

          {!isLoading && (trending||[]).length === 0 && (
            <div style={{ padding:24, color:'var(--eg-text-muted)', fontSize:13, textAlign:'center' }}>
              Nessuna norma trending nel periodo selezionato
            </div>
          )}

          <div style={{ padding:'10px 16px', color:'var(--eg-text-dim)', fontSize:10, lineHeight:1.5, borderTop:'1px solid var(--eg-border)' }}>
            ✦ = norma apparsa per la prima volta (nessuna citazione nel periodo precedente).
            Le citazioni provengono da notizie collegate tramite analisi automatica del testo.
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          SEZIONE RETE
      ══════════════════════════════════════════ */}
      {!isLoading && activeSection === 'rete' && (
        <div>
          <div style={{ padding:'8px 16px', background:'rgba(91,155,213,0.06)', borderBottom:'1px solid var(--eg-border)' }}>
            <span style={{ fontSize:11, color:'#5B9BD5', fontWeight:600 }}>
              {rete ? `${rete.length} norme-hub nel grafo sentenze` : '—'}
            </span>
            <span style={{ fontSize:10, color:'var(--eg-text-dim)', marginLeft:8 }}>
              Ordinate per numero di relazioni — fonte: 700.932 link tra sentenze Cassazione · clicca una riga per espandere le connessioni
            </span>
          </div>

          {(rete || []).map((h, i) => {
            const pctContrasti = h.totale_relazioni > 0 ? Math.round((h.contrasti / h.totale_relazioni) * 100) : 0;
            const isExpanded   = reteExpanded === h.norma_hub;

            // raggruppa connessioni per tipo quando espanso
            const connContrasti = reteConnessioni.filter(c => c.tipo === 'contrasto_aperto');
            const connCitazioni = reteConnessioni.filter(c => c.tipo !== 'contrasto_aperto');

            return (
              <div key={i} style={{ borderBottom:'1px solid var(--eg-border)' }}>
                {/* ── riga hub ── */}
                <div
                  onClick={() => toggleReteHub(h)}
                  style={{
                    padding:'11px 16px', display:'flex', alignItems:'center', gap:12,
                    cursor:'pointer',
                    background: isExpanded ? 'rgba(200,169,110,0.05)' : 'transparent',
                    borderLeft: isExpanded ? '3px solid var(--eg-accent)' : '3px solid transparent',
                    transition:'background 0.15s, border-left-color 0.15s',
                  }}
                  onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--eg-surface-hover)'; }}
                  onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}
                >
                  {/* rank */}
                  <div style={{ width:24, height:24, borderRadius:5, background: isExpanded ? 'rgba(200,169,110,0.2)' : 'rgba(91,155,213,0.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, color: isExpanded ? 'var(--eg-accent)' : '#5B9BD5', flexShrink:0 }}>
                    {i+1}
                  </div>
                  {/* sentenza hub */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, color: isExpanded ? 'var(--eg-accent)' : 'var(--eg-text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                      {h.label || h.norma_hub}
                      <span style={{ fontSize:10, fontWeight:400, color:'var(--eg-text-dim)', marginLeft:6 }}>
                        {isExpanded ? '▲ chiudi' : '▼ espandi'}
                      </span>
                    </div>
                    {(h.sezione || h.materia || h.oggetto) && (
                      <div style={{ fontSize:10, color:'var(--eg-text-muted)', marginTop:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                        {[h.sezione, h.materia, h.oggetto].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {/* barra proporzionale */}
                    <div style={{ marginTop:4, height:3, borderRadius:2, background:'var(--eg-border)', overflow:'hidden', maxWidth:200 }}>
                      <div style={{ height:'100%', width: pctContrasti + '%', background:'#C45C5C', borderRadius:2, transition:'width 0.3s' }} />
                    </div>
                    <div style={{ fontSize:9, color:'var(--eg-text-dim)', marginTop:1 }}>
                      {pctContrasti > 0 ? pctContrasti + '% contrasti · ' : ''}{100-pctContrasti}% citazioni
                    </div>
                  </div>
                  {/* badges metriche */}
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, flexShrink:0 }}>
                    <div style={{ fontSize:16, fontWeight:800, color:'var(--eg-text)' }}>
                      {h.totale_relazioni}
                      <span style={{ fontSize:9, fontWeight:500, color:'var(--eg-text-dim)', marginLeft:3 }}>rel.</span>
                    </div>
                    <div style={{ display:'flex', gap:4 }}>
                      {h.contrasti > 0 && (
                        <span style={{ fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:3, background:'#C45C5C22', color:'#C45C5C', border:'1px solid #C45C5C40' }}>
                          ⚡ {h.contrasti}
                        </span>
                      )}
                      {h.citazioni > 0 && (
                        <span style={{ fontSize:9, fontWeight:600, padding:'1px 6px', borderRadius:3, background:'var(--eg-surface)', color:'var(--eg-text-muted)', border:'1px solid var(--eg-border)' }}>
                          ↔ {h.citazioni}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── area espansa ── */}
                {isExpanded && (
                  <div style={{ background:'rgba(200,169,110,0.03)', borderTop:'1px solid var(--eg-border)', borderLeft:'3px solid var(--eg-accent)' }}>

                    {/* header connessioni */}
                    <div style={{ padding:'10px 16px', display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid var(--eg-border)' }}>
                      <span style={{ fontSize:11, color:'var(--eg-accent)', fontWeight:700 }}>
                        Connessioni di {h.label || h.norma_hub}
                      </span>
                      {!reteConnLoading && (
                        <span style={{ fontSize:10, color:'var(--eg-text-dim)' }}>
                          — {reteConnTotale} relazioni totali
                          {reteConnTotale > 50 ? ` (prime 50)` : ''}
                        </span>
                      )}
                      {/* apri la norma hub nel grafo */}
                      <button
                        onClick={e => { e.stopPropagation(); document.dispatchEvent(new CustomEvent('eg:openNorma', {detail:{codice:h.norma_hub}})); }}
                        style={{ marginLeft:'auto', background:'transparent', border:'1px solid var(--eg-accent)', color:'var(--eg-accent)', borderRadius:5, padding:'3px 10px', fontSize:10, fontWeight:600, cursor:'pointer' }}>
                        Apri nel grafo →
                      </button>
                    </div>

                    {/* spinner */}
                    {reteConnLoading && (
                      <div style={{ padding:'20px 16px', display:'flex', alignItems:'center', gap:8, color:'var(--eg-text-muted)', fontSize:12 }}>
                        <span style={{ display:'inline-block', width:14, height:14, border:'2px solid var(--eg-border)', borderTopColor:'var(--eg-accent)', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />
                        Carico connessioni…
                      </div>
                    )}

                    {/* connessioni caricate */}
                    {!reteConnLoading && reteConnessioni.length > 0 && (
                      <div style={{ padding:'10px 16px' }}>

                        {/* CONTRASTI */}
                        {connContrasti.length > 0 && (
                          <div style={{ marginBottom:14 }}>
                            <div style={{ fontSize:10, fontWeight:700, color:'#C45C5C', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>
                              ⚡ Contrasti — {connContrasti.length}
                            </div>
                            {connContrasti.map((c, ci) => (
                              <div key={ci} style={{ display:'flex', alignItems:'flex-start', gap:8, marginBottom:6, padding:'6px 10px', background:'rgba(196,92,92,0.06)', borderRadius:6, border:'1px solid rgba(196,92,92,0.2)' }}>
                                <div style={{ flex:1, minWidth:0 }}>
                                  <span
                                    onClick={() => document.dispatchEvent(new CustomEvent('eg:openSentenza', {detail:{id:c.collegata}}))}
                                    onMouseEnter={e => e.currentTarget.style.textDecoration='underline'}
                                    onMouseLeave={e => e.currentTarget.style.textDecoration='none'}
                                    style={{ fontSize:12, fontWeight:600, color:'#C45C5C', cursor:'pointer' }}>
                                    {c.collegata}
                                  </span>
                                  {c.norma_comune && (
                                    <span
                                      onClick={e => { e.stopPropagation(); document.dispatchEvent(new CustomEvent('eg:openNorma', {detail:{codice:c.norma_comune}})); }}
                                      onMouseEnter={e => e.currentTarget.style.background='rgba(200,169,110,0.2)'}
                                      onMouseLeave={e => e.currentTarget.style.background='rgba(200,169,110,0.1)'}
                                      style={{ display:'inline-block', marginLeft:8, fontSize:10, color:'var(--eg-accent)', background:'rgba(200,169,110,0.1)', border:'1px solid var(--eg-accent-dim)', borderRadius:4, padding:'1px 6px', cursor:'pointer', transition:'background 0.15s' }}>
                                      {c.norma_comune}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* CO-CITAZIONI */}
                        {connCitazioni.length > 0 && (
                          <div style={{ marginBottom:10 }}>
                            <div style={{ fontSize:10, fontWeight:700, color:'var(--eg-text-muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>
                              🔗 Co-citazioni — {connCitazioni.length}
                            </div>
                            {connCitazioni.map((c, ci) => (
                              <div key={ci} style={{ display:'flex', alignItems:'flex-start', gap:8, marginBottom:5, padding:'5px 10px', background:'var(--eg-surface-hover)', borderRadius:6, border:'1px solid var(--eg-border)' }}>
                                <div style={{ flex:1, minWidth:0 }}>
                                  <span
                                    onClick={() => document.dispatchEvent(new CustomEvent('eg:openSentenza', {detail:{id:c.collegata}}))}
                                    onMouseEnter={e => e.currentTarget.style.textDecoration='underline'}
                                    onMouseLeave={e => e.currentTarget.style.textDecoration='none'}
                                    style={{ fontSize:12, fontWeight:600, color:'var(--eg-text)', cursor:'pointer' }}>
                                    {c.collegata}
                                  </span>
                                  {c.norma_comune && (
                                    <span
                                      onClick={e => { e.stopPropagation(); document.dispatchEvent(new CustomEvent('eg:openNorma', {detail:{codice:c.norma_comune}})); }}
                                      onMouseEnter={e => e.currentTarget.style.background='rgba(200,169,110,0.2)'}
                                      onMouseLeave={e => e.currentTarget.style.background='rgba(200,169,110,0.1)'}
                                      style={{ display:'inline-block', marginLeft:8, fontSize:10, color:'var(--eg-accent)', background:'rgba(200,169,110,0.1)', border:'1px solid var(--eg-accent-dim)', borderRadius:4, padding:'1px 6px', cursor:'pointer', transition:'background 0.15s' }}>
                                      {c.norma_comune}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* overflow */}
                        {reteConnTotale > 50 && (
                          <div style={{ fontSize:11, color:'var(--eg-text-dim)', fontStyle:'italic', padding:'6px 0' }}>
                            … e altre {(reteConnTotale - 50).toLocaleString('it-IT')} connessioni non mostrate
                          </div>
                        )}

                      </div>
                    )}

                    {/* nessuna connessione */}
                    {!reteConnLoading && reteConnessioni.length === 0 && (
                      <div style={{ padding:'16px', fontSize:12, color:'var(--eg-text-muted)' }}>
                        Nessuna connessione disponibile per questa sentenza.
                      </div>
                    )}

                  </div>
                )}
              </div>
            );
          })}

          {!isLoading && (rete||[]).length === 0 && (
            <div style={{ padding:24, color:'var(--eg-text-muted)', fontSize:13, textAlign:'center' }}>
              Nessun dato rete disponibile
            </div>
          )}

          <div style={{ padding:'10px 16px', color:'var(--eg-text-dim)', fontSize:10, lineHeight:1.5, borderTop:'1px solid var(--eg-border)' }}>
            Le norme-hub sono quelle che compaiono più frequentemente nelle relazioni tra sentenze della Cassazione.
            ⚡ = contrasti interpretativi · ↔ = co-citazioni (sentenze che citano la stessa norma).
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          SEZIONE SUGGERIMENTI
      ══════════════════════════════════════════ */}
      {activeSection === 'suggerimenti' && (
        <div>
          {/* ── filtri tipo ── */}
          <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--eg-border)', display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
            {[
              { tipo:'',              label:'Tutti',          icon:'',   count: Object.values(sugConteggi).reduce((a,b) => a+b, 0) || (suggerimenti?.length || 0) },
              { tipo:'co_citazione',  label:'Co-citazioni',   icon:'🔗', count: sugConteggi['co_citazione']  || 0 },
              { tipo:'anomalia_trend',label:'Anomalie',        icon:'📈', count: sugConteggi['anomalia_trend'] || 0 },
              { tipo:'nuovo_contrasto',label:'Contrasti',     icon:'⚡', count: sugConteggi['nuovo_contrasto'] || 0 },
              { tipo:'gap_chiuso',    label:'Gap chiusi',      icon:'🕳️', count: sugConteggi['gap_chiuso']    || 0 },
            ].map(f => (
              <button key={f.tipo}
                onClick={() => { setSugTipoFiltro(f.tipo); setSuggerimenti(null); loadSuggerimenti(f.tipo); }}
                style={{
                  padding:'4px 12px', borderRadius:16, fontSize:11, fontWeight: sugTipoFiltro === f.tipo ? 700 : 500,
                  cursor:'pointer', border:'1px solid',
                  background: sugTipoFiltro === f.tipo ? 'rgba(200,169,110,0.15)' : 'var(--eg-surface)',
                  borderColor: sugTipoFiltro === f.tipo ? 'var(--eg-accent)' : 'var(--eg-border)',
                  color: sugTipoFiltro === f.tipo ? 'var(--eg-accent)' : 'var(--eg-text-muted)',
                  transition:'all 0.15s',
                }}>
                {f.icon && <span style={{ marginRight:4 }}>{f.icon}</span>}{f.label}
                {f.count > 0 && <span style={{ marginLeft:5, fontSize:10, opacity:0.7 }}>({f.count})</span>}
              </button>
            ))}
          </div>

          {/* ── spinner ── */}
          {sugLoading && (
            <div style={{ padding:'24px 16px', display:'flex', alignItems:'center', gap:8, color:'var(--eg-text-muted)', fontSize:13 }}>
              <span style={{ display:'inline-block', width:14, height:14, border:'2px solid var(--eg-border)', borderTopColor:'var(--eg-accent)', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />
              Carico suggerimenti…
            </div>
          )}

          {/* ── lista cards ── */}
          {!sugLoading && (suggerimenti || []).map((s) => {
            const stato = sugStati[s.id]?.stato || s.stato;
            const processing = sugStati[s.id]?.processing || false;
            const isApprovato = stato === 'approvato';
            const isScartato  = stato === 'scartato';
            const isGestito   = isApprovato || isScartato;

            const tipoMeta = {
              co_citazione:   { icon:'🔗', color:'#5B9BD5', label:'Co-citazione' },
              anomalia_trend: { icon:'📈', color:'var(--eg-trending)', label:'Anomalia trend' },
              nuovo_contrasto:{ icon:'⚡', color:'var(--eg-danger)',  label:'Nuovo contrasto' },
              gap_chiuso:     { icon:'🕳️', color:'var(--eg-success)', label:'Gap chiuso' },
            }[s.tipo] || { icon:'💡', color:'var(--eg-text-muted)', label:s.tipo };

            const confColor = s.confidenza >= 0.7 ? 'var(--eg-success)' : s.confidenza >= 0.4 ? 'var(--eg-trending)' : 'var(--eg-danger)';

            // parse norme_collegate
            let normeCollegate = [];
            try { normeCollegate = JSON.parse(s.norme_collegate || '[]'); } catch(e) {}

            // parse dettaglio per info extra
            let dettaglio = {};
            try { dettaglio = JSON.parse(s.dettaglio || '{}'); } catch(e) {}

            return (
              <div key={s.id} style={{
                padding:'14px 16px', borderBottom:'1px solid var(--eg-border)',
                opacity: isScartato ? 0.45 : 1,
                background: isApprovato ? 'rgba(74,153,96,0.05)' : isScartato ? 'transparent' : 'transparent',
                transition:'opacity 0.3s, background 0.3s',
              }}>
                <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>

                  {/* icona tipo */}
                  <div style={{
                    width:34, height:34, borderRadius:8, flexShrink:0,
                    background:`rgba(0,0,0,0.1)`, border:`1px solid ${tipoMeta.color}33`,
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:16,
                    marginTop:1,
                  }}>
                    {tipoMeta.icon}
                  </div>

                  {/* contenuto */}
                  <div style={{ flex:1, minWidth:0 }}>

                    {/* tipo label + data */}
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4, flexWrap:'wrap' }}>
                      <span style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:tipoMeta.color }}>
                        {tipoMeta.label}
                      </span>
                      <span style={{ fontSize:9, color:'var(--eg-text-dim)' }}>
                        {s.creato_il ? s.creato_il.substring(0,10) : ''}
                      </span>
                      {/* badge stato se gestito */}
                      {isApprovato && (
                        <span style={{ fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:3, background:'rgba(74,153,96,0.2)', color:'var(--eg-success)', border:'1px solid rgba(74,153,96,0.3)' }}>
                          ✅ approvato
                        </span>
                      )}
                      {isScartato && (
                        <span style={{ fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:3, background:'var(--eg-surface)', color:'var(--eg-text-dim)', border:'1px solid var(--eg-border)' }}>
                          ❌ scartato
                        </span>
                      )}
                    </div>

                    {/* titolo */}
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--eg-text)', lineHeight:1.4, marginBottom:6 }}>
                      {s.titolo}
                    </div>

                    {/* norma principale + collegate */}
                    <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:8 }}>
                      {s.norma_principale && (
                        <span
                          onClick={() => document.dispatchEvent(new CustomEvent('eg:openNorma', {detail:{codice:s.norma_principale}}))}
                          onMouseEnter={e => e.currentTarget.style.background='rgba(200,169,110,0.25)'}
                          onMouseLeave={e => e.currentTarget.style.background='rgba(200,169,110,0.12)'}
                          style={{ fontSize:11, color:'var(--eg-accent)', background:'rgba(200,169,110,0.12)', border:'1px solid var(--eg-accent-dim)', borderRadius:5, padding:'2px 8px', cursor:'pointer', transition:'background 0.15s' }}>
                          {s.norma_principale}
                        </span>
                      )}
                      {normeCollegate.map((n, ni) => n && (
                        <span key={ni}
                          onClick={() => document.dispatchEvent(new CustomEvent('eg:openNorma', {detail:{codice:n}}))}
                          onMouseEnter={e => e.currentTarget.style.background='rgba(200,169,110,0.25)'}
                          onMouseLeave={e => e.currentTarget.style.background='rgba(200,169,110,0.08)'}
                          style={{ fontSize:11, color:'var(--eg-accent)', background:'rgba(200,169,110,0.08)', border:'1px solid var(--eg-border)', borderRadius:5, padding:'2px 8px', cursor:'pointer', transition:'background 0.15s' }}>
                          {n}
                        </span>
                      ))}
                    </div>

                    {/* barra confidenza */}
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom: isGestito ? 0 : 10 }}>
                      <div style={{ flex:1, height:3, borderRadius:2, background:'var(--eg-border)', maxWidth:180, overflow:'hidden' }}>
                        <div style={{ height:'100%', width: Math.round(s.confidenza * 100) + '%', background:confColor, borderRadius:2, transition:'width 0.3s' }} />
                      </div>
                      <span style={{ fontSize:9, color:confColor, fontWeight:700, minWidth:28 }}>
                        {Math.round(s.confidenza * 100)}%
                      </span>
                    </div>

                    {/* bottoni azione */}
                    {!isGestito && (
                      <div style={{ display:'flex', gap:6 }}>
                        <button
                          disabled={processing}
                          onClick={e => sugAction(s.id, 'approva', e)}
                          style={{
                            padding:'4px 12px', fontSize:11, fontWeight:600, borderRadius:5, cursor: processing ? 'default' : 'pointer',
                            background:'rgba(74,153,96,0.1)', border:'1px solid rgba(74,153,96,0.35)', color:'var(--eg-success)',
                            opacity: processing ? 0.5 : 1, transition:'all 0.15s',
                          }}
                          onMouseEnter={e => { if (!processing) e.currentTarget.style.background='rgba(74,153,96,0.2)'; }}
                          onMouseLeave={e => { if (!processing) e.currentTarget.style.background='rgba(74,153,96,0.1)'; }}>
                          {processing ? '…' : '✅ Approva'}
                        </button>
                        <button
                          disabled={processing}
                          onClick={e => sugAction(s.id, 'scarta', e)}
                          style={{
                            padding:'4px 12px', fontSize:11, fontWeight:600, borderRadius:5, cursor: processing ? 'default' : 'pointer',
                            background:'var(--eg-surface)', border:'1px solid var(--eg-border)', color:'var(--eg-text-muted)',
                            opacity: processing ? 0.5 : 1, transition:'all 0.15s',
                          }}
                          onMouseEnter={e => { if (!processing) e.currentTarget.style.background='var(--eg-surface-hover)'; }}
                          onMouseLeave={e => { if (!processing) e.currentTarget.style.background='var(--eg-surface)'; }}>
                          {processing ? '…' : '❌ Scarta'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* vuoto */}
          {!sugLoading && (suggerimenti || []).length === 0 && (
            <div style={{ padding:'32px 16px', textAlign:'center', color:'var(--eg-text-muted)', fontSize:13 }}>
              Nessun suggerimento {sugTipoFiltro ? 'per questo tipo' : 'in attesa'}
            </div>
          )}

          {/* footer info */}
          {!sugLoading && (suggerimenti || []).length > 0 && (
            <div style={{ padding:'10px 16px', color:'var(--eg-text-dim)', fontSize:10, lineHeight:1.5, borderTop:'1px solid var(--eg-border)' }}>
              {(suggerimenti || []).length} suggerimenti mostrati · ordinati per confidenza · generati da genio-miner.js (cron ore 11:00)
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// ─── AULA — SIMULAZIONE DIBATTIMENTALE ────────────────────────────────────────
function PageAula() {
  const C = getColors();

  const [aulaInput, setAulaInput]       = useState('');
  const [aulaPhase, setAulaPhase]       = useState('input'); // 'input'|'r1'|'r2'|'r3'|'r4'|'done'
  const [aulaRounds, setAulaRounds]     = useState({ r1: null, r2: null, r3: null, r4: null });
  const [aulaContesto, setAulaContesto] = useState('');
  const [aulaTimes, setAulaTimes]       = useState({ r1: 0, r2: 0, r3: 0, r4: 0 });
  const [aulaCollapsed, setAulaCollapsed] = useState({ r1: false, r2: false, r3: false, r4: false });
  const [aulaLoading, setAulaLoading]   = useState(false);
  const [aulaError, setAulaError]       = useState('');
  const [aulaCurrentRound, setAulaCurrentRound] = useState(null);
  const aulaResultsRef = React.useRef(null);

  // Abilita click su .norma-link → eg:openNorma → Grafo (same pattern as PannelloSentenza)
  useEffect(() => {
    const el = aulaResultsRef.current;
    if (!el) return;
    return setupNormaLinkHandler(el);
  });

  // ── Dossier Definitivo Sonnet (dopo i 4 round) ───────────────────────────────
  const [dossierDefLoading, setDossierDefLoading] = useState(false);
  const [dossierDefResult,  setDossierDefResult]  = useState(null);
  const [dossierDefError,   setDossierDefError]   = useState('');

  // ── Timer: incrementa il round corrente ogni secondo mentre carica ──────────
  useEffect(() => {
    if (!aulaLoading || !aulaCurrentRound) return;
    const iv = setInterval(() => {
      setAulaTimes(t => ({ ...t, [aulaCurrentRound]: t[aulaCurrentRound] + 1 }));
    }, 1000);
    return () => clearInterval(iv);
  }, [aulaLoading, aulaCurrentRound]);

  // ── Poll helper ──────────────────────────────────────────────────────────────
  const aulaPoll = (endpoint, jobId, resultKey, onDone) => {
    const start = Date.now();
    const iv = setInterval(async () => {
      try {
        if (Date.now() - start > 900000) {
          clearInterval(iv);
          setAulaError('Timeout round. Riprova.');
          setAulaLoading(false);
          return;
        }
        const r = await fetch(API + endpoint + '?id=' + jobId);
        const d = await r.json();
        if (d.status === 'done') {
          clearInterval(iv);
          onDone(d[resultKey] || '');
        } else if (d.status === 'error') {
          clearInterval(iv);
          setAulaError(d.errore || 'Errore round');
          setAulaLoading(false);
        }
      } catch(e) {
        clearInterval(iv);
        setAulaError(e.message);
        setAulaLoading(false);
      }
    }, 5000);
  };

  // ── Round configs ────────────────────────────────────────────────────────────
  const ROUND_CONFIG = {
    r1: { label: 'ROUND 1 — Dossier Avvocato',    icon: '📋', bg: '#0d2b1a', border: '#1a7a3a', nextLabel: '⚔️ Round 2: Attacco PM' },
    r2: { label: 'ROUND 2 — Attacco PM',           icon: '⚔️', bg: '#2b0d0d', border: '#7a1a1a', nextLabel: '🛡️ Round 3: Risposta Avvocato' },
    r3: { label: 'ROUND 3 — Risposta Avvocato',    icon: '🛡️', bg: '#0d1f2b', border: '#1a5a7a', nextLabel: '⚖️ Round 4: Verdetto Finale' },
    r4: { label: 'ROUND 4 — Verdetto Finale',      icon: '⚖️', bg: '#2b2400', border: '#8a7a00', nextLabel: null },
  };

  // ── Start Round 1: Dossier Avvocato ─────────────────────────────────────────
  async function startR1() {
    if (!aulaInput.trim()) return;
    setAulaError('');
    setAulaLoading(true);
    setAulaCurrentRound('r1');
    setAulaTimes(t => ({ ...t, r1: 0 }));
    try {
      const resp = await fetch(API + '/api/genio/dossier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domanda: aulaInput }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.errore || 'Errore avvio dossier');
      aulaPoll('/api/genio/dossier/status', data.jobId, 'dossier', (text) => {
        setAulaRounds(r => ({ ...r, r1: text }));
        // Store contesto_raw from the response — need to re-fetch with the full result
        // The poll gives us the spread of job.result, so contesto_raw is in the done response
        setAulaLoading(false);
        setAulaCurrentRound(null);
        setAulaPhase('r1');
        // Auto-collapse r1 after 2s
        setTimeout(() => setAulaCollapsed(c => ({ ...c, r1: true })), 2000);
      });
      // Also capture contesto_raw on done
      const pollForContesto = (jobId) => {
        const start2 = Date.now();
        const iv2 = setInterval(async () => {
          if (Date.now() - start2 > 900000) { clearInterval(iv2); return; }
          try {
            const r2 = await fetch(API + '/api/genio/dossier/status?id=' + jobId);
            const d2 = await r2.json();
            if (d2.status === 'done') {
              clearInterval(iv2);
              if (d2.contesto_raw) setAulaContesto(d2.contesto_raw);
            } else if (d2.status === 'error') {
              clearInterval(iv2);
            }
          } catch(e2) { clearInterval(iv2); }
        }, 5000);
      };
      pollForContesto(data.jobId);
    } catch(e) {
      setAulaError(e.message || 'Errore di rete');
      setAulaLoading(false);
      setAulaCurrentRound(null);
    }
  }

  // ── Start Round 2: Attacco PM ────────────────────────────────────────────────
  async function startR2() {
    setAulaError('');
    setAulaLoading(true);
    setAulaCurrentRound('r2');
    setAulaTimes(t => ({ ...t, r2: 0 }));
    try {
      const resp = await fetch(API + '/api/genio/controdossier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dossier: aulaRounds.r1, contesto: aulaContesto, domanda: aulaInput }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.errore || 'Errore avvio round 2');
      aulaPoll('/api/genio/controdossier/status', data.jobId, 'controDossier', (text) => {
        setAulaRounds(r => ({ ...r, r2: text }));
        setAulaLoading(false);
        setAulaCurrentRound(null);
        setAulaPhase('r2');
        setTimeout(() => setAulaCollapsed(c => ({ ...c, r2: true })), 2000);
      });
    } catch(e) {
      setAulaError(e.message || 'Errore di rete');
      setAulaLoading(false);
      setAulaCurrentRound(null);
    }
  }

  // ── Start Round 3: Risposta Avvocato ─────────────────────────────────────────
  async function startR3() {
    setAulaError('');
    setAulaLoading(true);
    setAulaCurrentRound('r3');
    setAulaTimes(t => ({ ...t, r3: 0 }));
    try {
      const resp = await fetch(API + '/api/genio/replica-avvocato', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dossier: aulaRounds.r1, controDossier: aulaRounds.r2, contesto: aulaContesto, domanda: aulaInput }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.errore || 'Errore avvio round 3');
      aulaPoll('/api/genio/replica-avvocato/status', data.jobId, 'replica', (text) => {
        setAulaRounds(r => ({ ...r, r3: text }));
        setAulaLoading(false);
        setAulaCurrentRound(null);
        setAulaPhase('r3');
        setTimeout(() => setAulaCollapsed(c => ({ ...c, r3: true })), 2000);
      });
    } catch(e) {
      setAulaError(e.message || 'Errore di rete');
      setAulaLoading(false);
      setAulaCurrentRound(null);
    }
  }

  // ── Start Round 4: Verdetto Finale ───────────────────────────────────────────
  async function startR4() {
    setAulaError('');
    setAulaLoading(true);
    setAulaCurrentRound('r4');
    setAulaTimes(t => ({ ...t, r4: 0 }));
    try {
      const resp = await fetch(API + '/api/genio/replica-pm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replicaAvvocato: aulaRounds.r3, contesto: aulaContesto, domanda: aulaInput }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.errore || 'Errore avvio round 4');
      aulaPoll('/api/genio/replica-pm/status', data.jobId, 'replicaFinale', (text) => {
        setAulaRounds(r => ({ ...r, r4: text }));
        setAulaLoading(false);
        setAulaCurrentRound(null);
        setAulaPhase('done');
      });
    } catch(e) {
      setAulaError(e.message || 'Errore di rete');
      setAulaLoading(false);
      setAulaCurrentRound(null);
    }
  }

  // ── Genera Dossier Definitivo con Sonnet (post round 4) ─────────────────────
  async function generaDossierDefinitivo() {
    if (!aulaInput.trim() || dossierDefLoading) return;
    setDossierDefLoading(true);
    setDossierDefError('');
    setDossierDefResult(null);
    try {
      const resp = await fetch(API + '/api/genio/dossier-sonnet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domanda: aulaInput }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.errore || 'Errore avvio dossier Sonnet');
      const jobId = data.jobId;
      if (!jobId) throw new Error('Nessun jobId ricevuto dal server');

      const pollStart = Date.now();
      const pollInterval = setInterval(async () => {
        try {
          if (Date.now() - pollStart > 900000) {
            clearInterval(pollInterval);
            setDossierDefError('Timeout: dossier definitivo troppo lento. Riprova.');
            setDossierDefLoading(false);
            return;
          }
          const pollResp = await fetch(API + '/api/genio/dossier-sonnet/status?id=' + jobId);
          const pollData = await pollResp.json();
          if (pollData.status === 'done') {
            clearInterval(pollInterval);
            setDossierDefResult(pollData.dossier || '');
            setDossierDefLoading(false);
          } else if (pollData.status === 'error') {
            clearInterval(pollInterval);
            setDossierDefError(pollData.errore || 'Errore generazione dossier definitivo');
            setDossierDefLoading(false);
          }
        } catch(e) {
          clearInterval(pollInterval);
          setDossierDefError('Errore di rete durante polling dossier definitivo');
          setDossierDefLoading(false);
        }
      }, 5000);

    } catch(e) {
      setDossierDefError(e.message || 'Errore di rete');
      setDossierDefLoading(false);
    }
  }

  // ── Copy all rounds ──────────────────────────────────────────────────────────
  function copiatutto() {
    const parts = [];
    if (aulaRounds.r1) parts.push('=== ROUND 1 — DOSSIER AVVOCATO ===\n' + aulaRounds.r1);
    if (aulaRounds.r2) parts.push('=== ROUND 2 — ATTACCO PM ===\n' + aulaRounds.r2);
    if (aulaRounds.r3) parts.push('=== ROUND 3 — RISPOSTA AVVOCATO ===\n' + aulaRounds.r3);
    if (aulaRounds.r4) parts.push('=== ROUND 4 — VERDETTO FINALE ===\n' + aulaRounds.r4);
    navigator.clipboard.writeText(parts.join('\n\n---\n\n')).catch(() => {});
  }

  // ── Reset ────────────────────────────────────────────────────────────────────
  function resetAula() {
    setAulaPhase('input');
    setAulaRounds({ r1: null, r2: null, r3: null, r4: null });
    setAulaContesto('');
    setAulaTimes({ r1: 0, r2: 0, r3: 0, r4: 0 });
    setAulaCollapsed({ r1: false, r2: false, r3: false, r4: false });
    setAulaLoading(false);
    setAulaError('');
    setAulaCurrentRound(null);
  }

  const roundOrder = ['r1', 'r2', 'r3', 'r4'];

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 20px 60px' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <span style={{ fontSize: 28 }}>⚖️</span>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.accent, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            AULA — SIMULAZIONE DIBATTIMENTALE
          </h1>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: C.textMuted }}>
          4 round di botta e risposta AI: Avvocato vs Pubblico Ministero
        </p>
      </div>

      {/* Input Phase */}
      {aulaPhase === 'input' && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 24, marginBottom: 24 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
            Descrivi il caso (includere reato, circostanze, norme applicabili)
          </label>
          <textarea
            value={aulaInput}
            onChange={e => setAulaInput(e.target.value)}
            placeholder="Es: Il mio cliente è accusato di furto aggravato ex art. 624-625 c.p. presso un supermercato. Valore sottratto €18. Precedenti penali nessuno. Vorrei valutare art. 131-bis c.p."
            rows={6}
            style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 13, padding: '10px 12px', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
          <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              onClick={startR1}
              disabled={!aulaInput.trim()}
              style={{
                padding: '10px 28px', fontSize: 14, fontWeight: 700, borderRadius: 6, border: 'none', cursor: aulaInput.trim() ? 'pointer' : 'default',
                background: aulaInput.trim() ? 'linear-gradient(135deg, #b8960c 0%, #d4a853 50%, #b8960c 100%)' : C.border,
                color: aulaInput.trim() ? '#1a1000' : C.textDim,
                letterSpacing: '0.03em',
              }}
            >
              ⚖️ Inizia Simulazione
            </button>
            <span style={{ fontSize: 11, color: C.textDim }}>~3 minuti per round · 4 round totali</span>
          </div>
        </div>
      )}

      {/* Rounds display */}
      <div ref={aulaResultsRef}>
      {roundOrder.map(rk => {
        const cfg = ROUND_CONFIG[rk];
        const text = aulaRounds[rk];
        if (!text) return null;
        const collapsed = aulaCollapsed[rk];
        const time = aulaTimes[rk];
        const timeStr = time > 0 ? `${time}s` : '';
        // Determine if "next" button should show
        const rIdx = roundOrder.indexOf(rk);
        const nextRk = roundOrder[rIdx + 1];
        const showNext = !aulaLoading && text && nextRk && !aulaRounds[nextRk];
        const nextFns = { r1: startR2, r2: startR3, r3: startR4 };

        return (
          <div key={rk} style={{ marginBottom: 16, background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 10, overflow: 'hidden' }}>
            {/* Round header */}
            <div
              onClick={() => setAulaCollapsed(c => ({ ...c, [rk]: !c[rk] }))}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer', borderBottom: collapsed ? 'none' : `1px solid ${cfg.border}` }}
            >
              <span style={{ fontSize: 18 }}>{cfg.icon}</span>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#e8e4dd', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{cfg.label}</span>
              {timeStr && <span style={{ fontSize: 11, color: '#8a8680', marginRight: 8 }}>({timeStr})</span>}
              <span style={{ fontSize: 14, color: '#8a8680', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
            </div>
            {/* Round content */}
            {!collapsed && (
              <div style={{ padding: '16px 20px' }}>
                <div
                  style={{ fontSize: 13, lineHeight: 1.7, color: '#e8e4dd' }}
                  dangerouslySetInnerHTML={{ __html: mdToHtmlDark(text) }}
                />
              </div>
            )}
            {/* Next round button */}
            {showNext && (
              <div style={{ padding: '12px 16px', borderTop: `1px solid ${cfg.border}`, background: 'rgba(0,0,0,0.2)' }}>
                <button
                  onClick={nextFns[rk]}
                  style={{
                    padding: '8px 22px', fontSize: 13, fontWeight: 700, borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: 'linear-gradient(135deg, #b8960c 0%, #d4a853 50%, #b8960c 100%)',
                    color: '#1a1000', letterSpacing: '0.03em',
                  }}
                >
                  {cfg.nextLabel}
                </button>
              </div>
            )}
          </div>
        );
      })}
      </div>

      {/* Loading spinner */}
      {aulaLoading && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: C.textMuted }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚖️</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.accent, marginBottom: 6 }}>
            {aulaCurrentRound ? ROUND_CONFIG[aulaCurrentRound].label : 'Round'} in corso...
          </div>
          <div style={{ fontSize: 12, color: C.textDim }}>~3 minuti · elaborazione AI in background</div>
          {aulaCurrentRound && aulaTimes[aulaCurrentRound] > 0 && (
            <div style={{ fontSize: 11, color: C.textDim, marginTop: 6 }}>
              {aulaTimes[aulaCurrentRound]}s trascorsi
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {aulaError && (
        <div style={{ background: '#2b0d0d', border: '1px solid #7a1a1a', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#f08080', fontSize: 13 }}>
          ⚠️ {aulaError}
          <button onClick={() => setAulaError('')} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#f08080', cursor: 'pointer', fontSize: 12 }}>✕</button>
        </div>
      )}

      {/* Done phase */}
      {aulaPhase === 'done' && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, marginTop: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.accent, marginBottom: 14 }}>✅ Simulazione completata</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <button
              onClick={copiatutto}
              style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: `1px solid ${C.border}`, background: C.surfaceHover, color: C.text, cursor: 'pointer' }}
            >
              📋 Copia tutto
            </button>
            <button
              onClick={resetAula}
              style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: `1px solid ${C.border}`, background: C.surfaceHover, color: C.text, cursor: 'pointer' }}
            >
              🔄 Nuova simulazione
            </button>
          </div>
          {/* Bottone Dossier Definitivo Sonnet */}
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 10 }}>
              Genera il dossier definitivo con Claude Sonnet (qualità massima) integrando i risultati del dibattito.
            </div>
            <button
              onClick={generaDossierDefinitivo}
              disabled={dossierDefLoading}
              style={{
                padding: '10px 24px', fontSize: 14, fontWeight: 700, borderRadius: 6,
                border: `1.5px solid ${dossierDefLoading ? C.border : '#4A90D9'}`,
                background: dossierDefLoading ? C.surface : '#4A90D914',
                color: dossierDefLoading ? C.textDim : '#4A90D9',
                cursor: dossierDefLoading ? 'not-allowed' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 8, transition: 'all 0.15s',
              }}
            >
              {dossierDefLoading
                ? <><span style={{ display:'inline-block', width:14, height:14, border:'2px solid #4A90D9', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.8s linear infinite' }}/>Generazione dossier definitivo…</>
                : <><span>🔵</span><span>Genera Dossier Definitivo (Sonnet)</span></>
              }
            </button>
            <div style={{ fontSize: 10, color: C.textDim, marginTop: 5 }}>Claude Sonnet — ~30–60s · qualità massima</div>
          </div>
          {/* Dossier definitivo error */}
          {dossierDefError && (
            <div style={{ marginTop: 12, background: '#2b0d0d', border: '1px solid #7a1a1a', borderRadius: 6, padding: '10px 14px', color: '#f08080', fontSize: 12 }}>
              ⚠️ {dossierDefError}
            </div>
          )}
          {/* Dossier definitivo result */}
          {dossierDefResult && (
            <div style={{ marginTop: 16, background: '#0d1a2b', border: '1px solid #1a5a8a', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid #1a5a8a', background: '#4A90D910' }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#4A90D9' }}>🔵 DOSSIER DEFINITIVO — Claude Sonnet</span>
                <button
                  onClick={() => navigator.clipboard.writeText(dossierDefResult).catch(() => {})}
                  style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: '1px solid #1a5a8a', background: 'transparent', color: '#4A90D9', cursor: 'pointer' }}
                >
                  📋 Copia
                </button>
              </div>
              <div
                style={{ padding: '20px 24px', fontSize: 13, lineHeight: 1.7, color: '#e8e4dd', maxHeight: 700, overflowY: 'auto' }}
                dangerouslySetInnerHTML={{ __html: mdToHtmlDark(dossierDefResult) }}
              />
            </div>
          )}
        </div>
      )}

      {/* Reset button during simulation */}
      {aulaPhase !== 'input' && aulaPhase !== 'done' && !aulaLoading && (
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button
            onClick={resetAula}
            style={{ padding: '6px 14px', fontSize: 11, fontWeight: 500, borderRadius: 4, border: `1px solid ${C.border}`, background: 'transparent', color: C.textMuted, cursor: 'pointer' }}
          >
            ↺ Ricomincia
          </button>
        </div>
      )}
    </div>
  );
}

// Manifesto DINAMICO in-app — allineato alla pagina pubblica /manifesto.
// Legge /api/manifesto-data (contatori reali + novità dai merge). Mai "—"/"undefined":
// finché carica mostra "…", e se il fetch fallisce i numeri restano vuoti (testi leggibili).
function PageManifesto() {
  const [data, setData] = useState(null);   // /api/manifesto-data
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch(API + "/api/manifesto-data")
      .then(r => r.json())
      .then(d => setData(d || {}))
      .catch(() => setFailed(true));
  }, []);
  const fmt = (v) => (v == null || isNaN(v)) ? "" : Number(v).toLocaleString("it-IT");
  // Segnaposto: "…" durante il caricamento, numero reale a dati pronti, "" se assente o in errore.
  const ph = (key) => {
    if (failed) return "";
    if (!data) return "…";
    return fmt(data[key]);
  };
  const fontiPh    = ph("fonti_attive");
  const sentenzePh = ph("sentenze_corpus");
  const articoliPh = ph("articoli_norme");
  const novita = (data && Array.isArray(data.novita)) ? data.novita : [];
  const fmtData = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    if (!m) return iso || "";
    const mesi = ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"];
    return parseInt(m[3],10) + " " + mesi[parseInt(m[2],10)-1] + " " + m[1];
  };
  const S = {
    card:       { marginBottom:20, padding:20, background:"var(--eg-surface)", borderRadius:10, border:"1px solid var(--eg-border)" },
    label:      { fontSize:10, color:"var(--eg-text-muted)", fontWeight:700, marginBottom:10, textTransform:"uppercase", letterSpacing:"0.12em" },
    h2:         { fontSize:16, color:"var(--eg-accent)", fontWeight:700, marginBottom:10, lineHeight:1.3 },
    body:       { fontSize:13, color:"var(--eg-text)", lineHeight:1.75, margin:"0 0 10px 0" },
    muted:      { fontSize:13, color:"var(--eg-text-muted)", lineHeight:1.75, margin:"0 0 8px 0" },
  };
  const MODULI = [
    ["Notizie",        <>L'unico aggregatore AI d'Italia dedicato a Chiesa e religioni: <strong style={{color:"var(--eg-accent)"}}>{fontiPh}</strong> fonti — Santa Sede, agenzie cattoliche, voci delle confessioni, stampa internazionale tradotta in italiano — lette, deduplicate e ordinate ogni ora.</>],
    ["Codici",         <>Il corpus del diritto della Chiesa e dei suoi rapporti con lo Stato: Codice di Diritto Canonico, CCEO, leggi vaticane, Patti Lateranensi e tutte le intese ex art. 8 Cost., più il magistero pontificio — <strong style={{color:"var(--eg-accent)"}}>{articoliPh}</strong> canoni e articoli ricercabili parola per parola.</>],
    ["Magistero",      <>I documenti che fanno il diritto della Chiesa: motu proprio, costituzioni apostoliche, encicliche, esortazioni e i sedici documenti del Concilio Vaticano II — di dodici pontefici, da Leone XIII a Leone XIV.</>],
  ];

  return (
    <div style={{ padding:"28px 20px 48px", maxWidth:700, margin:"0 auto" }}>

      {/* ══ HEADER ══ */}
      <div style={{ marginBottom:36, textAlign:"center" }}>
        <div style={{ fontSize:10, color:"var(--eg-text-dim)", textTransform:"uppercase", letterSpacing:"0.18em", marginBottom:10 }}>il manifesto</div>
        <h1 style={{ fontSize:30, color:"var(--eg-accent)", fontWeight:900, margin:"0 0 12px 0", letterSpacing:"-0.02em", lineHeight:1.15 }}>
          Edicola Ecclesiastica
        </h1>
        <p style={{ fontSize:15, color:"var(--eg-text-muted)", lineHeight:1.6, margin:0, maxWidth:480, marginLeft:"auto", marginRight:"auto", fontStyle:"italic" }}>
          Chiesa, Diritto e Società. La prima testata dedicata al diritto canonico, vaticano ed ecclesiastico.
        </p>
        {/* Stat hero — numeri reali */}
        <div style={{ display:"flex", justifyContent:"center", gap:28, marginTop:26, flexWrap:"wrap" }}>
          {[[fontiPh,"fonti"],[sentenzePh,"atti nel corpus"],[articoliPh,"canoni e articoli"]].map(([val,lab],i)=>(
            <div key={i} style={{ textAlign:"center" }}>
              <div style={{ fontSize:22, fontWeight:800, color:"var(--eg-accent)", lineHeight:1, fontFamily:"monospace" }}>{val}</div>
              <div style={{ fontSize:10, color:"var(--eg-text-dim)", textTransform:"uppercase", letterSpacing:"0.08em", marginTop:6 }}>{lab}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ══ COSA FACCIAMO — I TRE PILASTRI ══ */}
      <div style={S.card}>
        <div style={S.label}>Cosa facciamo</div>
        {MODULI.map(([nome, desc], i) => (
          <div key={i} style={{ marginBottom: i < 2 ? 14 : 0, paddingBottom: i < 2 ? 14 : 0, borderBottom: i < 2 ? "1px solid var(--eg-border)" : "none" }}>
            <div style={{ fontSize:14, fontWeight:800, color:"var(--eg-text)", marginBottom:4 }}>{nome}</div>
            <div style={{ fontSize:13, color:"var(--eg-text-muted)", lineHeight:1.7 }}>{desc}</div>
          </div>
        ))}
      </div>

      {/* ══ TRE PROMESSE ══ */}
      <div style={S.card}>
        <div style={S.label}>Tre promesse</div>
        {[
          [<><strong style={{color:"var(--eg-accent)"}}>Solo fonti ufficiali e pubbliche.</strong> Ogni documento porta il link all'originale.</>],
          [<><strong style={{color:"var(--eg-accent)"}}>Numeri veri.</strong> I contatori di questa pagina sono letti in tempo reale; se una sezione è in costruzione lo diciamo.</>],
          [<><strong style={{color:"var(--eg-accent)"}}>Gratis.</strong> Il diritto — dello Stato e della Chiesa — dev'essere leggibile da tutti, non solo dagli addetti ai lavori.</>],
        ].map(([testo], i) => (
          <div key={i} style={{ fontSize:13, color:"var(--eg-text)", lineHeight:1.65, padding:"11px 0", borderBottom: i < 2 ? "1px solid var(--eg-border)" : "none" }}>{testo}</div>
        ))}
      </div>

      {/* ══ NOVITÀ RECENTI ══ */}
      <div style={S.card}>
        <div style={S.label}>Novità recenti</div>
        {!data && !failed ? (
          <div style={{ fontSize:13, color:"var(--eg-text-muted)", fontStyle:"italic" }}>Caricamento…</div>
        ) : !novita.length ? (
          <div style={{ fontSize:13, color:"var(--eg-text-muted)", fontStyle:"italic" }}>Nessuna novità recente da mostrare.</div>
        ) : novita.map((x, i) => (
          <div key={i} style={{ display:"flex", gap:14, alignItems:"baseline", padding:"10px 0", borderBottom: i < novita.length-1 ? "1px solid var(--eg-border)" : "none" }}>
            <span style={{ fontFamily:"monospace", fontSize:11, color:"var(--eg-text-dim)", minWidth:78, flexShrink:0 }}>{fmtData(x.data)}</span>
            <span style={{ fontSize:13, color:"var(--eg-text)", lineHeight:1.5 }}>{x.titolo}</span>
          </div>
        ))}
      </div>

      {/* ══ CHI SIAMO ══ */}
      <div style={S.card}>
        <div style={S.label}>Chi siamo</div>
        <p style={S.body}>
          Edicola Ecclesiastica è un progetto italiano indipendente, laico nel metodo e rigoroso nelle fonti. Aggreghiamo, traduciamo e colleghiamo: notizie su Chiesa e religioni, i codici del diritto canonico, le leggi vaticane, le intese tra lo Stato e le confessioni, la giurisprudenza ecclesiastica.
        </p>
        <p style={{ ...S.muted, marginBottom:12 }}>
          Non vendiamo consulenze, né legali né canoniche. Costruiamo strumenti per canonisti, ecclesiasticisti, giornalisti religiosi, operatori pastorali — e per chiunque voglia capire il rapporto tra fede e diritto.
        </p>
        <a href="mailto:info@edicolaecclesiastica.com" style={{ fontSize:12, color:"var(--eg-accent)", textDecoration:"none", fontWeight:600 }}>
          info@edicolaecclesiastica.com →
        </a>
      </div>

      {/* ══ AVVERTENZE ══ */}
      <div style={{ ...S.card, border:"1px solid var(--eg-accent-dim)", background:"rgba(200,169,110,0.04)", marginBottom:0 }}>
        <div style={{ fontSize:11, color:"var(--eg-accent)", fontWeight:700, marginBottom:10, textTransform:"uppercase", letterSpacing:"0.12em" }}>⚖️ Avvertenze legali</div>
        <p style={{ fontSize:13, color:"var(--eg-text)", lineHeight:1.7, margin:"0 0 10px 0" }}>
          I contenuti prodotti dal sistema AI — analisi e sintesi — sono elaborazioni automatiche e possono contenere errori. Nessun contenuto costituisce consulenza legale: la supervisione umana è sempre necessaria.
        </p>
        <button onClick={() => window.__disclaimerOpen && window.__disclaimerOpen()} style={{
          background:"transparent", border:"1px solid var(--eg-accent)", color:"var(--eg-accent)",
          borderRadius:6, padding:"6px 16px", fontSize:12, fontWeight:600, cursor:"pointer",
        }}>Leggi le avvertenze complete →</button>
      </div>

    </div>
  );
}

// ─── MAIN APP ───

const TAB_SVGS = {
  notizie:   <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/></svg>,
  trending:  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>,
  codici:    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  cassazione:<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
  eurlex:    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  alert:     <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  fonti:     <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M17.5 14h.01M14 17.5h7M17.5 21v.01"/></svg>,
  grafo:     <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><circle cx="12" cy="12" r="2"/><line x1="7" y1="12" x2="10" y2="12"/><line x1="14" y1="12" x2="17" y2="12"/><line x1="18" y1="7" x2="13" y2="11"/><line x1="18" y1="17" x2="13" y2="13"/></svg>,
  norme:     <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  guida:     <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  info:      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  genio:     <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 3-1.5 5-4 6.5V18a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-2.5C6.5 14 5 12 5 9a7 7 0 0 1 7-7z"/><line x1="9" y1="21" x2="15" y2="21"/></svg>,
  aula:      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/><line x1="12" y1="22" x2="12" y2="12"/></svg>,
};
// Sprint 1 — app ridotta a due sezioni: Notizie + Cassazione (+ Info/Manifesto).
const TABS = [
  { id:"notizie", label:"Notizie" },
  { id:"norme", label:"Codici" },
  { id:"info", label:"Info" },
];

// Voci di navigazione (header desktop + bottom-nav mobile). "guida" apre l'Assistente EG.
// `label` = etichetta piena (header desktop); `short` = etichetta compatta (bottom-nav a 390px).
const NAV_ITEMS = [
  { id:"notizie",          label:"Notizie",        short:"Notizie" },
  { id:"norme",  ramo:"canonico",         label:"Dir. Canonico",  short:"Canonico" },
  { id:"norme",  ramo:"ecclesiastico_it", label:"Stato e Chiese", short:"St-Chiese" },
  { id:"norme",  ramo:"vaticano",         label:"Leggi Vaticane", short:"Vaticano" },
  { id:"norme",  ramo:"magistero",        label:"Magistero",      short:"Magistero" },
  { id:"info",       label:"Manifesto",  short:"Manif." },
  { id:"guida",      label:"Guida",      short:"Guida" },
];

// ─── SIDEBAR DESKTOP ───────────────────────────────────────────────────
function SidebarNav({ activeTab, setActiveTab }) {
  const ITEMS = [
    { id:"notizie", label:"Notizie", desc:"Feed live", svg: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/></svg> },
    { id:"cassazione", label:"Giurisprudenza", desc:"Sentenze in materia ecclesiastica", svg: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> },
    { id:"norme", label:"Codici", desc:"CIC, CCEO, leggi vaticane e italiane", svg: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> },
    { id:"info", label:"Manifesto", desc:"Chi siamo", svg: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> },
  ];
  return (
    <aside style={{ width:"clamp(180px, 18vw, 240px)", flexShrink:0, borderRight:"1px solid var(--eg-border)", display:"flex", flexDirection:"column", position:"sticky", top:0, height:"100vh", overflowY:"auto" }}>
      {/* Logo desktop */}
      <div onClick={() => setActiveTab("notizie")} style={{ padding:"24px 16px", borderBottom:"1px solid var(--eg-border)", textAlign:"center", cursor:"pointer" }}>
        <div style={{ width:56, height:56, borderRadius:"50%", background:"var(--eg-porpora-deep)", border:"2px solid var(--eg-accent)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 10px" }}>
          <span style={{ color:"#fff", fontWeight:800, fontSize:22, letterSpacing:"-0.5px", userSelect:"none" }}>EE</span>
        </div>
        <h1 style={{ fontSize:22, fontWeight:800, color:"var(--eg-text)", letterSpacing:"2px", lineHeight:1.2, margin:0 }}>EDICOLA <span style={{ color:"var(--eg-accent)" }}>ECCLESIASTICA</span></h1>
        <div style={{ fontSize:11, color:"var(--eg-text-dim)", fontWeight:600, letterSpacing:"1.5px", textTransform:"uppercase", marginTop:6 }}>
          Diritto canonico · Vaticano · Stato e Chiese
        </div>
      </div>
      {/* Nav items */}
      <nav style={{ padding:"12px 0", flex:1 }}>
        {ITEMS.map(item => {
          const active = activeTab === item.id;
          return (
            <button key={item.id} onClick={() => setActiveTab(item.id)} style={{ width:"100%", display:"flex", alignItems:"center", gap:12, padding:"10px 20px", background: active ? "var(--eg-accent)"+"15" : "transparent", border:"none", cursor:"pointer", borderLeft: active ? `3px solid var(--eg-accent)` : "3px solid transparent", textAlign:"left" }}>
              <span style={{ display:"flex", color: active ? "var(--eg-accent)" : "var(--eg-text-muted)", opacity: active?1:0.65, transition:"color 0.15s" }}>{item.svg}</span>
              <div>
                <div style={{ fontSize:13, fontWeight: active?700:500, color: active?"var(--eg-accent)":"var(--eg-text)" }}>{item.label}</div>
                <div style={{ fontSize:10, color:"var(--eg-text-dim)" }}>{item.desc}</div>
              </div>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function RightPanel() {
  const [trending, setTrending] = useState([]);
  const [stats, setStats] = useState(null);
  const [corpusAtti, setCorpusAtti] = useState(null);

  useEffect(() => {
    fetch(API + "/api/codici/trending?periodo=30&limit=8")
      .then(r => r.json())
      .then(d => setTrending(d.trending || []))
      .catch(() => {});
    fetch(API + "/api/health")
      .then(r => r.json())
      .then(d => setStats(d))
      .catch(() => {});
    fetch(API + "/api/norme/codici")
      .then(r => r.json())
      .then(d => { if (d && d.ok) setCorpusAtti(d.totale_atti || 0); })
      .catch(() => {});
  }, []);

  return (
    <aside style={{ width:"clamp(180px, 20vw, 280px)", flexShrink:0, borderLeft:"1px solid var(--eg-border)", display:"flex", flexDirection:"column", position:"sticky", top:0, height:"100vh", overflowY:"auto" }}>
      <div style={{ padding:"16px", borderBottom:"1px solid var(--eg-border)", display:"flex", gap:0 }}>
        {[
          { label:"Articoli", val: stats?.articles || "—" },
          { label:"Fonti", val: stats?.sources || "—" },
          { label:"Atti corpus", val: corpusAtti || "—" },
        ].map((s,i) => (
          <div key={i} style={{ flex:1, textAlign:"center", borderRight: i<2 ? `1px solid var(--eg-border)` : "none" }}>
            <div style={{ fontSize:18, fontWeight:800, color:"var(--eg-accent)", fontFamily:"monospace" }}>{typeof s.val === "number" ? s.val.toLocaleString() : s.val}</div>
            <div style={{ fontSize:9, color:"var(--eg-text-dim)", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.08em", marginTop:2 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ padding:"12px 16px 8px", borderBottom:"1px solid var(--eg-border)" }}>
        <div style={{ fontSize:10, fontWeight:700, color:"var(--eg-text-muted)", textTransform:"uppercase", letterSpacing:"0.1em" }}>⚡ Articoli più citati</div>
      </div>
      {trending.length === 0 ? (
        <div style={{ padding:"16px", fontSize:12, color:"var(--eg-text-dim)", lineHeight:1.6 }}>
          Le statistiche si popolano man mano che le notizie citano canoni e articoli del corpus.
          <div style={{ color:"var(--eg-accent)", fontSize:11, marginTop:4 }}>Attivo ogni domenica 03:00</div>
        </div>
      ) : (trending || []).map((t, i) => (
        <div key={i} style={{ padding:"10px 16px", borderBottom:`1px solid var(--eg-border)20`, display:"flex", gap:10, cursor:"pointer" }}
          onMouseEnter={e => e.currentTarget.style.background="var(--eg-surface-hover)"}
          onMouseLeave={e => e.currentTarget.style.background="transparent"}>
          <div style={{ fontSize:13, fontWeight:800, color: i<3 ? "var(--eg-accent)" : "var(--eg-text-dim)", minWidth:20 }}>{i+1}</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:12, fontWeight:700, color:"var(--eg-accent)", fontFamily:"monospace" }}>art. {t.numero} {CODICI_META.find(c=>c.id===t.codice_id)?.abbr || t.codice_id}</div>
            <div style={{ fontSize:11, color:"var(--eg-text-muted)", marginTop:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.l1_sintesi || t.titolo || "—"}</div>
            <div style={{ fontSize:11, fontWeight:700, color:"var(--eg-text)", marginTop:2 }}>{t.citazioni} citazioni</div>
          </div>
        </div>
      ))}
      <div style={{ padding:"14px 16px 8px", borderTop:"1px solid var(--eg-border)", marginTop:"auto" }}>
        <div style={{ fontSize:10, fontWeight:700, color:"var(--eg-text-muted)", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>🗂 Aree coperte</div>
        {[
          { area:"Santa Sede", color:"#C8A96E", fonti:8 },
          { area:"Diritto canonico", color:"#C46A7C", fonti:3 },
          { area:"Stato e Chiese", color:"#5C8AC4", fonti:4 },
          { area:"Chiesa in Italia", color:"#5CA065", fonti:7 },
          { area:"Libertà religiosa", color:"#D4A053", fonti:3 },
          { area:"Religioni", color:"#5CBAC4", fonti:8 },
        ].map((a,i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:7 }}>
            <div style={{ width:10, height:10, borderRadius:3, background:a.color, flexShrink:0 }}/>
            <div style={{ fontSize:12, color:"var(--eg-text)", flex:1 }}>{a.area}</div>
            <div style={{ fontSize:10, color:"var(--eg-text-dim)" }}>{a.fonti} fonti</div>
          </div>
        ))}
      </div>
    </aside>
  );
}



// ─── GLOBAL EVENT BUS ────────────────────────────────────────────────
const _readerListeners = [];
// ─── SEARCH BAR ─────────────────────────────────────────────────
// Barra di ricerca giuridica UNIFICATA (header, visibile da tutte le sezioni).
// Interroga /api/ricerca → tre gruppi: notizie, Cassazione, norme.
function SearchBar() {
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState({ notizie: [], cassazione: [], norme: [] });
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = React.useRef(null);
  const inputRef = React.useRef(null);
  // Su mobile la barra è collassata a icona lente e si espande al tap.
  const [expanded, setExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
    return () => { mq.removeEventListener ? mq.removeEventListener('change', onChange) : mq.removeListener(onChange); };
  }, []);

  const doSearch = (q) => {
    if (q.trim().length < 2) { setGroups({ notizie: [], cassazione: [], norme: [] }); setOpen(false); return; }
    setLoading(true);
    fetch(API + `/api/ricerca?q=${encodeURIComponent(q.trim())}`)
      .then(r => r.json())
      .then(d => {
        setGroups({ notizie: d.notizie || [], cassazione: d.cassazione || [], norme: d.norme || [] });
        setOpen(true); setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  const handleChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(v), 320);
  };

  const go = (tab, target) => {
    setOpen(false);
    document.dispatchEvent(new CustomEvent('eg:navigateTo', { detail: { tab } }));
    if (target) setTimeout(() => document.dispatchEvent(new CustomEvent('eg:searchQuery', { detail: { target, query: query.trim() } })), 60);
  };

  const openItem = (key, r) => {
    setOpen(false);
    if (key === 'notizie') document.dispatchEvent(new CustomEvent('eg:openArticle', { detail: { id: r.id } }));
    else if (key === 'cassazione') document.dispatchEvent(new CustomEvent('eg:openSentenza', { detail: { id: r.id } }));
    else if (key === 'norme') {
      // Naviga a Norme e apri l'articolo inline (PageNorme usa /api/norme/*)
      window.__pendingNormaArticolo = { codice_id: r.codice_id, numero: r.numero, codice_nome: r.fonte, codice_url: r.url };
      document.dispatchEvent(new CustomEvent('eg:navigateTo', { detail: { tab: 'norme' } }));
      setTimeout(() => document.dispatchEvent(new CustomEvent('eg:openNormaArticolo', { detail: window.__pendingNormaArticolo })), 90);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (query.trim().length < 2) return;
    const order = ['notizie', 'cassazione', 'norme'];
    const best = order.reduce((a, b) => (groups[b] || []).length > (groups[a] || []).length ? b : a, 'notizie');
    go(best, best === 'cassazione' ? 'sentenze' : (best === 'norme' ? 'norme' : null));
  };

  const total = groups.notizie.length + groups.cassazione.length + groups.norme.length;
  const GROUP_DEFS = [
    { key: 'notizie', label: 'Notizie', target: null },
    { key: 'cassazione', label: 'Cassazione', target: 'sentenze' },
    { key: 'norme', label: 'Norme', target: 'norme' },
  ];

  // Mobile collassata: solo icona lente, non occupa spazio e non spinge la nav
  if (isMobile && !expanded) {
    return (
      <button aria-label="Cerca" onClick={() => { setExpanded(true); setTimeout(() => inputRef.current && inputRef.current.focus(), 30); }}
        style={{ flexShrink:0, marginLeft:"auto", background:"var(--eg-surface-hover)", border:"none", borderRadius:8, padding:"8px 12px", cursor:"pointer", color:"var(--eg-text-muted)", fontSize:16, lineHeight:1 }}>🔍</button>
    );
  }

  return (
    <div style={{ position:"relative", display:"flex", alignItems:"center", gap:8, background:"var(--eg-surface-hover)", borderRadius:8, padding:"7px 14px", flex:1, maxWidth: isMobile ? "none" : 460 }}>
      <span style={{ color:"var(--eg-text-muted)", fontSize:13 }}>🔍</span>
      <input ref={inputRef} type="text" value={query} onChange={handleChange}
        placeholder="Cerca in notizie, codici e canoni..."
        onFocus={() => { if (total > 0) setOpen(true); }}
        onBlur={() => setTimeout(() => { setOpen(false); if (isMobile && !query.trim()) setExpanded(false); }, 200)}
        onKeyDown={handleKeyDown}
        style={{ flex:1, minWidth:0, background:"transparent", border:"none", outline:"none", color:"var(--eg-text)", fontSize:13 }}
      />
      {loading && <span style={{ fontSize:10, color:"var(--eg-text-dim)" }}>...</span>}
      {(query || isMobile) && <button aria-label="Chiudi ricerca" onClick={() => { setQuery(""); setGroups({ notizie: [], cassazione: [], norme: [] }); setOpen(false); if (isMobile) setExpanded(false); }} style={{ background:"transparent", border:"none", color:"var(--eg-text-dim)", cursor:"pointer", fontSize:14, padding:0 }}>✕</button>}
      {/* Pannello risultati a tre gruppi */}
      {open && total > 0 && (
        <div style={{
          position:"absolute", top:"100%", left:0, right:0, marginTop:4,
          background:"var(--eg-surface)", border:"1px solid var(--eg-border)",
          borderRadius:8, boxShadow:"0 8px 24px rgba(0,0,0,0.3)", zIndex:200,
          maxHeight:440, overflowY:"auto",
        }}>
          {GROUP_DEFS.map(g => {
            const items = groups[g.key] || [];
            if (items.length === 0) return null;
            return (
              <div key={g.key}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 14px 4px", position:"sticky", top:0, background:"var(--eg-surface)" }}>
                  <span style={{ fontSize:10.5, fontWeight:800, color:"var(--eg-text-muted)", textTransform:"uppercase", letterSpacing:"0.08em" }}>{g.label} <span style={{ color:"var(--eg-accent)" }}>{items.length}</span></span>
                  <button onMouseDown={(e) => { e.preventDefault(); go(g.key, g.target); }} style={{ background:"transparent", border:"none", color:"var(--eg-accent)", fontSize:11, cursor:"pointer", fontWeight:600 }}>vedi tutti →</button>
                </div>
                {items.slice(0, 4).map((r, i) => (
                  <div key={i} onMouseDown={(e) => { e.preventDefault(); openItem(g.key, r); }} style={{
                    padding:"8px 14px", cursor:"pointer",
                  }}
                    onMouseEnter={e => e.currentTarget.style.background="var(--eg-surface-hover)"}
                    onMouseLeave={e => e.currentTarget.style.background="transparent"}
                  >
                    <div style={{ fontSize:12, color:"var(--eg-text)", lineHeight:1.4, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.titolo}</div>
                    <div style={{ fontSize:10, color:"var(--eg-text-dim)", marginTop:1 }}>{r.fonte}</div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {open && total === 0 && query.trim().length >= 2 && !loading && (
        <div style={{
          position:"absolute", top:"100%", left:0, right:0, marginTop:4,
          background:"var(--eg-surface)", border:"1px solid var(--eg-border)",
          borderRadius:8, padding:"14px", fontSize:12, color:"var(--eg-text-muted)",
          boxShadow:"0 8px 24px rgba(0,0,0,0.3)", zIndex:200,
        }}>Nessun risultato per "{query}"</div>
      )}
    </div>
  );
}

const ReaderBus = {
  open: (item) => _readerListeners.forEach(fn => fn(item)),
  subscribe: (fn) => { _readerListeners.push(fn); return () => { const i = _readerListeners.indexOf(fn); if (i>=0) _readerListeners.splice(i,1); }; },
};

// ─── ASSISTENTE EG — Bottone "?" fisso + pannello chat ───────────────────────
function AssistenteEG() {
  const [aperto, setAperto] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messaggi, setMessaggi] = useState([]); // [{ruolo:'utente'|'assistente', testo}]
  const [hoveredBtn, setHoveredBtn] = useState(false);
  const msgEndRef = React.useRef(null);

  // Espone l'apertura del pannello per la voce "Guida" della navigazione.
  React.useEffect(() => {
    window.__assistenteOpen = () => setAperto(true);
    return () => { delete window.__assistenteOpen; };
  }, []);

  // ── Drag state ──
  const [helpPos, setHelpPos] = useState(() => ({
    x: 20,
    y: window.innerHeight - 100,
  }));
  const [helpDragging, setHelpDragging] = useState(false);
  const helpDragOffset = React.useRef({ x: 0, y: 0 });
  const helpDragMoved = React.useRef(0); // distanza totale percorsa

  // Listener pointermove / pointerup registrati sul document quando dragging
  React.useEffect(() => {
    if (!helpDragging) return;
    const onMove = (e) => {
      const nx = e.clientX - helpDragOffset.current.x;
      const ny = e.clientY - helpDragOffset.current.y;
      // accumula distanza per distinguere click da drag
      const dx = nx - (helpPos.x);
      const dy = ny - (helpPos.y);
      helpDragMoved.current += Math.sqrt(dx*dx + dy*dy);
      // constrain nella viewport
      const maxX = window.innerWidth  - 72;
      const maxY = window.innerHeight - 80;
      setHelpPos({ x: Math.max(0, Math.min(maxX, nx)), y: Math.max(0, Math.min(maxY, ny)) });
    };
    const onUp = () => setHelpDragging(false);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [helpDragging]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scorri in fondo quando arriva un nuovo messaggio
  React.useEffect(() => {
    if (aperto && msgEndRef.current) {
      msgEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messaggi, aperto]);

  async function invia() {
    const domanda = input.trim();
    if (!domanda || loading) return;
    const nuoviMsg = [...messaggi, { ruolo: 'utente', testo: domanda }].slice(-20);
    setMessaggi(nuoviMsg);
    setInput('');
    setLoading(true);
    try {
      const resp = await fetch(API + '/api/help/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domanda }),
      });
      const data = await resp.json();
      const risposta = data.ok ? (data.risposta || 'Nessuna risposta.') : (data.errore || 'Errore sconosciuto.');
      setMessaggi(prev => [...prev, { ruolo: 'assistente', testo: risposta }].slice(-20));
    } catch(e) {
      setMessaggi(prev => [...prev, { ruolo: 'assistente', testo: 'Errore di rete. Riprova tra qualche secondo.' }].slice(-20));
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); invia(); }
  }

  const C = getColors();

  // Posizione pannello: se bottone è a dx della viewport apri a sinistra, altrimenti a destra
  const PANEL_W = Math.min(350, window.innerWidth - 40);
  const PANEL_H = 500;
  const btnOnRight = helpPos.x > window.innerWidth / 2;
  const panelLeft = btnOnRight
    ? Math.max(4, helpPos.x - PANEL_W - 8)
    : Math.min(helpPos.x + 72, window.innerWidth - PANEL_W - 4);
  const panelTop = Math.max(4, helpPos.y - PANEL_H - 8);

  return (
    <>
      {/* Pannello chat — overlay fisso in basso a destra, sopra la bottom-nav */}
      {aperto && (
        <div style={{
          position: 'fixed',
          right: 16,
          bottom: 88,
          width: 'min(360px, calc(100vw - 32px))',
          maxHeight: 'min(70vh, 520px)',
          zIndex: 10000,
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Titolo */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: `1px solid ${C.border}`,
            background: C.accent + '18',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.accent, letterSpacing: '0.04em' }}>
              Assistente EG
            </span>
            <button
              onClick={() => setAperto(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: 18, lineHeight: 1, padding: '0 2px' }}
              title="Chiudi"
            >×</button>
          </div>

          {/* Lista messaggi */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}>
            {messaggi.length === 0 && (
              <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.6, textAlign: 'center', marginTop: 12 }}>
                Ciao! Sono l'assistente di Edicola Ecclesiastica.<br/>
                Chiedimi come usare la piattaforma.
              </div>
            )}
            {messaggi.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.ruolo === 'utente' ? 'flex-end' : 'flex-start',
                maxWidth: '88%',
              }}>
                <div style={{
                  fontSize: 12,
                  lineHeight: 1.55,
                  padding: '8px 11px',
                  borderRadius: m.ruolo === 'utente' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                  background: m.ruolo === 'utente' ? C.accent + '30' : C.surfaceHover,
                  color: C.text,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {m.testo}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ alignSelf: 'flex-start', fontSize: 12, color: C.textMuted, fontStyle: 'italic' }}>
                Elaboro...
              </div>
            )}
            <div ref={msgEndRef} />
          </div>

          {/* Input */}
          <div style={{
            display: 'flex',
            gap: 8,
            padding: '10px 12px',
            borderTop: `1px solid ${C.border}`,
            flexShrink: 0,
            background: C.surface,
          }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Come uso il Dossier?"
              disabled={loading}
              style={{
                flex: 1,
                fontSize: 12,
                padding: '7px 10px',
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: C.surfaceHover,
                color: C.text,
                outline: 'none',
              }}
            />
            <button
              onClick={invia}
              disabled={loading || !input.trim()}
              style={{
                padding: '7px 13px',
                borderRadius: 8,
                border: 'none',
                background: C.accent,
                color: '#1A1200',
                fontSize: 12,
                fontWeight: 700,
                cursor: loading || !input.trim() ? 'default' : 'pointer',
                opacity: loading || !input.trim() ? 0.5 : 1,
                flexShrink: 0,
              }}
            >Chiedi</button>
          </div>
        </div>
      )}

      {/* Bottone fluttuante rimosso: l'Assistente si apre dalla voce "Guida" della nav */}
    </>
  );
}

export default function EdicolaGiuridica() {
  const [darkMode, setDarkMode] = useState(() => {
    // Leggi preferenza salvata, default dark
    try { return localStorage.getItem('eg-theme') !== 'light'; } catch(e) { return true; }
  });
  // Aggiorna tema globale a ogni render
  _darkMode = darkMode;
  COLORS = getColors();
  const [activeTab, setActiveTab] = useState('notizie');
  const [readerItem, setReaderItem] = useState(null);
  const [globalPannelloSentenzaId, setGlobalPannelloSentenzaId] = useState(null);
  const [globalPannelloSentenzaPdf, setGlobalPannelloSentenzaPdf] = useState(null);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  // Espone la funzione globalmente per il bottone nel Manifesto
  React.useEffect(() => { window.__disclaimerOpen = () => setDisclaimerOpen(true); return () => { delete window.__disclaimerOpen; }; }, []);
  useEffect(() => {
    return ReaderBus.subscribe((item) => setReaderItem(item));
  }, []);

  // Global event handlers for internal navigation from any panel
  useEffect(() => {
    const handleOpenArticle = (e) => {
      const id = e.detail?.id;
      const item = e.detail?.item;
      if (!id && !item) return;
      // If full item passed, use directly
      if (item) { setReaderItem(item); return; }
      // Fetch articolo per ID diretto — fallback a lista se non trovato
      fetch(API + `/api/articles?id=${encodeURIComponent(id)}`)
        .then(r => r.json())
        .then(d => {
          if (d.ok && d.article) { setReaderItem(d.article); return; }
          // Fallback: cerca nella lista recente (per retrocompatibilità)
          return fetch(API + `/api/articles?limit=200`)
            .then(r2 => r2.json())
            .then(d2 => {
              const arr = Array.isArray(d2) ? d2 : (d2.articles || d2.items || []);
              const found = arr.find(a => String(a.id) === String(id));
              if (found) setReaderItem(found);
              else setReaderItem({ id, title: '—', source: 'Notizia', desc: '' });
            });
        })
        .catch(() => setReaderItem({ id, title: '—', source: 'Notizia', desc: '' }));
    };
    const handleOpenSentenza = (e) => {
      const id = e.detail?.id;
      if (!id) return;
      window.__pendingSentenza = id;
      window.__pendingSentenzaUrl = e.detail?.url || null; // PDF ufficiale per fallback difensivo
      setActiveTab('cassazione');
      setTimeout(() => document.dispatchEvent(new CustomEvent('eg:cassazioneActivated')), 80);
    };
    const handleShowSentenzaPanel = (e) => {
      const id = e.detail?.id;
      if (id) { setGlobalPannelloSentenzaId(id); setGlobalPannelloSentenzaPdf(e.detail?.url || null); }
    };
    const handleOpenNorma = (e) => {
      const codice = e.detail?.codice;
      if (!codice) return;
      window.__pendingNorma = codice;
      setActiveTab('grafo');
      // Notifica PageGrafo dopo il re-render — piccolo delay per dare tempo al tab switch
      setTimeout(() => document.dispatchEvent(new CustomEvent('eg:grafoActivated')), 80);
    };
    const handleNavigateTo = (e) => {
      const tab = e.detail?.tab;
      if (tab) setActiveTab(tab);
    };
    // Intercetta eg:searchQuery a livello root — stash in window per lettura on-mount
    const handleSearchQuery = (e) => {
      const { query, target } = e.detail || {};
      if (query && target) window.__pendingSearch = { query, target };
    };
    document.addEventListener('eg:openArticle', handleOpenArticle);
    document.addEventListener('eg:openSentenza', handleOpenSentenza);
    document.addEventListener('eg:showSentenzaPanel', handleShowSentenzaPanel);
    document.addEventListener('eg:openNorma', handleOpenNorma);
    document.addEventListener('eg:navigateTo', handleNavigateTo);
    document.addEventListener('eg:searchQuery', handleSearchQuery);
    return () => {
      document.removeEventListener('eg:openArticle', handleOpenArticle);
      document.removeEventListener('eg:openSentenza', handleOpenSentenza);
      document.removeEventListener('eg:showSentenzaPanel', handleShowSentenzaPanel);
      document.removeEventListener('eg:openNorma', handleOpenNorma);
      document.removeEventListener('eg:navigateTo', handleNavigateTo);
      document.removeEventListener('eg:searchQuery', handleSearchQuery);
    };
  }, []);

  // Aggiorna CSS variables per il tema
  useEffect(() => {
    const C = darkMode ? DARK : LIGHT;
    const root = document.documentElement;
    root.style.setProperty('--eg-bg', C.bg);
    root.style.setProperty('--eg-surface', C.surface);
    root.style.setProperty('--eg-surface-hover', C.surfaceHover);
    root.style.setProperty('--eg-border', C.border);
    root.style.setProperty('--eg-accent', C.accent);
    root.style.setProperty('--eg-accent-dim', C.accentDim);
    root.style.setProperty('--eg-text', C.text);
    root.style.setProperty('--eg-text-muted', C.textMuted);
    root.style.setProperty('--eg-text-dim', C.textDim);
    root.style.setProperty('--eg-danger', C.danger);
    root.style.setProperty('--eg-success', C.success);
    root.style.setProperty('--eg-trending', C.trending);
    root.style.setProperty('--eg-porpora', C.porpora);
    root.style.setProperty('--eg-porpora-deep', C.porporaDeep);
    document.body.style.background = C.bg;
  }, [darkMode]);
  const [articoloPanel, setArticoloPanel] = useState(null); // {codiceId, numero}

  // Handler per eg:openCodice — apre ArticoloPanel direttamente (no tab switch)
  useEffect(() => {
    const abbrToId = {
      "c.c.":"codice_civile","c.p.":"codice_penale","c.p.c.":"cpc","c.p.p.":"cpp",
      "cost.":"costituzione","tuir":"tuir","ccii":"codice_crisi",
      "d.lgs. 196/2003":"codice_privacy","d.lgs. 36/2023":"codice_contratti",
      "d.lgs. 231/2001":"d231_2001","cod.cons.":"codice_consumo","l. 241/1990":"l241_1990","l. 300/1970":"statuto_lavoratori",
    };
    const handleOpenCodice = (e) => {
      const { codice_id, numero } = e.detail || {};
      if (codice_id && numero) {
        setArticoloPanel({ codiceId: codice_id, numero: String(numero) });
        return;
      }
      // Fallback: parse norma string "art. 1453 c.c."
      const norma = e.detail?.norma || '';
      const m = norma.match(/art\.?\s*([\d\w-]+)\s+(.+)/i);
      if (!m) return;
      const num = m[1];
      const abbrRaw = m[2].trim().toLowerCase();
      const cId = abbrToId[abbrRaw] || null;
      if (cId) setArticoloPanel({ codiceId: cId, numero: num });
    };
    document.addEventListener('eg:openCodice', handleOpenCodice);
    return () => document.removeEventListener('eg:openCodice', handleOpenCodice);
  }, []);

  const handleOpenReader = useCallback((item) => {
    setReaderItem(item);
  }, []);

  const handleOpenArticolo = useCallback((ref) => {
    // Parsa "art. 1453 c.c." → {codiceId: "codice_civile", numero: "1453"}
    const abbrToId = {
      "c.c.":"codice_civile","c.p.":"codice_penale","c.p.c.":"cpc","c.p.p.":"cpp",
      "cost.":"costituzione","tuir":"tuir","ccii":"codice_crisi",
      "d.lgs. 196/2003":"codice_privacy","d.lgs. 36/2023":"codice_contratti",
    };
    const m = ref.match(/art\.\s*([\d\w-]+)\s+(.+)/i);
    if (!m) return;
    const numero = m[1];
    const abbrRaw = m[2].trim().toLowerCase();
    const codiceId = abbrToId[abbrRaw] || abbrRaw.replace(/\./g,"_");
    setArticoloPanel({ codiceId, numero });
  }, []);

  // Componenti pre-montati e stabili — i dati vengono fetchati una volta sola
  const paginaNotizie = React.useMemo(() => <PageNotizie onOpenArticolo={handleOpenArticolo} onNavigate={setActiveTab} />, [handleOpenArticolo, setActiveTab]);
  const paginaTrending = React.useMemo(() => <PageTrending />, []);
  const paginaCodici = React.useMemo(() => <PageCodici onOpenArticolo={handleOpenArticolo} />, [handleOpenArticolo]);
  const paginaCassazione = React.useMemo(() => <PageCassazione onOpenArticolo={handleOpenArticolo} />, [handleOpenArticolo]);
  const paginaNorme = React.useMemo(() => <PageNorme />, []);
  const paginaConsulta   = React.useMemo(() => <PageCorteCostituzionale />, []);
  const paginaEurLex     = React.useMemo(() => <PageEurLex />, []);
  const paginaAlert = React.useMemo(() => <PageAlert />, []);
  const paginaFonti = React.useMemo(() => <PageFonti />, []);
  const paginaGrafo = React.useMemo(() => <PageGrafo />, []);
  const paginaGenio     = React.useMemo(() => <PageGenio />, []);
  const paginaAula      = React.useMemo(() => <PageAula />, []);
  const paginaManifesto = React.useMemo(() => <PageManifesto />, []);

  const renderPage = () => {
    switch(activeTab) {
      case "notizie": return paginaNotizie;
      case "trending": return paginaTrending;
      case "codici": return paginaCodici;
      case "cassazione": return paginaCassazione;
      case "norme": return paginaNorme;
      case "consulta":   return paginaConsulta;
      case "eurlex":     return paginaEurLex;
      case "alert": return paginaAlert;
      case "fonti": return paginaFonti;
      case "grafo": return paginaGrafo;
      case "genio": return paginaGenio;
      case "aula": return paginaAula;
      case "info": return paginaManifesto;
      default: return paginaNotizie;
    }
  };

  // Navigazione: le sezioni cambiano tab; "guida" apre il pannello Assistente EG.
  const [activeRamo, setActiveRamo] = useState(null);
  const onNav = (id, ramo) => {
    if (id === 'guida') { if (window.__assistenteOpen) window.__assistenteOpen(); return; }
    if (id === 'norme') {
      window.__pendingRamo = ramo || null;
      setActiveRamo(ramo || null);
      document.dispatchEvent(new CustomEvent('eg:ramoChange', { detail: ramo || null }));
    } else {
      setActiveRamo(null);
    }
    setActiveTab(id);
  };

  // ── LAYOUT UNICO (desktop + mobile via CSS) ───────────────────────
  return (
    <div className="eg-app" style={{ background:"var(--eg-bg)", minHeight:"100vh", fontFamily:"'Crimson Pro','Georgia',serif" }}>

      {/* Contenuto centrale */}
      <div className="eg-main-col" style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0 }}>
        {/* Topbar */}
        <header style={{ padding:"10px 16px", borderBottom:"1px solid var(--eg-border)", background:"var(--eg-surface)", position:"sticky", top:0, zIndex:100, display:"flex", alignItems:"center", gap:12 }}>
          {/* Logo — sempre visibile */}
          <div className="eg-topbar-logo" onClick={() => setActiveTab("notizie")} style={{ cursor:"pointer", flexShrink:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <img src="/stemma.png" alt="Edicola Ecclesiastica — Chiesa, Diritto e Società"
                style={{ height:54, width:"auto", flexShrink:0, filter:"drop-shadow(0 1px 3px rgba(0,0,0,0.35))" }} />
              <div style={{ fontSize:13, fontWeight:800, color:"var(--eg-text)", lineHeight:1.1 }}>EDICOLA<br/><span style={{ color:"var(--eg-accent)" }}>ECCLESIASTICA</span></div>
            </div>
          </div>
          {/* Nav sezioni — orizzontale nell'header, solo desktop (>768px via CSS) */}
          <nav className="eg-header-nav">
            {NAV_ITEMS.map(item => {
              const active = item.id !== 'guida' && activeTab === item.id && (item.id !== 'norme' || activeRamo === (item.ramo || null));
              return (
                <button key={item.id + (item.ramo || '')} className={"eg-nav-btn" + (active ? " active" : "")} onClick={() => onNav(item.id, item.ramo)}>
                  <span style={{ display:"inline-flex" }}>{TAB_SVGS[item.id]}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          {/* Barra di ricerca — non spinge mai fuori la nav (collassabile su mobile) */}
          <SearchBar />
          {/* Toggle tema */}
          <button
            onClick={() => setDarkMode(d => {
              const next = !d;
              try { localStorage.setItem('eg-theme', next ? 'dark' : 'light'); } catch(e) {}
              return next;
            })}
            title={darkMode ? "Passa a tema chiaro" : "Passa a tema scuro"}
            style={{
              flexShrink: 0,
              background: darkMode ? "var(--eg-surface-hover)" : "#E8E4DD",
              border: "1px solid var(--eg-border)",
              borderRadius: 20,
              padding: "6px 10px",
              cursor: "pointer",
              fontSize: 14,
              lineHeight: 1,
              color: "var(--eg-text-muted)",
              display: "flex",
              alignItems: "center",
              gap: 4,
              transition: "all 0.2s",
            }}
          >
            {darkMode ? "☀️" : "🌙"}
          </button>
        </header>

        <main style={{ flex:1, overflowY:"auto", paddingBottom:60 }}>{renderPage()}</main>

        {/* Footer con disclaimer fisso */}
        <footer style={{ borderTop:"1px solid var(--eg-border)", background:"var(--eg-surface)", flexShrink:0 }}>
          {/* Disclaimer bar — cliccabile */}
          <div onClick={() => setDisclaimerOpen(true)} style={{
            padding:"7px 20px", background:"rgba(200,169,110,0.08)", borderBottom:"1px solid var(--eg-border)",
            textAlign:"center", fontSize:11, color:"var(--eg-text-dim)", cursor:"pointer",
            transition:"background 0.15s",
          }}
          onMouseEnter={e => e.currentTarget.style.background="rgba(200,169,110,0.15)"}
          onMouseLeave={e => e.currentTarget.style.background="rgba(200,169,110,0.08)"}
          >
            ⚖️ Strumento di supporto alla ricerca giuridica. Non sostituisce il parere professionale. Supervisione umana sempre necessaria. <span style={{ color:"var(--eg-accent)", textDecoration:"underline" }}>Avvertenze</span>
          </div>
          {/* Copyright */}
          <div style={{ padding:"8px 20px", textAlign:"center", fontSize:10, color:"var(--eg-text-dim)" }}>
            © 2026 Edicola Ecclesiastica — Intelligence giuridica italiana · <a href="/manifesto" style={{ color:"var(--eg-accent)", textDecoration:"none" }}>Manifesto</a>
          </div>
        </footer>

        {/* Bottom nav — visibile solo su mobile via CSS */}
        <nav className="eg-mobile-nav" style={{ position:"fixed", bottom:0, left:0, right:0, background:"var(--eg-surface)", borderTop:"1px solid var(--eg-border)", justifyContent:"space-around", padding:"6px 0 8px", zIndex:100 }}>
          {NAV_ITEMS.map(item => {
            const active = item.id !== 'guida' && activeTab === item.id && (item.id !== 'norme' || activeRamo === (item.ramo || null));
            return (
              <button key={item.id + (item.ramo || '')} onClick={() => onNav(item.id, item.ramo)} style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", alignItems:"center", gap:2, padding:"6px 2px", background:"transparent", border:"none", cursor:"pointer" }}>
                <span style={{ display:"flex", color: active ? "var(--eg-accent)" : "var(--eg-text-dim)" }}>{TAB_SVGS[item.id]}</span>
                <span style={{ fontSize:9.5, fontWeight:active?700:500, color:active?"var(--eg-accent)":"var(--eg-text-dim)", whiteSpace:"nowrap", letterSpacing:"-0.01em" }}>{item.short || item.label}</span>
                {active && <div style={{ width:18, height:2, borderRadius:1, background:"var(--eg-accent)" }}/>}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Pannello destra — nascosto su mobile */}
      <div className="eg-right-panel">
        <RightPanel />
      </div>

      {articoloPanel && <ArticoloPanel codiceId={articoloPanel.codiceId} numero={articoloPanel.numero} onClose={() => setArticoloPanel(null)} />}
      {readerItem && <ArticleReaderPanel item={readerItem} onClose={() => setReaderItem(null)} onOpenArticolo={handleOpenArticolo} />}
      {globalPannelloSentenzaId && <PannelloSentenza id={globalPannelloSentenzaId} pdfUrl={globalPannelloSentenzaPdf} onClose={() => { setGlobalPannelloSentenzaId(null); setGlobalPannelloSentenzaPdf(null); }} />}
      {disclaimerOpen && <DisclaimerPopup onClose={() => setDisclaimerOpen(false)} />}

      {/* Assistente EG — bottone "?" fisso + pannello chat */}
      <AssistenteEG />
    </div>
  );
}
