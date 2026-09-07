"use strict";

// Chantier "catalogue-first" pour les notions à approfondir/mémoriser des
// arènes (demande du 07/09/2026, suite au diagnostic lecture seule du même
// jour). Tests PURS uniquement : aucun réseau, aucun accès DB, `callAi` est
// toujours un mock qui compte ses propres invocations — jamais un vrai appel
// OpenAI (cf. dernière ligne de ce fichier, qui le vérifie explicitement).

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_DEBATE_TOPIC_NOTIONS,
  contentTokens,
  singularize,
  computeInitialsAcronym,
  extractRawAcronyms,
  lexicalCoverageMatch,
  isGenericTopicName,
  containsDatePattern,
  normalizeNameForDedup,
  slugifyName,
  finalizeDebateTopicNotions,
  pickDuplicateArenaNotions,
  selectCatalogMatches,
  selectDebateTopicNotions
} = require("../lib/debate-topic-notions");

const LONG_EXPLANATION = "Explication suffisamment longue pour passer la validation minimale de longueur.";

function notion(name, explanation = LONG_EXPLANATION, extra = {}) {
  return { name, explanation, ...extra };
}

// ── 1. Maximum 3 notions ─────────────────────────────────────────────────

test("MAX_DEBATE_TOPIC_NOTIONS vaut 3 (plafond, jamais 4 ou 5)", () => {
  assert.equal(MAX_DEBATE_TOPIC_NOTIONS, 3);
});

test("finalizeDebateTopicNotions : jamais plus de 3 notions conservées même si davantage sont valides", () => {
  const raw = [
    notion("Banque centrale européenne"),
    notion("Politique monétaire"),
    notion("Taux directeurs"),
    notion("Inflation en zone euro"),
    notion("Quantitative easing")
  ];
  const result = finalizeDebateTopicNotions(raw);
  assert.equal(result.length, 3);
});

test("finalizeDebateTopicNotions : aucune 4e notion conservée (limite stricte, pas d'exception)", () => {
  const raw = Array.from({ length: 6 }, (_, i) => notion(`Sujet distinct ${i + 1}`));
  const result = finalizeDebateTopicNotions(raw, 3);
  assert.equal(result.length, 3);
});

// ── 2-3-4. Pas d'obligation de remplir jusqu'à 3 ────────────────────────

test("1 seule notion valide en entrée -> résultat final de 1, jamais complété artificiellement", () => {
  const result = finalizeDebateTopicNotions([notion("Laïcité")]);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "Laïcité");
});

test("2 notions valides en entrée -> résultat final de 2, jamais complété à 3", () => {
  const result = finalizeDebateTopicNotions([notion("Laïcité"), notion("Liberté religieuse")]);
  assert.equal(result.length, 2);
});

test("selectDebateTopicNotions : le catalogue ne fournissant qu'1 notion pertinente s'arrête là, jamais d'appel IA pour compléter jusqu'à 3", async () => {
  let aiCalls = 0;
  const result = await selectDebateTopicNotions({
    catalogEntries: [{ name: "Laïcité", key: "notion:custom:aaa" }],
    haystackText: "Le débat porte sur la laïcité à l'école et la neutralité religieuse.",
    callAi: async () => { aiCalls++; return [notion("Ne doit jamais apparaître")]; }
  });
  assert.equal(aiCalls, 0);
  assert.equal(result.notions.length, 1);
  assert.equal(result.resolutionSource, "catalog");
});

// ── 5. Arène identique avec notions valides -> 0 appel IA ───────────────

test("selectDebateTopicNotions : une notion réutilisée d'une arène identique court-circuite entièrement le catalogue ET l'IA", async () => {
  let aiCalls = 0;
  const result = await selectDebateTopicNotions({
    duplicateArenaNotions: [notion("Gestion des risques industriels"), notion("Enquête judiciaire")],
    catalogEntries: [{ name: "Ne doit jamais être utilisé", key: "x" }],
    haystackText: "peu importe",
    callAi: async () => { aiCalls++; return []; }
  });
  assert.equal(aiCalls, 0);
  assert.equal(result.resolutionSource, "duplicate_arena");
  assert.equal(result.notions.length, 2);
  assert.equal(result.duplicateReuseCount, 2);
});

// ── 6. Anciennes arènes à 5 notions (ancienne limite) -> filtrées/max 3 ──

