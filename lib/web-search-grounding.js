"use strict";

// Grounding par recherche web réelle (Brave Search), demande du 31/08/2026 :
// avant de rédiger une fiche de notion, chercher de vraies pages web sur le
// sujet, ne garder que celles jugées pertinentes ET fiables, et en extraire
// le texte réel pour fonder la fiche dessus — au lieu de laisser le modèle
// écrire "de mémoire" sans aucune vérification externe.
//
// Concerne UNIQUEMENT les deux pipelines qui n'ont structurellement AUCUN
// texte source externe (cf. l'avertissement de tête de
// buildFicheAndKnowledgeAdmissionPrompt dans lib/knowledge-admission.js) :
// "notion de débat avec niveau" (le sujet mémorisé est la NOTION que le
// débat illustre, ex. "avalanche glaciaire" pour une actu au Népal — jamais
// l'actualité elle-même, dont les sources de presse ne parlent pas de la
// notion générale) et "sujet libre" (recherche tapée par l'utilisateur).
// Jamais Éclairages/Histoire, déjà fondé sur un texte source réel stocké en
// base (buildKnowledgeAdmissionPrompt).
//
// Fichier volontairement PUR (aucun accès réseau ici, même principe que
// lib/knowledge-admission.js) : construit la requête/le prompt de sélection,
// valide une réponse IA déjà reçue, formate le texte de grounding final.
// L'orchestration réelle (appel Brave, fetch des pages via
// lib/url-knowledge.js, appel IA de sélection) reste dans server.js
// (resolveWebSearchGrounding), qui reste seul responsable du réseau.

const { selectRepresentativeExcerpt } = require("./source-excerpt-selection");
const { classifyDomainAuthorityTier } = require("./source-scoring");

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

// Nombre de résultats bruts demandés à Brave — assez pour laisser à l'IA de
// sélection un vrai choix parmi plusieurs candidats, jamais démesuré
// (coût/latence d'une requête déclenchée à la demande, jamais en lot).
const WEB_SEARCH_RAW_RESULTS_COUNT = 8;
// Sources effectivement retenues pour le grounding : 2-3 suffisent largement
// pour une fiche de notion (déjà courte par nature, cf. LEVEL_CONFIG) — au-delà
// le prompt de fiche grossirait sans gain de fiabilité proportionnel.
const WEB_SEARCH_MAX_SELECTED_SOURCES = 3;
// Texte extrait par source, tronqué : inutile d'envoyer une page entière au
// modèle de rédaction pour une fiche qui reste elle-même très concise.
// Relevé de 2500 à 4000 (audit qualité éditoriale du 07/09/2026, PROBLÈME 1 —
// "corpus web tronqué trop tôt") : 2500 caractères pris NAÏVEMENT en tête
// d'un long article (ex. Wikipédia, 192 515 caractères pour "Empire
// ottoman") ne capturaient presque QUE l'infobox, jamais le corps de
// l'article. La cause principale corrigée à l'époque est la STRATÉGIE de
// sélection (cf. lib/source-excerpt-selection.js, passages représentatifs
// répartis sur le document plutôt que les premiers caractères) — le budget
// n'avait alors été relevé que modérément (+60 %, jamais ×4).
//
// Relevé une seconde fois de 4000 à 8000 (diagnostic qualité éditoriale du
// 12/09/2026, sujets "gigantesques" — Révolution française, Histoire de
// l'islam) : même avec la sélection représentative ci-dessus, un sujet
// couvrant plusieurs siècles reste structurellement sous-échantillonné à
// 4000 caractères (mesuré sur les vrais articles : 2 à 7 grands thèmes sur
// 9-10 couverts selon le sujet). Mesuré empiriquement à plusieurs paliers
// (4000 à 16000) : la couverture progresse nettement jusqu'à 8000-12000 puis
// plafonne, tandis qu'un sujet déjà court (ex. "Aires urbaines") sature dès
// 4000 et ne gagne plus rien au-delà — 8000 (×2, jamais ×3) reste le meilleur
// compromis couverture/coût. Impact coût à connaître : ce texte est réinjecté
// TEL QUEL dans ~8 appels IA distincts d'une génération progressive complète
// (curriculum, éventuelle réparation, fiche × 3 niveaux, questions × 3
// niveaux) — doubler ce budget double donc l'ajout de tokens sur CHACUN de
// ces appels, jamais une seule fois.
const WEB_SEARCH_EXCERPT_MAX_CHARS = 8000;

