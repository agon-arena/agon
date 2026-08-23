"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { CoeusRunpodError } = require("../lib/coeus/runpod-client");
const { CoeusVolumeError } = require("../lib/coeus/runpod-volume");
const {
  createCoeusService,
  workerOutputPathToKey,
} = require("../lib/coeus/coeus-service");

const AUDIO_KEY = "coeus/inputs/audio.wav";
const AUDIO_PATH = "/runpod-volume/coeus/inputs/audio.wav";
const OUTPUT_KEY = "coeus/outputs/coeus_abc123.mp4";
const OUTPUT_PATH = "/runpod-volume/coeus/outputs/coeus_abc123.mp4";

function setup(overrides = {}) {
  const calls = [];
  const videoStream = Readable.from([Buffer.from("mp4")]);
  const volumeClient = {
    async uploadAudio(filePath) {
      calls.push(["upload", filePath]);
      return { key: AUDIO_KEY, workerPath: AUDIO_PATH };
    },
    async downloadVideo(key) {
      calls.push(["download", key]);
      return { body: videoStream, contentLength: 321, contentType: "video/mp4" };
    },
    async deleteObject(key) {
      calls.push(["delete", key]);
      return { key, deleted: true };
    },
    ...overrides.volumeClient,
  };
  const runpodClient = {
    async generateCoeusVideo(input) {
      calls.push(["runpod", input]);
      return {
        id: "job_1",
        status: "COMPLETED",
        output: {
          ok: true,
          output_file: OUTPUT_PATH,
          output_size: 123,
          raw_output_size: 263,
          compression_crf: 26,
          compression_reduction_percent: 53.23,
          video_codec: "h264",
          audio_codec: "aac",
          width: 1086,
          height: 1450,
          frame_rate: "25/1",
          duration: 7.64,
          has_audio: true,
          elapsed_seconds: 45.6,
          gpuName: "NVIDIA RTX A5000",
          gpuCount: 1,
          gpuTotalMemoryBytes: 25757220864,
          cudaVersion: "11.8",
          returncode: 0,
        },
      };
    },
    ...overrides.runpodClient,
  };
  return {
    calls,
    videoStream,
    service: createCoeusService({ runpodClient, volumeClient }),
  };
}

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("Une erreur était attendue.");
}

test("succès complet : upload, RunPod, mapping, stream et cleanup audio", async () => {
  const { calls, service, videoStream } = setup();
  const result = await service.generateFromLocalAudio("/tmp/voice.wav");
  assert.deepEqual(calls, [
    ["upload", "/tmp/voice.wav"],
    ["runpod", { audioPath: AUDIO_PATH }],
    ["download", OUTPUT_KEY],
    ["delete", AUDIO_KEY],
  ]);
  assert.equal(result.jobId, "job_1");
  assert.equal(result.outputKey, OUTPUT_KEY);
  assert.equal(result.outputSize, 123);
  assert.equal(result.rawOutputSize, 263);
  assert.equal(result.compressionCrf, 26);
  assert.equal(result.compressionReductionPercent, 53.23);
  assert.equal(result.videoCodec, "h264");
  assert.equal(result.audioCodec, "aac");
  assert.equal(result.width, 1086);
  assert.equal(result.height, 1450);
  assert.equal(result.frameRate, "25/1");
  assert.equal(result.duration, 7.64);
  assert.equal(result.hasAudio, true);
  assert.equal(result.elapsedSeconds, 45.6);
  assert.equal(result.gpuName, "NVIDIA RTX A5000");
  assert.equal(result.gpuCount, 1);
  assert.equal(result.gpuTotalMemoryBytes, 25757220864);
  assert.equal(result.cudaVersion, "11.8");
  assert.equal(result.videoStream, videoStream);
  assert.deepEqual(result.cleanupErrors, []);
});

test("échec upload : conserve l'erreur du volume et identifie l'étape", async () => {
  const source = new CoeusVolumeError("Upload impossible.", { code: "COEUS_VOLUME_NETWORK_ERROR" });
  const { service, calls } = setup({ volumeClient: { uploadAudio: async () => { throw source; } } });
  const error = await captureError(service.generateFromLocalAudio("/tmp/a.wav"));
  assert.equal(error, source);
  assert.equal(error.coeusStage, "upload");
  assert.deepEqual(calls, []);
});

test("job RunPod FAILED : conserve l'erreur et nettoie l'audio", async () => {
  const source = new CoeusRunpodError("Job failed.", { code: "RUNPOD_JOB_FAILED" });
  const { service, calls } = setup({ runpodClient: { generateCoeusVideo: async () => { throw source; } } });
  const error = await captureError(service.generateFromLocalAudio("/tmp/a.wav"));
  assert.equal(error, source);
  assert.equal(error.coeusStage, "runpod");
  assert.deepEqual(calls, [["upload", "/tmp/a.wav"], ["delete", AUDIO_KEY]]);
});

