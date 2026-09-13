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

test("aucune Élémentaire/Approfondi ratée/difficile + 1 Approfondi moyen + 1 Expert ratée -> Approfondi avant Expert (ordre par niveau prime sur le palier)", () => {
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", true, "facile"),
    entry("k2", "avance", true, "moyen"),
    entry("k3", "expert", false, null)
  ]);
  assert.deepEqual(result, ["k2", "k3"]);
});

test("utilisateur n'ayant jamais fait Expert -> le seul signal moyen d'Approfondi suffit désormais à être proposé (spec du 13/09/2026)", () => {
  // Seules des entrées Élémentaire/Approfondi sont fournies ici : aucune
  // entrée "expert" n'existe dans l'historique réel de cet utilisateur, donc
  // aucune ne peut apparaître dans le résultat — la fonction ne va jamais
  // chercher plus loin que ce qui lui est donné. "moyen" est depuis le
  // 13/09/2026 un vrai palier de fragilité (après ratée/difficile), donc k2
  // est désormais proposée.
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", true, "facile"),
    entry("k2", "avance", true, "moyen")
  ]);
  assert.ok(!result.includes("expert"));
  assert.deepEqual(result, ["k2"]);
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

test("aucune ratée/facile nulle part, mais 2 moyens (Élémentaire puis Expert) -> les 2 sont proposées, dans l'ordre des niveaux", () => {
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", true, "facile"),
    entry("k2", "elementaire", true, "moyen"),
    entry("k3", "avance", true, "facile"),
    entry("k4", "expert", true, "moyen")
  ]);
  assert.deepEqual(result, ["k2", "k4"]);
});

test("aucune connaissance pertinente (tout facile) sur tout le parcours -> 0 proposition", () => {
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", true, "facile"),
    entry("k3", "avance", true, "facile"),
    entry("k4", "expert", true, "facile")
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

test("réussie + ressenti 'moyen' est proposée depuis le 13/09/2026 (3e palier de fragilité)", () => {
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", true, "moyen")
  ]);
  assert.deepEqual(result, ["k1"]);
});

test("dans un même niveau, ratée avant difficile avant moyen (ordre strict des 3 paliers)", () => {
  const result = selectMemorizationSuggestions([
    entry("k1", "elementaire", true, "moyen"),
    entry("k2", "elementaire", true, "difficile"),
    entry("k3", "elementaire", false, null)
  ]);
  assert.deepEqual(result, ["k3", "k2"]);
});

test("ordre strict en 9 paliers : Élémentaire ratée/difficile/moyen -> Approfondi -> Expert, jamais mélangés", () => {
  const result = selectMemorizationSuggestions([
    entry("k-el-moyen", "elementaire", true, "moyen"),
    entry("k-av-ratee", "avance", false, null),
    entry("k-ex-ratee", "expert", false, null)
  ]);
  // Élémentaire moyen (seul candidat de son niveau) prend la 1ère place avant
  // même une ratée d'un niveau ultérieur : l'ordre par NIVEAU prime toujours
  // sur le palier à l'intérieur d'un autre niveau.
  assert.deepEqual(result, ["k-el-moyen", "k-av-ratee"]);
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
