const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let universeModule;
test.before(async () => {
  const sourcePath = path.join(__dirname, "..", "public", "universe-zoom.js");
  const source = fs.readFileSync(sourcePath, "utf8");
  universeModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
});

function stars(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `star-${index + 1}`,
    name: `Étoile ${index + 1}`,
    articleCount: 1,
    articles: []
  }));
}

function solar(id, count) {
  return { id, name: `Solar ${id}`, articleCount: Math.max(1, count), stars: stars(count) };
}

function galaxy(name, counts) {
  return { name, solarSystems: counts.map((count, index) => solar(`${name}-${index + 1}`, count)) };
}

function oneSolarExtent(count, worldRadius = 220) {
  const layout = universeModule.layoutUniverseWorld([galaxy("Histoire", [count])], worldRadius);
  return { layout, solar: layout.solarSystems[0] };
}

function assertSolarEnvelopesSeparated(layout) {
  for (let i = 0; i < layout.solarSystems.length; i += 1) {
    for (let j = i + 1; j < layout.solarSystems.length; j += 1) {
      const a = layout.solarSystems[i];
      const b = layout.solarSystems[j];
      assert.ok(
        Math.hypot(a.x - b.x, a.y - b.y) >= a.effectiveSolarRadius + b.effectiveSolarRadius,
        `${a.id} et ${b.id} doivent avoir des enveloppes disjointes`
      );
    }
  }
}

function radialDistance(star, parent) {
  return Math.hypot(star.x - parent.x, star.y - parent.y);
}

test("A-E — le jitter radial est varié, borné, déterministe et indépendant du nombre d'étoiles", () => {
  const ids = Array.from({ length: 24 }, (_, index) => `Histoire:solar-1:star-${index + 1}`);
  const factors = ids.map((id) => universeModule.stableRadialFactor(id));
  assert.ok(new Set(factors.map((factor) => factor.toFixed(8))).size > 10, "les longueurs ne doivent pas former un anneau uniforme");
  factors.forEach((factor) => {
    assert.ok(factor >= 0.82 && factor <= 1.22, `facteur hors bornes : ${factor}`);
  });
  assert.equal(universeModule.stableRadialFactor(ids[3]), universeModule.stableRadialFactor(ids[3]));
  const before = oneSolarExtent(10).layout.stars.find((star) => star.ref.id === "star-4").radialFactor;
  const after = oneSolarExtent(11).layout.stars.find((star) => star.ref.id === "star-4").radialFactor;
  assert.equal(after, before, "ajouter une étoile ne doit pas changer la personnalité radiale existante");
});

test("A-B — sur un même anneau théorique, les distances finales varient dans les bornes autorisées", () => {
  const { layout, solar: parent } = oneSolarExtent(10);
  const sameRing = layout.stars.filter((star) => star.ringIndex === 0);
  assert.ok(sameRing.length >= 2, "la fixture doit conserver plusieurs étoiles sur le premier anneau");
  assert.ok(new Set(sameRing.map((star) => radialDistance(star, parent).toFixed(7))).size > 1);
  sameRing.forEach((star) => {
    const ratio = radialDistance(star, parent) / star.baseRingRadius;
    assert.ok(ratio >= 0.82 - 1e-9 && ratio <= 1.22 + 1e-9);
  });
});

test("F — le jitter radial conserve les collisions entre étoiles et avec le Solar parent", () => {
  const { layout, solar: parent } = oneSolarExtent(30);
  const gap = Math.max(0.8, parent.r * 0.12);
  layout.stars.forEach((star, index) => {
    assert.ok(radialDistance(star, parent) >= parent.r + star.r + gap - 1e-7);
    layout.stars.slice(index + 1).forEach((other) => {
      assert.ok(Math.hypot(star.x - other.x, star.y - other.y) >= star.r + other.r + gap - 1e-7);
    });
  });
});

test("G — contentRadius est calculé sur l'étoile finale réellement la plus éloignée", () => {
  const { layout, solar: parent } = oneSolarExtent(20);
  const expected = Math.max(parent.r, ...layout.stars.map((star) => radialDistance(star, parent) + star.r));
  assert.ok(Math.abs(parent.contentRadius - expected) < 1e-7);
  assert.equal(parent.effectiveSolarRadius, parent.contentRadius + parent.labelMargin + parent.safetyMargin);
});

test("H — les facteurs et rapports radiaux ne dépendent pas du viewport", () => {
  const mobile = oneSolarExtent(20, 147.2);
  const desktop = oneSolarExtent(20, 460);
  mobile.layout.stars.forEach((star) => {
    const large = desktop.layout.stars.find((candidate) => candidate.ref.id === star.ref.id);
    assert.equal(star.radialFactor, large.radialFactor);
    assert.ok(Math.abs(radialDistance(star, mobile.solar) / star.baseRingRadius - radialDistance(large, desktop.solar) / large.baseRingRadius) < 1e-9);
  });
});

