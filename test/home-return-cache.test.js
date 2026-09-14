"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const scriptSource = fs.readFileSync(path.join(__dirname, "..", "public", "script.js"), "utf8");
const bottomNavSource = fs.readFileSync(path.join(__dirname, "..", "public", "bottom-nav.js"), "utf8");
const serviceWorkerSource = fs.readFileSync(path.join(__dirname, "..", "public", "service-worker.js"), "utf8");

test("le retour vers l'accueil privilégie la restauration d'historique/BFCache", () => {
  assert.match(scriptSource, /function tryRestoreCachedHomeFromHistory\(fallbackUrl = "\/\?skipStartup=1"\)/);
  assert.match(scriptSource, /referrerUrl\.origin !== window\.location\.origin \|\| referrerUrl\.pathname !== "\/"/);
  assert.match(scriptSource, /window\.history\.back\(\)/);
  assert.match(scriptSource, /if \(tryRestoreCachedHomeFromHistory\(homeNavigationUrl\)\) return;/);
});

test("le bandeau global utilise aussi le retour historique vers l'accueil", () => {
  assert.match(bottomNavSource, /function tryRestoreCachedHomeFromHistory\(fallbackPath\)/);
  assert.match(bottomNavSource, /referrerUrl\.origin !== window\.location\.origin \|\| referrerUrl\.pathname !== '\/'/);
  assert.match(bottomNavSource, /window\.history\.back\(\)/);
  assert.match(bottomNavSource, /if \(tryRestoreCachedHomeFromHistory\('\/\?skipStartup=1'\)\) return;/);
});

test("le retour accueil ne force plus une navigation network-first", () => {
  assert.match(serviceWorkerSource, /const homeReturnMarker = requestUrl\.searchParams\.has\("mnoriaHomeReturn"\);/);
  assert.match(serviceWorkerSource, /const forcedFresh = forcedRefresh;/);
  assert.doesNotMatch(scriptSource, /searchParams\.set\("mnoriaHomeReturn"/);
  assert.doesNotMatch(serviceWorkerSource, /forcedRefresh \|\| forcedHomeReturnFresh/);
});

test("script.js ne pose plus de listener beforeunload qui dégrade le BFCache", () => {
  assert.doesNotMatch(scriptSource, /addEventListener\("beforeunload"/);
  assert.match(scriptSource, /addEventListener\("pagehide"/);
});

test("le retour accueil cache chaud raccourcit seulement l'attente quand Ma mémoire est fraîche", () => {
  assert.match(scriptSource, /function hasWarmHomeReturnVisualCache\(\)/);
  assert.match(scriptSource, /hasFreshHomeReturnUniverseCache\(\)/);
  assert.match(scriptSource, /readMnoriaFrameCache\("mnoriaHomeTrendsSectionTop"\)/);
  assert.match(scriptSource, /window\.__mnoriaHomeReturnHotCache = warmHomeReturnVisualCache;/);
  assert.match(scriptSource, /waitForInitialIndexFeedStability\(warmHomeReturnVisualCache\)/);
  assert.match(scriptSource, /setTimeout\(resolve, fastCachedReturn \? 80 : 500\)/);
});

test("une mémorisation invalide le cache de Ma mémoire avant le prochain retour accueil", () => {
  assert.match(scriptSource, /mnoriaUniverseInvalidated:\$\{voterKey\}/);
  assert.match(scriptSource, /cached\.at > invalidatedAt/);
});