test("une ancienne arène avec 5 notions (ancienne limite pré-07/09/2026) est filtrée et plafonnée à 3 lors de la réutilisation", async () => {
  const old5 = [
    notion("Banque centrale européenne"),
    notion("Politique monétaire"),
    notion("Économie"), // générique seul : doit être rejeté
    notion("Baisse des taux de la BCE en 2026"), // date précise : doit être rejeté
    notion("Taux directeurs")
  ];
  const result = await selectDebateTopicNotions({
    duplicateArenaNotions: old5,
    catalogEntries: [],
    haystackText: "peu importe",
    callAi: async () => []
  });
  assert.equal(result.notions.length, 3);
  const names = result.notions.map((n) => n.name);
  assert.ok(names.includes("Banque centrale européenne"));
  assert.ok(names.includes("Politique monétaire"));
  assert.ok(names.includes("Taux directeurs"));
  assert.ok(!names.includes("Économie"));
  assert.ok(!names.includes("Baisse des taux de la BCE en 2026"));
});

// ── 7-8-9. Catalogue avec 1/2/3 bonnes notions -> 0 appel IA à chaque fois ──

for (const count of [1, 2, 3]) {
  test(`catalogue avec ${count} bonne(s) notion(s) pertinente(s) -> 0 appel IA`, async () => {
    const catalogEntries = [
      { name: "Banque centrale européenne", key: "a" },
      { name: "Politique monétaire", key: "b" },
      { name: "Taux directeurs", key: "c" }
    ].slice(0, count);
    let aiCalls = 0;
    const result = await selectDebateTopicNotions({
      catalogEntries,
      haystackText: "La BCE baisse ses taux directeurs, une décision de politique monétaire majeure pour la zone euro.",
      callAi: async () => { aiCalls++; return []; }
    });
    assert.equal(aiCalls, 0);
    assert.equal(result.notions.length, count);
    assert.equal(result.resolutionSource, "catalog");
  });
}

// ── 10. Catalogue avec candidats vagues -> rejet ────────────────────────

test("un candidat catalogue seulement vaguement associé au texte est rejeté, jamais retenu par proximité thématique", () => {
  const haystack = "La BCE baisse ses taux directeurs, décision de politique monétaire pour la zone euro.";
  const matches = selectCatalogMatches(haystack, [
    { name: "Union européenne", key: "a" },
    { name: "Mario Draghi", key: "b" },
    { name: "Économie", key: "c" }
  ]);
  assert.equal(matches.length, 0);
});

// ── 11-12. Catalogue sans candidat valide -> exactement 1 appel IA ──────

test("catalogue sans aucun candidat pertinent -> exactement 1 appel IA (jamais 0, jamais plus)", async () => {
  let aiCalls = 0;
  const result = await selectDebateTopicNotions({
    catalogEntries: [{ name: "Sujet totalement sans rapport", key: "z" }],
    haystackText: "Un article sur l'apiculture urbaine et la biodiversité en ville.",
    callAi: async () => { aiCalls++; return [notion("Apiculture urbaine")]; }
  });
  assert.equal(aiCalls, 1);
  assert.equal(result.aiCalled, true);
  assert.equal(result.resolutionSource, "ai");
});

test("jamais plus d'un appel IA, quel que soit le nombre de notions manquantes", async () => {
  let aiCalls = 0;
  await selectDebateTopicNotions({
    catalogEntries: [],
    haystackText: "Sujet neuf sans aucun rapport avec le catalogue.",
    callAi: async () => { aiCalls++; return []; }
  });
  assert.equal(aiCalls, 1);
});

// ── 13-14-15. Le fallback IA peut retourner 0, 1, ou jusqu'à 3 ──────────

test("le fallback IA peut retourner une liste vide (aucune notion sérieuse) sans que ce soit une erreur", async () => {
  const result = await selectDebateTopicNotions({
    catalogEntries: [],
    haystackText: "Contenu trop pauvre.",
    callAi: async () => []
  });
  assert.equal(result.notions.length, 0);
  assert.equal(result.resolutionSource, "none");
});

test("le fallback IA peut retourner exactement 1 notion", async () => {
  const result = await selectDebateTopicNotions({
    catalogEntries: [],
    haystackText: "peu importe",
    callAi: async () => [notion("Apiculture urbaine")]
  });
  assert.equal(result.notions.length, 1);
});

test("le fallback IA peut retourner jusqu'à 3 notions, jamais davantage même si le modèle en renvoie plus", async () => {
  const result = await selectDebateTopicNotions({
    catalogEntries: [],
    haystackText: "peu importe",
    callAi: async () => [notion("Un"), notion("Deux"), notion("Trois"), notion("Quatre")]
  });
  assert.equal(result.notions.length, 3);
});

// ── 16. Aucune 4e notion conservée (cas combiné catalogue + IA) ─────────
// Ne peut pas arriver dans la cascade actuelle (l'IA n'est appelée QUE si le
// catalogue n'a rien donné), mais finalizeDebateTopicNotions doit rester sûr
// même si on lui passait un mélange plus long que 3 par erreur d'un futur
// appelant — déjà couvert par le test générique plus haut ("6 notions -> 3").

