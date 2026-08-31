"use strict";

// Couvre lib/question-grounding-validation.js (V3, "fiabilisation factuelle
// des QCM par traçabilité aux sources", demande du 31/08/2026) — fonction
// pure et déterministe, aucun réseau, aucun appel IA. Chaque cas reproduit
// un exemple explicitement demandé (section 18).

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateQuestionGrounding, extractStructuredFacts, MAX_SOURCES_PER_QUESTION } = require("../lib/question-grounding-validation");

function qcm(overrides = {}) {
  return {
    type: "qcm",
    options: ["32 heures", "35 heures", "37 heures", "40 heures"],
    correctIndex: 1,
    supporting_claim: "La durée légale du travail à temps complet est fixée à 35 heures par semaine.",
    source_ids: ["SOURCE_1"],
    ...overrides
  };
}

const DUREE_TRAVAIL_SOURCES = {
  SOURCE_1: { text: "La durée légale du travail à temps complet est fixée à 35 heures par semaine, en application du Code du travail." }
};

// ── Cas valide ───────────────────────────────────────────────────────────

test("cas valide : réponse correcte, clairement attestée par la source citée", () => {
  const result = validateQuestionGrounding(qcm(), DUREE_TRAVAIL_SOURCES);
  assert.equal(result.ok, true);
  assert.ok(result.evidence);
});

// ── Nombre incorrect ─────────────────────────────────────────────────────

test("nombre incorrect : la source dit 35 heures, la réponse proposée est 39 heures → rejet", () => {
  const result = validateQuestionGrounding(
    qcm({ options: ["32 heures", "35 heures", "37 heures", "39 heures"], correctIndex: 3 }),
    DUREE_TRAVAIL_SOURCES
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "numeric_claim_not_supported");
});

// ── Date incorrecte ──────────────────────────────────────────────────────

test("date incorrecte : la source dit février 1916, la réponse propose 1914 → rejet", () => {
  const sources = { SOURCE_1: { text: "La bataille de Verdun commence en février 1916 et dure plusieurs mois." } };
  const result = validateQuestionGrounding({
    type: "qcm", options: ["1914", "1915", "1916", "1917"], correctIndex: 0,
    supporting_claim: "La bataille de Verdun commence en 1916.", source_ids: ["SOURCE_1"]
  }, sources);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "numeric_claim_not_supported");
});

// ── Source inconnue ──────────────────────────────────────────────────────

test("source inconnue : SOURCE_8 n'existe pas parmi les sources fournies → rejet", () => {
  const result = validateQuestionGrounding(qcm({ source_ids: ["SOURCE_8"] }), DUREE_TRAVAIL_SOURCES);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unknown_source");
});

test("le backend ne fait jamais confiance aux source_ids produits par l'IA : un mélange source valide + source inexistante est rejeté", () => {
  const result = validateQuestionGrounding(qcm({ source_ids: ["SOURCE_1", "SOURCE_9"] }), DUREE_TRAVAIL_SOURCES);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unknown_source");
});

// ── Claim absent ─────────────────────────────────────────────────────────

test("claim absent : supporting_claim vide → rejet", () => {
  const result = validateQuestionGrounding(qcm({ supporting_claim: "" }), DUREE_TRAVAIL_SOURCES);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_supporting_claim");
});

test("claim trop générique (sous le plancher de longueur) → rejet", () => {
  const result = validateQuestionGrounding(qcm({ supporting_claim: "Oui." }), DUREE_TRAVAIL_SOURCES);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_supporting_claim");
});

test("aucun source_ids fourni, même avec un claim valide → rejet", () => {
  const result = validateQuestionGrounding(qcm({ source_ids: [] }), DUREE_TRAVAIL_SOURCES);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_supporting_claim");
});

// ── Claim inventé (source réelle mais sans rapport avec l'affirmation précise) ──

test("claim inventé : la source parle de Verdun mais ne contient aucune information sur un bilan de victimes précis → rejet", () => {
  const sources = { SOURCE_1: { text: "La bataille de Verdun commence en février 1916 et dure plusieurs mois. Le conflit oppose la France à l'Allemagne." } };
  const result = validateQuestionGrounding({
    type: "qcm", options: ["470 morts", "500 morts", "600 morts", "700 morts"], correctIndex: 0,
    supporting_claim: "La bataille de Verdun a fait environ 470 morts le premier jour.", source_ids: ["SOURCE_1"]
  }, sources);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "claim_not_grounded_in_source");
});

// ── Précision excessive ──────────────────────────────────────────────────

