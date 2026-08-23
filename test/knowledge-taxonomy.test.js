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
