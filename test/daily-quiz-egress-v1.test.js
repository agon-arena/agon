"use strict";

// Verrous de câblage (V1 réduction egress daily_quiz, demande du 01/09/2026,
// cf. audit egress du même jour) — server.js ne peut pas être `require()`
// dans un test (il démarre tout le serveur Express à l'import) : ce fichier
// vérifie donc, en lisant server.js comme un TEXTE brut (jamais exécuté),
// que les 5 optimisations de lecture attendues sont bien en place, sans
// jamais avoir touché à la génération des 20 questions ni à la duplication
// sourceDetail/sourcePlacement (V2, volontairement hors scope ici).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

// ── 1. findExistingQuizMaster : plus de select("...questions") d'un coup ──

test("findExistingQuizMaster ne sélectionne plus `questions` dans le fetch initial (slot, quiz_date seuls)", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function findExistingQuizMaster(candidateSlots)");
  assert.ok(fnIndex > 0);
  const fnBody = SERVER_SOURCE.slice(fnIndex, fnIndex + 900);
  assert.match(fnBody, /\.select\("slot, quiz_date"\)/);
  assert.doesNotMatch(fnBody, /\.select\("slot, quiz_date, questions"\)/);
});

test("findExistingQuizMaster ne relit `questions` que ligne par ligne (eq slot + eq quiz_date + maybeSingle), jamais toutes en une fois", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function findExistingQuizMaster(candidateSlots)");
  const fnBody = SERVER_SOURCE.slice(fnIndex, fnIndex + 900);
  // Phase 2.2 (04/09/2026) : progressive_status ajoutée à ce select (plafond
  // de niveau progressif des questions, cf.
  // test/qcm-progressive-level-ceiling-wiring.test.js) — l'egress reste
  // ligne par ligne, seule la colonne supplémentaire change.
  assert.match(fnBody, /\.select\("questions, progressive_status"\)\s*\n\s*\.eq\("slot", row\.slot\)\s*\n\s*\.eq\("quiz_date", row\.quiz_date\)\s*\n\s*\.maybeSingle\(\)/);
  assert.match(fnBody, /isMasterEligibleQuiz\(fullRow\?\.questions\)/);
});

// ── 2. GET /explore : plus de select("...questions") complet pour tout ────
//    l'historique ; questions->0 en phase 1, questions complet seulement
//    pour les lignes réellement affichées en phase 2. ──────────────────────

test("GET /explore lit seulement la première question (questions->0) en phase 1, jamais le tableau complet", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/explore"');
  assert.ok(routeIndex > 0);
  const routeBody = SERVER_SOURCE.slice(routeIndex, routeIndex + 5200);
  assert.match(routeBody, /\.select\("quiz_date, slot, first:questions->0"\)/);
  assert.doesNotMatch(routeBody, /\.select\("quiz_date, slot, questions"\)/);
});

test("GET /explore ne relit le tableau `questions` complet qu'en phase 2, filtré sur les items affichés (post dédoublonnage + recherche)", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/explore"');
  const routeBody = SERVER_SOURCE.slice(routeIndex, routeIndex + 5200);
  const searchFilterIndex = routeBody.indexOf("if (searchQuery) items = items.filter(");
  const phase2Index = routeBody.indexOf('.select("slot, questions")');
  assert.ok(searchFilterIndex > 0, "le filtre de recherche doit exister");
  assert.ok(phase2Index > searchFilterIndex, "la relecture du tableau complet doit se faire APRÈS le filtre de recherche, jamais avant");
  assert.match(routeBody, /\.or\(orFilter\)/);
});

test("GET /explore dérive toujours theme/searchTopic/label de la première question (questions[0]), jamais changé par ce correctif", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/explore"');
  const routeBody = SERVER_SOURCE.slice(routeIndex, routeIndex + 5200);
  assert.match(routeBody, /getPrimaryNotionQuizTheme\(row\.first\)/);
  assert.match(routeBody, /row\.first\?\.searchTopic/);
});

// ── 3. GET /api/users/notion-quizzes ("Mes QCM") : paires exactes ─────────

test('GET /api/users/notion-quizzes ("Mes QCM") filtre daily_quiz par paires exactes (quiz_date, slot), jamais par un .in(dates).in(slots) croisé', () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes", rateLimit');
  assert.ok(routeIndex > 0);
  const routeBody = SERVER_SOURCE.slice(routeIndex, routeIndex + 2000);
  assert.match(routeBody, /const pairFilter = links\s*\n\s*\.map\(\(l\) => `and\(quiz_date\.eq\.\$\{l\.quiz_date\},slot\.eq\.\$\{l\.slot\}\)`\)/);
  assert.match(routeBody, /\.or\(pairFilter\)/);
  assert.doesNotMatch(routeBody, /\.in\("quiz_date", quizDates\)\s*\n\s*\.in\("slot", slots\)/);
});

