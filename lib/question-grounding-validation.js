"use strict";

// Traçabilité factuelle des QCM aux sources (V3, demande du 31/08/2026) —
// distinct du scoring des SOURCES (lib/source-scoring.js, qui juge un
// résultat de recherche AVANT récupération) et de la détection anti-bot
// (lib/source-extraction-validation.js, qui juge le contenu extrait D'UNE
// page) : ce module juge si une QUESTION GÉNÉRÉE est réellement soutenue par
// les sources qui ont servi à la fonder — même d'excellentes sources
// n'empêchent pas le modèle de générer une affirmation non soutenue
// (chiffre, date, nom inventé ou déformé) en complétant silencieusement
// avec sa mémoire interne.
//
// Fichier volontairement PUR (aucun réseau, aucun appel IA) : reçoit une
// question déjà générée (avec ses champs `supporting_claim`/`source_ids`,
// cf. server.js buildQuestionFormatsPromptBlock) et la carte des sources
// réellement fournies au modèle (cf. lib/web-search-grounding.js
// buildIdentifiedSources), jamais l'appel réseau/IA lui-même.
//
// Principe central (jamais violé) : la citation IA (`source_ids`) est une
// PROPOSITION de provenance, jamais une preuve en soi — chaque identifiant
// est vérifié contre les sources réellement fournies, et le contenu de la
// source citée est relu pour confirmer que le fait précis (notamment les
// nombres/dates) y figure réellement, à proximité du contexte attendu —
// jamais une simple co-occurrence lexicale n'importe où sur la page (piège
// explicite de la demande : "1914" et "Verdun" présents séparément sur une
// page ne prouvent jamais "Verdun commence en 1914").

const { tokenize, overlapFraction } = require("./source-scoring");

