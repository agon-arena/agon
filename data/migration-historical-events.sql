-- À exécuter une fois dans le SQL editor de Supabase (non exécuté automatiquement).
-- Base d'événements historiques quotidiens ("Ce jour-là") : jusqu'à 4
-- événements par date_key (un par catégorie france/europe/world/culture_science).
-- Alimentée hors-ligne via data/historical-events/events.json puis
-- tools/historical-events-import.js --live (jamais lancé automatiquement).
--
-- Mise à jour (lot "cartes-jour-annee-aout-semaine-1") : ajout de
-- culture_science et de nouvelles periods, des champs narratifs
-- why_it_matters/anecdote/anecdote_reliability/tags/sources, et passage en
-- NULLable des colonnes de notation éditoriale (date_certainty,
-- historical_importance, narrative_strength, image_relevance,
-- image_rights_verified) — absentes des lots sans workflow d'image.

CREATE TABLE IF NOT EXISTS historical_events (
  id text PRIMARY KEY,
  month smallint NOT NULL,
  day smallint NOT NULL,
  date_key text NOT NULL,
  category text NOT NULL,
  year integer NOT NULL,
  year_display text NOT NULL,
  period text NOT NULL,
  title text NOT NULL,
  summary_short text NOT NULL,
  summary_long text NOT NULL,
  location text,
  historical_source_name text,
  historical_source_url text,
  secondary_source_name text,
  secondary_source_url text,
  date_certainty text,
  historical_importance smallint,
  narrative_strength smallint,
  image_relevance smallint,
  image_filename text,
  image_source_url text,
  image_original_url text,
  image_author text,
  image_date text,
  image_institution text,
  image_license text,
  image_license_url text,
  image_credit text,
  image_rights_verified boolean,
  content_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status text NOT NULL DEFAULT 'draft',
  notes text,
  -- Champs narratifs du lot "cartes-jour-annee-aout-semaine-1".
  why_it_matters text,
  anecdote text,
  anecdote_reliability text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT historical_events_category_check
    CHECK (category IN ('france', 'europe', 'world', 'culture_science')),
  CONSTRAINT historical_events_period_check
    CHECK (period IN (
      'antiquity', 'middle_ages', 'renaissance', 'early_modern',
      'french_revolution', 'revolution_empire', 'revolution_19th',
      'world_war_1', 'world_war_2', 'decolonization',
      '20th_century', '21st_century', 'contemporary'
    )),
  CONSTRAINT historical_events_review_status_check
    CHECK (review_status IN ('draft', 'reviewed', 'validated', 'rejected')),
  CONSTRAINT historical_events_date_certainty_check
    CHECK (date_certainty IS NULL OR date_certainty IN ('high', 'medium', 'low')),
  CONSTRAINT historical_events_anecdote_reliability_check
    CHECK (anecdote_reliability IS NULL OR anecdote_reliability IN ('well_attested', 'traditional', 'debated', 'uncertain')),
  CONSTRAINT historical_events_month_check CHECK (month BETWEEN 1 AND 12),
  CONSTRAINT historical_events_day_check CHECK (day BETWEEN 1 AND 31),
  -- Au maximum un événement par catégorie pour une même date_key (donc 4 max/jour).
  CONSTRAINT historical_events_date_key_category_unique UNIQUE (date_key, category)
);

-- Si la table existe déjà (créée avant ce lot), exécuter aussi ceci :
-- ALTER TABLE historical_events ADD COLUMN IF NOT EXISTS why_it_matters text;
-- ALTER TABLE historical_events ADD COLUMN IF NOT EXISTS anecdote text;
-- ALTER TABLE historical_events ADD COLUMN IF NOT EXISTS anecdote_reliability text;
-- ALTER TABLE historical_events ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;
-- ALTER TABLE historical_events ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb;
-- ALTER TABLE historical_events ALTER COLUMN date_certainty DROP NOT NULL;
-- ALTER TABLE historical_events ALTER COLUMN historical_importance DROP NOT NULL;
-- ALTER TABLE historical_events ALTER COLUMN narrative_strength DROP NOT NULL;
-- ALTER TABLE historical_events ALTER COLUMN image_relevance DROP NOT NULL;
-- ALTER TABLE historical_events ALTER COLUMN image_rights_verified DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_historical_events_date_key ON historical_events (date_key);
CREATE INDEX IF NOT EXISTS idx_historical_events_review_status ON historical_events (review_status);
