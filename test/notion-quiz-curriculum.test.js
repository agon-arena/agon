"use strict";

// Génération progressive — PHASE 1 (02/09/2026) ; taille FLEXIBLE du
// curriculum (02/09/2026, suite — "le nombre de connaissances utiles
// détermine la taille du parcours, les niveaux sont des proportions du
// curriculum, jamais des quotas fixes"). Tests du module PUR
// lib/notion-quiz-curriculum.js — exécuté pour de vrai (pas de sandbox
// nécessaire, ce module n'a aucune dépendance réseau/IA).

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MIN_PROGRESSIVE_CURRICULUM,
  MAX_PROGRESSIVE_CURRICULUM,
  MIN_LEVEL_SIZE,
  computeCurriculumSplit,
  levelForOrder,
  buildCurriculumPrompt,
  parseCurriculumItems,
  findNearDuplicates,
  normalizeCurriculumOrder,
  assignCurriculumLevels,
  validateCurriculumComplete,
  missingCurriculumCount,
  buildCurriculumRepairPrompt,
  parseCurriculumRepairAdditions,
  mergeCurriculumAdditions,
  selectCurriculumLevel
} = require("../lib/notion-quiz-curriculum");

// 20 phrases RÉELLEMENT distinctes (jamais un simple gabarit "Connaissance N"
// qui partagerait la quasi-totalité de son vocabulaire d'un item à l'autre et
// se ferait donc détecter à tort comme quasi-équivalent par lexicalSimilarity
// — findNearDuplicates doit avoir un vrai corpus varié pour être testé
// honnêtement).
const DISTINCT_FACTS = [
  "Zénon de Citium fonde le stoïcisme à Athènes vers 300 av. J.-C.",
  "Les stoïciens enseignent d'abord au Portique peint (Stoa Poïkilè).",
  "La philosophie stoïcienne distingue ce qui dépend de nous de ce qui n'en dépend pas.",
  "Les stoïciens divisent la philosophie en logique, physique et éthique.",
  "La vertu constitue le seul bien véritable selon les stoïciens.",
  "Chrysippe systématise et développe considérablement la doctrine stoïcienne.",
  "Les stoïciens conçoivent le cosmos comme un être vivant rationnel unique.",
  "Le concept de logos désigne la raison universelle qui gouverne le monde.",
  "L'apatheia stoïcienne signifie l'absence de passions destructrices.",
  "Les stoïciens pratiquent des exercices spirituels quotidiens de discipline.",
  "Sénèque incarne le stoïcisme romain sous le règne de Néron.",
  "Épictète, ancien esclave, enseigne une éthique de la liberté intérieure.",
  "Marc Aurèle rédige ses Pensées pour lui-même pendant ses campagnes militaires.",
  "Les stoïciens développent une théorie matérialiste de la connaissance.",
  "Le sage stoïcien reste imperturbable face aux revers de fortune.",
  "Les stoïciens s'opposent aux épicuriens sur la nature du plaisir.",
  "La doctrine de l'éternel retour marque la cosmologie stoïcienne tardive.",
  "Les stoïciens influencent durablement le droit romain et le droit naturel.",
  "Le stoïcisme connaît un renouveau moderne via la psychologie cognitive.",
  "Panétius introduit le stoïcisme dans les cercles intellectuels romains."
];

// Construit un curriculum FINAL (normalisé + niveaux attachés) de taille N
// (15 à 20), en réutilisant les fonctions pures elles-mêmes plutôt qu'une
// reconstruction manuelle — teste donc implicitement la cohérence bout en
// bout de normalizeCurriculumOrder + assignCurriculumLevels à chaque appel.
function makeCurriculum(n, { mutate } = {}) {
  const raw = DISTINCT_FACTS.slice(0, n).map((knowledgeTarget, index) => ({
    id: `raw-${index}`,
    knowledgeTarget,
    order: index + 1
  }));
  const normalized = normalizeCurriculumOrder(raw);
  const withLevels = assignCurriculumLevels(normalized);
  return mutate ? mutate(withLevels) : withLevels;
}

// ── computeCurriculumSplit ──────────────────────────────────────────────

