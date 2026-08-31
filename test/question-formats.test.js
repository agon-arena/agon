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
  gradeQuizSubmissionOptionIndex,
  validateKnowledgeCandidates,
  filterQuestionsToAdmittedKnowledge,
  filterVariantsByKnowledgeConstraints,
  extractGroundingFields
} = require("../lib/question-formats");
const { resolveActiveQuestionVariant } = require("../lib/spaced-repetition/question-variant");

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

test("qcm_multi : le shuffle conserve les deux bonnes options et recalcule correctIndexes", () => {
  const result = validateQuestionItemCore({
    type: "qcm_multi",
    question: "Quelles villes se trouvent au Canada ?",
    options: ["Ottawa", "Montréal", "Paris", "Rome"],
    correctIndexes: [0, 1],
    explanation: "Ottawa et Montréal se trouvent au Canada."
  });
  assert.ok(result);
  assert.deepEqual(result.correctIndexes.map((index) => result.options[index]).sort(), ["Montréal", "Ottawa"]);
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
    question: "Question principale ?", options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "...",
    altVariant: { type: "association", question: "Q alt ?", pairs: [{ left: "A", right: "1" }, { left: "B", right: "2" }, { left: "C", right: "3" }] }
  };
  const result = validateQuestionItemCore(item);
  assert.ok(result);
  assert.equal(result.altVariant, undefined, "un altVariant de type composite doit être ignoré, jamais accepté");
});

test("altVariant : un type identique à la question principale est rejeté (pas une vraie variante)", () => {
  const item = {
    type: "qcm",
    question: "Question principale ?", options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "...",
    altVariant: { type: "qcm", question: "Q reformulée ?", options: ["W", "X", "Y", "Z"], correctIndex: 1, explanation: "..." }
  };
  const result = validateQuestionItemCore(item);
  assert.equal(result.altVariant, undefined);
});

test("altVariant valide (type autonome différent) : conservé avec sa propre correction", () => {
  const item = {
    type: "qcm",
    question: "Quelle est la capitale du Sénégal ?", options: ["Dakar", "Harare", "Tripoli", "Tunis"], correctIndex: 0, explanation: "...",
    altVariant: { type: "texte_a_trous", question: "Dakar est la capitale du ___.", options: ["Sénégal", "Mali", "Niger", "Tchad"], correctIndex: 0, explanation: "..." }
  };
  const result = validateQuestionItemCore(item);
  assert.ok(result.altVariant);
  assert.equal(result.altVariant.type, "texte_a_trous");
  assert.equal(result.altVariant.options[result.altVariant.correctIndex], "Sénégal");
});

// ── interdiction absolue du vrai/faux (audit pédagogique du 16/08/2026, section 5) ──

test("vrai_faux : une question de ce type est rejetée (jamais acceptée, même bien formée)", () => {
  const item = { type: "vrai_faux", question: "Dakar est la capitale du Sénégal.", options: ["Vrai", "Faux"], correctIndex: 0, explanation: "..." };
  assert.equal(validateQuestionItemCore(item), null, "coercée en qcm, qui exige 4 options — jamais 2");
});

test("vrai_faux : un altVariant de ce type est rejeté, pas la question principale", () => {
  const item = {
    type: "qcm",
    question: "Quelle est la capitale du Sénégal ?", options: ["Dakar", "Harare", "Tripoli", "Tunis"], correctIndex: 0, explanation: "...",
    altVariant: { type: "vrai_faux", question: "Dakar est la capitale du Sénégal.", options: ["Faux", "Vrai"], correctIndex: 1, explanation: "..." }
  };
  const result = validateQuestionItemCore(item);
  assert.ok(result);
  assert.equal(result.altVariant, undefined);
});

test("vrai_faux : une variante de ce type est rejetée, pas le reste du tableau", () => {
  const item = {
    variants: [
      qcmVariant("Direct ?", 0),
      { type: "vrai_faux", question: "Inverse ?", options: ["Faux", "Vrai"], correctIndex: 1, explanation: "..." }
    ]
  };
  const result = validateQuestionItemCore(item);
  assert.ok(result);
  assert.equal(result.variants.length, 1);
});

