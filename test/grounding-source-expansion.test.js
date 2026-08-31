"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DOCUMENTARY_GROUNDING_REASON_CODES,
  NON_DOCUMENTARY_GROUNDING_REASON_CODES,
  EXPANSION_COVERAGE_THRESHOLD,
  MAX_NEW_SOURCES_PER_EXPANSION,
  shouldExpandGroundingSources,
  buildSourceExpansionQuery
} = require("../lib/grounding-source-expansion");

function metrics(overrides = {}) {
  return {
    groundingEnabled: true,
    generated: overrides.generated ?? overrides.questionsRequested ?? 0,
    finalAccepted: 0,
    unresolvedReasonCounts: {},
    ...overrides
  };
}

// ── Registre des motifs : partition complète, jamais un chevauchement ──────

test("les motifs documentaires et non documentaires sont mutuellement exclusifs", () => {
  for (const code of DOCUMENTARY_GROUNDING_REASON_CODES) {
    assert.equal(NON_DOCUMENTARY_GROUNDING_REASON_CODES.has(code), false, `${code} ne doit pas être dans les deux registres`);
  }
});

test("EXPANSION_COVERAGE_THRESHOLD et MAX_NEW_SOURCES_PER_EXPANSION sont des valeurs raisonnables", () => {
  assert.ok(EXPANSION_COVERAGE_THRESHOLD > 0 && EXPANSION_COVERAGE_THRESHOLD < 1);
  assert.ok(MAX_NEW_SOURCES_PER_EXPANSION >= 1 && MAX_NEW_SOURCES_PER_EXPANSION <= 3, "qualité > quantité, section 9 de la demande");
});

// ── shouldExpandGroundingSources — cas A à E (section 22 de la demande) ────

test("cas A : 20 demandées, 19 acceptées, 1 rejet numérique -> pas d'expansion (couverture suffisante)", () => {
  const result = shouldExpandGroundingSources(
    metrics({ finalAccepted: 19, unresolvedReasonCounts: { GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED: 1 } }),
    { questionsRequested: 20 }
  );
  assert.equal(result.expand, false);
  assert.equal(result.reason, "coverage_sufficient");
});

test("cas B : 20 demandées, 8 acceptées, 12 rejets NUMERIC_NOT_SUPPORTED -> expansion", () => {
  const result = shouldExpandGroundingSources(
    metrics({ finalAccepted: 8, unresolvedReasonCounts: { GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED: 12 } }),
    { questionsRequested: 20 }
  );
  assert.equal(result.expand, true);
  assert.equal(result.reason, "insufficient_documentary_coverage");
  assert.equal(result.missing, 12);
});

test("cas C : 20 demandées, 8 acceptées, rejets MISSING_SUPPORTING_CLAIM -> pas d'expansion documentaire", () => {
  const result = shouldExpandGroundingSources(
    metrics({ finalAccepted: 8, unresolvedReasonCounts: { GROUNDING_MISSING_SUPPORTING_CLAIM: 12 } }),
    { questionsRequested: 20 }
  );
  assert.equal(result.expand, false);
  assert.equal(result.reason, "no_documentary_signal");
});

test("cas D : 4 demandées, 0 acceptée, rejets numériques -> expansion", () => {
  const result = shouldExpandGroundingSources(
    metrics({ finalAccepted: 0, unresolvedReasonCounts: { GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED: 3, GROUNDING_ANSWER_NOT_IN_CLAIM: 1 } }),
    { questionsRequested: 4 }
  );
  assert.equal(result.expand, true);
  assert.equal(result.missing, 4);
});

test("cas E : 5 demandées, 4 acceptées -> pas d'expansion (couverture 80% >= seuil)", () => {
  const result = shouldExpandGroundingSources(
    metrics({ finalAccepted: 4, unresolvedReasonCounts: { GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED: 1 } }),
    { questionsRequested: 5 }
  );
  assert.equal(result.expand, false);
  assert.equal(result.reason, "coverage_sufficient");
});

// ── Cas limites supplémentaires ─────────────────────────────────────────

test("grounding désactivé -> jamais d'expansion, quel que soit le reste", () => {
  const result = shouldExpandGroundingSources(
    metrics({ groundingEnabled: false, finalAccepted: 0, unresolvedReasonCounts: { GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED: 4 } }),
    { questionsRequested: 4 }
  );
  assert.equal(result.expand, false);
  assert.equal(result.reason, "grounding_disabled");
});

