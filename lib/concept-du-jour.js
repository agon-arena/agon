"use strict";

// Logique métier du "Concept du jour" : sélection du sujet, génération IA,
// validation stricte, stockage Supabase, anti-concurrence. Jumeau de
// lib/mecanisme-sociologique.js (même architecture, mêmes garde-fous),
// adapté à un principe plus large : le concept retenu peut relever de la
// psychologie, la sociologie, la rhétorique, l'économie, la science
// politique, la philosophie ou les sciences (cf. concept_domain), pas
// seulement de la sociologie. Ne dépend jamais de server.js — toutes ses
// dépendances (client Supabase, appel OpenAI, logger, horloge, récupération
// des sujets du jour) lui sont injectées via createConceptDuJourService(deps).

const { buildConceptDuJourPrompt, DOMAIN_SLUGS } = require("../prompts/concept-du-jour");

const TABLE = "concept_du_jour";
const MAX_TOPICS_SENT = 10;
// gpt-4.1-mini, cohérent avec les trois autres rubriques Éclairages
// (meilleure qualité que gpt-4o-mini, coût toujours très inférieur à gpt-4o).
const DEFAULT_MODEL = "gpt-4.1-mini";
const MAX_GENERATION_ATTEMPTS = 3;
// Un seul concept par jour, le plus pertinent parmi les sujets du jour —
// évite de multiplier les rapprochements de qualité inégale et limite le
// coût (moins de tokens de sortie par génération).
const MAX_CONCEPTS_PER_DAY = 1;

// Au-delà de ce délai, une ligne restée en "generating" est considérée
// comme abandonnée (crash, redémarrage du process pendant l'appel IA) et
// peut être reprise par un appel suivant.
const GENERATING_STALE_MS = 3 * 60 * 1000;
// Évite de retenter un appel IA à chaque requête si la génération échoue en
// boucle (sujets insuffisants récurrents, panne API) : un seul essai par
// fenêtre de 5 minutes.
const FAILED_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
const WIKIPEDIA_IMAGE_FETCH_ROUNDS = 2;
const WIKIPEDIA_IMAGE_RETRY_DELAY_MS = 400;
const CONCEPT_IMAGE_REPAIR_COOLDOWN_MS = 15 * 60 * 1000;

const PUBLISHED_ALLOWED_KEYS = new Set(["status", "concepts"]);
const CONCEPT_ITEM_ALLOWED_KEYS = new Set([
  "current_topic_id", "current_topic_title", "current_topic_summary",
  "concept_domain", "concept_name", "concept_originator", "concept_origin",
  "concept_explanation", "shared_mechanism", "essential_difference",
  "conclusion", "sources"
]);
const INSUFFICIENT_ALLOWED_KEYS = new Set(["status", "reason"]);
const SOURCE_ALLOWED_KEYS = new Set(["title", "author", "publisher", "year", "url"]);
const DOMAIN_SLUG_SET = new Set(DOMAIN_SLUGS);

const FIELD_MAX_LENGTHS = {
  current_topic_title: 300,
  current_topic_summary: 700,
  concept_name: 200,
  concept_originator: 150,
  concept_origin: 150,
  concept_explanation: 1400,
  shared_mechanism: 1400,
  essential_difference: 1000,
  conclusion: 900
};

const HTML_TAG_PATTERN = /<\/?[a-z!][^>]*>/i;
// Termes qui ne doivent apparaître dans l'analyse que si le sujet
// d'actualité lui-même en parle déjà — même garde-fou que les trois autres
// rubriques.
const SENSITIVE_TERMS = ["nazi", "nazisme", "nazie", "holocauste", "genocide"];

