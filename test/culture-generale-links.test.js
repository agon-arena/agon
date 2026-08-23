"use strict";

// Couvre les parties déterministes du renforcement des liens entre
// connaissances du 17/08/2026 (rejet des liens factuels-mais-génériques type
// "Rome capitale de l'Italie" ↔ "Aldo Moro", QCM "Comprendre" à 1-6 questions
// au lieu d'un palier fixe 2/4/6). La pertinence sémantique elle-même (un
// lien est-il vraiment significatif, une question est-elle vraiment
// nécessaire) est assurée par le prompt et le modèle IA, jamais reproduite
// ici — ce fichier teste uniquement la mécanique programmatique autour
// d'elle : parsing/validation/plafond de la réponse IA, ordre canonique de
// stockage, assemblage d'une session de révision. Même philosophie que
// test/fsrs-integration.test.js : aucun accès réseau/DB, fonctions pures
// uniquement (le bout-en-bout réel se vérifie manuellement).

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cultureGeneraleNotionKey,
  canonicalNotionLinkPair,
  selectValidNotionLinks,
  assembleComprehensionSession
} = require("../lib/culture-generale-links");

// ── cultureGeneraleNotionKey ───────────────────────────────────────────────

test("cultureGeneraleNotionKey : identité canonique type::id", () => {
  assert.equal(cultureGeneraleNotionKey("histoire", "42"), "histoire::42");
});

// ── canonicalNotionLinkPair (stockage canonique A/B, contrainte UNIQUE) ────

test("canonicalNotionLinkPair : même paire quel que soit le sens A->B ou B->A", () => {
  const forward = canonicalNotionLinkPair("histoire", "1", "César", "eclairage", "9", "Ides de mars");
  const backward = canonicalNotionLinkPair("eclairage", "9", "Ides de mars", "histoire", "1", "César");
  assert.deepEqual(forward, backward);
});

test("canonicalNotionLinkPair : conserve les noms attachés au bon côté après réordonnancement", () => {
  const { typeA, idA, nameA, typeB, idB, nameB } = canonicalNotionLinkPair(
    "z-type", "1", "Nom Z",
    "a-type", "2", "Nom A"
  );
  // "a-type::2" < "z-type::1" -> le côté A doit devenir a-type/2/Nom A.
  assert.equal(typeA, "a-type");
  assert.equal(idA, "2");
  assert.equal(nameA, "Nom A");
  assert.equal(typeB, "z-type");
  assert.equal(idB, "1");
  assert.equal(nameB, "Nom Z");
});

test("canonicalNotionLinkPair : une paire différente ne collapse jamais sur la même clé", () => {
  const pair1 = canonicalNotionLinkPair("histoire", "1", "A", "histoire", "2", "B");
  const pair2 = canonicalNotionLinkPair("histoire", "1", "A", "histoire", "3", "C");
  const asKey = (p) => `${cultureGeneraleNotionKey(p.typeA, p.idA)}|${cultureGeneraleNotionKey(p.typeB, p.idB)}`;
  assert.notEqual(asKey(pair1), asKey(pair2));
});

// ── selectValidNotionLinks ──────────────────────────────────────────────────

function candidateMap(entries) {
  return new Map(entries.map(([type, id, name]) => [cultureGeneraleNotionKey(type, id), { type, id, name }]));
}

test("selectValidNotionLinks : aucun lien -> résultat normal, tableau vide", () => {
  const candidates = candidateMap([["histoire", "1", "César"]]);
  assert.deepEqual(selectValidNotionLinks([], candidates), []);
  assert.deepEqual(selectValidNotionLinks(null, candidates), []);
  assert.deepEqual(selectValidNotionLinks(undefined, candidates), []);
});

test("selectValidNotionLinks : lien causal direct valide -> accepté avec son libellé", () => {
  const candidates = candidateMap([["histoire", "1", "Assassinat aux Ides de mars"]]);
  const result = selectValidNotionLinks(
    [{ related_key: "histoire::1", label: "Victime directe" }],
    candidates
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].label, "Victime directe");
  assert.equal(result[0].match.name, "Assassinat aux Ides de mars");
});

