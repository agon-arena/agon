"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const scoring = require("../lib/learn-next/scoring");
const config = require("../lib/learn-next/config");

test("les poids du score final somment à 1 (base produit centralisée)", () => {
  const sum = Object.values(config.RECOMMENDATION_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `somme des poids = ${sum}`);
});

test("ZPD/readiness : un candidat avec 4/5 voisins acquis (mastery 1) bat un candidat 0/5", () => {
  const strong = scoring.computeNeighborhoodMastery({ neighborMasteries: [1, 1, 1, 1], candidateLinkDegree: 5 });
  const weak = scoring.computeNeighborhoodMastery({ neighborMasteries: [], candidateLinkDegree: 5 });
  const strongScore = scoring.computeZpdScore(strong, config.ZPD_IDEAL_ZONE);
  const weakScore = scoring.computeZpdScore(weak, config.ZPD_IDEAL_ZONE);
  assert.ok(strongScore > weakScore);
  assert.equal(weakScore, 0);
  // 4/5 = 0.8, dans la zone idéale [0.6, 0.9] : score nettement au-dessus de la moyenne.
  assert.ok(strongScore > 0.8);
});

test("readiness quasi nulle est fortement pénalisée (zpd_score proche de 0)", () => {
  const readiness = scoring.computeNeighborhoodMastery({ neighborMasteries: [0.05], candidateLinkDegree: 10 });
  const score = scoring.computeZpdScore(readiness, config.ZPD_IDEAL_ZONE);
  assert.ok(score < 0.1);
});

test("au-delà de la zone idéale (presque redondant), le zpd_score redescend mais reste positif", () => {
  const inZone = scoring.computeZpdScore(0.85, config.ZPD_IDEAL_ZONE);
  const beyond = scoring.computeZpdScore(0.99, config.ZPD_IDEAL_ZONE);
  assert.ok(beyond < inZone);
  assert.ok(beyond > 0);
});

test("FSRS : un voisin fortement stabilisé (retrievability haute) contribue plus qu'un voisin fragile", () => {
  const solidReadiness = scoring.computeNeighborhoodMastery({ neighborMasteries: [0.95], candidateLinkDegree: 1 });
  const fragileReadiness = scoring.computeNeighborhoodMastery({ neighborMasteries: [0.2], candidateLinkDegree: 1 });
  assert.ok(solidReadiness > fragileReadiness);

  const solidConnection = scoring.computeConnectionScore([{ mastery: 0.95, solarSystemId: 1 }], config.CONNECTIONS_SATURATION_K);
  const fragileConnection = scoring.computeConnectionScore([{ mastery: 0.2, solarSystemId: 1 }], config.CONNECTIONS_SATURATION_K);
  assert.ok(solidConnection > fragileConnection);
});

test("connection_score : plus de voisins acquis (bien maîtrisés) donne un meilleur score, avec rendements décroissants au sein d'une même branche", () => {
  const oneNeighbor = scoring.computeConnectionScore([{ mastery: 0.9, solarSystemId: 1 }], config.CONNECTIONS_SATURATION_K);
  const fourNeighbors = scoring.computeConnectionScore([
    { mastery: 0.9, solarSystemId: 1 }, { mastery: 0.9, solarSystemId: 1 },
    { mastery: 0.9, solarSystemId: 1 }, { mastery: 0.9, solarSystemId: 1 }
  ], config.CONNECTIONS_SATURATION_K);
  assert.ok(fourNeighbors > oneNeighbor);
  assert.ok(fourNeighbors < oneNeighbor * 4);
});

test("connection_score : saturé PAR branche puis sommé — répartir les mêmes voisins sur 2 branches n'est jamais pénalisé par rapport à 1 seule branche", () => {
  const oneBranch = scoring.computeConnectionScore([
    { mastery: 0.9, solarSystemId: 1 }, { mastery: 0.9, solarSystemId: 1 }
  ], config.CONNECTIONS_SATURATION_K);
  const twoBranches = scoring.computeConnectionScore([
    { mastery: 0.9, solarSystemId: 1 }, { mastery: 0.9, solarSystemId: 2 }
  ], config.CONNECTIONS_SATURATION_K);
  // Même masse totale de mastery (1.8), mais répartie sur 2 branches : la
  // concavité de la saturation par groupe fait que ça ne peut jamais être
  // pire que tout concentrer dans une seule branche (souvent mieux).
  assert.ok(twoBranches >= oneBranch);
});

