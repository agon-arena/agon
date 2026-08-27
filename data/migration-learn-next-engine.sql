-- À exécuter une fois dans le SQL editor de Supabase.
--
-- Moteur "À apprendre ensuite" (mission du 26/08/2026) : détermine, pour
-- chaque utilisateur, quelle connaissance non encore acquise serait la plus
-- pertinente à apprendre maintenant (ZPD, ponts entre branches déjà connues,
-- intérêt réel, découverte contrôlée). Calcul entièrement local (SQL/Node),
-- AUCUN appel IA sur le chemin d'une recommandation individuelle.
--
-- Une connaissance est déjà identifiée dans tout le projet par le couple
-- (type, source_id) — cf. memory_items.subject_type/subject_source_id,
-- user_article_acquisitions.eclairage_type/eclairage_source_id,
-- culture_generale_notion_links.type_a/source_id_a (et _b). Il n'existe pas
-- de table catalogue centrale : ce fichier en ajoute une SEULE, mutualisée,
-- qui sert de cache d'enrichissement global (jamais recalculée par
-- utilisateur) — pas de duplication de l'existant.
--
-- knowledge_nodes EST UNE MATÉRIALISATION, PAS UNE SOURCE DE VÉRITÉ (revue
-- du 27/08/2026) : l'identité canonique reste (subject_type,
-- subject_source_id), jamais un id propre à cette table. Toutes ses colonnes
-- sont reconstructibles depuis les catalogues canoniques existants
-- (user_article_acquisitions, culture_generale_notion_links) — les deux
-- INSERT ... ON CONFLICT ci-dessous forment un backfill idempotent,
-- ré-exécutable à tout moment (recalcule/répare sans aucun appel IA) si
-- cette table venait à être vidée ou désynchronisée.
--
-- AVERTISSEMENT DE MODÉLISATION : culture_generale_notion_links relie des
-- connaissances par une relation FACTUELLE détectée par IA, jamais typée
-- "prerequisite" (cf. son commentaire de création). link_degree n'est donc
-- PAS un nombre de prérequis pédagogiques — seulement un degré de connexion
-- dans un graphe de proximité conceptuelle, utilisé comme approximation de
-- ZPD (cf. lib/learn-next/scoring.js pour le détail et l'avertissement
-- complet côté application).

-- knowledge_nodes : catalogue global léger d'une connaissance déjà rencontrée
-- par au moins un visiteur (acquisition) ou déjà reliée par l'IA à une autre
-- connaissance (culture_generale_notion_links). Alimenté en incrémental,
-- best-effort, aux points d'écriture déjà existants (jamais de scan complet
-- ni de job planifié) :
--   - après user_article_acquisitions (upsert + incrémente acquisition_count)
--   - après culture_generale_notion_links (upsert + incrémente link_degree
--     pour les DEUX extrémités)
-- importance_score est une formule déterministe de link_degree et
-- acquisition_count (cf. lib/learn-next/scoring.js computeImportanceScore) —
-- aucun appel IA. Un futur enrichissement IA volontaire pourrait un jour
-- écraser importance_score/importance_tier pour une connaissance précise
-- sans changer le schéma.
CREATE TABLE IF NOT EXISTS knowledge_nodes (
  subject_type TEXT NOT NULL,
  subject_source_id TEXT NOT NULL,
  display_name TEXT,
  solar_system_id BIGINT REFERENCES solar_systems(id),
  star_id BIGINT REFERENCES stars(id),
  link_degree INT NOT NULL DEFAULT 0,
  acquisition_count INT NOT NULL DEFAULT 0,
  importance_score NUMERIC NOT NULL DEFAULT 0,
  importance_tier TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_type, subject_source_id)
);

CREATE INDEX IF NOT EXISTS knowledge_nodes_solar_system_idx ON knowledge_nodes (solar_system_id);
CREATE INDEX IF NOT EXISTS knowledge_nodes_importance_idx ON knowledge_nodes (importance_score DESC);

