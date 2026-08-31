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
  assert.ok(Object.keys(result.metrics.reasonCounts).length >= 1);
  assert.deepEqual(result.metrics.unresolvedReasonCounts, {});
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
  assert.equal(result.metrics.unresolvedReasonCounts.DUPLICATE_OPTIONS, 1);
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

// ── groundingSources (V3, 31/08/2026 — "traçabilité factuelle des QCM") ────

const CANADA_SOURCES = { SOURCE_1: { text: "Ottawa est la capitale fédérale du Canada, choisie en 1857 par la reine Victoria." } };

function qGrounded(overrides = {}) {
  return q(undefined, {
    supporting_claim: "Ottawa est la capitale fédérale du Canada.",
    source_ids: ["SOURCE_1"],
    ...overrides
  });
}

test("groundingSources absent (comportement par défaut) : une question sans supporting_claim/source_ids passe sans être affectée", async () => {
  const result = await runQuestionQualityPipeline([q()], { semanticReviewEnabled: false });
  assert.equal(result.accepted.length, 1);
});

test("groundingSources fourni : une question correctement tracée est acceptée sans appel IA supplémentaire", async () => {
  let reviewCalled = false;
  const result = await runQuestionQualityPipeline([qGrounded()], {
    semanticReviewEnabled: false,
    groundingSources: CANADA_SOURCES,
    reviewSemantic: async () => { reviewCalled = true; }
  });
  assert.equal(result.accepted.length, 1);
  assert.equal(reviewCalled, false);
});

test("groundingSources fourni : une question citant une source inexistante est rejetée avec un code GROUNDING_* dédié", async () => {
  const result = await runQuestionQualityPipeline([qGrounded({ source_ids: ["SOURCE_9"] })], {
    semanticReviewEnabled: false,
    groundingSources: CANADA_SOURCES,
    maxRetries: 0
  });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0].reasons[0].code, "GROUNDING_UNKNOWN_SOURCE");
});

test("groundingSources fourni : sur un lot de plusieurs questions, seule celle non tracée est envoyée en régénération ciblée, les autres restent conservées (section 14)", async () => {
  const good = qGrounded();
  const untraceable = q("Quelle ville canadienne compte le plus d'habitants ?", { options: ["Toronto", "Montréal", "Vancouver", "Calgary"], supporting_claim: "", source_ids: [] });
  let regenerationInput = null;
  const replacement = qGrounded({ question: "Dans quelle ville siège le gouvernement fédéral canadien ?" });
  const result = await runQuestionQualityPipeline([good, untraceable], {
    semanticReviewEnabled: false,
    groundingSources: CANADA_SOURCES,
    regenerate: async (input) => { regenerationInput = input; return [replacement]; }
  });
  assert.equal(result.accepted.length, 2);
  assert.equal(regenerationInput.rejected.length, 1);
  assert.equal(regenerationInput.rejected[0].reasons[0].code, "GROUNDING_MISSING_SUPPORTING_CLAIM");
  // La question déjà correctement tracée n'est jamais repassée en régénération.
  assert.ok(!regenerationInput.accepted.some((item) => item.question === "Quelle ville canadienne compte le plus d'habitants ?"));
});

test("groundingSources fourni : un nombre incorrect dans la bonne réponse est rejeté (numeric_claim_not_supported)", async () => {
  const wrongYear = qGrounded({
    question: "En quelle année Ottawa devient-elle la capitale du Canada ?",
    options: ["1855", "1857", "1860", "1867"],
    correctIndex: 2,
    supporting_claim: "Ottawa est choisie comme capitale fédérale en 1857.",
    source_ids: ["SOURCE_1"]
  });
  const result = await runQuestionQualityPipeline([wrongYear], { semanticReviewEnabled: false, groundingSources: CANADA_SOURCES, maxRetries: 0 });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0].reasons[0].code, "GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED");
});

// ── Métriques de grounding (V3.1, 31/08/2026 — "observabilité") ───────────

