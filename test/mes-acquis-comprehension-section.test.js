"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const view = fs.readFileSync(path.join(__dirname, "../views/qcm-du-jour.html"), "utf8");
const start = view.indexOf("function renderMesAcquisList(quizzes)");
const end = view.indexOf("\n  // Même source de données que Découvrir", start);
const renderer = view.slice(start, end);

test("Mes acquis sépare les connaissances Comprendre les liens avant le regroupement thématique", () => {
  assert.match(renderer, /var comprehensionQuizzes = \[\]/);
  assert.match(renderer, /if \(q\.sourceType === 'comprendre'\) \{\s*comprehensionQuizzes\.push\(q\);\s*return;/);
  assert.doesNotMatch(renderer, /q\.sourceType === 'comprendre'\s*\?/,
    "Comprendre les liens ne doit plus devenir une sous-thématique de Tous mes apprentissages");
});

test("Comprendre les liens possède un bandeau blanc de premier niveau identique", () => {
  assert.match(renderer, /qcm-mesqcm-group qcm-mesqcm-group--comprehension/);
  assert.match(renderer, /<h2 class="qcm-mesqcm-group-title">Comprendre les liens<\/h2>/);
  assert.match(view, /\.qcm-mesqcm-group-title \{[\s\S]*?background: #ffffff;/);
});

test("la rubrique dédiée contient uniquement son tableau de connaissances avec liens", () => {
  assert.match(renderer, /renderMesQcmPaginatedTablesHtml\(comprehensionQuizzes\.slice\(\)\.sort\(compareMesQcmByStateThenName\), quizzes, false\)/);
  assert.ok(renderer.indexOf("Comprendre les liens</h2>") > renderer.indexOf("Tous mes apprentissages</h2>"));
});

test("Tous mes apprentissages reste affiché pour les autres thématiques et la rubrique dédiée fonctionne seule", () => {
  assert.match(renderer, /if \(themeNames\.length\) \{[\s\S]*Tous mes apprentissages/);
  assert.match(renderer, /themeNames\.length \? '' : ' qcm-mesqcm-group--all'/,
    "si elle est seule, la rubrique dédiée doit reprendre le positionnement du premier bandeau");
});
