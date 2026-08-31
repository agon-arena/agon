"use strict";

// Test d'intégration bout-en-bout (V3.2, demande du 31/08/2026 — "fallback
// d'enrichissement des sources lorsque le grounding est insuffisant",
// sections 23/24). Même contrainte que test/qcm-grounding-integration.test.js
// (V3.1) : server.js n'est pas require()-able isolément (démarre Express à
// l'import), donc expandWebSearchGroundingSources/
// expandGroundingAndRegenerateMissingQuestions (server.js, réseau réel) ne
// peuvent pas être appelées directement ici. Ce test enchaîne à la place
// TOUTES les fonctions PURES réellement utilisées par ce pipeline, dans le
// même ordre que server.js : buildIdentifiedSources/appendIdentifiedSources
// (lib/web-search-grounding.js) → runQuestionQualityPipeline
// (lib/qcm-quality.js, avec le VRAI validateQuestionGrounding V3.1, jamais
// affaibli) → shouldExpandGroundingSources (lib/grounding-source-expansion.js)
// → (fixture simulant la nouvelle source Brave + la régénération ciblée) →
// runQuestionQualityPipeline une seconde fois → validateQuestionItemCore.
// Jamais un vrai appel réseau/IA — la "recherche Brave" et la "régénération"
// sont ici de simples fixtures, comme l'exige le test V3.1 équivalent.

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildIdentifiedSources, appendIdentifiedSources, formatIdentifiedSourcesBlock } = require("../lib/web-search-grounding");
const { runQuestionQualityPipeline } = require("../lib/qcm-quality");
const { validateQuestionItemCore, normalizeFactText } = require("../lib/question-formats");
const { shouldExpandGroundingSources, buildSourceExpansionQuery, DOCUMENTARY_GROUNDING_REASON_CODES } = require("../lib/grounding-source-expansion");
const { extractGroundingReasonCounts } = require("../lib/qcm-grounding-metrics");

// ── Fixture : sujet volontairement fictif ("Kelvinia"), jamais un pays réel
// — section 24 : "sans dépendre de la valeur réelle actuelle".

const admittedKnowledge = [
  { fact: "La superficie du pays Kelvinia est de 120 000 km².", importance: "high", certainty: "high", sequential: false, clearBoundary: false },
  { fact: "La population du pays Kelvinia s'élève à 5,2 millions d'habitants.", importance: "high", certainty: "high", sequential: false, clearBoundary: false }
];

const INITIAL_EXTRACTED_SOURCES = [
  { title: "Géographie de Kelvinia", url: "https://encyclopedie.example/kelvinia-geographie", domain: "encyclopedie.example",
    text: "Kelvinia est un pays dont la superficie totale est de 120 000 km², à dominante agricole et montagneuse au nord." },
  { title: "Histoire de Kelvinia", url: "https://encyclopedie.example/kelvinia-histoire", domain: "encyclopedie.example2",
    text: "Kelvinia a été fondée au XIXe siècle et a connu plusieurs réformes administratives depuis son indépendance." },
  { title: "Économie de Kelvinia", url: "https://encyclopedie.example/kelvinia-economie", domain: "encyclopedie.example3",
    text: "L'économie de Kelvinia repose principalement sur l'agriculture et l'exportation de minerais." }
];

function questionArea() {
  return {
    knowledgeTarget: "La superficie du pays Kelvinia est de 120 000 km².",
    supporting_claim: "Kelvinia est un pays dont la superficie totale est de 120 000 km².",
    source_ids: ["SOURCE_1"],
    variants: [{
      type: "qcm",
      question: "Quelle est la superficie du pays Kelvinia ?",
      options: ["80 000 km²", "120 000 km²", "150 000 km²", "200 000 km²"],
      correctIndex: 1,
      explanation: "La superficie de Kelvinia est de 120 000 km².",
      selfContained: true,
      retrievalMode: "direct"
    }]
  };
}

// Le modèle cite la seule source disponible (SOURCE_1, géographie) pour une
// affirmation démographique qu'elle ne contient PAS — cas réel observé sur
// "population de la Chine" (confirmé en production le 31/08/2026).
function questionPopulationUnsupported() {
  return {
    knowledgeTarget: "La population du pays Kelvinia s'élève à 5,2 millions d'habitants.",
    supporting_claim: "Kelvinia a une population de 5,2 millions d'habitants.",
    source_ids: ["SOURCE_1"],
    variants: [{
      type: "qcm",
      question: "Quelle est la population du pays Kelvinia ?",
      options: ["2,1 millions", "5,2 millions", "9 millions", "12 millions"],
      correctIndex: 1,
      explanation: "La population de Kelvinia est de 5,2 millions d'habitants.",
      selfContained: true,
      retrievalMode: "direct"
    }]
  };
}

