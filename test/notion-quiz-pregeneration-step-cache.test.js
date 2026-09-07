"use strict";

// Tests purs du cache d'étapes (lib/notion-quiz-pregeneration-step-cache.js)
// — AUCUN réseau, AUCUN Supabase réel : fausse implémentation minimale en
// mémoire, suffisante pour les méthodes réellement utilisées par ce module
// (.select/.eq/.not/.in/.order/.limit/.maybeSingle/.upsert/.update, et
// l'attente directe du builder comme un thenable, à l'identique du vrai
// client supabase-js).

const test = require("node:test");
const assert = require("node:assert/strict");
const stepCache = require("../lib/notion-quiz-pregeneration-step-cache");

function makeFakeSupabase(initialRows = []) {
  let rows = initialRows.map((r) => ({ ...r }));
  let nextId = rows.reduce((max, r) => Math.max(max, r.id || 0), 0) + 1;

  function applyFilters(list, filters) {
    return list.filter((row) => filters.every((f) => {
      if (f.type === "eq") return row[f.col] === f.val;
      if (f.type === "not-is-null") return row[f.col] != null;
      if (f.type === "in") return f.vals.includes(row[f.col]);
      return true;
    }));
  }

  function makeBuilder() {
    const filters = [];
    let orderSpec = null;
    let limitN = null;
    let pendingOp = null;

    async function execute() {
      if (pendingOp?.type === "upsert") {
        const { payload, options } = pendingOp;
        const conflictCols = (options?.onConflict || "").split(",");
        const existingIdx = rows.findIndex((r) => conflictCols.every((c) => r[c] === payload[c]));
        if (existingIdx >= 0) {
          if (!options?.ignoreDuplicates) rows[existingIdx] = { ...rows[existingIdx], ...payload };
          return { data: null, error: null };
        }
        rows.push({ id: nextId++, status: "pending", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...payload });
        return { data: null, error: null };
      }
      if (pendingOp?.type === "update") {
        const matched = applyFilters(rows, filters);
        for (const row of matched) Object.assign(row, pendingOp.payload);
        return { data: null, error: null };
      }
      let result = applyFilters(rows, filters);
      if (orderSpec) {
        result = [...result].sort((a, b) => {
          if (a[orderSpec.col] < b[orderSpec.col]) return orderSpec.ascending ? -1 : 1;
          if (a[orderSpec.col] > b[orderSpec.col]) return orderSpec.ascending ? 1 : -1;
          return 0;
        });
      }
      if (limitN != null) result = result.slice(0, limitN);
      return { data: result.map((r) => ({ ...r })), error: null };
    }

    const builder = {
      select() { return builder; },
      eq(col, val) { filters.push({ type: "eq", col, val }); return builder; },
      not(col, op, val) { if (op === "is" && val === null) filters.push({ type: "not-is-null", col }); return builder; },
      in(col, vals) { filters.push({ type: "in", col, vals }); return builder; },
      order(col, opts) { orderSpec = { col, ascending: opts?.ascending !== false }; return builder; },
      limit(n) { limitN = n; return builder; },
      upsert(payload, options) { pendingOp = { type: "upsert", payload, options }; return builder; },
      update(payload) { pendingOp = { type: "update", payload }; return builder; },
      async maybeSingle() {
        const { data, error } = await execute();
        return { data: (data && data[0]) || null, error };
      },
      then(resolve, reject) { execute().then(resolve, reject); }
    };
    return builder;
  }

  return { from: () => makeBuilder(), _rows: () => rows };
}

test("resolveStep : première rencontre d'un appel -> enregistre une ligne pending et lève PregenerationPendingError", async () => {
  const supabase = makeFakeSupabase();
  await assert.rejects(
    () => stepCache.resolveStep({ supabase, queueId: 1, callKey: "curriculum_generation", occurrence: 1, requestPayload: { model: "m", messages: [] } }),
    stepCache.PregenerationPendingError
  );
  const rows = supabase._rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].custom_id, "1:curriculum_generation:1");
  assert.equal(rows[0].status, "pending");
});

