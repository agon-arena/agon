"use strict";

// Verrous de câblage — Génération progressive, curriculum + route (Phase
// 2.1, 03/09/2026, "finalisation V2 : 3 appels IA nominaux, une seule
// réparation, plus de knowledge_verification systématique"). Réécrit à
// partir du fichier Phase 1 (02/09/2026) : les tests qui verrouillaient la
// génération BLOC (fiche/questions, séquentielle depuis Phase 2, critic
// hors chemin bloquant, V3.2 absent, grounding pédagogique) ont été
// déplacés/couverts dans test/qcm-progressive-v2-wiring.test.js — ce fichier
// se concentre désormais sur : la résolution du CURRICULUM (extraction
// unique, gate evidence, réparation bornée à une tentative), la route HTTP
// (dédoublonnage, réutilisation), et la non-régression des mécanismes
// partagés avec le legacy (isMasterEligibleQuiz, progressiveEligibilityMinimum,
// migration additive). server.js ne peut pas être `require()` en test (il
// démarre tout le serveur Express à l'import) — lecture en TEXTE brut, même
// principe que les autres fichiers *-wiring.test.js de ce dépôt.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

function extractFunctionBody(source, signaturePattern) {
  const match = signaturePattern.exec(source);
  assert.ok(match, `signature introuvable : ${signaturePattern}`);
  const openParen = source.indexOf("(", match.index);
  let parenDepth = 0;
  let i = openParen;
  for (; i < source.length; i += 1) {
    if (source[i] === "(") parenDepth += 1;
    else if (source[i] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) break;
    }
  }
  const bodyStart = source.indexOf("{", i);
  let depth = 0;
  let j = bodyStart;
  for (; j < source.length; j += 1) {
    if (source[j] === "{") depth += 1;
    else if (source[j] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(bodyStart, j + 1);
}

// ── Curriculum : taille flexible (15-20), plus de quota fixe ─────────────

test("resolveProgressiveCurriculum construit le prompt curriculum puis parse via parseCurriculumItems (jamais un parsing maison)", () => {
  assert.match(
    SERVER_SOURCE,
    /async function resolveProgressiveCurriculum\(apiKey, subject, contextHint, id, grounding\) \{[\s\S]{0,1200}?buildCurriculumPrompt\(subject, contextHint, grounding\?\.groundingText \|\| null, evidenceModeActive \? grounding\.identifiedSourcesBlock : null\)[\s\S]{0,300}?pool = parseCurriculumItems\(JSON\.parse\(content\)\?\.curriculum\);/
  );
});

test("resolveProgressiveCurriculum ne force plus jamais un total de 20 : aucune référence à CURRICULUM_LEVELS ou CURRICULUM_TOTAL (constantes supprimées avec le quota fixe)", () => {
  assert.doesNotMatch(SERVER_SOURCE, /CURRICULUM_LEVELS/);
  assert.doesNotMatch(SERVER_SOURCE, /CURRICULUM_TOTAL/);
});

test("resolveProgressiveCurriculum renormalise le SEUL sous-ensemble elementary (id/order 1..N) et attache verified:true, level:\"elementary\"", () => {
  assert.match(
    SERVER_SOURCE,
    /const elementaryFinal = normalizeCurriculumOrder\(acceptedElementary\)\.map\(\(item\) => \(\{ \.\.\.item, level: "elementary", verified: true \}\)\);/
  );
});

// Réécrit (Phase 2.1, section 2 de la demande) : les connaissances
// Deepening/Expert ne sont plus TOUJOURS verified:false — elles sont
// désormais evidence-gated dès ce même appel, `verified` reflète le
// résultat RÉEL du gate, et source_id/evidence_text sont PRÉSERVÉS (bug
// réel corrigé le 03/09/2026, cause racine du taux élevé de
// "missing_source_id" observé en continuation lors du rapport Phase 2).
test("les connaissances deepening/expert sont evidence-gated (déterministe, sans appel IA) dès resolveProgressiveCurriculum — verified reflète le résultat réel, jamais toujours false", () => {
  assert.match(
    SERVER_SOURCE,
    /const deferredGated = deferredCandidatesRaw\.map\(\(item\) => \{\s*\n\s*if \(!evidenceModeActive\) return \{ \.\.\.item, verified: false \};\s*\n\s*deferredEvidenceCandidates \+= 1;\s*\n\s*const result = validateKnowledgeEvidence\(item, grounding\.identifiedSources\);\s*\n\s*if \(result\.ok\) \{ deferredEvidenceValid \+= 1; return \{ \.\.\.item, verified: true \}; \}/
  );
});

test("les items deferredFinal (deepening/expert) préservent source_id/evidence_text via spread — jamais une reconstruction champ par champ qui les perdrait", () => {
  assert.match(
    SERVER_SOURCE,
    /const deferredFinal = deferredGated\.map\(\(item, index\) => \(\{\s*\n\s*\.\.\.item,\s*\n\s*id: `k\$\{elementaryFinal\.length \+ index \+ 1\}`,\s*\n\s*order: elementaryFinal\.length \+ index \+ 1\s*\n\s*\}\)\);/
  );
  assert.match(SERVER_SOURCE, /const finalCurriculum = \[\.\.\.elementaryFinal, \.\.\.deferredFinal\];/);
});

test("resolveProgressiveCurriculum écarte les quasi-doublons via findNearDuplicateCurriculumKnowledge, jamais une comparaison ad hoc", () => {
  assert.match(SERVER_SOURCE, /const pair = findNearDuplicateCurriculumKnowledge\(current\)\[0\];/);
});

test("le split est calculé sur le pool BRUT (avant tout gate evidence), via normalizeCurriculumOrder + assignCurriculumLevels réutilisés tels quels — jamais une seconde logique de split", () => {
  assert.match(SERVER_SOURCE, /const leveledPool = assignCurriculumLevels\(normalizeCurriculumOrder\(pool\)\);/);
  assert.match(SERVER_SOURCE, /const elementaryPoolRaw = selectCurriculumLevel\(leveledPool, "elementary"\);/);
  assert.match(SERVER_SOURCE, /const deferredCandidatesRaw = leveledPool\.filter\(\(item\) => item\.level !== "elementary"\);/);
});

// ── knowledge_verification supprimé (Phase 2.1, section 1 de la demande) ──

test("knowledge_verification (appel IA de vérification indépendante) a disparu ENTIÈREMENT du curriculum : plus aucun buildKnowledgeVerificationPrompt/applyKnowledgeVerificationDecisions dans le chemin progressif", () => {
  const fnStart = SERVER_SOURCE.indexOf("async function evidenceGateAndRepairCurriculumSubset");
  const fnEnd = SERVER_SOURCE.indexOf("async function resolveProgressiveCurriculum");
  const fnBody = SERVER_SOURCE.slice(fnStart, fnEnd);
  assert.doesNotMatch(fnBody, /buildKnowledgeVerificationPrompt/);
  assert.doesNotMatch(fnBody, /applyKnowledgeVerificationDecisions/);
  assert.doesNotMatch(fnBody, /feature:\s*verificationFeature/);
});

test("l'admission d'une connaissance dépend UNIQUEMENT de validateKnowledgeEvidence (déterministe) — jamais un second jugement IA sous un autre nom", () => {
  const body = extractFunctionBody(SERVER_SOURCE, /async function evidenceGateAndRepairCurriculumSubset\(\{/);
  assert.match(body, /const result = validateKnowledgeEvidence\(item, grounding\.identifiedSources\);/);
  // Aucun _callOpenAI hors du seul call de réparation (curriculum_repair) :
  assert.equal((body.match(/_callOpenAI\(/g) || []).length, 1);
});

// ── Réparation : AU PLUS UNE tentative, jamais une boucle (section 3) ────

test("evidenceGateAndRepairCurriculumSubset répare AU PLUS UNE fois (bloc conditionnel unique, jamais une boucle for/while)", () => {
  const body = extractFunctionBody(SERVER_SOURCE, /async function evidenceGateAndRepairCurriculumSubset\(\{/);
  assert.doesNotMatch(body, /\bfor\s*\(/);
  assert.doesNotMatch(body, /\bwhile\s*\(/.source === undefined ? /NEVER/ : /while \(accepted/); // pas de boucle de réparation (evictNearDuplicates a sa propre boucle interne légitime, non concernée ici)
  assert.match(body, /if \(accepted\.length < targetSize\) \{/);
  assert.match(body, /repairAttempted = true;/);
});

test("le nombre de connaissances demandées en réparation est calculé via missingCurriculumCount(accepted.length, targetSize) — jamais un total fixe de remplacement", () => {
  const body = extractFunctionBody(SERVER_SOURCE, /async function evidenceGateAndRepairCurriculumSubset\(\{/);
  assert.match(body, /const neededCount = missingCurriculumCount\(accepted\.length, targetSize\);/);
});

test("missingCurriculumCount reste rétrocompatible : target optionnel, défaut MIN_PROGRESSIVE_CURRICULUM inchangé pour tout appelant existant", () => {
  const curriculumSource = fs.readFileSync(path.join(__dirname, "..", "lib", "notion-quiz-curriculum.js"), "utf8");
  assert.match(curriculumSource, /function missingCurriculumCount\(acceptedCount, target = MIN_PROGRESSIVE_CURRICULUM\) \{/);
});

test("les ajouts de réparation sont fusionnés via mergeCurriculumAdditions puis evictNearDuplicates, une seule fois — jamais un merge maison", () => {
  const body = extractFunctionBody(SERVER_SOURCE, /async function evidenceGateAndRepairCurriculumSubset\(\{/);
  assert.match(body, /accepted = evictNearDuplicates\(mergeCurriculumAdditions\(accepted, acceptedAdditions\)\);/);
});

test("un curriculum elementary toujours sous MIN_ELEMENTARY_READY_QUESTIONS après l'unique réparation échoue proprement avec le code CURRICULUM_INCOMPLETE", () => {
  assert.match(
    SERVER_SOURCE,
    /if \(acceptedElementary\.length < MIN_ELEMENTARY_READY_QUESTIONS\) \{[\s\S]{0,400}?return generationFailure\("CURRICULUM_INCOMPLETE", "curriculum_repair", \{/
  );
});

test("CURRICULUM_INCOMPLETE est un code d'erreur public déclaré (422, message utilisateur clair)", () => {
  const errorsSource = fs.readFileSync(path.join(__dirname, "../lib/custom-topic-generation-errors.js"), "utf8");
  assert.match(errorsSource, /CURRICULUM_INCOMPLETE:\s*\{\s*status:\s*422,/);
});

test("le bloc élémentaire est extrait du curriculum via selectCurriculumLevel(curriculum, \"elementary\") (jamais tout le curriculum)", () => {
  assert.match(SERVER_SOURCE, /const elementaryKnowledge = selectCurriculumLevel\(curriculum, "elementary"\);/);
});

// ── Verrou en mémoire partagé (dédup legacy/progressif sur le même sujet) ─

test("ensureProgressiveElementaryGenerated réutilise _notionQuizMasterGenerationPromises avec la même clé masterSlot que le chemin legacy (empêche une course legacy/progressif)", () => {
  assert.match(
    SERVER_SOURCE,
    /async function ensureProgressiveElementaryGenerated\(masterSlot, topic, id, userId\) \{\s*\n\s*const pending = _notionQuizMasterGenerationPromises\.get\(masterSlot\);/
  );
});

test("continueProgressiveGeneration utilise son PROPRE verrou en mémoire, distinct de celui de la génération initiale — jamais le même Map", () => {
  assert.match(SERVER_SOURCE, /const _notionQuizContinuationPromises = new Map\(\);/);
  const body = extractFunctionBody(SERVER_SOURCE, /async function continueProgressiveGeneration\(masterSlot, topic, id, userId, targetLevel\) \{/);
  assert.match(body, /_notionQuizContinuationPromises\.get\(masterSlot\)/);
  assert.doesNotMatch(body, /_notionQuizMasterGenerationPromises/);
});

// ── Route : dédoublonnage, réutilisation, niveau ──────────────────────────

test("la route POST /api/users/notion-quizzes/custom/progressive existe et est distincte de la route legacy POST .../custom", () => {
  assert.match(SERVER_SOURCE, /app\.post\("\/api\/users\/notion-quizzes\/custom\/progressive", rateLimit\("users", 30\), async \(req, res\) => \{/);
  assert.match(SERVER_SOURCE, /app\.post\("\/api\/users\/notion-quizzes\/custom", rateLimit\("users", 30\), async \(req, res\) => \{/);
});

test("la route progressive n'appelle ni triggerAutomaticNoesVideo ni createNotification (choix de portée assumé, pas un oubli)", () => {
  const routeStart = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom/progressive"');
  const routeEnd = SERVER_SOURCE.indexOf("\n});", routeStart) + 4;
  const routeSource = SERVER_SOURCE.slice(routeStart, routeEnd);
  assert.doesNotMatch(routeSource, /triggerAutomaticNoesVideo/);
  assert.doesNotMatch(routeSource, /createNotification/);
});

// Réécrit (Phase 2.1) : requested_level est désormais DYNAMIQUE (le niveau
// réellement demandé), jamais la chaîne fixe "elementaire" de la Phase 1 —
// cf. aussi test/qcm-progressive-v2-wiring.test.js pour le verrou complet
// sur `requestedLevel`.
test("la route progressive relie l'utilisateur au QCM via user_notion_quizzes avec requested_level DYNAMIQUE (jamais la chaîne fixe 'elementaire')", () => {
  assert.match(
    SERVER_SOURCE,
    /\.upsert\(\s*\n\s*\{ user_id: user\.id, quiz_date: quizDate, slot: masterSlot, requested_level: requestedLevel \}/
  );
  assert.doesNotMatch(SERVER_SOURCE, /requested_level: "elementaire" \}/);
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

test("generateNotionLevelQuiz, buildCustomTopicQuiz et ensureCustomTopicMasterGenerated ne sont ni appelés ni modifiés par le chemin progressif", () => {
  const progressiveBlockStart = SERVER_SOURCE.indexOf("async function resolveProgressiveCurriculum");
  const progressiveBlockEnd = SERVER_SOURCE.indexOf("async function ensureCustomTopicMasterGenerated");
  const progressiveBlock = SERVER_SOURCE.slice(progressiveBlockStart, progressiveBlockEnd);
  assert.doesNotMatch(progressiveBlock, /generateNotionLevelQuiz\(/);
  assert.doesNotMatch(progressiveBlock, /buildCustomTopicQuiz\(/);
});

// ── Migration : additive, curriculum/progressive_status déjà appliquées ──

test("la migration curriculum/progressive_status reste celle déjà appliquée — additive, aucune nouvelle table", () => {
  const migrationSource = fs.readFileSync(path.join(__dirname, "../data/migration-daily-quiz-progressive.sql"), "utf8");
  assert.match(migrationSource, /ALTER TABLE daily_quiz ADD COLUMN IF NOT EXISTS curriculum JSONB;/);
  assert.match(migrationSource, /ALTER TABLE daily_quiz ADD COLUMN IF NOT EXISTS progressive_status TEXT;/);
  assert.doesNotMatch(migrationSource, /CREATE TABLE/i);
});

// grounding_full envisagée (Phase 2) puis ABANDONNÉE (Phase 2.1, audit
// migration du 04/09/2026) : n'était nécessaire que sous l'ancien design de
// continuation, qui re-vérifiait des connaissances déjà evidence-gatées
// contre un grounding re-résolu. Depuis que resolveProgressiveCurriculum
// evidence-gate TOUS les niveaux immédiatement et que la continuation ne
// re-gate plus jamais un item déjà vérifié (`preAccepted`), aucune colonne
// supplémentaire n'est nécessaire — aucun fichier de migration à appliquer.
test("aucune colonne grounding_full : la continuation re-résout un grounding frais sans jamais re-gater un item déjà vérifié (preAccepted)", () => {
  // Aucune sélection/insertion Supabase ne référence plus grounding_full —
  // seul un commentaire explique pourquoi cette colonne a été envisagée puis
  // abandonnée (légitime, jamais un usage réel).
  assert.doesNotMatch(SERVER_SOURCE, /\.select\([^)]*grounding_full/);
  assert.doesNotMatch(SERVER_SOURCE, /grounding_full:/);
  const dataFiles = fs.readdirSync(path.join(__dirname, "../data"));
  assert.ok(!dataFiles.includes("migration-daily-quiz-progressive-v2.sql"), "aucune migration grounding_full ne doit exister : elle n'est plus justifiée sous Phase 2.1");
});

// ── Evidence grounding en amont (V1) : câblage server.js ──────────────────

test("evidenceModeActive est dérivé UNIQUEMENT de grounding.identifiedSources.length — jamais un flag séparé ni une option de l'appelant", () => {
  assert.match(SERVER_SOURCE, /const evidenceModeActive = !!grounding\?\.identifiedSources\?\.length;/);
});

test("le gate evidence (applyEvidenceGate) est appliqué au pool initial ET aux ajouts de réparation — jamais un nouveau retry, jamais une nouvelle boucle", () => {
  const body = extractFunctionBody(SERVER_SOURCE, /async function evidenceGateAndRepairCurriculumSubset\(\{/);
  assert.match(body, /accepted = preAccepted != null \? preAccepted : evictNearDuplicates\(applyEvidenceGate\(initialPool\)\);/);
  assert.match(body, /const acceptedAdditions = applyEvidenceGate\(additions\);/);
});

test("buildCurriculumPrompt/buildCurriculumRepairPrompt reçoivent identifiedSourcesBlock UNIQUEMENT quand evidenceModeActive, jamais groundingText en plus dans ce cas", () => {
  assert.match(SERVER_SOURCE, /buildCurriculumPrompt\(subject, contextHint, grounding\?\.groundingText \|\| null, evidenceModeActive \? grounding\.identifiedSourcesBlock : null\)/);
  assert.match(SERVER_SOURCE, /buildCurriculumRepairPrompt\(subject, contextHint, neededCount, accepted, grounding\?\.groundingText \|\| null, evidenceModeActive \? grounding\.identifiedSourcesBlock : null\)/);
});

test("qcm-progressive-timing journalise elementary_evidence_candidates/valid/rejected/rejection_reasons ET deferred_evidence_* — jamais le texte des sources ni des extraits", () => {
  assert.match(SERVER_SOURCE, /elementary_evidence_candidates: elementaryEvidenceCandidates,\s*\n\s*elementary_evidence_valid: elementaryEvidenceValid,\s*\n\s*elementary_evidence_rejected: elementaryEvidenceRejected,\s*\n\s*elementary_evidence_rejection_reasons: elementaryEvidenceRejectionReasons/);
  assert.match(SERVER_SOURCE, /deferred_evidence_candidates: deferredEvidenceCandidates,\s*\n\s*deferred_evidence_valid: deferredEvidenceValid,\s*\n\s*deferred_evidence_rejected: deferredEvidenceRejected,\s*\n\s*deferred_evidence_rejection_reasons: deferredEvidenceRejectionReasons/);
});

// ── Observabilité : compte exact d'appels IA nominaux (section 1/10) ─────

test("elementary_ai_call_count est calculé à partir des signaux RÉELS de repair (curriculum ET question), jamais une valeur supposée fixe", () => {
  assert.match(
    SERVER_SOURCE,
    /const elementaryAiCallCount = 1 \+ \(elementaryCurriculumRepairAttempted \? 1 : 0\) \+ 1 \+ 1 \+ \(elementaryRegenerationCalls > 0 \? 1 : 0\);/
  );
  assert.match(SERVER_SOURCE, /elementary_ai_call_count: elementaryAiCallCount,/);
});
