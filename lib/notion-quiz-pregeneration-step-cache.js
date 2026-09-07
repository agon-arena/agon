"use strict";

// Cache d'étapes pour la pré-génération en avance via Batch OpenAI (07/09/2026).
//
// Principe : le pipeline progressif existant (server.js,
// ensureProgressiveElementaryGenerated/continueProgressiveGeneration et tout
// ce qu'ils appellent) n'est JAMAIS réécrit — il est simplement REJOUÉ depuis
// le début à chaque cycle scheduler pour un sujet en cours de pré-génération.
// Chaque appel IA individuel qu'il a besoin de faire (curriculum, réparation,
// fiche, questions, régénération ciblée...) passe par ce cache : si le
// résultat est déjà connu (Batch complété lors d'un cycle précédent), il est
// renvoyé immédiatement et le pipeline continue tout seul, sans aucun appel
// réseau ; sinon la requête est enregistrée pour la prochaine soumission
// Batch et une erreur sentinelle est levée pour signaler "ce sujet doit
// attendre" — jamais une vraie panne.
//
// Ce fichier ne connaît rien du pipeline progressif lui-même (aucun import
// de server.js) : il ne fait que lire/écrire notion_quiz_pregeneration_calls.
// `supabase` est toujours injecté par l'appelant (jamais require()-é ici),
// comme le reste du projet (cf. lib/learn-next/engine.js).

const CALLS_TABLE = "notion_quiz_pregeneration_calls";

// Levée par resolveStep quand le résultat n'est pas encore disponible
// (requête tout juste enregistrée, ou déjà soumise à un Batch encore en
// cours) — DOIT être re-levée immédiatement par tout catch() existant du
// pipeline synchrone qu'elle traverse (cf. server.js, les 5 points de garde
// identifiés : resolveWebSearchGrounding, evidenceGateAndRepairCurriculumSubset,
// resolveProgressiveCurriculum, generateProgressiveLevelBlock x2) — sans quoi
// elle serait à tort interprétée comme un échec IA réel.
class PregenerationPendingError extends Error {
  constructor(message, { customId, reason } = {}) {
    super(message || "Pré-génération en attente d'un résultat Batch.");
    this.name = "PregenerationPendingError";
    this.customId = customId || null;
    this.reason = reason || "pending";
  }
}

// Levée quand CET appel précis a définitivement échoué (Batch failed/expired
// pour cette requête, ou contenu invalide au-delà de la politique de retry).
// Distincte de PregenerationPendingError : le scheduler doit marquer tout le
// sujet `failed`, jamais continuer à attendre indéfiniment.
class PregenerationCallFailedError extends Error {
  constructor(message, { customId, reason } = {}) {
    super(message || "Appel de pré-génération définitivement échoué.");
    this.name = "PregenerationCallFailedError";
    this.customId = customId || null;
    this.reason = reason || "failed";
  }
}

function buildCustomId(queueId, callKey, occurrence) {
  return `${queueId}:${callKey}:${occurrence}`;
}

// Cœur du mécanisme : appelé par server.js (_callOpenAIViaPregenerationCache)
// à la place de chaque appel réseau réel, à l'INTÉRIEUR du pipeline rejoué.
// `requestPayload` : {model, messages, temperature, responseFormat} — jamais
// reconstruit différemment de ce que le chemin synchrone enverrait (mêmes
// prompts/paramètres, cf. rapport final "Modèles et options").
async function resolveStep({ supabase, queueId, callKey, occurrence, requestPayload }) {
  const customId = buildCustomId(queueId, callKey, occurrence);
  const { data: existing, error: selectError } = await supabase
    .from(CALLS_TABLE)
    .select("status, result_content, error_reason")
    .eq("custom_id", customId)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);

  if (existing) {
    if (existing.status === "completed") return { content: existing.result_content };
    if (existing.status === "failed") {
      throw new PregenerationCallFailedError(existing.error_reason || `Appel ${callKey} échoué.`, { customId, reason: existing.error_reason });
    }
    // "pending" (enregistré mais pas encore inclus dans un Batch soumis) ou
    // "batch_submitted" (Batch en cours) : dans les deux cas, ce sujet doit
    // simplement attendre le prochain cycle scheduler.
    throw new PregenerationPendingError(`Appel ${callKey} (${customId}) en attente.`, { customId, reason: existing.status });
  }

  // Première rencontre de cet appel pour ce sujet : l'enregistrer pour la
  // prochaine passe de soumission Batch. `upsert` avec ignoreDuplicates
  // plutôt qu'un simple insert : un cycle scheduler concurrent (ne devrait
  // pas arriver avec le lock en mémoire, mais défensif) ne doit jamais faire
  // échouer ce chemin sur la contrainte unique (queue_id, call_key, occurrence).
  const { error: insertError } = await supabase
    .from(CALLS_TABLE)
    .upsert(
      { queue_id: queueId, call_key: callKey, occurrence, custom_id: customId, status: "pending", request_payload: requestPayload },
      { onConflict: "queue_id,call_key,occurrence", ignoreDuplicates: true }
    );
  if (insertError) throw new Error(insertError.message);
  throw new PregenerationPendingError(`Appel ${callKey} (${customId}) nouvellement enregistré, en attente de soumission Batch.`, { customId, reason: "pending" });
}

