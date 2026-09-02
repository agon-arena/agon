"use strict";

// Risque résiduel identifié lors du diagnostic de l'incident "Maoïsme" (02/09/2026, cf.
// test/apprentissage-timeout-false-error.test.js) : le second chemin de génération de QCM de
// notion — clic sur une pastille "Notions à mémoriser" d'un débat ou d'une carte accueil
// (activateDebateNotion, public/script.js) — souffrait de la même famille de bug que
// startCustomTopicGeneration (views/qcm-du-jour.html) AVANT son correctif "Marxisme"
// (01/09/2026) : un `.catch()` non discriminant traitait toute erreur (y compris une simple
// coupure réseau ou un timeout) comme un échec confirmé de la génération.
//
// Ici le risque est même plus systématique qu'ailleurs : ce chemin passe par `fetchJSON`
// (public/script.js), qui applique par défaut un AbortController à 12 secondes quand aucun
// `signal` n'est fourni — largement inférieur à une génération IA réelle de plusieurs minutes.
// Sans distinction, CE timeout client (jamais une preuve d'échec backend) déclenchait donc
// quasi systématiquement : effacement du marqueur persistant "en cours de création", message
// "échec" dans la modale d'explication, et retour du bouton à l'état "non mémorisé".
//
// Correctif (02/09/2026) : le `.catch()` ne traite plus comme un échec confirmé que le cas où
// fetchJSON a bien reçu une réponse HTTP avec un corps JSON exploitable de notre propre serveur
// (error.status ET error.code renseignés, cf. fetchJSON/fetchJSONOnce) — AbortError, coupure
// réseau, ou réponse non-JSON d'un intermédiaire externe restent ambigus : ni marqueur effacé,
// ni bouton réinitialisé, ni message d'échec. Le sondage global déjà existant
// (checkPendingNotionQuizzesReadiness, public/script.js) reste seul en charge de la suite.
//
// public/script.js ne peut pas être `require()` dans un test (fichier client, pas un module
// Node) : même principe que test/apprentissage-timeout-false-error.test.js — lecture du fichier
// comme texte brut, jamais exécuté, assertions sur la forme du code câblé.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const clientScript = fs.readFileSync(path.join(root, "public/script.js"), "utf8");

function sliceBetween(haystack, startMarker, endMarker, label) {
  const start = haystack.indexOf(startMarker);
  assert.ok(start >= 0, `marqueur de début introuvable (${label}) : ${startMarker}`);
  const end = haystack.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `marqueur de fin introuvable (${label}) : ${endMarker}`);
  return haystack.slice(start, end);
}

const activateDebateNotion = sliceBetween(
  clientScript,
  "function activateDebateNotion(btn, voterKey, debateId, quizDate) {",
  "function renderDebateNotions(debateId, debateQuestion, notions) {",
  "activateDebateNotion"
);
const catchBlock = sliceBetween(
  activateDebateNotion,
  ".catch((error) => {",
  "  });\n  });\n}",
  "catch de la génération"
);
const thenBlock = sliceBetween(
  activateDebateNotion,
  ".then(() => {",
  ".catch((error) => {",
  "then de la génération"
);

// ── fetchJSON : confirme la source exacte du timeout client (12s) ─────────

test("fetchJSON applique un AbortController à 12s quand aucun signal n'est fourni — bien inférieur à une génération IA réelle", () => {
  const fetchJSONOnce = sliceBetween(clientScript, "async function fetchJSONOnce(url, opt = {}) {", "\nfunction highlightVotedArgumentTitles()", "fetchJSONOnce");
  assert.match(fetchJSONOnce, /setTimeout\(\(\) => ctrl\.abort\(\), 12000\)/);
  // activateDebateNotion ne fournit pas de signal explicite à ce fetchJSON : il hérite donc
  // bien de ce timeout par défaut.
  assert.doesNotMatch(activateDebateNotion, /signal:/);
});

// ── Cas ambigu (timeout/coupure réseau) : jamais un échec définitif ────────

