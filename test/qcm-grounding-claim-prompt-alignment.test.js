"use strict";

// Correctif du 02/09/2026 (audit "Platon", GROUNDING_CLAIM_NOT_GROUNDED_IN_SOURCE
// ×9) : la consigne de supporting_claim (server.js, buildQuestionFormatsPromptBlock)
// encourageait explicitement une "paraphrase fidèle" sans jamais préciser que le
// validateur (lib/question-grounding-validation.js) mesure un recouvrement LEXICAL
// brut avec le texte des sources — une reformulation factuellement fidèle mais
// lexicalement éloignée pouvait donc être rejetée. Ce correctif touche UNIQUEMENT
// le texte du prompt lié à supporting_claim ; ce fichier vérifie :
// 1. que les nouvelles notions sont bien présentes dans le prompt ;
// 2. qu'aucun seuil/logique de lib/question-grounding-validation.js n'a changé ;
// 3. que la ligne sur la liberté de formulation de la QUESTION (champ distinct,
//    jamais concerné par ce correctif) reste intacte.
//
// server.js démarre tout le serveur Express à l'import et ne peut donc pas être
// require()-é dans un test : vérification par lecture du texte source, même
// convention que test/custom-topic-generation-wiring.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const GROUNDING_VALIDATION_SOURCE = fs.readFileSync(path.join(__dirname, "..", "lib", "question-grounding-validation.js"), "utf8");

function extractBlock(startMarker, endMarker) {
  const start = SERVER_SOURCE.indexOf(startMarker);
  assert.ok(start >= 0, `marqueur de début introuvable : ${startMarker}`);
  const end = SERVER_SOURCE.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `marqueur de fin introuvable : ${endMarker}`);
  return SERVER_SOURCE.slice(start, end);
}

// La ligne du champ "supporting_claim" elle-même, isolée par ses guillemets de
// début/fin d'élément de tableau — jamais tout le bloc de traçabilité, pour ne
// tester que ce que ce correctif a réellement changé.
const SUPPORTING_CLAIM_LINE = extractBlock(
  '"- \\"supporting_claim\\" : l\'affirmation factuelle précise établie par les sources',
  '"- \\"source_ids\\"'
);

// ── Les nouvelles notions sont bien présentes ───────────────────────────────

test("supporting_claim : demande explicitement de rester lexicalement proche de la source", () => {
  assert.match(SUPPORTING_CLAIM_LINE, /LEXICALEMENT PROCHE du ou des passages sources/);
});

test("supporting_claim : demande explicitement la conservation des noms propres", () => {
  assert.match(SUPPORTING_CLAIM_LINE, /conserve les noms propres importants/);
});

test("supporting_claim : demande explicitement la conservation des dates et nombres", () => {
  assert.match(SUPPORTING_CLAIM_LINE, /les dates et nombres pertinents/);
});

test("supporting_claim : demande explicitement la conservation des termes factuels clés", () => {
  assert.match(SUPPORTING_CLAIM_LINE, /concepts et termes factuels clés/);
});

test("supporting_claim : interdit le remplacement inutile par synonymes/périphrases/reformulations éloignées", () => {
  assert.match(SUPPORTING_CLAIM_LINE, /synonymes, périphrases ou reformulations éloignées/);
});

test("supporting_claim : autorise explicitement une reformulation LÉGÈRE de la syntaxe/des mots de liaison, jamais une reformulation libre", () => {
  assert.match(SUPPORTING_CLAIM_LINE, /légère reformulation de la syntaxe et des mots de liaison/);
  assert.match(SUPPORTING_CLAIM_LINE, /jamais une reformulation libre/);
});

