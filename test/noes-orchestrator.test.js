"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const {
  requestNoesVideo,
  pollAndFinalizeNoesVideo,
  getOrCreateNoesScript,
  NoesRequestError
} = require("../lib/coeus/noes-orchestrator");
const noesRepositoryForTest = require("../lib/coeus/noes-repository");

// ── Fake Supabase en mémoire ────────────────────────────────────────────────
// Contrairement au fake minimal de test/noes-repository.test.js (résultat
// pré-scripté par ordre d'appel), celui-ci se comporte comme de vraies
// tables : insert/update/select réels sur des tableaux en mémoire, avec
// émulation des contraintes UNIQUE (23505) — nécessaire ici car
// l'orchestrateur enchaîne un nombre de requêtes qui dépend du scénario
// (cache hit vs miss, etc.), impossible à scripter par position.
// Horloge factice strictement croissante (jamais Date.now()/toISOString()
// directement) : ce fake exécute tout de façon synchrone, en dessous de la
// résolution milliseconde de Date — deux appels réels de new Date() peuvent
// donc renvoyer LA MÊME chaîne, ce qui rendrait le verrou optimiste basé sur
// updated_at totalement inopérant ICI (jamais en production, où Postgres a
// une précision microseconde et deux requêtes concurrentes ont un vrai
// écart réseau). Un compteur monotone reproduit fidèlement la propriété
// "chaque écriture a un timestamp différent" sans laquelle
// claimNoesVideoForFinalization/claimPendingNoesVideoForSubmission ne
// peuvent pas être testés pour de vrai.
// Garder les écritures factices dans la journée UTC réellement testée : le
// quota journalier de production calcule sa fenêtre à partir de Date.now().
// Une date figée rendrait ce test silencieusement caduc dès le lendemain.
const _todayUtc = new Date();
_todayUtc.setUTCHours(0, 0, 0, 0);
let _fakeClockMs = _todayUtc.getTime();
function nowIso() {
  _fakeClockMs += 1;
  return new Date(_fakeClockMs).toISOString();
}

function createInMemorySupabase(schema) {
  const tables = {};
  for (const [name, def] of Object.entries(schema)) {
    tables[name] = { rows: [], unique: def.unique || [] };
  }

  function matchesFilters(row, filters) {
    return filters.every(({ field, op, value }) => {
      const v = row[field];
      if (op === "eq") return v === value;
      if (op === "gte") return v >= value;
      if (op === "lt") return v < value;
      return true;
    });
  }

  function checkUnique(table, candidate) {
    for (const fields of table.unique) {
      const conflict = table.rows.find((row) => fields.every((f) => row[f] === candidate[f]));
      if (conflict) return fields;
    }
    return null;
  }

  function from(name) {
    const table = tables[name];
    if (!table) throw new Error(`Table non déclarée dans le fake : ${name}`);
    let mode = "select";
    let insertPayload = null;
    let updatePayload = null;
    const filters = [];
    let selectedLimit = null;

    async function resolveRaw() {
      if (mode === "insert") {
        const conflict = checkUnique(table, insertPayload);
        if (conflict) return { data: null, error: { code: "23505", message: `duplicate key (${conflict.join(",")})` } };
        // requested_at (comme created_at/updated_at) : émule DEFAULT now()
        // des vraies migrations (cf. data/migration-noes-video-requests.sql)
        // — recordNoesVideoRequest n'envoie jamais cette colonne
        // explicitement, exactement comme en production.
        const row = { id: randomUUID(), created_at: nowIso(), updated_at: nowIso(), requested_at: nowIso(), ...insertPayload };
        table.rows.push(row);
        return { data: [row], error: null };
      }
      if (mode === "update") {
        const matched = table.rows.filter((row) => matchesFilters(row, filters));
        for (const row of matched) Object.assign(row, updatePayload);
        return { data: matched.slice(), error: null };
      }
      let matched = table.rows.filter((row) => matchesFilters(row, filters));
      if (selectedLimit != null) matched = matched.slice(0, selectedLimit);
      return { data: matched, error: null };
    }

    const builder = {
      select() { return builder; },
      insert(payload) { mode = "insert"; insertPayload = payload; return builder; },
      update(payload) { mode = "update"; updatePayload = payload; return builder; },
      eq(field, value) { filters.push({ field, op: "eq", value }); return builder; },
      gte(field, value) { filters.push({ field, op: "gte", value }); return builder; },
      lt(field, value) { filters.push({ field, op: "lt", value }); return builder; },
      order() { return builder; },
      limit(n) { selectedLimit = n; return builder; },
      async single() {
        const { data, error } = await resolveRaw();
        if (error) return { data: null, error };
        if (!data.length) return { data: null, error: { message: "no rows", code: "PGRST116" } };
        return { data: data[0], error: null };
      },
      async maybeSingle() {
        const { data, error } = await resolveRaw();
        if (error) return { data: null, error };
        return { data: data[0] || null, error: null };
      },
      then(resolve, reject) { return resolveRaw().then(resolve, reject); }
    };
    return builder;
  }

  return { from, __tables: tables };
}

