"use strict";

// Logique métier du "Mot latin du jour" : sélection du sujet, génération IA,
// validation stricte, stockage Supabase, anti-concurrence. Jumelle des
// autres rubriques Éclairages (même architecture, choisit parmi les sujets
// publiés aujourd'hui sur Mnoria), mais sans les 4 sections complètes des
// rubriques "rapprochement" (concept/mécanisme/pensée/parallèle) : juste
// l'expression, sa traduction, son explication, et un petit paragraphe de
// lien avec l'actualité — présentation volontairement simple, comme
// citation-du-jour. Contrairement à citation-du-jour, aucune personne réelle
// n'est citée ici : pas de recherche d'image, pas de contrainte
// d'attribution à un auteur. Ne dépend jamais de server.js — toutes ses
// dépendances (client Supabase, appel OpenAI, logger, horloge, récupération
// des sujets du jour) lui sont injectées via createLatinDuJourService(deps).

const { buildLatinDuJourPrompt, PHRASE_ORIGIN_VALUES } = require("../prompts/latin-du-jour");
const { fetchRecentEclairagesIdentities, RECENT_REPEAT_AVOIDANCE_DAYS } = require("./eclairages-recent-usage");

const TABLE = "latin_du_jour";
const MAX_TOPICS_SENT = 10;
// gpt-4.1-mini, cohérent avec les autres rubriques Éclairages (meilleure
// qualité que gpt-4o-mini, coût toujours très inférieur à gpt-4o).
const DEFAULT_MODEL = "gpt-4.1-mini";
const MAX_GENERATION_ATTEMPTS = 3;
// Une seule expression par jour, la plus pertinente parmi les sujets du jour.
const MAX_LATIN_PER_DAY = 1;

// Au-delà de ce délai, une ligne restée en "generating" est considérée
// comme abandonnée (crash, redémarrage du process pendant l'appel IA) et
// peut être reprise par un appel suivant.
const GENERATING_STALE_MS = 3 * 60 * 1000;
// Évite de retenter un appel IA à chaque requête si la génération échoue en
// boucle : un seul essai par fenêtre de 5 minutes.
const FAILED_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

const PUBLISHED_ALLOWED_KEYS = new Set(["status", "latins"]);
const LATIN_ITEM_ALLOWED_KEYS = new Set([
  "current_topic_id", "latin_phrase", "phrase_origin", "literal_translation", "explanation", "news_connection", "grammar_breakdown", "sources"
]);
const PHRASE_ORIGIN_SET = new Set(PHRASE_ORIGIN_VALUES);
const INSUFFICIENT_ALLOWED_KEYS = new Set(["status", "reason"]);
const SOURCE_ALLOWED_KEYS = new Set(["title", "author", "publisher", "year", "url"]);
const GRAMMAR_ITEM_ALLOWED_KEYS = new Set(["word", "note"]);

const FIELD_MAX_LENGTHS = {
  latin_phrase: 150,
  literal_translation: 300,
  explanation: 700,
  // Volontairement court : un "petit paragraphe" (2-3 phrases), pas une
  // section d'analyse comme dans les autres rubriques.
  news_connection: 400
};

// Volet pédagogique (cf. prompts/latin-du-jour.js) : au moins un mot décomposé
// (même une expression d'un seul mot doit être analysée), 12 au maximum pour
// rester lisible même sur une expression un peu longue.
const GRAMMAR_BREAKDOWN_MIN_ITEMS = 1;
const GRAMMAR_BREAKDOWN_MAX_ITEMS = 12;
const GRAMMAR_WORD_MAX_LENGTH = 60;
const GRAMMAR_NOTE_MAX_LENGTH = 400;

const HTML_TAG_PATTERN = /<\/?[a-z!][^>]*>/i;

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
// expression latine : toute URL produite pour une source est par nature une
// invention, systématiquement mise à null plutôt que rejetée (une référence
// sans lien reste acceptable, cf. règle URL du prompt).
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

