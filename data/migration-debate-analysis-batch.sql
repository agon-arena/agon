-- À exécuter une fois dans le SQL editor de Supabase.
--
-- Chantier "Batch OpenAI pour les rapports IA de débat générés
-- automatiquement par le compte à rebours" (08/09/2026).
--
-- Objectif : les rapports demandés manuellement par un clic admin restent
-- 100% synchrones (généralité immédiate, coût normal) ; les rapports
-- déclenchés automatiquement par l'expiration du compte à rebours passent par
-- l'API Batch OpenAI (-50% sur tous les tokens, cf. lib/ai-usage-log.js).
--
-- generateAnalysisJson (lib/debate-analysis.js) n'est JAMAIS réécrit : côté
-- automatique, il est simplement REJOUÉ à chaque cycle du scheduler existant
-- (setInterval 15 min, server.js) avec un callOpenAI qui redirige chaque
-- appel IA individuel vers cette table plutôt que vers un vrai appel réseau —
-- même principe que notion_quiz_pregeneration_calls (cf.
-- data/migration-notion-quiz-pregeneration-queue.sql), mais table dédiée et
-- indépendante : jamais partagée avec le pipeline QCM.
--
-- Contrairement à notion_quiz_pregeneration_calls (clé = queue_id + call_key +
-- occurrence, un compteur positionnel), chaque ligne ici est identifiée par
-- (debate_id, step_key) où step_key encode l'étape ET l'identité stable de
-- l'idée concernée (ex. "p2_98765_a", "p3_98765", "p1_a", "p4") — jamais un
-- compteur d'ordre d'exécution, qui serait instable d'un cycle à l'autre
-- puisque les votes (donc l'ordre de traitement des idées) peuvent changer
-- entre deux cycles d'un débat vivant.
--
-- Pas de FOREIGN KEY vers debates(id) : évite tout risque de divergence de
-- type avec la colonne existante, le nettoyage se fait explicitement par
-- server.js (DELETE ... WHERE debate_id = ...) à chaque nouveau cycle
-- programmé, jamais par cascade implicite.
CREATE TABLE IF NOT EXISTS debate_analysis_batch_calls (
  id BIGSERIAL PRIMARY KEY,
  debate_id BIGINT NOT NULL,
  step_key TEXT NOT NULL,          -- ex. "p1_a", "grid", "p2_98765_a", "p3_98765", "p4", "popularity"
  feature TEXT NOT NULL,           -- même taxonomie que le chemin synchrone (debate_p1/p2/p3/p4/grid/arbitration/popularity_analysis), pour ai_usage_log
  custom_id TEXT NOT NULL UNIQUE,  -- "d:<debate_id>:<step_key>" — envoyé tel quel comme custom_id OpenAI
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'batch_submitted', 'completed', 'failed')),
  request_payload JSONB NOT NULL,  -- {model, messages, temperature, responseFormat} — identique à ce que le chemin synchrone enverrait
  batch_id TEXT,
  result_content TEXT,             -- contenu retourné (choices[0].message.content), une fois completed
  error_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (debate_id, step_key)
);
CREATE INDEX IF NOT EXISTS debate_analysis_batch_calls_status_idx
  ON debate_analysis_batch_calls (status);
CREATE INDEX IF NOT EXISTS debate_analysis_batch_calls_batch_id_idx
  ON debate_analysis_batch_calls (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS debate_analysis_batch_calls_debate_id_idx
  ON debate_analysis_batch_calls (debate_id);
