"use strict";

// Rendu frontend des highlights de fiche (Phase 2.4, 04/09/2026) — même
// technique que test/qcm-generation-ux-status.test.js : escapeHtml/
// renderFicheSectionText vivent dans un <script> embarqué de
// views/qcm-du-jour.html, jamais require()-ables — extraction du VRAI code
// source via `vm`, exécuté avec un DOM minimal qui reproduit fidèlement la
// sémantique réelle d'un navigateur (textContent -> innerHTML échappe
// &/</>, jamais les guillemets, cf. commentaire de fakeEscapeHtmlText).
// Objectif principal de ce fichier : prouver qu'aucune chaîne fournie par
// Luna (texte de section OU expression de highlight) ne peut jamais devenir
// du HTML exécutable — seules nos propres balises <strong>, ajoutées après
// échappement, existent dans la sortie.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const VIEW_SOURCE = fs.readFileSync(path.join(__dirname, "..", "views", "qcm-du-jour.html"), "utf8");

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `marqueur de début introuvable : ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `marqueur de fin introuvable : ${endMarker}`);
  return source.slice(start, end);
}

const RENDER_SOURCE = extract(
  VIEW_SOURCE,
  "function escapeHtml(str) {",
  "\n  function renderMessage(text) {"
);

// Reproduit fidèlement la sémantique réelle du navigateur pour
// `div.textContent = x; div.innerHTML` sur un nœud de texte pur : &, < et >
// sont échappés, les guillemets ne le sont JAMAIS dans ce contexte (ce
// n'est pas un attribut) — un fake trop permissif OU trop strict fausserait
// le test, d'où cette reproduction précise plutôt qu'un escape générique.
function fakeEscapeHtmlText(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function makeSandbox() {
  const sandbox = {
    document: {
      createElement() {
        const el = { _html: "" };
        Object.defineProperty(el, "textContent", {
          set(value) { el._html = fakeEscapeHtmlText(value); },
          get() { return el._html; }
        });
        Object.defineProperty(el, "innerHTML", { get() { return el._html; } });
        return el;
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(RENDER_SOURCE, sandbox);
  return sandbox;
}

test("escapeHtml (référence) échappe &, < et >, jamais les guillemets", () => {
  const sandbox = makeSandbox();
  assert.equal(sandbox.escapeHtml('<script>alert(1)</script> & "quote"'), '&lt;script&gt;alert(1)&lt;/script&gt; &amp; "quote"');
});

test("renderFicheSectionText : sans highlights, rendu identique à escapeHtml(text) seul (repli legacy)", () => {
  const sandbox = makeSandbox();
  const text = "Justinien règne de 527 à 565.";
  assert.equal(sandbox.renderFicheSectionText(text, undefined), sandbox.escapeHtml(text));
  assert.equal(sandbox.renderFicheSectionText(text, null), sandbox.escapeHtml(text));
  assert.equal(sandbox.renderFicheSectionText(text, []), sandbox.escapeHtml(text));
});

test("renderFicheSectionText : un highlight valide est entouré de <strong>, le reste du texte reste échappé normalement", () => {
  const sandbox = makeSandbox();
  const text = "Justinien règne de 527 à 565.";
  const html = sandbox.renderFicheSectionText(text, [{ knowledgeTargetId: "k1", start: 0, end: 9 }]);
  assert.equal(html, "<strong>Justinien</strong> règne de 527 à 565.");
});

test("renderFicheSectionText : plusieurs highlights non chevauchants sont tous rendus, dans l'ordre du texte", () => {
  const sandbox = makeSandbox();
  const text = "Justinien règne de 527 à 565.";
  const html = sandbox.renderFicheSectionText(text, [
    { knowledgeTargetId: "k1", start: 19, end: 28 },
    { knowledgeTargetId: "k1", start: 0, end: 9 }
  ]);
  assert.equal(html, "<strong>Justinien</strong> règne de <strong>527 à 565</strong>.");
});

test("SÉCURITÉ XSS : un highlight ne peut jamais faire apparaître de balise exécutable — le contenu de la section ET celui du highlight restent échappés, seules nos balises <strong> sont du vrai HTML", () => {
  const sandbox = makeSandbox();
  const text = "Voici <img src=x onerror=alert(1)> un texte piégé.";
  // Le highlight porte lui-même sur la partie malveillante : même dans ce
  // cas, le contenu à l'intérieur de <strong> doit rester échappé.
  const html = sandbox.renderFicheSectionText(text, [{ knowledgeTargetId: "k1", start: 6, end: 34 }]);
  assert.equal(html, "Voici <strong>&lt;img src=x onerror=alert(1)&gt;</strong> un texte piégé.");
  assert.doesNotMatch(html, /<img/, "aucune balise autre que <strong>/<\\/strong> ne doit exister dans la sortie");
  // Vérifie explicitement qu'aucune sous-chaîne HTML non échappée ne subsiste
  // ailleurs que dans nos propres balises <strong>.
  const withoutOurTags = html.replace(/<\/?strong>/g, "");
  assert.doesNotMatch(withoutOurTags, /<[a-z]/i, "aucune balise HTML en dehors de <strong> ne doit apparaître");
});

test("SÉCURITÉ XSS : une expression de highlight contenant elle-même des caractères HTML reste échappée dans <strong>", () => {
  const sandbox = makeSandbox();
  const text = "La formule <Corpus & Digesta> est utilisée dans le droit romain.";
  const html = sandbox.renderFicheSectionText(text, [{ knowledgeTargetId: "k1", start: 11, end: 29 }]);
  assert.ok(html.includes("<strong>&lt;Corpus &amp; Digesta&gt;</strong>"));
  assert.doesNotMatch(html.replace(/<\/?strong>/g, ""), /<[a-z]/i);
});

test("un highlight aux offsets hors bornes (start négatif, end > longueur du texte, start >= end) est ignoré défensivement, repli sur escapeHtml seul", () => {
  const sandbox = makeSandbox();
  const text = "Justinien règne de 527 à 565.";
  assert.equal(sandbox.renderFicheSectionText(text, [{ knowledgeTargetId: "k1", start: -1, end: 9 }]), sandbox.escapeHtml(text));
  assert.equal(sandbox.renderFicheSectionText(text, [{ knowledgeTargetId: "k1", start: 0, end: 9999 }]), sandbox.escapeHtml(text));
  assert.equal(sandbox.renderFicheSectionText(text, [{ knowledgeTargetId: "k1", start: 5, end: 5 }]), sandbox.escapeHtml(text));
  assert.equal(sandbox.renderFicheSectionText(text, [{ knowledgeTargetId: "k1", start: "0", end: 9 }]), sandbox.escapeHtml(text), "offsets non entiers rejetés défensivement");
});

test("défense en profondeur : des highlights encore chevauchants (ne devrait jamais arriver, le backend filtre déjà) sont résolus sans corrompre le texte — le premier (après tri par position) gagne", () => {
  const sandbox = makeSandbox();
  const text = "Justinien règne de 527 à 565.";
  const html = sandbox.renderFicheSectionText(text, [
    { knowledgeTargetId: "k2", start: 16, end: 28 }, // "de 527 à 565"
    { knowledgeTargetId: "k1", start: 19, end: 28 }  // "527 à 565" (chevauche le précédent)
  ]);
  // Triés par position (16 avant 19) : le premier trouvé (16-28) est
  // accepté, le second (19-28, qui chevauche) est ignoré — texte intact.
  assert.equal(html, "Justinien règne <strong>de 527 à 565</strong>.");
  assert.doesNotMatch(html.replace(/<\/?strong>/g, ""), /<[a-z]/i);
});

test("le texte complet est toujours présent dans le rendu (visible, entre balises ou non) — jamais tronqué par le rendu des highlights", () => {
  const sandbox = makeSandbox();
  const text = "Justinien règne de 527 à 565 depuis Constantinople, capitale de l'Empire.";
  const html = sandbox.renderFicheSectionText(text, [
    { knowledgeTargetId: "k1", start: 0, end: 9 },
    { knowledgeTargetId: "k2", start: 37, end: 51 }
  ]);
  const stripped = html.replace(/<\/?strong>/g, "");
  // Comparaison au texte échappé de référence (pas au texte brut, qui
  // contient l'apostrophe non échappée dans "l'Empire" -- non modifiée ici
  // car escapeHtml ne touche pas les apostrophes, cf. test de référence).
  assert.equal(stripped, sandbox.escapeHtml(text));
});
