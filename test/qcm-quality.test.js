"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeComparisonText,
  validateQuestionQuality,
  validateQuestionBatchQuality,
  parseSemanticReviews,
  runQuestionQualityPipeline,
  validateFinalShuffledQuestion,
  buildSemanticReviewPrompt
} = require("../lib/qcm-quality");
const { selectOneQuestionPerKnowledgeTarget } = require("../lib/question-formats");

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

// UNNECESSARY_NEGATION (correctif du 01/09/2026, suite à l'audit qualité
// rédactionnelle des QCM — cas réel "Parmi ces groupes, lequel n'était PAS
// exclu à l'origine de l'application de la Déclaration des droits de
// l'homme et du citoyen ?"). Volontairement distinct de DOUBLE_NEGATION
// (hasDoubleNegation, testé indirectement via les cas de préservation
// ci-dessous et dans test/question-formats.test.js) : ici, une négation
// UNIQUE mais artificiellement lourde (PAS en capitales, ou négation d'un
// concept déjà négatif). Cf. lib/qcm-quality.js, hasUnnecessaryNegation.
test("UNNECESSARY_NEGATION : rejette l'exemple réel exact de l'audit (« lequel n'était PAS exclu »)", () => {
  const result = validateQuestionQuality(q(
    "Parmi ces groupes, lequel n’était PAS exclu à l’origine de l’application de la Déclaration des droits de l’homme et du citoyen ?",
    { type: "intrus", options: ["Les enfants", "Les esclaves", "Les femmes", "Les citoyens hommes"] }
  ));
  assert.ok(codes(result).includes("UNNECESSARY_NEGATION"));
});

test("UNNECESSARY_NEGATION : rejette tout \"PAS\" en capitales dans le stem, y compris hors négation-sur-concept-négatif", () => {
  assert.ok(codes(validateQuestionQuality(q("Laquelle de ces affirmations n’est PAS correcte ?", { type: "intrus" }))).includes("UNNECESSARY_NEGATION"));
  assert.ok(codes(validateQuestionQuality(q("Quelle option n’est PAS valide parmi celles-ci ?", { type: "intrus" }))).includes("UNNECESSARY_NEGATION"));
});

test("UNNECESSARY_NEGATION : rejette une négation minuscule empilée sur un concept déjà négatif (exclu/interdit/absent)", () => {
  assert.ok(codes(validateQuestionQuality(q("Quel additif alimentaire n'est pas interdit dans l'Union européenne depuis 2011 ?", { type: "qcm" }))).includes("UNNECESSARY_NEGATION"));
  assert.ok(codes(validateQuestionQuality(q("Lequel de ces sites archéologiques n'était pas absent des relevés de 1920 ?", { type: "qcm" }))).includes("UNNECESSARY_NEGATION"));
});

test("UNNECESSARY_NEGATION : ne rejette PAS une négation minuscule sans concept négatif imbriqué (préserve le format intrus courant)", () => {
  // Cas réel de production (81 % des questions "intrus", cf. rapport §8) :
  // ne doit jamais devenir un faux positif de cette règle.
  const result = validateQuestionQuality(q(
    "Parmi ces capitales, laquelle ne fait pas partie de l'Union européenne ?",
    { type: "intrus", options: ["Paris", "Berlin", "Londres", "Madrid"] }
  ));
  assert.ok(!codes(result).includes("UNNECESSARY_NEGATION"));
});

test("UNNECESSARY_NEGATION : ne rejette PAS une négation réellement nécessaire (« jamais », sans « pas »)", () => {
  const result = validateQuestionQuality(q("Quel pays n'a jamais participé aux Jeux olympiques d'été ?", { type: "qcm" }));
  assert.ok(!codes(result).includes("UNNECESSARY_NEGATION"));
});

