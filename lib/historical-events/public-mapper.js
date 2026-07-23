"use strict";

// Retire les champs internes/éditoriaux d'un événement (workflow de
// relecture, sourcing d'image brut) avant exposition publique, et remplace
// image_filename par une URL locale sûre (cf. image-path.js) — jamais le nom
// de fichier brut ni image_source_url/image_original_url/image_rights_verified.

const { buildLocalImageUrl } = require("./image-path");

const PUBLIC_FIELDS = [
  "id",
  "category",
  "year",
  "year_display",
  "period",
  "title",
  "summary_short",
  "summary_long",
  "location",
  "historical_source_name",
  "historical_source_url",
  "secondary_source_name",
  "secondary_source_url",
  "image_author",
  "image_date",
  "image_institution",
  "image_license",
  "image_license_url",
  "image_credit"
];

function toPublicEvent(event) {
  if (!event || typeof event !== "object") return null;

  const publicEvent = {};
  for (const field of PUBLIC_FIELDS) {
    publicEvent[field] = field in event ? event[field] : null;
  }
  publicEvent.content_warnings = Array.isArray(event.content_warnings) ? [...event.content_warnings] : [];
  publicEvent.image_url = buildLocalImageUrl(event.image_filename);

  return publicEvent;
}

module.exports = { toPublicEvent, PUBLIC_FIELDS };
