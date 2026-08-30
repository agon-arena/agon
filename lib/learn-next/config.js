"use strict";

// Configuration centralisée du moteur "À apprendre ensuite" (cf. data/
// migration-learn-next-engine.sql pour le schéma, lib/learn-next/scoring.js
// pour l'algorithme). Toutes les valeurs magiques du scoring vivent ici,
// jamais dispersées dans scoring.js/repository.js/engine.js — un ajustement
// des coefficients après analyse des usages réels ne doit toucher QUE ce
// fichier.
//
// AVERTISSEMENT DE MODÉLISATION (revue du 27/08/2026) : culture_generale_
// notion_links représente des relations FACTUELLES entre deux connaissances
// (cf. son prompt de détection, server.js findAndStoreCultureGeneraleNotionLink)
// — jamais typées "prerequisite". Le moteur ne dispose donc PAS de vrais
// prérequis pédagogiques. Ce qu'il calcule à partir de ces liens est une
// "neighborhood mastery"/readiness : à quel point l'environnement conceptuel
// immédiat d'un candidat est déjà maîtrisé par l'utilisateur — une
// approximation de zone proximale de développement, pas une vraie ZPD au
// sens strict. Si Mnoria introduit un jour une relation `relation_type`
// explicite (ex. "prerequisite" vs "related" vs "bridge") sur
// culture_generale_notion_links, buildConnectedCandidates (repository.js)
// est l'unique endroit à adapter pour ne pondérer/filtrer que les arêtes
// pédagogiques réelles dans le calcul de readiness — le reste du moteur
// (bridge/interest/importance/discovery) resterait inchangé.

// final_score =
//   0.30 × zpd_score            (readiness du voisinage, mise en forme ZPD)
// + 0.25 × connection_score     (poids/nombre d'acquis reliés, saturé PAR branche)
// + 0.15 × bridge_score         (diversité RÉELLE des branches reliées)
// + 0.15 × interest_score
// + 0.10 × importance_score     (log1p, jamais dominé par la pure popularité)
// + 0.05 × discovery_score      (nouveauté continue, jamais une exclusion binaire)
// - redundancy (filtre, pas une soustraction : une quasi-redite n'est jamais recommandée)
// - saturation_penalty
// - too_far_penalty
const RECOMMENDATION_WEIGHTS = {
  zpd: 0.30,
  connections: 0.25,
  bridge: 0.15,
  interest: 0.15,
  importance: 0.10,
  discovery: 0.05
};

// Zone où la readiness (neighborhood mastery, cf. avertissement ci-dessus)
// produit le meilleur zpd_score : ni trop loin (rien d'acquis autour) ni
// trop proche (presque redondant). Configurable, point de départ [0.6, 0.9].
const ZPD_IDEAL_ZONE = { min: 0.60, max: 0.90 };

// En-dessous de ce seuil de readiness, un candidat "continuité" (pas encore
// un pont, cf. BRIDGE_TYPE_MIN_CLUSTERS) est jugé hors de portée immédiate :
// too_far_penalty monte continûment jusqu'à TOO_FAR_MAX_PENALTY à mesure que
// la readiness s'approche de 0. Jamais appliqué à un candidat déjà qualifié
// de pont — un pont peut légitimement reposer sur peu de connexions
// individuelles (section 3 de la revue du 27/08/2026).
const TOO_FAR_READINESS_THRESHOLD = 0.15;
const TOO_FAR_MAX_PENALTY = 0.35;

// Saturation du score de connexions — appliquée PAR branche (Solar System)
// puis sommée (cf. scoring.js computeConnectionScore) : un candidat relié à
// 5 acquis d'une seule branche ne doit pas mécaniquement dominer un candidat
// relié à seulement 2 acquis mais dans 2 branches différentes (section 3 de
// la revue du 27/08/2026 — "ne double-compte pas excessivement la même
// information" entre connection_score et bridge_score). La concavité de la
// fonction de saturation fait que saturer par groupe PUIS sommer favorise
// déjà intrinsèquement la diversité, sans avoir besoin d'y ajouter une
// pénalité séparée ici.
const CONNECTIONS_SATURATION_K = 2.2;

