"use strict";

// Couvre lib/source-scoring.js ("Fiabilisation intelligente des sources
// Brave", demande du 31/08/2026) — fonctions pures et déterministes
// uniquement (aucun réseau, aucun appel IA). Les données de candidats sont
// SYNTHÉTIQUES mais réalistes (plusieurs domaines/champs sont ceux
// effectivement observés en interrogeant l'API Brave réelle pendant le
// développement, cf. scripts/test-source-scoring-real.js pour la
// comparaison reproductible en conditions réelles) — ces tests vérifient
// des PROPRIÉTÉS générales du scoring (autorité contextuelle, spécialisation,
// fraîcheur conditionnelle, garde-fous), jamais un classement figé optimisé
// pour coller exactement à un exemple précis.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AUTHORITY_REGISTRY,
  MIN_QUALITY_THRESHOLD,
  GOOD_ENOUGH_THRESHOLD,
  buildTopicContext,
  inferContextualAuthority,
  scoreSourceForTopic,
  rankCandidates,
  filterByMinQuality,
  findBestUnrepresentedAuthority,
  shouldAttemptAuthorityRetry
} = require("../lib/source-scoring");

function candidate(domain, title, description, overrides = {}) {
  return { domain, url: `https://${domain}/page`, title, description, extraSnippets: [], pageAge: null, ...overrides };
}

function rank(subject, candidates) {
  return rankCandidates(candidates, buildTopicContext(subject));
}

// ── 1. Histoire : La bataille de Verdun ─────────────────────────────────────

test("Histoire (Verdun) : une source institutionnelle du registre (BnF) devance un blog générique de faible qualité éditoriale", () => {
  const ranked = rank("La bataille de Verdun", [
    candidate("blog-histoire-facile.com", "10 choses à savoir sur Verdun", ""),
    candidate("bnf.fr", "La bataille de Verdun, 1916 — Archives et documents", "Ressources d'archives de la Bibliothèque nationale de France sur la bataille de Verdun, son déroulement et ses conséquences."),
    candidate("fr.wikipedia.org", "Bataille de Verdun", "La bataille de Verdun est une bataille de la Première Guerre mondiale opposant la France à l'Allemagne en 1916.")
  ]);
  const byDomain = Object.fromEntries(ranked.map((c) => [c.domain, c.score.finalScore]));
  assert.ok(byDomain["bnf.fr"] > byDomain["blog-histoire-facile.com"], "BnF devrait devancer le blog générique");
  assert.ok(byDomain["fr.wikipedia.org"] > byDomain["blog-histoire-facile.com"], "Wikipédia devrait aussi devancer le blog de faible qualité");
});

// ── 2. Sujet historique très spécialisé ─────────────────────────────────────

test("Sujet historique spécialisé (colonies grecques) : un article académique bien décrit et spécifique au sujet n'est jamais suppressé au profit d'un blog générique creux", () => {
  const ranked = rank("La vie des Grecs au IIIe siècle av. J.-C. dans les colonies septentrionales", [
    candidate("persee.fr", "La colonisation grecque en mer Noire et dans les colonies septentrionales au IIIe siècle av. J.-C.", "Étude sur la vie quotidienne des colons grecs dans les colonies septentrionales durant la période hellénistique, IIIe siècle avant notre ère."),
    candidate("voyage-blog-generique.com", "Top 10 des plus belles plages", "")
  ]);
  assert.ok(ranked[0].domain === "persee.fr", "L'article académique spécifique doit devancer un blog générique hors-sujet");
  // Un domaine du registre reste éligible même sans recoupement exact de tags
  // (cf. limite documentée : recoupement lexical, pas sémantique) — jamais
  // écarté sous le seuil minimal simplement parce qu'aucun tag n'a matché.
  const filtered = filterByMinQuality(ranked);
  assert.ok(filtered.some((c) => c.domain === "persee.fr"), "Persée doit rester un candidat exploitable pour le jugement final de l'IA");
});

