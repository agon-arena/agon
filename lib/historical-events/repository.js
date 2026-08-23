"use strict";

// Accès en lecture seule à data/historical-events/events.json. Aucun accès
// réseau, aucun appel IA, aucune dépendance à Supabase : uniquement le
// fichier local, chargé et validé une fois puis mis en cache en mémoire.
// Dépendances injectables (filePath, readFileSync) pour rester testable
// sans toucher au vrai fichier ni au disque, comme lib/parallele-historique.js.

const fs = require("fs");
const path = require("path");
const { validateDataset, formatDateKey } = require("./validator");
const { DATE_KEY_PATTERN } = require("./constants");

const DEFAULT_EVENTS_PATH = path.join(__dirname, "../../data/historical-events/events.json");

function parseJsonOrThrow(raw, filePath) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`historical-events: JSON invalide dans ${filePath} (${err.message}).`);
  }
}

// Un événement "rejected" ne doit jamais être lu par un appelant, quel qu'il
// soit : ce filtre est appliqué à l'indexation, pas laissé au choix des
// fonctions de lecture (contrairement à "validated" qui reste optionnel).
function isReadable(event) {
  return event && event.review_status !== "rejected";
}

// Copie superficielle : l'objet mis en cache n'est jamais retourné tel quel,
// pour qu'aucun appelant ne puisse muter les données partagées par accident.
function cloneEvent(event) {
  return {
    ...event,
    content_warnings: Array.isArray(event.content_warnings) ? [...event.content_warnings] : event.content_warnings
  };
}

function buildIndex(events) {
  const byDateKey = new Map();
  for (const event of events) {
    if (!isReadable(event)) continue;
    if (!byDateKey.has(event.date_key)) byDateKey.set(event.date_key, []);
    byDateKey.get(event.date_key).push(event);
  }
  return byDateKey;
}

// Résout une valeur "now" (Date, string, undefined) en {month, day} — point
// unique de résolution de date pour rester cohérent entre getTodayEvents()
// ici et l'équivalent du service (cf. service.js).
function resolveNow(now) {
  const date = now === undefined ? new Date() : now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`historical-events: date "now" invalide (${String(now)}).`);
  }
  return { month: date.getMonth() + 1, day: date.getDate() };
}

function createHistoricalEventsRepository(options = {}) {
  const { filePath = DEFAULT_EVENTS_PATH, readFileSync = fs.readFileSync } = options;

  let cache = null;

  function loadEvents() {
    if (cache) return cache;

    let raw;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (err) {
      throw new Error(`historical-events: impossible de lire ${filePath} (${err.message}).`);
    }

    const parsed = parseJsonOrThrow(raw, filePath);
    if (!Array.isArray(parsed)) {
      throw new Error(`historical-events: ${filePath} doit contenir un tableau JSON.`);
    }

    const validation = validateDataset(parsed);
    if (!validation.ok) {
      const details = validation.errors.slice(0, 5).map((e) => `[${e.id}] ${e.message}`).join(" ; ");
      const more = validation.errors.length > 5 ? ` (+${validation.errors.length - 5} autre(s))` : "";
      throw new Error(`historical-events: ${filePath} invalide — ${validation.errors.length} erreur(s) : ${details}${more}`);
    }

    cache = { events: parsed, byDateKey: buildIndex(parsed) };
    return cache;
  }

  function clearCache() {
    cache = null;
  }

  // onlyMemorizable (demande du 17/08/2026, audit du pipeline mnésique) :
  // filtre DISTINCT de "onlyValidated" ci-dessous (jamais mélangé au même nom
  // d'option, pour ne jamais laisser croire qu'ils ont la même sévérité).
  // Sert exclusivement au garde-fou côté génération de QCM (cf. server.js
  // buildNotionQuestions, sourceType "histoire") : un événement ne doit pas
  // servir de base à une connaissance mémorisable s'il n'est pas
  // suffisamment validé — jusqu'ici getAll() ne filtrait que les "rejected"
  // (isReadable), laissant passer n'importe quel "draft" (jamais relu) vers
  // la génération. Repli transitoire volontaire plutôt qu'un onlyValidated
  // strict : au moment de ce correctif, le dataset réel ne compte AUCUN
  // événement "validated" (le validateur exige date_certainty="high" pour ce
  // statut, jamais encore atteint en pratique) mais 6 événements "reviewed"
  // déjà à date_certainty "high" — un filtre strict sur "validated" seul
  // aurait donc éteint silencieusement "Ce jour dans l'Histoire" en
  // production (0 événement disponible en permanence), ce que la demande
  // d'origine excluait explicitement ("ne casse pas silencieusement une
  // logique"). N'admet donc "reviewed" QUE si date_certainty vaut déjà
  // "high" — jamais "reviewed" seul, jamais "draft" quel que soit son
  // date_certainty. Se resserre de lui-même vers l'équivalent d'un
  // "validated" strict au fur et à mesure que le dataset sera relu, sans
  // modification de code à refaire ici. N'affecte PAS getByDateKey/
  // getByMonthDay/getTodayEvents (route publique /api/historical-events),
  // qui gardent leur propre onlyValidated strict et inchangé (cf. plus bas) :
  // "reviewed" n'est PAS traité comme équivalent à "validated" ailleurs dans
  // le code, uniquement dans ce repli local au point d'entrée mnésique.
  function getAll({ onlyMemorizable = false } = {}) {
    const events = loadEvents().events.filter(isReadable);
    const filtered = onlyMemorizable
      ? events.filter((e) => e.review_status === "validated" || (e.review_status === "reviewed" && e.date_certainty === "high"))
      : events;
    return filtered.map(cloneEvent);
  }

  function getByDateKey(dateKey, { onlyValidated = false } = {}) {
    if (typeof dateKey !== "string" || !DATE_KEY_PATTERN.test(dateKey)) {
      throw new Error(`historical-events: date_key invalide ("${dateKey}"), format attendu MM-DD.`);
    }
    const [month, day] = dateKey.split("-").map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      throw new Error(`historical-events: date_key invalide ("${dateKey}"), mois ou jour hors bornes.`);
    }
    const { byDateKey } = loadEvents();
    const events = byDateKey.get(dateKey) || [];
    const filtered = onlyValidated ? events.filter((e) => e.review_status === "validated") : events;
    return filtered.map(cloneEvent);
  }

  function getByMonthDay(month, day, options = {}) {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error(`historical-events: month invalide (${month}).`);
    }
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new Error(`historical-events: day invalide (${day}).`);
    }
    return getByDateKey(formatDateKey(month, day), options);
  }

  function getTodayEvents({ now, ...rest } = {}) {
    const { month, day } = resolveNow(now);
    return getByMonthDay(month, day, rest);
  }

  return { loadEvents, getAll, getByDateKey, getByMonthDay, getTodayEvents, clearCache };
}

module.exports = { createHistoricalEventsRepository, resolveNow, DEFAULT_EVENTS_PATH };