// ── 17-18. Déduplication exacte et normalisée ───────────────────────────

test("déduplication exacte : deux entrées avec le même nom ne comptent qu'une fois", () => {
  const result = finalizeDebateTopicNotions([notion("Laïcité"), notion("Laïcité")]);
  assert.equal(result.length, 1);
});

test("déduplication normalisée : casse/accents/espaces différents restent un seul doublon", () => {
  const result = finalizeDebateTopicNotions([
    notion("Banque Centrale Européenne"),
    notion("banque   centrale europeenne")
  ]);
  assert.equal(result.length, 1);
});

test("pas de doublon entre une notion catalogue et une notion générée si elles désignent le même sujet", () => {
  const result = finalizeDebateTopicNotions([
    { name: "Banque centrale européenne", explanation: LONG_EXPLANATION, source: "catalog", catalogKey: "notion:custom:abc" },
    { name: "banque centrale européenne", explanation: LONG_EXPLANATION }
  ]);
  assert.equal(result.length, 1);
  // Le premier occurrence (catalogue) gagne — jamais écrasé par l'IA.
  assert.equal(result[0].source, "catalog");
});

// ── 19. BCE peut matcher "Banque centrale européenne" via le sigle ──────

test("BCE (sigle présent dans le texte) matche le nom catalogue complet Banque centrale européenne", () => {
  const haystack = "La BCE a annoncé une décision majeure ce matin.";
  assert.equal(lexicalCoverageMatch("Banque centrale européenne", haystack), true);
});

test("OTAN matche Organisation du traité de l'Atlantique nord via le sigle", () => {
  const haystack = "L'OTAN renforce sa présence en Europe de l'Est.";
  assert.equal(lexicalCoverageMatch("Organisation du traité de l’Atlantique nord", haystack), true);
});

// ── 20. Un simple mot commun insuffisant ne crée pas de match ───────────

test("un seul mot en commun sur un nom à 2 mots-contenu ne suffit jamais à créer un match (\"Europe\" seul n'active pas \"Union européenne\")", () => {
  const haystack = "Un sommet européen doit se tenir la semaine prochaine à Bruxelles.";
  assert.equal(lexicalCoverageMatch("Union européenne", haystack), false);
});

// ── 21-22. Économie seule rejetée, Politique monétaire acceptée ────────

test("\"Économie\" seule (catégorie ultra-générique) est toujours rejetée", () => {
  assert.equal(isGenericTopicName("Économie"), true);
});

test("\"Politique monétaire\" (phrase à 2 mots contenant un mot de la blacklist) reste acceptée — jamais rejetée par la blacklist", () => {
  assert.equal(isGenericTopicName("Politique monétaire"), false);
});

// ── 23. Formulation datée/événementielle rejetée ────────────────────────

test("une notion nommant une année précise est rejetée par le filtre déterministe", () => {
  assert.equal(containsDatePattern("Baisse des taux de la BCE en septembre 2026"), true);
  const result = finalizeDebateTopicNotions([notion("Baisse des taux de la BCE en septembre 2026")]);
  assert.equal(result.length, 0);
});

test("une notion sans date reste acceptée par ce même filtre", () => {
  assert.equal(containsDatePattern("Politique monétaire"), false);
});

// ── 24-25-26. Actualité avec content / Communauté sans content / contenu trivial ──

test("Actualité avec un vrai article (content non vide) : le catalogue peut matcher sur le texte complet", async () => {
  const result = await selectDebateTopicNotions({
    catalogEntries: [{ name: "Gestion des risques industriels", key: "a" }],
    haystackText: [
      "Explosion par fuite de gaz à Aubervilliers",
      "Une explosion due à une fuite de gaz a détruit un pavillon. Les secours ont géré les risques industriels sur place."
    ].join(" "),
    callAi: async () => []
  });
  assert.equal(result.notions.length, 1);
  assert.equal(result.resolutionSource, "catalog");
});

test("Communauté sans content (question + optionA/optionB/category seulement) : le mécanisme fonctionne à l'identique, sans branche spéciale", async () => {
  // Arène communauté réelle type (content vide) : seuls question/options/category
  // sont concaténés par l'appelant — le mot "laïcité" doit apparaître littéralement
  // quelque part dans ce texte pour que le matching déterministe (sans IA) le trouve,
  // exactement comme sur un vrai article qui l'emploierait.
  let aiCalls = 0;
  const result = await selectDebateTopicNotions({
    catalogEntries: [{ name: "Laïcité", key: "a" }],
    haystackText: [
      "La décision du RN d’interdire le voile est-elle justifiée ?",
      "Pour : la laïcité doit s'appliquer strictement dans l'espace public.",
      "Contre : c'est une atteinte à la liberté religieuse.",
      "Société - éducation"
    ].join(" "),
    callAi: async () => { aiCalls++; return []; }
  });
  assert.equal(aiCalls, 0);
  assert.equal(result.notions.length, 1);
});

