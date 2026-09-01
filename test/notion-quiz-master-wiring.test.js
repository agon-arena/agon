"use strict";

// Verrous de câblage (V4.0, demande du 01/09/2026 — "corpus maître de 20
// questions, découplage generationDepth/requestedLevel") — server.js ne
// peut pas être `require()` dans un test (il démarre tout le serveur
// Express à l'import, cf. commentaire en tête de lib/question-formats.js) :
// ce fichier vérifie donc, en lisant server.js comme un TEXTE brut (jamais
// exécuté), que le câblage attendu est bien en place — même principe que
// test/qcm-quality-wiring.test.js et test/knowledge-admission-wiring.test.js.
// La logique elle-même (rankAdmittedKnowledge/attachPedagogicalRanks/
// selectQuestionsForRequestedLevel) est testée unitairement, en isolation,
// dans test/question-formats.test.js — ce fichier verrouille uniquement le
// BRANCHEMENT dans server.js, jamais un doublon de ces tests-là.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

// ── §A de la demande : generationDepth ≠ requestedLevel ───────────────────

test("MASTER_GENERATION_DEPTH_CONFIG est un alias direct de NOTION_QUIZ_LEVELS.expert (jamais une config dupliquée)", () => {
  assert.match(SERVER_SOURCE, /const MASTER_GENERATION_DEPTH_CONFIG = NOTION_QUIZ_LEVELS\.expert;/);
});

test("buildNotionQuestions (branche niveau) passe generationDepthConfig, jamais levelConfig directement, à generateNotionLevelQuiz — et transmet `level` en 7e argument", () => {
  assert.match(
    SERVER_SOURCE,
    /const generationDepthConfig = NOTION_QUIZ_LEVELS\[level\] \? MASTER_GENERATION_DEPTH_CONFIG : levelConfig;\s*\n\s*const result = await generateNotionLevelQuiz\(apiKey, subject, contextHint, id, generationDepthConfig, false, level\);/
  );
});

test("buildCustomTopicQuiz passe generationDepthConfig, jamais levelConfig directement, à generateNotionLevelQuiz — et transmet `level` en 7e argument", () => {
  assert.match(
    SERVER_SOURCE,
    /const generationDepthConfig = NOTION_QUIZ_LEVELS\[level\] \? MASTER_GENERATION_DEPTH_CONFIG : levelConfig;\s*\n\s*const result = await generateNotionLevelQuiz\(apiKey, topic, null, id, generationDepthConfig, true, level\);/
  );
});

test("generateNotionLevelQuiz accepte requestedLevel en 7e paramètre", () => {
  assert.match(SERVER_SOURCE, /async function generateNotionLevelQuiz\(apiKey, subject, contextHint, id, levelConfig, requireValidation, requestedLevel\)/);
});

// ── §6 de la demande : questionsRequested reste accepted.length, JAMAIS
// masterTarget/20 — verrou explicite contre la régression la plus probable. ─

test("questionsRequested transmis aux métriques de grounding reste accepted.length, jamais target/20", () => {
  assert.match(SERVER_SOURCE, /questionsRequested: accepted\.length,/);
  // Ancrage négatif : aucune occurrence de "questionsRequested: target" ou
  // "questionsRequested: 20" ne doit jamais apparaître dans le fichier.
  assert.doesNotMatch(SERVER_SOURCE, /questionsRequested:\s*target/);
  assert.doesNotMatch(SERVER_SOURCE, /questionsRequested:\s*20/);
});

// ── §4 de la demande : pedagogicalRank calculé une fois, attaché en aval de
// toute régénération/expansion, jamais recalculé de la position. ──────────

test("rankAdmittedKnowledge est appelé sur `accepted` avant la boucle de génération de questions (jamais recalculé après)", () => {
  const rankIndex = SERVER_SOURCE.indexOf("const rankedKnowledge = rankAdmittedKnowledge(accepted);");
  const loopIndex = SERVER_SOURCE.indexOf("const questionAttempts = 1;");
  assert.ok(rankIndex > 0, "rankAdmittedKnowledge doit être appelé dans generateNotionLevelQuiz");
  assert.ok(loopIndex > rankIndex, "le classement doit être calculé AVANT la boucle de génération/régénération/expansion");
});

