"use strict";

// Sélection de passages représentatifs pour le grounding web (chantier
// "qualité éditoriale du pipeline QCM progressif", 07/09/2026, PROBLÈME 1 —
// "corpus web tronqué trop tôt"). Module PUR (lib/source-excerpt-selection.js),
// testé directement — aucun réseau, aucun appel IA.
//
// Cas réel qui a motivé ce chantier : test "Empire ottoman" (page Wikipédia
// de 192 515 caractères), où les 2500 premiers caractères transmis au modèle
// (`text.slice(0, WEB_SEARCH_EXCERPT_MAX_CHARS)`) ne contenaient QUE
// l'infobox linéarisée par Readability ("Sultan • c. 1299–1323/4 (first)
// Osman I", "Government Absolute monarchy...") — aucune phrase de prose,
// aucune information sur l'apogée, les institutions ou les transformations
// de l'empire, malgré leur présence ailleurs dans l'article.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  TARGET_CHUNK_CHARS,
  splitIntoSentences,
  chunkSentences,
  scoreChunk,
  bucketIndexFor,
  selectRepresentativeExcerpt
} = require("../lib/source-excerpt-selection");

// ── splitIntoSentences ──────────────────────────────────────────────────

test("splitIntoSentences : découpe sur la ponctuation de fin de phrase", () => {
  const sentences = splitIntoSentences("Premier fait. Deuxième fait ! Troisième fait ?");
  assert.equal(sentences.length, 3);
  assert.equal(sentences[0], "Premier fait.");
});

test("splitIntoSentences : texte sans ponctuation -> une seule \"phrase\", jamais une exception", () => {
  assert.deepEqual(splitIntoSentences("Un bloc de texte sans point"), ["Un bloc de texte sans point"]);
});

test("splitIntoSentences : entrée vide/null -> tableau vide", () => {
  assert.deepEqual(splitIntoSentences(""), []);
  assert.deepEqual(splitIntoSentences(null), []);
});

// ── chunkSentences ───────────────────────────────────────────────────────

test("chunkSentences : regroupe des phrases jusqu'à environ TARGET_CHUNK_CHARS, sans jamais couper une phrase en deux", () => {
  const sentence = "Ceci est une phrase de taille moyenne pour le test de découpage. ";
  const sentences = Array.from({ length: 20 }, () => sentence.trim() + ".");
  const chunks = chunkSentences(sentences, 200);
  assert.ok(chunks.length > 1, "doit produire plusieurs chunks");
  for (const chunk of chunks) {
    assert.ok(!chunk.text.includes("undefined"));
  }
  // Chaque phrase d'origine doit être retrouvée intacte dans l'un des chunks.
  const joined = chunks.map((c) => c.text).join(" ");
  for (const sentence2 of sentences) assert.ok(joined.includes(sentence2));
});

test("chunkSentences : fusionne un dernier chunk trop court avec le précédent plutôt que de le laisser isolé", () => {
  const chunks = chunkSentences(["Phrase longue numéro un qui remplit une bonne partie du chunk cible ici.", "Courte."], 80);
  assert.ok(chunks.length >= 1);
  assert.ok(chunks[chunks.length - 1].text.includes("Courte."));
});

test("chunkSentences : conserve l'ordre de lecture via `index`", () => {
  const chunks = chunkSentences(["A.", "B.", "C."], 1);
  assert.deepEqual(chunks.map((c) => c.index), chunks.map((_, i) => i));
});

// ── scoreChunk : pénalise l'infobox, récompense la prose ─────────────────

const INFOBOX_LIKE = "Sultan • c. 1299–1323/4 (first) Osman I Government Absolute monarchy (1299–1876; 1878–1908; 1920–1922) Religion Sunni Islam (state) Currency Akçe Kuruş Lira Area 1914 estimate 1,800,000 km2 Population 1856 estimate 35,350,000";
const PROSE_LIKE = "L'organisation administrative repose sur un système de gouvernance centralisé qui s'adapte progressivement aux réalités locales de chaque province, en s'appuyant sur une bureaucratie recrutée selon des critères spécifiques et sur une hiérarchie militaire structurée.";

test("scoreChunk : un fragment de type infobox (chiffres et paires étiquette/valeur denses) obtient un score nettement plus bas qu'un paragraphe de prose", () => {
  assert.ok(scoreChunk(INFOBOX_LIKE) < scoreChunk(PROSE_LIKE));
  assert.ok(scoreChunk(INFOBOX_LIKE) < 0);
  assert.ok(scoreChunk(PROSE_LIKE) > 0);
});

