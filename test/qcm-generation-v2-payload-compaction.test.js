"use strict";

// V2 pipeline QCM (02/09/2026, audit instrumenté "Taoïsme") — CHANGEMENT 2 :
// compaction des payloads accepted/rejected envoyés à
// question_targeted_regeneration (server.js, fonction regenerate() dans
// qualityControlRawQuestions). server.js démarre tout le serveur Express à
// l'import et ne peut donc pas être require()-é dans un test unitaire : les
// 4 fonctions pures ajoutées par ce correctif (summarizeCorrectAnswerText,
// summarizeAcceptedQuestionForRegeneration, compactRejectedVariant,
// compactQuestionForRegeneration) sont extraites telles quelles du fichier
// source et exécutées dans un sandbox `vm` — même technique que
// test/knowledge-import-parent-identity.test.js. Aucune logique n'est
// dupliquée ici.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

function extract(startMarker, endMarker) {
  const start = SERVER_SOURCE.indexOf(startMarker);
  assert.ok(start >= 0, `marqueur de début introuvable : ${startMarker}`);
  const end = SERVER_SOURCE.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `marqueur de fin introuvable : ${endMarker}`);
  return SERVER_SOURCE.slice(start, end);
}

const COMPACTION_SOURCE = extract(
  "function summarizeCorrectAnswerText(primaryVariant) {",
  "\n// Chaîne V2 commune à toutes les sorties fraîchement générées."
);

function makeSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(COMPACTION_SOURCE, sandbox);
  return sandbox;
}

// ── Questions de test, une par format réellement supporté
// (server.js QUESTION_FORMAT_DEFS) ──────────────────────────────────────

const QCM_QUESTION = {
  knowledgeTarget: "Paris est la capitale de la France.",
  type: "qcm",
  question: "Quelle est la capitale de la France ?",
  options: ["Paris", "Lyon", "Marseille", "Nice"],
  correctIndex: 0,
  explanation: "Paris est la capitale depuis des siècles.",
  selfContained: true,
  supporting_claim: "La capitale de la France est Paris.",
  source_ids: ["SOURCE_1"]
};

const TEXTE_A_TROUS_QUESTION = {
  knowledgeTarget: "Le Taoïsme trouve son origine en Chine.",
  type: "texte_a_trous",
  question: "Le Taoïsme trouve son origine en ___.",
  options: ["Chine", "Inde", "Japon", "Corée"],
  correctIndex: 0,
  explanation: "..."
};

const INTRUS_QUESTION = {
  knowledgeTarget: "Le NKVD, le Goulag et la Grande Terreur sont liés à la répression soviétique.",
  type: "intrus",
  question: "Lequel de ces éléments n'est pas lié à la répression soviétique ?",
  options: ["Le NKVD", "Le Goulag", "La Grande Terreur", "Le réalisme socialiste"],
  correctIndex: 3,
  explanation: "..."
};

const QCM_MULTI_QUESTION = {
  knowledgeTarget: "Le Yin et le Yang sont des principes complémentaires du Taoïsme.",
  type: "qcm_multi",
  question: "Lesquels de ces principes appartiennent au Taoïsme ?",
  options: ["Le Yin", "Le Yang", "Le Nirvana", "Le Karma", "Le Wu Wei"],
  correctIndexes: [0, 1, 4],
  explanation: "..."
};

const ASSOCIATION_QUESTION = {
  knowledgeTarget: "Plusieurs philosophes taoïstes sont associés à des textes fondateurs.",
  type: "association",
  question: "Associe chaque philosophe à son texte.",
  pairs: [
    { left: "Laozi", right: "Tao Te King" },
    { left: "Zhuangzi", right: "Zhuangzi" },
    { left: "Liezi", right: "Liezi" }
  ],
  explanation: "..."
};

const ORDRE_QUESTION = {
  knowledgeTarget: "Le Taoïsme suit une évolution historique en plusieurs étapes.",
  type: "ordre",
  question: "Remets ces étapes dans l'ordre chronologique.",
  items: ["Rédaction du Tao Te King", "Développement du taoïsme religieux", "Codification sous la dynastie Tang"],
  explanation: "..."
};

const ALL_FORMATS = [
  ["qcm", QCM_QUESTION],
  ["texte_a_trous", TEXTE_A_TROUS_QUESTION],
  ["intrus", INTRUS_QUESTION],
  ["qcm_multi", QCM_MULTI_QUESTION],
  ["association", ASSOCIATION_QUESTION],
  ["ordre", ORDRE_QUESTION]
];

// ── summarizeCorrectAnswerText / summarizeAcceptedQuestionForRegeneration ──

