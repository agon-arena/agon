#!/usr/bin/env node
"use strict";

require("dotenv").config();
const {
  buildSemanticReviewPrompt,
  runQuestionQualityPipeline,
  validateQuestionBatchQuality
} = require("../lib/qcm-quality");
const { validateQuestionItemCore } = require("../lib/question-formats");
const { MODEL_PRICING_USD_PER_MILLION_TOKENS } = require("../lib/ai-usage-log");

const MODEL = process.env.OPENAI_DAILY_QUIZ_MODEL || "gpt-4.1-mini";
const CRITIC_MODEL = process.env.OPENAI_DAILY_QUIZ_CRITIC_MODEL || MODEL;
const FACTS = [
  "La capitale de l’Australie est Canberra.",
  "La Révolution française commence en 1789.",
  "L’eau pure gèle à 0 °C à pression atmosphérique normale.",
  "La Première Guerre mondiale se termine en 1918.",
  "Un triangle possède trois côtés."
];
const usage = { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0, byFeature: {} };
const criticVerdicts = [];

async function callOpenAI(feature, model, prompt) {
  const started = Date.now();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: feature === "critic" ? 0.1 : 0.35, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] })
  });
  const payload = await response.json();
  const elapsed = Date.now() - started;
  if (!response.ok) throw Object.assign(new Error(`OpenAI HTTP ${response.status}`), { code: `OPENAI_HTTP_${response.status}` });
  const u = payload.usage || {};
  usage.calls += 1;
  usage.promptTokens += Number(u.prompt_tokens || 0);
  usage.completionTokens += Number(u.completion_tokens || 0);
  usage.totalTokens += Number(u.total_tokens || 0);
  usage.latencyMs += elapsed;
  usage.byFeature[feature] ||= { calls: 0, promptTokens: 0, completionTokens: 0, latencyMs: 0 };
  usage.byFeature[feature].calls += 1;
  usage.byFeature[feature].promptTokens += Number(u.prompt_tokens || 0);
  usage.byFeature[feature].completionTokens += Number(u.completion_tokens || 0);
  usage.byFeature[feature].latencyMs += elapsed;
  return JSON.parse(payload.choices?.[0]?.message?.content || "{}");
}

function generationPrompt(extra = "") {
  return `Crée exactement cinq QCM pédagogiques en français, un par fait. Chaque objet doit contenir sourceId, knowledgeTarget recopié exactement, type=\"qcm\", question autonome, quatre options, correctIndex et explanation. Une seule option doit être vraie. JSON strict {\"questions\":[...]}.\nFaits:\n${FACTS.map((fact, index) => `${index + 1}. sourceId=f${index + 1}; ${fact}`).join("\n")}\n${extra}`;
}

function criticPayload(entries, context) {
  return callOpenAI("critic", CRITIC_MODEL, buildSemanticReviewPrompt(entries, context)).then((payload) => {
    criticVerdicts.push(...(Array.isArray(payload.reviews) ? payload.reviews : []));
    return payload;
  });
}

function publicQuestion(question) {
  return {
    sourceId: question.sourceId,
    knowledgeTarget: question.knowledgeTarget,
    type: question.type,
    question: question.question,
    options: question.options,
    correctIndex: question.correctIndex,
    correctIndexes: question.correctIndexes,
    explanation: question.explanation
  };
}

function fixtureSet() {
  const base = (overrides = {}) => ({
    type: "qcm",
    question: "Quelle est la capitale de l’Australie ?",
    options: ["Sydney", "Melbourne", "Canberra", "Brisbane"],
    correctIndex: 2,
    explanation: "Canberra est la capitale de l’Australie.",
    knowledgeTarget: "La capitale de l’Australie est Canberra.",
    sourceId: "fixture",
    ...overrides
  });
  return [
    base({ sourceId: "bad-duplicate", options: ["Canberra", "Canberra", "Sydney", "Melbourne"], correctIndex: 0 }),
    base({ sourceId: "bad-two-correct", question: "Quelle option désigne la capitale australienne ?", options: ["Canberra", "La ville de Canberra", "Sydney", "Melbourne"], correctIndex: 0 }),
    base({ sourceId: "bad-index", question: "Quelle ville accueille les institutions fédérales australiennes ?", correctIndex: 0 }),
    base({ sourceId: "bad-explanation", question: "Quelle ville est officiellement la capitale australienne ?", explanation: "Sydney est la capitale officielle de l’Australie." }),
    base({ sourceId: "bad-ambiguous", question: "Quelle proposition est correcte ?" }),
    base({ sourceId: "bad-target", question: "Quelle est la capitale de la France ?", options: ["Paris", "Lyon", "Marseille", "Bordeaux"], correctIndex: 0, explanation: "Paris est la capitale de la France.", knowledgeTarget: "Un triangle possède trois côtés." })
  ];
}

