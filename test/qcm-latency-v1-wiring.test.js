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
  // Génération progressive (Phase 1, 02/09/2026 ; parallélisation
  // fiche/questions, 03/09/2026 ; sur-génération initiale, 03/09/2026 suite) :
  // un second site d'appel, dans generateElementaryBlock (désormais dans sa
  // tâche `questionsTask` interne), réutilise V3.2 TEL QUEL pour le bloc
  // élémentaire (cf. rapport section 10) — mêmes 9 champs, `instruction`/
  // `accepted` toujours aliasés (levelConfig.instruction/admittedKnowledge),
  // et `grounding` aliasé en `currentGrounding` (variable locale à la tâche,
  // pour ne jamais muter le paramètre `grounding` de la fonction depuis une
  // tâche parallèle). Jamais un second chemin d'expansion réinventé, jamais
  // rejoué deux fois pour un même appelant. Seul `questionQualityMetrics`
  // (9e champ) est désormais un objet dérivé — { ...questionQualityMetrics,
  // finalAccepted: validated.length } — plutôt que la variable brute, cf.
  // audit latence "Empire carolingien" (rapport sur-génération initiale,
  // section 5) : `validated.length` est déjà consolidé à une question par
  // connaissance DISTINCTE à ce point, jamais le nombre brut de candidats
  // acceptés par le pipeline qualité (qui peut dépasser le nombre de
  // connaissances elementary avec la sur-génération) — sans cette
  // correction, shouldExpandGroundingSources calculerait un ratio
  // artificiellement gonflé (ex. 4/8 au lieu de 4/5).
  assert.match(
    SERVER_SOURCE,
    /const expansionOutcome = await expandGroundingAndRegenerateMissingQuestions\(\{\s*\n\s*apiKey, subject, id, instruction: levelConfig\.instruction, timeoutMs,\s*\n\s*grounding: currentGrounding, accepted: admittedKnowledge, validated,\s*\n\s*questionQualityMetrics: \{ \.\.\.questionQualityMetrics, finalAccepted: validated\.length \}\s*\n\s*\}\);/
  );
  assert.equal((SERVER_SOURCE.match(/await expandGroundingAndRegenerateMissingQuestions\(\{/g) || []).length, 2, "1 site legacy + 1 site progressif (bloc élémentaire), jamais plus");
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
