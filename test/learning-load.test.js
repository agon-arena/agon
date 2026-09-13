"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { computeLearningLoadGauge, LOAD_LEVELS, levelFromPeakLoad, GAUGE_DISPLAY_PEAK_THRESHOLDS } = require("../lib/spaced-repetition/learning-load");

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

// ── levelFromPeakLoad (13/09/2026, "idéal pour 6 connaissances, surcharge à partir de 9") ──
// Indépendant de computeLearningLoadGauge/cap=20 ci-dessus (qui reste inchangé, pour la
// simulation de report) : seuils en nombre BRUT de connaissances, jamais en ratio.

test("GAUGE_DISPLAY_PEAK_THRESHOLDS : idéal (busy) à 6, surcharge à 9", () => {
  assert.equal(GAUGE_DISPLAY_PEAK_THRESHOLDS.busy, 6);
  assert.equal(GAUGE_DISPLAY_PEAK_THRESHOLDS.overloaded, 9);
});

test("levelFromPeakLoad : 0 à 2 -> calm", () => {
  assert.equal(levelFromPeakLoad(0), "calm");
  assert.equal(levelFromPeakLoad(2), "calm");
});

test("levelFromPeakLoad : 3 à 5 -> moderate", () => {
  assert.equal(levelFromPeakLoad(3), "moderate");
  assert.equal(levelFromPeakLoad(5), "moderate");
});

test("levelFromPeakLoad : 6 à 8 -> busy (6 = l'idéal demandé)", () => {
  assert.equal(levelFromPeakLoad(6), "busy");
  assert.equal(levelFromPeakLoad(8), "busy");
});

test("levelFromPeakLoad : 9 et au-delà -> overloaded (surcharge demandée à partir de 9)", () => {
  assert.equal(levelFromPeakLoad(9), "overloaded");
  assert.equal(levelFromPeakLoad(20), "overloaded");
});

test("levelFromPeakLoad : valeurs négatives ou non numériques traitées comme 0 -> calm, jamais une exception", () => {
  assert.equal(levelFromPeakLoad(-5), "calm");
  assert.equal(levelFromPeakLoad(NaN), "calm");
  assert.equal(levelFromPeakLoad(undefined), "calm");
});

test("levelFromPeakLoad reste indépendant de computeLearningLoadGauge : les deux systèmes de seuils sont volontairement distincts", () => {
  // Un pic de 9 reste "calm" au sens ratio (9/20=0.45, sous le seuil moderate=0.5 du cap
  // technique 20) mais devient "overloaded" au sens de l'affichage (peakLoad=9 atteint le
  // seuil de surcharge demandé) — la simulation de report (cap=20) et l'affichage
  // utilisateur (seuils 6/9) ne partagent plus aucune valeur commune, par construction.
  const raw = computeLearningLoadGauge([9], 20);
  assert.equal(raw.level, "calm");
  assert.equal(levelFromPeakLoad(raw.peakLoad), "overloaded");
});
