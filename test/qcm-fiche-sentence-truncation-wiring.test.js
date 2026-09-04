"use strict";

// Verrous de câblage — Phase 2.2 (04/09/2026, correctif "paragraphe
// pédagogique jamais servi tronqué en milieu de phrase", diagnostic réel
// "En 532, Justinien décide de faire réprimer la révolte avec" coupé avant
// "l'aide du général Bélisaire."). server.js ne peut pas être `require()` en
// test — ce fichier vérifie donc, en lisant server.js/lib/*.js/le frontend
// comme du TEXTE brut (jamais exécuté), que truncateAtSentenceBoundary est
// bien le SEUL mécanisme de troncature appliqué au texte des sections de
// fiche, pour les 3 niveaux (Élémentaire/Approfondi/Expert), sans reprise en
// aval (route /fiche, fusion cumulative, frontend). Le comportement de la
// fonction pure elle-même est prouvé par test/text-boundaries.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const QCM_FRONTEND_SOURCE = fs.readFileSync(path.join(__dirname, "../views/qcm-du-jour.html"), "utf8");

test("truncateAtSentenceBoundary est importée depuis lib/text-boundaries, aux côtés de truncateAtTextBoundary", () => {
  assert.match(SERVER_SOURCE, /const \{ truncateAtTextBoundary, truncateAtSentenceBoundary \} = require\("\.\/lib\/text-boundaries"\);/);
});

test("parseFicheAndKnowledgeCandidates plafonne section.text via truncateAtSentenceBoundary, jamais un .slice(0, sectionTextLimit) brut", () => {
  const fnIndex = SERVER_SOURCE.indexOf("function parseFicheAndKnowledgeCandidates(parsed, fallbackName, levelConfig) {");
  assert.ok(fnIndex > 0);
  const nextFnIndex = SERVER_SOURCE.indexOf("\nfunction ", fnIndex + 10);
  const fnBody = SERVER_SOURCE.slice(fnIndex, nextFnIndex > 0 ? nextFnIndex : fnIndex + 2000);
  assert.match(fnBody, /text: truncateAtSentenceBoundary\(s\?\.text, sectionTextLimit\)/);
  assert.doesNotMatch(fnBody, /text: String\(s\?\.text \|\| ""\)\.trim\(\)\.slice\(0, sectionTextLimit\)/, "l'ancien slice brut ne doit plus exister");
});

// ── 6/7/8. Élémentaire / Approfondi / Expert : les 3 niveaux partagent la
// MÊME fonction de parsing (parseFicheAndKnowledgeCandidates), donc le
// correctif s'applique uniformément aux 3 — verrouillé ici en confirmant
// que le SEUL point d'appel du parsing progressif (generateProgressiveLevelBlock,
// exécuté une fois par niveau avec le levelConfig de ce niveau) passe bien
// par cette fonction, plutôt que par une logique de troncature dupliquée
// par niveau qui aurait pu être oubliée pour Approfondi/Expert. ──────────

