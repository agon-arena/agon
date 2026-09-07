"use strict";

// Verrous de câblage — chantier "pré-génération en avance des sujets IA
// proposés via l'API Batch OpenAI" (07/09/2026). Même principe que les
// autres fichiers *-wiring.test.js : server.js ne peut pas être require()-é
// en test (démarre tout le serveur Express) — ce fichier vérifie donc, en
// lisant server.js comme du TEXTE brut (jamais exécuté), que le câblage
// attendu est bien en place. Complète les tests d'exécution réelle de
// lib/notion-quiz-pregeneration-step-cache.test.js et
// lib/notion-quiz-pregeneration-queue.test.js (qui, eux, exécutent du vrai
// code avec un faux Supabase).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

test("_callOpenAI consulte le contexte de pré-génération et délègue à _callOpenAIViaPregenerationCache AVANT toute logique synchrone", () => {
  const idx = SERVER_SOURCE.indexOf("async function _callOpenAI(apiKey, messages, opts = {}) {");
  assert.ok(idx > 0);
  const body = SERVER_SOURCE.slice(idx, idx + 1200);
  assert.match(body, /const pregenStore = pregenerationContext\.getStore\(\);/);
  assert.match(body, /if \(pregenStore\) return _callOpenAIViaPregenerationCache\(pregenStore, apiKey, messages, opts\);/);
  // Doit précéder MAX_ATTEMPTS (le début du chemin synchrone existant) —
  // jamais un chemin synchrone amorcé avant de vérifier le contexte.
  const pregenCheckIdx = body.indexOf("pregenerationContext.getStore()");
  const syncStartIdx = body.indexOf("const MAX_ATTEMPTS");
  assert.ok(pregenCheckIdx > 0 && syncStartIdx > pregenCheckIdx, "la vérification du contexte pré-génération doit précéder le chemin synchrone");
});

test("_callOpenAIViaPregenerationCache : même contrat de retour (une chaîne content), mêmes model/messages/temperature/responseFormat que le chemin synchrone", () => {
  const idx = SERVER_SOURCE.indexOf("async function _callOpenAIViaPregenerationCache(");
  assert.ok(idx > 0);
  const body = SERVER_SOURCE.slice(idx, idx + 1200);
  assert.match(body, /const callKey = opts\.feature \|\| "unnamed";/);
  assert.match(body, /const occurrence = nextOccurrence\(pregenStore, callKey\);/);
  assert.match(body, /model: opts\.model \|\| "gpt-4o-mini"/);
  assert.match(body, /return result\.content;/);
});

test("les 5 points de garde re-lèvent immédiatement PregenerationPendingError/PregenerationCallFailedError (jamais avalées comme une panne IA réelle)", () => {
  const guardPattern = /if \(error instanceof pregenStepCache\.PregenerationPendingError \|\| error instanceof pregenStepCache\.PregenerationCallFailedError\) throw error;/g;
  const matches = [...SERVER_SOURCE.matchAll(guardPattern)];
  assert.equal(matches.length, 5, "attendu exactement 5 points de garde : resolveWebSearchGrounding, evidenceGateAndRepairCurriculumSubset, resolveProgressiveCurriculum, generateProgressiveLevelBlock (fiche + questions)");
});

test("le point de garde de generateProgressiveLevelBlock (questions) précède le test `if (error?.status)` — sans quoi le sentinel serait avalé comme un simple JSON invalide", () => {
  const idx = SERVER_SOURCE.indexOf("validated = selectOneQuestionPerKnowledgeTarget(paragraphGrounded);");
  assert.ok(idx > 0);
  const body = SERVER_SOURCE.slice(idx, idx + 600);
  const guardIdx = body.indexOf("PregenerationPendingError");
  const statusCheckIdx = body.indexOf("if (error?.status)");
  assert.ok(guardIdx > 0 && statusCheckIdx > guardIdx, "la garde pré-génération doit précéder le test error?.status");
});

