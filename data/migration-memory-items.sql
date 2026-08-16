-- À exécuter une fois dans le SQL editor de Supabase (ou API Management,
-- cf. process habituel de ce repo). Première brique de la refonte FSRS de
-- la mémorisation (cf. lib/spaced-repetition/memory-model.js pour le
-- vocabulaire Subject/MemoryItem/QuestionVariant, et
-- lib/spaced-repetition/scheduler-version.js pour le choix de modèle FSRS).
--
-- memory_items donne une identité stable et opaque (UUID) à chaque
-- MemoryItem, indépendante des ids de question positionnels actuels
-- (notion:...-q3, morning-q1, ...) qui ne survivent pas à une régénération.
-- Table intentionnellement mince : le CONTENU de la question (texte,
-- options, altVariant) reste uniquement dans daily_quiz.questions (jsonb),
-- jamais dupliqué ici — cette table ne fait que porter l'identité et le
-- rattachement à un Subject, cf. memory_item_fsrs_states pour l'état FSRS et
-- memory_review_events pour l'historique des reviews.
--
-- natural_key = `${slot}::${quizDate}::${questionId}` (cf.
-- buildMemoryItemNaturalKey) : unique par construction, permet un upsert
-- idempotent à chaque lecture/génération sans jamais fusionner deux
-- MemoryItems distincts par ressemblance de contenu (interdit par design,
-- cf. l'invariant "pas de fusion automatique").
--
-- subject_type/subject_source_id = (question.sourceType, question.sourceDebateId)
-- tel que porté par CHAQUE question générée aujourd'hui, quel que soit le
-- pipeline (buildNotionQuestions, buildCustomTopicQuiz,
-- buildEnumerableCustomTopicQuiz) — c'est la clé d'agrégation par Subject
-- (cf. tâche #13, jamais utilisée comme scheduler), volontairement séparée
-- de slot/quiz_date/question_id qui ne servent qu'à l'identité du
-- MemoryItem lui-même.
--
-- Note connue (héritée du système actuel, pas introduite par cette
-- migration) : pour le QCM quotidien tournant (slot "morning"/"evening"),
-- la ligne daily_quiz sous-jacente est purgée après DAILY_QUIZ_RETENTION_DAYS
-- (30j, cf. lib/data-retention.js) — un memory_item plus vieux peut donc
-- durablement exister (jamais purgé lui-même) sans que son contenu texte
-- reste lisible. Comportement identique à l'actuel fetchUserCultureGeneraleAnswerEvents
-- ("contenu hors fenêtre de rétention : ignoré"), pas une régression.
CREATE TABLE IF NOT EXISTS memory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  natural_key TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_source_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  quiz_date DATE NOT NULL,
  question_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (natural_key)
);

CREATE INDEX IF NOT EXISTS memory_items_subject_idx ON memory_items (subject_type, subject_source_id);
CREATE INDEX IF NOT EXISTS memory_items_slot_quiz_date_idx ON memory_items (slot, quiz_date);
