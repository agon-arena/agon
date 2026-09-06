"use strict";

// Verrous de câblage — correctif de lenteur "page Apprentissage" (04/09/2026,
// cf. data/migration-daily-quiz-question-summaries.sql). GET
// /api/users/notion-quizzes lisait `questions` COMPLET (options,
// explications, variantes, sourceDetail avec sections/highlights/image...)
// pour chaque QCM adopté, alors que la route n'utilise que 5 champs de la
// première question + {id, level, pedagogicalRank} par question. Mesuré :
// 330 Ko -> 17,5 Ko pour un utilisateur réel à 25 QCM adoptés, sortie HTTP
// finale byte-for-byte identique (vérifié par comparaison directe avant/
// après sur ce même utilisateur, cf. rapport). server.js ne peut pas être
// `require()` en test — ce fichier vérifie donc, en lisant server.js comme
// du TEXTE brut (jamais exécuté), que le câblage attendu est bien en place.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

test("GET /api/users/notion-quizzes sélectionne le résumé calculé (daily_quiz_question_summaries), jamais `questions` en entier", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes"');
  const nextRouteIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/fiche"', routeIndex);
  assert.ok(routeIndex > 0 && nextRouteIndex > routeIndex);
  const routeBody = SERVER_SOURCE.slice(routeIndex, nextRouteIndex);
  assert.match(routeBody, /\.select\("quiz_date, slot, progressive_status, summary:daily_quiz_question_summaries"\)/);
  assert.doesNotMatch(routeBody, /\.select\("quiz_date, slot, questions, progressive_status"\)/, "l'ancien select du questions complet ne doit plus exister sur cette route");
});

test("questionsByKey/quizMetaByKey sont dérivées de row.summary, jamais de row.questions", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes"');
  const nextRouteIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/fiche"', routeIndex);
  const routeBody = SERVER_SOURCE.slice(routeIndex, nextRouteIndex);
  assert.match(routeBody, /const questionsByKey = new Map\(\(quizRows \|\| \[\]\)\.map\(\(row\) => \[`\$\{row\.quiz_date\}:\$\{row\.slot\}`, row\.summary\?\.questions \|\| \[\]\]\)\);/);
  assert.match(routeBody, /const quizMetaByKey = new Map\(\(quizRows \|\| \[\]\)\.map\(\(row\) => \[`\$\{row\.quiz_date\}:\$\{row\.slot\}`, row\.summary \|\| \{\}\]\)\);/);
  assert.doesNotMatch(routeBody, /row\.questions \|\| \[\]/, "jamais un repli sur l'ancien row.questions");
});

test("la boucle par lien lit le nom/type/sourceDebateId/thème depuis quizMeta (résumé), plus depuis questions[0]", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes"');
  const nextRouteIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/fiche"', routeIndex);
  const routeBody = SERVER_SOURCE.slice(routeIndex, nextRouteIndex);
  assert.match(routeBody, /const quizMeta = quizMetaByKey\.get\(`\$\{link\.quiz_date\}:\$\{link\.slot\}`\) \|\| \{\};/);
  assert.match(routeBody, /durableAcquisBySourceId\.get\(String\(quizMeta\.sourceDebateId \|\| ""\)\)/);
  assert.match(routeBody, /getPrimaryNotionQuizTheme\(\{ sourcePlacement: \{ category: quizMeta\.sourcePlacementCategory \}, sourceThemes: quizMeta\.sourceThemes \}\)/);
  assert.match(routeBody, /label: quizMeta\.sourceName \|\| null,/);
  assert.match(routeBody, /sourceType: quizMeta\.sourceType \|\| null,/);
  assert.doesNotMatch(routeBody, /questions\[0\]\?\.(sourceName|sourceType|sourceDebateId)/, "plus aucune lecture de questions[0] pour ces champs — ils n'existent plus dans le résumé sous cette forme");
});