test("vrai_faux : un qcm à seulement 2 options (contournement déguisé) est rejeté", () => {
  const item = { type: "qcm", question: "Le Sénégal est-il en Afrique ?", options: ["Oui", "Non"], correctIndex: 0, explanation: "..." };
  assert.equal(validateQuestionItemCore(item), null);
});

// ── génération invalide : fallback maîtrisé, rien de corrompu inséré ──────

test("génération invalide : un item complètement malformé est rejeté sans exception", () => {
  assert.equal(validateQuestionItemCore(null), null);
  assert.equal(validateQuestionItemCore({}), null);
  assert.equal(validateQuestionItemCore({ type: "qcm", question: "Q ?" }), null, "options manquantes");
  assert.equal(validateQuestionItemCore({ type: "association", question: "Q ?", pairs: "pas un tableau" }), null);
});

test("génération invalide : un type inconnu est rejeté explicitement", () => {
  const item = { type: "format-inexistant", question: "Question inconnue ?", options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "..." };
  assert.equal(validateQuestionItemCore(item), null);
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
  const item = { variants: [qcmVariant("Question 1 ?", 0)] };
  const result = validateQuestionItemCore(item);
  assert.ok(result);
  assert.equal(result.variants.length, 1);
  assert.equal(result.question, "Question 1 ?", "la variante principale est dupliquée à plat pour les lecteurs historiques (stripQuestionForClient, GET /fiche)");
});

test("variants : 2 variants sont acceptés", () => {
  const item = { variants: [qcmVariant("Direct ?", 0), { type: "texte_a_trous", question: "Inverse ___ ?", options: ["A", "B", "C", "D"], correctIndex: 1, explanation: "..." }] };
  const result = validateQuestionItemCore(item);
  assert.ok(result);
  assert.equal(result.variants.length, 2);
});

test("variants : 3 variants pertinents sont acceptés", () => {
  const item = {
    variants: [
      qcmVariant("Direct ?", 0, { retrievalMode: "direct" }),
      { type: "texte_a_trous", question: "Inverse ___ ?", options: ["A", "B", "C", "D"], correctIndex: 1, explanation: "...", retrievalMode: "inverse" },
      qcmVariant("Contexte ?", 2, { retrievalMode: "contextual" })
    ]
  };
  const result = validateQuestionItemCore(item);
  assert.ok(result);
  assert.equal(result.variants.length, 3);
  assert.deepEqual(result.variants.map((v) => v.retrievalMode), ["direct", "inverse", "contextual"]);
});

test("variants : au-delà de 3 (le maximum), seules les 3 premières sont conservées — pas un rejet total", () => {
  assert.equal(MAX_VARIANTS_PER_QUESTION, 3);
  const item = { variants: [qcmVariant("Question 1 ?", 0), qcmVariant("Question 2 ?", 1), qcmVariant("Question 3 ?", 2), qcmVariant("Question 4 ?", 3)] };
  const result = validateQuestionItemCore(item);
  assert.ok(result, "3 variantes valides existent, la question ne doit pas être perdue pour un 4e excédent");
  assert.equal(result.variants.length, 3);
  assert.deepEqual(result.variants.map((v) => v.question), ["Question 1 ?", "Question 2 ?", "Question 3 ?"]);
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
  const item = { variants: [qcmVariant("Question 1 ?", 0), { type: "qcm", question: "Question 2 ?", options: ["A", "B"] /* pas assez d'options */ }] };
  const result = validateQuestionItemCore(item);
  assert.ok(result, "la variante 0, valide seule, doit survivre");
  assert.equal(result.variants.length, 1);
  assert.equal(result.question, "Question 1 ?");
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
  const withTarget = validateQuestionItemCore({ knowledgeTarget: "La chute du mur de Berlin a lieu en 1989.", variants: [qcmVariant("Question sur Berlin ?", 0)] });
  assert.equal(withTarget.knowledgeTarget, "La chute du mur de Berlin a lieu en 1989.");

  const withoutTarget = validateQuestionItemCore({ variants: [qcmVariant("Question sans cible ?", 0)] });
  assert.equal(withoutTarget.knowledgeTarget, undefined);
});

