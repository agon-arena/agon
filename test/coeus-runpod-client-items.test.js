"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CoeusRunpodError, createCoeusRunpodClient } = require("../lib/coeus/runpod-client");

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function clientWith(fetchImpl, extra = {}) {
  return createCoeusRunpodClient({
    endpointId: "endpoint_123",
    apiKey: "secret-test-key",
    fetchImpl,
    requestTimeoutMs: 100,
    ...extra,
  });
}

test("submitCoeusItemsVideo soumet en mode asynchrone /run (jamais /runsync)", async () => {
  let captured;
  const client = clientWith(async (url, options) => {
    captured = { url, options };
    return jsonResponse({ id: "job_items_1", status: "IN_QUEUE" });
  });

  const job = await client.submitCoeusItemsVideo({
    items: [{ question: "En quelle année ?", answer: "1453" }],
    thinkingPauseSeconds: 3,
    itemGapSeconds: 0.6,
  });

  assert.equal(job.id, "job_items_1");
  assert.equal(job.status, "IN_QUEUE");
  assert.equal(captured.url, "https://api.runpod.ai/v2/endpoint_123/run");
  assert.deepEqual(JSON.parse(captured.options.body), {
    input: {
      mode: "items",
      items: [{ question: "En quelle année ?", answer: "1453" }],
      thinking_pause_seconds: 3,
      item_gap_seconds: 0.6,
    },
  });
});

test("submitCoeusItemsVideo ne bloque jamais en attendant le rendu (retourne dès l'accusé de réception RunPod)", async () => {
  let callCount = 0;
  const client = clientWith(async () => {
    callCount += 1;
    return jsonResponse({ id: "job_items_2", status: "IN_QUEUE" });
  });
  const job = await client.submitCoeusItemsVideo({ items: [{ question: "Q", answer: "A" }] });
  assert.equal(job.status, "IN_QUEUE");
  assert.equal(callCount, 1); // un seul appel HTTP, aucun polling interne
});

test("trim question/answer avant envoi", async () => {
  let captured;
  const client = clientWith(async (url, options) => {
    captured = options;
    return jsonResponse({ id: "job_items_3", status: "IN_QUEUE" });
  });
  await client.submitCoeusItemsVideo({ items: [{ question: "  Q ?  ", answer: "  A.  " }] });
  const body = JSON.parse(captured.body);
  assert.deepEqual(body.input.items, [{ question: "Q ?", answer: "A." }]);
});

test("refuse un batch vide ou supérieur à 5 connaissances", async () => {
  const client = clientWith(async () => jsonResponse({ id: "x", status: "IN_QUEUE" }));
  await assert.rejects(client.submitCoeusItemsVideo({ items: [] }), { code: "RUNPOD_INPUT_ERROR" });
  await assert.rejects(
    client.submitCoeusItemsVideo({ items: Array.from({ length: 6 }, () => ({ question: "Q", answer: "A" })) }),
    { code: "RUNPOD_INPUT_ERROR" }
  );
});

test("refuse un item sans question ou sans réponse", async () => {
  const client = clientWith(async () => jsonResponse({ id: "x", status: "IN_QUEUE" }));
  await assert.rejects(client.submitCoeusItemsVideo({ items: [{ question: "", answer: "A" }] }), { code: "RUNPOD_INPUT_ERROR" });
  await assert.rejects(client.submitCoeusItemsVideo({ items: [{ question: "Q" }] }), { code: "RUNPOD_INPUT_ERROR" });
});

test("propage une erreur RunPod HTTP sans exposer la clé API", async () => {
  const client = clientWith(async () => jsonResponse({ error: "bad request" }, 400));
  await assert.rejects(
    client.submitCoeusItemsVideo({ items: [{ question: "Q", answer: "A" }] }),
    (error) => {
      assert.ok(error instanceof CoeusRunpodError);
      assert.equal(error.code, "RUNPOD_HTTP_ERROR");
      assert.equal(error.message.includes("secret-test-key"), false);
      return true;
    }
  );
});