test("précision excessive : la source dit 'environ 66 millions d'années', la question exige 66,04 → rejet", () => {
  const sources = { SOURCE_1: { text: "Les dinosaures disparaissent à la fin du Crétacé, il y a environ 66 millions d'années, lors d'une extinction massive." } };
  const result = validateQuestionGrounding({
    type: "qcm", options: ["65,5 millions", "66,04 millions", "67 millions", "68 millions"], correctIndex: 1,
    supporting_claim: "Les dinosaures ont disparu il y a 66,04 millions d'années.", source_ids: ["SOURCE_1"]
  }, sources);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "excessive_precision");
});

test("précision conforme à la source (même nombre de décimales) → accepté", () => {
  const sources = { SOURCE_1: { text: "Le taux d'inflation annuel s'établit à 2,4% selon les derniers chiffres publiés." } };
  const result = validateQuestionGrounding({
    type: "qcm", options: ["1,8%", "2,4%", "3,1%", "3,9%"], correctIndex: 1,
    supporting_claim: "Le taux d'inflation annuel s'établit à 2,4%.", source_ids: ["SOURCE_1"]
  }, sources);
  assert.equal(result.ok, true);
});

// ── Faux positif lexical (proximité contextuelle) ───────────────────────

test("faux positif lexical évité : '1914' et 'Verdun' présents séparément, à distance, dans la source ne prouvent jamais leur association → rejet", () => {
  const farText = "En 1914, la guerre éclate en Europe et bouleverse le continent pour les quatre années suivantes, entraînant la mobilisation de millions de soldats sur plusieurs fronts distincts à travers le vieux continent tout entier. "
    + "Bien plus tard dans le conflit, la bataille de Verdun devient un symbole de la résistance française face à l'offensive allemande, marquant durablement la mémoire collective nationale pour les décennies à venir.";
  const result = validateQuestionGrounding({
    type: "qcm", options: ["1914", "1915", "1916", "1917"], correctIndex: 0,
    supporting_claim: "La bataille de Verdun commence en 1914.", source_ids: ["SOURCE_1"]
  }, { SOURCE_1: { text: farText } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "numeric_claim_not_supported");
});

test("même fait dans la même phrase (proximité réelle) : accepté — le contrôle de proximité ne doit pas sur-rejeter un vrai passage source", () => {
  const nearText = "La bataille de Verdun commence en 1914 et devient un symbole majeur du conflit.";
  const result = validateQuestionGrounding({
    type: "qcm", options: ["1914", "1915", "1916", "1917"], correctIndex: 0,
    supporting_claim: "La bataille de Verdun commence en 1914.", source_ids: ["SOURCE_1"]
  }, { SOURCE_1: { text: nearText } });
  assert.equal(result.ok, true);
});

// ── Noms propres ─────────────────────────────────────────────────────────

test("nom propre correctement relié au fait (organisme) → accepté", () => {
  const sources = { SOURCE_1: { text: "L'Organisation mondiale de la santé recommande de se laver les mains pendant au moins 20 secondes avec du savon." } };
  const result = validateQuestionGrounding({
    type: "qcm", options: ["L'ONU", "L'Organisation mondiale de la santé", "L'UNESCO", "La Croix-Rouge"], correctIndex: 1,
    supporting_claim: "L'Organisation mondiale de la santé recommande un lavage des mains d'au moins 20 secondes.", source_ids: ["SOURCE_1"]
  }, sources);
  assert.equal(result.ok, true);
});

test("nom propre non attesté par la source (organisme différent) → rejeté", () => {
  const sources = { SOURCE_1: { text: "Le ministère de la Santé publie des recommandations sur le lavage des mains." } };
  const result = validateQuestionGrounding({
    type: "qcm", options: ["L'ONU", "L'Organisation mondiale de la santé", "L'UNESCO", "La Croix-Rouge"], correctIndex: 1,
    supporting_claim: "Le ministère de la Santé publie des recommandations sur le lavage des mains.", source_ids: ["SOURCE_1"]
  }, sources);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "answer_not_in_claim");
});

// ── Multi-source ─────────────────────────────────────────────────────────

test("multi-source valide : le fait est réellement réparti sur deux sources qui participent chacune → accepté", () => {
  const sources = {
    SOURCE_1: { text: "La bataille de Verdun commence en février 1916." },
    SOURCE_3: { text: "Le conflit à Verdun dure environ 300 jours et mobilise des centaines de milliers de soldats." }
  };
  const result = validateQuestionGrounding({
    type: "qcm", options: ["200 jours", "300 jours", "400 jours", "500 jours"], correctIndex: 1,
    supporting_claim: "La bataille de Verdun dure environ 300 jours.", source_ids: ["SOURCE_1", "SOURCE_3"]
  }, sources);
  assert.equal(result.ok, true);
});

