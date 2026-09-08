"use strict";

// Tests de lib/debate-analysis-batch-cache.js — AUCUN réseau, AUCUN appel
// OpenAI réel : fake Supabase en mémoire (test/helpers/fake-supabase.js,
// déjà utilisé par les tests notion-quiz-pregeneration-*). Couvre le chantier
// "Batch OpenAI pour les rapports IA de débat déclenchés automatiquement par
// le compte à rebours" (08/09/2026).

const test = require("node:test");
const assert = require("node:assert/strict");
const { makeFakeSupabase } = require("./helpers/fake-supabase");
const batchCache = require("../lib/debate-analysis-batch-cache");

function samplePayload(extra = {}) {
  return { model: "gpt-4o-mini", messages: [{ role: "user", content: "hello" }], temperature: 0, ...extra };
}

test("resolveStep : première rencontre d'un appel — enregistre pending et lève DebateBatchPendingError, jamais de résultat", async () => {
  const supabase = makeFakeSupabase();
  await assert.rejects(
    () => batchCache.resolveStep({ supabase, debateId: 42, stepKey: "p2_7_a", feature: "debate_p2", requestPayload: samplePayload() }),
    batchCache.DebateBatchPendingError
  );
  const rows = supabase.rows("debate_analysis_batch_calls");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].debate_id, 42);
  assert.equal(rows[0].step_key, "p2_7_a");
  assert.equal(rows[0].custom_id, "d:42:p2_7_a");
});

test("resolveStep : un second appel pour le MÊME (debateId, stepKey) ne crée pas une seconde ligne (idempotence)", async () => {
  const supabase = makeFakeSupabase();
  await assert.rejects(() => batchCache.resolveStep({ supabase, debateId: 42, stepKey: "p2_7_a", feature: "debate_p2", requestPayload: samplePayload() }));
  await assert.rejects(() => batchCache.resolveStep({ supabase, debateId: 42, stepKey: "p2_7_a", feature: "debate_p2", requestPayload: samplePayload() }));
  assert.equal(supabase.rows("debate_analysis_batch_calls").length, 1, "une seule ligne, jamais de doublon");
});

test("resolveStep : statut completed — retourne le contenu en cache, sans nouvel appel réseau ni nouvelle ligne", async () => {
  const supabase = makeFakeSupabase({
    debate_analysis_batch_calls: [
      { id: 1, debate_id: 42, step_key: "p1_a", feature: "debate_p1", custom_id: "d:42:p1_a", status: "completed", result_content: '{"groups":[]}', request_payload: samplePayload() }
    ]
  });
  const result = await batchCache.resolveStep({ supabase, debateId: 42, stepKey: "p1_a", feature: "debate_p1", requestPayload: samplePayload() });
  assert.equal(result.content, '{"groups":[]}');
  assert.equal(supabase.rows("debate_analysis_batch_calls").length, 1);
});

test("resolveStep : statut batch_submitted — toujours en attente (jamais resoumis)", async () => {
  const supabase = makeFakeSupabase({
    debate_analysis_batch_calls: [
      { id: 1, debate_id: 42, step_key: "p4", feature: "debate_p4", custom_id: "d:42:p4", status: "batch_submitted", batch_id: "batch-1", request_payload: samplePayload() }
    ]
  });
  await assert.rejects(
    () => batchCache.resolveStep({ supabase, debateId: 42, stepKey: "p4", feature: "debate_p4", requestPayload: samplePayload() }),
    batchCache.DebateBatchPendingError
  );
});

test("resolveStep : statut failed — lève DebateBatchCallFailedError, jamais une simple attente", async () => {
  const supabase = makeFakeSupabase({
    debate_analysis_batch_calls: [
      { id: 1, debate_id: 42, step_key: "p3_7", feature: "debate_p3", custom_id: "d:42:p3_7", status: "failed", error_reason: "batch expired", request_payload: samplePayload() }
    ]
  });
  await assert.rejects(
    () => batchCache.resolveStep({ supabase, debateId: 42, stepKey: "p3_7", feature: "debate_p3", requestPayload: samplePayload() }),
    (err) => {
      assert.ok(err instanceof batchCache.DebateBatchCallFailedError);
      assert.match(err.message, /batch expired/);
      return true;
    }
  );
});

