"use strict";

// Correctif UX du 01/09/2026 (incident "Marxisme") : une génération QCM
// "sujet libre" avec gpt-5.6-luna peut prendre 4 à 6 minutes. Le backend
// termine correctement et crée le QCM, mais un intermédiaire réseau (proxy
// Render...) coupe la connexion du fetch initial bien avant — le frontend
// affichait alors un faux message d'échec ("la génération peut avoir été
// stoppée"), alors que le backend continuait et a fini par produire 16
// questions. Ces tests couvrent les 4 scénarios demandés :
//   1. génération rapide réussie ;
//   2. génération longue toujours pending/processing après expiration de la
//      requête initiale ;
//   3. génération longue qui finit par ready ;
//   4. vraie génération failed.
//
// Convention de ce dépôt (cf. test/custom-topic-generation-wiring.test.js) :
// server.js et les vues ne sont pas bootables isolément (Express + Supabase +
// navigateur réels) — les scénarios 1 à 3 sont donc vérifiés au niveau
// structurel (assertions sur le code source), comme le reste de la suite ;
// seul lib/notion-quiz-generation-failures.js (module autonome) est testé en
// unitaire réel, avec un faux client Supabase sur le modèle de
// test/ai-usage-log.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  recordNotionQuizGenerationFailure,
  fetchRecentNotionQuizFailures
} = require("../lib/notion-quiz-generation-failures");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const view = fs.readFileSync(path.join(root, "views/qcm-du-jour.html"), "utf8");
const script = fs.readFileSync(path.join(root, "public/script.js"), "utf8");

