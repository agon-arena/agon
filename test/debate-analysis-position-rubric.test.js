"use strict";

// Couvre la restructuration du barème des arènes à position (13/09/2026, "améliorer la
// notation IA de la qualité argumentative") : fusion des anciens critères "Qualité du
// raisonnement" (/30) et "Précision / mécanisme concret" (/20) en un critère "Solidité ou
// justification" (/25), et ajout d'un nouveau critère "Apport à l'arène" (/25), aligné sur
// OPEN_CRITERIA qui l'avait déjà pour les arènes libres. Fonctions PURES et déterministes
// uniquement (aucun réseau, aucun appel IA) — la qualité réelle des notes produites par le
// prompt ne peut être vérifiée qu'en appelant l'IA (cf. scripts/compare-position-scoring.js,
// résultats consignés dans le rapport livré avec ce chantier).

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  POSITION_CRITERIA,
  OPEN_CRITERIA,
  SCORING_RUBRIC_VERSION,
  toCategory,
  resolveEffectiveArgs,
  computeScoringHash,
  buildP2
} = require("../lib/debate-analysis");

function sumMax(criteria) {
  return criteria.reduce((s, c) => s + c.max, 0);
}

test("POSITION_CRITERIA : le total des maxima reste 100 points", () => {
  assert.equal(sumMax(POSITION_CRITERIA), 100);
});

test("POSITION_CRITERIA : nouveau critère \"Apport à l'arène\" à 25 points (absent avant le 13/09/2026)", () => {
  const apport = POSITION_CRITERIA.find((c) => c.key === "precision");
  assert.ok(apport, "le critère porté par la clé 'precision' doit exister");
  assert.equal(apport.label, "Apport à l'arène");
  assert.equal(apport.max, 25);
});

test("POSITION_CRITERIA : \"Solidité ou justification\" à 25 points (fusion de l'ancien raisonnement/30 + précision/20 = 50)", () => {
  const solidite = POSITION_CRITERIA.find((c) => c.key === "reasoning");
  assert.ok(solidite);
  assert.equal(solidite.label, "Solidité ou justification");
  assert.equal(solidite.max, 25);
});

test("POSITION_CRITERIA : Pertinence, Clarté, Nuance et Ton restent inchangés (20/15/10/5)", () => {
  const byKey = Object.fromEntries(POSITION_CRITERIA.map((c) => [c.key, c.max]));
  assert.equal(byKey.pertinence, 20);
  assert.equal(byKey.clarity, 15);
  assert.equal(byKey.nuance, 10);
  assert.equal(byKey.tone, 5);
});

test("OPEN_CRITERIA : non régression — reste strictement inchangé (100 points, Solidité/25 + Apport/25 déjà présents avant ce chantier)", () => {
  assert.equal(sumMax(OPEN_CRITERIA), 100);
  const byKey = Object.fromEntries(OPEN_CRITERIA.map((c) => [c.key, c]));
  assert.equal(byKey.reasoning.label, "Solidité ou justification");
  assert.equal(byKey.reasoning.max, 25);
  assert.equal(byKey.precision.label, "Apport à l'arène");
  assert.equal(byKey.precision.max, 25);
});

test("toCategory : non régression — les 4 frontières historiques (faible/moyen/bon/excellent) sont inchangées malgré la restructuration du barème", () => {
  assert.equal(toCategory(0), "faible");
  assert.equal(toCategory(49), "faible");
  assert.equal(toCategory(50), "moyen");
  assert.equal(toCategory(69), "moyen");
  assert.equal(toCategory(70), "bon");
  assert.equal(toCategory(84), "bon");
  assert.equal(toCategory(85), "excellent");
  assert.equal(toCategory(100), "excellent");
});

test("SCORING_RUBRIC_VERSION : incrémenté à 7 (force la renotation de toutes les contributions existantes sous l'ancien barème v6)", () => {
  assert.equal(SCORING_RUBRIC_VERSION, 7);
});

test("computeScoringHash : change quand les maxima du barème changent (garantit qu'aucune ancienne note v6 n'est réutilisée telle quelle sous le nouveau barème)", () => {
  const oldGrid = { type: "position", totalQuality: 100, criteria: [
    { key: "pertinence", max: 20 }, { key: "clarity", max: 15 },
    { key: "reasoning", max: 30 }, { key: "precision", max: 20 },
    { key: "nuance", max: 10 }, { key: "tone", max: 5 }
  ] };
  const newGrid = { type: "position", totalQuality: 100, criteria: POSITION_CRITERIA };
  const arg = { text: "Un argument identique dans les deux cas.", source_url: "" };
  const oldHash = computeScoringHash(oldGrid, "Question ?", "", "", "A", arg);
  const newHash = computeScoringHash(newGrid, "Question ?", "", "", "A", arg);
  assert.notEqual(oldHash, newHash);
});

