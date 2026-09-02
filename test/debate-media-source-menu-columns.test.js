const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('the debate media menu uses centered columns of 15 items', () => {
  const css = fs.readFileSync(path.join(root, 'public/style.css'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public/script.js'), 'utf8');

  assert.match(css, /grid-template-rows:\s*repeat\(15,/);
  assert.match(css, /grid-auto-flow:\s*column/);
  assert.match(css, /grid-auto-columns:\s*132px/);
  assert.match(css, /left:\s*var\(--debate-media-menu-center-left/);
  assert.match(script, /--debate-media-menu-center-left/);
  assert.match(script, /getBoundingClientRect\(\)\.left/);
  assert.match(script, /document\.documentElement\.clientWidth \/ 2/);
  assert.match(script, /const menuRowCount = Math\.min\(15, count\)/);
  assert.match(script, /grid-template-rows:repeat\(\$\{menuRowCount\}/);
});
