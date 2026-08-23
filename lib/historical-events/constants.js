"use strict";

// Constantes partagées de la base d'événements historiques quotidiens
// ("Ce jour-là" / Bulles Mnoria). Module isolé : aucune dépendance vers
// server.js, aucun effet de bord au chargement.

// Une date peut contenir au maximum un événement par catégorie (jusqu'à 4
// avec culture_science). "culture_science" ajouté pour le lot
// "cartes-jour-annee-aout-semaine-1" (culture/sciences/société), sans
// retirer "europe" utilisé par les événements déjà en place.
const CATEGORIES = ["france", "europe", "world", "culture_science"];

const PERIODS = [
  "antiquity",
  "middle_ages",
  "renaissance",
  "early_modern",
  "french_revolution",
  "revolution_empire",
  "revolution_19th",
  "world_war_1",
  "world_war_2",
  "decolonization",
  "20th_century",
  "21st_century",
  "contemporary"
];

const REVIEW_STATUSES = ["draft", "reviewed", "validated", "rejected"];

const DATE_CERTAINTY_LEVELS = ["high", "medium", "low"];

// Fiabilité de l'anecdote (lot "cartes-jour-annee-aout-semaine-1") :
// "uncertain" ne doit jamais être affichée côté public (cf. public-mapper.js).
const ANECDOTE_RELIABILITY_LEVELS = ["well_attested", "traditional", "debated", "uncertain"];

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
  image_credit: 300,
  why_it_matters: 900,
  anecdote: 900,
  tag: 60,
  source_title: 300
};

module.exports = {
  CATEGORIES,
  PERIODS,
  REVIEW_STATUSES,
  DATE_CERTAINTY_LEVELS,
  ANECDOTE_RELIABILITY_LEVELS,
  RATING_MIN,
  RATING_MAX,
  DATE_KEY_PATTERN,
  FIELD_MAX_LENGTHS
};
