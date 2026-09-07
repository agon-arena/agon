"use strict";

// Notions à approfondir/mémoriser des arènes (chantier "catalogue-first",
// demande du 07/09/2026, suite au diagnostic lecture seule du même jour) :
// avant ce chantier, CHAQUE arène (Actualité ou Communauté) déclenchait
// systématiquement un appel IA (gpt-4.1-mini, feature "knowledge_related_
// notions") pour choisir jusqu'à 5 notions — jamais de réutilisation, même
// entre deux arènes strictement identiques (cas réel trouvé lors de l'audit :
// deux arènes "Explosion...Aubervilliers" au contenu identique, deux jeux de
// notions régénérés indépendamment).
//
// Cascade cible (server.js orchestre, ce fichier ne fait QUE la décision
// pure) : 1) réutilisation d'une arène quasi-identique déjà prête (0 coût) ;
// 2) recherche dans le catalogue Mnoria existant (masters notion:custom:*,
// 0 coût) ; 3) UNIQUEMENT si les deux niveaux précédents n'ont produit AUCUNE
// notion valide, un unique appel IA (jamais plus). Dès qu'un niveau gratuit
// produit au moins une notion valide, on s'arrête là — 3 reste un PLAFOND,
// jamais un objectif à remplir (demande explicite : "une seule notion
// excellente est un résultat parfaitement valide").
//
// Fichier volontairement PUR (aucun réseau, aucun accès DB) — même principe
// que lib/topic-dedup.js/lib/knowledge-admission.js — pour rester testable
// sans OpenAI ni Supabase. Seule exception au sein de ce dépôt : l'orchestrateur
// `selectDebateTopicNotions` est asynchrone car il reçoit `callAi` en
// paramètre (jamais appelé lui-même à un module réseau) — permet de vérifier
// en test le nombre EXACT d'invocations IA (0 ou 1, jamais plus) sans mock
// de fetch ni de réseau réel.

const { normalizeTopicText, contentTokens: baseContentTokens } = require("./topic-dedup");

// 3 = plafond final (demande du 07/09/2026, remplace l'ancien plafond de 5) —
// jamais un minimum, jamais une cible à remplir artificiellement.
const MAX_DEBATE_TOPIC_NOTIONS = 3;

// Petite liste, volontairement courte (demande explicite : "pas une énorme
// blacklist fragile") — ne rejette QUE les noms réduits à un seul mot-contenu
// appartenant à cet ensemble, jamais une phrase qui le contient parmi
// d'autres mots (ex. "Politique monétaire" n'est JAMAIS concerné, cf. tests).
const GENERIC_TOPIC_BLACKLIST = new Set([
  "politique", "economie", "histoire", "science", "europe", "monde", "societe", "culture"
]);

function sanitizeName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 60) : "";
}

function sanitizeExplanation(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 500) : "";
}

