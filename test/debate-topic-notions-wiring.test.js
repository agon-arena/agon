"use strict";

// Câblage réel dans server.js du chantier "catalogue-first" (demande du
// 07/09/2026) — la logique de décision elle-même est testée en isolation
// (test/debate-topic-notions.test.js, aucun réseau) ; ce fichier vérifie
// seulement que server.js appelle réellement ce module au lieu de son
// ancienne logique "IA systématique". server.js ne peut pas être require()
// (démarre tout le serveur Express à l'import) — lecture en texte brut, même
// principe que les autres *-wiring.test.js de ce dépôt.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

test("server.js importe la cascade catalogue-first depuis lib/debate-topic-notions.js", () => {
  assert.match(server, /const \{\s*MAX_DEBATE_TOPIC_NOTIONS,\s*pickDuplicateArenaNotions,\s*selectDebateTopicNotions\s*\} = require\("\.\/lib\/debate-topic-notions"\);/);
});

test("generateAndCacheDebateTopicNotions orchestre réutilisation d'arène + catalogue + IA via selectDebateTopicNotions, jamais un appel IA direct systématique", () => {
  const start = server.indexOf("async function generateAndCacheDebateTopicNotions(");
  assert.ok(start > -1, "generateAndCacheDebateTopicNotions introuvable");
  const fn = server.slice(start, start + 2500);
  assert.match(fn, /findDuplicateArenaCandidateRows\(debateId, question, sourceUrl\)/);
  assert.match(fn, /getCachedCustomTopicCatalog\(\)/);
  assert.match(fn, /pickDuplicateArenaNotions\(/);
  assert.match(fn, /await selectDebateTopicNotions\(\{/);
  assert.match(fn, /callAi: \(subj, contentText, optA, optB, cat\) => extractDebateTopicNotions\(subj, contentText, optA, optB, cat\)/);
});

test("extractDebateTopicNotions ne applique plus lui-même de plafond/minimum — le filtrage déterministe commun s'en charge désormais", () => {
  const start = server.indexOf("async function extractDebateTopicNotions(");
  const end = server.indexOf("async function getCachedCustomTopicCatalog(");
  assert.ok(start > -1 && end > start);
  const fn = server.slice(start, end);
  assert.doesNotMatch(fn, /DEBATE_TOPIC_NOTIONS_MAX/);
  assert.doesNotMatch(fn, /DEBATE_TOPIC_NOTIONS_MIN/);
  assert.doesNotMatch(fn, /slugifyDebateNotionName/);
});

test("les anciennes constantes DEBATE_TOPIC_NOTIONS_MIN/MAX et slugifyDebateNotionName ont été retirées (remplacées par lib/debate-topic-notions.js), aucun résidu orphelin", () => {
  assert.doesNotMatch(server, /DEBATE_TOPIC_NOTIONS_MIN/);
  assert.doesNotMatch(server, /DEBATE_TOPIC_NOTIONS_MAX/);
  assert.doesNotMatch(server, /function slugifyDebateNotionName/);
});

test("le prompt buildDebateTopicNotionsPrompt référence MAX_DEBATE_TOPIC_NOTIONS (3) et les nouvelles règles de durabilité", () => {
  const start = server.indexOf("function buildDebateTopicNotionsPrompt(");
  const end = server.indexOf("function extractDebateTopicNotions(");
  const fn = server.slice(start, end);
  assert.match(fn, /0 à \$\{MAX_DEBATE_TOPIC_NOTIONS\} notions distinctes maximum/);
  assert.match(fn, /est un PLAFOND, jamais un objectif à atteindre/);
  assert.match(fn, /Préfère toujours une notion générale et durable à une formulation liée à l'événement précis/);
  assert.match(fn, /titre naturel d'un apprentissage Mnoria autonome/);
  assert.match(fn, /rechercher cette notion dans Mnoria plusieurs mois ou plusieurs années/);
});

test("les deux points de création (POST /api/debates et POST /api/admin/veille/publish) transmettent sourceUrl à generateAndCacheDebateTopicNotions (niveau 1 de la cascade)", () => {
  const occurrences = server.match(/generateAndCacheDebateTopicNotions\(data\.id, \{[\s\S]{0,400}?sourceUrl/g) || [];
  assert.equal(occurrences.length, 2, `attendu 2 sites d'appel transmettant sourceUrl, trouvé ${occurrences.length}`);
});

test("GET /api/debates/:id/notions sélectionne désormais source_url et le transmet (repli lazy couvert par la même cascade)", () => {
  const start = server.indexOf('app.get("/api/debates/:id/notions"');
  const end = server.indexOf("\n});", start) + 4;
  const route = server.slice(start, end);
  assert.match(route, /select\("id, question, content, option_a, option_b, category, source_url, topic_notions, topic_notions_status, topic_notions_generated_at"\)/);
  assert.match(route, /sourceUrl: debate\.source_url/);
});

test("feature knowledge_related_notions est conservée pour l'instrumentation coût des vrais appels IA", () => {
  assert.match(server, /feature: "knowledge_related_notions"/);
});

test("une ligne de log [debate-notions] restitue resolutionSource/duplicateReuseCount/catalogCandidates/catalogSelected/aiCalled/aiReturned", () => {
  const start = server.indexOf('console.info("[debate-notions]"');
  assert.ok(start > -1);
  const block = server.slice(start, start + 400);
  for (const field of ["resolutionSource", "duplicateReuseCount", "catalogCandidates", "catalogSelected", "aiCalled", "aiReturned", "finalCount"]) {
    assert.match(block, new RegExp(field));
  }
});
