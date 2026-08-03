"use strict";

// Logique métier de la "Citation du jour" : sélection du sujet, génération
// IA, validation stricte, stockage Supabase, anti-concurrence. Jumelle des
// autres rubriques Éclairages (même architecture, choisit parmi les sujets
// publiés aujourd'hui sur Agôn), mais avec une présentation volontairement
// simple : la citation retenue et son sujet d'actualité ne sont jamais mis
// en regard l'un de l'autre à l'affichage (pas de shared_mechanism/
// essential_difference/conclusion) — le lien avec l'actualité ne sert qu'à
// choisir QUELLE citation retenir, jamais à la présenter comme un
// rapprochement explicite. Le champ le plus sensible ici est
// quote_text/quote_author : une citation fausse ou mal attribuée est une
// désinformation directe visant une personne réelle, cf. le garde-fou
// "insufficient par défaut" dans prompts/citation-du-jour.js. Ne dépend
// jamais de server.js — toutes ses dépendances (client Supabase, appel
// OpenAI, logger, horloge, récupération des sujets du jour) lui sont
// injectées via createCitationDuJourService(deps).

const { buildCitationDuJourPrompt } = require("../prompts/citation-du-jour");
const { fetchRecentEclairagesIdentities, normalizeIdentity, RECENT_REPEAT_AVOIDANCE_DAYS } = require("./eclairages-recent-usage");

const TABLE = "citation_du_jour";
const MAX_TOPICS_SENT = 10;
// gpt-4.1-mini, cohérent avec les autres rubriques Éclairages (meilleure
// qualité que gpt-4o-mini, coût toujours très inférieur à gpt-4o).
const DEFAULT_MODEL = "gpt-4.1-mini";
const MAX_GENERATION_ATTEMPTS = 3;
// Une seule citation par jour, la plus pertinente parmi les sujets du jour.
const MAX_CITATIONS_PER_DAY = 1;

// Au-delà de ce délai, une ligne restée en "generating" est considérée
// comme abandonnée (crash, redémarrage du process pendant l'appel IA) et
// peut être reprise par un appel suivant.
const GENERATING_STALE_MS = 3 * 60 * 1000;
// Évite de retenter un appel IA à chaque requête si la génération échoue en
// boucle : un seul essai par fenêtre de 5 minutes.
const FAILED_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

const PUBLISHED_ALLOWED_KEYS = new Set(["status", "citations"]);
const CITATION_ITEM_ALLOWED_KEYS = new Set([
  "current_topic_id", "quote_text", "quote_author", "quote_origin", "author_presentation",
  "news_connection", "sources"
]);
const INSUFFICIENT_ALLOWED_KEYS = new Set(["status", "reason"]);
const SOURCE_ALLOWED_KEYS = new Set(["title", "author", "publisher", "year", "url"]);

const FIELD_MAX_LENGTHS = {
  quote_text: 500,
  quote_author: 150,
  quote_origin: 200,
  author_presentation: 700,
  // Volontairement court : un "petit paragraphe" (2-3 phrases), pas une
  // section d'analyse comme dans les autres rubriques.
  news_connection: 400
};

const HTML_TAG_PATTERN = /<\/?[a-z!][^>]*>/i;

