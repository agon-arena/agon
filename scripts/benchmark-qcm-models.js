#!/usr/bin/env node
"use strict";

const fs = require("fs");
const { validateQuestionBatchQuality } = require("../lib/qcm-quality");

const inputIndex = process.argv.indexOf("--input");
if (inputIndex < 0 || !process.argv[inputIndex + 1]) {
  process.stderr.write("Usage : node scripts/benchmark-qcm-models.js --input benchmark.json\n");
  process.exit(1);
}
const payload = JSON.parse(fs.readFileSync(process.argv[inputIndex + 1], "utf8"));
const models = Array.isArray(payload.models) ? payload.models : [];
const result = models.map((entry) => {
  const deterministic = validateQuestionBatchQuality(entry.questions || []);
  const semantic = Array.isArray(entry.semanticReviews) ? entry.semanticReviews : [];
  const semanticAccepted = semantic.filter((review) => review.verdict === "accept").length;
  return {
    model: entry.model,
    generated: (entry.questions || []).length,
    deterministicAcceptanceRate: entry.questions?.length ? deterministic.accepted.length / entry.questions.length : 0,
    semanticAcceptanceRate: semantic.length ? semanticAccepted / semantic.length : null,
    averageRegenerations: Number(entry.regenerations || 0) / Math.max(1, entry.questions?.length || 0),
    costUsd: Number(entry.costUsd || 0),
    latencyMs: Number(entry.latencyMs || 0),
    diversity: entry.diversity ?? null,
    evaluatedAccuracy: entry.evaluatedAccuracy ?? null,
    deterministicErrors: deterministic.rejected.flatMap((item) => item.reasons.map((reason) => reason.code))
  };
});
process.stdout.write(JSON.stringify({ offline: true, models: result }, null, 2) + "\n");
