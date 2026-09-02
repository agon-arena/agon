"use strict";

// Correctif du 02/09/2026 (robustesse Brave, diagnostic "Stoïcisme") :
// braveSearchRaw()/resolveWebSearchGrounding() distinguent désormais
// explicitement zero_results/timeout/http_error/network_error et retentent
// UNE fois sur les 3 dernières (jamais sur zero_results ni sur une erreur
// HTTP non récupérable) — cf. server.js. server.js démarre tout le serveur
// Express à l'import et ne peut donc pas être require()-é dans un test :
// braveSearchAttempt/braveSearchRaw sont extraites telles quelles du fichier
// source et exécutées dans un sandbox `vm`, avec `fetch` mocké et les
// helpers PURS réellement importés depuis lib/web-search-grounding.js (jamais
// dupliqués) — même technique que les autres tests de câblage de ce dépôt.
// Aucun appel réseau réel, aucun appel Brave/IA.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { buildBraveSearchUrl, normalizeBraveResults, WEB_SEARCH_RAW_RESULTS_COUNT } = require("../lib/web-search-grounding");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

function extract(startMarker, endMarker) {
  const start = SERVER_SOURCE.indexOf(startMarker);
  assert.ok(start >= 0, `marqueur de début introuvable : ${startMarker}`);
  const end = SERVER_SOURCE.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `marqueur de fin introuvable : ${endMarker}`);
  return SERVER_SOURCE.slice(start, end);
}

const BRAVE_SOURCE = extract(
  "const WEB_SEARCH_GROUNDING_TIMEOUT_MS = 12000;",
  "\nasync function resolveWebSearchGrounding("
);

function fakeResponse({ ok = true, status = 200, jsonBody = { web: { results: [] } } } = {}) {
  return { ok, status, json: async () => jsonBody };
}

function timeoutError() {
  const e = new Error("The operation was aborted due to timeout");
  e.name = "TimeoutError";
  return e;
}

function networkError() {
  const e = new TypeError("fetch failed");
  return e;
}