function stripDiacritics(str) {
  return String(str || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// --- Image (portrait/illustration du penseur ou du courant cité) — même
// mécanisme que dans lib/mecanisme-sociologique.js : API publique Wikipedia,
// aucune clé requise, jamais générée ni devinée par l'IA. Dupliqué plutôt
// que partagé (cf. lib/parallele-historique.js, lib/pensee-philosophique.js
// et lib/mecanisme-sociologique.js, même convention de "fichiers jumeaux"
// que le reste de cette fonctionnalité).
const WIKIPEDIA_IMAGE_FETCH_TIMEOUT_MS = 8000;
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
  // Même filtre que les trois autres rubriques : une image "de tête" en SVG
  // (carte, drapeau, blason) n'est jamais une vraie photo/portrait.
  if (/\.svg(\/|$)/i.test(imageUrl)) return null;
  if (!titlesShareSignificantWord(title, page.title || "")) return null;
  const pageUrl = page.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(page.title || "").replace(/ /g, "_"))}`;
  return { imageUrl, pageUrl, pageTitle: page.title || null };
}

// Cherche d'abord un portrait/illustration du penseur ou courant cité
// (concept_originator), puis à défaut une image liée au concept lui-même
// (concept_name). Best-effort : ne bloque jamais la publication, se
// contente de publier sans image en cas d'échec/absence de résultat pertinent.
async function defaultFetchConceptOriginatorImage(conceptOriginator, conceptName) {
  const cleanName = String(conceptOriginator || "").trim();
  const cleanConcept = String(conceptName || "").trim();
  for (let round = 1; round <= WIKIPEDIA_IMAGE_FETCH_ROUNDS; round++) {
    if (cleanName) {
      for (const lang of ["fr", "en"]) {
        try {
          const result = await queryWikipediaImage(lang, cleanName);
          if (result) return result;
        } catch (e) {
          // réseau/timeout sur cette langue : on tente la suivante sans jamais échouer bloquant.
        }
      }
    }

    if (cleanConcept) {
      try {
        const result = await queryWikipediaImage("fr", cleanConcept);
        if (result) return result;
      } catch (e) {
        // idem : pas d'échec bloquant.
      }
    }

    if (round < WIKIPEDIA_IMAGE_FETCH_ROUNDS) {
      await new Promise((resolve) => setTimeout(resolve, WIKIPEDIA_IMAGE_RETRY_DELAY_MS));
    }
  }

  return null;
}

// Dernier repli pour créditer une image de presse quand ni le nom de source
// connu ni og:site_name ne sont disponibles : au moins le nom de domaine,
// jamais une image affichée sans aucune indication de provenance.
function domainFromUrl(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (e) {
    return null;
  }
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

function isPlausibleHttpUrl(value) {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string" || value.length > 500) return false;
  return /^https?:\/\/\S+$/i.test(value.trim());
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

// L'IA n'a aucune recherche documentaire réelle : toute URL qu'elle produit
// est par nature une invention, SAUF si elle recopie une des URL déjà
// fournies dans le prompt (les vraies sources des sujets envoyés).
// Certains modèles renvoient le texte littéral "null" (une vraie chaîne, pas
// un JSON null) pour un champ optionnel vide — on le neutralise avant toute
// validation/affichage pour ne jamais montrer "null" comme texte dans l'UI.
function normalizeNullableField(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  return trimmed;
}

function validateSources(sources, knownUrls) {
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
      year: normalizeNullableField(rawSource.year),
      url: normalizeNullableField(rawSource.url)
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
    if (!isPlausibleHttpUrl(source.url)) return { ok: false, reason: "champ url de source invalide." };

    const url = source.url && knownUrls.has(source.url.trim()) ? source.url.trim() : null;
    sanitized.push({
      title: source.title.trim(),
      author: source.author,
      publisher: source.publisher,
      year: source.year,
      url
    });
  }
  return { ok: true, sources: sanitized };
}

// Valide UN concept (champs présents, longueurs, HTML, comparaison
// sensible, sources). knownUrls et validTopicIds sont calculés une fois
// pour tout le tableau par l'appelant.
function validateSingleConcept(raw, validTopicIds, knownUrls) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "chaque concept doit être un objet JSON." };
  }
  const extraKeys = Object.keys(raw).filter((k) => !CONCEPT_ITEM_ALLOWED_KEYS.has(k));
  if (extraKeys.length) return { ok: false, reason: `champ(s) inattendu(s) dans un concept : ${extraKeys.join(", ")}.` };

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

  if (typeof raw.concept_domain !== "string" || !DOMAIN_SLUG_SET.has(raw.concept_domain.trim())) {
    return { ok: false, reason: `concept_domain invalide (doit être l'un de : ${DOMAIN_SLUGS.join(", ")}).` };
  }

  for (const [field, maxLength] of Object.entries(FIELD_MAX_LENGTHS)) {
    if (!isNonEmptyString(raw[field], maxLength)) return { ok: false, reason: `${field} manquant, vide ou trop long.` };
    if (containsHtml(raw[field])) return { ok: false, reason: `${field} contient du HTML.` };
  }

  // Tolérance volontairement plus large que la consigne "80-120 mots" du
  // prompt : un rejet systématique dès que l'IA dévie légèrement serait
  // plus nuisible qu'un contenu un peu plus long/court mais valable.
  const coreWordCount = countWords(raw.concept_explanation) + countWords(raw.shared_mechanism)
    + countWords(raw.essential_difference) + countWords(raw.conclusion);
  if (coreWordCount < 30 || coreWordCount > 260) {
    return { ok: false, reason: `longueur du texte principal hors bornes raisonnables (${coreWordCount} mots).` };
  }

  const currentTopicText = stripDiacritics(`${raw.current_topic_title} ${raw.current_topic_summary}`).toLowerCase();
  const conceptText = stripDiacritics(`${raw.concept_name} ${raw.concept_explanation} ${raw.shared_mechanism} ${raw.essential_difference} ${raw.conclusion}`).toLowerCase();
  const introducesSensitiveTermItself = SENSITIVE_TERMS.some((term) => currentTopicText.includes(term));
  const usesSensitiveTermAsAnalogy = SENSITIVE_TERMS.some((term) => conceptText.includes(term));
  if (usesSensitiveTermAsAnalogy && !introducesSensitiveTermItself) {
    return {
      ok: false,
      reason: "comparaison sensible (nazisme/génocide) refusée automatiquement : le sujet d'actualité ne porte pas lui-même sur ce thème."
    };
  }

  const sourcesValidation = validateSources(raw.sources, knownUrls);
  if (!sourcesValidation.ok) return sourcesValidation;

  return {
    ok: true,
    data: {
      current_topic_id: normalizedTopicId,
      current_topic_title: raw.current_topic_title.trim(),
      current_topic_summary: raw.current_topic_summary.trim(),
      concept_domain: raw.concept_domain.trim(),
      concept_name: raw.concept_name.trim(),
      concept_originator: raw.concept_originator.trim(),
      concept_origin: raw.concept_origin.trim(),
      concept_explanation: raw.concept_explanation.trim(),
      shared_mechanism: raw.shared_mechanism.trim(),
      essential_difference: raw.essential_difference.trim(),
      conclusion: raw.conclusion.trim(),
      sources: sourcesValidation.sources
    }
  };
}

