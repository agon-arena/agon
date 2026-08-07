-- À exécuter une fois dans le SQL editor de Supabase, après
-- data/migration-user-article-acquisitions.sql.
-- Étend user_article_acquisitions (jusqu'ici uniquement des articles d'actualité) aux
-- contenus Éclairages de "Mes acquis" (Culture Générale : parallèle historique, pensée
-- philosophique, mécanisme sociologique, concept du jour, citation du jour, œuvre d'art
-- du jour, latin du jour, événement historique) — mêmes règles d'acquisition qu'un
-- article : une seule bonne réponse suffit (jamais le seuil de validation à 4 réponses
-- de "Mes acquis", qui reste propre à cette fonctionnalité existante et inchangée).
--
-- eclairage_type/eclairage_source_id remplacent article_id pour ces lignes (ni l'un ni
-- l'autre n'existe dans opinion_articles) ; eclairage_name/eclairage_detail sont une
-- photographie au moment de l'acquisition (même logique que solar_system_id déjà
-- présent), nécessaire pour l'affichage car ces contenus n'ont pas de table dédiée
-- relisible simplement à la demande.
ALTER TABLE user_article_acquisitions
  ALTER COLUMN article_id DROP NOT NULL;

ALTER TABLE user_article_acquisitions
  ADD COLUMN IF NOT EXISTS eclairage_type TEXT,
  ADD COLUMN IF NOT EXISTS eclairage_source_id TEXT,
  ADD COLUMN IF NOT EXISTS eclairage_name TEXT,
  ADD COLUMN IF NOT EXISTS eclairage_detail TEXT;

-- Exactement une des deux origines par ligne, jamais les deux ni aucune.
ALTER TABLE user_article_acquisitions
  ADD CONSTRAINT user_article_acquisitions_source_xor CHECK (
    (article_id IS NOT NULL AND eclairage_type IS NULL AND eclairage_source_id IS NULL)
    OR (article_id IS NULL AND eclairage_type IS NOT NULL AND eclairage_source_id IS NOT NULL)
  );

-- NULL n'est jamais égal à NULL pour une contrainte UNIQUE Postgres : les lignes
-- "article" (eclairage_type/eclairage_source_id NULL) ne sont donc jamais concernées par
-- cette contrainte, qui ne joue que pour les lignes "éclairage".
ALTER TABLE user_article_acquisitions
  ADD CONSTRAINT user_article_acquisitions_user_eclairage_uniq UNIQUE (user_id, eclairage_type, eclairage_source_id);
