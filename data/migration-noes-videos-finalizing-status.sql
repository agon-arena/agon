-- À exécuter une fois dans le SQL editor de Supabase, APRÈS
-- migration-noes-videos.sql (déjà appliquée le 26/08/2026).
--
-- Ajoute "finalizing" aux statuts autorisés de noes_videos.status (27/08/2026) :
-- correction d'un verrou de finalisation qui comparait updated_at (deux
-- écritures dans la même milliseconde produisent la même chaîne ISO,
-- rendant la comparaison inopérante et permettant une double publication
-- storage — constaté par un test réel, cf.
-- test/noes-orchestrator.test.js "deux finalisations concurrentes").
-- processing -> finalizing est désormais une transition de STATUT
-- atomique (même principe que pending -> processing,
-- claimPendingNoesVideoForSubmission), robuste indépendamment de toute
-- résolution d'horloge. Cf. lib/coeus/noes-repository.js,
-- claimNoesVideoForFinalization.
ALTER TABLE noes_videos DROP CONSTRAINT IF EXISTS noes_videos_status_check;
ALTER TABLE noes_videos ADD CONSTRAINT noes_videos_status_check
  CHECK (status IN ('pending', 'processing', 'finalizing', 'ready', 'failed'));
