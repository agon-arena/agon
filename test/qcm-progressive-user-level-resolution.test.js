"use strict";

// Teste le VRAI code serveur (server.js), pas une réimplémentation dupliquée
// — même technique que test/help-level-reveal-gate.test.js (views/qcm-du-jour.html) :
// extrait le bloc PROGRESSIVE_LEVEL_ORDER/computeNextUnlockedProgressiveLevel/
// resolveUserProgressiveLevel/resolveTargetLevelOnRequest tel quel (aucune
// logique dupliquée ici) et l'exécute dans un sandbox `vm` minimal, sans
// dépendance Supabase (fonctions pures, aucun accès base).
//
// Chantier "démarrage toujours Élémentaire + avancement automatique"
// (06/09/2026), complété par le chantier "rétablir un vrai choix
// utilisateur" (07/09/2026, targetLevel) : ces fonctions décident, pour un
// utilisateur donné, du prochain niveau à servir SANS jamais dépasser son
// propre plafond personnel (targetLevel) — jamais du contenu à générer
// (progressive_status du master, inchangé, cf. continueProgressiveGeneration,
// dont le paramètre `targetLevel` désigne autre chose : jusqu'où le MASTER
// doit être généré, toujours "expert", cf. server.js) ni directement du
// niveau cliqué dans le picker (cf. POST /custom/progressive, qui ne les
// appelle jamais à la création/réouverture pour décider du niveau SERVI —
// seulement resolveTargetLevelOnRequest pour décider du targetLevel
// persisté ; la promotion elle-même reste appelée uniquement en avancement,
// via GET /notion-quizzes et POST /answer).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

const startMarker = 'const PROGRESSIVE_LEVEL_ORDER = ["elementaire", "avance", "expert"];';
const endMarker = "async function continueProgressiveGeneration(masterSlot, topic, id, userId, targetLevel) {";
const startIndex = SERVER_SOURCE.indexOf(startMarker);
const endIndex = SERVER_SOURCE.indexOf(endMarker);
if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
  throw new Error("test/qcm-progressive-user-level-resolution.test.js : marqueurs d'extraction introuvables dans server.js — le code a bougé, adapter les marqueurs.");
}
const extractedSource = SERVER_SOURCE.slice(startIndex, endIndex);

function makeSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(extractedSource, sandbox);
  return sandbox;
}

// ── computeNextUnlockedProgressiveLevel : un seul palier à la fois ────────
// targetLevel = "expert" dans ces tests historiques : aucun plafond, mêmes
// valeurs qu'avant l'introduction de targetLevel (07/09/2026).

test("computeNextUnlockedProgressiveLevel : Élémentaire -> Approfondi dès deepening_ready OU ready, jamais avant", () => {
  const sandbox = makeSandbox();
  assert.equal(sandbox.computeNextUnlockedProgressiveLevel("elementaire", "expert", "elementary_ready"), null, "master pas encore assez avancé : rien à débloquer");
  assert.equal(sandbox.computeNextUnlockedProgressiveLevel("elementaire", "expert", "deepening_ready"), "avance");
  assert.equal(sandbox.computeNextUnlockedProgressiveLevel("elementaire", "expert", "ready"), "avance", "même si le master est déjà complet, un seul palier à la fois");
});

test("computeNextUnlockedProgressiveLevel : Approfondi -> Expert uniquement quand ready, jamais avec deepening_ready seul", () => {
  const sandbox = makeSandbox();
  assert.equal(sandbox.computeNextUnlockedProgressiveLevel("avance", "expert", "deepening_ready"), null);
  assert.equal(sandbox.computeNextUnlockedProgressiveLevel("avance", "expert", "ready"), "expert");
});

test("computeNextUnlockedProgressiveLevel : Expert n'a jamais de niveau suivant, quel que soit le statut du master", () => {
  const sandbox = makeSandbox();
  assert.equal(sandbox.computeNextUnlockedProgressiveLevel("expert", "expert", "ready"), null);
});

// ── computeNextUnlockedProgressiveLevel : plafond targetLevel (07/09/2026) ─

test("computeNextUnlockedProgressiveLevel : targetLevel=elementaire bloque toute promotion, même master ready", () => {
  const sandbox = makeSandbox();
  assert.equal(sandbox.computeNextUnlockedProgressiveLevel("elementaire", "elementaire", "deepening_ready"), null);
  assert.equal(sandbox.computeNextUnlockedProgressiveLevel("elementaire", "elementaire", "ready"), null);
});

test("computeNextUnlockedProgressiveLevel : targetLevel=avance autorise Élémentaire->Approfondi mais jamais Approfondi->Expert", () => {
  const sandbox = makeSandbox();
  assert.equal(sandbox.computeNextUnlockedProgressiveLevel("elementaire", "avance", "deepening_ready"), "avance");
  assert.equal(sandbox.computeNextUnlockedProgressiveLevel("elementaire", "avance", "ready"), "avance");
  assert.equal(sandbox.computeNextUnlockedProgressiveLevel("avance", "avance", "ready"), null, "targetLevel=avance : Expert reste hors de portée même si le master l'a déjà généré");
});