test("métriques : groundingEnabled reste false et tous les compteurs à 0 quand groundingSources n'est pas fourni (comportement neutre)", async () => {
  const result = await runQuestionQualityPipeline([q()], { semanticReviewEnabled: false });
  assert.equal(result.metrics.groundingEnabled, false);
  assert.equal(result.metrics.groundingCandidatesFirstPass, 0);
  assert.equal(result.metrics.groundingRejectedFirstPass, 0);
  assert.equal(result.metrics.groundingAcceptedFirstPass, 0);
  assert.equal(result.metrics.groundingRegenerationTriggerCount, 0);
  assert.equal(result.metrics.groundingFailedFinal, 0);
});

test("métriques : premier passage entièrement accepté → groundingAcceptedFirstPass = candidats, aucun rejet", async () => {
  const result = await runQuestionQualityPipeline([qGrounded(), qGrounded({ question: "Où siège le gouvernement fédéral canadien ?" })], {
    semanticReviewEnabled: false,
    groundingSources: CANADA_SOURCES
  });
  assert.equal(result.metrics.groundingEnabled, true);
  assert.equal(result.metrics.groundingCandidatesFirstPass, 2);
  assert.equal(result.metrics.groundingRejectedFirstPass, 0);
  assert.equal(result.metrics.groundingAcceptedFirstPass, 2);
  assert.equal(result.metrics.groundingRegenerationTriggerCount, 0);
  assert.equal(result.metrics.groundingFailedFinal, 0);
});

test("métriques : rejet au premier passage puis régénération réussie → recovered dans groundingAcceptedAfterRegeneration, jamais dans failedFinal", async () => {
  const bad = qGrounded({ source_ids: ["SOURCE_9"] }); // unknown_source
  const fixed = qGrounded();
  const result = await runQuestionQualityPipeline([bad], {
    semanticReviewEnabled: false,
    groundingSources: CANADA_SOURCES,
    maxRetries: 1,
    regenerate: async () => [fixed]
  });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.metrics.groundingRejectedFirstPass, 1);
  assert.equal(result.metrics.groundingRegenerationTriggerCount, 1);
  assert.equal(result.metrics.groundingFailedFinal, 0);
  assert.equal(result.metrics.groundingAcceptedAfterRegeneration, 1);
});

test("métriques : rejet persistant après épuisement des cycles → groundingFailedFinal compte l'échec, jamais accepté", async () => {
  const alwaysBad = qGrounded({ source_ids: ["SOURCE_9"] });
  let regenCalls = 0;
  const result = await runQuestionQualityPipeline([alwaysBad], {
    semanticReviewEnabled: false,
    groundingSources: CANADA_SOURCES,
    maxRetries: 2,
    regenerate: async () => { regenCalls += 1; return [qGrounded({ source_ids: ["SOURCE_9"] })]; }
  });
  assert.equal(result.accepted.length, 0);
  assert.equal(regenCalls, 2);
  assert.equal(result.metrics.groundingRegenerationTriggerCount, 2); // une fois par cycle où la régénération a été déclenchée
  assert.equal(result.metrics.groundingFailedFinal, 1);
  assert.equal(result.metrics.groundingAcceptedAfterRegeneration, 1); // 2 déclenchements - 1 échec final, cf. limite documentée (approximation par budget, pas par lignée exacte)
});

test("métriques : un rejet purement structurel (pas de grounding) n'incrémente jamais les compteurs grounding", async () => {
  const structurallyBad = qGrounded({ options: ["Ottawa", "Ottawa", "Toronto", "Montréal"] }); // DUPLICATE_OPTIONS, avant même le contrôle grounding
  const result = await runQuestionQualityPipeline([structurallyBad], { semanticReviewEnabled: false, groundingSources: CANADA_SOURCES, maxRetries: 0 });
  assert.equal(result.rejected[0].reasons.some((r) => r.code === "DUPLICATE_OPTIONS"), true);
  assert.equal(result.rejected[0].reasons.some((r) => r.code.startsWith("GROUNDING_")), false);
  assert.equal(result.metrics.groundingCandidatesFirstPass, 0, "jamais soumis au contrôle grounding : déjà invalide avant");
  assert.equal(result.metrics.groundingRejectedFirstPass, 0);
});

