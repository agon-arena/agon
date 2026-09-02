const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NOTION_QUIZ_STALE_AFTER_MS,
  notionQuizGenerationIdentity,
  isOrphanedNotionQuizGeneration
} = require('../lib/notion-quiz-stale-generation');

test('le délai orphelin est de 15 minutes', () => {
  assert.equal(NOTION_QUIZ_STALE_AFTER_MS, 15 * 60 * 1000);
});

test('un pending ancien, sans activité, QCM ni échec devient orphelin', () => {
  const now = Date.now();
  assert.equal(isOrphanedNotionQuizGeneration({
    startedAt: now - NOTION_QUIZ_STALE_AFTER_MS - 1,
    now
  }), true);
});

test('une génération réellement active ne devient jamais orpheline, même très ancienne', () => {
  const now = Date.now();
  assert.equal(isOrphanedNotionQuizGeneration({
    startedAt: now - 60 * 60 * 1000,
    now,
    isActive: true
  }), false);
});

test('un QCM déjà créé ou un échec déjà inscrit interdit le faux échec stale', () => {
  const now = Date.now();
  const base = { startedAt: now - 60 * 60 * 1000, now };
  assert.equal(isOrphanedNotionQuizGeneration({ ...base, quizExists: true }), false);
  assert.equal(isOrphanedNotionQuizGeneration({ ...base, failureExists: true }), false);
});

test('un pending récent ou sans timestamp exploitable reste pending', () => {
  const now = Date.now();
  assert.equal(isOrphanedNotionQuizGeneration({ startedAt: now - NOTION_QUIZ_STALE_AFTER_MS, now }), false);
  assert.equal(isOrphanedNotionQuizGeneration({ startedAt: 0, now }), false);
  assert.equal(isOrphanedNotionQuizGeneration({ startedAt: 'invalide', now }), false);
});

test('l’identité active ignore uniquement le suffixe de niveau', () => {
  assert.equal(notionQuizGenerationIdentity('notion:custom:6175f94ebf2d88b4:expert'), 'notion:custom:6175f94ebf2d88b4');
  assert.equal(notionQuizGenerationIdentity('notion:histoire:abc:avance'), 'notion:histoire:abc');
});
