-- À exécuter une fois dans le SQL editor de Supabase, après
-- data/migration-learn-next-engine.sql.
--
-- V2 du moteur "À apprendre ensuite" (mission du 27/08/2026) : quand le
-- catalogue Mnoria n'offre pas encore assez de bons candidats connectés au
-- graphe d'un utilisateur, une IA propose jusqu'à 3 sujets à créer (jamais un
-- article/QCM directement, cf. lib/learn-next/ai-fallback.js). Cette table
-- mutualise ces PROPOSITIONS (pas les connaissances elles-mêmes — celles-ci
-- rejoignent le catalogue normal via le pipeline "Générer avec l'IA" existant
-- uniquement si un utilisateur clique "Créer cet apprentissage", cf. POST
-- /api/users/notion-quizzes/custom, jamais dupliqué) entre TOUS les
-- utilisateurs qui retombent sur la même "zone du graphe".
--
-- gap_signature = sha256 tronqué des clés (type::sourceId) des connaissances
-- les plus solides de l'utilisateur au moment du calcul (cf.
-- computeGapSignature) — jamais un identifiant personnel : deux utilisateurs
-- différents avec le même noyau d'acquis solides partagent la même
-- signature et donc la même proposition déjà calculée, sans nouvel appel IA
-- (section 2/7 de la mission).
--
-- status='pending' sert de verrou anti-concurrence (section 14) : avant tout
-- appel IA, une INSERT est tentée sur cette clé primaire — si elle échoue
-- (contrainte déjà prise par une requête concurrente), aucun deuxième appel
-- n'est fait, cette requête se contente de la V1 pour cette fois (best-effort,
-- jamais bloquant, cf. section 15).
CREATE TABLE IF NOT EXISTS ai_learning_proposals (
  gap_signature TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  proposals JSONB,
  model TEXT,
  seed_topic_count INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Renseigné uniquement si un utilisateur a effectivement cliqué "Créer cet
  -- apprentissage" sur une des propositions de cette ligne (section 9 : une
  -- suggestion n'entre dans le catalogue global qu'après adoption effective).
  -- Une fois adopté, la ligne n'est plus jamais re-proposée (le vrai sujet
  -- existe désormais dans le catalogue normal — cf. lib/learn-next/repository.js
  -- fetchCachedGapProposals).
  adopted_title TEXT,
  adopted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ai_learning_proposals_created_at_idx ON ai_learning_proposals (created_at DESC);