test("UNNECESSARY_NEGATION : ne rejette PAS une question affirmative portant intrinsèquement sur une interdiction (pas de négation syntaxique)", () => {
  const result = validateQuestionQuality(q("Quel additif alimentaire est interdit dans l'Union européenne depuis 2011 ?", { type: "qcm" }));
  assert.ok(!codes(result).includes("UNNECESSARY_NEGATION"));
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

// ── earlyStopAtAccepted (qualité > quantité, 03/09/2026 — bloc élémentaire
// progressif uniquement, cf. server.js generateElementaryBlock/
// qualityControlRawQuestions) : optionnel, jamais un assouplissement des
// critères de validation eux-mêmes — seulement une décision d'arrêter la
// boucle de régénération plus tôt une fois le seuil de questions RÉELLEMENT
// validées atteint. Absent (undefined) dans tous les autres tests de ce
// fichier, qui continuent de régénérer jusqu'à épuisement des rejets ou du
// budget de cycles — comportement legacy strictement inchangé.

// 5 questions structurellement DISTINCTES (texte et options) — jamais un
// gabarit répété, qui déclencherait à tort DUPLICATE_QUESTION (contrôle
// déterministe inter-questions du lot, cf. validateQuestionBatchQuality).
function fiveDistinctQuestions() {
  return [
    q("Quelle est la capitale du Canada ?", { sourceId: "s1", options: ["Ottawa", "Toronto", "Montréal", "Vancouver"], correctIndex: 0, knowledgeTarget: "Ottawa est la capitale du Canada." }),
    q("Quelle langue est officielle au Québec ?", { sourceId: "s2", options: ["Français", "Anglais", "Espagnol", "Portugais"], correctIndex: 0, knowledgeTarget: "Le français est la langue officielle du Québec." }),
    q("Quel océan borde la côte est du Canada ?", { sourceId: "s3", options: ["Atlantique", "Pacifique", "Arctique", "Indien"], correctIndex: 0, knowledgeTarget: "L'océan Atlantique borde la côte est du Canada." }),
    q("Quelle monnaie utilise le Canada ?", { sourceId: "s4", options: ["Dollar canadien", "Euro", "Livre sterling", "Dollar américain"], correctIndex: 0, knowledgeTarget: "Le Canada utilise le dollar canadien." }),
    q("Quelle province canadienne est la plus peuplée ?", { sourceId: "s5", options: ["Ontario", "Québec", "Alberta", "Colombie-Britannique"], correctIndex: 0, knowledgeTarget: "L'Ontario est la province la plus peuplée du Canada." })
  ];
}

test("earlyStopAtAccepted : arrête la boucle dès que le seuil de questions VALIDÉES est atteint, sans jamais régénérer pour la dernière question rejetée", async () => {
  const five = fiveDistinctQuestions();
  let regenerationCalls = 0;
  const result = await runQuestionQualityPipeline(five, {
    earlyStopAtAccepted: 4,
    reviewSemantic: async ({ entries }) => ({
      reviews: entries.map((entry, index) => ({
        id: entry.id,
        // La 5e question (dernier index) est refusée — un rejet réel, jamais simulé comme accepté.
        verdict: index === 4 ? "reject" : "accept",
        reasonCodes: index === 4 ? ["AMBIGUOUS_WORDING"] : [],
        expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: true
      }))
    }),
    regenerate: async () => { regenerationCalls += 1; return []; }
  });
  assert.equal(result.accepted.length, 4, "exactement les 4 questions réellement validées, jamais 5 (aucune question rejetée comblée artificiellement)");
  assert.equal(regenerationCalls, 0, "aucune régénération déclenchée pour la 5e question une fois le seuil de 4 atteint");
  assert.equal(result.metrics.finalAccepted, 4);
  assert.equal(result.metrics.regenerationCycles, 0);
  // La question rejetée reste bien tracée comme rejetée, jamais silencieusement absorbée.
  assert.equal(result.rejected.length, 1);
  assert.ok(Object.keys(result.metrics.unresolvedReasonCounts).includes("AMBIGUOUS_WORDING"));
});

test("earlyStopAtAccepted : sans lui (undefined), le comportement legacy (régénérer jusqu'au budget) reste strictement inchangé", async () => {
  const five = fiveDistinctQuestions();
  let regenerationCalls = 0;
  await runQuestionQualityPipeline(five, {
    maxRetries: 1,
    reviewSemantic: async ({ entries }) => ({
      reviews: entries.map((entry, index) => ({
        id: entry.id,
        verdict: index === 4 ? "reject" : "accept",
        reasonCodes: index === 4 ? ["AMBIGUOUS_WORDING"] : [],
        expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: true
      }))
    }),
    regenerate: async () => { regenerationCalls += 1; return []; }
  });
  assert.equal(regenerationCalls, 1, "sans earlyStopAtAccepted, une régénération est toujours tentée pour la question rejetée — comportement inchangé");
});

test("earlyStopAtAccepted : n'arrête jamais la boucle avant d'avoir validé le cycle courant (le seuil est vérifié APRÈS acceptation, jamais en cours de cycle)", async () => {
  const three = fiveDistinctQuestions().slice(0, 3);
  let regenerationCalls = 0;
  const result = await runQuestionQualityPipeline(three, {
    earlyStopAtAccepted: 4,
    reviewSemantic: async ({ entries }) => ({
      reviews: entries.map((entry) => ({
        id: entry.id, verdict: "accept", reasonCodes: [],
        expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: true
      }))
    }),
    regenerate: async () => { regenerationCalls += 1; return []; }
  });
  // Seuil jamais atteint (3 < 4) : la boucle se termine normalement (plus rien à régénérer), pas par earlyStop.
  assert.equal(result.accepted.length, 3);
  assert.equal(regenerationCalls, 0);
});

// ── Sur-génération initiale du bloc élémentaire (03/09/2026, audit latence
// réel "Empire carolingien") : earlyStopCountFn/filterRejectedForRegeneration/
// onInitialBatchAccepted — mêmes garanties qu'earlyStopAtAccepted ci-dessus
// (jamais un assouplissement de validation), appliquées à un pool de
// candidats où PLUSIEURS peuvent partager le même knowledgeTarget. Absents
// (undefined) dans tous les autres tests de ce fichier : comportement
// legacy strictement inchangé, cf. tests dédiés plus bas.

// 8 candidats structurellement DISTINCTS répartis sur 5 knowledgeTarget
// (2,2,2,1,1 — même répartition que computeElementaryCandidateDistribution(5,8),
// cf. test/question-formats.test.js) : t1/t2/t3 ont chacun 2 candidats, t4/t5
// un seul. Jamais un gabarit répété (déclencherait DUPLICATE_QUESTION).
function eightCandidatesForFiveTargets() {
  const t1 = "Ottawa est la capitale du Canada.";
  const t2 = "Le français est la langue officielle du Québec.";
  const t3 = "L'océan Atlantique borde la côte est du Canada.";
  const t4 = "Le Canada utilise le dollar canadien.";
  const t5 = "L'Ontario est la province la plus peuplée du Canada.";
  return [
    q("Quelle est la capitale du Canada ?", { sourceId: "t1a", knowledgeTarget: t1, options: ["Ottawa", "Toronto", "Montréal", "Vancouver"], correctIndex: 0 }),
    q("Quelle ville canadienne est le siège du gouvernement fédéral ?", { sourceId: "t1b", knowledgeTarget: t1, options: ["Ottawa", "Calgary", "Winnipeg", "Halifax"], correctIndex: 0 }),
    q("Quelle langue est officielle au Québec ?", { sourceId: "t2a", knowledgeTarget: t2, options: ["Français", "Anglais", "Espagnol", "Portugais"], correctIndex: 0 }),
    q("Dans quelle langue les lois québécoises sont-elles rédigées en premier lieu ?", { sourceId: "t2b", knowledgeTarget: t2, options: ["Français", "Anglais", "Latin", "Inuktitut"], correctIndex: 0 }),
    q("Quel océan borde la côte est du Canada ?", { sourceId: "t3a", knowledgeTarget: t3, options: ["Atlantique", "Pacifique", "Arctique", "Indien"], correctIndex: 0 }),
    q("Sur quel océan la ville de Halifax est-elle ouverte ?", { sourceId: "t3b", knowledgeTarget: t3, options: ["Atlantique", "Pacifique", "Arctique", "Indien"], correctIndex: 0 }),
    q("Quelle monnaie utilise le Canada ?", { sourceId: "t4a", knowledgeTarget: t4, options: ["Dollar canadien", "Euro", "Livre sterling", "Dollar américain"], correctIndex: 0 }),
    q("Quelle province canadienne est la plus peuplée ?", { sourceId: "t5a", knowledgeTarget: t5, options: ["Ontario", "Québec", "Alberta", "Colombie-Britannique"], correctIndex: 0 })
  ];
}

function distinctCountFn(accepted) { return selectOneQuestionPerKnowledgeTarget(accepted).length; }
function coveredTargetsFilter(rejected, accepted) {
  const covered = new Set(selectOneQuestionPerKnowledgeTarget(accepted).map((qq) => qq.knowledgeTarget));
  return rejected.filter((entry) => !covered.has(entry.question?.knowledgeTarget));
}

test("1/2. 8 candidats, un par knowledgeTarget au minimum, répartis 2/2/2/1/1 sur 5 targets distincts", () => {
  const eight = eightCandidatesForFiveTargets();
  assert.equal(eight.length, 8);
  const distinctTargets = new Set(eight.map((question) => question.knowledgeTarget));
  assert.equal(distinctTargets.size, 5, "les 8 candidats couvrent 5 knowledgeTarget distincts, jamais moins");
});

test("3/9. 8 candidats dont 5 valides mais seulement 3 knowledgeTarget distincts -> earlyStopCountFn (4) jamais atteint, la régénération existante continue pour les targets manquants", async () => {
  const eight = eightCandidatesForFiveTargets();
  const acceptedIds = new Set(["t1a", "t1b", "t2a", "t2b", "t4a"]); // 5 accepted, mais seulement t1/t2/t4 (3 targets)
  let regenerateCallArgs = null;
  const result = await runQuestionQualityPipeline(eight, {
    earlyStopAtAccepted: 4,
    earlyStopCountFn: distinctCountFn,
    filterRejectedForRegeneration: coveredTargetsFilter,
    reviewSemantic: async ({ entries }) => ({
      reviews: entries.map((entry) => ({
        id: entry.id,
        verdict: acceptedIds.has(entry.sourceId) ? "accept" : "reject",
        reasonCodes: acceptedIds.has(entry.sourceId) ? [] : ["AMBIGUOUS_WORDING"],
        expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: true
      }))
    }),
    regenerate: async ({ rejected }) => { regenerateCallArgs = rejected; return []; }
  });
  assert.equal(result.accepted.length, 5, "les 5 candidats réellement validés, jamais comblés artificiellement");
  assert.equal(selectOneQuestionPerKnowledgeTarget(result.accepted).length, 3, "3 knowledgeTarget distincts seulement — NOT READY (seuil 4 jamais atteint)");
  assert.ok(regenerateCallArgs, "la régénération existante doit continuer : le seuil de 4 targets distincts n'est jamais atteint");
  assert.equal(regenerateCallArgs.length, 3, "régénère pour t3 (x2) et t5 (x1) — les seuls targets encore non couverts, jamais les 3 rejets bruts s'il y en avait plus");
});

test("4/7. 8 candidats dont 4 valides sur 4 knowledgeTarget distincts -> READY dès le premier lot, zéro targeted_regeneration", async () => {
  const eight = eightCandidatesForFiveTargets();
  const acceptedIds = new Set(["t1a", "t2a", "t3a", "t4a"]); // 4 accepted, 4 targets distincts
  let regenerationCalls = 0;
  const result = await runQuestionQualityPipeline(eight, {
    earlyStopAtAccepted: 4,
    earlyStopCountFn: distinctCountFn,
    filterRejectedForRegeneration: coveredTargetsFilter,
    reviewSemantic: async ({ entries }) => ({
      reviews: entries.map((entry) => ({
        id: entry.id,
        verdict: acceptedIds.has(entry.sourceId) ? "accept" : "reject",
        reasonCodes: acceptedIds.has(entry.sourceId) ? [] : ["AMBIGUOUS_WORDING"],
        expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: true
      }))
    }),
    regenerate: async () => { regenerationCalls += 1; return []; }
  });
  assert.equal(selectOneQuestionPerKnowledgeTarget(result.accepted).length, 4, "4 knowledgeTarget distincts -> READY");
  assert.equal(regenerationCalls, 0, "aucun targeted_regeneration : le seuil est atteint dès le premier lot");
  assert.equal(result.metrics.regenerationCycles, 0);
});

test("5. deux questions valides du MÊME target ne comptent qu'une fois pour earlyStopCountFn — n'accélère jamais artificiellement l'arrêt", async () => {
  const eight = eightCandidatesForFiveTargets();
  // t1a+t1b (même target t1) + t2a : 3 candidats acceptés mais seulement 2 targets distincts.
  const acceptedIds = new Set(["t1a", "t1b", "t2a"]);
  let regenerationCalls = 0;
  await runQuestionQualityPipeline(eight, {
    earlyStopAtAccepted: 3,
    earlyStopCountFn: distinctCountFn,
    filterRejectedForRegeneration: coveredTargetsFilter,
    reviewSemantic: async ({ entries }) => ({
      reviews: entries.map((entry) => ({
        id: entry.id,
        verdict: acceptedIds.has(entry.sourceId) ? "accept" : "reject",
        reasonCodes: acceptedIds.has(entry.sourceId) ? [] : ["AMBIGUOUS_WORDING"],
        expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: true
      }))
    }),
    regenerate: async () => { regenerationCalls += 1; return []; }
  });
  assert.ok(regenerationCalls > 0, "3 questions acceptées mais 2 targets distincts seulement (<3) : earlyStopAtAccepted ne doit jamais se déclencher sur le compte brut");
});

test("filterRejectedForRegeneration : exclut de la régénération un knowledgeTarget déjà couvert par une question acceptée (même quand un AUTRE candidat sur ce même target a été rejeté)", async () => {
  const eight = eightCandidatesForFiveTargets();
  // t1a accepté (target t1 couvert) ; t1b rejeté MAIS même target -> ne doit
  // jamais être envoyé à regenerate(). t3a/t3b/t5a rejetés sur des targets
  // encore non couverts -> doivent, eux, être envoyés.
  const acceptedIds = new Set(["t1a", "t2a", "t4a"]);
  let regenerateCallArgs = null;
  await runQuestionQualityPipeline(eight, {
    earlyStopAtAccepted: 5, // jamais atteint ici (3 targets distincts) : on force le passage par regenerate()
    earlyStopCountFn: distinctCountFn,
    filterRejectedForRegeneration: coveredTargetsFilter,
    reviewSemantic: async ({ entries }) => ({
      reviews: entries.map((entry) => ({
        id: entry.id,
        verdict: acceptedIds.has(entry.sourceId) ? "accept" : "reject",
        reasonCodes: acceptedIds.has(entry.sourceId) ? [] : ["AMBIGUOUS_WORDING"],
        expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: true
      }))
    }),
    regenerate: async ({ rejected }) => { regenerateCallArgs = rejected; return []; }
  });
  assert.ok(regenerateCallArgs, "regenerate() doit être appelé (seuil jamais atteint)");
  const regeneratedSourceIds = regenerateCallArgs.map((entry) => entry.question.sourceId);
  assert.ok(!regeneratedSourceIds.includes("t1b"), "t1b ne doit jamais être régénéré : son target (t1) est déjà couvert par t1a");
  assert.deepEqual(new Set(regeneratedSourceIds), new Set(["t3a", "t3b", "t5a"]), "seuls les targets encore non couverts (t3, t5) sont régénérés");
});

test("filterRejectedForRegeneration : ne filtre QUE ce qui est envoyé à regenerate() — rejectionHistory/unresolvedReasonCounts restent complets, jamais amputés", async () => {
  const eight = eightCandidatesForFiveTargets();
  const acceptedIds = new Set(["t1a", "t1b", "t2a", "t2b", "t4a"]); // même scénario que le test 3/9
  const result = await runQuestionQualityPipeline(eight, {
    maxRetries: 0, // pas de second cycle nécessaire pour ce test : on inspecte le premier cycle seul
    earlyStopCountFn: distinctCountFn,
    filterRejectedForRegeneration: coveredTargetsFilter,
    reviewSemantic: async ({ entries }) => ({
      reviews: entries.map((entry) => ({
        id: entry.id,
        verdict: acceptedIds.has(entry.sourceId) ? "accept" : "reject",
        reasonCodes: acceptedIds.has(entry.sourceId) ? [] : ["AMBIGUOUS_WORDING"],
        expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: true
      }))
    }),
    regenerate: async () => []
  });
  // Les 3 rejets bruts (t3a, t3b, t5a) restent tous tracés, même si
  // filterRejectedForRegeneration en aurait exclu certains dans un scénario
  // où d'autres targets étaient déjà couverts — ici aucun ne l'est, donc les
  // 3 apparaissent malgré tout dans l'historique complet.
  assert.equal(result.rejected.length, 3);
  assert.equal(Object.values(result.metrics.unresolvedReasonCounts).reduce((a, b) => a + b, 0), 3);
});

test("onInitialBatchAccepted : appelé une seule fois, avec l'accepted du tout premier lot (avant toute régénération), jamais recalculé après", async () => {
  const eight = eightCandidatesForFiveTargets();
  const acceptedIds = new Set(["t1a", "t1b", "t2a", "t2b", "t4a"]);
  const snapshots = [];
  await runQuestionQualityPipeline(eight, {
    maxRetries: 1,
    earlyStopCountFn: distinctCountFn,
    filterRejectedForRegeneration: coveredTargetsFilter,
    onInitialBatchAccepted: (acceptedList) => snapshots.push(acceptedList),
    reviewSemantic: async ({ entries }) => ({
      reviews: entries.map((entry) => ({
        id: entry.id,
        verdict: acceptedIds.has(entry.sourceId) ? "accept" : "reject",
        reasonCodes: acceptedIds.has(entry.sourceId) ? [] : ["AMBIGUOUS_WORDING"],
        expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: true
      }))
    }),
    // Le second cycle (régénération) accepte tout, pour prouver que le
    // snapshot du premier lot n'est jamais recalculé/écrasé après coup.
    regenerate: async ({ rejected }) => rejected.map((entry, index) => q(`Question régénérée ${index}`, { sourceId: `regen${index}`, knowledgeTarget: entry.question.knowledgeTarget }))
  });
  assert.equal(snapshots.length, 1, "un seul appel, jamais un par cycle");
  assert.equal(snapshots[0].length, 5, "exactement l'accepted du premier lot (5 questions), avant toute régénération");
  assert.equal(selectOneQuestionPerKnowledgeTarget(snapshots[0]).length, 3, "3 targets distincts dans ce premier lot");
});

test("earlyStopCountFn/filterRejectedForRegeneration/onInitialBatchAccepted absents (undefined) : comportement legacy strictement inchangé", async () => {
  const five = fiveDistinctQuestions();
  let regenerationCalls = 0;
  const result = await runQuestionQualityPipeline(five, {
    earlyStopAtAccepted: 4,
    reviewSemantic: async ({ entries }) => ({
      reviews: entries.map((entry, index) => ({
        id: entry.id,
        verdict: index === 4 ? "reject" : "accept",
        reasonCodes: index === 4 ? ["AMBIGUOUS_WORDING"] : [],
        expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: true
      }))
    }),
    regenerate: async () => { regenerationCalls += 1; return []; }
  });
  assert.equal(result.accepted.length, 4);
  assert.equal(regenerationCalls, 0, "identique au comportement déjà vérifié plus haut sans ces trois options");
});

// ── onCycle : deterministicReasonCounts/semanticReasonCounts (observabilité,
// 03/09/2026, audit réel "Les oiseaux migrateurs") : codes de rejet agrégés
// PAR CYCLE, séparés par origine — jamais de texte de question. ───────────

test("onCycle reçoit deterministicReasonCounts et semanticReasonCounts séparés pour le même cycle, sans jamais mélanger les deux origines", async () => {
  const deterministicInvalid = q(undefined, { sourceId: "det", options: ["Ottawa", "", "Ottawa", "Toronto"], correctIndex: 9 });
  const semanticInvalid = q("Quelle est la langue officielle du Québec ?", { sourceId: "sem", options: ["Français", "Anglais", "Espagnol", "Portugais"], correctIndex: 0 });
  const cyclePayloads = [];
  await runQuestionQualityPipeline([deterministicInvalid, semanticInvalid], {
    maxRetries: 0,
    onCycle: (payload) => cyclePayloads.push(payload),
    reviewSemantic: async ({ entries }) => ({
      reviews: entries.map((entry) => ({
        id: entry.id, verdict: "reject", reasonCodes: ["GUESSABLE_WITHOUT_KNOWLEDGE"],
        expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: true
      }))
    })
  });
  assert.equal(cyclePayloads.length, 1);
  const [cycle0] = cyclePayloads;
  // Le rejet déterministe (options vides/dupliquées, correctIndex invalide) n'apparaît jamais côté sémantique.
  assert.ok(cycle0.deterministicReasonCounts.EMPTY_OPTION >= 1);
  assert.ok(cycle0.deterministicReasonCounts.INVALID_CORRECT_INDEX >= 1);
  assert.equal(cycle0.deterministicReasonCounts.GUESSABLE_WITHOUT_KNOWLEDGE, undefined, "un code sémantique ne doit jamais apparaître côté deterministicReasonCounts");
  // Le rejet sémantique (critique mockée) n'apparaît jamais côté déterministe.
  assert.equal(cycle0.semanticReasonCounts.GUESSABLE_WITHOUT_KNOWLEDGE, 1);
  assert.equal(cycle0.semanticReasonCounts.EMPTY_OPTION, undefined, "un code déterministe ne doit jamais apparaître côté semanticReasonCounts");
});

test("le log [qcm-quality] agrégé porte désormais generationId — jamais de texte de question", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = serverSource.indexOf('console.info("[qcm-quality]"');
  const snippet = serverSource.slice(start, start + 700);
  assert.match(snippet, /generationId,\s*\n\s*route,/);
  assert.doesNotMatch(snippet, /knowledgeTarget|rejectedQuestion|sourceExcerpt|question:/);
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

// ── V1 latence (02/09/2026, cf. audit read-only "MNORIA — Optimisation
// vitesse QCM V1 conservatrice") : instrumentation par cycle (options.onCycle)
// — purement additive, jamais une décision. Ces tests couvrent précisément
// les points A/B/H/I de la demande : forme exacte du payload par cycle,
// cumulativeAccepted correct après chaque review, plafond de cycles
// INCHANGÉ (toujours 3 reviews / 2 régénérations maximum), et surtout
// qu'AUCUN early stop n'a été introduit — le pipeline continue à régénérer
// tant qu'il reste des rejets, même une fois MIN_MASTER_QUESTIONS-like
// atteint côté appelant (cette fonction ne connaît d'ailleurs même pas ce
// seuil, qui vit exclusivement dans generateNotionLevelQuiz).

test("V1 — onCycle reçoit exactement 3 appels (cycles 0,1,2), cumulativeAccepted progresse sans early stop malgré des rejets qui persistent jusqu'au plafond", async () => {
  // q1/q2 acceptées dès le cycle 0 et plus jamais rejugées. q3 est rejetée à
  // CHAQUE cycle (y compris ses deux remplacements) : la boucle doit quand
  // même aller jusqu'au bout de son budget (maxRetries=2 par défaut) plutôt
  // que de s'arrêter dès que 2 questions sont déjà bonnes.
  const q1 = q("Quelle ville est la capitale fédérale du Canada ?", { sourceId: "c1" });
  const q2 = q("Où se situe la capitale du Canada ?", { sourceId: "c2" });
  const q3 = q("Quelle est la population d'Ottawa ?", { sourceId: "c3" });
  let reviewCallIndex = 0;
  let regenerateCalls = 0;
  const cycles = [];
  const result = await runQuestionQualityPipeline([q1, q2, q3], {
    onCycle: (payload) => cycles.push(payload),
    reviewSemantic: async ({ entries }) => {
      reviewCallIndex += 1;
      return {
        reviews: entries.map((entry) => {
          // Le sourceId "c3" (et ses remplacements successifs, régénérés à
          // partir de lui) reste toujours refusé ; c1/c2 ne réapparaissent
          // jamais dans un cycle suivant (déjà acceptées définitivement).
          const isThirdSlot = entry.sourceId === "c3";
          return {
            id: entry.id,
            verdict: isThirdSlot ? "reject" : "accept",
            reasonCodes: isThirdSlot ? ["AMBIGUOUS_DISTRACTOR"] : [],
            expectedCorrectIndexes: [0],
            targetsKnowledge: true,
            groundedInSource: true
          };
        })
      };
    },
    regenerate: async ({ rejected, attempt }) => {
      regenerateCalls += 1;
      return rejected.map(() => q(`Remplacement c3 tentative ${attempt}`, { sourceId: "c3" }));
    }
  });

  assert.equal(reviewCallIndex, 3, "3 critiques : cycle initial + 2 régénérations, jamais moins, jamais plus");
  assert.equal(regenerateCalls, 2, "2 régénérations maximum (QCM_SEMANTIC_REVIEW_MAX_RETRIES par défaut) — plafond inchangé");
  assert.equal(result.metrics.regenerationCycles, 2);
  assert.equal(cycles.length, 3, "un appel onCycle par cycle réellement exécuté, jamais par tentative technique interne");

  // cycle 0 : q1+q2 acceptées, q3 rejetée — 2 questions déjà bonnes, mais la
  // boucle continue quand même (aucun early stop sur un quelconque seuil).
  assert.equal(cycles[0].cycleIndex, 0);
  assert.equal(cycles[0].questionsIn, 3);
  assert.equal(cycles[0].deterministicAccepted, 3, "les 3 candidats passent le contrôle déterministe/grounding avant le critique sémantique");
  assert.equal(cycles[0].semanticAccepted, 2);
  assert.equal(cycles[0].rejected, 1);
  assert.equal(cycles[0].cumulativeAccepted, 2);
  assert.equal(cycles[0].regenerationMs, null, "aucune régénération n'a encore eu lieu avant le tout premier cycle");
  assert.equal(typeof cycles[0].reviewMs, "number");
  assert.ok(cycles[0].reviewMs >= 0);

  // cycle 1 : le remplacement de q3 est de nouveau rejeté — cumulativeAccepted
  // reste à 2 (pas de régression), la boucle continue malgré tout.
  assert.equal(cycles[1].cycleIndex, 1);
  assert.equal(cycles[1].questionsIn, 1);
  assert.equal(cycles[1].deterministicAccepted, 1);
  assert.equal(cycles[1].semanticAccepted, 0);
  assert.equal(cycles[1].rejected, 1);
  assert.equal(cycles[1].cumulativeAccepted, 2, "aucune progression ce cycle, mais la boucle ne s'arrête PAS pour autant");
  assert.equal(typeof cycles[1].regenerationMs, "number", "la régénération qui a produit les candidats de ce cycle est bien mesurée");
  assert.ok(cycles[1].regenerationMs >= 0);
  assert.equal(typeof cycles[1].reviewMs, "number");

  // cycle 2 : dernier essai, encore rejeté — la boucle s'arrête ici UNIQUEMENT
  // parce que cycles(2) >= maxRetries(2), jamais parce qu'un seuil de qualité
  // aurait été atteint (il ne l'a d'ailleurs jamais été pour ce 3e slot).
  assert.equal(cycles[2].cycleIndex, 2);
  assert.equal(cycles[2].cumulativeAccepted, 2);
  assert.equal(cycles[2].rejected, 1);
  assert.equal(typeof cycles[2].regenerationMs, "number");
  assert.equal(result.accepted.length, 2, "q1/q2 seulement : le 3e slot n'a jamais été récupéré, comme le montre déjà unresolvedReasonCounts");
  assert.ok(Object.keys(result.metrics.unresolvedReasonCounts).length >= 1);
});

test("V1 — MIN_MASTER_QUESTIONS-like : même largement dépassé après le premier cycle, la boucle continue tant qu'il reste des rejets (aucun early stop)", async () => {
  // 5 questions initiales, une seule rejetée au cycle 0 (donc 4/5 déjà
  // acceptées — au-delà d'un seuil d'acceptabilité hypothétique comme 15/20
  // à l'échelle réelle). La boucle doit malgré tout dérouler son cycle 1
  // complet pour la question restante, jamais s'arrêter parce que "4 sur 5,
  // c'est déjà suffisant".
  // Options/textes réellement distincts (jamais un simple suffixe numérique)
  // pour ne pas déclencher DUPLICATE_QUESTION côté validateur déterministe —
  // lexicalSimilarity ignore les jetons de 2 caractères ou moins, un simple
  // "Question 1"/"Question 2" partagerait donc un jeton "question" identique
  // à 100 % et serait perçu comme un doublon, ce qui n'est pas ce que ce
  // test veut exercer.
  const items = [
    q("Quelle est la capitale du Canada ?", { sourceId: "s1", options: ["Ottawa", "Toronto", "Montréal", "Vancouver"] }),
    q("Quelle est la capitale de la France ?", { sourceId: "s2", options: ["Paris", "Lyon", "Marseille", "Nice"], knowledgeTarget: "Paris est la capitale de la France." }),
    q("Quelle est la capitale de l'Allemagne ?", { sourceId: "s3", options: ["Berlin", "Munich", "Hambourg", "Cologne"], knowledgeTarget: "Berlin est la capitale de l'Allemagne." }),
    q("Quelle est la capitale de l'Italie ?", { sourceId: "s4", options: ["Rome", "Milan", "Naples", "Turin"], knowledgeTarget: "Rome est la capitale de l'Italie." }),
    q("Quelle est la capitale de l'Espagne ?", { sourceId: "s5", options: ["Madrid", "Barcelone", "Séville", "Valence"], knowledgeTarget: "Madrid est la capitale de l'Espagne." })
  ];
  const cycles = [];
  let regenerateCalls = 0;
  let reviewCallCount = 0;
  const result = await runQuestionQualityPipeline(items, {
    onCycle: (payload) => cycles.push(payload),
    // "s5" n'est rejetée qu'à la toute première critique (cycle 0) — son
    // remplacement, produit par regenerate ci-dessous, est accepté dès le
    // cycle 1 : exactement le scénario "une seule régénération suffit".
    reviewSemantic: async ({ entries }) => {
      reviewCallCount += 1;
      const isFirstReview = reviewCallCount === 1;
      return {
        reviews: entries.map((entry) => ({
          id: entry.id,
          verdict: isFirstReview && entry.sourceId === "s5" ? "reject" : "accept",
          reasonCodes: isFirstReview && entry.sourceId === "s5" ? ["WEAK_DISTRACTOR_SET"] : [],
          expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: true
        }))
      };
    },
    regenerate: async ({ rejected }) => {
      regenerateCalls += 1;
      return rejected.map(() => q("Dans quelle ville siège le gouvernement espagnol ?", {
        sourceId: "s5",
        options: ["Madrid", "Barcelone", "Séville", "Valence"],
        knowledgeTarget: "Madrid est la capitale de l'Espagne."
      }));
    }
  });
  assert.equal(cycles[0].cumulativeAccepted, 4);
  assert.equal(regenerateCalls, 1, "la régénération de la 5e question a bien eu lieu malgré les 4 déjà acceptées");
  assert.equal(cycles.length, 2, "cycle 0 (4 accept + 1 reject) puis cycle 1 (le remplacement, accepté cette fois, referme la boucle normalement)");
  assert.equal(result.accepted.length, 5);
});

test("V1 — onCycle absent (comportement historique) : aucun changement, même trajectoire que les tests existants", async () => {
  // Verrou de non-régression explicite : un appelant qui ne fournit pas
  // onCycle (tous les appelants existants avant ce correctif) doit obtenir
  // une sortie strictement identique à avant son introduction.
  const result = await runQuestionQualityPipeline([q()], {
    maxRetries: 0,
    reviewSemantic: async ({ entries }) => ({
      reviews: [{ id: entries[0].id, verdict: "accept", reasonCodes: [], expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: true }]
    })
  });
  assert.equal(result.accepted.length, 1);
});

test("V1 — une erreur levée par onCycle ne fait jamais échouer ni dévier la génération (best-effort, silencieux)", async () => {
  const result = await runQuestionQualityPipeline([q()], {
    maxRetries: 0,
    onCycle: () => { throw new Error("panne de télémétrie simulée"); },
    reviewSemantic: async ({ entries }) => ({
      reviews: [{ id: entries[0].id, verdict: "accept", reasonCodes: [], expectedCorrectIndexes: [0], targetsKnowledge: true, groundedInSource: true }]
    })
  });
  assert.equal(result.accepted.length, 1, "la panne de onCycle ne doit ni bloquer ni corrompre l'issue réelle de la génération");
});

// ══════════════════════════════════════════════════════════════════════════
// V1 corrective — audit QCM "Stalinisme" (02/09/2026, daily_quiz.id=358)
// ══════════════════════════════════════════════════════════════════════════
// Deux nouveaux contrôles déterministes (REORDERED_DUPLICATE_OPTION,
// CROSS_QUESTION_ANSWER_REUSE, cf. lib/qcm-quality.js) + un renforcement
// textuel du prompt du critique sémantique (buildSemanticReviewPrompt,
// CATEGORY_MISMATCH/GUESSABLE_WITHOUT_KNOWLEDGE/AMBIGUOUS_DISTRACTOR) et du
// prompt du générateur (buildQuestionsFromKnowledgePrompt,
// lib/knowledge-admission.js). Zéro appel IA ajouté, zéro modification du
// modèle Luna, du nombre de cycles, du grounding, de V3.2 ou du ranking
// pédagogique.

// ── REORDERED_DUPLICATE_OPTION ──────────────────────────────────────────

test("REORDERED_DUPLICATE_OPTION : rejette deux options qui réordonnent exactement les mêmes faits (cas réel QCM Stalinisme)", () => {
  const result = validateQuestionQuality(q(
    "Quelle succession d’événements correspond à l’ascension de Joseph Staline ?",
    {
      options: [
        "Lénine meurt en 1924, Staline devient secrétaire général en 1922, puis il consolide son pouvoir à la fin des années 1920",
        "Staline consolide son pouvoir à la fin des années 1920, devient secrétaire général en 1922, puis Lénine meurt en 1924",
        "Staline devient secrétaire général en 1924, Lénine meurt en 1922, puis il consolide son pouvoir à la fin des années 1920",
        "Il devient secrétaire général en 1922, Lénine meurt en 1924, puis Staline consolide son pouvoir à la fin des années 1920"
      ],
      correctIndex: 3
    }
  ));
  assert.ok(codes(result).includes("REORDERED_DUPLICATE_OPTION"));
});

test("REORDERED_DUPLICATE_OPTION : n'est PAS déclenché par deux options développées mais réellement distinctes (dates/ordinaux différents)", () => {
  const result = validateQuestionQuality(q(
    "Quel plan quinquennal soviétique donne la priorité à l’industrie lourde dès son lancement en 1928 ?",
    {
      options: [
        "Le premier plan quinquennal, lancé en 1928, donne la priorité à l’industrie lourde",
        "Le second plan quinquennal, lancé en 1933, poursuit la priorité donnée à l’industrie lourde",
        "Le troisième plan quinquennal, interrompu en 1941, maintient cette même priorité",
        "La Nouvelle Politique économique, abandonnée en 1928, privilégiait au contraire l’agriculture"
      ],
      correctIndex: 0
    }
  ));
  assert.ok(!codes(result).includes("REORDERED_DUPLICATE_OPTION"));
});

test("REORDERED_DUPLICATE_OPTION : jamais déclenché sur des options courtes de type étiquette (sous le plancher de 4 tokens)", () => {
  const result = validateQuestionQuality(q("Quelle institution est la principale police politique soviétique ?", {
    options: ["Le NKVD", "Le Goulag", "La direction stalinienne", "Le Parti communiste soviétique"],
    correctIndex: 0
  }));
  assert.ok(!codes(result).includes("REORDERED_DUPLICATE_OPTION"));
});

test("REORDERED_DUPLICATE_OPTION : s'applique aussi au format qcm_multi", () => {
  const result = validateQuestionQuality(q(
    "Quelles successions d’événements sont chronologiquement correctes ?",
    {
      type: "qcm_multi",
      options: [
        "Il devient secrétaire général en 1922, Lénine meurt en 1924, puis Staline consolide son pouvoir à la fin des années 1920",
        "Lénine meurt en 1924, Staline devient secrétaire général en 1922, puis il consolide son pouvoir à la fin des années 1920",
        "L’Allemagne nazie envahit l’Union soviétique le 22 juin 1941",
        "Le premier plan quinquennal donne la priorité à l’industrie lourde à partir de 1928"
      ],
      correctIndexes: [0, 2]
    }
  ));
  assert.ok(codes(result).includes("REORDERED_DUPLICATE_OPTION"));
});

// ── CROSS_QUESTION_ANSWER_REUSE ─────────────────────────────────────────

test("CROSS_QUESTION_ANSWER_REUSE : rejette une mauvaise option qui reprend le knowledgeTarget d'une autre question du lot (cas réel QCM Stalinisme)", () => {
  const barbarossa = q("Que se produit-il le 22 juin 1941, après la rupture du pacte germano-soviétique de 1939 ?", {
    sourceId: "stalinisme-barbarossa",
    options: [
      "Nikita Khrouchtchev présente son rapport secret au XXe congrès du Parti",
      "L’Union soviétique établit ou soutient des régimes communistes en Europe orientale",
      "Joseph Staline meurt et une réorganisation du pouvoir s’ouvre",
      "L’Allemagne nazie envahit l’Union soviétique"
    ],
    correctIndex: 3,
    knowledgeTarget: "L’Allemagne nazie envahit l’Union soviétique le 22 juin 1941, après la rupture du pacte germano-soviétique de 1939."
  });
  const stalineDeath = q("Quelle date marque la mort de Joseph Staline ?", {
    sourceId: "stalinisme-mort",
    options: ["Le 5 mars 1953", "Le 22 juin 1941", "En 1924", "En février 1956"],
    correctIndex: 0,
    knowledgeTarget: "Joseph Staline meurt le 5 mars 1953, ce qui ouvre une période de réorganisation du pouvoir soviétique."
  });
  const batch = validateQuestionBatchQuality([barbarossa, stalineDeath]);
  const decision = batch.decisions.find((d) => d.question === stalineDeath);
  assert.ok(decision.reasons.some((r) => r.code === "CROSS_QUESTION_ANSWER_REUSE"));
  // Fait annexe confirmé par ce même fixture (repris tel quel du QCM réel
  // audité) : le troisième distracteur de `barbarossa` ("Joseph Staline
  // meurt et une réorganisation du pouvoir s'ouvre") reprend lui aussi,
  // presque mot pour mot, le knowledgeTarget de `stalineDeath` — un TROISIÈME
  // recyclage inter-questions dans ce même lot, distinct de celui repéré
  // lors de l'audit initial. Les deux questions sont donc légitimement
  // flaguées ici, chacune à cause de SA PROPRE mauvaise option.
  const otherDecision = batch.decisions.find((d) => d.question === barbarossa);
  assert.ok(otherDecision.reasons.some((r) => r.code === "CROSS_QUESTION_ANSWER_REUSE"));
});

test("CROSS_QUESTION_ANSWER_REUSE : n'invalide jamais rétroactivement la question SOURCE d'une reprise, seule la question qui reprend est marquée invalide", () => {
  // Fixture volontairement à sens unique (contrairement au test précédent,
  // qui reprend fidèlement les données réelles où la reprise est
  // bidirectionnelle) : ici, seule `copycat` reprend `original`, jamais
  // l'inverse — permet de vérifier isolément l'asymétrie du contrôle.
  const original = q("Quel événement se produit le 22 juin 1941 ?", {
    sourceId: "asymmetrie-original",
    options: ["Un traité de paix est signé", "Une révolution éclate à Moscou", "Un putsch militaire échoue", "L’Allemagne nazie envahit l’Union soviétique"],
    correctIndex: 3,
    knowledgeTarget: "L’Allemagne nazie envahit l’Union soviétique le 22 juin 1941."
  });
  const copycat = q("Quelle date marque la mort de Joseph Staline ?", {
    sourceId: "asymmetrie-copycat",
    options: ["Le 5 mars 1953", "Le 22 juin 1941", "Le 14 juillet 1789", "Le 11 novembre 1918"],
    correctIndex: 0,
    knowledgeTarget: "Joseph Staline meurt le 5 mars 1953."
  });
  const batch = validateQuestionBatchQuality([original, copycat]);
  const originalDecision = batch.decisions.find((d) => d.question === original);
  const copycatDecision = batch.decisions.find((d) => d.question === copycat);
  assert.ok(copycatDecision.reasons.some((r) => r.code === "CROSS_QUESTION_ANSWER_REUSE"));
  assert.ok(!originalDecision.reasons.some((r) => r.code === "CROSS_QUESTION_ANSWER_REUSE"));
  assert.equal(batch.accepted.length, 1);
  assert.equal(batch.accepted[0], original);
});

test("CROSS_QUESTION_ANSWER_REUSE : couvre aussi une mauvaise option réduite à une seule année isolée (exception documentée à 1 token)", () => {
  const lenineDeath = q("En quelle année meurt Vladimir Lénine ?", {
    sourceId: "stalinisme-lenine",
    options: ["En 1922", "En 1924", "En 1928", "En 1936"],
    correctIndex: 1,
    knowledgeTarget: "Vladimir Lénine meurt en 1924."
  });
  const stalineDeath = q("Quelle date marque la mort de Joseph Staline ?", {
    sourceId: "stalinisme-mort",
    options: ["Le 5 mars 1953", "Le 22 juin 1941", "En 1924", "En février 1956"],
    correctIndex: 0,
    knowledgeTarget: "Joseph Staline meurt le 5 mars 1953."
  });
  const batch = validateQuestionBatchQuality([lenineDeath, stalineDeath]);
  const decision = batch.decisions.find((d) => d.question === stalineDeath);
  assert.ok(decision.reasons.some((r) => r.code === "CROSS_QUESTION_ANSWER_REUSE"));
});

test("CROSS_QUESTION_ANSWER_REUSE : n'est PAS déclenché par une simple proximité thématique sous le seuil de containment (0.8)", () => {
  const politicalTransformation = q("Quelle transformation politique caractérise le stalinisme ?", {
    sourceId: "stalinisme-transfo",
    options: [
      "La planification économique est instaurée et l’industrie lourde devient prioritaire",
      "Les exploitations agricoles sont regroupées dans des fermes collectives ou d’État",
      "La censure et la propagande encadrent la vie politique et sociale",
      "Le monopole politique du Parti communiste est maintenu et le pouvoir est davantage centralisé autour de la direction stalinienne"
    ],
    correctIndex: 3,
    knowledgeTarget: "Le stalinisme conserve le monopole politique du Parti communiste et renforce fortement la centralisation du pouvoir autour de la direction stalinienne."
  });
  const nkvd = q("Quelle institution est la principale police politique soviétique pendant la Grande Terreur ?", {
    sourceId: "stalinisme-nkvd",
    options: ["Le NKVD", "Le Goulag", "Un tribunal militaire spécial", "Le Parti communiste soviétique"],
    correctIndex: 0,
    knowledgeTarget: "Le NKVD est la principale police politique soviétique pendant la Grande Terreur de 1936-1938."
  });
  const batch = validateQuestionBatchQuality([politicalTransformation, nkvd]);
  const decision = batch.decisions.find((d) => d.question === nkvd);
  assert.ok(!decision.reasons.some((r) => r.code === "CROSS_QUESTION_ANSWER_REUSE"), "« Le Parti communiste soviétique » reste un intitulé générique, insuffisamment proche du knowledgeTarget de l'autre question (containment ≈ 0.67 < 0.8)");
});

test("CROSS_QUESTION_ANSWER_REUSE : une question isolée (lot d'une seule question) n'est jamais concernée", () => {
  const result = validateQuestionBatchQuality([q()]);
  assert.equal(result.accepted.length, 1);
  assert.ok(!result.decisions[0].reasons.some((r) => r.code === "CROSS_QUESTION_ANSWER_REUSE"));
});

// ── Prompt du critique sémantique : renforcements textuels présents ────────

test("buildSemanticReviewPrompt : contient le renforcement CATEGORY_MISMATCH par écho de domaine du stem", () => {
  const prompt = buildSemanticReviewPrompt([], {});
  assert.match(prompt, /CATEGORY_MISMATCH.*cas du distracteur vrai mais hors catégorie/s);
  assert.match(prompt, /si le stem demande une institution, les 4 options doivent être plausiblement des institutions/);
});

test("buildSemanticReviewPrompt : contient les 4 canaux explicites de GUESSABLE_WITHOUT_KNOWLEDGE", () => {
  const prompt = buildSemanticReviewPrompt([], {});
  assert.match(prompt, /TYPE GRAMMATICAL OU SÉMANTIQUE/);
  assert.match(prompt, /PORTÉE LOGIQUE du stem/);
});

test("buildSemanticReviewPrompt : contient la comparaison pairwise explicite d'AMBIGUOUS_DISTRACTOR", () => {
  const prompt = buildSemanticReviewPrompt([], {});
  assert.match(prompt, /comparaison pairwise obligatoire/);
  assert.match(prompt, /secrétaire général.*mort de Lénine.*consolidation du pouvoir/s);
});

// ── Wiring bout-en-bout (critique MOCKÉ — aucun appel IA réel, cf. le même
// principe documenté que les tests "critique mockée" et "motif pédagogique
// fictif" plus haut : la qualité réelle du jugement du modèle ne peut pas
// être testée ici, seulement que le pipeline achemine correctement un
// verdict de rejet motivé par ces codes renforcés, sans effet de bord sur
// les questions voisines) ─────────────────────────────────────────────────

test("wiring : un stem demandant une institution avec une seule institution parmi les options est refusé (GUESSABLE_WITHOUT_KNOWLEDGE, critique mockée)", async () => {
  const institutionQuestion = q("Quel terme désigne l’appareil soviétique administrant un vaste réseau de camps et de colonies de travail forcé ?", {
    sourceId: "stalinisme-goulag",
    options: ["Le NKVD", "La Grande Terreur", "Le réalisme socialiste", "Le Goulag"],
    correctIndex: 3,
    knowledgeTarget: "Le Goulag est l’appareil soviétique qui administre un vaste réseau de camps et de colonies de travail forcé."
  });
  const result = await runQuestionQualityPipeline([institutionQuestion], {
    maxRetries: 0,
    reviewSemantic: async ({ entries }) => ({
      reviews: [{
        id: entries[0].id,
        verdict: "reject",
        reasonCodes: ["GUESSABLE_WITHOUT_KNOWLEDGE"],
        expectedCorrectIndexes: [3],
        targetsKnowledge: true,
        groundedInSource: true,
        comment: "Seule une option est effectivement une institution ; les trois autres sont un événement et une doctrine artistique, identifiables sans connaître le sujet."
      }]
    })
  });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0].reasons[0].code, "GUESSABLE_WITHOUT_KNOWLEDGE");
});

test("wiring : un stem politique avec une seule réponse politique et trois réponses d'autres domaines est refusé (CATEGORY_MISMATCH, critique mockée)", async () => {
  const domainEchoQuestion = q("Quelle transformation politique caractérise le stalinisme ?", {
    sourceId: "stalinisme-transfo",
    options: [
      "La planification économique est instaurée et l’industrie lourde devient prioritaire",
      "Les exploitations agricoles sont regroupées dans des fermes collectives ou d’État",
      "La censure et la propagande encadrent la vie politique et sociale",
      "Le monopole politique du Parti communiste est maintenu et le pouvoir est davantage centralisé"
    ],
    correctIndex: 3,
    knowledgeTarget: "Le stalinisme conserve le monopole politique du Parti communiste et renforce fortement la centralisation du pouvoir."
  });
  const result = await runQuestionQualityPipeline([domainEchoQuestion], {
    maxRetries: 0,
    reviewSemantic: async ({ entries }) => ({
      reviews: [{
        id: entries[0].id,
        verdict: "reject",
        reasonCodes: ["CATEGORY_MISMATCH"],
        expectedCorrectIndexes: [3],
        targetsKnowledge: true,
        groundedInSource: true,
        comment: "Les trois distracteurs sont vrais mais économique/agricole/culturel : seule l'option politique répond au domaine nommé par le stem, réponse trouvable par simple appariement lexical."
      }]
    })
  });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0].reasons[0].code, "CATEGORY_MISMATCH");
});