test("attachPedagogicalRanks est appelé juste avant le retour final de generateNotionLevelQuiz (en aval de toute régénération/expansion V3.2)", () => {
  const attachIndex = SERVER_SOURCE.indexOf("validated = attachPedagogicalRanks(validated, rankedKnowledge);");
  const returnIndex = SERVER_SOURCE.indexOf("return { sourceName, sourceDetail, validated };");
  assert.ok(attachIndex > 0, "attachPedagogicalRanks doit être appelé dans generateNotionLevelQuiz");
  assert.ok(returnIndex > attachIndex, "le retour final doit suivre l'attachement des rangs");
  assert.ok(returnIndex - attachIndex < 400, "l'attachement doit se faire juste avant le retour, sans logique intermédiaire qui pourrait rejouer/réordonner `validated`");
});

// ── §8/§10/§11/§13 de la demande : serving par niveau appliqué à tous les
// points de lecture/écriture concernés, jamais au stockage lui-même. ──────

test("getDailyQuizQuestions applique selectQuestionsForRequestedLevel avant la mise en cache/le retour (V4.1.1 : effectiveRequestedLevel = persistedLevel || requestedLevel || rawQuestions[0].level)", () => {
  assert.match(SERVER_SOURCE, /const baseQuestions = selectQuestionsForRequestedLevel\(rawQuestions, NOTION_QUIZ_LEVELS\[effectiveRequestedLevel \|\| rawQuestions\[0\]\?\.level\]\?\.target\);/);
});

test("GET /api/users/notion-quizzes/fiche applique selectQuestionsForRequestedLevel avant questionCount/first", () => {
  const ficheRouteIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/fiche"');
  const selectIndex = SERVER_SOURCE.indexOf("questions = selectQuestionsForRequestedLevel(questions, NOTION_QUIZ_LEVELS[effectiveLevel]?.target);", ficheRouteIndex);
  const firstIndex = SERVER_SOURCE.indexOf("const first = questions[0];", ficheRouteIndex);
  assert.ok(ficheRouteIndex > 0);
  assert.ok(selectIndex > ficheRouteIndex, "le filtrage doit être appliqué dans la route fiche");
  assert.ok(firstIndex > selectIndex, "`first`/questionCount doivent être dérivés APRÈS le filtrage, jamais avant");
});

test("GET /api/users/notion-quizzes (progression) applique selectQuestionsForRequestedLevel (V4.1.1 : effectiveLevel = persistedLevel || rawQuestions[0].level) avant tous les calculs de progression", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes"');
  const selectIndex = SERVER_SOURCE.indexOf("const questions = selectQuestionsForRequestedLevel(rawQuestions, NOTION_QUIZ_LEVELS[effectiveLevel]?.target);", routeIndex);
  const denominatorIndex = SERVER_SOURCE.indexOf("let progressDenominator = 0;", routeIndex);
  assert.ok(routeIndex > 0);
  assert.ok(selectIndex > routeIndex, "le filtrage doit être appliqué dans la route de progression");
  assert.ok(denominatorIndex > selectIndex, "progressDenominator doit être calculé sur le sous-ensemble servi, jamais le master complet");
});

test("POST /api/users/notion-quizzes/custom applique selectQuestionsForRequestedLevel APRÈS la résolution (réutilisation ou génération via ensureCustomTopicMasterGenerated, le stockage garde toujours le master complet) et AVANT la réponse HTTP + triggerAutomaticNoesVideo", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom"');
  const generationCallIndex = SERVER_SOURCE.indexOf("await ensureCustomTopicMasterGenerated(masterSlot, topic, id, level, user.id);", routeIndex);
  const selectIndex = SERVER_SOURCE.indexOf("questions = selectQuestionsForRequestedLevel(questions, NOTION_QUIZ_LEVELS[level]?.target);", routeIndex);
  const responseIndex = SERVER_SOURCE.indexOf("res.json({ ok: true, slot: effectiveSlot, quizDate, label: questions[0]?.sourceName || null, questionCount: questions.length, reused });", routeIndex);
  const noesIndex = SERVER_SOURCE.indexOf("triggerAutomaticNoesVideo({ userId: user.id, slot: effectiveSlot, quizDate, questions });", routeIndex);
  assert.ok(routeIndex > 0 && generationCallIndex > routeIndex && selectIndex > generationCallIndex, "le filtrage doit intervenir après la résolution (réutilisation ou génération) du master complet");
  assert.ok(responseIndex > selectIndex, "la réponse HTTP doit refléter le sous-ensemble servi");
  assert.ok(noesIndex > selectIndex, "Noès ne doit recevoir que le sous-ensemble servi, jamais le master complet (section 13 de la demande)");
});

