"use strict";

// Logique métier de l'"Œuvre d'art du jour" : sélection du sujet,
// génération IA, validation stricte, stockage Supabase, anti-concurrence.
// Jumelle de lib/citation-du-jour.js dans son principe (choisit parmi les
// sujets publiés aujourd'hui sur Mnoria, mais présentation volontairement
// simple — pas de shared_mechanism/essential_difference/conclusion),
// adaptée au domaine des arts visuels. Le champ le plus sensible ici est
// artwork_title/artist_name : attribuer une œuvre au mauvais artiste ou
// décrire une œuvre inexistante est une désinformation directe, cf. le
// garde-fou "insufficient par défaut" dans prompts/oeuvre-art-du-jour.js.
// Ne dépend jamais de server.js — toutes ses dépendances (client Supabase,
// appel OpenAI, logger, horloge, récupération des sujets du jour) lui sont
// injectées via createOeuvreArtDuJourService(deps).

const { buildOeuvreArtDuJourPrompt } = require("../prompts/oeuvre-art-du-jour");
const { fetchRecentEclairagesIdentities, normalizeIdentity, RECENT_REPEAT_AVOIDANCE_DAYS } = require("./eclairages-recent-usage");

const TABLE = "oeuvre_art_du_jour";
const MAX_TOPICS_SENT = 10;
// gpt-4.1-mini, cohérent avec les autres rubriques Éclairages (meilleure
// qualité que gpt-4o-mini, coût toujours très inférieur à gpt-4o).
const DEFAULT_MODEL = "gpt-4.1-mini";
const MAX_GENERATION_ATTEMPTS = 3;
// Une seule œuvre par jour, la plus pertinente parmi les sujets du jour.
const MAX_OEUVRES_PER_DAY = 1;

// Au-delà de ce délai, une ligne restée en "generating" est considérée
// comme abandonnée (crash, redémarrage du process pendant l'appel IA) et
// peut être reprise par un appel suivant.
const GENERATING_STALE_MS = 3 * 60 * 1000;
// Évite de retenter un appel IA à chaque requête si la génération échoue en
// boucle : un seul essai par fenêtre de 5 minutes.
const FAILED_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
const WIKIPEDIA_IMAGE_FETCH_ROUNDS = 2;
const WIKIPEDIA_IMAGE_RETRY_DELAY_MS = 400;
const ARTWORK_IMAGE_REPAIR_COOLDOWN_MS = 15 * 60 * 1000;

const PUBLISHED_ALLOWED_KEYS = new Set(["status", "oeuvres"]);
const OEUVRE_ITEM_ALLOWED_KEYS = new Set([
  "current_topic_id", "artwork_title", "artist_name", "artwork_date",
  "artwork_description", "artist_presentation", "news_connection", "sources"
]);
const INSUFFICIENT_ALLOWED_KEYS = new Set(["status", "reason"]);
const SOURCE_ALLOWED_KEYS = new Set(["title", "author", "publisher", "year", "url"]);

const FIELD_MAX_LENGTHS = {
  artwork_title: 200,
  artist_name: 150,
  artwork_date: 100,
  artwork_description: 700,
  artist_presentation: 700,
  // Volontairement court : un "petit paragraphe" (2-3 phrases), pas une
  // section d'analyse comme dans les autres rubriques.
  news_connection: 400
};

const HTML_TAG_PATTERN = /<\/?[a-z!][^>]*>/i;

