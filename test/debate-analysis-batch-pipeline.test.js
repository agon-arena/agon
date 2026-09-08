"use strict";

// Tests de bout en bout du chantier "manuel = synchrone / automatique =
// Batch OpenAI" pour les rapports IA de débat (08/09/2026). Exerce le VRAI
// generateAnalysisJson (lib/debate-analysis.js, jamais réécrit ni mocké) et
// le VRAI lib/debate-analysis-batch-cache.js — seule la frontière réseau
// (callOpenAI) et Supabase sont remplacées, comme partout ailleurs dans ce
// projet. AUCUN appel OpenAI réel : `networkCalls` explose si le transport
// synchrone est atteint alors qu'il ne devrait pas l'être (chemin
// automatique), ce qui couvre explicitement les tests A/B demandés
// ("aucun _callOpenAI réel" / "aucun appel synchrone").
//
// Couvre les tests A à F de la demande :
//   A. clic manuel → synchrone, aucun Batch.
//   B. expiration du compte à rebours → Batch, aucun appel synchrone.
//   C. résultat Batch terminé → parsing + persistance corrects.
//   D. même rapport déjà généré → pas de deuxième génération inutile.
//   E. Batch en attente puis clic manuel → génération manuelle immédiate,
//      sans toucher au Batch en attente.
//   F. échec Batch → état cohérent, aucune boucle de génération.

const test = require("node:test");
const assert = require("node:assert/strict");
const { makeFakeSupabase } = require("./helpers/fake-supabase");
const { generateAnalysisJson } = require("../lib/debate-analysis");
const batchCache = require("../lib/debate-analysis-batch-cache");

// ── Fixture : arène libre, une seule idée, aucune URL, aucun barème perso —
// n'exige donc qu'UN SEUL appel IA (P2Open) pour aboutir : P1 ne tourne
// jamais pour une arène libre, la grille par défaut ne fait aucun appel sans
// axe personnalisé, et sans URL sourcée P3 ne se déclenche pas.
function makePayload({ argumentId = 7, votes = 3 } = {}) {
  return {
    question: "Faut-il généraliser le télétravail ?",
    positionA: "",
    positionB: "",
    content: "",
    evaluation_axis: "",
    correction_strictness: "normal",
    previousAnalysis: null,
    argumentsA: [{
      id: argumentId,
      text: "Le télétravail réduit les temps de trajet et améliore l'équilibre de vie, mais nécessite un cadre managérial adapté pour rester efficace sur la durée.",
      votes,
      paste_ratio: 0,
      source_url: "",
      merged_votes: null,
      merged_count: null
    }],
    argumentsB: [],
    comments: []
  };
}

// Réponse P2Open valide, score volontairement loin de toute frontière de
// catégorie (50/70/85 ± 6) pour n'exiger qu'UN SEUL appel de notation (cf.
// isNearCategoryBoundary dans lib/debate-analysis.js) — total = 60.
const FAKE_P2_RESPONSE = JSON.stringify({
  argumentId: 7,
  scores_without_sources: { pertinence: 12, clarity: 8, reasoning: 15, precision: 15, nuance: 7, tone: 3, total_without_sources: 60 },
  category_without_sources: "moyen",
  strengths: [],
  weaknesses: [],
  short_explanation: ""
});

function makeManualCallOpenAI(networkCalls) {
  return async (messages, opts = {}) => {
    networkCalls.push(opts.feature || opts.stepKey);
    return FAKE_P2_RESPONSE;
  };
}

// Même construction que server.js/_generateAndSaveAnalysis côté automatique :
// chaque appel est redirigé vers le cache Batch plutôt que vers le réseau.
// `networkCalls` (partagé avec makeManualCallOpenAI dans les tests) ne doit
// JAMAIS être incrémenté ici — seul le vrai transport synchrone le fait.
function makeAutomaticCallOpenAI(supabase, debateId, networkCalls) {
  return async (messages, opts = {}) => {
    const r = await batchCache.resolveStep({
      supabase, debateId, stepKey: opts.stepKey || opts.feature, feature: opts.feature || null,
      requestPayload: { model: opts.model || "gpt-4o-mini", messages, ...(opts.temperature != null ? { temperature: opts.temperature } : {}) }
    });
    return r.content;
  };
}

