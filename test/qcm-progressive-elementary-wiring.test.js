"use strict";

// Verrous de câblage — Génération progressive PHASE 1 (02/09/2026, cf.
// rapport d'architecture du même jour) ; taille FLEXIBLE du curriculum
// (02/09/2026, suite). server.js ne peut pas être `require()` dans un test
// (il démarre tout le serveur Express à l'import, cf. commentaire en tête de
// lib/question-formats.js) : ce fichier vérifie donc, en lisant server.js
// comme un TEXTE brut (jamais exécuté), que le câblage attendu est bien en
// place — même principe que test/notion-quiz-master-wiring.test.js et
// test/knowledge-admission-wiring.test.js. La logique curriculum elle-même
// (split 25/25/50, quasi-doublons, réparation vers le minimum, renormali-
// sation) est testée en isolation, sur de vraies données, dans
// test/notion-quiz-curriculum.test.js — ce fichier ne la reteste jamais, il
// verrouille uniquement le BRANCHEMENT dans server.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

// ── Curriculum : taille flexible (15-20), plus de quota fixe ─────────────

test("resolveProgressiveCurriculum construit le prompt curriculum puis parse via parseCurriculumItems (jamais un parsing maison)", () => {
  assert.match(
    SERVER_SOURCE,
    /async function resolveProgressiveCurriculum\(apiKey, subject, contextHint, id, grounding\) \{[\s\S]{0,900}?buildCurriculumPrompt\(subject, contextHint, grounding\?\.groundingText \|\| null\)[\s\S]{0,300}?pool = parseCurriculumItems\(JSON\.parse\(content\)\?\.curriculum\);/
  );
});

test("resolveProgressiveCurriculum ne force plus jamais un total de 20 : aucune référence à CURRICULUM_LEVELS ou CURRICULUM_TOTAL (constantes supprimées avec le quota fixe)", () => {
  assert.doesNotMatch(SERVER_SOURCE, /CURRICULUM_LEVELS/);
  assert.doesNotMatch(SERVER_SOURCE, /CURRICULUM_TOTAL/);
});

test("resolveProgressiveCurriculum renormalise le SEUL sous-ensemble elementary (id/order 1..N) et attache verified:true, level:\"elementary\" — jamais l'inverse", () => {
  assert.match(
    SERVER_SOURCE,
    /const elementaryFinal = normalizeCurriculumOrder\(acceptedElementary\)\.map\(\(item\) => \(\{ \.\.\.item, level: "elementary", verified: true \}\)\);/
  );
});

test("les connaissances deepening/expert différées sont renumérotées à la suite de l'elementary, avec verified:false explicite — jamais silencieusement considérées admises", () => {
  assert.match(
    SERVER_SOURCE,
    /const deferredFinal = deferredCandidates\.map\(\(item, index\) => \(\{\s*\n\s*id: `k\$\{elementaryFinal\.length \+ index \+ 1\}`,\s*\n\s*knowledgeTarget: item\.knowledgeTarget,\s*\n\s*order: elementaryFinal\.length \+ index \+ 1,\s*\n\s*level: item\.level,\s*\n\s*verified: false\s*\n\s*\}\)\);/
  );
  assert.match(SERVER_SOURCE, /const finalCurriculum = \[\.\.\.elementaryFinal, \.\.\.deferredFinal\];/);
});

test("resolveProgressiveCurriculum écarte les quasi-doublons via findNearDuplicateCurriculumKnowledge, jamais une comparaison ad hoc", () => {
  assert.match(SERVER_SOURCE, /const pair = findNearDuplicateCurriculumKnowledge\(current\)\[0\];/);
});

// ── Split provisoire + vérification scindée elementary-only (latence,
// 03/09/2026, audit réel "Les oiseaux migrateurs") ───────────────────────

test("le split est calculé sur le pool BRUT (avant vérification), via normalizeCurriculumOrder + assignCurriculumLevels réutilisés tels quels — jamais une seconde logique de split", () => {
  assert.match(SERVER_SOURCE, /const leveledPool = assignCurriculumLevels\(normalizeCurriculumOrder\(pool\)\);/);
  assert.match(SERVER_SOURCE, /let elementaryPool = selectCurriculumLevel\(leveledPool, "elementary"\);/);
  assert.match(SERVER_SOURCE, /const deferredCandidates = leveledPool\.filter\(\(item\) => item\.level !== "elementary"\);/);
});

test("knowledge_verification ne porte QUE sur le sous-ensemble elementary — jamais sur le pool entier (verifyOrders appelé avec elementaryPool, jamais pool)", () => {
  assert.match(SERVER_SOURCE, /acceptedOrders = await verifyOrders\(elementaryPool\);/);
  assert.doesNotMatch(SERVER_SOURCE, /acceptedOrders = await verifyOrders\(pool\);/);
});

// ── Réparation : uniquement pour revenir à la cible ELEMENTARY, jamais à 20 ──

test("le curriculum elementary n'est réparé que s'il tombe sous sa propre cible (elementaryTarget) — jamais un seuil de 15 ni un retour à 20", () => {
  assert.match(
    SERVER_SOURCE,
    /for \(let attempt = 1; attempt <= CURRICULUM_REPAIR_MAX_ATTEMPTS; attempt \+= 1\) \{\s*\n\s*if \(acceptedElementary\.length >= elementaryTarget\) break; \/\/ déjà au complet, jamais de réparation superflue/
  );
});

test("le nombre de connaissances demandées en réparation est calculé via missingCurriculumCount(acceptedElementary.length, elementaryTarget) — jamais un total fixe de remplacement", () => {
  assert.match(SERVER_SOURCE, /const neededCount = missingCurriculumCount\(acceptedElementary\.length, elementaryTarget\);/);
});

test("missingCurriculumCount reste rétrocompatible : target optionnel, défaut MIN_PROGRESSIVE_CURRICULUM inchangé pour tout appelant existant", () => {
  const curriculumSource = fs.readFileSync(path.join(__dirname, "..", "lib", "notion-quiz-curriculum.js"), "utf8");
  assert.match(curriculumSource, /function missingCurriculumCount\(acceptedCount, target = MIN_PROGRESSIVE_CURRICULUM\) \{/);
});

test("les ajouts de réparation sont fusionnés via mergeCurriculumAdditions, sur le pool ET l'accepté ELEMENTARY uniquement (jamais un merge maison, jamais le pool deepening/expert touché)", () => {
  assert.match(SERVER_SOURCE, /elementaryPool = mergeCurriculumAdditions\(elementaryPool, additions\);/);
  assert.match(SERVER_SOURCE, /acceptedElementary = evictNearDuplicates\(mergeCurriculumAdditions\(acceptedElementary, newlyAccepted\)\);/);
});

test("CURRICULUM_REPAIR_MAX_ATTEMPTS plafonne les réparations à 2 tentatives (jamais une boucle non bornée)", () => {
  assert.match(SERVER_SOURCE, /const CURRICULUM_REPAIR_MAX_ATTEMPTS = 2;/);
  assert.match(SERVER_SOURCE, /for \(let attempt = 1; attempt <= CURRICULUM_REPAIR_MAX_ATTEMPTS; attempt \+= 1\) \{/);
});

test("un curriculum elementary toujours sous MIN_ELEMENTARY_READY_QUESTIONS après le plafond de réparations échoue proprement avec le code CURRICULUM_INCOMPLETE — jamais un seuil de 15", () => {
  assert.match(
    SERVER_SOURCE,
    /if \(acceptedElementary\.length < MIN_ELEMENTARY_READY_QUESTIONS\) \{[\s\S]{0,400}?return generationFailure\("CURRICULUM_INCOMPLETE", "curriculum_repair", \{/
  );
});

test("CURRICULUM_INCOMPLETE est un code d'erreur public déclaré (422, message utilisateur clair)", () => {
  const errorsSource = fs.readFileSync(path.join(__dirname, "../lib/custom-topic-generation-errors.js"), "utf8");
  assert.match(errorsSource, /CURRICULUM_INCOMPLETE:\s*\{\s*status:\s*422,/);
});

// ── Bloc A : dynamique (nombre de connaissances "elementary" du curriculum,
// pas toujours 5) ──────────────────────────────────────────────────────

test("le bloc élémentaire est extrait du curriculum via selectCurriculumLevel(curriculum, \"elementary\") (jamais tout le curriculum)", () => {
  assert.match(SERVER_SOURCE, /const elementaryKnowledge = selectCurriculumLevel\(curriculum, "elementary"\);/);
});

test("generateElementaryBlock utilise NOTION_QUIZ_LEVELS.elementaire comme levelConfig (jamais un autre niveau)", () => {
  assert.match(
    SERVER_SOURCE,
    /async function generateElementaryBlock\(apiKey, subject, contextHint, id, elementaryKnowledge, grounding\) \{\s*\n\s*const levelConfig = NOTION_QUIZ_LEVELS\.elementaire;/
  );
});

test("le timeout et la cible de questions du bloc élémentaire dépendent de elementaryKnowledge.length — jamais d'un compte fixe", () => {
  assert.match(SERVER_SOURCE, /const timeoutMs = Math\.min\(120_000, 45_000 \+ elementaryKnowledge\.length \* 3_000\);/);
});

test("le bloc élémentaire exige elementaryReadyThreshold (= min(MIN_ELEMENTARY_READY_QUESTIONS, elementaryKnowledge.length)) questions validées — qualité > quantité, jamais elementaryKnowledge.length exact", () => {
  assert.match(
    SERVER_SOURCE,
    /const elementaryReadyThreshold = Math\.min\(MIN_ELEMENTARY_READY_QUESTIONS, elementaryKnowledge\.length\);/
  );
  assert.match(
    SERVER_SOURCE,
    /if \(validated\.length < elementaryReadyThreshold\) \{[\s\S]{0,400}?return generationFailure\("QCM_UNUSABLE", "elementary_question_validation", \{/
  );
});

test("qualityControlRawQuestions reçoit earlyStopAtAccepted: elementaryReadyThreshold — inutile de régénérer une fois le seuil atteint", () => {
  assert.match(SERVER_SOURCE, /earlyStopAtAccepted: elementaryReadyThreshold/);
});

// ── Sur-génération initiale du bloc élémentaire (03/09/2026, audit latence
// réel "Empire carolingien") : pool de candidats plus large dès le premier
// appel, jamais un assouplissement de validateur/critique/grounding/seuil/
// modèle/température/retry. Comportement pur (distribution, consolidation)
// testé sur de vraies données dans test/question-formats.test.js et
// test/qcm-quality.test.js — ce bloc verrouille uniquement le CÂBLAGE dans
// generateElementaryBlock. ─────────────────────────────────────────────

test("6. le pool initial est calculé via computeElementaryCandidateDistribution(elementaryKnowledge.length, ELEMENTARY_INITIAL_CANDIDATE_POOL_SIZE) — jamais un calcul maison ni un nombre fixe", () => {
  assert.match(SERVER_SOURCE, /const initialCandidateCounts = computeElementaryCandidateDistribution\(elementaryKnowledge\.length, ELEMENTARY_INITIAL_CANDIDATE_POOL_SIZE\);/);
  assert.match(SERVER_SOURCE, /const totalInitialCandidates = initialCandidateCounts\.reduce\(\(sum, n\) => sum \+ n, 0\) \|\| elementaryKnowledge\.length;/);
});

test("6. buildQuestionsFromKnowledgePrompt reçoit initialCandidateCounts comme 6e argument — le pool initial, jamais un lot de taille fixe à 1 par connaissance", () => {
  assert.match(SERVER_SOURCE, /const questionPrompt = buildQuestionsFromKnowledgePrompt\("sourceId", id, admittedKnowledge, levelConfig\.instruction, formatBlock, initialCandidateCounts\);/);
});

test("perKnowledgeCandidateCounts reste optionnel et rétrocompatible : sans lui, buildQuestionsFromKnowledgePrompt produit le prompt EXACTEMENT comme avant ce chantier", () => {
  const knowledgeAdmissionSource = fs.readFileSync(path.join(__dirname, "..", "lib", "knowledge-admission.js"), "utf8");
  assert.match(knowledgeAdmissionSource, /function buildQuestionsFromKnowledgePrompt\(sourceIdField, sourceId, admittedKnowledge, levelInstruction, formatBlockLines, perKnowledgeCandidateCounts\) \{/);
  assert.match(knowledgeAdmissionSource, /"- Au maximum une question par connaissance de la liste — jamais plus\./);
});

test("2. la répartition garantit au moins un candidat par connaissance elementary — jamais un target totalement absent du premier lot", () => {
  const formatsSource = fs.readFileSync(path.join(__dirname, "..", "lib", "question-formats.js"), "utf8");
  assert.match(formatsSource, /const counts = new Array\(count\)\.fill\(1\);/);
});

test("le format block et validateNarrativeQuizQuestions utilisent totalInitialCandidates (le pool), jamais admittedKnowledge.length (le nombre de connaissances) pour ce bloc", () => {
  assert.match(SERVER_SOURCE, /const formatBlock = buildQuestionFormatsPromptBlock\("sourceId", totalInitialCandidates, true, undefined, currentGrounding\?\.identifiedSourcesBlock \|\| null\);/);
  assert.match(SERVER_SOURCE, /const structurallyValid = validateNarrativeQuizQuestions\(qualityApproved, \[id\], totalInitialCandidates, totalInitialCandidates\);/);
});

test("qualityControlRawQuestions (bloc élémentaire) reçoit earlyStopCountFn/filterRejectedForRegeneration/onInitialBatchAccepted, en plus de earlyStopAtAccepted", () => {
  assert.match(SERVER_SOURCE, /earlyStopCountFn: \(acceptedList\) => selectOneQuestionPerKnowledgeTarget\(acceptedList\)\.length,/);
  assert.match(SERVER_SOURCE, /filterRejectedForRegeneration: \(rejected, acceptedList\) => \{\s*\n\s*const coveredTargets = new Set\(selectOneQuestionPerKnowledgeTarget\(acceptedList\)\.map\(\(q\) => normalizeFactText\(q\?\.knowledgeTarget\)\)\);\s*\n\s*return rejected\.filter\(\(entry\) => !coveredTargets\.has\(normalizeFactText\(entry\.question\?\.knowledgeTarget\)\)\);\s*\n\s*\},/);
  assert.match(SERVER_SOURCE, /onInitialBatchAccepted: \(acceptedList\) => \{ initialBatchDistinctCount = selectOneQuestionPerKnowledgeTarget\(acceptedList\)\.length; \}/);
});

test("5/6. validated est consolidé via selectOneQuestionPerKnowledgeTarget AVANT la décision V3.2, puis re-consolidé défensivement après — au plus une question par connaissance distincte servie, quel que soit le chemin emprunté", () => {
  assert.match(SERVER_SOURCE, /validated = selectOneQuestionPerKnowledgeTarget\(knowledgeConstrained\);/);
  assert.match(SERVER_SOURCE, /validated = selectOneQuestionPerKnowledgeTarget\(expansionOutcome\.validated\);/);
});

test("8. V3.2 : shouldExpandGroundingSources reçoit finalAccepted: validated.length (déjà consolidé, distinct), jamais le nombre brut de candidats acceptés par le pipeline qualité", () => {
  assert.match(
    SERVER_SOURCE,
    /questionQualityMetrics: \{ \.\.\.questionQualityMetrics, finalAccepted: validated\.length \}/
  );
});

test("aucun modèle/température/retry touché par ce chantier : elementary_question_generation garde model: DAILY_QUIZ_NARRATIVE_MODEL, temperature: 0.4, et QCM_SEMANTIC_REVIEW_MAX_RETRIES/QCM_CRITIC_TECHNICAL_MAX_RETRIES restent des constantes déclarées une seule fois", () => {
  assert.match(
    SERVER_SOURCE,
    /feature: "elementary_question_generation",\s*\n\s*generationId: id\s*\n\s*\}\);/
  );
  const genIndex = SERVER_SOURCE.indexOf('feature: "elementary_question_generation"');
  const callBlock = SERVER_SOURCE.slice(Math.max(0, genIndex - 300), genIndex);
  assert.match(callBlock, /model: DAILY_QUIZ_NARRATIVE_MODEL,\s*\n\s*temperature: 0\.4,/);
  for (const constant of ["QCM_SEMANTIC_REVIEW_MAX_RETRIES", "QCM_CRITIC_TECHNICAL_MAX_RETRIES"]) {
    const declarations = SERVER_SOURCE.match(new RegExp(`const ${constant}\\s*=`, "g")) || [];
    assert.equal(declarations.length, 1, `${constant} doit rester déclarée exactement une fois`);
  }
});

test("aucun validateur touché : validateQuestionQuality/validateQuestionBatchQuality/validateQuestionGrounding restent définis exactement une fois dans lib/qcm-quality.js et lib/question-grounding-validation.js", () => {
  const qualitySource = fs.readFileSync(path.join(__dirname, "..", "lib", "qcm-quality.js"), "utf8");
  const groundingValidationSource = fs.readFileSync(path.join(__dirname, "..", "lib", "question-grounding-validation.js"), "utf8");
  assert.equal((qualitySource.match(/^function validateQuestionQuality\(/gm) || []).length, 1);
  assert.equal((qualitySource.match(/^function validateQuestionBatchQuality\(/gm) || []).length, 1);
  assert.equal((groundingValidationSource.match(/^function validateQuestionGrounding\(/gm) || []).length, 1);
});

test("7/8. le log qcm-progressive-timing porte elementary_initial_candidate_count/elementary_initial_distinct_targets_validated/elementary_regeneration_calls/elementary_ready_after_initial_batch", () => {
  assert.match(
    SERVER_SOURCE,
    /expert_count: expertKnowledgeCount,[\s\S]{0,700}?elementary_initial_candidate_count: elementaryInitialCandidateCount,\s*\n\s*elementary_initial_distinct_targets_validated: elementaryInitialDistinctTargetsValidated,\s*\n\s*elementary_regeneration_calls: elementaryRegenerationCalls,\s*\n\s*elementary_ready_after_initial_batch: elementaryReadyAfterInitialBatch/
  );
});

test("elementaryReadyAfterInitialBatch est dérivé de regenerationCycles===0 ET validated.length>=elementaryReadyThreshold — jamais un nouveau compteur indépendant qui pourrait diverger", () => {
  assert.match(SERVER_SOURCE, /elementaryReadyAfterInitialBatch = questionQualityMetrics\?\.regenerationCycles === 0 && validated\.length >= elementaryReadyThreshold;/);
});

test("les 4 nouveaux champs de blockResult sont bien destructurés dans ensureProgressiveElementaryGenerated, jamais recalculés localement", () => {
  assert.match(
    SERVER_SOURCE,
    /const \{\s*\n\s*sourceName,\s*\n\s*sourceDetail,\s*\n\s*validated,\s*\n\s*ficheMs,\s*\n\s*elementaryInitialCandidateCount,\s*\n\s*elementaryInitialDistinctTargetsValidated,\s*\n\s*elementaryRegenerationCalls,\s*\n\s*elementaryReadyAfterInitialBatch\s*\n\s*\} = blockResult;/
  );
});

// ── Instrumentation : taille réelle du curriculum + seuil de disponibilité ─

test("le log qcm-progressive-timing porte curriculum_size/elementary_target_count/elementary_validated_count/elementary_ready_threshold/deepening_count/expert_count/elementary_verification_count/deferred_verification_count, en plus des durées", () => {
  assert.match(
    SERVER_SOURCE,
    /console\.info\("\[qcm-progressive-timing\]", JSON\.stringify\(\{\s*\n\s*generationId: id,\s*\n\s*route: "free_search_progressive",\s*\n\s*grounding_ms: groundingMs,\s*\n\s*curriculum_ms: curriculumMs,\s*\n\s*elementary_fiche_ms: ficheMs,\s*\n\s*time_to_elementary_ready_ms: timeToElementaryReadyMs,\s*\n\s*curriculum_size: curriculum\.length,\s*\n\s*elementary_target_count: elementaryKnowledge\.length,\s*\n\s*elementary_validated_count: validated\.length,\s*\n\s*elementary_ready_threshold: elementaryReadyThreshold,[\s\S]{0,500}?elementary_verification_count: elementaryVerificationCount,\s*\n\s*deferred_verification_count: deferredVerificationCount,\s*\n\s*deepening_count: deepeningKnowledgeCount,\s*\n\s*expert_count: expertKnowledgeCount/
  );
});

test("elementaryVerificationCount/deferredVerificationCount proviennent de resolveProgressiveCurriculum, jamais recalculés localement", () => {
  assert.match(SERVER_SOURCE, /const \{ curriculum, curriculumMs, elementaryVerificationCount, deferredVerificationCount \} = curriculumResult;/);
  assert.match(SERVER_SOURCE, /elementaryVerificationCount: elementaryFinal\.length,\s*\n\s*deferredVerificationCount: deferredFinal\.length/);
});

test("le curriculum et sa réparation sont journalisés sous des features dédiées curriculum_generation / curriculum_repair", () => {
  assert.match(SERVER_SOURCE, /feature: "curriculum_generation",/);
  assert.match(SERVER_SOURCE, /feature: "curriculum_repair",/);
});

test("la vérification du curriculum réutilise la feature knowledge_verification existante (jamais une feature 'curriculum_verification' distincte)", () => {
  assert.match(SERVER_SOURCE, /feature: "knowledge_verification",/);
  assert.doesNotMatch(SERVER_SOURCE, /curriculum_verification/);
});

test("la fiche et les questions élémentaires sont journalisées sous elementary_fiche_generation / elementary_question_generation", () => {
  assert.match(SERVER_SOURCE, /feature: "elementary_fiche_generation",/);
  assert.match(SERVER_SOURCE, /feature: "elementary_question_generation",/);
});

test("qualityControlRawQuestions reçoit reviewFeature/regenerationFeature dédiés pour le bloc élémentaire (elementary_semantic_review / elementary_targeted_regeneration)", () => {
  assert.match(
    SERVER_SOURCE,
    /reviewFeature: "elementary_semantic_review",\s*\n\s*regenerationFeature: "elementary_targeted_regeneration"/
  );
});

test("qualityControlRawQuestions garde des noms de feature legacy par défaut (question_semantic_review/question_targeted_regeneration) pour tout appelant qui ne précise rien", () => {
  assert.match(
    SERVER_SOURCE,
    /reviewFeature = "question_semantic_review",\s*\n\s*regenerationFeature = "question_targeted_regeneration"/
  );
});

test("le même generationId (id) traverse grounding, curriculum, réparation, fiche et questions élémentaires — jamais un id recalculé en cours de route", () => {
  const block = SERVER_SOURCE.slice(
    SERVER_SOURCE.indexOf("async function resolveProgressiveCurriculum"),
    SERVER_SOURCE.indexOf("async function ensureProgressiveElementaryGenerated") + 2000
  );
  const generationIdOccurrences = block.match(/generationId: id/g) || [];
  assert.ok(generationIdOccurrences.length >= 4, `attendu au moins 4 usages de generationId: id, trouvé ${generationIdOccurrences.length}`);
});

// ── V3.2 : réutilisé tel quel, jamais adapté à une cible variable ────────

test("expandGroundingAndRegenerateMissingQuestions (V3.2) est réutilisé sans condition ni désactivation pour le bloc élémentaire", () => {
  assert.match(
    SERVER_SOURCE,
    /if \(questionQualityMetrics && currentGrounding\?\.identifiedSources\?\.length\) \{\s*\n\s*const expansionOutcome = await expandGroundingAndRegenerateMissingQuestions\(\{/
  );
});

test("fiche et questions élémentaires sont lancées en parallèle (deux tâches indépendantes démarrées avant tout await) — jamais séquentielles", () => {
  const fnStart = SERVER_SOURCE.indexOf("async function generateElementaryBlock");
  const fnEnd = SERVER_SOURCE.indexOf("\n// Orchestrateur complet Phase 1", fnStart);
  const fnBlock = SERVER_SOURCE.slice(fnStart, fnEnd);
  const ficheTaskIndex = fnBlock.indexOf("const ficheTask = (async () => {");
  const questionsTaskIndex = fnBlock.indexOf("const questionsTask = (async () => {");
  const firstAwaitFicheTaskIndex = fnBlock.indexOf("const ficheOutcome = await ficheTask;");
  assert.ok(ficheTaskIndex >= 0 && questionsTaskIndex >= 0 && firstAwaitFicheTaskIndex >= 0);
  // Les deux tâches doivent être DÉCLENCHÉES (IIFE invoquée) avant que l'une des deux ne soit awaitée.
  assert.ok(ficheTaskIndex < firstAwaitFicheTaskIndex && questionsTaskIndex < firstAwaitFicheTaskIndex, "les deux tâches doivent démarrer avant tout await — sinon elles ne sont pas réellement parallèles");
});

// ── Verrou en mémoire partagé (dédup legacy/progressif sur le même sujet) ─

test("ensureProgressiveElementaryGenerated réutilise _notionQuizMasterGenerationPromises avec la même clé masterSlot que le chemin legacy (empêche une course legacy/progressif)", () => {
  assert.match(
    SERVER_SOURCE,
    /async function ensureProgressiveElementaryGenerated\(masterSlot, topic, id, userId\) \{\s*\n\s*const pending = _notionQuizMasterGenerationPromises\.get\(masterSlot\);/
  );
  const fnStart = SERVER_SOURCE.indexOf("async function ensureProgressiveElementaryGenerated");
  const fnEnd = SERVER_SOURCE.indexOf("\nasync function ensureCustomTopicMasterGenerated", fnStart);
  const fnBlock = SERVER_SOURCE.slice(fnStart, fnEnd);
  assert.match(fnBlock, /_notionQuizMasterGenerationPromises\.set\(masterSlot, generation\);/);
});

// ── Route : nouvelle, isolée de la route legacy ───────────────────────────

test("la route POST /api/users/notion-quizzes/custom/progressive existe et est distincte de la route legacy POST .../custom", () => {
  assert.match(SERVER_SOURCE, /app\.post\("\/api\/users\/notion-quizzes\/custom\/progressive", rateLimit\("users", 30\), async \(req, res\) => \{/);
  assert.match(SERVER_SOURCE, /app\.post\("\/api\/users\/notion-quizzes\/custom", rateLimit\("users", 30\), async \(req, res\) => \{/);
});

test("la route progressive n'appelle ni triggerAutomaticNoesVideo ni createNotification (choix de portée Phase 1 assumé, pas un oubli)", () => {
  const routeStart = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom/progressive"');
  const routeEnd = SERVER_SOURCE.indexOf("\n});", routeStart) + 4;
  const routeSource = SERVER_SOURCE.slice(routeStart, routeEnd);
  assert.doesNotMatch(routeSource, /triggerAutomaticNoesVideo/);
  assert.doesNotMatch(routeSource, /createNotification/);
});

test("la route progressive relie l'utilisateur au QCM via user_notion_quizzes (accès immédiat, requested_level='elementaire')", () => {
  assert.match(
    SERVER_SOURCE,
    /\.upsert\(\s*\n\s*\{ user_id: user\.id, quiz_date: quizDate, slot: masterSlot, requested_level: "elementaire" \}/
  );
});

test("la route progressive sélectionne aussi curriculum (pas seulement questions/progressive_status) pour juger l'éligibilité d'une ligne existante", () => {
  assert.match(SERVER_SOURCE, /\.select\("quiz_date, questions, curriculum, progressive_status"\)/);
});

// ── isMasterEligibleQuiz / résolution de conflit : curriculum-driven, jamais réécrits ─

test("isMasterEligibleQuiz accepte un contexte optionnel {progressiveStatus, curriculum} sans changer sa signature historique (context = {} par défaut)", () => {
  const questionFormatsSource = fs.readFileSync(path.join(__dirname, "../lib/question-formats.js"), "utf8");
  assert.match(questionFormatsSource, /function isMasterEligibleQuiz\(questions, context = \{\}\) \{/);
});

test("progressiveEligibilityMinimum (lib/question-formats.js) dérive le seuil elementary_ready/deepening_ready du curriculum réel, jamais d'une table fixe 5/10", () => {
  const questionFormatsSource = fs.readFileSync(path.join(__dirname, "../lib/question-formats.js"), "utf8");
  assert.match(questionFormatsSource, /const count = list\.filter\(\(item\) => item\?\.level === "elementary"\)\.length;/);
  assert.match(questionFormatsSource, /const count = list\.filter\(\(item\) => item\?\.level === "elementary" \|\| item\?\.level === "deepening"\)\.length;/);
});

test("resolveMasterInsertConflict interroge aussi curriculum et progressive_status et les transmet à isMasterEligibleQuiz pour juger la ligne concurrente", () => {
  assert.match(
    SERVER_SOURCE,
    /\.select\("quiz_date, questions, curriculum, progressive_status"\)[\s\S]{0,300}?isMasterEligibleQuiz\(raceRow\?\.questions, \{ progressiveStatus: raceRow\?\.progressive_status, curriculum: raceRow\?\.curriculum \}\)/
  );
});

test("la route progressive réutilise une ligne existante éligible via isMasterEligibleQuiz + progressive_status + curriculum (jamais de nouvelle génération pour un sujet déjà couvert)", () => {
  assert.match(
    SERVER_SOURCE,
    /if \(existingRow && isMasterEligibleQuiz\(existingRow\.questions, \{ progressiveStatus: existingRow\.progressive_status, curriculum: existingRow\.curriculum \}\)\) \{/
  );
});

// ── Aucune modification des réglages legacy (modèles, seuils, MIN_MASTER_QUESTIONS) ─

test("MIN_MASTER_QUESTIONS n'est jamais réassigné ni redéfini dans server.js (seuil legacy global inchangé)", () => {
  const assignments = SERVER_SOURCE.match(/MIN_MASTER_QUESTIONS\s*=\s*\d/g) || [];
  assert.equal(assignments.length, 0, "MIN_MASTER_QUESTIONS ne doit jamais être réassigné — seul progressiveEligibilityMinimum introduit un seuil progressif dérivé du curriculum, dans lib/question-formats.js");
});

test("progressiveEligibilityMinimum (lib/question-formats.js) n'écrase jamais MIN_MASTER_QUESTIONS : 'ready' pointe explicitement dessus", () => {
  const questionFormatsSource = fs.readFileSync(path.join(__dirname, "../lib/question-formats.js"), "utf8");
  assert.match(questionFormatsSource, /if \(progressiveStatus === "ready"\) return MIN_MASTER_QUESTIONS;/);
});

// ── generateNotionLevelQuiz / buildCustomTopicQuiz / ensureCustomTopicMasterGenerated : non touchés ──

test("generateNotionLevelQuiz, buildCustomTopicQuiz et ensureCustomTopicMasterGenerated ne sont ni appelés ni modifiés par le chemin progressif (chemin entièrement nouveau et additif)", () => {
  const progressiveBlockStart = SERVER_SOURCE.indexOf("async function resolveProgressiveCurriculum");
  const progressiveBlockEnd = SERVER_SOURCE.indexOf("async function ensureCustomTopicMasterGenerated");
  const progressiveBlock = SERVER_SOURCE.slice(progressiveBlockStart, progressiveBlockEnd);
  assert.doesNotMatch(progressiveBlock, /generateNotionLevelQuiz\(/);
  assert.doesNotMatch(progressiveBlock, /buildCustomTopicQuiz\(/);
});

// ── Pas de nouvelle migration nécessaire (colonnes déjà appliquées en base) ─

test("la migration curriculum/progressive_status reste celle déjà appliquée — additive, aucune nouvelle table, aucun nouveau fichier de migration requis par ce correctif", () => {
  const migrationSource = fs.readFileSync(path.join(__dirname, "../data/migration-daily-quiz-progressive.sql"), "utf8");
  assert.match(migrationSource, /ALTER TABLE daily_quiz ADD COLUMN IF NOT EXISTS curriculum JSONB;/);
  assert.match(migrationSource, /ALTER TABLE daily_quiz ADD COLUMN IF NOT EXISTS progressive_status TEXT;/);
  assert.doesNotMatch(migrationSource, /CREATE TABLE/i);
});