test("computeCurriculumSplit : reproduit exactement la table attendue pour N=15..20", () => {
  const expected = {
    15: { elementary: 4, deepening: 4, expert: 7 },
    16: { elementary: 4, deepening: 4, expert: 8 },
    17: { elementary: 4, deepening: 4, expert: 9 },
    18: { elementary: 5, deepening: 4, expert: 9 },
    19: { elementary: 5, deepening: 5, expert: 9 },
    20: { elementary: 5, deepening: 5, expert: 10 }
  };
  for (const [n, split] of Object.entries(expected)) {
    assert.deepEqual(computeCurriculumSplit(Number(n)), split, `N=${n}`);
  }
});

test("computeCurriculumSplit : la somme des trois pools est toujours exactement N, pour tout N de 15 à 20", () => {
  for (let n = MIN_PROGRESSIVE_CURRICULUM; n <= MAX_PROGRESSIVE_CURRICULUM; n += 1) {
    const split = computeCurriculumSplit(n);
    assert.equal(split.elementary + split.deepening + split.expert, n, `N=${n}`);
  }
});

test("computeCurriculumSplit : elementary et deepening ne descendent jamais sous MIN_LEVEL_SIZE (4), pour tout N de 15 à 20", () => {
  for (let n = MIN_PROGRESSIVE_CURRICULUM; n <= MAX_PROGRESSIVE_CURRICULUM; n += 1) {
    const split = computeCurriculumSplit(n);
    assert.ok(split.elementary >= MIN_LEVEL_SIZE, `N=${n} elementary=${split.elementary}`);
    assert.ok(split.deepening >= MIN_LEVEL_SIZE, `N=${n} deepening=${split.deepening}`);
  }
});

test("computeCurriculumSplit : entrée invalide (0, négatif, non entier) -> {0,0,0}, jamais une exception", () => {
  assert.deepEqual(computeCurriculumSplit(0), { elementary: 0, deepening: 0, expert: 0 });
  assert.deepEqual(computeCurriculumSplit(-3), { elementary: 0, deepening: 0, expert: 0 });
  assert.deepEqual(computeCurriculumSplit("vingt"), { elementary: 0, deepening: 0, expert: 0 });
});

// ── levelForOrder (dynamique : dépend de la taille totale N) ─────────────

test("levelForOrder : dynamique selon N — les bornes changent avec la taille du curriculum", () => {
  // N=15 -> 4/4/7 : elementary 1-4, deepening 5-8, expert 9-15
  assert.equal(levelForOrder(4, 15), "elementary");
  assert.equal(levelForOrder(5, 15), "deepening");
  assert.equal(levelForOrder(8, 15), "deepening");
  assert.equal(levelForOrder(9, 15), "expert");
  assert.equal(levelForOrder(15, 15), "expert");
  // N=20 -> 5/5/10 : elementary 1-5, deepening 6-10, expert 11-20
  assert.equal(levelForOrder(5, 20), "elementary");
  assert.equal(levelForOrder(6, 20), "deepening");
  assert.equal(levelForOrder(10, 20), "deepening");
  assert.equal(levelForOrder(11, 20), "expert");
  assert.equal(levelForOrder(20, 20), "expert");
});

test("levelForOrder : hors bornes [1, total] -> null", () => {
  assert.equal(levelForOrder(0, 20), null);
  assert.equal(levelForOrder(21, 20), null);
  assert.equal(levelForOrder(16, 15), null);
});

// ── buildCurriculumPrompt ────────────────────────────────────────────────

test("buildCurriculumPrompt : demande entre 15 et 20 connaissances, plus jamais un quota fixe de 20 ni une répartition 5/5/10 imposée au modèle", () => {
  const prompt = buildCurriculumPrompt("Stoïcisme", null, null);
  assert.match(prompt, /ENTRE 15 ET 20 connaissances/);
  assert.doesNotMatch(prompt, /EXACTEMENT 20/);
  assert.doesNotMatch(prompt, /k1 à k5/);
  assert.doesNotMatch(prompt, /k6 à k10/);
  assert.doesNotMatch(prompt, /k11 à k20/);
});