// Volet pédagogique : décomposition mot par mot de l'expression (cf.
// prompts/latin-du-jour.js). Chaque entrée doit avoir un mot et une note
// grammaticale non vides — c'est le cœur de la rubrique ("apprendre le
// latin"), donc pas de tolérance particulière ici (contrairement à
// author_presentation/explanation dont les bornes de longueur sont larges).
function validateGrammarBreakdown(breakdown) {
  if (!Array.isArray(breakdown) || breakdown.length < GRAMMAR_BREAKDOWN_MIN_ITEMS || breakdown.length > GRAMMAR_BREAKDOWN_MAX_ITEMS) {
    return { ok: false, reason: `grammar_breakdown doit être un tableau de ${GRAMMAR_BREAKDOWN_MIN_ITEMS} à ${GRAMMAR_BREAKDOWN_MAX_ITEMS} élément(s).` };
  }
  const sanitized = [];
  for (const rawItem of breakdown) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      return { ok: false, reason: "chaque élément de grammar_breakdown doit être un objet." };
    }
    const extraKeys = Object.keys(rawItem).filter((k) => !GRAMMAR_ITEM_ALLOWED_KEYS.has(k));
    if (extraKeys.length) return { ok: false, reason: `champ(s) inattendu(s) dans grammar_breakdown : ${extraKeys.join(", ")}.` };

    if (!isNonEmptyString(rawItem.word, GRAMMAR_WORD_MAX_LENGTH) || containsHtml(rawItem.word)) {
      return { ok: false, reason: "grammar_breakdown : champ word manquant, vide, trop long ou contenant du HTML." };
    }
    if (!isNonEmptyString(rawItem.note, GRAMMAR_NOTE_MAX_LENGTH) || containsHtml(rawItem.note)) {
      return { ok: false, reason: "grammar_breakdown : champ note manquant, vide, trop long ou contenant du HTML." };
    }

    sanitized.push({ word: rawItem.word.trim(), note: rawItem.note.trim() });
  }
  return { ok: true, breakdown: sanitized };
}

