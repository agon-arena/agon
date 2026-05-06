require("dotenv").config();
const express = require("express");
const compression = require("compression");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { createCanvas, loadImage } = require("canvas");
const { createClient } = require("@supabase/supabase-js");
const { validateLegacyKey, resolveLegacyUser } = require("./lib/users");

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

const MAX_VOTES_PER_DEBATE = 5;
const adminTokens = new Set();
const AGON_ADMIN_CREATOR_KEY = "__AGON_ADMIN__";

app.use(express.json({ limit: "100kb" }));
app.use(express.static("public", { maxAge: "2m" }));
app.use("/migration-export", express.static("/var/data"));

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

function replaceMetaPlaceholders(template, meta) {
  return String(template || "")
    .replaceAll("__META_TITLE__", escapeMetaContent(meta.title || "agôn"))
    .replaceAll("__META_DESCRIPTION__", escapeMetaContent(meta.description || ""))
    .replaceAll("__META_URL__", escapeMetaContent(meta.url || ""))
    .replaceAll("__META_IMAGE__", escapeMetaContent(meta.image || ""))
    .replaceAll("__META_IMAGE_ALT__", escapeMetaContent(meta.imageAlt || "agôn"));
}

function buildIndexMeta(req) {
  return {
    title: "agôn – L'arène des idées | Réseau d'intelligence collective",
    description: "agôn est un réseau de confrontation des idées fondé sur l’intelligence collective. Il permet de visualiser les désaccords, de suivre l’évolution des points de vue et de faire émerger les idées les plus convaincantes.",
    url: buildAbsoluteUrl(req, "/"),
    image: buildAbsoluteUrl(req, "/logo2.jpeg"),
    imageAlt: "agôn — l'arène des idées"
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
    : buildAbsoluteUrl(req, "/logo2.jpeg");
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

function normalizeOgCanvasText(value) {
  return decodeHtmlEntities(String(value ?? ""))
    .normalize("NFC")
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
const MAX_DEBATE_VIDEO_BYTES = 80 * 1024 * 1024;
const SUPABASE_DEBATE_MEDIA_BUCKET = String(process.env.SUPABASE_DEBATE_MEDIA_BUCKET || "debate-media").trim() || "debate-media";

const debateContentMetaPath = path.join(__dirname, "data", "debate-content.json");

function ensureDebateContentStorage() {
  fs.mkdirSync(path.dirname(debateContentMetaPath), { recursive: true });
  if (!fs.existsSync(debateContentMetaPath)) {
    fs.writeFileSync(debateContentMetaPath, "{}", "utf8");
  }
}

let _debateContentMapCache = null;

function readDebateContentMap() {
  if (_debateContentMapCache) return _debateContentMapCache;
  ensureDebateContentStorage();
  try {
    _debateContentMapCache = JSON.parse(fs.readFileSync(debateContentMetaPath, "utf8") || "{}");
    return _debateContentMapCache;
  } catch (error) {
    return {};
  }
}

function writeDebateContentMap(map) {
  ensureDebateContentStorage();
  fs.writeFileSync(debateContentMetaPath, JSON.stringify(map, null, 2), "utf8");
  _debateContentMapCache = map;
}

function normalizeDebateContent(value) {
  return String(value || "").trim().slice(0, 1800);
}

function getDebateStoredContent(debateId) {
  const map = readDebateContentMap();
  return normalizeDebateContent(map?.[String(debateId)] || "");
}

function setDebateStoredContent(debateId, content) {
  const map = readDebateContentMap();
  const debateKey = String(debateId);
  const safeContent = normalizeDebateContent(content);

  if (!safeContent) {
    delete map[debateKey];
  } else {
    map[debateKey] = safeContent;
  }

  writeDebateContentMap(map);
}

function removeDebateStoredContent(debateId) {
  const map = readDebateContentMap();
  delete map[String(debateId)];
  writeDebateContentMap(map);
}

function ensureDebateAssetsStorage() {
  fs.mkdirSync(debateImagesDir, { recursive: true });
  fs.mkdirSync(debateVideosDir, { recursive: true });
  fs.mkdirSync(path.dirname(debateAssetsMetaPath), { recursive: true });

  if (!fs.existsSync(debateAssetsMetaPath)) {
    fs.writeFileSync(debateAssetsMetaPath, "{}", "utf8");
  }
}

let _debateAssetsMapCache = null;

function readDebateAssetsMap() {
  if (_debateAssetsMapCache) return _debateAssetsMapCache;
  ensureDebateAssetsStorage();
  try {
    _debateAssetsMapCache = JSON.parse(fs.readFileSync(debateAssetsMetaPath, "utf8") || "{}");
    return _debateAssetsMapCache;
  } catch (error) {
    return {};
  }
}

function writeDebateAssetsMap(map) {
  ensureDebateAssetsStorage();
  fs.writeFileSync(debateAssetsMetaPath, JSON.stringify(map, null, 2), "utf8");
  _debateAssetsMapCache = map;
}

function getDebateAssetsEntry(debateId) {
  const map = readDebateAssetsMap();
  const entry = map?.[String(debateId)];
  return entry && typeof entry === "object" ? entry : {};
}

function updateDebateAssetsEntry(debateId, partial) {
  const map = readDebateAssetsMap();
  const debateKey = String(debateId);
  const previous = map?.[debateKey] && typeof map[debateKey] === "object" ? map[debateKey] : {};
  const next = {
    ...previous,
    ...partial
  };

  if (!String(next.image_url || "").trim()) {
    delete next.image_url;
  }

  if (!String(next.video_url || "").trim()) {
    delete next.video_url;
  }

  if (!Object.keys(next).length) {
    delete map[debateKey];
  } else {
    map[debateKey] = next;
  }

  writeDebateAssetsMap(map);
}

function removeDebateAssetsEntry(debateId) {
  const map = readDebateAssetsMap();
  delete map[String(debateId)];
  writeDebateAssetsMap(map);
}

function getDebateStoredImageUrl(debateId) {
  return String(getDebateAssetsEntry(debateId).image_url || "").trim();
}

function getDebateStoredVideoUrl(debateId) {
  return String(getDebateAssetsEntry(debateId).video_url || "").trim();
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
  return getDebateDbMediaUrl(debate, "image_url") || getDebateStoredImageUrl(debate?.id);
}

function getResolvedDebateVideoUrl(debate) {
  return getDebateDbMediaUrl(debate, "video_url") || getDebateStoredVideoUrl(debate?.id);
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

  updateDebateAssetsEntry(debateId, {
    image_url: imageUrl,
    video_url: videoUrl
  });

  const { error } = await supabase
    .from("debates")
    .update({
      image_url: imageUrl,
      video_url: videoUrl
    })
    .eq("id", debateId);

  if (error) {
    const message = String(error.message || "");
    const details = String(error.details || "");
    const hint = String(error.hint || "");
    const combined = `${message} ${details} ${hint}`.toLowerCase();

    if (
      combined.includes("image_url") ||
      combined.includes("video_url") ||
      combined.includes("column")
    ) {
      console.warn("Colonnes image_url/video_url absentes dans debates : fallback local conservé.");
      return;
    }

    throw error;
  }
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
  const extension = getVideoExtensionFromMimeType(normalizedType) || getVideoExtensionFromFilename(fileName);

  if (!extension) {
    throw new Error("Format vidéo non pris en charge.");
  }

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
  const normalizedDbContent = normalizeDebateContent(debate.content || "");
  const normalizedStoredContent = getDebateStoredContent(debate?.id);
  const resolvedContent = normalizedStoredContent.length > normalizedDbContent.length
    ? normalizedStoredContent
    : normalizedDbContent;

  return {
    ...debate,
    image_url: getResolvedDebateImageUrl(debate),
    video_url: getResolvedDebateVideoUrl(debate),
    content: resolvedContent
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
    new RegExp(`(?:"|')(${wanted.join('|')})(?:"|')\\s*:\\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)')`, 'i'),
    new RegExp(`(?:"|')(${wanted.join('|')})(?:"|')\\s*:\\s*\{[^}]*?(?:"|')url(?:"|')\\s*:\\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)')`, 'i')
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

  return {
    url: requestedUrl,
    finalUrl: canonicalUrl || finalUrl || requestedUrl,
    canonicalUrl: canonicalUrl || finalUrl || requestedUrl,
    domain,
    title: title || domain,
    description,
    image,
    siteName: siteName || domain
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

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const html = response.ok ? await response.text() : "";

    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url || url,
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

    if (!merged.domain && preview.domain) {
      merged.domain = preview.domain;
    }
  }

  for (const preview of candidates) {
    if (!merged.image && preview.image) merged.image = preview.image;
    if (!merged.title && preview.title) merged.title = preview.title;
    if (!merged.description && preview.description) merged.description = preview.description;
    if (!merged.siteName && preview.siteName) merged.siteName = preview.siteName;
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

const externalPreviewCache = new Map();
const externalPreviewInFlightRequests = new Map();
const EXTERNAL_PREVIEW_CACHE_DIR = path.join(__dirname, "data", "external-preview-cache");
const debatesApiResponseCache = new Map();
const DEBATES_API_CACHE_TTL_MS = 45 * 1000;
const debateDetailResponseCache = new Map();
const DEBATE_DETAIL_CACHE_TTL_MS = 30 * 1000;
const notificationsApiResponseCache = new Map();
const NOTIFICATIONS_API_CACHE_TTL_MS = 15 * 1000;

function getDebatesApiCacheKey({ limit = null, offset = 0, sort = "popular" } = {}) {
  const normalizedSort = ["popular", "recent", "old", "ideas"].includes(String(sort || ""))
    ? String(sort)
    : "popular";

  return JSON.stringify({
    limit: Number.isFinite(limit) && limit > 0 ? limit : null,
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
    sort: normalizedSort
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
  debatesApiResponseCache.set(String(key || ""), {
    value,
    expiresAt: Date.now() + ttlMs
  });
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

  debateDetailResponseCache.set(key, {
    value,
    expiresAt: Date.now() + DEBATE_DETAIL_CACHE_TTL_MS
  });
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

function invalidateDebateCaches(debateId = null, { clearList = true } = {}) {
  if (clearList) clearDebatesApiResponseCache();
  clearDebateDetailResponseCache(debateId);
  if (debateId) {
    ogImageCache.delete(String(debateId));
  } else if (clearList) {
    ogImageCache.clear();
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

  notificationsApiResponseCache.set(key, {
    value,
    expiresAt: Date.now() + NOTIFICATIONS_API_CACHE_TTL_MS
  });
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
  if (externalPreviewCache.size >= 300) {
    externalPreviewCache.delete(externalPreviewCache.keys().next().value);
  }
  externalPreviewCache.set(url, {
    value,
    expiresAt: Date.now() + ttlMs
  });
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

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text || "").split(" ");
  let line = "";
  let currentY = y;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;

    if (testWidth > maxWidth && n > 0) {
      ctx.fillText(line, x, currentY);
      line = words[n] + " ";
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }

  ctx.fillText(line, x, currentY);
}

function wrapTextCentered(ctx, text, centerX, y, maxWidth, lineHeight) {
  const words = String(text || "").split(" ");
  let line = "";
  let currentY = y;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;

    if (testWidth > maxWidth && n > 0) {
      const lineWidth = ctx.measureText(line).width;
      ctx.fillText(line, centerX - lineWidth / 2, currentY);
      line = words[n] + " ";
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }

  const lineWidth = ctx.measureText(line).width;
  ctx.fillText(line, centerX - lineWidth / 2, currentY);
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

function getNotificationContentLabel(value, maxLength = 90) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function quoteNotificationContent(value, maxLength = 90) {
  const label = getNotificationContentLabel(value, maxLength);
  return label ? `« ${label} »` : "";
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
  const { data, error } = await supabase
    .from("arguments")
    .select("*")
    .eq("debate_id", debateId)
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

async function getUserVotesUsedInDebate(debateId, voterKey) {
  try {
    const { data, error } = await supabase
      .from("votes")
      .select("vote_count, arguments!inner(debate_id)")
      .eq("voter_key", voterKey)
      .eq("arguments.debate_id", debateId);

    if (!error) {
      return (data || []).reduce((sum, row) => sum + Number(row.vote_count || 0), 0);
    }
  } catch (error) {
    // fallback silencieux vers l'ancienne logique
  }

  const { data: args, error: argsErr } = await supabase
    .from("arguments")
    .select("id")
    .eq("debate_id", debateId);

  if (argsErr) throw argsErr;

  const argumentIds = (args || []).map((a) => a.id);
  if (!argumentIds.length) return 0;

  const { data: votes, error: votesErr } = await supabase
    .from("votes")
    .select("vote_count")
    .eq("voter_key", voterKey)
    .in("argument_id", argumentIds);

  if (votesErr) throw votesErr;

  return (votes || []).reduce((sum, row) => sum + Number(row.vote_count || 0), 0);
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
  res.type("html").send(html);
});

app.get("/debates", (req, res) => {
  const template = readViewTemplate("index.html");
  const html = replaceMetaPlaceholders(template, buildIndexMeta(req));
  res.type("html").send(html);
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
  res.sendFile(path.join(__dirname, "views/create.html"));
});

app.get("/notifications", (req, res) => {
  res.sendFile(path.join(__dirname, "views/notifications.html"));
});

app.get("/debate", async (req, res) => {
  const template = readViewTemplate("debate.html");
  const debateId = String(req.query.id || "").trim();

  if (!debateId) {
    const html = replaceMetaPlaceholders(template, {
      title: "Débat | agôn",
      description: "Découvrez les débats et les idées qui s'affrontent sur agôn.",
      url: buildAbsoluteUrl(req, "/debate"),
      image: buildAbsoluteUrl(req, "/logo2.jpeg"),
      imageAlt: "agôn — l'arène des idées"
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
        image: buildAbsoluteUrl(req, "/logo2.jpeg"),
        imageAlt: "agôn — l'arène des idées"
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
      image: buildAbsoluteUrl(req, "/logo2.jpeg"),
      imageAlt: "agôn — l'arène des idées"
    });
    return res.type("html").send(html);
  }
});

app.get("/admin-reports", (req, res) => {
  res.sendFile(path.join(__dirname, "views/admin-reports.html"));
});

/* =========================
   OPEN GRAPH SHARE ROUTES
========================= */

app.get("/debate/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const cached = ogImageCache.get(String(id));
    if (cached) {
      res.setHeader("Content-Type", "image/png");
      return res.send(cached);
    }

    const [debate, args] = await Promise.all([
      getDebateById(id),
      getArgumentsByDebateId(id)
    ]);

    if (!debate) {
      return res.status(404).send("Débat introuvable.");
    }    const { percentA, percentB } = computeDebatePercents(args);
    const isOpen = String(debate?.type || "").trim().toLowerCase() === "open";

    const canvas = createCanvas(1200, 630);
    const ctx = canvas.getContext("2d");
    const logoPath = path.join(__dirname, "public/logo2.jpeg");
    const logo = await loadImage(logoPath);

    const cardWidth = 1200;
    const cardHeight = 630;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cardWidth, cardHeight);

    const logoWidth = 220;
    const logoHeight = 220;
    const logoX = (cardWidth - logoWidth) / 2;
    const logoY = 28;

    ctx.drawImage(logo, logoX, logoY, logoWidth, logoHeight);

    ctx.fillStyle = "#111111";
    ctx.font = "bold 42px Arial";
    wrapTextCentered(ctx, normalizeOgCanvasText(debate.question || "Débat sur agôn"), cardWidth / 2, 250, 920, 52);

    if (isOpen) {
      ctx.fillStyle = "#4b5563";
      ctx.font = "28px Arial";
      ctx.textAlign = "center";
      wrapTextCentered(ctx, normalizeOgCanvasText("Découvrez les idées partagées sur agôn - l'arène des idées"), cardWidth / 2, 380, 860, 38);

      ctx.fillStyle = "#6b7280";
      ctx.font = "24px Arial";
      ctx.fillText("Participez et ajoutez votre réponse", cardWidth / 2, 540);
      ctx.textAlign = "left";
    } else {
      const barX = 140;
      const barY = 340;
      const barWidth = 920;
      const barHeight = 26;

      const fillA = Math.round((barWidth * percentA) / 100);
      const fillB = barWidth - fillA;

      ctx.font = "bold 32px Arial";

      ctx.fillStyle = "#0f766e";
      ctx.fillText(`${percentA}%`, 140, 315);

      ctx.fillStyle = "#b91c1c";
      const textB = `${percentB}%`;
      const textBWidth = ctx.measureText(textB).width;
      ctx.fillText(textB, 1060 - textBWidth, 315);

      ctx.fillStyle = "#e5e7eb";
      ctx.fillRect(barX, barY, barWidth, barHeight);

      ctx.fillStyle = "#0f766e";
      ctx.fillRect(barX, barY, fillA, barHeight);

      ctx.fillStyle = "#b91c1c";
      ctx.fillRect(barX + fillA, barY, fillB, barHeight);

      ctx.strokeStyle = "#d1d5db";
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, barWidth, barHeight);

      ctx.fillStyle = "#111111";
      ctx.font = "bold 28px Arial";

      wrapText(ctx, normalizeOgCanvasText(debate.option_a || ""), 140, 430, 380, 38);
      wrapText(ctx, normalizeOgCanvasText(debate.option_b || ""), 680, 430, 380, 38);

      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(600, 405);
      ctx.lineTo(600, 530);
      ctx.stroke();

      ctx.fillStyle = "#4b5563";
      ctx.font = "28px Arial";
      ctx.textAlign = "center";
      ctx.fillText(normalizeOgCanvasText("Comparez les arguments sur agôn - l'arène des idées"), cardWidth / 2, 590);
      ctx.textAlign = "left";
    }

    const pngBuffer = await new Promise((resolve, reject) => {
      const chunks = [];
      const stream = canvas.createPNGStream();
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });

    ogImageCache.set(String(id), pngBuffer);

    res.setHeader("Content-Type", "image/png");
    res.send(pngBuffer);
  } catch (error) {
    console.error(error);
    res.status(500).send("Erreur génération image");
  }
});

app.post("/api/link-preview", rateLimit("preview", 30), async (req, res) => {
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
    .catch((err) => console.error("track-visit:", err));
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
   ADMIN
========================= */

app.post("/api/admin/login", (req, res) => {
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
      removeDebateAssetsEntry(debateId);
      removeDebateStoredContent(debateId);
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

    const storedImageUrl = getDebateStoredImageUrl(debateId);
    const storedVideoUrl = getDebateStoredVideoUrl(debateId);

    if (storedImageUrl) {
      deleteLocalMediaFile(storedImageUrl, debateImagesDir);
    }

    if (storedVideoUrl) {
      deleteLocalMediaFile(storedVideoUrl, debateVideosDir);
    }

    removeDebateAssetsEntry(debateId);
    removeDebateStoredContent(debateId);

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

app.get("/api/notifications", async (req, res) => {
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

app.post("/api/notifications/read-all", async (req, res) => {
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

app.post("/api/notifications/delete-all", async (req, res) => {
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

app.post("/api/notifications/read-one", async (req, res) => {
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
function addToMediaExtras(currentExtras, type, url) {
  const arr = Array.isArray(currentExtras) ? [...currentExtras] : [];
  const normalized = String(url || "").trim();
  if (!normalized) return arr;
  if (arr.some(e => e.url === normalized)) return arr;
  arr.push({ type, url: normalized, added_at: new Date().toISOString() });
  return arr;
}

app.put("/api/admin/debate/:id", requireAdmin, async (req, res) => {
  try {
    const { question, option_a, option_b, source_url, content, category, image_url, video_url, mark_as_agon_generated } = req.body || {};
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
      .select("image_url, video_url, source_url, media_extras, creator_key")
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
      // source_url : si remplacée → historique
      if (sourceUrlSent && normalizedSourceUrl !== currentRow.source_url && currentRow.source_url) {
        if (normalizedSourceUrl) {
          newExtras = addToMediaExtras(newExtras, 'source', currentRow.source_url);
        }
      }
    }

    const extrasChanged = JSON.stringify(newExtras) !== JSON.stringify(currentRow?.media_extras || []);

    const updateFields = {
      question, option_a, option_b,
      source_url: normalizedSourceUrl || "",
      content: normalizedContent,
      ...(normalizedCategory ? { category: normalizedCategory } : {}),
      ...(imageUrlSent ? { image_url: normalizedImageUrl || "" } : {}),
      ...(videoUrlSent ? { video_url: normalizedVideoUrl || "" } : {}),
      ...(extrasChanged ? { media_extras: newExtras } : {}),
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

    setDebateStoredContent(req.params.id, normalizedContent);
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
    const { error } = await supabase
      .from("debates")
      .update({
        bumped_at: new Date().toISOString(),
        creator_key: preserveAgonGenerated ? AGON_ADMIN_CREATOR_KEY : null
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
    const rawLimit = Number.parseInt(String(req.query.limit || ""), 10);
    const rawOffset = Number.parseInt(String(req.query.offset || ""), 10);
    const hasPaginationLimit = Number.isFinite(rawLimit) && rawLimit > 0;
    const safeOffset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
    const requestedSort = String(req.query.sort || "popular").trim().toLowerCase();
    const sortMode = ["popular", "recent", "old", "ideas"].includes(requestedSort)
      ? requestedSort
      : "popular";
    const cacheKey = getDebatesApiCacheKey({
      limit: hasPaginationLimit ? rawLimit : null,
      offset: safeOffset,
      sort: sortMode
    });
    const cachedResponse = getCachedDebatesApiResponse(cacheKey);

    if (cachedResponse) {
      return res.json(cachedResponse);
    }

    // Logique volontairement simple et robuste : on récupère la liste complète
    // des arènes côté serveur, on calcule les compteurs nécessaires, on trie la
    // liste complète, puis seulement après on applique limit/offset. Ainsi le
    // tri "Plus récentes" ne porte jamais sur les 8 cartes déjà chargées côté
    // index, mais sur toute la table Supabase.
    const { data: debates, error } = await supabase
      .from("debates")
      .select("*");

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur lecture débats.");
    }

    const debateRows = debates || [];
    if (!debateRows.length) {
      return res.json([]);
    }

    const debateIds = debateRows.map((d) => d.id);

    const { data: args, error: argsErr } = await supabase
      .from("arguments")
      .select("id,debate_id,side,votes,created_at")
      .in("debate_id", debateIds);

    if (argsErr) {
      console.error(argsErr);
      return sendServerError(res, "Erreur lecture débats.");
    }

    const argsByDebate = new Map();
    const debateIdByArgumentId = new Map();
    for (const arg of args || []) {
      if (!argsByDebate.has(arg.debate_id)) argsByDebate.set(arg.debate_id, []);
      argsByDebate.get(arg.debate_id).push(arg);
      debateIdByArgumentId.set(String(arg.id), arg.debate_id);
    }

    const commentCountByDebate = new Map();
    const lastCommentAtByDebate = new Map();
    const lastVoteAtByDebate = new Map();
    const argumentIds = (args || []).map((arg) => arg.id);

    if (argumentIds.length) {
      const [commentsResult, votesResult] = await Promise.all([
        supabase.from("comments").select("id,argument_id,created_at").in("argument_id", argumentIds),
        supabase.from("votes").select("argument_id,created_at").in("argument_id", argumentIds)
      ]);

      if (commentsResult.error) {
        console.error(commentsResult.error);
        return sendServerError(res, "Erreur lecture débats.");
      }
      if (votesResult.error) {
        console.error(votesResult.error);
        return sendServerError(res, "Erreur lecture débats.");
      }

      for (const comment of commentsResult.data || []) {
        const debateId = debateIdByArgumentId.get(String(comment.argument_id));
        if (!debateId) continue;
        commentCountByDebate.set(debateId, Number(commentCountByDebate.get(debateId) || 0) + 1);

        if (comment.created_at) {
          const previousLastCommentAt = lastCommentAtByDebate.get(debateId);
          if (!previousLastCommentAt || new Date(comment.created_at) > new Date(previousLastCommentAt)) {
            lastCommentAtByDebate.set(debateId, comment.created_at);
          }
        }
      }

      for (const vote of votesResult.data || []) {
        const debateId = debateIdByArgumentId.get(String(vote.argument_id));
        if (!debateId || !vote.created_at) continue;

        const previousLastVoteAt = lastVoteAtByDebate.get(debateId);
        if (!previousLastVoteAt || new Date(vote.created_at) > new Date(previousLastVoteAt)) {
          lastVoteAtByDebate.set(debateId, vote.created_at);
        }
      }
    }

    const rows = debateRows.map((d) => {
      const debateArgs = argsByDebate.get(d.id) || [];
      const argument_count = debateArgs.length;
      const comment_count = Number(commentCountByDebate.get(d.id) || 0);
      const last_argument_at = debateArgs.length
        ? debateArgs
            .map((a) => a.created_at)
            .filter(Boolean)
            .sort()
            .slice(-1)[0]
        : null;
      const last_comment_at = lastCommentAtByDebate.get(d.id) || null;
      const last_vote_at = lastVoteAtByDebate.get(d.id) || null;
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

    if (sortMode === "recent") {
      rows.sort((a, b) => {
        const createdDiff = getRowTime(b, "created_at") - getRowTime(a, "created_at");
        if (createdDiff !== 0) return createdDiff;
        return Number(b.id || 0) - Number(a.id || 0);
      });
    } else if (sortMode === "old") {
      rows.sort((a, b) => {
        const createdDiff = getRowTime(a, "created_at") - getRowTime(b, "created_at");
        if (createdDiff !== 0) return createdDiff;
        return Number(a.id || 0) - Number(b.id || 0);
      });
    } else if (sortMode === "ideas") {
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
      // "popular" / "À la une" : groupe A = arènes ≤ 24h (created_at), toujours avant groupe B.
      // À l'intérieur du groupe B : last_activity_at 8h → bump 7j → last_activity_at global → counts.
      const NEW_ARENA_PRIORITY_MS = 24 * 60 * 60 * 1000;
      const RECENT_ACTIVITY_PRIORITY_WINDOW_MS = 8 * 60 * 60 * 1000;
      const BUMP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const isNew = (row) => row.created_at && (now - new Date(row.created_at).getTime()) < NEW_ARENA_PRIORITY_MS;
      rows.sort((a, b) => {
        const aNew = isNew(a);
        const bNew = isNew(b);
        if (aNew !== bNew) return bNew ? 1 : -1;
        if (aNew && bNew) return new Date(b.created_at) - new Date(a.created_at);

        const aDate = a.last_activity_at || a.last_argument_at || a.created_at || "";
        const bDate = b.last_activity_at || b.last_argument_at || b.created_at || "";
        const aTime = aDate ? new Date(aDate).getTime() : 0;
        const bTime = bDate ? new Date(bDate).getTime() : 0;
        const aActivityRecent = aTime > now - RECENT_ACTIVITY_PRIORITY_WINDOW_MS;
        const bActivityRecent = bTime > now - RECENT_ACTIVITY_PRIORITY_WINDOW_MS;

        if (aActivityRecent !== bActivityRecent) return bActivityRecent ? 1 : -1;
        if (aActivityRecent && bActivityRecent && bTime !== aTime) return bTime - aTime;

        const aBump = a.bumped_at ? new Date(a.bumped_at).getTime() : 0;
        const bBump = b.bumped_at ? new Date(b.bumped_at).getTime() : 0;
        const aRecentBump = aBump > now - BUMP_WINDOW_MS;
        const bRecentBump = bBump > now - BUMP_WINDOW_MS;
        if (aRecentBump !== bRecentBump) return bRecentBump ? 1 : -1;
        if (aRecentBump && bRecentBump && aBump !== bBump) return bBump - aBump;

        if (bTime !== aTime) return bTime - aTime;

        if (b.argument_count !== a.argument_count) return b.argument_count - a.argument_count;
        if (b.comment_count !== a.comment_count) return b.comment_count - a.comment_count;
        if (b.vote_count !== a.vote_count) return b.vote_count - a.vote_count;
        return Number(b.id) - Number(a.id);
      });
    }

    const pagedRows = hasPaginationLimit || safeOffset > 0
      ? rows.slice(safeOffset, hasPaginationLimit ? safeOffset + rawLimit : undefined)
      : rows;

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

    const cacheTtlMs = (sortMode === "recent" || sortMode === "old")
      ? 10 * 1000
      : DEBATES_API_CACHE_TTL_MS;
    setCachedDebatesApiResponse(cacheKey, rowsWithSourcePreview, cacheTtlMs);
    res.json(rowsWithSourcePreview);
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture débats.");
  }
});

app.post("/api/debates", rateLimit("debates", 5), async (req, res) => {
  try {
    const { question, category, source_url, content, resource_mode, image_upload, type, option_a, option_b, creatorKey } = req.body || {};
    const normalizedContent = normalizeDebateContent(content);
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

    setDebateStoredContent(data.id, normalizedContent);

    if (image_upload) {
      try {
        const storedImageUrl = await saveUploadedDebateImage(data.id, image_upload);
        await persistDebateMediaUrls(data.id, {
          image_url: storedImageUrl,
          video_url: ""
        });
      } catch (imageError) {
        console.error(imageError);
        return res.status(400).json({ error: "Erreur enregistrement image." });
      }
    } else {
      await persistDebateMediaUrls(data.id, {
        image_url: "",
        video_url: normalizedResourceMode !== "video" ? "" : getDebateStoredVideoUrl(data.id)
      });
    }

    if (normalizedResourceMode !== "video") {
      await persistDebateMediaUrls(data.id, {
        image_url: image_upload ? getDebateStoredImageUrl(data.id) : "",
        video_url: ""
      });
    }

    clearDebatesApiResponseCache();
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

    const extension = getVideoExtensionFromMimeType(mimeType) || getVideoExtensionFromFilename(fileName);
    if (!extension) {
      return res.status(400).json({ error: "Format vidéo non pris en charge." });
    }

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

app.get("/api/debates/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const cachedResponse = getCachedDebateDetailResponse(id);
    if (cachedResponse) {
      return res.json(cachedResponse);
    }

    const [debate, args] = await Promise.all([
      getDebateById(id),
      getArgumentsByDebateId(id)
    ]);

    if (!debate) {
      return res.status(404).json({ error: "Débat introuvable." });
    }

    const optionA = args.filter((a) => a.side === "A");
    const optionB = args.filter((a) => a.side === "B");
    const argumentIds = args.map((a) => a.id);

    if (!argumentIds.length) {
      const sourcePreview = debate.source_url ? await getExternalLinkPreview(debate.source_url) : null;
      const payload = {
        debate,
        optionA,
        optionB,
        commentsByArgument: {},
        sourcePreview
      };
      setCachedDebateDetailResponse(id, payload);
      return res.json(payload);
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
      debate,
      optionA,
      optionB,
      commentsByArgument,
      sourcePreview
    };

    setCachedDebateDetailResponse(id, payload);
    res.json(payload);
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
    removeDebateAssetsEntry(debateId);
    removeDebateStoredContent(debateId);

    invalidateDebateCaches();
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
    const { debate_id, side, title, body, authorKey } = req.body || {};

    const { data, error } = await supabase
      .from("arguments")
      .insert({
        debate_id,
        side,
        title,
        body,
        author_key: authorKey || null,
        votes: 0,
        created_at: nowIso()
      })
      .select("id")
      .single();

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur création argument.");
    }

    invalidateDebateCaches(debate_id);

    const debateRow = await getDebateById(debate_id);

    if (
      debateRow &&
      debateRow.creator_key &&
      debateRow.creator_key !== authorKey
    ) {
      await createNotification({
        user_key: debateRow.creator_key,
        type: "argument_in_my_debate",
        debate_id,
        argument_id: data.id,
        message: `Votre débat ${quoteNotificationContent(debateRow.question)} a reçu une nouvelle idée : ${quoteNotificationContent(title)}.`
      });
    }

    res.json({ success: true, id: data.id });

    snapshotAndWatchMajority(debate_id, data.id, side, authorKey).catch(console.error);
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
    invalidateDebateCaches(argument?.debate_id || null, { clearList: false });

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
    const { error: updateArgErr } = await supabase
      .from("arguments")
      .update({ votes: newVotes })
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

    invalidateDebateCaches(argument?.debate_id || null, { clearList: false });

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

    invalidateDebateCaches(argumentRow?.debate_id || null);
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
    const safeImprovementTitle = safeStance === "amelioration" ? String(improvement_title || "").trim() : "";
    const safeImprovementBody = safeStance === "amelioration" ? String(improvement_body || "").trim() : "";

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
        content,
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
      await supabase.from("notifications").insert({
        user_key: argumentRow.author_key,
        type: "comment_on_argument",
        debate_id: argumentRow.debate_id || null,
        argument_id,
        comment_id: newCommentId,
        message: argumentRow?.title
          ? `Votre idée ${quoteNotificationContent(argumentRow.title)} a reçu un commentaire : ${quoteNotificationContent(shortPreview, 110)}`
          : shortPreview
            ? `Nouveau commentaire : ${shortPreview}`
            : "Nouveau commentaire sur votre argument",
        is_read: 0,
        created_at: nowIso()
      });
      clearNotificationsApiResponseCache();
    }

    if (reply_to_comment_id) {
      const parentCommentRow = await getCommentById(reply_to_comment_id);

      if (
        parentCommentRow &&
        parentCommentRow.author_key &&
        parentCommentRow.author_key !== (authorKey || null)
      ) {
        await supabase.from("notifications").insert({
          user_key: parentCommentRow.author_key,
          type: "reply_to_comment",
          debate_id: argumentRow?.debate_id || null,
          argument_id,
          comment_id: newCommentId,
          message: parentCommentRow?.content
            ? `Votre commentaire ${quoteNotificationContent(parentCommentRow.content, 110)} a reçu une réponse : ${quoteNotificationContent(shortPreview, 110)}`
            : shortPreview
              ? `Réponse à votre commentaire : ${shortPreview}`
              : "Quelqu’un a répondu à votre commentaire",
          is_read: 0,
          created_at: nowIso()
        });
        clearNotificationsApiResponseCache();
      }
    }

    invalidateDebateCaches(argumentRow?.debate_id || null, { clearList: false });
    return res.json(row);
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
      invalidateDebateCaches(argumentRow?.debate_id || null);
      clearNotificationsApiResponseCache();

      return res.json({
        likes,
        replaced: true,
        argumentId: commentRow.argument_id
      });
    }

    invalidateDebateCaches(argumentRow?.debate_id || null, { clearList: false });
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