test("scoreChunk : reste générique — le même écart infobox/prose se vérifie sur un sujet scientifique, sans aucun vocabulaire d'histoire", () => {
  const scienceInfobox = "Masse 1,899 × 10^27 kg Rayon 69 911 km Période orbitale 11,86 années Satellites connus 95 Température moyenne −108 °C Composition Hydrogène Hélium";
  const scienceProse = "L'atmosphère de la planète se compose principalement d'hydrogène et d'hélium, avec des bandes nuageuses visibles qui résultent de vents extrêmement puissants circulant à des vitesses très élevées selon la latitude considérée.";
  assert.ok(scoreChunk(scienceInfobox) < scoreChunk(scienceProse));
  assert.ok(scoreChunk(scienceProse) > 0);
});

test("scoreChunk : une suite de phrases très courtes et répétitives (jamais une vraie prose) n'obtient pas un score artificiellement élevé", () => {
  const repetitive = "Fait bref. Fait bref. Fait bref. Fait bref. Fait bref. Fait bref. Fait bref. Fait bref.";
  assert.ok(scoreChunk(repetitive) < scoreChunk(PROSE_LIKE));
});

test("scoreChunk : chunk vide -> -Infinity, jamais une exception", () => {
  assert.equal(scoreChunk(""), -Infinity);
});

// ── bucketIndexFor : diversité positionnelle ─────────────────────────────

test("bucketIndexFor : répartit des positions croissantes sur des buckets croissants", () => {
  assert.equal(bucketIndexFor(0, 12, 6), 0);
  assert.equal(bucketIndexFor(11, 12, 6), 5);
  assert.ok(bucketIndexFor(6, 12, 6) > bucketIndexFor(0, 12, 6));
});

test("bucketIndexFor : un seul chunk total -> bucket 0, jamais une division par zéro", () => {
  assert.equal(bucketIndexFor(0, 1, 6), 0);
});

// ── selectRepresentativeExcerpt : comportement sur pages courtes ────────

test("selectRepresentativeExcerpt : texte déjà sous le budget -> renvoyé tel quel, jamais chunké/réordonné", () => {
  const text = "Un texte court largement sous le budget.";
  const { excerpt, stats } = selectRepresentativeExcerpt(text, { budgetChars: 4000 });
  assert.equal(excerpt, text);
  assert.equal(stats.rawChars, text.length);
  assert.equal(stats.keptChars, text.length);
  assert.equal(stats.chunkCount, 1);
});

test("selectRepresentativeExcerpt : budget invalide ou texte vide -> excerpt vide, jamais une exception", () => {
  assert.equal(selectRepresentativeExcerpt("", { budgetChars: 4000 }).excerpt, "");
  assert.equal(selectRepresentativeExcerpt("du texte", { budgetChars: 0 }).excerpt, "");
  assert.equal(selectRepresentativeExcerpt("du texte", { budgetChars: -1 }).excerpt, "");
  assert.equal(selectRepresentativeExcerpt(null, { budgetChars: 4000 }).excerpt, "");
});

// ── selectRepresentativeExcerpt : le cas réel "Empire ottoman" ──────────

function buildLongDocument() {
  const infobox = "Sultan • c. 1299–1323/4 (first) Osman I • 1918–1922 (last) Mehmed VI Capital Söğüt (1299–1331) Nicaea (1331–1335) Bursa (1335–1360s) Edirne (1360s–1453) Constantinople (1453–1922) Government Absolute monarchy (1299–1876; 1878–1908; 1920–1922) Constitutional monarchy (1876–1878; 1908–1920) Religion Sunni Islam (state) Currency Akçe Kuruş Lira Area 1914 estimate 1,800,000 km2 Population 1856 estimate 35,350,000 1906 estimate 20,884,000 Established 1299 Disestablished 1922";
  const intro = "L'Empire ottoman est un empire multiethnique et multiconfessionnel qui a existé de la fin du treizième siècle jusqu'au début du vingtième siècle. Fondé en Anatolie par des tribus turcomanes, il devient l'un des États les plus puissants du monde à son apogée, s'étendant sur trois continents.";
  const constantinople = "Après la prise de Constantinople en 1453, les sultans ottomans réorganisent profondément l'administration impériale, en s'appuyant sur un système fiscal centralisé et sur une bureaucratie recrutée notamment parmi les janissaires. Cette réorganisation favorise une stabilité politique durable qui permet à l'empire d'étendre son influence sur plusieurs continents.";
  const filler = "Les relations entre les différentes provinces de l'empire évoluent sensiblement au fil des siècles, reflétant des équilibres politiques locaux variés et des ajustements administratifs progressifs adaptés à chaque région rattachée à l'empire au fil des conquêtes successives.";
  const suleiman = "Sous le règne de Soliman le Magnifique, l'empire atteint son apogée territoriale et culturelle, avec une réforme législative majeure et un rayonnement artistique important qui influence durablement les cours européennes voisines pendant plusieurs générations.";
  const decline = "Au dix-neuvième siècle, l'empire connaît d'importantes transformations institutionnelles, avec l'adoption de réformes constitutionnelles successives qui tentent de moderniser l'administration face à des difficultés économiques et militaires croissantes et persistantes.";
  // Le bloc infobox est répété en tête pour simuler un très long article où
  // les WEB_SEARCH_EXCERPT_MAX_CHARS premiers caractères pris naïvement
  // seraient TOUS de type infobox (cf. cas réel mesuré).
  const leadingInfoboxPadding = (infobox + " ").repeat(6);
  return leadingInfoboxPadding + " " + [intro, filler, constantinople, filler, suleiman, filler, decline].join(" ");
}

