"use strict";

// Tests purs du client Batch OpenAI (lib/openai-batch-client.js) — AUCUN
// réseau réel : `fetchImpl` est toujours un mock local. Cf. chantier
// "pré-génération en avance des sujets IA proposés" (07/09/2026), test #32/#33
// ("aucune vraie requête réseau dans les tests" / "aucun _callOpenAI réel").

const test = require("node:test");
const assert = require("node:assert/strict");
const batchClient = require("../lib/openai-batch-client");

function fakeResponse({ ok = true, status = 200, json = null, text = null }) {
  return {
    ok,
    status,
    json: async () => json,
    text: async () => (text != null ? text : JSON.stringify(json))
  };
}

test("buildBatchRequestLine : construit une ligne JSONL conforme, exige customId/model/messages", () => {
  const line = batchClient.buildBatchRequestLine({
    customId: "42:curriculum_generation:1",
    model: "gpt-5.6-luna",
    messages: [{ role: "user", content: "hello" }],
    temperature: 0.4,
    responseFormat: { type: "json_object" }
  });
  assert.deepEqual(line, {
    custom_id: "42:curriculum_generation:1",
    method: "POST",
    url: "/v1/chat/completions",
    body: {
      model: "gpt-5.6-luna",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.4,
      response_format: { type: "json_object" }
    }
  });
  assert.throws(() => batchClient.buildBatchRequestLine({ model: "m", messages: [{}] }), /customId/);
  assert.throws(() => batchClient.buildBatchRequestLine({ customId: "x", messages: [{}] }), /model/);
  assert.throws(() => batchClient.buildBatchRequestLine({ customId: "x", model: "m" }), /messages/);
});

test("buildBatchJsonl : une ligne JSON par requête, jamais un tableau", () => {
  const jsonl = batchClient.buildBatchJsonl([
    { custom_id: "a", method: "POST", url: "/v1/chat/completions", body: { model: "m" } },
    { custom_id: "b", method: "POST", url: "/v1/chat/completions", body: { model: "m" } }
  ]);
  const lines = jsonl.split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).custom_id, "a");
  assert.equal(JSON.parse(lines[1]).custom_id, "b");
});

test("submitBatch : upload le fichier PUIS crée le batch, retourne batchId/inputFileId/status", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method });
    if (url.endsWith("/files")) return fakeResponse({ json: { id: "file-123" } });
    if (url.endsWith("/batches")) return fakeResponse({ json: { id: "batch-abc", status: "validating" } });
    throw new Error("URL inattendue : " + url);
  };
  const result = await batchClient.submitBatch(fetchImpl, "sk-test", [
    { custom_id: "a", method: "POST", url: "/v1/chat/completions", body: { model: "m" } }
  ]);
  assert.deepEqual(result, { batchId: "batch-abc", inputFileId: "file-123", status: "validating" });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/files$/);
  assert.match(calls[1].url, /\/batches$/);
});

test("retrieveBatch : retourne le statut brut, lève une erreur sur réponse non-ok", async () => {
  const okFetch = async () => fakeResponse({ json: { id: "batch-abc", status: "completed", output_file_id: "out-1" } });
  const status = await batchClient.retrieveBatch(okFetch, "sk-test", "batch-abc");
  assert.equal(status.status, "completed");

  const failFetch = async () => fakeResponse({ ok: false, status: 404, text: "not found" });
  await assert.rejects(() => batchClient.retrieveBatch(failFetch, "sk-test", "missing"), /not found/);
});

test("downloadFileContent : retourne le texte brut du fichier", async () => {
  const fetchImpl = async () => fakeResponse({ text: "raw-jsonl-content" });
  const content = await batchClient.downloadFileContent(fetchImpl, "sk-test", "out-1");
  assert.equal(content, "raw-jsonl-content");
});

test("parseBatchOutputJsonl : mapping par custom_id, insensible à l'ordre des lignes", () => {
  const jsonl = [
    JSON.stringify({ custom_id: "b", response: { status_code: 200, body: { choices: [{ message: { content: "réponse B" } }] } } }),
    JSON.stringify({ custom_id: "a", response: { status_code: 200, body: { choices: [{ message: { content: "réponse A" } }] } } })
  ].join("\n");
  const results = batchClient.parseBatchOutputJsonl(jsonl);
  assert.equal(results.get("a").content, "réponse A");
  assert.equal(results.get("b").content, "réponse B");
  assert.equal(results.get("a").ok, true);
});

test("parseBatchOutputJsonl : une erreur par requête, jamais un échec global du parsing", () => {
  const jsonl = [
    JSON.stringify({ custom_id: "ok", response: { status_code: 200, body: { choices: [{ message: { content: "bien" } }] } } }),
    JSON.stringify({ custom_id: "erreur-protocole", error: { message: "rate limited" } }),
    JSON.stringify({ custom_id: "erreur-http", response: { status_code: 400, body: { error: { message: "bad request" } } } }),
    JSON.stringify({ custom_id: "vide", response: { status_code: 200, body: { choices: [] } } })
  ].join("\n");
  const results = batchClient.parseBatchOutputJsonl(jsonl);
  assert.equal(results.get("ok").ok, true);
  assert.equal(results.get("erreur-protocole").ok, false);
  assert.match(results.get("erreur-protocole").error, /rate limited/);
  assert.equal(results.get("erreur-http").ok, false);
  assert.match(results.get("erreur-http").error, /bad request/);
  assert.equal(results.get("vide").ok, false);
});

test("parseBatchOutputJsonl : ignore silencieusement les lignes malformées plutôt que de faire échouer tout le parsing", () => {
  const jsonl = [
    "{ceci n'est pas du JSON valide",
    JSON.stringify({ custom_id: "ok", response: { status_code: 200, body: { choices: [{ message: { content: "bien" } }] } } })
  ].join("\n");
  const results = batchClient.parseBatchOutputJsonl(jsonl);
  assert.equal(results.size, 1);
  assert.equal(results.get("ok").ok, true);
});

test("TERMINAL_BATCH_STATUSES : couvre exactement completed/failed/expired/cancelled", () => {
  assert.deepEqual([...batchClient.TERMINAL_BATCH_STATUSES].sort(), ["cancelled", "completed", "expired", "failed"]);
  assert.equal(batchClient.TERMINAL_BATCH_STATUSES.has("in_progress"), false);
  assert.equal(batchClient.TERMINAL_BATCH_STATUSES.has("validating"), false);
});