test("BridgeScore : 2 branches distinctes bat 1 seule branche, à connexions égales — et ne peut pas être rattrapé par un simple comptage de connexions", () => {
  // Candidate A (section 3 de la revue) : 5 connexions dans UN seul Solar.
  const aConnections = Array.from({ length: 5 }, () => ({ mastery: 0.9, solarSystemId: 1 }));
  const aBridge = scoring.computeBridgeScore({ distinctSolarCount: 1, distinctStarCount: 1 }, config);
  const aConnectionScore = scoring.computeConnectionScore(aConnections, config.CONNECTIONS_SATURATION_K);

  // Candidate B : seulement 2 connexions, mais dans 2 Solars distincts.
  const bConnections = [{ mastery: 0.9, solarSystemId: 1 }, { mastery: 0.9, solarSystemId: 2 }];
  const bBridge = scoring.computeBridgeScore({ distinctSolarCount: 2, distinctStarCount: 2 }, config);
  const bConnectionScore = scoring.computeConnectionScore(bConnections, config.CONNECTIONS_SATURATION_K);

  assert.ok(bBridge > aBridge, "le bridge_score de B (2 branches) doit dépasser celui de A (1 branche)");

  // La combinaison pondérée (bridge 0.15 + connections 0.25) doit favoriser
  // B malgré ses 3 connexions de moins — c'est le test central de la revue
  // du 27/08/2026 (§3) : bridge_score ne doit pas être un simple 2e
  // compteur de connexions noyé par un connection_score qui pile tout dans
  // une seule branche.
  const aCombined = 0.25 * aConnectionScore + 0.15 * aBridge;
  const bCombined = 0.25 * bConnectionScore + 0.15 * bBridge;
  assert.ok(bCombined > aCombined, `B (${bCombined}) doit dépasser A (${aCombined})`);
});

test("BridgeScore : petit bonus de diversité de Stars, jamais dominant face aux Solars distincts", () => {
  const withoutStarDiversity = scoring.computeBridgeScore({ distinctSolarCount: 1, distinctStarCount: 1 }, config);
  const withStarDiversity = scoring.computeBridgeScore({ distinctSolarCount: 1, distinctStarCount: 4 }, config);
  assert.ok(withStarDiversity > withoutStarDiversity);
  // Même avec beaucoup de Stars, un mono-Solar ne doit jamais dépasser un vrai
  // pont à 2 Solars.
  const trueBridge = scoring.computeBridgeScore({ distinctSolarCount: 2, distinctStarCount: 2 }, config);
  assert.ok(trueBridge > withStarDiversity);
});

test("BridgeScore : palier au-delà de la table (jamais d'index hors bornes)", () => {
  const score = scoring.computeBridgeScore({ distinctSolarCount: 50, distinctStarCount: 50 }, config);
  const maxTable = config.BRIDGE_SCORE_BY_DISTINCT_CLUSTERS[config.BRIDGE_SCORE_BY_DISTINCT_CLUSTERS.length - 1];
  assert.ok(score >= maxTable);
});

test("too_far_penalty : gradué (pas une exclusion binaire), nul pour un pont même à faible readiness", () => {
  const farPenalty = scoring.computeTooFarPenalty(0.02, 1, config);
  const closerPenalty = scoring.computeTooFarPenalty(0.10, 1, config);
  assert.ok(farPenalty > closerPenalty, "plus on est loin de la zone, plus la pénalité est forte");
  assert.ok(farPenalty > 0 && farPenalty <= config.TOO_FAR_MAX_PENALTY);

  const okPenalty = scoring.computeTooFarPenalty(config.TOO_FAR_READINESS_THRESHOLD, 1, config);
  assert.equal(okPenalty, 0);

  // Un pont (>= BRIDGE_TYPE_MIN_CLUSTERS branches distinctes) est exempté
  // même à readiness très faible.
  const bridgeExempt = scoring.computeTooFarPenalty(0.01, config.BRIDGE_TYPE_MIN_CLUSTERS, config);
  assert.equal(bridgeExempt, 0);
});

test("Importance (log1p) : croissante, plafonnée, et une popularité massive n'écrase pas une connaissance simplement bien connectée", () => {
  const low = scoring.computeImportanceScore({ linkDegree: 0, acquisitionCount: 0 }, config);
  assert.equal(low, 0);

  const modest = scoring.computeImportanceScore({ linkDegree: 3, acquisitionCount: 500 }, config);
  const massivelyPopular = scoring.computeImportanceScore({ linkDegree: 3, acquisitionCount: 50000 }, config);
  // Les deux plafonnent au même score maximal : la popularité brute au-delà
  // de l'ancre ne distingue plus les candidats entre eux (revue du
  // 27/08/2026, section 4) — jamais un pur effet de volume qui écrase une
  // connaissance structurante mais moins répandue.
  assert.equal(modest, massivelyPopular);

  assert.equal(scoring.computeImportanceTier(1, config.IMPORTANCE_TIER_THRESHOLDS), "fondamental");
  assert.equal(scoring.computeImportanceTier(low, config.IMPORTANCE_TIER_THRESHOLDS), "secondaire");
});

test("Importance (log1p) : croissance plus généreuse près de zéro qu'un simple ratio linéaire", () => {
  const oneAcquisition = scoring.computeImportanceScore({ linkDegree: 0, acquisitionCount: 1 }, config);
  const linearEquivalent = 1 / config.IMPORTANCE_ACQUISITION_COUNT_ANCHOR / 2; // ce qu'aurait donné un simple ratio linéaire plafonné (poids 0.5)
  assert.ok(oneAcquisition > linearEquivalent);
});

