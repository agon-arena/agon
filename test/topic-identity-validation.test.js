"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildTopicValidationInstructions,
  parseTopicValidationField,
  TOPIC_VALIDATION_AMBIGUOUS_JSON_EXAMPLE,
  MIN_TOPIC_VALIDATION_CANDIDATES,
  MAX_TOPIC_VALIDATION_CANDIDATES
} = require("../lib/topic-identity-validation");

// ── buildTopicValidationInstructions ─────────────────────────────────────

test("buildTopicValidationInstructions : mentionne le sujet et adapte le message selon la présence de sources", () => {
  const withSources = buildTopicValidationInstructions("Baudouin de Hainaut", true).join("\n");
  assert.match(withSources, /Baudouin de Hainaut/);
  assert.match(withSources, /au vu des sources ci-dessus/);

  const withoutSources = buildTopicValidationInstructions("Baudouin de Hainaut", false).join("\n");
  assert.match(withoutSources, /au vu de tes connaissances/);
});

test("buildTopicValidationInstructions : reste conservateur (sujet vaste, désaccord documentaire mineur = valid)", () => {
  const text = buildTopicValidationInstructions("Empire romain", true).join("\n");
  assert.match(text, /n'est PAS une ambiguïté/);
  assert.match(text, /en cas de doute réel, réponds toujours "valid"/);
});

// ── parseTopicValidationField : conservateur par construction ───────────

test("parseTopicValidationField : status absent ou malformé retombe sur valid, jamais un blocage", () => {
  assert.deepEqual(parseTopicValidationField(undefined), { status: "valid", normalizedTopic: null, reason: null, candidates: [] });
  assert.deepEqual(parseTopicValidationField(null), { status: "valid", normalizedTopic: null, reason: null, candidates: [] });
  assert.deepEqual(parseTopicValidationField({}), { status: "valid", normalizedTopic: null, reason: null, candidates: [] });
  assert.deepEqual(parseTopicValidationField({ status: "unknown" }), { status: "valid", normalizedTopic: null, reason: null, candidates: [] });
});

test("parseTopicValidationField : valid conserve normalizedTopic quand fourni", () => {
  const result = parseTopicValidationField({ status: "valid", normalizedTopic: "Napoléon Ier" });
  assert.equal(result.status, "valid");
  assert.equal(result.normalizedTopic, "Napoléon Ier");
  assert.deepEqual(result.candidates, []);
});

test("parseTopicValidationField : ambiguous avec au moins deux candidats exploitables est accepté (cas réel Baudouin de Hainaut)", () => {
  const result = parseTopicValidationField({
    status: "ambiguous",
    reason: "Les sources renvoient à plusieurs personnes distinctes portant le nom Baudouin de Hainaut.",
    candidates: [
      { label: "Baudouin IV de Hainaut", description: "Comte de Hainaut de 1120 à 1171" },
      { label: "Baudouin de Hainaut", description: "Diplomate de l'Empire latin de Constantinople au XIIIe siècle" }
    ]
  });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].label, "Baudouin IV de Hainaut");
  assert.match(result.reason, /plusieurs personnes distinctes/);
});

test("parseTopicValidationField : tronque à MAX_TOPIC_VALIDATION_CANDIDATES même si le modèle en renvoie davantage", () => {
  const candidates = Array.from({ length: 6 }, (_, i) => ({ label: `Candidat ${i + 1}`, description: `Description ${i + 1}` }));
  const result = parseTopicValidationField({ status: "ambiguous", reason: "test", candidates });
  assert.equal(result.candidates.length, MAX_TOPIC_VALIDATION_CANDIDATES);
});

test("parseTopicValidationField : ambiguous avec moins de deux candidats exploitables retombe sur valid (jamais de blocage sans choix réel)", () => {
  const oneCandidate = parseTopicValidationField({
    status: "ambiguous",
    reason: "test",
    candidates: [{ label: "Seul candidat", description: "Description" }]
  });
  assert.equal(oneCandidate.status, "valid");
  assert.equal(oneCandidate.candidates.length, 0);

  const noCandidates = parseTopicValidationField({ status: "ambiguous", reason: "test", candidates: [] });
  assert.equal(noCandidates.status, "valid");

  const malformedCandidates = parseTopicValidationField({
    status: "ambiguous",
    candidates: [{ label: "Sans description" }, { description: "Sans label" }]
  });
  assert.equal(malformedCandidates.status, "valid");
});

test("parseTopicValidationField : écarte les candidats sans label ou sans description avant de compter le minimum", () => {
  const result = parseTopicValidationField({
    status: "ambiguous",
    reason: "test",
    candidates: [
      { label: "Valide 1", description: "Description 1" },
      { label: "", description: "Description sans label" },
      { label: "Valide 2", description: "Description 2" }
    ]
  });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 2);
});

test("MIN/MAX_TOPIC_VALIDATION_CANDIDATES : bornes documentées (2 à 4)", () => {
  assert.equal(MIN_TOPIC_VALIDATION_CANDIDATES, 2);
  assert.equal(MAX_TOPIC_VALIDATION_CANDIDATES, 4);
});

test("TOPIC_VALIDATION_AMBIGUOUS_JSON_EXAMPLE : forme JSON réutilisable telle quelle dans les prompts", () => {
  assert.match(TOPIC_VALIDATION_AMBIGUOUS_JSON_EXAMPLE, /"status":"ambiguous"/);
  assert.match(TOPIC_VALIDATION_AMBIGUOUS_JSON_EXAMPLE, /"candidates"/);
});
