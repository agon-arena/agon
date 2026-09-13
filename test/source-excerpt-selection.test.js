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
  trimTrailingReferenceSentences,
  stratifiedIndices,
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

// ══════════════════════════════════════════════════════════════════════
// Correctif "sujet gigantesque" (12/09/2026, cas réels "Révolution
// française" et "Aires urbaines" — diagnostic qualité éditoriale du
// pipeline QCM progressif). Reproduit, avec des documents SYNTHÉTIQUES
// (aucun réseau, aucun appel IA), les deux défauts mesurés sur les vrais
// articles Wikipédia :
//   (a) un plancher de 6 buckets POSITIONNELS fixes, quelle que soit la
//       taille du document, faisait tenir plusieurs grands sous-thèmes
//       distincts dans le MÊME bucket — un seul survivait, au hasard du
//       score de prose (mesuré : le curriculum réel ne couvrait que le
//       vote aux États généraux et les factions, jamais la Bastille, la
//       DDHC, la République ou la Terreur, pourtant bien présents) ;
//   (b) la liste de notes/bibliographie de fin d'article (repérée par le
//       marqueur de renvoi "↑") pouvait représenter jusqu'à ~26 % des
//       caractères d'un grand article SANS jamais rien apporter, tout en
//       obtenant un score de prose comparable au corps de l'article.
// ══════════════════════════════════════════════════════════════════════

// ── trimTrailingReferenceSentences ──────────────────────────────────────

test("trimTrailingReferenceSentences : tronque à partir de la première phrase portant le marqueur de renvoi, jamais avant", () => {
  const sentences = [
    "Premier fait du corps de l'article.",
    "Second fait du corps de l'article.",
    "↑ Première note de bas de page.",
    "↑ Seconde note de bas de page."
  ];
  const trimmed = trimTrailingReferenceSentences(sentences);
  assert.deepEqual(trimmed, sentences.slice(0, 2));
});

test("trimTrailingReferenceSentences : aucun marqueur -> renvoie les phrases inchangées", () => {
  const sentences = ["Un fait.", "Un autre fait."];
  const trimmed = trimTrailingReferenceSentences(sentences);
  assert.deepEqual(trimmed, sentences);
});

test("trimTrailingReferenceSentences : marqueur dès la toute première phrase -> ne tronque rien (mieux vaut ne rien perdre qu'un faux positif)", () => {
  const sentences = ["↑ Texte inhabituel dès le début.", "Suite du texte."];
  const trimmed = trimTrailingReferenceSentences(sentences);
  assert.deepEqual(trimmed, sentences);
});

test("trimTrailingReferenceSentences : la dernière phrase du corps n'est jamais fusionnée avec la première note dans le même chunk perdu", () => {
  // Reproduit le bug identifié pendant le développement de ce correctif :
  // une dernière phrase de corps COURTE, immédiatement suivie d'une note,
  // pouvait auparavant être regroupée avec elle par chunkSentences (les deux
  // sous TARGET_CHUNK_CHARS une fois assemblées) puis disparaître avec le
  // chunk entier une fois celui-ci tronqué — d'où la troncature désormais
  // faite au niveau des PHRASES, avant tout regroupement en chunks.
  const sentences = ["Une phrase de corps très courte.", "↑ Une note tout aussi courte."];
  const trimmed = trimTrailingReferenceSentences(sentences);
  assert.deepEqual(trimmed, ["Une phrase de corps très courte."]);
});

// ── stratifiedIndices ────────────────────────────────────────────────

test("stratifiedIndices : count >= total -> tous les indices, dans l'ordre", () => {
  assert.deepEqual(stratifiedIndices(4, 10), [0, 1, 2, 3]);
  assert.deepEqual(stratifiedIndices(4, 4), [0, 1, 2, 3]);
});

test("stratifiedIndices : répartit régulièrement sur toute la plage, jamais concentré en tête", () => {
  const picks = stratifiedIndices(100, 5);
  assert.equal(picks.length, 5);
  assert.ok(picks[0] < 20, "le premier indice doit rester proche du début");
  assert.ok(picks[picks.length - 1] > 80, "le dernier indice doit atteindre la fin de la plage");
  for (let i = 1; i < picks.length; i += 1) assert.ok(picks[i] > picks[i - 1], "indices strictement croissants");
});

