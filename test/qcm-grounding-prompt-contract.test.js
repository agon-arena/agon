"use strict";

// Contrat de production documentaire (01/09/2026) : ces tests lisent
// server.js comme du texte car son import démarre Express. Ils verrouillent
// le prompt partagé par la génération initiale et l'expansion V3.2, ainsi
// que les branches du cycle de régénération déjà existant.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const formatStart = server.indexOf("function buildQuestionFormatsPromptBlock(");
const formatEnd = server.indexOf("\n}\n\n// shuffleArray", formatStart) + 2;
const formatPrompt = server.slice(formatStart, formatEnd);
const qualityStart = server.indexOf("async function qualityControlRawQuestions(");
const qualityEnd = server.indexOf("\n}\n\n// QCM d'une seule notion", qualityStart) + 2;
const qualityControl = server.slice(qualityStart, qualityEnd);

test("A-B — le claim doit apporter une preuve nominative, jamais seulement thématique", () => {
  assert.match(formatPrompt, /nommer explicitement la bonne personne, œuvre, entité, institution, lieu ou mouvement/);
  assert.match(formatPrompt, /n'est PAS un résumé du thème ni une phrase seulement liée au sujet/);
  assert.match(formatPrompt, /Le cubisme transforme la peinture.+ne prouve pas quel artiste en est un fondateur/);
});

test("C — une réponse numérique exige la valeur exacte dans la preuve", () => {
  assert.match(formatPrompt, /date, le nombre, la quantité, le pourcentage, la durée ou la mesure EXACTS/);
  assert.match(qualityControl, /GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED spécifiquement/);
  assert.match(qualityControl, /la valeur exacte doit apparaître explicitement dans un passage SOURCE_N cité ET dans supporting_claim/);
});

test("D-E — cause et conséquence doivent être explicitement attestées", () => {
  assert.match(formatPrompt, /énoncer explicitement la relation causale pour une cause/);
  assert.match(formatPrompt, /énoncer explicitement l'effet demandé pour une conséquence/);
});

test("le contrat couvre aussi propriété, QCM multiple, fidélité et auto-vérification", () => {
  assert.match(formatPrompt, /caractéristique demandée pour une propriété/);
  assert.match(formatPrompt, /qcm_multi, établir explicitement TOUS les éléments marqués corrects/);
  assert.match(formatPrompt, /ne fusionne pas plusieurs sources pour créer un fait nouveau/);
  assert.match(formatPrompt, /Un correcteur strict peut-il identifier la bonne réponse en utilisant uniquement ce supporting_claim/);
});

test("F — ANSWER_NOT_IN_CLAIM reconstruit question et réponse depuis SOURCE_N, pas seulement le claim", () => {
  const branch = qualityControl.slice(
    qualityControl.indexOf('rejectionCodes.has("GROUNDING_ANSWER_NOT_IN_CLAIM")'),
    qualityControl.indexOf('rejectionCodes.has("GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED")')
  );
  assert.match(branch, /Reviens aux passages SOURCE_N disponibles/);
  assert.match(branch, /reconstruis si nécessaire TOUTE la question, ses options ET la bonne réponse/);
  assert.match(branch, /Ne te contente JAMAIS de réécrire supporting_claim/);
});

test("G — génération initiale et expansion V3.2 utilisent le même contrat partagé", () => {
  assert.match(server, /buildQuestionFormatsPromptBlock\("sourceId", accepted\.length, true, undefined, grounding\?\.identifiedSourcesBlock \|\| null\)/);
  assert.match(server, /buildQuestionFormatsPromptBlock\("sourceId", missingKnowledge\.length, true, undefined, mergedSourcesBlock\)/);
});

test("H — aucun nouvel appel IA ni cycle n'est ajouté au contrôle qualité", () => {
  assert.equal((qualityControl.match(/await _callOpenAI\(/g) || []).length, 2,
    "le contrôle conserve ses deux sites historiques : critic sémantique et régénération ciblée");
  assert.equal((qualityControl.match(/CYCLE DE RÉGÉNÉRATION CIBLÉE/g) || []).length, 1);
});

test("I — les autres corrections ciblées existantes restent câblées", () => {
  for (const code of ["DOUBLE_NEGATION", "WEAK_DISTRACTOR_SET", "AMBIGUOUS_DISTRACTOR", "GROUNDING_UNKNOWN_SOURCE", "GROUNDING_EXCESSIVE_PRECISION"]) {
    assert.match(qualityControl, new RegExp(code));
  }
});

test("J — les pipelines sans grounding restent hors du nouveau contrat", () => {
  const contract = formatPrompt.slice(formatPrompt.indexOf("MÉTHODE DOCUMENTAIRE OBLIGATOIRE"));
  assert.ok(formatPrompt.indexOf("...(groundingSourcesBlock ? [") < formatPrompt.indexOf("MÉTHODE DOCUMENTAIRE OBLIGATOIRE"));
  assert.ok(contract.indexOf("] : []),") >= 0, "le contrat doit rester dans le bloc conditionnel groundingSourcesBlock");
  assert.match(server, /buildQuestionFormatsPromptBlock\("sourceId", admittedKnowledge\.length, true\);/);
});

test("la méthode part du passage soutenu tout en gardant des questions naturelles", () => {
  assert.match(formatPrompt, /construis la question À PARTIR DE LA PREUVE, jamais la preuve après avoir choisi la question/);
  assert.match(formatPrompt, /reconstruis la question ET la bonne réponse autour d'un fait explicitement soutenu/);
  assert.match(formatPrompt, /naturelle, pédagogique, variée et adaptée au niveau demandé/);
  assert.match(formatPrompt, /aucune extraction littérale de la question n'est exigée/);
});