function stripDiacritics(str) {
  return String(str || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// --- Image (l'œuvre elle-même, jamais générée ni devinée
// par l'IA, cf. les autres rubriques) : API publique Wikipedia, aucune clé
// requise. Contrairement à citation-du-jour (portrait de l'auteur), c'est
// ici l'œuvre elle-même qui est l'image centrale : si aucune reproduction
// fiable de l'œuvre n'est trouvée, on publie sans image plutôt qu'un portrait
// ou une illustration voisine.
const WIKIPEDIA_IMAGE_FETCH_TIMEOUT_MS = 8000;
const WIKIMEDIA_IMAGE_HOST_PREFIX = "https://upload.wikimedia.org/";
const WIKIPEDIA_MATCH_STOPWORDS = new Set([
  "dans", "les", "des", "une", "avec", "pour", "contre", "leurs", "cette",
  "sont", "plus", "entre", "ainsi", "comme", "depuis", "their", "with",
  "from", "were", "have", "this", "that", "been", "during", "under",
  "cest", "cette", "meme", "same", "thing", "and", "there", "nothing",
  "done"
]);
function significantWordsForMatch(str) {
  return stripDiacritics(str).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .map((w) => w.replace(/s$/, ""))
    .filter((w) => w.length >= 4 && !WIKIPEDIA_MATCH_STOPWORDS.has(w));
}
function normalizeForLooseMatch(str) {
  return stripDiacritics(str).toLowerCase().replace(/[’']/g, " ");
}

function extractNumberedWorkParts(str) {
  const normalized = normalizeForLooseMatch(str);
  const matches = [];
  const pattern = /\b(?:n(?:o|umero)?|no|planche|plate|partie|part|episode|scene|acte|chapter|chapitre|volume|tome)\.?\s*(?:°|º)?\s*([0-9]{1,3}|[ivxlcdm]{1,8})\b/gi;
  let match;
  while ((match = pattern.exec(normalized))) matches.push(match[1].replace(/^0+/, "") || "0");
  return [...new Set(matches)];
}

function extractSpecificTitleSegments(str) {
  const segments = [];
  const raw = String(str || "");
  const afterColon = raw.match(/[:：]\s*(.+)$/);
  if (afterColon) segments.push(afterColon[1]);
  const quotePattern = /[«"“](.*?)[»"”]/g;
  let quote;
  while ((quote = quotePattern.exec(raw))) segments.push(quote[1]);
  return segments
    .map((segment) => significantWordsForMatch(segment))
    .filter((words) => words.length > 0);
}

function hasRequiredSpecificWords(requiredWords, haystackWords) {
  const required = [...new Set(requiredWords)];
  if (!required.length) return true;
  const haystack = new Set(haystackWords);
  const requiredCount = required.length <= 2 ? required.length : 2;
  return required.filter((word) => haystack.has(word)).length >= requiredCount;
}

function validateArtworkPageMatch(queryTitle, pageTitle, pageExtract = "") {
  // Les titres très courts (ex. « Le Cri ») peuvent ne contenir aucun mot
  // atteignant le seuil de 4 caractères utilisé par le rapprochement flou.
  // Une égalité exacte après normalisation reste néanmoins un signal fort :
  // l'auteur est contrôlé séparément dans queryWikipediaImage, via le résumé
  // de la page, ce qui conserve le garde-fou contre les homonymes.
  const normalizedQueryTitle = normalizeForLooseMatch(queryTitle).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const normalizedPageTitle = normalizeForLooseMatch(pageTitle).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const exactNormalizedTitleMatch = normalizedQueryTitle.length > 0 && normalizedQueryTitle === normalizedPageTitle;
  const queryWords = significantWordsForMatch(queryTitle);
  const pageTitleWords = significantWordsForMatch(pageTitle);
  const pageAllWords = significantWordsForMatch(`${pageTitle} ${pageExtract}`);
  if (!queryWords.length || !pageTitleWords.length) return exactNormalizedTitleMatch;

  const queryWordSet = new Set(queryWords);
  const pageTitleWordSet = new Set(pageTitleWords);
  const pageAllWordSet = new Set(pageAllWords);
  const sharedTitleWords = [...queryWordSet].filter((word) => pageTitleWordSet.has(word)).length;
  const sharedAllWords = [...queryWordSet].filter((word) => pageAllWordSet.has(word)).length;
  const minSharedTitleWords = queryWordSet.size <= 2 ? 1 : 2;
  const queryNumbers = extractNumberedWorkParts(queryTitle);
  const specificSegments = extractSpecificTitleSegments(queryTitle);
  if (!queryNumbers.length && !specificSegments.length && sharedTitleWords < 1) return false;
  if (sharedAllWords < minSharedTitleWords) return false;

  if (queryNumbers.length) {
    const pageNumberText = normalizeForLooseMatch(`${pageTitle} ${pageExtract}`);
    const hasEveryNumber = queryNumbers.every((number) => {
      const numberPattern = new RegExp(`\\b(?:n(?:o|umero)?|no|planche|plate|partie|part|episode|scene|acte|chapter|chapitre|volume|tome)\\.?\\s*(?:°|º)?\\s*0?${number}\\b`, "i");
      return numberPattern.test(pageNumberText);
    });
    if (!hasEveryNumber) return false;
  }

  if (specificSegments.length) {
    for (const segmentWords of specificSegments) {
      if (!hasRequiredSpecificWords(segmentWords, pageAllWords)) return false;
    }
  }

  return true;
}

// requireArtistMention : nom de l'artiste annoncé par l'IA. Une recherche
// par TITRE d'œuvre peut très bien retomber sur une page Wikipedia sans
// aucun rapport avec une œuvre d'art (ex. "Le Débarquement de Normandie"
// retombe sur l'article consacré à l'événement historique lui-même, pas à
// un tableau) — un simple recoupement de mots-clés entre le titre annoncé
// et le titre de la page ne suffit pas à s'en prémunir puisque l'IA a
// justement construit ce titre à partir du sujet d'actualité. On exige donc
// en plus que le nom de l'artiste apparaisse dans le résumé de la page
// trouvée : un vrai article sur une œuvre mentionne toujours son auteur dès
// l'introduction, ce qu'un article sur un événement historique ne fait pas.
async function queryWikipediaImage(lang, title, requireArtistMention) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(title)}&gsrlimit=1&prop=pageimages%7Cinfo%7Cextracts&inprop=url&pithumbsize=800&exintro=1&explaintext=1&format=json&origin=*`;
  const res = await fetch(url, { signal: AbortSignal.timeout(WIKIPEDIA_IMAGE_FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  const body = await res.json();
  const pages = body && body.query && body.query.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  const imageUrl = page && page.thumbnail && page.thumbnail.source;
  if (!imageUrl || !imageUrl.startsWith(WIKIMEDIA_IMAGE_HOST_PREFIX)) return null;
  // Une image "de tête" en SVG (carte, drapeau, blason) n'est jamais une vraie photo/reproduction.
  if (/\.svg(\/|$)/i.test(imageUrl)) return null;
  if (!validateArtworkPageMatch(title, page.title || "", page.extract || "")) return null;
  if (requireArtistMention) {
    const artistWords = significantWordsForMatch(requireArtistMention);
    const extractWords = new Set(significantWordsForMatch(page.extract || ""));
    if (!artistWords.length || !artistWords.some((w) => extractWords.has(w))) return null;
  }
  const pageUrl = page.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(page.title || "").replace(/ /g, "_"))}`;
  return { imageUrl, pageUrl, pageTitle: page.title || null };
}

// Résout l'URL de vignette d'une image Wikimedia Commons à partir de son nom
// de fichier (ex. "Dulle Griet, by Pieter Brueghel (I).jpg", tel que fourni
// par le claim P18 d'une entité Wikidata). Passe par l'API imageinfo plutôt
// que de reconstruire l'URL "/thumb/<hash>/.../<width>px-<fichier>" à la
// main (hash MD5 du nom de fichier) : les largeurs de vignette Wikimedia sont
// contraintes à des paliers prédéfinis (960, 1280…) — demander 800px pour ce
// fichier précis renvoie une 400, alors que l'API renvoie toujours la bonne
// URL déjà calée sur le palier valide le plus proche.
async function fetchCommonsThumbUrl(filename, width = 800) {
  const cleanFilename = String(filename || "").trim();
  if (!cleanFilename) return null;
  const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(`File:${cleanFilename}`)}&prop=imageinfo&iiprop=url&iiurlwidth=${width}&format=json&origin=*`;
  const res = await fetch(url, { signal: AbortSignal.timeout(WIKIPEDIA_IMAGE_FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  const body = await res.json();
  const pages = body && body.query && body.query.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  const info = page && Array.isArray(page.imageinfo) && page.imageinfo[0];
  const thumbUrl = info && (info.thumburl || info.url);
  if (!thumbUrl || !thumbUrl.startsWith(WIKIMEDIA_IMAGE_HOST_PREFIX)) return null;
  return thumbUrl;
}

// wbsearchentities fait un matching quasi-exact sur le libellé (pas une
// recherche plein texte comme Wikipedia) : un titre généré par l'IA avec un
// sous-titre entre parenthèses (ex. "Dulle Griet (Mad Meg)") n'y retrouve
// souvent rien, alors que le titre nu ("Dulle Griet") retrouve directement
// la bonne entité. On tente donc aussi la variante sans parenthèse finale.
function stripTrailingParenthetical(title) {
  return String(title || "").replace(/\s*\([^()]*\)\s*$/, "").trim();
}

// Repli Wikidata (demande du 04/08/2026) : contrairement à la recherche
// plein texte Wikipedia, sensible aux titres traduits (une œuvre peut être
// titrée différemment en français, cf. "Dulle Griet" / "Margot la folle" —
// l'article FR existe bien mais son TITRE ne partage aucun mot avec celui
// généré par l'IA, donc rejeté par validateArtworkPageMatch), Wikidata
// indexe une entité par ses libellés dans chaque langue : une recherche par
// titre y retrouve la bonne entité même si le titre "officiel" diffère —
// parfois même dans une troisième langue ("Dulle Griet" en néerlandais
// devient "Dull Gret" en anglais sur Wikidata, aucun mot en commun avec le
// titre généré par l'IA). Le garde-fou par mot-clé du titre
// (validateArtworkPageMatch, pensé pour un extrait Wikipedia potentiellement
// hors-sujet) n'a donc plus de sens ici : le garde-fou contre une mauvaise
// attribution devient l'exigence — OBLIGATOIRE, jamais optionnelle,
// contrairement à queryWikipediaImage — que l'artiste apparaisse dans la
// description de l'entité, laquelle suit presque toujours le gabarit
// "peinture de <artiste>" / "painting by <artist>". Sans nom d'artiste
// fourni, aucune image n'est retenue par cette voie.
async function searchWikidataEntities(title, lang) {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(title)}&language=${lang}&type=item&limit=5&format=json&origin=*`;
  const res = await fetch(url, { signal: AbortSignal.timeout(WIKIPEDIA_IMAGE_FETCH_TIMEOUT_MS) });
  if (!res.ok) return [];
  const body = await res.json();
  return Array.isArray(body.search) ? body.search : [];
}

async function fetchWikidataEntities(ids) {
  if (!ids.length) return {};
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join("|")}&props=claims%7Clabels%7Cdescriptions&languages=fr%7Cen&format=json&origin=*`;
  const res = await fetch(url, { signal: AbortSignal.timeout(WIKIPEDIA_IMAGE_FETCH_TIMEOUT_MS) });
  if (!res.ok) return {};
  const body = await res.json();
  return body.entities || {};
}

function firstClaimValue(entity, property) {
  const claims = entity && entity.claims && entity.claims[property];
  const snak = Array.isArray(claims) && claims.length ? claims[0].mainsnak : null;
  return snak && snak.datavalue ? snak.datavalue.value : null;
}

function bestLabelOrDescription(entityField, fallback) {
  if (!entityField) return fallback || "";
  return (entityField.fr && entityField.fr.value) || (entityField.en && entityField.en.value) || fallback || "";
}

async function queryWikidataImage(title, requireArtistMention) {
  const artistWords = significantWordsForMatch(requireArtistMention);
  if (!artistWords.length) return null;

  const titleVariants = [String(title || "").trim(), stripTrailingParenthetical(title)]
    .filter((t, i, arr) => t && arr.indexOf(t) === i);

  const candidates = [];
  for (const variant of titleVariants) {
    for (const lang of ["fr", "en"]) {
      for (const result of await searchWikidataEntities(variant, lang)) {
        if (!candidates.some((c) => c.id === result.id)) candidates.push(result);
      }
    }
  }
  if (!candidates.length) return null;

  const entities = await fetchWikidataEntities(candidates.map((c) => c.id));
  for (const candidate of candidates) {
    const entity = entities[candidate.id];
    if (!entity) continue;
    const imageFilename = firstClaimValue(entity, "P18");
    if (!imageFilename || typeof imageFilename !== "string") continue;

    const label = bestLabelOrDescription(entity.labels, candidate.label);
    const description = bestLabelOrDescription(entity.descriptions, candidate.description);
    const descriptionWords = new Set(significantWordsForMatch(description));
    if (!artistWords.some((w) => descriptionWords.has(w))) continue;

    const imageUrl = await fetchCommonsThumbUrl(imageFilename);
    if (!imageUrl) continue;
    return { imageUrl, pageUrl: `https://www.wikidata.org/wiki/${candidate.id}`, pageTitle: label || null };
  }
  return null;
}