test("A — clic manuel : chemin synchrone, résultat immédiat, table Batch jamais touchée", async () => {
  const supabase = makeFakeSupabase();
  const networkCalls = [];
  const result = await generateAnalysisJson(makePayload(), makeManualCallOpenAI(networkCalls));

  assert.equal(networkCalls.length, 1, "un seul appel synchrone attendu (P2Open)");
  assert.equal(result.camps.A.effectiveArguments[0].final_score, 60);
  assert.equal(supabase.rows("debate_analysis_batch_calls").length, 0, "le chemin manuel ne doit jamais écrire dans la table Batch");
});

test("B — expiration du compte à rebours : Batch, aucun appel synchrone, débat mis en attente", async () => {
  const supabase = makeFakeSupabase();
  const networkCalls = [];
  const debateId = 42;

  await assert.rejects(
    () => generateAnalysisJson(makePayload(), makeAutomaticCallOpenAI(supabase, debateId, networkCalls)),
    batchCache.DebateBatchPendingError
  );

  assert.equal(networkCalls.length, 0, "AUCUN appel OpenAI synchrone ne doit être atteint côté automatique");
  const rows = supabase.rows("debate_analysis_batch_calls");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].debate_id, debateId);
  assert.equal(rows[0].step_key, "p2_7_a");
});

test("C — résultat Batch terminé : parsing + persistance identiques au chemin synchrone", async () => {
  const supabase = makeFakeSupabase();
  const networkCalls = [];
  const debateId = 43;

  // 1er cycle : enregistrement pending (comme le test B).
  await assert.rejects(() => generateAnalysisJson(makePayload(), makeAutomaticCallOpenAI(supabase, debateId, networkCalls)));

  // Simule la soumission + complétion du Batch OpenAI : applyBatchResults est
  // la MÊME fonction que le scheduler réel appellerait après téléchargement
  // et parsing du fichier de sortie OpenAI.
  const pending = await batchCache.selectPendingCalls({ supabase, limit: 10 });
  await batchCache.markCallsBatchSubmitted({ supabase, callIds: pending.map((c) => c.id), batchId: "batch-1" });
  await batchCache.applyBatchResults({
    supabase, batchId: "batch-1",
    resultsByCustomId: new Map([[pending[0].custom_id, { ok: true, content: FAKE_P2_RESPONSE, usage: { prompt_tokens: 400, completion_tokens: 90 } }]])
  });

  // 2e cycle (rejeu) : toutes les étapes sont maintenant résolues depuis le
  // cache, generateAnalysisJson aboutit SANS lever d'erreur.
  const result = await generateAnalysisJson(makePayload(), makeAutomaticCallOpenAI(supabase, debateId, networkCalls));

  assert.equal(networkCalls.length, 0, "toujours aucun appel synchrone, même après complétion du Batch");
  assert.equal(result.camps.A.effectiveArguments[0].final_score, 60, "même score que le chemin synchrone (test A) pour la même réponse IA");
  assert.equal(result.camps.A.effectiveArguments[0].category_without_sources, "moyen");

  const usageRows = supabase.rows("ai_usage_log");
  assert.equal(usageRows.length, 1);
  assert.equal(usageRows[0].is_batch, true, "coût tracé avec isBatch:true pour la remise -50%");
  assert.equal(usageRows[0].generation_id, String(debateId));
});