// BridgeScore : palier selon le nombre de Solar Systems DISTINCTS parmi les
// voisins acquis qui pointent vers le candidat (jamais un simple comptage de
// relations, cf. connection_score qui s'en charge séparément). Palier
// manquant = dernière valeur (plafond).
const BRIDGE_SCORE_BY_DISTINCT_CLUSTERS = [0, 0.2, 0.7, 1];
// À partir de combien de branches distinctes un candidat est classé "pont"
// (reason_type=bridge) plutôt que "continuité" — et exempté de too_far_penalty.
const BRIDGE_TYPE_MIN_CLUSTERS = 2;
// Bonus secondaire, optionnel et volontairement plafonné bas : diversité de
// Stars au-delà de ce qu'impliquent déjà les Solars distincts (ex. 2 Stars
// différentes dans le MÊME Solar) — un simple départage fin, jamais de quoi
// faire dépasser un vrai pont multi-Solar à un candidat mono-Solar.
const BRIDGE_STAR_BONUS_PER_EXTRA_STAR = 0.02;
const BRIDGE_STAR_BONUS_CAP = 0.05;

// Mastery neutre attribuée à un voisin acquis sans aucun état FSRS mesurable
// (acquisition existante mais jamais passée par memory_item_fsrs_states, ou
// utilisateur avec acquis mais sans historique de révision exploitable) —
// section 6 de la revue du 27/08/2026 : "poids de maîtrise prudent par
// défaut", ni "fragile" ni "solide". Le moteur ne doit jamais planter ni
// renvoyer un résultat vide simplement parce que ces données manquent.
const NEUTRAL_NEIGHBOR_MASTERY = 0.5;

// Score d'intérêt utilisateur : part des acquisitions de l'utilisateur dans
// le Solar du candidat, mise à l'échelle. baseline = score plancher pour un
// Solar jamais fréquenté (jamais 0 : un candidat pertinent par ailleurs ne
// doit pas être éliminé uniquement parce que son Solar est neuf).
const INTEREST_SOLAR_SHARE_MULTIPLIER = 3;
const INTEREST_BASELINE = 0.30;
const INTEREST_UNKNOWN_SOLAR = 0.40;

// Importance intrinsèque — formule déterministe, jamais un appel IA :
// log1p(degré de connexion global) et log1p(nombre d'utilisateurs l'ayant
// déjà acquise), normalisés puis moyennés. log1p (plutôt qu'un simple ratio
// linéaire plafonné) évite qu'une connaissance ayant des dizaines de
// milliers d'acquisitions écrase mécaniquement une excellente connaissance
// n'en ayant que quelques centaines — les deux approchent 1 sans qu'un pur
// effet de volume ne les distingue au-delà d'un certain point (section 4 de
// la revue du 27/08/2026). *_ANCHOR = valeur à laquelle le composant
// atteint 1 (avant clamp) ; même formule appliquée au backfill SQL
// (data/migration-learn-next-engine.sql) et à l'upsert incrémental
// (repository.js upsertKnowledgeNode) — ne jamais les faire diverger.
const IMPORTANCE_LINK_DEGREE_ANCHOR = 5;
const IMPORTANCE_ACQUISITION_COUNT_ANCHOR = 20;
const IMPORTANCE_TIER_THRESHOLDS = { fondamental: 0.66, structurant: 0.33 };

// Mix cible continuité / pont / découverte. Indicatif — la sélection finale
// (assembleRecommendations) respecte ces proportions du mieux possible sans
// jamais forcer un mauvais candidat pour les atteindre.
const MIX_RATIOS = { continuity: 0.70, bridge: 0.20, discovery: 0.10 };

// Anti-bulle / diversification. Nombre maximal de recommandations d'un même
// Solar dans UNE réponse (diversification intra-réponse, gratuite, sans
// requête supplémentaire).
const MAX_PER_SOLAR_IN_RESPONSE = 2;

// Pénalité de saturation thématique inter-sessions : basée sur les derniers
// événements "shown" de recommendation_events (fenêtre courte, un seul
// utilisateur, requête indexée). lookbackEvents = combien d'événements
// récents on regarde ; chaque occurrence d'un Solar au-delà du seuil de
// tolérance retire penaltyPerRepeat au score (plafonné à maxPenalty).
const SATURATION = {
  lookbackEvents: 30,
  lookbackDays: 3,
  toleratedPerSolar: 2,
  penaltyPerRepeat: 0.06,
  maxPenalty: 0.30
};