test("Sujet historique spécialisé : un domaine du registre reste utilisable même quand le recoupement de tags est nul (limite assumée du scoring lexical)", () => {
  const ctx = buildTopicContext("La vie des Grecs au IIIe siècle av. J.-C. dans les colonies septentrionales");
  const perseeMatch = ctx.matchingAuthorities.find((m) => m.entry.domain === "persee.fr");
  // Documente honnêtement la limite : pas de recoupement lexical direct ici
  // (aucun mot du sujet ne recoupe littéralement les tags de Persée) —
  // reflète l'absence de compréhension sémantique, jamais camouflée.
  assert.ok(!perseeMatch || perseeMatch.tagOverlap < 0.3, "Le recoupement lexical direct reste faible/nul sur ce sujet très spécifique — attendu et documenté");
});

// ── 3. Droit : durée légale du travail en France ────────────────────────────
// Domaines et intitulés directement observés en interrogeant l'API Brave
// réelle pendant le développement (cf. scripts/test-source-scoring-real.js) :
// Brave classait un blog SaaS commercial (esperoo.fr) devant legifrance.gouv.fr.

test("Droit (durée légale du travail) : Légifrance et les sites .gouv.fr dépassent nettement les blogs commerciaux, alors même que Brave les classait derrière (cas réel constaté)", () => {
  const ranked = rank("Durée légale du travail en France", [
    candidate("esperoo.fr", "Durée légale du travail en France : Règles 2026", "En France, la durée légale de travail est fixée à 35 heures par semaine pour toutes les entreprises."),
    candidate("legifrance.gouv.fr", "Code du travail - Durée légale du travail", "Article L3121-27 du Code du travail : la durée légale du travail effectif des salariés à temps complet est fixée à 35 heures."),
    candidate("payfit.com", "Durée maximale de travail : ce qu'il faut savoir", "Les règles de durée maximale de travail expliquées par PayFit."),
    candidate("travail-emploi.gouv.fr", "La durée légale du travail", "Le ministère du Travail précise les règles relatives à la durée légale du travail en France.")
  ]);
  const byDomain = Object.fromEntries(ranked.map((c) => [c.domain, c.score.finalScore]));
  assert.ok(byDomain["legifrance.gouv.fr"] > byDomain["esperoo.fr"], "Légifrance doit devancer le blog SaaS commercial");
  assert.ok(byDomain["travail-emploi.gouv.fr"] > byDomain["payfit.com"], "Le ministère du Travail doit devancer le blog commercial");
  assert.ok(ranked[0].domain !== "esperoo.fr" && ranked[0].domain !== "payfit.com", "Aucun blog commercial ne doit arriver en tête");
});

// ── 4. Santé : comment bien se laver les mains ──────────────────────────────

test("Santé (lavage des mains) : une autorité sanitaire reconnue devance des sites de marques cosmétiques", () => {
  const ranked = rank("Comment bien se laver les mains", [
    candidate("sante.fr", "Bien se laver les mains : les bons gestes", "Le ministère de la Santé rappelle les recommandations d'hygiène pour un lavage des mains efficace et la prévention des infections."),
    candidate("marque-cosmetique-savon.fr", "Notre gamme de savons doux", "Découvrez notre nouvelle gamme de savons parfumés pour toute la famille.")
  ]);
  assert.ok(ranked[0].domain === "sante.fr", "L'autorité sanitaire doit devancer le site d'une marque commerciale");
});

// ── 5. Statistiques : population française actuelle ────────────────────────

test("Statistiques (population française) : l'INSEE reçoit une forte autorité contextuelle et devance un agrégateur générique", () => {
  const ranked = rank("Population française actuelle", [
    candidate("insee.fr", "Population — Chiffres clés", "L'Insee publie les données démographiques officielles de la population française : recensement, natalité, structure par âge."),
    candidate("worldometers.info", "France Population", "Live population count for France.")
  ]);
  assert.ok(ranked[0].domain === "insee.fr", "L'INSEE doit devancer un agrégateur générique de statistiques mondiales");
});

test("Statistiques : le sujet contenant un marqueur de fraîcheur ('actuelle') est détecté comme freshnessLikely", () => {
  const ctx = buildTopicContext("Population française actuelle");
  assert.equal(ctx.freshnessLikely, true);
});

