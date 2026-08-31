"use strict";

// Couvre lib/qcm-grounding-metrics.js (V3.1, demande du 31/08/2026 —
// "validation bout-en-bout et observabilité du grounding QCM"). Fonctions
// pures uniquement (aucun réseau) ; recordQcmGroundingMetrics est vérifiée
// avec un faux client Supabase minimal, jamais un vrai réseau.

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractGroundingReasonCounts, buildGroundingMetricsSummary, recordQcmGroundingMetrics } = require("../lib/qcm-grounding-metrics");

test("extractGroundingReasonCounts : ne garde que les codes GROUNDING_*, jamais les autres", () => {
  const filtered = extractGroundingReasonCounts({
    GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED: 2,
    GROUNDING_MISSING_SUPPORTING_CLAIM: 1,
    DOUBLE_NEGATION: 3,
    UNKNOWN_TYPE: 1
  });
  assert.deepEqual(filtered, { GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED: 2, GROUNDING_MISSING_SUPPORTING_CLAIM: 1 });
});

test("extractGroundingReasonCounts : absent/vide renvoie un objet vide, jamais une erreur", () => {
  assert.deepEqual(extractGroundingReasonCounts(null), {});
  assert.deepEqual(extractGroundingReasonCounts(undefined), {});
  assert.deepEqual(extractGroundingReasonCounts({}), {});
});

function fakeMetrics(overrides = {}) {
  return {
    generated: 6,
    finalAccepted: 5,
    groundingEnabled: true,
    groundingCandidatesFirstPass: 6,
    groundingAcceptedFirstPass: 4,
    groundingRejectedFirstPass: 2,
    groundingRegenerationTriggerCount: 2,
    groundingAcceptedAfterRegeneration: 1,
    groundingFailedFinal: 1,
    reasonCounts: { GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED: 1, GROUNDING_MISSING_SUPPORTING_CLAIM: 1, DUPLICATE_OPTIONS: 1 },
    ...overrides
  };
}

test("buildGroundingMetricsSummary : construit une ligne compacte avec toutes les métriques attendues", () => {
  const summary = buildGroundingMetricsSummary(fakeMetrics(), {
    generationId: "abc123",
    route: "free_search",
    level: "elementaire",
    sourceType: "custom",
    questionsRequested: 6
  });
  assert.deepEqual(summary, {
    generation_id: "abc123",
    route: "free_search",
    level: "elementaire",
    source_type: "custom",
    grounding_enabled: true,
    questions_requested: 6,
    questions_generated: 6,
    grounding_candidates_first_pass: 6,
    grounding_accepted_first_pass: 4,
    grounding_rejected_first_pass: 2,
    grounding_regenerated: 2,
    grounding_accepted_after_regeneration: 1,
    grounding_failed_final: 1,
    final_accepted: 5,
    reasons: { GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED: 1, GROUNDING_MISSING_SUPPORTING_CLAIM: 1 },
    // Champs V3.2 (31/08/2026 — "fallback d'enrichissement des sources") :
    // valeurs neutres quand context.expansion n'est pas fourni (comportement
    // additif, cf. lib/grounding-source-expansion.js).
    source_expansion_triggered: false,
    source_expansion_reason: null,
    source_count_initial: null,
    source_count_added: 0,
    source_count_final: null,
    source_expansion_brave_calls: 0,
    questions_before_expansion: null,
    questions_generated_after_expansion: null,
    questions_accepted_after_expansion: null
  });
});

// ── Champs V3.2 (fallback d'enrichissement des sources) ─────────────────

test("buildGroundingMetricsSummary : context.expansion renseigné remplit les colonnes source_expansion_*", () => {
  const summary = buildGroundingMetricsSummary(fakeMetrics(), {
    generationId: "abc123",
    questionsRequested: 6,
    expansion: {
      triggered: true,
      reason: "insufficient_documentary_coverage",
      sourceCountInitial: 3,
      sourceCountAdded: 2,
      sourceCountFinal: 5,
      braveCalls: 1,
      questionsBeforeExpansion: 4,
      questionsGeneratedAfterExpansion: 2,
      questionsAcceptedAfterExpansion: 2
    }
  });
  assert.equal(summary.source_expansion_triggered, true);
  assert.equal(summary.source_expansion_reason, "insufficient_documentary_coverage");
  assert.equal(summary.source_count_initial, 3);
  assert.equal(summary.source_count_added, 2);
  assert.equal(summary.source_count_final, 5);
  assert.equal(summary.source_expansion_brave_calls, 1);
  assert.equal(summary.questions_before_expansion, 4);
  assert.equal(summary.questions_generated_after_expansion, 2);
  assert.equal(summary.questions_accepted_after_expansion, 2);
});

