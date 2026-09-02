"use strict";

// Verrous de câblage — instrumentation coût/génération QCM gpt-5.6-luna
// (demande du 01/09/2026). server.js ne peut pas être `require()` dans un
// test (il démarre tout le serveur Express à l'import) : ce fichier vérifie
// donc, en lisant server.js comme un TEXTE brut (jamais exécuté), que
// `generationId` est bien propagé à chaque appel IA appartenant à une même
// génération QCM — même principe que test/notion-quiz-master-wiring.test.js
// et test/qcm-quality-wiring.test.js.
//
// Rappel : `generationId` réutilise partout le `id`/`sourceId` déjà propagé
// dans tout le pipeline notion-quiz (cf. les logs [notion-quiz:${id}] déjà
// présents avant cette instrumentation) — jamais un nouvel identifiant.
//
// Les extraits de fonction ci-dessous sont bornés par le début de la
// fonction SUIVANTE réellement déclarée juste après (vérifié une fois lors
// de l'écriture de ce fichier) plutôt qu'une longueur arbitraire, pour ne
// jamais couper une assertion à mi-chemin ni déborder sur une autre fonction.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

function sliceBetween(startPattern, endMarker) {
  const startMatch = SERVER_SOURCE.match(startPattern);
  assert.ok(startMatch, `signature de début introuvable : ${startPattern}`);
  const start = startMatch.index;
  const endIdx = SERVER_SOURCE.indexOf(endMarker, start + startMatch[0].length);
  assert.ok(endIdx > start, `marqueur de fin introuvable après ${startPattern} : ${endMarker}`);
  return SERVER_SOURCE.slice(start, endIdx);
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// ── _callOpenAI : support générique de opts.generationId ──────────────────

test("_callOpenAI lit opts.generationId et le transmet aux 3 recordAiUsage (échec réseau, échec HTTP, succès)", () => {
  const fn = sliceBetween(/async function _callOpenAI\(apiKey, messages, opts = \{\}\) \{/, "// Import de connaissances par photo");
  assert.match(fn, /const generationId = opts\.generationId \|\| null;/);
  assert.equal(countOccurrences(fn, "recordAiUsage(supabase, { feature, model, generationId"), 3);
});

// ── qualityControlRawQuestions : critique sémantique + régénération ciblée ─

test("D — qualityControlRawQuestions accepte generationId et le transmet au critique sémantique (question_semantic_review) ET à la régénération ciblée (question_targeted_regeneration)", () => {
  const fn = sliceBetween(/async function qualityControlRawQuestions\(\{/, "\n// QCM d'une seule notion");
  assert.match(fn, /generationId\s*\n\}\) \{/, "generationId doit être un paramètre déstructuré de qualityControlRawQuestions");
  assert.match(fn, /feature: "question_semantic_review",\s*\n\s*generationId\s*\n\s*\}\);/);
  assert.match(fn, /feature: "question_targeted_regeneration",\s*\n\s*generationId\s*\n\s*\}\);/);
});

// ── generateNotionLevelQuiz : fiche, vérification, génération, critique ───

test("B — generateNotionLevelQuiz transmet generationId: id à la fiche (knowledge_generation), à la vérification (knowledge_verification), à la génération de questions (question_generation) et à qualityControlRawQuestions", () => {
  // classificationContext = null (V1 latence, 02/09/2026, cf. audit
  // read-only) : 8e paramètre optionnel ajouté pour lancer la classification
  // taxonomy en parallèle du pipeline qualité — ne change rien à
  // l'instrumentation generationId vérifiée ici.
  const fn = sliceBetween(/async function generateNotionLevelQuiz\(apiKey, subject, contextHint, id, levelConfig, requireValidation, requestedLevel, classificationContext = null\) \{/, "\nasync function buildNotionQuestions(");
  assert.match(fn, /feature: "knowledge_generation",\s*\n\s*generationId: id\s*\n\s*\}\);/);
  assert.match(fn, /feature: "knowledge_verification",\s*\n\s*generationId: id/);
  assert.match(fn, /feature: "question_generation",\s*\n\s*generationId: id\s*\n\s*\}\);/);
  assert.match(fn, /metricsSink: \(metrics\) => \{ questionQualityMetrics = metrics; \},\s*\n\s*generationId: id\s*\n\s*\}\);/);
});

