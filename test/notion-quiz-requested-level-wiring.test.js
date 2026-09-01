"use strict";

// Verrous de câblage V4.1.1 (demande du 01/09/2026 — "finaliser la
// mutualisation avec requested_level") : server.js ne peut pas être
// `require()` en test (il démarre tout le serveur Express à l'import) — ce
// fichier vérifie donc, en lisant server.js comme un TEXTE brut (jamais
// exécuté), que le câblage attendu est bien en place, même principe que
// test/notion-quiz-mutualization-wiring.test.js (V4.1). Le comportement DB
// réel (écriture/lecture/mise à jour de requested_level, non-régénération,
// progression multi-utilisateur) est prouvé par la validation empirique
// réelle décrite dans le rapport final — pas reproductible ici sans DB.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const QCM_FRONTEND_SOURCE = fs.readFileSync(path.join(__dirname, "../views/qcm-du-jour.html"), "utf8");

// ── A/B : écriture de requested_level à l'adoption (les deux chemins) ─────

test("POST /api/users/notion-quizzes/custom écrit requested_level=level (jamais le niveau de génération du master) dans l'upsert user_notion_quizzes", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom"');
  assert.ok(routeIndex > 0);
  const upsertIndex = SERVER_SOURCE.indexOf(
    '{ user_id: user.id, quiz_date: quizDate, slot: effectiveSlot, requested_level: level }',
    routeIndex
  );
  assert.ok(upsertIndex > routeIndex, "l'upsert doit inclure requested_level: level");
});

test("POST /api/users/notion-quizzes écrit requested_level=level dans l'upsert user_notion_quizzes", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes",');
  assert.ok(routeIndex > 0);
  const upsertIndex = SERVER_SOURCE.indexOf(
    '{ user_id: user.id, quiz_date: quizDate, slot: effectiveSlot, requested_level: level }',
    routeIndex
  );
  assert.ok(upsertIndex > routeIndex, "l'upsert doit inclure requested_level: level");
});

// ── V4.1.2 : la troisième route moderne d'adoption (/adopt) applique
// exactement le même contrat de niveau que les deux routes ci-dessus. ────

test("POST /api/users/notion-quizzes/adopt exige un level valide via resolveNotionQuizLevel", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/adopt"');
  const nextRouteIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/remove"', routeIndex);
  const routeBody = SERVER_SOURCE.slice(routeIndex, nextRouteIndex);
  assert.ok(routeIndex > 0 && nextRouteIndex > routeIndex);
  assert.match(routeBody, /const level = resolveNotionQuizLevel\(req\.body\?\.level\)\.level;/);
  assert.match(routeBody, /if \(!level\) return res\.status\(400\)\.json\(\{ ok: false, error: "Niveau d'approfondissement invalide\." \}\);/);
});

test("POST /api/users/notion-quizzes/adopt persiste requested_level et permet la mise à jour sans réécrire added_at", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/adopt"');
  const nextRouteIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/remove"', routeIndex);
  const routeBody = SERVER_SOURCE.slice(routeIndex, nextRouteIndex);
  assert.match(routeBody, /\{ user_id: user\.id, quiz_date: quizDate, slot, requested_level: level \}/);
  assert.match(routeBody, /\{ onConflict: "user_id,quiz_date,slot" \}/);
  assert.doesNotMatch(routeBody, /ignoreDuplicates/);
  assert.doesNotMatch(routeBody, /added_at/);
});

