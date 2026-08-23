-- À exécuter une fois dans le SQL editor de Supabase, après
-- data/migration-solar-taxonomy-scope.sql. Refonte du moteur de
-- classification (diagnostic "Atlas Mnoria" du 16/08/2026).
--
-- Modèle retenu : CATALOGUE CANONIQUE + MEMBERSHIP (option B du design),
-- pas de duplication de solar_systems par utilisateur (option A écartée) —
-- cf. rapport de design : les Stars sont déjà de facto un modèle canonique +
-- membership (une même fiche/Subject est partagée entre utilisateurs via
-- daily_quiz, user_article_acquisitions trace qui l'a acquise) ; dupliquer
-- Galaxy/Solar par utilisateur aurait introduit une incohérence avec ce
-- pattern déjà en place, en plus d'exploser le stockage si des milliers
-- d'utilisateurs partagent les mêmes grandes thématiques ("Antiquité",
-- "Économie"...).
--
-- Cette table définit "l'univers actif" d'un utilisateur : les seuls Solars
-- que le moteur de classification peut proposer comme candidats de
-- réutilisation pour CET utilisateur (cf. lib/knowledge-taxonomy/
-- taxonomy-engine.js, filterUserActiveSolars) — jamais les Solars activés
-- uniquement par d'autres utilisateurs, même dans la même Galaxy.
--
-- Une Galaxy n'a pas besoin de sa propre table de membership : "l'univers"
-- Galaxy d'un utilisateur est dérivé de ses Solars actifs (cf.
-- userActiveGalaxies) — son activation est un sous-produit automatique de la
-- première activation d'un Solar dans cette Galaxy, jamais une action
-- séparée à tracer.
CREATE TABLE IF NOT EXISTS user_solar_activations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  solar_system_id BIGINT NOT NULL REFERENCES solar_systems(id),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, solar_system_id)
);

CREATE INDEX IF NOT EXISTS user_solar_activations_user_idx ON user_solar_activations (user_id);

-- Backfill : les acquisitions déjà enregistrées AVANT ce chantier doivent
-- apparaître comme "univers actif" dès le premier appel du nouveau moteur —
-- sans ce backfill, tout utilisateur déjà actif repartirait avec un univers
-- vide et verrait le moteur (re)proposer des créations pour des Solars qu'il
-- a en réalité déjà (point 4 de la vérification finale du 16/08/2026).
--
-- Source de vérité retenue : user_article_acquisitions (seule table qui
-- trace RÉELLEMENT, par utilisateur, quel Solar a été atteint — sourcePlacement
-- dans daily_quiz est le placement au moment de la GÉNÉRATION, partagé entre
-- tous les utilisateurs qui verront cette fiche, jamais une preuve qu'un
-- utilisateur PRÉCIS l'a personnellement rencontrée).
--
-- Mesuré en lecture seule le 16/08/2026 (aucune écriture, migration non
-- appliquée) sur les 94 lignes réelles de user_article_acquisitions :
--   utilisateurs concernés          = 29
--   activations (user,solar) à créer = 83
--   doublons évités (GROUP BY)       = 10 lignes d'acquisitions redondantes
--   placements impossibles à reconstruire (solar_system_id NULL) = 1, exclu
--     par le WHERE ci-dessous, jamais inventé.
--
-- Déterministe, idempotent (ON CONFLICT DO NOTHING), sans appel IA, sans
-- reclassification, sans effet sur FSRS/MemoryItems/memory_review_events.
INSERT INTO user_solar_activations (user_id, solar_system_id, activated_at)
SELECT user_id, solar_system_id, MIN(acquired_at)
FROM user_article_acquisitions
WHERE solar_system_id IS NOT NULL
GROUP BY user_id, solar_system_id
ON CONFLICT (user_id, solar_system_id) DO NOTHING;
