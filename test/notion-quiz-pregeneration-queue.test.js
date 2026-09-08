"use strict";

// Tests purs de la queue de pré-génération (lib/notion-quiz-pregeneration-queue.js)
// — AUCUN réseau, AUCUN Supabase réel (test #32/#33 du chantier).

const test = require("node:test");
const assert = require("node:assert/strict");
const { makeFakeSupabase } = require("./helpers/fake-supabase");
const queue = require("../lib/notion-quiz-pregeneration-queue");
const { normalizeCustomTopicKey, buildCustomTopicMasterSlot } = require("../lib/custom-topic-identity");

const neverFindsExisting = async () => null;

test("enqueueProposedTopic : sujet inédit (findExistingMaster ne trouve rien) -> nouvelle ligne pending, proposal_count=1", async () => {
  const supabase = makeFakeSupabase();
  const result = await queue.enqueueProposedTopic({ supabase, title: "Banque centrale européenne", findExistingMaster: neverFindsExisting });
  assert.equal(result.enqueued, true);
  assert.equal(result.alreadyQueued, false);
  const rows = supabase.rows("notion_quiz_pregeneration_queue");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].proposal_count, 1);
  assert.equal(rows[0].normalized_key, normalizeCustomTopicKey("Banque centrale européenne"));
});

test("enqueueProposedTopic : un master existe DÉJÀ (course fallback/génération concurrente) -> pas d'enqueue, aucune ligne créée", async () => {
  const supabase = makeFakeSupabase();
  const findExistingMaster = async () => ({ slot: "notion:custom:xyz", quizDate: "2026-09-07" });
  const result = await queue.enqueueProposedTopic({ supabase, title: "Sujet déjà au catalogue", findExistingMaster });
  assert.equal(result.enqueued, false);
  assert.equal(result.reason, "already_in_catalog");
  assert.equal(supabase.rows("notion_quiz_pregeneration_queue").length, 0);
});

test("enqueueProposedTopic : même normalized_key proposé deux fois -> UNE seule ligne, proposal_count incrémenté", async () => {
  const supabase = makeFakeSupabase();
  await queue.enqueueProposedTopic({ supabase, title: "Kolkhoze", findExistingMaster: neverFindsExisting });
  const second = await queue.enqueueProposedTopic({ supabase, title: "Kolkhoze", findExistingMaster: neverFindsExisting });
  const rows = supabase.rows("notion_quiz_pregeneration_queue");
  assert.equal(rows.length, 1, "une seule ligne, jamais un doublon");
  assert.equal(rows[0].proposal_count, 2);
  assert.equal(second.alreadyQueued, true);
});

test("enqueueProposedTopic : une casse/accentuation différente pour le même sujet reste la MÊME ligne (identité = normalizeCustomTopicKey)", async () => {
  const supabase = makeFakeSupabase();
  await queue.enqueueProposedTopic({ supabase, title: "Kolkhoze", findExistingMaster: neverFindsExisting });
  await queue.enqueueProposedTopic({ supabase, title: "  KOLKHOZE  ", findExistingMaster: neverFindsExisting });
  const rows = supabase.rows("notion_quiz_pregeneration_queue");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].proposal_count, 2);
});

test("enqueueProposedTopic : normalizedKey/masterSlot retournés correspondent exactement au contrat catalogue existant", async () => {
  const supabase = makeFakeSupabase();
  const result = await queue.enqueueProposedTopic({ supabase, title: "Sovkhoze", findExistingMaster: neverFindsExisting });
  const expectedKey = normalizeCustomTopicKey("Sovkhoze");
  assert.equal(result.normalizedKey, expectedKey);
  assert.equal(result.masterSlot, buildCustomTopicMasterSlot(expectedKey));
});

test("selectNextPendingTopics : priorité proposal_count DESC, puis last_proposed_at DESC, puis created_at ASC ; respecte limit ; ignore les non-pending", async () => {
  const supabase = makeFakeSupabase({
    notion_quiz_pregeneration_queue: [
      { id: 1, normalized_key: "a", title: "A", status: "pending", proposal_count: 1, last_proposed_at: "2026-09-07T10:00:00Z", created_at: "2026-09-07T09:00:00Z" },
      { id: 2, normalized_key: "b", title: "B", status: "pending", proposal_count: 5, last_proposed_at: "2026-09-07T08:00:00Z", created_at: "2026-09-07T08:00:00Z" },
      { id: 3, normalized_key: "c", title: "C", status: "ready", proposal_count: 9, last_proposed_at: "2026-09-07T11:00:00Z", created_at: "2026-09-07T07:00:00Z" },
      { id: 4, normalized_key: "d", title: "D", status: "pending", proposal_count: 5, last_proposed_at: "2026-09-07T09:30:00Z", created_at: "2026-09-07T08:30:00Z" }
    ]
  });
  const selected = await queue.selectNextPendingTopics({ supabase, limit: 10 });
  assert.deepEqual(selected.map((r) => r.id), [4, 2, 1], "B et D à égalité de proposal_count(5) : D gagne (last_proposed_at plus récent) ; C exclu (status=ready)");

  const limited = await queue.selectNextPendingTopics({ supabase, limit: 1 });
  assert.deepEqual(limited.map((r) => r.id), [4]);
});