// Découverte : nouveauté CONTINUE (jamais une exclusion binaire "hors des
// Solars actifs", section 5 de la revue du 27/08/2026) — un utilisateur déjà
// actif dans beaucoup de branches doit conserver une vraie exploration.
// novelty = 1 - part des acquisitions de l'utilisateur dans le Solar du
// candidat (0 = Solar omniprésent chez lui, 1 = Solar jamais rencontré ou
// utilisateur cold-start). discoveryScore = base + novelty*poids +
// importance*poids, jamais nul (BASE plancher) ni jamais automatiquement
// maximal (les deux poids somment à moins de 1 - BASE).
const DISCOVERY = {
  base: 0.30,
  noveltyWeight: 0.50,
  importanceWeight: 0.20
};

// Redondance : filtre d'exclusion (pas une soustraction dans final_score) —
// une connaissance déjà acquise, ou quasi identique en texte à un acquis
// (cf. lib/topic-dedup.js isSafeTopicEquivalent, réutilisé tel quel), n'est
// JAMAIS recommandée. Contrairement à too_far_penalty/saturation_penalty qui
// nuancent un score, la redondance est une garantie de correction, pas une
// préférence — elle reste donc un filtre du pool de candidats (cf.
// engine.js), jamais un terme additif de final_score.

// Taille des pools de candidats interrogés/retenus avant scoring/sélection
// finale — borne le coût de calcul Node ET les requêtes de détail
// (knowledge_nodes, mastery) qui suivent, jamais un scan Supabase complet
// (les requêtes elles-mêmes sont déjà bornées par le graphe propre à
// l'utilisateur, cf. repository.js). Si le graphe personnel d'un utilisateur
// produit plus de candidats connectés que CANDIDATE_POOL_SIZE, seuls les
// plus prometteurs (le plus de voisins acquis) sont conservés avant le
// scoring détaillé.
const CANDIDATE_POOL_SIZE = 60;
const DISCOVERY_POOL_SIZE = 30;

// Cache mémoire des recommandations calculées, par legacyKey (même pattern
// Map()+TTL que le reste du projet, cf. server.js debatesApiResponseCache).
const RECOMMENDATIONS_CACHE_TTL_MS = 20 * 60 * 1000;
const RECOMMENDATIONS_CACHE_MAX = 2000;

// Nombre de préconisations toujours visées par la fonctionnalité "Préconisations"
// (revue du 30/08/2026) : le catalogue (V1) a la priorité, l'IA (V2) ne comble
// que les places qu'un vrai seuil de pertinence (cf. AI_FALLBACK_MIN_SCORE/
// AI_FALLBACK_MIN_READINESS, appliqués désormais AVANT l'assemblage plutôt
// qu'à un simple compteur parallèle) laisse vides — jamais un remplissage
// artificiel du catalogue, jamais plus d'un appel IA pour combler le manque.
const DEFAULT_RECOMMENDATION_LIMIT = 3;
const MAX_RECOMMENDATION_LIMIT = 20;

// Types de connaissance sûrs à recommander à N'IMPORTE QUEL utilisateur
// (confidentialité — section 19 du plan initial : "ne jamais exposer les
// données de mémorisation d'un autre utilisateur"). Découvert en vérification
// live du 27/08/2026 : le seul mécanisme de partage inter-utilisateurs déjà
// existant dans Mnoria (GET /api/users/notion-quizzes/explore, server.js) ne
// partage QUE les sujets "notion:custom:%" — jamais les imports personnels
// (photo/PDF/texte/lien/YouTube, contenu potentiellement privé d'un visiteur
// précis) ni les quiz "comprendre" (dérivés d'une paire de connaissances déjà
// acquises par UN utilisateur précis, jamais une connaissance autonome en
// soi). Cette liste reprend exactement le même périmètre — les 8 Éclairages
// quotidiens (contenu partagé, généré une fois par jour pour tout le monde)
// + "debat-notion" (notion extraite d'une arène de débat PUBLIQUE — cf.
// extractDebateTopicNotions, traité par le reste du projet exactement comme
// "histoire" dans NOTION_QUIZ_SOURCE_TYPES, server.js — ajouté le 27/08/2026
// après l'avoir manqué dans l'audit initial, aucune donnée privée ici, un
// débat est un contenu public par nature) + "custom" (déjà public via
// Explorer). N'affecte QUE les CANDIDATS proposés : un acquis d'un type
// exclu (ex. un import personnel) continue de compter normalement dans le
// calcul de readiness/interest de SON PROPRE utilisateur, seulement jamais
// recommandé à un autre.
const SHAREABLE_KNOWLEDGE_TYPES = [
  "histoire", "parallele", "pensee", "mecanisme",
  "concept", "citation", "oeuvre", "latin", "debat-notion", "custom"
];

