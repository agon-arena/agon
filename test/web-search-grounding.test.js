"use strict";

// Couvre lib/web-search-grounding.js (grounding par recherche web réelle,
// demande du 31/08/2026) — fonctions pures uniquement (construction de
// requête/prompt, normalisation et validation d'une réponse déjà reçue),
// jamais l'appel réseau lui-même (Brave/OpenAI/fetch de page), orchestré par
// server.js (resolveWebSearchGrounding), hors de portée d'un test unitaire
// déterministe.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BRAVE_SEARCH_ENDPOINT,
  WEB_SEARCH_MAX_SELECTED_SOURCES,
  WEB_SEARCH_EXCERPT_MAX_CHARS,
  EXCLUDED_GROUNDING_DOMAINS,
  extractDomain,
  buildBraveSearchUrl,
  normalizeBraveResults,
  filterCandidateSources,
  buildSourceSelectionPrompt,
  parseSourceSelectionResponse,
  buildSourceGuessPrompt,
  parseGuessedSourcesResponse,
  buildGroundingText,
  buildIdentifiedSources,
  formatIdentifiedSourcesBlock,
  appendIdentifiedSources
} = require("../lib/web-search-grounding");

// ---- extractDomain ----

test("extractDomain : retire le préfixe www et met en minuscules", () => {
  assert.equal(extractDomain("https://WWW.Wikipedia.org/wiki/Foo"), "wikipedia.org");
});

test("extractDomain : une URL invalide renvoie null sans jamais planter", () => {
  assert.equal(extractDomain("pas une url"), null);
  assert.equal(extractDomain(""), null);
  assert.equal(extractDomain(undefined), null);
});

// ---- buildBraveSearchUrl ----

test("buildBraveSearchUrl : construit une URL sur le bon endpoint avec la requête encodée", () => {
  const url = buildBraveSearchUrl("avalanche glaciaire", 5);
  assert.match(url, new RegExp(`^${BRAVE_SEARCH_ENDPOINT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?`));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("q"), "avalanche glaciaire");
  assert.equal(parsed.searchParams.get("count"), "5");
});

test("buildBraveSearchUrl : plafonne le nombre de résultats demandés entre 1 et 20", () => {
  assert.equal(new URL(buildBraveSearchUrl("x", 0)).searchParams.get("count"), "1");
  assert.equal(new URL(buildBraveSearchUrl("x", 999)).searchParams.get("count"), "20");
});

// ---- normalizeBraveResults ----

test("normalizeBraveResults : extrait titre/url/description depuis web.results", () => {
  const raw = { web: { results: [{ title: "  Avalanche  glaciaire  ", url: "https://fr.wikipedia.org/wiki/Avalanche", description: "Un phénomène." }] } };
  const results = normalizeBraveResults(raw);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Avalanche glaciaire");
  assert.equal(results[0].url, "https://fr.wikipedia.org/wiki/Avalanche");
  assert.equal(results[0].description, "Un phénomène.");
});

test("normalizeBraveResults : une structure non conforme renvoie [] plutôt que de planter", () => {
  assert.deepEqual(normalizeBraveResults(null), []);
  assert.deepEqual(normalizeBraveResults({}), []);
  assert.deepEqual(normalizeBraveResults({ web: {} }), []);
  assert.deepEqual(normalizeBraveResults({ web: { results: "pas un tableau" } }), []);
});

test("normalizeBraveResults : écarte les résultats sans titre, sans url, ou avec une url non http(s)", () => {
  const raw = {
    web: {
      results: [
        { title: "", url: "https://example.com" },
        { title: "Sans url", url: "" },
        { title: "Protocole invalide", url: "ftp://example.com/x" },
        { title: "Valide", url: "https://example.com/valide" }
      ]
    }
  };
  const results = normalizeBraveResults(raw);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Valide");
});

// ---- filterCandidateSources ----