async function runFixturesOnly() {
  const fixtures = fixtureSet();
  const deterministic = validateQuestionBatchQuality(fixtures, { requireKnowledgeTarget: true });
  const semantic = deterministic.accepted;
  const reviews = semantic.length ? await criticPayload(semantic.map((question, index) => ({ id: `fixture-${index + 1}`, ...question, sourceExcerpt: question.knowledgeTarget })), { hasIndependentSource: true }) : { reviews: [] };
  process.stdout.write(JSON.stringify({
    databaseWrites: 0,
    generationCalls: 0,
    deterministic: deterministic.decisions.map((item) => ({ sourceId: item.question.sourceId, valid: item.valid, reasonCodes: item.reasons.map((reason) => reason.code) })),
    semanticSourceIds: semantic.map((item) => item.sourceId),
    semanticReviews: reviews.reviews || [],
    usage
  }, null, 2) + "\n");
}

(async () => {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY manquante.");
  if (process.argv.includes("--fixtures-only")) return runFixturesOnly();
  const initial = await callOpenAI("generation", MODEL, generationPrompt());
  const raw = Array.isArray(initial.questions) ? initial.questions : [];
  const deterministic = validateQuestionBatchQuality(raw, { requireKnowledgeTarget: true });
  const regenerated = [];
  const outcome = await runQuestionQualityPipeline(raw, {
    maxRetries: 2,
    validationOptions: { requireKnowledgeTarget: true },
    context: { hasIndependentSource: true, sourceExcerptFor: (_id, question) => question.knowledgeTarget },
    reviewSemantic: ({ entries, context }) => criticPayload(entries, context),
    regenerate: async ({ rejected, accepted, attempt }) => {
      const result = await callOpenAI("regeneration", MODEL, generationPrompt(`\nCycle ${attempt}: remplace exactement ${rejected.length} question(s) refusée(s). Questions acceptées à ne pas dupliquer: ${JSON.stringify(accepted.map(publicQuestion))}. Refus: ${JSON.stringify(rejected.map((item) => ({ question: publicQuestion(item.question), reasonCodes: item.reasons.map((reason) => reason.code) })))}. Réponds avec exactement ${rejected.length} objets dans questions.`));
      const replacements = Array.isArray(result.questions) ? result.questions.slice(0, rejected.length) : [];
      regenerated.push(...replacements);
      return replacements;
    }
  });
  const final = outcome.accepted.map(validateQuestionItemCore).filter(Boolean);

  // Un seul appel critique supplémentaire, sans génération : les défauts
  // structurels sont filtrés localement, seuls les défauts sémantiques passent.
  const fixtures = fixtureSet();
  const fixtureDeterministic = validateQuestionBatchQuality(fixtures, { requireKnowledgeTarget: true });
  const semanticFixtures = fixtureDeterministic.accepted;
  const fixtureReviews = semanticFixtures.length ? await criticPayload(semanticFixtures.map((question, index) => ({ id: `fixture-${index + 1}`, ...question, sourceExcerpt: question.knowledgeTarget })), { hasIndependentSource: true }) : { reviews: [] };
  const pricingFor = (model) => MODEL_PRICING_USD_PER_MILLION_TOKENS[model] || null;
  let estimatedCostUsd = 0;
  let costKnown = true;
  for (const [feature, values] of Object.entries(usage.byFeature)) {
    const model = feature === "critic" ? CRITIC_MODEL : MODEL;
    const pricing = pricingFor(model);
    if (!pricing) { costKnown = false; continue; }
    values.estimatedCostUsd = (values.promptTokens * pricing.input + values.completionTokens * pricing.output) / 1_000_000;
    estimatedCostUsd += values.estimatedCostUsd;
  }

  process.stdout.write(JSON.stringify({
    databaseWrites: 0,
    models: { generation: MODEL, critic: CRITIC_MODEL },
    initialOutput: raw.map(publicQuestion),
    deterministicDecisions: deterministic.decisions.map((item) => ({ index: item.index, valid: item.valid, reasonCodes: item.reasons.map((reason) => reason.code) })),
    pipeline: { metrics: outcome.metrics, criticVerdicts: criticVerdicts.slice(0, criticVerdicts.length - (fixtureReviews.reviews || []).length), rejected: outcome.rejected.map((item) => ({ question: item.question?.question, reasonCodes: item.reasons.map((reason) => reason.code) })) },
    regenerated: regenerated.map(publicQuestion),
    finalOutput: final.map(publicQuestion),
    intentionalFixtures: {
      deterministic: fixtureDeterministic.decisions.map((item) => ({ sourceId: item.question.sourceId, valid: item.valid, reasonCodes: item.reasons.map((reason) => reason.code) })),
      semanticReviews: fixtureReviews.reviews || []
    },
    usage: { ...usage, estimatedCostUsd: costKnown ? estimatedCostUsd : null }
  }, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`Test réel échoué : ${error.code || "ERROR"} — ${error.message}\n`); process.exitCode = 1; });
