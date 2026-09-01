"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const view = fs.readFileSync(path.join(root, "views/qcm-du-jour.html"), "utf8");

test("la panne reproduite après création de fiche est identifiée comme QCM_UNUSABLE", () => {
  assert.match(server, /generationFailure\("QCM_UNUSABLE", "question_validation"/);
  assert.match(server, /acceptedKnowledgeCount: accepted\.length/);
  assert.match(server, /validQuestionCount: validated\.length/);
  assert.match(server, /reasonCounts: questionQualityMetrics\?\.unresolvedReasonCounts \|\| questionQualityMetrics\?\.reasonCounts/);
  assert.match(server, /diagnostics=\$\{JSON\.stringify\(safeDiagnostics\)\}/);
  assert.match(view, /\[qcm-generation-diagnostics\]/);
  assert.match(view, /Référence diagnostic/);
  assert.match(view, /reasonCounts/);
  assert.match(server, /postQualityStructuralCount/);
  assert.match(server, /postQualityKnowledgeMatchedCount/);
  assert.match(server, /postQualityConstraintCount/);
  assert.match(view, /stockables=/);
});

test("les échecs IA, parsing, admission et stockage ont des codes distincts", () => {
  for (const code of ["AI_CONFIG_MISSING", "CONTENT_UNUSABLE", "KNOWLEDGE_REJECTED", "STORAGE_TEMPORARY"]) {
    assert.match(server, new RegExp(code));
  }
  assert.match(server, /classifyAiError\(error\)/);
});

test("la route ne renvoie plus l'erreur technique Supabase brute", () => {
  const routeStart = server.indexOf('app.post("/api/users/notion-quizzes/custom"');
  const routeEnd = server.indexOf('\n});', routeStart) + 4;
  const route = server.slice(routeStart, routeEnd);
  assert.doesNotMatch(route, /res\.status\(500\)\.json\(\{ ok: false, error: error\.message \}\)/);
  assert.match(route, /publicGenerationError\("STORAGE_TEMPORARY"\)/);
});

test("le frontend distingue statut, JSON invalide, réseau et codes serveur", () => {
  assert.match(view, /status: res\.status/);
  assert.match(view, /invalidJson: !data/);
  assert.match(view, /connexion avec le serveur a été interrompue/i);
  assert.doesNotMatch(view, /Vérifie ton réseau/i);
  for (const code of ["AI_UNAVAILABLE", "AI_TIMEOUT", "CONTENT_UNUSABLE", "STORAGE_TEMPORARY", "QCM_UNUSABLE"]) {
    assert.match(view, new RegExp(code));
  }
});

test("un sujet libre reste suivi après avoir quitté la page", () => {
  assert.match(view, /function getCustomTopicPendingSlot\(topic, level\)/);
  assert.match(view, /crypto\.subtle\.digest\('SHA-1'/);
  assert.match(view, /mnoriaStartPendingNotionQuizGeneration\(\{ slot: pendingCustomSlot, label: topic \}\)/);
  assert.ok(
    view.indexOf("mnoriaStartPendingNotionQuizGeneration({ slot: pendingCustomSlot, label: topic })")
      < view.indexOf("fetch('/api/users/notion-quizzes/custom'"),
    "le marqueur persistant doit être écrit avant l'appel de génération"
  );
  const catchStart = view.indexOf(".catch(function () {", view.indexOf("fetch('/api/users/notion-quizzes/custom'"));
  const catchEnd = view.indexOf("          });", catchStart);
  assert.doesNotMatch(view.slice(catchStart, catchEnd), /mnoriaFinishPendingNotionQuizGeneration/);
});

test("le suivi reconnaît toutes les variantes de niveau d'un même master mutualisé", () => {
  const routeStart = server.indexOf('app.get("/api/users/notion-quizzes/generation-status"');
  const routeEnd = server.indexOf('app.get("/api/users/notion-quizzes",', routeStart);
  const route = server.slice(routeStart, routeEnd);
  assert.match(route, /customSlotIdentity/);
  assert.match(route, /elementaire\|avance\|expert/);
  assert.match(route, /return row \? \[\{ slot: requestedSlot, quizDate: row\.quiz_date \}\] : \[\]/);
  assert.match(view, /function mesQcmTrackingSlotIdentity\(slot\)/);
  assert.match(view, /availableSlots\[mesQcmTrackingSlotIdentity\(item\.slot\)\]/);
});

test("la fenêtre Générer avec l’IA se ferme automatiquement dès que la génération est lancée", () => {
  const generationStart = view.indexOf("mnoriaStartPendingNotionQuizGeneration({ slot: pendingCustomSlot, label: topic })");
  const modalClose = view.indexOf("closeAiGenerateModal();", generationStart);
  const requestStart = view.indexOf("fetch('/api/users/notion-quizzes/custom'", generationStart);
  assert.ok(generationStart >= 0, "le suivi persistant doit être lancé");
  assert.ok(modalClose > generationStart, "la fenêtre doit se fermer après l'inscription du suivi en cours");
  assert.ok(modalClose < requestStart, "la fenêtre doit disparaître sans attendre la fin de la requête IA");
});

test("le suivi de génération apparaît sous le bouton personnalisé et avant les sujets proposés", () => {
  const button = view.indexOf('id="qcm-memorize-toggle"');
  const statusAnchor = view.indexOf('id="qcm-generation-status-anchor"');
  const suggestions = view.indexOf('id="qcm-learn-next-inline"');
  assert.ok(button >= 0 && statusAnchor > button, "le statut doit suivre le bouton principal");
  assert.ok(suggestions > statusAnchor, "le statut doit précéder les sujets proposés");
  assert.match(view, /generationStatusAnchor\.appendChild\(customSearchStatus\)/);
  assert.match(view, /generationStatusAnchor\.appendChild\(spinnerEl\)/);
});

test("l'ancien message générique trompeur a disparu du parcours", () => {
  assert.doesNotMatch(server, /Génération de la fiche impossible pour le moment/);
  assert.doesNotMatch(view, /Génération de la fiche impossible pour le moment/);
});

test("la régénération ciblée impose une correction concrète des formats observés en production", () => {
  assert.match(server, /DOUBLE_NEGATION : reformule entièrement la question sous une forme affirmative et directe/);
  assert.match(server, /INVALID_ORDER_COUNT \/ invalidOrderCount : abandonne obligatoirement le type ordre/);
  assert.match(server, /le remplacement doit avoir type=qcm et ne doit contenir aucune variante de type ordre/);
  assert.match(server, /qcm simple avec exactement 4 options distinctes/);
  assert.match(server, /incorrectCorrectAnswer/);
  assert.match(server, /correctAnswerIncorrect/);
  assert.match(server, /missingCorrectAnswerIndex/);
  assert.match(server, /noCorrectAnswerMarked/);
  assert.match(server, /unique correctIndex entier entre 0 et 3/);
  assert.match(server, /unclearQuestion/);
  assert.match(server, /formulationAmbiguë/);
  assert.match(server, /vagueQuestion/);
  assert.match(server, /questionVague/);
  assert.match(server, /la question doit être autonome, précise/);
});

test("le diagnostic utilisateur expose uniquement les rejets finaux non résolus", () => {
  assert.match(server, /questionQualityMetrics\?\.unresolvedReasonCounts \|\| questionQualityMetrics\?\.reasonCounts/);
});

test("un sujet à source unique récupère mécaniquement son sourceId serveur", () => {
  assert.match(server, /const soleValidSourceId = validIds\.size === 1/);
  assert.match(server, /const sourceId = soleValidSourceId \|\| modelSourceId/);
  assert.match(server, /filterQuestionsToAdmittedKnowledge\(structurallyValid, accepted\)/);
});