test("1 et 5 étoiles restent sur une enveloppe faible, 20 et 30 l'agrandissent", () => {
  const e1 = oneSolarExtent(1).solar;
  const e5 = oneSolarExtent(5).solar;
  const e20 = oneSolarExtent(20).solar;
  const e30 = oneSolarExtent(30).solar;
  assert.ok(e1.effectiveSolarRadius > e1.contentRadius);
  assert.ok(e5.effectiveSolarRadius <= e1.effectiveSolarRadius * 1.25);
  assert.ok(e20.effectiveSolarRadius > e5.effectiveSolarRadius);
  assert.ok(e30.effectiveSolarRadius > e20.effectiveSolarRadius);
  assert.ok(e30.orbitRadius === e30.contentRadius);
});

test("les marges label et sécurité sont proportionnelles et bornées", () => {
  const { solar: node } = oneSolarExtent(5);
  assert.ok(node.labelMargin >= 0.8);
  assert.ok(node.labelMargin <= node.r * 0.25 + 1e-9);
  assert.equal(node.safetyMargin, Math.max(0.8, node.r * 0.2));
  assert.equal(node.effectiveSolarRadius, node.contentRadius + node.labelMargin + node.safetyMargin);
});

test("deux Solar légers, chargé/léger et deux chargés ne se chevauchent pas", () => {
  const light = universeModule.layoutUniverseWorld([galaxy("Légers", [1, 1])], 220);
  const mixed = universeModule.layoutUniverseWorld([galaxy("Mixte", [30, 1])], 220);
  const heavy = universeModule.layoutUniverseWorld([galaxy("Chargés", [30, 30])], 220);
  assertSolarEnvelopesSeparated(light);
  assertSolarEnvelopesSeparated(mixed);
  assertSolarEnvelopesSeparated(heavy);
  const lightDistance = Math.hypot(light.solarSystems[0].x - light.solarSystems[1].x, light.solarSystems[0].y - light.solarSystems[1].y);
  const mixedDistance = Math.hypot(mixed.solarSystems[0].x - mixed.solarSystems[1].x, mixed.solarSystems[0].y - mixed.solarSystems[1].y);
  assert.ok(mixedDistance > lightDistance);
});

test("ajouter une étoile ne diminue pas l'enveloppe", () => {
  for (let count = 1; count < 35; count += 1) {
    const before = oneSolarExtent(count).solar.effectiveSolarRadius;
    const after = oneSolarExtent(count + 1).solar.effectiveSolarRadius;
    assert.ok(after + 1e-7 >= before, `${count} -> ${count + 1}`);
  }
});

test("un cas dense agrandit l'espace logique sans fallback superposé", () => {
  const layout = universeModule.layoutUniverseWorld([galaxy("Dense", Array(10).fill(30))], 150);
  assert.ok(layout.galaxies[0].logicalRadius > layout.galaxies[0].r * 0.8);
  assert.ok(layout.worldRadius >= 150);
  assertSolarEnvelopesSeparated(layout);
  const uniqueCenters = new Set(layout.solarSystems.map((node) => `${node.x.toFixed(6)}:${node.y.toFixed(6)}`));
  assert.equal(uniqueCenters.size, layout.solarSystems.length);
});

test("le layout est déterministe", () => {
  const data = [galaxy("A", [1, 20, 5]), galaxy("B", [30, 3])];
  assert.deepEqual(
    universeModule.layoutUniverseWorld(data, 220),
    universeModule.layoutUniverseWorld(data, 220)
  );
});

test("les ratios restent cohérents sur un petit viewport logique", () => {
  const mobile = oneSolarExtent(20, 147.2).solar;
  const desktop = oneSolarExtent(20, 460).solar;
  const mobileRatio = mobile.effectiveSolarRadius / mobile.r;
  const desktopRatio = desktop.effectiveSolarRadius / desktop.r;
  assert.ok(Math.abs(mobileRatio - desktopRatio) < 0.08);
});

test("les bounds de minimap englobent toutes les étoiles", () => {
  const layout = universeModule.layoutUniverseWorld([galaxy("Carte", [30, 20])], 180);
  const bounds = universeModule.computeUniverseWorldBounds(layout);
  layout.stars.forEach((star) => {
    assert.ok(star.x - star.r >= bounds.minX - 1e-9);
    assert.ok(star.x + star.r <= bounds.maxX + 1e-9);
    assert.ok(star.y - star.r >= bounds.minY - 1e-9);
    assert.ok(star.y + star.r <= bounds.maxY + 1e-9);
  });
});

test("le focus utilise l'étendue orbitale complète", () => {
  const { solar: node } = oneSolarExtent(30);
  node.maxChildR = node.r * 0.4;
  const scale = universeModule.focusScaleForUniverseNode(node, 58, 165);
  assert.ok(node.orbitRadius * scale <= 165 + 1e-9);
});

test("les enveloppes agrégées empêchent aussi les mélanges entre galaxies", () => {
  const layout = universeModule.layoutUniverseWorld([
    galaxy("Galaxie A", [30, 30]),
    galaxy("Galaxie B", [30, 30])
  ], 180);
  assertSolarEnvelopesSeparated(layout);
});