// Valide UNE expression (champs présents, longueurs, HTML, sujet choisi,
// sources). validTopicIds est calculé une fois pour tout le tableau par
// l'appelant.
// recentPhrasesNormalized (cf. lib/eclairages-recent-usage.js) contient les
// latin_phrase déjà publiées dans les RECENT_REPEAT_AVOIDANCE_DAYS derniers
// jours — un filet de sécurité qui s'applique même si l'IA ignore la
// consigne du prompt (ne pas reproposer la même expression trop vite).
function validateSingleLatin(raw, validTopicIds, recentPhrasesNormalized, mottoByTopicId) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "chaque expression doit être un objet JSON." };
  }
  const extraKeys = Object.keys(raw).filter((k) => !LATIN_ITEM_ALLOWED_KEYS.has(k));
  if (extraKeys.length) return { ok: false, reason: `champ(s) inattendu(s) dans une expression : ${extraKeys.join(", ")}.` };

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

  // phrase_origin honnête sur la provenance (article repris / expression
  // attestée / traduction composée) — cf. prompts/latin-du-jour.js pour le
  // détail de pourquoi ce champ existe (éviter qu'une expression composée
  // soit présentée avec une fausse origine historique).
  if (!PHRASE_ORIGIN_SET.has(raw.phrase_origin)) {
    return { ok: false, reason: `phrase_origin doit valoir l'une de : ${[...PHRASE_ORIGIN_SET].join(", ")}.` };
  }

  // Vérifie que "article" recopie vraiment la formule officielle du sujet
  // choisi (cf. commentaire sur mottoByTopicId ci-dessus), pas une autre
  // expression substituée par l'IA malgré la consigne.
  const knownMotto = mottoByTopicId ? mottoByTopicId.get(normalizedTopicId) : undefined;
  if (raw.phrase_origin === "article") {
    if (!knownMotto) {
      return { ok: false, reason: "phrase_origin \"article\" mais aucune formule officielle connue pour ce sujet." };
    }
    if (normalizeLatinPhrase(raw.latin_phrase) !== normalizeLatinPhrase(knownMotto)) {
      return { ok: false, reason: "phrase_origin \"article\" mais latin_phrase ne correspond pas à la formule officielle du sujet." };
    }
  }

  for (const [field, maxLength] of Object.entries(FIELD_MAX_LENGTHS)) {
    if (!isNonEmptyString(raw[field], maxLength)) return { ok: false, reason: `${field} manquant, vide ou trop long.` };
    if (containsHtml(raw[field])) return { ok: false, reason: `${field} contient du HTML.` };
  }

  if (recentPhrasesNormalized && recentPhrasesNormalized.has(normalizeLatinPhrase(raw.latin_phrase))) {
    return { ok: false, reason: `latin_phrase déjà utilisée dans les ${RECENT_REPEAT_AVOIDANCE_DAYS} derniers jours.` };
  }

  // Tolérance volontairement large : un rejet systématique dès que l'IA
  // dévie légèrement de "2 à 4 phrases" serait plus nuisible qu'une
  // explication un peu plus longue ou courte mais valable.
  const wordCount = countWords(raw.explanation);
  if (wordCount < 8 || wordCount > 150) {
    return { ok: false, reason: `explanation hors bornes raisonnables (${wordCount} mots).` };
  }
  // Bornes plus serrées que explanation : "petit paragraphe" (2-3 phrases)
  // doit rester court, pas dériver vers une section d'analyse.
  const newsConnectionWordCount = countWords(raw.news_connection);
  if (newsConnectionWordCount < 8 || newsConnectionWordCount > 90) {
    return { ok: false, reason: `news_connection hors bornes raisonnables (${newsConnectionWordCount} mots).` };
  }

  const grammarValidation = validateGrammarBreakdown(raw.grammar_breakdown);
  if (!grammarValidation.ok) return grammarValidation;

  const sourcesValidation = validateSources(raw.sources);
  if (!sourcesValidation.ok) return sourcesValidation;

  return {
    ok: true,
    data: {
      current_topic_id: normalizedTopicId,
      latin_phrase: raw.latin_phrase.trim(),
      phrase_origin: raw.phrase_origin,
      literal_translation: raw.literal_translation.trim(),
      explanation: raw.explanation.trim(),
      news_connection: raw.news_connection.trim(),
      grammar_breakdown: grammarValidation.breakdown,
      sources: sourcesValidation.sources
    }
  };
}

