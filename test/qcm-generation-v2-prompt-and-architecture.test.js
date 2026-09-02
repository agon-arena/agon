"use strict";

// V2 pipeline QCM (02/09/2026, audit instrumenté "Taoïsme") — CHANGEMENT 1 :
// version courte et opérationnelle, côté générateur (question_generation),
// de règles déjà connues du critique sémantique mais jamais explicitées
// côté générateur. Vérifie la présence des 4 principes demandés via des
// marqueurs distinctifs (jamais une phrase entière verbatim, pour rester
// robuste à une reformulation mineure) — cohérent avec les autres tests de
// câblage de ce fichier (ex. test/custom-topic-generation-wiring.test.js).
//
// Vérifie aussi explicitement la non-régression de l'architecture (Audit V1
// "Taoïsme" : maxRetries, MIN_MASTER_QUESTIONS, cible 20, modèles, V3.2) —
// cette V2 ne touche QUE le contenu du prompt de génération et la
// compaction des payloads de régénération (cf.
// test/qcm-generation-v2-payload-compaction.test.js), jamais ces éléments.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

function extractBlock(startMarker, endMarker) {
  const start = SERVER_SOURCE.indexOf(startMarker);
  assert.ok(start >= 0, `marqueur de début introuvable : ${startMarker}`);
  const end = SERVER_SOURCE.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `marqueur de fin introuvable : ${endMarker}`);
  return SERVER_SOURCE.slice(start, end);
}

const FORMATS_BLOCK_SOURCE = extractBlock(
  "function buildQuestionFormatsPromptBlock(",
  "\n// shuffleArray, shuffleOptionsPreservingCorrectIndex(es)"
);

// ── CHANGEMENT 1 : les 4 principes sont bien présents, en une V2 additive ──

test("le prompt de génération contient une règle d'homogénéité de catégorie des distracteurs (ARTIFICIAL_DISTRACTOR/CATEGORY_MISMATCH)", () => {
  assert.match(FORMATS_BLOCK_SOURCE, /Homogénéité des distracteurs/);
  assert.match(FORMATS_BLOCK_SOURCE, /personne ↔ personne/);
  assert.match(FORMATS_BLOCK_SOURCE, /date ↔ date/);
  assert.match(FORMATS_BLOCK_SOURCE, /institution ↔ institution/);
});

test("le prompt de génération contient une règle de plausibilité interdisant les pseudo-concepts/institutions inventés (ARTIFICIAL_DISTRACTOR)", () => {
  assert.match(FORMATS_BLOCK_SOURCE, /Distracteurs plausibles/);
  assert.match(FORMATS_BLOCK_SOURCE, /pseudo-concept/);
  assert.match(FORMATS_BLOCK_SOURCE, /institution.*inventé/);
});

test("le prompt de génération contient une règle de non-devinabilité sans connaissance (GUESSABLE_WITHOUT_KNOWLEDGE)", () => {
  assert.match(FORMATS_BLOCK_SOURCE, /Non devinable sans connaissance/);
  assert.match(FORMATS_BLOCK_SOURCE, /forme grammaticale/);
  assert.match(FORMATS_BLOCK_SOURCE, /élimination immédiate/);
});

test("le prompt de génération contient une règle d'options réellement distinctes (AMBIGUOUS_DISTRACTOR/REORDERED_DUPLICATE_OPTION)", () => {
  assert.match(FORMATS_BLOCK_SOURCE, /Options réellement distinctes/);
  assert.match(FORMATS_BLOCK_SOURCE, /reformulation superficielle/);
});

test("les 4 nouvelles règles restent compactes (quelques lignes, jamais les longs paragraphes du critique dupliqués)", () => {
  const markers = ["Homogénéité des distracteurs", "Distracteurs plausibles :", "Non devinable sans connaissance", "Options réellement distinctes"];
  for (const marker of markers) {
    const idx = FORMATS_BLOCK_SOURCE.indexOf(marker);
    assert.ok(idx >= 0, `règle introuvable : ${marker}`);
    const lineEnd = FORMATS_BLOCK_SOURCE.indexOf('",', idx);
    assert.ok(lineEnd > idx, `fin de ligne introuvable pour : ${marker}`);
    const length = lineEnd - idx;
    assert.ok(length < 500, `la règle "${marker}" fait ${length} caractères — doit rester courte, jamais un long paragraphe comme buildSemanticReviewPrompt`);
  }
});

