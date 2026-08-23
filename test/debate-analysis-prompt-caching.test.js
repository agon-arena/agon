"use strict";

// Non-régression du réordonnancement "prompt caching" (audit du 22/08/2026,
// phase 1) : PROMPT1/PROMPT2/PROMPT2_OPEN/PROMPT2_OPEN_CUSTOM ont été
// réordonnés (instructions/grille/contraintes fixes avant les données
// variables) SANS changer un seul caractère de contenu. Ce test lit le
// fichier source directement (les prompts sont des constantes privées, non
// exportées) plutôt que d'élargir les exports du module pour les besoins du
// test — aucune modification de lib/debate-analysis.js au-delà de ce qui a
// déjà été fait pour le réordonnancement lui-même.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "lib", "debate-analysis.js"), "utf8");

function extractPromptBody(name) {
  const re = new RegExp("const " + name + " = `([\\s\\S]*?)`;\\n");
  const m = SOURCE.match(re);
  assert.ok(m, `constante ${name} introuvable dans lib/debate-analysis.js`);
  return m[1];
}

function countPlaceholders(body) {
  const counts = {};
  const re = /\{\{(\w+)\}\}/g;
  let m;
  while ((m = re.exec(body))) counts[m[1]] = (counts[m[1]] || 0) + 1;
  return counts;
}

// Longueurs et occurrences de placeholders mesurées AVANT le réordonnancement
// (cf. rapport, partie 7) : si un seul caractère avait été perdu, ajouté ou
// altéré pendant le déplacement du bloc "Données fournies", ces valeurs
// divergeraient immédiatement.
const REFERENCE = {
  PROMPT1:             { length: 6172,  placeholders: { question: 1, camp: 1, arguments: 1 } },
  PROMPT2:             { length: 17941, placeholders: { question: 1, camp: 2, argumentId: 2, argument: 1, grid: 1, strictness_note: 1 } },
  PROMPT2_OPEN:        { length: 7587,  placeholders: { question: 1, context: 1, argumentId: 2, argument: 1, grid: 1, strictness_note: 1, camp: 1 } },
  PROMPT2_OPEN_CUSTOM: { length: 4144,  placeholders: { question: 1, context: 1, argumentId: 2, argument: 1, sourceUrls: 1, rubric: 1, strictness_note: 1 } },
  // PROMPT3 n'a PAS été touché (placeholders dispersés dans le texte des
  // règles, pas confinés à un seul bloc — cf. rapport) : conservé ici comme
  // repère de non-régression négatif, pour détecter toute modification
  // accidentelle future.
  PROMPT3:             { length: 11656, placeholders: { question: 1, camp: 2, argumentId: 2, argument: 1, sourceUrls: 12, source_contents: 9 } }
};

for (const [name, ref] of Object.entries(REFERENCE)) {
  test(`${name} — longueur et placeholders inchangés par rapport à l'avant-réordonnancement`, () => {
    const body = extractPromptBody(name);
    assert.equal(body.length, ref.length, `longueur de ${name} a changé — du texte a été perdu ou ajouté`);
    assert.deepEqual(countPlaceholders(body), ref.placeholders, `placeholders de ${name} ont changé`);
  });
}

test("PROMPT2 — le bloc variable (Données fournies) est bien situé APRÈS le contenu fixe (grille, paliers, règles)", () => {
  const body = extractPromptBody("PROMPT2");
  const idxGrid = body.indexOf("GRILLE DE NOTATION STABLE DE L'ARÈNE");
  const idxPaliers = body.indexOf("DÉTAIL DES PALIERS PAR CRITÈRE");
  const idxRegles = body.indexOf("RÈGLES IMPORTANTES");
  const idxDonnees = body.indexOf("Données fournies :");
  const idxReponds = body.indexOf("Réponds uniquement en JSON valide, sans texte autour.");

  assert.ok(idxGrid > -1 && idxPaliers > -1 && idxRegles > -1 && idxDonnees > -1 && idxReponds > -1);
  assert.ok(idxGrid < idxPaliers, "la grille doit précéder le détail des paliers");
  assert.ok(idxPaliers < idxRegles, "le détail des paliers doit précéder les règles importantes");
  assert.ok(idxRegles < idxDonnees, "les règles fixes doivent précéder les données variables");
  assert.ok(idxDonnees < idxReponds, "les données variables doivent précéder l'instruction de réponse finale");
});

test("PROMPT2_OPEN — le bloc variable (Données fournies) est bien situé APRÈS le contenu fixe", () => {
  const body = extractPromptBody("PROMPT2_OPEN");
  const idxGrid = body.indexOf("GRILLE DE NOTATION STABLE DE L'ARÈNE");
  const idxPaliers = body.indexOf("DÉTAIL DES PALIERS PAR CRITÈRE");
  const idxDonnees = body.indexOf("Données fournies :");
  const idxReponds = body.indexOf("Réponds uniquement en JSON valide, sans texte autour.");

  assert.ok(idxGrid < idxPaliers);
  assert.ok(idxPaliers < idxDonnees);
  assert.ok(idxDonnees < idxReponds);
});

test("PROMPT2_OPEN_CUSTOM — le bloc variable (Sujet de l'arène...) est bien situé après le barème et juste avant Réponds", () => {
  const body = extractPromptBody("PROMPT2_OPEN_CUSTOM");
  const idxBareme = body.indexOf("BARÈME PERSONNALISÉ DE L'ARÈNE");
  const idxComment = body.indexOf("COMMENT NOTER CHAQUE CRITÈRE");
  const idxSujet = body.indexOf("Sujet de l'arène : {{question}}");
  const idxReponds = body.indexOf("Réponds uniquement en JSON valide, sans texte autour :");

  assert.ok(idxBareme < idxComment);
  assert.ok(idxComment < idxSujet);
  assert.ok(idxSujet < idxReponds);
});

test("PROMPT1 — le bloc variable (Données fournies) est bien situé après RÈGLE D'EXHAUSTIVITÉ, juste avant Réponds", () => {
  const body = extractPromptBody("PROMPT1");
  const idxExhaustivite = body.indexOf("RÈGLE D'EXHAUSTIVITÉ ABSOLUE");
  const idxDonnees = body.indexOf("Données fournies :");
  const idxReponds = body.indexOf("Réponds uniquement en JSON valide, sans texte autour.");

  assert.ok(idxExhaustivite < idxDonnees);
  assert.ok(idxDonnees < idxReponds);
});

test("PROMPT3 — non modifié : la donnée variable (Question de l'arène) précède toujours le contenu fixe, comme avant l'audit", () => {
  // Repère négatif explicite : PROMPT3 partage le même problème de caching
  // que PROMPT2 (grosse partie fixe après une partie variable) mais n'a
  // volontairement pas été corrigé (placeholders sourceUrls/source_contents
  // dispersés dans les règles, une vraie refactorisation serait nécessaire).
  const body = extractPromptBody("PROMPT3");
  const idxDonnees = body.indexOf("Question de l'arène : {{question}}");
  const idxRegleAbsolue = body.indexOf("RÈGLE ABSOLUE");
  assert.ok(idxDonnees > -1 && idxRegleAbsolue > -1);
  assert.ok(idxDonnees < idxRegleAbsolue, "PROMPT3 doit rester inchangé : la donnée variable reste avant les règles fixes");
});
