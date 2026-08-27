"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const repo = require("../lib/coeus/noes-repository");

// Fake Supabase minimal : chaque appel à supabase.from(...) consomme, DANS
// L'ORDRE, le résultat suivant fourni au test — suffisant ici car chaque
// fonction du dépôt ne fait qu'un nombre de requêtes connu et fixe (au plus
// une relecture en cas de course 23505). Les méthodes de chaînage
// (select/insert/update/eq/lt/gte/order/limit) sont des no-op qui renvoient
// le builder ; single/maybeSingle/then résolvent tous vers le même résultat
// configuré pour cet appel.
function fakeFrom(result) {
  const builder = {
    select() { return builder; },
    insert() { return builder; },
    update() { return builder; },
    eq() { return builder; },
    lt() { return builder; },
    gte() { return builder; },
    order() { return builder; },
    limit() { return builder; },
    single() { return Promise.resolve(result); },
    maybeSingle() { return Promise.resolve(result); },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return builder;
}

function createFakeSupabase(resultsByCallOrder) {
  let i = 0;
  const calls = [];
  const supabase = {
    from(table) {
      calls.push(table);
      const result = resultsByCallOrder[i++];
      if (!result) throw new Error(`Appel supabase.from() imprévu (table=${table}, appel #${i})`);
      return fakeFrom(result);
    },
  };
  supabase.__calls = calls;
  return supabase;
}

test("insertNoesScript : cas normal, une seule requête", async () => {
  const row = { id: "s1", slot: "notion:custom:x", quiz_date: "2026-08-26", items: [] };
  const supabase = createFakeSupabase([{ data: row, error: null }]);
  const result = await repo.insertNoesScript(supabase, { slot: "notion:custom:x", quizDate: "2026-08-26", sourceType: "custom", items: [], model: "gpt-4o-mini" });
  assert.equal(result.id, "s1");
  assert.deepEqual(supabase.__calls, ["noes_scripts"]);
});

test("insertNoesScript : course perdue (23505) -> relit la ligne du gagnant, jamais un second appel IA", async () => {
  const won = { id: "s1", slot: "notion:custom:x", quiz_date: "2026-08-26", items: [{ knowledgeId: "k1", question: "Q", answer: "A" }] };
  const supabase = createFakeSupabase([
    { data: null, error: { code: "23505", message: "duplicate" } },
    { data: won, error: null },
  ]);
  const result = await repo.insertNoesScript(supabase, { slot: "notion:custom:x", quizDate: "2026-08-26", sourceType: "custom", items: [], model: "gpt-4o-mini" });
  assert.deepEqual(result, won);
});

test("insertPendingNoesVideo : course perdue (23505) -> relit la ligne existante par video_hash", async () => {
  const existing = { id: "v1", video_hash: "abc", status: "processing" };
  const supabase = createFakeSupabase([
    { data: null, error: { code: "23505", message: "duplicate" } },
    { data: existing, error: null },
  ]);
  const result = await repo.insertPendingNoesVideo(supabase, {
    videoHash: "abc", slot: "notion:custom:x", quizDate: "2026-08-26", batchIndex: 0,
    knowledgeIds: ["k1"], pipelineVersion: "v1", voice: "kokoro:ff_siwis", avatar: "coeusfemme2", thinkingPauseSeconds: 3,
  });
  assert.deepEqual(result, existing);
});

test("claimPendingNoesVideoForSubmission : gagné quand la ligne matchait encore pending", async () => {
  const supabase = createFakeSupabase([{ data: [{ id: "v1" }], error: null }]);
  assert.equal(await repo.claimPendingNoesVideoForSubmission(supabase, "v1"), true);
});

test("claimPendingNoesVideoForSubmission : perdu quand une autre instance a déjà réclamé la ligne", async () => {
  const supabase = createFakeSupabase([{ data: [], error: null }]);
  assert.equal(await repo.claimPendingNoesVideoForSubmission(supabase, "v1"), false);
});

test("claimNoesVideoForFinalization : gagné seulement si updated_at n'a pas changé (verrou optimiste)", async () => {
  const won = createFakeSupabase([{ data: [{ id: "v1" }], error: null }]);
  assert.equal(await repo.claimNoesVideoForFinalization(won, { id: "v1", expectedUpdatedAt: "2026-08-26T10:00:00.000Z" }), true);

  const lost = createFakeSupabase([{ data: [], error: null }]);
  assert.equal(await repo.claimNoesVideoForFinalization(lost, { id: "v1", expectedUpdatedAt: "2026-08-26T10:00:00.000Z" }), false);
});

test("countUserDistinctVideosRequestedToday : dédoublonne les rejouages du même jour", async () => {
  const supabase = createFakeSupabase([{
    data: [{ video_id: "v1" }, { video_id: "v1" }, { video_id: "v2" }],
    error: null,
  }]);
  assert.equal(await repo.countUserDistinctVideosRequestedToday(supabase, "u1"), 2);
});

test("hasUserRequestedVideoToday : true/false selon la présence d'une ligne", async () => {
  const yes = createFakeSupabase([{ data: { id: "r1" }, error: null }]);
  assert.equal(await repo.hasUserRequestedVideoToday(yes, { userId: "u1", videoId: "v1" }), true);

  const no = createFakeSupabase([{ data: null, error: null }]);
  assert.equal(await repo.hasUserRequestedVideoToday(no, { userId: "u1", videoId: "v1" }), false);
});

test("recordNoesVideoRequest : avale un 23505 (course exacte, déjà journalisé), propage les autres erreurs", async () => {
  const raced = createFakeSupabase([{ data: null, error: { code: "23505", message: "duplicate" } }]);
  await assert.doesNotReject(repo.recordNoesVideoRequest(raced, { userId: "u1", videoId: "v1" }));

  const broken = createFakeSupabase([{ data: null, error: { code: "500", message: "boom" } }]);
  await assert.rejects(repo.recordNoesVideoRequest(broken, { userId: "u1", videoId: "v1" }), /boom/);
});

test("findStaleProcessingNoesVideos : ne renvoie que ce que Supabase retourne, jamais d'exception sur liste vide", async () => {
  const supabase = createFakeSupabase([{ data: [], error: null }]);
  assert.deepEqual(await repo.findStaleProcessingNoesVideos(supabase, 1000), []);
});