test("countUnclaimedReadyTopics : ne compte que les sujets ready dont AUCUN utilisateur n'a encore adopté le master", async () => {
  const supabase = makeFakeSupabase({
    notion_quiz_pregeneration_queue: [
      { id: 1, status: "ready", master_slot: "notion:custom:aaa" },
      { id: 2, status: "ready", master_slot: "notion:custom:bbb" },
      { id: 3, status: "ready", master_slot: "notion:custom:ccc" },
      { id: 4, status: "pending", master_slot: null },
      { id: 5, status: "generating", master_slot: "notion:custom:ddd" }
    ],
    user_notion_quizzes: [
      { user_id: "u1", slot: "notion:custom:aaa", quiz_date: "2026-09-07" }
    ]
  });
  const count = await queue.countUnclaimedReadyTopics({ supabase });
  assert.equal(count, 2, "aaa est déjà adopté (exclu) ; bbb et ccc restent en réserve ; ccc compte même sans adoption");
});

test("countUnclaimedReadyTopics : zéro sujet ready -> 0, sans même interroger user_notion_quizzes", async () => {
  const supabase = makeFakeSupabase({ notion_quiz_pregeneration_queue: [] });
  const count = await queue.countUnclaimedReadyTopics({ supabase });
  assert.equal(count, 0);
});

test("selectUnclaimedReadyTopics : ne renvoie que les sujets ready non encore adoptés, jamais un pending/generating (demande du 08/09/2026 : plus de génération en direct)", async () => {
  const supabase = makeFakeSupabase({
    notion_quiz_pregeneration_queue: [
      { id: 1, title: "Aaa", status: "ready", master_slot: "notion:custom:aaa", updated_at: "2026-09-08T10:00:00Z" },
      { id: 2, title: "Bbb", status: "ready", master_slot: "notion:custom:bbb", updated_at: "2026-09-08T09:00:00Z" },
      { id: 3, title: "Ccc pending", status: "pending", master_slot: null, updated_at: "2026-09-08T08:00:00Z" },
      { id: 4, title: "Ddd generating", status: "generating", master_slot: "notion:custom:ddd", updated_at: "2026-09-08T07:00:00Z" }
    ],
    user_notion_quizzes: [
      { user_id: "u1", slot: "notion:custom:aaa", quiz_date: "2026-09-08" }
    ]
  });
  const topics = await queue.selectUnclaimedReadyTopics({ supabase, limit: 10 });
  assert.deepEqual(topics.map((t) => t.title), ["Bbb"], "aaa déjà adopté (exclu), pending/generating jamais servis, seul bbb reste");
});

test("selectUnclaimedReadyTopics : respecte limit, plus récent d'abord", async () => {
  const supabase = makeFakeSupabase({
    notion_quiz_pregeneration_queue: [
      { id: 1, title: "Ancien", status: "ready", master_slot: "notion:custom:a1", updated_at: "2026-09-06T10:00:00Z" },
      { id: 2, title: "Recent", status: "ready", master_slot: "notion:custom:a2", updated_at: "2026-09-08T10:00:00Z" },
      { id: 3, title: "Moyen", status: "ready", master_slot: "notion:custom:a3", updated_at: "2026-09-07T10:00:00Z" }
    ]
  });
  const topics = await queue.selectUnclaimedReadyTopics({ supabase, limit: 2 });
  assert.deepEqual(topics.map((t) => t.title), ["Recent", "Moyen"]);
});

test("selectUnclaimedReadyTopics : zéro sujet ready -> tableau vide, sans même interroger user_notion_quizzes", async () => {
  const supabase = makeFakeSupabase({ notion_quiz_pregeneration_queue: [] });
  const topics = await queue.selectUnclaimedReadyTopics({ supabase, limit: 5 });
  assert.deepEqual(topics, []);
});
