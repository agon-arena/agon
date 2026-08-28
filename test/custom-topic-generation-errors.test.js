"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyAiError,
  generationFailure,
  publicGenerationError
} = require("../lib/custom-topic-generation-errors");

test("une indisponibilité OpenAI a un code stable et ne divulgue pas l'erreur technique", () => {
  const failure = generationFailure(classifyAiError(Object.assign(new Error("secret upstream body"), { status: 502 })), "fiche_generation");
  const response = publicGenerationError(failure.code, failure.reason);
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, {
    ok: false,
    code: "AI_UNAVAILABLE",
    error: "Le service IA est temporairement indisponible. Réessaie dans quelques instants."
  });
});

test("un timeout est distingué d'une indisponibilité IA", () => {
  const response = publicGenerationError(classifyAiError(Object.assign(new Error("request timed out"), { name: "TimeoutError" })));
  assert.equal(response.status, 504);
  assert.equal(response.body.code, "AI_TIMEOUT");
});

test("un JSON ou contenu inexploitable est une erreur métier contrôlée", () => {
  const response = publicGenerationError("CONTENT_UNUSABLE");
  assert.equal(response.status, 422);
  assert.match(response.body.error, /n’a pas pu être exploité/);
});

test("l'échec QCM ne prétend plus que la fiche a échoué", () => {
  const response = publicGenerationError("QCM_UNUSABLE");
  assert.equal(response.status, 422);
  assert.match(response.body.error, /fiche a été créée/);
  assert.doesNotMatch(response.body.error, /Génération de la fiche impossible/);
});

test("une erreur de stockage est temporaire et distincte", () => {
  const response = publicGenerationError("STORAGE_TEMPORARY");
  assert.equal(response.status, 503);
  assert.equal(response.body.code, "STORAGE_TEMPORARY");
});

test("une raison métier sûre peut être conservée", () => {
  const response = publicGenerationError("KNOWLEDGE_REJECTED", "Sujet trop vague pour produire des faits fiables.");
  assert.equal(response.status, 422);
  assert.equal(response.body.error, "Sujet trop vague pour produire des faits fiables.");
});
