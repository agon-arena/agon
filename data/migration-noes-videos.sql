-- À exécuter une fois dans le SQL editor de Supabase.
-- Intégration Noès (mission du 26/08/2026, cf. rapport d'audit, section 6) :
-- cache/déduplication vidéo + statuts de job asynchrone RunPod.
--
-- Une ligne = UNE vidéo unique, mutualisée entre tous les utilisateurs qui
-- demandent exactement le même batch (mêmes connaissances, même ordre, même
-- voix/avatar/version de pipeline/durée de pause) — cf. video_hash,
-- lib/coeus/video-hash.js. Deux utilisateurs demandant le même contenu
-- retrouvent la MÊME ligne, jamais deux jobs RunPod distincts.
--
-- status : pending (ligne créée, avant confirmation RunPod) -> processing
-- (job RunPod accepté, runpod_job_id connu) -> finalizing (transition
-- courte, verrou atomique le temps du téléchargement+upload — cf.
-- claimNoesVideoForFinalization, lib/coeus/noes-repository.js) -> ready
-- (vidéo republiée sur Supabase Storage) ou failed (à n'importe quelle
-- étape, cf. error_stage/error_message). "finalizing" existe UNIQUEMENT
-- pour que la transition processing->finalizing serve de verrou : un
-- verrou basé sur l'égalité de updated_at a été essayé en premier puis
-- abandonné (27/08/2026) — deux écritures dans la même milliseconde
-- produisent la même chaîne ISO, donc la même comparaison passe deux fois
-- (constaté par un test réel, cf. test/noes-orchestrator.test.js). Une
-- transition de statut n'a pas ce problème, cf. rapport d'audit section 9.
--
-- knowledge_ids (jsonb) : tableau ORDONNÉ des natural_key des MemoryItems de
-- ce batch (au plus 5) — c'est ce même ordre qui entre dans video_hash, donc
-- toute permutation produit une ligne différente (cf. rapport, "le levier
-- n°1 pour ne pas casser la mutualisation").
CREATE TABLE IF NOT EXISTS noes_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_hash TEXT NOT NULL,
  slot TEXT NOT NULL,
  quiz_date DATE NOT NULL,
  batch_index INTEGER NOT NULL,
  knowledge_ids JSONB NOT NULL,
  pipeline_version TEXT NOT NULL,
  voice TEXT NOT NULL,
  avatar TEXT NOT NULL,
  thinking_pause_seconds NUMERIC NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'finalizing', 'ready', 'failed')),
  runpod_job_id TEXT,
  output_path TEXT,
  duration_seconds NUMERIC,
  file_size_bytes BIGINT,
  error_stage TEXT,
  error_message TEXT,
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_requested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ready_at TIMESTAMPTZ,
  UNIQUE (video_hash)
);

CREATE INDEX IF NOT EXISTS noes_videos_slot_quiz_date_idx ON noes_videos (slot, quiz_date, batch_index);
-- Utilisé par le sweeper de réconciliation (findStaleProcessingNoesVideos,
-- lib/coeus/noes-repository.js) pour retrouver les jobs "processing" restés
-- bloqués au-delà du timeout, sans scanner toute la table.
CREATE INDEX IF NOT EXISTS noes_videos_status_updated_at_idx ON noes_videos (status, updated_at);
