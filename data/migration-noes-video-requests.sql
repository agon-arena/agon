-- À exécuter une fois dans le SQL editor de Supabase.
-- Intégration Noès (mission du 26/08/2026) : journal léger des demandes,
-- séparé de noes_videos (qui est un cache PARTAGÉ entre utilisateurs, donc
-- ne peut pas porter "qui a demandé quoi"). Sert à deux choses :
--
-- 1. Quota — POST /api/noes/videos plafonne à NOES_MAX_VIDEOS_PER_DAY (4 par
--    défaut, cf. server.js) le nombre de vidéos DISTINCTES demandées par
--    utilisateur et par jour. Une ligne déjà existante pour (user_id,
--    video_id, aujourd'hui) ne recompte jamais dans le quota : rejouer une
--    vidéo déjà demandée aujourd'hui reste gratuit.
-- 2. Observabilité — distingue "demandes" de "générations réelles"
--    (cf. rapport d'audit section 16, ratio vidéos générées/regardées) :
--    plusieurs lignes ici peuvent pointer vers la même ligne noes_videos.
-- requested_date (DATE, colonne simple plutôt qu'une expression sur
-- requested_at) : deux tentatives d'index basées sur une expression
-- (requested_at::date, puis floor(extract(epoch from requested_at)/86400))
-- ont toutes les deux été rejetées par Postgres ("functions in index
-- expression must be marked IMMUTABLE") — date_part/extract(timestamptz)
-- est STABLE en PostgreSQL, jamais IMMUTABLE, même sur un calcul en soi
-- indépendant du fuseau horaire. Une colonne ordinaire n'a pas ce problème
-- (aucune fonction dans l'index) : calculée et écrite explicitement par
-- l'application à l'insertion (cf. recordNoesVideoRequest,
-- lib/coeus/noes-repository.js), jamais dérivée en base.
CREATE TABLE IF NOT EXISTS noes_video_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  video_id UUID NOT NULL REFERENCES noes_videos(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested_date DATE NOT NULL
);

CREATE INDEX IF NOT EXISTS noes_video_requests_user_requested_at_idx ON noes_video_requests (user_id, requested_at);
CREATE INDEX IF NOT EXISTS noes_video_requests_video_id_idx ON noes_video_requests (video_id);
-- Verrou de dernier recours contre un double insert (deux onglets du même
-- utilisateur cliquant au même instant) : hasUserRequestedVideoToday fait
-- déjà cette vérification en amont, cet index la rend infaillible même en
-- cas de course exacte (recordNoesVideoRequest avale alors le 23505).
CREATE UNIQUE INDEX IF NOT EXISTS noes_video_requests_user_video_day_idx
  ON noes_video_requests (user_id, video_id, requested_date);
