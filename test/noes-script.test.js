"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NOES_QUESTION_MAX_LENGTH,
  NOES_ANSWER_MAX_LENGTH,
  buildNoesScriptItemsFromQuestions,
  buildNoesScriptPrompt,
  validateNoesScriptResponse
} = require("../lib/coeus/noes-script");

test("extrait les connaissances depuis knowledgeTarget, jamais depuis la question QCM", () => {
  const questions = [
    { id: "q1", question: "Quelle est la date de la chute de Constantinople ?", knowledgeTarget: "La chute de Constantinople a lieu en 1453." },
    { id: "q2", question: "Sans knowledgeTarget (ancien contenu)." } // exclu, cf. commentaire du module
  ];
  const { facts, knowledgeIds } = buildNoesScriptItemsFromQuestions({ slot: "notion:custom:abc", quizDate: "2026-08-26", questions });
  assert.deepEqual(facts, ["La chute de Constantinople a lieu en 1453."]);
  assert.deepEqual(knowledgeIds, ["notion:custom:abc::2026-08-26::q1"]);
});

test("knowledge_id = natural_key du MemoryItem (traçabilité FSRS)", () => {
  const questions = [{ id: "custom-q3", knowledgeTarget: "fait" }];
  const { knowledgeIds } = buildNoesScriptItemsFromQuestions({ slot: "notion:custom:xyz", quizDate: "2026-01-02", questions });
  assert.deepEqual(knowledgeIds, ["notion:custom:xyz::2026-01-02::custom-q3"]);
});

test("le prompt numérote localement les connaissances (jamais leur natural_key exposée au modèle)", () => {
  const prompt = buildNoesScriptPrompt(["Premier fait.", "Second fait."]);
  assert.match(prompt, /1\. Premier fait\./);
  assert.match(prompt, /2\. Second fait\./);
  assert.doesNotMatch(prompt, /notion:custom:/);
  assert.match(prompt, /jamais un QCM/);
});

test("valide une réponse conforme et mappe par position vers knowledge_id", () => {
  const parsed = { items: [{ index: 1, question: "En quelle année ?", answer: "1453" }, { index: 2, question: "Quel océan ?", answer: "Le Pacifique" }] };
  const result = validateNoesScriptResponse(parsed, ["k1", "k2"]);
  assert.deepEqual(result, [
    { knowledgeId: "k1", question: "En quelle année ?", answer: "1453" },
    { knowledgeId: "k2", question: "Quel océan ?", answer: "Le Pacifique" }
  ]);
});

test("rejette un nombre d'items différent du nombre de connaissances envoyées", () => {
  assert.equal(validateNoesScriptResponse({ items: [{ question: "Q", answer: "A" }] }, ["k1", "k2"]), null);
});

test("rejette un format QCM (options/correctIndex/correctIndexes)", () => {
  assert.equal(validateNoesScriptResponse({ items: [{ question: "Q", answer: "A", options: ["a", "b"] }] }, ["k1"]), null);
  assert.equal(validateNoesScriptResponse({ items: [{ question: "Q", answer: "A", correctIndex: 0 }] }, ["k1"]), null);
  assert.equal(validateNoesScriptResponse({ items: [{ question: "Q", answer: "A", correctIndexes: [0, 1] }] }, ["k1"]), null);
});

test("rejette question ou réponse vide", () => {
  assert.equal(validateNoesScriptResponse({ items: [{ question: "", answer: "A" }] }, ["k1"]), null);
  assert.equal(validateNoesScriptResponse({ items: [{ question: "Q", answer: "" }] }, ["k1"]), null);
});

test("rejette une question ou une réponse trop longue pour rester orale", () => {
  const longQuestion = "Q".repeat(NOES_QUESTION_MAX_LENGTH + 1);
  assert.equal(validateNoesScriptResponse({ items: [{ question: longQuestion, answer: "A" }] }, ["k1"]), null);
  const longAnswer = "A".repeat(NOES_ANSWER_MAX_LENGTH + 1);
  assert.equal(validateNoesScriptResponse({ items: [{ question: "Q", answer: longAnswer }] }, ["k1"]), null);
});

test("rejette un JSON dont items n'est pas un tableau", () => {
  assert.equal(validateNoesScriptResponse({}, ["k1"]), null);
  assert.equal(validateNoesScriptResponse({ items: "pas un tableau" }, ["k1"]), null);
});
