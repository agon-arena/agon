"use strict";

function findBoundary(text, limit, minRatio = 0.6) {
  if (text.length <= limit) return text.length;
  const floor = Math.max(1, Math.floor(limit * minRatio));
  const window = text.slice(0, limit + 1);
  const candidates = [
    /[.!?](?:["'»”)]*)\s+(?=[A-ZÀ-ÖØ-Ý0-9])/g,
    /\n\s*\n/g,
    /[;:]\s+/g,
    /\s+/g
  ];
  for (const pattern of candidates) {
    let match;
    let last = -1;
    while ((match = pattern.exec(window))) {
      const end = match.index + match[0].length;
      if (end >= floor && end <= limit) last = end;
    }
    if (last > 0) return last;
  }
  return limit;
}

function truncateAtTextBoundary(value, maxChars) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (text.length <= maxChars) return text;
  return text.slice(0, findBoundary(text, maxChars)).trim();
}

function splitTextAtBoundaries(value, maxChars, overlapChars = 240) {
  const text = String(value || "").trim();
  if (!text) return [];
  const chunks = [];
  let cursor = 0;
  while (cursor < text.length) {
    const remaining = text.slice(cursor);
    if (remaining.length <= maxChars) {
      chunks.push(remaining.trim());
      break;
    }
    const size = findBoundary(remaining, maxChars);
    const chunk = remaining.slice(0, size).trim();
    if (chunk) chunks.push(chunk);
    const overlapStart = Math.max(0, size - overlapChars);
    const overlapBoundary = remaining.slice(0, overlapStart).search(/[^\s]/);
    const nextAdvance = Math.max(1, overlapStart + (overlapBoundary >= 0 ? overlapBoundary : 0));
    cursor += nextAdvance;
  }
  return chunks;
}

module.exports = { findBoundary, truncateAtTextBoundary, splitTextAtBoundaries };