test("supporting_claim : précise qu'il n'est pas obligatoire de recopier une phrase entière mot pour mot (reste compatible avec une paraphrase légère)", () => {
  assert.match(SUPPORTING_CLAIM_LINE, /rien n'oblige à recopier une phrase entière mot pour mot/);
});

test("supporting_claim : l'ancienne formulation ambiguë \"(paraphrase fidèle acceptée)\" a bien disparu de ce champ précis", () => {
  assert.doesNotMatch(SUPPORTING_CLAIM_LINE, /\(paraphrase fidèle acceptée\)/);
});

test("supporting_claim : les contraintes déjà existantes (jamais vague/résumé/mention, jamais de détail ajouté, jamais de fusion de sources) sont toutes conservées", () => {
  assert.match(SUPPORTING_CLAIM_LINE, /jamais une reformulation vague, un résumé du thème ni une simple mention du même sujet/);
  assert.match(SUPPORTING_CLAIM_LINE, /n'ajoute aucun détail absent/);
  assert.match(SUPPORTING_CLAIM_LINE, /ne fusionne pas plusieurs sources pour créer un fait nouveau qu'aucune n'établit explicitement/);
});

// ── Pas de contradiction ailleurs dans le prompt ────────────────────────────
// (l'ancienne formulation reste légitimement citée dans le commentaire du
// correctif lui-même, cf. juste au-dessus de SUPPORTING_CLAIM_LINE — seule sa
// présence dans le TEXTE DU PROMPT réellement envoyé au modèle est vérifiée
// ci-dessus, "l'ancienne formulation ambiguë... a bien disparu de ce champ précis")

test("la ligne sur la liberté de formulation de la QUESTION (champ distinct de supporting_claim) reste intacte — ce correctif ne la concerne pas", () => {
  assert.match(SERVER_SOURCE, /La question reste naturelle, pédagogique, variée et adaptée au niveau demandé : une paraphrase fidèle est permise/);
  assert.match(SERVER_SOURCE, /aucune extraction littérale de la question n'est exigée/);
});

test("la méthode documentaire (MÉTHODE DOCUMENTAIRE OBLIGATOIRE, AUTO-VÉRIFICATION SILENCIEUSE) reste inchangée", () => {
  assert.match(SERVER_SOURCE, /MÉTHODE DOCUMENTAIRE OBLIGATOIRE — construis la question À PARTIR DE LA PREUVE/);
  assert.match(SERVER_SOURCE, /AUTO-VÉRIFICATION SILENCIEUSE avant chaque sortie/);
});

// ── Aucun seuil ni logique de validation grounding n'a changé ──────────────

test("MIN_CLAIM_SOURCE_OVERLAP reste à 0.35, MIN_CLAIM_SOURCE_INDIVIDUAL_CONTRIBUTION reste à 0.12", () => {
  assert.match(GROUNDING_VALIDATION_SOURCE, /const MIN_CLAIM_SOURCE_OVERLAP = 0\.35;/);
  assert.match(GROUNDING_VALIDATION_SOURCE, /const MIN_CLAIM_SOURCE_INDIVIDUAL_CONTRIBUTION = 0\.12;/);
});

test("MIN_ANSWER_CLAIM_OVERLAP (contrôle distinct) reste à 0.34 — non concerné par ce correctif", () => {
  assert.match(GROUNDING_VALIDATION_SOURCE, /const MIN_ANSWER_CLAIM_OVERLAP = 0\.34;/);
});

test("validateQuestionGrounding : la logique de comparaison (overlapFraction, tokenize, resolveSource) n'a pas été touchée par ce correctif", () => {
  assert.match(GROUNDING_VALIDATION_SOURCE, /const combinedOverlap = overlapFraction\(claimTokens, combinedSourceText\);/);
  assert.match(GROUNDING_VALIDATION_SOURCE, /if \(combinedOverlap < MIN_CLAIM_SOURCE_OVERLAP\)/);
  assert.match(GROUNDING_VALIDATION_SOURCE, /function resolveSource\(sourcesById, id\) \{/);
});

// ── Non-régression architecture (rien d'autre n'a changé) ───────────────────

test("aucun autre seuil/architecture QCM n'a été modifié par ce correctif (maxRetries, MIN_MASTER_QUESTIONS, modèles, V3.2)", () => {
  assert.match(SERVER_SOURCE, /const QCM_SEMANTIC_REVIEW_MAX_RETRIES = Math\.max\(0, Math\.min\(2, Number\.parseInt\(process\.env\.QCM_SEMANTIC_REVIEW_MAX_RETRIES \|\| "2", 10\) \|\| 0\)\);/);
  assert.match(SERVER_SOURCE, /target: 20, max: 22, min: MIN_MASTER_QUESTIONS,/);
  assert.match(SERVER_SOURCE, /const DAILY_QUIZ_NARRATIVE_MODEL = process\.env\.OPENAI_DAILY_QUIZ_NARRATIVE_MODEL \|\| "gpt-4\.1-mini";/);
  assert.match(SERVER_SOURCE, /const missingKnowledge = accepted\.filter\(\(k\) => !validated\.some\(\(v\) => normalizeFactText\(v\.knowledgeTarget\) === normalizeFactText\(k\.fact\)\)\);/);
});

test("aucun nouveau champ n'a été persisté dans notion_quiz_generation_failures (le correctif reste limité au prompt)", () => {
  const libSource = fs.readFileSync(path.join(__dirname, "..", "lib", "notion-quiz-generation-failures.js"), "utf8");
  assert.match(libSource, /\.insert\(\{\s*identity,\s*code: code \|\| null,\s*reason: reason \? String\(reason\)\.slice\(0, 500\) : null\s*\}\);/);
});
