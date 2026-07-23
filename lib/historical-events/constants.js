"use strict";

// Constantes partagées de la base d'événements historiques quotidiens
// ("Ce jour-là" / Bulles Agôn). Module isolé : aucune dépendance vers
// server.js, aucun effet de bord au chargement.

// Une date peut contenir au maximum un événement par catégorie (3 max/jour).
const CATEGORIES = ["france", "europe", "world"];

const PERIODS = [
  "antiquity",
  "middle_ages",
  "early_modern",
  "revolution_19th",
  "20th_century",
  "21st_century"
];

const REVIEW_STATUSES = ["draft", "reviewed", "validated", "rejected"];

const DATE_CERTAINTY_LEVELS = ["high", "medium", "low"];

// historical_importance / narrative_strength / image_relevance : notation éditoriale 1-5.
const RATING_MIN = 1;
const RATING_MAX = 5;

const DATE_KEY_PATTERN = /^\d{2}-\d{2}$/;

const FIELD_MAX_LENGTHS = {
  id: 80,
  title: 200,
  summary_short: 220,
  summary_long: 1400,
  location: 200,
  historical_source_name: 200,
  secondary_source_name: 200,
  year_display: 40,
  notes: 1000,
  image_filename: 200,
  image_author: 200,
  image_date: 40,
  image_institution: 200,
  image_license: 200,
  image_credit: 300
};

module.exports = {
  CATEGORIES,
  PERIODS,
  REVIEW_STATUSES,
  DATE_CERTAINTY_LEVELS,
  RATING_MIN,
  RATING_MAX,
  DATE_KEY_PATTERN,
  FIELD_MAX_LENGTHS
};
