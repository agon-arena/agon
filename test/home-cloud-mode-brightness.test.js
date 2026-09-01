"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "../public/style.css"), "utf8");
const start = css.indexOf("#mnoria-cloud-mode-switch .mnoria-cloud-mode-segment-active {");
const end = css.indexOf("\n}", start) + 2;
const activeRule = css.slice(start, end);

test("les trois boutons d'accueil conservent le jaune actif avec une brillance atténuée", () => {
  assert.match(activeRule, /background: linear-gradient\(135deg, #fff2a8 0%, #ffd447 42%, #f09a20 100%\)/);
  assert.match(activeRule, /filter: saturate\(1\.12\) brightness\(1\.03\)/);
  assert.doesNotMatch(activeRule, /brightness\(1\.08\)/);
});

test("le halo actif et le reflet animé sont moins intenses", () => {
  assert.match(activeRule, /0 0 27px rgba\(255, 171, 35, 0\.34\)/);
  assert.match(css, /rgba\(255, 255, 255, 0\.66\)/);
  assert.match(css, /30% \{ opacity: 0\.76; \}/);
});
