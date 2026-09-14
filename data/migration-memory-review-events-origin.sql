-- À exécuter une fois dans le SQL editor de Supabase. Demande du 14/09/2026,
-- "les éléments de Relier ou Ancrer ne font pas partie de la jauge, et
-- n'apparaissent pas dans la liste des éléments à mémoriser du jour" —
-- jusqu'ici memory_review_events ne distinguait pas d'où venait une repasse
-- (Découvrir/Ancrer/Relier écrivent toutes les trois dans la même table via
-- applyFsrsReviewForDailyQuizAnswer, server.js). Additive uniquement :
-- DEFAULT 'decouvrir' pour les lignes déjà existantes (jamais recalculé
-- rétroactivement, aucun moyen fiable de le déduire après coup) — seules les
-- nouvelles lignes portent la vraie origine, cf. server.js.
ALTER TABLE memory_review_events ADD COLUMN IF NOT EXISTS review_origin text NOT NULL DEFAULT 'decouvrir';
ALTER TABLE memory_review_events DROP CONSTRAINT IF EXISTS memory_review_events_review_origin_check;
ALTER TABLE memory_review_events ADD CONSTRAINT memory_review_events_review_origin_check
  CHECK (review_origin = ANY (ARRAY['decouvrir', 'ancrer', 'relier']::text[]));
