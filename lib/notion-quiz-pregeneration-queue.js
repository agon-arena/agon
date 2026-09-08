"use strict";

// Queue de sujets à pré-générer (chantier "pré-génération en avance des
// sujets IA proposés", 07/09/2026). Identité = normalizeCustomTopicKey(title)
// (cf. lib/custom-topic-identity.js) — EXACTEMENT la même que le catalogue
// "notion:custom:*" utilise déjà : "UN SUJET = UN MASTER UNIQUE" n'est vrai
// que si cette identité ne diverge jamais de celle du pipeline existant.
//
// `findExistingMaster` est toujours injecté (jamais un accès Supabase direct
// à daily_quiz ici) — server.js passe littéralement sa propre
// `findExistingQuizMaster`, pour ne jamais dupliquer la logique d'éligibilité
// d'un master (isMasterEligibleQuiz).

const { normalizeCustomTopicKey, buildCustomTopicMasterSlot } = require("./custom-topic-identity");

const QUEUE_TABLE = "notion_quiz_pregeneration_queue";

// Enqueue non bloquant d'un sujet isNew:true proposé par le fallback IA.
// Vérifie D'ABORD si un master existe désormais déjà (course "fallback
// croyait isNew, un master a été créé entre-temps") — dans ce cas, aucune
// ligne n'est créée ni touchée. Sinon, upsert : une ligne déjà existante
// (même normalizedKey déjà proposé avant) voit son proposal_count incrémenté
// et last_proposed_at rafraîchi, jamais une seconde ligne créée.
async function enqueueProposedTopic({ supabase, title, findExistingMaster, source = "ai_fallback_proposal" }) {
  const normalizedKey = normalizeCustomTopicKey(title);
  const masterSlot = buildCustomTopicMasterSlot(normalizedKey);

  const existingMaster = await findExistingMaster([masterSlot]);
  if (existingMaster) {
    return { enqueued: false, reason: "already_in_catalog", normalizedKey, masterSlot };
  }

  const { data: existingRow, error: selectError } = await supabase
    .from(QUEUE_TABLE)
    .select("id, proposal_count, status")
    .eq("normalized_key", normalizedKey)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);

  const now = new Date().toISOString();
  if (existingRow) {
    const { error: updateError } = await supabase
      .from(QUEUE_TABLE)
      .update({ proposal_count: (existingRow.proposal_count || 1) + 1, last_proposed_at: now, updated_at: now })
      .eq("id", existingRow.id);
    if (updateError) throw new Error(updateError.message);
    return { enqueued: true, reason: "proposal_count_incremented", normalizedKey, masterSlot, alreadyQueued: true };
  }

  const { error: insertError } = await supabase
    .from(QUEUE_TABLE)
    .insert({
      normalized_key: normalizedKey,
      title,
      status: "pending",
      source,
      proposal_count: 1,
      last_proposed_at: now
    });
  if (insertError) throw new Error(insertError.message);
  return { enqueued: true, reason: "new_row", normalizedKey, masterSlot, alreadyQueued: false };
}

// Priorité (demande explicite) : proposal_count DESC, last_proposed_at DESC,
// created_at ASC — favorise les sujets redemandés souvent plutôt que de
// pré-générer indistinctement tout ce qui n'a été vu qu'une fois.
async function selectNextPendingTopics({ supabase, limit }) {
  const { data, error } = await supabase
    .from(QUEUE_TABLE)
    .select("id, normalized_key, title, proposal_count, last_proposed_at, created_at, attempt_count")
    .eq("status", "pending")
    .order("proposal_count", { ascending: false })
    .order("last_proposed_at", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

// Stock réellement disponible pour un nouvel utilisateur : sujets `ready`
// dont le master_slot n'a encore été adopté par PERSONNE (pas de ligne
// user_notion_quizzes) — jamais confondu avec "5 copies pour 5 utilisateurs"
// (demande explicite) : ce sont 5 sujets DIFFÉRENTS du catalogue global,
// chacun réutilisable par un nombre illimité d'utilisateurs une fois adopté
// au moins une fois (il reste alors dans le catalogue, simplement plus
// compté ici comme "en réserve non consommée").
async function countUnclaimedReadyTopics({ supabase }) {
  const { data: readyRows, error } = await supabase
    .from(QUEUE_TABLE)
    .select("master_slot")
    .eq("status", "ready")
    .not("master_slot", "is", null);
  if (error) throw new Error(error.message);
  const slots = (readyRows || []).map((r) => r.master_slot);
  if (!slots.length) return 0;
  const { data: claimedRows, error: claimedError } = await supabase
    .from("user_notion_quizzes")
    .select("slot")
    .in("slot", slots);
  if (claimedError) throw new Error(claimedError.message);
  const claimedSlots = new Set((claimedRows || []).map((r) => r.slot));
  return slots.filter((slot) => !claimedSlots.has(slot)).length;
}

// Sujets réellement prêts (Batch terminé) et non encore adoptés par
// personne — le stock à servir à "À apprendre ensuite" (demande explicite du
// 08/09/2026 : plus jamais un sujet proposé qui déclencherait une génération
// en direct au clic, uniquement ceux déjà passés par le Batch). Même
// filtrage "unclaimed" que countUnclaimedReadyTopics ci-dessus, mais renvoie
// ici les lignes elles-mêmes (title/master_slot) plutôt qu'un simple compte.
async function selectUnclaimedReadyTopics({ supabase, limit }) {
  const { data: readyRows, error } = await supabase
    .from(QUEUE_TABLE)
    .select("id, title, master_slot")
    .eq("status", "ready")
    .not("master_slot", "is", null)
    .order("updated_at", { ascending: false })
    .limit(Math.max(limit * 3, limit));
  if (error) throw new Error(error.message);
  const rows = readyRows || [];
  if (!rows.length) return [];
  const slots = rows.map((r) => r.master_slot);
  const { data: claimedRows, error: claimedError } = await supabase
    .from("user_notion_quizzes")
    .select("slot")
    .in("slot", slots);
  if (claimedError) throw new Error(claimedError.message);
  const claimedSlots = new Set((claimedRows || []).map((r) => r.slot));
  return rows.filter((r) => !claimedSlots.has(r.master_slot)).slice(0, limit);
}

module.exports = {
  QUEUE_TABLE,
  enqueueProposedTopic,
  selectNextPendingTopics,
  countUnclaimedReadyTopics,
  selectUnclaimedReadyTopics
};
