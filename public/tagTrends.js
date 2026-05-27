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

function filterItemsByPeriod(items, startDate, endDate) {
  const start = startDate instanceof Date ? startDate : new Date(startDate);
  const end = endDate instanceof Date ? endDate : new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  return (Array.isArray(items) ? items : []).filter((item) => {
    const date = getItemDate(item);
    return !!date && date >= start && date < end;
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

export function getTrendPercent(currentCount, previousCount) {
  const current = Number.isFinite(Number(currentCount)) ? Number(currentCount) : 0;
  const previous = Number.isFinite(Number(previousCount)) ? Number(previousCount) : 0;
  if (current <= 0 && previous <= 0) return 0;
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

export function buildTagTrends(items, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) return [];

  const limit = Number.isFinite(Number(options.limit)) ? Math.max(0, Number(options.limit)) : 12;
  const dayMs = 24 * 60 * 60 * 1000;
  const currentStart = new Date(now.getTime() - (7 * dayMs));
  const previousStart = new Date(now.getTime() - (14 * dayMs));
  const currentCounts = countCanonicalTagsForItems(filterItemsByPeriod(items, currentStart, now));
  const previousCounts = countCanonicalTagsForItems(filterItemsByPeriod(items, previousStart, currentStart));

  return Object.entries(currentCounts)
    .map(([tag, count]) => ({
      tag,
      count,
      previousCount: previousCounts[tag] || 0,
      trend: getTrendPercent(count, previousCounts[tag] || 0)
    }))
    .sort((a, b) => (b.count - a.count) || (b.trend - a.trend) || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

const SUBJECT_CLOUD_MAX_BUBBLES = 12;
const GENERIC_CLOUD_LABELS = new Set([
  "actualite", "actualites", "politique", "international", "societe", "economie",
  "education", "justice", "culture", "medias", "sport", "sports", "sante",
  "climat", "environnement", "france", "monde", "europe", "debat", "debats",
  "information", "infos"
]);

function normalizeSourceUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  try {
    const origin = globalThis.location?.origin || "http://localhost";
    const parsed = new URL(value, origin);
    return parsed.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function normalizeSourceName(name) {
  const value = String(name || "").trim();
  return value ? normalizeTag(value) : "";
}

function getSourceDate(value, fallbackValue = "") {
  const raw = String(value || fallbackValue || "").trim();
  if (!raw) return null;

  const frenchDateMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (frenchDateMatch) {
    const [, day, month, year] = frenchDateMatch;
    const date = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getSubjectSourceEntries(item) {
  if (!item || typeof item !== "object") return [];

  const entries = [];
  const baseDate = item.source_published_at || item.created_at || item.added_at || "";
  const baseUrl = String(item.source_url || "").trim();
  if (baseUrl) {
    entries.push({
      sourceKey: normalizeSourceUrl(baseUrl),
      date: getSourceDate(item.source_published_at || item.created_at || item.added_at)
    });
  }

  (Array.isArray(item.media_extras) ? item.media_extras : []).forEach((extra) => {
    if (!extra || typeof extra !== "object") return;
    if (String(extra.type || "source").trim() !== "source") return;
    const url = String(extra.url || extra.source_url || "").trim();
    if (!url) return;
    const sourceNameKey = normalizeSourceName(extra.source || extra.media || extra.publisher || "");
    entries.push({
      sourceKey: sourceNameKey || normalizeSourceUrl(url),
      date: getSourceDate(extra.published_at || extra.date || extra.added_at, baseDate)
    });
  });

  return entries.filter((entry) => entry.sourceKey && entry.date);
}

function getSubjectMainTag(item) {
  const values = [
    item?.cloudLabel, item?.cloud_label, item?.mainKeyword, item?.main_keyword,
    item?.mainTag, item?.main_tag, item?.primaryTag, item?.primary_tag,
    item?.tagPrincipal, item?.tag_principal
  ];
  return String(values.find((value) => String(value || "").trim()) || "").trim();
}

function isUsableCloudLabel(value) {
  const label = cleanReadableTag(value);
  if (!label) return false;
  const key = normalizeTag(label);
  return !!key && key.length >= 3 && !GENERIC_CLOUD_LABELS.has(key);
}

function getSpecificCloudLabel(item) {
  const primary = getSubjectMainTag(item);
  if (isUsableCloudLabel(primary)) return cleanReadableTag(primary);
  const fallbackTag = extractRawTagsFromItem(item).find(isUsableCloudLabel);
  return fallbackTag ? cleanReadableTag(fallbackTag) : "";
}

export function buildSubjectCloudMergeCandidates(items, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) return [];

  const limit = Number.isFinite(Number(options.limit)) ? Math.max(0, Number(options.limit)) : 80;
  const dayMs = 24 * 60 * 60 * 1000;
  const currentStart = new Date(now.getTime() - (3 * dayMs));

  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const subjectId = String(item?.id || "").trim();
      const subjectTitle = String(item?.question || item?.title || "").replace(/\s+/g, " ").trim();
      if (!subjectId || !subjectTitle) return null;
      const sourceCount = countSourcesForWindow(item, currentStart, now).size;
      if (sourceCount <= 0) return null;
      const tags = extractRawTagsFromItem(item).slice(0, 6);
      const mainTag = getSubjectMainTag(item);
      const cloudLabel = getSpecificCloudLabel(item);
      return {
        subjectId,
        subjectTitle,
        ...(cloudLabel ? { cloudLabel } : {}),
        ...(mainTag ? { mainTag } : {}),
        ...(tags.length ? { tags } : {})
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

function countSourcesForWindow(item, startDate, endDate) {
  const sources = new Set();
  getSubjectSourceEntries(item).forEach((entry) => {
    if (entry.date >= startDate && entry.date < endDate) {
      sources.add(entry.sourceKey);
    }
  });
  return sources;
}

export function buildSubjectTrends(items, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) return [];

  const requestedLimit = Number.isFinite(Number(options.limit)) ? Math.max(0, Number(options.limit)) : SUBJECT_CLOUD_MAX_BUBBLES;
  const limit = Math.min(SUBJECT_CLOUD_MAX_BUBBLES, requestedLimit);
  const dayMs = 24 * 60 * 60 * 1000;
  const currentStart = new Date(now.getTime() - (3 * dayMs));
  const previousStart = new Date(now.getTime() - (6 * dayMs));

  const subjects = (Array.isArray(items) ? items : [])
    .map((item) => {
      const title = String(item?.question || item?.title || "").trim();
      const cloudLabel = getSpecificCloudLabel(item);
      if (!title || !cloudLabel) return null;
      const currentSources = countSourcesForWindow(item, currentStart, now);
      const previousSources = countSourcesForWindow(item, previousStart, currentStart);
      return {
        tag: cloudLabel,
        subjectId: String(item?.id || "").trim(),
        subjectTitle: title,
        cloudLabel,
        count: currentSources.size,
        previousCount: previousSources.size,
        currentSources,
        previousSources,
        memberSubjectIds: [String(item?.id || "").trim()].filter(Boolean),
        kind: "subject"
      };
    })
    .filter((item) => item && item.count > 0)
    .sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag));

  const byId = new Map(subjects.map((subject) => [subject.subjectId, subject]));
  const consumed = new Set();
  const mergedSubjects = [];
  const mergeGroups = Array.isArray(options.mergeGroups) ? options.mergeGroups : [];

  mergeGroups.forEach((group) => {
    const confidence = Number(group?.confidence);
    const keepId = String(group?.keepSubjectId || "").trim();
    if (!Number.isFinite(confidence) || confidence < 0.8 || !byId.has(keepId) || consumed.has(keepId)) return;
    const mergeIds = [...new Set((Array.isArray(group?.mergeSubjectIds) ? group.mergeSubjectIds : []).map((id) => String(id || "").trim()))]
      .filter((id) => id && byId.has(id) && id !== keepId && !consumed.has(id));
    if (!mergeIds.length) return;

    const members = [keepId, ...mergeIds].map((id) => byId.get(id)).filter(Boolean);
    const keepSubject = byId.get(keepId);
    const cloudLabel = keepSubject?.cloudLabel || members.map((member) => member.cloudLabel).find(isUsableCloudLabel) || "";
    if (!isUsableCloudLabel(cloudLabel)) return;
    const currentSources = new Set();
    const previousSources = new Set();
    const memberSubjectIds = [];
    members.forEach((member) => {
      member.memberSubjectIds.forEach((id) => memberSubjectIds.push(id));
      member.currentSources.forEach((source) => currentSources.add(source));
      member.previousSources.forEach((source) => previousSources.add(source));
    });
    members.forEach((member) => consumed.add(member.subjectId));
    mergedSubjects.push({
      tag: cleanReadableTag(cloudLabel),
      subjectId: keepId,
      subjectTitle: keepSubject?.subjectTitle || "",
      cloudLabel: cleanReadableTag(cloudLabel),
      count: currentSources.size,
      previousCount: previousSources.size,
      currentSources,
      previousSources,
      memberSubjectIds: [...new Set(memberSubjectIds)],
      mergeConfidence: confidence,
      mergeReason: String(group?.reason || "").trim(),
      kind: "subject"
    });
  });

  subjects.forEach((subject) => {
    if (!consumed.has(subject.subjectId)) mergedSubjects.push(subject);
  });

  const rankedSubjects = mergedSubjects
    .map((subject) => ({ ...subject, trend: getTrendPercent(subject.count, subject.previousCount) }))
    .sort((a, b) => (b.count - a.count) || (b.trend - a.trend) || a.tag.localeCompare(b.tag))
    .slice(0, limit);

  const maxCount = rankedSubjects.reduce((max, item) => Math.max(max, Number(item.count || 0)), 0);
  return rankedSubjects.map((item) => ({
    tag: item.tag,
    subjectId: item.subjectId,
    subjectTitle: item.subjectTitle,
    cloudLabel: item.cloudLabel,
    memberSubjectIds: item.memberSubjectIds,
    count: item.count,
    previousCount: item.previousCount,
    trend: item.trend,
    kind: item.kind,
    mergeConfidence: item.mergeConfidence,
    sizeWeight: maxCount > 0 ? item.count / maxCount : 0
  }));
}