// ── V2 : fallback IA (mission du 27/08/2026, revue du 30/08/2026) ──────────
// La V2 est une COUCHE COMPLÉMENTAIRE : elle ne s'active que lorsque le
// catalogue Mnoria n'offre pas assez de candidats RÉELLEMENT pertinents pour
// remplir DEFAULT_RECOMMENDATION_LIMIT places — jamais pour remplir
// artificiellement, jamais sur un profil totalement vide (coldStart, 0
// acquisition : cf. shouldTriggerFallback) où aucune IA ne peut légitimement
// déduire un "trou" pédagogique plutôt qu'inventer. Dès qu'il existe AU
// MOINS UNE acquisition, en revanche, la V2 peut compléter les places
// manquantes (revue du 30/08/2026 : l'ancien plancher de 4 acquisitions ne se
// justifiait plus, seul coldStart reste un vrai cas particulier).

const AI_FALLBACK_ENABLED = String(process.env.LEARN_NEXT_AI_FALLBACK_ENABLED || "on").trim().toLowerCase() !== "off";

// "Bon candidat" = connecté au graphe (bridge, ou continuity avec une
// readiness correcte) ET au-dessus d'un score plancher. Appliqué par
// scoring.passesRelevanceGate DIRECTEMENT sur la liste retournée par le
// moteur (engine.js), pas seulement sur un compteur parallèle (revue du
// 30/08/2026) — un candidat "discovery" ne peut mathématiquement jamais
// dépasser AI_FALLBACK_MIN_SCORE pour un utilisateur non cold-start (ses
// composantes zpd/connections/bridge, 70% du poids total, sont toujours
// nulles faute de voisin acquis), donc ce seuil suffit à lui seul à exclure
// "discovery" de la liste des bons candidats sans règle de type séparée.
const AI_FALLBACK_MIN_SCORE = 0.45;
const AI_FALLBACK_MIN_READINESS = 0.5;

// Contexte envoyé au LLM — volontairement compact (section 3) : jamais un
// dump de la mémoire complète. seedTopicLimit borne à la fois le contexte ET
// la signature de déduplication/mutualisation (cf. computeGapSignature).
const AI_FALLBACK_SEED_TOPIC_LIMIT = 6;
const AI_FALLBACK_DOMINANT_BRANCHES_LIMIT = 5;
const AI_FALLBACK_EXISTING_CANDIDATES_LIMIT = 5;
const AI_FALLBACK_CONTEXT_MAX_CHARS = 2500;

// Sortie IA : au maximum 3 propositions de SUJETS (jamais d'article/QCM,
// cf. section 4), validées/tronquées strictement après réception.
const AI_FALLBACK_MAX_PROPOSALS = 3;
const AI_FALLBACK_MAX_TITLE_LENGTH = 100;
const AI_FALLBACK_MAX_REASON_LENGTH = 220;
const AI_FALLBACK_MAX_THEME_LENGTH = 40;
// Vocabulaire de niveau déjà utilisé par tout le reste du projet
// (NOTION_QUIZ_LEVELS, server.js) — jamais un vocabulaire inventé pour la V2.
// "exhaustif" est exclu : c'est un mode "couverture complète d'une liste",
// jamais pertinent pour un sujet qui n'existe pas encore.
const AI_FALLBACK_ALLOWED_DIFFICULTIES = ["elementaire", "avance", "expert"];
// Mêmes 3 types que la V1 (cf. classifyGraphRecommendationType) : une
// proposition IA s'affiche et se comporte comme n'importe quel candidat V1
// une fois acceptée, jamais un 4e badge à part.
const AI_FALLBACK_ALLOWED_PROPOSAL_TYPES = ["bridge", "continuity", "discovery"];

