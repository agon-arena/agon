-- À exécuter une fois dans le SQL editor de Supabase
-- Instrumentation légère des appels IA (audit du 22/08/2026, phase 1).
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id BIGSERIAL PRIMARY KEY,
  feature TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_tokens INTEGER,
  estimated_cost_usd NUMERIC,
  latency_ms INTEGER,
  success BOOLEAN NOT NULL DEFAULT true,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_feature_created
  ON ai_usage_log (feature, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_created_at
  ON ai_usage_log (created_at DESC);

-- Instrumentation coût/génération QCM (01/09/2026) : identifiant commun à
-- tous les appels IA d'une même génération QCM complète (fiche, admission,
-- critique, sélection de sources, régénération ciblée, expansion V3.2 —
-- réutilise le "id"/"sourceId" déjà propagé dans tout le pipeline
-- notion-quiz de server.js, jamais un nouvel identifiant inventé). NULL pour
-- tout appel hors pipeline QCM (comportement antérieur inchangé).
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS generation_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_generation_id
  ON ai_usage_log (generation_id) WHERE generation_id IS NOT NULL;
