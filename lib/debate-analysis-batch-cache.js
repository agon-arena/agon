"use strict";

// Cache d'étapes pour la génération AUTOMATIQUE (compte à rebours) des
// rapports IA de débat via l'API Batch OpenAI (08/09/2026).
//
// Même principe que lib/notion-quiz-pregeneration-step-cache.js, mais table
// et clé dédiées — jamais partagé avec le pipeline QCM :
// generateAnalysisJson (lib/debate-analysis.js) n'est jamais réécrit ; il est
// REJOUÉ depuis le début à chaque cycle du scheduler d'analyse (server.js,
// setInterval existant) pour un débat en cours de génération automatique.
// Chaque appel IA individuel qu'il fait passe par resolveStep() : si le
// résultat est déjà connu (Batch complété lors d'un cycle précédent), il est
// renvoyé immédiatement et generateAnalysisJson continue tout seul ; sinon la
// requête est enregistrée pour la prochaine soumission Batch et une erreur
// sentinelle est levée pour signaler "ce débat doit attendre" — jamais une
// vraie panne.
//
// Clé = (debate_id, step_key), jamais un compteur d'occurrence positionnel :
// step_key encode l'étape ET l'identité stable de l'idée concernée (ex.
// "p2_98765_a", "p3_98765") — un débat vivant voit ses votes changer entre
// deux cycles, ce qui changerait l'ORDRE de traitement des idées si la clé
// dépendait d'un compteur d'exécution plutôt que de l'argumentId lui-même.
//
// `supabase` est toujours injecté par l'appelant (jamais require()-é ici),
// comme le reste du projet.

const { recordAiUsage, extractUsage } = require("./ai-usage-log");

const CALLS_TABLE = "debate_analysis_batch_calls";

// Levée par resolveStep quand le résultat n'est pas encore disponible
// (requête tout juste enregistrée, ou déjà soumise à un Batch encore en
// cours) — DOIT être interprétée par l'appelant comme "réessayer au prochain
// cycle", jamais comme un échec réel.
class DebateBatchPendingError extends Error {
  constructor(message, { customId, stepKey, reason } = {}) {
    super(message || "Génération Batch en attente d'un résultat.");
    this.name = "DebateBatchPendingError";
    this.customId = customId || null;
    this.stepKey = stepKey || null;
    this.reason = reason || "pending";
  }
}

// Levée quand CET appel précis a définitivement échoué (Batch failed/expired
// pour cette requête). Distincte de DebateBatchPendingError : l'appelant doit
// marquer tout le débat `failed`, jamais continuer à attendre indéfiniment.
class DebateBatchCallFailedError extends Error {
  constructor(message, { customId, stepKey, reason } = {}) {
    super(message || "Appel de génération Batch définitivement échoué.");
    this.name = "DebateBatchCallFailedError";
    this.customId = customId || null;
    this.stepKey = stepKey || null;
    this.reason = reason || "failed";
  }
}

function buildCustomId(debateId, stepKey) {
  return `d:${debateId}:${stepKey}`;
}

// Cœur du mécanisme : appelé à la place de chaque appel réseau réel, à
// l'INTÉRIEUR de generateAnalysisJson rejoué pour un débat en génération
// automatique. `requestPayload` : {model, messages, temperature,
// responseFormat} — jamais reconstruit différemment de ce que le chemin
// synchrone (_callOpenAI) enverrait pour les mêmes messages/options.
async function resolveStep({ supabase, debateId, stepKey, feature, requestPayload }) {
  const customId = buildCustomId(debateId, stepKey);
  const { data: existing, error: selectError } = await supabase
    .from(CALLS_TABLE)
    .select("status, result_content, error_reason")
    .eq("custom_id", customId)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);

  if (existing) {
    if (existing.status === "completed") return { content: existing.result_content };
    if (existing.status === "failed") {
      throw new DebateBatchCallFailedError(existing.error_reason || `Appel ${stepKey} échoué.`, { customId, stepKey, reason: existing.error_reason });
    }
    // "pending" (enregistré mais pas encore inclus dans un Batch soumis) ou
    // "batch_submitted" (Batch en cours) : dans les deux cas, ce débat doit
    // simplement attendre le prochain cycle scheduler.
    throw new DebateBatchPendingError(`Appel ${stepKey} (${customId}) en attente.`, { customId, stepKey, reason: existing.status });
  }

  // Première rencontre de cet appel pour ce débat : l'enregistrer pour la
  // prochaine passe de soumission Batch. `upsert` avec ignoreDuplicates
  // plutôt qu'un simple insert : défensif contre un cycle concurrent.
  const { error: insertError } = await supabase
    .from(CALLS_TABLE)
    .upsert(
      { debate_id: debateId, step_key: stepKey, feature, custom_id: customId, status: "pending", request_payload: requestPayload },
      { onConflict: "debate_id,step_key", ignoreDuplicates: true }
    );
  if (insertError) throw new Error(insertError.message);
  throw new DebateBatchPendingError(`Appel ${stepKey} (${customId}) nouvellement enregistré, en attente de soumission Batch.`, { customId, stepKey, reason: "pending" });
}