test("mauvaise multi-source : deux sources citées mais aucune ne soutient réellement le fait → rejeté", () => {
  const sources = {
    SOURCE_1: { text: "La bataille de Verdun commence en février 1916 et se déroule dans la Meuse." },
    SOURCE_2: { text: "Le mémorial de Verdun est un musée ouvert au public toute l'année, avec des expositions permanentes." }
  };
  const result = validateQuestionGrounding({
    type: "qcm", options: ["200 jours", "300 jours", "400 jours", "500 jours"], correctIndex: 1,
    supporting_claim: "La bataille de Verdun dure environ 300 jours.", source_ids: ["SOURCE_1", "SOURCE_2"]
  }, sources);
  assert.equal(result.ok, false);
});

test("une source citée qui ne participe pas du tout au fait (pure décoration) est détectée même si l'autre source suffit", () => {
  const sources = {
    SOURCE_1: { text: "Le conflit à Verdun dure environ 300 jours et mobilise des centaines de milliers de soldats sur un front étroit." },
    SOURCE_2: { text: "Recette de cuisine : faites revenir les oignons dans une poêle avec un peu d'huile d'olive pendant cinq minutes." }
  };
  const result = validateQuestionGrounding({
    type: "qcm", options: ["200 jours", "300 jours", "400 jours", "500 jours"], correctIndex: 1,
    supporting_claim: "La bataille de Verdun dure environ 300 jours.", source_ids: ["SOURCE_1", "SOURCE_2"]
  }, sources);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "claim_not_grounded_in_source");
});

test("trop de sources citées (au-delà du maximum) → rejeté", () => {
  const sources = {
    SOURCE_1: { text: "La durée légale du travail à temps complet est fixée à 35 heures par semaine." },
    SOURCE_2: { text: "La durée légale du travail à temps complet est fixée à 35 heures par semaine." },
    SOURCE_3: { text: "La durée légale du travail à temps complet est fixée à 35 heures par semaine." },
    SOURCE_4: { text: "La durée légale du travail à temps complet est fixée à 35 heures par semaine." }
  };
  assert.equal(MAX_SOURCES_PER_QUESTION, 3);
  const result = validateQuestionGrounding(qcm({ source_ids: ["SOURCE_1", "SOURCE_2", "SOURCE_3", "SOURCE_4"] }), sources);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "too_many_sources");
});

// ── Paraphrase raisonnable : jamais rejetée pour la seule formulation ────

test("paraphrase correcte : la réponse reformule la source sans utiliser exactement les mêmes mots → accepté (section 20)", () => {
  const sources = { SOURCE_1: { text: "Le Sahara est le plus grand désert chaud du monde, situé en Afrique du Nord." } };
  const result = validateQuestionGrounding({
    type: "qcm", options: ["L'Antarctique", "Le Sahara", "Le Gobi", "Le Kalahari"], correctIndex: 1,
    supporting_claim: "Le Sahara est le plus vaste désert chaud de la planète, en Afrique du Nord.", source_ids: ["SOURCE_1"]
  }, sources);
  assert.equal(result.ok, true);
});

// ── Types de questions autres que qcm classique (section 13) ────────────

test("qcm_multi : chaque bonne réponse cochée doit être individuellement soutenue", () => {
  const sources = { SOURCE_1: { text: "La France et le Royaume-Uni sont membres permanents du Conseil de sécurité de l'ONU, aux côtés des États-Unis, de la Russie et de la Chine." } };
  const result = validateQuestionGrounding({
    type: "qcm_multi", options: ["France", "Allemagne", "Royaume-Uni", "Italie", "Espagne"], correctIndexes: [0, 2],
    supporting_claim: "La France et le Royaume-Uni sont membres permanents du Conseil de sécurité de l'ONU.", source_ids: ["SOURCE_1"]
  }, sources);
  assert.equal(result.ok, true);
});

test("qcm_multi : une des bonnes réponses cochées n'est en réalité pas soutenue → rejeté", () => {
  const sources = { SOURCE_1: { text: "La France est membre permanent du Conseil de sécurité de l'ONU." } };
  const result = validateQuestionGrounding({
    type: "qcm_multi", options: ["France", "Allemagne", "Royaume-Uni", "Italie", "Espagne"], correctIndexes: [0, 2],
    supporting_claim: "La France est membre permanent du Conseil de sécurité de l'ONU.", source_ids: ["SOURCE_1"]
  }, sources);
  assert.equal(result.ok, false);
});

