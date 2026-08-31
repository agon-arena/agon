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
  buildGroundingText,
  buildIdentifiedSources,
  formatIdentifiedSourcesBlock
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

test("filterCandidateSources : un seul résultat conservé par domaine (dédoublonnage)", () => {
  const raw = [candidate("https://fr.wikipedia.org/wiki/A"), candidate("https://fr.wikipedia.org/wiki/B"), candidate("https://lemonde.fr/article")];
  const filtered = filterCandidateSources(raw);
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map((c) => c.domain), ["fr.wikipedia.org", "lemonde.fr"]);
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

// ---- filterCandidateSources : Wikipédia privilégiée (demande du 31/08/2026) ----

test("filterCandidateSources : place un résultat Wikipédia en tête, même arrivé en dernier dans les résultats bruts", () => {
  const raw = [
    candidate("https://lemonde.fr/article", "Le Monde"),
    candidate("https://exemple.com/page", "Exemple"),
    candidate("https://fr.wikipedia.org/wiki/Photosynthese", "Wikipédia")
  ];
  const filtered = filterCandidateSources(raw);
  assert.equal(filtered[0].domain, "fr.wikipedia.org");
  // L'ordre relatif des autres candidats reste inchangé (tri stable).
  assert.deepEqual(filtered.slice(1).map((c) => c.domain), ["lemonde.fr", "exemple.com"]);
});

test("filterCandidateSources : n'importe quel sous-domaine *.wikipedia.org est reconnu (fr., en., etc.)", () => {
  const raw = [candidate("https://exemple.com/page"), candidate("https://en.wikipedia.org/wiki/Photosynthesis")];
  const filtered = filterCandidateSources(raw);
  assert.equal(filtered[0].domain, "en.wikipedia.org");
});

test("filterCandidateSources : sans résultat Wikipédia, l'ordre d'origine est simplement conservé", () => {
  const raw = [candidate("https://lemonde.fr/article"), candidate("https://exemple.com/page")];
  const filtered = filterCandidateSources(raw);
  assert.deepEqual(filtered.map((c) => c.domain), ["lemonde.fr", "exemple.com"]);
});

// ---- buildSourceSelectionPrompt ----

test("buildSourceSelectionPrompt : liste tous les candidats numérotés avec domaine/titre/résumé", () => {
  const candidates = filterCandidateSources([
    candidate("https://fr.wikipedia.org/wiki/Avalanche", "Avalanche — Wikipédia"),
    candidate("https://lemonde.fr/article", "Un article de presse")
  ]);
  const prompt = buildSourceSelectionPrompt("Avalanche glaciaire", null, candidates);
  assert.match(prompt, /0\. \[fr\.wikipedia\.org\] Avalanche — Wikipédia/);
  assert.match(prompt, /1\. \[lemonde\.fr\] Un article de presse/);
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

test("buildSourceSelectionPrompt : demande explicitement de privilégier Wikipédia quand une page pertinente et fiable existe (demande du 31/08/2026)", () => {
  const candidates = filterCandidateSources([candidate("https://lemonde.fr/article")]);
  const prompt = buildSourceSelectionPrompt("Sujet", null, candidates);
  assert.match(prompt, /choisis-la en premier\/en priorité parmi tes sources retenues/);
  // La priorité ne dispense jamais de vérifier les critères habituels.
  assert.match(prompt, /Cela ne dispense JAMAIS de vérifier qu'elle remplit bien les trois critères/);
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