test("clearCallsForDebate : supprime uniquement les lignes du débat visé, jamais celles d'un autre débat", async () => {
  const supabase = makeFakeSupabase({
    debate_analysis_batch_calls: [
      { id: 1, debate_id: 42, step_key: "p1_a", custom_id: "d:42:p1_a", status: "completed", request_payload: samplePayload() },
      { id: 2, debate_id: 99, step_key: "p1_a", custom_id: "d:99:p1_a", status: "completed", request_payload: samplePayload() }
    ]
  });
  await batchCache.clearCallsForDebate({ supabase, debateId: 42 });
  const remaining = supabase.rows("debate_analysis_batch_calls");
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].debate_id, 99);
});

test("clearCallsForDebate suivi d'un nouveau resolveStep : un ancien résultat completed ne peut plus être réutilisé (non-staleness inter-cycles)", async () => {
  const supabase = makeFakeSupabase({
    debate_analysis_batch_calls: [
      { id: 1, debate_id: 42, step_key: "p2_7_a", feature: "debate_p2", custom_id: "d:42:p2_7_a", status: "completed", result_content: "ancien contenu périmé", request_payload: samplePayload() }
    ]
  });
  await batchCache.clearCallsForDebate({ supabase, debateId: 42 });
  // Un nouveau cycle automatique redémarre à zéro : plus aucune trace de
  // l'ancien résultat, un nouvel appel doit être réenregistré comme pending.
  await assert.rejects(
    () => batchCache.resolveStep({ supabase, debateId: 42, stepKey: "p2_7_a", feature: "debate_p2", requestPayload: samplePayload() }),
    batchCache.DebateBatchPendingError
  );
  const rows = supabase.rows("debate_analysis_batch_calls");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "pending");
  assert.notEqual(rows[0].result_content, "ancien contenu périmé");
});

test("selectPendingCalls / markCallsBatchSubmitted : sélectionne uniquement pending, plafonné à limit, puis les fait basculer batch_submitted", async () => {
  const supabase = makeFakeSupabase({
    debate_analysis_batch_calls: [
      { id: 1, debate_id: 1, step_key: "p1_a", custom_id: "d:1:p1_a", status: "pending", request_payload: samplePayload(), created_at: "2026-01-01T00:00:00.000Z" },
      { id: 2, debate_id: 2, step_key: "p1_a", custom_id: "d:2:p1_a", status: "pending", request_payload: samplePayload(), created_at: "2026-01-02T00:00:00.000Z" },
      { id: 3, debate_id: 3, step_key: "p1_a", custom_id: "d:3:p1_a", status: "completed", request_payload: samplePayload(), created_at: "2026-01-03T00:00:00.000Z" }
    ]
  });
  const pending = await batchCache.selectPendingCalls({ supabase, limit: 10 });
  assert.deepEqual(pending.map((c) => c.id).sort(), [1, 2]);

  await batchCache.markCallsBatchSubmitted({ supabase, callIds: [1, 2], batchId: "batch-xyz" });
  const rows = supabase.rows("debate_analysis_batch_calls");
  assert.ok(rows.filter((r) => r.id === 1 || r.id === 2).every((r) => r.status === "batch_submitted" && r.batch_id === "batch-xyz"));
});

test("selectActiveBatchIds : batch_id distincts, uniquement batch_submitted", async () => {
  const supabase = makeFakeSupabase({
    debate_analysis_batch_calls: [
      { id: 1, debate_id: 1, step_key: "a", custom_id: "d:1:a", status: "batch_submitted", batch_id: "b1", request_payload: samplePayload() },
      { id: 2, debate_id: 2, step_key: "a", custom_id: "d:2:a", status: "batch_submitted", batch_id: "b1", request_payload: samplePayload() },
      { id: 3, debate_id: 3, step_key: "a", custom_id: "d:3:a", status: "completed", batch_id: "b2", request_payload: samplePayload() }
    ]
  });
  const ids = await batchCache.selectActiveBatchIds({ supabase });
  assert.deepEqual(ids, ["b1"]);
});

