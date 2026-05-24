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
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/#/g, "")
    .replace(/['']/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanReadableTag(tag) {
  return String(tag || "")
    .replace(/#/g, "")
    .replace(/['']/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function getTrendPercent(currentCount, previousCount) {
  const current = Number.isFinite(Number(currentCount)) ? Number(currentCount) : 0;
  const previous = Number.isFinite(Number(previousCount)) ? Number(previousCount) : 0;

  if (current <= 0 && previous <= 0) return 0;
  if (previous <= 0) return current > 0 ? 100 : 0;

  return Math.round(((current - previous) / previous) * 100);
}

module.exports = {
  getExcludedTags,
  replaceExcludedTags,
  normalizeExcludedTags,
  normalizeTag,
  cleanReadableTag,
  extractRawTagsFromItem,
  getTrendPercent
};
