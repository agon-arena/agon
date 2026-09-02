const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('debate sources expose synchronized carousel dots below the active media', () => {
  const script = fs.readFileSync(path.join(root, 'public', 'script.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'style.css'), 'utf8');

  assert.match(script, /function syncDebateSourceCarouselDots\(\)/);
  assert.match(script, /Math\.min\(10, total\)/);
  assert.match(script, /theme-carousel-dot debate-source-carousel-dot/);
  assert.match(script, /activeMedia\.insertAdjacentElement\("afterend", dots\)/);
  assert.match(script, /syncDebateSourceCarouselDots\(\);/);
  assert.match(script, /element\.querySelector\("\.debate-source-card-image-wrap"\) \|\| element/);
  assert.match(css, /body\.page-debate \.debate-source-carousel-dots\s*\{/);
  assert.match(css, /body\.page-debate \.debate-source-carousel-dots\s*\{[\s\S]*?margin:\s*-3px auto 10px;/);
  assert.match(css, /\.debate-source-card-image-wrap \.debate-media-swipe-hotspot\s*\{[\s\S]*?top:\s*0\s*!important;[\s\S]*?bottom:\s*0\s*!important;/);

  // Sur l'Open Graph, les points vivent DANS le cadre blanc, sous le bouton
  // "Ouvrir la source" — appendChild dans .debate-source-card-body plutôt
  // que placés en dehors de la carte via insertAdjacentElement.
  assert.match(script, /const ogCardBody = activeMedia\.classList\.contains\("debate-source-fallback-og"\)/);
  assert.match(script, /ogCardBody\.appendChild\(dots\)/);
  assert.match(
    css,
    /body\.page-debate \.debate-source-fallback-og \.debate-source-card-body \.debate-source-carousel-dots\s*\{/,
    'dots nested inside the OG card body should get their own layout override'
  );

  // Bug réel corrigé : quand hotspotHost (image-wrap, OG) diffère de element
  // (fallback), seul `element` recevait dataset.sourceSwipeEnabled. La règle
  // CSS générique `.debate-source-swipe-enabled:not([data-source-swipe-enabled="1"])
  // .debate-media-swipe-hotspot { display:none }` matchait alors l'image-wrap
  // (classe présente, attribut absent) et masquait les flèches sur l'Open
  // Graph. hotspotHost doit aussi recevoir l'attribut.
  assert.match(
    script,
    /hotspotHost\.dataset\.sourceSwipeEnabled = isEnabled \? "1" : "0";/,
    'hotspotHost must get data-source-swipe-enabled too, or the generic :not([data-source-swipe-enabled="1"]) rule hides the OG arrows'
  );
});
