const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

test('la pastille source des cartes Communauté reste au-dessus du dégradé de 40px', () => {
  assert.match(css, /\.debate-card\.debate-card--community \.index-card-media-with-title::after\s*\{[\s\S]*?height:\s*40px !important;/);
  assert.match(css, /body\.page-home-mobile \.debate-card\.debate-card--community \.debate-source-card-image-domain-badge\s*\{[\s\S]*?bottom:\s*48px !important;/);
});
