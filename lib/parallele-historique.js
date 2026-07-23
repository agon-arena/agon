"use strict";

// Logique métier du "Parallèle historique du jour" : sélection du sujet,
// génération IA, validation stricte, stockage Supabase, anti-concurrence.
// Ne dépend jamais de server.js — toutes ses dépendances (client Supabase,
// appel OpenAI, logger, horloge, récupération des sujets du jour) lui sont
// injectées via createParalleleHistoriqueService(deps), pour rester
// testable isolément et éviter toute dépendance circulaire.

const { buildParalleleHistoriquePrompt } = require("../prompts/parallele-historique");

const TABLE = "parallele_historique";
const MAX_TOPICS_SENT = 10;
// gpt-4o-mini reste le modèle par défaut (cohérent avec le reste du projet,
// et nettement moins cher) : le champ "sources" du schéma le rendait trop
// prudent (refus même sur des sujets ayant un vrai précédent documenté) —
// corrigé dans le prompt (cf. prompts/parallele-historique.js) plutôt qu'en
// changeant de modèle. MAX_GENERATION_ATTEMPTS compense la variance restante.
const DEFAULT_MODEL = "gpt-4o-mini";
// Avec un modèle économique, un même sujet peut basculer entre "insufficient"
// et "published" d'un tirage à l'autre (observé en test réel) : quelques
// tentatives supplémentaires, toujours au tarif du modèle économique, restent
// bien moins chères qu'un modèle plus capable pour une seule génération/jour.
const MAX_GENERATION_ATTEMPTS = 3;

// Au-delà de ce délai, une ligne restée en "generating" est considérée
// comme abandonnée (crash, redémarrage du process pendant l'appel IA) et
// peut être reprise par un appel suivant.
const GENERATING_STALE_MS = 3 * 60 * 1000;
// Évite de retenter un appel IA à chaque requête si la génération échoue en
// boucle (sujets insuffisants récurrents, panne API) : un seul essai par
// fenêtre de 5 minutes.
const FAILED_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

const WIKIPEDIA_IMAGE_FETCH_TIMEOUT_MS = 8000;
// Seul domaine depuis lequel une image "historique" peut légitimement venir :
// jamais une URL générée par l'IA (même principe que pour les sources texte),
// toujours une vraie image relue depuis l'API publique Wikipedia.
const WIKIMEDIA_IMAGE_HOST_PREFIX = "https://upload.wikimedia.org/";

