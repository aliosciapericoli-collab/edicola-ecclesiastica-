'use strict';
/**
 * services/dossier-sonnet-worker.js — Worker thread per generaDossierSonnet
 * Eseguito in un worker thread separato così il thread principale
 * di Node.js rimane libero durante le query SQLite (better-sqlite3).
 *
 * Comunicazione: workerData → { domanda, norme }
 *                parentPort.postMessage → { ok, result } | { ok: false, errore }
 */

const { workerData, parentPort } = require('worker_threads');

async function main() {
  try {
    const { generaDossierSonnet } = require('./dossier-generator');
    const { domanda, norme } = workerData;
    const result = await generaDossierSonnet(domanda, norme);
    parentPort.postMessage({ ok: true, result });
  } catch(e) {
    parentPort.postMessage({ ok: false, errore: e.message });
  }
}

main();