test("les deux parcours frontend /adopt réutilisent showNotionQuizLevelPicker et envoient le level choisi", () => {
  const exploreIndex = QCM_FRONTEND_SOURCE.indexOf("function adoptExploreItem(slot, quizDate, itemBtn) {");
  const exploreEnd = QCM_FRONTEND_SOURCE.indexOf("var exploreSearchDebounce", exploreIndex);
  const exploreBody = QCM_FRONTEND_SOURCE.slice(exploreIndex, exploreEnd);
  assert.match(exploreBody, /showNotionQuizLevelPicker\(function \(level\) \{/);
  assert.match(exploreBody, /JSON\.stringify\(\{ legacyKey: voterKey, slot: slot, quizDate: quizDate, level: level \}\)/);

  const catalogIndex = QCM_FRONTEND_SOURCE.indexOf("function adoptCatalogRecommendation(item, btn) {");
  const catalogEnd = QCM_FRONTEND_SOURCE.indexOf("var LEARN_NEXT_DISPLAY_COUNT", catalogIndex);
  const catalogBody = QCM_FRONTEND_SOURCE.slice(catalogIndex, catalogEnd);
  assert.match(catalogBody, /showNotionQuizLevelPicker\(function \(level\) \{/);
  assert.match(catalogBody, /JSON\.stringify\(\{ legacyKey: voterKey, slot: data\.slot, quizDate: data\.quizDate, level: level \}\)/);
});

test("fermer le sélecteur n'adopte rien : les POST /adopt restent exclusivement dans le callback onSelect", () => {
  for (const marker of [
    "function adoptExploreItem(slot, quizDate, itemBtn) {",
    "function adoptCatalogRecommendation(item, btn) {"
  ]) {
    const start = QCM_FRONTEND_SOURCE.indexOf(marker);
    const picker = QCM_FRONTEND_SOURCE.indexOf("showNotionQuizLevelPicker(function (level) {", start);
    const post = QCM_FRONTEND_SOURCE.indexOf("fetch('/api/users/notion-quizzes/adopt'", start);
    assert.ok(start > 0 && picker > start && post > picker, `${marker} doit attendre le choix du niveau avant tout POST`);
  }
});

// ── D : re-adoption à un autre niveau MET À JOUR la ligne, jamais ignorée ──

test("les deux upserts d'adoption n'utilisent plus ignoreDuplicates:true (une ré-adoption à un autre niveau doit mettre à jour requested_level, jamais être ignorée)", () => {
  const customRouteIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom"');
  const nextRouteIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/explore"', customRouteIndex);
  const customRouteBody = SERVER_SOURCE.slice(customRouteIndex, nextRouteIndex > 0 ? nextRouteIndex : customRouteIndex + 6000);
  assert.doesNotMatch(customRouteBody, /requested_level: level \}\s*,\s*\n\s*\{ onConflict: "user_id,quiz_date,slot", ignoreDuplicates: true \}/);
  assert.match(customRouteBody, /requested_level: level \}\s*,\s*\n\s*\{ onConflict: "user_id,quiz_date,slot" \}\s*\n\s*\);/);

  const notionRouteIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes",');
  const notionRouteBody = SERVER_SOURCE.slice(notionRouteIndex, customRouteIndex);
  assert.match(notionRouteBody, /requested_level: level \}\s*,\s*\n\s*\{ onConflict: "user_id,quiz_date,slot" \}\s*\n\s*\);/);
});

// ── E : la mise à jour de requested_level intervient APRÈS la résolution du
// master (réutilisation ou génération verrouillée), jamais avant — un
// changement de niveau ne doit jamais redéclencher findExistingQuizMaster
// à vide ni contourner le verrou de génération. ─────────────────────────────

test("POST /custom : l'upsert (écriture requested_level) intervient après la résolution complète du master (existingMaster / exact / fuzzy / génération verrouillée)", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom"');
  const masterLookupIndex = SERVER_SOURCE.indexOf("const existingMaster = await findExistingQuizMaster(", routeIndex);
  const generationIndex = SERVER_SOURCE.indexOf("const result = await ensureCustomTopicMasterGenerated(masterSlot, topic, id, level, user.id);", routeIndex);
  const upsertIndex = SERVER_SOURCE.indexOf("requested_level: level", routeIndex);
  assert.ok(routeIndex > 0 && masterLookupIndex > routeIndex && generationIndex > masterLookupIndex && upsertIndex > generationIndex);
});

// ── F : GET /api/users/notion-quizzes utilise requested_level, jamais
// seulement questions[0].level. ─────────────────────────────────────────────

test("GET /api/users/notion-quizzes sélectionne requested_level et l'utilise en priorité (repli sur rawQuestions[0]?.level)", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes"');
  assert.ok(routeIndex > 0);
  const selectIndex = SERVER_SOURCE.indexOf('.select("quiz_date, slot, added_at, requested_level")', routeIndex);
  const persistedIndex = SERVER_SOURCE.indexOf("const persistedLevel = resolveNotionQuizLevel(link.requested_level).level;", routeIndex);
  const effectiveIndex = SERVER_SOURCE.indexOf("const effectiveLevel = persistedLevel || rawQuestions[0]?.level || null;", routeIndex);
  const selectQuestionsIndex = SERVER_SOURCE.indexOf("const questions = selectQuestionsForRequestedLevel(rawQuestions, NOTION_QUIZ_LEVELS[effectiveLevel]?.target);", routeIndex);
  assert.ok(selectIndex > routeIndex, "requested_level doit être sélectionné dans la requête des liens");
  assert.ok(persistedIndex > selectIndex && effectiveIndex > persistedIndex && selectQuestionsIndex > effectiveIndex);
});

// ── I : requested_level NULL -> repli legacy, jamais une régression. ──────

test("le repli persistedLevel -> requestedLevel/param -> questions[0].level est explicite partout (jamais un accès direct à rawQuestions[0].level en V4.1.1)", () => {
  // getDailyQuizQuestions
  assert.match(SERVER_SOURCE, /const effectiveRequestedLevel = persistedLevel \|\| requestedLevel \|\| null;/);
  assert.match(SERVER_SOURCE, /NOTION_QUIZ_LEVELS\[effectiveRequestedLevel \|\| rawQuestions\[0\]\?\.level\]\?\.target/);
  // fiche
  assert.match(SERVER_SOURCE, /const effectiveLevel = persistedLevel \|\| requestedLevel \|\| questions\[0\]\?\.level \|\| null;/);
  // liste
  assert.match(SERVER_SOURCE, /const effectiveLevel = persistedLevel \|\| rawQuestions\[0\]\?\.level \|\| null;/);
});