function stripDiacritics(str) {
  return String(str || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// --- Image (portrait de l'auteur de la citation) — même mécanisme que les
// autres rubriques : API publique Wikipedia, aucune clé requise, jamais
// générée ni devinée par l'IA. Dupliqué plutôt que partagé (cf. les autres
// rubriques, même convention de "fichiers jumeaux"). Pas de repli "presse"
// ici : l'image représente l'auteur cité, jamais le sujet d'actualité
// (qui n'est de toute façon jamais affiché pour cette rubrique) — seul le
// portrait Wikipedia est tenté.
const WIKIPEDIA_IMAGE_FETCH_TIMEOUT_MS = 8000;
const WIKIPEDIA_IMAGE_FETCH_ROUNDS = 2;
const WIKIPEDIA_IMAGE_RETRY_DELAY_MS = 400;
const QUOTE_IMAGE_REPAIR_COOLDOWN_MS = 15 * 60 * 1000;
const WIKIMEDIA_IMAGE_HOST_PREFIX = "https://upload.wikimedia.org/";
const WIKIPEDIA_MATCH_STOPWORDS = new Set([
  "dans", "les", "des", "une", "avec", "pour", "contre", "leurs", "cette",
  "sont", "plus", "entre", "ainsi", "comme", "depuis", "their", "with",
  "from", "were", "have", "this", "that", "been", "during", "under"
]);
function significantWordsForMatch(str) {
  return stripDiacritics(str).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .map((w) => w.replace(/s$/, ""))
    .filter((w) => w.length >= 4 && !WIKIPEDIA_MATCH_STOPWORDS.has(w));
}
function titlesShareSignificantWord(queryTitle, pageTitle) {
  const queryWords = new Set(significantWordsForMatch(queryTitle));
  if (!queryWords.size) return false;
  return significantWordsForMatch(pageTitle).some((w) => queryWords.has(w));
}

async function queryWikipediaImage(lang, title) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(title)}&gsrlimit=1&prop=pageimages%7Cinfo&inprop=url&pithumbsize=800&format=json&origin=*`;
  const res = await fetch(url, { signal: AbortSignal.timeout(WIKIPEDIA_IMAGE_FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  const body = await res.json();
  const pages = body && body.query && body.query.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  const imageUrl = page && page.thumbnail && page.thumbnail.source;
  if (!imageUrl || !imageUrl.startsWith(WIKIMEDIA_IMAGE_HOST_PREFIX)) return null;
  // Une image "de tête" en SVG (carte, drapeau, blason) n'est jamais une vraie photo/portrait.
  if (/\.svg(\/|$)/i.test(imageUrl)) return null;
  if (!titlesShareSignificantWord(title, page.title || "")) return null;
  const pageUrl = page.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(page.title || "").replace(/ /g, "_"))}`;
  return { imageUrl, pageUrl, pageTitle: page.title || null };
}

// Cherche un portrait de l'auteur de la citation (quote_author). Best-effort :
// ne bloque jamais la publication, se contente de publier sans image en cas
// d'échec/absence de résultat pertinent.
async function defaultFetchQuoteAuthorImage(quoteAuthor) {
  const cleanName = String(quoteAuthor || "").trim();
  if (!cleanName) return null;
  for (let round = 1; round <= WIKIPEDIA_IMAGE_FETCH_ROUNDS; round++) {
    for (const lang of ["fr", "en"]) {
      try {
        const result = await queryWikipediaImage(lang, cleanName);
        if (result) return result;
      } catch (e) {
        // réseau/timeout sur cette langue : on tente la suivante sans jamais
        // rendre l'image bloquante pour la publication.
      }
    }
    if (round < WIKIPEDIA_IMAGE_FETCH_ROUNDS) {
      await new Promise((resolve) => setTimeout(resolve, WIKIPEDIA_IMAGE_RETRY_DELAY_MS));
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

// L'IA n'a aucune recherche documentaire réelle sur l'origine d'une
// citation (contrairement au sujet d'actu, dont les URL sont fournies mais
// n'ont de toute façon rien à voir avec la source d'une citation) : toute
// URL produite pour une source est par nature une invention, systématiquement
// mise à null plutôt que rejetée (une référence sans lien reste acceptable,
// cf. règle URL du prompt).
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

// Valide UNE citation (champs présents, longueurs, HTML, sujet choisi,
// sources). validTopicIds est calculé une fois pour tout le tableau par
// l'appelant.
// recentAuthorsNormalized (cf. lib/eclairages-recent-usage.js) contient les
// quote_author déjà publiés dans les RECENT_REPEAT_AVOIDANCE_DAYS derniers
// jours — un filet de sécurité qui s'applique même si l'IA ignore la
// consigne du prompt (ne pas reproposer le même auteur trop vite).
function validateSingleCitation(raw, validTopicIds, recentAuthorsNormalized) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "chaque citation doit être un objet JSON." };
  }
  const extraKeys = Object.keys(raw).filter((k) => !CITATION_ITEM_ALLOWED_KEYS.has(k));
  if (extraKeys.length) return { ok: false, reason: `champ(s) inattendu(s) dans une citation : ${extraKeys.join(", ")}.` };

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

  if (recentAuthorsNormalized && recentAuthorsNormalized.has(normalizeIdentity(raw.quote_author))) {
    return { ok: false, reason: `quote_author déjà utilisé dans les ${RECENT_REPEAT_AVOIDANCE_DAYS} derniers jours.` };
  }

  // Tolérance volontairement large : un rejet systématique dès que l'IA
  // dévie légèrement de "2 à 4 phrases" serait plus nuisible qu'une
  // présentation un peu plus longue ou courte mais valable.
  const wordCount = countWords(raw.author_presentation);
  if (wordCount < 10 || wordCount > 150) {
    return { ok: false, reason: `author_presentation hors bornes raisonnables (${wordCount} mots).` };
  }
  // Bornes plus serrées que author_presentation : "petit paragraphe" (2-3
  // phrases) doit rester court, pas dériver vers une section d'analyse.
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
      quote_text: raw.quote_text.trim(),
      quote_author: raw.quote_author.trim(),
      quote_origin: raw.quote_origin.trim(),
      author_presentation: raw.author_presentation.trim(),
      news_connection: raw.news_connection.trim(),
      sources: sourcesValidation.sources
    }
  };
}

