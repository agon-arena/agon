"use strict";

// Validation stricte d'un événement (et d'un jeu d'événements) de la base
// historique quotidienne. Module isolé, sans dépendance à Supabase ni à
// server.js — utilisé par tools/historical-events-audit.js,
// tools/historical-events-import.js et les tests.

const {
  CATEGORIES,
  PERIODS,
  REVIEW_STATUSES,
  DATE_CERTAINTY_LEVELS,
  RATING_MIN,
  RATING_MAX,
  DATE_KEY_PATTERN,
  FIELD_MAX_LENGTHS
} = require("./constants");

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/;
// Nombre de jours max par mois, indépendamment de l'année (le 29 février est
// toléré : un événement du 29/02 reste rattaché à ce jour même les années
// non bissextiles, il n'apparaîtra simplement pas tous les ans côté produit).
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isPlausibleUrl(value) {
  return typeof value === "string" && value.length <= 500 && /^https?:\/\/\S+$/i.test(value.trim());
}

function isNonEmptyString(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isNullableString(value, maxLength) {
  return value === null || value === undefined || (typeof value === "string" && value.length <= maxLength);
}

function isRating(value) {
  return Number.isInteger(value) && value >= RATING_MIN && value <= RATING_MAX;
}

function formatDateKey(month, day) {
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function validateEvent(event) {
  const errors = [];
  const fail = (message) => errors.push(message);

  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return { ok: false, errors: ["l'événement doit être un objet."] };
  }

  if (!isNonEmptyString(event.id, FIELD_MAX_LENGTHS.id) || !ID_PATTERN.test(String(event.id).trim())) {
    fail("id manquant ou invalide (attendu : minuscules/chiffres/tirets, ex. \"1789-07-14-france-bastille\").");
  }

  const monthOk = Number.isInteger(event.month) && event.month >= 1 && event.month <= 12;
  if (!monthOk) fail("month doit être un entier entre 1 et 12.");
  const dayOk = Number.isInteger(event.day) && event.day >= 1 && event.day <= 31;
  if (!dayOk) fail("day doit être un entier entre 1 et 31.");
  if (monthOk && dayOk) {
    const maxDay = DAYS_IN_MONTH[event.month - 1];
    if (event.day > maxDay) fail(`day invalide pour le mois ${event.month} (maximum ${maxDay}).`);
  }

  if (typeof event.date_key !== "string" || !DATE_KEY_PATTERN.test(event.date_key)) {
    fail("date_key doit être au format MM-DD.");
  } else if (monthOk && dayOk) {
    const expected = formatDateKey(event.month, event.day);
    if (event.date_key !== expected) {
      fail(`date_key ("${event.date_key}") incohérent avec month/day (attendu "${expected}").`);
    }
  }

  if (!CATEGORIES.includes(event.category)) fail(`category doit être l'une de : ${CATEGORIES.join(", ")}.`);
  if (!PERIODS.includes(event.period)) fail(`period doit être l'une de : ${PERIODS.join(", ")}.`);
  if (!REVIEW_STATUSES.includes(event.review_status)) fail(`review_status doit être l'un de : ${REVIEW_STATUSES.join(", ")}.`);
  if (!DATE_CERTAINTY_LEVELS.includes(event.date_certainty)) {
    fail(`date_certainty doit être l'une de : ${DATE_CERTAINTY_LEVELS.join(", ")}.`);
  }

  if (!Number.isInteger(event.year)) fail("year doit être un entier (négatif accepté pour avant J.-C.).");
  if (!isNonEmptyString(event.year_display, FIELD_MAX_LENGTHS.year_display)) fail("year_display manquant ou trop long.");

  if (!isNonEmptyString(event.title, FIELD_MAX_LENGTHS.title)) fail("title manquant, vide ou trop long.");
  if (!isNonEmptyString(event.summary_short, FIELD_MAX_LENGTHS.summary_short)) fail("summary_short manquant, vide ou trop long.");
  if (!isNonEmptyString(event.summary_long, FIELD_MAX_LENGTHS.summary_long)) fail("summary_long manquant, vide ou trop long.");
  if (
    typeof event.summary_short === "string" &&
    typeof event.summary_long === "string" &&
    event.summary_short.trim().length > event.summary_long.trim().length
  ) {
    fail("summary_short ne devrait pas être plus long que summary_long.");
  }

  if (!isNullableString(event.location, FIELD_MAX_LENGTHS.location)) fail("location invalide.");

  if (!isNonEmptyString(event.historical_source_name, FIELD_MAX_LENGTHS.historical_source_name)) {
    fail("historical_source_name manquant : une source primaire est obligatoire.");
  }
  if (!isPlausibleUrl(event.historical_source_url)) fail("historical_source_url manquant ou invalide.");
  if (!isNullableString(event.secondary_source_name, FIELD_MAX_LENGTHS.secondary_source_name)) fail("secondary_source_name invalide.");
  if (event.secondary_source_url != null && !isPlausibleUrl(event.secondary_source_url)) fail("secondary_source_url invalide.");

  if (!isRating(event.historical_importance)) fail(`historical_importance doit être un entier entre ${RATING_MIN} et ${RATING_MAX}.`);
  if (!isRating(event.narrative_strength)) fail(`narrative_strength doit être un entier entre ${RATING_MIN} et ${RATING_MAX}.`);
  if (!isRating(event.image_relevance)) fail(`image_relevance doit être un entier entre ${RATING_MIN} et ${RATING_MAX}.`);

  for (const field of ["image_source_url", "image_original_url", "image_license_url"]) {
    if (event[field] != null && !isPlausibleUrl(event[field])) fail(`${field} invalide.`);
  }
  if (!isNullableString(event.image_filename, FIELD_MAX_LENGTHS.image_filename)) fail("image_filename invalide.");
  if (!isNullableString(event.image_author, FIELD_MAX_LENGTHS.image_author)) fail("image_author invalide.");
  if (!isNullableString(event.image_date, FIELD_MAX_LENGTHS.image_date)) fail("image_date invalide.");
  if (!isNullableString(event.image_institution, FIELD_MAX_LENGTHS.image_institution)) fail("image_institution invalide.");
  if (!isNullableString(event.image_license, FIELD_MAX_LENGTHS.image_license)) fail("image_license invalide.");
  if (!isNullableString(event.image_credit, FIELD_MAX_LENGTHS.image_credit)) fail("image_credit invalide.");

  if (typeof event.image_rights_verified !== "boolean") fail("image_rights_verified doit être un booléen.");
  if (event.image_rights_verified === true && !isNonEmptyString(event.image_license, FIELD_MAX_LENGTHS.image_license)) {
    fail("image_license est obligatoire quand image_rights_verified est vrai.");
  }

  if (!Array.isArray(event.content_warnings) || event.content_warnings.some((w) => typeof w !== "string")) {
    fail("content_warnings doit être un tableau de chaînes.");
  }

  if (!isNullableString(event.notes, FIELD_MAX_LENGTHS.notes)) fail("notes invalide.");

  // Garde-fous de publication : un événement "validated" doit être fiable et complet.
  if (event.review_status === "validated") {
    if (event.date_certainty !== "high") fail('review_status "validated" exige date_certainty = "high".');
    if (!isNonEmptyString(event.image_filename, FIELD_MAX_LENGTHS.image_filename)) {
      fail('review_status "validated" exige une image (image_filename renseigné).');
    }
  }

  return { ok: errors.length === 0, errors };
}

// Validation d'ensemble : rejoue validateEvent sur chaque ligne et ajoute les
// contrôles qui ne peuvent se faire qu'au niveau du jeu de données complet
// (id en double, plus d'un événement pour la même date_key + category).
function validateDataset(events) {
  const errors = [];
  if (!Array.isArray(events)) return { ok: false, errors: [{ id: "-", message: "le jeu de données doit être un tableau." }] };

  const seenIds = new Map();
  const seenSlots = new Map();

  events.forEach((event, index) => {
    const label = event && typeof event.id === "string" && event.id ? event.id : `#${index}`;

    const result = validateEvent(event);
    for (const message of result.errors) errors.push({ id: label, message });

    if (event && typeof event.id === "string" && event.id) {
      if (seenIds.has(event.id)) {
        errors.push({ id: label, message: `id en doublon (déjà utilisé par ${seenIds.get(event.id)}).` });
      } else {
        seenIds.set(event.id, label);
      }
    }

    if (event && typeof event.date_key === "string" && typeof event.category === "string") {
      const slot = `${event.date_key}|${event.category}`;
      if (seenSlots.has(slot)) {
        errors.push({
          id: label,
          message: `doublon : un événement existe déjà pour ${event.date_key}/${event.category} (${seenSlots.get(slot)}).`
        });
      } else {
        seenSlots.set(slot, label);
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

module.exports = { validateEvent, validateDataset, formatDateKey, isPlausibleUrl };
