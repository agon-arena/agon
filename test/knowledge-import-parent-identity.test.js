"use strict";

// Correctif "fragmentation des connaissances importées" (diagnostic du
// 01/09/2026) : un import (photo/pdf/texte/manuel/url/youtube) contenant
// plusieurs faits ne doit produire qu'UNE SEULE connaissance visible dans
// "Ma mémoire", quel que soit le nombre de questions/faits qu'il contient.
// Avant ce correctif, finalizeImportedKnowledgeQuestion posait
// `sourceDebateId: id` (hash du FAIT individuel, cf. normalizeCustomTopicKey)
// au lieu de `sourceDebateId: documentImportId` (partagé par tout l'import) —
// chaque fait devenait donc sa propre connaissance (exemple réel : import
// photo "Hitler", 9 connaissances visibles au lieu d'1 pour 10 questions).
//
// finalizeImportedKnowledgeQuestion vit dans server.js, qui démarre tout le
// serveur Express + Supabase à l'import et ne peut donc pas être requis dans
// un test unitaire (même contrainte que test/knowledge-import-batching.test.js
// et test/help-level-reveal-gate.test.js) : la fonction RÉELLE est extraite
// telle quelle du fichier source et exécutée dans un sandbox `vm`, avec
// classifyCultureGeneraleKnowledgePlacementWithAI (sa seule dépendance
// externe, un appel IA) stubbée. Rien de la logique testée n'est dupliqué ici.
//
// buildMemoryItemNaturalKey (lib/spaced-repetition/memory-model.js) est en
// revanche une fonction pure exportée : exécutée pour de vrai, sans sandbox.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { buildMemoryItemNaturalKey } = require("../lib/spaced-repetition/memory-model");
const { buildImportParentTitleFallback } = require("../lib/photo-knowledge-sheet");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

function extract(startMarker, endMarker, endSearchFrom) {
  const start = SERVER_SOURCE.indexOf(startMarker);
  assert.ok(start > 0, `marqueur de début introuvable : ${startMarker}`);
  const end = SERVER_SOURCE.indexOf(endMarker, endSearchFrom ?? start + 10);
  assert.ok(end > start, `marqueur de fin introuvable : ${endMarker}`);
  return SERVER_SOURCE.slice(start, end);
}

const FINALIZE_SOURCE = extract(
  "async function finalizeImportedKnowledgeQuestion(",
  "\nasync function buildImportedKnowledgeQuestions("
);
const BUILD_NOTION_QUESTIONS_SOURCE = extract(
  "async function buildNotionQuestions(",
  "\n// ── QCM d'un sujet libre"
);
const ADD_VALIDATED_IMPORT_SOURCE = extract(
  "async function addValidatedKnowledgeImport(",
  '\napp.post("/api/photo-knowledge/add"'
);
const RECORD_ACQUISITION_SOURCE = extract(
  "async function recordDailyQuizEclairageAcquisition(",
  "\nasync function applyFsrsReviewForDailyQuizAnswer("
);
const UPSERT_MEMORY_ITEM_START = SERVER_SOURCE.indexOf("async function upsertMemoryItemForNotionAnswer(");
assert.ok(UPSERT_MEMORY_ITEM_START > 0, "marqueur upsertMemoryItemForNotionAnswer introuvable");
const UPSERT_MEMORY_ITEM_SOURCE = SERVER_SOURCE.slice(UPSERT_MEMORY_ITEM_START, UPSERT_MEMORY_ITEM_START + 900);

