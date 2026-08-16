"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mapMnoriaReviewToFsrsRating } = require("../lib/spaced-repetition/rating-mapper");

test("une réponse incorrecte est toujours Again, quel que soit le ressenti", () => {
  for (const perceivedDifficulty of ["facile", "moyen", "difficile", null, undefined]) {
    assert.equal(
      mapMnoriaReviewToFsrsRating({ isCorrect: false, perceivedDifficulty }),
      "Again",
      `perceivedDifficulty=${perceivedDifficulty}`
    );
  }
});

test("correct + difficile -> Hard", () => {
  assert.equal(mapMnoriaReviewToFsrsRating({ isCorrect: true, perceivedDifficulty: "difficile" }), "Hard");
});

test("correct + moyen -> Good", () => {
  assert.equal(mapMnoriaReviewToFsrsRating({ isCorrect: true, perceivedDifficulty: "moyen" }), "Good");
});

test("correct + facile -> Easy", () => {
  assert.equal(mapMnoriaReviewToFsrsRating({ isCorrect: true, perceivedDifficulty: "facile" }), "Easy");
});

test("correct sans ressenti renseigné -> Good (comportement par défaut de l'UI)", () => {
  assert.equal(mapMnoriaReviewToFsrsRating({ isCorrect: true, perceivedDifficulty: null }), "Good");
  assert.equal(mapMnoriaReviewToFsrsRating({ isCorrect: true, perceivedDifficulty: undefined }), "Good");
});

test("isCorrect non booléen est rejeté", () => {
  assert.throws(() => mapMnoriaReviewToFsrsRating({ isCorrect: "oui", perceivedDifficulty: "moyen" }), /isCorrect/);
});

test("perceivedDifficulty invalide est rejeté", () => {
  assert.throws(
    () => mapMnoriaReviewToFsrsRating({ isCorrect: true, perceivedDifficulty: "bof" }),
    /perceivedDifficulty invalide/
  );
});