// Sélectionne les appels encore jamais soumis (status='pending', sans
// batch_id) toutes files confondues, pour la passe de soumission du
// scheduler — plafonné à `limit` (PREGENERATION_BATCH_SIZE) pour ne jamais
// construire un Batch arbitrairement gros en un seul cycle.
async function selectPendingCalls({ supabase, limit }) {
  const { data, error } = await supabase
    .from(CALLS_TABLE)
    .select("id, queue_id, call_key, occurrence, custom_id, request_payload")
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
// `batch_submitted`) — un par lot soumis, jamais un par appel individuel —
// pour la passe de poll du scheduler.
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
// `resultsByCustomId` (cf. openai-batch-client.parseBatchOutputJsonl) met à
// jour EXACTEMENT l'appel qui porte ce custom_id — jamais une mise à jour en
// masse sur tout le batch_id, pour rester correct même si l'ordre ou une
// partie des lignes manque.
async function applyBatchResults({ supabase, batchId, resultsByCustomId }) {
  const { data: rows, error } = await supabase
    .from(CALLS_TABLE)
    .select("id, custom_id")
    .eq("batch_id", batchId)
    .eq("status", "batch_submitted");
  if (error) throw new Error(error.message);
  for (const row of rows || []) {
    const result = resultsByCustomId.get(row.custom_id);
    if (!result) continue; // ligne manquante dans l'output : laissée batch_submitted, retentée au cycle suivant (cf. politique de retry au niveau sujet).
    if (result.ok) {
      await supabase.from(CALLS_TABLE).update({ status: "completed", result_content: result.content, updated_at: new Date().toISOString() }).eq("id", row.id);
    } else {
      await supabase.from(CALLS_TABLE).update({ status: "failed", error_reason: result.error, updated_at: new Date().toISOString() }).eq("id", row.id);
    }
  }
}

// Marque TOUS les appels d'un batch_id comme échoués (Batch entier
// failed/expired/cancelled, jamais une erreur par ligne cette fois) — la
// politique de retry au niveau SUJET (attempt_count sur la queue) décide
// ensuite si ces appels doivent être réinitialisés à `pending` pour une
// nouvelle tentative ou si le sujet passe définitivement `failed`.
async function markBatchFailed({ supabase, batchId, reason }) {
  const { error } = await supabase
    .from(CALLS_TABLE)
    .update({ status: "failed", error_reason: reason, updated_at: new Date().toISOString() })
    .eq("batch_id", batchId)
    .eq("status", "batch_submitted");
  if (error) throw new Error(error.message);
}

// Réinitialise à `pending` les appels `failed` d'un sujet donné, pour une
// nouvelle tentative complète — jamais utilisé au-delà de MAX_ATTEMPTS (cf.
// server.js, politique de retry au niveau de la queue).
async function resetFailedCallsForRetry({ supabase, queueId }) {
  const { error } = await supabase
    .from(CALLS_TABLE)
    .update({ status: "pending", error_reason: null, batch_id: null, updated_at: new Date().toISOString() })
    .eq("queue_id", queueId)
    .eq("status", "failed");
  if (error) throw new Error(error.message);
}

module.exports = {
  PregenerationPendingError,
  PregenerationCallFailedError,
  buildCustomId,
  resolveStep,
  selectPendingCalls,
  markCallsBatchSubmitted,
  selectActiveBatchIds,
  applyBatchResults,
  markBatchFailed,
  resetFailedCallsForRetry
};
