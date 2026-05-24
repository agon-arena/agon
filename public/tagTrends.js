const BASE_TAG_GROUPS = {
  Trump: ["trump", "donald trump", "president trump", "trumpisme", "maga"],
  IA: ["ia", "intelligence artificielle", "chatgpt", "openai", "algorithmes", "midjourney"],
  "Violences sexuelles": ["violences sexuelles", "agression sexuelle", "agressions sexuelles", "harcelement sexuel", "violences sexistes", "metoo"],
  "Présidentielle 2027": ["presidentielle 2027", "election presidentielle", "elections 2027", "presidentielle"],
  "Moyen-Orient": ["moyen orient", "gaza", "israel", "iran", "palestine", "hamas", "hezbollah", "liban"],
  "Sécurité nucléaire": ["securite nucleaire", "nucleaire", "centrale nucleaire", "centrales nucleaires", "accident nucleaire", "tchernobyl", "fukushima", "bombe atomique", "arme nucleaire", "armes nucleaires", "dissuasion nucleaire", "proliferation nucleaire", "reacteur nucleaire"]
};

async function loadTagGroups() {
  try {
    const response = await fetch("/tag-groups.json?v=20260520-admin-edit", { cache: "no-store" });
    if (!response.ok) return BASE_TAG_GROUPS;
    const groups = await response.json();
    return groups && typeof groups === "object" ? groups : BASE_TAG_GROUPS;
  } catch (error) {
    return BASE_TAG_GROUPS;
  }
}

async function loadExcludedTags() {
  try {
    const response = await fetch("/tag-exclusions.json?v=20260520-admin-edit", { cache: "no-store" });
    if (!response.ok) return [];
    const tags = await response.json();
    return Array.isArray(tags) ? tags.map(normalizeTag).filter(Boolean) : [];
  } catch (error) {
    return [];
  }
}

export const TAG_GROUPS = await loadTagGroups();
export const EXCLUDED_TAGS = new Set(await loadExcludedTags());

function parseMaybeJsonTags(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return [];

  if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function flattenTagValue(value) {
  const parsed = parseMaybeJsonTags(value);
  if (Array.isArray(parsed)) return parsed.flatMap(flattenTagValue);
  if (parsed && typeof parsed === "object") return Object.values(parsed).flatMap(flattenTagValue);
  if (typeof parsed === "string") return parsed.split(",").map((tag) => tag.trim());
  return [];
}

export function normalizeTag(tag) {
  return String(tag || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/#/g, "")
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanReadableTag(tag) {
  return String(tag || "")
    .replace(/#/g, "")
    .replace(/['’]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractRawTagsFromItem(item) {
  if (!item || typeof item !== "object") return [];

  const possibleFields = [item.keywords, item.tags, item.article_tags, item.topic_tags, item.subjects];
  const seen = new Set();
  const tags = [];

  possibleFields.flatMap(flattenTagValue).forEach((value) => {
    const tag = String(value || "").replace(/\s+/g, " ").trim();
    if (!tag) return;

    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tags.push(tag);
  });

  return tags;
}

export function getCanonicalTag(rawTag) {
  const normalized = normalizeTag(rawTag);
  if (!normalized || EXCLUDED_TAGS.has(normalized)) return "";

  for (const [canonicalTag, variants] of Object.entries(TAG_GROUPS)) {
    if (variants.map(normalizeTag).includes(normalized)) return canonicalTag;
  }

  return cleanReadableTag(rawTag);
}

export function getCanonicalTagsFromItem(item) {
  const seen = new Set();
  const tags = [];

  extractRawTagsFromItem(item).forEach((rawTag) => {
    const canonicalTag = getCanonicalTag(rawTag);
    if (!canonicalTag) return;

    const key = normalizeTag(canonicalTag);
    if (!key || EXCLUDED_TAGS.has(key) || seen.has(key)) return;
    seen.add(key);
    tags.push(canonicalTag);
  });

  return tags;
}

export function getItemDate(item) {
  if (!item || typeof item !== "object") return null;

  const value = item.published_at || item.created_at || item.added_at || item.addedAt || item.date || item.timestamp;
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}


