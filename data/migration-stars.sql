-- À exécuter une fois dans le SQL editor de Supabase, après
-- data/migration-solar-systems.sql et data/migration-user-article-acquisitions.sql.
--
-- Ajoute un niveau de classification sous le système solaire : une "étoile" est un tag
-- précis (un événement, une occasion — ex. "Tour de France 2026") capable de regrouper
-- plusieurs articles, contrairement au système solaire ("Vélo") qui reste un thème durable
-- bien plus large. Même mécanique de déduplication que solar_systems (UNIQUE sur le nom
-- normalisé, mais scopée au système solaire plutôt qu'à la galaxie).
CREATE TABLE IF NOT EXISTS stars (
  id BIGSERIAL PRIMARY KEY,
  solar_system_id BIGINT NOT NULL REFERENCES solar_systems(id),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (solar_system_id, normalized_name)
);

-- État courant de l'article, comme opinion_articles.solar_system_id : renseigné par une passe
-- IA séparée (completeMissingStarsWithAI, cf. server.js), jamais par la classification
-- catégorie/système elle-même.
ALTER TABLE opinion_articles
  ADD COLUMN IF NOT EXISTS star_id BIGINT REFERENCES stars(id);

-- Photographie au moment de l'acquisition, même logique que user_article_acquisitions.solar_system_id
-- déjà présent : peut être NULL si l'article n'était pas encore classé en étoile à ce moment-là,
-- l'état courant (opinion_articles.star_id) prime toujours à la lecture.
ALTER TABLE user_article_acquisitions
  ADD COLUMN IF NOT EXISTS star_id BIGINT REFERENCES stars(id);
