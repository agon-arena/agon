const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the visible mobile iframe close button sits above the gradient strip', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const finalRule = css.slice(css.lastIndexOf('Verrou final mobile : le bouton visible de fermeture'));

  assert.match(finalRule, /#debate-iframe-modal\.open #debate-iframe-modal-close/);
  assert.match(finalRule, /bottom:\s*88px\s*!important/);
  assert.match(finalRule, /top:\s*auto\s*!important/);
});

test('the internal back arrow and voice counters share the clearance above the strip', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const clearances = css.match(/bottom:\s*calc\(var\(--mnoria-dock-button-bottom, 68px\) \+ 24px\)\s*!important/g) || [];

  assert.equal(clearances.length, 3);
});
