"use strict";

// Isolé dans son propre module (finalisation du 27/08/2026, demande
// explicite) : seul ce fichier connaît "comment/où" vit une vidéo Noès
// finale. Aujourd'hui Supabase Storage (bucket existant, réutilisé plutôt
// que d'en créer un nouveau), mais l'orchestrateur (noes-orchestrator.js)
// ne connaît que `uploadNoesVideo({ bucket, videoHash, buffer }) ->
// { publicUrl }` — remplacer Supabase Storage par une autre solution plus
// tard (si l'egress le justifie, cf. mémoire projet) ne touchera que ce
// fichier.
const NOES_STORAGE_PREFIX = "noes";

// Nom de fichier content-addressed par video_hash (cf. lib/coeus/video-hash.js) :
// jamais besoin d'invalidation de cache, un Cache-Control long/immutable est
// toujours sûr à poser (cf. cacheControl passé par l'appelant).
function buildNoesStorageObjectPath(videoHash) {
  return `${NOES_STORAGE_PREFIX}/${videoHash}.mp4`;
}

async function uploadNoesVideo(supabase, { bucket, videoHash, buffer, contentType = "video/mp4", cacheControl }) {
  const objectPath = buildNoesStorageObjectPath(videoHash);
  const { error } = await supabase.storage
    .from(bucket)
    .upload(objectPath, buffer, { contentType, cacheControl, upsert: true });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  const publicUrl = String(data?.publicUrl || "").trim();
  if (!publicUrl) throw new Error("URL publique Supabase Storage introuvable.");
  return { objectPath, publicUrl };
}

module.exports = { NOES_STORAGE_PREFIX, buildNoesStorageObjectPath, uploadNoesVideo };
