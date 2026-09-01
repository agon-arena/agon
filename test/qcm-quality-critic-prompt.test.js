"use strict";

// Verrou de CONTENU (demande du 31/08/2026, suite à l'audit QCM complet —
// "préparer le terrain avant toute modification du comportement", §1) :
// verrouille la PRÉSENCE des critères actuellement envoyés au critique
// sémantique (buildSemanticReviewPrompt, lib/qcm-quality.js), pour qu'une
// future évolution du prompt (ex. ajout d'un critère de plausibilité des
// distracteurs, suite au cas "rhétorique antique" documenté dans l'audit)
// ne supprime accidentellement AUCUNE protection existante.
//
// Volontairement PAS un test caractère par caractère (trop fragile face à
// une reformulation légitime) — uniquement la présence des invariants
// essentiels, par sous-chaîne/regex tolérante aux accents.
//
// Ce fichier ne modifie ni ne complète lib/qcm-quality.js : il ne fait que
// lire buildSemanticReviewPrompt, déjà exporté.

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSemanticReviewPrompt } = require("../lib/qcm-quality");

function sampleEntries() {
  return [{
    id: "q-1",
    sourceId: "canada",
    knowledgeTarget: "Ottawa est la capitale du Canada.",
    sourceExcerpt: null,
    question: "Quelle est la capitale du Canada ?",
    options: ["Ottawa", "Toronto", "Montréal", "Vancouver"],
    correctIndex: 0,
    explanation: "Ottawa est la capitale fédérale du Canada.",
    type: "qcm"
  }];
}

// ── §1 de la demande : les 9 critères actuels doivent tous rester présents,
// quelle que soit une future reformulation du reste du prompt. ────────────

