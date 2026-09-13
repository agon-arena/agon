-- À exécuter une fois dans le SQL editor de Supabase (13/09/2026, chantier
-- "Connaissances mémorisées ce jour", "on doit distinguer les connaissances
-- volontairement mémorisées des connaissances préconisées à mémoriser").
--
-- user_knowledge_target_memorization_preferences (cf. data/migration-user-
-- knowledge-target-memorization-preferences.sql) ne portait jusqu'ici que
-- memorization_enabled : impossible de savoir APRÈS COUP si une ligne
-- enabled=true venait d'un vrai clic "Mémoriser" (POST
-- /api/users/knowledge-memorization) ou d'une préconisation automatique
-- appliquée sans action explicite (applyMemorizationSuggestionsForQuiz, fin
-- de bloc Élémentaire/Avancé/Expert, cf. son commentaire du 12/09/2026).
--
-- DEFAULT 'manual' : toute ligne déjà existante avant cette migration a
-- forcément été posée par un vrai clic (applyMemorizationSuggestionsForQuiz
-- n'existait pas encore avant le 12/09/2026, et n'écrase de toute façon
-- jamais une ligne déjà présente) — jamais de backfill incorrect.
ALTER TABLE user_knowledge_target_memorization_preferences
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

-- Contrainte défensive : seules ces deux valeurs ont un sens ici. Pas
-- d'index dédié (la table reste filtrée par user_id d'abord, cf. l'index
-- existant ; le volume par utilisateur ne justifie pas d'index sur source
-- seul).
ALTER TABLE user_knowledge_target_memorization_preferences
  DROP CONSTRAINT IF EXISTS user_knowledge_target_memorization_preferences_source_check;
ALTER TABLE user_knowledge_target_memorization_preferences
  ADD CONSTRAINT user_knowledge_target_memorization_preferences_source_check
  CHECK (source IN ('manual', 'suggested'));