// ── Sécurisation avant amélioration pédagogique (demande du 31/08/2026,
// suite à l'audit QCM complet) : ces tests verrouillent le COMPORTEMENT
// ACTUEL de runQuestionQualityPipeline pour un motif de rejet PÉDAGOGIQUE
// (fictif à ce stade — la production ne produit pas encore ce genre de
// code, cf. rapport d'audit §12). Objectif : garantir qu'une future
// extension du critique sémantique (hors périmètre de cette étape) pourra
// s'appuyer sur EXACTEMENT le même mécanisme de régénération ciblée que les
// rejets déterministes/grounding existants, sans aucune modification de ce
// fichier. Aucun nouveau code de production n'est créé ici.

test("motif pédagogique fictif (IMPLAUSIBLE_DISTRACTOR) : Q1 et Q2 valides restent EXACTEMENT les mêmes références, seule Q3 part en régénération", async () => {
  const q1 = q("Quelle est la capitale du Canada ?");
  const q2 = q("Quelle ville canadienne abrite le Parlement fédéral ?", { sourceId: "canada-2" });
  const q3 = q("Quelle est la capitale du Canada, selon les institutions ?", { sourceId: "canada-3" });
  const replacementForQ3 = q("Où siège le gouvernement fédéral du Canada ?", { sourceId: "canada-3" });
  let regenerationInput = null;
  const result = await runQuestionQualityPipeline([q1, q2, q3], {
    maxRetries: 1,
    reviewSemantic: async ({ entries }) => ({
      reviews: entries.map((entry, index) => ({
        id: entry.id,
        verdict: index === 2 ? "reject" : "accept",
        reasonCodes: index === 2 ? ["IMPLAUSIBLE_DISTRACTOR"] : [],
        expectedCorrectIndexes: [0],
        targetsKnowledge: true,
        groundedInSource: true
      }))
    }),
    regenerate: async (input) => { regenerationInput = input; return [replacementForQ3]; }
  });
  assert.equal(regenerationInput.rejected.length, 1, "seule Q3 doit être transmise au callback de régénération");
  assert.equal(regenerationInput.rejected[0].question, q3);
  assert.equal(regenerationInput.rejected[0].reasons[0].code, "IMPLAUSIBLE_DISTRACTOR");
  assert.deepEqual(regenerationInput.accepted, [q1, q2], "Q1 et Q2 sont transmises telles quelles au générateur, comme contexte 'déjà acceptées'");
  assert.equal(result.accepted.length, 3);
  assert.equal(result.accepted[0], q1, "Q1 doit rester EXACTEMENT la même référence, jamais rejouée");
  assert.equal(result.accepted[1], q2, "Q2 doit rester EXACTEMENT la même référence, jamais rejouée");
  assert.equal(result.accepted[2], replacementForQ3);
});