test("summarizeCorrectAnswerText : qcm/texte_a_trous/intrus retournent le texte de l'option correctIndex", () => {
  const sandbox = makeSandbox();
  assert.equal(sandbox.summarizeCorrectAnswerText(QCM_QUESTION), "Paris");
  assert.equal(sandbox.summarizeCorrectAnswerText(TEXTE_A_TROUS_QUESTION), "Chine");
  assert.equal(sandbox.summarizeCorrectAnswerText(INTRUS_QUESTION), "Le réalisme socialiste");
});

test("summarizeCorrectAnswerText : qcm_multi retourne toutes les réponses correctes de correctIndexes, jamais options[correctIndex]", () => {
  const sandbox = makeSandbox();
  const result = sandbox.summarizeCorrectAnswerText(QCM_MULTI_QUESTION);
  assert.equal(result, "Le Yin / Le Yang / Le Wu Wei");
});

test("summarizeCorrectAnswerText : association (sans options/correctIndex) utilise pairs, jamais undefined", () => {
  const sandbox = makeSandbox();
  const result = sandbox.summarizeCorrectAnswerText(ASSOCIATION_QUESTION);
  assert.equal(result, "Laozi → Tao Te King ; Zhuangzi → Zhuangzi ; Liezi → Liezi");
});

test("summarizeCorrectAnswerText : ordre (sans options/correctIndex) utilise items, jamais undefined", () => {
  const sandbox = makeSandbox();
  const result = sandbox.summarizeCorrectAnswerText(ORDRE_QUESTION);
  assert.equal(result, "Rédaction du Tao Te King → Développement du taoïsme religieux → Codification sous la dynastie Tang");
});

test("summarizeCorrectAnswerText : ne jette jamais d'exception sur une question malformée (options/correctIndex absents)", () => {
  const sandbox = makeSandbox();
  assert.equal(sandbox.summarizeCorrectAnswerText({}), null);
  assert.equal(sandbox.summarizeCorrectAnswerText(null), null);
  assert.equal(sandbox.summarizeCorrectAnswerText({ type: "qcm" }), null);
});

test("summarizeAcceptedQuestionForRegeneration : ne transmet plus que knowledgeTarget + correctAnswerText, jamais question/options/sourceId", () => {
  const sandbox = makeSandbox();
  const result = sandbox.summarizeAcceptedQuestionForRegeneration(QCM_QUESTION);
  assert.deepEqual(Object.keys(result).sort(), ["correctAnswerText", "knowledgeTarget"]);
  assert.equal(result.knowledgeTarget, "Paris est la capitale de la France.");
  assert.equal(result.correctAnswerText, "Paris");
  assert.ok(!("question" in result), "le texte complet de la question ne doit plus être transmis");
  assert.ok(!("options" in result), "les 4 options complètes ne doivent plus être transmises");
  assert.ok(!("sourceId" in result), "sourceId n'est utile à aucune règle de regenerate()");
});

test("summarizeAcceptedQuestionForRegeneration : fonctionne aussi sur une question au format variants[] (sujet libre, includeVariants=true)", () => {
  const sandbox = makeSandbox();
  const wrapped = {
    knowledgeTarget: QCM_QUESTION.knowledgeTarget,
    supporting_claim: QCM_QUESTION.supporting_claim,
    source_ids: QCM_QUESTION.source_ids,
    variants: [
      { ...QCM_QUESTION, retrievalMode: "direct" },
      { type: "qcm", question: "Quelle ville est la capitale française ?", options: ["Paris", "Lyon", "Toulouse", "Nantes"], correctIndex: 0, retrievalMode: "inverse", explanation: "..." }
    ]
  };
  const result = sandbox.summarizeAcceptedQuestionForRegeneration(wrapped);
  assert.equal(result.correctAnswerText, "Paris", "doit lire la variante principale (variants[0]), pas la question elle-même");
});

for (const [formatName, question] of ALL_FORMATS) {
  test(`summarizeAcceptedQuestionForRegeneration : produit un correctAnswerText non vide pour le format "${formatName}"`, () => {
    const sandbox = makeSandbox();
    const result = sandbox.summarizeAcceptedQuestionForRegeneration(question);
    assert.ok(result.correctAnswerText, `le format ${formatName} doit produire une représentation compacte non vide de sa réponse`);
  });
}

// ── compactQuestionForRegeneration / compactRejectedVariant ────────────────

test("compactQuestionForRegeneration : retire explanation/selfContained mais conserve type/question/options/correctIndex", () => {
  const sandbox = makeSandbox();
  const result = sandbox.compactQuestionForRegeneration(QCM_QUESTION);
  assert.equal(result.type, "qcm");
  assert.equal(result.question, QCM_QUESTION.question);
  assert.deepEqual(result.options, QCM_QUESTION.options);
  assert.equal(result.correctIndex, 0);
  assert.ok(!("explanation" in result), "explanation n'est jamais nécessaire pour corriger un motif de rejet");
  assert.ok(!("selfContained" in result), "selfContained n'est jamais nécessaire pour corriger un motif de rejet");
});