// ── K : toute valeur relue depuis requested_level est validée via
// resolveNotionQuizLevel avant usage (défense en profondeur, la contrainte
// CHECK en base garantissant déjà NULL/elementaire/avance/expert). ────────

test("toute lecture de requested_level passe par resolveNotionQuizLevel avant d'être utilisée comme niveau effectif", () => {
  const occurrences = [...SERVER_SOURCE.matchAll(/resolveNotionQuizLevel\(([^)]*requested_level[^)]*)\)\.level/g)];
  assert.ok(occurrences.length >= 3, `attendu au moins 3 lectures validées de requested_level (list, fiche, resolvePersistedNotionRequestedLevel), trouvé ${occurrences.length}`);
});

// ── L : la résolution du niveau persisté n'est JAMAIS mise en cache
// elle-même — seul le contenu (par date:slot:niveau effectif) l'est. ──────

test("resolvePersistedNotionRequestedLevel n'écrit jamais dans _dailyQuizQuestionsCache ni aucun autre cache mémoire", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function resolvePersistedNotionRequestedLevel(voterKey, quizDate, slot) {");
  assert.ok(fnIndex > 0);
  const nextFnIndex = SERVER_SOURCE.indexOf("\nasync function getDailyQuizQuestions(", fnIndex);
  const fnBody = SERVER_SOURCE.slice(fnIndex, nextFnIndex > 0 ? nextFnIndex : fnIndex + 1600);
  assert.doesNotMatch(fnBody, /_dailyQuizQuestionsCache/, "aucune mise en cache du niveau persisté lui-même");
  assert.doesNotMatch(fnBody, /\.set\(/, "resolvePersistedNotionRequestedLevel ne doit écrire dans aucun cache");
});

test("getDailyQuizQuestions résout persistedLevel à neuf (await, jamais depuis un cache) avant de construire la clé de cache du contenu", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function getDailyQuizQuestions(quizDate, slot, voterKey, requestedLevel) {");
  assert.ok(fnIndex > 0);
  const persistedCallIndex = SERVER_SOURCE.indexOf("const persistedLevel = await resolvePersistedNotionRequestedLevel(voterKey, quizDate, slot);", fnIndex);
  const cacheKeyIndex = SERVER_SOURCE.indexOf("const cacheKey = `${quizDate}:${slot}:${effectiveRequestedLevel || \"\"}`;", fnIndex);
  assert.ok(persistedCallIndex > fnIndex && cacheKeyIndex > persistedCallIndex, "le niveau persisté doit être résolu AVANT de construire la clé de cache, pour qu'un changement de niveau soit visible immédiatement");
});

// ── resolvePersistedNotionRequestedLevel : lecture seule, jamais un
// upsert/une création d'utilisateur (contrairement à resolveLegacyUser). ──

test("resolvePersistedNotionRequestedLevel fait un select() en lecture seule sur users, jamais un upsert (pas d'effet de bord sur un simple visiteur anonyme)", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function resolvePersistedNotionRequestedLevel(voterKey, quizDate, slot) {");
  const nextFnIndex = SERVER_SOURCE.indexOf("\nasync function getDailyQuizQuestions(", fnIndex);
  const fnBody = SERVER_SOURCE.slice(fnIndex, nextFnIndex > 0 ? nextFnIndex : fnIndex + 1600);
  assert.match(fnBody, /\.from\("users"\)\.select\("id"\)\.eq\("legacy_key", key\)\.maybeSingle\(\);/);
  assert.doesNotMatch(fnBody, /\.upsert\(/);
});

// ── /fiche : niveau persisté (propriétaire des liens) prime sur &level=,
// lui-même prime sur questions[0].level. ────────────────────────────────────

test("GET /api/users/notion-quizzes/fiche résout persistedLevel via linkOwnerUserId AVANT de calculer effectiveLevel", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/fiche"');
  assert.ok(routeIndex > 0);
  const linkOwnerIndex = SERVER_SOURCE.indexOf("let linkOwnerUserId = null;", routeIndex);
  const persistedQueryIndex = SERVER_SOURCE.indexOf('.from("user_notion_quizzes")\n        .select("requested_level")', routeIndex);
  const effectiveIndex = SERVER_SOURCE.indexOf("const effectiveLevel = persistedLevel || requestedLevel || questions[0]?.level || null;", routeIndex);
  assert.ok(linkOwnerIndex > routeIndex && persistedQueryIndex > linkOwnerIndex && effectiveIndex > persistedQueryIndex);
});

// ── Non-régression V4.1 explicite : la découverte/réutilisation de master
// (findExistingQuizMaster, verrou, dédup) reste totalement intacte. ────────

test("findExistingQuizMaster, le verrou de génération et isMasterEligibleQuiz restent inchangés (V4.1.1 ne touche que la persistance du niveau)", () => {
  assert.match(SERVER_SOURCE, /async function findExistingQuizMaster\(candidateSlots\) \{/);
  assert.match(SERVER_SOURCE, /const _notionQuizMasterGenerationPromises = new Map\(\);/);
  assert.match(SERVER_SOURCE, /function buildCustomTopicMasterSlot\(id\) \{/);
});