// V4.1 : le stockage du master complet a été déplacé DANS
// ensureCustomTopicMasterGenerated/ensureNotionMasterGenerated (verrouillées
// par identité de master) — jamais réinséré ailleurs dans la route elle-même.
test("l'insertion daily_quiz du master complet vit dans ensureCustomTopicMasterGenerated/ensureNotionMasterGenerated, jamais réinséré directement dans les routes POST", () => {
  const ensureCustomIndex = SERVER_SOURCE.indexOf("async function ensureCustomTopicMasterGenerated(masterSlot, topic, id, level, userId) {");
  const ensureNotionIndex = SERVER_SOURCE.indexOf("async function ensureNotionMasterGenerated(masterSlot, sourceType, sourceDebateId, item, level, userId) {");
  assert.ok(ensureCustomIndex > 0 && ensureNotionIndex > 0);
  const customRouteIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom"');
  const nextRouteIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/explore"', customRouteIndex);
  const customRouteBody = SERVER_SOURCE.slice(customRouteIndex, nextRouteIndex > 0 ? nextRouteIndex : customRouteIndex + 6000);
  assert.doesNotMatch(customRouteBody, /\.from\("daily_quiz"\)\.insert\(\{/, "la route ne doit plus insérer elle-même — cf. ensureCustomTopicMasterGenerated");
});

test("POST /api/users/notion-quizzes (notion de débat) applique selectQuestionsForRequestedLevel avant la réponse HTTP", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes",');
  const selectIndex = SERVER_SOURCE.indexOf("questions = selectQuestionsForRequestedLevel(questions, NOTION_QUIZ_LEVELS[level]?.target);", routeIndex);
  const responseIndex = SERVER_SOURCE.indexOf('res.json({ ok: true, slot, quizDate, label: questions[0]?.sourceName || null, questionCount: questions.length });', routeIndex);
  assert.ok(routeIndex > 0 && selectIndex > routeIndex && responseIndex > selectIndex);
});

// ── §12 de la demande (FSRS) : aucun changement apporté à la logique FSRS
// elle-même — verrou de NON-MODIFICATION, pas une nouvelle fonctionnalité.
// Le diagnostic (audit du 01/09/2026) a confirmé que la création d'un état
// FSRS est strictement pilotée par un événement de réponse UNITAIRE
// (`questionId` isolé), jamais par la taille du tableau de questions stocké
// — donc un master de 20 dont seules 5 questions sont servies/répondues ne
// crée jamais d'état FSRS pour les 15 autres, AVANT comme APRÈS V4.0. Ce
// test verrouille que cette signature reste unitaire (si elle devenait un
// jour un tableau, ce serait le signe d'un risque de création en masse à
// réexaminer).

test("§12 FSRS : applyFsrsReviewForDailyQuizAnswer/upsertMemoryItemForNotionAnswer restent pilotées par un questionId UNITAIRE, jamais par un tableau de questions", () => {
  assert.match(SERVER_SOURCE, /async function applyFsrsReviewForDailyQuizAnswer\(\{ voterKey, slot, quizDate, questionId, isCorrect, difficulty \}\)/);
  assert.match(SERVER_SOURCE, /async function upsertMemoryItemForNotionAnswer\(\{ slot, quizDate, questionId \}\)/);
});

// ── Import requis ──────────────────────────────────────────────────────

test("les fonctions V4.0/V4.1 et le plancher master sont bien importés depuis lib/question-formats", () => {
  assert.match(SERVER_SOURCE, /rankAdmittedKnowledge,\s*\n\s*attachPedagogicalRanks,\s*\n\s*selectQuestionsForRequestedLevel,\s*\n\s*isMasterEligibleQuiz,\s*\n\s*MIN_MASTER_QUESTIONS\s*\n\}\s*=\s*require\("\.\/lib\/question-formats"\);/);
});
