"use strict";

// Assemble la vue "jour" publique — les 3 catégories dans un ordre fixe
// (france, europe, world), mappées via public-mapper — à partir du
// repository. Le seul accès réseau possible est le repli d'image
// (fetchFallbackImage, cf. public-mapper.js) : jamais d'appel IA, jamais
// d'écriture, et mis en cache en mémoire par event.id (cf.
// getCachedFallbackImage) pour ne jamais requêter Wikipedia deux fois pour
// le même événement.

const { CATEGORIES } = require("./constants");
const { formatDateKey } = require("./validator");
const { createHistoricalEventsRepository, resolveNow } = require("./repository");
const { toPublicEvent } = require("./public-mapper");
const { defaultFetchHistoricalEventImage } = require("../parallele-historique");

// Les événements sont statiques (un même id revient chaque année à la même
// date) : un cache en mémoire pour la durée du process suffit, pas besoin
// d'expiration. Une recherche infructueuse (null) est aussi mise en cache,
// pour ne pas re-tenter Wikipedia à chaque requête sur un événement qui n'a
// simplement aucune photo trouvable.
const fallbackImageCache = new Map();
async function getCachedFallbackImage(eventId, fetchFn) {
  if (fallbackImageCache.has(eventId)) return fallbackImageCache.get(eventId);
  let result = null;
  try {
    result = await fetchFn();
  } catch (err) {
    result = null;
  }
  fallbackImageCache.set(eventId, result);
  return result;
}

// Une catégorie sans événement pour la date donnée doit valoir null, jamais
// être absente de l'objet — cf. format de sortie attendu.
async function buildDailyView(dateKey, events, { fetchFallbackImage } = {}) {
  const byCategory = new Map(events.map((event) => [event.category, event]));
  const result = { date_key: dateKey, events: {} };
  const entries = await Promise.all(
    CATEGORIES.map(async (category) => {
      const event = byCategory.get(category);
      if (!event) return [category, null];
      const cachedFetch = typeof fetchFallbackImage === "function"
        ? (title, context) => getCachedFallbackImage(event.id, () => fetchFallbackImage(title, context))
        : undefined;
      return [category, await toPublicEvent(event, { fetchFallbackImage: cachedFetch })];
    })
  );
  for (const [category, publicEvent] of entries) {
    result.events[category] = publicEvent;
  }
  return result;
}

function createHistoricalEventsService(options = {}) {
  const {
    repository = createHistoricalEventsRepository(),
    fetchFallbackImage = defaultFetchHistoricalEventImage
  } = options;

  async function getEventsForDateKey(dateKey, queryOptions = {}) {
    const events = repository.getByDateKey(dateKey, queryOptions);
    return buildDailyView(dateKey, events, { fetchFallbackImage });
  }

  async function getEventsForMonthDay(month, day, queryOptions = {}) {
    const events = repository.getByMonthDay(month, day, queryOptions);
    return buildDailyView(formatDateKey(month, day), events, { fetchFallbackImage });
  }

  async function getTodayEvents({ now, ...queryOptions } = {}) {
    const { month, day } = resolveNow(now);
    return getEventsForMonthDay(month, day, queryOptions);
  }

  return { getEventsForDateKey, getEventsForMonthDay, getTodayEvents };
}

module.exports = { createHistoricalEventsService, buildDailyView };