test("D — rapport déjà généré : un rejeu supplémentaire ne crée aucune ligne ni appel supplémentaire", async () => {
  const supabase = makeFakeSupabase();
  const networkCalls = [];
  const debateId = 44;

  await assert.rejects(() => generateAnalysisJson(makePayload(), makeAutomaticCallOpenAI(supabase, debateId, networkCalls)));
  const pending = await batchCache.selectPendingCalls({ supabase, limit: 10 });
  await batchCache.markCallsBatchSubmitted({ supabase, callIds: pending.map((c) => c.id), batchId: "batch-1" });
  await batchCache.applyBatchResults({
    supabase, batchId: "batch-1",
    resultsByCustomId: new Map([[pending[0].custom_id, { ok: true, content: FAKE_P2_RESPONSE, usage: { prompt_tokens: 400, completion_tokens: 90 } }]])
  });

  await generateAnalysisJson(makePayload(), makeAutomaticCallOpenAI(supabase, debateId, networkCalls)); // 1er rejeu réussi
  const rowCountAfterFirst = supabase.rows("debate_analysis_batch_calls").length;

  // 2e rejeu supplémentaire (ex. un second cycle scheduler avant que le
  // statut du débat ne bascule "ready") : aucune nouvelle ligne, aucun appel.
  await generateAnalysisJson(makePayload(), makeAutomaticCallOpenAI(supabase, debateId, networkCalls));

  assert.equal(networkCalls.length, 0);
  assert.equal(supabase.rows("debate_analysis_batch_calls").length, rowCountAfterFirst, "aucune ligne supplémentaire créée par le rejeu");
  assert.equal(rowCountAfterFirst, 1);
});

test("E — Batch en attente puis clic manuel : génération manuelle immédiate, table Batch inchangée", async () => {
  const supabase = makeFakeSupabase();
  const debateId = 45;

  // Un cycle automatique a déjà enregistré un appel en attente pour ce débat.
  await assert.rejects(() => generateAnalysisJson(makePayload(), makeAutomaticCallOpenAI(supabase, debateId, [])));
  const rowsBefore = supabase.rows("debate_analysis_batch_calls").map((r) => ({ ...r }));
  assert.equal(rowsBefore.length, 1);
  assert.equal(rowsBefore[0].status, "pending");

  // Clic admin "Générer le rapport" : chemin manuel, totalement indépendant
  // de la table Batch — jamais lu, jamais écrit.
  const networkCalls = [];
  const result = await generateAnalysisJson(makePayload(), makeManualCallOpenAI(networkCalls));

  assert.equal(networkCalls.length, 1, "le clic manuel produit un résultat immédiat via un vrai appel synchrone");
  assert.equal(result.camps.A.effectiveArguments[0].final_score, 60);

  const rowsAfter = supabase.rows("debate_analysis_batch_calls");
  assert.deepEqual(rowsAfter, rowsBefore, "le Batch en attente n'est ni consommé ni modifié par le clic manuel");
});

test("F — échec Batch : le débat reste dans un état cohérent (failed), aucune boucle de resoumission", async () => {
  const supabase = makeFakeSupabase();
  const networkCalls = [];
  const debateId = 46;

  await assert.rejects(() => generateAnalysisJson(makePayload(), makeAutomaticCallOpenAI(supabase, debateId, networkCalls)));
  const pending = await batchCache.selectPendingCalls({ supabase, limit: 10 });
  await batchCache.markCallsBatchSubmitted({ supabase, callIds: pending.map((c) => c.id), batchId: "batch-dead" });

  // Le Batch OpenAI a expiré côté serveur.
  await batchCache.markBatchFailed({ supabase, batchId: "batch-dead", reason: "batch expired" });

  await assert.rejects(
    () => generateAnalysisJson(makePayload(), makeAutomaticCallOpenAI(supabase, debateId, networkCalls)),
    batchCache.DebateBatchCallFailedError
  );
  assert.equal(networkCalls.length, 0, "jamais de repli automatique vers un appel synchrone payant après un échec Batch");

  const rows = supabase.rows("debate_analysis_batch_calls");
  assert.equal(rows.length, 1, "aucune resoumission créée");
  assert.equal(rows[0].status, "failed");

  // Un nouveau rejeu (ex. cycle scheduler suivant, tant que le débat n'a pas
  // été explicitement réinitialisé) échoue de la même façon, jamais en
  // boucle silencieuse vers un état différent.
  await assert.rejects(
    () => generateAnalysisJson(makePayload(), makeAutomaticCallOpenAI(supabase, debateId, networkCalls)),
    batchCache.DebateBatchCallFailedError
  );
  assert.equal(supabase.rows("debate_analysis_batch_calls").length, 1);
});
