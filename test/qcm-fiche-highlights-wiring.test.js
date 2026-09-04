"use strict";

// Verrous de câblage — Phase 2.4 (04/09/2026, "mise en évidence des
// knowledgeTargets dans les paragraphes de fiche"). server.js ne peut pas
// être `require()` en test — ce fichier vérifie donc, en lisant server.js/
// lib/knowledge-admission.js comme du TEXTE brut (jamais exécuté), que le
// câblage attendu est bien en place. Le comportement des fonctions pures
// elles-mêmes (matching texte, filtre par id) est prouvé par
// test/fiche-highlights.test.js ; le rendu frontend par
// test/qcm-fiche-highlights-render.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const ADMISSION_SOURCE = fs.readFileSync(path.join(__dirname, "../lib/knowledge-admission.js"), "utf8");

test("resolveSectionHighlights et filterHighlightsToKnownTargetIds sont importées depuis lib/fiche-highlights", () => {
  assert.match(SERVER_SOURCE, /const \{ resolveSectionHighlights, filterHighlightsToKnownTargetIds \} = require\("\.\/lib\/fiche-highlights"\);/);
});

// ── Ordre : parsing -> texte final/troncature -> résolution des highlights
// (contre CE texte final) -> persistence. Jamais avant la troncature. ────

