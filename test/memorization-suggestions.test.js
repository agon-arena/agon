"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { selectMemorizationSuggestions, MAX_MEMORIZATION_SUGGESTIONS } = require("../lib/memorization-suggestions");

// Petit constructeur d'entrée pour garder les tests lisibles : une entrée =
// une question réellement répondue, déjà résolue (knowledgeTargetId/level/
// correct/difficulty), exactement la forme attendue par
// selectMemorizationSuggestions.
function entry(knowledgeTargetId, level, correct, difficulty) {
  return { knowledgeTargetId, level, correct, difficulty: difficulty || null };
}

test("2 erreurs Élémentaire -> 2 propositions Élémentaire", () => {
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", false, null),
    entry("k2", "elementaire", false, null)
  ]);
  assert.deepEqual(result, ["k1", "k2"]);
});

test("1 erreur Élémentaire + 1 difficile Élémentaire -> ces 2 propositions", () => {
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", false, null),
    entry("k2", "elementaire", true, "difficile"),
    entry("k3", "elementaire", true, "facile")
  ]);
  assert.deepEqual(result, ["k1", "k2"]);
});

test("tout Élémentaire réussi + Facile + arrêt -> 0 proposition (jamais de niveau inventé)", () => {
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", true, "facile"),
    entry("k2", "elementaire", true, "facile")
  ]);
  assert.deepEqual(result, []);
});

test("tout Élémentaire Facile + poursuite Approfondi (avance) avec 2 difficultés -> 2 Approfondi", () => {
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", true, "facile"),
    entry("k2", "elementaire", true, "facile"),
    entry("k3", "avance", false, null),
    entry("k4", "avance", true, "difficile")
  ]);
  assert.deepEqual(result, ["k3", "k4"]);
});

test("1 Élémentaire pertinente + 1 Approfondi pertinente -> 2 propositions (un niveau ne remplit pas tout à lui seul)", () => {
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", false, null),
    entry("k2", "elementaire", true, "facile"),
    entry("k3", "avance", true, "difficile")
  ]);
  assert.deepEqual(result, ["k1", "k3"]);
});

test("aucune Élémentaire/Approfondi pertinente + 1 Expert pertinente -> 1 Expert (jamais une 2e inventée)", () => {
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", true, "facile"),
    entry("k2", "avance", true, "moyen"),
    entry("k3", "expert", false, null)
  ]);
  assert.deepEqual(result, ["k3"]);
});

test("utilisateur n'ayant jamais fait Expert -> aucune connaissance Expert possible même si un test essaie d'en injecter une hors périmètre", () => {
  // Seules des entrées Élémentaire/Approfondi sont fournies ici : aucune
  // entrée "expert" n'existe dans l'historique réel de cet utilisateur, donc
  // aucune ne peut apparaître dans le résultat — la fonction ne va jamais
  // chercher plus loin que ce qui lui est donné.
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", true, "facile"),
    entry("k2", "avance", true, "moyen")
  ]);
  assert.ok(!result.includes("expert"));
  assert.deepEqual(result, []);
});

test("question non répondue -> sa connaissance n'est jamais proposée", () => {
  // k2 correspondrait à une question ratée, mais elle n'a PAS été répondue :
  // l'appelant ne doit donc jamais construire d'entrée pour elle. Ce test
  // vérifie que la fonction ne propose que ce qui lui est explicitement
  // fourni, jamais une connaissance absente de l'historique transmis.
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", false, null)
    // k2 volontairement absent : "non répondue"
  ]);
  assert.deepEqual(result, ["k1"]);
  assert.ok(!result.includes("k2"));
});

test("deux questions correspondant à la même connaissance -> une seule proposition (le pire signal gagne)", () => {
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", false, null), // ratée
    entry("k1", "elementaire", true, "facile") // même connaissance, réussie ailleurs
  ]);
  assert.deepEqual(result, ["k1"]);
});

test("aucune connaissance pertinente sur tout le parcours -> 0 proposition", () => {
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", true, "facile"),
    entry("k2", "elementaire", true, "moyen"),
    entry("k3", "avance", true, "facile"),
    entry("k4", "expert", true, "moyen")
  ]);
  assert.deepEqual(result, []);
});

// ── Cas limites additionnels ─────────────────────────────────────────────

test("jamais plus de MAX_MEMORIZATION_SUGGESTIONS même avec beaucoup d'échecs sur un seul niveau", () => {
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", false, null),
    entry("k2", "elementaire", false, null),
    entry("k3", "elementaire", false, null)
  ]);
  assert.equal(result.length, MAX_MEMORIZATION_SUGGESTIONS);
  assert.deepEqual(result, ["k1", "k2"]);
});

test("2 pertinentes en Élémentaire -> on ne descend jamais aux niveaux suivants même s'ils contiennent des échecs", () => {
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", false, null),
    entry("k2", "elementaire", false, null),
    entry("k3", "avance", false, null),
    entry("k4", "expert", false, null)
  ]);
  assert.deepEqual(result, ["k1", "k2"]);
});

test("réussie + ressenti 'moyen' n'est jamais proposée (traitée comme facile, décision explicite)", () => {
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", true, "moyen")
  ]);
  assert.deepEqual(result, []);
});

test("réussie + difficulté absente (null, réponse antérieure à la fonctionnalité) n'est jamais proposée", () => {
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", true, null)
  ]);
  assert.deepEqual(result, []);
});

test("entrée sans knowledgeTargetId résoluble : jamais proposée, jamais une erreur", () => {
  const result = selectMemorizationSuggestions([
    entry(null, "elementaire", false, null),
    entry("k1", "elementaire", false, null)
  ]);
  assert.deepEqual(result, ["k1"]);
});

test("niveau non reconnu (master legacy sans curriculum, ex. level absent) : jamais rattaché à un niveau, jamais proposé", () => {
  const result = selectMemorizationSuggestions([
    entry("k1", null, false, null),
    entry("k2", "legacy", false, null)
  ]);
  assert.deepEqual(result, []);
});

test("entrées vides ou non-tableau : renvoie un tableau vide sans erreur", () => {
  assert.deepEqual(selectMemorizationSuggestions([]), []);
  assert.deepEqual(selectMemorizationSuggestions(undefined), []);
  assert.deepEqual(selectMemorizationSuggestions(null), []);
});