function createSupabase() {
  return createInMemorySupabase({
    noes_scripts: { unique: [["slot", "quiz_date"]] },
    noes_videos: { unique: [["video_hash"]] },
    noes_video_requests: { unique: [["user_id", "video_id", "requested_date"]] }
  });
}

// Fiche factice : 2 connaissances exploitables (knowledgeTarget) + 1 legacy
// sans knowledgeTarget (doit être ignorée, cf. point fondamental).
function fakeQuestions() {
  return [
    { id: "q1", knowledgeTarget: "La chute de Constantinople a lieu en 1453." },
    { id: "q2", knowledgeTarget: "Le Pacifique est le plus grand océan." },
    { id: "q3" } // pas de knowledgeTarget -> jamais utilisée pour Noès
  ];
}

function fakeCallOpenAI(recorder) {
  return async (messages) => {
    recorder.calls.push(messages[0].content);
    return JSON.stringify({
      items: [
        { index: 1, question: "En quelle année Constantinople tombe-t-elle ?", answer: "1453." },
        { index: 2, question: "Quel est le plus grand océan ?", answer: "Le Pacifique." }
      ]
    });
  };
}

function fakeRunpodClient({ submitDelayMs = 0, submitShouldFail = false, statusResponses = [] } = {}) {
  const calls = { submit: [], status: [] };
  let statusIndex = 0;
  return {
    calls,
    async submitCoeusItemsVideo(input) {
      calls.submit.push(input);
      if (submitDelayMs) await new Promise((r) => setTimeout(r, submitDelayMs));
      if (submitShouldFail) throw new Error("RunPod indisponible");
      return { id: `job-${calls.submit.length}`, status: "IN_QUEUE" };
    },
    async getCoeusVideoStatus(jobId) {
      calls.status.push(jobId);
      const response = statusResponses[Math.min(statusIndex, statusResponses.length - 1)];
      statusIndex += 1;
      if (response instanceof Error) throw response;
      return response;
    }
  };
}

function baseDeps(overrides = {}) {
  const supabase = overrides.supabase || createSupabase();
  const recorder = { calls: [] };
  return {
    supabase,
    callOpenAI: overrides.callOpenAI || fakeCallOpenAI(recorder),
    __aiRecorder: recorder,
    getRunpodClients: overrides.getRunpodClients || (() => null),
    inFlightMap: new Map(),
    config: { storageBucket: "debate-media", storageCacheControl: "31536000", ...(overrides.config || {}) }
  };
}

const BASE_REQUEST = { userId: "user-1", slot: "notion:custom:abc", quizDate: "2026-08-27", batchIndex: 0 };

// ── Point fondamental : jamais le QCM, toujours knowledgeTarget ────────────
test("getOrCreateNoesScript envoie les knowledgeTarget à l'IA, jamais les questions QCM", async () => {
  const deps = baseDeps();
  const { script, generated } = await getOrCreateNoesScript({
    supabase: deps.supabase, callOpenAI: deps.callOpenAI, slot: "notion:custom:abc", quizDate: "2026-08-27", questions: fakeQuestions()
  });
  assert.equal(generated, true);
  assert.equal(script.items.length, 2); // q3 (sans knowledgeTarget) exclue
  const prompt = deps.__aiRecorder.calls[0];
  assert.match(prompt, /La chute de Constantinople a lieu en 1453\./);
  assert.match(prompt, /Le Pacifique est le plus grand océan\./);
});

