const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'script.js'), 'utf8');

test('l’espace sous Trier / Rechercher est réduit de 3px dans tous les modes', () => {
  assert.match(css, /body\.page-home-mobile \.index-explorer-topbar\s*\{\s*margin-bottom:\s*-13px;/);
  assert.match(css, /not\(:has\(#mnoria-tag-trends-cloud\.mnoria-memoire-frame\)\) \.index-explorer-topbar\s*\{[\s\S]*?margin-bottom:\s*-27px;/);
  assert.match(script, /const MNORIA_SORT_BTN_BOTTOM_GAP = 21;/);
  assert.match(script, /bandTargetTopFromSort = sortBottomDocAfterFix \+ MNORIA_SORT_BTN_BOTTOM_GAP;/);
});
