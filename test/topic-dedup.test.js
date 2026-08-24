"use strict";

// Couvre lib/topic-dedup.js (niveau 2 de déduplication des recherches IA,
// audit du 24/08/2026) — le niveau 1 (normalizeCustomTopicKey, server.js)
// n'est pas touché par ce module et n'est donc pas retesté ici.

const test = require("node:test");
const assert = require("node:assert/strict");
const { isSafeTopicEquivalent, findEquivalentCustomTopic, parseCustomTopicSlotLevel } = require("../lib/topic-dedup");

test("variantes sûres (articles/stopwords/ponctuation/accents/tournures interrogatives) : MATCH", () => {
  const pairs = [
    ["dates de la révolution française", "dates révolution française"],
    ["dates de la révolution française", "les dates de la révolution française"],
    ["la révolution française", "révolution française"],
    ["qu'est-ce que la photosynthèse ?", "photosynthèse"],
    ["les principales dates de la seconde guerre mondiale", "principales dates seconde guerre mondiale"]
  ];
  for (const [a, b] of pairs) {
    assert.equal(isSafeTopicEquivalent(a, b), true, `attendu MATCH : "${a}" / "${b}"`);
  }
});

test("mots structurants divergents : NO MATCH quel que soit le recouvrement lexical", () => {
  const pairs = [
    ["causes révolution française", "conséquences révolution française"],
    ["dates révolution française", "personnages révolution française"],
    ["définition de la photosynthèse", "fonctionnement de la photosynthèse"],
    ["avantages du télétravail", "inconvénients du télétravail"],
    ["chronologie de la révolution française", "causes de la révolution française"]
  ];
  for (const [a, b] of pairs) {
    assert.equal(isSafeTopicEquivalent(a, b), false, `attendu NO MATCH (mot structurant) : "${a}" / "${b}"`);
  }
});

test("entités différentes : NO MATCH", () => {
  const pairs = [
    ["révolution française", "révolution russe"],
    ["première guerre mondiale", "seconde guerre mondiale"],
    ["photosynthèse", "respiration cellulaire"],
    ["dates seconde guerre mondiale", "causes seconde guerre mondiale"]
  ];
  for (const [a, b] of pairs) {
    assert.equal(isSafeTopicEquivalent(a, b), false, `attendu NO MATCH (entités différentes) : "${a}" / "${b}"`);
  }
});

test("cas adversaire : beaucoup de tokens communs mais un mot structurant différent -> NO MATCH", () => {
  const pairs = [
    [
      "dates de la révolution française du 18e siècle en Europe",
      "personnages de la révolution française du 18e siècle en Europe"
    ],
    [
      "les causes profondes de la révolution française de 1789",
      "les conséquences profondes de la révolution française de 1789"
    ]
  ];
  for (const [a, b] of pairs) {
    assert.equal(isSafeTopicEquivalent(a, b), false, `attendu NO MATCH (cas adversaire) : "${a}" / "${b}"`);
  }
});

test("sujets réduits à des mots-outils : jamais de match par défaut", () => {
  assert.equal(isSafeTopicEquivalent("de la", "pour le"), false);
});

test("findEquivalentCustomTopic : ignore les candidats de niveau différent (appelant responsable du filtrage)", () => {
  // findEquivalentCustomTopic ne connaît pas le niveau : c'est server.js qui
  // doit ne lui passer que les candidats déjà filtrés au bon niveau — ce
  // test verrouille juste le comportement de la fonction pure elle-même.
  const candidates = [
    { slot: "notion:custom:aaa:expert", level: "expert", topicText: "dates révolution française" }
  ];
  const match = findEquivalentCustomTopic("dates de la révolution française", candidates);
  assert.equal(match.slot, "notion:custom:aaa:expert");
});

test("findEquivalentCustomTopic : renvoie null si aucun candidat n'est un équivalent sûr", () => {
  const candidates = [
    { slot: "notion:custom:bbb", level: null, topicText: "révolution russe" },
    { slot: "notion:custom:ccc", level: null, topicText: "photosynthèse" }
  ];
  assert.equal(findEquivalentCustomTopic("révolution française", candidates), null);
});

test("findEquivalentCustomTopic : ignore les candidats sans topicText exploitable", () => {
  const candidates = [
    { slot: "notion:custom:ddd", level: null, topicText: "" },
    { slot: "notion:custom:eee", level: null, topicText: null },
    { slot: "notion:custom:fff", level: null, topicText: "révolution française" }
  ];
  const match = findEquivalentCustomTopic("la révolution française", candidates);
  assert.equal(match.slot, "notion:custom:fff");
});

test("parseCustomTopicSlotLevel : slot sans niveau -> null", () => {
  assert.equal(parseCustomTopicSlotLevel(`notion:custom:${"a".repeat(16)}`), null);
});

test("parseCustomTopicSlotLevel : slot avec niveau -> le niveau", () => {
  assert.equal(parseCustomTopicSlotLevel(`notion:custom:${"a".repeat(16)}:expert`), "expert");
});

test("parseCustomTopicSlotLevel : slot d'un autre type (notion débat, éclairages...) -> undefined", () => {
  assert.equal(parseCustomTopicSlotLevel("notion:eclairage:abc123"), undefined);
  assert.equal(parseCustomTopicSlotLevel(""), undefined);
});