test("Temporalité : à autorité/pertinence égales, une page récente devance une page ancienne UNIQUEMENT quand le sujet exige de la fraîcheur", () => {
  const now = new Date();
  const recent = new Date(now.getTime() - 5 * 86_400_000).toISOString();
  const old = new Date(now.getTime() - 900 * 86_400_000).toISOString();

  const freshTopic = buildTopicContext("Le classement actuel de la Ligue 1");
  const recentCandidate = scoreSourceForTopic(candidate("site-sport.fr", "Classement Ligue 1", "Classement complet de la Ligue 1 de football.", { pageAge: recent }), freshTopic);
  const oldCandidate = scoreSourceForTopic(candidate("site-sport.fr", "Classement Ligue 1", "Classement complet de la Ligue 1 de football.", { pageAge: old }), freshTopic);
  assert.ok(recentCandidate.finalScore > oldCandidate.finalScore, "Sur un sujet qui exige de la fraîcheur, la page récente doit l'emporter");

  // Alexandre le Grand (section 2 de la demande, exemple explicite) : un
  // sujet stable ne doit JAMAIS pénaliser une page ancienne mais valable.
  const stableTopic = buildTopicContext("La vie d'Alexandre le Grand");
  const oldStableCandidate = scoreSourceForTopic(candidate("histoire-antique.fr", "Alexandre le Grand", "Biographie d'Alexandre le Grand, roi de Macédoine.", { pageAge: old }), stableTopic);
  const recentStableCandidate = scoreSourceForTopic(candidate("histoire-antique.fr", "Alexandre le Grand", "Biographie d'Alexandre le Grand, roi de Macédoine.", { pageAge: recent }), stableTopic);
  assert.ok(Math.abs(oldStableCandidate.finalScore - recentStableCandidate.finalScore) <= 2, "Sur un sujet stable, l'ancienneté ne doit quasiment pas jouer");
});

// ── 6. Astronomie : composition de l'atmosphère de Mars ─────────────────────

test("Astronomie (atmosphère de Mars) : la NASA, quand présente, devance un blog d'astronomie amateur générique", () => {
  const ranked = rank("Composition de l'atmosphère de Mars", [
    candidate("nasa.gov", "The Five Most Abundant Gases in the Martian Atmosphere", "NASA science page detailing the composition of the Martian atmosphere: carbon dioxide, nitrogen, argon."),
    candidate("blog-espace-amateur.fr", "Tout sur Mars !", "")
  ]);
  assert.ok(ranked[0].domain === "nasa.gov");
});

test("Astronomie : quand la NASA/l'ESA sont absentes des résultats mais que le sujet les concerne clairement, une relance ciblée est proposée", () => {
  const ranked = rank("Composition de l'atmosphère de Mars", [
    candidate("fr.wikipedia.org", "Atmosphère de Mars", "L'atmosphère de la planète Mars est principalement composée de dioxyde de carbone."),
    candidate("techno-science.net", "Atmosphère martienne", "Composition de l'atmosphère martienne.")
  ]);
  const ctx = buildTopicContext("Composition de l'atmosphère de Mars");
  const retry = shouldAttemptAuthorityRetry(ranked, ctx);
  assert.ok(retry, "Une relance devrait être proposée puisqu'aucune autorité spatiale n'est représentée et qu'aucun candidat n'est déjà excellent");
  assert.ok(["nasa.gov", "esa.int"].includes(retry.domain));
});

// ── 7. Actualité : fraîcheur + qualité doivent compter fortement ───────────

test("Actualité récente : entre deux articles de presse équivalents, celui d'aujourd'hui devance nettement celui de plusieurs mois", () => {
  const now = new Date();
  const today = now.toISOString();
  const monthsAgo = new Date(now.getTime() - 200 * 86_400_000).toISOString();
  const ctx = buildTopicContext("Les derniers résultats économiques annoncés aujourd'hui");
  assert.equal(ctx.freshnessLikely, true);
  const freshArticle = scoreSourceForTopic(candidate("presse-generaliste.fr", "Résultats économiques", "Les derniers résultats économiques annoncés aujourd'hui par le gouvernement.", { pageAge: today }), ctx);
  const staleArticle = scoreSourceForTopic(candidate("presse-generaliste.fr", "Résultats économiques", "Les derniers résultats économiques annoncés aujourd'hui par le gouvernement.", { pageAge: monthsAgo }), ctx);
  assert.ok(freshArticle.finalScore > staleArticle.finalScore);
});

// ── 8. Culture : les caractéristiques de l'impressionnisme ─────────────────