test("variants : un retrievalMode inconnu est ignoré plutôt que de faire échouer la validation", () => {
  const item = { variants: [qcmVariant("Question valide ?", 0, { retrievalMode: "n'importe quoi" })] };
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

// ── Admission des connaissances (demande du 17/08/2026, audit du pipeline
// mnésique, cf. lib/knowledge-admission.js pour les prompts correspondants) ──

function candidate(overrides = {}) {
  return { fact: "Fait par défaut.", importance: "high", certainty: "high", ...overrides };
}

test("validateKnowledgeCandidates : quota cible > connaissances réelles — seules les valides passent, jamais de remplissage (3 sur 5 proposées → 3)", () => {
  const raw = [
    candidate({ fact: "Fait solide 1." }),
    candidate({ fact: "Fait solide 2." }),
    candidate({ fact: "Fait solide 3." }),
    candidate({ fact: "Détail secondaire.", importance: "low" }),
    candidate({ fact: "Anecdote.", importance: "low", certainty: "low" })
  ];
  const result = validateKnowledgeCandidates(raw, { max: 5 });
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((k) => k.fact), ["Fait solide 1.", "Fait solide 2.", "Fait solide 3."]);
});

test("validateKnowledgeCandidates : 1 seule connaissance valide passe (jamais rejetée pour être seule)", () => {
  const result = validateKnowledgeCandidates([candidate({ fact: "Unique fait solide." })], { max: 20 });
  assert.equal(result.length, 1);
});

test("validateKnowledgeCandidates : Expert (max=22) avec seulement 8 connaissances solides n'en fabrique pas 15 — le plafond n'est jamais un plancher", () => {
  const raw = Array.from({ length: 8 }, (_, i) => candidate({ fact: `Fait ${i + 1}.` }));
  const result = validateKnowledgeCandidates(raw, { max: 22 });
  assert.equal(result.length, 8);
});

test("validateKnowledgeCandidates : importance=low rejetée même si certainty=high", () => {
  assert.deepEqual(validateKnowledgeCandidates([candidate({ importance: "low" })], { max: 20 }), []);
});

test("validateKnowledgeCandidates : certainty=low rejetée même si importance=high (formulation incertaine transformée en certitude)", () => {
  assert.deepEqual(validateKnowledgeCandidates([candidate({ certainty: "low" })], { max: 20 }), []);
});

test("validateKnowledgeCandidates : importance/certainty manquantes ou hors énumération sont rejetées", () => {
  const result = validateKnowledgeCandidates([
    candidate({ importance: undefined }),
    candidate({ certainty: "inconnu" }),
    { fact: "Sans champs du tout." }
  ], { max: 20 });
  assert.deepEqual(result, []);
});

test("validateKnowledgeCandidates : un fait vide ou non-string est rejeté", () => {
  const result = validateKnowledgeCandidates([
    candidate({ fact: "" }),
    candidate({ fact: "   " }),
    candidate({ fact: null }),
    candidate({ fact: 42 })
  ], { max: 20 });
  assert.deepEqual(result, []);
});

test("validateKnowledgeCandidates : dédoublonne par texte normalisé (casse/espaces), garde la première occurrence", () => {
  const result = validateKnowledgeCandidates([
    candidate({ fact: "La chute du mur de Berlin a lieu en 1989." }),
    candidate({ fact: "la chute du   mur de berlin a lieu en 1989." })
  ], { max: 20 });
  assert.equal(result.length, 1);
});

test("validateKnowledgeCandidates : entrée non-tableau ou vide renvoie [] sans planter (cas 0 connaissance)", () => {
  assert.deepEqual(validateKnowledgeCandidates(null, { max: 20 }), []);
  assert.deepEqual(validateKnowledgeCandidates(undefined, { max: 20 }), []);
  assert.deepEqual(validateKnowledgeCandidates([], { max: 20 }), []);
  assert.deepEqual(validateKnowledgeCandidates("pas un tableau", { max: 20 }), []);
});

test("validateKnowledgeCandidates : sequential/clearBoundary sont conservés en booléens stricts (jamais une valeur truthy admise par erreur)", () => {
  const result = validateKnowledgeCandidates([
    candidate({ fact: "Fait A.", sequential: true, clearBoundary: false }),
    candidate({ fact: "Fait B.", sequential: "true", clearBoundary: 1 })
  ], { max: 20 });
  assert.equal(result[0].sequential, true);
  assert.equal(result[1].sequential, false);
  assert.equal(result[1].clearBoundary, false);
});

// ── Traçabilité question ↔ connaissance admise (filterQuestionsToAdmittedKnowledge) ──

test("filterQuestionsToAdmittedKnowledge : une question dont le knowledgeTarget correspond à une connaissance admise est conservée", () => {
  const admitted = [candidate({ fact: "Paris est la capitale de la France." })];
  const questions = [{ knowledgeTarget: "Paris est la capitale de la France.", type: "qcm" }];
  assert.equal(filterQuestionsToAdmittedKnowledge(questions, admitted).length, 1);
});

test("filterQuestionsToAdmittedKnowledge : aucun nouveau knowledgeTarget n'apparaît spontanément — un fait absent de la liste admise est retiré", () => {
  const admitted = [candidate({ fact: "Paris est la capitale de la France." })];
  const questions = [
    { knowledgeTarget: "Paris est la capitale de la France.", type: "qcm" },
    { knowledgeTarget: "Fait totalement inventé, jamais admis.", type: "qcm" }
  ];
  const result = filterQuestionsToAdmittedKnowledge(questions, admitted);
  assert.equal(result.length, 1);
  assert.equal(result[0].knowledgeTarget, "Paris est la capitale de la France.");
});

test("filterQuestionsToAdmittedKnowledge : une question sans knowledgeTarget du tout est retirée (traçabilité obligatoire)", () => {
  const admitted = [candidate({ fact: "Fait admis." })];
  assert.deepEqual(filterQuestionsToAdmittedKnowledge([{ type: "qcm" }], admitted), []);
});

test("filterQuestionsToAdmittedKnowledge : comparaison insensible à la casse et aux espaces multiples", () => {
  const admitted = [candidate({ fact: "Fait   avec   espaces." })];
  const questions = [{ knowledgeTarget: "FAIT AVEC ESPACES.", type: "qcm" }];
  assert.equal(filterQuestionsToAdmittedKnowledge(questions, admitted).length, 1);
});

test("filterQuestionsToAdmittedKnowledge : les variantes restent groupées sous le même knowledgeTarget que la connaissance admise", () => {
  const admitted = [candidate({ fact: "La chute du mur de Berlin a lieu en 1989." })];
  const questionWithVariants = {
    knowledgeTarget: "La chute du mur de Berlin a lieu en 1989.",
    type: "qcm",
    variants: [{ type: "qcm", question: "Direct ?" }, { type: "qcm", question: "Inverse ?" }]
  };
  const result = filterQuestionsToAdmittedKnowledge([questionWithVariants], admitted);
  assert.equal(result.length, 1);
  assert.equal(result[0].variants.length, 2);
});

test("filterQuestionsToAdmittedKnowledge : 0 connaissance admise → 0 question conservée, sans crash", () => {
  assert.deepEqual(filterQuestionsToAdmittedKnowledge([{ knowledgeTarget: "Peu importe.", type: "qcm" }], []), []);
});

// ── Variantes de même format autorisées si l'angle de récupération diffère
// (demande du 17/08/2026, second mini-patch) ────────────────────────────

test("validateVariantsArray : deux variantes du même type mais de contenu différent sont TOUTES DEUX conservées (jamais dédoublonnées sur le seul type)", () => {
  const variants = [
    { type: "qcm", question: "À quelle date le mur de Berlin tombe-t-il ?", options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "...", retrievalMode: "direct" },
    { type: "qcm", question: "Quel événement de la fin de la guerre froide se produit le 9 novembre 1989 ?", options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "...", retrievalMode: "contextual" }
  ];
  const result = validateVariantsArray(variants);
  assert.equal(result.length, 2);
  assert.equal(result[0].type, "qcm");
  assert.equal(result[1].type, "qcm");
});

test("validateVariantsArray : deux variantes textuellement identiques (même normalisation type+question, casse/espaces de bord près) restent dédoublonnées comme avant", () => {
  // Normalisation existante = trim() + toLowerCase() (cf. dedupeKey dans
  // validateVariantsArray) — ne collapse pas les espaces internes multiples,
  // contrairement à normalizeFactText utilisée ailleurs dans ce fichier :
  // comportement préexistant, non modifié par ce patch, donc testé tel quel.
  const variants = [
    { type: "qcm", question: "  Quand le mur de Berlin tombe-t-il ? ", options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "..." },
    { type: "qcm", question: "quand le mur de berlin tombe-t-il ?", options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "..." }
  ];
  const result = validateVariantsArray(variants);
  assert.equal(result.length, 1);
});

// ── filterVariantsByKnowledgeConstraints : garde-fou déterministe ordre/
// intrus (demande du 17/08/2026, second mini-patch) ──────────────────────

function knowledgeFor(fact, overrides = {}) {
  return { fact, importance: "high", certainty: "high", sequential: false, clearBoundary: false, ...overrides };
}

function questionWithVariants(knowledgeTarget, variantTypes) {
  const variants = variantTypes.map((type, i) => ({
    type,
    question: `Question ${type} n°${i}`,
    ...(type === "association" ? { pairs: [{ left: "A", right: "1" }, { left: "B", right: "2" }, { left: "C", right: "3" }] }
      : type === "ordre" ? { items: ["1", "2", "3"] }
      : type === "qcm_multi" ? { options: ["A", "B", "C", "D"], correctIndexes: [0, 1] }
      : { options: ["A", "B", "C", "D"], correctIndex: 0 }),
    explanation: "..."
  }));
  return { id: "q1", knowledgeTarget, variants, ...variants[0] };
}

test("filterVariantsByKnowledgeConstraints : sequential=false retire la variante ordre, garde le reste", () => {
  const admitted = [knowledgeFor("Fait test.", { sequential: false })];
  const question = questionWithVariants("Fait test.", ["ordre", "qcm"]);
  const [result] = filterVariantsByKnowledgeConstraints([question], admitted);
  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0].type, "qcm");
  assert.equal(result.type, "qcm", "variants[0] doit être reflaté à la racine");
});

