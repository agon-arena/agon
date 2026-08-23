"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const DEFAULT_ENDPOINT = "https://s3api-eur-is-1.runpod.io/";
const DEFAULT_REGION = "EUR-IS-1";
const WORKER_VOLUME_ROOT = "/runpod-volume";
const MAX_SINGLE_UPLOAD_BYTES = 500 * 1024 * 1024;
const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac"]);
const SAFE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_BUCKET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

class CoeusVolumeError extends Error {
  constructor(message, { code = "COEUS_VOLUME_ERROR", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "CoeusVolumeError";
    this.code = code;
  }
}

function validateCoeusKey(key, expectedArea) {
  if (typeof key !== "string" || key !== key.trim() || key.includes("\\")) {
    throw new CoeusVolumeError("Clé Coeus invalide.", { code: "COEUS_VOLUME_INVALID_KEY" });
  }
  const parts = key.split("/");
  if (
    parts.length !== 3 ||
    parts[0] !== "coeus" ||
    !["inputs", "outputs"].includes(parts[1]) ||
    (expectedArea && parts[1] !== expectedArea) ||
    !SAFE_FILENAME_PATTERN.test(parts[2]) ||
    parts.some((part) => part === "." || part === "..")
  ) {
    throw new CoeusVolumeError("La clé doit cibler coeus/inputs/ ou coeus/outputs/ sans sous-chemin.", {
      code: "COEUS_VOLUME_INVALID_KEY",
    });
  }
  return key;
}

function toWorkerPath(key) {
  return `${WORKER_VOLUME_ROOT}/${validateCoeusKey(key)}`;
}

function audioContentType(extension) {
  return {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
  }[extension] || "application/octet-stream";
}

function createCoeusVolumeClient(options = {}) {
  const endpoint = String(options.endpoint ?? process.env.RUNPOD_VOLUME_S3_ENDPOINT ?? DEFAULT_ENDPOINT).trim();
  const accessKeyId = String(options.accessKeyId ?? process.env.RUNPOD_VOLUME_S3_ACCESS_KEY ?? "").trim();
  const secretAccessKey = String(options.secretAccessKey ?? process.env.RUNPOD_VOLUME_S3_SECRET_KEY ?? "").trim();
  const bucket = String(options.bucket ?? process.env.RUNPOD_VOLUME_S3_BUCKET ?? "").trim();
  const region = String(options.region ?? DEFAULT_REGION).trim();
  const requestTimeoutMs = options.requestTimeoutMs ?? 60_000;

  let endpointUrl;
  try {
    endpointUrl = new URL(endpoint);
  } catch (_) {
    throw new CoeusVolumeError("RUNPOD_VOLUME_S3_ENDPOINT est invalide.", {
      code: "COEUS_VOLUME_CONFIG_ERROR",
    });
  }
  if (
    endpointUrl.protocol !== "https:" ||
    endpointUrl.hostname !== "s3api-eur-is-1.runpod.io" ||
    endpointUrl.port ||
    endpointUrl.pathname !== "/" ||
    endpointUrl.search ||
    endpointUrl.hash ||
    endpointUrl.username ||
    endpointUrl.password
  ) {
    throw new CoeusVolumeError("Le endpoint S3 doit être celui de RunPod EUR-IS-1.", {
      code: "COEUS_VOLUME_CONFIG_ERROR",
    });
  }
  if (!accessKeyId || !secretAccessKey || !SAFE_BUCKET_PATTERN.test(bucket) || region !== DEFAULT_REGION) {
    throw new CoeusVolumeError("Configuration S3 RunPod manquante ou invalide pour EUR-IS-1.", {
      code: "COEUS_VOLUME_CONFIG_ERROR",
    });
  }
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new CoeusVolumeError("requestTimeoutMs doit être positif.", {
      code: "COEUS_VOLUME_CONFIG_ERROR",
    });
  }

