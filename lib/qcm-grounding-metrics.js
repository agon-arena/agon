"use strict";

// Observabilité du grounding QCM (V3.1, demande du 31/08/2026 —
// "validation bout-en-bout et observabilité du grounding QCM"). Distinct de
// lib/ai-usage-log.js (qui mesure chaque APPEL IA individuel : tokens,
// coût, latence) : ce module mesure, une fois par GÉNÉRATION DE QCM
// complète, l'efficacité du contrôle de traçabilité aux sources
// (lib/question-grounding-validation.js) — combien de questions ont été
// acceptées/rejetées pour ce motif, combien de régénérations cela a
// déclenchées, avec quels motifs. Même philosophie défensive que
// recordAiUsage : jamais bloquant, jamais awaité par ses appelants de
// production, avale systématiquement ses propres erreurs — une panne de
// télémétrie ne doit jamais devenir une panne de Mnoria.
//
// IMPORTANT (section 16 de la demande) : "accepted" signifie ici "le
// validateur V3 n'a détecté aucun problème de traçabilité", jamais "ce fait
// est scientifiquement garanti vrai" — d'où des noms de champs
// systématiquement préfixés "grounding_", jamais "verified"/"true" seuls.
//
// Voir data/migration-qcm-grounding-metrics.sql pour le schéma Supabase.

// Filtre les codes GROUNDING_* d'un dictionnaire reasonCounts/unresolvedReasonCounts
// (cf. lib/qcm-quality.js aggregateReasonCodes) — jamais un nouveau calcul,
// seulement une projection de ce qui existe déjà.
function extractGroundingReasonCounts(reasonCounts) {
  const out = {};
  for (const [code, count] of Object.entries(reasonCounts || {})) {
    if (code.startsWith("GROUNDING_")) out[code] = count;
  }
  return out;
}

// Construit la ligne compacte à stocker (section 6 de la demande : jamais de
// prompt complet, jamais de page Brave entière, jamais de fenêtre de preuve
// intégrale) à partir de `metrics` (cf. lib/qcm-quality.js
// runQuestionQualityPipeline) et d'un contexte de génération léger —
// uniquement des métadonnées déjà disponibles ailleurs dans le pipeline
// (jamais une nouvelle classification IA, section 9 de la demande).
// Fonction PURE, testable sans réseau ni base de données.
//
// `context.expansion` (optionnel, V3.2 du 31/08/2026 — "fallback
// d'enrichissement des sources") : résumé du fallback documentaire construit
// par server.js (expandGroundingAndRegenerateMissingQuestions), lui-même issu
// de lib/grounding-source-expansion.js (shouldExpandGroundingSources) — un
// objet déjà entièrement calculé, jamais recalculé ici. Absent (comportement
// de tous les appelants avant le 31/08/2026, et de toute génération où le
// fallback ne s'applique pas), les colonnes source_expansion_* restent à
// leurs valeurs neutres (false/0/null) — additif au caractère près, cf.
// data/migration-qcm-grounding-source-expansion.sql.
function buildGroundingMetricsSummary(metrics, context = {}) {
  if (!metrics) return null;
  const expansion = context.expansion || {};
  return {
    generation_id: context.generationId || null,
    route: context.route || null,
    level: context.level || null,
    source_type: context.sourceType || null,
    grounding_enabled: metrics.groundingEnabled === true,
    questions_requested: Number.isFinite(context.questionsRequested) ? context.questionsRequested : null,
    questions_generated: Number.isFinite(metrics.generated) ? metrics.generated : null,
    grounding_candidates_first_pass: metrics.groundingCandidatesFirstPass || 0,
    grounding_accepted_first_pass: metrics.groundingAcceptedFirstPass || 0,
    grounding_rejected_first_pass: metrics.groundingRejectedFirstPass || 0,
    grounding_regenerated: metrics.groundingRegenerationTriggerCount || 0,
    grounding_accepted_after_regeneration: metrics.groundingAcceptedAfterRegeneration || 0,
    grounding_failed_final: metrics.groundingFailedFinal || 0,
    final_accepted: Number.isFinite(metrics.finalAccepted) ? metrics.finalAccepted : null,
    reasons: extractGroundingReasonCounts(metrics.reasonCounts),
    source_expansion_triggered: expansion.triggered === true,
    source_expansion_reason: expansion.reason || null,
    source_count_initial: Number.isFinite(expansion.sourceCountInitial) ? expansion.sourceCountInitial : null,
    source_count_added: Number.isFinite(expansion.sourceCountAdded) ? expansion.sourceCountAdded : 0,
    source_count_final: Number.isFinite(expansion.sourceCountFinal) ? expansion.sourceCountFinal : null,
    source_expansion_brave_calls: Number.isFinite(expansion.braveCalls) ? expansion.braveCalls : 0,
    questions_before_expansion: Number.isFinite(expansion.questionsBeforeExpansion) ? expansion.questionsBeforeExpansion : null,
    questions_generated_after_expansion: Number.isFinite(expansion.questionsGeneratedAfterExpansion) ? expansion.questionsGeneratedAfterExpansion : null,
    questions_accepted_after_expansion: Number.isFinite(expansion.questionsAcceptedAfterExpansion) ? expansion.questionsAcceptedAfterExpansion : null
  };
}

// Fire-and-forget, jamais awaité en production (même règle que
// recordAiUsage) : awaiter reste possible et utile en test.
// `generation_id` (cf. buildGroundingMetricsSummary) : un identifiant
// technique de génération DÉJÀ existant dans le pipeline (le même `id` que
// [web-search-grounding:id]/[qcm-quality] dans les logs), jamais un
// identifiant utilisateur, jamais un contenu personnel (section 12 de la
// demande).
async function recordQcmGroundingMetrics(supabase, summary) {
  try {
    if (!supabase || !summary) return;
    const { error } = await supabase.from("qcm_grounding_metrics").insert(summary);
    if (error) console.warn("[qcm-grounding-metrics] échec insertion (ignoré) :", error.message);
  } catch (err) {
    console.warn("[qcm-grounding-metrics] échec enregistrement (ignoré) :", err.message);
  }
}

module.exports = {
  extractGroundingReasonCounts,
  buildGroundingMetricsSummary,
  recordQcmGroundingMetrics
};