test("un script déjà en cache ne déclenche jamais un second appel IA", async () => {
  const supabase = createSupabase();
  const deps = baseDeps({ supabase });
  await getOrCreateNoesScript({ supabase, callOpenAI: deps.callOpenAI, slot: "notion:custom:abc", quizDate: "2026-08-27", questions: fakeQuestions() });
  assert.equal(deps.__aiRecorder.calls.length, 1);

  const { generated } = await getOrCreateNoesScript({ supabase, callOpenAI: deps.callOpenAI, slot: "notion:custom:abc", quizDate: "2026-08-27", questions: fakeQuestions() });
  assert.equal(generated, false);
  assert.equal(deps.__aiRecorder.calls.length, 1); // toujours 1, pas de second appel
});

// ── Batch / hash ────────────────────────────────────────────────────────────
test("requestNoesVideo rejette un batchIndex hors limites (400)", async () => {
  const runpod = fakeRunpodClient();
  const deps = baseDeps({ getRunpodClients: () => ({ runpodClient: runpod }) });
  await assert.rejects(
    requestNoesVideo(deps, { ...BASE_REQUEST, batchIndex: 5, questions: fakeQuestions() }),
    (err) => err instanceof NoesRequestError && err.status === 400 && err.code === "batch_out_of_range"
  );
  assert.equal(runpod.calls.submit.length, 0);
});

// ── video_hash absent -> génération ─────────────────────────────────────────
test("video_hash absent : crée un job pending->processing, un seul appel RunPod", async () => {
  const runpod = fakeRunpodClient();
  const deps = baseDeps({ getRunpodClients: () => ({ runpodClient: runpod }) });
  const video = await requestNoesVideo(deps, { ...BASE_REQUEST, questions: fakeQuestions() });
  assert.equal(video.status, "processing");
  assert.equal(runpod.calls.submit.length, 1);
  assert.deepEqual(runpod.calls.submit[0].items.map((i) => i.question), [
    "En quelle année Constantinople tombe-t-elle ?", "Quel est le plus grand océan ?"
  ]);
});

// ── ready -> aucun nouvel appel RunPod ──────────────────────────────────────
test("vidéo déjà ready : aucun nouvel appel RunPod, réponse immédiate", async () => {
  const runpod = fakeRunpodClient();
  const deps = baseDeps({ getRunpodClients: () => ({ runpodClient: runpod }) });

  const first = await requestNoesVideo(deps, { ...BASE_REQUEST, questions: fakeQuestions() });
  // Simule la finalisation (comme le ferait GET /status après COMPLETED).
  deps.supabase.__tables.noes_videos.rows.find((r) => r.id === first.id).status = "ready";
  deps.supabase.__tables.noes_videos.rows.find((r) => r.id === first.id).output_path = "https://cdn/noes/abc.mp4";

  const second = await requestNoesVideo(deps, { ...BASE_REQUEST, userId: "user-2", questions: fakeQuestions() });
  assert.equal(second.status, "ready");
  assert.equal(second.output_path, "https://cdn/noes/abc.mp4");
  assert.equal(runpod.calls.submit.length, 1); // toujours 1 : le second utilisateur n'a rien déclenché
});

// ── pending/processing -> rattachement, jamais un second job ───────────────
test("vidéo déjà processing : rattachement, aucun second job RunPod", async () => {
  const runpod = fakeRunpodClient();
  const deps = baseDeps({ getRunpodClients: () => ({ runpodClient: runpod }) });
  const first = await requestNoesVideo(deps, { ...BASE_REQUEST, questions: fakeQuestions() });
  assert.equal(first.status, "processing");

  const second = await requestNoesVideo(deps, { ...BASE_REQUEST, userId: "user-2", questions: fakeQuestions() });
  assert.equal(second.status, "processing");
  assert.equal(second.id, first.id);
  assert.equal(runpod.calls.submit.length, 1); // pas de second appel
});

// ── Déduplication de requêtes concurrentes (aucun job GPU doublé) ──────────
test("deux requêtes concurrentes pour le même contenu -> un seul job RunPod soumis", async () => {
  const runpod = fakeRunpodClient({ submitDelayMs: 15 });
  const deps = baseDeps({ getRunpodClients: () => ({ runpodClient: runpod }) });

  const [videoA, videoB] = await Promise.all([
    requestNoesVideo(deps, { ...BASE_REQUEST, userId: "user-1", questions: fakeQuestions() }),
    requestNoesVideo(deps, { ...BASE_REQUEST, userId: "user-2", questions: fakeQuestions() })
  ]);

  assert.equal(runpod.calls.submit.length, 1, "un seul job RunPod pour deux requêtes concurrentes identiques");
  assert.equal(videoA.id, videoB.id);
  assert.equal(videoA.status, "processing");
});