function candidate(url, title = "Titre") {
  return { title, url, description: "" };
}

test("filterCandidateSources : écarte les domaines exclus (réseaux sociaux/forums)", () => {
  const raw = [candidate("https://www.facebook.com/x"), candidate("https://reddit.com/r/x"), candidate("https://lemonde.fr/article")];
  const filtered = filterCandidateSources(raw);
  assert.deepEqual(filtered.map((c) => c.domain), ["lemonde.fr"]);
});

test("filterCandidateSources : un domaine NON-Wikipédia est plafonné à 2 résultats par défaut (jamais 1, jamais illimité)", () => {
  const raw = [candidate("https://lemonde.fr/a"), candidate("https://lemonde.fr/b"), candidate("https://lemonde.fr/c"), candidate("https://exemple.com/page")];
  const filtered = filterCandidateSources(raw);
  assert.equal(filtered.filter((c) => c.domain === "lemonde.fr").length, 2);
  assert.equal(filtered.length, 3);
});

test("filterCandidateSources : maxPerDomain personnalisé (3e paramètre) reste ajustable pour les domaines non-Wikipédia", () => {
  const raw = Array.from({ length: 4 }, (_, i) => candidate(`https://lemonde.fr/page${i}`));
  assert.equal(filterCandidateSources(raw, 10, 1).length, 1);
  assert.equal(filterCandidateSources(raw, 10, 4).length, 4);
});

// Wikipédia EXEMPTÉE du plafond par domaine (diagnostic qualité éditoriale
// du 12/09/2026, cas réel "Débuts de l'islam" — même un plafond de 2
// écartait toujours silencieusement "Expansion de l'islam", 5e page
// fr.wikipedia.org distincte proposée par l'IA de repli, la plus
// précisément centrée sur le sujet parmi les 5, avant même que l'IA de
// sélection ne puisse la voir : aucun plafond de POSITION ne peut garantir
// que le meilleur candidat survit s'il arrive tard dans une liste sans
// ordre de pertinence garanti).
test("filterCandidateSources : Wikipédia n'est jamais plafonnée par domaine, contrairement aux autres — 5 pages distinctes toutes conservées", () => {
  const raw = [
    candidate("https://fr.wikipedia.org/wiki/Islam"),
    candidate("https://fr.wikipedia.org/wiki/Mahomet"),
    candidate("https://fr.wikipedia.org/wiki/Hegire"),
    candidate("https://fr.wikipedia.org/wiki/Arabie_preislamique"),
    candidate("https://fr.wikipedia.org/wiki/Expansion_de_l_islam")
  ];
  const filtered = filterCandidateSources(raw, 10);
  assert.equal(filtered.length, 5);
  assert.ok(filtered.some((c) => c.url.includes("Expansion_de_l_islam")), "la page la plus précisément centrée sur le sujet, arrivée en dernier, doit survivre");
});

test("filterCandidateSources : Wikipédia reste borné par le plafond GLOBAL maxCandidates, même sans plafond par domaine", () => {
  const raw = Array.from({ length: 10 }, (_, i) => candidate(`https://fr.wikipedia.org/wiki/Page${i}`));
  const filtered = filterCandidateSources(raw, 4);
  assert.equal(filtered.length, 4);
});

test("filterCandidateSources : déduplique par URL EXACTE (jamais par domaine seul) — une même page proposée deux fois ne compte qu'une fois", () => {
  const raw = [
    candidate("https://fr.wikipedia.org/wiki/A"),
    candidate("https://fr.wikipedia.org/wiki/A"),
    candidate("https://fr.wikipedia.org/wiki/B")
  ];
  const filtered = filterCandidateSources(raw);
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map((c) => c.url), ["https://fr.wikipedia.org/wiki/A", "https://fr.wikipedia.org/wiki/B"]);
});

