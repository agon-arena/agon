"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateEvent, validateDataset, formatDateKey } = require("../lib/historical-events/validator");

function baseEvent(overrides = {}) {
  return {
    id: "1789-07-14-france-prise-bastille",
    month: 7,
    day: 14,
    date_key: "07-14",
    category: "france",
    year: 1789,
    year_display: "1789",
    period: "revolution_19th",
    title: "Prise de la Bastille",
    summary_short: "Résumé court de l'événement.",
    summary_long: "Résumé long avec davantage de détails sur le déroulement de la journée.",
    location: "Paris",
    historical_source_name: "Archives nationales",
    historical_source_url: "https://example.org/source",
    secondary_source_name: null,
    secondary_source_url: null,
    date_certainty: "high",
    historical_importance: 5,
    narrative_strength: 4,
    image_relevance: 3,
    image_filename: null,
    image_source_url: null,
    image_original_url: null,
    image_author: null,
    image_date: null,
    image_institution: null,
    image_license: null,
    image_license_url: null,
    image_credit: null,
    image_rights_verified: false,
    content_warnings: [],
    review_status: "draft",
    notes: null,
    ...overrides
  };
}

test("un événement valide passe la validation", () => {
  const result = validateEvent(baseEvent());
  assert.equal(result.ok, true, result.errors.join(" | "));
});

test("date_key incohérent avec month/day est rejeté", () => {
  const result = validateEvent(baseEvent({ date_key: "07-15" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("incohérent")));
});

test("category hors liste autorisée est rejetée", () => {
  const result = validateEvent(baseEvent({ category: "asie" }));
  assert.equal(result.ok, false);
});

test("period, review_status et date_certainty hors liste sont rejetés", () => {
  assert.equal(validateEvent(baseEvent({ period: "moyen-age" })).ok, false);
  assert.equal(validateEvent(baseEvent({ review_status: "en-cours" })).ok, false);
  assert.equal(validateEvent(baseEvent({ date_certainty: "certain" })).ok, false);
});

test("le 29 février est accepté, le 30 février est refusé", () => {
  assert.equal(validateEvent(baseEvent({ month: 2, day: 29, date_key: "02-29" })).ok, true);
  assert.equal(validateEvent(baseEvent({ month: 2, day: 30, date_key: "02-30" })).ok, false);
});

test("une URL de source invalide est rejetée", () => {
  const result = validateEvent(baseEvent({ historical_source_url: "not-a-url" }));
  assert.equal(result.ok, false);
});

test("historical_source_name manquant est rejeté", () => {
  const result = validateEvent(baseEvent({ historical_source_name: null }));
  assert.equal(result.ok, false);
});

test("image_rights_verified à true exige une licence", () => {
  const result = validateEvent(baseEvent({ image_rights_verified: true, image_license: null }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("image_license")));
});

test("le statut validated exige certitude haute et image", () => {
  const wrongCertainty = validateEvent(baseEvent({ review_status: "validated", date_certainty: "medium" }));
  assert.equal(wrongCertainty.ok, false);

  const missingImage = validateEvent(baseEvent({ review_status: "validated", date_certainty: "high", image_filename: null }));
  assert.equal(missingImage.ok, false);

  const valid = validateEvent(baseEvent({
    review_status: "validated",
    date_certainty: "high",
    image_filename: "1789-bastille.jpg",
    image_rights_verified: true,
    image_license: "CC0"
  }));
  assert.equal(valid.ok, true, valid.errors.join(" | "));
});

test("formatDateKey formate avec zéro de tête", () => {
  assert.equal(formatDateKey(3, 4), "03-04");
  assert.equal(formatDateKey(12, 25), "12-25");
});

test("validateDataset détecte les id en double", () => {
  const events = [baseEvent({ id: "evt-a" }), baseEvent({ id: "evt-a", category: "europe", date_key: "07-14" })];
  const result = validateDataset(events);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.message.includes("id en doublon")));
});

test("validateDataset détecte deux événements sur le même créneau date_key/category", () => {
  const events = [baseEvent({ id: "evt-a" }), baseEvent({ id: "evt-b" })];
  const result = validateDataset(events);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.message.includes("doublon : un événement existe déjà")));
});

test("validateDataset accepte jusqu'à 3 événements/jour (un par catégorie)", () => {
  const events = [
    baseEvent({ id: "evt-a", category: "france" }),
    baseEvent({ id: "evt-b", category: "europe" }),
    baseEvent({ id: "evt-c", category: "world" })
  ];
  const result = validateDataset(events);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

// --- Lot "cartes-jour-annee-aout-semaine-1" : culture_science, nouvelles
// periods, champs narratifs (why_it_matters/anecdote/anecdote_reliability/
// tags/sources), champs de notation devenus optionnels. ---

test("category accepte culture_science", () => {
  const result = validateEvent(baseEvent({ category: "culture_science" }));
  assert.equal(result.ok, true, result.errors.join(" | "));
});

test("period accepte les nouvelles valeurs (ex. world_war_2)", () => {
  const result = validateEvent(baseEvent({ period: "world_war_2" }));
  assert.equal(result.ok, true, result.errors.join(" | "));
});

test("date_certainty/historical_importance/narrative_strength/image_relevance/image_rights_verified absents sont acceptés", () => {
  const result = validateEvent(baseEvent({
    date_certainty: null,
    historical_importance: null,
    narrative_strength: null,
    image_relevance: null,
    image_rights_verified: null
  }));
  assert.equal(result.ok, true, result.errors.join(" | "));
});

test("historical_importance présent mais hors bornes reste rejeté", () => {
  const result = validateEvent(baseEvent({ historical_importance: 9 }));
  assert.equal(result.ok, false);
});

test("why_it_matters, anecdote (avec anecdote_reliability) et sources valides sont acceptés", () => {
  const result = validateEvent(baseEvent({
    why_it_matters: "Cet événement compte parce que...",
    anecdote: "Un détail savoureux et vérifié.",
    anecdote_reliability: "well_attested",
    tags: ["histoire", "france"],
    sources: [{ title: "Une source", url: "https://example.org/source" }]
  }));
  assert.equal(result.ok, true, result.errors.join(" | "));
});

test("anecdote_reliability hors liste est rejetée", () => {
  const result = validateEvent(baseEvent({ anecdote: "x", anecdote_reliability: "certaine" }));
  assert.equal(result.ok, false);
});

test("anecdote sans anecdote_reliability est rejetée", () => {
  const result = validateEvent(baseEvent({ anecdote: "x", anecdote_reliability: null }));
  assert.equal(result.ok, false);
});

test("sources mal formées (url manquante) sont rejetées", () => {
  const result = validateEvent(baseEvent({ sources: [{ title: "Une source" }] }));
  assert.equal(result.ok, false);
});

test("tags avec un élément non-chaîne est rejeté", () => {
  const result = validateEvent(baseEvent({ tags: ["ok", 42] }));
  assert.equal(result.ok, false);
});

test("why_it_matters/anecdote/tags/sources absents (undefined) restent acceptés (compatibilité avec les événements existants)", () => {
  const event = baseEvent();
  delete event.why_it_matters;
  delete event.anecdote;
  delete event.anecdote_reliability;
  delete event.tags;
  delete event.sources;
  const result = validateEvent(event);
  assert.equal(result.ok, true, result.errors.join(" | "));
});