test("association : chaque paire doit être soutenue par la source citée", () => {
  const sources = { SOURCE_1: { text: "Paris est la capitale de la France. Rome est la capitale de l'Italie." } };
  const result = validateQuestionGrounding({
    type: "association", pairs: [{ left: "France", right: "Paris" }, { left: "Italie", right: "Rome" }],
    supporting_claim: "Paris est la capitale de la France, Rome est la capitale de l'Italie.", source_ids: ["SOURCE_1"]
  }, sources);
  assert.equal(result.ok, true);
});

// ── extractStructuredFacts : régression du découpage des nombres ────────

test("extractStructuredFacts : une année à 4 chiffres n'est jamais scindée en deux nombres (régression)", () => {
  const facts = extractStructuredFacts("La bataille commence en 1916.");
  assert.deepEqual(facts.map((f) => f.raw), ["1916"]);
  assert.equal(facts[0].value, 1916);
});

test("extractStructuredFacts : un nombre décimal n'est jamais compté deux fois (partie entière + décimale)", () => {
  const facts = extractStructuredFacts("Il y a environ 66,04 millions d'années.");
  assert.deepEqual(facts.map((f) => f.raw), ["66,04"]);
  assert.equal(facts[0].decimals, 2);
});

test("extractStructuredFacts : un nombre avec séparateur de milliers est reconnu comme un seul token", () => {
  const facts = extractStructuredFacts("Environ 1 200 000 habitants vivent dans cette région.");
  assert.ok(facts.some((f) => f.value === 1200000));
});

// ── Régression V3.1 (31/08/2026) : forme "variants[]" (format réel de   ────
// ── generateNotionLevelQuiz) — resolveAnswerTexts ne regardait auparavant  ─
// ── QUE la forme à plat et ne trouvait donc jamais de réponse à vérifier. ─

test("forme variants[] : une réponse incorrecte dans variants[0] est bien détectée (jamais ignorée faute de type/options au niveau racine)", () => {
  const sources = { SOURCE_1: { text: "La durée légale du travail à temps complet est fixée à 35 heures par semaine." } };
  const result = validateQuestionGrounding({
    knowledgeTarget: "La durée légale du travail est de 35 heures.",
    supporting_claim: "La durée légale du travail à temps complet est fixée à 35 heures par semaine.",
    source_ids: ["SOURCE_1"],
    variants: [{ type: "qcm", options: ["32 heures", "35 heures", "37 heures", "39 heures"], correctIndex: 3, question: "Q ?", explanation: "..." }]
  }, sources);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "numeric_claim_not_supported");
});

test("forme variants[] : une réponse correcte dans variants[0] est acceptée", () => {
  const sources = { SOURCE_1: { text: "La durée légale du travail à temps complet est fixée à 35 heures par semaine." } };
  const result = validateQuestionGrounding({
    knowledgeTarget: "La durée légale du travail est de 35 heures.",
    supporting_claim: "La durée légale du travail à temps complet est fixée à 35 heures par semaine.",
    source_ids: ["SOURCE_1"],
    variants: [{ type: "qcm", options: ["32 heures", "35 heures", "37 heures", "40 heures"], correctIndex: 1, question: "Q ?", explanation: "..." }]
  }, sources);
  assert.equal(result.ok, true);
});

test("forme variants[] : PLUSIEURS variantes — une réponse incorrecte dans une variante secondaire est aussi détectée, jamais seulement variants[0]", () => {
  const sources = { SOURCE_1: { text: "La durée légale du travail à temps complet est fixée à 35 heures par semaine." } };
  const result = validateQuestionGrounding({
    knowledgeTarget: "La durée légale du travail est de 35 heures.",
    supporting_claim: "La durée légale du travail à temps complet est fixée à 35 heures par semaine.",
    source_ids: ["SOURCE_1"],
    variants: [
      { type: "qcm", options: ["32 heures", "35 heures", "37 heures", "40 heures"], correctIndex: 1, question: "Q1 ?", explanation: "..." },
      { type: "qcm", options: ["32 heures", "36 heures", "37 heures", "40 heures"], correctIndex: 1, question: "Q2 ?", explanation: "..." }
    ]
  }, sources);
  assert.equal(result.ok, false, "la seconde variante (36 heures, non soutenue) doit à elle seule faire échouer la validation");
});