test("filterCandidateSources : plafonne au nombre maximal de candidats demandé", () => {
  const raw = Array.from({ length: 10 }, (_, i) => candidate(`https://site${i}.example.com/page`));
  const filtered = filterCandidateSources(raw, 3);
  assert.equal(filtered.length, 3);
});

test("filterCandidateSources : une url sans domaine extractible est écartée sans planter", () => {
  const raw = [{ title: "Invalide", url: "pas une url", description: "" }, candidate("https://lemonde.fr/article")];
  const filtered = filterCandidateSources(raw);
  assert.equal(filtered.length, 1);
});

// ---- filterCandidateSources : hiérarchie d'autorité A+/A/B/C (demande du
// 14/09/2026, remplace l'ancienne priorité "Wikipédia en tête") ----

test("filterCandidateSources : une source institutionnelle (A+) passe devant Wikipédia (C), même arrivée en dernier dans les résultats bruts", () => {
  const raw = [
    candidate("https://fr.wikipedia.org/wiki/Photosynthese", "Wikipédia"),
    candidate("https://exemple.com/page", "Exemple"),
    candidate("https://nasa.gov/photosynthesis", "NASA")
  ];
  const filtered = filterCandidateSources(raw);
  assert.equal(filtered[0].domain, "nasa.gov");
});

test("filterCandidateSources : sans domaine plus autorisé, Wikipédia (n'importe quel sous-domaine *.wikipedia.org) reste un candidat exploitable, pas écartée", () => {
  const raw = [candidate("https://exemple.com/page"), candidate("https://en.wikipedia.org/wiki/Photosynthesis")];
  const filtered = filterCandidateSources(raw);
  assert.ok(filtered.some((c) => c.domain === "en.wikipedia.org"));
});

test("filterCandidateSources : entre deux sources de même niveau (B, aucune autorité reconnue), l'ordre d'origine est simplement conservé", () => {
  const raw = [candidate("https://lemonde.fr/article"), candidate("https://exemple.com/page")];
  const filtered = filterCandidateSources(raw);
  assert.deepEqual(filtered.map((c) => c.domain), ["lemonde.fr", "exemple.com"]);
});

// ---- buildSourceSelectionPrompt ----

test("buildSourceSelectionPrompt : liste tous les candidats numérotés avec domaine/titre/résumé", () => {
  const candidates = filterCandidateSources([
    candidate("https://lemonde.fr/article", "Un article de presse"),
    candidate("https://fr.wikipedia.org/wiki/Avalanche", "Avalanche — Wikipédia")
  ]);
  const prompt = buildSourceSelectionPrompt("Avalanche glaciaire", null, candidates);
  assert.match(prompt, /0\. \[lemonde\.fr\] Un article de presse/);
  assert.match(prompt, /1\. \[fr\.wikipedia\.org\] Avalanche — Wikipédia/);
});

test("buildSourceSelectionPrompt : exige à la fois la pertinence ET la fiabilité éditoriale", () => {
  const candidates = filterCandidateSources([candidate("https://lemonde.fr/article")]);
  const prompt = buildSourceSelectionPrompt("Sujet", null, candidates);
  assert.match(prompt, /réellement sur CE sujet précis/);
  assert.match(prompt, /éditorialement fiables/);
});

test("buildSourceSelectionPrompt : rejette explicitement un article de presse sur UN épisode précis récent, même fiable, au profit d'une source encyclopédique générale (régression Avalanche glaciaire/Népal du 31/08/2026)", () => {
  const candidates = filterCandidateSources([candidate("https://lemonde.fr/article")]);
  const prompt = buildSourceSelectionPrompt("Avalanche glaciaire", null, candidates);
  assert.match(prompt, /JAMAIS un article relatant UN épisode\/événement\/incident précis et récent/);
  assert.match(prompt, /même si le sujet y est mentionné en toutes lettres et même si la source est par ailleurs fiable/);
  assert.match(prompt, /Préfère toujours une page de référence\/encyclopédique\/pédagogique/);
});