test("computeNextUnlockedProgressiveLevel : targetLevel=expert autorise la progression complète, un seul palier à la fois", () => {
  const sandbox = makeSandbox();
  assert.equal(sandbox.computeNextUnlockedProgressiveLevel("elementaire", "expert", "ready"), "avance");
  assert.equal(sandbox.computeNextUnlockedProgressiveLevel("avance", "expert", "ready"), "expert");
});

// ── resolveUserProgressiveLevel : legacy jamais touché ────────────────────

test("resolveUserProgressiveLevel : progressiveStatus falsy (master legacy) -> no-op strict, jamais de promotion (ne pas casser un apprentissage legacy en cours)", () => {
  const sandbox = makeSandbox();
  const resolved = sandbox.resolveUserProgressiveLevel({ persistedLevel: "elementaire", targetLevel: "expert", progressiveStatus: null, isCurrentBlockComplete: true });
  assert.equal(JSON.stringify(resolved), JSON.stringify({ level: "elementaire", promotion: null }));
});

// ── Scénario 9 : bloc terminé mais master pas encore assez avancé -> reste ─

test("resolveUserProgressiveLevel : Élémentaire terminé + master encore elementary_ready -> reste Élémentaire (jamais bloqué éternellement, cf. GET /notion-quizzes qui retente à chaque lecture)", () => {
  const sandbox = makeSandbox();
  const resolved = sandbox.resolveUserProgressiveLevel({ persistedLevel: "elementaire", targetLevel: "expert", progressiveStatus: "elementary_ready", isCurrentBlockComplete: true });
  assert.equal(JSON.stringify(resolved), JSON.stringify({ level: "elementaire", promotion: null }));
});

// ── Scénario 8 : promotion Élémentaire -> Approfondi ──────────────────────

test("resolveUserProgressiveLevel : Élémentaire terminé + deepening_ready -> promotion vers Approfondi", () => {
  const sandbox = makeSandbox();
  const resolved = sandbox.resolveUserProgressiveLevel({ persistedLevel: "elementaire", targetLevel: "expert", progressiveStatus: "deepening_ready", isCurrentBlockComplete: true });
  assert.equal(JSON.stringify(resolved), JSON.stringify({ level: "avance", promotion: { from: "elementaire", to: "avance" } }));
});

// ── Scénario 11/12 : promotion Approfondi -> Expert, ou blocage si pas prêt ─

test("resolveUserProgressiveLevel : Approfondi terminé + ready -> promotion vers Expert", () => {
  const sandbox = makeSandbox();
  const resolved = sandbox.resolveUserProgressiveLevel({ persistedLevel: "avance", targetLevel: "expert", progressiveStatus: "ready", isCurrentBlockComplete: true });
  assert.equal(JSON.stringify(resolved), JSON.stringify({ level: "expert", promotion: { from: "avance", to: "expert" } }));
});

test("resolveUserProgressiveLevel : Approfondi terminé + Expert pas encore prêt (deepening_ready) -> reste Approfondi, jamais de promotion prématurée", () => {
  const sandbox = makeSandbox();
  const resolved = sandbox.resolveUserProgressiveLevel({ persistedLevel: "avance", targetLevel: "expert", progressiveStatus: "deepening_ready", isCurrentBlockComplete: true });
  assert.equal(JSON.stringify(resolved), JSON.stringify({ level: "avance", promotion: null }));
});

// ── Reprise : bloc pas terminé -> jamais de promotion, niveau inchangé ────

test("resolveUserProgressiveLevel : bloc courant pas terminé -> jamais de promotion, même si le master a déjà tout généré", () => {
  const sandbox = makeSandbox();
  const resolved = sandbox.resolveUserProgressiveLevel({ persistedLevel: "elementaire", targetLevel: "expert", progressiveStatus: "ready", isCurrentBlockComplete: false });
  assert.equal(JSON.stringify(resolved), JSON.stringify({ level: "elementaire", promotion: null }));
});

// ── Un seul palier à la fois, même si le master est déjà `ready` ─────────

test("resolveUserProgressiveLevel : jamais de saut direct Élémentaire -> Expert, même si le master est déjà `ready` — Approfondi doit être traversé", () => {
  const sandbox = makeSandbox();
  const resolved = sandbox.resolveUserProgressiveLevel({ persistedLevel: "elementaire", targetLevel: "expert", progressiveStatus: "ready", isCurrentBlockComplete: true });
  assert.equal(resolved.level, "avance", "jamais 'expert' directement");
});

// ── Expert déjà atteint : plus aucune promotion possible ──────────────────

