"use strict";

// Verrous de câblage V4.1 (demande du 01/09/2026 — "mutualisation
// inter-niveaux du master QCM") : server.js ne peut pas être `require()` en
// test (il démarre tout le serveur Express à l'import) — ce fichier vérifie
// donc, en lisant server.js comme un TEXTE brut (jamais exécuté), que le
// câblage attendu est bien en place, même principe que
// test/notion-quiz-master-wiring.test.js (V4.0) et test/qcm-quality-wiring.test.js.
// isMasterEligibleQuiz elle-même est testée unitairement, en isolation, dans
// test/question-formats.test.js — ce fichier verrouille uniquement le
// BRANCHEMENT dans server.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

// ── Identité de master : slot nu, indépendant du niveau ────────────────────

test("buildCustomTopicMasterSlot construit un slot nu (notion:custom:{id}), sans suffixe de niveau", () => {
  assert.match(SERVER_SOURCE, /function buildCustomTopicMasterSlot\(id\) \{\s*\n\s*return `notion:custom:\$\{id\}`;\s*\n\}/);
});

test("buildNotionMasterSlot construit un slot nu (notion:{sourceType}:{sourceDebateId}), sans suffixe de niveau", () => {
  assert.match(SERVER_SOURCE, /function buildNotionMasterSlot\(sourceType, sourceDebateId\) \{\s*\n\s*return `notion:\$\{sourceType\}:\$\{sourceDebateId\}`;\s*\n\}/);
});

// ── Recherche d'un master déjà généré, tous formats de slot confondus ──────

test("findExistingQuizMaster filtre les candidats par isMasterEligibleQuiz (jamais un simple exact-match aveugle)", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function findExistingQuizMaster(candidateSlots) {");
  assert.ok(fnIndex > 0);
  const fnBody = SERVER_SOURCE.slice(fnIndex, fnIndex + 800);
  assert.match(fnBody, /\.in\("slot", candidateSlots\)/, "doit chercher parmi TOUS les slots candidats (nu + legacy suffixés), pas un seul");
  // Lecture en 2 temps depuis l'audit egress du 01/09/2026 (cf.
  // test/daily-quiz-egress-v1.test.js) : `questions` n'est plus dans le
  // select initial, l'éligibilité est vérifiée sur la relecture ciblée
  // (fullRow) — même garde-fou qu'avant, jamais un simple exact-match aveugle.
  assert.match(fnBody, /if \(isMasterEligibleQuiz\(fullRow\?\.questions\)\)/, "un candidat trouvé ne doit être retenu comme master que s'il porte pedagogicalRank");
});

test("POST /api/users/notion-quizzes/custom interroge findExistingQuizMaster avec le slot nu ET les 3 slots legacy suffixés, avant toute autre réutilisation", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom"');
  const callIndex = SERVER_SOURCE.indexOf("const existingMaster = await findExistingQuizMaster([", routeIndex);
  const masterSlotIndex = SERVER_SOURCE.indexOf("masterSlot,", routeIndex);
  const legacySlotsIndex = SERVER_SOURCE.indexOf('...Object.keys(NOTION_QUIZ_LEVELS).map((lvl) => `notion:custom:${id}:${lvl}`)', routeIndex);
  assert.ok(routeIndex > 0 && callIndex > routeIndex, "la route doit chercher un master existant en tout premier");
  assert.ok(masterSlotIndex > routeIndex && masterSlotIndex < callIndex + 200);
  assert.ok(legacySlotsIndex > callIndex, "doit couvrir aussi les 3 niveaux legacy (masters V4.0 encore suffixés)");
});

test("POST /api/users/notion-quizzes (notion de débat) interroge findExistingQuizMaster avec le slot nu ET les 3 slots legacy suffixés", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes",');
  const callIndex = SERVER_SOURCE.indexOf("const existingMaster = await findExistingQuizMaster([", routeIndex);
  const legacySlotsIndex = SERVER_SOURCE.indexOf('...Object.keys(NOTION_QUIZ_LEVELS).map((lvl) => `notion:${sourceType}:${sourceDebateId}:${lvl}`)', routeIndex);
  assert.ok(routeIndex > 0 && callIndex > routeIndex);
  assert.ok(legacySlotsIndex > callIndex);
});

// ── Priorité de réutilisation : un master (n'importe quel niveau) avant la
// recherche exacte historique au même niveau, elle-même avant la génération. ─

