"use strict";

// Incident "Maoïsme" (02/09/2026) : une génération de QCM/apprentissage réellement longue
// (sujet libre, cf. POST /api/users/notion-quizzes/custom) déclenchait un faux message rouge
// d'échec dès que la requête HTTP initiale expirait via un intermédiaire externe (proxy Render),
// alors que le backend continuait réellement sa génération. Cause exacte : la branche
// `result.invalidJson` de startCustomTopicGeneration (views/qcm-du-jour.html) — atteinte quand
// la réponse HTTP reçue n'est pas du JSON valide, signature d'un timeout de proxy/gateway plutôt
// que d'un vrai échec applicatif (le serveur, lui, ne répond jamais autrement qu'en JSON valide
// sur cette route, cf. server.js POST /api/users/notion-quizzes/custom) — traitait ce cas comme
// un échec confirmé : message rouge affiché ET marqueur de suivi persistant supprimé
// (mnoriaFinishPendingNotionQuizGeneration), coupant net le sondage periodique qui aurait sinon
// fini par détecter la vraie fin de génération. Le correctif aligne cette branche sur le
// traitement déjà existant de la coupure réseau (.catch(), correctif UX du 01/09/2026, incident
// "Marxisme") : réponse ambiguë = pas de message rouge, marqueur conservé, sondage relancé.
//
// server.js ne peut pas être `require()` dans un test (il démarre tout le serveur Express à
// l'import) et views/qcm-du-jour.html embarque directement son JS inline : même principe que
// test/custom-topic-generation-wiring.test.js — lecture des fichiers comme texte brut, jamais
// exécutés, et assertions sur la forme du code câblé.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const view = fs.readFileSync(path.join(root, "views/qcm-du-jour.html"), "utf8");

function sliceBetween(haystack, startMarker, endMarker, label) {
  const start = haystack.indexOf(startMarker);
  assert.ok(start >= 0, `marqueur de début introuvable (${label}) : ${startMarker}`);
  const end = haystack.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `marqueur de fin introuvable (${label}) : ${endMarker}`);
  return haystack.slice(start, end);
}

const startCustomTopicGeneration = sliceBetween(
  view,
  "function startCustomTopicGeneration(topic, onCreated, presetLevel) {",
  "function submitCustomTopic(e) {",
  "startCustomTopicGeneration"
);
const invalidJsonBranch = sliceBetween(
  startCustomTopicGeneration,
  "if (result.invalidJson) {",
  "if (!result.data.ok) {",
  "branche invalidJson"
);
const businessFailureBranch = sliceBetween(
  startCustomTopicGeneration,
  "if (!result.data.ok) {",
  "customSearchInput.value = '';",
  "branche !result.data.ok"
);
const successBranch = startCustomTopicGeneration.slice(
  startCustomTopicGeneration.indexOf("customSearchInput.value = '';"),
  startCustomTopicGeneration.indexOf(".catch(function () {")
);
const networkCatchBranch = sliceBetween(
  startCustomTopicGeneration,
  ".catch(function () {",
  "});\n      });\n    };\n    if (presetLevel)",
  "catch réseau"
);

const refreshPendingNotionQuizList = sliceBetween(
  view,
  "function refreshPendingNotionQuizList(forceListRefresh) {",
  "function schedulePendingNotionQuizPoll() {",
  "refreshPendingNotionQuizList"
);

// ── 1. Génération rapide réussie ───────────────────────────────────────────

test("génération réussie : la réponse JSON ok affiche le QCM et efface le suivi, sans jamais passer par une branche d'erreur", () => {
  assert.match(successBranch, /setCustomSearchStatus\('', false\)/);
  assert.match(successBranch, /loadSlot\(result\.data\.slot, result\.data\.quizDate, result\.data\.label\)/);
  assert.match(successBranch, /showNotionQuizReadyModal\(/);
  assert.match(startCustomTopicGeneration, /if \(pendingCustomSlot && typeof window\.mnoriaFinishPendingNotionQuizGeneration === 'function'\) \{\s*\n\s*window\.mnoriaFinishPendingNotionQuizGeneration\(pendingCustomSlot\);\s*\n\s*\}\s*\n\s*customTopicGenerationLabel = '';\s*\n\s*customSearchInput\.value = '';/);
});

// ── 2. Timeout HTTP (JSON illisible) avec job toujours pending/processing ──

test("incident Maoïsme : une réponse HTTP illisible (timeout proxy) n'affiche jamais de message rouge et ne coupe jamais le suivi persistant", () => {
  assert.doesNotMatch(invalidJsonBranch, /mnoriaFinishPendingNotionQuizGeneration/,
    "le marqueur de suivi persistant ('en cours de création') ne doit jamais être effacé sur un simple corps de réponse illisible");
  assert.doesNotMatch(invalidJsonBranch, /setCustomSearchStatus\([^)]*,\s*true\)/,
    "aucun message ne doit être affiché en mode erreur (isError=true) dans cette branche");
  assert.doesNotMatch(invalidJsonBranch, /interrompu la génération/i,
    "l'ancien message rouge de l'incident Maoïsme a disparu");
});

