"use strict";

// Verrous de câblage — V1 latence QCM (02/09/2026, cf. audit read-only
// "MNORIA — Optimisation vitesse QCM V1 conservatrice"). server.js ne peut
// pas être `require()` dans un test (il démarre tout le serveur Express à
// l'import) : ce fichier vérifie donc, en lisant server.js comme un TEXTE
// brut (jamais exécuté), que :
// - la classification taxonomy est bien lancée en parallèle du pipeline
//   qualité (jamais après), awaitée une seule fois, au bon endroit ;
// - grounding (resolveWebSearchGrounding) et l'expansion V3.2
//   (expandGroundingAndRegenerateMissingQuestions) restent appelés avec
//   EXACTEMENT les mêmes arguments qu'avant ce correctif — seule une mesure
//   de temps a été ajoutée autour de ces appels, jamais un changement de
//   comportement.
// Même principe que test/qcm-generation-id-wiring.test.js et
// test/notion-quiz-master-wiring.test.js (qui couvrent respectivement la
// forme précise de l'appel à generateNotionLevelQuiz/le retour final, et la
// propagation de generationId) — ce fichier-ci se concentre sur les points
// D/E/J/K de la demande V1, non déjà couverts ailleurs.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

function sliceBetween(startPattern, endMarker) {
  const startMatch = SERVER_SOURCE.match(startPattern);
  assert.ok(startMatch, `signature de début introuvable : ${startPattern}`);
  const start = startMatch.index;
  const endIdx = SERVER_SOURCE.indexOf(endMarker, start + startMatch[0].length);
  assert.ok(endIdx > start, `marqueur de fin introuvable après ${startPattern} : ${endMarker}`);
  return SERVER_SOURCE.slice(start, endIdx);
}

// ── D/E : plus aucun appel direct à classifyCultureGeneraleKnowledgePlacementWithAI
// dans buildNotionQuestions (branche niveau) ni buildCustomTopicQuiz — les
// deux doivent désormais passer par sourcePlacementPromise (lancée par
// generateNotionLevelQuiz), jamais rappeler la fonction elles-mêmes. ───────