// Slug stable dérivé du nom — copie volontaire de slugifyDebateNotionName
// (server.js) : garder ce fichier sans dépendance vers server.js (qui ne
// peut de toute façon pas être require() en test), même règle exacte.
function slugifyName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Simplification volontaire du pluriel français (demande : "formes singulier/
// pluriel simples si faisable proprement") — heuristique minimale, jamais une
// vraie lemmatisation : ne retire un "s" final que sur un mot assez long pour
// que ce ne soit presque jamais un faux positif (ex. jamais "gaz"/"pays").
function singularize(token) {
  return token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token;
}

// Mots-contenu (stopwords déjà retirés par contentTokens de lib/topic-dedup.js,
// réutilisé tel quel — jamais une seconde liste de stopwords à maintenir),
// chaque token également disponible sous sa forme singularisée pour la
// comparaison de couverture ci-dessous.
function contentTokens(text) {
  return baseContentTokens(text);
}

// Acronyme déterministe à partir des tokens-contenu d'un nom catalogue (ex.
// ["banque","centrale","europeenne"] -> "BCE") — permet de matcher un
// article qui n'écrit jamais le nom complet mais seulement son sigle, sans
// aucune table d'alias à maintenir (demande explicite du 07/09/2026 : "si
// Mnoria possède déjà une logique équivalente, réutilise-la" — elle n'existe
// pas encore, cette fonction est la plus simple possible qui couvre le
// besoin réel, jamais une base d'alias figée).
function computeInitialsAcronym(tokens) {
  if (tokens.length < 2) return null;
  const initials = tokens.map((t) => t[0]).join("").toUpperCase();
  return initials.length >= 2 && initials.length <= 6 ? initials : null;
}

// Sigles réellement présents dans le texte BRUT (avant normalisation/
// minuscule, qui détruirait le seul signal distinguant un sigle d'un mot
// ordinaire) — mots de 2 à 6 lettres majuscules, bornés par des séparateurs
// non-alphanumériques.
function extractRawAcronyms(rawText) {
  const matches = String(rawText || "").match(/\b[A-ZÀ-Ý]{2,6}\b/g) || [];
  return new Set(matches);
}

// Couverture lexicale forte (demande du 07/09/2026, remplace la règle "tous
// les mots doivent apparaître" jugée trop stricte — ratait "BCE" -> "Banque
// centrale européenne") :
// - 1 seul mot-contenu dans le nom catalogue : ce mot doit apparaître tel
//   quel (ou sa forme singularisée) dans le texte — aucune tolérance
//   possible avec un seul token, jamais de "presque" sur un nom aussi court ;
// - 2 mots-contenu : les deux doivent apparaître (aucune tolérance non plus —
//   demande explicite : "je préfère rater un candidat ambigu plutôt que
//   récupérer un sujet trop vague", un nom à 2 mots où un seul apparaît est
//   déjà ambigu, ex. "Europe" seul ne doit jamais suffire à valider "Union
//   européenne") ;
// - 3 mots-contenu ou plus : au plus 1 mot manquant toléré.
// Voie alternative, TOUJOURS valide indépendamment de la couverture
// ci-dessus : le sigle du nom catalogue (cf. computeInitialsAcronym)
// apparaît tel quel dans le texte BRUT (ex. "BCE" dans l'article).
function lexicalCoverageMatch(catalogName, haystackText) {
  const tokens = contentTokens(catalogName);
  if (!tokens.length) return false;

  const acronym = computeInitialsAcronym(tokens);
  if (acronym && extractRawAcronyms(haystackText).has(acronym)) return true;

  const haystackTokens = new Set(contentTokens(haystackText).map(singularize));
  const present = tokens.filter((t) => haystackTokens.has(singularize(t))).length;
  const missing = tokens.length - present;
  const maxMissing = tokens.length >= 3 ? 1 : 0;
  return missing <= maxMissing;
}

// Rejette un nom réduit à un UNIQUE mot-contenu appartenant à la petite
// liste de catégories ultra-génériques — jamais une phrase qui contient un
// de ces mots parmi d'autres (ex. "Politique monétaire" reste accepté,
// cf. tests). Compare aussi la forme singularisée (ex. "Sociétés" -> "societe").
function isGenericTopicName(name) {
  const tokens = contentTokens(name);
  if (tokens.length !== 1) return false;
  return GENERIC_TOPIC_BLACKLIST.has(tokens[0]) || GENERIC_TOPIC_BLACKLIST.has(singularize(tokens[0]));
}

// Détection volontairement simple d'une formulation datée/événementielle
// (demande : "reste simple, explicable et testable") — une année à 4
// chiffres (19xx/20xx) dans le NOM de la notion est un signal fort qu'elle
// décrit un événement ponctuel plutôt qu'un sujet durable (ex. "Baisse des
// taux de la BCE en septembre 2026"), jamais une tentative de parser toutes
// les formes de dates possibles.
function containsDatePattern(name) {
  return /\b(19|20)\d{2}\b/.test(String(name || ""));
}

// Clé de déduplication — nom normalisé (accents/casse/ponctuation), jamais
// le texte affiché tel quel (deux formulations quasi identiques doivent
// compter comme un seul doublon).
function normalizeNameForDedup(name) {
  return normalizeTopicText(name);
}

// ── Filtres déterministes communs, appliqués IDENTIQUEMENT quelle que soit
// la provenance (réutilisation d'arène, catalogue, IA) — jamais un jeu de
// règles différent selon la source. Préserve les champs supplémentaires déjà
// présents sur chaque item (source/catalogKey) via spread, sans jamais les
// ajouter d'office. Ordre : validation minimale -> rejets déterministes ->
// déduplication (premier occurrence gagne, donc réutilisation/catalogue
// prioritaires sur l'IA si jamais combinés) -> plafond MAX.
function finalizeDebateTopicNotions(rawNotions, maxNotions = MAX_DEBATE_TOPIC_NOTIONS) {
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(rawNotions) ? rawNotions : []) {
    const name = sanitizeName(raw?.name);
    const explanation = sanitizeExplanation(raw?.explanation);
    if (!name || !explanation) continue;
    const slug = slugifyName(name);
    if (!slug) continue;
    if (isGenericTopicName(name)) continue;
    if (containsDatePattern(name)) continue;
    const dedupKey = normalizeNameForDedup(name) || slug;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    result.push({ ...raw, name, explanation, slug });
    if (result.length >= maxNotions) break;
  }
  return result;
}

