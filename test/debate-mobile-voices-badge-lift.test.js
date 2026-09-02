const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

test('the mobile voices counter stays above the horizontal gradient strip', () => {
  assert.match(
    css,
    /body\.page-debate:not\(\.debate-embedded-frame\) #voices-float-badge\s*\{[\s\S]*?bottom:\s*56px\s*!important;/
  );
  assert.match(
    css,
    /body\.debate-embedded-frame #voices-float-badge\s*\{[\s\S]*?bottom:\s*calc\(var\(--mnoria-dock-button-bottom, 68px\) \+ 20px\)\s*!important;/
  );
});
