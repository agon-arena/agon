"use strict";

// Persister les sources factuelles (03/09/2026, audit read-only réel
// "Empire carolingien" — les 4 questions du bloc élémentaire portaient déjà
// source_ids/supporting_claim en base, mais rien ne résolvait "SOURCE_1"
// vers un domaine ou une URL réelle : grounding.identifiedSources ne
// vivait qu'en mémoire pendant la génération, jamais persisté). Ce fichier
// couvre :
// - buildPublicGroundingSources (lib/web-search-grounding.js), fonction
//   pure et réellement testée (pas seulement du texte brut) ;
// - le câblage server.js (persistance dans progressiveExtra, lecture/
//   réponse de GET .../fiche), en texte brut (server.js ne peut pas être
//   require()) — même principe que test/qcm-progressive-elementary-wiring.
//   test.js ;
// - le câblage views/qcm-du-jour.html (fusion + déduplication UI), en
//   texte brut — même principe que test/qcm-progressive-ui-wiring.test.js.
//
// Ne reteste jamais ce qui est déjà couvert ailleurs : le grounding lui-même
// (resolveWebSearchGrounding, buildIdentifiedSources, appendIdentifiedSources)
// reste testé par test/qcm-grounding-integration.test.js et son propre
// fichier ; ce chantier ne fait qu'AJOUTER une lecture supplémentaire de
// données déjà produites, jamais un second mécanisme de grounding.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { buildPublicGroundingSources } = require("../lib/web-search-grounding");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const VIEW_SOURCE = fs.readFileSync(path.join(__dirname, "..", "views", "qcm-du-jour.html"), "utf8");
const GROUNDING_SOURCE = fs.readFileSync(path.join(__dirname, "..", "lib", "web-search-grounding.js"), "utf8");
const QCM_QUALITY_SOURCE = fs.readFileSync(path.join(__dirname, "..", "lib", "qcm-quality.js"), "utf8");
const GROUNDING_VALIDATION_SOURCE = fs.readFileSync(path.join(__dirname, "..", "lib", "question-grounding-validation.js"), "utf8");

function identifiedSource(overrides = {}) {
  return {
    sourceId: "SOURCE_1",
    title: "Empire carolingien — Wikipédia",
    url: "https://en.wikipedia.org/wiki/Carolingian_Empire",
    domain: "en.wikipedia.org",
    text: "Texte extrait complet, potentiellement très long...",
    ...overrides
  };
}

// ── buildPublicGroundingSources : provenance minimale, SOURCE_N -> domaine/URL ──

test("buildPublicGroundingSources : résout sourceId -> domain/url, exactement les 3 champs demandés", () => {
  const result = buildPublicGroundingSources([identifiedSource()]);
  assert.deepEqual(result, [{ sourceId: "SOURCE_1", domain: "en.wikipedia.org", url: "https://en.wikipedia.org/wiki/Carolingian_Empire" }]);
  assert.deepEqual(Object.keys(result[0]).sort(), ["domain", "sourceId", "url"], "jamais text/title/sourceScore persistés");
});

test("buildPublicGroundingSources : plusieurs sources -> résolution correcte de CHAQUE sourceId, cas réel à 2 sources", () => {
  const sources = [
    identifiedSource({ sourceId: "SOURCE_1", domain: "en.wikipedia.org", url: "https://en.wikipedia.org/wiki/Carolingian_Empire" }),
    identifiedSource({ sourceId: "SOURCE_2", domain: "essentiels.bnf.fr", url: "https://essentiels.bnf.fr/fr/dossier/empire-carolingien" })
  ];
  const result = buildPublicGroundingSources(sources);
  assert.equal(result.length, 2);
  assert.deepEqual(result.find((s) => s.sourceId === "SOURCE_1"), { sourceId: "SOURCE_1", domain: "en.wikipedia.org", url: "https://en.wikipedia.org/wiki/Carolingian_Empire" });
  assert.deepEqual(result.find((s) => s.sourceId === "SOURCE_2"), { sourceId: "SOURCE_2", domain: "essentiels.bnf.fr", url: "https://essentiels.bnf.fr/fr/dossier/empire-carolingien" });
});

