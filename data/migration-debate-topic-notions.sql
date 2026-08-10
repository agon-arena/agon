-- À exécuter une fois dans le SQL editor de Supabase.
-- "Notions à retenir" en fin d'arène : liste de mots-clés/notions extraits
-- par IA du sujet du débat (cf. GET /api/debates/:id/notions,
-- extractDebateTopicNotions dans server.js), générée une seule fois par
-- débat et mise en cache ici plutôt que recalculée à chaque visite. Cliquer
-- "Mémoriser" sur une notion crée un QCM dédié via l'infrastructure
-- existante (POST /api/users/notion-quizzes, sourceType "debat-notion"),
-- sans lien direct avec ces colonnes.
ALTER TABLE debates ADD COLUMN IF NOT EXISTS topic_notions JSONB;
ALTER TABLE debates ADD COLUMN IF NOT EXISTS topic_notions_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE debates ADD COLUMN IF NOT EXISTS topic_notions_generated_at TIMESTAMPTZ;