// Faux client Supabase couvrant .from(table).insert(row) et
// .from(table).select(...).in(...).gte(...).order(...), sur le modèle de
// createFakeSupabase dans test/ai-usage-log.test.js / test/data-retention.test.js.
function createFakeSupabase({ rows = [], insertError = null, selectError = null } = {}) {
  const inserted = [];
  return {
    inserted,
    from(table) {
      return {
        insert(row) {
          inserted.push({ table, row });
          return Promise.resolve({ error: insertError });
        },
        select() {
          return {
            in(_col, identities) {
              return {
                gte(_col2, cutoffIso) {
                  return {
                    order() {
                      if (selectError) return Promise.resolve({ data: null, error: selectError });
                      const data = rows
                        .filter((r) => identities.includes(r.identity) && r.created_at >= cutoffIso)
                        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
                      return Promise.resolve({ data, error: null });
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  };
}

// ─── Scénario 4 (vraie génération failed) : lib/notion-quiz-generation-failures ───

test("recordNotionQuizGenerationFailure — insertion réussie avec identity/code/reason", async () => {
  const supabase = createFakeSupabase();
  await recordNotionQuizGenerationFailure(supabase, {
    identity: "notion:custom:abc123",
    code: "CONTENT_UNUSABLE",
    reason: "Le contenu généré n'a pas pu être exploité."
  });
  assert.equal(supabase.inserted.length, 1);
  const row = supabase.inserted[0];
  assert.equal(row.table, "notion_quiz_generation_failures");
  assert.equal(row.row.identity, "notion:custom:abc123");
  assert.equal(row.row.code, "CONTENT_UNUSABLE");
  assert.equal(row.row.reason, "Le contenu généré n'a pas pu être exploité.");
});

test("recordNotionQuizGenerationFailure — identity absente : no-op silencieux, aucun insert", async () => {
  const supabase = createFakeSupabase();
  await recordNotionQuizGenerationFailure(supabase, { code: "AI_TIMEOUT" });
  assert.equal(supabase.inserted.length, 0);
});

test("recordNotionQuizGenerationFailure — supabase absent ou erreur d'insertion : jamais d'exception", async () => {
  await assert.doesNotReject(() => recordNotionQuizGenerationFailure(null, { identity: "x", code: "AI_TIMEOUT" }));
  const throwingSupabase = { from() { throw new Error("boom"); } };
  await assert.doesNotReject(() => recordNotionQuizGenerationFailure(throwingSupabase, { identity: "x", code: "AI_TIMEOUT" }));
  const erroringSupabase = createFakeSupabase({ insertError: { message: "relation manquante" } });
  await assert.doesNotReject(() => recordNotionQuizGenerationFailure(erroringSupabase, { identity: "x", code: "AI_TIMEOUT" }));
});

test("fetchRecentNotionQuizFailures — retrouve le dernier échec par identité, jamais un plus ancien", async () => {
  const now = Date.now();
  const supabase = createFakeSupabase({
    rows: [
      { identity: "notion:custom:abc123", code: "AI_TIMEOUT", reason: "ancien", created_at: new Date(now - 5 * 60 * 1000).toISOString() },
      { identity: "notion:custom:abc123", code: "CONTENT_UNUSABLE", reason: "récent", created_at: new Date(now - 1 * 60 * 1000).toISOString() }
    ]
  });
  const failures = await fetchRecentNotionQuizFailures(supabase, ["notion:custom:abc123"]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, "CONTENT_UNUSABLE");
});

test("fetchRecentNotionQuizFailures — un échec hors fenêtre de rétention n'est jamais renvoyé", async () => {
  const now = Date.now();
  const supabase = createFakeSupabase({
    rows: [
      { identity: "notion:custom:old", code: "AI_TIMEOUT", reason: "trop ancien", created_at: new Date(now - 60 * 60 * 1000).toISOString() }
    ]
  });
  const failures = await fetchRecentNotionQuizFailures(supabase, ["notion:custom:old"], { lookbackMs: 20 * 60 * 1000 });
  assert.equal(failures.length, 0);
});

test("fetchRecentNotionQuizFailures — identités vides, supabase absent ou erreur de lecture : jamais d'exception, tableau vide", async () => {
  assert.deepEqual(await fetchRecentNotionQuizFailures(null, ["x"]), []);
  assert.deepEqual(await fetchRecentNotionQuizFailures(createFakeSupabase(), []), []);
  const throwingSupabase = { from() { throw new Error("boom"); } };
  assert.deepEqual(await fetchRecentNotionQuizFailures(throwingSupabase, ["x"]), []);
  const erroringSupabase = createFakeSupabase({ selectError: { message: "timeout" } });
  assert.deepEqual(await fetchRecentNotionQuizFailures(erroringSupabase, ["x"]), []);
});

// ─── Scénario 4 (suite) : la route enregistre bien l'échec, aux deux points de sortie ───

test("POST .../custom enregistre l'échec IA (result.error) avec l'identité masterSlot, jamais la clé API ni des tokens", () => {
  const routeStart = server.indexOf('app.post("/api/users/notion-quizzes/custom"');
  const routeEnd = server.indexOf("\n});", routeStart) + 4;
  const route = server.slice(routeStart, routeEnd);
  assert.match(route, /recordNotionQuizGenerationFailure\(supabase, \{ identity: masterSlot, code: publicError\.body\.code, reason: result\.reason \}\)/);
  assert.match(route, /let masterSlotForFailureTracking = null;/);
  assert.match(route, /masterSlotForFailureTracking = masterSlot;/);
  assert.match(route, /recordNotionQuizGenerationFailure\(supabase, \{ identity: masterSlotForFailureTracking, code: "STORAGE_TEMPORARY", reason: error\.message \}\)/);
  // Jamais awaité (même règle que recordAiUsage) : une panne de cette
  // télémétrie ne doit jamais retarder la réponse d'erreur déjà construite.
  assert.doesNotMatch(route, /await recordNotionQuizGenerationFailure/);
});

test("le module de suivi des échecs est bien importé dans server.js", () => {
  assert.match(server, /require\("\.\/lib\/notion-quiz-generation-failures"\)/);
  assert.match(server, /recordNotionQuizGenerationFailure, fetchRecentNotionQuizFailures/);
});

// ─── Scénario 3 (ready) & 4 (failed) : GET generation-status ───

test("generation-status renvoie { ready, failed } même quand il n'y a rien à signaler", () => {
  const routeStart = server.indexOf('app.get("/api/users/notion-quizzes/generation-status"');
  const routeEnd = server.indexOf('app.get("/api/users/notion-quizzes",', routeStart);
  const route = server.slice(routeStart, routeEnd);
  assert.match(route, /res\.json\(\{ ready: \[\], failed: \[\] \}\)/);
  assert.match(route, /res\.status\(400\)\.json\(\{ ready: \[\], failed: \[\], error: validation\.error \}\)/);
});

test("generation-status : un échec ne peut jamais masquer un slot devenu ready (ready prioritaire)", () => {
  const routeStart = server.indexOf('app.get("/api/users/notion-quizzes/generation-status"');
  const routeEnd = server.indexOf('app.get("/api/users/notion-quizzes",', routeStart);
  const route = server.slice(routeStart, routeEnd);
  assert.match(route, /const readySlots = new Set\(ready\.map\(\(row\) => row\.slot\)\);/);
  assert.match(route, /pendingSlots = slots\.filter\(\(slot\) => !readySlots\.has\(slot\)\)/);
  assert.match(route, /fetchRecentNotionQuizFailures\(supabase, failureIdentities\)/);
  assert.match(route, /res\.json\(\{ ready, failed \}\);/);
});

test("generation-status détecte uniquement un pending ancien devenu orphelin", () => {
  const routeStart = server.indexOf('app.get("/api/users/notion-quizzes/generation-status"');
  const routeEnd = server.indexOf('app.get("/api/users/notion-quizzes",', routeStart);
  const route = server.slice(routeStart, routeEnd);
  assert.match(route, /startedAtBySlot/);
  assert.match(route, /_notionQuizMasterGenerationPromises\.has\(identity\)/);
  assert.match(route, /\.from\("daily_quiz"\)[\s\S]*?\.select\("slot"\)/);
  assert.match(route, /failureExists: failureByIdentity\.has\(identity\)/);
  assert.match(route, /code: "GENERATION_INTERRUPTED"/);
  assert.match(route, /recordNotionQuizGenerationFailure/);
});

test("les deux pollings transmettent le startedAt persistant au backend", () => {
  assert.match(view, /&startedAt=' \+ encodeURIComponent\(startedAt\)/);
  assert.match(script, /&startedAt=\$\{encodeURIComponent\(startedAtParam\)\}/);
});

// ─── Scénario 1 (rapide réussie) : le chemin succès n'est pas touché ───

test("le chemin de succès de POST .../custom est inchangé", () => {
  assert.match(server, /res\.json\(\{ ok: true, slot: effectiveSlot, quizDate, label: questions\[0\]\?\.sourceName \|\| null, questionCount: questions\.length, reused \}\)/);
});

test("le frontend traite toujours une réponse ok:true en fermant le statut et en ouvrant le QCM", () => {
  assert.match(view, /if \(!result\.data\.ok\) \{/);
  assert.match(view, /loadSlot\(result\.data\.slot, result\.data\.quizDate, result\.data\.label\)/);
  assert.match(view, /showNotionQuizReadyModal\(result\.data\.label \|\| topic, result\.data\.questionCount\)/);
});

// ─── Scénario 2 (toujours pending après expiration de la requête initiale) ───

test("une coupure réseau sur le fetch initial n'affiche plus un message d'échec et conserve le marqueur persistant", () => {
  const catchStart = view.indexOf(".catch(function () {", view.indexOf("fetch('/api/users/notion-quizzes/custom'"));
  const catchEnd = view.indexOf("          });", catchStart);
  const catchBody = view.slice(catchStart, catchEnd);
  // Le marqueur persistant (localStorage) n'est jamais retiré ici : seul le
  // sondage generation-status doit décider de ready/failed.
  assert.doesNotMatch(catchBody, /mnoriaFinishPendingNotionQuizGeneration/);
  // Plus aucun message affiché à l'utilisateur (setCustomSearchStatus) ne
  // doit laisser croire à un échec probable, ni être stylé en erreur — seuls
  // les commentaires de code peuvent légitimement mentionner "échec" pour
  // expliquer pourquoi ce n'en est justement pas un.
  const statusCalls = catchBody.match(/setCustomSearchStatus\([^;]*\);/g) || [];
  assert.ok(statusCalls.length >= 1, "au moins un appel à setCustomSearchStatus attendu");
  for (const call of statusCalls) {
    assert.doesNotMatch(call, /stoppée|a été interrompue|échoué|échec/i);
    assert.doesNotMatch(call, /,\s*true\)/, "ne doit jamais être stylé comme une erreur (isError=true)");
  }
  assert.match(catchBody, /toujours en cours en arrière-plan/);
  // Reprend immédiatement le sondage plutôt que d'attendre le prochain tick.
  assert.match(catchBody, /refreshPendingNotionQuizList\(true\)/);
});

test("une génération déjà suivie pour le même sujet+niveau ne peut plus être relancée en double", () => {
  const confirmStart = view.indexOf("showGenerateConfirmModal(topic, level, async function () {");
  const fetchStart = view.indexOf("fetch('/api/users/notion-quizzes/custom'", confirmStart);
  const guardBlock = view.slice(confirmStart, fetchStart);
  assert.match(guardBlock, /getPendingNotionQuizGenerations\(\)\.some\(function \(item\) \{\s*return item\.slot === pendingCustomSlot;/);
  assert.match(guardBlock, /déjà en cours/);
  // La garde doit court-circuiter AVANT le POST, jamais après.
  assert.ok(guardBlock.indexOf("return;") < guardBlock.indexOf("customSearchGenerationActive = true;"));
});

// ─── Scénario 3 (ready) & 4 (failed), câblage des deux boucles de sondage existantes ───

test("refreshPendingNotionQuizList (sondage propre à la page) distingue ready et failed", () => {
  const fnStart = view.indexOf("function refreshPendingNotionQuizList(forceListRefresh) {");
  const fnEnd = view.indexOf("\n  function schedulePendingNotionQuizPoll", fnStart);
  const fn = view.slice(fnStart, fnEnd);
  assert.match(fn, /var failed = Array\.isArray\(data\.failed\) \? data\.failed : \[\];/);
  assert.match(fn, /if \(!ready\.length && !failed\.length\) \{/);
  assert.match(fn, /failed\.forEach\(function \(item\) \{/);
  assert.match(fn, /setCustomSearchStatus\(customGenerationErrorMessage\(item\.code\), true\)/);
});

test("checkPendingNotionQuizzesReadiness (sondage global cross-page) distingue ready et failed", () => {
  const fnStart = script.indexOf("function checkPendingNotionQuizzesReadiness()");
  const fnEnd = script.indexOf("\nsetInterval(checkPendingNotionQuizzesReadiness", fnStart);
  const fn = script.slice(fnStart, fnEnd);
  assert.match(fn, /const failedSlots = new Set\(\(data\.failed \|\| \[\]\)\.map\(\(row\) => row\.slot\)\);/);
  assert.match(fn, /showNotionQuizFailedAnnouncement\(item\.label\)/);
  assert.match(script, /function showNotionQuizFailedAnnouncement\(label\)/);
});

test("customGenerationErrorMessage est défini une seule fois, au niveau module (réutilisable par le sondage)", () => {
  const occurrences = view.match(/function customGenerationErrorMessage\(code, fallback\)/g) || [];
  assert.equal(occurrences.length, 1);
});
