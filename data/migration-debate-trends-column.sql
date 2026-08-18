-- À exécuter une fois dans le SQL editor de Supabase.
--
-- Avant : la tendance de chaque débat vivait dans un seul blob JSON global
-- (app_config, clé "debate_trends", ~125 Ko). Chaque nouveau débat réécrivait
-- ce blob EN ENTIER (cf. setDebateTrend/writeDebateTrendsMap dans server.js)
-- — identifié comme la plus grosse charge POST REST (avg ~70 Ko/appel sur
-- app_config) lors de l'audit egress du 18/08/2026.
--
-- Après : la tendance est stockée sur la ligne du débat concerné. Une
-- création de débat ne touche plus qu'une seule ligne, colonne étroite.
ALTER TABLE debates ADD COLUMN IF NOT EXISTS trend_data jsonb;

-- Backfill depuis l'ancien blob global (idempotent : n'écrase que les lignes
-- présentes dans le blob, sans toucher aux débats qui n'y figurent pas).
UPDATE debates d
SET trend_data = t.value
FROM (
  SELECT (key)::bigint AS id, value
  FROM jsonb_each((SELECT value FROM app_config WHERE key = 'debate_trends'))
) AS t
WHERE d.id = t.id;

-- L'ancienne clé n'est plus lue par le code après ce déploiement. Laissée en
-- place (pas de DELETE) le temps de confirmer que le backfill est bon —
-- supprimable ensuite manuellement : DELETE FROM app_config WHERE key = 'debate_trends';
