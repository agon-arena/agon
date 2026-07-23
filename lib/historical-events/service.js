"use strict";

// Assemble la vue "jour" publique — les 3 catégories dans un ordre fixe
// (france, europe, world), mappées via public-mapper — à partir du
// repository. Aucun accès réseau, aucun appel IA : uniquement
// data/historical-events/events.json via le repository injecté.

const { CATEGORIES } = require("./constants");
const { formatDateKey } = require("./validator");
const { createHistoricalEventsRepository, resolveNow } = require("./repository");
const { toPublicEvent } = require("./public-mapper");

// Une catégorie sans événement pour la date donnée doit valoir null, jamais
// être absente de l'objet — cf. format de sortie attendu.
function buildDailyView(dateKey, events) {
  const byCategory = new Map(events.map((event) => [event.category, event]));
  const result = { date_key: dateKey, events: {} };
  for (const category of CATEGORIES) {
    const event = byCategory.get(category);
    result.events[category] = event ? toPublicEvent(event) : null;
  }
  return result;
}

function createHistoricalEventsService(options = {}) {
  const { repository = createHistoricalEventsRepository() } = options;

  function getEventsForDateKey(dateKey, queryOptions = {}) {
    const events = repository.getByDateKey(dateKey, queryOptions);
    return buildDailyView(dateKey, events);
  }

  function getEventsForMonthDay(month, day, queryOptions = {}) {
    const events = repository.getByMonthDay(month, day, queryOptions);
    return buildDailyView(formatDateKey(month, day), events);
  }

  function getTodayEvents({ now, ...queryOptions } = {}) {
    const { month, day } = resolveNow(now);
    return getEventsForMonthDay(month, day, queryOptions);
  }

  return { getEventsForDateKey, getEventsForMonthDay, getTodayEvents };
}

module.exports = { createHistoricalEventsService, buildDailyView };