test("applyBatchResults : marque completed avec le contenu retourné, enregistre ai_usage_log avec isBatch:true", async () => {
  const supabase = makeFakeSupabase({
    debate_analysis_batch_calls: [
      { id: 1, debate_id: 42, step_key: "p2_7_a", feature: "debate_p2", custom_id: "d:42:p2_7_a", status: "batch_submitted", batch_id: "batch-xyz", request_payload: samplePayload({ model: "gpt-4o-mini" }) }
    ]
  });
  const resultsByCustomId = new Map([
    ["d:42:p2_7_a", { ok: true, content: '{"scores_without_sources":{"total_without_sources":60}}', usage: { prompt_tokens: 500, completion_tokens: 120 } }]
  ]);
  await batchCache.applyBatchResults({ supabase, batchId: "batch-xyz", resultsByCustomId });

  const row = supabase.rows("debate_analysis_batch_calls")[0];
  assert.equal(row.status, "completed");
  assert.equal(row.result_content, '{"scores_without_sources":{"total_without_sources":60}}');

  const usageRows = supabase.rows("ai_usage_log");
  assert.equal(usageRows.length, 1);
  assert.equal(usageRows[0].feature, "debate_p2");
  assert.equal(usageRows[0].is_batch, true);
  assert.equal(usageRows[0].batch_id, "batch-xyz");
  assert.equal(usageRows[0].generation_id, "42");
  assert.equal(usageRows[0].success, true);
});

test("applyBatchResults : une ligne d'erreur individuelle marque failed, jamais completed", async () => {
  const supabase = makeFakeSupabase({
    debate_analysis_batch_calls: [
      { id: 1, debate_id: 42, step_key: "p3_7", feature: "debate_p3", custom_id: "d:42:p3_7", status: "batch_submitted", batch_id: "batch-xyz", request_payload: samplePayload() }
    ]
  });
  const resultsByCustomId = new Map([["d:42:p3_7", { ok: false, error: "content_filter" }]]);
  await batchCache.applyBatchResults({ supabase, batchId: "batch-xyz", resultsByCustomId });
  const row = supabase.rows("debate_analysis_batch_calls")[0];
  assert.equal(row.status, "failed");
  assert.equal(row.error_reason, "content_filter");
});

test("applyBatchResults : une ligne absente de l'output reste batch_submitted (retentée au cycle suivant, jamais perdue)", async () => {
  const supabase = makeFakeSupabase({
    debate_analysis_batch_calls: [
      { id: 1, debate_id: 42, step_key: "p3_7", feature: "debate_p3", custom_id: "d:42:p3_7", status: "batch_submitted", batch_id: "batch-xyz", request_payload: samplePayload() }
    ]
  });
  await batchCache.applyBatchResults({ supabase, batchId: "batch-xyz", resultsByCustomId: new Map() });
  assert.equal(supabase.rows("debate_analysis_batch_calls")[0].status, "batch_submitted");
});

test("markBatchFailed : bascule uniquement les appels batch_submitted de CE batch_id vers failed", async () => {
  const supabase = makeFakeSupabase({
    debate_analysis_batch_calls: [
      { id: 1, debate_id: 42, step_key: "p1_a", custom_id: "d:42:p1_a", status: "batch_submitted", batch_id: "batch-dead", request_payload: samplePayload() },
      { id: 2, debate_id: 99, step_key: "p1_a", custom_id: "d:99:p1_a", status: "batch_submitted", batch_id: "batch-alive", request_payload: samplePayload() }
    ]
  });
  await batchCache.markBatchFailed({ supabase, batchId: "batch-dead", reason: "batch expired" });
  const rows = supabase.rows("debate_analysis_batch_calls");
  assert.equal(rows.find((r) => r.id === 1).status, "failed");
  assert.equal(rows.find((r) => r.id === 1).error_reason, "batch expired");
  assert.equal(rows.find((r) => r.id === 2).status, "batch_submitted", "un autre batch_id ne doit jamais être affecté");
});

test("buildCustomId : format stable et court (compatible avec la limite de longueur custom_id d'OpenAI)", () => {
  const id = batchCache.buildCustomId(42, "p2_98765_a");
  assert.equal(id, "d:42:p2_98765_a");
  assert.ok(id.length <= 64);
});