const CURRENT_CRITERIA = [
  ["clarté autonome", /clart[ée] autonome/i],
  ["correspondance exacte à knowledgeTarget", /correspondance exacte [aà] knowledgeTarget/i],
  ["exactitude de la réponse marquée", /exactitude de la r[ée]ponse marqu[ée]e/i],
  ["unicité des réponses correctes", /unicit[ée] des r[ée]ponses correctes/i],
  ["distracteurs incontestablement faux", /distracteurs incontestablement faux/i],
  ["cohérence grammaticale", /coh[ée]rence grammaticale/i],
  ["fidélité au passage source", /fid[ée]lit[ée] au passage source/i],
  ["absence d'information inventée", /absence d[’']information invent[ée]e/i],
  ["cohérence de l'explication", /coh[ée]rence de l[’']explication/i]
];

for (const [label, pattern] of CURRENT_CRITERIA) {
  test(`buildSemanticReviewPrompt : le critère « ${label} » est présent dans le prompt`, () => {
    const prompt = buildSemanticReviewPrompt(sampleEntries(), {});
    assert.match(prompt, pattern, `le critère "${label}" ne doit jamais disparaître silencieusement d'une future modification du prompt`);
  });
}

test("buildSemanticReviewPrompt : refuse explicitement toute question vague/déictique sans objet nommé", () => {
  const prompt = buildSemanticReviewPrompt(sampleEntries(), {});
  assert.match(prompt, /vague ou d[ée]ictique/i);
});

// ── Critère "distracteurs plausibles" (ajouté le 01/09/2026, suite à
// l'audit QCM et validé empiriquement sur le cas réel "rhétorique antique",
// cf. rapport) — désormais lui aussi un invariant à protéger. ─────────────

test("buildSemanticReviewPrompt : le critère 'distracteurs plausibles/catégorie homogène' est présent, avec les codes IMPLAUSIBLE_DISTRACTOR et CATEGORY_MISMATCH", () => {
  const prompt = buildSemanticReviewPrompt(sampleEntries(), {});
  assert.match(prompt, /cat[ée]gorie conceptuelle|cat[ée]gorie manifestement diff[ée]rente/i);
  assert.match(prompt, /IMPLAUSIBLE_DISTRACTOR/);
  assert.match(prompt, /CATEGORY_MISMATCH/);
});

test("buildSemanticReviewPrompt : intrus garde l'exemption de catégorie mais reçoit un contrôle pédagogique propre", () => {
  const prompt = buildSemanticReviewPrompt(sampleEntries(), {});
  assert.match(prompt, /jamais pour "intrus"/i, "la différence de catégorie reste légitime pour un intrus");
  assert.match(prompt, /intrus[\s\S]{0,1000}GUESSABLE_WITHOUT_KNOWLEDGE/i);
  assert.match(prompt, /diff[ée]rence[\s\S]{0,500}(simple lecture|ton|polarit[ée])/i);
  assert.match(prompt, /plan[èe]tes|tellurique|gazeuse/i, "un vrai intrus scientifique doit être explicitement préservé");
});

const V5_PEDAGOGICAL_CODES = [
  "WEAK_DISTRACTOR_SET",
  "ANSWER_SALIENCE",
  "GUESSABLE_WITHOUT_KNOWLEDGE",
  "AMBIGUOUS_DISTRACTOR",
  "ARTIFICIAL_DISTRACTOR",
  "OVERGENERALIZED_QUESTION"
];

for (const code of V5_PEDAGOGICAL_CODES) {
  test(`V5 critic : le reason code ${code} est défini dans le prompt existant`, () => {
    assert.match(buildSemanticReviewPrompt(sampleEntries(), {}), new RegExp(code));
  });
}

test("V5 critic : juge l'ensemble des options et la possibilité de répondre sans knowledgeTarget", () => {
  const prompt = buildSemanticReviewPrompt(sampleEntries(), {});
  assert.match(prompt, /ensemble des options/i);
  assert.match(prompt, /principalement par (?:simple )?[ée]limination|sans (?:ma[iî]triser|conna[iî]tre) knowledgeTarget/i);
  assert.match(prompt, /niveau de pr[ée]cision/i);
  assert.match(prompt, /longueur[^.]{0,180}(comparable|saillante|distingue)/i);
});

test("V5 critic : distingue distracteur plausible et distracteur réellement ambigu", () => {
  const prompt = buildSemanticReviewPrompt(sampleEntries(), {});
  assert.match(prompt, /plausible mais faux/i);
  assert.match(prompt, /d[ée]fendable comme (?:une )?r[ée]ponse|raisonnablement.*correct/i);
});

test("V5 critic : refuse la sur-généralisation au-delà du knowledgeTarget ou de la source", () => {
  const prompt = buildSemanticReviewPrompt(sampleEntries(), {});
  assert.match(prompt, /OVERGENERALIZED_QUESTION/);
  assert.match(prompt, /p[ée]riode|territoire|groupe concern[ée]|contexte/i);
});

// ── Qualité rédactionnelle (ajoutée le 01/09/2026, suite à l'audit
// formulation QCM — cas réel "lequel n'était PAS exclu à l'origine de
// l'application de la Déclaration des droits de l'homme et du citoyen ?",
// qui passait tous les critères V5 ci-dessus malgré une formulation
// scolaire) — désormais des invariants à protéger au même titre que les
// critères V5. ──────────────────────────────────────────────────────────

const V6_WORDING_CODES = ["UNNECESSARY_NEGATION", "AWKWARD_WORDING"];

for (const code of V6_WORDING_CODES) {
  test(`V6 critic : le reason code ${code} est défini dans le prompt`, () => {
    assert.match(buildSemanticReviewPrompt(sampleEntries(), {}), new RegExp(code));
  });
}

test("V6 critic : évalue explicitement le naturel du français, la simplicité syntaxique et l'oralité pédagogique", () => {
  const prompt = buildSemanticReviewPrompt(sampleEntries(), {});
  assert.match(prompt, /fran[çc]ais naturel/i);
  assert.match(prompt, /simplicit[ée] syntaxique/i);
  assert.match(prompt, /pos[ée]rait [àa] l'oral/i);
});

test("V6 critic : la négation évitable a un seuil clair (nécessaire = accepté) et ne devient pas un rejet automatique de toute négation", () => {
  const prompt = buildSemanticReviewPrompt(sampleEntries(), {});
  assert.match(prompt, /UNNECESSARY_NEGATION/);
  assert.match(prompt, /N'utilise JAMAIS ce code lorsque la négation est intrinsèquement nécessaire/i);
  assert.match(prompt, /intrus dont le point commun est naturellement négatif/i, "le format intrus doit rester explicitement protégé de ce critère");
});

test("V6 critic : la qualité rédactionnelle des options protège explicitement la brièveté/le style nominal contre un faux positif", () => {
  const prompt = buildSemanticReviewPrompt(sampleEntries(), {});
  assert.match(prompt, /N'utilise JAMAIS ce critère pour pénaliser une option courte, nominale ou télégraphique en soi/i);
  assert.match(prompt, /seule la maladresse réelle de formulation compte/i);
});

test("V6 critic : AWKWARD_WORDING exige un doute réel, jamais une simple préférence stylistique (limite l'inflation de régénérations)", () => {
  const prompt = buildSemanticReviewPrompt(sampleEntries(), {});
  assert.match(prompt, /AWKWARD_WORDING/);
  assert.match(prompt, /jamais pour une simple préférence stylistique/i);
});

// ── Contrat JSON attendu par parseSemanticReviews (lib/qcm-quality.js) —
// un futur ajout de critère ne doit jamais faire disparaître un champ déjà
// lu par le parseur, sous peine de CRITIC_INCOMPLETE_RESPONSE silencieux. ──

test("buildSemanticReviewPrompt : le schéma JSON demandé mentionne tous les champs lus par parseSemanticReviews, y compris usesBothKnowledgeSides", () => {
  const prompt = buildSemanticReviewPrompt(sampleEntries(), {});
  for (const field of ["verdict", "reasonCodes", "expectedCorrectIndexes", "targetsKnowledge", "groundedInSource", "usesBothKnowledgeSides", "comment"]) {
    assert.match(prompt, new RegExp(`"${field}"`), `le champ "${field}" doit rester dans le schéma JSON demandé au modèle`);
  }
});

// ── §10 de l'audit : variations contextuelles selon le pipeline appelant —
// isComprehension (pipeline "Comprendre") et hasIndependentSource:false
// (pipeline "sujet libre" quand aucune source Brave n'a été trouvée) sont
// les DEUX SEULES bascules de contenu du prompt selon le contexte. ────────

test("mode Comprendre (context.isComprehension:true) : consigne usesBothKnowledgeSides ajoutée, absente sinon", () => {
  const withComprehension = buildSemanticReviewPrompt(sampleEntries(), { isComprehension: true });
  const withoutComprehension = buildSemanticReviewPrompt(sampleEntries(), {});
  assert.match(withComprehension, /Mode Comprendre/i);
  assert.match(withComprehension, /mobilise r[ée]ellement les deux connaissances/i);
  assert.doesNotMatch(withoutComprehension, /Mode Comprendre/i);
});

test("hasIndependentSource:false (grounding web introuvable, pipeline 'sujet libre' sans corpus) : consigne dédiée ajoutée, absente par défaut et quand explicitement true", () => {
  const withoutSource = buildSemanticReviewPrompt(sampleEntries(), { hasIndependentSource: false });
  const withSourceByDefault = buildSemanticReviewPrompt(sampleEntries(), {});
  const withSourceExplicit = buildSemanticReviewPrompt(sampleEntries(), { hasIndependentSource: true });
  assert.match(withoutSource, /aucune source documentaire ind[ée]pendante/i);
  assert.doesNotMatch(withSourceByDefault, /aucune source documentaire ind[ée]pendante/i);
  assert.doesNotMatch(withSourceExplicit, /aucune source documentaire ind[ée]pendante/i);
});

// Les 4 contextes réels observés dans l'audit (§10) : import/Éclairages
// (contexte vide ou hasIndependentSource:true explicite), grounding actif
// (hasIndependentSource:true), pipeline "sujet libre" sans grounding trouvé
// (hasIndependentSource:false), et Comprendre (isComprehension:true).
test("multi-pipelines : le prompt reste construit sans exception pour les 4 contextes réels, avec les critères communs toujours présents", () => {
  const contexts = [
    {},
    { hasIndependentSource: true },
    { hasIndependentSource: false },
    { isComprehension: true }
  ];
  for (const context of contexts) {
    const prompt = buildSemanticReviewPrompt(sampleEntries(), context);
    assert.ok(prompt.length > 0);
    assert.match(prompt, /distracteurs incontestablement faux/i, "les critères communs restent présents dans tous les contextes");
    assert.match(prompt, /"verdict"/);
  }
});
