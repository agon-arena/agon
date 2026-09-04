"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");

const serverSource = fs.readFileSync(require.resolve("../server.js"), "utf8");
const formatsSource = fs.readFileSync(require.resolve("../lib/question-formats.js"), "utf8");

test("les cinq parcours générateurs passent par la chaîne V2", () => {
  for (const route of ["free_search", "notion_", "knowledge_import", "knowledge_import_batch", "comprendre"]) {
    assert.match(serverSource, new RegExp(`route:\\s*[\`\"']${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
  // 8 depuis le 02/09/2026 (Phase 1, génération progressive) : 7 depuis le
  // 31/08/2026 (V3.2, "fallback d'enrichissement des sources" — une
  // définition, cinq branchements historiques ci-dessus, et un sixième
  // branchement dans expandGroundingAndRegenerateMissingQuestions), PLUS un
  // huitième branchement dans generateElementaryBlock (route
  // "free_search_progressive_elementary", bloc élémentaire k1-k5 du plan
  // pédagogique progressif) — une route entièrement nouvelle et distincte,
  // jamais un détournement de "free_search". Repasse par EXACTEMENT la même
  // chaîne V2 (aucun contournement, aucune baisse d'exigence de qualité),
  // cf. test/qcm-grounding-source-expansion-integration.test.js.
  assert.match(serverSource, /route: "free_search_progressive_elementary"/);
  assert.equal((serverSource.match(/qualityControlRawQuestions\s*\(/g) || []).length, 8, "une définition, cinq branchements historiques, le branchement d'expansion V3.2, et le branchement du bloc élémentaire progressif");
});

test("la critique est faite avant validateNarrativeQuizQuestions/shuffle", () => {
  const helper = serverSource.indexOf("async function qualityControlRawQuestions");
  const validator = serverSource.indexOf("function validateNarrativeQuizQuestions");
  assert.ok(validator < helper, "le validateur structurel appelle ensuite validateQuestionItemCore qui mélange");
  assert.match(formatsSource, /validateQuestionQuality\(item\)[\s\S]{0,1400}shuffleOptionsPreservingCorrectIndex/);
});

test("le verrou post-shuffle est appelé pour QCM simple, multiple, association et ordre", () => {
  assert.ok((formatsSource.match(/validateFinalShuffledQuestion\(item, finalQuestion\)/g) || []).length >= 4);
});

test("aucun second lot complet n'est généré après la chaîne ciblée", () => {
  assert.match(serverSource, /const questionAttempts = 1;/);
  assert.match(serverSource, /Remplace exactement \$\{rejectionPayload\.length\} question/);
});

test("les logs de qualité restent agrégés et n'impriment aucun contenu privé", () => {
  const start = serverSource.indexOf('console.info("[qcm-quality]"');
  const snippet = serverSource.slice(start, start + 700);
  assert.doesNotMatch(snippet, /knowledgeTarget|rejectedQuestion|sourceExcerpt|question:/);
  assert.match(snippet, /\.\.\.outcome\.metrics/);
});

for (const code of [
  "WEAK_DISTRACTOR_SET",
  "ANSWER_SALIENCE",
  "GUESSABLE_WITHOUT_KNOWLEDGE",
  "AMBIGUOUS_DISTRACTOR",
  "ARTIFICIAL_DISTRACTOR",
  "OVERGENERALIZED_QUESTION",
  // REORDERED_DUPLICATE_OPTION / ARTIFICIAL_YES_NO (audit réel "Les oiseaux
  // migrateurs", 03/09/2026) : ajoutés à cette même liste — ces deux codes,
  // déjà détectés par le déterministe, restaient jusqu'ici sans consigne
  // ciblée dédiée dans la régénération.
  "REORDERED_DUPLICATE_OPTION",
  "ARTIFICIAL_YES_NO",
  // GROUNDING_CLAIM_NOT_GROUNDED_IN_SOURCE (audit réel "Les Gueules
  // cassées", 03/09/2026) : 92% des rejets de cette génération, jamais
  // corrigé par la régénération générique GROUNDING_* existante.
  "GROUNDING_CLAIM_NOT_GROUNDED_IN_SOURCE"
]) {
  test(`V5 régénération ciblée : ${code} possède une contrainte corrective`, () => {
    const codePosition = serverSource.indexOf(`rejectionCodes.has("${code}")`);
    assert.ok(codePosition >= 0, `${code} doit être branché dans la régénération existante`);
    assert.match(serverSource.slice(codePosition, codePosition + 1800), /targetedConstraints\.push/);
  });
}

// ── A/B/C/D : formulation exacte, cumul, non-écrasement (audit "Les oiseaux
// migrateurs", 03/09/2026) ─────────────────────────────────────────────

test("A. REORDERED_DUPLICATE_OPTION : la consigne exige des options factuellement distinctes, jamais de simple réordonnancement/reformulation", () => {
  assert.match(
    serverSource,
    /if \(rejectionCodes\.has\("REORDERED_DUPLICATE_OPTION"\)\) \{\s*\n\s*targetedConstraints\.push\("- REORDERED_DUPLICATE_OPTION : les options doivent représenter des réponses factuellement distinctes\. Ne réutilise pas les mêmes éléments simplement réordonnés ou reformulés\./
  );
});

test("B. ARTIFICIAL_YES_NO : la consigne interdit le pseudo-QCM binaire et impose une reformulation factuelle non binaire", () => {
  assert.match(
    serverSource,
    /if \(rejectionCodes\.has\("ARTIFICIAL_YES_NO"\)\) \{\s*\n\s*targetedConstraints\.push\("- ARTIFICIAL_YES_NO : ne transforme pas un fait binaire en pseudo-QCM/
  );
});

test("C. les deux nouveaux blocs sont deux `if` indépendants et successifs (jamais un seul bloc conditionnel exclusif) — les deux consignes se cumulent naturellement si les deux codes sont présents à la fois, exactement comme le reste du bloc targetedConstraints", () => {
  const reorderedIndex = serverSource.indexOf('rejectionCodes.has("REORDERED_DUPLICATE_OPTION")');
  const artificialYesNoIndex = serverSource.indexOf('rejectionCodes.has("ARTIFICIAL_YES_NO")');
  assert.ok(reorderedIndex >= 0 && artificialYesNoIndex >= 0);
  const between = serverSource.slice(reorderedIndex, artificialYesNoIndex);
  // Rien entre les deux qui ressemble à un "else"/"return" qui empêcherait le second bloc de s'exécuter.
  assert.doesNotMatch(between, /\belse\b|\breturn\b/);
});

test("D. les nouveaux blocs n'écrasent ni ne remplacent les blocs existants (ARTIFICIAL_DISTRACTOR juste avant, OVERGENERALIZED_QUESTION juste après, tous deux toujours présents et intacts)", () => {
  assert.match(serverSource, /rejectionCodes\.has\("ARTIFICIAL_DISTRACTOR"\)\) \{\s*\n\s*targetedConstraints\.push\("- ARTIFICIAL_DISTRACTOR :/);
  assert.match(serverSource, /rejectionCodes\.has\("OVERGENERALIZED_QUESTION"\)\) \{\s*\n\s*targetedConstraints\.push\("- OVERGENERALIZED_QUESTION :/);
  // Ordre exact : ARTIFICIAL_DISTRACTOR -> REORDERED_DUPLICATE_OPTION -> ARTIFICIAL_YES_NO -> OVERGENERALIZED_QUESTION.
  const order = ["ARTIFICIAL_DISTRACTOR", "REORDERED_DUPLICATE_OPTION", "ARTIFICIAL_YES_NO", "OVERGENERALIZED_QUESTION"]
    .map((code) => serverSource.indexOf(`rejectionCodes.has("${code}")`));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "les 4 blocs doivent apparaître dans cet ordre, aucun n'en remplace un autre");
});

test("E. aucun seuil/validateur/modèle/retry n'est touché par ce correctif : MIN_ELEMENTARY_READY_QUESTIONS, maxRetries, DAILY_QUIZ_NARRATIVE_MODEL/CRITIC_MODEL restent inchangés dans ce bloc", () => {
  const reorderedIndex = serverSource.indexOf('rejectionCodes.has("REORDERED_DUPLICATE_OPTION")');
  const blockAround = serverSource.slice(reorderedIndex - 200, reorderedIndex + 1000);
  assert.doesNotMatch(blockAround, /MIN_ELEMENTARY_READY_QUESTIONS\s*=/);
  assert.doesNotMatch(blockAround, /maxRetries\s*=/);
  assert.doesNotMatch(blockAround, /temperature:/);
  assert.doesNotMatch(blockAround, /model:\s*DAILY_QUIZ/);
});

// ── GROUNDING_CLAIM_NOT_GROUNDED_IN_SOURCE (audit "Les Gueules cassées",
// 03/09/2026) : formulation exacte, mentions attendues, cumul, non-régression ──

test("1. GROUNDING_CLAIM_NOT_GROUNDED_IN_SOURCE ajoute bien sa consigne dédiée", () => {
  assert.match(
    serverSource,
    /if \(rejectionCodes\.has\("GROUNDING_CLAIM_NOT_GROUNDED_IN_SOURCE"\)\) \{\s*\n\s*targetedConstraints\.push\("- GROUNDING_CLAIM_NOT_GROUNDED_IN_SOURCE spécifiquement : reformule supporting_claim en restant au plus près du texte source réellement cité\./
  );
});

test("2. la consigne mentionne explicitement la proximité lexicale et la conservation des termes factuels clés (noms propres, dates, nombres, vocabulaire)", () => {
  const codePosition = serverSource.indexOf('rejectionCodes.has("GROUNDING_CLAIM_NOT_GROUNDED_IN_SOURCE")');
  const block = serverSource.slice(codePosition, codePosition + 900);
  assert.match(block, /Conserve les noms propres, dates, nombres, termes factuels et vocabulaire clé du passage source/);
  assert.match(block, /reformulation légère et fidèle du passage source, pas un résumé conceptuel/);
  assert.match(block, /Évite les paraphrases abstraites, synonymes éloignés ou reformulations qui changent trop le lexique/);
});

test("3. GROUNDING_CLAIM_NOT_GROUNDED_IN_SOURCE se cumule avec GROUNDING_ANSWER_NOT_IN_CLAIM (deux `if` indépendants et successifs, jamais exclusifs)", () => {
  const answerNotInClaimIndex = serverSource.indexOf('rejectionCodes.has("GROUNDING_ANSWER_NOT_IN_CLAIM")');
  const claimNotGroundedIndex = serverSource.indexOf('rejectionCodes.has("GROUNDING_CLAIM_NOT_GROUNDED_IN_SOURCE")');
  assert.ok(answerNotInClaimIndex >= 0 && claimNotGroundedIndex >= 0 && answerNotInClaimIndex < claimNotGroundedIndex);
  const between = serverSource.slice(answerNotInClaimIndex, claimNotGroundedIndex);
  assert.doesNotMatch(between, /\belse\b|\breturn\b/);
});

test("4. GROUNDING_CLAIM_NOT_GROUNDED_IN_SOURCE se cumule avec REORDERED_DUPLICATE_OPTION (blocs indépendants, aucun ne masque l'autre malgré la distance dans le fichier)", () => {
  assert.match(serverSource, /rejectionCodes\.has\("REORDERED_DUPLICATE_OPTION"\)\) \{\s*\n\s*targetedConstraints\.push\("- REORDERED_DUPLICATE_OPTION :/);
  assert.match(serverSource, /rejectionCodes\.has\("GROUNDING_CLAIM_NOT_GROUNDED_IN_SOURCE"\)\) \{\s*\n\s*targetedConstraints\.push\("- GROUNDING_CLAIM_NOT_GROUNDED_IN_SOURCE spécifiquement :/);
  const reorderedIndex = serverSource.indexOf('rejectionCodes.has("REORDERED_DUPLICATE_OPTION")');
  const claimNotGroundedIndex = serverSource.indexOf('rejectionCodes.has("GROUNDING_CLAIM_NOT_GROUNDED_IN_SOURCE")');
  assert.ok(reorderedIndex >= 0 && claimNotGroundedIndex >= 0, "les deux blocs doivent coexister, quel que soit leur ordre dans le fichier");
});

test("5. aucun seuil/validateur/modèle/température/retry modifié par ce correctif (recouvrement lexical, validateQuestionGrounding, V3.2, MIN_ELEMENTARY_READY_QUESTIONS, curriculum)", () => {
  const codePosition = serverSource.indexOf('rejectionCodes.has("GROUNDING_CLAIM_NOT_GROUNDED_IN_SOURCE")');
  const blockAround = serverSource.slice(codePosition - 400, codePosition + 900);
  assert.doesNotMatch(blockAround, /MIN_ELEMENTARY_READY_QUESTIONS\s*=/);
  assert.doesNotMatch(blockAround, /maxRetries\s*=/);
  assert.doesNotMatch(blockAround, /temperature:/);
  assert.doesNotMatch(blockAround, /model:\s*DAILY_QUIZ/);
  assert.doesNotMatch(blockAround, /MIN_CLAIM_SOURCE_OVERLAP|MIN_CLAIM_SOURCE_INDIVIDUAL_CONTRIBUTION|MIN_ANSWER_CLAIM_OVERLAP/);
  assert.doesNotMatch(blockAround, /shouldExpandGroundingSources|expandGroundingAndRegenerateMissingQuestions/);
  // lib/question-grounding-validation.js (les seuils de recouvrement lexical eux-mêmes) reste totalement intact.
  const groundingValidationSource = fs.readFileSync(require.resolve("../lib/question-grounding-validation.js"), "utf8");
  assert.match(groundingValidationSource, /MIN_CLAIM_SOURCE_OVERLAP/);
});

test("V5 sélection de format : pertinence avant variété et intrus jamais imposé", () => {
  assert.match(serverSource, /pertinence (?:p[ée]dagogique )?du format[^.]{0,180}(?:avant|prime)[^.]{0,120}vari[ée]t[ée]/i);
  assert.match(serverSource, /intrus[^.]{0,300}point commun substantiel/i);
  assert.match(serverSource, /aucun quota par format|jamais.*quota.*format/i);
});

// ── SOURCE_REFERENCE_WORDING (Phase 2.3, 04/09/2026, "chaque question doit
// être autonome, sans référence au support") — le contrôle lui-même est pur
// et testé isolément dans test/qcm-quality.test.js ; ce fichier verrouille
// uniquement le CÂBLAGE : présent dans le cycle de régénération ciblée
// (même mécanisme que les autres codes déterministes), jamais un nouvel
// appel IA dédié. ────────────────────────────────────────────────────────

test("SOURCE_REFERENCE_WORDING a bien une consigne de régénération ciblée, dans le même bloc targetedConstraints que les autres codes déterministes", () => {
  const codePosition = serverSource.indexOf('rejectionCodes.has("SOURCE_REFERENCE_WORDING")');
  assert.ok(codePosition > 0, "le code doit être testé dans le bloc targetedConstraints");
  assert.match(
    serverSource.slice(codePosition, codePosition + 900),
    /targetedConstraints\.push\("- SOURCE_REFERENCE_WORDING : réécris la question sans AUCUNE référence, explicite ou implicite, au support/
  );
  // Situé dans la même fonction que les autres blocs déjà verrouillés
  // ci-dessus (DOUBLE_NEGATION, UNNECESSARY_NEGATION, GROUNDING_*) — jamais
  // une fonction séparée ni un second appel regenerate().
  const doubleNegationIndex = serverSource.indexOf('rejectionCodes.has("DOUBLE_NEGATION")');
  const groundingIndex = serverSource.indexOf('rejectionCodes.has("GROUNDING_CLAIM_NOT_GROUNDED_IN_SOURCE")');
  assert.ok(doubleNegationIndex > 0 && codePosition > doubleNegationIndex && codePosition < groundingIndex);
});

test("aucun nouvel appel IA introduit pour ce correctif : le contrôle vit uniquement dans validateQuestionQuality (lib/qcm-quality.js), jamais dans buildSemanticReviewPrompt ni un nouveau helper _callOpenAI", () => {
  const qualitySource = fs.readFileSync(require.resolve("../lib/qcm-quality.js"), "utf8");
  assert.match(qualitySource, /function hasSourceReferenceWording\(value\)/);
  const fnIndex = qualitySource.indexOf("if (hasSourceReferenceWording(question))");
  const validatorIndex = qualitySource.indexOf("function validateQuestionQuality(item, options = {}) {");
  const nextFnIndex = qualitySource.indexOf("\nfunction ", validatorIndex + 10);
  assert.ok(fnIndex > validatorIndex && fnIndex < (nextFnIndex > 0 ? nextFnIndex : qualitySource.length), "le contrôle doit vivre dans validateQuestionQuality, purement déterministe");
  const semanticPromptIndex = qualitySource.indexOf("function buildSemanticReviewPrompt(");
  const semanticPromptEnd = qualitySource.indexOf("\nfunction ", semanticPromptIndex + 10);
  assert.doesNotMatch(qualitySource.slice(semanticPromptIndex, semanticPromptEnd), /SOURCE_REFERENCE_WORDING|hasSourceReferenceWording/, "le critique sémantique (appel IA) ne doit jamais porter ce contrôle");
});

test("buildQuestionsFromKnowledgePrompt (lib/knowledge-admission.js) porte la règle d'autonomie de la question, sur le seul générateur de questions partagé par tous les pipelines (legacy et progressif)", () => {
  const admissionSource = fs.readFileSync(require.resolve("../lib/knowledge-admission.js"), "utf8");
  assert.match(admissionSource, /INTERDICTION ABSOLUE de faire référence, explicitement ou implicitement, au support/);
  // Une seule fonction de génération de questions dans tout le fichier :
  // la règle ne peut donc pas avoir été oubliée sur un second chemin.
  assert.equal((admissionSource.match(/^function buildQuestionsFromKnowledgePrompt\(/gm) || []).length, 1);
});
