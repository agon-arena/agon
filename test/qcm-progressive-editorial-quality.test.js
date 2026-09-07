"use strict";

// Audit qualité éditoriale et pédagogique du pipeline QCM progressif
// (07/09/2026, cas réel "Empire ottoman" — curriculum dominé par des
// statistiques/dates précises, questions Expert très majoritairement des
// restitutions directes avec distracteurs ±1 jour/±1 année). server.js ne
// peut pas être `require()` en test (il démarre tout le serveur Express à
// l'import) — ce fichier vérifie donc, en lisant server.js comme du TEXTE
// brut (jamais exécuté), que les correctifs de ce chantier sont bien en
// place. Même principe que test/qcm-progressive-elementary-threshold.test.js
// et test/qcm-progressive-level-ceiling-wiring.test.js.
//
// Portée volontairement additive : aucun test ci-dessous ne vérifie
// l'absence d'un ancien texte (sauf mention explicite), pour ne jamais
// entrer en conflit avec un futur enrichissement non lié à ce chantier.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

// ── Différenciation réelle des niveaux (section 6/7 de la demande) ────────

test("NOTION_QUIZ_LEVELS.avance : priorité aux causes/conséquences/mécanismes/relations, jamais aux seuls chiffres", () => {
  assert.match(SERVER_SOURCE, /Niveau avancé : couvre l'essentiel du sujet sous plusieurs angles différents, en donnant la priorité aux causes, conséquences, mécanismes, relations entre éléments du sujet et comparaisons simples/);
  assert.match(SERVER_SOURCE, /jamais seulement une restitution plus précise d'un fait déjà testable au niveau élémentaire/);
});

test("NOTION_QUIZ_LEVELS.expert : la difficulté vient de la causalité/relations/distinctions/comparaison, explicitement PAS de dates plus obscures ou de chiffres plus précis", () => {
  assert.match(SERVER_SOURCE, /la difficulté doit venir d'une exigence intellectuelle réellement supérieure \(causalité, relations entre plusieurs connaissances déjà admises, distinctions fines entre notions proches, fonctionnement institutionnel, comparaison, interprétation fondée sur ce qui est enseigné, conséquences indirectes, chronologie raisonnée\)/);
  assert.match(SERVER_SOURCE, /JAMAIS de dates plus obscures, de chiffres plus précis ou de noms plus secondaires/);
  assert.match(SERVER_SOURCE, /une question experte n'est pas une question élémentaire simplement rendue plus dure à retrouver/);
});

test("NOTION_QUIZ_LEVELS.expert : orientation éditoriale indicative (pas un quota strict) pour la répartition restitution/compréhension/distinctions/chronologie", () => {
  assert.match(SERVER_SOURCE, /environ 20 à 30 % de restitution précise, 35 à 45 % de compréhension\/relations\/causalité, 20 à 30 % de distinctions\/comparaison\/fonctionnement, et 5 à 15 % de chronologie ou de chiffres réellement importants/);
  assert.match(SERVER_SOURCE, /ne sacrifie jamais la qualité d'une question pour respecter mécaniquement ces proportions/);
});

test("NOTION_QUIZ_LEVELS.expert : les bornes techniques (target/max/min) restent inchangées — seule l'instruction éditoriale est réécrite", () => {
  assert.match(SERVER_SOURCE, /expert: \{\s*\n\s*label: "Expert",\s*\n\s*target: 20, max: 22, min: MIN_MASTER_QUESTIONS,/);
});

// ── Distracteurs (section 8 de la demande) ─────────────────────────────────

test("interdiction explicite du distracteur mécanique ±1 jour/±1 année sans confusion réellement plausible", () => {
  assert.match(SERVER_SOURCE, /Jamais de distracteur purement mécanique/);
  assert.match(SERVER_SOURCE, /ne fabrique jamais les distracteurs par simple décalage arithmétique de la bonne réponse \(ex\. ±1 jour, ±1 an, ±1 unité\) sans que ce décalage corresponde à une confusion réellement plausible/);
});

test("la règle anti-mécanique n'interdit pas les vraies confusions plausibles (nuance explicite conservée)", () => {
  assert.match(SERVER_SOURCE, /une autre date\/un autre nombre associé au même sujet et qu'on pourrait sincèrement confondre avec la bonne réponse/);
});

// ── Régénération ciblée quand il manque des questions (section 10) ────────

test("generateProgressiveLevelBlock : earlyStopTarget vise la couverture COMPLÈTE du niveau pour Deepening/Expert, jamais le seuil minimal de service (blockReadyThreshold) qui bloquait la régénération ciblée avant ce correctif", () => {
  assert.match(SERVER_SOURCE, /const earlyStopTarget = levelKey === "elementaire" \? blockReadyThreshold : levelKnowledge\.length;/);
  assert.match(SERVER_SOURCE, /earlyStopAtAccepted: earlyStopTarget,/);
  // blockReadyThreshold reste utilisé pour le seuil de service dégradé — jamais supprimé.
  assert.match(SERVER_SOURCE, /const degraded = validated\.length < blockReadyThreshold;/);
});

test("generateElementaryBlock/generateDeepeningBlock/generateExpertBlock continuent tous de passer readyThreshold=4 (MIN_ELEMENTARY_READY_QUESTIONS/MIN_PROGRESSIVE_BLOCK_READY_QUESTIONS) — seul l'usage interne de ce seuil change pour Deepening/Expert, jamais l'appel lui-même", () => {
  assert.match(SERVER_SOURCE, /readyThreshold: MIN_ELEMENTARY_READY_QUESTIONS\s*\n\s*\}\);\s*\n\}/);
  const deepeningExpertCalls = [...SERVER_SOURCE.matchAll(/readyThreshold: MIN_PROGRESSIVE_BLOCK_READY_QUESTIONS/g)];
  assert.equal(deepeningExpertCalls.length, 2, "generateDeepeningBlock et generateExpertBlock doivent tous deux passer ce seuil, inchangé");
});

// ── Fallback sans grounding (section 12) ────────────────────────────────────

test("resolveProgressiveCurriculum : trace explicitement dans les logs qu'un curriculum est généré sans aucun grounding web réel", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function resolveProgressiveCurriculum(apiKey, subject, contextHint, id, grounding) {");
  assert.ok(fnIndex > 0);
  const fnBody = SERVER_SOURCE.slice(fnIndex, fnIndex + 1200);
  assert.match(fnBody, /if \(!evidenceModeActive && !grounding\?\.groundingText\) \{/);
  assert.match(fnBody, /curriculum sans grounding web réel/);
});

// ── Sélection éditoriale du curriculum (sections 1/2/3/4/5 — vérifiées en
// détail sur les prompts purs dans test/notion-quiz-curriculum.test.js ;
// ici on verrouille seulement que buildCurriculumPrompt reste la SEULE
// source de ces règles, jamais dupliquées ni contournées côté server.js) ──

test("aucune logique de sélection éditoriale du curriculum n'est dupliquée dans server.js — buildCurriculumPrompt (lib/notion-quiz-curriculum.js) reste la seule source", () => {
  assert.doesNotMatch(SERVER_SOURCE, /RÈGLE FONDAMENTALE DE SÉLECTION/);
  assert.doesNotMatch(SERVER_SOURCE, /COUVERTURE ÉQUILIBRÉE DU SUJET/);
});

// ── Non-régression : aucun nouvel appel IA introduit par ce chantier ───────

test("aucune nouvelle feature ai_usage_log/generationId n'est introduite par ce chantier pour le pipeline progressif (les seules features existantes restent utilisées)", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function generateProgressiveLevelBlock({");
  const nextFnIndex = SERVER_SOURCE.indexOf("\nasync function generateElementaryBlock(", fnIndex);
  const fnBody = SERVER_SOURCE.slice(fnIndex, nextFnIndex > 0 ? nextFnIndex : fnIndex + 6000);
  const featureCalls = [...fnBody.matchAll(/feature: `?\$?\{?questionFeaturePrefix\}?_?[a-z_]*`?/g)];
  // Exactement les deux appels IA déjà existants (fiche + questions), jamais un troisième.
  assert.ok(featureCalls.length <= 2, `attendu au plus 2 appels IA distincts dans generateProgressiveLevelBlock, trouvé ${featureCalls.length}`);
});

// ══════════════════════════════════════════════════════════════════════
// Correctifs des deux causes racines (07/09/2026, suite au test réel
// post-correctif "Empire ottoman") : CHANTIER A (extraction web tronquée
// trop tôt) et CHANTIER B (quasi-doublons inter-niveaux). Comportement DÉTAILLÉ
// des fonctions pures déjà vérifié dans test/source-excerpt-selection.test.js
// et test/notion-quiz-curriculum.test.js — ce fichier verrouille uniquement
// le CÂBLAGE côté server.js, jamais recouvert ailleurs.
// ══════════════════════════════════════════════════════════════════════

// ── CHANTIER A — extraction web représentative (aucun nouvel appel Brave/IA
// systématique, cf. contrainte explicite) ─────────────────────────────────

test("resolveWebSearchGrounding : repli sur les candidats suivants déjà classés quand une source sélectionnée échoue à l'extraction — jamais un nouvel appel Brave, jamais un nouvel appel IA", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function resolveWebSearchGrounding(apiKey, subject, id) {");
  assert.ok(fnIndex > 0);
  const nextFnIndex = SERVER_SOURCE.indexOf("\nasync function ", fnIndex + 10);
  const fnBody = SERVER_SOURCE.slice(fnIndex, nextFnIndex > 0 ? nextFnIndex : fnIndex + 6000);
  assert.match(fnBody, /const missingCount = WEB_SEARCH_MAX_SELECTED_SOURCES - extracted\.length;/);
  assert.match(fnBody, /const fallbackCandidates = qualified\.filter\(\(c\) => !selectedDomains\.has\(c\.domain\)\)\.slice\(0, missingCount\);/);
  // Le repli réutilise extractAndValidateSource (même logique fetch+extract+
  // validate que la récupération initiale, jamais une seconde implémentation)
  // et ne déclenche jamais braveSearchRaw ni _callOpenAI dans son propre bloc.
  const fallbackBlockStart = fnBody.indexOf("const missingCount");
  const fallbackBlockEnd = fnBody.indexOf("if (!extracted.length)", fallbackBlockStart);
  const fallbackBlock = fnBody.slice(fallbackBlockStart, fallbackBlockEnd);
  assert.match(fallbackBlock, /fallbackCandidates\.map\(extractAndValidateSource\)/);
  assert.doesNotMatch(fallbackBlock, /braveSearchRaw/);
  assert.doesNotMatch(fallbackBlock, /_callOpenAI/);
});

test("resolveWebSearchGrounding : télémétrie légère du corpus final (sources sélectionnées/extraites, extraits par source), jamais le texte complet des sources", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function resolveWebSearchGrounding(apiKey, subject, id) {");
  const nextFnIndex = SERVER_SOURCE.indexOf("\nasync function ", fnIndex + 10);
  const fnBody = SERVER_SOURCE.slice(fnIndex, nextFnIndex > 0 ? nextFnIndex : fnIndex + 6000);
  assert.match(fnBody, /sourcesSelected: selected\.length, sourcesExtracted: extracted\.length,/);
  assert.match(fnBody, /excerpts: summarizeExtractedSourcesForTelemetry\(extracted\)/);
});

test("WEB_SEARCH_EXCERPT_MAX_CHARS relevé à 4000 (jamais 10000) — budget raisonnable, jamais un budget massif pris naïvement", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "web-search-grounding.js"), "utf8");
  assert.match(source, /const WEB_SEARCH_EXCERPT_MAX_CHARS = 4000;/);
});

test("buildGroundingText/buildIdentifiedSources utilisent selectRepresentativeExcerpt, jamais un slice naïf des N premiers caractères", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "web-search-grounding.js"), "utf8");
  assert.doesNotMatch(source, /\.slice\(0, WEB_SEARCH_EXCERPT_MAX_CHARS\)/);
  const occurrences = [...source.matchAll(/selectRepresentativeExcerpt\(s\.text, \{ budgetChars: WEB_SEARCH_EXCERPT_MAX_CHARS \}\)/g)];
  assert.ok(occurrences.length >= 2, "buildGroundingText ET buildIdentifiedSources doivent tous deux utiliser la sélection représentative");
});