test("buildSourceSelectionPrompt : demande explicitement de privilégier une source institutionnelle/académique à Wikipédia, sans jamais l'exclure (hiérarchie d'autorité, demande du 14/09/2026)", () => {
  const candidates = filterCandidateSources([candidate("https://lemonde.fr/article")]);
  const prompt = buildSourceSelectionPrompt("Sujet", null, candidates);
  assert.match(prompt, /HIÉRARCHIE D'AUTORITÉ/);
  assert.match(prompt, /préfère toujours une source institutionnelle, gouvernementale, universitaire, muséale ou une encyclopédie académique\/spécialisée de référence/);
  assert.match(prompt, /ne l'écarte jamais si elle est la seule pertinente et fiable disponible/);
  // La priorité ne dispense jamais de vérifier les critères habituels.
  assert.match(prompt, /Cela ne dispense JAMAIS de vérifier que la source institutionnelle\/académique remplit elle-même les trois critères/);
});

test("buildSourceSelectionPrompt : autorise explicitement un tableau vide plutôt qu'un choix médiocre", () => {
  const candidates = filterCandidateSources([candidate("https://lemonde.fr/article")]);
  const prompt = buildSourceSelectionPrompt("Sujet", null, candidates);
  assert.match(prompt, /retourne un tableau vide plutôt que de forcer un choix médiocre/);
});

test("buildSourceSelectionPrompt : inclut le contexte quand fourni, l'omet sinon", () => {
  const candidates = filterCandidateSources([candidate("https://lemonde.fr/article")]);
  const withContext = buildSourceSelectionPrompt("Sujet", "contexte additionnel", candidates);
  const withoutContext = buildSourceSelectionPrompt("Sujet", null, candidates);
  assert.match(withContext, /contexte additionnel/);
  assert.doesNotMatch(withoutContext, /contexte additionnel/);
});

// Audit qualité éditoriale du 07/09/2026 (section 11 de la demande) : la
// priorité Wikipédia reste utile mais ne doit jamais aboutir mécaniquement à
// 3 sources redondantes de type encyclopédie/infobox généraliste — préférer
// une combinaison complémentaire (une source encyclopédique générale + des
// sources institutionnelles/académiques/spécialisées quand elles existent).
// Prompt uniquement, aucune requête Brave supplémentaire.
test("buildSourceSelectionPrompt : encourage une combinaison complémentaire plutôt que 3 sources redondantes de même type descriptif", () => {
  const candidates = filterCandidateSources([candidate("https://lemonde.fr/article")]);
  const prompt = buildSourceSelectionPrompt("Sujet", null, candidates);
  assert.match(prompt, /préfère une COMBINAISON complémentaire/);
  assert.match(prompt, /sources institutionnelles, académiques ou spécialisées qui apportent un angle différent/);
});

test("buildSourceSelectionPrompt : la consigne de diversité ne dispense jamais des trois critères de fiabilité/pertinence (pas d'exclusion forcée)", () => {
  const candidates = filterCandidateSources([candidate("https://lemonde.fr/article")]);
  const prompt = buildSourceSelectionPrompt("Sujet", null, candidates);
  assert.match(prompt, /N'écarte cependant jamais une source par ailleurs pertinente et fiable simplement pour "faire varier" artificiellement les types/);
});

test("buildSourceSelectionPrompt : la hiérarchie d'autorité reste intacte malgré la consigne de diversité", () => {
  const candidates = filterCandidateSources([candidate("https://lemonde.fr/article")]);
  const prompt = buildSourceSelectionPrompt("Sujet", null, candidates);
  assert.match(prompt, /HIÉRARCHIE D'AUTORITÉ/);
});

// Diagnostic qualité éditoriale du 12/09/2026, cas réel "Débuts de l'islam" —
// à candidats égaux en pertinence/fiabilité, une source panoramique
// (ex. "Histoire de l'islam", quatorze siècles) diluait le sujet demandé
// face à une source dont le périmètre y correspond précisément (ex.
// "Expansion de l'islam") sans que le prompt n'en dise jamais rien.
test("buildSourceSelectionPrompt : demande de préférer une source dont le périmètre correspond à la précision du sujet plutôt qu'un article panoramique beaucoup plus large", () => {
  const candidates = filterCandidateSources([candidate("https://lemonde.fr/article")]);
  const prompt = buildSourceSelectionPrompt("Sujet", null, candidates);
  assert.match(prompt, /PÉRIMÈTRE DU SUJET/);
  assert.match(prompt, /préfère toujours une source dont le PÉRIMÈTRE correspond à la précision du sujet demandé/);
  assert.match(prompt, /N'écarte cependant jamais une source par ailleurs pertinente et fiable simplement parce qu'elle est plus large que le sujet strict/);
});

// ---- parseSourceSelectionResponse ----

test("parseSourceSelectionResponse : conserve les index valides dans l'ordre de la réponse", () => {
  const candidates = [candidate("https://a.example.com"), candidate("https://b.example.com")];
  const selected = parseSourceSelectionResponse(JSON.stringify({ selected: [{ index: 1 }, { index: 0 }] }), candidates);
  assert.deepEqual(selected.map((c) => c.url), ["https://b.example.com", "https://a.example.com"]);
});

test("parseSourceSelectionResponse : ignore un index hors bornes, dupliqué ou non entier", () => {
  const candidates = [candidate("https://a.example.com")];
  const selected = parseSourceSelectionResponse(JSON.stringify({ selected: [{ index: 5 }, { index: 0 }, { index: 0 }, { index: 0.5 }] }), candidates);
  assert.deepEqual(selected.map((c) => c.url), ["https://a.example.com"]);
});

test("parseSourceSelectionResponse : un JSON invalide, vide, ou 'selected' absent renvoie []", () => {
  const candidates = [candidate("https://a.example.com")];
  assert.deepEqual(parseSourceSelectionResponse("", candidates), []);
  assert.deepEqual(parseSourceSelectionResponse("pas du json", candidates), []);
  assert.deepEqual(parseSourceSelectionResponse(JSON.stringify({}), candidates), []);
  assert.deepEqual(parseSourceSelectionResponse(JSON.stringify({ selected: [] }), candidates), []);
});

test("parseSourceSelectionResponse : plafonne au nombre maximal de sources retenues", () => {
  const candidates = Array.from({ length: 10 }, (_, i) => candidate(`https://site${i}.example.com`));
  const selection = { selected: candidates.map((_, i) => ({ index: i })) };
  const selected = parseSourceSelectionResponse(JSON.stringify(selection), candidates);
  assert.equal(selected.length, WEB_SEARCH_MAX_SELECTED_SOURCES);
});

// ---- buildSourceGuessPrompt (repli sans Brave) ----

test("buildSourceGuessPrompt : demande explicitement des pages réelles et vérifiables, jamais une invention", () => {
  const prompt = buildSourceGuessPrompt("Sujet");
  assert.match(prompt, /pages web RÉELLES et vérifiables/);
  assert.match(prompt, /jamais une URL inventée ou devinée au hasard/);
});

// Diagnostic qualité éditoriale du 12/09/2026, cas réel "Débuts de l'islam" —
// ce chemin est le SEUL actif tant que Brave reste hors quota (constaté en
// conditions réelles le même jour, HTTP 402) : au moins aussi important à
// couvrir que buildSourceSelectionPrompt pour la même règle.
test("buildSourceGuessPrompt : demande de proposer PRIORITAIREMENT la page dont le périmètre correspond le mieux au sujet quand plusieurs pages apparentées existent, jamais seulement la plus large par réflexe", () => {
  const prompt = buildSourceGuessPrompt("Débuts de l'islam");
  assert.match(prompt, /propose PRIORITAIREMENT celle dont le périmètre correspond le mieux à la précision du sujet demandé/);
  assert.match(prompt, /jamais seulement la plus large ou la plus générale par réflexe/);
  assert.match(prompt, /propose les deux si tu hésites vraiment, plutôt que d'omettre la plus précise/);
});

test("buildSourceGuessPrompt : plafonne explicitement à WEB_SEARCH_RAW_RESULTS_COUNT pages", () => {
  const prompt = buildSourceGuessPrompt("Sujet");
  assert.match(prompt, new RegExp(`Retourne au maximum ${require("../lib/web-search-grounding").WEB_SEARCH_RAW_RESULTS_COUNT} pages`));
});

// ---- parseGuessedSourcesResponse ----

test("parseGuessedSourcesResponse : parse une liste de sources proposées, dans la même forme que normalizeBraveResults", () => {
  const raw = JSON.stringify({ sources: [{ url: "https://fr.wikipedia.org/wiki/Sujet", title: "Sujet", description: "Résumé." }] });
  const parsed = parseGuessedSourcesResponse(raw);
  assert.equal(parsed.length, 1);
  assert.deepEqual(Object.keys(parsed[0]).sort(), ["description", "extraSnippets", "pageAge", "title", "url"].sort());
});

test("parseGuessedSourcesResponse : JSON malformé ou vide -> tableau vide, jamais une exception", () => {
  assert.deepEqual(parseGuessedSourcesResponse(""), []);
  assert.deepEqual(parseGuessedSourcesResponse("pas du json"), []);
  assert.deepEqual(parseGuessedSourcesResponse(JSON.stringify({})), []);
});

test("parseGuessedSourcesResponse : déduplique par URL et écarte les URL invalides", () => {
  const raw = JSON.stringify({
    sources: [
      { url: "https://exemple.com/a", title: "A" },
      { url: "https://exemple.com/a", title: "A doublon" },
      { url: "pas une url", title: "Invalide" },
      { url: "https://exemple.com/b", title: "B" }
    ]
  });
  const parsed = parseGuessedSourcesResponse(raw);
  assert.deepEqual(parsed.map((s) => s.url), ["https://exemple.com/a", "https://exemple.com/b"]);
});

// ---- buildGroundingText ----

test("buildGroundingText : null pour une liste vide ou absente (jamais un bloc vide)", () => {
  assert.equal(buildGroundingText([]), null);
  assert.equal(buildGroundingText(null), null);
  assert.equal(buildGroundingText(undefined), null);
});

test("buildGroundingText : attribue chaque extrait à son domaine/titre", () => {
  const text = buildGroundingText([{ title: "Avalanche — Wikipédia", domain: "fr.wikipedia.org", url: "https://fr.wikipedia.org/wiki/Avalanche", text: "Contenu réel de la page." }]);
  assert.match(text, /\[Source 1 — fr\.wikipedia\.org\] Avalanche — Wikipédia/);
  assert.match(text, /Contenu réel de la page\./);
});

test("buildGroundingText : tronque chaque extrait à WEB_SEARCH_EXCERPT_MAX_CHARS", () => {
  const longText = "a".repeat(WEB_SEARCH_EXCERPT_MAX_CHARS + 500);
  const text = buildGroundingText([{ title: "T", domain: "example.com", url: "https://example.com", text: longText }]);
  const excerptLine = text.split("\n")[1];
  assert.equal(excerptLine.length, WEB_SEARCH_EXCERPT_MAX_CHARS);
});

test("buildGroundingText : plusieurs sources sont numérotées et séparées", () => {
  const text = buildGroundingText([
    { title: "A", domain: "a.com", url: "https://a.com", text: "Texte A." },
    { title: "B", domain: "b.com", url: "https://b.com", text: "Texte B." }
  ]);
  assert.match(text, /\[Source 1 — a\.com\] A/);
  assert.match(text, /\[Source 2 — b\.com\] B/);
});

// ---- buildIdentifiedSources / formatIdentifiedSourcesBlock (V3, 31/08/2026) ----

test("buildIdentifiedSources : assigne SOURCE_1, SOURCE_2... dans l'ordre, jamais choisi par le modèle", () => {
  const identified = buildIdentifiedSources([
    { title: "A", domain: "a.com", url: "https://a.com", text: "Texte A." },
    { title: "B", domain: "b.com", url: "https://b.com", text: "Texte B." }
  ]);
  assert.deepEqual(identified.map((s) => s.sourceId), ["SOURCE_1", "SOURCE_2"]);
  assert.equal(identified[0].url, "https://a.com");
});

test("buildIdentifiedSources : tronque le contenu à WEB_SEARCH_EXCERPT_MAX_CHARS", () => {
  const longText = "a".repeat(WEB_SEARCH_EXCERPT_MAX_CHARS + 500);
  const identified = buildIdentifiedSources([{ title: "T", url: "https://example.com", text: longText }]);
  assert.equal(identified[0].text.length, WEB_SEARCH_EXCERPT_MAX_CHARS);
});

test("buildIdentifiedSources : liste vide ou absente renvoie []", () => {
  assert.deepEqual(buildIdentifiedSources([]), []);
  assert.deepEqual(buildIdentifiedSources(null), []);
});

test("formatIdentifiedSourcesBlock : format exact demandé (SOURCE_N puis title/url/content), jamais une URL à reconstruire", () => {
  const identified = buildIdentifiedSources([{ title: "Mon titre", domain: "exemple.fr", url: "https://exemple.fr/page", text: "Contenu réel." }]);
  const block = formatIdentifiedSourcesBlock(identified);
  assert.match(block, /^SOURCE_1\ntitle: Mon titre\nurl: https:\/\/exemple\.fr\/page\ncontent: Contenu réel\./);
});

test("formatIdentifiedSourcesBlock : plusieurs sources séparées, numérotées dans l'ordre", () => {
  const identified = buildIdentifiedSources([
    { title: "A", url: "https://a.com", text: "Texte A." },
    { title: "B", url: "https://b.com", text: "Texte B." }
  ]);
  const block = formatIdentifiedSourcesBlock(identified);
  assert.match(block, /SOURCE_1[\s\S]*SOURCE_2/);
});

test("formatIdentifiedSourcesBlock : liste vide renvoie null (jamais un bloc vide envoyé au modèle)", () => {
  assert.equal(formatIdentifiedSourcesBlock([]), null);
  assert.equal(formatIdentifiedSourcesBlock(null), null);
});

// ---- EXCLUDED_GROUNDING_DOMAINS : garde-fou déterministe, pas seulement l'IA ----

test("EXCLUDED_GROUNDING_DOMAINS : couvre les principaux réseaux sociaux/forums/UGC", () => {
  for (const domain of ["facebook.com", "twitter.com", "x.com", "reddit.com", "tiktok.com"]) {
    assert.ok(EXCLUDED_GROUNDING_DOMAINS.has(domain), `${domain} devrait être exclu`);
  }
});

// ---- maxSelected (V3.2, 31/08/2026 — "fallback d'enrichissement des
// sources") : réutilisation du même prompt/parseur de sélection pour le
// fallback documentaire, avec un plafond plus bas ----

test("buildSourceSelectionPrompt : maxSelected par défaut reste WEB_SEARCH_MAX_SELECTED_SOURCES (comportement inchangé)", () => {
  const candidates = [{ domain: "a.com", title: "A", description: "desc" }];
  const prompt = buildSourceSelectionPrompt("Sujet", null, candidates);
  assert.match(prompt, new RegExp(`maximum ${WEB_SEARCH_MAX_SELECTED_SOURCES} sources`));
});

test("buildSourceSelectionPrompt : maxSelected personnalisé (fallback d'expansion) apparaît dans la consigne", () => {
  const candidates = [{ domain: "a.com", title: "A", description: "desc" }];
  const prompt = buildSourceSelectionPrompt("Sujet", null, candidates, 2);
  assert.match(prompt, /maximum 2 sources/);
});

test("parseSourceSelectionResponse : maxSelected par défaut plafonne à WEB_SEARCH_MAX_SELECTED_SOURCES (comportement inchangé)", () => {
  const candidates = [{ domain: "a" }, { domain: "b" }, { domain: "c" }, { domain: "d" }];
  const selection = { selected: [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }] };
  const selected = parseSourceSelectionResponse(JSON.stringify(selection), candidates);
  assert.equal(selected.length, WEB_SEARCH_MAX_SELECTED_SOURCES);
});

test("parseSourceSelectionResponse : maxSelected personnalisé plafonne strictement (jamais au-delà)", () => {
  const candidates = [{ domain: "a" }, { domain: "b" }, { domain: "c" }];
  const selection = { selected: [{ index: 0 }, { index: 1 }, { index: 2 }] };
  const selected = parseSourceSelectionResponse(JSON.stringify(selection), candidates, 2);
  assert.equal(selected.length, 2);
  assert.deepEqual(selected, [candidates[0], candidates[1]]);
});

// ---- appendIdentifiedSources (V3.2) : identifiants SOURCE_N stables ----

test("appendIdentifiedSources : les identifiants existants restent identiques au caractère près", () => {
  const existing = buildIdentifiedSources([
    { title: "A", url: "https://a.com", domain: "a.com", text: "Texte A." },
    { title: "B", url: "https://b.com", domain: "b.com", text: "Texte B." }
  ]);
  const merged = appendIdentifiedSources(existing, [{ title: "C", url: "https://c.com", domain: "c.com", text: "Texte C." }]);
  assert.deepEqual(merged[0], existing[0]);
  assert.deepEqual(merged[1], existing[1]);
});

test("appendIdentifiedSources : les nouvelles sources reçoivent SOURCE_(N+1), SOURCE_(N+2)...", () => {
  const existing = buildIdentifiedSources([
    { title: "A", url: "https://a.com", domain: "a.com", text: "Texte A." },
    { title: "B", url: "https://b.com", domain: "b.com", text: "Texte B." },
    { title: "C", url: "https://c.com", domain: "c.com", text: "Texte C." }
  ]);
  const merged = appendIdentifiedSources(existing, [
    { title: "D", url: "https://d.com", domain: "d.com", text: "Texte D." },
    { title: "E", url: "https://e.com", domain: "e.com", text: "Texte E." }
  ]);
  assert.equal(merged.length, 5);
  assert.equal(merged[3].sourceId, "SOURCE_4");
  assert.equal(merged[4].sourceId, "SOURCE_5");
  assert.equal(merged[3].title, "D");
  assert.equal(merged[4].title, "E");
});

test("appendIdentifiedSources : liste existante vide se comporte comme buildIdentifiedSources", () => {
  const merged = appendIdentifiedSources([], [{ title: "A", url: "https://a.com", text: "Texte A." }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].sourceId, "SOURCE_1");
});

test("appendIdentifiedSources : liste existante null ne jette jamais, se comporte comme []", () => {
  assert.doesNotThrow(() => appendIdentifiedSources(null, [{ title: "A", url: "https://a.com", text: "T." }]));
  const merged = appendIdentifiedSources(null, [{ title: "A", url: "https://a.com", text: "T." }]);
  assert.equal(merged[0].sourceId, "SOURCE_1");
});

test("appendIdentifiedSources : aucune nouvelle source renvoie la liste existante inchangée", () => {
  const existing = buildIdentifiedSources([{ title: "A", url: "https://a.com", domain: "a.com", text: "Texte A." }]);
  const merged = appendIdentifiedSources(existing, []);
  assert.deepEqual(merged, existing);
});