-- Confidentialité (section 19 du plan initial, découvert en vérification live
-- du 27/08/2026) : SEULS les types déjà traités comme "partageables" ailleurs
-- dans Mnoria peuvent être recommandés à un autre utilisateur. Preuve : le
-- seul mécanisme de partage inter-utilisateurs déjà existant (GET
-- /api/users/notion-quizzes/explore, server.js) ne partage QUE les sujets
-- "notion:custom:%" — jamais les imports personnels (photo/PDF/texte/lien/
-- YouTube, potentiellement le contenu privé d'un visiteur précis) ni les
-- quiz "comprendre" (dérivés d'une paire de connaissances déjà acquises par
-- UN utilisateur précis, jamais une connaissance autonome). Cette liste
-- reprend exactement le même périmètre — même liste que
-- lib/learn-next/config.js SHAREABLE_KNOWLEDGE_TYPES, à ne jamais faire
-- diverger. N'affecte QUE la matérialisation dans knowledge_nodes : les
-- imports/"comprendre" restent des acquis normaux dans
-- user_article_acquisitions, seulement jamais proposés comme candidats.
-- CLEANUP ponctuel : la toute première exécution de ce fichier (avant cette
-- révision) a pu matérialiser de tels types — ce DELETE est idempotent (no-op
-- si déjà propre) et purge tout résidu.
--
-- "debat-notion" ajouté le 27/08/2026 (validation en conditions réelles) :
-- oublié dans l'audit initial, c'est pourtant un type public au même titre
-- que "histoire" (notion extraite d'une arène de débat publique, cf.
-- extractDebateTopicNotions et NOTION_QUIZ_SOURCE_TYPES dans server.js, qui
-- le traite déjà identiquement). Aucune donnée privée concernée — un débat
-- Mnoria est un contenu public par nature.
DELETE FROM knowledge_nodes
WHERE subject_type NOT IN ('histoire','parallele','pensee','mecanisme','concept','citation','oeuvre','latin','debat-notion','custom');

-- Backfill déterministe depuis les données déjà en base (même logique que le
-- backfill de user_solar_activations dans migration-user-solar-activations.sql) :
-- sans lui, tout l'historique acquis avant cette migration resterait invisible
-- du moteur (aucune valeur de link_degree/acquisition_count) tant que la
-- connaissance concernée n'est pas retouchée. Idempotent (ON CONFLICT DO
-- UPDATE avec les valeurs recalculées), sans appel IA, sans effet sur
-- FSRS/MemoryItems.
INSERT INTO knowledge_nodes (subject_type, subject_source_id, display_name, solar_system_id, star_id, acquisition_count, updated_at)
SELECT
  eclairage_type,
  eclairage_source_id,
  (array_agg(eclairage_name ORDER BY acquired_at DESC))[1],
  (array_agg(solar_system_id ORDER BY acquired_at DESC))[1],
  (array_agg(star_id ORDER BY acquired_at DESC))[1],
  COUNT(*),
  now()
FROM user_article_acquisitions
WHERE eclairage_type IN ('histoire','parallele','pensee','mecanisme','concept','citation','oeuvre','latin','debat-notion','custom')
  AND eclairage_source_id IS NOT NULL
GROUP BY eclairage_type, eclairage_source_id
ON CONFLICT (subject_type, subject_source_id) DO UPDATE SET
  display_name = COALESCE(knowledge_nodes.display_name, EXCLUDED.display_name),
  solar_system_id = COALESCE(knowledge_nodes.solar_system_id, EXCLUDED.solar_system_id),
  star_id = COALESCE(knowledge_nodes.star_id, EXCLUDED.star_id),
  acquisition_count = EXCLUDED.acquisition_count,
  updated_at = now();