// ── 4. hasPendingCultureGeneraleComprehensionQuestions : plus de full-scan ─

test("hasPendingCultureGeneraleComprehensionQuestions détecte les bancs non vides via questions->0, sans relire le tableau complet de tout l'historique", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function hasPendingCultureGeneraleComprehensionQuestions(");
  assert.ok(fnIndex > 0);
  const fnBody = SERVER_SOURCE.slice(fnIndex, fnIndex + 3200);
  assert.match(fnBody, /\.select\("quiz_date, slot, first:questions->0"\)/);
  assert.match(fnBody, /row\.first != null/);
});

test("hasPendingCultureGeneraleComprehensionQuestions ne relit `questions` complet que pour la ligne la plus récente non vide de chaque slot (paires exactes), et préserve le repli sur early-return si un slot n'a aucune ligne", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function hasPendingCultureGeneraleComprehensionQuestions(");
  const fnBody = SERVER_SOURCE.slice(fnIndex, fnIndex + 3200);
  const earlyReturnIndex = fnBody.indexOf("if (selectedSlots.some((slot) => !latestDateBySlot.has(slot))) return true;");
  const pairFilterIndex = fnBody.indexOf('.select("slot, questions")');
  assert.ok(earlyReturnIndex > 0, "le early-return doit rester présent, inchangé dans son intention");
  assert.ok(pairFilterIndex > earlyReturnIndex, "la relecture complète doit rester après l'early-return");
  assert.match(fnBody, /\.or\(pairFilter\)/);
});

// ── 5. applyFsrsReviewForDailyQuizAnswer / upsertMemoryItemForNotionAnswer ─
//    : une seule lecture de la ligne daily_quiz par réponse "notion:"/
//    "comprendre:", jamais deux. ─────────────────────────────────────────

test("upsertMemoryItemForNotionAnswer renvoie la question déjà lue (canonicalQuestion), réutilisable par l'appelant", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function upsertMemoryItemForNotionAnswer(");
  assert.ok(fnIndex > 0);
  const fnBody = SERVER_SOURCE.slice(fnIndex, fnIndex + 1500);
  assert.match(fnBody, /return \{ \.\.\.data, canonicalQuestion: question \};/);
});

test("applyFsrsReviewForDailyQuizAnswer réutilise canonicalQuestion pour les branches notion:/comprendre:, et ne relit daily_quiz que si canonicalQuestion est absent (branche cgreview-)", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function applyFsrsReviewForDailyQuizAnswer(");
  assert.ok(fnIndex > 0);
  const fnBody = SERVER_SOURCE.slice(fnIndex, fnIndex + 8000);
  assert.match(fnBody, /memoryItemRow = await upsertMemoryItemForNotionAnswer\(\{ slot, quizDate, questionId \}\);\s*\n\s*canonicalQuestion = memoryItemRow\?\.canonicalQuestion \|\| null;/);
  assert.match(fnBody, /memoryItemRow = await upsertMemoryItemForNotionAnswer\(\{ slot: comprehensionPairSlot, quizDate: comprehensionQuizRow\.quiz_date, questionId \}\);\s*\n\s*canonicalQuestion = memoryItemRow\?\.canonicalQuestion \|\| null;/);
  assert.match(fnBody, /if \(!canonicalQuestion\) \{\s*\n\s*const \{ data: quizRow, error: quizRowError \} = await supabase\.from\("daily_quiz"\)/);
});

test("la branche cgreview- ne passe jamais par upsertMemoryItemForNotionAnswer (elle garde son propre chemin memory_items, canonicalQuestion reste null pour elle)", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function applyFsrsReviewForDailyQuizAnswer(");
  const fnBody = SERVER_SOURCE.slice(fnIndex, fnIndex + 8000);
  const cgreviewIndex = fnBody.indexOf('questionId.startsWith("cgreview-")');
  const nextBranchIndex = fnBody.indexOf('questionId.startsWith("comprendre:")');
  assert.ok(cgreviewIndex > 0 && nextBranchIndex > cgreviewIndex);
  const cgreviewBranch = fnBody.slice(cgreviewIndex, nextBranchIndex);
  assert.doesNotMatch(cgreviewBranch, /upsertMemoryItemForNotionAnswer/);
});