test("buildCurriculumPrompt : interdit le remplissage artificiel et précise que le découpage en niveaux est calculé par le code, pas par le modèle", () => {
  const prompt = buildCurriculumPrompt("Platon", null, null);
  assert.match(prompt, /accepte-en moins \(15 au minimum\)/);
  assert.match(prompt, /N'invente jamais une connaissance faible/);
  assert.match(prompt, /ce découpage sera calculé automatiquement/);
  assert.match(prompt, /aucune connaissance ne doit se recouper/i);
});

test("buildCurriculumPrompt : intègre le texte de grounding quand fourni, l'omet sinon", () => {
  const withGrounding = buildCurriculumPrompt("Sujet", null, "[Source 1] Contenu réel de la source.");
  assert.match(withGrounding, /VRAIES sources web/);
  assert.match(withGrounding, /Contenu réel de la source/);
  const withoutGrounding = buildCurriculumPrompt("Sujet", null, null);
  assert.doesNotMatch(withoutGrounding, /VRAIES sources web/);
});

// ── parseCurriculumItems (plus de champ "level" dans la forme parsée) ────

test("parseCurriculumItems : ne conserve jamais de champ level (dérivé plus tard, après normalisation) même si le modèle en fournit un", () => {
  const raw = [{ id: "k1", knowledgeTarget: "Fait 1", level: "expert", order: 1 }];
  const items = parseCurriculumItems(raw);
  assert.equal(items.length, 1);
  assert.equal(items[0].level, undefined);
  assert.deepEqual(Object.keys(items[0]).sort(), ["id", "knowledgeTarget", "order"]);
});

test("parseCurriculumItems : rejette silencieusement les entrées malformées (knowledgeTarget vide, order hors [1,20], id manquant)", () => {
  const raw = [
    { id: "k1", knowledgeTarget: "Fait valide", order: 1 },
    { id: "k2", knowledgeTarget: "", order: 2 },
    { id: "k3", knowledgeTarget: "Fait", order: 99 },
    { id: "", knowledgeTarget: "Fait sans id", order: 4 },
    { id: "k5", knowledgeTarget: "Fait 5", order: 5 }
  ];
  const items = parseCurriculumItems(raw);
  assert.deepEqual(items.map((i) => i.order), [1, 5]);
});

test("parseCurriculumItems : accepte un curriculum de seulement 15-18 items sans jamais exiger 20", () => {
  const raw = Array.from({ length: 17 }, (_, i) => ({ id: `k${i + 1}`, knowledgeTarget: DISTINCT_FACTS[i], order: i + 1 }));
  const items = parseCurriculumItems(raw);
  assert.equal(items.length, 17);
});

test("parseCurriculumItems : déduplique par id ET par order (garde la première occurrence)", () => {
  const raw = [
    { id: "k1", knowledgeTarget: "Premier", order: 1 },
    { id: "k1", knowledgeTarget: "Doublon d'id", order: 2 },
    { id: "k3", knowledgeTarget: "Doublon d'order", order: 1 }
  ];
  const items = parseCurriculumItems(raw);
  assert.equal(items.length, 1);
  assert.equal(items[0].knowledgeTarget, "Premier");
});

test("parseCurriculumItems : trie toujours par order croissant, quel que soit l'ordre d'entrée", () => {
  const raw = [{ id: "k3", knowledgeTarget: "C", order: 3 }, { id: "k1", knowledgeTarget: "A", order: 1 }, { id: "k2", knowledgeTarget: "B", order: 2 }];
  const items = parseCurriculumItems(raw);
  assert.deepEqual(items.map((i) => i.order), [1, 2, 3]);
});

test("parseCurriculumItems : entrée non-tableau -> tableau vide, jamais une exception", () => {
  assert.deepEqual(parseCurriculumItems(null), []);
  assert.deepEqual(parseCurriculumItems(undefined), []);
  assert.deepEqual(parseCurriculumItems("pas un tableau"), []);
});

// ── findNearDuplicates (logique inchangée) ────────────────────────────────

test("findNearDuplicates : détecte deux connaissances strictement identiques après normalisation", () => {
  const list = [
    { id: "k1", knowledgeTarget: "Platon fonde l'Académie vers 387 av. J.-C." },
    { id: "k2", knowledgeTarget: "  Platon fonde l'Académie vers 387 av. J.-C.  " }
  ];
  assert.equal(findNearDuplicates(list).length, 1);
});

test("findNearDuplicates : détecte une quasi-équivalence lexicale (mêmes mots, ordre différent)", () => {
  const list = [
    { id: "k1", knowledgeTarget: "Platon fonde l'Académie à Athènes vers 387 avant Jésus-Christ" },
    { id: "k2", knowledgeTarget: "Vers 387 avant Jésus-Christ, à Athènes, Platon fonde l'Académie" }
  ];
  assert.equal(findNearDuplicates(list).length, 1);
});

test("findNearDuplicates : ne signale jamais deux connaissances réellement distinctes", () => {
  const list = [
    { id: "k1", knowledgeTarget: "Platon fonde l'Académie à Athènes vers 387 av. J.-C." },
    { id: "k2", knowledgeTarget: "Aristote fut l'élève de Platon avant de fonder le Lycée." }
  ];
  assert.equal(findNearDuplicates(list).length, 0);
});

// ── normalizeCurriculumOrder (renormalisation après rejet) ───────────────

test("normalizeCurriculumOrder : comble les trous laissés par un rejet (order non contigu) en réassignant id/order 1..N séquentiellement", () => {
  const items = [
    { id: "k1", knowledgeTarget: "A", order: 1 },
    { id: "k4", knowledgeTarget: "B", order: 4 },
    { id: "k7", knowledgeTarget: "C", order: 7 }
  ];
  const normalized = normalizeCurriculumOrder(items);
  assert.deepEqual(normalized.map((i) => i.id), ["k1", "k2", "k3"]);
  assert.deepEqual(normalized.map((i) => i.order), [1, 2, 3]);
});

test("normalizeCurriculumOrder : préserve l'ordre pédagogique d'origine (trie par order avant de renuméroter)", () => {
  const items = [
    { id: "k9", knowledgeTarget: "Dernier à l'origine", order: 9 },
    { id: "k2", knowledgeTarget: "Premier à l'origine", order: 2 }
  ];
  const normalized = normalizeCurriculumOrder(items);
  assert.equal(normalized[0].knowledgeTarget, "Premier à l'origine");
  assert.equal(normalized[1].knowledgeTarget, "Dernier à l'origine");
});

test("normalizeCurriculumOrder : ne perd aucune connaissance (même nombre en entrée et en sortie) et conserve knowledgeTarget tel quel", () => {
  const items = Array.from({ length: 17 }, (_, i) => ({ id: `raw-${i}`, knowledgeTarget: DISTINCT_FACTS[i], order: (i + 1) * 3 }));
  const normalized = normalizeCurriculumOrder(items);
  assert.equal(normalized.length, 17);
  assert.deepEqual(normalized.map((i) => i.knowledgeTarget).sort(), items.map((i) => i.knowledgeTarget).sort());
});

test("normalizeCurriculumOrder : entrée non-tableau -> tableau vide", () => {
  assert.deepEqual(normalizeCurriculumOrder(null), []);
});

// ── assignCurriculumLevels ────────────────────────────────────────────────

test("assignCurriculumLevels : attache un niveau cohérent avec computeCurriculumSplit, pour plusieurs tailles N", () => {
  for (const n of [15, 17, 18, 20]) {
    const curriculum = makeCurriculum(n);
    const split = computeCurriculumSplit(n);
    assert.equal(curriculum.filter((k) => k.level === "elementary").length, split.elementary, `N=${n}`);
    assert.equal(curriculum.filter((k) => k.level === "deepening").length, split.deepening, `N=${n}`);
    assert.equal(curriculum.filter((k) => k.level === "expert").length, split.expert, `N=${n}`);
  }
});

test("assignCurriculumLevels : aucune connaissance n'appartient à deux niveaux (chaque item a exactement un level)", () => {
  const curriculum = makeCurriculum(18);
  for (const item of curriculum) {
    assert.equal(["elementary", "deepening", "expert"].includes(item.level), true);
  }
  const total = curriculum.filter((k) => k.level === "elementary").length
    + curriculum.filter((k) => k.level === "deepening").length
    + curriculum.filter((k) => k.level === "expert").length;
  assert.equal(total, curriculum.length);
});

// ── validateCurriculumComplete ───────────────────────────────────────────

test("validateCurriculumComplete : un curriculum de 20 connaissances bien réparties et distinctes est valide", () => {
  const result = validateCurriculumComplete(makeCurriculum(20));
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validateCurriculumComplete : un curriculum de 18 connaissances (5/4/9) est valide en tant que tel, jamais comparé à 20", () => {
  const result = validateCurriculumComplete(makeCurriculum(18));
  assert.equal(result.valid, true);
});

test("validateCurriculumComplete : un curriculum de 15 connaissances (le minimum, 4/4/7) est valide", () => {
  const result = validateCurriculumComplete(makeCurriculum(15));
  assert.equal(result.valid, true);
});

test("validateCurriculumComplete : invalide si moins de 15 connaissances (hors bornes basses)", () => {
  const curriculum = makeCurriculum(15).slice(0, 14);
  const result = validateCurriculumComplete(curriculum);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /14 connaissance.*hors bornes/);
});

