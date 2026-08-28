"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeComparisonText,
  validateQuestionQuality,
  validateQuestionBatchQuality,
  parseSemanticReviews,
  runQuestionQualityPipeline,
  validateFinalShuffledQuestion
} = require("../lib/qcm-quality");

function q(question = "Quelle est la capitale du Canada ?", overrides = {}) {
  return {
    type: "qcm",
    question,
    options: ["Ottawa", "Toronto", "Montréal", "Vancouver"],
    correctIndex: 0,
    explanation: "Ottawa est la capitale fédérale du Canada.",
    knowledgeTarget: "Ottawa est la capitale du Canada.",
    sourceId: "canada",
    ...overrides
  };
}

function codes(result) { return result.reasons.map((entry) => entry.code); }

test("normalisation de comparaison : casse, accents, espaces, ponctuation et apostrophes", () => {
  assert.equal(normalizeComparisonText("  « L’ÉTÉ\u00a0! » "), "l'ete");
});

test("rejette les options identiques et équivalentes après normalisation", () => {
  assert.ok(codes(validateQuestionQuality(q(undefined, { options: ["Été", " ete! ", "Hiver", "Automne"] }))).includes("DUPLICATE_OPTIONS"));
});

test("rejette option vide, bonne réponse répétée et correctIndex invalide", () => {
  assert.ok(codes(validateQuestionQuality(q(undefined, { options: ["Ottawa", "", "Ottawa", "Toronto"], correctIndex: 9 }))).includes("EMPTY_OPTION"));
  assert.ok(codes(validateQuestionQuality(q(undefined, { options: ["Ottawa", "", "Ottawa", "Toronto"], correctIndex: 9 }))).includes("DUPLICATE_OPTIONS"));
  assert.ok(codes(validateQuestionQuality(q(undefined, { correctIndex: 9 }))).includes("INVALID_CORRECT_INDEX"));
});

test("rejette correctIndexes dupliqués, explication vide et type inconnu", () => {
  const multi = q("Quelles villes sont au Canada ?", { type: "qcm_multi", correctIndexes: [0, 0, 1] });
  assert.ok(codes(validateQuestionQuality(multi)).includes("DUPLICATE_CORRECT_INDEXES"));
  assert.ok(codes(validateQuestionQuality(q(undefined, { explanation: "" }))).includes("MISSING_EXPLANATION"));
  assert.ok(codes(validateQuestionQuality(q(undefined, { type: "mystere" }))).includes("UNKNOWN_TYPE"));
});

test("rejette toutes/aucune des réponses et un oui/non déguisé", () => {
  assert.ok(codes(validateQuestionQuality(q(undefined, { options: ["Ottawa", "Toronto", "Montréal", "Toutes les réponses"] }))).includes("FORBIDDEN_OPTION"));
  assert.ok(codes(validateQuestionQuality(q(undefined, { options: ["Ottawa", "Toronto", "Montréal", "Aucune de ces réponses"] }))).includes("FORBIDDEN_OPTION"));
  assert.ok(codes(validateQuestionQuality(q("Est-ce que le Canada est un pays ?", { options: ["Oui", "Non", "Cela dépend", "Toujours"] }))).includes("ARTIFICIAL_YES_NO"));
});

test("rejette une incompatibilité grammaticale sûre dans un texte à trous", () => {
  const result = validateQuestionQuality(q("Ottawa est la ___ du Canada.", {
    type: "texte_a_trous",
    options: ["la capitale", "province", "frontière", "monnaie"]
  }));
  assert.ok(codes(result).includes("GRAMMATICAL_OPTION_MISMATCH"));
});

test("rejette variantes identiques et questions lexicalement quasi identiques avec mêmes options", () => {
  const withVariants = q(undefined, { variants: [q().variants?.[0] || q(), q("Quelle est la capitale du Canada !")] });
  assert.ok(validateQuestionBatchQuality([withVariants]).rejected[0].reasons.some((entry) => entry.code === "DUPLICATE_VARIANT"));
  const batch = validateQuestionBatchQuality([q(), q("Quelle est exactement la capitale du Canada ?")]);
  assert.equal(batch.accepted.length, 1);
  assert.ok(batch.rejected[0].reasons.some((entry) => entry.code === "DUPLICATE_QUESTION"));
});

