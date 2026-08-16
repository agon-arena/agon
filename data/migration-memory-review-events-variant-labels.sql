-- À exécuter une fois dans le SQL editor de Supabase. Refonte du 16/08/2026
-- (jusqu'à 3 variantes par MemoryItem, cf. lib/spaced-repetition/question-variant.js) :
-- le libellé de variante loggué dans memory_review_events.question_variant
-- passe de 'base'/'alt' (2 valeurs, modèle base+altVariant) à 'v0'/'v1'/'v2'
-- (jusqu'à 3 variantes). Additive uniquement : élargit la contrainte CHECK,
-- ne touche à aucune des 606 lignes existantes (qui restent 'base'/'alt',
-- toujours valides et toujours lisibles — 'base' ≈ 'v0', 'alt' ≈ 'v1').
ALTER TABLE memory_review_events DROP CONSTRAINT IF EXISTS memory_review_events_question_variant_check;
ALTER TABLE memory_review_events ADD CONSTRAINT memory_review_events_question_variant_check
  CHECK (question_variant = ANY (ARRAY['base', 'alt', 'v0', 'v1', 'v2']::text[]));
