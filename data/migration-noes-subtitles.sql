-- Sous-titres Noès synchronisés par le worker (question/réponse, au plus 10 cues).
ALTER TABLE noes_videos
  ADD COLUMN IF NOT EXISTS subtitle_cues JSONB;
