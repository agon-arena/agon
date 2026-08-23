"use strict";

require("dotenv").config({ quiet: true });

const fs = require("node:fs");
const { pipeline } = require("node:stream/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const {
  S3Client,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");
const { createCoeusService } = require("../lib/coeus/coeus-service");
const { createCoeusVolumeClient } = require("../lib/coeus/runpod-volume");
const {
  CoeusRunpodError,
  createCoeusRunpodClient,
} = require("../lib/coeus/runpod-client");

const execFileAsync = promisify(execFile);
const AUDIO_FILE = "/Users/kevinbruyat/Desktop/coeus-test-audio.wav";
const VIDEO_FILE = "/Users/kevinbruyat/Desktop/coeus-test-video.mp4";
const RUNPOD_POLL_INTERVAL_MS = 10_000;
const RUNPOD_WAIT_TIMEOUT_MS = 60 * 60_000;
const RUNPOD_TERMINAL_STATES = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]);
const REQUIRED_ENV = [
  "RUNPOD_COEUS_ENDPOINT_ID",
  "RUNPOD_API_KEY",
  "RUNPOD_VOLUME_S3_ENDPOINT",
  "RUNPOD_VOLUME_S3_ACCESS_KEY",
  "RUNPOD_VOLUME_S3_SECRET_KEY",
  "RUNPOD_VOLUME_S3_BUCKET",
];

function publicResult(overrides = {}) {
  return {
    status: "FAILED",
    jobId: null,
    remoteStatus: null,
    waitElapsedSeconds: null,
    outputKey: null,
    videoLocation: null,
    rawOutputSize: null,
    compressionCrf: null,
    compressionReductionPercent: null,
    elapsedSeconds: null,
    gpuName: null,
    gpuCount: null,
    gpuTotalMemoryBytes: null,
    cudaVersion: null,
    outputSize: null,
    localVideoPath: VIDEO_FILE,
    localSize: null,
    videoCodec: null,
    audioCodec: null,
    dimensions: null,
    frameRate: null,
    videoDuration: null,
    hasAudio: null,
    s3VideoRetained: false,
    s3AudioCleaned: false,
    cleanupErrors: [],
    anomaly: null,
    ...overrides,
  };
}