test("stratifiedIndices : entrées invalides -> tableau vide, jamais une exception", () => {
  assert.deepEqual(stratifiedIndices(0, 5), []);
  assert.deepEqual(stratifiedIndices(5, 0), []);
  assert.deepEqual(stratifiedIndices(NaN, 5), []);
});

// ── selectRepresentativeExcerpt : couverture sur un sujet gigantesque
// (Test 1 de la demande de diagnostic — "le système ne doit pas
// sélectionner N connaissances sur un seul micro-thème et ignorer les
// autres grands thèmes") ────────────────────────────────────────────────

function buildWideSubjectDocument() {
  // Six thèmes distincts, réellement structurants et de longueur comparable
  // (prose positive, chacun ~320-450 caractères, volontairement écrit comme
  // un paragraphe AUTONOME plutôt qu'entrecoupé de texte de remplissage —
  // deux paragraphes voisins pourraient sinon être fusionnés par
  // chunkSentences en un seul chunk et artificiellement se disputer un même
  // "créneau" de sélection) — chacun repérable par un marqueur unique.
  const etatsGeneraux = "L'ouverture des États généraux à Versailles rassemble pour la première fois depuis 1614 les représentants des trois ordres du royaume, dans un climat d'attente réformatrice généralisée qui traverse toutes les couches de la société. Cette assemblée exceptionnelle suscite d'immenses espoirs de changement profond dans l'ensemble du pays.";
  // Un micro-thème plus développé que les cinq autres (comme mesuré en
  // conditions réelles sur le débat du vote par tête, plus longuement
  // couvert dans l'article que chacun des cinq grands thèmes ci-dessous pris
  // isolément) — ne doit pas pour autant, à lui seul, éclipser tous les
  // autres dans l'extrait final.
  const voteParTete = "Le débat sur les modalités de vote oppose les partisans du vote par tête, favorable au tiers état, aux tenants du vote par ordre traditionnel, chaque camp mobilisant des arguments juridiques et historiques longuement développés dans les cahiers de doléances. Cette controverse occupe une place importante dans les débats préparatoires et continue longtemps d'alimenter les tensions entre les trois ordres représentés durant plusieurs semaines.";
  const bastille = "La prise de la Bastille par les habitants parisiens marque un tournant décisif : cette forteresse royale, symbole de l'arbitraire de l'Ancien Régime, tombe après plusieurs heures d'affrontement et devient immédiatement un événement fondateur. Sa chute résonne rapidement bien au-delà de la capitale et de ses environs immédiats.";
  const ddhc = "L'adoption de la déclaration des droits proclame solennellement des principes universels de liberté individuelle et d'égalité devant la loi, inspirant durablement les constitutions rédigées dans les décennies suivantes à travers le monde entier. Ce texte fondateur influence profondément la pensée politique européenne ultérieure.";
  const republique = "La proclamation de la république met fin définitivement à des siècles de monarchie, inaugurant un régime nouveau dont les institutions doivent encore s'inventer face aux menaces intérieures et aux coalitions étrangères hostiles. Ce basculement institutionnel majeur redéfinit durablement l'organisation politique du pays.";
  const terreur = "La période de terreur voit se multiplier les mesures d'exception justifiées par l'urgence de la guerre et les complots redoutés, avant qu'un retournement politique brutal n'y mette fin de façon tout aussi soudaine que son déclenchement initial. Ses conséquences marquent profondément la mémoire collective ultérieure.";

  const body = [etatsGeneraux, voteParTete, bastille, ddhc, republique, terreur].join(" ");
  // Liste de notes en fin de document (marqueur "↑"), volumineuse, sans
  // jamais apporter d'information sur les six thèmes ci-dessus.
  const referenceTail = Array.from({ length: 40 }, (_, i) => `↑ Référence bibliographique numéro ${i + 1}, sans rapport direct avec le contenu du corps de l'article.`).join(" ");
  return `${body} ${referenceTail}`;
}

test("selectRepresentativeExcerpt : sur un sujet large, ne concentre pas la sélection sur un seul micro-thème surreprésenté et ignore les autres grands thèmes", () => {
  const doc = buildWideSubjectDocument();
  const { excerpt } = selectRepresentativeExcerpt(doc, { budgetChars: 3000 });
  const themes = {
    "États généraux": /États généraux/,
    "Bastille": /Bastille/,
    "Déclaration des droits": /déclaration des droits/i,
    "République": /république/i,
    "Terreur": /terreur/i
  };
  const covered = Object.entries(themes).filter(([, re]) => re.test(excerpt)).map(([name]) => name);
  assert.ok(covered.length >= 3, `au moins 3 des 5 grands thèmes doivent apparaître dans l'extrait, obtenu : ${covered.join(", ") || "(aucun)"}`);
});

