"use strict";

// Mes acquis ne signifie plus "parcours progressif terminé" : un sujet peut
// être acquis au niveau Élémentaire/Approfondi et proposer la suite sur le
// même slot/date, sans recréer de QCM.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const VIEW_SOURCE = fs.readFileSync(path.join(__dirname, "..", "views", "qcm-du-jour.html"), "utf8");

function routeSource() {
  const start = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes",');
  const end = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/fiche"', start);
  assert.notEqual(start, -1, "route GET /api/users/notion-quizzes introuvable");
  assert.notEqual(end, -1, "fin de route GET /api/users/notion-quizzes introuvable");
  return SERVER_SOURCE.slice(start, end);
}

function viewFunctionSource(name, nextName) {
  const start = VIEW_SOURCE.indexOf(`function ${name}(`);
  const end = nextName.endsWith("_CONST")
    ? VIEW_SOURCE.indexOf(`var ${nextName.slice(0, -6)}`, start + 1)
    : VIEW_SOURCE.indexOf(`function ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `${name} introuvable`);
  assert.notEqual(end, -1, `${nextName} doit délimiter ${name}`);
  return VIEW_SOURCE.slice(start, end);
}

test("le serveur calcule un completedLevel séparé du niveau servi/persisté", () => {
  const route = routeSource();
  assert.match(SERVER_SOURCE, /function computeHighestCompletedProgressiveLevel\(rawQuestions, progressiveStatus, isQuestionComplete\)/);
  assert.match(route, /const completedLevel = progressiveStatus\s*\?\s*computeHighestCompletedProgressiveLevel\(rawQuestions, progressiveStatus, isQuestionCompleteForThisQuiz\)/);
  assert.match(route, /const nextLevel = completedLevel \? getNextProgressiveLevel\(completedLevel\) : null;/);
  assert.match(route, /const nextLevelReady = !!\(nextLevel && isProgressiveLevelReady\(nextLevel, progressiveStatus\)\);/);
  assert.match(route, /servedLevel: effectiveLevel,\s*\n\s*completedLevel,/);
});

test("Mes acquis affiche le niveau atteint et le bouton Continuer en niveau supérieur", () => {
  const renderer = viewFunctionSource("renderMesQcmTableHtml", "renderMesQcmPaginatedTablesHtml");
  assert.match(VIEW_SOURCE, /function renderMesQcmContinuationHtml\(q, index\)/);
  assert.match(renderer, /var displayLevel = q\.completedLevel \|\| q\.level;/);
  assert.match(renderer, /q\.completedLevel \? '<span class="qcm-mesqcm-level-caption">Niveau atteint<\/span>'/);
  assert.match(renderer, /renderMesQcmContinuationHtml\(q, index\)/);
  assert.match(VIEW_SOURCE, /data-mesqcm-continue-index/);
});

test("le clic Continuer réutilise le même slot/date et ne relance jamais une génération", () => {
  const wiring = viewFunctionSource("wireMesQcmListInteractions", "MESQCM_BULK_BAR_HTML_CONST");
  assert.match(wiring, /body\.querySelectorAll\('\[data-mesqcm-continue-index\]'\)/);
  assert.match(wiring, /loadSlot\(q\.slot, q\.quizDate, q\.label, q\.nextLevel\);/);
  assert.doesNotMatch(wiring, /custom\/progressive|users\/notion-quizzes\/custom|adopt|generation-status/);
});

test("la fenêtre d'action priorise Continuer en Avancé/Expert avant Refaire", () => {
  const menu = viewFunctionSource("openMesQcmActionMenu", "formatNoesVttTime");
  assert.match(menu, /var continuationLevel = q\.nextLevel && q\.nextLevelReady \? q\.nextLevel : null;/);
  assert.match(menu, /\? 'Continuer en ' \+ continuationLabel/);
  assert.match(menu, /loadSlot\(q\.slot, q\.quizDate, q\.label, continuationLevel \|\| q\.level\);/);
});