-- Deuxième passe : degré de connexion depuis le graphe global existant. Une
-- connaissance côté A ou côté B d'un lien peut ne jamais avoir été acquise
-- directement par personne dans user_article_acquisitions sous ce type précis
-- (cas rare) — INSERT ... ON CONFLICT couvre aussi cette création. Même
-- filtre de confidentialité que ci-dessus, appliqué à chaque côté du lien.
WITH degrees AS (
  SELECT type_a AS subject_type, source_id_a AS subject_source_id, name_a AS display_name, COUNT(*) AS degree
  FROM culture_generale_notion_links
  WHERE type_a IN ('histoire','parallele','pensee','mecanisme','concept','citation','oeuvre','latin','debat-notion','custom')
  GROUP BY type_a, source_id_a, name_a
  UNION ALL
  SELECT type_b, source_id_b, name_b, COUNT(*)
  FROM culture_generale_notion_links
  WHERE type_b IN ('histoire','parallele','pensee','mecanisme','concept','citation','oeuvre','latin','debat-notion','custom')
  GROUP BY type_b, source_id_b, name_b
),
merged AS (
  SELECT subject_type, subject_source_id, (array_agg(display_name))[1] AS display_name, SUM(degree) AS link_degree
  FROM degrees GROUP BY subject_type, subject_source_id
)
INSERT INTO knowledge_nodes (subject_type, subject_source_id, display_name, link_degree, updated_at)
SELECT subject_type, subject_source_id, display_name, link_degree, now()
FROM merged
ON CONFLICT (subject_type, subject_source_id) DO UPDATE SET
  display_name = COALESCE(knowledge_nodes.display_name, EXCLUDED.display_name),
  link_degree = EXCLUDED.link_degree,
  updated_at = now();

-- Importance déterministe (cf. lib/learn-next/scoring.js computeImportanceScore,
-- même formule ici — recalculée uniquement pour que le backfill parte avec
-- des valeurs cohérentes dès l'écriture, jamais un correctif à part) :
-- 0.5 * log1p(link_degree)/log1p(5) + 0.5 * log1p(acquisition_count)/log1p(20),
-- plafonné à 1. log1p (LN(1+x), Postgres n'a pas de log1p natif mais est
-- numériquement équivalent à cette échelle) plutôt qu'un simple ratio
-- linéaire plafonné (revue du 27/08/2026, section 4) : une connaissance avec
-- des dizaines de milliers d'acquisitions ne doit pas écraser mécaniquement
-- une connaissance structurante n'en ayant que quelques centaines — les deux
-- convergent vers 1 sans qu'un pur effet de volume ne les distingue au-delà
-- d'un certain point.
UPDATE knowledge_nodes SET
  importance_score = ROUND(
    LEAST(1, (
      0.5 * (LN(1 + link_degree::numeric) / LN(1 + 5))
      + 0.5 * (LN(1 + acquisition_count::numeric) / LN(1 + 20))
    ))::numeric,
    4
  ),
  importance_tier = CASE
    WHEN LEAST(1, (0.5 * (LN(1 + link_degree::numeric) / LN(1 + 5)) + 0.5 * (LN(1 + acquisition_count::numeric) / LN(1 + 20)))) >= 0.66 THEN 'fondamental'
    WHEN LEAST(1, (0.5 * (LN(1 + link_degree::numeric) / LN(1 + 5)) + 0.5 * (LN(1 + acquisition_count::numeric) / LN(1 + 20)))) >= 0.33 THEN 'structurant'
    ELSE 'secondaire'
  END;

-- recommendation_events : tracking minimal (section 17 du plan) pour une
-- amélioration future des coefficients — jamais de ML en V1, uniquement de
-- la donnée brute conservée pour une analyse ultérieure hors-ligne.
-- "eventually_mastered" se déduit plus tard par jointure avec
-- user_article_acquisitions (subject_type/subject_source_id), jamais dupliqué
-- ici.
-- solar_system_id est dupliqué ici (déjà présent sur knowledge_nodes) pour que
-- la pénalité de saturation thématique (lib/learn-next/scoring.js
-- computeSaturationPenalty) lise directement les derniers événements de CET
-- utilisateur sans jointure supplémentaire — même logique que
-- user_article_acquisitions.solar_system_id, une photographie au moment de
-- l'événement plutôt qu'un état courant.
CREATE TABLE IF NOT EXISTS recommendation_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  subject_type TEXT NOT NULL,
  subject_source_id TEXT NOT NULL,
  solar_system_id BIGINT REFERENCES solar_systems(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('shown', 'opened', 'added', 'dismissed')),
  recommendation_type TEXT,
  score NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recommendation_events_user_created_idx ON recommendation_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recommendation_events_subject_idx ON recommendation_events (subject_type, subject_source_id, event_type);
