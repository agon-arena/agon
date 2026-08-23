"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const {
  createCoeusVolumeClient,
  toWorkerPath,
  validateCoeusKey,
} = require("../lib/coeus/runpod-volume");

function makeClient(send, extra = {}) {
  return createCoeusVolumeClient({
    accessKeyId: "user_test",
    secretAccessKey: "rps_secret_test",
    bucket: "volume_123",
    s3Client: { send },
    requestTimeoutMs: 100,
    randomUUID: () => "12345678-1234-1234-1234-123456789abc",
    ...extra,
  });
}

test("valide uniquement les clés Coeus directes autorisées", () => {
  assert.equal(validateCoeusKey("coeus/inputs/a.wav"), "coeus/inputs/a.wav");
  assert.equal(validateCoeusKey("coeus/outputs/a.mp4"), "coeus/outputs/a.mp4");
  for (const key of [
    "../secret", "coeus/../secret", "coeus/inputs/../secret", "/coeus/inputs/a.wav",
    "coeus\\inputs\\a.wav", "other/inputs/a.wav", "coeus/inputs/sub/a.wav",
    "coeus/inputs/a b.wav", "coeus/inputs//a.wav",
  ]) {
    assert.throws(() => validateCoeusKey(key), { code: "COEUS_VOLUME_INVALID_KEY" });
  }
});

test("convertit une clé sûre en chemin worker sans accepter de chemin arbitraire", () => {
  assert.equal(toWorkerPath("coeus/inputs/abc.wav"), "/runpod-volume/coeus/inputs/abc.wav");
  assert.throws(() => toWorkerPath("/etc/passwd"), { code: "COEUS_VOLUME_INVALID_KEY" });
});

test("construit le client S3 pour EUR-IS-1 sans exposer les paramètres au reste de Mnoria", () => {
  let config;
  createCoeusVolumeClient({
    accessKeyId: "user_test",
    secretAccessKey: "rps_secret_test",
    bucket: "volume_123",
    s3ClientFactory(value) {
      config = value;
      return { send: async () => ({}) };
    },
  });
  assert.equal(config.endpoint, "https://s3api-eur-is-1.runpod.io/");
  assert.equal(config.region, "EUR-IS-1");
  assert.equal(config.forcePathStyle, true);
  assert.deepEqual(config.credentials, {
    accessKeyId: "user_test",
    secretAccessKey: "rps_secret_test",
  });
  assert.throws(() => createCoeusVolumeClient({
    endpoint: "https://example.com/",
    accessKeyId: "user_test",
    secretAccessKey: "rps_secret_test",
    bucket: "volume_123",
  }), { code: "COEUS_VOLUME_CONFIG_ERROR" });
});

test("uploadAudio streame un fichier, conserve son extension et produit un chemin worker", async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "coeus-volume-test-"));
  const filePath = path.join(directory, "voice.WAV");
  await fs.promises.writeFile(filePath, Buffer.from("fake-wave"));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));

  let command;
  const client = makeClient(async (value) => {
    command = value;
    return { ETag: "etag-upload" };
  });
  const result = await client.uploadAudio(filePath);

  assert.equal(command.constructor.name, "PutObjectCommand");
  assert.equal(command.input.Bucket, "volume_123");
  assert.equal(command.input.Key, "coeus/inputs/12345678-1234-1234-1234-123456789abc.wav");
  assert.equal(command.input.ContentLength, 9);
  assert.equal(command.input.ContentType, "audio/wav");
  assert.equal(typeof command.input.Body.pipe, "function");
  assert.equal(result.workerPath, "/runpod-volume/coeus/inputs/12345678-1234-1234-1234-123456789abc.wav");
});

test("downloadVideo renvoie le flux MP4 sans base64", async () => {
  const stream = Readable.from([Buffer.from("mp4")]);
  let command;
  const client = makeClient(async (value) => {
    command = value;
    return { Body: stream, ContentLength: 3, ContentType: "video/mp4", ETag: "etag-video" };
  });
  const result = await client.downloadVideo("coeus/outputs/video.mp4");
  assert.equal(command.constructor.name, "GetObjectCommand");
  assert.deepEqual(command.input, { Bucket: "volume_123", Key: "coeus/outputs/video.mp4" });
  assert.equal(result.body, stream);
  assert.equal(result.contentType, "video/mp4");
  await assert.rejects(client.downloadVideo("coeus/inputs/video.mp4"), { code: "COEUS_VOLUME_INVALID_KEY" });
  await assert.rejects(client.downloadVideo("coeus/outputs/video.wav"), { code: "COEUS_VOLUME_INVALID_VIDEO" });
});

test("deleteObject utilise DeleteObject uniquement sous le préfixe Coeus", async () => {
  let command;
  const client = makeClient(async (value) => {
    command = value;
    return {};
  });
  assert.deepEqual(await client.deleteObject("coeus/inputs/audio.wav"), {
    key: "coeus/inputs/audio.wav",
    deleted: true,
  });
  assert.equal(command.constructor.name, "DeleteObjectCommand");
  assert.deepEqual(command.input, { Bucket: "volume_123", Key: "coeus/inputs/audio.wav" });
  await assert.rejects(client.deleteObject("users/private.txt"), { code: "COEUS_VOLUME_INVALID_KEY" });
});

test("encapsule les erreurs réseau et les timeouts sans révéler les secrets", async () => {
  const networkClient = makeClient(async () => { throw new Error("offline"); });
  await assert.rejects(networkClient.deleteObject("coeus/inputs/a.wav"), (error) => {
    assert.equal(error.code, "COEUS_VOLUME_NETWORK_ERROR");
    assert.equal(error.message.includes("rps_secret_test"), false);
    return true;
  });

  const timeoutClient = makeClient((command, { abortSignal }) => new Promise((resolve, reject) => {
    abortSignal.addEventListener("abort", () => reject(new Error("aborted")));
  }), { requestTimeoutMs: 5 });
  await assert.rejects(timeoutClient.deleteObject("coeus/inputs/a.wav"), {
    code: "COEUS_VOLUME_TIMEOUT",
  });
});
