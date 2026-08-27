"use strict";

// Batching canonique et déterministe des connaissances Noès (mission du
// 26/08/2026) : une vidéo contient au maximum 5 connaissances, découpées par
// POSITION dans le script (1-5, 6-10, 11-15, 16-20), jamais par proximité
// thématique ni aucune autre heuristique — deux utilisateurs avec la même
// fiche doivent TOUJOURS obtenir le même découpage, condition nécessaire à
// la mutualisation vidéo (cf. lib/coeus/video-hash.js).
const NOES_BATCH_SIZE = 5;

function buildNoesBatches(items) {
  if (!Array.isArray(items)) return [];
  const batches = [];
  for (let i = 0; i < items.length; i += NOES_BATCH_SIZE) {
    batches.push(items.slice(i, i + NOES_BATCH_SIZE));
  }
  return batches;
}

function noesBatchCount(itemCount) {
  const count = Number(itemCount) || 0;
  return Math.ceil(Math.max(0, count) / NOES_BATCH_SIZE);
}

module.exports = { NOES_BATCH_SIZE, buildNoesBatches, noesBatchCount };
