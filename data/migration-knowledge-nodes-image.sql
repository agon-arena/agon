-- À exécuter une fois dans le SQL editor de Supabase, après
-- data/migration-learn-next-engine.sql.
--
-- "Apprentissages proposés" (Découvrir, GET /api/users/recommendations/learn-next)
-- n'affichait jusqu'ici jamais de vraie image (seulement l'icône de repli de
-- thématique) : ces sujets ne sont pas encore adoptés, donc pas de slot/quiz_date
-- pour aller chercher sourceDetail.image côté daily_quiz comme le fait "Mes
-- acquis" (demande du 14/09/2026, "les vignettes ne s'affichent pas").
--
-- Ajoute la même recherche d'image que la génération IA classique
-- (searchKnowledgeImage, lib/knowledge-image-search.js, déjà utilisée pour
-- sourceDetail.image d'un notion-quiz) mais appelée isolément par nom de
-- sujet, PUIS mise en cache ici — knowledge_nodes est déjà le catalogue
-- canonique global (subject_type, subject_source_id), partagé entre tous les
-- utilisateurs, jamais dupliqué par utilisateur : une image résolue une fois
-- pour un sujet sert à quiconque le voit recommandé ensuite (cf.
-- server.js GET /api/knowledge/image).
--
-- image_resolved_at (pas juste image_url NULL) : distingue "jamais essayé"
-- de "essayé, rien trouvé" — sans lui, un sujet sans image Wikipedia
-- déclencherait une nouvelle recherche réseau à CHAQUE fois qu'il est
-- recommandé à quelqu'un, au lieu d'une seule fois pour de bon (searchKnowledgeImage
-- n'a lui-même aucun cache, cf. son commentaire de tête).
ALTER TABLE knowledge_nodes
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS image_credit TEXT,
  ADD COLUMN IF NOT EXISTS image_caption TEXT,
  ADD COLUMN IF NOT EXISTS image_page_url TEXT,
  ADD COLUMN IF NOT EXISTS image_source TEXT,
  ADD COLUMN IF NOT EXISTS image_resolved_at TIMESTAMPTZ;
