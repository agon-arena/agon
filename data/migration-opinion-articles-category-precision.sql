-- À exécuter une fois dans le SQL editor de Supabase
ALTER TABLE opinion_articles
  ADD COLUMN IF NOT EXISTS category_precision TEXT;
