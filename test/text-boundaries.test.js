"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { truncateAtTextBoundary, splitTextAtBoundaries } = require("../lib/text-boundaries");

test("knowledgeTarget n'est pas coupé au milieu d'une phrase", () => {
  const first = "La Révolution française débute en 1789 et transforme durablement les institutions.";
  const second = "Elle ouvre ensuite une nouvelle période politique en France.";
  const truncated = truncateAtTextBoundary(`${first} ${second}`, first.length + 12);
  assert.equal(truncated, first);
});

test("découpage PDF : frontière de phrase, chevauchement maîtrisé et limite respectée", () => {
  const text = Array.from({ length: 20 }, (_, index) => `La phrase numéro ${index + 1} contient une information complète.`).join(" ");
  const chunks = splitTextAtBoundaries(text, 180, 45);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 180));
  assert.ok(chunks.slice(0, -1).every((chunk) => /[.!?]$/.test(chunk)));
  const wordsA = new Set(chunks[0].split(/\s+/));
  assert.ok(chunks[1].split(/\s+/).some((word) => wordsA.has(word)), "un léger contexte doit se chevaucher");
});
