const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the debate back arrow and voice counter use the compact mobile size', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const arrowRules = [...css.matchAll(/body\.page-debate\.debate-embedded-frame \.mobile-back-button\s*\{([\s\S]*?)\}/g)];
  const arrowRule = arrowRules.at(-1)?.[1] || '';
  const voiceRules = css.match(/body(?:\.page-debate:not\(\.debate-embedded-frame\)|\.debate-embedded-frame) #voices-float-badge\s*\{[\s\S]*?height:\s*38px\s*!important;[\s\S]*?font-size:\s*16px\s*!important;/g) || [];

  assert.match(arrowRule, /width:\s*38px\s*!important/);
  assert.match(arrowRule, /height:\s*38px\s*!important/);
  assert.match(arrowRule, /font-size:\s*16px\s*!important/);
  assert.equal(voiceRules.length, 2);
});
