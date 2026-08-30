"use strict";

// Cœur déterministe du moteur "À apprendre ensuite" : uniquement des
// fonctions pures (aucun accès réseau/Supabase, aucun appel IA) — la
// composition avec les données réelles vit dans engine.js/repository.js.
// Isolé ainsi pour rester testable unitairement (cf. test/learn-next-scoring.test.js)
// et pour que tout ajustement de coefficient passe par lib/learn-next/config.js,
// jamais par une valeur magique glissée ici.
//
// cf. l'avertissement de modélisation en tête de config.js : les fonctions
// ci-dessous appelées "readiness"/"neighborhood mastery" n'expriment PAS un
// vrai taux de prérequis pédagogiques (Mnoria n'a pas de relation
// `prerequisite` explicite) — seulement une proximité conceptuelle dérivée
// du graphe existant (culture_generale_notion_links) et de la maîtrise FSRS
// des voisins acquis. C'est une approximation de ZPD basée sur le graphe,
// jamais présentée comme plus que ça.

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

// Importance intrinsèque d'une connaissance : combinaison déterministe,
// log1p (pas un simple ratio linéaire plafonné), du degré de connexion
// global et du nombre d'utilisateurs l'ayant déjà acquise — jamais un appel
// IA. log1p évite qu'un très grand nombre d'acquisitions (popularité) écrase
// mécaniquement une connaissance réellement structurante mais moins
// répandue : au-delà de l'ancre, la croissance est déjà quasi plate, et deux
// candidats largement au-dessus de l'ancre convergent vers 1 plutôt que de
// rester ordonnés par leur seul volume. Même formule que le backfill SQL
// (data/migration-learn-next-engine.sql), à ne jamais faire diverger.
function computeImportanceScore({ linkDegree = 0, acquisitionCount = 0 }, config) {
  const degreeComponent = Math.log1p(Math.max(0, linkDegree)) / Math.log1p(config.IMPORTANCE_LINK_DEGREE_ANCHOR);
  const acquisitionComponent = Math.log1p(Math.max(0, acquisitionCount)) / Math.log1p(config.IMPORTANCE_ACQUISITION_COUNT_ANCHOR);
  return round4(clamp01(0.5 * degreeComponent + 0.5 * acquisitionComponent));
}

// Popularité réelle (revue du 30/08/2026, cold-start) : `acquisition_count`
// (knowledge_nodes) EST la donnée déjà maintenue qui représente le mieux le
// nombre réel d'utilisateurs ayant acquis/appris une connaissance — jamais
// `importance_score`, qui mélange à parts égales cette popularité ET la
// connectivité du graphe (cf. computeImportanceScore ci-dessus), donc peut
// classer plus haut un sujet très connecté mais peu adopté qu'un sujet
// réellement populaire. Utilisée UNIQUEMENT pour classer les sujets d'entrée
// d'un utilisateur cold-start (aucun acquis, aucun signal personnel
// disponible) — jamais pour le classement normal (continuity/bridge/ZPD),
// qui reste géré par computeFinalScore.
//
// Même normalisation log1p que la composante popularité de l'importance
// (IMPORTANCE_ACQUISITION_COUNT_ANCHOR, réutilisée telle quelle — aucune
// nouvelle métrique) : SANS plafond à 1 ici, contrairement à
// computeImportanceScore — un plafond conviendrait à "importance" (au-delà
// d'un certain volume, l'ajout d'importance doit ralentir) mais casserait le
// but même de ce classement (départager les sujets réellement les plus
// adoptés entre eux, y compris bien au-delà de l'ancre — cf. 500 vs 200
// acquisitions réelles observées en base, qui doivent rester distingables).
// importance_score ne sert qu'à départager une égalité de popularité
// (poids infinitésimal, jamais de quoi inverser un écart de popularité réel).
function computePopularityScore({ acquisitionCount = 0, importanceScore = 0 }, config) {
  const popularity = Math.log1p(Math.max(0, acquisitionCount)) / Math.log1p(config.IMPORTANCE_ACQUISITION_COUNT_ANCHOR);
  return popularity + clamp01(importanceScore) * 1e-6;
}

function computeImportanceTier(importanceScore, thresholds) {
  if (importanceScore >= thresholds.fondamental) return "fondamental";
  if (importanceScore >= thresholds.structurant) return "structurant";
  return "secondaire";
}

