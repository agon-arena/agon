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

// Jamais de vrai appel réseau dans ces tests : fetchFallbackImage est
// systématiquement mocké (comportement "aucune image trouvée", identique à
// avant l'ajout du repli Wikipedia côté service.js).
const NO_FALLBACK_IMAGE = async () => null;

function serviceWithFixture(fetchFallbackImage = NO_FALLBACK_IMAGE) {
  const json = JSON.stringify(FIXTURE_EVENTS);
  const repository = createHistoricalEventsRepository({ filePath: "fixture.json", readFileSync: () => json });
  return createHistoricalEventsService({ repository, fetchFallbackImage });
}

test("les catégories sont retournées dans l'ordre france, europe, world, culture_science", async () => {
  const service = serviceWithFixture();
  const result = await service.getEventsForDateKey("03-12");
  assert.deepEqual(Object.keys(result.events), ["france", "europe", "world", "culture_science"]);
});

test("une catégorie absente vaut null", async () => {
  const service = serviceWithFixture();
  const result = await service.getEventsForDateKey("03-12");
  assert.equal(result.events.world, null);
  assert.notEqual(result.events.france, null);
});

test("une date sans aucun événement renvoie les 4 catégories à null", async () => {
  const service = serviceWithFixture();
  const result = await service.getEventsForDateKey("01-01");
  assert.deepEqual(result, { date_key: "01-01", events: { france: null, europe: null, world: null, culture_science: null } });
});