test("filterVariantsByKnowledgeConstraints : sequential=true conserve la variante ordre", () => {
  const admitted = [knowledgeFor("Fait séquentiel.", { sequential: true })];
  const question = questionWithVariants("Fait séquentiel.", ["ordre", "qcm"]);
  const [result] = filterVariantsByKnowledgeConstraints([question], admitted);
  assert.equal(result.variants.length, 2);
  assert.equal(result.variants[0].type, "ordre");
});

test("filterVariantsByKnowledgeConstraints : clearBoundary=false retire la variante intrus, garde le reste", () => {
  const admitted = [knowledgeFor("Fait test.", { clearBoundary: false })];
  const question = questionWithVariants("Fait test.", ["intrus", "texte_a_trous"]);
  const [result] = filterVariantsByKnowledgeConstraints([question], admitted);
  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0].type, "texte_a_trous");
});

test("filterVariantsByKnowledgeConstraints : clearBoundary=true conserve la variante intrus", () => {
  const admitted = [knowledgeFor("Fait net.", { clearBoundary: true })];
  const question = questionWithVariants("Fait net.", ["intrus", "qcm"]);
  const [result] = filterVariantsByKnowledgeConstraints([question], admitted);
  assert.equal(result.variants.length, 2);
});

test("filterVariantsByKnowledgeConstraints : mix ordre+qcm+texte_a_trous avec sequential=false → qcm+texte_a_trous, sans régénération ni trou dans le tableau", () => {
  const admitted = [knowledgeFor("Fait test.", { sequential: false, clearBoundary: true })];
  const question = questionWithVariants("Fait test.", ["ordre", "qcm", "texte_a_trous"]);
  const [result] = filterVariantsByKnowledgeConstraints([question], admitted);
  assert.deepEqual(result.variants.map((v) => v.type), ["qcm", "texte_a_trous"]);
  assert.equal(result.type, "qcm");
});

