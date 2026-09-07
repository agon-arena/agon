"use strict";

// Verrous de câblage — Phase 2.2 (04/09/2026, "une question ne doit jamais
// dépasser le niveau pédagogique visible", bug réel "Corpus juris civilis"
// servi en Élémentaire alors que sa knowledgeTarget n'apparaît que dans la
// continuation Approfondi/Expert). server.js ne peut pas être `require()` en
// test (il démarre tout le serveur Express à l'import) — ce fichier vérifie
// donc, en lisant server.js comme du TEXTE brut (jamais exécuté), que
// restrictQuestionsToProgressiveLevelCeiling est bien appliquée AVANT
// selectQuestionsForRequestedLevel sur les 6 points d'appel identifiés
// pendant le diagnostic, et que progressive_status est disponible à chacun
// d'eux (ajouté aux .select() existants, ou déjà présent). Le comportement
// réel de la fonction pure elle-même (filtrage par niveau, no-op legacy,
// repli question sans .level) est prouvé par test/question-formats.test.js —
// ce fichier verrouille uniquement le CÂBLAGE, jamais recouvert ailleurs.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

test("restrictQuestionsToProgressiveLevelCeiling est importée depuis lib/question-formats, juste après selectQuestionsForRequestedLevel", () => {
  assert.match(SERVER_SOURCE, /selectQuestionsForRequestedLevel,\s*\n\s*restrictQuestionsToProgressiveLevelCeiling,\s*\n\s*isMasterEligibleQuiz,/);
});

// ── Site 1/6 : getDailyQuizQuestions ───────────────────────────────────────

test("Site 1/6 — getDailyQuizQuestions sélectionne progressive_status et applique le plafond de niveau AVANT selectQuestionsForRequestedLevel", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function getDailyQuizQuestions(quizDate, slot, voterKey, requestedLevel) {");
  assert.ok(fnIndex > 0);
  const nextFnIndex = SERVER_SOURCE.indexOf("\nasync function ", fnIndex + 10);
  const fnBody = SERVER_SOURCE.slice(fnIndex, nextFnIndex > 0 ? nextFnIndex : fnIndex + 3000);
  assert.match(fnBody, /\.select\("questions, progressive_status"\)/);
  const ceilingIndex = fnBody.indexOf("const levelCeiledQuestions = restrictQuestionsToProgressiveLevelCeiling(rawQuestions, effectiveServingLevel, data?.progressive_status);");
  const selectQuestionsIndex = fnBody.indexOf("const baseQuestions = selectQuestionsForRequestedLevel(levelCeiledQuestions, NOTION_QUIZ_LEVELS[effectiveServingLevel]?.target);");
  assert.ok(ceilingIndex > 0, "le plafond doit être calculé dans getDailyQuizQuestions");
  assert.ok(selectQuestionsIndex > ceilingIndex, "selectQuestionsForRequestedLevel doit consommer levelCeiledQuestions, jamais rawQuestions directement");
});

// ── Site 2/6 : POST /api/users/notion-quizzes ──────────────────────────────

test("Site 2/6 — POST /api/users/notion-quizzes propage progressiveStatus depuis les 3 sources possibles (existingMaster, existingQuiz, legacy) et plafonne avant selectQuestionsForRequestedLevel", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes",');
  const nextRouteIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom"', routeIndex);
  assert.ok(routeIndex > 0 && nextRouteIndex > routeIndex);
  const routeBody = SERVER_SOURCE.slice(routeIndex, nextRouteIndex);
  assert.match(routeBody, /progressiveStatus = existingMaster\.progressiveStatus;/);
  assert.match(routeBody, /\.select\("quiz_date, questions, progressive_status"\)/);
  assert.match(routeBody, /progressiveStatus = existingQuiz\.progressive_status;/);
  const ceilingIndex = routeBody.indexOf("questions = restrictQuestionsToProgressiveLevelCeiling(questions, level, progressiveStatus);");
  const selectIndex = routeBody.indexOf("questions = selectQuestionsForRequestedLevel(questions, NOTION_QUIZ_LEVELS[level]?.target);");
  assert.ok(ceilingIndex > 0 && selectIndex > ceilingIndex, "le plafond doit précéder immédiatement le tranchage par rang+compte");
});

// ── Site 3/6 : POST /api/users/notion-quizzes/custom (legacy) ─────────────