test("buildGroundingMetricsSummary : context.expansion absent -> valeurs neutres, jamais une erreur", () => {
  const summary = buildGroundingMetricsSummary(fakeMetrics(), { generationId: "abc123" });
  assert.equal(summary.source_expansion_triggered, false);
  assert.equal(summary.source_count_added, 0);
  assert.equal(summary.source_expansion_brave_calls, 0);
  assert.equal(summary.source_expansion_reason, null);
});

test("buildGroundingMetricsSummary : expansion tentée mais sans succès (triggered=true, questions_accepted_after_expansion=0) reste fidèlement représenté, jamais masqué en faux succès", () => {
  const summary = buildGroundingMetricsSummary(fakeMetrics(), {
    generationId: "abc123",
    expansion: {
      triggered: true,
      reason: "no_new_source_found",
      sourceCountInitial: 3,
      sourceCountAdded: 0,
      sourceCountFinal: 3,
      braveCalls: 1,
      questionsBeforeExpansion: 4,
      questionsGeneratedAfterExpansion: 0,
      questionsAcceptedAfterExpansion: 0
    }
  });
  assert.equal(summary.source_expansion_triggered, true);
  assert.equal(summary.source_count_added, 0);
  assert.equal(summary.questions_accepted_after_expansion, 0);
});

test("buildGroundingMetricsSummary : jamais de prompt/contenu de source dans la ligne (section 6 — compacité obligatoire)", () => {
  const summary = buildGroundingMetricsSummary(fakeMetrics(), { generationId: "abc123" });
  const serialized = JSON.stringify(summary);
  // Plafond relevé le 31/08/2026 (V3.2, "fallback d'enrichissement des
  // sources") pour couvrir les nouvelles colonnes source_expansion_* —
  // reste un simple garde-fou de compacité (jamais un prompt/contenu de
  // page entier, cf. le commentaire de tête de ce fichier), pas une mesure
  // exacte du nombre de champs.
  assert.ok(serialized.length < 900, `la ligne doit rester compacte, obtenu ${serialized.length} caractères`);
});

test("buildGroundingMetricsSummary : metrics null/absent renvoie null, jamais une erreur", () => {
  assert.equal(buildGroundingMetricsSummary(null, {}), null);
  assert.equal(buildGroundingMetricsSummary(undefined, {}), null);
});

test("buildGroundingMetricsSummary : grounding désactivé (comportement neutre des autres pipelines) reste correctement représenté", () => {
  const summary = buildGroundingMetricsSummary(fakeMetrics({
    groundingEnabled: false,
    groundingCandidatesFirstPass: 0,
    groundingAcceptedFirstPass: 0,
    groundingRejectedFirstPass: 0,
    groundingRegenerationTriggerCount: 0,
    groundingAcceptedAfterRegeneration: 0,
    groundingFailedFinal: 0,
    reasonCounts: {}
  }), { generationId: "xyz" });
  assert.equal(summary.grounding_enabled, false);
  assert.equal(summary.grounding_candidates_first_pass, 0);
  assert.deepEqual(summary.reasons, {});
});

// ── recordQcmGroundingMetrics : best-effort, jamais bloquant ──────────────

test("recordQcmGroundingMetrics : insère la ligne via le client Supabase fourni", async () => {
  let inserted = null;
  const fakeSupabase = { from: (table) => ({ insert: async (row) => { inserted = { table, row }; return { error: null }; } }) };
  await recordQcmGroundingMetrics(fakeSupabase, { generation_id: "abc", grounding_enabled: true });
  assert.equal(inserted.table, "qcm_grounding_metrics");
  assert.equal(inserted.row.generation_id, "abc");
});

test("recordQcmGroundingMetrics : une erreur Supabase est avalée, jamais levée", async () => {
  const fakeSupabase = { from: () => ({ insert: async () => ({ error: { message: "table absente" } }) }) };
  await assert.doesNotReject(recordQcmGroundingMetrics(fakeSupabase, { generation_id: "abc" }));
});

test("recordQcmGroundingMetrics : une exception du client est avalée, jamais levée", async () => {
  const fakeSupabase = { from: () => { throw new Error("réseau indisponible"); } };
  await assert.doesNotReject(recordQcmGroundingMetrics(fakeSupabase, { generation_id: "abc" }));
});

test("recordQcmGroundingMetrics : supabase ou summary absent → no-op silencieux", async () => {
  await assert.doesNotReject(recordQcmGroundingMetrics(null, { generation_id: "abc" }));
  await assert.doesNotReject(recordQcmGroundingMetrics({ from: () => { throw new Error("ne doit jamais être appelé"); } }, null));
});
