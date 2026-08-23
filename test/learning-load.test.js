"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { computeLearningLoadGauge, LOAD_LEVELS } = require("../lib/spaced-repetition/learning-load");

test("aucune carte due -> calme, ratio 0", () => {
  const result = computeLearningLoadGauge([0, 0, 0], 20);
  assert.equal(result.level, "calm");
  assert.equal(result.ratio, 0);
});

test("charge bien en dessous du plafond tous les jours -> calme", () => {
  const result = computeLearningLoadGauge([5, 5, 5, 5], 20);
  assert.equal(result.level, "calm");
  assert.equal(result.peakLoad, 5);
});

test("un jour pile au plafond -> busy (le seuil busy est inclusif)", () => {
  const result = computeLearningLoadGauge([20], 20);
  assert.equal(result.ratio, 1);
  assert.equal(result.level, "busy");
});

test("pic isolé suivi de jours calmes -> s'absorbe, ne reste pas overloaded au-delà du pic", () => {
  const result = computeLearningLoadGauge([30, 0, 0, 0], 20);
  // Jour 0 : charge 30 (pic), backlog 10 reporté.
  // Jour 1 : charge 10 (backlog seul), absorbé (10 < 20), backlog 0 ensuite.
  assert.equal(result.peakLoad, 30);
  assert.equal(result.peakDayIndex, 0);
  assert.deepEqual(result.backlogByDay, [10, 0, 0, 0]);
});

test("plusieurs jours légèrement au-dessus du plafond -> le retard grossit, pic après le premier jour", () => {
  // 22 chaque jour : jour0 charge 22 (backlog 2) ; jour1 charge 2+22=24 (backlog 4) ;
  // jour2 charge 4+22=26 (backlog 6) — le pic grossit jour après jour, contrairement à un
  // simple pic brut par jour qui resterait bloqué à 22 partout.
  const result = computeLearningLoadGauge([22, 22, 22], 20);
  assert.equal(result.peakLoad, 26);
  assert.equal(result.peakDayIndex, 2);
  assert.ok(result.ratio > 1, "le ratio doit dépasser 1 : cascade réelle, pas juste un pic isolé");
});

test("surcharge nette -> overloaded", () => {
  const result = computeLearningLoadGauge([50], 20);
  assert.equal(result.ratio, 2.5);
  assert.equal(result.level, "overloaded");
});

test("valeurs négatives ou non numériques traitées comme 0, jamais une exception", () => {
  const result = computeLearningLoadGauge([-5, NaN, undefined, 3], 20);
  assert.equal(result.peakLoad, 3);
});

test("tableau vide -> calme par défaut, jamais une exception", () => {
  const result = computeLearningLoadGauge([], 20);
  assert.equal(result.level, "calm");
  assert.equal(result.peakDayIndex, -1);
});

test("cap invalide -> lève une erreur explicite plutôt qu'un calcul silencieusement faux", () => {
  assert.throws(() => computeLearningLoadGauge([10], 0));
  assert.throws(() => computeLearningLoadGauge([10], -5));
  assert.throws(() => computeLearningLoadGauge([10], NaN));
});

test("LOAD_LEVELS liste exactement les 4 paliers dans l'ordre croissant", () => {
  assert.deepEqual(LOAD_LEVELS, ["calm", "moderate", "busy", "overloaded"]);
});
