const BASE_TAG_GROUPS = {
  Trump: [
    "trump",
    "donald trump",
    "president trump",
    "trumpisme",
    "maga"
  ],

  IA: [
    "ia",
    "intelligence artificielle",
    "chatgpt",
    "openai",
    "algorithmes",
    "midjourney"
  ],

  "Violences sexuelles": [
    "violences sexuelles",
    "agression sexuelle",
    "agressions sexuelles",
    "harcelement sexuel",
    "violences sexistes",
    "metoo"
  ],

  "Présidentielle 2027": [
    "presidentielle 2027",
    "election presidentielle",
    "elections 2027",
    "presidentielle"
  ],

  "Moyen-Orient": [
    "moyen orient",
    "gaza",
    "israel",
    "iran",
    "palestine",
    "hamas",
    "hezbollah",
    "liban"
  ],

  "Sécurité nucléaire": [
    "securite nucleaire",
    "nucleaire",
    "centrale nucleaire",
    "centrales nucleaires",
    "accident nucleaire",
    "tchernobyl",
    "fukushima",
    "bombe atomique",
    "arme nucleaire",
    "armes nucleaires",
    "dissuasion nucleaire",
    "proliferation nucleaire",
    "reacteur nucleaire"
  ]
};

const TAG_GROUPS = {};
const EXCLUDED_TAGS = new Set();

function normalizeExcludedTags(tags) {
  const seen = new Set();
  (Array.isArray(tags) ? tags : []).forEach((tag) => {
    const key = normalizeTag(tag);
    if (key) seen.add(key);
  });
  return Array.from(seen).sort();
}

function replaceExcludedTags(tags) {
  EXCLUDED_TAGS.clear();
  normalizeExcludedTags(tags).forEach((tag) => EXCLUDED_TAGS.add(tag));
  return getExcludedTags();
}

function getExcludedTags() {
  return Array.from(EXCLUDED_TAGS).sort();
}

function normalizeTagGroupsMap(groups) {
  const normalizedGroups = {};

  Object.entries(groups && typeof groups === "object" ? groups : {}).forEach(([canonical, variants]) => {
    const canonicalTag = cleanReadableTag(canonical);
    if (!canonicalTag) return;

    const seen = new Set();
    const cleanVariants = [];
    (Array.isArray(variants) ? variants : []).forEach((variant) => {
      const cleanVariant = cleanReadableTag(variant);
      const key = normalizeTag(cleanVariant);
      if (!cleanVariant || seen.has(key)) return;
      seen.add(key);
      cleanVariants.push(cleanVariant);
    });

    if (!seen.has(normalizeTag(canonicalTag))) {
      cleanVariants.unshift(canonicalTag);
    }

    normalizedGroups[canonicalTag] = cleanVariants;
  });

  return normalizedGroups;
}

function replaceTagGroups(groups) {
  Object.keys(TAG_GROUPS).forEach((key) => delete TAG_GROUPS[key]);
  Object.assign(TAG_GROUPS, normalizeTagGroupsMap(groups));
  return getTagGroups();
}

function getTagGroups() {
  return JSON.parse(JSON.stringify(TAG_GROUPS));
}

replaceTagGroups(BASE_TAG_GROUPS);

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

  if (Array.isArray(parsed)) {
    return parsed.flatMap(flattenTagValue);
  }

  if (parsed && typeof parsed === "object") {
    return Object.values(parsed).flatMap(flattenTagValue);
  }

  if (typeof parsed === "string") {
    return parsed.split(",").map((tag) => tag.trim());
  }

  return [];
}

function normalizeTag(tag) {
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

function getCanonicalTag(rawTag) {
  const normalized = normalizeTag(rawTag);
  if (!normalized || EXCLUDED_TAGS.has(normalized)) return "";

  for (const [canonicalTag, variants] of Object.entries(TAG_GROUPS)) {
    if (variants.map(normalizeTag).includes(normalized)) {
      return canonicalTag;
    }
  }

  return cleanReadableTag(rawTag);
}

function getCanonicalTagsFromItem(item) {
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

function extractRawTagsFromItem(item) {
  if (!item || typeof item !== "object") return [];

  const possibleFields = [
    item.keywords,
    item.tags,
    item.article_tags,
    item.topic_tags,
    item.subjects
  ];

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

function getItemDate(item) {
  if (!item || typeof item !== "object") return null;

  const value = item.published_at
    || item.created_at
    || item.added_at
    || item.addedAt
    || item.date
    || item.timestamp;

  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function filterItemsByPeriod(items, startDate, endDate) {
  const start = startDate instanceof Date ? startDate : new Date(startDate);
  const end = endDate instanceof Date ? endDate : new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  return (Array.isArray(items) ? items : []).filter((item) => {
    const date = getItemDate(item);
    if (!date) return false;
    return date >= start && date < end;
  });
}

function countCanonicalTagsForItems(items) {
  const counts = {};

  (Array.isArray(items) ? items : []).forEach((item) => {
    getCanonicalTagsFromItem(item).forEach((tag) => {
      counts[tag] = (counts[tag] || 0) + 1;
    });
  });

  return counts;
}

function getTrendPercent(currentCount, previousCount) {
  const current = Number.isFinite(Number(currentCount)) ? Number(currentCount) : 0;
  const previous = Number.isFinite(Number(previousCount)) ? Number(previousCount) : 0;

  if (current <= 0 && previous <= 0) return 0;
  if (previous <= 0) return current > 0 ? 100 : 0;

  return Math.round(((current - previous) / previous) * 100);
}

function buildTagTrends(items, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) return [];

  const limit = Number.isFinite(Number(options.limit)) ? Math.max(0, Number(options.limit)) : 12;
  const dayMs = 24 * 60 * 60 * 1000;
  const currentStart = new Date(now.getTime() - (7 * dayMs));
  const previousStart = new Date(now.getTime() - (14 * dayMs));

  const currentItems = filterItemsByPeriod(items, currentStart, now);
  const previousItems = filterItemsByPeriod(items, previousStart, currentStart);
  const currentCounts = countCanonicalTagsForItems(currentItems);
  const previousCounts = countCanonicalTagsForItems(previousItems);

  return Object.entries(currentCounts)
    .map(([tag, count]) => {
      const previousCount = previousCounts[tag] || 0;
      return {
        tag,
        count,
        previousCount,
        trend: getTrendPercent(count, previousCount)
      };
    })
    .sort((a, b) => (b.count - a.count) || (b.trend - a.trend) || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

module.exports = {
  TAG_GROUPS,
  getTagGroups,
  replaceTagGroups,
  normalizeTagGroupsMap,
  getExcludedTags,
  replaceExcludedTags,
  normalizeExcludedTags,
  normalizeTag,
  extractRawTagsFromItem,
  getCanonicalTag,
  getCanonicalTagsFromItem,
  getItemDate,
  filterItemsByPeriod,
  countCanonicalTagsForItems,
  getTrendPercent,
  buildTagTrends
};
