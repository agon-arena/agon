"use strict";

// Verrous de câblage — Génération progressive PHASE 2 (03/09/2026,
// "terminer et simplifier le pipeline progressif QCM"). Même principe que
// test/qcm-progressive-elementary-wiring.test.js (Phase 1) : server.js ne
// peut pas être `require()` en test (il démarre tout le serveur Express à
// l'import) — ce fichier vérifie donc, en lisant server.js/les libs comme du
// TEXTE brut (jamais exécuté), que le câblage V2 attendu est bien en place.
//
// IMPORTANT : test/qcm-progressive-elementary-wiring.test.js (Phase 1) et
// plusieurs assertions de test/notion-quiz-curriculum.test.js /
// test/qcm-progressive-ui-wiring.test.js verrouillaient délibérément le
// contrat Phase 1 (fiche/questions en parallèle, V3.2 systématique,
// deepening/expert non implémentés, route progressive ignorant `level`) —
// ce chantier V2 change intentionnellement CHACUN de ces points sur demande
// explicite, donc CES tests échouent désormais et doivent être considérés
// comme un contrat SUPERSEDÉ, pas une régression. Une passe de mise à jour
// complète de ces fichiers est recommandée avant merge (cf. rapport final,
// section RISQUES) mais hors budget de ce chantier — ce fichier verrouille
// à la place les invariants du NOUVEAU contrat.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const QCM_FRONTEND_SOURCE = fs.readFileSync(path.join(__dirname, "../views/qcm-du-jour.html"), "utf8");

// Repère la fin de la LISTE DE PARAMÈTRES (parenthèses équilibrées, y
// compris déstructuration/valeurs par défaut avec accolades imbriquées),
// puis extrait le corps de fonction par équilibrage d'accolades à partir de
// la PREMIÈRE accolade suivant cette parenthèse fermante — jamais la
// première accolade après la signature (qui, pour une déstructuration
// `function f({ a, b }) {`, serait à tort celle des paramètres).
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

// ── Chemin nominal Elementary : critic hors chemin bloquant, une seule réparation ──

