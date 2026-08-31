"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");

const serverSource = fs.readFileSync(require.resolve("../server.js"), "utf8");
const formatsSource = fs.readFileSync(require.resolve("../lib/question-formats.js"), "utf8");

test("les cinq parcours générateurs passent par la chaîne V2", () => {
  for (const route of ["free_search", "notion_", "knowledge_import", "knowledge_import_batch", "comprendre"]) {
    assert.match(serverSource, new RegExp(`route:\\s*[\`\"']${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
  // 7 depuis le 31/08/2026 (V3.2, "fallback d'enrichissement des sources") :
  // une définition, cinq branchements historiques (un par route ci-dessus) et
  // un sixième branchement dans expandGroundingAndRegenerateMissingQuestions
  // (server.js) — jamais une nouvelle route, seulement une régénération
  // ciblée supplémentaire, au sein de "free_search", pour les questions
  // manquantes après enrichissement du corpus. Repasse par EXACTEMENT la
  // même chaîne V2 (aucun contournement), cf. test/qcm-grounding-source-expansion-integration.test.js.
  assert.equal((serverSource.match(/qualityControlRawQuestions\s*\(/g) || []).length, 7, "une définition, cinq branchements historiques et le branchement d'expansion V3.2");
});

test("la critique est faite avant validateNarrativeQuizQuestions/shuffle", () => {
  const helper = serverSource.indexOf("async function qualityControlRawQuestions");
  const validator = serverSource.indexOf("function validateNarrativeQuizQuestions");
  assert.ok(validator < helper, "le validateur structurel appelle ensuite validateQuestionItemCore qui mélange");
  assert.match(formatsSource, /validateQuestionQuality\(item\)[\s\S]{0,1400}shuffleOptionsPreservingCorrectIndex/);
});

test("le verrou post-shuffle est appelé pour QCM simple, multiple, association et ordre", () => {
  assert.ok((formatsSource.match(/validateFinalShuffledQuestion\(item, finalQuestion\)/g) || []).length >= 4);
});

test("aucun second lot complet n'est généré après la chaîne ciblée", () => {
  assert.match(serverSource, /const questionAttempts = 1;/);
  assert.match(serverSource, /Remplace exactement \$\{rejectionPayload\.length\} question/);
});

test("les logs de qualité restent agrégés et n'impriment aucun contenu privé", () => {
  const start = serverSource.indexOf('console.info("[qcm-quality]"');
  const snippet = serverSource.slice(start, start + 700);
  assert.doesNotMatch(snippet, /knowledgeTarget|rejectedQuestion|sourceExcerpt|question:/);
  assert.match(snippet, /\.\.\.outcome\.metrics/);
});
