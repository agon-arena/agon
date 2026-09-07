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

// Profil "riche" (07/09/2026, retour utilisateur "les sujets proposés sont
// hyper précis, je veux des sujets plutôt généraux, encyclopédiques") :
// avant ce chantier, l'exigence de généralité du titre n'existait QUE pour
// thinContext (< 3 seed topics) — un profil comme celui-ci laissait le LLM
// prioriser "relier"/"prolonger" au prix de titres fabriqués/composés.
function richContext() {
  return {
    seedTopics: [
      { name: "Stoïcisme", masteryLabel: "solid", branch: "Philosophie" },
      { name: "Guerre de Cent Ans", masteryLabel: "medium", branch: "Histoire" },
      { name: "Thermodynamique", masteryLabel: "solid", branch: "Sciences" }
    ],
    dominantBranches: ["Philosophie", "Histoire"],
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

test("le prompt exige explicitement des sujets encyclopédiques autonomes, y compris pour un profil réduit", () => {
  const prompt = fallback.buildFallbackPrompt(thinContext(), config);
  assert.match(prompt, /sujet ENCYCLOPÉDIQUE autonome et reconnu/);
  assert.match(prompt, /jamais un intitulé FABRIQUÉ/);
});

// Cœur du chantier du 07/09/2026 : cette exigence n'est plus réservée aux
// profils pauvres — un profil riche (3 seed topics ou plus) reçoit
// EXACTEMENT la même consigne de généralité, jamais seulement "relier"/
// "prolonger" au prix d'un titre fabriqué.
test("le prompt exige aussi des sujets encyclopédiques autonomes pour un profil riche (pas seulement les profils pauvres)", () => {
  const prompt = fallback.buildFallbackPrompt(richContext(), config);
  assert.match(prompt, /sujet ENCYCLOPÉDIQUE autonome et reconnu/);
  assert.match(prompt, /jamais un intitulé FABRIQUÉ/);
  assert.match(prompt, /Guerre de Cent Ans/, "les seed topics du profil riche doivent bien apparaître dans le prompt");
});

test("sanitizeProposal (via parseFallbackProposals) rejette les titres fabriqués même sur un profil RICHE (garde-fou déterministe, plus seulement une consigne au LLM)", () => {
  const raw = JSON.stringify({ proposals: [
    { title: "Influence de la Guerre de Cent Ans sur l'artillerie moderne", reason: "Prolonge Guerre de Cent Ans.", related_known_topics: ["Guerre de Cent Ans"] },
    { title: "Liens entre stoïcisme et gestion des émotions", reason: "Relie Stoïcisme.", related_known_topics: ["Stoïcisme"] },
    { title: "Épicurisme et thermodynamique appliquée", reason: "Fabriqué, contient ' et '.", related_known_topics: [] },
    { title: "Empire ottoman", reason: "Sujet encyclopédique autonome, ouverture Histoire.", related_known_topics: ["Guerre de Cent Ans"] }
  ] });
  assert.deepEqual(
    fallback.parseFallbackProposals(raw, richContext(), config).map((proposal) => proposal.title),
    ["Empire ottoman"]
  );
});

test("la signature versionnée ne réutilise pas le cache de l'ancienne politique", () => {
  const signature = fallback.computeGapSignature([{ key: "custom::epicurisme" }]);
  assert.equal(signature.length, 32);
  assert.notEqual(signature, require("node:crypto").createHash("sha256").update("custom::epicurisme").digest("hex").slice(0, 32));
});
