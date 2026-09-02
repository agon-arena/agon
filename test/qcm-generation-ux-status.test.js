"use strict";

// Correctif UX du 02/09/2026 (incident "Maoïsme", suite du diagnostic read-only) :
// un échec réellement confirmé par le backend (notamment QCM_UNUSABLE) affichait
// bien un message rouge (setCustomSearchStatus(..., true)), mais celui-ci était
// effacé quasi instantanément par fetchLatestMesQcmList()/syncPendingNotionQuizGenerations
// appelés juste après — cf. views/qcm-du-jour.html. Corrigé en gardant tout état
// "is-error" déjà affiché à l'écran plutôt que de l'écraser aveuglément dès que la
// liste locale des générations en attente redevient vide.
//
// Ces fonctions vivent dans des <script> embarqués (views/qcm-du-jour.html,
// public/script.js), jamais require()-ables : même contrainte et même technique que
// test/knowledge-import-parent-identity.test.js — extraction du VRAI code source via
// `vm`, exécuté dans un sandbox avec un DOM minimal et un `fetch` mocké. Rien de la
// logique testée n'est dupliqué ici.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const VIEW_SOURCE = fs.readFileSync(path.join(__dirname, "..", "views", "qcm-du-jour.html"), "utf8");
const SCRIPT_SOURCE = fs.readFileSync(path.join(__dirname, "..", "public", "script.js"), "utf8");

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `marqueur de début introuvable : ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `marqueur de fin introuvable : ${endMarker}`);
  return source.slice(start, end);
}

// Bloc 1 : statut/sondage (setCustomSearchStatus, pie spinner, syncPendingNotionQuizGenerations,
// fetchLatestMesQcmList, refreshPendingNotionQuizList, schedulePendingNotionQuizPoll) — LE code
// corrigé par ce ticket.
const STATUS_AND_POLL_SOURCE = extract(
  VIEW_SOURCE,
  "function setCustomSearchStatus(text, isError) {",
  "\n  // Si la page d'origine reste vivante"
);
assert.match(STATUS_AND_POLL_SOURCE, /customSearchStatus\.classList\.contains\('is-error'\)/, "l'extrait doit couvrir le correctif du 02/09/2026 (garde is-error)");

// Bloc 2 : soumission directe de la recherche libre (startCustomTopicGeneration et ses trois
// branches then/invalidJson/catch), même fichier, plage contiguë juste après le bloc 1.
const CUSTOM_TOPIC_SOURCE = extract(
  VIEW_SOURCE,
  "function getCustomTopicPendingSlot(topic, level) {",
  "\n  function submitCustomTopic(e) {"
);

// Bloc 3 : activateDebateNotion (public/script.js) — chemin analogue "Mémoriser" sur une notion
// de débat, qui utilise fetchJSON (timeout client par défaut 12s) au lieu du fetch brut ci-dessus.
const ACTIVATE_DEBATE_NOTION_SOURCE = extract(
  SCRIPT_SOURCE,
  "function activateDebateNotion(btn, voterKey, debateId, quizDate) {",
  "\nfunction renderDebateNotions("
);

function makeFakeElement(overrides = {}) {
  const classes = new Set();
  const attrs = new Map();
  return Object.assign({
    hidden: true,
    textContent: "",
    value: "",
    disabled: false,
    style: {},
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      toggle(c, on) { if (on) classes.add(c); else classes.delete(c); },
      contains(c) { return classes.has(c); }
    },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    addEventListener() {},
    appendChild() {}
  }, overrides);
}

// ── Sandbox pour les blocs 1 + 2 (views/qcm-du-jour.html) ──────────────────

function makeQcmDuJourSandbox({ currentCategory = "mesqcm", currentSlot = null } = {}) {
  const calls = { mnoriaFinish: [], mnoriaStart: [], renderMesQcmList: [], loadSlot: [], showNotionQuizReadyModal: [] };
  let pendingRows = [];

  const customSearchStatus = makeFakeElement();
  const customSearchBtn = makeFakeElement({ disabled: false });
  const customSearchInput = makeFakeElement({ value: "" });

  const sandbox = {
    console,
    document: {
      getElementById() { return makeFakeElement({ hidden: true }); }
    },
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    crypto: require("crypto").webcrypto,
    TextEncoder,

    voterKey: "test-voter-key",
    currentCategory,
    currentSlot,
    customSearchGenerationActive: false,
    customTopicGenerationLabel: "",
    currentMesQcmQuizzes: [],
    pendingNotionQuizStatusVisible: false,
    pendingNotionQuizPollId: null,

    customSearchStatus,
    customSearchBtn,
    customSearchInput,

    showNotionQuizLevelPicker(onSelect) { onSelect("avance"); },
    showGenerateConfirmModal(topic, level, onConfirm) { onConfirm(); },
    closeAiGenerateModal() {},
    renderMesQcmList(quizzes) { calls.renderMesQcmList.push(quizzes); },
    loadSlot(...args) { calls.loadSlot.push(args); },
    showNotionQuizReadyModal(...args) { calls.showNotionQuizReadyModal.push(args); },

    mnoriaGetPendingNotionQuizGenerations() { return pendingRows.slice(); },
    mnoriaStartPendingNotionQuizGeneration(row) {
      calls.mnoriaStart.push(row);
      pendingRows = pendingRows.filter((r) => r.slot !== row.slot).concat([row]);
    },
    mnoriaFinishPendingNotionQuizGeneration(slot) {
      calls.mnoriaFinish.push(slot);
      pendingRows = pendingRows.filter((r) => r.slot !== slot);
    },

    fetch: undefined // fourni par chaque test
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(STATUS_AND_POLL_SOURCE, sandbox);
  vm.runInContext(CUSTOM_TOPIC_SOURCE, sandbox);

  return {
    sandbox,
    calls,
    seedPending(row) { pendingRows.push(row); },
    getPending() { return pendingRows.slice(); }
  };
}

function fakeResponse({ status = 200, text, jsonBody }) {
  return {
    status,
    text: async () => (text !== undefined ? text : JSON.stringify(jsonBody)),
    json: async () => (jsonBody !== undefined ? jsonBody : JSON.parse(text))
  };
}

// ── 1. Succès normal (startCustomTopicGeneration) ──────────────────────────

test("succès normal : la réponse ok efface le marqueur, ferme le statut sans erreur, ouvre le QCM", async () => {
  const { sandbox, calls } = makeQcmDuJourSandbox();
  sandbox.fetch = async (url) => {
    assert.equal(url, "/api/users/notion-quizzes/custom");
    return fakeResponse({ jsonBody: { ok: true, slot: "notion:custom:abc", quizDate: "2026-09-02", label: "Maoïsme", questionCount: 18 } });
  };

  await sandbox.startCustomTopicGeneration("Maoïsme");
  // Attend la chaîne de promesses interne (then/then) sans dépendre d'un timer réel.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(calls.mnoriaFinish.length, 1, "le marqueur en cours doit être retiré sur un vrai succès");
  assert.equal(sandbox.customSearchStatus.classList.contains("is-error"), false);
  assert.equal(sandbox.customSearchStatus.textContent, "");
  assert.equal(calls.loadSlot.length, 1);
  assert.equal(calls.showNotionQuizReadyModal.length, 1);
});

// ── 2. Timeout / coupure réseau sur la requête initiale : pas de faux rouge, pending conservé ──

test("timeout/coupure réseau (fetch rejette) : pas de message rouge, marqueur en cours conservé", async () => {
  const { sandbox, calls } = makeQcmDuJourSandbox({ currentCategory: "debats" });
  sandbox.fetch = async () => { throw new TypeError("Failed to fetch"); };

  await sandbox.startCustomTopicGeneration("Maoïsme");
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(calls.mnoriaFinish.length, 0, "le marqueur ne doit jamais être retiré sur un simple échec réseau/timeout client");
  assert.equal(sandbox.customSearchStatus.classList.contains("is-error"), false, "jamais de message rouge sur un état inconnu");
  assert.match(sandbox.customSearchStatus.textContent, /toujours en cours en arrière-plan/i);
});

// ── 3. Réponse proxy non JSON : pas de faux rouge, pending conservé ─────────

test("réponse HTTP illisible (proxy/timeout serveur) : pas de message rouge, marqueur en cours conservé", async () => {
  const { sandbox, calls } = makeQcmDuJourSandbox({ currentCategory: "debats" });
  sandbox.fetch = async () => fakeResponse({ status: 502, text: "<html>Bad Gateway</html>" });

  await sandbox.startCustomTopicGeneration("Maoïsme");
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(calls.mnoriaFinish.length, 0, "un corps illisible ne prouve jamais un échec applicatif réel");
  assert.equal(sandbox.customSearchStatus.classList.contains("is-error"), false);
  assert.match(sandbox.customSearchStatus.textContent, /toujours en cours en arrière-plan/i);
});

// ── 6 (variante directe). Échec confirmé par la réponse directe (QCM_UNUSABLE) : erreur visible,
// marqueur retiré, ET non effacée par une synchronisation ultérieure ──────────────────────────

test("échec confirmé en direct (QCM_UNUSABLE) : message rouge affiché, marqueur retiré, jamais effacé par une synchro suivante", async () => {
  const { sandbox, calls } = makeQcmDuJourSandbox();
  sandbox.fetch = async () => fakeResponse({ jsonBody: { ok: false, code: "QCM_UNUSABLE", error: "échec" } });

  await sandbox.startCustomTopicGeneration("Maoïsme");
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(calls.mnoriaFinish.length, 1, "un échec confirmé doit retirer le marqueur en cours");
  assert.equal(sandbox.customSearchStatus.classList.contains("is-error"), true);
  assert.match(sandbox.customSearchStatus.textContent, /questions n.{1,3}ont pas pu être validées/);

  // Simule une synchronisation ultérieure quelconque (autre poll, autre onglet...) : ne doit
  // JAMAIS effacer le message d'échec qu'on vient d'afficher — c'est le bug corrigé.
  sandbox.syncPendingNotionQuizGenerations([]);
  assert.equal(sandbox.customSearchStatus.classList.contains("is-error"), true, "l'échec confirmé doit rester visible après une synchro ultérieure");
  assert.match(sandbox.customSearchStatus.textContent, /questions n.{1,3}ont pas pu être validées/);
});

// ── 4. Polling : pending → attente maintenue ────────────────────────────────

test("polling generation-status : ni ready ni failed → le message \"en cours\" reste affiché, rien n'est retiré", async () => {
  const { sandbox, calls, seedPending } = makeQcmDuJourSandbox();
  seedPending({ slot: "notion:custom:abc", label: "Maoïsme", startedAt: Date.now() });
  sandbox.pendingNotionQuizStatusVisible = true;

  sandbox.fetch = async (url) => {
    assert.match(url, /generation-status/);
    return fakeResponse({ jsonBody: { ready: [], failed: [] } });
  };

  sandbox.refreshPendingNotionQuizList(false);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(calls.mnoriaFinish.length, 0);
  assert.equal(sandbox.customSearchStatus.classList.contains("is-error"), false);
  assert.match(sandbox.customSearchStatus.textContent, /en cours/i);
});

// ── 5. Polling : ready → succès ──────────────────────────────────────────────

test("polling generation-status : ready → marqueur retiré, statut nettoyé sans erreur", async () => {
  const { sandbox, calls, seedPending } = makeQcmDuJourSandbox();
  const slot = "notion:custom:abc";
  seedPending({ slot, label: "Maoïsme", startedAt: Date.now() });
  sandbox.pendingNotionQuizStatusVisible = true;

  sandbox.fetch = async (url) => {
    if (/generation-status/.test(url)) return fakeResponse({ jsonBody: { ready: [{ slot, quizDate: "2026-09-02" }], failed: [] } });
    if (/\/api\/users\/notion-quizzes\?/.test(url)) return fakeResponse({ jsonBody: { quizzes: [] } });
    throw new Error("URL inattendue : " + url);
  };

  sandbox.refreshPendingNotionQuizList(false);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(calls.mnoriaFinish, [slot]);
  assert.equal(sandbox.customSearchStatus.classList.contains("is-error"), false);
  assert.equal(sandbox.customSearchStatus.textContent, "", "plus rien en attente et pas d'erreur : le statut doit bien se vider (comportement historique préservé)");
});

// ── 6. Polling : failed/QCM_UNUSABLE → erreur réellement visible et non immédiatement effacée ──

test("polling generation-status : failed QCM_UNUSABLE → message rouge affiché ET toujours visible après fetchLatestMesQcmList (bug \"Maoïsme\" corrigé)", async () => {
  const { sandbox, calls, seedPending } = makeQcmDuJourSandbox();
  const slot = "notion:custom:cd197b1ab8bb20fa";
  seedPending({ slot, label: "Maoïsme", startedAt: Date.now() });
  sandbox.pendingNotionQuizStatusVisible = true;

  sandbox.fetch = async (url) => {
    if (/generation-status/.test(url)) return fakeResponse({ jsonBody: { ready: [], failed: [{ slot, code: "QCM_UNUSABLE" }] } });
    if (/\/api\/users\/notion-quizzes\?/.test(url)) return fakeResponse({ jsonBody: { quizzes: [] } });
    throw new Error("URL inattendue : " + url);
  };

  sandbox.refreshPendingNotionQuizList(false);
  // Laisse tourner toute la chaîne de promesses (poll -> failed.forEach -> fetchLatestMesQcmList
  // -> syncPendingNotionQuizGenerations), exactement le déroulé qui effaçait le message avant le
  // correctif.
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));

  assert.deepEqual(calls.mnoriaFinish, [slot], "l'échec confirmé retire bien le marqueur en cours");
  assert.equal(sandbox.customSearchStatus.classList.contains("is-error"), true, "le message d'échec doit rester affiché après la synchronisation qui le suit");
  assert.match(sandbox.customSearchStatus.textContent, /questions n.{1,3}ont pas pu être validées/);
});

// ── Bloc 3 : activateDebateNotion (public/script.js) — même principe ────────

function makeActivateDebateNotionSandbox() {
  const calls = { start: [], finish: [], ready: [], failed: [] };
  const btn = makeFakeElement();
  btn.setAttribute("data-notion-slug", "notion-slug");

  const sandbox = {
    console,
    API: "",
    showNotionQuizLevelPicker(onSelect) { onSelect("avance"); },
    startPendingNotionQuizGeneration(row) { calls.start.push(row); },
    finishPendingNotionQuizGeneration(slot) { calls.finish.push(slot); },
    showDebateNotionMemorizeExplainer() {
      return {
        ready: () => calls.ready.push(true),
        failed: () => calls.failed.push(true)
      };
    },
    fetchJSON: undefined // fourni par chaque test
  };
  vm.createContext(sandbox);
  vm.runInContext(ACTIVATE_DEBATE_NOTION_SOURCE, sandbox);
  return { sandbox, calls, btn };
}

test("activateDebateNotion — succès : marqueur retiré, explainer.ready()", async () => {
  const { sandbox, calls, btn } = makeActivateDebateNotionSandbox();
  sandbox.fetchJSON = async () => ({ ok: true });

  sandbox.activateDebateNotion(btn, "voter-key", "debate-1", "2026-09-02");
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(calls.finish.length, 1);
  assert.deepEqual(calls.ready, [true]);
  assert.equal(calls.failed.length, 0);
});

test("activateDebateNotion — coupure réseau/timeout (pas de error.status) : jamais assimilé à un échec confirmé", async () => {
  const { sandbox, calls, btn } = makeActivateDebateNotionSandbox();
  const abortError = new Error("The user aborted a request.");
  abortError.name = "AbortError"; // fetchJSONOnce : timeout client par défaut de 12s
  sandbox.fetchJSON = async () => { throw abortError; };

  sandbox.activateDebateNotion(btn, "voter-key", "debate-1", "2026-09-02");
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(calls.finish.length, 0, "le marqueur en cours ne doit pas être retiré sur un état inconnu");
  assert.equal(calls.failed.length, 0, "explainer.failed() ne doit pas être appelé sur un état inconnu");
  // "true" posé de manière optimiste au tout début (avant même l'appel réseau) : sur un état
  // inconnu, il ne doit surtout pas être remis à "false" (ce qui redonnerait la main à l'utilisateur
  // pour relancer une génération peut-être déjà en cours côté serveur).
  assert.equal(btn.getAttribute("data-memorized"), "true", "le bouton ne doit jamais être remis à false sur un état inconnu");
});

test("activateDebateNotion — échec confirmé par une vraie réponse HTTP d'erreur (error.status + error.code) : marqueur retiré, explainer.failed()", async () => {
  const { sandbox, calls, btn } = makeActivateDebateNotionSandbox();
  const httpError = new Error("Erreur serveur");
  httpError.status = 500;
  httpError.code = "AI_UNAVAILABLE";
  sandbox.fetchJSON = async () => { throw httpError; };

  sandbox.activateDebateNotion(btn, "voter-key", "debate-1", "2026-09-02");
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(calls.finish.length, 1, "un échec confirmé par une vraie réponse HTTP doit retirer le marqueur");
  assert.deepEqual(calls.failed, [true]);
  assert.equal(calls.ready.length, 0);
});
