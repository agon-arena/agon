"use strict";

// Rendu des niveaux pédagogiques dans les fiches QCM progressives
// (10/09/2026) : exécute les vraies fonctions frontend extraites de
// views/qcm-du-jour.html. Objectif : prouver que les niveaux affichés viennent
// des champs explicites section.level / question.level, sans réordonner ni
// perdre de contenu, et que les données legacy sans niveau restent lisibles.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const VIEW_SOURCE = fs.readFileSync(path.join(__dirname, "..", "views", "qcm-du-jour.html"), "utf8");

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `marqueur de début introuvable : ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `marqueur de fin introuvable : ${endMarker}`);
  return source.slice(start, end);
}

const SHARED_RENDER_SOURCE = extract(
  VIEW_SOURCE,
  "function escapeHtml(str) {",
  "\n  function renderMessage(text) {"
);

const QUESTIONS_RENDER_SOURCE = extract(
  VIEW_SOURCE,
  "function renderFicheQuestionCorrige(q, index) {",
  "\n  // Une ligne éditable"
);

function fakeEscapeHtmlText(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function makeSandbox() {
  const sandbox = {
    FILL_BLANK_MARKER: "___",
    QCM_FICHE_LEVEL_LABELS: {
      elementaire: "Élémentaire",
      avance: "Avancé",
      expert: "Expert"
    },
    document: {
      createElement() {
        const el = { _html: "" };
        Object.defineProperty(el, "textContent", {
          set(value) { el._html = fakeEscapeHtmlText(value); },
          get() { return el._html; }
        });
        Object.defineProperty(el, "innerHTML", { get() { return el._html; } });
        return el;
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(SHARED_RENDER_SOURCE + "\n" + QUESTIONS_RENDER_SOURCE, sandbox);
  return sandbox;
}

test("paragraphes : les sections Élémentaire, Avancé et Expert reçoivent un marqueur de niveau, dans l'ordre existant", () => {
  const sandbox = makeSandbox();
  const html = sandbox.renderFicheSectionsHtml([
    { level: "elementaire", text: "Base 1" },
    { level: "elementaire", text: "Base 2" },
    { level: "avance", text: "Approfondissement" },
    { level: "expert", text: "Point expert" }
  ]);
  assert.match(html, /Niveau Élémentaire/);
  assert.match(html, /Niveau Avancé/);
  assert.match(html, /Niveau Expert/);
  assert.ok(html.indexOf("Niveau Élémentaire") < html.indexOf("Base 1"));
  assert.ok(html.indexOf("Base 2") < html.indexOf("Niveau Avancé"));
  assert.ok(html.indexOf("Niveau Avancé") < html.indexOf("Approfondissement"));
  assert.ok(html.indexOf("Niveau Expert") < html.indexOf("Point expert"));
  assert.equal((html.match(/Niveau Élémentaire/g) || []).length, 1, "un même niveau consécutif n'est pas répété");
});

test("paragraphes legacy : une section sans niveau reste affichée sans niveau inventé", () => {
  const sandbox = makeSandbox();
  const html = sandbox.renderFicheSectionsHtml([{ text: "Ancien paragraphe" }]);
  assert.match(html, /Ancien paragraphe/);
  assert.doesNotMatch(html, /Niveau Élémentaire|Niveau Avancé|Niveau Expert/);
});

test("questions : les questions sont groupées par niveau fiable, sans perte et sans mauvais groupe", () => {
  const sandbox = makeSandbox();
  const html = sandbox.buildFicheQuestionsSectionInnerHtml({
    questions: [
      { level: "expert", question: "Question experte", options: ["A", "B"], correctIndex: 0 },
      { level: "elementaire", question: "Question élémentaire", options: ["C", "D"], correctIndex: 1 },
      { level: "avance", question: "Question avancée", options: ["E", "F"], correctIndex: 0 },
      { question: "Question legacy", options: ["G", "H"], correctIndex: 0 }
    ]
  }, false);
  assert.ok(html.indexOf("Questions — Niveau Élémentaire") < html.indexOf("Question élémentaire"));
  assert.ok(html.indexOf("Questions — Niveau Avancé") < html.indexOf("Question avancée"));
  assert.ok(html.indexOf("Questions — Niveau Expert") < html.indexOf("Question experte"));
  assert.ok(html.indexOf("Question élémentaire") < html.indexOf("Question avancée"));
  assert.ok(html.indexOf("Question avancée") < html.indexOf("Question experte"));
  assert.ok(html.includes("Question legacy"), "la question sans niveau n'est pas perdue");
  assert.ok(html.indexOf("Question legacy") > html.indexOf("Question experte"), "les questions sans niveau restent après les groupes fiables");
});
