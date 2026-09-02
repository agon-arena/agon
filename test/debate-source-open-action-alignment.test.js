const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('the open-source action is aligned to the right below the source', () => {
  const script = fs.readFileSync(path.join(root, 'public', 'script.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'style.css'), 'utf8');

  assert.match(script, /openSourceHtml = `<div class="debate-source-open-action">/);
  assert.match(script, /debate-source-card-body--with-open-action/);
  assert.match(css, /\.debate-source-open-action\s*\{[\s\S]*?justify-content:\s*flex-end;/);
  assert.match(css, /\.debate-source-card-body\.debate-source-card-body--with-open-action\s*\{[\s\S]*?padding-bottom:\s*8px\s*!important;/);
});