// Neighborhood mastery / readiness (PAS un taux de prérequis, cf.
// avertissement en tête de fichier) : somme des mastery FSRS des voisins
// acquis, divisée par le degré de connexion global du candidat
// (knowledge_nodes.link_degree, jamais moins que le nombre de voisins acquis
// réellement observés — un candidat ne peut pas avoir MOINS de connexions
// globales que celles déjà vues côté utilisateur). Mesure "à quel point
// l'entourage conceptuel immédiat du candidat est déjà maîtrisé", pas une
// proportion de prérequis validés.
function computeNeighborhoodMastery({ neighborMasteries = [], candidateLinkDegree = 0 }) {
  const masterySum = neighborMasteries.reduce((sum, m) => sum + Math.max(0, m), 0);
  const degree = Math.max(candidateLinkDegree, neighborMasteries.length, 1);
  return masterySum / degree;
}

// Met en forme la readiness en zpd_score (section 2) : culmine à 1 dans
// [zone.min, zone.max], remonte linéairement de 0 à 0.6 avant la zone (trop
// loin), redescend doucement après (accessible mais presque redondant) sans
// jamais retomber sous 0.3 tant qu'il reste une readiness réelle.
function computeZpdScore(readiness, zone) {
  const r = Math.max(0, readiness);
  if (r <= 0) return 0;
  if (r < zone.min) return clamp01((r / zone.min) * 0.6);
  if (r <= zone.max) return clamp01(0.6 + ((r - zone.min) / (zone.max - zone.min)) * 0.4);
  const taperSpan = Math.max(1e-6, 1 - zone.max);
  const over = Math.min(1, (r - zone.max) / taperSpan);
  return clamp01(1 - over * 0.7);
}

// too_far_penalty (section 3 du plan initial / section 1 de la revue du
// 27/08/2026) : GRADUÉ, jamais une exclusion binaire — monte continûment à
// mesure que la readiness s'approche de 0, plafonné à TOO_FAR_MAX_PENALTY.
// Jamais appliqué à un candidat déjà qualifié de pont (distinctSolarCount >=
// BRIDGE_TYPE_MIN_CLUSTERS) : un pont peut reposer sur peu de connexions
// individuelles par construction, ce n'est pas un manque de base.
function computeTooFarPenalty(readiness, distinctSolarCount, config) {
  if (distinctSolarCount >= config.BRIDGE_TYPE_MIN_CLUSTERS) return 0;
  if (readiness >= config.TOO_FAR_READINESS_THRESHOLD) return 0;
  const ratio = 1 - readiness / config.TOO_FAR_READINESS_THRESHOLD;
  return round4(config.TOO_FAR_MAX_PENALTY * clamp01(ratio));
}

// ExistingKnowledgeConnections — saturé PAR branche (Solar System) puis
// sommé, jamais globalement (section 3 de la revue du 27/08/2026) :
// `neighborEntries` = [{ mastery, solarSystemId }]. Un candidat relié à 5
// acquis d'une seule branche ne doit pas dominer mécaniquement un candidat
// relié à 2 acquis dans 2 branches différentes — la concavité de la
// saturation appliquée par groupe avantage déjà intrinsèquement la
// diversité (voir aussi bridge_score, qui récompense la diversité elle-même
// séparément : les deux ne mesurent pas la même chose, connection_score
// reste "combien/quelle solidité", bridge_score "combien de branches").
function computeConnectionScore(neighborEntries = [], saturationK) {
  const bySolar = new Map();
  for (const entry of neighborEntries) {
    const key = entry.solarSystemId != null ? entry.solarSystemId : "unknown";
    bySolar.set(key, (bySolar.get(key) || 0) + Math.max(0, entry.mastery || 0));
  }
  let total = 0;
  for (const sum of bySolar.values()) {
    if (sum <= 0) continue;
    total += 1 - Math.exp(-sum / saturationK);
  }
  return clamp01(total);
}

// BridgeScore : palier selon le nombre de Solar Systems DISTINCTS parmi les
// voisins acquis qui pointent vers le candidat, plus un petit bonus optionnel
// de diversité de Stars (au-delà de ce qu'impliquent déjà les Solars
// distincts) — jamais assez fort pour faire dépasser un vrai pont
// multi-Solar par un candidat mono-Solar multi-Stars.
function computeBridgeScore({ distinctSolarCount = 0, distinctStarCount = 0 }, config) {
  const table = config.BRIDGE_SCORE_BY_DISTINCT_CLUSTERS;
  const base = table[Math.min(Math.max(0, distinctSolarCount), table.length - 1)];
  const extraStars = Math.max(0, distinctStarCount - distinctSolarCount);
  const starBonus = Math.min(config.BRIDGE_STAR_BONUS_CAP, extraStars * config.BRIDGE_STAR_BONUS_PER_EXTRA_STAR);
  return clamp01(base + starBonus);
}

