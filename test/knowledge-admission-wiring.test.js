"use strict";

// Garde-fous de câblage (demande du 17/08/2026, généralisation des variantes
// à Éclairages/Histoire) — server.js ne peut pas être `require()` dans un
// test (il démarre tout le serveur Express à l'import, cf. commentaire en
// tête de lib/question-formats.js) : les fonctions qui construisent les
// prompts eux-mêmes (buildQuestionFormatsPromptBlock, buildFormatAssignments,
// QUESTION_FORMAT_DEFS) restent dans server.js, pas extraites pour ce ticket
// (la logique NOUVELLE testable — sequential/clearBoundary, knowledgeTarget,
// admission — est déjà couverte unitairement dans lib/knowledge-admission.js
// et test/knowledge-admission.test.js ; ces fonctions-là sont pipeline-
// agnostiques et ne changent pas ici).
// Ce fichier vérifie donc, en lisant server.js comme un TEXTE brut (jamais
// exécuté), que le SEUL changement réel de ce ticket — quels appelants
// passent includeVariants:true vs false à buildQuestionFormatsPromptBlock —
// est bien celui attendu, et que les pipelines qui ne devaient PAS changer
// (Comprendre, énumérable) sont restés identiques. Un test fragile aux
// réagencements cosmétiques du code, mais qui verrouille exactement la
// régression qui compte ici : que la généralisation soit bien appliquée là
// où demandée, et nulle part ailleurs.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

test("Éclairages/Histoire (buildNotionQuestions, branche legacy) passe désormais includeVariants:true", () => {
  assert.match(
    SERVER_SOURCE,
    /const formatBlock = buildQuestionFormatsPromptBlock\("sourceId", admittedKnowledge\.length, true\);/,
    "la branche Éclairages/Histoire doit maintenant activer les variantes, comme le sujet libre"
  );
  assert.doesNotMatch(
    SERVER_SOURCE,
    /buildQuestionFormatsPromptBlock\("sourceId", admittedKnowledge\.length, false\)/,
    "l'ancien appel à includeVariants:false ne doit plus exister pour cette branche"
  );
});

test("sujet libre (generateNotionLevelQuiz) reste inchangé : includeVariants:true", () => {
  assert.match(
    SERVER_SOURCE,
    /const formatBlock = buildQuestionFormatsPromptBlock\("sourceId", accepted\.length, true\);/
  );
});

test("Comprendre les liens reste intact : includeVariants:false, intrus/ordre toujours exclus (aucune généralisation non demandée)", () => {
  assert.match(
    SERVER_SOURCE,
    /buildQuestionFormatsPromptBlock\("sourceId", COMPREHENSION_QUIZ_MAX_QUESTIONS, false, \["intrus", "ordre"\]\)/
  );
});

test("le flux énumérable (sujet libre \"Exhaustif\") reste intact : includeVariants:true, formats composites exclus", () => {
  assert.match(
    SERVER_SOURCE,
    /buildQuestionFormatsPromptBlock\("sourceId", count, true, \["intrus", "ordre", "association", "qcm_multi"\]\)\.slice\(0, -1\)/
  );
});

test("la suggestion de rotation est présentée comme une préférence, jamais une obligation prioritaire sur sequential/clearBoundary", () => {
  assert.match(SERVER_SOURCE, /Cette suggestion n'est qu'une préférence de départ/);
  assert.match(SERVER_SOURCE, /elle ne prime JAMAIS sur les contraintes liées au contenu réel de la connaissance testée/);
  assert.doesNotMatch(
    SERVER_SOURCE,
    /"Respecte cette suggestion\. Exception/,
    "l'ancienne formulation impérative ne doit plus être utilisée telle quelle"
  );
});

test("aucun format ne réintroduit vrai_faux dans la génération (QUESTION_FORMAT_DEFS / pool de rotation)", () => {
  assert.doesNotMatch(SERVER_SOURCE, /\{ type: "vrai_faux"/);
  assert.doesNotMatch(SERVER_SOURCE, /"qcm", "qcm", "vrai_faux"/);
});
