const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

test('mobile debate episode buttons use the compact height', () => {
  assert.match(
    css,
    /@media \(max-width: 768px\)[\s\S]*?body\.page-debate \.debate-episode-link\s*\{\s*min-height:\s*24px;\s*padding:\s*2px 8px;/
  );
});
