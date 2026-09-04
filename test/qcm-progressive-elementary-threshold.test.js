"use strict";

// Qualité > quantité (03/09/2026, audit réel "Bouddhisme tibétain" —
// generation_id ea37476cf5f32bb6, 3/5 questions validées ayant fait échouer
// tout le bloc élémentaire malgré 14/15 sur le master legacy équivalent).
// Ce fichier verrouille exactement les scénarios A-J demandés : le bloc
// élémentaire devient `elementary_ready` dès MIN_ELEMENTARY_READY_QUESTIONS
// (4) questions RÉELLEMENT validées, jamais besoin d'une question par
// connaissance elementary du curriculum (4 ou 5 selon sa taille).
//
// Ne reteste jamais en détail ce qui est déjà couvert ailleurs :
// - le split curriculum 25/25/50 et le plancher de 4 par petit niveau :
//   test/notion-quiz-curriculum.test.js (computeCurriculumSplit) ;
// - le comportement exact d'earlyStopAtAccepted dans runQuestionQuality
//   Pipeline (arrêt de boucle, aucune régénération inutile, aucune question
//   rejetée jamais comptée) : test/qcm-quality.test.js ;
// - le câblage server.js (elementaryReadyThreshold, earlyStopAtAccepted,
//   instrumentation) : test/qcm-progressive-elementary-wiring.test.js ;
// - le câblage isMasterEligibleQuiz/progressiveEligibilityMinimum :
//   test/question-formats.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { isMasterEligibleQuiz, MIN_ELEMENTARY_READY_QUESTIONS } = require("../lib/question-formats");
const { computeCurriculumSplit, MIN_LEVEL_SIZE } = require("../lib/notion-quiz-curriculum");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const VIEW_SOURCE = fs.readFileSync(path.join(__dirname, "..", "views", "qcm-du-jour.html"), "utf8");

function curriculumWithElementaryCount(elementaryCount) {
  const items = [];
  for (let i = 0; i < elementaryCount; i += 1) items.push({ level: "elementary" });
  return items;
}

function rankedQuestions(count) {
  return Array.from({ length: count }, (_, i) => ({ pedagogicalRank: i + 1 }));
}

// ── A-E : matrice exacte demandée ──────────────────────────────────────

test("A. 5 connaissances elementary, 5 questions validées -> elementary_ready", () => {
  const curriculum = curriculumWithElementaryCount(5);
  assert.equal(isMasterEligibleQuiz(rankedQuestions(5), { progressiveStatus: "elementary_ready", curriculum }), true);
});

test("B. 5 connaissances elementary, 4 questions validées -> elementary_ready", () => {
  const curriculum = curriculumWithElementaryCount(5);
  assert.equal(isMasterEligibleQuiz(rankedQuestions(4), { progressiveStatus: "elementary_ready", curriculum }), true);
});

test("C. 5 connaissances elementary, 3 questions validées -> PAS elementary_ready", () => {
  const curriculum = curriculumWithElementaryCount(5);
  assert.equal(isMasterEligibleQuiz(rankedQuestions(3), { progressiveStatus: "elementary_ready", curriculum }), false);
});

test("D. 4 connaissances elementary, 4 questions validées -> elementary_ready", () => {
  const curriculum = curriculumWithElementaryCount(4);
  assert.equal(isMasterEligibleQuiz(rankedQuestions(4), { progressiveStatus: "elementary_ready", curriculum }), true);
});

test("E. 4 connaissances elementary, 3 questions validées -> PAS elementary_ready", () => {
  const curriculum = curriculumWithElementaryCount(4);
  assert.equal(isMasterEligibleQuiz(rankedQuestions(3), { progressiveStatus: "elementary_ready", curriculum }), false);
});

// ── Cas réel "Bouddhisme tibétain" (3/5) : ne devient jamais un succès ───

test("le cas réel 3/5 (\"Bouddhisme tibétain\") reste PAS ready même avec le nouveau seuil — MIN_ELEMENTARY_READY_QUESTIONS ne descend jamais à 3", () => {
  assert.equal(MIN_ELEMENTARY_READY_QUESTIONS, 4);
  const curriculum = curriculumWithElementaryCount(5);
  assert.equal(isMasterEligibleQuiz(rankedQuestions(3), { progressiveStatus: "elementary_ready", curriculum }), false);
});

