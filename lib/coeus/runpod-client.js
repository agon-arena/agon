"use strict";

const RUNPOD_JOB_STATES = Object.freeze([
  "IN_QUEUE",
  "IN_PROGRESS",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
]);
const TERMINAL_STATES = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]+$/;

class CoeusRunpodError extends Error {
  constructor(message, { code = "RUNPOD_ERROR", statusCode, job } = {}) {
    super(message);
    this.name = "CoeusRunpodError";
    this.code = code;
    if (statusCode !== undefined) this.statusCode = statusCode;
    if (job !== undefined) this.job = job;
  }
}

function requireIdentifier(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new CoeusRunpodError(`${label} est manquant ou invalide.`, {
      code: "RUNPOD_CONFIG_ERROR",
    });
  }
  return normalized;
}

function requirePositiveNumber(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new CoeusRunpodError(`${label} doit être un nombre positif.`, {
      code: "RUNPOD_CONFIG_ERROR",
    });
  }
  return value;
}

function normalizeJob(payload, expectedId) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new CoeusRunpodError("Réponse RunPod invalide.", {
      code: "RUNPOD_PROTOCOL_ERROR",
    });
  }
  const id = payload.id || expectedId;
  const status = typeof payload.status === "string" ? payload.status.toUpperCase() : "";
  if (!id || !RUNPOD_JOB_STATES.includes(status)) {
    throw new CoeusRunpodError("Réponse RunPod sans identifiant ou état reconnu.", {
      code: "RUNPOD_PROTOCOL_ERROR",
    });
  }
  return { ...payload, id, status };
}

function createCoeusRunpodClient(options = {}) {
  const endpointId = requireIdentifier(
    options.endpointId ?? process.env.RUNPOD_COEUS_ENDPOINT_ID,
    "RUNPOD_COEUS_ENDPOINT_ID"
  );
  const apiKey = String(options.apiKey ?? process.env.RUNPOD_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new CoeusRunpodError("RUNPOD_API_KEY est manquante.", {
      code: "RUNPOD_CONFIG_ERROR",
    });
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new CoeusRunpodError("fetch n'est pas disponible sur ce serveur.", {
      code: "RUNPOD_CONFIG_ERROR",
    });
  }

  const baseUrl = String(options.baseUrl || "https://api.runpod.ai/v2").replace(/\/$/, "");
  const requestTimeoutMs = requirePositiveNumber(options.requestTimeoutMs ?? 15_000, "requestTimeoutMs");
  const defaultPollIntervalMs = requirePositiveNumber(options.pollIntervalMs ?? 2_000, "pollIntervalMs");
  const defaultWaitTimeoutMs = requirePositiveNumber(options.waitTimeoutMs ?? 15 * 60_000, "waitTimeoutMs");
  const sleep = options.sleep || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  const now = options.now || Date.now;

  async function request(path, { method = "GET", body, signal } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    const abortFromCaller = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", abortFromCaller, { once: true });
    }

    let response;
    try {
      response = await fetchImpl(`${baseUrl}/${endpointId}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = controller.signal.aborted;
      throw new CoeusRunpodError(
        aborted ? "La requête RunPod a dépassé son délai ou a été annulée." : "Impossible de joindre RunPod.",
        { code: aborted ? "RUNPOD_TIMEOUT" : "RUNPOD_NETWORK_ERROR" }
      );
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abortFromCaller);
    }

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (_) {
        if (response.ok) {
          throw new CoeusRunpodError("RunPod a renvoyé une réponse non JSON.", {
            code: "RUNPOD_PROTOCOL_ERROR",
          });
        }
      }
    }
    if (!response.ok) {
      const detail = payload?.error || payload?.message || text.slice(0, 300) || "erreur sans détail";
      throw new CoeusRunpodError(`RunPod a refusé la requête (${response.status}) : ${detail}`, {
        code: "RUNPOD_HTTP_ERROR",
        statusCode: response.status,
      });
    }
    return payload;
  }

  async function submitCoeusVideo({ audioPath, signal } = {}) {
    if (typeof audioPath !== "string" || !audioPath.trim()) {
      throw new CoeusRunpodError("audioPath est requis.", { code: "RUNPOD_INPUT_ERROR" });
    }
    const payload = await request("/run", {
      method: "POST",
      body: { input: { audio_path: audioPath.trim() } },
      signal,
    });
    return normalizeJob(payload);
  }

  async function getCoeusVideoStatus(jobId, { signal } = {}) {
    const id = requireIdentifier(jobId, "jobId");
    return normalizeJob(await request(`/status/${id}`, { signal }), id);
  }

  async function waitForCoeusVideo(jobId, options = {}) {
    const id = requireIdentifier(jobId, "jobId");
    const pollIntervalMs = requirePositiveNumber(options.pollIntervalMs ?? defaultPollIntervalMs, "pollIntervalMs");
    const waitTimeoutMs = requirePositiveNumber(options.waitTimeoutMs ?? defaultWaitTimeoutMs, "waitTimeoutMs");
    const startedAt = now();

    while (true) {
      const job = await getCoeusVideoStatus(id, { signal: options.signal });
      if (job.status === "COMPLETED") return job;
      if (TERMINAL_STATES.has(job.status)) {
        throw new CoeusRunpodError(`Le job RunPod ${id} s'est terminé avec l'état ${job.status}.`, {
          code: "RUNPOD_JOB_FAILED",
          job,
        });
      }
      if (now() - startedAt >= waitTimeoutMs) {
        throw new CoeusRunpodError(`L'attente du job RunPod ${id} a dépassé son délai.`, {
          code: "RUNPOD_WAIT_TIMEOUT",
          job,
        });
      }
      await sleep(pollIntervalMs);
    }
  }

  async function generateCoeusVideo(input, waitOptions = {}) {
    const submitted = await submitCoeusVideo({ ...input, signal: waitOptions.signal });
    if (submitted.status === "COMPLETED") return submitted;
    if (TERMINAL_STATES.has(submitted.status)) {
      throw new CoeusRunpodError(`Le job RunPod ${submitted.id} s'est terminé avec l'état ${submitted.status}.`, {
        code: "RUNPOD_JOB_FAILED",
        job: submitted,
      });
    }
    return waitForCoeusVideo(submitted.id, waitOptions);
  }

  return Object.freeze({
    submitCoeusVideo,
    getCoeusVideoStatus,
    waitForCoeusVideo,
    generateCoeusVideo,
  });
}

module.exports = {
  CoeusRunpodError,
  RUNPOD_JOB_STATES,
  createCoeusRunpodClient,
};