test("Site 3/6 — POST /api/users/notion-quizzes/custom propage progressiveStatus depuis les 4 sources possibles (existingMaster, existingQuiz, equivalent, génération) et plafonne avant selectQuestionsForRequestedLevel", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom"');
  const nextRouteIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/explore"', routeIndex);
  assert.ok(routeIndex > 0 && nextRouteIndex > routeIndex);
  const routeBody = SERVER_SOURCE.slice(routeIndex, nextRouteIndex);
  assert.match(routeBody, /progressiveStatus = existingMaster\.progressiveStatus;/);
  assert.match(routeBody, /\.select\("quiz_date, questions, progressive_status"\)/);
  assert.match(routeBody, /progressiveStatus = existingQuiz\.progressive_status;/);
  assert.match(routeBody, /progressiveStatus = equivalent\.progressiveStatus;/);
  assert.match(routeBody, /progressiveStatus = result\.progressiveStatus;/);
  const ceilingIndex = routeBody.indexOf("questions = restrictQuestionsToProgressiveLevelCeiling(questions, level, progressiveStatus);");
  const selectIndex = routeBody.indexOf("questions = selectQuestionsForRequestedLevel(questions, NOTION_QUIZ_LEVELS[level]?.target);");
  assert.ok(ceilingIndex > 0 && selectIndex > ceilingIndex, "le plafond doit précéder immédiatement le tranchage par rang+compte");
});

test("findExistingQuizMaster et findEquivalentGeneratedCustomTopic renvoient progressiveStatus (colonne progressive_status sélectionnée)", () => {
  const findMasterIndex = SERVER_SOURCE.indexOf("async function findExistingQuizMaster(candidateSlots) {");
  assert.ok(findMasterIndex > 0);
  const findMasterBody = SERVER_SOURCE.slice(findMasterIndex, findMasterIndex + 1200);
  assert.match(findMasterBody, /\.select\("questions, progressive_status"\)/);
  assert.match(findMasterBody, /progressiveStatus: fullRow\.progressive_status/);

  const findEquivIndex = SERVER_SOURCE.indexOf("async function findEquivalentGeneratedCustomTopic(topic, level) {");
  assert.ok(findEquivIndex > 0);
  const findEquivBody = SERVER_SOURCE.slice(findEquivIndex, findEquivIndex + 1400);
  assert.match(findEquivBody, /\.select\("slot, quiz_date, questions, progressive_status"\)/);
  assert.match(findEquivBody, /progressiveStatus: row\.progressive_status,/);
});

// ── Site 4/6 : POST /api/users/notion-quizzes/custom/progressive ──────────

// Réécrit (Phase 3, 06/09/2026, "démarrage toujours Élémentaire") : le
// plafond porte désormais sur `userLevel` (niveau réellement servi à
// l'utilisateur, dérivé de sa progression), plus sur `requestedLevel` (le
// niveau cliqué, qui n'existe plus dans cette route) — même bug visé
// (continuation arrière-plan déjà avancée alors que le niveau servi reste
// en retard), même garde-fou.
test("Site 4/6 — POST /api/users/notion-quizzes/custom/progressive plafonne au userLevel AVANT de construire servedQuestions (couvre le cas exact du bug : continuation déjà avancée à Avancé/Expert, userLevel resté Élémentaire)", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom/progressive"');
  assert.ok(routeIndex > 0);
  const ceilingIndex = SERVER_SOURCE.indexOf("const levelCeiledQuestions = restrictQuestionsToProgressiveLevelCeiling(questions, userLevel, progressiveStatus);", routeIndex);
  const servedIndex = SERVER_SOURCE.indexOf("const servedQuestions = selectQuestionsForRequestedLevel(levelCeiledQuestions, NOTION_QUIZ_LEVELS[userLevel]?.target);", routeIndex);
  assert.ok(ceilingIndex > routeIndex, "le plafond doit être calculé dans cette route");
  assert.ok(servedIndex > ceilingIndex, "servedQuestions doit consommer levelCeiledQuestions, jamais questions directement");
});

// ── Site 5/6 : GET /api/users/notion-quizzes (liste/progression) ──────────