test("selectRepresentativeExcerpt : la liste de notes de fin de document (marqueur de renvoi) n'apparaît jamais dans l'extrait final", () => {
  const doc = buildWideSubjectDocument();
  const { excerpt } = selectRepresentativeExcerpt(doc, { budgetChars: 3000 });
  assert.doesNotMatch(excerpt, /↑/, "aucune note de bas de page ne doit polluer l'extrait");
  assert.doesNotMatch(excerpt, /Référence bibliographique/);
});

// ── selectRepresentativeExcerpt : plusieurs grandes sections d'un même
// document (Test 4 de la demande de diagnostic) ────────────────────────

test("selectRepresentativeExcerpt : sur un document composé de plusieurs grandes sections de taille comparable, la sélection ne se concentre pas presque entièrement dans une seule d'entre elles", () => {
  // Six sections, chacune une longue prose homogène (même profil de score),
  // chacune marquée par un identifiant unique répété uniquement dans sa
  // propre section — reproduit un document structuré sans dépendre du
  // moindre marqueur de titre (non conservé par extractReadableContent,
  // cf. commentaire de tête du fichier).
  const sectionLabels = ["SectionAlpha", "SectionBeta", "SectionGamma", "SectionDelta", "SectionEpsilon", "SectionZeta"];
  const sentenceFor = (label) => `Cette partie du document développe longuement des considérations spécifiques à ${label}, avec plusieurs phrases construites de façon habituelle pour représenter une prose normale et cohérente.`;
  const sections = sectionLabels.map((label) => Array.from({ length: 8 }, () => sentenceFor(label)).join(" "));
  const doc = sections.join(" ");

  const { excerpt } = selectRepresentativeExcerpt(doc, { budgetChars: 2500 });
  const coveredSections = sectionLabels.filter((label) => excerpt.includes(label));
  assert.ok(coveredSections.length >= 4, `au moins 4 des 6 sections doivent être représentées, obtenu : ${coveredSections.join(", ") || "(aucune)"}`);
});

// ══════════════════════════════════════════════════════════════════════
// E1 — squelette d'ouverture (correction du 13/09/2026, diagnostic qualité
// pédagogique "Charlemagne"). Reproduit sur le vrai article : l'infobox+
// intro (identité, dates de règne, couronnement, conquêtes) contient
// PLUSIEURS phrases individuellement bien notées par scoreChunk, mais qui se
// neutralisaient entre elles dès qu'elles tombaient dans le même bucket
// positionnel — un budget de 8000 caractères ne conservait alors qu'UNE
// seule d'entre elles (souvent la moins informative). Ci-dessous : mêmes
// scénarios avec un document 100 % synthétique et générique (aucun
// vocabulaire d'histoire/biographie) — la fenêtre d'ouverture doit avoir une
// CHANCE RÉELLE d'être représentée par PLUSIEURS de ses phrases, jamais un
// forçage aveugle du tout premier chunk quel que soit son contenu.
// ══════════════════════════════════════════════════════════════════════