test("filterVariantsByKnowledgeConstraints : une question dont TOUTES les variantes sont rejetées est retirée du résultat, sans crash", () => {
  const admitted = [knowledgeFor("Fait non séquentiel.", { sequential: false })];
  const question = questionWithVariants("Fait non séquentiel.", ["ordre"]);
  const result = filterVariantsByKnowledgeConstraints([question], admitted);
  assert.deepEqual(result, []);
});

test("filterVariantsByKnowledgeConstraints : régression Habermas — sequential=false ET clearBoundary=false retire ordre ET intrus, garde qcm+texte_a_trous", () => {
  const fact = "Selon Habermas, l'espace public est un espace de formation de l'opinion par le débat rationnel.";
  const admitted = [knowledgeFor(fact, { sequential: false, clearBoundary: false })];
  const question = questionWithVariants(fact, ["ordre", "intrus", "qcm", "texte_a_trous"]);
  const [result] = filterVariantsByKnowledgeConstraints([question], admitted);
  assert.deepEqual(result.variants.map((v) => v.type), ["qcm", "texte_a_trous"]);
});

test("filterVariantsByKnowledgeConstraints : question flat sans variants[] — type ordre + sequential:false rejette toute la question", () => {
  const admitted = [knowledgeFor("Fait flat.", { sequential: false })];
  const flatQuestion = { id: "q1", knowledgeTarget: "Fait flat.", type: "ordre", question: "Q ?", items: ["1", "2", "3"], explanation: "..." };
  const result = filterVariantsByKnowledgeConstraints([flatQuestion], admitted);
  assert.deepEqual(result, []);
});

