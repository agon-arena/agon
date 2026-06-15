require("dotenv").config();
const express = require("express");
const compression = require("compression");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const dns = require("dns");
const net = require("net");
const { Worker } = require("worker_threads");
const { createClient } = require("@supabase/supabase-js");
const { validateLegacyKey, resolveLegacyUser } = require("./lib/users");
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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const adminTokens = new Set();
const AGON_ADMIN_CREATOR_KEY = "__AGON_ADMIN__";
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:contact@agonarena.org";

app.use(express.json({ limit: "100kb" }));
app.use(express.static("public", { maxAge: 0, setHeaders: (res) => res.setHeader("Cache-Control", "no-store") }));

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

app.use((req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "autoplay=*, fullscreen=*, picture-in-picture=*, web-share=*"
  );
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
        try { domain = new URL(String(item?.rss || "")).hostname.replace(/^www\./, "").toLowerCase(); } catch (_) {}
      }
      return {
        nom:         String(item?.nom || item?.name || "").trim(),
        orientation: String(item?.orientation || "").trim(),
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
    .replaceAll("__META_TITLE__", escapeMetaContent(meta.title || "Agôn"))
    .replaceAll("__META_DESCRIPTION__", escapeMetaContent(meta.description || ""))
    .replaceAll("__META_URL__", escapeMetaContent(meta.url || ""))
    .replaceAll("__META_IMAGE__", escapeMetaContent(meta.image || ""))
    .replaceAll("__META_IMAGE_ALT__", escapeMetaContent(meta.imageAlt || "Agôn"))
    .replaceAll("__VEILLE_URL__", VEILLE_URL)
    .replaceAll("__VEILLE_MEDIAS_JSON__", mediasJsonForScript);
}