test("H — generateNotionLevelQuiz contient toujours exactement 3 appels _callOpenAI (fiche, vérification, génération) — aucun appel IA ajouté par l'instrumentation", () => {
  // classificationContext = null (V1 latence, 02/09/2026, cf. audit
  // read-only) : 8e paramètre optionnel ajouté pour lancer la classification
  // taxonomy en parallèle du pipeline qualité — ne change rien à
  // l'instrumentation generationId vérifiée ici.
  const fn = sliceBetween(/async function generateNotionLevelQuiz\(apiKey, subject, contextHint, id, levelConfig, requireValidation, requestedLevel, classificationContext = null\) \{/, "\nasync function buildNotionQuestions(");
  assert.equal(countOccurrences(fn, "await _callOpenAI(apiKey,"), 3, "fiche + vérification + génération, jamais plus");
});

// ── V1 latence (02/09/2026, cf. audit read-only) : classification taxonomy
// lancée en parallèle, jamais un appel IA de plus, jamais dupliquée ────────

test("V1 latence — generateNotionLevelQuiz lance classifyCultureGeneraleKnowledgePlacementWithAI EXACTEMENT une fois, uniquement si classificationContext est fourni, jamais dans le compteur _callOpenAI (H)", () => {
  const fn = sliceBetween(/async function generateNotionLevelQuiz\(apiKey, subject, contextHint, id, levelConfig, requireValidation, requestedLevel, classificationContext = null\) \{/, "\nasync function buildNotionQuestions(");
  assert.equal(countOccurrences(fn, "classifyCultureGeneraleKnowledgePlacementWithAI("), 1, "un seul site d'appel dans generateNotionLevelQuiz");
  assert.match(fn, /if \(classificationContext\) \{[\s\S]{0,400}?sourcePlacementPromise = classifyCultureGeneraleKnowledgePlacementWithAI\(\s*\n\s*classificationContext\.sourceType, sourceName, sourceDetail, classificationContext\.userId, id\s*\n\s*\)/);
  // Ce call n'est pas fait via _callOpenAI (une fonction distincte, qui fait
  // elle-même son propre appel IA) : le compteur "H" ci-dessus (exactement 3)
  // reste donc valide sans qu'il faille l'incrémenter.
  assert.doesNotMatch(fn, /await _callOpenAI\(apiKey,[\s\S]{0,100}classifyCultureGeneraleKnowledgePlacementWithAI/);
});

test("V1 latence — la classification est lancée AVANT question_generation (dès sourceName/sourceDetail figés), jamais après", () => {
  const fn = sliceBetween(/async function generateNotionLevelQuiz\(apiKey, subject, contextHint, id, levelConfig, requireValidation, requestedLevel, classificationContext = null\) \{/, "\nasync function buildNotionQuestions(");
  const classificationIndex = fn.indexOf("sourcePlacementPromise = classifyCultureGeneraleKnowledgePlacementWithAI(");
  const questionGenerationIndex = fn.indexOf('feature: "question_generation",');
  assert.ok(classificationIndex > 0, "la classification doit être lancée dans generateNotionLevelQuiz");
  assert.ok(questionGenerationIndex > classificationIndex, "la classification doit démarrer AVANT l'appel question_generation, pour tourner en parallèle du pipeline qualité");
});

test("V1 latence — sourcePlacementPromise n'est jamais awaitée dans generateNotionLevelQuiz lui-même (seul l'appelant l'attend, au moment où il en a besoin)", () => {
  const fn = sliceBetween(/async function generateNotionLevelQuiz\(apiKey, subject, contextHint, id, levelConfig, requireValidation, requestedLevel, classificationContext = null\) \{/, "\nasync function buildNotionQuestions(");
  assert.doesNotMatch(fn, /await sourcePlacementPromise/);
  assert.match(fn, /return \{ sourceName, sourceDetail, validated, sourcePlacementPromise \};/);
});

// ── resolveWebSearchGrounding / expandWebSearchGroundingSources : sélection
// de sources (initiale et expansion V3.2) ──────────────────────────────────

test("sélection de sources — resolveWebSearchGrounding transmet generationId: id (feature web_search_source_selection)", () => {
  const fn = sliceBetween(/async function resolveWebSearchGrounding\(apiKey, subject, id\) \{/, "\nasync function expandWebSearchGroundingSources(");
  assert.match(fn, /feature: "web_search_source_selection",\s*\n\s*generationId: id\s*\n\s*\}\);/);
});

test("E — expandWebSearchGroundingSources (expansion V3.2) transmet generationId: id (feature web_search_source_selection_expansion)", () => {
  const fn = sliceBetween(/async function expandWebSearchGroundingSources\(apiKey, subject, id, topicContext, existingDomains, documentaryReasonCodes\) \{/, "\nasync function expandGroundingAndRegenerateMissingQuestions(");
  assert.match(fn, /feature: "web_search_source_selection_expansion",\s*\n\s*generationId: id\s*\n\s*\}\);/);
});

test("E — expandGroundingAndRegenerateMissingQuestions (expansion V3.2) transmet generationId: id à la génération (question_generation_source_expansion) ET à qualityControlRawQuestions", () => {
  const fn = sliceBetween(/async function expandGroundingAndRegenerateMissingQuestions\(\{ apiKey, subject, id, instruction, timeoutMs, grounding, accepted, validated, questionQualityMetrics \}\) \{/, "\n// ── Orchestration complète du sujet libre");
  assert.match(fn, /feature: "question_generation_source_expansion",\s*\n\s*generationId: id\s*\n\s*\}\);/);
  assert.match(fn, /metricsSink: \(metrics\) => \{ expansionMetrics = metrics; \},\s*\n\s*generationId: id\s*\n\s*\}\);/);
});

// ── buildNotionQuestions, branche sans niveau (Éclairages / Ce jour dans
// l'Histoire) : admission + génération partagent le même id ───────────────

test("buildNotionQuestions (branche sans niveau) transmet generationId: id à l'admission (knowledge_generation), à la génération (question_generation) et à qualityControlRawQuestions", () => {
  const fn = sliceBetween(/async function buildNotionQuestions\(sourceType, sourceId, rawItem, rawLevel, userId\) \{/, "filterQuestionsToAdmittedKnowledge (demande du 17/08/2026) : garde-fou");
  assert.match(fn, /feature: "knowledge_generation",\s*\n\s*generationId: id\s*\n\s*\}\),/, "admission (Promise.all)");
  assert.match(fn, /feature: "question_generation",\s*\n\s*generationId: id\s*\n\s*\}\);/, "génération");
  assert.match(fn, /sourceExcerptFor: \(_sourceId, question\) => String\(question\?\.knowledgeTarget \|\| ""\)\.slice\(0, 1200\)\s*\n\s*\},\s*\n\s*generationId: id\s*\n\s*\}\);/, "qualityControlRawQuestions");
});

