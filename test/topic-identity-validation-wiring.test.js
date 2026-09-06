"use strict";

// Vérification de clarté/identité du sujet (demande du 06/09/2026, incident
// réel "Baudouin de Hainaut" : une fiche unique avait mélangé le diplomate du
// XIIIe siècle et Baudouin IV de Hainaut, comte du XIIe siècle). Contrairement
// à test/topic-identity-validation.test.js (logique pure, testée en
// isolation), ce fichier vérifie le CÂBLAGE réel dans server.js et
// views/qcm-du-jour.html par recherche de motifs — même principe que les
// autres *-wiring.test.js de ce dossier (server.js démarre tout le serveur
// Express à l'import et ne peut pas être testé unitairement autrement).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const view = fs.readFileSync(path.join(root, "views/qcm-du-jour.html"), "utf8");

test("server.js : le pipeline progressif (curriculum_generation) vérifie topicValidation avant tout découpage/gate du curriculum", () => {
  assert.match(server, /const \{ parseTopicValidationField \} = require\("\.\/lib\/topic-identity-validation"\);/);
  const start = server.indexOf("async function resolveProgressiveCurriculum(");
  const end = server.indexOf("\n// Concatène les sections", start);
  const fn = server.slice(start, end > -1 ? end : start + 4000);
  assert.match(fn, /topicValidation = parseTopicValidationField\(rawParsed\?\.topicValidation\)/);
  assert.match(fn, /topicValidation\.status === "ambiguous"/);
  assert.match(fn, /generationFailure\("TOPIC_AMBIGUOUS", "topic_validation"/);
  assert.match(fn, /\[topic-validation\] status=ambiguous topic="\$\{subject\}" candidates=\$\{topicValidation\.candidates\.length\}/);
  assert.match(fn, /\[topic-validation\] status=valid topic="\$\{subject\}"/);
});

test("server.js : le pipeline legacy (fiche_generation, generateNotionLevelQuiz) applique la même vérification et ne la rejoue jamais", () => {
  const start = server.indexOf("async function generateNotionLevelQuiz(");
  assert.ok(start > -1, "generateNotionLevelQuiz introuvable dans server.js");
  const fn = server.slice(start, start + 6000);
  assert.match(fn, /const topicValidation = parseTopicValidationField\(candidate\?\.topicValidation\)/);
  assert.match(fn, /topicValidation\.status === "ambiguous"/);
  assert.match(fn, /generationFailure\("TOPIC_AMBIGUOUS", "topic_validation"/);
});

test("lib/custom-topic-generation-errors.js : TOPIC_AMBIGUOUS est un code d'échec distinct", () => {
  const errors = fs.readFileSync(path.join(root, "lib/custom-topic-generation-errors.js"), "utf8");
  assert.match(errors, /TOPIC_AMBIGUOUS: \{ status: 422/);
});

test("server.js : les deux routes /custom et /custom/progressive renvoient candidates/normalizedTopic uniquement pour TOPIC_AMBIGUOUS", () => {
  assert.match(server, /code === "TOPIC_AMBIGUOUS" && Array\.isArray\(result\.candidates\)/g);
  const occurrences = server.match(/code === "TOPIC_AMBIGUOUS" && Array\.isArray\(result\.candidates\)/g) || [];
  assert.ok(occurrences.length >= 2, "attendu au moins 2 occurrences (route legacy /custom et route /custom/progressive)");
});

test("views/qcm-du-jour.html : une désambiguïsation ouvre showTopicDisambiguationModal plutôt que le message d'erreur générique", () => {
  assert.match(view, /function showTopicDisambiguationModal\(topic, reason, candidates, onPick\)/);
  assert.match(view, /qcm-topic-disambig-option/);
  assert.match(view, /result\.data\.code === 'TOPIC_AMBIGUOUS' && Array\.isArray\(result\.data\.candidates\) && result\.data\.candidates\.length/);
  assert.match(view, /showTopicDisambiguationModal\(topic, result\.data\.error, result\.data\.candidates, function \(candidateLabel\) \{/);
});

test("views/qcm-du-jour.html : choisir un candidat relance startCustomTopicGeneration avec le même niveau (presetLevel), jamais un deuxième chemin de génération", () => {
  assert.match(view, /function startCustomTopicGeneration\(topic, onCreated, presetLevel\)/);
  assert.match(view, /startCustomTopicGeneration\(candidateLabel, onCreated, level\)/);
  assert.match(view, /if \(presetLevel\) \{\s*withLevel\(presetLevel\);/);
});
