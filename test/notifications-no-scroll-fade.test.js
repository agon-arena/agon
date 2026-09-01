const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const script = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'script.js'),
  'utf8'
);

test('the Notifications page does not install the page-level Suite gradient', () => {
  assert.doesNotMatch(
    script,
    /location\.pathname\s*===\s*["']\/notifications["'][\s\S]{0,200}?attachPageScrollFadeHint/
  );
});
