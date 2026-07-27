"use strict";

// Logique métier de la "Pensée philosophique du jour" : sélection du sujet,
// génération IA, validation stricte, stockage Supabase, anti-concurrence.
// Jumeau de lib/parallele-historique.js (même architecture, mêmes garde-fous),
// adapté au domaine philosophique plutôt qu'historique : l'image représente
// le philosophe (portrait Wikipedia) plutôt qu'un précédent historique.
// Ne dépend jamais de server.js — toutes ses dépendances (client Supabase,
// appel OpenAI, logger, horloge, récupération des sujets du jour) lui sont
// injectées via createPenseePhilosophiqueService(deps).

const { buildPenseePhilosophiquePrompt } = require("../prompts/pensee-philosophique");

const TABLE = "pensee_philosophique";
const MAX_TOPICS_SENT = 10;
// gpt-4.1-mini, cohérent avec le parallèle historique et le mécanisme
// sociologique (meilleure qualité que gpt-4o-mini, coût toujours très
// inférieur à gpt-4o).
const DEFAULT_MODEL = "gpt-4.1-mini";
const MAX_GENERATION_ATTEMPTS = 3;
// Une seule pensée par jour, la plus pertinente parmi les sujets du jour —
// évite de multiplier les rapprochements de qualité inégale et limite le
// coût (moins de tokens de sortie par génération).
const MAX_PENSEES_PER_DAY = 1;

// Au-delà de ce délai, une ligne restée en "generating" est considérée
// comme abandonnée (crash, redémarrage du process pendant l'appel IA) et
// peut être reprise par un appel suivant.
const GENERATING_STALE_MS = 3 * 60 * 1000;
// Évite de retenter un appel IA à chaque requête si la génération échoue en
// boucle (sujets insuffisants récurrents, panne API) : un seul essai par
// fenêtre de 5 minutes.
const FAILED_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

const PUBLISHED_ALLOWED_KEYS = new Set(["status", "pensees"]);
const PENSEE_ITEM_ALLOWED_KEYS = new Set([
  "current_topic_id", "current_topic_title", "current_topic_summary",
  "philosophical_concept", "philosopher_name", "concept_origin",
  "concept_explanation", "shared_mechanism", "essential_difference",
  "conclusion", "sources"
]);
const INSUFFICIENT_ALLOWED_KEYS = new Set(["status", "reason"]);
const SOURCE_ALLOWED_KEYS = new Set(["title", "author", "publisher", "year", "url"]);

const FIELD_MAX_LENGTHS = {
  current_topic_title: 300,
  current_topic_summary: 700,
  philosophical_concept: 200,
  philosopher_name: 150,
  concept_origin: 150,
  concept_explanation: 1400,
  shared_mechanism: 1400,
  essential_difference: 1000,
  conclusion: 900
};

const HTML_TAG_PATTERN = /<\/?[a-z!][^>]*>/i;
// Termes qui ne doivent apparaître dans l'analyse philosophique que si le
// sujet d'actualité lui-même en parle déjà — même garde-fou que le parallèle
// historique, particulièrement utile ici : des concepts comme "la banalité
// du mal" sont intrinsèquement liés au nazisme dans leur origine, mais ne
// doivent pas servir à comparer un fait divers sans rapport à la Shoah.
const SENSITIVE_TERMS = ["nazi", "nazisme", "nazie", "holocauste", "genocide"];