for (const [formatName, question] of ALL_FORMATS) {
  test(`compactQuestionForRegeneration : reste correct et reconstructible pour le format "${formatName}"`, () => {
    const sandbox = makeSandbox();
    const result = sandbox.compactQuestionForRegeneration(question);
    assert.equal(result.type, question.type);
    if (question.options) assert.deepEqual(result.options, question.options);
    if (question.correctIndex !== undefined) assert.equal(result.correctIndex, question.correctIndex);
    if (question.correctIndexes) assert.deepEqual(result.correctIndexes, question.correctIndexes);
    if (question.pairs) assert.deepEqual(result.pairs, question.pairs);
    if (question.items) assert.deepEqual(result.items, question.items);
    assert.ok(!("explanation" in result));
  });
}

test("compactQuestionForRegeneration : conserve supporting_claim/source_ids — une question rejetée GROUNDING_* reste reconstructible", () => {
  const sandbox = makeSandbox();
  const result = sandbox.compactQuestionForRegeneration(QCM_QUESTION);
  assert.equal(result.supporting_claim, "La capitale de la France est Paris.");
  assert.deepEqual(result.source_ids, ["SOURCE_1"]);
});

test("compactQuestionForRegeneration : conserve variants (jamais retiré) pour une question au format variants[], chaque variante compactée", () => {
  const sandbox = makeSandbox();
  const wrapped = {
    knowledgeTarget: QCM_QUESTION.knowledgeTarget,
    supporting_claim: QCM_QUESTION.supporting_claim,
    source_ids: QCM_QUESTION.source_ids,
    variants: [
      { ...QCM_QUESTION, retrievalMode: "direct" },
      { type: "qcm", question: "Variante inverse ?", options: ["Paris", "Lyon", "Toulouse", "Nantes"], correctIndex: 0, retrievalMode: "inverse", explanation: "explication inutile" }
    ]
  };
  const result = sandbox.compactQuestionForRegeneration(wrapped);
  assert.ok(Array.isArray(result.variants), "variants doit rester un tableau, jamais aplati sur la seule variante principale");
  assert.equal(result.variants.length, 2, "les 2 variantes doivent rester présentes — une variante secondaire peut être la cause du rejet");
  assert.equal(result.variants[1].question, "Variante inverse ?");
  assert.ok(!("explanation" in result.variants[0]), "explanation retirée de CHAQUE variante");
  assert.ok(!("retrievalMode" in result.variants[0]), "retrievalMode n'est jamais nécessaire pour corriger un motif de rejet");
  assert.equal(result.supporting_claim, QCM_QUESTION.supporting_claim, "supporting_claim reste au niveau racine, pas dupliqué par variante");
});

test("compactQuestionForRegeneration : n'ajoute jamais supporting_claim/source_ids quand absents (comportement des appelants sans grounding inchangé)", () => {
  const sandbox = makeSandbox();
  const result = sandbox.compactQuestionForRegeneration(TEXTE_A_TROUS_QUESTION);
  assert.ok(!("supporting_claim" in result));
  assert.ok(!("source_ids" in result));
});

// ── Câblage réel : regenerate() utilise bien ces fonctions, plus jamais
// l'objet brut complet / les options complètes de l'ancien code ──────────

test("regenerate() (qualityControlRawQuestions) construit rejectionPayload via compactQuestionForRegeneration, jamais entry.question brut", () => {
  const fnStart = SERVER_SOURCE.indexOf("regenerate: async ({ rejected, accepted, attempt }) => {");
  assert.ok(fnStart > 0);
  const fnBody = SERVER_SOURCE.slice(fnStart, fnStart + 700);
  assert.match(fnBody, /rejectedQuestion:\s*compactQuestionForRegeneration\(entry\.question\)/);
  assert.doesNotMatch(fnBody, /rejectedQuestion:\s*entry\.question,/, "l'ancien objet brut complet ne doit plus être transmis directement");
});

test("regenerate() construit acceptedPayload via summarizeAcceptedQuestionForRegeneration, jamais {question, options} complets", () => {
  const fnStart = SERVER_SOURCE.indexOf("regenerate: async ({ rejected, accepted, attempt }) => {");
  const fnBody = SERVER_SOURCE.slice(fnStart, fnStart + 1100);
  assert.match(fnBody, /const acceptedPayload = accepted\.map\(summarizeAcceptedQuestionForRegeneration\);/);
  assert.doesNotMatch(fnBody, /question\?\.\s*variants\?\.\[0\]\?\.question/, "l'ancien texte complet de la question acceptée ne doit plus être reconstruit ici");
});