test("validateCurriculumComplete : invalide si plus de 20 connaissances (hors bornes hautes)", () => {
  const curriculum = [...makeCurriculum(20), { id: "k21", knowledgeTarget: "Une 21e connaissance très distincte des vingt autres", order: 21, level: "expert" }];
  const result = validateCurriculumComplete(curriculum);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /21 connaissance.*hors bornes/);
});

test("validateCurriculumComplete : invalide si la répartition ne correspond plus à computeCurriculumSplit de sa propre taille", () => {
  const curriculum = makeCurriculum(20, {
    mutate: (items) => {
      items[5].level = "elementary"; // 6 elementary, 4 deepening au lieu de 5/5
      return items;
    }
  });
  const result = validateCurriculumComplete(curriculum);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /elementary.*6\/5|deepening.*4\/5/);
});

test("validateCurriculumComplete : invalide si deux connaissances sont quasi équivalentes", () => {
  const curriculum = makeCurriculum(18, {
    mutate: (items) => {
      items[1].knowledgeTarget = items[0].knowledgeTarget;
      return items;
    }
  });
  const result = validateCurriculumComplete(curriculum);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /quasi équivalentes/);
});

// ── missingCurriculumCount (réparation = revenir au MINIMUM, jamais à 20) ─

test("missingCurriculumCount : 0 dès que le nombre admis atteint ou dépasse 15 — même à 16, 18 ou 19 (jamais de réparation pour revenir à 20)", () => {
  assert.equal(missingCurriculumCount(15), 0);
  assert.equal(missingCurriculumCount(16), 0);
  assert.equal(missingCurriculumCount(18), 0);
  assert.equal(missingCurriculumCount(19), 0);
  assert.equal(missingCurriculumCount(20), 0);
});