test("selectRepresentativeExcerpt (E1) : plusieurs faits distincts de l'ouverture survivent désormais, là où un seul survivait avant ce correctif", () => {
  // Quatre phrases d'ouverture DISTINCTES (chacune assez longue pour former
  // son propre chunk), chacune dense en chiffres/dates (comme une identité/
  // des dates structurantes réelles) — chacune individuellement bien notée
  // par scoreChunk, mais en compétition avec un large corps secondaire pour
  // le même budget serré.
  const openingFacts = [
    "OpeningFactAlpha est fondé en 1204 par un groupe de pionniers venus de plusieurs régions voisines, à la suite d'une longue période de troubles qui avait fragilisé les structures existantes et poussé ces populations à rechercher un cadre commun plus stable pour organiser durablement leurs échanges et leur défense collective.",
    "OpeningFactBeta devient la référence dominante dès 1250, sous l'autorité d'un conseil élu chaque année par les représentants des grandes familles locales, qui se réunit régulièrement pour arbitrer les différends commerciaux et fixer les règles communes applicables à l'ensemble des cités affiliées à cette organisation.",
    "OpeningFactGamma, sa capitale historique, concentre les échanges depuis 1230 et abrite un grand marché central où se croisent chaque semaine des marchands venus de contrées lointaines, faisant de cette ville un carrefour économique et culturel de première importance pour toute la région environnante.",
    "OpeningFactDelta demeure l'événement fondateur retenu par les historiens, signé en 1204 après plusieurs décennies de conflits successifs entre les principales puissances rivales de l'époque, mettant fin à une instabilité prolongée qui avait considérablement freiné le développement économique de la région entière."
  ];
  const bodySentence = (n) => `Cette partie du corps développe longuement des considérations secondaires liées au sous-thème BodyTopic${n}, avec une prose fluide et bien construite qui ne porte cependant aucune information réellement centrale pour comprendre le sujet dans son ensemble, mais qui reste rédigée de façon parfaitement soignée et cohérente.`;
  const body = Array.from({ length: 40 }, (_, i) => bodySentence(i)).join(" ");
  const doc = `${openingFacts.join(" ")} ${body}`;

  const { excerpt } = selectRepresentativeExcerpt(doc, { budgetChars: 1500 });
  const covered = ["Alpha", "Beta", "Gamma", "Delta"].filter((m) => excerpt.includes(`OpeningFact${m}`));
  assert.ok(covered.length >= 2, `au moins 2 des 4 faits d'ouverture doivent survivre, obtenu : ${covered.join(", ") || "(aucun)"}`);
});

test("selectRepresentativeExcerpt (E1) : une ouverture réellement mauvaise (infobox pur bruit) n'est JAMAIS forcée dans l'extrait", () => {
  const badOpeningInfobox = "Sultan • c. 1299–1323/4 (first) Osman I Government Absolute monarchy (1299–1876; 1878–1908; 1920–1922) Religion Sunni Islam (state) Currency Akçe Kuruş Lira Area 1914 estimate 1,800,000 km2 Population 1856 estimate 35,350,000 Established 1299 Disestablished 1922 Capital Söğüt Nicaea Bursa Edirne Constantinople";
  const goodSentence = (n) => `Cette section développe une analyse approfondie du sous-thème GoodTopic${n}, avec des explications claires sur les mécanismes en jeu et leurs conséquences principales pour la compréhension globale du sujet traité ici.`;
  const body = Array.from({ length: 40 }, (_, i) => goodSentence(i)).join(" ");
  const doc = `${badOpeningInfobox} ${body}`;

  const { excerpt } = selectRepresentativeExcerpt(doc, { budgetChars: 2000 });
  assert.doesNotMatch(excerpt, /Sultan •/, "un bloc d'ouverture purement infobox ne doit jamais être forcé dans l'extrait");
  assert.doesNotMatch(excerpt, /Disestablished 1922/);
});

test("selectRepresentativeExcerpt (E1) : la réservation d'ouverture reste plafonnée à OPENING_RESERVATION_MAX_SHARE — ne domine jamais un petit budget quand le début du document n'a rien de spécial", () => {
  // Six sections homogènes (même profil de score partout, aucune ouverture
  // structurellement différente du reste) — la réservation d'ouverture ne
  // doit jamais, à elle seule, empêcher les sections suivantes d'apparaître
  // sur un petit budget (cf. régression constatée pendant le développement
  // de ce correctif, corrigée par OPENING_RESERVATION_MAX_SHARE).
  const sectionLabels = ["SectionAlpha", "SectionBeta", "SectionGamma", "SectionDelta", "SectionEpsilon", "SectionZeta"];
  const sentenceFor = (label) => `Cette partie du document développe longuement des considérations spécifiques à ${label}, avec plusieurs phrases construites de façon habituelle pour représenter une prose normale et cohérente.`;
  const sections = sectionLabels.map((label) => Array.from({ length: 8 }, () => sentenceFor(label)).join(" "));
  const doc = sections.join(" ");

  const { excerpt } = selectRepresentativeExcerpt(doc, { budgetChars: 2500 });
  const coveredSections = sectionLabels.filter((label) => excerpt.includes(label));
  assert.ok(coveredSections.length >= 4, `la réservation d'ouverture ne doit pas empêcher une bonne couverture globale, obtenu : ${coveredSections.join(", ") || "(aucune)"}`);
});
