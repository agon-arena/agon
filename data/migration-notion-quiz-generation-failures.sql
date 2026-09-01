-- À exécuter une fois dans le SQL editor de Supabase.
-- Trace durable d'un échec de génération de QCM notion/sujet libre (correctif
-- UX du 01/09/2026 — incident "Marxisme" : une coupure de connexion côté
-- navigateur pendant une génération longue (4-6 min avec gpt-5.6-luna)
-- affichait un message d'échec alors que le backend continuait et finissait
-- par réussir, et à l'inverse un vrai échec ne laissait aucune trace
-- interrogeable par le client). Permet à
-- GET /api/users/notion-quizzes/generation-status de répondre "failed" en
-- plus de "ready", ce qu'il ne pouvait pas faire avant.
CREATE TABLE IF NOT EXISTS notion_quiz_generation_failures (
  id BIGSERIAL PRIMARY KEY,
  -- Identité indépendante du niveau (même valeur que masterSlot côté
  -- server.js, ex. "notion:custom:<id>") : un échec à N'IMPORTE QUEL niveau
  -- doit être visible pour toute variante de slot suivie côté client.
  identity TEXT NOT NULL,
  code TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notion_quiz_generation_failures_identity_created
  ON notion_quiz_generation_failures (identity, created_at DESC);
