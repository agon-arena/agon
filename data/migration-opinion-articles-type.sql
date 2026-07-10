-- À exécuter une fois dans le SQL editor de Supabase
ALTER TABLE opinion_articles
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'article';