// Domaines structurellement inexploitables comme source factuelle (réseaux
// sociaux, forums, plateformes UGC) : un filtre déterministe AVANT même de
// soumettre les candidats à l'IA de sélection, jamais un jugement de
// fiabilité éditoriale laissé au seul cas par cas — même philosophie que
// GENERIC_PLACE_NAMES/WIKIPEDIA_MATCH_STOPWORDS (lib/parallele-historique.js).
const EXCLUDED_GROUNDING_DOMAINS = new Set([
  "facebook.com", "twitter.com", "x.com", "instagram.com", "tiktok.com",
  "reddit.com", "pinterest.com", "quora.com", "youtube.com", "linkedin.com",
  "threads.net"
]);

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch (e) {
    return null;
  }
}

function buildBraveSearchUrl(query, count = WEB_SEARCH_RAW_RESULTS_COUNT) {
  const params = new URLSearchParams({
    q: String(query || "").trim().slice(0, 400),
    count: String(Math.max(1, Math.min(20, count))),
    safesearch: "moderate"
  });
  return `${BRAVE_SEARCH_ENDPOINT}?${params.toString()}`;
}

// Requête de relance ciblée (demande du 31/08/2026, "fiabilisation des
// sources") : Brave supporte l'opérateur `site:` comme la plupart des
// moteurs — vérifié en conditions réelles (site:nasa.gov sur "Composition de
// l'atmosphère de Mars" remonte directement science.nasa.gov/.../martian-
// atmosphere/, alors que la recherche générale ne faisait remonter aucun
// résultat NASA). N'est déclenchée par l'appelant (server.js,
// resolveWebSearchGrounding) que lorsque lib/source-scoring.js
// (shouldAttemptAuthorityRetry) juge qu'une autorité du registre
// manifestement compétente pour ce sujet manque encore parmi les candidats.
function buildAuthorityRetryQuery(subject, authorityDomain) {
  return `site:${authorityDomain} ${String(subject || "").trim()}`;
}