// Même normalisation que lib/eclairages-recent-usage.js (diacritiques/casse),
// appliquée ici au champ latin_phrase plutôt qu'à un nom de personne.
function normalizeLatinPhrase(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Validation stricte de la réponse IA : présence des champs, valeurs
// autorisées, exactement MAX_LATIN_PER_DAY expression(s), sujet reconnu,
// longueurs raisonnables, absence de HTML, absence de champs inattendus.
// Toute réponse qui ne passe pas ce filtre est traitée comme un échec de
// génération — jamais enregistrée comme contenu publié.
function validateLatinDuJourResponse(raw, topics, recentPhrasesNormalized) {
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

  if (!Array.isArray(raw.latins) || raw.latins.length !== MAX_LATIN_PER_DAY) {
    return { ok: false, reason: `latins doit être un tableau de ${MAX_LATIN_PER_DAY} élément(s).` };
  }

  const validTopicIds = new Set((topics || []).map((t) => String(t.id)));
  // Formule latine officielle par sujet (cf. server.js
  // extractDebateContentLatinMotto) — permet de vérifier que phrase_origin
  // "article" recopie vraiment cette formule plutôt que d'en substituer une
  // autre (l'IA suit la consigne dans l'immense majorité des cas, mais rien
  // ne l'empêche techniquement de dévier).
  const mottoByTopicId = new Map((topics || []).map((t) => [String(t.id), t.latinMotto || null]));

  const validatedLatins = [];
  for (const item of raw.latins) {
    const result = validateSingleLatin(item, validTopicIds, recentPhrasesNormalized, mottoByTopicId);
    if (!result.ok) return result;
    validatedLatins.push(result.data);
  }

  return { ok: true, data: { status: "published", latins: validatedLatins } };
}

function createLatinDuJourService(deps) {
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
    getExcludedTopicIds = async () => new Set()
  } = deps || {};

  if (!supabase) throw new Error("createLatinDuJourService: 'supabase' manquant.");
  if (typeof callOpenAI !== "function") throw new Error("createLatinDuJourService: 'callOpenAI' manquant.");
  if (typeof getPublishedTopicsForDate !== "function") {
    throw new Error("createLatinDuJourService: 'getPublishedTopicsForDate' manquant.");
  }
  if (typeof dateKeyFor !== "function") throw new Error("createLatinDuJourService: 'dateKeyFor' manquant.");

  function toClientResult(row) {
    if (!row) return { status: "insufficient", reason: "Aucun contenu disponible pour le moment." };
    switch (row.status) {
      case "published":
        return { status: "published", date: row.date, generatedAt: row.generated_at, content: row.content };
      case "insufficient":
        return {
          status: "insufficient",
          reason: (row.content && row.content.reason) || row.error_message || "Aucune expression latine pertinente n'a pu être établie aujourd'hui."
        };
      case "generating":
        return { status: "generating" };
      case "failed":
      default:
        return { status: "failed", error: "La génération du mot latin du jour a échoué. Réessaie plus tard." };
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
          reason: (row.content && row.content.reason) || row.error_message || "Aucune expression latine pertinente n'a pu être établie ce jour-là."
        };
      case "generating":
        return { status: "generating", date: row.date };
      case "failed":
      default:
        return { status: "failed", date: row.date, error: "La génération du mot latin du jour a échoué ce jour-là." };
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
    if (error) logger.error("[latin-du-jour] écriture échec :", error.message);
  }

  async function markInsufficient(dateKey, reason) {
    const { error } = await supabase
      .from(TABLE)
      .update({ status: "insufficient", content: { reason }, error_message: null, updated_at: new Date().toISOString() })
      .eq("date", dateKey);
    if (error) logger.error("[latin-du-jour] écriture insuffisant :", error.message);
  }

  async function markPublished(dateKey, data) {
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from(TABLE)
      .update({
        status: "published",
        current_topic_id: data.latins.map((l) => l.current_topic_id).join(","),
        content: data,
        error_message: null,
        generated_at: nowIso,
        updated_at: nowIso
      })
      .eq("date", dateKey);
    if (error) logger.error("[latin-du-jour] écriture publication :", error.message);
  }

  async function runGeneration(dateKey) {
    let topics;
    try {
      topics = await getPublishedTopicsForDate(dateKey);
    } catch (err) {
      logger.error("[latin-du-jour] récupération sujets :", err.message);
      await markFailed(dateKey, "Erreur lors de la récupération des sujets du jour.");
      return { status: "failed", error: "Erreur lors de la récupération des sujets du jour." };
    }

    let usableTopics = (Array.isArray(topics) ? topics : [])
      .filter((t) => t && t.id != null && String(t.title || "").trim() && String(t.summary || "").trim())
      .slice(0, MAX_TOPICS_SENT);

    // Les autres rubriques Éclairages ont toujours priorité sur le choix du
    // sujet : le mot latin du jour attend leur résultat du jour
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
        logger.error("[latin-du-jour] récupération des sujets déjà couverts :", err.message);
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
        logger.warn("[latin-du-jour] aucun sujet publié pour l'instant, génération reportée.");
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
        `[latin-du-jour] génération ${dateKey} — ${usableTopics.length} sujet(s) transmis, modèle ${model}.`
      );
    }

    // Expressions déjà publiées dans les RECENT_REPEAT_AVOIDANCE_DAYS
    // derniers jours (cf. lib/eclairages-recent-usage.js) : transmises à
    // l'IA (prompt) et vérifiées à nouveau après coup (validateSingleLatin),
    // pour ne jamais reproposer la même expression trop vite.
    const { raw: recentPhrases, normalized: recentPhrasesNormalized } = await fetchRecentEclairagesIdentities({
      supabase,
      table: TABLE,
      contentKey: "latins",
      identityField: "latin_phrase",
      todayDateKey: dateKey,
      logger
    });

    // Avec un modèle économique, une réponse "insufficient" ou invalide est
    // parfois un aléa du tirage plutôt qu'un vrai refus. On retente donc
    // quelques fois avant d'abandonner. Les pannes réseau/API franches
    // (hardError) ne sont pas retentées ici.
    let lastOutcome = null;
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      const outcome = await attemptGenerationOnce(usableTopics, recentPhrases, recentPhrasesNormalized);
      lastOutcome = outcome;
      if (outcome.ok) {
        const topicsById = new Map(usableTopics.map((topic) => [String(topic.id), topic]));
        const dataWithTopicContext = {
          ...outcome.data,
          latins: outcome.data.latins.map((latin) => {
            const topic = topicsById.get(String(latin.current_topic_id));
            return {
              ...latin,
              current_topic_title: String(topic?.title || "").trim(),
              current_topic_summary: String(topic?.summary || "").trim()
            };
          })
        };
        await markPublished(dateKey, dataWithTopicContext);
        return { status: "published", date: dateKey, generatedAt: new Date().toISOString(), content: dataWithTopicContext };
      }
      if (outcome.hardError) break;
    }

    if (lastOutcome && lastOutcome.hardError) {
      logger.error("[latin-du-jour] appel IA :", lastOutcome.reason);
      await markFailed(dateKey, "Erreur lors de l'appel au modèle IA.");
      return { status: "failed", error: "Erreur lors de la génération. Réessaie plus tard." };
    }
    if (lastOutcome && lastOutcome.insufficient) {
      await markInsufficient(dateKey, lastOutcome.reason);
      return { status: "insufficient", reason: lastOutcome.reason };
    }

    logger.error(`[latin-du-jour] validation refusée après ${MAX_GENERATION_ATTEMPTS} tentative(s) : ${lastOutcome && lastOutcome.reason}`);
    await markFailed(dateKey, `Validation refusée : ${lastOutcome && lastOutcome.reason}`);
    return { status: "failed", error: "Réponse invalide reçue. Réessaie plus tard." };
  }

  // Un seul essai : appel IA + parsing + validation. Ne touche pas à Supabase
  // (runGeneration décide quoi écrire une fois la boucle de tentatives finie).
  async function attemptGenerationOnce(usableTopics, recentPhrases, recentPhrasesNormalized) {
    let raw;
    try {
      const prompt = buildLatinDuJourPrompt(usableTopics, recentPhrases);
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

    const validation = validateLatinDuJourResponse(raw, usableTopics, recentPhrasesNormalized);
    if (!validation.ok) return { ok: false, hardError: false, reason: validation.reason };

    if (validation.data.status === "insufficient") {
      return { ok: false, hardError: false, insufficient: true, reason: validation.data.reason };
    }
    return { ok: true, data: validation.data };
  }

  // Cache mémoire du résultat "du jour" (cf. lib/citation-du-jour.js pour le
  // détail de la justification : évite un INSERT systématiquement en échec
  // suivi d'un SELECT à chaque appel). États terminaux seulement (jamais
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
      logger.error("[latin-du-jour] réservation du créneau :", err.message);
      return { status: "failed", error: "Erreur de stockage. Réessaie plus tard." };
    }

    const result = claim.claimed
      ? await runGeneration(dateKey)
      : toClientResult(claim.row);

    _todayResultCache = result.status === "generating" ? null : { dateKey, result, computedAt: Date.now() };
    return result;
  }

  // Consultation d'une date précise (menu "jours précédents" du frontend) :
  // lecture seule, ne déclenche jamais de génération.
  async function getByDate(dateKey) {
    const { data, error } = await supabase.from(TABLE).select("*").eq("date", dateKey).maybeSingle();
    if (error) {
      logger.error("[latin-du-jour] lecture d'une date archivée :", error.message);
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
      logger.error("[latin-du-jour] liste des dates publiées :", error.message);
      return [];
    }
    return (data || []).map((row) => row.date);
  }

  return { generateIfNeeded, getByDate, listPublishedDates };
}

module.exports = {
  createLatinDuJourService,
  validateLatinDuJourResponse,
  safeParseJson
};
