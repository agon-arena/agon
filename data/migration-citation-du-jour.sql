-- À exécuter une fois dans le SQL editor de Supabase
-- Structure jumelle des tables parallele_historique, pensee_philosophique,
-- mecanisme_sociologique et concept_du_jour (même mécanisme d'anti-concurrence :
-- verrou par insertion + contrainte UNIQUE sur `date`).
CREATE TABLE IF NOT EXISTS citation_du_jour (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'generating' CHECK (status IN ('generating', 'published', 'insufficient', 'failed')),
  model TEXT,
  current_topic_id TEXT,
  content JSONB,
  error_message TEXT,
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_citation_du_jour_status ON citation_du_jour (status);