test("incident Maoïsme : une réponse HTTP illisible relance le sondage periodique existant plutôt que d'abandonner le suivi", () => {
  assert.match(invalidJsonBranch, /refreshPendingNotionQuizList\(true\)/);
  assert.match(invalidJsonBranch, /toujours en cours en arrière-plan/i);
});

test("le frontend justifie qu'un corps illisible ne peut pas être un vrai échec applicatif sur cette route (le serveur répond toujours en JSON valide)", () => {
  const routeStart = server.indexOf('app.post("/api/users/notion-quizzes/custom"');
  const routeEnd = server.indexOf("\n});", routeStart) + 4;
  const route = server.slice(routeStart, routeEnd);
  // Chaque issue gérée par la route (succès, échec métier publicGenerationError, erreur
  // générique de stockage) répond toujours en JSON — jamais de texte brut ni de page HTML.
  assert.match(route, /res\.json\(\{ ok: true,/);
  assert.match(route, /res\.status\(publicError\.status\)\.json\(\{ \.\.\.publicError\.body/);
  assert.match(route, /res\.status\(publicError\.status\)\.json\(publicError\.body\)/);
});

// ── 3. Polling qui finit par obtenir "ready" ───────────────────────────────

test("le sondage periodique affiche normalement le QCM dès que generation-status renvoie ready, sans jamais montrer d'erreur", () => {
  const readyBranch = sliceBetween(refreshPendingNotionQuizList, "ready.forEach(function (item) {", "failed.forEach(function (item) {", "branche ready");
  assert.match(readyBranch, /mnoriaFinishPendingNotionQuizGeneration\(item\.slot\)/);
  assert.doesNotMatch(readyBranch, /setCustomSearchStatus\([^)]*,\s*true\)/);
  assert.match(refreshPendingNotionQuizList, /return fetchLatestMesQcmList\(\);/,
    "la liste 'Mes QCM' doit être rechargée pour faire apparaître le QCM fraîchement prêt");
});

test("un échec métier renvoyé directement par la requête initiale (pas via le sondage) affiche bien le message d'erreur, contrairement au cas ambigu invalidJson", () => {
  assert.match(businessFailureBranch, /mnoriaFinishPendingNotionQuizGeneration\(pendingCustomSlot\)/);
  assert.match(businessFailureBranch, /setCustomSearchStatus\(\s*\n\s*customGenerationErrorMessage\(result\.data\.code, result\.data\.error\)/);
});

// ── 4. Vrai statut "failed" confirmé par le backend ────────────────────────

test("un vrai échec confirmé par generation-status (failed) affiche toujours le message d'erreur, contrairement au cas ambigu invalidJson", () => {
  const failedBranch = sliceBetween(refreshPendingNotionQuizList, "failed.forEach(function (item) {", "return fetchLatestMesQcmList();", "branche failed");
  assert.match(failedBranch, /mnoriaFinishPendingNotionQuizGeneration\(item\.slot\)/);
  assert.match(failedBranch, /setCustomSearchStatus\(customGenerationErrorMessage\(item\.code\), true\)/);
});

test("generation-status ne renvoie failed que sur un échec réellement enregistré côté backend, jamais par défaut", () => {
  const routeStart = server.indexOf('app.get("/api/users/notion-quizzes/generation-status"');
  const routeEnd = server.indexOf("\n});", routeStart) + 4;
  const route = server.slice(routeStart, routeEnd);
  assert.match(route, /const failures = await fetchRecentNotionQuizFailures\(supabase, failureIdentities\);/);
  assert.match(route, /return failure \? \[\{ slot: requestedSlot, code: failure\.code \|\| null \}\] : \[\];/,
    "un slot sans échec enregistré ne doit jamais apparaître dans 'failed'");
});

// ── 5. Erreur réseau temporaire pendant le polling ─────────────────────────

test("une erreur réseau pendant le sondage periodique reprogramme un nouvel essai plutôt que de déclarer un échec définitif", () => {
  // La seule réaction à un fetch() rejeté (coupure réseau pendant le sondage) doit être un
  // nouveau tour de sondage — jamais un appel à finish/failed, qui déclarerait à tort le job
  // introuvable/échoué alors que son état réel reste simplement inconnu à cet instant.
  assert.match(refreshPendingNotionQuizList, /\.catch\(function \(\) \{ schedulePendingNotionQuizPoll\(\); \}\);/);
  const pollCatchIndex = refreshPendingNotionQuizList.indexOf(".catch(function () { schedulePendingNotionQuizPoll(); });");
  const restOfFunction = refreshPendingNotionQuizList.slice(pollCatchIndex);
  assert.doesNotMatch(restOfFunction, /mnoriaFinishPendingNotionQuizGeneration/);
});

// ── Le cas déjà couvert (Marxisme) reste intact ────────────────────────────

test("le traitement de la coupure réseau (incident Marxisme) reste identique au traitement du corps illisible (incident Maoïsme) : même principe, même message", () => {
  assert.doesNotMatch(networkCatchBranch, /mnoriaFinishPendingNotionQuizGeneration/);
  assert.doesNotMatch(networkCatchBranch, /setCustomSearchStatus\([^)]*,\s*true\)/);
  assert.match(networkCatchBranch, /refreshPendingNotionQuizList\(true\)/);
  assert.match(networkCatchBranch, /toujours en cours en arrière-plan/i);
});