// Intérêt utilisateur : part des acquisitions de l'utilisateur dans le Solar
// du candidat. Un Solar jamais fréquenté reste à une baseline non nulle
// (INTEREST_BASELINE) : l'absence d'intérêt mesuré ne doit jamais éliminer
// un candidat par ailleurs pertinent (ZPD/connexions/pont).
function computeInterestScore({ solarKnown, solarAcquisitionCount = 0, totalAcquisitions = 0 }, config) {
  if (!solarKnown) return config.INTEREST_UNKNOWN_SOLAR;
  const share = totalAcquisitions > 0 ? solarAcquisitionCount / totalAcquisitions : 0;
  return clamp01(config.INTEREST_BASELINE + share * config.INTEREST_SOLAR_SHARE_MULTIPLIER);
}

// Nouveauté CONTINUE d'un Solar pour cet utilisateur (section 5 de la revue
// du 27/08/2026) — jamais une exclusion binaire "hors des Solars actifs" :
// un utilisateur déjà actif dans beaucoup de branches doit conserver une
// vraie exploration. 1 = Solar jamais rencontré (ou cold start, aucun
// acquis) ; se rapproche de 0 à mesure que le Solar concentre une grande
// part des acquisitions de l'utilisateur.
function computeNoveltyScore({ solarAcquisitionCount = 0, totalAcquisitions = 0 }) {
  if (totalAcquisitions <= 0) return 1;
  const share = solarAcquisitionCount / totalAcquisitions;
  return clamp01(1 - share);
}

// Discovery : nouveauté continue + importance intrinsèque, jamais nul
// (plancher DISCOVERY.base) ni jamais automatiquement maximal.
function computeDiscoveryScore({ novelty = 0, importanceScore = 0 }, config) {
  const d = config.DISCOVERY;
  return clamp01(d.base + novelty * d.noveltyWeight + importanceScore * d.importanceWeight);
}

function computeFinalScore(components, weights) {
  const raw =
    weights.zpd * components.zpd +
    weights.connections * components.connections +
    weights.bridge * components.bridge +
    weights.interest * components.interest +
    weights.importance * components.importance +
    weights.discovery * components.discovery;
  return clamp01(raw - Math.max(0, components.penalty || 0));
}

// Pénalité de saturation thématique (section 10) : dérivée des événements
// "shown" récents (recommendation_events) déjà groupés par Solar par
// l'appelant (repository.js) — reste une fonction pure ici, jamais une
// requête.
function computeSaturationPenalty(solarSystemId, recentSolarCounts, config) {
  if (!solarSystemId) return 0;
  const count = recentSolarCounts.get(solarSystemId) || 0;
  const over = Math.max(0, count - config.toleratedPerSolar);
  return Math.min(config.maxPenalty, over * config.penaltyPerRepeat);
}

// Seuil unique de pertinence (revue du 30/08/2026) : réutilisé à la fois pour
// décider ce qui est effectivement montré dans la liste catalogue (engine.js,
// avant assembleRecommendations) et pour calculer combien de places l'IA doit
// combler (server.js) — plus un simple compteur parallèle qui n'influençait
// jamais ce qui était affiché. Un candidat "bridge" doit dépasser le score
// plancher ; un candidat "continuity" doit EN PLUS avoir une readiness
// suffisante (un pont peut légitimement reposer sur peu de connexions
// individuelles, cf. computeTooFarPenalty, jamais le cas d'une continuité).
// "discovery" n'est jamais éligible ici : ses composantes zpd/connections/
// bridge (70% du poids total de finalScore) sont toujours nulles faute de
// voisin acquis, donc AI_FALLBACK_MIN_SCORE l'exclut déjà mathématiquement —
// inutile d'ajouter une règle de type séparée pour ce cas.
function passesRelevanceGate({ type, finalScore, readiness = 0 }, config) {
  if (finalScore < config.AI_FALLBACK_MIN_SCORE) return false;
  if (type === "continuity") return readiness >= config.AI_FALLBACK_MIN_READINESS;
  return type === "bridge";
}

// Type pédagogique d'un candidat issu du graphe (continuité vs pont) —
// jamais utilisé pour les candidats de découverte, taggés 'discovery'
// directement par l'appelant puisqu'ils n'ont par construction aucun voisin
// acquis.
function classifyGraphRecommendationType({ distinctSolarCount = 0, readiness = 0 }, config) {
  if (distinctSolarCount >= config.BRIDGE_TYPE_MIN_CLUSTERS) return "bridge";
  if (readiness > 0) return "continuity";
  return "discovery";
}

