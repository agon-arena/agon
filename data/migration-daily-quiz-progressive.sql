-- À exécuter une fois dans le SQL editor de Supabase.
-- Génération progressive du pipeline QCM — Phase 1 (02/09/2026, cf. rapport
-- d'architecture du même jour). Additive et rétrocompatible : les deux
-- colonnes sont NULL par défaut, donc invisibles pour tout quiz existant ou
-- toute génération legacy — aucune ligne existante n'est modifiée par cette
-- migration, aucun comportement legacy ne change.
--
-- curriculum : le plan pédagogique complet des 20 connaissances (cf.
-- lib/notion-quiz-curriculum.js), persisté explicitement plutôt que caché
-- dans sourceDetail ou reconstruit depuis les questions — permet à une
-- future Phase 2 de reprendre les blocs "deepening"/"expert" sans jamais
-- redemander à l'IA quelles connaissances choisir.
--
-- progressive_status : NULL pour tout quiz legacy (comportement historique
-- inchangé, jamais interprété comme "en cours" ni "échoué" par le code
-- existant) ; 'elementary_ready' | 'deepening_ready' | 'ready' pour un quiz
-- progressif. Un seul champ texte plutôt qu'une machine à états séparée —
-- cf. rapport, section "architecture minimale recommandée".
ALTER TABLE daily_quiz ADD COLUMN IF NOT EXISTS curriculum JSONB;
ALTER TABLE daily_quiz ADD COLUMN IF NOT EXISTS progressive_status TEXT;
