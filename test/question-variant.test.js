"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getQuestionVariants,
  selectVariantIndex,
  resolveActiveQuestionVariant,
  resolveQuestionVariantLabel
} = require("../lib/spaced-repetition/question-variant");

// ── Compatibilité historique (749 MemoryItems existants) ──────────────────

test("compat : une question sans altVariant ni variants -> 1 seul variant (elle-même)", () => {
  const question = { id: "q1", type: "qcm", question: "Q ?", options: ["A", "B", "C", "D"], correctIndex: 0 };
  const variants = getQuestionVariants(question);
  assert.equal(variants.length, 1);
  assert.equal(variants[0].question, "Q ?");
});

test("compat : base + altVariant (ancien modèle) -> exactement 2 variants", () => {
  const question = {
    id: "q1", type: "qcm", question: "Base ?", options: ["A", "B", "C", "D"], correctIndex: 0,
    altVariant: { type: "vrai_faux", question: "Alt ?", options: ["Faux", "Vrai"], correctIndex: 1 }
  };
  const variants = getQuestionVariants(question);
  assert.equal(variants.length, 2);
  assert.equal(variants[0].question, "Base ?");
  assert.equal(variants[1].question, "Alt ?");
});

test("compat : sans altVariant, toujours la variante principale quel que soit reviewCount", () => {
  const question = { id: "q1", type: "qcm", question: "Q ?", options: ["A", "B", "C", "D"], correctIndex: 0 };
  for (let n = 0; n < 6; n++) {
    assert.equal(resolveActiveQuestionVariant(question, n), question);
    assert.equal(resolveQuestionVariantLabel(question, n), "v0");
  }
});

test("compat : base + altVariant alterne exactement comme l'ancien modèle (parité stricte)", () => {
  const question = {
    id: "q1", type: "qcm", question: "Base ?", options: ["A", "B", "C", "D"], correctIndex: 0,
    altVariant: { type: "vrai_faux", question: "Alt ?", options: ["Faux", "Vrai"], correctIndex: 1 }
  };
  for (let n = 0; n < 8; n++) {
    const resolved = resolveActiveQuestionVariant(question, n);
    const expected = n % 2 === 0 ? "Base ?" : "Alt ?";
    assert.equal(resolved.question, expected, `n=${n}`);
    assert.equal(resolveQuestionVariantLabel(question, n), n % 2 === 0 ? "v0" : "v1", `n=${n}`);
  }
});

test("compat : les champs partagés (sourceType, sourceDebateId...) survivent à la résolution, même sur l'altVariant", () => {
  const question = {
    id: "q1", type: "qcm", question: "Base ?", options: ["A", "B", "C", "D"], correctIndex: 0,
    sourceType: "concept", sourceDebateId: "abc123", sourceName: "Un concept",
    altVariant: { type: "vrai_faux", question: "Alt ?", options: ["Faux", "Vrai"], correctIndex: 1 }
  };
  const resolved = resolveActiveQuestionVariant(question, 1);
  assert.equal(resolved.sourceType, "concept");
  assert.equal(resolved.sourceDebateId, "abc123");
  assert.equal(resolved.sourceName, "Un concept");
  assert.equal(resolved.id, "q1");
});

// ── Nouveau modèle : 1 à 3 variantes ────────────────────────────────────

test("nouveau modèle : 1 variant explicite se comporte comme l'absence de variante", () => {
  const question = { id: "q1", variants: [{ type: "qcm", question: "Seule variante ?", options: ["A", "B", "C", "D"], correctIndex: 0 }] };
  for (let n = 0; n < 4; n++) {
    assert.equal(resolveQuestionVariantLabel(question, n), "v0");
  }
});

test("nouveau modèle : 3 variantes -> jamais la même deux fois de suite (sur 200 pas, tout seed)", () => {
  const variantCount = 3;
  for (const seed of ["notion:histoire:abc-q1", "notion:custom:xyz-elementaire-q5", "notion:debat-notion:1-q2"]) {
    let previous = null;
    for (let n = 0; n <= 200; n++) {
      const index = selectVariantIndex(seed, n, variantCount);
      assert.ok(index >= 0 && index < variantCount);
      if (n > 0) assert.notEqual(index, previous, `seed=${seed} n=${n} : répétition immédiate`);
      previous = index;
    }
  }
});

test("nouveau modèle : la première résolution (n=0) est toujours la variante principale (index 0)", () => {
  assert.equal(selectVariantIndex("any-seed", 0, 3), 0);
  assert.equal(selectVariantIndex("any-seed", -1, 3), 0);
});

test("nouveau modèle : avec 3 variantes, la rotation n'est pas un cycle rigide 0,1,2,0,1,2 parfaitement prévisible", () => {
  // Au moins un seed doit produire une séquence qui s'écarte du cycle rigide
  // — sinon l'algorithme se réduit à un simple modulo, ce que la refonte
  // demande explicitement d'éviter.
  const rigidCycle = [0, 1, 2, 0, 1, 2, 0, 1, 2, 0];
  let foundNonRigidSeed = false;
  for (const seed of ["seed-a", "seed-b", "seed-c", "seed-d", "seed-e"]) {
    const sequence = [];
    for (let n = 1; n <= 10; n++) sequence.push(selectVariantIndex(seed, n, 3));
    if (JSON.stringify(sequence) !== JSON.stringify(rigidCycle)) foundNonRigidSeed = true;
  }
  assert.ok(foundNonRigidSeed, "au moins un seed devrait s'écarter du cycle rigide 0,1,2,0,1,2...");
});

test("nouveau modèle : resolveActiveQuestionVariant renvoie le contenu de la variante choisie, jamais un mélange", () => {
  const question = {
    id: "q1", sourceType: "concept", sourceDebateId: "abc",
    type: "qcm", question: "V0 ?", options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "expl0",
    variants: [
      { type: "qcm", question: "V0 ?", options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "expl0" },
      { type: "texte_a_trous", question: "V1 ___ ?", options: ["W", "X", "Y", "Z"], correctIndex: 1, explanation: "expl1" },
      { type: "vrai_faux", question: "V2 ?", options: ["Faux", "Vrai"], correctIndex: 1, explanation: "expl2" }
    ]
  };
  for (let n = 0; n <= 6; n++) {
    const resolved = resolveActiveQuestionVariant(question, n);
    const index = selectVariantIndex("q1", n, 3);
    assert.equal(resolved.question, question.variants[index].question);
    assert.equal(resolved.type, question.variants[index].type);
    assert.equal(resolved.explanation, question.variants[index].explanation);
    // Les champs partagés restent présents quelle que soit la variante.
    assert.equal(resolved.sourceType, "concept");
    assert.equal(resolved.id, "q1");
  }
});

test("nouveau modèle : le libellé loggué correspond exactement à l'index résolu", () => {
  const question = {
    id: "q1",
    variants: [
      { type: "qcm", question: "V0" }, { type: "vrai_faux", question: "V1" }, { type: "texte_a_trous", question: "V2" }
    ]
  };
  for (let n = 0; n <= 10; n++) {
    const label = resolveQuestionVariantLabel(question, n);
    const index = selectVariantIndex("q1", n, 3);
    assert.equal(label, `v${index}`);
  }
});
