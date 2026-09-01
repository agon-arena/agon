"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const script = fs.readFileSync(path.join(__dirname, "../public/script.js"), "utf8");

test("le sélecteur mobile se cale sur le bord réellement rendu du cadre", () => {
  assert.match(script, /function alignMobileCloudModeSwitchToRenderedFrame\(\)/);
  assert.match(script, /var renderedFrameBottom = cloudRect\.bottom - MNORIA_MOBILE_FRAME_BOTTOM_INSET/);
  assert.match(script, /var desiredSwitchTop = renderedFrameBottom \+ 35/);
});

test("le calage suit la transition de hauteur sans boucle permanente", () => {
  assert.match(script, /function observeMobileCloudModeSwitchAlignment\(cloud\) \{\s*if \(!document\.body\.classList\.contains\('is-standalone'\)\) return;/);
  assert.match(script, /_mobileCloudSwitchResizeObserver = new ResizeObserver/);
  assert.match(script, /_mobileCloudSwitchResizeObserver\.observe\(cloud\)/);
  assert.match(script, /requestAnimationFrame\(function\(\) \{[\s\S]*alignMobileCloudModeSwitchToRenderedFrame\(\)/);
  assert.doesNotMatch(script, /setInterval\([^)]*alignMobileCloudModeSwitchToRenderedFrame/);
});

test("le recalage est branché immédiatement après toute nouvelle hauteur mobile", () => {
  const heightWrite = script.indexOf("cloud.style.height = boxHeight + 'px'");
  const align = script.indexOf("alignMobileCloudModeSwitchToRenderedFrame();", heightWrite);
  const observe = script.indexOf("observeMobileCloudModeSwitchAlignment(cloud);", align);
  assert.ok(heightWrite >= 0 && align > heightWrite && observe > align);
});