test("missingCurriculumCount : positif tant que le nombre admis reste sous 15 (14 -> 1 manquant)", () => {
  assert.equal(missingCurriculumCount(14), 1);
  assert.equal(missingCurriculumCount(13), 2);
  assert.equal(missingCurriculumCount(0), 15);
});

// `target` (latence, 03/09/2026 — vérification scindée elementary-only, cf.
// server.js resolveProgressiveCurriculum) : second paramètre optionnel,
// AUCUN changement du comportement par défaut (target = MIN_PROGRESSIVE_
// CURRICULUM implicite, cas déjà couvert par les deux tests ci-dessus, qui
// continuent de passer sans le fournir).

test("missingCurriculumCount(count, target) : cible explicite différente de MIN_PROGRESSIVE_CURRICULUM (ex. la taille d'un sous-ensemble elementary à 4 ou 5)", () => {
  assert.equal(missingCurriculumCount(3, 5), 2);
  assert.equal(missingCurriculumCount(4, 5), 1);
  assert.equal(missingCurriculumCount(5, 5), 0);
  assert.equal(missingCurriculumCount(5, 4), 0, "jamais négatif quand on dépasse déjà la cible");
  assert.equal(missingCurriculumCount(2, 4), 2);
});

// ── Réparation ciblée (top-up vers le minimum) : prompt, parsing, fusion ──

