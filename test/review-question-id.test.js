"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCultureGeneraleReviewQuestionId,
  parseCultureGeneraleReviewRef
} = require("../lib/spaced-repetition/review-question-id");

test("une nouvelle repasse FSRS reçoit un identifiant distinct", () => {
  const first = buildCultureGeneraleReviewQuestionId("notion:custom:test-q1", 1);
  const second = buildCultureGeneraleReviewQuestionId("notion:custom:test-q1", 2);

  assert.equal(first, "cgreview-notion:custom:test-q1::r1");
  assert.equal(second, "cgreview-notion:custom:test-q1::r2");
  assert.notEqual(first, second);
});

test("les passages distincts retrouvent la même question d'origine", () => {
  assert.equal(
    parseCultureGeneraleReviewRef("cgreview-notion:custom:test-q1::r7"),
    "notion:custom:test-q1"
  );
});

test("les anciens identifiants de repasse restent compatibles", () => {
  assert.equal(
    parseCultureGeneraleReviewRef("cgreview-notion:custom:test-q1"),
    "notion:custom:test-q1"
  );
});

test("un identifiant extérieur aux repasses est refusé", () => {
  assert.equal(parseCultureGeneraleReviewRef("notion:custom:test-q1"), null);
});
