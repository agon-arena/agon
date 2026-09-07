-- À exécuter une fois dans le SQL editor de Supabase.
-- Chantier "rétablir un vrai choix utilisateur entre Élémentaire, Approfondi
-- et Expert" (07/09/2026) : user_notion_quizzes.requested_level joue déjà le
-- rôle de currentLevel (niveau RÉELLEMENT atteint et servi à cet
-- utilisateur, cf. server.js resolveUserProgressiveLevel) — conservé tel
-- quel, aucune migration sur cette colonne. Il manquait un champ distinct
-- pour targetLevel (le plafond personnel choisi dans le picker), jusqu'ici
-- jeté par POST /api/users/notion-quizzes/custom/progressive.
--
-- NULL pour toute ligne existante (créée avant cette colonne) : le code
-- serveur interprète NULL comme "expert" (aucun plafond) — ces parcours
-- n'ont historiquement jamais eu de plafond, leur en imposer un a posteriori
-- rétrograderait à tort un utilisateur déjà avancé. Pas de backfill massif :
-- inutile, ce repli applicatif suffit (cf. resolveUserProgressiveLevel,
-- resolveTargetLevelOnRequest dans server.js).
ALTER TABLE user_notion_quizzes
  ADD COLUMN IF NOT EXISTS target_level TEXT
  CHECK (target_level IN ('elementaire', 'avance', 'expert'));
