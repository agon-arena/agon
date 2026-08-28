"use strict";

// Orchestration Noès (finalisation du 27/08/2026) : extrait des routes
// server.js pour être testable sans serveur HTTP ni dépendances réelles
// (Supabase/OpenAI/RunPod injectées par l'appelant) — cf.
// test/noes-orchestrator.test.js. server.js ne fait plus que la couche HTTP
// (légitimité de la requête, rate limit, forme de la réponse) ; toute la
// logique métier (cache script, batching, hash, dédup vidéo, soumission
// RunPod, finalisation) vit ici.
const noesRepository = require("./noes-repository");
const { buildNoesScriptItemsFromQuestions, buildNoesScriptPrompt, validateNoesScriptResponse } = require("./noes-script");
const { buildNoesBatches, noesBatchCount } = require("./noes-batch");
const { computeNoesVideoHash } = require("./video-hash");
const { uploadNoesVideo } = require("./noes-storage");

const DEFAULT_CONFIG = Object.freeze({
  pipelineVersion: "coeus-items-v1",
  voice: "kokoro:ff_siwis",
  avatar: "coeusfemme2",
  thinkingPauseSeconds: 3,
  itemGapSeconds: 0.6,
  maxVideosPerDay: 4,
  jobTimeoutMs: 60 * 60 * 1000,
  storageBucket: null,
  storageCacheControl: "31536000"
});

function normalizeConfig(config) {
  return { ...DEFAULT_CONFIG, ...(config || {}) };
}

