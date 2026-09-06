-- Déjà appliqué en direct via le SQL editor Supabase (copié-collé le
-- 06/09/2026), pas via ce fichier — versionné ici après coup pour documenter
-- le schéma réel, même convention que data/migration-user-question-exclusions.sql.
--
-- Remplace la logique "Passer"/"Ne plus me poser cette question"
-- (user_question_exclusions, par question_id, irréversible) par un choix
-- RÉVERSIBLE de mémorisation par CONNAISSANCE (Subject), cf. le diagnostic du
-- 06/09/2026 (lib/spaced-repetition/memory-model.js pour le vocabulaire
-- Subject/MemoryItem).
--
-- Clé = (user_id, subject_type, subject_source_id) : même paire que
-- memory_items.subject_type/subject_source_id (memory_items_subject_idx),
-- jamais question_id — décocher "Mémoriser" sur UNE question d'un Subject
-- exclut TOUTES ses questions (tous ses MemoryItems) des sélecteurs FSRS,
-- pas seulement celle depuis laquelle on a cliqué.
--
-- Ne touche jamais memory_items/memory_item_fsrs_states/memory_review_events
-- (master partagé + historique FSRS intacts) : c'est un pur filtre appliqué
-- à la LECTURE (fetchCultureGeneraleReviewInjectionForToday,
-- fetchLearningLoadGaugeForUser), jamais une suppression/un recalcul FSRS.
--
-- memorization_enabled DEFAULT true : absence de ligne = mémorisation
-- active (rétrocompatibilité stricte avec toutes les connaissances
-- existantes, jamais de backfill nécessaire).
--
-- API attendue : upsert explicite avec la valeur voulue (enabled: true/false),
-- jamais un toggle relatif — idempotent par construction face à un double
-- clic/des requêtes en désordre (même onConflict que user_question_exclusions/
-- user_notion_quizzes, mais SANS ignoreDuplicates: true, pour permettre
-- l'écrasement d'une valeur déjà posée).
CREATE TABLE IF NOT EXISTS user_subject_memorization_preferences (
  user_id UUID NOT NULL REFERENCES users(id),
  subject_type TEXT NOT NULL,
  subject_source_id TEXT NOT NULL,
  memorization_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, subject_type, subject_source_id)
);
