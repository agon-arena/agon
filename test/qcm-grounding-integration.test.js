"use strict";

// Test d'intégration bout-en-bout (V3.1, demande du 31/08/2026 — "validation
// bout-en-bout et observabilité du grounding QCM", section 13/14) : trace la
// chaîne RÉELLE (fonctions pures effectivement utilisées en production, dans
// le même ordre qu'en production), depuis les sources identifiées jusqu'à
// l'objet destiné au stockage, avec un modèle simulé par une fixture (jamais
// un vrai appel réseau/IA).
//
// server.js n'est pas require()-able isolément (il démarre tout Express à
// l'import) : ce test ne peut donc pas appeler generateNotionLevelQuiz ni
// buildQuestionFormatsPromptBlock (qui restent dans server.js) directement.
// Il enchaîne à la place TOUTES les fonctions pures qui, elles, sont
// require()-ables et réellement appelées par ce pipeline, dans le même
// ordre : buildIdentifiedSources/formatIdentifiedSourcesBlock →
// buildQuestionsFromKnowledgePrompt → (fixture simulant la réponse JSON du
// modèle) → runQuestionQualityPipeline (validation déterministe + grounding
// réels) → validateQuestionItemCore (l'étape exacte où le bug de perte de
// supporting_claim/source_ids avait été trouvé et corrigé, cf.
// test/question-formats.test.js pour son test dédié). Le câblage
// server.js <-> buildQuestionFormatsPromptBlock lui-même reste verrouillé
// par test/knowledge-admission-wiring.test.js (lecture de server.js comme
// texte, même principe que ses autres tests).

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildIdentifiedSources, formatIdentifiedSourcesBlock } = require("../lib/web-search-grounding");
const { buildQuestionsFromKnowledgePrompt } = require("../lib/knowledge-admission");
const { validateQuestionItemCore } = require("../lib/question-formats");
const { runQuestionQualityPipeline } = require("../lib/qcm-quality");

const EXTRACTED_SOURCES = [
  { title: "La durée légale du travail", url: "https://travail-emploi.gouv.fr/la-duree-legale-du-travail", domain: "travail-emploi.gouv.fr", text: "La durée légale du travail à temps complet est fixée à 35 heures par semaine, en application du Code du travail." }
];
const IDENTIFIED_SOURCES = buildIdentifiedSources(EXTRACTED_SOURCES);
const SOURCES_BLOCK = formatIdentifiedSourcesBlock(IDENTIFIED_SOURCES);
const GROUNDING_SOURCES_MAP = new Map(IDENTIFIED_SOURCES.map((s) => [s.sourceId, s]));

function rawModelQuestion(overrides = {}) {
  return {
    knowledgeTarget: "La durée légale du travail est de 35 heures.",
    supporting_claim: "La durée légale du travail à temps complet est fixée à 35 heures par semaine.",
    source_ids: ["SOURCE_1"],
    variants: [{
      type: "qcm",
      question: "Quelle est la durée légale hebdomadaire du travail à temps complet ?",
      options: ["32 heures", "35 heures", "37 heures", "40 heures"],
      correctIndex: 1,
      explanation: "La durée légale du travail est fixée à 35 heures par semaine.",
      selfContained: true,
      retrievalMode: "direct"
    }],
    ...overrides
  };
}

// ── Étape 1 : SOURCE_1 arrive réellement dans le prompt de génération ────