// Normalise la réponse brute de l'API Brave en une liste plate — jamais de
// confiance dans une structure non conforme (répond simplement []).
// pageAge/extraSnippets (demande du 31/08/2026, "fiabilisation des sources") :
// champs réellement renvoyés par l'API Brave (vérifié en conditions réelles),
// exploités par lib/source-scoring.js pour la fraîcheur et la pertinence —
// jamais un nouvel appel réseau/IA, seulement des champs déjà présents dans
// la même réponse.
function normalizeBraveResults(rawJson) {
  const results = rawJson?.web?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((r) => ({
      title: String(r?.title || "").trim().replace(/\s+/g, " ").slice(0, 300),
      url: String(r?.url || "").trim(),
      description: String(r?.description || "").trim().replace(/\s+/g, " ").slice(0, 500),
      pageAge: typeof r?.page_age === "string" ? r.page_age : null,
      extraSnippets: Array.isArray(r?.extra_snippets) ? r.extra_snippets.slice(0, 3).map((s) => String(s || "").slice(0, 300)) : []
    }))
    .filter((r) => r.title && r.url && /^https?:\/\//i.test(r.url));
}

// Ordre de présentation des candidats à l'IA de sélection (demande du
// 31/08/2026, RÉVISÉ le 14/09/2026 — "hiérarchie d'autorité des sources") :
// un simple tri stable place les meilleures AUTORITÉS en tête (A+ puis A puis
// B puis C/Wikipédia), réutilisant EXACTEMENT la même classification que le
// scoring déterministe (lib/source-scoring.js classifyDomainAuthorityTier) —
// jamais un second jugement de fiabilité parallèle. Ne change jamais QUI est
// éligible (le filtre déterministe ci-dessous reste inchangé) ni ne contourne
// le jugement de pertinence/fiabilité de l'IA de sélection (cf.
// buildSourceSelectionPrompt) : ce tri ne fait qu'influencer l'ordre de
// présentation et le repère indicatif affiché — rankCandidates
// (lib/source-scoring.js) reste la seule autorité de classement final avant
// soumission à l'IA.
const WIKIPEDIA_DOMAIN_PATTERN = /(^|\.)wikipedia\.org$/;
const AUTHORITY_TIER_RANK = { "A+": 0, "A": 1, "B": 2, "C": 3 };

function referenceDomainRank(domain) {
  return AUTHORITY_TIER_RANK[classifyDomainAuthorityTier(domain)] ?? 2;
}

// Filtre déterministe avant l'IA : retire les domaines exclus, les doublons
// d'URL exacte, et plafonne à `maxPerDomain` résultats par domaine — pour ne
// pas laisser un même site squatter toute la sélection via de nombreuses
// pages indexées (utile contre un domaine commercial/SEO qui dupliquerait du
// contenu sous plusieurs URL).
//
// EXCEPTION Wikipédia, jamais plafonnée par domaine (seulement par le
// plafond global `maxCandidates`) — diagnostic qualité éditoriale du
// 12/09/2026, cas réel "Débuts de l'islam" avec Brave hors quota (repli
// guessSourcesWithAI actif) : l'IA de repli avait proposé 5 pages
// fr.wikipedia.org distinctes (Islam, Mahomet, Hégire, Arabie préislamique,
// Expansion de l'islam) — même un plafond de 2 par domaine ne conservait que
// les 2 premières de la liste ("Islam", "Mahomet") et écartait toujours
// silencieusement "Expansion de l'islam" (5e de la liste, pourtant la plus
// précisément centrée sur le sujet demandé) AVANT MÊME que l'IA de
// sélection ne puisse la voir — la consigne PÉRIMÈTRE DU SUJET ajoutée à
// buildSourceSelectionPrompt n'avait alors aucune chance de s'appliquer,
// faute de candidat à comparer. Un plafond de position (peu importe sa
// valeur) ne peut jamais garantir que LE meilleur candidat survive s'il
// arrive tard dans une liste sans ordre de pertinence garanti — seule
// l'absence de plafond pour ce domaine précis élimine le risque. Sans danger
// de "squattage" ici : wikipedia.org héberge des pages INDÉPENDANTES et
// authentiquement distinctes (contrairement à un site qui dupliquerait un
// même contenu sous plusieurs URL) — cette exception reste valable même
// depuis que Wikipédia n'est plus la source explicitement priorisée du
// pipeline (niveau C, cf. hiérarchie d'autorité du 14/09/2026 dans
// lib/source-scoring.js) : elle ne porte que sur la COUVERTURE (laisser l'IA
// de sélection voir plusieurs pages Wikipédia candidates plutôt que de lui en
// imposer une seule choisie arbitrairement par position), jamais sur son
// rang d'autorité. Le plafond global `maxCandidates` (8 par défaut) continue
// de borner la taille totale de la liste transmise à l'IA dans tous les cas.
function filterCandidateSources(rawResults, maxCandidates = WEB_SEARCH_RAW_RESULTS_COUNT, maxPerDomain = 2) {
  const domainCounts = new Map();
  const seenUrls = new Set();
  const filtered = [];
  for (const r of (rawResults || [])) {
    const domain = extractDomain(r.url);
    if (!domain || EXCLUDED_GROUNDING_DOMAINS.has(domain) || seenUrls.has(r.url)) continue;
    const domainLimit = WIKIPEDIA_DOMAIN_PATTERN.test(domain) ? maxCandidates : maxPerDomain;
    const countForDomain = domainCounts.get(domain) || 0;
    if (countForDomain >= domainLimit) continue;
    domainCounts.set(domain, countForDomain + 1);
    seenUrls.add(r.url);
    filtered.push({ ...r, domain });
    if (filtered.length >= maxCandidates) break;
  }
  filtered.sort((a, b) => referenceDomainRank(a.domain) - referenceDomainRank(b.domain));
  return filtered;
}

// ── Sélection IA des sources pertinentes ET fiables ── Un appel séparé,
// batché sur tous les candidats en un coup, jamais un jugement par candidat.
// Le choix ici conditionne directement la fiabilité de la fiche à venir : la
// consigne est volontairement stricte (mieux vaut aucune source qu'une
// source non fiable, cf. buildFicheAndKnowledgeAdmissionPrompt qui reste
// utilisable sans grounding).
// `candidates[i].score` (optionnel, cf. lib/source-scoring.js rankCandidates) :
// quand présent, son `finalScore`/`selectionReason` sont ajoutés en indice à
// titre de repère — un classement AUTOMATIQUE et DÉTERMINISTE (pertinence
// lexicale, autorité contextuelle, spécialisation...), jamais un verdict
// final : la consigne ci-dessous rappelle explicitement à l'IA de garder son
// propre jugement contextuel, ce score ne captant pas toutes les nuances
// (section 2 de la demande : un texte de loi primaire n'est pas toujours
// préférable à une synthèse pour expliquer un phénomène complexe).
// `maxSelected` (optionnel, V3.2 du 31/08/2026 — "fallback d'enrichissement
// des sources") : par défaut WEB_SEARCH_MAX_SELECTED_SOURCES, comportement
// identique au caractère près pour tous les appelants existants. Le fallback
// d'enrichissement (server.js expandWebSearchGroundingSources) réutilise
// EXACTEMENT cette même fonction avec un plafond plus bas
// (MAX_NEW_SOURCES_PER_EXPANSION, cf. lib/grounding-source-expansion.js) —
// jamais un second prompt de sélection à maintenir en parallèle.
function buildSourceSelectionPrompt(subject, contextHint, candidates, maxSelected = WEB_SEARCH_MAX_SELECTED_SOURCES) {
  const lines = candidates.map((c, i) => {
    const hint = c.score ? ` (classement automatique indicatif : ${c.score.finalScore}/100 — ${c.score.selectionReason})` : "";
    return `${i}. [${c.domain}] ${c.title} — ${c.description || "(pas de résumé)"}${hint}`;
  }).join("\n");
  return [
    `Voici des résultats de recherche web bruts pour le sujet "${subject}"${contextHint ? ` (contexte : ${contextHint})` : ""} — une fiche de mémorisation factuelle va être rédigée à partir des sources que tu choisis ici, donc ce choix conditionne directement sa fiabilité.`,
    "",
    "Résultats (index, domaine, titre, résumé, éventuel classement automatique indicatif) :",
    lines,
    "",
    "Le classement automatique indicatif (quand présent) t'aide à repérer les autorités contextuelles probables, mais reste un simple repère déterministe (recoupement lexical, TLD institutionnel...) — IL NE CAPTE PAS toutes les nuances : garde ton propre jugement contextuel, en particulier si une source moins bien notée automatiquement est en réalité plus directement compétente pour ce sujet précis (spécialisation réelle, synthèse plus claire qu'un document primaire brut...).",
    "",
    "Sélectionne UNIQUEMENT les sources qui sont À LA FOIS :",
    "- réellement sur CE sujet précis (jamais un sujet voisin, une page d'accueil générique, ou un résultat hors-sujet) ;",
    "- éditorialement fiables : encyclopédie reconnue, presse identifiée, site institutionnel/académique/officiel — jamais un blog anonyme, un site de contenu généré automatiquement, un forum, une officine commerciale sans autorité éditoriale sur ce sujet précis ;",
    "- CENTRÉES SUR LE SUJET LUI-MÊME EN TANT QUE NOTION GÉNÉRALE (définition, mécanisme, fonctionnement, caractéristiques durables), JAMAIS un article relatant UN épisode/événement/incident précis et récent qui illustre ce sujet (ex. pour \"Avalanche glaciaire\", rejette un article de presse sur une avalanche précise survenue tel jour dans tel pays avec un bilan de victimes — même si le sujet y est mentionné en toutes lettres et même si la source est par ailleurs fiable) : ce type d'article contaminerait une fiche censée rester intemporelle et générale avec des faits d'actualité éphémères et hors-sujet pour ce qui doit être mémorisé. Préfère toujours une page de référence/encyclopédique/pédagogique qui explique le phénomène en général.",
    `Retiens au maximum ${maxSelected} sources, uniquement celles qui passent clairement ces trois critères. Si aucune ne convient (ex. seuls des articles d'actualité sur un cas précis sont disponibles, rien d'encyclopédique/général), retourne un tableau vide plutôt que de forcer un choix médiocre — une fiche rédigée sans source externe reste préférable à une fiche fondée sur une source douteuse ou hors-sujet.`,
    "",
    // Périmètre du sujet (diagnostic qualité éditoriale du 12/09/2026, cas
    // réel "Débuts de l'islam" — comparé à "Histoire de l'islam", article
    // panoramique de quatorze siècles où le sujet demandé n'occupe qu'une
    // fraction du contenu, "Expansion de l'islam" (centré sur le VIIe-VIIIe
    // siècle) fait remonter presque deux fois plus de connaissances
    // structurantes une fois extrait par le même algorithme). Le critère
    // "CENTRÉES SUR LE SUJET" ci-dessus écarte déjà l'extrême inverse (un
    // article trop ÉTROIT, sur un incident précis) — celui-ci écarte
    // l'extrême SYMÉTRIQUE (un article trop LARGE), jamais couvert
    // jusqu'ici : rien n'empêchait auparavant de préférer une source
    // panoramique simplement parce qu'elle mentionne aussi le sujet.
    "PÉRIMÈTRE DU SUJET : à qualité et fiabilité égales, préfère toujours une source dont le PÉRIMÈTRE correspond à la précision du sujet demandé plutôt qu'un article panoramique couvrant une période ou un domaine beaucoup plus large, où le sujet demandé n'occupe qu'une fraction du contenu. Exemple : pour \"Débuts de l'islam\", une source centrée sur les premières décennies (ex. la naissance et l'expansion initiale) reste préférable à une histoire générale de l'islam s'étendant sur quatorze siècles, même si cette dernière évoque aussi les débuts en passant — un sujet qui n'est qu'un chapitre parmi beaucoup d'autres dans l'article dilue mécaniquement la place qu'y occupe l'information vraiment pertinente pour CE sujet précis. N'écarte cependant jamais une source par ailleurs pertinente et fiable simplement parce qu'elle est plus large que le sujet strict quand aucune alternative mieux centrée ne passe les trois critères ci-dessus — ce critère départage entre plusieurs candidats valables, il n'exclut jamais la seule option correcte.",
    "",
    // Diversité des sources (audit qualité éditoriale du 07/09/2026, section
    // 11, reformulé le 14/09/2026 sans plus présupposer Wikipédia comme la
    // source encyclopédique par défaut — la préférence pour une COMBINAISON
    // reste utile mais ne doit jamais aboutir à 3 sources quasi redondantes,
    // toutes de type encyclopédie/infobox généraliste, ce qui pousse
    // mécaniquement la fiche vers une accumulation de faits descriptifs
    // plutôt qu'une explication). Prompt uniquement, aucune requête Brave
    // supplémentaire : agit sur le même lot de candidats déjà récupéré.
    `Quand plusieurs sources valables sont disponibles, préfère une COMBINAISON complémentaire plutôt que ${maxSelected} sources qui se contentent de répéter le même type de contenu descriptif (plusieurs encyclopédies généralistes redondantes, plusieurs pages de type infobox) : une source encyclopédique de référence (Britannica, Universalis, Wikipédia...) PLUS, quand elles existent et sont pertinentes, une ou deux sources institutionnelles, académiques ou spécialisées qui apportent un angle différent (mécanisme, contexte, analyse) plutôt que les mêmes données déjà couvertes. N'écarte cependant jamais une source par ailleurs pertinente et fiable simplement pour \"faire varier\" artificiellement les types si aucune alternative complémentaire ne passe les trois critères ci-dessus.`,
    "",
    // Hiérarchie d'autorité des sources (demande du 14/09/2026, cas réel
    // "constructivisme russe" : Wikipédia affirmait que le mouvement était
    // "l'art officiel de la révolution russe de 1917 à 1921" et avait été
    // "supprimé dans les années 1920", formulation trop catégorique reprise
    // telle quelle faute de hiérarchie entre les sources, alors qu'une
    // source muséale majeure restait bien plus prudente sur le même point).
    // Remplace l'ancienne consigne "Wikipédia en premier parmi les
    // encyclopédies" — le classement automatique indicatif ci-dessus
    // applique déjà cette hiérarchie (cf. lib/source-scoring.js), ce
    // paragraphe ne fait que l'expliciter pour le jugement final de l'IA.
    "HIÉRARCHIE D'AUTORITÉ : à pertinence et fiabilité comparables, préfère toujours une source institutionnelle, gouvernementale, universitaire, muséale ou une encyclopédie académique/spécialisée de référence (ex. Encyclopædia Britannica, Encyclopædia Universalis, Stanford Encyclopedia of Philosophy, Our World in Data, ou l'institution directement compétente pour ce sujet — musée majeur, organisme officiel...) à Wikipédia. Wikipédia (ou une variante linguistique) reste une source valide et souvent un bon complément généraliste : ne l'écarte jamais si elle est la seule pertinente et fiable disponible (une fiche sans grounding externe reste pire), mais évite de la retenir en doublon d'une source institutionnelle/académique qui couvre déjà le même point. Si Wikipédia formule une affirmation de façon plus catégorique, plus datée avec précision, ou différente d'une source institutionnelle/académique retenue, privilégie toujours la formulation la plus prudente et la mieux établie de cette dernière plutôt que de les traiter comme équivalentes. Cela ne dispense JAMAIS de vérifier que la source institutionnelle/académique remplit elle-même les trois critères ci-dessus (une page hors-sujet reste écartée comme n'importe quelle autre source).",
    "",
    'Réponds uniquement en JSON strict, sous la forme {"selected":[{"index":0,"reason":"raison technique courte, interne, jamais affichée à l\'utilisateur"}]}.'
  ].join("\n");
}

// Conservateur par construction, même logique qu'applyKnowledgeVerificationDecisions :
// un index absent, invalide, dupliqué ou hors bornes est simplement ignoré,
// jamais une erreur — un JSON malformé donne une liste vide (best-effort,
// cf. resolveWebSearchGrounding qui retombe alors sur le flux sans grounding).
function parseSourceSelectionResponse(rawContent, candidates, maxSelected = WEB_SEARCH_MAX_SELECTED_SOURCES) {
  if (!rawContent) return [];
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return [];
  }
  const rawSelected = Array.isArray(parsed?.selected) ? parsed.selected : [];
  const seenIndexes = new Set();
  const selected = [];
  for (const item of rawSelected) {
    const index = Number(item?.index);
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) continue;
    if (seenIndexes.has(index)) continue;
    seenIndexes.add(index);
    selected.push(candidates[index]);
    if (selected.length >= maxSelected) break;
  }
  return selected;
}

