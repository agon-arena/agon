"use strict";

// Recherche d'image générique pour une "connaissance" sujet libre / notion de
// débat avec niveau (lib/knowledge-admission.js, buildFicheAndKnowledgeAdmissionPrompt) —
// seul pipeline "connaissance" qui n'a aujourd'hui AUCUNE image (les 6 rubriques
// Éclairages parallele/pensee/mecanisme/concept/citation/oeuvre ont chacune déjà
// leur propre recherche Wikipedia, dupliquée par rubrique — cf. leurs fichiers
// respectifs, WIKIPEDIA_IMAGE_FETCH_TIMEOUT_MS etc.). Même mécanisme qu'elles,
// généralisé pour accepter une requête de recherche libre (image_search_query
// fournie par l'IA dans le MÊME appel qui rédige déjà la fiche, jamais un appel
// IA dédié) plutôt qu'un nom de personne connu à l'avance.
//
// API publique Wikipedia (action=query&generator=search), aucune clé requise,
// jamais d'image générée. Best-effort strict : n'importe quelle erreur réseau,
// timeout, ou absence de résultat pertinent renvoie simplement `null`, jamais
// une exception qui remonterait — cf. son appelant, qui ne doit jamais bloquer
// la génération de la connaissance/du QCM pour cette seule recherche.
//
// Recherché UNE SEULE FOIS par connaissance (au moment de sa génération) —
// la mise en cache elle-même n'est pas le rôle de ce fichier : le résultat est
// stocké tel quel dans sourceDetail.image (cf. server.js) puis persiste dans le
// JSONB daily_quiz.questions, relu ensuite pour la fiche/le QCM/les révisions
// sans jamais rappeler ce module.

const WIKIPEDIA_IMAGE_FETCH_TIMEOUT_MS = 8000;
// Légende réelle sous l'image (demande du 07/09/2026) : appel séparé, léger
// et strictement best-effort — ne doit jamais retarder ni faire échouer la
// recherche d'image elle-même en cas de lenteur/erreur.
const WIKIPEDIA_CAPTION_FETCH_TIMEOUT_MS = 6000;
const WIKIPEDIA_CAPTION_MAX_LENGTH = 300;
const WIKIPEDIA_IMAGE_FETCH_ROUNDS = 2;
const WIKIPEDIA_IMAGE_RETRY_DELAY_MS = 400;
const WIKIMEDIA_IMAGE_HOST_PREFIX = "https://upload.wikimedia.org/";
const WIKIPEDIA_SEARCH_LANGS = ["fr", "en"];
// Largeur de vignette demandée (demande du 18/08/2026, qualité en fond de
// QCM) : 800 suffisait pour la petite illustration de la fiche, mais devient
// flou/pixelisé une fois étiré en fond plein écran (cf.
// applyQuestionBackgroundImage côté client). Ne change rien pour la fiche —
// un navigateur réduit une image plus grande sans perte, seul l'agrandissement
// pose problème. L'API ne peut jamais renvoyer plus grand que la résolution
// native réelle (cf. `width`/`height` retournés ci-dessous, utilisés côté
// client pour écarter les sources trop petites plutôt que de laisser une
// image bien réelle mais insuffisante s'afficher floue en fond).
const IMAGE_THUMB_WIDTH_PX = 1600;
// Plusieurs candidats par recherche (demande du 18/08/2026, couverture trop
// faible) : gsrlimit=1 abandonnait dès que le tout premier résultat n'avait
// pas d'image de tête / était un SVG / ne partageait aucun mot avec la
// requête, sans jamais essayer le 2e ou 3e résultat pourtant souvent valide.
const WIKIPEDIA_IMAGE_CANDIDATE_LIMIT = 5;
const COMMONS_IMAGE_CANDIDATE_LIMIT = 5;
// Types réellement affichables par un <img> de navigateur — exclut le TIFF
// (fréquent sur Commons pour des scans haute résolution, jamais rendu par
// Chrome/Safari) en plus du SVG déjà exclu pour Wikipedia.
const COMMONS_RENDERABLE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const WIKIPEDIA_MATCH_STOPWORDS = new Set([
  "dans", "les", "des", "une", "avec", "pour", "contre", "leurs", "cette",
  "sont", "plus", "entre", "ainsi", "comme", "depuis", "their", "with",
  "from", "were", "have", "this", "that", "been", "during", "under"
]);

