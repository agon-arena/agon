"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMemoryItemNaturalKey } = require("../lib/spaced-repetition/memory-model");

test("buildMemoryItemNaturalKey compose slot, quizDate et questionId", () => {
  const key = buildMemoryItemNaturalKey({
    slot: "notion:histoire:abc:expert",
    quizDate: "2026-08-10",
    questionId: "notion:histoire:abc-expert-q3"
  });
  assert.equal(key, "notion:histoire:abc:expert::2026-08-10::notion:histoire:abc-expert-q3");
});

test("buildMemoryItemNaturalKey distingue deux apparitions du même sourceDebateId à des quiz_date différents", () => {
  const day1 = buildMemoryItemNaturalKey({ slot: "morning", quizDate: "2026-08-10", questionId: "morning-q3" });
  const day2 = buildMemoryItemNaturalKey({ slot: "morning", quizDate: "2026-08-11", questionId: "morning-q3" });
  assert.notEqual(day1, day2);
});

test("buildMemoryItemNaturalKey rejette les champs manquants", () => {
  assert.throws(() => buildMemoryItemNaturalKey({ quizDate: "2026-08-10", questionId: "q1" }), /requis/);
  assert.throws(() => buildMemoryItemNaturalKey({ slot: "morning", questionId: "q1" }), /requis/);
  assert.throws(() => buildMemoryItemNaturalKey({ slot: "morning", quizDate: "2026-08-10" }), /requis/);
});

// Audit du 16/08/2026 (verdict natural_key) : base et altVariant vivent dans
// le MÊME objet question (même question.id) — buildMemoryItemNaturalKey ne
// prend que questionId, jamais le contenu de la question elle-même, donc la
// présence ou l'absence d'un altVariant ne peut structurellement pas changer
// la clé. Ce test fige cette garantie plutôt que de la laisser implicite.
test("la clé naturelle est indépendante de la présence d'un altVariant (base et alt partagent le même MemoryItem)", () => {
  const baseQuestionArgs = { slot: "notion:histoire:abc:expert", quizDate: "2026-08-10", questionId: "notion:histoire:abc-expert-q3" };
  // Peu importe que l'objet question complet porte ou non un altVariant :
  // buildMemoryItemNaturalKey ne voit jamais ce champ, seulement l'id.
  const keyWhenQuestionHasAltVariant = buildMemoryItemNaturalKey(baseQuestionArgs);
  const keyWhenQuestionHasNoAltVariant = buildMemoryItemNaturalKey(baseQuestionArgs);
  assert.equal(keyWhenQuestionHasAltVariant, keyWhenQuestionHasNoAltVariant);
});
