"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { estimateCostUsd, extractUsage, recordAiUsage, MODEL_PRICING_USD_PER_MILLION_TOKENS } = require("../lib/ai-usage-log");

// Fake Supabase client couvrant uniquement .from(table).insert(row), sur le
// modèle de createFakeSupabase dans test/data-retention.test.js.
function createFakeSupabase({ insertError = null } = {}) {
  const inserted = [];
  return {
    inserted,
    from(table) {
      return {
        insert(row) {
          inserted.push({ table, row });
          return Promise.resolve({ error: insertError });
        }
      };
    }
  };
}

test("estimateCostUsd — calcule le coût pour chacun des modèles tarifés", () => {
  for (const model of Object.keys(MODEL_PRICING_USD_PER_MILLION_TOKENS)) {
    const pricing = MODEL_PRICING_USD_PER_MILLION_TOKENS[model];
    const cost = estimateCostUsd(model, { inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 1_000_000 });
    assert.equal(cost, Math.round((pricing.input + pricing.output) * 1e8) / 1e8);
  }
});

test("estimateCostUsd — un input entièrement caché est facturé au tarif cache, jamais au tarif plein en plus", () => {
  // 1000 tokens input, tous en cache : ne doit refléter QUE le tarif cache,
  // jamais prompt_tokens facturé en plus de cached_tokens (cf. commentaire
  // du module — pas de double comptage).
  const cost = estimateCostUsd("gpt-4o-mini", { inputTokens: 1000, cachedTokens: 1000, outputTokens: 0 });
  const expected = (1000 / 1e6) * MODEL_PRICING_USD_PER_MILLION_TOKENS["gpt-4o-mini"].cachedInput;
  assert.equal(cost, Math.round(expected * 1e8) / 1e8);
});

test("estimateCostUsd — mélange input non caché + caché + output", () => {
  // 1000 tokens input dont 400 en cache, 500 tokens output.
  const cost = estimateCostUsd("gpt-4.1-mini", { inputTokens: 1000, cachedTokens: 400, outputTokens: 500 });
  const pricing = MODEL_PRICING_USD_PER_MILLION_TOKENS["gpt-4.1-mini"];
  const expected = (600 / 1e6) * pricing.input + (400 / 1e6) * pricing.cachedInput + (500 / 1e6) * pricing.output;
  assert.equal(cost, Math.round(expected * 1e8) / 1e8);
});

test("estimateCostUsd — modèle inconnu retourne null, jamais un chiffre inventé", () => {
  assert.equal(estimateCostUsd("gpt-6-ultra-inexistant", { inputTokens: 100, outputTokens: 100 }), null);
  assert.equal(estimateCostUsd(undefined, { inputTokens: 100, outputTokens: 100 }), null);
  assert.equal(estimateCostUsd(null, { inputTokens: 100, outputTokens: 100 }), null);
});

test("estimateCostUsd — absence de inputTokens/outputTokens retourne null plutôt qu'un calcul sur des valeurs par défaut trompeuses", () => {
  assert.equal(estimateCostUsd("gpt-4o-mini", {}), null);
  assert.equal(estimateCostUsd("gpt-4o-mini", { inputTokens: 100 }), null);
  assert.equal(estimateCostUsd("gpt-4o-mini", { outputTokens: 100 }), null);
});

test("extractUsage — forme standard Chat Completions (gpt-4o-mini / gpt-4.1-mini), sans prompt_tokens_details", () => {
  const usage = { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 };
  assert.deepEqual(extractUsage(usage), { inputTokens: 120, outputTokens: 45, cachedTokens: null });
});

test("extractUsage — forme avec cache actif (prompt_tokens_details.cached_tokens)", () => {
  const usage = {
    prompt_tokens: 5000,
    completion_tokens: 80,
    total_tokens: 5080,
    prompt_tokens_details: { cached_tokens: 4480 }
  };
  assert.deepEqual(extractUsage(usage), { inputTokens: 5000, outputTokens: 80, cachedTokens: 4480 });
});

