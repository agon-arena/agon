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

// Frontière de PHRASE COMPLÈTE (Phase 2.2, 04/09/2026, correctif "paragraphe
// pédagogique jamais servi tronqué en milieu de phrase") — distincte de
// findBoundary/truncateAtTextBoundary ci-dessus : leur dernier repli
// (`return limit`) peut encore couper au milieu d'un mot voire d'une phrase,
// acceptable pour leur usage réel (tronquer un texte SOURCE avant de
// l'injecter dans un prompt interne, où un bord approximatif n'a aucune
// conséquence visible) mais interdit ici, où le texte est affiché tel quel
// à l'utilisateur. Ne coupe donc JAMAIS ailleurs qu'à une ponctuation finale
// (. ! ? …) déjà présente dans le texte lui-même, jamais une ponctuation
// ajoutée artificiellement — si aucune fin de phrase ne tombe sous
// `maxChars` (paragraphe sans ponctuation forte, ou une seule phrase déjà
// plus longue que le plafond), renvoie le texte COMPLET plutôt qu'un
// fragment corrompu : le plafond reste un budget d'affichage indicatif,
// jamais une contrainte technique dure (aucune limite de colonne/JSONB en
// jeu côté appelants connus).
function truncateAtSentenceBoundary(value, maxChars) {
  const text = String(value || "").trim();
  if (text.length <= maxChars) return text;
  const sentenceEnd = /[.!?…](?:[»"'”)\]]*)(?=\s|$)/g;
  let lastEnd = 0;
  let match;
  while ((match = sentenceEnd.exec(text))) {
    const end = match.index + match[0].length;
    if (end > maxChars) break;
    lastEnd = end;
  }
  return lastEnd > 0 ? text.slice(0, lastEnd).trim() : text;
}

module.exports = { findBoundary, truncateAtTextBoundary, splitTextAtBoundaries, truncateAtSentenceBoundary };
