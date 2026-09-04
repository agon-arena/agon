"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { truncateAtTextBoundary, splitTextAtBoundaries, truncateAtSentenceBoundary } = require("../lib/text-boundaries");

test("knowledgeTarget n'est pas coupé au milieu d'une phrase", () => {
  const first = "La Révolution française débute en 1789 et transforme durablement les institutions.";
  const second = "Elle ouvre ensuite une nouvelle période politique en France.";
  const truncated = truncateAtTextBoundary(`${first} ${second}`, first.length + 12);
  assert.equal(truncated, first);
});

test("découpage PDF : frontière de phrase, chevauchement maîtrisé et limite respectée", () => {
  const text = Array.from({ length: 20 }, (_, index) => `La phrase numéro ${index + 1} contient une information complète.`).join(" ");
  const chunks = splitTextAtBoundaries(text, 180, 45);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 180));
  assert.ok(chunks.slice(0, -1).every((chunk) => /[.!?]$/.test(chunk)));
  const wordsA = new Set(chunks[0].split(/\s+/));
  assert.ok(chunks[1].split(/\s+/).some((word) => wordsA.has(word)), "un léger contexte doit se chevaucher");
});

// ── truncateAtSentenceBoundary (Phase 2.2, 04/09/2026) : "paragraphe
// pédagogique jamais servi tronqué en milieu de phrase". Cas réel corrigé :
// "En 532, Justinien décide de faire réprimer la révolte avec" (coupé avant
// "l'aide du général Bélisaire.") — jamais reproductible avec cette
// fonction, quel que soit le plafond. ─────────────────────────────────────

test("1. paragraphe normal se terminant par un point, sous le plafond : préservé intact", () => {
  const text = "En 532, Justinien fait réprimer la révolte de Nika avec l'aide du général Bélisaire.";
  assert.equal(truncateAtSentenceBoundary(text, 500), text);
});

test("2. paragraphe multi-phrases sous le plafond : toutes les phrases préservées, rien coupé", () => {
  const s1 = "Justinien règne de 527 à 565.";
  const s2 = "Il fait de Constantinople sa capitale.";
  const s3 = "Il poursuit la renovatio imperii, la restauration de l'Empire romain.";
  const text = `${s1} ${s2} ${s3}`;
  assert.equal(truncateAtSentenceBoundary(text, 500), text);
});

test("3. plafond atteint en plein milieu d'une phrase : jamais la demi-phrase conservée seule", () => {
  const s1 = "Justinien règne de 527 à 565 sur l'Empire byzantin.";
  const s2 = "En 532, Justinien fait réprimer la révolte de Nika avec l'aide du général Bélisaire.";
  const s3 = "Théodora joue un rôle politique de premier plan à ses côtés.";
  const text = `${s1} ${s2} ${s3}`;
  // Plafond choisi précisément EN PLEIN MILIEU de s2 (reproduit le cas réel
  // "...faire réprimer la révolte avec" coupé avant "l'aide du général").
  const limit = text.indexOf("avec") + 4;
  const truncated = truncateAtSentenceBoundary(text, limit);
  assert.ok(!truncated.includes("la révolte de Nika avec"), "la demi-phrase de s2 ne doit jamais apparaître seule");
  assert.equal(truncated, s1, "seule s1, entière, doit être conservée");
});

test("4. réduction nécessaire : coupe exactement à la dernière frontière de phrase valide sous le plafond", () => {
  const s1 = "Justinien règne de 527 à 565.";
  const s2 = "Il fait de Constantinople sa capitale.";
  const s3 = "Il poursuit la renovatio imperii, la restauration de l'Empire romain, avec ambition.";
  const text = `${s1} ${s2} ${s3}`;
  // Plafond qui tombe DANS s3 : doit s'arrêter après s2, jamais inclure un
  // fragment de s3.
  const limit = text.indexOf("renovatio") + 5;
  const truncated = truncateAtSentenceBoundary(text, limit);
  assert.equal(truncated, `${s1} ${s2}`);
});

test("5. aucune fonction de post-traitement ne transforme une phrase complète en phrase tronquée (texte déjà sous le plafond, jamais altéré même par un simple trim de bord)", () => {
  const text = "  Une phrase complète, avec des espaces superflus autour.  ";
  assert.equal(truncateAtSentenceBoundary(text, 5000), text.trim());
});

test("repli sûr : aucune frontière de phrase sous le plafond (une seule phrase déjà plus longue que le plafond) — renvoie le texte COMPLET plutôt qu'un fragment corrompu, jamais un slice arbitraire", () => {
  const text = "Une phrase exceptionnellement longue et dépourvue de toute ponctuation forte qui dépasse largement le plafond fixé pour ce bloc de fiche pédagogique";
  const truncated = truncateAtSentenceBoundary(text, 40);
  assert.equal(truncated, text, "jamais de fragment mi-phrase : le texte complet est préférable à une coupure arbitraire");
});

test("repli sûr : texte sans AUCUNE ponctuation finale (label-like), toujours renvoyé complet plutôt que coupé au milieu d'un mot", () => {
  const text = "un texte sans point final qui continue encore et encore sans jamais terminer par une ponctuation forte";
  assert.equal(truncateAtSentenceBoundary(text, 30), text);
});

test("jamais de ponctuation ajoutée artificiellement : le résultat se termine toujours sur une ponctuation déjà présente dans le texte source, jamais fabriquée", () => {
  const s1 = "Première phrase correcte.";
  const s2 = "Deuxième phrase qui sera coupée en plein vol par le plafond choisi ici";
  const text = `${s1} ${s2}`;
  const truncated = truncateAtSentenceBoundary(text, s1.length + 10);
  assert.equal(truncated, s1);
  assert.ok(!truncated.endsWith("...") && truncated.endsWith("."), "aucun point ajouté mécaniquement, uniquement celui déjà présent dans s1");
});

test("gère les guillemets/parenthèses fermants après la ponctuation finale (« ... ». reste une frontière valide)", () => {
  const s1 = 'Il déclare : « la paix avant tout ».';
  const s2 = "Cette phrase continue ensuite avec un développement plus long qui dépasse le plafond fixé.";
  const text = `${s1} ${s2}`;
  const truncated = truncateAtSentenceBoundary(text, s1.length + 15);
  assert.equal(truncated, s1);
});