test("extractUsage — forme gpt-5-nano avec reasoning_tokens (sous-ensemble de completion_tokens, pas extrait séparément)", () => {
  const usage = {
    prompt_tokens: 900,
    completion_tokens: 1200,
    total_tokens: 2100,
    completion_tokens_details: { reasoning_tokens: 1100 },
    prompt_tokens_details: { cached_tokens: 0 }
  };
  const result = extractUsage(usage);
  // outputTokens doit rester completion_tokens tel quel : reasoning_tokens
  // y est déjà inclus (facturé comme de l'output par OpenAI), pas à ajouter
  // une seconde fois.
  assert.equal(result.outputTokens, 1200);
  assert.equal(result.inputTokens, 900);
  assert.equal(result.cachedTokens, 0);
});

test("extractUsage — usage absent ou malformé ne fabrique rien (null partout)", () => {
  assert.deepEqual(extractUsage(undefined), { inputTokens: null, outputTokens: null, cachedTokens: null });
  assert.deepEqual(extractUsage(null), { inputTokens: null, outputTokens: null, cachedTokens: null });
  assert.deepEqual(extractUsage({}), { inputTokens: null, outputTokens: null, cachedTokens: null });
  assert.deepEqual(extractUsage("not an object"), { inputTokens: null, outputTokens: null, cachedTokens: null });
});

test("recordAiUsage — insertion réussie, coût calculé et stocké", async () => {
  const supabase = createFakeSupabase();
  await recordAiUsage(supabase, {
    feature: "debate_p2",
    model: "gpt-4o-mini",
    inputTokens: 1000,
    outputTokens: 200,
    cachedTokens: 0,
    latencyMs: 850,
    success: true
  });
  assert.equal(supabase.inserted.length, 1);
  const row = supabase.inserted[0];
  assert.equal(row.table, "ai_usage_log");
  assert.equal(row.row.feature, "debate_p2");
  assert.equal(row.row.model, "gpt-4o-mini");
  assert.equal(row.row.input_tokens, 1000);
  assert.equal(row.row.output_tokens, 200);
  assert.equal(row.row.success, true);
  assert.ok(typeof row.row.estimated_cost_usd === "number" && row.row.estimated_cost_usd > 0);
});

test("recordAiUsage — modèle inconnu : tokens conservés, coût explicitement null (jamais inventé)", async () => {
  const supabase = createFakeSupabase();
  await recordAiUsage(supabase, {
    feature: "debate_p2",
    model: "un-modele-jamais-vu",
    inputTokens: 500,
    outputTokens: 100,
    success: true
  });
  const row = supabase.inserted[0].row;
  assert.equal(row.input_tokens, 500);
  assert.equal(row.output_tokens, 100);
  assert.equal(row.estimated_cost_usd, null);
});

test("recordAiUsage — échec IA : success=false et error tronquée, tokens à null si inconnus", async () => {
  const supabase = createFakeSupabase();
  await recordAiUsage(supabase, {
    feature: "veille_deduplication",
    model: "gpt-4o-mini",
    latencyMs: 120,
    success: false,
    error: "openai http 429"
  });
  const row = supabase.inserted[0].row;
  assert.equal(row.success, false);
  assert.equal(row.error, "openai http 429");
  assert.equal(row.input_tokens, null);
  assert.equal(row.estimated_cost_usd, null);
});

test("recordAiUsage — erreur Supabase à l'insertion : avalée, aucune exception", async () => {
  const supabase = createFakeSupabase({ insertError: { message: "relation \"ai_usage_log\" does not exist" } });
  await assert.doesNotReject(() => recordAiUsage(supabase, {
    feature: "debate_p1",
    model: "gpt-4o-mini",
    inputTokens: 10,
    outputTokens: 10,
    success: true
  }));
});

test("recordAiUsage — supabase absent (null/undefined) : no-op silencieux, aucune exception", async () => {
  await assert.doesNotReject(() => recordAiUsage(null, { feature: "debate_p1", model: "gpt-4o-mini", success: true }));
  await assert.doesNotReject(() => recordAiUsage(undefined, { feature: "debate_p1", model: "gpt-4o-mini", success: true }));
});

test("recordAiUsage — feature manquante : no-op silencieux, aucune exception, aucun insert", async () => {
  const supabase = createFakeSupabase();
  await recordAiUsage(supabase, { model: "gpt-4o-mini", success: true });
  assert.equal(supabase.inserted.length, 0);
});

test("recordAiUsage — un client Supabase qui jette une exception synchrone ne remonte jamais au code métier", async () => {
  const throwingSupabase = {
    from() {
      throw new Error("boom — panne réseau simulée");
    }
  };
  await assert.doesNotReject(() => recordAiUsage(throwingSupabase, {
    feature: "debate_p2",
    model: "gpt-4o-mini",
    inputTokens: 10,
    outputTokens: 10,
    success: true
  }));
});