test("acceptation : une question réellement discriminante n'est rejetée par aucun des deux nouveaux contrôles déterministes, malgré des distracteurs thématiquement proches", () => {
  const moscowTrials = q("Comment peut-on caractériser les procès de Moscou de 1936 à 1938 ?", {
    sourceId: "stalinisme-proces",
    options: [
      "Des procès économiques consacrés au premier plan quinquennal et à l’industrie lourde",
      "Des audiences consacrées à l’application du réalisme socialiste dans les arts",
      "Des procédures administratives visant les paysans classés parmi les « koulaks »",
      "Des procès politiques publics visant notamment d’anciens dirigeants bolcheviques accusés de complots contre le régime"
    ],
    correctIndex: 3,
    knowledgeTarget: "Les procès de Moscou de 1936 à 1938 sont des procès politiques publics visant notamment d’anciens dirigeants bolcheviques accusés de complots contre le régime."
  });
  const destalinisation = q("Quelle situation caractérise la déstalinisation ?", {
    sourceId: "stalinisme-destaline",
    options: [
      "Elle réduit certaines formes de terreur et le culte de la personnalité sans supprimer le parti unique ni l’économie planifiée",
      "Elle remplace l’économie planifiée par la Nouvelle Politique économique et le parti unique par plusieurs partis",
      "Elle maintient toutes les formes de terreur et supprime le culte de la personnalité",
      "Elle supprime le parti unique et l’économie planifiée tout en renforçant la terreur"
    ],
    correctIndex: 0,
    knowledgeTarget: "La déstalinisation réduit certaines formes de terreur et le culte de la personnalité, mais maintient le parti unique et l’économie planifiée soviétique."
  });
  const batch = validateQuestionBatchQuality([moscowTrials, destalinisation]);
  assert.equal(batch.accepted.length, 2);
  assert.equal(batch.rejected.length, 0);
});
