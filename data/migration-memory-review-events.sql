-- À exécuter une fois dans le SQL editor de Supabase. Troisième brique de la
-- refonte FSRS (cf. data/migration-memory-items.sql,
-- data/migration-memory-item-fsrs-states.sql).
--
-- Log append-only, JAMAIS purgé (volontairement absent de
-- lib/data-retention.js/runDataRetentionCleanup — ne pas l'y ajouter) et
-- JAMAIS réécrit : une ligne par review réelle, contrairement à
-- memory_item_fsrs_states qui ne garde que l'état courant. C'est la mémoire
-- longue durée dont l'absence de purge automatique était tout l'enjeu du
-- bug F1 corrigé en tâche #1.
--
-- reviewed_at est l'instant EXACT de la review (précision TIMESTAMPTZ
-- native Postgres, très sous la seconde) : aucune contrainte ne réduit deux
-- reviews réelles du même MemoryItem le même jour à une seule ligne — la
-- contrainte unique porte sur (user_id, memory_item_id, reviewed_at), donc
-- seuls des doublons EXACTEMENT simultanés (réinsertion idempotente d'un
-- backfill) sont dédupliqués, jamais deux reviews à des instants distincts
-- du même jour.
--
-- rating est le grade FSRS réellement appliqué (Again/Hard/Good/Easy),
-- produit par mapMnoriaReviewToFsrsRating() à partir de (is_correct,
-- perceived_difficulty). Les deux entrées de ce mapping restent aussi
-- stockées séparément et brutes : is_correct (résultat objectif, toujours
-- dominant) et perceived_difficulty (signal de métacognition Facile/Moyen/
-- Difficile, ex. pour détecter un "confidence_mismatch" plus tard) — jamais
-- fusionnées ni perdues, cf. invariant de la spec FSRS sur la
-- métacognition.
--
-- due_at/stability_after/difficulty_after/elapsed_days reprennent tels
-- quels les champs renvoyés par ts-fsrs (result.card.due,
-- result.card.stability, result.card.difficulty, result.log — champ
-- "elapsed" du calcul, cf. lib/spaced-repetition/scheduler-version.js pour
-- le choix de precision DOUBLE PRECISION plutôt qu'un entier de jours,
-- pensé pour rester valide après un futur passage à FSRS-7).
CREATE TABLE IF NOT EXISTS memory_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  memory_item_id UUID NOT NULL REFERENCES memory_items(id),
  question_variant TEXT NOT NULL CHECK (question_variant IN ('base', 'alt')),
  is_correct BOOLEAN NOT NULL,
  perceived_difficulty TEXT CHECK (perceived_difficulty IN ('facile', 'moyen', 'difficile')),
  rating TEXT NOT NULL CHECK (rating IN ('Again', 'Hard', 'Good', 'Easy')),
  elapsed_days DOUBLE PRECISION,
  due_at TIMESTAMPTZ NOT NULL,
  stability_after DOUBLE PRECISION NOT NULL,
  difficulty_after DOUBLE PRECISION NOT NULL,
  scheduler_model_id TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, memory_item_id, reviewed_at)
);

CREATE INDEX IF NOT EXISTS memory_review_events_user_item_idx ON memory_review_events (user_id, memory_item_id, reviewed_at);