// Cherche une reproduction de l'œuvre elle-même (artwork_title), en vérifiant
// que le nom de l'artiste apparaît bien dans le résumé de la page trouvée
// (cf. queryWikipediaImage). Best-effort : ne bloque jamais la publication,
// se contente de publier sans image en cas d'échec/absence de résultat
// pertinent. Aucun repli sur un portrait de l'artiste. Wikidata (cf.
// queryWikidataImage) n'est tenté qu'en dernier repli, après épuisement des
// tentatives Wikipedia FR/EN.
async function defaultFetchArtworkImage(artworkTitle, artistName) {
  const cleanTitle = String(artworkTitle || "").trim();
  const cleanArtist = String(artistName || "").trim();

  if (cleanTitle) {
    for (let round = 1; round <= WIKIPEDIA_IMAGE_FETCH_ROUNDS; round++) {
      for (const lang of ["fr", "en"]) {
        try {
          const result = await queryWikipediaImage(lang, cleanTitle, cleanArtist);
          if (result) return { ...result, tier: "artwork", source: "wikipedia", credit: "Wikipedia" };
        } catch (e) {
          // réseau/timeout sur cette langue : on tente la suivante sans jamais échouer bloquant.
        }
      }
      if (round < WIKIPEDIA_IMAGE_FETCH_ROUNDS) {
        await new Promise((resolve) => setTimeout(resolve, WIKIPEDIA_IMAGE_RETRY_DELAY_MS));
      }
    }

    try {
      const result = await queryWikidataImage(cleanTitle, cleanArtist);
      if (result) return { ...result, tier: "artwork", source: "wikidata", credit: "Wikimedia Commons" };
    } catch (e) {
      // idem : best-effort, jamais bloquant.
    }
  }

  return null;
}

