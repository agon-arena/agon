-- À exécuter une fois dans le SQL editor de Supabase.
-- Liste personnelle des QCM de notion qu'un visiteur a choisi de créer en
-- cliquant "Mémoriser" (cf. POST/GET/DELETE /api/users/notion-quizzes) — fait
-- uniquement le lien visiteur <-> QCM, jamais le contenu généré lui-même
-- (partagé entre tous les visiteurs, stocké dans daily_quiz sous le slot
-- "notion:{sourceType}:{sourceId}", cf. buildNotionQuestions). Décocher
-- "Mémoriser" retire seulement la ligne ici, jamais la ligne daily_quiz
-- partagée (cf. exclusion dédiée dans runDataRetentionCleanup).
CREATE TABLE IF NOT EXISTS user_notion_quizzes (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  quiz_date DATE NOT NULL,
  slot TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, quiz_date, slot)
);

CREATE INDEX IF NOT EXISTS user_notion_quizzes_user_id_idx ON user_notion_quizzes (user_id);