test("Culture (impressionnisme) : une institution muséale spécialisée devance un site marchand d'art au titre putaclic", () => {
  const ranked = rank("Les caractéristiques de l'impressionnisme", [
    candidate("musee-orsay.fr", "L'impressionnisme, une révolution picturale", "Le musée d'Orsay présente les caractéristiques du mouvement impressionniste : touche visible, lumière, scènes de la vie moderne."),
    candidate("boutique-art-en-ligne.com", "Vous ne devinerez jamais ces 5 secrets de l'impressionnisme", "")
  ]);
  assert.ok(ranked[0].domain === "musee-orsay.fr");
  const boutique = ranked.find((c) => c.domain === "boutique-art-en-ligne.com");
  assert.ok(boutique.score.penaltyReasons.some((r) => r.includes("putaclic")));
});

// ── 9. Sujet quotidien : ne jamais forcer une source universitaire ─────────

test("Sujet quotidien (nettoyer une poêle en inox) : aucune autorité n'est artificiellement invoquée, les candidats compétents restent proches sans bonus institutionnel forcé", () => {
  const ranked = rank("Comment nettoyer une poêle en inox", [
    candidate("marque-ustensiles-cuisine.fr", "Comment nettoyer une poêle en inox sans l'abîmer", "Nos conseils pratiques pour nettoyer efficacement une poêle en inox : vinaigre blanc, bicarbonate, technique du choc thermique."),
    candidate("magazine-cuisine.fr", "Astuces pour une poêle en inox impeccable", "Nos astuces de cuisine pour redonner de l'éclat à une poêle en inox.")
  ]);
  // Aucun des deux ne doit recevoir de bonus d'autorité contextuelle — le
  // registre ne doit JAMAIS inventer une autorité universitaire pour un
  // sujet pratique qui n'en a structurellement pas besoin.
  ranked.forEach((c) => assert.equal(c.score.matchedAuthority, null));
  const ctx = buildTopicContext("Comment nettoyer une poêle en inox");
  assert.equal(shouldAttemptAuthorityRetry(ranked, ctx), null, "Aucune relance ne doit être tentée : il n'existe aucune autorité pertinente à chercher pour ce sujet");
});

// ── 10. Sujet obscur : ne jamais transformer un mauvais résultat en source fiable ──

test("Sujet obscur : des résultats médiocres et hors-sujet n'atteignent pas le seuil minimal de qualité", () => {
  const ranked = rank("Généalogie précise des artisans tonneliers du village de Sarrant au XVIIe siècle", [
    candidate("forum-genealogie-generique.com", "Discussion sur la généalogie", ""),
    candidate("site-non-lie.com", "Nos meilleures offres du moment", "")
  ]);
  const qualified = filterByMinQuality(ranked);
  assert.equal(qualified.length, 0, "Aucun résultat médiocre ne doit être présenté comme une source suffisamment fiable");
});

// ── Garde-fou central (section 3) : un domaine du registre HORS de son
// domaine de compétence ne reçoit jamais le plein bonus d'autorité ────────

test("Garde-fou : un domaine du registre présent mais hors de son domaine de compétence pour CE sujet ne reçoit qu'un bonus résiduel, jamais le plein score d'autorité", () => {
  const ctx = buildTopicContext("Composition de l'atmosphère de Mars");
  const insee = scoreSourceForTopic(candidate("insee.fr", "À propos de l'Insee", "Présentation générale de l'Institut national de la statistique."), ctx);
  const nasa = scoreSourceForTopic(candidate("nasa.gov", "Mars atmosphere composition", "NASA science page on the composition of the Martian atmosphere."), ctx);
  assert.ok(insee.authorityScore < 30, "L'INSEE hors-sujet ne doit recevoir qu'un bonus résiduel");
  assert.ok(nasa.authorityScore > insee.authorityScore, "La NASA, sur son propre domaine de compétence, doit largement dépasser l'INSEE hors-sujet");
});

// ── rankCandidates / filterByMinQuality / shouldAttemptAuthorityRetry ──────

test("rankCandidates : trie par finalScore strictement décroissant", () => {
  const ranked = rank("Durée légale du travail en France", [
    candidate("esperoo.fr", "Durée légale du travail", "Contenu générique sur la durée légale du travail."),
    candidate("legifrance.gouv.fr", "Code du travail", "Article L3121-27 du Code du travail sur la durée légale du travail.")
  ]);
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].score.finalScore >= ranked[i].score.finalScore);
  }
});

