"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fallback = require("../lib/learn-next/ai-fallback");
const config = require("../lib/learn-next/config");

function thinContext() {
  return {
    seedTopics: [{ name: "Épicurisme", masteryLabel: "solid", branch: "Philosophie" }],
    dominantBranches: ["Philosophie"],
    existingCandidateNames: []
  };
}

test("profil réduit : rejette les micro-sujets composés et conserve les sujets autonomes", () => {
  const raw = JSON.stringify({ proposals: [
    { title: "Éthique du bonheur et pratique quotidienne", reason: "Prolonge Épicurisme.", related_known_topics: ["Épicurisme"] },
    { title: "Éthique des vertus", reason: "Prolonge Épicurisme.", related_known_topics: ["Épicurisme"] },
    { title: "Stoïcisme", reason: "Permet une comparaison avec Épicurisme.", related_known_topics: ["Épicurisme"] },
    { title: "Philosophie politique", reason: "Ouvre une branche structurante.", related_known_topics: ["Épicurisme"] }
  ] });

  assert.deepEqual(
    fallback.parseFallbackProposals(raw, thinContext(), config).map((proposal) => proposal.title),
    ["Stoïcisme", "Philosophie politique"]
  );
});

test("le prompt d'un profil réduit exige explicitement des sujets encyclopédiques autonomes", () => {
  const prompt = fallback.buildFallbackPrompt(thinContext(), config);
  assert.match(prompt, /encyclopédique AUTONOME/);
  assert.match(prompt, /N'invente jamais trois micro-variantes/);
});

test("la signature versionnée ne réutilise pas le cache de l'ancienne politique", () => {
  const signature = fallback.computeGapSignature([{ key: "custom::epicurisme" }]);
  assert.equal(signature.length, 32);
  assert.notEqual(signature, require("node:crypto").createHash("sha256").update("custom::epicurisme").digest("hex").slice(0, 32));
});