// ── Instrumentation coût/génération QCM gpt-5.6-luna (01/09/2026) ─────────

test("A — estimateCostUsd calcule correctement le coût d'un appel gpt-5.6-luna, au tarif officiel du palier standard (developers.openai.com/api/docs/pricing, vérifié le 01/09/2026 : 0.20 $ input / 0.02 $ cached input / 1.20 $ output par million de tokens)", () => {
  assert.deepEqual(MODEL_PRICING_USD_PER_MILLION_TOKENS["gpt-5.6-luna"], { input: 0.20, cachedInput: 0.02, output: 1.20 });
  // 100 000 tokens input (dont 20 000 en cache) + 5 000 tokens output.
  const cost = estimateCostUsd("gpt-5.6-luna", { inputTokens: 100_000, cachedTokens: 20_000, outputTokens: 5_000 });
  const expected = (80_000 / 1e6) * 0.20 + (20_000 / 1e6) * 0.02 + (5_000 / 1e6) * 1.20;
  assert.equal(cost, Math.round(expected * 1e8) / 1e8);
});

test("F — l'ajout du tarif gpt-5.6-luna ne modifie la tarification d'AUCUN modèle existant", () => {
  assert.deepEqual(MODEL_PRICING_USD_PER_MILLION_TOKENS["gpt-4o"], { input: 2.50, cachedInput: 1.25, output: 10.00 });
  assert.deepEqual(MODEL_PRICING_USD_PER_MILLION_TOKENS["gpt-4o-mini"], { input: 0.15, cachedInput: 0.075, output: 0.60 });
  assert.deepEqual(MODEL_PRICING_USD_PER_MILLION_TOKENS["gpt-4.1-mini"], { input: 0.40, cachedInput: 0.10, output: 1.60 });
  assert.deepEqual(MODEL_PRICING_USD_PER_MILLION_TOKENS["gpt-5-nano"], { input: 0.05, cachedInput: 0.005, output: 0.40 });
});

test("B/D/E — recordAiUsage stocke generation_id tel quel (même identifiant que ce soit un appel de génération, de critique ou de régénération ciblée)", async () => {
  const supabase = createFakeSupabase();
  for (const feature of ["knowledge_generation", "question_generation", "question_semantic_review", "question_targeted_regeneration", "question_generation_source_expansion"]) {
    await recordAiUsage(supabase, { feature, model: "gpt-5.6-luna", generationId: "gen-abc123", inputTokens: 10, outputTokens: 10, success: true });
  }
  assert.equal(supabase.inserted.length, 5);
  for (const { row } of supabase.inserted) assert.equal(row.generation_id, "gen-abc123");
});

test("C — deux générations distinctes produisent deux generation_id distincts, agrégables indépendamment", async () => {
  const supabase = createFakeSupabase();
  await recordAiUsage(supabase, { feature: "knowledge_generation", model: "gpt-5.6-luna", generationId: "gen-un", inputTokens: 10, outputTokens: 10, success: true });
  await recordAiUsage(supabase, { feature: "knowledge_generation", model: "gpt-5.6-luna", generationId: "gen-deux", inputTokens: 10, outputTokens: 10, success: true });
  const ids = supabase.inserted.map((entry) => entry.row.generation_id);
  assert.deepEqual(ids, ["gen-un", "gen-deux"]);
});

test("generation_id absent (appelant hors pipeline QCM) reste null — comportement rétrocompatible inchangé", async () => {
  const supabase = createFakeSupabase();
  await recordAiUsage(supabase, { feature: "veille_deduplication", model: "gpt-4o-mini", inputTokens: 10, outputTokens: 10, success: true });
  assert.equal(supabase.inserted[0].row.generation_id, null);
});

test("G — tokens absents/partiels avec generation_id présent : coût null (jamais inventé), generation_id quand même stocké", async () => {
  const supabase = createFakeSupabase();
  await recordAiUsage(supabase, { feature: "knowledge_generation", model: "gpt-5.6-luna", generationId: "gen-partiel", success: false, error: "timeout" });
  const row = supabase.inserted[0].row;
  assert.equal(row.generation_id, "gen-partiel");
  assert.equal(row.estimated_cost_usd, null);
  assert.equal(row.input_tokens, null);
});
