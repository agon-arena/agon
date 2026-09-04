"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveSectionHighlights,
  filterHighlightsToKnownTargetIds,
  MAX_HIGHLIGHT_TEXT_CHARS
} = require("../lib/fiche-highlights");
const { truncateAtSentenceBoundary } = require("../lib/text-boundaries");

function h(knowledgeTargetId, text) {
  return { knowledgeTargetId, text };
}

// ── 1-4. Cas simples de la demande ─────────────────────────────────────────

test("1. connaissance simple : « Justinien » résolu en surbrillance", () => {
  const text = "Justinien est l'empereur de l'Empire romain d'Orient de 527 à 565.";
  const result = resolveSectionHighlights(text, [h("k1", "Justinien")]);
  assert.deepEqual(result, [{ knowledgeTargetId: "k1", start: 0, end: 9 }]);
  assert.equal(text.slice(0, 9), "Justinien");
});

test("2. date : « 527 à 565 » résolue en surbrillance", () => {
  const text = "Justinien est l'empereur de l'Empire romain d'Orient de 527 à 565.";
  const result = resolveSectionHighlights(text, [h("k1", "527 à 565")]);
  assert.equal(result.length, 1);
  assert.equal(text.slice(result[0].start, result[0].end), "527 à 565");
});

test("3. expression : « renovatio imperii » résolue en surbrillance", () => {
  const text = "Il mène un projet de renovatio imperii, la restauration de l'Empire romain.";
  const result = resolveSectionHighlights(text, [h("k2", "renovatio imperii")]);
  assert.equal(result.length, 1);
  assert.equal(text.slice(result[0].start, result[0].end), "renovatio imperii");
});

test("4. plusieurs knowledgeTargets dans le même paragraphe -> plusieurs highlights corrects, non chevauchants", () => {
  const text = "Justinien est l'empereur de l'Empire romain d'Orient de 527 à 565. Constantinople en est la capitale.";
  const result = resolveSectionHighlights(text, [
    h("k1", "Justinien"),
    h("k1", "527 à 565"),
    h("k2", "Constantinople")
  ]);
  assert.equal(result.length, 3);
  const byId = result.reduce((acc, r) => { acc[r.knowledgeTargetId] = (acc[r.knowledgeTargetId] || 0) + 1; return acc; }, {});
  assert.equal(byId.k1, 2);
  assert.equal(byId.k2, 1);
  for (const r of result) assert.ok(r.start < r.end && r.end <= text.length);
});

test("5. texte sans knowledgeTarget correspondant -> aucun gras inventé", () => {
  const text = "Justinien est l'empereur de l'Empire romain d'Orient.";
  assert.deepEqual(resolveSectionHighlights(text, []), []);
  assert.deepEqual(resolveSectionHighlights(text, [h("k1", "Théodora")]), []);
});

// ── 6-8. Niveaux progressifs (filtre par id, cf. generateProgressiveLevelBlock) ──

test("6. un knowledgeTargetId Expert n'est jamais retenu dans un bloc Élémentaire (filterHighlightsToKnownTargetIds)", () => {
  const resolved = resolveSectionHighlights("Justinien fait rédiger le Corpus juris civilis.", [h("k9", "Corpus juris civilis")]);
  // resolveSectionHighlights seule ne connaît pas le niveau : elle résout l'id tel quel.
  assert.equal(resolved.length, 1);
  // Le filtre par ids RÉELLEMENT fournis au bloc Élémentaire (k1..k5) l'exclut.
  const validElementaryIds = new Set(["k1", "k2", "k3", "k4", "k5"]);
  assert.deepEqual(filterHighlightsToKnownTargetIds(resolved, validElementaryIds), []);
});

test("7. fiche Approfondi cumulative : highlights Élémentaire + Approfondi tous conservés (ids respectivement valides pour chaque bloc)", () => {
  const elementaryIds = new Set(["k1", "k2"]);
  const deepeningIds = new Set(["k3", "k4"]);
  const elementaryHighlights = filterHighlightsToKnownTargetIds(
    resolveSectionHighlights("Justinien règne à Constantinople.", [h("k1", "Justinien"), h("k2", "Constantinople")]),
    elementaryIds
  );
  const deepeningHighlights = filterHighlightsToKnownTargetIds(
    resolveSectionHighlights("Il mène la renovatio imperii en 533.", [h("k3", "renovatio imperii"), h("k4", "533")]),
    deepeningIds
  );
  assert.equal(elementaryHighlights.length, 2);
  assert.equal(deepeningHighlights.length, 2);
});