// Modèle réellement utilisé ailleurs dans le projet pour un raisonnement sur
// des connaissances déjà admises (cf. server.js DAILY_QUIZ_NARRATIVE_MODEL) —
// jamais un nouveau choix de modèle inventé pour la V2. Tarif réel disponible
// dans lib/ai-usage-log.js (MODEL_PRICING_USD_PER_MILLION_TOKENS).
const AI_FALLBACK_MODEL = process.env.OPENAI_LEARN_NEXT_FALLBACK_MODEL || "gpt-4.1-mini";

// Mutualisation entre utilisateurs (section 2/7) : une même "signature de
// trou" (cf. computeGapSignature) ne redéclenche pas d'appel IA tant que ses
// propositions restent fraîches — réutilisées par tout utilisateur qui
// retombe sur la même zone du graphe, jamais recalculées pour rien.
const AI_FALLBACK_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

// Anti-concurrence (section 14) : une ligne restée "pending" plus longtemps
// que ceci est considérée comme un appel mort (crash serveur, timeout réseau)
// plutôt que toujours en cours — même principe et même ordre de grandeur que
// DEBATE_TOPIC_NOTIONS_STALE_MS ailleurs dans server.js — et peut être
// reprise par la requête suivante plutôt que de bloquer cette signature
// indéfiniment.
const AI_FALLBACK_PENDING_STALE_MS = 3 * 60 * 1000;

module.exports = {
  RECOMMENDATION_WEIGHTS,
  ZPD_IDEAL_ZONE,
  TOO_FAR_READINESS_THRESHOLD,
  TOO_FAR_MAX_PENALTY,
  CONNECTIONS_SATURATION_K,
  BRIDGE_SCORE_BY_DISTINCT_CLUSTERS,
  BRIDGE_TYPE_MIN_CLUSTERS,
  BRIDGE_STAR_BONUS_PER_EXTRA_STAR,
  BRIDGE_STAR_BONUS_CAP,
  NEUTRAL_NEIGHBOR_MASTERY,
  INTEREST_SOLAR_SHARE_MULTIPLIER,
  INTEREST_BASELINE,
  INTEREST_UNKNOWN_SOLAR,
  IMPORTANCE_LINK_DEGREE_ANCHOR,
  IMPORTANCE_ACQUISITION_COUNT_ANCHOR,
  IMPORTANCE_TIER_THRESHOLDS,
  MIX_RATIOS,
  MAX_PER_SOLAR_IN_RESPONSE,
  SATURATION,
  DISCOVERY,
  CANDIDATE_POOL_SIZE,
  DISCOVERY_POOL_SIZE,
  RECOMMENDATIONS_CACHE_TTL_MS,
  RECOMMENDATIONS_CACHE_MAX,
  DEFAULT_RECOMMENDATION_LIMIT,
  MAX_RECOMMENDATION_LIMIT,
  SHAREABLE_KNOWLEDGE_TYPES,
  AI_FALLBACK_ENABLED,
  AI_FALLBACK_MIN_SCORE,
  AI_FALLBACK_MIN_READINESS,
  AI_FALLBACK_SEED_TOPIC_LIMIT,
  AI_FALLBACK_DOMINANT_BRANCHES_LIMIT,
  AI_FALLBACK_EXISTING_CANDIDATES_LIMIT,
  AI_FALLBACK_CONTEXT_MAX_CHARS,
  AI_FALLBACK_MAX_PROPOSALS,
  AI_FALLBACK_MAX_TITLE_LENGTH,
  AI_FALLBACK_MAX_REASON_LENGTH,
  AI_FALLBACK_MAX_THEME_LENGTH,
  AI_FALLBACK_ALLOWED_DIFFICULTIES,
  AI_FALLBACK_ALLOWED_PROPOSAL_TYPES,
  AI_FALLBACK_MODEL,
  AI_FALLBACK_COOLDOWN_MS,
  AI_FALLBACK_PENDING_STALE_MS
};
