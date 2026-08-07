-- À exécuter une fois dans le SQL editor de Supabase
ALTER TABLE debates
  ADD COLUMN IF NOT EXISTS source_article_ids JSONB;
