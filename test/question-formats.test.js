"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CUSTOM_GRADED_CORRECT_INDEX,
  MAX_VARIANTS_PER_QUESTION,
  validateQuestionItemCore,
  validateVariantsArray,
  validateAssociationPairs,
  validateQcmMultiOptions,
  validateOrderItems,
  isAssociationAnswerFullyCorrect,
  isQcmMultiAnswerFullyCorrect,
  isOrderAnswerFullyCorrect,
  gradeQuizSubmissionOptionIndex
} = require("../lib/question-formats");

// ── QCM simple ──────────────────────────────────────────────────────────

test("qcm : une réponse valide passe la validation avec exactement 1 bonne réponse", () => {
  const item = { type: "qcm", question: "Qui écrit Les Misérables ?", options: ["Victor Hugo", "Émile Zola", "Balzac", "Dumas"], correctIndex: 0, explanation: "..." };
  const result = validateQuestionItemCore(item);
  assert.ok(result);
  assert.equal(result.type, "qcm");
  assert.equal(result.options.length, 4);
  assert.equal(result.options[result.correctIndex], "Victor Hugo");
});

test("qcm : correctIndex hors bornes est rejeté", () => {
  const item = { type: "qcm", question: "Q ?", options: ["A", "B", "C", "D"], correctIndex: 4, explanation: "..." };
  assert.equal(validateQuestionItemCore(item), null);
});

test("qcm : un nombre d'options différent de 4 est rejeté", () => {
  const item = { type: "qcm", question: "Q ?", options: ["A", "B", "C"], correctIndex: 0, explanation: "..." };
  assert.equal(validateQuestionItemCore(item), null);
});

test("qcm : une question sans texte est rejetée", () => {
  const item = { type: "qcm", question: "", options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "..." };
  assert.equal(validateQuestionItemCore(item), null);
});

// ── qcm_multi ───────────────────────────────────────────────────────────

test("qcm_multi : au moins 2 bonnes réponses, jamais toutes, est accepté", () => {
  const validated = validateQcmMultiOptions(["A", "B", "C", "D"], [0, 2]);
  assert.ok(validated);
  assert.deepEqual(validated.correctIndexes, [0, 2]);
});

test("qcm_multi : une seule bonne réponse est rejetée (ce n'est pas un qcm_multi)", () => {
  assert.equal(validateQcmMultiOptions(["A", "B", "C", "D"], [0]), null);
});

test("qcm_multi : toutes les réponses correctes est rejeté (aucun distracteur)", () => {
  assert.equal(validateQcmMultiOptions(["A", "B", "C", "D"], [0, 1, 2, 3]), null);
});

test("qcm_multi : un index hors bornes est rejeté", () => {
  assert.equal(validateQcmMultiOptions(["A", "B", "C", "D"], [0, 5]), null);
});

test("qcm_multi : correction déterministe — exact match requis, ni oubli ni ajout", () => {
  const correct = [0, 2];
  assert.equal(isQcmMultiAnswerFullyCorrect([0, 2], correct), true);
  assert.equal(isQcmMultiAnswerFullyCorrect([2, 0], correct), true, "l'ordre de sélection ne doit pas compter");
  assert.equal(isQcmMultiAnswerFullyCorrect([0], correct), false, "réponse incomplète");
  assert.equal(isQcmMultiAnswerFullyCorrect([0, 1, 2], correct), false, "réponse en trop");
  assert.equal(isQcmMultiAnswerFullyCorrect([0, 2, 0], correct), false, "doublon dans la soumission");
});

// ── association ─────────────────────────────────────────────────────────

test("association : 3-4 paires distinctes sont acceptées", () => {
  const pairs = validateAssociationPairs([
    { left: "Victor Hugo", right: "Les Misérables" },
    { left: "Émile Zola", right: "Germinal" },
    { left: "Balzac", right: "Le Père Goriot" }
  ]);
  assert.ok(pairs);
  assert.equal(pairs.length, 3);
});

test("association : une clé gauche dupliquée est rejetée (appariement ambigu)", () => {
  const pairs = validateAssociationPairs([
    { left: "Victor Hugo", right: "Les Misérables" },
    { left: "Victor Hugo", right: "Notre-Dame de Paris" },
    { left: "Balzac", right: "Le Père Goriot" }
  ]);
  assert.equal(pairs, null);
});