test("les règles existantes ne sont pas retirées (INTERDICTION ABSOLUE vrai/faux, QUALITÉ OBLIGATOIRE, PRÉFÉRENCE À L'AFFIRMATIF)", () => {
  assert.match(FORMATS_BLOCK_SOURCE, /INTERDICTION ABSOLUE/);
  assert.match(FORMATS_BLOCK_SOURCE, /QUALITÉ OBLIGATOIRE/);
  assert.match(FORMATS_BLOCK_SOURCE, /PRÉFÉRENCE À L'AFFIRMATIF/);
});

test("la méthodologie documentaire/grounding (V3) n'est pas modifiée par ce correctif", () => {
  assert.match(FORMATS_BLOCK_SOURCE, /MÉTHODE DOCUMENTAIRE OBLIGATOIRE/);
  assert.match(FORMATS_BLOCK_SOURCE, /supporting_claim/);
});

test("le système de variantes (jusqu'à 3, RÈGLE D'ATOMICITÉ) n'est pas modifié par ce correctif", () => {
  assert.match(FORMATS_BLOCK_SOURCE, /RÈGLE D'ATOMICITÉ/);
  assert.match(FORMATS_BLOCK_SOURCE, /Jusqu'à 3 variantes par question/);
});

test("les 4 nouvelles règles ne sont ajoutées qu'une seule fois (pas de duplication accidentelle)", () => {
  for (const marker of ["Homogénéité des distracteurs", "Non devinable sans connaissance", "Options réellement distinctes"]) {
    const count = FORMATS_BLOCK_SOURCE.split(marker).length - 1;
    assert.equal(count, 1, `"${marker}" doit apparaître exactement une fois`);
  }
});

// ── Non-régression architecture (rien d'autre n'a changé) ──────────────────

test("maxRetries (budget de régénération) est strictement inchangé", () => {
  assert.match(SERVER_SOURCE, /const QCM_SEMANTIC_REVIEW_MAX_RETRIES = Math\.max\(0, Math\.min\(2, Number\.parseInt\(process\.env\.QCM_SEMANTIC_REVIEW_MAX_RETRIES \|\| "2", 10\) \|\| 0\)\);/);
});

test("MIN_MASTER_QUESTIONS et la cible de 20 questions restent inchangés", () => {
  assert.match(SERVER_SOURCE, /target: 20, max: 22, min: MIN_MASTER_QUESTIONS,/);
});

test("les modèles (narrative/critic) ne sont pas modifiés par cette V2", () => {
  assert.match(SERVER_SOURCE, /const DAILY_QUIZ_NARRATIVE_MODEL = process\.env\.OPENAI_DAILY_QUIZ_NARRATIVE_MODEL \|\| "gpt-4\.1-mini";/);
  assert.match(SERVER_SOURCE, /const DAILY_QUIZ_CRITIC_MODEL = process\.env\.OPENAI_DAILY_QUIZ_CRITIC_MODEL \|\| DAILY_QUIZ_NARRATIVE_MODEL;/);
});

test("la logique V3.2 d'expansion des sources (expandGroundingAndRegenerateMissingQuestions) n'est pas modifiée par cette V2", () => {
  assert.match(SERVER_SOURCE, /const missingKnowledge = accepted\.filter\(\(k\) => !validated\.some\(\(v\) => normalizeFactText\(v\.knowledgeTarget\) === normalizeFactText\(k\.fact\)\)\);/);
  assert.match(SERVER_SOURCE, /const decision = shouldExpandGroundingSources\(questionQualityMetrics, \{ questionsRequested: accepted\.length \}\);/);
});

test("aucun appel IA supplémentaire n'a été introduit par cette V2 : toujours 3 appels _callOpenAI dans generateNotionLevelQuiz", () => {
  const fnStart = SERVER_SOURCE.indexOf("async function generateNotionLevelQuiz(apiKey, subject, contextHint, id, levelConfig, requireValidation, requestedLevel, classificationContext = null) {");
  const fnEnd = SERVER_SOURCE.indexOf("\nasync function buildNotionQuestions(", fnStart);
  assert.ok(fnStart > 0 && fnEnd > fnStart);
  const fnBody = SERVER_SOURCE.slice(fnStart, fnEnd);
  const count = (fnBody.match(/await _callOpenAI\(apiKey,/g) || []).length;
  assert.equal(count, 3, "fiche + vérification + génération, jamais plus — inchangé par cette V2");
});

test("basePrompt n'est pas retiré de la régénération : le prompt reste construit sur le même mécanisme qu'avant (aucun nouveau système de prompts)", () => {
  const idx = SERVER_SOURCE.indexOf("const regenerationPrompt = [\n        basePrompt,");
  assert.ok(idx >= 0, "basePrompt doit rester le premier élément du prompt de régénération, comme avant cette V2");
});
