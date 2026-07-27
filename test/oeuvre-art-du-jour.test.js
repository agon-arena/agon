"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateArtworkPageMatch } = require("../lib/oeuvre-art-du-jour");

test("image d'œuvre : une page de série trop vague est refusée quand le titre demande une planche précise", () => {
  const ok = validateArtworkPageMatch(
    "Le Désastre de la guerre, planche 15 : « C’est la même chose »",
    "Les Désastres de la guerre",
    "Les Désastres de la guerre est une série d'eaux-fortes réalisée par Francisco de Goya."
  );

  assert.equal(ok, false);
});

test("image d'œuvre : le numéro et le sous-titre précis doivent correspondre", () => {
  const ok = validateArtworkPageMatch(
    "Los Desastres de la Guerra, No. 15 : Y no hai remedio",
    "Plate 15 from The Disasters of War: And there is nothing to be done",
    "Plate 15 from The Disasters of War, Los Desastres de la Guerra: Y no hai remedio."
  );

  assert.equal(ok, true);
});

test("image d'œuvre : un mauvais numéro est refusé même si le titre général correspond", () => {
  const ok = validateArtworkPageMatch(
    "Los Desastres de la Guerra, No. 15 : Y no hai remedio",
    "Los Desastres de la Guerra No. 03: Lo mismo",
    "Plate 3 from The Disasters of War."
  );

  assert.equal(ok, false);
});

test("image d'œuvre : un titre simple peut correspondre sans numéro ni sous-titre", () => {
  const ok = validateArtworkPageMatch(
    "Guernica",
    "Guernica (Picasso)",
    "Guernica is a large oil painting by Spanish artist Pablo Picasso."
  );

  assert.equal(ok, true);
});
