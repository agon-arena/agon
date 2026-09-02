const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the debate bottom navigation starts with an Accueil button', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'views', 'debate.html'), 'utf8');
  const navStart = html.indexOf('<nav class="home-bottom-nav"');
  const navEnd = html.indexOf('</nav>', navStart);
  const nav = html.slice(navStart, navEnd);

  assert.match(nav, /id="debate-bottom-nav-explorer"[^>]*aria-label="Accueil"/);
  assert.match(nav, /fa-solid fa-house/);
  assert.match(nav, /<span>Accueil<\/span>/);
  assert.doesNotMatch(nav, /<span>Explorer<\/span>/);
});