test("ensureProgressiveElementaryGenerated utilise un verrou SÉPARÉ (_notionQuizPregenMasterGenerationPromises) en contexte de pré-génération, jamais partagé avec le chemin utilisateur réel", () => {
  const idx = SERVER_SOURCE.indexOf("async function ensureProgressiveElementaryGenerated(masterSlot, topic, id, userId) {");
  assert.ok(idx > 0);
  const body = SERVER_SOURCE.slice(idx, idx + 1800);
  assert.match(body, /const pregenStore = pregenerationContext\.getStore\(\);/);
  assert.match(body, /const lockMap = pregenStore \? _notionQuizPregenMasterGenerationPromises : _notionQuizMasterGenerationPromises;/);
  assert.match(body, /const pending = lockMap\.get\(masterSlot\);/);
});

test("continueProgressiveGeneration utilise un verrou SÉPARÉ (_notionQuizPregenContinuationPromises) en contexte de pré-génération", () => {
  const idx = SERVER_SOURCE.indexOf("async function continueProgressiveGeneration(masterSlot, topic, id, userId, targetLevel) {");
  assert.ok(idx > 0);
  const body = SERVER_SOURCE.slice(idx, idx + 700);
  assert.match(body, /const lockMap = pregenStore \? _notionQuizPregenContinuationPromises : _notionQuizContinuationPromises;/);
});

test("_notionQuizPregenMasterGenerationPromises/_notionQuizPregenContinuationPromises sont des Map DISTINCTES des verrous existants, jamais un alias", () => {
  assert.match(SERVER_SOURCE, /const _notionQuizPregenMasterGenerationPromises = new Map\(\);/);
  assert.match(SERVER_SOURCE, /const _notionQuizPregenContinuationPromises = new Map\(\);/);
});

test("server.js importe le module de contexte de pré-génération et le step-cache depuis lib/, jamais une réimplémentation locale", () => {
  assert.match(SERVER_SOURCE, /require\("\.\/lib\/notion-quiz-pregeneration-context"\)/);
  assert.match(SERVER_SOURCE, /const pregenStepCache = require\("\.\/lib\/notion-quiz-pregeneration-step-cache"\);/);
  assert.match(SERVER_SOURCE, /const pregenQueue = require\("\.\/lib\/notion-quiz-pregeneration-queue"\);/);
  assert.match(SERVER_SOURCE, /const openaiBatchClient = require\("\.\/lib\/openai-batch-client"\);/);
});

test("GET .../learn-next/ai-fallback enqueue chaque proposition FINALEMENT retenue avec isNew:true (après troncature à neededCount), jamais avant, jamais bloquant", () => {
  const routeIdx = SERVER_SOURCE.indexOf('app.get("/api/users/recommendations/learn-next/ai-fallback"');
  assert.ok(routeIdx > 0);
  const body = SERVER_SOURCE.slice(routeIdx, routeIdx + 9000);
  const sliceIdx = body.indexOf("resolved = resolved.slice(0, neededCount);");
  const enqueueIdx = body.indexOf("pregenQueue.enqueueProposedTopic(");
  const payloadIdx = body.indexOf("const payload = resolved.map(");
  assert.ok(sliceIdx > 0 && enqueueIdx > sliceIdx, "l'enqueue doit se faire APRÈS la troncature finale à neededCount");
  assert.ok(payloadIdx > enqueueIdx, "l'enqueue doit précéder la construction de la réponse (fire-and-forget, jamais attendu)");
  assert.match(body, /if \(!p\.isNew\) continue;/);
  assert.match(body, /findExistingMaster: findExistingQuizMaster/);
  assert.match(body, /\.catch\(\(error\) => console\.warn\("\[notion-quiz-pregeneration\] enqueue :", error\.message\)\);/);
});

// ── Scheduler : configuration, anti-chevauchement, désactivation ─────────

test("PREGENERATION_SCHEDULER_ENABLED est désactivé par défaut (valeur prudente, opt-in explicite requis après la migration)", () => {
  assert.match(SERVER_SOURCE, /const PREGENERATION_SCHEDULER_ENABLED = \/\^\(\?:1\|true\|on\|yes\)\$\/i\.test\(String\(process\.env\.PREGENERATION_SCHEDULER_ENABLED \|\| ""\)\.trim\(\)\);/);
});

