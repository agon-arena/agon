"use strict";

// Ma mémoire ouvre les mêmes fiches que la page Apprentissage : les planètes
// ne doivent pas retomber sur un rendu partiel qui perd sources, niveaux,
// highlights, questions ou connaissances à mémoriser.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const MEMORY_SOURCE = fs.readFileSync(path.join(__dirname, "..", "public", "mon-univers.js"), "utf8");
const STYLE_SOURCE = fs.readFileSync(path.join(__dirname, "..", "public", "style.css"), "utf8");

test("Ma mémoire récupère la fiche canonique /api/users/notion-quizzes/fiche avant de rendre une planète", () => {
  assert.match(MEMORY_SOURCE, /fetch\(`\/api\/users\/notion-quizzes\/fiche\?\$\{params\.toString\(\)\}`,\s*\{\s*cache:\s*"no-store"\s*\}\)/);
  assert.match(MEMORY_SOURCE, /new URLSearchParams\(\{\s*slot:\s*article\.quizSlot,\s*date:\s*article\.quizDate,\s*legacyKey:\s*getKey\(\)\s*\}\)/);
});

test("le rendu Ma mémoire utilise les blocs complets de la fiche Apprentissage", () => {
  assert.match(MEMORY_SOURCE, /html \+= renderFicheSectionsHtml\(detail\.sections\);/);
  assert.match(MEMORY_SOURCE, /html \+= renderLinksSection\(fullFiche\?\.links\);/);
  assert.match(MEMORY_SOURCE, /html \+= buildKnowledgeMemorizationSectionHtml\(fullFiche\);/);
  assert.match(MEMORY_SOURCE, /html \+= buildFicheQuestionsSectionInnerHtml\(fullFiche\);/);
  assert.match(MEMORY_SOURCE, /html \+= buildFicheSourcesHtml\(detail,\s*fullFiche\?\.groundingSources\);/);
  assert.match(MEMORY_SOURCE, /wireKnowledgeMemorizationToggles\(sheet,\s*fullFiche\);/);
});

test("les sujets recherchés/custom ne sont plus affichés comme une fiche générique", () => {
  assert.match(MEMORY_SOURCE, /custom:\s*\{\s*icon:\s*"fa-magnifying-glass",\s*label:\s*"Sujet recherché"\s*\}/);
});

test("les styles Ma mémoire couvrent les blocs ajoutés aux fiches", () => {
  assert.match(STYLE_SOURCE, /\.universe-star-panel__knowledge-sheet \.qcm-fiche-level-marker/);
  assert.match(STYLE_SOURCE, /\.universe-star-panel__knowledge-sheet \.qcm-fiche-sources/);
  assert.match(STYLE_SOURCE, /\.universe-star-panel__knowledge-sheet \.qcm-fiche-memorization-toggle/);
  assert.match(STYLE_SOURCE, /\.universe-star-panel__knowledge-sheet \.qcm-blank/);
});