test("buildCurriculumRepairPrompt : annonce le nombre exact manquant et liste les connaissances déjà validées (à ne jamais reproduire)", () => {
  const existing = [{ knowledgeTarget: "Déjà validée 1" }];
  const prompt = buildCurriculumRepairPrompt("Sujet", null, 2, existing, null);
  assert.match(prompt, /Déjà validée 1/);
  assert.match(prompt, /il en manque 2/);
  assert.match(prompt, /EXACTEMENT 2/);
  assert.match(prompt, /ne les reproduis jamais/);
});

test("parseCurriculumRepairAdditions : plafonne au nombre demandé, ignore les entrées vides/malformées", () => {
  const raw = [
    { knowledgeTarget: "Ajout 1" },
    { knowledgeTarget: "" },
    { knowledgeTarget: "Ajout 2" },
    { knowledgeTarget: "Ajout 3 en trop" }
  ];
  const additions = parseCurriculumRepairAdditions(raw, 2);
  assert.equal(additions.length, 2);
  assert.deepEqual(additions.map((a) => a.knowledgeTarget), ["Ajout 1", "Ajout 2"]);
});

test("parseCurriculumRepairAdditions : ne retient jamais deux ajouts identiques entre eux (après normalisation)", () => {
  const raw = [
    { knowledgeTarget: "Le stoïcisme naît à Athènes." },
    { knowledgeTarget: "  Le stoïcisme naît à Athènes.  " },
    { knowledgeTarget: "Une connaissance réellement différente." }
  ];
  const additions = parseCurriculumRepairAdditions(raw, 3);
  assert.equal(additions.length, 2);
});

test("parseCurriculumRepairAdditions : entrée non-tableau ou neededCount<=0 -> tableau vide", () => {
  assert.deepEqual(parseCurriculumRepairAdditions(null, 3), []);
  assert.deepEqual(parseCurriculumRepairAdditions([{ knowledgeTarget: "X" }], 0), []);
});

// ── mergeCurriculumAdditions (aucune connaissance perdue) ─────────────────

test("mergeCurriculumAdditions : concatène sans jamais perdre une connaissance déjà présente", () => {
  const items = [{ id: "k1", knowledgeTarget: "A", order: 1 }, { id: "k2", knowledgeTarget: "B", order: 2 }];
  const additions = [{ id: "repair-3", knowledgeTarget: "C", order: 3 }];
  const merged = mergeCurriculumAdditions(items, additions);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((i) => i.knowledgeTarget), ["A", "B", "C"]);
});

test("mergeCurriculumAdditions : entrées manquantes/non-tableau traitées comme vides, jamais une exception", () => {
  assert.deepEqual(mergeCurriculumAdditions(null, null), []);
  assert.deepEqual(mergeCurriculumAdditions([{ id: "k1" }], undefined), [{ id: "k1" }]);
});

// ── selectCurriculumLevel ─────────────────────────────────────────────────

test("selectCurriculumLevel : retourne exactement les connaissances \"elementary\" attendues pour un curriculum à 18 (5), triées par order", () => {
  const curriculum = makeCurriculum(18).slice().reverse();
  const elementary = selectCurriculumLevel(curriculum, "elementary");
  assert.equal(elementary.length, 5);
  assert.deepEqual(elementary.map((k) => k.order), [1, 2, 3, 4, 5]);
});

test("selectCurriculumLevel : retourne exactement les connaissances \"expert\" attendues pour un curriculum à 15 (7)", () => {
  const expert = selectCurriculumLevel(makeCurriculum(15), "expert");
  assert.equal(expert.length, 7);
  assert.deepEqual(expert.map((k) => k.order), [9, 10, 11, 12, 13, 14, 15]);
});