test("ne confond pas deux bundles variants distincts dont le champ question racine est absent", () => {
  const canada = {
    knowledgeTarget: "Ottawa est la capitale du Canada.",
    sourceId: "canada",
    variants: [q("Quelle est la capitale du Canada ?")]
  };
  const japan = {
    knowledgeTarget: "Tokyo est la capitale du Japon.",
    sourceId: "japon",
    variants: [q("Quelle est la capitale du Japon ?", {
      options: ["Tokyo", "Kyoto", "Osaka", "Nagoya"],
      explanation: "Tokyo est la capitale du Japon."
    })]
  };
  const batch = validateQuestionBatchQuality([canada, japan]);
  assert.equal(batch.accepted.length, 2);
  assert.equal(batch.rejected.length, 0);
});

test("rejette toujours deux bundles variants dont la variante principale est réellement dupliquée", () => {
  const first = { knowledgeTarget: q().knowledgeTarget, sourceId: "canada", variants: [q()] };
  const duplicate = { knowledgeTarget: q().knowledgeTarget, sourceId: "canada-2", variants: [q()] };
  const batch = validateQuestionBatchQuality([first, duplicate]);
  assert.equal(batch.accepted.length, 1);
  assert.ok(batch.rejected[0].reasons.some((entry) => entry.code === "DUPLICATE_QUESTION"));
});

test("parseSemanticReviews est fail-closed pour réponse invalide ou incomplète", () => {
  assert.equal(parseSemanticReviews({}, ["q-1"]).valid, false);
  assert.equal(parseSemanticReviews({ reviews: [] }, ["q-1"]).errorCode, "CRITIC_INCOMPLETE_RESPONSE");
});

test("parseSemanticReviews est fail-closed pour identifiant inconnu ou dupliqué", () => {
  const review = (id) => ({
    id,
    verdict: "accept",
    reasonCodes: [],
    expectedCorrectIndexes: [0],
    targetsKnowledge: true,
    groundedInSource: true
  });
  assert.equal(parseSemanticReviews({ reviews: [review("q-1"), review("inconnu")] }, ["q-1", "q-2"]).valid, false);
  assert.equal(parseSemanticReviews({ reviews: [review("q-1"), review("q-1")] }, ["q-1", "q-2"]).valid, false);
});

test("validation finale post-shuffle : correctIndex conserve la bonne option", () => {
  const before = q();
  const after = { ...before, options: ["Toronto", "Vancouver", "Ottawa", "Montréal"], correctIndex: 2 };
  assert.equal(validateFinalShuffledQuestion(before, after).valid, true);
  const broken = { ...after, correctIndex: 0 };
  assert.ok(codes(validateFinalShuffledQuestion(before, broken)).includes("POST_SHUFFLE_CORRECT_INDEX_MISMATCH"));
});

test("validation finale post-shuffle : correctIndexes conserve exactement les bonnes options", () => {
  const before = q("Quelles villes sont canadiennes ?", { type: "qcm_multi", correctIndexes: [0, 2] });
  const after = { ...before, options: ["Montréal", "Toronto", "Vancouver", "Ottawa"], correctIndexes: [0, 3] };
  assert.equal(validateFinalShuffledQuestion(before, after).valid, true);
  assert.ok(codes(validateFinalShuffledQuestion(before, { ...after, correctIndexes: [0, 1] })).includes("POST_SHUFFLE_CORRECT_INDEXES_MISMATCH"));
});

test("pipeline : question acceptée par la critique", async () => {
  const result = await runQuestionQualityPipeline([q()], {
    reviewSemantic: async ({ entries }) => ({ reviews: entries.map((entry) => ({ id: entry.id, verdict: "accept", reasonCodes: [], expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: true })) })
  });
  assert.equal(result.accepted.length, 1);
});

test("critique : chaque variante non mélangée reçoit son propre verdict", async () => {
  const item = q(undefined, { variants: [q(), q("Dans quel pays Ottawa est-elle la capitale ?", { correctIndex: 0 })] });
  let reviewed = 0;
  const result = await runQuestionQualityPipeline([item], {
    maxRetries: 0,
    reviewSemantic: async ({ entries }) => {
      reviewed = entries.length;
      return { reviews: entries.map((entry, index) => ({
        id: entry.id,
        verdict: index === 1 ? "reject" : "accept",
        reasonCodes: index === 1 ? ["AMBIGUOUS_WORDING"] : [],
        expectedCorrectIndexes: [0],
        targetsKnowledge: true,
        groundedInSource: true
      })) };
    }
  });
  assert.equal(reviewed, 2);
  assert.equal(result.accepted.length, 0, "une variante douteuse refuse le bundle avant shuffle");
});