test("filterVariantsByKnowledgeConstraints : question flat de type qcm reste inchangée (aucune clé variants ajoutée)", () => {
  const admitted = [knowledgeFor("Fait flat qcm.")];
  const flatQuestion = { id: "q1", knowledgeTarget: "Fait flat qcm.", type: "qcm", question: "Q ?", options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "..." };
  const [result] = filterVariantsByKnowledgeConstraints([flatQuestion], admitted);
  assert.equal(result, flatQuestion);
  assert.equal(result.variants, undefined);
});

test("filterVariantsByKnowledgeConstraints : ancien format vrai_faux non affecté (ni ordre ni intrus, hors périmètre de ce filtre)", () => {
  const admitted = [knowledgeFor("Fait ancien.")];
  const flatQuestion = { id: "q1", knowledgeTarget: "Fait ancien.", type: "vrai_faux", question: "Q ?", options: ["Vrai", "Faux"], correctIndex: 0, explanation: "..." };
  const [result] = filterVariantsByKnowledgeConstraints([flatQuestion], admitted);
  assert.equal(result.type, "vrai_faux");
});

test("filterVariantsByKnowledgeConstraints : aucune connaissance correspondante trouvée → question laissée inchangée (défensif)", () => {
  const admitted = [knowledgeFor("Un tout autre fait.")];
  const question = questionWithVariants("Fait sans correspondance.", ["ordre", "qcm"]);
  const [result] = filterVariantsByKnowledgeConstraints([question], admitted);
  assert.equal(result.variants.length, 2, "hors périmètre de ce filtre, laissé tel quel");
});

test("filterVariantsByKnowledgeConstraints : après filtrage, resolveActiveQuestionVariant alterne toujours normalement sur les variantes restantes", () => {
  const admitted = [knowledgeFor("Fait test.", { sequential: false })];
  const question = questionWithVariants("Fait test.", ["ordre", "qcm", "texte_a_trous"]);
  const [result] = filterVariantsByKnowledgeConstraints([question], admitted);
  assert.equal(result.variants.length, 2);
  // reps<=0 -> toujours variants[0]
  assert.equal(resolveActiveQuestionVariant(result, 0).type, "qcm");
  // alternance stricte à 2 variantes (garantie structurelle, cf. question-variant.js)
  const seenTypes = new Set();
  for (let reps = 1; reps <= 6; reps++) seenTypes.add(resolveActiveQuestionVariant(result, reps).type);
  assert.deepEqual([...seenTypes].sort(), ["qcm", "texte_a_trous"]);
});