test("association : moins de 3 ou plus de 4 paires est rejeté", () => {
  assert.equal(validateAssociationPairs([{ left: "A", right: "1" }, { left: "B", right: "2" }]), null);
  assert.equal(validateAssociationPairs([
    { left: "A", right: "1" }, { left: "B", right: "2" }, { left: "C", right: "3" },
    { left: "D", right: "4" }, { left: "E", right: "5" }
  ]), null);
});

test("association : correction exige la totalité des paires, aucun élément manquant", () => {
  const correct = [{ left: "Victor Hugo", right: "Les Misérables" }, { left: "Émile Zola", right: "Germinal" }, { left: "Balzac", right: "Le Père Goriot" }];
  assert.equal(isAssociationAnswerFullyCorrect(correct, correct), true);
  assert.equal(isAssociationAnswerFullyCorrect(correct.slice(0, 2), correct), false, "paire manquante");
  const wrongOne = [correct[0], correct[1], { left: "Balzac", right: "Germinal" }];
  assert.equal(isAssociationAnswerFullyCorrect(wrongOne, correct), false, "une paire fausse suffit à invalider");
});

// ── ordre ───────────────────────────────────────────────────────────────

test("ordre : 3-4 éléments distincts sont acceptés dans l'ordre fourni", () => {
  const items = validateOrderItems(["1789 : Révolution", "1804 : Empire", "1815 : Waterloo"]);
  assert.deepEqual(items, ["1789 : Révolution", "1804 : Empire", "1815 : Waterloo"]);
});

test("ordre : un élément dupliqué est rejeté", () => {
  assert.equal(validateOrderItems(["A", "B", "A"]), null);
});

test("ordre : correction déterministe — terme à terme, jamais un ré-ordonnancement accepté par erreur", () => {
  const correct = ["1789", "1804", "1815"];
  assert.equal(isOrderAnswerFullyCorrect(["1789", "1804", "1815"], correct), true);
  assert.equal(isOrderAnswerFullyCorrect(["1804", "1789", "1815"], correct), false, "deux premiers éléments inversés");
  assert.equal(isOrderAnswerFullyCorrect(["1789", "1804"], correct), false, "séquence incomplète");
});

// ── altVariant : ne doit jamais introduire un format composite ────────────

test("altVariant : un type composite (association/qcm_multi/ordre/intrus) est rejeté", () => {
  const item = {
    type: "qcm",
    question: "Q ?", options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "...",
    altVariant: { type: "association", question: "Q alt ?", pairs: [{ left: "A", right: "1" }, { left: "B", right: "2" }, { left: "C", right: "3" }] }
  };
  const result = validateQuestionItemCore(item);
  assert.ok(result);
  assert.equal(result.altVariant, undefined, "un altVariant de type composite doit être ignoré, jamais accepté");
});

test("altVariant : un type identique à la question principale est rejeté (pas une vraie variante)", () => {
  const item = {
    type: "qcm",
    question: "Q ?", options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "...",
    altVariant: { type: "qcm", question: "Q reformulée ?", options: ["W", "X", "Y", "Z"], correctIndex: 1, explanation: "..." }
  };
  const result = validateQuestionItemCore(item);
  assert.equal(result.altVariant, undefined);
});

test("altVariant valide (type autonome différent) : conservé avec sa propre correction", () => {
  const item = {
    type: "qcm",
    question: "Quelle est la capitale du Sénégal ?", options: ["Dakar", "Harare", "Tripoli", "Tunis"], correctIndex: 0, explanation: "...",
    altVariant: { type: "vrai_faux", question: "Dakar est la capitale du Sénégal.", options: ["Faux", "Vrai"], correctIndex: 1, explanation: "..." }
  };
  const result = validateQuestionItemCore(item);
  assert.ok(result.altVariant);
  assert.equal(result.altVariant.type, "vrai_faux");
  assert.equal(result.altVariant.options[result.altVariant.correctIndex], "Vrai");
});

// ── génération invalide : fallback maîtrisé, rien de corrompu inséré ──────

test("génération invalide : un item complètement malformé est rejeté sans exception", () => {
  assert.equal(validateQuestionItemCore(null), null);
  assert.equal(validateQuestionItemCore({}), null);
  assert.equal(validateQuestionItemCore({ type: "qcm", question: "Q ?" }), null, "options manquantes");
  assert.equal(validateQuestionItemCore({ type: "association", question: "Q ?", pairs: "pas un tableau" }), null);
});

test("génération invalide : un type inconnu retombe sur qcm plutôt que de planter", () => {
  const item = { type: "format-inexistant", question: "Q ?", options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "..." };
  const result = validateQuestionItemCore(item);
  assert.ok(result);
  assert.equal(result.type, "qcm");
});