test("POST /custom : l'ordre est master (tout niveau) -> exact même niveau (legacy) -> fuzzy -> génération verrouillée", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom"');
  const masterIndex = SERVER_SOURCE.indexOf("const existingMaster = await findExistingQuizMaster(", routeIndex);
  const exactLegacyIndex = SERVER_SOURCE.indexOf('.eq("slot", slot)', routeIndex);
  const fuzzyIndex = SERVER_SOURCE.indexOf("const equivalent = await findEquivalentGeneratedCustomTopic(topic, level);", routeIndex);
  const generationIndex = SERVER_SOURCE.indexOf("const result = await ensureCustomTopicMasterGenerated(masterSlot, topic, id, level, user.id);", routeIndex);
  assert.ok(routeIndex > 0);
  assert.ok(masterIndex > routeIndex && exactLegacyIndex > masterIndex && fuzzyIndex > exactLegacyIndex && generationIndex > fuzzyIndex);
});

// ── Dedup fuzzy (niveau 2) : priorité aux masters tout niveau, repli legacy
// même niveau strictement inchangé. ─────────────────────────────────────────

test("findEquivalentGeneratedCustomTopic distingue candidats master (tout niveau) et legacy (même niveau uniquement), jamais mélangés", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function findEquivalentGeneratedCustomTopic(topic, level) {");
  assert.ok(fnIndex > 0);
  const fnBody = SERVER_SOURCE.slice(fnIndex, fnIndex + 1800);
  assert.match(fnBody, /if \(isMasterEligibleQuiz\(row\.questions\)\) \{\s*\n\s*masterCandidates\.push\(candidate\);\s*\n\s*\} else if \(parseCustomTopicSlotLevel\(row\.slot\) === level\) \{\s*\n\s*legacyCandidates\.push\(candidate\);/);
  assert.match(fnBody, /return findEquivalentCustomTopic\(topic, masterCandidates\) \|\| findEquivalentCustomTopic\(topic, legacyCandidates\);/);
});

// ── Verrou de génération en mémoire, keyed par identité de master ──────────

test("_notionQuizMasterGenerationPromises est une Map partagée, même principe que _cultureGeneraleComprehensionGenerationPromises", () => {
  assert.match(SERVER_SOURCE, /const _notionQuizMasterGenerationPromises = new Map\(\);/);
});

test("ensureCustomTopicMasterGenerated : verrou get/set/finally-delete keyed par masterSlot", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function ensureCustomTopicMasterGenerated(masterSlot, topic, id, level, userId) {");
  assert.ok(fnIndex > 0);
  const fnBody = SERVER_SOURCE.slice(fnIndex, fnIndex + 2000);
  assert.match(fnBody, /const pending = _notionQuizMasterGenerationPromises\.get\(masterSlot\);\s*\n\s*if \(pending\) return pending;/);
  assert.match(fnBody, /_notionQuizMasterGenerationPromises\.set\(masterSlot, generation\);/);
  assert.match(fnBody, /finally \{\s*\n\s*if \(_notionQuizMasterGenerationPromises\.get\(masterSlot\) === generation\) \{\s*\n\s*_notionQuizMasterGenerationPromises\.delete\(masterSlot\);/, "le verrou doit être libéré même en cas d'erreur (finally), jamais laissé bloqué");
});

test("ensureNotionMasterGenerated : verrou get/set/finally-delete keyed par masterSlot", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function ensureNotionMasterGenerated(masterSlot, sourceType, sourceDebateId, item, level, userId) {");
  assert.ok(fnIndex > 0);
  const fnBody = SERVER_SOURCE.slice(fnIndex, fnIndex + 1600);
  assert.match(fnBody, /const pending = _notionQuizMasterGenerationPromises\.get\(masterSlot\);\s*\n\s*if \(pending\) return pending;/);
  assert.match(fnBody, /finally \{\s*\n\s*if \(_notionQuizMasterGenerationPromises\.get\(masterSlot\) === generation\) \{\s*\n\s*_notionQuizMasterGenerationPromises\.delete\(masterSlot\);/);
});

test("ensureCustomTopicMasterGenerated et ensureNotionMasterGenerated gèrent la course inter-processus (code 23505) en relisant la ligne gagnante", () => {
  const customIndex = SERVER_SOURCE.indexOf("async function ensureCustomTopicMasterGenerated(masterSlot, topic, id, level, userId) {");
  const notionIndex = SERVER_SOURCE.indexOf("async function ensureNotionMasterGenerated(masterSlot, sourceType, sourceDebateId, item, level, userId) {");
  const customBody = SERVER_SOURCE.slice(customIndex, customIndex + 2000);
  const notionBody = SERVER_SOURCE.slice(notionIndex, notionIndex + 1600);
  assert.match(customBody, /insertError\.code !== "23505"/);
  assert.match(notionBody, /insertError\.code !== "23505"/);
});

// ── Cache de service : la clé DOIT inclure le niveau demandé (V4.1) ────────

test("getDailyQuizQuestions accepte requestedLevel en 4e paramètre et l'inclut (via effectiveRequestedLevel, V4.1.1) dans la clé de cache", () => {
  assert.match(SERVER_SOURCE, /async function getDailyQuizQuestions\(quizDate, slot, voterKey, requestedLevel\) \{/);
  assert.match(SERVER_SOURCE, /const cacheKey = `\$\{quizDate\}:\$\{slot\}:\$\{effectiveRequestedLevel \|\| ""\}`;/);
});

// ── Threading de requestedLevel : additif, jamais une régression pour un
// appelant qui ne le fournit pas encore (repli sur le comportement V4.0). ──

test("GET /today, GET /results, POST /answer, POST /practice-answer résolvent requestedLevel via resolveNotionQuizLevel avant d'appeler getDailyQuizQuestions", () => {
  const routes = [
    { marker: 'app.get("/api/daily-quiz/today"', paramSource: "req.query.level" },
    { marker: 'app.get("/api/daily-quiz/results"', paramSource: "req.query.level" },
    { marker: 'app.post("/api/daily-quiz/answer"', paramSource: "req.body?.level" },
    { marker: 'app.post("/api/daily-quiz/practice-answer"', paramSource: "req.body?.level" }
  ];
  for (const { marker, paramSource } of routes) {
    const routeIndex = SERVER_SOURCE.indexOf(marker);
    assert.ok(routeIndex > 0, `route introuvable : ${marker}`);
    const resolveIndex = SERVER_SOURCE.indexOf(`const requestedLevel = resolveNotionQuizLevel(${paramSource}).level;`, routeIndex);
    const callIndex = SERVER_SOURCE.indexOf("getDailyQuizQuestions(", routeIndex);
    assert.ok(resolveIndex > routeIndex, `requestedLevel non résolu dans ${marker}`);
    assert.ok(callIndex > resolveIndex, `getDailyQuizQuestions doit être appelé après avoir résolu requestedLevel dans ${marker}`);
  }
});

test("GET /api/users/notion-quizzes/fiche résout requestedLevel (query &level=) et l'applique via effectiveLevel (V4.1.1 : persistedLevel prime), avec repli sur questions[0].level", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/fiche"');
  assert.ok(routeIndex > 0);
  const resolveIndex = SERVER_SOURCE.indexOf("const requestedLevel = resolveNotionQuizLevel(req.query.level).level;", routeIndex);
  const effectiveIndex = SERVER_SOURCE.indexOf("const effectiveLevel = persistedLevel || requestedLevel || questions[0]?.level || null;", routeIndex);
  const selectIndex = SERVER_SOURCE.indexOf("questions = selectQuestionsForRequestedLevel(levelCeiledQuestions, NOTION_QUIZ_LEVELS[effectiveLevel]?.target);", routeIndex);
  assert.ok(resolveIndex > routeIndex && effectiveIndex > resolveIndex && selectIndex > effectiveIndex);
});

// ── Non-régression explicite : jamais d'assouplissement de la logique cœur
// de dédup, jamais de niveau 1 exact-match legacy supprimé. ────────────────

test("isSafeTopicEquivalent/findEquivalentCustomTopic (lib/topic-dedup.js) ne sont jamais modifiées par V4.1 — seul le filtrage côté server.js change", () => {
  const libSource = fs.readFileSync(path.join(__dirname, "../lib/topic-dedup.js"), "utf8");
  assert.match(libSource, /const MIN_JACCARD_SCORE = 0\.75;/);
  assert.match(libSource, /const MAX_EXTRA_CONTENT_TOKENS = 1;/);
  assert.match(libSource, /function findEquivalentCustomTopic\(topic, candidates\) \{/);
});

test("la recherche exacte historique au même niveau (POST /custom, comportement V4.0) reste présente telle quelle, comme repli avant la génération", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom"');
  const exactIndex = SERVER_SOURCE.indexOf(
    '.from("daily_quiz")\n        .select("quiz_date, questions, progressive_status")\n        .eq("slot", slot)\n        .order("quiz_date", { ascending: false })\n        .limit(1);',
    routeIndex
  );
  assert.ok(exactIndex > routeIndex, "la recherche exacte au même niveau (legacy) doit rester un repli, jamais supprimée");
});
