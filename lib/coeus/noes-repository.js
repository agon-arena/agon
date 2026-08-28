"use strict";

// Accès Supabase pour l'intégration Noès (mission du 26/08/2026). Toutes les
// fonctions reçoivent `supabase` en premier argument (même convention que
// resolveLegacyUser, lib/users.js) plutôt que d'importer un client module :
// testable sans connexion réelle, cf. test/noes-repository.test.js.

const NOES_JOB_STALE_MS_DEFAULT = 5 * 60 * 1000;

async function getNoesScript(supabase, { slot, quizDate }) {
  const { data, error } = await supabase
    .from("noes_scripts")
    .select("id, slot, quiz_date, source_type, items, model")
    .eq("slot", slot)
    .eq("quiz_date", quizDate)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

// Idempotent face à une course entre deux requêtes concurrentes pour la même
// fiche (même principe que l'insertion de daily_quiz, cf. server.js
// POST /api/users/notion-quizzes/custom) : la contrainte UNIQUE(slot,
// quiz_date) fait échouer le second insert avec 23505, on relit alors la
// ligne déjà écrite par le premier plutôt que d'écraser ou de dupliquer un
// appel IA.
async function insertNoesScript(supabase, { slot, quizDate, sourceType, items, model }) {
  const { data, error } = await supabase
    .from("noes_scripts")
    .insert({ slot, quiz_date: quizDate, source_type: sourceType, items, model })
    .select("id, slot, quiz_date, source_type, items, model")
    .single();
  if (!error) return data;
  if (error.code === "23505") return getNoesScript(supabase, { slot, quizDate });
  throw new Error(error.message);
}

async function getNoesVideoByHash(supabase, videoHash) {
  const { data, error } = await supabase
    .from("noes_videos")
    .select("*")
    .eq("video_hash", videoHash)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function getNoesVideoById(supabase, id) {
  const { data, error } = await supabase
    .from("noes_videos")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

// Même logique de course que insertNoesScript : la contrainte
// UNIQUE(video_hash) est ce qui empêche deux requêtes simultanées (deux
// onglets, deux utilisateurs) de créer deux lignes — donc deux jobs RunPod —
// pour un contenu strictement identique (cf. rapport d'audit section 9,
// "deux onglets demandent la même vidéo").
async function insertPendingNoesVideo(supabase, {
  videoHash, slot, quizDate, batchIndex, knowledgeIds,
  pipelineVersion, voice, avatar, thinkingPauseSeconds
}) {
  const { data, error } = await supabase
    .from("noes_videos")
    .insert({
      video_hash: videoHash,
      slot,
      quiz_date: quizDate,
      batch_index: batchIndex,
      knowledge_ids: knowledgeIds,
      pipeline_version: pipelineVersion,
      voice,
      avatar,
      thinking_pause_seconds: thinkingPauseSeconds,
      status: "pending"
    })
    .select("*")
    .single();
  if (!error) return data;
  if (error.code === "23505") return getNoesVideoByHash(supabase, videoHash);
  throw new Error(error.message);
}

// Verrou optimiste côté soumission (cf. claimNoesVideoForFinalization plus
// bas pour son équivalent côté finalisation) : seule la requête qui réussit
// à faire passer la ligne pending -> processing a le droit d'appeler RunPod.
// Nécessaire en plus du Map<hash, Promise> en mémoire de server.js, qui ne
// protège que les requêtes concurrentes DANS le même process Node — cette
// contrainte protège aussi contre plusieurs instances Mnoria.
async function claimPendingNoesVideoForSubmission(supabase, id) {
  const { data, error } = await supabase
    .from("noes_videos")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) throw new Error(error.message);
  return Boolean(data && data.length);
}

async function markNoesVideoProcessing(supabase, id, runpodJobId) {
  const { error } = await supabase
    .from("noes_videos")
    .update({ status: "processing", runpod_job_id: runpodJobId, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

async function markNoesVideoReady(supabase, id, { outputPath, durationSeconds, fileSizeBytes, subtitleCues }) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("noes_videos")
    .update({
      status: "ready",
      output_path: outputPath,
      duration_seconds: durationSeconds,
      file_size_bytes: fileSizeBytes,
      subtitle_cues: subtitleCues,
      error_stage: null,
      error_message: null,
      updated_at: now,
      ready_at: now
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

async function markNoesVideoFailed(supabase, id, { errorStage, errorMessage }) {
  const { error } = await supabase
    .from("noes_videos")
    .update({
      status: "failed",
      error_stage: errorStage || null,
      error_message: String(errorMessage || "").slice(0, 500),
      updated_at: new Date().toISOString()
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// Reprise extrêmement ciblée après ajout/correction des variables serveur : seule une ligne
// failed à l'étape configuration peut redevenir pending. La double condition dans l'UPDATE
// forme un verrou atomique entre instances ; aucun échec RunPod, timeout ou finalisation ne
// peut être resoumis par cette fonction.
async function claimFailedConfigurationNoesVideoForRetry(supabase, id) {
  const { data, error } = await supabase
    .from("noes_videos")
    .update({
      status: "pending",
      error_stage: null,
      error_message: null,
      runpod_job_id: null,
      updated_at: new Date().toISOString()
    })
    .eq("id", id)
    .eq("status", "failed")
    .eq("error_stage", "configuration")
    .select("id");
  if (error) throw new Error(error.message);
  return Boolean(data && data.length);
}

// Reprend uniquement un job déjà soumis que Mnoria avait déclaré trop tôt en
// timeout. Aucun champ job n'est effacé : le même runpod_job_id est conservé et
// aucun nouveau rendu ne peut être créé par cette transition.
async function claimTimedOutNoesVideoForResume(supabase, id) {
  const { data, error } = await supabase
    .from("noes_videos")
    .update({ status: "processing", error_stage: null, error_message: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "failed")
    .eq("error_stage", "timeout")
    .select("id");
  if (error) throw new Error(error.message);
  return Boolean(data && data.length);
}

// Réconciliation (cf. rapport d'audit section 9) : jobs "processing" restés
// bloqués au-delà du délai attendu (RunPod indisponible, Mnoria redémarré
// avant d'avoir pu finaliser, etc.) — le sweeper de server.js re-vérifie
// leur statut RunPod avant de les déclarer définitivement failed, jamais un
// abandon silencieux.
async function findStaleProcessingNoesVideos(supabase, olderThanMs = NOES_JOB_STALE_MS_DEFAULT) {
  const threshold = new Date(Date.now() - olderThanMs).toISOString();
  const { data, error } = await supabase
    .from("noes_videos")
    .select("*")
    .eq("status", "processing")
    .lt("updated_at", threshold)
    .limit(50);
  if (error) throw new Error(error.message);
  return data || [];
}

// Verrou par transition de statut (processing -> finalizing), même principe
// que claimPendingNoesVideoForSubmission (pending -> processing) et que le
// claim atomique scheduled->generating de l'auto-analysis scheduler,
// server.js : n'autorise la finalisation (téléchargement + publication +
// passage à ready/failed) qu'à l'appelant dont l'UPDATE...WHERE
// status='processing' matche RÉELLEMENT en base.
//
// Ancienne version (retirée le 27/08/2026) : comparait updated_at au lieu
// du statut — un test d'intégration réel (deux appels concurrents sur le
// même job COMPLETED) a montré que deux écritures survenant dans la MÊME
// milliseconde produisent la MÊME chaîne ISO, rendant cette comparaison
// inopérante (les deux appelants passaient le verrou, double publication
// storage). Une transition de statut n'a pas ce problème : Postgres
// n'applique l'UPDATE qu'à la ligne dont le statut EN BASE est encore
// "processing" au moment exact de l'écriture, indépendamment de toute
// résolution d'horloge — cf. test/noes-orchestrator.test.js, "deux
// finalisations concurrentes".
async function claimNoesVideoForFinalization(supabase, { id }) {
  const { data, error } = await supabase
    .from("noes_videos")
    .update({ status: "finalizing", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "processing")
    .select("id");
  if (error) throw new Error(error.message);
  return Boolean(data && data.length);
}

// Journal des demandes (quota + observabilité, cf. migration-noes-video-
// requests.sql). Ne compte jamais deux fois la même vidéo pour le même
// utilisateur le même jour : rejouer une vidéo déjà demandée aujourd'hui
// reste gratuit et n'insère pas de nouvelle ligne.
async function hasUserRequestedVideoToday(supabase, { userId, videoId }) {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from("noes_video_requests")
    .select("id")
    .eq("user_id", userId)
    .eq("video_id", videoId)
    .gte("requested_at", startOfDay.toISOString())
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function countUserDistinctVideosRequestedToday(supabase, userId) {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from("noes_video_requests")
    .select("video_id")
    .eq("user_id", userId)
    .gte("requested_at", startOfDay.toISOString());
  if (error) throw new Error(error.message);
  return new Set((data || []).map((row) => row.video_id)).size;
}

async function recordNoesVideoRequest(supabase, { userId, videoId }) {
  // requested_date : colonne simple écrite explicitement ici (jamais dérivée
  // en base par une expression d'index, cf. le commentaire de
  // migration-noes-video-requests.sql — deux tentatives d'index basées sur
  // une expression ont été rejetées par Postgres, IMMUTABLE requis).
  const requestedDate = new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from("noes_video_requests")
    .insert({ user_id: userId, video_id: videoId, requested_date: requestedDate });
  // 23505 = déjà enregistré aujourd'hui pour ce couple (cf. l'index unique
  // de migration-noes-video-requests.sql) : hasUserRequestedVideoToday
  // évite déjà ce cas en amont, ce n'est qu'un filet pour une course exacte.
  if (error && error.code !== "23505") throw new Error(error.message);
}

async function touchNoesVideoRequested(supabase, id, currentHitCount) {
  const { error } = await supabase
    .from("noes_videos")
    .update({ hit_count: (Number(currentHitCount) || 0) + 1, last_requested_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

module.exports = {
  NOES_JOB_STALE_MS_DEFAULT,
  getNoesScript,
  insertNoesScript,
  getNoesVideoByHash,
  getNoesVideoById,
  insertPendingNoesVideo,
  claimPendingNoesVideoForSubmission,
  markNoesVideoProcessing,
  markNoesVideoReady,
  markNoesVideoFailed,
  claimFailedConfigurationNoesVideoForRetry,
  claimTimedOutNoesVideoForResume,
  findStaleProcessingNoesVideos,
  claimNoesVideoForFinalization,
  hasUserRequestedVideoToday,
  countUserDistinctVideosRequestedToday,
  recordNoesVideoRequest,
  touchNoesVideoRequested
};