test("6/7/8. generateProgressiveLevelBlock (Élémentaire/Approfondi/Expert) appelle parseFicheAndKnowledgeCandidates pour chaque bloc, avec le levelConfig du niveau en cours (sectionTextLimit correct par niveau)", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function generateProgressiveLevelBlock({");
  assert.ok(fnIndex > 0);
  const nextFnIndex = SERVER_SOURCE.indexOf("\nasync function ", fnIndex + 10);
  const fnBody = SERVER_SOURCE.slice(fnIndex, nextFnIndex > 0 ? nextFnIndex : fnIndex + 4000);
  assert.match(fnBody, /const levelConfig = NOTION_QUIZ_LEVELS\[levelKey\];/);
  assert.match(fnBody, /const parsed = parseFicheAndKnowledgeCandidates\(candidate, subject, levelConfig\);/, "le parsing (et donc le plafond par phrase) doit utiliser le levelConfig du niveau EN COURS, jamais un niveau fixe");
});

test("les 3 blocs progressifs (elementaire/avance/expert) sont bien générés via generateProgressiveLevelBlock, avec ficheBuilder distinct pour le premier (buildElementaryFichePrompt) et les suivants (buildProgressiveContinuationFichePrompt, un appel par niveau Approfondi/Expert)", () => {
  assert.match(SERVER_SOURCE, /ficheBuilder: buildElementaryFichePrompt,/);
  const continuationCalls = [...SERVER_SOURCE.matchAll(/ficheBuilder: \(s, c, k, lc, gt\) => buildProgressiveContinuationFichePrompt\(s, c, k, lc, gt, priorSectionsText, "(Approfondi|Expert)"\),/g)];
  assert.equal(continuationCalls.length, 2, "un appel de continuation par niveau (Approfondi, Expert)");
});

test("la fusion cumulative (continueProgressiveGeneration) concatène les sections déjà tronquées par phrase sans jamais les re-découper (aucun .slice sur .text dans la fusion)", () => {
  const fnIndex = SERVER_SOURCE.indexOf("async function continueProgressiveGeneration(masterSlot, topic, id, userId, targetLevel) {");
  assert.ok(fnIndex > 0);
  const nextFnIndex = SERVER_SOURCE.indexOf("\nasync function ", fnIndex + 10);
  const fnBody = SERVER_SOURCE.slice(fnIndex, nextFnIndex > 0 ? nextFnIndex : fnIndex + 6000);
  assert.match(fnBody, /const mergedSections = \[\s*\n\s*\.\.\.\(currentQuestions\[0\]\?\.sourceDetail\?\.sections \|\| \[\]\),\s*\n\s*\.\.\.\(blockResult\.sourceDetail\?\.sections \|\| \[\]\)\s*\n\s*\];/, "la fusion doit rester une simple concaténation de tableaux, jamais une reconstruction de texte");
  assert.doesNotMatch(fnBody, /\.text\.slice\(/, "aucune re-troncature du texte des sections pendant la fusion cumulative");
});

// ── 9. GET .../fiche : aucune troncature additionnelle du texte servi. ────

test("9. GET /api/users/notion-quizzes/fiche ne re-tronque jamais section.text (aucun .slice/.substring sur .text dans la route)", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/fiche"');
  assert.ok(routeIndex > 0);
  const nextRouteIndex = SERVER_SOURCE.indexOf("\napp.get(", routeIndex + 10);
  const routeBody = SERVER_SOURCE.slice(routeIndex, nextRouteIndex > 0 ? nextRouteIndex : routeIndex + 6000);
  assert.doesNotMatch(routeBody, /\.text\.(slice|substring|substr)\(/, "la route fiche ne doit jamais re-tronquer le texte déjà finalisé à la génération");
  // Le filtrage par niveau des sections (déjà en place, cf. §8 du chantier
  // précédent) porte sur le TABLEAU sections lui-même (garde/retire des
  // sections entières), jamais sur le contenu textuel d'une section gardée.
  assert.match(routeBody, /\(first\.sourceDetail\.sections \|\| \[\]\)\.filter\(\(s\) => !s\.level \|\| progressiveLevelRank\(s\.level\) <= effectiveLevelRank\)/);
});

// ── 10. Frontend : rendu direct, aucune troncature JS du texte affiché. ───

test("10. le frontend (qcm-du-jour.html) affiche section.text intégralement (escapeHtml seul), sans slice/substring/ellipsis appliqué au texte pédagogique", () => {
  const renderIndex = QCM_FRONTEND_SOURCE.indexOf('html += \'<p class="qcm-fiche-explanation">\' + escapeHtml(section.text) + \'</p>\';');
  assert.ok(renderIndex > 0, "le rendu direct doit exister tel quel");
  assert.doesNotMatch(QCM_FRONTEND_SOURCE, /section\.text\.(slice|substring|substr)\(/, "le frontend ne doit jamais tronquer le texte pédagogique côté client");
});