test("resolveStep : appel déjà completed -> retourne le contenu, ne relève jamais, aucune nouvelle ligne", async () => {
  const supabase = makeFakeSupabase([
    { id: 1, queue_id: 1, call_key: "curriculum_generation", occurrence: 1, custom_id: "1:curriculum_generation:1", status: "completed", result_content: "le contenu" }
  ]);
  const result = await stepCache.resolveStep({ supabase, queueId: 1, callKey: "curriculum_generation", occurrence: 1, requestPayload: { model: "m", messages: [] } });
  assert.equal(result.content, "le contenu");
  assert.equal(supabase._rows().length, 1);
});

test("resolveStep : appel batch_submitted -> PregenerationPendingError (encore en cours, jamais une resoumission)", async () => {
  const supabase = makeFakeSupabase([
    { id: 1, queue_id: 1, call_key: "elementary_fiche_generation", occurrence: 1, custom_id: "1:elementary_fiche_generation:1", status: "batch_submitted", batch_id: "batch-1" }
  ]);
  await assert.rejects(
    () => stepCache.resolveStep({ supabase, queueId: 1, callKey: "elementary_fiche_generation", occurrence: 1, requestPayload: { model: "m", messages: [] } }),
    stepCache.PregenerationPendingError
  );
});

test("resolveStep : appel failed -> PregenerationCallFailedError, distincte de PregenerationPendingError", async () => {
  const supabase = makeFakeSupabase([
    { id: 1, queue_id: 1, call_key: "expert_question_generation", occurrence: 1, custom_id: "1:expert_question_generation:1", status: "failed", error_reason: "Batch expired" }
  ]);
  await assert.rejects(
    () => stepCache.resolveStep({ supabase, queueId: 1, callKey: "expert_question_generation", occurrence: 1, requestPayload: { model: "m", messages: [] } }),
    stepCache.PregenerationCallFailedError
  );
});

test("resolveStep : custom_id déterministe = queueId:callKey:occurrence, permet de retrouver l'appel dans les deux sens", () => {
  assert.equal(stepCache.buildCustomId(42, "curriculum_repair", 2), "42:curriculum_repair:2");
});

test("selectPendingCalls : ne retourne que les appels pending, plafonné à limit, triés du plus ancien au plus récent", async () => {
  const supabase = makeFakeSupabase([
    { id: 1, queue_id: 1, call_key: "a", occurrence: 1, custom_id: "1:a:1", status: "pending", request_payload: {}, created_at: "2026-09-07T00:00:00Z" },
    { id: 2, queue_id: 2, call_key: "b", occurrence: 1, custom_id: "2:b:1", status: "completed", request_payload: {}, created_at: "2026-09-07T00:00:01Z" },
    { id: 3, queue_id: 3, call_key: "c", occurrence: 1, custom_id: "3:c:1", status: "pending", request_payload: {}, created_at: "2026-09-07T00:00:02Z" }
  ]);
  const pending = await stepCache.selectPendingCalls({ supabase, limit: 10 });
  assert.deepEqual(pending.map((r) => r.id), [1, 3]);

  const limited = await stepCache.selectPendingCalls({ supabase, limit: 1 });
  assert.deepEqual(limited.map((r) => r.id), [1]);
});

test("markCallsBatchSubmitted : passe les appels donnés en batch_submitted avec le bon batch_id", async () => {
  const supabase = makeFakeSupabase([
    { id: 1, status: "pending" },
    { id: 2, status: "pending" },
    { id: 3, status: "pending" }
  ]);
  await stepCache.markCallsBatchSubmitted({ supabase, callIds: [1, 2], batchId: "batch-xyz" });
  const rows = supabase._rows();
  assert.equal(rows.find((r) => r.id === 1).status, "batch_submitted");
  assert.equal(rows.find((r) => r.id === 1).batch_id, "batch-xyz");
  assert.equal(rows.find((r) => r.id === 2).status, "batch_submitted");
  assert.equal(rows.find((r) => r.id === 3).status, "pending", "un appel non inclus dans callIds ne doit jamais être touché");
});