test("Découverte : nouveauté continue — Solar jamais rencontré > peu présent > très présent, jamais une exclusion binaire", () => {
  const neverSeen = scoring.computeNoveltyScore({ solarAcquisitionCount: 0, totalAcquisitions: 10 });
  const lightlySeen = scoring.computeNoveltyScore({ solarAcquisitionCount: 1, totalAcquisitions: 10 });
  const heavilySeen = scoring.computeNoveltyScore({ solarAcquisitionCount: 9, totalAcquisitions: 10 });
  assert.equal(neverSeen, 1);
  assert.ok(neverSeen > lightlySeen);
  assert.ok(lightlySeen > heavilySeen);
  assert.ok(heavilySeen > 0, "jamais totalement exclu, seulement atténué");

  const discoveryNever = scoring.computeDiscoveryScore({ novelty: neverSeen, importanceScore: 0.5 }, config);
  const discoveryHeavy = scoring.computeDiscoveryScore({ novelty: heavilySeen, importanceScore: 0.5 }, config);
  assert.ok(discoveryNever > discoveryHeavy);
  assert.ok(discoveryHeavy > 0, "un Solar très présent garde un plancher de découverte, jamais 0");
});

test("Saturation : une série excessive d'un même Solar est pénalisée, une répétition modérée ne l'est pas", () => {
  const counts = new Map([[42, 5]]);
  const penalty = scoring.computeSaturationPenalty(42, counts, config.SATURATION);
  assert.ok(penalty > 0);
  const noPenalty = scoring.computeSaturationPenalty(42, new Map([[42, 1]]), config.SATURATION);
  assert.equal(noPenalty, 0);
  const unknownSolar = scoring.computeSaturationPenalty(null, counts, config.SATURATION);
  assert.equal(unknownSolar, 0);
});

test("assembleRecommendations : une petite proportion de découverte apparaît même quand la continuité domine", () => {
  const continuity = Array.from({ length: 20 }, (_, i) => ({
    key: `continuity-${i}`, type: "continuity", finalScore: 0.9 - i * 0.01, solarSystemId: 1
  }));
  const discovery = [{ key: "discovery-1", type: "discovery", finalScore: 0.3, solarSystemId: 99 }];
  const picked = scoring.assembleRecommendations([...continuity, ...discovery], {
    limit: 10,
    mixRatios: config.MIX_RATIOS,
    maxPerSolar: config.MAX_PER_SOLAR_IN_RESPONSE
  });
  assert.equal(picked.length, 10);
  assert.ok(picked.some((p) => p.type === "discovery"));
});

test("assembleRecommendations : le plafond de diversité par Solar est respecté quand assez d'alternatives existent", () => {
  const bySolar = (solarSystemId, baseScore) => Array.from({ length: 5 }, (_, i) => ({
    key: `s${solarSystemId}-${i}`, type: "continuity", finalScore: baseScore - i * 0.01, solarSystemId
  }));
  const candidates = [...bySolar(1, 0.95), ...bySolar(2, 0.85), ...bySolar(3, 0.75)];
  const picked = scoring.assembleRecommendations(candidates, {
    limit: 6,
    mixRatios: { continuity: 1, bridge: 0, discovery: 0 },
    maxPerSolar: 2
  });
  assert.equal(picked.length, 6);
  for (const solarId of [1, 2, 3]) {
    assert.ok(picked.filter((p) => p.solarSystemId === solarId).length <= 2);
  }
});

test("assembleRecommendations : ne renvoie jamais moins d'éléments que disponibles pour respecter le mix", () => {
  const onlyDiscovery = [
    { key: "d1", type: "discovery", finalScore: 0.5, solarSystemId: 1 },
    { key: "d2", type: "discovery", finalScore: 0.4, solarSystemId: 2 }
  ];
  const picked = scoring.assembleRecommendations(onlyDiscovery, {
    limit: 10,
    mixRatios: config.MIX_RATIOS,
    maxPerSolar: config.MAX_PER_SOLAR_IN_RESPONSE
  });
  assert.equal(picked.length, 2);
});

test("classifyGraphRecommendationType : pont dès le seuil de branches distinctes configuré", () => {
  const bridgeType = scoring.classifyGraphRecommendationType({ distinctSolarCount: config.BRIDGE_TYPE_MIN_CLUSTERS, readiness: 0.5 }, config);
  assert.equal(bridgeType, "bridge");
  const continuityType = scoring.classifyGraphRecommendationType({ distinctSolarCount: 1, readiness: 0.5 }, config);
  assert.equal(continuityType, "continuity");
});

test("buildReason : templates déterministes sans dépendance réseau", () => {
  const bridge = scoring.buildReason({ type: "bridge", clusterNames: ["Antiquité romaine", "Christianisme"], connectionCount: 2 });
  assert.match(bridge.reasonText, /pont entre Antiquité romaine et Christianisme/);
  const continuity = scoring.buildReason({ type: "continuity", neighborNames: ["ADN"], connectionCount: 1 });
  assert.match(continuity.reasonText, /ADN/);
  const coldStartDiscovery = scoring.buildReason({ type: "discovery", coldStart: true });
  assert.match(coldStartDiscovery.reasonText, /commencer/);
});