// ── gradeQuizSubmissionOptionIndex : point d'entrée commun POST /answer et /practice-answer ──

test("gradeQuizSubmissionOptionIndex route chaque format vers sa propre correction déterministe", () => {
  const qcmQuestion = { type: "qcm", options: ["A", "B", "C", "D"], correctIndex: 2 };
  assert.equal(gradeQuizSubmissionOptionIndex(qcmQuestion, { optionIndex: 2 }), 2);
  assert.equal(gradeQuizSubmissionOptionIndex(qcmQuestion, { optionIndex: 0 }), 0);
  assert.equal(gradeQuizSubmissionOptionIndex(qcmQuestion, { optionIndex: 9 }), null, "hors bornes");

  const assocQuestion = { type: "association", pairs: [{ left: "A", right: "1" }, { left: "B", right: "2" }, { left: "C", right: "3" }] };
  assert.equal(gradeQuizSubmissionOptionIndex(assocQuestion, { associationAnswer: assocQuestion.pairs }), CUSTOM_GRADED_CORRECT_INDEX);
  assert.equal(gradeQuizSubmissionOptionIndex(assocQuestion, { associationAnswer: [] }), 0);

  const orderQuestion = { type: "ordre", items: ["1789", "1804", "1815"] };
  assert.equal(gradeQuizSubmissionOptionIndex(orderQuestion, { orderedItems: ["1789", "1804", "1815"] }), CUSTOM_GRADED_CORRECT_INDEX);
  assert.equal(gradeQuizSubmissionOptionIndex(orderQuestion, { orderedItems: ["1804", "1789", "1815"] }), 0);
});

// ── variants (refonte "jusqu'à 3 variantes pertinentes", 16/08/2026) ──────

function qcmVariant(question, correctIndex, extra) {
  return { type: "qcm", question, options: ["A", "B", "C", "D"], correctIndex, explanation: "...", ...extra };
}

test("variants : 1 seul variant est accepté (3 n'est jamais une obligation)", () => {
  const item = { variants: [qcmVariant("Q1 ?", 0)] };
  const result = validateQuestionItemCore(item);
  assert.ok(result);
  assert.equal(result.variants.length, 1);
  assert.equal(result.question, "Q1 ?", "la variante principale est dupliquée à plat pour les lecteurs historiques (stripQuestionForClient, GET /fiche)");
});

test("variants : 2 variants sont acceptés", () => {
  const item = { variants: [qcmVariant("Direct ?", 0), { type: "vrai_faux", question: "Inverse ?", options: ["Faux", "Vrai"], correctIndex: 1, explanation: "..." }] };
  const result = validateQuestionItemCore(item);
  assert.ok(result);
  assert.equal(result.variants.length, 2);
});

test("variants : 3 variants pertinents sont acceptés", () => {
  const item = {
    variants: [
      qcmVariant("Direct ?", 0, { retrievalMode: "direct" }),
      { type: "texte_a_trous", question: "Inverse ___ ?", options: ["A", "B", "C", "D"], correctIndex: 1, explanation: "...", retrievalMode: "inverse" },
      { type: "vrai_faux", question: "Contexte ?", options: ["Faux", "Vrai"], correctIndex: 1, explanation: "...", retrievalMode: "contextual" }
    ]
  };
  const result = validateQuestionItemCore(item);
  assert.ok(result);
  assert.equal(result.variants.length, 3);
  assert.deepEqual(result.variants.map((v) => v.retrievalMode), ["direct", "inverse", "contextual"]);
});

test("variants : au-delà de 3 (le maximum), seules les 3 premières sont conservées — pas un rejet total", () => {
  assert.equal(MAX_VARIANTS_PER_QUESTION, 3);
  const item = { variants: [qcmVariant("Q1 ?", 0), qcmVariant("Q2 ?", 1), qcmVariant("Q3 ?", 2), qcmVariant("Q4 ?", 3)] };
  const result = validateQuestionItemCore(item);
  assert.ok(result, "3 variantes valides existent, la question ne doit pas être perdue pour un 4e excédent");
  assert.equal(result.variants.length, 3);
  assert.deepEqual(result.variants.map((v) => v.question), ["Q1 ?", "Q2 ?", "Q3 ?"]);
});

test("variants : un tableau vide est rejeté", () => {
  assert.equal(validateVariantsArray([]), null);
});

