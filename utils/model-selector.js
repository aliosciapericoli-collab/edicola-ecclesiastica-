'use strict';
/**
 * utils/model-selector.js
 * Selezione automatica del modello Claude in base al livello/task.
 *
 * HAIKU  → L0, L1, L2, classificazione, estrazione, parsing, sintesi breve
 * SONNET → L3, L4, L5, ragionamento giuridico, interpretazione, deduzione
 * OPUS   → mai automatico, solo su richiesta esplicita
 */

const HAIKU  = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';

const HAIKU_TASKS = new Set([
  'l0', 'l1', 'l2',
  'classificazione', 'estrazione', 'parsing',
  'sintesi', 'fact', 'soggetti', 'norme_citate',
]);

/**
 * @param {string} livello — es. 'l1', 'l3', 'estrazione', 'analisi'
 * @param {object} [opts]
 * @param {boolean} [opts.log] — stampa log del modello scelto (default true)
 * @returns {string} nome modello
 */
function getModel(livello, opts = {}) {
  const key = (livello || '').toLowerCase().trim();
  const shouldLog = opts.log !== false;

  if (HAIKU_TASKS.has(key)) {
    if (shouldLog) console.log(`[Model] Usando Haiku per ${livello.toUpperCase()}`);
    return HAIKU;
  }

  if (shouldLog) console.log(`[Model] Usando Sonnet per ${livello.toUpperCase()}`);
  return SONNET;
}

module.exports = { getModel, HAIKU, SONNET };