function createMonitoredRunpodClient(runpodClient, state) {
  return Object.freeze({
    async generateCoeusVideo({ audioPath }, options = {}) {
      const submitted = await runpodClient.submitCoeusVideo({
        audioPath,
        signal: options.signal,
      });
      state.jobId = submitted.id;
      state.remoteStatus = submitted.status;
      state.startedAt = Date.now();
      state.lastJob = submitted;
      process.stdout.write(`RunPod job submitted: ${state.jobId}\n`);

      if (submitted.status === "COMPLETED") return submitted;
      if (RUNPOD_TERMINAL_STATES.has(submitted.status)) {
        throw new CoeusRunpodError(`Le job RunPod s'est terminé avec l'état ${submitted.status}.`, {
          code: "RUNPOD_JOB_FAILED",
          job: submitted,
        });
      }

      const pollIntervalMs = options.pollIntervalMs ?? RUNPOD_POLL_INTERVAL_MS;
      const waitTimeoutMs = options.waitTimeoutMs ?? RUNPOD_WAIT_TIMEOUT_MS;

      while (true) {
        const elapsedMs = Date.now() - state.startedAt;
        if (elapsedMs >= waitTimeoutMs) {
          const timeout = new CoeusRunpodError(
            "L'attente locale du job RunPod a dépassé son délai sans échec distant confirmé.",
            { code: "RUNPOD_WAIT_TIMEOUT", job: state.lastJob }
          );
          timeout.localStatus = "WAIT_TIMEOUT";
          throw timeout;
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

        let job;
        try {
          job = await runpodClient.getCoeusVideoStatus(state.jobId, { signal: options.signal });
        } catch (error) {
          error.job = error.job || state.lastJob;
          error.localStatus = "REMOTE_STATUS_UNKNOWN";
          throw error;
        }
        state.lastJob = job;
        state.remoteStatus = job.status;
        state.elapsedSeconds = Math.round((Date.now() - state.startedAt) / 1000);
        process.stdout.write(
          `RunPod job ${state.jobId}: ${state.remoteStatus} (${state.elapsedSeconds}s)\n`
        );

        if (job.status === "COMPLETED") return job;
        if (RUNPOD_TERMINAL_STATES.has(job.status)) {
          throw new CoeusRunpodError(`Le job RunPod s'est terminé avec l'état ${job.status}.`, {
            code: "RUNPOD_JOB_FAILED",
            job,
          });
        }
      }
    },
  });
}

function assertPrerequisites() {
  const missing = REQUIRED_ENV.filter((name) => !String(process.env[name] || "").trim());
  if (missing.length) throw Object.assign(new Error("Configuration incomplète."), { code: "ENV_MISSING" });
  if (!fs.statSync(AUDIO_FILE).isFile() || fs.statSync(AUDIO_FILE).size <= 0) {
    throw Object.assign(new Error("Audio local invalide."), { code: "AUDIO_INVALID" });
  }
  if (fs.existsSync(VIDEO_FILE)) {
    throw Object.assign(new Error("Le MP4 local existe déjà."), { code: "VIDEO_EXISTS" });
  }
}

function createInspectionS3Client() {
  return new S3Client({
    endpoint: process.env.RUNPOD_VOLUME_S3_ENDPOINT,
    region: "EUR-IS-1",
    forcePathStyle: true,
    maxAttempts: 3,
    credentials: {
      accessKeyId: process.env.RUNPOD_VOLUME_S3_ACCESS_KEY,
      secretAccessKey: process.env.RUNPOD_VOLUME_S3_SECRET_KEY,
    },
  });
}

async function objectExists(s3, key) {
  try {
    await s3.send(new HeadObjectCommand({
      Bucket: process.env.RUNPOD_VOLUME_S3_BUCKET,
      Key: key,
    }));
    return true;
  } catch (error) {
    if (error?.name === "NotFound" || error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

async function inspectVideo() {
  const { stdout } = await execFileAsync("/opt/homebrew/bin/ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate:format=duration,size",
    "-of", "json",
    VIDEO_FILE,
  ], { maxBuffer: 1024 * 1024 });
  const probe = JSON.parse(stdout);
  const video = (probe.streams || []).find((stream) => stream.codec_type === "video");
  const audio = (probe.streams || []).find((stream) => stream.codec_type === "audio");
  const localSize = fs.statSync(VIDEO_FILE).size;
  if (!video || localSize <= 0 || !Number.isFinite(Number(probe.format?.duration))) {
    throw Object.assign(new Error("MP4 invalide."), { code: "FFPROBE_INVALID" });
  }
  return {
    localSize,
    videoCodec: video.codec_name || null,
    audioCodec: audio?.codec_name || null,
    dimensions: `${video.width}x${video.height}`,
    frameRate: video.avg_frame_rate || null,
    videoDuration: Number(probe.format.duration),
    hasAudio: Boolean(audio),
  };
}

async function main() {
  let report = publicResult();
  let generated;
  let uploadedAudioKey;
  const cleanupErrors = [];
  const runpodState = {
    jobId: null,
    remoteStatus: null,
    startedAt: null,
    elapsedSeconds: null,
    lastJob: null,
  };

  try {
    assertPrerequisites();
    const inspectionS3 = createInspectionS3Client();
    const volumeClient = createCoeusVolumeClient();
    const monitoredRunpodClient = createMonitoredRunpodClient(
      createCoeusRunpodClient(),
      runpodState
    );
    const trackedVolumeClient = {
      async uploadAudio(...args) {
        const uploaded = await volumeClient.uploadAudio(...args);
        uploadedAudioKey = uploaded.key;
        return uploaded;
      },
      downloadVideo: (...args) => volumeClient.downloadVideo(...args),
      deleteObject: (...args) => volumeClient.deleteObject(...args),
    };

    generated = await createCoeusService({
      runpodClient: monitoredRunpodClient,
      volumeClient: trackedVolumeClient,
    })
      .generateFromLocalAudio(AUDIO_FILE);
    report = publicResult({
      jobId: generated.jobId,
      remoteStatus: "COMPLETED",
      waitElapsedSeconds: runpodState.elapsedSeconds,
      outputKey: generated.outputKey,
      videoLocation: `/runpod-volume/${generated.outputKey}`,
      rawOutputSize: generated.rawOutputSize,
      compressionCrf: generated.compressionCrf,
      compressionReductionPercent: generated.compressionReductionPercent,
      elapsedSeconds: generated.elapsedSeconds,
      gpuName: generated.gpuName,
      gpuCount: generated.gpuCount,
      gpuTotalMemoryBytes: generated.gpuTotalMemoryBytes,
      cudaVersion: generated.cudaVersion,
      outputSize: generated.outputSize,
      cleanupErrors: [...generated.cleanupErrors],
    });

    await pipeline(
      generated.videoStream,
      fs.createWriteStream(VIDEO_FILE, { flags: "wx", mode: 0o600 })
    );

    const inspection = await inspectVideo();
    if (
      Number.isFinite(generated.videoContentLength) &&
      generated.videoContentLength > 0 &&
      inspection.localSize !== generated.videoContentLength
    ) {
      throw Object.assign(new Error("Téléchargement incomplet."), { code: "DOWNLOAD_INCOMPLETE" });
    }
    report = { ...report, ...inspection };
    // The successful S3 download and local validation prove that outputKey is
    // retrievable. Keep this final MP4 on the Network Volume for future reuse.
    report.s3VideoRetained = true;

    try {
      report.s3AudioCleaned = Boolean(uploadedAudioKey) &&
        !(await objectExists(inspectionS3, uploadedAudioKey)) &&
        generated.cleanupErrors.length === 0;
      if (!report.s3AudioCleaned) cleanupErrors.push({ stage: "cleanup_audio", code: "AUDIO_CLEANUP_UNCONFIRMED" });
    } catch (error) {
      cleanupErrors.push({ stage: "cleanup_audio_check", code: error.code || "COEUS_CLEANUP_FAILED" });
    }

    report.cleanupErrors = [...report.cleanupErrors, ...cleanupErrors];
    report.status = "SUCCESS";
    report.anomaly = report.cleanupErrors.length ? "TEMP_CLEANUP_INCOMPLETE" : null;
  } catch (error) {
    const remoteStatus = error?.job?.status || runpodState.remoteStatus;
    const localStatus = error?.localStatus || (
      error?.code === "RUNPOD_WAIT_TIMEOUT" ? "WAIT_TIMEOUT" : null
    );
    let status = "FAILED";
    if (localStatus === "WAIT_TIMEOUT") status = "WAIT_TIMEOUT";
    else if (localStatus === "REMOTE_STATUS_UNKNOWN") status = "REMOTE_STATUS_UNKNOWN";
    else if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(remoteStatus)) status = remoteStatus;
    report.status = status;
    report.jobId = error?.job?.id || runpodState.jobId || report.jobId;
    report.remoteStatus = remoteStatus || null;
    report.waitElapsedSeconds = runpodState.startedAt
      ? Math.round((Date.now() - runpodState.startedAt) / 1000)
      : null;
    report.cleanupErrors = [...(report.cleanupErrors || []), ...cleanupErrors];
    report.anomaly = `${error?.code || "COEUS_REAL_TEST_FAILED"}${error?.coeusStage ? `@${error.coeusStage}` : ""}`;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "SUCCESS") process.exitCode = 1;
}

main();
