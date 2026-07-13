-- À exécuter une fois dans le SQL editor de Supabase
ALTER TABLE opinion_articles
  ADD COLUMN IF NOT EXISTS category TEXT;

CREATE INDEX IF NOT EXISTS idx_opinion_articles_category_published_at
  ON opinion_articles (category, published_at DESC);