// Validation stricte de la réponse IA : présence des champs, valeurs
// autorisées, 1 à MAX_CONCEPTS_PER_DAY concept(s) (jamais 0, jamais un
// doublon de sujet), longueurs raisonnables, absence de HTML, absence de
// champs inattendus, et garde-fou éditorial (comparaison sensible
// injustifiée). Toute réponse qui ne passe pas ce filtre est traitée comme
// un échec de génération — jamais enregistrée comme contenu publié.
function validateConceptDuJourResponse(raw, topics) {
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

  if (!Array.isArray(raw.concepts) || raw.concepts.length < 1 || raw.concepts.length > MAX_CONCEPTS_PER_DAY) {
    return { ok: false, reason: `concepts doit être un tableau de ${MAX_CONCEPTS_PER_DAY} élément(s).` };
  }

  const validTopicIds = new Set((topics || []).map((t) => String(t.id)));
  // URL "connues" = celles réellement fournies au modèle pour les sujets du
  // jour — la seule liste qu'une url de sortie a le droit de recopier.
  const knownUrls = new Set(
    (topics || []).flatMap((t) => (Array.isArray(t.sources) ? t.sources : []).map((s) => s && s.url).filter(Boolean))
  );

  const validatedConcepts = [];
  const usedTopicIds = new Set();
  for (const item of raw.concepts) {
    const result = validateSingleConcept(item, validTopicIds, knownUrls);
    if (!result.ok) return result;
    if (usedTopicIds.has(result.data.current_topic_id)) {
      return { ok: false, reason: `plusieurs concepts portent sur le même sujet (${result.data.current_topic_id}).` };
    }
    usedTopicIds.add(result.data.current_topic_id);
    validatedConcepts.push(result.data);
  }

  return { ok: true, data: { status: "published", concepts: validatedConcepts } };
}