test("H — buildNotionQuestions (branche sans niveau) contient toujours exactement 2 appels _callOpenAI (admission, génération)", () => {
  const fn = sliceBetween(/async function buildNotionQuestions\(sourceType, sourceId, rawItem, rawLevel, userId\) \{/, "filterQuestionsToAdmittedKnowledge (demande du 17/08/2026) : garde-fou");
  assert.equal(countOccurrences(fn, "_callOpenAI(apiKey, [{ role: \"user\""), 2, "admission + génération, jamais plus");
});

// ── Classification Galaxy/Solar/Étoile : autre étape IA de la génération ──

test("classifyCultureGeneraleKnowledgePlacementWithAI transmet sourceDebateId comme generationId à matchCultureGeneraleGalaxyAndSolarWithAI", () => {
  assert.match(SERVER_SOURCE, /const match = await matchCultureGeneraleGalaxyAndSolarWithAI\(sourceType, sourceName, sourceDetail, userSolars, sourceDebateId\);/);
});

test("le fallback de classification à l'acquisition (hors génération) n'envoie PAS de generationId — comportement inchangé, ce n'est pas la même étape", () => {
  assert.match(SERVER_SOURCE, /const match = await matchCultureGeneraleGalaxyAndSolarWithAI\(sourceType, sourceName, question\.sourceDetail, userSolarsForFallback\);/);
});

test("matchCultureGeneraleGalaxyAndSolarWithAI accepte generationId et le transmet à fetchGpt5JsonContentWithRetry et aux 2 recordAiUsage du chemin non-gpt-5", () => {
  const fn = sliceBetween(/async function matchCultureGeneraleGalaxyAndSolarWithAI\(sourceType, sourceName, sourceDetail, userSolars, generationId = null\) \{/, "\nasync function resolveOrCreateCultureGeneraleNotionLink(");
  assert.match(fn, /feature: "knowledge_classification", generationId \}\);/, "fetchGpt5JsonContentWithRetry");
  assert.equal(countOccurrences(fn, "recordAiUsage(supabase, { feature: \"knowledge_classification\", model: OPINION_ARTICLE_CATEGORY_MODEL, generationId"), 2);
});

test("fetchGpt5JsonContentWithRetry accepte generationId et le transmet aux 2 recordAiUsage (échec, succès)", () => {
  const fn = sliceBetween(/async function fetchGpt5JsonContentWithRetry\(apiKey, model, prompt, logPrefix, \{ reasoningEffort = "low", initialBudget = 1200, feature = null, generationId = null \} = \{\}\) \{/, "\nfunction findKnowledgeGalaxyDefinition(");
  assert.equal(countOccurrences(fn, "recordAiUsage(supabase, { feature, model, generationId"), 2);
});
