"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { NOES_BATCH_SIZE, buildNoesBatches, noesBatchCount } = require("../lib/coeus/noes-batch");

test("NOES_BATCH_SIZE vaut 5 (au plus 5 connaissances par vidéo)", () => {
  assert.equal(NOES_BATCH_SIZE, 5);
});

test("découpe en lots canoniques de 5 par position (1-5, 6-10, ...)", () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ knowledgeId: `k${i + 1}` }));
  const batches = buildNoesBatches(items);
  assert.equal(batches.length, 3);
  assert.deepEqual(batches[0].map((i) => i.knowledgeId), ["k1", "k2", "k3", "k4", "k5"]);
  assert.deepEqual(batches[1].map((i) => i.knowledgeId), ["k6", "k7", "k8", "k9", "k10"]);
  assert.deepEqual(batches[2].map((i) => i.knowledgeId), ["k11", "k12"]);
});

test("20 connaissances -> exactement 4 lots pleins", () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ knowledgeId: `k${i + 1}` }));
  const batches = buildNoesBatches(items);
  assert.equal(batches.length, 4);
  for (const batch of batches) assert.equal(batch.length, 5);
});

test("le découpage est déterministe : même tableau, même résultat", () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ knowledgeId: `k${i + 1}` }));
  assert.deepEqual(buildNoesBatches(items), buildNoesBatches(items));
});

test("noesBatchCount correspond au nombre de lots produits par buildNoesBatches", () => {
  for (const n of [0, 1, 5, 6, 7, 20, 23]) {
    const items = Array.from({ length: n }, (_, i) => ({ knowledgeId: `k${i}` }));
    assert.equal(noesBatchCount(n), buildNoesBatches(items).length, `n=${n}`);
  }
});

test("entrée non-tableau -> aucun lot", () => {
  assert.deepEqual(buildNoesBatches(null), []);
  assert.deepEqual(buildNoesBatches(undefined), []);
});