test("selectValidNotionLinks : lien œuvre <-> événement inspirateur valide -> accepté", () => {
  const candidates = candidateMap([["eclairage", "7", "Bombardement de Guernica"]]);
  const result = selectValidNotionLinks(
    [{ related_key: "eclairage::7", label: "Inspire le tableau" }],
    candidates
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].match.id, "7");
});

test("selectValidNotionLinks : clé absente des candidats (hallucination IA) -> rejeté mécaniquement", () => {
  const candidates = candidateMap([["histoire", "1", "César"]]);
  const result = selectValidNotionLinks(
    [{ related_key: "histoire::999-inexistant", label: "Lien inventé" }],
    candidates
  );
  assert.deepEqual(result, []);
});

test("selectValidNotionLinks : label manquant -> rejeté (même si la clé est valide)", () => {
  const candidates = candidateMap([["histoire", "1", "César"]]);
  const result = selectValidNotionLinks([{ related_key: "histoire::1", label: "" }], candidates);
  assert.deepEqual(result, []);
});

test("selectValidNotionLinks : related_key dupliqué -> une seule occurrence conservée", () => {
  const candidates = candidateMap([["histoire", "1", "César"]]);
  const result = selectValidNotionLinks(
    [
      { related_key: "histoire::1", label: "Premier libellé" },
      { related_key: "histoire::1", label: "Second libellé" }
    ],
    candidates
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].label, "Premier libellé");
});

test("selectValidNotionLinks : maximum 3 liens toujours respecté même si l'IA en renvoie davantage", () => {
  const candidates = candidateMap([
    ["histoire", "1", "A"], ["histoire", "2", "B"], ["histoire", "3", "C"],
    ["histoire", "4", "D"], ["histoire", "5", "E"]
  ]);
  const raw = [1, 2, 3, 4, 5].map((n) => ({ related_key: `histoire::${n}`, label: `Lien ${n}` }));
  const result = selectValidNotionLinks(raw, candidates, 3);
  assert.equal(result.length, 3);
});

test("selectValidNotionLinks : le plafond reste paramétrable (pas figé à 3 en dur)", () => {
  const candidates = candidateMap([["histoire", "1", "A"], ["histoire", "2", "B"]]);
  const raw = [1, 2].map((n) => ({ related_key: `histoire::${n}`, label: `Lien ${n}` }));
  assert.equal(selectValidNotionLinks(raw, candidates, 1).length, 1);
});

// ── assembleComprehensionSession (QCM "Comprendre", 1 à 6 questions) ───────

test("assembleComprehensionSession : une banque à une seule question est acceptée (plus de plancher à 2)", () => {
  const banks = [["q1-unique"]];
  assert.deepEqual(assembleComprehensionSession(banks, 6), ["q1-unique"]);
});

test("assembleComprehensionSession : plusieurs banques de tailles différentes s'entrelacent round-robin", () => {
  const banks = [
    ["a1", "a2", "a3"],
    ["b1"],
    ["c1", "c2"]
  ];
  const session = assembleComprehensionSession(banks, 6);
  // Round-robin par index : a1,b1,c1 puis a2,c2 puis a3 (b et c épuisées avant a).
  assert.deepEqual(session, ["a1", "b1", "c1", "a2", "c2", "a3"]);
});

test("assembleComprehensionSession : respecte le plafond maxQuestions même si plus de contenu est disponible", () => {
  const banks = [["a1", "a2", "a3", "a4", "a5", "a6", "a7"]];
  const session = assembleComprehensionSession(banks, 6);
  assert.equal(session.length, 6);
});

test("assembleComprehensionSession : aucune banque -> session vide, pas d'erreur", () => {
  assert.deepEqual(assembleComprehensionSession([], 6), []);
});

test("assembleComprehensionSession : banques vides ou invalides ignorées sans planter", () => {
  const banks = [[], null, undefined, ["only"]];
  assert.deepEqual(assembleComprehensionSession(banks, 6), ["only"]);
});

test("assembleComprehensionSession : n'impose plus aucune hypothèse de comptage 2/4/6", () => {
  // Trois banques à 1 question chacune (jadis exclues par l'ancien filtre
  // `questions.length >= 2`) doivent toutes apparaître dans la session.
  const banks = [["x"], ["y"], ["z"]];
  const session = assembleComprehensionSession(banks, 6);
  assert.equal(session.length, 3);
  assert.deepEqual(session.sort(), ["x", "y", "z"]);
});