test("8. fiche Expert : tous les highlights correspondant aux connaissances enseignées (Élémentaire + Approfondi + Expert) sont conservés", () => {
  const allIds = new Set(["k1", "k5", "k9"]);
  const perSection = [
    resolveSectionHighlights("Justinien.", [h("k1", "Justinien")]),
    resolveSectionHighlights("renovatio imperii.", [h("k5", "renovatio imperii")]),
    resolveSectionHighlights("Corpus juris civilis.", [h("k9", "Corpus juris civilis")])
  ].map((r) => filterHighlightsToKnownTargetIds(r, allIds));
  assert.deepEqual(perSection.map((r) => r.length), [1, 1, 1]);
});

// ── 9. Ancienne fiche sans metadata ─────────────────────────────────────────

test("9. ancienne fiche sans champ highlights -> tableau vide, jamais une erreur", () => {
  assert.deepEqual(resolveSectionHighlights("Un texte legacy sans highlights.", undefined), []);
  assert.deepEqual(resolveSectionHighlights("Un texte legacy sans highlights.", null), []);
});

// ── 10. Échappement / XSS : hors périmètre du matching texte lui-même (assuré
// par le renderer frontend, cf. test HTML dédié) — ici, on vérifie seulement
// que des caractères HTML dans une expression sont traités comme du texte
// brut ordinaire par le matching, jamais interprétés. ──────────────────────

test("10. une expression contenant des caractères HTML (<, >, &) est résolue comme du texte brut ordinaire", () => {
  const text = "La formule <Corpus & Digesta> est utilisée dans le droit romain.";
  const result = resolveSectionHighlights(text, [h("k1", "<Corpus & Digesta>")]);
  assert.equal(result.length, 1);
  assert.equal(text.slice(result[0].start, result[0].end), "<Corpus & Digesta>");
});

// ── 11. Chevauchement : comportement déterministe, texte jamais corrompu ───

test("11a. deux highlights qui se chevauchent partiellement : le premier accepté gagne, le second est rejeté", () => {
  const text = "Justinien règne de 527 à 565.";
  const result = resolveSectionHighlights(text, [h("k1", "règne de 527"), h("k2", "527 à 565")]);
  assert.equal(result.length, 1);
  assert.equal(result[0].knowledgeTargetId, "k1");
});

test("11b. un highlight strictement inclus dans un autre : rejeté comme un chevauchement ordinaire", () => {
  const text = "Justinien règne de 527 à 565.";
  const result = resolveSectionHighlights(text, [h("k1", "527 à 565"), h("k2", "565")]);
  assert.equal(result.length, 1);
  assert.equal(result[0].knowledgeTargetId, "k1");
});

test("11c. deux highlights disjoints du même texte source ne sont jamais fusionnés ni tronqués : le texte original reste intact quel que soit le résultat", () => {
  const text = "Justinien règne de 527 à 565.";
  const before = text;
  resolveSectionHighlights(text, [h("k1", "règne de 527"), h("k2", "527 à 565"), h("k3", "Justinien")]);
  assert.equal(text, before);
});

// ── 12. La mise en gras ne modifie jamais le texte pédagogique lui-même ────

test("12. resolveSectionHighlights ne modifie jamais la chaîne `text` passée en entrée", () => {
  const text = "Justinien règne de 527 à 565.";
  const copy = String(text);
  resolveSectionHighlights(text, [h("k1", "Justinien"), h("k2", "527 à 565")]);
  assert.equal(text, copy);
});

// ── Occurrence multiple ambiguë (contrainte explicite de cette phase :
// "je préfère un false negative à un false positive") ──────────────────────

test("occurrence exacte multiple ambiguë : aucun highlight plutôt qu'un choix arbitraire (ex. « première occurrence »)", () => {
  const text = "Le terme empereur désigne Justinien. Un autre empereur régnait avant lui.";
  const result = resolveSectionHighlights(text, [h("k1", "empereur")]);
  assert.deepEqual(result, [], "« empereur » apparaît deux fois : aucune résolution arbitraire ne doit avoir lieu");
});

test("occurrence unique en casse différente : repli insensible à la casse accepté, offsets exacts sur le texte ORIGINAL", () => {
  const text = "JUSTINIEN est empereur de 527 à 565.";
  const result = resolveSectionHighlights(text, [h("k1", "Justinien")]);
  assert.equal(result.length, 1);
  assert.equal(text.slice(result[0].start, result[0].end), "JUSTINIEN");
});

test("occurrence ambiguë même après repli insensible à la casse (2 correspondances, casses différentes) : rejetée", () => {
  const text = "empereur Justinien, tout comme EMPEREUR Auguste avant lui.";
  const result = resolveSectionHighlights(text, [h("k1", "Empereur")]);
  assert.deepEqual(result, []);
});

// ── Validation structurelle (id inconnu / structure invalide / trop long) ──

test("knowledgeTargetId manquant ou vide -> candidat ignoré silencieusement", () => {
  const text = "Justinien règne de 527 à 565.";
  assert.deepEqual(resolveSectionHighlights(text, [{ text: "Justinien" }]), []);
  assert.deepEqual(resolveSectionHighlights(text, [h("", "Justinien")]), []);
});