test("étape 1 : SOURCE_1 (identifiant, titre, url, contenu réel) arrive dans le prompt envoyé au modèle de génération des questions", () => {
  assert.match(SOURCES_BLOCK, /^SOURCE_1\ntitle: La durée légale du travail\nurl: https:\/\/travail-emploi\.gouv\.fr/);
  assert.match(SOURCES_BLOCK, /35 heures par semaine/);

  const admittedKnowledge = [{ fact: "La durée légale du travail est de 35 heures.", importance: "high", certainty: "high", sequential: false, clearBoundary: false }];
  // Reproduit exactement ce que buildQuestionFormatsPromptBlock (server.js)
  // construit réellement quand groundingSourcesBlock est fourni (cf. son
  // code : "Sources disponibles (identifiant, titre, url, contenu) :" suivi
  // du bloc) — le câblage précis server.js -> cette valeur est verrouillé
  // séparément par test/knowledge-admission-wiring.test.js.
  const formatBlockLines = ["=== Formats de question possibles ===", "Sources disponibles (identifiant, titre, url, contenu) :", SOURCES_BLOCK, ""];
  const prompt = buildQuestionsFromKnowledgePrompt("sourceId", "test-gen-1", admittedKnowledge, null, formatBlockLines);

  assert.match(prompt, /SOURCE_1/);
  assert.match(prompt, /travail-emploi\.gouv\.fr/);
  assert.match(prompt, /35 heures par semaine/);
});

// ── Étapes 2-8 : sortie modèle → parsing → format → pipeline qualité → ───
// ── grounding → objet destiné au stockage ─────────────────────────────────

test("étapes 2-8 (cas accepté) : la fixture 'modèle' traverse tout le pipeline réel et arrive intacte à l'objet destiné au stockage", async () => {
  // Étape 2 : parsing JSON réel — simule content = await _callOpenAI(...);
  // JSON.parse(content).questions dans server.js.
  const parsedQuestions = JSON.parse(JSON.stringify({ questions: [rawModelQuestion()] })).questions;
  assert.equal(parsedQuestions.length, 1);

  // Étapes 5-6 : pipeline qualité réel (déterministe + grounding réel, sans
  // critique sémantique ici pour rester déterministe et sans appel réseau).
  const outcome = await runQuestionQualityPipeline(parsedQuestions, {
    semanticReviewEnabled: false,
    groundingSources: GROUNDING_SOURCES_MAP
  });
  assert.equal(outcome.accepted.length, 1, "la question correctement tracée doit être acceptée par le pipeline qualité");
  assert.equal(outcome.metrics.groundingEnabled, true);
  assert.equal(outcome.metrics.groundingCandidatesFirstPass, 1);
  assert.equal(outcome.metrics.groundingAcceptedFirstPass, 1);
  assert.equal(outcome.metrics.groundingRejectedFirstPass, 0);
  assert.equal(outcome.accepted[0].supporting_claim, rawModelQuestion().supporting_claim, "supporting_claim doit survivre à runQuestionQualityPipeline");
  assert.deepEqual(outcome.accepted[0].source_ids, ["SOURCE_1"], "source_ids doit survivre à runQuestionQualityPipeline");

  // Étapes 3-4 et 7-8 : validateQuestionItemCore — l'étape EXACTE de
  // validateNarrativeQuizQuestions (server.js) appliquée juste avant
  // stockage, où le bug de perte de supporting_claim/source_ids avait été
  // trouvé et corrigé (extractGroundingFields, lib/question-formats.js).
  // Ce test échoue si un futur refactor réintroduit cette perte.
  const storedShape = validateQuestionItemCore(outcome.accepted[0]);
  assert.ok(storedShape, "la question doit passer la validation de format finale");
  assert.equal(storedShape.supporting_claim, rawModelQuestion().supporting_claim, "supporting_claim doit survivre jusqu'à l'objet destiné au stockage");
  assert.deepEqual(storedShape.source_ids, ["SOURCE_1"], "source_ids doit survivre jusqu'à l'objet destiné au stockage");
  assert.equal(storedShape.variants[0].question, rawModelQuestion().variants[0].question);
});

