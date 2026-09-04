"use strict";

// Mise en évidence des knowledgeTargets dans les paragraphes de fiche
// (Phase 2.4, 04/09/2026) — fichier PUR (aucun réseau, aucun appel IA), même
// principe que lib/text-boundaries.js/lib/qcm-quality.js : résout, de façon
// purement déterministe, les highlights BRUTS retournés par Luna (cf.
// lib/knowledge-admission.js HIGHLIGHT_INSTRUCTION) contre le texte FINAL
// d'une section — jamais un text.replace(target.label, ...) fragile, jamais
// de correspondance approximative/sémantique. Principe central, explicite
// dans la demande : "0 highlight vaut mieux qu'un mauvais highlight" — toute
// ambiguïté (expression introuvable, trouvée plusieurs fois, id inconnu,
// chevauchement) est résolue en faveur du FAUX NÉGATIF (rien surligné),
// jamais du faux positif.
//
// Deux passes volontairement séparées :
// 1. resolveSectionHighlights(text, rawHighlights) : matching texte -> offsets,
//    ne connaît PAS le curriculum (knowledgeTargetId non vérifié ici).
// 2. filterHighlightsToKnownTargetIds(highlights, validIds) : filtre final
//    par id réellement fourni à Luna pour CE bloc de niveau — appelée par
//    server.js generateProgressiveLevelBlock, seul endroit qui connaît la
//    liste des knowledgeTargets du bloc en cours (jamais d'un autre niveau).
// Cette séparation permet de tester le matching texte indépendamment de
// toute donnée de curriculum, et garantit structurellement qu'un id d'un
// AUTRE bloc/niveau ne peut jamais survivre au filtre 2, même si le
// matching 1 l'a résolu par ailleurs.

// Plafond défensif (jamais un objectif) sur la longueur d'une expression —
// même ordre de grandeur que le plafond déjà appliqué à section.label
// (cf. server.js parseFicheAndKnowledgeCandidates) : une expression plus
// longue que ceci n'est de toute façon plus une "mise en évidence
// sélective" au sens de la demande, quelle que soit sa validité textuelle.
const MAX_HIGHLIGHT_TEXT_CHARS = 80;

// Plafond défensif sur le nombre de candidats examinés par section — protège
// uniquement contre une réponse IA aberrante (des centaines d'entrées),
// jamais un quota pédagogique (cf. HIGHLIGHT_INSTRUCTION : "jamais un
// remplissage pour couvrir toutes les connaissances").
const MAX_HIGHLIGHTS_PER_SECTION = 24;

function normalizeHighlightCandidate(entry) {
  const knowledgeTargetId = typeof entry?.knowledgeTargetId === "string" ? entry.knowledgeTargetId.trim().slice(0, 20) : "";
  const text = typeof entry?.text === "string" ? entry.text.trim() : "";
  if (!knowledgeTargetId || !text || text.length > MAX_HIGHLIGHT_TEXT_CHARS) return null;
  return { knowledgeTargetId, text };
}

// Toutes les positions de départ d'une occurrence LITTÉRALE de `needle` dans
// `haystack` — y compris les occurrences chevauchantes (needle="aa" dans
// "aaa" -> [0,1]) : le but ici n'est pas d'énumérer un découpage, mais de
// détecter toute AMBIGUÏTÉ (>= 2 positions candidates), chevauchantes ou non.
function findAllOccurrences(haystack, needle) {
  const positions = [];
  if (!needle) return positions;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    positions.push(idx);
    from = idx + 1;
  }
  return positions;
}

// Repli insensible à la casse — UNIQUEMENT si toLowerCase() ne change la
// longueur NI de `haystack` NI de `needle` (vrai pour la quasi-totalité du
// français réel ; les rares exceptions Unicode où ce n'est pas le cas font
// que ce repli ne s'applique simplement pas, jamais qu'il produise des
// offsets décalés). Aucune autre normalisation (accents, espaces) : ce
// serait déjà un pas vers une correspondance approximative, explicitement
// exclue par la demande ("aucun fuzzy matching").
function findAllOccurrencesCaseInsensitive(haystack, needle) {
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  if (lowerHay.length !== haystack.length || lowerNeedle.length !== needle.length) return [];
  return findAllOccurrences(lowerHay, lowerNeedle);
}

function rangesOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

// Résout les highlights BRUTS d'UNE section contre le texte FINAL de cette
// section (après troncature éventuelle, cf. server.js
// generateProgressiveLevelBlock — cette fonction n'est appelée qu'APRÈS
// truncateAtSentenceBoundary, jamais avant). Traite les candidats dans
// l'ordre fourni par Luna ; un candidat est accepté seulement si :
// - sa structure est valide (knowledgeTargetId + text non vides, text pas
//   trop long) ;
// - `text` a EXACTEMENT une occurrence dans `text` de la section (recherche
//   littérale d'abord, repli insensible à la casse ensuite SEULEMENT si la
//   recherche littérale échoue) — 0 occurrence (introuvable) ou >= 2
//   occurrences (ambiguë) sont TOUTES DEUX rejetées, jamais résolues par un
//   choix arbitraire (ex. "première occurrence") ;
// - la plage obtenue ne chevauche aucune plage déjà acceptée pour cette
//   section (le premier candidat accepté gagne, les suivants qui empiètent
//   dessus — y compris une inclusion stricte — sont rejetés ; le texte n'est
//   jamais modifié, seule la liste de highlights est filtrée).
// Ne valide PAS knowledgeTargetId contre le curriculum réel — cf.
// filterHighlightsToKnownTargetIds ci-dessous, séparée à dessein.
function resolveSectionHighlights(text, rawHighlights) {
  const haystack = String(text || "");
  const candidates = (Array.isArray(rawHighlights) ? rawHighlights : [])
    .map(normalizeHighlightCandidate)
    .filter(Boolean)
    .slice(0, MAX_HIGHLIGHTS_PER_SECTION);

  const accepted = [];
  for (const candidate of candidates) {
    let positions = findAllOccurrences(haystack, candidate.text);
    if (positions.length === 0) positions = findAllOccurrencesCaseInsensitive(haystack, candidate.text);
    if (positions.length !== 1) continue;
    const start = positions[0];
    const end = start + candidate.text.length;
    const range = { knowledgeTargetId: candidate.knowledgeTargetId, start, end };
    if (accepted.some((existing) => rangesOverlap(existing, range))) continue;
    accepted.push(range);
  }
  return accepted;
}

// Filtre final : ne garde que les highlights dont knowledgeTargetId
// correspond à un knowledgeTarget RÉELLEMENT fourni à Luna pour CE bloc de
// niveau — jamais un id inventé, jamais celui d'un autre bloc/niveau
// (Approfondi/Expert dans une section Élémentaire, notamment). `validIds` :
// Set ou tableau des `k.id` du curriculum passé à generateProgressiveLevelBlock
// pour ce bloc précis (jamais le curriculum entier).
function filterHighlightsToKnownTargetIds(highlights, validIds) {
  const valid = validIds instanceof Set ? validIds : new Set(Array.isArray(validIds) ? validIds : []);
  return (Array.isArray(highlights) ? highlights : []).filter((h) => valid.has(h?.knowledgeTargetId));
}

module.exports = {
  MAX_HIGHLIGHT_TEXT_CHARS,
  MAX_HIGHLIGHTS_PER_SECTION,
  resolveSectionHighlights,
  filterHighlightsToKnownTargetIds
};
