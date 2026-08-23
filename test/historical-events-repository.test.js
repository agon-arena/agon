"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHistoricalEventsRepository } = require("../lib/historical-events/repository");

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
    image_filename: "fr-0312.jpg"
  }),
  baseEvent({
    id: "evt-eu-0312",
    date_key: "03-12",
    category: "europe",
    review_status: "draft",
    date_certainty: "medium"
  }),
  baseEvent({
    id: "evt-wo-0715",
    month: 7,
    day: 15,
    date_key: "07-15",
    category: "world",
    review_status: "rejected",
    date_certainty: "low"
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

function repoWithFixture(events = FIXTURE_EVENTS) {
  const json = JSON.stringify(events);
  return createHistoricalEventsRepository({ filePath: "fixture.json", readFileSync: () => json });
}

test("getByDateKey retourne les événements d'une date donnée", () => {
  const repo = repoWithFixture();
  const events = repo.getByDateKey("03-12");
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.category).sort(), ["europe", "france"]);
});

test("getByDateKey rejette un format de date invalide", () => {
  const repo = repoWithFixture();
  assert.throws(() => repo.getByDateKey("13-40"), /date_key invalide/);
  assert.throws(() => repo.getByDateKey("3-1"), /date_key invalide/);
});

test("getByMonthDay rejette un mois ou un jour hors bornes", () => {
  const repo = repoWithFixture();
  assert.throws(() => repo.getByMonthDay(13, 1), /month invalide/);
  assert.throws(() => repo.getByMonthDay(1, 42), /day invalide/);
});

test("une date sans événement renvoie un tableau vide", () => {
  const repo = repoWithFixture();
  assert.deepEqual(repo.getByDateKey("01-01"), []);
});

test("le filtre onlyValidated ne garde que review_status=validated", () => {
  const repo = repoWithFixture();
  const events = repo.getByDateKey("03-12", { onlyValidated: true });
  assert.equal(events.length, 1);
  assert.equal(events[0].category, "france");
  assert.equal(events[0].review_status, "validated");
});

// onlyMemorizable (demande du 17/08/2026, audit du pipeline mnésique) : cf.
// isHistoricalEventMemorizable dans server.js, seul consommateur réel — un
// événement "draft" (jamais relu) ne doit jamais alimenter une nouvelle
// question mémorisable, mais un repli transitoire admet aussi "reviewed" à
// condition que date_certainty soit déjà "high" (le dataset réel ne compte
// aucun "validated" au moment de ce correctif, cf. commentaire du repository).
test("onlyMemorizable rejette un événement draft, même à date_certainty high", () => {
  const repo = repoWithFixture([
    baseEvent({ id: "evt-draft-high", review_status: "draft", date_certainty: "high" })
  ]);
  const all = repo.getAll({ onlyMemorizable: true });
  assert.equal(all.length, 0);
});

test("onlyMemorizable accepte reviewed + date_certainty=high", () => {
  const repo = repoWithFixture([
    baseEvent({ id: "evt-reviewed-high", review_status: "reviewed", date_certainty: "high" })
  ]);
  const all = repo.getAll({ onlyMemorizable: true });
  assert.equal(all.length, 1);
  assert.equal(all[0].id, "evt-reviewed-high");
});

test("onlyMemorizable accepte validated + date_certainty=high", () => {
  const repo = repoWithFixture([
    baseEvent({ id: "evt-validated-high", review_status: "validated", date_certainty: "high", image_filename: "evt.jpg" })
  ]);
  const all = repo.getAll({ onlyMemorizable: true });
  assert.equal(all.length, 1);
  assert.equal(all[0].id, "evt-validated-high");
});

test("onlyMemorizable rejette reviewed sans date_certainty=high (jamais un simple statut reviewed)", () => {
  const repo = repoWithFixture([
    baseEvent({ id: "evt-reviewed-medium", date_key: "05-01", month: 5, day: 1, review_status: "reviewed", date_certainty: "medium" }),
    baseEvent({ id: "evt-reviewed-null", date_key: "05-02", month: 5, day: 2, review_status: "reviewed", date_certainty: null })
  ]);
  const all = repo.getAll({ onlyMemorizable: true });
  assert.equal(all.length, 0);
});

test("onlyMemorizable : sans l'option (ou à false), le comportement getAll() historique est inchangé (draft inclus)", () => {
  const repo = repoWithFixture([
    baseEvent({ id: "evt-draft", review_status: "draft", date_certainty: "high" })
  ]);
  assert.equal(repo.getAll().length, 1);
  assert.equal(repo.getAll({ onlyMemorizable: false }).length, 1);
});

// onlyValidated (getByDateKey/getByMonthDay/getTodayEvents, route publique
// /api/historical-events) reste STRICT et inchangé par ce correctif : jamais
// mélangé avec le repli onlyMemorizable ci-dessus, propre à getAll() seul.
test("onlyValidated (getByDateKey) reste strict : reviewed+high n'est PAS traité comme validated", () => {
  const repo = repoWithFixture([
    baseEvent({ id: "evt-reviewed-high-2", review_status: "reviewed", date_certainty: "high" })
  ]);
  const events = repo.getByDateKey("03-12", { onlyValidated: true });
  assert.equal(events.length, 0);
});

test("les événements rejected sont toujours exclus, même sans filtre", () => {
  const repo = repoWithFixture();
  assert.deepEqual(repo.getByDateKey("07-15"), []);
  assert.ok(!repo.getAll().some((e) => e.review_status === "rejected"));
});

test("les objets sources ne sont jamais mutés par un appelant", () => {
  const repo = repoWithFixture();
  const [event] = repo.getByDateKey("03-12", { onlyValidated: true });
  event.title = "MUTÉ";
  event.content_warnings.push("hack");

  const [freshEvent] = repo.getByDateKey("03-12", { onlyValidated: true });
  assert.equal(freshEvent.title, "Titre par défaut");
  assert.deepEqual(freshEvent.content_warnings, []);
});

test("le 29 février est géré correctement", () => {
  const repo = repoWithFixture();
  const byDateKey = repo.getByDateKey("02-29");
  assert.equal(byDateKey.length, 1);
  assert.equal(byDateKey[0].id, "evt-fr-0229");

  const byMonthDay = repo.getByMonthDay(2, 29);
  assert.equal(byMonthDay.length, 1);
  assert.equal(byMonthDay[0].id, "evt-fr-0229");

  const today = repo.getTodayEvents({ now: new Date(2024, 1, 29) }); // 2024 = bissextile
  assert.equal(today.length, 1);
  assert.equal(today[0].id, "evt-fr-0229");
});

test("getTodayEvents accepte une date injectée", () => {
  const repo = repoWithFixture();
  const events = repo.getTodayEvents({ now: new Date(2026, 2, 12) }); // 12 mars
  assert.equal(events.length, 2);
});

test("un fichier JSON invalide déclenche une erreur claire", () => {
  const repo = createHistoricalEventsRepository({ filePath: "broken.json", readFileSync: () => "{not valid json" });
  assert.throws(() => repo.getAll(), /JSON invalide/);
});

test("un dataset qui ne respecte pas le validateur déclenche une erreur claire", () => {
  const invalidEvents = [baseEvent({ id: "evt-1" }), baseEvent({ id: "evt-1" })]; // id en double
  const repo = createHistoricalEventsRepository({
    filePath: "invalid-dataset.json",
    readFileSync: () => JSON.stringify(invalidEvents)
  });
  assert.throws(() => repo.getAll(), /invalide — \d+ erreur/);
});