function createConceptDuJourService(deps) {
  const {
    supabase,
    callOpenAI,
    logger = console,
    getCurrentDate = () => new Date(),
    getPublishedTopicsForDate,
    dateKeyFor,
    model = DEFAULT_MODEL,
    debugLogging = false,
    // Évite que plusieurs rubriques traitent le même sujet le même jour
    // (cas réel observé sur le parallèle historique/pensée philosophique :
    // "Crépol" choisi par les deux à la fois). Optionnel : sans cette
    // dépendance, aucune exclusion n'est appliquée (comportement d'avant,
    // ex. en test).
    getExcludedTopicIds = async () => new Set(),
    // Portrait/illustration du penseur ou courant cité (défaut = vraie
    // implémentation Wikipedia, aucune config projet nécessaire).
    fetchConceptOriginatorImage = defaultFetchConceptOriginatorImage,
    // Repli "presse" (image de l'article du sujet actuel) : pas de valeur
    // par défaut, dépend de l'infrastructure de server.js — no-op si non
    // fourni (ex. en test).
    fetchPressPreviewImage = async () => null
  } = deps || {};

  if (!supabase) throw new Error("createConceptDuJourService: 'supabase' manquant.");
  if (typeof callOpenAI !== "function") throw new Error("createConceptDuJourService: 'callOpenAI' manquant.");
  if (typeof getPublishedTopicsForDate !== "function") {
    throw new Error("createConceptDuJourService: 'getPublishedTopicsForDate' manquant.");
  }
  if (typeof dateKeyFor !== "function") throw new Error("createConceptDuJourService: 'dateKeyFor' manquant.");

  const imageRepairInFlight = new Map();

  function toClientResult(row) {
    if (!row) return { status: "insufficient", reason: "Aucun contenu disponible pour le moment." };
    switch (row.status) {
      case "published":
        return { status: "published", date: row.date, generatedAt: row.generated_at, content: row.content };
      case "insufficient":
        return {
          status: "insufficient",
          reason: (row.content && row.content.reason) || row.error_message || "Aucun concept sérieux n'a pu être établi aujourd'hui."
        };
      case "generating":
        return { status: "generating" };
      case "failed":
      default:
        return { status: "failed", error: "La génération du concept du jour a échoué. Réessaie plus tard." };
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
          reason: (row.content && row.content.reason) || row.error_message || "Aucun concept sérieux n'a pu être établi ce jour-là."
        };
      case "generating":
        return { status: "generating", date: row.date };
      case "failed":
      default:
        return { status: "failed", date: row.date, error: "La génération du concept du jour a échoué ce jour-là." };
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
    if (error) logger.error("[concept-du-jour] écriture échec :", error.message);
  }

  async function markInsufficient(dateKey, reason) {
    const { error } = await supabase
      .from(TABLE)
      .update({ status: "insufficient", content: { reason }, error_message: null, updated_at: new Date().toISOString() })
      .eq("date", dateKey);
    if (error) logger.error("[concept-du-jour] écriture insuffisant :", error.message);
  }

  async function markPublished(dateKey, data) {
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from(TABLE)
      .update({
        status: "published",
        // La colonne reste un seul texte (pas de migration de schéma) : liste
        // jointe des sujets couverts par le(s) concept(s) publié(s) — la
        // vraie source de vérité reste content.concepts[].current_topic_id.
        current_topic_id: data.concepts.map((c) => c.current_topic_id).join(","),
        content: data,
        error_message: null,
        generated_at: nowIso,
        updated_at: nowIso
      })
      .eq("date", dateKey);
    if (error) logger.error("[concept-du-jour] écriture publication :", error.message);
  }

  // Ajoute une image à UN concept déjà validé, TOUJOURS avec un crédit de
  // source (jamais d'image sans indiquer d'où elle vient) : d'abord un
  // portrait/illustration du penseur ou courant cité (Wikipedia), et si rien
  // de pertinent n'est trouvé, repli sur l'image déjà publiée avec l'arène
  // du sujet d'actualité (illustration de l'actu, pas du penseur — mais
  // réelle et déjà vérifiée par le site). Ne fait jamais échouer la
  // publication : sans aucune des deux, publié sans image.
  async function attachConceptImageToOne(concept, matchingTopic) {
    const checkedAt = new Date().toISOString();
    try {
      const image = await fetchConceptOriginatorImage(concept.concept_originator, concept.concept_name);
      if (image && image.imageUrl) {
        return {
          ...concept,
          concept_image_url: image.imageUrl,
          concept_image_page_url: image.pageUrl || null,
          concept_image_source: "wikipedia",
          concept_image_credit: "Wikipedia",
          concept_image_checked_at: checkedAt
        };
      }
    } catch (err) {
      logger.error("[concept-du-jour] recherche image Wikipedia :", err.message);
    }

    const primarySource = matchingTopic && Array.isArray(matchingTopic.sources) ? matchingTopic.sources[0] : null;
    const sourceUrl = primarySource ? primarySource.url : null;

    const knownPressImageUrl = matchingTopic && matchingTopic.currentTopicImageUrl;
    if (knownPressImageUrl) {
      return {
        ...concept,
        concept_image_url: knownPressImageUrl,
        concept_image_page_url: sourceUrl || null,
        concept_image_source: "press",
        concept_image_credit: (primarySource && primarySource.name) || domainFromUrl(sourceUrl) || "source de l'actualité",
        concept_image_checked_at: checkedAt
      };
    }

    if (sourceUrl) {
      try {
        const preview = await fetchPressPreviewImage(sourceUrl);
        if (preview && preview.imageUrl) {
          return {
            ...concept,
            concept_image_url: preview.imageUrl,
            concept_image_page_url: sourceUrl,
            concept_image_source: "press",
            concept_image_credit: preview.siteName || (primarySource && primarySource.name) || domainFromUrl(sourceUrl) || "source de l'actualité",
            concept_image_checked_at: checkedAt
          };
        }
      } catch (err) {
        logger.error("[concept-du-jour] aperçu image de presse :", err.message);
      }
    }

    return {
      ...concept,
      concept_image_url: null,
      concept_image_page_url: null,
      concept_image_source: null,
      concept_image_credit: null,
      concept_image_checked_at: checkedAt
    };
  }

  // Enrichit chaque concept du tableau — en série plutôt qu'en parallèle JS
  // pour rester sous le radar des limites de débit de l'API Wikipedia
  // publique malgré le petit nombre d'appels.
  async function attachConceptImages(data, usableTopics) {
    const topicsById = new Map((usableTopics || []).map((t) => [String(t.id), t]));
    const enrichedConcepts = [];
    for (const concept of data.concepts) {
      const matchingTopic = topicsById.get(concept.current_topic_id);
      enrichedConcepts.push(await attachConceptImageToOne(concept, matchingTopic));
    }
    return { ...data, concepts: enrichedConcepts };
  }

  function conceptNeedsImageRepair(concept) {
    if (!concept || concept.concept_image_url || (!String(concept.concept_originator || "").trim() && !String(concept.concept_name || "").trim())) return false;
    const checkedAt = new Date(concept.concept_image_checked_at || 0).getTime();
    return !Number.isFinite(checkedAt) || Date.now() - checkedAt >= CONCEPT_IMAGE_REPAIR_COOLDOWN_MS;
  }

  async function repairPublishedConceptImages(row) {
    if (!row || row.status !== "published" || !Array.isArray(row.content && row.content.concepts)) return row;
    if (!row.content.concepts.some(conceptNeedsImageRepair)) return row;
    const dateKey = String(row.date || "");
    if (imageRepairInFlight.has(dateKey)) {
      const content = await imageRepairInFlight.get(dateKey);
      return content ? { ...row, content } : row;
    }
    const repairPromise = (async () => {
      let topics;
      try {
        topics = await getPublishedTopicsForDate(dateKey);
      } catch (err) {
        logger.error("[concept-du-jour] récupération sujets pour réparation image :", err.message);
        return null;
      }
      const topicsById = new Map((Array.isArray(topics) ? topics : []).map((topic) => [String(topic.id), topic]));
      const concepts = [];
      for (const concept of row.content.concepts) {
        concepts.push(conceptNeedsImageRepair(concept)
          ? await attachConceptImageToOne(concept, topicsById.get(String(concept.current_topic_id)))
          : concept);
      }
      const content = { ...row.content, concepts };
      const { error } = await supabase.from(TABLE).update({ content, updated_at: new Date().toISOString() }).eq("date", dateKey).eq("status", "published");
      if (error) {
        logger.error("[concept-du-jour] écriture réparation image :", error.message);
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
      logger.error("[concept-du-jour] récupération sujets :", err.message);
      await markFailed(dateKey, "Erreur lors de la récupération des sujets du jour.");
      return { status: "failed", error: "Erreur lors de la récupération des sujets du jour." };
    }

    let usableTopics = (Array.isArray(topics) ? topics : [])
      .filter((t) => t && t.id != null && String(t.title || "").trim() && String(t.summary || "").trim())
      .slice(0, MAX_TOPICS_SENT);

    // Les trois autres rubriques Éclairages ont toujours priorité sur le
    // choix du sujet : le concept du jour attend leur résultat du jour
    // (getExcludedTopicIds les déclenche si besoin, cf. server.js) puis
    // exclut les sujets déjà couverts, pour ne jamais traiter deux fois la
    // même actualité le même jour. Appelé seulement s'il reste au moins un
    // sujet à filtrer : inutile d'attendre les trois autres rubriques si de
    // toute façon rien n'est exploitable aujourd'hui.
    const hadUsableTopicsBeforeExclusion = usableTopics.length > 0;
    let excludedTopicIds = new Set();
    if (hadUsableTopicsBeforeExclusion) {
      try {
        excludedTopicIds = (await getExcludedTopicIds(dateKey)) || new Set();
      } catch (err) {
        logger.error("[concept-du-jour] récupération des sujets déjà couverts :", err.message);
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
        logger.warn("[concept-du-jour] aucun sujet publié pour l'instant, génération reportée.");
        return { status: "generating" };
      }
      const reason = "Tous les sujets exploitables du jour sont déjà couverts par le parallèle historique, la pensée philosophique ou le mécanisme sociologique.";
      await markInsufficient(dateKey, reason);
      return { status: "insufficient", reason };
    }

    // Journal de dev uniquement (jamais en production) : ni la clé API, ni
    // le prompt complet, ni la réponse brute — seulement de quoi savoir ce
    // qui a été envoyé, pour du debug local.
    if (debugLogging) {
      logger.log(
        `[concept-du-jour] génération ${dateKey} — ${usableTopics.length} sujet(s) transmis, modèle ${model} :`,
        usableTopics.map((t) => `#${t.id} "${String(t.title || "").slice(0, 60)}${String(t.title || "").length > 60 ? "…" : ""}"`).join(" | ")
      );
    }

    // Avec un modèle économique, une réponse "insufficient" ou invalide est
    // parfois un aléa du tirage plutôt qu'un vrai refus. On retente donc
    // quelques fois avant d'abandonner — nettement moins cher qu'un modèle
    // plus capable pour compenser cette variance. Les pannes réseau/API
    // franches (hardError) ne sont pas retentées ici.
    let lastOutcome = null;
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      const outcome = await attemptGenerationOnce(usableTopics);
      lastOutcome = outcome;
      if (outcome.ok) {
        const enrichedData = await attachConceptImages(outcome.data, usableTopics);
        await markPublished(dateKey, enrichedData);
        return { status: "published", date: dateKey, generatedAt: new Date().toISOString(), content: enrichedData };
      }
      if (outcome.hardError) break;
    }

    if (lastOutcome && lastOutcome.hardError) {
      logger.error("[concept-du-jour] appel IA :", lastOutcome.reason);
      await markFailed(dateKey, "Erreur lors de l'appel au modèle IA.");
      return { status: "failed", error: "Erreur lors de la génération. Réessaie plus tard." };
    }
    if (lastOutcome && lastOutcome.insufficient) {
      await markInsufficient(dateKey, lastOutcome.reason);
      return { status: "insufficient", reason: lastOutcome.reason };
    }

    logger.error(`[concept-du-jour] validation refusée après ${MAX_GENERATION_ATTEMPTS} tentative(s) : ${lastOutcome && lastOutcome.reason}`);
    await markFailed(dateKey, `Validation refusée : ${lastOutcome && lastOutcome.reason}`);
    return { status: "failed", error: "Réponse invalide reçue. Réessaie plus tard." };
  }

  // Un seul essai : appel IA + parsing + validation. Ne touche pas à Supabase
  // (runGeneration décide quoi écrire une fois la boucle de tentatives finie).
  async function attemptGenerationOnce(usableTopics) {
    let raw;
    try {
      const prompt = buildConceptDuJourPrompt(usableTopics);
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

    const validation = validateConceptDuJourResponse(raw, usableTopics);
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
      logger.error("[concept-du-jour] réservation du créneau :", err.message);
      return { status: "failed", error: "Erreur de stockage. Réessaie plus tard." };
    }

    const result = claim.claimed
      ? await runGeneration(dateKey)
      : toClientResult(await repairPublishedConceptImages(claim.row));

    _todayResultCache = result.status === "generating" ? null : { dateKey, result, computedAt: Date.now() };
    return result;
  }

  // Consultation d'une date précise (menu "jours précédents" du frontend) :
  // lecture seule, ne déclenche jamais de génération.
  async function getByDate(dateKey) {
    const { data, error } = await supabase.from(TABLE).select("*").eq("date", dateKey).maybeSingle();
    if (error) {
      logger.error("[concept-du-jour] lecture d'une date archivée :", error.message);
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
      logger.error("[concept-du-jour] liste des dates publiées :", error.message);
      return [];
    }
    return (data || []).map((row) => row.date);
  }

  return { generateIfNeeded, getByDate, listPublishedDates };
}

module.exports = {
  createConceptDuJourService,
  validateConceptDuJourResponse,
  safeParseJson,
  defaultFetchConceptOriginatorImage
};
