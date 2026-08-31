-- À exécuter une fois dans le SQL editor de Supabase, APRÈS
-- data/migration-qcm-grounding-metrics.sql (V3.1, déjà appliquée).
-- Additive et sûre : uniquement des ALTER TABLE ... ADD COLUMN IF NOT EXISTS,
-- aucune colonne existante modifiée ou supprimée, valeurs par défaut neutres
-- (false/0/NULL) pour toutes les lignes déjà en base.
--
-- V3.2, 31/08/2026 — "fallback d'enrichissement des sources lorsque le
-- grounding est insuffisant". Une seule ligne qcm_grounding_metrics par
-- génération continue de couvrir tout le cycle de vie, fallback documentaire
-- inclus (jamais une seconde table) : source_expansion_triggered=false pour
-- toute génération où le corpus initial suffisait déjà (immense majorité des
-- cas, cf. lib/grounding-source-expansion.js EXPANSION_COVERAGE_THRESHOLD).
--
-- "source_expansion_triggered=true" signifie seulement "une recherche
-- documentaire complémentaire a été tentée", jamais "elle a réussi à sauver
-- des questions" — cf. questions_accepted_after_expansion pour ça (peut
-- rester à 0 : aucune source suffisamment solide n'a été trouvée, ce qui est
-- le comportement de sécurité voulu, jamais un échec du fallback lui-même).
ALTER TABLE qcm_grounding_metrics
  ADD COLUMN IF NOT EXISTS source_expansion_triggered BOOLEAN NOT NULL DEFAULT false,
  -- Motif de la décision (cf. lib/grounding-source-expansion.js
  -- shouldExpandGroundingSources) : "grounding_disabled" | "no_target" |
  -- "coverage_sufficient" | "no_documentary_signal" | "non_documentary_dominant"
  -- | "insufficient_documentary_coverage" | "no_missing_knowledge" —
  -- toujours renseigné dès que le grounding V3.1 était actif, même quand
  -- aucune expansion n'a été déclenchée (utile pour distinguer "pas besoin"
  -- de "aurait pu aider mais désactivé pour une autre raison").
  ADD COLUMN IF NOT EXISTS source_expansion_reason TEXT,
  ADD COLUMN IF NOT EXISTS source_count_initial INTEGER,
  ADD COLUMN IF NOT EXISTS source_count_added INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_count_final INTEGER,
  -- Nombre d'appels Brave supplémentaires pour CETTE génération (0 ou 1 —
  -- section 15 de la demande, "maximum 1 enrichissement documentaire
  -- supplémentaire par génération QCM").
  ADD COLUMN IF NOT EXISTS source_expansion_brave_calls INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS questions_before_expansion INTEGER,
  ADD COLUMN IF NOT EXISTS questions_generated_after_expansion INTEGER,
  ADD COLUMN IF NOT EXISTS questions_accepted_after_expansion INTEGER;

CREATE INDEX IF NOT EXISTS idx_qcm_grounding_metrics_expansion_triggered
  ON qcm_grounding_metrics (source_expansion_triggered, created_at DESC)
  WHERE source_expansion_triggered = true;

-- Exemples de requêtes d'agrégation (section 20 de la demande, "mesurer le
-- bénéfice réel") :
--
-- Fréquence du fallback :
--   SELECT COUNT(*) FILTER (WHERE source_expansion_triggered)::float / NULLIF(COUNT(*), 0)
--   FROM qcm_grounding_metrics WHERE grounding_enabled;
--
-- Questions sauvées grâce à l'expansion (gain net) :
--   SELECT SUM(questions_accepted_after_expansion) AS questions_sauvees,
--          SUM(source_expansion_brave_calls) AS appels_brave_supplementaires
--   FROM qcm_grounding_metrics WHERE source_expansion_triggered;
--
-- Taux de succès du fallback une fois déclenché (a-t-il vraiment trouvé de
-- meilleures sources ?) :
--   SELECT COUNT(*) FILTER (WHERE questions_accepted_after_expansion > 0)::float
--          / NULLIF(COUNT(*), 0) AS taux_succes
--   FROM qcm_grounding_metrics WHERE source_expansion_triggered;
--
-- Répartition des motifs de déclenchement/non-déclenchement :
--   SELECT source_expansion_reason, COUNT(*)
--   FROM qcm_grounding_metrics WHERE grounding_enabled
--   GROUP BY source_expansion_reason ORDER BY COUNT(*) DESC;