test("parseFicheAndKnowledgeCandidates résout les highlights sur le texte APRÈS truncateAtSentenceBoundary, jamais avant", () => {
  const fnIndex = SERVER_SOURCE.indexOf("function parseFicheAndKnowledgeCandidates(parsed, fallbackName, levelConfig) {");
  assert.ok(fnIndex > 0);
  const nextFnIndex = SERVER_SOURCE.indexOf("\nfunction ", fnIndex + 10);
  const fnBody = SERVER_SOURCE.slice(fnIndex, nextFnIndex > 0 ? nextFnIndex : fnIndex + 2500);
  const truncateIndex = fnBody.indexOf("const text = truncateAtSentenceBoundary(s?.text, sectionTextLimit);");
  const resolveIndex = fnBody.indexOf("highlights: resolveSectionHighlights(text, s?.highlights)");
  assert.ok(truncateIndex > 0 && resolveIndex > truncateIndex, "la résolution des highlights doit utiliser `text` (déjà tronqué), jamais s?.text brut");
  assert.doesNotMatch(fnBody, /resolveSectionHighlights\(s\?\.text,/, "jamais de résolution sur le texte brut non tronqué");
});

// ── Filtre par id : uniquement les knowledgeTargets FOURNIS À LUNA pour CE
// bloc de niveau (levelKnowledge), jamais le curriculum entier. ───────────

test("generateProgressiveLevelBlock filtre les highlights aux seuls ids de levelKnowledge (jamais le curriculum complet, jamais un autre bloc/niveau)", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function generateProgressiveLevelBlock({");
  assert.ok(fnIndex > 0);
  const nextFnIndex = SERVER_SOURCE.indexOf("\nasync function ", fnIndex + 10);
  const fnBody = SERVER_SOURCE.slice(fnIndex, nextFnIndex > 0 ? nextFnIndex : fnIndex + 6000);
  assert.match(fnBody, /const validHighlightTargetIds = new Set\(levelKnowledge\.map\(\(k\) => k\.id\)\);/);
  const validIdsIndex = fnBody.indexOf("const validHighlightTargetIds = new Set(levelKnowledge.map((k) => k.id));");
  const filterIndex = fnBody.indexOf("highlights: filterHighlightsToKnownTargetIds(s.highlights, validHighlightTargetIds)");
  assert.ok(validIdsIndex > 0 && filterIndex > validIdsIndex);
});

test("les 3 blocs (Élémentaire/Approfondi/Expert) passent chacun leur PROPRE sous-ensemble de curriculum comme levelKnowledge — jamais le curriculum complet", () => {
  assert.match(SERVER_SOURCE, /levelKnowledge: elementaryKnowledge, grounding,/);
  assert.match(SERVER_SOURCE, /levelKnowledge: deepeningKnowledge, grounding,/);
  assert.match(SERVER_SOURCE, /levelKnowledge: expertKnowledge, grounding,/);
});

// ── Continuation : les sections déjà servies (et leurs highlights) sont
// concaténées telles quelles, jamais recalculées ni perdues. ─────────────

test("la fusion cumulative (continueProgressiveGeneration) concatène les sections PRÉCÉDENTES telles quelles (spread complet) — leurs highlights survivent donc sans recalcul", () => {
  const mergeIndex = SERVER_SOURCE.indexOf("const mergedSections = [");
  assert.ok(mergeIndex > 0);
  const mergeBlock = SERVER_SOURCE.slice(mergeIndex, mergeIndex + 200);
  assert.match(mergeBlock, /\.\.\.\(currentQuestions\[0\]\?\.sourceDetail\?\.sections \|\| \[\]\),\s*\n\s*\.\.\.\(blockResult\.sourceDetail\?\.sections \|\| \[\]\)/);
  // Spread intégral des objets section (jamais une reconstruction champ par
  // champ qui pourrait omettre `highlights`).
  assert.doesNotMatch(mergeBlock, /label:\s*s\.label/, "jamais une reconstruction manuelle des sections précédentes");
});

// ── Prompt Luna : schéma + consigne, sur les DEUX fonctions de rédaction de
// fiche progressive (Elementary et continuation), avec l'id RÉEL du
// curriculum (k.id), jamais un index de boucle local. ─────────────────────

test("buildElementaryFichePrompt et buildProgressiveContinuationFichePrompt listent les connaissances par leur id RÉEL de curriculum (k.id), jamais un index de boucle local (i+1)", () => {
  assert.match(ADMISSION_SOURCE, /elementaryKnowledge\.map\(\(k\) => `\$\{k\.id\}\. \$\{k\.knowledgeTarget\}`\)/);
  assert.match(ADMISSION_SOURCE, /levelKnowledge\.map\(\(k\) => `\$\{k\.id\}\. \$\{k\.knowledgeTarget\}`\)/);
  assert.doesNotMatch(ADMISSION_SOURCE, /\.map\(\(k, i\) => `\$\{i \+ 1\}\. \$\{k\.knowledgeTarget\}`\)/, "l'ancien index de boucle local ne doit plus être utilisé pour la numérotation");
});

test("les deux prompts de fiche progressive portent HIGHLIGHT_INSTRUCTION et le schéma JSON highlights", () => {
  assert.match(ADMISSION_SOURCE, /const HIGHLIGHT_INSTRUCTION = /);
  const occurrences = [...ADMISSION_SOURCE.matchAll(/lines\.push\(HIGHLIGHT_INSTRUCTION\);/g)];
  assert.equal(occurrences.length, 2, "les deux fonctions de rédaction de fiche progressive doivent inclure la consigne");
  assert.match(ADMISSION_SOURCE, /"sections" : \$\{sectionsRange\} bloc\(s\) \{"label": string ou null, "text": string, "highlights": \[\.\.\.\]\}/g);
  assert.match(ADMISSION_SOURCE, /"highlights":\[\{"knowledgeTargetId":"k1","text":"\.\.\."\}\]/);
  assert.match(ADMISSION_SOURCE, /"highlights":\[\{"knowledgeTargetId":"k6","text":"\.\.\."\}\]/);
});

test("HIGHLIGHT_INSTRUCTION interdit explicitement les ids inventés/d'un autre bloc et impose la copie EXACTE depuis text", () => {
  const constIndex = ADMISSION_SOURCE.indexOf("const HIGHLIGHT_INSTRUCTION = ");
  const constLine = ADMISSION_SOURCE.slice(constIndex, ADMISSION_SOURCE.indexOf("\n", constIndex + 200) + 400);
  assert.match(constLine, /jamais un identifiant inventé/);
  assert.match(constLine, /copiée EXACTEMENT/);
  assert.match(constLine, /jamais une phrase entière/);
  assert.match(constLine, /n'en fournis simplement aucune/);
});

// ── Aucun appel IA supplémentaire : la consigne vit dans le MÊME appel de
// rédaction de fiche (_callOpenAI déjà existant), jamais un second appel. ──

test("aucun nouvel appel _callOpenAI introduit pour les highlights : generateProgressiveLevelBlock garde exactement 2 appels (fiche puis questions)", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function generateProgressiveLevelBlock({");
  const nextFnIndex = SERVER_SOURCE.indexOf("\nasync function ", fnIndex + 10);
  const fnBody = SERVER_SOURCE.slice(fnIndex, nextFnIndex > 0 ? nextFnIndex : fnIndex + 6000);
  const calls = [...fnBody.matchAll(/await _callOpenAI\(/g)];
  assert.equal(calls.length, 2, "1 appel fiche + 1 appel questions, jamais un 3e appel dédié aux highlights");
});

// ── Frontend : le renderer est bien appelé à la place de escapeHtml(section.text) ──

test("buildFicheModalHtml appelle renderFicheSectionText(section.text, section.highlights), plus escapeHtml(section.text) seul", () => {
  const QCM_FRONTEND_SOURCE = fs.readFileSync(path.join(__dirname, "../views/qcm-du-jour.html"), "utf8");
  assert.match(QCM_FRONTEND_SOURCE, /html \+= '<p class="qcm-fiche-explanation">' \+ renderFicheSectionText\(section\.text, section\.highlights\) \+ '<\/p>';/);
  assert.doesNotMatch(QCM_FRONTEND_SOURCE, /'<p class="qcm-fiche-explanation">' \+ escapeHtml\(section\.text\) \+/);
});
