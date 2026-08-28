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
  assert.match(server, /reasonCounts: questionQualityMetrics\?\.reasonCounts/);
  assert.match(server, /diagnostics=\$\{JSON\.stringify\(safeDiagnostics\)\}/);
  assert.match(view, /\[qcm-generation-diagnostics\]/);
  assert.match(view, /Référence diagnostic/);
  assert.match(view, /reasonCounts/);
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
  assert.match(view, /Connexion interrompue/);
  for (const code of ["AI_UNAVAILABLE", "AI_TIMEOUT", "CONTENT_UNUSABLE", "STORAGE_TEMPORARY", "QCM_UNUSABLE"]) {
    assert.match(view, new RegExp(code));
  }
});

test("l'ancien message générique trompeur a disparu du parcours", () => {
  assert.doesNotMatch(server, /Génération de la fiche impossible pour le moment/);
  assert.doesNotMatch(view, /Génération de la fiche impossible pour le moment/);
});
