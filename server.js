require("dotenv").config();
const express = require("express");
const compression = require("compression");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const dns = require("dns");
const net = require("net");
const { Readable } = require("stream");
const { Worker } = require("worker_threads");
const { createClient } = require("@supabase/supabase-js");
const sharp = require("sharp");
const { recordAiUsage, extractUsage } = require("./lib/ai-usage-log");
const { validateLegacyKey, resolveLegacyUser } = require("./lib/users");
const { buildMemoryItemNaturalKey } = require("./lib/spaced-repetition/memory-model");
const { reviewMemoryItem, computeRetrievability } = require("./lib/spaced-repetition/fsrs-scheduler");
const { mapMnoriaReviewToFsrsRating } = require("./lib/spaced-repetition/rating-mapper");
const { resolveQuestionVariantLabel, resolveActiveQuestionVariant } = require("./lib/spaced-repetition/question-variant");
const { HELP_LEVELS, deriveHelpLevel } = require("./lib/spaced-repetition/help-level");
const { DEFAULT_PROJECTION_DAYS, computeLearningLoadGauge } = require("./lib/spaced-repetition/learning-load");
const learnNextConfig = require("./lib/learn-next/config");
const learnNextScoring = require("./lib/learn-next/scoring");
const learnNextRepository = require("./lib/learn-next/repository");
const { computeLearnNextRecommendations } = require("./lib/learn-next/engine");
const noesRepository = require("./lib/coeus/noes-repository");
const { requestNoesVideo, pollAndFinalizeNoesVideo, NoesRequestError } = require("./lib/coeus/noes-orchestrator");
const { createCoeusRunpodClient } = require("./lib/coeus/runpod-client");
const { createCoeusVolumeClient } = require("./lib/coeus/runpod-volume");
const {
  QUESTION_TYPES,
  FILL_BLANK_MARKER,
  CUSTOM_GRADED_CORRECT_INDEX,
  shuffleArray,
  shuffleOptionsPreservingCorrectIndex,
  shuffleOptionsPreservingCorrectIndexes,
  validateAssociationPairs,
  validateQcmMultiOptions,
  validateOrderItems,
  validateQuestionItemCoreBase,
  validateAltVariant,
  validateQuestionItemCore,
  validateKnowledgeCandidates,
  filterQuestionsToAdmittedKnowledge,
  filterVariantsByKnowledgeConstraints,
  reconcileKnowledgeBatchResults,
  isAssociationAnswerFullyCorrect,
  isQcmMultiAnswerFullyCorrect,
  isOrderAnswerFullyCorrect,
  gradeQuizSubmissionOptionIndex
} = require("./lib/question-formats");
const {
  buildSemanticReviewPrompt,
  runQuestionQualityPipeline
} = require("./lib/qcm-quality");
const {
  buildKnowledgeAdmissionPrompt,
  buildQuestionsFromKnowledgePrompt,
  buildFicheAndKnowledgeAdmissionPrompt,
  buildKnowledgeVerificationPrompt,
  applyKnowledgeVerificationDecisions,
  sanitizeImageSearchQuery
} = require("./lib/knowledge-admission");
const { findEquivalentCustomTopic, parseCustomTopicSlotLevel } = require("./lib/topic-dedup");
const { searchKnowledgeImage } = require("./lib/knowledge-image-search");
const { truncateAtTextBoundary } = require("./lib/text-boundaries");
const {
  ACCEPTED_PHOTO_MIME_TYPES,
  buildAnalysisDataUrl,
  analyzePhotoKnowledge
} = require("./lib/photo-knowledge");
const { buildPhotoDocumentImportId, generatePhotoKnowledgeSheet } = require("./lib/photo-knowledge-sheet");
const {
  decodePdfDataUrl,
  analyzePdfKnowledge,
  createPdfAnalysisToken,
  verifyPdfAnalysisToken
} = require("./lib/pdf-knowledge");
const {
  validateTextKnowledgePayload,
  analyzeTextKnowledge
} = require("./lib/text-knowledge");
const {
  analyzeUrlKnowledge,
  createUrlAnalysisToken,
  verifyUrlAnalysisToken
} = require("./lib/url-knowledge");
const {
  YoutubeKnowledgeError,
  analyzeYoutubeKnowledge,
  createYoutubeAnalysisToken,
  verifyYoutubeAnalysisToken
} = require("./lib/youtube-knowledge");
const {
  cultureGeneraleNotionKey,
  canonicalNotionLinkPair,
  selectValidNotionLinks,
  assembleComprehensionSession
} = require("./lib/culture-generale-links");
const {
  filterUserActiveSolars,
  filterUserActiveStars,
  userActiveGalaxies,
  buildKnownPlacementLookup,
  isKnowledgeCandidate,
  parseMatchDecision,
  parseCreationDecision,
  matchExistingStarByLabel,
  validateStarLabelCandidate,
  validateTaxonomyCreationCandidate
} = require("./lib/knowledge-taxonomy/taxonomy-engine");
const { validatePushSubscription, registerPushSubscription } = require("./lib/push-subscriptions");
const { createNotificationEventSafe } = require("./lib/notification-events");
const { sendTestPushToLatestSubscription, sendNotificationEventPushById, processPendingPushEvents, broadcastPush } = require("./lib/push-sender");
const {
  getExcludedTags,
  replaceExcludedTags,
  normalizeExcludedTags,
  normalizeTag,
  extractRawTagsFromItem
} = require("./lib/tagTrends");
const { createParalleleHistoriqueService } = require("./lib/parallele-historique");
const { createPenseePhilosophiqueService } = require("./lib/pensee-philosophique");
const { createMecanismeSociologiqueService } = require("./lib/mecanisme-sociologique");
const { createConceptDuJourService } = require("./lib/concept-du-jour");
const { createCitationDuJourService } = require("./lib/citation-du-jour");
const { createOeuvreArtDuJourService } = require("./lib/oeuvre-art-du-jour");
const { createLatinDuJourService } = require("./lib/latin-du-jour");

const app = express();
app.set("trust proxy", 1);
app.use(compression());
const PORT = process.env.PORT || 3001;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error("❌ ADMIN_PASSWORD manquant !");
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant !");
  process.exit(1);
}

// Sans plafond, une requête vers un Supabase dégradé peut pendre indéfiniment
// (33 minutes observées le 04/07/2026 pendant l'incident plateforme Supabase)
// et engorger tout le process. Chaque appel est donc borné. Le Storage garde
// une limite large : un upload de vidéo peut légitimement dépasser 10 s.
const SUPABASE_DB_TIMEOUT_MS = 10000;
const SUPABASE_STORAGE_TIMEOUT_MS = 120000;
const SUPABASE_RETRY_DELAY_MS = 250;
// Blips réseau transitoires (rafale de resets TLS Supabase observée le
// 19/07/2026 ~20h26) — un timeout (TimeoutError) n'en fait pas partie.
function isTransientSupabaseNetworkError(error) {
  const cause = error?.cause || error;
  const text = `${cause?.code || ""} ${cause?.message || ""} ${error?.message || ""}`;
  return /ECONNRESET|ECONNREFUSED|EPIPE|EAI_AGAIN|ENOTFOUND|UND_ERR_SOCKET|socket hang up|other side closed/i.test(text);
}
// Traqueur d'egress Supabase (audit du 26/08/2026) : seul point de passage de TOUS les
// appels REST + Storage du serveur vers Supabase (le client est configuré avec ce fetch
// custom, cf. plus bas), donc l'endroit le plus fiable pour mesurer les octets réels — bien
// plus fiable qu'auditer le code route par route à la main comme on l'a fait ce jour-là.
// En mémoire seule (repart à zéro à chaque redémarrage) : c'est volontaire, l'usage visé est
// "est-ce que le correctif que je viens de déployer a fait baisser le trafic depuis", pas un
// cumul mensuel (pour ça, cf. Dashboard Supabase → Organisation → Usage).
const supabaseEgressStats = {
  since: Date.now(),
  totalRequests: 0,
  totalBytes: 0,
  byKey: new Map() // `${method} ${table}` -> { requests, bytes }
};
function extractSupabaseEgressStatsKey(url, method) {
  try {
    const pathname = new URL(url).pathname;
    const restMatch = pathname.match(/^\/rest\/v1\/([^/?]+)/);
    if (restMatch) return `${method} rest:${restMatch[1]}`;
    if (pathname.startsWith("/storage/")) return `${method} storage`;
    if (pathname.startsWith("/auth/")) return `${method} auth`;
    if (pathname.startsWith("/rest-admin/") || pathname.startsWith("/admin/")) return `${method} mgmt`;
    return `${method} ${pathname}`;
  } catch {
    return `${method} unknown`;
  }
}
function recordSupabaseEgress(url, method, response) {
  // .clone() : lit une copie du flux, sans jamais toucher au corps que supabase-js va lire
  // juste après — c'est le seul moyen d'obtenir la taille RÉELLE (le header Content-Length
  // est souvent absent en réponse chunked). Volontairement non-awaité : ne doit jamais
  // ralentir la requête réelle, seule la mesure peut arriver après coup.
  try {
    response.clone().arrayBuffer().then((buf) => {
      const key = extractSupabaseEgressStatsKey(url, method);
      supabaseEgressStats.totalRequests += 1;
      supabaseEgressStats.totalBytes += buf.byteLength;
      const entry = supabaseEgressStats.byKey.get(key) || { requests: 0, bytes: 0 };
      entry.requests += 1;
      entry.bytes += buf.byteLength;
      supabaseEgressStats.byKey.set(key, entry);
    }).catch(() => {});
  } catch {}
}

async function supabaseFetchWithTimeout(input, init = {}) {
  const url = typeof input === "string" ? input : String(input?.url || "");
  const timeoutMs = url.includes("/storage/v1/") ? SUPABASE_STORAGE_TIMEOUT_MS : SUPABASE_DB_TIMEOUT_MS;
  const method = String(init.method || input?.method || "GET").toUpperCase();
  const doFetch = async () => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    // AbortSignal.any : Node ≥ 20.3. À défaut, on préserve le signal appelant.
    const signal = init.signal
      ? (typeof AbortSignal.any === "function" ? AbortSignal.any([init.signal, timeoutSignal]) : init.signal)
      : timeoutSignal;
    const response = await fetch(input, { ...init, signal });
    recordSupabaseEgress(url, method, response);
    return response;
  };
  try {
    return await doFetch();
  } catch (error) {
    // Une seule relance rapide, lectures uniquement — un POST relancé après
    // une coupure en plein vol pourrait écrire deux fois.
    if ((method === "GET" || method === "HEAD") && !init.signal?.aborted && isTransientSupabaseNetworkError(error)) {
      await new Promise((resolve) => setTimeout(resolve, SUPABASE_RETRY_DELAY_MS));
      return doFetch();
    }
    throw error;
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { fetch: supabaseFetchWithTimeout }
});

// Résumé periodique dans les logs (visibles sans auth admin, ex. `pm2 logs` / Render logs) :
// top des tables par octets transférés depuis le dernier redémarrage. Complète
// /api/admin/egress-stats pour un suivi passif sans avoir à interroger l'API.
setInterval(() => {
  if (supabaseEgressStats.totalRequests === 0) return;
  const top = [...supabaseEgressStats.byKey.entries()]
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 5)
    .map(([key, v]) => `${key}=${(v.bytes / 1024 / 1024).toFixed(2)}Mo/${v.requests}req`)
    .join(", ");
  console.log(`[egress-stats] total=${(supabaseEgressStats.totalBytes / 1024 / 1024).toFixed(2)}Mo (${supabaseEgressStats.totalRequests} req) depuis ${new Date(supabaseEgressStats.since).toISOString()} — top: ${top}`);
}, 15 * 60 * 1000).unref();

// Filet de sécurité : une coupure réseau/DNS ponctuelle vers Supabase (ex. getaddrinfo
// ENOTFOUND) qui échappe à un try/catch dans une route async fait planter tout le
// process par défaut (Node ≥15 : unhandledRejection = crash). Repéré le 24/06/2026 via
// pm2 (21 redémarrages en quelques minutes), probable cause des refresh inopinés côté
// index pendant la fenêtre de redémarrage. On loggue sans jamais tuer le process pour
// ces deux signaux ; un vrai bug logique a de bien meilleures chances d'être vu en
// pratique via les logs applicatifs existants que via un crash silencieux.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

const ADMIN_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
function createAdminToken() {
  const ts = Date.now().toString();
  const sig = crypto.createHmac("sha256", ADMIN_PASSWORD).update(ts).digest("hex");
  return `${ts}.${sig}`;
}
function verifyAdminToken(token) {
  if (!token || typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot === -1) return false;
  const ts = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const timestamp = parseInt(ts, 10);
  if (!Number.isFinite(timestamp) || Date.now() - timestamp > ADMIN_TOKEN_TTL_MS) return false;
  const expected = crypto.createHmac("sha256", ADMIN_PASSWORD).update(ts).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch { return false; }
}
const MNORIA_ADMIN_CREATOR_KEY = "__AGON_ADMIN__";
// Identifiant fixe envoyé par le pipeline Certamen (bot veille) sur POST /api/debates
// pour publier des arènes communauté. Ces arènes ne doivent jamais afficher de badge
// de tendance sur les cartes (demande explicite de Kevin) : voir le garde-fou autour
// de setDebateTrend dans POST /api/debates.
const CERTAMEN_CREATOR_KEY = process.env.CERTAMEN_CREATOR_KEY || "certamen-bot";
// Garde anti-double-insert Certamen : le pipeline peut émettre deux POST /api/debates
// concurrents pour le même sujet (retry réseau, double déclenchement) — cf. les paires
// du 27/06/2026 insérées à la même milliseconde (1088/1089, 1090/1091...). Le verrou
// mémoire est posé de façon synchrone avant tout await pour fermer cette course ;
// la vérification en base couvre le cas d'un restart entre les deux requêtes.
const CERTAMEN_DUPLICATE_WINDOW_MS = 15 * 60 * 1000;
const _certamenRecentQuestionKeys = new Map();
function claimCertamenQuestionKey(normalizedQuestion) {
  const now = Date.now();
  for (const [key, at] of _certamenRecentQuestionKeys) {
    if (now - at > CERTAMEN_DUPLICATE_WINDOW_MS) _certamenRecentQuestionKeys.delete(key);
  }
  if (_certamenRecentQuestionKeys.has(normalizedQuestion)) return false;
  _certamenRecentQuestionKeys.set(normalizedQuestion, now);
  return true;
}
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:contact@mnoriaarena.org";

app.use(express.json({ limit: "100kb" }));
app.use(express.static("public", { maxAge: "2m" }));

const { createHistoricalEventsRouter } = require("./routes/historical-events");
app.use("/api/historical-events", createHistoricalEventsRouter());
// Page de test isolée, non liée à l'accueil (cf. views/historical-events-test.html).
app.get("/historical-events-test", (req, res) => {
  res.set("Cache-Control", "no-store").sendFile(path.join(__dirname, "views/historical-events-test.html"));
});

// Réutilisé par le QCM "Ce jour dans l'Histoire" (cf. section QCM du jour) —
// valide et met en cache data/historical-events/events.json au chargement ;
// si le fichier est invalide (édité en parallèle par un autre chantier), on
// log et on continue sans planter le serveur plutôt que de faire échouer
// tout le démarrage pour une fonctionnalité annexe.
const { createHistoricalEventsRepository } = require("./lib/historical-events/repository");
let historicalEventsRepository = null;
try {
  historicalEventsRepository = createHistoricalEventsRepository();
} catch (error) {
  console.error("[historical-events] chargement du repository (QCM Ce jour dans l'Histoire indisponible) :", error.message);
}

// ── Rate limiter in-process (pas de dépendance externe) ─────────────────────
// ATTENTION : basé sur req.ip. Si l'app est derrière un proxy (Render, Heroku,
// Nginx…), activer app.set('trust proxy', 1) pour que req.ip soit l'IP réelle
// et non l'IP du proxy (sinon tous les users partagent la même limite).
const _rlWindows = new Map();
const _RL_WINDOW_MS = 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - _RL_WINDOW_MS;
  for (const [k, v] of _rlWindows) if (v.start < cutoff) _rlWindows.delete(k);
}, 5 * 60 * 1000).unref();
function rateLimit(key, max) {
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || "?";
    const mk = `${ip}:${key}`;
    const now = Date.now();
    const e = _rlWindows.get(mk);
    if (!e || now - e.start > _RL_WINDOW_MS) { _rlWindows.set(mk, { start: now, count: 1 }); return next(); }
    if (++e.count > max) return res.status(429).json({ error: "Trop de requêtes. Réessaie dans quelques instants." });
    next();
  };
}
// ────────────────────────────────────────────────────────────────────────────

function isRenderScopedTaskEnabled(envName) {
  const forced = String(process.env[envName] || "").trim().toLowerCase();
  if (forced === "on") return true;
  if (forced === "off") return false;
  return Boolean(process.env.RENDER);
}

app.use((req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "autoplay=*, fullscreen=*, picture-in-picture=*, web-share=*"
  );
  next();
});

function shouldTraceSlowUserRoute(req) {
  const pathname = String(req.path || "").trim();
  if (pathname === "/notifications" || pathname === "/debate") return true;
  if (pathname === "/api/notifications") return true;
  return /^\/api\/debates\/[^/]+$/.test(pathname);
}

app.use((req, res, next) => {
  if (!shouldTraceSlowUserRoute(req)) return next();

  const startedAt = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    if (durationMs >= 700) {
      console.warn(`[slow-route] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`);
    }
  });
  next();
});

function escapeMetaContent(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlContent(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildAbsoluteUrl(req, pathname) {
  return `${req.protocol}://${req.get("host")}${pathname}`;
}

const _viewTemplateCache = {};
function readViewTemplate(templateName) {
  if (!_viewTemplateCache[templateName]) {
    _viewTemplateCache[templateName] = fs.readFileSync(path.join(__dirname, "views", templateName), "utf8");
  }
  return _viewTemplateCache[templateName];
}

const VEILLE_URL = (process.env.VEILLE_URL || "http://localhost:3000/mixte").trim();
const VEILLE_MEDIAS_PATH = (process.env.VEILLE_MEDIAS_PATH || path.join(__dirname, "..", "bot veille", "medias.json")).trim();
const VEILLE_YOUTUBE_PATH = (process.env.VEILLE_YOUTUBE_PATH || path.join(__dirname, "..", "bot veille", "youtube-chaines.json")).trim();

let _veilleMediasCache = null;
let _veilleMediasCacheComputedAt = 0;
// TTL 5 min : sans ça, un média ajouté/modifié dans veille_medias sur Supabase
// restait invisible (ex. onglet Personnalisé) jusqu'au prochain redémarrage
// du serveur, le cache n'étant chargé qu'une fois au boot.
const VEILLE_MEDIAS_CACHE_TTL_MS = 5 * 60 * 1000;
function veilleMediasCacheIsStale() {
  return !_veilleMediasCache || Date.now() - _veilleMediasCacheComputedAt > VEILLE_MEDIAS_CACHE_TTL_MS;
}

function normalizeVeilleMediaOrientation(nom, domain, orientation) {
  const mediaName = String(nom || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .trim();
  const mediaDomain = String(domain || "").replace(/^www\./, "").toLowerCase();
  // Rubrique nommée du Monde (ex. "Le Monde – Le Fil Good") : garde son orientation
  // propre plutôt que d'hériter du "généraliste" forcé pour le flux principal.
  const isNamedLeMondeSection = /^le monde\s*[:\-–]/.test(mediaName);
  if (!isNamedLeMondeSection && (mediaName === "le monde" || mediaDomain === "lemonde.fr")) return "généraliste";
  if (mediaName === "l'obs" || mediaName.includes("nouvelobs") || mediaDomain === "nouvelobs.com") return "généraliste";
  if (mediaName === "france inter" || mediaName.startsWith("france inter :") || mediaDomain === "franceinter.fr") return "généraliste";
  if (mediaName === "europe 1" || mediaName.startsWith("europe 1 :") || mediaName === "europe1" || mediaDomain === "europe1.fr") return "droite";
  return String(orientation || "").trim();
}

function _processMediasRows(items) {
  function extractYouTubeChannelId(item) {
    const candidates = [String(item?.rss || ""), String(item?.url || "")];
    for (const c of candidates) {
      const m = c.match(/(?:channel_id=|\/channel\/)(UC[\w-]+)/i);
      if (m?.[1]) return m[1];
    }
    return "";
  }
  function extractYouTubeHandle(item) {
    const m = String(item?.url || "").match(/youtube\.com\/@([^/?#]+)/i);
    return m?.[1] ? `@${m[1]}` : "";
  }
  return (Array.isArray(items) ? items : [])
    .filter(item => String(item?.nom || "").trim())
    .map(item => {
      const isYt = item.type === "youtube" || String(item?.url || "").includes("youtube.com");
      let domain = isYt ? "youtube.com" : "";
      if (!isYt) {
        // Le flux RSS passe parfois par un service tiers (feedburner, etc.) dont le domaine
        // ne correspond pas au site réel des articles : on privilégie le champ url s'il est renseigné.
        try { domain = new URL(String(item?.url || "")).hostname.replace(/^www\./, "").toLowerCase(); } catch (_) {}
        if (!domain) {
          try { domain = new URL(String(item?.rss || "")).hostname.replace(/^www\./, "").toLowerCase(); } catch (_) {}
        }
      }
      const nom = String(item?.nom || item?.name || "").trim();
      return {
        nom,
        orientation: normalizeVeilleMediaOrientation(nom, domain, item?.orientation),
        domain,
        ...(isYt ? {
          url:       String(item?.url || "").trim(),
          rss:       String(item?.rss || "").trim(),
          channelId: extractYouTubeChannelId(item),
          handle:    extractYouTubeHandle(item)
        } : {})
      };
    });
}

async function _loadVeilleMediasFromSupabase() {
  try {
    const { data, error } = await supabase.from("veille_medias").select("*").order("nom");
    if (error || !data?.length) return false;
    _veilleMediasCache = _processMediasRows(data);
    _veilleMediasCacheComputedAt = Date.now();
    return true;
  } catch (_) { return false; }
}

function readVeilleMedias() {
  if (_veilleMediasCache !== null) return _veilleMediasCache;
  // Fallback fichiers locaux (dev)
  try {
    const press = JSON.parse(fs.readFileSync(VEILLE_MEDIAS_PATH, "utf8"));
    let yt = [];
    try { yt = JSON.parse(fs.readFileSync(VEILLE_YOUTUBE_PATH, "utf8")).map(i => ({ ...i, type: "youtube" })); } catch (_) {}
    return _processMediasRows([...press, ...yt]);
  } catch (_) { return []; }
}

function replaceMetaPlaceholders(template, meta) {
  let mediasJson = "[]";
  try { mediasJson = JSON.stringify(readVeilleMedias()); } catch (_) {}
  const mediasJsonForScript = mediasJson
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return String(template || "")
    .replaceAll("__META_TITLE__", escapeMetaContent(meta.title || "Mnoria"))
    .replaceAll("__META_DESCRIPTION__", escapeMetaContent(meta.description || ""))
    .replaceAll("__META_URL__", escapeMetaContent(meta.url || ""))
    .replaceAll("__META_IMAGE__", escapeMetaContent(meta.image || ""))
    .replaceAll("__META_IMAGE_ALT__", escapeMetaContent(meta.imageAlt || "Mnoria"))
    .replaceAll("__VEILLE_URL__", VEILLE_URL)
    .replaceAll("__VEILLE_MEDIAS_JSON__", mediasJsonForScript);
}

function buildIndexMeta(req) {
  return {
    title: "Mnoria | L’arène des idées",
    description: "Mnoria est un réseau social d’intelligence collective augmenté par l’IA. Il permet d’explorer des idées, d’enrichir sa culture, de confronter les points de vue et de mémoriser durablement ce qui compte.",
    url: buildAbsoluteUrl(req, "/"),
    image: buildAbsoluteUrl(req, "/mnoria-icon-512.png"),
    imageAlt: "Mnoria — l'arène des idées"
  };
}

function normalizeMetaText(value, maxLength = 220) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function buildDebateMeta(req, debate) {
  const debateId = String(debate?.id || "").trim();
  const debateUrl = debateId
    ? buildAbsoluteUrl(req, `/debate?id=${encodeURIComponent(debateId)}`)
    : buildAbsoluteUrl(req, "/debate");
  const ogImageUrl = debateId
    ? buildAbsoluteUrl(req, `/og/debate/${encodeURIComponent(debateId)}.png`)
    : buildAbsoluteUrl(req, "/mnoria-icon-512.png");
  const isOpen = String(debate?.type || "").trim().toLowerCase() === "open";
  const question = normalizeMetaText(debate?.question || "Débat sur mnoria", 110);
  const optionA = normalizeMetaText(debate?.option_a || "", 80);
  const optionB = normalizeMetaText(debate?.option_b || "", 80);
  const title = `${question} | mnoria`;
  const description = isOpen
    ? "Découvrez les réponses déjà proposées et ajoutez votre idée sur mnoria."
    : `Comparez les positions "${optionA || "Position A"}" et "${optionB || "Position B"}" dans cette arène sur mnoria.`;

  return {
    title,
    description,
    url: debateUrl,
    image: ogImageUrl,
    imageAlt: question
  };
}

function normalizeExternalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    return raw;
  }

  if (raw.startsWith('//')) {
    return `https:${raw}`;
  }

  return `https://${raw}`;
}

class SsrfBlockedError extends Error {
  constructor(message = "URL bloquée (SSRF_BLOCKED)") {
    super(message);
    this.name = "SSRF_BLOCKED";
  }
}

// Bloque les IP privées, link-local, loopback et réservées (anti-SSRF)
function isPrivateOrReservedIp(ip) {
  const version = net.isIP(ip);
  if (!version) return true;

  if (version === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // 169.254.0.0/16
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10
    return false;
  }

  const normalized = ip.toLowerCase();

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) -> revérifie la partie IPv4
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrReservedIp(mapped[1]);

  if (normalized === "::1") return true; // loopback
  if (normalized === "::") return true; // unspecified

  const firstGroup = normalized.split(":")[0];
  const firstGroupValue = parseInt(firstGroup || "0", 16);

  if ((firstGroupValue & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
  if ((firstGroupValue & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)

  return false;
}

// Valide qu'une URL externe ne pointe pas vers une cible interne/privée avant fetch (anti-SSRF)
async function assertSafeExternalUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new SsrfBlockedError("URL invalide");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfBlockedError("Protocole non autorisé");
  }

  const hostname = parsed.hostname.toLowerCase();

  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "0.0.0.0") {
    throw new SsrfBlockedError("Hôte non autorisé");
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new SsrfBlockedError("Adresse IP non autorisée");
    }
    return;
  }

  let addresses;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch (error) {
    throw new SsrfBlockedError("Résolution DNS impossible");
  }

  if (!addresses.length || addresses.some((entry) => isPrivateOrReservedIp(entry.address))) {
    throw new SsrfBlockedError("Adresse résolue non autorisée");
  }
}

const HTML_ENTITY_MAP = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  shy: "",
  laquo: "«",
  raquo: "»",
  lsquo: "'",
  rsquo: "'",
  sbquo: "'",
  ldquo: '"',
  rdquo: '"',
  bdquo: '"',
  ndash: "-",
  mdash: "-",
  hellip: "...",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  euro: "€",
  cent: "¢",
  pound: "£",
  yen: "¥",
  sect: "§",
  para: "¶",
  agrave: "à",
  aacute: "á",
  acirc: "â",
  atilde: "ã",
  auml: "ä",
  aring: "å",
  aelig: "æ",
  ccedil: "ç",
  egrave: "è",
  eacute: "é",
  ecirc: "ê",
  euml: "ë",
  igrave: "ì",
  iacute: "í",
  icirc: "î",
  iuml: "ï",
  eth: "ð",
  ntilde: "ñ",
  ograve: "ò",
  oacute: "ó",
  ocirc: "ô",
  otilde: "õ",
  ouml: "ö",
  oslash: "ø",
  ugrave: "ù",
  uacute: "ú",
  ucirc: "û",
  uuml: "ü",
  yacute: "ý",
  yuml: "ÿ",
  Agrave: "À",
  Aacute: "Á",
  Acirc: "Â",
  Atilde: "Ã",
  Auml: "Ä",
  Aring: "Å",
  AElig: "Æ",
  Ccedil: "Ç",
  Egrave: "È",
  Eacute: "É",
  Ecirc: "Ê",
  Euml: "Ë",
  Igrave: "Ì",
  Iacute: "Í",
  Icirc: "Î",
  Iuml: "Ï",
  Ntilde: "Ñ",
  Ograve: "Ò",
  Oacute: "Ó",
  Ocirc: "Ô",
  Otilde: "Õ",
  Ouml: "Ö",
  Oslash: "Ø",
  Ugrave: "Ù",
  Uacute: "Ú",
  Ucirc: "Û",
  Uuml: "Ü",
  Yacute: "Ý"
};

function decodeHtmlEntities(value) {
  let output = String(value ?? "");

  for (let i = 0; i < 3; i += 1) {
    const decoded = output
      .replace(/&#(\d+);/g, (match, code) => {
        const numeric = Number.parseInt(code, 10);
        return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : match;
      })
      .replace(/&#x([0-9a-fA-F]+);/g, (match, code) => {
        const numeric = Number.parseInt(code, 16);
        return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : match;
      })
      .replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (match, name) => {
        return Object.prototype.hasOwnProperty.call(HTML_ENTITY_MAP, name)
          ? HTML_ENTITY_MAP[name]
          : match;
      })
      .replace(/\\\//g, "/");

    if (decoded === output) {
      break;
    }

    output = decoded;
  }

  return output;
}

function cleanPreviewText(value, maxLength = 240) {
  const text = decodeHtmlEntities(String(value ?? "").replace(/\s+/g, " ").trim());
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function resolvePreviewUrl(rawUrl, baseUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  try {
    return new URL(value, baseUrl).toString();
  } catch (error) {
    return value;
  }
}

function extractTitleTagContent(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return cleanPreviewText(match?.[1] || "", 500);
}

function parseMetaTags(html) {
  const tags = [];
  const regex = /<meta\b[^>]*>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const tag = match[0];
    const attrs = {};
    const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g;
    let attrMatch;

    while ((attrMatch = attrRegex.exec(tag)) !== null) {
      const key = String(attrMatch[1] || "").toLowerCase();
      const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
      attrs[key] = value;
    }

    if (Object.keys(attrs).length) {
      tags.push(attrs);
    }
  }

  return tags;
}

function getMetaValues(metaTags, keys) {
  const wanted = keys.map((key) => String(key || "").toLowerCase());
  const values = [];

  for (const tag of metaTags) {
    const ref = String(tag.property || tag.name || tag.itemprop || "").toLowerCase();
    if (!ref || !wanted.includes(ref)) continue;

    const content = cleanPreviewText(tag.content || tag.value || "", 500);
    if (content) values.push(content);
  }

  return values;
}

function getFirstMetaValue(metaTags, keys) {
  return getMetaValues(metaTags, keys)[0] || "";
}

function extractLinkHref(html, relName) {
  const regex = /<link\b[^>]*>/gi;
  let match;
  const wanted = String(relName || "").toLowerCase();

  while ((match = regex.exec(html)) !== null) {
    const tag = match[0];
    const attrs = {};
    const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g;
    let attrMatch;

    while ((attrMatch = attrRegex.exec(tag)) !== null) {
      const key = String(attrMatch[1] || "").toLowerCase();
      const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
      attrs[key] = value;
    }

    const rel = String(attrs.rel || "").toLowerCase();
    if (rel !== wanted) continue;

    const href = String(attrs.href || "").trim();
    if (href) return href;
  }

  return "";
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

const debateImagesDir = path.join(__dirname, "public", "debate-images");
const debateVideosDir = path.join(__dirname, "public", "debate-videos");
const debateAssetsMetaPath = path.join(__dirname, "data", "debate-assets.json");
const sharedDebateLinksMetaPath = path.join(__dirname, "data", "debate-shared-links.json");
const storiesMetaPath = path.join(__dirname, "data", "stories.json");
const debateKeywordsMetaPath = path.join(__dirname, "data", "debate-keywords.json");
const tagExclusionsMetaPath = path.join(__dirname, "data", "tag-exclusions.json");
const publicTagExclusionsMetaPath = path.join(__dirname, "public", "tag-exclusions.json");
const MAX_DEBATE_VIDEO_BYTES = 80 * 1024 * 1024;
const SUPABASE_DEBATE_MEDIA_BUCKET = String(process.env.SUPABASE_DEBATE_MEDIA_BUCKET || "debate-media").trim() || "debate-media";

const debateContentMetaPath = path.join(__dirname, "data", "debate-content.json");


// Postgres refuse le caractère nul dans les colonnes text/jsonb (erreur 22P05
// "unsupported Unicode escape sequence") : on le retire de tout texte entrant,
// il peut arriver via du contenu scrapé ou généré (incident du 05/07/2026 sur
// un POST /api/debates Certamen).
function stripNullChars(value) {
  return String(value || "").replace(/\u0000/g, "");
}

function normalizeDebateContent(value) {
  return stripNullChars(value).trim().slice(0, 1800);
}

function limitText(value, max) {
  return stripNullChars(value).trim().slice(0, max);
}


function normalizeKeywordList(values, max = 10, maxLength = 28) {
  const seen = new Set();
  const list = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const keyword = String(value || "")
      .replace(/^[-–—•\s]+/, "")
      .replace(/[?!.;,:\s]+$/g, "")
      .trim();
    if (!keyword) return;
    if (keyword.length < 2 || keyword.length > maxLength) return;
    const lower = keyword.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    list.push(keyword);
  });
  return list.slice(0, max);
}

let _sharedLinksCache = null;

function _getSharedLinksMap() {
  if (_sharedLinksCache === null) {
    try { _sharedLinksCache = JSON.parse(fs.readFileSync(sharedDebateLinksMetaPath, "utf8")); } catch { _sharedLinksCache = {}; }
  }
  return _sharedLinksCache;
}

// Charge la source de vérité (app_config) dès le démarrage. Le fichier local n'est
// qu'un fallback de migration : sans ce chargement, chaque restart repartait de la
// map périmée du fichier puis l'écrasait dans Supabase à la première fusion — c'est
// ce qui a annulé la réparation des liens du 03/07 (re-empoisonnement de 16:57) et
// perdait tous les liens créés depuis le dernier commit du fichier.
(async () => {
  try {
    const { data, error } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "shared_debate_links")
      .maybeSingle();
    if (!error && data?.value && typeof data.value === "object") {
      _sharedLinksCache = data.value;
    }
  } catch (e) {
    console.error("[shared_debate_links] chargement Supabase impossible (fallback fichier) :", e.message);
  }
})();

function _persistSharedLinksMap(map) {
  _sharedLinksCache = map;
  // Garde aussi le fichier local à jour : il reste le fallback si Supabase est
  // injoignable au prochain démarrage.
  try { fs.writeFileSync(sharedDebateLinksMetaPath, JSON.stringify(map, null, 2)); } catch {}
  supabase.from("app_config")
    .upsert({ key: "shared_debate_links", value: map, updated_at: new Date().toISOString() })
    .then(({ error }) => { if (error) console.error("[shared_debate_links] save error:", error.message); })
    .catch(() => {});
}

function resolveSharedDebateId(debateId) {
  const initialId = String(debateId || "").trim();
  if (!initialId) return "";

  const map = _getSharedLinksMap();
  let currentId = initialId;
  const visited = new Set([currentId]);

  while (map[currentId]) {
    const nextId = String(map[currentId] || "").trim();
    if (!nextId || visited.has(nextId)) break;
    visited.add(nextId);
    currentId = nextId;
  }

  return currentId;
}

function getDebateIdsInSharedSpace(debateId) {
  const canonicalId = resolveSharedDebateId(debateId);
  if (!canonicalId) return [];

  const map = _getSharedLinksMap();
  const ids = new Set([canonicalId]);

  for (const candidateId of Object.keys(map)) {
    if (resolveSharedDebateId(candidateId) === canonicalId) {
      ids.add(String(candidateId));
    }
  }

  return [...ids];
}

function linkDebateToSharedSpace(sourceDebateId, targetDebateId) {
  const sourceId = String(sourceDebateId || "").trim();
  const canonicalTargetId = resolveSharedDebateId(targetDebateId);
  if (!sourceId || !canonicalTargetId || sourceId === canonicalTargetId) {
    removeDebateSharedLink(sourceId);
    return canonicalTargetId;
  }

  const map = _getSharedLinksMap();
  map[sourceId] = canonicalTargetId;
  _persistSharedLinksMap(map);
  return canonicalTargetId;
}

function removeDebateSharedLink(debateId) {
  const debateKey = String(debateId || "").trim();
  if (!debateKey) return;

  const map = _getSharedLinksMap();
  let changed = false;

  if (map[debateKey]) {
    delete map[debateKey];
    changed = true;
  }

  for (const [aliasId, targetId] of Object.entries(map)) {
    if (String(targetId || "").trim() === debateKey) {
      delete map[aliasId];
      changed = true;
    }
  }

  if (changed) _persistSharedLinksMap(map);
}



function setVeillePendingLinkedDebate(id, debateId) {
  const pendingId = String(id || "").trim();
  if (!pendingId) return;
  const canonicalDebateId = resolveSharedDebateId(debateId);
  supabase.from("veille_pending").update({ pending_linked_debate_id: canonicalDebateId || null }).eq("id", Number(pendingId))
    .then(({ error }) => { if (error) console.error("[veille_pending links sync]", pendingId, error.message); })
    .catch(() => {});
}

function clearVeillePendingLinkedDebate(id) {
  const pendingId = String(id || "").trim();
  if (!pendingId) return;
  supabase.from("veille_pending").update({ pending_linked_debate_id: null }).eq("id", Number(pendingId))
    .then(() => {}).catch(() => {});
}


async function upsertStory(story) {
  const safe = {
    story_id:             String(story.story_id || "").trim(),
    story_title:          String(story.story_title || "").trim(),
    main_actors:          Array.isArray(story.main_actors) ? story.main_actors : [],
    central_tension:      String(story.central_tension || "").trim(),
    keywords:             Array.isArray(story.keywords) ? story.keywords : [],
    status:               String(story.status || "active").trim(),
    first_episode_id:     story.first_episode_id ? String(story.first_episode_id) : null,
    latest_episode_id:    story.latest_episode_id ? String(story.latest_episode_id) : null,
    latest_episode_title: String(story.latest_episode_title || "").trim(),
    created_at:           story.created_at || new Date().toISOString(),
    updated_at:           story.updated_at || new Date().toISOString()
  };
  const { error } = await supabase.from("stories").upsert(safe, { onConflict: "story_id" });
  if (error) console.error("[stories upsert]", error.message);
  return safe;
}

function slugifyStoryTitle(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "story";
}

function createStoryId(title) {
  return `${slugifyStoryTitle(title)}-${Date.now().toString(36)}`;
}



function setDebateStoryId(debateId, storyId) {
  const debateKey = String(debateId || "").trim();
  if (!debateKey) return Promise.resolve();
  return supabase.from("debates").update({ story_id: storyId || null }).eq("id", debateKey)
    .then(() => {}).catch(e => console.error("[story_id sync Supabase]", e));
}

function removeDebateStoryId(debateId) {
  setDebateStoryId(debateId, "");
}



function setDebateEpisodeNav(debateId, nav) {
  const debateKey = String(debateId || "").trim();
  if (!debateKey) return;
  supabase.from("debates").update({ episode_nav: nav || null }).eq("id", debateKey)
    .then(({ error }) => { if (error) console.error("[episode_nav sync]", debateKey, error.message); })
    .catch(() => {});
}

function removeDebateEpisodeNav(debateId) {
  setDebateEpisodeNav(debateId, null);
}

function parseStoryEpisodeDate(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return null;

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    const [day, month, year] = value.split("/");
    const parsed = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function resolveDebateEpisodeSortDate(debate) {
  // Pour la navigation entre épisodes, on suit d'abord la chronologie
  // de publication sur Mnoria. Les dates des sources externes peuvent être
  // plus anciennes et fausser l'ordre narratif si on les privilégie.
  const createdAt = parseStoryEpisodeDate(debate?.created_at);
  if (createdAt) return createdAt;

  const publishedAt = parseStoryEpisodeDate(debate?.source_published_at);
  if (publishedAt) return publishedAt;

  const extras = Array.isArray(debate?.media_extras) ? debate.media_extras : [];
  for (const item of extras) {
    if (String(item?.type || "").trim() !== "source") continue;
    const extraDate = parseStoryEpisodeDate(item?.date || item?.published_at);
    if (extraDate) return extraDate;
  }

  return null;
}

async function recalculateStoryEpisodeNavigation(storyId) {
  const targetStoryId = String(storyId || "").trim();
  if (!targetStoryId) return;

  const { data: debates, error } = await supabase
    .from("debates")
    .select("id,question,created_at,source_published_at,media_extras")
    .eq("story_id", targetStoryId);

  if (error) throw new Error(error.message);
  if (!debates || !debates.length) return;

  const orderedDebates = debates
    .map((debate) => ({
      ...debate,
      _episodeSortDate: resolveDebateEpisodeSortDate(debate),
      _episodeInsertionOrder: Number(debate.id || 0)
    }))
    .sort((a, b) => {
      const aDate = a._episodeSortDate ? new Date(a._episodeSortDate).getTime() : 0;
      const bDate = b._episodeSortDate ? new Date(b._episodeSortDate).getTime() : 0;
      if (aDate !== bDate) return aDate - bDate;
      return a._episodeInsertionOrder - b._episodeInsertionOrder;
    });

  await Promise.all(orderedDebates.map((debate, index) => {
    const previous = orderedDebates[index - 1] || null;
    const next = orderedDebates[index + 1] || null;
    const nav = {
      previous_episode_id: previous ? previous.id : null,
      previous_episode_title: previous ? previous.question || "" : null,
      previous_episode_url: previous ? `/debate?id=${encodeURIComponent(previous.id)}` : null,
      next_episode_id: next ? next.id : null,
      next_episode_title: next ? next.question || "" : null,
      next_episode_url: next ? `/debate?id=${encodeURIComponent(next.id)}` : null
    };
    return supabase.from("debates").update({ episode_nav: nav }).eq("id", debate.id)
      .then(({ error: e }) => { if (e) console.error("[episode_nav sync]", debate.id, e.message); });
  }));

  for (const debate of orderedDebates) clearDebateDetailResponseCache(debate.id);
  clearDebatesApiResponseCache();
}



function setVeillePendingStorySelection(id, value) {
  const pendingId = String(id || "").trim();
  if (!pendingId) return;
  supabase.from("veille_pending").update({ pending_story_selection: value || null }).eq("id", Number(pendingId))
    .then(({ error }) => { if (error) console.error("[veille_pending stories sync]", pendingId, error.message); })
    .catch(() => {});
}

function clearVeillePendingStorySelection(id) {
  setVeillePendingStorySelection(id, null);
}



const DEFAULT_CLOUD_BUBBLES_KEY = "cloud_bubbles";
// Cache/refresh-promise indexés par storageKey ("cloud_bubbles", "cloud_bubbles_left",
// "cloud_bubbles_right", ...) pour que les 3 nuages (général/gauche/droite) ne se
// piétinent jamais en mémoire.
let _cloudBubblesCacheByKey = new Map();
let _cloudBubblesRefreshPromiseByKey = new Map();
// TTL du cache mémoire : les publications de veille peuvent être traitées par une
// autre instance (ex: pipeline local) qui réécrit app_config dans Supabase — sans
// expiration, cette instance servirait son vieux nuage jusqu'au prochain restart.
// Stale-while-revalidate : on sert le cache immédiatement, on relit Supabase en fond.
const CLOUD_BUBBLES_CACHE_TTL_MS = 60 * 1000;
let _cloudBubblesCacheFreshUntilByKey = new Map();

async function refreshCloudBubblesFromSupabase(storageKey = DEFAULT_CLOUD_BUBBLES_KEY) {
  if (_cloudBubblesRefreshPromiseByKey.has(storageKey)) return _cloudBubblesRefreshPromiseByKey.get(storageKey);
  const promise = (async () => {
    try {
      const { data, error } = await supabase
        .from("app_config")
        .select("value")
        .eq("key", storageKey)
        .maybeSingle();
      if (!error && data?.value && typeof data.value === "object") {
        _cloudBubblesCacheByKey.set(storageKey, data.value);
        _cloudBubblesCacheFreshUntilByKey.set(storageKey, Date.now() + CLOUD_BUBBLES_CACHE_TTL_MS);
      }
    } catch {}
  })().finally(() => {
    _cloudBubblesRefreshPromiseByKey.delete(storageKey);
  });
  _cloudBubblesRefreshPromiseByKey.set(storageKey, promise);
  return promise;
}

async function loadCloudBubbles(storageKey = DEFAULT_CLOUD_BUBBLES_KEY) {
  if (_cloudBubblesCacheByKey.has(storageKey)) {
    if (Date.now() >= (_cloudBubblesCacheFreshUntilByKey.get(storageKey) || 0)) {
      refreshCloudBubblesFromSupabase(storageKey).catch(() => {});
    }
    return _cloudBubblesCacheByKey.get(storageKey);
  }

  try {
    await refreshCloudBubblesFromSupabase(storageKey);
    if (_cloudBubblesCacheByKey.has(storageKey)) return _cloudBubblesCacheByKey.get(storageKey);
  } catch {}

  const empty = { bubbles: [], lastUpdatedAt: null };
  _cloudBubblesCacheByKey.set(storageKey, empty);
  return empty;
}

async function saveCloudBubbles(data, storageKey = DEFAULT_CLOUD_BUBBLES_KEY) {
  try {
    const safe = { bubbles: Array.isArray(data?.bubbles) ? data.bubbles : [], lastUpdatedAt: data?.lastUpdatedAt || null };
    const { error } = await supabase
      .from("app_config")
      .upsert({ key: storageKey, value: safe, updated_at: new Date().toISOString() });
    if (error) throw error;
    _cloudBubblesCacheByKey.set(storageKey, safe);
    _cloudBubblesCacheFreshUntilByKey.set(storageKey, Date.now() + CLOUD_BUBBLES_CACHE_TTL_MS);
  } catch (e) {
    console.error("[cloud-bubbles] save error:", e.message);
  }
}

async function syncCloudBubbleTagIfPresent(debateId) {
  const id = String(debateId || "").trim();
  if (!id) return;
  const data = await loadCloudBubbles();
  const idx = (data.bubbles || []).findIndex(b => String(b.subjectId) === id);
  if (idx < 0) return;
  const { data: row } = await supabase.from("debates").select("keywords, cloud_label").eq("id", id).maybeSingle();
  const newTag = getCloudLabelFromDebate(row || {});
  if (!newTag || newTag === data.bubbles[idx].tag) return;
  data.bubbles[idx] = { ...data.bubbles[idx], tag: newTag };
  await saveCloudBubbles(data);
}

const CLOUD_GENERIC_LABELS_SET = new Set([
  "actualite", "actualites", "politique", "international", "societe", "economie",
  "education", "justice", "culture", "medias", "sport", "sports", "sante",
  "climat", "environnement", "france", "monde", "europe", "debat", "debats",
  "information", "infos"
]);

function normalizeCloudLabel(tag) {
  return String(tag || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/#/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Libellé en cascade : cloud_label IA → premier keyword non générique.
function getCloudLabelFromDebate(debate) {
  const cloudLabel = String(debate?.cloud_label || "").trim();
  if (cloudLabel) return cloudLabel;

  const keywords = normalizeKeywordList(debate?.keywords || []);
  for (const keyword of keywords) {
    const normalized = normalizeCloudLabel(keyword);
    if (normalized.length >= 3 && !CLOUD_GENERIC_LABELS_SET.has(normalized)) {
      return String(keyword).replace(/#/g, "").replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

function normalizeCloudSourceName(value) {
  return String(value || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['']/g, " ")
    .replace(/[^a-z0-9\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCloudSourceUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function countCloudSources(debate) {
  const sources = new Set();
  (Array.isArray(debate?.media_extras) ? debate.media_extras : []).forEach((extra) => {
    if (!extra || typeof extra !== "object") return;
    if (String(extra.type || "source").trim() !== "source") return;
    const url = String(extra.url || extra.source_url || "").trim();
    const sourceName = normalizeCloudSourceName(extra.source || extra.media || extra.publisher || "");
    const sourceKey = sourceName || normalizeCloudSourceUrl(url);
    if (sourceKey) sources.add(sourceKey);
  });

  if (!sources.size && debate?.source_url) {
    const sourceKey = normalizeCloudSourceUrl(debate.source_url);
    if (sourceKey) sources.add(sourceKey);
  }

  return sources.size;
}

// Orientation d'un média ("left"/"right"/"neutral") — même règle que le front
// public (getOrientationGroupFromBotLabel) et que le bouton Classer de l'admin
// veille, pour que nuages, carousels et classement admin restent cohérents.
function getCloudOrientationGroupFromLabel(orientation) {
  const value = String(orientation || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (
    value.includes("gauche") ||
    value.includes("ecolog") ||
    value.includes("ecolo") ||
    value.includes("libertaire") ||
    value.includes("altermondialiste") ||
    value.includes("alter-mondialiste") ||
    value.includes("anticapitaliste") ||
    value.includes("anti-capitaliste") ||
    value.includes("socialiste") ||
    value.includes("social-democrate") ||
    value.includes("social democrate") ||
    value.includes("progressiste") ||
    value.includes("insoumis") ||
    value.includes("insoumission") ||
    value.includes("communiste") ||
    value.includes("marxiste") ||
    value.includes("feministe") ||
    value.includes("syndical") ||
    value.includes("alternatif") ||
    value.includes("alternative")
  ) return "left";
  if (
    value.includes("droite") ||
    value.includes("centre-droit") ||
    value.includes("centre droit") ||
    value.includes("droite-centre") ||
    value.includes("droite centre") ||
    value.includes("conservateur") ||
    value.includes("souverainiste") ||
    value.includes("liberal") ||
    value.includes("republicain") ||
    value.includes("identitaire")
  ) return "right";
  return "neutral";
}

function buildCloudMediaOrientationMaps() {
  const byDomain = new Map();
  const byName = new Map();
  for (const media of readVeilleMedias()) {
    const group = getCloudOrientationGroupFromLabel(media.orientation);
    if (group === "neutral") continue;
    if (media.domain && media.domain !== "youtube.com") byDomain.set(media.domain, group);
    const nameKey = normalizeCloudSourceName(media.nom);
    if (nameKey) byName.set(nameKey, group);
    const handleKey = normalizeCloudSourceName(media.handle || "");
    if (handleKey) byName.set(handleKey, group);
  }
  return { byDomain, byName };
}

function getCloudSourceOrientationGroup(name, url, orientationMaps) {
  const nameKey = normalizeCloudSourceName(name);
  if (nameKey) {
    if (orientationMaps.byName.has(nameKey)) return orientationMaps.byName.get(nameKey);
    for (const [known, group] of orientationMaps.byName) {
      if ((known.length >= 4 && nameKey.includes(known)) || (nameKey.length >= 4 && known.includes(nameKey))) return group;
    }
  }
  const hostname = normalizeCloudSourceUrl(url);
  if (hostname) {
    for (const [domain, group] of orientationMaps.byDomain) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) return group;
    }
  }
  return "neutral";
}

// Variante de countCloudSources restreinte à un camp : les nuages gauche/droite
// ne comptent que les sources de leur propre camp (poids ET éligibilité des
// bulles), contrairement au nuage général qui compte toutes les sources.
function countCloudSourcesForGroup(debate, politicalGroup, orientationMaps) {
  if (politicalGroup !== "left" && politicalGroup !== "right") return countCloudSources(debate);
  const sources = new Map();
  (Array.isArray(debate?.media_extras) ? debate.media_extras : []).forEach((extra) => {
    if (!extra || typeof extra !== "object") return;
    if (String(extra.type || "source").trim() !== "source") return;
    const url = String(extra.url || extra.source_url || "").trim();
    const rawName = String(extra.source || extra.media || extra.publisher || "").trim();
    const sourceKey = normalizeCloudSourceName(rawName) || normalizeCloudSourceUrl(url);
    if (sourceKey && !sources.has(sourceKey)) {
      sources.set(sourceKey, getCloudSourceOrientationGroup(rawName, url, orientationMaps));
    }
  });

  if (!sources.size && debate?.source_url) {
    const sourceKey = normalizeCloudSourceUrl(debate.source_url);
    if (sourceKey) sources.set(sourceKey, getCloudSourceOrientationGroup("", debate.source_url, orientationMaps));
  }

  let count = 0;
  sources.forEach((group) => { if (group === politicalGroup) count++; });
  return count;
}

// politicalGroup ("mixed" par défaut) sépare le nuage officiel en 3 pools indépendants
// (général / gauche / droite) sans dupliquer cette logique — cf. rebuildCloudBubbles()
// ci-dessous, conservé comme alias "mixed" pour ne rien changer aux appelants existants.
async function rebuildCloudBubblesForGroup(politicalGroup = "mixed") {
  const now = new Date().toISOString();
  const storageKey = politicalGroup === "mixed" ? "cloud_bubbles" : `cloud_bubbles_${politicalGroup}`;

  // Nuages gauche/droite : seules les sources du camp comptent — il faut la
  // liste veille_medias (orientations) avant de compter quoi que ce soit.
  if (politicalGroup !== "mixed" && veilleMediasCacheIsStale()) await _loadVeilleMediasFromSupabase();
  const orientationMaps = politicalGroup === "mixed" ? null : buildCloudMediaOrientationMaps();

  const { data: allDebates, error } = await supabase
    .from("debates")
    .select("id, question, source_url, media_extras, created_at, source_published_at, keywords, cloud_label, creator_key, political_group")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  // Masque les ancêtres explicitement cités par la tendance, sur toute la
  // profondeur de la chaîne (ex: 941→940→921 doit masquer 940 ET 921, même si 940
  // est lui-même ignoré avant d'avoir pu propager son propre lien). Chaque débat
  // peut citer PLUSIEURS ancêtres (matchedSubjectIds) : ne masquer que le plus
  // récent laissait l'autre prédécesseur affiché quand il appartenait à un autre
  // nuage (cf. doublon gauche 1972/2007 du 18/07/2026, 2007 ayant matché 1981 mixed
  // ET 1972 left). On ne fusionne jamais deux débats qui n'ont pas de lien
  // direct/transitif entre eux : des « cousins » reliés seulement par un ancêtre
  // commun lointain (ex: deux sujets sortis dans la même rafale de veille, jamais
  // comparés entre eux par l'IA) restent des bulles séparées — la fenêtre
  // anti-rafale (MIN_TREND_MATCH_GAP_MS) doit rester respectée, on ne la
  // contourne pas via un ancêtre partagé.
  const trendParents = new Map();
  for (const debate of (allDebates || [])) {
    const trend = getDebateTrend(debate.id);
    const parentIds = (Array.isArray(trend?.matchedSubjectIds) && trend.matchedSubjectIds.length
      ? trend.matchedSubjectIds
      : (trend?.matchedSubjectId ? [trend.matchedSubjectId] : []))
      .map((id) => String(id));
    if (parentIds.length) trendParents.set(String(debate.id), parentIds);
  }

  const hiddenAncestors = new Set();
  for (const startId of trendParents.keys()) {
    const visited = new Set([startId]);
    const queue = [...trendParents.get(startId)];
    while (queue.length) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      hiddenAncestors.add(current);
      visited.add(current);
      queue.push(...(trendParents.get(current) || []));
    }
  }

  const seenTags = new Set();
  const seenSharedSpaces = new Set();
  const candidates = [];
  for (const debate of (allDebates || [])) {
    const id = String(debate.id);
    if (hiddenAncestors.has(id)) continue;
    // Bulles Actu = arènes officielles uniquement ; les arènes communauté (ex: Certamen)
    // ont leur propre nuage côté client (Bulles Mnoria). political_group sépare en plus
    // le pool officiel en 3 nuages indépendants (général / gauche / droite).
    if (debate.creator_key !== MNORIA_ADMIN_CREATOR_KEY) continue;
    if ((debate.political_group || "mixed") !== politicalGroup) continue;

    // Arènes fusionnées (espace partagé) : une seule bulle par espace, la plus
    // récente (le tri est décroissant). Filet déterministe indépendant du match de
    // tendance — deux cartes du même espace posent la même question par définition
    // de la fusion, elles ne doivent jamais coexister dans un nuage.
    const sharedCanonicalId = resolveSharedDebateId(id) || id;
    if (seenSharedSpaces.has(sharedCanonicalId)) continue;

    const label = getCloudLabelFromDebate(debate);
    if (!label) continue;
    const sourceCount = countCloudSourcesForGroup(debate, politicalGroup, orientationMaps);
    if (sourceCount <= 0) continue;
    const normTag = normalizeTag(label);
    if (seenTags.has(normTag)) continue;

    seenTags.add(normTag);
    seenSharedSpaces.add(sharedCanonicalId);
    const debateDate = debate.source_published_at || debate.created_at || now;
    const trendEntry = getDebateTrend(debate.id);
    candidates.push({
      tag: label,
      subjectId: id,
      count: sourceCount,
      debateDate,
      trend: Number(trendEntry?.trend ?? 0),
      enteredCloudAt: now
    });
    if (candidates.length >= 10) break;
  }

  let bubbles = candidates;
  const added = candidates.length;
  const updated = 0;

  const ids = bubbles.map(b => b.subjectId).filter(Boolean);
  const debateMap = new Map();
  if (ids.length) {
    const { data: currentDebates, error: currentError } = await supabase
      .from("debates")
      .select("id, source_url, media_extras, created_at, source_published_at, keywords, cloud_label")
      .in("id", ids);
    if (currentError) throw new Error(currentError.message);
    for (const debate of (currentDebates || [])) debateMap.set(String(debate.id), debate);
  }

  bubbles = bubbles
    .map((bubble) => {
      const debate = debateMap.get(String(bubble.subjectId));
      const refreshedCount = debate ? countCloudSourcesForGroup(debate, politicalGroup, orientationMaps) : Number(bubble.count || 0);
      const tag = (debate ? getCloudLabelFromDebate(debate) : "") || bubble.tag;
      return {
        tag,
        subjectId: String(bubble.subjectId),
        count: refreshedCount,
        debateDate: debate ? (debate.source_published_at || debate.created_at || bubble.debateDate || null) : (bubble.debateDate || null),
        trend: Number(getDebateTrend(bubble.subjectId)?.trend ?? bubble.trend ?? 0),
        enteredCloudAt: bubble.enteredCloudAt || now
      };
    })
    .filter(bubble => bubble.tag && bubble.subjectId && bubble.count > 0)
    .slice(-10);

  const maxCount = bubbles.reduce((max, bubble) => Math.max(max, bubble.count || 0), 0);
  bubbles = bubbles.map((bubble) => ({
    ...bubble,
    sizeWeight: maxCount > 0 ? bubble.count / maxCount : 0
  }));

  const newData = { bubbles, lastUpdatedAt: new Date().toISOString() };
  await saveCloudBubbles(newData, storageKey);

  return { ok: true, count: bubbles.length, newAdded: added, updated, updatedAt: newData.lastUpdatedAt };
}

// Alias conservé pour ne rien changer aux appelants existants (toujours le pool "mixed").
const rebuildCloudBubbles = () => rebuildCloudBubblesForGroup("mixed");

async function rebuildCloudBubblesAfterPublish(reason, debateId = null, politicalGroup = "mixed") {
  try {
    return await rebuildCloudBubblesForGroup(politicalGroup);
  } catch (error) {
    console.error("[cloud-bubbles] auto update failed", {
      reason,
      debateId: debateId ? String(debateId) : null,
      error: error.message
    });
    return null;
  }
}

function setVeillePendingKeywords(id, keywords) {
  const pendingId = String(id || "").trim();
  if (!pendingId) return;
  const normalized = normalizeKeywordList(keywords, 10, 60);
  supabase.from("veille_pending").update({ pending_keywords: normalized }).eq("id", Number(pendingId))
    .then(({ error }) => { if (error) console.error("[veille_pending keywords sync]", pendingId, error.message); })
    .catch(() => {});
}

function clearVeillePendingKeywords(id) {
  setVeillePendingKeywords(id, []);
}


function writeTagExclusionFiles(tags) {
  const normalizedTags = normalizeExcludedTags(tags);
  fs.mkdirSync(path.dirname(publicTagExclusionsMetaPath), { recursive: true });
  fs.writeFileSync(publicTagExclusionsMetaPath, JSON.stringify(normalizedTags, null, 2), "utf8");
  replaceExcludedTags(normalizedTags);
  supabase.from("app_config")
    .upsert({ key: "tag_exclusions", value: normalizedTags, updated_at: new Date().toISOString() })
    .then(({ error }) => { if (error) console.error("[tag_exclusions] save error:", error.message); })
    .catch(() => {});
  return getExcludedTags();
}

function readTagExclusionsForAdmin() {
  try {
    if (fs.existsSync(publicTagExclusionsMetaPath)) {
      const parsed = JSON.parse(fs.readFileSync(publicTagExclusionsMetaPath, "utf8") || "[]");
      return normalizeExcludedTags(parsed);
    }
  } catch (error) {
    console.error("Erreur lecture exclusions tags:", error);
  }
  return getExcludedTags();
}


async function setDebateKeywords(debateId, keywords) {
  const debateKey = String(debateId || "").trim();
  if (!debateKey) return [];
  const normalized = normalizeKeywordList(keywords, 10, 60);
  const { error } = await supabase.from("debates").update({ keywords: normalized }).eq("id", debateKey);
  if (error) console.error("[keywords sync]", debateKey, error.message);
  return normalized;
}

async function removeDebateKeyword(debateId, keyword) {
  const debateKey = String(debateId || "").trim();
  const keywordKey = normalizeTag(keyword);
  if (!debateKey || !keywordKey) return [];
  const { data: row } = await supabase.from("debates").select("keywords").eq("id", debateKey).maybeSingle();
  const current = normalizeKeywordList(row?.keywords || [], 10, 60);
  const next = current.filter((item) => normalizeTag(item) !== keywordKey);
  return setDebateKeywords(debateKey, next);
}

let _debateTrendsCache = null;

function readDebateTrendsMap() { return _debateTrendsCache || {}; }

// Un blob JSON global (app_config, clé "debate_trends") était réécrit EN ENTIER
// (~125 Ko) à chaque nouveau débat — identifié comme la plus grosse charge POST
// REST lors de l'audit egress du 18/08/2026. La tendance vit maintenant sur la
// colonne debates.trend_data (une ligne par débat, cf.
// data/migration-debate-trends-column.sql) ; ce cache mémoire reste nécessaire
// car getDebateTrend() est appelé sur le chemin chaud d'enrichissement des
// débats (enrichDebateWithStoredImage), sans quoi chaque lecture de débat
// déclencherait sa propre requête Supabase.
async function initDebateTrendsCache(retryDelayMs = 30 * 1000) {
  try {
    const { data, error } = await fetchAllSupabaseRows(() =>
      supabase.from("debates").select("id, trend_data").not("trend_data", "is", null));
    if (error) throw error;
    const map = {};
    for (const row of (data || [])) map[String(row.id)] = row.trend_data;
    _debateTrendsCache = map;
  } catch (e) {
    // Ex: déploiement survenu pendant un blocage Supabase (quota egress dépassé,
    // cf. audit du 18/08/2026) — un échec au boot ne doit pas laisser le cache
    // vide pour toute la durée de vie du process. Backoff plafonné à 10 min.
    console.error("[debate-trends] init error, retry dans", Math.round(retryDelayMs / 1000), "s :", e.message);
    setTimeout(() => {
      initDebateTrendsCache(Math.min(retryDelayMs * 2, 10 * 60 * 1000)).catch(() => {});
    }, retryDelayMs).unref();
  }
}

function setDebateTrend(debateId, trendData) {
  const key = String(debateId || "").trim();
  if (!key) return;
  const entry = { ...trendData, computedAt: new Date().toISOString() };
  _debateTrendsCache = { ...readDebateTrendsMap(), [key]: entry };
  supabase.from("debates").update({ trend_data: entry }).eq("id", key)
    .then(({ error }) => { if (error) console.error("[debate-trends] save error:", key, error.message); });
}

function getDebateTrend(debateId) {
  const key = String(debateId || "").trim();
  if (!key) return null;
  return readDebateTrendsMap()[key] ?? null;
}

function normalizeStorySelection(value) {
  if (!value || typeof value !== "object") return null;
  const selectionMode = String(value.selectionMode || "").trim();
  const storyDecision = String(value.storyDecision || "").trim();
  if (!selectionMode || !storyDecision) return null;

  const normalized = {
    selectionMode,
    storyDecision,
    matchedStoryId: String(value.matchedStoryId || "").trim() || null,
    matchedStoryTitle: String(value.matchedStoryTitle || "").trim() || null,
    previousEpisodeTitle: String(value.previousEpisodeTitle || "").trim() || null,
    previousEpisodeUrl: String(value.previousEpisodeUrl || "").trim() || null,
    confidence: Number.isFinite(Number(value.confidence)) ? Number(value.confidence) : 0,
    reason: String(value.reason || "").trim(),
    criteria: value.criteria && typeof value.criteria === "object" ? value.criteria : {}
  };

  if (selectionMode === "new" && value.newStory && typeof value.newStory === "object") {
    normalized.newStory = {
      story_title: String(value.newStory.story_title || "").trim(),
      main_actors: Array.isArray(value.newStory.main_actors) ? value.newStory.main_actors.map((item) => String(item || "").trim()).filter(Boolean) : [],
      central_tension: String(value.newStory.central_tension || "").trim(),
      keywords: Array.isArray(value.newStory.keywords) ? value.newStory.keywords.map((item) => String(item || "").trim()).filter(Boolean) : [],
      status: "active"
    };
  }

  return normalized;
}

async function saveStoryForDebateSelection(selection, debatePayload) {
  const normalized = normalizeStorySelection(selection);
  if (!normalized) return null;

  const now = nowIso();
  const debateId = String(debatePayload?.debateId || "").trim() || null;
  const latestTitle = String(debatePayload?.question || "").trim();

  if (normalized.selectionMode === "existing" && normalized.matchedStoryId) {
    const { data: story, error } = await supabase.from("stories").select("*").eq("story_id", normalized.matchedStoryId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!story) throw new Error("Histoire existante introuvable au moment de la publication.");

    const updates = { updated_at: now };
    if (debateId && !story.first_episode_id) updates.first_episode_id = debateId;
    if (debateId) updates.latest_episode_id = debateId;
    if (latestTitle) updates.latest_episode_title = latestTitle;
    await supabase.from("stories").update(updates).eq("story_id", normalized.matchedStoryId);
    return { ...story, ...updates };
  }

  if (normalized.selectionMode === "new" && normalized.newStory) {
    const story = {
      story_id: createStoryId(normalized.newStory.story_title || latestTitle || "story"),
      story_title: normalized.newStory.story_title,
      main_actors: normalized.newStory.main_actors || [],
      central_tension: normalized.newStory.central_tension || "",
      keywords: normalized.newStory.keywords || [],
      status: "active",
      created_at: now,
      updated_at: now,
      first_episode_id: debateId,
      latest_episode_id: debateId,
      latest_episode_title: latestTitle
    };
    return upsertStory(story);
  }

  return null;
}


function getImageExtensionFromMimeType(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  return "";
}

function getVideoExtensionFromMimeType(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized === "video/mp4") return "mp4";
  if (normalized === "video/webm") return "webm";
  if (normalized === "video/quicktime") return "mov";
  if (normalized === "video/x-m4v") return "m4v";
  return "";
}

function getVideoExtensionFromFilename(filename) {
  const extension = path.extname(String(filename || "")).toLowerCase().replace(/^\./, "");
  return ["mp4", "webm", "mov", "m4v"].includes(extension) ? extension : "";
}

function getVideoMimeTypeFromExtension(extension) {
  switch (String(extension || "").toLowerCase()) {
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "m4v":
      return "video/x-m4v";
    default:
      return "application/octet-stream";
  }
}

// Chrome/Firefox/Edge ne savent pas lire "video/quicktime" (.mov) dans une balise <video>,
// seul Safari le supporte nativement. Le conteneur QuickTime est assez proche de l'ISOBMFF/MP4
// pour qu'un .mov H.264/AAC (format par défaut des exports iPhone) reste lisible une fois
// stocké et servi en tant que .mp4 / video/mp4, sans ré-encodage. On ne touche donc qu'au
// stockage des nouveaux imports, pas à la détection d'extension des fichiers déjà en place.
function normalizeVideoStorageExtension(extension) {
  return String(extension || "").toLowerCase() === "mov" ? "mp4" : extension;
}

function deleteLocalMediaFile(publicUrl, allowedDir) {
  const normalizedUrl = String(publicUrl || "").trim();
  if (!normalizedUrl || !normalizedUrl.startsWith("/")) return;

  const relativePath = normalizedUrl.replace(/^\/+/, "");
  const absolutePath = path.resolve(__dirname, "public", relativePath);
  const allowedPath = path.resolve(allowedDir);

  if (!absolutePath.startsWith(allowedPath + path.sep)) {
    return;
  }

  try {
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  } catch (error) {
    console.error("Erreur suppression fichier média local:", error);
  }
}

function buildDebateMediaStoragePath(debateId, kind, extension) {
  const safeKind = kind === "video" ? "video" : "image";
  const safeExtension = String(extension || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return `debates/${debateId}/${safeKind}-${Date.now()}.${safeExtension}`;
}

function getStoragePublicUrl(bucketName, objectPath) {
  const { data } = supabase.storage.from(bucketName).getPublicUrl(objectPath);
  return String(data?.publicUrl || "").trim();
}

function getDebateDbMediaUrl(debate, key) {
  if (!debate || typeof debate !== "object") return "";
  return String(debate[key] || "").trim();
}

function getResolvedDebateImageUrl(debate) {
  return getDebateDbMediaUrl(debate, "image_url");
}

function getResolvedDebateVideoUrl(debate) {
  return getDebateDbMediaUrl(debate, "video_url");
}

function isStoragePublicUrl(publicUrl) {
  const normalized = String(publicUrl || "").trim();
  if (!normalized) return false;
  return normalized.includes(`/storage/v1/object/public/${SUPABASE_DEBATE_MEDIA_BUCKET}/`);
}

function getStorageObjectPathFromPublicUrl(publicUrl) {
  const normalized = String(publicUrl || "").trim();
  if (!normalized) return "";

  const marker = `/storage/v1/object/public/${SUPABASE_DEBATE_MEDIA_BUCKET}/`;
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) return "";

  const rawPath = normalized.slice(markerIndex + marker.length).split("?")[0].replace(/^\/+/, "");
  return rawPath;
}

async function deleteStoredMediaAsset(publicUrl, allowedDir) {
  const normalized = String(publicUrl || "").trim();
  if (!normalized) return;

  if (normalized.startsWith("/")) {
    deleteLocalMediaFile(normalized, allowedDir);
    return;
  }

  if (!isStoragePublicUrl(normalized)) {
    return;
  }

  const objectPath = getStorageObjectPathFromPublicUrl(normalized);
  if (!objectPath) return;

  const { error } = await supabase.storage
    .from(SUPABASE_DEBATE_MEDIA_BUCKET)
    .remove([objectPath]);

  if (error) {
    console.error("Erreur suppression média Supabase Storage:", error);
  }
}

async function storageObjectExists(objectPath) {
  const normalizedPath = String(objectPath || "").trim().replace(/^\/+/, "");
  if (!normalizedPath) return false;

  const pathParts = normalizedPath.split("/").filter(Boolean);
  if (!pathParts.length) return false;

  const fileName = pathParts.pop();
  const folderPath = pathParts.join("/");

  const { data, error } = await supabase.storage
    .from(SUPABASE_DEBATE_MEDIA_BUCKET)
    .list(folderPath, {
      limit: 100,
      search: fileName
    });

  if (error) {
    console.error("Erreur vérification objet Supabase Storage:", error);
    return false;
  }

  return Array.isArray(data) && data.some((item) => String(item?.name || "") === fileName);
}

async function persistDebateMediaUrls(debateId, media = {}) {
  const imageUrl = String(media.image_url || "").trim();
  const videoUrl = String(media.video_url || "").trim();

  const { error } = await supabase
    .from("debates")
    .update({ image_url: imageUrl, video_url: videoUrl })
    .eq("id", debateId);

  if (error) throw error;
}

// Photos envoyées telles quelles depuis le navigateur (souvent 3-15 Mo pour
// une photo de téléphone) : sans retraitement, chaque page qui affiche cette
// image la sert en pleine résolution à chaque visiteur — gros contributeur à
// l'egress Supabase Storage (~300 Mo/jour mesurés le 20/07/2026, cf. discussion
// Autres actus). Redimensionne à 1600px de large max (largeur d'affichage la
// plus grande côté front, cf. hero/lightbox débat) et recompresse. Le GIF est
// laissé tel quel : sharp ne préserverait pas forcément l'animation sans un
// traitement dédié, et le gain de recompression sur GIF est de toute façon
// marginal (codec déjà peu efficace).
const DEBATE_IMAGE_MAX_WIDTH = 1600;
async function compressDebateImageBuffer(buffer, mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized === "image/gif") return buffer;
  try {
    const resized = sharp(buffer, { failOn: "none" }).rotate().resize({
      width: DEBATE_IMAGE_MAX_WIDTH,
      withoutEnlargement: true
    });
    if (normalized === "image/png") {
      return await resized.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    }
    if (normalized === "image/webp") {
      return await resized.webp({ quality: 78 }).toBuffer();
    }
    return await resized.jpeg({ quality: 78, mozjpeg: true }).toBuffer();
  } catch (error) {
    console.error("Erreur compression image:", error);
    return buffer;
  }
}

// Chemin de stockage horodaté (buildDebateMediaStoragePath) donc jamais réutilisé
// pour un contenu différent (upsert:false) : un cache long côté navigateur/CDN est
// sûr, une nouvelle image obtient toujours une nouvelle URL plutôt que d'écraser
// l'ancienne (cf. discussion egress du 20/07/2026).
const DEBATE_MEDIA_CACHE_CONTROL = "31536000";

async function saveUploadedDebateImage(debateId, imageUpload, options = {}) {
  const dataUrl = String(imageUpload?.dataUrl || "").trim();
  const mimeType = String(imageUpload?.type || "").trim().toLowerCase();
  const extension = getImageExtensionFromMimeType(mimeType);

  if (!dataUrl || !extension) {
    throw new Error("Image invalide.");
  }

  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Format d'image invalide.");
  }

  if (String(match[1]).toLowerCase() !== mimeType) {
    throw new Error("Type d'image incohérent.");
  }

  const rawBuffer = Buffer.from(match[2], "base64");
  if (!rawBuffer.length) {
    throw new Error("Image vide.");
  }
  const buffer = await compressDebateImageBuffer(rawBuffer, mimeType);

  const previousImageUrl = String(options.previousImageUrl || "").trim();
  const objectPath = buildDebateMediaStoragePath(debateId, "image", extension);

  const { error } = await supabase.storage
    .from(SUPABASE_DEBATE_MEDIA_BUCKET)
    .upload(objectPath, buffer, {
      contentType: mimeType,
      cacheControl: DEBATE_MEDIA_CACHE_CONTROL,
      upsert: false
    });

  if (error) {
    console.error("Erreur upload image Supabase Storage:", error);
    throw new Error("Erreur enregistrement image.");
  }

  const publicUrl = getStoragePublicUrl(SUPABASE_DEBATE_MEDIA_BUCKET, objectPath);
  if (!publicUrl) {
    throw new Error("Erreur enregistrement image.");
  }

  if (previousImageUrl) {
    await deleteStoredMediaAsset(previousImageUrl, debateImagesDir);
  }

  return publicUrl;
}

async function saveUploadedDebateVideo(debateId, buffer, fileName, mimeType, options = {}) {
  const safeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!safeBuffer.length) {
    throw new Error("Vidéo vide.");
  }

  if (safeBuffer.length > MAX_DEBATE_VIDEO_BYTES) {
    throw new Error("Vidéo trop lourde.");
  }

  const normalizedType = String(mimeType || "").trim().toLowerCase();
  const detectedExtension = getVideoExtensionFromMimeType(normalizedType) || getVideoExtensionFromFilename(fileName);

  if (!detectedExtension) {
    throw new Error("Format vidéo non pris en charge.");
  }

  const extension = normalizeVideoStorageExtension(detectedExtension);

  const previousVideoUrl = String(options.previousVideoUrl || "").trim();
  const objectPath = buildDebateMediaStoragePath(debateId, "video", extension);

  const { error } = await supabase.storage
    .from(SUPABASE_DEBATE_MEDIA_BUCKET)
    .upload(objectPath, safeBuffer, {
      contentType: getVideoMimeTypeFromExtension(extension),
      cacheControl: DEBATE_MEDIA_CACHE_CONTROL,
      upsert: false
    });

  if (error) {
    console.error("Erreur upload vidéo Supabase Storage:", error);
    throw new Error("Erreur enregistrement vidéo.");
  }

  const publicUrl = getStoragePublicUrl(SUPABASE_DEBATE_MEDIA_BUCKET, objectPath);
  if (!publicUrl) {
    throw new Error("Erreur enregistrement vidéo.");
  }

  if (previousVideoUrl) {
    await deleteStoredMediaAsset(previousVideoUrl, debateVideosDir);
  }

  return {
    url: publicUrl,
    mimeType: getVideoMimeTypeFromExtension(extension)
  };
}

function enrichDebateWithStoredImage(debate) {
  if (!debate) return debate;
  const resolvedContent = normalizeDebateContent(debate.content || "");
  const episodeNav = debate?.episode_nav && typeof debate.episode_nav === "object" ? debate.episode_nav : {};
  const trendData = getDebateTrend(debate?.id);
  const trendScore = trendData !== null ? (trendData.trend ?? 0) : 0;

  return {
    ...debate,
    image_url: getResolvedDebateImageUrl(debate),
    video_url: getResolvedDebateVideoUrl(debate),
    content: resolvedContent,
    keywords: Array.isArray(debate?.keywords) ? debate.keywords : [],
    story_id: debate?.story_id || null,
    trend: trendScore,
    previous_episode_id: episodeNav.previous_episode_id || null,
    previous_episode_title: episodeNav.previous_episode_title || null,
    previous_episode_url: episodeNav.previous_episode_url || null,
    next_episode_id: episodeNav.next_episode_id || null,
    next_episode_title: episodeNav.next_episode_title || null,
    next_episode_url: episodeNav.next_episode_url || null
  };
}

// Sécurité C1 : creator_key / author_key sont des "clés-mots de passe" qui servent
// à autoriser les suppressions/éditions. Elles ne doivent jamais quitter le serveur.
// Ces helpers les retirent des réponses publiques et les remplacent par des booléens
// calculés côté serveur (jamais à partir d'une valeur fournie par le client).
function getRequestClientKey(req) {
  return String(req?.query?.key || req?.query?.voterKey || "").trim();
}

function sanitizeDebateForClient(debate, clientKey, isAdminRequest = false) {
  if (!debate) return debate;
  const { creator_key, ...rest } = debate;
  const normalizedClientKey = clientKey ? String(clientKey) : "";
  // Pour les arènes officielles (creator_key = MNORIA_ADMIN_CREATOR_KEY), aucune
  // clé de navigateur ne correspondra jamais : seul un token admin valide
  // permet d'être reconnu comme "propriétaire" de ce type d'arène.
  const isOwner = !!(normalizedClientKey && creator_key && String(creator_key) === normalizedClientKey)
    || !!(isAdminRequest && creator_key === MNORIA_ADMIN_CREATOR_KEY);
  return {
    ...rest,
    // Barème caché par le créateur : le texte ne doit jamais être exposé aux
    // autres clients, mais le créateur doit pouvoir le consulter lui-même.
    ...(rest.evaluation_axis_hidden && !isOwner ? { evaluation_axis: "" } : {}),
    is_owner: isOwner,
    is_official: creator_key === MNORIA_ADMIN_CREATOR_KEY,
    is_community: !!creator_key && creator_key !== MNORIA_ADMIN_CREATOR_KEY
  };
}

function sanitizeArgumentForClient(argument, clientKey) {
  if (!argument) return argument;
  const { author_key, ...rest } = argument;
  const normalizedClientKey = clientKey ? String(clientKey) : "";
  return {
    ...rest,
    is_owner: !!(normalizedClientKey && author_key && String(author_key) === normalizedClientKey)
  };
}

function sanitizeCommentForClient(comment, clientKey) {
  if (!comment) return comment;
  const { author_key, ...rest } = comment;
  const normalizedClientKey = clientKey ? String(clientKey) : "";
  return {
    ...rest,
    is_owner: !!(normalizedClientKey && author_key && String(author_key) === normalizedClientKey)
  };
}

function sanitizeDebateDetailPayload(payload, clientKey, isAdminRequest = false) {
  if (!payload) return payload;
  const sanitizedCommentsByArgument = {};
  for (const [argumentId, comments] of Object.entries(payload.commentsByArgument || {})) {
    sanitizedCommentsByArgument[argumentId] = (comments || []).map((c) => sanitizeCommentForClient(c, clientKey));
  }
  return {
    ...payload,
    debate: sanitizeDebateForClient(payload.debate, clientKey, isAdminRequest),
    optionA: (payload.optionA || []).map((a) => sanitizeArgumentForClient(a, clientKey)),
    optionB: (payload.optionB || []).map((a) => sanitizeArgumentForClient(a, clientKey)),
    commentsByArgument: sanitizedCommentsByArgument
  };
}

function walkStructuredData(node, bucket = []) {
  if (!node) return bucket;
  if (Array.isArray(node)) {
    node.forEach((item) => walkStructuredData(item, bucket));
    return bucket;
  }
  if (typeof node === "object") {
    bucket.push(node);
    for (const value of Object.values(node)) {
      walkStructuredData(value, bucket);
    }
  }
  return bucket;
}

function extractJsonLdObjects(html) {
  const blocks = [];
  const regex = /<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const raw = String(match[1] || "").trim();
    if (!raw) continue;
    const parsed = safeJsonParse(raw);
    if (parsed) {
      walkStructuredData(parsed, blocks);
    }
  }

  return blocks;
}

function pickStructuredValue(objects, keys) {
  const wanted = keys.map((key) => String(key || "").toLowerCase());

  for (const obj of objects) {
    if (!obj || typeof obj !== "object") continue;

    for (const [key, value] of Object.entries(obj)) {
      if (!wanted.includes(String(key).toLowerCase())) continue;

      if (typeof value === "string") {
        const cleaned = cleanPreviewText(value, 500);
        if (cleaned) return cleaned;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") {
            const cleaned = cleanPreviewText(item, 500);
            if (cleaned) return cleaned;
          }
          if (item && typeof item === "object") {
            const nested = pickStructuredValue([item], ["url", "contentUrl", "thumbnailUrl", "name", "headline"]);
            if (nested) return nested;
          }
        }
      }

      if (value && typeof value === "object") {
        const nested = pickStructuredValue([value], ["url", "contentUrl", "thumbnailUrl", "name", "headline"]);
        if (nested) return nested;
      }
    }
  }

  return "";
}


function extractHeadingTagContent(html) {
  const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match?.[1]) {
    return cleanPreviewText(stripHtmlTags(h1Match[1]), 500);
  }

  const h2Match = html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  if (h2Match?.[1]) {
    return cleanPreviewText(stripHtmlTags(h2Match[1]), 500);
  }

  return "";
}

function extractJsonLikeValueFromScripts(html, keys, maxLength = 500) {
  const scripts = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || [];
  const wanted = keys
    .map((key) => String(key || "").trim())
    .filter(Boolean)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  if (!wanted.length) return "";

  const valuePatterns = [
    new RegExp(`(?:"|')(${wanted.join('|')})(?:"|')\\s*:\\s*(?:"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"|'([^'\\\\]*(?:\\\\.[^'\\\\]*)*)')`, 'i'),
    new RegExp(`(?:"|')(${wanted.join('|')})(?:"|')\\s*:\\s*\{[^}]*?(?:"|')url(?:"|')\\s*:\\s*(?:"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"|'([^'\\\\]*(?:\\\\.[^'\\\\]*)*)')`, 'i')
  ];

  for (const scriptTag of scripts) {
    for (const pattern of valuePatterns) {
      const match = scriptTag.match(pattern);
      const rawValue = match?.[2] || match?.[3] || match?.[4] || match?.[5] || "";
      const cleaned = cleanPreviewText(rawValue, maxLength);
      if (cleaned) return cleaned;
    }
  }

  return "";
}

function parseVideoDurationSeconds(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return 0;

  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const seconds = Math.round(Number(value));
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  }

  const isoMatch = value.match(/^P(?:([0-9]+)D)?(?:T(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+(?:\.[0-9]+)?)S)?)?$/i);
  if (!isoMatch) return 0;
  const seconds = Math.round(
    Number(isoMatch[1] || 0) * 86400 +
    Number(isoMatch[2] || 0) * 3600 +
    Number(isoMatch[3] || 0) * 60 +
    Number(isoMatch[4] || 0)
  );
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

function extractRawImageUrlsFromHtml(html, baseUrl) {
  const urlPattern = /https?:\/\/[^"'\s<>]+?(?:jpe?g|png|webp|avif)(?:\?[^"'\s<>]*)?/gi;
  const found = html.match(urlPattern) || [];
  const candidates = [];

  for (const rawUrl of found) {
    const resolved = resolvePreviewUrl(rawUrl, baseUrl);
    const score = scorePreviewImageCandidate(resolved);
    if (score >= 0) {
      candidates.push({ url: resolved, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.url || "";
}

function stripHtmlTags(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function scorePreviewImageCandidate(url) {
  const value = String(url || "").trim().toLowerCase();
  if (!value) return -1;
  if (!/^https?:\/\//.test(value) && !value.startsWith("//") && !value.startsWith("/")) return -1;

  let score = 0;
  if (/\.(jpe?g|png|webp|avif)(?:$|[?#])/.test(value)) score += 4;
  if (/upload|media|image|img|photo|visuel|illustration|article/.test(value)) score += 3;
  if (/logo|icon|avatar|sprite|ads|pub|banner|placeholder|amphtml|apple-touch/.test(value)) score -= 6;
  if (/\.svg(?:$|[?#])/.test(value)) score -= 5;
  return score;
}

function extractBestImageFromHtml(html, baseUrl) {
  const imgRegex = /<img\b[^>]*>/gi;
  const candidates = [];
  let match;

  while ((match = imgRegex.exec(html)) !== null) {
    const tag = match[0];
    const attrs = {};
    const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g;
    let attrMatch;

    while ((attrMatch = attrRegex.exec(tag)) !== null) {
      const key = String(attrMatch[1] || "").toLowerCase();
      const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
      attrs[key] = value;
    }

    const raw = attrs.src || attrs["data-src"] || attrs["data-lazy-src"] || attrs["data-original"] || attrs["data-url"] || attrs["srcset"] || attrs["data-srcset"] || "";
    if (!raw) continue;

    let selected = String(raw).split(",")[0].trim().split(/\s+/)[0].trim();
    if (!selected) continue;

    const resolved = resolvePreviewUrl(selected, baseUrl);
    const score = scorePreviewImageCandidate(resolved);
    if (score < 0) continue;

    const width = Number(attrs.width || 0);
    const height = Number(attrs.height || 0);
    const areaBonus = width >= 300 || height >= 150 ? 2 : 0;
    candidates.push({ url: resolved, score: score + areaBonus });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.url || "";
}

function extractBodyTextSummary(html) {
  const paragraphRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  const candidates = [];
  let match;

  while ((match = paragraphRegex.exec(html)) !== null) {
    const text = cleanPreviewText(stripHtmlTags(match[1] || ""), 420);
    if (!text) continue;
    if (text.length < 80) continue;
    if (/cookies|publicité|newsletter|inscrivez-vous|javascript|abonnez-vous|se connecter/i.test(text)) continue;
    candidates.push(text);
    if (candidates.length >= 8) break;
  }

  return candidates[0] || "";
}

function buildPreviewFromHtml(html, requestedUrl, finalUrl) {
  const metaTags = parseMetaTags(html);
  const jsonLdObjects = extractJsonLdObjects(html);
  const baseUrl = finalUrl || requestedUrl;
  const domain = (() => {
    try {
      return new URL(baseUrl).hostname.replace(/^www\./, "").toLowerCase();
    } catch (error) {
      return "";
    }
  })();

  const canonicalUrl = resolvePreviewUrl(
    getFirstMetaValue(metaTags, ["og:url"]) || extractLinkHref(html, "canonical"),
    baseUrl
  );

  const title = cleanPreviewText(
    getFirstMetaValue(metaTags, ["og:title", "twitter:title"]) ||
      pickStructuredValue(jsonLdObjects, ["headline", "name"]) ||
      extractJsonLikeValueFromScripts(html, ["headline", "title", "name", "seoTitle"], 500) ||
      extractHeadingTagContent(html) ||
      extractTitleTagContent(html) ||
      domain,
    500
  );

  const description = cleanPreviewText(
    getFirstMetaValue(metaTags, ["og:description", "twitter:description", "description"]) ||
      pickStructuredValue(jsonLdObjects, ["description", "abstract"]) ||
      extractJsonLikeValueFromScripts(html, ["description", "seoDescription", "summary", "excerpt", "standfirst"], 500) ||
      extractBodyTextSummary(html),
    500
  );

  const rawImage =
    getFirstMetaValue(metaTags, [
      "og:image:secure_url",
      "og:image:url",
      "og:image",
      "twitter:image:src",
      "twitter:image",
      "image",
      "thumbnail",
      "thumbnailurl"
    ]) ||
    pickStructuredValue(jsonLdObjects, ["image", "thumbnailUrl", "url", "contentUrl"]) ||
    extractJsonLikeValueFromScripts(html, ["image", "imageUrl", "thumbnailUrl", "heroImage", "coverImage", "socialImage", "src", "url"], 1000) ||
    extractBestImageFromHtml(html, baseUrl) ||
    extractRawImageUrlsFromHtml(html, baseUrl);

  const image = resolvePreviewUrl(rawImage, baseUrl);

  const siteName = cleanPreviewText(
    getFirstMetaValue(metaTags, ["og:site_name", "application-name", "twitter:site"]) ||
      pickStructuredValue(jsonLdObjects, ["publisher", "provider", "sourceOrganization"]) ||
      extractJsonLikeValueFromScripts(html, ["publisher", "siteName", "brand", "provider", "source"], 160) ||
      domain,
    160
  );

  const isYouTubeDomain = domain === "youtube.com" || domain === "youtu.be";
  const videoDurationSeconds = isYouTubeDomain
    ? parseVideoDurationSeconds(
        extractJsonLikeValueFromScripts(html, ["lengthSeconds"], 20) ||
        pickStructuredValue(jsonLdObjects, ["duration"])
      )
    : 0;

  // Sur YouTube, "author"/"creator" en JSON-LD désigne souvent l'auteur d'un
  // commentaire (schema.org/Comment) et non la chaîne propriétaire de la vidéo :
  // on privilégie donc "ownerChannelName" (champ propre aux pages vidéo YouTube,
  // fiable et non ambigu) avant la recherche générique.
  const author = cleanPreviewText(
    (isYouTubeDomain && extractJsonLikeValueFromScripts(html, ["ownerChannelName"], 160)) ||
    getFirstMetaValue(metaTags, ["author"]) ||
    pickStructuredValue(jsonLdObjects, ["author", "creator", "contributor"]) ||
    extractJsonLikeValueFromScripts(html, ["ownerChannelName", "author", "channelName", "channel"], 160),
    160
  );

  return {
    url: requestedUrl,
    finalUrl: canonicalUrl || finalUrl || requestedUrl,
    canonicalUrl: canonicalUrl || finalUrl || requestedUrl,
    domain,
    title: title || domain,
    description,
    image,
    siteName: siteName || domain,
    ...(author ? { author } : {}),
    ...(videoDurationSeconds ? { videoDurationSeconds } : {})
  };
}

function buildBrowserLikeHeaders(url, profile = "browser") {
  let host = "";
  try {
    host = new URL(url).origin;
  } catch (error) {
    host = "https://www.google.com";
  }

  const commonHeaders = {
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache"
  };

  if (profile === "facebook") {
    return {
      ...commonHeaders,
      "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": host
    };
  }

  if (profile === "slack") {
    return {
      ...commonHeaders,
      "User-Agent": "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": host
    };
  }

  if (profile === "twitter") {
    return {
      ...commonHeaders,
      "User-Agent": "Twitterbot/1.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": host
    };
  }

  if (profile === "googlebot") {
    return {
      "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      "Referer": "https://www.google.com/"
    };
  }

  return {
    ...commonHeaders,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Referer": host
  };
}

function getPreviewFetchStrategies() {
  return [
    { profile: "browser", timeoutMs: 8000 },
    { profile: "facebook", timeoutMs: 10000 },
    { profile: "slack", timeoutMs: 10000 },
    { profile: "twitter", timeoutMs: 10000 }
  ];
}

async function fetchPreviewHtml(url, timeoutMs = 6000, profile = "browser") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: buildBrowserLikeHeaders(url, profile),
      redirect: "follow",
      signal: controller.signal
    });

    const finalUrl = response.url || url;

    try {
      await assertSafeExternalUrl(finalUrl);
    } catch (error) {
      return {
        ok: false,
        status: response.status,
        finalUrl,
        html: "",
        contentType: "",
        profile
      };
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();

    // L'URL collée par l'utilisateur peut pointer directement sur une image
    // (ex: lien gstatic encrypted-tbn0) plutôt que sur une page HTML avec des
    // balises og:image à scraper. Dans ce cas inutile (et coûteux) de lire le
    // corps en texte : il n'y a aucun HTML à parser.
    const html = response.ok && !contentType.startsWith("image/") ? await response.text() : "";

    return {
      ok: response.ok,
      status: response.status,
      finalUrl,
      html,
      contentType,
      profile
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isBlockedPreviewCandidate(preview, sourceUrl = "") {
  if (!preview || typeof preview !== "object") return false;

  const title = String(preview.title || "").trim().toLowerCase();
  const description = String(preview.description || "").trim().toLowerCase();
  const combined = `${title} ${description}`.trim();

  const blockedMarkers = [
    "access denied",
    "just a moment",
    "attention required",
    "verify you are human",
    "enable javascript",
    "robot or human",
    "request unsuccessful",
    "please wait while your request is being verified"
  ];

  return blockedMarkers.some((marker) => combined.includes(marker));
}

function mergeExternalPreviewCandidates(emptyPreview, previews = []) {
  const candidates = previews.filter((preview) => preview && typeof preview === "object");
  if (!candidates.length) {
    return { ...emptyPreview };
  }

  const domain = String(emptyPreview.domain || "").trim().toLowerCase();
  const isUsefulText = (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    return !!normalized && normalized !== domain && normalized !== "source externe";
  };

  const merged = { ...emptyPreview };

  for (const preview of candidates) {
    if (!merged.finalUrl && preview.finalUrl) merged.finalUrl = preview.finalUrl;
    if (!merged.canonicalUrl && preview.canonicalUrl) merged.canonicalUrl = preview.canonicalUrl;
    if (!merged.url && preview.url) merged.url = preview.url;

    if (!merged.image && preview.image) {
      merged.image = preview.image;
    }

    if (!isUsefulText(merged.title) && isUsefulText(preview.title)) {
      merged.title = preview.title;
    }

    if (!isUsefulText(merged.description) && isUsefulText(preview.description)) {
      merged.description = preview.description;
    } else if (
      isUsefulText(preview.description) &&
      String(preview.description).trim().length > String(merged.description || "").trim().length
    ) {
      merged.description = preview.description;
    }

    if (!isUsefulText(merged.siteName) && isUsefulText(preview.siteName)) {
      merged.siteName = preview.siteName;
    }

    if (!isUsefulText(merged.author) && isUsefulText(preview.author)) {
      merged.author = preview.author;
    }

    if (!merged.videoDurationSeconds && Number(preview.videoDurationSeconds) > 0) {
      merged.videoDurationSeconds = Math.round(Number(preview.videoDurationSeconds));
    }

    if (!merged.domain && preview.domain) {
      merged.domain = preview.domain;
    }
  }

  for (const preview of candidates) {
    if (!merged.image && preview.image) merged.image = preview.image;
    if (!merged.title && preview.title) merged.title = preview.title;
    if (!merged.description && preview.description) merged.description = preview.description;
    if (!merged.siteName && preview.siteName) merged.siteName = preview.siteName;
    if (!merged.author && preview.author) merged.author = preview.author;
    if (!merged.videoDurationSeconds && Number(preview.videoDurationSeconds) > 0) {
      merged.videoDurationSeconds = Math.round(Number(preview.videoDurationSeconds));
    }
    if (!merged.finalUrl && preview.finalUrl) merged.finalUrl = preview.finalUrl;
    if (!merged.canonicalUrl && preview.canonicalUrl) merged.canonicalUrl = preview.canonicalUrl;
  }

  if (!merged.title) merged.title = emptyPreview.title;
  if (!merged.description) merged.description = emptyPreview.description;
  if (!merged.siteName) merged.siteName = emptyPreview.siteName;
  if (!merged.finalUrl) merged.finalUrl = emptyPreview.finalUrl;
  if (!merged.canonicalUrl) merged.canonicalUrl = emptyPreview.canonicalUrl;
  if (!merged.url) merged.url = emptyPreview.url;

  return merged;
}

// Éviction LRU minimal : supprime l'entrée la plus ancienne quand le cap est atteint
function _cacheSet(map, key, value, maxSize) {
  if (map.size >= maxSize && !map.has(key)) map.delete(map.keys().next().value);
  map.set(key, value);
}

const externalPreviewCache = new Map();
const externalPreviewInFlightRequests = new Map();
const externalPreviewNoImageRetryAfter = new Map();
const EXTERNAL_PREVIEW_CACHE_DIR = path.join(__dirname, "data", "external-preview-cache");
const EXTERNAL_PREVIEW_CACHE_MAX = 300;
const EXTERNAL_PREVIEW_NO_IMAGE_RETRY_MS = 30 * 60 * 1000;
const debatesApiResponseCache = new Map();
const DEBATES_API_CACHE_TTL_MS = 5 * 60 * 1000;
// Flux "récent"/"old" (page d'accueil, sort=recent) : TTL dédié, plus court que les
// autres clés car c'est la vue la plus consultée. Relevé de 2 à 15 min le 10/08/2026
// (audit egress) : ce cache-key rebuild (debates+arguments+comments+votes, avec
// media_extras) est le plus gros contributeur réel identifié, largement avant les
// scans "popular"/"ideas" (peu/jamais appelés en pratique) — accepter jusqu'à 15 min
// de délai avant qu'une arène tout juste créée/relancée apparaisse en tête réduit
// d'autant sa fréquence de reconstruction.
const DEBATES_RECENT_CACHE_TTL_MS = 15 * 60 * 1000;
// La page d'accueil possède une entrée par catégorie et par orientation politique. Cinquante
// entrées ne suffisaient plus : les pages récentes évinçaient en boucle les catégories, qui
// repartaient alors sur quatre lectures Supabase (debates + arguments + comments + votes).
const DEBATES_API_CACHE_MAX = 160;
// Anti-dogpile : plusieurs visiteurs arrivant simultanément sur une clé de cache expirée
// déclenchaient chacun leur propre reconstruction (debates + arguments + comments + votes),
// jusqu'à ×N la même lecture Supabase en quelques millisecondes. Une seule reconstruction
// en vol par clé, les autres requêtes attendent la même promesse (cf. audit egress du
// 10/08/2026, même principe que latestDebatesMetaInFlight ci-dessous).
const debatesApiInFlight = new Map();
let latestDebatesMetaCache = null;
let latestDebatesMetaInFlight = null;
const LATEST_DEBATES_META_CACHE_TTL_MS = 60 * 1000;
// /api/debates/analysis-statuses n'avait aucun cache (seule route "chaude" du fichier
// dans ce cas) : appelée par index-ai-badge.js sur CHAQUE affichage de l'accueil, elle
// scanne toute la table debates (aucune limite, aucune pagination) — identifiée comme
// gros contributeur egress lors du pic du 26/08/2026. Même principe anti-dogpile que
// latestDebatesMetaInFlight ci-dessus : une seule lecture Supabase partagée par fenêtre
// de 60 s, quel que soit le nombre de visiteurs simultanés.
let analysisStatusesCache = null;
let analysisStatusesInFlight = null;
const ANALYSIS_STATUSES_CACHE_TTL_MS = 60 * 1000;
const DEBATES_LIST_SELECT_COLUMNS = [
  "id",
  "question",
  "option_a",
  "option_b",
  "type",
  "content",
  "category",
  "source_url",
  "image_url",
  "video_url",
  "media_extras",
  "keywords",
  "cloud_label",
  "story_id",
  "episode_nav",
  "creator_key",
  "created_at",
  "bumped_at",
  "political_group"
].join(",");

// Utilisée uniquement quand /api/debates doit balayer TOUTES les arènes
// correspondant aux filtres pour les classer côté Node avant de limiter
// (sort=popular/ideas sans catégorie ni pagination — cf. canPageInDatabase) :
// id/created_at/bumped_at suffisent au tri, le reste (dont media_extras, à
// lui seul ~11 Mo sur l'ensemble de la table au 10/08/2026, cf. audit egress)
// n'est relu qu'une fois les identifiants finalement affichés connus.
const DEBATES_RANKING_SELECT_COLUMNS = "id,created_at,bumped_at";

// getDebateById est appelé sur (quasi) chaque vue de débat (route la plus
// chaude de l'API, ~1300 appels/jour) : ai_analysis et popularity_analysis
// peuvent peser plusieurs centaines de Ko par ligne (rapport IA en texte
// brut) et ne sont jamais lus côté client (public/script.js) — seul
// ai_analysis_status (petit enum) l'est. Colonnes exclues volontairement de
// ce select ; les rares call-sites qui ont besoin du texte complet
// (génération/lecture du rapport IA) le relisent via un select() dédié.
// Cause identifiée le 05/08/2026 (egress Supabase ×2,3 un jour de forte
// activité) : select("*") faisait transiter ce texte sur chaque requête.
const DEBATE_DETAIL_SELECT_COLUMNS = [
  "id",
  "question",
  "option_a",
  "option_b",
  "type",
  "content",
  "category",
  "source_url",
  "source_published_at",
  "image_url",
  "video_url",
  "media_extras",
  "keywords",
  "cloud_label",
  "story_id",
  "episode_nav",
  "creator_key",
  "created_at",
  "bumped_at",
  "political_group",
  "political_orientation",
  "correction_strictness",
  "long_arguments",
  "evaluation_axis",
  "evaluation_axis_hidden",
  "ai_analysis_status",
  "ai_analysis_scheduled_at",
  "ai_analysis_generated_at",
  "ai_analysis_last_score"
].join(",");

// PostgREST (Supabase) plafonne chaque réponse à 1000 lignes, silencieusement :
// au-delà, les lignes excédentaires sont absentes sans erreur (compteurs
// faussés, listes tronquées). Ces helpers paginent par .range() jusqu'à la
// dernière page. buildQuery doit produire une requête NEUVE à chaque appel
// (un builder Supabase ne se réexécute pas) et inclure un .order() stable,
// sinon les pages successives peuvent se chevaucher.
const SUPABASE_ROWS_PAGE_SIZE = 1000;

async function fetchAllSupabaseRows(buildQuery) {
  const rows = [];
  for (let offset = 0; ; offset += SUPABASE_ROWS_PAGE_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + SUPABASE_ROWS_PAGE_SIZE - 1);
    if (error) return { data: null, error };
    if (data && data.length) rows.push(...data);
    if (!data || data.length < SUPABASE_ROWS_PAGE_SIZE) return { data: rows, error: null };
  }
}

// Variante pour .in() sur de longues listes d'ids : la liste part dans l'URL
// PostgREST (longueur limitée), donc on la découpe en tranches, chacune
// paginée à son tour.
const SUPABASE_IN_FILTER_CHUNK_SIZE = 400;

async function fetchAllSupabaseRowsIn(ids, buildChunkQuery) {
  const rows = [];
  for (let i = 0; i < ids.length; i += SUPABASE_IN_FILTER_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + SUPABASE_IN_FILTER_CHUNK_SIZE);
    const { data, error } = await fetchAllSupabaseRows(() => buildChunkQuery(chunk));
    if (error) return { data: null, error };
    rows.push(...data);
  }
  return { data: rows, error: null };
}

const debateDetailResponseCache = new Map();
const DEBATE_DETAIL_CACHE_TTL_MS = 3 * 60 * 1000;
const DEBATE_DETAIL_CACHE_MAX = 500;
const notificationsApiResponseCache = new Map();
const NOTIFICATIONS_API_CACHE_TTL_MS = 120 * 1000;
const NOTIFICATIONS_API_CACHE_MAX = 200;
const NOTIFICATIONS_API_SELECT_COLUMNS = "id,type,message,debate_id,argument_id,comment_id,is_read,created_at";

function getDebatesApiCacheKey({
  limit = null,
  offset = 0,
  sort = "popular",
  search = "",
  category = "",
  politicalGroup = ""
} = {}) {
  const normalizedSort = ["popular", "recent", "old", "ideas"].includes(String(sort || ""))
    ? String(sort)
    : "popular";

  return JSON.stringify({
    limit: Number.isFinite(limit) && limit > 0 ? limit : null,
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
    sort: normalizedSort,
    search: String(search || "").trim().toLowerCase(),
    category: String(category || "").trim().toLowerCase(),
    politicalGroup: String(politicalGroup || "").trim().toLowerCase()
  });
}

function getCachedDebatesApiResponse(key) {
  const entry = debatesApiResponseCache.get(String(key || ""));
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    debatesApiResponseCache.delete(String(key || ""));
    return null;
  }
  return entry.value;
}

function setCachedDebatesApiResponse(key, value, ttlMs = DEBATES_API_CACHE_TTL_MS) {
  _cacheSet(debatesApiResponseCache, String(key || ""), { value, expiresAt: Date.now() + ttlMs }, DEBATES_API_CACHE_MAX);
}

function clearDebatesApiResponseCache() {
  debatesApiResponseCache.clear();
  latestDebatesMetaCache = null;
}

function getDebateDetailCacheKey(debateId) {
  return String(debateId || "").trim();
}

function getCachedDebateDetailResponse(debateId) {
  const key = getDebateDetailCacheKey(debateId);
  if (!key) return null;

  const entry = debateDetailResponseCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    debateDetailResponseCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedDebateDetailResponse(debateId, value, ttlMs = DEBATE_DETAIL_CACHE_TTL_MS) {
  const key = getDebateDetailCacheKey(debateId);
  if (!key) return;
  _cacheSet(debateDetailResponseCache, key, { value, expiresAt: Date.now() + ttlMs }, DEBATE_DETAIL_CACHE_MAX);
}

function clearDebateDetailResponseCache(debateId = null) {
  const key = getDebateDetailCacheKey(debateId);
  if (!key) {
    debateDetailResponseCache.clear();
    return;
  }
  debateDetailResponseCache.delete(key);
}

// Univers intellectuel ("Ma mémoire") : réponse coûteuse à reconstruire (relit tout
// l'historique QCM culture générale de l'utilisateur, cf.
// fetchUserCultureGeneraleAnswerEvents), désormais rechargée à chaque arrivée sur
// l'accueil depuis que "Ma mémoire" y est la vue par défaut (10/08/2026) — cf. audit
// egress PostgREST du 25/08/2026. Cache mémoire par utilisateur (legacyKey), même
// pattern que debateDetailResponseCache ci-dessus. cache:"no-store" côté client ne
// concerne que le cache HTTP du navigateur pour des données personnelles ; ce cache
// serveur est indépendant et sûr (isolation garantie par la clé legacyKey).
const intellectualUniverseResponseCache = new Map();
const INTELLECTUAL_UNIVERSE_CACHE_TTL_MS = 4 * 60 * 1000;
const INTELLECTUAL_UNIVERSE_CACHE_MAX = 1000;

function getCachedIntellectualUniverseResponse(legacyKey) {
  const key = String(legacyKey || "").trim();
  if (!key) return null;
  const entry = intellectualUniverseResponseCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    intellectualUniverseResponseCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedIntellectualUniverseResponse(legacyKey, value) {
  const key = String(legacyKey || "").trim();
  if (!key) return;
  _cacheSet(intellectualUniverseResponseCache, key, { value, expiresAt: Date.now() + INTELLECTUAL_UNIVERSE_CACHE_TTL_MS }, INTELLECTUAL_UNIVERSE_CACHE_MAX);
}

// Invalidation ciblée sur le seul utilisateur concerné, appelée après les mutations qui
// changent le contenu de "Ma mémoire" (acquisition d'une notion, lien "compris" validé,
// nouvelle réponse QCM) — cf. POST /api/daily-quiz/answer.
function invalidateIntellectualUniverseCache(legacyKey) {
  const key = String(legacyKey || "").trim();
  if (!key) return;
  intellectualUniverseResponseCache.delete(key);
}

const ogImageCache = new Map();
const OG_IMAGE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min (les votes évoluent)
const OG_IMAGE_CACHE_MAX = 200;                // ~200 × ~150 KB ≈ 30 MB max

function invalidateDebateCaches(debateId = null, { clearList = true } = {}) {
  if (clearList) clearDebatesApiResponseCache();
  clearDebateDetailResponseCache(debateId);
  if (debateId) {
    ogImageCache.delete(String(debateId));
  } else if (clearList) {
    ogImageCache.clear();
  }
}

function invalidateSharedDebateCaches(debateId = null, { clearList = true } = {}) {
  const ids = debateId ? getDebateIdsInSharedSpace(debateId) : [];
  if (!ids.length) {
    invalidateDebateCaches(debateId, { clearList });
    return;
  }

  if (clearList) clearDebatesApiResponseCache();
  for (const id of ids) {
    clearDebateDetailResponseCache(id);
    ogImageCache.delete(String(id));
  }
}

function getNotificationsApiCacheKey(userKey, limit = 50, offset = 0) {
  const normalizedUserKey = String(userKey || "").trim();
  if (!normalizedUserKey) return "";
  return `${normalizedUserKey}::${Math.max(1, Number(limit) || 50)}::${Math.max(0, Number(offset) || 0)}`;
}

function getCachedNotificationsApiResponse(userKey, limit = 50, offset = 0) {
  const key = getNotificationsApiCacheKey(userKey, limit, offset);
  if (!key) return null;

  const entry = notificationsApiResponseCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    notificationsApiResponseCache.delete(key);
    return null;
  }

  return entry.value;
}

function setCachedNotificationsApiResponse(userKey, limit, offset, value) {
  const key = getNotificationsApiCacheKey(userKey, limit, offset);
  if (!key) return;
  _cacheSet(notificationsApiResponseCache, key, { value, expiresAt: Date.now() + NOTIFICATIONS_API_CACHE_TTL_MS }, NOTIFICATIONS_API_CACHE_MAX);
}

function clearNotificationsApiResponseCache(userKey = null) {
  if (userKey) {
    const prefix = `${String(userKey || "").trim()}::`;
    for (const key of notificationsApiResponseCache.keys()) {
      if (key.startsWith(prefix)) notificationsApiResponseCache.delete(key);
    }
  } else {
    notificationsApiResponseCache.clear();
  }
}

function ensureExternalPreviewCacheDir() {
  try {
    if (!fs.existsSync(EXTERNAL_PREVIEW_CACHE_DIR)) {
      fs.mkdirSync(EXTERNAL_PREVIEW_CACHE_DIR, { recursive: true });
    }
    return true;
  } catch (error) {
    console.error("Erreur création dossier cache previews externes:", error);
    return false;
  }
}

function purgeExternalPreviewCacheDir(maxFiles = 500) {
  try {
    if (!fs.existsSync(EXTERNAL_PREVIEW_CACHE_DIR)) return;
    const files = fs.readdirSync(EXTERNAL_PREVIEW_CACHE_DIR)
      .map(f => ({ name: f, mtime: fs.statSync(path.join(EXTERNAL_PREVIEW_CACHE_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length <= maxFiles) return;
    const toDelete = files.slice(maxFiles);
    for (const f of toDelete) fs.unlinkSync(path.join(EXTERNAL_PREVIEW_CACHE_DIR, f.name));
    console.log(`[preview-cache] purge : ${toDelete.length} fichiers supprimés, ${maxFiles} conservés.`);
  } catch (e) {
    console.error("[preview-cache] erreur purge:", e.message);
  }
}

function getExternalPreviewCacheFilePath(url) {
  const key = crypto.createHash("sha1").update(String(url || "")).digest("hex");
  return path.join(EXTERNAL_PREVIEW_CACHE_DIR, `${key}.json`);
}

function readPersistentPreview(url) {
  try {
    if (!ensureExternalPreviewCacheDir()) return null;

    const filePath = getExternalPreviewCacheFilePath(url);
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.error("Erreur lecture cache preview externe:", error);
    return null;
  }
}

function writePersistentPreview(url, preview) {
  try {
    if (!ensureExternalPreviewCacheDir()) return;

    const filePath = getExternalPreviewCacheFilePath(url);
    fs.writeFileSync(filePath, JSON.stringify(preview || {}), "utf8");
  } catch (error) {
    console.error("Erreur écriture cache preview externe:", error);
  }
}

function isMeaningfulPreviewData(preview, sourceUrl = "") {
  if (!preview || typeof preview !== "object") return false;

  const safeUrl = normalizeExternalUrl(sourceUrl || preview.url || preview.finalUrl || "");
  const safeDomain = (() => {
    try {
      return new URL(safeUrl).hostname.replace(/^www\./, "").toLowerCase();
    } catch (error) {
      return String(preview.domain || "").trim().toLowerCase();
    }
  })();

  const title = String(preview.title || "").trim().toLowerCase();
  const description = String(preview.description || "").trim().toLowerCase();
  const image = String(preview.image || "").trim();

  if (image) return true;
  if (description && description !== "source externe") return true;
  if (title && title !== safeDomain && title !== "source externe") return true;

  return false;
}

function hasPreviewImage(preview) {
  return !!String(preview?.image || "").trim();
}

function markPreviewNoImageRetry(url) {
  externalPreviewNoImageRetryAfter.set(String(url || ""), Date.now() + EXTERNAL_PREVIEW_NO_IMAGE_RETRY_MS);
}

function shouldRetryPreviewWithoutImage(url) {
  const retryAfter = externalPreviewNoImageRetryAfter.get(String(url || "")) || 0;
  return Date.now() >= retryAfter;
}

function getCachedPreview(url) {
  const entry = externalPreviewCache.get(url);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    externalPreviewCache.delete(url);
    return null;
  }
  return entry.value;
}

function setCachedPreview(url, value, ttlMs = 1000 * 60 * 30) {
  _cacheSet(externalPreviewCache, url, { value, expiresAt: Date.now() + ttlMs }, EXTERNAL_PREVIEW_CACHE_MAX);
}

function getCachedExternalLinkPreview(sourceUrl) {
  const safeUrl = normalizeExternalUrl(sourceUrl);
  if (!safeUrl) return null;

  const cached = getCachedPreview(safeUrl);
  if (cached) return cached;

  const persistedPreview = readPersistentPreview(safeUrl);
  if (persistedPreview && isMeaningfulPreviewData(persistedPreview, safeUrl)) {
    setCachedPreview(safeUrl, persistedPreview, 1000 * 60 * 60 * 24);
    return persistedPreview;
  }

  return null;
}

async function getExternalLinkPreview(sourceUrl) {
  const safeUrl = normalizeExternalUrl(sourceUrl);
  if (!safeUrl) return null;

  let parsedUrl;
  try {
    parsedUrl = new URL(safeUrl);
  } catch (error) {
    return null;
  }
  const domain = parsedUrl.hostname.replace(/^www\./, "").toLowerCase();
  const isYouTubeDomain = domain === "youtube.com" || domain === "youtu.be";
  const hasRequiredYouTubeDuration = (preview) => !isYouTubeDomain || Number(preview?.videoDurationSeconds) > 0;

  try {
    await assertSafeExternalUrl(safeUrl);
  } catch (error) {
    return null;
  }

  const cached = getCachedPreview(safeUrl);
  if (cached && hasPreviewImage(cached) && hasRequiredYouTubeDuration(cached)) return cached;
  if (cached && !hasPreviewImage(cached) && !shouldRetryPreviewWithoutImage(safeUrl)) return cached;

  const persistedPreview = cached || readPersistentPreview(safeUrl);
  if (persistedPreview && hasPreviewImage(persistedPreview) && isMeaningfulPreviewData(persistedPreview, safeUrl) && hasRequiredYouTubeDuration(persistedPreview)) {
    setCachedPreview(safeUrl, persistedPreview, 1000 * 60 * 60 * 24);
    externalPreviewNoImageRetryAfter.delete(safeUrl);
    return persistedPreview;
  }

  const inFlightRequest = externalPreviewInFlightRequests.get(safeUrl);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const emptyPreview = {
    url: safeUrl,
    finalUrl: safeUrl,
    canonicalUrl: safeUrl,
    domain,
    title: domain,
    description: "Source externe",
    image: "",
    siteName: domain
  };

  const previewCandidates = [];
  const strategies = getPreviewFetchStrategies();

  const previewPromise = (async () => {
    try {
      for (const strategy of strategies) {
        let fetched;
        try {
          fetched = await fetchPreviewHtml(safeUrl, strategy.timeoutMs, strategy.profile);
        } catch (error) {
          continue;
        }

        if (!fetched?.ok) {
          continue;
        }

        // Lien direct vers une image (pas de page HTML à scraper) : on l'utilise
        // elle-même comme aperçu plutôt que de chercher des balises og:image absentes.
        if (fetched.contentType.startsWith("image/")) {
          const directImageUrl = fetched.finalUrl || safeUrl;
          previewCandidates.push({
            url: safeUrl,
            finalUrl: directImageUrl,
            canonicalUrl: directImageUrl,
            domain,
            title: domain,
            description: "",
            image: directImageUrl,
            siteName: domain
          });
          break;
        }

        if (!fetched.html) {
          continue;
        }

        const candidate = buildPreviewFromHtml(fetched.html, safeUrl, fetched.finalUrl);
        if (!candidate || isBlockedPreviewCandidate(candidate, safeUrl)) {
          continue;
        }

        previewCandidates.push(candidate);

        if (candidate.image && isMeaningfulPreviewData(candidate, safeUrl)) {
          break;
        }
      }

      const mergedPreview = mergeExternalPreviewCandidates(emptyPreview, previewCandidates);

      if (isMeaningfulPreviewData(mergedPreview, safeUrl)) {
        setCachedPreview(safeUrl, mergedPreview, 1000 * 60 * 60 * 24);
        writePersistentPreview(safeUrl, mergedPreview);
        if (hasPreviewImage(mergedPreview)) externalPreviewNoImageRetryAfter.delete(safeUrl);
        else markPreviewNoImageRetry(safeUrl);
        return mergedPreview;
      }

      if (persistedPreview && isMeaningfulPreviewData(persistedPreview, safeUrl)) {
        setCachedPreview(safeUrl, persistedPreview, 1000 * 60 * 60 * 24);
        return persistedPreview;
      }

      setCachedPreview(safeUrl, mergedPreview, 1000 * 60 * 5);
      if (!hasPreviewImage(mergedPreview)) markPreviewNoImageRetry(safeUrl);

      if (isMeaningfulPreviewData(mergedPreview, safeUrl)) {
        writePersistentPreview(safeUrl, mergedPreview);
      }

      return mergedPreview;
    } catch (error) {
      const fallback = persistedPreview || emptyPreview;
      setCachedPreview(safeUrl, fallback, 1000 * 60 * 5);
      if (!hasPreviewImage(fallback)) markPreviewNoImageRetry(safeUrl);
      return fallback;
    } finally {
      if (externalPreviewInFlightRequests.get(safeUrl) === previewPromise) {
        externalPreviewInFlightRequests.delete(safeUrl);
      }
    }
  })();

  externalPreviewInFlightRequests.set(safeUrl, previewPromise);
  return previewPromise;
}

async function seedExternalLinkPreviewFromClient(sourceUrl, rawPreview) {
  const safeUrl = normalizeExternalUrl(sourceUrl);
  if (!safeUrl || !rawPreview || typeof rawPreview !== "object") return null;

  let parsedSource;
  try {
    parsedSource = new URL(safeUrl);
  } catch {
    return null;
  }

  let image = normalizeExternalUrl(
    rawPreview.image ||
    rawPreview.imageUrl ||
    rawPreview.thumbnail ||
    rawPreview.thumbnailUrl ||
    rawPreview.ogImage ||
    ""
  );

  if (image) {
    try {
      await assertSafeExternalUrl(image);
    } catch {
      image = "";
    }
  }

  const clean = (value, max = 500) => String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

  const domain = clean(
    rawPreview.domain ||
    rawPreview.siteName ||
    rawPreview.publisher ||
    rawPreview.provider ||
    parsedSource.hostname.replace(/^www\./i, ""),
    200
  );
  const title = clean(rawPreview.title || rawPreview.ogTitle || rawPreview.headline || domain, 500);
  const description = clean(rawPreview.description || rawPreview.ogDescription || rawPreview.summary || "", 500);

  if (!image) return null;

  const preview = {
    url: safeUrl,
    finalUrl: safeUrl,
    canonicalUrl: safeUrl,
    domain,
    siteName: domain,
    title: title || domain || "Source externe",
    description,
    image
  };

  setCachedPreview(safeUrl, preview, 1000 * 60 * 60 * 24);
  writePersistentPreview(safeUrl, preview);
  return preview;
}

function computeDebatePercents(args) {
  let votesA = 0;
  let votesB = 0;

  for (const arg of args || []) {
    const voteCount = Number(arg.votes || 0);
    if (arg.side === "A") votesA += voteCount;
    if (arg.side === "B") votesB += voteCount;
  }

  const totalVotes = votesA + votesB;

  if (totalVotes > 0) {
    const percentA = Math.round((votesA / totalVotes) * 100);
    return {
      votesA,
      votesB,
      percentA,
      percentB: 100 - percentA
    };
  }

  return {
    votesA,
    votesB,
    percentA: 50,
    percentB: 50
  };
}

function sendServerError(res, message = "Erreur serveur.") {
  return res.status(500).json({ error: message });
}

function isAdmin(req) {
  return verifyAdminToken(req.headers["x-admin-token"]);
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Accès admin refusé." });
  }
  next();
}

// Masquage des notes IA faible/moyen (demande du 19/08/2026) : seuls l'admin et le
// créateur de l'arène concernée voient le score/détail réel d'une idée notée en
// dessous de "bon" (70/100) — masqué pour tout le monde d'autre, y compris l'auteur
// de l'idée lui-même. Toujours appliqué en LECTURE uniquement : debates.ai_analysis
// stocke en base la version complète, jamais tronquée, quel que soit le lecteur.
function canViewerSeeHiddenScores(req, creatorKey, clientKey) {
  return isAdmin(req) || !!(clientKey && creatorKey && String(creatorKey) === String(clientKey));
}

// Retourne l'entrée de score telle quelle si l'idée est "bon"/"excellent" ou si le
// lecteur y a droit (cf. canViewerSeeHiddenScores) — sinon null (jamais de score/
// catégorie partiels renvoyés : soit tout, soit rien).
function maskScoreEntryForViewer(scoreEntry, canSeeHidden) {
  if (!scoreEntry) return null;
  const category = String(scoreEntry.category || "").toLowerCase();
  if (canSeeHidden || category === "bon" || category === "excellent") return scoreEntry;
  return null;
}

// Redaction en profondeur d'une entrée effectiveArguments (cf. generateAnalysisJson,
// lib/debate-analysis.js) pour un lecteur qui n'a pas le droit de voir les scores
// faible/moyen — remplace tous les champs révélateurs par un marqueur neutre
// 'masque', jamais un score de 0 (qui signifierait "évalué et jugé nul", pas "caché").
function redactHiddenScoreEntry(entry) {
  const category = String(entry?.final_category || entry?.category || "").toLowerCase();
  if (category !== "faible" && category !== "moyen") return entry;
  return {
    ...entry,
    final_score: null,
    final_category: "masque",
    category: "masque",
    scores_without_sources: null,
    category_without_sources: null,
    source_score: null,
    final_score_note: null,
    custom_rubric_report: null,
    strengths: [],
    weaknesses: [],
    short_explanation: "",
    source_level: "",
    source_relevance: "",
    source_reliability: "",
    source_supports_argument: "",
    source_verification_level: "",
    source_main_issue: null,
    source_urls_analyzed: [],
    source_explanation: "",
    diagnostic: null,
    plafonds_appliques: null,
    total_without_sources_initial: null,
    final_score_initial: null,
    server_caps_applied: false,
    server_caps_details: null
  };
}

function nowIso() {
  return new Date().toISOString();
}

function inferVeilleDebateType(positionA, positionB) {
  const hasPositionA = String(positionA || "").trim().length > 0;
  const hasPositionB = String(positionB || "").trim().length > 0;
  return hasPositionA || hasPositionB ? "debate" : "open";
}

function normalizeSimilarityText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSimilarityTokens(value) {
  const stopWords = new Set([
    "alors", "apres", "avec", "avoir", "cette", "comme", "dans", "depuis", "doit", "doivent", "donc",
    "elle", "elles", "encore", "entre", "etre", "faire", "faut", "leurs", "mais", "meme", "moins",
    "pour", "pourquoi", "plus", "quel", "quelle", "quelles", "quels", "sans", "sera", "sont", "sous",
    "tres", "tout", "tous", "toute", "toutes", "vers", "vous", "nous", "leur", "leurs", "contre",
    "debat", "debats", "arene", "arenes", "position", "positions", "question", "resume", "sujet",
    "fautil", "doiton", "estce", "peuton", "encore", "trop", "vrai", "scandale", "mesure"
  ]);

  return normalizeSimilarityText(value)
    .split(" ")
    .filter(Boolean)
    .filter(token => token.length >= 4)
    .filter(token => !stopWords.has(token));
}

function buildSimilarityText(question, resume) {
  return [String(question || "").trim(), String(resume || "").trim()].filter(Boolean).join(" ");
}

function computeTokenOverlapScore(tokensA, tokensB) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if (!setA.size || !setB.size) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = new Set([...setA, ...setB]).size;
  if (!union) return 0;

  const jaccard = intersection / union;
  const coverage = intersection / Math.min(setA.size, setB.size);
  return Math.max(jaccard, coverage * 0.92);
}

function hasStrongSubstringMatch(textA, textB) {
  if (!textA || !textB) return false;
  return textA.includes(textB) || textB.includes(textA);
}

function getVeilleSimilarityCandidates(input, debates) {
  const question = String(input?.question || "").trim();
  const resume = String(input?.resume || "").trim();
  const type = inferVeilleDebateType(input?.positionA, input?.positionB);
  const combined = buildSimilarityText(question, resume);
  const normalizedCombined = normalizeSimilarityText(combined);
  const normalizedQuestion = normalizeSimilarityText(question);
  const baseTokens = getSimilarityTokens(combined);

  if (!normalizedQuestion || !baseTokens.length) return [];

  return (debates || [])
    .map((debate) => {
      const debateType = inferVeilleDebateType(debate.option_a, debate.option_b);
      if (debateType !== type) return null;

      const debateCombined = buildSimilarityText(debate.question, debate.content || "");
      const debateNormalized = normalizeSimilarityText(debateCombined);
      const debateQuestionNormalized = normalizeSimilarityText(debate.question || "");
      const debateTokens = getSimilarityTokens(debateCombined);
      if (!debateTokens.length) return null;

      const overlapScore = computeTokenOverlapScore(baseTokens, debateTokens);
      const exactQuestion = normalizedQuestion && normalizedQuestion === debateQuestionNormalized;
      const strongSubstring = hasStrongSubstringMatch(normalizedQuestion, debateQuestionNormalized)
        || hasStrongSubstringMatch(normalizedCombined, debateNormalized);
      const debateTokenSet = new Set(debateTokens);
      const baseTokenSet = [...new Set(baseTokens)];
      const sharedCount = baseTokenSet.filter(token => debateTokenSet.has(token)).length;
      const longSharedCount = baseTokenSet.filter(token => token.length >= 7 && debateTokenSet.has(token)).length;

      // Score proportionnel au nombre de mots significatifs partagés (les mots longs,
      // >=7 lettres, comptent double) — remplace l'ancien palier plat à 0.72 dès 4 mots
      // partagés, qui mettait à égalité un vrai doublon (20+ mots partagés) et n'importe
      // quelle paire de sujets ne partageant que 4 mots français courants, au point que
      // ce bruit pouvait évincer le vrai doublon du top retenu par tri de récence.
      const weightedShared = sharedCount + longSharedCount;
      const sharedBoost = weightedShared >= 4 ? Math.min(0.95, 0.5 + weightedShared * 0.013) : 0;

      let score = overlapScore;
      if (exactQuestion) score = Math.max(score, 1);
      if (strongSubstring) score = Math.max(score, 0.78);
      score = Math.max(score, sharedBoost);

      const keep = score >= 0.72;
      if (!keep) return null;

      return {
        id: debate.id,
        question: debate.question,
        type: debateType,
        optionA: String(debate.option_a || '').trim(),
        optionB: String(debate.option_b || '').trim(),
        score: Number(score.toFixed(3))
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

async function analyzeVeilleSimilarityWithAI(input, candidates) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !candidates.length) return null;

  const candidateLines = candidates.map((c, i) => {
    const lines = [`Candidat ${i + 1} (id: ${c.id})`, `Question : ${c.question}`];
    if (c.optionA) lines.push(`Position A : ${c.optionA}`);
    if (c.optionB) lines.push(`Position B : ${c.optionB}`);
    return lines.join('\n');
  }).join('\n\n');

  const newDebateLines = [
    'Question : ' + String(input.question || '').trim(),
    input.positionA ? 'Position A : ' + String(input.positionA).trim() : '',
    input.positionB ? 'Position B : ' + String(input.positionB).trim() : '',
    input.resume ? 'Résumé : ' + String(input.resume).trim().slice(0, 600) : ''
  ].filter(Boolean).join('\n');

  const prompt = [
    'Tu détectes les doublons parmi des débats d\'opinion.',
    'Pour chaque candidat, évalue si c\'est un doublon du nouveau débat.',
    '',
    'Échelle de score :',
    '- 1.0 = même sujet et même angle exact',
    '- 0.7-0.9 = très proche, probable doublon',
    '- 0.4-0.6 = thème commun mais angle différent',
    '- 0.0-0.3 = sujet différent',
    'confirmed = true si score >= 0.65',
    '',
    'Réponds UNIQUEMENT en JSON : {"results":[{"id":"...","score":0.0,"confirmed":true}]}',
    '',
    'Nouveau débat :',
    newDebateLines,
    '',
    'Candidats :',
    candidateLines
  ].join('\n');

  try {
    const requestStartedAt = Date.now();
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 200,
        temperature: 0
      })
    });
    if (!r.ok) {
      recordAiUsage(supabase, { feature: 'veille_deduplication', model: 'gpt-4o-mini', latencyMs: Date.now() - requestStartedAt, success: false, error: `openai http ${r.status}` });
      return null;
    }
    const data = await r.json();
    const { inputTokens, outputTokens, cachedTokens } = extractUsage(data?.usage);
    recordAiUsage(supabase, { feature: 'veille_deduplication', model: 'gpt-4o-mini', inputTokens, outputTokens, cachedTokens, latencyMs: Date.now() - requestStartedAt, success: true });
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    return Array.isArray(parsed?.results) ? parsed.results : null;
  } catch {
    return null;
  }
}


// Nombre de publications antérieures comparées au nouveau sujet pour le calcul de tendance
const TREND_RECENT_SUBJECTS_LIMIT = 20;

// Écart minimal avant qu'un débat puisse être considéré comme le remplaçant d'un autre :
// les arènes sorties dans la même rafale de publication (lot de veille) ne sont pas
// une évolution réelle de l'actu dans le temps, elles doivent rester visibles séparément.
const MIN_TREND_MATCH_GAP_MS = 60 * 60 * 1000;

// Fusion automatique Certamen : fenêtre de recherche (1h–36h avant la publication)
// et nombre maximal de candidats examinés.
const CERTAMEN_MERGE_WINDOW_MS = 36 * 60 * 60 * 1000;
const CERTAMEN_MERGE_CANDIDATES_LIMIT = 50;
// Seuil de confiance GPT plus élevé qu'en mode tendance (0.65) car aucune relecture
// humaine : en dessous de 0.80 l'arène reste indépendante.
const CERTAMEN_MERGE_CONFIDENCE_THRESHOLD = 0.80;

/**
 * Compare un nouveau sujet avec les publications récentes pour détecter
 * s'il appartient à une même séquence d'actualité.
 *
 * @param {{ id: string, question: string, resume?: string, tags?: string[], sourceCount: number }} newSubject
 * @param {Array<{ id: string, question: string, resume?: string, tags?: string[], sourceCount: number, created_at: string }>} recentSubjects
 * @returns {Promise<{ id: string, question: string, created_at: string, sourceCount: number } | null>}
 */
async function findSimilarRecentSubjectForTrend(newSubject, recentSubjects) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !Array.isArray(recentSubjects) || !recentSubjects.length) return null;

  const formatSubject = (s) => {
    const parts = [`Titre : ${String(s.question || "").trim()}`];
    const resume = String(s.resume || "").trim();
    if (resume) parts.push(`Résumé : ${resume.slice(0, 180)}`);
    const tags = Array.isArray(s.tags) ? s.tags.filter(Boolean).slice(0, 6).join(", ") : "";
    if (tags) parts.push(`Tags : ${tags}`);
    parts.push(`Sources : ${s.sourceCount || 0}`);
    return parts.join(" | ");
  };

  const recentLines = recentSubjects.map((s, i) =>
    `[${i + 1}] id:${s.id} date:${s.created_at ? s.created_at.slice(0, 10) : "?"} — ${formatSubject(s)}`
  ).join("\n");

  const prompt = [
    "Tu analyses si un nouveau sujet d'actualité appartient à une séquence déjà couverte récemment.",
    "",
    "Séquence = même affaire, même polémique, même réforme, même crise, même conflit EN COURS, même compétition, même dossier politique, même controverse, rebond évident du même sujet.",
    "IMPORTANT : un conflit armé, une guerre, une opération militaire récurrente = SÉQUENCE même si chaque article couvre un épisode différent (ex : nouvelles frappes dans le même conflit, nouveaux bombardements, nouvelle offensive = même séquence que les précédentes).",
    "IMPORTANT : si le titre du nouveau sujet et celui d'une publication récente citent le même nom propre d'affaire/scandale (nom de victime, \"Affaire X\", nom d'opération, nom de réforme/loi, nom d'événement nommé), c'est un signal TRÈS FORT de même séquence — même si l'angle, l'institution ou les personnalités citées diffèrent (ex : \"Affaire Lyhanna\" et \"Affaire Lyhanna et Darmanin\" = même séquence).",
    "PAS une séquence = simple proximité thématique sans lien direct, même personnalité mais événement sans rapport, même pays mais actualité complètement différente, même institution mais affaire sans lien, mot-clé isolé commun.",
    "",
    "Nouveau sujet :",
    formatSubject(newSubject),
    "",
    "Publications récentes (les 20 dernières, publiées il y a au moins 1h) :",
    recentLines,
    "",
    "Si plusieurs sujets semblent appartenir à la même séquence, retourne TOUS leurs ids dans le tableau matchedSubjectIds (pas seulement un).",
    "Si aucun sujet ne correspond, matchedSubjectIds doit être un tableau vide [].",
    'Réponds UNIQUEMENT en JSON strict :',
    '{"matchedSubjectIds":["id1","id2"],"confidence":0.0,"reason":"courte justification","isSameSequence":true}'
  ].join("\n");

  try {
    const requestStartedAt = Date.now();
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 120,
        temperature: 0
      })
    });
    if (!r.ok) {
      recordAiUsage(supabase, { feature: "veille_deduplication", model: "gpt-4o-mini", latencyMs: Date.now() - requestStartedAt, success: false, error: `openai http ${r.status}` });
      return null;
    }
    const data = await r.json();
    const { inputTokens, outputTokens, cachedTokens } = extractUsage(data?.usage);
    recordAiUsage(supabase, { feature: "veille_deduplication", model: "gpt-4o-mini", inputTokens, outputTokens, cachedTokens, latencyMs: Date.now() - requestStartedAt, success: true });
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    let parsed;
    try { parsed = JSON.parse(content); } catch { return null; }

    const confidence = Number(parsed?.confidence ?? 0);
    const isSameSequence = parsed?.isSameSequence === true;
    if (confidence < 0.65 || !isSameSequence) return null;

    // Récupérer les IDs matchés (tableau ou fallback vers ancien format)
    let matchedIds = [];
    if (Array.isArray(parsed?.matchedSubjectIds)) {
      matchedIds = parsed.matchedSubjectIds.map(id => String(id || "").trim()).filter(id => id && id !== "null");
    } else if (parsed?.matchedSubjectId) {
      // Compatibilité avec l'ancien format
      const single = String(parsed.matchedSubjectId || "").trim();
      if (single && single !== "null") matchedIds = [single];
    }
    if (!matchedIds.length) return null;

    // Résoudre les sujets correspondants dans la liste
    const candidates = matchedIds
      .map(id => recentSubjects.find(s => String(s.id) === id))
      .filter(Boolean);

    if (!candidates.length) return null;

    // Log : tous les matchs trouvés
    console.log(`[trend-match] ${candidates.length} sujet(s) similaire(s) trouvé(s) pour "${String(newSubject?.question || "").slice(0, 60)}" :`);
    candidates.forEach(c => {
      const date = c.published_at || c.publishedAt || c.created_at || c.createdAt || c.date || c.timestamp || null;
      console.log(`  → id:${c.id} | date:${date || "inconnue"} | sources:${c.sourceCount || 0} | "${String(c.question || "").slice(0, 50)}"`);
    });

    // Sélectionner le plus récemment publié côté serveur
    const getDate = (s) => {
      const raw = s.published_at || s.publishedAt || s.created_at || s.createdAt || s.date || s.timestamp || null;
      if (!raw) return 0;
      const t = new Date(raw).getTime();
      return isNaN(t) ? 0 : t;
    };

    const matched = candidates.reduce((best, c) => getDate(c) >= getDate(best) ? c : best, candidates[0]);

    console.log(`[trend-match] → Sujet retenu : id:${matched.id} | date:${matched.published_at || matched.created_at || "?"} | sources:${matched.sourceCount || 0} | "${String(matched.question || "").slice(0, 60)}"`);

    return {
      id: matched.id,
      question: matched.question,
      created_at: matched.created_at,
      sourceCount: matched.sourceCount,
      // Tous les prédécesseurs de la séquence, pas seulement le plus récent : le
      // masquage des bulles doit pouvoir cacher chacun d'eux (cf. doublon nuage
      // gauche 1972/2007 du 18/07/2026 — 2007 avait matché 1981 ET 1972, mais seul
      // 1981, d'un autre groupe, était retenu ; 1972 restait affiché à côté).
      matchedIds: candidates.map((c) => String(c.id)),
      confidence,
      reason: String(parsed?.reason || "").trim()
    };
  } catch {
    return null;
  }
}

function normalizeQuestionForMergeComparison(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Garde-fou final avant toute fusion automatique d'arènes : vérifie en tête-à-tête
 * que les deux questions posent bien LE MÊME débat, et pas seulement le même thème
 * ou la même séquence d'actualité. Contrairement au match initial (choix parmi ~50
 * candidats), c'est une comparaison binaire entre deux textes, et elle porte sur le
 * canonique RÉSOLU — un lien erroné existant ne peut donc plus se propager en chaîne.
 *
 * Fail-closed : toute erreur, réponse ambiguë ou refus → pas de fusion. Une fusion
 * manquée est bénigne (l'arène reste indépendante) ; une fusion fausse affiche des
 * idées hors sujet de façon durable (cf. arènes 1131/1173 « police et pouvoir »
 * fusionnées à tort avec 1114 « soutien des ministres »).
 */
async function confirmSameDebateQuestionForMerge(newQuestion, canonicalQuestion, logLabel = "merge-guard") {
  const q1 = String(newQuestion || "").trim();
  const q2 = String(canonicalQuestion || "").trim();
  if (!q1 || !q2) return false;

  // Fast-path déterministe : questions identiques (ex : variantes gauche/droite/générale
  // d'une même publication) → fusion autorisée sans appel IA.
  if (normalizeQuestionForMergeComparison(q1) === normalizeQuestionForMergeComparison(q2)) return true;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return false;

  try {
    const prompt = [
      "Tu vérifies une fusion automatique entre deux arènes de débat. Si elles fusionnent, elles partageront exactement le même pot d'idées : chaque idée écrite pour l'une s'affichera sous l'autre.",
      "La fusion n'est correcte QUE si les deux questions posent LE MÊME débat : même objet, mêmes acteurs, même choix à trancher. Une idée répondant à l'une doit être une réponse naturelle et pertinente à l'autre.",
      "Même thème général, même actualité, même famille politique ou même axe abstrait (liberté/obéissance, sécurité/liberté...) ne suffisent PAS : si l'objet du débat diffère, réponds false.",
      'Réponds UNIQUEMENT en JSON strict : {"sameDebate":true|false,"reason":"courte justification"}',
      "",
      "Question 1 : " + q1,
      "Question 2 : " + q2
    ].join("\n");

    const requestStartedAt = Date.now();
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 120,
        temperature: 0
      })
    });
    if (!r.ok) {
      recordAiUsage(supabase, { feature: "veille_deduplication", model: "gpt-4o-mini", latencyMs: Date.now() - requestStartedAt, success: false, error: `openai http ${r.status}` });
      return false;
    }
    const data = await r.json();
    const { inputTokens, outputTokens, cachedTokens } = extractUsage(data?.usage);
    recordAiUsage(supabase, { feature: "veille_deduplication", model: "gpt-4o-mini", inputTokens, outputTokens, cachedTokens, latencyMs: Date.now() - requestStartedAt, success: true });
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return false;
    const parsed = JSON.parse(content);
    const sameDebate = parsed?.sameDebate === true;
    console.log(`[${logLabel}] vérification questions : ${sameDebate ? "OK" : "REFUS"} | "${q1.slice(0, 60)}" vs "${q2.slice(0, 60)}" | raison : ${String(parsed?.reason || "").slice(0, 140)}`);
    return sameDebate;
  } catch (err) {
    console.error(`[${logLabel}] erreur vérification questions (fail-closed → pas de fusion) :`, err.message);
    return false;
  }
}

/**
 * Tente de fusionner automatiquement une arène créée par Certamen avec une arène
 * similaire publiée dans la fenêtre de 1h–36h précédente.
 *
 * Règles :
 *  - Confiance GPT ≥ CERTAMEN_MERGE_CONFIDENCE_THRESHOLD (0.80).
 *  - Types compatibles (open↔open ou debate↔debate).
 *  - Pour les arènes à positions, alignement coherent, ambiguous ou inverted.
 *  - Si inverted : permutation des positions de la nouvelle arène en base avant
 *    la liaison (option A validée explicitement).
 *  - Toutes les erreurs sont non-bloquantes.
 */
async function tryCertamenAutoMerge(newDebateId, { question, content, option_a, option_b }) {
  try {
    const now = Date.now();
    const windowStart = new Date(now - CERTAMEN_MERGE_WINDOW_MS).toISOString();
    const windowEnd   = new Date(now - MIN_TREND_MATCH_GAP_MS).toISOString();

    const { data: recentRows } = await supabase
      .from("debates")
      .select("id, question, content, source_url, media_extras, created_at, keywords, type, option_a, option_b")
      .neq("id", String(newDebateId))
      .gte("created_at", windowStart)
      .lte("created_at", windowEnd)
      .order("created_at", { ascending: false })
      .limit(CERTAMEN_MERGE_CANDIDATES_LIMIT);

    if (!recentRows?.length) {
      console.log("[certamen-merge] aucun candidat dans la fenêtre 1h–36h");
      return;
    }

    const recentSubjects = recentRows.map((d) => {
      const extras = Array.isArray(d.media_extras) ? d.media_extras : [];
      const srcExtras = extras.filter((e) => e && typeof e === "object" &&
        String(e.type || "source").trim() === "source" &&
        (e.url || e.source_url || e.source || e.media || e.publisher));
      const srcKeys = new Set(srcExtras.map((e) =>
        String(e.url || e.source_url || e.source || e.media || e.publisher || "").trim().toLowerCase()
      ).filter(Boolean));
      if (!srcKeys.size && d.source_url) srcKeys.add(String(d.source_url).trim().toLowerCase());
      return {
        id: String(d.id),
        question: String(d.question || ""),
        resume: String(d.content || "").slice(0, 200),
        tags: normalizeKeywordList(d.keywords || [], 10, 60),
        sourceCount: srcKeys.size,
        created_at: d.created_at,
      };
    });

    const newSubject = {
      id: String(newDebateId),
      question: String(question || ""),
      resume: String(content || "").slice(0, 200),
      tags: [],
      sourceCount: 0,
    };

    const matched = await findSimilarRecentSubjectForTrend(newSubject, recentSubjects);
    if (!matched) {
      console.log("[certamen-merge] aucun sujet similaire → pas de fusion");
      return;
    }

    const confidence = Number(matched.confidence ?? 0);
    if (confidence < CERTAMEN_MERGE_CONFIDENCE_THRESHOLD) {
      console.log(`[certamen-merge] confiance ${confidence} < ${CERTAMEN_MERGE_CONFIDENCE_THRESHOLD} → pas de fusion`);
      return;
    }

    // Résoudre le canonique de l'arène matchée et charger ses données complètes
    const canonicalId = resolveSharedDebateId(matched.id) || String(matched.id);
    const { data: canonical, error: canonErr } = await supabase
      .from("debates")
      .select("id, type, option_a, option_b, question")
      .eq("id", canonicalId)
      .single();
    if (canonErr || !canonical) {
      console.log(`[certamen-merge] arène canonique ${canonicalId} introuvable → pas de fusion`);
      return;
    }

    // Garde-fou : les deux questions doivent poser le même débat (comparaison directe
    // avec le canonique résolu, avant toute modification en base).
    const sameDebate = await confirmSameDebateQuestionForMerge(question, canonical.question, "certamen-merge");
    if (!sameDebate) {
      console.log(`[certamen-merge] questions différentes (${newDebateId} vs canonique ${canonicalId}) → pas de fusion`);
      return;
    }

    // Vérification de compatibilité des types
    const newType    = inferVeilleDebateType(option_a, option_b);
    const canonType  = inferVeilleDebateType(canonical.option_a, canonical.option_b);
    if (newType !== canonType) {
      console.log(`[certamen-merge] types incompatibles (${newType} vs ${canonType}) → pas de fusion`);
      return;
    }

    // Pour les arènes à positions, vérifier l'alignement A/B
    if (newType === "debate") {
      const alignment = await evaluateVeilleMergeAlignment(canonical, {
        positionA: String(option_a || "").trim(),
        positionB: String(option_b || "").trim(),
        question: String(question || "").trim(),
      });

      if (!alignment.ok && alignment.verdict !== "inverted") {
        console.log(`[certamen-merge] alignement refusé (${alignment.verdict}) → pas de fusion`);
        return;
      }

      if (alignment.verdict === "inverted") {
        // Permuter option_a / option_b de la nouvelle arène en base avant liaison
        const { error: swapErr } = await supabase
          .from("debates")
          .update({
            option_a: String(option_b || "").trim(),
            option_b: String(option_a || "").trim(),
          })
          .eq("id", String(newDebateId));
        if (swapErr) {
          console.error(`[certamen-merge] erreur permutation positions (${newDebateId}) : ${swapErr.message} → pas de fusion`);
          return;
        }
        console.log(`[certamen-merge] positions permutées pour l'arène ${newDebateId}`);
      }
    }

    linkDebateToSharedSpace(newDebateId, canonicalId);
    clearDebatesApiResponseCache();
    console.log(`[certamen-merge] fusion automatique : ${newDebateId} → canonique ${canonicalId} | confiance ${confidence} | raison : "${matched.reason || "—"}" | "${String(canonical.question || "").slice(0, 60)}"`);
  } catch (err) {
    console.error("[certamen-merge] erreur non bloquante :", err.message);
  }
}

function normalizeSourceDomain(value) {
  const str = String(value || "").trim().toLowerCase();
  if (!str) return "";
  try {
    const u = new URL(str.startsWith("http") ? str : "http://" + str);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return str.split("/")[0].replace(/^www\./, "");
  }
}

function computePositionLabelSimilarity(labelA, labelB) {
  const textA = normalizeSimilarityText(labelA);
  const textB = normalizeSimilarityText(labelB);
  if (!textA || !textB) return 0;
  if (textA === textB) return 1;
  if (hasStrongSubstringMatch(textA, textB)) return 0.9;

  const tokensA = getSimilarityTokens(labelA);
  const tokensB = getSimilarityTokens(labelB);
  if (!tokensA.length || !tokensB.length) return 0;

  const overlap = computeTokenOverlapScore(tokensA, tokensB);
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const sharedLong = [...setA].filter(token => token.length >= 7 && setB.has(token)).length;
  if (sharedLong >= 2 && overlap >= 0.35) return Math.max(overlap, 0.72);
  if (sharedLong >= 1 && overlap >= 0.5) return Math.max(overlap, 0.68);
  return overlap;
}

function getPositionAlignmentHeuristic(existingA, existingB, newA, newB) {
  const directA = computePositionLabelSimilarity(existingA, newA);
  const directB = computePositionLabelSimilarity(existingB, newB);
  const swappedA = computePositionLabelSimilarity(existingA, newB);
  const swappedB = computePositionLabelSimilarity(existingB, newA);
  const directScore = (directA + directB) / 2;
  const swappedScore = (swappedA + swappedB) / 2;

  let verdict = 'ambiguous';
  const confidence = Math.abs(directScore - swappedScore);

  if (swappedScore >= 0.58 && swappedScore - directScore >= 0.12) {
    verdict = 'inverted';
  } else if (directScore >= 0.58 && directScore - swappedScore >= 0.08) {
    verdict = 'coherent';
  }

  return {
    verdict,
    directScore: Number(directScore.toFixed(3)),
    swappedScore: Number(swappedScore.toFixed(3)),
    confidence: Number(confidence.toFixed(3))
  };
}

async function evaluateVeilleMergeAlignmentWithAI(existingDebate, incomingPositions, attempt = 1) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    // Le contexte des questions aide l'IA à trancher quand les libellés de position
    // sont reformulés sans aucun mot commun (cf. incident Le Pen du 9 juillet où le
    // pool lexical direct/inversé valait 0 des deux côtés) : la question donne le sens
    // de "A" et "B" même si le vocabulaire des positions diffère totalement.
    const prompt = [
      "Tu vérifies la cohérence d'une fusion entre deux arènes à positions qui portent sur le même sujet.",
      "Dis si la nouvelle position A correspond plutôt à l'ancienne position A, à l'ancienne position B, ou si c'est ambigu.",
      "Base-toi sur le sens (pour/contre, favorable/opposé), pas sur la formulation littérale : deux positions peuvent être reformulées entièrement différemment tout en visant le même camp.",
      'Réponds uniquement en JSON: {"verdict":"coherent|inverted|ambiguous","reason":"..."}',
      '',
      'Arène existante :',
      'Question: ' + String(existingDebate.question || '').trim(),
      'A: ' + String(existingDebate.option_a || '').trim(),
      'B: ' + String(existingDebate.option_b || '').trim(),
      '',
      'Nouvelle arène :',
      'Question: ' + String(incomingPositions.question || '').trim(),
      'A: ' + String(incomingPositions.positionA || '').trim(),
      'B: ' + String(incomingPositions.positionB || '').trim()
    ].join("\n");

    const requestStartedAt = Date.now();
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 180,
        temperature: 0
      })
    });

    if (!r.ok) {
      recordAiUsage(supabase, { feature: 'veille_deduplication', model: 'gpt-4o-mini', latencyMs: Date.now() - requestStartedAt, success: false, error: `openai http ${r.status}` });
      throw new Error(`openai http ${r.status}`);
    }
    const data = await r.json();
    const { inputTokens, outputTokens, cachedTokens } = extractUsage(data?.usage);
    recordAiUsage(supabase, { feature: 'veille_deduplication', model: 'gpt-4o-mini', inputTokens, outputTokens, cachedTokens, latencyMs: Date.now() - requestStartedAt, success: true });
    const content = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
    if (!content) throw new Error('openai empty content');
    const parsed = JSON.parse(content);
    const verdict = ['coherent', 'inverted', 'ambiguous'].includes(parsed && parsed.verdict) ? parsed.verdict : 'ambiguous';
    return {
      verdict,
      reason: String((parsed && parsed.reason) || '').trim()
    };
  } catch (error) {
    // Une panne réseau/quota transitoire ne doit pas se traduire silencieusement par
    // un "ambiguous" qui laisse passer une fusion mal alignée (cf. incident Le Pen) :
    // on retente une fois avant d'abandonner.
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return evaluateVeilleMergeAlignmentWithAI(existingDebate, incomingPositions, attempt + 1);
    }
    console.error('[alignment-ai] échec après retry :', error.message);
    return null;
  }
}

async function evaluateVeilleMergeAlignment(existingDebate, incomingPositions) {
  const type = inferVeilleDebateType(incomingPositions && incomingPositions.positionA, incomingPositions && incomingPositions.positionB);
  if (type !== 'debate') {
    return { ok: true, verdict: 'not_applicable', message: '' };
  }

  const existingType = inferVeilleDebateType(existingDebate && existingDebate.option_a, existingDebate && existingDebate.option_b);
  if (existingType !== 'debate') {
    return {
      ok: false,
      verdict: 'type_mismatch',
      message: 'Fusion impossible : tu ne peux pas fusionner une arène à positions avec une arène libre.'
    };
  }

  const heuristic = getPositionAlignmentHeuristic(
    existingDebate.option_a,
    existingDebate.option_b,
    incomingPositions.positionA,
    incomingPositions.positionB
  );

  let finalVerdict = heuristic.verdict;
  let aiReason = '';
  let aiAnswered = false;
  if (heuristic.verdict === 'ambiguous' || heuristic.confidence < 0.12) {
    const aiResult = await evaluateVeilleMergeAlignmentWithAI(existingDebate, incomingPositions);
    if (aiResult && aiResult.verdict) {
      finalVerdict = aiResult.verdict;
      aiReason = aiResult.reason || '';
      aiAnswered = true;
    }
  }

  if (finalVerdict === 'coherent') {
    return { ok: true, verdict: 'coherent', message: '', directScore: heuristic.directScore, swappedScore: heuristic.swappedScore };
  }

  if (finalVerdict === 'inverted') {
    return {
      ok: false,
      verdict: 'inverted',
      message: aiReason || "La nouvelle position A semble correspondre à l'ancienne position B. Vérifie ou inverse les positions avant la fusion.",
      directScore: heuristic.directScore,
      swappedScore: heuristic.swappedScore
    };
  }

  // Signal lexical nul des deux côtés (aucun mot commun, direct/inversé à 0) : c'est
  // exactement le cas qui a fusionné l'arène 1594 avec des positions inversées le 9
  // juillet, car l'ambiguïté "par défaut" était traitée comme un feu vert silencieux.
  // Si l'IA n'a pas pu trancher non plus, on refuse la fusion auto plutôt que de deviner.
  const noLexicalSignal = heuristic.directScore < 0.05 && heuristic.swappedScore < 0.05;
  if (noLexicalSignal && !aiAnswered) {
    return {
      ok: false,
      verdict: 'ambiguous',
      message: "Aucun mot commun entre les positions existantes et nouvelles, et la vérification IA n'a pas pu trancher : fusion refusée pour éviter d'inverser les positions par erreur.",
      directScore: heuristic.directScore,
      swappedScore: heuristic.swappedScore
    };
  }

  return {
    ok: true,
    verdict: 'ambiguous',
    message: aiReason || "La correspondance entre les anciennes et nouvelles positions n'est pas totalement certaine. Vérifie-les si besoin, mais la fusion peut continuer.",
    directScore: heuristic.directScore,
    swappedScore: heuristic.swappedScore
  };
}

function getNotificationContentLabel(value, maxLength = 90) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function quoteNotificationContent(value, maxLength = 90) {
  const label = getNotificationContentLabel(value, maxLength);
  return label ? `« ${label} »` : "";
}

async function _sendPushNow(userKey, { type, message, debate_id = null, argument_id = null, comment_id = null, notification_id = null }) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  const event = await createNotificationEventSafe(supabase, {
    eventType: type,
    actorLegacyKey: null,
    recipientLegacyKey: userKey,
    debateId: debate_id,
    argumentId: argument_id,
    commentId: comment_id,
    payload: { message, notification_id }
  });
  if (!event?.id) return;
  await sendNotificationEventPushById(supabase, {
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
    subject: VAPID_SUBJECT
  }, event.id);
}

async function createNotification({
  user_key,
  type,
  debate_id = null,
  argument_id = null,
  comment_id = null,
  message
}) {
  if (!user_key || !message || !type) return;

  const notificationRow = {
    user_key,
    type,
    debate_id,
    argument_id,
    comment_id,
    message,
    is_read: 0,
    created_at: nowIso()
  };

  // .maybeSingle() plutôt que .single() : ne jette pas si le insert+select
  // combiné ne renvoie pas exactement une ligne, mais reste un aller-retour
  // atomique fiable (avec la clé service role, qui contourne les policies RLS)
  // — bien plus robuste qu'une seconde requête de recherche par contenu, qui
  // peut matcher la mauvaise ligne ou n'en trouver aucune en cas de doublon.
  const { data: insertedNotification, error: notificationInsertError } = await supabase
    .from("notifications")
    .insert(notificationRow)
    .select("id")
    .maybeSingle();

  if (notificationInsertError) throw notificationInsertError;

  clearNotificationsApiResponseCache();
  _sendPushNow(user_key, {
    type,
    message,
    debate_id,
    argument_id,
    comment_id,
    notification_id: insertedNotification?.id || null
  }).catch(console.error);
}

// Map<argumentId (string), {authorKey, debateId, side, wasMajorityAtPost}>
const majorityWatchers = new Map();

async function snapshotAndWatchMajority(debateId, argId, side, authorKey) {
  if (!authorKey) return;
  const debate = await getDebateById(debateId);
  if (!debate || String(debate.type || "").trim().toLowerCase() === "open") return;

  const args = await getArgumentsByDebateId(debateId);
  const existing = args.filter(a => String(a.id) !== String(argId));
  const { percentA, percentB, votesA, votesB } = computeDebatePercents(existing);
  const totalVotes = votesA + votesB;
  const wasMajority = totalVotes === 0 ? false
    : side === "A" ? percentA > 50 : percentB > 50;

  majorityWatchers.set(String(argId), {
    authorKey,
    debateId: String(debateId),
    side,
    wasMajorityAtPost: wasMajority,
    createdAt: Date.now()
  });
}

setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [argId, w] of majorityWatchers) {
    if (w.createdAt && w.createdAt < cutoff) majorityWatchers.delete(argId);
  }
}, 60 * 60 * 1000).unref();

async function checkMajorityFlips(debateId) {
  const toCheck = [];
  for (const [argId, w] of majorityWatchers) {
    if (w.debateId === String(debateId)) toCheck.push({ argId, w });
  }
  if (toCheck.length === 0) return;

  const [args, debate] = await Promise.all([
    getArgumentsByDebateId(debateId),
    getDebateById(debateId)
  ]);
  const { percentA, percentB, votesA, votesB } = computeDebatePercents(args);
  const totalVotes = votesA + votesB;

  for (const { argId, w } of toCheck) {
    const currentHasMajority = totalVotes === 0 ? false
      : w.side === "A" ? percentA > 50 : percentB > 50;

    let notifType = null;
    let message = null;
    const sideName = w.side === "A" ? (debate?.option_a || "Votre camp") : (debate?.option_b || "Votre camp");
    const questionLabel = quoteNotificationContent(debate?.question || "ce débat");

    if (!w.wasMajorityAtPost && currentHasMajority) {
      notifType = "majority_gained";
      message = `Votre camp « ${sideName} » vient de prendre la majorité dans ${questionLabel}.`;
    } else if (w.wasMajorityAtPost && !currentHasMajority) {
      notifType = "majority_lost";
      message = `Votre camp « ${sideName} » vient de perdre la majorité dans ${questionLabel}.`;
    }

    if (notifType) {
      majorityWatchers.delete(argId);
      await createNotification({
        user_key: w.authorKey,
        type: notifType,
        debate_id: Number(debateId),
        argument_id: Number(argId),
        message
      });
    }
  }
}

const VOTE_NOTIFICATION_AGGREGATION_WINDOW_MS = 60 * 1000;
const voteNotificationMergeQueues = new Map();

function buildVoteNotificationMergeKey(userKey, argumentId) {
  return `${String(userKey || "").trim()}::${String(argumentId || "").trim()}`;
}

async function createOrMergeVoteNotificationNow({
  user_key,
  debate_id = null,
  argument_id = null,
  argument_title = "",
  vote_count_increment = 1,
  push_on_merge = false
}) {
  if (!user_key || !argument_id) return;

  const ideaLabel = quoteNotificationContent(argument_title || "cette idée");
  const increment = Math.max(1, Math.round(Number(vote_count_increment || 1)));
  const windowStartIso = new Date(Date.now() - VOTE_NOTIFICATION_AGGREGATION_WINDOW_MS).toISOString();
  const { data: recentNotification, error } = await supabase
    .from("notifications")
    .select("id,message,created_at")
    .eq("user_key", user_key)
    .eq("argument_id", argument_id)
    .eq("type", "vote_on_argument")
    .gte("created_at", windowStartIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  if (!recentNotification) {
    await createNotification({
      user_key,
      type: "vote_on_argument",
      debate_id,
      argument_id,
      message: `Votre idée ${ideaLabel} a reçu ${increment} voix.`
    });
    return;
  }

  const matched = String(recentNotification.message || "").match(/a reçu\s+(\d+)\s+voix?/i);
  const currentCount = matched ? Number.parseInt(matched[1], 10) : 1;
  const nextCount = Math.max(2, currentCount + increment);
  const nextMessage = `Votre idée ${ideaLabel} a reçu ${nextCount} voix.`;

  const { error: updateError } = await supabase
    .from("notifications")
    .update({
      debate_id,
      argument_id,
      message: nextMessage,
      is_read: 0,
      created_at: nowIso()
    })
    .eq("id", recentNotification.id);

  if (updateError) throw updateError;
  clearNotificationsApiResponseCache();

  if (push_on_merge) {
    await _sendPushNow(user_key, {
      type: "vote_on_argument",
      message: nextMessage,
      debate_id,
      argument_id,
      notification_id: recentNotification.id
    }).catch((pushError) => {
      console.error("[vote notification push]", pushError);
    });
  }
}

function createOrMergeVoteNotification(payload) {
  const mergeKey = buildVoteNotificationMergeKey(payload?.user_key, payload?.argument_id);
  const previous = voteNotificationMergeQueues.get(mergeKey) || Promise.resolve();

  const next = previous
    .catch(() => {})
    .then(() => createOrMergeVoteNotificationNow(payload));

  voteNotificationMergeQueues.set(mergeKey, next);

  return next.finally(() => {
    if (voteNotificationMergeQueues.get(mergeKey) === next) {
      voteNotificationMergeQueues.delete(mergeKey);
    }
  });
}

async function getDebateById(id, { full = false } = {}) {
  const { data, error } = await supabase
    .from("debates")
    .select(full ? "*" : DEBATE_DETAIL_SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return enrichDebateWithStoredImage(data);
}

async function getArgumentById(id) {
  const { data, error } = await supabase
    .from("arguments")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return enrichDebateWithStoredImage(data);
}

async function getCommentById(id) {
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return enrichDebateWithStoredImage(data);
}

async function getArgumentsByDebateId(debateId) {
  const sharedDebateId = resolveSharedDebateId(debateId);
  const { data, error } = await supabase
    .from("arguments")
    .select("*")
    .eq("debate_id", sharedDebateId || debateId)
    .order("id", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getCommentsByArgumentIds(argumentIds) {
  if (!argumentIds.length) return [];

  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .in("argument_id", argumentIds)
    .order("id", { ascending: true });

  if (error) throw error;

  const comments = data || [];
  if (!comments.length) return [];

  const commentIds = comments.map((c) => c.id);
  const { data: likesRows, error: likesErr } = await supabase
    .from("comment_likes")
    .select("comment_id,value")
    .in("comment_id", commentIds);

  if (likesErr) throw likesErr;

  const likesMap = new Map();
  for (const row of likesRows || []) {
    const current = Number(likesMap.get(row.comment_id) || 0);
    likesMap.set(row.comment_id, current + Number(row.value || 0));
  }

  return comments.map((c) => ({
    ...c,
    likes: Number(likesMap.get(c.id) || 0)
  }));
}

async function getCommentLikesTotal(commentId) {
  const { data, error } = await supabase
    .from("comment_likes")
    .select("value")
    .eq("comment_id", commentId);

  if (error) throw error;

  return (data || []).reduce((sum, row) => sum + Number(row.value || 0), 0);
}

async function getVoteRow(argumentId, voterKey) {
  const { data, error } = await supabase
    .from("votes")
    .select("*")
    .eq("argument_id", argumentId)
    .eq("voter_key", voterKey)
    .maybeSingle();

  if (error) throw error;
  return enrichDebateWithStoredImage(data);
}

// Les pages HTML ne doivent jamais rester suspendues à une lecture Supabase
// lente : au-delà de ce délai, la route bascule dans son catch et sert le
// gabarit avec des meta génériques (seuls les aperçus sociaux y perdent).
const HTML_META_DB_TIMEOUT_MS = 3000;
function withHtmlMetaDbTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Lecture Supabase > ${HTML_META_DB_TIMEOUT_MS}ms, meta génériques servies`)),
        HTML_META_DB_TIMEOUT_MS
      );
      if (typeof timer.unref === "function") timer.unref();
    })
  ]);
}

app.get("/", (req, res) => {
  const template = readViewTemplate("index.html");
  const html = replaceMetaPlaceholders(template, buildIndexMeta(req));
  res.set("Cache-Control", "no-store").type("html").send(html);
});

app.get("/debates", (req, res) => {
  const template = readViewTemplate("index.html");
  const html = replaceMetaPlaceholders(template, buildIndexMeta(req));
  res.set("Cache-Control", "no-store").type("html").send(html);
});

app.get("/debates/:id", async (req, res) => {
  const template = readViewTemplate("index.html");
  const debateId = String(req.params.id || "").trim();
  try {
    const debate = debateId ? await withHtmlMetaDbTimeout(getDebateById(debateId)) : null;
    if (debate) {
      const meta = buildDebateMeta(req, debate);
      meta.url = buildAbsoluteUrl(req, `/debates/${encodeURIComponent(debateId)}`);
      const html = replaceMetaPlaceholders(template, meta);
      return res.set("Cache-Control", "no-store").type("html").send(html);
    }
  } catch (error) {
    console.error(error);
  }
  const html = replaceMetaPlaceholders(template, buildIndexMeta(req));
  res.set("Cache-Control", "no-store").type("html").send(html);
});

app.get("/create", (req, res) => {
  res.set("Cache-Control", "no-store").sendFile(path.join(__dirname, "views/create.html"));
});

app.get("/notifications", (req, res) => {
  res.set("Cache-Control", "public, max-age=300").sendFile(path.join(__dirname, "views/notifications.html"));
});

// Page autonome des scores et contributions. Elle partage le gabarit de Ma mémoire,
// mais son mode de page masque entièrement l'univers neuronal.
app.get("/contributions", (req, res) => {
  res.set("Cache-Control", "public, max-age=300").sendFile(path.join(__dirname, "views/mon-univers.html"));
});

// Classement global "Les meilleures idées", extrait de /mon-univers vers sa
// propre entrée de menu (accessible depuis le bandeau haut).
app.get("/meilleures-idees", (req, res) => {
  res.set("Cache-Control", "public, max-age=300").sendFile(path.join(__dirname, "views/meilleures-idees.html"));
});

app.get("/autres-sources", (req, res) => {
  res.set("Cache-Control", "no-store").sendFile(path.join(__dirname, "views/autres-sources.html"));
});

// Score percentile d'un utilisateur ("top X%") sur 2 axes indépendants :
// voix reçues (total sur toutes ses idées) et note IA (moyenne des idées
// notées). Population = seulement les auteurs actifs sur l'axe concerné
// (au moins 1 idée postée / au moins 1 idée notée par l'IA), pour ne pas
// gonfler artificiellement le classement avec des comptes jamais actifs.
// Calcul lourd (scan de toutes les idées + tous les débats analysés) :
// caché en mémoire process, servi immédiatement puis rafraîchi en fond une
// fois périmé (même logique stale-while-revalidate que les cloud bubbles).
let _userScoreCache = null;
let _userScoreCacheComputedAt = 0;
let _userScoreRefreshPromise = null;
const USER_SCORE_CACHE_TTL_MS = 15 * 60 * 1000;

// Score% = part de la population dont la valeur est strictement supérieure
// à celle de l'utilisateur — ex: 2% signifie que 98% des autres ont moins.
// Valeur initiale affichée pour un axe où le contributeur n'a encore rien
// posté/répondu. Ce 100 % explicite est distinct du pire percentile réellement
// calculé, qui reste borné à 99,9 % dans buildPercentileScoreMap.
const USER_SCORE_EMPTY = 100;

function buildPercentileScoreMap(valueByAuthorKey) {
  const entries = [...valueByAuthorKey.entries()];
  const n = entries.length;
  const result = new Map();
  if (!n) return result;

  const sortedDesc = entries.map(([, value]) => value).sort((a, b) => b - a);
  for (const [authorKey, value] of entries) {
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedDesc[mid] > value) lo = mid + 1; else hi = mid;
    }
    let pct = Math.round((lo / n) * 100);
    // "Top 0%" (meilleur absolu) et "Top 100%" (dernier absolu) sonnent comme un
    // bug plutôt qu'un vrai classement : on borne les deux extrêmes à 0,1 % et
    // 99,9 % au lieu de 0 et 100 pile.
    if (pct <= 0) pct = 0.1;
    else if (pct >= 100) pct = 99.9;
    result.set(authorKey, pct);
  }
  return result;
}

// Paliers de volume (nombre d'idées postées, même compteur pour les 2 axes) :
// un contributeur n'est comparé qu'à d'autres de volume similaire, pour ne
// pas laisser un gros contributeur écraser mécaniquement les petits (surtout
// sur l'axe voix, basé sur un total qui grossit avec le nombre d'idées).
const USER_SCORE_TIERS = [
  { tier: 1, max: 1, label: "1 idée postée" },
  { tier: 2, max: 3, label: "2 à 3 idées postées" },
  { tier: 3, max: 9, label: "4 à 9 idées postées" },
  { tier: 4, max: Infinity, label: "10 idées postées ou plus" }
];

function getUserContributionTier(count) {
  for (const t of USER_SCORE_TIERS) {
    if (count <= t.max) return t.tier;
  }
  return USER_SCORE_TIERS[USER_SCORE_TIERS.length - 1].tier;
}

function getUserContributionTierLabel(tier) {
  return USER_SCORE_TIERS.find((t) => t.tier === tier)?.label || "";
}

// Paliers de volume pour le score Gnosis (QCM de notions) : mêmes proportions
// que USER_SCORE_TIERS (1 / 3 / 9 / +) mais mises à l'échelle du rythme des
// QCM plutôt que du rythme de publication d'idées — sinon un visiteur qui
// répond régulièrement se retrouverait comparé à quelqu'un qui n'a répondu
// qu'une fois.
const GNOSIS_SCORE_TIERS = [
  { tier: 1, max: 10, label: "10 questions répondues ou moins" },
  { tier: 2, max: 30, label: "11 à 30 questions répondues" },
  { tier: 3, max: 90, label: "31 à 90 questions répondues" },
  { tier: 4, max: Infinity, label: "91 questions répondues ou plus" }
];

function getGnosisTier(count) {
  for (const t of GNOSIS_SCORE_TIERS) {
    if (count <= t.max) return t.tier;
  }
  return GNOSIS_SCORE_TIERS[GNOSIS_SCORE_TIERS.length - 1].tier;
}

function getGnosisTierLabel(tier) {
  return GNOSIS_SCORE_TIERS.find((t) => t.tier === tier)?.label || "";
}

// Effectif plancher affiché pour chaque palier Gnosis (point de départ),
// tant que le nombre réel d'utilisateurs du palier ne l'a pas dépassé.
const GNOSIS_TIER_MIN_USERS = 1000;

// Applique buildPercentileScoreMap indépendamment à l'intérieur de chaque
// palier plutôt que sur toute la population d'un coup.
function buildTieredPercentileScoreMap(valueByAuthorKey, tierByAuthorKey, tiers = USER_SCORE_TIERS) {
  const byTier = new Map(tiers.map((t) => [t.tier, new Map()]));
  for (const [authorKey, value] of valueByAuthorKey) {
    const tier = tierByAuthorKey.get(authorKey) || 1;
    byTier.get(tier).set(authorKey, value);
  }

  const result = new Map();
  for (const tierMap of byTier.values()) {
    for (const [authorKey, score] of buildPercentileScoreMap(tierMap)) {
      result.set(authorKey, score);
    }
  }
  return result;
}

async function computeUserScores() {
  const { data: allArguments, error: argsError } = await fetchAllSupabaseRows(() =>
    supabase.from("arguments").select("id, author_key, votes").not("author_key", "is", null));
  if (argsError) throw argsError;

  const votesTotalByAuthorKey = new Map();
  const contributionCountByAuthorKey = new Map();
  const authorKeyByArgumentId = new Map();
  for (const arg of allArguments || []) {
    const authorKey = String(arg.author_key || "").trim();
    if (!authorKey) continue;
    votesTotalByAuthorKey.set(authorKey, (votesTotalByAuthorKey.get(authorKey) || 0) + Number(arg.votes || 0));
    contributionCountByAuthorKey.set(authorKey, (contributionCountByAuthorKey.get(authorKey) || 0) + 1);
    authorKeyByArgumentId.set(String(arg.id), authorKey);
  }

  const tierByAuthorKey = new Map();
  for (const [authorKey, count] of contributionCountByAuthorKey) {
    tierByAuthorKey.set(authorKey, getUserContributionTier(count));
  }

  // Scoring par idée seulement (colonne légère) — pas le texte complet de
  // l'analyse, retéléchargé en entier sinon à chaque refresh de ce cache
  // (TTL 15 min) pour tous les débats analysés. Cf. data/migration-debates-arg-scores.sql.
  const { data: analyzedDebates, error: debatesError } = await fetchAllSupabaseRows(() =>
    supabase.from("debates").select("id, ai_analysis_arg_scores").not("ai_analysis_arg_scores", "is", null));
  if (debatesError) throw debatesError;

  const scoreByArgumentId = new Map();
  for (const row of analyzedDebates || []) {
    for (const [argId, entry] of Object.entries(row.ai_analysis_arg_scores || {})) {
      scoreByArgumentId.set(argId, entry);
    }
  }

  const noteSumByAuthorKey = new Map();
  const noteCountByAuthorKey = new Map();
  for (const [argumentId, entry] of scoreByArgumentId) {
    const authorKey = authorKeyByArgumentId.get(String(argumentId));
    if (!authorKey) continue;
    noteSumByAuthorKey.set(authorKey, (noteSumByAuthorKey.get(authorKey) || 0) + entry.score);
    noteCountByAuthorKey.set(authorKey, (noteCountByAuthorKey.get(authorKey) || 0) + 1);
  }
  const noteAvgByAuthorKey = new Map();
  for (const [authorKey, sum] of noteSumByAuthorKey) {
    noteAvgByAuthorKey.set(authorKey, sum / noteCountByAuthorKey.get(authorKey));
  }

  // Tailles de population par axe (pédagogique : affichées dans la modale
  // avec le score). Chaque axe a sa propre population (Rhetor = auteurs avec
  // ≥1 idée postée, Logos = auteurs avec ≥1 idée notée), donc son propre
  // total et sa propre taille de palier — pas les mêmes effectifs.
  const votesTierSizeByTier = new Map();
  for (const authorKey of votesTotalByAuthorKey.keys()) {
    const tier = tierByAuthorKey.get(authorKey) || 1;
    votesTierSizeByTier.set(tier, (votesTierSizeByTier.get(tier) || 0) + 1);
  }
  const notesTierSizeByTier = new Map();
  for (const authorKey of noteAvgByAuthorKey.keys()) {
    const tier = tierByAuthorKey.get(authorKey) || 1;
    notesTierSizeByTier.set(tier, (notesTierSizeByTier.get(tier) || 0) + 1);
  }

  // Réponses brutes au QCM — utilisées ci-dessous pour Gnosis (repasses
  // "Ancrer") et plus bas pour Noesis (QCM "Relier").
  const { data: rawQuizAnswers, error: quizAnswersError } = await fetchAllSupabaseRows(() =>
    supabase.from("daily_quiz_answers").select("voter_key, quiz_date, question_id, option_index"));
  if (quizAnswersError) throw quizAnswersError;

  // Score Gnosis (redéfini le 17/08/2026 : ce n'est plus la justesse sur du
  // contenu frais — voir git blame pour l'ancienne version — mais la justesse
  // aux repasses du pseudo-slot "Ancrer" (DAILY_QUIZ_REINFORCEMENT_SLOT)
  // uniquement, reprise de l'ancien score "Ancrage" sous ce nouveau nom).
  // Toujours les deux formes affichées côté client : un taux de réussite BRUT
  // (gnosisAnswered/gnosisCorrect) ET un classement percentile (gnosisScore,
  // "Top X%", mêmes paliers de volume que Noesis ci-dessous).
  //
  // Ne rejoue jamais correctIndex/daily_quiz nous-mêmes : memory_review_events
  // porte déjà is_correct, calculé une fois pour toutes au moment de la
  // réponse (cf. applyFsrsReviewForDailyQuizAnswer). Seule question ouverte :
  // cette table contient AUSSI la toute première review de chaque MemoryItem
  // (l'exposition initiale via "Découvrir", jamais via "Ancrer" — cf.
  // upsertMemoryItemForNotionAnswer, questionId préfixé "notion:" et non
  // "cgreview-" à ce moment-là). On l'exclut donc explicitement : pour un
  // (user_id, memory_item_id) donné, seule la PREMIÈRE ligne chronologique
  // est une exposition Découvrir, toutes les suivantes sont nécessairement
  // des repasses Ancrer (aucun autre chemin ne re-sert un memory_item déjà
  // répondu — cf. la contrainte d'unicité de daily_quiz_answers combinée à
  // isNewAnswer côté /answer, qui empêche même un second passage identique
  // via "Découvrir" de générer un nouvel événement).
  const { data: rawReviewEvents, error: reviewEventsError } = await fetchAllSupabaseRows(() =>
    supabase.from("memory_review_events")
      .select("user_id, memory_item_id, is_correct, reviewed_at")
      .order("reviewed_at", { ascending: true }));
  if (reviewEventsError) throw reviewEventsError;

  const { data: userRowsForAncrer, error: userRowsForAncrerError } = await fetchAllSupabaseRows(() =>
    supabase.from("users").select("id, legacy_key"));
  if (userRowsForAncrerError) throw userRowsForAncrerError;
  const legacyKeyByUserId = new Map((userRowsForAncrer || []).map((u) => [u.id, u.legacy_key]));

  const seenUserMemoryItemPairs = new Set();
  const gnosisAnsweredByAuthorKey = new Map();
  const gnosisCorrectByAuthorKey = new Map();
  for (const ev of rawReviewEvents || []) {
    const pairKey = `${ev.user_id}:${ev.memory_item_id}`;
    const isFirstReview = !seenUserMemoryItemPairs.has(pairKey);
    seenUserMemoryItemPairs.add(pairKey);
    if (isFirstReview) continue; // exposition Découvrir, jamais une repasse Ancrer
    const authorKey = legacyKeyByUserId.get(ev.user_id);
    if (!authorKey) continue;
    gnosisAnsweredByAuthorKey.set(authorKey, (gnosisAnsweredByAuthorKey.get(authorKey) || 0) + 1);
    if (ev.is_correct) gnosisCorrectByAuthorKey.set(authorKey, (gnosisCorrectByAuthorKey.get(authorKey) || 0) + 1);
  }

  const gnosisTierByAuthorKey = new Map();
  for (const [authorKey, count] of gnosisAnsweredByAuthorKey) {
    gnosisTierByAuthorKey.set(authorKey, getGnosisTier(count));
  }
  const gnosisAccuracyByAuthorKey = new Map();
  for (const [authorKey, answered] of gnosisAnsweredByAuthorKey) {
    gnosisAccuracyByAuthorKey.set(authorKey, ((gnosisCorrectByAuthorKey.get(authorKey) || 0) / answered) * 100);
  }
  const gnosisTierRawSizeByTier = new Map();
  for (const authorKey of gnosisAccuracyByAuthorKey.keys()) {
    const tier = gnosisTierByAuthorKey.get(authorKey) || 1;
    gnosisTierRawSizeByTier.set(tier, (gnosisTierRawSizeByTier.get(tier) || 0) + 1);
  }
  const gnosisTierSizeByTier = new Map();
  for (const t of GNOSIS_SCORE_TIERS) {
    gnosisTierSizeByTier.set(t.tier, Math.max(GNOSIS_TIER_MIN_USERS, gnosisTierRawSizeByTier.get(t.tier) || 0));
  }
  const gnosisTotalUsers = [...gnosisTierSizeByTier.values()].reduce((sum, size) => sum + size, 0);

  // Score Noesis (demande du 17/08/2026) : compréhension des liens, QCM
  // "Relier" (pseudo-slot DAILY_QUIZ_COMPREHENSION_SLOT) uniquement. Comme
  // Gnosis ci-dessus : un taux de réussite BRUT ET un score percentile
  // ("comparaison des utilisateurs sur 100"), mêmes paliers de volume
  // (GNOSIS_SCORE_TIERS, mêmes proportions) puisque "Relier" suit le même
  // rythme de réponse au QCM.
  //
  // Ne peut PAS réutiliser memory_review_events comme Gnosis ci-dessus : une
  // question "comprendre:{pairHash}-qN" déjà répondue peut, une fois due,
  // ressurgir plus tard dans "Ancrer" sous l'id "cgreview-comprendre:{pairHash}-qN"
  // (fetchCultureGeneraleReviewInjectionForToday ne filtre pas les slots
  // "notion:comprendre:%" hors de sa rotation) — un simple "1re review exclue"
  // par memory_item confondrait alors une repasse Ancrer avec une réponse
  // Relier. Le préfixe "comprendre:" sur daily_quiz_answers.question_id
  // lui-même reste le seul signal fiable de "répondu depuis l'onglet Relier"
  // (même logique de préfixe que cgreview- pour distinguer Ancrer/Découvrir).
  //
  // Résolution du correctIndex : identique à la branche "comprendre:" de
  // applyFsrsReviewForDailyQuizAnswer (le pseudo-slot agrégateur "comprendre"
  // transmis par le client n'est jamais le vrai slot où vit la question dans
  // daily_quiz — reconstruit ici depuis le questionId lui-même), mais en
  // groupé plutôt que question par question.
  const relierAnswers = (rawQuizAnswers || []).filter((a) => /^comprendre:[0-9a-f]{20}-q\d+$/.test(String(a.question_id || "")));
  const relierPairSlots = [...new Set(relierAnswers.map((a) => {
    const m = /^comprendre:([0-9a-f]{20})-q\d+$/.exec(a.question_id);
    return m ? `notion:comprendre:${m[1]}` : null;
  }).filter(Boolean))];

  const correctIndexByComprendreQuestionId = new Map();
  if (relierPairSlots.length) {
    const { data: comprendreQuizRows, error: comprendreQuizRowsError } = await fetchAllSupabaseRowsIn(relierPairSlots, (chunk) =>
      supabase.from("daily_quiz").select("slot, quiz_date, questions").in("slot", chunk));
    if (comprendreQuizRowsError) throw comprendreQuizRowsError;
    // Un seul row par slot en pratique (jamais régénéré tant qu'il en existe déjà un, cf.
    // ensureCultureGeneraleComprehensionQuizPersisted) — si plusieurs existaient quand même,
    // garde le plus récent par slot (même convention "dernière génération gagne" que cgreview-).
    const comprendreRowsBySlot = new Map();
    for (const row of comprendreQuizRows || []) {
      const existing = comprendreRowsBySlot.get(row.slot);
      if (!existing || row.quiz_date > existing.quiz_date) comprendreRowsBySlot.set(row.slot, row);
    }
    for (const row of comprendreRowsBySlot.values()) {
      for (const q of row.questions || []) correctIndexByComprendreQuestionId.set(q.id, q.correctIndex);
    }
  }

  const relierAnsweredByAuthorKey = new Map();
  const relierCorrectByAuthorKey = new Map();
  for (const a of relierAnswers) {
    const voterKey = String(a.voter_key || "").trim();
    if (!voterKey) continue;
    relierAnsweredByAuthorKey.set(voterKey, (relierAnsweredByAuthorKey.get(voterKey) || 0) + 1);
    const correctIndex = correctIndexByComprendreQuestionId.get(a.question_id);
    if (correctIndex !== undefined && Number(a.option_index) === Number(correctIndex)) {
      relierCorrectByAuthorKey.set(voterKey, (relierCorrectByAuthorKey.get(voterKey) || 0) + 1);
    }
  }

  const noesisTierByAuthorKey = new Map();
  for (const [authorKey, count] of relierAnsweredByAuthorKey) {
    noesisTierByAuthorKey.set(authorKey, getGnosisTier(count));
  }

  const relierAccuracyByAuthorKey = new Map();
  for (const [authorKey, answered] of relierAnsweredByAuthorKey) {
    relierAccuracyByAuthorKey.set(authorKey, ((relierCorrectByAuthorKey.get(authorKey) || 0) / answered) * 100);
  }

  const noesisTierRawSizeByTier = new Map();
  for (const authorKey of relierAccuracyByAuthorKey.keys()) {
    const tier = noesisTierByAuthorKey.get(authorKey) || 1;
    noesisTierRawSizeByTier.set(tier, (noesisTierRawSizeByTier.get(tier) || 0) + 1);
  }
  const noesisTierSizeByTier = new Map();
  for (const t of GNOSIS_SCORE_TIERS) {
    noesisTierSizeByTier.set(t.tier, Math.max(GNOSIS_TIER_MIN_USERS, noesisTierRawSizeByTier.get(t.tier) || 0));
  }
  const noesisTotalUsers = [...noesisTierSizeByTier.values()].reduce((sum, size) => sum + size, 0);

  return {
    votesScoreByAuthorKey: buildTieredPercentileScoreMap(votesTotalByAuthorKey, tierByAuthorKey),
    notesScoreByAuthorKey: buildTieredPercentileScoreMap(noteAvgByAuthorKey, tierByAuthorKey),
    gnosisScoreByAuthorKey: buildTieredPercentileScoreMap(gnosisAccuracyByAuthorKey, gnosisTierByAuthorKey, GNOSIS_SCORE_TIERS),
    noesisScoreByAuthorKey: buildTieredPercentileScoreMap(relierAccuracyByAuthorKey, noesisTierByAuthorKey, GNOSIS_SCORE_TIERS),
    tierByAuthorKey,
    gnosisTierByAuthorKey,
    noesisTierByAuthorKey,
    votesTotalUsers: votesTotalByAuthorKey.size,
    notesTotalUsers: noteAvgByAuthorKey.size,
    gnosisTotalUsers,
    noesisTotalUsers,
    votesTierSizeByTier,
    notesTierSizeByTier,
    gnosisTierSizeByTier,
    noesisTierSizeByTier,
    // Valeurs brutes (pas seulement le percentile) — affichées telles quelles
    // dans la modale à côté du "Top X%".
    votesTotalByAuthorKey,
    // Nombre d'idées postées par auteur (demande du 17/08/2026) : sert à
    // dériver la moyenne de voix reçues par idée côté /api/my-score, en plus
    // du score Rhetor sur 100 (jamais à la place) — déjà calculé plus haut
    // pour les paliers de contribution, jamais exposé jusqu'ici.
    contributionCountByAuthorKey,
    noteAvgByAuthorKey,
    // Nombre d'idées notées par l'IA par auteur (demande du 17/08/2026) :
    // affiché à côté de la moyenne Logos déjà exposée (notesValue), jamais à
    // sa place — même principe que contributionCountByAuthorKey pour Rhetor.
    // Peut différer du nombre total d'idées postées (contributionCountByAuthorKey) :
    // seules les idées déjà analysées par l'IA comptent ici.
    noteCountByAuthorKey,
    gnosisAnsweredByAuthorKey,
    gnosisCorrectByAuthorKey,
    relierAnsweredByAuthorKey,
    relierCorrectByAuthorKey
  };
}

async function refreshUserScoreCache() {
  if (_userScoreRefreshPromise) return _userScoreRefreshPromise;
  _userScoreRefreshPromise = computeUserScores()
    .then((result) => {
      _userScoreCache = result;
      _userScoreCacheComputedAt = Date.now();
      return result;
    })
    .catch((e) => {
      console.error("[user-score] refresh error:", e.message);
      throw e;
    })
    .finally(() => {
      _userScoreRefreshPromise = null;
    });
  return _userScoreRefreshPromise;
}

async function getUserScoreData() {
  if (_userScoreCache) {
    if (Date.now() - _userScoreCacheComputedAt >= USER_SCORE_CACHE_TTL_MS) {
      refreshUserScoreCache().catch(() => {});
    }
    return _userScoreCache;
  }
  return refreshUserScoreCache();
}

app.get("/api/my-score", rateLimit("myScore", 60), async (req, res) => {
  const key = String(req.query.key || "").trim();
  if (!key) return res.status(400).json({ error: "Clé manquante." });

  try {
    const {
      votesScoreByAuthorKey, notesScoreByAuthorKey, gnosisScoreByAuthorKey, noesisScoreByAuthorKey,
      tierByAuthorKey, gnosisTierByAuthorKey, noesisTierByAuthorKey,
      votesTotalUsers, notesTotalUsers, gnosisTotalUsers, noesisTotalUsers,
      votesTierSizeByTier, notesTierSizeByTier, gnosisTierSizeByTier, noesisTierSizeByTier,
      votesTotalByAuthorKey, contributionCountByAuthorKey, noteAvgByAuthorKey, noteCountByAuthorKey,
      gnosisAnsweredByAuthorKey, gnosisCorrectByAuthorKey,
      relierAnsweredByAuthorKey, relierCorrectByAuthorKey
    } = await getUserScoreData();
    const tier = tierByAuthorKey.get(key) || null;
    const gnosisTier = gnosisTierByAuthorKey.get(key) || null;
    const noesisTier = noesisTierByAuthorKey.get(key) || null;
    // Rien posté / rien répondu sur un axe : pas encore de percentile
    // calculable, donc valeur initiale explicite à 100 %.
    res.json({
      votesScore: votesScoreByAuthorKey.has(key) ? votesScoreByAuthorKey.get(key) : USER_SCORE_EMPTY,
      notesScore: notesScoreByAuthorKey.has(key) ? notesScoreByAuthorKey.get(key) : USER_SCORE_EMPTY,
      gnosisScore: gnosisScoreByAuthorKey.has(key) ? gnosisScoreByAuthorKey.get(key) : USER_SCORE_EMPTY,
      tierLabel: tier ? getUserContributionTierLabel(tier) : null,
      tier: tier || null,
      tierCount: USER_SCORE_TIERS.length,
      gnosisTierLabel: gnosisTier ? getGnosisTierLabel(gnosisTier) : null,
      gnosisTier: gnosisTier || null,
      gnosisTierCount: GNOSIS_SCORE_TIERS.length,
      noesisScore: noesisScoreByAuthorKey.has(key) ? noesisScoreByAuthorKey.get(key) : USER_SCORE_EMPTY,
      noesisTierLabel: noesisTier ? getGnosisTierLabel(noesisTier) : null,
      noesisTier: noesisTier || null,
      noesisTierCount: GNOSIS_SCORE_TIERS.length,
      votesTotalUsers,
      notesTotalUsers,
      gnosisTotalUsers,
      noesisTotalUsers,
      votesTierUsers: tier ? (votesTierSizeByTier.get(tier) || 0) : null,
      notesTierUsers: tier ? (notesTierSizeByTier.get(tier) || 0) : null,
      gnosisTierUsers: gnosisTier ? (gnosisTierSizeByTier.get(gnosisTier) || 0) : null,
      noesisTierUsers: noesisTier ? (noesisTierSizeByTier.get(noesisTier) || 0) : null,
      votesValue: votesTotalByAuthorKey.has(key) ? votesTotalByAuthorKey.get(key) : null,
      // Moyenne de voix reçues par idée (demande du 17/08/2026) — en plus du
      // score Rhetor sur 100 (votesScore) et du total brut (votesValue),
      // jamais à leur place. contributionCountByAuthorKey ne peut être 0 ici
      // (une entrée n'existe dans cette map que si l'auteur a posté au moins
      // une idée, cf. computeUserScores), donc pas de division par zéro.
      votesAveragePerIdea: (votesTotalByAuthorKey.has(key) && contributionCountByAuthorKey.has(key))
        ? Math.round((votesTotalByAuthorKey.get(key) / contributionCountByAuthorKey.get(key)) * 10) / 10
        : null,
      votesIdeaCount: contributionCountByAuthorKey.has(key) ? contributionCountByAuthorKey.get(key) : null,
      notesValue: noteAvgByAuthorKey.has(key) ? Math.round(noteAvgByAuthorKey.get(key) * 10) / 10 : null,
      // Nombre d'idées ayant contribué à cette moyenne (demande du 17/08/2026),
      // à côté de notesValue — même principe que votesIdeaCount pour Rhetor.
      notesIdeaCount: noteCountByAuthorKey.has(key) ? noteCountByAuthorKey.get(key) : null,
      // Gnosis (redéfini le 17/08/2026) : taux de réussite brut sur les
      // repasses "Ancrer" uniquement, à côté du percentile gnosisScore
      // ci-dessus — cf. computeUserScores pour le détail du calcul
      // (memory_review_events, première review par (user, memory_item)
      // exclue).
      gnosisAnswered: gnosisAnsweredByAuthorKey.has(key) ? gnosisAnsweredByAuthorKey.get(key) : null,
      gnosisCorrect: gnosisCorrectByAuthorKey.has(key) ? gnosisCorrectByAuthorKey.get(key) : null,
      // Noesis (demande du 17/08/2026) : QCM "Relier" uniquement — valeurs
      // brutes affichées à côté du "Top X%" de noesisScore, même principe que
      // gnosisAnswered/gnosisCorrect.
      relierAnswered: relierAnsweredByAuthorKey.has(key) ? relierAnsweredByAuthorKey.get(key) : null,
      relierCorrect: relierCorrectByAuthorKey.has(key) ? relierCorrectByAuthorKey.get(key) : null
    });
  } catch (e) {
    console.error("Erreur /api/my-score:", e);
    res.status(500).json({ error: "Erreur lors du calcul du score." });
  }
});

// Contributions du visiteur : tout est retrouvé via sa clé de navigateur
// (creator_key des arènes, author_key des idées et commentaires). Lectures
// bornées par utilisateur (limit), pas besoin de fetchAllSupabaseRows.
app.get("/api/my-contributions", rateLimit("myContributions", 60), async (req, res) => {
  const key = String(req.query.key || "").trim();
  if (!key) return res.status(400).json({ error: "Clé manquante." });

  try {
    const [debatesRes, argumentsRes, commentsRes, votesRes] = await Promise.all([
      supabase
        .from("debates")
        .select("id, question, type, category, created_at, creator_key")
        .eq("creator_key", key)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("arguments")
        .select("id, debate_id, side, title, body, votes, created_at, author_key")
        .eq("author_key", key)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("comments")
        .select("id, argument_id, content, created_at, author_key")
        .eq("author_key", key)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("votes")
        .select("argument_id, vote_count, created_at")
        .eq("voter_key", key)
        .gt("vote_count", 0)
        .order("created_at", { ascending: false })
        .limit(200)
    ]);
    if (debatesRes.error) throw debatesRes.error;
    if (argumentsRes.error) throw argumentsRes.error;
    if (commentsRes.error) throw commentsRes.error;
    if (votesRes.error) throw votesRes.error;

    const myDebates = debatesRes.data || [];
    const myArguments = argumentsRes.data || [];
    const myComments = commentsRes.data || [];
    const myVotes = votesRes.data || [];

    // Contexte des commentaires et des voix : idée parente, puis son arène.
    const parentArgumentIds = [...new Set([
      ...myComments.map((c) => c.argument_id),
      ...myVotes.map((v) => v.argument_id)
    ].filter(Boolean))];
    let parentArguments = [];
    if (parentArgumentIds.length) {
      const { data, error } = await supabase
        .from("arguments")
        .select("id, debate_id, title")
        .in("id", parentArgumentIds);
      if (error) throw error;
      parentArguments = data || [];
    }
    const parentArgumentById = new Map(parentArguments.map((a) => [String(a.id), a]));

    const referencedDebateIds = [...new Set(
      [...myArguments.map((a) => a.debate_id), ...parentArguments.map((a) => a.debate_id)]
        .filter(Boolean)
        .map(String)
    )];
    let referencedDebates = [];
    if (referencedDebateIds.length) {
      const { data, error } = await supabase
        .from("debates")
        .select("id, question, type, creator_key")
        .in("id", referencedDebateIds);
      if (error) throw error;
      referencedDebates = data || [];
    }
    const debateById = new Map(referencedDebates.map((d) => [String(d.id), d]));

    // Notes IA des idées du visiteur : le scoring par idée vit dans
    // debates.ai_analysis (arènes où il a posté, analyses générées uniquement).
    const argDebateIds = [...new Set(myArguments.map((a) => String(a.debate_id)).filter(Boolean))];
    const scoreByArgumentId = new Map();
    if (argDebateIds.length) {
      const { data, error } = await supabase
        .from("debates")
        .select("id, ai_analysis")
        .in("id", argDebateIds)
        .not("ai_analysis", "is", null);
      if (error) throw error;
      for (const row of data || []) {
        const rawScoring = extractAnalysisScoringRaw(row.ai_analysis);
        if (!rawScoring) continue;
        try {
          const parsedScoring = JSON.parse(rawScoring);
          for (const [argId, entry] of _getAnalysisScoreByArgumentId(parsedScoring)) {
            scoreByArgumentId.set(argId, entry);
          }
        } catch (e) {}
      }
    }

    res.json({
      debates: myDebates.map((d) => sanitizeDebateForClient(d, key)),
      arguments: myArguments.map((a) => {
        const parentDebate = debateById.get(String(a.debate_id));
        // Note faible/moyen masquée même pour l'auteur de sa propre idée (demande du
        // 19/08/2026) : seuls l'admin et le créateur de CETTE arène-là la voient.
        const canSeeHidden = canViewerSeeHiddenScores(req, parentDebate?.creator_key, key);
        const scoreEntry = maskScoreEntryForViewer(scoreByArgumentId.get(String(a.id)), canSeeHidden);
        return {
          ...sanitizeArgumentForClient(a, key),
          debate_question: parentDebate?.question || "",
          debate_type: parentDebate?.type || "",
          ai_score: scoreEntry ? scoreEntry.score : null,
          ai_category: scoreEntry ? scoreEntry.category : ""
        };
      }),
      comments: myComments.map((c) => {
        const parentArgument = parentArgumentById.get(String(c.argument_id));
        const parentDebate = parentArgument ? debateById.get(String(parentArgument.debate_id)) : null;
        return {
          ...sanitizeCommentForClient(c, key),
          argument_title: parentArgument?.title || "",
          debate_id: parentArgument?.debate_id || null,
          debate_question: parentDebate?.question || ""
        };
      }),
      votes: myVotes.map((v) => {
        const votedArgument = parentArgumentById.get(String(v.argument_id));
        const votedDebate = votedArgument ? debateById.get(String(votedArgument.debate_id)) : null;
        return {
          argument_id: v.argument_id,
          vote_count: v.vote_count,
          created_at: v.created_at,
          argument_title: votedArgument?.title || "",
          debate_id: votedArgument?.debate_id || null,
          debate_question: votedDebate?.question || ""
        };
      })
    });
  } catch (e) {
    console.error("Erreur /api/my-contributions:", e);
    res.status(500).json({ error: "Erreur lors du chargement des contributions." });
  }
});

// Classement global "Les meilleures idées" (page contributions) : les 3
// fenêtres (jour/semaine/mois) sont calculées d'un coup sur les idées des 30
// derniers jours et mises en cache — recalculer à chaque requête scannerait
// toutes les idées récentes à chaque affichage de la page.
const BEST_IDEAS_CACHE_TTL_MS = 3 * 60 * 1000;
const BEST_IDEAS_WINDOW_MS = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000
};
const BEST_IDEAS_PER_CATEGORY = 10;

let _bestIdeasCache = null;
let _bestIdeasCacheComputedAt = 0;
let _bestIdeasRefreshPromise = null;

async function computeBestIdeas() {
  const sinceIso = new Date(Date.now() - BEST_IDEAS_WINDOW_MS.month).toISOString();

  const { data: recentArguments, error: argsError } = await fetchAllSupabaseRows(() =>
    supabase
      .from("arguments")
      .select("id, debate_id, side, title, body, votes, created_at")
      .gte("created_at", sinceIso));
  if (argsError) throw argsError;

  const debateIds = [...new Set((recentArguments || []).map((a) => String(a.debate_id)).filter(Boolean))];
  let debatesById = new Map();
  // Notes IA : même source que /api/my-contributions et computeUserScores —
  // le scoring par idée vit dans debates.ai_analysis, pas sur l'idée elle-même.
  const scoreByArgumentId = new Map();
  if (debateIds.length) {
    const [{ data: relatedDebates, error: debatesError }, { data: analyzedDebates, error: analysisError }] = await Promise.all([
      fetchAllSupabaseRowsIn(debateIds, (chunk) =>
        supabase.from("debates").select("id, question, type, option_a, option_b, creator_key").in("id", chunk)),
      fetchAllSupabaseRowsIn(debateIds, (chunk) =>
        supabase.from("debates").select("id, ai_analysis").in("id", chunk).not("ai_analysis", "is", null))
    ]);
    if (debatesError) throw debatesError;
    if (analysisError) throw analysisError;
    debatesById = new Map((relatedDebates || []).map((d) => [String(d.id), d]));

    for (const row of analyzedDebates || []) {
      const rawScoring = extractAnalysisScoringRaw(row.ai_analysis);
      if (!rawScoring) continue;
      try {
        const parsedScoring = JSON.parse(rawScoring);
        for (const [argId, entry] of _getAnalysisScoreByArgumentId(parsedScoring)) {
          scoreByArgumentId.set(argId, entry);
        }
      } catch (e) {}
    }
  }

  function buildForWindow(windowMs) {
    const cutoff = Date.now() - windowMs;
    const open = [];
    const positioned = [];
    for (const arg of recentArguments || []) {
      const createdAtMs = new Date(String(arg.created_at || "").replace(" ", "T")).getTime();
      if (!createdAtMs || createdAtMs < cutoff) continue;
      const debate = debatesById.get(String(arg.debate_id));
      if (!debate) continue;
      const scoreEntry = scoreByArgumentId.get(String(arg.id));
      const item = {
        id: arg.id,
        title: arg.title || "",
        body: arg.body || "",
        votes: Number(arg.votes) || 0,
        ai_score: scoreEntry ? scoreEntry.score : null,
        ai_category: scoreEntry ? scoreEntry.category : "",
        created_at: arg.created_at,
        debate_id: arg.debate_id,
        debate_question: debate.question || "",
        // Jamais renvoyé au client tel quel (cache partagé entre tous les visiteurs) —
        // retiré et remplacé par un masquage par requête dans /api/best-ideas, cf.
        // canViewerSeeHiddenScores.
        debate_creator_key: debate.creator_key || null
      };
      if (String(debate.type || "debate") === "open") {
        open.push(item);
      } else {
        const sideLabel = arg.side === "A" ? (debate.option_a || "") : arg.side === "B" ? (debate.option_b || "") : "";
        positioned.push({ ...item, side: arg.side || null, side_label: sideLabel });
      }
    }

    const byVotes = (a, b) => b.votes - a.votes;
    const byAiScore = (a, b) => b.ai_score - a.ai_score;
    const withAiScore = (list) => list.filter((item) => item.ai_score !== null);

    return {
      votes: {
        open: open.slice().sort(byVotes).slice(0, BEST_IDEAS_PER_CATEGORY),
        positioned: positioned.slice().sort(byVotes).slice(0, BEST_IDEAS_PER_CATEGORY)
      },
      aiScore: {
        open: withAiScore(open).sort(byAiScore).slice(0, BEST_IDEAS_PER_CATEGORY),
        positioned: withAiScore(positioned).sort(byAiScore).slice(0, BEST_IDEAS_PER_CATEGORY)
      }
    };
  }

  return {
    day: buildForWindow(BEST_IDEAS_WINDOW_MS.day),
    week: buildForWindow(BEST_IDEAS_WINDOW_MS.week),
    month: buildForWindow(BEST_IDEAS_WINDOW_MS.month)
  };
}

async function refreshBestIdeasCache() {
  if (_bestIdeasRefreshPromise) return _bestIdeasRefreshPromise;
  _bestIdeasRefreshPromise = computeBestIdeas()
    .then((result) => {
      _bestIdeasCache = result;
      _bestIdeasCacheComputedAt = Date.now();
      return result;
    })
    .catch((e) => {
      console.error("[best-ideas] refresh error:", e.message);
      throw e;
    })
    .finally(() => {
      _bestIdeasRefreshPromise = null;
    });
  return _bestIdeasRefreshPromise;
}

async function getBestIdeasData() {
  if (_bestIdeasCache) {
    if (Date.now() - _bestIdeasCacheComputedAt >= BEST_IDEAS_CACHE_TTL_MS) {
      refreshBestIdeasCache().catch(() => {});
    }
    return _bestIdeasCache;
  }
  return refreshBestIdeasCache();
}

// Notifications "top 5 des classements" : prévient l'auteur d'une idée dès qu'elle
// entre dans le top 5 d'un des classements de la page Contributions (votes ou note
// IA, sur les 3 fenêtres jour/semaine/mois, arènes libres et à positions). Détection
// par diff avec le relevé précédent, gardé en mémoire seulement.
// Au tout premier passage après un démarrage/redémarrage serveur, on se contente
// d'enregistrer l'état courant sans notifier : sinon chaque redémarrage ferait
// paraître "nouveau" tout le top 5 déjà en place et spammerait ses auteurs.
const TOP5_NOTIFY_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const TOP5_NOTIFY_RANK_LIMIT = 5;
const TOP5_NOTIFY_PERIODS = ["day", "week", "month"];
const TOP5_NOTIFY_METRICS = ["votes", "aiScore"];
const TOP5_NOTIFY_ARENA_TYPES = ["open", "positioned"];
const TOP5_NOTIFY_PERIOD_LABELS = { day: "du jour", week: "de la semaine", month: "du mois" };
const TOP5_NOTIFY_METRIC_LABELS = {
  votes: "des idées les plus soutenues",
  aiScore: "des idées les mieux notées par l'IA"
};
const TOP5_NOTIFY_SCHEDULER_ENABLED = isRenderScopedTaskEnabled("MNORIA_TOP5_NOTIFY_SCHEDULER");

let _top5NotifyPreviousEntrants = new Map();
let _top5NotifyWarmedUp = false;

async function checkTop5IdeaEntries() {
  let bestIdeas;
  try {
    // refreshBestIdeasCache() force toujours un recalcul complet (~7 Mo lus sur Supabase :
    // 30j d'arguments + ai_analysis des débats liés), sans regarder si le cache est déjà
    // frais. Ce check tourne toutes les 3h sans lien avec le trafic réel (contrairement à
    // getBestIdeasData(), qui respecte le TTL de 3 min de la route /api/best-ideas) : sans
    // garde-fou ici, il paie ce recalcul 8 fois/jour même à 3h du matin sans visiteur —
    // cause de la hausse d'egress mesurée le 21/07/2026. Un top 5 n'a pas besoin d'une
    // fraîcheur à la minute près : réutiliser un cache de moins de 3h suffit largement.
    const cacheIsFreshEnough = _bestIdeasCache && (Date.now() - _bestIdeasCacheComputedAt < TOP5_NOTIFY_CHECK_INTERVAL_MS);
    bestIdeas = cacheIsFreshEnough ? _bestIdeasCache : await refreshBestIdeasCache();
  } catch (e) {
    console.error("[top5-notify] Erreur calcul des classements:", e.message);
    return;
  }

  // argumentId -> { item, entries: [{ period, metric }] }
  const newEntriesByArgumentId = new Map();

  for (const period of TOP5_NOTIFY_PERIODS) {
    for (const metric of TOP5_NOTIFY_METRICS) {
      for (const arenaType of TOP5_NOTIFY_ARENA_TYPES) {
        const top5 = (bestIdeas?.[period]?.[metric]?.[arenaType] || []).slice(0, TOP5_NOTIFY_RANK_LIMIT);
        const currentIds = new Set(top5.map((item) => String(item.id)));
        const key = `${period}:${metric}:${arenaType}`;
        const previousIds = _top5NotifyPreviousEntrants.get(key) || new Set();

        if (_top5NotifyWarmedUp) {
          for (const item of top5) {
            const id = String(item.id);
            if (previousIds.has(id)) continue;
            if (!newEntriesByArgumentId.has(id)) newEntriesByArgumentId.set(id, { item, entries: [] });
            newEntriesByArgumentId.get(id).entries.push({ period, metric });
          }
        }

        _top5NotifyPreviousEntrants.set(key, currentIds);
      }
    }
  }
  _top5NotifyWarmedUp = true;

  if (!newEntriesByArgumentId.size) return;

  const argumentIds = [...newEntriesByArgumentId.keys()];
  const { data: authorRows, error: authorsError } = await supabase
    .from("arguments")
    .select("id, author_key")
    .in("id", argumentIds);
  if (authorsError) {
    console.error("[top5-notify] Erreur lecture auteurs:", authorsError.message);
    return;
  }
  const authorKeyById = new Map((authorRows || []).map((row) => [String(row.id), row.author_key]));

  for (const [argumentId, { item, entries }] of newEntriesByArgumentId) {
    const authorKey = authorKeyById.get(argumentId);
    if (!authorKey || authorKey === MNORIA_ADMIN_CREATOR_KEY) continue;

    for (const { period, metric } of entries) {
      const message = `Bravo ! Votre idée ${quoteNotificationContent(item.title)} est entrée dans le top 5 ${TOP5_NOTIFY_METRIC_LABELS[metric]} ${TOP5_NOTIFY_PERIOD_LABELS[period]}.`;
      createNotification({
        user_key: authorKey,
        type: metric === "votes" ? "top5_idea_votes" : "top5_idea_ai_score",
        debate_id: item.debate_id,
        argument_id: Number(argumentId),
        message
      }).catch((e) => console.error("[top5-notify] Erreur création notification:", e.message));
    }
  }
}

if (TOP5_NOTIFY_SCHEDULER_ENABLED) {
  setInterval(() => {
    checkTop5IdeaEntries().catch((e) => console.error("[top5-notify] Erreur:", e.message));
  }, TOP5_NOTIFY_CHECK_INTERVAL_MS).unref();
  checkTop5IdeaEntries().catch((e) => console.error("[top5-notify] Erreur:", e.message));
} else {
  console.log("[top5-notify] scheduler désactivé hors Render (forcer avec MNORIA_TOP5_NOTIFY_SCHEDULER=on).");
}

app.get("/api/best-ideas", rateLimit("bestIdeas", 60), async (req, res) => {
  const period = ["day", "week", "month"].includes(String(req.query.period)) ? String(req.query.period) : "day";
  try {
    const data = await getBestIdeasData();
    // getBestIdeasData() est un cache PARTAGÉ entre tous les visiteurs (TTL 3 min) —
    // le masquage des notes faible/moyen (cf. canViewerSeeHiddenScores) doit donc être
    // recalculé à chaque requête, jamais figé dans le cache lui-même.
    const clientKey = getRequestClientKey(req);
    const redactItem = (item) => {
      const canSeeHidden = canViewerSeeHiddenScores(req, item.debate_creator_key, clientKey);
      const { debate_creator_key, ...publicItem } = item;
      if (canSeeHidden || item.ai_category === "bon" || item.ai_category === "excellent" || item.ai_score == null) {
        return publicItem;
      }
      return { ...publicItem, ai_score: null, ai_category: "masque" };
    };
    const periodData = data[period];
    const redacted = {
      votes: {
        open: (periodData.votes?.open || []).map(redactItem),
        positioned: (periodData.votes?.positioned || []).map(redactItem)
      },
      aiScore: {
        open: (periodData.aiScore?.open || []).map(redactItem),
        positioned: (periodData.aiScore?.positioned || []).map(redactItem)
      }
    };
    res.json({ period, ...redacted });
  } catch (e) {
    console.error("Erreur /api/best-ideas:", e);
    res.status(500).json({ error: "Erreur lors du chargement des meilleures idées." });
  }
});

app.get("/contact", (req, res) => {
  res.set("Cache-Control", "no-store").sendFile(path.join(__dirname, "views/contact.html"));
});

app.post("/api/contact", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim();
  const message = String(req.body?.message || "").trim();
  if (!name || !email || !message) return res.status(400).json({ error: "Champs manquants." });
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Service mail non configuré." });
  try {
    const { Resend } = require("resend");
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: "mnoria <onboarding@resend.dev>",
      to: "kevinbruyat@live.fr",
      reply_to: email,
      subject: `Contact mnoria — ${name}`,
      text: `Nom : ${name}\nEmail : ${email}\n\n${message}`
    });
    if (result.error) {
      console.error("Resend error:", result.error);
      return res.status(500).json({ error: "Erreur envoi." });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("Resend error:", e);
    res.status(500).json({ error: "Erreur envoi." });
  }
});

app.get("/api/about/medias", async (req, res) => {
  try {
    if (veilleMediasCacheIsStale()) await _loadVeilleMediasFromSupabase();
    res.setHeader("Cache-Control", "no-store");
    res.json({ medias: readVeilleMedias() });
  } catch (error) {
    console.error("Erreur lecture médias veille:", error);
    res.status(500).json({ error: "Liste des médias indisponible." });
  }
});

app.get("/about", async (req, res) => {
  try {
    if (veilleMediasCacheIsStale()) await _loadVeilleMediasFromSupabase();
    const template = fs.readFileSync(path.join(__dirname, "views/about.html"), "utf8");
    const items = readVeilleMedias();
    const listHtml = items.length
      ? items.map((media) => `<li>${escapeHtmlContent(media.nom)}</li>`).join("\n          ")
      : "<li>Aucun média renseigné.</li>";
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(template.replace("__ABOUT_MEDIA_ITEMS__", listHtml));
  } catch (error) {
    console.error("Erreur rendu À propos:", error);
    res.sendFile(path.join(__dirname, "views/about.html"));
  }
});

app.get("/debate", async (req, res) => {
  const template = readViewTemplate("debate.html");
  const debateId = String(req.query.id || "").trim();

  if (!debateId) {
    const html = replaceMetaPlaceholders(template, {
      title: "Débat | mnoria",
      description: "Découvrez les débats et les idées qui s'affrontent sur mnoria.",
      url: buildAbsoluteUrl(req, "/debate"),
      image: buildAbsoluteUrl(req, "/mnoria-icon-512.png"),
      imageAlt: "Mnoria — l'arène des idées"
    });
    return res.set("Cache-Control", "no-store").type("html").send(html);
  }

  try {
    const debate = await withHtmlMetaDbTimeout(getDebateById(debateId));
    if (!debate) {
      const html = replaceMetaPlaceholders(template, {
        title: "Débat introuvable | mnoria",
        description: "Cette arène n'est plus disponible sur mnoria.",
        url: buildAbsoluteUrl(req, `/debate?id=${encodeURIComponent(debateId)}`),
        image: buildAbsoluteUrl(req, "/mnoria-icon-512.png"),
        imageAlt: "Mnoria — l'arène des idées"
      });
      return res.status(404).set("Cache-Control", "no-store").type("html").send(html);
    }

    const html = replaceMetaPlaceholders(template, buildDebateMeta(req, debate));
    return res.set("Cache-Control", "no-store").type("html").send(html);
  } catch (error) {
    console.error(error);
    const html = replaceMetaPlaceholders(template, {
      title: "Débat | mnoria",
      description: "Découvrez les débats et les idées qui s'affrontent sur mnoria.",
      url: buildAbsoluteUrl(req, `/debate?id=${encodeURIComponent(debateId)}`),
      image: buildAbsoluteUrl(req, "/mnoria-icon-512.png"),
      imageAlt: "Mnoria — l'arène des idées"
    });
    return res.set("Cache-Control", "no-store").type("html").send(html);
  }
});

app.get("/admin-reports", (req, res) => {
  res.set("Cache-Control", "no-store").sendFile(path.join(__dirname, "views/admin-reports.html"));
});

app.get("/admin-tags", (req, res) => {
  res.set("Cache-Control", "no-store").sendFile(path.join(__dirname, "views/admin-tags.html"));
});

app.get("/admin-stories", (req, res) => {
  res.set("Cache-Control", "no-store").sendFile(path.join(__dirname, "views/admin-stories.html"));
});

/* =========================
   OPEN GRAPH SHARE ROUTES
========================= */

const OG_WORKER_PATH = path.join(__dirname, "lib", "og-image-worker.js");

// Le worker_threads postMessage peut faire perdre le type Buffer (le message
// arrive parfois comme Uint8Array ou comme objet indexé {"0":...,"1":...}) :
// on le reconvertit explicitement en Buffer avant tout envoi/cache.
function toPngBuffer(result) {
  if (Buffer.isBuffer(result)) return result;
  if (result instanceof Uint8Array || result instanceof ArrayBuffer) return Buffer.from(result);
  if (result && typeof result === "object") {
    const keys = Object.keys(result);
    if (keys.length && keys.every(k => /^\d+$/.test(k))) {
      const bytes = new Uint8Array(keys.length);
      for (const k of keys) bytes[Number(k)] = result[k];
      return Buffer.from(bytes);
    }
  }
  throw new Error("OG worker: résultat invalide (impossible de produire un PNG)");
}

function generateOgImageInWorker(payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(OG_WORKER_PATH, { workerData: payload });
    worker.once("message", result => {
      try {
        resolve(toPngBuffer(result));
      } catch (e) {
        reject(e);
      }
    });
    worker.once("error", reject);
    worker.once("exit", code => { if (code !== 0) reject(new Error(`OG worker exited with code ${code}`)); });
  });
}

async function sendDebateOgImage(req, res, id) {
  try {
    const cachedEntry = ogImageCache.get(String(id));
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=1800");
      return res.send(cachedEntry.buffer);
    }

    const [debate, args] = await Promise.all([
      getDebateById(id),
      getArgumentsByDebateId(id)
    ]);

    if (!debate) {
      return res.status(404).send("Débat introuvable.");
    }

    const { percentA, percentB } = computeDebatePercents(args);
    const isOpen = String(debate?.type || "").trim().toLowerCase() === "open";

    const pngBuffer = await generateOgImageInWorker({
      question: debate.question || "",
      option_a: debate.option_a || "",
      option_b: debate.option_b || "",
      isOpen,
      percentA,
      percentB,
      logoPath: path.join(__dirname, "public/mnoria-icon-512.png")
    });

    _cacheSet(ogImageCache, String(id), { buffer: pngBuffer, expiresAt: Date.now() + OG_IMAGE_CACHE_TTL_MS }, OG_IMAGE_CACHE_MAX);

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=1800");
    res.send(pngBuffer);
  } catch (error) {
    console.error(error);
    res.status(500).send("Erreur génération image");
  }
}

app.get("/og/debate/:id.png", async (req, res) => {
  return sendDebateOgImage(req, res, req.params.id);
});

app.get("/debate/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const accept = String(req.headers.accept || "");

  if (accept.includes("text/html")) {
    return res.redirect(302, `/debate?id=${encodeURIComponent(id)}`);
  }

  return sendDebateOgImage(req, res, id);
});

app.post("/api/link-preview", rateLimit("preview", 120), async (req, res) => {
  try {
    const { url } = req.body || {};
    const safeUrl = normalizeExternalUrl(url);

    if (!safeUrl) {
      return res.status(400).json({ error: "URL manquante." });
    }

    const preview = await getExternalLinkPreview(safeUrl);
    return res.json({ preview: preview || null });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur récupération aperçu.");
  }
});

app.get("/api/image-proxy", rateLimit("preview-image", 240), async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const safeUrl = normalizeExternalUrl(req.query?.url);
    if (!safeUrl) return res.status(400).send("URL manquante.");

    await assertSafeExternalUrl(safeUrl);

    const response = await fetch(safeUrl, {
      headers: {
        ...buildBrowserLikeHeaders(safeUrl, "browser"),
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) return res.status(response.status).send("Image indisponible.");

    const finalUrl = response.url || safeUrl;
    await assertSafeExternalUrl(finalUrl);

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) return res.status(415).send("Ressource non image.");

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > 8 * 1024 * 1024) return res.status(413).send("Image trop volumineuse.");

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (!response.body) return res.status(502).send("Image indisponible.");
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    if (!res.headersSent) res.status(502).send("Image indisponible.");
  } finally {
    clearTimeout(timeout);
  }
});

/* =========================
   TRACK VISITS
========================= */

app.post("/api/track-visit", (req, res) => {
  const { visitorKey, page } = req.body || {};

  if (!visitorKey || !page) {
    return res.status(400).json({ error: "visitorKey et page requis" });
  }

  res.json({ success: true });

  supabase
    .from("page_visits")
    .insert({ visitor_key: String(visitorKey), page: String(page), created_at: nowIso() })
    .then(({ error }) => {
      if (error) console.error("track-visit:", error);
    });
});

/* =========================
   USERS
========================= */

app.post("/api/users/resolve", rateLimit("users", 30), async (req, res) => {
  try {
    const validation = validateLegacyKey(req.body?.legacyKey);

    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const { user, created } = await resolveLegacyUser(supabase, validation.legacyKey);

    return res.json({
      success: true,
      created,
      user: {
        id: user.id,
        legacy_key: user.legacy_key,
        created_at: user.created_at,
        last_seen_at: user.last_seen_at
      }
    });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur resolution utilisateur.");
  }
});

app.post("/api/users/mark-app-installed", rateLimit("users", 30), async (req, res) => {
  try {
    const validation = validateLegacyKey(req.body?.legacyKey);

    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const { user } = await resolveLegacyUser(supabase, validation.legacyKey);

    const { error } = await supabase
      .from("users")
      .update({ app_installed_at: new Date().toISOString() })
      .eq("id", user.id)
      .is("app_installed_at", null);

    if (error) throw error;

    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur enregistrement app installee.");
  }
});

// Consultation par le navigateur classique : sur iOS, Safari et la PWA ont des
// stockages séparés (le flag local "standalone vu" n'existe que côté PWA),
// mais la PWA hérite de la clé anonyme copiée depuis Safari à l'installation.
// La présence d'app_installed_at sur cette clé permet donc à Safari de savoir
// que l'app est installée. Lecture seule : pas d'upsert, clé inconnue →
// installed:false.
app.get("/api/users/app-installed", rateLimit("users", 30), async (req, res) => {
  try {
    const validation = validateLegacyKey(req.query?.legacyKey);

    if (validation.error) {
      return res.json({ installed: false });
    }

    const { data, error } = await supabase
      .from("users")
      .select("app_installed_at")
      .eq("legacy_key", validation.legacyKey)
      .maybeSingle();

    if (error) throw error;

    return res.json({ installed: !!(data && data.app_installed_at) });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur consultation app installee.");
  }
});

// Univers intellectuel personnel : galaxie -> systèmes solaires -> contenus Culture Générale
// acquis (cf. user_article_acquisitions, alimentée par une bonne réponse au QCM Culture
// Générale — le QCM actu n'alimente plus cet univers, seuls les anciens articles acquis avant
// ce changement restent en base, ignorés ici). Lecture seule, aucune classification IA ni
// écriture ici. legacyKey uniquement (jamais un user_id arbitraire en clair dans la route
// publique) — même identité que le reste du projet.
// Les anciens systèmes/étoiles ont pu être enregistrés après une coupe mécanique à 35
// caractères (ex. « Louis-Philippe devient roi des »). À la lecture, le nom complet de
// l'acquisition permet de reconnaître précisément cette ancienne coupe et de restaurer le
// libellé original. Les nouveaux noms ne sont plus tronqués à un nombre de caractères fixe.

// Mêmes libellés que ACQUIS_SOURCE_TYPE_META (views/qcm-du-jour.html), dupliqués ici à
// l'identique côté serveur (petite table statique, pas de dépendance possible sur le frontend) :
// sert de "source" affichée pour une étoile issue de Culture Générale.
const CULTURE_GENERALE_SOURCE_TYPE_LABEL = {
  histoire: "Ce jour dans l'Histoire",
  parallele: "Parallèle historique",
  pensee: "Pensée philosophique",
  mecanisme: "Mécanisme sociologique",
  concept: "Concept du jour",
  citation: "Citation du jour",
  oeuvre: "Œuvre d'art du jour",
  latin: "Mot latin du jour",
  photo_import: "Document importé",
  manual_import: "Ajout manuel",
  pdf_import: "Document PDF",
  text_import: "Texte importé",
  url_import: "Page web",
  youtube_import: "Vidéo YouTube"
};

app.get("/api/users/intellectual-universe", rateLimit("users", 30), async (req, res) => {
  try {
    const validation = validateLegacyKey(req.query?.legacyKey);
    if (validation.error) return res.status(400).json({ error: validation.error });

    const cachedResponse = getCachedIntellectualUniverseResponse(validation.legacyKey);
    if (cachedResponse) return res.json(cachedResponse);

    const { user } = await resolveLegacyUser(supabase, validation.legacyKey);

    const emptyResponse = {
      userId: user.id,
      totals: { articles: 0, solarSystems: 0, galaxies: 0, unclassifiedArticles: 0 },
      galaxies: [],
      unclassified: [],
      knowledgeLinks: []
    };

    const { data: acquisitions, error: acquisitionsError } = await supabase
      .from("user_article_acquisitions")
      .select("id, solar_system_id, star_id, acquired_at, eclairage_type, eclairage_source_id, eclairage_name, eclairage_detail")
      .eq("user_id", user.id)
      .not("eclairage_type", "is", null);
    if (acquisitionsError) throw new Error(acquisitionsError.message);
    if (!acquisitions || !acquisitions.length) {
      console.log(`[intellectual universe] user=${user.id} articles=0 solarSystems=0 galaxies=0 unclassified=0`);
      setCachedIntellectualUniverseResponse(validation.legacyKey, emptyResponse);
      return res.json(emptyResponse);
    }

    const eclairageAcquisitions = [];
    const seenEclairageKeys = new Set();
    for (const a of acquisitions) {
      if (!a.eclairage_type || !a.eclairage_source_id) continue;
      const key = `${a.eclairage_type}:${a.eclairage_source_id}`;
      if (seenEclairageKeys.has(key)) continue;
      seenEclairageKeys.add(key);
      eclairageAcquisitions.push(a);
    }

    // Relations entre les connaissances réellement présentes dans CET univers. Deux lectures
    // indexées et découpées sur les source_id évitent une requête par acquisition ainsi qu'un
    // .or() interpolé. Le filtrage final porte sur la paire exacte type + id : des ids identiques
    // appartenant à deux types différents ne peuvent donc jamais créer un faux trait.
    const acquiredKnowledgeKeys = new Set(eclairageAcquisitions.map((a) =>
      cultureGeneraleNotionKey(a.eclairage_type, a.eclairage_source_id)
    ));
    const acquiredSourceIds = [...new Set(eclairageAcquisitions.map((a) => String(a.eclairage_source_id)))];
    let knowledgeLinks = [];
    if (acquiredSourceIds.length) {
      const linkColumns = "id,type_a,source_id_a,type_b,source_id_b";
      const [linksFromA, linksFromB] = await Promise.all([
        fetchAllSupabaseRowsIn(acquiredSourceIds, (idsChunk) =>
          supabase.from("culture_generale_notion_links").select(linkColumns)
            .in("source_id_a", idsChunk).order("id", { ascending: true })
        ),
        fetchAllSupabaseRowsIn(acquiredSourceIds, (idsChunk) =>
          supabase.from("culture_generale_notion_links").select(linkColumns)
            .in("source_id_b", idsChunk).order("id", { ascending: true })
        )
      ]);
      const linksError = linksFromA.error || linksFromB.error;
      if (linksError) {
        // La mémoire reste utilisable si la migration des liens n'est pas encore appliquée :
        // seule sa couche décorative relationnelle est alors omise.
        console.warn("[intellectual universe] liens indisponibles :", linksError.message);
      } else {
        const seenLinkIds = new Set();
        const acquiredLinkRows = [...(linksFromA.data || []), ...(linksFromB.data || [])]
          .filter((link) => {
            if (seenLinkIds.has(link.id)) return false;
            seenLinkIds.add(link.id);
            return acquiredKnowledgeKeys.has(cultureGeneraleNotionKey(link.type_a, link.source_id_a))
              && acquiredKnowledgeKeys.has(cultureGeneraleNotionKey(link.type_b, link.source_id_b));
          });

        // Le trait ne s'affiche que si le QCM "Comprendre les liens" associé a déjà été
        // réussi au moins une fois (demande du 16/08/2026) — même signal que "Mes acquis"
        // (user_notion_quizzes, posé automatiquement sur une bonne réponse, cf.
        // applyFsrsReviewForDailyQuizAnswer) : les deux connaissances acquises ne suffit plus,
        // il faut avoir compris le lien entre elles pour qu'il apparaisse visuellement.
        const slotByLinkId = new Map(acquiredLinkRows.map((link) => [
          link.id,
          `notion:comprendre:${cultureGeneraleComprehensionPairHash({
            typeA: link.type_a, idA: String(link.source_id_a),
            typeB: link.type_b, idB: String(link.source_id_b)
          })}`
        ]));
        const candidateSlots = [...new Set(slotByLinkId.values())];
        let validatedSlots = new Set();
        if (candidateSlots.length) {
          const { data: validatedRows, error: validatedError } = await fetchAllSupabaseRowsIn(candidateSlots, (slotsChunk) =>
            supabase.from("user_notion_quizzes").select("slot").eq("user_id", user.id).in("slot", slotsChunk)
          );
          if (validatedError) {
            console.warn("[intellectual universe] validation des liens indisponible :", validatedError.message);
          } else {
            validatedSlots = new Set((validatedRows || []).map((row) => row.slot));
          }
        }

        knowledgeLinks = acquiredLinkRows
          .filter((link) => validatedSlots.has(slotByLinkId.get(link.id)))
          .map((link) => ({
            typeA: link.type_a,
            sourceIdA: String(link.source_id_a),
            typeB: link.type_b,
            sourceIdB: String(link.source_id_b)
          }));
      }
    }

    // La fenêtre ouverte depuis une étoile doit mener à la même fiche détaillée
    // que "Mes acquis". Réutilise donc sa résolution (y compris pour les anciens
    // acquis), indexée par la clé stable type + source. Le texte aplati conservé
    // dans user_article_acquisitions reste le repli si la source historique n'est
    // plus relisible : la mémoire ne perd jamais complètement sa fiche.
    let acquisFicheByKey = new Map();
    try {
      const acquisWithSourceIds = await fetchUserAcquis(validation.legacyKey, { includeSourceDebateId: true });
      acquisFicheByKey = new Map(acquisWithSourceIds.map((item) => [
        `${item.sourceType}:${item.sourceDebateId}`,
        item
      ]));
    } catch (error) {
      console.warn("[intellectual universe] fiches acquis indisponibles :", error.message);
    }

    const neededSolarSystemIds = new Set();
    const neededStarIds = new Set();
    for (const a of eclairageAcquisitions) {
      if (a.solar_system_id) neededSolarSystemIds.add(a.solar_system_id);
      if (a.star_id) neededStarIds.add(a.star_id);
    }

    let solarSystemById = new Map();
    if (neededSolarSystemIds.size) {
      const { data: solarSystemRows, error: solarSystemsError } = await supabase
        .from("solar_systems")
        .select("id, name, galaxy")
        .in("id", [...neededSolarSystemIds]);
      if (solarSystemsError) throw new Error(solarSystemsError.message);
      solarSystemById = new Map((solarSystemRows || []).map((s) => [s.id, s]));
    }

    let starById = new Map();
    if (neededStarIds.size) {
      const { data: starRows, error: starsError } = await supabase
        .from("stars")
        .select("id, name")
        .in("id", [...neededStarIds]);
      if (starsError) throw new Error(starsError.message);
      starById = new Map((starRows || []).map((s) => [s.id, s]));
    }

    const galaxyBuckets = new Map();
    const unclassified = [];
    const pushIntoTree = (solarSystem, starKey, starName, payload) => {
      if (!solarSystem) {
        unclassified.push(payload);
        return;
      }
      if (!galaxyBuckets.has(solarSystem.galaxy)) {
        galaxyBuckets.set(solarSystem.galaxy, { name: solarSystem.galaxy, solarSystems: new Map() });
      }
      const galaxyBucket = galaxyBuckets.get(solarSystem.galaxy);
      if (!galaxyBucket.solarSystems.has(solarSystem.id)) {
        galaxyBucket.solarSystems.set(solarSystem.id, { id: solarSystem.id, name: solarSystem.name, stars: new Map() });
      }
      const solarSystemBucket = galaxyBucket.solarSystems.get(solarSystem.id);
      // Plusieurs acquisitions peuvent pointer vers le même système/étoile. Si la première
      // ligne parcourue n'avait pas permis la restauration mais qu'une suivante porte le nom
      // complet correspondant à l'ancienne coupe, conserve cette version complète.
      if (solarSystem.name.length > solarSystemBucket.name.length) solarSystemBucket.name = solarSystem.name;
      if (!solarSystemBucket.stars.has(starKey)) {
        solarSystemBucket.stars.set(starKey, { key: starKey, name: starName, articles: [] });
      }
      const starBucket = solarSystemBucket.stars.get(starKey);
      if (starName.length > starBucket.name.length) starBucket.name = starName;
      starBucket.articles.push(payload);
    };

    // Étoiles Culture Générale : la notion précise (ex. "Résilience"), dédupliquée par IA à
    // l'acquisition (cf. resolveCultureGeneraleStarWithAI) à l'intérieur d'un système solaire
    // qui reste une sous-catégorie durable de la galaxie (ex. "Philosophie") — même hiérarchie
    // à deux niveaux que l'ancien système articles. Repli sur une étoile par occurrence
    // uniquement si l'étoile n'a pas pu être résolue (cas non classé, ou acquisition
    // antérieure à l'introduction de ce niveau). Jamais d'URL (aucune page dédiée à rouvrir)
    // — handleItemActivate (mon-univers.js) ignore déjà silencieusement une url absente.
    for (const a of eclairageAcquisitions) {
      const fiche = acquisFicheByKey.get(`${a.eclairage_type}:${a.eclairage_source_id}`);
      const storedDetail = String(a.eclairage_detail || "").trim();
      const sourceDetail = fiche?.sourceDetail?.sections?.length
        ? fiche.sourceDetail
        : (storedDetail ? { meta: null, sections: [{ label: null, text: storedDetail }], image: null } : null);
      const storedSolarSystem = a.solar_system_id ? solarSystemById.get(a.solar_system_id) : null;
      const star = a.star_id ? starById.get(a.star_id) : null;
      const solarSystem = storedSolarSystem
        ? { ...storedSolarSystem, name: restoreMechanicallyTruncatedUniverseName(storedSolarSystem.name, a.eclairage_name) }
        : null;
      const starKey = star ? `star:${star.id}` : `eclairage:${a.eclairage_type}:${a.eclairage_source_id}`;
      const starName = star
        ? restoreMechanicallyTruncatedUniverseName(star.name, a.eclairage_name)
        : (a.eclairage_name || "Culture générale");
      pushIntoTree(solarSystem, starKey, starName, {
        id: `eclairage:${a.eclairage_type}:${a.eclairage_source_id}`,
        title: fiche?.sourceName || a.eclairage_name,
        url: null,
        source: CULTURE_GENERALE_SOURCE_TYPE_LABEL[a.eclairage_type] || "Culture générale",
        sourceType: a.eclairage_type,
        sourceDebateId: a.eclairage_source_id,
        quizSlot: fiche?.notionQuizSlot || null,
        quizDate: fiche?.notionQuizDate || null,
        sourceDetail,
        category: null,
        categoryPrecision: null,
        acquiredAt: a.acquired_at
      });
    }

    // Tri déterministe : articles par acquiredAt décroissant ; étoiles/systèmes/galaxies par
    // nombre d'articles décroissant, égalité départagée par ordre alphabétique.
    const sortArticles = (arts) => arts.slice().sort((a, b) => (a.acquiredAt < b.acquiredAt ? 1 : a.acquiredAt > b.acquiredAt ? -1 : 0));

    let totalSolarSystems = 0;
    let totalArticles = 0;
    const galaxies = [...galaxyBuckets.values()]
      .map((bucket) => {
        const solarSystemsArr = [...bucket.solarSystems.values()]
          .map((s) => {
            const starsArr = [...s.stars.values()]
              .map((star) => ({
                id: star.key,
                name: star.name,
                articleCount: star.articles.length,
                articles: sortArticles(star.articles)
              }))
              .sort((a, b) => b.articleCount - a.articleCount || a.name.localeCompare(b.name, "fr"));
            const articleCount = starsArr.reduce((sum, star) => sum + star.articleCount, 0);
            totalArticles += articleCount;
            return { id: s.id, name: s.name, articleCount, stars: starsArr };
          })
          .sort((a, b) => b.articleCount - a.articleCount || a.name.localeCompare(b.name, "fr"));
        totalSolarSystems += solarSystemsArr.length;
        const articleCount = solarSystemsArr.reduce((sum, s) => sum + s.articleCount, 0);
        return { name: bucket.name, articleCount, solarSystems: solarSystemsArr };
      })
      .sort((a, b) => b.articleCount - a.articleCount || a.name.localeCompare(b.name, "fr"));

    const sortedUnclassified = sortArticles(unclassified);
    const totals = {
      // Compte les étoiles au sens large (contenus Culture Générale), pas seulement des
      // articles — nom de champ conservé tel quel (API déjà publiée, non consommé par le
      // frontend actuel).
      articles: totalArticles + sortedUnclassified.length,
      solarSystems: totalSolarSystems,
      galaxies: galaxies.length,
      unclassifiedArticles: sortedUnclassified.length
    };

    console.log(`[intellectual universe] user=${user.id} articles=${totals.articles} solarSystems=${totals.solarSystems} galaxies=${totals.galaxies} unclassified=${totals.unclassifiedArticles}`);

    const responsePayload = { userId: user.id, totals, galaxies, unclassified: sortedUnclassified, knowledgeLinks };
    setCachedIntellectualUniverseResponse(validation.legacyKey, responsePayload);
    res.json(responsePayload);
  } catch (error) {
    console.error("[intellectual universe]", error.message);
    return sendServerError(res, "Erreur chargement univers intellectuel.");
  }
});

// Jauge de charge d'apprentissage (demande du 17/08/2026) : niveau
// calme/modéré/chargé/surchargé selon la projection des échéances FSRS déjà
// programmées sur les prochains jours (cf. fetchLearningLoadGaugeForUser,
// lib/spaced-repetition/learning-load.js pour la simulation elle-même).
// Lecture seule, aucune écriture, aucun appel IA. legacyKey uniquement,
// même identité que le reste du projet.
app.get("/api/users/learning-load", rateLimit("users", 30), async (req, res) => {
  try {
    const validation = validateLegacyKey(req.query?.legacyKey);
    if (validation.error) return res.status(400).json({ error: validation.error });

    const gauge = await fetchLearningLoadGaugeForUser(validation.legacyKey);
    if (!gauge) return res.status(500).json({ error: "Erreur calcul charge d'apprentissage." });

    res.json(gauge);
  } catch (error) {
    console.error("[learning-load]", error.message);
    return sendServerError(res, "Erreur calcul charge d'apprentissage.");
  }
});

/* =========================
   PUSH SUBSCRIPTIONS
========================= */

app.get("/api/push/public-key", (req, res) => {
  return res.json({
    available: !!VAPID_PUBLIC_KEY,
    publicKey: VAPID_PUBLIC_KEY || null
  });
});

app.post("/api/push-subscriptions", rateLimit("push-subscriptions", 20), async (req, res) => {
  try {
    const keyValidation = validateLegacyKey(req.body?.legacyKey);

    if (keyValidation.error) {
      return res.status(400).json({ error: keyValidation.error });
    }

    const subscriptionValidation = validatePushSubscription(req.body?.subscription);

    if (subscriptionValidation.error) {
      return res.status(400).json({ error: subscriptionValidation.error });
    }

    const { user } = await resolveLegacyUser(supabase, keyValidation.legacyKey);
    const subscription = await registerPushSubscription(supabase, {
      userId: user.id,
      subscription: subscriptionValidation.subscription,
      userAgent: req.get("user-agent") || req.body?.userAgent || ""
    });

    return res.json({
      success: true,
      subscription: {
        id: subscription.id,
        user_id: subscription.user_id,
        endpoint: subscription.endpoint,
        created_at: subscription.created_at,
        last_seen_at: subscription.last_seen_at,
        revoked_at: subscription.revoked_at
      }
    });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur abonnement push.");
  }
});

/* =========================
   ADMIN
========================= */

app.post("/api/admin/login", rateLimit("admin-login", 5), (req, res) => {
  const { password } = req.body || {};

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Mot de passe incorrect." });
  }

  const token = createAdminToken();
  res.json({ success: true, token });
});

app.post("/api/admin/logout", (req, res) => {
  res.json({ success: true });
});

app.get("/api/admin/session", requireAdmin, (req, res) => {
  res.json({ success: true });
});


function buildAdminTagOccurrenceStats(debates = [], cloudData = { bubbles: [] }) {
  const now = new Date();
  const enrichedItems = (Array.isArray(debates) ? debates : []).map((debate) => ({
    ...debate,
    keywords: Array.isArray(debate?.keywords) ? debate.keywords : []
  }));
  const bubbleTags = (Array.isArray(cloudData.bubbles) ? cloudData.bubbles : []).map((b) => ({
    tag: b.tag,
    normalizedTag: normalizeTag(b.tag),
    count: b.count || 0,
    trend: b.trend || 0
  }));
  const bubbleRankByTag = new Map(bubbleTags.map((item, index) => [normalizeTag(item.tag), index + 1]));
  const statsByKey = new Map();

  enrichedItems.forEach((debate) => {
    const rawTags = extractRawTagsFromItem(debate);
    const keywordTags = Array.isArray(debate?.keywords) ? debate.keywords : [];
    const seenKeys = new Set();

    rawTags.forEach((rawTag) => {
      const key = normalizeTag(rawTag);
      if (!key || seenKeys.has(key)) return;
      seenKeys.add(key);

      if (!statsByKey.has(key)) {
        statsByKey.set(key, {
          tag: rawTag,
          normalizedTag: key,
          count: 0,
          bubbleRank: bubbleRankByTag.get(key) || null,
          rawTags: new Map(),
          debates: []
        });
      }

      const stat = statsByKey.get(key);
      stat.count += 1;
      stat.rawTags.set(rawTag, (stat.rawTags.get(rawTag) || 0) + 1);

      stat.debates.push({
        id: debate.id,
        question: debate.question || debate.title || "Arène sans titre",
        created_at: debate.created_at || null,
        category: debate.category || debate.theme || null,
        type: debate.type || null,
        rawTags: [rawTag],
        removableTags: keywordTags.filter((k) => normalizeTag(k) === key),
        isPrimary: keywordTags.length > 0 && normalizeTag(keywordTags[0]) === key
      });
    });
  });

  const tags = Array.from(statsByKey.values()).map((stat) => ({
    tag: stat.tag,
    normalizedTag: stat.normalizedTag,
    count: stat.count,
    bubbleRank: stat.bubbleRank,
    rawTags: Array.from(stat.rawTags.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag)),
    debates: stat.debates.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
  })).sort((a, b) => (b.count - a.count) || ((a.bubbleRank || 999) - (b.bubbleRank || 999)) || a.tag.localeCompare(b.tag));

  return {
    generatedAt: now.toISOString(),
    totals: {
      debates: enrichedItems.length,
      tags: tags.length,
      bubbleTags: bubbleTags.length
    },
    bubbleTags,
    excludedTags: getExcludedTags(),
    tags
  };
}

// Traqueur d'egress (cf. supabaseEgressStats plus haut) : donne, table par table, le
// nombre de requêtes et les octets réellement transférés depuis le dernier redémarrage
// (ou le dernier reset manuel) — sert à vérifier concrètement qu'un correctif fait bien
// baisser le trafic, plutôt que de le supposer après lecture du code.
app.get("/api/admin/egress-stats", requireAdmin, (req, res) => {
  const byKey = [...supabaseEgressStats.byKey.entries()]
    .map(([key, v]) => ({ key, requests: v.requests, bytes: v.bytes, mb: +(v.bytes / 1024 / 1024).toFixed(3) }))
    .sort((a, b) => b.bytes - a.bytes);
  const elapsedMinutes = Math.max(1, Math.round((Date.now() - supabaseEgressStats.since) / 60000));
  res.json({
    since: new Date(supabaseEgressStats.since).toISOString(),
    elapsedMinutes,
    totalRequests: supabaseEgressStats.totalRequests,
    totalBytes: supabaseEgressStats.totalBytes,
    totalMB: +(supabaseEgressStats.totalBytes / 1024 / 1024).toFixed(3),
    mbPerHour: +((supabaseEgressStats.totalBytes / 1024 / 1024) / (elapsedMinutes / 60)).toFixed(3),
    byKey
  });
});

app.post("/api/admin/egress-stats/reset", requireAdmin, (req, res) => {
  supabaseEgressStats.since = Date.now();
  supabaseEgressStats.totalRequests = 0;
  supabaseEgressStats.totalBytes = 0;
  supabaseEgressStats.byKey.clear();
  res.json({ ok: true });
});

app.get("/api/admin/tag-occurrences", requireAdmin, async (req, res) => {
  try {
    const [{ data: debates, error }, cloudData] = await Promise.all([
      supabase.from("debates").select("*").order("created_at", { ascending: false }),
      loadCloudBubbles()
    ]);

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur lecture tags.");
    }

    return res.json(buildAdminTagOccurrenceStats(debates || [], cloudData));
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture tags.");
  }
});

app.post("/api/admin/detected-tags/exclude", requireAdmin, (req, res) => {
  try {
    const tag = String(req.body?.tag || "").trim();
    const variants = Array.isArray(req.body?.variants) ? req.body.variants : [];
    if (!normalizeTag(tag)) {
      return res.status(400).json({ error: "Tag manquant." });
    }
    const currentExcluded = readTagExclusionsForAdmin();
    const next = writeTagExclusionFiles(currentExcluded.concat([tag], variants));
    return res.json({ success: true, excludedTags: next });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur suppression tag.");
  }
});

app.post("/api/admin/debate/:id/keywords", requireAdmin, express.json(), async (req, res) => {
  try {
    const debateId = String(req.params.id || "").trim();
    const keyword = String(req.body?.keyword || "").trim();
    if (!debateId || !normalizeTag(keyword)) {
      return res.status(400).json({ error: "Arène ou tag manquant." });
    }
    const { data: row } = await supabase.from("debates").select("keywords").eq("id", debateId).maybeSingle();
    const current = normalizeKeywordList(row?.keywords || [], 10, 60);
    const needsAdd = !current.map(normalizeTag).includes(normalizeTag(keyword));
    const keywords = needsAdd ? await setDebateKeywords(debateId, [...current, keyword]) : current;
    if (needsAdd) syncCloudBubbleTagIfPresent(debateId).catch(console.error);
    return res.json({ success: true, debateId, keywords });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur ajout tag.");
  }
});

app.put("/api/admin/debate/:id/keywords/primary", requireAdmin, express.json(), async (req, res) => {
  try {
    const debateId = String(req.params.id || "").trim();
    const primary = String(req.body?.primary || "").trim();
    if (!debateId || !normalizeTag(primary)) {
      return res.status(400).json({ error: "Arène ou tag manquant." });
    }
    const { data: row } = await supabase.from("debates").select("keywords").eq("id", debateId).maybeSingle();
    const current = normalizeKeywordList(row?.keywords || [], 10, 60);
    const primaryKey = normalizeTag(primary);
    const idx = current.findIndex((k) => normalizeTag(k) === primaryKey);
    if (idx <= 0) return res.json({ success: true, debateId, keywords: current });
    const reordered = [current[idx], ...current.slice(0, idx), ...current.slice(idx + 1)];
    const keywords = await setDebateKeywords(debateId, reordered);
    syncCloudBubbleTagIfPresent(debateId).catch(console.error);
    return res.json({ success: true, debateId, keywords });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur promotion tag.");
  }
});

app.delete("/api/admin/debate/:id/keywords/:keyword", requireAdmin, async (req, res) => {
  try {
    const debateId = String(req.params.id || "").trim();
    const keyword = decodeURIComponent(String(req.params.keyword || "")).trim();
    if (!debateId || !normalizeTag(keyword)) {
      return res.status(400).json({ error: "Arène ou tag manquant." });
    }
    const keywords = await removeDebateKeyword(debateId, keyword);
    syncCloudBubbleTagIfPresent(debateId).catch(console.error);
    return res.json({ success: true, debateId, removedKeyword: keyword, keywords });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur suppression tag de l’arène.");
  }
});


app.post("/api/admin/tags/rename", requireAdmin, express.json(), async (req, res) => {
  try {
    const oldTag = String(req.body?.oldTag || "").trim();
    const newTag = String(req.body?.newTag || "").trim();
    if (!normalizeTag(oldTag) || !normalizeTag(newTag)) {
      return res.status(400).json({ error: "Ancien et nouveau tag requis." });
    }
    const oldKey = normalizeTag(oldTag);
    if (oldKey === normalizeTag(newTag)) {
      return res.status(400).json({ error: "Le nouveau nom est identique." });
    }

    const { data: allDebates } = await supabase.from("debates").select("id, keywords").not("keywords", "is", null);
    let updatedDebates = 0;
    const supabaseUpdates = [];
    for (const row of (allDebates || [])) {
      if (!Array.isArray(row.keywords)) continue;
      const updated = row.keywords.map((k) => normalizeTag(k) === oldKey ? newTag : k);
      if (updated.some((k, i) => k !== row.keywords[i])) {
        updatedDebates++;
        supabaseUpdates.push(supabase.from("debates").update({ keywords: updated }).eq("id", row.id));
      }
    }
    if (supabaseUpdates.length) await Promise.all(supabaseUpdates);

    // Mise à jour bulles
    const cloudData = await loadCloudBubbles();
    for (const bubble of cloudData.bubbles || []) {
      if (normalizeTag(bubble.tag) === oldKey) bubble.tag = newTag;
    }
    await saveCloudBubbles(cloudData);

    return res.json({ success: true, oldTag, newTag, updatedDebates });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur renommage tag.");
  }
});

app.delete("/api/admin/tags/delete-all", requireAdmin, express.json(), async (req, res) => {
  try {
    const tag = String(req.body?.tag || "").trim();
    if (!normalizeTag(tag)) return res.status(400).json({ error: "Tag manquant." });
    const tagKey = normalizeTag(tag);

    const { data: allDebates } = await supabase.from("debates").select("id, keywords").not("keywords", "is", null);
    let updatedDebates = 0;
    const supabaseDeletes = [];
    for (const row of (allDebates || [])) {
      if (!Array.isArray(row.keywords)) continue;
      const filtered = row.keywords.filter((k) => normalizeTag(k) !== tagKey);
      if (filtered.length !== row.keywords.length) {
        updatedDebates++;
        supabaseDeletes.push(supabase.from("debates").update({ keywords: filtered }).eq("id", row.id));
      }
    }
    if (supabaseDeletes.length) await Promise.all(supabaseDeletes);

    // Supprime des bulles
    const cloudData = await loadCloudBubbles();
    const before = (cloudData.bubbles || []).length;
    cloudData.bubbles = (cloudData.bubbles || []).filter((b) => normalizeTag(b.tag) !== tagKey);
    await saveCloudBubbles(cloudData);

    return res.json({ success: true, tag, updatedDebates, bubblesRemoved: before - cloudData.bubbles.length });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur suppression définitive du tag.");
  }
});

app.post("/api/admin/push/test-latest", requireAdmin, async (req, res) => {
  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return res.status(503).json({ error: "Configuration VAPID incomplete." });
    }

    const result = await sendTestPushToLatestSubscription(supabase, {
      publicKey: VAPID_PUBLIC_KEY,
      privateKey: VAPID_PRIVATE_KEY,
      subject: VAPID_SUBJECT
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur envoi push test.");
  }
});

app.post("/api/admin/push/process-pending", requireAdmin, async (req, res) => {
  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return res.status(503).json({ error: "Configuration VAPID incomplete." });
    }

    const limit = Math.min(5, Math.max(1, Number(req.body?.limit || 3)));
    const result = await processPendingPushEvents(supabase, {
      publicKey: VAPID_PUBLIC_KEY,
      privateKey: VAPID_PRIVATE_KEY,
      subject: VAPID_SUBJECT
    }, { limit });

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur traitement push.");
  }
});

app.post("/api/admin/push/broadcast-daily", requireAdmin, async (req, res) => {
  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return res.status(503).json({ error: "Configuration VAPID incomplète." });
    }

    // Le pipeline appelle cet endpoint à la fin de sa vague de publication.
    // Le push ne doit toutefois annoncer l'ouverture des arènes qu'une fois
    // les sept rubriques Éclairages effectivement publiées. Cette attente
    // déclenche aussi les générations manquantes, dans leur ordre de priorité.
    const eclairages = await ensureDailyEclairagesPublished(new Date());

    // Les publications se font par vagues (~8h et ~16h heure de Paris, cf.
    // tryGenerateDailyQuiz) : avant 13h on suppose la vague du matin, sinon
    // celle du soir. Seuil au milieu des deux vagues, avec un peu de marge
    // si l'admin clique un peu en retard sur la vague du matin.
    const isMorningWave = parisHour() < 13;
    const body = isMorningWave ? "Les arènes du matin sont ouvertes." : "Les arènes du soir sont ouvertes.";

    const result = await broadcastPush(supabase, {
      publicKey: VAPID_PUBLIC_KEY,
      privateKey: VAPID_PRIVATE_KEY,
      subject: VAPID_SUBJECT
    }, {
      title: "L'arène des idées",
      body,
      url: "/",
      icon: "/mnoria-icon-192.png",
      badge: "/mnoria-icon-192.png"
    });

    return res.json({ success: true, wave: isMorningWave ? "morning" : "evening", body, eclairages, ...result });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Éclairages non publiés : notification push non envoyée.");
  }
});

app.get("/api/admin/visits/today", requireAdmin, async (req, res) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("page_visits")
      .select("visitor_key, created_at")
      .gte("created_at", start.toISOString());

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur lecture visites.");
    }

    const rows = data || [];
    const uniqueVisitors = new Set(rows.map((r) => r.visitor_key));

    res.json({
      total_visits_today: rows.length,
      unique_visitors_today: uniqueVisitors.size
    });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture visites.");
  }
});

app.get("/api/admin/app-stats", requireAdmin, async (req, res) => {
  try {
    const [installsResult, pushResult] = await Promise.all([
      supabase.from("users").select("id", { count: "exact", head: true }).not("app_installed_at", "is", null),
      supabase.from("push_subscriptions").select("user_id").is("revoked_at", null)
    ]);

    if (installsResult.error) throw installsResult.error;
    if (pushResult.error) throw pushResult.error;

    const uniquePushUsers = new Set((pushResult.data || []).map((r) => r.user_id));

    res.json({
      total_app_installs: installsResult.count || 0,
      total_push_subscribers: uniquePushUsers.size
    });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture statistiques app.");
  }
});

/* =========================
   REPORTS
========================= */

app.post("/api/reports", rateLimit("reports", 10), async (req, res) => {
  try {
    const { target_type, target_id, reason, voterKey } = req.body || {};

    const allowedTypes = ["debate", "argument", "comment"];
    const allowedReasons = ["inapproprie", "doublon", "plusieurs_arguments"];

    if (!allowedTypes.includes(target_type)) {
      return res.status(400).json({ error: "Type de signalement invalide." });
    }

    if (!allowedReasons.includes(reason)) {
      return res.status(400).json({ error: "Motif de signalement invalide." });
    }

    if (!voterKey) {
      return res.status(400).json({ error: "Clé utilisateur manquante." });
    }

    const { data: existingReport, error: checkErr } = await supabase
      .from("reports")
      .select("id")
      .eq("target_type", target_type)
      .eq("target_id", target_id)
      .eq("voter_key", voterKey)
      .maybeSingle();

    if (checkErr) {
      console.error(checkErr);
      return sendServerError(res, "Erreur vérification signalement.");
    }

    if (existingReport) {
      return res.status(400).json({ error: "already_reported" });
    }

    const { data, error } = await supabase
      .from("reports")
      .insert({
        target_type,
        target_id,
        reason,
        voter_key: voterKey,
        created_at: nowIso()
      })
      .select("id")
      .single();

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Erreur création signalement." });
    }

    res.json({ success: true, id: data.id });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur création signalement.");
  }
});

app.get("/api/admin/reports", requireAdmin, async (req, res) => {
  try {
    const { data: reports, error } = await supabase
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur lecture signalements.");
    }

    const reportRows = reports || [];

    const debateIds = [...new Set(reportRows.filter((r) => r.target_type === "debate").map((r) => r.target_id))];
    const argumentIds = [...new Set(reportRows.filter((r) => r.target_type === "argument").map((r) => r.target_id))];
    const commentIds = [...new Set(reportRows.filter((r) => r.target_type === "comment").map((r) => r.target_id))];

    const debatesMap = new Map();
    const argumentsMap = new Map();
    const commentsMap = new Map();

    if (debateIds.length) {
      const { data: debatesData } = await supabase
        .from("debates")
        .select("id,question")
        .in("id", debateIds);

      for (const row of debatesData || []) debatesMap.set(row.id, row);
    }

    if (argumentIds.length) {
      const { data: argumentsData } = await supabase
        .from("arguments")
        .select("id,title,body,debate_id")
        .in("id", argumentIds);

      for (const row of argumentsData || []) argumentsMap.set(row.id, row);
    }

    if (commentIds.length) {
      const { data: commentsData } = await supabase
        .from("comments")
        .select("id,content,argument_id")
        .in("id", commentIds);

      for (const row of commentsData || []) commentsMap.set(row.id, row);

      const commentArgumentIds = [...new Set((commentsData || []).map((c) => c.argument_id).filter(Boolean))];
      const missingArgumentIds = commentArgumentIds.filter((id) => !argumentsMap.has(id));

      if (missingArgumentIds.length) {
        const { data: extraArguments } = await supabase
          .from("arguments")
          .select("id,title,body,debate_id")
          .in("id", missingArgumentIds);

        for (const row of extraArguments || []) argumentsMap.set(row.id, row);
      }
    }

    const grouped = new Map();

    for (const r of reportRows) {
      const key = `${r.target_type}__${r.target_id}__${r.reason}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          target_type: r.target_type,
          target_id: r.target_id,
          reason: r.reason,
          report_count: 0,
          last_report_at: r.created_at,
          debate_question: null,
          argument_title: null,
          argument_body: null,
          argument_debate_id: null,
          comment_content: null,
          comment_argument_id: null,
          comment_debate_id: null
        });
      }

      const item = grouped.get(key);
      item.report_count += 1;

      if (!item.last_report_at || new Date(r.created_at) > new Date(item.last_report_at)) {
        item.last_report_at = r.created_at;
      }

      if (r.target_type === "debate") {
        const debate = debatesMap.get(r.target_id);
        item.debate_question = debate?.question || null;
      }

      if (r.target_type === "argument") {
        const argument = argumentsMap.get(r.target_id);
        item.argument_title = argument?.title || null;
        item.argument_body = argument?.body || null;
        item.argument_debate_id = argument?.debate_id || null;
      }

      if (r.target_type === "comment") {
        const comment = commentsMap.get(r.target_id);
        const argument = comment ? argumentsMap.get(comment.argument_id) : null;
        item.comment_content = comment?.content || null;
        item.comment_argument_id = comment?.argument_id || null;
        item.comment_debate_id = argument?.debate_id || null;
      }
    }

    const rows = [...grouped.values()].sort((a, b) => {
      if (b.report_count !== a.report_count) return b.report_count - a.report_count;
      return new Date(b.last_report_at) - new Date(a.last_report_at);
    });

    res.json(rows);
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture signalements.");
  }
});

app.delete("/api/admin/reports/delete-all-targets", requireAdmin, async (req, res) => {
  try {
    const { data: reports, error: reportsErr } = await supabase
      .from("reports")
      .select("target_type, target_id");

    if (reportsErr) {
      console.error(reportsErr);
      return sendServerError(res, "Erreur lecture signalements.");
    }

    const rows = reports || [];
    const debateIds = [...new Set(rows.filter(r => r.target_type === "debate").map(r => r.target_id))];
    const argumentIds = [...new Set(rows.filter(r => r.target_type === "argument").map(r => r.target_id))];
    const commentIds = [...new Set(rows.filter(r => r.target_type === "comment").map(r => r.target_id))];

    // Supprime les débats signalés avec cascade complète
    for (const debateId of debateIds) {
      const debateRow = await getDebateById(debateId);
      if (!debateRow) continue;

      const { data: argRows } = await supabase.from("arguments").select("id").eq("debate_id", debateId);
      const debateArgIds = (argRows || []).map(r => r.id);

      if (debateArgIds.length) {
        const { data: comRows } = await supabase.from("comments").select("id").in("argument_id", debateArgIds);
        const debateComIds = (comRows || []).map(r => r.id);

        if (debateComIds.length) {
          await supabase.from("comment_likes").delete().in("comment_id", debateComIds);
          await supabase.from("reports").delete().eq("target_type", "comment").in("target_id", debateComIds);
          await supabase.from("notifications").delete().in("comment_id", debateComIds);
        }

        await supabase.from("votes").delete().in("argument_id", debateArgIds);
        await supabase.from("comments").delete().in("argument_id", debateArgIds);
        await supabase.from("reports").delete().eq("target_type", "argument").in("target_id", debateArgIds);
        await supabase.from("notifications").delete().in("argument_id", debateArgIds);
        await supabase.from("arguments").delete().eq("debate_id", debateId);
      }

      await supabase.from("reports").delete().eq("target_type", "debate").eq("target_id", debateId);
      await supabase.from("notifications").delete().eq("debate_id", debateId);
      await supabase.from("debates").delete().eq("id", debateId);

      if (debateRow.image_url) await deleteStoredMediaAsset(debateRow.image_url, debateImagesDir);
      if (debateRow.video_url) await deleteStoredMediaAsset(debateRow.video_url, debateVideosDir);
    }

    // Supprime les arguments signalés restants (pas déjà supprimés via un débat)
    if (argumentIds.length) {
      const { data: comRows } = await supabase.from("comments").select("id").in("argument_id", argumentIds);
      const argComIds = (comRows || []).map(r => r.id);

      if (argComIds.length) {
        await supabase.from("comment_likes").delete().in("comment_id", argComIds);
        await supabase.from("reports").delete().eq("target_type", "comment").in("target_id", argComIds);
        await supabase.from("notifications").delete().in("comment_id", argComIds);
        await supabase.from("comments").delete().in("argument_id", argumentIds);
      }

      await supabase.from("votes").delete().in("argument_id", argumentIds);
      await supabase.from("reports").delete().eq("target_type", "argument").in("target_id", argumentIds);
      await supabase.from("notifications").delete().in("argument_id", argumentIds);
      await supabase.from("arguments").delete().in("id", argumentIds);
    }

    // Supprime les commentaires signalés restants
    if (commentIds.length) {
      await supabase.from("comment_likes").delete().in("comment_id", commentIds);
      await supabase.from("reports").delete().eq("target_type", "comment").in("target_id", commentIds);
      await supabase.from("notifications").delete().in("comment_id", commentIds);
      await supabase.from("comments").delete().in("id", commentIds);
    }

    // Vide la table reports (filet de sécurité)
    await supabase.from("reports").delete().neq("id", 0);

    clearNotificationsApiResponseCache();
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur suppression des contenus signalés.");
  }
});

app.delete("/api/admin/reports/by-target", requireAdmin, async (req, res) => {
  try {
    const { target_type, target_id } = req.body || {};

    if (!target_type || !target_id) {
      return res.status(400).json({ error: "Paramètres manquants." });
    }

    const { error } = await supabase
      .from("reports")
      .delete()
      .eq("target_type", target_type)
      .eq("target_id", target_id);

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur suppression signalement.");
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur suppression signalement.");
  }
});

app.delete("/api/admin/reports/:id", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;

    const { error } = await supabase
      .from("reports")
      .delete()
      .eq("id", id);

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur suppression signalement.");
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur suppression signalement.");
  }
});

app.delete("/api/admin/reports", requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from("reports").delete().neq("id", 0);
    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur suppression signalements.");
    }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur suppression signalements.");
  }
});

/* =========================
   NOTIFICATIONS
========================= */

const NOTIFICATIONS_DEFAULT_PAGE_SIZE = 50;
const NOTIFICATIONS_MAX_PAGE_SIZE = 100;

app.get("/api/notifications/unread-count", rateLimit("notifications", 180), async (req, res) => {
  try {
    const userKey = String(req.query.userKey || "").trim();
    if (!userKey) {
      return res.status(400).json({ error: "Clé utilisateur manquante." });
    }

    // HEAD + count évite de transférer les messages complets uniquement pour
    // actualiser la pastille de la cloche.
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_key", userKey)
      .eq("is_read", 0);

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur lecture notifications.");
    }

    res.set("Cache-Control", "private, max-age=30");
    return res.json({ count: Math.max(0, Number(count) || 0) });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture notifications.");
  }
});

app.get("/api/notifications", rateLimit("notifications", 180), async (req, res) => {
  try {
    const userKey = String(req.query.userKey || "").trim();
    const requestedLimit = Number.parseInt(String(req.query.limit || ""), 10);
    const requestedOffset = Number.parseInt(String(req.query.offset || ""), 10);
    const safeLimit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(1, requestedLimit), NOTIFICATIONS_MAX_PAGE_SIZE)
      : NOTIFICATIONS_DEFAULT_PAGE_SIZE;
    const safeOffset = Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0;

    if (!userKey) {
      return res.status(400).json({ error: "Clé utilisateur manquante." });
    }

    const cachedResponse = getCachedNotificationsApiResponse(userKey, safeLimit, safeOffset);
    if (cachedResponse) {
      return res.json(cachedResponse);
    }

    const { data, error } = await supabase
      .from("notifications")
      .select(NOTIFICATIONS_API_SELECT_COLUMNS)
      .eq("user_key", userKey)
      .order("is_read", { ascending: true })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(safeOffset, safeOffset + safeLimit - 1);

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur lecture notifications.");
    }

    const payload = data || [];
    setCachedNotificationsApiResponse(userKey, safeLimit, safeOffset, payload);
    res.json(payload);
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture notifications.");
  }
});

app.post("/api/notifications/read-all", rateLimit("notifications", 180), async (req, res) => {
  try {
    const { userKey } = req.body || {};

    if (!userKey) {
      return res.status(400).json({ error: "Clé utilisateur manquante." });
    }

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: 1 })
      .eq("user_key", userKey);

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur mise à jour notifications.");
    }

    clearNotificationsApiResponseCache(userKey);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur mise à jour notifications.");
  }
});

app.post("/api/notifications/delete-all", rateLimit("notifications", 180), async (req, res) => {
  try {
    const { userKey } = req.body || {};

    if (!userKey) {
      return res.status(400).json({ error: "Clé utilisateur manquante." });
    }

    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("user_key", userKey);

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur suppression notifications.");
    }

    clearNotificationsApiResponseCache(userKey);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur suppression notifications.");
  }
});

app.post("/api/notifications/read-one", rateLimit("notifications", 180), async (req, res) => {
  try {
    const { userKey, notificationId } = req.body || {};

    if (!userKey || !notificationId) {
      return res.status(400).json({ error: "Paramètres manquants." });
    }

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: 1 })
      .eq("id", notificationId)
      .eq("user_key", userKey);

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur mise à jour notification.");
    }

    clearNotificationsApiResponseCache(userKey);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur mise à jour notification.");
  }
});

app.post("/api/notifications/read-from-push", rateLimit("notifications", 180), async (req, res) => {
  try {
    const { notificationId } = req.body || {};

    if (!notificationId) {
      return res.status(400).json({ error: "Paramètres manquants." });
    }

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: 1 })
      .eq("id", notificationId);

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur mise à jour notification.");
    }

    clearNotificationsApiResponseCache();
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur mise à jour notification.");
  }
});

/* =========================
   ADMIN EDIT
========================= */
function addToMediaExtras(currentExtras, type, url, publishedAt) {
  const arr = Array.isArray(currentExtras) ? [...currentExtras] : [];
  const normalized = String(url || "").trim();
  if (!normalized) return arr;
  if (arr.some(e => e.url === normalized)) return arr;
  const entry = { type, url: normalized, added_at: new Date().toISOString() };
  if (publishedAt) entry.published_at = publishedAt;
  arr.push(entry);
  return arr;
}

app.put("/api/admin/debate/:id", requireAdmin, async (req, res) => {
  try {
    const { question, option_a, option_b, source_url, content, category, image_url, video_url, mark_as_mnoria_generated, story_id } = req.body || {};
    const normalizedContent = normalizeDebateContent(content);
    const normalizedSourceUrl = normalizeExternalUrl(source_url);
    const normalizedCategory = String(category || "").trim() || null;
    const imageUrlSent = 'image_url' in (req.body || {});
    const videoUrlSent = 'video_url' in (req.body || {});
    const sourceUrlSent = 'source_url' in (req.body || {});
    const normalizedImageUrl = imageUrlSent ? String(image_url || "").trim() : undefined;
    const normalizedVideoUrl = videoUrlSent ? String(video_url || "").trim() : undefined;

    if (normalizedSourceUrl) {
      try { await getExternalLinkPreview(normalizedSourceUrl); } catch (e) {
        console.error("Erreur préchargement aperçu source (admin edit):", e);
      }
    }

    const { data: currentRow } = await supabase
      .from("debates")
      .select("image_url, video_url, source_url, source_published_at, media_extras, creator_key, story_id")
      .eq("id", req.params.id)
      .single();

    let newExtras = Array.isArray(currentRow?.media_extras) ? [...currentRow.media_extras] : [];

    if (currentRow) {
      // image_url : si remplacée → historique ; si vidée → supprime storage
      if (imageUrlSent && normalizedImageUrl !== currentRow.image_url) {
        if (normalizedImageUrl) {
          newExtras = addToMediaExtras(newExtras, 'image', currentRow.image_url);
        } else {
          await deleteStoredMediaAsset(currentRow.image_url, debateImagesDir);
        }
      }
      // video_url : même logique
      if (videoUrlSent && normalizedVideoUrl !== currentRow.video_url) {
        if (normalizedVideoUrl) {
          newExtras = addToMediaExtras(newExtras, 'video', currentRow.video_url);
        } else {
          await deleteStoredMediaAsset(currentRow.video_url, debateVideosDir);
        }
      }
      // source_url : si remplacée → historique (avec published_at original)
      if (sourceUrlSent && normalizedSourceUrl !== currentRow.source_url && currentRow.source_url) {
        if (normalizedSourceUrl) {
          newExtras = addToMediaExtras(newExtras, 'source', currentRow.source_url, currentRow.source_published_at);
        }
      }
    }

    const extrasChanged = JSON.stringify(newExtras) !== JSON.stringify(currentRow?.media_extras || []);
    const sourceChanged = sourceUrlSent && normalizedSourceUrl && normalizedSourceUrl !== currentRow?.source_url;

    const updateFields = {
      question, option_a, option_b,
      source_url: normalizedSourceUrl || "",
      content: normalizedContent,
      ...(normalizedCategory ? { category: normalizedCategory } : {}),
      ...(imageUrlSent ? { image_url: normalizedImageUrl || "" } : {}),
      ...(videoUrlSent ? { video_url: normalizedVideoUrl || "" } : {}),
      ...(extrasChanged ? { media_extras: newExtras } : {}),
      ...(sourceChanged ? { source_published_at: new Date().toISOString() } : {}),
      ...(mark_as_mnoria_generated === true ? { creator_key: MNORIA_ADMIN_CREATOR_KEY } : {})
    };

    const { error } = await supabase.from("debates").update(updateFields).eq("id", req.params.id);

    if (error) {
      const combined = `${String(error.message || "")} ${String(error.details || "")} ${String(error.hint || "")}`.toLowerCase();
      if (combined.includes("content") || combined.includes("column") || combined.includes("media_extras")) {
        const safe = { ...updateFields };
        delete safe.content;
        delete safe.media_extras;
        const { error: fallbackError } = await supabase.from("debates").update(safe).eq("id", req.params.id);
        if (fallbackError) {
          console.error(fallbackError);
          return res.status(500).json({ error: "Erreur modification débat." });
        }
      } else {
        console.error(error);
        return res.status(500).json({ error: "Erreur modification débat." });
      }
    }

    if ('story_id' in (req.body || {})) {
      const previousStoryId = currentRow?.story_id || null;
      await setDebateStoryId(req.params.id, story_id || "");
      const newStoryId = String(story_id || "").trim();
      if (newStoryId) await recalculateStoryEpisodeNavigation(newStoryId);
      if (previousStoryId && previousStoryId !== newStoryId) await recalculateStoryEpisodeNavigation(previousStoryId);
    }
    invalidateDebateCaches(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur modification débat." });
  }
});

app.put("/api/admin/debate/:id/media-extras", requireAdmin, express.json(), async (req, res) => {
  try {
    const debateId = req.params.id;
    const { media_extras } = req.body || {};
    if (!Array.isArray(media_extras)) {
      return res.status(400).json({ error: "media_extras doit être un tableau." });
    }
    const sanitized = media_extras
      .filter(e => e && String(e.url || "").trim())
      .map(e => ({
        type: ["image", "video", "source"].includes(e.type) ? e.type : "source",
        url: String(e.url).trim(),
        ...(e.added_at ? { added_at: e.added_at } : {})
      }));
    const { error } = await supabase.from("debates").update({ media_extras: sanitized }).eq("id", debateId);
    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Erreur mise à jour sources." });
    }
    invalidateDebateCaches(debateId);
    res.json({ success: true, media_extras: sanitized });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur mise à jour sources." });
  }
});

app.post("/api/admin/debate/:id/bump", requireAdmin, async (req, res) => {
  try {
    const debateId = req.params.id;
    const preserveMnoriaGenerated = req.body?.preserve_mnoria_generated === true;
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("debates")
      .update({
        bumped_at: now,
        creator_key: preserveMnoriaGenerated ? MNORIA_ADMIN_CREATOR_KEY : null,
        ...(preserveMnoriaGenerated ? { created_at: now, source_published_at: now } : {})
      })
      .eq("id", debateId);
    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Erreur bump débat." });
    }
    invalidateDebateCaches(debateId);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur bump débat." });
  }
});

app.post("/api/admin/debate/:id/image", requireAdmin, express.json({ limit: "20mb" }), async (req, res) => {
  try {
    const debateId = req.params.id;
    const { dataUrl, type } = req.body || {};
    const debateRow = await getDebateById(debateId);
    if (!debateRow) return res.status(404).json({ error: "Débat introuvable." });

    // Upload sans supprimer l'ancien (gardé en historique)
    const publicUrl = await saveUploadedDebateImage(debateId, { dataUrl, type });

    const newExtras = addToMediaExtras(
      Array.isArray(debateRow.media_extras) ? debateRow.media_extras : [],
      'image', debateRow.image_url
    );

    await supabase.from("debates")
      .update({ image_url: publicUrl, media_extras: newExtras })
      .eq("id", debateId);

    invalidateDebateCaches(debateId);
    return res.json({ success: true, image_url: publicUrl });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || "Erreur upload image." });
  }
});

app.post("/api/admin/debate/:id/video", requireAdmin, express.raw({
  type: (req) => {
    const ct = String(req.get("content-type") || "").toLowerCase().split(";")[0].trim();
    return ["application/octet-stream","video/mp4","video/webm","video/quicktime","video/x-m4v"].includes(ct);
  },
  limit: `${MAX_DEBATE_VIDEO_BYTES}b`
}), async (req, res) => {
  try {
    const debateId = req.params.id;
    const debateRow = await getDebateById(debateId);
    if (!debateRow) return res.status(404).json({ error: "Débat introuvable." });

    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
    if (!buffer.length) return res.status(400).json({ error: "Vidéo manquante." });

    const fileName = String(req.get("x-file-name") || "video").trim();
    const mimeType = String(req.get("x-file-type") || req.get("content-type") || "").trim();

    // Upload sans supprimer l'ancien (gardé en historique)
    const storedVideo = await saveUploadedDebateVideo(debateId, buffer, fileName, mimeType);

    const newExtras = addToMediaExtras(
      Array.isArray(debateRow.media_extras) ? debateRow.media_extras : [],
      'video', debateRow.video_url
    );

    await supabase.from("debates")
      .update({ video_url: storedVideo.url, media_extras: newExtras })
      .eq("id", debateId);

    invalidateDebateCaches(debateId);
    return res.json({ success: true, video_url: storedVideo.url, mime_type: storedVideo.mimeType });
  } catch (error) {
    console.error(error);
    const msg = ["Vidéo trop lourde.", "Format vidéo non pris en charge.", "Vidéo vide."].includes(error?.message)
      ? error.message : "Erreur upload vidéo.";
    return res.status(500).json({ error: msg });
  }
});

app.put("/api/admin/argument/:id", requireAdmin, async (req, res) => {
  try {
    const { title, body } = req.body || {};

    const { error } = await supabase
      .from("arguments")
      .update({ title, body })
      .eq("id", req.params.id);

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Erreur modification argument." });
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur modification argument." });
  }
});

app.post("/api/admin/argument/:id/set-votes", requireAdmin, async (req, res) => {
  try {
    const votes = Math.max(0, Math.round(Number(req.body?.votes || 0)));
    const { error } = await supabase
      .from("arguments")
      .update({
        votes,
        auto_vote_wave1_status: "done",
        auto_vote_wave2_status: "done"
      })
      .eq("id", req.params.id);
    if (error) return res.status(500).json({ error: "Erreur mise à jour votes." });
    console.log(`[admin set-votes] argument ${req.params.id} — votes=${votes}, vagues auto-vote neutralisées`);
    res.json({ success: true, votes });
  } catch (error) {
    return res.status(500).json({ error: "Erreur mise à jour votes." });
  }
});

/* =========================
   DEBATES
========================= */

app.get("/api/debates-latest-meta", async (_req, res) => {
  try {
    if (latestDebatesMetaCache && latestDebatesMetaCache.expiresAt > Date.now()) {
      return res.json(latestDebatesMetaCache.value);
    }

    if (!latestDebatesMetaInFlight) {
      latestDebatesMetaInFlight = (async () => {
        const { data, error } = await supabase
          .from("debates")
          .select("id,created_at")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(10);
        if (error) throw error;

        const recent = data || [];
        const value = {
          latestCreatedAt: recent[0]?.created_at || null,
          recent
        };
        latestDebatesMetaCache = {
          value,
          expiresAt: Date.now() + LATEST_DEBATES_META_CACHE_TTL_MS
        };
        return value;
      })().finally(() => {
        latestDebatesMetaInFlight = null;
      });
    }

    return res.json(await latestDebatesMetaInFlight);
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture publications récentes.");
  }
});

app.get("/api/debates", async (req, res) => {
  try {
    const clientKey = getRequestClientKey(req);
    const DEFAULT_DEBATES_PAGE_SIZE = 120;
    const MAX_DEBATES_PAGE_SIZE = 120;
    const rawLimit = Number.parseInt(String(req.query.limit || ""), 10);
    const rawOffset = Number.parseInt(String(req.query.offset || ""), 10);
    const hasPaginationLimit = Number.isFinite(rawLimit) && rawLimit > 0;
    const safeLimit = hasPaginationLimit
      ? Math.min(rawLimit, MAX_DEBATES_PAGE_SIZE)
      : DEFAULT_DEBATES_PAGE_SIZE;
    const safeOffset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
    const requestedSort = String(req.query.sort || "popular").trim().toLowerCase();
    const sortMode = ["popular", "recent", "old", "ideas"].includes(requestedSort)
      ? requestedSort
      : "popular";
    const effectiveSortMode = !hasPaginationLimit && sortMode === "popular" ? "recent" : sortMode;
    const searchQuery = String(req.query.search || "").trim().toLowerCase();
    const databaseSearchQuery = searchQuery
      .replace(/[%_,()."'\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    const categoryQuery = String(req.query.category || "").trim();
    const rawPoliticalGroupQuery = String(req.query.politicalGroup || "").trim();
    const politicalGroupQuery = (rawPoliticalGroupQuery === "left" || rawPoliticalGroupQuery === "right" || rawPoliticalGroupQuery === "mixed") ? rawPoliticalGroupQuery : "";
    // Lecture ciblée par ids (ex: cartes du top 10 Bulles Mnoria absentes des débats
    // récents de l'index) : mêmes enrichissements que la liste, plafonné à 20 ids.
    const idsQuery = String(req.query.ids || "")
      .split(",")
      .map((raw) => Number.parseInt(raw.trim(), 10))
      .filter((id) => Number.isFinite(id) && id > 0)
      .slice(0, 20);
    const cacheKey = getDebatesApiCacheKey({
      limit: safeLimit,
      offset: safeOffset,
      sort: effectiveSortMode,
      search: searchQuery,
      category: categoryQuery,
      politicalGroup: politicalGroupQuery
    });
    // Cache-Control: no-store ne concerne que le cache HTTP du navigateur : il
    // ne doit pas forcer une nouvelle lecture Supabase. Le bypass de données
    // reste volontaire et explicite via fresh=1.
    // Catégorie/orientation font désormais partie de la clé : elles peuvent être mises en cache
    // sans risque de mélanger deux carrousels. Avant ce correctif, chaque reconstruction de
    // l'accueil contournait le cache pour toutes les catégories et relisait quatre tables.
    const bypassCache = idsQuery.length > 0 || req.query.fresh === "1";
    const cachedResponse = bypassCache ? null : getCachedDebatesApiResponse(cacheKey);

    if (cachedResponse) {
      return res.json(cachedResponse.map((d) => sanitizeDebateForClient(d, clientKey)));
    }
    if (searchQuery && !databaseSearchQuery) {
      return res.json([]);
    }

    // Reconstruction isolée dans sa propre fonction pour pouvoir la partager entre
    // requêtes concurrentes visant la même cacheKey (cf. debatesApiInFlight plus bas) :
    // sans ce partage, plusieurs visiteurs arrivant pile au moment où le cache expire
    // déclenchaient chacun leur propre lecture Supabase (debates + arguments + comments
    // + votes, ×N) — cf. audit egress du 10/08/2026.
    const buildFreshDebatesRows = async () => {
    const canPageInDatabase = !searchQuery && (categoryQuery || effectiveSortMode === "recent" || effectiveSortMode === "old");
    const buildDebatesQuery = (selectColumns) => {
      let q = supabase.from("debates").select(selectColumns);
      if (idsQuery.length) {
        q = q.in("id", idsQuery);
      }
      if (categoryQuery) {
        q = q.eq("category", categoryQuery);
      }
      if (searchQuery) {
        // Le filtre est exécuté par PostgreSQL afin de ne plus transférer toute
        // la table avant de rechercher côté Node. Les caractères réservés du
        // langage de filtres PostgREST sont remplacés par des espaces.
        if (databaseSearchQuery) {
          const pattern = `%${databaseSearchQuery}%`;
          q = q.or([
            `question.ilike.${pattern}`,
            `category.ilike.${pattern}`,
            `option_a.ilike.${pattern}`,
            `option_b.ilike.${pattern}`
          ].join(","));
        }
      }
      // Pagination par catégorie des 3 nuages (carousels du front) : sans ce filtre,
      // le "load more" d'une rubrique thématique réinjecte des arènes d'un autre
      // groupe — arènes générales dans un nuage gauche/droite, ou variantes
      // gauche/droite (doublons visuels) dans la vue générale. "mixed" inclut les
      // arènes historiques et communautaires sans political_group.
      if (politicalGroupQuery === "mixed") {
        q = q.or("political_group.is.null,political_group.eq.mixed");
      } else if (politicalGroupQuery) {
        q = q.eq("political_group", politicalGroupQuery);
      }
      return q;
    };

    // canPageInDatabase : la base ne renvoie déjà que les safeLimit lignes affichées,
    // colonnes complètes directement utiles (pas de second aller-retour). Sinon (tri
    // "popular"/"ideas" sans catégorie ni recherche : tout le tableau doit être
    // comparé pour être classé) : passe 1 légère (id/created_at/bumped_at, sans
    // media_extras) sur l'ensemble des lignes correspondantes, colonnes complètes
    // relues plus bas une fois les identifiants réellement affichés connus (cf.
    // DEBATES_RANKING_SELECT_COLUMNS et l'audit egress du 10/08/2026 : media_extras
    // pèse à lui seul plusieurs Ko par ligne, inutile tant que le classement n'a pas
    // réduit le jeu de résultats aux quelques dizaines/centaines finalement envoyées).
    const { data: debates, error } = canPageInDatabase
      ? await buildDebatesQuery(DEBATES_LIST_SELECT_COLUMNS)
          .order("created_at", { ascending: effectiveSortMode === "old" })
          .range(safeOffset, safeOffset + safeLimit - 1)
      : await fetchAllSupabaseRows(() => buildDebatesQuery(DEBATES_RANKING_SELECT_COLUMNS).order("id", { ascending: true }));

    if (error) {
      console.error(error);
      throw error;
    }

    let debateRows = debates || [];
    if (!debateRows.length) {
      return [];
    }

    const debateIds = debateRows.map((d) => d.id);
    const sharedDebateIds = [...new Set(debateIds.map((id) => resolveSharedDebateId(id) || String(id)))];

    const { data: args, error: argsErr } = await fetchAllSupabaseRowsIn(sharedDebateIds, (idsChunk) =>
      supabase
        .from("arguments")
        .select("id,debate_id,side,votes,created_at,last_voted_at")
        .in("debate_id", idsChunk)
        .order("id", { ascending: true }));

    if (argsErr) {
      console.error(argsErr);
      throw argsErr;
    }

    const argsByDebate = new Map();
    const debateIdByArgumentId = new Map();
    for (const arg of args || []) {
      const debateKey = String(arg.debate_id || "");
      if (!argsByDebate.has(debateKey)) argsByDebate.set(debateKey, []);
      argsByDebate.get(debateKey).push(arg);
      debateIdByArgumentId.set(String(arg.id), debateKey);
    }

    const commentCountByDebate = new Map();
    const recentCommentCountByDebate = new Map();
    const comment48hCountByDebate = new Map();
    const comment7dCountByDebate = new Map();
    const lastCommentAtByDebate = new Map();
    const lastVoteAtByDebate = new Map();
    const argumentIds = (args || []).map((arg) => arg.id);
    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
    const cutoff48h = Date.now() - 48 * 60 * 60 * 1000;
    const cutoff7d = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const arg of args || []) {
      const debateKey = String(arg.debate_id || "");
      if (!debateKey || !arg.last_voted_at) continue;

      const previousLastVoteAt = lastVoteAtByDebate.get(debateKey);
      if (!previousLastVoteAt || new Date(arg.last_voted_at) > new Date(previousLastVoteAt)) {
        lastVoteAtByDebate.set(debateKey, arg.last_voted_at);
      }
    }

    if (argumentIds.length) {
      const commentsResult = await fetchAllSupabaseRowsIn(argumentIds, (idsChunk) =>
        supabase
          .from("comments")
          .select("argument_id,created_at")
          .in("argument_id", idsChunk)
          .order("id", { ascending: true }));

      if (commentsResult.error) {
        console.error(commentsResult.error);
        throw commentsResult.error;
      }

      for (const comment of commentsResult.data || []) {
        const debateId = debateIdByArgumentId.get(String(comment.argument_id));
        if (!debateId) continue;
        commentCountByDebate.set(debateId, Number(commentCountByDebate.get(debateId) || 0) + 1);

        if (comment.created_at) {
          const commentTime = new Date(comment.created_at).getTime();
          if (commentTime > cutoff24h) {
            recentCommentCountByDebate.set(debateId, Number(recentCommentCountByDebate.get(debateId) || 0) + 1);
          }
          if (commentTime > cutoff48h) {
            comment48hCountByDebate.set(debateId, Number(comment48hCountByDebate.get(debateId) || 0) + 1);
          }
          if (commentTime > cutoff7d) {
            comment7dCountByDebate.set(debateId, Number(comment7dCountByDebate.get(debateId) || 0) + 1);
          }
          const previousLastCommentAt = lastCommentAtByDebate.get(debateId);
          if (!previousLastCommentAt || new Date(comment.created_at) > new Date(previousLastCommentAt)) {
            lastCommentAtByDebate.set(debateId, comment.created_at);
          }
        }
      }
    }

    // Votes récents (7 jours max) pour le score d'activité des Bulles Mnoria :
    // la fenêtre temporelle limite la requête à un petit volume de lignes. Filtrage
    // supplémentaire par argumentIds (audit egress du 25/08/2026) : sans lui, cette requête
    // relisait TOUS les votes du site sur 7 jours à chaque reconstruction de cache, pas
    // seulement ceux des idées concernées par cette page.
    const vote48hCountByDebate = new Map();
    const vote7dCountByDebate = new Map();
    if (argumentIds.length) {
      const { data: recentVotes, error: recentVotesError } = await fetchAllSupabaseRowsIn(argumentIds, (idsChunk) =>
        supabase
          .from("votes")
          .select("argument_id,vote_count,created_at")
          .in("argument_id", idsChunk)
          .gte("created_at", new Date(cutoff7d).toISOString())
          .order("id", { ascending: true }));
      if (recentVotesError) {
        console.error("[recent votes]", recentVotesError.message);
      } else {
        for (const vote of recentVotes || []) {
          const debateId = debateIdByArgumentId.get(String(vote.argument_id));
          if (!debateId || !vote.created_at) continue;
          const voteWeight = Math.max(1, Number(vote.vote_count) || 1);
          vote7dCountByDebate.set(debateId, Number(vote7dCountByDebate.get(debateId) || 0) + voteWeight);
          if (new Date(vote.created_at).getTime() > cutoff48h) {
            vote48hCountByDebate.set(debateId, Number(vote48hCountByDebate.get(debateId) || 0) + voteWeight);
          }
        }
      }
    }

    // Rangée "légère" utilisée pour le tri : jamais les colonnes lourdes (media_extras,
    // content...) à ce stade côté branche non paginable en base — cf. le second passage
    // plus bas (fullRowById) qui ne relit les colonnes complètes que pour les lignes
    // effectivement conservées après tri/pagination.
    const rows = debateRows.map((d) => {
      const sharedDebateId = resolveSharedDebateId(d.id) || String(d.id);
      const debateArgs = argsByDebate.get(sharedDebateId) || [];
      const argument_count = debateArgs.length;
      const comment_count = Number(commentCountByDebate.get(sharedDebateId) || 0);
      const recent_argument_count = debateArgs.filter(a => a.created_at && new Date(a.created_at).getTime() > cutoff24h).length;
      const argument_count_48h = debateArgs.filter(a => a.created_at && new Date(a.created_at).getTime() > cutoff48h).length;
      const argument_count_7d = debateArgs.filter(a => a.created_at && new Date(a.created_at).getTime() > cutoff7d).length;
      const recent_comment_count = Number(recentCommentCountByDebate.get(sharedDebateId) || 0);
      const tension_score = recent_argument_count * 1 + recent_comment_count * 0.5;
      const last_argument_at = debateArgs.length
        ? debateArgs
            .map((a) => a.created_at)
            .filter(Boolean)
            .sort()
            .slice(-1)[0]
        : null;
      const last_comment_at = lastCommentAtByDebate.get(sharedDebateId) || null;
      const last_vote_at = lastVoteAtByDebate.get(sharedDebateId) || null;
      const last_activity_at = [last_argument_at, last_comment_at, last_vote_at, d.created_at]
        .filter(Boolean)
        .sort()
        .slice(-1)[0] || null;

      const votes_a = debateArgs
        .filter((a) => a.side === "A")
        .reduce((sum, a) => sum + Number(a.votes || 0), 0);

      const votes_b = debateArgs
        .filter((a) => a.side === "B")
        .reduce((sum, a) => sum + Number(a.votes || 0), 0);

      const { percentA, percentB } = computeDebatePercents([
        { side: "A", votes: votes_a },
        { side: "B", votes: votes_b }
      ]);

      return {
        id: d.id,
        created_at: d.created_at,
        bumped_at: d.bumped_at,
        argument_count,
        comment_count,
        recent_argument_count,
        recent_comment_count,
        argument_count_48h,
        argument_count_7d,
        comment_count_48h: Number(comment48hCountByDebate.get(sharedDebateId) || 0),
        comment_count_7d: Number(comment7dCountByDebate.get(sharedDebateId) || 0),
        vote_count_48h: Number(vote48hCountByDebate.get(sharedDebateId) || 0),
        vote_count_7d: Number(vote7dCountByDebate.get(sharedDebateId) || 0),
        tension_score,
        last_argument_at,
        last_comment_at,
        last_vote_at,
        last_activity_at,
        votes_a,
        votes_b,
        vote_count: votes_a + votes_b,
        percent_a: percentA,
        percent_b: percentB
      };
    });

    const getRowTime = (row, key) => {
      const rawDate = row?.[key] || "";
      return rawDate ? new Date(rawDate).getTime() || 0 : 0;
    };

    if (effectiveSortMode === "recent") {
      rows.sort((a, b) => {
        const createdDiff = getRowTime(b, "created_at") - getRowTime(a, "created_at");
        if (createdDiff !== 0) return createdDiff;
        return Number(b.id || 0) - Number(a.id || 0);
      });
    } else if (effectiveSortMode === "old") {
      rows.sort((a, b) => {
        const createdDiff = getRowTime(a, "created_at") - getRowTime(b, "created_at");
        if (createdDiff !== 0) return createdDiff;
        return Number(a.id || 0) - Number(b.id || 0);
      });
    } else if (effectiveSortMode === "ideas") {
      rows.sort((a, b) => {
        if (Number(b.argument_count || 0) !== Number(a.argument_count || 0)) {
          return Number(b.argument_count || 0) - Number(a.argument_count || 0);
        }
        if (Number(b.comment_count || 0) !== Number(a.comment_count || 0)) {
          return Number(b.comment_count || 0) - Number(a.comment_count || 0);
        }
        return Number(b.id || 0) - Number(a.id || 0);
      });
    } else {
      // "popular" / "À la une" : groupe A = arènes ≤ 24h, toujours avant groupe B.
      // À l'intérieur du groupe B : bump récent (8h) → activité récente (8h) → bump (7j) → activité globale → counts.
      const NEW_ARENA_PRIORITY_MS = 24 * 60 * 60 * 1000;
      const RECENT_BUMP_PRIORITY_MS = 8 * 60 * 60 * 1000;
      const RECENT_ACTIVITY_PRIORITY_WINDOW_MS = 8 * 60 * 60 * 1000;
      const BUMP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const isNew = (row) =>
        (row.created_at && (now - new Date(row.created_at).getTime()) < NEW_ARENA_PRIORITY_MS) ||
        (row.bumped_at && (now - new Date(row.bumped_at).getTime()) < NEW_ARENA_PRIORITY_MS);
      rows.sort((a, b) => {
        const aNew = isNew(a);
        const bNew = isNew(b);
        if (aNew !== bNew) return bNew ? 1 : -1;
        if (aNew && bNew) return new Date(b.created_at) - new Date(a.created_at);

        const aBump = a.bumped_at ? new Date(a.bumped_at).getTime() : 0;
        const bBump = b.bumped_at ? new Date(b.bumped_at).getTime() : 0;
        const aRecentBump = aBump > now - RECENT_BUMP_PRIORITY_MS;
        const bRecentBump = bBump > now - RECENT_BUMP_PRIORITY_MS;
        if (aRecentBump !== bRecentBump) return bRecentBump ? 1 : -1;
        if (aRecentBump && bRecentBump && aBump !== bBump) return bBump - aBump;

        const aDate = a.last_activity_at || a.last_argument_at || a.created_at || "";
        const bDate = b.last_activity_at || b.last_argument_at || b.created_at || "";
        const aTime = aDate ? new Date(aDate).getTime() : 0;
        const bTime = bDate ? new Date(bDate).getTime() : 0;
        const aActivityRecent = aTime > now - RECENT_ACTIVITY_PRIORITY_WINDOW_MS;
        const bActivityRecent = bTime > now - RECENT_ACTIVITY_PRIORITY_WINDOW_MS;

        if (aActivityRecent !== bActivityRecent) return bActivityRecent ? 1 : -1;
        if (aActivityRecent && bActivityRecent && bTime !== aTime) return bTime - aTime;

        const aOldBump = aBump > now - BUMP_WINDOW_MS;
        const bOldBump = bBump > now - BUMP_WINDOW_MS;
        if (aOldBump !== bOldBump) return bOldBump ? 1 : -1;
        if (aOldBump && bOldBump && aBump !== bBump) return bBump - aBump;

        if (bTime !== aTime) return bTime - aTime;

        if (b.argument_count !== a.argument_count) return b.argument_count - a.argument_count;
        if (b.comment_count !== a.comment_count) return b.comment_count - a.comment_count;
        if (b.vote_count !== a.vote_count) return b.vote_count - a.vote_count;
        return Number(b.id) - Number(a.id);
      });
    }

    const MAX_DEBATES_RESPONSE = 300;
    let pagedRows;
    if (canPageInDatabase) {
      pagedRows = rows;
    } else if (safeLimit || safeOffset > 0) {
      pagedRows = rows.slice(safeOffset, safeLimit ? safeOffset + safeLimit : undefined);
    } else {
      pagedRows = rows.slice(0, MAX_DEBATES_RESPONSE);
    }

    // Colonnes complètes (dont media_extras) : déjà présentes dans debateRows quand la
    // base a paginé directement (canPageInDatabase), sinon relues ici, uniquement pour
    // les quelques lignes retenues après tri/pagination — jamais pour tout le jeu trié.
    const fullRowById = new Map();
    if (canPageInDatabase) {
      for (const d of debateRows) fullRowById.set(String(d.id), d);
    } else {
      const pagedIds = pagedRows.map((row) => row.id);
      const { data: fullRows, error: fullRowsError } = await fetchAllSupabaseRowsIn(pagedIds, (idsChunk) =>
        supabase.from("debates").select(DEBATES_LIST_SELECT_COLUMNS).in("id", idsChunk));
      if (fullRowsError) {
        console.error(fullRowsError);
        throw fullRowsError;
      }
      for (const d of fullRows || []) fullRowById.set(String(d.id), d);
    }

    const urlsToWarm = [];
    const rowsWithSourcePreview = pagedRows
      .map((row) => {
        const fullRow = fullRowById.get(String(row.id));
        // Garde-fou : ligne supprimée entre la passe de tri (légère) et cette relecture
        // complète (fenêtre de quelques millisecondes) — écartée plutôt que de renvoyer
        // une carte à moitié vide.
        if (!fullRow) return null;
        return { ...enrichDebateWithStoredImage(fullRow), ...row };
      })
      .filter(Boolean)
      .map((row) => {
        if (!String(row.source_url || "").trim()) return row;

        const sourcePreview = getCachedExternalLinkPreview(row.source_url);
        if (sourcePreview) return { ...row, source_preview: sourcePreview };

        urlsToWarm.push(row.source_url);
        return row;
      });

    if (urlsToWarm.length) {
      setImmediate(async () => {
        for (let i = 0; i < urlsToWarm.length; i += 2) {
          await Promise.all(urlsToWarm.slice(i, i + 2).map(u => getExternalLinkPreview(u).catch(() => {})));
        }
      });
    }

    const cacheTtlMs = (effectiveSortMode === "recent" || effectiveSortMode === "old")
      ? DEBATES_RECENT_CACHE_TTL_MS
      : DEBATES_API_CACHE_TTL_MS;
    if (!bypassCache) {
      setCachedDebatesApiResponse(cacheKey, rowsWithSourcePreview, cacheTtlMs);
    }
    return rowsWithSourcePreview;
    };

    // bypassCache (ids=, fresh=1) : jamais partagé, chaque appelant veut sa propre
    // lecture à jour. Sinon, une seule reconstruction en vol par cacheKey — les
    // requêtes concurrentes attendent la même promesse au lieu de relire Supabase
    // chacune de leur côté (cf. debatesApiInFlight).
    let freshRowsPromise = bypassCache ? null : debatesApiInFlight.get(cacheKey);
    if (!freshRowsPromise) {
      freshRowsPromise = buildFreshDebatesRows();
      if (!bypassCache) {
        // Le même objet promesse (post-finally) est à la fois stocké dans la map et
        // celui attendu ci-dessous : une seule chaîne, jamais de rejet non intercepté
        // ailleurs (cf. le même principe sur latestDebatesMetaInFlight plus haut).
        freshRowsPromise = freshRowsPromise.finally(() => {
          if (debatesApiInFlight.get(cacheKey) === freshRowsPromise) {
            debatesApiInFlight.delete(cacheKey);
          }
        });
        debatesApiInFlight.set(cacheKey, freshRowsPromise);
      }
    }
    const rowsWithSourcePreview = await freshRowsPromise;
    res.json(rowsWithSourcePreview.map((d) => sanitizeDebateForClient(d, clientKey)));
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture débats.");
  }
});

const { generateCloudLabel, truncateToBubbleLabel } = require("./lib/cloud-label");

// Génère et enregistre le cloud_label en arrière-plan (jamais bloquant) :
// en cas d'échec IA, la colonne reste NULL et un fallback s'appliquera côté lecture.
async function assignDebateCloudLabel(debateId, fields) {
  try {
    const label = await generateCloudLabel(fields, supabase);
    if (!label) return;
    const { error } = await supabase.from("debates").update({ cloud_label: label }).eq("id", debateId);
    if (error) console.error("[cloud-label]", debateId, error.message);
    else console.log(`[cloud-label] débat ${debateId} — "${label}"`);
  } catch (e) {
    console.error("[cloud-label]", debateId, e.message);
  }
}

app.post("/api/debates", rateLimit("debates", 5), async (req, res) => {
  try {
    const { source_url, source_preview, resource_mode, image_upload, type, creatorKey, force_community, evaluation_axis_hidden, long_arguments, correction_strictness, politicalOrientation } = req.body || {};
    // Champs texte libres : caractères nuls retirés dès l'entrée (cf. stripNullChars).
    const question = stripNullChars(req.body?.question);
    const category = stripNullChars(req.body?.category);
    const content = stripNullChars(req.body?.content);
    const option_a = stripNullChars(req.body?.option_a);
    const option_b = stripNullChars(req.body?.option_b);
    const evaluation_axis = stripNullChars(req.body?.evaluation_axis);

    if (creatorKey === CERTAMEN_CREATOR_KEY) {
      const certamenQuestionKey = normalizeQuestionForMergeComparison(question);
      // Verrou synchrone (avant le premier await) : deux POST simultanés du même sujet
      // ne peuvent pas passer tous les deux, même à la même milliseconde.
      if (certamenQuestionKey && !claimCertamenQuestionKey(certamenQuestionKey)) {
        console.warn(`[certamen anti-doublon] POST refusé (verrou mémoire) : "${String(question || "").slice(0, 80)}"`);
        return res.status(409).json({ error: "Sujet identique déjà reçu il y a moins de 15 minutes." });
      }
      if (certamenQuestionKey) {
        const { data: recentCertamen } = await supabase
          .from("debates")
          .select("id, question")
          .eq("creator_key", CERTAMEN_CREATOR_KEY)
          .gte("created_at", new Date(Date.now() - CERTAMEN_DUPLICATE_WINDOW_MS).toISOString())
          .order("created_at", { ascending: false })
          .limit(50);
        const certamenDuplicate = (recentCertamen || []).find((d) => normalizeQuestionForMergeComparison(d.question) === certamenQuestionKey);
        if (certamenDuplicate) {
          console.warn(`[certamen anti-doublon] POST refusé (arène ${certamenDuplicate.id} déjà en base) : "${String(question || "").slice(0, 80)}"`);
          return res.status(409).json({ error: "Sujet identique déjà publié il y a moins de 15 minutes.", duplicateOfDebateId: certamenDuplicate.id });
        }
      }
    }

    const normalizedLongArguments = long_arguments === true;
    const normalizedContent = normalizeDebateContent(content);
    // Préserve la mise en page (sauts de ligne) telle que tapée par le créateur
    // dans le textarea : seuls les espaces/tabulations à l'intérieur d'une
    // ligne sont aplatis, pas les retours à la ligne entre les critères.
    const normalizedAxis = type === "open"
      ? String(evaluation_axis || "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\r\n?/g, "\n")
          .split("\n")
          .map((line) => line.replace(/[ \t]+/g, " ").trim())
          .join("\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
          .slice(0, 1500)
      : null;
    // Le créateur peut cacher son barème aux participants (l'IA l'applique quand même)
    const normalizedAxisHidden = Boolean(normalizedAxis && evaluation_axis_hidden === true);
    // Niveau de correction IA : toujours visible des participants, indépendant du masquage du barème ci-dessus.
    const normalizedStrictness = type === "open" && ["souple", "exigeant"].includes(String(correction_strictness || ""))
      ? String(correction_strictness)
      : null;
    const normalizedSourceUrl = normalizeExternalUrl(source_url);
    const normalizedResourceMode = ["none", "source", "image", "video"].includes(String(resource_mode || ""))
      ? String(resource_mode)
      : "none";
    const shouldCreateCommunityDebate = force_community === true;
    const requestedCreatorKey = String(creatorKey || "").trim();
    const debateCreatorKey = shouldCreateCommunityDebate
      ? (requestedCreatorKey && requestedCreatorKey !== MNORIA_ADMIN_CREATOR_KEY
        ? requestedCreatorKey
        : `community-${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`)
      : (isAdmin(req) ? MNORIA_ADMIN_CREATOR_KEY : (requestedCreatorKey || null));

    if (normalizedResourceMode === "source" && !normalizedSourceUrl) {
      return res.status(400).json({ error: "Lien source manquant." });
    }

    if (normalizedResourceMode === "image" && !image_upload) {
      return res.status(400).json({ error: "Image manquante." });
    }

    if (normalizedSourceUrl && image_upload) {
      return res.status(400).json({ error: "Choisis soit un lien source, soit une image importée." });
    }

    if (normalizedSourceUrl && source_preview) {
      try {
        await seedExternalLinkPreviewFromClient(normalizedSourceUrl, source_preview);
      } catch (error) {
        console.error("Erreur cache aperçu source fourni par le client:", error);
      }
    }

    if (normalizedSourceUrl) {
      try {
        await getExternalLinkPreview(normalizedSourceUrl);
      } catch (error) {
        console.error("Erreur préchargement aperçu source (create debate):", error);
      }
    }

    let insertResult = await supabase
      .from("debates")
      .insert({
        question,
        category,
        source_url: normalizedSourceUrl || "",
        content: normalizedContent,
        type: type || "debate",
        option_a,
        option_b,
        evaluation_axis: normalizedAxis,
        ...(normalizedAxisHidden ? { evaluation_axis_hidden: true } : {}),
        ...(normalizedLongArguments ? { long_arguments: true } : {}),
        ...(normalizedStrictness ? { correction_strictness: normalizedStrictness } : {}),
        creator_key: debateCreatorKey,
        created_at: nowIso(),
        political_orientation: politicalOrientation || null
      })
      .select("id")
      .single();

    if (insertResult.error) {
      const combined = `${String(insertResult.error.message || "")} ${String(insertResult.error.details || "")} ${String(insertResult.error.hint || "")}`.toLowerCase();
      if (combined.includes("content") || combined.includes("column")) {
        insertResult = await supabase
          .from("debates")
          .insert({
            question,
            category,
            source_url: normalizedSourceUrl || "",
            type: type || "debate",
            option_a,
            option_b,
            evaluation_axis: normalizedAxis,
            ...(normalizedAxisHidden ? { evaluation_axis_hidden: true } : {}),
            ...(normalizedLongArguments ? { long_arguments: true } : {}),
            ...(normalizedStrictness ? { correction_strictness: normalizedStrictness } : {}),
            creator_key: debateCreatorKey,
            created_at: nowIso(),
            political_orientation: politicalOrientation || null
          })
          .select("id")
          .single();
      }
    }

    const { data, error } = insertResult;

    if (error) {
      console.error(error);
      // Rien n'a été inséré : libère le verrou anti-doublon pour qu'un retry
      // légitime du pipeline Certamen ne soit pas bloqué pendant 15 minutes.
      if (creatorKey === CERTAMEN_CREATOR_KEY) {
        _certamenRecentQuestionKeys.delete(normalizeQuestionForMergeComparison(question));
      }
      return res.status(500).json({ error: "Erreur création débat." });
    }
    recordNewlyPublishedDebateInSimilarityCache({
      id: data.id,
      question,
      option_a,
      option_b,
      type: type || "debate",
      content: normalizedContent,
      created_at: new Date().toISOString()
    }, "api/debates");

    if (image_upload) {
      try {
        const storedImageUrl = await saveUploadedDebateImage(data.id, image_upload);
        await persistDebateMediaUrls(data.id, { image_url: storedImageUrl, video_url: "" });
      } catch (imageError) {
        console.error(imageError);
        return res.status(400).json({ error: "Erreur enregistrement image." });
      }
    } else if (normalizedResourceMode !== "video") {
      await persistDebateMediaUrls(data.id, { image_url: "", video_url: "" });
    }

    clearDebatesApiResponseCache();

    setImmediate(async () => {
      assignDebateCloudLabel(data.id, {
        question,
        content: normalizedContent,
        optionA: option_a,
        optionB: option_b,
        category,
        type: type || "debate"
      });
      try {
        // Certamen (pipeline bot veille) publie ses arènes communauté via cet endpoint
        // avec ce creatorKey fixe : jamais de badge de tendance sur ces cartes.
        // En revanche, une tentative de fusion automatique est faite si une arène
        // similaire existe dans la fenêtre de 1h–36h précédente.
        if (creatorKey === CERTAMEN_CREATOR_KEY) {
          await tryCertamenAutoMerge(data.id, {
            question,
            content: normalizedContent,
            option_a,
            option_b,
          });
          await rebuildCloudBubblesAfterPublish("create-debate", data.id);
          return;
        }

        if (shouldCreateCommunityDebate) {
          mnoriaBubbleTrendsCache = null;
          return;
        }

        const currentSourceCount = normalizedSourceUrl ? 1 : 0;
        // Sans source, la tendance (croissance du nombre de sources sur une même
        // séquence d'actualité) n'a pas de sens : on évite l'appel IA de comparaison.
        let trendEntry;
        if (!normalizedSourceUrl) {
          trendEntry = { trend: 0, sourceCount: currentSourceCount, matchedSubjectId: null };
        } else {
          const matchCutoff = Date.now() - MIN_TREND_MATCH_GAP_MS;
          const { data: recentRows } = await supabase
            .from("debates")
            .select("id, question, content, source_url, media_extras, created_at, keywords")
            .neq("id", data.id)
            .lte("created_at", new Date(matchCutoff).toISOString())
            .order("created_at", { ascending: false })
            .limit(TREND_RECENT_SUBJECTS_LIMIT);
          const recentSubjects = (recentRows || [])
            .map((d) => {
            const extras = Array.isArray(d.media_extras) ? d.media_extras : [];
            const srcExtras = extras.filter((e) => e && typeof e === "object" &&
              String(e.type || "source").trim() === "source" &&
              (e.url || e.source_url || e.source || e.media || e.publisher));
            const previousSourceKeys = new Set(
              srcExtras.map((e) => String(e.url || e.source_url || e.source || e.media || e.publisher || "").trim().toLowerCase()).filter(Boolean)
            );
            if (!previousSourceKeys.size && d.source_url) previousSourceKeys.add(String(d.source_url).trim().toLowerCase());
            return {
              id: String(d.id),
              question: String(d.question || ""),
              resume: String(d.content || "").slice(0, 200),
              tags: normalizeKeywordList(d.keywords || [], 10, 60),
              sourceCount: previousSourceKeys.size,
              created_at: d.created_at
            };
          });
          const newSubject = {
            id: String(data.id),
            question: String(question || ""),
            resume: String(normalizedContent || "").slice(0, 200),
            tags: [],
            sourceCount: currentSourceCount
          };
          const matched = await findSimilarRecentSubjectForTrend(newSubject, recentSubjects);
          let computedTrend = 0;
          if (!matched) {
            trendEntry = { trend: 0, sourceCount: currentSourceCount, matchedSubjectId: null };
          } else {
            const previousSourceCount = matched.sourceCount || 0;
            if (previousSourceCount === 0 && currentSourceCount === 0) computedTrend = 0;
            else if (previousSourceCount === 0) computedTrend = 100;
            else computedTrend = Math.round(((currentSourceCount - previousSourceCount) / previousSourceCount) * 100);
            trendEntry = {
              trend: computedTrend,
              sourceCount: currentSourceCount,
              matchedSubjectId: matched.id,
              matchedSubjectIds: Array.isArray(matched.matchedIds) && matched.matchedIds.length ? matched.matchedIds : [String(matched.id)],
              matchedSubjectTitle: matched.question,
              previousSourceCount: matched.sourceCount || 0,
              reason: matched.reason || ""
            };
          }
        }
        setDebateTrend(data.id, trendEntry);
        await rebuildCloudBubblesAfterPublish("create-debate", data.id);
      } catch (trendErr) {
        console.error("[trend] erreur calcul tendance (create-debate) :", trendErr.message);
        await rebuildCloudBubblesAfterPublish("create-debate", data.id).catch(() => {});
      }
    });

    res.json({ id: data.id });
  } catch (error) {
    console.error(error);
    // Même logique que l'échec d'insert : exception avant/pendant l'insert → verrou libéré.
    if (req.body?.creatorKey === CERTAMEN_CREATOR_KEY) {
      _certamenRecentQuestionKeys.delete(normalizeQuestionForMergeComparison(req.body?.question));
    }
    return res.status(500).json({ error: "Erreur création débat." });
  }
});



app.post("/api/debates/:id/video-upload-url", async (req, res) => {
  try {
    const debateId = req.params.id;
    const authorKey = String(req.query.authorKey || req.get("x-author-key") || "").trim();
    const debateRow = await getDebateById(debateId);

    if (!debateRow) {
      return res.status(404).json({ error: "Débat introuvable." });
    }

    const isOwner =
      authorKey &&
      debateRow.creator_key &&
      String(debateRow.creator_key) === authorKey;

    if (!isAdmin(req) && !isOwner) {
      return res.status(403).json({ error: "Ajout vidéo non autorisé." });
    }

    const fileName = String(req.body?.fileName || "video").trim();
    const mimeType = String(req.body?.contentType || "").trim().toLowerCase();
    const size = Number(req.body?.size || 0);

    if (!size || !Number.isFinite(size) || size <= 0) {
      return res.status(400).json({ error: "Taille vidéo invalide." });
    }

    if (size > MAX_DEBATE_VIDEO_BYTES) {
      return res.status(400).json({ error: "Vidéo trop lourde." });
    }

    const detectedExtension = getVideoExtensionFromMimeType(mimeType) || getVideoExtensionFromFilename(fileName);
    if (!detectedExtension) {
      return res.status(400).json({ error: "Format vidéo non pris en charge." });
    }

    const extension = normalizeVideoStorageExtension(detectedExtension);
    const objectPath = buildDebateMediaStoragePath(debateId, "video", extension);
    const { data, error } = await supabase.storage
      .from(SUPABASE_DEBATE_MEDIA_BUCKET)
      .createSignedUploadUrl(objectPath);

    if (error || !data?.token) {
      console.error("Erreur création signed upload URL vidéo:", error || data);
      return res.status(500).json({ error: "Erreur préparation upload vidéo." });
    }

    const signedUrl = `${SUPABASE_URL}/storage/v1/object/upload/sign/${SUPABASE_DEBATE_MEDIA_BUCKET}/${objectPath}?token=${encodeURIComponent(data.token)}`;

    return res.json({
      signedUrl,
      objectPath,
      mimeType: getVideoMimeTypeFromExtension(extension)
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur préparation upload vidéo." });
  }
});

app.get("/api/debates/:id/video-upload-status", async (req, res) => {
  try {
    const debateId = req.params.id;
    const authorKey = String(req.query.authorKey || req.get("x-author-key") || "").trim();
    const debateRow = await getDebateById(debateId);

    if (!debateRow) {
      return res.status(404).json({ error: "Débat introuvable." });
    }

    const isOwner =
      authorKey &&
      debateRow.creator_key &&
      String(debateRow.creator_key) === authorKey;

    if (!isAdmin(req) && !isOwner) {
      return res.status(403).json({ error: "Ajout vidéo non autorisé." });
    }

    const objectPath = String(req.query.objectPath || "").trim().replace(/^\/+/, "");
    if (!objectPath) {
      return res.status(400).json({ error: "Chemin vidéo manquant." });
    }

    const expectedPrefix = `debates/${debateId}/video-`;
    if (!objectPath.startsWith(expectedPrefix)) {
      return res.status(400).json({ error: "Chemin vidéo invalide." });
    }

    const publicUrl = getStoragePublicUrl(SUPABASE_DEBATE_MEDIA_BUCKET, objectPath);
    if (!publicUrl) {
      return res.status(500).json({ error: "Erreur vérification vidéo." });
    }

    const resolvedVideoUrl = getResolvedDebateVideoUrl(debateRow);
    const finalized = resolvedVideoUrl === publicUrl;
    const exists = finalized ? true : await storageObjectExists(objectPath);

    return res.json({
      exists,
      finalized,
      video_url: finalized ? publicUrl : ""
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur vérification vidéo." });
  }
});

app.post("/api/debates/:id/video-upload-complete", async (req, res) => {
  try {
    const debateId = req.params.id;
    const authorKey = String(req.query.authorKey || req.get("x-author-key") || "").trim();
    const debateRow = await getDebateById(debateId);

    if (!debateRow) {
      return res.status(404).json({ error: "Débat introuvable." });
    }

    const isOwner =
      authorKey &&
      debateRow.creator_key &&
      String(debateRow.creator_key) === authorKey;

    if (!isAdmin(req) && !isOwner) {
      return res.status(403).json({ error: "Ajout vidéo non autorisé." });
    }

    const objectPath = String(req.body?.objectPath || "").trim().replace(/^\/+/, "");
    const mimeType = String(req.body?.mimeType || "").trim();

    if (!objectPath) {
      return res.status(400).json({ error: "Chemin vidéo manquant." });
    }

    const expectedPrefix = `debates/${debateId}/video-`;
    if (!objectPath.startsWith(expectedPrefix)) {
      return res.status(400).json({ error: "Chemin vidéo invalide." });
    }

    const publicUrl = getStoragePublicUrl(SUPABASE_DEBATE_MEDIA_BUCKET, objectPath);
    if (!publicUrl) {
      return res.status(500).json({ error: "Erreur finalisation vidéo." });
    }

    const alreadyResolvedVideoUrl = getResolvedDebateVideoUrl(debateRow);
    if (alreadyResolvedVideoUrl === publicUrl) {
      return res.json({
        success: true,
        already_finalized: true,
        video_url: publicUrl,
        mime_type: mimeType || getVideoMimeTypeFromExtension(getVideoExtensionFromFilename(objectPath))
      });
    }

    const objectExists = await storageObjectExists(objectPath);
    if (!objectExists) {
      return res.status(404).json({ error: "Fichier vidéo introuvable dans le stockage." });
    }

    if (debateRow.image_url) {
      await deleteStoredMediaAsset(debateRow.image_url, debateImagesDir);
    }

    if (debateRow.video_url && debateRow.video_url !== publicUrl) {
      await deleteStoredMediaAsset(debateRow.video_url, debateVideosDir);
    }

    await persistDebateMediaUrls(debateId, {
      image_url: "",
      video_url: publicUrl
    });

    return res.json({ success: true, video_url: publicUrl, mime_type: mimeType || getVideoMimeTypeFromExtension(getVideoExtensionFromFilename(objectPath)) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur finalisation vidéo." });
  }
});
app.post("/api/debates/:id/video-file", express.raw({
  type: (req) => {
    const contentType = String(req.get("content-type") || "").toLowerCase().split(";")[0].trim();
    return [
      "application/octet-stream",
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/x-m4v"
    ].includes(contentType);
  },
  limit: `${MAX_DEBATE_VIDEO_BYTES}b`
}), async (req, res) => {
  try {
    const debateId = req.params.id;
    const authorKey = String(req.query.authorKey || req.get("x-author-key") || "").trim();
    const debateRow = await getDebateById(debateId);

    if (!debateRow) {
      return res.status(404).json({ error: "Débat introuvable." });
    }

    const isOwner =
      authorKey &&
      debateRow.creator_key &&
      String(debateRow.creator_key) === authorKey;

    if (!isAdmin(req) && !isOwner) {
      return res.status(403).json({ error: "Ajout vidéo non autorisé." });
    }

    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
    if (!buffer.length) {
      return res.status(400).json({ error: "Vidéo manquante." });
    }

    const fileName = String(req.get("x-file-name") || "video").trim();
    const mimeType = String(req.get("x-file-type") || req.get("content-type") || "").trim();

    const storedVideo = await saveUploadedDebateVideo(debateId, buffer, fileName, mimeType, {
      previousVideoUrl: debateRow.video_url
    });

    if (debateRow.image_url) {
      await deleteStoredMediaAsset(debateRow.image_url, debateImagesDir);
    }

    await persistDebateMediaUrls(debateId, {
      image_url: "",
      video_url: storedVideo.url
    });

    return res.json({ success: true, video_url: storedVideo.url, mime_type: storedVideo.mimeType });
  } catch (error) {
    console.error(error);
    const message = error?.message === "Vidéo trop lourde."
      ? "Vidéo trop lourde."
      : error?.message === "Format vidéo non pris en charge."
        ? "Format vidéo non pris en charge."
        : "Erreur enregistrement vidéo.";
    return res.status(400).json({ error: message });
  }
});

// Map id → { status, scheduledAt } — doit être AVANT /api/debates/:id
// Admin : arènes dont le compte à rebours d'analyse est lancé (ou génération
// en cours), avec la question — pour la liste du menu admin.
app.get("/api/admin/analysis-queue", requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("debates")
    .select("id, question, ai_analysis_status, ai_analysis_scheduled_at")
    .in("ai_analysis_status", ["scheduled", "generating"])
    .order("ai_analysis_scheduled_at", { ascending: true })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data || []).map((row) => ({
    id: row.id,
    question: row.question || "",
    status: row.ai_analysis_status,
    scheduledAt: row.ai_analysis_scheduled_at || null
  })));
});

// Admin : annule un compte à rebours d'analyse pas encore parti. La condition
// eq("ai_analysis_status", "scheduled") est le pendant du claim atomique du
// scheduler : si la génération a démarré (generating), elle ira à son terme.
app.post("/api/admin/analysis-queue/:id/cancel", requireAdmin, async (req, res) => {
  const id = String(req.params.id || "").trim();
  const canonicalId = resolveSharedDebateId(id) || id;

  const { data: row } = await supabase
    .from("debates")
    .select("id, ai_analysis")
    .eq("id", canonicalId)
    .maybeSingle();
  if (!row) return res.status(404).json({ error: "Arène introuvable." });

  // Une régénération annulée ne doit pas faire disparaître le rapport existant.
  const restoredStatus = row.ai_analysis ? "ready" : "none";
  const { data: updated, error } = await supabase
    .from("debates")
    .update({ ai_analysis_status: restoredStatus, ai_analysis_scheduled_at: null })
    .eq("id", canonicalId)
    .eq("ai_analysis_status", "scheduled")
    .select("id");
  if (error) return res.status(500).json({ error: error.message });
  if (!updated || !updated.length) {
    return res.status(409).json({ error: "Plus annulable : la génération a probablement déjà démarré." });
  }
  return res.json({ ok: true, status: restoredStatus });
});

app.get("/api/debates/analysis-statuses", rateLimit("analysis-read", 240), async (req, res) => {
  if (analysisStatusesCache && analysisStatusesCache.expiresAt > Date.now()) {
    return res.json(analysisStatusesCache.value);
  }

  if (!analysisStatusesInFlight) {
    analysisStatusesInFlight = (async () => {
      const { data, error } = await supabase
        .from("debates")
        .select("id, ai_analysis_status, ai_analysis_scheduled_at")
        .in("ai_analysis_status", ["scheduled", "generating", "ready"]);
      if (error) throw error;

      const map = {};
      for (const row of data || []) {
        const entry = {
          status:      row.ai_analysis_status,
          scheduledAt: row.ai_analysis_scheduled_at || null
        };
        // Arènes fusionnées : l'état n'est stocké que sur l'arène canonique — on le
        // reflète aussi sur les arènes fusionnées avec elle pour que leurs cartes
        // affichent le même badge sur la page d'accueil.
        const groupIds = getDebateIdsInSharedSpace(row.id);
        for (const id of (groupIds.length > 1 ? groupIds : [row.id])) {
          map[id] = entry;
        }
      }
      analysisStatusesCache = { value: map, expiresAt: Date.now() + ANALYSIS_STATUSES_CACHE_TTL_MS };
      return map;
    })().finally(() => {
      analysisStatusesInFlight = null;
    });
  }

  try {
    return res.json(await analysisStatusesInFlight);
  } catch (error) {
    return res.json({});
  }
});

app.get("/api/debates/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const clientKey = getRequestClientKey(req);
    const isAdminRequest = isAdmin(req);
    const cachedResponse = getCachedDebateDetailResponse(id);
    if (cachedResponse) {
      return res.json(sanitizeDebateDetailPayload(cachedResponse, clientKey, isAdminRequest));
    }

    const canonicalId = resolveSharedDebateId(id);
    const isShared = canonicalId && canonicalId !== String(id);

    const [debate, args, canonicalDebate] = await Promise.all([
      getDebateById(id),
      getArgumentsByDebateId(id),
      // Arène fusionnée : on charge le canonique en parallèle pour récupérer
      // son ai_analysis_status sans requête supplémentaire (getDebateById est mis en cache).
      isShared ? getDebateById(canonicalId) : Promise.resolve(null)
    ]);

    if (!debate) {
      return res.status(404).json({ error: "Débat introuvable." });
    }

    // Arène fusionnée : l'analyse est stockée sur le canonique — on reflète
    // son statut dans la réponse pour que le client déclenche bien le fetch.
    if (isShared && canonicalDebate?.ai_analysis_status && canonicalDebate.ai_analysis_status !== "none") {
      debate.ai_analysis_status = canonicalDebate.ai_analysis_status;
    }

    const optionA = args.filter((a) => a.side === "A");
    const optionB = args.filter((a) => a.side === "B");
    const argumentIds = args.map((a) => a.id);

    // Preview : lecture synchrone du cache uniquement (mémoire puis disque).
    // Si absent, on répond immédiatement avec null et on lance le fetch en arrière-plan
    // pour que les prochaines requêtes bénéficient du cache.
    const sourcePreview = debate.source_url ? getCachedExternalLinkPreview(debate.source_url) : null;
    const previewSkipped = !!debate.source_url && sourcePreview === null;
    if (previewSkipped) {
      console.log(`[debate-detail] source preview skipped for fast response (id=${id})`);
      getExternalLinkPreview(debate.source_url).catch(() => {});
    }
    // TTL court si le preview manque : le cache expire avant la fin du fetch background,
    // donc la prochaine requête profitera du preview fraîchement mis en cache.
    const detailCacheTtlMs = previewSkipped ? 30 * 1000 : DEBATE_DETAIL_CACHE_TTL_MS;

    if (!argumentIds.length) {
      const payload = {
        debate,
        optionA,
        optionB,
        commentsByArgument: {},
        sourcePreview
      };
      setCachedDebateDetailResponse(id, payload, detailCacheTtlMs);
      return res.json(sanitizeDebateDetailPayload(payload, clientKey, isAdminRequest));
    }

    const comments = await getCommentsByArgumentIds(argumentIds);

    const commentsByArgument = {};

    for (const comment of comments) {
      if (!commentsByArgument[comment.argument_id]) {
        commentsByArgument[comment.argument_id] = [];
      }
      commentsByArgument[comment.argument_id].push(comment);
    }

    const payload = {
      debate,
      optionA,
      optionB,
      commentsByArgument,
      sourcePreview
    };

    setCachedDebateDetailResponse(id, payload, detailCacheTtlMs);
    res.json(sanitizeDebateDetailPayload(payload, clientKey, isAdminRequest));
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture arguments.");
  }
});

app.delete("/api/debates/:id", async (req, res) => {
  try {
    const debateId = req.params.id;
    const requesterKey = String(req.query.authorKey || "").trim();
    const adminMode = isAdmin(req);

    const debateRow = await getDebateById(debateId);
    if (!debateRow) {
      return res.status(404).json({ error: "Débat introuvable." });
    }

    const isOwner =
      requesterKey &&
      debateRow.creator_key &&
      String(debateRow.creator_key) === requesterKey;

    if (!adminMode && !isOwner) {
      return res.status(403).json({ error: "Suppression non autorisée." });
    }

    const { data: argumentsRows, error: argsErr } = await supabase
      .from("arguments")
      .select("id")
      .eq("debate_id", debateId);

    if (argsErr) {
      console.error(argsErr);
      return res.status(500).json({ error: "Erreur récupération arguments." });
    }

    const argumentIds = (argumentsRows || []).map((row) => row.id);

    for (const argId of argumentIds) {
      majorityWatchers.delete(String(argId));
    }

    if (argumentIds.length) {
      const { data: commentRows, error: commentsErr } = await supabase
        .from("comments")
        .select("id")
        .in("argument_id", argumentIds);

      if (commentsErr) {
        console.error(commentsErr);
        return res.status(500).json({ error: "Erreur récupération commentaires." });
      }

      const commentIds = (commentRows || []).map((row) => row.id);

      if (commentIds.length) {
        await supabase.from("comment_likes").delete().in("comment_id", commentIds);
        await supabase.from("reports").delete().eq("target_type", "comment").in("target_id", commentIds);
        await supabase.from("notifications").delete().in("comment_id", commentIds);
      }

      await supabase.from("votes").delete().in("argument_id", argumentIds);
      await supabase.from("comments").delete().in("argument_id", argumentIds);
      await supabase.from("reports").delete().eq("target_type", "argument").in("target_id", argumentIds);
      await supabase.from("notifications").delete().in("argument_id", argumentIds);
      await supabase.from("arguments").delete().eq("debate_id", debateId);
    }

    await supabase.from("reports").delete().eq("target_type", "debate").eq("target_id", debateId);
    await supabase.from("notifications").delete().eq("debate_id", debateId);
    const storedImageUrl = debateRow.image_url;
    const storedVideoUrl = debateRow.video_url;
    const linkedStoryId = debateRow.story_id || null;

    const { error: deleteErr } = await supabase.from("debates").delete().eq("id", debateId);

    if (deleteErr) {
      console.error(deleteErr);
      return res.status(500).json({ error: "Erreur suppression débat." });
    }

    if (storedImageUrl) {
      await deleteStoredMediaAsset(storedImageUrl, debateImagesDir);
    }

    if (storedVideoUrl) {
      await deleteStoredMediaAsset(storedVideoUrl, debateVideosDir);
    }

    clearNotificationsApiResponseCache();
    removeDebateSharedLink(debateId);
    removeDebateStoryId(debateId);
    removeDebateEpisodeNav(debateId);

    invalidateSharedDebateCaches(debateId);
    if (linkedStoryId) {
      await recalculateStoryEpisodeNavigation(linkedStoryId);
    }
    clearNotificationsApiResponseCache();
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur suppression débat." });
  }
});

/* =========================
   ARGUMENTS
========================= */

app.post("/api/arguments", rateLimit("arguments", 10), async (req, res) => {
  try {
    const { debate_id, side, title, body, authorKey, source_url, pasteRatio, pastedChars, manualWritingBadge, usedMicrophone } = req.body || {};
    const requestedDebateId = debate_id;
    const sharedDebateId = resolveSharedDebateId(debate_id) || debate_id;
    const sourceDebateRow = await getDebateById(requestedDebateId);
    const maxBodyLength = sourceDebateRow?.long_arguments ? 1800 : 600;
    const isOpenDebate = !String(sourceDebateRow?.option_a || "").trim() && !String(sourceDebateRow?.option_b || "").trim();
    const normalizedSide = isOpenDebate ? "A" : side;

    const { data, error } = await supabase
      .from("arguments")
      .insert({
        debate_id: sharedDebateId,
        side: normalizedSide,
        title: limitText(title, 180),
        body: limitText(body, maxBodyLength),
        source_url: limitText(source_url, 1000),
        author_key: authorKey || null,
        votes: 0,
        created_at: nowIso(),
        paste_ratio: Math.max(0, Math.min(100, Math.round(Number(pasteRatio || 0)))),
        pasted_chars: Math.max(0, Math.round(Number(pastedChars || 0))),
        manual_writing_badge: manualWritingBadge === true || manualWritingBadge === "true",
        used_microphone: usedMicrophone === true || usedMicrophone === "true",
        auto_vote_wave1_status: "pending",
        auto_vote_wave1_at: new Date(Date.now() + (35 + Math.random() * (16 * 60 - 35)) * 60 * 1000).toISOString(),
        auto_vote_wave2_status: "pending",
        auto_vote_wave2_at: new Date(Date.now() + (24 + Math.random() * 24) * 60 * 60 * 1000).toISOString()
      })
      .select("id")
      .single();

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur création argument.");
    }

    invalidateSharedDebateCaches(requestedDebateId);

    const debateRow = sourceDebateRow;

    if (
      debateRow &&
      debateRow.creator_key &&
      debateRow.creator_key !== authorKey
    ) {
      await createNotification({
        user_key: debateRow.creator_key,
        type: "argument_in_my_debate",
        debate_id: sharedDebateId,
        argument_id: data.id,
        message: `Votre débat ${quoteNotificationContent(debateRow.question)} a reçu une nouvelle idée : ${quoteNotificationContent(title)}.`
      });
    }

    res.json({ success: true, id: data.id });

    snapshotAndWatchMajority(sharedDebateId, data.id, normalizedSide, authorKey).catch(console.error);
    _scheduleAnalysisIfNeeded(sharedDebateId).catch(console.error);
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur création argument.");
  }
});

app.post("/api/arguments/:id/vote", rateLimit("votes", 60), async (req, res) => {
  try {
    const id = req.params.id;
    const { voterKey } = req.body || {};
    const numericArgumentId = Number.parseInt(String(id || ""), 10);
    const { data: voteResult, error: voteError } = await supabase.rpc("cast_argument_vote", {
      p_argument_id: numericArgumentId,
      p_voter_key: voterKey
    });

    if (voteError) {
      if (String(voteError.message || "").includes("ARGUMENT_NOT_FOUND")) {
        return res.status(404).json({ error: "Argument introuvable." });
      }

      console.error(voteError);
      return res.status(500).json({ error: "Erreur mise à jour vote." });
    }

    const payload = Array.isArray(voteResult) ? voteResult[0] : voteResult;
    if (!payload) {
      return res.status(500).json({ error: "Erreur mise à jour vote." });
    }

    if (payload.limit_reached) {
      return res.status(400).json({ error: "limit" });
    }

    res.json({
      votes: Number(payload.votes || 0),
      myVotesOnArgument: Number(payload.my_votes_on_argument || 0),
      remainingVotes: Number(payload.remaining_votes || 0),
      lastVotedAt: payload.last_voted_at || null
    });

    const argument = await getArgumentById(id);
    invalidateSharedDebateCaches(argument?.debate_id || null, { clearList: false });

    if (argument.author_key && argument.author_key !== voterKey) {
      createOrMergeVoteNotification({
        user_key: argument.author_key,
        debate_id: argument.debate_id,
        argument_id: id,
        argument_title: argument.title
      }).catch((notificationError) => {
        console.error(notificationError);
      });
    }

    if (argument?.debate_id) {
      checkMajorityFlips(argument.debate_id).catch(console.error);
    }
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture vote.");
  }
});

app.post("/api/arguments/:id/unvote", rateLimit("votes", 60), async (req, res) => {
  try {
    const id = req.params.id;
    const { voterKey } = req.body || {};

    const voteRow = await getVoteRow(id, voterKey);
   
 if (!voteRow) {
  const argument = await getArgumentById(id);

  return res.json({
    votes: Number(argument?.votes || 0),
    myVotesOnArgument: 0,
    remainingVotes: null,
    lastVotedAt: argument?.last_voted_at || null
  });
}

    const argument = await getArgumentById(id);
    if (!argument) {
      return res.status(404).json({ error: "Argument introuvable." });
    }

    if (Number(voteRow.vote_count) > 1) {
      const { error: updateVoteErr } = await supabase
        .from("votes")
        .update({ vote_count: Number(voteRow.vote_count) - 1 })
        .eq("id", voteRow.id);

      if (updateVoteErr) {
        console.error(updateVoteErr);
        return res.status(500).json({ error: "Erreur mise à jour vote." });
      }
    } else {
      const { error: deleteVoteErr } = await supabase
        .from("votes")
        .delete()
        .eq("id", voteRow.id);

      if (deleteVoteErr) {
        console.error(deleteVoteErr);
        return res.status(500).json({ error: "Erreur suppression vote." });
      }
    }

    const newVotes = Math.max(0, Number(argument.votes || 0) - 1);
    const argumentVoteUpdate = {
      votes: newVotes,
      ...(newVotes === 0 ? { last_voted_at: null } : {})
    };
    const { error: updateArgErr } = await supabase
      .from("arguments")
      .update(argumentVoteUpdate)
      .eq("id", id);

    if (updateArgErr) {
      console.error(updateArgErr);
      return res.status(500).json({ error: "Erreur mise à jour argument." });
    }

    const myVotesOnArgument = Math.max(0, Number(voteRow.vote_count || 0) - 1);

    res.json({
      votes: newVotes,
      myVotesOnArgument,
      remainingVotes: null,
      lastVotedAt: argument.last_voted_at || null
    });

    invalidateSharedDebateCaches(argument?.debate_id || null, { clearList: false });

    if (argument?.debate_id) {
      checkMajorityFlips(argument.debate_id).catch(console.error);
    }
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture vote.");
  }
});

app.delete("/api/arguments/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const requesterKey = String(req.query.authorKey || "").trim();
    const adminMode = isAdmin(req);

    const argumentRow = await getArgumentById(id);
    if (!argumentRow) {
      return res.status(404).json({ error: "Idée introuvable." });
    }

    const isOwner =
      requesterKey &&
      argumentRow.author_key &&
      String(argumentRow.author_key) === requesterKey;

    if (!adminMode && !isOwner) {
      return res.status(403).json({ error: "Suppression non autorisée." });
    }

    const { data: commentRows, error: commentsErr } = await supabase
      .from("comments")
      .select("id")
      .eq("argument_id", id);

    if (commentsErr) {
      console.error(commentsErr);
      return res.status(500).json({ error: "Erreur récupération commentaires argument." });
    }

    const commentIds = (commentRows || []).map((row) => row.id);

    await supabase.from("votes").delete().eq("argument_id", id);

    if (commentIds.length) {
      await supabase.from("comment_likes").delete().in("comment_id", commentIds);
      await supabase.from("reports").delete().eq("target_type", "comment").in("target_id", commentIds);
      await supabase.from("notifications").delete().in("comment_id", commentIds);
    }

    await supabase.from("comments").delete().eq("argument_id", id);
    await supabase.from("reports").delete().eq("target_type", "argument").eq("target_id", id);
    await supabase.from("notifications").delete().eq("argument_id", id);

    const { error: deleteErr } = await supabase
      .from("arguments")
      .delete()
      .eq("id", id);

    if (deleteErr) {
      console.error(deleteErr);
      return res.status(500).json({ error: "Erreur suppression argument." });
    }

    invalidateSharedDebateCaches(argumentRow?.debate_id || null);
    clearNotificationsApiResponseCache();
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur suppression argument." });
  }
});

// Attribution automatique de voix par vagues : vague 1 entre +35 min et +16 h
// (0 à 8 voix), vague 2 entre +24 h et +48 h (0 à 5 voix). Un tirage à 0 voix
// marque quand même la vague "done" (sans notification) : c'est voulu, toutes
// les idées ne doivent pas systématiquement gagner des voix.
async function _applyAutoVoteWave(argument, wave) {
  const amount = wave === 1
    ? Math.floor(Math.random() * 9)
    : Math.floor(Math.random() * 6);
  const statusField = wave === 1 ? "auto_vote_wave1_status" : "auto_vote_wave2_status";
  const newVotes = Number(argument.votes || 0) + amount;

  // .eq(statusField, "pending") en plus de .eq("id", ...) (audit egress du 25/08/2026) :
  // garde-fou anti-double-application si un passage venait à recouper un précédent (gros
  // rattrapage après coupure prolongée, redémarrage en cours de traitement) — la mise à jour
  // n'affecte alors aucune ligne (déjà "done") plutôt que de créditer les votes une seconde fois.
  // .select("id") sert uniquement à savoir si la ligne a bien été affectée.
  const { data, error } = await supabase
    .from("arguments")
    .update({ votes: newVotes, [statusField]: "done" })
    .eq("id", argument.id)
    .eq(statusField, "pending")
    .select("id");

  if (error) {
    console.error(`[auto-vote wave${wave}]`, error.message);
    return false;
  }
  if (!data || !data.length) return false; // déjà traitée entre-temps : rien à faire

  if (amount > 0) {
    invalidateSharedDebateCaches(argument.debate_id || null, { clearList: false });

    if (argument.author_key) {
      try {
        await createOrMergeVoteNotification({
          user_key: argument.author_key,
          debate_id: argument.debate_id,
          argument_id: argument.id,
          argument_title: argument.title,
          vote_count_increment: amount,
          push_on_merge: true
        });
      } catch (notificationError) {
        console.error(`[auto-vote wave${wave}] notification`, notificationError.message);
      }
    }
  }
  return true;
}

// Interrupteur d'urgence : identifié comme cause probable de l'épuisement du budget Disk IO
// Supabase du 20/06/2026 (balayage de arguments toutes les 30s / 15 min, 24h/24, indépendamment
// du trafic). Mettre AUTO_VOTE_SCHEDULERS_ENABLED=false dans l'environnement pour couper les
// deux schedulers, remettre à true (ou retirer la variable) une fois la situation stabilisée.
const AUTO_VOTE_SCHEDULERS_ENABLED = process.env.AUTO_VOTE_SCHEDULERS_ENABLED !== "false";

// Fréquences allégées le 25/08/2026 (30s→2h, 15min→6h) : la requête ne cible déjà que les
// idées échues et non traitées (auto_vote_waveN_status='pending' AND auto_vote_waveN_at<=now),
// donc aucune idée éligible n'est jamais perdue en espaçant les passages — seulement rattrapée
// plus tard, au prochain passage (jusqu'à ~2h/~6h de délai supplémentaire par rapport à
// l'échéance elle-même déjà randomisée sur 35min-16h/24h-48h, cf. POST /api/arguments).
const AUTO_VOTE_WAVE1_INTERVAL_MS = 2 * 60 * 60 * 1000;
const AUTO_VOTE_WAVE2_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Lot maximal par passage : borne le coût d'un rattrapage après une coupure prolongée (ex.
// AUTO_VOTE_SCHEDULERS_ENABLED=false pendant plusieurs jours) — les idées non prises dans ce lot
// restent "pending" et sont reprises automatiquement au(x) passage(s) suivant(s), sans perte.
const AUTO_VOTE_BATCH_LIMIT = 100;

async function _runAutoVoteWavePass(wave) {
  const statusField = wave === 1 ? "auto_vote_wave1_status" : "auto_vote_wave2_status";
  const dueField = wave === 1 ? "auto_vote_wave1_at" : "auto_vote_wave2_at";
  try {
    const now = new Date().toISOString();
    const { data: pending, error } = await supabase
      .from("arguments")
      .select("id, votes, debate_id, author_key, title")
      .eq(statusField, "pending")
      .lte(dueField, now)
      .order(dueField, { ascending: true })
      .limit(AUTO_VOTE_BATCH_LIMIT);
    if (error) throw error;

    let processed = 0;
    for (const row of (pending || [])) {
      if (await _applyAutoVoteWave(row, wave)) processed++;
    }
    console.log(`[auto-vote wave${wave}] ${processed} arguments processed`);
  } catch (err) {
    console.error(`[auto-vote wave${wave} scheduler]`, err.message);
  }
}

if (AUTO_VOTE_SCHEDULERS_ENABLED) {
  // Un passage immédiat au démarrage (en plus du rythme normal ci-dessous) rattrape tout
  // backlog accumulé pendant un redéploiement/une coupure sans attendre jusqu'à 2h/6h — sûr ici
  // car la requête est déjà filtrée (statut + échéance) et bornée (limit ci-dessus).
  _runAutoVoteWavePass(1);
  _runAutoVoteWavePass(2);
  setInterval(() => _runAutoVoteWavePass(1), AUTO_VOTE_WAVE1_INTERVAL_MS).unref();
  setInterval(() => _runAutoVoteWavePass(2), AUTO_VOTE_WAVE2_INTERVAL_MS).unref();
} else {
  console.log("[auto-vote schedulers] désactivés via AUTO_VOTE_SCHEDULERS_ENABLED=false");
}

/* =========================
   PURGE DE RÉTENTION (page_visits / notification_events)
========================= */
// Config + logique extraites dans lib/data-retention.js (testable avec un
// client Supabase injecté, cf. test/data-retention.test.js pour la
// régression du bug F1 : purge des repasses "cgreview-*").
const { runDataRetentionCleanup } = require("./lib/data-retention");

runDataRetentionCleanup(supabase).catch((err) => console.error("[retention] purge initiale :", err.message));
setInterval(() => {
  runDataRetentionCleanup(supabase).catch((err) => console.error("[retention] purge planifiée :", err.message));
}, 24 * 60 * 60 * 1000).unref();

/* =========================
   COMMENTS
========================= */

app.post("/api/comments", rateLimit("comments", 20), async (req, res) => {
  try {
    const {
      argument_id,
      content,
      authorKey,
      stance,
      reply_to_comment_id,
      improvement_title,
      improvement_body
    } = req.body || {};

    const safeStance = ["favorable", "defavorable", "amelioration"].includes(stance) ? stance : null;
    const safeImprovementTitle = safeStance === "amelioration" ? limitText(improvement_title, 180) : "";
    const safeImprovementBody = safeStance === "amelioration" ? limitText(improvement_body, 2500) : "";

    if (safeStance === "amelioration") {
      if (!safeImprovementTitle) {
        return res.status(400).json({ error: "Titre d'amélioration requis." });
      }

      if (!safeImprovementBody) {
        return res.status(400).json({ error: "Texte d'amélioration requis." });
      }
    }

    const { data: inserted, error } = await supabase
      .from("comments")
      .insert({
        argument_id,
        content: limitText(content, 2500),
        stance: safeStance,
        author_key: authorKey || null,
        reply_to_comment_id: reply_to_comment_id || null,
        improvement_title: safeImprovementTitle,
        improvement_body: safeImprovementBody,
        created_at: nowIso()
      })
      .select("*")
      .single();

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Erreur ajout commentaire." });
    }

    const newCommentId = inserted.id;
    const row = {
      ...inserted,
      likes: 0
    };

    const argumentRow = await getArgumentById(argument_id);
    const preview = String(content || "").trim();
    const shortPreview = preview.length > 120 ? preview.slice(0, 120) + "…" : preview;

    if (
      argumentRow &&
      argumentRow.author_key &&
      argumentRow.author_key !== (authorKey || null)
    ) {
      await createNotification({
        user_key: argumentRow.author_key,
        type: "comment_on_argument",
        debate_id: argumentRow.debate_id || null,
        argument_id,
        comment_id: newCommentId,
        message: argumentRow?.title
          ? `Votre idée ${quoteNotificationContent(argumentRow.title)} a reçu un commentaire : ${quoteNotificationContent(shortPreview, 110)}`
          : shortPreview
            ? `Nouveau commentaire : ${shortPreview}`
            : "Nouveau commentaire sur votre argument"
      });
    }

    let parentCommentRow = null;
    if (reply_to_comment_id) {
      parentCommentRow = await getCommentById(reply_to_comment_id);

      if (
        parentCommentRow &&
        parentCommentRow.author_key &&
        parentCommentRow.author_key !== (authorKey || null)
      ) {
        await createNotification({
          user_key: parentCommentRow.author_key,
          type: "reply_to_comment",
          debate_id: argumentRow?.debate_id || null,
          argument_id,
          comment_id: newCommentId,
          message: parentCommentRow?.content
            ? `Votre commentaire ${quoteNotificationContent(parentCommentRow.content, 110)} a reçu une réponse : ${quoteNotificationContent(shortPreview, 110)}`
            : shortPreview
              ? `Réponse à votre commentaire : ${shortPreview}`
              : "Quelqu’un a répondu à votre commentaire"
        });
      }
    }

    invalidateSharedDebateCaches(argumentRow?.debate_id || null, { clearList: false });
    res.json(row);
    if (argumentRow?.debate_id) _scheduleAnalysisIfNeeded(argumentRow.debate_id).catch(console.error);
    return;
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur ajout commentaire." });
  }
});

app.post("/api/comments/:id/vote", rateLimit("votes", 60), async (req, res) => {
  try {
    const id = req.params.id;
    const { voterKey, value } = req.body || {};

    if (!voterKey) {
      return res.status(400).json({ error: "Clé utilisateur manquante." });
    }

    if (![1, 0, -1].includes(Number(value))) {
      return res.status(400).json({ error: "Vote invalide." });
    }

    const voteValue = Number(value);

    const existingCommentVoteRes = await supabase
      .from("comment_likes")
      .select("*")
      .eq("comment_id", id)
      .eq("voter_key", voterKey)
      .maybeSingle();

    if (existingCommentVoteRes.error) {
      console.error(existingCommentVoteRes.error);
      return sendServerError(res, "Erreur lecture vote commentaire.");
    }

    const existingVote = existingCommentVoteRes.data;

    if (!existingVote) {
      if (voteValue !== 0) {
        const { error: insertErr } = await supabase
          .from("comment_likes")
          .insert({
            comment_id: id,
            voter_key: voterKey,
            value: voteValue
          });

        if (insertErr) {
          console.error(insertErr);
          return res.status(500).json({ error: "Erreur enregistrement vote commentaire." });
        }
      }
    } else if (voteValue === 0) {
      const { error: deleteErr } = await supabase
        .from("comment_likes")
        .delete()
        .eq("comment_id", id)
        .eq("voter_key", voterKey);

      if (deleteErr) {
        console.error(deleteErr);
        return res.status(500).json({ error: "Erreur suppression vote commentaire." });
      }
    } else {
      const { error: updateErr } = await supabase
        .from("comment_likes")
        .update({ value: voteValue })
        .eq("comment_id", id)
        .eq("voter_key", voterKey);

      if (updateErr) {
        console.error(updateErr);
        return res.status(500).json({ error: "Erreur mise à jour vote commentaire." });
      }
    }

    const commentRow = await getCommentById(id);
    if (!commentRow) {
      return res.status(500).json({ error: "Erreur lecture score commentaire." });
    }

    const argumentRow = await getArgumentById(commentRow.argument_id);
    const likes = await getCommentLikesTotal(id);
    const argumentVotes = Number(argumentRow?.votes || 0);

    if (commentRow.author_key && commentRow.author_key !== voterKey) {
      if (voteValue === 1) {
        await createNotification({
          user_key: commentRow.author_key,
          type: "like_on_comment",
          debate_id: argumentRow?.debate_id,
          argument_id: commentRow.argument_id,
          comment_id: id,
          message: `Votre commentaire ${quoteNotificationContent(commentRow.content, 110)} a reçu un pouce vers le haut.`
        });
      }

      if (voteValue === -1) {
        await createNotification({
          user_key: commentRow.author_key,
          type: "dislike_on_comment",
          debate_id: argumentRow?.debate_id,
          argument_id: commentRow.argument_id,
          comment_id: id,
          message: `Votre commentaire ${quoteNotificationContent(commentRow.content, 110)} a reçu un pouce vers le bas.`
        });
      }
    }

    const isImprovement = commentRow.stance === "amelioration";
    const improvementTitle = String(commentRow.improvement_title || "").trim();
    const improvementBody = String(commentRow.improvement_body || "").trim();

    if (isImprovement && improvementTitle && improvementBody && likes > argumentVotes) {
      const { error: replaceErr } = await supabase
        .from("arguments")
        .update({
          title: improvementTitle,
          body: improvementBody
        })
        .eq("id", commentRow.argument_id);

      if (replaceErr) {
        console.error(replaceErr);
        return res.status(500).json({ error: "Erreur remplacement idée." });
      }

      if (commentRow.author_key) {
        await createNotification({
          user_key: commentRow.author_key,
          type: "replacement_accepted",
          debate_id: argumentRow?.debate_id,
          argument_id: commentRow.argument_id,
          comment_id: id,
          message: `Bravo, ta proposition sur ${quoteNotificationContent(argumentRow?.title)} a convaincu et remplace désormais l’idée initiale !`
        });
      }

      await supabase.from("comment_likes").delete().eq("comment_id", id);
      await supabase.from("reports").delete().eq("target_type", "comment").eq("target_id", id);
      await supabase.from("notifications").delete().eq("comment_id", id).neq("type", "replacement_accepted");
      await supabase.from("comments").delete().eq("id", id);
      invalidateSharedDebateCaches(argumentRow?.debate_id || null);
      clearNotificationsApiResponseCache();

      return res.json({
        likes,
        replaced: true,
        argumentId: commentRow.argument_id
      });
    }

    invalidateSharedDebateCaches(argumentRow?.debate_id || null, { clearList: false });
    res.json({ likes, replaced: false });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture vote commentaire.");
  }
});

app.delete("/api/comments/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const requesterKey = String(req.query.authorKey || "").trim();
    const adminMode = isAdmin(req);

    const commentRow = await getCommentById(id);
    if (!commentRow) {
      return res.status(404).json({ error: "Commentaire introuvable." });
    }

    const isOwner =
      requesterKey &&
      commentRow.author_key &&
      String(commentRow.author_key) === requesterKey;

    if (!adminMode && !isOwner) {
      return res.status(403).json({ error: "Suppression non autorisée." });
    }

    await supabase.from("comment_likes").delete().eq("comment_id", id);
    await supabase.from("reports").delete().eq("target_type", "comment").eq("target_id", id);
    await supabase.from("notifications").delete().eq("comment_id", id);

    const { error: deleteErr } = await supabase
      .from("comments")
      .delete()
      .eq("id", id);

    if (deleteErr) {
      console.error(deleteErr);
      return res.status(500).json({ error: "Erreur suppression commentaire." });
    }

    // Invalidation ciblée sur le seul débat concerné, même principe que POST /api/comments
    // ci-dessus (clearList:false) plutôt que de vider tout le cache /api/debates pour toutes
    // les catégories/tris/offsets à chaque suppression — le nombre de commentaires affiché
    // dans la liste tolère déjà ce même délai de rafraîchissement à la création d'un
    // commentaire (audit egress du 25/08/2026).
    const argumentRow = await getArgumentById(commentRow.argument_id);
    invalidateSharedDebateCaches(argumentRow?.debate_id || null, { clearList: false });
    clearNotificationsApiResponseCache();
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur suppression commentaire." });
  }
});

/* ========================= VEILLE PENDING ========================= */

async function loadVeillePending() {
  // Colonnes explicites (audit egress PostgREST du 25/08/2026) : la seule consommatrice
  // du résultat est le .map() juste en dessous, qui ne lit que ces champs.
  const { data, error } = await supabase
    .from("veille_pending")
    .select("id, question, position_a, position_b, theme, resume, sources, links, pending_keywords, added_at, pending_linked_debate_id, pending_story_selection, political_group")
    .order("added_at", { ascending: false });
  if (error) { console.error("loadVeillePending:", error.message); return []; }
  return (data || []).map(r => ({
    id: r.id,
    question: r.question,
    positionA: r.position_a,
    positionB: r.position_b,
    theme: r.theme,
    resume: r.resume,
    sources: r.sources,
    links: r.links || [],
    keywords: normalizeKeywordList(r.pending_keywords || [], 10, 60),
    addedAt: r.added_at,
    linkedDebateId: String(r.pending_linked_debate_id || "").trim(),
    storySelection: r.pending_story_selection || null,
    politicalGroup: (r.political_group === "left" || r.political_group === "right") ? r.political_group : "mixed"
  }));
}

async function deleteVeillePending(id) {
  const { error } = await supabase.from("veille_pending").delete().eq("id", id);
  if (error) throw new Error(error.message);
  clearVeillePendingLinkedDebate(id);
  clearVeillePendingStorySelection(id);
  clearVeillePendingKeywords(id);
}

app.post("/api/veille/receive", rateLimit("veille-receive", 20), async (req, res) => {
  const { question, positionA, positionB, theme, resume, sources, links, storySelection, keywords, politicalOrientation, politicalGroup } = req.body || {};
  const resolvedPoliticalGroup = (politicalGroup === "left" || politicalGroup === "right") ? politicalGroup : "mixed";
  console.log("[veille/receive] payload:", {
    hasQuestion: !!question,
    questionLen: String(question || "").length,
    hasPositionA: !!positionA,
    hasPositionB: !!positionB,
    hasTheme: !!theme,
    hasResume: !!resume,
    resumeLen: String(resume || "").length,
    sourcesCount: Array.isArray(sources) ? sources.length : (sources ? 1 : 0),
    linksCount: Array.isArray(links) ? links.length : 0,
    hasStorySelection: !!storySelection,
    keywordsCount: Array.isArray(keywords) ? keywords.length : (keywords ? 1 : 0),
    hasPoliticalOrientation: !!politicalOrientation
  });
  if (!question) return res.status(400).json({ ok: false, error: "question manquante" });
  const safeQuestion = String(question || "").trim().slice(0, 110);
  const pendingId = Date.now();
  const { error } = await supabase.from("veille_pending").insert({
    id: pendingId,
    question: safeQuestion,
    position_a: positionA || null,
    position_b: positionB || null,
    theme: theme || null,
    resume: resume || null,
    sources: sources || null,
    links: links || [],
    political_orientation: politicalOrientation || null,
    political_group: resolvedPoliticalGroup
  });
  if (error) { console.error("veille receive:", error.message); return res.status(500).json({ ok: false, error: error.message }); }
  const normalizedStorySelection = normalizeStorySelection(storySelection);
  if (normalizedStorySelection) {
    setVeillePendingStorySelection(pendingId, normalizedStorySelection);
  }
  setVeillePendingKeywords(pendingId, keywords);
  res.json({ ok: true });
});

// Articles de presse d'opinion à source unique (cf. extractOpinionItems côté bot veille) :
// pas de fiche débat (pas de camp adverse), juste un lien vers l'article d'origine.
// Même modèle que /api/veille/receive ci-dessus : pas d'auth admin, juste rate-limité,
// puisque c'est le bot veille (pas un utilisateur) qui appelle cette route.
app.post("/api/veille/opinion-articles", rateLimit("veille-opinion-articles", 20), async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  console.log(`[veille/opinion-articles] payload: ${items.length} article(s)`);
  if (!items.length) return res.json({ ok: true, inserted: 0 });

  const validItems = items.filter(item => item && item.title && item.link);
  const aiCategories = await classifyOpinionArticlesWithAI(validItems);

  const rows = validItems
    .map(item => {
      const aiResult = aiCategories.get(String(item.link || ""));
      const category = normalizeOpinionArticleCategory(item.category) ||
        aiResult?.category ||
        getOpinionArticleFallbackCategory(item);
      // precision de l'IA n'a de sens que si `category` est bien celle qu'elle a évaluée.
      const aiResultMatchesCategory = aiResult?.category === category;
      const category_precision = normalizeOpinionArticleCategoryPrecision(
        category,
        item.category_precision ?? (aiResultMatchesCategory ? aiResult.precision : null)
      );
      return {
        source: String(item.source || "").slice(0, 200),
        orientation: normalizeOpinionArticleOrientationForSource(item).slice(0, 200) || null,
        title: String(item.title).slice(0, 500),
        link: String(item.link).slice(0, 1000),
        summary: item.summary ? String(item.summary).slice(0, 2000) : null,
        type: item.type === "youtube" ? "youtube" : "article",
        category,
        category_precision,
        solar_system_id: null,
        published_at: item.date ? new Date(item.date).toISOString() : new Date().toISOString()
      };
    });

  if (!rows.length) return res.json({ ok: true, inserted: 0 });

  const error = await upsertOpinionArticleRows(rows);

  if (error) { console.error("veille/opinion-articles:", error.message); return res.status(500).json({ ok: false, error: error.message }); }
  // Le prochain GET /api/opinion-articles reconstruit avec ces nouveaux articles.
  if (rows.length > 0) _opinionArticlesCache = null;
  res.json({ ok: true, inserted: rows.length });
});

// Retrait à la source : appelé par le bot quand un sujet devient une arène —
// les articles de ce sujet (liens du groupe) quittent Autres actus, y compris
// ceux envoyés lors de runs précédents, avant la publication du sujet.
app.post("/api/veille/opinion-articles/remove", rateLimit("veille-opinion-articles-remove", 30), async (req, res) => {
  const links = [...new Set(
    (Array.isArray(req.body?.links) ? req.body.links : [])
      .map((link) => String(link || "").trim())
      .filter(Boolean)
  )].slice(0, 400);
  if (!links.length) return res.json({ ok: true, removed: 0 });

  let removed = 0;
  for (let i = 0; i < links.length; i += 100) {
    const chunk = links.slice(i, i + 100);
    const { error, count } = await supabase
      .from("opinion_articles")
      .delete({ count: "exact" })
      .in("link", chunk);
    if (error) { console.error("veille/opinion-articles/remove:", error.message); return res.status(500).json({ ok: false, error: error.message }); }
    removed += count || 0;
  }

  // Le prochain GET /api/opinion-articles reconstruit sans ces articles.
  if (removed > 0) _opinionArticlesCache = null;
  res.json({ ok: true, removed });
});

// Un simple ORDER BY published_at + LIMIT 200 laisse l'onglet Droite du front
// (cf. orientationClass dans autres-sources.html) vide dès que les sources généralistes
// à fort débit (Le Parisien, BFMTV, La Dépêche...) dominent la fenêtre récente : elles
// représentent la majorité du volume collecté, donc la totalité des 200 lignes les plus
// récentes peut être généraliste. Classement gauche/droite à parts égales, généraliste
// écarté (cf. OPINION_ARTICLES_RETENTION_DAYS et l'incident de quota Supabase du 20/06/2026).
// Bucket par bord ET par type (articles vs vidéos YouTube) : sans ça, les vidéos (moins
// nombreuses) se font noyer par les articles dans la limite globale.
// Relevé 100→250 et 2000→4000 le 16/07/2026 (demande explicite : plus de liens visibles
// sur Autres actus) : ça n'augmente pas le volume écrit en base par le bot veille (déjà
// illimité côté écriture), juste la requête de lecture (cache 5 min, cf.
// OPINION_ARTICLES_CACHE_TTL_MS) et la taille de la réponse — pas de risque identifié
// sur le quota Supabase/Render à ce niveau, contrairement à l'incident du 20/06/2026 qui
// venait de tables sans purge (page_visits/notification_events), pas de ce plafond. Relevé
// 250→400 et 4000→6000 le 20/07/2026 (même demande) : egress mesuré ~300 Mo/jour tout
// confondu (storage média inclus), la part de cette API (JSON texte, cache 5 min) y reste
// marginale même au plafond relevé — cf. aussi le cap interne de fetchOpinionArticleSelectionRows.
// Relevé 400→800 et 6000→10000 le 26/07/2026 (même demande, ~2400 articles bruts/jour
// ingérés côté bot veille contre ~2900 cartes visibles au plafond précédent) : audit du
// storage média (2 vidéos, 1 image sur 1982 débats) et du cache /api/debates (cache-buster
// `_` déjà ignoré côté clé de cache, cf. getDebatesApiCacheKey) ne montre aucun poste
// d'egress DB/storage significatif à ce jour — le plafond précédent n'était donc pas motivé
// par un risque de coût réel mais par prudence. OPINION_ARTICLES_SOURCE_SOFT_LIMIT inchangé
// (préserve la diversité de la première passe round-robin) : la hausse profite surtout à la
// passe fallback (source non plafonnée) qui remplit le nouveau volume disponible.
const OPINION_ARTICLES_TYPE_BUCKET_LIMIT = 800;
const OPINION_ARTICLES_SELECTION_SCAN_LIMIT = 10000;
const OPINION_ARTICLES_SOURCE_SOFT_LIMIT = 10;
// Même classification que getMediaOrientationGroup côté bot veille (veille-mixte.js,
// server.js) : "gauche"/"droite" couvrent aussi les familles proches (écolo, souverainiste,
// libéral...), pas seulement les libellés exacts "gauche"/"droite".
function getOpinionOrientationGroup(orientation) {
  const o = String(orientation || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (o.includes("nouvelles positives")) return "positive";
  // Les sources régionales sont taguées "régional" seul, "généraliste /
  // régional", "régional / généraliste" (cf. audit du 16/07/2026, qui
  // expliquait un filtre "Actualités régionales" resté vide), ou au pluriel
  // "actualités régionales" (ex. les 14 entrées France 3 Régions, ajoutées
  // après cet audit — \bregional\b seul ne matchait pas "régionales" au
  // pluriel, ce qui les faisait retomber dans "généraliste" ; corrigé le
  // 20/07/2026). e?s? optionnel couvre régional/régionale/régionales sans
  // capturer "régionaliste" (orientation politique identitaire, pas une
  // simple source locale) : le \b après le "s?" ne matche jamais à
  // l'intérieur de "régionaliste".
  if (/\bregionale?s?\b/.test(o)) return "regional";
  if (
    o.includes("gauche") || o.includes("ecolog") || o.includes("ecolo") || o.includes("libertaire") ||
    o.includes("altermondialiste") || o.includes("alter-mondialiste") || o.includes("anticapitaliste") ||
    o.includes("anti-capitaliste") || o.includes("socialiste") || o.includes("social-democrate") ||
    o.includes("social democrate") || o.includes("progressiste") || o.includes("insoumis") ||
    o.includes("insoumission") || o.includes("communiste") || o.includes("marxiste") ||
    o.includes("feministe") || o.includes("syndical") || o.includes("alternatif") || o.includes("alternative")
  ) return "left";
  if (
    o.includes("droite") || o.includes("centre-droit") || o.includes("centre droit") ||
    o.includes("droite-centre") || o.includes("droite centre") || o.includes("conservateur") ||
    o.includes("souverainiste") || o.includes("liberal") || o.includes("republicain") || o.includes("identitaire")
  ) return "right";
  return "center";
}

function normalizeOpinionArticleOrientationForSource(article) {
  let domain = "";
  try { domain = new URL(String(article?.link || "")).hostname.replace(/^www\./, "").toLowerCase(); } catch (_) {}
  return normalizeVeilleMediaOrientation(article?.source, domain, article?.orientation);
}

async function fetchOpinionArticleSelectionRows(limit = OPINION_ARTICLES_SELECTION_SCAN_LIMIT) {
  const safeLimit = Math.max(1, Math.min(OPINION_ARTICLES_SELECTION_SCAN_LIMIT, Number(limit || OPINION_ARTICLES_SELECTION_SCAN_LIMIT)));
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; from < safeLimit; from += pageSize) {
    const to = Math.min(safeLimit - 1, from + pageSize - 1);
    const { data, error } = await supabase
      .from("opinion_articles")
      .select("id, source, link, orientation, type, published_at")
      .order("published_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < to - from + 1) break;
  }
  return rows;
}

function getOpinionArticleSourceKey(row) {
  const sourceKey = normalizeCloudSourceName(row?.source).replace(/\s*:?\s*youtube$/, "").trim();
  if (sourceKey) return sourceKey;
  const domainKey = normalizeCloudSourceUrl(row?.link);
  return domainKey || "source-inconnue";
}

function selectDiverseOpinionArticleIds(rows, limit = OPINION_ARTICLES_TYPE_BUCKET_LIMIT, sourceSoftLimit = OPINION_ARTICLES_SOURCE_SOFT_LIMIT) {
  const safeLimit = Math.max(0, Number(limit || 0));
  if (!safeLimit || !Array.isArray(rows) || !rows.length) return [];

  const bySource = new Map();
  for (const row of rows) {
    const sourceKey = getOpinionArticleSourceKey(row);
    if (!bySource.has(sourceKey)) bySource.set(sourceKey, []);
    bySource.get(sourceKey).push(row.id);
  }

  const selected = [];
  const selectedSet = new Set();
  const takeRoundRobin = (queues, maxPerSource) => {
    const sourceCounts = new Map();
    while (selected.length < safeLimit && queues.length) {
      let progressed = false;
      for (let index = 0; index < queues.length && selected.length < safeLimit;) {
        const queue = queues[index];
        const sourceKey = queue.sourceKey;
        const currentCount = sourceCounts.get(sourceKey) || 0;
        if (Number.isFinite(maxPerSource) && currentCount >= maxPerSource) {
          queues.splice(index, 1);
          continue;
        }
        const id = queue.ids.shift();
        if (id != null && !selectedSet.has(id)) {
          selected.push(id);
          selectedSet.add(id);
          sourceCounts.set(sourceKey, currentCount + 1);
          progressed = true;
        }
        if (!queue.ids.length) queues.splice(index, 1);
        else index += 1;
      }
      if (!progressed) break;
    }
  };

  const cappedQueues = Array.from(bySource.entries())
    .map(([sourceKey, ids]) => ({ sourceKey, ids: ids.slice() }))
    .filter((queue) => queue.ids.length);
  takeRoundRobin(cappedQueues, Math.max(1, Number(sourceSoftLimit || OPINION_ARTICLES_SOURCE_SOFT_LIMIT)));

  const fallbackQueues = Array.from(bySource.entries())
    .map(([sourceKey, ids]) => ({ sourceKey, ids: ids.filter((id) => !selectedSet.has(id)) }))
    .filter((queue) => queue.ids.length);
  takeRoundRobin(fallbackQueues, Infinity);
  return selected;
}

// Groupes thématiques (par opposition à gauche/droite) : jamais soumis au
// plafond par bucket ni au round-robin de diversité par source — tout passe
// toujours, cf. demande du 16/07/2026 pour "positive", volume naturellement
// faible dans les deux cas (peu de sources, rétention 2 jours cf.
// OPINION_ARTICLES_RETENTION_DAYS).
const OPINION_UNCAPPED_GROUPS = ["positive", "regional"];

function buildVisibleOpinionArticleSelection(lightRows, perTypeLimit = OPINION_ARTICLES_TYPE_BUCKET_LIMIT) {
  const candidates = {
    left: { article: [], youtube: [] },
    right: { article: [], youtube: [] },
    positive: { article: [], youtube: [] },
    regional: { article: [], youtube: [] },
    // Médias généralistes ("center", ex. Le Parisien) : jamais montrés dans
    // Gauche/Tout/Droite/Nouvelles positives/Actualités régionales (demande du
    // 19-20/07/2026 : pas de noyer le flux d'opinion avec du tout-venant), mais
    // sélectionnables un par un dans l'onglet "Personnalisé" (cf.
    // /api/opinion-articles/custom-media-options et currentFilter === 'custom'
    // côté client, autres-sources.html). Round-robin diversité comme
    // gauche/droite (pas uncapped) : le volume "center" est nettement plus
    // gros, un plafond garde le scan/egress sous contrôle.
    center: { article: [], youtube: [] }
  };
  const knownGroups = Object.keys(candidates);

  for (const row of lightRows || []) {
    const group = getOpinionOrientationGroup(normalizeOpinionArticleOrientationForSource(row) || row.orientation);
    if (!knownGroups.includes(group)) continue;
    const type = row.type === "youtube" ? "youtube" : "article";
    candidates[group][type].push(row);
  }

  const result = {};
  for (const group of knownGroups) {
    if (OPINION_UNCAPPED_GROUPS.includes(group)) {
      result[group] = {
        article: candidates[group].article.map((row) => row.id),
        youtube: candidates[group].youtube.map((row) => row.id)
      };
    } else {
      result[group] = {
        article: selectDiverseOpinionArticleIds(candidates[group].article, perTypeLimit),
        youtube: selectDiverseOpinionArticleIds(candidates[group].youtube, perTypeLimit)
      };
    }
  }
  return result;
}

const OPINION_ARTICLE_CATEGORY_OPTIONS = [
  "Politique",
  "International",
  "Économie - emploi",
  "Société - éducation",
  "Sciences - technologie",
  "Climat - environnement",
  "Justice - faits divers",
  "Culture - arts",
  "Histoire",
  "Philosophie - sciences sociales",
  "Langues et Lettres",
  "Médias - divertissements",
  "Sports - loisirs",
  "Santé - bien-être",
  "Vie personnelle - modes de vie",
  "Espace jeunes"
];
const OPINION_ARTICLE_CATEGORY_MODEL = process.env.OPENAI_OPINION_CATEGORY_MODEL || "gpt-5-nano";
const OPINION_ARTICLE_CATEGORY_BATCH_SIZE = Math.max(1, Math.min(60, Number(process.env.OPENAI_OPINION_CATEGORY_BATCH_SIZE || 40)));

// Rubriques volontairement hybrides : `category` reste la valeur officielle,
// `category_precision` n'indique que la branche dominante parmi ces deux-là.
const OPINION_ARTICLE_CATEGORY_PRECISIONS = {
  "Sports - loisirs": ["Sports", "Loisirs"],
  "Culture - arts": ["Culture", "Arts"],
  "Philosophie - sciences sociales": ["Philosophie", "Sciences sociales"],
  "Langues et Lettres": ["Langues", "Lettres"]
};

// Galaxie = niveau juste en dessous de category/category_precision, jamais stocké
// (toujours déduit) : pour les 4 rubriques hybrides la galaxie dépend de la
// précision retenue (ex. "Sports" → "Sport", au singulier par choix éditorial) ;
// pour toutes les autres rubriques, la galaxie est le libellé de la rubrique lui-même.
// Réutilisée par la classification culture générale (cf. classifyCultureGeneraleCategoryWithAI) :
// mêmes 16 rubriques, mêmes galaxies dérivées, pour une seule taxonomie sur tout le site.
const OPINION_ARTICLE_GALAXY_BY_PRECISION = {
  "Sports - loisirs": { "Sports": "Sport", "Loisirs": "Loisirs" },
  "Culture - arts": { "Culture": "Culture", "Arts": "Arts" },
  "Philosophie - sciences sociales": { "Philosophie": "Philosophie", "Sciences sociales": "Sciences sociales" },
  "Langues et Lettres": { "Langues": "Langues", "Lettres": "Lettres" }
};

// Pure, jamais stockée : catégorie invalide, ou hybride sans précision valide → null ;
// hybride + précision valide → branche correspondante ; catégorie simple → elle-même.
function getOpinionArticleGalaxy(category, categoryPrecision) {
  if (!OPINION_ARTICLE_CATEGORY_OPTIONS.includes(category)) return null;
  const byPrecision = OPINION_ARTICLE_GALAXY_BY_PRECISION[category];
  if (byPrecision) return byPrecision[categoryPrecision] || null;
  return category;
}

function normalizeOpinionArticleCategory(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const key = raw
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " et ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const canonical = OPINION_ARTICLE_CATEGORY_OPTIONS.find((category) => {
    return category
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " et ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") === key;
  });
  if (canonical) return canonical;
  const aliases = new Map([
    ["economie", "Économie - emploi"],
    ["emploi", "Économie - emploi"],
    ["economie-et-emploi", "Économie - emploi"],
    ["societe", "Société - éducation"],
    ["education", "Société - éducation"],
    ["societe-et-education", "Société - éducation"],
    ["sciences", "Sciences - technologie"],
    ["technologie", "Sciences - technologie"],
    ["science-technologie", "Sciences - technologie"],
    ["science-et-technologie", "Sciences - technologie"],
    ["sciences-et-technologie", "Sciences - technologie"],
    ["sciences-et-technologies", "Sciences - technologie"],
    ["climat", "Climat - environnement"],
    ["environnement", "Climat - environnement"],
    ["climat-et-environnement", "Climat - environnement"],
    ["justice", "Justice - faits divers"],
    ["faits-divers", "Justice - faits divers"],
    ["justice-et-faits-divers", "Justice - faits divers"],
    ["culture", "Culture - arts"],
    ["modes", "Culture - arts"],
    ["arts", "Culture - arts"],
    ["culture-et-modes", "Culture - arts"],
    ["culture-et-arts", "Culture - arts"],
    ["culture-modes", "Culture - arts"],
    ["histoire", "Histoire"],
    ["philosophie", "Philosophie - sciences sociales"],
    ["sciences-sociales", "Philosophie - sciences sociales"],
    ["philosophie-et-sciences-sociales", "Philosophie - sciences sociales"],
    ["langues", "Langues et Lettres"],
    ["lettres", "Langues et Lettres"],
    ["langues-et-lettres", "Langues et Lettres"],
    ["medias", "Médias - divertissements"],
    ["divertissements", "Médias - divertissements"],
    ["media-divertissement", "Médias - divertissements"],
    ["medias-et-divertissements", "Médias - divertissements"],
    ["sports", "Sports - loisirs"],
    ["loisirs", "Sports - loisirs"],
    ["sports-et-loisirs", "Sports - loisirs"],
    ["medecine", "Santé - bien-être"],
    ["medecine-sante", "Santé - bien-être"],
    ["sante-medecine", "Santé - bien-être"],
    ["sante", "Santé - bien-être"],
    ["bien-etre", "Santé - bien-être"],
    ["sante-et-bien-etre", "Santé - bien-être"],
    ["vie-personnelle", "Vie personnelle - modes de vie"],
    ["modes-de-vie", "Vie personnelle - modes de vie"],
    ["vie-personnelle-et-modes-de-vie", "Vie personnelle - modes de vie"],
    ["jeunes", "Espace jeunes"],
    ["espace-jeune", "Espace jeunes"]
  ]);
  return aliases.get(key) || "";
}

// Ne renvoie jamais une précision inventée : si `category` n'est pas hybride, ou si
// `value` ne correspond à aucune des branches autorisées pour cette catégorie, null.
function normalizeOpinionArticleCategoryPrecision(category, value) {
  const options = OPINION_ARTICLE_CATEGORY_PRECISIONS[category];
  if (!options) return null;
  const raw = String(value || "").trim();
  if (!raw) return null;
  const key = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const match = options.find((option) => option.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase() === key);
  return match || null;
}

// Même style que normalizeCloudLabel (server.js ~1156) : apostrophes/tirets traités
// comme des séparateurs, pas de gestion singulier/pluriel ni de résolution sémantique.
function normalizeSolarSystemName(value) {
  return String(value || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Nettoyage non destructif des noms de la hiérarchie de la mémoire. Le moteur des bulles
// adapte déjà la taille du texte au contenu : on conserve donc toujours un intitulé complet
// plutôt que de fabriquer un fragment grammatical en le coupant à 35 caractères.
function cleanUniverseNodeName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const UNIVERSE_LABEL_DANGLING_ENDINGS = new Set([
  "a", "à", "au", "aux", "avec", "de", "des", "du", "en", "et", "la", "le", "les",
  "ou", "par", "pour", "sans", "sur", "un", "une"
]);

function isStandaloneUniverseNodeName(value) {
  const label = cleanUniverseNodeName(value);
  if (!label) return false;
  const words = label.split(/\s+/);
  const lastWord = words[words.length - 1]
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9-]/g, "");
  return !!lastWord && !UNIVERSE_LABEL_DANGLING_ENDINGS.has(lastWord);
}

// Répare à l'affichage les lignes créées avant la suppression de la limite. La restauration
// n'a lieu que si l'ancien nom correspond exactement au résultat de l'ancienne fonction de
// troncature appliquée au nom complet : un vrai libellé court choisi par l'IA n'est donc jamais
// remplacé par erreur.
function restoreMechanicallyTruncatedUniverseName(storedName, completeName) {
  const stored = cleanUniverseNodeName(storedName);
  const complete = cleanUniverseNodeName(completeName);
  if (!stored || !complete || complete === stored) return stored || complete;
  return truncateToBubbleLabel(complete) === stored ? complete : stored;
}

// Retrouve un système solaire existant (galaxy, normalized_name) ou le crée. La
// contrainte UNIQUE (galaxy, normalized_name) protège contre une course entre deux
// créations simultanées : en cas d'échec d'insertion, on relit la ligne avant
// d'abandonner, pour ne jamais dupliquer un système déjà créé entre-temps.
// Le nom est conservé en entier. La consigne IA produit normalement un libellé court, mais
// en cas de repli sur sourceName il vaut mieux afficher une phrase complète (dont la taille
// sera adaptée dans la bulle) qu'un fragment grammatical incompréhensible.
async function resolveOrCreateSolarSystem(galaxy, name, normalizedName, extra) {
  const { data: existing, error: selectError } = await supabase
    .from("solar_systems")
    .select("id")
    .eq("galaxy", galaxy)
    .eq("normalized_name", normalizedName)
    .maybeSingle();
  if (selectError) { console.warn("[solar-systems] lecture échouée :", selectError.message); return null; }
  if (existing) return existing.id;
  // `extra` (description/taxonomy_scope) : uniquement fourni par le moteur de
  // classification connaissances (cf. resolveCultureGeneraleSolarSystemWithAI) —
  // les appelants "actu" existants passent 3 arguments comme avant, `extra`
  // vaut alors undefined et la ligne garde le défaut DB taxonomy_scope='unknown',
  // comportement inchangé pour ce pipeline.
  const { data: inserted, error: insertError } = await supabase
    .from("solar_systems")
    .insert({
      galaxy,
      name: cleanUniverseNodeName(name),
      normalized_name: normalizedName,
      ...(extra?.description ? { description: extra.description } : {}),
      ...(extra?.taxonomyScope ? { taxonomy_scope: extra.taxonomyScope } : {})
    })
    .select("id")
    .single();
  if (!insertError) {
    return inserted.id;
  }
  const { data: retryExisting, error: retryError } = await supabase
    .from("solar_systems")
    .select("id")
    .eq("galaxy", galaxy)
    .eq("normalized_name", normalizedName)
    .maybeSingle();
  if (!retryError && retryExisting) return retryExisting.id;
  console.warn("[solar-systems] création échouée :", insertError.message);
  return null;
}

// Noms jamais acceptés comme système solaire : trop proches de la rubrique/galaxie
// elle-même pour représenter un domaine durable. Renforcé après un premier test réel
// (05/08/2026) où l'IA a recréé "Arts et culture" comme "système solaire" au lieu d'un
// domaine précis (Chanson française, Cinéma...), puis un second test (06/08/2026) où
// des libellés génériques equivalents à la rubrique sont apparus ("Procès et justice"
// pour Justice - faits divers) — les variantes plausibles du même travers sont ajoutées
// ici à titre préventif, sans étendre à une liste longue/fragile.
const OPINION_ARTICLE_GENERIC_SOLAR_SYSTEM_NAMES = new Set([
  "actualite politique", "arts et culture", "culture generale", "actualite internationale",
  "societe", "faits divers", "sport", "sports",
  "proces et justice", "actualite judiciaire", "questions de societe",
  "relations internationales", "education et societe",
  "education et apprentissage", "education", "questions educatives"
]);

// Rejette un nom de système solaire identique/quasi identique à la galaxie, à la
// catégorie, à sa précision, ou figurant dans la liste explicite de libellés génériques.
function isOpinionArticleSolarSystemNameRejected(normalizedName, { galaxy, category, categoryPrecision }) {
  if (!normalizedName) return true;
  if (OPINION_ARTICLE_GENERIC_SOLAR_SYSTEM_NAMES.has(normalizedName)) return true;
  if (galaxy && normalizedName === normalizeSolarSystemName(galaxy)) return true;
  if (category && normalizedName === normalizeSolarSystemName(category)) return true;
  if (categoryPrecision && normalizedName === normalizeSolarSystemName(categoryPrecision)) return true;
  return false;
}

// Mots-clés du fallback : match sur frontière de mot (plus de "sélection" →
// élection, "transport" → sport, "nouveau" → eau). Un `*` final autorise les
// suffixes ("ecolog*" matche écologie/écologiste) ; sinon mot entier, pluriel
// s/x toléré. Seuls titre + résumé sont analysés : le nom de la source ou
// l'orientation polluaient le classement ("France Culture" → Culture).
// Premier match gagne : rubriques au vocabulaire spécifique (Sports,
// International) avant les fourre-tout (Politique, Économie).
const OPINION_FALLBACK_RULES = [
  ["Sports - loisirs", ["sport*", "football*", "rugby", "tennis", "cyclisme", "tour de france", "jo", "jeux olympiques", "olympique*", "coupe du monde", "quinte", "match*", "loisir*"]],
  ["International", ["ukraine", "russie", "chine", "etats-unis", "trump", "gaza", "israel*", "palestin*", "iran*", "yemen*", "houthi*", "arabie saoudite", "syrie", "liban", "otan", "union europeenne", "geopolit*", "international*", "moyen-orient", "diplomat*", "guerre*"]],
  ["Politique", ["macron", "assemblee nationale", "gouvernement*", "ministre*", "ministere*", "presidentiel*", "election*", "legislative*", "primaire*", "depute*", "senat*", "parlement*", "parti", "rn", "lfi", "ps", "lr", "politique*"]],
  ["Économie - emploi", ["economie*", "economique*", "emploi*", "salaire*", "entreprise*", "budget*", "impot*", "taxe*", "inflation", "banque*", "bourse", "industrie*", "retraite*", "chomage", "pouvoir d'achat"]],
  ["Climat - environnement", ["climat*", "ecolog*", "environnement*", "biodiversite", "energie*", "pollution*", "agricult*", "eau", "canicule*", "secheresse*", "meteo", "carbone", "orage*"]],
  ["Sciences - technologie", ["science*", "technolog*", "ia", "intelligence artificielle", "numerique*", "internet", "cyber*", "spatial*", "fusee*", "robot*", "algorithme*"]],
  ["Justice - faits divers", ["justice", "tribunal*", "proces", "police*", "gendarm*", "meurtre*", "agression*", "violence*", "prison*", "attentat*", "faits divers"]],
  ["Santé - bien-être", ["sante", "hopital*", "hopitaux", "medecin*", "maladie*", "virus", "vaccin*", "psychiatr*", "psycholog*", "bien-etre", "cancer*", "epidemie*"]],
  ["Langues et Lettres", ["langue francaise", "orthographe", "grammaire", "linguistique", "litterature", "litteraire*", "poesie", "poete*", "romancier*", "ecrivain*", "academie francaise", "dictee", "dictionnaire*"]],
  ["Histoire", ["histor*", "moyen age", "antiquite*", "napoleon*", "revolution francaise", "guerre mondiale", "empire romain", "medieval*", "prehistoire", "archeolog*"]],
  ["Culture - arts", ["culture*", "cinema*", "film*", "livre*", "musique*", "mode", "art", "arts", "theatre*", "serie*", "festival*", "exposition*", "concert*"]],
  ["Médias - divertissements", ["media*", "journal*", "television*", "radio", "cnews", "bfmtv", "divertissement*", "youtube*", "influenceur*", "reseaux sociaux"]],
  ["Philosophie - sciences sociales", ["philosoph*", "sociolog*", "anthropolog*", "religion*", "intellectuel*"]],
  ["Vie personnelle - modes de vie", ["famille*", "couple*", "parent*", "logement*", "consommation", "alimentation", "vie personnelle", "voyage*"]],
  ["Espace jeunes", ["jeunes", "adolescent*", "lycee*", "college*", "etudiant*", "ecole*", "jeunesse"]]
].map(([category, keywords]) => [
  category,
  keywords.map((keyword) => {
    const prefix = keyword.endsWith("*");
    const escaped = (prefix ? keyword.slice(0, -1) : keyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("\\b" + escaped + (prefix ? "\\w*" : "(s|x)?\\b"));
  })
]);

function getOpinionArticleFallbackCategory(article) {
  const text = [article?.title, article?.summary]
    .filter(Boolean).join(" ")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[’‘]/g, "'")
    .toLowerCase();

  for (const [category, patterns] of OPINION_FALLBACK_RULES) {
    if (patterns.some((pattern) => pattern.test(text))) return category;
  }
  return "Société - éducation";
}

// Classe chaque article dans une rubrique Mnoria (category/category_precision) — c'est tout :
// plus de système solaire ici, cf. Mon univers désormais réservé à la Culture Générale
// (resolveCultureGeneraleSolarSystemWithAI).
async function classifyOpinionArticlesWithAI(items) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !items.length) return new Map();

  const results = new Map();
  for (let start = 0; start < items.length; start += OPINION_ARTICLE_CATEGORY_BATCH_SIZE) {
    const chunk = items.slice(start, start + OPINION_ARTICLE_CATEGORY_BATCH_SIZE);
    const compactItems = chunk.map((item, index) => ({
      id: index,
      source: String(item.source || "").slice(0, 120),
      orientation: String(item.orientation || "").slice(0, 120),
      type: item.type === "youtube" ? "youtube" : "article",
      title: String(item.title || "").slice(0, 220),
      summary: String(item.summary || "").slice(0, 450),
      url: String(item.link || "").slice(0, 180)
    }));
    const itemIds = compactItems.map((item) => item.id).join(", ");
    const prompt = [
      "Réponds uniquement en json valide.",
      "Classe chaque article dans UNE seule rubrique Mnoria.",
      "Rubriques autorisées : " + OPINION_ARTICLE_CATEGORY_OPTIONS.join(" | "),
      `IMPORTANT : l'entrée contient ${compactItems.length} articles. Ta réponse json doit contenir exactement ${compactItems.length} objets dans items, avec tous les ids suivants : ${itemIds}.`,
      "Ne renvoie jamais seulement le premier item.",
      "Recopie le libellé de rubrique EXACTEMENT comme dans la liste, sans le modifier.",
      "4 rubriques sont volontairement hybrides et couvrent deux branches : \"Sports - loisirs\" (Sports ou Loisirs), \"Culture - arts\" (Culture ou Arts), \"Philosophie - sciences sociales\" (Philosophie ou Sciences sociales), \"Langues et Lettres\" (Langues ou Lettres).",
      "Ajoute un champ \"category_precision\" : pour ces 4 rubriques hybrides uniquement, indique la branche dominante du sujet (recopie exactement un des deux mots listés ci-dessus) ; pour toutes les autres rubriques, category_precision doit être null.",
      "Pour une rubrique hybride, choisis OBLIGATOIREMENT la branche dominante dans la grande majorité des cas ; n'utilise null que si le titre/résumé ne permettent vraiment pas de distinguer les deux branches — le simple fait qu'un article touche indirectement les deux ne justifie pas null.",
      "Pour \"Culture - arts\" : Arts = artiste/musicien/écrivain-créateur/acteur/réalisateur/œuvre/film/chanson/spectacle/exposition, même pour un décès ou hommage (ex. Marie-Paule Belle, chanteuse → Arts) ; Culture = patrimoine, politiques culturelles, pratiques de lecture/consommation culturelle, protection/destruction de biens culturels, débats culturels collectifs.",
      "Format obligatoire : {\"items\":[{\"id\":0,\"category\":\"...\",\"category_precision\":null},{\"id\":1,\"category\":\"Sports - loisirs\",\"category_precision\":\"Sports\"}]} avec un objet par id, tous les champs remplis pour chaque article.",
      "Choisis la rubrique la plus spécifique d'après le titre, le résumé, la source et l'URL.",
      "N'utilise Société - éducation que pour société, social, éducation, école, logement, famille, immigration, discriminations ou faits sociaux généraux.",
      "Ne classe pas en Société - éducation si une autre rubrique convient clairement : guerre/diplomatie/pays étrangers = International ; gouvernement/élections/partis = Politique ; argent/entreprises/impôts/travail = Économie - emploi ; canicule/météo/énergie/pollution = Climat - environnement ; procès/police/attentat/crime = Justice - faits divers ; cinéma/musique/série = Culture - arts ; littérature/langue française/orthographe/grammaire = Langues et Lettres ; événement historique/personnage historique/guerre mondiale/antiquité/moyen âge = Histoire ; sport/compétition/Tour de France/courses hippiques = Sports - loisirs ; maladie/hôpital/euthanasie = Santé - bien-être ; IA/internet/numérique = Sciences - technologie.",
      "Ne crée jamais d'autre rubrique.",
      "",
      JSON.stringify(compactItems)
    ].join("\n");

    try {
      // Les modèles gpt-5-* refusent max_tokens et toute temperature ≠ 1 :
      // max_completion_tokens (qui inclut leurs tokens de raisonnement, d'où le
      // budget large + reasoning_effort minimal) et température par défaut.
      const isGpt5 = /^gpt-5/.test(OPINION_ARTICLE_CATEGORY_MODEL);
      const body = {
        model: OPINION_ARTICLE_CATEGORY_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
      };
      if (isGpt5) {
        // Budget relevé (était 1000 + 80/item) après une régression observée le 06/08/2026 :
        // un prompt trop riche avait fait consommer tout le budget en raisonnement caché, sans
        // laisser de place pour le JSON de sortie (lot entier vide, sans erreur HTTP) — voir le
        // log de diagnostic juste après l'appel pour surveiller finishReason/contentLength si
        // ça se reproduit.
        body.max_completion_tokens = Math.min(12000, 1500 + chunk.length * 120);
        body.reasoning_effort = "low";
      } else {
        body.max_tokens = Math.min(6000, 160 + chunk.length * 40);
        body.temperature = 0;
      }
      const requestStartedAt = Date.now();
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const errBody = await r.text().catch(() => "");
        recordAiUsage(supabase, { feature: "opinion_article_classification", model: OPINION_ARTICLE_CATEGORY_MODEL, latencyMs: Date.now() - requestStartedAt, success: false, error: errBody || `openai http ${r.status}` });
        throw new Error(`openai http ${r.status}`);
      }
      const data = await r.json();
      const choice = data?.choices?.[0];
      const content = choice?.message?.content || "";
      const finishReason = choice?.finish_reason || null;
      const refusal = choice?.message?.refusal || null;
      {
        const { inputTokens, outputTokens, cachedTokens } = extractUsage(data?.usage);
        recordAiUsage(supabase, { feature: "opinion_article_classification", model: OPINION_ARTICLE_CATEGORY_MODEL, inputTokens, outputTokens, cachedTokens, latencyMs: Date.now() - requestStartedAt, success: true });
      }
      let parsed = null;
      try {
        parsed = content ? JSON.parse(content) : null;
      } catch {
        parsed = null;
      }
      const classified = Array.isArray(parsed?.items) ? parsed.items : [];
      // Diagnostic léger (jamais la clé API, le prompt ou le contenu des articles) : permet
      // de distinguer un lot vide "normal" (rien à classer) d'un échec du modèle (contenu
      // tronqué, refus, JSON invalide) sans avoir à relire les logs OpenAI directement.
      console.log(`[opinion-articles classification] status=${r.status} requested=${chunk.length} parsed=${classified.length} contentLength=${content.length} finishReason=${finishReason || "n/a"} refusal=${refusal ? "present" : "none"}`);
      if (chunk.length && !classified.length) {
        console.warn(`[opinion-articles classification] lot entier sans résultat exploitable (requested=${chunk.length}, finishReason=${finishReason || "n/a"}, contentLength=${content.length}).`);
      }
      for (const entry of classified) {
        const localIndex = Number(entry?.id);
        const category = normalizeOpinionArticleCategory(entry?.category);
        if (!Number.isInteger(localIndex) || !chunk[localIndex] || !category) continue;
        const precision = normalizeOpinionArticleCategoryPrecision(category, entry?.category_precision);
        const link = String(chunk[localIndex].link || "");
        results.set(link, { category, precision });
      }
    } catch (error) {
      console.warn("[opinion-articles category] classification IA ignorée :", error.message);
    }
  }

  return results;
}

async function upsertOpinionArticleRows(rows) {
  const { error } = await supabase
    .from("opinion_articles")
    .upsert(rows, { onConflict: "link", ignoreDuplicates: true });
  if (!error) return null;
  const message = String(error.message || "").toLowerCase();
  if (message.includes("solar_system_id")) {
    const fallbackRows = rows.map(({ solar_system_id, ...row }) => row);
    const retry = await supabase
      .from("opinion_articles")
      .upsert(fallbackRows, { onConflict: "link", ignoreDuplicates: true });
    if (retry.error) return retry.error;
    console.warn("[opinion-articles] colonne solar_system_id absente : migration data/migration-solar-systems.sql à appliquer.");
    return null;
  }
  if (message.includes("category_precision")) {
    const fallbackRows = rows.map(({ category_precision, ...row }) => row);
    const retry = await supabase
      .from("opinion_articles")
      .upsert(fallbackRows, { onConflict: "link", ignoreDuplicates: true });
    if (retry.error) return retry.error;
    console.warn("[opinion-articles] colonne category_precision absente : migration data/migration-opinion-articles-category-precision.sql à appliquer.");
    return null;
  }
  if (!message.includes("category")) return error;
  const fallbackRows = rows.map(({ category, category_precision, solar_system_id, ...row }) => row);
  const retry = await supabase
    .from("opinion_articles")
    .upsert(fallbackRows, { onConflict: "link", ignoreDuplicates: true });
  if (retry.error) return retry.error;
  console.warn("[opinion-articles] colonne category absente : migration data/migration-opinion-articles-category.sql à appliquer.");
  return null;
}

// ===== Filtre "inédits" : Autres actus n'affiche que des sujets non couverts
// par une arène de la session de publication en cours (la dernière rafale du
// bot de veille — le retrait des sessions précédentes est déjà fait à la
// source par le bot, cf. subjectKey + retrait rétroactif). Un article est
// écarté si son titre partage au moins 2 mots significatifs avec la question,
// les mots-clés ou le libellé de bulle d'une arène de cette rafale. Les arènes
// servant de référence sont mises en cache mémoire (TTL 15 min) pour limiter
// l'egress Supabase. =====
const OPINION_UNSEEN_DEBATES_TTL_MS = 15 * 60 * 1000;
const OPINION_UNSEEN_DEBATES_SCAN_LIMIT = 100;
// Fenêtre de recherche de la dernière rafale : au-delà de 24h sans publication,
// plus aucune arène ne sert de référence (filet vide = rien d'écarté).
const OPINION_UNSEEN_SESSION_SCAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Une rafale de publication s'étale sur quelques minutes : toute arène créée à
// moins de cet écart de la plus récente appartient à la même session.
const OPINION_UNSEEN_SESSION_GAP_MS = 90 * 60 * 1000;
const OPINION_UNSEEN_MIN_SHARED_TOKENS = 2;
let _opinionDebateTopicsCache = null;
let _opinionDebateTopicsComputedAt = 0;

// Mots grammaticaux/génériques (≥ 4 lettres, sans accents) qui ne doivent pas
// compter comme recoupement de sujet entre un titre d'article et une arène.
const OPINION_TOPIC_STOPWORDS = new Set([
  "pour", "avec", "sans", "dans", "plus", "moins", "tres", "apres", "avant",
  "contre", "entre", "vers", "chez", "mais", "comme", "etre", "avoir", "fait",
  "faire", "faut", "peut", "peuvent", "doit", "doivent", "cette", "cettes",
  "elle", "elles", "leur", "leurs", "tout", "tous", "toute", "toutes", "autre",
  "autres", "quel", "quelle", "quels", "quelles", "pourquoi", "comment",
  "quand", "aussi", "deja", "encore", "sont", "etait", "etaient", "nous",
  "vous", "votre", "notre", "alors", "ainsi", "selon", "face", "leurs",
  "celui", "celle", "ceux", "meme", "memes", "bien", "être", "vraiment",
  "direct", "live", "question", "jour", "info", "infos", "actu", "video"
]);

function extractOpinionTopicTokens(text) {
  return String(text || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !OPINION_TOPIC_STOPWORDS.has(token));
}

// Tolérance singulier/pluriel & flexions courtes : deux tokens se recoupent
// s'ils sont égaux ou si l'un préfixe l'autre (ex: incendie / incendies).
function opinionTopicTokensOverlap(a, b) {
  if (a === b) return true;
  return a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a));
}

async function getRecentDebateTopicTokenSets() {
  if (_opinionDebateTopicsCache && Date.now() - _opinionDebateTopicsComputedAt < OPINION_UNSEEN_DEBATES_TTL_MS) {
    return _opinionDebateTopicsCache;
  }
  try {
    const since = new Date(Date.now() - OPINION_UNSEEN_SESSION_SCAN_MAX_AGE_MS).toISOString();
    const { data, error } = await supabase
      .from("debates")
      .select("question, keywords, cloud_label, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(OPINION_UNSEEN_DEBATES_SCAN_LIMIT);
    if (error) throw new Error(error.message);
    // Session en cours = la rafale la plus récente : la première ligne (tri desc)
    // donne l'arène la plus fraîche, on ne garde que celles créées dans la foulée.
    const newestCreatedAt = data?.length ? new Date(data[0].created_at).getTime() : 0;
    const sessionRows = (data || []).filter((debate) => {
      const createdAt = new Date(debate.created_at).getTime();
      return Number.isFinite(createdAt) && newestCreatedAt - createdAt <= OPINION_UNSEEN_SESSION_GAP_MS;
    });
    const sets = sessionRows
      .map((debate) => {
        const keywords = Array.isArray(debate.keywords) ? debate.keywords.join(" ") : "";
        const tokens = extractOpinionTopicTokens(`${debate.question || ""} ${keywords} ${debate.cloud_label || ""}`);
        return tokens.length ? [...new Set(tokens)] : null;
      })
      .filter(Boolean);
    _opinionDebateTopicsCache = sets;
    _opinionDebateTopicsComputedAt = Date.now();
    return sets;
  } catch (error) {
    console.warn("[opinion-articles inédits] arènes de référence indisponibles :", error.message);
    // Cache périmé plutôt que rien ; sinon aucun filtrage sur cette passe.
    return _opinionDebateTopicsCache || [];
  }
}

// Clé de dédoublonnage par titre exact (même normalisation que cleanText côté
// bot veille) : les dépêches reprises telles quelles par plusieurs médias
// (syndication EBRA, fils AFP) arrivent avec des liens différents — le upsert
// onConflict "link" ne les attrape pas, on les replie donc à l'affichage.
function getOpinionArticleTitleKey(title) {
  return String(title || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Ne garde qu'un article par titre exact — le premier rencontré, donc le plus
// récent puisque la sélection est triée par published_at décroissant.
function dedupeOpinionArticlesByTitle(articles) {
  const seen = new Set();
  const kept = [];
  for (const article of articles) {
    const key = getOpinionArticleTitleKey(article?.title);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(article);
  }
  return kept;
}

function isOpinionArticleCoveredByDebates(article, debateTokenSets) {
  if (!debateTokenSets.length) return false;
  const titleTokens = [...new Set(extractOpinionTopicTokens(article?.title))];
  if (titleTokens.length < OPINION_UNSEEN_MIN_SHARED_TOKENS) return false;
  for (const debateTokens of debateTokenSets) {
    let shared = 0;
    for (const token of titleTokens) {
      if (debateTokens.some((debateToken) => opinionTopicTokensOverlap(token, debateToken))) {
        shared += 1;
        if (shared >= OPINION_UNSEEN_MIN_SHARED_TOKENS) return true;
      }
    }
  }
  return false;
}

// Previews d'articles résolus côté serveur : on joint au payload les aperçus
// déjà présents dans le cache disque de /api/link-preview, et on complète les
// manquants en tâche de fond (concurrence 2). Le client ne fait alors plus un
// POST /api/link-preview par carte (rafales réseau sur mobile) et rien de
// supplémentaire ne transite par Supabase — les previews vivent sur le disque
// du serveur.
const OPINION_PREVIEW_WARM_CONCURRENCY = 2;
const OPINION_PREVIEW_WARM_MAX_PER_PASS = 40;
const _opinionPreviewWarmQueue = [];
const _opinionPreviewWarmQueued = new Set();
let _opinionPreviewWarmActive = 0;

function pumpOpinionPreviewWarmQueue() {
  while (_opinionPreviewWarmActive < OPINION_PREVIEW_WARM_CONCURRENCY && _opinionPreviewWarmQueue.length) {
    const url = _opinionPreviewWarmQueue.shift();
    _opinionPreviewWarmActive += 1;
    getExternalLinkPreview(url)
      .catch(() => null)
      .finally(() => {
        _opinionPreviewWarmActive -= 1;
        _opinionPreviewWarmQueued.delete(url);
        pumpOpinionPreviewWarmQueue();
      });
  }
}

function queueOpinionPreviewWarmup(urls) {
  for (const url of urls.slice(0, OPINION_PREVIEW_WARM_MAX_PER_PASS)) {
    if (_opinionPreviewWarmQueued.has(url)) continue;
    _opinionPreviewWarmQueued.add(url);
    _opinionPreviewWarmQueue.push(url);
  }
  pumpOpinionPreviewWarmQueue();
}

function attachOpinionArticlePreviews(articles) {
  const missing = [];
  const enriched = articles.map((article) => {
    const link = normalizeExternalUrl(article.link);
    if (!link) return article;
    const preview = getCachedPreview(link) || readPersistentPreview(link);
    if (preview && hasPreviewImage(preview)) {
      return {
        ...article,
        source_image: article.source_image || preview.image || "",
        source_preview: {
          image: preview.image || "",
          title: preview.title || "",
          description: preview.description || "",
          ...(Number(preview.videoDurationSeconds) > 0
            ? { durationSeconds: Math.round(Number(preview.videoDurationSeconds)) }
            : {})
        },
        ...(Number(preview.videoDurationSeconds) > 0
          ? { video_duration_seconds: Math.round(Number(preview.videoDurationSeconds)) }
          : {})
      };
    }
    // Les miniatures YouTube sont déjà servies par i.ytimg.com côté client :
    // inutile de préchauffer un aperçu pour elles.
    if (article.type !== "youtube") missing.push(link);
    return article;
  });
  queueOpinionPreviewWarmup(missing);
  return enriched;
}

// Cache court en mémoire : la page /autres-sources n'a pas besoin d'être seconde-près,
// et sans lui chaque visiteur redéclenchait le fetch + la requête ciblée ci-dessous contre
// Supabase (cf. incident de quota Disk IO du 20/06/2026 — server.js:7403, 7455).
// TTL 15 min (relevé de 5 min le 12/08/2026, audit egress) : la passe légère de
// buildFreshOpinionArticlesSelection scanne désormais jusqu'à
// OPINION_ARTICLES_SELECTION_SCAN_LIMIT lignes — qui couvre la table ENTIÈRE
// des 7 jours de rétention (7 880 lignes mesurées ce jour-là pour une limite à
// 10 000), ~2,35 Mo par reconstruction. Réduire cette limite pénaliserait la
// diversité de la sélection (orientations peu représentées, ex. "gauche",
// qui doivent piocher plus loin dans les 7 jours) ; espacer les reconstructions
// réduit l'egress sans ce risque, même principe que DEBATES_RECENT_CACHE_TTL_MS
// (2 min → 15 min, même audit). La fraîcheur reste assurée par l'invalidation
// explicite aux endpoints veille (ingestion et retrait) : ce TTL ne borne que
// le pire cas (aucun événement d'invalidation), pas le cas normal.
const OPINION_ARTICLES_CACHE_TTL_MS = 15 * 60 * 1000;
let _opinionArticlesCache = null;
let _opinionArticlesCacheComputedAt = 0;
// Anti-dogpile (même principe que debatesApiInFlight/latestDebatesMetaInFlight) :
// sans lui, plusieurs visiteurs arrivant pile au moment où le cache expire
// déclenchaient chacun leur propre double lecture Supabase (scan léger +
// select("*") des articles retenus) — cf. audit egress du 10/08/2026.
let _opinionArticlesInFlight = null;

// Seuls les bulletins de prévision type "météo du jour" sont écartés d'Autres
// actus (demande du 19/07/2026, resserrée le même jour : tempêtes, vigilances
// et épisodes météo marquants sont de vraies actualités et restent affichés).
// Comparaison sur le titre uniquement, après normalisation sans accents ;
// "Météo-France" est neutralisé d'abord — le nom de l'agence apparaît dans les
// titres d'alerte ("Météo-France place 12 départements en vigilance") qui ne
// doivent pas être filtrés.
const OPINION_WEATHER_FORECAST_PATTERNS = [
  /\bmeteo\b/,
  /\bquel temps\b/,
  /\ble temps (du jour|ce matin|cet apres-midi|ce soir|de ce\b|qu['’\s]?il fera)/
];

function isOpinionArticleWeatherRelated(article) {
  const title = String(article?.title || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/meteo[ -]?france/g, " ");
  if (!title.trim()) return false;
  return OPINION_WEATHER_FORECAST_PATTERNS.some((pattern) => pattern.test(title));
}

async function getOpinionArticlesSelection() {
  if (_opinionArticlesCache && Date.now() - _opinionArticlesCacheComputedAt < OPINION_ARTICLES_CACHE_TTL_MS) {
    return _opinionArticlesCache;
  }
  if (_opinionArticlesInFlight) return _opinionArticlesInFlight;

  _opinionArticlesInFlight = buildFreshOpinionArticlesSelection().finally(() => {
    _opinionArticlesInFlight = null;
  });
  return _opinionArticlesInFlight;
}

async function buildFreshOpinionArticlesSelection() {
  // La classification gauche/droite (avec ses synonymes) se fait en JS, pas en SQL :
  // ilike n'est pas insensible aux accents, ce qui rendrait le filtre SQL aussi long
  // et fragile que la liste de synonymes elle-même. Passe 1 : colonnes légères
  // uniquement (pas de title/link/summary) sur un large volume pour classer sans
  // faire peser le poids texte de tout ce qui sera finalement rejeté ; passe 2 :
  // select("*") restreint aux seules lignes retenues.
  const lightRows = await fetchOpinionArticleSelectionRows(OPINION_ARTICLES_SELECTION_SCAN_LIMIT);

  const buckets = buildVisibleOpinionArticleSelection(lightRows);
  const selectedIds = Object.values(buckets).flatMap((bucket) => [...bucket.article, ...bucket.youtube]);
  if (!selectedIds.length) {
    _opinionArticlesCache = [];
    _opinionArticlesCacheComputedAt = Date.now();
    return _opinionArticlesCache;
  }

  // selectedIds peut dépasser 1000 (round-robin sur tous les groupes/types) :
  // .in() seul se fait plafonner silencieusement à 1000 lignes par PostgREST,
  // ce qui coupait les articles les plus récents (ids les plus hauts) sans
  // erreur — cf. incident du 20/07/2026 (aucun article des dernières ~16h
  // visible). fetchAllSupabaseRowsIn découpe et pagine.
  const { data: fullRows, error: fullError } = await fetchAllSupabaseRowsIn(
    selectedIds,
    (chunk) => supabase.from("opinion_articles").select("*").in("id", chunk)
  );
  if (fullError) throw new Error(fullError.message);

  // Filtre "inédits" : ne garde que les sujets non couverts par une arène de
  // la session de publication en cours (cf. getRecentDebateTopicTokenSets).
  const debateTopicTokenSets = await getRecentDebateTopicTokenSets();
  const articles = attachOpinionArticlePreviews(
    dedupeOpinionArticlesByTitle(
      (fullRows || [])
        .map((article) => {
          const category = normalizeOpinionArticleCategory(article.category) || getOpinionArticleFallbackCategory(article);
          return {
            ...article,
            orientation: normalizeOpinionArticleOrientationForSource(article) || article.orientation,
            category,
            category_precision: normalizeOpinionArticleCategoryPrecision(category, article.category_precision)
          };
        })
        .filter((article) => !isOpinionArticleCoveredByDebates(article, debateTopicTokenSets))
        .filter((article) => !isOpinionArticleWeatherRelated(article))
        .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
    )
  );
  _opinionArticlesCache = articles;
  _opinionArticlesCacheComputedAt = Date.now();
  return articles;
}

// Pagination façon index (/api/debates) : la sélection complète vit dans le cache
// mémoire, chaque requête n'en découpe qu'une tranche. Sans limit, réponse
// complète (compat ascendante) ; total/hasMore permettent au front d'alimenter
// sa sentinelle de scroll infini.
const OPINION_ARTICLES_VALID_ORIENTATIONS = ["left", "right", "center", "positive", "regional"];

app.get("/api/opinion-articles", async (req, res) => {
  try {
    let articles = await getOpinionArticlesSelection();
    // Filtrage par orientation avant pagination (onglets Gauche/Droite/Généraliste/Nouvelles
    // positives/Actualités régionales, cf. autres-sources.html) : sans ça, ces onglets
    // filtraient côté client un pool mélangé trié par date globale, où "gauche" (~12% du
    // volume) était noyé sous le "régional"/"généraliste" à fort débit — seules 5 cartes
    // gauche apparaissaient dans les 120 premières lignes du pool. getOpinionOrientationGroup
    // est le même classifieur déjà utilisé par /recommended et le bucketing interne.
    const orientationQuery = String(req.query.orientation || "").trim().toLowerCase();
    if (OPINION_ARTICLES_VALID_ORIENTATIONS.includes(orientationQuery)) {
      articles = articles.filter((a) => getOpinionOrientationGroup(a.orientation) === orientationQuery);
    }
    // Filtrage par catégorie (cf. loadEspaceJeunesSeed côté autres-sources.html) : "Espace
    // jeunes" est une catégorie si rare dans le flux qu'elle n'apparaît jamais dans les
    // premières pages du pool trié par date globale (même classe de problème que le filtrage
    // par orientation ci-dessus) — un fetch dédié la fait remonter indépendamment de sa
    // profondeur réelle dans le pool.
    const categoryQuery = String(req.query.category || "").trim();
    if (categoryQuery) {
      articles = articles.filter((a) => a.category === categoryQuery);
    }
    const rawLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 0;
    if (!limit) {
      return res.json({ articles, total: articles.length, hasMore: false });
    }
    const rawOffset = Number.parseInt(String(req.query.offset ?? ""), 10);
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
    const page = articles.slice(offset, offset + limit);
    res.json({ articles: page, total: articles.length, hasMore: offset + page.length < articles.length });
  } catch (error) {
    res.status(500).json({ articles: [], total: 0, hasMore: false, error: error.message });
  }
});

// Clic sur une carte Autres actus (source du signal de /api/opinion-articles/recommended
// ci-dessous). Même convention fire-and-forget que POST /api/track-visit : pas de rate
// limit (endpoint analytics à faible enjeu, même niveau de confiance que le reste de cette
// app sans authentification), réponse immédiate avant l'insert. category/orientation sont
// re-normalisées côté serveur plutôt que de faire confiance au payload client : la table
// alimente ensuite des comparaisons de filtre (topCategories.has(...)), qui doivent toujours
// porter sur l'ensemble de valeurs connu.
app.post("/api/opinion-articles/click", (req, res) => {
  const { visitorKey, link, category, orientation } = req.body || {};
  if (!visitorKey || !link) {
    return res.status(400).json({ error: "visitorKey et link requis" });
  }
  res.json({ success: true });
  supabase
    .from("opinion_article_clicks")
    .insert({
      visitor_key: String(visitorKey),
      article_link: String(link),
      category: normalizeOpinionArticleCategory(category) || null,
      orientation_group: getOpinionOrientationGroup(orientation),
      created_at: nowIso()
    })
    .then(({ error }) => { if (error) console.error("opinion-articles click:", error); });
});

const OPINION_ARTICLE_CLICKS_HISTORY_LIMIT = 200;
const OPINION_ARTICLES_RECOMMENDED_TOP_CATEGORIES = 3;
const OPINION_ARTICLES_RECOMMENDED_TOP_ORIENTATIONS = 2;
const OPINION_ARTICLES_RECOMMENDED_TRENDING_WINDOW_DAYS = 3;
const OPINION_ARTICLES_RECOMMENDED_TRENDING_SCAN_LIMIT = 3000;
const OPINION_ARTICLES_RECOMMENDED_FALLBACK_CACHE_TTL_MS = 5 * 60 * 1000;

let _opinionArticlesTrendingFallbackCache = null;
let _opinionArticlesTrendingFallbackCacheComputedAt = 0;

// Palier 2 de /api/opinion-articles/recommended (visiteur sans historique de clic) :
// articles les plus cliqués tous visiteurs confondus sur une fenêtre récente. C'est le
// palier le plus sollicité (tout nouveau visiteur y tombe), d'où le cache mémoire — évite
// de rescanner opinion_article_clicks à chaque chargement de page.
async function getTrendingOpinionArticleLinksFallback() {
  if (_opinionArticlesTrendingFallbackCache && Date.now() - _opinionArticlesTrendingFallbackCacheComputedAt < OPINION_ARTICLES_RECOMMENDED_FALLBACK_CACHE_TTL_MS) {
    return _opinionArticlesTrendingFallbackCache;
  }
  const cutoff = new Date(Date.now() - OPINION_ARTICLES_RECOMMENDED_TRENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("opinion_article_clicks")
    .select("article_link")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(OPINION_ARTICLES_RECOMMENDED_TRENDING_SCAN_LIMIT);
  if (error) { console.error("trending fallback:", error.message); return []; }
  const counts = new Map();
  for (const row of data || []) {
    if (!row.article_link) continue;
    counts.set(row.article_link, (counts.get(row.article_link) || 0) + 1);
  }
  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([link]) => link);
  _opinionArticlesTrendingFallbackCache = ranked;
  _opinionArticlesTrendingFallbackCacheComputedAt = Date.now();
  return ranked;
}

// Section "Recommandé pour vous" (Autres actus) : 3 niveaux, du plus au moins personnalisé.
// 1) Historique de clic du visiteur : top catégories/orientations cliquées, filtré sur le
//    pool déjà caché de getOpinionArticlesSelection() (aucun nouveau read sur opinion_articles).
// 2) On complète toujours avec la tendance globale récente
//    (cf. getTrendingOpinionArticleLinksFallback ci-dessus).
// 3) On finit de remplir avec les plus récents non cliqués.
app.get("/api/opinion-articles/recommended", async (req, res) => {
  try {
    const visitorKey = String(req.query.visitorKey || "").trim();
    if (!visitorKey) return res.json({ articles: [] });

    const pool = await getOpinionArticlesSelection();
    if (!pool.length) return res.json({ articles: [] });

    const { data: clickRows, error } = await supabase
      .from("opinion_article_clicks")
      .select("article_link, category, orientation_group")
      .eq("visitor_key", visitorKey)
      .order("created_at", { ascending: false })
      .limit(OPINION_ARTICLE_CLICKS_HISTORY_LIMIT);
    if (error) throw new Error(error.message);

    const clickedLinks = new Set((clickRows || []).map((r) => r.article_link));
    const recommended = [];
    const recommendedLinks = new Set();
    const appendUniqueRecommendations = (articles) => {
      for (const article of articles || []) {
        const link = String(article?.link || "").trim();
        if (!link || clickedLinks.has(link) || recommendedLinks.has(link)) continue;
        recommendedLinks.add(link);
        recommended.push(article);
      }
    };

    if (clickRows && clickRows.length) {
      const categoryFreq = new Map();
      const orientationFreq = new Map();
      for (const row of clickRows) {
        if (row.category) categoryFreq.set(row.category, (categoryFreq.get(row.category) || 0) + 1);
        if (row.orientation_group) orientationFreq.set(row.orientation_group, (orientationFreq.get(row.orientation_group) || 0) + 1);
      }
      const topCategories = new Set(Array.from(categoryFreq.entries())
        .sort((a, b) => b[1] - a[1]).slice(0, OPINION_ARTICLES_RECOMMENDED_TOP_CATEGORIES).map(([c]) => c));
      const topOrientations = new Set(Array.from(orientationFreq.entries())
        .sort((a, b) => b[1] - a[1]).slice(0, OPINION_ARTICLES_RECOMMENDED_TOP_ORIENTATIONS).map(([o]) => o));

      appendUniqueRecommendations(pool
        .filter((a) => topCategories.has(a.category) || topOrientations.has(getOpinionOrientationGroup(a.orientation)))
        .sort((a, b) => new Date(b.published_at) - new Date(a.published_at)));
    }

    const trendingLinks = await getTrendingOpinionArticleLinksFallback();
    const byLink = new Map(pool.map((a) => [a.link, a]));
    appendUniqueRecommendations(trendingLinks
      .filter((link) => byLink.has(link))
      .map((link) => byLink.get(link)));

    appendUniqueRecommendations(pool);

    const rawLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 0;
    if (!limit) {
      return res.json({ articles: recommended, total: recommended.length, hasMore: false });
    }
    const rawOffset = Number.parseInt(String(req.query.offset ?? ""), 10);
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
    const page = recommended.slice(offset, offset + limit);
    res.json({ articles: page, total: recommended.length, hasMore: offset + page.length < recommended.length });
  } catch (error) {
    res.status(500).json({ articles: [], error: error.message });
  }
});

// Liste de tous les médias sélectionnables dans l'onglet Personnalisé (toute
// orientation confondue, pas seulement généraliste — demande du 20/07/2026),
// regroupés par orientation pour faciliter la recherche dans le picker —
// dérivée de la config veille_medias (source de vérité déjà utilisée pour
// classer left/right/positive/regional/center), pas d'un scan
// d'opinion_articles : une liste stable, indépendante du volume publié à
// l'instant T.
const OPINION_CUSTOM_MEDIA_GROUP_ORDER = [
  { key: "right", label: "Droite" },
  { key: "left", label: "Gauche" },
  { key: "center", label: "Généralistes" },
  { key: "positive", label: "Nouvelles positives" },
  { key: "regional", label: "Actualités régionales" }
];

app.get("/api/opinion-articles/custom-media-options", async (req, res) => {
  try {
    if (veilleMediasCacheIsStale()) await _loadVeilleMediasFromSupabase();
    const byGroup = new Map();
    for (const media of readVeilleMedias()) {
      const nom = String(media.nom || "").trim();
      if (!nom) continue;
      // Presse et chaîne YouTube du même média (même "nom") restent deux
      // entrées distinctes — demande du 20/07/2026, ex. "Midi Libre" (presse)
      // vs "Midi Libre YOUTUBE" (vidéo) — sinon cocher l'une cochait l'autre
      // sans que ce soit visible pour l'utilisateur.
      const isYoutube = media.domain === "youtube.com";
      const group = getOpinionOrientationGroup(media.orientation);
      const dedupeKey = nom + (isYoutube ? "::yt" : "");
      if (!byGroup.has(group)) byGroup.set(group, new Map());
      const groupMap = byGroup.get(group);
      if (!groupMap.has(dedupeKey)) groupMap.set(dedupeKey, { nom, youtube: isYoutube });
    }
    // Chaque groupe d'orientation se divise en deux sous-sections — Vidéos
    // puis Presse écrite (demande du 20/07/2026) — plutôt qu'une liste
    // mélangée triée seulement par nom.
    const groups = OPINION_CUSTOM_MEDIA_GROUP_ORDER
      .map(({ key, label }) => {
        const all = Array.from((byGroup.get(key) || new Map()).values());
        const byName = (a, b) => a.nom.localeCompare(b.nom, "fr");
        const subgroups = [
          { key: "video", label: "Vidéos", media: all.filter((m) => m.youtube).sort(byName) },
          { key: "press", label: "Presse écrite", media: all.filter((m) => !m.youtube).sort(byName) }
        ].filter((subgroup) => subgroup.media.length);
        return { key, label, subgroups };
      })
      .filter((group) => group.subgroups.length);
    res.json({ groups });
  } catch (error) {
    res.status(500).json({ groups: [], error: error.message });
  }
});

app.post("/api/admin/opinion-articles/classify", requireAdmin, rateLimit("admin-ai", 10), async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(2000, Number(req.body?.limit || req.query.limit || 200)));
    const force = req.body?.force === true || req.query.force === "1" || req.query.force === "true";
    const scope = String(req.body?.scope || req.query.scope || "latest").trim().toLowerCase();
    let data = [];

    if (scope === "visible") {
      const lightRows = await fetchOpinionArticleSelectionRows(OPINION_ARTICLES_SELECTION_SCAN_LIMIT);

      const buckets = buildVisibleOpinionArticleSelection(lightRows);
      const selectedIds = Object.values(buckets).flatMap((bucket) => [...bucket.article, ...bucket.youtube]).slice(0, limit);
      if (selectedIds.length) {
        const { data: fullRows, error: fullError } = await supabase
          .from("opinion_articles")
          .select("id, source, orientation, title, link, summary, type, category, category_precision, published_at")
          .in("id", selectedIds);
        if (fullError) throw new Error(fullError.message);
        data = fullRows || [];
      }
    } else {
      const { data: latestRows, error } = await supabase
        .from("opinion_articles")
        .select("id, source, orientation, title, link, summary, type, category, category_precision, published_at")
        .order("published_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      data = latestRows || [];
    }

    const rows = force ? data : data.filter((article) => !normalizeOpinionArticleCategory(article.category));
    if (!rows.length) return res.json({ ok: true, updated: 0, model: OPINION_ARTICLE_CATEGORY_MODEL });

    const aiCategories = await classifyOpinionArticlesWithAI(rows);

    // Garde-fou : un échec complet de l'IA (0 résultat exploitable pour tout le lot)
    // ne doit jamais se traduire par un écrasement silencieux via le fallback local —
    // cf. régression du 06/08/2026 où category/category_precision d'articles déjà bien
    // classés avaient été remplacés par le fallback mots-clés. Cette route ne fait plus
    // jamais confiance au fallback : seuls les articles avec une classification IA
    // valide sont mis à jour, les autres restent inchangés.
    if (aiCategories.size === 0) {
      console.warn(`[opinion-articles classification] echec complet du lot : considered=${rows.length}, aiClassified=0 — aucune mise a jour appliquee.`);
      return res.status(502).json({
        ok: false,
        error: "ai_classification_empty",
        considered: data.length,
        updated: 0,
        aiClassified: 0
      });
    }

    let updated = 0;
    let aiClassified = 0;
    let unchanged = 0;
    for (const article of rows) {
      const linkKey = String(article.link || "");
      const aiResult = aiCategories.get(linkKey);
      if (!aiResult) { unchanged += 1; continue; }
      aiClassified += 1;
      const category = aiResult.category;
      const category_precision = normalizeOpinionArticleCategoryPrecision(category, aiResult.precision);
      const { error: updateError } = await supabase
        .from("opinion_articles")
        .update({ category, category_precision })
        .eq("id", article.id);
      if (updateError) throw new Error(updateError.message);
      updated += 1;
    }
    _opinionArticlesCache = null;
    _opinionArticlesCacheComputedAt = 0;
    res.json({
      ok: true,
      updated,
      aiClassified,
      unchanged,
      considered: data.length,
      force,
      scope,
      model: process.env.OPENAI_API_KEY ? OPINION_ARTICLE_CATEGORY_MODEL : "fallback-local"
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/veille/stories", async (req, res) => {
  try {
    const { data, error } = await supabase.from("stories").select("*").neq("status", "archived").order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ stories: data || [] });
  } catch (error) {
    res.status(500).json({ stories: [], error: error.message });
  }
});

app.get("/api/veille/stories/:storyId/debates", async (req, res) => {
  const storyId = String(req.params.storyId || "").trim();
  if (!storyId) return res.status(400).json({ ok: false, error: "storyId requis" });

  try {
    const { data: story, error: storyErr } = await supabase.from("stories").select("*").eq("story_id", storyId).maybeSingle();
    if (storyErr) throw new Error(storyErr.message);
    if (!story) {
      return res.status(404).json({ ok: false, error: "Histoire introuvable." });
    }

    const { data, error } = await supabase
      .from("debates")
      .select("id, question, content, created_at, story_id")
      .eq("story_id", storyId);

    if (!data || !data.length) {
      return res.json({ ok: true, story, debates: [] });
    }

    if (error) throw new Error(error.message);

    const debates = (Array.isArray(data) ? data : [])
      .map((debate) => enrichDebateWithStoredImage(debate))
      .sort((a, b) => {
        const left = new Date(a.created_at || 0).getTime();
        const right = new Date(b.created_at || 0).getTime();
        return right - left;
      })
      .map((debate) => ({
        id: debate.id,
        question: String(debate.question || "").trim(),
        content: String(debate.content || "").trim(),
        created_at: debate.created_at || null,
        url: `/debate?id=${debate.id}`
      }));

    res.json({ ok: true, story, debates });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message, debates: [] });
  }
});

app.delete("/api/veille/stories/:storyId/debates/:debateId", requireAdmin, async (req, res) => {
  const storyId = String(req.params.storyId || "").trim();
  const debateId = String(req.params.debateId || "").trim();
  if (!storyId || !debateId) {
    return res.status(400).json({ ok: false, error: "storyId et debateId requis" });
  }

  try {
    const previousStoryId = storyId;
    await supabase.from("debates").update({ story_id: null, episode_nav: null }).eq("id", debateId);
    if (previousStoryId) await recalculateStoryEpisodeNavigation(previousStoryId);
    invalidateDebateCaches(debateId);
    res.json({ ok: true, debate_id: debateId, removed_story_id: storyId });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Erreur dissociation arène" });
  }
});

app.post("/api/veille/stories", requireAdmin, async (req, res) => {
  try {
    const title = String(req.body?.story_title || "").trim();
    if (!title) {
      return res.status(400).json({ ok: false, error: "Titre d’histoire requis." });
    }

    const { data: existing } = await supabase.from("stories").select("*").ilike("story_title", title).maybeSingle();
    if (existing) {
      return res.json({ ok: true, story: existing, created: false, duplicate: true });
    }

    const story = {
      story_id: createStoryId(title),
      story_title: title,
      main_actors: [],
      central_tension: "",
      keywords: [],
      status: "active",
      created_at: nowIso(),
      updated_at: nowIso(),
      first_episode_id: null,
      latest_episode_id: null,
      latest_episode_title: ""
    };

    const saved = await upsertStory(story);
    res.json({ ok: true, story: saved, created: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Erreur création histoire" });
  }
});

app.put("/api/veille/stories/:storyId", requireAdmin, async (req, res) => {
  const storyId = String(req.params.storyId || "").trim();
  if (!storyId) return res.status(400).json({ ok: false, error: "storyId requis" });

  try {
    const { data: story, error: findErr } = await supabase.from("stories").select("*").eq("story_id", storyId).maybeSingle();
    if (findErr) throw new Error(findErr.message);
    if (!story) return res.status(404).json({ ok: false, error: "Histoire introuvable." });

    const nextTitle = String(req.body?.story_title || "").trim();
    const updates = { updated_at: nowIso() };
    if (nextTitle) updates.story_title = nextTitle;

    const { error: updateErr } = await supabase.from("stories").update(updates).eq("story_id", storyId);
    if (updateErr) throw new Error(updateErr.message);
    res.json({ ok: true, story: { ...story, ...updates } });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete("/api/veille/stories/:storyId", requireAdmin, async (req, res) => {
  const storyId = String(req.params.storyId || "").trim();
  if (!storyId) return res.status(400).json({ ok: false, error: "storyId requis" });

  try {
    const { data: affectedRows } = await supabase.from("debates").select("id").eq("story_id", storyId);
    const affectedDebateIds = (affectedRows || []).map(r => String(r.id));

    await supabase.from("debates").update({ story_id: null, episode_nav: null }).eq("story_id", storyId);
    await supabase.from("stories").delete().eq("story_id", storyId);

    res.json({ ok: true, removed_story_id: storyId, affectedDebateIds });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Cache court des 300 débats récents utilisés par check-similar : pendant un lot
// d'auto-publication (bot veille / Certamen), cet endpoint est appelé une fois PAR SUJET
// en attente (jusqu'à plusieurs dizaines de fois en quelques minutes), mais la requête
// Supabase sous-jacente (300 lignes, colonne `content` incluse) renvoie quasiment toujours
// les mêmes données d'un appel à l'autre : la table `debates` ne change pas en quelques
// secondes. TTL court (90s) + mise à jour explicite dès qu'un nouveau débat est inséré
// (cf. recordNewlyPublishedDebateInSimilarityCache) : le cache reste sûr contre les
// doublons intra-lot tout en évitant l'essentiel des rechargements identiques (audit
// egress PostgREST du 25/08/2026).
let recentDebatesForSimilarityCache = null;
let recentDebatesForSimilarityCacheAt = 0;
const RECENT_DEBATES_FOR_SIMILARITY_CACHE_TTL_MS = 90 * 1000;

async function getRecentDebatesForSimilarity() {
  const now = Date.now();
  if (recentDebatesForSimilarityCache && (now - recentDebatesForSimilarityCacheAt) < RECENT_DEBATES_FOR_SIMILARITY_CACHE_TTL_MS) {
    console.log("[check-similar] recent debates cache HIT");
    return recentDebatesForSimilarityCache;
  }

  const { data: debates, error } = await supabase
    .from("debates")
    .select("id, question, option_a, option_b, type, content, created_at")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) throw new Error(error.message);
  recentDebatesForSimilarityCache = debates || [];
  recentDebatesForSimilarityCacheAt = now;
  console.log("[check-similar] recent debates cache MISS");
  return recentDebatesForSimilarityCache;
}

// Appelée après l'insertion réussie d'un nouveau débat (/api/admin/veille/publish et
// /api/debates). Une invalidation totale (cache remis à null) serait correcte mais
// quasi inutile en pratique : dans un lot d'auto-publication, la quasi-totalité des
// sujets passés à check-similar finissent effectivement publiés, donc vider tout le
// cache à CHAQUE publication ferait recharger les 300 lignes à chaque candidat suivant
// — presque comme si le cache n'existait pas. On ajoute donc directement la ligne du
// débat qui vient d'être inséré (déjà en main, aucune requête Supabase nécessaire) : le
// prochain check-similar de la même passe le voit immédiatement (protection anti-doublon
// intra-lot intacte) sans jamais recharger le reste depuis Supabase.
function recordNewlyPublishedDebateInSimilarityCache(row, reason = "") {
  if (!row || row.id === undefined || row.id === null) return;
  if (recentDebatesForSimilarityCache === null) {
    // Rien en cache actuellement : le prochain appel rechargera de toute façon une
    // liste à jour depuis Supabase, qui inclura ce débat.
    return;
  }
  // Borné à 300 lignes pour rester fidèle à la requête d'origine (.limit(300)).
  recentDebatesForSimilarityCache = [row, ...recentDebatesForSimilarityCache].slice(0, 300);
  console.log(`[check-similar] recent debates cache updated${reason ? " (" + reason + ")" : ""} — débat ${row.id} ajouté sans requête Supabase`);
}

// Bucket dédié : pendant un lot d'auto-publication, le bot enchaîne check-similar +
// merge + publish pour chaque sujet. Sur le bucket partagé "admin-ai" (10/min), les
// check-similar se faisaient limiter en silence → fusions sautées → doublons.
app.post("/api/admin/veille/check-similar", requireAdmin, rateLimit("veille-similar", 30), async (req, res) => {
  const { question, positionA, positionB, resume } = req.body || {};
  if (!String(question || "").trim()) return res.status(400).json({ similar: [] });

  try {
    const debates = await getRecentDebatesForSimilarity();
    if (!debates || !debates.length) return res.json({ similar: [] });

    const candidates = getVeilleSimilarityCandidates({ question, positionA, positionB, resume }, debates);
    if (!candidates.length) return res.json({ similar: [] });

    const top3 = candidates.slice(0, 3);
    const aiResults = await analyzeVeilleSimilarityWithAI({ question, positionA, positionB, resume }, top3).catch(() => null);

    let similar;
    if (aiResults && aiResults.length) {
      const aiMap = {};
      for (const r of aiResults) aiMap[String(r.id)] = r;
      similar = top3
        .map(c => {
          const ai = aiMap[String(c.id)];
          if (!ai) return c;
          return { ...c, score: typeof ai.score === 'number' ? Number(ai.score.toFixed(3)) : c.score, confirmed: ai.confirmed === true };
        })
        .filter(c => c.confirmed !== false)
        .sort((a, b) => b.score - a.score);
    } else {
      similar = top3;
    }

    res.json({ similar });
  } catch (e) {
    res.json({ similar: [], error: e.message });
  }
});

// Libellé de bulle en cascade : cloud_label → premier keyword non générique.
// Une question d'arène n'est jamais un tag : si aucun libellé associé n'est
// disponible, l'arène est omise du nuage plutôt que d'afficher furtivement
// son titre complet dans une bulle Communauté.
function getMnoriaBubbleLabel(debate) {
  return getCloudLabelFromDebate(debate);
}

let mnoriaBubbleTrendsCache = null;
let mnoriaBubbleTrendsInFlight = null;
const MNORIA_BUBBLE_TRENDS_CACHE_TTL_MS = 5 * 60 * 1000;
// Supabase peut rester bloqué plusieurs dizaines de secondes avant de répondre
// (ou de tomber en erreur) en cas de panne réseau côté infra — sans timeout
// explicite, ces requêtes traîneraient la requête HTTP entrante avec elles.
const MNORIA_BUBBLE_QUERY_TIMEOUT_MS = 8000;

// Top 10 des arènes communautaires par score d'activité décroissant dans le temps
// (idées ×1 + commentaires ×0,5 + votes ×0,2, chaque contribution pondérée par
// 0,5^(âge / demi-vie)). Remplace l'ancien classement en paliers 48h → 7j → total :
// le palier "total" ne redescendait jamais, donc une arène ayant eu un pic
// d'activité une fois pouvait squatter le nuage indéfiniment même totalement
// retombée, au détriment des arènes plus récentes. Un score qui décroît dans le
// temps (ranking "hot" classique) fait naturellement sortir les arènes mortes et
// laisse entrer les nouvelles dès qu'elles ont un peu d'activité récente.
const MNORIA_BUBBLE_DECAY_HALF_LIFE_HOURS = 36;
// Au-delà, le poids décayé d'un vote est < 0,1% de sa valeur initiale — borne la
// fenêtre de la requête votes sans fausser le classement.
const MNORIA_BUBBLE_DECAY_CUTOFF_MS = 15 * 24 * 60 * 60 * 1000;

function mnoriaBubbleDecayWeight(createdAt, now) {
  if (!createdAt) return 0;
  const ageHours = (now - new Date(createdAt).getTime()) / (60 * 60 * 1000);
  if (!Number.isFinite(ageHours) || ageHours <= 0) return 1;
  return Math.pow(0.5, ageHours / MNORIA_BUBBLE_DECAY_HALF_LIFE_HOURS);
}

// Calculé en base — contrairement au calcul client précédent, on n'a plus besoin
// de charger toutes les arènes dans le navigateur pour obtenir ce classement.
async function computeMnoriaBubbleTrends() {
  if (mnoriaBubbleTrendsCache && Date.now() < mnoriaBubbleTrendsCache.expiresAt) {
    return mnoriaBubbleTrendsCache.value;
  }

  const now = Date.now();

  const { data: debateRows, error: debatesError } = await fetchAllSupabaseRows(() =>
    supabase
      .from("debates")
      .select("id, question, keywords, cloud_label, creator_key, created_at")
      .not("creator_key", "is", null)
      .neq("creator_key", MNORIA_ADMIN_CREATOR_KEY)
      // Les arènes gauche/droite issues de la veille mixte ont leurs 2 nuages dédiés
      // (cf. rebuildCloudBubblesForGroup) — elles ne doivent jamais se mélanger ici
      // avec le nuage communautaire partagé (ex: Certamen).
      .or("political_group.is.null,political_group.eq.mixed")
      .order("id", { ascending: true })
      .abortSignal(AbortSignal.timeout(MNORIA_BUBBLE_QUERY_TIMEOUT_MS)));

  if (debatesError) throw debatesError;
  if (!debateRows || !debateRows.length) return [];

  const debateIds = debateRows.map((d) => d.id);
  const sharedDebateIds = [...new Set(debateIds.map((id) => resolveSharedDebateId(id) || String(id)))];

  const { data: args, error: argsError } = await fetchAllSupabaseRowsIn(sharedDebateIds, (idsChunk) =>
    supabase
      .from("arguments")
      .select("id, debate_id, votes, created_at")
      .in("debate_id", idsChunk)
      .order("id", { ascending: true })
      .abortSignal(AbortSignal.timeout(MNORIA_BUBBLE_QUERY_TIMEOUT_MS)));

  if (argsError) throw argsError;

  const argsByDebate = new Map();
  const debateIdByArgumentId = new Map();
  for (const arg of args || []) {
    const debateKey = String(arg.debate_id || "");
    if (!argsByDebate.has(debateKey)) argsByDebate.set(debateKey, []);
    argsByDebate.get(debateKey).push(arg);
    debateIdByArgumentId.set(String(arg.id), debateKey);
  }

  const argumentIds = (args || []).map((arg) => arg.id);
  const cutoff48h = now - 48 * 60 * 60 * 1000;
  const cutoff96h = now - 96 * 60 * 60 * 1000;
  const cutoffDecay = now - MNORIA_BUBBLE_DECAY_CUTOFF_MS;

  const comment48hCountByDebate = new Map();
  const commentPrev48hCountByDebate = new Map();
  const vote48hCountByDebate = new Map();
  const votePrev48hCountByDebate = new Map();
  const commentDecayByDebate = new Map();
  const voteDecayByDebate = new Map();

  if (argumentIds.length) {
    // Indépendantes l'une de l'autre : lancées en parallèle plutôt qu'en
    // série pour ne pas cumuler deux allers-retours réseau.
    const [{ data: comments, error: commentsError }, { data: recentVotes, error: recentVotesError }] = await Promise.all([
      fetchAllSupabaseRowsIn(argumentIds, (idsChunk) =>
        supabase
          .from("comments")
          .select("argument_id, created_at")
          .in("argument_id", idsChunk)
          .order("id", { ascending: true })
          .abortSignal(AbortSignal.timeout(MNORIA_BUBBLE_QUERY_TIMEOUT_MS))),
      fetchAllSupabaseRows(() =>
        supabase
          .from("votes")
          .select("argument_id, vote_count, created_at")
          .gte("created_at", new Date(cutoffDecay).toISOString())
          .order("id", { ascending: true })
          .abortSignal(AbortSignal.timeout(MNORIA_BUBBLE_QUERY_TIMEOUT_MS)))
    ]);

    if (commentsError) throw commentsError;
    if (recentVotesError) throw recentVotesError;

    for (const comment of comments || []) {
      const debateId = debateIdByArgumentId.get(String(comment.argument_id));
      if (!debateId || !comment.created_at) continue;
      commentDecayByDebate.set(debateId, Number(commentDecayByDebate.get(debateId) || 0) + mnoriaBubbleDecayWeight(comment.created_at, now));

      const commentTime = new Date(comment.created_at).getTime();
      if (commentTime > cutoff48h) comment48hCountByDebate.set(debateId, Number(comment48hCountByDebate.get(debateId) || 0) + 1);
      else if (commentTime > cutoff96h) commentPrev48hCountByDebate.set(debateId, Number(commentPrev48hCountByDebate.get(debateId) || 0) + 1);
    }

    for (const vote of recentVotes || []) {
      const debateId = debateIdByArgumentId.get(String(vote.argument_id));
      if (!debateId || !vote.created_at) continue;
      const voteWeight = Math.max(1, Number(vote.vote_count) || 1);
      voteDecayByDebate.set(debateId, Number(voteDecayByDebate.get(debateId) || 0) + voteWeight * mnoriaBubbleDecayWeight(vote.created_at, now));

      const voteTime = new Date(vote.created_at).getTime();
      if (voteTime > cutoff48h) {
        vote48hCountByDebate.set(debateId, Number(vote48hCountByDebate.get(debateId) || 0) + voteWeight);
      } else if (voteTime > cutoff96h) {
        votePrev48hCountByDebate.set(debateId, Number(votePrev48hCountByDebate.get(debateId) || 0) + voteWeight);
      }
    }
  }

  const activityScore = (ideas, comments, votes) =>
    Number(ideas || 0) * 1 + Number(comments || 0) * 0.5 + Number(votes || 0) * 0.2;

  const items = debateRows.map((debate) => {
    const sharedDebateId = resolveSharedDebateId(debate.id) || String(debate.id);
    const debateArgs = argsByDebate.get(sharedDebateId) || [];
    const argument_count_48h = debateArgs.filter((a) => a.created_at && new Date(a.created_at).getTime() > cutoff48h).length;
    const argument_count_prev48h = debateArgs.filter((a) => {
      if (!a.created_at) return false;
      const t = new Date(a.created_at).getTime();
      return t > cutoff96h && t <= cutoff48h;
    }).length;
    const argumentDecay = debateArgs.reduce((sum, a) => sum + mnoriaBubbleDecayWeight(a.created_at, now), 0);

    return {
      debate,
      decayedScore: activityScore(argumentDecay, commentDecayByDebate.get(sharedDebateId), voteDecayByDebate.get(sharedDebateId)),
      score48h: activityScore(argument_count_48h, comment48hCountByDebate.get(sharedDebateId), vote48hCountByDebate.get(sharedDebateId)),
      scorePrev48h: activityScore(argument_count_prev48h, commentPrev48hCountByDebate.get(sharedDebateId), votePrev48hCountByDebate.get(sharedDebateId))
    };
  });

  const selected = items
    .filter((item) => item.decayedScore > 0)
    .sort((a, b) => b.decayedScore - a.decayedScore)
    .slice(0, 10);

  const maxDecayedScore = selected.reduce((max, item) => Math.max(max, item.decayedScore), 0);

  // Tendance = évolution de l'activité des dernières 48h par rapport aux 48h précédentes (48h-96h).
  const computeTrend = (current, previous) => {
    if (!previous && !current) return 0;
    if (!previous) return 100;
    return Math.round(((current - previous) / previous) * 100);
  };

  const bubbles = selected
    .map((item) => ({
      tag: getMnoriaBubbleLabel(item.debate),
      subjectId: String(item.debate.id),
      count: item.decayedScore,
      sizeWeight: maxDecayedScore > 0 ? item.decayedScore / maxDecayedScore : 0,
      trend: computeTrend(item.score48h, item.scorePrev48h)
    }))
    .filter((item) => item.tag);

  mnoriaBubbleTrendsCache = { value: bubbles, expiresAt: Date.now() + MNORIA_BUBBLE_TRENDS_CACHE_TTL_MS };
  return bubbles;
}

async function getMnoriaBubbleTrends() {
  if (mnoriaBubbleTrendsCache && Date.now() < mnoriaBubbleTrendsCache.expiresAt) {
    return mnoriaBubbleTrendsCache.value;
  }
  if (!mnoriaBubbleTrendsInFlight) {
    mnoriaBubbleTrendsInFlight = computeMnoriaBubbleTrends().finally(() => {
      mnoriaBubbleTrendsInFlight = null;
    });
  }
  // Stale-while-revalidate (13/08/2026) : computeMnoriaBubbleTrends mesuré à
  // ~5,4s à froid (4 lectures Supabase en partie séquentielles) — plus long
  // que le timeout de 5s côté client (fetchMnoriaBubbleTrends, public/script.js),
  // qui abandonnait alors et retombait sur buildFallbackMnoriaBubbleTrends
  // (ce repli n'utilise désormais lui aussi que cloud_label/keywords, jamais
  // le titre du débat). Dès qu'une valeur existe (même expirée), on la
  // sert immédiatement pendant que le recalcul tourne en arrière-plan — seul
  // le tout premier appel depuis le démarrage du serveur attend le calcul
  // complet.
  if (mnoriaBubbleTrendsCache) {
    mnoriaBubbleTrendsInFlight.catch(() => {});
    return mnoriaBubbleTrendsCache.value;
  }
  return mnoriaBubbleTrendsInFlight;
}

app.get("/api/mnoria-bubbles", async (req, res) => {
  try {
    const bubbles = await getMnoriaBubbleTrends();
    res.json({ bubbles });
  } catch (error) {
    console.error(error);
    res.json({ bubbles: [] });
  }
});

app.get("/api/cloud-bubbles", async (req, res) => {
  try {
    const data = await loadCloudBubbles();
    res.json({ ok: true, bubbles: data.bubbles || [], lastUpdatedAt: data.lastUpdatedAt || null });
  } catch {
    res.json({ ok: true, bubbles: [], lastUpdatedAt: null });
  }
});

// Nuages dédiés gauche/droite (veille mixte) — même format de réponse que /api/cloud-bubbles,
// jamais mélangés avec le pool général ni avec le nuage communautaire (Bulles Mnoria).
app.get("/api/cloud-bubbles-left", async (req, res) => {
  try {
    const data = await loadCloudBubbles("cloud_bubbles_left");
    res.json({ ok: true, bubbles: data.bubbles || [], lastUpdatedAt: data.lastUpdatedAt || null });
  } catch {
    res.json({ ok: true, bubbles: [], lastUpdatedAt: null });
  }
});

app.get("/api/cloud-bubbles-right", async (req, res) => {
  try {
    const data = await loadCloudBubbles("cloud_bubbles_right");
    res.json({ ok: true, bubbles: data.bubbles || [], lastUpdatedAt: data.lastUpdatedAt || null });
  } catch {
    res.json({ ok: true, bubbles: [], lastUpdatedAt: null });
  }
});

app.post("/api/admin/update-cloud", requireAdmin, express.json(), async (req, res) => {
  try {
    const result = await rebuildCloudBubblesForGroup("mixed");
    const [leftResult, rightResult] = await Promise.all([
      rebuildCloudBubblesForGroup("left").catch((e) => ({ ok: false, error: e.message, count: 0 })),
      rebuildCloudBubblesForGroup("right").catch((e) => ({ ok: false, error: e.message, count: 0 }))
    ]);
    // Réponse additive : "count" reste celui du pool général (comportement actuel du
    // bouton admin inchangé), leftCount/rightCount sont de nouvelles infos en plus.
    res.json({ ...result, leftCount: leftResult.count || 0, rightCount: rightResult.count || 0 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/admin/link-supersession", requireAdmin, express.json(), async (req, res) => {
  const { newDebateId, oldDebateId } = req.body || {};
  if (!newDebateId || !oldDebateId) {
    return res.status(400).json({ ok: false, error: "newDebateId et oldDebateId requis" });
  }
  const newId = String(newDebateId).trim();
  const oldId = String(oldDebateId).trim();
  if (newId === oldId) return res.status(400).json({ ok: false, error: "Les deux IDs sont identiques" });

  const { data: debates, error } = await supabase
    .from("debates")
    .select("id, source_url, media_extras, political_group")
    .in("id", [Number(newId), Number(oldId)]);
  if (error) return res.status(500).json({ ok: false, error: error.message });

  const newDebate = (debates || []).find(d => String(d.id) === newId);
  const oldDebate = (debates || []).find(d => String(d.id) === oldId);
  if (!newDebate) return res.status(404).json({ ok: false, error: `Débat ${newId} introuvable` });
  if (!oldDebate) return res.status(404).json({ ok: false, error: `Débat ${oldId} introuvable` });

  const currentSourceCount = countCloudSources(newDebate);
  const previousSourceCount = countCloudSources(oldDebate);

  let trend = 0;
  if (previousSourceCount === 0 && currentSourceCount > 0) trend = 100;
  else if (previousSourceCount > 0) trend = Math.round(((currentSourceCount - previousSourceCount) / previousSourceCount) * 100);

  setDebateTrend(newId, {
    trend,
    sourceCount: currentSourceCount,
    matchedSubjectId: oldId,
    previousSourceCount,
    reason: "lien manuel admin"
  });

  // Sans ce 3e argument, rebuildCloudBubblesAfterPublish retombait sur son défaut
  // ("mixed") : un lien manuel entre deux arènes gauche/droite mettait bien à jour
  // le trend, mais le nuage gauche/droite affiché restait sur l'ancien doublon
  // jusqu'à un recalcul complet fortuit (cf. incident nuages Le Pen/Iran du 9 juillet).
  const politicalGroup = newDebate.political_group || "mixed";
  const rebuildResult = await rebuildCloudBubblesAfterPublish("link-supersession", newId, politicalGroup);
  res.json({ ok: true, trend, currentSourceCount, previousSourceCount, politicalGroup, rebuildResult });
});

app.get("/admin/veille", (req, res) => {
  res.sendFile(path.join(__dirname, "views/admin-veille.html"));
});

app.get("/api/admin/veille", requireAdmin, async (req, res) => {
  res.json(await loadVeillePending());
});

app.post("/api/admin/veille/proofread", requireAdmin, rateLimit("admin-ai", 10), async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "OPENAI_API_KEY manquant." });
  }

  const question = String(req.body?.question || "").trim().slice(0, 110);
  const positionA = String(req.body?.positionA || "").trim();
  const positionB = String(req.body?.positionB || "").trim();
  const resume = String(req.body?.resume || "").trim().slice(0, 1800);
  const keywords = Array.isArray(req.body?.keywords) ? req.body.keywords.map((k) => String(k || "").trim()).filter(Boolean).slice(0, 10) : [];

  if (!question && !positionA && !positionB && !resume) {
    return res.status(400).json({ error: "Aucun texte à corriger." });
  }

  const prompt = [
    "Tu corriges uniquement les fautes d'orthographe, de grammaire, de conjugaison, d'accord, de typographie et de ponctuation.",
    "Interdiction absolue de changer le sens, l'angle, la position politique, le niveau de nuance ou le contenu factuel.",
    "Tu peux reformuler très légèrement seulement si c'est indispensable pour corriger une faute ou rendre une phrase grammaticalement correcte.",
    "Pour les tags : corrige les fautes de frappe, la casse (majuscule en début de mot si pertinent), et normalise au singulier (ex: 'Migrants' → 'Migrant', 'Réformes' → 'Réforme', 'Élections' → 'Élection'). Ne change pas le sens ni n'ajoute de nouveaux tags.",
    'Réponds uniquement en JSON sous la forme {"question":"...","positionA":"...","positionB":"...","resume":"...","keywords":[...]}.',
    '',
    'Question : ' + question,
    'Position A : ' + positionA,
    'Position B : ' + positionB,
    'Résumé : ' + resume,
    'Tags : ' + (keywords.length ? keywords.join(', ') : '(aucun)')
  ].join("\n");

  try {
    const requestStartedAt = Date.now();
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 2500,
        temperature: 0
      })
    });

    if (!r.ok) {
      const body = await r.text().catch(() => '');
      recordAiUsage(supabase, { feature: 'admin_text_correction', model: 'gpt-4o-mini', latencyMs: Date.now() - requestStartedAt, success: false, error: body || 'Erreur OpenAI.' });
      return res.status(502).json({ error: body || 'Erreur OpenAI.' });
    }

    const data = await r.json();
    const { inputTokens, outputTokens, cachedTokens } = extractUsage(data?.usage);
    recordAiUsage(supabase, { feature: 'admin_text_correction', model: 'gpt-4o-mini', inputTokens, outputTokens, cachedTokens, latencyMs: Date.now() - requestStartedAt, success: true });
    const content = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
    if (!content) {
      return res.status(502).json({ error: 'Réponse vide du correcteur.' });
    }

    let parsed = {};
    try { parsed = JSON.parse(content); } catch (_) { parsed = {}; }
    const correctedKeywords = Array.isArray(parsed?.keywords)
      ? parsed.keywords.map((k) => String(k || "").trim()).filter(Boolean).slice(0, 10)
      : keywords;
    return res.json({
      ok: true,
      question: String(parsed?.question || question).trim().slice(0, 110),
      positionA: String(parsed?.positionA || positionA).trim(),
      positionB: String(parsed?.positionB || positionB).trim(),
      resume: String(parsed?.resume || resume).trim().slice(0, 1800),
      keywords: correctedKeywords
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Erreur correction.' });
  }
});

app.post("/api/admin/veille/check-merge-positions", requireAdmin, rateLimit("admin-ai", 10), async (req, res) => {
  const { debateId, positionA, positionB } = req.body || {};
  if (!debateId) return res.status(400).json({ ok: false, error: 'debateId requis' });

  try {
    const { data: existing, error } = await supabase
      .from("debates")
      .select("id, question, option_a, option_b, type")
      .eq("id", debateId)
      .single();

    if (error || !existing) {
      return res.status(404).json({ ok: false, error: 'Arène cible introuvable.' });
    }

    const result = await evaluateVeilleMergeAlignment(existing, { positionA, positionB });
    return res.status(result.ok ? 200 : 400).json({ ok: result.ok, ...result, existing });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/admin/veille/:id", requireAdmin, async (req, res) => {
  try {
    await deleteVeillePending(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/admin/veille/publish", requireAdmin, rateLimit("veille-publish", 30), async (req, res) => {
  const { id, question, positionA, positionB, theme, resume, links, linkedDebateId, keywords, forcePublishOnAlignmentWarning, politicalGroup } = req.body || {};
  try {
    const safeQuestion = String(question || "").trim().slice(0, 110);
    let pendingRow = null;
    if (id) {
      const { data: pr, error: pendingError } = await supabase
        .from("veille_pending")
        .select("*")
        .eq("id", Number(id))
        .maybeSingle();
      if (pendingError) throw new Error(pendingError.message);
      pendingRow = pr;
      // Garde-fou anti-doublon : si la ligne d'attente n'existe plus, c'est qu'elle a déjà
      // été publiée (ou supprimée) par un autre passage — republier créerait un débat en
      // double qui retomberait silencieusement dans le groupe "mixed" (général).
      if (!pendingRow) {
        return res.status(409).json({ ok: false, error: "Sujet introuvable dans la liste d'attente : déjà publié ou supprimé.", alreadyPublished: true });
      }
    }
    const pendingResume = String(pendingRow?.resume || "").trim();
    let pendingPoliticalOrientation = pendingRow?.political_orientation || null;
    const rawPublishPoliticalGroup = politicalGroup || pendingRow?.political_group;
    const resolvedPoliticalGroup = (rawPublishPoliticalGroup === "left" || rawPublishPoliticalGroup === "right") ? rawPublishPoliticalGroup : "mixed";

    // Garde anti-doublon intra-groupe : un même sujet peut exister en variante
    // générale/gauche/droite (une par groupe), mais jamais deux fois dans le même
    // groupe. Couvre les publications faites hors pipeline bot (bouton admin, crash
    // du bot avant écriture de son historique sent-to-mnoria) que la dédup côté bot ne
    // voit pas — cf. doublons 1237/1255 (left) et 1220/1221 (mixed) du 03/07/2026.
    // Comparaison déterministe (question normalisée), aucun appel IA.
    const normalizedPublishQuestion = normalizeQuestionForMergeComparison(safeQuestion);
    if (normalizedPublishQuestion) {
      const dupCutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recentDebatesForDupCheck, error: dupCheckError } = await supabase
        .from("debates")
        .select("id, question, political_group")
        .gte("created_at", dupCutoffIso)
        .order("created_at", { ascending: false })
        .limit(300);
      if (dupCheckError) {
        console.warn(`[veille publish] vérification anti-doublon impossible (${dupCheckError.message}) : publication autorisée.`);
      } else {
        const sameGroupDuplicate = (recentDebatesForDupCheck || []).find((d) =>
          ((d.political_group === "left" || d.political_group === "right") ? d.political_group : "mixed") === resolvedPoliticalGroup &&
          normalizeQuestionForMergeComparison(d.question) === normalizedPublishQuestion
        );
        if (sameGroupDuplicate) {
          if (id) await deleteVeillePending(Number(id));
          console.warn(`[veille publish] doublon refusé : l'arène ${sameGroupDuplicate.id} (${resolvedPoliticalGroup}) pose déjà la même question — "${safeQuestion.slice(0, 80)}"`);
          return res.status(409).json({
            ok: false,
            error: `Doublon : l'arène ${sameGroupDuplicate.id} pose déjà la même question dans le groupe ${resolvedPoliticalGroup} (fenêtre 24h).`,
            alreadyPublished: true,
            duplicateOfDebateId: sameGroupDuplicate.id
          });
        }
      }
    }

    const linksMeta = Array.isArray(links) ? links : [];
    const firstLink = linksMeta[0] || null;
    const sourceUrl = firstLink ? (typeof firstLink === "string" ? firstLink : firstLink.url) : null;
    const nowIsoExtras = new Date().toISOString();
    const allExtras = linksMeta.map(l => ({
      type: "source",
      url: typeof l === "string" ? l : (l.url || ""),
      title: typeof l === "object" ? (l.title || "") : "",
      source: typeof l === "object" ? (l.source || "") : "",
      date: typeof l === "object" ? (l.date || "") : "",
      added_at: nowIsoExtras
    })).filter(e => e.url);

    // Un sujet sans aucune source de son camp n'a pas sa place dans le nuage
    // gauche/droite : publication refusée, le sujet reste en attente pour être
    // corrigé (autre groupe ou autres sources).
    if (resolvedPoliticalGroup !== "mixed") {
      if (veilleMediasCacheIsStale()) await _loadVeilleMediasFromSupabase();
      const campSourceCount = countCloudSourcesForGroup(
        { media_extras: allExtras, source_url: sourceUrl },
        resolvedPoliticalGroup,
        buildCloudMediaOrientationMaps()
      );
      if (campSourceCount <= 0) {
        const campLabel = resolvedPoliticalGroup === "left" ? "de gauche" : "de droite";
        console.warn(`[veille publish] refus ${resolvedPoliticalGroup} : aucune source ${campLabel} — "${safeQuestion.slice(0, 80)}"`);
        return res.status(400).json({
          ok: false,
          error: `Aucune source ${campLabel} parmi les liens cochés : ce sujet ne peut pas être publié dans le nuage ${resolvedPoliticalGroup === "left" ? "Gauche" : "Droite"}.`
        });
      }
    }
    let normalizedPositionA = String(positionA || "").trim();
    let normalizedPositionB = String(positionB || "").trim();
    const debateType = inferVeilleDebateType(normalizedPositionA, normalizedPositionB);
    const requestedLinkedDebateId = String(linkedDebateId || pendingRow?.pending_linked_debate_id || "").trim();
    let canonicalLinkedDebateId = requestedLinkedDebateId ? resolveSharedDebateId(requestedLinkedDebateId) : "";
    const pendingStorySelection = normalizeStorySelection(req.body?.storySelection || pendingRow?.pending_story_selection);
    const resolvedContent = normalizeDebateContent(String(resume || "").trim() || pendingResume || String(question || "").trim());
    const resolvedKeywords = normalizeKeywordList(Array.isArray(keywords) ? keywords : (pendingRow?.pending_keywords || []));

    if (!String(resume || "").trim() && pendingResume) {
      console.warn(`[veille publish] resume manquant dans la requete, fallback sur veille_pending pour ${id}.`);
    }
    if (!String(resume || "").trim() && !pendingResume) {
      console.warn(`[veille publish] aucun resume trouve pour ${id}, fallback sur la question.`);
    }

    if (canonicalLinkedDebateId) {
      const { data: existingLinkedDebate, error: linkedError } = await supabase
        .from("debates")
        .select("id, question, option_a, option_b, type")
        .eq("id", canonicalLinkedDebateId)
        .maybeSingle();

      if (linkedError) throw new Error(linkedError.message);
      if (!existingLinkedDebate) {
        return res.status(404).json({ ok: false, error: "Arène partagée introuvable." });
      }

      // Garde-fou : les deux questions doivent poser le même débat. En cas de refus,
      // on ne bloque pas la publication (le pipeline auto n'a pas de relecture humaine) :
      // l'arène est simplement publiée indépendante, sans fusion.
      const sameDebate = await confirmSameDebateQuestionForMerge(safeQuestion, existingLinkedDebate.question, "veille-merge");
      if (!sameDebate) {
        console.warn(`[veille publish] fusion refusée (questions différentes) avec l'arène ${canonicalLinkedDebateId} : "${safeQuestion.slice(0, 60)}" vs "${String(existingLinkedDebate.question || "").slice(0, 60)}" → publication indépendante`);
        canonicalLinkedDebateId = "";
      } else {
        const existingType = inferVeilleDebateType(existingLinkedDebate.option_a, existingLinkedDebate.option_b);
        if (existingType !== debateType) {
          return res.status(400).json({
            ok: false,
            error: existingType === "open"
              ? "Fusion impossible : tu ne peux pas rattacher une arène à positions à une arène libre."
              : "Fusion impossible : tu ne peux pas rattacher une arène libre à une arène à positions."
          });
        }

        const alignment = await evaluateVeilleMergeAlignment(existingLinkedDebate, {
          positionA: normalizedPositionA,
          positionB: normalizedPositionB,
          question: safeQuestion
        });
        if (alignment.verdict === "inverted") {
          // Permute les positions (et l'étiquette gauche/droite associée) pour qu'elles
          // correspondent au sens de l'arène existante, au lieu de bloquer la fusion.
          [normalizedPositionA, normalizedPositionB] = [normalizedPositionB, normalizedPositionA];
          if (pendingPoliticalOrientation && pendingPoliticalOrientation.isPolitical) {
            pendingPoliticalOrientation = {
              ...pendingPoliticalOrientation,
              positionA: pendingPoliticalOrientation.positionB,
              positionB: pendingPoliticalOrientation.positionA
            };
          }
        } else if (!alignment.ok && !(forcePublishOnAlignmentWarning && alignment.verdict === "ambiguous")) {
          return res.status(400).json({ ok: false, error: alignment.message, verdict: alignment.verdict });
        }
      }
    }

    const newDebateRow = {
      question: safeQuestion,
      option_a: debateType === "open" ? "" : normalizedPositionA,
      option_b: debateType === "open" ? "" : normalizedPositionB,
      category: theme || null,
      content: resolvedContent,
      source_url: sourceUrl,
      type: debateType,
      creator_key: MNORIA_ADMIN_CREATOR_KEY,
      created_at: nowIso(),
      political_orientation: pendingPoliticalOrientation || null,
      political_group: resolvedPoliticalGroup
    };
    let { data, error } = await supabase.from("debates").insert(newDebateRow).select("id").single();
    if (error) {
      console.error("[veille publish] insert error", {
        pendingId: id ? Number(id) : null,
        linkedDebateId: canonicalLinkedDebateId || null,
        resolvedContentLength: resolvedContent.length,
        errorMessage: error.message,
        errorDetails: error.details || "",
        errorHint: error.hint || ""
      });
      throw new Error(error.message);
    }
    recordNewlyPublishedDebateInSimilarityCache({
      id: data.id,
      question: newDebateRow.question,
      option_a: newDebateRow.option_a,
      option_b: newDebateRow.option_b,
      type: newDebateRow.type,
      content: newDebateRow.content,
      created_at: newDebateRow.created_at
    }, "veille publish");

    if (allExtras.length) {
      await supabase.from("debates").update({ media_extras: allExtras }).eq("id", data.id);
    }
    await setDebateKeywords(data.id, resolvedKeywords);

    assignDebateCloudLabel(data.id, {
      question: safeQuestion,
      content: resolvedContent,
      optionA: debateType === "open" ? "" : normalizedPositionA,
      optionB: debateType === "open" ? "" : normalizedPositionB,
      category: theme || "",
      type: debateType
    });



// Calcul du badge de tendance au moment de la publication
// Logique : comparer le nombre de sources distinctes du nouveau débat
// avec le nombre de sources distinctes du dernier débat publié ayant un thème similaire.
try {
const currentSourceKeys = new Set(
  (allExtras || [])
    .filter((e) => e && typeof e === "object" && String(e.type || "source").trim() === "source")
    .map((e) => String(e.url || e.source_url || e.source || e.media || e.publisher || "").trim().toLowerCase())
    .filter(Boolean)
);

if (!currentSourceKeys.size && sourceUrl) {
  currentSourceKeys.add(String(sourceUrl).trim().toLowerCase());
}

const currentSourceCount = currentSourceKeys.size;
  console.log(`[trend] nouveau sujet id=${data.id} currentSourceCount=${currentSourceCount}`);

  const matchCutoff = Date.now() - MIN_TREND_MATCH_GAP_MS;
  const { data: recentRows } = await supabase
    .from("debates")
    .select("id, question, content, source_url, media_extras, created_at, keywords")
    .neq("id", data.id)
    .lte("created_at", new Date(matchCutoff).toISOString())
    .order("created_at", { ascending: false })
    .limit(TREND_RECENT_SUBJECTS_LIMIT);

  const recentSubjects = (recentRows || [])
    .map((d) => {
    const extras = Array.isArray(d.media_extras) ? d.media_extras : [];
    const srcExtras = extras.filter((e) => e && typeof e === "object" &&
      String(e.type || "source").trim() === "source" &&
      (e.url || e.source_url || e.source || e.media || e.publisher));

   const previousSourceKeys = new Set(
  srcExtras
    .map((e) => String(e.url || e.source_url || e.source || e.media || e.publisher || "").trim().toLowerCase())
    .filter(Boolean)
);

if (!previousSourceKeys.size && d.source_url) {
  previousSourceKeys.add(String(d.source_url).trim().toLowerCase());
}

const previousSourceCount = previousSourceKeys.size;

    return {
      id: String(d.id),
      question: String(d.question || ""),
      resume: String(d.content || "").slice(0, 200),
      tags: normalizeKeywordList(d.keywords || [], 10, 60),
      sourceCount: previousSourceCount,
      created_at: d.created_at
    };
  });

  console.log(`[trend] recherche du dernier sujet similaire parmi ${recentSubjects.length} publications récentes`);

  const newSubject = {
    id: String(data.id),
    question: String(question || ""),
    resume: String(resolvedContent || "").slice(0, 200),
    tags: resolvedKeywords,
    sourceCount: currentSourceCount
  };

  const matched = await findSimilarRecentSubjectForTrend(newSubject, recentSubjects);

  let computedTrend = 0;
  let trendEntry;

  if (!matched) {
    console.log(`[trend] aucun sujet similaire trouvé → trend=0`);
    trendEntry = {
      trend: 0,
      sourceCount: currentSourceCount,
      matchedSubjectId: null
    };
  } else {
    const previousSourceCount = matched.sourceCount || 0;
    console.log(`[trend] dernier sujet similaire id=${matched.id} previousSourceCount=${previousSourceCount} confidence=${matched.confidence}`);

    if (previousSourceCount === 0 && currentSourceCount === 0) {
      computedTrend = 0;
    } else if (previousSourceCount === 0) {
      computedTrend = 100;
    } else {
      computedTrend = Math.round(((currentSourceCount - previousSourceCount) / previousSourceCount) * 100);
    }

    console.log(`[trend] tendance calculée = ${computedTrend}%`);
    trendEntry = {
      trend: computedTrend,
      sourceCount: currentSourceCount,
      matchedSubjectId: matched.id,
      matchedSubjectIds: Array.isArray(matched.matchedIds) && matched.matchedIds.length ? matched.matchedIds : [String(matched.id)],
      matchedSubjectTitle: matched.question,
      previousSourceCount,
      reason: matched.reason || ""
    };
  }

  setDebateTrend(data.id, trendEntry);
} catch (trendErr) {
  console.error("[trend] erreur calcul tendance (non bloquant) :", trendErr.message);
}

    if (canonicalLinkedDebateId) {
      linkDebateToSharedSpace(data.id, canonicalLinkedDebateId);
    } else {
      removeDebateSharedLink(data.id);
    }
    if (pendingStorySelection) {
      const finalStory = await saveStoryForDebateSelection(pendingStorySelection, {
        debateId: data.id,
        question,
        resume
      });
      if (finalStory?.story_id) {
        await setDebateStoryId(data.id, finalStory.story_id);
        await recalculateStoryEpisodeNavigation(finalStory.story_id);
      }
    }
    if (sourceUrl) {
      try { await getExternalLinkPreview(sourceUrl); } catch {}
    }
    if (id) await deleteVeillePending(Number(id));
    invalidateSharedDebateCaches(canonicalLinkedDebateId || data.id);
    await rebuildCloudBubblesAfterPublish("veille-publish", data.id, resolvedPoliticalGroup);
    res.json({ ok: true, debateId: data.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/admin/veille/merge", requireAdmin, rateLimit("veille-publish", 30), async (req, res) => {
  const { id, debateId, question, positionA, positionB, resume, links } = req.body || {};
  if (!id || !debateId) return res.status(400).json({ ok: false, error: "id et debateId requis" });
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from("debates")
      .select("id,question,type,option_a,option_b")
      .eq("id", debateId)
      .single();
    if (fetchErr) throw new Error(fetchErr.message);

    const normalizedPositionA = positionA === undefined ? undefined : String(positionA || "").trim();
    const normalizedPositionB = positionB === undefined ? undefined : String(positionB || "").trim();
    const inferredType = inferVeilleDebateType(normalizedPositionA, normalizedPositionB);
    const existingType = inferVeilleDebateType(existing.option_a, existing.option_b);

    if (existingType !== inferredType) {
      return res.status(400).json({
        ok: false,
        error: existingType === "open"
          ? "Fusion impossible : tu ne peux pas fusionner une arène à positions avec une arène libre."
          : "Fusion impossible : tu ne peux pas fusionner une arène libre avec une arène à positions."
      });
    }

    const alignment = await evaluateVeilleMergeAlignment(existing, {
      positionA: normalizedPositionA,
      positionB: normalizedPositionB
    });
    // "inverted" ne bloque plus la fusion : la position A de la nouvelle arène correspond
    // à la position B de l'existante (et inversement), donc on permute au lieu d'annuler —
    // le swap effectif a lieu à la publication (/api/admin/veille/publish), seul endroit où
    // les positions sont réellement écrites en base.
    if (!alignment.ok && alignment.verdict !== "inverted") {
      return res.status(400).json({ ok: false, error: alignment.message, verdict: alignment.verdict });
    }

    setVeillePendingLinkedDebate(id, debateId);
    res.json({
      ok: true,
      verdict: alignment.verdict,
      debateId: resolveSharedDebateId(debateId) || String(debateId),
      message: alignment.verdict === "inverted"
        ? "Positions inversées par rapport à l'arène existante : elles seront permutées automatiquement à la publication."
        : "Le debat partage est selectionne. Les cartes resteront separees jusqu'a la publication."
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================================================================= */

/* --- Analyse IA d'un débat ---------------------------------------- */

// Lecture publique du rapport stocké
app.get("/api/debates/:id/analysis", rateLimit("analysis-read", 240), async (req, res) => {
  const { id } = req.params;
  // Arènes fusionnées (admin "Sujets en attente") : l'analyse n'existe que sur
  // l'arène canonique — on la relit depuis là, quelle que soit l'arène visitée.
  const canonicalId = resolveSharedDebateId(id) || String(id);
  const clientKey = getRequestClientKey(req);
  const { data, error } = await supabase
    .from("debates")
    .select("ai_analysis, ai_analysis_status, ai_analysis_scheduled_at, ai_analysis_generated_at, ai_analysis_last_score, popularity_analysis, evaluation_axis_hidden, evaluation_axis, type, creator_key")
    .eq("id", canonicalId)
    .single();
  if (error || !data) {
    console.error("[analysis GET]", id, error?.message || "no data");
    return res.status(404).json({ error: error?.message || "Débat introuvable." });
  }
  const fullAnalysis = data.ai_analysis || null;
  let raw = extractAnalysisScoringRaw(fullAnalysis);
  // Barème caché par le créateur : le détail (orientation + règles dérivées)
  // ne doit fuiter ni vers les autres visiteurs ni vers le rapport IA public —
  // seul le créateur peut le consulter (cf. sanitizeDebateForClient).
  const isOwner = !!(clientKey && data.creator_key && String(data.creator_key) === clientKey)
    || !!(isAdmin(req) && data.creator_key === MNORIA_ADMIN_CREATOR_KEY);
  // Notes faible/moyen masquées pour tout le monde sauf admin/créateur (cf.
  // canViewerSeeHiddenScores) — volontairement une condition d'accès plus large que
  // isOwner ci-dessus (admin voit TOUJOURS, même sur l'arène d'un autre utilisateur ;
  // isOwner ne le permet que sur les arènes créées par l'admin lui-même, propre à la
  // fonctionnalité barème caché).
  const canSeeHiddenScores = canViewerSeeHiddenScores(req, data.creator_key, clientKey);
  if (raw && (data.evaluation_axis_hidden || !canSeeHiddenScores)) {
    try {
      const parsedRaw = JSON.parse(raw);
      let mutated = false;
      if (data.evaluation_axis_hidden && !isOwner && parsedRaw?.scoringGrid?.scoringMode === "custom") {
        parsedRaw.scoringGrid = { ...parsedRaw.scoringGrid, axisSource: "", customRubric: "", axisHidden: true };
        mutated = true;
      }
      if (!canSeeHiddenScores && parsedRaw?.camps) {
        for (const campKey of ["A", "B"]) {
          const list = parsedRaw.camps[campKey]?.effectiveArguments;
          if (Array.isArray(list)) {
            parsedRaw.camps[campKey].effectiveArguments = list.map(redactHiddenScoreEntry);
            mutated = true;
          }
        }
      }
      if (mutated) raw = JSON.stringify(parsedRaw);
    } catch (_) {}
  }
  const status = data.ai_analysis_status || "none";
  let contributionsRemaining = null;
  let scoringGrid = null;
  // Hors compte à rebours déjà programmé : on indique combien de contributions
  // (arguments + commentaires) manquent encore avant le prochain déclenchement.
  if (status !== "scheduled" && status !== "generating") {
    const hasExisting = !!data.ai_analysis;
    const threshold = hasExisting ? Number(data.ai_analysis_last_score || 0) + 5 : 10;
    // Si cette arène est fusionnée avec d'autres, le score compte les
    // contributions cumulées de toutes les arènes liées (même seuil partagé).
    const groupIds = getDebateIdsInSharedSpace(canonicalId);
    const scoreScope = groupIds.length > 1 ? groupIds : null;
    const { score } = await _computeAnalysisScore(canonicalId, scoreScope);
    let effectiveLastScore = Number(data.ai_analysis_last_score || 0);

    // Ancien cas limite : si des contributions arrivaient pendant qu'une analyse
    // était déjà programmée, le rapport généré les couvrait, mais le score de
    // référence restait celui du déclenchement initial. Le compteur tombait alors
    // à 0 juste après publication au lieu de repartir vers le prochain seuil.
    if (hasExisting && status === "ready" && data.ai_analysis_generated_at) {
      const { score: generatedScore } = await _computeAnalysisScore(canonicalId, scoreScope, {
        untilIso: data.ai_analysis_generated_at
      });
      if (Number.isFinite(generatedScore) && generatedScore > effectiveLastScore) {
        effectiveLastScore = generatedScore;
        supabase
          .from("debates")
          .update({ ai_analysis_last_score: generatedScore })
          .eq("id", canonicalId)
          .then(({ error: healError }) => {
            if (healError) console.error("[analysis score heal]", canonicalId, healError.message);
          });
      }
    }

    const effectiveThreshold = hasExisting ? effectiveLastScore + 5 : threshold;
    contributionsRemaining = Math.max(0, Math.ceil(effectiveThreshold - score));

    // Avant la 1re analyse, aucun barème stabilisé n'existe encore : on reconstruit
    // la config réelle (libre/personnalisé vs à position) à partir du débat lui-même,
    // pour que la modale d'explication reflète l'arène plutôt qu'un barème générique.
    if (!hasExisting) {
      const debateType = String(data.type || "").trim().toLowerCase() === "open" ? "open" : "position";
      const axisRaw = String(data.evaluation_axis || "").trim();
      const axisHidden = !!data.evaluation_axis_hidden;
      scoringGrid = (debateType === "open" && axisRaw)
        ? { type: "open", scoringMode: "custom", axisHidden, axisSource: (axisHidden && !isOwner) ? "" : axisRaw, customRubric: "" }
        : { type: debateType, scoringMode: "default" };
    }
  }

  return res.json({
    raw:                    raw,
    popularityRaw:          data.popularity_analysis || null,
    status:                 status,
    scheduledAt:            data.ai_analysis_scheduled_at || null,
    generatedAt:            data.ai_analysis_generated_at || null,
    contributionsRemaining: contributionsRemaining,
    scoringGrid:            scoringGrid
  });
});

// Construit le payload à partir de la base (pour la génération automatique).
// Quand des arènes ont été fusionnées, `debateId` est l'arène canonique
// (question/contenu présentés à l'IA) et `groupIds` couvre canonique + arènes
// fusionnées (contributions cumulées, y compris celles postées avant la fusion).
async function _fetchDebatePayload(debateId, groupIds = null) {
  const ids = (groupIds && groupIds.length) ? groupIds : [debateId];

  const debate = await getDebateById(debateId, { full: true });
  if (!debate) throw new Error("Débat introuvable.");

  const { data: args } = await supabase.from("arguments").select("*").in("debate_id", ids);
  const argIds = (args || []).map((a) => a.id);

  let comments = [];
  if (argIds.length) {
    const { data: rows } = await supabase.from("comments").select("*").in("argument_id", argIds);
    comments = rows || [];
  }

  const _extractUrl = (b) => {
    const m = String(b || "").match(/↗\s*Source\s*:\s*(https?:\/\/\S+)/i)
           || String(b || "").match(/🔗\s*Lien\s*:\s*(https?:\/\/\S+)/i);
    return m ? String(m[1]).replace(/[),.;]+$/, "").trim() : "";
  };
  const mapArg = (a) => ({
    id:          String(a.id),
    text:        (a.body || a.title || "").trim(),
    source_url:  (a.source_url || "").trim() || _extractUrl(a.body),
    votes:       Number(a.votes || 0),
    paste_ratio: Number(a.paste_ratio) || 0
  });

  // Analyse précédente (format JSON uniquement) : permet de réutiliser les
  // notes des contributions inchangées au lieu de les renoter à chaque analyse.
  let previousAnalysis = null;
  const prevRaw = String(debate.ai_analysis || "").trimStart();
  if (prevRaw.startsWith("{")) {
    try { previousAnalysis = JSON.parse(prevRaw); } catch { previousAnalysis = null; }
  }

  return {
    question:        debate.question          || "",
    positionA:       debate.option_a          || "",
    positionB:       debate.option_b          || "",
    content:         debate.content           || "",
    evaluation_axis: debate.evaluation_axis   || "",
    correction_strictness: debate.correction_strictness || "normal",
    previousAnalysis,
    argumentsA: (args || []).filter((a) => a.side === "A").map(mapArg),
    argumentsB: (args || []).filter((a) => a.side === "B").map(mapArg),
    comments:   comments.map((c) => ({ text: c.content || "", stance: c.stance || "" }))
  };
}

const { generateAnalysisJson }        = require('./lib/debate-analysis');
const { generatePopularityAnalysis }  = require('./lib/popularity-analysis');

// Génère et sauvegarde l'analyse (utilisé par le scheduler et la route admin).
// Toujours écrite sur l'arène canonique uniquement (cf. _scheduleAnalysisIfNeeded) :
// les arènes fusionnées la relisent via resolveSharedDebateId, pas de duplication.
function _extractTextFromHtml(html) {
  // Supprimer scripts, styles, balises, puis décoder les entités HTML
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  // ~8000 caractères : la vérification factuelle (PROMPT3) doit pouvoir
  // retrouver un chiffre ou un passage précis dans des documents longs
  // (exposés des motifs, rapports) — à 2500 le fait cherché était souvent
  // au-delà de la coupe (cf. source Sénat de l'arène 1990, 19/07/2026).
  return text.length > 8000 ? text.slice(0, 8000) + '…' : text;
}

function _isJsChallengePage(text) {
  if (!text || text.length < 100) return true;
  const lower = text.toLowerCase();
  return lower.includes('enable javascript') ||
         lower.includes('just a moment') ||
         lower.includes('checking your browser') ||
         lower.includes('security verification') ||
         lower.includes('cf-browser-verification') ||
         (lower.includes('please wait') && lower.includes('cloudflare'));
}

async function _fetchViaJina(url) {
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const headers = { 'Accept': 'text/plain', 'User-Agent': 'Mozilla/5.0' };
      // Sans clé, r.jina.ai est fortement rate-limité par IP — depuis Render
      // (IP partagée) les échecs silencieux étaient probables. La clé est
      // optionnelle : poser JINA_API_KEY dans l'environnement pour fiabiliser.
      if (process.env.JINA_API_KEY) headers['Authorization'] = `Bearer ${process.env.JINA_API_KEY}`;
      const resp = await fetch(jinaUrl, { headers, signal: controller.signal });
      if (!resp.ok) {
        console.warn(`[source-fetch] Jina HTTP ${resp.status} pour ${url.slice(0, 90)}`);
        return null;
      }
      const text = (await resp.text()).trim();
      // Jina retourne du Markdown — on filtre les lignes d'en-tête/navigation parasites
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      const meaningful = lines.slice(3).join(' ').replace(/\s+/g, ' ').trim();
      return meaningful.length > 50 ? meaningful.slice(0, 8000) : null;
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    console.warn(`[source-fetch] Jina erreur pour ${url.slice(0, 90)} :`, e.message);
    return null;
  }
}

async function _fetchSourceContent(url) {
  // Chaque étape logge son échec : les échecs silencieux rendaient le taux de
  // réussite indiagnosticable en prod (cf. source Sénat de l'arène 1990 restée
  // "url_seule" le 19/07/2026 alors que la page répond 200 hors Render).
  try {
    // 1er essai : profil navigateur standard
    const r1 = await fetchPreviewHtml(url, 10000, 'browser').catch((e) => ({ ok: false, status: `exception ${e.message}` }));
    if (r1.ok && r1.html) {
      const t1 = _extractTextFromHtml(r1.html);
      if (!_isJsChallengePage(t1) && t1.length > 20) return t1;
      console.warn(`[source-fetch] navigateur: contenu inutilisable (${t1.length} car., challenge=${_isJsChallengePage(t1)}) pour ${url.slice(0, 90)}`);
    } else {
      console.warn(`[source-fetch] navigateur: HTTP ${r1.status} pour ${url.slice(0, 90)}`);
    }
    // 2e essai : Jina Reader (gère les sites JS-rendered)
    const jina = await _fetchViaJina(url);
    if (jina && !_isJsChallengePage(jina)) return jina;
    // 3e essai : Googlebot
    const r3 = await fetchPreviewHtml(url, 10000, 'googlebot').catch((e) => ({ ok: false, status: `exception ${e.message}` }));
    if (r3.ok && r3.html) {
      const t3 = _extractTextFromHtml(r3.html);
      if (!_isJsChallengePage(t3) && t3.length > 20) return t3;
    } else {
      console.warn(`[source-fetch] googlebot: HTTP ${r3.status} pour ${url.slice(0, 90)}`);
    }
    // 4e essai : Wayback Machine — les pages institutionnelles y sont presque
    // toujours archivées, et archive.org ne bloque pas les IP datacenter
    // (dernier recours typique quand le site refuse l'IP de Render).
    const wb = await fetchPreviewHtml(`https://web.archive.org/web/2/${url}`, 12000, 'browser').catch((e) => ({ ok: false, status: `exception ${e.message}` }));
    if (wb.ok && wb.html) {
      const tw = _extractTextFromHtml(wb.html);
      if (!_isJsChallengePage(tw) && tw.length > 20) {
        console.log(`[source-fetch] contenu récupéré via Wayback pour ${url.slice(0, 90)}`);
        return tw;
      }
    } else {
      console.warn(`[source-fetch] wayback: HTTP ${wb.status} pour ${url.slice(0, 90)}`);
    }
    console.warn(`[source-fetch] ÉCHEC total (4 étapes) pour ${url.slice(0, 90)}`);
    return '(non disponible)';
  } catch (e) {
    console.warn(`[source-fetch] exception inattendue pour ${url.slice(0, 90)} :`, e.message);
    return '(non disponible)';
  }
}

async function _generateAndSaveAnalysis(debateId, { forceRescore = false } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;

  const canonicalId = resolveSharedDebateId(debateId) || String(debateId);
  const groupIds = getDebateIdsInSharedSpace(canonicalId);

  await supabase.from("debates").update({ ai_analysis_status: "generating" }).eq("id", canonicalId);

  try {
    const generationScoreScope = groupIds.length > 1 ? groupIds : null;
    const { score: generationScore } = await _computeAnalysisScore(canonicalId, generationScoreScope);
    const payload = await _fetchDebatePayload(canonicalId, groupIds.length > 1 ? groupIds : null);
    const result  = await generateAnalysisJson(payload, (messages, opts) => _callOpenAI(apiKey, messages, opts), { forceRescore, fetchContent: _fetchSourceContent });
    const raw     = JSON.stringify(result);
    // Scoring par idée extrait une fois ici et stocké à part (colonne légère)
    // plutôt que reparsé depuis ai_analysis en entier à chaque lecture — cf.
    // data/migration-debates-arg-scores.sql.
    const argScores = Object.fromEntries(
      [..._getAnalysisScoreByArgumentId(result)].map(([argId, entry]) => [argId, { score: entry.score, category: entry.category }])
    );

    const { error: saveError } = await supabase.from("debates").update({
      ai_analysis:              raw,
      ai_analysis_arg_scores:   argScores,
      popularity_analysis:      null,
      ai_analysis_status:       "ready",
      ai_analysis_generated_at: new Date().toISOString(),
      ai_analysis_last_score:   generationScore
    }).eq("id", canonicalId);

    if (saveError) {
      console.error(`[auto-analysis] débat ${canonicalId} — erreur sauvegarde :`, saveError.message);
    } else {
      console.log(`[auto-analysis] débat ${canonicalId}${groupIds.length > 1 ? ` (fusionné avec ${groupIds.filter((gid) => String(gid) !== String(canonicalId)).join(",")})` : ""} — analyse générée et sauvegardée.`);
      for (const id of groupIds) {
        _notifyParticipantsAnalysisReady(id, payload.question, result).catch(console.error);
      }
    }

    // Analyse popularité vs robustesse (colonne séparée)
    try {
      const popularityResult = await generatePopularityAnalysis(result, (messages) => _callOpenAI(apiKey, messages, { feature: "debate_popularity_analysis" }));
      const popularityRaw    = JSON.stringify(popularityResult);
      const { error: popErr } = await supabase.from("debates")
        .update({ popularity_analysis: popularityRaw })
        .eq("id", canonicalId);
      if (popErr) {
        console.error(`[auto-analysis] débat ${canonicalId} — erreur sauvegarde popularité :`, popErr.message);
      } else {
        console.log(`[auto-analysis] débat ${canonicalId} — analyse popularité sauvegardée.`);
      }
    } catch (popErr) {
      console.error(`[auto-analysis] débat ${canonicalId} — analyse popularité échouée :`, popErr.message);
    }

    return raw;
  } catch (err) {
    console.error(`[auto-analysis] débat ${canonicalId} — échec :`, err.message);
    await supabase.from("debates").update({ ai_analysis_status: "failed" }).eq("id", canonicalId);
    throw err;
  }
}

// Extrait le bloc JSON de scoring d'une colonne debates.ai_analysis :
// nouveau format = JSON direct ; ancien format = après le marqueur
// %%AGON_SCORING%% qui suit l'article markdown.
function extractAnalysisScoringRaw(fullAnalysis) {
  if (!fullAnalysis) return null;
  if (fullAnalysis.trimStart().startsWith("{")) return fullAnalysis;
  const marker = "\n%%AGON_SCORING%%\n";
  const idx = fullAnalysis.indexOf(marker);
  return idx !== -1 ? fullAnalysis.slice(idx + marker.length).trim() : null;
}

// Vérifie si le seuil est atteint et programme l'analyse si besoin
function _getAnalysisScoreByArgumentId(analysis) {
  const scoreByArgumentId = new Map();
  const camps = analysis && analysis.camps ? analysis.camps : {};

  for (const campKey of ["A", "B"]) {
    const camp = camps[campKey] || {};
    const effectiveArguments = Array.isArray(camp.effectiveArguments) ? camp.effectiveArguments : [];

    for (const arg of effectiveArguments) {
      const argumentId = String(arg?.argumentId || "").trim();
      const score = Number(arg?.final_score);
      if (!argumentId || !Number.isFinite(score)) continue;
      scoreByArgumentId.set(argumentId, {
        argumentId,
        score: Math.max(0, Math.min(100, Math.round(score))),
        category: String(arg?.final_category || arg?.category || "").trim()
      });
    }

    const duplicateGroups = Array.isArray(camp.duplicateGroups) ? camp.duplicateGroups : [];
    for (const group of duplicateGroups) {
      const representativeId = String(group?.representativeArgumentId || "").trim();
      const representativeScore = scoreByArgumentId.get(representativeId);
      if (!representativeScore) continue;

      const mergedIds = Array.isArray(group?.mergedArgumentIds) ? group.mergedArgumentIds : [];
      for (const mergedIdRaw of mergedIds) {
        const mergedId = String(mergedIdRaw || "").trim();
        if (mergedId && !scoreByArgumentId.has(mergedId)) {
          scoreByArgumentId.set(mergedId, { ...representativeScore, argumentId: mergedId });
        }
      }
    }
  }

  return scoreByArgumentId;
}

function _buildAnalysisReadyPersonalization(analysis, questionLabel) {
  const scoreByArgumentId = _getAnalysisScoreByArgumentId(analysis);
  if (!scoreByArgumentId.size) return null;

  return function buildPersonalization(argRows) {
    const scoredByUser = new Map();

    for (const arg of (argRows || [])) {
      const userKey = String(arg?.author_key || "").trim();
      const argumentId = String(arg?.id || "").trim();
      if (!userKey || !argumentId) continue;

      const scoreEntry = scoreByArgumentId.get(argumentId);
      if (!scoreEntry) continue;

      if (!scoredByUser.has(userKey)) scoredByUser.set(userKey, []);
      scoredByUser.get(userKey).push(scoreEntry);
    }

    const messageByUserKey = new Map();
    const argumentIdByUserKey = new Map();

    for (const [userKey, entries] of scoredByUser.entries()) {
      const scores = entries
        .filter((entry) => Number.isFinite(Number(entry.score)))
        .sort((a, b) => Number(b.score) - Number(a.score));
      if (!scores.length) continue;

      const best = scores[0];
      const bestCategory = String(best.category || "").toLowerCase();
      // Note faible/moyen jamais révélée par notification, même à l'auteur lui-même
      // (demande du 19/08/2026, cf. canViewerSeeHiddenScores) : message générique sans
      // chiffre plutôt que de ne pas notifier du tout — l'idée reste consultable, seule
      // la valeur du score est cachée.
      const canRevealScore = bestCategory === "bon" || bestCategory === "excellent";
      const scoreLabel = `${best.score}/100`;
      // Le chiffre reste caché (cf. plus haut), mais l'utilisateur doit quand même
      // savoir qu'une note existe — jamais un silence qui pourrait passer pour un bug
      // (demande du 20/08/2026) : on explique explicitement pourquoi elle n'est pas
      // affichée plutôt que de ne rien dire du tout.
      const suffix = !canRevealScore
        ? "Les notes IA sont disponibles, mais seules les meilleures contributions sont rendues publiques."
        : scores.length > 1
          ? `Ta meilleure note IA : ${scoreLabel} (${scores.length} idées notées).`
          : `Ta note IA : ${scoreLabel}.`;

      messageByUserKey.set(
        userKey,
        `L'arbitrage IA de ${questionLabel} est disponible. ${suffix}`
      );
      if (best.argumentId) {
        argumentIdByUserKey.set(userKey, best.argumentId);
      }
    }

    return { messageByUserKey, argumentIdByUserKey };
  };
}

async function _notifyParticipants(debateId, { type, message, buildPersonalization = null }) {
  const { data: argRows } = await supabase
    .from("arguments")
    .select("id, author_key")
    .eq("debate_id", debateId);

  const ids = (argRows || []).map((a) => a.id).filter(Boolean);
  const userKeys = new Set();

  for (const a of (argRows || [])) {
    if (a.author_key) userKeys.add(a.author_key);
  }

  if (ids.length) {
    const [{ data: votes }, { data: commentAuthors }] = await Promise.all([
      supabase.from("votes").select("voter_key").in("argument_id", ids),
      supabase.from("comments").select("author_key").in("argument_id", ids)
    ]);
    for (const v of (votes || [])) {
      if (v.voter_key) userKeys.add(v.voter_key);
    }
    for (const c of (commentAuthors || [])) {
      if (c.author_key) userKeys.add(c.author_key);
    }
  }

  if (userKeys.size === 0) return;

  let personalization = {};
  if (typeof buildPersonalization === "function") {
    try {
      personalization = buildPersonalization(argRows || []) || {};
    } catch (error) {
      console.error("[notifications] personnalisation ignorée :", error?.message || error);
    }
  }
  const messageByUserKey = personalization.messageByUserKey instanceof Map
    ? personalization.messageByUserKey
    : new Map();
  const argumentIdByUserKey = personalization.argumentIdByUserKey instanceof Map
    ? personalization.argumentIdByUserKey
    : new Map();

  const now = nowIso();
  const notificationRows = [...userKeys].map((user_key) => {
    const personalMessage = messageByUserKey.get(user_key) || message;
    const personalArgumentId = argumentIdByUserKey.get(user_key) || null;
    return {
      user_key,
      type,
      debate_id: debateId,
      argument_id: personalArgumentId,
      comment_id: null,
      message: personalMessage,
      is_read: 0,
      created_at: now
    };
  });

  const { data: insertedNotifications, error: notificationInsertError } = await supabase
    .from("notifications")
    .insert(notificationRows)
    .select("id, user_key");

  if (notificationInsertError) throw notificationInsertError;

  const notificationIdByUserKey = new Map(
    (insertedNotifications || [])
      .filter((row) => row?.user_key)
      .map((row) => [row.user_key, row.id])
  );
  clearNotificationsApiResponseCache();

  for (const user_key of userKeys) {
    _sendPushNow(user_key, {
      type,
      message: messageByUserKey.get(user_key) || message,
      debate_id: debateId,
      argument_id: argumentIdByUserKey.get(user_key) || null,
      notification_id: notificationIdByUserKey.get(user_key) || null
    }).catch(console.error);
  }
}

function _notifyParticipantsAnalysisScheduled(debateId, question, argIds) {
  const questionLabel = quoteNotificationContent(question || "ce débat");
  return _notifyParticipants(debateId, {
    type: "analysis_scheduled",
    message: `L'arbitrage IA de ${questionLabel} débutera dans 24h.`
  });
}

function _notifyParticipantsAnalysisReady(debateId, question, analysis = null) {
  const questionLabel = quoteNotificationContent(question || "ce débat");
  return _notifyParticipants(debateId, {
    type: "analysis_ready",
    message: `L'arbitrage IA de ${questionLabel} est disponible.`,
    buildPersonalization: _buildAnalysisReadyPersonalization(analysis, questionLabel)
  });
}

// Score de contributions d'un débat (ou d'un groupe d'arènes fusionnées via
// shared_debate_links) : 1 pt par argument, 0.5 pt par commentaire.
async function _computeAnalysisScore(debateId, groupIds = null, opts = {}) {
  const ids = (groupIds && groupIds.length) ? groupIds : [debateId];
  const untilIso = opts && opts.untilIso ? String(opts.untilIso) : null;

  let argCountQuery = supabase
    .from("arguments")
    .select("*", { count: "exact", head: true })
    .in("debate_id", ids);
  if (untilIso) argCountQuery = argCountQuery.lte("created_at", untilIso);
  const { count: argCount } = await argCountQuery;

  let argIdsQuery = supabase
    .from("arguments")
    .select("id")
    .in("debate_id", ids);
  if (untilIso) argIdsQuery = argIdsQuery.lte("created_at", untilIso);
  const { data: argIds } = await argIdsQuery;

  let commentCount = 0;
  if (argIds && argIds.length) {
    let commentCountQuery = supabase
      .from("comments")
      .select("*", { count: "exact", head: true })
      .in("argument_id", argIds.map((a) => a.id));
    if (untilIso) commentCountQuery = commentCountQuery.lte("created_at", untilIso);
    const { count } = await commentCountQuery;
    commentCount = count || 0;
  }

  return { argCount: argCount || 0, commentCount, score: (argCount || 0) + commentCount * 0.5, argIds };
}

// — 1re analyse à 10 pts, puis re-déclenchement tous les 5 pts supplémentaires.
// Quand des arènes ont été fusionnées (admin "Sujets en attente" → shared_debate_links),
// l'analyse IA est unique et stockée uniquement sur l'arène canonique : le score
// compte les contributions cumulées de toutes les arènes fusionnées, et le rapport
// généré est relu depuis la canonique par n'importe laquelle des arènes liées
// (cf. resolveSharedDebateId dans GET /api/debates/:id/analysis).
async function _scheduleAnalysisIfNeeded(debateId) {
  if (!debateId) return;
  const canonicalId = resolveSharedDebateId(debateId) || String(debateId);

  const { data: debate } = await supabase
    .from("debates")
    .select("ai_analysis_status, ai_analysis, ai_analysis_last_score, question")
    .eq("id", canonicalId)
    .single();

  if (!debate) return;
  const status = debate.ai_analysis_status || "none";

  // Ne pas re-programmer si déjà en attente ou en cours de génération
  if (status === "scheduled" || status === "generating") return;

  const groupIds = getDebateIdsInSharedSpace(canonicalId);
  const { score, argIds } = await _computeAnalysisScore(canonicalId, groupIds.length > 1 ? groupIds : null);
  const lastScore = Number(debate.ai_analysis_last_score || 0);
  const hasExisting = !!(debate.ai_analysis);

  // 1re analyse : score >= 10 et aucune analyse existante
  const isFirstTrigger = !hasExisting && score >= 10;
  // Re-déclenchements : analyse existante + 5 pts de plus depuis le dernier trigger
  const isRetrigger = hasExisting && score >= 10 && score >= lastScore + 5;

  if (isFirstTrigger || isRetrigger) {
    const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("debates").update({
      ai_analysis_status:       "scheduled",
      ai_analysis_scheduled_at: scheduledAt,
      ai_analysis_last_score:   score
    }).eq("id", canonicalId);
    console.log(`[auto-analysis] débat ${canonicalId}${groupIds.length > 1 ? ` (fusionné avec ${groupIds.filter((gid) => String(gid) !== String(canonicalId)).join(",")})` : ""} — seuil atteint (score ${score}, dernier trigger ${lastScore}), analyse programmée pour ${scheduledAt}`);
    for (const id of groupIds) {
      _notifyParticipantsAnalysisScheduled(id, debate.question, argIds).catch(console.error);
    }
  }
}

// Scheduler : vérifie toutes les 15 min les analyses à générer. Seule l'instance
// Render l'exécute (Render définit automatiquement la variable RENDER) : le pm2
// local peut être coupé en pleine génération et laisserait l'analyse bloquée en
// "generating" — statut que le scheduler ne reprend jamais. Même logique que
// AUTO_PIPELINES_ENABLED côté bot veille. MNORIA_ANALYSIS_SCHEDULER=on|off force
// le comportement (ex. =on en local pour reprendre la main si Render est down).
// Les routes manuelles de (re)génération restent utilisables sur les deux instances.
const ANALYSIS_SCHEDULER_ENABLED = (() => {
  const forced = String(process.env.MNORIA_ANALYSIS_SCHEDULER || "").trim().toLowerCase();
  if (forced === "on") return true;
  if (forced === "off") return false;
  return Boolean(process.env.RENDER);
})();

if (ANALYSIS_SCHEDULER_ENABLED) {
  // Au démarrage : libère les analyses restées en "generating" après un crash ou un
  // redeploy survenu en pleine génération. Marge de 60 min sur l'échéance pour ne pas
  // toucher une génération réellement en cours sur l'ancienne instance pendant un
  // deploy sans coupure (une génération dure quelques minutes après son échéance).
  supabase
    .from("debates")
    .update({ ai_analysis_status: "scheduled" })
    .eq("ai_analysis_status", "generating")
    .lt("ai_analysis_scheduled_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .then(({ error }) => {
      if (error) console.error("[auto-analysis] reset des analyses bloquées :", error.message);
    });

  setInterval(async () => {
    try {
      const now = new Date().toISOString();
      const { data: pending } = await supabase
        .from("debates")
        .select("id")
        .eq("ai_analysis_status", "scheduled")
        .lte("ai_analysis_scheduled_at", now);

      for (const row of (pending || [])) {
        // Claim atomique : seule l'instance qui réussit à basculer scheduled→generating
        // lance la génération. Sans cette condition, deux instances qui pollent au même
        // moment généraient (et payaient) la même analyse deux fois.
        const { data: claimed, error: claimError } = await supabase
          .from("debates")
          .update({ ai_analysis_status: "generating" })
          .eq("id", row.id)
          .eq("ai_analysis_status", "scheduled")
          .select("id");
        if (claimError || !claimed || !claimed.length) continue;
        await _generateAndSaveAnalysis(row.id);
      }
    } catch (err) {
      console.error("[auto-analysis scheduler]", err.message);
    }
  }, 15 * 60 * 1000).unref();
}

// (anciens prompts _buildAnalysisPrompt1 / _PROMPT2 / _buildPrompt3 déplacés dans lib/debate-analysis.js)

async function _callOpenAI(apiKey, messages, opts = {}) {
  const MAX_ATTEMPTS = 3;
  // Configurable (opts.timeoutMs) depuis le 16/08/2026 : la génération
  // "jusqu'à 3 variantes par question" produit une sortie sensiblement plus
  // longue qu'avant (jusqu'à 3 objets par question au lieu de 1-2) — observé
  // en pratique sur un niveau Expert (20 questions) : le budget par défaut de
  // 45s pouvait être atteint alors que le modèle produisait encore une
  // réponse valide, juste plus longue. Toujours 45s par défaut pour tous les
  // autres appels du fichier, inchangés.
  const TIMEOUT_MS = opts.timeoutMs || 45_000;
  const model = opts.model || "gpt-4o-mini";
  // opts.feature (audit du 22/08/2026, phase 1) : identifie la fonctionnalité
  // métier pour l'instrumentation de coût (cf. lib/ai-usage-log.js). Un seul
  // log par appel à _callOpenAI, sur l'issue terminale (succès ou échec
  // final) — les tentatives 429/5xx/réseau retentées ci-dessous ne sont
  // jamais facturées par OpenAI, donc jamais elles-mêmes loguées.
  const feature = opts.feature || null;
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let r;
    try {
      r = await fetch("https://api.openai.com/v1/chat/completions", {
        method:  "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
        body:    JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0.3,
          ...(opts.responseFormat ? { response_format: opts.responseFormat } : {})
        }),
        signal:  AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (fetchErr) {
      // Timeout (AbortError) ou réseau — on retente sauf au dernier essai
      if (attempt === MAX_ATTEMPTS) {
        recordAiUsage(supabase, { feature, model, latencyMs: Date.now() - startedAt, success: false, error: fetchErr.message });
        throw Object.assign(fetchErr, { status: 502 });
      }
      await new Promise(r => setTimeout(r, 1000 * attempt));
      continue;
    }

    // 429 rate-limit ou 5xx transitoire → retente avec backoff
    if ((r.status === 429 || r.status >= 500) && attempt < MAX_ATTEMPTS) {
      const retryAfter = parseInt(r.headers.get("retry-after") || "0", 10) || attempt * 2;
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (!r.ok) {
      const body = await r.text().catch(() => "");
      recordAiUsage(supabase, { feature, model, latencyMs: Date.now() - startedAt, success: false, error: body || "Erreur OpenAI." });
      throw Object.assign(new Error(body || "Erreur OpenAI."), { status: 502 });
    }

    const data = await r.json();
    const { inputTokens, outputTokens, cachedTokens } = extractUsage(data?.usage);
    recordAiUsage(supabase, { feature, model, inputTokens, outputTokens, cachedTokens, latencyMs: Date.now() - startedAt, success: true });
    return data?.choices?.[0]?.message?.content || "";
  }
}

// Import de connaissances par photo (22/08/2026) : ANALYSE UNIQUEMENT. Cette
// route ne fait aucun INSERT Supabase, aucune création FSRS, aucune review —
// elle retourne des connaissances PROPOSÉES que le client doit faire valider
// explicitement par l'utilisateur avant tout enregistrement (cf. décision
// produit : jamais de sauvegarde automatique depuis une photo). Aucun
// fichier n'est écrit sur disque : le buffer image ne vit qu'en mémoire le
// temps de la requête.
//
// Taille "raisonnable" pour une photo de téléphone (pas un scan haute
// résolution) : au-delà, mieux vaut que l'utilisateur recadre/compresse.
const MAX_PHOTO_KNOWLEDGE_BYTES = 10 * 1024 * 1024; // 10 Mo décodés

app.post("/api/photo-knowledge/analyze", rateLimit("photo-knowledge", 6), express.json({ limit: "14mb" }), async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_API_KEY manquant." });

  try {
    const dataUrl = String(req.body?.dataUrl || "").trim();

    // Ne jamais se fier à une extension ou à un champ "type" déclaré seul :
    // le préfixe MIME est extrait du dataUrl lui-même, puis le contenu réel
    // est vérifié plus bas via sharp (lecture des octets, pas du label).
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: "Format d'image invalide." });

    const declaredMimeType = String(match[1] || "").toLowerCase();
    if (!ACCEPTED_PHOTO_MIME_TYPES.includes(declaredMimeType)) {
      return res.status(400).json({ error: "Type d'image non accepté (jpeg, png ou webp uniquement)." });
    }

    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length) return res.status(400).json({ error: "Image vide." });
    if (buffer.length > MAX_PHOTO_KNOWLEDGE_BYTES) {
      return res.status(413).json({ error: "Image trop volumineuse (10 Mo maximum)." });
    }

    // Validation de contenu réel (pas seulement le label déclaré) : sharp
    // échoue si le buffer n'est pas une image décodable, et son format
    // détecté doit correspondre à un type accepté.
    let detectedFormat;
    try {
      detectedFormat = (await sharp(buffer).metadata()).format;
    } catch (error) {
      return res.status(400).json({ error: "Fichier image illisible." });
    }
    if (!["jpeg", "png", "webp"].includes(detectedFormat)) {
      return res.status(400).json({ error: "Type d'image non accepté (jpeg, png ou webp uniquement)." });
    }

    const { dataUrl: normalizedDataUrl } = await buildAnalysisDataUrl(buffer, declaredMimeType);
    const { usage, ...result } = await analyzePhotoKnowledge({
      dataUrl: normalizedDataUrl,
      callOpenAI: (messages, opts) => _callOpenAI(process.env.OPENAI_API_KEY, messages, opts)
    });

    return res.json(result);
  } catch (error) {
    // Jamais le contenu de la photo dans les logs, uniquement le message
    // d'erreur (RGPD/vie privée — cf. rapport).
    console.error("Erreur analyse photo-knowledge:", error.message);
    return res.status(500).json({ error: "Erreur analyse de la photo." });
  }
});

// Import PDF texte : extraction locale en mémoire, puis sélection IA par
// blocs. Aucun PDF, buffer, base64 ou texte intégral n'est persisté.
app.post("/api/pdf-knowledge/analyze", rateLimit("pdf-knowledge", 4), express.json({ limit: "28mb" }), async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_API_KEY manquant." });
  try {
    const buffer = decodePdfDataUrl(req.body?.dataUrl, String(req.body?.type || "").toLowerCase());
    const result = await analyzePdfKnowledge({
      buffer,
      callOpenAI: (messages, opts) => _callOpenAI(process.env.OPENAI_API_KEY, messages, opts)
    });
    if (result.status === "scan_not_supported") return res.json(result);
    const secret = process.env.PDF_ANALYSIS_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.ADMIN_PASSWORD;
    const analysisToken = createPdfAnalysisToken(result, secret);
    return res.json({ ...result, analysisToken });
  } catch (error) {
    console.error("Erreur analyse pdf-knowledge:", error.message);
    if (["invalid_mime", "invalid_pdf"].includes(error.code)) return res.status(400).json({ error: error.message, code: error.code });
    if (["pdf_too_large", "pdf_too_long"].includes(error.code)) return res.status(413).json({ error: error.message, code: error.code });
    return res.status(500).json({ error: "Erreur d'analyse du PDF." });
  }
});

// Copier-coller : sélection uniquement. Le texte source n'est ni écrit en
// base, ni ajouté à sourceDetail, ni conservé après la requête.
app.post("/api/text-knowledge/analyze", rateLimit("text-knowledge", 8), express.json({ limit: "256kb" }), async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_API_KEY manquant." });
  try {
    const input = validateTextKnowledgePayload(req.body);
    const result = await analyzeTextKnowledge({
      ...input,
      callOpenAI: (messages, opts) => _callOpenAI(process.env.OPENAI_API_KEY, messages, opts)
    });
    return res.json(result);
  } catch (error) {
    console.error("Erreur analyse text-knowledge:", error.message);
    if (["invalid_payload", "invalid_text", "text_too_long"].includes(error.code)) {
      return res.status(error.code === "text_too_long" ? 413 : 400).json({ error: error.message, code: error.code });
    }
    return res.status(500).json({ error: "Erreur d'analyse du texte." });
  }
});

app.post("/api/url-knowledge/analyze", rateLimit("url-knowledge", 6), express.json({ limit: "8kb" }), async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_API_KEY manquant." });
  try {
    if (!req.body || typeof req.body.url !== "string") return res.status(400).json({ error: "URL obligatoire.", code: "invalid_url" });
    const result = await analyzeUrlKnowledge({
      url: req.body.url,
      callOpenAI: (messages, opts) => _callOpenAI(process.env.OPENAI_API_KEY, messages, opts)
    });
    const secret = process.env.URL_ANALYSIS_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.ADMIN_PASSWORD;
    return res.json({ ...result, analysisToken: createUrlAnalysisToken(result, secret) });
  } catch (error) {
    console.error("Erreur analyse url-knowledge:", error.message);
    const clientCodes = new Set(["invalid_url", "invalid_protocol", "ssrf_blocked", "dns_failed", "invalid_redirect", "too_many_redirects", "protected_page", "http_error", "unsupported_content_type", "content_not_available", "content_too_long", "response_too_large", "timeout", "fetch_failed"]);
    if (clientCodes.has(error.code)) {
      const status = ["response_too_large", "content_too_long"].includes(error.code) ? 413 : (error.code === "timeout" ? 504 : 400);
      return res.status(status).json({ error: error.message, code: error.code, status: error.code === "content_not_available" ? "content_not_available" : "error" });
    }
    return res.status(500).json({ error: "Erreur d'analyse du lien." });
  }
});

// Sous-titres publics uniquement : aucune vidéo, piste audio, miniature ou
// transcription complète n'est écrite en base pendant cette analyse.
app.post("/api/youtube-knowledge/analyze", rateLimit("youtube-knowledge", 4), express.json({ limit: "8kb" }), async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_API_KEY manquant." });
  try {
    if (!req.body || typeof req.body.url !== "string") return res.status(400).json({ error: "URL YouTube obligatoire.", code: "invalid_url" });
    const result = await analyzeYoutubeKnowledge({
      url: req.body.url,
      callOpenAI: (messages, opts) => _callOpenAI(process.env.OPENAI_API_KEY, messages, opts)
    });
    const secret = process.env.YOUTUBE_ANALYSIS_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.ADMIN_PASSWORD;
    return res.json({ ...result, analysisToken: createYoutubeAnalysisToken(result, secret) });
  } catch (error) {
    console.error("Erreur analyse youtube-knowledge:", error.message);
    if (error instanceof YoutubeKnowledgeError) {
      const status = error.code === "video_too_long" ? 413 : (error.code === "service_error" ? 502 : 400);
      return res.status(status).json({ error: error.message, code: error.code, status: error.code });
    }
    return res.status(500).json({ error: "Erreur d'analyse de la vidéo YouTube.", code: "service_error" });
  }
});

// ÉCRITURE séparée de /analyze : cette route ne reçoit jamais l'image ni la
// transcription, uniquement les faits que l'utilisateur a explicitement
// laissés cochés avant de cliquer. Chaque fait rejoint le pipeline normal des
// QCM de notion (daily_quiz + user_notion_quizzes), puis MemoryItem + FSRS à
// la première réponse. Le hash normalisé du fait rend l'opération idempotente
// entre deux imports de photos contenant la même connaissance.
async function addValidatedKnowledgeImport({ body, sourceType, logLabel, maxKnowledge = 20, sourceUrl = null, sourceMeta = null }) {
  if (!process.env.OPENAI_API_KEY) return { status: 503, body: { ok: false, error: "OPENAI_API_KEY manquant." } };

  try {
    const validation = validateLegacyKey(body?.legacyKey);
    if (validation.error) return { status: 400, body: { ok: false, error: validation.error } };

    const sourceTitle = String(body?.sourceTitle || "").trim().replace(/\s+/g, " ").slice(0, 160);
    const submitted = Array.isArray(body?.knowledge) ? body.knowledge : [];
    if (!submitted.length || submitted.length > maxKnowledge) {
      return { status: 400, body: { ok: false, error: `Sélection invalide (1 à ${maxKnowledge} connaissances).` } };
    }

    const normalizedItems = [];
    const requestIds = new Set();
    for (let index = 0; index < submitted.length; index += 1) {
      const fact = String(submitted[index] || "").trim().replace(/\s+/g, " ");
      if (fact.length < 3 || fact.length > 500) {
        return { status: 400, body: { ok: false, error: `Connaissance ${index + 1} invalide.` } };
      }
      const id = normalizeCustomTopicKey(fact);
      // Un doublon dans la même sélection ne doit jamais produire deux
      // insertions ni deux appels IA.
      if (requestIds.has(id)) continue;
      requestIds.add(id);
      normalizedItems.push({ index, fact, id });
    }
    if (!normalizedItems.length) {
      return { status: 400, body: { ok: false, error: "Aucune connaissance valide sélectionnée." } };
    }

    const { user } = await resolveLegacyUser(supabase, validation.legacyKey);
    const finalKnowledge = normalizedItems.map((item) => item.fact);
    const documentImportId = buildPhotoDocumentImportId(sourceTitle, finalKnowledge, sourceUrl);
    let sharedSourceDetail = null;
    const results = [];

    // ── PASSE 1 : quel QCM existe déjà, lequel reste à générer ─────────────
    // Détachée de la génération (contrairement à l'ancien flux tout-en-un)
    // pour pouvoir batcher la génération des seules connaissances qui en ont
    // réellement besoin (audit coût import photo, 24/08/2026) — un fait déjà
    // persisté ne doit jamais entrer dans un lot de génération.
    const existingBySlot = new Map(); // item.id -> { slot, quizDate, questions }
    const erroredResults = new Map(); // item.id -> résultat d'erreur déjà prêt pour `results`
    const pendingItems = []; // items sans QCM existant, à générer

    for (const item of normalizedItems) {
      const slot = `notion:${sourceType}:${documentImportId}:${item.id}`;
      try {
        const { data: existingQuizRows, error: existingQuizError } = await supabase
          .from("daily_quiz")
          .select("quiz_date, questions")
          .eq("slot", slot)
          .order("quiz_date", { ascending: false })
          .limit(1);
        if (existingQuizError) throw existingQuizError;
        const existingQuiz = existingQuizRows?.[0] || null;

        if (existingQuiz) {
          const questions = existingQuiz.questions || [];
          existingBySlot.set(item.id, { slot, quizDate: existingQuiz.quiz_date, questions });
          // Reprise après un import partiellement abouti : la première
          // connaissance déjà persistée devient la source de vérité de la
          // fiche commune pour les QCM manquants, sans nouvel appel IA.
          const existingDetail = questions[0]?.sourceDetail;
          if (!sharedSourceDetail && existingDetail?.documentImportId === documentImportId) {
            sharedSourceDetail = existingDetail;
          }
        } else {
          pendingItems.push({ item, slot });
        }
      } catch (error) {
        console.error(`[${logLabel}:add:${item.id}]`, error.message);
        erroredResults.set(item.id, { index: item.index, knowledge: item.fact, status: "error", error: "Ajout impossible pour cette connaissance." });
      }
    }

    // ── PASSE 2 : génération, batchée par lots de NOTION_QUIZ_ENUMERABLE_CHUNK_SIZE ──
    // Un seul appel IA pour tout un lot au lieu d'un appel par connaissance —
    // le gros bloc fixe décrivant les formats de question n'est ainsi payé
    // qu'une fois par lot. Plafond de lot identique et pour la même raison
    // que generateEnumerableQuizQuestions (au-delà, un seul appel IA ne tient
    // pas de façon fiable). Fiche documentaire commune générée paresseusement
    // ici, une seule fois pour tout l'import — inchangé par rapport à avant.
    const generatedQuestionsById = new Map(); // item.id -> [question] (même forme qu'avant)

    if (pendingItems.length) {
      if (!sharedSourceDetail) {
        const sheetResult = await generatePhotoKnowledgeSheet({
          sourceTitle,
          knowledge: finalKnowledge,
          sourceType,
          sourceUrl,
          sourceMeta,
          callOpenAI: (messages, opts) => _callOpenAI(process.env.OPENAI_API_KEY, messages, opts)
        });
        sharedSourceDetail = sheetResult.sourceDetail;
        if (sheetResult.usedFallback && sheetResult.error) {
          console.warn(`[${logLabel}:${documentImportId}] fiche enrichie indisponible, fallback minimal :`, sheetResult.error.message);
        }
      }

      const batchResultsById = new Map();
      const missingIds = [];
      for (let start = 0; start < pendingItems.length; start += NOTION_QUIZ_ENUMERABLE_CHUNK_SIZE) {
        const chunk = pendingItems.slice(start, start + NOTION_QUIZ_ENUMERABLE_CHUNK_SIZE);
        const chunkResult = await buildImportedKnowledgeQuestionsBatch(chunk.map((p) => p.item), documentImportId);
        for (const [id, question] of chunkResult.resultsById) batchResultsById.set(id, question);
        missingIds.push(...chunkResult.missingIds);
      }

      // Chemin succès du lot : classification + mise en forme, connaissance
      // par connaissance (jamais batchée, cf. buildImportedKnowledgeQuestionsBatch).
      for (const { item } of pendingItems) {
        const question = batchResultsById.get(item.id);
        if (!question) continue; // repris ci-dessous par le repli ciblé
        try {
          const finalized = await finalizeImportedKnowledgeQuestion(question, item.fact, item.id, user.id, sharedSourceDetail, documentImportId, sourceType);
          generatedQuestionsById.set(item.id, [finalized]);
        } catch (error) {
          console.warn(`[${logLabel}:${documentImportId}] finalisation du lot échouée pour ${item.id}, repli individuel :`, error.message);
          missingIds.push(item.id);
        }
      }

      // Repli ciblé (jamais tout le lot) : uniquement les connaissances
      // manquantes ou invalides du batch, une par une, via le chemin
      // individuel historique (génération + classification + mise en forme).
      for (const id of missingIds) {
        const pending = pendingItems.find((p) => p.item.id === id);
        if (!pending) continue;
        try {
          const questions = await buildImportedKnowledgeQuestions(pending.item.fact, pending.item.id, user.id, sharedSourceDetail, documentImportId, sourceType);
          if (questions.length) generatedQuestionsById.set(id, questions);
        } catch (error) {
          console.warn(`[${logLabel}:${documentImportId}] repli individuel échoué pour ${id} :`, error.message);
        }
      }
    }

    // ── PASSE 3 : persistance + liaison, connaissance par connaissance ─────
    // Comportement strictement identique à l'ancien flux tout-en-un (même
    // gestion de la course à l'insertion, même contenu de `results`) — seule
    // la provenance de `questions` change (déjà généré en passe 2, jamais un
    // nouvel appel IA ici).
    for (const item of normalizedItems) {
      if (erroredResults.has(item.id)) {
        results.push(erroredResults.get(item.id));
        continue;
      }
      const slot = `notion:${sourceType}:${documentImportId}:${item.id}`;
      try {
        let quizDate;
        let questions;
        let reused = false;

        const existing = existingBySlot.get(item.id);
        if (existing) {
          quizDate = existing.quizDate;
          questions = existing.questions;
          reused = true;
        } else {
          questions = generatedQuestionsById.get(item.id);
          if (!questions || !questions.length) throw new Error("Génération de la question impossible.");
          quizDate = parisDateKey();

          const { error: insertError } = await supabase.from("daily_quiz").insert({
            quiz_date: quizDate,
            slot,
            questions,
            source_debate_ids: []
          });
          if (insertError) {
            if (insertError.code !== "23505") throw insertError;
            const { data: raceRows, error: raceError } = await supabase
              .from("daily_quiz")
              .select("quiz_date, questions")
              .eq("slot", slot)
              .order("quiz_date", { ascending: false })
              .limit(1);
            if (raceError) throw raceError;
            const raceQuiz = raceRows?.[0];
            if (!raceQuiz) throw insertError;
            quizDate = raceQuiz.quiz_date;
            questions = raceQuiz.questions || questions;
            reused = true;
          }
        }

        const { data: existingLink, error: existingLinkError } = await supabase
          .from("user_notion_quizzes")
          .select("id")
          .eq("user_id", user.id)
          .eq("quiz_date", quizDate)
          .eq("slot", slot)
          .maybeSingle();
        if (existingLinkError) throw existingLinkError;

        if (!existingLink) {
          const { error: linkError } = await supabase.from("user_notion_quizzes").upsert(
            { user_id: user.id, quiz_date: quizDate, slot },
            { onConflict: "user_id,quiz_date,slot", ignoreDuplicates: true }
          );
          if (linkError) throw linkError;
        }

        results.push({
          index: item.index,
          knowledge: item.fact,
          status: existingLink ? "existing" : "added",
          slot,
          quizDate,
          questionCount: questions.length,
          reused
        });
      } catch (error) {
        console.error(`[${logLabel}:add:${item.id}]`, error.message);
        results.push({ index: item.index, knowledge: item.fact, status: "error", error: "Ajout impossible pour cette connaissance." });
      }
    }

    const addedCount = results.filter((item) => item.status === "added").length;
    const existingCount = results.filter((item) => item.status === "existing").length;
    const errorCount = results.filter((item) => item.status === "error").length;
    return { status: 200, body: { ok: errorCount === 0, documentImportId, addedCount, existingCount, errorCount, results } };
  } catch (error) {
    console.error(`Erreur ajout ${logLabel}:`, error.message);
    return { status: 500, body: { ok: false, error: "Erreur lors de l'ajout à la mémoire." } };
  }
}

app.post("/api/photo-knowledge/add", rateLimit("photo-knowledge-add", 12), express.json({ limit: "48kb" }), async (req, res) => {
  const result = await addValidatedKnowledgeImport({ body: req.body, sourceType: "photo_import", logLabel: "photo-knowledge" });
  return res.status(result.status).json(result.body);
});

app.post("/api/manual-knowledge/add", rateLimit("manual-knowledge-add", 12), express.json({ limit: "48kb" }), async (req, res) => {
  const result = await addValidatedKnowledgeImport({ body: req.body, sourceType: "manual_import", logLabel: "manual-knowledge" });
  return res.status(result.status).json(result.body);
});

app.post("/api/pdf-knowledge/add", rateLimit("pdf-knowledge-add", 8), express.json({ limit: "128kb" }), async (req, res) => {
  try {
    const secret = process.env.PDF_ANALYSIS_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.ADMIN_PASSWORD;
    const token = verifyPdfAnalysisToken(req.body?.analysisToken, secret);
    const result = await addValidatedKnowledgeImport({
      body: req.body,
      sourceType: "pdf_import",
      logLabel: "pdf-knowledge",
      maxKnowledge: token.maxKnowledge
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/text-knowledge/add", rateLimit("text-knowledge-add", 12), express.json({ limit: "48kb" }), async (req, res) => {
  const result = await addValidatedKnowledgeImport({ body: req.body, sourceType: "text_import", logLabel: "text-knowledge" });
  return res.status(result.status).json(result.body);
});

app.post("/api/url-knowledge/add", rateLimit("url-knowledge-add", 12), express.json({ limit: "48kb" }), async (req, res) => {
  try {
    const secret = process.env.URL_ANALYSIS_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.ADMIN_PASSWORD;
    const token = verifyUrlAnalysisToken(req.body?.analysisToken, secret);
    const result = await addValidatedKnowledgeImport({
      body: req.body,
      sourceType: "url_import",
      logLabel: "url-knowledge",
      sourceUrl: token.sourceUrl
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/youtube-knowledge/add", rateLimit("youtube-knowledge-add", 8), express.json({ limit: "128kb" }), async (req, res) => {
  try {
    const secret = process.env.YOUTUBE_ANALYSIS_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.ADMIN_PASSWORD;
    const token = verifyYoutubeAnalysisToken(req.body?.analysisToken, secret);
    const result = await addValidatedKnowledgeImport({
      body: { ...req.body, sourceTitle: token.sourceTitle },
      sourceType: "youtube_import",
      logLabel: "youtube-knowledge",
      maxKnowledge: token.maxKnowledge,
      sourceUrl: token.sourceUrl,
      sourceMeta: { sourceAuthor: token.sourceAuthor, durationSeconds: token.durationSeconds }
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/admin/analyze-debate", requireAdmin, rateLimit("analysis-generate", 5), express.json(), async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_API_KEY manquant." });

  const { debateId, force = false } = req.body || {};
  if (!debateId) return res.status(400).json({ error: "debateId manquant." });

  try {
    const raw = await _generateAndSaveAnalysis(debateId, { forceRescore: !!force });
    const canonicalId = resolveSharedDebateId(debateId) || String(debateId);
    const { data: popData } = await supabase.from("debates").select("popularity_analysis").eq("id", canonicalId).single();
    return res.json({ raw, popularityRaw: popData?.popularity_analysis || null });
  } catch (err) {
    console.error("[analyze-debate]", err.message);
    return res.status(502).json({ error: err.message || "Erreur lors de la génération." });
  }
});

/* ================================================================= */
/*   QCM de notion — généré à la demande quand l'utilisateur clique    */
/*   "Mémoriser" sur une notion (Éclairages / Ce jour dans l'Histoire) */
/* ================================================================= */

// QCM narratifs (Ce jour dans l'Histoire / Éclairages) : gpt-4.1-mini plutôt
// que gpt-4o-mini. La matière première vient déjà de générations gpt-4.1-mini
// (les 3 services Éclairages, cf. lib/parallele-historique.js et consorts) —
// autant garder la même qualité pour les quizzer correctement plutôt que de
// dégrader avec un modèle plus faible sur un contenu déjà exigeant (concepts
// philosophiques/sociologiques, nuances historiques).
const DAILY_QUIZ_NARRATIVE_MODEL = process.env.OPENAI_DAILY_QUIZ_NARRATIVE_MODEL || "gpt-4.1-mini";
const DAILY_QUIZ_CRITIC_MODEL = process.env.OPENAI_DAILY_QUIZ_CRITIC_MODEL || DAILY_QUIZ_NARRATIVE_MODEL;
const QCM_SEMANTIC_REVIEW_ENABLED = !/^(?:0|false|off|no)$/i.test(String(process.env.QCM_SEMANTIC_REVIEW_ENABLED || "true").trim());
const QCM_SEMANTIC_REVIEW_MAX_RETRIES = Math.max(0, Math.min(2, Number.parseInt(process.env.QCM_SEMANTIC_REVIEW_MAX_RETRIES || "2", 10) || 0));
const QCM_CRITIC_TECHNICAL_MAX_RETRIES = Math.max(0, Math.min(3, Number.parseInt(process.env.QCM_CRITIC_TECHNICAL_MAX_RETRIES || "2", 10) || 0));

// Pseudo-slot "Renforcement des connaissances" : jamais généré ni stocké
// dans `daily_quiz`, composé exclusivement des repasses de répétition espacée dues aujourd'hui
// pour le visiteur (cf. fetchCultureGeneraleReviewInjectionForToday) —
// calculé à la demande, jamais partagé entre visiteurs. Reste dans le même
// espace de routes que les vrais créneaux (/today, /results, /answer) pour
// réutiliser toute l'infrastructure existante (grading, stats, idempotence).
const DAILY_QUIZ_REINFORCEMENT_SLOT = "renforcement";
const DAILY_QUIZ_REINFORCEMENT_LABEL = "Renforcement des connaissances";
// Pseudo-slot « Comprendre » : QCM relationnel construit à partir des liens IA entre deux
// connaissances déjà acquises. Comme Renforcement, il est personnel et composé à la demande,
// mais ses banques de questions par paire sont persistées dans daily_quiz pour ne jamais payer
// une nouvelle génération à chaque ouverture.
const DAILY_QUIZ_COMPREHENSION_SLOT = "comprendre";
const DAILY_QUIZ_COMPREHENSION_LABEL = "Comprendre les liens";

function getDailyQuizSlotLabel(slot) {
  if (slot === DAILY_QUIZ_REINFORCEMENT_SLOT) return DAILY_QUIZ_REINFORCEMENT_LABEL;
  if (slot === DAILY_QUIZ_COMPREHENSION_SLOT) return DAILY_QUIZ_COMPREHENSION_LABEL;
  return null;
}

// Reconnaît une question de culture générale (fraîche "culture_generale-qN",
// repasse "cgreview-..." ou QCM de notion "notion:...") — id toujours
// préfixé à la génération, jamais réattribué ensuite. Sert à alimenter
// "Mon univers" (cf. POST /api/daily-quiz/answer) et l'historique "Mes
// acquis" (cf. fetchUserCultureGeneraleAnswerEvents).
function isCultureGeneraleQuestionId(id) {
  const s = String(id || "");
  return s.startsWith("culture_generale-") || s.startsWith("cgreview-") || s.startsWith("notion:");
}


// Repère d'affichage pour "Mes acquis"/"Mes apprentissages" (✓ vert) : une
// question de culture générale est considérée "validée" après
// DAILY_QUIZ_ACQUIS_VALIDATION_STREAK bonnes réponses consécutives (jamais
// plusieurs fois le même jour). Purement un affichage dérivé de l'historique
// (computeQuestionStreaks/computeCultureGeneraleStreaks) depuis le passage à
// FSRS (13-16/08/2026, cf. lib/spaced-repetition/) : ce compteur n'influence
// plus la date de la prochaine repasse (portée uniquement par
// memory_item_fsrs_states.due_at désormais), contrairement à l'ancien
// mécanisme à paliers fixes [3, 7, 30] jours qu'il remplace.
const DAILY_QUIZ_ACQUIS_VALIDATION_STREAK = 4;

function isValidDailyQuizSlot(slot) {
  return slot === DAILY_QUIZ_REINFORCEMENT_SLOT
    || slot === DAILY_QUIZ_COMPREHENSION_SLOT
    || String(slot || "").startsWith("notion:");
}

function parisDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parisHour(date = new Date()) {
  const value = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(date);
  return parseInt(value, 10);
}

// Minuit (heure de Paris) du jour de `date`, en ISO UTC — borne basse des
// candidats du QCM. Calculé en retranchant le temps écoulé depuis minuit
// local plutôt qu'en reconstruisant une date locale (fiable été/hiver, sans
// dépendre d'un parsing de fuseau).
function parisStartOfDayIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const get = (type) => parseInt(parts.find((p) => p.type === type)?.value || "0", 10);
  const msSinceParisMidnight = ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000 + date.getMilliseconds();
  return new Date(date.getTime() - msSinceParisMidnight).toISOString();
}


// Bloc de règles partagé par les 3 builders de prompt QCM, décrivant les 4
// formats de question possibles. `sourceIdField` vaut "sourceDebateId" (QCM
// actu) ou "sourceId" (QCM narratifs) — seul ce nom de champ change d'un
// builder à l'autre, le reste est identique.
// Rotation de formats assignée à chaque question AVANT l'appel IA plutôt que
// laissée à sa seule discrétion : "varie-les naturellement" ne suffit pas en
// pratique, l'IA retombe facilement sur "qcm" pour tout le lot (retour
// utilisateur du 03/08/2026, même classe de biais que le position bias déjà
// documenté sur correctIndex, cf. shuffleOptionsPreservingCorrectIndex) —
// une vraie variété se construit nous-mêmes, pas en espérant que l'IA la
// choisisse d'elle-même. Les formats les plus contraints (association/
// qcm_multi/ordre, qui exigent une structure particulière du sujet) sont
// sous-représentés dans la rotation plutôt qu'à parts égales avec qcm/
// texte_a_trous/intrus — l'IA garde par ailleurs la liberté de
// repasser sur "qcm" si le sujet retenu pour une question précise ne se
// prête vraiment pas au format suggéré (cf. consigne plus bas).
// "vrai_faux" retiré le 16/08/2026 (section 5, interdiction absolue — ~50%
// de réussite au hasard structurel) : ses 3 créneaux sont redistribués vers
// texte_a_trous et intrus, jusque-là sous-représentés par rapport à qcm.
const DAILY_QUIZ_FORMAT_ROTATION_POOL = [
  "qcm", "qcm", "texte_a_trous", "qcm", "texte_a_trous",
  "intrus", "qcm", "association", "qcm", "qcm_multi",
  "qcm", "ordre", "intrus", "qcm", "intrus"
];

// `excludeTypes` (demande du 13/08/2026, étendu le 16/08/2026) : retire un
// ou plusieurs formats de la rotation — utilisé pour bannir "intrus" des QCM
// sur liste énumérable (cf. buildEnumerableQuizChunkPrompt), où il dérive
// systématiquement en "lequel de ces éléments ne fait PAS partie de la
// liste ?" — injouable dès que la liste complète peut monter jusqu'à
// NOTION_QUIZ_ENUMERABLE_MAX_ITEMS (200) éléments, que le lecteur n'a
// évidemment jamais tous en tête ; et pour bannir "ordre"/"association"/
// "qcm_multi" du même contexte (audit pédagogique du 16/08/2026), où ils
// dérivaient vers des exercices artificiels (tri alphabétique, appariements
// sans rapport réel) faute de relation entre les éléments testés un par un.
function buildFormatAssignments(count, excludeTypes) {
  const pool = excludeTypes && excludeTypes.length
    ? DAILY_QUIZ_FORMAT_ROTATION_POOL.filter((f) => !excludeTypes.includes(f))
    : DAILY_QUIZ_FORMAT_ROTATION_POOL;
  const shuffled = shuffleArray(pool);
  const assignments = [];
  for (let i = 0; i < count; i++) assignments.push(shuffled[i % shuffled.length]);
  return assignments;
}

// Un {type, desc} par format possible plutôt qu'une liste de chaînes brutes :
// permet de retirer un format (cf. excludeTypes) à la fois de la description
// et de l'énumération JSON finale, pas seulement de la rotation suggérée
// (qui ne fait qu'orienter l'IA, jamais l'empêcher de choisir un format
// décrit plus haut si elle le juge plus adapté).
// Descriptions renforcées le 16/08/2026 (audit pédagogique sur 847 questions
// réelles) sur trois points mesurés et concrets, cf. rapport d'audit :
// - qcm : ~6% des questions avaient une bonne réponse trahie par sa longueur/
//   précision (ex. "Conquête espagnole menée par Francisco Pizarro" au milieu
//   de distracteurs vagues comme "Une révolte interne des paysans"), et
//   certains distracteurs étaient hors-sujet plutôt qu'incorrects-mais-
//   plausibles (ex. "Pour construire des centrales nucléaires" comme
//   distracteur sur une question de gestion des méduses).
// - association/qcm_multi : le garde-fou existant interdisait de combiner
//   PLUSIEURS SUJETS différents, mais rien n'empêchait de combiner plusieurs
//   FAITS INDÉPENDANTS sur UN SEUL sujet (constaté : une association
//   "Louis IX" mêlant dates de règne, lieu de mort, date de canonisation et
//   pape canonisateur — quatre connaissances sans lien de correspondance
//   entre elles, jamais un vrai appariement) — signal FSRS tout-ou-rien sur
//   4 connaissances alors qu'une seule aurait pu être mal sue.
// - ordre : sans connaissance de séquence réelle disponible, le tri
//   alphabétique était utilisé comme substitut (constaté sur les listes
//   énumérables type capitales du monde) — ne teste que l'orthographe/
//   l'alphabet, pas une connaissance.
const QUESTION_FORMAT_DEFS = [
  { type: "qcm", desc: "\"qcm\" : question à 4 options, une seule correcte, les 3 fausses plausibles mais clairement erronées au vu du texte. Les 4 options doivent appartenir à la MÊME catégorie conceptuelle que la bonne réponse (ex. si la bonne réponse est un nom de personne, les distracteurs sont d'autres noms de personnes plausibles dans ce contexte — jamais une option hors-sujet ou absurde qui n'a rien à voir avec la question). Les distracteurs doivent rester globalement comparables en longueur et en niveau de précision à la bonne réponse : n'ajoute jamais spontanément un détail, un nom propre ou une précision supplémentaire à la bonne réponse qui la rendrait reconnaissable par sa seule longueur ou sa seule précision au milieu d'options plus vagues." },
  { type: "texte_a_trous", desc: "\"texte_a_trous\" : une phrase tirée du texte où un mot ou groupe de mots est remplacé par le marqueur exact \"___\" (le champ \"question\" doit contenir ce marqueur), avec 4 options pour le compléter, une seule correcte." },
  { type: "association", desc: "\"association\" : une consigne d'appariement (ex. \"Associe chaque élément à ce qui lui correspond\"), avec un tableau \"pairs\" de 3 ou 4 paires {\"left\":\"...\",\"right\":\"...\"} — n'utilise ce format QUE si le sujet retenu pour cette question offre naturellement 3 à 4 ENTITÉS DISTINCTES de la même catégorie (ex. plusieurs philosophes, plusieurs pays, plusieurs éléments chimiques) à apparier chacune à son propre correspondant. INTERDIT : combiner plusieurs sujets différents, ET combiner 3-4 attributs indépendants d'UNE SEULE entité (ex. jamais associer \"date de naissance de Louis IX\"/\"lieu de sa mort\"/\"date de sa canonisation\"/\"pape qui l'a canonisé\" — ce sont 4 connaissances séparées sur une même personne, pas un appariement ; préfère alors 4 questions \"qcm\" distinctes, une par fait). Sinon préfère un autre format." },
  { type: "intrus", desc: "\"intrus\" : 4 options dont une seule ne va pas avec les 3 autres (qui partagent un point commun clair au vu du texte) — la question formule ce qu'ont en commun les 3 bonnes et demande de trouver l'intrus ; correctIndex pointe vers l'intrus." },
  { type: "qcm_multi", desc: "\"qcm_multi\" : question à 4 ou 5 options où PLUSIEURS sont correctes (2 au minimum, jamais toutes) — un tableau \"correctIndexes\" (ex. [0,2]) au lieu de \"correctIndex\". N'utilise ce format QUE pour une vraie question d'APPARTENANCE À UNE CATÉGORIE COHÉRENTE ET CLAIREMENT DÉFINIE (ex. \"lesquelles de ces capitales sont en Asie ?\", \"lesquels sont membres permanents du Conseil de sécurité de l'ONU ?\") — jamais pour compresser plusieurs faits indépendants sur un même sujet en une seule question (ex. jamais \"lesquelles de ces affirmations sur le Piton de la Fournaise sont vraies ?\" avec des options portant chacune sur un aspect sans rapport — altitude, activité, localisation — préfère alors une question \"qcm\" séparée par fait). Sinon préfère un autre format." },
  { type: "ordre", desc: "\"ordre\" : 3 ou 4 éléments à remettre dans leur ordre correct (chronologique, logique, d'importance...) — un tableau \"items\" donné DANS LE BON ORDRE (l'affichage côté client les mélange lui-même) ; les éléments doivent être des faits ou étapes explicitement présents et ordonnés DANS LE TEXTE DE CE SUJET UNIQUEMENT — jamais un mélange d'événements tirés de sujets différents, ni un ordre déduit de connaissances extérieures au texte fourni. N'utilise ce format QUE si le sujet offre ainsi un ordre objectif et non discutable au vu du texte — JAMAIS un tri alphabétique, une longueur de nom ou tout autre critère arbitraire utilisé comme substitut faute d'un vrai ordre disponible : un tri purement alphabétique ne teste aucune connaissance, seulement l'orthographe. Sinon préfère un autre format." }
];

// `includeAltVariant` (demande du 12/08/2026) : demande en plus, pour
// chaque question, une SECONDE façon de tester exactement le même fait —
// utilisée pour qu'une repasse de répétition espacée ne pose plus jamais la
// question sous la même forme que la fois précédente (cf.
// resolveActiveQuestionVariant, alternée sans appel IA supplémentaire à
// chaque repasse — tout est généré une seule fois, ici, à la création).
// Restreint à qcm/texte_a_trous pour toute variante autre que la
// principale : les formats composites (association/intrus/qcm_multi/ordre)
// ont besoin d'éléments supplémentaires qui n'existent pas pour une simple
// reformulation d'un seul fait isolé.
function buildQuestionFormatsPromptBlock(sourceIdField, questionCount, includeVariants, excludeTypes) {
  const assignments = buildFormatAssignments(questionCount, excludeTypes);
  const availableDefs = excludeTypes && excludeTypes.length
    ? QUESTION_FORMAT_DEFS.filter((d) => !excludeTypes.includes(d.type))
    : QUESTION_FORMAT_DEFS;
  const availableTypes = availableDefs.map((d) => d.type);
  return [
    "=== Formats de question possibles ===",
    ...availableDefs.map((d) => "- " + d.desc),
    "",
    // Interdiction absolue du vrai/faux (section 5 de l'audit pédagogique du
    // 16/08/2026) : rappel explicite plutôt que de compter sur sa seule
    // absence de la liste ci-dessus — sans cette ligne, rien n'empêche l'IA
    // de recréer un format binaire équivalent sous un autre nom ou une autre
    // apparence (ex. un \"qcm\" à 2 options \"Vrai\"/\"Faux\", une question
    // fermée oui/non, correct/incorrect...). Le validateur programmatique
    // (lib/question-formats.js) impose par ailleurs toujours 4 options pour
    // qcm/texte_a_trous/intrus/qcm_multi : une tentative de contournement à 2
    // options échoue mécaniquement, même si cette consigne était ignorée.
    "INTERDICTION ABSOLUE : ne génère JAMAIS de question vrai/faux, oui/non, correct/incorrect, ni aucune formulation binaire équivalente qui donnerait artificiellement ~50% de chances de réussite au hasard — même sous un nom ou une apparence différente (ex. un \"qcm\" réduit à 2 options \"Vrai\"/\"Faux\", une question fermée dont la réponse est oui ou non). Toute question, quel que soit son format, doit toujours proposer au moins 3 options distinctes et sémantiquement plausibles (ou reposer sur un vrai appariement/une vraie séquence pour association/ordre).",
    "QUALITÉ OBLIGATOIRE : pour un QCM simple, une seule option doit être défendable et chaque distracteur doit être incontestablement faux au regard de la connaissance/source. Interdits : options sémantiquement équivalentes, \"toutes les réponses\", \"aucune de ces réponses\", double négation et piège de langage.",
    "La question doit être claire et autonome sans relire la fiche. La difficulté doit venir du savoir testé, jamais d'une formulation confuse. Avant de répondre, vérifie silencieusement la cohérence entre correctIndex/correctIndexes, le texte de la ou des bonnes options et l'explication.",
    "Respecte strictement knowledgeTarget. Si le format suggéré ne convient pas naturellement, abandonne-le au profit d'un QCM simple solide plutôt que de forcer une association, un ordre, un intrus ou un choix multiple artificiel.",
    "",
    // "intrus" banni (cf. excludeTypes) : rappel explicite plutôt que de
    // compter sur sa seule absence ci-dessus — sans cette ligne, rien
    // n'empêche l'IA de choisir "intrus" quand même en se référant au nom
    // du format qu'elle connaît par ailleurs.
    ...(excludeTypes && excludeTypes.includes("intrus") ? [
      "Le format \"intrus\" est INTERDIT pour ce quiz : n'demande jamais lequel de ces éléments ne fait PAS partie de la liste globale du sujet — la liste complète peut compter jusqu'à " + NOTION_QUIZ_ENUMERABLE_MAX_ITEMS + " éléments, le lecteur ne peut objectivement pas le savoir sans l'avoir mémorisée en entier. Injouable, donc jamais posé.",
      ""
    ] : []),
    "=== Format suggéré, question par question (dans l'ordre) ===",
    "Pour garantir une vraie variété — ne surtout pas produire uniquement des \"qcm\" — voici un format suggéré pour chacune des " + questionCount + " questions" + (includeVariants ? " (uniquement pour variants[0], la variante principale — n'influence pas le choix des variantes suivantes, cf. plus bas)" : "") + " :",
    assignments.map((f, i) => (i + 1) + ". " + f).join(" · "),
    // "Préférence de départ", pas "Respecte cette suggestion" (demande du
    // 17/08/2026, généralisation des variantes à Éclairages/Histoire) : cette
    // rotation ignore tout du contenu réel de chaque connaissance (assignée à
    // l'aveugle avant même l'admission) — depuis l'ajout de sequential/
    // clearBoundary (contraintes qui, elles, connaissent le contenu), la
    // formulation impérative précédente pouvait laisser croire à une
    // obligation entrant en tension avec ces signaux. Priorité explicite à la
    // compatibilité connaissance/format, jamais à cette suggestion seule.
    "Cette suggestion n'est qu'une préférence de départ pour éviter que tout retombe sur \"qcm\" par défaut — elle ne prime JAMAIS sur les contraintes liées au contenu réel de la connaissance testée (notamment les signaux sequential/clearBoundary indiqués plus loin, quand applicables). Écarte-la sans hésiter dès que le sujet retenu pour UNE question précise ne s'y prête vraiment pas (ex. \"association\" sans 3-4 éléments distincts à apparier, \"ordre\" sans séquence objective, \"qcm_multi\" sans plusieurs bonnes réponses nettes, \"texte_a_trous\" sans phrase adaptée) : utilise \"qcm\" à la place pour CETTE question uniquement — jamais un format forcé avec des éléments qui ne collent pas artificiellement au sujet" + (excludeTypes && excludeTypes.length ? ", et jamais l'un des formats interdits ci-dessus" : "") + ".",
    "",
    ...(includeVariants ? [
      // "jusqu'à 3 variantes pertinentes" (refonte du 16/08/2026) : remplace
      // l'ancien altVariant unique. La diversité recherchée est d'abord une
      // diversité de CHEMIN DE RÉCUPÉRATION (direct/inverse/contextuel),
      // jamais une diversité de format imposée artificiellement — 3 n'est
      // jamais une obligation, seulement un maximum.
      "=== Jusqu'à 3 variantes par question — une seule connaissance, plusieurs chemins pour la retrouver ===",
      "Avant de rédiger, identifie silencieusement le fait ou concept précis que cette question doit tester et écris-le tel quel dans le champ \"knowledgeTarget\" (ex. \"La chute du mur de Berlin a lieu en 1989.\") — une phrase factuelle courte, jamais la question elle-même.",
      // Atomicité stricte de knowledgeTarget (correctif du 16/08/2026, cas
      // réel observé : "L'armée ottomane comptait environ 80 000 hommes, les
      // défenseurs environ 7 000 à 10 000." avec V1 testant l'effectif
      // ottoman et V2 l'effectif byzantin — deux grandeurs qu'on peut savoir
      // l'une sans l'autre, empaquetées dans un seul knowledgeTarget
      // uniquement parce qu'elles partageaient la phrase source). Prompt
      // uniquement : ne touche ni au schéma, ni à FSRS, ni aux 749
      // MemoryItems historiques (altVariant), ni à la rotation des variantes.
      "RÈGLE D'ATOMICITÉ (impérative) : \"knowledgeTarget\" doit représenter UNE SEULE connaissance récupérable indépendamment. Test à appliquer silencieusement avant de rédiger : si quelqu'un peut connaître une PARTIE de ce \"knowledgeTarget\" sans connaître l'autre partie, il est trop large — scinde-le en questions séparées, chacune avec son propre \"knowledgeTarget\" atomique, plutôt que de forcer une seule question à porter les deux.",
      "N'empaquette jamais dans un seul \"knowledgeTarget\" : deux dates indépendantes, deux nombres/grandeurs indépendants, deux personnes avec leurs informations respectives, plusieurs causes distinctes, plusieurs conséquences distinctes, ou plus généralement plusieurs faits qui ne sont reliés QUE parce qu'ils apparaissent dans la même phrase ou le même paragraphe source. Exemple interdit : \"Les Ottomans étaient environ 80 000 et les défenseurs 7 000 à 10 000\" — ce sont deux connaissances (l'effectif ottoman ; l'effectif des défenseurs), donc deux questions distinctes avec chacune son \"knowledgeTarget\", jamais une seule question dont une variante teste l'un des deux chiffres et une autre variante teste l'autre. Cas particulier des grandeurs numériques : \"A vaut X, B vaut Y\" donne normalement DEUX connaissances (une par grandeur) — l'exception est quand c'est le RAPPORT ou la DISPROPORTION lui-même qui constitue le fait à retenir (ex. \"Les Ottomans étaient environ dix fois plus nombreux que les défenseurs\") : dans ce seul cas, un unique \"knowledgeTarget\" sur cette disproportion est légitime, et toutes ses variantes doivent alors tester cette disproportion elle-même, jamais l'un des deux chiffres exacts séparément.",
      "Une connaissance PEUT en revanche mentionner plusieurs éléments textuels si ceux-ci forment une seule relation indivisible entre eux (jamais deux faits juxtaposés) : \"Paris est la capitale de la France\" reste UNE connaissance (la relation Paris ↔ capitale de la France) malgré ses deux entités, tout comme \"La chute du mur de Berlin a lieu en 1989\" (la relation événement ↔ date est précisément ce qu'on veut faire retenir). Dans ces cas, une variante \"France → Paris\" et une variante \"Paris → France\" restent deux formulations de la MÊME relation, donc légitimes dans le même MemoryItem.",
      "Rédige ensuite entre 1 et 3 variantes de cette question dans le tableau \"variants\", TOUTES centrées sur ce \"knowledgeTarget\" désormais atomique. Par défaut, VISE 2 variantes (\"direct\" + \"inverse\") : pour la grande majorité des faits isolés (une date, un nom, un lieu, une définition...), l'angle inverse existe et vaut la peine d'être écrit — ne t'arrête pas à 1 variante par facilité, cherche vraiment le second angle avant d'y renoncer. Passe à 3 SEULEMENT si un troisième chemin (généralement \"contextual\") apporte réellement quelque chose de plus qu'une simple reformulation. Redescends à 1 SEULEMENT quand la connaissance cible ne se prête à aucun second angle honnête (ex. un format déjà composite en variante principale, ou un fait dont l'inverse serait ambigu ou trivial). Dans tous les cas, avant d'ajouter une variante, vérifie qu'elle reste répondable avec la SEULE connaissance cible ci-dessus — si elle exige une information supplémentaire (ex. une variante sur la date d'un événement et une autre sur qui en est responsable), ce sont deux connaissances différentes : ne l'ajoute pas, elle appartient à une autre question.",
      "Chemins de récupération possibles (champ \"retrievalMode\" sur chaque variante, optionnel mais recommandé) :",
      "- \"direct\" : du fait vers la réponse (ex. \"En quelle année tombe le mur de Berlin ?\").",
      "- \"inverse\" : de la réponse vers le fait, en restant SANS AMBIGUÏTÉ même si plusieurs faits partagent une réponse proche (ex. \"Quel événement majeur concernant Berlin a lieu en 1989 ?\" — jamais \"Que s'est-il passé en 1989 ?\", trop vague si plusieurs événements importants partagent cette année).",
      "- \"contextual\" : une mise en situation qui mène à la même réponse sans se contenter de reformuler la question posée par \"direct\" (ex. \"Quel événement de 1989 symbolise la fin de la division de l'Allemagne ?\").",
      // "jamais deux variantes du même type exact" assouplie (demande du
      // 17/08/2026) : format technique ≠ mode de récupération — deux "qcm"
      // (direct + contextual, par exemple) ne sont PAS redondants si l'angle
      // de récupération diffère réellement. La vraie règle à faire respecter
      // est l'absence de paraphrase, déjà énoncée juste avant ; le
      // dédoublonnage strict sur "type" seul l'a toujours été en trop côté
      // prompt (lib/question-formats.js validateVariantsArray, lui, dédoublonne
      // déjà sur type+question, jamais sur le seul type — inchangé ici).
      "Règles impératives : jamais deux variantes qui ne sont que des paraphrases l'une de l'autre (\"Quand ?\"/\"En quelle année ?\"/\"Quelle année ?\" ne comptent que pour UNE seule variante) ; deux variantes PEUVENT en revanche utiliser le même \"type\" si leur \"retrievalMode\" et leur angle de récupération sont réellement distincts (ex. \"qcm\"/direct + \"qcm\"/contextual sont légitimes si la seconde met la connaissance en situation plutôt que de redemander la même chose autrement) — favorise des formats différents quand ils sont également pertinents, mais ne change jamais artificiellement de format juste pour obtenir 3 types différents : deux variantes du même type, réellement complémentaires, valent mieux qu'un format mal adapté forcé pour diversifier. Priorité, dans l'ordre : fidélité au \"knowledgeTarget\" > pertinence pédagogique > angle de récupération distinct > diversité de format. Seule la variante à l'index 0 du tableau (la plus claire, montrée en premier) peut être un format composite (association/intrus/qcm_multi/ordre) — les variantes suivantes restent \"qcm\" ou \"texte_a_trous\" (jamais \"vrai_faux\", interdit sous toute forme), et si l'index 0 est déjà composite, n'ajoute aucune autre variante (une reformulation partielle d'un ensemble/séquence/catégorie ne peut pas rester honnête).",
      "Chaque variante porte ses propres champs complets (\"type\", \"question\", \"options\"/\"correctIndex\" ou équivalent selon le type, \"explanation\", \"selfContained\" pour qcm/texte_a_trous/qcm_multi UNIQUEMENT — cf. règle ci-dessous) — jamais de champ \"" + sourceIdField + "\" à l'intérieur d'une variante (implicite, commun à toutes).",
      ""
    ] : []),
    ...(includeVariants ? [] : [
      // Demande du 17/08/2026 (audit du pipeline mnésique) : knowledgeTarget
      // n'était jusqu'ici demandé qu'avec includeVariants (sujet libre) —
      // étendu à toutes les questions, y compris Éclairages/Histoire, pour
      // que buildNotionQuestions/generateNotionLevelQuiz puisse vérifier
      // programmatiquement (cf. leurs commentaires) que chaque question
      // générée correspond bien à une connaissance déjà admise, jamais une
      // connaissance inventée à ce stade.
      "Pour chaque question, écris dans le champ \"knowledgeTarget\" le texte EXACT de la connaissance admise (fournie plus bas) qu'elle teste, sans le reformuler.",
      ""
    ]),
    "=== Répondable sans voir les propositions ? ===",
    (includeVariants
      ? "Pour chaque VARIANTE de type \"qcm\", \"texte_a_trous\" ou \"qcm_multi\" UNIQUEMENT, ajoute un champ \"selfContained\" (booléen) sur cette variante — une décision qui dépend du CONTENU de cette formulation précise, jamais de son seul type ni héritée d'une autre variante de la même question."
      : "Pour chaque question de type \"qcm\", \"texte_a_trous\" ou \"qcm_multi\" UNIQUEMENT, ajoute un champ \"selfContained\" (booléen) : l'interface l'utilise pour proposer ou non de réfléchir à la réponse avant d'afficher les propositions — une décision qui dépend du CONTENU de la question, jamais de son seul type."),
    "- true : la réponse existe indépendamment des propositions, un lecteur qui connaît le sujet peut la deviner seul avant de les voir (ex. \"Quel est l'historien qui a écrit « Le Fromage et les Vers » ?\").",
    "- false : la question ne peut être comprise ou résolue qu'en comparant les propositions entre elles, ou y fait explicitement référence (ex. \"Lequel de ces historiens n'a pas travaillé sur le Moyen Âge ?\", \"Parmi ces éléments, lequel...\", toute question de type comparatif ou par élimination). Sois honnête et strict : en cas de doute réel, réponds false plutôt que true — mieux vaut afficher les propositions à tort que de bloquer une question à laquelle on ne peut objectivement pas répondre sans elles.",
    "Aucun champ \"selfContained\" pour les autres types (association, intrus, ordre) — la question n'est jamais concernée par ce choix.",
    "",
    includeVariants
      // Exemple à DEUX objets dans "variants" (pas un seul) : un modèle
      // pattern-matche fortement sur la forme littérale de l'exemple — un
      // tableau à un seul élément dans le schéma final produisait
      // systématiquement 1 seule variante partout, malgré une consigne en
      // prose demandant d'en viser 2 (constaté le 16/08/2026 : 18/18
      // questions à 1 variante sur deux générations réelles avant ce
      // correctif). L'exemple est donc explicitement direct+inverse.
      ? `Réponds uniquement en JSON strict, sous la forme {"questions":[{"knowledgeTarget":"...","variants":[{"type":"${availableTypes.join("|")}","question":"(formulation directe)","options":["..."] (qcm/texte_a_trous/intrus/qcm_multi uniquement),"correctIndex":0 (qcm/texte_a_trous/intrus uniquement),"correctIndexes":[0,2] (qcm_multi uniquement),"pairs":[{"left":"...","right":"..."}] (association uniquement),"items":["...","..."] (ordre uniquement, dans le bon ordre),"explanation":"...","selfContained":true|false (qcm/texte_a_trous/qcm_multi uniquement),"retrievalMode":"direct"},{"type":"qcm|texte_a_trous","question":"(formulation inverse ou contextuelle, PAS une paraphrase de la première)","options":["..."],"correctIndex":0,"explanation":"...","selfContained":true|false,"retrievalMode":"inverse"}],"${sourceIdField}":"id fourni"}]} — 2 variantes dans cet exemple, mais rappel : 1 seule si aucun second angle honnête n'existe, 3 si un troisième chemin apporte vraiment quelque chose.`
      : `Réponds uniquement en JSON strict, sous la forme {"questions":[{"knowledgeTarget":"...","type":"${availableTypes.join("|")}","question":"...","options":["..."] (qcm/texte_a_trous/intrus/qcm_multi uniquement),"correctIndex":0 (qcm/texte_a_trous/intrus uniquement),"correctIndexes":[0,2] (qcm_multi uniquement),"pairs":[{"left":"...","right":"..."}] (association uniquement),"items":["...","..."] (ordre uniquement, dans le bon ordre),"explanation":"...","selfContained":true|false (qcm/texte_a_trous/qcm_multi uniquement),"${sourceIdField}":"id fourni"}]}.`
  ];
}

// shuffleArray, shuffleOptionsPreservingCorrectIndex(es), QUESTION_TYPES,
// FILL_BLANK_MARKER, CUSTOM_GRADED_CORRECT_INDEX, les validateurs de format
// (association/qcm_multi/ordre/core/altVariant) et validateQuestionItemCore
// vivent désormais dans lib/question-formats.js (extrait le 16/08/2026, audit
// pédagogique des QCM) — ce sont des fonctions pures, testées unitairement
// là-bas (test/question-formats.test.js), importées en haut de ce fichier.

// ── QCM "Ce jour dans l'Histoire" et "Parallèle historique" ────────────────
// Deux créneaux narratifs de plus (même table/schéma daily_quiz), mais avec
// bien moins de matière première par jour (1 à 3 événements ou parallèles)
// qu'un pool d'arènes actu : la règle "une question par source, jamais deux
// fois la même" du QCM actu ne tient pas ici, sous peine de ne jamais
// atteindre un nombre de questions correct — plusieurs questions par
// événement/parallèle sont donc autorisées (bornées), avec une cible de
// questions plus petite en conséquence.
// Cible 3 à 5 questions par QCM de notion (cf. buildNotionQuestions, généré
// à la demande sur une seule notion — un événement "Ce jour dans l'Histoire"
// ou un item Éclairages). DAILY_QUIZ_QUESTION_COUNT_NARRATIVE n'est plus
// qu'un plafond de sécurité pour validateNarrativeQuizQuestions (jamais
// atteint en pratique sur une seule notion) ; DAILY_QUIZ_TARGET_QUESTIONS_PER_RUBRIC
// est le budget réel visé.
const DAILY_QUIZ_QUESTION_COUNT_NARRATIVE = 45;
// 1, jamais plus (demande du 17/08/2026, audit du pipeline mnésique) : ce
// n'était plus un vrai plancher qualité mais un quota de remplissage — un
// sujet qui n'admet légitimement qu'1 ou 2 connaissances solides doit
// pouvoir produire 1 ou 2 questions, jamais être rejeté en bloc (return [])
// faute d'atteindre un minimum arbitraire. La seule exigence technique
// restante est qu'il existe AU MOINS une question valide à montrer.
const DAILY_QUIZ_MIN_VALID_QUESTIONS_NARRATIVE = 1;
// target reste un budget "jusqu'à" indicatif pour le prompt (cf.
// buildCultureGeneraleQuizPrompt) — jamais une obligation depuis le même
// correctif : la qualité prime sur l'atteinte de ce chiffre.
const DAILY_QUIZ_TARGET_QUESTIONS_PER_RUBRIC = 4;
const DAILY_QUIZ_MAX_QUESTIONS_PER_RUBRIC = 5;

// Niveau d'approfondissement choisi par l'utilisateur avant génération d'un
// QCM de notion de débat ou de sujet libre (demande du 12/08/2026, affinée le
// 12/08/2026 : les questions ne doivent porter que sur ce qui mérite vraiment
// d'être su, et un niveau plus élevé doit diversifier les angles couverts —
// pas seulement empiler plus de questions sur le même angle). `instruction`
// est injectée dans le prompt IA (cf. buildCultureGeneraleQuizPrompt/
// buildLeveledFicheAndQuizPrompt) pour que la difficulté et la diversité
// suivent vraiment le niveau. `sectionsRange`/`maxSections`/`lengthHint`
// dimensionnent la fiche associée (elle doit contenir tous les faits
// nécessaires pour répondre aux questions, cf. buildLeveledFicheAndQuizPrompt)
// : plus le niveau est avancé, plus elle peut être longue.
// min uniformément à 1 sur les 4 niveaux (demande du 17/08/2026, audit du
// pipeline mnésique) : c'était jusqu'ici un plancher de remplissage (3/8/15/
// 15) qui rejetait le quiz ENTIER (parseLeveledFicheAndQuiz retourne null,
// cf. son commentaire) dès que la sélection qualité produisait moins que ce
// chiffre — poussant mécaniquement vers des connaissances secondaires
// juste pour l'atteindre, l'exact inverse de l'objectif "la qualité prime
// sur la quantité". "target"/"max" restent inchangés : ils bornent haut
// (combien de facettes couvrir au mieux), jamais bas.
const NOTION_QUIZ_LEVELS = {
  elementaire: {
    label: "Élémentaire",
    target: 5, max: 6, min: 1,
    instruction: "Niveau élémentaire : ne retiens que les quelques faits vraiment essentiels du sujet — questions simples et directement accessibles, vocabulaire courant, pour poser les bases sans détail secondaire.",
    sectionsRange: "1 à 2", maxSections: 2, sectionTextLimit: 600,
    lengthHint: "reste très brève, l'essentiel condensé en quelques phrases par bloc."
  },
  avance: {
    label: "Avancé",
    target: 10, max: 12, min: 1,
    instruction: "Niveau avancé : couvre l'essentiel du sujet sous plusieurs angles différents (contexte, mécanisme, exemples ou chiffres clés, conséquences) pour vérifier une compréhension solide — jamais plusieurs questions qui reformulent le même angle.",
    sectionsRange: "2 à 4", maxSections: 4, sectionTextLimit: 1000,
    lengthHint: "peut développer chaque bloc en quelques phrases pour donner du contexte et de la nuance."
  },
  expert: {
    label: "Expert",
    target: 20, max: 22, min: 1,
    instruction: "Niveau expert : couvre un maximum de facettes distinctes et réellement importantes du sujet (origine, mécanismes précis, controverses ou nuances, chiffres et exemples précis, conséquences, comparaisons) pour vérifier une maîtrise fine et complète — chaque question doit apporter un angle vraiment différent des autres, jamais une reformulation d'une question déjà posée.",
    sectionsRange: "4 à 6", maxSections: 6, sectionTextLimit: 1600,
    lengthHint: "peut être longue et détaillée, avec plusieurs blocs développés (contexte, mécanisme, chiffres/exemples précis, controverses ou nuances, conséquences) pour couvrir le sujet en profondeur."
  },
  // 4e niveau (demande du 13/08/2026) : seul celui-ci déclenche la détection
  // de sujet énumérable et le quiz par lots jusqu'à
  // NOTION_QUIZ_ENUMERABLE_MAX_ITEMS (cf. scopeCustomTopic/
  // fetchEnumerableItems/buildEnumerableCustomTopicQuiz, gardés sur
  // level === "exhaustif" désormais, plus "expert") — "expert" redevient un
  // palier normal borné à une vingtaine de questions. Pour un sujet non
  // énumérable (repli sur le flux standard), mêmes chiffres qu'"expert" :
  // la vraie différence de ce niveau est la couverture complète d'une liste,
  // pas un nombre de questions plus élevé par défaut sur un sujet narratif.
  exhaustif: {
    label: "Exhaustif",
    target: 20, max: 22, min: 1,
    instruction: "Niveau exhaustif : vise la couverture la plus complète possible du sujet — s'il s'agit d'une vraie liste d'éléments à mémoriser un par un, couvre-la en entier ; sinon, couvre un maximum de facettes et de détails précis et vérifiables du sujet, sans jamais sacrifier l'exactitude à la quantité.",
    sectionsRange: "4 à 6", maxSections: 6, sectionTextLimit: 1600,
    lengthHint: "peut être longue et détaillée, avec plusieurs blocs développés (contexte, mécanisme, chiffres/exemples précis, controverses ou nuances, conséquences) pour couvrir le sujet en profondeur."
  }
};
// Comportement historique (clic "Mémoriser" sur Éclairages / Ce jour dans
// l'Histoire, cf. views/eclairages.html) : cette page ne propose aucun choix
// de niveau à l'utilisateur — on y garde exactement le dimensionnement
// d'avant l'introduction des niveaux plutôt que de lui appliquer un niveau
// par défaut arbitraire.
const NOTION_QUIZ_LEGACY_LEVEL_CONFIG = {
  label: null,
  target: DAILY_QUIZ_TARGET_QUESTIONS_PER_RUBRIC,
  max: DAILY_QUIZ_MAX_QUESTIONS_PER_RUBRIC,
  min: DAILY_QUIZ_MIN_VALID_QUESTIONS_NARRATIVE,
  instruction: null,
  sectionsRange: "1 à 3", maxSections: 3, sectionTextLimit: 1200,
  lengthHint: "couvre l'essentiel à retenir sur ce sujet."
};

// Sujet libre "énumérable" en niveau Expert (demande du 12/08/2026 : capitales
// du monde, verbes irréguliers, vocabulaire d'une langue... — une vraie liste
// finie d'éléments à mémoriser un par un, où le plafond expert normal
// (NOTION_QUIZ_LEVELS.expert.max) est trop restrictif). Détecté par
// scopeCustomTopic ; si détecté, la fiche liste directement les éléments
// (jamais reformulés par l'IA) et le quiz est généré par lots successifs
// (un seul appel IA ne tient pas de façon fiable au-delà d'une vingtaine de
// questions) plutôt que par le flux standard buildLeveledFicheAndQuizPrompt.
const NOTION_QUIZ_ENUMERABLE_MAX_ITEMS = 200;
const NOTION_QUIZ_ENUMERABLE_CHUNK_SIZE = 20;
// Volontairement PAS ramené à 1 comme NOTION_QUIZ_LEVELS.*.min (demande du
// 17/08/2026, audit du pipeline mnésique) : ce seuil ne mesure pas
// l'importance de connaissances sélectionnées mais la complétude technique
// d'une énumération déjà reconnue comme une vraie liste finie (capitales,
// verbes irréguliers...) — 10/200 capitales renvoyées à cause d'erreurs de
// lots successifs est un échec de génération, pas un choix qualité légitime
// à respecter. Reste donc un garde-fou de fiabilité, hors périmètre de ce
// correctif (cf. rapport final, section quotas).
const NOTION_QUIZ_ENUMERABLE_MIN_VALID = 10;
// Plafond dur du nombre de lots d'énumération (fetchEnumerableItems) — borne
// le coût en appels IA même sur un sujet mal classé "bounded" : au-delà, on
// s'arrête avec ce qu'on a plutôt que de continuer indéfiniment (demande du
// 12/08/2026 : le vrai garde-fou de coût reste le tri "bounded"/"unbounded"
// à la source, cf. buildTopicScopePrompt, mais ce plafond protège aussi
// contre une mauvaise classification).
const NOTION_QUIZ_ENUMERABLE_MAX_ROUNDS = Math.ceil(NOTION_QUIZ_ENUMERABLE_MAX_ITEMS / NOTION_QUIZ_ENUMERABLE_CHUNK_SIZE) + 3;
// Second garde-fou de coût (demande du 12/08/2026), en amont du premier :
// un sujet "bounded" dont l'IA estime elle-même le compte d'éléments
// au-delà de ce seuil est bloqué dès le petit appel de repérage — avant de
// dépenser les ~20 appels IA d'énumération puis de génération — plutôt que
// d'attendre le plafond dur ci-dessus après coup. Fixé au-dessus des plus
// gros exemples validés (ex. "Os du corps humain" ~206) pour ne pas les
// bloquer, mais sous NOTION_QUIZ_ENUMERABLE_MAX_ITEMS pour agir avant que la
// troncature silencieuse n'entre en jeu.
const NOTION_QUIZ_ENUMERABLE_ESTIMATE_BLOCK_THRESHOLD = 250;

function resolveNotionQuizLevel(rawLevel) {
  const level = String(rawLevel || "").trim();
  if (NOTION_QUIZ_LEVELS[level]) return { level, ...NOTION_QUIZ_LEVELS[level] };
  return { level: null, ...NOTION_QUIZ_LEGACY_LEVEL_CONFIG };
}

// Champs communs (current_topic_id/title, shared_mechanism, essential_difference)
// mais champs "concept" propres à chaque rubrique — formatage par type plutôt
// qu'un seul gabarit générique.
function formatEclairagesItemForPrompt(item) {
  const common = `${String(item.current_topic_title || "").trim()}`;
  const sharedMechanism = truncateAtTextBoundary(item.shared_mechanism, 500);
  const essentialDifference = truncateAtTextBoundary(item.essential_difference, 500);
  if (item.type === "parallele") {
    return `- id:${item.current_topic_id} | Type : parallèle historique | Actualité : ${common} | Précédent historique : ${String(item.historical_event_title || "").trim()}\n  Contexte historique : ${String(item.historical_context || "").trim().slice(0, 700).replace(/\s+/g, " ")}\n  Mécanisme commun : ${sharedMechanism}\n  Différence essentielle : ${essentialDifference}`;
  }
  if (item.type === "pensee") {
    return `- id:${item.current_topic_id} | Type : pensée philosophique | Actualité : ${common} | Concept : ${String(item.philosophical_concept || "").trim()} (${String(item.philosopher_name || "").trim()})\n  Origine du concept : ${truncateAtTextBoundary(item.concept_origin, 500)}\n  Explication : ${truncateAtTextBoundary(item.concept_explanation, 500)}\n  Mécanisme commun : ${sharedMechanism}\n  Différence essentielle : ${essentialDifference}`;
  }
  if (item.type === "mecanisme") {
    return `- id:${item.current_topic_id} | Type : mécanisme sociologique | Actualité : ${common} | Concept : ${String(item.sociological_concept || "").trim()} (${String(item.sociologist_name || "").trim()})\n  Origine du concept : ${truncateAtTextBoundary(item.concept_origin, 500)}\n  Explication : ${truncateAtTextBoundary(item.concept_explanation, 500)}\n  Mécanisme commun : ${sharedMechanism}\n  Différence essentielle : ${essentialDifference}`;
  }
  if (item.type === "concept") {
    return `- id:${item.current_topic_id} | Type : concept du jour | Actualité : ${common} | Concept : ${String(item.concept_name || "").trim()} (${String(item.concept_originator || "").trim()})\n  Origine du concept : ${truncateAtTextBoundary(item.concept_origin, 500)}\n  Explication : ${truncateAtTextBoundary(item.concept_explanation, 500)}\n  Mécanisme commun : ${sharedMechanism}\n  Différence essentielle : ${essentialDifference}`;
  }
  if (item.type === "oeuvre") {
    return `- id:${item.current_topic_id} | Type : œuvre d'art du jour | Actualité : ${common} | Œuvre : ${String(item.artwork_title || "").trim()} (${String(item.artist_name || "").trim()}, ${String(item.artwork_date || "").trim()})\n  Description de l'œuvre : ${truncateAtTextBoundary(item.artwork_description, 500)}\n  Présentation de l'artiste : ${truncateAtTextBoundary(item.artist_presentation, 500)}`;
  }
  // Notion extraite d'une arène de débat (cf. extractDebateTopicNotions) :
  // pas de "shared_mechanism"/"essential_difference" (pas de parallèle avec
  // une actualité tierce, la notion vient déjà du débat lui-même).
  if (item.type === "debat-notion") {
    return `- id:${item.current_topic_id} | Type : notion de débat | Débat : ${common} | Notion : ${String(item.notion_name || "").trim()}\n  Explication : ${String(item.notion_explanation || "").trim().slice(0, 600).replace(/\s+/g, " ")}`;
  }
  if (item.type === "latin") {
    const grammar = (Array.isArray(item.grammar_breakdown) ? item.grammar_breakdown : [])
      .map((g) => `${String(g.word || "").trim()} (${String(g.note || "").trim()})`)
      .join(" ; ");
    const originLabel = { article: "reprise du sujet d'actualité", attested: "expression latine réellement attestée", composed: "traduction composée pour l'occasion, PAS une expression ancienne" }[item.phrase_origin] || "inconnue";
    return `- id:${item.current_topic_id} | Type : mot latin du jour | Actualité : ${common} | Expression latine : « ${String(item.latin_phrase || "").trim()} » (${String(item.literal_translation || "").trim()}) | Provenance : ${originLabel}\n  Sens et usage : ${truncateAtTextBoundary(item.explanation, 500)}\n  Grammaire : ${truncateAtTextBoundary(grammar, 600)}`;
  }
  // Citation du jour : présentation simplifiée à l'affichage (pas de
  // shared_mechanism/essential_difference montrés au lecteur), mais choisie
  // en écho à un sujet d'actualité comme les autres — current_topic_id est
  // bien présent (cf. lib/citation-du-jour.js).
  return `- id:${item.current_topic_id} | Type : citation du jour | Citation : « ${truncateAtTextBoundary(item.quote_text, 500)} » — ${String(item.quote_author || "").trim()}\n  Origine de la citation : ${truncateAtTextBoundary(item.quote_origin, 300)}\n  Présentation de l'auteur : ${truncateAtTextBoundary(item.author_presentation, 500)}`;
}

function formatCultureGeneraleItemForPrompt(item) {
  if (item.type === "histoire") {
    return `- id:${item.id} | Type : Ce jour dans l'Histoire | ${item.year_display || item.year} | ${String(item.title || "").trim()}\n  ${String(item.summary_long || "").trim().slice(0, 900).replace(/\s+/g, " ")}`;
  }
  return formatEclairagesItemForPrompt(item);
}

// L'IA ne capitalise pas toujours la première lettre des noms de concept
// (ex. "construction sociale de la déviance") — corrigé systématiquement à
// l'extraction plutôt que de dépendre de la sortie du modèle.
function capitalizeFirstLetter(str) {
  const trimmed = String(str || "").trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : trimmed;
}

// Nom court identifiant la rubrique (concept/mécanisme/auteur/œuvre/etc.) de
// chaque candidat, reporté sur la question générée (cf. sourceName ci-dessous)
// pour permettre à "Mes acquis" de trier ses cartes par ordre alphabétique
// sur ce nom plutôt que sur la date de dernière réponse.
function extractCultureGeneraleItemName(item) {
  let raw;
  switch (item.type) {
    case "histoire": raw = item.title; break;
    case "parallele": raw = item.historical_event_title; break;
    case "pensee": raw = item.philosophical_concept; break;
    case "mecanisme": raw = item.sociological_concept; break;
    case "concept": raw = item.concept_name; break;
    case "citation": raw = item.quote_author; break;
    case "oeuvre": raw = item.artwork_title; break;
    case "latin": raw = item.latin_phrase; break;
    case "debat-notion": raw = item.notion_name; break;
    default: raw = "";
  }
  return capitalizeFirstLetter(raw);
}

// Image associée au concept/mécanisme/auteur/œuvre (mêmes champs que la page
// /eclairages pour cette rubrique) — null si aucune image n'a été trouvée à
// la génération. `source` vaut "press" quand l'image vient de l'actualité du
// jour plutôt que de Wikipedia (seules les rubriques parallele/pensee/
// mecanisme/concept distinguent les deux, cf. views/eclairages.html).
function extractCultureGeneraleItemImage(url, credit, pageUrl, source) {
  const u = String(url || "").trim();
  if (!u) return null;
  return {
    url: u,
    credit: String(credit || "").trim() || null,
    pageUrl: String(pageUrl || "").trim() || null,
    source: String(source || "").trim() || null
  };
}

// Détail "pur" du concept/mécanisme/citation/œuvre — les mêmes champs que la
// page /eclairages pour cette rubrique, moins tout ce qui relie l'élément à
// l'actualité du jour (current_topic_title/summary, shared_mechanism,
// essential_difference, conclusion, news_connection) : la fiche de "Mes
// acquis" (cf. sourceDetail ci-dessous) doit rester valable même une fois
// l'actualité d'origine oubliée. { meta: string|null, sections: [{ label:
// string|null, text: string }], image: {url,credit,pageUrl,source}|null }.
function extractCultureGeneraleItemDetail(item) {
  const t = (v) => String(v || "").trim();
  const metaJoin = (parts) => parts.map(t).filter(Boolean).join(" — ") || null;
  switch (item.type) {
    case "histoire": {
      const sections = [];
      if (t(item.summary_long)) sections.push({ label: null, text: t(item.summary_long) });
      if (t(item.why_it_matters)) sections.push({ label: "Pourquoi c'est important", text: t(item.why_it_matters) });
      return { meta: t(item.year_display || item.year) || null, sections, image: null };
    }
    case "parallele":
      return {
        meta: t(item.historical_event_date) || null,
        sections: [{ label: null, text: t(item.historical_context) }],
        image: extractCultureGeneraleItemImage(item.historical_event_image_url, item.historical_event_image_credit, item.historical_event_image_page_url, item.historical_event_image_source)
      };
    case "pensee":
      return {
        meta: metaJoin([item.philosopher_name, item.concept_origin]),
        sections: [{ label: null, text: t(item.concept_explanation) }],
        image: extractCultureGeneraleItemImage(item.philosophical_concept_image_url, item.philosophical_concept_image_credit, item.philosophical_concept_image_page_url, item.philosophical_concept_image_source)
      };
    case "mecanisme":
      return {
        meta: metaJoin([item.sociologist_name, item.concept_origin]),
        sections: [{ label: null, text: t(item.concept_explanation) }],
        image: extractCultureGeneraleItemImage(item.sociological_concept_image_url, item.sociological_concept_image_credit, item.sociological_concept_image_page_url, item.sociological_concept_image_source)
      };
    case "concept":
      return {
        meta: metaJoin([item.concept_originator, item.concept_origin]),
        sections: [{ label: null, text: t(item.concept_explanation) }],
        image: extractCultureGeneraleItemImage(item.concept_image_url, item.concept_image_credit, item.concept_image_page_url, item.concept_image_source)
      };
    case "citation":
      return {
        meta: null,
        sections: [
          { label: null, text: `« ${t(item.quote_text)} »` },
          t(item.quote_origin) ? { label: null, text: t(item.quote_origin) } : null,
          t(item.author_presentation) ? { label: "L'auteur", text: t(item.author_presentation) } : null
        ].filter(Boolean),
        image: extractCultureGeneraleItemImage(item.quote_author_image_url, item.quote_author_image_credit, item.quote_author_image_page_url, null)
      };
    case "oeuvre":
      return {
        meta: metaJoin([item.artist_name, item.artwork_date]),
        sections: [
          t(item.artwork_description) ? { label: "L'œuvre", text: t(item.artwork_description) } : null,
          t(item.artist_presentation) ? { label: "L'artiste", text: t(item.artist_presentation) } : null
        ].filter(Boolean),
        image: extractCultureGeneraleItemImage(item.artwork_image_url, item.artwork_image_credit, item.artwork_image_page_url, null)
      };
    case "latin": {
      const breakdown = Array.isArray(item.grammar_breakdown) ? item.grammar_breakdown : [];
      const grammarSections = breakdown.map((entry, i) => ({
        label: i === 0 ? "Grammaire" : null,
        text: `${t(entry.word)} — ${t(entry.note)}`
      }));
      // Honnêteté sur la provenance (phrase_origin, cf. lib/latin-du-jour.js) :
      // reportée dans le "meta" de la fiche pour ne jamais laisser croire
      // qu'une traduction composée pour l'occasion est une citation ancienne.
      const originLabel = { article: "reprise du sujet d'actualité", attested: "expression latine attestée", composed: "traduction composée pour l'occasion" }[item.phrase_origin] || null;
      return {
        meta: metaJoin([item.literal_translation, originLabel]),
        sections: [
          { label: null, text: `« ${t(item.latin_phrase)} »` },
          t(item.explanation) ? { label: "Sens et usage", text: t(item.explanation) } : null,
          ...grammarSections
        ].filter(Boolean),
        image: null
      };
    }
    case "debat-notion":
      return { meta: t(item.current_topic_title) || null, sections: [{ label: null, text: t(item.notion_explanation) }], image: null };
    default:
      return { meta: null, sections: [], image: null };
  }
}

// ── Sélection des connaissances (admission), séparée de la génération des
// questions (demande du 17/08/2026, audit du pipeline mnésique) — extraites
// dans lib/knowledge-admission.js (comme lib/question-formats.js le 16/08),
// pour être testables sans démarrer tout server.js : buildKnowledgeAdmissionPrompt,
// buildQuestionsFromKnowledgePrompt, buildFicheAndKnowledgeAdmissionPrompt,
// buildKnowledgeVerificationPrompt, applyKnowledgeVerificationDecisions
// (importées plus haut). Cf. ce fichier pour le détail de l'architecture
// (admission → vérification indépendante pour le sujet libre → génération).

// Validation adaptée aux QCM narratifs : une même source peut porter
// plusieurs questions (maxPerSource), utile sur un QCM de notion où une
// seule source alimente tout le lot de questions.
// L'IA recopie parfois le token "id:xxx" du prompt tel quel dans sourceId
// (avec le préfixe "id:", cf. formatCultureGeneraleItemForPrompt) au lieu de
// n'en garder que la valeur — observé en pratique (constaté le 09/08/2026,
// génération de "notion:histoire:..." entièrement rejetée, 0/4 questions
// valides à cause de ce seul artefact) : préfixe retiré avant comparaison
// plutôt que de rejeter la question.
function validateNarrativeQuizQuestions(rawQuestions, validSourceIds, maxTotal, maxPerSource) {
  if (!Array.isArray(rawQuestions)) return [];
  const validIds = new Set(validSourceIds.map(String));
  const countPerSource = new Map();
  const valid = [];
  for (const item of rawQuestions) {
    const core = validateQuestionItemCore(item);
    if (!core) continue;
    const sourceId = String(item?.sourceId ?? "").trim().replace(/^id:/i, "").trim();
    if (!sourceId || !validIds.has(sourceId)) continue;
    const usedCount = countPerSource.get(sourceId) || 0;
    if (usedCount >= maxPerSource) continue;
    countPerSource.set(sourceId, usedCount + 1);
    valid.push({ ...core, sourceDebateId: sourceId });
    if (valid.length >= maxTotal) break;
  }
  return valid;
}

// Chaîne V2 commune à toutes les sorties fraîchement générées. Elle reçoit
// les objets BRUTS (avant validateQuestionItemCore et donc avant shuffle),
// exécute validation déterministe + critique sémantique, puis régénère
// uniquement les refusés. Le mélange et son verrou structurel final restent
// ensuite assurés par validateQuestionItemCoreBase (lib/question-formats.js).
async function qualityControlRawQuestions({
  apiKey,
  rawQuestions,
  basePrompt,
  route,
  context = {},
  timeoutMs
}) {
  const startedAt = Date.now();
  const outcome = await runQuestionQualityPipeline(rawQuestions, {
    semanticReviewEnabled: QCM_SEMANTIC_REVIEW_ENABLED,
    maxRetries: QCM_SEMANTIC_REVIEW_MAX_RETRIES,
    maxTechnicalRetries: QCM_CRITIC_TECHNICAL_MAX_RETRIES,
    context,
    reviewSemantic: async ({ entries, context: reviewContext }) => {
      const content = await _callOpenAI(apiKey, [{ role: "user", content: buildSemanticReviewPrompt(entries, reviewContext) }], {
        model: DAILY_QUIZ_CRITIC_MODEL,
        temperature: 0.1,
        responseFormat: { type: "json_object" },
        timeoutMs: timeoutMs || 90_000,
        feature: "question_semantic_review"
      });
      return JSON.parse(content);
    },
    regenerate: async ({ rejected, accepted, attempt }) => {
      const rejectionPayload = rejected.map((entry, index) => ({
        replacementIndex: index,
        sourceId: entry.question?.sourceId || entry.question?.sourceDebateId || null,
        knowledgeTarget: entry.question?.knowledgeTarget || null,
        rejectedQuestion: entry.question,
        reasonCodes: entry.reasons.map((item) => item.code),
        reasonMessages: entry.reasons.map((item) => item.message)
      }));
      const acceptedPayload = accepted.map((question) => ({
        sourceId: question?.sourceId || question?.sourceDebateId || null,
        knowledgeTarget: question?.knowledgeTarget || null,
        question: question?.question || question?.variants?.[0]?.question || null,
        options: question?.options || question?.variants?.[0]?.options || null
      }));
      const regenerationPrompt = [
        basePrompt,
        "",
        `CYCLE DE RÉGÉNÉRATION CIBLÉE ${attempt}. Remplace exactement ${rejectionPayload.length} question(s) refusée(s), et uniquement celles-ci.`,
        "Corrige explicitement chaque motif. Ne réutilise aucune formulation ni aucun ensemble d’options refusé. Ne duplique aucune question déjà acceptée.",
        "Questions déjà acceptées (interdit de les régénérer ou de les paraphraser) :",
        JSON.stringify(acceptedPayload),
        "Questions refusées et motifs à corriger :",
        JSON.stringify(rejectionPayload),
        `Réponds uniquement avec {"questions":[...]} contenant exactement ${rejectionPayload.length} remplacement(s).`
      ].join("\n");
      const content = await _callOpenAI(apiKey, [{ role: "user", content: regenerationPrompt }], {
        model: DAILY_QUIZ_NARRATIVE_MODEL,
        temperature: 0.35,
        responseFormat: { type: "json_object" },
        timeoutMs: timeoutMs || 90_000,
        feature: "question_targeted_regeneration"
      });
      const parsed = JSON.parse(content);
      return Array.isArray(parsed?.questions) ? parsed.questions.slice(0, rejectionPayload.length) : [];
    }
  });
  // Observabilité agrégée uniquement : aucun texte de question, fait privé,
  // contenu de document ou identifiant utilisateur n'est journalisé.
  console.info("[qcm-quality]", JSON.stringify({
    route,
    model: DAILY_QUIZ_NARRATIVE_MODEL,
    criticModel: QCM_SEMANTIC_REVIEW_ENABLED ? DAILY_QUIZ_CRITIC_MODEL : null,
    semanticReviewEnabled: QCM_SEMANTIC_REVIEW_ENABLED,
    latencyMs: Date.now() - startedAt,
    ...outcome.metrics
  }));
  return outcome.accepted;
}

// QCM d'une seule notion (un événement "Ce jour dans l'Histoire" ou un item
// Éclairages, cf. buildNotionQuestions plus bas) ou d'un sujet libre/notion
// de débat avec niveau (cf. generateNotionLevelQuiz plus bas), généré à la
// demande au clic sur "Mémoriser" — jamais par lot ni planifié.
// buildFicheAndKnowledgeAdmissionPrompt/buildKnowledgeVerificationPrompt/
// applyKnowledgeVerificationDecisions (sujet libre) et
// buildKnowledgeAdmissionPrompt/buildQuestionsFromKnowledgePrompt
// (Éclairages/Histoire + sujet libre) vivent désormais dans
// lib/knowledge-admission.js — cf. ce fichier pour le détail de
// l'architecture (admission → vérification indépendante pour le sujet libre
// → génération des questions à partir des seules connaissances admises).

// Parse la fiche + les connaissances candidates communes à
// buildFicheAndKnowledgeAdmissionPrompt — factorisé entre buildNotionQuestions
// (notion de débat avec niveau) et buildCustomTopicQuiz (sujet libre). Ne
// tranche PAS ici le sort des candidats (cf. buildKnowledgeVerificationPrompt,
// une passe séparée) : se contente de la structure fiche + validation
// structurelle des candidats (validateKnowledgeCandidates).
function parseFicheAndKnowledgeCandidates(parsed, fallbackName, levelConfig) {
  const { maxSections, sectionTextLimit, max } = levelConfig;
  const sourceName = capitalizeFirstLetter(String(parsed?.sourceName || fallbackName).trim()).slice(0, 120);
  const sections = Array.isArray(parsed?.sections)
    ? parsed.sections
        .map((s) => ({ label: s?.label ? String(s.label).trim().slice(0, 80) : null, text: String(s?.text || "").trim().slice(0, sectionTextLimit) }))
        .filter((s) => s.text)
        .slice(0, maxSections)
    : [];
  if (!sourceName || !sections.length) return null;
  const sourceDetail = { meta: parsed?.meta ? String(parsed.meta).trim().slice(0, 200) : null, sections, image: null };
  const candidates = validateKnowledgeCandidates(parsed?.knowledge, { max });
  // imageSearchQuery : fournie par le MÊME appel IA que la fiche (aucun appel
  // dédié, cf. lib/knowledge-image-search.js) — résolue par l'appelant
  // (generateNotionLevelQuiz) en une seule recherche externe, jamais ici.
  const imageSearchQuery = sanitizeImageSearchQuery(parsed?.imageSearchQuery);
  return { sourceName, sourceDetail, candidates, imageSearchQuery };
}

// ── Orchestration complète du sujet libre / notion de débat avec niveau
// (demande du 17/08/2026) : fiche + candidats → vérification indépendante
// batchée (EN PARALLÈLE d'une éventuelle recherche d'image, cf.
// lib/knowledge-image-search.js et imageSearchQuery ci-dessus, résolue une
// seule fois ici) → questions à partir des seuls candidats acceptés.
// Factorisé entre buildNotionQuestions (notion de débat) et
// buildCustomTopicQuiz (recherche libre), qui ne différaient déjà que par
// `subject`/`contextHint`/`requireValidation`/le préfixe de l'id de
// question. Retourne :
// - {error:"rejected", reason} : sujet refusé à l'étape 1 (requireValidation) ;
// - {error:"failed", reason} : échec technique OU aucune connaissance
//   n'a passé l'admission+vérification (cas normal, cf. §26 — jamais un
//   contenu de repli fabriqué pour éviter une liste vide) ;
// - {sourceName, sourceDetail, validated} : succès.
async function generateNotionLevelQuiz(apiKey, subject, contextHint, id, levelConfig, requireValidation) {
  const { target, instruction, max, min } = levelConfig;
  const timeoutMs = Math.min(120_000, 45_000 + target * 3_000);

  let parsed;
  try {
    const content = await _callOpenAI(apiKey, [{ role: "user", content: buildFicheAndKnowledgeAdmissionPrompt(subject, contextHint, levelConfig, requireValidation) }], {
      model: DAILY_QUIZ_NARRATIVE_MODEL,
      temperature: 0.4,
      responseFormat: { type: "json_object" },
      timeoutMs,
      feature: "knowledge_generation"
    });
    parsed = JSON.parse(content);
  } catch (error) {
    console.error(`[notion-quiz:${id}] fiche + admission :`, error.message);
    return { error: "failed" };
  }
  if (requireValidation && parsed?.valid === false) {
    const reason = String(parsed?.reason || "").trim().slice(0, 300);
    return { error: "rejected", reason: reason || "Ce sujet ne peut pas être transformé en fiche de révision." };
  }

  const ficheResult = parseFicheAndKnowledgeCandidates(parsed, subject, levelConfig);
  if (!ficheResult) {
    console.warn(`[notion-quiz:${id}] fiche invalide.`);
    return { error: "failed" };
  }
  const { sourceName, sourceDetail, candidates, imageSearchQuery } = ficheResult;
  // Cas normal (cf. §26 du cahier des charges), jamais une erreur en soi :
  // rien dans ce que le modèle a rédigé ne méritait d'être admis. Ne
  // JAMAIS enchaîner sur une génération de questions dans ce cas.
  if (!candidates.length) {
    console.warn(`[notion-quiz:${id}] aucune connaissance candidate après admission.`);
    return { error: "failed", reason: "Aucune connaissance suffisamment fiable et importante n'a été trouvée sur ce sujet." };
  }

  // Recherche d'image (cf. lib/knowledge-image-search.js) menée EN PARALLÈLE
  // de la vérification indépendante — indépendante par nature (aucun besoin
  // d'attendre l'issue de la vérification) — plutôt qu'un appel séquentiel
  // supplémentaire qui allongerait la latence perçue. `.catch(() => null)` :
  // un échec de la recherche d'image ne doit JAMAIS faire échouer
  // Promise.all ni donc la vérification qui tourne à côté (§8 du cahier des
  // charges — jamais bloquant pour la génération principale).
  let accepted;
  let resolvedImage = null;
  try {
    const [verifyContent, imageResult] = await Promise.all([
      _callOpenAI(apiKey, [{ role: "user", content: buildKnowledgeVerificationPrompt(candidates, sourceName) }], {
        model: DAILY_QUIZ_NARRATIVE_MODEL,
        temperature: 0.2,
        responseFormat: { type: "json_object" },
        feature: "knowledge_verification"
      }),
      imageSearchQuery
        ? searchKnowledgeImage(imageSearchQuery, { logLabel: `${id}:${sourceName}` }).catch((error) => {
            console.warn(`[notion-quiz:${id}] recherche image :`, error.message);
            return null;
          })
        : Promise.resolve(null)
    ]);
    accepted = applyKnowledgeVerificationDecisions(candidates, JSON.parse(verifyContent)?.decisions);
    resolvedImage = imageResult;
  } catch (error) {
    // Passe de vérification indisponible : conservateur par défaut, on
    // n'admet RIEN plutôt que de se rabattre sur les candidats non
    // vérifiés (jamais de repli qui contournerait le contrôle demandé).
    console.error(`[notion-quiz:${id}] vérification indépendante :`, error.message);
    return { error: "failed" };
  }
  sourceDetail.image = resolvedImage;
  if (!accepted.length) {
    console.warn(`[notion-quiz:${id}] aucune connaissance n'a passé la vérification indépendante (${candidates.length} candidate(s)).`);
    return { error: "failed", reason: "Aucune connaissance suffisamment fiable et importante n'a été trouvée sur ce sujet." };
  }

  let validated = [];
  // Une seule génération initiale : les reprises sont désormais exclusivement
  // ciblées dans qualityControlRawQuestions. Rejouer ce lot entier ici
  // régénérerait aussi les questions déjà acceptées, contrairement au contrat V2.
  const questionAttempts = 1;
  for (let attempt = 1; attempt <= questionAttempts; attempt++) {
    const formatBlock = buildQuestionFormatsPromptBlock("sourceId", accepted.length, true);
    const questionPrompt = buildQuestionsFromKnowledgePrompt("sourceId", id, accepted, instruction, formatBlock);
    try {
      const content = await _callOpenAI(apiKey, [{ role: "user", content: questionPrompt }], {
        model: DAILY_QUIZ_NARRATIVE_MODEL,
        temperature: 0.4,
        responseFormat: { type: "json_object" },
        timeoutMs,
        feature: "question_generation"
      });
      const questionsParsed = JSON.parse(content);
      const qualityApproved = await qualityControlRawQuestions({
        apiKey,
        rawQuestions: questionsParsed?.questions,
        basePrompt: questionPrompt,
        route: "free_search",
        timeoutMs,
        context: { hasIndependentSource: false }
      });
      // filterQuestionsToAdmittedKnowledge (demande du 17/08/2026) : garde-fou
      // structurel en plus de la consigne de prompt — retire toute question dont
      // le knowledgeTarget ne correspond à AUCUNE connaissance acceptée.
      validated = filterVariantsByKnowledgeConstraints(
        filterQuestionsToAdmittedKnowledge(
          validateNarrativeQuizQuestions(qualityApproved, [id], max, max),
          accepted
        ),
        accepted
      );
      if (validated.length >= min) break;
      console.warn(`[notion-quiz:${id}] questions non conformes (tentative ${attempt}/${questionAttempts}, ${validated.length} valide(s)).`);
    } catch (error) {
      // Une erreur HTTP/réseau a déjà épuisé les trois tentatives internes de
      // _callOpenAI : ne jamais empiler une nouvelle série de requêtes.
      if (error?.status) {
        console.error(`[notion-quiz:${id}] génération des questions :`, error.message);
        return { error: "failed" };
      }
      console.warn(`[notion-quiz:${id}] JSON questions invalide (tentative ${attempt}/${questionAttempts}) :`, error.message);
    }
  }
  if (validated.length < min) {
    console.warn(`[notion-quiz:${id}] seulement ${validated.length} question(s) valide(s) et traçable(s) sur ${accepted.length} connaissance(s) acceptée(s).`);
    return { error: "failed" };
  }

  return { sourceName, sourceDetail, validated };
}

async function buildNotionQuestions(sourceType, sourceId, rawItem, rawLevel, userId) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];
  const id = String(sourceId || "").trim();
  if (!id) return [];
  const item = { ...rawItem, type: sourceType, id, current_topic_id: id };
  const levelConfig = resolveNotionQuizLevel(rawLevel);
  const { level, instruction } = levelConfig;

  // Notion de débat avec niveau choisi (toujours le cas depuis le
  // 12/08/2026, cf. activateDebateNotion côté client) : fiche ET quiz
  // réécrits en un seul appel IA, la fiche scalant avec le niveau — au lieu
  // de recopier tel quel le court `notion_explanation` extrait une fois pour
  // toutes à la génération des notions du débat (comportement d'avant le
  // 12/08/2026, insuffisant pour servir de support de révision complet).
  if (level) {
    const subject = capitalizeFirstLetter(String(rawItem?.notion_name || "").trim()) || "cette notion";
    const debateQuestion = String(rawItem?.current_topic_title || "").trim();
    const seedExplanation = String(rawItem?.notion_explanation || "").trim();
    const contextHint = [
      debateQuestion ? `cette notion apparaît dans un débat d'actualité intitulé « ${debateQuestion} »` : null,
      seedExplanation ? `point de départ : ${seedExplanation}` : null
    ].filter(Boolean).join(" ; ") || null;

    // generateNotionLevelQuiz (demande du 17/08/2026, audit du pipeline
    // mnésique) : fiche + admission des connaissances → vérification
    // indépendante batchée → questions à partir des seules connaissances
    // acceptées, au lieu d'un seul appel qui décidait et questionnait à la
    // fois (cf. le commentaire de generateNotionLevelQuiz pour le détail).
    const result = await generateNotionLevelQuiz(apiKey, subject, contextHint, id, levelConfig, false);
    if (result.error) {
      console.warn(`[notion-quiz:${sourceType}:${id}] ${result.error} : ${result.reason || "fiche ou QCM invalide."}`);
      return [];
    }
    const { sourceName, sourceDetail, validated } = result;
    const sourcePlacement = await classifyCultureGeneraleKnowledgePlacementWithAI(sourceType, sourceName, sourceDetail, userId, id);
    const sourceThemes = sourcePlacement?.category ? [sourcePlacement.category] : [];
    return validated.map((q, index) => ({
      id: `notion:${sourceType}:${id}-${level}-q${index + 1}`,
      ...q,
      sourceType,
      sourceScope: null,
      sourceName,
      sourceDetail,
      sourceThemes,
      sourcePlacement,
      level,
      sourceDebateId: id
    }));
  }

  // ── Comportement historique (clic "Mémoriser" sur Éclairages / Ce jour
  // dans l'Histoire, cf. views/eclairages.html) : aucun choix de niveau,
  // fiche déjà écrite en base (extractCultureGeneraleItemDetail) réutilisée
  // telle quelle, seules les questions sont générées par IA. ──
  // Garde-fou "Ce jour dans l'Histoire" (cf. isHistoricalEventMemorizable) :
  // rejette AVANT tout appel IA un événement pas suffisamment validé, sans
  // jamais faire confiance au `rawItem` envoyé par le client. Éclairages
  // (sourceType ≠ "histoire") n'a pas d'équivalent aujourd'hui — hors
  // périmètre de cette demande, qui ne portait que sur review_status/
  // date_certainty, propres au jeu de données historique.
  if (sourceType === "histoire" && !isHistoricalEventMemorizable(id)) {
    console.warn(`[notion-quiz:histoire:${id}] événement pas suffisamment validé (review_status/date_certainty), génération refusée.`);
    return [];
  }
  const sourceName = extractCultureGeneraleItemName(item);
  const sourceDetail = extractCultureGeneraleItemDetail(item);
  const sourceScope = sourceType === "histoire" ? (["france", "europe"].includes(item.category) ? item.category : "world") : null;

  let sourceThemes = [];
  let sourcePlacement = null;
  let admissionParsed;
  try {
    // Le placement complet (thématique unique → solar → étoile) est mené en
    // parallèle de l'admission des connaissances. Il est figé dans le QCM
    // pour que toutes ses questions et sa future acquisition partagent la
    // même branche de la mémoire.
    const [admissionContent, placement] = await Promise.all([
      _callOpenAI(apiKey, [{ role: "user", content: buildKnowledgeAdmissionPrompt(formatCultureGeneraleItemForPrompt(item), instruction) }], {
        model: DAILY_QUIZ_NARRATIVE_MODEL,
        temperature: 0.3,
        responseFormat: { type: "json_object" },
        feature: "knowledge_generation"
      }),
      classifyCultureGeneraleKnowledgePlacementWithAI(sourceType, sourceName, sourceDetail, userId, id)
    ]);
    admissionParsed = JSON.parse(admissionContent);
    sourcePlacement = placement;
    sourceThemes = placement?.category ? [placement.category] : [];
  } catch (error) {
    console.error(`[notion-quiz:${sourceType}:${id}] admission des connaissances :`, error.message);
    return [];
  }
  // Cas normal, jamais une erreur (cf. buildKnowledgeAdmissionPrompt) : rien
  // dans cet élément ne méritait une mémorisation durable. Ne JAMAIS
  // enchaîner sur une génération de questions dans ce cas — il n'y a rien à
  // questionner par construction.
  const admittedKnowledge = validateKnowledgeCandidates(admissionParsed?.knowledge, { max: levelConfig.max });
  if (!admittedKnowledge.length) {
    console.warn(`[notion-quiz:${sourceType}:${id}] aucune connaissance admise, pas de QCM généré.`);
    return [];
  }

  let parsed;
  try {
    // includeVariants:true (demande du 17/08/2026, généralisation des variantes) :
    // Éclairages/Histoire utilisaient jusqu'ici includeVariants:false (une seule
    // formulation par connaissance) — bascule sur le même mécanisme variants[]/
    // knowledgeTarget déjà utilisé par le sujet libre (cf. buildQuestionFormatsPromptBlock,
    // lib/knowledge-admission.js), réutilisé tel quel : rien de dupliqué. 1 à 3
    // variantes par connaissance admise, jamais un quota (cf. son propre commentaire
    // "vise 2 variantes par défaut... redescends à 1 seulement quand...").
    const formatBlock = buildQuestionFormatsPromptBlock("sourceId", admittedKnowledge.length, true);
    const questionPrompt = buildQuestionsFromKnowledgePrompt("sourceId", id, admittedKnowledge, instruction, formatBlock);
    const content = await _callOpenAI(apiKey, [{ role: "user", content: questionPrompt }], {
      model: DAILY_QUIZ_NARRATIVE_MODEL,
      temperature: 0.4,
      responseFormat: { type: "json_object" },
      feature: "question_generation"
    });
    parsed = JSON.parse(content);
    parsed.questions = await qualityControlRawQuestions({
      apiKey,
      rawQuestions: parsed?.questions,
      basePrompt: questionPrompt,
      route: `notion_${sourceType}`,
      context: {
        hasIndependentSource: true,
        sourceExcerptFor: (_sourceId, question) => String(question?.knowledgeTarget || "").slice(0, 1200)
      }
    });
  } catch (error) {
    console.error(`[notion-quiz:${sourceType}:${id}] génération des questions :`, error.message);
    return [];
  }
  // filterQuestionsToAdmittedKnowledge (demande du 17/08/2026) : garde-fou
  // structurel en plus de la consigne de prompt — retire toute question dont
  // le knowledgeTarget ne correspond à AUCUNE connaissance admise.
  // filterVariantsByKnowledgeConstraints (demande du 17/08/2026, second
  // mini-patch) : ensuite seulement — retire toute variante "ordre"/"intrus"
  // non justifiée par sequential/clearBoundary, indépendamment du prompt.
  const validated = filterVariantsByKnowledgeConstraints(
    filterQuestionsToAdmittedKnowledge(
      validateNarrativeQuizQuestions(parsed?.questions, [id], levelConfig.max, levelConfig.max),
      admittedKnowledge
    ),
    admittedKnowledge
  );
  if (validated.length < levelConfig.min) {
    console.warn(`[notion-quiz:${sourceType}:${id}] seulement ${validated.length} question(s) valide(s) et traçable(s) sur ${admittedKnowledge.length} connaissance(s) admise(s).`);
    return [];
  }

  return validated.map((q, index) => ({
    id: `notion:${sourceType}:${id}-q${index + 1}`,
    ...q,
    sourceType,
    sourceScope,
    sourceName,
    sourceDetail,
    sourceThemes,
    sourcePlacement,
    level: null,
    // Sans ce champ, POST /api/daily-quiz/answer n'appelle jamais
    // recordDailyQuizEclairageAcquisition pour ce QCM (elle exige
    // sourceDebateId, cf. son early-return) : une bonne réponse restait sans
    // effet sur "Ma mémoire" malgré isCultureGeneraleQuestionId qui reconnaît
    // pourtant déjà le préfixe "notion:" (demande du 10/08/2026).
    sourceDebateId: id
  }));
}

// ── QCM d'un sujet libre (barre de recherche "Mes apprentissages") ─────────
// Clé de slot dérivée du texte tapé plutôt que d'un id fourni par le client
// (aucun id stable n'existe pour un sujet libre) : deux visiteurs tapant le
// même sujet à la casse/aux accents/à la ponctuation près rejoignent ainsi le
// même QCM déjà généré au lieu d'en régénérer un (même principe de partage
// que buildNotionQuestions, cf. POST /api/users/notion-quizzes/custom).
function normalizeCustomTopicKey(topic) {
  const normalized = String(topic || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 16);
}

// Import photo : une connaissance déjà sélectionnée à partir de la
// transcription ET validée explicitement par l'utilisateur entre directement
// dans le générateur commun de questions. On ne relance ni une admission ni
// une réécriture de fiche : cela risquerait de modifier le fait validé. Les
// mêmes validateurs et variantes que les autres QCM de notion restent ensuite
// appliqués, et le MemoryItem/FSRS sera créé par le chemin canonique à la
// première réponse (applyFsrsReviewForDailyQuizAnswer).
// Classification + mise en forme finale d'UNE connaissance importée dont la
// question a déjà été générée et validée — factorisé (24/08/2026) entre
// buildImportedKnowledgeQuestions (génération individuelle, aussi utilisée
// comme repli ciblé du batch) et buildImportedKnowledgeQuestionsBatch
// (génération groupée) pour ne jamais dupliquer cette logique. Toujours un
// appel IA de classification PAR connaissance dans les deux cas, jamais
// batché : cf. le commentaire de buildImportedKnowledgeQuestionsBatch pour
// la raison (dépendance aux Solars déjà créés pour CET utilisateur, y
// compris par une connaissance précédente du même import).
async function finalizeImportedKnowledgeQuestion(question, fact, id, userId, sharedSourceDetail, documentImportId, sourceType) {
  const sourceName = fact.slice(0, 120);
  // Le placement reste propre à CETTE connaissance : la fiche documentaire
  // globale peut couvrir plusieurs domaines et ne doit pas fusionner leur
  // classification. Seul le sourceDetail stocké/affiché est partagé.
  const classificationDetail = {
    meta: "Connaissance issue d'un document importé",
    sections: [{ label: null, text: fact }],
    image: null
  };
  const sourcePlacement = await classifyCultureGeneraleKnowledgePlacementWithAI(
    sourceType, sourceName, classificationDetail, userId, id
  );
  const sourceThemes = sourcePlacement?.category ? [sourcePlacement.category] : [];
  return {
    id: `notion:${sourceType}:${documentImportId}:${id}-q1`,
    ...question,
    sourceType,
    sourceScope: null,
    sourceName,
    sourceDetail: sharedSourceDetail,
    sourceThemes,
    sourcePlacement,
    level: null,
    documentImportId,
    sourceDebateId: id
  };
}

async function buildImportedKnowledgeQuestions(knowledge, id, userId, sharedSourceDetail, documentImportId, sourceType) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const fact = String(knowledge || "").trim().replace(/\s+/g, " ");
  if (!fact) return [];
  const admittedKnowledge = [{
    fact,
    importance: "high",
    certainty: "high",
    // Le pipeline photo ne fournit pas ces deux signaux. Valeurs
    // conservatrices : jamais de format ordre/intrus choisi arbitrairement.
    sequential: false,
    clearBoundary: false
  }];

  let parsed;
  try {
    const formatBlock = buildQuestionFormatsPromptBlock("sourceId", 1, true);
    const questionPrompt = buildQuestionsFromKnowledgePrompt("sourceId", id, admittedKnowledge, null, formatBlock);
    const content = await _callOpenAI(apiKey, [{
      role: "user",
      content: questionPrompt
    }], {
      model: DAILY_QUIZ_NARRATIVE_MODEL,
      temperature: 0.4,
      responseFormat: { type: "json_object" },
      feature: "question_generation"
    });
    parsed = JSON.parse(content);
    parsed.questions = await qualityControlRawQuestions({
      apiKey,
      rawQuestions: parsed?.questions,
      basePrompt: questionPrompt,
      route: sourceType || "knowledge_import",
      context: { hasIndependentSource: true, sourceExcerpt: fact }
    });
  } catch (error) {
    console.error(`[photo-knowledge:${id}] génération des questions :`, error.message);
    return [];
  }

  const validated = filterVariantsByKnowledgeConstraints(
    filterQuestionsToAdmittedKnowledge(
      validateNarrativeQuizQuestions(parsed?.questions, [id], 1, 1),
      admittedKnowledge
    ),
    admittedKnowledge
  );
  if (validated.length !== 1) return [];

  const finalized = await finalizeImportedKnowledgeQuestion(validated[0], fact, id, userId, sharedSourceDetail, documentImportId, sourceType);
  return [finalized];
}

// Génère en UN SEUL appel IA les questions de plusieurs connaissances d'un
// même import (audit coût import photo, 24/08/2026) — au lieu d'un appel par
// connaissance. `items` : jusqu'à NOTION_QUIZ_ENUMERABLE_CHUNK_SIZE à la
// fois (même plafond que generateEnumerableQuizQuestions, et pour la même
// raison documentée là-bas : au-delà, un seul appel IA ne tient pas de façon
// fiable — troncature, qualité qui se dégrade). L'appelant (addValidatedKnowledgeImport)
// est responsable de découper en lots de cette taille.
//
// Chaque connaissance porte ici son propre id, jamais un id partagé (cf.
// buildQuestionsFromKnowledgePrompt, mode "un id par connaissance") — le
// modèle doit recopier CET id précis dans "sourceId" pour la question qui la
// teste. Mapping vérifié en DEUX temps, jamais sur le seul ordre du tableau
// ni sur le seul id renvoyé : (1) validateNarrativeQuizQuestions rejette tout
// id inconnu et plafonne à 1 question par id (donc aussi les doublons) ; (2)
// ci-dessous, le "knowledgeTarget" de la question doit en plus correspondre
// EXACTEMENT au fait de CETTE connaissance précise (pas seulement à une
// connaissance quelconque du lot, déjà garanti par filterQuestionsToAdmittedKnowledge) —
// une connaissance/id désynchronisés est ignorée ici plutôt que risquer
// d'associer une question au mauvais fait ; elle retombe alors sur le repli
// individuel de l'appelant, comme une connaissance manquante.
//
// Ne fait QUE générer : la classification et la mise en forme finale restent
// hors de cette fonction (cf. finalizeImportedKnowledgeQuestion), volontairement
// pas batchées — une classification compare le placement de CETTE connaissance
// aux Solars déjà créés pour l'utilisateur, y compris ceux qu'une connaissance
// précédente du MÊME lot vient tout juste de créer : un appel groupé figerait
// cette liste au moment du prompt et risquerait un Solar dupliqué pour deux
// connaissances proches d'un même import.
async function buildImportedKnowledgeQuestionsBatch(items, documentImportId) {
  const allIds = items.map((it) => it.id);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !items.length) return { resultsById: new Map(), missingIds: allIds };

  const admittedKnowledge = items.map((item) => ({
    id: item.id,
    fact: item.fact,
    importance: "high",
    certainty: "high",
    sequential: false,
    clearBoundary: false
  }));

  try {
    const formatBlock = buildQuestionFormatsPromptBlock("sourceId", items.length, true);
    const questionPrompt = buildQuestionsFromKnowledgePrompt("sourceId", null, admittedKnowledge, null, formatBlock);
    const content = await _callOpenAI(apiKey, [{
      role: "user",
      content: questionPrompt
    }], {
      model: DAILY_QUIZ_NARRATIVE_MODEL,
      temperature: 0.4,
      responseFormat: { type: "json_object" },
      timeoutMs: Math.min(120_000, 45_000 + items.length * 3_000),
      feature: "question_generation"
    });
    const parsed = JSON.parse(content);
    parsed.questions = await qualityControlRawQuestions({
      apiKey,
      rawQuestions: parsed?.questions,
      basePrompt: questionPrompt,
      route: "knowledge_import_batch",
      timeoutMs: Math.min(120_000, 45_000 + items.length * 3_000),
      context: {
        hasIndependentSource: true,
        sourceExcerptFor: (sourceId, question) => admittedKnowledge.find((item) => item.id === sourceId)?.fact || question?.knowledgeTarget || null
      }
    });
    const validated = filterVariantsByKnowledgeConstraints(
      filterQuestionsToAdmittedKnowledge(
        validateNarrativeQuizQuestions(parsed?.questions, allIds, items.length, 1),
        admittedKnowledge
      ),
      admittedKnowledge
    );
    // reconcileKnowledgeBatchResults (lib/question-formats.js) : dernière
    // vérification id<->knowledgeTarget + dédoublonnage, cf. son commentaire.
    const { resultsById, missingIds } = reconcileKnowledgeBatchResults(validated, admittedKnowledge);
    if (missingIds.length) {
      console.warn(`[photo-knowledge:batch:${documentImportId}] ${missingIds.length}/${items.length} connaissance(s) sans question exploitable dans le lot, repli individuel prévu.`);
    }
    return { resultsById, missingIds };
  } catch (error) {
    console.error(`[photo-knowledge:batch:${documentImportId}] génération groupée des questions :`, error.message);
    // Échec total de l'appel groupé : toutes les connaissances du lot
    // retombent sur le repli individuel de l'appelant (buildImportedKnowledgeQuestions),
    // jamais une erreur remontée ici — même philosophie conservatrice que
    // buildImportedKnowledgeQuestions lui-même.
    return { resultsById: new Map(), missingIds: allIds };
  }
}

// Détermine, avant toute génération, si un sujet libre en niveau Expert
// désigne une vraie liste énumérable (cf. NOTION_QUIZ_ENUMERABLE_MAX_ITEMS).
// Ne demande PAS la liste elle-même ici (voir fetchEnumerableItems) : un
// essai réel a montré qu'un unique appel réclamant jusqu'à 200 éléments d'un
// coup (ex. verbes irréguliers anglais) se fait régulièrement tronquer en
// cours de génération par le filtre de contenu d'OpenAI (finish_reason:
// "content_filter", déclenché sur un mot totalement anodin comme "shoot"
// dans une liste de verbes) — la réponse devient alors du JSON invalide.
// Un échec de cet appel (ou une réponse mal formée) n'est jamais bloquant :
// il retombe silencieusement sur le flux standard (enumerable:false), jamais
// sur une erreur affichée à l'utilisateur pour ce seul appel de repérage.
function buildTopicScopePrompt(topic) {
  return [
    `Un visiteur veut mémoriser ce sujet, tapé librement dans une barre de recherche : "${topic}".`,
    "",
    "Étape 1 : vérifie que ce sujet désigne bien un sujet de connaissance réel et sérieux (fait historique, scientifique, culturel, géographique, technique, etc.) sur lequel on peut écrire une fiche factuelle vérifiable. Refuse (valid:false) s'il est vide, absurde, injurieux, dangereux, illégal, à caractère sexuel, ou trop vague/générique pour donner une fiche précise (ex. \"tout\", \"la vie\").",
    "Si le sujet n'est pas valide, réponds uniquement : {\"valid\":false,\"reason\":\"phrase courte en français expliquant pourquoi, destinée à être affichée à l'utilisateur\"}",
    "",
    "Étape 2 : classe ce sujet dans une de ces trois catégories (champ \"scope\") :",
    `- "bounded" : une VÉRITABLE liste finie et raisonnablement bornée d'éléments distincts à mémoriser un par un, dont tu peux estimer un nombre total réaliste et non arbitraire (ex. les capitales du monde ~195, les pays de l'Union européenne ~27, les verbes irréguliers anglais courants, les éléments chimiques, les présidents d'un pays, les départements français, les drapeaux). Ajoute alors un champ "estimatedCount" : ton estimation du nombre total réel d'éléments (un entier, ta meilleure estimation même approximative).`,
    `- "unbounded" : un sujet en apparence énumérable mais SANS liste naturellement complète ou bornée — il faudrait piocher arbitrairement dans un ensemble bien plus vaste que ce qu'on peut raisonnablement couvrir, sans qu'un sous-ensemble précis s'impose de lui-même (ex. "le vocabulaire italien" seul, "les mots anglais", "des expressions en espagnol"). Choisis "unbounded" plutôt que d'inventer une sélection arbitraire.`,
    `- "narrative" : un sujet narratif, conceptuel ou événementiel (ex. la Révolution française, la photosynthèse, un mécanisme, une notion, un événement historique précis), même s'il comporte de nombreuses dates ou de nombreux faits — pas une liste d'éléments à énumérer.`,
    "Si \"unbounded\", ajoute un champ \"reason\" : une phrase courte en français expliquant que le sujet est trop large et suggérant comment le préciser (ex. un thème, une catégorie, une sous-liste), destinée à être affichée telle quelle à l'utilisateur.",
    "",
    "\"sourceName\" : nom court et correctement capitalisé du sujet (ex. \"Capitales du monde\", \"Verbes irréguliers anglais\") — reformule si la saisie de départ est une question ou une phrase, jamais recopiée telle quelle dans ce cas.",
    "",
    "Réponds uniquement en JSON strict, sans aucun texte autour, sous l'une de ces formes exactement :",
    "- Sujet refusé : {\"valid\":false,\"reason\":\"...\"}",
    "- Sujet trop large : {\"valid\":true,\"scope\":\"unbounded\",\"reason\":\"...\",\"sourceName\":\"...\"}",
    "- Sujet borné : {\"valid\":true,\"scope\":\"bounded\",\"estimatedCount\":123,\"sourceName\":\"...\"}",
    "- Sujet narratif : {\"valid\":true,\"scope\":\"narrative\",\"sourceName\":\"...\"}"
  ].join("\n");
}

async function scopeCustomTopic(apiKey, topic) {
  try {
    const content = await _callOpenAI(apiKey, [{ role: "user", content: buildTopicScopePrompt(topic) }], {
      model: DAILY_QUIZ_NARRATIVE_MODEL,
      temperature: 0.3,
      responseFormat: { type: "json_object" },
      feature: "knowledge_topic_scope"
    });
    const parsed = JSON.parse(content);
    if (!parsed || parsed.valid === false) {
      const reason = String(parsed?.reason || "").trim().slice(0, 300);
      return { rejected: true, reason: reason || "Ce sujet ne peut pas être transformé en fiche de révision." };
    }
    const sourceName = capitalizeFirstLetter(String(parsed.sourceName || topic).trim()).slice(0, 120);
    if (parsed.scope === "unbounded") {
      const reason = String(parsed?.reason || "").trim().slice(0, 300);
      return { rejected: true, reason: reason || "Ce sujet est trop large pour être couvert de façon exhaustive — essaie de le préciser (un thème, une catégorie, une sous-liste)." };
    }
    // Second garde-fou de coût (cf. NOTION_QUIZ_ENUMERABLE_ESTIMATE_BLOCK_THRESHOLD) :
    // un sujet borné mais dont l'IA elle-même estime le compte très au-delà
    // du plafond technique est bloqué ici, avant de dépenser les ~20 appels
    // d'énumération puis de génération pour un sujet qu'on sait déjà trop
    // volumineux. Estimation absente ou non numérique : jamais bloquant (le
    // plafond dur de fetchEnumerableItems/NOTION_QUIZ_ENUMERABLE_MAX_ITEMS
    // protège de toute façon en aval).
    const estimatedCount = Number(parsed.estimatedCount);
    if (parsed.scope === "bounded" && Number.isFinite(estimatedCount) && estimatedCount > NOTION_QUIZ_ENUMERABLE_ESTIMATE_BLOCK_THRESHOLD) {
      return {
        rejected: true,
        reason: `Ce sujet compte environ ${estimatedCount} éléments, trop pour une liste complète — essaie de le diviser en plusieurs sujets plus précis.`
      };
    }
    return { rejected: false, enumerable: parsed.scope === "bounded", sourceName };
  } catch (error) {
    console.warn("[notion-quizzes:custom] repérage IA du sujet échoué, repli sur le flux standard :", error.message);
    return { rejected: false, enumerable: false, sourceName: null };
  }
}

// Récupère la liste réelle des éléments d'un sujet énumérable, lot par lot
// (jamais en un seul appel géant, cf. buildTopicScopePrompt) : chaque lot
// demande les prochains éléments encore non couverts, jusqu'à
// NOTION_QUIZ_ENUMERABLE_MAX_ITEMS ou jusqu'à ce que l'IA indique ne plus
// avoir d'élément distinct à ajouter ("exhausted":true). Un lot en échec ne
// bloque pas les suivants (le lot suivant redemande simplement "la suite").
function buildEnumerableItemsChunkPrompt(subject, alreadyCovered, count) {
  const lines = [`Sujet : "${subject}" — une vraie liste finie d'éléments à mémoriser un par un (ex. capitales, verbes irréguliers, vocabulaire d'une langue...).`];
  if (alreadyCovered.length) {
    lines.push("Éléments déjà couverts dans les lots précédents (ne les reprends JAMAIS) :");
    lines.push(alreadyCovered.map((it) => `- ${it}`).join("\n"));
  } else {
    lines.push("Aucun élément couvert pour l'instant : c'est le premier lot.");
  }
  lines.push("");
  lines.push(`Donne ${count} éléments NOUVEAUX et DISTINCTS de cette liste (jamais déjà couverts ci-dessus), chacun sous une forme courte et autonome qui donne à la fois l'élément ET sa réponse (ex. "France – Paris", "go – went – gone", "la mela – la pomme").`);
  lines.push("Priorise les éléments les plus utiles/représentatifs/couramment enseignés du sujet (ex. les capitales les plus connues avant les plus rares, les verbes irréguliers les plus fréquents avant les plus rares) — utile en culture générale, jamais un choix arbitraire ou anecdotique quand plusieurs éléments restent possibles pour ce lot.");
  lines.push("Chaque élément doit être réellement exact et vérifiable — en cas de doute réel sur un élément précis (orthographe, forme, association), écarte-le plutôt que de l'inclure avec une réponse incertaine.");
  lines.push("Si le sujet ne compte plus assez d'éléments réellement distincts et non déjà couverts pour ce lot, donne-en le maximum possible sans jamais répéter ou inventer, et indique \"exhausted\":true.");
  lines.push("");
  lines.push("Réponds uniquement en JSON strict, sous la forme {\"exhausted\":false,\"items\":[\"...\",\"...\"]}.");
  return lines.join("\n");
}

async function fetchEnumerableItems(apiKey, subject) {
  const items = [];
  const seen = new Set();
  for (let round = 0; round < NOTION_QUIZ_ENUMERABLE_MAX_ROUNDS && items.length < NOTION_QUIZ_ENUMERABLE_MAX_ITEMS; round++) {
    const askCount = Math.min(NOTION_QUIZ_ENUMERABLE_CHUNK_SIZE, NOTION_QUIZ_ENUMERABLE_MAX_ITEMS - items.length);
    try {
      const content = await _callOpenAI(apiKey, [{ role: "user", content: buildEnumerableItemsChunkPrompt(subject, items, askCount) }], {
        model: DAILY_QUIZ_NARRATIVE_MODEL,
        temperature: 0.4,
        responseFormat: { type: "json_object" },
        feature: "knowledge_enumerable_items"
      });
      const parsed = JSON.parse(content);
      const newItems = Array.isArray(parsed?.items) ? parsed.items.map((it) => String(it || "").trim()).filter(Boolean) : [];
      let addedAny = false;
      for (const it of newItems) {
        const key = it.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(it);
        addedAny = true;
        if (items.length >= NOTION_QUIZ_ENUMERABLE_MAX_ITEMS) break;
      }
      if (parsed?.exhausted || !addedAny) break;
    } catch (error) {
      console.warn(`[notion-quizzes:custom] énumération lot ${round + 1} échouée, on tente la suite :`, error.message);
    }
  }
  return items;
}

// Fiche d'un sujet énumérable : construite directement à partir de la liste
// réelle d'éléments plutôt que reformulée par l'IA — garantit qu'elle
// contient exactement les mêmes faits que les questions générées, sans
// risque de divergence ni d'invention (demande du 12/08/2026 : la fiche doit
// contenir les réponses).
function buildEnumerableFicheSections(items) {
  const chunkSize = 25;
  const sections = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    sections.push({ label: `Éléments ${i + 1} à ${Math.min(i + chunkSize, items.length)}`, text: chunk.join(" · ") });
  }
  return sections;
}

function buildEnumerableQuizChunkPrompt(subject, itemsChunk, id) {
  const count = itemsChunk.length;
  // "intrus" banni ici (demande du 13/08/2026) : sur une liste énumérable
  // (jusqu'à NOTION_QUIZ_ENUMERABLE_MAX_ITEMS éléments), il dérivait
  // systématiquement en "lequel de ces éléments ne fait pas partie de la
  // liste ?" — injouable, personne ne mémorise 200 éléments comme un tout.
  //
  // "ordre"/"association"/"qcm_multi" bannis ici aussi (audit pédagogique du
  // 16/08/2026) : la consigne juste en dessous génère UNE question par
  // ÉLÉMENT INDIVIDUEL de la liste (ex. "capitale du Sénégal ?"), il n'existe
  // donc structurellement aucune relation entre plusieurs éléments à
  // apparier/ordonner/regrouper dans ce contexte. Forcés quand même, ces
  // formats produisaient des exercices artificiels sans vraie base de
  // connaissance — constaté en pratique : "ordre" dérivait vers un simple tri
  // alphabétique des capitales (ne teste que l'orthographe), et
  // "association"/"qcm_multi" bricolaient un regroupement de 3-4 éléments
  // choisis au hasard dans la liste plutôt qu'un ensemble réellement
  // cohérent. Ce contexte reste "qcm"/"texte_a_trous" — les formats qui
  // testent honnêtement UN élément à la fois.
  const formatBlock = buildQuestionFormatsPromptBlock("sourceId", count, true, ["intrus", "ordre", "association", "qcm_multi"]).slice(0, -1);
  return [
    `Tu écris un quiz de mémorisation en français sur : "${subject}".`,
    "Éléments à couvrir dans ce lot (base-toi UNIQUEMENT sur ceux-ci, ne les modifie pas, n'en invente aucun autre) :",
    itemsChunk.map((it) => `- ${it}`).join("\n"),
    "",
    `Génère exactement ${count} question(s), une par élément ci-dessus (dans l'ordre), permettant de vérifier que cet élément précis est bien mémorisé (ex. donner un pays et demander sa capitale, donner l'infinitif d'un verbe irrégulier et demander son prétérit et son participe passé, donner un mot dans la langue cible et demander sa traduction, ou l'inverse) — jamais une question sur un élément hors de cette liste.`,
    ...formatBlock,
    "",
    `Pour chaque question, le champ "sourceId" doit valoir exactement la chaîne : "${id}".`,
    "Réponds uniquement en JSON strict, sous la forme {\"questions\":[{...}]}."
  ].join("\n");
}

// Lots successifs plutôt qu'un seul appel : au-delà d'une vingtaine de
// questions, un seul appel IA ne tient pas de façon fiable (troncature,
// qualité qui se dégrade). Un lot en échec ne bloque jamais les autres — un
// sujet à 200 éléments reste utile avec 180 questions plutôt que 0.
async function generateEnumerableQuizQuestions(apiKey, subject, items, id) {
  const all = [];
  for (let start = 0; start < items.length; start += NOTION_QUIZ_ENUMERABLE_CHUNK_SIZE) {
    const chunk = items.slice(start, start + NOTION_QUIZ_ENUMERABLE_CHUNK_SIZE);
    try {
      const questionPrompt = buildEnumerableQuizChunkPrompt(subject, chunk, id);
      const content = await _callOpenAI(apiKey, [{ role: "user", content: questionPrompt }], {
        model: DAILY_QUIZ_NARRATIVE_MODEL,
        temperature: 0.4,
        responseFormat: { type: "json_object" },
        timeoutMs: Math.min(120_000, 45_000 + chunk.length * 3_000),
        feature: "question_generation"
      });
      const parsedChunk = JSON.parse(content);
      const qualityApproved = await qualityControlRawQuestions({
        apiKey,
        rawQuestions: parsedChunk?.questions,
        basePrompt: questionPrompt,
        route: "free_search_enumerable",
        timeoutMs: Math.min(120_000, 45_000 + chunk.length * 3_000),
        context: { hasIndependentSource: false }
      });
      all.push(...validateNarrativeQuizQuestions(qualityApproved, [id], chunk.length, chunk.length));
    } catch (error) {
      console.warn(`[notion-quizzes:custom:${id}] lot ${start + 1}-${start + chunk.length} échoué :`, error.message);
    }
  }
  return all;
}

async function buildEnumerableCustomTopicQuiz(apiKey, topic, id, items, sourceName, userId) {
  const finalSourceName = sourceName || capitalizeFirstLetter(topic);
  const sourceDetail = { meta: `${items.length} éléments à mémoriser`, sections: buildEnumerableFicheSections(items), image: null };

  const validated = await generateEnumerableQuizQuestions(apiKey, finalSourceName, items, id);
  if (validated.length < NOTION_QUIZ_ENUMERABLE_MIN_VALID) {
    console.warn(`[notion-quizzes:custom:${id}] sujet énumérable : seulement ${validated.length} question(s) valide(s).`);
    return { error: "failed" };
  }
  const sourcePlacement = await classifyCultureGeneraleKnowledgePlacementWithAI("custom", finalSourceName, sourceDetail, userId, id);
  const sourceThemes = sourcePlacement?.category ? [sourcePlacement.category] : [];
  const questions = validated.map((q, index) => ({
    id: `notion:custom:${id}-exhaustif-q${index + 1}`,
    ...q,
    sourceType: "custom",
    sourceScope: null,
    sourceName: finalSourceName,
    sourceDetail,
    sourceThemes,
    sourcePlacement,
    level: "exhaustif",
    sourceDebateId: id
  }));
  return { questions };
}

// Générée à la demande au clic sur "Générer" de la barre de recherche libre
// (cf. POST /api/users/notion-quizzes/custom, buildLeveledFicheAndQuizPrompt).
async function buildCustomTopicQuiz(topic, id, rawLevel, userId) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "failed" };
  const levelConfig = resolveNotionQuizLevel(rawLevel);
  const { level } = levelConfig;

  // Niveau Exhaustif : un sujet qui désigne une véritable liste énumérable
  // (capitales, verbes irréguliers, vocabulaire...) mérite un quiz qui
  // couvre chaque élément plutôt que d'être plafonné à une vingtaine de
  // questions comme "expert" (demande du 12/08/2026, "expert" redevenu un
  // palier normal le 13/08/2026 lors de l'ajout de ce 4e niveau) — détecté
  // par un appel IA de repérage avant de partir sur la génération standard
  // sinon.
  if (level === "exhaustif") {
    const scope = await scopeCustomTopic(apiKey, topic);
    if (scope.rejected) return { error: "rejected", reason: scope.reason };
    if (scope.enumerable) {
      const items = await fetchEnumerableItems(apiKey, scope.sourceName || topic);
      if (items.length > levelConfig.max) {
        return buildEnumerableCustomTopicQuiz(apiKey, topic, id, items, scope.sourceName, userId);
      }
    }
  }

  // generateNotionLevelQuiz (demande du 17/08/2026, audit du pipeline
  // mnésique) : fiche + admission des connaissances → vérification
  // indépendante batchée → questions à partir des seules connaissances
  // acceptées — cf. son commentaire pour le détail de l'architecture.
  const result = await generateNotionLevelQuiz(apiKey, topic, null, id, levelConfig, true);
  if (result.error) {
    // `reason` conservé (pas seulement pour "rejected") : POST
    // /api/users/notion-quizzes/custom l'affiche aussi sur un "failed" avec
    // reason (cf. son repli "Génération de la fiche impossible..." sinon) —
    // notamment le message précis "aucune connaissance suffisamment fiable"
    // (cf. generateNotionLevelQuiz), plus utile qu'un message générique.
    console.warn(`[notion-quizzes:custom:${id}] ${result.error} : ${result.reason || "fiche ou QCM invalide."}`);
    return result;
  }
  const { sourceName, sourceDetail, validated } = result;
  // Contrairement à buildNotionQuestions, ce chemin (sujet libre, hors "Expert"
  // énumérable) codait en dur sourceThemes:[] — jamais classé, quel que soit le
  // contenu (bug distinct du budget de tokens insuffisant, cf.
  // fetchGpt5JsonContentWithRetry) : constaté en pratique le 12/08/2026, cause
  // principale des sujets libres tombés dans "Autres" sur "Mes apprentissages".
  const sourcePlacement = await classifyCultureGeneraleKnowledgePlacementWithAI("custom", sourceName, sourceDetail, userId, id);
  const sourceThemes = sourcePlacement?.category ? [sourcePlacement.category] : [];
  const questions = validated.map((q, index) => ({
    id: `notion:custom:${id}${level ? `-${level}` : ""}-q${index + 1}`,
    ...q,
    sourceType: "custom",
    sourceScope: null,
    sourceName,
    sourceDetail,
    sourceThemes,
    sourcePlacement,
    level,
    // Même raison que buildNotionQuestions : requis par
    // recordDailyQuizEclairageAcquisition pour qu'une bonne réponse alimente
    // "Ma mémoire" (demande du 10/08/2026).
    sourceDebateId: id
  }));
  return { questions };
}

// Niveau 2 de déduplication des recherches "sujet libre" (audit du
// 24/08/2026, cf. lib/topic-dedup.js) : appelé uniquement quand le niveau 1
// (slot exact) n'a rien trouvé. Ne fait jamais d'appel IA — relit seulement
// ce qui existe déjà, au même niveau pédagogique, et applique le gate mots
// structurants + quasi-inclusion des tokens avant de proposer une
// réutilisation. Une seule ligne par slot (la plus récente), même principe
// que GET /explore ci-dessous ; volume actuel très faible (quelques
// dizaines de sujets libres), donc pas de pagination nécessaire ici non
// plus — à revoir si le volume grossit significativement.
async function findEquivalentGeneratedCustomTopic(topic, level) {
  const { data: rows, error } = await supabase
    .from("daily_quiz")
    .select("slot, quiz_date, questions")
    .like("slot", "notion:custom:%");
  if (error) throw new Error(error.message);

  const latestBySlot = new Map();
  for (const row of rows || []) {
    const existing = latestBySlot.get(row.slot);
    if (!existing || row.quiz_date > existing.quiz_date) latestBySlot.set(row.slot, row);
  }

  const candidates = [];
  for (const row of latestBySlot.values()) {
    if (parseCustomTopicSlotLevel(row.slot) !== level) continue;
    const topicText = row.questions?.[0]?.searchTopic || row.questions?.[0]?.sourceName || null;
    if (!topicText) continue;
    candidates.push({ slot: row.slot, quizDate: row.quiz_date, questions: row.questions, topicText });
  }

  return findEquivalentCustomTopic(topic, candidates);
}

/* ================================================================= */
/*   Notions à retenir en fin d'arène — extraites une seule fois par   */
/*   débat (cache sur debates.topic_notions*), affichées avant toute   */
/*   génération de QCM. Le QCM propre à chaque notion n'est généré     */
/*   qu'au clic "Mémoriser" (cf. NOTION_QUIZ_SOURCE_TYPES + branches   */
/*   "debat-notion" de formatEclairagesItemForPrompt/extract*).        */
/* ================================================================= */

const DEBATE_TOPIC_NOTIONS_MODEL = process.env.OPENAI_DEBATE_NOTIONS_MODEL || "gpt-4.1-mini";
// Au-delà de ce délai, une extraction restée en "generating" est considérée
// comme un appel mort (crash serveur, timeout réseau) plutôt que toujours en
// cours — reprise possible par la requête suivante.
const DEBATE_TOPIC_NOTIONS_STALE_MS = 3 * 60 * 1000;
const DEBATE_TOPIC_NOTIONS_MIN = 2;
const DEBATE_TOPIC_NOTIONS_MAX = 3;

function buildDebateTopicNotionsPrompt(question, content) {
  return [
    "Tu identifies les notions, mots-clés ou concepts clés à connaître pour bien comprendre le débat d'actualité ci-dessous — termes techniques, juridiques, économiques, institutionnels, scientifiques ou politiques qui méritent d'être expliqués et mémorisés par un lecteur qui découvre le sujet.",
    "Règles strictes :",
    "- Base-toi uniquement sur le texte fourni, n'invente aucun fait.",
    `- Choisis entre ${DEBATE_TOPIC_NOTIONS_MIN} et ${DEBATE_TOPIC_NOTIONS_MAX} notions distinctes, jamais de doublon ni de synonymes proches.`,
    "- Écarte les notions triviales ou déjà évidentes pour un lecteur de la presse générale — ne retiens que celles qui apportent un vrai éclairage.",
    "- Priorité absolue à l'utilité : choisis les notions qui aident vraiment à comprendre les ENJEUX du débat (pourquoi ce sujet compte, ce qui se joue, ce qui est débattu) — jamais une notion choisie seulement parce qu'elle est technique ou qu'elle sonne savante. Une notion étonnante ou peu connue est un plus si elle est réellement vraie et pertinente pour ce débat, mais jamais au détriment de l'utilité : ne sacrifie jamais la compréhension des enjeux pour un fait curieux mais secondaire.",
    "- Vérifie que chaque notion et son explication sont exactes et vérifiables avant de les retenir — en cas de doute sur un fait, écarte-le plutôt que de risquer une explication fausse ou approximative.",
    "- Pour chaque notion : un nom court et correctement capitalisé (1 à 4 mots, jamais une phrase ni une question), et une explication neutre de 1 à 3 phrases qui définit la notion et précise son lien avec ce débat précis.",
    "- Français neutre, sans jugement de valeur, sans reprendre le camp \"pour\" ou \"contre\" du débat.",
    "- Si le texte fourni est trop pauvre pour en tirer au moins 3 notions sérieuses, réponds avec une liste vide plutôt que d'inventer.",
    "",
    `Question du débat : ${String(question || "").trim().slice(0, 300)}`,
    `Contexte : ${String(content || "").trim().slice(0, 1800)}`,
    "",
    "Réponds strictement en JSON, sans aucun texte autour : {\"notions\": [{\"name\": \"...\", \"explanation\": \"...\"}]}."
  ].join("\n");
}

// Slug stable dérivé du nom (pour sourceDebateId/slot du QCM de notion,
// jamais recalculé côté client) — pas de dépendance à un id fourni par l'IA.
function slugifyDebateNotionName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Best-effort, jamais bloquant pour l'affichage de l'arène : une erreur ou
// une réponse vide renvoie simplement [] (cf. appelant GET /api/debates/:id/notions),
// jamais une exception qui casserait la page.
async function extractDebateTopicNotions(question, content) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];
  try {
    const raw = await _callOpenAI(apiKey, [{ role: "user", content: buildDebateTopicNotionsPrompt(question, content) }], {
      model: DEBATE_TOPIC_NOTIONS_MODEL,
      temperature: 0.3,
      responseFormat: { type: "json_object" },
      feature: "knowledge_related_notions"
    });
    const parsed = JSON.parse(raw);
    const seen = new Set();
    const notions = [];
    for (const entry of Array.isArray(parsed?.notions) ? parsed.notions : []) {
      const name = capitalizeFirstLetter(String(entry?.name || "").trim()).slice(0, 60);
      const explanation = String(entry?.explanation || "").trim().slice(0, 500);
      const slug = slugifyDebateNotionName(name);
      if (!name || !explanation || !slug || seen.has(slug)) continue;
      seen.add(slug);
      notions.push({ slug, name, explanation });
      if (notions.length >= DEBATE_TOPIC_NOTIONS_MAX) break;
    }
    return notions.length >= DEBATE_TOPIC_NOTIONS_MIN ? notions : [];
  } catch (error) {
    console.error("[debate-notions] extraction IA :", error.message);
    return [];
  }
}

// Lecture publique des notions d'une arène — génère et met en cache
// (debates.topic_notions*) au premier appel, sert le cache ensuite. Pas de
// verrou atomique : au pire deux visiteurs arrivant au même instant sur une
// arène flambant neuve déclenchent chacun un appel IA (cf. mise à jour
// "generating" ci-dessous qui limite la fenêtre de course), risque jugé
// négligeable au regard de la fréquence réelle de ce cas — même choix que
// _generateAndSaveAnalysis pour l'analyse IA d'arène.
app.get("/api/debates/:id/notions", rateLimit("debate-notions-read", 240), async (req, res) => {
  const canonicalId = resolveSharedDebateId(req.params.id) || String(req.params.id);
  try {
    const { data: debate, error } = await supabase
      .from("debates")
      .select("id, question, content, topic_notions, topic_notions_status, topic_notions_generated_at")
      .eq("id", canonicalId)
      .single();
    if (error || !debate) return res.status(404).json({ ok: false, error: "Débat introuvable." });

    if (debate.topic_notions_status === "ready" && Array.isArray(debate.topic_notions)) {
      return res.json({ ok: true, status: "ready", notions: debate.topic_notions });
    }

    // "failed" (contenu jugé trop pauvre, ou erreur IA transitoire) : pas de
    // nouvel appel IA à chaque visite, seulement après le même délai de
    // grâce que "generating" — évite de payer un appel OpenAI par visiteur
    // sur une arène dont le contenu ne permettra de toute façon jamais
    // d'extraire 3 notions sérieuses.
    const isStale = !debate.topic_notions_generated_at
      || (Date.now() - new Date(debate.topic_notions_generated_at).getTime()) > DEBATE_TOPIC_NOTIONS_STALE_MS;
    if ((debate.topic_notions_status === "generating" || debate.topic_notions_status === "failed") && !isStale) {
      return res.json({ ok: true, status: debate.topic_notions_status, notions: [] });
    }

    await supabase.from("debates").update({
      topic_notions_status: "generating",
      topic_notions_generated_at: new Date().toISOString()
    }).eq("id", canonicalId);

    const notions = await extractDebateTopicNotions(debate.question, debate.content);
    await supabase.from("debates").update({
      topic_notions: notions,
      topic_notions_status: notions.length ? "ready" : "failed",
      topic_notions_generated_at: new Date().toISOString()
    }).eq("id", canonicalId);

    return res.json({ ok: true, status: notions.length ? "ready" : "failed", notions });
  } catch (err) {
    console.error("[debate-notions] erreur :", err.message);
    return res.status(502).json({ ok: false, error: "Erreur lors de la génération." });
  }
});

// Décode l'id d'une repasse de répétition espacée ("cgreview-{questionId}"
// depuis le 10/08/2026, auparavant "cgreview-{sourceDebateId}" — cf.
// fetchCultureGeneraleReviewInjectionForToday) pour retrouver la référence
// d'origine (générique : peu importe pour ce parseur ce que la référence
// désigne réellement).
function parseCultureGeneraleReviewRef(questionId) {
  const m = /^cgreview-(.+)$/.exec(String(questionId || ""));
  return m ? m[1] : null;
}

// Historique complet des réponses de ce visiteur aux questions de culture
// générale — premières fois (culture_generale-qN historique, notion:... QCM
// de notion) et repasses de répétition espacée (cgreview-{questionId})
// confondues, jamais le QCM Révision (resté un entraînement libre, hors
// suivi). Renvoie les événements triés chronologiquement (un par réponse,
// groupables par sourceDebateId ou par questionId côté appelant selon le
// besoin — notion entière pour fetchUserAcquis/"Ma mémoire", question par
// question pour "Mes apprentissages"/fetchCultureGeneraleReviewInjectionForToday,
// cf. computeCultureGeneraleStreaks vs computeQuestionStreaks) ainsi que des
// index du contenu par sourceDebateId et par questionId.
async function fetchUserCultureGeneraleAnswerEvents(voterKey) {
  const key = String(voterKey || "").trim();
  const empty = () => ({ events: [], contentBySourceId: new Map(), originalQuizDateBySourceId: new Map(), contentByQuestionId: new Map(), slotBySourceId: new Map() });
  if (!key) return empty();

  const { data: answerRows, error: answersError } = await fetchAllSupabaseRows(() =>
    supabase.from("daily_quiz_answers")
      .select("quiz_date, question_id, option_index, difficulty")
      .eq("voter_key", key));
  if (answersError) throw new Error(answersError.message);

  const originalAnswers = [];
  const reviewAnswers = [];
  for (const row of answerRows || []) {
    const qid = String(row.question_id || "");
    if (qid.startsWith("culture_generale-") || qid.startsWith("notion:")) {
      originalAnswers.push({ quizDate: row.quiz_date, questionId: qid, optionIndex: row.option_index, difficulty: row.difficulty });
    } else if (qid.startsWith("cgreview-")) {
      // Le ref porté par "cgreview-{ref}" est un questionId depuis le
      // 10/08/2026 (avant : un sourceDebateId, une seule repasse par notion
      // — cf. fetchCultureGeneraleReviewInjectionForToday) ; les anciennes
      // lignes cgreview-{sourceDebateId} encore en base ne matcheront
      // simplement plus aucun contentByQuestionId ci-dessous et seront
      // ignorées, sans casser le calcul (juste un peu d'historique de repasse
      // perdu sur les tout premiers acquis, sans impact sur les nouvelles
      // notions).
      const ref = parseCultureGeneraleReviewRef(qid);
      if (ref) reviewAnswers.push({ quizDate: row.quiz_date, ref, optionIndex: row.option_index, difficulty: row.difficulty });
    }
  }
  if (!originalAnswers.length && !reviewAnswers.length) return empty();

  // Pas de filtre par slot ici : selon la date, la ligne daily_quiz
  // correspondante peut être une ancienne ligne "culture_generale" (avant la
  // fusion des QCM) ou une nouvelle ligne "daily" (questions actu+culture
  // générale mélangées) — le tri se fait ensuite question par question via
  // isCultureGeneraleQuestionId, jamais via le slot de la ligne.
  const quizDates = [...new Set(originalAnswers.map((a) => a.quizDate).filter(Boolean))];
  const { data: quizRows, error: quizRowsError } = await fetchAllSupabaseRowsIn(quizDates, (chunk) =>
    supabase.from("daily_quiz").select("quiz_date, slot, questions").in("quiz_date", chunk));
  if (quizRowsError) throw new Error(quizRowsError.message);

  // contentBySourceId/contentByQuestionId couvrent aussi les repasses : une
  // question posée le jour J réapparaît en repasse un jour ultérieur sans
  // jamais avoir sa propre ligne daily_quiz, mais elle a forcément été vue ce
  // jour J (seules les questions déjà répondues sont éligibles à une
  // repasse). originalQuizDateBySourceId retient ce jour J de première
  // publication — nécessaire à fetchUserAcquis pour relire, si besoin, le
  // contenu Éclairages publié ce jour-là (cf. resolveMissingAcquisSourceNames).
  // Ne retient que les questions culture générale (isCultureGeneraleQuestionId) :
  // depuis la fusion, une ligne "daily" contient aussi des questions actu
  // dont le sourceDebateId (id de débat, entier) pourrait sinon entrer en
  // collision avec un sourceDebateId culture générale (id d'événement/éclairage).
  const contentBySourceId = new Map();
  const contentByQuestionId = new Map();
  const originalQuizDateBySourceId = new Map();
  const slotBySourceId = new Map();
  const originalByDateAndId = new Map();
  for (const row of quizRows || []) {
    for (const q of (row.questions || [])) {
      if (!isCultureGeneraleQuestionId(q.id)) continue;
      originalByDateAndId.set(`${row.quiz_date}:${q.id}`, q);
      contentByQuestionId.set(q.id, q);
      if (q.sourceDebateId) {
        contentBySourceId.set(q.sourceDebateId, q);
        originalQuizDateBySourceId.set(q.sourceDebateId, row.quiz_date);
        // Slot réel de la ligne daily_quiz qui porte cette notion — depuis
        // l'introduction des niveaux (12/08/2026), il peut porter un suffixe
        // ":elementaire|avance|expert" que rien ne permet de reconstruire par
        // simple concaténation (cf. GET /api/users/intellectual-universe, qui
        // devinait auparavant ce slot au lieu de le lire ici).
        if (row.slot) slotBySourceId.set(q.sourceDebateId, row.slot);
      }
    }
  }

  const events = [];
  for (const a of originalAnswers) {
    const question = originalByDateAndId.get(`${a.quizDate}:${a.questionId}`);
    if (!question || !question.sourceDebateId) continue;
    events.push({
      sourceDebateId: question.sourceDebateId,
      questionId: question.id,
      quizDate: a.quizDate,
      correct: Number(a.optionIndex) === Number(question.correctIndex),
      difficulty: a.difficulty || null
    });
  }
  for (const a of reviewAnswers) {
    const question = contentByQuestionId.get(a.ref);
    if (!question) continue; // contenu hors fenêtre de rétention (DAILY_QUIZ_RETENTION_DAYS), ou ancien ref sourceDebateId d'avant le 10/08/2026 : ignoré
    events.push({
      sourceDebateId: question.sourceDebateId,
      questionId: a.ref,
      quizDate: a.quizDate,
      correct: Number(a.optionIndex) === Number(question.correctIndex),
      difficulty: a.difficulty || null
    });
  }
  events.sort((x, y) => (x.quizDate < y.quizDate ? -1 : x.quizDate > y.quizDate ? 1 : 0));
  return { events, contentBySourceId, originalQuizDateBySourceId, contentByQuestionId, slotBySourceId };
}

// Rejoue l'historique d'une clé de regroupement (sourceDebateId pour "Ma
// mémoire"/"Mes acquis", questionId pour la progression indépendante par
// question de "Mes apprentissages", cf. computeCultureGeneraleStreaks et
// computeQuestionStreaks ci-dessous) dans l'ordre chronologique pour en
// déduire son état actuel : streak (0 à DAILY_QUIZ_ACQUIS_VALIDATION_STREAK),
// date de la dernière réponse et si elle est déjà validée.
function computeStreaksGroupedBy(events, keyField) {
  const byKey = new Map();
  events.forEach((e) => {
    const key = e[keyField];
    if (key == null) return;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(e);
  });
  const result = new Map();
  for (const [key, list] of byKey) {
    // Une même clé peut donner lieu à plusieurs événements le même jour
    // (ex. sourceDebateId partagé par plusieurs questions d'une même notion,
    // cf. computeCultureGeneraleStreaks) : on les regroupe en un seul
    // événement par jour (correct seulement si TOUS les événements de ce
    // jour-là le sont), sinon le streak avance de plusieurs crans en une
    // seule journée et saute l'intervalle de 3 jours — plus aucune repasse ne
    // redevient due avant bien plus longtemps que prévu. Sans effet sur
    // computeQuestionStreaks (questionId), où l'unicité (quiz_date, voter_key,
    // question_id) en base garantit déjà au plus un événement par jour.
    const byDate = new Map();
    // difficultyByDate (demande du 13/08/2026) : la difficulté ressentie par
    // l'utilisateur (facile/moyen/difficile, cf. POST /answer) influence
    // l'intervalle avant la prochaine repasse (cf. isCultureGeneraleReviewDueToday)
    // — on retient celle du DERNIER événement de chaque jour (même logique
    // que `correct` ci-dessus : plusieurs événements le même jour sont rares,
    // le plus récent l'emporte).
    const difficultyByDate = new Map();
    for (const e of list) {
      const previous = byDate.get(e.quizDate);
      byDate.set(e.quizDate, previous === undefined ? e.correct : previous && e.correct);
      if (e.difficulty) difficultyByDate.set(e.quizDate, e.difficulty);
    }
    const dailyEvents = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

    let streak = 0;
    let everCorrect = false;
    let lastQuizDate = null;
    let lastDifficulty = null;
    for (const [quizDate, correct] of dailyEvents) {
      lastQuizDate = quizDate;
      lastDifficulty = difficultyByDate.get(quizDate) || null;
      if (correct) {
        streak = Math.min(streak + 1, DAILY_QUIZ_ACQUIS_VALIDATION_STREAK);
        everCorrect = true;
      } else {
        streak = 0;
      }
    }
    result.set(key, {
      streak,
      everCorrect,
      lastQuizDate,
      lastDifficulty,
      validated: streak >= DAILY_QUIZ_ACQUIS_VALIDATION_STREAK
    });
  }
  return result;
}

// Progression par notion (toutes ses questions confondues) — "Ma mémoire" et
// "Mes acquis" (fetchUserAcquis), inchangé.
function computeCultureGeneraleStreaks(events) {
  return computeStreaksGroupedBy(events, "sourceDebateId");
}

// Questions à réinjecter aujourd'hui dans le QCM Culture Générale de ce
// visiteur (cf. getDailyQuizQuestions) : chaque QUESTION dont l'échéance
// FSRS (memory_item_fsrs_states.due_at, cf. lib/spaced-repetition/) est
// atteinte, les plus en retard d'abord, plafonnées à
// DAILY_QUIZ_ACQUIS_REVIEW_MAX_PER_DAY — sans ce plafond, plusieurs jours
// d'absence feraient réapparaître toutes les repasses en retard d'un coup
// (demande du 03/08/2026). Les questions en retard mais laissées de côté par
// le plafond restent dues (pas de recalcul de date ici) : elles repasseront
// au prochain appel tant qu'elles n'auront pas été répondues. Id
// "cgreview-{questionId}" — jamais persistées dans daily_quiz, recalculées à
// chaque appel (pas de cache, cf. getDailyQuizQuestions).
const DAILY_QUIZ_ACQUIS_REVIEW_MAX_PER_DAY = 20;

// Questions qu'un visiteur a explicitement écartées de ses futures repasses
// (cf. POST /api/daily-quiz/exclude-question) — il les connaît déjà ou n'est
// plus intéressé. Un échec de lecture n'est jamais bloquant : au pire, une
// question exclue réapparaît une fois de plus plutôt que de casser toute
// l'injection de repasses du jour.
async function fetchExcludedQuestionIds(voterKey) {
  const key = String(voterKey || "").trim();
  if (!key) return new Set();
  const { data, error } = await supabase.from("user_question_exclusions").select("question_id").eq("voter_key", key);
  if (error) {
    console.warn("[question-exclusions] lecture échouée :", error.message);
    return new Set();
  }
  return new Set((data || []).map((r) => r.question_id));
}

// resolveActiveQuestionVariant vit désormais dans
// lib/spaced-repetition/question-variant.js (refonte du 16/08/2026, jusqu'à
// 3 variantes par MemoryItem plutôt que base+altVariant) — importée en haut
// de ce fichier. Choisit parmi 1 à 3 variantes en évitant la répétition
// immédiate, recalculé à l'identique au SERVICE et à la CORRECTION (même
// reviewCount = memory_item_fsrs_states.reps pas encore mis à jour par la
// réponse en cours).

// todayKey n'est plus consulté (comparaison désormais sur l'instant exact
// via memory_item_fsrs_states.due_at, pas sur une date arrondie au jour, cf.
// lib/spaced-repetition/scheduler-version.js) — conservé uniquement pour ne
// pas changer la signature côté appelants (getDailyQuizQuestions, GET
// /api/daily-quiz/status).
async function fetchCultureGeneraleReviewInjectionForToday(voterKey, _todayKey) {
  const key = String(voterKey || "").trim();
  if (!key) return [];

  // Lecture seule (jamais resolveLegacyUser, qui crée la ligne) : un
  // visiteur sans historique n'a par définition aucune ligne memory_items ni
  // memory_item_fsrs_states, inutile de lui créer une ligne users ici — la
  // création reste réservée au chemin d'écriture (POST /answer).
  const { data: userRow, error: userError } = await supabase.from("users").select("id").eq("legacy_key", key).maybeSingle();
  if (userError) { console.warn("[fsrs due] lecture user échouée :", userError.message); return []; }
  if (!userRow) return [];

  const [{ data: dueStates, error: dueError }, excludedIds] = await Promise.all([
    supabase.from("memory_item_fsrs_states")
      // state/stability : ajoutés pour la gradation de l'aide (cf.
      // lib/spaced-repetition/help-level.js, deriveHelpLevel) — lus ici en
      // même temps que reps (déjà utilisé pour la rotation de variante),
      // jamais réécrits, jamais transmis tels quels au client (seul le
      // helpLevel dérivé l'est, cf. plus bas et stripQuestionForClient).
      .select("reps, state, stability, memory_items(slot, quiz_date, question_id)")
      .eq("user_id", userRow.id)
      .lte("due_at", new Date().toISOString())
      .order("due_at", { ascending: true })
      .limit(DAILY_QUIZ_ACQUIS_REVIEW_MAX_PER_DAY),
    fetchExcludedQuestionIds(key)
  ]);
  if (dueError) { console.warn("[fsrs due] lecture memory_item_fsrs_states échouée :", dueError.message); return []; }
  if (!dueStates || !dueStates.length) return [];

  const dueItems = dueStates
    .map((s) => ({ reps: s.reps, helpLevel: deriveHelpLevel({ state: s.state, stability: s.stability }), memoryItem: s.memory_items }))
    .filter((s) => s.memoryItem && !excludedIds.has(s.memoryItem.question_id));
  if (!dueItems.length) return [];

  // Regroupe par ligne daily_quiz d'origine pour ne la relire qu'une fois,
  // même si plusieurs de ses questions sont dues en même temps.
  const bySlotDate = new Map();
  for (const { memoryItem } of dueItems) {
    const k = `${memoryItem.quiz_date}:${memoryItem.slot}`;
    if (!bySlotDate.has(k)) bySlotDate.set(k, { quizDate: memoryItem.quiz_date, slot: memoryItem.slot });
  }
  const quizRowResults = await Promise.all([...bySlotDate.values()].map(({ quizDate, slot }) =>
    supabase.from("daily_quiz").select("quiz_date, slot, questions").eq("quiz_date", quizDate).eq("slot", slot).maybeSingle()));
  const questionByDateSlotId = new Map();
  for (const { data } of quizRowResults) {
    if (!data) continue;
    for (const q of data.questions || []) questionByDateSlotId.set(`${data.quiz_date}:${data.slot}:${q.id}`, q);
  }

  const due = [];
  for (const { reps, helpLevel, memoryItem } of dueItems) {
    const question = questionByDateSlotId.get(`${memoryItem.quiz_date}:${memoryItem.slot}:${memoryItem.question_id}`);
    if (!question) continue; // contenu hors fenêtre de rétention (cas des anciens slots hors "notion:%", jamais backfillés)
    due.push({
      ...resolveActiveQuestionVariant(question, reps),
      id: `cgreview-${memoryItem.question_id}`,
      // helpLevel : distinct de resolveActiveQuestionVariant (variant =
      // quelle formulation, helpLevel = combien d'aide) — jamais fusionné
      // dans son calcul, jamais lu par selectVariantIndex.
      helpLevel
    });
  }
  return due;
}

// Jauge de charge d'apprentissage (demande du 17/08/2026) : projette les
// échéances FSRS déjà programmées de cet utilisateur sur les prochains
// DEFAULT_PROJECTION_DAYS jours et simule le report en cascade au-delà du
// plafond quotidien (cf. computeLearningLoadGauge,
// lib/spaced-repetition/learning-load.js — toute la logique de simulation
// vit là-bas, pure et testée ; cette fonction ne fait que lire/agréger).
// Lecture seule : aucun état FSRS modifié, aucune carte choisie ici.
async function fetchLearningLoadGaugeForUser(voterKey) {
  const key = String(voterKey || "").trim();
  if (!key) return null;

  // Lecture seule (jamais resolveLegacyUser, qui crée la ligne) : même
  // principe que fetchCultureGeneraleReviewInjectionForToday — un visiteur
  // sans historique n'a par définition aucun état FSRS, inutile de lui créer
  // une ligne users ici.
  const { data: userRow, error: userError } = await supabase.from("users").select("id").eq("legacy_key", key).maybeSingle();
  if (userError) { console.warn("[learning-load] lecture user échouée :", userError.message); return null; }
  if (!userRow) return { level: "calm", ratio: 0, peakDayIndex: -1, peakLoad: 0, dueCountsByDay: [] };

  const now = new Date();
  // Borne haute unique (fin du dernier jour de la fenêtre) : une seule
  // requête plutôt que DEFAULT_PROJECTION_DAYS requêtes séparées, le
  // bucketing par jour se fait ensuite en mémoire (volume par utilisateur
  // toujours restreint, cf. plafond quotidien de repasses).
  const windowEndIso = parisStartOfDayIso(new Date(now.getTime() + DEFAULT_PROJECTION_DAYS * 24 * 60 * 60 * 1000));
  const { data: dueRows, error: dueError } = await supabase
    .from("memory_item_fsrs_states")
    .select("due_at")
    .eq("user_id", userRow.id)
    .lt("due_at", windowEndIso);
  if (dueError) { console.warn("[learning-load] lecture memory_item_fsrs_states échouée :", dueError.message); return null; }

  // dayBoundaries[i] = minuit Paris du jour i (0 = aujourd'hui) ; le jour 0
  // regroupe tout ce qui est dû AVANT la fin du jour 0, retard déjà
  // accumulé inclus (due_at au passé) — comme fetchCultureGeneraleReviewInjectionForToday,
  // jamais une comparaison sur une date arrondie.
  const dayBoundaries = [];
  for (let i = 0; i <= DEFAULT_PROJECTION_DAYS; i++) {
    dayBoundaries.push(new Date(parisStartOfDayIso(new Date(now.getTime() + i * 24 * 60 * 60 * 1000))).getTime());
  }
  const dueCountsByDay = new Array(DEFAULT_PROJECTION_DAYS).fill(0);
  for (const row of dueRows || []) {
    const dueMs = new Date(row.due_at).getTime();
    if (!Number.isFinite(dueMs)) continue;
    let dayIndex = dayBoundaries.findIndex((boundary, i) => dueMs < dayBoundaries[i + 1]);
    if (dayIndex === -1) dayIndex = DEFAULT_PROJECTION_DAYS - 1; // garde-fou, ne devrait pas arriver (borne haute déjà filtrée côté requête)
    dueCountsByDay[dayIndex] += 1;
  }

  const gauge = computeLearningLoadGauge(dueCountsByDay, DAILY_QUIZ_ACQUIS_REVIEW_MAX_PER_DAY);
  return { ...gauge, dueCountsByDay };
}

// Rubrique Éclairages -> service de lecture + clé du tableau de contenu
// (lecture seule via getByDate, jamais de génération) — utilisé par
// resolveMissingAcquisSourceNames pour retrouver l'intitulé (concept,
// mécanisme, auteur, œuvre...) des acquis générés avant l'ajout du champ
// sourceName.
function getCultureGeneraleEclairagesSourceConfig(sourceType) {
  switch (sourceType) {
    case "parallele": return { service: paralleleHistoriqueService, contentKey: "parallels" };
    case "pensee": return { service: penseePhilosophiqueService, contentKey: "pensees" };
    case "mecanisme": return { service: mecanismeSociologiqueService, contentKey: "mecanismes" };
    case "concept": return { service: conceptDuJourService, contentKey: "concepts" };
    case "citation": return { service: citationDuJourService, contentKey: "citations" };
    case "oeuvre": return { service: oeuvreArtDuJourService, contentKey: "oeuvres" };
    case "latin": return { service: latinDuJourService, contentKey: "latins" };
    default: return null;
  }
}

const CULTURE_GENERALE_ECLAIRAGES_TYPES = ["parallele", "pensee", "mecanisme", "concept", "citation", "oeuvre", "latin"];

// Index (mémoïsé le temps d'un appel) des événements "Ce jour dans l'Histoire"
// par id — évènements globaux, jamais scopés à une date de génération de QCM.
// Non filtré (garde les "draft") : usage réservé à la résolution rétroactive
// de sourceName/sourceDetail pour des acquis DÉJÀ existants (cf.
// resolveMissingAcquisSourceNames) — un acquis déjà en base doit rester
// affichable quel que soit le review_status de son événement source
// aujourd'hui, jamais le garde-fou de génération de nouvelles questions
// (cf. isHistoricalEventMemorizable, qui filtre lui, juste en dessous).
function buildHistoricalEventsIndex() {
  if (!historicalEventsRepository) return new Map();
  return new Map(historicalEventsRepository.getAll().map((e) => [String(e.id), e]));
}

// Garde-fou de génération (demande du 17/08/2026, audit du pipeline
// mnésique) : un événement "Ce jour dans l'Histoire" ne doit alimenter une
// NOUVELLE question mémorisable que s'il est suffisamment validé — cf.
// getAll({onlyMemorizable}) pour la définition exacte et sa justification
// transitoire. Relit toujours le repository plutôt que de faire confiance à
// `rawItem` (fourni par le CLIENT dans le corps de POST
// /api/users/notion-quizzes, cf. buildNotionQuestions) : un item "draft"
// affiché puis envoyé tel quel par un client ne doit jamais suffire à
// déclencher une génération, quel que soit son contenu.
function isHistoricalEventMemorizable(id) {
  if (!historicalEventsRepository) return false;
  return historicalEventsRepository.getAll({ onlyMemorizable: true }).some((e) => String(e.id) === String(id));
}

// Relit le contenu Éclairages déjà publié un jour donné pour une rubrique
// précise, indexé par current_topic_id (sourceDebateId) — jamais de
// génération, uniquement getByDate (lecture seule, cf. chaque service).
async function fetchEclairagesContentIndexForDate(sourceType, dateKey) {
  const config = getCultureGeneraleEclairagesSourceConfig(sourceType);
  if (!config) return new Map();
  let result;
  try {
    result = await config.service.getByDate(dateKey);
  } catch (error) {
    console.error(`[daily-quiz:acquis] relecture ${sourceType} du ${dateKey} :`, error.message);
    return new Map();
  }
  const items = result?.status === "published" ? result.content?.[config.contentKey] : null;
  if (!Array.isArray(items)) return new Map();
  return new Map(items.map((it) => [String(it.current_topic_id), it]));
}

// Reporte sur `a` le nom et le détail "purs" (cf. extractCultureGeneraleItemName
// / extractCultureGeneraleItemDetail) d'un item Éclairages/historique
// retrouvé, sans jamais écraser un champ déjà résolu.
function applyResolvedCultureGeneraleSource(a, type, sourceItem) {
  const tagged = { type, ...sourceItem };
  if (!a.sourceName) a.sourceName = extractCultureGeneraleItemName(tagged) || null;
  if (!a.sourceDetail) a.sourceDetail = extractCultureGeneraleItemDetail(tagged);
}

// "Mes acquis" doit toujours afficher le nom et le détail purs du concept/
// mécanisme/auteur/œuvre plutôt que la question elle-même (jamais de repli
// sur le texte de la question) — les acquis générés avant l'ajout de
// sourceName/sourceDetail/sourceType n'ont pas ces champs en base : on les
// résout ici rétroactivement en relisant le contenu déjà publié (événement
// historique par id, contenu Éclairages du jour d'origine via
// originalQuizDateBySourceId), sans jamais régénérer de contenu. Quand la
// rubrique elle-même est inconnue (acquis antérieurs à l'ajout de
// sourceType), on cherche dans les 7 rubriques Éclairages de cette date
// plutôt que de supposer une rubrique par défaut. Mute directement les
// objets de `acquis`.
async function resolveMissingAcquisSourceNames(acquis, originalQuizDateBySourceId) {
  const missing = acquis.filter((a) => !a.sourceName || !a.sourceDetail);
  if (!missing.length) return;

  const historicalIndex = buildHistoricalEventsIndex();

  const knownHistoire = [];
  const knownEclairages = [];
  const unknownType = [];
  for (const a of missing) {
    if (a.sourceType === "histoire") knownHistoire.push(a);
    else if (getCultureGeneraleEclairagesSourceConfig(a.sourceType)) knownEclairages.push(a);
    else unknownType.push(a);
  }

  for (const a of knownHistoire) {
    const event = historicalIndex.get(String(a.sourceDebateId));
    if (event) applyResolvedCultureGeneraleSource(a, "histoire", event);
  }

  const eclairagesGroups = new Map();
  for (const a of knownEclairages) {
    const dateKey = originalQuizDateBySourceId.get(a.sourceDebateId);
    if (!dateKey) continue;
    const groupKey = `${a.sourceType}:${dateKey}`;
    if (!eclairagesGroups.has(groupKey)) eclairagesGroups.set(groupKey, { sourceType: a.sourceType, dateKey, items: [] });
    eclairagesGroups.get(groupKey).items.push(a);
  }
  await Promise.all([...eclairagesGroups.values()].map(async (group) => {
    const byId = await fetchEclairagesContentIndexForDate(group.sourceType, group.dateKey);
    for (const a of group.items) {
      const item = byId.get(String(a.sourceDebateId));
      if (item) applyResolvedCultureGeneraleSource(a, group.sourceType, item);
    }
  }));

  if (!unknownType.length) return;

  for (const a of unknownType) {
    const event = historicalIndex.get(String(a.sourceDebateId));
    if (event) {
      a.sourceType = "histoire";
      applyResolvedCultureGeneraleSource(a, "histoire", event);
    }
  }
  const stillUnknown = unknownType.filter((a) => !a.sourceName);
  if (!stillUnknown.length) return;

  const dateKeys = [...new Set(stillUnknown.map((a) => originalQuizDateBySourceId.get(a.sourceDebateId)).filter(Boolean))];
  await Promise.all(dateKeys.map(async (dateKey) => {
    const combined = new Map();
    await Promise.all(CULTURE_GENERALE_ECLAIRAGES_TYPES.map(async (sourceType) => {
      const byId = await fetchEclairagesContentIndexForDate(sourceType, dateKey);
      for (const [topicId, item] of byId) combined.set(topicId, { sourceType, item });
    }));
    for (const a of stillUnknown) {
      if (a.sourceName || originalQuizDateBySourceId.get(a.sourceDebateId) !== dateKey) continue;
      const match = combined.get(String(a.sourceDebateId));
      if (match) {
        a.sourceType = match.sourceType;
        applyResolvedCultureGeneraleSource(a, match.sourceType, match.item);
      }
    }
  }));
}

// Banque personnelle des questions de culture générale déjà répondues
// correctement au moins une fois, avec leur progression vers la validation
// complète (DAILY_QUIZ_ACQUIS_VALIDATION_STREAK bonnes réponses à intervalles
// croissants, cf. computeCultureGeneraleStreaks) — utilisée par "Ma mémoire"
// (fiche affichée au clic sur une étoile, cf. /api/users/intellectual-universe)
// et par le badge de progression de "Mes apprentissages".
async function fetchUserAcquis(voterKey, options = {}) {
  const { events, contentBySourceId, originalQuizDateBySourceId, slotBySourceId } = await fetchUserCultureGeneraleAnswerEvents(voterKey);
  if (!events.length) return [];
  const streaks = computeCultureGeneraleStreaks(events);

  const acquis = [];
  for (const [sourceDebateId, state] of streaks) {
    if (!state.everCorrect) continue;
    const question = contentBySourceId.get(sourceDebateId);
    if (!question) continue;
    const isNotionQuiz = String(question.id || "").startsWith("notion:");
    acquis.push({
      sourceDebateId,
      // Repli "histoire" volontairement absent ici : resolveMissingAcquisSourceNames
      // a besoin de savoir que la rubrique est inconnue pour chercher dans les 6
      // rubriques Éclairages plutôt que de se limiter à tort aux événements
      // historiques (cf. commentaire de la fonction).
      sourceType: question.sourceType || null,
      sourceName: question.sourceName || null,
      sourceDetail: question.sourceDetail || null,
      // Date + slot réels de la ligne daily_quiz qui porte le QCM complet de
      // cette notion (le slot peut porter un suffixe de niveau depuis le
      // 12/08/2026, cf. NOTION_QUIZ_LEVELS — jamais reconstruit par
      // concaténation en aval). Seulement pour les QCM créés depuis Mes
      // apprentissages : les anciens QCM Culture Générale n'ont pas de fiche
      // notion dédiée à recharger.
      notionQuizDate: isNotionQuiz ? (originalQuizDateBySourceId.get(sourceDebateId) || null) : null,
      notionQuizSlot: isNotionQuiz ? (slotBySourceId.get(sourceDebateId) || null) : null,
      streak: state.streak,
      validated: state.validated,
      target: DAILY_QUIZ_ACQUIS_VALIDATION_STREAK,
      quizDate: state.lastQuizDate
    });
  }

  await resolveMissingAcquisSourceNames(acquis, originalQuizDateBySourceId);
  for (const a of acquis) a.sourceType = a.sourceType || "histoire";

  // Plus récent en premier — les acquis les plus frais sont les plus
  // probables à intéresser l'utilisateur qui revient consulter sa banque.
  const sorted = acquis
    .sort((x, y) => (x.quizDate < y.quizDate ? 1 : x.quizDate > y.quizDate ? -1 : 0));
  if (options.includeSourceDebateId) return sorted;
  return sorted.map(({ sourceDebateId, ...rest }) => rest);
}

/* ================================================================= */
/*   Parallèle historique du jour — lib/parallele-historique.js porte */
/*   toute la logique métier ; server.js ne fait qu'injecter ses      */
/*   dépendances et exposer des routes minces.                       */
/* ================================================================= */

// Source de vérité des sujets publiés par Mnoria : les arènes créées par le
// bot/admin (creator_key MNORIA_ADMIN_CREATOR_KEY) — projection de cette
// même source dans la forme attendue par lib/parallele-historique.js.
function extractParalleleHistoriqueSources(row) {
  const sources = [];
  const seen = new Set();
  (Array.isArray(row.media_extras) ? row.media_extras : []).forEach((extra) => {
    if (!extra || typeof extra !== "object") return;
    if (String(extra.type || "source").trim() !== "source") return;
    const url = String(extra.url || extra.source_url || "").trim();
    const name = String(extra.source || extra.media || extra.publisher || "").trim();
    const key = url || name;
    if (!key || seen.has(key)) return;
    seen.add(key);
    sources.push({ name: name || null, url: url || null });
  });
  if (!sources.length && row.source_url) sources.push({ name: null, url: String(row.source_url).trim() });
  return sources;
}

// Une même actu est souvent publiée 2-3 fois (variantes gauche/droite/générale
// du même sujet) : on les regroupe par cloud_label — le même identifiant de
// sujet que les Bulles Mnoria (getCloudLabelFromDebate/normalizeCloudLabel,
// définis plus haut), pas une nouvelle notion de "sujet". À label égal, on ne
// garde que la variante la mieux sourcée (countCloudSources, déjà existant),
// puis la plus longue en cas d'égalité — "la version la plus complète".
function isParalleleHistoriqueDebateMoreComplete(candidate, current) {
  const candidateSources = countCloudSources(candidate);
  const currentSources = countCloudSources(current);
  if (candidateSources !== currentSources) return candidateSources > currentSources;
  return String(candidate.content || "").trim().length > String(current.content || "").trim().length;
}

// Deux clés de regroupement, pas une seule : le cloud_label IA n'est pas
// toujours strictement identique entre variantes d'un même sujet (deux
// arènes peuvent porter sur exactement la même actualité avec des labels
// légèrement différents — observé en conditions réelles : "Circonstance
// raciste à Crépol" vs "Circonstance aggravante racisme" pour la même
// question mot pour mot). On fusionne donc aussi par question normalisée :
// si une ligne partage SOIT son cloud_label SOIT sa question avec un groupe existant,
// elle rejoint ce groupe plutôt que d'en créer un nouveau.
function dedupeParalleleHistoriqueTopicsByCloudLabel(rows) {
  const groups = [];
  const indexByLabel = new Map();
  const indexByQuestion = new Map();

  for (const row of rows) {
    const labelKey = normalizeCloudLabel(getCloudLabelFromDebate(row));
    const questionKey = String(row.question || "").trim().toLowerCase();
    if (!labelKey && !questionKey) continue;

    let groupIndex = -1;
    if (labelKey && indexByLabel.has(labelKey)) groupIndex = indexByLabel.get(labelKey);
    else if (questionKey && indexByQuestion.has(questionKey)) groupIndex = indexByQuestion.get(questionKey);

    if (groupIndex === -1) {
      groupIndex = groups.length;
      groups.push(row);
    } else if (isParalleleHistoriqueDebateMoreComplete(row, groups[groupIndex])) {
      groups[groupIndex] = row;
    }

    if (labelKey) indexByLabel.set(labelKey, groupIndex);
    if (questionKey) indexByQuestion.set(questionKey, groupIndex);
  }

  return groups;
}

function shiftDateKeyDays(dateKey, deltaDays) {
  const [y, m, d] = String(dateKey).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// Une actualité qui continue de faire l'actu (suites d'un procès, d'une
// catastrophe...) génère une NOUVELLE arène chaque jour, avec un nouvel id —
// l'exclusion same-day entre les 3 rubriques (par id, cf.
// getPenseePhilosophiqueExcludedTopicIds) ne suffit donc pas à éviter de
// retraiter le même fait plusieurs jours d'affilée. On regarde ici, sur les
// ECLAIRAGES_LOOKBACK_DAYS derniers jours, quels sujets ont déjà été traités
// par L'UNE des 7 rubriques de la page Éclairages, et on en déduit leur
// cloud_label/question — les mêmes clés de regroupement que
// dedupeParalleleHistoriqueTopicsByCloudLabel — pour les exclure des
// candidats du jour, quel que soit leur id. La lecture est volontairement
// bloquante : mieux vaut reporter une génération que publier un doublon si
// l'historique Supabase est momentanément indisponible.
const ECLAIRAGES_LOOKBACK_DAYS = 7;
const ECLAIRAGES_TABLES = [
  "parallele_historique",
  "pensee_philosophique",
  "mecanisme_sociologique",
  "concept_du_jour",
  "citation_du_jour",
  "oeuvre_art_du_jour"
];

// Mémoïsée par dateKey (audit egress du 26/08/2026) : les 7 rubriques Éclairages
// (citation/concept/mécanisme/œuvre d'art/parallèle/pensée/latin) appellent chacune
// getPublishedTopicsForDate → cette fonction indépendamment pendant la même passe du
// scheduler (certaines même deux fois, cf. leurs propres retry internes) — jusqu'à
// 7 lectures ×7 tables (6 rubriques + debates) = 49 requêtes Supabase répétant très
// exactement le même calcul pour le même dateKey. Constaté en prod le 26/08/2026 :
// une rafale de 25+ requêtes quasi identiques en ~1 s. Vu depuis l'extérieur, c'est
// le même anti-dogpile que debatesApiInFlight/latestDebatesMetaInFlight plus haut
// dans ce fichier : une seule lecture réelle partagée par dateKey, TTL court (les
// rubriques d'une même passe se succèdent en quelques secondes/minutes, jamais 5 min).
const eclairagesRecentTopicKeysCache = new Map();
const eclairagesRecentTopicKeysInFlight = new Map();
const ECLAIRAGES_RECENT_TOPIC_KEYS_CACHE_TTL_MS = 5 * 60 * 1000;

async function getRecentlyCoveredEclairagesTopicKeys(dateKey) {
  const cached = eclairagesRecentTopicKeysCache.get(dateKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  if (!eclairagesRecentTopicKeysInFlight.has(dateKey)) {
    eclairagesRecentTopicKeysInFlight.set(
      dateKey,
      getRecentlyCoveredEclairagesTopicKeysUncached(dateKey)
        .then((value) => {
          eclairagesRecentTopicKeysCache.set(dateKey, { value, expiresAt: Date.now() + ECLAIRAGES_RECENT_TOPIC_KEYS_CACHE_TTL_MS });
          return value;
        })
        .finally(() => eclairagesRecentTopicKeysInFlight.delete(dateKey))
    );
  }
  return eclairagesRecentTopicKeysInFlight.get(dateKey);
}

async function getRecentlyCoveredEclairagesTopicKeysUncached(dateKey) {
  const startDateKey = shiftDateKeyDays(dateKey, -ECLAIRAGES_LOOKBACK_DAYS);
  const recentIds = new Set();
  for (const table of ECLAIRAGES_TABLES) {
    const { data, error } = await supabase
      .from(table)
      .select("current_topic_id")
      .eq("status", "published")
      .gte("date", startDateKey)
      .lt("date", dateKey);
    if (error) {
      console.error(`[eclairages] lecture historique récente (${table}) :`, error.message);
      throw new Error(`Vérification anti-répétition Éclairages impossible (${table}) : ${error.message}`);
    }
    (data || []).forEach((row) => {
      String(row.current_topic_id || "").split(",").map((id) => id.trim()).filter(Boolean).forEach((id) => recentIds.add(id));
    });
  }

  if (!recentIds.size) return { labelKeys: new Set(), questionKeys: new Set() };

  const { data: recentDebates, error: debatesError } = await supabase
    .from("debates")
    .select("id, question, cloud_label, keywords, category")
    .in("id", [...recentIds]);
  if (debatesError) {
    console.error("[eclairages] lecture des sujets récemment traités :", debatesError.message);
    throw new Error(`Vérification anti-répétition Éclairages impossible (debates) : ${debatesError.message}`);
  }

  const labelKeys = new Set();
  const questionKeys = new Set();
  (recentDebates || []).forEach((row) => {
    const labelKey = normalizeCloudLabel(getCloudLabelFromDebate(row));
    if (labelKey) labelKeys.add(labelKey);
    const questionKey = String(row.question || "").trim().toLowerCase();
    if (questionKey) questionKeys.add(questionKey);
  });
  return { labelKeys, questionKeys };
}

// Convention éditoriale du bot de veille sur les arènes "open" (constatée
// empiriquement le 04/08/2026 en inspectant debates.content, pas documentée
// ailleurs) : le texte se termine toujours par un court paragraphe en latin
// propre à cet article (ex. "Fulgura in itinere"), suivi d'un paragraphe
// signature (ex. "P. Ratsky", "J.L Grasso"). Utilisé UNIQUEMENT par
// latin-du-jour (cf. lib/latin-du-jour.js) pour reprendre la formule
// réellement associée à l'article plutôt que d'en faire deviner/inventer une
// par l'IA — la précédente version de la rubrique inventait un pseudo-latin
// plausible faute de voir cette formule (coupée par le slice(600) plus bas).
const DEBATE_CONTENT_SIGNATURE_PATTERN = /^[A-Z]\.\s?[A-Z]?\.?\s+[A-ZÀ-Ý][a-zà-ÿ'-]+$/;
function extractDebateContentLatinMotto(content) {
  const parts = String(content || "").split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  const signature = parts[parts.length - 1];
  const motto = parts[parts.length - 2];
  if (!DEBATE_CONTENT_SIGNATURE_PATTERN.test(signature)) return null;
  if (!motto || motto.length > 80 || /[?？!]$/.test(motto)) return null;
  return motto;
}

// Mémoïsée par dateKey (audit egress du 26/08/2026, suite du correctif sur
// getRecentlyCoveredEclairagesTopicKeys) : ce correctif-là ne couvrait que la moitié du
// problème — la requête "pool d'arènes admin du jour" ci-dessous (limit 80, colonnes
// complètes dont content/media_extras) est elle aussi rejouée à l'identique par chacune
// des 7 rubriques Éclairages pendant la même passe du scheduler. Constaté en prod : 6
// requêtes debates identiques à la même seconde (12:59:30). Même pattern anti-dogpile
// que juste au-dessus.
const publishedTopicsForDateCache = new Map();
const publishedTopicsForDateInFlight = new Map();
const PUBLISHED_TOPICS_FOR_DATE_CACHE_TTL_MS = 5 * 60 * 1000;

async function getPublishedTopicsForDate(dateKey) {
  const cached = publishedTopicsForDateCache.get(dateKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  if (!publishedTopicsForDateInFlight.has(dateKey)) {
    publishedTopicsForDateInFlight.set(
      dateKey,
      getPublishedTopicsForDateUncached(dateKey)
        .then((value) => {
          publishedTopicsForDateCache.set(dateKey, { value, expiresAt: Date.now() + PUBLISHED_TOPICS_FOR_DATE_CACHE_TTL_MS });
          return value;
        })
        .finally(() => publishedTopicsForDateInFlight.delete(dateKey))
    );
  }
  return publishedTopicsForDateInFlight.get(dateKey);
}

async function getPublishedTopicsForDateUncached(dateKey) {
  const cutoff = parisStartOfDayIso(new Date(`${dateKey}T12:00:00Z`));
  const nextDayCutoff = new Date(new Date(cutoff).getTime() + 24 * 60 * 60 * 1000).toISOString();

  // Pool plus large que les 10 sujets finaux : après déduplication par
  // sujet, il faut assez de candidats bruts pour espérer atteindre 10
  // sujets réellement distincts.
  const { data, error } = await supabase
    .from("debates")
    .select("id, question, content, category, source_url, media_extras, created_at, cloud_label, keywords, image_url")
    .eq("creator_key", MNORIA_ADMIN_CREATOR_KEY)
    .gte("created_at", cutoff)
    .lt("created_at", nextDayCutoff)
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) throw new Error(error.message);

  const dedupedTopics = dedupeParalleleHistoriqueTopicsByCloudLabel(data || []);

  const { labelKeys, questionKeys } = await getRecentlyCoveredEclairagesTopicKeys(dateKey);
  const distinctTopics = dedupedTopics.filter((row) => {
    const labelKey = normalizeCloudLabel(getCloudLabelFromDebate(row));
    if (labelKey && labelKeys.has(labelKey)) return false;
    const questionKey = String(row.question || "").trim().toLowerCase();
    if (questionKey && questionKeys.has(questionKey)) return false;
    return true;
  }).slice(0, 10);

  return distinctTopics.map((row) => ({
    id: String(row.id),
    title: String(row.question || "").trim(),
    summary: String(row.content || "").trim().slice(0, 600),
    publishedAt: row.created_at,
    category: row.category || null,
    sources: extractParalleleHistoriqueSources(row),
    // Image déjà publiée avec l'arène du sujet actuel (illustration de
    // l'actu, pas du précédent historique) — repli si Wikipedia ne trouve
    // rien de pertinent pour le précédent, cf. attachHistoricalEventImageToOne.
    currentTopicImageUrl: row.image_url || null,
    // Extraite du texte COMPLET (row.content, avant le slice(600) ci-dessus
    // qui la coupait) — seule latin-du-jour l'utilise, les autres rubriques
    // ignorent ce champ.
    latinMotto: extractDebateContentLatinMotto(row.content)
  }));
}

const PARALLELE_HISTORIQUE_MODEL = process.env.OPENAI_PARALLELE_HISTORIQUE_MODEL || "gpt-4.1-mini";

// debates.image_url n'est en pratique jamais renseigné par le bot de veille
// (vérifié : 0 image sur 1633 arènes admin) — le vrai mécanisme d'image du
// site est l'aperçu de lien existant (getExternalLinkPreview, déjà utilisé
// pour les vignettes "Autres actus"), qui va chercher l'og:image de la page
// source réelle, avec cache mémoire + disque déjà en place.
async function fetchPressPreviewImage(sourceUrl) {
  if (!sourceUrl) return null;
  const preview = await getExternalLinkPreview(sourceUrl);
  if (!preview || !preview.image) return null;
  // siteName vient de og:site_name / publisher (ou du domaine à défaut,
  // cf. buildPreviewFromHtml) : la vraie source à afficher pour créditer
  // l'image, jamais un libellé générique inventé.
  return { imageUrl: preview.image, siteName: preview.siteName || null };
}

const paralleleHistoriqueService = createParalleleHistoriqueService({
  supabase,
  callOpenAI: (messages, opts) => _callOpenAI(process.env.OPENAI_API_KEY, messages, { ...opts, feature: "daily_parallele_historique" }),
  logger: console,
  getCurrentDate: () => new Date(),
  getPublishedTopicsForDate,
  fetchPressPreviewImage,
  dateKeyFor: parisDateKey,
  model: PARALLELE_HISTORIQUE_MODEL,
  // Même convention que le reste du projet : Render = prod, tout le reste
  // (Mac local, etc.) = dev. Ce log ne contient jamais le prompt complet,
  // la clé API ni la réponse brute — juste sujets transmis + modèle.
  debugLogging: !process.env.RENDER
});

const PENSEE_PHILOSOPHIQUE_MODEL = process.env.OPENAI_PENSEE_PHILOSOPHIQUE_MODEL || "gpt-4.1-mini";

// Le parallèle historique a toujours priorité sur le choix du sujet du jour
// (cas réel observé : "Crépol" traité par les deux rubriques à la fois) :
// on attend/déclenche sa génération du jour, puis on renvoie les sujets
// qu'il a couverts pour que la pensée philosophique les exclue. Si un autre
// appelant a déjà réservé le créneau (status "generating"), on patiente
// quelques secondes plutôt que d'ignorer l'exclusion — sans bloquer
// indéfiniment (10 tentatives × 1,5 s, largement sous GENERATING_STALE_MS).
async function getPenseePhilosophiqueExcludedTopicIds(dateKey) {
  let result;
  try {
    result = await paralleleHistoriqueService.generateIfNeeded(new Date(`${dateKey}T12:00:00Z`));
  } catch (err) {
    console.error("[pensee-philosophique] attente du parallèle historique :", err.message);
    return new Set();
  }

  let attempts = 0;
  while (result && result.status === "generating" && attempts < 10) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    result = await paralleleHistoriqueService.getByDate(dateKey);
    attempts++;
  }

  if (!result || result.status !== "published" || !result.content) return new Set();
  const parallels = Array.isArray(result.content.parallels)
    ? result.content.parallels
    : (result.content.current_topic_id ? [result.content] : []);
  return new Set(parallels.map((p) => String(p.current_topic_id)).filter(Boolean));
}

// Même pool de sujets que le parallèle historique (getPublishedTopicsForDate,
// ci-dessus) : "une actu du jour" désigne la même source de vérité pour les
// deux rubriques, pas une deuxième définition de "publié aujourd'hui".
const penseePhilosophiqueService = createPenseePhilosophiqueService({
  supabase,
  callOpenAI: (messages, opts) => _callOpenAI(process.env.OPENAI_API_KEY, messages, { ...opts, feature: "daily_pensee_philosophique" }),
  logger: console,
  getCurrentDate: () => new Date(),
  getPublishedTopicsForDate,
  getExcludedTopicIds: getPenseePhilosophiqueExcludedTopicIds,
  // Repli "presse" pour l'image, même fonction que le parallèle historique
  // (aucune spécificité "pensée philosophique" côté server.js).
  fetchPressPreviewImage,
  dateKeyFor: parisDateKey,
  model: PENSEE_PHILOSOPHIQUE_MODEL,
  debugLogging: !process.env.RENDER
});

const MECANISME_SOCIOLOGIQUE_MODEL = process.env.OPENAI_MECANISME_SOCIOLOGIQUE_MODEL || "gpt-4.1-mini";

// Le parallèle historique et la pensée philosophique ont toujours priorité
// sur le choix du sujet du jour : on attend/déclenche leur génération du
// jour dans cet ordre (penseePhilosophiqueService.generateIfNeeded attend
// déjà lui-même le parallèle historique en interne, cf.
// getPenseePhilosophiqueExcludedTopicIds), puis on renvoie l'union des
// sujets qu'ils ont couverts pour que le mécanisme sociologique les exclue.
async function getMecanismeSociologiqueExcludedTopicIds(dateKey) {
  const excluded = new Set();

  let paralleleResult;
  try {
    paralleleResult = await paralleleHistoriqueService.generateIfNeeded(new Date(`${dateKey}T12:00:00Z`));
  } catch (err) {
    console.error("[mecanisme-sociologique] attente du parallèle historique :", err.message);
    paralleleResult = null;
  }
  let attempts = 0;
  while (paralleleResult && paralleleResult.status === "generating" && attempts < 10) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    paralleleResult = await paralleleHistoriqueService.getByDate(dateKey);
    attempts++;
  }
  if (paralleleResult && paralleleResult.status === "published" && paralleleResult.content) {
    const parallels = Array.isArray(paralleleResult.content.parallels)
      ? paralleleResult.content.parallels
      : (paralleleResult.content.current_topic_id ? [paralleleResult.content] : []);
    parallels.forEach((p) => { if (p.current_topic_id) excluded.add(String(p.current_topic_id)); });
  }

  let penseeResult;
  try {
    penseeResult = await penseePhilosophiqueService.generateIfNeeded(new Date(`${dateKey}T12:00:00Z`));
  } catch (err) {
    console.error("[mecanisme-sociologique] attente de la pensée philosophique :", err.message);
    penseeResult = null;
  }
  attempts = 0;
  while (penseeResult && penseeResult.status === "generating" && attempts < 10) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    penseeResult = await penseePhilosophiqueService.getByDate(dateKey);
    attempts++;
  }
  if (penseeResult && penseeResult.status === "published" && penseeResult.content) {
    const pensees = Array.isArray(penseeResult.content.pensees) ? penseeResult.content.pensees : [];
    pensees.forEach((p) => { if (p.current_topic_id) excluded.add(String(p.current_topic_id)); });
  }

  return excluded;
}

// Même pool de sujets que les deux autres rubriques (getPublishedTopicsForDate,
// ci-dessus) : "une actu du jour" désigne la même source de vérité pour les
// trois rubriques, pas une troisième définition de "publié aujourd'hui".
const mecanismeSociologiqueService = createMecanismeSociologiqueService({
  supabase,
  callOpenAI: (messages, opts) => _callOpenAI(process.env.OPENAI_API_KEY, messages, { ...opts, feature: "daily_mecanisme_sociologique" }),
  logger: console,
  getCurrentDate: () => new Date(),
  getPublishedTopicsForDate,
  getExcludedTopicIds: getMecanismeSociologiqueExcludedTopicIds,
  // Repli "presse" pour l'image, même fonction que les deux autres rubriques
  // (aucune spécificité "mécanisme sociologique" côté server.js).
  fetchPressPreviewImage,
  dateKeyFor: parisDateKey,
  model: MECANISME_SOCIOLOGIQUE_MODEL,
  debugLogging: !process.env.RENDER
});

const CONCEPT_DU_JOUR_MODEL = process.env.OPENAI_CONCEPT_DU_JOUR_MODEL || "gpt-4.1-mini";

// Les trois autres rubriques Éclairages ont toujours priorité sur le choix
// du sujet du jour : on attend/déclenche leur génération du jour dans cet
// ordre (mecanismeSociologiqueService.generateIfNeeded attend déjà lui-même
// le parallèle historique et la pensée philosophique en interne, cf.
// getMecanismeSociologiqueExcludedTopicIds), puis on renvoie l'union des
// sujets qu'elles ont couverts pour que le concept du jour les exclue.
async function getConceptDuJourExcludedTopicIds(dateKey) {
  const excluded = new Set();

  let paralleleResult;
  try {
    paralleleResult = await paralleleHistoriqueService.generateIfNeeded(new Date(`${dateKey}T12:00:00Z`));
  } catch (err) {
    console.error("[concept-du-jour] attente du parallèle historique :", err.message);
    paralleleResult = null;
  }
  let attempts = 0;
  while (paralleleResult && paralleleResult.status === "generating" && attempts < 10) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    paralleleResult = await paralleleHistoriqueService.getByDate(dateKey);
    attempts++;
  }
  if (paralleleResult && paralleleResult.status === "published" && paralleleResult.content) {
    const parallels = Array.isArray(paralleleResult.content.parallels)
      ? paralleleResult.content.parallels
      : (paralleleResult.content.current_topic_id ? [paralleleResult.content] : []);
    parallels.forEach((p) => { if (p.current_topic_id) excluded.add(String(p.current_topic_id)); });
  }

  let penseeResult;
  try {
    penseeResult = await penseePhilosophiqueService.generateIfNeeded(new Date(`${dateKey}T12:00:00Z`));
  } catch (err) {
    console.error("[concept-du-jour] attente de la pensée philosophique :", err.message);
    penseeResult = null;
  }
  attempts = 0;
  while (penseeResult && penseeResult.status === "generating" && attempts < 10) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    penseeResult = await penseePhilosophiqueService.getByDate(dateKey);
    attempts++;
  }
  if (penseeResult && penseeResult.status === "published" && penseeResult.content) {
    const pensees = Array.isArray(penseeResult.content.pensees) ? penseeResult.content.pensees : [];
    pensees.forEach((p) => { if (p.current_topic_id) excluded.add(String(p.current_topic_id)); });
  }

  let mecanismeResult;
  try {
    mecanismeResult = await mecanismeSociologiqueService.generateIfNeeded(new Date(`${dateKey}T12:00:00Z`));
  } catch (err) {
    console.error("[concept-du-jour] attente du mécanisme sociologique :", err.message);
    mecanismeResult = null;
  }
  attempts = 0;
  while (mecanismeResult && mecanismeResult.status === "generating" && attempts < 10) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    mecanismeResult = await mecanismeSociologiqueService.getByDate(dateKey);
    attempts++;
  }
  if (mecanismeResult && mecanismeResult.status === "published" && mecanismeResult.content) {
    const mecanismes = Array.isArray(mecanismeResult.content.mecanismes) ? mecanismeResult.content.mecanismes : [];
    mecanismes.forEach((m) => { if (m.current_topic_id) excluded.add(String(m.current_topic_id)); });
  }

  return excluded;
}

// Même pool de sujets que les trois autres rubriques (getPublishedTopicsForDate,
// ci-dessus) : "une actu du jour" désigne la même source de vérité pour les
// quatre rubriques, pas une quatrième définition de "publié aujourd'hui".
const conceptDuJourService = createConceptDuJourService({
  supabase,
  callOpenAI: (messages, opts) => _callOpenAI(process.env.OPENAI_API_KEY, messages, { ...opts, feature: "daily_concept_du_jour" }),
  logger: console,
  getCurrentDate: () => new Date(),
  getPublishedTopicsForDate,
  getExcludedTopicIds: getConceptDuJourExcludedTopicIds,
  // Repli "presse" pour l'image, même fonction que les trois autres rubriques
  // (aucune spécificité "concept du jour" côté server.js).
  fetchPressPreviewImage,
  dateKeyFor: parisDateKey,
  model: CONCEPT_DU_JOUR_MODEL,
  debugLogging: !process.env.RENDER
});

const CITATION_DU_JOUR_MODEL = process.env.OPENAI_CITATION_DU_JOUR_MODEL || "gpt-4.1-mini";

// Les quatre autres rubriques Éclairages ont toujours priorité sur le choix
// du sujet du jour : on attend/déclenche leur génération du jour dans cet
// ordre (conceptDuJourService.generateIfNeeded attend déjà lui-même le
// parallèle historique, la pensée philosophique et le mécanisme
// sociologique en interne, cf. getConceptDuJourExcludedTopicIds), puis on
// renvoie l'union des sujets qu'elles ont couverts pour que la citation du
// jour les exclue.
async function getCitationDuJourExcludedTopicIds(dateKey) {
  const excluded = await getConceptDuJourExcludedTopicIds(dateKey);

  let conceptResult;
  try {
    conceptResult = await conceptDuJourService.generateIfNeeded(new Date(`${dateKey}T12:00:00Z`));
  } catch (err) {
    console.error("[citation-du-jour] attente du concept du jour :", err.message);
    conceptResult = null;
  }
  let attempts = 0;
  while (conceptResult && conceptResult.status === "generating" && attempts < 10) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    conceptResult = await conceptDuJourService.getByDate(dateKey);
    attempts++;
  }
  if (conceptResult && conceptResult.status === "published" && conceptResult.content) {
    const concepts = Array.isArray(conceptResult.content.concepts) ? conceptResult.content.concepts : [];
    concepts.forEach((c) => { if (c.current_topic_id) excluded.add(String(c.current_topic_id)); });
  }

  return excluded;
}

// Même pool de sujets que les quatre autres rubriques (getPublishedTopicsForDate,
// plus haut) : "une actu du jour" désigne la même source de vérité pour les
// cinq rubriques, pas une cinquième définition de "publié aujourd'hui". La
// citation du jour choisit son sujet comme les autres, mais sa présentation
// reste volontairement simple (cf. lib/citation-du-jour.js et
// prompts/citation-du-jour.js) : pas de repli "presse" pour l'image — elle
// représente l'auteur cité, jamais le sujet d'actualité.
const citationDuJourService = createCitationDuJourService({
  supabase,
  callOpenAI: (messages, opts) => _callOpenAI(process.env.OPENAI_API_KEY, messages, { ...opts, feature: "daily_citation_du_jour" }),
  logger: console,
  getCurrentDate: () => new Date(),
  getPublishedTopicsForDate,
  getExcludedTopicIds: getCitationDuJourExcludedTopicIds,
  dateKeyFor: parisDateKey,
  model: CITATION_DU_JOUR_MODEL,
  debugLogging: !process.env.RENDER
});

const OEUVRE_ART_DU_JOUR_MODEL = process.env.OPENAI_OEUVRE_ART_DU_JOUR_MODEL || "gpt-4.1-mini";

// Les cinq autres rubriques Éclairages ont toujours priorité sur le choix
// du sujet du jour : on attend/déclenche leur génération du jour dans cet
// ordre (citationDuJourService.generateIfNeeded attend déjà lui-même les
// quatre autres en interne, cf. getCitationDuJourExcludedTopicIds), puis on
// renvoie l'union des sujets qu'elles ont couverts pour que l'œuvre d'art
// du jour les exclue.
async function getOeuvreArtDuJourExcludedTopicIds(dateKey) {
  const excluded = await getCitationDuJourExcludedTopicIds(dateKey);

  let citationResult;
  try {
    citationResult = await citationDuJourService.generateIfNeeded(new Date(`${dateKey}T12:00:00Z`));
  } catch (err) {
    console.error("[oeuvre-art-du-jour] attente de la citation du jour :", err.message);
    citationResult = null;
  }
  let attempts = 0;
  while (citationResult && citationResult.status === "generating" && attempts < 10) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    citationResult = await citationDuJourService.getByDate(dateKey);
    attempts++;
  }
  if (citationResult && citationResult.status === "published" && citationResult.content) {
    const citations = Array.isArray(citationResult.content.citations) ? citationResult.content.citations : [];
    citations.forEach((c) => { if (c.current_topic_id) excluded.add(String(c.current_topic_id)); });
  }

  return excluded;
}

// Même pool de sujets que les cinq autres rubriques (getPublishedTopicsForDate,
// plus haut) : "une actu du jour" désigne la même source de vérité pour les
// six rubriques, pas une sixième définition de "publié aujourd'hui". L'œuvre
// d'art du jour choisit son sujet comme les autres, mais sa présentation
// reste volontairement simple (cf. lib/oeuvre-art-du-jour.js et
// prompts/oeuvre-art-du-jour.js) : pas de repli "presse" pour l'image —
// c'est l'œuvre elle-même (ou l'artiste en repli) qui est représentée,
// jamais le sujet d'actualité.
const oeuvreArtDuJourService = createOeuvreArtDuJourService({
  supabase,
  callOpenAI: (messages, opts) => _callOpenAI(process.env.OPENAI_API_KEY, messages, { ...opts, feature: "daily_oeuvre_art_du_jour" }),
  logger: console,
  getCurrentDate: () => new Date(),
  getPublishedTopicsForDate,
  getExcludedTopicIds: getOeuvreArtDuJourExcludedTopicIds,
  dateKeyFor: parisDateKey,
  model: OEUVRE_ART_DU_JOUR_MODEL,
  debugLogging: !process.env.RENDER
});

const LATIN_DU_JOUR_MODEL = process.env.OPENAI_LATIN_DU_JOUR_MODEL || "gpt-4.1-mini";

// Les six autres rubriques Éclairages ont toujours priorité sur le choix
// du sujet du jour : on attend/déclenche leur génération du jour dans cet
// ordre (oeuvreArtDuJourService.generateIfNeeded attend déjà lui-même les
// cinq autres en interne, cf. getOeuvreArtDuJourExcludedTopicIds), puis on
// renvoie l'union des sujets qu'elles ont couverts pour que le mot latin
// du jour les exclue.
async function getLatinDuJourExcludedTopicIds(dateKey) {
  const excluded = await getOeuvreArtDuJourExcludedTopicIds(dateKey);

  let oeuvreResult;
  try {
    oeuvreResult = await oeuvreArtDuJourService.generateIfNeeded(new Date(`${dateKey}T12:00:00Z`));
  } catch (err) {
    console.error("[latin-du-jour] attente de l'œuvre d'art du jour :", err.message);
    oeuvreResult = null;
  }
  let attempts = 0;
  while (oeuvreResult && oeuvreResult.status === "generating" && attempts < 10) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    oeuvreResult = await oeuvreArtDuJourService.getByDate(dateKey);
    attempts++;
  }
  if (oeuvreResult && oeuvreResult.status === "published" && oeuvreResult.content) {
    const oeuvres = Array.isArray(oeuvreResult.content.oeuvres) ? oeuvreResult.content.oeuvres : [];
    oeuvres.forEach((o) => { if (o.current_topic_id) excluded.add(String(o.current_topic_id)); });
  }

  return excluded;
}

// Même pool de sujets que les six autres rubriques (getPublishedTopicsForDate,
// plus haut) : "une actu du jour" désigne la même source de vérité pour les
// sept rubriques, pas une septième définition de "publié aujourd'hui". Le
// mot latin du jour choisit son sujet comme les autres, mais sa présentation
// reste volontairement simple (cf. lib/latin-du-jour.js et
// prompts/latin-du-jour.js) : pas d'image — contrairement aux autres
// rubriques, aucune personne réelle ni œuvre n'est représentée ici.
const latinDuJourService = createLatinDuJourService({
  supabase,
  callOpenAI: (messages, opts) => _callOpenAI(process.env.OPENAI_API_KEY, messages, { ...opts, feature: "daily_latin_du_jour" }),
  logger: console,
  getCurrentDate: () => new Date(),
  getPublishedTopicsForDate,
  getExcludedTopicIds: getLatinDuJourExcludedTopicIds,
  dateKeyFor: parisDateKey,
  model: LATIN_DU_JOUR_MODEL,
  debugLogging: !process.env.RENDER
});

// Condition commune au push quotidien : une annonce « arènes ouvertes » ne
// peut partir qu'après la publication réelle des sept rubriques Éclairages.
// L'ordre ci-dessous est aussi leur ordre de priorité anti-doublon.
const DAILY_ECLAIRAGES_PUBLICATION_SERVICES = [
  ["parallele_historique", paralleleHistoriqueService],
  ["pensee_philosophique", penseePhilosophiqueService],
  ["mecanisme_sociologique", mecanismeSociologiqueService],
  ["concept_du_jour", conceptDuJourService],
  ["citation_du_jour", citationDuJourService],
  ["oeuvre_art_du_jour", oeuvreArtDuJourService],
  ["latin_du_jour", latinDuJourService]
];
const DAILY_ECLAIRAGES_PUSH_WAIT_ATTEMPTS = 100;
const DAILY_ECLAIRAGES_PUSH_WAIT_MS = 3000;

async function ensureDailyEclairagesPublished(date = new Date()) {
  const dateKey = parisDateKey(date);
  const published = [];

  for (const [name, service] of DAILY_ECLAIRAGES_PUBLICATION_SERVICES) {
    let result = await service.generateIfNeeded(date);

    // Un scheduler peut avoir réservé la rubrique quelques secondes avant
    // l'appel du pipeline. On attend sa fin au lieu d'envoyer le push trop tôt
    // ou de lancer une deuxième génération concurrente.
    for (
      let attempt = 0;
      result?.status === "generating" && attempt < DAILY_ECLAIRAGES_PUSH_WAIT_ATTEMPTS;
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, DAILY_ECLAIRAGES_PUSH_WAIT_MS));
      result = await service.getByDate(dateKey);
    }

    if (result?.status !== "published") {
      const reason = String(result?.error || result?.reason || result?.status || "statut inconnu");
      throw new Error(`${name} non publié (${reason})`);
    }
    published.push(name);
  }

  return { date: dateKey, published };
}

// Mémoïsé par dateKey (audit egress du 26/08/2026) : /api/eclairages/status est pollée
// toutes les 60s par CHAQUE visiteur qui laisse l'accueil ouvert (cf. refreshEclairagesAvailability
// dans index.html), sans jamais s'arrêter tant que les 7 rubriques ne sont pas publiées — donc
// potentiellement toute une journée entière si le bot de veille n'a rien publié. Sans cache,
// chaque poll relisait les 7 tables à chaque appel, pour chaque visiteur. Même pattern
// anti-dogpile que les autres caches de ce fichier, TTL aligné sur l'intervalle de poll (60s) :
// un poll sur deux au pire tombe sur un cache chaud, jamais plus d'une lecture réelle par minute
// au total quel que soit le nombre de visiteurs simultanés.
const eclairagesStatusCache = new Map();
const eclairagesStatusInFlight = new Map();
const ECLAIRAGES_STATUS_CACHE_TTL_MS = 60 * 1000;

async function getDailyEclairagesPublicationStatus(date = new Date()) {
  const dateKey = parisDateKey(date);

  const cached = eclairagesStatusCache.get(dateKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  if (!eclairagesStatusInFlight.has(dateKey)) {
    eclairagesStatusInFlight.set(
      dateKey,
      (async () => {
        const results = await Promise.all(
          DAILY_ECLAIRAGES_PUBLICATION_SERVICES.map(async ([name, service]) => {
            const result = await service.getByDate(dateKey);
            return { name, status: result?.status || "not_found" };
          })
        );
        const value = {
          date: dateKey,
          available: results.every((item) => item.status === "published"),
          sections: results
        };
        // Une fois "available", le statut ne peut plus redevenir faux avant demain (les
        // rubriques publiées ne sont jamais dépubliées) : cache plus long pour ne plus jamais
        // relire une fois le résultat définitif atteint pour la journée.
        const ttl = value.available ? 30 * 60 * 1000 : ECLAIRAGES_STATUS_CACHE_TTL_MS;
        eclairagesStatusCache.set(dateKey, { value, expiresAt: Date.now() + ttl });
        return value;
      })().finally(() => eclairagesStatusInFlight.delete(dateKey))
    );
  }
  return eclairagesStatusInFlight.get(dateKey);
}

// Interrupteur indépendant (mêmes règles que ci-dessus) pour le parallèle
// historique : peut être activé/désactivé sans toucher au QCM.
const PARALLELE_HISTORIQUE_SCHEDULER_ENABLED = (() => {
  const forced = String(process.env.MNORIA_PARALLELE_HISTORIQUE_SCHEDULER || "").trim().toLowerCase();
  if (forced === "on") return true;
  if (forced === "off") return false;
  return Boolean(process.env.RENDER);
})();
// Déclenché à partir de la même heure que le QCM du matin : les 10 sujets
// du jour sont normalement déjà publiés à ce moment-là.
const PARALLELE_HISTORIQUE_TRIGGER_HOUR = 9;

// Interrupteur indépendant (mêmes règles) pour la pensée philosophique :
// peut être activé/désactivé sans toucher au QCM ni au parallèle historique.
const PENSEE_PHILOSOPHIQUE_SCHEDULER_ENABLED = (() => {
  const forced = String(process.env.MNORIA_PENSEE_PHILOSOPHIQUE_SCHEDULER || "").trim().toLowerCase();
  if (forced === "on") return true;
  if (forced === "off") return false;
  return Boolean(process.env.RENDER);
})();
const PENSEE_PHILOSOPHIQUE_TRIGGER_HOUR = 9;

// Interrupteur indépendant (mêmes règles) pour le mécanisme sociologique :
// peut être activé/désactivé sans toucher aux deux autres rubriques.
const MECANISME_SOCIOLOGIQUE_SCHEDULER_ENABLED = (() => {
  const forced = String(process.env.MNORIA_MECANISME_SOCIOLOGIQUE_SCHEDULER || "").trim().toLowerCase();
  if (forced === "on") return true;
  if (forced === "off") return false;
  return Boolean(process.env.RENDER);
})();
const MECANISME_SOCIOLOGIQUE_TRIGGER_HOUR = 9;

// Interrupteur indépendant (mêmes règles) pour le concept du jour : peut
// être activé/désactivé sans toucher aux trois autres rubriques.
const CONCEPT_DU_JOUR_SCHEDULER_ENABLED = (() => {
  const forced = String(process.env.MNORIA_CONCEPT_DU_JOUR_SCHEDULER || "").trim().toLowerCase();
  if (forced === "on") return true;
  if (forced === "off") return false;
  return Boolean(process.env.RENDER);
})();
const CONCEPT_DU_JOUR_TRIGGER_HOUR = 9;

// Interrupteur indépendant (mêmes règles) pour la citation du jour : peut
// être activé/désactivé sans toucher aux quatre autres rubriques.
const CITATION_DU_JOUR_SCHEDULER_ENABLED = (() => {
  const forced = String(process.env.MNORIA_CITATION_DU_JOUR_SCHEDULER || "").trim().toLowerCase();
  if (forced === "on") return true;
  if (forced === "off") return false;
  return Boolean(process.env.RENDER);
})();
const CITATION_DU_JOUR_TRIGGER_HOUR = 9;

// Interrupteur indépendant (mêmes règles) pour l'œuvre d'art du jour : peut
// être activé/désactivé sans toucher aux cinq autres rubriques.
const OEUVRE_ART_DU_JOUR_SCHEDULER_ENABLED = (() => {
  const forced = String(process.env.MNORIA_OEUVRE_ART_DU_JOUR_SCHEDULER || "").trim().toLowerCase();
  if (forced === "on") return true;
  if (forced === "off") return false;
  return Boolean(process.env.RENDER);
})();
const OEUVRE_ART_DU_JOUR_TRIGGER_HOUR = 9;

// Interrupteur indépendant (mêmes règles) pour le mot latin du jour : peut
// être activé/désactivé sans toucher aux six autres rubriques.
const LATIN_DU_JOUR_SCHEDULER_ENABLED = (() => {
  const forced = String(process.env.MNORIA_LATIN_DU_JOUR_SCHEDULER || "").trim().toLowerCase();
  if (forced === "on") return true;
  if (forced === "off") return false;
  return Boolean(process.env.RENDER);
})();
const LATIN_DU_JOUR_TRIGGER_HOUR = 9;

if (
  PARALLELE_HISTORIQUE_SCHEDULER_ENABLED ||
  PENSEE_PHILOSOPHIQUE_SCHEDULER_ENABLED || MECANISME_SOCIOLOGIQUE_SCHEDULER_ENABLED ||
  CONCEPT_DU_JOUR_SCHEDULER_ENABLED || CITATION_DU_JOUR_SCHEDULER_ENABLED ||
  OEUVRE_ART_DU_JOUR_SCHEDULER_ENABLED || LATIN_DU_JOUR_SCHEDULER_ENABLED
) {
  // Un seul setInterval partagé entre parallèle historique, pensée
  // philosophique, mécanisme sociologique, concept du jour, citation du
  // jour, œuvre d'art du jour et mot latin du jour, chacun gardé par son
  // propre interrupteur — pas de scheduler dupliqué. Le QCM n'a plus de
  // génération planifiée (cf. buildNotionQuestions, généré à la demande).
  // Garde-fou (demande du 26/08/2026, suite à l'audit egress) : les 7 rubriques Éclairages
  // partagent toutes le même pool de sujets (getPublishedTopicsForDate, filtré sur les
  // arènes créées AUJOURD'HUI par le bot de veille) — tant que celui-ci n'a rien publié,
  // ce pool est vide pour les 7 à la fois. Sans cette vérification, chacune tentait quand
  // même son cycle complet (claim + fetch + reste bloquée en "generating" faute de sujet +
  // reclaim 20 min plus tard, en boucle jusqu'à la première publication du jour) — constaté
  // en prod le 26/08/2026 : ~30 requêtes Supabase par tick de scheduler pour rien tant
  // qu'aucun article n'est publié. Une seule lecture légère (limit 1) évite de lancer les
  // 7 tentatives dans ce cas. Fail-open sur erreur : en cas de souci sur CETTE vérification,
  // on laisse les rubriques tenter normalement plutôt que de les bloquer à tort.
  async function hasAdminPublishedDebateToday(dateKey) {
    const cutoff = parisStartOfDayIso(new Date(`${dateKey}T12:00:00Z`));
    const nextDayCutoff = new Date(new Date(cutoff).getTime() + 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("debates")
      .select("id")
      .eq("creator_key", MNORIA_ADMIN_CREATOR_KEY)
      .gte("created_at", cutoff)
      .lt("created_at", nextDayCutoff)
      .limit(1);
    if (error) throw new Error(error.message);
    return (data || []).length > 0;
  }

  const tryRunDailySchedulers = async () => {
    const hour = parisHour();
    const hasContent = await hasAdminPublishedDebateToday(parisDateKey()).catch((err) => {
      console.error("[eclairages] vérification présence d'articles admin du jour :", err.message);
      return true;
    });
    if (!hasContent) {
      console.log(`[eclairages] aucun article publié aujourd'hui (${parisDateKey()}), génération Éclairages reportée.`);
      return;
    }
    if (PARALLELE_HISTORIQUE_SCHEDULER_ENABLED && hour >= PARALLELE_HISTORIQUE_TRIGGER_HOUR) {
      paralleleHistoriqueService.generateIfNeeded(new Date())
        .catch((err) => console.error("[parallele-historique scheduler]", err.message));
    }
    if (PENSEE_PHILOSOPHIQUE_SCHEDULER_ENABLED && hour >= PENSEE_PHILOSOPHIQUE_TRIGGER_HOUR) {
      penseePhilosophiqueService.generateIfNeeded(new Date())
        .catch((err) => console.error("[pensee-philosophique scheduler]", err.message));
    }
    if (MECANISME_SOCIOLOGIQUE_SCHEDULER_ENABLED && hour >= MECANISME_SOCIOLOGIQUE_TRIGGER_HOUR) {
      mecanismeSociologiqueService.generateIfNeeded(new Date())
        .catch((err) => console.error("[mecanisme-sociologique scheduler]", err.message));
    }
    if (CONCEPT_DU_JOUR_SCHEDULER_ENABLED && hour >= CONCEPT_DU_JOUR_TRIGGER_HOUR) {
      conceptDuJourService.generateIfNeeded(new Date())
        .catch((err) => console.error("[concept-du-jour scheduler]", err.message));
    }
    if (CITATION_DU_JOUR_SCHEDULER_ENABLED && hour >= CITATION_DU_JOUR_TRIGGER_HOUR) {
      citationDuJourService.generateIfNeeded(new Date())
        .catch((err) => console.error("[citation-du-jour scheduler]", err.message));
    }
    if (OEUVRE_ART_DU_JOUR_SCHEDULER_ENABLED && hour >= OEUVRE_ART_DU_JOUR_TRIGGER_HOUR) {
      oeuvreArtDuJourService.generateIfNeeded(new Date())
        .catch((err) => console.error("[oeuvre-art-du-jour scheduler]", err.message));
    }
    if (LATIN_DU_JOUR_SCHEDULER_ENABLED && hour >= LATIN_DU_JOUR_TRIGGER_HOUR) {
      latinDuJourService.generateIfNeeded(new Date())
        .catch((err) => console.error("[latin-du-jour scheduler]", err.message));
    }
  };
  tryRunDailySchedulers();
  setInterval(tryRunDailySchedulers, 20 * 60 * 1000).unref();
}

// Le contenu d'un QCM (questions/options/corrections) est figé une fois
// généré pour le jour : re-fetcher daily_quiz à chaque clic sur une réponse
// (un aller-retour Supabase par clic, pour TOUS les visiteurs sur ce
// créneau) ralentissait inutilement la réponse. TTL 5 min, largement
// suffisant vu que /api/daily-quiz/today a déjà chargé le même contenu à
// l'ouverture de la page.
const _dailyQuizQuestionsCache = new Map();
const DAILY_QUIZ_QUESTIONS_CACHE_TTL_MS = 5 * 60 * 1000;

async function getDailyQuizQuestions(quizDate, slot, voterKey) {
  // "Renforcement des connaissances" : jamais de ligne daily_quiz à lire,
  // uniquement les repasses de répétition espacée dues aujourd'hui pour ce
  // visiteur (cf. fetchCultureGeneraleReviewInjectionForToday) — pas de
  // cache ici, ce calcul doit refléter la réponse qu'on vient de soumettre
  // immédiatement (sinon une question repasse due réapparaîtrait encore
  // quelques minutes après avoir été répondue), coût modeste borné à
  // l'historique d'un seul visiteur.
  if (slot === DAILY_QUIZ_REINFORCEMENT_SLOT) {
    const key = String(voterKey || "").trim();
    if (!key) return [];
    return fetchCultureGeneraleReviewInjectionForToday(key, quizDate);
  }
  if (slot === DAILY_QUIZ_COMPREHENSION_SLOT) {
    const key = String(voterKey || "").trim();
    if (!key) return [];
    const cacheKey = `comprendre:${quizDate}:${key}`;
    const cached = _dailyQuizQuestionsCache.get(cacheKey);
    if (cached && Date.now() - cached.at < DAILY_QUIZ_QUESTIONS_CACHE_TTL_MS) return cached.questions;
    const questions = await fetchCultureGeneraleComprehensionQuestions(key, quizDate);
    _dailyQuizQuestionsCache.set(cacheKey, { at: Date.now(), questions });
    return questions;
  }

  const cacheKey = `${quizDate}:${slot}`;
  const cached = _dailyQuizQuestionsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < DAILY_QUIZ_QUESTIONS_CACHE_TTL_MS) {
    return cached.questions;
  }
  const { data, error } = await supabase
    .from("daily_quiz")
    .select("questions")
    .eq("quiz_date", quizDate)
    .eq("slot", slot)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const baseQuestions = data?.questions || [];
  _dailyQuizQuestionsCache.set(cacheKey, { at: Date.now(), questions: baseQuestions });
  return baseQuestions;
}

const _dailyQuizStatsCache = new Map();
const DAILY_QUIZ_STATS_CACHE_TTL_MS = 30 * 1000;

async function getDailyQuizStats(quizDate, questionId) {
  const cacheKey = `${quizDate}:${questionId}`;
  const cached = _dailyQuizStatsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < DAILY_QUIZ_STATS_CACHE_TTL_MS) return cached.result;

  const { data, error } = await supabase
    .from("daily_quiz_answers")
    .select("option_index")
    .eq("quiz_date", quizDate)
    .eq("question_id", questionId);
  if (error) throw new Error(error.message);

  const stats = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const row of data || []) {
    if (row.option_index >= 0 && row.option_index <= 3) stats[row.option_index] += 1;
  }
  const total = stats[0] + stats[1] + stats[2] + stats[3];
  const result = { stats, total };
  _dailyQuizStatsCache.set(cacheKey, { at: Date.now(), result });
  return result;
}

// Renseigne le bandeau/bouton d'accueil : uniquement l'état de
// "Renforcement" désormais — plus de créneau "daily" ni de defaultSlot
// (le bouton "Connaissances" pointe simplement vers /qcm-du-jour, cf.
// views/index.html, et le QCM lui-même n'a plus de génération planifiée).
app.get("/api/daily-quiz/status", async (req, res) => {
  try {
    const todayKey = parisDateKey();
    // "Renforcement" n'a pas de ligne daily_quiz à vérifier (cf.
    // DAILY_QUIZ_REINFORCEMENT_SLOT) : disponible seulement s'il existe au
    // moins une repasse due aujourd'hui pour ce visiteur précis.
    const voterKey = String(req.query.voterKey || "").trim();
    const [reinforcementQuestions, comprehensionAvailable] = voterKey
      ? await Promise.all([
          fetchCultureGeneraleReviewInjectionForToday(voterKey, todayKey),
          hasCultureGeneraleComprehensionLinks(voterKey)
        ])
      : [[], false];
    const slots = {
      [DAILY_QUIZ_REINFORCEMENT_SLOT]: {
        available: reinforcementQuestions.length > 0,
        label: DAILY_QUIZ_REINFORCEMENT_LABEL
      },
      [DAILY_QUIZ_COMPREHENSION_SLOT]: {
        available: comprehensionAvailable,
        label: DAILY_QUIZ_COMPREHENSION_LABEL
      }
    };
    res.json({ date: todayKey, slots, defaultSlot: null });
  } catch (error) {
    res.status(500).json({ date: null, slots: {}, defaultSlot: null, error: error.message });
  }
});

// Ne renvoie jamais la bonne réponse avant que l'utilisateur ait répondu
// (cf. POST /answer, seul endroit qui la révèle). Pour "association", ne
// renvoie surtout pas `pairs` tel quel (le mapping correct) : seulement les
// deux colonnes séparées, `rights` mélangé — l'appariement se fait par
// valeur texte côté client, pas par position, donc mélanger `lefts` n'aurait
// aucun intérêt. `origin`/`sourceType` (jamais la bonne réponse) permettent
// au frontend d'afficher un badge distinguant une question actu d'une
// question culture générale au sein de la session fusionnée.
function stripQuestionForClient(q) {
  const type = q.type || "qcm";
  const origin = String(q.id || "").startsWith("comprendre:")
    ? "comprendre"
    : (isCultureGeneraleQuestionId(q.id) ? "culture_generale" : "actu");
  // image (demande du 18/08/2026) : fond de la question pendant le QCM
  // (Découvrir/Ancrer/Relier), cf. applyQuestionBackgroundImage côté client.
  // Réutilise q.sourceDetail.image déjà stocké sur CHAQUE question depuis sa
  // génération (cf. buildNotionQuestions) — jamais une nouvelle recherche
  // d'image ici, ni un appel supplémentaire à lib/knowledge-image-search.js.
  // Sur Ancrer/Relier, deux questions consécutives d'une même session
  // peuvent venir de sujets différents, donc avoir des images différentes
  // (ou aucune) : c'est voulu, jamais lissé/uniformisé côté serveur.
  const image = q.sourceDetail && q.sourceDetail.image && q.sourceDetail.image.url ? q.sourceDetail.image : null;
  const originFields = { origin, ...(q.sourceType ? { sourceType: q.sourceType } : {}), ...(image ? { image } : {}) };
  if (type === "association") {
    const pairs = Array.isArray(q.pairs) ? q.pairs : [];
    return {
      id: q.id,
      type,
      question: q.question,
      lefts: pairs.map((p) => p.left),
      rights: shuffleArray(pairs.map((p) => p.right)),
      ...originFields
    };
  }
  if (type === "ordre") {
    // q.items est stocké dans le bon ordre (c'est la réponse) : le client ne
    // doit jamais le recevoir tel quel, seulement mélangé.
    return { id: q.id, type, question: q.question, items: shuffleArray(Array.isArray(q.items) ? q.items : []), ...originFields };
  }
  // qcm/texte_a_trous/intrus/qcm_multi partagent tous "options" — tout comme
  // le format "vrai_faux" (retiré de la génération le 16/08/2026, section 5 :
  // interdiction absolue, mais MemoryItems historiques jamais retouchés,
  // toujours rendus/corrigés à l'identique ici). correctIndex/correctIndexes
  // ne sont jamais inclus ici, seulement révélés après réponse (cf. POST
  // /answer et GET /results). selfContained (cf. validateQuestionItemCore)
  // sert au client à décider d'afficher ou non l'écran "réfléchis avant de
  // voir les propositions" — transmis même pour les types qui l'ignorent
  // (vrai_faux/intrus), sans effet côté client.
  // helpLevel (cf. lib/spaced-repetition/help-level.js) : uniquement attaché
  // par fetchCultureGeneraleReviewInjectionForToday (seul point qui a accès à
  // l'état FSRS au moment de servir une question) — absent pour toute autre
  // question (premier passage jamais encore revu, QCM actu hors FSRS...) ;
  // repli "guided" ici (jamais undefined) pour que le front n'ait jamais à
  // gérer une valeur manquante.
  return {
    id: q.id, type, question: q.question, options: q.options,
    selfContained: q.selfContained === true,
    helpLevel: HELP_LEVELS.includes(q.helpLevel) ? q.helpLevel : "guided",
    ...originFields
  };
}

// Un QCM de notion vit sous sa date de création (cf. buildNotionQuestions),
// jamais forcément aujourd'hui — le slot "renforcement" reste toujours
// calculé sur aujourd'hui (repasses dues du jour), toute autre valeur de
// `date` transmise est ignorée pour lui.
function resolveDailyQuizRequestDate(slot, rawDate) {
  const requested = String(rawDate || "").trim();
  if (slot === DAILY_QUIZ_REINFORCEMENT_SLOT
      || slot === DAILY_QUIZ_COMPREHENSION_SLOT
      || !/^\d{4}-\d{2}-\d{2}$/.test(requested)) return parisDateKey();
  return requested;
}

app.get("/api/daily-quiz/today", async (req, res) => {
  try {
    const slot = String(req.query.slot || "").trim();
    if (!isValidDailyQuizSlot(slot)) return res.status(400).json({ date: null, questions: [], error: "Créneau invalide." });

    // Pour le pseudo-slot "renforcement", getDailyQuizQuestions renvoie
    // directement les repasses de répétition espacée dues aujourd'hui pour
    // ce voterKey (cf. DAILY_QUIZ_REINFORCEMENT_SLOT) ; toujours requis dans
    // ce cas (pas de session anonyme possible, rien à montrer sans historique).
    const quizDate = resolveDailyQuizRequestDate(slot, req.query.date);
    const voterKey = String(req.query.voterKey || "").trim();
    const questions = await getDailyQuizQuestions(quizDate, slot, voterKey);
    res.json({ date: quizDate, slot, label: getDailyQuizSlotLabel(slot), questions: questions.map(stripQuestionForClient) });
  } catch (error) {
    res.status(500).json({ date: null, questions: [], error: error.message });
  }
});

app.get("/api/daily-quiz/results", async (req, res) => {
  try {
    const voterKey = String(req.query.voterKey || "").trim();
    const slot = String(req.query.slot || "").trim();
    if (!isValidDailyQuizSlot(slot)) return res.status(400).json({ date: null, answers: [], error: "Créneau invalide." });
    const quizDate = resolveDailyQuizRequestDate(slot, req.query.date);
    if (!voterKey) return res.json({ date: quizDate, answers: [] });

    const questionsForSlot = await getDailyQuizQuestions(quizDate, slot, voterKey);
    const questionsById = new Map(questionsForSlot.map((q) => [q.id, q]));
    if (!questionsById.size) return res.json({ date: quizDate, answers: [] });

    const { data: answerRows, error: answersError } = await supabase
      .from("daily_quiz_answers")
      .select("question_id, option_index")
      .eq("quiz_date", quizDate)
      .eq("voter_key", voterKey)
      .in("question_id", [...questionsById.keys()]);
    if (answersError) throw new Error(answersError.message);

    const answers = [];
    for (const row of answerRows || []) {
      const question = questionsById.get(row.question_id);
      if (!question) continue;
      const { stats, total } = await getDailyQuizStats(quizDate, row.question_id);
      answers.push({
        questionId: row.question_id,
        optionIndex: row.option_index,
        correct: row.option_index === question.correctIndex,
        correctIndex: question.correctIndex,
        explanation: question.explanation,
        stats,
        totalAnswers: total,
        // Réveil de la vraie réponse pour la reprise de session (l'utilisateur
        // a déjà répondu à cette question) — cf. POST /answer, même règle.
        ...((question.type || "qcm") === "association" ? { pairs: question.pairs } : {}),
        ...((question.type || "qcm") === "qcm_multi" ? { correctIndexes: question.correctIndexes } : {}),
        ...((question.type || "qcm") === "ordre" ? { items: question.items } : {})
      });
    }
    res.json({ date: quizDate, answers });
  } catch (error) {
    res.status(500).json({ date: null, answers: [], error: error.message });
  }
});

const NOTION_QUIZ_SOURCE_TYPES = new Set(["histoire", "debat-notion", ...CULTURE_GENERALE_ECLAIRAGES_TYPES]);

// Clic sur "Mémoriser" (Éclairages ou Ce jour dans l'Histoire) : crée un QCM
// indépendant et nommé sur cette seule notion, ou rejoint celui déjà généré
// par un autre visiteur (contenu partagé, cf. buildNotionQuestions) — jamais
// un deuxième appel IA pour la même notion le même jour. `item` est l'objet
// brut de la notion, déjà en mémoire côté client au moment du clic.
app.post("/api/users/notion-quizzes", rateLimit("users", 30), async (req, res) => {
  try {
    const validation = validateLegacyKey(req.body?.legacyKey);
    if (validation.error) return res.status(400).json({ ok: false, error: validation.error });

    const sourceType = String(req.body?.sourceType || "").trim();
    const sourceDebateId = String(req.body?.sourceDebateId || "").trim();
    const item = req.body?.item;
    // let (pas const) : réajusté à la date réelle de la ligne existante si la
    // recherche par slot ci-dessous en retrouve une (cf. ce commentaire).
    let quizDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.quizDate || "").trim())
      ? String(req.body.quizDate).trim()
      : parisDateKey();
    if (!NOTION_QUIZ_SOURCE_TYPES.has(sourceType) || !sourceDebateId || sourceDebateId.length > 200 || !item || typeof item !== "object") {
      return res.status(400).json({ ok: false, error: "Requête invalide." });
    }
    // Niveau absent (cf. views/eclairages.html, qui ne propose pas ce choix) :
    // slot inchangé depuis avant l'introduction des niveaux, pour ne pas
    // invalider le cache déjà en base ni les acquisitions déjà enregistrées.
    const { level } = resolveNotionQuizLevel(req.body?.level);
    const slot = `notion:${sourceType}:${sourceDebateId}${level ? `:${level}` : ""}`;

    const { user } = await resolveLegacyUser(supabase, validation.legacyKey);

    let questions;
    // Recherche par slot SEUL, sans filtrer sur quizDate (même règle que
    // POST /api/users/notion-quizzes/custom, cf. son commentaire) : le
    // client (views/eclairages.html memorizeNotion) n'envoie jamais de
    // quizDate, qui retombait donc sur aujourd'hui — un visiteur mémorisant
    // une notion déjà mémorisée par un AUTRE visiteur un jour antérieur ne
    // retrouvait jamais la ligne existante (recherche exacte sur (quiz_date,
    // slot)) et déclenchait une régénération IA complète, avec une
    // formulation différente et donc un jeu de MemoryItems totalement
    // déconnecté de l'historique déjà accumulé sur cette même notion —
    // trouvaille de l'audit du 16/08/2026 (aucune occurrence encore observée
    // en base au moment du correctif, mais un chemin de code réellement
    // atteignable). `quizDate` réajusté sur la ligne trouvée quand elle
    // existe, pour que le lien user_notion_quizzes pointe vers la bonne date.
    const { data: existingQuizRows, error: existingQuizError } = await supabase
      .from("daily_quiz")
      .select("quiz_date, questions")
      .eq("slot", slot)
      .order("quiz_date", { ascending: false })
      .limit(1);
    if (existingQuizError) throw new Error(existingQuizError.message);
    const existingQuiz = existingQuizRows?.[0] || null;

    if (existingQuiz) {
      questions = existingQuiz.questions || [];
      quizDate = existingQuiz.quiz_date;
    } else {
      questions = await buildNotionQuestions(sourceType, sourceDebateId, item, level, user.id);
      if (!questions.length) return res.status(502).json({ ok: false, error: "Génération du QCM impossible pour le moment." });

      const { error: insertError } = await supabase.from("daily_quiz").insert({
        quiz_date: quizDate,
        slot,
        questions,
        source_debate_ids: []
      });
      if (insertError) {
        // Course avec un autre visiteur ayant cliqué "Mémoriser" sur la même
        // notion entre-temps : on relit sa génération plutôt que la nôtre.
        if (insertError.code === "23505") {
          const { data: raceRow, error: raceError } = await supabase
            .from("daily_quiz").select("questions").eq("quiz_date", quizDate).eq("slot", slot).maybeSingle();
          if (raceError) throw new Error(raceError.message);
          questions = raceRow?.questions || questions;
        } else {
          throw new Error(insertError.message);
        }
      }
    }

    const { error: linkError } = await supabase
      .from("user_notion_quizzes")
      .upsert(
        { user_id: user.id, quiz_date: quizDate, slot },
        { onConflict: "user_id,quiz_date,slot", ignoreDuplicates: true }
      );
    if (linkError) throw new Error(linkError.message);

    res.json({ ok: true, slot, quizDate, label: questions[0]?.sourceName || null, questionCount: questions.length });
  } catch (error) {
    console.error("[notion-quizzes] création :", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Barre de recherche libre de "Mes apprentissages" (/apprentissage) : génère
// à la demande une fiche + un QCM sur un sujet tapé librement par le
// visiteur, plutôt qu'une notion déjà préparée par Éclairages/Ce jour dans
// l'Histoire (cf. buildCustomTopicQuiz). Même principe de contenu partagé
// que POST /api/users/notion-quizzes : le slot dérive d'une clé normalisée
// du sujet (normalizeCustomTopicKey) puisqu'aucun id stable n'existe côté
// client pour un sujet libre.
app.post("/api/users/notion-quizzes/custom", rateLimit("users", 30), async (req, res) => {
  try {
    const validation = validateLegacyKey(req.body?.legacyKey);
    if (validation.error) return res.status(400).json({ ok: false, error: validation.error });

    const topic = String(req.body?.topic || "").trim().replace(/\s+/g, " ");
    if (topic.length < 3 || topic.length > 150) {
      return res.status(400).json({ ok: false, error: "Sujet invalide (3 à 150 caractères)." });
    }
    let quizDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.quizDate || "").trim())
      ? String(req.body.quizDate).trim()
      : parisDateKey();

    const id = normalizeCustomTopicKey(topic);
    const { level } = resolveNotionQuizLevel(req.body?.level);
    const slot = `notion:custom:${id}${level ? `:${level}` : ""}`;

    const { user } = await resolveLegacyUser(supabase, validation.legacyKey);

    let questions;
    let reused = false;
    // Slot effectivement utilisé pour le rattachement utilisateur et la
    // réponse — égal à `slot` sauf en cas de réutilisation niveau 2 (cf.
    // plus bas), où on pointe alors vers le slot déjà existant plutôt que
    // celui, jamais inséré, dérivé de la formulation de CETTE recherche.
    let effectiveSlot = slot;
    // Le slot porte à la fois la clé normalisée du sujet ET le niveau choisi
    // (donc sa plage de nombre de questions). La recherche doit couvrir tout
    // l'historique : auparavant elle était limitée à `quizDate`, si bien que
    // le même sujet au même niveau était inutilement régénéré dès le
    // lendemain. Une seule ligne suffit et limite fortement l'egress JSONB.
    const { data: existingQuizRows, error: existingQuizError } = await supabase
      .from("daily_quiz")
      .select("quiz_date, questions")
      .eq("slot", slot)
      .order("quiz_date", { ascending: false })
      .limit(1);
    if (existingQuizError) throw new Error(existingQuizError.message);
    const existingQuiz = existingQuizRows?.[0] || null;

    if (existingQuiz) {
      questions = existingQuiz.questions || [];
      // On redonne exactement le QCM existant : même niveau et donc
      // exactement le même nombre de questions, sans aucun appel à l'IA.
      quizDate = existingQuiz.quiz_date;
      reused = true;
    } else {
      // Niveau 2 (dedup locale sans IA, audit du 24/08/2026, cf.
      // lib/topic-dedup.js) : le slot exact n'existe pas, mais un sujet déjà
      // généré au même niveau peut être une reformulation manifestement
      // équivalente (articles, pluriel, tournure interrogative...). Le gate
      // mots structurants + quasi-inclusion des tokens ne matche jamais deux
      // intentions pédagogiques différentes ; en cas de doute, pas de match
      // — on régénère normalement plutôt que de risquer de servir le
      // mauvais QCM (cf. principe de sécurité du chantier).
      const equivalent = await findEquivalentGeneratedCustomTopic(topic, level);
      if (equivalent) {
        questions = equivalent.questions || [];
        quizDate = equivalent.quizDate;
        effectiveSlot = equivalent.slot;
        reused = true;
      } else {
        const result = await buildCustomTopicQuiz(topic, id, level, user.id);
        if (result.error) {
          const status = result.error === "rejected" ? 422 : 502;
          return res.status(status).json({ ok: false, error: result.reason || "Génération de la fiche impossible pour le moment." });
        }
        // searchTopic : l'intitulé exact tapé par le créateur dans la barre de
        // recherche, distinct de sourceName (repris/reformulé par l'IA, cf.
        // buildLeveledFicheAndQuizPrompt) — affiché sous le titre dans
        // "Explorer les apprentissages disponibles" (demande du 13/08/2026),
        // pas de colonne dédiée sur daily_quiz : porté par chaque question,
        // même principe que sourceName/sourceType déjà dupliqués ainsi.
        questions = result.questions.map((q) => ({ ...q, searchTopic: topic }));

        const { error: insertError } = await supabase.from("daily_quiz").insert({
          quiz_date: quizDate,
          slot,
          questions,
          source_debate_ids: []
        });
        if (insertError) {
          // Course avec un autre visiteur ayant tapé le même sujet entre-temps
          // (cf. POST /api/users/notion-quizzes, même règle) : on relit sa
          // génération plutôt que la nôtre.
          if (insertError.code === "23505") {
            const { data: raceRow, error: raceError } = await supabase
              .from("daily_quiz").select("questions").eq("quiz_date", quizDate).eq("slot", slot).maybeSingle();
            if (raceError) throw new Error(raceError.message);
            questions = raceRow?.questions || questions;
          } else {
            throw new Error(insertError.message);
          }
        }
      }
    }

    const { error: linkError } = await supabase
      .from("user_notion_quizzes")
      .upsert(
        { user_id: user.id, quiz_date: quizDate, slot: effectiveSlot },
        { onConflict: "user_id,quiz_date,slot", ignoreDuplicates: true }
      );
    if (linkError) throw new Error(linkError.message);

    res.json({ ok: true, slot: effectiveSlot, quizDate, label: questions[0]?.sourceName || null, questionCount: questions.length, reused });
  } catch (error) {
    console.error("[notion-quizzes] création (recherche libre) :", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Bouton "Explorer les apprentissages disponibles" (demande du 13/08/2026) :
// liste les sujets libres déjà générés par d'autres visiteurs (slot
// "notion:custom:*" uniquement — les QCM Éclairages/Ce jour dans l'Histoire
// sont déjà automatiquement partagés via leur propre slot par notion, aucun
// doublon possible pour eux). But : éviter qu'un visiteur relance une
// génération IA (POST /custom ci-dessus) pour un sujet qu'un autre a déjà
// couvert avec un intitulé légèrement différent (normalizeCustomTopicKey ne
// dédoublonne que les intitulés strictement équivalents une fois normalisés).
// Volume actuel très faible (quelques dizaines de sujets libres au 13/08/2026)
// : agrégation en mémoire, jamais de pagination nécessaire pour l'instant —
// à revoir si le volume grossit significativement (cf. [[project_supabase_1000_rows]]).
app.get("/api/users/notion-quizzes/explore", rateLimit("users", 30), async (req, res) => {
  try {
    // Nombre de questions affiché à côté du sujet (demande du 13/08/2026) :
    // nécessite désormais de relire tout le tableau JSONB questions (PostgREST
    // n'expose pas jsonb_array_length() en select=), pas seulement le libellé
    // de la première comme avant (cf. audit egress du 12-13/08/2026) — accepté
    // vu le volume actuel très faible (quelques dizaines de sujets libres),
    // à revoir si ce nombre grossit significativement.
    const { data: quizRows, error: quizError } = await supabase
      .from("daily_quiz")
      .select("quiz_date, slot, questions")
      .like("slot", "notion:custom:%");
    if (quizError) throw new Error(quizError.message);

    const { data: linkRows, error: linkError } = await supabase
      .from("user_notion_quizzes")
      .select("slot")
      .like("slot", "notion:custom:%");
    if (linkError) throw new Error(linkError.message);

    const userCountBySlot = new Map();
    for (const row of linkRows || []) {
      userCountBySlot.set(row.slot, (userCountBySlot.get(row.slot) || 0) + 1);
    }

    // Un même sujet normalisé (slot) peut avoir plusieurs lignes daily_quiz
    // (régénéré à des dates différentes, le slot ne porte pas la date) : on
    // n'affiche que la plus récente par slot, mais le compteur de popularité
    // ci-dessus reste toutes dates confondues pour ce même slot.
    const bySlot = new Map();
    for (const row of quizRows || []) {
      const label = row.questions?.[0]?.sourceName;
      if (!label) continue;
      const existing = bySlot.get(row.slot);
      if (!existing || row.quiz_date > existing.quiz_date) bySlot.set(row.slot, { ...row, label });
    }

    const searchQuery = String(req.query.search || "").trim().toLowerCase();
    let items = Array.from(bySlot.values()).map((row) => ({
      slot: row.slot,
      quizDate: row.quiz_date,
      label: row.label,
      // Absent sur les sujets créés avant l'ajout de searchTopic (13/08/2026,
      // cf. POST /custom) : null plutôt qu'une chaîne vide, le client n'affiche
      // alors rien plutôt qu'une ligne identique au titre juste au-dessus.
      searchTopic: row.questions?.[0]?.searchTopic || null,
      questionCount: Array.isArray(row.questions) ? row.questions.length : 0,
      userCount: userCountBySlot.get(row.slot) || 0
    }));
    if (searchQuery) items = items.filter((item) => item.label.toLowerCase().includes(searchQuery));
    items.sort((a, b) => b.userCount - a.userCount || a.label.localeCompare(b.label));

    res.json({ ok: true, items });
  } catch (error) {
    console.error("[notion-quizzes] exploration :", error.message);
    res.status(500).json({ ok: false, items: [], error: error.message });
  }
});

// Clic sur un QCM existant dans "Explorer les apprentissages disponibles" :
// rattache le QCM déjà généré (daily_quiz) à la liste personnelle du
// visiteur, sans jamais rappeler l'IA — seul le nom "custom" (jamais un
// sujet Éclairages/Histoire, déjà accessibles par leur propre flux) est
// autorisé ici, à la fois par cohérence avec l'explorateur et comme
// garde-fou contre un slot arbitraire.
app.post("/api/users/notion-quizzes/adopt", rateLimit("users", 30), async (req, res) => {
  try {
    const validation = validateLegacyKey(req.body?.legacyKey);
    if (validation.error) return res.status(400).json({ ok: false, error: validation.error });

    const slot = String(req.body?.slot || "").trim();
    const quizDate = String(req.body?.quizDate || "").trim();
    if (!slot.startsWith("notion:custom:") || !/^\d{4}-\d{2}-\d{2}$/.test(quizDate)) {
      return res.status(400).json({ ok: false, error: "Requête invalide." });
    }

    const { data: existingQuiz, error: existingQuizError } = await supabase
      .from("daily_quiz")
      .select("questions")
      .eq("quiz_date", quizDate)
      .eq("slot", slot)
      .maybeSingle();
    if (existingQuizError) throw new Error(existingQuizError.message);
    if (!existingQuiz) return res.status(404).json({ ok: false, error: "Ce QCM n'existe plus." });

    const { user } = await resolveLegacyUser(supabase, validation.legacyKey);

    const { error: linkError } = await supabase
      .from("user_notion_quizzes")
      .upsert(
        { user_id: user.id, quiz_date: quizDate, slot },
        { onConflict: "user_id,quiz_date,slot", ignoreDuplicates: true }
      );
    if (linkError) throw new Error(linkError.message);

    const questions = existingQuiz.questions || [];
    res.json({ ok: true, slot, quizDate, label: questions[0]?.sourceName || null, questionCount: questions.length });
  } catch (error) {
    console.error("[notion-quizzes] adoption :", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Déclic sur "Mémoriser" : retire uniquement la ligne de la liste
// personnelle, jamais le QCM partagé (daily_quiz) — recliquer plus tard sur
// la même notion le même jour ne régénère donc rien.
app.post("/api/users/notion-quizzes/remove", rateLimit("users", 30), async (req, res) => {
  try {
    const validation = validateLegacyKey(req.body?.legacyKey);
    if (validation.error) return res.status(400).json({ ok: false, error: validation.error });
    const quizDate = String(req.body?.quizDate || "").trim();
    const slot = String(req.body?.slot || "").trim();
    if (!quizDate || !slot) return res.status(400).json({ ok: false, error: "Requête invalide." });

    const { user } = await resolveLegacyUser(supabase, validation.legacyKey);
    const { error } = await supabase
      .from("user_notion_quizzes")
      .delete()
      .eq("user_id", user.id)
      .eq("quiz_date", quizDate)
      .eq("slot", slot);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (error) {
    console.error("[notion-quizzes] suppression :", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Thématique unique affichée dans "Mes apprentissages". Les QCM récents
// portent déjà sourcePlacement.category, choix principal qui pilote aussi la
// galaxie de "Ma mémoire". Pour les anciens contenus sans sourcePlacement,
// la première sourceThemes reste le meilleur ordre de pertinence disponible.
function getPrimaryNotionQuizTheme(question) {
  const placementCategory = String(question?.sourcePlacement?.category || "").trim();
  if (placementCategory) return placementCategory;
  const legacyThemes = Array.isArray(question?.sourceThemes) ? question.sourceThemes : [];
  return String(legacyThemes.find((theme) => String(theme || "").trim()) || "").trim() || null;
}

// Suivi léger des générations lancées depuis « Mémoriser ». /apprentissage interroge seulement
// les quelques slots encore attendus ; la liste complète (potentiellement volumineuse) n'est
// rechargée qu'une fois lorsqu'un slot devient prêt.
app.get("/api/users/notion-quizzes/generation-status", rateLimit("users", 60), async (req, res) => {
  try {
    const validation = validateLegacyKey(req.query?.legacyKey);
    if (validation.error) return res.status(400).json({ ready: [], error: validation.error });
    const slots = [...new Set(String(req.query?.slots || "")
      .split(",")
      .map((slot) => slot.trim())
      .filter((slot) => slot.startsWith("notion:") && slot.length <= 500))]
      .slice(0, 20);
    if (!slots.length) return res.json({ ready: [] });

    const { data: user, error: userError } = await supabase
      .from("users").select("id").eq("legacy_key", validation.legacyKey).maybeSingle();
    if (userError) throw new Error(userError.message);
    if (!user) return res.json({ ready: [] });

    const { data: rows, error: rowsError } = await supabase
      .from("user_notion_quizzes")
      .select("slot,quiz_date")
      .eq("user_id", user.id)
      .in("slot", slots);
    if (rowsError) throw new Error(rowsError.message);
    res.json({ ready: (rows || []).map((row) => ({ slot: row.slot, quizDate: row.quiz_date })) });
  } catch (error) {
    console.error("[notion-quizzes] suivi génération :", error.message);
    res.status(500).json({ ready: [], error: "Suivi momentanément indisponible." });
  }
});

// Liste "Mes QCM" (onglet par défaut de /qcm-du-jour) : les notions que ce
// visiteur a choisi de mémoriser, les plus récentes en premier. Lecture
// seule, jamais d'upsert (même esprit que les autres routes GET /api/users/*).
app.get("/api/users/notion-quizzes", rateLimit("users", 30), async (req, res) => {
  try {
    const validation = validateLegacyKey(req.query?.legacyKey);
    if (validation.error) return res.status(400).json({ error: validation.error });

    const { data: userRow, error: userError } = await supabase
      .from("users").select("id").eq("legacy_key", validation.legacyKey).maybeSingle();
    if (userError) throw new Error(userError.message);
    if (!userRow) return res.json({ quizzes: [] });

    const { data: links, error: linksError } = await supabase
      .from("user_notion_quizzes")
      .select("quiz_date, slot, added_at")
      .eq("user_id", userRow.id)
      .order("added_at", { ascending: false });
    if (linksError) throw new Error(linksError.message);
    if (!links || !links.length) return res.json({ quizzes: [] });

    const quizDates = [...new Set(links.map((l) => l.quiz_date))];
    const slots = [...new Set(links.map((l) => l.slot))];
    const { data: quizRows, error: quizRowsError } = await supabase
      .from("daily_quiz")
      .select("quiz_date, slot, questions")
      .in("quiz_date", quizDates)
      .in("slot", slots);
    if (quizRowsError) throw new Error(quizRowsError.message);
    const questionsByKey = new Map((quizRows || []).map((row) => [`${row.quiz_date}:${row.slot}`, row.questions || []]));

    // Progression par sujet : AGRÉGATION DÉRIVÉE de l'état FSRS de chacune de
    // ses questions (memory_item_fsrs_states, cf. lib/spaced-repetition/),
    // jamais l'inverse — ce calcul ne réinjecte rien dans le scheduler
    // (invariant D de la refonte FSRS, 13-16/08/2026). Chaque question compte
    // pour sa rétrivabilité actuelle (computeRetrievability, courbe d'oubli
    // FSRS basée sur stability + temps écoulé depuis la dernière review — 0
    // si jamais répondue) ; le "% d'ancrage" affiché est la moyenne sur
    // toutes les questions de la notion. Remplace l'ancien crédit fixe par
    // état (0.5 Learning/Relearning, 1 Review, demande du 17/08/2026) qui ne
    // tenait pas compte de l'oubli progressif d'une carte en retard de
    // repasse, et avant lui l'ancien streak-de-4 par question
    // (computeQuestionStreaks), qui ne reflétait plus le rythme réel des
    // repasses une fois celui-ci piloté par due_at plutôt que par des
    // paliers fixes.
    const { data: fsrsStates, error: fsrsStatesError } = await supabase
      .from("memory_item_fsrs_states")
      .select("state, stability, last_review_at, memory_items(slot, quiz_date, question_id)")
      .eq("user_id", userRow.id);
    if (fsrsStatesError) throw new Error(fsrsStatesError.message);
    const stateByQuestionKey = new Map();
    for (const row of fsrsStates || []) {
      const mi = row.memory_items;
      if (!mi) continue;
      stateByQuestionKey.set(`${mi.quiz_date}:${mi.slot}:${mi.question_id}`, row);
    }
    const retrievabilityNow = new Date();

    const quizzes = [];
    for (const link of links) {
      const questions = questionsByKey.get(`${link.quiz_date}:${link.slot}`);
      if (!questions || !questions.length) continue; // contenu introuvable (générateur en échec, cas limite) : jamais affiché
      let creditSum = 0;
      let answeredCount = 0;
      for (const q of questions) {
        const row = stateByQuestionKey.get(`${link.quiz_date}:${link.slot}:${q.id}`);
        if (!row) continue;
        creditSum += computeRetrievability(
          { state: row.state, stability: row.stability, lastReviewAt: row.last_review_at },
          retrievabilityNow
        );
        answeredCount += 1;
      }
      const progressPct = Math.round((creditSum / questions.length) * 100);
      const primaryTheme = getPrimaryNotionQuizTheme(questions[0]);
      quizzes.push({
        slot: link.slot,
        quizDate: link.quiz_date,
        label: questions[0]?.sourceName || null,
        sourceType: questions[0]?.sourceType || null,
        // Une connaissance ne doit apparaître que dans sa rubrique la plus
        // pertinente, y compris pour les anciens QCM stockés avec plusieurs
        // sourceThemes.
        themes: primaryTheme ? [primaryTheme] : [],
        questionCount: questions.length,
        answeredCount,
        // "Réalisé" seulement une fois TOUTES les questions répondues au moins
        // une fois (juste ou fausse) — pas dès la première réponse (demande du
        // 17/08/2026) : un QCM commencé puis abandonné en route doit rester
        // visible et repris depuis "Mes apprentissages en cours" (Découvrir),
        // pas disparaître prématurément dans "Mes acquis".
        realized: answeredCount >= questions.length,
        inProgress: answeredCount > 0 && answeredCount < questions.length,
        progressPct,
        validated: progressPct >= 100
      });
    }
    res.json({ quizzes });
  } catch (error) {
    console.error("[notion-quizzes] liste :", error.message);
    res.status(500).json({ quizzes: [], error: error.message });
  }
});

// Fiche d'une notion mémorisée (cf. "Mes QCM", qcm-du-jour.html) : le détail
// pur du concept/événement (sourceDetail, même contenu que "Mes acquis") suivi
// du corrigé complet des questions du QCM — jamais filtré par ce que ce
// visiteur précis a déjà répondu (demande du 09/08/2026 : la fiche sert de
// support de révision, pas de suivi de progression). Contenu partagé entre
// tous les visiteurs (lecture directe de daily_quiz, comme getDailyQuizQuestions)
// : pas de legacyKey nécessaire ici.
app.get("/api/users/notion-quizzes/fiche", rateLimit("users", 60), async (req, res) => {
  try {
    const slot = String(req.query.slot || "").trim();
    const quizDate = String(req.query.date || "").trim();
    // Navigation depuis "Les liens" d'une autre fiche (cf. findAndStoreCultureGeneraleNotionLink) :
    // la notion ciblée peut avoir été générée à une autre date/niveau que la fiche source, donc
    // retrouvée par son identité (linkType/linkSourceId) plutôt que par (slot, date).
    const linkType = String(req.query.linkType || "").trim();
    const linkSourceId = String(req.query.linkSourceId || "").trim();

    let questions;
    let resolvedSlot = slot;
    let resolvedQuizDate = quizDate;
    if (linkType && linkSourceId) {
      const { data: rows, error } = await supabase
        .from("daily_quiz").select("quiz_date, slot, questions")
        .ilike("slot", "notion:%").order("quiz_date", { ascending: false }).limit(2000);
      if (error) throw new Error(error.message);
      const match = (rows || []).find((row) => {
        const q = row.questions?.[0];
        return q?.sourceType === linkType && String(q?.sourceDebateId) === linkSourceId;
      });
      if (!match) return res.status(404).json({ error: "QCM introuvable." });
      questions = match.questions || [];
      resolvedSlot = match.slot;
      resolvedQuizDate = match.quiz_date;
    } else {
      if (!slot.startsWith("notion:") || !/^\d{4}-\d{2}-\d{2}$/.test(quizDate)) {
        return res.status(400).json({ error: "Requête invalide." });
      }
      const { data, error } = await supabase
        .from("daily_quiz").select("questions").eq("quiz_date", quizDate).eq("slot", slot).maybeSingle();
      if (error) throw new Error(error.message);
      questions = data?.questions || [];
    }
    if (!questions.length) return res.status(404).json({ error: "QCM introuvable." });

    const first = questions[0];
    let linkOwnerUserId = null;
    const linkKeyValidation = validateLegacyKey(req.query?.legacyKey);
    if (!linkKeyValidation.error) {
      const { data: linkOwner, error: linkOwnerError } = await supabase
        .from("users")
        .select("id")
        .eq("legacy_key", linkKeyValidation.legacyKey)
        .maybeSingle();
      if (linkOwnerError) console.warn("[notion-quizzes] propriétaire des liens introuvable :", linkOwnerError.message);
      linkOwnerUserId = linkOwner?.id || null;
    }
    const links = first.sourceType && first.sourceDebateId
      ? await fetchCultureGeneraleNotionLinks(first.sourceType, String(first.sourceDebateId), linkOwnerUserId)
      : [];
    const primaryTheme = getPrimaryNotionQuizTheme(first);
    res.json({
      slot: resolvedSlot,
      quizDate: resolvedQuizDate,
      // Un import photo garde sourceName = fait individuel pour que chaque
      // apprentissage reste identifiable, mais sa fiche ouvre le titre du
      // document global partagé par toutes les connaissances de l'import.
      label: ["photo_import", "manual_import", "pdf_import", "text_import", "url_import", "youtube_import"].includes(first.sourceType) && first.sourceDetail?.documentTitle
        ? first.sourceDetail.documentTitle
        : (first.sourceName || null),
      sourceType: first.sourceType || null,
      themes: primaryTheme ? [primaryTheme] : [],
      sourceDetail: first.sourceDetail || null,
      links,
      questions: questions.map((q) => {
        const type = q.type || "qcm";
        const base = { id: q.id, type, question: q.question, explanation: q.explanation || "" };
        if (type === "association") return { ...base, pairs: q.pairs || [] };
        if (type === "qcm_multi") return { ...base, options: q.options || [], correctIndexes: q.correctIndexes || [] };
        if (type === "ordre") return { ...base, items: q.items || [] };
        return { ...base, options: q.options || [], correctIndex: q.correctIndex };
      })
    });
  } catch (error) {
    console.error("[notion-quizzes] fiche :", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── "À apprendre ensuite" (mission du 26/08/2026) ───────────────────────────
// Moteur de recommandation pédagogique personnalisé — cf. lib/learn-next/
// pour tout l'algorithme (ZPD, connexions, ponts entre branches, intérêt,
// découverte contrôlée) et data/migration-learn-next-engine.sql pour le
// schéma. AUCUN appel IA sur ce chemin : le classement est entièrement local
// (SQL borné au graphe propre à l'utilisateur + calcul déterministe Node).
// L'unique enrichissement IA existant (détection de liens entre
// connaissances, cf. findAndStoreCultureGeneraleNotionLink plus haut) reste
// mutualisé au niveau global, jamais relancé ici.

// Même pattern Map()+TTL que le reste du fichier (cf. debatesApiResponseCache) :
// une clé par (legacyKey, debug on/off) puisque le mode debug ajoute des
// champs jamais mis en cache en production.
const learnNextRecommendationsCache = new Map();
function getCachedLearnNextRecommendations(cacheKey) {
  const entry = learnNextRecommendationsCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) { learnNextRecommendationsCache.delete(cacheKey); return null; }
  return entry.value;
}
function setCachedLearnNextRecommendations(cacheKey, value) {
  _cacheSet(
    learnNextRecommendationsCache,
    cacheKey,
    { value, expiresAt: Date.now() + learnNextConfig.RECOMMENDATIONS_CACHE_TTL_MS },
    learnNextConfig.RECOMMENDATIONS_CACHE_MAX
  );
}
// Invalidation CIBLÉE (jamais globale, section 16 du plan) : appelée juste
// après qu'UN utilisateur acquiert une connaissance (cf.
// recordDailyQuizEclairageAcquisition) ou ajoute une recommandation à sa
// mémoire (cf. POST .../events ci-dessous) — les autres caches utilisateur
// ne sont jamais touchés.
function invalidateLearnNextRecommendations(legacyKey) {
  learnNextRecommendationsCache.delete(`${legacyKey}:prod`);
}

// Upsert best-effort du cache mutualisé knowledge_nodes (section 12) : un
// échec ici ne doit JAMAIS faire échouer l'écriture principale qui l'a
// déclenché (acquisition, création d'un lien) — même garantie que les autres
// écritures dérivées de ces chemins (ex. activation Solar dans
// recordDailyQuizEclairageAcquisition).
async function bestEffortUpsertKnowledgeNode(params) {
  try {
    await learnNextRepository.upsertKnowledgeNode(
      supabase,
      learnNextScoring.computeImportanceScore,
      learnNextScoring.computeImportanceTier,
      learnNextConfig,
      params
    );
  } catch (error) {
    console.warn("[learn-next] upsert knowledge_nodes échoué :", error.message);
  }
}

app.get("/api/users/recommendations/learn-next", rateLimit("users", 30), async (req, res) => {
  try {
    const validation = validateLegacyKey(req.query?.legacyKey);
    if (validation.error) return res.status(400).json({ error: validation.error });

    // Observabilité (section 21) : uniquement hors production, jamais envoyé
    // au client en prod, jamais mis en cache (les scores intermédiaires
    // n'ont pas vocation à rester figés 20 minutes).
    const debug = process.env.NODE_ENV !== "production" && req.query?.debug === "1";
    const cacheKey = `${validation.legacyKey}:${debug ? "debug" : "prod"}`;
    if (!debug) {
      const cached = getCachedLearnNextRecommendations(cacheKey);
      if (cached) return res.json(cached);
    }

    const { user } = await resolveLegacyUser(supabase, validation.legacyKey);
    const limit = Math.min(
      learnNextConfig.MAX_RECOMMENDATION_LIMIT,
      Math.max(1, parseInt(req.query?.limit, 10) || learnNextConfig.DEFAULT_RECOMMENDATION_LIMIT)
    );

    const result = await computeLearnNextRecommendations(
      { supabase, fetchAllSupabaseRowsIn, computeRetrievability },
      { userId: user.id, limit, debug }
    );

    const payload = { recommendations: result.recommendations, coldStart: result.coldStart };
    if (!debug) setCachedLearnNextRecommendations(cacheKey, payload);

    // Tracking "shown" (section 17) : best-effort, jamais bloquant pour la
    // réponse — un échec d'écriture ne doit jamais faire attendre ni
    // échouer l'affichage des recommandations elles-mêmes. Volume maîtrisé
    // (revue du 27/08/2026, section 11) : jamais en mode debug (introspection
    // dev, ne doit pas polluer les données de tracking) et jamais sur un HIT
    // de cache (return anticipé plus haut) — le TTL de 20 min du cache
    // borne donc déjà à au plus un batch "shown" par utilisateur et par
    // fenêtre, plutôt qu'à chaque rerender frontend/rechargement de page.
    if (!debug && result.recommendations.length) {
      supabase.from("recommendation_events").insert(result.recommendations.map((r) => ({
        user_id: user.id,
        subject_type: r.subjectType,
        subject_source_id: r.subjectSourceId,
        solar_system_id: r.solarSystemId,
        event_type: "shown",
        recommendation_type: r.recommendationType,
        score: r.score
      }))).then(({ error }) => {
        if (error) console.warn("[learn-next] tracking shown échoué :", error.message);
      });
    }

    res.json(payload);
  } catch (error) {
    console.error("[learn-next] recommandations :", error.message);
    res.status(500).json({ recommendations: [], error: "Erreur calcul des recommandations." });
  }
});

// Tracking minimal des interactions (section 17) : "shown" est déjà loggé
// automatiquement par la route GET ci-dessus — ici uniquement les
// événements que seul le client peut connaître (ouverture d'une fiche,
// ajout à la mémoire, rejet explicite).
app.post("/api/users/recommendations/learn-next/events", rateLimit("users", 60), async (req, res) => {
  try {
    const validation = validateLegacyKey(req.body?.legacyKey);
    if (validation.error) return res.status(400).json({ error: validation.error });
    const rawEvents = Array.isArray(req.body?.events) ? req.body.events : [];
    if (!rawEvents.length) return res.json({ ok: true });

    const { user } = await resolveLegacyUser(supabase, validation.legacyKey);
    const allowedTypes = new Set(["opened", "added", "dismissed"]);
    const rows = [];
    for (const raw of rawEvents.slice(0, 20)) {
      const eventType = String(raw?.eventType || "").trim();
      const subjectType = String(raw?.subjectType || "").trim();
      const subjectSourceId = String(raw?.subjectSourceId || "").trim();
      if (!allowedTypes.has(eventType) || !subjectType || !subjectSourceId) continue;
      rows.push({
        user_id: user.id,
        subject_type: subjectType,
        subject_source_id: subjectSourceId,
        solar_system_id: Number.isInteger(raw?.solarSystemId) ? raw.solarSystemId : null,
        event_type: eventType,
        recommendation_type: raw?.recommendationType ? String(raw.recommendationType).slice(0, 30) : null,
        score: Number.isFinite(Number(raw?.score)) ? Number(raw.score) : null
      });
    }
    if (!rows.length) return res.json({ ok: true });

    const { error } = await supabase.from("recommendation_events").insert(rows);
    if (error) throw new Error(error.message);

    // "added" = l'utilisateur a choisi de mémoriser cette recommandation :
    // le prochain calcul doit cesser de la re-proposer (invalidation
    // ciblée à CET utilisateur uniquement).
    if (rows.some((r) => r.event_type === "added")) invalidateLearnNextRecommendations(validation.legacyKey);

    res.json({ ok: true });
  } catch (error) {
    console.error("[learn-next] events :", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Intégration Noès (mission du 26/08/2026, finalisée le 27/08/2026) ──────
// Vidéo avatar : Noès pose une question, marque une pause, donne la réponse
// — jusqu'à 5 connaissances par vidéo. Toute la logique métier (cache
// script, batching, hash, dédup vidéo, soumission RunPod, finalisation) vit
// désormais dans lib/coeus/noes-orchestrator.js — testable sans serveur HTTP
// ni dépendances réelles, cf. test/noes-orchestrator.test.js. Cette section
// ne fait plus que la couche HTTP : légitimité de la requête (ownership,
// périmètre V1), rate limit, forme de la réponse.
//
// Point fondamental : le script oral est généré à partir de
// question.knowledgeTarget (jamais la question QCM elle-même), en UN SEUL
// appel IA par fiche, mis en cache dans noes_scripts (cf.
// lib/coeus/noes-script.js). Périmètre V1 : uniquement les fiches
// "recherche IA" (sourceType "custom") — le reste de l'architecture (slot
// générique, natural_key comme knowledge_id, batching par position) reste
// indépendant de la source, prêt pour les autres imports plus tard.
const NOES_CONFIG = {
  pipelineVersion: process.env.NOES_PIPELINE_VERSION || "coeus-items-v1",
  // Valeurs fixées par le worker lui-même (cf. coeus-serverless/handler.py :
  // KOKORO_VOICE="ff_siwis", COEUS_STAGING_AVATAR=coeusfemme2) — recopiées ici
  // UNIQUEMENT pour entrer dans video_hash, jamais envoyées au worker comme
  // paramètres (submitCoeusItemsVideo ne transmet ni voix ni avatar).
  voice: "kokoro:ff_siwis",
  avatar: "coeusfemme2",
  thinkingPauseSeconds: Math.min(10, Math.max(0.5, Number(process.env.NOES_THINKING_PAUSE_SECONDS) || 3)),
  itemGapSeconds: Math.min(5, Math.max(0, Number(process.env.NOES_ITEM_GAP_SECONDS) || 0.6)),
  maxVideosPerDay: Number(process.env.NOES_MAX_VIDEOS_PER_DAY) || 4,
  jobTimeoutMs: 5 * 60 * 1000,
  // Stockage isolé dans lib/coeus/noes-storage.js (demande du 27/08/2026) :
  // seul ce module connaît "où" vit le MP4 final — bucket existant
  // (SUPABASE_DEBATE_MEDIA_BUCKET) réutilisé pour cette première intégration,
  // remplaçable plus tard sans toucher à l'orchestrateur.
  storageBucket: SUPABASE_DEBATE_MEDIA_BUCKET,
  storageCacheControl: DEBATE_MEDIA_CACHE_CONTROL
};

// RUNPOD_NOES_ENDPOINT_ID (finalisation du 27/08/2026) : endpoint RunPod
// DÉDIÉ à Noès ("coeus kokoro staging", seul déploiement à comprendre
// `mode: "items"`, cf. commit 632be017f438a2eea31f782e76516000fd7df94d de
// coeus-serverless), volontairement distinct de RUNPOD_COEUS_ENDPOINT_ID
// (l'endpoint historique utilisé par lib/coeus/coeus-service.js pour le
// mode audio/text à un seul clip, cf. scripts/test-coeus-real.js) —
// détourner cette dernière variable aurait fait pointer les anciens usages
// Coeus vers un endpoint de staging, ou Noès vers un endpoint qui ne
// comprend pas `items`. AUCUN repli silencieux sur RUNPOD_COEUS_ENDPOINT_ID
// si RUNPOD_NOES_ENDPOINT_ID est absente : ce dernier endpoint échouerait de
// façon confuse (input.mode must be audio or text) plutôt que d'échouer
// clairement sur une configuration manquante.
//
// Construit paresseusement (jamais au chargement du module) : un
// environnement sans RUNPOD_API_KEY/RUNPOD_NOES_ENDPOINT_ID configurés (dev
// local, par ex.) ne doit jamais empêcher le serveur de démarrer, seulement
// faire échouer proprement les routes Noès avec un message clair.
let _noesRunpodClients = null;
function getNoesRunpodClients() {
  if (_noesRunpodClients) return _noesRunpodClients;
  // Vérification explicite plutôt que de laisser createCoeusRunpodClient
  // faire `options.endpointId ?? process.env.RUNPOD_COEUS_ENDPOINT_ID` : ce
  // repli interne au client existe pour son usage historique (coeus-
  // service.js, un seul endpoint) et retomberait silencieusement sur
  // l'ancien endpoint si RUNPOD_NOES_ENDPOINT_ID venait à manquer — exactement
  // le repli qu'on veut exclure pour Noès (cf. commentaire au-dessus).
  if (!String(process.env.RUNPOD_NOES_ENDPOINT_ID || "").trim()) {
    console.error("[noes] configuration RunPod/volume manquante : RUNPOD_NOES_ENDPOINT_ID est absente.");
    return null;
  }
  try {
    _noesRunpodClients = {
      runpodClient: createCoeusRunpodClient({ endpointId: process.env.RUNPOD_NOES_ENDPOINT_ID }),
      volumeClient: createCoeusVolumeClient()
    };
  } catch (error) {
    console.error("[noes] configuration RunPod/volume manquante :", error.message);
    return null;
  }
  return _noesRunpodClients;
}

// Une seule soumission RunPod en vol par video_hash À LA FOIS DANS CE
// PROCESS (même pattern que debatesApiInFlight/_cloudBubblesRefreshPromiseByKey,
// cf. server.js plus haut) : une deuxième requête simultanée sur le même
// contenu attend la même promesse plutôt que de tenter sa propre soumission.
// claimPendingNoesVideoForSubmission (lib/coeus/noes-repository.js) protège
// en plus le cas multi-instance, que ce Map ne couvre pas.
const _noesVideoSubmissionInFlight = new Map();

const noesDeps = {
  supabase,
  callOpenAI: (messages, opts) => _callOpenAI(process.env.OPENAI_API_KEY, messages, opts),
  getRunpodClients: getNoesRunpodClients,
  inFlightMap: _noesVideoSubmissionInFlight,
  config: NOES_CONFIG
};

// POST /api/noes/videos : soumet (ou retrouve en cache) la vidéo Noès d'un
// lot de connaissances. RÉPOND IMMÉDIATEMENT après confirmation RunPod que
// le job est accepté (quelques secondes) — ne tient JAMAIS la route ouverte
// pendant tout le rendu (30 à 120s), cf. rapport d'audit section 3/12.
app.post("/api/noes/videos", rateLimit("noes", 20), async (req, res) => {
  try {
    const validation = validateLegacyKey(req.body?.legacyKey);
    if (validation.error) return res.status(400).json({ ok: false, error: validation.error });

    const slot = String(req.body?.slot || "").trim();
    const quizDate = String(req.body?.quizDate || "").trim();
    const batchIndex = Number(req.body?.batchIndex);
    if (!slot.startsWith("notion:custom:") || !/^\d{4}-\d{2}-\d{2}$/.test(quizDate) || !Number.isInteger(batchIndex) || batchIndex < 0) {
      return res.status(400).json({ ok: false, error: "Requête invalide." });
    }

    const { user } = await resolveLegacyUser(supabase, validation.legacyKey);

    // Sécurité (cf. rapport d'audit section 8) : Noès ne génère que pour une
    // fiche que l'utilisateur a réellement choisie de mémoriser, jamais un
    // slot arbitraire fourni par le client.
    const { data: ownership, error: ownershipError } = await supabase
      .from("user_notion_quizzes")
      .select("slot")
      .eq("user_id", user.id)
      .eq("slot", slot)
      .eq("quiz_date", quizDate)
      .maybeSingle();
    if (ownershipError) throw new Error(ownershipError.message);
    if (!ownership) return res.status(403).json({ ok: false, error: "Cette fiche n'est pas dans vos apprentissages." });

    const { data: quizRow, error: quizError } = await supabase
      .from("daily_quiz").select("questions").eq("slot", slot).eq("quiz_date", quizDate).maybeSingle();
    if (quizError) throw new Error(quizError.message);
    const questions = quizRow?.questions || [];
    if (!questions.length) return res.status(404).json({ ok: false, error: "QCM introuvable." });
    // Périmètre V1 (cf. rapport d'audit, "Périmètre V1") : uniquement les
    // fiches issues de la recherche IA.
    if (questions[0]?.sourceType !== "custom") {
      return res.status(422).json({ ok: false, error: "Noès n'est pas encore disponible pour cette source de connaissance." });
    }
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ ok: false, error: "OPENAI_API_KEY manquant." });

    const video = await requestNoesVideo(noesDeps, { userId: user.id, slot, quizDate, batchIndex, questions });

    res.json({
      ok: true,
      videoId: video.id,
      status: video.status,
      outputUrl: video.status === "ready" ? video.output_path : null
    });
  } catch (error) {
    if (error instanceof NoesRequestError) {
      return res.status(error.status).json({ ok: false, error: error.message });
    }
    console.error("[noes] soumission vidéo :", error.message);
    res.status(500).json({ ok: false, error: "Erreur lors de la préparation de la vidéo Noès." });
  }
});

// GET /api/noes/videos/:id/status : consultation idempotente — c'est CETTE
// route (appelée en polling par le client, cf. views/qcm-du-jour.html) qui
// déclenche la finalisation dès que RunPod signale COMPLETED, jamais la
// route POST ci-dessus. Fonctionne même si l'utilisateur a fermé l'onglet
// entre-temps : un autre appel (ou le sweeper) finalise à sa place — cf.
// rapport d'audit section 9, "finalisation indépendante du navigateur".
app.get("/api/noes/videos/:id/status", rateLimit("noes-status", 60), async (req, res) => {
  try {
    let video = await noesRepository.getNoesVideoById(supabase, req.params.id);
    if (!video) return res.status(404).json({ ok: false, error: "Vidéo introuvable." });

    if (video.status === "processing") {
      video = await pollAndFinalizeNoesVideo(noesDeps, video);
    }

    res.json({
      ok: true,
      status: video.status,
      outputUrl: video.status === "ready" ? video.output_path : null,
      errorStage: video.status === "failed" ? video.error_stage : null
    });
  } catch (error) {
    console.error("[noes] statut vidéo :", error.message);
    res.status(500).json({ ok: false, error: "Erreur lors de la lecture du statut Noès." });
  }
});

// Réconciliation (cf. rapport d'audit section 9) : jobs restés "processing"
// au-delà du timeout attendu — crash serveur, redeploy en cours de job,
// utilisateur jamais revenu consulter /status. Même garde
// isRenderScopedTaskEnabled que le scheduler d'analyse IA plus haut, mais
// claimNoesVideoForFinalization protège de toute façon contre un doublon si
// plusieurs instances tournaient malgré tout.
if (isRenderScopedTaskEnabled("NOES_SWEEPER_ENABLED")) {
  setInterval(async () => {
    try {
      const stale = await noesRepository.findStaleProcessingNoesVideos(supabase, NOES_CONFIG.jobTimeoutMs);
      for (const row of stale) {
        await pollAndFinalizeNoesVideo(noesDeps, row);
      }
    } catch (error) {
      console.error("[noes sweeper]", error.message);
    }
  }, 2 * 60 * 1000).unref();
}

// isAssociationAnswerFullyCorrect/isQcmMultiAnswerFullyCorrect/
// isOrderAnswerFullyCorrect vivent désormais dans lib/question-formats.js
// (cf. import en haut du fichier) — correction tout-ou-rien, pas de score
// partiel, cohérent avec les autres formats.

// Résolution du système solaire d'un contenu Culture Générale : vérifie d'abord si
// la notion correspond à un système déjà existant dans cette galaxie (ex. "Résilience"
// reformulé différemment un autre jour), même quand le nom n'est pas identique mot pour mot
// (resolveOrCreateSolarSystem seul ne fait qu'une comparaison exacte normalisée), avant d'en
// créer un nouveau. Produit aussi un nom court (tag, 2-4 mots) plutôt que de tronquer
// aveuglément la phrase descriptive complète de l'Éclairage (sourceName peut être une phrase
// entière, ex. "La campagne de désinformation soviétique pendant la Guerre froide").
// Filet si la clé IA est absente ou l'appel échoue : comportement d'origine (exact-match
// normalisé via resolveOrCreateSolarSystem seul, jamais bloquant pour l'acquisition).
// extractCultureGeneraleItemDetail renvoie un objet ({meta, sections, image}), jamais une
// chaîne : String(sourceDetail) produirait "[object Object]" (bug confirmé le 06/08/2026,
// eclairage_detail enregistré cassé) — aplati ici en texte brut pour le prompt IA ci-dessous
// ET pour l'enregistrement de eclairage_detail (cf. recordDailyQuizEclairageAcquisition).
function flattenCultureGeneraleDetail(detail) {
  if (!detail || typeof detail !== "object" || !Array.isArray(detail.sections)) return "";
  return detail.sections
    .map((s) => (s?.label ? `${s.label} : ${s.text || ""}` : String(s?.text || "")))
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" — ");
}

// Certains contenus font épuiser tout le budget de tokens à un modèle gpt-5 en
// raisonnement caché avant même de produire le JSON de réponse (finish_reason
// "length", contenu vide) — constaté en pratique le 12/08/2026 sur "Historiens
// français du XXIe siècle" avec un budget de 1200, jamais classée du coup.
// Utilisé par les quatre étapes de classification IA de "Ma mémoire"/"Mes
// apprentissages" (catégorie, système solaire, étoile, thématiques) : dans les
// quatre cas, une connaissance doit TOUJOURS finir classée — le coût d'un ou
// deux appels IA supplémentaires est négligeable face à un classement manqué
// (demande du 12/08/2026). Redouble le budget à chaque tentative plutôt que
// d'abandonner après la première réponse vide.
// feature (audit du 22/08/2026, phase 1) : contrairement à _callOpenAI, CHAQUE
// tentative de cette boucle est une requête réellement facturée par OpenAI —
// y compris quand elle revient vide (cf. commentaire ci-dessus : le budget de
// raisonnement peut être épuisé avant la moindre sortie JSON). Chaque
// tentative est donc instrumentée individuellement (1 requête API = 1 log),
// et pas seulement l'issue finale de la fonction.
async function fetchGpt5JsonContentWithRetry(apiKey, model, prompt, logPrefix, { reasoningEffort = "low", initialBudget = 1200, feature = null } = {}) {
  let budget = initialBudget;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const startedAt = Date.now();
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: budget,
        reasoning_effort: reasoningEffort
      })
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      recordAiUsage(supabase, { feature, model, latencyMs: Date.now() - startedAt, success: false, error: body || `openai http ${r.status}` });
      throw new Error(`openai http ${r.status}`);
    }
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content;
    const { inputTokens, outputTokens, cachedTokens } = extractUsage(data?.usage);
    recordAiUsage(supabase, { feature, model, inputTokens, outputTokens, cachedTokens, latencyMs: Date.now() - startedAt, success: true });
    if (content) return content;
    console.warn(`${logPrefix} réponse IA vide (tentative ${attempt}/4, budget=${budget}) : finish_reason=${data?.choices?.[0]?.finish_reason}`);
    budget *= 2;
  }
  return "";
}

// getOpinionArticleCategoryForGalaxy/fetchCultureGeneraleHierarchyForClassification
// (arbre cross-utilisateurs envoyé au classifieur) supprimées le 16/08/2026 :
// exactement le mécanisme qui laissait un Solar créé par un autre utilisateur
// influencer la classification d'un nouveau contenu (diagnostic "Atlas
// Mnoria", §1/§2 — jamais la taxonomie d'un autre utilisateur). Remplacées
// par fetchUserActiveKnowledgeSolars(userId), scopée à l'utilisateur courant.

// ── Galaxies de connaissance (refonte du 16/08/2026, diagnostic "Atlas Mnoria") ──
// Catalogue INDÉPENDANT de OPINION_ARTICLE_CATEGORY_OPTIONS (qui reste dédié
// aux articles d'actualité, jamais touché ici) : les deux pipelines
// partagent le stockage (solar_systems/stars, cf. taxonomy_scope) mais plus
// le vocabulaire de classification. Volontairement peu nombreuses et très
// larges (§3/§19 du plan : une Galaxy doit pouvoir accueillir de nombreux
// Solars) — la création d'une nouvelle Galaxy n'est pas implémentée dans
// cette refonte (jugée "encore plus rare" que celle d'un Solar, cf. §19) :
// le classifieur choisit toujours parmi cette liste fixe.
//
// Chaque description encode explicitement la frontière qui a fait échouer
// l'ancien système sur le cas "dieux romains" (religion/mythologie antique
// comme FAIT HISTORIQUE vs. sa REPRÉSENTATION ARTISTIQUE) — cf. §14 du plan,
// "le mot ne suffit pas, ce qui compte est ce que la Star enseigne".
// Noms de Galaxy VOLONTAIREMENT identiques à ceux déjà utilisés (les 3
// galaxies déjà réellement classées par le QCM : Histoire/Arts/Politique) ou
// déjà pré-créés côté solars de départ (CULTURE_GENERALE_SEED_SOLAR_SYSTEMS
// ci-dessous, ex. "Sciences - technologie", "Société - éducation") — jamais
// une simplification cosmétique de ces libellés, qui aurait fait pointer ce
// nouveau moteur vers une galaxy différente de celle déjà semée en base et
// dupliqué inutilement les solars existants au prochain redémarrage.
//
// Liste complète des 20 valeurs de galaxy que l'ANCIEN mécanisme (dérivation
// depuis OPINION_ARTICLE_CATEGORY_OPTIONS + OPINION_ARTICLE_GALAXY_BY_PRECISION)
// pouvait théoriquement atteindre pour une connaissance — restaurée en entier
// ici après un premier passage qui n'en gardait que 10 (constaté à la
// vérification finale du 16/08/2026, "ne réduis aucune Galaxy silencieusement") :
// retirer un domaine (Sport, Santé, Climat, Médias...) sans le dire aurait
// forcé toute future connaissance de ce domaine dans une Galaxy voisine
// inadaptée. Aucune de ces 10 galaxies restaurées n'a de Solar de départ
// pré-semé (comme Arts/Politique déjà en usage réel) : la première
// connaissance qui les atteint déclenche simplement une création normale.
const KNOWLEDGE_GALAXY_DEFINITIONS = [
  { name: "Histoire", description: "Faits, événements, sociétés, États, civilisations, religions et croyances DU PASSÉ étudiés comme connaissance historique (qui, quand, quel contexte) — une religion ou une mythologie ancienne appartient ici en tant que fait de civilisation, même si elle a aussi une dimension religieuse ou artistique." },
  { name: "Arts", description: "La représentation esthétique ou artistique d'un sujet (peinture, sculpture, musique, littérature, cinéma, architecture) — ex. la façon dont une religion ou une mythologie ancienne est représentée DANS L'ART appartient ici, jamais la religion/mythologie elle-même comme fait historique." },
  { name: "Sciences - technologie", description: "Concepts, découvertes, mécanismes et méthodes des sciences exactes et naturelles : mathématiques, physique, chimie, biologie, sciences de la Terre, astronomie, informatique, ingénierie, énergie." },
  { name: "Philosophie", description: "Concepts, courants de pensée, questionnements et raisonnements philosophiques (éthique, épistémologie, logique, métaphysique) — la pensée en tant que telle, pas un fait qu'elle décrit." },
  { name: "Sciences sociales", description: "Sociologie, psychologie sociale, anthropologie — l'étude des comportements et structures sociales comme discipline, distincte de la philosophie (raisonnement) et de la société contemporaine (faits)." },
  { name: "Société - éducation", description: "École, enseignement, famille, démographie, immigration, religions et croyances CONTEMPORAINES, discriminations, genre — le pendant contemporain de ce que \"Histoire\" couvre pour le passé." },
  { name: "Économie - emploi", description: "Mécanismes économiques, monnaie, emploi, entreprises, finances publiques, commerce, immobilier." },
  { name: "Politique", description: "Institutions politiques, pouvoirs, régimes, partis, relations internationales contemporaines." },
  { name: "International", description: "Régions, pays et zones géographiques du monde et leurs caractéristiques propres (géographie, culture locale)." },
  { name: "Justice - faits divers", description: "Système judiciaire, droit, criminalité, enquêtes policières, procédures." },
  { name: "Climat - environnement", description: "Climat, écosystèmes, ressources naturelles, biodiversité, enjeux environnementaux." },
  { name: "Culture", description: "Pratiques et objets culturels (traditions, gastronomie, mode, patrimoine) — hors œuvres d'art à proprement parler (cf. Arts) et hors faits historiques (cf. Histoire)." },
  { name: "Sport", description: "Disciplines sportives, compétitions, records — le sport comme pratique et comme discipline." },
  { name: "Loisirs", description: "Activités de loisir et de divertissement pratiquées (jeux, activités de plein air...) — hors productions médiatiques (cf. Médias - divertissements)." },
  { name: "Langues", description: "Langues, grammaire, étymologie, linguistique." },
  { name: "Lettres", description: "Littérature, œuvres écrites, auteurs et courants littéraires." },
  { name: "Médias - divertissements", description: "Cinéma, télévision, musique, jeux vidéo, presse — productions et industries culturelles diffusées, pas la pratique elle-même (cf. Loisirs)." },
  { name: "Santé - bien-être", description: "Corps humain, médecine, maladies, bien-être physique et mental." },
  { name: "Vie personnelle - modes de vie", description: "Habitudes de vie quotidienne, consommation, relations, choix personnels contemporains." },
  { name: "Espace jeunes", description: "Contenus destinés spécifiquement à un jeune public." }
];

function findKnowledgeGalaxyDefinition(name) {
  const clean = String(name || "").trim();
  return KNOWLEDGE_GALAXY_DEFINITIONS.find((g) => g.name === clean) || null;
}

// Solars de connaissance déjà actifs pour CET utilisateur uniquement (jamais
// tous les solars de la table, cf. lib/knowledge-taxonomy/taxonomy-engine.js
// filterUserActiveSolars/userActiveGalaxies — c'est le périmètre décisionnel
// du moteur, §1/§2 du plan). `user_solar_activations` définit cet univers ;
// solar_systems reste le catalogue canonique partagé (option "catalogue +
// membership" retenue en design, cf. data/migration-user-solar-activations.sql).
async function fetchUserActiveKnowledgeSolars(userId) {
  if (!userId) return [];
  // "knowledge" ET "both" (correctif point 2 de la vérification du
  // 16/08/2026) : un Solar référencé aussi par le pipeline actu (9 cas réels
  // mesurés) reste un candidat knowledge légitime — le masquer serait une
  // régression, pas une prudence (cf. isKnowledgeCandidate, seule porte
  // d'entrée pour cette décision ; répliquée ici côté requête SQL pour ne
  // filtrer qu'une fois côté serveur plutôt que de rapatrier "unknown"/"news"
  // pour les exclure ensuite en mémoire).
  const { data, error } = await supabase
    .from("user_solar_activations")
    .select("solar_system_id, solar_systems!inner(id, galaxy, name, description, taxonomy_scope)")
    .eq("user_id", userId)
    .in("solar_systems.taxonomy_scope", ["knowledge", "both"]);
  if (error) {
    console.warn("[knowledge taxonomy] lecture univers utilisateur échouée :", error.message);
    return [];
  }
  return (data || []).map((row) => ({
    id: row.solar_systems.id,
    galaxy: row.solar_systems.galaxy,
    name: row.solar_systems.name,
    description: row.solar_systems.description || null,
    taxonomyScope: row.solar_systems.taxonomy_scope
  }));
}

// Solars "de départ" (cf. CULTURE_GENERALE_SEED_SOLAR_SYSTEMS) : un socle
// canonique PARTAGÉ, jamais un espace personnel — contrairement aux Solars
// ad hoc créés à la volée (ceux-là restent strictement scopés à
// fetchUserActiveKnowledgeSolars, jamais visibles d'un autre utilisateur).
// Correctif du 17/08/2026 (cas réel "fête de Vaux-le-Vicomte" classée en
// nouveau Solar "Cérémonies royales anciennes" alors que "Temps modernes"
// existait) : ce socle doit être proposé à TOUT LE MONDE, pas seulement à
// l'utilisateur qui l'a déjà personnellement "activé" par hasard — sinon
// chaque nouvel utilisateur recrée sa propre variante des mêmes périodes
// avant d'être exposé une première fois par coïncidence à la bonne.
// Cache court (60s, même principe que l'ancienne fetchCultureGeneraleHierarchyForClassification) :
// liste petite et identique pour tous, aucune raison de la relire à chaque
// appel.
let _cultureGeneraleSeedSolarsCache = null;
const CULTURE_GENERALE_SEED_SOLARS_CACHE_MS = 60_000;
async function fetchCultureGeneraleSeedSolars() {
  const now = Date.now();
  if (_cultureGeneraleSeedSolarsCache && now - _cultureGeneraleSeedSolarsCache.loadedAt < CULTURE_GENERALE_SEED_SOLARS_CACHE_MS) {
    return _cultureGeneraleSeedSolarsCache.value;
  }
  const seedGalaxies = Object.keys(CULTURE_GENERALE_SEED_SOLAR_SYSTEMS);
  const { data, error } = await supabase
    .from("solar_systems")
    .select("id, galaxy, name, normalized_name, description, taxonomy_scope")
    .in("galaxy", seedGalaxies);
  if (error) {
    console.warn("[knowledge taxonomy] lecture solars de départ échouée :", error.message);
    return _cultureGeneraleSeedSolarsCache?.value || [];
  }
  const seedNormalizedByGalaxy = {};
  for (const [galaxy, names] of Object.entries(CULTURE_GENERALE_SEED_SOLAR_SYSTEMS)) {
    seedNormalizedByGalaxy[galaxy] = new Set(names.map(normalizeSolarSystemName));
  }
  const value = (data || [])
    .filter((s) => isKnowledgeCandidate({ taxonomyScope: s.taxonomy_scope }) && seedNormalizedByGalaxy[s.galaxy]?.has(s.normalized_name))
    .map((s) => ({ id: s.id, galaxy: s.galaxy, name: s.name, description: s.description || null, taxonomyScope: s.taxonomy_scope }));
  _cultureGeneraleSeedSolarsCache = { loadedAt: now, value };
  return value;
}

// Choisit la Galaxy d'une connaissance PARMI KNOWLEDGE_GALAXY_DEFINITIONS
// (jamais une invention libre, cf. §19 : la création de Galaxy n'est pas
// implémentée ici). MATCH pur : un seul appel, jamais de solar/étoile décidé
// à cette étape (séparation match/création, cf. rapport de design §8). Le
// périmètre utilisateur n'a de sens qu'au niveau Solar (§17 : une Galaxy
// canonique peut toujours être "activée" par un nouvel utilisateur, ce n'est
// jamais un espace personnel isolé) — la liste proposée reste donc la liste
// canonique complète, seules les galaxies déjà actives chez cet utilisateur
// sont signalées comme préférables à égalité de pertinence.
// Fusion Galaxy+Solar en UN SEUL appel (correctif du 16/08/2026, vérification
// finale post-implémentation) : l'ancienne paire classifyCultureGeneraleCategoryWithAI
// + resolveCultureGeneraleSolarSystemWithAI coûtait 2 appels IA sur le chemin
// "reuse" (cible : 1 maximum) et 3 sur le chemin "create" (cible : 2). Un seul
// appel MATCH choisit désormais la Galaxy ET, dans la foulée, le Solar
// existant le plus cohérent — la création de Solar reste un second appel
// séparé, déclenché UNIQUEMENT sur no_match (cf. resolveCultureGeneraleSolarSystemWithAI
// plus bas, désormais dédiée à la seule validation de création).
// La création de Galaxy reste hors périmètre (§19 : encore plus rare qu'un
// Solar) — le choix porte toujours sur KNOWLEDGE_GALAXY_DEFINITIONS, jamais
// une Galaxy inventée.
async function matchCultureGeneraleGalaxyAndSolarWithAI(sourceType, sourceName, sourceDetail, userSolars) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const subjectTitle = String(sourceName || "").slice(0, 160);
  const subjectDetail = flattenCultureGeneraleDetail(sourceDetail).slice(0, 400);
  // Candidats = Solars personnels déjà activés par CET utilisateur UNION le
  // socle canonique "de départ" de cette Galaxy (cf. fetchCultureGeneraleSeedSolars,
  // correctif du 17/08/2026 — sans l'union, "Temps modernes" restait invisible
  // tant que l'utilisateur ne l'avait pas lui-même déjà rencontré une
  // première fois). candidatesByGalaxy conserve la liste EXACTE proposée à
  // l'IA pour chaque Galaxy, réutilisée telle quelle à l'étape de parsing
  // plus bas — jamais recalculée séparément, pour ne jamais rejeter un choix
  // IA valide (un Solar de départ) faute de figurer dans un second calcul
  // strictement personnel.
  const seedSolars = await fetchCultureGeneraleSeedSolars();
  const candidatesByGalaxy = new Map();
  const galaxiesPayload = KNOWLEDGE_GALAXY_DEFINITIONS.map((g) => {
    const personalSolars = filterUserActiveSolars(userSolars, userSolars.map((s) => ({ solarSystemId: s.id })), g.name);
    const seedSolarsInGalaxy = seedSolars.filter((s) => s.galaxy === g.name);
    const merged = [];
    const seenIds = new Set();
    for (const s of [...personalSolars, ...seedSolarsInGalaxy]) {
      if (seenIds.has(s.id)) continue;
      seenIds.add(s.id);
      merged.push(s);
    }
    candidatesByGalaxy.set(g.name, merged);
    return {
      name: g.name,
      description: g.description,
      existingSolars: merged.map((s) => ({ id: s.id, name: s.name, description: s.description || null }))
    };
  });

  // starLabel : fusionne la proposition d'Étoile dans ce même appel (§3 de la
  // vérification finale du 16/08/2026, cible 0/1/2 appels IA au total) — le
  // serveur décidera ENSUITE, déterministement, si ce libellé correspond à
  // une étoile déjà connue de cet utilisateur (cf. matchExistingStarByLabel)
  // ou doit être créée telle quelle. Les règles de qualité (large, durable,
  // jamais une redite du Solar) sont conservées de l'ancien
  // resolveCultureGeneraleStarWithAI ; seule la comparaison à l'existant
  // change de méthode (déterministe plutôt qu'un jugement IA sur la liste
  // complète des étoiles, qui romprait la scalabilité prouvée au point 8 de
  // la vérification précédente — jusqu'à 10 000 étoiles chez un même
  // utilisateur, jamais envoyées ici).
  const domainGalaxyNames = Object.keys(CULTURE_GENERALE_DOMAIN_GALAXIES).join(", ");
  const prompt = [
    "Réponds uniquement en json valide.",
    "Cette connaissance de culture générale doit être classée selon ce qu'elle ENSEIGNE RÉELLEMENT — jamais un simple mot-clé isolé. Lis bien la description de chaque Galaxy : certaines précisent explicitement une frontière à respecter (ex. un fait religieux/historique ancien vs. sa représentation artistique).",
    "Étape 1 : choisis la Galaxy la plus pertinente parmi \"galaxies\" (recopie \"name\" EXACTEMENT comme fourni, sans le modifier). Cas particulier : si le sujet ou son détail montrent clairement qu'il s'agit d'un contenu conçu POUR un jeune public (conte pour enfants, dessin animé ou personnage jeunesse, vie scolaire d'un enfant/collégien/lycéen, sujet explicitement adressé/expliqué aux enfants ou aux ados...), choisis la Galaxy \"Espace jeunes\" plutôt qu'une Galaxy thématique concurrente (Histoire, Société - éducation, Médias - divertissements...), même si le sujet recoupe aussi cette dernière — le public visé prime alors sur le thème.",
    "Étape 2 : DANS cette Galaxy uniquement, cherche si l'un de ses \"existingSolars\" est raisonnablement cohérent avec cette connaissance — même s'il est plus large ou moins précis qu'un intitulé idéal. La cohérence de la taxonomie prime sur la précision maximale du libellé : un Solar plus précis n'est jamais une raison de préférer no_match si un Solar existant convient déjà.",
    `Étape 3 : propose dans "starLabel" le nom d'une "Étoile" — une sous-catégorie précise mais RÉUTILISABLE pour plusieurs contenus, jamais le fait atomique de cette seule connaissance (2 à 4 mots, jamais une phrase). Si la Galaxy choisie fait partie de [${domainGalaxyNames}], l'Étoile doit rester une sous-catégorie encore assez large du Solar (imagine dix autres contenus différents rattachés au même Solar : ton Étoile doit convenir à plusieurs d'entre eux, pas seulement à celui-ci) ; pour les autres Galaxies, l'Étoile peut être la notion précise elle-même. Dans tous les cas, l'Étoile ne doit JAMAIS reprendre les mots du Solar lui-même (ex. sous \"Révolution française & Empire\", \"Révolution française\" est interdit — \"Directoire\" ou \"Terreur\" conviennent).`,
    "Si un Solar existant convient : {\"decision\":\"existing\",\"galaxy\":\"...\",\"solarId\":123,\"confidence\":0.8,\"starLabel\":\"...\"}.",
    "Si et seulement si AUCUN \"existingSolars\" de la Galaxy choisie ne convient (ou si elle n'en a encore aucun) : {\"decision\":\"no_match\",\"galaxy\":\"...\",\"bestExistingSolarId\":123 ou null,\"confidence\":0.2,\"starLabel\":\"...\"} — tu ne peux JAMAIS créer de Solar toi-même dans cette réponse, seulement signaler qu'aucun n'est cohérent (starLabel reste utile, il sera réexaminé une fois le Solar créé).",
    "",
    JSON.stringify({ type: sourceType, title: subjectTitle, detail: subjectDetail, galaxies: galaxiesPayload })
  ].join("\n");

  try {
    // Log de comptage (Phase 5 / observabilité, 16-17/08/2026) : aucun log
    // n'existait avant sur le chemin succès, seulement sur échec — impossible
    // de vérifier depuis les logs serveur qu'un appel a bien eu lieu et
    // combien. Un log par appel réel, jamais par tentative de parsing.
    console.log(`[ia-call] galaxy+solar match: type=${sourceType} title="${subjectTitle.slice(0, 60)}"`);
    const isGpt5 = /^gpt-5/.test(OPINION_ARTICLE_CATEGORY_MODEL);
    let content;
    if (isGpt5) {
      content = await fetchGpt5JsonContentWithRetry(apiKey, OPINION_ARTICLE_CATEGORY_MODEL, prompt, "[knowledge-taxonomy match]", { reasoningEffort: "medium", initialBudget: 1200, feature: "knowledge_classification" });
    } else {
      const requestStartedAt = Date.now();
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
        body: JSON.stringify({
          model: OPINION_ARTICLE_CATEGORY_MODEL,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          max_tokens: 150,
          temperature: 0
        })
      });
      if (!r.ok) {
        const errBody = await r.text().catch(() => "");
        recordAiUsage(supabase, { feature: "knowledge_classification", model: OPINION_ARTICLE_CATEGORY_MODEL, latencyMs: Date.now() - requestStartedAt, success: false, error: errBody || `openai http ${r.status}` });
        throw new Error(`openai http ${r.status}`);
      }
      const data = await r.json();
      content = data?.choices?.[0]?.message?.content;
      const { inputTokens, outputTokens, cachedTokens } = extractUsage(data?.usage);
      recordAiUsage(supabase, { feature: "knowledge_classification", model: OPINION_ARTICLE_CATEGORY_MODEL, inputTokens, outputTokens, cachedTokens, latencyMs: Date.now() - requestStartedAt, success: true });
    }
    const raw = content ? JSON.parse(content) : null;
    const galaxyDef = findKnowledgeGalaxyDefinition(raw?.galaxy);
    if (!galaxyDef) {
      console.warn("[knowledge-taxonomy match] galaxy IA non reconnue :", raw?.galaxy);
      return null;
    }
    // starLabel est du texte libre proposé par l'IA — jamais consommé tel
    // quel : validé/comparé déterministement par l'appelant (matchExistingStarByLabel
    // / validateStarLabelCandidate), jamais ici.
    const starLabel = typeof raw?.starLabel === "string" ? raw.starLabel.trim().slice(0, 80) : "";
    // Exactement la même liste que celle proposée dans le payload plus haut
    // (personnel + socle de départ) — jamais recalculée en ne gardant que le
    // périmètre personnel, sinon un choix IA valide sur un Solar de départ
    // serait rejeté ici faute de figurer dans un second calcul plus étroit.
    const candidatesInGalaxy = candidatesByGalaxy.get(galaxyDef.name) || [];
    const decision = parseMatchDecision(
      { decision: raw.decision, id: raw.decision === "existing" ? raw.solarId : raw.bestExistingSolarId, confidence: raw.confidence },
      candidatesInGalaxy.map((c) => c.id)
    );
    if (!decision) {
      // Décision malformée (galaxy reconnue mais id hors candidats, etc.) :
      // traité comme no_match plutôt que rejeté en bloc — la Galaxy, elle,
      // reste valide et exploitable par l'appelant.
      return { galaxy: galaxyDef.name, decision: "no_match", candidates: candidatesInGalaxy, starLabel };
    }
    return { galaxy: galaxyDef.name, decision: decision.decision, solarId: decision.id ?? null, candidates: candidatesInGalaxy, starLabel };
  } catch (error) {
    console.warn("[knowledge-taxonomy match] classification IA ignorée :", error.message);
    return null;
  }
}

// ---- Liens entre connaissances (ex. "Voltaire" ↔ "Les Lumières") : détectés
// après la PREMIÈRE bonne réponse, lorsque la connaissance entre réellement
// dans la mémoire. L'IA la compare alors aux autres acquisitions réelles de
// cet utilisateur, jamais aux simples QCM encore en attente dans sa liste.
// Les liens sont stockés à part puis relus entre l'explication et le QCM.

// cultureGeneraleNotionKey/canonicalNotionLinkPair (identité canonique d'une notion et ordre
// stable A/B pour ne jamais stocker deux fois le même lien) vivent désormais dans
// lib/culture-generale-links.js (extrait le 17/08/2026, renforcement des liens) — fonctions
// pures, testées unitairement là-bas (test/culture-generale-links.test.js).
async function resolveOrCreateCultureGeneraleNotionLink(typeA, idA, nameA, typeB, idB, nameB, label) {
  const {
    typeA: type1, idA: id1, nameA: name1,
    typeB: type2, idB: id2, nameB: name2
  } = canonicalNotionLinkPair(typeA, idA, nameA, typeB, idB, nameB);
  // Existence vérifiée AVANT l'upsert (plutôt que de déduire "created" de son
  // résultat, que le client Supabase ne distingue pas d'un conflit ignoré) :
  // sert uniquement à ne pas compter deux fois le même lien dans
  // knowledge_nodes.link_degree quand plusieurs utilisateurs déclenchent
  // indépendamment sa (re)détection (cf. bestEffortUpsertKnowledgeNode plus
  // bas, section 12 — mutualisation, jamais un recalcul par utilisateur).
  const { data: existing, error: existingError } = await supabase
    .from("culture_generale_notion_links")
    .select("id")
    .eq("type_a", type1).eq("source_id_a", id1).eq("type_b", type2).eq("source_id_b", id2)
    .maybeSingle();
  if (existingError) console.warn("[culture-generale notion-links] vérification échouée :", existingError.message);

  const { error } = await supabase.from("culture_generale_notion_links").upsert(
    { type_a: type1, source_id_a: id1, name_a: name1, type_b: type2, source_id_b: id2, name_b: name2, label },
    { onConflict: "type_a,source_id_a,type_b,source_id_b", ignoreDuplicates: true }
  );
  if (error) {
    console.warn("[culture-generale notion-links] création échouée :", error.message);
    return null;
  }
  return { typeA: type1, idA: String(id1), nameA: name1, typeB: type2, idB: String(id2), nameB: name2, label, created: !existing };
}

// Corpus personnel réel : user_article_acquisitions n'est alimentée qu'après
// une bonne réponse. Cette lecture est aussi beaucoup plus légère que
// l'ancienne relecture des tableaux JSONB questions de daily_quiz.
async function fetchUserAcquiredCultureGeneraleNotions(userId) {
  const { data: acquisitionRows, error } = await supabase
    .from("user_article_acquisitions")
    .select("eclairage_type, eclairage_source_id, eclairage_name, eclairage_detail")
    .eq("user_id", userId)
    .not("eclairage_type", "is", null)
    .not("eclairage_source_id", "is", null)
    .limit(2000);
  if (error) {
    console.warn("[culture-generale notion-links] lecture des acquis échouée :", error.message);
    return [];
  }
  const seen = new Set();
  const notions = [];
  for (const row of acquisitionRows || []) {
    const type = String(row.eclairage_type || "").trim();
    const id = String(row.eclairage_source_id || "").trim();
    const name = String(row.eclairage_name || "").trim();
    if (!type || !id || !name) continue;
    const key = cultureGeneraleNotionKey(type, id);
    if (seen.has(key)) continue;
    seen.add(key);
    notions.push({ type, id, name, detail: String(row.eclairage_detail || "").trim() });
  }
  return notions;
}

// Liens dont LES DEUX extrémités appartiennent réellement à l'utilisateur. La table des liens
// est globale (une même relation peut servir à plusieurs personnes) ; la jointure personnelle
// se fait donc ici contre user_article_acquisitions, sur la clé exacte type + source_id.
async function fetchOwnedCultureGeneraleNotionLinks(userId, acquiredNotions = null) {
  const notions = acquiredNotions || await fetchUserAcquiredCultureGeneraleNotions(userId);
  if (!notions.length) return [];
  const notionByKey = new Map(notions.map((notion) => [cultureGeneraleNotionKey(notion.type, notion.id), notion]));
  const sourceIds = [...new Set(notions.map((notion) => notion.id))];
  const columns = "id,type_a,source_id_a,name_a,type_b,source_id_b,name_b,label,created_at";
  const [fromA, fromB] = await Promise.all([
    fetchAllSupabaseRowsIn(sourceIds, (idsChunk) =>
      supabase.from("culture_generale_notion_links").select(columns)
        .in("source_id_a", idsChunk).order("id", { ascending: true })
    ),
    fetchAllSupabaseRowsIn(sourceIds, (idsChunk) =>
      supabase.from("culture_generale_notion_links").select(columns)
        .in("source_id_b", idsChunk).order("id", { ascending: true })
    )
  ]);
  const readError = fromA.error || fromB.error;
  if (readError) {
    console.warn("[culture-generale comprehension] lecture des liens échouée :", readError.message);
    return [];
  }
  const seenIds = new Set();
  const links = [];
  for (const row of [...(fromA.data || []), ...(fromB.data || [])]) {
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    const notionA = notionByKey.get(cultureGeneraleNotionKey(row.type_a, row.source_id_a));
    const notionB = notionByKey.get(cultureGeneraleNotionKey(row.type_b, row.source_id_b));
    if (!notionA || !notionB) continue;
    links.push({
      id: row.id,
      createdAt: row.created_at,
      typeA: row.type_a,
      idA: String(row.source_id_a),
      nameA: row.name_a || notionA.name,
      detailA: notionA.detail,
      typeB: row.type_b,
      idB: String(row.source_id_b),
      nameB: row.name_b || notionB.name,
      detailB: notionB.detail,
      label: row.label
    });
  }
  return links.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || Number(a.id) - Number(b.id));
}

function cultureGeneraleComprehensionPairHash(link) {
  return crypto.createHash("sha1")
    .update(`${cultureGeneraleNotionKey(link.typeA, link.idA)}|${cultureGeneraleNotionKey(link.typeB, link.idB)}`)
    .digest("hex")
    .slice(0, 20);
}

function cultureGeneraleComprehensionQuizSlot(link) {
  return `notion:comprendre:${cultureGeneraleComprehensionPairHash(link)}`;
}

// Un quiz relationnel n'interroge jamais les deux fiches séparément : chaque question doit
// obliger à comprendre le pont causal, conceptuel, chronologique ou illustratif entre elles.
// Le nombre de questions n'est plus calé sur un palier fixe (2/4/6 selon la richesse) : il va
// de 1 à COMPREHENSION_QUIZ_MAX_QUESTIONS, et c'est la richesse RÉELLE du lien — jamais un
// quota — qui doit déterminer combien de questions sont vraiment nécessaires (renforcé le
// 17/08/2026). Une seule question valide suffit à publier le QCM : voir aussi
// assembleComprehensionSession (lib/culture-generale-links.js), qui n'exclut plus les banques
// à une question de la session de révision.
const COMPREHENSION_QUIZ_MAX_QUESTIONS = 4;
async function buildCultureGeneraleComprehensionQuiz(link) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];
  const pairHash = cultureGeneraleComprehensionPairHash(link);
  const detailA = String(link.detailA || "").slice(0, 2200);
  const detailB = String(link.detailB || "").slice(0, 2200);
  const formatBlock = buildQuestionFormatsPromptBlock("sourceId", COMPREHENSION_QUIZ_MAX_QUESTIONS, false, ["intrus", "ordre"]);
  const prompt = [
    "Tu es un pédagogue francophone. Crée un QCM qui vérifie qu'un utilisateur comprend réellement le LIEN entre deux connaissances déjà acquises — jamais deux mini-quiz indépendants.",
    "",
    `Connaissance A — ${link.nameA}`,
    detailA || "Aucun détail supplémentaire disponible.",
    "",
    `Connaissance B — ${link.nameB}`,
    detailB || "Aucun détail supplémentaire disponible.",
    "",
    `Relation détectée : ${link.label || "relation intellectuelle directe"}.`,
    `Produis entre 1 et ${COMPREHENSION_QUIZ_MAX_QUESTIONS} questions — UNIQUEMENT celles réellement nécessaires pour comprendre CE lien précis, jamais pour atteindre un quota. La richesse réelle du lien détermine seule ce nombre : si un seul angle suffit à en vérifier la compréhension, produis UNE SEULE question ; n'en ajoute une deuxième, une troisième... que si elle apporte un élément VRAIMENT distinct et important du pont entre A et B. La suggestion de formats ci-dessous en liste jusqu'à " + COMPREHENSION_QUIZ_MAX_QUESTIONS + ", à titre d'inspiration seulement si tu vas jusque-là — utilise uniquement les premières si tu en produis moins.`,
    "Chaque question doit mobiliser explicitement A ET B, ou demander la nature/la conséquence/le mécanisme du lien entre elles. Sont INTERDITES : une question portant seulement sur A ou seulement sur B ; une question sur une date, un lieu ou une personne secondaire périphérique ; une question de contexte général ou d'anecdote ; une question sur une information présente dans les fiches mais inutile pour comprendre CE lien précis ; une reformulation artificielle d'une question déjà posée sur le même angle.",
    "TEST OBLIGATOIRE avant de conserver chaque question : \"Si cette question était supprimée, perdrait-on une information importante pour comprendre pourquoi ces deux connaissances sont reliées ?\" Si la réponse est NON, ne génère pas cette question — le seul fait qu'il reste des informations disponibles dans les fiches n'est jamais, à lui seul, une justification suffisante.",
    "Les mauvaises réponses doivent représenter des liens plausibles mais faux, afin de vérifier la compréhension du rapprochement et non la simple reconnaissance d'un mot.",
    "L'explication de chaque réponse doit nommer clairement les deux connaissances et expliciter leur relation en une ou deux phrases.",
    `Pour chaque question, sourceId doit valoir exactement "${pairHash}".`,
    "",
    ...formatBlock
  ].join("\n");

  try {
    const content = await _callOpenAI(apiKey, [{ role: "user", content: prompt }], {
      model: DAILY_QUIZ_NARRATIVE_MODEL,
      temperature: 0.35,
      responseFormat: { type: "json_object" },
      feature: "question_generation"
    });
    const parsed = JSON.parse(content);
    const qualityApproved = await qualityControlRawQuestions({
      apiKey,
      rawQuestions: parsed?.questions,
      basePrompt: prompt,
      route: "comprendre",
      context: {
        hasIndependentSource: true,
        isComprehension: true,
        sourceExcerpt: `A: ${detailA}\nB: ${detailB}\nRelation: ${String(link.label || "")}`.slice(0, 4800)
      }
    });
    const validated = validateNarrativeQuizQuestions(qualityApproved, [pairHash], COMPREHENSION_QUIZ_MAX_QUESTIONS, COMPREHENSION_QUIZ_MAX_QUESTIONS);
    if (validated.length < 1) {
      console.warn(`[culture-generale comprehension:${pairHash}] aucune question valide.`);
      return [];
    }
    return validated.slice(0, COMPREHENSION_QUIZ_MAX_QUESTIONS).map((question, index) => ({
      id: `comprendre:${pairHash}-q${index + 1}`,
      ...question,
      sourceType: "comprendre",
      sourceName: `${link.nameA} ↔ ${link.nameB}`,
      comprehensionLabel: link.label || null,
      comprehensionPair: {
        typeA: link.typeA, sourceIdA: link.idA, nameA: link.nameA,
        typeB: link.typeB, sourceIdB: link.idB, nameB: link.nameB
      },
      sourceDebateId: pairHash
    }));
  } catch (error) {
    console.warn(`[culture-generale comprehension:${pairHash}] génération échouée :`, error.message);
    return [];
  }
}

// Banque partagée et persistante par paire. Deux utilisateurs ayant acquis le même lien
// réutilisent le même contenu. La promesse en mémoire évite aussi deux appels IA identiques si
// l'utilisateur ouvre « Comprendre » pendant que la génération lancée juste après sa bonne
// réponse est encore en cours ; la contrainte daily_quiz reste le dernier filet inter-processus.
const _cultureGeneraleComprehensionGenerationPromises = new Map();

async function ensureCultureGeneraleComprehensionQuizPersisted(link, slot) {
  const { data: existingRows, error: existingError } = await supabase
    .from("daily_quiz")
    .select("quiz_date,questions")
    .eq("slot", slot)
    .order("quiz_date", { ascending: false })
    .limit(1);
  if (existingError) {
    console.warn("[culture-generale comprehension] lecture banque échouée :", existingError.message);
    return [];
  }
  if (existingRows?.[0]?.questions?.length) return existingRows[0].questions;

  const questions = await buildCultureGeneraleComprehensionQuiz(link);
  if (questions.length < 1) return [];
  const quizDate = parisDateKey();
  const { error: insertError } = await supabase.from("daily_quiz").insert({
    quiz_date: quizDate,
    slot,
    questions,
    source_debate_ids: []
  });
  if (!insertError) return questions;
  if (insertError.code !== "23505") {
    console.warn("[culture-generale comprehension] écriture banque échouée :", insertError.message);
    return [];
  }
  const { data: raceRow, error: raceError } = await supabase
    .from("daily_quiz").select("questions").eq("quiz_date", quizDate).eq("slot", slot).maybeSingle();
  if (raceError) {
    console.warn("[culture-generale comprehension] relecture banque échouée :", raceError.message);
    return [];
  }
  return raceRow?.questions || questions;
}

async function ensureCultureGeneraleComprehensionQuiz(link) {
  const slot = cultureGeneraleComprehensionQuizSlot(link);
  const pending = _cultureGeneraleComprehensionGenerationPromises.get(slot);
  if (pending) return pending;
  const generation = ensureCultureGeneraleComprehensionQuizPersisted(link, slot);
  _cultureGeneraleComprehensionGenerationPromises.set(slot, generation);
  try {
    return await generation;
  } finally {
    if (_cultureGeneraleComprehensionGenerationPromises.get(slot) === generation) {
      _cultureGeneraleComprehensionGenerationPromises.delete(slot);
    }
  }
}

async function resolveLegacyUserForComprehension(legacyKey) {
  const validation = validateLegacyKey(legacyKey);
  if (validation.error) return null;
  const { data: user, error } = await supabase
    .from("users").select("id").eq("legacy_key", validation.legacyKey).maybeSingle();
  if (error) throw new Error(error.message);
  return user;
}

async function hasCultureGeneraleComprehensionLinks(legacyKey) {
  const user = await resolveLegacyUserForComprehension(legacyKey);
  if (!user) return false;
  const notions = await fetchUserAcquiredCultureGeneraleNotions(user.id);
  const links = await fetchOwnedCultureGeneraleNotionLinks(user.id, notions);
  return links.length > 0;
}

// Parcours « Comprendre » : au plus COMPREHENSION_QUIZ_MAX_QUESTIONS questions par session, en
// tournant chaque jour entre les liens disponibles. Le tri haché est stable pendant toute la
// journée (reprise/réponse toujours sur le même lot), mais varie le lendemain pour ne pas
// privilégier éternellement les premières relations d'un utilisateur très fourni.
async function fetchCultureGeneraleComprehensionQuestions(legacyKey, quizDate) {
  const user = await resolveLegacyUserForComprehension(legacyKey);
  if (!user) return [];
  const notions = await fetchUserAcquiredCultureGeneraleNotions(user.id);
  const links = await fetchOwnedCultureGeneraleNotionLinks(user.id, notions);
  if (!links.length) return [];
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(quizDate || "")) ? String(quizDate) : parisDateKey();
  const selectedLinks = links
    .map((link) => ({
      link,
      rank: crypto.createHash("sha1").update(`${dateKey}:${link.id}`).digest("hex")
    }))
    .sort((a, b) => a.rank.localeCompare(b.rank))
    .slice(0, 6)
    .map((entry) => entry.link);
  // COMPREHENSION_QUIZ_MAX_QUESTIONS relations valides suffisent déjà à fournir autant de
  // questions (au moins une chacune — une banque à une seule question reste pleinement
  // éligible, cf. assembleComprehensionSession ci-dessous, renforcé le 17/08/2026 : un lien fort
  // mais simple ne doit jamais être exclu de la session faute d'atteindre un ancien quota de 2
  // questions). Le pool de liens candidats (slice ci-dessus) reste plus large que ce plafond :
  // certains liens ne contribuant parfois qu'une seule question, il faut pouvoir piocher parmi
  // plusieurs pour le remplir. Procède par petits lots : un utilisateur possédant beaucoup
  // d'anciens liens ne déclenche jamais toutes les générations IA simultanément lors de sa toute
  // première ouverture.
  const banks = [];
  for (let start = 0; start < selectedLinks.length && banks.reduce((sum, bank) => sum + bank.length, 0) < COMPREHENSION_QUIZ_MAX_QUESTIONS; start += 3) {
    const batch = await Promise.all(selectedLinks.slice(start, start + 3).map(ensureCultureGeneraleComprehensionQuiz));
    banks.push(...batch);
  }
  return assembleComprehensionSession(banks, COMPREHENSION_QUIZ_MAX_QUESTIONS);
}

// Recherche jusqu'à trois liens pédagogiquement très pertinents entre la
// nouvelle acquisition et TOUTES les autres connaissances déjà acquises par
// ce visiteur. Un lien doit être à la fois FACTUEL (relation vérifiable) et
// SIGNIFICATIF (il aide vraiment à mieux comprendre l'une des deux
// connaissances grâce à l'autre) — un fait exact mais purement circonstanciel
// (même lieu, même époque, biographie...) ne suffit pas (renforcé le
// 17/08/2026 : cas réel observé "Rome capitale de l'Italie" ↔ "Aldo Moro" via
// "Rome", techniquement vrai mais beaucoup trop générique — Rome pourrait
// relier cette même connaissance à des centaines d'autres notions). Aucun
// lien vague n'est forcé ; 0 ou 1 lien reste le résultat le plus fréquent et
// normal. La sélection mécanique de la réponse IA (parsing/dédoublonnage/
// plafond à 3) vit dans selectValidNotionLinks (lib/culture-generale-links.js)
// — le filtre de pertinence lui-même reste entièrement sémantique, assuré par
// ce prompt, jamais par une heuristique de mots-clés côté serveur (fragile et
// aveugle aux cas légitimes, ex. "Napoléon" ↔ "Waterloo").
async function findAndStoreCultureGeneraleNotionLink(sourceType, sourceId, sourceName, sourceDetail, userId) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !sourceId || !userId) return;

  const selfKey = cultureGeneraleNotionKey(sourceType, sourceId);
  const candidates = (await fetchUserAcquiredCultureGeneraleNotions(userId))
    .filter((c) => cultureGeneraleNotionKey(c.type, c.id) !== selfKey);
  if (!candidates.length) return;

  const compact = {
    title: String(sourceName || "").slice(0, 160),
    detail: flattenCultureGeneraleDetail(sourceDetail).slice(0, 400),
    existing_notions: candidates.map((c) => ({ key: cultureGeneraleNotionKey(c.type, c.id), name: c.name }))
  };
  const prompt = [
    "Réponds uniquement en json valide.",
    "Un nouveau contenu de culture générale vient d'être acquis. Examine TOUTES les connaissances déjà acquises de cet utilisateur, listées dans existing_notions.",
    "Un lien valide doit satisfaire DEUX critères SIMULTANÉMENT :",
    "1. FACTUEL : il relie deux faits précis par une relation concrète et vérifiable — la même personne/œuvre/événement directement impliquée, une cause et sa conséquence directe, un concept illustré par un exemple précis qui en découle vraiment, une chronologie réellement explicative (l'un provoque, précède ou explique directement l'autre). Cette relation doit pouvoir s'expliquer en une phrase factuelle et spécifique, jamais par une généralité.",
    "2. SIGNIFICATIF (critère essentiel, pas seulement décoratif) : ce lien doit permettre de mieux comprendre A grâce à B, ou B grâce à A — pas seulement être vrai. Un fait exact mais purement circonstanciel (même lieu, même époque, même institution, simple élément de biographie) sans apport réel de compréhension doit être REJETÉ même s'il est parfaitement vérifiable.",
    "TEST DE GÉNÉRICITÉ, à appliquer à chaque lien avant de le retenir : si la même relation pourrait tout aussi bien être vraie avec de très nombreuses autres connaissances similaires, le lien est trop générique — REJETTE-le. La relation doit être DISTINCTIVE de cette paire précise, pas transposable telle quelle à des dizaines d'autres paires.",
    "REJETTE explicitement toute relation qui ne repose que sur : même ville, même pays, même région, même époque, même discipline, même catégorie, même environnement culturel, même institution sans lien causal ou événementiel précis, une personnalité qui a simplement vécu, travaillé, étudié, exercé une fonction, est née ou morte dans un lieu, une œuvre simplement conservée ou exposée dans un musée d'une ville, un événement ayant simplement eu lieu au même endroit, une proximité géographique ou biographique, ou un rapprochement thématique général. Ces relations ne redeviennent acceptables QUE si le fait précis constitue un élément vraiment majeur des DEUX connaissances et explique directement leur relation (pas juste un décor commun).",
    "Exemples À REJETER : \"Rome, capitale de l'Italie\" ↔ \"Aldo Moro\" via \"Rome\" — Rome pourrait tout aussi bien relier cette connaissance à des centaines d'autres responsables politiques, papes, artistes ou événements italiens, la relation n'est pas distinctive. \"Piton de la Fournaise\" ↔ \"viticulture à La Réunion\" — simple proximité géographique/terroir. \"Victor Hugo\" ↔ \"Paris, capitale de la France\" si la seule justification est qu'il y a vécu ou travaillé.",
    "Exemples À ACCEPTER : \"Jules César\" ↔ \"Assassinat aux Ides de mars\" (César en est la victime directe). \"Guernica\" ↔ \"Guerre civile espagnole\" (le tableau est directement inspiré du bombardement de Guernica pendant cette guerre). \"Louis XVI\" ↔ \"Révolution française\" (la Révolution entraîne directement la chute de sa monarchie). \"Pasteur\" ↔ \"Vaccination contre la rage\" (ses travaux sont directement à l'origine de ce vaccin).",
    "En cas de doute, ne crée aucun lien plutôt qu'un lien approximatif ou générique : un tableau vide est un résultat NORMAL et FRÉQUENT, pas un échec. Ne cherche JAMAIS à atteindre 3 liens à tout prix — 0 ou 1 lien est parfaitement normal dans la majorité des cas ; un 2e ou 3e lien n'est légitime que s'il est, lui aussi, indépendamment aussi fort que le premier selon ces mêmes critères stricts.",
    "Retourne au maximum 3 liens, uniquement s'ils sont TOUS très pertinents selon ces critères stricts. Pour chacun, recopie exactement le champ key dans related_key et écris un libellé de 2 à 5 mots nommant précisément la relation factuelle (ex. \"Cause directe\", \"Même auteur\", \"Illustre ce concept\") — jamais un libellé thématique vague.",
    "S'il n'existe aucun lien remplissant ces critères, retourne un tableau links vide.",
    "Format obligatoire : {\"links\":[{\"related_key\":\"type::id\",\"label\":\"...\"}]}",
    "",
    JSON.stringify(compact)
  ].join("\n");

  try {
    const content = await fetchGpt5JsonContentWithRetry(apiKey, OPINION_ARTICLE_CATEGORY_MODEL, prompt, "[culture-generale notion-links]", { feature: "knowledge_links" });
    const parsed = content ? JSON.parse(content) : null;
    const candidateByKey = new Map(candidates.map((c) => [cultureGeneraleNotionKey(c.type, c.id), c]));
    const validLinks = selectValidNotionLinks(parsed?.links, candidateByKey, 3);
    await Promise.all(validLinks.map(async ({ match, label }) => {
      const savedLink = await resolveOrCreateCultureGeneraleNotionLink(
        sourceType,
        String(sourceId),
        String(sourceName || "").slice(0, 300),
        match.type,
        match.id,
        match.name,
        label
      );
      if (!savedLink) return;
      const detailByKey = new Map([
        [selfKey, flattenCultureGeneraleDetail(sourceDetail).slice(0, 2200)],
        [cultureGeneraleNotionKey(match.type, match.id), match.detail]
      ]);
      await ensureCultureGeneraleComprehensionQuiz({
        ...savedLink,
        detailA: detailByKey.get(cultureGeneraleNotionKey(savedLink.typeA, savedLink.idA)) || "",
        detailB: detailByKey.get(cultureGeneraleNotionKey(savedLink.typeB, savedLink.idB)) || ""
      });
      // knowledge_nodes (moteur "À apprendre ensuite", section 12) : le
      // degré de connexion global des DEUX extrémités augmente d'exactement
      // 1 pour ce lien — uniquement s'il vient d'être créé (jamais recompté
      // à chaque redétection par un autre utilisateur, cf. `created` ci-dessus).
      if (savedLink.created) {
        await Promise.all([
          bestEffortUpsertKnowledgeNode({ type: savedLink.typeA, sourceId: savedLink.idA, name: savedLink.nameA, incrementLinkDegreeBy: 1 }),
          bestEffortUpsertKnowledgeNode({ type: savedLink.typeB, sourceId: savedLink.idB, name: savedLink.nameB, incrementLinkDegreeBy: 1 })
        ]);
      }
    }));
  } catch (e) {
    console.warn("[culture-generale notion-links] classification IA ignorée :", e.message);
  }
}

// Lit les liens d'une notion pour l'affichage de sa fiche — deux requêtes indexées
// (type_a,source_id_a) et (type_b,source_id_b) plutôt qu'un .or() avec interpolation de
// sourceId dans la chaîne de filtre (risque d'injection PostgREST sur un identifiant qui
// n'est pas systématiquement numérique, ex. hash de sujet libre).
async function fetchCultureGeneraleNotionLinks(sourceType, sourceId, userId = null) {
  const [{ data: asA, error: errA }, { data: asB, error: errB }] = await Promise.all([
    supabase.from("culture_generale_notion_links").select("type_b, source_id_b, name_b, label")
      .eq("type_a", sourceType).eq("source_id_a", sourceId),
    supabase.from("culture_generale_notion_links").select("type_a, source_id_a, name_a, label")
      .eq("type_b", sourceType).eq("source_id_b", sourceId)
  ]);
  if (errA || errB) {
    console.warn("[culture-generale notion-links] lecture échouée :", (errA || errB).message);
    return [];
  }
  const links = [];
  for (const r of asA || []) links.push({ type: r.type_b, sourceId: r.source_id_b, name: r.name_b, label: r.label });
  for (const r of asB || []) links.push({ type: r.type_a, sourceId: r.source_id_a, name: r.name_a, label: r.label });
  if (!userId || !links.length) return [];

  // La table de relations est partagée, mais une fiche personnelle ne doit
  // montrer que les extrémités réellement acquises par cet utilisateur.
  const { data: ownedRows, error: ownedError } = await supabase
    .from("user_article_acquisitions")
    .select("eclairage_type, eclairage_source_id")
    .eq("user_id", userId)
    .not("eclairage_type", "is", null)
    .not("eclairage_source_id", "is", null)
    .limit(2000);
  if (ownedError) {
    console.warn("[culture-generale notion-links] filtrage des acquis échoué :", ownedError.message);
    return [];
  }
  const ownedKeys = new Set((ownedRows || []).map((row) =>
    cultureGeneraleNotionKey(row.eclairage_type, row.eclairage_source_id)
  ));
  return links.filter((link) => ownedKeys.has(cultureGeneraleNotionKey(link.type, link.sourceId)));
}

// Systèmes solaires "de départ" pour certaines galaxies : des sous-domaines
// larges et durables (périodes pour "Histoire", disciplines pour
// "Philosophie"/"Sciences sociales"), préférés par l'IA quand l'un d'eux
// convient — elle reste libre d'en créer un nouveau si aucun ne convient
// vraiment (ex. un concept transversal ne rentrant dans aucune discipline
// listée) : jamais un mauvais rattachement juste pour rester dans une liste
// fermée (demande du 09/08/2026). Pré-créés une fois au démarrage (cf. plus
// bas) pour apparaître dès la première classification dans existing_systems,
// avec ce libellé exact — sans ça, l'IA les réinventerait à chaque fois avec
// une formulation potentiellement différente d'un appel à l'autre.
const CULTURE_GENERALE_SEED_SOLAR_SYSTEMS = {
  "International": [
    "Europe",
    "Maghreb",
    "Afrique de l’Ouest",
    "Afrique centrale",
    "Afrique de l’Est",
    "Afrique australe",
    "Moyen-Orient",
    "Caucase",
    "Asie centrale",
    "Asie du Nord / Sibérie",
    "Asie du Sud",
    "Asie du Sud-Est",
    "Asie de l’Est",
    "Amérique du Nord",
    "Amérique centrale & Caraïbes",
    "Amérique du Sud",
    "Océanie & Pacifique",
    "Régions polaires"
  ],
  "Politique": [
    "Institutions & Constitution",
    "Élections",
    "Partis politiques",
    "Territoires",
    "Idéologies",
    "Démocratie & participation"
  ],
  "Arts": [
    "Arts visuels",
    "Architecture",
    "Musique",
    "Cinéma & audiovisuel",
    "Littérature",
    "Théâtre & arts de la scène",
    "Danse",
    "Design & arts décoratifs",
    "Bande dessinée & illustration",
    "Arts numériques & nouveaux médias",
    "Arts du cirque & performance"
  ],
  "Climat - environnement": [
    "Climat",
    "Biodiversité & écosystèmes",
    "Énergie & transition énergétique",
    "Pollution & déchets",
    "Eau & océans",
    "Forêts, sols & milieux naturels",
    "Agriculture & ressources naturelles",
    "Risques naturels",
    "Villes & transition écologique",
    "Politiques environnementales"
  ],
  "Sport": [
    "Football",
    "Rugby",
    "Basketball",
    "Tennis",
    "Cyclisme",
    "Athlétisme",
    "Natation",
    "Handball",
    "Volleyball",
    "Sports automobiles",
    "Sports de combat",
    "Gymnastique",
    "Sports d’hiver",
    "Sports nautiques",
    "Sports de raquette",
    "Sports équestres",
    "Golf",
    "Cricket",
    "Baseball & softball",
    "Hockey",
    "Sports de glisse",
    "Escalade & alpinisme",
    "Triathlon & sports d’endurance",
    "Escrime",
    "Sports de force",
    "Autres sports"
  ],
  "Langues": [
    "Langues romanes",
    "Langues germaniques",
    "Langues slaves",
    "Langues anciennes",
    "Langues sémitiques",
    "Langues d’Asie de l’Est",
    "Langues d’Asie du Sud",
    "Langues d’Asie centrale & turciques",
    "Langues d’Asie du Sud-Est",
    "Langues africaines",
    "Langues celtiques",
    "Langues régionales & minoritaires",
    "Langues océaniennes"
  ],
  "Loisirs": [
    "Jeux vidéo",
    "Jeux de société & jeux de cartes",
    "Échecs, stratégie & casse-têtes",
    "Lecture",
    "Cinéma, séries & animation",
    "Musique & podcasts",
    "Cuisine & gastronomie",
    "Bricolage & DIY",
    "Jardinage",
    "Collection & modélisme",
    "Photographie",
    "Nature & plein air",
    "Voyages & tourisme",
    "Pêche & activités de nature",
    "Animaux & loisirs animaliers",
    "Astronomie & observation",
    "Technologie & loisirs numériques",
    "Culture geek & pop culture",
    "Parcs, attractions & divertissements",
    "Loisirs créatifs"
  ],
  "Santé - bien-être": [
    "Médecine & maladies",
    "Épidémies & infections",
    "Prévention & santé publique",
    "Nutrition",
    "Activité physique",
    "Sommeil",
    "Santé mentale",
    "Sexualité & reproduction",
    "Addictions",
    "Médicaments & traitements",
    "Urgences & premiers secours",
    "Enfance & vieillissement",
    "Handicap & santé fonctionnelle",
    "Santé environnementale"
  ],
  "Vie personnelle - modes de vie": [
    "Famille & parentalité",
    "Couple & relations",
    "Habitat & maison",
    "Organisation & vie pratique",
    "Finances personnelles",
    "Consommation",
    "Mode & beauté",
    "Alimentation & habitudes",
    "Mobilité & voyages",
    "Travail & équilibre de vie",
    "Développement personnel",
    "Vie numérique",
    "Savoir-vivre & traditions",
    "Animaux de compagnie",
    "Modes de vie & écologie"
  ],
  "Lettres": [
    "Littérature française",
    "Littératures francophones",
    "Littératures étrangères",
    "Littératures antiques",
    "Littérature comparée",
    "Roman & récit",
    "Poésie",
    "Théâtre",
    "Essai & littérature d’idées",
    "Contes, mythes & traditions orales",
    "Biographies, autobiographies & mémoires",
    "Littérature jeunesse",
    "Genres populaires",
    "Histoire & mouvements littéraires",
    "Auteurs & grandes œuvres",
    "Analyse & critique littéraire",
    "Rhétorique & argumentation",
    "Stylistique & figures de style",
    "Langue, grammaire & syntaxe",
    "Lexique, étymologie & histoire de la langue",
    "Linguistique",
    "Philologie & manuscrits",
    "Traduction",
    "Écriture & création littéraire",
    "Livre, édition & institutions littéraires"
  ],
  "Médias - divertissements": [
    "Télévision",
    "Cinéma & séries",
    "Streaming",
    "Presse & journalisme",
    "Radio & podcasts",
    "Réseaux sociaux",
    "Créateurs de contenu",
    "Jeux vidéo",
    "Musique populaire",
    "Animation & mangas",
    "BD & comics",
    "Célébrités",
    "Humour & spectacles",
    "Culture populaire",
    "Internet & culture numérique",
    "Publicité & communication",
    "Événements & cérémonies",
    "Industrie des médias",
    "Information & désinformation"
  ],
  "Espace jeunes": [
    "Contes & histoires pour enfants",
    "Éveil & petite enfance",
    "Héros & personnages jeunesse",
    "Émissions & contenus jeunesse",
    "Actu expliquée aux jeunes",
    "Vie scolaire & apprentissage",
    "Adolescence & vie quotidienne des jeunes",
    "Sécurité & prévention jeunesse",
    "Orientation & avenir des jeunes",
    "Jeux & activités éducatives"
  ],
  "Histoire": [
    "Préhistoire",
    "Antiquité",
    "Moyen Âge",
    "Temps modernes",
    "Révolution française & Empire",
    "XIXe siècle",
    "XXe siècle — 1900-1945",
    "XXe siècle — 1946-2001"
  ],
  "Philosophie": [
    "Éthique & morale",
    "Philosophie politique",
    "Épistémologie & philosophie des sciences",
    "Logique & argumentation",
    "Philosophie de l'esprit",
    "Métaphysique"
  ],
  "Sciences sociales": [
    "Sociologie",
    "Psychologie sociale",
    "Anthropologie"
  ],
  "Société - éducation": [
    "École & enseignement",
    "Enseignement supérieur",
    "Famille & enfance",
    "Démographie",
    "Immigration & intégration",
    "Logement",
    "Religions & laïcité",
    "Discriminations & inclusion",
    "Genre & égalité",
    "Précarité & exclusion sociale"
  ],
  "Sciences - technologie": [
    "Mathématiques",
    "Physique",
    "Chimie",
    "Biologie & génétique",
    "Sciences de la Terre",
    "Astronomie & espace",
    "Informatique & intelligence artificielle",
    "Ingénierie & robotique",
    "Énergie & nucléaire"
  ],
  "Justice - faits divers": [
    "Criminalité organisée & trafics",
    "Violences sexuelles",
    "Violences conjugales & intrafamiliales",
    "Homicides & violences criminelles",
    "Délinquance & atteintes aux biens",
    "Escroqueries & cybercriminalité",
    "Police & enquêtes",
    "Justice & droit",
    "Prisons & système pénitentiaire",
    "Accidents, disparitions & drames"
  ],
  "Économie - emploi": [
    "Croissance & conjoncture",
    "Inflation & pouvoir d'achat",
    "Emploi & chômage",
    "Travail & salaires",
    "Entreprises & secteurs d'activité",
    "Banques & monnaie",
    "Finance & marchés",
    "Finances publiques & fiscalité",
    "Commerce international & mondialisation",
    "Immobilier & logement"
  ]
};

// Description du critère de correspondance "large" par galaxie (cf.
// CULTURE_GENERALE_SEED_SOLAR_SYSTEMS ci-dessus) — utilisé par
// buildDomainSolarSystemPrompt. Une galaxie absente de cette liste garde le
// critère strict habituel ("exactement la même notion").
const CULTURE_GENERALE_DOMAIN_GALAXIES = {
  "International": {
    unitLabel: "la région géographique internationale principalement concernée",
    matchExample: "ex. un contenu sur le Maroc correspond à \"Maghreb\", un contenu sur le Japon correspond à \"Asie de l’Est\", un contenu sur les Caraïbes correspond à \"Amérique centrale & Caraïbes\"",
    newExample: "le nom d’une région géographique internationale autonome et complète (2 à 4 mots, jamais une phrase)"
  },
  "Politique": {
    unitLabel: "le sous-domaine institutionnel ou politique dont il relève",
    matchExample: "ex. un contenu sur le mode de scrutin correspond à \"Élections\", un contenu sur le fonctionnement du Conseil constitutionnel correspond à \"Institutions & Constitution\"",
    newExample: "le nom de ce sous-domaine politique (2 à 4 mots, jamais une phrase)"
  },
  "Arts": {
    unitLabel: "la discipline artistique dont il relève",
    matchExample: "ex. un contenu sur un tableau ou une sculpture correspond à \"Arts visuels\", un contenu sur un film correspond à \"Cinéma & audiovisuel\", un contenu sur un roman ou un poème correspond à \"Littérature\"",
    newExample: "le nom de cette discipline artistique (2 à 4 mots, jamais une phrase)"
  },
  "Climat - environnement": {
    unitLabel: "le sous-domaine climatique ou environnemental dont il relève",
    matchExample: "ex. un contenu sur le réchauffement climatique correspond à \"Climat\", un contenu sur la disparition d'une espèce correspond à \"Biodiversité & écosystèmes\", un contenu sur les panneaux solaires correspond à \"Énergie & transition énergétique\"",
    newExample: "le nom de ce sous-domaine climatique ou environnemental (2 à 4 mots, jamais une phrase)"
  },
  "Sport": {
    unitLabel: "la discipline sportive dont il relève",
    matchExample: "ex. un contenu sur un match ou un championnat de ballon rond correspond à \"Football\", un contenu sur le Tour de France correspond à \"Cyclisme\", un contenu sur un combat de boxe correspond à \"Sports de combat\"",
    newExample: "le nom de cette discipline sportive (2 à 4 mots, jamais une phrase)"
  },
  "Langues": {
    unitLabel: "la famille de langues dont il relève",
    matchExample: "ex. un contenu sur l'espagnol ou l'italien correspond à \"Langues romanes\", un contenu sur le japonais correspond à \"Langues d’Asie de l’Est\", un contenu sur le latin correspond à \"Langues anciennes\"",
    newExample: "le nom de cette famille de langues (2 à 4 mots, jamais une phrase)"
  },
  "Loisirs": {
    unitLabel: "le sous-domaine de loisir dont il relève",
    matchExample: "ex. un contenu sur un jeu vidéo correspond à \"Jeux vidéo\", un contenu sur une recette de cuisine correspond à \"Cuisine & gastronomie\", un contenu sur la randonnée correspond à \"Nature & plein air\"",
    newExample: "le nom de ce sous-domaine de loisir (2 à 4 mots, jamais une phrase)"
  },
  "Santé - bien-être": {
    unitLabel: "le sous-domaine de santé ou de bien-être dont il relève",
    matchExample: "ex. un contenu sur un virus ou une épidémie correspond à \"Épidémies & infections\", un contenu sur l'alimentation équilibrée correspond à \"Nutrition\", un contenu sur l'anxiété ou la dépression correspond à \"Santé mentale\"",
    newExample: "le nom de ce sous-domaine de santé ou de bien-être (2 à 4 mots, jamais une phrase)"
  },
  "Vie personnelle - modes de vie": {
    unitLabel: "le sous-domaine de vie personnelle ou de mode de vie dont il relève",
    matchExample: "ex. un contenu sur l'éducation des enfants correspond à \"Famille & parentalité\", un contenu sur la gestion d'un budget correspond à \"Finances personnelles\", un contenu sur le télétravail correspond à \"Travail & équilibre de vie\"",
    newExample: "le nom de ce sous-domaine de vie personnelle ou de mode de vie (2 à 4 mots, jamais une phrase)"
  },
  "Lettres": {
    unitLabel: "le sous-domaine littéraire ou linguistique dont il relève",
    matchExample: "ex. un contenu sur un roman français correspond à \"Littérature française\", un contenu sur les figures de style correspond à \"Stylistique & figures de style\", un contenu sur l'étymologie d'un mot correspond à \"Lexique, étymologie & histoire de la langue\"",
    newExample: "le nom de ce sous-domaine littéraire ou linguistique (2 à 4 mots, jamais une phrase)"
  },
  "Médias - divertissements": {
    unitLabel: "le sous-domaine médiatique ou de divertissement dont il relève",
    matchExample: "ex. un contenu sur une série télévisée correspond à \"Cinéma & séries\", un contenu sur un influenceur correspond à \"Créateurs de contenu\", un contenu sur une fake news correspond à \"Information & désinformation\"",
    newExample: "le nom de ce sous-domaine médiatique ou de divertissement (2 à 4 mots, jamais une phrase)"
  },
  "Espace jeunes": {
    unitLabel: "le sous-domaine de contenu jeunesse dont il relève",
    matchExample: "ex. un contenu sur un dessin animé ou un personnage jeunesse correspond à \"Héros & personnages jeunesse\", un contenu sur le harcèlement scolaire correspond à \"Sécurité & prévention jeunesse\", un contenu sur la vie au collège correspond à \"Vie scolaire & apprentissage\"",
    newExample: "le nom de ce sous-domaine de contenu jeunesse (2 à 4 mots, jamais une phrase)"
  },
  "Histoire": {
    unitLabel: "la période ou l'époque historique à laquelle il appartient",
    matchExample: "ex. un événement de 1850 correspond à \"XIXe siècle\", un philosophe grec antique correspond à \"Antiquité\"",
    newExample: "un libellé de période autonome et complet de 2 à 4 mots, jamais une phrase"
  },
  "Philosophie": {
    unitLabel: "la discipline ou le sous-domaine philosophique dont il relève",
    matchExample: "ex. un contenu sur le bien et le mal correspond à \"Éthique & morale\", un contenu sur la connaissance scientifique correspond à \"Épistémologie & philosophie des sciences\"",
    newExample: "le nom de cette discipline ou de ce sous-domaine philosophique (2 à 4 mots, jamais une phrase)"
  },
  "Sciences sociales": {
    unitLabel: "la discipline des sciences sociales dont il relève",
    matchExample: "ex. un contenu sur les structures et institutions sociales correspond à \"Sociologie\", un contenu sur les comportements de groupe correspond à \"Psychologie sociale\"",
    newExample: "le nom de cette discipline des sciences sociales (2 à 4 mots, jamais une phrase)"
  },
  "Société - éducation": {
    unitLabel: "le sous-domaine de société ou d'éducation dont il relève",
    matchExample: "ex. un contenu sur le système scolaire correspond à \"École & enseignement\", un contenu sur les flux migratoires correspond à \"Immigration & intégration\"",
    newExample: "le nom de ce sous-domaine de société ou d'éducation (2 à 4 mots, jamais une phrase)"
  },
  "Sciences - technologie": {
    unitLabel: "la discipline scientifique ou technologique dont il relève",
    matchExample: "ex. un contenu sur les équations correspond à \"Mathématiques\", un contenu sur les modèles de langage correspond à \"Informatique & intelligence artificielle\"",
    newExample: "le nom de cette discipline scientifique ou technologique (2 à 4 mots, jamais une phrase)"
  },
  "Justice - faits divers": {
    unitLabel: "le sous-domaine judiciaire ou de faits divers dont il relève",
    matchExample: "ex. un contenu sur un cambriolage correspond à \"Délinquance & atteintes aux biens\", un contenu sur une enquête policière correspond à \"Police & enquêtes\"",
    newExample: "le nom de ce sous-domaine judiciaire ou de faits divers (2 à 4 mots, jamais une phrase)"
  },
  "Économie - emploi": {
    unitLabel: "le sous-domaine économique dont il relève",
    matchExample: "ex. un contenu sur les prix et le budget des ménages correspond à \"Inflation & pouvoir d'achat\", un contenu sur le marché du travail correspond à \"Emploi & chômage\"",
    newExample: "le nom de ce sous-domaine économique (2 à 4 mots, jamais une phrase)"
  }
};

// Ces solars ne sont JAMAIS des articles d'actu (ils n'existent que pour ce
// socle canonique connaissances) : taxonomy_scope='knowledge' explicite dès
// la création, plutôt que de laisser le défaut prudent 'unknown' se résoudre
// (ou pas) au hasard d'un futur backfill selon l'usage observé — sans quoi
// un solar de départ jamais encore utilisé restait invisible du moteur
// (isKnowledgeCandidate), constaté en pratique le 17/08/2026 sur plusieurs
// solars de départ (ex. "Préhistoire", "Philosophie politique") encore
// 'unknown' malgré leur pré-création.
async function ensureCultureGeneraleSeedSolarSystems() {
  // Court-circuit egress (audit du 26/08/2026) : cette fonction tournait en entier — ~250
  // lectures (une par nom, cf. resolveOrCreateSolarSystem) + ~20 UPDATE (un par galaxie) —
  // à CHAQUE démarrage du process, sans aucune garde, alors qu'elle est censée être un
  // one-shot. Une fois tous les solars de départ créés en taxonomy_scope='knowledge', un
  // simple COUNT suffit à savoir qu'il n'y a plus rien à faire ; on ne retombe dans la
  // double boucle complète que si ce compte est encore insuffisant (première exécution,
  // ou nouveaux noms ajoutés à CULTURE_GENERALE_SEED_SOLAR_SYSTEMS depuis).
  const totalExpected = Object.values(CULTURE_GENERALE_SEED_SOLAR_SYSTEMS)
    .reduce((sum, names) => sum + names.length, 0);
  const { count, error: countError } = await supabase
    .from("solar_systems")
    .select("id", { count: "exact", head: true })
    .eq("taxonomy_scope", "knowledge");
  if (!countError && (count || 0) >= totalExpected) return;

  for (const [galaxy, names] of Object.entries(CULTURE_GENERALE_SEED_SOLAR_SYSTEMS)) {
    for (const name of names) {
      await resolveOrCreateSolarSystem(galaxy, name, normalizeSolarSystemName(name), { taxonomyScope: "knowledge" });
    }
  }
  // Backfill ciblé (jamais une reclassification massive) : corrige les
  // lignes de départ déjà créées AVANT ce correctif et restées 'unknown'
  // faute d'avoir jamais été utilisées — ensemble fermé et connu (les noms
  // de CULTURE_GENERALE_SEED_SOLAR_SYSTEMS eux-mêmes), aucune ambiguïté.
  for (const [galaxy, names] of Object.entries(CULTURE_GENERALE_SEED_SOLAR_SYSTEMS)) {
    const normalizedNames = names.map(normalizeSolarSystemName);
    const { error } = await supabase.from("solar_systems")
      .update({ taxonomy_scope: "knowledge" })
      .eq("galaxy", galaxy)
      .eq("taxonomy_scope", "unknown")
      .in("normalized_name", normalizedNames);
    if (error) console.warn(`[culture-generale solar-system] backfill scope départ (${galaxy}) :`, error.message);
  }
}
ensureCultureGeneraleSeedSolarSystems().catch((err) => console.error("[culture-generale solar-system] pré-création systèmes de départ :", err.message));

// buildDomainSolarSystemPrompt (générait le prompt de résolution de Solar
// pour les galaxies "à domaine") supprimée le 16/08/2026 : la nouvelle
// resolveCultureGeneraleSolarSystemWithAI applique désormais le MÊME contrat
// MATCH/CREATE à toutes les Galaxies, cf. plus bas — CULTURE_GENERALE_DOMAIN_GALAXIES
// reste utilisée par resolveCultureGeneraleStarWithAI (granularité des
// Étoiles, hors périmètre de cette refonte).

// Valide/crée un nouveau Solar — UNIQUEMENT appelée après un no_match du
// MATCH fusionné (matchCultureGeneraleGalaxyAndSolarWithAI), jamais sur le
// chemin normal (cf. correctif du 16/08/2026, vérification finale : le MATCH
// Galaxy+Solar était auparavant scindé en 2 appels même sur le chemin reuse
// — fusionné plus haut, cette fonction ne porte plus que l'exception
// "création", 1 seul appel IA supplémentaire, jamais 2).
//
// `candidates` provient du MATCH déjà exécuté par l'appelant (jamais
// re-fetché ici) — toujours le périmètre de l'utilisateur courant (§1/§29).
// Renvoie désormais { solarSystemId, starId } (plus un simple id) : depuis le
// correctif du 16/08/2026 (vérification finale point 3), cet appel produit
// AUSSI l'Étoile dans la même réponse IA — plus de 3e appel dédié sur le
// chemin "create" (Galaxy+Solar match, puis create = ce seul appel = 2 au
// total). C'est en réalité le meilleur moment pour décider l'Étoile : ce
// Solar tout juste nommé/décrit est un contexte bien plus riche qu'une
// hypothèse formée avant même sa création.
async function resolveCultureGeneraleSolarSystemWithAI(galaxy, sourceType, sourceName, sourceDetail, rawCandidates) {
  const candidates = rawCandidates || [];
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null; // jamais de repli aveugle sur sourceName : mieux vaut ne pas classer que créer un solar à côté du contrat

  const subjectTitle = String(sourceName || "").slice(0, 160);
  const subjectDetail = flattenCultureGeneraleDetail(sourceDetail).slice(0, 400);
  const candidatesPayload = candidates.map((c) => ({ id: c.id, name: c.name, description: c.description || null }));
  const domainGalaxyNames = Object.keys(CULTURE_GENERALE_DOMAIN_GALAXIES).join(", ");

  // ── Validation de création (exception, cf. §13/§14 du plan) + Étoile ──
  const creationPrompt = [
    "Réponds uniquement en json valide.",
    `Un premier examen n'a trouvé AUCUN Solar existant cohérent parmi ${candidates.length ? "les Solars déjà utilisés par cet utilisateur dans cette Galaxy" : "aucun Solar (cet utilisateur n'a encore rien dans cette Galaxy)"} pour cette connaissance. Confirme ce diagnostic puis, seulement s'il est réellement confirmé, propose un nouveau Solar ET l'Étoile qui accueillera cette connaissance sous ce nouveau Solar.`,
    "Vérifie explicitement pour le Solar : (1) aucun des candidats fournis n'est raisonnablement cohérent, même en étant un peu plus large que l'idéal ; (2) le Solar que tu vas proposer est assez large pour accueillir plusieurs connaissances différentes à l'avenir, pas seulement celle-ci ; (3) il n'est pas une simple reformulation du sujet précis de cette connaissance.",
    "Si un candidat est finalement acceptable une fois ce test appliqué, réponds quand même avec noExistingMatch:false et l'id de ce candidat plutôt que de forcer une création (dans ce cas, ne renvoie pas starName : l'Étoile sera résolue séparément).",
    "Sinon, réponds avec noExistingMatch:true, un \"name\" court (2 à 4 mots, jamais une phrase, jamais le fait précis de cette connaissance) et une \"description\" d'une phrase expliquant ce que ce Solar couvre durablement.",
    `Propose aussi "starName" : le nom de l'Étoile sous ce nouveau Solar — une sous-catégorie précise mais RÉUTILISABLE pour plusieurs contenus futurs, jamais le fait atomique de cette seule connaissance (2 à 4 mots). Si cette Galaxy (${galaxy}) fait partie de [${domainGalaxyNames}], l'Étoile doit rester assez large (imagine dix autres contenus rattachés au même Solar : elle doit convenir à plusieurs d'entre eux) ; sinon elle peut être la notion précise elle-même. Dans tous les cas, "starName" ne doit JAMAIS reprendre les mots de "name" (le nouveau Solar) — ce serait une simple redite, pas une sous-catégorie.`,
    "Format obligatoire : {\"noExistingMatch\":true,\"name\":\"...\",\"description\":\"...\",\"starName\":\"...\"} ou {\"noExistingMatch\":false,\"id\":123}",
    "",
    JSON.stringify({ type: sourceType, title: subjectTitle, detail: subjectDetail, candidates: candidatesPayload })
  ].join("\n");

  try {
    console.log(`[ia-call] solar+star create: galaxy=${galaxy} title="${subjectTitle.slice(0, 60)}"`);
    const isGpt5 = /^gpt-5/.test(OPINION_ARTICLE_CATEGORY_MODEL);
    let content;
    if (isGpt5) {
      content = await fetchGpt5JsonContentWithRetry(apiKey, OPINION_ARTICLE_CATEGORY_MODEL, creationPrompt, "[knowledge-taxonomy solar create]", { reasoningEffort: "medium", initialBudget: 1200, feature: "knowledge_classification" });
    } else {
      const requestStartedAt = Date.now();
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
        body: JSON.stringify({ model: OPINION_ARTICLE_CATEGORY_MODEL, messages: [{ role: "user", content: creationPrompt }], response_format: { type: "json_object" }, max_tokens: 220, temperature: 0 })
      });
      if (!r.ok) {
        const errBody = await r.text().catch(() => "");
        recordAiUsage(supabase, { feature: "knowledge_classification", model: OPINION_ARTICLE_CATEGORY_MODEL, latencyMs: Date.now() - requestStartedAt, success: false, error: errBody || `openai http ${r.status}` });
        throw new Error(`openai http ${r.status}`);
      }
      const data = await r.json();
      content = data?.choices?.[0]?.message?.content;
      const { inputTokens, outputTokens, cachedTokens } = extractUsage(data?.usage);
      recordAiUsage(supabase, { feature: "knowledge_classification", model: OPINION_ARTICLE_CATEGORY_MODEL, inputTokens, outputTokens, cachedTokens, latencyMs: Date.now() - requestStartedAt, success: true });
    }
    const raw = content ? JSON.parse(content) : null;
    if (raw?.noExistingMatch === false) {
      const id = Number(raw.id);
      // Le Solar candidat était finalement acceptable : l'Étoile n'a pas été
      // proposée dans cet appel (cf. consigne ci-dessus) — repli sur
      // resolveCultureGeneraleStarWithAI par l'appelant, comme avant.
      return candidates.some((c) => c.id === id) ? { solarSystemId: id, starId: null } : null;
    }
    const creation = parseCreationDecision(raw);
    if (!creation) return null;

    const gate = validateTaxonomyCreationCandidate({
      name: creation.name,
      galaxy,
      existingSolarNames: candidates.map((c) => c.name),
      subjectName: sourceName,
      requireNoExistingMatch: true
    });
    if (!gate.ok) {
      console.warn(`[knowledge-taxonomy solar create] création refusée par le gate (${gate.reason}) : galaxy=${galaxy} name="${creation.name}"`);
      return null;
    }
    const solarSystemId = await resolveOrCreateSolarSystem(galaxy, creation.name, normalizeSolarSystemName(creation.name), {
      description: creation.description,
      taxonomyScope: "knowledge"
    });
    if (!solarSystemId) return null;

    // Étoile déterminée déterministement à partir de starName (gate qualité
    // uniquement — un Solar tout juste créé n'a par construction aucune
    // étoile existante pour cet utilisateur, donc rien à comparer, cf.
    // matchExistingStarByLabel jamais nécessaire ici).
    const rawStarName = typeof raw?.starName === "string" ? raw.starName.trim() : "";
    const starGate = validateStarLabelCandidate({ label: rawStarName, solarName: creation.name });
    const finalStarLabel = starGate.ok ? rawStarName : sourceName; // repli sûr : jamais de création avec un libellé invalide
    if (!starGate.ok) {
      console.warn(`[knowledge-taxonomy star create] libellé rejeté par le gate (${starGate.reason}), repli sur sourceName : solar="${creation.name}" starName="${rawStarName}"`);
    }
    const starId = await resolveOrCreateStar(solarSystemId, finalStarLabel, normalizeStarName(finalStarLabel));
    return { solarSystemId, starId };
  } catch (error) {
    console.warn("[knowledge-taxonomy solar create] classification IA ignorée :", error.message);
    return null;
  }
}

// ---- Étoiles Culture Générale : tag précis (la notion elle-même, ex. "Résilience")
// sous un système solaire qui reste une sous-catégorie durable de la galaxie (ex.
// "Philosophie") — même principe à deux niveaux que l'ancien système articles (système
// solaire = thème durable, étoile = occasion précise), réintroduit ici pour la culture
// générale. Même mécanique de déduplication que les systèmes solaires, un cran plus bas
// (scopée au système solaire plutôt qu'à la galaxie).

function normalizeStarName(value) {
  return normalizeSolarSystemName(value);
}

// Rejette un nom d'étoile vide, identique/quasi identique au système solaire parent (sinon
// aucun intérêt à ce niveau supplémentaire), ou à la galaxie/catégorie.
function isOpinionArticleStarNameRejected(normalizedName, { solarSystemName, galaxy, category, categoryPrecision }) {
  if (!normalizedName) return true;
  if (solarSystemName && normalizedName === normalizeStarName(solarSystemName)) return true;
  if (galaxy && normalizedName === normalizeStarName(galaxy)) return true;
  if (category && normalizedName === normalizeStarName(category)) return true;
  if (categoryPrecision && normalizedName === normalizeStarName(categoryPrecision)) return true;
  return false;
}

// Même mécanique que resolveOrCreateSolarSystem : retrouve une étoile existante
// (solar_system_id, normalized_name) ou la crée, sans coupe mécanique du nom.
async function resolveOrCreateStar(solarSystemId, name, normalizedName) {
  const { data: existing, error: selectError } = await supabase
    .from("stars")
    .select("id")
    .eq("solar_system_id", solarSystemId)
    .eq("normalized_name", normalizedName)
    .maybeSingle();
  if (selectError) { console.warn("[stars] lecture échouée :", selectError.message); return null; }
  if (existing) return existing.id;
  const { data: inserted, error: insertError } = await supabase
    .from("stars")
    .insert({ solar_system_id: solarSystemId, name: cleanUniverseNodeName(name), normalized_name: normalizedName })
    .select("id")
    .single();
  if (!insertError) {
    return inserted.id;
  }
  const { data: retryExisting, error: retryError } = await supabase
    .from("stars")
    .select("id")
    .eq("solar_system_id", solarSystemId)
    .eq("normalized_name", normalizedName)
    .maybeSingle();
  if (!retryError && retryExisting) return retryExisting.id;
  console.warn("[stars] création échouée :", insertError.message);
  return null;
}

// Résolution de l'étoile d'un contenu Culture Générale, une fois son système solaire
// connu (cf. resolveCultureGeneraleSolarSystemWithAI) — même principe que la résolution du
// système : vérifie d'abord si la notion correspond à une étoile déjà existante dans CE
// système précis avant d'en créer une nouvelle. Un seul item à la fois (tourne à
// l'acquisition, pas en lot).
async function resolveCultureGeneraleStarWithAI(galaxy, solarSystemId, solarSystemName, sourceType, sourceName, sourceDetail, userStarActivations) {
  const { data: existingRows, error: existingError } = await supabase
    .from("stars")
    .select("id, name, solar_system_id")
    .eq("solar_system_id", solarSystemId);
  if (existingError) console.warn("[culture-generale star] lecture stars échouée :", existingError.message);
  // Isolation utilisateur (§3 de la vérification finale du 16/08/2026) : une
  // Star déjà créée sous ce Solar par un AUTRE utilisateur, mais jamais
  // rencontrée par l'utilisateur courant, n'est jamais un candidat — sans ça,
  // resolveCultureGeneraleStarWithAI proposait auparavant TOUTES les étoiles
  // du Solar, quel que soit qui les avait créées.
  const existing = filterUserActiveStars(
    (existingRows || []).map((s) => ({ id: s.id, name: s.name, solarSystemId: s.solar_system_id })),
    userStarActivations,
    solarSystemId
  );

  // §3 de la vérification finale (16/08/2026) demande d'évaluer si cet appel
  // est supprimable quand l'identité est déterminable sans IA. Étudié et
  // ÉCARTÉ : même quand `existing` est vide, cet appel ne fait pas QUE
  // comparer à l'existant — il fabrique aussi le libellé de la nouvelle
  // étoile en lui appliquant des règles de qualité non triviales (rester plus
  // large que le fait précis, ne jamais reprendre les mots du système
  // solaire, cf. règles ci-dessous, durcies le 09 et 10/08/2026 après bugs
  // réels). Remplacer cet appel par resolveOrCreateStar(sourceName) quand
  // `existing` est vide réintroduirait exactement ces deux bugs sur CHAQUE
  // première étoile d'un Solar neuf ou nouvellement actif — le cas le plus
  // fréquent, pas un cas marginal. Cet appel reste donc systématique dès que
  // le Solar est connu ; seul le court-circuit "Subject déjà connu" en tête
  // de classifyCultureGeneraleKnowledgePlacementWithAI (0 appel, identité
  // exacte du Subject) l'évite légitimement.
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return resolveOrCreateStar(solarSystemId, sourceName, normalizeStarName(sourceName));

  const compact = {
    type: sourceType,
    title: String(sourceName || "").slice(0, 160),
    detail: flattenCultureGeneraleDetail(sourceDetail).slice(0, 400),
    solar_system: solarSystemName,
    existing_stars: existing.map((s) => `${s.id}:${s.name}`).join(", ") || "(aucune étoile existante dans ce système)"
  };
  // Galaxies à domaines fixes (cf. CULTURE_GENERALE_DOMAIN_GALAXIES) :
  // contrairement aux autres galaxies (où l'étoile doit être la notion
  // précise elle-même, ex. "Résilience"), l'étoile doit ici rester large —
  // une vraie sous-catégorie du système solaire, jamais le fait précis de ce
  // contenu — pour que plusieurs sujets distincts du même système puissent
  // partager la même étoile, plutôt qu'une étoile différente par notion
  // (constaté en pratique : "Louis-Philippe devient roi des Français" comme
  // étoile, trop précis pour être jamais réutilisé — demande du 09/08/2026).
  // Doit aussi rester DISTINCTE du système solaire lui-même, sans reprendre
  // ses mots (constaté en pratique : étoile "Révolution française" sous le
  // système "Révolution française & Empire", simple redite du système au
  // lieu d'une vraie sous-catégorie comme "Terreur" ou "Directoire" —
  // demande du 10/08/2026) : filet de sécurité déterministe plus bas en
  // complément (sous-ensemble de mots du système solaire).
  const domainConfig = CULTURE_GENERALE_DOMAIN_GALAXIES[galaxy];
  const prompt = domainConfig ? [
    "Réponds uniquement en json valide.",
    `Un contenu de culture générale doit être rattaché à une "étoile" : une sous-catégorie du système solaire donné (${JSON.stringify(solarSystemName)}) — plus précise que ce système, mais encore assez large pour regrouper plusieurs contenus différents. JAMAIS le fait précis ou l'angle exact de ce contenu en particulier.`,
    "Examine TOUTES les existing_stars avant d'envisager une création. Si le même sujet ou la même sous-catégorie existe déjà, tu DOIS réutiliser son star_id, même si son libellé est un synonyme ou une reformulation : aucune étoile doublon.",
    "Règle de test décisive : imagine dix autres contenus différents rattachés au même système solaire — l'étoile que tu choisis doit être EXACTEMENT LA MÊME pour plusieurs d'entre eux. Si ton étoile ne conviendrait qu'à ce contenu précis et à aucun autre, elle est trop précise : remonte d'un cran.",
    "INTERDICTION ABSOLUE : l'étoile ne doit JAMAIS reprendre les mots du système solaire lui-même, même reformulés — ce serait une simple redite, pas une sous-catégorie. Exemple : pour le système \"Révolution française & Empire\", l'étoile \"Révolution française\" est INTERDITE (redite du système) ; une vraie sous-catégorie serait \"Terreur\", \"Directoire\", \"Consulat\" ou \"Premier Empire\". Pour le système \"Éthique & morale\", l'étoile \"Éthique\" est interdite ; une vraie sous-catégorie serait \"Utilitarisme\" ou \"Impératif catégorique\".",
    "Vérifie d'abord si un thème de existing_stars correspond à ce contenu — dans ce cas renvoie son id dans star_id.",
    "Sinon, propose dans new_star le nom de cette sous-catégorie (2 à 4 mots, jamais une phrase, jamais le détail précis du contenu, jamais un mot du système solaire).",
    "Le libellé doit rester compréhensible isolément et ne doit jamais se terminer par un article, une préposition ou un mot de liaison comme de, du, des, le, la, les, à, au, aux, et ou en.",
    "RÈGLE OBLIGATOIRE : réponds avec soit \"star_id\" (nombre), soit \"new_star\" (texte court) — jamais les deux, jamais aucun des deux.",
    "Format obligatoire : {\"star_id\":null,\"new_star\":\"Directoire\"}",
    "",
    JSON.stringify(compact)
  ].join("\n") : [
    "Réponds uniquement en json valide.",
    "Un contenu de culture générale doit être rattaché à une \"étoile\" : la notion précise qu'il illustre, à l'intérieur du système solaire donné (un thème plus large et durable).",
    "Examine TOUTES les existing_stars avant d'envisager une création. Si le sujet existe déjà sous un libellé identique, synonyme ou reformulé, tu DOIS réutiliser son star_id : créer une étoile doublon est interdit.",
    "Vérifie d'abord si une notion de existing_stars désigne EXACTEMENT la même notion, quitte à être reformulée différemment (ex. \"Résilience\" et \"La résilience face à l'adversité\" sont la même notion) — dans ce cas renvoie son id dans star_id.",
    "Un simple lien thématique ou un vocabulaire commun NE SUFFIT JAMAIS : en cas du moindre doute, ne réutilise jamais — propose une nouvelle étoile plutôt qu'un rattachement hasardeux (une étoile en trop est sans conséquence, une fusion erronée mélange deux notions distinctes).",
    "Sinon, propose dans new_star un libellé autonome et complet de 2 à 4 mots, idéalement 35 caractères maximum, jamais une phrase, qui résume la notion elle-même et jamais l'anecdote ou l'actualité du jour qui l'illustre.",
    "Le libellé doit rester compréhensible isolément et ne doit jamais se terminer par un article, une préposition ou un mot de liaison comme de, du, des, le, la, les, à, au, aux, et ou en.",
    "L'étoile ne doit jamais être un simple doublon ou une reformulation du système solaire lui-même — elle doit être plus précise, pas juste un synonyme.",
    "RÈGLE OBLIGATOIRE : réponds avec soit \"star_id\" (nombre), soit \"new_star\" (texte court) — jamais les deux, jamais aucun des deux.",
    "Format obligatoire : {\"star_id\":null,\"new_star\":\"Résilience\"}",
    "",
    JSON.stringify(compact)
  ].join("\n");

  try {
    // Ce 3e appel (rare, cf. commentaire de repli plus haut chez l'appelant)
    // est précisément celui qui fait passer le total de 2 à 3 sur le chemin
    // create — marqué distinctement pour rester identifiable dans les logs.
    console.log(`[ia-call] EXCEPTION star fallback (3e appel): galaxy=${galaxy} solarSystemId=${solarSystemId}`);
    const isGpt5 = /^gpt-5/.test(OPINION_ARTICLE_CATEGORY_MODEL);
    let content;
    if (isGpt5) {
      // Mêmes raisons que resolveCultureGeneraleSolarSystemWithAI : "medium"
      // pour les galaxies à domaines fixes (l'IA doit vraiment comparer au
      // système solaire donné, pas recopier le contenu). fetchGpt5JsonContentWithRetry
      // redouble le budget si la première tentative épuise tout son budget en
      // raisonnement caché plutôt que d'abandonner — jamais de classement manqué
      // faute de budget.
      content = await fetchGpt5JsonContentWithRetry(apiKey, OPINION_ARTICLE_CATEGORY_MODEL, prompt, "[culture-generale star]", {
        reasoningEffort: domainConfig ? "medium" : "low",
        initialBudget: domainConfig ? 1200 : 500,
        feature: "knowledge_classification"
      });
    } else {
      const requestStartedAt = Date.now();
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
        body: JSON.stringify({
          model: OPINION_ARTICLE_CATEGORY_MODEL,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          max_tokens: 200,
          temperature: 0
        })
      });
      if (!r.ok) {
        const errBody = await r.text().catch(() => "");
        recordAiUsage(supabase, { feature: "knowledge_classification", model: OPINION_ARTICLE_CATEGORY_MODEL, latencyMs: Date.now() - requestStartedAt, success: false, error: errBody || `openai http ${r.status}` });
        throw new Error(`openai http ${r.status} — ${errBody.slice(0, 500)}`);
      }
      const data = await r.json();
      content = data?.choices?.[0]?.message?.content;
      const { inputTokens, outputTokens, cachedTokens } = extractUsage(data?.usage);
      recordAiUsage(supabase, { feature: "knowledge_classification", model: OPINION_ARTICLE_CATEGORY_MODEL, inputTokens, outputTokens, cachedTokens, latencyMs: Date.now() - requestStartedAt, success: true });
    }
    const parsed = content ? JSON.parse(content) : null;

    const candidateId = Number(parsed?.star_id);
    if (Number.isInteger(candidateId) && candidateId > 0 && existing.some((s) => s.id === candidateId)) {
      return candidateId;
    }
    const newName = String(parsed?.new_star || "").trim();
    // Filet de sécurité pour les galaxies à domaines fixes : rejette une
    // étoile dont les mots sont entièrement contenus dans ceux du système
    // solaire (simple redite plutôt qu'une vraie sous-catégorie, constaté en
    // pratique le 10/08/2026 — étoile "Révolution française" sous le
    // système "Révolution française & Empire").
    const rejectAsSolarSystemRestatement = domainConfig && newName && (() => {
      const starWords = normalizeStarName(newName).split(" ").filter(Boolean);
      const systemWords = new Set(normalizeSolarSystemName(solarSystemName).split(" ").filter(Boolean));
      return starWords.length > 0 && starWords.every((w) => systemWords.has(w));
    })();
    if (rejectAsSolarSystemRestatement) {
      console.warn(`[culture-generale star] libellé rejeté (redite du système solaire) : solarSystem="${solarSystemName}" newName="${newName}"`);
    } else if (isStandaloneUniverseNodeName(newName)) {
      const normalized = normalizeStarName(newName);
      if (!isOpinionArticleStarNameRejected(normalized, { solarSystemName, category: null, categoryPrecision: null })) {
        return await resolveOrCreateStar(solarSystemId, newName, normalized);
      }
    }
  } catch (error) {
    console.warn("[culture-generale star] classification IA ignorée :", error.message);
  }
  // Jamais de repli sur sourceName pour une galaxie à domaines fixes : ce
  // serait recréer le même risque de sur-précision qu'ailleurs — mieux vaut
  // ne pas classer cette fois (best-effort, cf. appelant) qu'une étoile
  // à côté de la logique de sous-catégorie attendue.
  if (domainConfig) return null;
  return resolveOrCreateStar(solarSystemId, sourceName, normalizeStarName(sourceName));
}

// Placement canonique calculé UNE seule fois, dès la création du QCM. La
// classification parcourt la hiérarchie dans l'ordre : une thématique unique
// (donc une galaxie), tous les solars de cette galaxie, puis toutes les étoiles
// du solar retenu. Les ids trouvés/créés sont copiés dans chaque question et
// seront réutilisés à la première bonne réponse — aucune seconde décision IA
// susceptible de ranger la même connaissance ailleurs.
async function classifyCultureGeneraleKnowledgePlacementWithAI(sourceType, sourceName, sourceDetail, userId, sourceDebateId) {
  // ── Chemin déterministe, 0 appel IA (cible "connu=0", vérification finale
  // du 16/08/2026 — CORRIGÉ point 1 : doit être personnel, jamais celui d'un
  // autre utilisateur) : CE Subject a-t-il déjà été classé par CET
  // utilisateur précisément (une génération antérieure du même sourceDebateId
  // que lui-même a déjà rencontrée et acquise) ? Un placement résolu
  // uniquement par un autre utilisateur ne court-circuite jamais la
  // classification de celui-ci — sinon le Solar/Star propre à cet autre
  // utilisateur s'imposerait sans jamais passer par sa propre décision MATCH.
  // buildKnownPlacementLookup renvoie null (donc aucune requête) si userId
  // manque — jamais de court-circuit non personnel possible.
  //
  // Distinct, et volontairement non touché ici, du mécanisme PLUS ANCIEN de
  // recordDailyQuizEclairageAcquisition ("contenu partagé par tous les
  // visiteurs LE MÊME JOUR") : celui-ci porte sur LA MÊME ligne daily_quiz
  // déjà générée une fois et lue par plusieurs utilisateurs le même jour —
  // c'est l'identité du Subject/Star (canonique, partagée par construction,
  // cf. rapport de design "Star ≈ Subject"), pas une réutilisation entre deux
  // générations distinctes à des dates différentes comme ici.
  const knownLookup = buildKnownPlacementLookup(sourceType, sourceDebateId, userId);
  if (knownLookup) {
    const { data: known, error: knownError } = await supabase
      .from("user_article_acquisitions")
      .select("solar_system_id, star_id")
      .match(knownLookup)
      .not("solar_system_id", "is", null)
      .not("star_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (!knownError && known) {
      const { data: knownSolar } = await supabase.from("solar_systems").select("galaxy").eq("id", known.solar_system_id).maybeSingle();
      if (knownSolar?.galaxy) {
        return {
          category: knownSolar.galaxy,
          categoryPrecision: null,
          galaxy: knownSolar.galaxy,
          solarSystemId: known.solar_system_id,
          starId: known.star_id
        };
      }
    }
  }

  // Solars déjà actifs pour CET utilisateur (jamais tous les Solars de la
  // Galaxy, cf. §1 du plan) — lu une seule fois, réutilisé par le MATCH
  // fusionné Galaxy+Solar ci-dessous.
  const userSolars = await fetchUserActiveKnowledgeSolars(userId);
  const match = await matchCultureGeneraleGalaxyAndSolarWithAI(sourceType, sourceName, sourceDetail, userSolars);
  if (!match?.galaxy) return null;

  const galaxy = match.galaxy;
  // `category`/`categoryPrecision` conservés dans l'objet retourné pour
  // compatibilité avec le reste du code (sourceThemes, affichage) — pour le
  // nouveau moteur, category vaut toujours galaxy elle-même (plus de
  // rubriques hybrides côté connaissances, cf. KNOWLEDGE_GALAXY_DEFINITIONS).
  const placement = {
    category: galaxy,
    categoryPrecision: null,
    galaxy,
    solarSystemId: null,
    starId: null
  };

  // Étoiles déjà rencontrées par CET utilisateur uniquement (§3 de la
  // vérification finale : une Star de User B doit rester invisible pour User
  // A) — dérivées de user_article_acquisitions.star_id, aucune table dédiée.
  // Chargées AVANT la décision solar : nécessaires dès le chemin "existing"
  // pour la résolution déterministe de l'Étoile (cf. plus bas).
  const { data: userStarRows } = await supabase
    .from("user_article_acquisitions")
    .select("star_id")
    .eq("user_id", userId)
    .not("star_id", "is", null);
  const userStarActivations = (userStarRows || []).map((r) => ({ starId: r.star_id }));

  let solarSystemId = null;
  let starId = null;

  if (match.decision === "existing") {
    // ── Chemin reuse : TOTAL = 1 appel IA (celui du MATCH ci-dessus) ──────
    // Le Solar est déjà connu (nom compris) : l'Étoile proposée par ce même
    // appel (match.starLabel) est comparée déterministement aux étoiles déjà
    // rencontrées par cet utilisateur sous CE Solar (matchExistingStarByLabel)
    // — jamais un appel IA supplémentaire sur ce chemin.
    solarSystemId = match.solarId;
    const matchedSolar = match.candidates.find((c) => c.id === solarSystemId);
    const { data: userExistingStars } = await supabase
      .from("stars")
      .select("id, name, solar_system_id")
      .eq("solar_system_id", solarSystemId);
    const scopedStars = filterUserActiveStars(
      (userExistingStars || []).map((s) => ({ id: s.id, name: s.name, solarSystemId: s.solar_system_id })),
      userStarActivations,
      solarSystemId
    );
    const existingStarMatch = matchExistingStarByLabel(match.starLabel, scopedStars);
    if (existingStarMatch) {
      starId = existingStarMatch;
    } else {
      const starGate = validateStarLabelCandidate({ label: match.starLabel, solarName: matchedSolar?.name });
      const finalLabel = starGate.ok ? match.starLabel : sourceName; // repli sûr, jamais un libellé invalide créé tel quel
      if (!starGate.ok) {
        console.warn(`[knowledge-taxonomy star match] libellé rejeté par le gate (${starGate.reason}), repli sur sourceName : solar="${matchedSolar?.name}" starLabel="${match.starLabel}"`);
      }
      starId = await resolveOrCreateStar(solarSystemId, finalLabel, normalizeStarName(finalLabel));
    }
  } else {
    // ── Chemin create : TOTAL = 2 appels IA (MATCH + cet appel, qui produit
    // désormais Solar ET Étoile ensemble) ────────────────────────────────
    const created = await resolveCultureGeneraleSolarSystemWithAI(galaxy, sourceType, sourceName, sourceDetail, match.candidates);
    if (!created?.solarSystemId) return placement;
    solarSystemId = created.solarSystemId;
    if (created.starId) {
      starId = created.starId;
    } else {
      // Cas rare (cf. resolveCultureGeneraleSolarSystemWithAI) : l'appel de
      // création a finalement jugé un candidat acceptable (noExistingMatch:false)
      // sans proposer d'Étoile — repli sur la résolution dédiée (qui refait
      // elle-même sa lecture + son filtrage utilisateur), seul cas où un 3e
      // appel IA reste possible sur le chemin create.
      const { data: fallbackSolarRow } = await supabase.from("solar_systems").select("name").eq("id", solarSystemId).maybeSingle();
      starId = await resolveCultureGeneraleStarWithAI(galaxy, solarSystemId, fallbackSolarRow?.name || sourceName, sourceType, sourceName, sourceDetail, userStarActivations);
    }
  }
  if (!solarSystemId) return placement;

  const { data: solarSystemRow, error: solarSystemError } = await supabase
    .from("solar_systems")
    .select("id, name, galaxy")
    .eq("id", solarSystemId)
    .maybeSingle();
  if (solarSystemError || !solarSystemRow || solarSystemRow.galaxy !== galaxy) {
    console.warn("[culture-generale placement] solar invalide :", solarSystemError?.message || solarSystemId);
    return placement;
  }
  placement.solarSystemId = solarSystemRow.id;
  if (!starId) return placement;

  const { data: starRow, error: starError } = await supabase
    .from("stars")
    .select("id, solar_system_id")
    .eq("id", starId)
    .maybeSingle();
  if (starError || !starRow || Number(starRow.solar_system_id) !== Number(solarSystemRow.id)) {
    console.warn("[culture-generale placement] étoile invalide :", starError?.message || starId);
    return placement;
  }
  placement.starId = starRow.id;
  return placement;
}

// Défense en profondeur avant de consommer un placement stocké dans le JSON
// daily_quiz : la catégorie doit encore mener à la galaxie du solar, et
// l'étoile doit réellement appartenir à ce solar. Les anciens QCM, qui n'ont
// pas sourcePlacement, retombent simplement sur le flux historique plus bas.
async function validateStoredCultureGeneralePlacement(rawPlacement) {
  if (!rawPlacement || typeof rawPlacement !== "object") return null;
  // Valide contre KNOWLEDGE_GALAXY_DEFINITIONS (nouveau moteur, 16/08/2026) —
  // plus getOpinionArticleGalaxy(category, categoryPrecision), qui référence
  // la taxonomie des articles d'actu et rejetait à tort des galaxies
  // connaissances valides comme "Arts" (jamais un libellé "actu" hybride
  // ici). rawPlacement.galaxy est l'autorité ; category n'est conservé que
  // pour compatibilité d'affichage (cf. classifyCultureGeneraleKnowledgePlacementWithAI).
  const galaxy = findKnowledgeGalaxyDefinition(rawPlacement.galaxy)?.name || null;
  const solarSystemId = Number(rawPlacement.solarSystemId);
  const starId = Number(rawPlacement.starId);
  if (!galaxy || !Number.isInteger(solarSystemId) || solarSystemId <= 0 || !Number.isInteger(starId) || starId <= 0) return null;

  const [{ data: solarSystem, error: solarError }, { data: star, error: starError }] = await Promise.all([
    supabase.from("solar_systems").select("id, galaxy").eq("id", solarSystemId).maybeSingle(),
    supabase.from("stars").select("id, solar_system_id").eq("id", starId).maybeSingle()
  ]);
  if (solarError || starError || !solarSystem || !star) return null;
  if (solarSystem.galaxy !== galaxy || Number(star.solar_system_id) !== solarSystemId) return null;
  return { solarSystemId, starId };
}

// Enregistre l'acquisition d'un contenu Culture Générale dans l'univers intellectuel
// personnel de l'utilisateur (originale "culture_generale-qN" ou repasse "cgreview-...", les
// deux portent déjà sourceDebateId/sourceType/sourceName sur l'objet question, cf.
// fetchUserCultureGeneraleAnswerEvents). Seuil d'acquisition volontairement à une seule bonne
// réponse : différent du seuil de validation à DAILY_QUIZ_ACQUIS_VALIDATION_STREAK réponses de
// "Mes acquis", qui reste une fonctionnalité à part, inchangée. eclairage_name/eclairage_detail
// sont enregistrés en clair (photographie au moment de l'acquisition) : ces contenus n'ont pas
// de table dédiée relisible à la demande.
async function recordDailyQuizEclairageAcquisition(voterKey, question) {
  const sourceDebateId = question?.sourceDebateId ? String(question.sourceDebateId) : "";
  const sourceType = String(question?.sourceType || "").trim();
  const sourceName = String(question?.sourceName || "").trim();
  if (!sourceDebateId || !sourceType || !sourceName) return;

  const { legacyKey, error: keyError } = validateLegacyKey(voterKey);
  if (keyError) {
    console.warn("[daily quiz eclairage acquisitions] failed : voterKey invalide.");
    return;
  }

  let user;
  try {
    ({ user } = await resolveLegacyUser(supabase, legacyKey));
  } catch (error) {
    console.warn("[daily quiz eclairage acquisitions] failed : résolution utilisateur —", error.message);
    return;
  }

  // Déjà acquis (répétition d'une même bonne réponse, ex. repasse déjà validée
  // précédemment) : jamais de nouvel appel IA pour rien, l'upsert plus bas serait de toute
  // façon sans effet (ignoreDuplicates).
  try {
    const { data: existingAcquisition, error: existingError } = await supabase
      .from("user_article_acquisitions")
      .select("id")
      .eq("user_id", user.id)
      .eq("eclairage_type", sourceType)
      .eq("eclairage_source_id", sourceDebateId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existingAcquisition) return;
  } catch (error) {
    console.warn("[daily quiz eclairage acquisitions] failed : vérification acquisition existante —", error.message);
    return;
  }

  // Contenu partagé par tous les visiteurs le même jour : si un autre visiteur a déjà
  // classé ce même (eclairage_type, eclairage_source_id) — système ET étoile déjà
  // résolus — on réutilise directement, aucun appel IA. Seule la toute première bonne
  // réponse de la journée sur un sujet donné déclenche une classification.
  let solarSystemId = null;
  let starId = null;
  try {
    const { data: reusable, error: reusableError } = await supabase
      .from("user_article_acquisitions")
      .select("solar_system_id, star_id")
      .eq("eclairage_type", sourceType)
      .eq("eclairage_source_id", sourceDebateId)
      .not("solar_system_id", "is", null)
      .not("star_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (reusableError) throw reusableError;
    if (reusable) {
      solarSystemId = reusable.solar_system_id;
      starId = reusable.star_id;
    }
  } catch (error) {
    console.warn("[daily quiz eclairage acquisitions] failed : recherche classification réutilisable —", error.message);
  }

  // Pour les QCM générés depuis cette version, le placement complet a déjà
  // été décidé à leur création après exploration des solars/étoiles
  // existants. On le réutilise tel quel : la bonne réponse ne relance plus un
  // classement qui pourrait aboutir à une autre branche de la mémoire.
  if (!solarSystemId || !starId) {
    try {
      const storedPlacement = await validateStoredCultureGeneralePlacement(question.sourcePlacement);
      if (storedPlacement) {
        solarSystemId = storedPlacement.solarSystemId;
        starId = storedPlacement.starId;
      }
    } catch (error) {
      console.warn("[daily quiz eclairage acquisitions] failed : validation placement QCM —", error.message);
    }
  }

  if (!solarSystemId || !starId) {
    // Même moteur fusionné que classifyCultureGeneraleKnowledgePlacementWithAI
    // (correctif du 16/08/2026) : 1 appel MATCH Galaxy+Solar, 1 second appel
    // seulement sur no_match — jamais deux appels séparés Galaxy puis Solar.
    const userSolarsForFallback = await fetchUserActiveKnowledgeSolars(user.id);
    const match = await matchCultureGeneraleGalaxyAndSolarWithAI(sourceType, sourceName, question.sourceDetail, userSolarsForFallback);
    const galaxy = match?.galaxy || null;
    // Best-effort, jamais bloquant — mais toujours tracé : un échec de
    // classification silencieux (catégorie IA non reconnue, appel réseau
    // en échec) est indiscernable d'un succès sans ce log (constaté en
    // pratique le 09/08/2026, plusieurs tentatives sans aucune trace).
    if (!galaxy) {
      console.warn(`[daily quiz eclairage acquisitions] classification abandonnée : sourceType=${sourceType} sourceDebateId=${sourceDebateId}`);
      return;
    }

    const { data: userStarRowsFallback } = await supabase
      .from("user_article_acquisitions")
      .select("star_id")
      .eq("user_id", user.id)
      .not("star_id", "is", null);
    const userStarActivationsFallback = (userStarRowsFallback || []).map((r) => ({ starId: r.star_id }));

    if (match.decision === "existing") {
      // Chemin reuse : 1 seul appel IA total (celui du MATCH), Étoile
      // résolue déterministement — même logique que
      // classifyCultureGeneraleKnowledgePlacementWithAI.
      solarSystemId = match.solarId;
      const matchedSolar = match.candidates.find((c) => c.id === solarSystemId);
      const { data: existingStarsRows } = await supabase.from("stars").select("id, name, solar_system_id").eq("solar_system_id", solarSystemId);
      const scopedStars = filterUserActiveStars(
        (existingStarsRows || []).map((s) => ({ id: s.id, name: s.name, solarSystemId: s.solar_system_id })),
        userStarActivationsFallback,
        solarSystemId
      );
      const existingStarMatch = matchExistingStarByLabel(match.starLabel, scopedStars);
      if (existingStarMatch) {
        starId = existingStarMatch;
      } else {
        const starGate = validateStarLabelCandidate({ label: match.starLabel, solarName: matchedSolar?.name });
        const finalLabel = starGate.ok ? match.starLabel : sourceName;
        starId = await resolveOrCreateStar(solarSystemId, finalLabel, normalizeStarName(finalLabel));
      }
    } else {
      // Chemin create : 2 appels IA total (MATCH + création Solar+Étoile ensemble).
      const created = await resolveCultureGeneraleSolarSystemWithAI(galaxy, sourceType, sourceName, question.sourceDetail, match.candidates);
      if (!created?.solarSystemId) {
        console.warn(`[daily quiz eclairage acquisitions] système solaire non résolu : galaxy=${galaxy} sourceDebateId=${sourceDebateId}`);
        return;
      }
      solarSystemId = created.solarSystemId;
      starId = created.starId;
      if (!starId) {
        const { data: fallbackSolarRow } = await supabase.from("solar_systems").select("name").eq("id", solarSystemId).maybeSingle();
        starId = await resolveCultureGeneraleStarWithAI(galaxy, solarSystemId, fallbackSolarRow?.name || sourceName, sourceType, sourceName, question.sourceDetail, userStarActivationsFallback);
      }
    }
    if (!solarSystemId) {
      console.warn(`[daily quiz eclairage acquisitions] système solaire non résolu : galaxy=${galaxy} sourceDebateId=${sourceDebateId}`);
      return;
    }
    if (!starId) {
      console.warn(`[daily quiz eclairage acquisitions] étoile non résolue : galaxy=${galaxy} solarSystemId=${solarSystemId} sourceDebateId=${sourceDebateId}`);
      return;
    }
  }

  try {
    const { error } = await supabase
      .from("user_article_acquisitions")
      .upsert(
        {
          user_id: user.id,
          eclairage_type: sourceType,
          eclairage_source_id: sourceDebateId,
          eclairage_name: sourceName.slice(0, 300),
          eclairage_detail: flattenCultureGeneraleDetail(question.sourceDetail).slice(0, 2000) || null,
          solar_system_id: solarSystemId,
          star_id: starId
        },
        { onConflict: "user_id,eclairage_type,eclairage_source_id", ignoreDuplicates: true }
      );
    if (error) throw error;
    console.log(`[daily quiz eclairage acquisitions] user=${user.id} sourceType=${sourceType} sourceDebateId=${sourceDebateId}`);

    // Le Solar rejoint "l'univers actif" de CET utilisateur à cet instant —
    // jamais à la génération du QCM (§7/§8 du plan : le coût et le périmètre
    // de classification ne doivent dépendre que des connaissances réellement
    // acquises, pas de tout ce qui a été généré). C'est ce qui rend candidat
    // ce Solar pour les PROCHAINES classifications de cet utilisateur (cf.
    // fetchUserActiveKnowledgeSolars) — sans effet rétroactif sur les
    // classifications déjà faites. best-effort : un échec ici ne doit jamais
    // empêcher l'acquisition elle-même d'être enregistrée (déjà faite ci-dessus).
    if (solarSystemId) {
      const { error: activationError } = await supabase
        .from("user_solar_activations")
        .upsert({ user_id: user.id, solar_system_id: solarSystemId }, { onConflict: "user_id,solar_system_id", ignoreDuplicates: true });
      if (activationError) console.warn("[daily quiz eclairage acquisitions] failed : activation solar —", activationError.message);
    }

    // knowledge_nodes (moteur "À apprendre ensuite", section 12) : cette
    // acquisition est garantie NOUVELLE (le early-return "Déjà acquis"
    // plus haut a déjà écarté toute répétition), l'incrément est donc sûr.
    // Best-effort : ne bloque jamais l'acquisition elle-même, déjà actée.
    await bestEffortUpsertKnowledgeNode({
      type: sourceType,
      sourceId: sourceDebateId,
      name: sourceName,
      solarSystemId,
      starId,
      incrementAcquisition: true
    });
    // Le prochain calcul de "À apprendre ensuite" pour CET utilisateur doit
    // refléter ce nouvel acquis (ZPD/connexions recalculés) — jamais les
    // caches des autres utilisateurs.
    invalidateLearnNextRecommendations(legacyKey);

    // La connaissance existe désormais réellement dans la mémoire. C'est à
    // cet instant précis — première bonne réponse, jamais à la création du
    // QCM — que l'IA examine tous les autres acquis de cet utilisateur.
    await findAndStoreCultureGeneraleNotionLink(
      sourceType,
      sourceDebateId,
      sourceName,
      question.sourceDetail,
      user.id
    );
  } catch (error) {
    console.warn("[daily quiz eclairage acquisitions] failed : écriture acquisition —", error.message);
  }
}

// gradeQuizSubmissionOptionIndex (factorisée entre POST /answer et POST
// /practice-answer) vit désormais dans lib/question-formats.js — mêmes
// règles de correction, cf. import en haut du fichier.

app.post("/api/daily-quiz/answer", rateLimit("daily-quiz-answer", 60), async (req, res) => {
  try {
    const voterKey = String(req.body?.voterKey || "").trim();
    const questionId = String(req.body?.questionId || "").trim();
    const slot = String(req.body?.slot || "").trim();
    if (!voterKey || !questionId || !isValidDailyQuizSlot(slot)) {
      return res.status(400).json({ error: "Requête invalide." });
    }

    const todayKey = resolveDailyQuizRequestDate(slot, req.body?.quizDate);
    // Indépendantes l'une de l'autre : parallélisées plutôt qu'attendues en
    // séquence (questions quasi toujours servies depuis le cache mémoire,
    // donc en pratique un seul aller-retour Supabase réel ici, pas deux).
    const [questions, existingAnswerResult] = await Promise.all([
      getDailyQuizQuestions(todayKey, slot, voterKey),
      supabase.from("daily_quiz_answers").select("option_index")
        .eq("quiz_date", todayKey).eq("voter_key", voterKey).eq("question_id", questionId).maybeSingle()
    ]);
    const question = questions.find((q) => q.id === questionId);
    if (!question) return res.status(404).json({ error: "QCM introuvable." });

    if (existingAnswerResult.error) throw new Error(existingAnswerResult.error.message);
    const existingAnswer = existingAnswerResult.data;

    const questionType = question.type || "qcm";
    const optionIndex = gradeQuizSubmissionOptionIndex(question, req.body);
    if (optionIndex === null) return res.status(400).json({ error: "Requête invalide." });
    // Difficulté ressentie (demande du 13/08/2026, boutons Facile/Moyen/
    // Difficile qui remplacent "Valider ma réponse" côté client — validation
    // et notation de la difficulté en un seul geste) : influence l'intervalle
    // de la prochaine repasse, cf. isCultureGeneraleReviewDueToday. Absente
    // ou invalide (ancien client, "Renforcement" pas encore mis à jour...) :
    // null, jamais bloquant, traité comme "moyen" (neutre) au calcul.
    const rawDifficulty = String(req.body?.difficulty || "").trim();
    const difficulty = ["facile", "moyen", "difficile"].includes(rawDifficulty) ? rawDifficulty : null;

    let finalOptionIndex = optionIndex;
    let isNewAnswer = false;
    if (existingAnswer) {
      finalOptionIndex = existingAnswer.option_index;
    } else {
      const { error: insertError } = await supabase.from("daily_quiz_answers").insert({
        quiz_date: todayKey,
        voter_key: voterKey,
        question_id: questionId,
        option_index: optionIndex,
        difficulty
      });
      if (insertError) {
        if (insertError.code === "23505") {
          const { data: raceRow } = await supabase
            .from("daily_quiz_answers")
            .select("option_index")
            .eq("quiz_date", todayKey)
            .eq("voter_key", voterKey)
            .eq("question_id", questionId)
            .maybeSingle();
          finalOptionIndex = raceRow?.option_index ?? optionIndex;
        } else {
          throw new Error(insertError.message);
        }
      } else {
        _dailyQuizStatsCache.delete(`${todayKey}:${questionId}`);
        isNewAnswer = true;
        // Nouvelle réponse : "Ma mémoire" (fiche/quizDate/slot affichés pour les notions déjà
        // acquises) peut en dépendre, cf. fetchUserCultureGeneraleAnswerEvents.
        invalidateIntellectualUniverseCache(voterKey);
      }
    }

    const { stats, total } = await getDailyQuizStats(todayKey, questionId);
    const correct = finalOptionIndex === question.correctIndex;
    res.json({
      correct,
      correctIndex: question.correctIndex,
      explanation: question.explanation,
      optionIndex: finalOptionIndex,
      stats,
      totalAnswers: total,
      // Réveil de la vraie réponse uniquement une fois soumise — jamais
      // avant (cf. GET /today, qui ne renvoie ni pairs, ni correctIndexes,
      // ni items dans leur vrai ordre).
      ...(questionType === "association" ? { pairs: question.pairs } : {}),
      ...(questionType === "qcm_multi" ? { correctIndexes: question.correctIndexes } : {}),
      ...(questionType === "ordre" ? { items: question.items } : {})
    });

    // Univers intellectuel : conséquence secondaire de la réponse, jamais sur le chemin
    // critique — la réponse HTTP est déjà partie. Réservé au QCM Culture générale (le QCM
    // actu n'alimente plus Mon univers), reconnu par le préfixe de l'id désormais que les
    // deux types de questions partagent le même slot "daily".
    if (correct && isCultureGeneraleQuestionId(question.id) && question.sourceDebateId) {
      recordDailyQuizEclairageAcquisition(voterKey, question)
        .then(() => invalidateIntellectualUniverseCache(voterKey))
        .catch((error) => console.warn("[daily quiz eclairage acquisitions] failed :", error.message));
    }

    // État FSRS (cf. lib/spaced-repetition/) : uniquement sur une réponse
    // RÉELLEMENT nouvelle (jamais un simple re-fetch d'une réponse déjà
    // enregistrée, jamais la version perdante d'une course d'insertion) et
    // uniquement dans le périmètre "notion:%"/"cgreview-*" (cf.
    // applyFsrsReviewForDailyQuizAnswer). Conséquence secondaire, jamais sur
    // le chemin critique — la réponse HTTP est déjà partie.
    if (isNewAnswer) {
      applyFsrsReviewForDailyQuizAnswer({ voterKey, slot, quizDate: todayKey, questionId, isCorrect: correct, difficulty })
        .then(() => invalidateIntellectualUniverseCache(voterKey))
        .catch((error) => console.warn("[fsrs review] failed :", error.message));
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rejoue la réponse qui vient d'être enregistrée dans daily_quiz_answers vers
// memory_item_fsrs_states/memory_review_events (cf. lib/spaced-repetition/).
// Indépendant de l'objet `question` déjà résolu côté appelant (potentiellement
// déjà basculé sur son altVariant, cf. resolveActiveQuestionVariant) : relit
// toujours le contenu canonique depuis daily_quiz pour rester correct quelle
// que soit la variante affichée à l'utilisateur.
async function applyFsrsReviewForDailyQuizAnswer({ voterKey, slot, quizDate, questionId, isCorrect, difficulty }) {
  let memoryItemRow = null;
  if (questionId.startsWith("notion:")) {
    memoryItemRow = await upsertMemoryItemForNotionAnswer({ slot, quizDate, questionId });
  } else if (questionId.startsWith("cgreview-")) {
    // "Dernière génération gagne" (même convention que la réutilisation d'un
    // sujet libre déjà généré, cf. POST /api/users/notion-quizzes/custom) :
    // en usage normal un (slot, question_id) donné n'a qu'un seul memory_item,
    // ce choix ne s'applique qu'au cas rare d'une régénération de sujet libre.
    const ref = questionId.slice("cgreview-".length);
    const { data, error } = await supabase.from("memory_items")
      .select("id, slot, quiz_date, question_id")
      .eq("question_id", ref)
      .order("quiz_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    memoryItemRow = data;
  } else if (questionId.startsWith("comprendre:")) {
    // Le `slot` transmis par le client est le pseudo-slot agrégateur "comprendre" (jusqu'à 6
    // questions puisées dans plusieurs liens différents en une seule session, cf.
    // fetchCultureGeneraleComprehensionQuestions) — jamais le vrai slot par paire où la question
    // vit réellement dans daily_quiz (cf. cultureGeneraleComprehensionQuizSlot). On le
    // reconstruit depuis le questionId lui-même (comprendre:{pairHash}-q{n}), seule source
    // fiable ici pour retrouver la bonne ligne.
    const pairMatch = /^comprendre:([0-9a-f]{20})-q\d+$/.exec(questionId);
    if (!pairMatch) return;
    var comprehensionPairSlot = `notion:comprendre:${pairMatch[1]}`;
    // `quizDate` (toujours "aujourd'hui" pour ce pseudo-slot agrégateur, cf.
    // resolveDailyQuizRequestDate) ne correspond pas forcément à la vraie date de la ligne :
    // contrairement aux autres notion quizzes, celle d'un lien "comprendre" peut avoir été
    // générée un jour précédent puis simplement relue depuis (cf.
    // ensureCultureGeneraleComprehensionQuizPersisted, jamais régénérée tant qu'une ligne existe
    // déjà pour ce slot). On la relit par slot seul avant de chercher le memory_item.
    const { data: comprehensionQuizRow, error: comprehensionQuizRowError } = await supabase
      .from("daily_quiz").select("quiz_date").eq("slot", comprehensionPairSlot)
      .order("quiz_date", { ascending: false }).limit(1).maybeSingle();
    if (comprehensionQuizRowError) throw comprehensionQuizRowError;
    if (!comprehensionQuizRow) return;
    memoryItemRow = await upsertMemoryItemForNotionAnswer({ slot: comprehensionPairSlot, quizDate: comprehensionQuizRow.quiz_date, questionId });
  } else {
    return; // hors périmètre FSRS (question actu, ancien slot hors "notion:%")
  }
  if (!memoryItemRow) return;

  const { data: quizRow, error: quizRowError } = await supabase.from("daily_quiz")
    .select("questions").eq("quiz_date", memoryItemRow.quiz_date).eq("slot", memoryItemRow.slot).maybeSingle();
  if (quizRowError) throw quizRowError;
  const canonicalQuestion = (quizRow?.questions || []).find((q) => q.id === memoryItemRow.question_id);
  if (!canonicalQuestion) return; // ne devrait pas arriver pour un slot "notion:%" (jamais purgé)

  const { user } = await resolveLegacyUser(supabase, voterKey);

  // Une question "Comprendre les liens" réussie ajoute automatiquement le lien à "Découvrir"
  // (demande du 16/08/2026) : contrairement aux autres notions, il n'existe pas de bouton
  // "Mémoriser" pour un lien détecté entre deux connaissances — seule une bonne réponse vaut
  // adoption. upsert + ignoreDuplicates : ne recrée rien aux bonnes réponses suivantes du même
  // lien (jusqu'à 6 questions par lien).
  if (typeof comprehensionPairSlot !== "undefined" && isCorrect) {
    const { error: comprehensionLinkError } = await supabase.from("user_notion_quizzes").upsert(
      { user_id: user.id, quiz_date: memoryItemRow.quiz_date, slot: comprehensionPairSlot },
      { onConflict: "user_id,quiz_date,slot", ignoreDuplicates: true }
    );
    if (comprehensionLinkError) console.warn("[comprendre] ajout à Découvrir échoué :", comprehensionLinkError.message);
  }

  const { data: existingStateRow, error: stateError } = await supabase.from("memory_item_fsrs_states")
    .select("*").eq("user_id", user.id).eq("memory_item_id", memoryItemRow.id).maybeSingle();
  if (stateError) throw stateError;

  const currentState = existingStateRow ? {
    due: new Date(existingStateRow.due_at),
    stability: existingStateRow.stability,
    difficulty: existingStateRow.difficulty,
    scheduledDays: existingStateRow.scheduled_days,
    learningSteps: existingStateRow.learning_steps,
    reps: existingStateRow.reps,
    lapses: existingStateRow.lapses,
    state: existingStateRow.state,
    lastReviewAt: existingStateRow.last_review_at ? new Date(existingStateRow.last_review_at) : null
  } : null;

  const rating = mapMnoriaReviewToFsrsRating({ isCorrect, perceivedDifficulty: difficulty });
  const now = new Date();
  const { nextState, elapsedDays, schedulerModelId } = reviewMemoryItem({ currentState, rating, now });
  const questionVariant = resolveQuestionVariantLabel(canonicalQuestion, currentState ? currentState.reps : 0);

  const { error: eventError } = await supabase.from("memory_review_events").insert({
    user_id: user.id,
    memory_item_id: memoryItemRow.id,
    question_variant: questionVariant,
    is_correct: isCorrect,
    perceived_difficulty: difficulty,
    rating,
    elapsed_days: elapsedDays,
    due_at: nextState.due.toISOString(),
    stability_after: nextState.stability,
    difficulty_after: nextState.difficulty,
    scheduler_model_id: schedulerModelId,
    reviewed_at: now.toISOString()
  });
  // 23505 : doublon idempotent (retry réseau du fire-and-forget côté client
  // ou du serveur), jamais une vraie erreur — cf. UNIQUE (user_id,
  // memory_item_id, reviewed_at).
  if (eventError && eventError.code !== "23505") throw eventError;

  const { error: upsertError } = await supabase.from("memory_item_fsrs_states").upsert({
    user_id: user.id,
    memory_item_id: memoryItemRow.id,
    state: nextState.state,
    due_at: nextState.due.toISOString(),
    stability: nextState.stability,
    difficulty: nextState.difficulty,
    scheduled_days: nextState.scheduledDays,
    learning_steps: nextState.learningSteps,
    reps: nextState.reps,
    lapses: nextState.lapses,
    last_review_at: nextState.lastReviewAt ? nextState.lastReviewAt.toISOString() : null,
    scheduler_model_id: schedulerModelId,
    updated_at: now.toISOString()
  }, { onConflict: "user_id,memory_item_id" });
  if (upsertError) throw upsertError;
}

async function upsertMemoryItemForNotionAnswer({ slot, quizDate, questionId }) {
  const { data: quizRow, error: quizRowError } = await supabase.from("daily_quiz")
    .select("questions").eq("quiz_date", quizDate).eq("slot", slot).maybeSingle();
  if (quizRowError) throw quizRowError;
  const question = (quizRow?.questions || []).find((q) => q.id === questionId);
  if (!question || !question.sourceType || !question.sourceDebateId) return null;

  const naturalKey = buildMemoryItemNaturalKey({ slot, quizDate, questionId });
  const { data, error } = await supabase.from("memory_items")
    .upsert({
      natural_key: naturalKey,
      subject_type: question.sourceType,
      subject_source_id: String(question.sourceDebateId),
      slot,
      quiz_date: quizDate,
      question_id: questionId
    }, { onConflict: "natural_key" })
    .select("id, slot, quiz_date, question_id")
    .single();
  if (error) throw error;
  return data;
}

// "Refaire" (cf. views/qcm-du-jour.html renderFinalScore/quizAnswerEndpoint,
// demande du 13/08/2026) : rejoue un QCM déjà terminé avec de vraies
// nouvelles réponses, gradées exactement comme POST /answer (même
// gradeQuizSubmissionOptionIndex), mais SANS JAMAIS écrire dans
// daily_quiz_answers — la seule table dont dépendent l'état FSRS
// (memory_item_fsrs_states, cf. applyFsrsReviewForDailyQuizAnswer) et le
// score Gnosis. Rien n'est persisté ⇒ rien ne
// peut compter, par construction, plutôt que de dépendre d'un filtrage a
// posteriori. Jamais d'appel à recordDailyQuizEclairageAcquisition non plus,
// pour la même raison (n'accorderait un acquis "Ma mémoire" que sur la base
// d'une réponse qui n'existe nulle part en base).
app.post("/api/daily-quiz/practice-answer", rateLimit("daily-quiz-answer", 60), async (req, res) => {
  try {
    const voterKey = String(req.body?.voterKey || "").trim();
    const questionId = String(req.body?.questionId || "").trim();
    const slot = String(req.body?.slot || "").trim();
    if (!voterKey || !questionId || !isValidDailyQuizSlot(slot)) {
      return res.status(400).json({ error: "Requête invalide." });
    }

    const todayKey = resolveDailyQuizRequestDate(slot, req.body?.quizDate);
    const questions = await getDailyQuizQuestions(todayKey, slot, voterKey);
    const question = questions.find((q) => q.id === questionId);
    if (!question) return res.status(404).json({ error: "QCM introuvable." });

    const questionType = question.type || "qcm";
    const optionIndex = gradeQuizSubmissionOptionIndex(question, req.body);
    if (optionIndex === null) return res.status(400).json({ error: "Requête invalide." });

    // Stats réelles (autres visiteurs) affichées à titre indicatif — lecture
    // seule, jamais affectées par une réponse d'entraînement non persistée.
    const { stats, total } = await getDailyQuizStats(todayKey, questionId);
    res.json({
      correct: optionIndex === question.correctIndex,
      correctIndex: question.correctIndex,
      explanation: question.explanation,
      optionIndex,
      stats,
      totalAnswers: total,
      ...(questionType === "association" ? { pairs: question.pairs } : {}),
      ...(questionType === "qcm_multi" ? { correctIndexes: question.correctIndexes } : {}),
      ...(questionType === "ordre" ? { items: question.items } : {})
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// "Ne plus me la demander" (cf. views/qcm-du-jour.html wireExcludeButton) —
// demande du 12/08/2026 : l'utilisateur sait déjà la réponse ou n'est plus
// intéressé par cette question précise, elle ne doit plus jamais réapparaître
// dans ses repasses de répétition espacée ("Renforcement"). N'affecte jamais
// la session de QCM en cours (chaque question n'y apparaît qu'une fois de
// toute façon) — seul fetchCultureGeneraleReviewInjectionForToday consulte
// cette table, cf. plus bas. `questionId` peut arriver préfixé "cgreview-"
// si l'exclusion est cliquée pendant une repasse : normalisé ici vers l'id
// canonique, le seul utilisé par memory_items.question_id/les événements de
// réponse (cf. fetchUserCultureGeneraleAnswerEvents).
app.post("/api/daily-quiz/exclude-question", rateLimit("users", 30), async (req, res) => {
  try {
    const validation = validateLegacyKey(req.body?.legacyKey);
    if (validation.error) return res.status(400).json({ ok: false, error: validation.error });
    const questionId = String(req.body?.questionId || "").trim().replace(/^cgreview-/, "");
    if (!questionId || questionId.length > 200) return res.status(400).json({ ok: false, error: "Requête invalide." });

    const { error } = await supabase.from("user_question_exclusions").upsert(
      { voter_key: validation.legacyKey, question_id: questionId },
      { onConflict: "voter_key,question_id", ignoreDuplicates: true }
    );
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (error) {
    console.error("[daily-quiz] exclusion question :", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/apprentissage", (req, res) => {
  // Cette page évolue souvent et embarque directement son interface/sa logique.
  // Ne jamais laisser le navigateur conserver cinq minutes une ancienne version
  // (accordéons, pagination, fiche QCM) après un déploiement.
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
    .sendFile(path.join(__dirname, "views/qcm-du-jour.html"));
});

// L'ancienne page Connaissances n'existe plus comme destination autonome.
// Les anciens liens profonds conservent néanmoins leurs paramètres QCM.
app.get("/qcm-du-jour", (req, res) => {
  const queryIndex = req.originalUrl.indexOf("?");
  const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";
  res.redirect(301, `/apprentissage${query}`);
});

// Univers intellectuel personnel — page autonome (cf. views/mon-univers.html), même modèle
// exact que /qcm-du-jour et /parallele-historique ci-dessous.
app.get("/mon-univers", (req, res) => {
  res.set("Cache-Control", "public, max-age=300").sendFile(path.join(__dirname, "views/mon-univers.html"));
});

// Parallèle historique du jour — page autonome (cf. views/parallele-historique.html).
app.get("/parallele-historique", (req, res) => {
  res.set("Cache-Control", "public, max-age=300").sendFile(path.join(__dirname, "views/parallele-historique.html"));
});

// Route publique : renvoie le contenu du jour s'il existe déjà, sinon
// déclenche sa génération (verrou anti-concurrence géré par le module).
app.get("/api/parallele-historique/today", rateLimit("parallele-historique-today", 60), async (req, res) => {
  try {
    const result = await paralleleHistoriqueService.generateIfNeeded(new Date());
    res.json(result);
  } catch (error) {
    console.error("[parallele-historique] /today :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Menu "jours précédents" du frontend : liste des dates réellement publiées,
// les plus récentes d'abord.
app.get("/api/parallele-historique/dates", rateLimit("parallele-historique-dates", 60), async (req, res) => {
  try {
    const dates = await paralleleHistoriqueService.listPublishedDates();
    res.json({ dates });
  } catch (error) {
    console.error("[parallele-historique] /dates :", error.message);
    res.status(500).json({ dates: [], error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Consultation d'une date précise (lecture seule, jamais de génération —
// cf. getByDate). Placée après /today et /dates pour ne jamais leur faire
// de l'ombre dans le routage Express.
app.get("/api/parallele-historique/:date", rateLimit("parallele-historique-date", 60), async (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ status: "failed", error: "Date invalide, format attendu AAAA-MM-JJ." });
    return;
  }
  try {
    const result = await paralleleHistoriqueService.getByDate(date);
    res.json(result);
  } catch (error) {
    console.error("[parallele-historique] /:date :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Déclenchement manuel réservé à l'admin (tests / retry) : force une
// nouvelle génération même si un contenu existe déjà pour aujourd'hui.
app.post("/api/parallele-historique/generate", requireAdmin, rateLimit("parallele-historique-generate", 10), async (req, res) => {
  try {
    const result = await paralleleHistoriqueService.generateIfNeeded(new Date(), { force: true });
    res.json(result);
  } catch (error) {
    console.error("[parallele-historique] /generate :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Pensée philosophique du jour — page autonome (cf. views/pensee-philosophique.html).
app.get("/pensee-philosophique", (req, res) => {
  res.set("Cache-Control", "public, max-age=300").sendFile(path.join(__dirname, "views/pensee-philosophique.html"));
});

// Éclairages — page unique regroupant le parallèle historique et la pensée
// philosophique du jour (cf. views/eclairages.html), point d'entrée depuis
// l'accueil. /parallele-historique et /pensee-philosophique restent
// accessibles telles quelles (liens directs éventuels), mais ne sont plus
// liées depuis l'accueil.
app.get("/eclairages", (req, res) => {
  res.set("Cache-Control", "public, max-age=300").sendFile(path.join(__dirname, "views/eclairages.html"));
});

// Route publique : renvoie le contenu du jour s'il existe déjà, sinon
// déclenche sa génération (verrou anti-concurrence géré par le module).
app.get("/api/pensee-philosophique/today", rateLimit("pensee-philosophique-today", 60), async (req, res) => {
  try {
    const result = await penseePhilosophiqueService.generateIfNeeded(new Date());
    res.json(result);
  } catch (error) {
    console.error("[pensee-philosophique] /today :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Menu "jours précédents" du frontend : liste des dates réellement publiées,
// les plus récentes d'abord.
app.get("/api/pensee-philosophique/dates", rateLimit("pensee-philosophique-dates", 60), async (req, res) => {
  try {
    const dates = await penseePhilosophiqueService.listPublishedDates();
    res.json({ dates });
  } catch (error) {
    console.error("[pensee-philosophique] /dates :", error.message);
    res.status(500).json({ dates: [], error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Consultation d'une date précise (lecture seule, jamais de génération —
// cf. getByDate). Placée après /today et /dates pour ne jamais leur faire
// de l'ombre dans le routage Express.
app.get("/api/pensee-philosophique/:date", rateLimit("pensee-philosophique-date", 60), async (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ status: "failed", error: "Date invalide, format attendu AAAA-MM-JJ." });
    return;
  }
  try {
    const result = await penseePhilosophiqueService.getByDate(date);
    res.json(result);
  } catch (error) {
    console.error("[pensee-philosophique] /:date :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Déclenchement manuel réservé à l'admin (tests / retry) : force une
// nouvelle génération même si un contenu existe déjà pour aujourd'hui.
app.post("/api/pensee-philosophique/generate", requireAdmin, rateLimit("pensee-philosophique-generate", 10), async (req, res) => {
  try {
    const result = await penseePhilosophiqueService.generateIfNeeded(new Date(), { force: true });
    res.json(result);
  } catch (error) {
    console.error("[pensee-philosophique] /generate :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Mécanisme sociologique du jour — page autonome (cf. views/mecanisme-sociologique.html).
app.get("/mecanisme-sociologique", (req, res) => {
  res.set("Cache-Control", "public, max-age=300").sendFile(path.join(__dirname, "views/mecanisme-sociologique.html"));
});

// Route publique : renvoie le contenu du jour s'il existe déjà, sinon
// déclenche sa génération (verrou anti-concurrence géré par le module).
app.get("/api/mecanisme-sociologique/today", rateLimit("mecanisme-sociologique-today", 60), async (req, res) => {
  try {
    const result = await mecanismeSociologiqueService.generateIfNeeded(new Date());
    res.json(result);
  } catch (error) {
    console.error("[mecanisme-sociologique] /today :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Menu "jours précédents" du frontend : liste des dates réellement publiées,
// les plus récentes d'abord.
app.get("/api/mecanisme-sociologique/dates", rateLimit("mecanisme-sociologique-dates", 60), async (req, res) => {
  try {
    const dates = await mecanismeSociologiqueService.listPublishedDates();
    res.json({ dates });
  } catch (error) {
    console.error("[mecanisme-sociologique] /dates :", error.message);
    res.status(500).json({ dates: [], error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Consultation d'une date précise (lecture seule, jamais de génération —
// cf. getByDate). Placée après /today et /dates pour ne jamais leur faire
// de l'ombre dans le routage Express.
app.get("/api/mecanisme-sociologique/:date", rateLimit("mecanisme-sociologique-date", 60), async (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ status: "failed", error: "Date invalide, format attendu AAAA-MM-JJ." });
    return;
  }
  try {
    const result = await mecanismeSociologiqueService.getByDate(date);
    res.json(result);
  } catch (error) {
    console.error("[mecanisme-sociologique] /:date :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Déclenchement manuel réservé à l'admin (tests / retry) : force une
// nouvelle génération même si un contenu existe déjà pour aujourd'hui.
app.post("/api/mecanisme-sociologique/generate", requireAdmin, rateLimit("mecanisme-sociologique-generate", 10), async (req, res) => {
  try {
    const result = await mecanismeSociologiqueService.generateIfNeeded(new Date(), { force: true });
    res.json(result);
  } catch (error) {
    console.error("[mecanisme-sociologique] /generate :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Concept du jour — page autonome (cf. views/concept-du-jour.html).
app.get("/concept-du-jour", (req, res) => {
  res.set("Cache-Control", "public, max-age=300").sendFile(path.join(__dirname, "views/concept-du-jour.html"));
});

// Route publique : renvoie le contenu du jour s'il existe déjà, sinon
// déclenche sa génération (verrou anti-concurrence géré par le module).
app.get("/api/concept-du-jour/today", rateLimit("concept-du-jour-today", 60), async (req, res) => {
  try {
    const result = await conceptDuJourService.generateIfNeeded(new Date());
    res.json(result);
  } catch (error) {
    console.error("[concept-du-jour] /today :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Menu "jours précédents" du frontend : liste des dates réellement publiées,
// les plus récentes d'abord.
app.get("/api/concept-du-jour/dates", rateLimit("concept-du-jour-dates", 60), async (req, res) => {
  try {
    const dates = await conceptDuJourService.listPublishedDates();
    res.json({ dates });
  } catch (error) {
    console.error("[concept-du-jour] /dates :", error.message);
    res.status(500).json({ dates: [], error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Consultation d'une date précise (lecture seule, jamais de génération —
// cf. getByDate). Placée après /today et /dates pour ne jamais leur faire
// de l'ombre dans le routage Express.
app.get("/api/concept-du-jour/:date", rateLimit("concept-du-jour-date", 60), async (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ status: "failed", error: "Date invalide, format attendu AAAA-MM-JJ." });
    return;
  }
  try {
    const result = await conceptDuJourService.getByDate(date);
    res.json(result);
  } catch (error) {
    console.error("[concept-du-jour] /:date :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Déclenchement manuel réservé à l'admin (tests / retry) : force une
// nouvelle génération même si un contenu existe déjà pour aujourd'hui.
app.post("/api/concept-du-jour/generate", requireAdmin, rateLimit("concept-du-jour-generate", 10), async (req, res) => {
  try {
    const result = await conceptDuJourService.generateIfNeeded(new Date(), { force: true });
    res.json(result);
  } catch (error) {
    console.error("[concept-du-jour] /generate :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Citation du jour — page autonome (cf. views/citation-du-jour.html).
app.get("/citation-du-jour", (req, res) => {
  res.set("Cache-Control", "public, max-age=300").sendFile(path.join(__dirname, "views/citation-du-jour.html"));
});

// Route publique : renvoie le contenu du jour s'il existe déjà, sinon
// déclenche sa génération (verrou anti-concurrence géré par le module).
app.get("/api/citation-du-jour/today", rateLimit("citation-du-jour-today", 60), async (req, res) => {
  try {
    const result = await citationDuJourService.generateIfNeeded(new Date());
    res.json(result);
  } catch (error) {
    console.error("[citation-du-jour] /today :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Menu "jours précédents" du frontend : liste des dates réellement publiées,
// les plus récentes d'abord.
app.get("/api/citation-du-jour/dates", rateLimit("citation-du-jour-dates", 60), async (req, res) => {
  try {
    const dates = await citationDuJourService.listPublishedDates();
    res.json({ dates });
  } catch (error) {
    console.error("[citation-du-jour] /dates :", error.message);
    res.status(500).json({ dates: [], error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Consultation d'une date précise (lecture seule, jamais de génération —
// cf. getByDate). Placée après /today et /dates pour ne jamais leur faire
// de l'ombre dans le routage Express.
app.get("/api/citation-du-jour/:date", rateLimit("citation-du-jour-date", 60), async (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ status: "failed", error: "Date invalide, format attendu AAAA-MM-JJ." });
    return;
  }
  try {
    const result = await citationDuJourService.getByDate(date);
    res.json(result);
  } catch (error) {
    console.error("[citation-du-jour] /:date :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Déclenchement manuel réservé à l'admin (tests / retry) : force une
// nouvelle génération même si un contenu existe déjà pour aujourd'hui.
app.post("/api/citation-du-jour/generate", requireAdmin, rateLimit("citation-du-jour-generate", 10), async (req, res) => {
  try {
    const result = await citationDuJourService.generateIfNeeded(new Date(), { force: true });
    res.json(result);
  } catch (error) {
    console.error("[citation-du-jour] /generate :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Œuvre d'art du jour — page autonome (cf. views/oeuvre-art-du-jour.html).
app.get("/oeuvre-art-du-jour", (req, res) => {
  res.set("Cache-Control", "public, max-age=300").sendFile(path.join(__dirname, "views/oeuvre-art-du-jour.html"));
});

// Route publique : renvoie le contenu du jour s'il existe déjà, sinon
// déclenche sa génération (verrou anti-concurrence géré par le module).
app.get("/api/oeuvre-art-du-jour/today", rateLimit("oeuvre-art-du-jour-today", 60), async (req, res) => {
  try {
    const result = await oeuvreArtDuJourService.generateIfNeeded(new Date());
    res.json(result);
  } catch (error) {
    console.error("[oeuvre-art-du-jour] /today :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Menu "jours précédents" du frontend : liste des dates réellement publiées,
// les plus récentes d'abord.
app.get("/api/oeuvre-art-du-jour/dates", rateLimit("oeuvre-art-du-jour-dates", 60), async (req, res) => {
  try {
    const dates = await oeuvreArtDuJourService.listPublishedDates();
    res.json({ dates });
  } catch (error) {
    console.error("[oeuvre-art-du-jour] /dates :", error.message);
    res.status(500).json({ dates: [], error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Consultation d'une date précise (lecture seule, jamais de génération —
// cf. getByDate). Placée après /today et /dates pour ne jamais leur faire
// de l'ombre dans le routage Express.
app.get("/api/oeuvre-art-du-jour/:date", rateLimit("oeuvre-art-du-jour-date", 60), async (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ status: "failed", error: "Date invalide, format attendu AAAA-MM-JJ." });
    return;
  }
  try {
    const result = await oeuvreArtDuJourService.getByDate(date);
    res.json(result);
  } catch (error) {
    console.error("[oeuvre-art-du-jour] /:date :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Déclenchement manuel réservé à l'admin (tests / retry) : force une
// nouvelle génération même si un contenu existe déjà pour aujourd'hui.
app.post("/api/oeuvre-art-du-jour/generate", requireAdmin, rateLimit("oeuvre-art-du-jour-generate", 10), async (req, res) => {
  try {
    const result = await oeuvreArtDuJourService.generateIfNeeded(new Date(), { force: true });
    res.json(result);
  } catch (error) {
    console.error("[oeuvre-art-du-jour] /generate :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Mot latin du jour — page autonome (cf. views/latin-du-jour.html).
app.get("/latin-du-jour", (req, res) => {
  res.set("Cache-Control", "public, max-age=300").sendFile(path.join(__dirname, "views/latin-du-jour.html"));
});

// Import de connaissances par photo — page autonome, non mise en cache
// (formulaire interactif, pas un contenu du jour). Cf. views/photo-knowledge.html.
app.get("/photo-knowledge", (req, res) => {
  res.sendFile(path.join(__dirname, "views/photo-knowledge.html"));
});

// Ajout manuel : réutilise exactement le même éditeur léger que l'import
// photo, basculé en mode manuel par son URL (aucune duplication de page).
app.get("/manual-knowledge", (req, res) => {
  res.sendFile(path.join(__dirname, "views/photo-knowledge.html"));
});

// PDF : même éditeur, basculé en mode PDF par l'URL.
app.get("/pdf-knowledge", (req, res) => {
  res.sendFile(path.join(__dirname, "views/photo-knowledge.html"));
});

app.get("/text-knowledge", (req, res) => {
  res.sendFile(path.join(__dirname, "views/photo-knowledge.html"));
});

app.get("/url-knowledge", (req, res) => {
  res.sendFile(path.join(__dirname, "views/photo-knowledge.html"));
});

app.get("/youtube-knowledge", (req, res) => {
  res.sendFile(path.join(__dirname, "views/photo-knowledge.html"));
});

// Route publique : renvoie le contenu du jour s'il existe déjà, sinon
// déclenche sa génération (verrou anti-concurrence géré par le module).
app.get("/api/latin-du-jour/today", rateLimit("latin-du-jour-today", 60), async (req, res) => {
  try {
    const result = await latinDuJourService.generateIfNeeded(new Date());
    res.json(result);
  } catch (error) {
    console.error("[latin-du-jour] /today :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Menu "jours précédents" du frontend : liste des dates réellement publiées,
// les plus récentes d'abord.
app.get("/api/latin-du-jour/dates", rateLimit("latin-du-jour-dates", 60), async (req, res) => {
  try {
    const dates = await latinDuJourService.listPublishedDates();
    res.json({ dates });
  } catch (error) {
    console.error("[latin-du-jour] /dates :", error.message);
    res.status(500).json({ dates: [], error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Consultation d'une date précise (lecture seule, jamais de génération —
// cf. getByDate). Placée après /today et /dates pour ne jamais leur faire
// de l'ombre dans le routage Express.
app.get("/api/latin-du-jour/:date", rateLimit("latin-du-jour-date", 60), async (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ status: "failed", error: "Date invalide, format attendu AAAA-MM-JJ." });
    return;
  }
  try {
    const result = await latinDuJourService.getByDate(date);
    res.json(result);
  } catch (error) {
    console.error("[latin-du-jour] /:date :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// Déclenchement manuel réservé à l'admin (tests / retry) : force une
// nouvelle génération même si un contenu existe déjà pour aujourd'hui.
app.post("/api/latin-du-jour/generate", requireAdmin, rateLimit("latin-du-jour-generate", 10), async (req, res) => {
  try {
    const result = await latinDuJourService.generateIfNeeded(new Date(), { force: true });
    res.json(result);
  } catch (error) {
    console.error("[latin-du-jour] /generate :", error.message);
    res.status(500).json({ status: "failed", error: "Erreur serveur. Réessaie plus tard." });
  }
});

// État léger utilisé par l'accueil : le bouton Éclairages ne devient
// cliquable que lorsque les sept rubriques du jour sont réellement publiées.
// Cette route est strictement en lecture et ne déclenche aucune génération.
app.get("/api/eclairages/status", rateLimit("eclairages-status", 120), async (req, res) => {
  try {
    res.json(await getDailyEclairagesPublicationStatus(new Date()));
  } catch (error) {
    console.error("[eclairages] /status :", error.message);
    res.status(500).json({ date: parisDateKey(), available: false, sections: [], error: "Erreur serveur." });
  }
});

/* ================================================================= */

app.get("/ping", (req, res) => res.json({ ok: true }));

/* ---- Diagnostic refresh logs (client → serveur) ---- */
const DIAG_LOGS_FILE = path.join(__dirname, "diag-refresh-logs.json");

app.post("/api/admin/diag/push-logs", requireAdmin, express.json(), (req, res) => {
  try {
    const { startup_log, refresh_log, freeze_log, sent_at } = req.body || {};
    let existing = [];
    try { existing = JSON.parse(fs.readFileSync(DIAG_LOGS_FILE, "utf8")); } catch (_) {}
    existing.unshift({
      sent_at: sent_at || new Date().toISOString(),
      startup_log: startup_log || [],
      refresh_log: refresh_log || [],
      freeze_log: freeze_log || []
    });
    if (existing.length > 5) existing.length = 5;
    fs.writeFileSync(DIAG_LOGS_FILE, JSON.stringify(existing, null, 2), "utf8");
    res.json({ ok: true });
  } catch (e) {
    console.error("[diag] push-logs error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/diag/logs", requireAdmin, (req, res) => {
  try {
    let data = [];
    try { data = JSON.parse(fs.readFileSync(DIAG_LOGS_FILE, "utf8")); } catch (_) {}
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---- TEMPORAIRE : diagnostic du saut de --mnoria-home-first-row-mt au retour
   de Connaissances/Éclairages/Ce jour dans l'histoire en standalone. À
   retirer une fois la cause identifiée (cf. conversation du 05/08/2026). ---- */
const SCROLL_JUMP_DIAG_FILE = path.join(__dirname, "scroll-jump-diag.json");
app.post("/api/debug/scroll-jump-sample", express.json(), (req, res) => {
  try {
    const body = req.body || {};
    let existing = [];
    try { existing = JSON.parse(fs.readFileSync(SCROLL_JUMP_DIAG_FILE, "utf8")); } catch (_) {}
    existing.push({ received_at: new Date().toISOString(), ...body });
    if (existing.length > 2000) existing = existing.slice(existing.length - 2000);
    fs.writeFileSync(SCROLL_JUMP_DIAG_FILE, JSON.stringify(existing), "utf8");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get("/api/debug/scroll-jump-sample", requireAdmin, (req, res) => {
  try {
    let data = [];
    try { data = JSON.parse(fs.readFileSync(SCROLL_JUMP_DIAG_FILE, "utf8")); } catch (_) {}
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.delete("/api/debug/scroll-jump-sample", requireAdmin, (req, res) => {
  try { fs.unlinkSync(SCROLL_JUMP_DIAG_FILE); } catch (_) {}
  res.json({ ok: true });
});

// Gestionnaire d'erreurs global pour express.json({ limit: ... }) (photo/PDF/
// vidéo knowledge, notamment) : sans lui, un corps trop volumineux ou mal
// formé fait tomber sur la page d'erreur HTML par défaut d'Express plutôt
// que sur une réponse JSON. Le client (ex. photo-knowledge.html) appelle
// systématiquement response.json() sur la réponse — parser cette page HTML
// comme du JSON lève une SyntaxError, que Safari/WebKit rapporte sous le nom
// générique "The string did not match the expected pattern." au lieu du
// vrai message ("Analyser la photo" avec une image trop lourde pour la
// limite de la route, demande du 27/08/2026). Ne concerne que les erreurs
// de body-parser (413/400 posées par express.json), jamais les erreurs
// métier des routes elles-mêmes (déjà toutes en JSON).
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "Fichier trop volumineux pour cette limite." });
  }
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Requête invalide." });
  }
  return next(err);
});

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`Server running on port ${PORT}`);
  purgeExternalPreviewCacheDir(500);
  initDebateTrendsCache().catch(e => console.error("[debate-trends] init error:", e.message));
  _loadVeilleMediasFromSupabase().then(ok => console.log(`[veille-medias] cache ${ok ? "chargé depuis Supabase" : "fichier local (fallback)"}`)).catch(console.error);
  const _readJsonFile = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };
  const startupMigrationsEnabled = isRenderScopedTaskEnabled("MNORIA_STARTUP_MIGRATIONS");
  if (startupMigrationsEnabled) {
    // Migration one-shot debate-content.json → debates.content
    try {
      const localContent = _readJsonFile(debateContentMetaPath, {});
      const entries = Object.entries(localContent).filter(([, v]) => v);
      if (entries.length) {
        const { data: dbRows } = await supabase.from("debates")
          .select("id, content")
          .in("id", entries.map(([id]) => id));
        const dbMap = {};
        for (const row of (dbRows || [])) dbMap[String(row.id)] = String(row.content || "");
        const toMigrate = entries.filter(([id, content]) => content.length > (dbMap[id] || "").length);
        if (toMigrate.length) {
          await Promise.all(toMigrate.map(([id, content]) =>
            supabase.from("debates").update({ content }).eq("id", id).then(() => {}).catch(() => {})
          ));
          console.log(`[Mnoria] Content migré vers Supabase : ${toMigrate.length} débats.`);
        }
      }
    } catch (e) {
      console.error("[Mnoria] Erreur migration debate-content:", e.message);
    }

    // Migration one-shot debate-assets.json → debates.image_url / video_url
    try {
      const localAssets = _readJsonFile(debateAssetsMetaPath, {});
      const entries = Object.entries(localAssets).filter(([, v]) => v && typeof v === "object" && (v.image_url || v.video_url));
      if (entries.length) {
        const { data: dbRows } = await supabase.from("debates")
          .select("id, image_url, video_url")
          .in("id", entries.map(([id]) => id));
        const dbMap = {};
        for (const row of (dbRows || [])) dbMap[String(row.id)] = row;
        const toMigrate = entries.filter(([id, v]) => {
          const db = dbMap[id] || {};
          return (v.image_url && !db.image_url) || (v.video_url && !db.video_url);
        });
        if (toMigrate.length) {
          await Promise.all(toMigrate.map(([id, v]) => {
            const db = dbMap[id] || {};
            return supabase.from("debates").update({
              image_url: db.image_url || v.image_url || "",
              video_url: db.video_url || v.video_url || ""
            }).eq("id", id).then(() => {}).catch(() => {});
          }));
          console.log(`[Mnoria] Assets migrés vers Supabase : ${toMigrate.length} débats.`);
        }
      }
    } catch (e) {
      console.error("[Mnoria] Erreur migration debate-assets:", e.message);
    }

    // Migration one-shot debate-keywords.json → debates.keywords
    try {
      const localKeywords = _readJsonFile(debateKeywordsMetaPath, {});
      const entries = Object.entries(localKeywords).filter(([, v]) => Array.isArray(v) && v.length);
      if (entries.length) {
        const { data: dbRows } = await supabase.from("debates").select("id, keywords").in("id", entries.map(([id]) => id));
        const dbMap = {};
        for (const row of (dbRows || [])) dbMap[String(row.id)] = row.keywords;
        const toMigrate = entries.filter(([id, v]) => !(dbMap[id] && dbMap[id].length));
        if (toMigrate.length) {
          await Promise.all(toMigrate.map(([id, keywords]) =>
            supabase.from("debates").update({ keywords }).eq("id", id).then(() => {}).catch(() => {})
          ));
          console.log(`[Mnoria] Keywords migrés vers Supabase : ${toMigrate.length} débats.`);
        }
      }
    } catch (e) {
      console.error("[Mnoria] Erreur migration keywords:", e.message);
    }

    // Migration one-shot stories.json → table stories
    try {
      const localStories = _readJsonFile(storiesMetaPath, []);
      if (Array.isArray(localStories) && localStories.length) {
        const { data: existing } = await supabase.from("stories").select("story_id");
        const existingIds = new Set((existing || []).map(r => r.story_id));
        const toMigrate = localStories.filter(s => s.story_id && !existingIds.has(s.story_id));
        if (toMigrate.length) {
          await Promise.all(toMigrate.map(s => upsertStory(s)));
          console.log(`[Mnoria] Stories migrées vers Supabase : ${toMigrate.length} stories.`);
        }
      }
    } catch (e) {
      console.error("[Mnoria] Erreur migration stories:", e.message);
    }
  } else {
    console.log("[Mnoria] Migrations de démarrage désactivées hors Render (forcer avec MNORIA_STARTUP_MIGRATIONS=on).");
  }

  // Chargement tag_exclusions depuis Supabase → public/tag-exclusions.json + mémoire
  try {
    const { data, error } = await supabase.from("app_config").select("value").eq("key", "tag_exclusions").maybeSingle();
    if (!error && Array.isArray(data?.value)) {
      writeTagExclusionFiles(data.value);
      console.log(`[Mnoria] Tag exclusions chargés depuis Supabase : ${data.value.length} tags.`);
    } else if (fs.existsSync(tagExclusionsMetaPath)) {
      const parsed = JSON.parse(fs.readFileSync(tagExclusionsMetaPath, "utf8") || "[]");
      if (parsed.length) writeTagExclusionFiles(parsed);
    }
  } catch (e) {
    console.error("[Mnoria] Erreur chargement tag_exclusions:", e.message);
  }
  // Chargement shared_debate_links depuis Supabase → cache mémoire
  try {
    const { data, error } = await supabase.from("app_config").select("value").eq("key", "shared_debate_links").maybeSingle();
    if (!error && data?.value && typeof data.value === "object") {
      _sharedLinksCache = data.value;
      console.log(`[Mnoria] Shared debate links chargés depuis Supabase : ${Object.keys(data.value).length} liens.`);
    } else {
      const local = _readJsonFile(sharedDebateLinksMetaPath, {});
      if (Object.keys(local).length) {
        _sharedLinksCache = local;
        supabase.from("app_config")
          .upsert({ key: "shared_debate_links", value: local, updated_at: new Date().toISOString() })
          .then(() => {}).catch(() => {});
        console.log(`[Mnoria] Shared debate links migrés vers Supabase : ${Object.keys(local).length} liens.`);
      } else {
        _sharedLinksCache = {};
      }
    }
  } catch (e) {
    console.error("[Mnoria] Erreur chargement shared_debate_links:", e.message);
    _sharedLinksCache = _getSharedLinksMap();
  }

  // Pré-chauffe légère du cache /api/debates au démarrage.
  // Ne jamais préchauffer la liste complète : avec des milliers d'arènes,
  // cela annulerait la pagination côté index.
  setTimeout(async () => {
    try {
      const prewarmLimit = 60;
      for (const sort of ["recent"]) {
        const cacheKey = getDebatesApiCacheKey({ limit: prewarmLimit, offset: 0, sort });
        if (!getCachedDebatesApiResponse(cacheKey)) {
          const res = await fetch(`http://localhost:${PORT}/api/debates?sort=${sort}&limit=${prewarmLimit}&offset=0`);
          if (res.ok) console.log(`[Mnoria] Cache /api/debates?sort=${sort} préchauffé.`);
        }
      }
    } catch (e) {
      console.error("[Mnoria] Erreur pré-chauffe cache debates:", e);
    }
  }, 2000);
});
