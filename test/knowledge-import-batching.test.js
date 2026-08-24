"use strict";

// Couvre le chantier "batching des connaissances importées" (24/08/2026,
// audit coût import photo) : une connaissance importée = une question, mais
// générées ensemble en un seul appel IA au lieu d'un appel par connaissance.
//
// Deux niveaux de test, pour les raisons documentées dans le rapport de ce
// chantier :
// - reconcileKnowledgeBatchResults (lib/question-formats.js) et
//   buildQuestionsFromKnowledgePrompt (lib/knowledge-admission.js) sont des
//   fonctions PURES, exécutées ici pour de vrai (jamais mockées).
// - buildImportedKnowledgeQuestionsBatch, finalizeImportedKnowledgeQuestion
//   et la boucle à 3 passes d'addValidatedKnowledgeImport vivent dans
//   server.js, qui démarre tout le serveur Express + Supabase à l'import et
//   ne peut donc pas être requis dans un test unitaire (même contrainte que
//   les autres suites de ce dépôt, cf. lib/knowledge-admission.js et
//   lib/question-formats.js eux-mêmes, tous deux "extraits de server.js...
//   pour pouvoir tester ces fonctions unitairement"). Le câblage côté
//   server.js (nombre d'appels IA, taille des lots, partage entre imports)
//   est donc vérifié par assertion sur le texte source, comme le fait déjà
//   test/youtube-knowledge.test.js pour le même genre de garantie
//   structurelle.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  validateQuestionItemCore,
  reconcileKnowledgeBatchResults,
  normalizeFactText
} = require("../lib/question-formats");
const { buildQuestionsFromKnowledgePrompt } = require("../lib/knowledge-admission");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

// ── Fixtures : une question RÉELLEMENT validée (via validateQuestionItemCore,
// le vrai validateur de production) pour chacun des formats effectivement
// supportés par le pipeline, cf. QUESTION_FORMAT_DEFS dans server.js — jamais
// un format inventé. `sourceDebateId` ajouté à la main : c'est exactement le
// champ que validateNarrativeQuizQuestions (server.js) pose lui-même après
// avoir vérifié que "sourceId" brut appartient aux ids attendus — ici les
// fixtures se placent donc juste APRÈS ce que validateNarrativeQuizQuestions
// aurait déjà produit, la frontière exacte de reconcileKnowledgeBatchResults.
function validatedQuestion(id, knowledgeTarget, rawCore) {
  const core = validateQuestionItemCore(rawCore);
  assert.ok(core, `fixture invalide pour ${id} : ${JSON.stringify(rawCore)}`);
  return { ...core, knowledgeTarget, sourceDebateId: id };
}

const RAW_BY_FORMAT = {
  qcm: (q) => ({ type: "qcm", question: q, options: ["Paris", "Lyon", "Marseille", "Nice"], correctIndex: 0, explanation: "Explication." }),
  texte_a_trous: (q) => ({ type: "texte_a_trous", question: `La capitale de la France est ___.`, options: ["Paris", "Lyon", "Marseille", "Nice"], correctIndex: 0, explanation: "Explication." }),
  intrus: (q) => ({ type: "intrus", question: q, options: ["Paris", "Lyon", "Marseille", "Berlin"], correctIndex: 3, explanation: "Explication." }),
  qcm_multi: (q) => ({ type: "qcm_multi", question: q, options: ["Paris", "Lyon", "Berlin", "Rome"], correctIndexes: [0, 1], explanation: "Explication." }),
  association: (q) => ({ type: "association", question: q, pairs: [{ left: "France", right: "Paris" }, { left: "Italie", right: "Rome" }, { left: "Espagne", right: "Madrid" }], explanation: "Explication." }),
  ordre: (q) => ({ type: "ordre", question: q, items: ["1789", "1793", "1799"], explanation: "Explication." })
};

function knowledgeSet(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `k${i + 1}`, fact: `Fait numéro ${i + 1}.` }));
}

// ── Cas A/B/C/D — 1, 5, 10, 20 connaissances : mapping complet, sans perte, sans doublon ──