function containsHtml(str) {
  return HTML_TAG_PATTERN.test(String(str || ""));
}

function isNonEmptyString(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isNullableString(value, maxLength) {
  return value === null || value === undefined || (typeof value === "string" && value.length <= maxLength);
}

function countWords(str) {
  return String(str || "").trim().split(/\s+/).filter(Boolean).length;
}

function safeParseJson(text) {
  if (typeof text !== "string") return null;
  let candidate = text.trim();
  // Filet de sécurité : malgré la consigne du prompt, certains modèles
  // enveloppent quand même leur JSON dans un bloc de code Markdown.
  const fenced = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) candidate = fenced[1].trim();
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

// Certains modèles renvoient le texte littéral "null" (une vraie chaîne, pas
// un JSON null) pour un champ optionnel vide — on le neutralise avant toute
// validation/affichage pour ne jamais montrer "null" comme texte dans l'UI.
function normalizeNullableField(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  return trimmed;
}

// L'IA n'a aucune recherche documentaire réelle sur la provenance d'une
// œuvre : toute URL produite pour une source est par nature une invention,
// systématiquement mise à null plutôt que rejetée (une référence sans lien
// reste acceptable, cf. règle URL du prompt).
function validateSources(sources) {
  if (!Array.isArray(sources) || sources.length > 8) {
    return { ok: false, reason: "sources doit être un tableau de 8 éléments maximum." };
  }
  const sanitized = [];
  for (const rawSource of sources) {
    if (!rawSource || typeof rawSource !== "object" || Array.isArray(rawSource)) {
      return { ok: false, reason: "chaque source doit être un objet." };
    }
    const extraKeys = Object.keys(rawSource).filter((k) => !SOURCE_ALLOWED_KEYS.has(k));
    if (extraKeys.length) return { ok: false, reason: `champ(s) inattendu(s) dans une source : ${extraKeys.join(", ")}.` };

    const source = {
      title: rawSource.title,
      author: normalizeNullableField(rawSource.author),
      publisher: normalizeNullableField(rawSource.publisher),
      year: normalizeNullableField(rawSource.year)
    };

    if (!isNonEmptyString(source.title, 300) || containsHtml(source.title)) {
      return { ok: false, reason: "titre de source manquant, trop long ou contenant du HTML." };
    }
    if (!isNullableString(source.author, 200) || containsHtml(source.author || "")) {
      return { ok: false, reason: "champ author de source invalide." };
    }
    if (!isNullableString(source.publisher, 200) || containsHtml(source.publisher || "")) {
      return { ok: false, reason: "champ publisher de source invalide." };
    }
    if (!isNullableString(source.year, 20)) return { ok: false, reason: "champ year de source invalide." };

    sanitized.push({
      title: source.title.trim(),
      author: source.author,
      publisher: source.publisher,
      year: source.year,
      url: null
    });
  }
  return { ok: true, sources: sanitized };
}

// Valide UNE œuvre (champs présents, longueurs, HTML, sujet choisi, sources,
// non-réutilisation récente). validTopicIds est calculé une fois pour tout le
// tableau par l'appelant. recentTitlesNormalized (cf.
// lib/eclairages-recent-usage.js) contient les artwork_title déjà publiés
// dans les RECENT_REPEAT_AVOIDANCE_DAYS derniers jours — un filet de sécurité
// qui s'applique même si l'IA ignore la consigne du prompt.
function validateSingleOeuvre(raw, validTopicIds, recentTitlesNormalized) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "chaque œuvre doit être un objet JSON." };
  }
  const extraKeys = Object.keys(raw).filter((k) => !OEUVRE_ITEM_ALLOWED_KEYS.has(k));
  if (extraKeys.length) return { ok: false, reason: `champ(s) inattendu(s) dans une œuvre : ${extraKeys.join(", ")}.` };

  // Tolère le préfixe "id:" recopié par erreur depuis le format d'affichage
  // des sujets dans le prompt ("1. id:123", cf. formatTopicsForPrompt) — un
  // modèle sur plusieurs le renvoie ainsi malgré la consigne, rejeter cette
  // réponse par ailleurs valide serait plus nuisible qu'une normalisation
  // défensive.
  const normalizedTopicId = typeof raw.current_topic_id === "string"
    ? raw.current_topic_id.trim().replace(/^id\s*:\s*/i, "")
    : "";
  if (!validTopicIds.has(normalizedTopicId)) {
    return { ok: false, reason: "current_topic_id ne correspond à aucun sujet fourni." };
  }

  for (const [field, maxLength] of Object.entries(FIELD_MAX_LENGTHS)) {
    if (!isNonEmptyString(raw[field], maxLength)) return { ok: false, reason: `${field} manquant, vide ou trop long.` };
    if (containsHtml(raw[field])) return { ok: false, reason: `${field} contient du HTML.` };
  }

  if (recentTitlesNormalized && recentTitlesNormalized.has(normalizeIdentity(raw.artwork_title))) {
    return { ok: false, reason: `artwork_title déjà utilisé dans les ${RECENT_REPEAT_AVOIDANCE_DAYS} derniers jours.` };
  }

  // Tolérance volontairement large : un rejet systématique dès que l'IA
  // dévie légèrement de "2 à 4 phrases" serait plus nuisible qu'un texte un
  // peu plus long ou court mais valable.
  const descriptionWordCount = countWords(raw.artwork_description);
  if (descriptionWordCount < 10 || descriptionWordCount > 150) {
    return { ok: false, reason: `artwork_description hors bornes raisonnables (${descriptionWordCount} mots).` };
  }
  const presentationWordCount = countWords(raw.artist_presentation);
  if (presentationWordCount < 10 || presentationWordCount > 150) {
    return { ok: false, reason: `artist_presentation hors bornes raisonnables (${presentationWordCount} mots).` };
  }
  // Bornes plus serrées que artwork_description/artist_presentation :
  // "petit paragraphe" (2-3 phrases) doit rester court, pas dériver vers
  // une section d'analyse.
  const newsConnectionWordCount = countWords(raw.news_connection);
  if (newsConnectionWordCount < 8 || newsConnectionWordCount > 90) {
    return { ok: false, reason: `news_connection hors bornes raisonnables (${newsConnectionWordCount} mots).` };
  }

  const sourcesValidation = validateSources(raw.sources);
  if (!sourcesValidation.ok) return sourcesValidation;

  return {
    ok: true,
    data: {
      current_topic_id: normalizedTopicId,
      artwork_title: raw.artwork_title.trim(),
      artist_name: raw.artist_name.trim(),
      artwork_date: raw.artwork_date.trim(),
      artwork_description: raw.artwork_description.trim(),
      artist_presentation: raw.artist_presentation.trim(),
      news_connection: raw.news_connection.trim(),
      sources: sourcesValidation.sources
    }
  };
}