test("étapes 2-8 (cas rejeté, 39 heures alors que la source dit 35) : jamais accepté, jamais stocké", async () => {
  const wrong = rawModelQuestion({
    variants: [{
      type: "qcm",
      question: "Quelle est la durée légale hebdomadaire du travail à temps complet ?",
      options: ["32 heures", "35 heures", "37 heures", "39 heures"],
      correctIndex: 3,
      explanation: "La durée légale du travail est fixée à 39 heures par semaine.",
      selfContained: true,
      retrievalMode: "direct"
    }]
  });
  const outcome = await runQuestionQualityPipeline([wrong], {
    semanticReviewEnabled: false,
    groundingSources: GROUNDING_SOURCES_MAP,
    maxRetries: 0
  });
  assert.equal(outcome.accepted.length, 0, "une réponse non soutenue par la source ne doit jamais être acceptée");
  assert.equal(outcome.rejected[0].reasons[0].code, "GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED");
  assert.equal(outcome.metrics.groundingRejectedFirstPass, 1);
  assert.equal(outcome.metrics.groundingFailedFinal, 1);
});

// ── Régénération ciblée (section 14) : SOURCE_1 doit rester disponible ───

test("régénération ciblée : rejet GROUNDING_* déclenche une régénération, SOURCE_1 reste fournie, la nouvelle réponse (35 heures) est acceptée", async () => {
  const wrong = rawModelQuestion({
    variants: [{
      type: "qcm", question: "Quelle est la durée légale hebdomadaire du travail à temps complet ?",
      options: ["32 heures", "35 heures", "37 heures", "39 heures"], correctIndex: 3,
      explanation: "...", selfContained: true, retrievalMode: "direct"
    }]
  });
  const corrected = rawModelQuestion();

  let regenerationCall = null;
  const outcome = await runQuestionQualityPipeline([wrong], {
    semanticReviewEnabled: false,
    groundingSources: GROUNDING_SOURCES_MAP,
    maxRetries: 1,
    regenerate: async ({ rejected, attempt }) => {
      regenerationCall = { rejected, attempt };
      return [corrected];
    }
  });

  assert.ok(regenerationCall, "une régénération doit avoir été déclenchée");
  assert.equal(regenerationCall.rejected.length, 1);
  assert.equal(regenerationCall.rejected[0].reasons[0].code, "GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED", "le motif exact du rejet précédent doit être transmis à la régénération");

  assert.equal(outcome.accepted.length, 1, "la question corrigée (35 heures) doit être acceptée après régénération");
  assert.equal(outcome.accepted[0].supporting_claim, corrected.supporting_claim);
  assert.deepEqual(outcome.accepted[0].source_ids, ["SOURCE_1"]);

  const storedShape = validateQuestionItemCore(outcome.accepted[0]);
  assert.ok(storedShape);
  assert.equal(storedShape.supporting_claim, corrected.supporting_claim);
  assert.deepEqual(storedShape.source_ids, ["SOURCE_1"]);

  assert.equal(outcome.metrics.groundingRejectedFirstPass, 1);
  assert.equal(outcome.metrics.groundingRegenerationTriggerCount, 1);
  assert.equal(outcome.metrics.groundingFailedFinal, 0);
  assert.equal(outcome.metrics.groundingAcceptedAfterRegeneration, 1);
});

test("régénération ciblée : le prompt de base (qui contient SOURCE_1) reste disponible pour reconstruire la régénération — vérifié via le champ basePrompt attendu par server.js", () => {
  // server.js (qualityControlRawQuestions) construit son regenerationPrompt
  // en préfixant TOUJOURS basePrompt (le prompt original, qui contient déjà
  // le bloc SOURCE_N) — jamais reconstruit sans lui. Verrouillé ici comme
  // propriété du prompt lui-même : basePrompt inclut SOURCE_1 dès l'étape 1.
  const admittedKnowledge = [{ fact: "La durée légale du travail est de 35 heures.", importance: "high", certainty: "high", sequential: false, clearBoundary: false }];
  const formatBlockLines = ["Sources disponibles (identifiant, titre, url, contenu) :", SOURCES_BLOCK];
  const basePrompt = buildQuestionsFromKnowledgePrompt("sourceId", "test-gen-1", admittedKnowledge, null, formatBlockLines);
  const regenerationPromptPrefix = [basePrompt, "", "CYCLE DE RÉGÉNÉRATION CIBLÉE 1."].join("\n");
  assert.match(regenerationPromptPrefix, /SOURCE_1/);
});