// Validation stricte de la réponse IA : présence des champs, valeurs
// autorisées, exactement MAX_CITATIONS_PER_DAY citation(s), sujet reconnu,
// longueurs raisonnables, absence de HTML, absence de champs inattendus.
// Toute réponse qui ne passe pas ce filtre est traitée comme un échec de
// génération — jamais enregistrée comme contenu publié.
function validateCitationDuJourResponse(raw, topics, recentAuthorsNormalized) {
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

  if (!Array.isArray(raw.citations) || raw.citations.length !== MAX_CITATIONS_PER_DAY) {
    return { ok: false, reason: `citations doit être un tableau de ${MAX_CITATIONS_PER_DAY} élément(s).` };
  }

  const validTopicIds = new Set((topics || []).map((t) => String(t.id)));

  const validatedCitations = [];
  for (const item of raw.citations) {
    const result = validateSingleCitation(item, validTopicIds, recentAuthorsNormalized);
    if (!result.ok) return result;
    validatedCitations.push(result.data);
  }

  return { ok: true, data: { status: "published", citations: validatedCitations } };
}

function createCitationDuJourService(deps) {
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
    // Portrait de l'auteur de la citation (défaut = vraie implémentation
    // Wikipedia, aucune config projet nécessaire).
    fetchQuoteAuthorImage = defaultFetchQuoteAuthorImage
  } = deps || {};

  if (!supabase) throw new Error("createCitationDuJourService: 'supabase' manquant.");
  if (typeof callOpenAI !== "function") throw new Error("createCitationDuJourService: 'callOpenAI' manquant.");
  if (typeof getPublishedTopicsForDate !== "function") {
    throw new Error("createCitationDuJourService: 'getPublishedTopicsForDate' manquant.");
  }
  if (typeof dateKeyFor !== "function") throw new Error("createCitationDuJourService: 'dateKeyFor' manquant.");

  const imageRepairInFlight = new Map();

  function toClientResult(row) {
    if (!row) return { status: "insufficient", reason: "Aucun contenu disponible pour le moment." };
    switch (row.status) {
      case "published":
        return { status: "published", date: row.date, generatedAt: row.generated_at, content: row.content };
      case "insufficient":
        return {
          status: "insufficient",
          reason: (row.content && row.content.reason) || row.error_message || "Aucune citation authentique n'a pu être établie aujourd'hui."
        };
      case "generating":
        return { status: "generating" };
      case "failed":
      default:
        return { status: "failed", error: "La génération de la citation du jour a échoué. Réessaie plus tard." };
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
          reason: (row.content && row.content.reason) || row.error_message || "Aucune citation authentique n'a pu être établie ce jour-là."
        };
      case "generating":
        return { status: "generating", date: row.date };
      case "failed":
      default:
        return { status: "failed", date: row.date, error: "La génération de la citation du jour a échoué ce jour-là." };
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
    if (error) logger.error("[citation-du-jour] écriture échec :", error.message);
  }

  async function markInsufficient(dateKey, reason) {
    const { error } = await supabase
      .from(TABLE)
      .update({ status: "insufficient", content: { reason }, error_message: null, updated_at: new Date().toISOString() })
      .eq("date", dateKey);
    if (error) logger.error("[citation-du-jour] écriture insuffisant :", error.message);
  }

  async function markPublished(dateKey, data) {
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from(TABLE)
      .update({
        status: "published",
        current_topic_id: data.citations.map((c) => c.current_topic_id).join(","),
        content: data,
        error_message: null,
        generated_at: nowIso,
        updated_at: nowIso
      })
      .eq("date", dateKey);
    if (error) logger.error("[citation-du-jour] écriture publication :", error.message);
  }

  // Ajoute une image à UNE citation déjà validée, TOUJOURS avec un crédit de
  // source (jamais d'image sans indiquer d'où elle vient) : un portrait de
  // l'auteur cité (Wikipedia). Pas de repli "presse" ici, contrairement aux
  // autres rubriques : l'image représente l'auteur cité, jamais le sujet
  // d'actualité — ne fait jamais échouer la publication : sans portrait
  // trouvé, publié sans image.
  async function attachQuoteImageToOne(citation) {
    const checkedAt = new Date().toISOString();
    try {
      const image = await fetchQuoteAuthorImage(citation.quote_author);
      if (image && image.imageUrl) {
        return {
          ...citation,
          quote_author_image_url: image.imageUrl,
          quote_author_image_page_url: image.pageUrl || null,
          quote_author_image_source: "wikipedia",
          quote_author_image_credit: "Wikipedia",
          quote_author_image_checked_at: checkedAt
        };
      }
    } catch (err) {
      logger.error("[citation-du-jour] recherche image Wikipedia :", err.message);
    }

    return {
      ...citation,
      quote_author_image_url: null,
      quote_author_image_page_url: null,
      quote_author_image_source: null,
      quote_author_image_credit: null,
      quote_author_image_checked_at: checkedAt
    };
  }

  async function attachQuoteImages(data) {
    const enrichedCitations = [];
    for (const citation of data.citations) {
      enrichedCitations.push(await attachQuoteImageToOne(citation));
    }
    return { ...data, citations: enrichedCitations };
  }

  function quoteNeedsImageRepair(citation) {
    if (!citation || citation.quote_author_image_url || !String(citation.quote_author || "").trim()) return false;
    const checkedAt = new Date(citation.quote_author_image_checked_at || 0).getTime();
    return !Number.isFinite(checkedAt) || checkedAt <= 0 || Date.now() - checkedAt >= QUOTE_IMAGE_REPAIR_COOLDOWN_MS;
  }

  // Une panne Wikipedia ne doit plus figer une citation sans portrait pour
  // toute la journée. Lors de la prochaine lecture de /today, retente les
  // images manquantes (au plus une fois toutes les 15 min), puis persiste la
  // réparation sans régénérer le texte ni changer son horodatage de création.
  async function repairPublishedQuoteImages(row) {
    if (!row || row.status !== "published" || !Array.isArray(row.content?.citations)) return row;
    if (!row.content.citations.some(quoteNeedsImageRepair)) return row;

    const dateKey = String(row.date || "");
    if (imageRepairInFlight.has(dateKey)) {
      const content = await imageRepairInFlight.get(dateKey);
      return content ? { ...row, content } : row;
    }

    const repairPromise = (async () => {
      const citations = [];
      for (const citation of row.content.citations) {
        citations.push(quoteNeedsImageRepair(citation) ? await attachQuoteImageToOne(citation) : citation);
      }
      const content = { ...row.content, citations };
      const { error } = await supabase
        .from(TABLE)
        .update({ content, updated_at: new Date().toISOString() })
        .eq("date", dateKey)
        .eq("status", "published");
      if (error) {
        logger.error("[citation-du-jour] réparation image :", error.message);
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
      logger.error("[citation-du-jour] récupération sujets :", err.message);
      await markFailed(dateKey, "Erreur lors de la récupération des sujets du jour.");
      return { status: "failed", error: "Erreur lors de la récupération des sujets du jour." };
    }

    let usableTopics = (Array.isArray(topics) ? topics : [])
      .filter((t) => t && t.id != null && String(t.title || "").trim() && String(t.summary || "").trim())
      .slice(0, MAX_TOPICS_SENT);

    // Les autres rubriques Éclairages ont toujours priorité sur le choix du
    // sujet : la citation du jour attend leur résultat du jour
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
        logger.error("[citation-du-jour] récupération des sujets déjà couverts :", err.message);
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
        logger.warn("[citation-du-jour] aucun sujet publié pour l'instant, génération reportée.");
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
        `[citation-du-jour] génération ${dateKey} — ${usableTopics.length} sujet(s) transmis, modèle ${model}.`
      );
    }

    // Auteurs déjà publiés dans les RECENT_REPEAT_AVOIDANCE_DAYS derniers
    // jours (cf. lib/eclairages-recent-usage.js) : transmis à l'IA (prompt)
    // et vérifiés à nouveau après coup (validateSingleCitation), pour ne
    // jamais reproposer le même auteur trop vite.
    const { raw: recentAuthors, normalized: recentAuthorsNormalized } = await fetchRecentEclairagesIdentities({
      supabase,
      table: TABLE,
      contentKey: "citations",
      identityField: "quote_author",
      todayDateKey: dateKey,
      logger
    });

    // Avec un modèle économique, une réponse "insufficient" ou invalide est
    // parfois un aléa du tirage plutôt qu'un vrai refus. On retente donc
    // quelques fois avant d'abandonner. Les pannes réseau/API franches
    // (hardError) ne sont pas retentées ici.
    let lastOutcome = null;
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      const outcome = await attemptGenerationOnce(usableTopics, recentAuthors, recentAuthorsNormalized);
      lastOutcome = outcome;
      if (outcome.ok) {
        const topicsById = new Map(usableTopics.map((topic) => [String(topic.id), topic]));
        const dataWithTopicContext = {
          ...outcome.data,
          citations: outcome.data.citations.map((citation) => {
            const topic = topicsById.get(String(citation.current_topic_id));
            return {
              ...citation,
              current_topic_title: String(topic?.title || "").trim(),
              current_topic_summary: String(topic?.summary || "").trim()
            };
          })
        };
        const enrichedData = await attachQuoteImages(dataWithTopicContext);
        await markPublished(dateKey, enrichedData);
        return { status: "published", date: dateKey, generatedAt: new Date().toISOString(), content: enrichedData };
      }
      if (outcome.hardError) break;
    }

    if (lastOutcome && lastOutcome.hardError) {
      logger.error("[citation-du-jour] appel IA :", lastOutcome.reason);
      await markFailed(dateKey, "Erreur lors de l'appel au modèle IA.");
      return { status: "failed", error: "Erreur lors de la génération. Réessaie plus tard." };
    }
    if (lastOutcome && lastOutcome.insufficient) {
      await markInsufficient(dateKey, lastOutcome.reason);
      return { status: "insufficient", reason: lastOutcome.reason };
    }

    logger.error(`[citation-du-jour] validation refusée après ${MAX_GENERATION_ATTEMPTS} tentative(s) : ${lastOutcome && lastOutcome.reason}`);
    await markFailed(dateKey, `Validation refusée : ${lastOutcome && lastOutcome.reason}`);
    return { status: "failed", error: "Réponse invalide reçue. Réessaie plus tard." };
  }

  // Un seul essai : appel IA + parsing + validation. Ne touche pas à Supabase
  // (runGeneration décide quoi écrire une fois la boucle de tentatives finie).
  async function attemptGenerationOnce(usableTopics, recentAuthors, recentAuthorsNormalized) {
    let raw;
    try {
      const prompt = buildCitationDuJourPrompt(usableTopics, recentAuthors);
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

    const validation = validateCitationDuJourResponse(raw, usableTopics, recentAuthorsNormalized);
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
      logger.error("[citation-du-jour] réservation du créneau :", err.message);
      return { status: "failed", error: "Erreur de stockage. Réessaie plus tard." };
    }

    const result = claim.claimed
      ? await runGeneration(dateKey)
      : toClientResult(await repairPublishedQuoteImages(claim.row));

    _todayResultCache = result.status === "generating" ? null : { dateKey, result, computedAt: Date.now() };
    return result;
  }

  // Consultation d'une date précise (menu "jours précédents" du frontend) :
  // lecture seule, ne déclenche jamais de génération.
  async function getByDate(dateKey) {
    const { data, error } = await supabase.from(TABLE).select("*").eq("date", dateKey).maybeSingle();
    if (error) {
      logger.error("[citation-du-jour] lecture d'une date archivée :", error.message);
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
      logger.error("[citation-du-jour] liste des dates publiées :", error.message);
      return [];
    }
    return (data || []).map((row) => row.date);
  }

  return { generateIfNeeded, getByDate, listPublishedDates };
}

module.exports = {
  createCitationDuJourService,
  validateCitationDuJourResponse,
  safeParseJson,
  defaultFetchQuoteAuthorImage
};