// ── Quota (nouvelles générations uniquement) ────────────────────────────────
test("quota quotidien : bloque une NOUVELLE génération, jamais le rejouage d'une vidéo déjà demandée", async () => {
  const runpod = fakeRunpodClient();
  const deps = baseDeps({
    getRunpodClients: () => ({ runpodClient: runpod }),
    config: { maxVideosPerDay: 1 },
    callOpenAI: async (messages) => {
      const prompt = messages?.[0]?.content || "";
      if (prompt.includes("Une autre connaissance")) {
        return JSON.stringify({
          items: [
            { index: 1, question: "Quelle est cette autre connaissance ?", answer: "Une autre connaissance." },
            { index: 2, question: "Quelle connaissance supplémentaire faut-il retenir ?", answer: "Encore une autre." }
          ]
        });
      }
      return JSON.stringify({
        items: [
          { index: 1, question: "En quelle année Constantinople tombe-t-elle ?", answer: "1453." },
          { index: 2, question: "Quel est le plus grand océan ?", answer: "Le Pacifique." }
        ]
      });
    }
  });

  const video1 = await requestNoesVideo(deps, { ...BASE_REQUEST, questions: fakeQuestions() });
  assert.equal(runpod.calls.submit.length, 1);

  // Rejouer la MÊME vidéo (même user, même contenu) reste gratuit.
  const video1Again = await requestNoesVideo(deps, { ...BASE_REQUEST, questions: fakeQuestions() });
  assert.equal(video1Again.id, video1.id);
  assert.equal(runpod.calls.submit.length, 1);

  // Une fiche DIFFÉRENTE (nouveau slot -> nouveau hash) dépasse le quota (1/jour).
  const otherQuestions = [
    { id: "q1", knowledgeTarget: "Une autre connaissance." },
    { id: "q2", knowledgeTarget: "Encore une autre." }
  ];
  await assert.rejects(
    requestNoesVideo(deps, { ...BASE_REQUEST, slot: "notion:custom:xyz", questions: otherQuestions }),
    (err) => err instanceof NoesRequestError && err.status === 429 && err.code === "quota_exceeded"
  );
  assert.equal(runpod.calls.submit.length, 1); // toujours 1 : le job en quota dépassé n'a jamais été soumis
});

// ── Erreurs propres ──────────────────────────────────────────────────────────
test("échec de génération du script : erreur 502 propre, aucune ligne noes_scripts créée", async () => {
  const deps = baseDeps({ callOpenAI: async () => "ceci n'est pas du JSON valide" });
  await assert.rejects(
    requestNoesVideo(deps, { ...BASE_REQUEST, questions: fakeQuestions() }),
    (err) => err instanceof NoesRequestError && err.status === 502 && err.code === "script_generation_failed"
  );
  assert.equal(deps.supabase.__tables.noes_scripts.rows.length, 0);
});

test("aucune connaissance exploitable (toutes sans knowledgeTarget) : erreur 422 propre", async () => {
  const deps = baseDeps();
  await assert.rejects(
    requestNoesVideo(deps, { ...BASE_REQUEST, questions: [{ id: "q1" }, { id: "q2" }] }),
    (err) => err instanceof NoesRequestError && err.status === 422 && err.code === "no_knowledge"
  );
});

test("échec de soumission RunPod : ne lève jamais, renvoie un statut failed exploitable", async () => {
  const runpod = fakeRunpodClient({ submitShouldFail: true });
  const deps = baseDeps({ getRunpodClients: () => ({ runpodClient: runpod }) });
  const video = await requestNoesVideo(deps, { ...BASE_REQUEST, questions: fakeQuestions() });
  assert.equal(video.status, "failed");
  assert.equal(video.error_stage, "submit");
});

test("RunPod non configuré : statut failed avec error_stage configuration, pas d'exception", async () => {
  const deps = baseDeps({ getRunpodClients: () => null });
  const video = await requestNoesVideo(deps, { ...BASE_REQUEST, questions: fakeQuestions() });
  assert.equal(video.status, "failed");
  assert.equal(video.error_stage, "configuration");
});

