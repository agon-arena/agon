"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const view = fs.readFileSync(path.join(__dirname, "../views/mon-univers.html"), "utf8");

test("le plein écran standalone étend la scène sous la safe-area basse", () => {
  assert.match(view, /@media \(display-mode: standalone\) \{[\s\S]*body\.page-memory-only #memory-page-main/);
  assert.match(view, /--memory-standalone-bottom-bleed: max\([\s\S]*env\(safe-area-inset-bottom, 0px\)[\s\S]*--mnoria-mobile-bottom-fill[\s\S]*--mnoria-legacy-standalone-bottom-fill/);
  assert.match(view, /height: calc\(100dvh \+ var\(--memory-standalone-bottom-bleed\)\) !important/);
});

test("le fond racine du plein écran reprend la texture sombre, jamais la bande grise", () => {
  assert.match(view, /html\.memory-fullscreen-root,[\s\S]*body\.page-memory-only \{\s*background: #020610 !important;/);
  assert.match(view, /document\.documentElement\.classList\.add\("memory-fullscreen-root"\)/);
});

test("la correction reste exclue de la page Contributions", () => {
  assert.match(view, /if \(!contributionsOnly\) document\.documentElement\.classList\.add\("memory-fullscreen-root"\)/);
  assert.doesNotMatch(view, /body\.page-contributions-only #memory-page-main[\s\S]*100dvh \+ max/);
});

test("la minicarte reste visible malgré le débordement volontaire de la scène", () => {
  assert.match(view, /universe-minimap \{\s*bottom: calc\(max\(12px, env\(safe-area-inset-bottom, 0px\)\) \+ var\(--memory-standalone-bottom-bleed\)\) !important/);
  assert.match(view, /universe-minimap__zoom-controls \{[\s\S]*var\(--memory-standalone-bottom-bleed\) \+ 92px \+ 6px/);
});