test("buildPublicGroundingSources : déduplique par URL (jamais par domaine), garde la première occurrence", () => {
  const sources = [
    identifiedSource({ sourceId: "SOURCE_1", url: "https://en.wikipedia.org/wiki/Carolingian_Empire" }),
    identifiedSource({ sourceId: "SOURCE_2", url: "https://en.wikipedia.org/wiki/Carolingian_Empire" }), // même URL
    identifiedSource({ sourceId: "SOURCE_3", domain: "en.wikipedia.org", url: "https://en.wikipedia.org/wiki/Charlemagne" }) // même domaine, URL différente : conservée
  ];
  const result = buildPublicGroundingSources(sources);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((s) => s.sourceId), ["SOURCE_1", "SOURCE_3"]);
});

test("buildPublicGroundingSources : ignore une entrée sans URL ou avec une URL non http(s), jamais une erreur", () => {
  const sources = [identifiedSource({ sourceId: "SOURCE_1", url: "" }), identifiedSource({ sourceId: "SOURCE_2", url: "javascript:alert(1)" }), identifiedSource({ sourceId: "SOURCE_3" })];
  const result = buildPublicGroundingSources(sources);
  assert.deepEqual(result.map((s) => s.sourceId), ["SOURCE_3"]);
});

test("buildPublicGroundingSources : tableau vide/non-tableau ne jette jamais", () => {
  assert.deepEqual(buildPublicGroundingSources([]), []);
  assert.deepEqual(buildPublicGroundingSources(null), []);
  assert.deepEqual(buildPublicGroundingSources(undefined), []);
});

test("buildPublicGroundingSources : jamais de champ text/title/sourceScore, même si présents en entrée", () => {
  const result = buildPublicGroundingSources([identifiedSource({ text: "x".repeat(5000), sourceScore: 87 })]);
  assert.equal(result[0].text, undefined);
  assert.equal(result[0].title, undefined);
  assert.equal(result[0].sourceScore, undefined);
});

// ── Persistance côté server.js : progressiveExtra ────────────────────────

test("grounding_sources persisté : progressiveExtra inclut grounding_sources dérivé de buildPublicGroundingSources(grounding.identifiedSources)", () => {
  assert.match(SERVER_SOURCE, /const publicGroundingSources = buildPublicGroundingSources\(grounding\?\.identifiedSources\);/);
  assert.match(SERVER_SOURCE, /const progressiveExtra = \{ curriculum, progressive_status: "elementary_ready", grounding_sources: publicGroundingSources \};/);
});

test("source image indépendante : publicGroundingSources dérive UNIQUEMENT de grounding.identifiedSources, jamais de sourceDetail.image ni de searchKnowledgeImage", () => {
  const declIndex = SERVER_SOURCE.indexOf("const publicGroundingSources = buildPublicGroundingSources(grounding?.identifiedSources);");
  assert.ok(declIndex >= 0);
  const nearby = SERVER_SOURCE.slice(declIndex - 200, declIndex + 400);
  assert.doesNotMatch(nearby, /searchKnowledgeImage|sourceDetail\.image/);
});

