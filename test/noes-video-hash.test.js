"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { computeNoesVideoHash } = require("../lib/coeus/video-hash");

const BASE_PARAMS = { voice: "kokoro:ff_siwis", avatar: "coeusfemme2", pipelineVersion: "coeus-items-v1", thinkingPauseSeconds: 3 };

function items() {
  return [
    { knowledgeId: "k1", question: "En quelle année Constantinople tombe-t-elle ?", answer: "En 1453." },
    { knowledgeId: "k2", question: "Quel est le plus grand océan ?", answer: "L'océan Pacifique." }
  ];
}

test("même contenu, même hash (mutualisation entre utilisateurs)", () => {
  const h1 = computeNoesVideoHash({ items: items(), ...BASE_PARAMS });
  const h2 = computeNoesVideoHash({ items: items(), ...BASE_PARAMS });
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test("espaces/casse insensibles au texte réellement prononcé", () => {
  const h1 = computeNoesVideoHash({ items: items(), ...BASE_PARAMS });
  const variant = items();
  variant[0].question = "  EN QUELLE année   Constantinople tombe-t-elle ?  ";
  const h2 = computeNoesVideoHash({ items: variant, ...BASE_PARAMS });
  assert.equal(h1, h2);
});

test("l'ordre du batch change le hash (batching canonique obligatoire)", () => {
  const h1 = computeNoesVideoHash({ items: items(), ...BASE_PARAMS });
  const reversed = [...items()].reverse();
  const h2 = computeNoesVideoHash({ items: reversed, ...BASE_PARAMS });
  assert.notEqual(h1, h2);
});

test("une réponse modifiée change le hash", () => {
  const h1 = computeNoesVideoHash({ items: items(), ...BASE_PARAMS });
  const edited = items();
  edited[1].answer = "L'océan Atlantique.";
  const h2 = computeNoesVideoHash({ items: edited, ...BASE_PARAMS });
  assert.notEqual(h1, h2);
});

test("un changement de pipeline_version force une régénération", () => {
  const h1 = computeNoesVideoHash({ items: items(), ...BASE_PARAMS });
  const h2 = computeNoesVideoHash({ items: items(), ...BASE_PARAMS, pipelineVersion: "coeus-items-v2" });
  assert.notEqual(h1, h2);
});

test("un changement de voix ou d'avatar force une régénération", () => {
  const h1 = computeNoesVideoHash({ items: items(), ...BASE_PARAMS });
  assert.notEqual(h1, computeNoesVideoHash({ items: items(), ...BASE_PARAMS, voice: "kokoro:other" }));
  assert.notEqual(h1, computeNoesVideoHash({ items: items(), ...BASE_PARAMS, avatar: "coeusfemme3" }));
});

test("un changement de durée de pause force une régénération", () => {
  const h1 = computeNoesVideoHash({ items: items(), ...BASE_PARAMS });
  const h2 = computeNoesVideoHash({ items: items(), ...BASE_PARAMS, thinkingPauseSeconds: 4 });
  assert.notEqual(h1, h2);
});

test("refuse un batch vide", () => {
  assert.throws(() => computeNoesVideoHash({ items: [], ...BASE_PARAMS }));
});
