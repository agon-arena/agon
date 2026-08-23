-- À exécuter une fois dans le SQL editor de Supabase. Refonte du moteur de
-- classification Galaxy/Solar/Star (diagnostic "Atlas Mnoria" du 16/08/2026).
--
-- Additive uniquement : deux colonnes nullable/à défaut prudent sur une table
-- existante, aucune donnée retirée, aucun état FSRS/MemoryItem concerné.
--
-- `description` : résumé court de ce que couvre le Solar, écrit par l'IA au
-- moment de sa création (ou par le backfill ci-dessous pour les solars déjà
-- utilisés par le QCM) — permet au moteur de classification de comparer un
-- nouveau Subject à ce que chaque Solar existant représente RÉELLEMENT,
-- pas seulement à son libellé. NULL pour les solars jamais reclassés
-- (comportement dégradé : le libellé seul continue de servir de repère, comme
-- aujourd'hui).
--
-- `taxonomy_scope` : isolation news/knowledge (diagnostic §21-22, table
-- partagée avec la classification des articles d'actualité). Défaut prudent
-- 'unknown' — jamais 'news' par défaut sur les 245 lignes existantes, pour ne
-- jamais masquer à tort un solar déjà utilisé par le QCM (cf. backfill
-- ci-dessous, qui déduit le scope réel depuis l'usage observé plutôt que de
-- le présumer).
--
-- 4 valeurs, pas 3 (correctif du 16/08/2026, vérification finale point 2) :
-- 'knowledge', 'news', 'both' (référencé réellement par les DEUX pipelines —
-- 9 cas mesurés), 'unknown'. Un solar 'both' EST un candidat knowledge
-- (et news) légitime, jamais traité comme 'unknown' — le masquer serait une
-- régression puisqu'il est réellement utilisé par le pipeline connaissances.
-- cf. lib/knowledge-taxonomy/taxonomy-engine.js isKnowledgeCandidate/
-- isNewsCandidate, seule porte d'entrée pour cette décision.
ALTER TABLE solar_systems
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS taxonomy_scope TEXT NOT NULL DEFAULT 'unknown'
    CHECK (taxonomy_scope IN ('knowledge', 'news', 'both', 'unknown'));

CREATE INDEX IF NOT EXISTS solar_systems_taxonomy_scope_idx ON solar_systems (taxonomy_scope);

-- Backfill DÉDUIT depuis l'usage réel, jamais un UPDATE aveugle sur toute la
-- table (cf. diagnostic §22, "ne pas mettre 'news' par défaut sur tout").
-- Mesuré en lecture seule le 16/08/2026 (vérification finale, sans migration
-- appliquée) sur les 245 lignes réelles : NEWS_ONLY=126, KNOWLEDGE_ONLY=44,
-- BOTH=9, UNKNOWN=66.
--
-- Un solar référencé EXCLUSIVEMENT par un pipeline reçoit ce scope ; un solar
-- référencé par LES DEUX reçoit explicitement 'both' — jamais silencieusement
-- résolu en 'knowledge' (comme le faisait une première version de ce
-- fichier) ni laissé 'unknown' (ce qui le rendrait invisible au pipeline
-- connaissances alors qu'il y est réellement utilisé, cf. demande du
-- 16/08/2026 "aucun cas ambigu ne doit être automatiquement résolu [en
-- knowledge ou news] ... mais un solar BOTH doit rester éligible au MATCH
-- knowledge"). Idempotent (peut être relancé sans effet secondaire).
UPDATE solar_systems
SET taxonomy_scope = 'both'
WHERE id IN (SELECT DISTINCT solar_system_id FROM user_article_acquisitions WHERE solar_system_id IS NOT NULL)
  AND id IN (SELECT DISTINCT solar_system_id FROM opinion_articles WHERE solar_system_id IS NOT NULL)
  AND taxonomy_scope = 'unknown';

UPDATE solar_systems
SET taxonomy_scope = 'knowledge'
WHERE id IN (SELECT DISTINCT solar_system_id FROM user_article_acquisitions WHERE solar_system_id IS NOT NULL)
  AND id NOT IN (SELECT DISTINCT solar_system_id FROM opinion_articles WHERE solar_system_id IS NOT NULL)
  AND taxonomy_scope = 'unknown';

UPDATE solar_systems
SET taxonomy_scope = 'news'
WHERE id IN (SELECT DISTINCT solar_system_id FROM opinion_articles WHERE solar_system_id IS NOT NULL)
  AND id NOT IN (SELECT DISTINCT solar_system_id FROM user_article_acquisitions WHERE solar_system_id IS NOT NULL)
  AND taxonomy_scope = 'unknown';

-- Note : les solars référencés uniquement par daily_quiz.questions[].sourcePlacement
-- (jamais encore acquis par personne) ne sont PAS couverts par ce backfill SQL
-- (le JSON n'est pas indexable simplement en SQL) — cf.
-- tools/backfill-taxonomy-scope.js, à lancer une fois après cette migration,
-- qui complète ces cas précis en lisant daily_quiz côté applicatif.
