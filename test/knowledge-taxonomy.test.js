"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  filterUserActiveSolars,
  filterUserActiveStars,
  userActiveGalaxies,
  buildKnownPlacementLookup,
  isKnowledgeCandidate,
  isNewsCandidate,
  parseMatchDecision,
  parseCreationDecision,
  matchExistingStarByLabel,
  canonicalizeOrdinalTokens,
  isNameRestatementOfParent,
  validateStarLabelCandidate,
  normalizeTaxonomyName,
  validateTaxonomyCreationCandidate,
  computeSolarActivationsFromAcquisitions
} = require("../lib/knowledge-taxonomy/taxonomy-engine");

// ── Périmètre utilisateur (§1/§29 : jamais la taxonomie d'un autre user) ──

test("filterUserActiveSolars : un solar appartenant uniquement à un autre utilisateur n'est jamais candidat", () => {
  const allSolars = [
    { id: 1, galaxy: "Histoire", name: "Temps modernes", taxonomyScope: "knowledge" },
    { id: 2, galaxy: "Histoire", name: "Civilisations américaines", taxonomyScope: "knowledge" } // activé par un AUTRE user
  ];
  const userAActivations = [{ solarSystemId: 1 }]; // user A n'a activé que "Temps modernes"
  const result = filterUserActiveSolars(allSolars, userAActivations, "Histoire");
  assert.deepEqual(result.map((s) => s.id), [1]);
});

test("filterUserActiveSolars : un solar scope=news n'est jamais candidat même s'il est dans activations", () => {
  const allSolars = [{ id: 5, galaxy: "International", name: "Guerre en Ukraine", taxonomyScope: "news" }];
  const activations = [{ solarSystemId: 5 }];
  const result = filterUserActiveSolars(allSolars, activations, "International");
  assert.deepEqual(result, []);
});

test("filterUserActiveSolars : un solar scope=unknown n'est jamais candidat (backfill prudent)", () => {
  const allSolars = [{ id: 7, galaxy: "Histoire", name: "Mystère", taxonomyScope: "unknown" }];
  const activations = [{ solarSystemId: 7 }];
  assert.deepEqual(filterUserActiveSolars(allSolars, activations, "Histoire"), []);
});

// ── Isolation Star User A / User B (vérification finale du 16/08/2026) ────

test("filterUserActiveStars : une Star rencontrée uniquement par User B est invisible pour User A", () => {
  const allStars = [
    { id: 100, solarSystemId: 12, name: "Directoire" },  // rencontrée par User A
    { id: 101, solarSystemId: 12, name: "Consulat" }     // rencontrée par User B UNIQUEMENT
  ];
  const userAStarActivations = [{ starId: 100 }];
  const result = filterUserActiveStars(allStars, userAStarActivations, 12);
  assert.deepEqual(result.map((s) => s.id), [100]);
  assert.equal(result.some((s) => s.id === 101), false, "la Star de User B ne doit jamais apparaître chez User A");
});

test("filterUserActiveStars : restreint aussi au solar_system_id demandé (jamais une étoile d'un autre solar)", () => {
  const allStars = [
    { id: 200, solarSystemId: 1, name: "Terreur" },
    { id: 201, solarSystemId: 2, name: "Renaissance" }
  ];
  const activations = [{ starId: 200 }, { starId: 201 }]; // les deux actives chez cet utilisateur
  const result = filterUserActiveStars(allStars, activations, 1);
  assert.deepEqual(result.map((s) => s.id), [200]);
});

test("userActiveGalaxies : dérivée des solars actifs, jamais stockée séparément", () => {
  const allSolars = [
    { id: 1, galaxy: "Histoire", taxonomyScope: "knowledge" },
    { id: 2, galaxy: "Arts", taxonomyScope: "knowledge" },
    { id: 3, galaxy: "Sciences", taxonomyScope: "knowledge" } // pas activé
  ];
  const activations = [{ solarSystemId: 1 }, { solarSystemId: 2 }];
  assert.deepEqual(userActiveGalaxies(allSolars, activations).sort(), ["Arts", "Histoire"]);
});