test("E — buildNotionQuestions (branche niveau) n'appelle plus directement classifyCultureGeneraleKnowledgePlacementWithAI (ancien appel séquentiel supprimé)", () => {
  const fn = sliceBetween(/if \(level\) \{\s*\n\s*const subject = capitalizeFirstLetter/, "\n  }\n\n  // ── Comportement historique");
  assert.doesNotMatch(
    fn,
    /const sourcePlacement = await classifyCultureGeneraleKnowledgePlacementWithAI\(sourceType, sourceName, sourceDetail, userId, id\);/,
    "l'ancien appel séquentiel direct ne doit plus exister dans cette branche"
  );
  assert.match(fn, /const sourcePlacement = await sourcePlacementPromise;/);
});

test("E — buildCustomTopicQuiz n'appelle plus directement classifyCultureGeneraleKnowledgePlacementWithAI (ancien appel séquentiel supprimé)", () => {
  const fn = sliceBetween(/async function buildCustomTopicQuiz\(topic, id, rawLevel, userId\) \{/, "\n\n// Niveau 2 de déduplication");
  assert.doesNotMatch(
    fn,
    /const sourcePlacement = await classifyCultureGeneraleKnowledgePlacementWithAI\("custom", sourceName, sourceDetail, userId, id\);/,
    "l'ancien appel séquentiel direct ne doit plus exister dans cette fonction"
  );
  assert.match(fn, /const sourcePlacement = await sourcePlacementPromise;/);
});

// ── D : la Promise est awaitée seulement au point d'usage réel (juste avant
// sourceThemes/sourcePlacement, jamais avant), jamais plus haut ni ignorée. ─

test("D — buildNotionQuestions (branche niveau) : sourcePlacementPromise est awaitée immédiatement avant son utilisation (sourceThemes), après le retour de generateNotionLevelQuiz", () => {
  const fn = sliceBetween(/if \(level\) \{\s*\n\s*const subject = capitalizeFirstLetter/, "\n  }\n\n  // ── Comportement historique");
  const resultIndex = fn.indexOf("const result = await generateNotionLevelQuiz(");
  const awaitIndex = fn.indexOf("const sourcePlacement = await sourcePlacementPromise;");
  const usageIndex = fn.indexOf("const sourceThemes = sourcePlacement?.category");
  assert.ok(resultIndex > 0 && awaitIndex > resultIndex, "l'attente doit suivre l'appel à generateNotionLevelQuiz, jamais le précéder");
  assert.ok(usageIndex > awaitIndex && usageIndex - awaitIndex < 200, "sourcePlacement doit être utilisé immédiatement après avoir été attendu");
});

test("D — buildCustomTopicQuiz : sourcePlacementPromise est awaitée immédiatement avant son utilisation (sourceThemes), après le retour de generateNotionLevelQuiz", () => {
  const fn = sliceBetween(/async function buildCustomTopicQuiz\(topic, id, rawLevel, userId\) \{/, "\n\n// Niveau 2 de déduplication");
  const resultIndex = fn.indexOf("const result = await generateNotionLevelQuiz(");
  const awaitIndex = fn.indexOf("const sourcePlacement = await sourcePlacementPromise;");
  const usageIndex = fn.indexOf("const sourceThemes = sourcePlacement?.category");
  assert.ok(resultIndex > 0 && awaitIndex > resultIndex, "l'attente doit suivre l'appel à generateNotionLevelQuiz, jamais le précéder");
  assert.ok(usageIndex > awaitIndex && usageIndex - awaitIndex < 200, "sourcePlacement doit être utilisé immédiatement après avoir été attendu");
});

// ── J : grounding (resolveWebSearchGrounding) strictement inchangé — mêmes
// arguments, jamais une nouvelle dépendance ou un changement de résultat. ──

test("J — grounding inchangé : resolveWebSearchGrounding reste appelé avec exactement (apiKey, subject, id), une seule mesure de temps ajoutée autour", () => {
  assert.match(
    SERVER_SOURCE,
    /const groundingStartedAt = Date\.now\(\);\s*\n\s*let grounding = await resolveWebSearchGrounding\(apiKey, subject, id\);\s*\n\s*const groundingMs = Date\.now\(\) - groundingStartedAt;/
  );
  // La fonction elle-même (sa définition, son corps) n'est touchée par
  // aucun édit de ce correctif — un seul site d'appel dans tout le fichier.
  assert.equal((SERVER_SOURCE.match(/resolveWebSearchGrounding\(apiKey, subject, id\)/g) || []).length, 2, "1 définition + 1 site d'appel, inchangé");
});

// ── K : expansion V3.2 (expandGroundingAndRegenerateMissingQuestions)
// strictement inchangée — mêmes 9 champs transmis, jamais un champ de plus
// ou de moins, seule une mesure de temps ajoutée autour de l'appel. ────────

test("K — V3.2 inchangée : expandGroundingAndRegenerateMissingQuestions reçoit exactement les mêmes 9 champs qu'avant ce correctif", () => {
  assert.match(
    SERVER_SOURCE,
    /const expansionStartedAt = Date\.now\(\);\s*\n\s*const expansionOutcome = await expandGroundingAndRegenerateMissingQuestions\(\{\s*\n\s*apiKey, subject, id, instruction, timeoutMs,\s*\n\s*grounding, accepted, validated, questionQualityMetrics\s*\n\s*\}\);\s*\n\s*sourceExpansionMs = Date\.now\(\) - expansionStartedAt;/
  );
  // Un seul site d'appel réel (hors sa propre définition) : jamais rejoué
  // deux fois, jamais un second chemin d'expansion introduit.
  assert.equal((SERVER_SOURCE.match(/await expandGroundingAndRegenerateMissingQuestions\(\{/g) || []).length, 1);
});

// ── F : les arguments transmis à classifyCultureGeneraleKnowledgePlacementWithAI
// depuis generateNotionLevelQuiz sont dans le MÊME ordre et portent le MÊME
// sens que l'ancien appel direct des deux appelants (sourceType, sourceName,
// sourceDetail, userId, sourceDebateId=id) — seul QUI appelle et QUAND a
// changé, jamais la donnée transmise ni la fonction elle-même. ────────────

test("F — classification : mêmes arguments, même ordre, que l'ancien appel direct (sourceType, sourceName, sourceDetail, userId, id)", () => {
  assert.match(
    SERVER_SOURCE,
    /sourcePlacementPromise = classifyCultureGeneraleKnowledgePlacementWithAI\(\s*\n\s*classificationContext\.sourceType, sourceName, sourceDetail, classificationContext\.userId, id\s*\n\s*\)/
  );
  assert.match(
    SERVER_SOURCE,
    /async function classifyCultureGeneraleKnowledgePlacementWithAI\(sourceType, sourceName, sourceDetail, userId, sourceDebateId\)/,
    "signature de la fonction elle-même non modifiée par ce correctif"
  );
});

// ── Sécurité de la parallélisation : jamais d'avertissement Node
// "unhandledRejection" pendant la longue attente parallèle — la Promise est
// catchée une fois en plus (no-op) à sa création, l'erreur réelle restant
// intégralement propagée à l'await de l'appelant. ──────────────────────────

test("sourcePlacementPromise : un handler .catch(() => {}) est attaché dès la création, pour éviter un unhandledRejection pendant l'attente parallèle du pipeline qualité", () => {
  assert.match(SERVER_SOURCE, /sourcePlacementPromise\.catch\(\(\) => \{\}\);/);
});