test("resolveUserProgressiveLevel : niveau déjà Expert -> plus jamais de promotion, quel que soit progressiveStatus", () => {
  const sandbox = makeSandbox();
  const resolved = sandbox.resolveUserProgressiveLevel({ persistedLevel: "expert", targetLevel: "expert", progressiveStatus: "ready", isCurrentBlockComplete: true });
  assert.equal(JSON.stringify(resolved), JSON.stringify({ level: "expert", promotion: null }));
});

// ── Scénario 14 (individualisation) : fonction pure, jamais d'état partagé ─
// entre deux utilisateurs sur le même master — deux appels indépendants avec
// des `persistedLevel`/`targetLevel` différents ne s'influencent jamais
// l'un l'autre (ex. obligatoire du chantier targetLevel : A=expert/expert,
// B=elementaire/avance sur le MÊME master `ready`).

test("resolveUserProgressiveLevel est une fonction PURE : deux utilisateurs différents sur le même master (même progressiveStatus) obtiennent chacun le résultat dérivé de LEUR SEUL persistedLevel/targetLevel, jamais de fuite d'état", () => {
  const sandbox = makeSandbox();
  const userAAlreadyExpert = sandbox.resolveUserProgressiveLevel({ persistedLevel: "expert", targetLevel: "expert", progressiveStatus: "ready", isCurrentBlockComplete: false });
  const userBNewJourney = sandbox.resolveUserProgressiveLevel({ persistedLevel: "elementaire", targetLevel: "avance", progressiveStatus: "ready", isCurrentBlockComplete: false });
  assert.equal(userAAlreadyExpert.level, "expert");
  assert.equal(userBNewJourney.level, "elementaire");
});

test("resolveUserProgressiveLevel : targetLevel=avance plafonne B à Approfondi même si le master est ready et B a fini son bloc courant, tandis qu'A (targetLevel=expert) continue normalement", () => {
  const sandbox = makeSandbox();
  const userA = sandbox.resolveUserProgressiveLevel({ persistedLevel: "avance", targetLevel: "expert", progressiveStatus: "ready", isCurrentBlockComplete: true });
  const userB = sandbox.resolveUserProgressiveLevel({ persistedLevel: "avance", targetLevel: "avance", progressiveStatus: "ready", isCurrentBlockComplete: true });
  assert.equal(userA.level, "expert");
  assert.equal(userB.level, "avance", "B ne dépasse jamais son targetLevel, quel que soit l'état du master");
  assert.equal(userB.promotion, null);
});

// ── resolveUserProgressiveLevel : targetLevel absent (legacy) -> repli "expert" ─

test("resolveUserProgressiveLevel : targetLevel absent (ligne antérieure à la colonne) -> repli 'expert', pas de plafond a posteriori sur un parcours déjà en cours", () => {
  const sandbox = makeSandbox();
  const resolved = sandbox.resolveUserProgressiveLevel({ persistedLevel: "avance", targetLevel: null, progressiveStatus: "ready", isCurrentBlockComplete: true });
  assert.equal(resolved.level, "expert", "sans targetLevel persisté, comportement identique à targetLevel=expert (aucun plafond historique)");
});

// ── resolveTargetLevelOnRequest : monotone croissant, jamais de rétrogradation silencieuse ──

test("resolveTargetLevelOnRequest : nouveau parcours (existingTargetLevel absent) -> targetLevel = niveau cliqué", () => {
  const sandbox = makeSandbox();
  assert.equal(sandbox.resolveTargetLevelOnRequest(null, "elementaire"), "elementaire");
  assert.equal(sandbox.resolveTargetLevelOnRequest(null, "avance"), "avance");
  assert.equal(sandbox.resolveTargetLevelOnRequest(null, "expert"), "expert");
});

test("resolveTargetLevelOnRequest : un choix supérieur relève le plafond déjà persisté", () => {
  const sandbox = makeSandbox();
  assert.equal(sandbox.resolveTargetLevelOnRequest("elementaire", "avance"), "avance");
  assert.equal(sandbox.resolveTargetLevelOnRequest("elementaire", "expert"), "expert");
  assert.equal(sandbox.resolveTargetLevelOnRequest("avance", "expert"), "expert");
});

test("resolveTargetLevelOnRequest : un choix inférieur ou égal ne baisse jamais silencieusement le plafond déjà persisté", () => {
  const sandbox = makeSandbox();
  assert.equal(sandbox.resolveTargetLevelOnRequest("expert", "elementaire"), "expert");
  assert.equal(sandbox.resolveTargetLevelOnRequest("expert", "avance"), "expert");
  assert.equal(sandbox.resolveTargetLevelOnRequest("avance", "elementaire"), "avance");
  assert.equal(sandbox.resolveTargetLevelOnRequest("avance", "avance"), "avance");
});
