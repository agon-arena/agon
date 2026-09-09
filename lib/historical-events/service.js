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
// Persisté par l'appelant (server.js, cf. hydrateFallbackImageCache/
// setFallbackImageCachePersistHook plus bas) depuis le 09/09/2026 ("Ce jour dans
// l'Histoire met du temps à apparaître") : sans ça, ce cache mémoire repart à zéro
// à CHAQUE redémarrage serveur (déploiement Render, restart pm2) — le·s premier·s
// visiteur·s après chaque redémarrage repayaient alors la recherche Wikipedia pour
// tout événement du jour sans image locale, jusqu'à plusieurs secondes, alors que
// Wikipedia n'a aucune raison de répondre différemment entre deux redémarrages. Ce
// fichier reste volontairement ignorant de Supabase (cf. commentaire de tête) : la
// persistance elle-même vit entièrement côté appelant, ici seulement un point
// d'hydratation/notification.
const fallbackImageCache = new Map();
let onFallbackImageCacheMiss = null;

// Appelé une seule fois au démarrage (server.js) avec le contenu déjà persisté :
// pré-remplit le cache AVANT qu'aucune requête réelle n'arrive, pour qu'un
// redémarrage ne fasse plus jamais repayer une recherche déjà résolue.
function hydrateFallbackImageCache(entries) {
  for (const [eventId, value] of Object.entries(entries || {})) {
    fallbackImageCache.set(eventId, value);
  }
}

// Notifié uniquement sur un VRAI nouveau calcul (jamais sur une lecture de cache
// déjà chaud) : l'appelant (server.js) persiste alors la nouvelle entrée, best-effort,
// jamais bloquant pour la réponse déjà envoyée au visiteur.
function setFallbackImageCachePersistHook(fn) {
  onFallbackImageCacheMiss = typeof fn === "function" ? fn : null;
}

async function getCachedFallbackImage(eventId, fetchFn) {
  if (fallbackImageCache.has(eventId)) return fallbackImageCache.get(eventId);
  let result = null;
  try {
    result = await fetchFn();
  } catch (err) {
    result = null;
  }
  fallbackImageCache.set(eventId, result);
  if (onFallbackImageCacheMiss) {
    try { onFallbackImageCacheMiss(eventId, result); } catch (err) {}
  }
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

module.exports = { createHistoricalEventsService, buildDailyView, hydrateFallbackImageCache, setFallbackImageCachePersistHook };