test("metrics absent -> pas d'expansion, jamais d'exception", () => {
  assert.doesNotThrow(() => shouldExpandGroundingSources(null, { questionsRequested: 4 }));
  const result = shouldExpandGroundingSources(null, { questionsRequested: 4 });
  assert.equal(result.expand, false);
});

test("questionsRequested absent/invalide -> pas d'expansion", () => {
  const result = shouldExpandGroundingSources(metrics({ finalAccepted: 0 }), {});
  assert.equal(result.expand, false);
  assert.equal(result.reason, "no_target");
});

test("aucun manque (couverture 100%) -> pas d'expansion même si des motifs documentaires existent ailleurs dans l'historique", () => {
  const result = shouldExpandGroundingSources(
    metrics({ finalAccepted: 4, unresolvedReasonCounts: {} }),
    { questionsRequested: 4 }
  );
  assert.equal(result.expand, false);
  assert.equal(result.reason, "coverage_sufficient");
});

test("motifs mixtes à parts égales : documentaire == non documentaire -> expansion tentée (documentaire au moins aussi présent)", () => {
  const result = shouldExpandGroundingSources(
    metrics({ finalAccepted: 0, unresolvedReasonCounts: { GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED: 2, GROUNDING_UNKNOWN_SOURCE: 2 } }),
    { questionsRequested: 4 }
  );
  assert.equal(result.expand, true);
});

test("motifs mixtes mais non documentaires dominants -> pas d'expansion", () => {
  const result = shouldExpandGroundingSources(
    metrics({ finalAccepted: 0, unresolvedReasonCounts: { GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED: 1, GROUNDING_UNKNOWN_SOURCE: 3 } }),
    { questionsRequested: 4 }
  );
  assert.equal(result.expand, false);
  assert.equal(result.reason, "non_documentary_dominant");
});

test("GROUNDING_EXCESSIVE_PRECISION est traité comme documentaire (une source plus précise peut exister)", () => {
  const result = shouldExpandGroundingSources(
    metrics({ finalAccepted: 0, unresolvedReasonCounts: { GROUNDING_EXCESSIVE_PRECISION: 4 } }),
    { questionsRequested: 4 }
  );
  assert.equal(result.expand, true);
});

// ── buildSourceExpansionQuery (section 7/8/17) ──────────────────────────

test("la requête d'expansion n'est jamais identique au sujet seul", () => {
  const query = buildSourceExpansionQuery("population de la Chine", {});
  assert.notEqual(query, "population de la Chine");
  assert.match(query, /^population de la Chine /);
});

test("aucun sujet en dur (générique quel que soit le sujet fourni)", () => {
  const chine = buildSourceExpansionQuery("population de la Chine", { documentaryReasonCodes: ["GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED"] });
  const mars = buildSourceExpansionQuery("composition de l'atmosphère de Mars", { documentaryReasonCodes: ["GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED"] });
  assert.match(chine, /chiffres officiels/);
  assert.match(mars, /chiffres officiels/);
  assert.notEqual(chine.replace("population de la Chine", ""), "");
});

test("motif numérique -> qualificatif 'chiffres officiels'", () => {
  const query = buildSourceExpansionQuery("PIB de la France", { documentaryReasonCodes: ["GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED"] });
  assert.match(query, /chiffres officiels/);
});

test("sujet sensible à la date -> année courante ajoutée, jamais une année en dur", () => {
  const fixedNow = new Date("2031-05-10T00:00:00Z");
  const query = buildSourceExpansionQuery("population actuelle de la France", { freshnessLikely: true, now: fixedNow });
  assert.match(query, /2031/);
  assert.doesNotMatch(query, /2026/);
});

test("sujet non sensible à la date -> pas d'année ajoutée", () => {
  const query = buildSourceExpansionQuery("Alexandre le Grand", { freshnessLikely: false, now: new Date("2031-05-10T00:00:00Z") });
  assert.doesNotMatch(query, /2031/);
});

test("aucun code documentaire fourni -> qualificatif générique par défaut, jamais une requête vide de qualificatif", () => {
  const query = buildSourceExpansionQuery("photosynthèse", {});
  assert.match(query, /source de référence/);
});