// ── Repli sans Brave (quota épuisé/clé absente, incident constaté le
// 09/09/2026 sur "Cour d'assises" : fiche admise avec grounding_sources=[])
// ────────────────────────────────────────────────────────────────────────
// Ne remplace JAMAIS Brave quand il est disponible et répond : appelé
// UNIQUEMENT par server.js resolveWebSearchGrounding quand la voie Brave
// (avec ou sans clé) n'a produit AUCUN candidat exploitable. Demande à l'IA
// elle-même de PROPOSER des pages web réelles sur le sujet plutôt que
// d'inventer les faits directement — le texte n'est JAMAIS pris pour argent
// comptant : chaque URL proposée retraverse ensuite EXACTEMENT le même
// pipeline que les résultats Brave (filterCandidateSources, scoring
// déterministe, seuil minimal, fetch réel de la page, extraction, validation
// du contenu contre le sujet). Une URL halluciné/périmée est donc simplement
// écartée plus loin (échec de fetch ou contenu hors-sujet), jamais publiée
// telle quelle — la garantie de fiabilité reste la même qu'avec Brave :
// c'est la page RÉELLEMENT récupérée qui fonde la fiche, jamais la mémoire
// du modèle.
function buildSourceGuessPrompt(subject) {
  return [
    `Le moteur de recherche web habituel est indisponible. Pour le sujet "${subject}", propose des pages web RÉELLES et vérifiables qui traitent ce sujet en détail.`,
    "",
    "Règles strictes :",
    "- Ne propose QUE des pages dont tu es réellement confiant qu'elles existent (jamais une URL inventée ou devinée au hasard) ;",
    // Hiérarchie d'autorité des sources (demande du 14/09/2026) : priorité
    // aux pages institutionnelles/officielles/académiques/muséales quand
    // elles existent pour ce sujet précis, avant même les encyclopédies —
    // remplace l'ancien ordre (Wikipédia en tête). Fusionne l'ancienne règle
    // séparée "ajoute 1 à 3 pages institutionnelles" (désormais prioritaire,
    // jamais un simple ajout en fin de liste).
    "- PRIORITÉ aux pages institutionnelles, gouvernementales, universitaires, muséales ou d'organismes officiels/internationaux directement compétents sur ce sujet précis, quand tu en connais de fiables — propose-les en premier (jamais un blog, un site commercial ou un forum) ;",
    "- Complète avec des encyclopédies de référence, dans cet ordre de préférence : Encyclopædia Britannica (britannica.com), Encyclopædia Universalis (universalis.fr), puis Wikipédia en français (URL de la forme https://fr.wikipedia.org/wiki/Nom_De_La_Page, avec underscores, sans espace) — Wikipédia reste une source valide et souvent un bon complément généraliste, jamais à exclure si elle est pertinente et qu'aucune alternative institutionnelle/académique ne la remplace ;",
    // PÉRIMÈTRE DU SUJET (diagnostic qualité éditoriale du 12/09/2026, cas
    // réel "Débuts de l'islam") : même principe que la règle homonyme de
    // buildSourceSelectionPrompt, appliqué ici à la PROPOSITION plutôt qu'à
    // la sélection — ce chemin de repli est actuellement le SEUL actif tant
    // que Brave reste hors quota, donc au moins aussi important à couvrir.
    // Si Wikipédia a PLUSIEURS pages sur des périmètres différents mais
    // apparentés (ex. "Islam", "Expansion de l'islam", "Mahomet" pour le
    // sujet "Débuts de l'islam"), rien n'empêchait jusqu'ici de proposer
    // seulement la plus large/générale des trois — cette règle explicite le
    // choix inverse.
    "- Si Wikipédia (ou une autre encyclopédie) possède PLUSIEURS pages sur des périmètres différents mais apparentés au sujet (ex. une page générale sur tout un domaine ET une page centrée sur une période/un aspect précis de ce domaine), propose PRIORITAIREMENT celle dont le périmètre correspond le mieux à la précision du sujet demandé, jamais seulement la plus large ou la plus générale par réflexe — une page où le sujet demandé n'est qu'un chapitre parmi beaucoup d'autres est un moins bon choix qu'une page qui lui est spécifiquement consacrée, même si les deux existent et sont fiables ; propose les deux si tu hésites vraiment, plutôt que d'omettre la plus précise ;",
    "- Pour chaque page, donne un résumé factuel de 1 à 2 phrases de ce qu'elle contient réellement (jamais une phrase générique type \"page qui parle du sujet\") ;",
    "- Si tu n'es sûr d'aucune page fiable sur ce sujet précis, retourne une liste vide plutôt que de forcer une proposition douteuse.",
    "",
    `Retourne au maximum ${WEB_SEARCH_RAW_RESULTS_COUNT} pages, en JSON strict, sous la forme {"sources":[{"url":"https://...","title":"titre de la page","description":"résumé factuel de 1 à 2 phrases"}]}.`
  ].join("\n");
}

