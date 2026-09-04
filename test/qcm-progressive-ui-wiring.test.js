"use strict";

// Câblage UI de la génération progressive (03/09/2026, "rendre la Phase 1
// réellement accessible depuis l'UI"). Un audit read-only du 02/09/2026 a
// établi que la route POST /api/users/notion-quizzes/custom/progressive
// (Phase 1, cf. rapport du même jour) n'était appelée par AUCUNE UI — le
// formulaire de création de sujet personnalisé (views/qcm-du-jour.html)
// postait exclusivement sur la route legacy /api/users/notion-quizzes/custom,
// expliquant pourquoi un test réel ("Épicurisme") avait exercé le pipeline
// legacy de bout en bout malgré le backend progressif déjà en place.
//
// Ce fichier verrouille le correctif de câblage minimal, EN TEXTE BRUT
// (views/qcm-du-jour.html contient un <script> non require()-able — même
// contrainte que test/qcm-generation-ux-status.test.js, qui utilise `vm`
// pour l'exécuter réellement ; ce fichier-ci reste volontairement en
// text-pattern, à l'image de test/qcm-progressive-elementary-wiring.test.js
// pour server.js, car le sandbox `vm` de qcm-du-jour.html est actuellement
// perturbé par un chantier concurrent SANS RAPPORT — cf. rapport, point 6).
//
// Ne reteste jamais la logique déjà couverte ailleurs :
// - le split curriculum et progressiveEligibilityMinimum (4 ou 5 questions
//   elementary selon la taille du curriculum) : test/question-formats.test.js
//   et test/notion-quiz-curriculum.test.js ;
// - le backend de la route progressive elle-même (curriculum, bloc A,
//   persistance, features IA) : test/qcm-progressive-elementary-wiring.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const VIEW_SOURCE = fs.readFileSync(path.join(__dirname, "..", "views", "qcm-du-jour.html"), "utf8");
const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const QUESTION_FORMATS_SOURCE = fs.readFileSync(path.join(__dirname, "..", "lib", "question-formats.js"), "utf8");

// ── 1. Le formulaire custom UI appelle TOUJOURS /custom/progressive, pour
// les 3 niveaux (Phase 2.1, "terminer le pipeline progressif") ─────────────