for (const scenario of [
  ["question ambiguë", "AMBIGUOUS_WORDING"],
  ["deux réponses correctes", "MULTIPLE_CORRECT_ANSWERS"],
  ["mauvaise réponse marquée", "WRONG_CORRECT_INDEX"],
  ["explication contradictoire", "CONTRADICTORY_EXPLANATION"],
  ["hors knowledgeTarget", "OFF_KNOWLEDGE_TARGET"],
  ["non fondée dans la source", "NOT_GROUNDED_IN_SOURCE"]
]) {
  test(`critique mockée : ${scenario[0]} est refusée`, async () => {
    const result = await runQuestionQualityPipeline([q()], {
      maxRetries: 0,
      reviewSemantic: async ({ entries }) => ({ reviews: [{ id: entries[0].id, verdict: "reject", reasonCodes: [scenario[1]], expectedCorrectIndexes: [0], targetsKnowledge: scenario[1] !== "OFF_KNOWLEDGE_TARGET", groundedInSource: scenario[1] !== "NOT_GROUNDED_IN_SOURCE" }] })
    });
    assert.equal(result.accepted.length, 0);
    assert.equal(result.rejected[0].reasons[0].code, scenario[1]);
  });
}

test("timeout critique : aucune validation positive", async () => {
  const result = await runQuestionQualityPipeline([q()], { maxRetries: 0, reviewSemantic: async () => { const error = new Error("timeout"); error.code = "CRITIC_TIMEOUT"; throw error; } });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.metrics.criticErrorCode, "CRITIC_TIMEOUT");
});

for (const code of ["CRITIC_TIMEOUT", "OPENAI_HTTP_429", "OPENAI_HTTP_500", "CRITIC_NETWORK_ERROR", "CRITIC_INVALID_JSON"]) {
  test(`${code} du critique : retry technique du même lot, sans générateur`, async () => {
    let regenerationCalls = 0;
    const snapshots = [];
    const result = await runQuestionQualityPipeline([q()], {
      maxRetries: 2,
      maxTechnicalRetries: 2,
      technicalBackoff: async () => {},
      reviewSemantic: async ({ entries }) => {
        snapshots.push(JSON.stringify(entries));
        const error = new Error(code); error.code = code; throw error;
      },
      regenerate: async () => { regenerationCalls += 1; return []; }
    });
    assert.equal(result.accepted.length, 0);
    assert.equal(result.metrics.criticErrorCode, code);
    assert.equal(result.metrics.criticTechnicalAttempts, 3);
    assert.equal(result.metrics.criticTechnicalRetries, 2);
    assert.equal(result.metrics.regenerationCycles, 0);
    assert.equal(result.metrics.technicalFailure, true);
    assert.equal(regenerationCalls, 0);
    assert.equal(new Set(snapshots).size, 1, "les questions doivent rester strictement inchangées");
  });
}

test("réponse critique incomplète, id inconnu ou dupliqué : retry technique sans générateur", async () => {
  let regenerationCalls = 0;
  for (const mode of ["incomplete", "unknown", "duplicate"]) {
    let criticCalls = 0;
    const result = await runQuestionQualityPipeline([q()], {
      maxTechnicalRetries: 1,
      technicalBackoff: async () => {},
      reviewSemantic: async ({ entries }) => {
        criticCalls += 1;
        const valid = { id: entries[0].id, verdict: "accept", reasonCodes: [], expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: true };
        if (mode === "incomplete") return { reviews: [] };
        if (mode === "unknown") return { reviews: [{ ...valid, id: "unknown" }] };
        return { reviews: [valid, valid] };
      },
      regenerate: async () => { regenerationCalls += 1; return []; }
    });
    assert.equal(result.accepted.length, 0);
    assert.equal(criticCalls, 2);
    assert.equal(result.metrics.regenerationCycles, 0);
  }
  assert.equal(regenerationCalls, 0);
});

test("un véritable reject sémantique régénère uniquement la question refusée", async () => {
  const kept = q("Quelle ville est la capitale fédérale du Canada ?");
  const refused = q("Quelle ville est officiellement la capitale du Canada ?", { sourceId: "canada-2" });
  const replacement = q("Où siège le gouvernement fédéral canadien ?", { sourceId: "canada-2" });
  let regenerationInput;
  let criticCycle = 0;
  const result = await runQuestionQualityPipeline([kept, refused], {
    reviewSemantic: async ({ entries }) => {
      criticCycle += 1;
      return { reviews: entries.map((entry, index) => ({
        id: entry.id,
        verdict: criticCycle === 1 && index === 1 ? "reject" : "accept",
        reasonCodes: criticCycle === 1 && index === 1 ? ["AMBIGUOUS_WORDING"] : [],
        expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: true
      })) };
    },
    regenerate: async (input) => { regenerationInput = input; return [replacement]; }
  });
  assert.equal(regenerationInput.rejected.length, 1);
  assert.equal(regenerationInput.rejected[0].question, refused);
  assert.deepEqual(regenerationInput.accepted, [kept]);
  assert.equal(result.accepted.length, 2);
  assert.equal(result.metrics.regenerationCycles, 1);
  assert.equal(result.metrics.criticTechnicalRetries, 0);
});