test("étape 1 : corpus initial (3 sources) insuffisant pour le fait démographique -> rejet documentaire, le fait géographique est accepté", async () => {
  const identifiedSources = buildIdentifiedSources(INITIAL_EXTRACTED_SOURCES);
  assert.deepEqual(identifiedSources.map((s) => s.sourceId), ["SOURCE_1", "SOURCE_2", "SOURCE_3"]);
  const groundingSourcesMap = new Map(identifiedSources.map((s) => [s.sourceId, s]));

  const outcome = await runQuestionQualityPipeline([questionArea(), questionPopulationUnsupported()], {
    semanticReviewEnabled: false,
    groundingSources: groundingSourcesMap,
    maxRetries: 0
  });

  assert.equal(outcome.accepted.length, 1, "seule la question géographique, réellement soutenue, doit être acceptée");
  assert.equal(outcome.accepted[0].knowledgeTarget, admittedKnowledge[0].fact);
  assert.equal(outcome.rejected.length, 1);
  // Le rejet exact (recouvrement lexical insuffisant vs chiffre non attesté)
  // dépend de la formulation, mais doit toujours rester un motif DOCUMENTAIRE
  // (cf. lib/grounding-source-expansion.js) — c'est ce qui déclenche le
  // fallback V3.2, jamais un motif de format/protocole.
  assert.ok(DOCUMENTARY_GROUNDING_REASON_CODES.has(outcome.rejected[0].reasons[0].code), `motif attendu documentaire, obtenu ${outcome.rejected[0].reasons[0].code}`);
  assert.equal(outcome.metrics.finalAccepted, 1);
  assert.equal(outcome.metrics.groundingEnabled, true);

  // ── étape 2 : la décision d'expansion (section 4/5) ───────────────────
  const decision = shouldExpandGroundingSources(outcome.metrics, { questionsRequested: admittedKnowledge.length });
  assert.equal(decision.expand, true, "2 demandées, 1 acceptée, motif documentaire -> expansion attendue");

  // ── étape 3 : requête complémentaire jamais identique au sujet seul ──
  const groundingReasons = extractGroundingReasonCounts(outcome.metrics.unresolvedReasonCounts);
  const documentaryReasonCodes = Object.keys(groundingReasons).filter((code) => DOCUMENTARY_GROUNDING_REASON_CODES.has(code));
  assert.equal(documentaryReasonCodes.length, 1);
  const expansionQuery = buildSourceExpansionQuery("Kelvinia", { documentaryReasonCodes });
  assert.notEqual(expansionQuery, "Kelvinia");
  assert.match(expansionQuery, /^Kelvinia /);

  // ── étape 4 : "Brave" (fixture) renvoie 2 nouvelles sources, ajoutées
  // sans jamais renuméroter SOURCE_1/2/3 (section 12) ────────────────────
  const newExtractedSources = [
    { title: "Institut statistique de Kelvinia — recensement", url: "https://stats-kelvinia.example/recensement", domain: "stats-kelvinia.example",
      text: "Selon le recensement officiel, Kelvinia comptait 5,2 millions d'habitants en 2024, en hausse par rapport à la décennie précédente." },
    { title: "Rapport économique régional", url: "https://organisation-regionale.example/kelvinia-pib", domain: "organisation-regionale.example",
      text: "Le produit intérieur brut de Kelvinia a progressé de 3% en 2024, porté par le secteur agricole." }
  ];
  const mergedIdentifiedSources = appendIdentifiedSources(identifiedSources, newExtractedSources);
  assert.equal(mergedIdentifiedSources.length, 5);
  assert.deepEqual(mergedIdentifiedSources.slice(0, 3), identifiedSources, "SOURCE_1/2/3 doivent rester identiques au caractère près");
  assert.equal(mergedIdentifiedSources[3].sourceId, "SOURCE_4");
  assert.equal(mergedIdentifiedSources[4].sourceId, "SOURCE_5");
  assert.match(mergedIdentifiedSources[3].text, /5,2 millions d'habitants en 2024/);

  const mergedGroundingSourcesMap = new Map(mergedIdentifiedSources.map((s) => [s.sourceId, s]));
  const mergedBlock = formatIdentifiedSourcesBlock(mergedIdentifiedSources);
  assert.match(mergedBlock, /SOURCE_1[\s\S]*SOURCE_4[\s\S]*SOURCE_5/);

  // ── étape 5 : régénération CIBLÉE — uniquement la connaissance manquante,
  // jamais la question géographique déjà acceptée (section 13) ──────────
  const missingKnowledge = admittedKnowledge.filter((k) => !outcome.accepted.some((v) => normalizeFactText(v.knowledgeTarget) === normalizeFactText(k.fact)));
  assert.equal(missingKnowledge.length, 1);
  assert.equal(missingKnowledge[0].fact, admittedKnowledge[1].fact);

  const regeneratedPopulationQuestion = {
    knowledgeTarget: "La population du pays Kelvinia s'élève à 5,2 millions d'habitants.",
    supporting_claim: "Kelvinia comptait 5,2 millions d'habitants en 2024, selon le recensement officiel.",
    source_ids: ["SOURCE_4"],
    variants: [{
      type: "qcm",
      question: "Quelle est la population du pays Kelvinia, selon le recensement de 2024 ?",
      options: ["2,1 millions", "5,2 millions", "9 millions", "12 millions"],
      correctIndex: 1,
      explanation: "Le recensement officiel de 2024 dénombre 5,2 millions d'habitants.",
      selfContained: true,
      retrievalMode: "direct"
    }]
  };

  const expansionOutcome = await runQuestionQualityPipeline([regeneratedPopulationQuestion], {
    semanticReviewEnabled: false,
    groundingSources: mergedGroundingSourcesMap,
    maxRetries: 0
  });
  assert.equal(expansionOutcome.accepted.length, 1, "la nouvelle question, réellement soutenue par SOURCE_4, doit être acceptée par le MÊME validateur V3.1");
  assert.equal(expansionOutcome.accepted[0].source_ids[0], "SOURCE_4");

  // ── étape 6 : fusion finale — la question géographique n'est jamais
  // rejouée, seule la manquante est ajoutée ──────────────────────────────
  const finalValidated = [...outcome.accepted, ...expansionOutcome.accepted];
  assert.equal(finalValidated.length, 2);
  assert.equal(finalValidated[0], outcome.accepted[0], "la question déjà acceptée doit rester la MÊME référence, jamais régénérée");
  assert.equal(finalValidated[1].knowledgeTarget, admittedKnowledge[1].fact);

  const storedShapes = finalValidated.map((q) => validateQuestionItemCore(q));
  assert.ok(storedShapes.every(Boolean), "toutes les questions finales doivent passer la validation de format finale");
  assert.equal(storedShapes[1].supporting_claim, regeneratedPopulationQuestion.supporting_claim);
  assert.deepEqual(storedShapes[1].source_ids, ["SOURCE_4"]);
});

// ── Section 24 : cas numérique dédié — un chiffre erroné, même après
// enrichissement, reste rejeté (l'expansion ne relâche jamais le contrôle).

test("cas numérique dédié : le corpus enrichi n'accepte QUE la valeur réellement attestée par la nouvelle source, jamais une autre valeur plausible", async () => {
  const identifiedSources = buildIdentifiedSources(INITIAL_EXTRACTED_SOURCES);
  const newSource = { title: "Institut statistique de Kelvinia", url: "https://stats-kelvinia.example/recensement", domain: "stats-kelvinia.example",
    text: "Selon le recensement officiel, Kelvinia comptait 5,2 millions d'habitants en 2024." };
  const merged = appendIdentifiedSources(identifiedSources, [newSource]);
  const mergedMap = new Map(merged.map((s) => [s.sourceId, s]));

  const wrongValueQuestion = {
    knowledgeTarget: "La population du pays Kelvinia s'élève à 5,2 millions d'habitants.",
    supporting_claim: "Kelvinia comptait 5,2 millions d'habitants en 2024.",
    source_ids: ["SOURCE_4"],
    variants: [{
      type: "qcm",
      question: "Quelle est la population du pays Kelvinia, selon le recensement de 2024 ?",
      options: ["2,1 millions", "5,2 millions", "6,4 millions", "9 millions"],
      correctIndex: 2, // 6,4 millions — absent de la source, jamais accepté même après enrichissement
      explanation: "Le recensement officiel de 2024 dénombre 6,4 millions d'habitants.",
      selfContained: true,
      retrievalMode: "direct"
    }]
  };

  const outcome = await runQuestionQualityPipeline([wrongValueQuestion], {
    semanticReviewEnabled: false,
    groundingSources: mergedMap,
    maxRetries: 0
  });
  assert.equal(outcome.accepted.length, 0, "un chiffre non attesté par la source citée ne doit JAMAIS passer, même après enrichissement du corpus");
  assert.equal(outcome.rejected[0].reasons[0].code, "GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED");
});

test("cas numérique dédié : la valeur réellement attestée, avec le bon contexte (recensement/2024), est acceptée", async () => {
  const identifiedSources = buildIdentifiedSources(INITIAL_EXTRACTED_SOURCES);
  const newSource = { title: "Institut statistique de Kelvinia", url: "https://stats-kelvinia.example/recensement", domain: "stats-kelvinia.example",
    text: "Selon le recensement officiel, Kelvinia comptait 5,2 millions d'habitants en 2024." };
  const merged = appendIdentifiedSources(identifiedSources, [newSource]);
  const mergedMap = new Map(merged.map((s) => [s.sourceId, s]));

  const correctQuestion = {
    knowledgeTarget: "La population du pays Kelvinia s'élève à 5,2 millions d'habitants.",
    supporting_claim: "Kelvinia comptait 5,2 millions d'habitants en 2024, selon le recensement officiel.",
    source_ids: ["SOURCE_4"],
    variants: [{
      type: "qcm",
      question: "Quelle est la population du pays Kelvinia, selon le recensement de 2024 ?",
      options: ["2,1 millions", "5,2 millions", "6,4 millions", "9 millions"],
      correctIndex: 1,
      explanation: "Le recensement officiel de 2024 dénombre 5,2 millions d'habitants.",
      selfContained: true,
      retrievalMode: "direct"
    }]
  };

  const outcome = await runQuestionQualityPipeline([correctQuestion], {
    semanticReviewEnabled: false,
    groundingSources: mergedMap,
    maxRetries: 0
  });
  assert.equal(outcome.accepted.length, 1);
});
