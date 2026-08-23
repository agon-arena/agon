"use strict";

const path = require("node:path");
const { createCoeusRunpodClient } = require("./runpod-client");
const { createCoeusVolumeClient, validateCoeusKey } = require("./runpod-volume");

const WORKER_OUTPUT_PREFIX = "/runpod-volume/coeus/outputs/";

class CoeusServiceError extends Error {
  constructor(message, { code = "COEUS_SERVICE_ERROR", stage } = {}) {
    super(message);
    this.name = "CoeusServiceError";
    this.code = code;
    this.coeusStage = stage;
  }
}

function workerOutputPathToKey(outputFile) {
  if (
    typeof outputFile !== "string" ||
    outputFile !== outputFile.trim() ||
    !outputFile.startsWith(WORKER_OUTPUT_PREFIX)
  ) {
    throw new CoeusServiceError("Le worker a renvoyé un chemin de sortie invalide.", {
      code: "COEUS_OUTPUT_INVALID",
      stage: "output_validation",
    });
  }

  const filename = outputFile.slice(WORKER_OUTPUT_PREFIX.length);
  const key = `coeus/outputs/${filename}`;
  try {
    validateCoeusKey(key, "outputs");
  } catch (_) {
    throw new CoeusServiceError("Le worker a renvoyé un chemin de sortie non sûr.", {
      code: "COEUS_OUTPUT_INVALID",
      stage: "output_validation",
    });
  }
  if (path.posix.extname(filename) !== ".mp4") {
    throw new CoeusServiceError("La sortie du worker doit être un fichier MP4.", {
      code: "COEUS_OUTPUT_INVALID",
      stage: "output_validation",
    });
  }
  return key;
}

function markStage(error, stage) {
  if (error && typeof error === "object") {
    try {
      error.coeusStage = error.coeusStage || stage;
    } catch (_) {
      // Preserve immutable errors as-is.
    }
  }
  return error;
}

function cleanupEntry(stage, error) {
  return Object.freeze({
    stage,
    code: typeof error?.code === "string" ? error.code : "COEUS_CLEANUP_FAILED",
    message: `Le nettoyage secondaire ${stage} a échoué.`,
  });
}

function createCoeusService(options = {}) {
  const runpodClient = options.runpodClient || createCoeusRunpodClient(options.runpodOptions);
  const volumeClient = options.volumeClient || createCoeusVolumeClient(options.volumeOptions);
  if (typeof runpodClient?.generateCoeusVideo !== "function") {
    throw new CoeusServiceError("Client RunPod Coeus invalide.", {
      code: "COEUS_SERVICE_CONFIG_ERROR",
      stage: "configuration",
    });
  }
  if (
    typeof volumeClient?.uploadAudio !== "function" ||
    typeof volumeClient?.downloadVideo !== "function" ||
    typeof volumeClient?.deleteObject !== "function"
  ) {
    throw new CoeusServiceError("Client de volume Coeus invalide.", {
      code: "COEUS_SERVICE_CONFIG_ERROR",
      stage: "configuration",
    });
  }

  async function generateFromLocalAudio(filePath, options = {}) {
    let uploadedAudio;
    let outputKey;
    let result;
    let primaryError;
    const cleanupErrors = [];

    try {
      try {
        uploadedAudio = await volumeClient.uploadAudio(filePath, { signal: options.signal });
      } catch (error) {
        throw markStage(error, "upload");
      }

      let job;
      try {
        job = await runpodClient.generateCoeusVideo(
          { audioPath: uploadedAudio.workerPath },
          {
            signal: options.signal,
            pollIntervalMs: options.pollIntervalMs,
            waitTimeoutMs: options.waitTimeoutMs,
          }
        );
      } catch (error) {
        throw markStage(error, "runpod");
      }

      if (!job || job.status !== "COMPLETED") {
        throw new CoeusServiceError("Le job Coeus ne s'est pas terminé correctement.", {
          code: "COEUS_JOB_INCOMPLETE",
          stage: "runpod",
        });
      }

      const output = job.output;
      if (!output || typeof output !== "object" || output.ok !== true) {
        if (typeof output?.output_file === "string") {
          try {
            outputKey = workerOutputPathToKey(output.output_file);
          } catch (_) {
            // An unsafe path must never be used, including for cleanup.
          }
        }
        throw new CoeusServiceError("Le worker Coeus a signalé un échec.", {
          code: "COEUS_WORKER_FAILED",
          stage: "runpod_output",
        });
      }

      outputKey = workerOutputPathToKey(output.output_file);

      let video;
      try {
        video = await volumeClient.downloadVideo(outputKey, { signal: options.signal });
      } catch (error) {
        throw markStage(error, "download");
      }

      result = {
        jobId: job.id,
        outputKey,
        outputSize: output.output_size ?? video.contentLength,
        rawOutputSize: output.raw_output_size,
        compressionCrf: output.compression_crf,
        compressionReductionPercent: output.compression_reduction_percent,
        videoCodec: output.video_codec,
        audioCodec: output.audio_codec,
        width: output.width,
        height: output.height,
        frameRate: output.frame_rate,
        duration: output.duration,
        hasAudio: output.has_audio,
        elapsedSeconds: output.elapsed_seconds,
        gpuName: output.gpuName,
        gpuCount: output.gpuCount,
        gpuTotalMemoryBytes: output.gpuTotalMemoryBytes,
        cudaVersion: output.cudaVersion,
        videoStream: video.body,
        videoContentLength: video.contentLength,
        videoContentType: video.contentType,
      };
    } catch (error) {
      primaryError = error;
    }

    if (uploadedAudio?.key) {
      try {
        await volumeClient.deleteObject(uploadedAudio.key);
      } catch (error) {
        cleanupErrors.push(cleanupEntry("cleanup_audio", error));
      }
    }

    if (primaryError && outputKey) {
      try {
        await volumeClient.deleteObject(outputKey);
      } catch (error) {
        cleanupErrors.push(cleanupEntry("cleanup_video", error));
      }
    }

    if (primaryError) {
      try {
        primaryError.cleanupErrors = Object.freeze(cleanupErrors);
      } catch (_) {
        // The primary error always wins, even if it cannot be enriched.
      }
      throw primaryError;
    }

    return Object.freeze({
      ...result,
      cleanupErrors: Object.freeze(cleanupErrors),
    });
  }

  return Object.freeze({ generateFromLocalAudio });
}

module.exports = {
  CoeusServiceError,
  WORKER_OUTPUT_PREFIX,
  createCoeusService,
  workerOutputPathToKey,
};
