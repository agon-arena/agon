"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { levelFromPeakLoad, GAUGE_DISPLAY_PEAK_THRESHOLDS } = require("../lib/spaced-repetition/learning-load");

// levelFromPeakLoad (13/09/2026, "idéal pour 6 connaissances, surcharge à partir de 9" ;
// simulation de report multi-jours retirée le 14/09/2026, "pas de calcul sur plusieurs
// jours comme actuellement") : seuils en nombre BRUT de connaissances mémorisées
// aujourd'hui, jamais en ratio, jamais projetés sur plusieurs jours.

test("GAUGE_DISPLAY_PEAK_THRESHOLDS : busy à 7 (au-delà de l'idéal), surcharge à 9", () => {
  assert.equal(GAUGE_DISPLAY_PEAK_THRESHOLDS.busy, 7);
  assert.equal(GAUGE_DISPLAY_PEAK_THRESHOLDS.overloaded, 9);
});

test("levelFromPeakLoad : 0 à 2 -> calm", () => {
  assert.equal(levelFromPeakLoad(0), "calm");
  assert.equal(levelFromPeakLoad(2), "calm");
});

test("levelFromPeakLoad : 3 à 6 -> moderate (6 = l'idéal demandé, doit rester vert, cf. correctif du 14/09/2026)", () => {
  assert.equal(levelFromPeakLoad(3), "moderate");
  assert.equal(levelFromPeakLoad(6), "moderate");
});

test("levelFromPeakLoad : 7 à 8 -> busy (au-delà de l'idéal)", () => {
  assert.equal(levelFromPeakLoad(7), "busy");
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
