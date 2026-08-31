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
const WEB_SEARCH_EXCERPT_MAX_CHARS = 2500;

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

// Wikipédia à privilégier quand c'est possible (demande du 31/08/2026) : un
// simple tri stable place les résultats Wikipédia en tête de la liste
// présentée à l'IA de sélection — ne change jamais QUI est éligible (le
// filtre déterministe ci-dessous reste inchangé) ni ne contourne son
// jugement de pertinence/fiabilité (cf. buildSourceSelectionPrompt, qui
// porte la même consigne de priorité), juste l'ordre de présentation.
const WIKIPEDIA_DOMAIN_PATTERN = /(^|\.)wikipedia\.org$/;

// Filtre déterministe avant l'IA : retire les domaines exclus et les
// doublons de domaine (un seul résultat par domaine, pour ne pas laisser un
// même site squatter toute la sélection via plusieurs pages indexées).
function filterCandidateSources(rawResults, maxCandidates = WEB_SEARCH_RAW_RESULTS_COUNT) {
  const seenDomains = new Set();
  const filtered = [];
  for (const r of (rawResults || [])) {
    const domain = extractDomain(r.url);
    if (!domain || EXCLUDED_GROUNDING_DOMAINS.has(domain) || seenDomains.has(domain)) continue;
    seenDomains.add(domain);
    filtered.push({ ...r, domain });
    if (filtered.length >= maxCandidates) break;
  }
  filtered.sort((a, b) => (WIKIPEDIA_DOMAIN_PATTERN.test(a.domain) ? 0 : 1) - (WIKIPEDIA_DOMAIN_PATTERN.test(b.domain) ? 0 : 1));
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
function buildSourceSelectionPrompt(subject, contextHint, candidates) {
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
    `Retiens au maximum ${WEB_SEARCH_MAX_SELECTED_SOURCES} sources, uniquement celles qui passent clairement ces trois critères. Si aucune ne convient (ex. seuls des articles d'actualité sur un cas précis sont disponibles, rien d'encyclopédique/général), retourne un tableau vide plutôt que de forcer un choix médiocre — une fiche rédigée sans source externe reste préférable à une fiche fondée sur une source douteuse ou hors-sujet.`,
    "",
    "PRIORITÉ : si un résultat pointe vers une page Wikipédia (wikipedia.org, idéalement en français, sinon dans une autre langue) qui correspond clairement au sujet ET remplit les trois critères ci-dessus, choisis-la en premier/en priorité parmi tes sources retenues — Wikipédia reste préférable aux autres sources de qualité équivalente pour ce type de fiche. Cela ne dispense JAMAIS de vérifier qu'elle remplit bien les trois critères (une page Wikipédia hors-sujet ou centrée sur un événement précis reste écartée comme n'importe quelle autre source).",
    "",
    'Réponds uniquement en JSON strict, sous la forme {"selected":[{"index":0,"reason":"raison technique courte, interne, jamais affichée à l\'utilisateur"}]}.'
  ].join("\n");
}

// Conservateur par construction, même logique qu'applyKnowledgeVerificationDecisions :
// un index absent, invalide, dupliqué ou hors bornes est simplement ignoré,
// jamais une erreur — un JSON malformé donne une liste vide (best-effort,
// cf. resolveWebSearchGrounding qui retombe alors sur le flux sans grounding).
function parseSourceSelectionResponse(rawContent, candidates) {
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
    if (selected.length >= WEB_SEARCH_MAX_SELECTED_SOURCES) break;
  }
  return selected;
}

// Formate le contenu réellement extrait des pages retenues en un bloc de
// texte compact à injecter dans le prompt de fiche — jamais le texte brut
// intégral (cf. WEB_SEARCH_EXCERPT_MAX_CHARS), jamais sans indiquer sa
// provenance (chaque extrait reste attribué à son titre/domaine).
function buildGroundingText(extractedSources) {
  if (!extractedSources || !extractedSources.length) return null;
  return extractedSources
    .map((s, i) => `[Source ${i + 1} — ${s.domain || extractDomain(s.url) || "site web"}] ${s.title}\n${String(s.text || "").slice(0, WEB_SEARCH_EXCERPT_MAX_CHARS)}`)
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
    text: String(s.text || "").slice(0, WEB_SEARCH_EXCERPT_MAX_CHARS)
  }));
}

// Bloc texte au format demandé (section 4) : un identifiant par source,
// jamais une URL à reconstruire — le modèle recopie l'identifiant tel quel.
function formatIdentifiedSourcesBlock(identifiedSources) {
  if (!identifiedSources || !identifiedSources.length) return null;
  return identifiedSources
    .map((s) => `${s.sourceId}\ntitle: ${s.title || "(sans titre)"}\nurl: ${s.url || ""}\ncontent: ${s.text}`)
    .join("\n\n");
}

module.exports = {
  BRAVE_SEARCH_ENDPOINT,
  WEB_SEARCH_RAW_RESULTS_COUNT,
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
  formatIdentifiedSourcesBlock
};