// Validation stricte de la réponse IA : présence des champs, valeurs
// autorisées, exactement MAX_OEUVRES_PER_DAY œuvre(s), sujet reconnu,
// longueurs raisonnables, absence de HTML, absence de champs inattendus.
// Toute réponse qui ne passe pas ce filtre est traitée comme un échec de
// génération — jamais enregistrée comme contenu publié.
function validateOeuvreArtDuJourResponse(raw, topics, recentTitlesNormalized) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "la réponse doit être un objet JSON." };
  }
  if (raw.status !== "published" && raw.status !== "insufficient") {
    return { ok: false, reason: 'status doit valoir "published" ou "insufficient".' };
  }

  if (raw.status === "insufficient") {
    const extraKeys = Object.keys(raw).filter((k) => !INSUFFICIENT_ALLOWED_KEYS.has(k));
    if (extraKeys.length) return { ok: false, reason: `champ(s) inattendu(s) : ${extraKeys.join(", ")}.` };
    if (!isNonEmptyString(raw.reason, 500) || containsHtml(raw.reason)) {
      return { ok: false, reason: "reason manquant, trop long ou contenant du HTML." };
    }
    return { ok: true, data: { status: "insufficient", reason: raw.reason.trim() } };
  }

  const extraKeys = Object.keys(raw).filter((k) => !PUBLISHED_ALLOWED_KEYS.has(k));
  if (extraKeys.length) return { ok: false, reason: `champ(s) inattendu(s) : ${extraKeys.join(", ")}.` };

  if (!Array.isArray(raw.oeuvres) || raw.oeuvres.length !== MAX_OEUVRES_PER_DAY) {
    return { ok: false, reason: `oeuvres doit être un tableau de ${MAX_OEUVRES_PER_DAY} élément(s).` };
  }

  const validTopicIds = new Set((topics || []).map((t) => String(t.id)));

  const validatedOeuvres = [];
  for (const item of raw.oeuvres) {
    const result = validateSingleOeuvre(item, validTopicIds, recentTitlesNormalized);
    if (!result.ok) return result;
    validatedOeuvres.push(result.data);
  }

  return { ok: true, data: { status: "published", oeuvres: validatedOeuvres } };
}