// DANGER — comportement actuel documenté tel quel, PAS ENCORE CORRIGÉ
// (décision à prendre séparément, cf. rapport d'audit §9/§21). Si le
// critique tombe en panne technique sur un cycle TARDIF (après qu'un cycle
// précédent a déjà fait accepter des questions), `accepted.length = 0`
// efface AUSSI ces questions déjà validées. Ce test sert de photographie
// explicite pour permettre une décision consciente plus tard : conserver ce
// comportement fail-closed agressif, ou le corriger pour ne wiper que le
// cycle en cours.
test("DANGER (comportement actuel, non corrigé) : une panne technique du critique sur un cycle tardif efface aussi les questions acceptées lors d'un cycle précédent", async () => {
  const kept = q("Quelle ville est la capitale fédérale du Canada ?");
  const toFix = q("Quelle est la capitale du Canada ?", { sourceId: "canada-2" });
  const replacement = q("Où siège le gouvernement fédéral canadien ?", { sourceId: "canada-2" });
  let criticCall = 0;
  const result = await runQuestionQualityPipeline([kept, toFix], {
    maxRetries: 1,
    maxTechnicalRetries: 1,
    technicalBackoff: async () => {},
    reviewSemantic: async ({ entries }) => {
      criticCall += 1;
      if (criticCall === 1) {
        // Cycle 1 : verdict normal — `kept` accepté, `toFix` refusé (motif
        // sémantique quelconque), déclenchant une régénération ciblée.
        return {
          reviews: entries.map((entry, index) => ({
            id: entry.id,
            verdict: index === 1 ? "reject" : "accept",
            reasonCodes: index === 1 ? ["IMPLAUSIBLE_DISTRACTOR"] : [],
            expectedCorrectIndexes: [0],
            targetsKnowledge: true,
            groundedInSource: true
          }))
        };
      }
      // Cycle 2 : panne technique persistante sur le lot régénéré.
      const error = new Error("timeout");
      error.code = "CRITIC_TIMEOUT";
      throw error;
    },
    regenerate: async () => [replacement]
  });
  assert.equal(result.metrics.technicalFailure, true);
  assert.equal(result.metrics.regenerationCycles, 1, "un seul cycle de régénération a eu lieu avant la panne");
  // Comportement actuel : `accepted` est vidé intégralement, y compris
  // `kept`, pourtant déjà validé (structurellement + sémantiquement) au
  // cycle précédent.
  assert.equal(result.accepted.length, 0, "kept est également effacé — ce n'est PAS le comportement idéal, seulement le comportement actuel");
  // `kept` n'apparaît nulle part : ni accepté, ni dans l'historique des
  // rejets — il disparaît silencieusement.
  assert.ok(!result.rejected.some((entry) => entry.question === kept), "kept ne réapparaît pas non plus dans l'historique des rejets — il disparaît silencieusement");
});

// ── Multi-pipelines (§10 de l'audit) : le critique est partagé par les 6
// pipelines QCM, qui ne diffèrent que par `context.hasIndependentSource`/
// `context.isComprehension` — jamais par la logique du pipeline
// lui-même. `hasIndependentSource:false` ne survient en pratique que pour
// le pipeline "sujet libre"/"notion avec niveau" quand AUCUNE source
// Brave n'a été trouvée ; tous les autres pipelines (Éclairages/Histoire,
// imports, Comprendre) passent toujours `hasIndependentSource:true`
// explicitement — déjà couvert par les tests groundingSources/Comprendre
// ci-dessus. Les deux tests suivants verrouillent le SEUL cas encore non
// couvert : la bascule elle-même.

test("hasIndependentSource:false (grounding web non trouvé, pipeline 'sujet libre' sans corpus) : un verdict accept est retenu même si groundedInSource:false", async () => {
  const result = await runQuestionQualityPipeline([q()], {
    maxRetries: 0,
    context: { hasIndependentSource: false },
    reviewSemantic: async ({ entries }) => ({
      reviews: [{ id: entries[0].id, verdict: "accept", reasonCodes: [], expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: false }]
    })
  });
  assert.equal(result.accepted.length, 1, "sans grounding indépendant, groundedInSource:false ne doit pas, à lui seul, faire échouer la question");
});

test("hasIndependentSource omis (comportement par défaut, imports/Éclairages/Comprendre) : groundedInSource:false fait échouer la question", async () => {
  const result = await runQuestionQualityPipeline([q()], {
    maxRetries: 0,
    reviewSemantic: async ({ entries }) => ({
      reviews: [{ id: entries[0].id, verdict: "accept", reasonCodes: [], expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: false }]
    })
  });
  assert.equal(result.accepted.length, 0, "par défaut (hasIndependentSource non explicitement false), une source doit être jugée disponible par le critique");
  assert.equal(result.rejected[0].reasons[0].code, "NOT_GROUNDED_IN_SOURCE");
});
