"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { HELP_LEVELS, HELP_LEVEL_CONFIG, deriveHelpLevel } = require("../lib/spaced-repetition/help-level");
const { resolveActiveQuestionVariant, selectVariantIndex } = require("../lib/spaced-repetition/question-variant");

test("HELP_LEVELS expose exactement 3 niveaux, jamais plus", () => {
  assert.deepEqual(HELP_LEVELS, ["guided", "intermediate", "strong_recall"]);
});

// ── fallback : aucune donnée FSRS disponible ───────────────────────────────

test("deriveHelpLevel : aucun état FSRS (MemoryItem jamais revu) -> guided", () => {
  assert.equal(deriveHelpLevel(null), "guided");
  assert.equal(deriveHelpLevel(undefined), "guided");
});

test("deriveHelpLevel : état incomplet (ancien MemoryItem, champ manquant) -> guided, jamais une exception", () => {
  assert.equal(deriveHelpLevel({}), "guided");
  assert.equal(deriveHelpLevel({ stability: 100 }), "guided", "state absent");
  assert.equal(deriveHelpLevel({ state: "Review" }), "guided", "stability absente");
  assert.equal(deriveHelpLevel({ state: "Review", stability: null }), "guided");
  assert.equal(deriveHelpLevel({ state: "Review", stability: NaN }), "guided");
  assert.equal(deriveHelpLevel({ state: "Review", stability: "21" }), "guided", "stability non numérique (string) -> guided, jamais une coercition implicite");
});

// ── états fragiles : toujours guided, quelle que soit stability ───────────

test("deriveHelpLevel : state New -> guided, même avec une stability élevée", () => {
  assert.equal(deriveHelpLevel({ state: "New", stability: 500 }), "guided");
});

test("deriveHelpLevel : state Learning -> guided", () => {
  assert.equal(deriveHelpLevel({ state: "Learning", stability: 500 }), "guided");
});

test("deriveHelpLevel : state Relearning -> guided (un oubli récent reste fragile)", () => {
  assert.equal(deriveHelpLevel({ state: "Relearning", stability: 500 }), "guided");
});

// ── state Review : stability départage intermediate / strong_recall ───────

test("deriveHelpLevel : state Review, stability faible -> intermediate", () => {
  assert.equal(deriveHelpLevel({ state: "Review", stability: 1 }), "intermediate");
  assert.equal(deriveHelpLevel({ state: "Review", stability: 3 }), "intermediate");
});

test("deriveHelpLevel : state Review, stability juste sous le seuil -> intermediate", () => {
  const justBelow = HELP_LEVEL_CONFIG.strongRecallMinStabilityDays - 0.01;
  assert.equal(deriveHelpLevel({ state: "Review", stability: justBelow }), "intermediate");
});

test("deriveHelpLevel : state Review, stability au seuil (inclusif) -> strong_recall", () => {
  assert.equal(deriveHelpLevel({ state: "Review", stability: HELP_LEVEL_CONFIG.strongRecallMinStabilityDays }), "strong_recall");
});

test("deriveHelpLevel : state Review, stability bien au-dessus du seuil -> strong_recall", () => {
  assert.equal(deriveHelpLevel({ state: "Review", stability: 200 }), "strong_recall");
});

test("deriveHelpLevel : un state inconnu (jamais censé arriver) retombe sur guided plutôt que de planter", () => {
  assert.equal(deriveHelpLevel({ state: "format-inexistant", stability: 100 }), "guided");
});

test("deriveHelpLevel est pure : ne modifie jamais l'objet fsrsState reçu", () => {
  const state = { state: "Review", stability: 50, difficulty: 4.2, due: new Date(), reps: 12 };
  const snapshot = { ...state };
  deriveHelpLevel(state);
  assert.deepEqual(state, snapshot, "aucun champ FSRS ne doit être touché par la dérivation du niveau d'aide");
});

// ── séparation stricte variant / helpLevel (section 8 : ne jamais mélanger) ──

test("deriveHelpLevel est indépendant de la résolution de variante — n'influence jamais selectVariantIndex", () => {
  // Même reviewCount, deux MemoryItems à helpLevel différent : la variante
  // choisie ne dépend que du hash(seed, n), jamais du niveau d'aide dérivé.
  const question = {
    id: "q-help-level-test",
    variants: [
      { type: "qcm", question: "Direct ?", options: ["A", "B", "C", "D"], correctIndex: 0 },
      { type: "texte_a_trous", question: "Inverse ___ ?", options: ["A", "B", "C", "D"], correctIndex: 1 }
    ]
  };
  const n = 3;
  const guidedResolution = resolveActiveQuestionVariant(question, n);
  const strongRecallResolution = resolveActiveQuestionVariant(question, n);
  assert.deepEqual(guidedResolution, strongRecallResolution, "resolveActiveQuestionVariant ne reçoit ni ne consulte helpLevel");
  assert.equal(selectVariantIndex.length, 3, "signature de selectVariantIndex inchangée (seed, n, variantCount) — pas de 4e paramètre helpLevel ajouté");
});

test("deriveHelpLevel n'a pas de dépendance sur le module fsrs-scheduler (pas d'écriture d'état, pas d'accès à ts-fsrs)", () => {
  const helpLevelModuleSource = require("fs").readFileSync(require.resolve("../lib/spaced-repetition/help-level"), "utf8");
  assert.ok(!/require\(\s*["']ts-fsrs["']\s*\)/.test(helpLevelModuleSource), "help-level.js ne doit jamais importer ts-fsrs — lecture seule d'un state déjà calculé ailleurs");
  assert.ok(!/require\(\s*["']\.\/fsrs-scheduler["']\s*\)/.test(helpLevelModuleSource), "help-level.js ne doit jamais appeler reviewMemoryItem — jamais d'écriture FSRS depuis ce module");
});
