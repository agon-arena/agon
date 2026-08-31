"use strict";

// V3.2 (demande du 31/08/2026 — "fallback d'enrichissement des sources
// lorsque le grounding est insuffisant"). Distinct de TOUT ce qui existe déjà
// (lib/source-scoring.js note un CANDIDAT, lib/question-grounding-validation.js
// juge UNE question) : ce module décide seulement SI et COMMENT chercher
// quelques sources supplémentaires quand le corpus initial s'avère trop
// pauvre pour produire assez de questions fiables — jamais en affaiblissant
// le validateur V3.1 (resté strictement inchangé), toujours en cherchant
// davantage de preuves.
//
// Principe central (jamais violé, section 1 de la demande) :
//   pas assez de questions acceptées
//     → jamais résolu en assouplissant la validation
//     → résolu en élargissant le corpus, puis en repassant EXACTEMENT les
//       mêmes contrôles (V1/V2/V3/V3.1, tous inchangés).
//
// Fichier volontairement PUR (aucun réseau, aucun appel IA) : reçoit les
// métriques déjà produites par lib/qcm-quality.js (runQuestionQualityPipeline)
// après que la régénération ciblée existante a déjà tourné, et décide.
// L'orchestration réelle (nouvel appel Brave, extraction, régénération des
// questions manquantes) reste dans server.js — même séparation que
// lib/web-search-grounding.js / resolveWebSearchGrounding.

const { extractGroundingReasonCounts } = require("./qcm-grounding-metrics");

// ── Classement des motifs GROUNDING_* (section 5 de la demande) ────────────
// Documentaire : le rejet dit "le corpus ne contient pas (ou pas assez
// précisément) la preuve citée" — davantage de sources peut réellement aider.
const DOCUMENTARY_GROUNDING_REASON_CODES = new Set([
  "GROUNDING_CLAIM_NOT_GROUNDED_IN_SOURCE",
  "GROUNDING_ANSWER_NOT_IN_CLAIM",
  "GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED",
  // Un chiffre trop précis pour être attesté PAR LA SOURCE CITÉE reste un
  // problème de corpus (une autre source, plus précise, peut exister) —
  // jamais un problème de format/protocole.
  "GROUNDING_EXCESSIVE_PRECISION"
]);

// Format/protocole : le modèle a mal cité ses sources (identifiant inventé,
// citation manquante, trop de sources citées "par précaution") — ajouter des
// sources ne corrige structurellement rien ici, seule la régénération ciblée
// déjà existante (consigne de prompt dédiée, cf. server.js
// qualityControlRawQuestions) peut y remédier.
const NON_DOCUMENTARY_GROUNDING_REASON_CODES = new Set([
  "GROUNDING_MISSING_SUPPORTING_CLAIM",
  "GROUNDING_UNKNOWN_SOURCE",
  "GROUNDING_TOO_MANY_SOURCES"
]);

// Sous cette couverture (finalAccepted / questionsRequested), une génération
// est jugée "significativement en manque" — au-dessus, le manque est jugé
// marginal et ne justifie pas une recherche Brave supplémentaire (section 3 :
// "l'enrichissement doit être exceptionnel"). Calibré sur les exemples
// conceptuels de la demande (section 4/22) : 20/18=90% et 5/4=80% ne doivent
// PAS déclencher, 20/12=60% et 5/1=20% DOIVENT déclencher — 0.75 sépare
// proprement les deux groupes (aucune donnée réelle à ce jour ne permet un
// calibrage plus fin ; à revoir avec de vraies mesures de production, cf.
// section 20 de la demande, "mesurer le bénéfice réel").
const EXPANSION_COVERAGE_THRESHOLD = 0.75;

// "corpus initial + 2 ou 3 nouvelles bonnes sources" (section 9) : qualité >
// quantité, jamais un rattrapage massif. 2 : assez pour croiser au moins deux
// candidats qualifiés côté scoring, sans faire gonfler le prompt de
// génération ni le budget Brave/IA au-delà d'un vrai fallback exceptionnel.
const MAX_NEW_SOURCES_PER_EXPANSION = 2;