// best-effort, même logique que parseSourceSelectionResponse : un JSON
// malformé ou une entrée invalide est simplement ignorée, jamais une erreur.
// Renvoie une liste dans la MÊME forme que normalizeBraveResults (title,
// url, description, pageAge, extraSnippets) pour que filterCandidateSources/
// rankCandidates/l'extraction en aval n'aient besoin d'AUCUNE branche
// spécifique à cette origine.
function parseGuessedSourcesResponse(rawContent, maxCandidates = WEB_SEARCH_RAW_RESULTS_COUNT) {
  if (!rawContent) return [];
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return [];
  }
  const rawSources = Array.isArray(parsed?.sources) ? parsed.sources : [];
  const seenUrls = new Set();
  const results = [];
  for (const s of rawSources) {
    const url = String(s?.url || "").trim();
    if (!url || !/^https?:\/\//i.test(url) || seenUrls.has(url)) continue;
    seenUrls.add(url);
    results.push({
      title: String(s?.title || "").trim().replace(/\s+/g, " ").slice(0, 300),
      url,
      description: String(s?.description || "").trim().replace(/\s+/g, " ").slice(0, 500),
      pageAge: null,
      extraSnippets: []
    });
    if (results.length >= maxCandidates) break;
  }
  return results.filter((r) => r.title);
}