test("buildP2 : le prompt système généré contient bien les nouveaux critères et la distinction affirmation/proposition/justification", () => {
  const grid = { type: "position", totalQuality: 100, criteria: POSITION_CRITERIA, correctionStrictness: "normal" };
  const p2 = buildP2("Faut-il X ?", "Camp A", { id: "1", text: "Un argument." }, grid);
  assert.ok(p2.system.includes("Apport à l'arène — /25"), "le nouveau critère Apport doit apparaître");
  assert.ok(p2.system.includes("Solidité ou justification — /25"), "le critère fusionné Solidité doit apparaître");
  assert.ok(p2.system.includes("proposition_sans_justification"), "le nouveau champ diagnostic doit apparaître");
  assert.ok(p2.system.includes("une proposition :"), "la distinction affirmation/proposition/justification doit apparaître");
  assert.ok(p2.system.includes("Solidité ou justification : /25"), "la grille formatée (formatGrid) doit refléter le nouveau barème");
});

// ── resolveEffectiveArgs : garde-fou "niveau de développement comparable" ──────────────
// Reprend le cas réel identifié la veille (débat "voile", id 3223) comme fixture : un
// argument en 4 points (600 caractères) fusionné à tort par l'IA avec 3 relances de 2
// phrases (~200 caractères chacune) sous une étiquette de groupe générique par thème.

const REP_TEXT = "Pourquoi une telle mesure ? Elle est à la fois inutile, stigmatisante, infaisable et anticonstitutionnelle. Inutile : quel intérêt ? En quoi cela va-t-il améliorer le quotidien des français ? Stigmatisante : s'en prendre à la communauté musulmane peut entraîner un repli identitaire de leur part. Infaisable : comment les policiers distingueront les femmes voilées musulmanes des femmes voilées pour d'autres motifs (protection contre la chaleur, cacher calvitie dune chimio etc.). Anticonstitutionnelle : la liberté religieuse est une liberté fondamentale, la discrimination est strictement interdite.";
const SHORT_TEXT_1 = "Le voile, c'est une affaire perso, pas à l'Etat de juger ce que les gens portent. Interdire dans l'espace public, ça ouvre la porte à un contrôle social absurde et ça divise encore plus la société.";
const SHORT_TEXT_2 = "Si on commence à dire ce qu'on peut porter dehors, où s'arrête le truc? Demain on interdit les signes religieux ailleurs. On stigmatise des femmes juste parce qu'elles portent quelque chose sur la tête.";
const SHORT_TEXT_3 = "Chacun est libre de s'habiller comme il veut. Le droit de porter le voile, c'est une expression religieuse protégée. Interdire dans l'espace public, c'est une intrusion pédagogique dans la vie privée.";

test("resolveEffectiveArgs : un groupe fusionnant un argument développé avec 3 relances 3x plus courtes exclut ces 3 relances (cas réel débat 3223)", () => {
  const args = [
    { id: "19162", text: REP_TEXT, votes: 8, source_url: "" },
    { id: "18483", text: SHORT_TEXT_1, votes: 8, source_url: "" },
    { id: "18484", text: SHORT_TEXT_2, votes: 5, source_url: "" },
    { id: "18485", text: SHORT_TEXT_3, votes: 10, source_url: "" }
  ];
  const dupResult = {
    groups: [{
      representativeArgumentId: "19162",
      mergedArgumentIds: ["19162", "18483", "18484", "18485"]
    }],
    uniqueArguments: []
  };
  const effective = resolveEffectiveArgs(dupResult, args);
  const ids = effective.map((a) => a.id).sort();
  assert.deepEqual(ids, ["18483", "18484", "18485", "19162"], "les 4 arguments doivent rester présents dans la liste effective (aucun perdu)");
  // Le groupe restant après extraction des 3 relances ne contient plus que le représentant
  // seul (count === 1) : resolveEffectiveArgs ne rapporte alors aucune fusion (merged_count
  // reste absent), exactement comme pour un argument jamais groupé — plus aucun des 4 ne doit
  // porter merged_count > 1.
  effective.forEach((a) => {
    assert.ok(!a.merged_count || a.merged_count <= 1, `${a.id} ne doit plus apparaître comme membre d'une fusion réelle`);
  });
});

test("resolveEffectiveArgs : un groupe dont les membres ont une longueur comparable reste fusionné normalement", () => {
  const repText = "Cette mesure est inefficace car elle ne cible qu'une partie du problème sans s'attaquer à sa cause réelle.";
  const similarText = "Cette réforme est incomplète : elle traite un symptôme visible sans jamais s'attaquer à la cause profonde du problème.";
  const args = [
    { id: "1", text: repText, votes: 3, source_url: "" },
    { id: "2", text: similarText, votes: 4, source_url: "" }
  ];
  const dupResult = {
    groups: [{ representativeArgumentId: "1", mergedArgumentIds: ["1", "2"] }],
    uniqueArguments: []
  };
  const effective = resolveEffectiveArgs(dupResult, args);
  assert.equal(effective.length, 1, "deux arguments de longueur comparable doivent rester fusionnés en un seul");
  assert.equal(effective[0].id, "1");
  assert.equal(effective[0].merged_count, 2);
  assert.equal(effective[0].merged_votes, 7);
});
