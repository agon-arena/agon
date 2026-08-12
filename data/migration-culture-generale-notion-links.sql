-- À exécuter une fois dans le SQL editor de Supabase.
--
-- Liens pédagogiques entre deux connaissances de "Mes apprentissages" (ex. la fiche
-- "Voltaire" liée à la fiche "Les Lumières"), détectés par l'IA à la création d'une
-- nouvelle fiche (cf. findAndStoreCultureGeneraleNotionLink, server.js). Une notion est
-- identifiée par (type, source_id) — même identité que eclairage_type/eclairage_source_id
-- dans user_article_acquisitions, indépendante du niveau (élémentaire/avancé) ou de la
-- date de génération.
--
-- Stocké dans une table à part plutôt que dans le contenu figé de la fiche
-- (contrairement à sourceThemes) : consultée à l'affichage de CHAQUE fiche, donc le
-- lien apparaît immédiatement des DEUX côtés dès sa création, sans jamais avoir à
-- ré-écrire la fiche existante. Ordre canonique (type_a,source_id_a) < (type_b,source_id_b)
-- pour ne jamais stocker deux fois le même lien dans les deux sens.
CREATE TABLE IF NOT EXISTS culture_generale_notion_links (
  id BIGSERIAL PRIMARY KEY,
  type_a TEXT NOT NULL,
  source_id_a TEXT NOT NULL,
  name_a TEXT NOT NULL,
  type_b TEXT NOT NULL,
  source_id_b TEXT NOT NULL,
  name_b TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (type_a, source_id_a, type_b, source_id_b)
);

CREATE INDEX IF NOT EXISTS culture_generale_notion_links_a_idx ON culture_generale_notion_links (type_a, source_id_a);
CREATE INDEX IF NOT EXISTS culture_generale_notion_links_b_idx ON culture_generale_notion_links (type_b, source_id_b);
