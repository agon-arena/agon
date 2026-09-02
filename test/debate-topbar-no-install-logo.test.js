const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '..', 'views', 'debate.html'), 'utf8');

test('the debate topbar no longer contains the app installation logo', () => {
  assert.doesNotMatch(html, /class="[^"]*topbar-app-icon[^"]*"/);
  assert.doesNotMatch(html, /src="\/appmnoria-192\.png"/);
});