test("le plafond de niveau progressif et le tranchage par rang restent appliqués sur les résumés (rawQuestions/questions), comportement de sélection inchangé", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes"');
  const nextRouteIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/fiche"', routeIndex);
  const routeBody = SERVER_SOURCE.slice(routeIndex, nextRouteIndex);
  assert.match(routeBody, /const levelCeiledQuestions = restrictQuestionsToProgressiveLevelCeiling\(rawQuestions, effectiveLevel, progressiveStatusByKey\.get\(`\$\{link\.quiz_date\}:\$\{link\.slot\}`\)\);/);
  assert.match(routeBody, /const questions = selectQuestionsForRequestedLevel\(levelCeiledQuestions, NOTION_QUIZ_LEVELS\[effectiveLevel\]\?\.target\);/);
});

test("aucune autre route (fiche, getDailyQuizQuestions, génération) n'est touchée par ce correctif : elles continuent de sélectionner `questions` intégralement", () => {
  assert.match(SERVER_SOURCE, /\.select\("questions, progressive_status"\)/, "getDailyQuizQuestions inchangée");
  assert.match(SERVER_SOURCE, /\.select\("questions, grounding_sources, progressive_status"\)/, "la route fiche inchangée");
});

// ── Second correctif du même diagnostic (04/09/2026) : memory_item_fsrs_states
// lisait TOUT l'historique FSRS de l'utilisateur, sans aucun rapport avec les
// QCM affichés par cette route — volume qui croît sans fin avec l'ancienneté
// du compte. Restreint via memory_items!inner + .in("memory_items.slot", ...),
// jamais une migration (simple changement de requête). Sortie HTTP vérifiée
// byte-for-byte identique avant/après sur un utilisateur réel (25 QCM
// adoptés), cf. rapport. ───────────────────────────────────────────────────

test("fsrsStatesPromise restreint la jointure memory_items aux slots réellement adoptés (jamais tout l'historique FSRS de l'utilisateur)", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes"');
  const nextRouteIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/fiche"', routeIndex);
  assert.ok(routeIndex > 0 && nextRouteIndex > routeIndex);
  const routeBody = SERVER_SOURCE.slice(routeIndex, nextRouteIndex);
  assert.match(routeBody, /const linkSlots = \[\.\.\.new Set\(links\.map\(\(l\) => l\.slot\)\)\];/);
  assert.match(routeBody, /\.select\("state, stability, last_review_at, memory_items!inner\(slot, quiz_date, question_id\)"\)/);
  assert.match(routeBody, /\.eq\("user_id", userRow\.id\)\s*\n\s*\.in\("memory_items\.slot", linkSlots\);/);
  // `!inner` est indispensable : un simple embed (sans lui) laisserait
  // `.in("memory_items.slot", ...)` sans effet réel sur la jointure côté
  // PostgREST — jamais un embed non filtrant réintroduit par erreur.
  assert.doesNotMatch(routeBody, /\.select\("state, stability, last_review_at, memory_items\(slot, quiz_date, question_id\)"\)/, "l'ancien embed non filtré ne doit plus exister sur cette route");
});

test("linkSlots est dérivé de `links` (les QCM réellement adoptés), jamais d'un univers plus large", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes"');
  const nextRouteIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/fiche"', routeIndex);
  const routeBody = SERVER_SOURCE.slice(routeIndex, nextRouteIndex);
  const linksIndex = routeBody.indexOf('.from("user_notion_quizzes")');
  const linkSlotsIndex = routeBody.indexOf("const linkSlots = [...new Set(links.map((l) => l.slot))];");
  const fsrsPromiseIndex = routeBody.indexOf('.from("memory_item_fsrs_states")');
  assert.ok(linksIndex > 0 && linkSlotsIndex > linksIndex && fsrsPromiseIndex > linkSlotsIndex, "linkSlots doit être calculé depuis `links` (déjà chargé), avant la construction de fsrsStatesPromise");
});

test("le fichier de migration documente la mesure réelle (330 Ko -> 17,5 Ko) et suit le même principe que debates.media_extras_list_preview déjà en place", () => {
  const migrationPath = path.join(__dirname, "../data/migration-daily-quiz-question-summaries.sql");
  assert.ok(fs.existsSync(migrationPath), "le fichier de migration doit exister dans data/");
  const migrationSource = fs.readFileSync(migrationPath, "utf8");
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION daily_quiz_question_summaries\(dq daily_quiz\) RETURNS JSONB/);
  assert.match(migrationSource, /media_extras_list_preview/);
  assert.match(migrationSource, /330/);
});