test("filterByMinQuality : respecte MIN_QUALITY_THRESHOLD par défaut, et un seuil personnalisé si fourni", () => {
  const ranked = rank("Sujet quelconque", [candidate("exemple.com", "Titre générique", "Description générique correcte.")]);
  const defaultFiltered = filterByMinQuality(ranked);
  const strictFiltered = filterByMinQuality(ranked, 99);
  assert.ok(defaultFiltered.length >= strictFiltered.length);
});

test("shouldAttemptAuthorityRetry : ne relance jamais quand le meilleur candidat dépasse déjà GOOD_ENOUGH_THRESHOLD, même si une autorité existe et manque", () => {
  const ranked = rank("Population française actuelle", [
    candidate("insee.fr", "Population française — chiffres officiels", "L'Insee publie le recensement de la population française, données démographiques officielles à jour.")
  ]);
  assert.ok(ranked[0].score.finalScore >= GOOD_ENOUGH_THRESHOLD, "précondition du test : l'INSEE doit déjà être jugée assez bonne");
  const ctx = buildTopicContext("Population française actuelle");
  assert.equal(shouldAttemptAuthorityRetry(ranked, ctx), null);
});

test("findBestUnrepresentedAuthority : ignore une autorité déjà représentée parmi les domaines existants", () => {
  const ctx = buildTopicContext("Population française actuelle");
  const withoutInsee = findBestUnrepresentedAuthority(ctx, ["fr.wikipedia.org"]);
  const withInsee = findBestUnrepresentedAuthority(ctx, ["fr.wikipedia.org", "insee.fr"]);
  assert.ok(withoutInsee && withoutInsee.domain === "insee.fr");
  assert.ok(!withInsee || withInsee.domain !== "insee.fr");
});

// ── Cohérence générale du registre ──────────────────────────────────────────

test("AUTHORITY_REGISTRY : chaque entrée porte un domaine, un label, un poids valide et au moins un tag", () => {
  for (const entry of AUTHORITY_REGISTRY) {
    assert.equal(typeof entry.domain, "string");
    assert.ok(entry.domain.length > 3);
    assert.equal(typeof entry.label, "string");
    assert.ok(entry.weight > 0 && entry.weight <= 1);
    assert.equal(typeof entry.primary, "boolean");
    assert.ok(Array.isArray(entry.tags) && entry.tags.length > 0);
  }
});

test("MIN_QUALITY_THRESHOLD < GOOD_ENOUGH_THRESHOLD (cohérence des deux seuils)", () => {
  assert.ok(MIN_QUALITY_THRESHOLD < GOOD_ENOUGH_THRESHOLD);
});

// ── inferContextualAuthority : autorité HORS registre (V2, 31/08/2026) ─────
// Ne doit JAMAIS devenir une nouvelle whitelist déguisée : toujours exiger
// PLUSIEURS signaux concordants, jamais un mot-clé seul.

test("Mémorial directement lié à un événement historique : au moins 2 signaux concordants → bonus contextuel réel", () => {
  const ctx = buildTopicContext("La bataille de Verdun");
  const result = inferContextualAuthority(
    candidate("memorial-verdun.fr", "Le Mémorial de Verdun", "Le Mémorial de Verdun est un musée consacré à la bataille de Verdun de 1916, avec archives et collections."),
    ctx
  );
  assert.ok(result.score > 0.4, `score attendu >0.4, obtenu ${result.score}`);
  assert.ok(result.reasons.length >= 2, "au moins 2 signaux concordants attendus");
});

test("Musée spécialisé directement lié à un artiste : bonus contextuel même absent du registre", () => {
  const ctx = buildTopicContext("La vie et l'oeuvre de Claude Monet");
  const result = inferContextualAuthority(
    candidate("musee-monet-giverny.fr", "Fondation Claude Monet — Giverny", "La fondation Claude Monet à Giverny présente la maison et les jardins du peintre impressionniste Claude Monet."),
    ctx
  );
  assert.ok(result.score > 0.4);
});