test("un ancien échec configuration est repris une seule fois après configuration du serveur", async () => {
  const supabase = createSupabase();
  const runpod = fakeRunpodClient();
  let configured = false;
  const deps = baseDeps({
    supabase,
    getRunpodClients: () => configured ? { runpodClient: runpod } : null
  });

  const failed = await requestNoesVideo(deps, { ...BASE_REQUEST, questions: fakeQuestions() });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error_stage, "configuration");
  assert.equal(runpod.calls.submit.length, 0);

  configured = true;
  const [retried, concurrent] = await Promise.all([
    requestNoesVideo(deps, { ...BASE_REQUEST, questions: fakeQuestions() }),
    requestNoesVideo(deps, { ...BASE_REQUEST, userId: "user-2", questions: fakeQuestions() })
  ]);
  assert.equal(runpod.calls.submit.length, 1);
  assert.ok([retried.status, concurrent.status].includes("processing"));
});

test("un timeout local reprend le même job RunPod encore actif sans jamais le resoumettre", async () => {
  const supabase = createSupabase();
  const runpod = fakeRunpodClient({ statusResponses: [{ status: "IN_PROGRESS", id: "job-1" }] });
  const deps = baseDeps({ supabase, getRunpodClients: () => ({ runpodClient: runpod }) });

  const first = await requestNoesVideo(deps, { ...BASE_REQUEST, questions: fakeQuestions() });
  const row = supabase.__tables.noes_videos.rows.find((item) => item.id === first.id);
  row.status = "failed";
  row.error_stage = "timeout";

  const resumed = await requestNoesVideo(deps, { ...BASE_REQUEST, questions: fakeQuestions() });
  assert.equal(resumed.status, "processing");
  assert.equal(resumed.runpod_job_id, "job-1");
  assert.equal(runpod.calls.status.length, 1);
  assert.equal(runpod.calls.submit.length, 1, "le job initial reste l'unique soumission");
});

// ── Finalisation (GET /status) ──────────────────────────────────────────────
function fakeVolumeClient({ downloadShouldFail = false } = {}) {
  return {
    calls: { download: [], delete: [] },
    async downloadVideo(key) {
      this.calls.download.push(key);
      if (downloadShouldFail) throw new Error("volume RunPod inaccessible");
      const { Readable } = require("node:stream");
      return { body: Readable.from([Buffer.from("mp4-bytes")]) };
    },
    async deleteObject(key) {
      this.calls.delete.push(key);
    }
  };
}

function fakeStorageSupabase(baseSupabase, { uploadShouldFail = false } = {}) {
  const uploadCalls = [];
  baseSupabase.storage = {
    from(bucket) {
      return {
        async upload(objectPath, buffer, options) {
          uploadCalls.push({ bucket, objectPath, options });
          return { error: uploadShouldFail ? { message: "upload storage échoué" } : null };
        },
        getPublicUrl(objectPath) {
          return { data: { publicUrl: `https://cdn.example/${bucket}/${objectPath}` } };
        }
      };
    }
  };
  baseSupabase.__uploadCalls = uploadCalls;
  return baseSupabase;
}

