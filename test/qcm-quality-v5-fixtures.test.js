"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runQuestionQualityPipeline } = require("../lib/qcm-quality");

function question(id, overrides = {}) {
  return {
    sourceId: id,
    knowledgeTarget: "Ottawa est la capitale fédérale du Canada.",
    type: "qcm",
    question: "Quelle est la capitale fédérale du Canada ?",
    options: ["Ottawa", "Toronto", "Montréal", "Vancouver"],
    correctIndex: 0,
    explanation: "Ottawa est la capitale fédérale du Canada.",
    ...overrides
  };
}

const REJECTED_FIXTURES = [
  question("outside-category", {
    question: "Parmi ces réponses, laquelle n'est pas une ville canadienne ?",
    options: ["Ottawa", "Toronto", "Montréal", "La photosynthèse"],
    expectedCode: "CATEGORY_MISMATCH"
  }),
  question("too-distant", {
    question: "Quel ensemble d'options permet d'identifier la capitale canadienne ?",
    options: ["Ottawa", "Toronto", "Montréal", "Buenos Aires"],
    expectedCode: "WEAK_DISTRACTOR_SET"
  }),
  question("salient-answer", {
    knowledgeTarget: "La photosynthèse transforme l'énergie lumineuse en énergie chimique stockée dans le glucose.",
    question: "Quel mécanisme décrit la photosynthèse ?",
    options: ["Un effet local", "Un phénomène secondaire", "La conversion de l'énergie lumineuse en énergie chimique stockée dans le glucose", "Une influence externe"],
    correctIndex: 2,
    expectedCode: "ANSWER_SALIENCE"
  }),
  question("ambiguous", {
    question: "Quelle ville joue un rôle politique majeur au Canada ?",
    options: ["Ottawa", "Toronto", "Montréal", "Vancouver"],
    expectedCode: "AMBIGUOUS_DISTRACTOR"
  }),
  question("artificial", {
    question: "Quelle ville est officiellement la capitale fédérale canadienne ?",
    options: ["Ottawa", "Toronto", "Montréal", "Le fédéralisme ottawien quantique"],
    expectedCode: "ARTIFICIAL_DISTRACTOR"
  }),
  question("obvious-positive-intruder", {
    knowledgeTarget: "Dans certaines colonies, l'éducation diffusait la langue et des références culturelles de la puissance coloniale.",
    type: "intrus",
    question: "Quel élément est l'intrus parmi ces effets de l'éducation coloniale ?",
    options: ["Diffuser une langue", "Former des élites administratives", "Transmettre des références culturelles", "Garantir l'émancipation complète des colonisés"],
    correctIndex: 3,
    expectedCode: "GUESSABLE_WITHOUT_KNOWLEDGE"
  }),
  question("obvious-era-intruder", {
    knowledgeTarget: "La mécanisation transforme la production industrielle au XIXe siècle.",
    type: "intrus",
    question: "Quel élément est l'intrus parmi ces techniques industrielles du XIXe siècle ?",
    options: ["Machine à vapeur", "Métier mécanique", "Locomotive à vapeur", "Réseau social numérique"],
    correctIndex: 3,
    expectedCode: "GUESSABLE_WITHOUT_KNOWLEDGE"
  }),
  question("overgeneralized", {
    knowledgeTarget: "Dans certaines colonies britanniques au XIXe siècle, l'éducation pouvait diffuser des références culturelles britanniques.",
    question: "Quel était l'objectif de l'éducation dans l'Empire britannique ?",
    options: ["Diffuser la culture britannique", "Former uniquement des ingénieurs", "Supprimer toute administration", "Interdire l'anglais"],
    expectedCode: "OVERGENERALIZED_QUESTION"
  })
];

const ACCEPTED_FIXTURES = [
  question("good-capital"),
  question("good-revolution", {
    knowledgeTarget: "La prise de la Bastille a lieu le 14 juillet 1789.",
    question: "À quelle date a lieu la prise de la Bastille ?",
    options: ["14 juillet 1789", "20 juin 1789", "4 août 1789", "26 août 1789"]
  }),
  question("good-science", {
    knowledgeTarget: "La chlorophylle absorbe principalement la lumière rouge et bleue.",
    question: "Quelles couleurs la chlorophylle absorbe-t-elle principalement ?",
    options: ["Rouge et bleu", "Vert et jaune", "Orange et vert", "Jaune et violet"]
  }),
  question("good-rocky-intruder", {
    knowledgeTarget: "Mercure, Vénus, la Terre et Mars sont telluriques, contrairement à Jupiter qui est gazeuse.",
    type: "intrus",
    question: "Quelle planète est l'intrus parmi ces planètes telluriques ?",
    options: ["Mercure", "Vénus", "Jupiter", "Mars"],
    correctIndex: 2
  }),
  question("good-mammal-intruder", {
    knowledgeTarget: "La baleine, le dauphin et la chauve-souris sont des mammifères, contrairement au requin qui est un poisson.",
    type: "intrus",
    question: "Quel animal est l'intrus parmi ces mammifères ?",
    options: ["Baleine", "Dauphin", "Requin", "Chauve-souris"],
    correctIndex: 2
  }),
  question("good-contextualized", {
    knowledgeTarget: "Dans certaines colonies britanniques au XIXe siècle, l'éducation pouvait diffuser des références culturelles britanniques.",
    question: "Dans certaines colonies britanniques au XIXe siècle, quel rôle culturel l'éducation pouvait-elle jouer ?",
    options: ["Diffuser des références britanniques", "Diffuser des références françaises", "Diffuser des références russes", "Diffuser des références japonaises"]
  })
];

test("V5 fixtures : les huit défauts observés sont rejetés avec leur reason code pédagogique", async () => {
  const result = await runQuestionQualityPipeline(REJECTED_FIXTURES, {
    maxRetries: 0,
    reviewSemantic: async ({ entries }) => ({
      reviews: entries.map((entry, index) => ({
        id: entry.id,
        verdict: "reject",
        reasonCodes: [REJECTED_FIXTURES[index].expectedCode],
        expectedCorrectIndexes: [REJECTED_FIXTURES[index].correctIndex],
        targetsKnowledge: true,
        groundedInSource: true
      }))
    })
  });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, REJECTED_FIXTURES.length);
  assert.deepEqual(result.rejected.map((entry) => entry.reasons[0].code), REJECTED_FIXTURES.map((entry) => entry.expectedCode));
});

test("V5 fixtures : trois bons QCM, deux vrais intrus et une question contextualisée restent acceptables", async () => {
  const result = await runQuestionQualityPipeline(ACCEPTED_FIXTURES, {
    maxRetries: 0,
    reviewSemantic: async ({ entries }) => ({
      reviews: entries.map((entry, index) => ({
        id: entry.id,
        verdict: "accept",
        reasonCodes: [],
        expectedCorrectIndexes: [ACCEPTED_FIXTURES[index].correctIndex],
        targetsKnowledge: true,
        groundedInSource: true
      }))
    })
  });
  assert.equal(result.rejected.length, 0);
  assert.equal(result.accepted.length, ACCEPTED_FIXTURES.length);
  assert.deepEqual(result.accepted, ACCEPTED_FIXTURES);
});
