-- À exécuter une fois dans le SQL editor de Supabase
ALTER TABLE arguments
  ADD COLUMN IF NOT EXISTS auto_vote_wave1_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS auto_vote_wave1_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_vote_wave2_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS auto_vote_wave2_at timestamptz;

-- Les idées déjà existantes ne doivent pas recevoir de votes rétroactifs
UPDATE arguments
SET auto_vote_wave1_status = 'done', auto_vote_wave2_status = 'done'
WHERE auto_vote_wave1_at IS NULL;
