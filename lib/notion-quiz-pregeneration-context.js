"use strict";

// Contexte implicite de pré-génération (chantier "pré-génération en avance
// des sujets IA proposés", 07/09/2026) — un singleton AsyncLocalStorage
// partagé entre le driver de pré-génération (qui l'active via `.run()`) et
// `_callOpenAI` (server.js, qui le lit via `.getStore()`).
//
// Pourquoi AsyncLocalStorage plutôt qu'un flag explicite propagé de fonction
// en fonction : le pipeline progressif existant (resolveWebSearchGrounding,
// resolveProgressiveCurriculum, evidenceGateAndRepairCurriculumSubset,
// generateProgressiveLevelBlock, qualityControlRawQuestions...) reste
// INTÉGRALEMENT inchangé — aucune de leurs signatures ne porte ce contexte.
// Seul _callOpenAI (le point d'entrée UNIQUE de tout appel IA du pipeline,
// server.js:13183) le consulte, quel que soit le niveau d'imbrication d'où
// il est appelé.
//
// Contenu du store : { queueId, occurrenceCounts } — `occurrenceCounts` est
// une Map réinitialisée à CHAQUE tentative de rejeu (une par cycle
// scheduler), incrémentée à chaque appel _callOpenAI rencontré dans l'ordre
// naturel du pipeline, pour construire l'occurrence déterministe du
// custom_id ("<queueId>:<callKey>:<occurrence>") — cf.
// lib/notion-quiz-pregeneration-step-cache.js.

const { AsyncLocalStorage } = require("node:async_hooks");

const pregenerationContext = new AsyncLocalStorage();

function runInPregenerationContext(queueId, fn) {
  return pregenerationContext.run({ queueId, occurrenceCounts: new Map() }, fn);
}

function nextOccurrence(store, callKey) {
  const occurrence = (store.occurrenceCounts.get(callKey) || 0) + 1;
  store.occurrenceCounts.set(callKey, occurrence);
  return occurrence;
}

module.exports = { pregenerationContext, runInPregenerationContext, nextOccurrence };