function makeSandbox(fetchImpl) {
  const calls = [];
  const sandbox = {
    console,
    AbortSignal, // réel, jamais mocké — le comportement du vrai timer n'est pas testé ici
    buildBraveSearchUrl,
    normalizeBraveResults,
    WEB_SEARCH_RAW_RESULTS_COUNT,
    fetch: async (...args) => {
      calls.push(args);
      return fetchImpl(calls.length);
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(BRAVE_SOURCE, sandbox);
  return { sandbox, calls };
}

const RESULT_A = { title: "Stoïcisme", url: "https://fr.wikipedia.org/wiki/Sto%C3%AFcisme", description: "École de philosophie hellénistique." };

// ── Le timeout est bien porté à 12000 ms ────────────────────────────────

test("WEB_SEARCH_GROUNDING_TIMEOUT_MS est porté à 12000 ms (était 8000)", () => {
  assert.match(SERVER_SOURCE, /const WEB_SEARCH_GROUNDING_TIMEOUT_MS = 12000;/);
});

// ── Chemin normal (réponse Brave réussie) : strictement inchangé ────────

test("réponse Brave réussie avec résultats : un seul appel fetch, résultats normalisés retournés tels quels, jamais de retry", async () => {
  const { sandbox, calls } = makeSandbox(() => fakeResponse({ jsonBody: { web: { results: [RESULT_A] } } }));
  const results = await sandbox.braveSearchRaw("Stoïcisme", "fake-key", "gen-1");
  assert.equal(calls.length, 1, "le chemin normal doit rester un seul appel réseau, jamais deux");
  assert.equal(results.length, 1);
  assert.equal(results[0].url, RESULT_A.url);
});

test("réponse Brave réussie avec 0 résultat (zero_results) : jamais de retry, tableau vide retourné", async () => {
  const { sandbox, calls } = makeSandbox(() => fakeResponse({ jsonBody: { web: { results: [] } } }));
  const results = await sandbox.braveSearchRaw("Un sujet obscur sans aucune source", "fake-key", "gen-2");
  assert.equal(calls.length, 1, "une réponse Brave valide à 0 résultat ne doit JAMAIS être retentée");
  assert.equal(results.length, 0);
});

// ── Retry sur timeout / erreur réseau / erreur HTTP récupérable ─────────

test("timeout (AbortSignal.timeout, error.name=TimeoutError) : une seule relance, succès au 2e essai", async () => {
  const { sandbox, calls } = makeSandbox((callIndex) => {
    if (callIndex === 1) throw timeoutError();
    return fakeResponse({ jsonBody: { web: { results: [RESULT_A] } } });
  });
  const results = await sandbox.braveSearchRaw("Stoïcisme", "fake-key", "gen-3");
  assert.equal(calls.length, 2, "un timeout doit déclencher exactement une relance");
  assert.equal(results.length, 1, "le résultat de la relance réussie doit être retourné");
});

test("erreur réseau (TypeError \"fetch failed\", jamais TimeoutError) : une seule relance, succès au 2e essai", async () => {
  const { sandbox, calls } = makeSandbox((callIndex) => {
    if (callIndex === 1) throw networkError();
    return fakeResponse({ jsonBody: { web: { results: [RESULT_A] } } });
  });
  const results = await sandbox.braveSearchRaw("Stoïcisme", "fake-key", "gen-4");
  assert.equal(calls.length, 2);
  assert.equal(results.length, 1);
});

for (const status of [500, 502, 503, 429]) {
  test(`erreur HTTP ${status} (récupérable) : une seule relance`, async () => {
    const { sandbox, calls } = makeSandbox((callIndex) => {
      if (callIndex === 1) return fakeResponse({ ok: false, status });
      return fakeResponse({ jsonBody: { web: { results: [RESULT_A] } } });
    });
    const results = await sandbox.braveSearchRaw("Stoïcisme", "fake-key", "gen-5");
    assert.equal(calls.length, 2, `HTTP ${status} doit être considéré récupérable et déclencher une relance`);
    assert.equal(results.length, 1);
  });
}

// ── Pas de retry sur une erreur HTTP non récupérable ─────────────────────

for (const status of [400, 401, 403, 404]) {
  test(`erreur HTTP ${status} (non récupérable) : jamais de relance, tableau vide`, async () => {
    const { sandbox, calls } = makeSandbox(() => fakeResponse({ ok: false, status }));
    const results = await sandbox.braveSearchRaw("Stoïcisme", "fake-key", "gen-6");
    assert.equal(calls.length, 1, `HTTP ${status} ne doit jamais déclencher de relance (même clé, même requête → échec identique garanti)`);
    assert.equal(results.length, 0);
  });
}

// ── Best-effort conservé après l'unique relance ──────────────────────────

test("timeout puis nouvel échec (2e tentative aussi en timeout) : tableau vide, jamais d'exception, jamais une 3e tentative", async () => {
  const { sandbox, calls } = makeSandbox(() => { throw timeoutError(); });
  const results = await sandbox.braveSearchRaw("Stoïcisme", "fake-key", "gen-7");
  assert.equal(calls.length, 2, "au plus 2 tentatives, jamais plus, même si la relance échoue aussi");
  assert.equal(results.length, 0);
});

// ── braveSearchAttempt directement : forme exacte des issues ────────────

test("braveSearchAttempt distingue explicitement timeout/network_error/http_error/zero_results", async () => {
  const { sandbox: sTimeout } = makeSandbox(() => { throw timeoutError(); });
  const timeoutResult = await sTimeout.braveSearchAttempt("Stoïcisme", "fake-key", "gen-9", 12000);
  assert.equal(timeoutResult.ok, false);
  assert.equal(timeoutResult.kind, "timeout");

  const { sandbox: sNetwork } = makeSandbox(() => { throw networkError(); });
  const networkResult = await sNetwork.braveSearchAttempt("Stoïcisme", "fake-key", "gen-10", 12000);
  assert.equal(networkResult.ok, false);
  assert.equal(networkResult.kind, "network_error");

  const { sandbox: sHttp } = makeSandbox(() => fakeResponse({ ok: false, status: 503 }));
  const httpResult = await sHttp.braveSearchAttempt("Stoïcisme", "fake-key", "gen-11", 12000);
  assert.equal(httpResult.ok, false);
  assert.equal(httpResult.kind, "http_error");
  assert.equal(httpResult.recoverable, true);

  const { sandbox: sHttp404 } = makeSandbox(() => fakeResponse({ ok: false, status: 404 }));
  const http404Result = await sHttp404.braveSearchAttempt("Stoïcisme", "fake-key", "gen-12", 12000);
  assert.equal(http404Result.recoverable, false);

  const { sandbox: sZero } = makeSandbox(() => fakeResponse({ jsonBody: { web: { results: [] } } }));
  const zeroResult = await sZero.braveSearchAttempt("Stoïcisme", "fake-key", "gen-13", 12000);
  assert.equal(zeroResult.ok, true);
  assert.deepEqual(zeroResult.results, []);
});

// ── Non-régression : scoring/seuils/domaines/priorité Wikipédia/V3.2 ─────
// intouchés (ce correctif ne concerne que braveSearchRaw/braveSearchAttempt) ─

test("MIN_QUALITY_THRESHOLD, les domaines exclus et la priorité Wikipédia ne sont pas modifiés par ce correctif", () => {
  assert.match(fs.readFileSync(path.join(__dirname, "..", "lib", "source-scoring.js"), "utf8"), /const MIN_QUALITY_THRESHOLD = 40;/);
  const groundingLib = fs.readFileSync(path.join(__dirname, "..", "lib", "web-search-grounding.js"), "utf8");
  assert.match(groundingLib, /EXCLUDED_GROUNDING_DOMAINS = new Set\(\[/);
  assert.match(groundingLib, /WIKIPEDIA_DOMAIN_PATTERN/);
  assert.match(groundingLib, /PRIORITÉ : si un résultat pointe vers une page Wikipédia/);
});

test("le nombre d'appels IA (web_search_source_selection) et V3.2 ne sont pas modifiés : toujours exactement 1 appel _callOpenAI dans resolveWebSearchGrounding", () => {
  const fnStart = SERVER_SOURCE.indexOf("async function resolveWebSearchGrounding(apiKey, subject, id) {");
  const fnEnd = SERVER_SOURCE.indexOf("\nasync function ", fnStart + 10);
  const fnBody = SERVER_SOURCE.slice(fnStart, fnEnd);
  const count = (fnBody.match(/await _callOpenAI\(apiKey,/g) || []).length;
  assert.equal(count, 1, "toujours un seul appel IA de sélection, jamais plus, malgré la relance Brave possible en amont");
});

test("braveSearchRaw reste appelé avec la même signature (query, braveKey, id) aux 3 sites d'appel existants", () => {
  const count = (SERVER_SOURCE.match(/await braveSearchRaw\((?:query|retryQuery), braveKey, id\)/g) || []).length;
  assert.equal(count, 3, "recherche initiale, relance ciblée d'autorité, et expansion V3.2 — aucun site d'appel ajouté ni retiré");
});
