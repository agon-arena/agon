-- À exécuter une fois dans le SQL editor de Supabase, après data/migration-stars.sql.
--
-- Classification ADDITIVE : un article garde toujours sa classification principale
-- (opinion_articles.category/category_precision/solar_system_id/star_id), utilisée partout
-- ailleurs sur le site (génération QCM, admin veille, etc.) et jamais modifiée par ce qui
-- suit. Cette table permet en plus de rattacher un même article à d'autres galaxies quand
-- c'est vraiment pertinent (ex. un article sur l'interdiction des réseaux sociaux aux mineurs
-- touche réellement Société-éducation, Sciences-technologie, Philosophie ET Sciences
-- sociales) — cf. classifyOpinionArticleSecondaryTagsWithAI (server.js), qui reste volontairement
-- restrictif (0 résultat dans la grande majorité des cas).
--
-- category/category_precision stockés ici comme sur opinion_articles (jamais la galaxie
-- elle-même, toujours déduite via getOpinionArticleGalaxy) : mêmes règles, même vocabulaire à
-- 16 rubriques, pour que ces tags secondaires se comportent exactement comme la classification
-- principale (mêmes galaxies, mêmes couleurs de bulles côté /mon-univers).
CREATE TABLE IF NOT EXISTS article_secondary_classifications (
  id BIGSERIAL PRIMARY KEY,
  article_id BIGINT NOT NULL REFERENCES opinion_articles(id),
  category TEXT NOT NULL,
  category_precision TEXT,
  solar_system_id BIGINT REFERENCES solar_systems(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (article_id, solar_system_id)
);

-- Marqueur "déjà vérifié" : distingue un article jamais passé par la passe secondaire d'un
-- article vérifié et pour lequel aucun tag secondaire pertinent n'a été trouvé (0 ligne dans
-- article_secondary_classifications est ambigu sans ce marqueur — jamais re-testé inutilement).
ALTER TABLE opinion_articles
  ADD COLUMN IF NOT EXISTS secondary_tags_checked_at TIMESTAMPTZ;