// Tolérance par variante (revue le 16/08/2026 après observation réelle :
// l'IA ajoutait souvent une 2e variante invalide malgré une 1re parfaitement
// valide — cf. lib/question-formats.js validateVariantsArray) : une
// variante individuellement invalide/mal placée/dupliquée est retirée,
// jamais fatale aux autres tant qu'il en reste au moins une bonne (section
// 29 du prompt de refonte : "ne rejette pas nécessairement tout le
// MemoryItem").
test("variants : une variante malformée est retirée, la question reste valide avec les variantes restantes", () => {
  const item = { variants: [qcmVariant("Q1 ?", 0), { type: "qcm", question: "Q2 ?", options: ["A", "B"] /* pas assez d'options */ }] };
  const result = validateQuestionItemCore(item);
  assert.ok(result, "la variante 0, valide seule, doit survivre");
  assert.equal(result.variants.length, 1);
  assert.equal(result.question, "Q1 ?");
});

test("variants : une variante strictement dupliquée est retirée, pas l'autre", () => {
  const item = { variants: [qcmVariant("Même question ?", 0), qcmVariant("Même question ?", 1)] };
  const result = validateQuestionItemCore(item);
  assert.ok(result);
  assert.equal(result.variants.length, 1);
});

test("variants : un format composite n'est autorisé qu'en position principale (variants[0]) — une variante composite mal placée est retirée, pas la question entière", () => {
  const compositeSecond = {
    variants: [
      qcmVariant("Direct ?", 0),
      { type: "association", question: "Associe ?", pairs: [{ left: "A", right: "1" }, { left: "B", right: "2" }, { left: "C", right: "3" }], explanation: "..." }
    ]
  };
  const result1 = validateQuestionItemCore(compositeSecond);
  assert.ok(result1, "la variante 0 (qcm), valide seule, doit survivre");
  assert.equal(result1.variants.length, 1);
  assert.equal(result1.type, "qcm");

  const compositeFirst = {
    variants: [
      { type: "association", question: "Associe ?", pairs: [{ left: "A", right: "1" }, { left: "B", right: "2" }, { left: "C", right: "3" }], explanation: "..." }
    ]
  };
  const result2 = validateQuestionItemCore(compositeFirst);
  assert.ok(result2, "un composite reste valide seul en position 0");
  assert.equal(result2.variants.length, 1);

  // Cas réel observé en production le 16/08/2026 : l'IA répète le MÊME
  // format composite en position 1 (ex. intrus+intrus) malgré la consigne —
  // la 2e est retirée, la 1re (parfaitement valide) est conservée.
  const compositeBoth = {
    variants: [
      { type: "intrus", question: "Lequel de ces éléments n'a pas...", options: ["A", "B", "C", "D"], correctIndex: 3, explanation: "..." },
      { type: "intrus", question: "Parmi ces éléments, lequel...", options: ["W", "X", "Y", "Z"], correctIndex: 2, explanation: "..." }
    ]
  };
  const result3 = validateQuestionItemCore(compositeBoth);
  assert.ok(result3, "la 1re variante composite, valide seule, doit survivre");
  assert.equal(result3.variants.length, 1);
  assert.equal(result3.type, "intrus");
});

test("variants : un tableau qui ne laisse RIEN de valide après filtrage renvoie null", () => {
  const item = { variants: [{ type: "qcm", question: "Q ?", options: ["A", "B"] }, { type: "qcm", question: "Q2 ?" }] };
  assert.equal(validateQuestionItemCore(item), null);
});

test("variants : knowledgeTarget est conservé s'il est fourni, jamais requis", () => {
  const withTarget = validateQuestionItemCore({ knowledgeTarget: "La chute du mur de Berlin a lieu en 1989.", variants: [qcmVariant("Q ?", 0)] });
  assert.equal(withTarget.knowledgeTarget, "La chute du mur de Berlin a lieu en 1989.");

  const withoutTarget = validateQuestionItemCore({ variants: [qcmVariant("Q ?", 0)] });
  assert.equal(withoutTarget.knowledgeTarget, undefined);
});

test("variants : un retrievalMode inconnu est ignoré plutôt que de faire échouer la validation", () => {
  const item = { variants: [qcmVariant("Q ?", 0, { retrievalMode: "n'importe quoi" })] };
  const result = validateQuestionItemCore(item);
  assert.ok(result);
  assert.equal(result.retrievalMode, undefined);
});

test("variants : forme historique (question à plat, sans `variants`) reste acceptée en repli", () => {
  const item = { type: "qcm", question: "Ancienne forme ?", options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "..." };
  const result = validateQuestionItemCore(item);
  assert.ok(result);
  assert.equal(result.variants, undefined, "pas de tableau variants pour la forme historique, cf. getQuestionVariants côté lecture");
});