// Formate le contenu réellement extrait des pages retenues en un bloc de
// texte compact à injecter dans le prompt de fiche — jamais le texte brut
// intégral (cf. WEB_SEARCH_EXCERPT_MAX_CHARS), jamais sans indiquer sa
// provenance (chaque extrait reste attribué à son titre/domaine).
// Sélection représentative (07/09/2026, PROBLÈME 1) : `.slice(0, N)` a été
// remplacé par selectRepresentativeExcerpt (lib/source-excerpt-selection.js)
// — passages répartis sur tout le document plutôt que les N premiers
// caractères. Comportement inchangé pour toute source déjà sous le budget
// (l'immense majorité des sources hors grands articles encyclopédiques) :
// selectRepresentativeExcerpt renvoie alors le texte tel quel, comme le
// faisait déjà `.slice` dans ce cas.
// Étiquette de niveau d'autorité (demande du 14/09/2026, sections 5/6 —
// "sécuriser les affirmations fortes transformées en connaissances à
// mémoriser") : ajoutée en fin de ligne d'en-tête, JAMAIS entre le domaine et
// le titre (format `[Source N — domaine] Titre` conservé tel quel pour tout
// code/test existant qui le recherche) ni sur la ligne d'extrait elle-même
// (qui reste EXACTEMENT le texte tronqué, cf. WEB_SEARCH_EXCERPT_MAX_CHARS) —
// aucun appel réseau/IA supplémentaire, seule classifyDomainAuthorityTier
// (lib/source-scoring.js) déjà pure et déterministe. Permet au modèle de
// rédaction de reconnaître, sans jugement supplémentaire de sa part, qu'une
// affirmation catégorique venant uniquement d'une source de niveau C
// (Wikipédia) mérite plus de prudence qu'une affirmation corroborée par une
// source A+/A — cf. la consigne ajoutée en tête de
// buildFicheAndKnowledgeAdmissionPrompt (lib/knowledge-admission.js).
function buildGroundingText(extractedSources) {
  if (!extractedSources || !extractedSources.length) return null;
  return extractedSources
    .map((s, i) => {
      const domain = s.domain || extractDomain(s.url) || "site web";
      const tier = classifyDomainAuthorityTier(domain);
      return `[Source ${i + 1} — ${domain}] ${s.title} (niveau de fiabilité indicatif : ${tier})\n${selectRepresentativeExcerpt(s.text, { budgetChars: WEB_SEARCH_EXCERPT_MAX_CHARS }).excerpt}`;
    })
    .join("\n\n");
}

