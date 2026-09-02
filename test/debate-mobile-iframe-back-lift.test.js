const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

test('the mobile debate back/iframe-close arrow sits above the gradient strip', () => {
  assert.match(
    css,
    /body\.page-debate:not\(\.debate-embedded-frame\) \.mobile-back-button\s*\{\s*bottom:\s*40px\s*!important;/
  );
  assert.match(
    css,
    /body\.page-debate\.debate-embedded-frame \.mobile-back-button\s*\{\s*bottom:\s*calc\(var\(--mnoria-dock-button-bottom, 68px\) \+ 24px\)\s*!important;/
  );
});
