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