  const s3Config = {
    endpoint: endpointUrl.toString(),
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: options.maxAttempts ?? 3,
  };
  const s3 = options.s3Client || (options.s3ClientFactory || ((config) => new S3Client(config)))(s3Config);
  if (!s3 || typeof s3.send !== "function") {
    throw new CoeusVolumeError("Client S3 invalide.", { code: "COEUS_VOLUME_CONFIG_ERROR" });
  }
  const makeUuid = options.randomUUID || randomUUID;

  async function send(command, signal) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, requestTimeoutMs);
    const abortFromCaller = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", abortFromCaller, { once: true });
    }
    try {
      return await s3.send(command, { abortSignal: controller.signal });
    } catch (error) {
      throw new CoeusVolumeError(
        timedOut ? "Le transfert vers le volume RunPod a dépassé son délai." : "Le volume RunPod est inaccessible.",
        { code: timedOut ? "COEUS_VOLUME_TIMEOUT" : "COEUS_VOLUME_NETWORK_ERROR", cause: error }
      );
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abortFromCaller);
    }
  }

  async function uploadAudio(filePath, { signal } = {}) {
    if (typeof filePath !== "string" || !filePath) {
      throw new CoeusVolumeError("Un chemin de fichier audio local est requis.", {
        code: "COEUS_VOLUME_INVALID_AUDIO",
      });
    }
    const extension = path.extname(filePath).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(extension)) {
      throw new CoeusVolumeError("Extension audio non prise en charge.", {
        code: "COEUS_VOLUME_INVALID_AUDIO",
      });
    }

    let stats;
    try {
      stats = await fs.promises.stat(filePath);
    } catch (error) {
      throw new CoeusVolumeError("Le fichier audio local est introuvable.", {
        code: "COEUS_VOLUME_INVALID_AUDIO",
        cause: error,
      });
    }
    if (!stats.isFile() || stats.size <= 0 || stats.size >= MAX_SINGLE_UPLOAD_BYTES) {
      throw new CoeusVolumeError("Le fichier audio doit être non vide et inférieur à 500 MB.", {
        code: "COEUS_VOLUME_INVALID_AUDIO",
      });
    }

    const key = validateCoeusKey(`coeus/inputs/${makeUuid()}${extension}`, "inputs");
    const body = fs.createReadStream(filePath);
    try {
      const response = await send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentLength: stats.size,
        ContentType: audioContentType(extension),
      }), signal);
      return { key, workerPath: toWorkerPath(key), etag: response?.ETag };
    } finally {
      body.destroy();
    }
  }

  async function downloadVideo(key, { signal } = {}) {
    const safeKey = validateCoeusKey(key, "outputs");
    if (path.extname(safeKey).toLowerCase() !== ".mp4") {
      throw new CoeusVolumeError("La sortie Coeus doit être un fichier MP4.", {
        code: "COEUS_VOLUME_INVALID_VIDEO",
      });
    }
    const response = await send(new GetObjectCommand({ Bucket: bucket, Key: safeKey }), signal);
    if (!response?.Body) {
      throw new CoeusVolumeError("RunPod a renvoyé une vidéo sans flux de données.", {
        code: "COEUS_VOLUME_INVALID_RESPONSE",
      });
    }
    return {
      key: safeKey,
      body: response.Body,
      contentLength: response.ContentLength,
      contentType: response.ContentType,
      etag: response.ETag,
    };
  }

  async function deleteObject(key, { signal } = {}) {
    const safeKey = validateCoeusKey(key);
    await send(new DeleteObjectCommand({ Bucket: bucket, Key: safeKey }), signal);
    return { key: safeKey, deleted: true };
  }

  return Object.freeze({ uploadAudio, downloadVideo, deleteObject, toWorkerPath });
}

module.exports = {
  CoeusVolumeError,
  DEFAULT_ENDPOINT,
  DEFAULT_REGION,
  createCoeusVolumeClient,
  toWorkerPath,
  validateCoeusKey,
};