test("text vide, non-string, ou trop long (> MAX_HIGHLIGHT_TEXT_CHARS) -> candidat ignoré", () => {
  const text = "Justinien règne de 527 à 565. ".repeat(10);
  assert.deepEqual(resolveSectionHighlights(text, [h("k1", "")]), []);
  assert.deepEqual(resolveSectionHighlights(text, [h("k1", 42)]), []);
  const tooLong = "x".repeat(MAX_HIGHLIGHT_TEXT_CHARS + 1);
  assert.deepEqual(resolveSectionHighlights(text + tooLong, [h("k1", tooLong)]), []);
});

test("un id inconnu du curriculum -> rejeté par filterHighlightsToKnownTargetIds (jamais par resolveSectionHighlights, qui ne connaît pas le curriculum)", () => {
  const resolved = resolveSectionHighlights("Justinien règne de 527 à 565.", [h("k999", "Justinien")]);
  assert.equal(resolved.length, 1, "resolveSectionHighlights résout l'id tel quel, sans le valider");
  assert.deepEqual(filterHighlightsToKnownTargetIds(resolved, new Set(["k1", "k2"])), []);
});

test("plusieurs highlights pour le même target : autorisés (jamais limités à un seul par knowledgeTargetId)", () => {
  const text = "Justinien règne de 527 à 565 depuis Constantinople.";
  const result = resolveSectionHighlights(text, [h("k1", "Justinien"), h("k1", "527 à 565"), h("k1", "Constantinople")]);
  assert.equal(result.length, 3);
  assert.ok(result.every((r) => r.knowledgeTargetId === "k1"));
});

test("un target sans highlight fourni : accepté tel quel, aucun remplissage automatique", () => {
  const text = "Justinien règne de 527 à 565.";
  const result = resolveSectionHighlights(text, [h("k1", "Justinien")]);
  // k2 n'a simplement aucune entrée : aucune tentative de la "deviner".
  assert.equal(result.filter((r) => r.knowledgeTargetId === "k2").length, 0);
});

// ── Limite documentée : expression valide mais reliée au MAUVAIS target ────

test("LIMITE DOCUMENTÉE : une expression textuellement correcte mais associée au mauvais knowledgeTargetId n'est PAS détectable de façon déterministe — resolveSectionHighlights ne vérifie que la présence littérale du texte, jamais la cohérence sémantique id<->texte", () => {
  const text = "Justinien règne de 527 à 565.";
  // "Justinien" existe bien dans le texte, mais ici associé à k2 (qui, par
  // hypothèse, porte une AUTRE connaissance, ex. la date) : rien ne permet
  // de distinguer ce cas d'une association correcte sans interprétation
  // sémantique (explicitement exclue : "aucun matching par similarité
  // sémantique"). Accepté tel quel — limite assumée, pas un bug.
  const result = resolveSectionHighlights(text, [h("k2", "Justinien")]);
  assert.equal(result.length, 1);
  assert.equal(result[0].knowledgeTargetId, "k2");
});

// ── Offsets calculés APRÈS troncature (Phase 2.2 x Phase 2.4) ──────────────

test("les offsets sont calculés sur le texte APRÈS troncature, jamais sur le brut Luna : une expression tronquée n'est jamais résolue à un offset invalide", () => {
  const s1 = "Justinien règne de 527 à 565.";
  const s2 = "En 532, une révolte appelée révolte de Nika éclate à Constantinople avec l'aide du général Bélisaire.";
  const raw = `${s1} ${s2}`;
  // Plafond choisi pour couper APRÈS s1 (donc "Bélisaire" n'existe plus dans
  // le texte final) -- reproduit l'ordre exact exigé : parsing -> troncature
  // -> résolution des highlights sur le texte final, jamais avant.
  const finalText = truncateAtSentenceBoundary(raw, s1.length + 10);
  assert.equal(finalText, s1, "prérequis du test : la troncature doit bien s'arrêter après s1");
  const result = resolveSectionHighlights(finalText, [h("k1", "Justinien"), h("k2", "Bélisaire")]);
  assert.deepEqual(result, [{ knowledgeTargetId: "k1", start: 0, end: 9 }], "« Bélisaire », absent du texte tronqué, ne doit jamais produire un offset (qui serait invalide/hors texte)");
  for (const r of result) assert.ok(r.end <= finalText.length, "aucun offset ne doit jamais dépasser la longueur du texte réellement persisté");
});

test("aucune troncature nécessaire : les offsets restent corrects sur le texte inchangé", () => {
  const text = "Justinien règne de 527 à 565.";
  const finalText = truncateAtSentenceBoundary(text, 5000);
  assert.equal(finalText, text);
  const result = resolveSectionHighlights(finalText, [h("k1", "Justinien")]);
  assert.deepEqual(result, [{ knowledgeTargetId: "k1", start: 0, end: 9 }]);
});
