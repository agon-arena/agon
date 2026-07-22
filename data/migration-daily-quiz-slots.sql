-- À exécuter une fois dans le SQL editor de Supabase.
-- Passe de 1 QCM/jour à 2 (QCM du matin + QCM du soir) : ajoute une colonne
-- "slot" et remplace la contrainte unique sur quiz_date par (quiz_date, slot).
-- daily_quiz_answers n'a pas besoin de migration : les question_id générés
-- sont désormais préfixés par slot ("morning-q1", "evening-q1", ...), donc
-- déjà uniques sans changement de schéma sur cette table.

ALTER TABLE daily_quiz ADD COLUMN IF NOT EXISTS slot TEXT NOT NULL DEFAULT 'evening';

DO $$
DECLARE
  c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'daily_quiz'::regclass
    AND contype = 'u'
    AND conkey = (
      SELECT array_agg(attnum)
      FROM pg_attribute
      WHERE attrelid = 'daily_quiz'::regclass AND attname = 'quiz_date'
    );
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE daily_quiz DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE daily_quiz ADD CONSTRAINT daily_quiz_date_slot_unique UNIQUE (quiz_date, slot);