test("selectActiveBatchIds : batch_id distincts parmi les appels encore batch_submitted", async () => {
  const supabase = makeFakeSupabase([
    { id: 1, status: "batch_submitted", batch_id: "batch-1" },
    { id: 2, status: "batch_submitted", batch_id: "batch-1" },
    { id: 3, status: "batch_submitted", batch_id: "batch-2" },
    { id: 4, status: "completed", batch_id: "batch-0" }
  ]);
  const ids = await stepCache.selectActiveBatchIds({ supabase });
  assert.deepEqual([...ids].sort(), ["batch-1", "batch-2"]);
});

test("applyBatchResults : met à jour chaque appel par son PROPRE custom_id, jamais en masse — une ligne manquante dans les résultats reste batch_submitted", async () => {
  const supabase = makeFakeSupabase([
    { id: 1, custom_id: "1:a:1", status: "batch_submitted", batch_id: "batch-1" },
    { id: 2, custom_id: "1:b:1", status: "batch_submitted", batch_id: "batch-1" },
    { id: 3, custom_id: "1:c:1", status: "batch_submitted", batch_id: "batch-1" }
  ]);
  const resultsByCustomId = new Map([
    ["1:a:1", { ok: true, content: "contenu A" }],
    ["1:b:1", { ok: false, error: "invalide" }]
    // "1:c:1" absent du résultat : ligne manquante dans l'output Batch
  ]);
  await stepCache.applyBatchResults({ supabase, batchId: "batch-1", resultsByCustomId });
  const rows = supabase._rows();
  assert.equal(rows.find((r) => r.id === 1).status, "completed");
  assert.equal(rows.find((r) => r.id === 1).result_content, "contenu A");
  assert.equal(rows.find((r) => r.id === 2).status, "failed");
  assert.equal(rows.find((r) => r.id === 2).error_reason, "invalide");
  assert.equal(rows.find((r) => r.id === 3).status, "batch_submitted", "ligne absente de l'output -> laissée en attente, jamais marquée à tort");
});

test("markBatchFailed : marque TOUS les appels batch_submitted d'un batch (Batch entier failed/expired), jamais un autre batch_id", async () => {
  const supabase = makeFakeSupabase([
    { id: 1, status: "batch_submitted", batch_id: "batch-1" },
    { id: 2, status: "batch_submitted", batch_id: "batch-1" },
    { id: 3, status: "batch_submitted", batch_id: "batch-2" }
  ]);
  await stepCache.markBatchFailed({ supabase, batchId: "batch-1", reason: "expired" });
  const rows = supabase._rows();
  assert.equal(rows.find((r) => r.id === 1).status, "failed");
  assert.equal(rows.find((r) => r.id === 1).error_reason, "expired");
  assert.equal(rows.find((r) => r.id === 2).status, "failed");
  assert.equal(rows.find((r) => r.id === 3).status, "batch_submitted", "un autre batch_id ne doit jamais être affecté");
});

test("resetFailedCallsForRetry : réinitialise à pending uniquement les appels failed de CE sujet", async () => {
  const supabase = makeFakeSupabase([
    { id: 1, queue_id: 1, status: "failed", error_reason: "x", batch_id: "batch-1" },
    { id: 2, queue_id: 1, status: "completed" },
    { id: 3, queue_id: 2, status: "failed", error_reason: "y", batch_id: "batch-2" }
  ]);
  await stepCache.resetFailedCallsForRetry({ supabase, queueId: 1 });
  const rows = supabase._rows();
  assert.equal(rows.find((r) => r.id === 1).status, "pending");
  assert.equal(rows.find((r) => r.id === 1).error_reason, null);
  assert.equal(rows.find((r) => r.id === 1).batch_id, null);
  assert.equal(rows.find((r) => r.id === 2).status, "completed", "un appel déjà completed ne doit jamais être touché");
  assert.equal(rows.find((r) => r.id === 3).status, "failed", "un autre sujet (queue_id différent) ne doit jamais être affecté");
});