test("generateProgressiveLevelBlock appelle qualityControlRawQuestions avec semanticReviewEnabled:false et maxRetries:1 (critic hors chemin bloquant, une seule réparation ciblée)", () => {
  const body = extractFunctionBody(SERVER_SOURCE, /async function generateProgressiveLevelBlock\(\{/);
  assert.match(body, /qualityControlRawQuestions\(\{[\s\S]*?semanticReviewEnabled:\s*false/);
  assert.match(body, /qualityControlRawQuestions\(\{[\s\S]*?maxRetries:\s*1\b/);
});

test("generateProgressiveLevelBlock n'appelle JAMAIS expandGroundingAndRegenerateMissingQuestions (V3.2 retiré du chemin nominal progressif)", () => {
  const body = extractFunctionBody(SERVER_SOURCE, /async function generateProgressiveLevelBlock\(\{/);
  assert.doesNotMatch(body, /expandGroundingAndRegenerateMissingQuestions/);
});

test("generateProgressiveLevelBlock rédige la fiche AVANT de générer les questions (séquentiel, jamais deux tâches lancées en parallèle avant tout await)", () => {
  const body = extractFunctionBody(SERVER_SOURCE, /async function generateProgressiveLevelBlock\(\{/);
  const ficheCallIndex = body.search(/feature:\s*`\$\{questionFeaturePrefix\}_fiche_generation`/);
  const questionCallIndex = body.search(/feature:\s*`\$\{questionFeaturePrefix\}_question_generation`/);
  assert.ok(ficheCallIndex > 0 && questionCallIndex > 0);
  assert.ok(ficheCallIndex < questionCallIndex, "la fiche doit être générée avant les questions dans le texte source (ordre d'exécution séquentiel)");
  // Aucun `Promise` en attente parallèle (ancien pattern ficheTask/questionsTask du bloc élémentaire Phase 1) :
  assert.doesNotMatch(body, /const ficheTask = \(async/);
  assert.doesNotMatch(body, /const questionsTask = \(async/);
});

test("le prompt de questions reçoit le paragraphe réellement rédigé (buildQuestionsFromKnowledgePrompt appelé avec paragraphText en 7e argument)", () => {
  const body = extractFunctionBody(SERVER_SOURCE, /async function generateProgressiveLevelBlock\(\{/);
  assert.match(body, /buildQuestionsFromKnowledgePrompt\("sourceId", id, admittedKnowledge, levelConfig\.instruction, formatBlock, initialCandidateCounts, paragraphText\)/);
});

test("le grounding pédagogique déterministe (validateParagraphGrounding) filtre les questions APRÈS le contrôle qualité, jamais un second appel IA", () => {
  const body = extractFunctionBody(SERVER_SOURCE, /async function generateProgressiveLevelBlock\(\{/);
  assert.match(body, /validateParagraphGrounding\(q, paragraphText\)/);
});

test("le seuil de disponibilité autorise un état DÉGRADÉ (1..seuil-1 questions servies) plutôt qu'un échec sec — seul 0 question valide échoue", () => {
  const body = extractFunctionBody(SERVER_SOURCE, /async function generateProgressiveLevelBlock\(\{/);
  assert.match(body, /if \(!validated\.length\)/);
  assert.match(body, /const degraded = validated\.length < blockReadyThreshold;/);
});

// ── Deepening / Expert : blocs réellement implémentés ──────────────────────

test("generateDeepeningBlock et generateExpertBlock existent et délèguent à generateProgressiveLevelBlock (jamais une logique dupliquée)", () => {
  assert.match(SERVER_SOURCE, /async function generateDeepeningBlock\(apiKey, subject, contextHint, id, deepeningKnowledge, grounding, priorSectionsText\) \{\s*return generateProgressiveLevelBlock\(/);
  assert.match(SERVER_SOURCE, /async function generateExpertBlock\(apiKey, subject, contextHint, id, expertKnowledge, grounding, priorSectionsText\) \{\s*return generateProgressiveLevelBlock\(/);
});

test("la fiche de continuation (Deepening/Expert) reçoit le texte déjà écrit pour COMPLÉTER, jamais le réécrire (buildProgressiveContinuationFichePrompt)", () => {
  assert.match(SERVER_SOURCE, /buildProgressiveContinuationFichePrompt\(s, c, k, lc, gt, priorSectionsText, "Approfondi"\)/);
  assert.match(SERVER_SOURCE, /buildProgressiveContinuationFichePrompt\(s, c, k, lc, gt, priorSectionsText, "Expert"\)/);
});

// ── Continuation orchestrator ──────────────────────────────────────────────

test("continueProgressiveGeneration existe, utilise son PROPRE verrou en mémoire (jamais le même Map que la génération initiale), et ne dépasse jamais targetLevel", () => {
  assert.match(SERVER_SOURCE, /const _notionQuizContinuationPromises = new Map\(\);/);
  const body = extractFunctionBody(SERVER_SOURCE, /async function continueProgressiveGeneration\(masterSlot, topic, id, userId, targetLevel\) \{/);
  assert.match(body, /_notionQuizContinuationPromises\.get\(masterSlot\)/);
  assert.match(body, /if \(currentRank >= targetRank\)/);
});

test("continueProgressiveGeneration persiste progressive_status='deepening_ready' puis 'ready', jamais un autre nom", () => {
  assert.match(SERVER_SOURCE, /PROGRESSIVE_STATUS_FOR_QUIZ_LEVEL = \{ elementaire: "elementary_ready", avance: "deepening_ready", expert: "ready" \};/);
});

// Réécrit (correctif egress du 04/09/2026, "sourceDetail dupliqué sur
// CHAQUE question ×20+ dans la même ligne daily_quiz", cf. rapport
// diagnostic egress) : la fiche complète (mergedSourceDetail, sections
// grandissantes) n'est plus réécrite QUE sur la question d'indice 0 — seule
// porteuse durable, cf. slimSourceDetailForDuplicateQuestion/
// findCanonicalSourceDetail. Les autres questions déjà persistées gardent
// une version allégée (image uniquement). L'INVARIANT métier reste
// inchangé : la fiche affichée (GET .../fiche, via findCanonicalSourceDetail)
// est toujours la concaténation de tous les blocs — seul le SUPPORT de
// stockage change, jamais le contenu servi.
test("continueProgressiveGeneration ne réécrit la fiche complète (mergedSourceDetail) QUE sur la question d'indice 0 — les autres gardent une version allégée (image uniquement)", () => {
  const body = extractFunctionBody(SERVER_SOURCE, /async function continueProgressiveGeneration\(masterSlot, topic, id, userId, targetLevel\) \{/);
  assert.match(body, /currentQuestions\.map\(\(q, index\) => \(\{\s*\n\s*\.\.\.q,\s*\n\s*sourceDetail: index === 0 \? mergedSourceDetail : slimSourceDetailForDuplicateQuestion\(mergedSourceDetail\)\s*\n\s*\}\)\)/);
  assert.match(body, /sourceDetail: slimSourceDetailForDuplicateQuestion\(mergedSourceDetail\)/);
  assert.doesNotMatch(body, /currentQuestions\.map\(\(q\) => \(\{ \.\.\.q, sourceDetail: mergedSourceDetail \}\)\)/);
});

test("slimSourceDetailForDuplicateQuestion ne garde que l'image (jamais sections/meta, le vrai poids) — findCanonicalSourceDetail retrouve la fiche complète sans supposer sa position", () => {
  assert.match(SERVER_SOURCE, /function slimSourceDetailForDuplicateQuestion\(sourceDetail\) \{\s*\n\s*return sourceDetail\?\.image \? \{ image: sourceDetail\.image \} : null;\s*\n\}/);
  assert.match(SERVER_SOURCE, /function findCanonicalSourceDetail\(rawQuestions\) \{\s*\n\s*return \(Array\.isArray\(rawQuestions\) \? rawQuestions : \[\]\)\.find\(\(q\) => q\?\.sourceDetail\?\.sections\?\.length\)\?\.sourceDetail \|\| null;\s*\n\}/);
});

test("ensureProgressiveElementaryGenerated applique la même règle dès la toute première écriture : seule la question d'indice 0 garde la fiche complète", () => {
  assert.match(
    SERVER_SOURCE,
    /sourceDetail: index === 0 \? sourceDetail : slimSourceDetailForDuplicateQuestion\(sourceDetail\),/
  );
});

test("GET .../fiche retrouve la fiche complète via findCanonicalSourceDetail sur le tableau BRUT, jamais en supposant que questions[0] la porte après le tri par pedagogicalRank", () => {
  assert.match(SERVER_SOURCE, /const canonicalSourceDetail = findCanonicalSourceDetail\(questions\);/);
  assert.match(SERVER_SOURCE, /const fullSourceDetail = canonicalSourceDetail \|\| first\.sourceDetail \|\| null;/);
});

test("un échec de vérification/génération d'un niveau interrompt proprement la continuation (break), jamais une boucle ou un retry supplémentaire", () => {
  const body = extractFunctionBody(SERVER_SOURCE, /async function continueProgressiveGeneration\(masterSlot, topic, id, userId, targetLevel\) \{/);
  const breakCount = (body.match(/\bbreak;/g) || []).length;
  assert.ok(breakCount >= 2, "au moins un point de sortie propre par cause d'échec (curriculum vide, 0 vérifié, génération échouée, persistance échouée)");
});

// ── Route HTTP : Phase 3 (06/09/2026, "le niveau choisi ne doit plus
// déterminer le niveau servi") — `req.body.level` (picker) n'a plus d'effet
// sur le niveau SERVI (userLevel dérive uniquement de la progression déjà
// connue pour CET utilisateur, existingUserLinkRows, jamais du clic). Les
// tests Phase 1/2 qui verrouillaient l'ancien contrat (`requestedLevel`
// clique -> continuation synchrone -> requested_level) sont ici SUPERSÉDÉS,
// pas régressés — cf. rapport final du chantier "démarrage toujours
// Élémentaire". Chantier "rétablir un vrai choix utilisateur" (07/09/2026) :
// `req.body.level` est de nouveau lu, mais uniquement pour calculer
// `targetLevel` (plafond de progression personnelle, jamais le niveau
// servi) — cf. tests dédiés ci-dessous.

test("POST /custom/progressive dérive userLevel de la progression DÉJÀ CONNUE de l'utilisateur, jamais du niveau cliqué — 'elementaire' par défaut pour un nouveau parcours", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom/progressive"');
  assert.ok(routeIndex > 0);
  const routeBody = SERVER_SOURCE.slice(routeIndex, routeIndex + 10500);
  assert.match(routeBody, /const existingUserLevel = existingUserLink\s*\n\s*\? resolveNotionQuizLevel\(existingUserLink\.requested_level\)\.level\s*\n\s*: null;/);
  assert.match(routeBody, /const userLevel = existingUserLevel \|\| "elementaire";/);
});

test("POST /custom/progressive lit désormais req.body.level via resolveNotionQuizLevel (validation stricte) pour calculer targetLevel — jamais pour userLevel", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom/progressive"');
  const routeBody = SERVER_SOURCE.slice(routeIndex, routeIndex + 10500);
  assert.match(routeBody, /const pickedLevel = resolveNotionQuizLevel\(req\.body\?\.level\)\.level \|\| "elementaire";/, "le niveau cliqué doit être validé via la même whitelist que le reste du pipeline (elementaire/avance/expert), jamais une valeur cliente brute");
  assert.match(routeBody, /const targetLevel = resolveTargetLevelOnRequest\(existingTargetLevel, pickedLevel\);/);
  assert.doesNotMatch(routeBody, /const userLevel = .*pickedLevel/, "pickedLevel ne doit jamais déterminer userLevel (niveau servi)");
});

test("POST /custom/progressive ne contient plus aucune continuation SYNCHRONE avant la réponse initiale (jamais un await continueProgressiveGeneration avant res.json)", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom/progressive"');
  assert.ok(routeIndex > 0);
  const routeBody = SERVER_SOURCE.slice(routeIndex, routeIndex + 10500);
  const resIndex = routeBody.indexOf("res.json({");
  assert.ok(resIndex > 0);
  const beforeResponse = routeBody.slice(0, resIndex);
  assert.doesNotMatch(beforeResponse, /await continueProgressiveGeneration/, "aucune continuation ne doit être attendue avant l'ouverture du premier QCM, quel que soit userLevel ou targetLevel");
});

test("POST /custom/progressive déclenche la continuation vers 'expert' en ARRIÈRE-PLAN après avoir répondu (jamais avant, jamais awaité) — une SEULE continuation logique, toujours vers \"expert\" quel que soit targetLevel", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom/progressive"');
  const routeBody = SERVER_SOURCE.slice(routeIndex, routeIndex + 11000);
  const resIndex = routeBody.indexOf("res.json({");
  const bgIndex = routeBody.indexOf('continueProgressiveGeneration(masterSlot, topic, id, user.id, "expert")');
  assert.ok(resIndex > 0 && bgIndex > 0);
  assert.ok(bgIndex > resIndex, "la continuation vers expert doit être déclenchée APRÈS res.json (arrière-plan)");
  assert.match(routeBody.slice(bgIndex, bgIndex + 200), /\.catch\(/, "fire-and-forget : jamais awaité par la route");
  const otherContinuationCalls = [...routeBody.matchAll(/continueProgressiveGeneration\(masterSlot, topic, id, user\.id,/g)];
  assert.equal(otherContinuationCalls.length, 1, "une seule continuation logique doit rester dans cette route (vers \"expert\"), jamais une seconde vers userLevel ou targetLevel — le master vise toujours Expert quel que soit le plafond personnel de l'utilisateur");
});

test("POST /custom/progressive enregistre requested_level = userLevel ET target_level = targetLevel (deux concepts distincts, jamais le niveau cliqué dans requested_level)", () => {
  const routeIndex = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom/progressive"');
  const routeBody = SERVER_SOURCE.slice(routeIndex, routeIndex + 10500);
  assert.match(routeBody, /requested_level:\s*userLevel,\s*target_level:\s*targetLevel/);
  assert.doesNotMatch(routeBody, /requested_level:\s*(pickedLevel|targetLevel)\b/, "requested_level (currentLevel) ne doit jamais recevoir le niveau cliqué ni le targetLevel");
});

test("le frontend qcm-du-jour.html route TOUJOURS vers /custom/progressive, quel que soit le niveau choisi (plus de bascule vers /custom legacy)", () => {
  assert.match(QCM_FRONTEND_SOURCE, /var creationEndpoint = '\/api\/users\/notion-quizzes\/custom\/progressive';/);
});

// ── qualityControlRawQuestions : surcharge par appel, sans régression legacy ──

test("qualityControlRawQuestions accepte semanticReviewEnabled/maxRetries en paramètres optionnels, par défaut EXACTEMENT les constantes globales (comportement legacy inchangé)", () => {
  const idx = SERVER_SOURCE.indexOf("async function qualityControlRawQuestions({");
  assert.ok(idx > 0);
  const header = SERVER_SOURCE.slice(idx, idx + 5000);
  assert.match(header, /semanticReviewEnabled = QCM_SEMANTIC_REVIEW_ENABLED,/);
  assert.match(header, /maxRetries = QCM_SEMANTIC_REVIEW_MAX_RETRIES/);
});

// ── Shadow critic : jamais bloquant ─────────────────────────────────────────

test("runShadowSemanticReview n'est jamais awaité par ses appelants (fire-and-forget strict)", () => {
  const occurrences = [...SERVER_SOURCE.matchAll(/runShadowSemanticReview\(\{/g)];
  assert.ok(occurrences.length >= 2, "attendu : au moins un appel dans ensureProgressiveElementaryGenerated et un dans continueProgressiveGeneration");
  for (const occ of occurrences) {
    const before = SERVER_SOURCE.slice(Math.max(0, occ.index - 20), occ.index);
    assert.doesNotMatch(before, /await\s*$/, "runShadowSemanticReview ne doit jamais être précédé de `await`");
  }
});

test("runShadowSemanticReview est désactivable via QCM_PROGRESSIVE_SHADOW_CRITIC_ENABLED et ne modifie jamais les questions déjà servies", () => {
  const idx = SERVER_SOURCE.indexOf("function runShadowSemanticReview({");
  assert.ok(idx > 0);
  const body = extractFunctionBody(SERVER_SOURCE, /function runShadowSemanticReview\(\{/);
  assert.match(body, /if \(!QCM_PROGRESSIVE_SHADOW_CRITIC_ENABLED/);
  assert.doesNotMatch(body, /\bvalidated\s*=/, "le shadow critic ne doit jamais réassigner/filtrer la liste de questions servies");
});

// ── Modèles distincts par rôle (section 16) ────────────────────────────────

test("les modèles curriculum/paragraphe/questions sont des configurations distinctes, chacune par défaut EXACTEMENT DAILY_QUIZ_NARRATIVE_MODEL (aucun changement de modèle actif par défaut)", () => {
  assert.match(SERVER_SOURCE, /const DAILY_QUIZ_CURRICULUM_MODEL = process\.env\.OPENAI_DAILY_QUIZ_CURRICULUM_MODEL \|\| DAILY_QUIZ_NARRATIVE_MODEL;/);
  assert.match(SERVER_SOURCE, /const DAILY_QUIZ_PARAGRAPH_MODEL = process\.env\.OPENAI_DAILY_QUIZ_PARAGRAPH_MODEL \|\| DAILY_QUIZ_NARRATIVE_MODEL;/);
  assert.match(SERVER_SOURCE, /const DAILY_QUIZ_QUESTION_MODEL = process\.env\.OPENAI_DAILY_QUIZ_QUESTION_MODEL \|\| DAILY_QUIZ_NARRATIVE_MODEL;/);
});

test("le pipeline legacy (generateNotionLevelQuiz) n'utilise JAMAIS les nouveaux modèles par rôle — reste sur DAILY_QUIZ_NARRATIVE_MODEL partout, strictement inchangé", () => {
  const idx = SERVER_SOURCE.indexOf("async function generateNotionLevelQuiz(");
  assert.ok(idx > 0);
  const body = extractFunctionBody(SERVER_SOURCE, /async function generateNotionLevelQuiz\(apiKey, subject, contextHint, id, levelConfig, requireValidation, requestedLevel, classificationContext = null\) \{/);
  assert.doesNotMatch(body, /DAILY_QUIZ_CURRICULUM_MODEL/);
  assert.doesNotMatch(body, /DAILY_QUIZ_PARAGRAPH_MODEL/);
  assert.doesNotMatch(body, /DAILY_QUIZ_QUESTION_MODEL/);
});

// ── Grounding pédagogique (lib) ─────────────────────────────────────────────

test("validateParagraphGrounding est déterministe (containment lexical), jamais un second appel IA, et permissif quand le paragraphe est absent", () => {
  const libSource = fs.readFileSync(path.join(__dirname, "../lib/question-grounding-validation.js"), "utf8");
  assert.match(libSource, /function validateParagraphGrounding\(question, paragraphText\) \{/);
  assert.doesNotMatch(
    extractFunctionBody(libSource, /function validateParagraphGrounding\(question, paragraphText\) \{/),
    /_callOpenAI|fetch\(/
  );
});

// ── Fiche : sections scopées au niveau réellement servi (item 8, audit réel
// du 04/09/2026 — la fiche Élémentaire d'un master déjà "ready" affichait à
// tort les sections Approfondi/Expert) ────────────────────────────────────

test("generateProgressiveLevelBlock tague chaque section de sourceDetail avec son propre niveau (levelKey) — jamais laissé sans marqueur", () => {
  const body = extractFunctionBody(SERVER_SOURCE, /async function generateProgressiveLevelBlock\(\{/);
  // Phase 2.4 (04/09/2026) : le .map() pose aussi `highlights` (filtrés aux
  // ids de levelKnowledge, cf. test/qcm-fiche-highlights-wiring.test.js) —
  // `level: levelKey` reste posé sur CHAQUE section, comportement inchangé.
  assert.match(body, /sourceDetail\.sections = \(sourceDetail\.sections \|\| \[\]\)\.map\(\(s\) => \(\{\s*\n\s*\.\.\.s,\s*\n\s*level: levelKey,/);
});

// `fullSourceDetail` (correctif egress du 04/09/2026, cf.
// findCanonicalSourceDetail) a remplacé `first.sourceDetail` comme base de
// ce filtre — même filtrage, la fiche complète n'étant plus forcément
// portée par `first` depuis que sourceDetail n'est plus dupliqué sur chaque
// question (cf. slimSourceDetailForDuplicateQuestion).
test("GET .../fiche filtre sourceDetail.sections au niveau demandé (cumulatif jusqu'à effectiveLevel) — sections sans `level` (legacy) jamais filtrées, effectiveLevel non reconnu = aucun filtrage (repli sûr)", () => {
  const idx = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/fiche"');
  assert.ok(idx > 0);
  const routeBody = SERVER_SOURCE.slice(idx, idx + 10000);
  assert.match(routeBody, /const effectiveLevelRank = progressiveLevelRank\(effectiveLevel\);/);
  assert.match(routeBody, /const fullSourceDetail = canonicalSourceDetail \|\| first\.sourceDetail \|\| null;/);
  assert.match(routeBody, /sections: effectiveLevelRank < 0\s*\n\s*\? fullSourceDetail\.sections\s*\n\s*: \(fullSourceDetail\.sections \|\| \[\]\)\.filter\(\(s\) => !s\.level \|\| progressiveLevelRank\(s\.level\) <= effectiveLevelRank\)/);
});

// ── GROUNDING_ANSWER_NOT_IN_CLAIM : correctif ciblé (diagnostic réel du
// 04/09/2026, "Grande Muraille de Chine") ─────────────────────────────────

test("qualityControlRawQuestions construit hasEvidenceOverride depuis evidenceByKnowledgeTarget et le transmet à runQuestionQualityPipeline — no-op strict (undefined) quand la Map est vide/absente (legacy inchangé)", () => {
  const body = extractFunctionBody(SERVER_SOURCE, /async function qualityControlRawQuestions\(\{/);
  assert.match(body, /const hasEvidenceOverride = evidenceByKnowledgeTarget && evidenceByKnowledgeTarget\.size\s*\n\s*\? \(question\) => evidenceByKnowledgeTarget\.has\(normalizeFactText\(question\?\.knowledgeTarget\)\)\s*\n\s*: undefined;/);
  assert.match(body, /hasEvidenceOverride,/);
});

test("runQuestionQualityPipeline ne saute answerAlignmentCheck QUE pour les questions dont hasEvidenceOverride(question) est vrai — jamais un assouplissement global de validateQuestionGrounding", () => {
  const qualitySource = fs.readFileSync(path.join(__dirname, "../lib/qcm-quality.js"), "utf8");
  assert.match(qualitySource, /const skipAnswerAlignmentCheck = typeof options\.hasEvidenceOverride === "function" && options\.hasEvidenceOverride\(decision\.question\);/);
  assert.match(qualitySource, /validateQuestionGrounding\(decision\.question, options\.groundingSources, \{ skipAnswerAlignmentCheck \}\)/);
});

test("validateQuestionGrounding : skipAnswerAlignmentCheck saute UNIQUEMENT la boucle réponse-vs-claim, jamais les contrôles claim-vs-source (missing_supporting_claim/unknown_source/claim_not_grounded_in_source)", () => {
  const groundingSource = fs.readFileSync(path.join(__dirname, "../lib/question-grounding-validation.js"), "utf8");
  const body = extractFunctionBody(groundingSource, /function validateQuestionGrounding\(question, sourcesById, options = \{\}\) \{/);
  const skipIndex = body.indexOf("if (options.skipAnswerAlignmentCheck)");
  const sourceCheckIndex = body.indexOf("claim_not_grounded_in_source");
  assert.ok(skipIndex > 0 && sourceCheckIndex > 0 && sourceCheckIndex < skipIndex, "les contrôles claim-vs-source doivent tous s'exécuter AVANT le point de sortie skipAnswerAlignmentCheck");
});