test("output.ok false est un échec worker et nettoie toute sortie sûre connue", async () => {
  const { service, calls } = setup({ runpodClient: {
    generateCoeusVideo: async () => ({
      id: "job_2", status: "COMPLETED", output: { ok: false, output_file: OUTPUT_PATH },
    }),
  } });
  const error = await captureError(service.generateFromLocalAudio("/tmp/a.wav"));
  assert.equal(error.code, "COEUS_WORKER_FAILED");
  assert.deepEqual(calls, [
    ["upload", "/tmp/a.wav"], ["delete", AUDIO_KEY], ["delete", OUTPUT_KEY],
  ]);
});

test("output_file absent est refusé", async () => {
  const { service } = setup({ runpodClient: {
    generateCoeusVideo: async () => ({ id: "job_3", status: "COMPLETED", output: { ok: true } }),
  } });
  const error = await captureError(service.generateFromLocalAudio("/tmp/a.wav"));
  assert.equal(error.code, "COEUS_OUTPUT_INVALID");
  assert.equal(error.coeusStage, "output_validation");
});

test("refuse les chemins hors du répertoire worker autorisé", () => {
  for (const outputFile of [
    "/runpod-volume/other/video.mp4",
    "coeus/outputs/video.mp4",
    "",
    " /runpod-volume/coeus/outputs/video.mp4",
  ]) {
    assert.throws(() => workerOutputPathToKey(outputFile), { code: "COEUS_OUTPUT_INVALID" });
  }
});

test("refuse traversal, sous-répertoire, caractères suspects et autre extension", () => {
  for (const outputFile of [
    "/runpod-volume/coeus/outputs/../secret.mp4",
    "/runpod-volume/coeus/outputs/sub/video.mp4",
    "/runpod-volume/coeus/outputs/video%2Emp4",
    "/runpod-volume/coeus/outputs/video.mp4?x=1",
    "/runpod-volume/coeus/outputs/video.MP4",
    "/runpod-volume/coeus/outputs/video.mov",
  ]) {
    assert.throws(() => workerOutputPathToKey(outputFile), { code: "COEUS_OUTPUT_INVALID" });
  }
});

test("échec download : conserve l'erreur et nettoie audio et MP4", async () => {
  const source = new CoeusVolumeError("Download impossible.", { code: "COEUS_VOLUME_NETWORK_ERROR" });
  const { service, calls } = setup({ volumeClient: { downloadVideo: async () => { throw source; } } });
  const error = await captureError(service.generateFromLocalAudio("/tmp/a.wav"));
  assert.equal(error, source);
  assert.equal(error.coeusStage, "download");
  assert.deepEqual(calls, [
    ["upload", "/tmp/a.wav"], ["runpod", { audioPath: AUDIO_PATH }],
    ["delete", AUDIO_KEY], ["delete", OUTPUT_KEY],
  ]);
});

test("cleanup audio échoué après succès reste secondaire et loggable", async () => {
  const { service } = setup({ volumeClient: {
    deleteObject: async (key) => {
      if (key === AUDIO_KEY) throw new CoeusVolumeError("secret rps_hidden", { code: "COEUS_VOLUME_NETWORK_ERROR" });
    },
  } });
  const result = await service.generateFromLocalAudio("/tmp/a.wav");
  assert.equal(result.videoStream instanceof Readable, true);
  assert.deepEqual(result.cleanupErrors, [{
    stage: "cleanup_audio",
    code: "COEUS_VOLUME_NETWORK_ERROR",
    message: "Le nettoyage secondaire cleanup_audio a échoué.",
  }]);
  assert.equal(JSON.stringify(result).includes("rps_hidden"), false);
});

test("cleanup après échec RunPod ne masque jamais l'erreur principale", async () => {
  const primary = new CoeusRunpodError("RunPod indisponible.", { code: "RUNPOD_NETWORK_ERROR" });
  const { service } = setup({
    runpodClient: { generateCoeusVideo: async () => { throw primary; } },
    volumeClient: { deleteObject: async () => { throw new Error("cleanup secret"); } },
  });
  const error = await captureError(service.generateFromLocalAudio("/tmp/a.wav"));
  assert.equal(error, primary);
  assert.equal(error.cleanupErrors.length, 1);
  assert.equal(error.cleanupErrors[0].stage, "cleanup_audio");
  assert.equal(JSON.stringify(error.cleanupErrors).includes("cleanup secret"), false);
});

test("aucun secret de configuration n'apparaît dans les erreurs du service", async () => {
  const secrets = ["runpod_api_secret", "rps_volume_secret", "user_access_secret"];
  const { service } = setup({ runpodClient: {
    generateCoeusVideo: async () => ({
      id: "job", status: "COMPLETED", output: { ok: true, output_file: "/tmp/video.mp4" },
    }),
  } });
  const error = await captureError(service.generateFromLocalAudio("/tmp/a.wav"));
  const serialized = `${error.message} ${JSON.stringify(error.cleanupErrors || [])}`;
  for (const secret of secrets) assert.equal(serialized.includes(secret), false);
});
