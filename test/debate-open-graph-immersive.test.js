const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('debate Open Graph cards use an immersive frameless treatment', () => {
  const script = fs.readFileSync(path.join(root, 'public', 'script.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'style.css'), 'utf8');

  assert.match(script, /sourceFallback\.classList\.add\("debate-source-fallback-og"\)/);
  assert.match(css, /\.debate-source-fallback\.debate-source-fallback-og[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/);
  assert.match(css, /\.debate-source-fallback-og::before\s*\{[\s\S]*?content:\s*none;/);
  assert.match(css, /\.debate-source-fallback-og > \.debate-source-card[\s\S]*?border:\s*0\s*!important;[\s\S]*?box-shadow:\s*none\s*!important;/);
  // Transition directe photo ↔ bleu pétrole : aucun blanc avant l'image.
  {
    const cardBlockMatch = css.match(/\.debate-source-fallback-og > \.debate-source-card\s*\{[\s\S]*?\n\}/);
    assert.ok(cardBlockMatch, 'expected the Open Graph card rule to exist');
    assert.match(cardBlockMatch[0], /padding-top:\s*0\s*!important/);
    assert.match(cardBlockMatch[0], /background:\s*transparent\s*!important/);

    const afterBlockMatch = css.match(/\.debate-source-fallback-og > \.debate-source-card::after\s*\{[\s\S]*?\n\}/);
    assert.ok(afterBlockMatch, 'expected the obsolete card overlay to be disabled');
    assert.match(afterBlockMatch[0], /content:\s*none/);
  }
  assert.match(css, /\.debate-source-card-image-wrap::after\s*\{[\s\S]*?height:\s*12px;[\s\S]*?#243038 0%[\s\S]*?rgba\(36, 48, 56, 0\) 100%/);
  assert.match(
    css,
    /\.debate-source-fallback-og \.debate-source-card-image-wrap::before\s*\{[\s\S]*?linear-gradient\([\s\S]*?rgba\(255, 255, 255, 0\) 0%[\s\S]*?rgba\(255, 255, 255, 0\.96\) 100%/,
    'the image itself should fade to the same white as the text block, no contrasting color at the seam'
  );
  {
    const bodyBlockMatch = css.match(/\.debate-source-fallback-og \.debate-source-card-body\s*\{[\s\S]*?\n\}/);
    assert.ok(bodyBlockMatch, 'expected the card-body rule to exist');
    assert.match(bodyBlockMatch[0], /calc\(100% - 10px\)/, 'bottom halo should only cover the last ~10px');
    assert.match(bodyBlockMatch[0], /rgba\(36, 48, 56, 0\.1\) 100%/, 'bottom halo should be low-opacity, not a solid #243038 fade');
  }
});