test("contenu trivial (Communauté sans matière réelle) : liste finale vide autorisée, jamais forcée", async () => {
  const result = await selectDebateTopicNotions({
    catalogEntries: [],
    haystackText: "C'est mieux Tom Tom et Nana ou Anatole latuile ?",
    callAi: async () => [] // le vrai prompt IA, sur un contenu aussi pauvre, renverrait déjà []
  });
  assert.equal(result.notions.length, 0);
});

// ── 27. Deux arènes identiques -> réutilisation des notions ─────────────

test("deux arènes strictement identiques (même source_url) réutilisent les mêmes notions plutôt que d'en régénérer deux jeux", () => {
  const current = { sourceUrl: "https://exemple.test/aubervilliers", question: "Explosion par fuite de gaz à Aubervilliers", category: "Justice - faits divers" };
  const candidateRows = [{
    id: 3170,
    question: "Explosion par fuite de gaz à Aubervilliers",
    source_url: "https://exemple.test/aubervilliers",
    category: "Justice - faits divers",
    topic_notions: [notion("Gestion des risques industriels"), notion("Enquête judiciaire")]
  }];
  const match = pickDuplicateArenaNotions(current, candidateRows);
  assert.ok(match);
  assert.equal(match.originDebateId, 3170);
  assert.equal(match.notions.length, 2);
});

test("pickDuplicateArenaNotions : repli sur la question normalisée exacte quand aucune source_url n'est fournie", () => {
  const current = { sourceUrl: "", question: "  Explosion   par fuite de gaz à Aubervilliers  ", category: "Justice - faits divers" };
  const candidateRows = [{
    id: 3170,
    question: "Explosion par fuite de gaz à Aubervilliers",
    source_url: "",
    category: "Justice - faits divers",
    topic_notions: [notion("Gestion des risques industriels")]
  }];
  const match = pickDuplicateArenaNotions(current, candidateRows);
  assert.ok(match);
  assert.equal(match.originDebateId, 3170);
});

test("pickDuplicateArenaNotions : une question identique mais une catégorie différente n'est PAS réutilisée (garde-fou anti faux-positif)", () => {
  const current = { sourceUrl: "", question: "Qui a raison ?", category: "Sport" };
  const candidateRows = [{
    id: 1,
    question: "Qui a raison ?",
    source_url: "",
    category: "Politique",
    topic_notions: [notion("Sujet totalement différent")]
  }];
  assert.equal(pickDuplicateArenaNotions(current, candidateRows), null);
});

test("pickDuplicateArenaNotions : aucun candidat -> null, jamais une erreur", () => {
  assert.equal(pickDuplicateArenaNotions({ sourceUrl: "", question: "X" }, []), null);
});

// ── 28. Aucun test ne déclenche le moindre appel réseau OpenAI (garantie explicite) ───────

test("garantie : aucun test de ce fichier n'importe ni n'appelle l'API OpenAI ou tout module réseau — callAi est toujours un mock local", () => {
  const fileSource = require("node:fs").readFileSync(__filename, "utf8");
  const forbiddenCallToken = ["_call", "OpenAI"].join("");
  assert.ok(!fileSource.includes(forbiddenCallToken), "motif interdit trouvé : appel direct au client OpenAI");
  assert.doesNotMatch(fileSource, /fetch\(/);
});

// ── Petits compléments unitaires sur les briques de bas niveau ──────────

test("slugifyName / normalizeNameForDedup restent cohérents entre eux", () => {
  assert.equal(slugifyName("Banque centrale européenne"), "banque-centrale-europeenne");
  assert.equal(normalizeNameForDedup("Banque centrale européenne"), normalizeNameForDedup("banque   Centrale   Européenne"));
});

test("singularize : heuristique minimale, jamais appliquée aux mots courts", () => {
  assert.equal(singularize("gaz"), "gaz");
  assert.equal(singularize("pays"), "pays");
  assert.equal(singularize("taux"), "taux");
  assert.equal(singularize("cotisations"), "cotisation");
});

test("extractRawAcronyms : ne capture que des séquences de majuscules bornées, jamais un mot en début de phrase", () => {
  const acronyms = extractRawAcronyms("La BCE et l'ONU ont réagi. Une Banque a aussi commenté.");
  assert.ok(acronyms.has("BCE"));
  assert.ok(acronyms.has("ONU"));
  assert.ok(!acronyms.has("UNE"));
});