function createOeuvreArtDuJourService(deps) {
  const {
    supabase,
    callOpenAI,
    logger = console,
    getCurrentDate = () => new Date(),
    getPublishedTopicsForDate,
    dateKeyFor,
    model = DEFAULT_MODEL,
    debugLogging = false,
    // Évite que plusieurs rubriques traitent le même sujet le même jour.
    // Optionnel : sans cette dépendance, aucune exclusion n'est appliquée
    // (comportement d'avant, ex. en test).
    getExcludedTopicIds = async () => new Set(),
    // Image de l'œuvre (défaut = vraie implémentation Wikipedia, aucune
    // config projet nécessaire).
    fetchArtworkImage = defaultFetchArtworkImage
  } = deps || {};

  if (!supabase) throw new Error("createOeuvreArtDuJourService: 'supabase' manquant.");
  if (typeof callOpenAI !== "function") throw new Error("createOeuvreArtDuJourService: 'callOpenAI' manquant.");
  if (typeof getPublishedTopicsForDate !== "function") {
    throw new Error("createOeuvreArtDuJourService: 'getPublishedTopicsForDate' manquant.");
  }
  if (typeof dateKeyFor !== "function") throw new Error("createOeuvreArtDuJourService: 'dateKeyFor' manquant.");

  const imageRepairInFlight = new Map();

  function toClientResult(row) {
    if (!row) return { status: "insufficient", reason: "Aucun contenu disponible pour le moment." };
    switch (row.status) {
      case "published":
        return { status: "published", date: row.date, generatedAt: row.generated_at, content: row.content };
      case "insufficient":
        return {
          status: "insufficient",
          reason: (row.content && row.content.reason) || row.error_message || "Aucune œuvre d'art n'a pu être établie avec confiance aujourd'hui."
        };
      case "generating":
        return { status: "generating" };
      case "failed":
      default:
        return { status: "failed", error: "La génération de l'œuvre d'art du jour a échoué. Réessaie plus tard." };
    }
  }

  // Lecture pure d'une date archivée (consultation de l'historique) : jamais
  // de génération, jamais de réservation. "not_found" est distinct
  // d'"insufficient" — ce jour-là n'a peut-être simplement jamais été
  // généré, ce n'est pas l'IA qui a refusé.
  function toReadOnlyClientResult(row) {
    if (!row) return { status: "not_found" };
    switch (row.status) {
      case "published":
        return { status: "published", date: row.date, generatedAt: row.generated_at, content: row.content };
      case "insufficient":
        return {
          status: "insufficient",
          date: row.date,
          reason: (row.content && row.content.reason) || row.error_message || "Aucune œuvre d'art n'a pu être établie avec confiance ce jour-là."
        };
      case "generating":
        return { status: "generating", date: row.date };
      case "failed":
      default:
        return { status: "failed", date: row.date, error: "La génération de l'œuvre d'art du jour a échoué ce jour-là." };
    }
  }

  // Réservation atomique de la génération du jour : insertion protégée par
  // la contrainte UNIQUE sur `date`. Si elle échoue (23505), une ligne
  // existe déjà — on ne relance un appel IA que si elle est explicitement
  // périmée (generating figé, failed hors cooldown) via une mise à jour
  // conditionnelle (WHERE status = ancien statut) qui ne peut être gagnée
  // que par un seul appelant, y compris entre plusieurs instances serveur.
  async function claimGenerationSlot(dateKey, nowIso, { force = false } = {}) {
    if (force) {
      const { data, error } = await supabase
        .from(TABLE)
        .upsert(
          { date: dateKey, status: "generating", model, generated_at: nowIso, updated_at: nowIso, error_message: null },
          { onConflict: "date" }
        )
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { claimed: true, row: data };
    }

    const { data: inserted, error: insertError } = await supabase
      .from(TABLE)
      .insert({ date: dateKey, status: "generating", model, generated_at: nowIso, updated_at: nowIso })
      .select()
      .single();
    if (!insertError) return { claimed: true, row: inserted };
    if (insertError.code !== "23505") throw new Error(insertError.message);

    const { data: existing, error: selectError } = await supabase.from(TABLE).select("*").eq("date", dateKey).maybeSingle();
    if (selectError) throw new Error(selectError.message);
    if (!existing) return { claimed: false, row: null };

    const referenceTime = new Date(existing.generated_at || existing.updated_at || existing.created_at || 0).getTime();
    const isStaleGenerating = existing.status === "generating" && Date.now() - referenceTime > GENERATING_STALE_MS;
    const isRetryableFailed = existing.status === "failed" && Date.now() - referenceTime > FAILED_RETRY_COOLDOWN_MS;
    if (!isStaleGenerating && !isRetryableFailed) return { claimed: false, row: existing };

    const { data: reclaimed, error: updateError } = await supabase
      .from(TABLE)
      .update({ status: "generating", model, generated_at: nowIso, updated_at: nowIso, error_message: null })
      .eq("date", dateKey)
      .eq("status", existing.status)
      .select()
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!reclaimed) {
      const { data: latest } = await supabase.from(TABLE).select("*").eq("date", dateKey).maybeSingle();
      return { claimed: false, row: latest || existing };
    }
    return { claimed: true, row: reclaimed };
  }

  async function markFailed(dateKey, message) {
    const { error } = await supabase
      .from(TABLE)
      .update({ status: "failed", error_message: String(message || "").slice(0, 500), updated_at: new Date().toISOString() })
      .eq("date", dateKey);
    if (error) logger.error("[oeuvre-art-du-jour] écriture échec :", error.message);
  }

  async function markInsufficient(dateKey, reason) {
    const { error } = await supabase
      .from(TABLE)
      .update({ status: "insufficient", content: { reason }, error_message: null, updated_at: new Date().toISOString() })
      .eq("date", dateKey);
    if (error) logger.error("[oeuvre-art-du-jour] écriture insuffisant :", error.message);
  }

  async function markPublished(dateKey, data) {
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from(TABLE)
      .update({
        status: "published",
        current_topic_id: data.oeuvres.map((o) => o.current_topic_id).join(","),
        content: data,
        error_message: null,
        generated_at: nowIso,
        updated_at: nowIso
      })
      .eq("date", dateKey);
    if (error) logger.error("[oeuvre-art-du-jour] écriture publication :", error.message);
  }

  // Ajoute une image à UNE œuvre déjà validée, TOUJOURS avec un crédit de
  // source (jamais d'image sans indiquer d'où elle vient) : une reproduction
  // de l'œuvre elle-même en priorité, un portrait de l'artiste en repli. Ne
  // fait jamais échouer la publication : sans aucune des deux, publié sans
  // image.
  async function attachArtworkImageToOne(oeuvre) {
    const checkedAt = new Date().toISOString();
    try {
      const image = await fetchArtworkImage(oeuvre.artwork_title, oeuvre.artist_name);
      if (image && image.imageUrl) {
        return {
          ...oeuvre,
          artwork_image_url: image.imageUrl,
          artwork_image_page_url: image.pageUrl || null,
          artwork_image_source: image.source || "wikipedia",
          artwork_image_credit: image.credit || "Wikipedia",
          artwork_image_checked_at: checkedAt
        };
      }
    } catch (err) {
      logger.error("[oeuvre-art-du-jour] recherche image Wikipedia/Wikidata :", err.message);
    }

    return {
      ...oeuvre,
      artwork_image_url: null,
      artwork_image_page_url: null,
      artwork_image_source: null,
      artwork_image_credit: null,
      artwork_image_checked_at: checkedAt
    };
  }

  async function attachArtworkImages(data) {
    const enrichedOeuvres = [];
    for (const oeuvre of data.oeuvres) {
      enrichedOeuvres.push(await attachArtworkImageToOne(oeuvre));
    }
    return { ...data, oeuvres: enrichedOeuvres };
  }

  function oeuvreNeedsImageRepair(oeuvre) {
    if (!oeuvre || oeuvre.artwork_image_url || !String(oeuvre.artwork_title || "").trim()) return false;
    const checkedAt = new Date(oeuvre.artwork_image_checked_at || 0).getTime();
    return !Number.isFinite(checkedAt) || Date.now() - checkedAt >= ARTWORK_IMAGE_REPAIR_COOLDOWN_MS;
  }

  async function repairPublishedArtworkImages(row) {
    if (!row || row.status !== "published" || !Array.isArray(row.content && row.content.oeuvres)) return row;
    if (!row.content.oeuvres.some(oeuvreNeedsImageRepair)) return row;
    const dateKey = String(row.date || "");
    if (imageRepairInFlight.has(dateKey)) {
      const content = await imageRepairInFlight.get(dateKey);
      return content ? { ...row, content } : row;
    }
    const repairPromise = (async () => {
      const oeuvres = [];
      for (const oeuvre of row.content.oeuvres) {
        oeuvres.push(oeuvreNeedsImageRepair(oeuvre) ? await attachArtworkImageToOne(oeuvre) : oeuvre);
      }
      const content = { ...row.content, oeuvres };
      const { error } = await supabase.from(TABLE).update({ content, updated_at: new Date().toISOString() }).eq("date", dateKey).eq("status", "published");
      if (error) {
        logger.error("[oeuvre-art-du-jour] écriture réparation image :", error.message);
        return null;
      }
      return content;
    })();
    imageRepairInFlight.set(dateKey, repairPromise);
    try {
      const content = await repairPromise;
      return content ? { ...row, content } : row;
    } finally {
      imageRepairInFlight.delete(dateKey);
    }
  }

  async function runGeneration(dateKey) {
    let topics;
    try {
      topics = await getPublishedTopicsForDate(dateKey);
    } catch (err) {
      logger.error("[oeuvre-art-du-jour] récupération sujets :", err.message);
      await markFailed(dateKey, "Erreur lors de la récupération des sujets du jour.");
      return { status: "failed", error: "Erreur lors de la récupération des sujets du jour." };
    }

    let usableTopics = (Array.isArray(topics) ? topics : [])
      .filter((t) => t && t.id != null && String(t.title || "").trim() && String(t.summary || "").trim())
      .slice(0, MAX_TOPICS_SENT);

    // Les autres rubriques Éclairages ont toujours priorité sur le choix du
    // sujet : l'œuvre d'art du jour attend leur résultat du jour
    // (getExcludedTopicIds les déclenche si besoin, cf. server.js) puis
    // exclut les sujets déjà couverts, pour ne jamais traiter deux fois la
    // même actualité le même jour. Appelé seulement s'il reste au moins un
    // sujet à filtrer : inutile d'attendre les autres rubriques si de toute
    // façon rien n'est exploitable aujourd'hui.
    const hadUsableTopicsBeforeExclusion = usableTopics.length > 0;
    let excludedTopicIds = new Set();
    if (hadUsableTopicsBeforeExclusion) {
      try {
        excludedTopicIds = (await getExcludedTopicIds(dateKey)) || new Set();
      } catch (err) {
        logger.error("[oeuvre-art-du-jour] récupération des sujets déjà couverts :", err.message);
      }
    }
    if (excludedTopicIds.size) {
      usableTopics = usableTopics.filter((t) => !excludedTopicIds.has(String(t.id)));
    }

    if (!usableTopics.length) {
      if (!hadUsableTopicsBeforeExclusion) {
        // Aucun sujet publié pour l'instant : pas un état définitif pour la
        // journée, contrairement à un refus explicite de l'IA — cf. le
        // commentaire détaillé dans lib/parallele-historique.js.
        logger.warn("[oeuvre-art-du-jour] aucun sujet publié pour l'instant, génération reportée.");
        return { status: "generating" };
      }
      const reason = "Tous les sujets exploitables du jour sont déjà couverts par une autre rubrique Éclairages.";
      await markInsufficient(dateKey, reason);
      return { status: "insufficient", reason };
    }

    // Journal de dev uniquement (jamais en production) : ni la clé API, ni
    // le prompt complet, ni la réponse brute.
    if (debugLogging) {
      logger.log(
        `[oeuvre-art-du-jour] génération ${dateKey} — ${usableTopics.length} sujet(s) transmis, modèle ${model}.`
      );
    }

    // Œuvres déjà publiées dans les RECENT_REPEAT_AVOIDANCE_DAYS derniers
    // jours (cf. lib/eclairages-recent-usage.js) : transmises à l'IA (prompt)
    // et vérifiées à nouveau après coup (validateSingleOeuvre), pour ne
    // jamais reproposer la même œuvre trop vite (ex. "Le Cri" choisi deux
    // jours de suite).
    const { raw: recentArtworkTitles, normalized: recentArtworkTitlesNormalized } = await fetchRecentEclairagesIdentities({
      supabase,
      table: TABLE,
      contentKey: "oeuvres",
      identityField: "artwork_title",
      todayDateKey: dateKey,
      logger
    });

    // Avec un modèle économique, une réponse "insufficient" ou invalide est
    // parfois un aléa du tirage plutôt qu'un vrai refus. On retente donc
    // quelques fois avant d'abandonner. Les pannes réseau/API franches
    // (hardError) ne sont pas retentées ici. Une œuvre valide mais sans
    // image trouvée compte aussi comme un motif de nouvelle tentative
    // (demande du 04/08/2026, "sélectionner l'œuvre si image disponible") :
    // on exclut l'œuvre essayée (comme une œuvre "récente", cf.
    // recentArtworkTitles) pour que la tentative suivante en propose une
    // autre plutôt que de retomber dessus. Si aucune tentative n'aboutit à
    // une image, on publie quand même la dernière œuvre valide obtenue —
    // jamais d'échec de publication pour cette seule raison.
    let lastOutcome = null;
    let lastValidWithoutImage = null;
    const excludedArtworkTitles = [];
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      const attemptRecentTitles = excludedArtworkTitles.length
        ? [...recentArtworkTitles, ...excludedArtworkTitles]
        : recentArtworkTitles;
      const attemptRecentTitlesNormalized = excludedArtworkTitles.length
        ? new Set([...recentArtworkTitlesNormalized, ...excludedArtworkTitles.map(normalizeIdentity)])
        : recentArtworkTitlesNormalized;
      const outcome = await attemptGenerationOnce(usableTopics, attemptRecentTitles, attemptRecentTitlesNormalized);
      lastOutcome = outcome;
      if (outcome.ok) {
        const topicsById = new Map(usableTopics.map((topic) => [String(topic.id), topic]));
        const dataWithTopicContext = {
          ...outcome.data,
          oeuvres: outcome.data.oeuvres.map((oeuvre) => {
            const topic = topicsById.get(String(oeuvre.current_topic_id));
            return {
              ...oeuvre,
              current_topic_title: String(topic?.title || "").trim(),
              current_topic_summary: String(topic?.summary || "").trim()
            };
          })
        };
        const enrichedData = await attachArtworkImages(dataWithTopicContext);
        const hasImage = enrichedData.oeuvres.some((o) => o.artwork_image_url);
        if (hasImage || attempt === MAX_GENERATION_ATTEMPTS) {
          await markPublished(dateKey, enrichedData);
          return { status: "published", date: dateKey, generatedAt: new Date().toISOString(), content: enrichedData };
        }
        lastValidWithoutImage = enrichedData;
        excludedArtworkTitles.push(...enrichedData.oeuvres.map((o) => o.artwork_title));
        continue;
      }
      if (outcome.hardError) break;
    }

    if (lastValidWithoutImage) {
      await markPublished(dateKey, lastValidWithoutImage);
      return { status: "published", date: dateKey, generatedAt: new Date().toISOString(), content: lastValidWithoutImage };
    }

    if (lastOutcome && lastOutcome.hardError) {
      logger.error("[oeuvre-art-du-jour] appel IA :", lastOutcome.reason);
      await markFailed(dateKey, "Erreur lors de l'appel au modèle IA.");
      return { status: "failed", error: "Erreur lors de la génération. Réessaie plus tard." };
    }
    if (lastOutcome && lastOutcome.insufficient) {
      await markInsufficient(dateKey, lastOutcome.reason);
      return { status: "insufficient", reason: lastOutcome.reason };
    }

    logger.error(`[oeuvre-art-du-jour] validation refusée après ${MAX_GENERATION_ATTEMPTS} tentative(s) : ${lastOutcome && lastOutcome.reason}`);
    await markFailed(dateKey, `Validation refusée : ${lastOutcome && lastOutcome.reason}`);
    return { status: "failed", error: "Réponse invalide reçue. Réessaie plus tard." };
  }

  // Un seul essai : appel IA + parsing + validation. Ne touche pas à Supabase
  // (runGeneration décide quoi écrire une fois la boucle de tentatives finie).
  async function attemptGenerationOnce(usableTopics, recentArtworkTitles, recentArtworkTitlesNormalized) {
    let raw;
    try {
      const prompt = buildOeuvreArtDuJourPrompt(usableTopics, recentArtworkTitles);
      const content = await callOpenAI([{ role: "user", content: prompt }], {
        model,
        temperature: 0.5,
        responseFormat: { type: "json_object" }
      });
      raw = safeParseJson(content);
    } catch (err) {
      return { ok: false, hardError: true, reason: err.message };
    }

    if (!raw) return { ok: false, hardError: false, reason: "JSON invalide, tronqué ou non-objet." };

    const validation = validateOeuvreArtDuJourResponse(raw, usableTopics, recentArtworkTitlesNormalized);
    if (!validation.ok) return { ok: false, hardError: false, reason: validation.reason };

    if (validation.data.status === "insufficient") {
      return { ok: false, hardError: false, insufficient: true, reason: validation.data.reason };
    }
    return { ok: true, data: validation.data };
  }

  // Cache mémoire du résultat "du jour" : sans lui, chaque appel (page
  // Éclairages qui interroge les 6 rubriques d'un coup, poll frontend, appel
  // direct sur la page dédiée) tentait un INSERT systématiquement en échec
  // (23505, contenu déjà publié) suivi d'un SELECT — 2 aller-retours Supabase
  // par requête, sans aucune mise en cache, identifié comme source majeure
  // d'egress anormal (cf. rafales d'erreurs "duplicate key" en continu dans
  // les logs Postgres du 02/08/2026). États terminaux seulement (jamais
  // "generating") pour ne pas retarder la détection de fin de génération par
  // le poll frontend (4s).
  const TODAY_RESULT_CACHE_TTL_MS = 30 * 60 * 1000;
  let _todayResultCache = null; // { dateKey, result, computedAt }

  // Point d'entrée unique, appelé aussi bien par la route API que par le
  // scheduler : relit d'abord le contenu du jour (aucun appel IA si déjà
  // publié/insuffisant/en cours) et ne déclenche une génération que si
  // personne n'a encore réservé le créneau du jour.
  async function generateIfNeeded(date, options = {}) {
    const force = options && options.force === true;
    const dateKey = dateKeyFor(date || getCurrentDate());
    const nowIso = new Date().toISOString();

    if (!force && _todayResultCache && _todayResultCache.dateKey === dateKey
      && Date.now() - _todayResultCache.computedAt < TODAY_RESULT_CACHE_TTL_MS) {
      return _todayResultCache.result;
    }

    let claim;
    try {
      claim = await claimGenerationSlot(dateKey, nowIso, { force });
    } catch (err) {
      logger.error("[oeuvre-art-du-jour] réservation du créneau :", err.message);
      return { status: "failed", error: "Erreur de stockage. Réessaie plus tard." };
    }

    const result = claim.claimed
      ? await runGeneration(dateKey)
      : toClientResult(await repairPublishedArtworkImages(claim.row));

    _todayResultCache = result.status === "generating" ? null : { dateKey, result, computedAt: Date.now() };
    return result;
  }

  // Consultation d'une date précise (menu "jours précédents" du frontend) :
  // lecture seule, ne déclenche jamais de génération.
  async function getByDate(dateKey) {
    const { data, error } = await supabase.from(TABLE).select("*").eq("date", dateKey).maybeSingle();
    if (error) {
      logger.error("[oeuvre-art-du-jour] lecture d'une date archivée :", error.message);
      return { status: "failed", error: "Erreur de lecture. Réessaie plus tard." };
    }
    return toReadOnlyClientResult(data);
  }

  // Dates disponibles pour le menu de consultation — uniquement celles
  // réellement publiées, les plus récentes d'abord.
  async function listPublishedDates({ limit = 90 } = {}) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("date")
      .eq("status", "published")
      .order("date", { ascending: false })
      .limit(limit);
    if (error) {
      logger.error("[oeuvre-art-du-jour] liste des dates publiées :", error.message);
      return [];
    }
    return (data || []).map((row) => row.date);
  }

  return { generateIfNeeded, getByDate, listPublishedDates };
}

module.exports = {
  createOeuvreArtDuJourService,
  validateOeuvreArtDuJourResponse,
  safeParseJson,
  defaultFetchArtworkImage,
  validateArtworkPageMatch
};
