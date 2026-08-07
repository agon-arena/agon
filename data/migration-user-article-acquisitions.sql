-- À exécuter une fois dans le SQL editor de Supabase
-- Note : users.id est de type UUID en base réelle (vérifié empiriquement, aucune
-- migration n'existe pour cette table dans data/) — user_id est donc UUID, pas BIGINT.
-- opinion_articles.id et solar_systems.id restent BIGINT (BIGSERIAL), cohérent avec
-- data/migration-opinion-articles.sql et data/migration-solar-systems.sql.
CREATE TABLE IF NOT EXISTS user_article_acquisitions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  article_id BIGINT NOT NULL REFERENCES opinion_articles(id),
  solar_system_id BIGINT REFERENCES solar_systems(id),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, article_id)
);
