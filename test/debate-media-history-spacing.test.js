const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('media orientation buttons sit closer to the debate title card', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

  assert.match(css, /\.debate-media-history\s*\{[\s\S]*?padding:\s*4px 0 4px;/);
  assert.match(css, /body\.page-debate \.debate-hero\s*\{[\s\S]*?margin-top:\s*4px\s*!important;/);
});