// ── Sources identifiables par un id citable (V3, "fiabilisation factuelle
// des QCM par traçabilité aux sources", demande du 31/08/2026) — distinct de
// buildGroundingText ci-dessus (toujours utilisé tel quel pour la fiche et
// la vérification indépendante des connaissances, jamais modifié) : sert
// UNIQUEMENT à la génération des questions, qui doit pouvoir CITER une
// source précise (SOURCE_1, SOURCE_2...) dans son propre JSON de sortie,
// jamais reconstruire une URL ou inventer un identifiant. Le modèle ne
// choisit jamais ces identifiants — ils sont assignés ici, déterministes et
// stables pour tout le reste de la génération (fiche/vérification/questions
// partagent la même liste de sources, dans le même ordre).
function buildIdentifiedSources(extractedSources) {
  return (extractedSources || []).map((s, i) => ({
    sourceId: `SOURCE_${i + 1}`,
    title: s.title,
    url: s.url,
    domain: s.domain || extractDomain(s.url) || null,
    // Sélection représentative (07/09/2026) : cf. commentaire de buildGroundingText.
    text: selectRepresentativeExcerpt(s.text, { budgetChars: WEB_SEARCH_EXCERPT_MAX_CHARS }).excerpt
  }));
}

// Télémétrie légère (audit qualité éditoriale du 07/09/2026, section A7 —
// "pouvoir diagnostiquer facilement un futur cas corpus = infobox") : calcule,
// pour chaque source réellement extraite, les statistiques de sélection
// d'extrait SANS jamais construire les blocs de prompt eux-mêmes — jamais
// affiché à l'utilisateur, seulement journalisé par server.js. Recalcule la
// même sélection déterministe que buildGroundingText/buildIdentifiedSources
// (aucun état partagé, fonction PURE) : coût CPU négligeable (aucun réseau,
// aucun appel IA), jamais un souci de performance pour 1 à 3 sources par
// génération.
function summarizeExtractedSourcesForTelemetry(extractedSources) {
  return (extractedSources || []).map((s, i) => {
    const { stats } = selectRepresentativeExcerpt(s.text, { budgetChars: WEB_SEARCH_EXCERPT_MAX_CHARS });
    return { sourceId: `SOURCE_${i + 1}`, domain: s.domain || extractDomain(s.url) || null, ...stats };
  });
}

