-- Déjà appliqué en direct via l'API Management Supabase (SQL editor), pas
-- via ce fichier — versionné rétroactivement le 13/08/2026 pour documenter
-- le schéma réel (cf. audit mémorisation du 12/08/2026, point "drift DB").
-- Liste des questions qu'un visiteur a explicitement retirées de ses futures
-- repasses ("Ne plus me la demander", cf. POST /api/daily-quiz/exclude-question) —
-- filtre appliqué à la lecture (fetchCultureGeneraleReviewInjectionForToday,
-- getDailyQuizQuestions), aucune ligne n'est jamais supprimée d'ici par
-- runDataRetentionCleanup (pas de colonne created_at concernée par une purge).
--
-- Note (schéma réel constaté le 13/08/2026, pas modifié ici pour ne pas
-- diverger silencieusement de ce qui tourne en prod) : contrairement à
-- toutes les tables sœurs (daily_quiz_answers, user_notion_quizzes, ...),
-- Row Level Security est DÉSACTIVÉE sur cette table (relrowsecurity = false).
-- Sans impact pratique aujourd'hui (accès exclusivement via la clé service
-- role côté serveur, jamais depuis le client), mais à corriger par cohérence
-- si RLS est un jour réactivé/audité globalement.
CREATE TABLE IF NOT EXISTS user_question_exclusions (
  voter_key TEXT NOT NULL,
  question_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (voter_key, question_id)
);