// Un placement différent par appel (paramétrable) — simule le fait que
// chaque connaissance importée est classée indépendamment (cf. commentaire
// de finalizeImportedKnowledgeQuestion) : le correctif ne repose PAS sur le
// fait que toutes les questions obtiennent le même placement à la
// génération, seulement sur le partage de sourceDebateId.
function makeSandbox(placementBySourceName) {
  let callCount = 0;
  const calls = [];
  const sandbox = {
    buildImportParentTitleFallback,
    classifyCultureGeneraleKnowledgePlacementWithAI: async (sourceType, sourceName, classificationDetail, userId, sourceDebateIdParam) => {
      callCount += 1;
      calls.push({ sourceType, sourceName, classificationDetail, userId, sourceDebateIdParam });
      if (typeof placementBySourceName === "function") return placementBySourceName(sourceName);
      return placementBySourceName || { category: "Histoire", galaxy: "Histoire", solarSystemId: 1, starId: 1 };
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(FINALIZE_SOURCE, sandbox);
  return { sandbox, calls, getCallCount: () => callCount };
}

const SHARED_SOURCE_DETAIL = {
  documentImportId: "doc-abc-123",
  documentTitle: "Hitler et le régime nazi",
  meta: "Document importé depuis une photo",
  sections: []
};

const FACTS_10 = [
  "Hitler arrive au pouvoir de manière démocratique le 30 janvier 1933.",
  "Il devient chancelier du Reich.",
  "Le parti nazi (NSDAP) interdit les autres partis politiques.",
  "Les lois de Nuremberg de 1935 excluent les juifs de la société civile.",
  "Le régime met en place la Gestapo et les SS.",
  "Le traité de Versailles n'est pas respecté par le régime.",
  "L'antisémitisme est enseigné aux enfants dans les écoles.",
  "Des camps de concentration sont mis en place dès 1933.",
  "Le régime prépare l'annexion de territoires voisins.",
  "La propagande nazie contrôle les médias du pays."
];

function makeQuestion(index) {
  return { type: "qcm", question: `Question ${index}`, options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "Explication." };
}

// ── Test A — import photo : 10 faits, identité conceptuelle unique ────────

test("Test A — 10 faits d'un même import : 10 question.id distincts, un seul sourceDebateId (documentImportId), sourceName identique et stable", async () => {
  const { sandbox } = makeSandbox();
  const documentImportId = SHARED_SOURCE_DETAIL.documentImportId;
  const results = [];
  for (let i = 0; i < FACTS_10.length; i++) {
    const fact = FACTS_10[i];
    const id = `fact-hash-${i + 1}`; // équivalent de normalizeCustomTopicKey(fact), distinct par fait
    const finalized = await sandbox.finalizeImportedKnowledgeQuestion(
      makeQuestion(i + 1), fact, id, "user-1", SHARED_SOURCE_DETAIL, documentImportId, "photo_import"
    );
    results.push(finalized);
  }

  // 10 question.id distincts (granularité technique préservée).
  const questionIds = results.map((r) => r.id);
  assert.equal(new Set(questionIds).size, 10, "les 10 question.id doivent rester distincts");

  // Un seul sourceDebateId partagé par les 10 questions, et il vaut
  // documentImportId — jamais un hash par fait.
  const sourceDebateIds = new Set(results.map((r) => r.sourceDebateId));
  assert.equal(sourceDebateIds.size, 1, "sourceDebateId doit être identique pour les 10 questions du même import");
  assert.equal(results[0].sourceDebateId, documentImportId, "sourceDebateId doit être le documentImportId, pas le hash du fait");

  // sourceName identique et stable, dérivé du document, jamais du fait
  // individuel — sinon le libellé dépendrait de la première question réussie.
  const sourceNames = new Set(results.map((r) => r.sourceName));
  assert.equal(sourceNames.size, 1, "sourceName doit être identique quelle que soit la question");
  assert.equal(results[0].sourceName, SHARED_SOURCE_DETAIL.documentTitle, "sourceName doit venir du titre du document, pas du fait");

  // Aucune dépendance de l'identité conceptuelle au fait individuel : le
  // sourceDebateId ne doit jamais correspondre au hash par fait passé en id.
  for (let i = 0; i < results.length; i++) {
    assert.notEqual(results[i].sourceDebateId, `fact-hash-${i + 1}`);
  }
});

// ── Test B — FSRS : l'unicité de memory_items ne dépend pas de subject_source_id ──

test("Test B — buildMemoryItemNaturalKey (memory_items) : 10 questions du même import/subject_source_id -> 10 clés naturelles distinctes", () => {
  const slot = "notion:photo_import:doc-abc-123";
  const quizDate = "2026-09-01";
  const keys = FACTS_10.map((_, i) => buildMemoryItemNaturalKey({ slot, quizDate, questionId: `notion:photo_import:doc-abc-123:fact-hash-${i + 1}-q1` }));
  assert.equal(new Set(keys).size, 10, "10 questions du même import doivent produire 10 memory_items distincts");

  // La fonction ne prend même pas subject_source_id/sourceDebateId en
  // paramètre (seuls slot/quizDate/questionId, cf. sa signature) : l'unicité
  // de memory_items repose entièrement sur ce triplet, jamais sur l'identité
  // de connaissance partagée entre les questions d'un même import.
  assert.deepEqual(buildMemoryItemNaturalKey.length, 1, "buildMemoryItemNaturalKey ne prend qu'un seul argument ({slot, quizDate, questionId}), aucun paramètre d'identité de connaissance");
});

test("Test B (bis) — upsertMemoryItemForNotionAnswer : la clé d'upsert est natural_key (slot::quizDate::questionId), jamais subject_source_id", () => {
  assert.match(UPSERT_MEMORY_ITEM_SOURCE, /onConflict:\s*"natural_key"/, "memory_items doit rester dédupliqué par natural_key, pas par subject_source_id");
  assert.match(UPSERT_MEMORY_ITEM_SOURCE, /subject_source_id:\s*String\(question\.sourceDebateId\)/, "subject_source_id doit continuer à porter l'identité de connaissance (désormais documentImportId), séparément de la clé d'upsert");
  assert.match(UPSERT_MEMORY_ITEM_SOURCE, /question_id:\s*questionId/, "question_id doit rester porté par memory_items, distinct par question");
});

// ── Test C — acquisition : Q1/Q2/Q3 correctes du même import -> toujours 1 seule connaissance ──

test("Test C — recordDailyQuizEclairageAcquisition : early-return \"déjà acquis\" avant toute écriture, upsert unique sur (user_id, eclairage_type, eclairage_source_id)", () => {
  // La clé qui décide qu'une acquisition existe déjà est (user_id,
  // eclairage_type, eclairage_source_id) -- avec sourceDebateId désormais
  // partagé par tout l'import, la 2e/3e/... bonne réponse d'un même import
  // tombe systématiquement dans ce early-return, avant toute tentative
  // d'écriture ou de classification.
  const earlyReturnIndex = RECORD_ACQUISITION_SOURCE.indexOf("if (existingAcquisition) return;");
  assert.ok(earlyReturnIndex > 0, "le early-return \"déjà acquis\" doit exister");

  const upsertIndex = RECORD_ACQUISITION_SOURCE.indexOf('.upsert(\n');
  assert.ok(upsertIndex > earlyReturnIndex, "l'upsert doit intervenir APRÈS le early-return, jamais avant");

  assert.match(RECORD_ACQUISITION_SOURCE, /eq\("eclairage_type", sourceType\)/);
  assert.match(RECORD_ACQUISITION_SOURCE, /eq\("eclairage_source_id", sourceDebateId\)/);
  assert.match(RECORD_ACQUISITION_SOURCE, /onConflict:\s*"user_id,eclairage_type,eclairage_source_id"/);
  assert.match(RECORD_ACQUISITION_SOURCE, /ignoreDuplicates:\s*true/);

  // findAndStoreCultureGeneraleNotionLink (liens IA entre connaissances)
  // n'est appelée qu'APRÈS l'upsert d'une acquisition réellement nouvelle :
  // avec sourceDebateId partagé, elle ne peut donc plus jamais tourner pour
  // la 2e/3e question d'un même import (déjà écartées par le early-return
  // ci-dessus) -- aucun lien "fragment A du document <-> fragment B du même
  // document" ne peut donc plus être créé.
  const linkIndex = RECORD_ACQUISITION_SOURCE.indexOf("findAndStoreCultureGeneraleNotionLink(");
  assert.ok(linkIndex > upsertIndex, "le lien IA entre connaissances ne doit être tenté qu'après une acquisition réellement nouvelle");
});

// ── Test D — plusieurs imports distincts : aucune collision de sourceDebateId ──

test("Test D — deux imports différents produisent deux sourceDebateId distincts (aucune fusion entre imports)", async () => {
  const { sandbox } = makeSandbox();
  const finalizedA = await sandbox.finalizeImportedKnowledgeQuestion(
    makeQuestion(1), FACTS_10[0], "fact-hash-1", "user-1",
    { ...SHARED_SOURCE_DETAIL, documentImportId: "doc-A" }, "doc-A", "photo_import"
  );
  const finalizedB = await sandbox.finalizeImportedKnowledgeQuestion(
    makeQuestion(1), "Un fait totalement différent d'un autre import.", "fact-hash-1", "user-1",
    { ...SHARED_SOURCE_DETAIL, documentImportId: "doc-B", documentTitle: "Un autre sujet" }, "doc-B", "photo_import"
  );
  assert.notEqual(finalizedA.sourceDebateId, finalizedB.sourceDebateId);
  assert.equal(finalizedA.sourceDebateId, "doc-A");
  assert.equal(finalizedB.sourceDebateId, "doc-B");
});

// ── Test E — les 6 types d'import partagent le même comportement d'identité ──

test("Test E — sourceDebateId = documentImportId quel que soit sourceType (photo/pdf/texte/manuel/url/youtube)", async () => {
  const { sandbox } = makeSandbox();
  const documentImportId = "doc-multi-type";
  for (const sourceType of ["photo_import", "pdf_import", "text_import", "manual_import", "url_import", "youtube_import"]) {
    const finalized = await sandbox.finalizeImportedKnowledgeQuestion(
      makeQuestion(1), "Un fait quelconque.", "fact-hash-x", "user-1", SHARED_SOURCE_DETAIL, documentImportId, sourceType
    );
    assert.equal(finalized.sourceDebateId, documentImportId, `sourceDebateId doit être documentImportId pour sourceType=${sourceType}`);
    assert.equal(finalized.sourceType, sourceType);
  }
});

test("Test E (bis) — addValidatedKnowledgeImport reste le point d'entrée unique des 6 sourceType, tous finalisés par finalizeImportedKnowledgeQuestion", () => {
  for (const sourceType of ["photo_import", "manual_import", "pdf_import", "text_import", "url_import", "youtube_import"]) {
    assert.match(SERVER_SOURCE, new RegExp(`sourceType: "${sourceType}"`));
  }
  assert.match(ADD_VALIDATED_IMPORT_SOURCE, /finalizeImportedKnowledgeQuestion\(/);
});

// ── Test F — le pipeline notion historique (Éclairages / sujet libre) reste inchangé ──

test("Test F — buildNotionQuestions n'est pas touché par ce correctif : sourceDebateId reste `id` (un seul id par sujet, jamais par fait)", () => {
  assert.match(BUILD_NOTION_QUESTIONS_SOURCE, /sourceDebateId:\s*id\b/, "buildNotionQuestions doit continuer à poser sourceDebateId=id (comportement déjà correct, non modifié)");
  assert.doesNotMatch(BUILD_NOTION_QUESTIONS_SOURCE, /sourceDebateId:\s*documentImportId/, "buildNotionQuestions ne doit jamais référencer documentImportId : ce correctif est scopé aux imports");
});

// ── Test G — import multi-thématique : une seule identité conceptuelle malgré des placements différents ──

test("Test G — faits couvrant des sous-thèmes différents d'un même import (placements IA différents) -> même sourceDebateId, même sourceName", async () => {
  // Simule des classifications IA différentes par fait (lois raciales vs
  // régime nazi vs conflits...), exactement le scénario réel qui fragmentait
  // "Ma mémoire" avant le correctif.
  const placements = {
    "Les lois de Nuremberg de 1935 excluent les juifs de la société civile.": { category: "Histoire", galaxy: "Histoire", solarSystemId: 10, starId: 201 },
    "Le régime met en place la Gestapo et les SS.": { category: "Histoire", galaxy: "Histoire", solarSystemId: 10, starId: 198 },
    "Le traité de Versailles n'est pas respecté par le régime.": { category: "Histoire", galaxy: "Histoire", solarSystemId: 10, starId: 199 }
  };
  const { sandbox, getCallCount } = makeSandbox((sourceName) => placements[sourceName] || { category: "Histoire", galaxy: "Histoire", solarSystemId: 10, starId: 194 });

  const multiThemeFacts = Object.keys(placements);
  const documentImportId = "doc-multitheme";
  const results = [];
  for (let i = 0; i < multiThemeFacts.length; i++) {
    const fact = multiThemeFacts[i];
    const finalized = await sandbox.finalizeImportedKnowledgeQuestion(
      makeQuestion(i + 1), fact, `fact-hash-${i + 1}`, "user-1", SHARED_SOURCE_DETAIL, documentImportId, "photo_import"
    );
    results.push(finalized);
  }

  // Les placements IA renvoyés diffèrent réellement (vérifie que le test
  // simule bien le cas problématique, pas un cas déjà trivial).
  const distinctStarIds = new Set(results.map((r) => r.sourcePlacement.starId));
  assert.ok(distinctStarIds.size > 1, "le scénario doit simuler des classifications IA différentes par fait");

  // Malgré des placements différents par fait, l'identité conceptuelle
  // (sourceDebateId) et le nom affiché restent uniques et partagés -- c'est
  // recordDailyQuizEclairageAcquisition (Test C) qui garantit ensuite qu'un
  // seul de ces placements sera effectivement retenu dans "Ma mémoire" (le
  // premier acquis), jamais un par étoile classée.
  assert.equal(new Set(results.map((r) => r.sourceDebateId)).size, 1);
  assert.equal(new Set(results.map((r) => r.sourceName)).size, 1);
  assert.equal(getCallCount(), multiThemeFacts.length, "aucun appel IA supplémentaire introduit par le correctif (toujours 1 classification par fait, comme avant)");
});

// ── Pas de coût IA supplémentaire ──

test("finalizeImportedKnowledgeQuestion : toujours exactement un appel IA de classification, jamais plus (aucun coût IA ajouté par le correctif)", async () => {
  const { sandbox, getCallCount } = makeSandbox();
  await sandbox.finalizeImportedKnowledgeQuestion(
    makeQuestion(1), FACTS_10[0], "fact-hash-1", "user-1", SHARED_SOURCE_DETAIL, "doc-abc-123", "photo_import"
  );
  assert.equal(getCallCount(), 1);
});

// ── sourceName : repli défensif si documentTitle est absent ──

test("sourceName utilise un fallback parent si documentTitle est absent, jamais le fait individuel", async () => {
  const { sandbox } = makeSandbox();
  const finalized = await sandbox.finalizeImportedKnowledgeQuestion(
    makeQuestion(1), "Un fait sans titre de document.", "fact-hash-1", "user-1",
    { documentImportId: "doc-no-title", sections: [] }, "doc-no-title", "manual_import"
  );
  assert.equal(finalized.sourceName, "Apprentissage personnalisé");
  assert.notEqual(finalized.sourceName, "Un fait sans titre de document.");
});