// Bloc texte au format demandé (section 4) : un identifiant par source,
// jamais une URL à reconstruire — le modèle recopie l'identifiant tel quel.
function formatIdentifiedSourcesBlock(identifiedSources) {
  if (!identifiedSources || !identifiedSources.length) return null;
  return identifiedSources
    .map((s) => `${s.sourceId}\ntitle: ${s.title || "(sans titre)"}\nurl: ${s.url || ""}\ncontent: ${s.text}`)
    .join("\n\n");
}

// Enrichissement du corpus (V3.2, 31/08/2026 — "fallback d'enrichissement
// des sources") : ajoute de nouvelles sources déjà extraites/validées à une
// liste `identifiedSources` EXISTANTE, sans jamais renuméroter les entrées
// déjà attribuées (section 12 de la demande : "Ne jamais renuméroter les
// premières sources pendant une génération" — sinon les `source_ids` déjà
// associés aux questions déjà acceptées deviendraient faux). L'offset part
// de la longueur actuelle : SOURCE_1..SOURCE_N restent identiques au
// caractère près, les nouvelles reçoivent SOURCE_(N+1), SOURCE_(N+2)...
function appendIdentifiedSources(existingIdentifiedSources, newExtractedSources) {
  const existing = existingIdentifiedSources || [];
  const offset = existing.length;
  const appended = buildIdentifiedSources(newExtractedSources).map((s, i) => ({
    ...s,
    sourceId: `SOURCE_${offset + i + 1}`
  }));
  return [...existing, ...appended];
}

// ── Provenance publique minimale (chantier "persister les sources
// factuelles", 03/09/2026, audit réel "Empire carolingien" — les questions
// persistées portaient déjà source_ids/supporting_claim, mais rien ne
// résolvait "SOURCE_1" vers un domaine ou une URL réelle une fois la
// génération terminée : grounding.identifiedSources ne vivait qu'en
// mémoire). Ne persiste QUE ce qui est nécessaire pour résoudre un
// source_ids et afficher un lien cliquable — jamais le texte extrait
// (`text`), jamais le titre de page, jamais sourceScore (aucune nécessité
// démontrée à ce jour) : ces trois champs restent des détails d'exécution
// internes à CETTE génération, jamais un contenu à conserver durablement.
// Déduplique par URL (jamais par domaine, qui peut légitimement apparaître
// plusieurs fois pour des pages différentes) — garantit une liste déjà
// prête pour un affichage global "Sources" sans répétition, sans que
// l'appelant ait à le refaire.
function buildPublicGroundingSources(identifiedSources) {
  const seenUrls = new Set();
  const result = [];
  for (const source of Array.isArray(identifiedSources) ? identifiedSources : []) {
    const url = String(source?.url || "").trim();
    if (!url || !/^https?:\/\//i.test(url) || seenUrls.has(url)) continue;
    seenUrls.add(url);
    result.push({ sourceId: source.sourceId || null, domain: source.domain || null, url });
  }
  return result;
}

module.exports = {
  BRAVE_SEARCH_ENDPOINT,
  WEB_SEARCH_RAW_RESULTS_COUNT,
  buildPublicGroundingSources,
  buildSourceGuessPrompt,
  parseGuessedSourcesResponse,
  WEB_SEARCH_MAX_SELECTED_SOURCES,
  WEB_SEARCH_EXCERPT_MAX_CHARS,
  EXCLUDED_GROUNDING_DOMAINS,
  extractDomain,
  buildBraveSearchUrl,
  buildAuthorityRetryQuery,
  normalizeBraveResults,
  filterCandidateSources,
  buildSourceSelectionPrompt,
  parseSourceSelectionResponse,
  buildGroundingText,
  buildIdentifiedSources,
  summarizeExtractedSourcesForTelemetry,
  formatIdentifiedSourcesBlock,
  appendIdentifiedSources
};