// La recherche plein-texte Wikipedia peut renvoyer un premier résultat sans
// rapport quand le titre interrogé est une phrase descriptive plutôt qu'un
// nom propre (observé en conditions réelles : une phrase sur des violences
// politiques en Italie a fait remonter la page d'un médecin congolais sans
// lien). On n'accepte donc l'image que si le titre de la page Wikipedia
// trouvée partage au moins un mot significatif avec le titre recherché —
// sinon mieux vaut aucune image qu'une image trompeuse.
const WIKIPEDIA_MATCH_STOPWORDS = new Set([
  "dans", "les", "des", "une", "avec", "pour", "contre", "leurs", "cette",
  "sont", "plus", "entre", "ainsi", "comme", "depuis", "their", "with",
  "from", "were", "have", "this", "that", "been", "during", "under"
]);
function significantWordsForMatch(str) {
  return stripDiacritics(str).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .map((w) => w.replace(/s$/, ""))
    .filter((w) => w.length >= 5 && !WIKIPEDIA_MATCH_STOPWORDS.has(w));
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
  if (!titlesShareSignificantWord(title, page.title || "")) return null;
  const pageUrl = page.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(page.title || "").replace(/ /g, "_"))}`;
  return { imageUrl, pageUrl, pageTitle: page.title || null };
}

// Quand historical_event_title est une phrase descriptive ("Les menaces
// contre des personnalités publiques en Italie dans les années 1980") plutôt
// qu'un nom propre, la recherche Wikipedia ne matche souvent rien — alors
// qu'un nom propre cité dans le contexte (ex. "Camorra") aurait une vraie
// page. On extrait donc les mots capitalisés hors début de phrase comme
// candidats de repli. Toujours filtré par titlesShareSignificantWord, donc
// pas de risque supplémentaire d'image hors-sujet — juste plus de chances
// d'en trouver une légitime.
const MAX_FALLBACK_IMAGE_CANDIDATES = 2;

function extractCapitalizedCandidates(text) {
  const sentences = String(text || "").split(/(?<=[.!?])\s+/);
  const candidates = [];
  const seen = new Set();
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/);
    words.forEach((word, index) => {
      if (index === 0) return; // capitalisé seulement parce qu'en début de phrase, pas un nom propre
      const cleaned = word.replace(/^[«"'(]+/, "").replace(/[»",.;:!?')]+$/, "");
      if (cleaned.length < 4 || !/^[A-ZÀ-Ý]/.test(cleaned)) return;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(cleaned);
    });
  }
  return candidates.slice(0, MAX_FALLBACK_IMAGE_CANDIDATES);
}

// Cherche une image réelle du précédent historique via l'API publique et
// gratuite de Wikipedia (aucune clé requise) — jamais générée ni devinée par
// l'IA. Essaie le titre du précédent (fr puis en), puis, si rien trouvé, les
// noms propres repérés dans le contexte historique. Best-effort : une panne
// réseau ou l'absence de résultat ne bloque jamais la publication du
// parallèle, elle se contente de le publier sans image.
async function defaultFetchHistoricalEventImage(title, contextText) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return null;

  for (const lang of ["fr", "en"]) {
    try {
      const result = await queryWikipediaImage(lang, cleanTitle);
      if (result) return result;
    } catch (e) {
      // réseau/timeout sur cette langue : on tente la suivante sans jamais échouer bloquant.
    }
  }

  for (const candidate of extractCapitalizedCandidates(contextText)) {
    try {
      const result = await queryWikipediaImage("fr", candidate);
      if (result) return result;
    } catch (e) {
      // idem : on passe au candidat suivant sans jamais échouer bloquant.
    }
  }

  return null;
}

const PUBLISHED_ALLOWED_KEYS = new Set([
  "status", "current_topic_id", "current_topic_title", "current_topic_summary",
  "historical_event_title", "historical_event_date", "historical_context",
  "shared_mechanism", "essential_difference", "conclusion", "sources"
]);
const INSUFFICIENT_ALLOWED_KEYS = new Set(["status", "reason"]);
const SOURCE_ALLOWED_KEYS = new Set(["title", "author", "publisher", "year", "url"]);

const FIELD_MAX_LENGTHS = {
  current_topic_title: 300,
  current_topic_summary: 700,
  historical_event_title: 300,
  historical_event_date: 120,
  historical_context: 1600,
  shared_mechanism: 1600,
  essential_difference: 1200,
  conclusion: 900
};

const HTML_TAG_PATTERN = /<\/?[a-z!][^>]*>/i;
// Termes qui ne doivent apparaître dans l'analyse historique que si le sujet
// d'actualité lui-même en parle déjà — sinon l'IA les a introduits comme
// simple figure de style, ce que les règles éditoriales interdisent.
const SENSITIVE_TERMS = ["nazi", "nazisme", "nazie", "holocauste", "genocide"];

function stripDiacritics(str) {
  return String(str || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function containsBannedHistoryPhrase(str) {
  const normalized = stripDiacritics(str).toLowerCase();
  return normalized.includes("histoire se repete");
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
// fournies dans le prompt (les vraies sources des sujets envoyés). On ne
// rejette pas la génération pour autant — on sanitize : une url non reconnue
// est simplement omise (mise à null), conformément à "une référence
// incertaine doit être omise plutôt qu'inventée".
// Certains modèles renvoient le texte littéral "null" (une vraie chaîne, pas
// un JSON null) pour un champ optionnel vide — observé en conditions réelles
// sur author/publisher/year. On le neutralise avant toute validation/affichage
// pour ne jamais montrer "null" comme texte dans l'interface.
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

// Validation stricte de la réponse IA : présence des champs, valeurs
// autorisées, correspondance du sujet choisi, longueurs raisonnables,
// absence de HTML, absence de champs inattendus, et garde-fous éditoriaux
// (formule interdite, comparaisons sensibles injustifiées). Toute réponse
// qui ne passe pas ce filtre est traitée comme un échec de génération —
// jamais enregistrée comme contenu publié.
function validateParalleleHistoriqueResponse(raw, topics) {
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

  const validTopicIds = new Set((topics || []).map((t) => String(t.id)));
  if (typeof raw.current_topic_id !== "string" || !validTopicIds.has(raw.current_topic_id.trim())) {
    return { ok: false, reason: "current_topic_id ne correspond à aucun sujet fourni." };
  }

  for (const [field, maxLength] of Object.entries(FIELD_MAX_LENGTHS)) {
    if (!isNonEmptyString(raw[field], maxLength)) return { ok: false, reason: `${field} manquant, vide ou trop long.` };
    if (containsHtml(raw[field])) return { ok: false, reason: `${field} contient du HTML.` };
  }

  const narrativeFields = ["current_topic_summary", "historical_context", "shared_mechanism", "essential_difference", "conclusion"];
  for (const field of narrativeFields) {
    if (containsBannedHistoryPhrase(raw[field])) {
      return { ok: false, reason: `formule interdite ("l'Histoire se répète") détectée dans ${field}.` };
    }
  }

  // Tolérance volontairement plus large que la consigne "80-120 mots" du
  // prompt : un rejet systématique dès que l'IA dévie légèrement serait
  // plus nuisible qu'un contenu un peu plus long/court mais valable. On
  // filtre seulement les dérives franches (quasi vide, ou pavé démesuré).
  const coreWordCount = countWords(raw.historical_context) + countWords(raw.shared_mechanism)
    + countWords(raw.essential_difference) + countWords(raw.conclusion);
  if (coreWordCount < 30 || coreWordCount > 260) {
    return { ok: false, reason: `longueur du texte principal hors bornes raisonnables (${coreWordCount} mots).` };
  }

  const currentTopicText = stripDiacritics(`${raw.current_topic_title} ${raw.current_topic_summary}`).toLowerCase();
  const historicalText = stripDiacritics(`${raw.historical_event_title} ${raw.shared_mechanism} ${raw.essential_difference} ${raw.conclusion}`).toLowerCase();
  const introducesSensitiveTermItself = SENSITIVE_TERMS.some((term) => currentTopicText.includes(term));
  const usesSensitiveTermAsAnalogy = SENSITIVE_TERMS.some((term) => historicalText.includes(term));
  if (usesSensitiveTermAsAnalogy && !introducesSensitiveTermItself) {
    return {
      ok: false,
      reason: "comparaison sensible (nazisme/génocide) refusée automatiquement : le sujet d'actualité ne porte pas lui-même sur ce thème."
    };
  }

  // URL "connues" = celles réellement fournies au modèle pour les sujets du
  // jour (extractParalleleHistoriqueSources, cf. server.js) — la seule liste
  // qu'une url de sortie a le droit de recopier.
  const knownUrls = new Set(
    (topics || []).flatMap((t) => (Array.isArray(t.sources) ? t.sources : []).map((s) => s && s.url).filter(Boolean))
  );
  const sourcesValidation = validateSources(raw.sources, knownUrls);
  if (!sourcesValidation.ok) return sourcesValidation;

  return {
    ok: true,
    data: {
      status: "published",
      current_topic_id: raw.current_topic_id.trim(),
      current_topic_title: raw.current_topic_title.trim(),
      current_topic_summary: raw.current_topic_summary.trim(),
      historical_event_title: raw.historical_event_title.trim(),
      historical_event_date: raw.historical_event_date.trim(),
      historical_context: raw.historical_context.trim(),
      shared_mechanism: raw.shared_mechanism.trim(),
      essential_difference: raw.essential_difference.trim(),
      conclusion: raw.conclusion.trim(),
      sources: sourcesValidation.sources
    }
  };
}

function createParalleleHistoriqueService(deps) {
  const {
    supabase,
    callOpenAI,
    logger = console,
    getCurrentDate = () => new Date(),
    getPublishedTopicsForDate,
    dateKeyFor,
    model = DEFAULT_MODEL,
    debugLogging = false,
    // Valeur par défaut = vraie implémentation Wikipedia : server.js n'a rien
    // à injecter (pas de clé, pas de config projet nécessaire), mais les
    // tests peuvent la remplacer par un mock pour rester hors-réseau.
    fetchHistoricalEventImage = defaultFetchHistoricalEventImage
  } = deps || {};

  if (!supabase) throw new Error("createParalleleHistoriqueService: 'supabase' manquant.");
  if (typeof callOpenAI !== "function") throw new Error("createParalleleHistoriqueService: 'callOpenAI' manquant.");
  if (typeof getPublishedTopicsForDate !== "function") {
    throw new Error("createParalleleHistoriqueService: 'getPublishedTopicsForDate' manquant.");
  }
  if (typeof dateKeyFor !== "function") throw new Error("createParalleleHistoriqueService: 'dateKeyFor' manquant.");

  function toClientResult(row) {
    if (!row) return { status: "insufficient", reason: "Aucun contenu disponible pour le moment." };
    switch (row.status) {
      case "published":
        return { status: "published", date: row.date, generatedAt: row.generated_at, content: row.content };
      case "insufficient":
        return {
          status: "insufficient",
          reason: (row.content && row.content.reason) || row.error_message || "Aucun parallèle sérieux n'a pu être établi aujourd'hui."
        };
      case "generating":
        return { status: "generating" };
      case "failed":
      default:
        return { status: "failed", error: "La génération du parallèle historique a échoué. Réessaie plus tard." };
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
    if (error) logger.error("[parallele-historique] écriture échec :", error.message);
  }

  async function markInsufficient(dateKey, reason) {
    const { error } = await supabase
      .from(TABLE)
      .update({ status: "insufficient", content: { reason }, error_message: null, updated_at: new Date().toISOString() })
      .eq("date", dateKey);
    if (error) logger.error("[parallele-historique] écriture insuffisant :", error.message);
  }

  async function markPublished(dateKey, data) {
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from(TABLE)
      .update({
        status: "published",
        current_topic_id: data.current_topic_id,
        content: data,
        error_message: null,
        generated_at: nowIso,
        updated_at: nowIso
      })
      .eq("date", dateKey);
    if (error) logger.error("[parallele-historique] écriture publication :", error.message);
  }

  async function runGeneration(dateKey) {
    let topics;
    try {
      topics = await getPublishedTopicsForDate(dateKey);
    } catch (err) {
      logger.error("[parallele-historique] récupération sujets :", err.message);
      await markFailed(dateKey, "Erreur lors de la récupération des sujets du jour.");
      return { status: "failed", error: "Erreur lors de la récupération des sujets du jour." };
    }

    const usableTopics = (Array.isArray(topics) ? topics : [])
      .filter((t) => t && t.id != null && String(t.title || "").trim() && String(t.summary || "").trim())
      .slice(0, MAX_TOPICS_SENT);

    if (!usableTopics.length) {
      const reason = "Aucun sujet exploitable publié aujourd'hui.";
      await markInsufficient(dateKey, reason);
      return { status: "insufficient", reason };
    }

    // Journal de dev uniquement (jamais en production) : ni la clé API, ni
    // le prompt complet, ni la réponse brute — seulement de quoi savoir ce
    // qui a été envoyé, pour du debug local.
    if (debugLogging) {
      logger.log(
        `[parallele-historique] génération ${dateKey} — ${usableTopics.length} sujet(s) transmis, modèle ${model} :`,
        usableTopics.map((t) => `#${t.id} "${String(t.title || "").slice(0, 60)}${String(t.title || "").length > 60 ? "…" : ""}"`).join(" | ")
      );
    }

    // Avec un modèle économique, une réponse "insufficient" ou invalide est
    // parfois un aléa du tirage plutôt qu'un vrai refus (observé : le même
    // sujet, même prompt, passe de "insufficient" à "published" d'un essai à
    // l'autre). On retente donc quelques fois avant d'abandonner — nettement
    // moins cher qu'un modèle plus capable pour compenser cette variance.
    // Les pannes réseau/API franches (hardError) ne sont pas retentées ici.
    let lastOutcome = null;
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      const outcome = await attemptGenerationOnce(usableTopics);
      lastOutcome = outcome;
      if (outcome.ok) {
        const enrichedData = await attachHistoricalEventImage(outcome.data);
        await markPublished(dateKey, enrichedData);
        return { status: "published", date: dateKey, generatedAt: new Date().toISOString(), content: enrichedData };
      }
      if (outcome.hardError) break;
    }

    if (lastOutcome && lastOutcome.hardError) {
      logger.error("[parallele-historique] appel IA :", lastOutcome.reason);
      await markFailed(dateKey, "Erreur lors de l'appel au modèle IA.");
      return { status: "failed", error: "Erreur lors de la génération. Réessaie plus tard." };
    }
    if (lastOutcome && lastOutcome.insufficient) {
      await markInsufficient(dateKey, lastOutcome.reason);
      return { status: "insufficient", reason: lastOutcome.reason };
    }

    logger.error(`[parallele-historique] validation refusée après ${MAX_GENERATION_ATTEMPTS} tentative(s) : ${lastOutcome && lastOutcome.reason}`);
    await markFailed(dateKey, `Validation refusée : ${lastOutcome && lastOutcome.reason}`);
    return { status: "failed", error: "Réponse invalide reçue. Réessaie plus tard." };
  }

  // Un seul essai : appel IA + parsing + validation. Ne touche pas à Supabase
  // (runGeneration décide quoi écrire une fois la boucle de tentatives finie).
  async function attemptGenerationOnce(usableTopics) {
    let raw;
    try {
      const prompt = buildParalleleHistoriquePrompt(usableTopics);
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

    const validation = validateParalleleHistoriqueResponse(raw, usableTopics);
    if (!validation.ok) return { ok: false, hardError: false, reason: validation.reason };

    if (validation.data.status === "insufficient") {
      return { ok: false, hardError: false, insufficient: true, reason: validation.data.reason };
    }
    return { ok: true, data: validation.data };
  }

  // Ajoute une image réelle du précédent historique (Wikipedia) au contenu
  // déjà validé. Ne fait jamais échouer la publication : en cas d'erreur ou
  // d'absence de résultat, le parallèle est publié sans image.
  async function attachHistoricalEventImage(data) {
    try {
      const image = await fetchHistoricalEventImage(data.historical_event_title, data.historical_context);
      if (image && image.imageUrl) {
        return { ...data, historical_event_image_url: image.imageUrl, historical_event_image_page_url: image.pageUrl || null };
      }
    } catch (err) {
      logger.error("[parallele-historique] recherche image Wikipedia :", err.message);
    }
    return { ...data, historical_event_image_url: null, historical_event_image_page_url: null };
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
      logger.error("[parallele-historique] réservation du créneau :", err.message);
      return { status: "failed", error: "Erreur de stockage. Réessaie plus tard." };
    }

    if (!claim.claimed) return toClientResult(claim.row);

    return runGeneration(dateKey);
  }

  return { generateIfNeeded };
}

module.exports = {
  createParalleleHistoriqueService,
  validateParalleleHistoriqueResponse,
  safeParseJson,
  defaultFetchHistoricalEventImage
};
