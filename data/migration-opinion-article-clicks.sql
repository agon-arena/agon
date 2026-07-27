-- À exécuter une fois dans le SQL editor de Supabase
CREATE TABLE IF NOT EXISTS opinion_article_clicks (
  id BIGSERIAL PRIMARY KEY,
  visitor_key TEXT NOT NULL,
  article_link TEXT NOT NULL,
  category TEXT,
  orientation_group TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opinion_article_clicks_visitor_created
  ON opinion_article_clicks (visitor_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_opinion_article_clicks_created_at
  ON opinion_article_clicks (created_at DESC);