// ── F. une question rejetée n'est jamais comptée pour atteindre 4 ────────
// (comportement exact déjà vérifié en détail — mock reviewSemantic réel —
// dans test/qcm-quality.test.js "earlyStopAtAccepted : arrête la boucle...".
// Ici on verrouille seulement que le SEUIL lui-même (isMasterEligibleQuiz)
// ne peut jamais être satisfait par un nombre de `questions` supérieur à ce
// que `validated` a réellement produit côté serveur : cf. wiring ci-dessous.)

// Réécrit (Phase 2.1, section 9 de la demande) : le gate n'est plus un échec
// sec en dessous du seuil — 0 valide échoue, 1..(seuil-1) est servi DÉGRADÉ
// (jamais un critère de validation assoupli, seulement moins de couverture).
// `validated` provient toujours de la même chaîne qualité, avec en plus le
// filtre grounding pédagogique (paragraphGrounded) avant consolidation.
test("F. le gate serveur compare validated.length (jamais rawQuestions/generated) à blockReadyThreshold — 0 valide échoue, sinon servi (dégradé si < seuil)", () => {
  assert.match(SERVER_SOURCE, /if \(!validated\.length\) \{/);
  assert.match(SERVER_SOURCE, /const degraded = validated\.length < blockReadyThreshold;/);
  // validated provient de la chaîne qualité (qualityControlRawQuestions ->
  // filterQuestionsToAdmittedKnowledge -> filterVariantsByKnowledgeConstraints
  // -> grounding pédagogique (validateParagraphGrounding) ->
  // selectOneQuestionPerKnowledgeTarget), jamais de rawQuestions/questionsParsed
  // directement.
  assert.match(SERVER_SOURCE, /const knowledgeMatched = filterQuestionsToAdmittedKnowledge\(structurallyValid, admittedKnowledge\);/);
  assert.match(SERVER_SOURCE, /const knowledgeConstrained = filterVariantsByKnowledgeConstraints\(knowledgeMatched, admittedKnowledge\);/);
  assert.match(SERVER_SOURCE, /validated = selectOneQuestionPerKnowledgeTarget\(paragraphGrounded\);/);
});

// ── G. le curriculum complet (15-20) reste intégralement persisté ────────

test("G. computeCurriculumSplit ne descend jamais sous MIN_LEVEL_SIZE (4) pour elementary, quelle que soit la taille N — le curriculum persisté n'est jamais tronqué au nombre de questions validées", () => {
  for (let n = 15; n <= 20; n += 1) {
    const split = computeCurriculumSplit(n);
    assert.ok(split.elementary >= MIN_LEVEL_SIZE, `N=${n}`);
    assert.equal(split.elementary + split.deepening + split.expert, n, `N=${n} : la somme reste toujours le total du curriculum, jamais réduite`);
  }
});

test("G. server.js persiste `curriculum` (le curriculum COMPLET renvoyé par resolveProgressiveCurriculum), jamais un sous-ensemble filtré sur `validated`", () => {
  assert.match(SERVER_SOURCE, /const progressiveExtra = \{ curriculum, progressive_status: "elementary_ready", grounding_sources: publicGroundingSources \};/);
  // `curriculum` vient directement de resolveProgressiveCurriculum, jamais recalculé/filtré après le bloc élémentaire.
  assert.doesNotMatch(SERVER_SOURCE, /curriculum\.filter\([^)]*validated/);
});

// Réécrit (Phase 2.1) : depuis la factorisation generateProgressiveLevelBlock,
// buildElementaryFichePrompt n'est plus appelée par son nom en dur — elle est
// passée par référence comme `ficheBuilder` (jamais réécrite, jamais un
// sous-ensemble filtré sur `validated`, qui n'existe même pas encore à ce
// stade puisque la fiche est désormais rédigée AVANT les questions).
test("G. la fiche élémentaire couvre toutes les connaissances elementary du curriculum, jamais réduite à celles ayant une question validée (ficheBuilder appelé avec levelKnowledge, jamais `validated`)", () => {
  assert.match(SERVER_SOURCE, /ficheBuilder: buildElementaryFichePrompt,/);
  assert.match(SERVER_SOURCE, /content: ficheBuilder\(subject, contextHint, levelKnowledge, levelConfig, grounding\?\.groundingText \|\| null\)/);
});

// ── H. le frontend accepte "4 questions" sans placeholder pour la 5e ────

test("H. le frontend n'exige jamais un compte de questions particulier — aucune comparaison de questionCount/questions.length à une constante 4 ou 5 (pas de placeholder pour une question manquante)", () => {
  assert.doesNotMatch(VIEW_SOURCE, /questionCount\s*[<>]=?\s*(4|5)\b/);
  assert.doesNotMatch(VIEW_SOURCE, /questions\.length\s*[<>]=?\s*(4|5)\b/);
});

// ── I. le polling considère le bloc prêt sans seuil legacy de 15 ────────
// (déjà vérifié en détail dans test/qcm-progressive-ui-wiring.test.js —
// vérification ciblée ici : le seuil MIN_MASTER_QUESTIONS n'apparaît nulle
// part dans la route de polling, qui reste purement basée sur la présence
// d'une ligne user_notion_quizzes.)

test("I. GET generation-status ne référence jamais MIN_MASTER_QUESTIONS ni un compte de questions — présence de la ligne user_notion_quizzes uniquement", () => {
  const routeStart = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/generation-status"');
  const routeEnd = SERVER_SOURCE.indexOf("\n});", routeStart) + 4;
  const routeSource = SERVER_SOURCE.slice(routeStart, routeEnd);
  assert.doesNotMatch(routeSource, /MIN_MASTER_QUESTIONS/);
  assert.doesNotMatch(routeSource, /MIN_ELEMENTARY_READY_QUESTIONS/);
  assert.doesNotMatch(routeSource, /questions\.length/);
});

// ── J. la bascule elementary_ready ne bloque pas la continuation future ──

test("J. progressive_status reste un champ TEXT libre (elementary_ready/deepening_ready/ready déjà supportés par progressiveEligibilityMinimum), jamais un booléen figé \"terminé\"", () => {
  const questionFormatsSource = fs.readFileSync(path.join(__dirname, "..", "lib", "question-formats.js"), "utf8");
  assert.match(questionFormatsSource, /progressiveStatus === "elementary_ready"/);
  assert.match(questionFormatsSource, /progressiveStatus === "deepening_ready"/);
  assert.match(questionFormatsSource, /progressiveStatus === "ready"/);
});

test("J. le curriculum persisté porte déjà les connaissances deepening/expert (pas seulement elementary) — disponibles pour une continuation future sans nouvelle génération de curriculum", () => {
  assert.match(SERVER_SOURCE, /const deepeningKnowledgeCount = curriculum\.filter\(\(k\) => k\.level === "deepening"\)\.length;/);
  assert.match(SERVER_SOURCE, /const expertKnowledgeCount = curriculum\.filter\(\(k\) => k\.level === "expert"\)\.length;/);
});

test("J. aucun code de cette phase ne supprime ni ne marque \"validée\" la connaissance elementary restée sans question — selectCurriculumLevel reste une simple lecture, jamais une écriture", () => {
  const curriculumSource = fs.readFileSync(path.join(__dirname, "..", "lib", "notion-quiz-curriculum.js"), "utf8");
  assert.match(curriculumSource, /function selectCurriculumLevel\(curriculum, level\) \{\s*\n\s*return \(Array\.isArray\(curriculum\) \? curriculum : \[\]\)/);
});

// Inversé (Phase 2.1, "terminer le pipeline progressif") : B/C (deepening/
// expert) sont désormais RÉELLEMENT implémentés, via le même moteur
// generateProgressiveLevelBlock que Elementary — jamais une seconde logique
// dupliquée. Verrou complet sur leur comportement : test/qcm-progressive-v2-wiring.test.js.
test("J. B/C (deepening/expert) sont implémentés via generateDeepeningBlock/generateExpertBlock, tous deux délégant à generateProgressiveLevelBlock", () => {
  assert.match(SERVER_SOURCE, /feature: `\$\{questionFeaturePrefix\}_question_generation`,/);
  assert.match(SERVER_SOURCE, /async function generateDeepeningBlock\(/);
  assert.match(SERVER_SOURCE, /async function generateExpertBlock\(/);
});

// ══════════════════════════════════════════════════════════════════════
// First-pass yield + vérification scindée elementary-only (03/09/2026,
// audit réel "Les oiseaux migrateurs" — qualité insuffisante et latence
// excessive). Tests H.1 à H.9 explicitement demandés.
// ══════════════════════════════════════════════════════════════════════

const CURRICULUM_SOURCE = fs.readFileSync(path.join(__dirname, "..", "lib", "notion-quiz-curriculum.js"), "utf8");

// ── H.1/H.2 : curriculum 19 = 5/5/9, seuls les 5 elementary sont vérifiés ─

test("H.1 : curriculum réel à 19 connaissances -> split exact 5/5/9 (cas réel \"Les oiseaux migrateurs\")", () => {
  assert.deepEqual(computeCurriculumSplit(19), { elementary: 5, deepening: 5, expert: 9 });
});

// Réécrit (Phase 2.1, section 1 de la demande) : knowledge_verification (IA)
// a disparu entièrement — seul knowledge_generation (extraction unique) est
// transmis à l'admission, elementary ET deepening/expert sont evidence-gatés
// (déterministe) dans la MÊME passe, cf. resolveProgressiveCurriculum.
test("H.1 : elementary ET deepening/expert sont evidence-gatés dans la MÊME passe déterministe (evidenceGateAndRepairCurriculumSubset pour elementary, gate inline pour deepening/expert) — plus de knowledge_verification IA", () => {
  assert.match(SERVER_SOURCE, /initialPool: elementaryPoolRaw,\s*\n\s*targetSize: elementaryTarget,\s*\n\s*repairFeature: "curriculum_repair"/);
  assert.match(SERVER_SOURCE, /const deferredGated = deferredCandidatesRaw\.map\(\(item\) => \{/);
  assert.doesNotMatch(SERVER_SOURCE, /buildKnowledgeVerificationPrompt\(verificationCandidates/);
});

// Réécrit (Phase 2.1, section 2) : verified reflète désormais le résultat
// RÉEL du gate evidence pour deepening/expert (plus jamais toujours false).
test("H.2 : les connaissances deepening/expert différées portent verified DÉRIVÉ du gate evidence réel — jamais un champ absent, jamais toujours false", () => {
  assert.match(SERVER_SOURCE, /if \(result\.ok\) \{ deferredEvidenceValid \+= 1; return \{ \.\.\.item, verified: true \}; \}/);
  assert.match(SERVER_SOURCE, /return \{ \.\.\.item, verified: false \};/);
  assert.match(SERVER_SOURCE, /level: "elementary", verified: true/);
});

// ── H.3 : le curriculum complet (19) reste intégralement conservé ────────

test("H.3 : le curriculum final combine TOUJOURS elementaryFinal ET deferredFinal — aucune connaissance deepening/expert n'est abandonnée en cours de route", () => {
  assert.match(SERVER_SOURCE, /const finalCurriculum = \[\.\.\.elementaryFinal, \.\.\.deferredFinal\];/);
  // Le nombre de candidats différés vient directement du pool initial (deferredCandidatesRaw), jamais recalculé/filtré.
  assert.match(SERVER_SOURCE, /const deferredCandidatesRaw = leveledPool\.filter\(\(item\) => item\.level !== "elementary"\);/);
});

test("H.3 : la persistance daily_quiz insère toujours `curriculum` (elementary + deepening + expert combinés), jamais un sous-ensemble", () => {
  assert.match(SERVER_SOURCE, /const progressiveExtra = \{ curriculum, progressive_status: "elementary_ready", grounding_sources: publicGroundingSources \};/);
});

// ── H.8 : le prompt de génération interdit explicitement les 4 défauts ───

test("H.8 : interdiction des distracteurs construits comme contraires caricaturaux de la bonne réponse", () => {
  assert.match(SERVER_SOURCE, /Jamais de contraire caricatural/);
  assert.match(SERVER_SOURCE, /antithèse facile à écarter sans connaître le sujet/);
});

test("H.8 : interdiction de l'indice lexical du stem repris uniquement dans la bonne réponse", () => {
  assert.match(SERVER_SOURCE, /un écho lexical évident avec la question \(ex\. un mot de l'énoncé, comme \\"saison\\", repris uniquement dans la bonne option, comme \\"saisonnière\\"\)/);
});

test("H.8 : interdiction de la réponse trouvable par élimination/bon sens seul (auto-vérification avant validation de la question)", () => {
  assert.match(SERVER_SOURCE, /vérifie silencieusement qu'une personne ignorant le fait ne pourrait pas la résoudre par élimination ou bon sens seul/);
  assert.match(SERVER_SOURCE, /ou par élimination immédiate des distracteurs/);
});

test("H.8 : le curriculum interdit explicitement deux connaissances elementary conceptuellement équivalentes (pas seulement lexicalement distinctes)", () => {
  assert.match(CURRICULUM_SOURCE, /deux formulations différentes du MÊME fait/);
  assert.match(CURRICULUM_SOURCE, /deux définitions ou deux descriptions d'un même mécanisme, même écrites avec des mots différents, ne comptent jamais comme deux connaissances distinctes/);
});

test("H.8 : \"élémentaire\" est explicitement distingué d'\"évident\" dans l'instruction de niveau", () => {
  assert.match(SERVER_SOURCE, /\\"Élémentaire\\" signifie une connaissance fondamentale à acquérir, jamais une question évidente/);
});

// ── H.9 : aucun modèle/température/retry/seuil qualité modifié ───────────

test("H.9 : aucun modèle ni température touchés par ce chantier (DAILY_QUIZ_NARRATIVE_MODEL/CRITIC_MODEL, températures 0.1/0.2/0.35/0.4 toujours utilisées telles quelles)", () => {
  assert.match(SERVER_SOURCE, /model: DAILY_QUIZ_NARRATIVE_MODEL,\s*\n\s*temperature: 0\.4,/);
  assert.match(SERVER_SOURCE, /model: DAILY_QUIZ_NARRATIVE_MODEL,\s*\n\s*temperature: 0\.2,/);
});

// Réécrit (Phase 2.1, section 3 de la demande) : CURRICULUM_REPAIR_MAX_ATTEMPTS
// a été SUPPRIMÉE — la réparation curriculum n'est plus bornée par un compteur
// de boucle (jusqu'à 2), elle est structurellement unique (un seul bloc
// conditionnel, jamais une boucle for/while) dans evidenceGateAndRepairCurriculumSubset.
test("H.9 : QCM_SEMANTIC_REVIEW_MAX_RETRIES/QCM_CRITIC_TECHNICAL_MAX_RETRIES restent des constantes déclarées une seule fois (legacy, jamais réassignées) ; CURRICULUM_REPAIR_MAX_ATTEMPTS a été supprimée (réparation structurellement unique désormais)", () => {
  for (const constant of ["QCM_SEMANTIC_REVIEW_MAX_RETRIES", "QCM_CRITIC_TECHNICAL_MAX_RETRIES"]) {
    const declarations = SERVER_SOURCE.match(new RegExp(`const ${constant}\\s*=`, "g")) || [];
    assert.equal(declarations.length, 1, `${constant} doit être déclarée exactement une fois (via const), trouvé ${declarations.length}`);
    const reassignments = SERVER_SOURCE.match(new RegExp(`(?<!const )\\b${constant}\\s*=(?!=)`, "g")) || [];
    assert.equal(reassignments.length, 0, `${constant} ne doit jamais être réassignée`);
  }
  assert.doesNotMatch(SERVER_SOURCE, /CURRICULUM_REPAIR_MAX_ATTEMPTS/);
});

test("H.9 : MIN_ELEMENTARY_READY_QUESTIONS reste 4 — non modifié par ce chantier", () => {
  assert.equal(MIN_ELEMENTARY_READY_QUESTIONS, 4);
});

test("H.9 : aucun critère de validateQuestionQuality/validateQuestionBatchQuality/buildSemanticReviewPrompt n'est touché — seules des lignes ADDITIVES sont présentes dans buildQuestionFormatsPromptBlock, les lignes existantes restent verbatim", () => {
  assert.match(SERVER_SOURCE, /"Homogénéité des distracteurs : quand c'est pertinent, chaque distracteur doit appartenir à la MÊME catégorie que la bonne réponse/);
  assert.match(SERVER_SOURCE, /"Distracteurs plausibles : chaque distracteur doit être une erreur crédible pour quelqu'un qui connaît mal le sujet/);
  assert.match(SERVER_SOURCE, /"Options réellement distinctes : deux options ne doivent jamais exprimer essentiellement la même information/);
});
