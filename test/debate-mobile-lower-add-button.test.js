const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

test('only the lower mobile debate add button spans and centers on the ideas column', () => {
  assert.match(
    css,
    /@media \(max-width: 768px\)[\s\S]*?body\.page-debate #debate-list-view > \.position-argument-button\s*\{[\s\S]*?width:\s*100%\s*!important;[\s\S]*?margin-right:\s*auto;[\s\S]*?margin-left:\s*auto;/
  );
  assert.doesNotMatch(css, /#debate-top-add-button[^\{]*\{[^}]*width:\s*100%/);
  assert.match(
    css,
    /body\.page-debate #debate-list-view\s*\{\s*gap:\s*12px;/
  );
});
