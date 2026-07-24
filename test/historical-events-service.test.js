"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHistoricalEventsRepository } = require("../lib/historical-events/repository");
const { createHistoricalEventsService } = require("../lib/historical-events/service");

function baseEvent(overrides = {}) {
  return {
    id: "evt-default",
    month: 3,
    day: 12,
    date_key: "03-12",
    category: "france",
    year: 1930,
    year_display: "1930",
    period: "20th_century",
    title: "Titre par défaut",
    summary_short: "Résumé court par défaut.",
    summary_long: "Résumé long par défaut, avec suffisamment de détails pour passer la validation.",
    location: "Paris",
    historical_source_name: "Source primaire",
    historical_source_url: "https://example.org/source",
    secondary_source_name: null,
    secondary_source_url: null,
    date_certainty: "high",
    historical_importance: 3,
    narrative_strength: 3,
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

const FIXTURE_EVENTS = [
  baseEvent({
    id: "evt-fr-0312",
    date_key: "03-12",
    category: "france",
    review_status: "validated",
    date_certainty: "high",
    image_filename: "fr-0312.jpg",
    image_credit: "Photo : Archives nationales"
  }),
  baseEvent({
    id: "evt-eu-0312",
    date_key: "03-12",
    category: "europe",
    review_status: "draft"
  }),
  baseEvent({
    id: "evt-fr-0229",
    month: 2,
    day: 29,
    date_key: "02-29",
    category: "france",
    review_status: "validated",
    date_certainty: "high",
    image_filename: "fr-0229.jpg"
  })
];

function serviceWithFixture() {
  const json = JSON.stringify(FIXTURE_EVENTS);
  const repository = createHistoricalEventsRepository({ filePath: "fixture.json", readFileSync: () => json });
  return createHistoricalEventsService({ repository });
}

test("les catégories sont retournées dans l'ordre france, europe, world, culture_science", () => {
  const service = serviceWithFixture();
  const result = service.getEventsForDateKey("03-12");
  assert.deepEqual(Object.keys(result.events), ["france", "europe", "world", "culture_science"]);
});

test("une catégorie absente vaut null", () => {
  const service = serviceWithFixture();
  const result = service.getEventsForDateKey("03-12");
  assert.equal(result.events.world, null);
  assert.notEqual(result.events.france, null);
});

test("une date sans aucun événement renvoie les 4 catégories à null", () => {
  const service = serviceWithFixture();
  const result = service.getEventsForDateKey("01-01");
  assert.deepEqual(result, { date_key: "01-01", events: { france: null, europe: null, world: null, culture_science: null } });
});

test("le mapper public retire les champs internes et fournit image_url", () => {
  const service = serviceWithFixture();
  const result = service.getEventsForDateKey("03-12");
  const franceEvent = result.events.france;

  assert.equal(franceEvent.image_url, "/images/historical-events/fr-0312.jpg");
  for (const internalField of [
    "review_status",
    "notes",
    "date_certainty",
    "historical_importance",
    "narrative_strength",
    "image_relevance",
    "image_filename",
    "image_rights_verified",
    "month",
    "day",
    "date_key"
  ]) {
    assert.ok(!(internalField in franceEvent), `le champ interne "${internalField}" ne devrait pas être exposé`);
  }
});

test("onlyValidated filtre les événements non validés au niveau du service", () => {
  const service = serviceWithFixture();
  const result = service.getEventsForDateKey("03-12", { onlyValidated: true });
  assert.notEqual(result.events.france, null);
  assert.equal(result.events.europe, null); // draft, exclu
});

test("getTodayEvents accepte une date injectable et gère le 29 février", () => {
  const service = serviceWithFixture();
  const result = service.getTodayEvents({ now: new Date(2024, 1, 29) });
  assert.equal(result.date_key, "02-29");
  assert.notEqual(result.events.france, null);
});

test("getEventsForMonthDay produit le même résultat que getEventsForDateKey", () => {
  const service = serviceWithFixture();
  const byDateKey = service.getEventsForDateKey("03-12");
  const byMonthDay = service.getEventsForMonthDay(3, 12);
  assert.deepEqual(byMonthDay, byDateKey);
});

test("une anecdote 'uncertain' n'est jamais exposée publiquement (même masquée côté client)", () => {
  const repository = createHistoricalEventsRepository({
    filePath: "fixture.json",
    readFileSync: () => JSON.stringify([
      baseEvent({
        id: "evt-uncertain",
        anecdote: "Détail non confirmé.",
        anecdote_reliability: "uncertain"
      })
    ])
  });
  const service = createHistoricalEventsService({ repository });
  const result = service.getEventsForDateKey("03-12");
  assert.equal(result.events.france.anecdote, null);
  assert.equal(result.events.france.anecdote_reliability, "uncertain");
});

test("une anecdote bien attestée est exposée, avec why_it_matters/tags/sources", () => {
  const repository = createHistoricalEventsRepository({
    filePath: "fixture.json",
    readFileSync: () => JSON.stringify([
      baseEvent({
        id: "evt-well-attested",
        why_it_matters: "Ça compte parce que...",
        anecdote: "Un détail vérifié.",
        anecdote_reliability: "well_attested",
        tags: ["a", "b"],
        sources: [{ title: "Source X", url: "https://example.org/x" }]
      })
    ])
  });
  const service = createHistoricalEventsService({ repository });
  const result = service.getEventsForDateKey("03-12");
  const event = result.events.france;
  assert.equal(event.anecdote, "Un détail vérifié.");
  assert.equal(event.why_it_matters, "Ça compte parce que...");
  assert.deepEqual(event.tags, ["a", "b"]);
  assert.deepEqual(event.sources, [{ title: "Source X", url: "https://example.org/x" }]);
});

test("muter le tableau sources/tags renvoyé ne touche pas le cache du repository", () => {
  const repository = createHistoricalEventsRepository({
    filePath: "fixture.json",
    readFileSync: () => JSON.stringify([
      baseEvent({ id: "evt-mut", tags: ["a"], sources: [{ title: "S", url: "https://example.org/s" }] })
    ])
  });
  const service = createHistoricalEventsService({ repository });
  const first = service.getEventsForDateKey("03-12").events.france;
  first.tags.push("intrus");
  first.sources.push({ title: "faux", url: "https://example.org/faux" });
  const second = service.getEventsForDateKey("03-12").events.france;
  assert.deepEqual(second.tags, ["a"]);
  assert.deepEqual(second.sources, [{ title: "S", url: "https://example.org/s" }]);
});
