-- À exécuter une fois dans le SQL editor de Supabase
CREATE TABLE IF NOT EXISTS daily_quiz (
  id BIGSERIAL PRIMARY KEY,
  quiz_date DATE NOT NULL UNIQUE,
  questions JSONB NOT NULL,
  source_debate_ids JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_quiz_answers (
  id BIGSERIAL PRIMARY KEY,
  quiz_date DATE NOT NULL,
  voter_key TEXT NOT NULL,
  question_id TEXT NOT NULL,
  option_index INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (quiz_date, voter_key, question_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_quiz_answers_lookup ON daily_quiz_answers (quiz_date, question_id);