// Explicabilité (section 11) : templates déterministes, jamais un appel LLM.
function buildReason({ type, neighborNames = [], clusterNames = [], connectionCount = 0, importanceTier, coldStart = false }) {
  if (type === "bridge") {
    const [a, b] = clusterNames;
    const reasonText = a && b
      ? `Crée un pont entre ${a} et ${b}.`
      : `Relie plusieurs connaissances que tu maîtrises déjà (${connectionCount}).`;
    return { reasonType: "bridge", reasonData: { connections: connectionCount, clusters: clusterNames }, reasonText };
  }
  if (type === "continuity") {
    const primary = neighborNames[0];
    const reasonText = connectionCount > 1
      ? `Tu maîtrises déjà ${connectionCount} connaissances qui y mènent directement.`
      : (primary ? `Prolonge tes connaissances sur ${primary}.` : "S'appuie sur une connaissance que tu maîtrises déjà.");
    return { reasonType: "continuity", reasonData: { connections: connectionCount, neighbors: neighborNames }, reasonText };
  }
  const reasonText = coldStart
    ? "Une connaissance solide pour commencer à construire ta mémoire."
    : (importanceTier === "fondamental"
      ? "Connaissance fondamentale à découvrir, hors de tes sujets habituels."
      : "Ouvre une nouvelle branche proche de tes connaissances actuelles.");
  return { reasonType: "discovery", reasonData: { importanceTier: importanceTier || null }, reasonText };
}

// Assemble la liste finale à partir de candidats déjà scorés
// ({ key, type, finalScore, solarSystemId, ... }) en respectant au mieux le
// mix cible (mixRatios) et un plafond par Solar (maxPerSolar) — sans jamais
// renvoyer moins d'éléments que disponibles juste pour respecter le mix, et
// sans jamais dépasser le plafond de diversité tant qu'une alternative
// existe.
function assembleRecommendations(scoredCandidates, { limit, mixRatios, maxPerSolar }) {
  const byType = { continuity: [], bridge: [], discovery: [] };
  for (const candidate of scoredCandidates) {
    (byType[candidate.type] || byType.discovery).push(candidate);
  }
  for (const key of Object.keys(byType)) {
    byType[key].sort((a, b) => b.finalScore - a.finalScore);
  }

  const targets = {
    continuity: Math.round(limit * mixRatios.continuity),
    bridge: Math.round(limit * mixRatios.bridge)
  };
  targets.discovery = Math.max(0, limit - targets.continuity - targets.bridge);

  const solarCounts = new Map();
  const pickedKeys = new Set();
  const picked = [];

  function tryPick(candidate, respectCap) {
    if (pickedKeys.has(candidate.key)) return false;
    const solarKey = candidate.solarSystemId || "unknown";
    const count = solarCounts.get(solarKey) || 0;
    if (respectCap && count >= maxPerSolar) return false;
    picked.push(candidate);
    pickedKeys.add(candidate.key);
    solarCounts.set(solarKey, count + 1);
    return true;
  }

  for (const type of ["continuity", "bridge", "discovery"]) {
    let need = targets[type];
    for (const candidate of byType[type]) {
      if (need <= 0) break;
      if (tryPick(candidate, true)) need -= 1;
    }
  }

  if (picked.length < limit) {
    const remaining = scoredCandidates
      .filter((c) => !pickedKeys.has(c.key))
      .sort((a, b) => b.finalScore - a.finalScore);
    for (const candidate of remaining) {
      if (picked.length >= limit) break;
      tryPick(candidate, true);
    }
  }

  if (picked.length < limit) {
    const remaining = scoredCandidates
      .filter((c) => !pickedKeys.has(c.key))
      .sort((a, b) => b.finalScore - a.finalScore);
    for (const candidate of remaining) {
      if (picked.length >= limit) break;
      tryPick(candidate, false);
    }
  }

  return picked.sort((a, b) => b.finalScore - a.finalScore).slice(0, limit);
}

module.exports = {
  clamp01,
  round4,
  computeImportanceScore,
  computePopularityScore,
  computeImportanceTier,
  computeNeighborhoodMastery,
  computeZpdScore,
  computeTooFarPenalty,
  computeConnectionScore,
  computeBridgeScore,
  computeInterestScore,
  computeNoveltyScore,
  computeDiscoveryScore,
  computeFinalScore,
  computeSaturationPenalty,
  passesRelevanceGate,
  classifyGraphRecommendationType,
  buildReason,
  assembleRecommendations
};