test("Site 5/6 — GET /api/users/notion-quizzes sélectionne progressive_status par ligne et plafonne chaque quiz avant selectQuestionsForRequestedLevel", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes"');
  assert.ok(routeIndex > 0);
  // Diagnostic de lenteur du 04/09/2026 (cf. data/migration-daily-quiz-question-summaries.sql) :
  // `questions` complet remplacé par la fonction résumé calculée côté base
  // (daily_quiz_question_summaries), progressive_status reste sélectionné
  // tel quel en colonne à plat.
  const selectIndex = SERVER_SOURCE.indexOf('.select("quiz_date, slot, progressive_status, summary:daily_quiz_question_summaries")', routeIndex);
  assert.ok(selectIndex > routeIndex, "progressive_status doit être sélectionné dans quizRowsPromise, questions remplacé par le résumé calculé");
  const mapIndex = SERVER_SOURCE.indexOf("const progressiveStatusByKey = new Map((quizRows || []).map((row) => [`${row.quiz_date}:${row.slot}`, row.progressive_status || null]));", routeIndex);
  assert.ok(mapIndex > selectIndex, "une map par clé quiz_date:slot doit indexer progressive_status, même principe que questionsByKey");
  const ceilingIndex = SERVER_SOURCE.indexOf("const levelCeiledQuestions = restrictQuestionsToProgressiveLevelCeiling(rawQuestions, effectiveLevel, progressiveStatusByKey.get(`${link.quiz_date}:${link.slot}`));", routeIndex);
  const selectQuestionsIndex = SERVER_SOURCE.indexOf("const questions = selectQuestionsForRequestedLevel(levelCeiledQuestions, NOTION_QUIZ_LEVELS[effectiveLevel]?.target);", routeIndex);
  assert.ok(ceilingIndex > mapIndex && selectQuestionsIndex > ceilingIndex, "le plafond doit précéder immédiatement le tranchage par rang+compte, dans la boucle par lien");
});

// ── Site 6/6 : GET /api/users/notion-quizzes/fiche ─────────────────────────

test("Site 6/6 — GET /api/users/notion-quizzes/fiche sélectionne progressive_status dans les DEUX branches (match par lien, slot+quizDate direct) et plafonne avant selectQuestionsForRequestedLevel", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/fiche"');
  assert.ok(routeIndex > 0);
  const nextRouteIndex = SERVER_SOURCE.indexOf("\napp.get(", routeIndex + 10);
  const routeBody = SERVER_SOURCE.slice(routeIndex, nextRouteIndex > 0 ? nextRouteIndex : routeIndex + 6000);
  assert.match(routeBody, /\.select\("questions, grounding_sources, progressive_status"\)\s*\n\s*\.eq\("slot", match\.slot\)/);
  assert.match(routeBody, /progressiveStatus = fullRow\?\.progressive_status \|\| null;/);
  assert.match(routeBody, /\.select\("questions, grounding_sources, progressive_status"\)\.eq\("quiz_date", quizDate\)/);
  assert.match(routeBody, /progressiveStatus = data\?\.progressive_status \|\| null;/);
  const ceilingIndex = routeBody.indexOf("const levelCeiledQuestions = restrictQuestionsToProgressiveLevelCeiling(questions, effectiveLevel, progressiveStatus);");
  const selectQuestionsIndex = routeBody.indexOf("questions = selectQuestionsForRequestedLevel(levelCeiledQuestions, NOTION_QUIZ_LEVELS[effectiveLevel]?.target);");
  assert.ok(ceilingIndex > 0 && selectQuestionsIndex > ceilingIndex, "le plafond doit précéder immédiatement le tranchage par rang+compte");
});

// ── Non-régression globale : aucun appel direct de
// selectQuestionsForRequestedLevel sur un tableau brut de questions
// progressif sans passer par le plafond en premier — les 6 sites
// identifiés pendant le diagnostic sont TOUS câblés, aucun oublié. ────────

test("les 6 points d'appel de selectQuestionsForRequestedLevel identifiés pendant le diagnostic ont chacun un appel de restrictQuestionsToProgressiveLevelCeiling qui les précède", () => {
  const ceilingCalls = [...SERVER_SOURCE.matchAll(/restrictQuestionsToProgressiveLevelCeiling\(/g)];
  // 6 sites + la définition elle-même dans lib/question-formats.js n'est pas
  // dans server.js (require seul) : exactement 6 appels attendus ici.
  assert.equal(ceilingCalls.length, 6, `attendu exactement 6 appels de restrictQuestionsToProgressiveLevelCeiling dans server.js (un par point d'appel), trouvé ${ceilingCalls.length}`);

  const selectCalls = [...SERVER_SOURCE.matchAll(/selectQuestionsForRequestedLevel\(/g)];
  assert.equal(selectCalls.length, 6, `attendu exactement 6 appels de selectQuestionsForRequestedLevel dans server.js, trouvé ${selectCalls.length}`);
});
