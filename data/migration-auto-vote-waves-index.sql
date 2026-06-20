-- À exécuter une fois dans le SQL editor de Supabase.
--
-- Les schedulers d'attribution automatique de voix (server.js) interrogent
-- arguments.auto_vote_wave1_status / auto_vote_wave2_status toutes les 30s et
-- 15 min, 24h/24, indépendamment du trafic visiteurs. Sans index, chaque
-- vérification fait un balayage complet de la table arguments — probable
-- cause principale de l'épuisement du budget Disk IO Supabase constaté le
-- 20/06/2026, même avec très peu de visiteurs.
--
-- Index partiels : seules les lignes encore "pending" nous intéressent, et
-- leur nombre reste petit et borné même quand la table grossit (la plupart
-- des lignes passent à "done" après quelques heures).
CREATE INDEX IF NOT EXISTS idx_arguments_auto_vote_wave1_pending
  ON arguments (auto_vote_wave1_at)
  WHERE auto_vote_wave1_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_arguments_auto_vote_wave2_pending
  ON arguments (auto_vote_wave2_at)
  WHERE auto_vote_wave2_status = 'pending';
