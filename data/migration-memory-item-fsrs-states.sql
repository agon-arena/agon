-- À exécuter une fois dans le SQL editor de Supabase. Deuxième brique de la
-- refonte FSRS (cf. data/migration-memory-items.sql,
-- lib/spaced-repetition/scheduler-version.js).
--
-- Une ligne = l'état FSRS courant d'UN utilisateur pour UN MemoryItem —
-- jamais par Subject, jamais par QuestionVariant (cf.
-- lib/spaced-repetition/memory-model.js). Cette ligne est MISE À JOUR à
-- chaque review (mutable, contrairement à memory_review_events qui est un
-- append-only log durable des reviews individuelles).
--
-- Champs alignés sur l'objet Card de ts-fsrs 5.4.1 (cf.
-- node_modules/ts-fsrs/dist/index.d.ts), à l'exception volontaire de
-- `elapsed_days` (marqué @deprecated par ts-fsrs lui-même, "sera retiré en
-- 6.0.0" — recalculé à la volée depuis due_at/last_review_at si besoin,
-- jamais persisté).
--
-- Choix de types pensés pour rester valides après un futur passage à
-- FSRS-7 (intervalles fractionnaires, reviews intra-journalières) SANS
-- migration de schéma, cf. lib/spaced-repetition/scheduler-version.js :
-- - due_at est un TIMESTAMPTZ (échéance exacte), jamais une DATE ni un
--   compteur de jours entiers.
-- - scheduled_days est en DOUBLE PRECISION, pas INTEGER, même si FSRS-6
--   (ts-fsrs 5.x, next_interval()) calcule aujourd'hui un entier de jours en
--   interne — la colonne n'encode elle-même aucune hypothèse d'entier.
-- - scheduler_model_id trace quel modèle a produit l'état courant de cette
--   ligne (ex. "ts-fsrs@5.4.1:fsrs-6") : un changement de modèle plus tard
--   ne réécrit jamais l'historique, il fait juste avancer ce tag sur les
--   nouvelles écritures.
CREATE TABLE IF NOT EXISTS memory_item_fsrs_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  memory_item_id UUID NOT NULL REFERENCES memory_items(id),
  state TEXT NOT NULL CHECK (state IN ('New', 'Learning', 'Review', 'Relearning')),
  due_at TIMESTAMPTZ NOT NULL,
  stability DOUBLE PRECISION NOT NULL,
  difficulty DOUBLE PRECISION NOT NULL,
  scheduled_days DOUBLE PRECISION NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_review_at TIMESTAMPTZ,
  scheduler_model_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, memory_item_id)
);

CREATE INDEX IF NOT EXISTS memory_item_fsrs_states_user_due_idx ON memory_item_fsrs_states (user_id, due_at);