function buildIndexMeta(req) {
  return {
    title: "Agôn | L’arène des idées",
    description: "Agôn est un outil d’intelligence collective augmenté par l’IA : il met les idées à l’épreuve pour faire émerger les positions les plus robustes.",
    url: buildAbsoluteUrl(req, "/"),
    image: buildAbsoluteUrl(req, "/logo.jpeg"),
    imageAlt: "Agôn — l'arène des idées"
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
    ? buildAbsoluteUrl(req, `/debate/${encodeURIComponent(debateId)}`)
    : buildAbsoluteUrl(req, "/logo.jpeg");
  const isOpen = String(debate?.type || "").trim().toLowerCase() === "open";
  const question = normalizeMetaText(debate?.question || "Débat sur agôn", 110);
  const optionA = normalizeMetaText(debate?.option_a || "", 80);
  const optionB = normalizeMetaText(debate?.option_b || "", 80);
  const title = `${question} | agôn`;
  const description = isOpen
    ? "Découvrez les réponses déjà proposées et ajoutez votre idée sur agôn."
    : `Comparez les positions "${optionA || "Position A"}" et "${optionB || "Position B"}" dans cette arène sur agôn.`;

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
const cloudBubblesPath = path.join(__dirname, "data", "cloud-bubbles.json");
const tagExclusionsMetaPath = path.join(__dirname, "data", "tag-exclusions.json");
const publicTagExclusionsMetaPath = path.join(__dirname, "public", "tag-exclusions.json");
const MAX_DEBATE_VIDEO_BYTES = 80 * 1024 * 1024;
const SUPABASE_DEBATE_MEDIA_BUCKET = String(process.env.SUPABASE_DEBATE_MEDIA_BUCKET || "debate-media").trim() || "debate-media";

const debateContentMetaPath = path.join(__dirname, "data", "debate-content.json");
const debateTrendsMetaPath = path.join(__dirname, "data", "debate-trends.json");


function normalizeDebateContent(value) {
  return String(value || "").trim().slice(0, 1800);
}

function limitText(value, max) {
  return String(value || "").trim().slice(0, max);
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

function _persistSharedLinksMap(map) {
  _sharedLinksCache = map;
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
  // de publication sur Agôn. Les dates des sources externes peuvent être
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



let _cloudBubblesCache = null;

async function loadCloudBubbles() {
  if (_cloudBubblesCache) return _cloudBubblesCache;

  // Essaie Supabase en premier
  try {
    const { data, error } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "cloud_bubbles")
      .maybeSingle();
    if (!error && data?.value && typeof data.value === "object") {
      _cloudBubblesCache = data.value;
      return _cloudBubblesCache;
    }
  } catch {}

  // Fallback / migration one-shot : fichier JSON local
  try {
    if (fs.existsSync(cloudBubblesPath)) {
      const parsed = JSON.parse(fs.readFileSync(cloudBubblesPath, "utf8"));
      if (parsed && typeof parsed === "object") {
        _cloudBubblesCache = Array.isArray(parsed.bubbles) ? parsed : { bubbles: [], lastUpdatedAt: null };
        // Tente de migrer dans Supabase silencieusement si la table existe
        if (_cloudBubblesCache.bubbles.length) saveCloudBubbles(_cloudBubblesCache).catch(() => {});
        return _cloudBubblesCache;
      }
    }
  } catch {}

  _cloudBubblesCache = { bubbles: [], lastUpdatedAt: null };
  return _cloudBubblesCache;
}

async function saveCloudBubbles(data) {
  try {
    const safe = { bubbles: Array.isArray(data?.bubbles) ? data.bubbles : [], lastUpdatedAt: data?.lastUpdatedAt || null };
    const { error } = await supabase
      .from("app_config")
      .upsert({ key: "cloud_bubbles", value: safe, updated_at: new Date().toISOString() });
    if (error) throw error;
    _cloudBubblesCache = safe;
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
  const { data: row } = await supabase.from("debates").select("keywords").eq("id", id).maybeSingle();
  const newTag = getCloudLabelFromDebate(id, { [id]: row?.keywords || [] });
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
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/#/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCloudLabelFromDebate(debateId, keywordsMap) {
  const keywords = normalizeKeywordList(keywordsMap?.[String(debateId)] || []);
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

async function rebuildCloudBubbles() {
  const now = new Date().toISOString();

  const { data: allDebates, error } = await supabase
    .from("debates")
    .select("id, question, source_url, media_extras, created_at, source_published_at, keywords")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const keywordsMap = {};
  for (const d of (allDebates || [])) {
    if (Array.isArray(d.keywords) && d.keywords.length) keywordsMap[d.id] = d.keywords;
  }

  const seenTags = new Set();
  const supersededByTrend = new Set();
  const candidates = [];
  for (const debate of (allDebates || [])) {
    if (supersededByTrend.has(String(debate.id))) continue;
    const label = getCloudLabelFromDebate(debate.id, keywordsMap);
    if (!label) continue;
    const sourceCount = countCloudSources(debate);
    if (sourceCount <= 0) continue;
    const normTag = normalizeTag(label);
    if (seenTags.has(normTag)) continue;
    seenTags.add(normTag);
    const debateDate = debate.source_published_at || debate.created_at || now;
    const trendEntry = getDebateTrend(debate.id);
    if (trendEntry?.matchedSubjectId) {
      supersededByTrend.add(String(trendEntry.matchedSubjectId));
    }
    candidates.push({
      tag: label,
      subjectId: String(debate.id),
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
      .select("id, source_url, media_extras, created_at, source_published_at")
      .in("id", ids);
    if (currentError) throw new Error(currentError.message);
    for (const debate of (currentDebates || [])) debateMap.set(String(debate.id), debate);
  }

  bubbles = bubbles
    .map((bubble) => {
      const debate = debateMap.get(String(bubble.subjectId));
      const refreshedCount = debate ? countCloudSources(debate) : Number(bubble.count || 0);
      const tag = getCloudLabelFromDebate(bubble.subjectId, keywordsMap) || bubble.tag;
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
  await saveCloudBubbles(newData);

  return { ok: true, count: bubbles.length, newAdded: added, updated, updatedAt: newData.lastUpdatedAt };
}

async function rebuildCloudBubblesAfterPublish(reason, debateId = null) {
  try {
    return await rebuildCloudBubbles();
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
function writeDebateTrendsMap(map) {
  _debateTrendsCache = map;
  supabase.from("app_config")
    .upsert({ key: "debate_trends", value: map, updated_at: new Date().toISOString() })
    .then(({ error }) => { if (error) console.error("[debate-trends] save error:", error.message); });
}

async function initDebateTrendsCache() {
  try {
    const { data, error } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "debate_trends")
      .maybeSingle();
    if (!error && data?.value && typeof data.value === "object") {
      _debateTrendsCache = data.value;
      return;
    }
  } catch {}
  // Migration one-shot depuis fichier local vers Supabase
  try {
    const local = _readJsonFile(debateTrendsMetaPath, {});
    if (Object.keys(local).length) {
      _debateTrendsCache = local;
      supabase.from("app_config")
        .upsert({ key: "debate_trends", value: local, updated_at: new Date().toISOString() })
        .then(() => {}).catch(e => console.error("[debate-trends] migration error:", e.message));
    }
  } catch {}
}

function setDebateTrend(debateId, trendData) {
  const key = String(debateId || "").trim();
  if (!key) return;
  const map = readDebateTrendsMap();
  map[key] = { ...trendData, computedAt: new Date().toISOString() };
  writeDebateTrendsMap(map);
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

  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) {
    throw new Error("Image vide.");
  }

  const previousImageUrl = String(options.previousImageUrl || "").trim();
  const objectPath = buildDebateMediaStoragePath(debateId, "image", extension);

  const { error } = await supabase.storage
    .from(SUPABASE_DEBATE_MEDIA_BUCKET)
    .upload(objectPath, buffer, {
      contentType: mimeType,
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

function sanitizeDebateForClient(debate, clientKey) {
  if (!debate) return debate;
  const { creator_key, ...rest } = debate;
  const normalizedClientKey = clientKey ? String(clientKey) : "";
  return {
    ...rest,
    is_owner: !!(normalizedClientKey && creator_key && String(creator_key) === normalizedClientKey),
    is_official: creator_key === AGON_ADMIN_CREATOR_KEY,
    is_community: !!creator_key && creator_key !== AGON_ADMIN_CREATOR_KEY
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

function sanitizeDebateDetailPayload(payload, clientKey) {
  if (!payload) return payload;
  const sanitizedCommentsByArgument = {};
  for (const [argumentId, comments] of Object.entries(payload.commentsByArgument || {})) {
    sanitizedCommentsByArgument[argumentId] = (comments || []).map((c) => sanitizeCommentForClient(c, clientKey));
  }
  return {
    ...payload,
    debate: sanitizeDebateForClient(payload.debate, clientKey),
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
    ...(author ? { author } : {})
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
    const html = response.ok ? await response.text() : "";

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
const EXTERNAL_PREVIEW_CACHE_DIR = path.join(__dirname, "data", "external-preview-cache");
const EXTERNAL_PREVIEW_CACHE_MAX = 300;
const debatesApiResponseCache = new Map();
const DEBATES_API_CACHE_TTL_MS = 5 * 60 * 1000;
const DEBATES_API_CACHE_MAX = 50;
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
  "bumped_at"
].join(",");
const debateDetailResponseCache = new Map();
const DEBATE_DETAIL_CACHE_TTL_MS = 30 * 1000;
const DEBATE_DETAIL_CACHE_MAX = 500;
const notificationsApiResponseCache = new Map();
const NOTIFICATIONS_API_CACHE_TTL_MS = 15 * 1000;
const NOTIFICATIONS_API_CACHE_MAX = 200;

function getDebatesApiCacheKey({ limit = null, offset = 0, sort = "popular", search = "" } = {}) {
  const normalizedSort = ["popular", "recent", "old", "ideas"].includes(String(sort || ""))
    ? String(sort)
    : "popular";

  return JSON.stringify({
    limit: Number.isFinite(limit) && limit > 0 ? limit : null,
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
    sort: normalizedSort,
    search: String(search || "").trim().toLowerCase()
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

function setCachedDebateDetailResponse(debateId, value) {
  const key = getDebateDetailCacheKey(debateId);
  if (!key) return;
  _cacheSet(debateDetailResponseCache, key, { value, expiresAt: Date.now() + DEBATE_DETAIL_CACHE_TTL_MS }, DEBATE_DETAIL_CACHE_MAX);
}

function clearDebateDetailResponseCache(debateId = null) {
  const key = getDebateDetailCacheKey(debateId);
  if (!key) {
    debateDetailResponseCache.clear();
    return;
  }
  debateDetailResponseCache.delete(key);
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

function getNotificationsApiCacheKey(userKey) {
  return String(userKey || "").trim();
}

function getCachedNotificationsApiResponse(userKey) {
  const key = getNotificationsApiCacheKey(userKey);
  if (!key) return null;

  const entry = notificationsApiResponseCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    notificationsApiResponseCache.delete(key);
    return null;
  }

  return entry.value;
}

function setCachedNotificationsApiResponse(userKey, value) {
  const key = getNotificationsApiCacheKey(userKey);
  if (!key) return;
  _cacheSet(notificationsApiResponseCache, key, { value, expiresAt: Date.now() + NOTIFICATIONS_API_CACHE_TTL_MS }, NOTIFICATIONS_API_CACHE_MAX);
}

function clearNotificationsApiResponseCache() {
  notificationsApiResponseCache.clear();
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

  try {
    await assertSafeExternalUrl(safeUrl);
  } catch (error) {
    return null;
  }

  const cached = getCachedPreview(safeUrl);
  if (cached) return cached;

  const persistedPreview = readPersistentPreview(safeUrl);
  if (persistedPreview && isMeaningfulPreviewData(persistedPreview, safeUrl)) {
    setCachedPreview(safeUrl, persistedPreview, 1000 * 60 * 60 * 24);
    return persistedPreview;
  }

  const inFlightRequest = externalPreviewInFlightRequests.get(safeUrl);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const domain = parsedUrl.hostname.replace(/^www\./, "").toLowerCase();
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

        if (!fetched?.ok || !fetched.html) {
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
        return mergedPreview;
      }

      if (persistedPreview && isMeaningfulPreviewData(persistedPreview, safeUrl)) {
        setCachedPreview(safeUrl, persistedPreview, 1000 * 60 * 60 * 24);
        return persistedPreview;
      }

      setCachedPreview(safeUrl, mergedPreview, 1000 * 60 * 5);

      if (isMeaningfulPreviewData(mergedPreview, safeUrl)) {
        writePersistentPreview(safeUrl, mergedPreview);
      }

      return mergedPreview;
    } catch (error) {
      const fallback = persistedPreview || emptyPreview;
      setCachedPreview(safeUrl, fallback, 1000 * 60 * 5);
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
  const token = req.headers["x-admin-token"];
  return !!token && adminTokens.has(token);
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Accès admin refusé." });
  }
  next();
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

      let score = overlapScore;
      if (exactQuestion) score = Math.max(score, 1);
      if (strongSubstring) score = Math.max(score, 0.78);
      if (sharedCount >= 4) score = Math.max(score, 0.72);
      if (longSharedCount >= 2 && overlapScore >= 0.45) score = Math.max(score, 0.69);

      const keep = exactQuestion
        || score >= 0.72
        || (score >= 0.64 && sharedCount >= 4)
        || (score >= 0.6 && longSharedCount >= 2 && strongSubstring);
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
    if (!r.ok) return null;
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    return Array.isArray(parsed?.results) ? parsed.results : null;
  } catch {
    return null;
  }
}


// Nombre de publications récentes comparées au nouveau sujet pour le calcul de tendance
const TREND_RECENT_SUBJECTS_LIMIT = 30;

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
    "Publications récentes (les 24 dernières) :",
    recentLines,
    "",
    "Si plusieurs sujets semblent appartenir à la même séquence, retourne TOUS leurs ids dans le tableau matchedSubjectIds (pas seulement un).",
    "Si aucun sujet ne correspond, matchedSubjectIds doit être un tableau vide [].",
    'Réponds UNIQUEMENT en JSON strict :',
    '{"matchedSubjectIds":["id1","id2"],"confidence":0.0,"reason":"courte justification","isSameSequence":true}'
  ].join("\n");

  try {
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
    if (!r.ok) return null;
    const data = await r.json();
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
      confidence,
      reason: String(parsed?.reason || "").trim()
    };
  } catch {
    return null;
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

async function evaluateVeilleMergeAlignmentWithAI(existingDebate, incomingPositions) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const prompt = [
      "Tu vérifies la cohérence d'une fusion entre deux arènes à positions.",
      "Dis si la nouvelle position A correspond plutôt à l'ancienne position A, à l'ancienne position B, ou si c'est ambigu.",
      'Réponds uniquement en JSON: {"verdict":"coherent|inverted|ambiguous","reason":"..."}',
      '',
      'Arène existante :',
      'A: ' + String(existingDebate.option_a || '').trim(),
      'B: ' + String(existingDebate.option_b || '').trim(),
      '',
      'Nouvelle arène :',
      'A: ' + String(incomingPositions.positionA || '').trim(),
      'B: ' + String(incomingPositions.positionB || '').trim()
    ].join("\n");

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

    if (!r.ok) return null;
    const data = await r.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
    if (!content) return null;
    const parsed = JSON.parse(content);
    const verdict = ['coherent', 'inverted', 'ambiguous'].includes(parsed && parsed.verdict) ? parsed.verdict : 'ambiguous';
    return {
      verdict,
      reason: String((parsed && parsed.reason) || '').trim()
    };
  } catch (error) {
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
  if (heuristic.verdict === 'ambiguous' || heuristic.confidence < 0.12) {
    const aiResult = await evaluateVeilleMergeAlignmentWithAI(existingDebate, incomingPositions);
    if (aiResult && aiResult.verdict) {
      finalVerdict = aiResult.verdict;
      aiReason = aiResult.reason || '';
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

async function _sendPushNow(userKey, { type, message, debate_id = null, argument_id = null, comment_id = null }) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  const event = await createNotificationEventSafe(supabase, {
    eventType: type,
    actorLegacyKey: null,
    recipientLegacyKey: userKey,
    debateId: debate_id,
    argumentId: argument_id,
    commentId: comment_id,
    payload: { message }
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

  await supabase.from("notifications").insert({
    user_key,
    type,
    debate_id,
    argument_id,
    comment_id,
    message,
    is_read: 0,
    created_at: nowIso()
  });

  clearNotificationsApiResponseCache();
  _sendPushNow(user_key, { type, message, debate_id, argument_id, comment_id }).catch(console.error);
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
  argument_title = ""
}) {
  if (!user_key || !argument_id) return;

  const ideaLabel = quoteNotificationContent(argument_title || "cette idée");
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
      message: `Votre idée ${ideaLabel} a reçu 1 voix.`
    });
    return;
  }

  const matched = String(recentNotification.message || "").match(/a reçu\s+(\d+)\s+voix?/i);
  const currentCount = matched ? Number.parseInt(matched[1], 10) : 1;
  const nextCount = Math.max(2, currentCount + 1);

  const { error: updateError } = await supabase
    .from("notifications")
    .update({
      debate_id,
      argument_id,
      message: `Votre idée ${ideaLabel} a reçu ${nextCount} voix.`,
      is_read: 0,
      created_at: nowIso()
    })
    .eq("id", recentNotification.id);

  if (updateError) throw updateError;
  clearNotificationsApiResponseCache();
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

async function getDebateById(id) {
  const { data, error } = await supabase
    .from("debates")
    .select("*")
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
    const debate = debateId ? await getDebateById(debateId) : null;
    if (debate) {
      const meta = buildDebateMeta(req, debate);
      meta.url = buildAbsoluteUrl(req, `/debates/${encodeURIComponent(debateId)}`);
      const html = replaceMetaPlaceholders(template, meta);
      return res.type("html").send(html);
    }
  } catch (error) {
    console.error(error);
  }
  const html = replaceMetaPlaceholders(template, buildIndexMeta(req));
  res.type("html").send(html);
});

app.get("/create", (req, res) => {
  res.set("Cache-Control", "no-store").sendFile(path.join(__dirname, "views/create.html"));
});

app.get("/notifications", (req, res) => {
  res.set("Cache-Control", "no-store").sendFile(path.join(__dirname, "views/notifications.html"));
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
      from: "agôn <onboarding@resend.dev>",
      to: "kevinbruyat@live.fr",
      reply_to: email,
      subject: `Contact agôn — ${name}`,
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
    if (!_veilleMediasCache) await _loadVeilleMediasFromSupabase();
    res.setHeader("Cache-Control", "no-store");
    res.json({ medias: readVeilleMedias() });
  } catch (error) {
    console.error("Erreur lecture médias veille:", error);
    res.status(500).json({ error: "Liste des médias indisponible." });
  }
});

app.get("/about", async (req, res) => {
  try {
    if (!_veilleMediasCache) await _loadVeilleMediasFromSupabase();
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
      title: "Débat | agôn",
      description: "Découvrez les débats et les idées qui s'affrontent sur agôn.",
      url: buildAbsoluteUrl(req, "/debate"),
      image: buildAbsoluteUrl(req, "/logo.jpeg"),
      imageAlt: "Agôn — l'arène des idées"
    });
    return res.type("html").send(html);
  }

  try {
    const debate = await getDebateById(debateId);
    if (!debate) {
      const html = replaceMetaPlaceholders(template, {
        title: "Débat introuvable | agôn",
        description: "Cette arène n'est plus disponible sur agôn.",
        url: buildAbsoluteUrl(req, `/debate?id=${encodeURIComponent(debateId)}`),
        image: buildAbsoluteUrl(req, "/logo.jpeg"),
        imageAlt: "Agôn — l'arène des idées"
      });
      return res.status(404).type("html").send(html);
    }

    const html = replaceMetaPlaceholders(template, buildDebateMeta(req, debate));
    return res.type("html").send(html);
  } catch (error) {
    console.error(error);
    const html = replaceMetaPlaceholders(template, {
      title: "Débat | agôn",
      description: "Découvrez les débats et les idées qui s'affrontent sur agôn.",
      url: buildAbsoluteUrl(req, `/debate?id=${encodeURIComponent(debateId)}`),
      image: buildAbsoluteUrl(req, "/logo.jpeg"),
      imageAlt: "Agôn — l'arène des idées"
    });
    return res.type("html").send(html);
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

app.get("/debate/:id", async (req, res) => {
  try {
    const id = req.params.id;

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
      logoPath: path.join(__dirname, "public/logo.jpeg")
    });

    _cacheSet(ogImageCache, String(id), { buffer: pngBuffer, expiresAt: Date.now() + OG_IMAGE_CACHE_TTL_MS }, OG_IMAGE_CACHE_MAX);

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=1800");
    res.send(pngBuffer);
  } catch (error) {
    console.error(error);
    res.status(500).send("Erreur génération image");
  }
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

  const token = crypto.randomBytes(24).toString("hex");
  adminTokens.add(token);

  res.json({ success: true, token });
});

app.post("/api/admin/logout", (req, res) => {
  const token = req.headers["x-admin-token"];
  if (token) {
    adminTokens.delete(token);
  }
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

    const result = await broadcastPush(supabase, {
      publicKey: VAPID_PUBLIC_KEY,
      privateKey: VAPID_PRIVATE_KEY,
      subject: VAPID_SUBJECT
    }, {
      title: "L'arène des idées",
      body: "Les arènes du jour sont ouvertes.",
      url: "/",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png"
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur envoi broadcast push.");
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

app.get("/api/notifications", rateLimit("notifications", 180), async (req, res) => {
  try {
    const userKey = req.query.userKey;

    if (!userKey) {
      return res.status(400).json({ error: "Clé utilisateur manquante." });
    }

    const cachedResponse = getCachedNotificationsApiResponse(userKey);
    if (cachedResponse) {
      return res.json(cachedResponse);
    }

    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_key", userKey)
      .order("is_read", { ascending: true })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur lecture notifications.");
    }

    const payload = data || [];
    setCachedNotificationsApiResponse(userKey, payload);
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

    clearNotificationsApiResponseCache();
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

    clearNotificationsApiResponseCache();
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
    const { question, option_a, option_b, source_url, content, category, image_url, video_url, mark_as_agon_generated, story_id } = req.body || {};
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
      ...(mark_as_agon_generated === true ? { creator_key: AGON_ADMIN_CREATOR_KEY } : {})
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
    const preserveAgonGenerated = req.body?.preserve_agon_generated === true;
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("debates")
      .update({
        bumped_at: now,
        creator_key: preserveAgonGenerated ? AGON_ADMIN_CREATOR_KEY : null,
        ...(preserveAgonGenerated ? { created_at: now, source_published_at: now } : {})
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

/* =========================
   DEBATES
========================= */

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
    const cacheKey = getDebatesApiCacheKey({
      limit: safeLimit,
      offset: safeOffset,
      sort: effectiveSortMode,
      search: searchQuery
    });
    const bypassCache = req.query._ || req.query.fresh === "1" || req.headers["cache-control"] === "no-store";
    const cachedResponse = bypassCache ? null : getCachedDebatesApiResponse(cacheKey);

    if (cachedResponse) {
      return res.json(cachedResponse.map((d) => sanitizeDebateForClient(d, clientKey)));
    }

    const canPageInDatabase = !searchQuery && (effectiveSortMode === "recent" || effectiveSortMode === "old");
    let debatesQuery = supabase
      .from("debates")
      .select(DEBATES_LIST_SELECT_COLUMNS);

    if (canPageInDatabase) {
      debatesQuery = debatesQuery
        .order("created_at", { ascending: effectiveSortMode === "old" })
        .range(safeOffset, safeOffset + safeLimit - 1);
    }

    const { data: debates, error } = await debatesQuery;

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur lecture débats.");
    }

    let debateRows = debates || [];
    if (searchQuery) {
      debateRows = debateRows.filter((d) => {
        const text = [d.question, d.category, d.option_a, d.option_b].join(" ").toLowerCase();
        return text.includes(searchQuery);
      });
    }
    if (!debateRows.length) {
      return res.json([]);
    }

    const debateIds = debateRows.map((d) => d.id);
    const sharedDebateIds = [...new Set(debateIds.map((id) => resolveSharedDebateId(id) || String(id)))];

    const { data: args, error: argsErr } = await supabase
      .from("arguments")
      .select("id,debate_id,side,votes,created_at,last_voted_at")
      .in("debate_id", sharedDebateIds);

    if (argsErr) {
      console.error(argsErr);
      return sendServerError(res, "Erreur lecture débats.");
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
      const commentsResult = await supabase
        .from("comments")
        .select("argument_id,created_at")
        .in("argument_id", argumentIds);

      if (commentsResult.error) {
        console.error(commentsResult.error);
        return sendServerError(res, "Erreur lecture débats.");
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

    // Votes récents (7 jours max) pour le score d'activité des Bulles Agôn :
    // la fenêtre temporelle limite la requête à un petit volume de lignes.
    const vote48hCountByDebate = new Map();
    const vote7dCountByDebate = new Map();
    if (argumentIds.length) {
      const { data: recentVotes, error: recentVotesError } = await supabase
        .from("votes")
        .select("argument_id,vote_count,created_at")
        .gte("created_at", new Date(cutoff7d).toISOString());
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
        ...enrichDebateWithStoredImage(d),
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

    const urlsToWarm = [];
    const rowsWithSourcePreview = pagedRows.map((row) => {
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
      ? 10 * 1000
      : DEBATES_API_CACHE_TTL_MS;
    if (!bypassCache) {
      setCachedDebatesApiResponse(cacheKey, rowsWithSourcePreview, cacheTtlMs);
    }
    res.json(rowsWithSourcePreview.map((d) => sanitizeDebateForClient(d, clientKey)));
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture débats.");
  }
});

const { generateCloudLabel } = require("./lib/cloud-label");

// Génère et enregistre le cloud_label en arrière-plan (jamais bloquant) :
// en cas d'échec IA, la colonne reste NULL et un fallback s'appliquera côté lecture.
async function assignDebateCloudLabel(debateId, fields) {
  try {
    const label = await generateCloudLabel(fields);
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
    const { question, category, source_url, content, resource_mode, image_upload, type, option_a, option_b, creatorKey, evaluation_axis, evaluation_axis_hidden } = req.body || {};
    const normalizedContent = normalizeDebateContent(content);
    const normalizedAxis = type === "open"
      ? String(evaluation_axis || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 280)
      : null;
    // Le créateur peut cacher son barème aux participants (l'IA l'applique quand même)
    const normalizedAxisHidden = Boolean(normalizedAxis && evaluation_axis_hidden === true);
    const normalizedSourceUrl = normalizeExternalUrl(source_url);
    const normalizedResourceMode = ["none", "source", "image", "video"].includes(String(resource_mode || ""))
      ? String(resource_mode)
      : "none";

    if (normalizedResourceMode === "source" && !normalizedSourceUrl) {
      return res.status(400).json({ error: "Lien source manquant." });
    }

    if (normalizedResourceMode === "image" && !image_upload) {
      return res.status(400).json({ error: "Image manquante." });
    }

    if (normalizedSourceUrl && image_upload) {
      return res.status(400).json({ error: "Choisis soit un lien source, soit une image importée." });
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
        creator_key: isAdmin(req) ? AGON_ADMIN_CREATOR_KEY : (creatorKey || null),
        created_at: nowIso()
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
            creator_key: isAdmin(req) ? AGON_ADMIN_CREATOR_KEY : (creatorKey || null),
            created_at: nowIso()
          })
          .select("id")
          .single();
      }
    }

    const { data, error } = insertResult;

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Erreur création débat." });
    }

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
        const currentSourceCount = normalizedSourceUrl ? 1 : 0;
        const { data: recentRows } = await supabase
          .from("debates")
          .select("id, question, content, source_url, media_extras, created_at")
          .neq("id", data.id)
          .order("created_at", { ascending: false })
          .limit(TREND_RECENT_SUBJECTS_LIMIT);
        const recentSubjects = (recentRows || []).map((d) => {
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
            tags: [],
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
        let trendEntry;
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
            matchedSubjectTitle: matched.question,
            previousSourceCount: matched.sourceCount || 0,
            reason: matched.reason || ""
          };
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
app.get("/api/debates/analysis-statuses", rateLimit("analysis-read", 240), async (req, res) => {
  const { data, error } = await supabase
    .from("debates")
    .select("id, ai_analysis_status, ai_analysis_scheduled_at")
    .in("ai_analysis_status", ["scheduled", "generating", "ready"]);
  if (error) return res.json({});
  const map = {};
  for (const row of data || []) {
    map[row.id] = {
      status:      row.ai_analysis_status,
      scheduledAt: row.ai_analysis_scheduled_at || null
    };
  }
  return res.json(map);
});

app.get("/api/debates/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const clientKey = getRequestClientKey(req);
    const cachedResponse = getCachedDebateDetailResponse(id);
    if (cachedResponse) {
      return res.json(sanitizeDebateDetailPayload(cachedResponse, clientKey));
    }

    const [debate, args] = await Promise.all([
      getDebateById(id),
      getArgumentsByDebateId(id)
    ]);

    if (!debate) {
      return res.status(404).json({ error: "Débat introuvable." });
    }

    // Barème caché par le créateur : le texte ne doit jamais être exposé aux clients
    // (seul le flag part au front, qui affiche « Barème non communiqué »).
    const publicDebate = debate.evaluation_axis_hidden
      ? { ...debate, evaluation_axis: "" }
      : debate;

    const optionA = args.filter((a) => a.side === "A");
    const optionB = args.filter((a) => a.side === "B");
    const argumentIds = args.map((a) => a.id);

    if (!argumentIds.length) {
      const sourcePreview = debate.source_url ? await getExternalLinkPreview(debate.source_url) : null;
      const payload = {
        debate: publicDebate,
        optionA,
        optionB,
        commentsByArgument: {},
        sourcePreview
      };
      setCachedDebateDetailResponse(id, payload);
      return res.json(sanitizeDebateDetailPayload(payload, clientKey));
    }

    const [sourcePreview, comments] = await Promise.all([
      debate.source_url ? getExternalLinkPreview(debate.source_url) : Promise.resolve(null),
      getCommentsByArgumentIds(argumentIds)
    ]);

    const commentsByArgument = {};

    for (const comment of comments) {
      if (!commentsByArgument[comment.argument_id]) {
        commentsByArgument[comment.argument_id] = [];
      }
      commentsByArgument[comment.argument_id].push(comment);
    }

    const payload = {
      debate: publicDebate,
      optionA,
      optionB,
      commentsByArgument,
      sourcePreview
    };

    setCachedDebateDetailResponse(id, payload);
    res.json(sanitizeDebateDetailPayload(payload, clientKey));
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

    const { data, error } = await supabase
      .from("arguments")
      .insert({
        debate_id: sharedDebateId,
        side,
        title: limitText(title, 180),
        body: limitText(body, 2500),
        source_url: limitText(source_url, 1000),
        author_key: authorKey || null,
        votes: 0,
        created_at: nowIso(),
        paste_ratio: Math.max(0, Math.min(100, Math.round(Number(pasteRatio || 0)))),
        pasted_chars: Math.max(0, Math.round(Number(pastedChars || 0))),
        manual_writing_badge: manualWritingBadge === true || manualWritingBadge === "true",
        used_microphone: usedMicrophone === true || usedMicrophone === "true"
      })
      .select("id")
      .single();

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur création argument.");
    }

    invalidateSharedDebateCaches(requestedDebateId);

    const debateRow = await getDebateById(requestedDebateId);

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

    snapshotAndWatchMajority(sharedDebateId, data.id, side, authorKey).catch(console.error);
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

    invalidateDebateCaches();
    clearNotificationsApiResponseCache();
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur suppression commentaire." });
  }
});

/* ========================= VEILLE PENDING ========================= */

async function loadVeillePending() {
  const { data, error } = await supabase
    .from("veille_pending")
    .select("*")
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
    storySelection: r.pending_story_selection || null
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
  const { question, positionA, positionB, theme, resume, sources, links, storySelection, keywords, politicalOrientation } = req.body || {};
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
    political_orientation: politicalOrientation || null
  });
  if (error) { console.error("veille receive:", error.message); return res.status(500).json({ ok: false, error: error.message }); }
  const normalizedStorySelection = normalizeStorySelection(storySelection);
  if (normalizedStorySelection) {
    setVeillePendingStorySelection(pendingId, normalizedStorySelection);
  }
  setVeillePendingKeywords(pendingId, keywords);
  res.json({ ok: true });
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

app.post("/api/admin/veille/check-similar", requireAdmin, rateLimit("admin-ai", 10), async (req, res) => {
  const { question, positionA, positionB, resume } = req.body || {};
  if (!String(question || "").trim()) return res.status(400).json({ similar: [] });

  try {
    const { data: debates, error } = await supabase
      .from("debates")
      .select("id, question, option_a, option_b, type, content, created_at")
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) throw new Error(error.message);
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

app.get("/api/cloud-bubbles", async (req, res) => {
  try {
    const data = await loadCloudBubbles();
    res.json({ ok: true, bubbles: data.bubbles || [], lastUpdatedAt: data.lastUpdatedAt || null });
  } catch {
    res.json({ ok: true, bubbles: [], lastUpdatedAt: null });
  }
});

app.post("/api/admin/update-cloud", requireAdmin, express.json(), async (req, res) => {
  try {
    const result = await rebuildCloudBubbles();
    res.json(result);
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
    .select("id, source_url, media_extras")
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

  const rebuildResult = await rebuildCloudBubblesAfterPublish("link-supersession", newId);
  res.json({ ok: true, trend, currentSourceCount, previousSourceCount, rebuildResult });
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
      return res.status(502).json({ error: body || 'Erreur OpenAI.' });
    }

    const data = await r.json();
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

app.post("/api/admin/veille/publish", requireAdmin, rateLimit("admin-ai", 10), async (req, res) => {
  const { id, question, positionA, positionB, theme, resume, links, linkedDebateId, keywords, forcePublishOnAlignmentWarning } = req.body || {};
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
    }
    const pendingResume = String(pendingRow?.resume || "").trim();
    const pendingPoliticalOrientation = pendingRow?.political_orientation || null;

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
    const normalizedPositionA = String(positionA || "").trim();
    const normalizedPositionB = String(positionB || "").trim();
    const debateType = inferVeilleDebateType(normalizedPositionA, normalizedPositionB);
    const requestedLinkedDebateId = String(linkedDebateId || pendingRow?.pending_linked_debate_id || "").trim();
    const canonicalLinkedDebateId = requestedLinkedDebateId ? resolveSharedDebateId(requestedLinkedDebateId) : "";
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
        positionB: normalizedPositionB
      });
      if (!alignment.ok && !(forcePublishOnAlignmentWarning && ["ambiguous", "inverted"].includes(String(alignment.verdict || "").trim()))) {
        return res.status(400).json({ ok: false, error: alignment.message, verdict: alignment.verdict });
      }
    }

    const { data, error } = await supabase.from("debates").insert({
      question: safeQuestion,
      option_a: debateType === "open" ? "" : normalizedPositionA,
      option_b: debateType === "open" ? "" : normalizedPositionB,
      category: theme || null,
      content: resolvedContent,
      source_url: sourceUrl,
      type: debateType,
      creator_key: AGON_ADMIN_CREATOR_KEY,
      created_at: nowIso(),
      political_orientation: pendingPoliticalOrientation || null
    }).select("id").single();
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

  const { data: recentRows } = await supabase
    .from("debates")
    .select("id, question, content, source_url, media_extras, created_at")
    .neq("id", data.id)
    .order("created_at", { ascending: false })
    .limit(TREND_RECENT_SUBJECTS_LIMIT);

  const recentSubjects = (recentRows || []).map((d) => {
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
    await rebuildCloudBubblesAfterPublish("veille-publish", data.id);
    res.json({ ok: true, debateId: data.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/admin/veille/merge", requireAdmin, rateLimit("admin-ai", 10), async (req, res) => {
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
    if (!alignment.ok) {
      return res.status(400).json({ ok: false, error: alignment.message, verdict: alignment.verdict });
    }

    setVeillePendingLinkedDebate(id, debateId);
    res.json({
      ok: true,
      debateId: resolveSharedDebateId(debateId) || String(debateId),
      message: "Le debat partage est selectionne. Les cartes resteront separees jusqu'a la publication."
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
  const { data, error } = await supabase
    .from("debates")
    .select("ai_analysis, ai_analysis_status, ai_analysis_scheduled_at, ai_analysis_generated_at, popularity_analysis")
    .eq("id", id)
    .single();
  if (error || !data) {
    console.error("[analysis GET]", id, error?.message || "no data");
    return res.status(404).json({ error: error?.message || "Débat introuvable." });
  }
  const fullAnalysis = data.ai_analysis || null;
  let raw = null;
  if (fullAnalysis) {
    if (fullAnalysis.trimStart().startsWith("{")) {
      // Nouveau format : JSON direct
      raw = fullAnalysis;
    } else {
      // Ancien format : extrait le bloc scoring après le marqueur
      const marker = "\n%%AGON_SCORING%%\n";
      const idx = fullAnalysis.indexOf(marker);
      if (idx !== -1) raw = fullAnalysis.slice(idx + marker.length).trim();
    }
  }
  return res.json({
    raw:            raw,
    popularityRaw:  data.popularity_analysis || null,
    status:         data.ai_analysis_status || "none",
    scheduledAt:    data.ai_analysis_scheduled_at || null,
    generatedAt:    data.ai_analysis_generated_at || null
  });
});

// Construit le payload à partir de la base (pour la génération automatique)
async function _fetchDebatePayload(debateId) {
  const debate = await getDebateById(debateId);
  if (!debate) throw new Error("Débat introuvable.");

  const { data: args } = await supabase.from("arguments").select("*").eq("debate_id", debateId);
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
    previousAnalysis,
    argumentsA: (args || []).filter((a) => a.side === "A").map(mapArg),
    argumentsB: (args || []).filter((a) => a.side === "B").map(mapArg),
    comments:   comments.map((c) => ({ text: c.content || "", stance: c.stance || "" }))
  };
}

const { generateAnalysisJson }        = require('./lib/debate-analysis');
const { generatePopularityAnalysis }  = require('./lib/popularity-analysis');

// Génère et sauvegarde l'analyse (utilisé par le scheduler et la route admin)
async function _generateAndSaveAnalysis(debateId) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;

  await supabase.from("debates").update({ ai_analysis_status: "generating" }).eq("id", debateId);

  try {
    const payload = await _fetchDebatePayload(debateId);
    const result  = await generateAnalysisJson(payload, (messages, opts) => _callOpenAI(apiKey, messages, opts));
    const raw     = JSON.stringify(result);

    const { error: saveError } = await supabase.from("debates").update({
      ai_analysis:              raw,
      popularity_analysis:      null,
      ai_analysis_status:       "ready",
      ai_analysis_generated_at: new Date().toISOString()
    }).eq("id", debateId);

    if (saveError) {
      console.error(`[auto-analysis] débat ${debateId} — erreur sauvegarde :`, saveError.message);
    } else {
      console.log(`[auto-analysis] débat ${debateId} — analyse générée et sauvegardée.`);
      _notifyParticipantsAnalysisReady(debateId, payload.question, result).catch(console.error);
    }

    // Analyse popularité vs robustesse (colonne séparée)
    try {
      const popularityResult = await generatePopularityAnalysis(result, (messages) => _callOpenAI(apiKey, messages));
      const popularityRaw    = JSON.stringify(popularityResult);
      const { error: popErr } = await supabase.from("debates")
        .update({ popularity_analysis: popularityRaw })
        .eq("id", debateId);
      if (popErr) {
        console.error(`[auto-analysis] débat ${debateId} — erreur sauvegarde popularité :`, popErr.message);
      } else {
        console.log(`[auto-analysis] débat ${debateId} — analyse popularité sauvegardée.`);
      }
    } catch (popErr) {
      console.error(`[auto-analysis] débat ${debateId} — analyse popularité échouée :`, popErr.message);
    }

    return raw;
  } catch (err) {
    console.error(`[auto-analysis] débat ${debateId} — échec :`, err.message);
    await supabase.from("debates").update({ ai_analysis_status: "failed" }).eq("id", debateId);
    throw err;
  }
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
      const scoreLabel = `${best.score}/100`;
      const suffix = scores.length > 1
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
  await supabase.from("notifications").insert(
    [...userKeys].map((user_key) => {
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
    })
  );
  clearNotificationsApiResponseCache();

  for (const user_key of userKeys) {
    _sendPushNow(user_key, {
      type,
      message: messageByUserKey.get(user_key) || message,
      debate_id: debateId,
      argument_id: argumentIdByUserKey.get(user_key) || null
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

// — 1re analyse à 10 pts, puis re-déclenchement tous les 5 pts supplémentaires
async function _scheduleAnalysisIfNeeded(debateId) {
  if (!debateId) return;

  const { data: debate } = await supabase
    .from("debates")
    .select("ai_analysis_status, ai_analysis, ai_analysis_last_score, question")
    .eq("id", debateId)
    .single();

  if (!debate) return;
  const status = debate.ai_analysis_status || "none";

  // Ne pas re-programmer si déjà en attente ou en cours de génération
  if (status === "scheduled" || status === "generating") return;

  const { count: argCount } = await supabase
    .from("arguments")
    .select("*", { count: "exact", head: true })
    .eq("debate_id", debateId);

  const { data: argIds } = await supabase
    .from("arguments")
    .select("id")
    .eq("debate_id", debateId);

  let commentCount = 0;
  if (argIds && argIds.length) {
    const { count } = await supabase
      .from("comments")
      .select("*", { count: "exact", head: true })
      .in("argument_id", argIds.map((a) => a.id));
    commentCount = count || 0;
  }

  const score = (argCount || 0) + commentCount * 0.5;
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
    }).eq("id", debateId);
    console.log(`[auto-analysis] débat ${debateId} — seuil atteint (score ${score}, dernier trigger ${lastScore}), analyse programmée pour ${scheduledAt}`);
    _notifyParticipantsAnalysisScheduled(debateId, debate.question, argIds).catch(console.error);
  }
}

// Scheduler : vérifie toutes les 15 min les analyses à générer
setInterval(async () => {
  try {
    const now = new Date().toISOString();
    const { data: pending } = await supabase
      .from("debates")
      .select("id")
      .eq("ai_analysis_status", "scheduled")
      .lte("ai_analysis_scheduled_at", now);

    for (const row of (pending || [])) {
      await _generateAndSaveAnalysis(row.id);
    }
  } catch (err) {
    console.error("[auto-analysis scheduler]", err.message);
  }
}, 15 * 60 * 1000).unref();

// (anciens prompts _buildAnalysisPrompt1 / _PROMPT2 / _buildPrompt3 déplacés dans lib/debate-analysis.js)

async function _callOpenAI(apiKey, messages, opts = {}) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, temperature: opts.temperature ?? 0.3 })
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw Object.assign(new Error(body || "Erreur OpenAI."), { status: 502 });
  }
  const data = await r.json();
  return data?.choices?.[0]?.message?.content || "";
}

app.post("/api/admin/analyze-debate", requireAdmin, rateLimit("analysis-generate", 5), express.json(), async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_API_KEY manquant." });

  const { debateId } = req.body || {};
  if (!debateId) return res.status(400).json({ error: "debateId manquant." });

  try {
    const raw = await _generateAndSaveAnalysis(debateId);
    const { data: popData } = await supabase.from("debates").select("popularity_analysis").eq("id", debateId).single();
    return res.json({ raw, popularityRaw: popData?.popularity_analysis || null });
  } catch (err) {
    console.error("[analyze-debate]", err.message);
    return res.status(502).json({ error: err.message || "Erreur lors de la génération." });
  }
});

/* ================================================================= */

app.get("/ping", (req, res) => res.json({ ok: true }));

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`Server running on port ${PORT}`);
  purgeExternalPreviewCacheDir(500);
  initDebateTrendsCache().catch(e => console.error("[debate-trends] init error:", e.message));
  _loadVeilleMediasFromSupabase().then(ok => console.log(`[veille-medias] cache ${ok ? "chargé depuis Supabase" : "fichier local (fallback)"}`)).catch(console.error);
  const _readJsonFile = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };
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
        console.log(`[Agôn] Content migré vers Supabase : ${toMigrate.length} débats.`);
      }
    }
  } catch (e) {
    console.error("[Agôn] Erreur migration debate-content:", e.message);
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
        console.log(`[Agôn] Assets migrés vers Supabase : ${toMigrate.length} débats.`);
      }
    }
  } catch (e) {
    console.error("[Agôn] Erreur migration debate-assets:", e.message);
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
        console.log(`[Agôn] Keywords migrés vers Supabase : ${toMigrate.length} débats.`);
      }
    }
  } catch (e) {
    console.error("[Agôn] Erreur migration keywords:", e.message);
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
        console.log(`[Agôn] Stories migrées vers Supabase : ${toMigrate.length} stories.`);
      }
    }
  } catch (e) {
    console.error("[Agôn] Erreur migration stories:", e.message);
  }
  // Chargement tag_exclusions depuis Supabase → public/tag-exclusions.json + mémoire
  try {
    const { data, error } = await supabase.from("app_config").select("value").eq("key", "tag_exclusions").maybeSingle();
    if (!error && Array.isArray(data?.value)) {
      writeTagExclusionFiles(data.value);
      console.log(`[Agôn] Tag exclusions chargés depuis Supabase : ${data.value.length} tags.`);
    } else if (fs.existsSync(tagExclusionsMetaPath)) {
      const parsed = JSON.parse(fs.readFileSync(tagExclusionsMetaPath, "utf8") || "[]");
      if (parsed.length) writeTagExclusionFiles(parsed);
    }
  } catch (e) {
    console.error("[Agôn] Erreur chargement tag_exclusions:", e.message);
  }
  // Chargement shared_debate_links depuis Supabase → cache mémoire
  try {
    const { data, error } = await supabase.from("app_config").select("value").eq("key", "shared_debate_links").maybeSingle();
    if (!error && data?.value && typeof data.value === "object") {
      _sharedLinksCache = data.value;
      console.log(`[Agôn] Shared debate links chargés depuis Supabase : ${Object.keys(data.value).length} liens.`);
    } else {
      const local = _readJsonFile(sharedDebateLinksMetaPath, {});
      if (Object.keys(local).length) {
        _sharedLinksCache = local;
        supabase.from("app_config")
          .upsert({ key: "shared_debate_links", value: local, updated_at: new Date().toISOString() })
          .then(() => {}).catch(() => {});
        console.log(`[Agôn] Shared debate links migrés vers Supabase : ${Object.keys(local).length} liens.`);
      } else {
        _sharedLinksCache = {};
      }
    }
  } catch (e) {
    console.error("[Agôn] Erreur chargement shared_debate_links:", e.message);
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
          if (res.ok) console.log(`[Agôn] Cache /api/debates?sort=${sort} préchauffé.`);
        }
      }
    } catch (e) {
      console.error("[Agôn] Erreur pré-chauffe cache debates:", e);
    }
  }, 2000);
});
