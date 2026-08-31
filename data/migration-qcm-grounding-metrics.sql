-- À exécuter une fois dans le SQL editor de Supabase
-- Observabilité du grounding QCM (V3.1, 31/08/2026 — "validation bout-en-bout
-- et observabilité du grounding QCM"). Une ligne par génération de QCM
-- complète (jamais par appel IA individuel — voir ai_usage_log pour ça),
-- mesurant l'efficacité du contrôle de traçabilité aux sources
-- (lib/question-grounding-validation.js). Toujours écrite en best-effort
-- (lib/qcm-grounding-metrics.js recordQcmGroundingMetrics) : une panne
-- d'insertion ici n'affecte jamais la génération du QCM elle-même.
--
-- "grounding_accepted_*" signifie "le validateur V3 n'a détecté aucun
-- problème de traçabilité", jamais "ce fait est scientifiquement garanti
-- vrai" — cf. le commentaire de tête de lib/qcm-grounding-metrics.js.
CREATE TABLE IF NOT EXISTS qcm_grounding_metrics (
  id BIGSERIAL PRIMARY KEY,
  -- Identifiant technique de génération (même id que dans les logs
  -- [web-search-grounding:id]/[qcm-quality]) — jamais un identifiant
  -- utilisateur, jamais un contenu personnel.
  generation_id TEXT,
  route TEXT,
  level TEXT,
  source_type TEXT,
  grounding_enabled BOOLEAN NOT NULL DEFAULT false,
  questions_requested INTEGER,
  questions_generated INTEGER,
  grounding_candidates_first_pass INTEGER NOT NULL DEFAULT 0,
  grounding_accepted_first_pass INTEGER NOT NULL DEFAULT 0,
  grounding_rejected_first_pass INTEGER NOT NULL DEFAULT 0,
  grounding_regenerated INTEGER NOT NULL DEFAULT 0,
  grounding_accepted_after_regeneration INTEGER NOT NULL DEFAULT 0,
  grounding_failed_final INTEGER NOT NULL DEFAULT 0,
  final_accepted INTEGER,
  -- Compact : uniquement {"GROUNDING_XXX": count, ...}, jamais de prompt,
  -- de page source complète ou de fenêtre de preuve intégrale.
  reasons JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qcm_grounding_metrics_created_at
  ON qcm_grounding_metrics (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_qcm_grounding_metrics_route_created
  ON qcm_grounding_metrics (route, created_at DESC);

-- Exemples de requêtes d'agrégation (section 8 de la demande) :
--
-- Taux d'acceptation initial :
--   SELECT SUM(grounding_accepted_first_pass)::float / NULLIF(SUM(grounding_candidates_first_pass), 0)
--   FROM qcm_grounding_metrics WHERE grounding_enabled;
--
-- Efficacité de la régénération :
--   SELECT SUM(grounding_accepted_after_regeneration)::float / NULLIF(SUM(grounding_regenerated), 0)
--   FROM qcm_grounding_metrics WHERE grounding_enabled;
--
-- Distribution des motifs de rejet (JSONB déplié) :
--   SELECT key AS reason_code, SUM(value::int) AS total
--   FROM qcm_grounding_metrics, jsonb_each_text(reasons)
--   WHERE grounding_enabled
--   GROUP BY key ORDER BY total DESC;
--
-- Par niveau ou type de source (section 9) :
--   SELECT level, source_type,
--          SUM(grounding_rejected_first_pass)::float / NULLIF(SUM(grounding_candidates_first_pass), 0) AS taux_rejet
--   FROM qcm_grounding_metrics WHERE grounding_enabled
--   GROUP BY level, source_type;