test("cas réel \"Empire ottoman\" : un slice(0, budget) naïf serait presque entièrement de l'infobox — selectRepresentativeExcerpt l'évite", () => {
  const longDoc = buildLongDocument();
  const budgetChars = 900;
  const naiveSlice = longDoc.slice(0, budgetChars);
  // Confirme que le scénario de test reproduit bien le problème réel : la
  // stratégie naïve serait effectivement dominée par l'infobox.
  assert.ok(scoreChunk(naiveSlice) < 0, "le slice naïf doit être structurellement infobox-like dans ce scénario");

  const { excerpt, stats } = selectRepresentativeExcerpt(longDoc, { budgetChars });
  assert.ok(excerpt.length <= budgetChars, "respecte strictement le budget");
  assert.ok(!excerpt.includes("Sultan •"), "l'excerpt sélectionné ne doit plus contenir l'infobox");
  assert.ok(/Soliman|Constantinople|dix-neuvième|provinces/.test(excerpt), "l'excerpt doit contenir de la vraie prose issue du corps du document, pas seulement l'introduction");
  assert.ok(stats.chunkCount > stats.keptChunkCount, "seule une partie des chunks disponibles est retenue");
});

test("selectRepresentativeExcerpt : le budget est toujours strictement respecté, quelle que soit la taille du document", () => {
  const longDoc = buildLongDocument().repeat(5);
  for (const budgetChars of [200, 1000, 4000, 8000]) {
    const { excerpt } = selectRepresentativeExcerpt(longDoc, { budgetChars });
    assert.ok(excerpt.length <= budgetChars, `budget=${budgetChars}, obtenu=${excerpt.length}`);
  }
});

test("selectRepresentativeExcerpt : télémétrie cohérente (rawChars/keptChars/chunkCount/highDensityChunkRatio)", () => {
  const longDoc = buildLongDocument();
  const { stats } = selectRepresentativeExcerpt(longDoc, { budgetChars: 900 });
  assert.equal(stats.rawChars, longDoc.trim().length);
  assert.ok(stats.keptChars <= 900);
  assert.ok(stats.chunkCount > 0);
  assert.ok(stats.keptChunkCount > 0 && stats.keptChunkCount <= stats.chunkCount);
  assert.ok(stats.highDensityChunkRatio >= 0 && stats.highDensityChunkRatio <= 1);
});

test("selectRepresentativeExcerpt : source ENTIÈREMENT infobox (aucun chunk de qualité positive) -> renvoie malgré tout un extrait, jamais vide", () => {
  const allInfobox = "Sultan • c. 1299 Government Absolute Religion Sunni Currency Akçe Area 1,800,000 km2 Population 35,350,000 Established 1299 Disestablished 1922 Capital Söğüt Nicaea Bursa Edirne Constantinople ".repeat(20);
  const { excerpt, stats } = selectRepresentativeExcerpt(allInfobox, { budgetChars: 500 });
  assert.ok(excerpt.length > 0, "mieux vaut un extrait imparfait qu'un extrait vide");
  assert.ok(stats.keptChars <= 500);
});

// ── Généricité : aucun vocabulaire spécifique à l'histoire dans le module ─

test("le module reste générique — aucun terme spécifique à l'histoire, à Wikipédia ou à une discipline particulière n'est codé en dur", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "source-excerpt-selection.js"), "utf8");
  const code = source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  for (const forbidden of [/wikipedia/i, /ottoman/i, /empire/i, /sultan/i, /histoire/i]) {
    assert.doesNotMatch(code, forbidden, `le CODE (hors commentaires) ne doit jamais référencer : ${forbidden}`);
  }
});