test("le grounding utilisé pour grounding_sources est l'INITIAL (`grounding`), jamais `currentGrounding` (post-V3.2, interne à generateElementaryBlock) — même précédent que sourceDetail.sources côté master legacy", () => {
  assert.doesNotMatch(SERVER_SOURCE, /buildPublicGroundingSources\(currentGrounding/);
  // Précédent legacy (generateNotionLevelQuiz) : même principe déjà appliqué, jamais recalculé après V3.2.
  assert.match(SERVER_SOURCE, /sourceDetail\.sources = grounding\?\.sources \|\| null;/);
});

test("l'insert daily_quiz étale bien progressiveExtra (donc grounding_sources) dans la ligne insérée", () => {
  assert.match(SERVER_SOURCE, /const \{ error: insertError \} = await supabase\.from\("daily_quiz"\)\.insert\(\{\s*\n\s*quiz_date: quizDate,\s*\n\s*slot: masterSlot,\s*\n\s*questions,\s*\n\s*source_debate_ids: \[\],\s*\n\s*\.\.\.progressiveExtra\s*\n\s*\}\);/);
});

// ── API : GET /api/users/notion-quizzes/fiche résout grounding_sources ──

test("GET .../fiche sélectionne grounding_sources dans les DEUX chemins (linkType/linkSourceId et slot+date)", () => {
  assert.match(SERVER_SOURCE, /\.from\("daily_quiz"\)\.select\("quiz_date, slot, questions, grounding_sources"\)/);
  assert.match(SERVER_SOURCE, /\.from\("daily_quiz"\)\.select\("questions, grounding_sources"\)\.eq\("quiz_date", quizDate\)\.eq\("slot", slot\)\.maybeSingle\(\);/);
});

test("GET .../fiche renvoie groundingSources dans la réponse JSON, au niveau du QCM (jamais répété par question)", () => {
  assert.match(SERVER_SOURCE, /sourceDetail: first\.sourceDetail \|\| null,[\s\S]{0,700}?groundingSources,\s*\n\s*links,/);
  // Jamais injecté dans le mapping questions.map(...) ci-dessous.
  const mapStart = SERVER_SOURCE.indexOf("questions: questions.map((q) => {");
  const mapEnd = SERVER_SOURCE.indexOf("})\n    });", mapStart);
  assert.doesNotMatch(SERVER_SOURCE.slice(mapStart, mapEnd), /groundingSources/);
});

test("groundingSources retombe sur [] (jamais undefined/null) quand grounding_sources est absent en base — comportement sûr pour tout quiz legacy", () => {
  assert.match(SERVER_SOURCE, /groundingSources = match\.grounding_sources \|\| \[\];/);
  assert.match(SERVER_SOURCE, /groundingSources = data\?\.grounding_sources \|\| \[\];/);
});

// ── source_ids question : non touché par ce chantier ────────────────────
// (déjà prouvé par les tests buildPublicGroundingSources ci-dessus : sa
// sortie ne porte jamais que sourceId/domain/url, jamais de champ dérivé de
// question.source_ids — buildPublicGroundingSources n'a d'ailleurs jamais
// accès aux questions, seulement à grounding.identifiedSources.)

// ── Migration SQL préparée, jamais exécutée ──────────────────────────────

test("migration grounding_sources préparée (fichier présent, ALTER TABLE additif) — non exécutée (aucune trace d'exécution dans server.js)", () => {
  const migrationSource = fs.readFileSync(path.join(__dirname, "..", "data", "migration-daily-quiz-grounding-sources.sql"), "utf8");
  assert.match(migrationSource, /ALTER TABLE daily_quiz ADD COLUMN IF NOT EXISTS grounding_sources JSONB;/);
  assert.doesNotMatch(migrationSource, /CREATE TABLE|DROP TABLE|DELETE FROM/i);
  assert.doesNotMatch(SERVER_SOURCE, /migration-daily-quiz-grounding-sources/);
});

// ── Frontend (views/qcm-du-jour.html) : fusion + déduplication UI ───────

test("buildFicheModalHtml accepte groundingSources comme dernier paramètre optionnel (rétrocompatible : les deux fiches sans grounding — erreur/Éclairages — restent inchangées)", () => {
  assert.match(VIEW_SOURCE, /function buildFicheModalHtml\(iconClass, rubricLabel, name, detail, extraHtml, themes, links, level, questionCount, groundingSources\) \{/);
});

test("le bloc Sources fusionne detail.sources (legacy) ET groundingSources (progressif) dans UNE SEULE liste, jamais deux blocs distincts", () => {
  assert.match(
    VIEW_SOURCE,
    /var ficheSources = \[\]\.concat\(\s*\n\s*Array\.isArray\(detail\.sources\) \? detail\.sources : \[\],\s*\n\s*Array\.isArray\(groundingSources\) \? groundingSources : \[\]\s*\n\s*\)\.filter\(/
  );
  // Un seul <h3>Sources</h3> dans tout le fichier (jamais dupliqué).
  assert.equal((VIEW_SOURCE.match(/<h3 class="qcm-fiche-section-label">Sources<\/h3>/g) || []).length, 1);
});

test("déduplication UI : le bloc Sources déduplique par URL avant affichage", () => {
  assert.match(VIEW_SOURCE, /var ficheSourcesSeenUrls = \{\};/);
  assert.match(VIEW_SOURCE, /ficheSourcesSeenUrls\[url\]\) return false;/);
  assert.match(VIEW_SOURCE, /ficheSourcesSeenUrls\[url\] = true;/);
});

test("le libellé affiché retombe sur domain quand title est absent (shape progressive {domain,url}), jamais une URL brute imposée quand un domaine existe", () => {
  assert.match(VIEW_SOURCE, /escapeHtml\(s\.title \|\| s\.domain \|\| s\.url\)/);
});

test("le call site openMesQcmFicheFromUrl transmet bien data.groundingSources à buildFicheModalHtml", () => {
  assert.match(
    VIEW_SOURCE,
    /buildFicheModalHtml\(meta\.icon, meta\.label, name, detail, corrigeHtml, data\.themes, data\.links, data\.level, questionCount, data\.groundingSources\)/
  );
});

test("source image indépendante côté UI : le bloc Sources et la figure image (captionText 'Image : ...') restent deux blocs de code totalement séparés, jamais fusionnés", () => {
  const sourcesBlockIndex = VIEW_SOURCE.indexOf("var ficheSourcesSeenUrls = {};");
  const imageBlockIndex = VIEW_SOURCE.lastIndexOf("if (detail.image && detail.image.url) {", sourcesBlockIndex);
  const imageBlockEnd = VIEW_SOURCE.indexOf("</figure>';\n    }", imageBlockIndex);
  assert.ok(imageBlockIndex >= 0 && imageBlockIndex < sourcesBlockIndex && imageBlockEnd > imageBlockIndex && imageBlockEnd < sourcesBlockIndex, "l'image est traitée avant, dans un bloc distinct");
  // Fenêtre limitée au CORPS du bloc image lui-même (jamais les commentaires
  // qui le suivent, qui documentent légitimement la fusion à venir).
  const imageBlockBody = VIEW_SOURCE.slice(imageBlockIndex, imageBlockEnd);
  assert.doesNotMatch(imageBlockBody, /groundingSources/, "le corps du bloc image ne référence jamais groundingSources");
});

// ── Aucune modification du grounding/validator ───────────────────────────

test("aucune modification du grounding : resolveWebSearchGrounding/buildIdentifiedSources/appendIdentifiedSources restent définis exactement une fois, comportement inchangé", () => {
  assert.equal((SERVER_SOURCE.match(/^async function resolveWebSearchGrounding\(/gm) || []).length, 1);
  assert.equal((GROUNDING_SOURCE.match(/^function buildIdentifiedSources\(/gm) || []).length, 1);
  assert.equal((GROUNDING_SOURCE.match(/^function appendIdentifiedSources\(/gm) || []).length, 1);
  // buildPublicGroundingSources est une fonction ADDITIVE, jamais appelée
  // depuis buildIdentifiedSources/appendIdentifiedSources elles-mêmes.
  const buildIdentifiedIndex = GROUNDING_SOURCE.indexOf("function buildIdentifiedSources(");
  const buildIdentifiedEnd = GROUNDING_SOURCE.indexOf("\n}", buildIdentifiedIndex);
  assert.doesNotMatch(GROUNDING_SOURCE.slice(buildIdentifiedIndex, buildIdentifiedEnd), /buildPublicGroundingSources/);
});

test("aucune modification du validateur : validateQuestionGrounding (lib/question-grounding-validation.js) reste défini exactement une fois, jamais appelé par buildPublicGroundingSources", () => {
  assert.equal((GROUNDING_VALIDATION_SOURCE.match(/^function validateQuestionGrounding\(/gm) || []).length, 1);
  assert.doesNotMatch(GROUNDING_SOURCE, /validateQuestionGrounding/);
});

test("aucune modification du pipeline qualité : lib/qcm-quality.js ne référence jamais grounding_sources/buildPublicGroundingSources", () => {
  assert.doesNotMatch(QCM_QUALITY_SOURCE, /grounding_sources|buildPublicGroundingSources/);
});
