-- À exécuter une fois dans le SQL editor de Supabase (appliqué en direct le
-- 06/09/2026, versionné ici après coup — même convention que les autres
-- migrations "déjà appliquées en direct").
--
-- Remplace la logique "Passer"/"Ne plus me poser cette question"
-- (user_question_exclusions, par question_id, irréversible) par un choix
-- RÉVERSIBLE de mémorisation par CONNAISSANCE (knowledgeTarget), cf. le
-- complément de diagnostic du 06/09/2026.
--
-- Remplace aussi data/migration-user-subject-memorization-preferences.sql
-- (table user_subject_memorization_preferences, granularité Subject entier —
-- créée par erreur le même jour, jamais utilisée par aucune route/UI, 0 ligne
-- au moment de sa suppression, cf. data/migration-drop-user-subject-
-- memorization-preferences.sql) : la bonne granularité est le knowledgeTarget
-- (curriculum.id, ex. "k3"), jamais le Subject entier.
--
-- Clé = (user_id, subject_type, subject_source_id, knowledge_target_id) —
-- subject_type/subject_source_id identifient le master partagé (même paire
-- que memory_items.subject_type/subject_source_id, memory_items_subject_idx),
-- knowledge_target_id est l'id stable d'UNE connaissance de son curriculum
-- (daily_quiz.curriculum[].id, ex. "k3") — jamais globalement unique seul,
-- d'où la clé composée. Décocher "Mémoriser" sur k3 n'affecte JAMAIS k1/k2/k4
-- du même master, et jamais le master partagé lui-même (daily_quiz.curriculum/
-- daily_quiz.questions ne sont jamais réécrits pour représenter ce choix).
--
-- memorization_enabled DEFAULT true : absence de ligne = mémorisation
-- active (rétrocompatibilité stricte avec toutes les connaissances
-- existantes, jamais de backfill nécessaire — cf. invariant du diagnostic).
--
-- Ne touche jamais memory_items/memory_item_fsrs_states/memory_review_events
-- (master partagé + historique FSRS intacts) : pur filtre appliqué à la
-- LECTURE (fetchCultureGeneraleReviewInjectionForToday,
-- fetchLearningLoadGaugeForUser, GET .../fiche), jamais une suppression/un
-- recalcul FSRS.
--
-- API : upsert explicite avec la valeur voulue (enabled: true/false), jamais
-- un toggle relatif — idempotent par construction face à un double clic/des
-- requêtes en désordre.
CREATE TABLE IF NOT EXISTS user_knowledge_target_memorization_preferences (
  user_id UUID NOT NULL REFERENCES users(id),
  subject_type TEXT NOT NULL,
  subject_source_id TEXT NOT NULL,
  knowledge_target_id TEXT NOT NULL,
  memorization_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, subject_type, subject_source_id, knowledge_target_id)
);

-- Filtre de sélection FSRS (fetchCultureGeneraleReviewInjectionForToday,
-- fetchLearningLoadGaugeForUser) : "donne-moi toutes les désactivations de
-- CET utilisateur" en une seule requête batch, sans filtrer par sujet à
-- l'avance (cf. leur commentaire respectif) — l'index doit donc porter sur
-- user_id seul en tête, la PK composite ci-dessus ne le couvre pas
-- efficacement seule (elle commence par user_id mais Postgres n'a besoin
-- ici que d'un select sur user_id + memorization_enabled=false, déjà bien
-- servi par la PK — index explicite ajouté par prudence, coût négligeable
-- sur une table dont la volumétrie par utilisateur reste faible).
CREATE INDEX IF NOT EXISTS user_knowledge_target_memorization_preferences_user_idx
  ON user_knowledge_target_memorization_preferences (user_id, memorization_enabled);