test("post-shuffle compare le texte des réponses, même lorsque deux options sont proches", () => {
  const before = q(undefined, { options: ["Canberra", "Canterbury", "Sydney", "Melbourne"], correctIndex: 0 });
  const after = { ...before, options: ["Canterbury", "Sydney", "Canberra", "Melbourne"], correctIndex: 2 };
  assert.equal(validateFinalShuffledQuestion(before, after).valid, true);
  assert.ok(codes(validateFinalShuffledQuestion(before, { ...after, correctIndex: 0 })).includes("POST_SHUFFLE_CORRECT_INDEX_MISMATCH"));
});

test("critique : un verdict accept avec un autre correctIndex reste refusé", async () => {
  const result = await runQuestionQualityPipeline([q()], {
    maxRetries: 0,
    reviewSemantic: async ({ entries }) => ({ reviews: [{ id: entries[0].id, verdict: "accept", reasonCodes: [], expectedCorrectIndexes: [2], targetsKnowledge: true, groundedInSource: true }] })
  });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0].reasons[0].code, "CRITIC_CORRECT_INDEX_MISMATCH");
});

test("feature flag désactivé : contrôle déterministe conservé, critique non appelée", async () => {
  let called = false;
  const result = await runQuestionQualityPipeline([q()], { semanticReviewEnabled: false, reviewSemantic: async () => { called = true; } });
  assert.equal(result.accepted.length, 1);
  assert.equal(called, false);
});

test("régénération ciblée : seules les refusées repartent, acceptées conservées, motifs transmis", async () => {
  const acceptedQuestion = q("Quelle ville est la capitale fédérale du Canada ?");
  const rejectedQuestion = q("Quelle est la capitale du Canada ?", { options: ["Ottawa", " ottawa! ", "Toronto", "Montréal"] });
  let regenerationInput;
  const replacement = q("Dans quelle ville siège le gouvernement fédéral canadien ?");
  const result = await runQuestionQualityPipeline([acceptedQuestion, rejectedQuestion], {
    semanticReviewEnabled: false,
    regenerate: async (input) => { regenerationInput = input; return [replacement]; }
  });
  assert.equal(result.accepted.length, 2);
  assert.equal(regenerationInput.rejected.length, 1);
  assert.ok(regenerationInput.rejected[0].reasons.some((entry) => entry.code === "DUPLICATE_OPTIONS"));
});

test("nouveau doublon refusé à nouveau et arrêt après deux cycles sans stockage invalide", async () => {
  let calls = 0;
  const invalid = q(undefined, { options: ["Ottawa", "Ottawa", "Toronto", "Montréal"] });
  const result = await runQuestionQualityPipeline([invalid], {
    semanticReviewEnabled: false,
    maxRetries: 2,
    regenerate: async () => { calls += 1; return [invalid]; }
  });
  assert.equal(calls, 2);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.metrics.regenerationCycles, 2);
});

test("une régénération qui duplique une question déjà acceptée est refusée", async () => {
  const good = q("Quelle est la capitale fédérale du Canada ?");
  const bad = q("Question initiale invalide sur le Canada ?", { options: ["Ottawa", " ottawa ", "Toronto", "Montréal"] });
  const result = await runQuestionQualityPipeline([good, bad], {
    semanticReviewEnabled: false,
    maxRetries: 1,
    regenerate: async () => [{ ...good }]
  });
  assert.equal(result.accepted.length, 1);
  assert.ok(result.rejected.some((entry) => entry.reasons.some((item) => item.code === "DUPLICATE_QUESTION")));
});

test("Comprendre : une question n'utilisant qu'un côté est refusée", async () => {
  const result = await runQuestionQualityPipeline([q()], {
    maxRetries: 0,
    context: { isComprehension: true },
    reviewSemantic: async ({ entries }) => ({ reviews: [{ id: entries[0].id, verdict: "accept", reasonCodes: [], expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: true, usesBothKnowledgeSides: false }] })
  });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0].reasons[0].code, "COMPREHENSION_ONE_SIDED");
});