// ── Niveau 1 — réutilisation d'une arène quasi-identique déjà prête ──
// `candidateRows` : lignes DEJA chargées par l'appelant (server.js, deux
// requêtes ciblées : source_url exact, puis question exacte — jamais un scan
// complet de la table), forme { id, question, source_url, category,
// topic_notions }. Priorité stricte à source_url (aucune ambiguïté possible
// sur une URL identique) ; à défaut, question normalisée strictement égale
// — ET, garde-fou (demande du 07/09/2026, "une question très générique peut
// revenir dans des contextes différents") : si les deux arènes portent une
// `category` renseignée et DIFFÉRENTE, ce match par question seule est
// écarté plutôt que risqué. Retourne les topic_notions BRUTS du match (pas
// encore filtrés — c'est finalizeDebateTopicNotions, appelé ensuite par
// l'orchestrateur, qui absorbe une éventuelle ancienne arène à 5 notions ou
// une ancienne règle éditoriale plus permissive).
function pickDuplicateArenaNotions(current, candidateRows) {
  const currentSourceUrl = String(current?.sourceUrl || "").trim();
  const currentQuestion = String(current?.question || "").trim();
  const currentCategory = String(current?.category || "").trim();
  const rows = Array.isArray(candidateRows) ? candidateRows : [];

  if (currentSourceUrl) {
    const bySourceUrl = rows.find((r) => String(r?.source_url || "").trim() === currentSourceUrl);
    if (bySourceUrl && Array.isArray(bySourceUrl.topic_notions) && bySourceUrl.topic_notions.length) {
      return { originDebateId: bySourceUrl.id, notions: bySourceUrl.topic_notions };
    }
  }

  const normalizedCurrentQuestion = normalizeTopicText(currentQuestion);
  if (normalizedCurrentQuestion) {
    const byQuestion = rows.find((r) => {
      if (normalizeTopicText(r?.question) !== normalizedCurrentQuestion) return false;
      const candidateCategory = String(r?.category || "").trim();
      if (currentCategory && candidateCategory && currentCategory !== candidateCategory) return false;
      return Array.isArray(r?.topic_notions) && r.topic_notions.length;
    });
    if (byQuestion) return { originDebateId: byQuestion.id, notions: byQuestion.topic_notions };
  }

  return null;
}

