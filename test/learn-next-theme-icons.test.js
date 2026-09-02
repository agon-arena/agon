const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'qcm-du-jour.html'), 'utf8');

test('les sujets proposés affichent leur icône thématique avant leur nom', () => {
  const start = view.indexOf('function renderLearnNextInlineList()');
  const end = view.indexOf('function appendLearnNextItems(', start);
  const renderer = view.slice(start, end);
  assert.match(renderer, /learnNextThemeIconClass\(item\).*qcm-learn-next-inline-icon/);
  assert.match(renderer, /<span>' \+ escapeHtml\(item\.name \|\| item\.title/);
  assert.ok(renderer.indexOf('qcm-learn-next-inline-icon') < renderer.indexOf("escapeHtml(item.name"));
});

test('Histoire et les civilisations comme les Incas utilisent le temple', () => {
  const start = view.indexOf('function learnNextThemeIconClass(item)');
  const end = view.indexOf('function renderLearnNextInlineSkeleton()', start);
  const mapper = view.slice(start, end);
  assert.match(mapper, /histoire: 'fa-landmark'/);
  assert.match(mapper, /histoire\|civilisation\|archeolog.*'fa-landmark'/);
});