// Supprime toutes les lignes d'un débat — appelé UNE SEULE FOIS, au moment où
// le scheduler bascule scheduled → batch_pending (démarrage d'un NOUVEAU
// cycle de génération automatique), jamais à chaque tentative de rejeu.
// Empêche qu'un cycle automatique ultérieur (nouveau seuil de score atteint,
// après qu'un rapport a déjà été généré manuellement ou via un Batch
// précédent) ne réutilise à tort le résultat figé d'une tentative abandonnée.
async function clearCallsForDebate({ supabase, debateId }) {
  const { error } = await supabase.from(CALLS_TABLE).delete().eq("debate_id", debateId);
  if (error) throw new Error(error.message);
}

// Sélectionne les appels encore jamais soumis (status='pending', sans
// batch_id) tous débats confondus, pour la passe de soumission du scheduler —
// plafonné à `limit` pour ne jamais construire un Batch arbitrairement gros.
async function selectPendingCalls({ supabase, limit }) {
  const { data, error } = await supabase
    .from(CALLS_TABLE)
    .select("id, debate_id, step_key, custom_id, request_payload")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

async function markCallsBatchSubmitted({ supabase, callIds, batchId }) {
  if (!callIds.length) return;
  const { error } = await supabase
    .from(CALLS_TABLE)
    .update({ status: "batch_submitted", batch_id: batchId, updated_at: new Date().toISOString() })
    .in("id", callIds);
  if (error) throw new Error(error.message);
}

// Sélectionne les batch_id distincts encore actifs (au moins un appel
// `batch_submitted`) — un par lot soumis — pour la passe de poll du scheduler.
async function selectActiveBatchIds({ supabase }) {
  const { data, error } = await supabase
    .from(CALLS_TABLE)
    .select("batch_id")
    .eq("status", "batch_submitted")
    .not("batch_id", "is", null);
  if (error) throw new Error(error.message);
  return [...new Set((data || []).map((row) => row.batch_id))];
}

// Applique les résultats d'un Batch complété : chaque ligne de
// `resultsByCustomId` (cf. lib/openai-batch-client.parseBatchOutputJsonl) met
// à jour EXACTEMENT l'appel qui porte ce custom_id.
async function applyBatchResults({ supabase, batchId, resultsByCustomId }) {
  const { data: rows, error } = await supabase
    .from(CALLS_TABLE)
    .select("id, debate_id, step_key, feature, custom_id, request_payload")
    .eq("batch_id", batchId)
    .eq("status", "batch_submitted");
  if (error) throw new Error(error.message);
  for (const row of rows || []) {
    const result = resultsByCustomId.get(row.custom_id);
    if (!result) continue; // ligne manquante dans l'output : laissée batch_submitted, retentée au cycle suivant.

    // Instrumentation coût (même table, même fonction que le chemin
    // synchrone) : is_batch:true applique automatiquement la remise Batch
    // officielle (-50%). generationId = debate_id : permet d'agréger le coût
    // par débat exactement comme le chemin synchrone.
    if (result.ok) {
      const { inputTokens, outputTokens, cachedTokens } = extractUsage(result.usage);
      recordAiUsage(supabase, {
        feature: row.feature, model: row.request_payload?.model,
        inputTokens, outputTokens, cachedTokens,
        generationId: row.debate_id != null ? String(row.debate_id) : null,
        isBatch: true, batchId, success: true
      });
    } else {
      recordAiUsage(supabase, {
        feature: row.feature, model: row.request_payload?.model,
        generationId: row.debate_id != null ? String(row.debate_id) : null,
        isBatch: true, batchId, success: false, error: result.error
      });
    }

    if (result.ok) {
      await supabase.from(CALLS_TABLE).update({ status: "completed", result_content: result.content, updated_at: new Date().toISOString() }).eq("id", row.id);
    } else {
      await supabase.from(CALLS_TABLE).update({ status: "failed", error_reason: result.error, updated_at: new Date().toISOString() }).eq("id", row.id);
    }
  }
}

// Marque TOUS les appels d'un batch_id comme échoués (Batch entier
// failed/expired/cancelled) — jamais de retry automatique côté appel
// individuel ici : le débat concerné passe `failed` au prochain rejeu (cf.
// server.js, section "comportement en cas d'échec").
async function markBatchFailed({ supabase, batchId, reason }) {
  const { error } = await supabase
    .from(CALLS_TABLE)
    .update({ status: "failed", error_reason: reason, updated_at: new Date().toISOString() })
    .eq("batch_id", batchId)
    .eq("status", "batch_submitted");
  if (error) throw new Error(error.message);
}

module.exports = {
  CALLS_TABLE,
  DebateBatchPendingError,
  DebateBatchCallFailedError,
  buildCustomId,
  resolveStep,
  clearCallsForDebate,
  selectPendingCalls,
  markCallsBatchSubmitted,
  selectActiveBatchIds,
  applyBatchResults,
  markBatchFailed
};