// ── Niveau 2 — recherche dans le catalogue Mnoria existant ──
// `catalogEntries` : DEJA chargées par l'appelant (server.js), forme
// { name, key } — `key` est le slot du master correspondant (ex.
// "notion:custom:<id>"), conservé uniquement à titre informatif/instrumentation
// (catalogKey), jamais utilisé pour une réutilisation du master au clic dans
// ce chantier (cf. rapport — hors périmètre, nécessiterait de toucher au
// pipeline QCM). `haystackText` : texte de l'arène (question + content +
// optionA/optionB + category concaténés par l'appelant). Pertinence stricte :
// lexicalCoverageMatch ci-dessus, jamais un simple mot en commun.
function selectCatalogMatches(haystackText, catalogEntries, maxNotions = MAX_DEBATE_TOPIC_NOTIONS) {
  const seen = new Set();
  const result = [];
  for (const entry of Array.isArray(catalogEntries) ? catalogEntries : []) {
    const name = sanitizeName(entry?.name);
    if (!name || isGenericTopicName(name)) continue;
    const dedupKey = normalizeNameForDedup(name);
    if (!dedupKey || seen.has(dedupKey)) continue;
    if (!lexicalCoverageMatch(name, haystackText)) continue;
    seen.add(dedupKey);
    result.push({
      name,
      // Explication générique, déterministe (demande de coût nul à ce
      // niveau) : le catalogue n'a pas de résumé pédagogique tout fait à ce
      // stade — le vrai contenu d'apprentissage reste rédigé au clic, comme
      // aujourd'hui, par le pipeline QCM (generateNotionLevelQuiz).
      explanation: "Sujet déjà présent dans le catalogue Mnoria, pertinent pour comprendre ce contenu.",
      source: "catalog",
      catalogKey: entry?.key || null
    });
    if (result.length >= maxNotions) break;
  }
  return result;
}

// ── Orchestrateur — cascade complète, décision pure (aucun réseau/DB ici,
// `callAi` est fourni par l'appelant réel ou par un mock de test). Arrêt dès
// qu'un niveau gratuit produit au moins 1 notion valide après filtrage —
// jamais d'appel IA "pour compléter jusqu'à 3" (demande explicite du
// 07/09/2026, section "arrêt immédiat si le catalogue suffit qualitativement").
async function selectDebateTopicNotions({
  duplicateArenaNotions,
  catalogEntries,
  haystackText,
  subject,
  contentText,
  optionA,
  optionB,
  category,
  maxNotions = MAX_DEBATE_TOPIC_NOTIONS,
  callAi
}) {
  const metrics = {
    duplicateReuseCount: 0,
    catalogCandidates: Array.isArray(catalogEntries) ? catalogEntries.length : 0,
    catalogSelected: 0,
    aiCalled: false,
    aiReturned: 0
  };

  const fromDuplicate = finalizeDebateTopicNotions(duplicateArenaNotions, maxNotions);
  if (fromDuplicate.length) {
    metrics.duplicateReuseCount = fromDuplicate.length;
    return { notions: fromDuplicate, resolutionSource: "duplicate_arena", ...metrics };
  }

  const fromCatalog = finalizeDebateTopicNotions(selectCatalogMatches(haystackText, catalogEntries, maxNotions), maxNotions);
  if (fromCatalog.length) {
    metrics.catalogSelected = fromCatalog.length;
    return { notions: fromCatalog, resolutionSource: "catalog", ...metrics };
  }

  if (typeof callAi !== "function") {
    return { notions: [], resolutionSource: "none", ...metrics };
  }
  metrics.aiCalled = true;
  const rawAiNotions = await callAi(subject, contentText, optionA, optionB, category);
  metrics.aiReturned = Array.isArray(rawAiNotions) ? rawAiNotions.length : 0;
  const fromAi = finalizeDebateTopicNotions(rawAiNotions, maxNotions);
  return { notions: fromAi, resolutionSource: fromAi.length ? "ai" : "none", ...metrics };
}

module.exports = {
  MAX_DEBATE_TOPIC_NOTIONS,
  GENERIC_TOPIC_BLACKLIST,
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
};
