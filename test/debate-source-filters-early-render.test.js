const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'script.js'), 'utf8');

test('cached debate preview renders source orientation buttons before the full API request finishes', () => {
  const start = script.indexOf('function applyDebateCachedPreview(debate) {');
  const end = script.indexOf('\nasync function loadDebate(id) {', start);
  assert.ok(start >= 0 && end > start);

  const body = script.slice(start, end);
  assert.match(body, /initDebateMediaHistory\(d\);/);

  const cachedApply = script.indexOf('applyDebateCachedPreview(p.debate);', end);
  const backgroundFetch = script.indexOf('loadDebateFullData(id).catch(() => {});', cachedApply);
  assert.ok(cachedApply > end && backgroundFetch > cachedApply);
});