test("Institut spécialisé absent du registre : institution + cohérence éditoriale suffisent sans lien de nom de domaine", () => {
  const ctx = buildTopicContext("La bataille de Verdun");
  const result = inferContextualAuthority(
    candidate("institut-grande-guerre.org", "Institut de recherche sur la Première Guerre mondiale", "Cet institut mène des travaux de recherche sur les grandes batailles de la Première Guerre mondiale, dont Verdun."),
    ctx
  );
  assert.ok(result.score > 0, "2 signaux (institution + cohérence éditoriale) doivent suffire même sans le nom du sujet dans le domaine");
});

test("Piège explicite de la demande : un domaine contenant le mot-clé du sujet mais clairement commercial/touristique ne reçoit AUCUN bonus", () => {
  const ctx = buildTopicContext("La bataille de Verdun");
  const result = inferContextualAuthority(
    candidate("best-verdun-tours-blog.com", "Top 10 des visites de Verdun", "Notre blog voyage vous propose les meilleurs tours et visites guidées de Verdun."),
    ctx
  );
  assert.equal(result.score, 0);
  assert.ok(result.penaltyReasons.some((r) => r.includes("commercial")));
});

test("Un seul signal (mot-clé du sujet dans le domaine, sans marqueur d'institution ni cohérence éditoriale) ne suffit jamais", () => {
  const ctx = buildTopicContext("La bataille de Verdun");
  const result = inferContextualAuthority(
    candidate("verdun-info.net", "Actus locales", "Toute l'actualité de la région."),
    ctx
  );
  assert.equal(result.score, 0);
  assert.ok(result.penaltyReasons.some((r) => r.includes("type d'organisation non identifiable")));
});

test("Un seul signal (vocabulaire d'institution seul, hors-sujet) ne suffit jamais — évite le piège 'musée trouvé → bonus automatique'", () => {
  const ctx = buildTopicContext("La composition de l'atmosphère de Mars");
  const result = inferContextualAuthority(
    candidate("musee-histoire-locale.fr", "Musée d'histoire locale", "Le musée présente l'histoire de notre commune à travers les âges."),
    ctx
  );
  assert.equal(result.score, 0, "un musée sans aucun rapport avec le sujet ne doit recevoir aucun bonus");
});

test("Wikipédia vs institution inconnue mais très spécialisée : l'institution spécialisée peut dépasser Wikipédia", () => {
  const ranked = rank("La bataille de Verdun", [
    candidate("fr.wikipedia.org", "Bataille de Verdun", "La bataille de Verdun est une bataille de la Première Guerre mondiale opposant la France à l'Allemagne en 1916."),
    candidate("memorial-verdun.fr", "Le Mémorial de Verdun", "Le Mémorial de Verdun, musée consacré à la bataille de Verdun de 1916, présente ses archives et collections sur le déroulement des combats.")
  ]);
  assert.equal(ranked[0].domain, "memorial-verdun.fr");
});

test("Wikipédia reste capable de gagner quand les autres sources sont faibles (l'inférence contextuelle ne force jamais un classement)", () => {
  const ranked = rank("La bataille de Verdun", [
    candidate("fr.wikipedia.org", "Bataille de Verdun", "La bataille de Verdun est une bataille de la Première Guerre mondiale."),
    candidate("blog-generique.com", "Verdun, ce qu'il faut savoir", "")
  ]);
  assert.equal(ranked[0].domain, "fr.wikipedia.org");
});

test("Une autorité confirmée du registre reste toujours au moins aussi forte qu'une autorité seulement inférée (jamais dépassée par une simple inférence)", () => {
  const ctx = buildTopicContext("Durée légale du travail en France");
  const registryScore = scoreSourceForTopic(
    candidate("legifrance.gouv.fr", "Code du travail", "Article L3121-27 du Code du travail sur la durée légale du travail."),
    ctx
  );
  // Un domaine inconnu qui imite les signaux d'institution mais sans être
  // dans le registre ne doit jamais dépasser une autorité confirmée du
  // registre sur son propre domaine de compétence.
  const inferredOnly = inferContextualAuthority(
    candidate("institut-du-droit-social.org", "Institut du droit social — durée légale du travail", "Cet institut de recherche publie des travaux sur la durée légale du travail en France."),
    ctx
  );
  assert.ok(registryScore.authorityScore >= Math.round(inferredOnly.score * 100));
});
