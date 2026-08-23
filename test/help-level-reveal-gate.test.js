"use strict";

// Teste le VRAI code client (views/qcm-du-jour.html), pas une réimplémentation
// dupliquée — extrait le bloc needsRevealGate/renderRevealGateHtml tel quel
// (aucune logique de gating dupliquée ici, cf. section 4 "ne duplique pas de
// logique") et l'exécute dans un sandbox minimal (vm), sans jsdom (absent des
// dépendances du projet) : un stub `document.createElement` suffisant pour
// escapeHtml, aucun autre besoin DOM pour ces deux fonctions pures.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "views", "qcm-du-jour.html"), "utf8");

const startMarker = "  var QCM_REVEAL_GATE_TYPES = ['qcm', 'texte_a_trous', 'qcm_multi'];";
const endMarker = "  function wireRevealGate(hiddenElIds) {";
const startIndex = html.indexOf(startMarker);
const endIndex = html.indexOf(endMarker);
if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
  throw new Error("test/help-level-reveal-gate.test.js : marqueurs d'extraction introuvables dans views/qcm-du-jour.html — le code a bougé, adapter les marqueurs.");
}
const extractedSource = html.slice(startIndex, endIndex);

// escapeHtml (dépendance de renderRevealGateHtml) est définie ailleurs dans
// le fichier (hors du bloc extrait) — stub fonctionnellement équivalent
// (même comportement && < > que le escapeHtml réel, basé sur
// document.createElement) fourni comme global au sandbox, aucun des textes
// d'incitation ne contenant de guillemets à échapper.
function makeSandbox() {
  const sandbox = {
    escapeHtml: (str) => String(str == null ? "" : str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  };
  vm.createContext(sandbox);
  vm.runInContext(extractedSource, sandbox);
  return sandbox;
}

test("needsRevealGate : comportement inchangé — gate uniquement sur type éligible + selfContained + pas de réponse", () => {
  const sandbox = makeSandbox();
  assert.equal(sandbox.needsRevealGate("qcm", null, { selfContained: true }), true);
  assert.equal(sandbox.needsRevealGate("qcm", null, { selfContained: false }), false);
  assert.equal(sandbox.needsRevealGate("qcm", { correct: true }, { selfContained: true }), false, "déjà répondu -> jamais de gate");
  assert.equal(sandbox.needsRevealGate("association", null, { selfContained: true }), false, "format non éligible au gate");
  assert.equal(sandbox.needsRevealGate("intrus", null, { selfContained: true }), false, "intrus jamais gaté");
});

test("renderRevealGateHtml : le bouton existant #qcm-reveal-btn est toujours rendu, quel que soit helpLevel", () => {
  const sandbox = makeSandbox();
  for (const level of ["guided", "intermediate", "strong_recall", undefined, "valeur-inconnue"]) {
    const htmlOut = sandbox.renderRevealGateHtml(level);
    assert.match(htmlOut, /id="qcm-reveal-btn"/, `bouton absent pour helpLevel=${level}`);
    assert.match(htmlOut, /class="qcm-next-btn visible"/, "même classe CSS que l'existant, aucune nouvelle UI");
  }
});

test("renderRevealGateHtml : le texte varie selon helpLevel, jamais le mécanisme", () => {
  const sandbox = makeSandbox();
  assert.match(sandbox.renderRevealGateHtml("guided"), /Réfléchis à ta réponse, puis affiche les propositions/, "guided reprend le texte historique inchangé");
  assert.match(sandbox.renderRevealGateHtml("intermediate"), /Essaie de répondre avant/);
  assert.match(sandbox.renderRevealGateHtml("strong_recall"), /Retrouve la réponse de mémoire/);
});

test("renderRevealGateHtml : un helpLevel absent ou invalide retombe sur le texte guided, jamais une exception", () => {
  const sandbox = makeSandbox();
  const fallback = sandbox.renderRevealGateHtml(undefined);
  const guided = sandbox.renderRevealGateHtml("guided");
  assert.equal(fallback, guided);
  assert.doesNotThrow(() => sandbox.renderRevealGateHtml("format-inexistant"));
});

test("strong_recall ne rend jamais les propositions définitivement inaccessibles : le bouton de révélation reste toujours présent et cliquable (même markup qu'un <button> normal, jamais disabled)", () => {
  const sandbox = makeSandbox();
  const htmlOut = sandbox.renderRevealGateHtml("strong_recall");
  assert.doesNotMatch(htmlOut, /disabled/);
  assert.match(htmlOut, /<button type="button"/);
});