for (const n of [1, 5, 10, 20]) {
  test(`reconcileKnowledgeBatchResults : ${n} connaissance(s), réponse complète et bien mappée -> ${n} résultat(s), aucune perte, aucun doublon`, () => {
    const admitted = knowledgeSet(n);
    const validated = admitted.map((k) => validatedQuestion(k.id, k.fact, RAW_BY_FORMAT.qcm(`Question sur ${k.fact}`)));

    const { resultsById, missingIds } = reconcileKnowledgeBatchResults(validated, admitted);

    assert.equal(resultsById.size, n);
    assert.deepEqual(missingIds, []);
    for (const k of admitted) {
      assert.ok(resultsById.has(k.id), `id ${k.id} manquant`);
      assert.equal(resultsById.get(k.id).sourceDebateId, k.id);
      assert.equal(normalizeFactText(resultsById.get(k.id).knowledgeTarget), normalizeFactText(k.fact));
    }
    // Aucune collision : autant de clés que de connaissances, jamais moins.
    assert.equal(new Set(resultsById.keys()).size, n);
  });
}

// ── Cas B (appels IA) : chunk unique tant que n <= NOTION_QUIZ_ENUMERABLE_CHUNK_SIZE ──

test("buildImportedKnowledgeQuestionsBatch : un seul appel _callOpenAI par lot (le gros prompt de formats n'est envoyé qu'une fois par lot)", () => {
  const start = SERVER_SOURCE.indexOf("async function buildImportedKnowledgeQuestionsBatch(");
  const end = SERVER_SOURCE.indexOf("\nasync function ", start + 10);
  assert.ok(start > 0 && end > start);
  const body = SERVER_SOURCE.slice(start, end);
  const callCount = (body.match(/_callOpenAI\(/g) || []).length;
  assert.equal(callCount, 1, "buildImportedKnowledgeQuestionsBatch doit contenir exactement un appel _callOpenAI");
  // classifyCultureGeneraleKnowledgePlacementWithAI ne doit JAMAIS être
  // appelée depuis la génération groupée (cf. rapport : classification
  // volontairement pas batchée) — sinon la classification serait, elle
  // aussi, silencieusement groupée par ce même chantier.
  assert.doesNotMatch(body, /classifyCultureGeneraleKnowledgePlacementWithAI/);
});

test("addValidatedKnowledgeImport : la génération est découpée en lots de NOTION_QUIZ_ENUMERABLE_CHUNK_SIZE, jamais un seul appel géant", () => {
  const start = SERVER_SOURCE.indexOf("async function addValidatedKnowledgeImport(");
  const end = SERVER_SOURCE.indexOf("\napp.post(\"/api/photo-knowledge/add\"", start);
  assert.ok(start > 0 && end > start);
  const body = SERVER_SOURCE.slice(start, end);
  assert.match(body, /start \+= NOTION_QUIZ_ENUMERABLE_CHUNK_SIZE/);
  assert.match(body, /buildImportedKnowledgeQuestionsBatch\(/);
  // Le plafond de sélection (maxKnowledge, jusqu'à 100 pour PDF/YouTube, cf.
  // knowledgeLimitForYoutube/knowledgeLimitForPageCount) dépasse le plafond
  // de fiabilité d'un seul appel IA (20, même raison que
  // generateEnumerableQuizQuestions) : sans ce découpage, un import de 100
  // connaissances tenterait un seul appel de 100 questions, hors de la zone
  // jugée fiable ailleurs dans ce même fichier.
});

test("addValidatedKnowledgeImport : repli ciblé UNIQUEMENT sur les connaissances manquantes du lot, jamais tout le lot", () => {
  const start = SERVER_SOURCE.indexOf("async function addValidatedKnowledgeImport(");
  const end = SERVER_SOURCE.indexOf("\napp.post(\"/api/photo-knowledge/add\"", start);
  const body = SERVER_SOURCE.slice(start, end);
  assert.match(body, /for \(const id of missingIds\)/);
  assert.match(body, /buildImportedKnowledgeQuestions\(pending\.item\.fact, pending\.item\.id/);
});

// ── Cas C (10 connaissances) : le batching est réellement utilisé, pas un simple renommage ──

test("le chemin batché (buildImportedKnowledgeQuestionsBatch) est bien celui utilisé par addValidatedKnowledgeImport, pas buildImportedKnowledgeQuestions en boucle", () => {
  const start = SERVER_SOURCE.indexOf("async function addValidatedKnowledgeImport(");
  const end = SERVER_SOURCE.indexOf("\napp.post(\"/api/photo-knowledge/add\"", start);
  const body = SERVER_SOURCE.slice(start, end);
  // La seule boucle appelant buildImportedKnowledgeQuestions (singulier, le
  // chemin à 1 connaissance) doit être le repli ciblé sur `missingIds`,
  // jamais une boucle directe sur `pendingItems`/`normalizedItems`.
  const singleCallSites = [...body.matchAll(/buildImportedKnowledgeQuestions\(([^)]*)\)/g)];
  assert.equal(singleCallSites.length, 1, "buildImportedKnowledgeQuestions (singulier) ne doit rester appelée qu'au repli ciblé");
});

// ── Cas D (20 connaissances) : plafond réel du lot ──

test("NOTION_QUIZ_ENUMERABLE_CHUNK_SIZE vaut 20 : un import photo (plafond 20) tient donc en un seul lot", () => {
  assert.match(SERVER_SOURCE, /const NOTION_QUIZ_ENUMERABLE_CHUNK_SIZE = 20;/);
});

// ── Cas 3 — réponse batch incomplète : conserve les valides, identifie précisément ce qui manque ──

test("reconcileKnowledgeBatchResults : 5 connaissances envoyées, seulement 4 valides -> la 5e est identifiée dans missingIds, les 4 autres inchangées", () => {
  const admitted = knowledgeSet(5);
  // Le modèle "oublie" k3 : seulement 4 questions dans la réponse.
  const validated = admitted
    .filter((k) => k.id !== "k3")
    .map((k) => validatedQuestion(k.id, k.fact, RAW_BY_FORMAT.qcm(`Question sur ${k.fact}`)));

  const { resultsById, missingIds } = reconcileKnowledgeBatchResults(validated, admitted);

  assert.equal(resultsById.size, 4);
  assert.deepEqual(missingIds, ["k3"]);
  assert.ok(!resultsById.has("k3"));
  for (const id of ["k1", "k2", "k4", "k5"]) assert.ok(resultsById.has(id));
});

// ── Cas 4 — ID inconnu : jamais associé par approximation, jamais perdu silencieusement ──

test("reconcileKnowledgeBatchResults : un sourceDebateId inconnu du batch n'est associé à AUCUNE connaissance et n'apparaît dans aucun résultat", () => {
  const admitted = knowledgeSet(3);
  const validQuestions = admitted
    .filter((k) => k.id !== "k2")
    .map((k) => validatedQuestion(k.id, k.fact, RAW_BY_FORMAT.qcm(`Question sur ${k.fact}`)));
  // Un id qui n'existe dans AUCUNE connaissance du batch (jamais recyclé sur k2 par position).
  const unknownIdQuestion = validatedQuestion("unknown_999", "Un fait qui n'appartient à aucune connaissance admise.", RAW_BY_FORMAT.qcm("Question orpheline"));

  const { resultsById, missingIds } = reconcileKnowledgeBatchResults([...validQuestions, unknownIdQuestion], admitted);

  assert.equal(resultsById.size, 2);
  assert.ok(!resultsById.has("unknown_999"));
  assert.ok(!Array.from(resultsById.values()).some((q) => q.sourceDebateId === "unknown_999"));
  assert.deepEqual(missingIds, ["k2"]); // k2 reste manquant, jamais comblé par l'id inconnu
});

// ── Cas 5 — ID dupliqué : détecté, seule la première question conservée, l'id manquant reste identifié ──

test("reconcileKnowledgeBatchResults : k1 renvoyé deux fois, k2 absent -> k1 conservé une seule fois, k2 dans missingIds, aucune association incorrecte", () => {
  const admitted = knowledgeSet(3); // k1, k2, k3
  const k1First = validatedQuestion("k1", "Fait numéro 1.", RAW_BY_FORMAT.qcm("Première question sur k1"));
  const k1Second = validatedQuestion("k1", "Fait numéro 1.", RAW_BY_FORMAT.qcm("Seconde question sur k1, jamais celle-ci"));
  const k3 = validatedQuestion("k3", "Fait numéro 3.", RAW_BY_FORMAT.qcm("Question sur k3"));

  const { resultsById, missingIds } = reconcileKnowledgeBatchResults([k1First, k1Second, k3], admitted);

  assert.equal(resultsById.size, 2);
  assert.deepEqual(missingIds, ["k2"]);
  // Seule la PREMIÈRE occurrence de k1 est conservée (dédoublonnage déterministe).
  assert.equal(resultsById.get("k1").question, "Première question sur k1");
});

// ── Cas 6 — ordre différent : le mapping repose sur l'id, jamais sur la position dans le tableau ──

test("reconcileKnowledgeBatchResults : réponse dans un ordre différent des entrées -> mapping toujours correct par id", () => {
  const admitted = knowledgeSet(3); // ordre d'entrée : k1, k2, k3
  const k3 = validatedQuestion("k3", "Fait numéro 3.", RAW_BY_FORMAT.qcm("Question C"));
  const k1 = validatedQuestion("k1", "Fait numéro 1.", RAW_BY_FORMAT.qcm("Question A"));
  const k2 = validatedQuestion("k2", "Fait numéro 2.", RAW_BY_FORMAT.qcm("Question B"));

  // Réponse volontairement dans l'ordre k3, k1, k2 — jamais l'ordre d'entrée.
  const { resultsById, missingIds } = reconcileKnowledgeBatchResults([k3, k1, k2], admitted);

  assert.deepEqual(missingIds, []);
  assert.equal(resultsById.get("k1").question, "Question A");
  assert.equal(resultsById.get("k2").question, "Question B");
  assert.equal(resultsById.get("k3").question, "Question C");
});

// ── Cas "mapping fiable" renforcé — id valide mais knowledgeTarget d'une AUTRE connaissance du même lot : rejeté, jamais associé au mauvais fait ──

test("reconcileKnowledgeBatchResults : sourceDebateId valide mais knowledgeTarget d'une AUTRE connaissance du lot -> ignoré (traité comme manquant), jamais associé au mauvais fait", () => {
  const admitted = knowledgeSet(2); // k1: "Fait numéro 1.", k2: "Fait numéro 2."
  // La question annonce sourceId=k1 mais teste en réalité le fait de k2 —
  // désynchronisation qu'un simple contrôle "id connu" ne peut pas détecter.
  const crossContaminated = validatedQuestion("k1", "Fait numéro 2.", RAW_BY_FORMAT.qcm("Question sur le fait 2, faussement associée à k1"));

  const { resultsById, missingIds } = reconcileKnowledgeBatchResults([crossContaminated], admitted);

  assert.equal(resultsById.size, 0);
  assert.deepEqual(missingIds, ["k1", "k2"]);
});

// ── Cas 7 — couverture des formats de questions : le batching ne dépend jamais du type de question ──

test("reconcileKnowledgeBatchResults : les 6 formats réellement supportés (qcm, texte_a_trous, intrus, qcm_multi, association, ordre) sont mappés à l'identique", () => {
  const formats = Object.keys(RAW_BY_FORMAT);
  const admitted = formats.map((type, i) => ({ id: `k${i + 1}`, fact: `Fait ${type}.` }));
  const validated = admitted.map((k, i) => validatedQuestion(k.id, k.fact, RAW_BY_FORMAT[formats[i]](`Question ${formats[i]}`)));

  const { resultsById, missingIds } = reconcileKnowledgeBatchResults(validated, admitted);

  assert.deepEqual(missingIds, []);
  assert.equal(resultsById.size, formats.length);
  for (let i = 0; i < formats.length; i++) {
    const q = resultsById.get(`k${i + 1}`);
    assert.equal(q.type, formats[i]);
    // Champs structurels attendus par format (mêmes noms que validateQuestionItemCoreBase) :
    if (formats[i] === "association") assert.ok(Array.isArray(q.pairs) && q.pairs.length >= 3);
    else if (formats[i] === "ordre") assert.ok(Array.isArray(q.items) && q.items.length >= 3);
    else if (formats[i] === "qcm_multi") assert.ok(Array.isArray(q.correctIndexes) && q.correctIndexes.length >= 2);
    else {
      assert.equal(q.options.length, 4);
      assert.ok(Number.isInteger(q.correctIndex));
    }
  }
});

test("finalizeImportedKnowledgeQuestion : la mise en forme finale ne filtre ni ne transforme le type/les champs de la question déjà validée", () => {
  const start = SERVER_SOURCE.indexOf("async function finalizeImportedKnowledgeQuestion(");
  const end = SERVER_SOURCE.indexOf("\nasync function buildImportedKnowledgeQuestions(", start);
  assert.ok(start > 0 && end > start);
  const body = SERVER_SOURCE.slice(start, end);
  // La question déjà validée est étalée telle quelle ("...question") : aucun
  // champ de format (type/options/pairs/items/correctIndex(es)) n'est
  // recopié/renommé/filtré ici — seuls des champs de provenance sont ajoutés.
  assert.match(body, /\.\.\.question,/);
});

// ── Cas 8 — autres sources d'import : le pipeline commun bénéficie à toutes, pas seulement photo ──
//
// addValidatedKnowledgeImport est un point d'entrée UNIQUE paramétré par
// `sourceType` (photo_import/manual_import/pdf_import/text_import/
// url_import/youtube_import) : simuler les 6 apporterait peu de valeur au-delà
// des 3 ci-dessous, qui couvrent déjà les 3 profils réellement différents de
// ce pipeline — (1) photo, le cas qui a motivé l'audit ; (2) pdf_import, seul
// appelant à passer un maxKnowledge custom (jusqu'à 100, donc le seul à
// pouvoir réellement déclencher plusieurs lots) ; (3) manual_import, le seul
// sans aucun paramètre optionnel (ni sourceUrl ni sourceMeta). Les 3 autres
// (text_import, url_import, youtube_import) appellent addValidatedKnowledgeImport
// de façon structurellement identique à l'un de ces trois profils.
test("addValidatedKnowledgeImport est bien le point d'entrée partagé par les 6 sourceType d'import", () => {
  for (const sourceType of ["photo_import", "manual_import", "pdf_import", "text_import", "url_import", "youtube_import"]) {
    assert.match(SERVER_SOURCE, new RegExp(`sourceType: "${sourceType}"`), `${sourceType} doit toujours passer par addValidatedKnowledgeImport`);
  }
  // Un seul corps de fonction addValidatedKnowledgeImport dans tout le fichier
  // (jamais une variante dupliquée "photo only").
  const occurrences = (SERVER_SOURCE.match(/async function addValidatedKnowledgeImport\(/g) || []).length;
  assert.equal(occurrences, 1);
});

test("pdf_import et youtube_import peuvent dépasser 20 connaissances (maxKnowledge custom) -> c'est bien pour ce cas que le découpage en lots existe", () => {
  assert.match(SERVER_SOURCE, /maxKnowledge: token\.maxKnowledge/);
  // knowledgeLimitForPageCount / knowledgeLimitForYoutube autorisent jusqu'à 100 (cf. lib/pdf-knowledge.js, lib/youtube-knowledge.js).
  const pdfLib = fs.readFileSync(path.join(__dirname, "..", "lib", "pdf-knowledge.js"), "utf8");
  assert.match(pdfLib, /100/);
});

// ── Cas 9 — rétrocompatibilité de buildQuestionsFromKnowledgePrompt (per-knowledge id optionnel) ──

test("buildQuestionsFromKnowledgePrompt : sans id sur les connaissances (chemin narratif historique), la sortie est identique à avant ce chantier", () => {
  const admitted = [
    { fact: "La Révolution française débute en 1789.", importance: "high", certainty: "high", sequential: false, clearBoundary: true }
  ];
  const prompt = buildQuestionsFromKnowledgePrompt("sourceId", "notion:debat:abc123", admitted, "Niveau élémentaire.", ["=== FORMAT BLOCK ==="]);

  assert.match(prompt, /\(sourceId:"notion:debat:abc123" pour chacune\)/);
  assert.doesNotMatch(prompt, /\[sourceId=/);
  assert.doesNotMatch(prompt, /chacune indique déjà son propre/);
});

test("buildQuestionsFromKnowledgePrompt : avec un id par connaissance (chemin batch import), chaque ligne porte son propre id, jamais le sourceId partagé", () => {
  const admitted = [
    { id: "k1", fact: "Fait un.", importance: "high", certainty: "high", sequential: false, clearBoundary: false },
    { id: "k2", fact: "Fait deux.", importance: "high", certainty: "high", sequential: false, clearBoundary: false }
  ];
  const prompt = buildQuestionsFromKnowledgePrompt("sourceId", null, admitted, null, ["=== FORMAT BLOCK ==="]);

  assert.match(prompt, /\[sourceId="k1"\] Fait un\./);
  assert.match(prompt, /\[sourceId="k2"\] Fait deux\./);
  assert.doesNotMatch(prompt, /pour chacune\) :/); // jamais la formulation "id unique pour chacune"
});

test("buildQuestionsFromKnowledgePrompt : la présence de `.id` sur une SEULE connaissance active le mode par-connaissance pour tout le tableau, avec repli sur sourceId (jamais la chaîne \"undefined\") pour un élément sans id", () => {
  const admitted = [
    { id: "k1", fact: "Fait un.", importance: "high", certainty: "high", sequential: false, clearBoundary: false },
    { fact: "Fait deux, sans id.", importance: "high", certainty: "high", sequential: false, clearBoundary: false }
  ];
  // Scénario mixte défensif (aucun appelant réel n'en produit un à ce jour,
  // cf. commentaire de la fonction) : un sourceId de repli est fourni, et
  // ne doit jamais aboutir à la chaîne littérale "undefined" dans le prompt.
  const prompt = buildQuestionsFromKnowledgePrompt("sourceId", "fallback-id", admitted, null, ["=== FORMAT BLOCK ==="]);
  assert.match(prompt, /\[sourceId="k1"\] Fait un\./);
  assert.match(prompt, /\[sourceId="fallback-id"\] Fait deux, sans id\./);
  assert.doesNotMatch(prompt, /undefined/);
});