// Dupliquée depuis lib/qcm-quality.js (jamais importée depuis là) : ce
// module est lui-même consommé PAR lib/qcm-quality.js
// (runQuestionQualityPipeline, cf. son commentaire) — un require() croisé
// créerait une dépendance circulaire. Fonction pure, stable, sans
// dépendance : dupliquer ces quelques lignes est plus sûr qu'un require()
// différé pour contourner le cycle.
function normalizeComparisonText(value) {
  return String(value == null ? "" : value)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[  ]/g, " ")
    .replace(/[’‘‛`´]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .trim()
    .toLowerCase()
    .replace(/^[\s"'.,;:!?()[\]{}—–-]+|[\s"'.,;:!?()[\]{}—–-]+$/g, "")
    .replace(/\s+/g, " ");
}

// Au-delà de ce nombre, une liste de source_ids ressemble à "toutes les
// sources disponibles par précaution" plutôt qu'à une vraie justification
// (section 11 de la demande) — jamais un jugement sur LAQUELLE serait de
// trop, juste un plafond structurel.
const MAX_SOURCES_PER_QUESTION = 3;

// En dessous de cette longueur, une "affirmation" ne peut structurellement
// pas être une vraie citation factuelle (ex. "Oui.", "Voir la source.").
const MIN_SUPPORTING_CLAIM_CHARS = 15;

// Recouvrement lexical minimal exigé entre l'affirmation citée et le texte
// du texte COMBINÉ de toutes les sources citées — un fait multi-sources
// (section 11) peut légitimement être réparti : une source donne le contexte,
// une autre le chiffre précis, sans qu'aucune des deux, seule, ne recoupe
// fortement l'affirmation complète. Volontairement modeste : la vérification
// stricte des faits structurés (nombres/dates) porte le contrôle le plus dur,
// ceci n'est qu'un premier filtre grossier sur l'ensemble des sources citées.
const MIN_CLAIM_SOURCE_OVERLAP = 0.35;
// Recouvrement minimal exigé de CHAQUE source individuellement — beaucoup
// plus bas que le seuil combiné : sert seulement à écarter une source citée
// "par précaution" sans participer réellement à l'affirmation (section 6),
// jamais à exiger qu'une seule source suffise à tout justifier seule.
const MIN_CLAIM_SOURCE_INDIVIDUAL_CONTRIBUTION = 0.12;

// Recouvrement lexical minimal entre le texte de la réponse et l'affirmation
// citée — volontairement TOLÉRANT (section 20 : "une paraphrase parfaitement
// correcte ne doit pas être rejetée simplement parce qu'elle n'utilise pas
// exactement les mêmes mots"). La vérification stricte reste réservée aux
// faits structurés (extractStructuredFacts), jamais à la formulation libre.
const MIN_ANSWER_CLAIM_OVERLAP = 0.34;

// Fenêtre de proximité textuelle (section 9 : "même phrase, même paragraphe,
// fenêtre raisonnable") — ni un simple "présent quelque part sur la page",
// ni une exigence de contiguïté immédiate.
const PROXIMITY_WINDOW_CHARS = 220;

// ── Extraction de faits structurés (nombres/dates) — générique, jamais
// spécifique à un sujet. Les décimaux sont capturés EN PREMIER pour ne
// jamais compter "66" séparément à l'intérieur de "66,04".
const DECIMAL_PATTERN = /\d{1,3}(?:[ \u00a0]\d{3})+[.,]\d+|\d+[.,]\d+/g;
const INTEGER_PATTERN = /\d{1,3}(?:[ \u00a0]\d{3})+|\d+/g;

function parseNumericToken(raw) {
  const cleaned = String(raw).replace(/[ \u00a0]/g, "");
  const decimalMatch = cleaned.match(/^(\d+)[.,](\d+)$/);
  if (decimalMatch) {
    return { value: parseFloat(`${decimalMatch[1]}.${decimalMatch[2]}`), decimals: decimalMatch[2].length };
  }
  return { value: parseFloat(cleaned), decimals: 0 };
}

function extractStructuredFacts(text) {
  const str = String(text || "");
  const facts = [];
  const consumed = [];
  for (const m of str.matchAll(DECIMAL_PATTERN)) {
    const { value, decimals } = parseNumericToken(m[0]);
    if (!Number.isFinite(value)) continue;
    facts.push({ raw: m[0], value, decimals, index: m.index });
    consumed.push([m.index, m.index + m[0].length]);
  }
  for (const m of str.matchAll(INTEGER_PATTERN)) {
    if (consumed.some(([start, end]) => m.index >= start && m.index < end)) continue;
    const { value, decimals } = parseNumericToken(m[0]);
    if (!Number.isFinite(value)) continue;
    facts.push({ raw: m[0], value, decimals, index: m.index });
  }
  return facts.sort((a, b) => a.index - b.index);
}

// Cherche `factValue` dans `sourceText` avec, dans une fenêtre autour de
// chaque occurrence, au moins un des `contextTokens` (mots significatifs de
// l'affirmation citée, hors chiffres) — le garde-fou anti-faux-positif
// lexical (section 9).
function findNumberWithContext(sourceText, factValue, contextTokens, windowChars = PROXIMITY_WINDOW_CHARS) {
  const str = String(sourceText || "");
  const occurrences = extractStructuredFacts(str).filter((f) => f.value === factValue);
  for (const occ of occurrences) {
    const windowStart = Math.max(0, occ.index - windowChars);
    const windowEnd = Math.min(str.length, occ.index + occ.raw.length + windowChars);
    const windowTokens = new Set(tokenize(str.slice(windowStart, windowEnd)));
    if (!contextTokens.length || contextTokens.some((t) => windowTokens.has(t))) {
      return { found: true, occurrence: occ };
    }
  }
  return { found: false };
}

// Cherche, dans `sourceText`, le nombre dont la PARTIE ENTIÈRE correspond à
// `factValue` mais dont la précision (décimales) diffère — signal dédié à
// "affirmation trop précise" (section 10 : la source dit "environ 66
// millions d'années", la question exige "66,04").
function findClosestIntegerPartMatch(sourceText, factValue) {
  const targetInt = Math.trunc(factValue);
  let best = null;
  for (const f of extractStructuredFacts(sourceText)) {
    if (Math.trunc(f.value) !== targetInt) continue;
    if (!best || f.decimals > best.decimals) best = f;
  }
  return best;
}

// Textes de réponse d'UNE variante/question à plat (un seul niveau, jamais
// récursif) — factorisé entre resolveAnswerTexts (variante unique, ancien
// format) et son propre appel par variante (format "variants[]", cf.
// juste en dessous).
function resolveAnswerTextsForFlatQuestion(flat) {
  const type = flat?.type;
  const options = Array.isArray(flat?.options) ? flat.options : [];
  if (type === "qcm_multi") {
    const indexes = Array.isArray(flat?.correctIndexes) ? flat.correctIndexes : [];
    return indexes.map((i) => options[i]).filter((v) => typeof v === "string" && v);
  }
  if (type === "association") {
    const pairs = Array.isArray(flat?.pairs) ? flat.pairs : [];
    return pairs.map((p) => `${p?.left || ""} ${p?.right || ""}`.trim()).filter(Boolean);
  }
  if (type === "ordre") {
    const items = Array.isArray(flat?.items) ? flat.items : [];
    return items.filter((v) => typeof v === "string" && v);
  }
  // qcm / texte_a_trous / intrus : une seule bonne réponse.
  const correctIndex = Number(flat?.correctIndex);
  const answer = Number.isInteger(correctIndex) ? options[correctIndex] : null;
  return typeof answer === "string" && answer ? [answer] : [];
}

// ── Textes de réponse à vérifier, par type de question (section 13 : ne
// jamais limiter l'architecture au seul champ correctIndex/options). Gère
// les DEUX formes produites par generateNotionLevelQuiz (cf.
// lib/question-formats.js validateQuestionItemCore, même distinction) :
// - `variants` (forme réelle en production, includeVariants:true toujours
//   actif pour ce pipeline) : supporting_claim/source_ids sont partagés par
//   TOUTES les variantes d'un même knowledgeTarget — chacune teste donc le
//   MÊME fait sous un angle différent et doit être vérifiée individuellement
//   (une variante non traçable ne doit jamais passer parce qu'une autre
//   variante de la même question, elle, l'est) ;
// - forme à plat (compatibilité, autres appelants éventuels) : un seul jeu
//   de réponses au niveau racine, comme avant.
// Bug réel corrigé le 31/08/2026 (trouvaille du test d'intégration bout-en-
// bout) : cette fonction ne regardait auparavant QUE la forme à plat — sur
// une vraie question de generateNotionLevelQuiz (toujours `variants[]`),
// aucune réponse n'était jamais extraite, et une affirmation non soutenue
// passait alors silencieusement (aucun texte de réponse à contrôler).
function resolveAnswerTexts(question) {
  if (Array.isArray(question?.variants) && question.variants.length) {
    return question.variants.flatMap((variant) => resolveAnswerTextsForFlatQuestion(variant));
  }
  return resolveAnswerTextsForFlatQuestion(question);
}

function resolveSource(sourcesById, id) {
  if (!sourcesById) return null;
  if (sourcesById instanceof Map) return sourcesById.get(id) || null;
  return sourcesById[id] || null;
}

// ── Fonction centrale (section 7-11 de la demande) — déterministe et
// testable. `sourcesById` : Map ou objet SOURCE_N -> {text, title?, url?}.
// Ne juge QUE ce qui est vérifiable mécaniquement : jamais un jugement sur
// la qualité pédagogique de la question (déjà couvert par
// lib/qcm-quality.js), uniquement sa traçabilité aux sources fournies.
function validateQuestionGrounding(question, sourcesById) {
  const claim = String(question?.supporting_claim || "").trim();
  if (!claim || claim.length < MIN_SUPPORTING_CLAIM_CHARS) {
    return { ok: false, reason: "missing_supporting_claim", detail: "supporting_claim absent, vide ou trop générique." };
  }

  const sourceIds = Array.isArray(question?.source_ids) ? question.source_ids.filter((id) => typeof id === "string" && id) : [];
  if (!sourceIds.length) {
    return { ok: false, reason: "missing_supporting_claim", detail: "aucun source_ids fourni." };
  }
  if (sourceIds.length > MAX_SOURCES_PER_QUESTION) {
    return { ok: false, reason: "too_many_sources", detail: `${sourceIds.length} source_ids cités, maximum ${MAX_SOURCES_PER_QUESTION}.` };
  }

  const resolvedSources = [];
  for (const id of sourceIds) {
    const source = resolveSource(sourcesById, id);
    if (!source) return { ok: false, reason: "unknown_source", detail: `source_id "${id}" ne correspond à aucune source réellement fournie.` };
    resolvedSources.push({ id, ...source });
  }

  const claimTokens = tokenize(claim);
  const combinedSourceText = resolvedSources.map((s) => s.text || "").join(" \n ");
  const combinedOverlap = overlapFraction(claimTokens, combinedSourceText);
  if (combinedOverlap < MIN_CLAIM_SOURCE_OVERLAP) {
    return { ok: false, reason: "claim_not_grounded_in_source", detail: `les sources citées ne recoupent pas suffisamment l'affirmation citée, même combinées (recouvrement ${Math.round(combinedOverlap * 100)}%).` };
  }
  for (const source of resolvedSources) {
    const individual = overlapFraction(claimTokens, source.text || "");
    if (individual < MIN_CLAIM_SOURCE_INDIVIDUAL_CONTRIBUTION) {
      return { ok: false, reason: "claim_not_grounded_in_source", detail: `${source.id} ne participe pas réellement à l'affirmation citée (recouvrement ${Math.round(individual * 100)}%) — cité sans réelle justification.` };
    }
  }

  const contextTokens = claimTokens.filter((t) => !/^\d/.test(t));
  const answerTexts = resolveAnswerTexts(question);
  for (const answerText of answerTexts) {
    const answerTokens = tokenize(answerText);
    const nonNumericTokens = answerTokens.filter((t) => !/^\d/.test(t));
    if (nonNumericTokens.length) {
      const contained = normalizeComparisonText(claim).includes(normalizeComparisonText(answerText));
      const compat = overlapFraction(nonNumericTokens, claim);
      if (!contained && compat < MIN_ANSWER_CLAIM_OVERLAP) {
        return { ok: false, reason: "answer_not_in_claim", detail: `"${answerText}" n'apparaît pas dans l'affirmation citée.` };
      }
    }

    for (const fact of extractStructuredFacts(answerText)) {
      const claimFact = extractStructuredFacts(claim).find((f) => f.value === fact.value);
      if (!claimFact) {
        return { ok: false, reason: "numeric_claim_not_supported", detail: `"${fact.raw}" absent de l'affirmation citée.` };
      }
      let foundInSource = false;
      let bestPrecisionMatch = null;
      for (const source of resolvedSources) {
        const proximity = findNumberWithContext(source.text || "", fact.value, contextTokens);
        if (proximity.found) { foundInSource = true; break; }
        const candidate = findClosestIntegerPartMatch(source.text || "", fact.value);
        if (candidate && (!bestPrecisionMatch || candidate.decimals > bestPrecisionMatch.decimals)) bestPrecisionMatch = candidate;
      }
      if (!foundInSource) {
        if (bestPrecisionMatch && bestPrecisionMatch.decimals < fact.decimals) {
          return { ok: false, reason: "excessive_precision", detail: `précision "${fact.raw}" non attestée par la source (trouvé "${bestPrecisionMatch.raw}").` };
        }
        return { ok: false, reason: "numeric_claim_not_supported", detail: `"${fact.raw}" introuvable dans la source citée à proximité du contexte attendu.` };
      }
    }
  }

  return { ok: true, evidence: claim.slice(0, 240) };
}

module.exports = {
  MAX_SOURCES_PER_QUESTION,
  MIN_SUPPORTING_CLAIM_CHARS,
  extractStructuredFacts,
  findNumberWithContext,
  findClosestIntegerPartMatch,
  resolveAnswerTexts,
  validateQuestionGrounding
};
