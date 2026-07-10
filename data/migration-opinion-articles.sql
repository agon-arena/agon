-- À exécuter une fois dans le SQL editor de Supabase
CREATE TABLE IF NOT EXISTS opinion_articles (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  orientation TEXT,
  title TEXT NOT NULL,
  link TEXT NOT NULL UNIQUE,
  summary TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opinion_articles_published_at ON opinion_articles (published_at DESC);