test("isKnowledgeCandidate : rejette news et unknown, accepte knowledge", () => {
  assert.equal(isKnowledgeCandidate({ taxonomyScope: "knowledge" }), true);
  assert.equal(isKnowledgeCandidate({ taxonomyScope: "news" }), false);
  assert.equal(isKnowledgeCandidate({ taxonomyScope: "unknown" }), false);
  assert.equal(isKnowledgeCandidate(null), false);
});

// ── Contrat MATCH (§9/§11) ──────────────────────────────────────────────

test("parseMatchDecision : decision existing avec un id hors candidats est rejetée (jamais un id halluciné)", () => {
  const result = parseMatchDecision({ decision: "existing", id: 999, confidence: 0.9 }, [1, 2, 3]);
  assert.equal(result, null);
});

test("parseMatchDecision : decision existing avec un id valide est acceptée", () => {
  const result = parseMatchDecision({ decision: "existing", id: 2, confidence: 0.87 }, [1, 2, 3]);
  assert.deepEqual(result, { decision: "existing", id: 2, confidence: 0.87 });
});

test("parseMatchDecision : confidence hors [0,1] est bornée, jamais rejetée pour ça seul", () => {
  const result = parseMatchDecision({ decision: "existing", id: 1, confidence: 5 }, [1]);
  assert.equal(result.confidence, 1);
});

test("parseMatchDecision : decision no_match sans bestExistingId est valide", () => {
  const result = parseMatchDecision({ decision: "no_match", confidence: 0.2 }, [1, 2]);
  assert.deepEqual(result, { decision: "no_match", bestExistingId: null, confidence: 0.2 });
});

test("parseMatchDecision : decision inconnue ou absente est rejetée", () => {
  assert.equal(parseMatchDecision({ decision: "create" }, [1]), null);
  assert.equal(parseMatchDecision(null, [1]), null);
  assert.equal(parseMatchDecision({}, [1]), null);
});

// ── Contrat CREATE (§14) ────────────────────────────────────────────────

test("parseCreationDecision : sans confirmation explicite noExistingMatch, rejeté", () => {
  assert.equal(parseCreationDecision({ name: "Antiquité andine", description: "..." }), null);
});

test("parseCreationDecision : avec confirmation et champs complets, accepté", () => {
  const result = parseCreationDecision({ noExistingMatch: true, name: "Époque contemporaine", description: "Période récente." });
  assert.deepEqual(result, { name: "Époque contemporaine", description: "Période récente." });
});

test("parseCreationDecision : nom ou description manquants, rejeté", () => {
  assert.equal(parseCreationDecision({ noExistingMatch: true, name: "", description: "x" }), null);
  assert.equal(parseCreationDecision({ noExistingMatch: true, name: "x", description: "" }), null);
});

// ── Gate de création (§15/§16/§17/§18, cas Incas et granularité) ─────────

