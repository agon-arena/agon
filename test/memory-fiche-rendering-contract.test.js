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
const QCM_SOURCE = fs.readFileSync(path.join(__dirname, "..", "views", "qcm-du-jour.html"), "utf8");

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

test("l'accueil garde le cadre Ma mémoire visible quand le chargement échoue", () => {
  assert.match(MEMORY_SOURCE, /cloudEl\.hidden = kind === "error" && !embeddedMarker;/);
  assert.match(MEMORY_SOURCE, /if \(embeddedMarker\) \{\s*statusEl\.hidden = true;[\s\S]+universe-empty-overlay[\s\S]+Impossible de charger ta mémoire pour le moment\.[\s\S]+universe-status__retry/);
  assert.match(MEMORY_SOURCE, /const UNIVERSE_FETCH_TIMEOUT_MS = 20000;/);
});

test("Ma mémoire réutilise un cache de session plus ancien si le réseau échoue", () => {
  assert.match(MEMORY_SOURCE, /const UNIVERSE_STALE_DATA_FALLBACK_MAX_AGE_MS = 24 \* 60 \* 60 \* 1000;/);
  assert.match(MEMORY_SOURCE, /function readStaleUniverseDataEntry\(\) \{\s*return readUniverseDataCacheEntry\(UNIVERSE_STALE_DATA_FALLBACK_MAX_AGE_MS\);\s*\}/);
  assert.match(MEMORY_SOURCE, /const staleUniverseEntry = readStaleUniverseDataEntry\(\);[\s\S]+if \(staleUniverseEntry\?\.data\) \{[\s\S]+universeData = staleUniverseEntry\.data;[\s\S]+await mountUniverseAndHideSpinnerWhenReady\(modeToken\);/);
});

test("Ma mémoire invalide son cache quand une connaissance change d'état de mémorisation", () => {
  assert.match(MEMORY_SOURCE, /function getUniverseInvalidationCacheKey\(\) \{/);
  assert.match(MEMORY_SOURCE, /function invalidateUniverseDataCache\(\) \{/);
  assert.match(MEMORY_SOURCE, /window\.mnoriaInvalidateUniverseCache = invalidateUniverseDataCache;/);
  assert.match(MEMORY_SOURCE, /if \(cached\.at <= getUniverseCacheInvalidatedAt\(\)\) return null;/);
  assert.match(MEMORY_SOURCE, /if \(ok\) invalidateUniverseDataCache\(\);/);
  assert.match(QCM_SOURCE, /function invalidateMnoriaUniverseCacheForCurrentUser\(\) \{/);
  assert.match(QCM_SOURCE, /sessionStorage\.removeItem\(dataKey\);/);
  assert.match(QCM_SOURCE, /localStorage\.setItem\(invalidationKey, invalidatedAt\)/);
  assert.match(QCM_SOURCE, /if \(ok\) \{\s*invalidateMnoriaUniverseCacheForCurrentUser\(\);/);
});

test("les titres de thématiques Ma mémoire sont masqués quand ils dépassent du cadre", () => {
  assert.match(MEMORY_SOURCE, /const LABEL_FRAME_PADDING_PX = 4;/);
  assert.match(MEMORY_SOURCE, /function isLabelRectFullyInsideFrame\(labelRect,\s*frameRect,\s*padding = 0\)/);
  assert.match(MEMORY_SOURCE, /const frameRect = viewportEl\.getBoundingClientRect\(\);/);
  assert.match(MEMORY_SOURCE, /if \(!isLabelRectFullyInsideFrame\(rect,\s*frameRect,\s*LABEL_FRAME_PADDING_PX\)\) \{/);
  assert.match(MEMORY_SOURCE, /outOfFrameLabels\.add\(label\);/);
  assert.match(MEMORY_SOURCE, /label\.style\.visibility = outOfFrame \? "hidden" : "";/);
});