// ── CHANTIER B — déduplication inter-niveaux ─────────────────────────────

test("continueProgressiveGeneration : otherLevelsKnowledge est calculé à partir de LEVEL_RANK (rang STRICTEMENT inférieur), jamais un simple \"niveau différent\"", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function continueProgressiveGeneration(masterSlot, topic, id, userId, targetLevel) {");
  assert.ok(fnIndex > 0);
  const nextFnIndex = SERVER_SOURCE.indexOf("\nasync function ", fnIndex + 10);
  const fnBody = SERVER_SOURCE.slice(fnIndex, nextFnIndex > 0 ? nextFnIndex : fnIndex + 8000);
  assert.match(fnBody, /const otherLevelsKnowledge = currentCurriculum\.filter\(\(k\) => k\.verified && \(CURRICULUM_LEVEL_RANK\[k\.level\] \?\? 99\) < CURRICULUM_LEVEL_RANK\[curriculumLevelKey\]\);/);
  assert.match(fnBody, /otherLevelsKnowledge\s*\n\s*\}\);/);
});

test("evidenceGateAndRepairCurriculumSubset : la déduplication inter-niveaux s'applique AVANT le test de seuil de réparation, jamais après (sinon la réparation ne comblerait pas le manque créé)", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function evidenceGateAndRepairCurriculumSubset({");
  assert.ok(fnIndex > 0);
  const nextFnIndex = SERVER_SOURCE.indexOf("\nasync function ", fnIndex + 10);
  const fnBody = SERVER_SOURCE.slice(fnIndex, nextFnIndex > 0 ? nextFnIndex : fnIndex + 6000);
  const dedupIndex = fnBody.indexOf("evictCrossLevelDuplicates([...otherLevelsKnowledge, ...accepted])");
  const thresholdIndex = fnBody.indexOf("if (accepted.length < targetSize) {");
  assert.ok(dedupIndex > 0 && thresholdIndex > dedupIndex, "la déduplication inter-niveaux doit précéder le test de seuil");
});

test("evidenceGateAndRepairCurriculumSubset : otherLevelsKnowledge n'est jamais évincé, seul `accepted` peut perdre des éléments", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function evidenceGateAndRepairCurriculumSubset({");
  const nextFnIndex = SERVER_SOURCE.indexOf("\nasync function ", fnIndex + 10);
  const fnBody = SERVER_SOURCE.slice(fnIndex, nextFnIndex > 0 ? nextFnIndex : fnIndex + 6000);
  assert.match(fnBody, /const otherIds = new Set\(otherLevelsKnowledge\.map\(\(k\) => k\.id\)\);/);
  assert.match(fnBody, /accepted = combined\.filter\(\(k\) => !otherIds\.has\(k\.id\)\);/);
});

test("le curriculum persisté reste borné par computeCurriculumSplit — le fait qu'un doublon inter-niveaux soit évincé puis réparé ne change jamais l'invariant de taille par niveau déjà testé dans lib/notion-quiz-curriculum.js", () => {
  // Verrou de non-régression : la fonction de split elle-même n'est jamais
  // touchée par ce chantier — cf. test/notion-quiz-curriculum.test.js pour
  // le détail complet (computeCurriculumSplit, MIN_LEVEL_SIZE...).
  const curriculumSource = fs.readFileSync(path.join(__dirname, "..", "lib", "notion-quiz-curriculum.js"), "utf8");
  assert.match(curriculumSource, /function computeCurriculumSplit\(total\) \{/);
});

// ── C — non-régression explicite des correctifs précédents ──────────────

test("C. earlyStopTarget reste intact : Élémentaire garde blockReadyThreshold, Approfondi/Expert visent levelKnowledge.length", () => {
  assert.match(SERVER_SOURCE, /const earlyStopTarget = levelKey === "elementaire" \? blockReadyThreshold : levelKnowledge\.length;/);
});

test("C. le cycle de régénération ciblée reste unique (maxRetries:1, semanticReviewEnabled:false) pour le pipeline progressif", () => {
  const body = SERVER_SOURCE.slice(SERVER_SOURCE.indexOf("async function generateProgressiveLevelBlock({"));
  assert.match(body.slice(0, 9000), /semanticReviewEnabled: false,\s*\n\s*maxRetries: 1,/);
});

test("C. la prudence historiographique et la sélection éditoriale du curriculum restent en place", () => {
  const curriculumSource = fs.readFileSync(path.join(__dirname, "..", "lib", "notion-quiz-curriculum.js"), "utf8");
  assert.match(curriculumSource, /PRUDENCE FACTUELLE ET HISTORIOGRAPHIQUE/);
  assert.match(curriculumSource, /RÈGLE FONDAMENTALE DE SÉLECTION/);
});

test("C. l'anti-distracteur mécanique et la diversification des sources restent en place", () => {
  assert.match(SERVER_SOURCE, /Jamais de distracteur purement mécanique/);
  const groundingSource = fs.readFileSync(path.join(__dirname, "..", "lib", "web-search-grounding.js"), "utf8");
  assert.match(groundingSource, /préfère une COMBINAISON complémentaire/);
});

test("C. topicValidation et l'evidence gate restent en place, jamais contournés par ce chantier", () => {
  assert.match(SERVER_SOURCE, /parseTopicValidationField/);
  assert.match(SERVER_SOURCE, /validateKnowledgeEvidence/);
});