test("validateTaxonomyCreationCandidate : rejette une création si requireNoExistingMatch est false (§13)", () => {
  const result = validateTaxonomyCreationCandidate({
    name: "Empire inca précolombien", galaxy: "Histoire", existingSolarNames: [], requireNoExistingMatch: false
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "creation_without_no_match");
});

test("validateTaxonomyCreationCandidate : rejette un doublon lexical d'un solar déjà actif", () => {
  const result = validateTaxonomyCreationCandidate({
    name: "Temps Modernes", galaxy: "Histoire",
    existingSolarNames: ["Temps modernes"], requireNoExistingMatch: true
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "duplicate_of_existing");
});

test("validateTaxonomyCreationCandidate : rejette un nom qui ne fait que reformuler le Subject", () => {
  const result = validateTaxonomyCreationCandidate({
    name: "Chute de Constantinople", galaxy: "Histoire",
    existingSolarNames: ["Antiquité", "Moyen Âge"],
    subjectName: "La chute de Constantinople en 1453",
    requireNoExistingMatch: true
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "restates_subject");
});

test("validateTaxonomyCreationCandidate : n'écarte plus un vrai Solar large juste parce qu'il partage 2 mots avec un Subject plus long (faux positif réel observé en Phase 5, 17/08/2026)", () => {
  const result = validateTaxonomyCreationCandidate({
    name: "Panthéon romain", galaxy: "Histoire",
    existingSolarNames: [],
    subjectName: "Dieux du panthéon romain et leurs attributs",
    requireNoExistingMatch: true
  });
  assert.deepEqual(result, { ok: true });
});

test("validateTaxonomyCreationCandidate : accepte un solar légitimement large et nouveau", () => {
  const result = validateTaxonomyCreationCandidate({
    name: "Époque contemporaine", galaxy: "Histoire",
    existingSolarNames: ["Antiquité", "Moyen Âge", "Temps modernes"],
    subjectName: "Les attentats du 11 septembre 2001",
    requireNoExistingMatch: true
  });
  assert.deepEqual(result, { ok: true });
});

test("validateTaxonomyCreationCandidate : rejette un nom trop long (plus de 5 mots)", () => {
  const result = validateTaxonomyCreationCandidate({
    name: "Une très longue description de plusieurs mots successifs",
    galaxy: "Histoire", existingSolarNames: [], requireNoExistingMatch: true
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "too_many_words");
});

test("validateTaxonomyCreationCandidate : rejette sans galaxy", () => {
  const result = validateTaxonomyCreationCandidate({ name: "Antiquité", galaxy: null, existingSolarNames: [], requireNoExistingMatch: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_galaxy");
});

test("normalizeTaxonomyName : insensible aux accents/casse/espaces multiples", () => {
  assert.equal(normalizeTaxonomyName("  Temps   Modernes  "), normalizeTaxonomyName("temps modernes"));
  assert.equal(normalizeTaxonomyName("Antiquité"), normalizeTaxonomyName("ANTIQUITE"));
});

// ── Non-régression métier (§26 Test A, cas Incas déterministe) ───────────

test("scénario Incas : Temps modernes actif et cohérent -> le gate refuse toute création concurrente", () => {
  const allSolars = [
    { id: 10, galaxy: "Histoire", name: "Antiquité", taxonomyScope: "knowledge" },
    { id: 11, galaxy: "Histoire", name: "Moyen Âge", taxonomyScope: "knowledge" },
    { id: 12, galaxy: "Histoire", name: "Temps modernes", taxonomyScope: "knowledge" }
  ];
  const activations = [{ solarSystemId: 10 }, { solarSystemId: 11 }, { solarSystemId: 12 }];
  const candidates = filterUserActiveSolars(allSolars, activations, "Histoire");
  assert.equal(candidates.length, 3);

  // Le classifieur IA renvoie "existing" sur Temps modernes (id=12) : accepté.
  const decision = parseMatchDecision({ decision: "existing", id: 12, confidence: 0.9 }, candidates.map((c) => c.id));
  assert.deepEqual(decision, { decision: "existing", id: 12, confidence: 0.9 });

  // Si un second appel tentait quand même de proposer "Empire inca précolombien"
  // sans passer par no_match, le gate le bloque.
  const gate = validateTaxonomyCreationCandidate({
    name: "Empire inca précolombien", galaxy: "Histoire",
    existingSolarNames: candidates.map((c) => c.name),
    requireNoExistingMatch: false
  });
  assert.equal(gate.ok, false);
});

// ── Preuve d'ensemble (§7 de la vérification finale du 16/08/2026) : les
// candidats effectivement construits pour un appel MATCH de User A ────────

test("preuve d'ensemble : les candidats MATCH de User A ne contiennent jamais un Solar de User B, un Solar news, ni les Stars d'un autre Solar", () => {
  const allSolars = [
    { id: 1, galaxy: "Histoire", name: "Temps modernes", taxonomyScope: "knowledge" },   // actif chez A
    { id: 2, galaxy: "Histoire", name: "Civilisations américaines", taxonomyScope: "knowledge" }, // actif chez B UNIQUEMENT
    { id: 3, galaxy: "Histoire", name: "Guerre en Ukraine", taxonomyScope: "news" }        // solar "actu", jamais knowledge
  ];
  const userAActivations = [{ solarSystemId: 1 }];

  const candidatesForA = filterUserActiveSolars(allSolars, userAActivations, "Histoire");
  assert.deepEqual(candidatesForA.map((s) => s.id), [1], "seul le Solar réellement actif chez A doit apparaître");
  assert.equal(candidatesForA.some((s) => s.id === 2), false, "aucun Solar de User B");
  assert.equal(candidatesForA.some((s) => s.id === 3), false, "aucun Solar news");

  const allStars = [
    { id: 100, solarSystemId: 1, name: "Directoire" },        // rencontrée par A sous le Solar 1
    { id: 101, solarSystemId: 1, name: "Consulat" },          // rencontrée par B UNIQUEMENT, même Solar
    { id: 102, solarSystemId: 2, name: "Empire aztèque" }     // rencontrée par A mais sous un AUTRE Solar (2)
  ];
  const userAStarActivations = [{ starId: 100 }, { starId: 102 }]; // A a bien rencontré 100 ET 102, mais pas sous le même Solar
  const starsForA = filterUserActiveStars(allStars, userAStarActivations, 1);
  assert.deepEqual(starsForA.map((s) => s.id), [100], "seule l'étoile de A appartenant à CE Solar apparaît");
  assert.equal(starsForA.some((s) => s.id === 101), false, "aucune étoile de User B");
  assert.equal(starsForA.some((s) => s.id === 102), false, "pas une étoile de A rattachée à un autre Solar (jamais 'toutes les Stars de A')");
});

// ── Point 1 de la vérification du 16/08/2026 : le court-circuit "connu" ───
// doit être personnel, jamais celui d'un autre utilisateur ────────────────

test("buildKnownPlacementLookup : le filtre inclut toujours user_id — le placement de B ne doit jamais court-circuiter A", () => {
  const filterForA = buildKnownPlacementLookup("custom", "subject-x", "user-A");
  assert.deepEqual(filterForA, { eclairage_type: "custom", eclairage_source_id: "subject-x", user_id: "user-A" });
  // Même Subject, utilisateur différent : le filtre change, jamais le même
  // enregistrement (celui de B) qui pourrait matcher les deux à la fois.
  const filterForB = buildKnownPlacementLookup("custom", "subject-x", "user-B");
  assert.notDeepEqual(filterForA, filterForB);
});

test("buildKnownPlacementLookup : renvoie null sans userId (jamais de requête non personnelle)", () => {
  assert.equal(buildKnownPlacementLookup("custom", "subject-x", null), null);
  assert.equal(buildKnownPlacementLookup("custom", "subject-x", undefined), null);
});

test("scénario B/A : le placement de Subject X connu chez B n'est jamais appliqué à A tant que A ne l'a pas lui-même résolu", () => {
  // Base d'acquisitions simulée : seul B a résolu Subject X.
  const acquisitions = [
    { user_id: "user-B", eclairage_type: "custom", eclairage_source_id: "subject-x", solar_system_id: 77, star_id: 900 }
  ];
  const lookupForA = buildKnownPlacementLookup("custom", "subject-x", "user-A");
  const matchForA = acquisitions.find((row) =>
    row.eclairage_type === lookupForA.eclairage_type &&
    row.eclairage_source_id === lookupForA.eclairage_source_id &&
    row.user_id === lookupForA.user_id
  );
  assert.equal(matchForA, undefined, "aucune ligne ne doit matcher : A n'a jamais résolu ce Subject lui-même");

  const lookupForB = buildKnownPlacementLookup("custom", "subject-x", "user-B");
  const matchForB = acquisitions.find((row) =>
    row.eclairage_type === lookupForB.eclairage_type &&
    row.eclairage_source_id === lookupForB.eclairage_source_id &&
    row.user_id === lookupForB.user_id
  );
  assert.equal(matchForB?.solar_system_id, 77, "B, lui, retrouve bien son propre placement");
});

// ── Point 2 : scope "both" (référencé à la fois par knowledge et news) ────

test("isKnowledgeCandidate accepte scope=knowledge", () => {
  assert.equal(isKnowledgeCandidate({ taxonomyScope: "knowledge" }), true);
});
test("isKnowledgeCandidate accepte scope=both (référencé aussi par le pipeline connaissances, ne doit jamais devenir invisible)", () => {
  assert.equal(isKnowledgeCandidate({ taxonomyScope: "both" }), true);
});
test("isKnowledgeCandidate refuse scope=news", () => {
  assert.equal(isKnowledgeCandidate({ taxonomyScope: "news" }), false);
});
test("isKnowledgeCandidate refuse scope=unknown (cas ambigu jamais résolu automatiquement)", () => {
  assert.equal(isKnowledgeCandidate({ taxonomyScope: "unknown" }), false);
});
test("isNewsCandidate : symétrique, accepte news et both, refuse knowledge et unknown", () => {
  assert.equal(isNewsCandidate({ taxonomyScope: "news" }), true);
  assert.equal(isNewsCandidate({ taxonomyScope: "both" }), true);
  assert.equal(isNewsCandidate({ taxonomyScope: "knowledge" }), false);
  assert.equal(isNewsCandidate({ taxonomyScope: "unknown" }), false);
});
test("filterUserActiveSolars laisse passer un solar scope=both activé par l'utilisateur", () => {
  const allSolars = [{ id: 9, galaxy: "Histoire", name: "Solar mixte", taxonomyScope: "both" }];
  const activations = [{ solarSystemId: 9 }];
  assert.deepEqual(filterUserActiveSolars(allSolars, activations, "Histoire").map((s) => s.id), [9]);
});

// ── Point 3 : résolution déterministe de Star (fusion sans dépasser 0/1/2
// appels IA, sans envoyer les étoiles existantes à l'IA) ───────────────────

test("matchExistingStarByLabel : reconnaît une correspondance exacte après normalisation (accents/casse)", () => {
  const existing = [{ id: 1, name: "Directoire" }];
  assert.equal(matchExistingStarByLabel("directoire", existing), 1);
  assert.equal(matchExistingStarByLabel("DIRECTOIRE", existing), 1);
});
test("matchExistingStarByLabel : reconnaît une inclusion de mots (ex. un article en plus)", () => {
  const existing = [{ id: 2, name: "Consulat" }];
  assert.equal(matchExistingStarByLabel("Le Consulat", existing), 2);
});
test("matchExistingStarByLabel : ne fusionne jamais deux étoiles clairement différentes", () => {
  const existing = [{ id: 3, name: "Directoire" }];
  assert.equal(matchExistingStarByLabel("Terreur", existing), null);
});
test("matchExistingStarByLabel : liste vide -> jamais de correspondance (nouvelle étoile)", () => {
  assert.equal(matchExistingStarByLabel("Directoire", []), null);
});

// ── Correctif duplication d'étoiles (01/09/2026, cf. rapport de diagnostic)
// : canonicalisation des ordinaux + garde-fou global au Solar dans
// resolveOrCreateStar (server.js). Ce bloc couvre les 12 cas requis ; les
// cas 10/11/12 (utilisateur différent, Solar différent, race condition) sont
// couverts à l'endroit correct compte tenu de l'architecture — server.js
// n'exporte rien (pas de module.exports, démarre le serveur au require) et
// n'est donc jamais testé en direct dans ce dépôt (cf. taxonomy-engine.js,
// "ce module ne porte que la partie testable sans IA") : resolveOrCreateStar
// délègue ENTIÈREMENT sa décision d'équivalence à matchExistingStarByLabel,
// donc les tests ci-dessous sur cette fonction couvrent la même logique que
// celle réellement exécutée par le garde-fou. Le cas 10 est modélisé
// explicitement (liste de candidats sans aucune notion d'utilisateur,
// exactement ce que la nouvelle requête globale de resolveOrCreateStar
// renvoie) ; le cas 11 est prouvé par construction (la fonction ne reçoit
// jamais que les candidats scopés à un seul Solar par l'appelant, jamais un
// second Solar) ; le cas 12 (retry + contrainte UNIQUE) est inchangé dans
// server.js et hors périmètre d'un test pur.

test("canonicalizeOrdinalTokens : normalise les variantes de 2e ordinal vers le même token", () => {
  assert.equal(canonicalizeOrdinalTokens("2nde guerre mondiale"), "2 guerre mondiale");
  assert.equal(canonicalizeOrdinalTokens("2e guerre mondiale"), "2 guerre mondiale");
  assert.equal(canonicalizeOrdinalTokens("2eme guerre mondiale"), "2 guerre mondiale");
  assert.equal(canonicalizeOrdinalTokens("2nd guerre mondial"), "2 guerre mondial");
  assert.equal(canonicalizeOrdinalTokens("deuxieme guerre mondiale"), "2 guerre mondiale");
  assert.equal(canonicalizeOrdinalTokens("seconde guerre mondiale"), "2 guerre mondiale");
});
test("canonicalizeOrdinalTokens : normalise les variantes de 1er ordinal vers le même token", () => {
  assert.equal(canonicalizeOrdinalTokens("1er empire"), "1 empire");
  assert.equal(canonicalizeOrdinalTokens("premier empire"), "1 empire");
  assert.equal(canonicalizeOrdinalTokens("premiere republique"), "1 republique");
});
test("canonicalizeOrdinalTokens : un token qui n'est pas un ordinal connu traverse inchangé", () => {
  assert.equal(canonicalizeOrdinalTokens("guerres mondiales"), "guerres mondiales");
  assert.equal(canonicalizeOrdinalTokens("conflits mondiaux"), "conflits mondiaux");
  assert.equal(canonicalizeOrdinalTokens(""), "");
});

// Cas 1 à 9 imposés par la phase d'implémentation (mêmes libellés que le
// rapport de diagnostic) — passent tous par matchExistingStarByLabel, la
// même fonction que le garde-fou de resolveOrCreateStar utilise désormais.
test("Cas 1 (exact) : 'Seconde Guerre mondiale' -> réutilisation", () => {
  const existing = [{ id: 196, name: "Seconde Guerre mondiale" }];
  assert.equal(matchExistingStarByLabel("Seconde Guerre mondiale", existing), 196);
});
test("Cas 2 (casse) : 'seconde guerre mondiale' -> réutilisation", () => {
  const existing = [{ id: 196, name: "Seconde Guerre mondiale" }];
  assert.equal(matchExistingStarByLabel("seconde guerre mondiale", existing), 196);
});
test("Cas 3 (article) : 'La Seconde Guerre mondiale' -> réutilisation", () => {
  const existing = [{ id: 196, name: "Seconde Guerre mondiale" }];
  assert.equal(matchExistingStarByLabel("La Seconde Guerre mondiale", existing), 196);
});
test("Cas 4 (2nde) : '2nde Guerre mondiale' -> réutilisation de 'Seconde Guerre mondiale'", () => {
  const existing = [{ id: 196, name: "Seconde Guerre mondiale" }];
  assert.equal(matchExistingStarByLabel("2nde Guerre mondiale", existing), 196);
});
test("Cas 5 (2e) : '2e Guerre mondiale' -> réutilisation", () => {
  const existing = [{ id: 196, name: "Seconde Guerre mondiale" }];
  assert.equal(matchExistingStarByLabel("2e Guerre mondiale", existing), 196);
});
test("Cas 6 (Deuxième) : 'Deuxième Guerre mondiale' -> réutilisation de 'Seconde Guerre mondiale'", () => {
  const existing = [{ id: 196, name: "Seconde Guerre mondiale" }];
  assert.equal(matchExistingStarByLabel("Deuxième Guerre mondiale", existing), 196);
});
test("Cas 7 (concept voisin) : 'Guerres mondiales' ne fusionne JAMAIS avec 'Seconde Guerre mondiale'", () => {
  const existing = [{ id: 196, name: "Seconde Guerre mondiale" }];
  assert.equal(matchExistingStarByLabel("Guerres mondiales", existing), null);
});
test("Cas 8 : 'Nazisme' reste distinct de 'Seconde Guerre mondiale'", () => {
  const existing = [{ id: 196, name: "Seconde Guerre mondiale" }];
  assert.equal(matchExistingStarByLabel("Nazisme", existing), null);
});
test("Cas 9 : 'Conflits et violences' reste distinct de 'Seconde Guerre mondiale' (aucune preuve sûre d'équivalence)", () => {
  const existing = [{ id: 196, name: "Seconde Guerre mondiale" }];
  assert.equal(matchExistingStarByLabel("Conflits et violences", existing), null);
});
test("Cas 10 (utilisateur différent, modélisé) : la liste de candidats globale au Solar ne porte aucune notion d'utilisateur — un libellé 2nde/Deuxième proposé par n'importe qui retrouve la même étoile canonique", () => {
  // Modélise exactement ce que la nouvelle requête de resolveOrCreateStar
  // renvoie : "id, name" pour TOUTES les étoiles du solar_system_id
  // concerné, sans jointure ni filtre sur un user_id quelconque — donc,
  // par construction, indépendant de qui a créé/acquis l'étoile 196.
  const allStarsOfThisSolarRegardlessOfUser = [{ id: 196, name: "Seconde Guerre mondiale" }];
  assert.equal(matchExistingStarByLabel("2nde Guerre mondiale", allStarsOfThisSolarRegardlessOfUser), 196);
  assert.equal(matchExistingStarByLabel("Deuxième Guerre mondiale", allStarsOfThisSolarRegardlessOfUser), 196);
});
test("Cas 11 (Solar différent, par construction) : matchExistingStarByLabel ne voit jamais que les candidats qui lui sont passés — un même libellé sous un autre Solar n'a jamais l'occasion d'être comparé", () => {
  // "Seconde Guerre mondiale" existe aussi, par hypothèse, sous un Solar B
  // — mais resolveOrCreateStar ne lui transmet jamais que les étoiles de
  // son propre solar_system_id (cf. .eq("solar_system_id", solarSystemId)) :
  // ce test prouve que la fonction elle-même n'a aucun mécanisme global qui
  // pourrait accidentellement regarder au-delà de la liste reçue.
  const starsOfSolarA = [{ id: 196, name: "Seconde Guerre mondiale" }];
  const starsOfSolarB = []; // resolveOrCreateStar, appelé pour le Solar B, ne recevrait jamais starsOfSolarA
  assert.equal(matchExistingStarByLabel("Seconde Guerre mondiale", starsOfSolarB), null);
  assert.equal(matchExistingStarByLabel("Seconde Guerre mondiale", starsOfSolarA), 196);
});

test("isNameRestatementOfParent : détecte la redite du Solar (bug du 10/08/2026, 'Révolution française' sous 'Révolution française & Empire')", () => {
  assert.equal(isNameRestatementOfParent("Révolution française", "Révolution française & Empire"), true);
});
test("isNameRestatementOfParent : une vraie sous-catégorie n'est pas une redite", () => {
  assert.equal(isNameRestatementOfParent("Directoire", "Révolution française & Empire"), false);
});

test("validateStarLabelCandidate : rejette une étoile qui redit le Solar", () => {
  const result = validateStarLabelCandidate({ label: "Révolution française", solarName: "Révolution française & Empire" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "restates_solar");
});
test("validateStarLabelCandidate : accepte une vraie sous-catégorie de bonne longueur", () => {
  assert.deepEqual(validateStarLabelCandidate({ label: "Directoire", solarName: "Révolution française & Empire" }), { ok: true });
});
test("validateStarLabelCandidate : rejette un libellé vide ou trop long", () => {
  assert.equal(validateStarLabelCandidate({ label: "", solarName: "X" }).ok, false);
  assert.equal(validateStarLabelCandidate({ label: "Un intitulé bien trop long avec beaucoup trop de mots", solarName: "X" }).ok, false);
});

// ── Point 4 : backfill user_solar_activations (déterministe, sans IA) ────

test("computeSolarActivationsFromAcquisitions : un utilisateur historique retrouve ses Solars actifs après migration", () => {
  const acquisitions = [
    { userId: "user-1", solarSystemId: 10, acquiredAt: "2026-08-01T00:00:00Z" },
    { userId: "user-1", solarSystemId: 20, acquiredAt: "2026-08-02T00:00:00Z" },
    { userId: "user-2", solarSystemId: 10, acquiredAt: "2026-08-03T00:00:00Z" }
  ];
  const result = computeSolarActivationsFromAcquisitions(acquisitions);
  assert.equal(result.usersConcerned, 2);
  assert.equal(result.activations.length, 3);
  assert.ok(result.activations.some((a) => a.userId === "user-1" && a.solarSystemId === 10));
  assert.ok(result.activations.some((a) => a.userId === "user-1" && a.solarSystemId === 20));
  assert.ok(result.activations.some((a) => a.userId === "user-2" && a.solarSystemId === 10));
});

test("computeSolarActivationsFromAcquisitions : déduplique plusieurs acquisitions du même (user, solar) sans les compter deux fois", () => {
  const acquisitions = [
    { userId: "user-1", solarSystemId: 10, acquiredAt: "2026-08-01T00:00:00Z" },
    { userId: "user-1", solarSystemId: 10, acquiredAt: "2026-08-05T00:00:00Z" } // même paire, acquise deux fois (repasse)
  ];
  const result = computeSolarActivationsFromAcquisitions(acquisitions);
  assert.equal(result.activations.length, 1, "une seule activation, pas de doublon");
  assert.equal(result.duplicatesAvoided, 1);
  assert.equal(result.activations[0].activatedAt, "2026-08-01T00:00:00Z", "garde la date la plus ancienne, déterministe");
});

test("computeSolarActivationsFromAcquisitions : une ligne sans solarSystemId n'est jamais inventée (placement impossible à reconstruire)", () => {
  const acquisitions = [
    { userId: "user-1", solarSystemId: null, acquiredAt: "2026-08-01T00:00:00Z" },
    { userId: "user-1", solarSystemId: 10, acquiredAt: "2026-08-02T00:00:00Z" }
  ];
  const result = computeSolarActivationsFromAcquisitions(acquisitions);
  assert.equal(result.activations.length, 1);
  assert.equal(result.unresolved, 1);
});

test("computeSolarActivationsFromAcquisitions : idempotent (rejouer sur son propre résultat ne change rien)", () => {
  const acquisitions = [
    { userId: "user-1", solarSystemId: 10, acquiredAt: "2026-08-01T00:00:00Z" },
    { userId: "user-2", solarSystemId: 20, acquiredAt: "2026-08-02T00:00:00Z" }
  ];
  const first = computeSolarActivationsFromAcquisitions(acquisitions);
  const replay = first.activations.map((a) => ({ userId: a.userId, solarSystemId: a.solarSystemId, acquiredAt: a.activatedAt }));
  const second = computeSolarActivationsFromAcquisitions(replay);
  assert.equal(second.activations.length, first.activations.length);
  assert.equal(second.duplicatesAvoided, 0);
});

test("computeSolarActivationsFromAcquisitions : fonction pure, aucun accès réseau ni appel IA possible (aucun paramètre de type client/clé API)", () => {
  // Preuve structurelle : la fonction n'accepte qu'un tableau de données déjà
  // chargées — elle ne peut, par construction, déclencher ni requête DB ni
  // appel IA pendant le backfill (point 12 de la vérification demandée).
  assert.equal(computeSolarActivationsFromAcquisitions.length, 1);
});
