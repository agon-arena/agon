"use strict";

// Orchestration du moteur "À apprendre ensuite" : compose repository.js
// (accès Supabase) et scoring.js (calcul pur) pour produire la liste finale.
// AUCUN appel IA ici ni transitivement (ni repository.js ni scoring.js n'en
// font) — vérifié par un test statique (test/learn-next-no-ai-calls.test.js).
//
// cf. l'avertissement de modélisation en tête de config.js : ce moteur
// calcule une approximation de ZPD basée sur le graphe existant
// (culture_generale_notion_links, non typé "prerequisite") et la maîtrise
// FSRS des voisins acquis — jamais un vrai taux de prérequis pédagogiques.

const config = require("./config");
const scoring = require("./scoring");
const repository = require("./repository");
const { cultureGeneraleNotionKey } = require("../culture-generale-links");
const { isSafeTopicEquivalent } = require("../topic-dedup");

function toFinite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Confidentialité (section 19 du plan initial, cf. l'avertissement détaillé
// dans config.js) : ensemble figé une seule fois au chargement du module,
// jamais reconstruit par requête.
const SHAREABLE_TYPES_SET = new Set(config.SHAREABLE_KNOWLEDGE_TYPES);

// deps : { supabase, fetchAllSupabaseRowsIn, computeRetrievability } — toutes
// injectées par l'appelant (server.js) plutôt que require()-ées ici, pour
// rester testable avec un supabase/fsrs mockés sans toucher au vrai serveur.
async function computeLearnNextRecommendations(deps, { userId, limit, debug = false, now = new Date() }) {
  const { supabase, fetchAllSupabaseRowsIn, computeRetrievability } = deps;
  const safeLimit = Math.max(1, Math.min(config.MAX_RECOMMENDATION_LIMIT, Number(limit) || config.DEFAULT_RECOMMENDATION_LIMIT));

  // Performance (revue en conditions réelles du 27/08/2026) : les 3 lectures
  // ci-dessous ne dépendent QUE de userId, jamais les unes des autres —
  // lancées en parallèle plutôt qu'en chaîne pour ne pas payer 3 aller-
  // retours Supabase séquentiels pour rien. recentSolarCounts n'est utilisée
  // que beaucoup plus bas (pénalité de saturation) mais ne coûte rien à
  // démarrer ici.
  const [acquisitions, activeSolarIds, recentSolarCounts] = await Promise.all([
    repository.fetchUserAcquiredEclairages(supabase, userId),
    repository.fetchUserActiveSolarIds(supabase, userId),
    repository.fetchRecentShownSolarCounts(supabase, userId, config.SATURATION)
  ]);

  const coldStart = acquisitions.length === 0;
  const acquiredKeySet = new Set(acquisitions.map((a) => a.key));
  const acquisitionsByKey = new Map(acquisitions.map((a) => [a.key, a]));
  const totalAcquisitions = acquisitions.length;
  const solarAcquisitionCounts = new Map();
  for (const a of acquisitions) {
    if (!a.solarSystemId) continue;
    solarAcquisitionCounts.set(a.solarSystemId, (solarAcquisitionCounts.get(a.solarSystemId) || 0) + 1);
  }

  let connectedCandidatesMap = new Map();
  // Poids de maîtrise prudent par défaut (section 6 de la revue du
  // 27/08/2026) : reste NEUTRAL_NEIGHBOR_MASTERY pour chaque voisin tant
  // qu'aucun état FSRS exploitable n'a été chargé — jamais un crash ni une
  // liste vide simplement parce que l'utilisateur n'a pas (encore) assez
  // d'historique de révisions.
  let masteryByKey = new Map();
  let knowledgeNodesByKey = new Map();

  if (!coldStart) {
    const acquiredSourceIds = [...new Set(acquisitions.map((a) => a.sourceId))];
    // linkRows et masteryByKey ne dépendent pas l'un de l'autre (le premier
    // vient des acquisitions déjà en main, le second uniquement de userId) —
    // même logique de parallélisation que ci-dessus.
    const [linkRows, mastery] = await Promise.all([
      repository.fetchNeighborLinks(supabase, fetchAllSupabaseRowsIn, acquiredSourceIds),
      repository.fetchUserSubjectMasteryByKey(supabase, userId, computeRetrievability, now)
    ]);
    masteryByKey = mastery;
    connectedCandidatesMap = repository.buildConnectedCandidates(linkRows, acquiredKeySet, SHAREABLE_TYPES_SET);

    // Borne le coût du scoring détaillé (section 8 de la revue du
    // 27/08/2026) : si le graphe personnel produit plus de candidats que
    // CANDIDATE_POOL_SIZE, ne retient que les plus prometteurs (le plus de
    // voisins acquis distincts) AVANT d'aller chercher knowledge_nodes —
    // jamais une requête de détail pour un candidat qui ne sera de toute
    // façon pas retenu.
    if (connectedCandidatesMap.size > config.CANDIDATE_POOL_SIZE) {
      const trimmed = [...connectedCandidatesMap.values()]
        .sort((a, b) => b.neighborKeys.size - a.neighborKeys.size)
        .slice(0, config.CANDIDATE_POOL_SIZE);
      connectedCandidatesMap = new Map(trimmed.map((c) => [c.key, c]));
    }
  }

  // knowledgeNodesByKey (candidats connectés) et discoveryRows (pool de
  // découverte) ne dépendent que de connectedCandidatesMap.keys()/excludeKeys
  // — jamais l'un de l'autre — lancées en parallèle plutôt qu'en séquence.
  const excludeKeys = new Set([...acquiredKeySet, ...connectedCandidatesMap.keys()]);
  const [nodes, discoveryRows] = await Promise.all([
    connectedCandidatesMap.size
      ? repository.fetchKnowledgeNodesByKeys(supabase, fetchAllSupabaseRowsIn, [...connectedCandidatesMap.keys()])
      : Promise.resolve(new Map()),
    repository.fetchDiscoveryCandidates(supabase, {
      excludeKeys,
      poolSize: config.DISCOVERY_POOL_SIZE,
      shareableTypes: config.SHAREABLE_KNOWLEDGE_TYPES
    })
  ]);
  knowledgeNodesByKey = nodes;

  // Noms de Solar pour les libellés "Crée un pont entre X et Y" : tous les
  // ids potentiellement utiles (Solars des acquisitions + des candidats
  // connectés), une seule requête groupée. Dépend de knowledgeNodesByKey,
  // donc reste après le Promise.all ci-dessus.
  const solarIdsForNames = new Set();
  for (const a of acquisitions) if (a.solarSystemId) solarIdsForNames.add(a.solarSystemId);
  for (const node of knowledgeNodesByKey.values()) if (node.solar_system_id) solarIdsForNames.add(node.solar_system_id);
  const solarNamesById = await repository.fetchSolarSystemNames(supabase, [...solarIdsForNames]);

  const scoredConnected = [];
  for (const candidate of connectedCandidatesMap.values()) {
    const node = knowledgeNodesByKey.get(candidate.key) || null;
    const linkDegree = Math.max(node?.link_degree || 0, candidate.neighborKeys.size);

    // Poids de maîtrise prudent par défaut quand FSRS est indisponible pour
    // ce voisin précis (section 6) — jamais 0, jamais un crash.
    const neighborEntries = [...candidate.neighborKeys].map((k) => ({
      mastery: masteryByKey.has(k) ? masteryByKey.get(k) : config.NEUTRAL_NEIGHBOR_MASTERY,
      solarSystemId: acquisitionsByKey.get(k)?.solarSystemId || null
    }));
    const neighborMasteries = neighborEntries.map((e) => e.mastery);
    const readiness = scoring.computeNeighborhoodMastery({ neighborMasteries, candidateLinkDegree: linkDegree });

    const neighborSolarIds = new Set();
    const neighborStarIds = new Set();
    for (const neighborKey of candidate.neighborKeys) {
      const acquisition = acquisitionsByKey.get(neighborKey);
      if (acquisition?.solarSystemId) neighborSolarIds.add(acquisition.solarSystemId);
      if (acquisition?.starId) neighborStarIds.add(acquisition.starId);
    }
    const distinctSolarCount = neighborSolarIds.size;
    const distinctStarCount = neighborStarIds.size;

    // Redondance (section 9 du plan initial) : filtre d'exclusion, jamais une
    // simple pénalité — une quasi-reformulation d'un acquis n'est JAMAIS
    // recommandée. Réutilise isSafeTopicEquivalent (lib/topic-dedup).
    const isRedundant = acquisitions.some((a) => a.name && candidate.name && isSafeTopicEquivalent(a.name, candidate.name));
    if (isRedundant) continue;

    const type = scoring.classifyGraphRecommendationType({ distinctSolarCount, readiness }, config);
    const zpdScore = scoring.computeZpdScore(readiness, config.ZPD_IDEAL_ZONE);
    const connectionScore = scoring.computeConnectionScore(neighborEntries, config.CONNECTIONS_SATURATION_K);
    const bridgeScore = scoring.computeBridgeScore({ distinctSolarCount, distinctStarCount }, config);
    const tooFarPenalty = scoring.computeTooFarPenalty(readiness, distinctSolarCount, config);

    const candidateSolarId = node?.solar_system_id || null;
    const solarKnown = !!candidateSolarId;
    const solarAcquisitionCount = solarKnown ? (solarAcquisitionCounts.get(candidateSolarId) || 0) : 0;
    const interestScore = scoring.computeInterestScore({ solarKnown, solarAcquisitionCount, totalAcquisitions }, config);

    const importanceScore = node?.importance_score != null
      ? toFinite(node.importance_score) ?? 0
      : scoring.computeImportanceScore({ linkDegree, acquisitionCount: node?.acquisition_count || 0 }, config);

    const novelty = scoring.computeNoveltyScore({ solarAcquisitionCount, totalAcquisitions });
    const discoveryScore = scoring.computeDiscoveryScore({ novelty, importanceScore }, config);
    const saturationPenalty = scoring.computeSaturationPenalty(candidateSolarId, recentSolarCounts, config.SATURATION);
    const penalty = tooFarPenalty + saturationPenalty;

    const finalScore = scoring.computeFinalScore(
      { zpd: zpdScore, connections: connectionScore, bridge: bridgeScore, interest: interestScore, importance: importanceScore, discovery: discoveryScore, penalty },
      config.RECOMMENDATION_WEIGHTS
    );

    const neighborNames = [...candidate.neighborKeys].map((k) => acquisitionsByKey.get(k)?.name).filter(Boolean);
    const clusterNames = [...neighborSolarIds].map((id) => solarNamesById.get(id)).filter(Boolean).slice(0, 2);
    const reason = scoring.buildReason({
      type,
      neighborNames,
      clusterNames,
      connectionCount: candidate.neighborKeys.size,
      importanceTier: node?.importance_tier
    });

    scoredConnected.push({
      key: candidate.key,
      subjectType: candidate.type,
      subjectSourceId: candidate.sourceId,
      name: candidate.name || node?.display_name || null,
      solarSystemId: candidateSolarId,
      type,
      finalScore,
      reason,
      debugScores: debug ? {
        readiness, zpdScore, connectionScore, bridgeScore, interestScore, importanceScore, discoveryScore,
        tooFarPenalty, saturationPenalty, distinctSolarCount, distinctStarCount, linkDegree
      } : null
    });
  }

  // Pool de découverte : déjà récupéré plus haut, en parallèle de
  // knowledgeNodesByKey (cf. Promise.all ci-dessus) — jamais les candidats
  // déjà couverts par le graphe (déjà mieux scorés là où c'est pertinent) ni
  // les acquis eux-mêmes. Plus de filtre binaire par Solar actif (section 5)
  // — la nouveauté est désormais un score continu calculé ci-dessous.
  const scoredDiscovery = [];
  for (const row of discoveryRows) {
    const name = row.display_name;
    const isRedundant = name && acquisitions.some((a) => a.name && isSafeTopicEquivalent(a.name, name));
    if (isRedundant) continue;

    const candidateSolarId = row.solar_system_id || null;
    const importanceScore = toFinite(row.importance_score) ?? 0;
    const solarAcquisitionCount = candidateSolarId ? (solarAcquisitionCounts.get(candidateSolarId) || 0) : 0;
    const novelty = scoring.computeNoveltyScore({ solarAcquisitionCount, totalAcquisitions });
    const discoveryScore = scoring.computeDiscoveryScore({ novelty, importanceScore }, config);
    const interestScore = scoring.computeInterestScore({
      solarKnown: !!candidateSolarId,
      solarAcquisitionCount,
      totalAcquisitions
    }, config);
    const saturationPenalty = scoring.computeSaturationPenalty(candidateSolarId, recentSolarCounts, config.SATURATION);

    const finalScore = scoring.computeFinalScore(
      { zpd: 0, connections: 0, bridge: 0, interest: interestScore, importance: importanceScore, discovery: discoveryScore, penalty: saturationPenalty },
      config.RECOMMENDATION_WEIGHTS
    );

    const reason = scoring.buildReason({ type: "discovery", importanceTier: row.importance_tier, coldStart });

    scoredDiscovery.push({
      key: cultureGeneraleNotionKey(row.subject_type, row.subject_source_id),
      subjectType: row.subject_type,
      subjectSourceId: String(row.subject_source_id),
      name,
      solarSystemId: candidateSolarId,
      type: "discovery",
      finalScore,
      reason,
      debugScores: debug ? { importanceScore, discoveryScore, interestScore, novelty, saturationPenalty } : null
    });
  }

  const picked = scoring.assembleRecommendations([...scoredConnected, ...scoredDiscovery], {
    limit: safeLimit,
    mixRatios: config.MIX_RATIOS,
    maxPerSolar: config.MAX_PER_SOLAR_IN_RESPONSE
  });

  const recommendations = picked.map((item) => ({
    knowledgeId: item.key,
    subjectType: item.subjectType,
    subjectSourceId: item.subjectSourceId,
    name: item.name,
    solarSystemId: item.solarSystemId,
    score: scoring.round4(item.finalScore),
    recommendationType: item.type,
    reasonType: item.reason.reasonType,
    reasonText: item.reason.reasonText,
    reasonData: item.reason.reasonData,
    ...(debug ? { debugScores: item.debugScores } : {})
  }));

  return { recommendations, coldStart };
}

module.exports = { computeLearnNextRecommendations };
