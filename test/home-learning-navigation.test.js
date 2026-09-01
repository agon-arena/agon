const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const indexHtml = fs.readFileSync(
  path.join(__dirname, '..', 'views', 'index.html'),
  'utf8'
);
const learningHtml = fs.readFileSync(
  path.join(__dirname, '..', 'views', 'qcm-du-jour.html'),
  'utf8'
);

test('the bottom Apprentissages button starts a native navigation immediately', () => {
  const link = indexHtml.match(
    /<a\b[^>]*href="\/apprentissage"[^>]*aria-label="Apprentissages"[^>]*>/
  );

  assert.ok(link, 'the bottom navigation link should exist');
  assert.doesNotMatch(link[0], /onclick=/);
  assert.doesNotMatch(link[0], /preventDefault|openDebateIframeModal/);
});

test('the learning page document is prefetched from the homepage', () => {
  assert.match(
    indexHtml,
    /<link\b[^>]*rel="prefetch"[^>]*href="\/apprentissage"[^>]*as="document"[^>]*>/
  );
});

test('the learning bottom Accueil button navigates on the first click without JavaScript', () => {
  const link = learningHtml.match(
    /<a\b[^>]*href="\/\?skipStartup=1"[^>]*aria-label="Revenir à l'accueil"[^>]*>/
  );

  assert.ok(link, 'the learning page should contain a native home link');
  assert.doesNotMatch(link[0], /onclick=/);
  assert.doesNotMatch(link[0], /qcmBottomNavHome|preventDefault/);
});