function stripDiacritics(str) {
  return String(str || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function significantWordsForMatch(str) {
  return stripDiacritics(str).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .map((w) => w.replace(/s$/, ""))
    .filter((w) => w.length >= 4 && !WIKIPEDIA_MATCH_STOPWORDS.has(w));
}

// Contrôle de pertinence déterministe (§9 du cahier des charges) : jamais un
// second appel IA pour juger l'image — seulement une vérification lexicale
// simple, que la requête et le titre de la page trouvée partagent au moins un
// mot significatif (≥4 lettres, hors mots vides). Insuffisant pour prouver la
// pertinence, mais suffit à écarter les dérives évidentes (résultat de
// recherche sans rapport avec la requête).
function titlesShareSignificantWord(queryText, pageTitle) {
  const queryWords = new Set(significantWordsForMatch(queryText));
  if (!queryWords.size) return false;
  return significantWordsForMatch(pageTitle).some((w) => queryWords.has(w));
}

// Trie par `.index` (rang de pertinence réel renvoyé par l'API) plutôt que
// par l'ordre d'itération de l'objet `pages` — les clés y sont les pageids,
// et JS réordonne silencieusement les clés numériques par valeur croissante,
// PAS par ordre d'insertion : sans ce tri, on parcourrait les résultats dans
// le désordre (par pageid) plutôt que du plus au moins pertinent.
function sortPagesByRelevanceIndex(pages) {
  return Object.values(pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
}

// Largeur RÉELLEMENT servie, extraite du chemin de l'URL elle-même (motif
// ".../NNNpx-Nom-de-fichier") plutôt que des champs `width`/`thumbwidth`
// renvoyés par l'API (demande du 18/08/2026, qualité en fond de QCM) : ces
// champs se sont avérés mensongers quand la source native est plus petite
// que la largeur demandée — l'API échoue silencieusement à générer une
// vraie miniature (elle sert alors le fichier original tel quel) mais
// continue à renvoyer la largeur DEMANDÉE dans ses métadonnées, jamais la
// largeur réellement livrée (constaté en téléchargeant et mesurant de vrais
// fichiers Wikipedia/Commons : un thumbnail annoncé à 5000px s'est révélé
// être l'original à 3840px, un autre annoncé à 1600px n'était en réalité
// que du 130px). Le nom de fichier généré par le thumbnailer MediaWiki,
// lui, reflète toujours fidèlement ce qui est vraiment envoyé — absent
// (renvoie null) uniquement quand aucune miniature n'a pu être générée du
// tout, cas traité séparément dans queryCommonsImage (repli sur la largeur
// native déclarée par `iiprop=size`, fiable dans CE cas précis).
function extractDeliveredWidthFromUrl(url) {
  const match = /(\d+)px-/.exec(String(url || ""));
  return match ? Number(match[1]) : null;
}

// Nom de fichier tel qu'utilisé par l'API media-list (`Fichier:X.jpg`,
// `File:X.jpg` selon la langue) — retire le préfixe pour comparer à
// `page.pageimage`, qui lui ne le porte jamais.
function stripWikipediaFileTitlePrefix(title) {
  return String(title || "").replace(/^(?:Fichier|File|Datei|Archivo|Immagine|Bestand):/i, "");
}

// Repli quand l'article ne porte AUCUNE légende structurée (fréquent pour un
// portrait d'infobox, cf. commentaire de fetchWikipediaImageCaption) — demande
// du 09/09/2026, "il faut aussi mettre un titre sous l'image... je veux que ça
// le fasse SYSTÉMATIQUEMENT" : plutôt que de n'afficher que le nom de la
// source (Wikipedia/Wikimedia Commons) sans rien d'autre, dérive une légende
// lisible depuis le nom de fichier lui-même (ex. "John_Dewey_in_1902.jpg" ->
// "John Dewey in 1902") — c'est exactement ce que l'utilisateur voit en
// survolant/ouvrant l'image sur Wikipedia, jamais une légende inventée par
// nous. Retire le préfixe File:/Fichier:, l'extension, remplace les "_" par
// des espaces. Ne renvoie jamais une chaîne vide (fileName déjà vérifié non
// vide par les deux appelants).
function deriveCaptionFromFileName(fileName) {
  const stripped = stripWikipediaFileTitlePrefix(fileName)
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/_/g, " ")
    .trim();
  return stripped || null;
}

// Légende réellement affichée SOUS l'image dans l'article Wikipedia (demande
// du 07/09/2026, "je veux les vraies légendes") — jamais une légende
// inventée. L'API REST officielle `page/media-list` est celle utilisée par
// les applications Wikipedia elles-mêmes pour afficher cette légende ; elle
// ne renvoie un champ `caption` que si l'article en porte réellement une
// (paramètre `légende=`/`caption=` d'infobox, ou figcaption d'une image de
// section) — de nombreuses images de tête (portraits d'infobox notamment)
// n'en ont simplement AUCUNE sur Wikipedia lui-même, `null` ici reflète alors
// fidèlement la page plutôt qu'un échec de récupération. Best-effort strict,
// comme le reste du fichier : jamais bloquant pour la recherche d'image.
async function fetchWikipediaImageCaption(lang, pageTitle, fileName, fetchImpl) {
  if (!pageTitle || !fileName) return null;
  const encodedTitle = encodeURIComponent(String(pageTitle).trim().replace(/ /g, "_"));
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/media-list/${encodedTitle}`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(WIKIPEDIA_CAPTION_FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = await res.json();
    const items = Array.isArray(body && body.items) ? body.items : [];
    const match = items.find((item) => stripWikipediaFileTitlePrefix(item && item.title) === fileName);
    const captionText = match && match.caption && match.caption.text ? String(match.caption.text).trim() : "";
    return captionText ? captionText.slice(0, WIKIPEDIA_CAPTION_MAX_LENGTH) : null;
  } catch {
    return null;
  }
}

async function queryWikipediaImage(lang, query, fetchImpl) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${WIKIPEDIA_IMAGE_CANDIDATE_LIMIT}&prop=pageimages%7Cinfo&inprop=url&pithumbsize=${IMAGE_THUMB_WIDTH_PX}&format=json&origin=*`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(WIKIPEDIA_IMAGE_FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  const body = await res.json();
  const pages = body && body.query && body.query.pages;
  if (!pages) return null;
  for (const page of sortPagesByRelevanceIndex(pages)) {
    const imageUrl = page && page.thumbnail && page.thumbnail.source;
    if (!imageUrl || !imageUrl.startsWith(WIKIMEDIA_IMAGE_HOST_PREFIX)) continue;
    // Exclut les images "de tête" en SVG (cartes, drapeaux, blasons, schémas) —
    // jamais une vraie photo/illustration éditoriale (§9, "exclusion de certains
    // types de fichiers").
    if (/\.svg(\/|$)/i.test(imageUrl)) continue;
    if (!titlesShareSignificantWord(query, page.title || "")) continue;
    const pageUrl = page.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(page.title || "").replace(/ /g, "_"))}`;
    const realCaption = await fetchWikipediaImageCaption(lang, page.title || "", page.pageimage || "", fetchImpl);
    const caption = realCaption || deriveCaptionFromFileName(page.pageimage || "");
    return { imageUrl, pageUrl, pageTitle: page.title || null, width: extractDeliveredWidthFromUrl(imageUrl), caption };
  }
  return null;
}

// Repli Wikimedia Commons (demande du 18/08/2026) : cherche directement un
// fichier média pertinent (namespace 6 = File:) plutôt qu'une image de tête
// d'article Wikipedia — utilisé seulement quand aucune des deux langues
// Wikipedia n'a rien donné (cf. searchKnowledgeImage), jamais en premier
// choix (les images de tête Wikipedia restent mieux cadrées éditorialement).
async function queryCommonsImage(query, fetchImpl) {
  // iiprop=size (demande du 18/08/2026) : sert de repli fiable pour `width`
  // dans le seul cas où extractDeliveredWidthFromUrl échoue (aucune
  // miniature générée, thumburl retombe sur l'original tel quel) — ce champ
  // natif s'est révélé exact dans ce cas précis (contrairement à
  // thumbwidth/thumbheight, mensongers quand la source est trop petite).
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=${COMMONS_IMAGE_CANDIDATE_LIMIT}&prop=imageinfo&iiprop=url%7Cextmetadata%7Cmime%7Cdescriptionurl%7Csize&iiurlwidth=${IMAGE_THUMB_WIDTH_PX}&format=json&origin=*`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(WIKIPEDIA_IMAGE_FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  const body = await res.json();
  const pages = body && body.query && body.query.pages;
  if (!pages) return null;
  for (const page of sortPagesByRelevanceIndex(pages)) {
    const info = page && page.imageinfo && page.imageinfo[0];
    if (!info) continue;
    if (!COMMONS_RENDERABLE_MIME_TYPES.has(info.mime)) continue;
    const imageUrl = info.thumburl || info.url;
    if (!imageUrl || !imageUrl.startsWith(WIKIMEDIA_IMAGE_HOST_PREFIX)) continue;
    const rawTitle = String(page.title || "").replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "");
    if (!titlesShareSignificantWord(query, rawTitle)) continue;
    const artistHtml = info.extmetadata && info.extmetadata.Artist && info.extmetadata.Artist.value;
    const credit = artistHtml ? String(artistHtml).replace(/<[^>]+>/g, "").trim().slice(0, 120) || null : null;
    // descriptionurl (fourni par l'API, cf. iiprop ci-dessus) plutôt que
    // reconstruit à la main : évite d'encoder le ":" de "File:" en %3A
    // (encodeURIComponent l'échapperait, contrairement à l'URL canonique
    // renvoyée par MediaWiki) — même principe que page.fullurl pour Wikipedia.
    const pageUrl = info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(page.title || "").replace(/ /g, "_"))}`;
    const width = extractDeliveredWidthFromUrl(imageUrl) || info.width || null;
    // Commons n'a pas d'équivalent à la légende d'article Wikipedia (notion
    // qui n'existe pas pour un fichier isolé) — même repli sur le nom de
    // fichier que côté Wikipedia (deriveCaptionFromFileName), demande du
    // 09/09/2026 : systématique, pas seulement quand Wikipedia en fournit une.
    const caption = deriveCaptionFromFileName(rawTitle);
    return { imageUrl, pageUrl, pageTitle: rawTitle || null, credit, width, caption };
  }
  return null;
}

// Cherche une image pertinente pour `query` (déjà fournie par l'IA dans le
// même appel que la fiche, cf. lib/knowledge-admission.js). best-effort : ne
// lève jamais, renvoie `null` sur toute erreur, timeout, ou absence de
// résultat pertinent (§4/§8 du cahier des charges — pas d'image plutôt qu'une
// mauvaise image, et jamais bloquant pour la génération principale).
// Renvoie le même format que extractCultureGeneraleItemImage côté server.js
// ({url, credit, pageUrl, source}), pour que le client (déjà câblé sur ce
// format pour les 6 rubriques Éclairages) affiche cette image sans aucune
// modification, plus `width` (demande du 18/08/2026) : résolution réellement
// livrée, jamais utilisée pour l'affichage en fiche (une petite image y
// reste tout à fait valable), seulement pour écarter une source trop petite
// d'un usage en fond plein écran (cf. applyQuestionBackgroundImage côté
// client, MIN_BACKGROUND_IMAGE_WIDTH), et `caption` (demande du 07/09/2026) :
// la légende RÉELLE affichée sous l'image dans l'article Wikipedia source
// (cf. fetchWikipediaImageCaption), `null` si cette page n'en porte
// simplement aucune — uniquement pour le chemin Wikipedia (§ Commons
// ci-dessous garde son `credit` Artist existant, notion différente d'une
// légende d'article).
async function searchKnowledgeImage(query, options = {}) {
  const cleanQuery = String(query || "").trim();
  const label = options.logLabel || cleanQuery;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!cleanQuery || typeof fetchImpl !== "function") return null;

  console.log(`[knowledge-image] search started knowledge="${label}"`);
  for (let round = 1; round <= WIKIPEDIA_IMAGE_FETCH_ROUNDS; round++) {
    for (const lang of WIKIPEDIA_SEARCH_LANGS) {
      try {
        const result = await queryWikipediaImage(lang, cleanQuery, fetchImpl);
        if (result) {
          console.log(`[knowledge-image] found source=wikimedia lang=${lang} knowledge="${label}" caption=${result.caption ? "yes" : "no"}`);
          return { url: result.imageUrl, credit: null, caption: result.caption || null, pageUrl: result.pageUrl, source: "wikipedia", width: result.width };
        }
      } catch (error) {
        console.warn(`[knowledge-image] provider error lang=${lang} knowledge="${label}" :`, error.message);
      }
    }
    if (round < WIKIPEDIA_IMAGE_FETCH_ROUNDS) {
      await new Promise((resolve) => setTimeout(resolve, WIKIPEDIA_IMAGE_RETRY_DELAY_MS));
    }
  }

  // Repli Commons (demande du 18/08/2026) : seulement une fois les deux
  // langues Wikipedia épuisées — reste secondaire, une image de tête
  // d'article Wikipedia étant en général mieux cadrée éditorialement qu'un
  // fichier média isolé.
  try {
    const commonsResult = await queryCommonsImage(cleanQuery, fetchImpl);
    if (commonsResult) {
      console.log(`[knowledge-image] found source=wikimedia-commons knowledge="${label}"`);
      return { url: commonsResult.imageUrl, credit: commonsResult.credit, caption: commonsResult.caption || null, pageUrl: commonsResult.pageUrl, source: "wikimedia-commons", width: commonsResult.width };
    }
  } catch (error) {
    console.warn(`[knowledge-image] commons provider error knowledge="${label}" :`, error.message);
  }

  console.log(`[knowledge-image] no relevant result knowledge="${label}"`);
  return null;
}

module.exports = { searchKnowledgeImage };