test("filterVariantsByKnowledgeConstraints : 0 question en entrée → 0 en sortie, sans crash", () => {
  assert.deepEqual(filterVariantsByKnowledgeConstraints([], [knowledgeFor("Peu importe.")]), []);
});

// ── supporting_claim / source_ids (V3, 31/08/2026) : régression réelle ────
// Bug constaté en conditions réelles le 31/08/2026 : validateQuestionItemCore
// reconstruisait l'objet final en ne conservant QUE knowledgeTarget,
// supprimant silencieusement supporting_claim/source_ids pourtant présents
// sur la réponse brute du modèle — les questions stockées en base n'avaient
// alors plus aucune trace de leur grounding malgré une génération et une
// validation de traçabilité qui avaient réellement eu lieu en amont.

test("extractGroundingFields : conserve supporting_claim et source_ids valides", () => {
  const fields = extractGroundingFields({ supporting_claim: "Ottawa est la capitale du Canada.", source_ids: ["SOURCE_1", "SOURCE_2"] });
  assert.deepEqual(fields, { supporting_claim: "Ottawa est la capitale du Canada.", source_ids: ["SOURCE_1", "SOURCE_2"] });
});

test("extractGroundingFields : absents ou de type invalide → champs simplement omis, jamais une erreur", () => {
  assert.deepEqual(extractGroundingFields({}), {});
  assert.deepEqual(extractGroundingFields({ supporting_claim: 42, source_ids: "SOURCE_1" }), {});
  assert.deepEqual(extractGroundingFields({ supporting_claim: "", source_ids: [] }), {});
});

test("validateQuestionItemCore : supporting_claim/source_ids survivent pour une question SANS variants (régression réelle du 31/08/2026)", () => {
  const item = {
    type: "qcm", question: "Quelle est la durée légale hebdomadaire du travail ?",
    options: ["32 heures", "35 heures", "37 heures", "40 heures"], correctIndex: 1, explanation: "...",
    knowledgeTarget: "La durée légale du travail est de 35 heures.",
    supporting_claim: "La durée légale du travail à temps complet est fixée à 35 heures par semaine.",
    source_ids: ["SOURCE_1"]
  };
  const result = validateQuestionItemCore(item);
  assert.ok(result);
  assert.equal(result.supporting_claim, "La durée légale du travail à temps complet est fixée à 35 heures par semaine.");
  assert.deepEqual(result.source_ids, ["SOURCE_1"]);
});

test("validateQuestionItemCore : supporting_claim/source_ids survivent pour une question AVEC variants (cas réel de generateNotionLevelQuiz)", () => {
  const item = {
    knowledgeTarget: "La durée légale du travail est de 35 heures.",
    supporting_claim: "La durée légale du travail à temps complet est fixée à 35 heures par semaine.",
    source_ids: ["SOURCE_1", "SOURCE_2"],
    variants: [
      { type: "qcm", question: "Quelle est la durée légale hebdomadaire du travail ?", options: ["32 heures", "35 heures", "37 heures", "40 heures"], correctIndex: 1, explanation: "...", selfContained: true, retrievalMode: "direct" }
    ]
  };
  const result = validateQuestionItemCore(item);
  assert.ok(result);
  assert.equal(result.supporting_claim, "La durée légale du travail à temps complet est fixée à 35 heures par semaine.");
  assert.deepEqual(result.source_ids, ["SOURCE_1", "SOURCE_2"]);
  // Le champ reste aussi porté par l'enveloppe à plat (première exposition, cf. stripQuestionForClient).
  assert.ok(result.variants[0]);
});

test("validateQuestionItemCore : absence de supporting_claim/source_ids ne change rien (comportement par défaut inchangé)", () => {
  const item = { type: "qcm", question: "Quelle est la bonne réponse ?", options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "..." };
  const result = validateQuestionItemCore(item);
  assert.ok(result);
  assert.equal("supporting_claim" in result, false);
  assert.equal("source_ids" in result, false);
});
