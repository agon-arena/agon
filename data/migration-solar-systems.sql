-- À exécuter une fois dans le SQL editor de Supabase
CREATE TABLE IF NOT EXISTS solar_systems (
  id BIGSERIAL PRIMARY KEY,
  galaxy TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (galaxy, normalized_name)
);

ALTER TABLE opinion_articles
  ADD COLUMN IF NOT EXISTS solar_system_id BIGINT
  REFERENCES solar_systems(id)
  ON DELETE SET NULL;