test("un cas ambigu (AbortError, coupure réseau, réponse non-JSON d'un intermédiaire) n'efface jamais le marqueur persistant", () => {
  assert.doesNotMatch(catchBlock.split("if (!confirmedFailure) return;")[0], /finishPendingNotionQuizGeneration/,
    "avant le tri confirmedFailure, aucun appel à finishPendingNotionQuizGeneration ne doit exister");
  const afterGuard = catchBlock.split("if (!confirmedFailure) return;")[1] || "";
  assert.match(afterGuard, /finishPendingNotionQuizGeneration\(pendingSlot\)/,
    "l'effacement du marqueur doit rester conditionné au tri confirmedFailure, jamais inconditionnel");
});

test("un cas ambigu ne réinitialise jamais le bouton en 'non mémorisé' ni ne retire is-active", () => {
  const beforeGuard = catchBlock.split("if (!confirmedFailure) return;")[0];
  assert.doesNotMatch(beforeGuard, /data-memorized/);
  assert.doesNotMatch(beforeGuard, /is-active/);
});

test("un cas ambigu n'affiche jamais explainer.failed()", () => {
  const beforeGuard = catchBlock.split("if (!confirmedFailure) return;")[0];
  assert.doesNotMatch(beforeGuard, /explainer\.failed\(\)/);
});

test("le tri distingue précisément l'échec confirmé (error.status ET error.code) de tout le reste", () => {
  assert.match(catchBlock, /const confirmedFailure = !!error && typeof error\.status === "number" && !!error\.code;/);
});

// ── Non-régression : un échec réellement confirmé reste un échec définitif ─

test("un échec réellement confirmé par le backend (error.status + error.code, réponse HTTP JSON exploitable) efface le marqueur, réinitialise le bouton et affiche l'échec", () => {
  const afterGuard = catchBlock.split("if (!confirmedFailure) return;")[1] || "";
  assert.match(afterGuard, /finishPendingNotionQuizGeneration\(pendingSlot\)/);
  assert.match(afterGuard, /explainer\.failed\(\)/);
  assert.match(afterGuard, /btn\.setAttribute\("data-memorized", "false"\)/);
  assert.match(afterGuard, /btn\.classList\.remove\("is-active"\)/);
});

// ── Non-régression : chemin de succès inchangé ─────────────────────────────

test("une génération réussie efface toujours le marqueur et affiche explainer.ready() (chemin inchangé)", () => {
  assert.match(thenBlock, /finishPendingNotionQuizGeneration\(pendingSlot\)/);
  assert.match(thenBlock, /explainer\.ready\(\)/);
});

// ── Le marqueur est écrit AVANT l'appel réseau (déjà correct, non touché) ──

test("le marqueur persistant est déjà écrit avant l'appel réseau, condition nécessaire pour que le sondage global le retrouve même en cas de timeout", () => {
  const markerIndex = activateDebateNotion.indexOf("startPendingNotionQuizGeneration({ slot: pendingSlot, label: notionName, quizDate });");
  const fetchIndex = activateDebateNotion.indexOf("fetchJSON(`${API}/users/notion-quizzes`");
  assert.ok(markerIndex >= 0 && fetchIndex > markerIndex, "startPendingNotionQuizGeneration doit précéder l'appel fetchJSON");
});

// ── Le sondage global existant reste la seule voie de résolution ultérieure ─

test("checkPendingNotionQuizzesReadiness (sondage global déjà existant) reste inchangé : ready/failed proviennent uniquement de generation-status, jamais d'une hypothèse locale", () => {
  const fn = sliceBetween(clientScript, "function checkPendingNotionQuizzesReadiness() {", "setInterval(checkPendingNotionQuizzesReadiness, 8000);", "checkPendingNotionQuizzesReadiness");
  assert.match(fn, /notion-quizzes\/generation-status/);
  assert.match(fn, /if \(readySlots\.has\(item\.slot\)\) \{\s*\n\s*finishPendingNotionQuizGeneration\(item\.slot\);\s*\n\s*showNotionQuizReadyAnnouncement\(item\.label\);\s*\n\s*\} else if \(failedSlots\.has\(item\.slot\)\) \{\s*\n\s*finishPendingNotionQuizGeneration\(item\.slot\);\s*\n\s*showNotionQuizFailedAnnouncement\(item\.label\);\s*\n\s*\}/);
  // Une erreur réseau pendant CE sondage ne doit pas non plus provoquer d'échec : simple
  // no-op, le prochain tick de l'intervalle (8s) retentera.
  assert.match(fn, /\.catch\(\(\) => \{\}\)/);
});