test("finalisation : job COMPLETED -> téléchargement + upload storage + status ready", async () => {
  const supabase = fakeStorageSupabase(createSupabase());
  const volumeClient = fakeVolumeClient();
  const runpod = fakeRunpodClient({ statusResponses: [{ status: "COMPLETED", output: { output_file: "/runpod-volume/coeus/outputs/coeus_abc.mp4", duration: 12.3, output_size: 12345 } }] });
  const deps = baseDeps({ supabase, getRunpodClients: () => ({ runpodClient: runpod, volumeClient }) });

  const created = await requestNoesVideo(deps, { ...BASE_REQUEST, questions: fakeQuestions() });
  assert.equal(created.status, "processing");

  const finalized = await pollAndFinalizeNoesVideo(deps, created);
  assert.equal(finalized.status, "ready");
  assert.match(finalized.output_path, /^https:\/\/cdn\.example\/debate-media\/noes\//);
  assert.equal(volumeClient.calls.delete.length, 1); // nettoyage du volume RunPod après publication
  assert.equal(supabase.__uploadCalls.length, 1);
  assert.equal(supabase.__uploadCalls[0].options.upsert, true);
});

test("finalisation : échec de téléchargement -> status failed, error_stage finalize", async () => {
  const supabase = fakeStorageSupabase(createSupabase());
  const volumeClient = fakeVolumeClient({ downloadShouldFail: true });
  const runpod = fakeRunpodClient({ statusResponses: [{ status: "COMPLETED", output: { output_file: "/runpod-volume/coeus/outputs/coeus_abc.mp4" } }] });
  const deps = baseDeps({ supabase, getRunpodClients: () => ({ runpodClient: runpod, volumeClient }) });

  const created = await requestNoesVideo(deps, { ...BASE_REQUEST, questions: fakeQuestions() });
  const finalized = await pollAndFinalizeNoesVideo(deps, created);
  assert.equal(finalized.status, "failed");
  assert.equal(finalized.error_stage, "finalize");
});

test("finalisation : statut RunPod terminal en échec -> status failed, error_stage runpod", async () => {
  const runpod = fakeRunpodClient({ statusResponses: [{ status: "FAILED" }] });
  const deps = baseDeps({ getRunpodClients: () => ({ runpodClient: runpod, volumeClient: fakeVolumeClient() }) });
  const created = await requestNoesVideo(deps, { ...BASE_REQUEST, questions: fakeQuestions() });
  const finalized = await pollAndFinalizeNoesVideo(deps, created);
  assert.equal(finalized.status, "failed");
  assert.equal(finalized.error_stage, "runpod");
});

test("finalisation : job toujours en cours et dans le délai -> ligne inchangée (pas d'échec prématuré)", async () => {
  const runpod = fakeRunpodClient({ statusResponses: [{ status: "IN_PROGRESS" }] });
  const deps = baseDeps({ getRunpodClients: () => ({ runpodClient: runpod, volumeClient: fakeVolumeClient() }) });
  const created = await requestNoesVideo(deps, { ...BASE_REQUEST, questions: fakeQuestions() });
  const polled = await pollAndFinalizeNoesVideo(deps, created);
  assert.equal(polled.status, "processing");
});

test("finalisation : dépassement du timeout -> status failed, error_stage timeout", async () => {
  const runpod = fakeRunpodClient({ statusResponses: [{ status: "IN_PROGRESS" }] });
  const deps = baseDeps({ getRunpodClients: () => ({ runpodClient: runpod, volumeClient: fakeVolumeClient() }), config: { jobTimeoutMs: 1 } });
  const created = await requestNoesVideo(deps, { ...BASE_REQUEST, questions: fakeQuestions() });
  // Simule un job resté "processing" bien au-delà du timeout (updated_at ancien).
  const row = deps.supabase.__tables.noes_videos.rows.find((r) => r.id === created.id);
  row.updated_at = new Date(Date.now() - 60_000).toISOString();
  const polled = await pollAndFinalizeNoesVideo(deps, row);
  assert.equal(polled.status, "failed");
  assert.equal(polled.error_stage, "timeout");
});

// ── Protection contre une double finalisation (verrou optimiste) ───────────
test("deux finalisations concurrentes du même job COMPLETED -> une seule publication réelle", async () => {
  const supabase = fakeStorageSupabase(createSupabase());
  const volumeClient = fakeVolumeClient();
  const runpod = fakeRunpodClient({
    statusResponses: [
      { status: "COMPLETED", output: { output_file: "/runpod-volume/coeus/outputs/coeus_abc.mp4" } },
      { status: "COMPLETED", output: { output_file: "/runpod-volume/coeus/outputs/coeus_abc.mp4" } }
    ]
  });
  const deps = baseDeps({ supabase, getRunpodClients: () => ({ runpodClient: runpod, volumeClient }) });
  const created = await requestNoesVideo(deps, { ...BASE_REQUEST, questions: fakeQuestions() });
  // Comme la vraie route GET /status (server.js) : relit toujours l'état
  // frais avant de polleur, jamais l'objet renvoyé par la soumission (dont
  // updated_at devient obsolète dès que markNoesVideoProcessing écrit).
  const fresh = await noesRepositoryForTest.getNoesVideoById(supabase, created.id);

  const [a, b] = await Promise.all([
    pollAndFinalizeNoesVideo(deps, fresh),
    pollAndFinalizeNoesVideo(deps, fresh)
  ]);

  assert.equal(supabase.__uploadCalls.length, 1, "une seule publication storage malgré deux appels concurrents");
  const readyCount = [a.status, b.status].filter((s) => s === "ready").length;
  assert.ok(readyCount >= 1);
});
