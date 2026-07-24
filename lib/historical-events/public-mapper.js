"use strict";

// Retire les champs internes/éditoriaux d'un événement (workflow de
// relecture, sourcing d'image brut) avant exposition publique, et remplace
// image_filename par une URL locale sûre (cf. image-path.js) — jamais le nom
// de fichier brut ni image_source_url/image_original_url/image_rights_verified.
//
// Repli image (fetchFallbackImage, injecté) : quand le lot n'a fourni aucune
// image exploitable (absente, ou SVG exclu par image-path.js — carte/drapeau,
// jamais une vraie photo), on cherche une vraie photo en direct plutôt que de
// publier la carte de côté ou aucune image du tout — "une image à chaque
// fois" plutôt qu'au mieux. Toujours créditée "Wikipedia" dans ce cas (jamais
// le credit du lot, qui décrit un tout autre visuel exclu).

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

async function toPublicEvent(event, { fetchFallbackImage } = {}) {
  if (!event || typeof event !== "object") return null;

  const publicEvent = {};
  for (const field of PUBLIC_FIELDS) {
    publicEvent[field] = field in event ? event[field] : null;
  }
  publicEvent.content_warnings = Array.isArray(event.content_warnings) ? [...event.content_warnings] : [];
  publicEvent.image_url = buildLocalImageUrl(event.image_filename);
  publicEvent.image_page_url = null;

  if (!publicEvent.image_url && typeof fetchFallbackImage === "function") {
    let fallback = null;
    try {
      fallback = await fetchFallbackImage(event.title, event.summary_long || event.summary_short);
    } catch (err) {
      fallback = null; // best-effort : jamais bloquant, publié sans image comme avant en cas d'échec.
    }
    if (fallback && fallback.imageUrl) {
      publicEvent.image_url = fallback.imageUrl;
      publicEvent.image_page_url = fallback.pageUrl || null;
      // Le credit/auteur/institution/licence du lot décrivent le visuel
      // EXCLU (souvent une carte SVG) — jamais affichés avec une image
      // différente : entièrement remplacés par le crédit Wikipedia.
      publicEvent.image_credit = "Wikipedia";
      publicEvent.image_author = null;
      publicEvent.image_date = null;
      publicEvent.image_institution = null;
      publicEvent.image_license = null;
      publicEvent.image_license_url = null;
    }
  }

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