// Réécrit (Phase 2, puis 2.1) : depuis que deepening/expert sont réellement
// implémentés côté backend, /custom/progressive sert TOUJOURS de point
// d'entrée, quel que soit le niveau choisi — le backend sert Élémentaire en
// premier, puis attend (dans la même requête) le niveau réellement demandé
// si Avancé/Expert, cf. server.js POST /custom/progressive. Il n'y a donc
// plus de branchement conditionnel côté UI.
test("startCustomTopicGeneration route TOUJOURS vers /custom/progressive, quel que soit le niveau (plus de branchement conditionnel vers /custom legacy)", () => {
  assert.match(VIEW_SOURCE, /var creationEndpoint = '\/api\/users\/notion-quizzes\/custom\/progressive';/);
  assert.match(VIEW_SOURCE, /fetch\(creationEndpoint, \{/);
});

// ── 2. La route legacy /custom n'est pas supprimée ─────────────────────────

test("la route POST /api/users/notion-quizzes/custom (legacy) existe toujours, inchangée, à côté de /custom/progressive", () => {
  assert.match(SERVER_SOURCE, /app\.post\("\/api\/users\/notion-quizzes\/custom", rateLimit\("users", 30\), async \(req, res\) => \{/);
  assert.match(SERVER_SOURCE, /app\.post\("\/api\/users\/notion-quizzes\/custom\/progressive", rateLimit\("users", 30\), async \(req, res\) => \{/);
});

test("le second appelant (proposition IA \"Créer cet apprentissage\") passe par le même startCustomTopicGeneration — un seul point de branchement, jamais un second fetch dupliqué", () => {
  const occurrences = VIEW_SOURCE.match(/startCustomTopicGeneration\(/g) || [];
  // 1 déclaration de fonction + au moins 2 appelants (submitCustomTopic, et la
  // proposition IA V2) — mais un seul et unique site contenant `fetch(creationEndpoint`.
  assert.ok(occurrences.length >= 3, `attendu au moins 3 occurrences (déclaration + appelants), trouvé ${occurrences.length}`);
  const fetchCreationEndpointOccurrences = VIEW_SOURCE.match(/fetch\(creationEndpoint,/g) || [];
  assert.equal(fetchCreationEndpointOccurrences.length, 1, "un seul site d'appel doit décider de l'endpoint — jamais dupliqué par appelant");
});

// ── 3. Contrat de réponse : les champs lus par le frontend existent dans les
// deux routes, avec le même nom ───────────────────────────────────────────

test("le frontend ne lit que ok/slot/quizDate/label/questionCount/code/error/diagnostics — tous présents à l'identique dans la route progressive", () => {
  // Champs effectivement lus côté client sur `result.data` (cf. startCustomTopicGeneration).
  const fieldsReadByFrontend = ["ok", "slot", "quizDate", "label", "questionCount", "code", "error", "diagnostics"];
  for (const field of fieldsReadByFrontend) {
    assert.match(VIEW_SOURCE, new RegExp(`result\\.data\\.${field}\\b`), `le frontend doit lire result.data.${field}`);
  }
  // Recherche élargie (jusqu'à la première occurrence de "\n});" APRÈS le
  // premier res.json de succès) : la route contient désormais un second
  // bloc (continuation arrière-plan) après ce premier res.json — cf. section
  // 15 de la demande Phase 2.
  const progressiveRouteStart = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom/progressive"');
  const progressiveRouteEnd = SERVER_SOURCE.indexOf("\n});", SERVER_SOURCE.indexOf("res.json({", progressiveRouteStart)) + 4;
  const progressiveRouteSource = SERVER_SOURCE.slice(progressiveRouteStart, progressiveRouteEnd);
  // Succès : ok/slot/quizDate/label/questionCount doivent être présents (mêmes noms que legacy).
  assert.match(progressiveRouteSource, /res\.json\(\{\s*\n\s*ok: true,\s*\n\s*slot: masterSlot,\s*\n\s*quizDate,\s*\n\s*label: servedQuestions\[0\]\?\.sourceName \|\| questions\[0\]\?\.sourceName \|\| null,\s*\n\s*questionCount: servedQuestions\.length,/);
  // Échec : publicGenerationError produit toujours {status, body:{ok:false, code, error}} —
  // réutilisé tel quel (même fonction que la route legacy), donc même contrat d'échec.
  const failureSource = SERVER_SOURCE.slice(progressiveRouteStart, SERVER_SOURCE.indexOf("res.json({", progressiveRouteStart));
  assert.match(failureSource, /const publicError = publicGenerationError\(code, result\.reason\);/);
  assert.match(failureSource, /return res\.status\(publicError\.status\)\.json\(publicError\.body\);/);
});

test("publicGenerationError (réutilisée sans modification par les deux routes) produit toujours exactement {ok:false, code, error} — contrat d'échec partagé, jamais divergent", () => {
  const errorsSource = fs.readFileSync(path.join(__dirname, "..", "lib", "custom-topic-generation-errors.js"), "utf8");
  assert.match(errorsSource, /body: \{ ok: false, code: safeCode, error: safeReason \|\| definition\.message \}/);
});

test("`diagnostics` reste un champ optionnel côté frontend (dégradation gracieuse) — la route progressive n'a pas besoin de le fournir pour rester compatible", () => {
  assert.match(VIEW_SOURCE, /function customGenerationDiagnosticMessage\(diagnostics\) \{\s*\n\s*if \(!diagnostics \|\| typeof diagnostics !== 'object'\) return '';/);
});

// ── 4. Polling : accepte elementary_ready sans exiger un compte de questions,
// jamais de faux échec lié à un seuil legacy ───────────────────────────────

test("GET .../generation-status détermine 'ready' par la seule PRÉSENCE d'une ligne user_notion_quizzes — jamais par un nombre de questions ou un progressive_status particulier", () => {
  const routeStart = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/generation-status"');
  const routeEnd = SERVER_SOURCE.indexOf("\n});", routeStart) + 4;
  const routeSource = SERVER_SOURCE.slice(routeStart, routeEnd);
  assert.match(routeSource, /\.from\("user_notion_quizzes"\)\s*\n\s*\.select\("slot,quiz_date"\)/);
  assert.doesNotMatch(routeSource, /progressive_status/);
  assert.doesNotMatch(routeSource, /questions\.length/);
  assert.doesNotMatch(routeSource, /MIN_MASTER_QUESTIONS/);
});

test("GET /api/users/notion-quizzes (liste \"Mes apprentissages\") ne filtre jamais par un nombre minimal de questions — un bloc progressif à 4 ou 5 questions apparaît comme n'importe quel autre", () => {
  const routeStart = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes", rateLimit');
  const routeEnd = SERVER_SOURCE.indexOf('\napp.get("/api/users/notion-quizzes/', routeStart + 10);
  const routeSource = SERVER_SOURCE.slice(routeStart, routeEnd);
  assert.doesNotMatch(routeSource, /questions\.length\s*[<>]=?\s*\d/);
  assert.doesNotMatch(routeSource, /MIN_MASTER_QUESTIONS/);
});

test("aucune fonction de rendu/statut de la génération (spinner, modale \"prêt\") n'exige un nombre minimal de questions type legacy (5 ou 15) — seule une comparaison à 1 existe, pour le pluriel \"question(s)\"", () => {
  assert.doesNotMatch(VIEW_SOURCE, /questionCount\s*[<>]=?\s*(5|15)\b/);
  assert.doesNotMatch(VIEW_SOURCE, /questions\.length\s*[<>]=?\s*(5|15)\b/);
  // La seule comparaison numérique existante sur questionCount est `> 1`, pour le pluriel — jamais un seuil.
  assert.match(VIEW_SOURCE, /questionCount > 1/);
});

// ── 5. Niveau élémentaire dynamique (4 ou 5 questions) : couvert par
// lib/question-formats.js (progressiveEligibilityMinimum), verrouillé ici
// uniquement au niveau du branchement, jamais reteste la logique elle-même —
// cf. test/question-formats.test.js pour le comportement complet. ──────────

test("progressiveEligibilityMinimum plafonne le seuil elementary_ready à MIN_ELEMENTARY_READY_QUESTIONS (qualité > quantité, 03/09/2026) — jamais le nombre d'items \"elementary\" du curriculum quand il dépasse ce plancher", () => {
  assert.match(QUESTION_FORMATS_SOURCE, /const MIN_ELEMENTARY_READY_QUESTIONS = 4;/);
  assert.match(QUESTION_FORMATS_SOURCE, /if \(progressiveStatus === "elementary_ready"\) \{\s*\n\s*const count = list\.filter\(\(item\) => item\?\.level === "elementary"\)\.length;/);
  // PROGRESSIVE_MASTER_MIN_FALLBACK.elementary_ready (= MIN_ELEMENTARY_READY_
  // QUESTIONS) n'est utilisé QUE si `curriculum` est vide/absent
  // (`count > 0 ? ... : ...`) — jamais quand le curriculum réel n'a que 4
  // connaissances "elementary", cas alors couvert par le Math.min ci-dessous.
  // Repli purement défensif, cf. test/question-formats.test.js ("curriculum
  // absent/vide... retombe sur le repli défensif").
  assert.match(QUESTION_FORMATS_SOURCE, /return count > 0 \? Math\.min\(MIN_ELEMENTARY_READY_QUESTIONS, count\) : PROGRESSIVE_MASTER_MIN_FALLBACK\.elementary_ready;/);
});

// ── 6. Fiche : buildElementaryFichePrompt non modifié par ce correctif ─────

test("buildElementaryFichePrompt n'est pas modifié par ce correctif de câblage UI (seul le point d'entrée de création a changé)", () => {
  const knowledgeAdmissionSource = fs.readFileSync(path.join(__dirname, "..", "lib", "knowledge-admission.js"), "utf8");
  assert.match(knowledgeAdmissionSource, /function buildElementaryFichePrompt\(subject, contextHint, elementaryKnowledge, levelConfig, groundingText = null\) \{/);
});

// ── 7. La route lit désormais `level` (Phase 2.1) — voir plus bas ────────

// Inversé (Phase 2.1, section 1 de la demande utilisateur du 04/09/2026) :
// la route lit désormais `level` explicitement — c'est elle qui pilote la
// continuation synchrone (Avancé/Expert) et l'arrière-plan (jusqu'à Expert).
test("la route progressive lit `level` explicitement et enregistre requested_level DYNAMIQUE (jamais la chaîne fixe 'elementaire')", () => {
  const progressiveRouteStart = SERVER_SOURCE.indexOf('app.post("/api/users/notion-quizzes/custom/progressive"');
  const progressiveRouteEnd = SERVER_SOURCE.indexOf("\n});", SERVER_SOURCE.indexOf("res.json({", progressiveRouteStart)) + 4;
  const progressiveRouteSource = SERVER_SOURCE.slice(progressiveRouteStart, progressiveRouteEnd);
  assert.match(progressiveRouteSource, /const requestedLevel = resolveNotionQuizLevel\(req\.body\?\.level\)\.level \|\| "elementaire";/);
  assert.match(progressiveRouteSource, /requested_level: requestedLevel/);
  assert.doesNotMatch(progressiveRouteSource, /requested_level: "elementaire" \}/);
});
