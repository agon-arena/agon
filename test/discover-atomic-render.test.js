"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const view = fs.readFileSync(path.join(__dirname, "../views/qcm-du-jour.html"), "utf8");
const loadStart = view.indexOf("function loadMesQcm()");
const loadEnd = view.indexOf("\n  function renderMesQcmEmpty()", loadStart);
const loadMesQcm = view.slice(loadStart, loadEnd);
const recStart = view.indexOf("function loadLearnNextInline()");
const recEnd = view.indexOf("\n  // Visibilité =", recStart);
const loadRecommendations = view.slice(recStart, recEnd);

test("Découvrir attend ensemble QCM, jauge et sujets proposés", () => {
  assert.match(loadMesQcm, /var recommendationsRequest = loadLearnNextInline\(\)/);
  assert.match(loadMesQcm, /Promise\.all\(\[quizzesRequest, gaugeRequest, recommendationsRequest\]\)/);
});

test("aucun sujet proposé ni squelette n'est visible avant la peinture finale", () => {
  assert.match(view, /discoverContentReady && learnNextInlinePhase === 'has-content'/);
  assert.doesNotMatch(view, /learnNextInlinePhase === 'loading' \|\| learnNextInlinePhase === 'has-content'/);
  assert.ok(loadMesQcm.indexOf("discoverContentReady = false") < loadMesQcm.indexOf("renderCategorySwitcher()"));
});

test("les propositions catalogue et IA sont assemblées avant leur premier rendu", () => {
  assert.match(loadRecommendations, /return fetchAiFallbackProposals\(\)\.then\(function \(proposals\)/);
  assert.match(loadRecommendations, /appendLearnNextItems\(items\.concat\(proposals\)\)/);
});

test("le verrou est ouvert seulement après le rendu des rubriques et de la jauge", () => {
  const renderIndex = loadMesQcm.indexOf("renderMesQcmList(quizzes)");
  const readyIndex = loadMesQcm.indexOf("discoverContentReady = true", renderIndex);
  const revealIndex = loadMesQcm.indexOf("revealDiscoverActions()", readyIndex);
  assert.ok(renderIndex >= 0 && readyIndex > renderIndex && revealIndex > readyIndex);
});