test("PREGENERATION_BUFFER_TARGET/POLL_INTERVAL_MS/BATCH_SIZE sont configurables via l'environnement avec des valeurs par défaut prudentes", () => {
  assert.match(SERVER_SOURCE, /const PREGENERATION_BUFFER_TARGET = Math\.max\(1, parseInt\(process\.env\.PREGENERATION_BUFFER_TARGET, 10\) \|\| 5\);/);
  assert.match(SERVER_SOURCE, /const PREGENERATION_POLL_INTERVAL_MS = Math\.max\(30_000, parseInt\(process\.env\.PREGENERATION_POLL_INTERVAL_MS, 10\) \|\| 120_000\);/);
  assert.match(SERVER_SOURCE, /const PREGENERATION_BATCH_SIZE = Math\.max\(1, parseInt\(process\.env\.PREGENERATION_BATCH_SIZE, 10\) \|\| 20\);/);
});

test("le scheduler n'est enregistré (setInterval) que si PREGENERATION_SCHEDULER_ENABLED est vrai — procédure d'arrêt immédiate = repasser la variable à off puis redémarrer", () => {
  const idx = SERVER_SOURCE.indexOf("if (PREGENERATION_SCHEDULER_ENABLED) {");
  assert.ok(idx > 0);
  const body = SERVER_SOURCE.slice(idx, idx + 700);
  assert.match(body, /setInterval\(\(\) => \{/);
  assert.match(body, /_pregenReconcileActiveBatches\(\)\.catch/, "réconciliation au démarrage AVANT le premier cycle normal");
});

test("runPregenerationCycle : un verrou en mémoire (_pregenerationCycleRunning) empêche tout chevauchement entre deux cycles", () => {
  const idx = SERVER_SOURCE.indexOf("async function runPregenerationCycle() {");
  assert.ok(idx > 0);
  const body = SERVER_SOURCE.slice(idx, idx + 400);
  assert.match(body, /if \(_pregenerationCycleRunning\) return;/);
  assert.match(body, /_pregenerationCycleRunning = true;/);
  const fullIdx = SERVER_SOURCE.indexOf("async function runPregenerationCycle() {");
  const fullBody = SERVER_SOURCE.slice(fullIdx, fullIdx + 2000);
  assert.match(fullBody, /\} finally \{\s*\n\s*_pregenerationCycleRunning = false;/, "le verrou doit toujours être relâché, même en cas d'erreur");
});

// ── Reconciliation : ne jamais réparer sans avoir demandé le vrai statut à OpenAI ──

test("_pregenReconcileActiveBatches interroge OpenAI (retrieveBatch) pour CHAQUE batch_id actif avant toute réparation — jamais une réinitialisation aveugle par âge", () => {
  const idx = SERVER_SOURCE.indexOf("async function _pregenReconcileActiveBatches() {");
  assert.ok(idx > 0);
  const body = SERVER_SOURCE.slice(idx, idx + 1500);
  assert.match(body, /const activeBatchIds = await pregenStepCache\.selectActiveBatchIds\(\{ supabase \}\);/);
  assert.match(body, /const status = await openaiBatchClient\.retrieveBatch\(fetch, apiKey, batchId\);/);
  assert.match(body, /if \(status\.status === "completed"\)/);
  assert.match(body, /openaiBatchClient\.TERMINAL_BATCH_STATUSES\.has\(status\.status\)/);
  assert.match(body, /if \(error\?\.status === 404\)/, "batch introuvable (404) : seul cas où la réparation se fait sans confirmation d'un statut terminal explicite");
  assert.doesNotMatch(body, /updated_at.*<.*Date\.now\(\) - \d+ \* 60/, "jamais de comparaison d'âge (Nh) pour décider une réinitialisation");
});

test("_pregenReconcileActiveBatches ne resoumet jamais un batch encore in_progress/validating/finalizing (aucun appel à submitBatch ici)", () => {
  const idx = SERVER_SOURCE.indexOf("async function _pregenReconcileActiveBatches() {");
  const body = SERVER_SOURCE.slice(idx, idx + 1500);
  assert.doesNotMatch(body, /submitBatch/);
});

// ── Non-régression canari du 07/09/2026 : un Batch "completed" dont TOUTE
// requête a échoué a output_file_id=null (seul error_file_id est renseigné).
// downloadFileContent(null) déclenchait un vrai 404 OpenAI, que le catch de
// _pregenReconcileActiveBatches interprétait à tort comme "batch introuvable"
// alors que le Batch existe et est bien "completed" — jamais retenté au bon
// niveau (le sujet, via le call marqué failed), directement sabordé au niveau
// du batch entier avec un diagnostic trompeur.
test("_pregenApplyCompletedBatch ne télécharge output_file_id que s'il est présent, et télécharge/parse error_file_id s'il est présent (jamais downloadFileContent(null))", () => {
  const idx = SERVER_SOURCE.indexOf("async function _pregenApplyCompletedBatch(apiKey, batchId, batchStatus) {");
  assert.ok(idx > 0);
  const body = SERVER_SOURCE.slice(idx, idx + 1200);
  assert.match(body, /if \(batchStatus\.output_file_id\) \{/, "output_file_id doit être vérifié avant tout téléchargement");
  assert.match(body, /if \(batchStatus\.error_file_id\) \{/, "error_file_id (échec total ou partiel) doit être lu, jamais ignoré");
  const outputBlock = body.slice(body.indexOf("if (batchStatus.output_file_id)"), body.indexOf("if (batchStatus.error_file_id)"));
  assert.match(outputBlock, /downloadFileContent\(fetch, apiKey, batchStatus\.output_file_id\)/);
  const errorBlockIdx = body.indexOf("if (batchStatus.error_file_id)");
  const errorBlock = body.slice(errorBlockIdx, errorBlockIdx + 300);
  assert.match(errorBlock, /downloadFileContent\(fetch, apiKey, batchStatus\.error_file_id\)/);
  // error_file_id partage le même schéma de ligne que output_file_id (custom_id
  // + response.status_code >= 400) : jamais une deuxième fonction de parsing.
  const parseMatches = [...body.matchAll(/openaiBatchClient\.parseBatchOutputJsonl\(/g)];
  assert.equal(parseMatches.length, 2, "le même parseBatchOutputJsonl doit être réutilisé pour output_file_id ET error_file_id");
});

// ── Non-régression canari du 07/09/2026 : gpt-5.6-luna (MODELS_WITHOUT_CUSTOM_TEMPERATURE)
// rejette toute température explicite ("Unsupported value: 'temperature' does
// not support 0.2 with this model") — le chemin synchrone omet déjà
// temperature pour ces modèles (ligne du fetch direct), mais cette garde
// n'était jamais reprise pour construire les lignes JSONL du Batch : chaque
// requête Batch pour ce modèle échouait systématiquement (divergence
// batch/synchrone interdite, cf. §4 de la demande).
test("_pregenSubmitPendingBatch omet temperature pour MODELS_WITHOUT_CUSTOM_TEMPERATURE, exactement comme le chemin synchrone de _callOpenAI", () => {
  const idx = SERVER_SOURCE.indexOf("async function _pregenSubmitPendingBatch() {");
  assert.ok(idx > 0);
  const body = SERVER_SOURCE.slice(idx, idx + 1400);
  assert.match(body, /temperature: MODELS_WITHOUT_CUSTOM_TEMPERATURE\.has\(call\.request_payload\.model\) \? undefined : call\.request_payload\.temperature/);
});

// ── Soumission : plusieurs sujets regroupés dans le même Batch ────────────

test("_pregenSubmitPendingBatch soumet TOUS les appels pending accumulés (plusieurs sujets) en UN SEUL appel submitBatch, jamais un par sujet", () => {
  const idx = SERVER_SOURCE.indexOf("async function _pregenSubmitPendingBatch() {");
  assert.ok(idx > 0);
  const body = SERVER_SOURCE.slice(idx, idx + 2000);
  assert.match(body, /const pendingCalls = await pregenStepCache\.selectPendingCalls\(\{ supabase, limit: PREGENERATION_BATCH_SIZE \}\);/);
  const submitMatches = [...body.matchAll(/openaiBatchClient\.submitBatch\(/g)];
  assert.equal(submitMatches.length, 1, "un seul point d'appel à submitBatch, jamais une boucle par sujet");
  assert.match(body, /const requestLines = pendingCalls\.map\(/, "un tableau de requêtes construit AVANT le seul appel submitBatch — plusieurs sujets naturellement réunis s'ils sont tous 'pending' au même cycle");
});

test("custom_id de chaque ligne Batch vient directement de call.custom_id (déterministe, cf. step-cache), jamais reconstruit différemment ici", () => {
  const idx = SERVER_SOURCE.indexOf("async function _pregenSubmitPendingBatch() {");
  const body = SERVER_SOURCE.slice(idx, idx + 1200);
  assert.match(body, /customId: call\.custom_id,/);
});

// ── Driver par sujet : Course 4, retry, jamais de user_notion_quizzes ─────

test("_pregenAttemptTopicProgress vérifie D'ABORD si le master est déjà 'ready' (Course 4 : génération synchrone utilisateur gagnante) avant tout appel au pipeline", () => {
  const idx = SERVER_SOURCE.indexOf("async function _pregenAttemptTopicProgress(queueRow) {");
  assert.ok(idx > 0);
  const body = SERVER_SOURCE.slice(idx, idx + 2000);
  const existingIdx = body.indexOf("const existingMaster = await findExistingQuizMaster([masterSlot]);");
  const readyCheckIdx = body.indexOf('existingMaster?.progressiveStatus === "ready"');
  const ensureIdx = body.indexOf("ensureProgressiveElementaryGenerated(masterSlot");
  assert.ok(existingIdx > 0 && readyCheckIdx > existingIdx && ensureIdx > readyCheckIdx, "l'existence d'un master déjà ready doit être vérifiée avant tout appel de génération");
});

test("_pregenAttemptTopicProgress : PregenerationPendingError n'est jamais traitée comme un échec — le sujet reste 'generating', jamais 'failed'", () => {
  const idx = SERVER_SOURCE.indexOf("async function _pregenAttemptTopicProgress(queueRow) {");
  const body = SERVER_SOURCE.slice(idx, idx + 3000);
  assert.match(body, /if \(error instanceof pregenStepCache\.PregenerationPendingError\) \{/);
  const pendingBranchIdx = body.indexOf("if (error instanceof pregenStepCache.PregenerationPendingError) {");
  const branchBody = body.slice(pendingBranchIdx, pendingBranchIdx + 500);
  assert.match(branchBody, /status: "generating"/);
  assert.doesNotMatch(branchBody, /status: "failed"/);
});

test("politique de retry : _pregenMarkTopicFailed repasse à pending (avec attempt_count incrémenté) sous PREGENERATION_MAX_ATTEMPTS, sinon failed définitivement", () => {
  const idx = SERVER_SOURCE.indexOf("async function _pregenMarkTopicFailed(queueRow, reason) {");
  assert.ok(idx > 0);
  const body = SERVER_SOURCE.slice(idx, idx + 800);
  assert.match(body, /const attemptCount = \(queueRow\.attempt_count \|\| 0\) \+ 1;/);
  assert.match(body, /if \(attemptCount < PREGENERATION_MAX_ATTEMPTS\) \{/);
  assert.match(body, /await pregenStepCache\.resetFailedCallsForRetry\(\{ supabase, queueId: queueRow\.id \}\);/);
  assert.match(body, /status: "pending", attempt_count: attemptCount/);
  assert.match(body, /status: "failed", attempt_count: attemptCount/);
});

test("aucune écriture dans user_notion_quizzes nulle part dans le code de pré-génération (scheduler) — seulement notion_quiz_pregeneration_queue/daily_quiz via le pipeline existant", () => {
  const schedulerStart = SERVER_SOURCE.indexOf("// Pré-génération en avance des sujets IA proposés — scheduler (07/09/2026)");
  assert.ok(schedulerStart > 0);
  const schedulerEnd = SERVER_SOURCE.indexOf("app.listen(PORT,");
  const schedulerBody = SERVER_SOURCE.slice(schedulerStart, schedulerEnd);
  assert.doesNotMatch(schedulerBody, /\.from\("user_notion_quizzes"\)/, "le driver de pré-génération ne doit jamais créer de progression utilisateur");
});

test("normalizeCustomTopicKey/buildCustomTopicMasterSlot viennent désormais de lib/custom-topic-identity (extraction, jamais deux définitions divergentes)", () => {
  assert.match(SERVER_SOURCE, /const \{ normalizeCustomTopicKey, buildCustomTopicMasterSlot \} = require\("\.\/lib\/custom-topic-identity"\);/);
  assert.doesNotMatch(SERVER_SOURCE, /^function normalizeCustomTopicKey\(topic\)/m, "l'ancienne définition locale doit avoir disparu, jamais coexister avec l'import");
  assert.doesNotMatch(SERVER_SOURCE, /^function buildCustomTopicMasterSlot\(id\)/m);
});