function stripDiacritics(str) {
  return String(str || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// --- Image (portrait du philosophe) — même mécanisme que
// defaultFetchHistoricalEventImage dans lib/parallele-historique.js : API
// publique Wikipedia, aucune clé requise, jamais générée ni devinée par
// l'IA. Dupliqué plutôt que partagé (cf. lib/parallele-historique.js, même
// convention de "fichiers jumeaux" que le reste de cette fonctionnalité) —
// simplifié ici : philosopher_name/philosophical_concept sont déjà des
// chaînes courtes et précises (pas besoin d'extraire des noms propres
// depuis un paragraphe comme pour un contexte historique).
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
  // Même filtre que le parallèle historique : une image "de tête" en SVG
  // (carte, drapeau, blason) n'est jamais une vraie photo/portrait.
  if (/\.svg(\/|$)/i.test(imageUrl)) return null;
  if (!titlesShareSignificantWord(title, page.title || "")) return null;
  const pageUrl = page.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(page.title || "").replace(/ /g, "_"))}`;
  return { imageUrl, pageUrl, pageTitle: page.title || null };
}

// Cherche d'abord un portrait du philosophe/courant cité (philosopher_name),
// puis à défaut une image liée au concept lui-même (philosophical_concept).
// Best-effort : ne bloque jamais la publication, se contente de publier
// sans image en cas d'échec/absence de résultat pertinent.
async function defaultFetchPhilosopherImage(philosopherName, philosophicalConcept) {
  const cleanName = String(philosopherName || "").trim();
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

  const cleanConcept = String(philosophicalConcept || "").trim();
  if (cleanConcept) {
    try {
      const result = await queryWikipediaImage("fr", cleanConcept);
      if (result) return result;
    } catch (e) {
      // idem : pas d'échec bloquant.
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

// Valide UNE pensée (champs présents, longueurs, HTML, comparaison sensible,
// sources). knownUrls et validTopicIds sont calculés une fois pour tout le
// tableau par l'appelant.
function validateSinglePensee(raw, validTopicIds, knownUrls) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "chaque pensée doit être un objet JSON." };
  }
  const extraKeys = Object.keys(raw).filter((k) => !PENSEE_ITEM_ALLOWED_KEYS.has(k));
  if (extraKeys.length) return { ok: false, reason: `champ(s) inattendu(s) dans une pensée : ${extraKeys.join(", ")}.` };

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

  // Tolérance volontairement plus large que la consigne "80-120 mots" du
  // prompt : un rejet systématique dès que l'IA dévie légèrement serait
  // plus nuisible qu'un contenu un peu plus long/court mais valable.
  const coreWordCount = countWords(raw.concept_explanation) + countWords(raw.shared_mechanism)
    + countWords(raw.essential_difference) + countWords(raw.conclusion);
  if (coreWordCount < 30 || coreWordCount > 260) {
    return { ok: false, reason: `longueur du texte principal hors bornes raisonnables (${coreWordCount} mots).` };
  }

  const currentTopicText = stripDiacritics(`${raw.current_topic_title} ${raw.current_topic_summary}`).toLowerCase();
  const philosophyText = stripDiacritics(`${raw.philosophical_concept} ${raw.concept_explanation} ${raw.shared_mechanism} ${raw.essential_difference} ${raw.conclusion}`).toLowerCase();
  const introducesSensitiveTermItself = SENSITIVE_TERMS.some((term) => currentTopicText.includes(term));
  const usesSensitiveTermAsAnalogy = SENSITIVE_TERMS.some((term) => philosophyText.includes(term));
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
      philosophical_concept: raw.philosophical_concept.trim(),
      philosopher_name: raw.philosopher_name.trim(),
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
// autorisées, 1 à MAX_PENSEES_PER_DAY pensées (jamais 0, jamais un doublon
// de sujet), longueurs raisonnables, absence de HTML, absence de champs
// inattendus, et garde-fou éditorial (comparaison sensible injustifiée).
// Toute réponse qui ne passe pas ce filtre est traitée comme un échec de
// génération — jamais enregistrée comme contenu publié.
function validatePenseePhilosophiqueResponse(raw, topics) {
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

  if (!Array.isArray(raw.pensees) || raw.pensees.length < 1 || raw.pensees.length > MAX_PENSEES_PER_DAY) {
    return { ok: false, reason: `pensees doit être un tableau de ${MAX_PENSEES_PER_DAY} élément(s).` };
  }

  const validTopicIds = new Set((topics || []).map((t) => String(t.id)));
  // URL "connues" = celles réellement fournies au modèle pour les sujets du
  // jour — la seule liste qu'une url de sortie a le droit de recopier.
  const knownUrls = new Set(
    (topics || []).flatMap((t) => (Array.isArray(t.sources) ? t.sources : []).map((s) => s && s.url).filter(Boolean))
  );

  const validatedPensees = [];
  const usedTopicIds = new Set();
  for (const item of raw.pensees) {
    const result = validateSinglePensee(item, validTopicIds, knownUrls);
    if (!result.ok) return result;
    if (usedTopicIds.has(result.data.current_topic_id)) {
      return { ok: false, reason: `plusieurs pensées portent sur le même sujet (${result.data.current_topic_id}).` };
    }
    usedTopicIds.add(result.data.current_topic_id);
    validatedPensees.push(result.data);
  }

  return { ok: true, data: { status: "published", pensees: validatedPensees } };
}

function createPenseePhilosophiqueService(deps) {
  const {
    supabase,
    callOpenAI,
    logger = console,
    getCurrentDate = () => new Date(),
    getPublishedTopicsForDate,
    dateKeyFor,
    model = DEFAULT_MODEL,
    debugLogging = false,
    // Évite que les deux rubriques traitent le même sujet le même jour (cas
    // réel observé : "Crépol" choisi à la fois par le parallèle historique
    // et la pensée philosophique). Optionnel : sans cette dépendance,
    // aucune exclusion n'est appliquée (comportement d'avant, ex. en test).
    getExcludedTopicIds = async () => new Set(),
    // Portrait du philosophe (défaut = vraie implémentation Wikipedia,
    // aucune config projet nécessaire, cf. lib/parallele-historique.js).
    fetchPhilosopherImage = defaultFetchPhilosopherImage,
    // Repli "presse" (image de l'article du sujet actuel) : pas de valeur
    // par défaut, dépend de l'infrastructure de server.js — no-op si non
    // fourni (ex. en test).
    fetchPressPreviewImage = async () => null
  } = deps || {};

  if (!supabase) throw new Error("createPenseePhilosophiqueService: 'supabase' manquant.");
  if (typeof callOpenAI !== "function") throw new Error("createPenseePhilosophiqueService: 'callOpenAI' manquant.");
  if (typeof getPublishedTopicsForDate !== "function") {
    throw new Error("createPenseePhilosophiqueService: 'getPublishedTopicsForDate' manquant.");
  }
  if (typeof dateKeyFor !== "function") throw new Error("createPenseePhilosophiqueService: 'dateKeyFor' manquant.");

  function toClientResult(row) {
    if (!row) return { status: "insufficient", reason: "Aucun contenu disponible pour le moment." };
    switch (row.status) {
      case "published":
        return { status: "published", date: row.date, generatedAt: row.generated_at, content: row.content };
      case "insufficient":
        return {
          status: "insufficient",
          reason: (row.content && row.content.reason) || row.error_message || "Aucune pensée philosophique sérieuse n'a pu être établie aujourd'hui."
        };
      case "generating":
        return { status: "generating" };
      case "failed":
      default:
        return { status: "failed", error: "La génération de la pensée philosophique a échoué. Réessaie plus tard." };
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
          reason: (row.content && row.content.reason) || row.error_message || "Aucune pensée philosophique sérieuse n'a pu être établie ce jour-là."
        };
      case "generating":
        return { status: "generating", date: row.date };
      case "failed":
      default:
        return { status: "failed", date: row.date, error: "La génération de la pensée philosophique a échoué ce jour-là." };
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
    if (error) logger.error("[pensee-philosophique] écriture échec :", error.message);
  }

  async function markInsufficient(dateKey, reason) {
    const { error } = await supabase
      .from(TABLE)
      .update({ status: "insufficient", content: { reason }, error_message: null, updated_at: new Date().toISOString() })
      .eq("date", dateKey);
    if (error) logger.error("[pensee-philosophique] écriture insuffisant :", error.message);
  }

  async function markPublished(dateKey, data) {
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from(TABLE)
      .update({
        status: "published",
        // La colonne reste un seul texte (pas de migration de schéma) : liste
        // jointe des sujets couverts par les 1 à 3 pensées publiées — la
        // vraie source de vérité reste content.pensees[].current_topic_id.
        current_topic_id: data.pensees.map((p) => p.current_topic_id).join(","),
        content: data,
        error_message: null,
        generated_at: nowIso,
        updated_at: nowIso
      })
      .eq("date", dateKey);
    if (error) logger.error("[pensee-philosophique] écriture publication :", error.message);
  }

  // Ajoute une image à UNE pensée déjà validée, TOUJOURS avec un crédit de
  // source (jamais d'image sans indiquer d'où elle vient) : d'abord un
  // portrait du philosophe/courant cité (Wikipedia), et si rien de pertinent
  // n'est trouvé, repli sur l'image déjà publiée avec l'arène du sujet
  // d'actualité (illustration de l'actu, pas du philosophe — mais réelle et
  // déjà vérifiée par le site). Ne fait jamais échouer la publication : sans
  // aucune des deux, publié sans image.
  async function attachConceptImageToOne(pensee, matchingTopic) {
    try {
      const image = await fetchPhilosopherImage(pensee.philosopher_name, pensee.philosophical_concept);
      if (image && image.imageUrl) {
        return {
          ...pensee,
          philosophical_concept_image_url: image.imageUrl,
          philosophical_concept_image_page_url: image.pageUrl || null,
          philosophical_concept_image_source: "wikipedia",
          philosophical_concept_image_credit: "Wikipedia"
        };
      }
    } catch (err) {
      logger.error("[pensee-philosophique] recherche image Wikipedia :", err.message);
    }

    const primarySource = matchingTopic && Array.isArray(matchingTopic.sources) ? matchingTopic.sources[0] : null;
    const sourceUrl = primarySource ? primarySource.url : null;

    const knownPressImageUrl = matchingTopic && matchingTopic.currentTopicImageUrl;
    if (knownPressImageUrl) {
      return {
        ...pensee,
        philosophical_concept_image_url: knownPressImageUrl,
        philosophical_concept_image_page_url: sourceUrl || null,
        philosophical_concept_image_source: "press",
        philosophical_concept_image_credit: (primarySource && primarySource.name) || domainFromUrl(sourceUrl) || "source de l'actualité"
      };
    }

    if (sourceUrl) {
      try {
        const preview = await fetchPressPreviewImage(sourceUrl);
        if (preview && preview.imageUrl) {
          return {
            ...pensee,
            philosophical_concept_image_url: preview.imageUrl,
            philosophical_concept_image_page_url: sourceUrl,
            philosophical_concept_image_source: "press",
            philosophical_concept_image_credit: preview.siteName || (primarySource && primarySource.name) || domainFromUrl(sourceUrl) || "source de l'actualité"
          };
        }
      } catch (err) {
        logger.error("[pensee-philosophique] aperçu image de presse :", err.message);
      }
    }

    return {
      ...pensee,
      philosophical_concept_image_url: null,
      philosophical_concept_image_page_url: null,
      philosophical_concept_image_source: null,
      philosophical_concept_image_credit: null
    };
  }

  // Enrichit chaque pensée du tableau — en série plutôt qu'en parallèle JS
  // pour rester sous le radar des limites de débit de l'API Wikipedia
  // publique malgré le petit nombre d'appels.
  async function attachConceptImages(data, usableTopics) {
    const topicsById = new Map((usableTopics || []).map((t) => [String(t.id), t]));
    const enrichedPensees = [];
    for (const pensee of data.pensees) {
      const matchingTopic = topicsById.get(pensee.current_topic_id);
      enrichedPensees.push(await attachConceptImageToOne(pensee, matchingTopic));
    }
    return { ...data, pensees: enrichedPensees };
  }

  async function runGeneration(dateKey) {
    let topics;
    try {
      topics = await getPublishedTopicsForDate(dateKey);
    } catch (err) {
      logger.error("[pensee-philosophique] récupération sujets :", err.message);
      await markFailed(dateKey, "Erreur lors de la récupération des sujets du jour.");
      return { status: "failed", error: "Erreur lors de la récupération des sujets du jour." };
    }

    let usableTopics = (Array.isArray(topics) ? topics : [])
      .filter((t) => t && t.id != null && String(t.title || "").trim() && String(t.summary || "").trim())
      .slice(0, MAX_TOPICS_SENT);

    // Le parallèle historique a toujours priorité sur le choix du sujet : la
    // pensée philosophique attend son résultat du jour (getExcludedTopicIds
    // le déclenche si besoin, cf. server.js) puis exclut les sujets déjà
    // couverts, pour ne jamais traiter deux fois la même actualité le même
    // jour (cas réel observé : "Crépol" choisi par les deux à la fois).
    // Appelé seulement s'il reste au moins un sujet à filtrer : inutile
    // d'attendre le parallèle historique si de toute façon rien n'est
    // exploitable aujourd'hui.
    const hadUsableTopicsBeforeExclusion = usableTopics.length > 0;
    let excludedTopicIds = new Set();
    if (hadUsableTopicsBeforeExclusion) {
      try {
        excludedTopicIds = (await getExcludedTopicIds(dateKey)) || new Set();
      } catch (err) {
        logger.error("[pensee-philosophique] récupération des sujets déjà couverts :", err.message);
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
        logger.warn("[pensee-philosophique] aucun sujet publié pour l'instant, génération reportée.");
        return { status: "generating" };
      }
      const reason = "Tous les sujets exploitables du jour sont déjà couverts par le parallèle historique.";
      await markInsufficient(dateKey, reason);
      return { status: "insufficient", reason };
    }

    // Journal de dev uniquement (jamais en production) : ni la clé API, ni
    // le prompt complet, ni la réponse brute — seulement de quoi savoir ce
    // qui a été envoyé, pour du debug local.
    if (debugLogging) {
      logger.log(
        `[pensee-philosophique] génération ${dateKey} — ${usableTopics.length} sujet(s) transmis, modèle ${model} :`,
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
      logger.error("[pensee-philosophique] appel IA :", lastOutcome.reason);
      await markFailed(dateKey, "Erreur lors de l'appel au modèle IA.");
      return { status: "failed", error: "Erreur lors de la génération. Réessaie plus tard." };
    }
    if (lastOutcome && lastOutcome.insufficient) {
      await markInsufficient(dateKey, lastOutcome.reason);
      return { status: "insufficient", reason: lastOutcome.reason };
    }

    logger.error(`[pensee-philosophique] validation refusée après ${MAX_GENERATION_ATTEMPTS} tentative(s) : ${lastOutcome && lastOutcome.reason}`);
    await markFailed(dateKey, `Validation refusée : ${lastOutcome && lastOutcome.reason}`);
    return { status: "failed", error: "Réponse invalide reçue. Réessaie plus tard." };
  }

  // Un seul essai : appel IA + parsing + validation. Ne touche pas à Supabase
  // (runGeneration décide quoi écrire une fois la boucle de tentatives finie).
  async function attemptGenerationOnce(usableTopics) {
    let raw;
    try {
      const prompt = buildPenseePhilosophiquePrompt(usableTopics);
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

    const validation = validatePenseePhilosophiqueResponse(raw, usableTopics);
    if (!validation.ok) return { ok: false, hardError: false, reason: validation.reason };

    if (validation.data.status === "insufficient") {
      return { ok: false, hardError: false, insufficient: true, reason: validation.data.reason };
    }
    return { ok: true, data: validation.data };
  }

  // Point d'entrée unique, appelé aussi bien par la route API que par le
  // scheduler : relit d'abord le contenu du jour (aucun appel IA si déjà
  // publié/insuffisant/en cours) et ne déclenche une génération que si
  // personne n'a encore réservé le créneau du jour.
  async function generateIfNeeded(date, options = {}) {
    const force = options && options.force === true;
    const dateKey = dateKeyFor(date || getCurrentDate());
    const nowIso = new Date().toISOString();

    let claim;
    try {
      claim = await claimGenerationSlot(dateKey, nowIso, { force });
    } catch (err) {
      logger.error("[pensee-philosophique] réservation du créneau :", err.message);
      return { status: "failed", error: "Erreur de stockage. Réessaie plus tard." };
    }

    if (!claim.claimed) return toClientResult(claim.row);

    return runGeneration(dateKey);
  }

  // Consultation d'une date précise (menu "jours précédents" du frontend) :
  // lecture seule, ne déclenche jamais de génération.
  async function getByDate(dateKey) {
    const { data, error } = await supabase.from(TABLE).select("*").eq("date", dateKey).maybeSingle();
    if (error) {
      logger.error("[pensee-philosophique] lecture d'une date archivée :", error.message);
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
      logger.error("[pensee-philosophique] liste des dates publiées :", error.message);
      return [];
    }
    return (data || []).map((row) => row.date);
  }

  return { generateIfNeeded, getByDate, listPublishedDates };
}

module.exports = {
  createPenseePhilosophiqueService,
  validatePenseePhilosophiqueResponse,
  safeParseJson,
  defaultFetchPhilosopherImage
};
