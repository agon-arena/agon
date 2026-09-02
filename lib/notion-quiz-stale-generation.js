'use strict';

// Les générations Expert observées prennent habituellement 4 à 6 minutes.
// Quinze minutes laisse une marge importante aux appels/retries successifs,
// tout en restant sous l'expiration locale historique de 30 minutes.
const NOTION_QUIZ_STALE_AFTER_MS = 15 * 60 * 1000;

function notionQuizGenerationIdentity(slot) {
  return String(slot || '').trim().replace(/:(?:elementaire|avance|expert)$/, '');
}

function isOrphanedNotionQuizGeneration({
  startedAt,
  now = Date.now(),
  isActive = false,
  quizExists = false,
  failureExists = false,
  staleAfterMs = NOTION_QUIZ_STALE_AFTER_MS
} = {}) {
  const startedAtMs = Number(startedAt);
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) return false;
  if (isActive || quizExists || failureExists) return false;
  return now - startedAtMs > staleAfterMs;
}

module.exports = {
  NOTION_QUIZ_STALE_AFTER_MS,
  notionQuizGenerationIdentity,
  isOrphanedNotionQuizGeneration
};
