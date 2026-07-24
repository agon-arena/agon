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
  "image_credit",
  // Champs narratifs du lot "cartes-jour-annee-aout-semaine-1". "sources" et
  // "tags" sont des tableaux : copiés explicitement plus bas (jamais via
  // cette boucle, qui recopierait la référence de l'objet mis en cache par
  // le repository — cf. tags/sources ci-dessous).
  "why_it_matters",
  "anecdote_reliability"
];

function toPublicEvent(event) {
  if (!event || typeof event !== "object") return null;

  const publicEvent = {};
  for (const field of PUBLIC_FIELDS) {
    publicEvent[field] = field in event ? event[field] : null;
  }
  publicEvent.content_warnings = Array.isArray(event.content_warnings) ? [...event.content_warnings] : [];
  publicEvent.image_url = buildLocalImageUrl(event.image_filename);

  // "conserver les sources dans les données même si elles ne sont pas encore
  // affichées" : présentes dans la sortie publique, copiées (jamais la
  // référence du tableau mis en cache) pour qu'aucune mutation d'un
  // appelant ne puisse atteindre le cache du repository.
  publicEvent.tags = Array.isArray(event.tags) ? [...event.tags] : [];
  publicEvent.sources = Array.isArray(event.sources) ? event.sources.map((s) => ({ ...s })) : [];

  // Une anecdote "uncertain" ne doit jamais atteindre le client, même caché
  // par du CSS : elle est retirée ici, à la source, pas seulement côté
  // affichage. anecdote_reliability reste exposé pour que l'interface sache
  // pourquoi il n'y a pas d'anecdote (plutôt qu'une simple absence muette).
  publicEvent.anecdote = event.anecdote_reliability === "uncertain" ? null : (event.anecdote || null);

  return publicEvent;
}

module.exports = { toPublicEvent, PUBLIC_FIELDS };