test("le mapper public retire les champs internes et fournit image_url", async () => {
  const service = serviceWithFixture();
  const result = await service.getEventsForDateKey("03-12");
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

test("onlyValidated filtre les événements non validés au niveau du service", async () => {
  const service = serviceWithFixture();
  const result = await service.getEventsForDateKey("03-12", { onlyValidated: true });
  assert.notEqual(result.events.france, null);
  assert.equal(result.events.europe, null); // draft, exclu
});

test("getTodayEvents accepte une date injectable et gère le 29 février", async () => {
  const service = serviceWithFixture();
  const result = await service.getTodayEvents({ now: new Date(2024, 1, 29) });
  assert.equal(result.date_key, "02-29");
  assert.notEqual(result.events.france, null);
});

test("getEventsForMonthDay produit le même résultat que getEventsForDateKey", async () => {
  const service = serviceWithFixture();
  const byDateKey = await service.getEventsForDateKey("03-12");
  const byMonthDay = await service.getEventsForMonthDay(3, 12);
  assert.deepEqual(byMonthDay, byDateKey);
});

test("une anecdote 'uncertain' n'est jamais exposée publiquement (même masquée côté client)", async () => {
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
  const service = createHistoricalEventsService({ repository, fetchFallbackImage: NO_FALLBACK_IMAGE });
  const result = await service.getEventsForDateKey("03-12");
  assert.equal(result.events.france.anecdote, null);
  assert.equal(result.events.france.anecdote_reliability, "uncertain");
});

test("une anecdote bien attestée est exposée, avec why_it_matters/tags/sources", async () => {
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
  const service = createHistoricalEventsService({ repository, fetchFallbackImage: NO_FALLBACK_IMAGE });
  const result = await service.getEventsForDateKey("03-12");
  const event = result.events.france;
  assert.equal(event.anecdote, "Un détail vérifié.");
  assert.equal(event.why_it_matters, "Ça compte parce que...");
  assert.deepEqual(event.tags, ["a", "b"]);
  assert.deepEqual(event.sources, [{ title: "Source X", url: "https://example.org/x" }]);
});

test("muter le tableau sources/tags renvoyé ne touche pas le cache du repository", async () => {
  const repository = createHistoricalEventsRepository({
    filePath: "fixture.json",
    readFileSync: () => JSON.stringify([
      baseEvent({ id: "evt-mut", tags: ["a"], sources: [{ title: "S", url: "https://example.org/s" }] })
    ])
  });
  const service = createHistoricalEventsService({ repository, fetchFallbackImage: NO_FALLBACK_IMAGE });
  const first = (await service.getEventsForDateKey("03-12")).events.france;
  first.tags.push("intrus");
  first.sources.push({ title: "faux", url: "https://example.org/faux" });
  const second = (await service.getEventsForDateKey("03-12")).events.france;
  assert.deepEqual(second.tags, ["a"]);
  assert.deepEqual(second.sources, [{ title: "S", url: "https://example.org/s" }]);
});

// --- Repli d'image Wikipedia (fetchFallbackImage) ---

test("image_filename absent -> le repli est appelé et son résultat utilisé", async () => {
  const repository = createHistoricalEventsRepository({
    filePath: "fixture.json",
    readFileSync: () => JSON.stringify([baseEvent({ id: "evt-no-image", title: "Un événement sans image du lot" })])
  });
  let receivedTitle = null;
  const service = createHistoricalEventsService({
    repository,
    fetchFallbackImage: async (title) => {
      receivedTitle = title;
      return { imageUrl: "https://upload.wikimedia.org/wikipedia/commons/x/photo.jpg", pageUrl: "https://fr.wikipedia.org/wiki/X" };
    }
  });
  const result = await service.getEventsForDateKey("03-12");
  assert.equal(receivedTitle, "Un événement sans image du lot");
  assert.equal(result.events.france.image_url, "https://upload.wikimedia.org/wikipedia/commons/x/photo.jpg");
  assert.equal(result.events.france.image_page_url, "https://fr.wikipedia.org/wiki/X");
  assert.equal(result.events.france.image_credit, "Wikipedia");
});

test("image_filename présent -> le repli n'est jamais appelé", async () => {
  const repository = createHistoricalEventsRepository({
    filePath: "fixture.json",
    readFileSync: () => JSON.stringify([baseEvent({ id: "evt-has-image", image_filename: "fr-0312.jpg", image_credit: "Photo : Archives nationales" })])
  });
  let fallbackCalls = 0;
  const service = createHistoricalEventsService({
    repository,
    fetchFallbackImage: async () => { fallbackCalls++; return { imageUrl: "https://upload.wikimedia.org/x.jpg" }; }
  });
  const result = await service.getEventsForDateKey("03-12");
  assert.equal(fallbackCalls, 0, "le repli ne doit pas être appelé quand une image locale existe déjà");
  assert.equal(result.events.france.image_url, "/images/historical-events/fr-0312.jpg");
  assert.equal(result.events.france.image_credit, "Photo : Archives nationales");
});

test("le repli échoue -> aucune image, pas de crash", async () => {
  const repository = createHistoricalEventsRepository({
    filePath: "fixture.json",
    readFileSync: () => JSON.stringify([baseEvent({ id: "evt-fallback-fails" })])
  });
  const service = createHistoricalEventsService({
    repository,
    fetchFallbackImage: async () => { throw new Error("timeout réseau"); }
  });
  const result = await service.getEventsForDateKey("03-12");
  assert.equal(result.events.france.image_url, null);
});

test("le repli est mis en cache par event.id -> un seul appel pour plusieurs lectures du même événement", async () => {
  const repository = createHistoricalEventsRepository({
    filePath: "fixture.json",
    readFileSync: () => JSON.stringify([baseEvent({ id: "evt-cached-fallback" })])
  });
  let fallbackCalls = 0;
  const service = createHistoricalEventsService({
    repository,
    fetchFallbackImage: async () => { fallbackCalls++; return { imageUrl: "https://upload.wikimedia.org/x.jpg" }; }
  });
  await service.getEventsForDateKey("03-12");
  await service.getEventsForDateKey("03-12");
  await service.getEventsForMonthDay(3, 12);
  assert.equal(fallbackCalls, 1, "le repli ne doit être appelé qu'une seule fois, les lectures suivantes réutilisent le cache");
});