// Erreur typée (status HTTP + code machine) : server.js n'a plus qu'à lire
// error.status/error.code pour construire sa réponse, jamais à réinventer
// la correspondance erreur -> code HTTP.
class NoesRequestError extends Error {
  constructor(message, { status = 500, code } = {}) {
    super(message);
    this.name = "NoesRequestError";
    this.status = status;
    this.code = code;
  }
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// Point fondamental (mission du 26/08/2026) : les connaissances sources
// viennent de question.knowledgeTarget, JAMAIS de la question QCM elle-même
// (cf. buildNoesScriptItemsFromQuestions, lib/coeus/noes-script.js). Appel
// IA UNIQUE par fiche, mis en cache dans noes_scripts — un script déjà
// existant ne déclenche plus jamais callOpenAI (vérifié explicitement par
// test/noes-orchestrator.test.js, "cache hit -> zéro appel IA").
async function getOrCreateNoesScript({ supabase, callOpenAI, slot, quizDate, questions }) {
  const existing = await noesRepository.getNoesScript(supabase, { slot, quizDate });
  if (existing) return { script: existing, generated: false };

  const { facts, knowledgeIds } = buildNoesScriptItemsFromQuestions({ slot, quizDate, questions });
  if (!facts.length) {
    throw new NoesRequestError("Aucune connaissance exploitable pour Noès sur cette fiche.", { status: 422, code: "no_knowledge" });
  }

  let validatedItems = null;
  try {
    const content = await callOpenAI([{ role: "user", content: buildNoesScriptPrompt(facts) }], {
      temperature: 0.3,
      responseFormat: { type: "json_object" },
      feature: "noes_script_generation"
    });
    validatedItems = validateNoesScriptResponse(JSON.parse(content), knowledgeIds);
  } catch (error) {
    console.error("[noes] génération du script :", error.message);
  }
  if (!validatedItems) {
    throw new NoesRequestError("Génération du script Noès impossible pour le moment.", { status: 502, code: "script_generation_failed" });
  }

  const script = await noesRepository.insertNoesScript(supabase, {
    slot, quizDate, sourceType: "custom", items: validatedItems, model: "gpt-4o-mini"
  });
  return { script, generated: true };
}

// Verrou optimiste pending->processing (cf. lib/coeus/noes-repository.js) +
// jamais de resoumission si un autre appelant a déjà gagné la course.
async function submitNoesVideoJob({ supabase, runpodClient, pendingRow, batchItems, config }) {
  const claimed = await noesRepository.claimPendingNoesVideoForSubmission(supabase, pendingRow.id);
  if (!claimed) return noesRepository.getNoesVideoById(supabase, pendingRow.id);

  if (!runpodClient) {
    await noesRepository.markNoesVideoFailed(supabase, pendingRow.id, {
      errorStage: "configuration",
      errorMessage: "RunPod n'est pas configuré sur cet environnement."
    });
    return { ...pendingRow, status: "failed", error_stage: "configuration" };
  }

  try {
    const job = await runpodClient.submitCoeusItemsVideo({
      items: batchItems.map((item) => ({ question: item.question, answer: item.answer })),
      thinkingPauseSeconds: config.thinkingPauseSeconds,
      itemGapSeconds: config.itemGapSeconds
    });
    await noesRepository.markNoesVideoProcessing(supabase, pendingRow.id, job.id);
    return { ...pendingRow, status: "processing", runpod_job_id: job.id };
  } catch (error) {
    console.error("[noes] soumission RunPod :", error.message);
    await noesRepository.markNoesVideoFailed(supabase, pendingRow.id, { errorStage: "submit", errorMessage: error.message });
    return { ...pendingRow, status: "failed", error_stage: "submit" };
  }
}

// Point d'entrée principal (POST /api/noes/videos). deps :
// { supabase, callOpenAI, getRunpodClients: () => {runpodClient, volumeClient} | null,
//   inFlightMap: Map<videoHash, Promise>, config }
async function requestNoesVideo(deps, { userId, slot, quizDate, batchIndex, questions }) {
  const config = normalizeConfig(deps.config);
  const { supabase } = deps;

  if (batchIndex >= noesBatchCount(questions.length)) {
    throw new NoesRequestError("Lot demandé hors limites.", { status: 400, code: "batch_out_of_range" });
  }

  const { script } = await getOrCreateNoesScript({ supabase, callOpenAI: deps.callOpenAI, slot, quizDate, questions });

  // Batching canonique et déterministe (cf. lib/coeus/noes-batch.js) :
  // JAMAIS une sélection heuristique de connaissances proches — toujours par
  // position dans le script (1-5, 6-10, ...).
  const batch = buildNoesBatches(script.items)[batchIndex] || [];
  if (!batch.length) {
    throw new NoesRequestError("Aucune connaissance exploitable dans ce lot.", { status: 422, code: "empty_batch" });
  }

  const videoHash = computeNoesVideoHash({
    items: batch,
    voice: config.voice,
    avatar: config.avatar,
    pipelineVersion: config.pipelineVersion,
    thinkingPauseSeconds: config.thinkingPauseSeconds
  });

  let video = await noesRepository.getNoesVideoByHash(supabase, videoHash);

  // Une première demande faite avant la configuration de Render a créé une ligne d'échec
  // durable. Dès que les clients sont réellement disponibles, reprendre cette ligne plutôt
  // que de servir indéfiniment l'ancien message. Verrou DB strict : une seule instance gagne
  // failed/configuration -> pending -> processing, sans deuxième job concurrent.
  if (video?.status === "failed" && video?.error_stage === "configuration") {
    const retryClients = deps.getRunpodClients();
    if (retryClients?.runpodClient) {
      const claimedForRetry = await noesRepository.claimFailedConfigurationNoesVideoForRetry(supabase, video.id);
      if (claimedForRetry) {
        video = await submitNoesVideoJob({
          supabase,
          runpodClient: retryClients.runpodClient,
          pendingRow: { ...video, status: "pending", error_stage: null, error_message: null, runpod_job_id: null },
          batchItems: batch,
          config
        });
      } else {
        video = await noesRepository.getNoesVideoById(supabase, video.id);
      }
    }
  }

  // Un ancien timeout local peut avoir été prononcé alors que RunPod poursuivait
  // réellement le même job. Le reprendre sans aucune resoumission : seul le jobId
  // déjà persisté est consulté, puis la ligne repasse atomiquement en processing.
  if (video?.status === "failed" && video?.error_stage === "timeout" && video?.runpod_job_id) {
    const retryClients = deps.getRunpodClients();
    if (retryClients?.runpodClient) {
      try {
        const remoteJob = await retryClients.runpodClient.getCoeusVideoStatus(video.runpod_job_id);
        if (["IN_QUEUE", "IN_PROGRESS", "RUNNING", "COMPLETED"].includes(remoteJob.status)) {
          const resumed = await noesRepository.claimTimedOutNoesVideoForResume(supabase, video.id);
          if (resumed) {
            video = await noesRepository.getNoesVideoById(supabase, video.id);
            if (remoteJob.status === "COMPLETED") {
              video = await pollAndFinalizeNoesVideo(deps, video);
            }
          }
        }
      } catch (_) {
        // Lecture distante momentanément impossible : conserver l'échec existant,
        // surtout ne jamais soumettre un nouveau job à l'aveugle.
      }
    }
  }

  if (!video) {
    // Quota : uniquement pour une NOUVELLE génération, jamais pour un
    // rejouage d'une vidéo déjà en cache (cf. hasUserRequestedVideoToday).
    const distinctCount = await noesRepository.countUserDistinctVideosRequestedToday(supabase, userId);
    if (distinctCount >= config.maxVideosPerDay) {
      throw new NoesRequestError("Limite quotidienne de vidéos Noès atteinte.", { status: 429, code: "quota_exceeded" });
    }

    const inFlight = deps.inFlightMap.get(videoHash);
    if (inFlight) {
      video = await inFlight;
    } else {
      const submission = (async () => {
        const pending = await noesRepository.insertPendingNoesVideo(supabase, {
          videoHash, slot, quizDate, batchIndex,
          knowledgeIds: batch.map((item) => item.knowledgeId),
          pipelineVersion: config.pipelineVersion,
          voice: config.voice,
          avatar: config.avatar,
          thinkingPauseSeconds: config.thinkingPauseSeconds
        });
        // Course perdue (23505 dans insertPendingNoesVideo) : la ligne
        // existante peut déjà être processing/ready, jamais de resoumission.
        if (pending.status !== "pending") return pending;
        const clients = deps.getRunpodClients();
        return submitNoesVideoJob({ supabase, runpodClient: clients?.runpodClient, pendingRow: pending, batchItems: batch, config });
      })();
      deps.inFlightMap.set(videoHash, submission);
      try {
        video = await submission;
      } finally {
        deps.inFlightMap.delete(videoHash);
      }
    }
  }

  if (!(await noesRepository.hasUserRequestedVideoToday(supabase, { userId, videoId: video.id }))) {
    await noesRepository.recordNoesVideoRequest(supabase, { userId, videoId: video.id });
    noesRepository.touchNoesVideoRequested(supabase, video.id, video.hit_count).catch((error) => {
      console.warn("[noes] compteur de demandes :", error.message);
    });
  }

  return video;
}

// Téléchargement volume RunPod -> upload storage (module isolé, cf.
// lib/coeus/noes-storage.js) -> ready -> nettoyage best-effort du volume.
async function finalizeNoesVideo({ supabase, clients, config }, row, jobOutput) {
  const outputKey = `coeus/outputs/${String(jobOutput.output_file || "").split("/").pop()}`;
  const video = await clients.volumeClient.downloadVideo(outputKey);
  const buffer = await streamToBuffer(video.body);

  const { publicUrl } = await uploadNoesVideo(supabase, {
    bucket: config.storageBucket,
    videoHash: row.video_hash,
    buffer,
    contentType: "video/mp4",
    cacheControl: config.storageCacheControl
  });

  await noesRepository.markNoesVideoReady(supabase, row.id, {
    outputPath: publicUrl,
    durationSeconds: jobOutput.duration ?? null,
    fileSizeBytes: jobOutput.output_size ?? buffer.length
  });

  try {
    await clients.volumeClient.deleteObject(outputKey);
  } catch (error) {
    // Best-effort : la vidéo est déjà publiée et servable (cf. rapport
    // d'audit section 7).
    console.warn("[noes] nettoyage volume RunPod :", error.message);
  }

  return publicUrl;
}

// Cycle de vie complet d'un job "processing" — appelée par GET /status
// (poll utilisateur, cf. rapport d'audit section 9 : "finalisation
// indépendante du navigateur") et par le sweeper de réconciliation.
// claimNoesVideoForFinalization protège contre une double finalisation.
async function pollAndFinalizeNoesVideo(deps, row) {
  const config = normalizeConfig(deps.config);
  const clients = deps.getRunpodClients();
  const { supabase } = deps;
  if (!clients || !row.runpod_job_id) return row;

  const ageMs = Date.now() - new Date(row.updated_at).getTime();
  let job;
  try {
    job = await clients.runpodClient.getCoeusVideoStatus(row.runpod_job_id);
  } catch (error) {
    if (ageMs < config.jobTimeoutMs) return row;
    const claimed = await noesRepository.claimNoesVideoForFinalization(supabase, { id: row.id });
    if (!claimed) return noesRepository.getNoesVideoById(supabase, row.id);
    await noesRepository.markNoesVideoFailed(supabase, row.id, { errorStage: "runpod_unreachable", errorMessage: error.message });
    return { ...row, status: "failed", error_stage: "runpod_unreachable" };
  }

  if (job.status === "COMPLETED") {
    const claimed = await noesRepository.claimNoesVideoForFinalization(supabase, { id: row.id });
    if (!claimed) return noesRepository.getNoesVideoById(supabase, row.id);
    try {
      const publicUrl = await finalizeNoesVideo({ supabase, clients, config }, row, job.output || {});
      return { ...row, status: "ready", output_path: publicUrl };
    } catch (error) {
      console.error("[noes] finalisation :", error.message);
      await noesRepository.markNoesVideoFailed(supabase, row.id, { errorStage: "finalize", errorMessage: error.message });
      return { ...row, status: "failed", error_stage: "finalize" };
    }
  }

  const terminalFailure = ["FAILED", "CANCELLED", "TIMED_OUT"].includes(job.status);
  if (terminalFailure || ageMs >= config.jobTimeoutMs) {
    const claimed = await noesRepository.claimNoesVideoForFinalization(supabase, { id: row.id });
    if (!claimed) return noesRepository.getNoesVideoById(supabase, row.id);
    await noesRepository.markNoesVideoFailed(supabase, row.id, {
      errorStage: terminalFailure ? "runpod" : "timeout",
      errorMessage: terminalFailure ? `RunPod status: ${job.status}` : "Délai de génération dépassé."
    });
    return { ...row, status: "failed", error_stage: terminalFailure ? "runpod" : "timeout" };
  }

  return row; // Toujours IN_QUEUE/IN_PROGRESS/RUNNING.
}

module.exports = {
  DEFAULT_CONFIG,
  NoesRequestError,
  getOrCreateNoesScript,
  submitNoesVideoJob,
  requestNoesVideo,
  finalizeNoesVideo,
  pollAndFinalizeNoesVideo
};