// ── Décision (section 4/5/22) — fonction pure et testable. `metrics` : le
// même objet retourné par runQuestionQualityPipeline (cf. lib/qcm-quality.js),
// déjà après ses propres cycles de régénération ciblée (jamais avant : le
// fallback documentaire est un dernier recours, section 6 de la demande).
function shouldExpandGroundingSources(metrics, context = {}) {
  if (!metrics || metrics.groundingEnabled !== true) {
    return { expand: false, reason: "grounding_disabled" };
  }
  const requested = Number.isFinite(context.questionsRequested) ? context.questionsRequested : metrics.generated;
  if (!Number.isFinite(requested) || requested <= 0) {
    return { expand: false, reason: "no_target" };
  }
  const finalAccepted = Number.isFinite(metrics.finalAccepted) ? metrics.finalAccepted : 0;
  const missing = Math.max(0, requested - finalAccepted);
  if (missing <= 0) {
    return { expand: false, reason: "coverage_sufficient" };
  }
  const coverage = finalAccepted / requested;
  if (coverage >= EXPANSION_COVERAGE_THRESHOLD) {
    return {
      expand: false,
      reason: "coverage_sufficient",
      detail: `couverture ${Math.round(coverage * 100)}% ≥ seuil ${Math.round(EXPANSION_COVERAGE_THRESHOLD * 100)}%`
    };
  }

  // Motifs encore présents APRÈS la régénération ciblée existante
  // (unresolvedReasonCounts, jamais reasonCounts qui cumule tous les
  // cycles) : c'est la seule mesure de "ce qui bloque encore vraiment".
  const groundingReasons = extractGroundingReasonCounts(metrics.unresolvedReasonCounts);
  let documentaryCount = 0;
  let nonDocumentaryCount = 0;
  for (const [code, count] of Object.entries(groundingReasons)) {
    if (DOCUMENTARY_GROUNDING_REASON_CODES.has(code)) documentaryCount += count;
    else if (NON_DOCUMENTARY_GROUNDING_REASON_CODES.has(code)) nonDocumentaryCount += count;
  }

  if (documentaryCount === 0) {
    return {
      expand: false,
      reason: "no_documentary_signal",
      detail: "les rejets restants ne portent aucun motif documentaire (corpus) — ajouter des sources ne résoudrait rien."
    };
  }
  if (documentaryCount < nonDocumentaryCount) {
    return {
      expand: false,
      reason: "non_documentary_dominant",
      detail: `motifs restants majoritairement de format/protocole (${nonDocumentaryCount} contre ${documentaryCount} documentaire(s)).`
    };
  }

  return {
    expand: true,
    reason: "insufficient_documentary_coverage",
    missing,
    coverage,
    documentaryCount,
    nonDocumentaryCount
  };
}

// ── Requête Brave complémentaire (section 7/8/17) — jamais identique à la
// requête initiale (`subject` seul), jamais un second moteur de scoring : le
// classement/seuil restent entièrement ceux de lib/source-scoring.js,
// appliqués tels quels par l'appelant (server.js) sur les résultats de CETTE
// requête. Générique par construction (aucun sujet/domaine en dur) : ne se
// base que sur (a) le sujet lui-même, (b) les codes de rejet documentaires
// réellement observés, (c) freshnessLikely déjà calculé par
// lib/source-scoring.js buildTopicContext pour CE sujet.
function buildSourceExpansionQuery(subject, options = {}) {
  const base = String(subject || "").trim();
  const codes = new Set(options.documentaryReasonCodes || []);
  const now = options.now instanceof Date && !Number.isNaN(options.now.getTime()) ? options.now : new Date();

  const qualifiers = [];
  if (codes.has("GROUNDING_NUMERIC_CLAIM_NOT_SUPPORTED") || codes.has("GROUNDING_EXCESSIVE_PRECISION")) {
    qualifiers.push("chiffres officiels");
  }
  if (codes.has("GROUNDING_CLAIM_NOT_GROUNDED_IN_SOURCE") || codes.has("GROUNDING_ANSWER_NOT_IN_CLAIM")) {
    qualifiers.push("source de référence");
  }
  // Sujets sensibles à la date (section 17) : jamais une année en dur, la
  // date courante uniquement — un test qui fige `now` reste déterministe.
  if (options.freshnessLikely) qualifiers.push(String(now.getFullYear()));
  if (!qualifiers.length) qualifiers.push("source de référence");

  // Toujours au moins un qualificatif réellement ajouté (jamais `subject`
  // seul reproduit tel quel) — section 7 : "ne refais pas simplement
  // exactement la même requête Brave".
  return `${base} ${[...new Set(qualifiers)].join(" ")}`.trim();
}

module.exports = {
  DOCUMENTARY_GROUNDING_REASON_CODES,
  NON_DOCUMENTARY_GROUNDING_REASON_CODES,
  EXPANSION_COVERAGE_THRESHOLD,
  MAX_NEW_SOURCES_PER_EXPANSION,
  shouldExpandGroundingSources,
  buildSourceExpansionQuery
};
