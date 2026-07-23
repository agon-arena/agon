-- À exécuter une fois dans le SQL editor de Supabase (non exécuté automatiquement).
-- Base d'événements historiques quotidiens ("Ce jour-là") : jusqu'à 3
-- événements par date_key (un par catégorie france/europe/world).
-- Alimentée hors-ligne via data/historical-events/events.json puis
-- tools/historical-events-import.js --live (jamais lancé automatiquement).

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
  date_certainty text NOT NULL,
  historical_importance smallint NOT NULL,
  narrative_strength smallint NOT NULL,
  image_relevance smallint NOT NULL,
  image_filename text,
  image_source_url text,
  image_original_url text,
  image_author text,
  image_date text,
  image_institution text,
  image_license text,
  image_license_url text,
  image_credit text,
  image_rights_verified boolean NOT NULL DEFAULT false,
  content_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status text NOT NULL DEFAULT 'draft',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT historical_events_category_check
    CHECK (category IN ('france', 'europe', 'world')),
  CONSTRAINT historical_events_period_check
    CHECK (period IN ('antiquity', 'middle_ages', 'early_modern', 'revolution_19th', '20th_century', '21st_century')),
  CONSTRAINT historical_events_review_status_check
    CHECK (review_status IN ('draft', 'reviewed', 'validated', 'rejected')),
  CONSTRAINT historical_events_date_certainty_check
    CHECK (date_certainty IN ('high', 'medium', 'low')),
  CONSTRAINT historical_events_month_check CHECK (month BETWEEN 1 AND 12),
  CONSTRAINT historical_events_day_check CHECK (day BETWEEN 1 AND 31),
  -- Au maximum un événement par catégorie pour une même date_key (donc 3 max/jour).
  CONSTRAINT historical_events_date_key_category_unique UNIQUE (date_key, category)
);

CREATE INDEX IF NOT EXISTS idx_historical_events_date_key ON historical_events (date_key);
CREATE INDEX IF NOT EXISTS idx_historical_events_review_status ON historical_events (review_status);
