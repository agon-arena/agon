-- À exécuter une fois dans le SQL editor de Supabase.
-- Chantier "pré-génération en avance des sujets IA proposés via l'API Batch
-- OpenAI" (07/09/2026). Deux tables :
--
-- 1. notion_quiz_pregeneration_queue : UN sujet global à pré-générer (identité
--    = normalized_key, la même que buildCustomTopicMasterSlot/normalizeCustomTopicKey
--    utilisent déjà pour le catalogue "notion:custom:*"). Jamais liée à un
--    utilisateur, un débat ou une recommandation précise — proposal_count/
--    last_proposed_at tracent seulement la fréquence de la demande pour
--    prioriser le scheduler.
--
-- 2. notion_quiz_pregeneration_calls : CHAQUE appel IA individuel qu'un sujet
--    a eu besoin de faire pour progresser (curriculum, réparation, fiche,
--    questions, régénération ciblée...). C'est le mécanisme de reprise après
--    redémarrage : le pipeline existant (server.js, ensureProgressiveElementaryGenerated/
--    continueProgressiveGeneration, INCHANGÉS) est rejoué depuis le début à
--    chaque cycle scheduler ; chaque appel déjà résolu ici est servi depuis
--    le cache (aucun nouvel appel réseau), le pipeline avance donc
--    naturellement jusqu'au premier appel encore non résolu, qui redevient
--    le nouveau point de blocage. custom_id (déterministe, cf. rapport final)
--    permet de retrouver queue_id/call_key/occurrence/batch_id dans les deux
--    sens depuis une réponse Batch OpenAI.
CREATE TABLE IF NOT EXISTS notion_quiz_pregeneration_queue (
  id BIGSERIAL PRIMARY KEY,
  normalized_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'queued', 'generating', 'ready', 'failed')),
  master_slot TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'ai_fallback_proposal',
  proposal_count INTEGER NOT NULL DEFAULT 1,
  last_proposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Rattrapage si la table existait déjà dans un état antérieur (sans ces colonnes) :
ALTER TABLE notion_quiz_pregeneration_queue
  ADD COLUMN IF NOT EXISTS master_slot TEXT,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ai_fallback_proposal',
  ADD COLUMN IF NOT EXISTS proposal_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_proposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS error_reason TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS notion_quiz_pregeneration_queue_status_idx
  ON notion_quiz_pregeneration_queue (status);
-- Priorité scheduler : proposal_count DESC, last_proposed_at DESC, created_at ASC.
CREATE INDEX IF NOT EXISTS notion_quiz_pregeneration_queue_priority_idx
  ON notion_quiz_pregeneration_queue (status, proposal_count DESC, last_proposed_at DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS notion_quiz_pregeneration_calls (
  id BIGSERIAL PRIMARY KEY,
  queue_id BIGINT NOT NULL REFERENCES notion_quiz_pregeneration_queue(id) ON DELETE CASCADE,
  call_key TEXT NOT NULL,          -- = opts.feature (ex. "curriculum_generation", "elementary_fiche_generation")
  occurrence INTEGER NOT NULL DEFAULT 1, -- Nième occurrence de ce call_key pour ce sujet (régénérations)
  custom_id TEXT NOT NULL UNIQUE,  -- "<queue_id>:<call_key>:<occurrence>" — traçable dans les deux sens
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'batch_submitted', 'completed', 'failed')),
  request_payload JSONB NOT NULL,  -- {model, messages, temperature, response_format, timeoutMs} — construit une fois, réutilisé tel quel à la soumission Batch
  batch_id TEXT,
  result_content TEXT,             -- contenu retourné (choices[0].message.content), une fois completed
  error_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (queue_id, call_key, occurrence)
);
-- Même rattrapage défensif que ci-dessus, au cas où cette table préexistait aussi :
ALTER TABLE notion_quiz_pregeneration_calls
  ADD COLUMN IF NOT EXISTS occurrence INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS batch_id TEXT,
  ADD COLUMN IF NOT EXISTS result_content TEXT,
  ADD COLUMN IF NOT EXISTS error_reason TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS notion_quiz_pregeneration_calls_status_idx
  ON notion_quiz_pregeneration_calls (status);
CREATE INDEX IF NOT EXISTS notion_quiz_pregeneration_calls_batch_id_idx
  ON notion_quiz_pregeneration_calls (batch_id) WHERE batch_id IS NOT NULL;
