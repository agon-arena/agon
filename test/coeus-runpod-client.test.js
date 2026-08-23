"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CoeusRunpodError,
  RUNPOD_JOB_STATES,
  createCoeusRunpodClient,
} = require("../lib/coeus/runpod-client");

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clientWith(fetchImpl, extra = {}) {
  return createCoeusRunpodClient({
    endpointId: "endpoint_123",
    apiKey: "secret-test-key",
    fetchImpl,
    requestTimeoutMs: 100,
    pollIntervalMs: 1,
    waitTimeoutMs: 100,
    ...extra,
  });
}

test("expose tous les états documentés pris en charge", () => {
  assert.deepEqual(RUNPOD_JOB_STATES, [
    "IN_QUEUE", "IN_PROGRESS", "RUNNING", "COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT",
  ]);
});

test("soumet l'audio au endpoint asynchrone /run", async () => {
  let captured;
  const client = clientWith(async (url, options) => {
    captured = { url, options };
    return jsonResponse({ id: "job_1", status: "IN_QUEUE" });
  });

  const job = await client.submitCoeusVideo({ audioPath: "/runpod-volume/input.wav" });
  assert.equal(job.id, "job_1");
  assert.equal(captured.url, "https://api.runpod.ai/v2/endpoint_123/run");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers.Authorization, "Bearer secret-test-key");
  assert.deepEqual(JSON.parse(captured.options.body), {
    input: { audio_path: "/runpod-volume/input.wav" },
  });
});

test("consulte le statut et conserve la réponse finale", async () => {
  const output = { ok: true, output_file: "/runpod-volume/coeus.mp4", output_size: 42 };
  const client = clientWith(async (url) => {
    assert.equal(url, "https://api.runpod.ai/v2/endpoint_123/status/job_1");
    return jsonResponse({ id: "job_1", status: "COMPLETED", output });
  });
  const job = await client.getCoeusVideoStatus("job_1");
  assert.deepEqual(job.output, output);
});

test("generateCoeusVideo soumet puis attend sans infrastructure de jobs locale", async () => {
  const replies = [
    { id: "job_2", status: "IN_QUEUE" },
    { id: "job_2", status: "IN_PROGRESS" },
    { id: "job_2", status: "COMPLETED", output: { ok: true } },
  ];
  const client = clientWith(async () => jsonResponse(replies.shift()), { sleep: async () => {} });
  const result = await client.generateCoeusVideo({ audioPath: "/volume/a.wav" });
  assert.equal(result.status, "COMPLETED");
  assert.deepEqual(result.output, { ok: true });
});

test("remonte explicitement les états terminaux en échec", async () => {
  for (const status of ["FAILED", "CANCELLED", "TIMED_OUT"]) {
    const client = clientWith(async () => jsonResponse({ id: "job_3", status }));
    await assert.rejects(
      client.waitForCoeusVideo("job_3"),
      (error) => error instanceof CoeusRunpodError && error.code === "RUNPOD_JOB_FAILED" && error.job.status === status
    );
  }
});

test("distingue erreur HTTP, erreur réseau et timeout", async () => {
  const httpClient = clientWith(async () => jsonResponse({ error: "bad request" }, 400));
  await assert.rejects(httpClient.getCoeusVideoStatus("job_4"), { code: "RUNPOD_HTTP_ERROR", statusCode: 400 });

  const networkClient = clientWith(async () => { throw new Error("offline"); });
  await assert.rejects(networkClient.getCoeusVideoStatus("job_4"), { code: "RUNPOD_NETWORK_ERROR" });

  const timeoutClient = clientWith((url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }), { requestTimeoutMs: 5 });
  await assert.rejects(timeoutClient.getCoeusVideoStatus("job_4"), { code: "RUNPOD_TIMEOUT" });
});

test("refuse configuration, entrée, identifiant et état invalides sans exposer la clé", async () => {
  assert.throws(() => createCoeusRunpodClient({ endpointId: "x", apiKey: "" }), { code: "RUNPOD_CONFIG_ERROR" });
  const client = clientWith(async () => jsonResponse({ id: "job", status: "MYSTERY" }));
  await assert.rejects(client.submitCoeusVideo({}), { code: "RUNPOD_INPUT_ERROR" });
  await assert.rejects(client.getCoeusVideoStatus("bad/id"), { code: "RUNPOD_CONFIG_ERROR" });
  await assert.rejects(client.getCoeusVideoStatus("job"), (error) => {
    assert.equal(error.code, "RUNPOD_PROTOCOL_ERROR");
    assert.equal(error.message.includes("secret-test-key"), false);
    return true;
  });
});
