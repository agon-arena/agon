"use strict";

// Sélection de passages représentatifs pour le grounding web (chantier
// "qualité éditoriale du pipeline QCM progressif", 07/09/2026, PROBLÈME 1 —
// "corpus web tronqué trop tôt"). Diagnostic établi par test réel "Empire
// ottoman" : les WEB_SEARCH_EXCERPT_MAX_CHARS premiers caractères d'un
// article Wikipédia de 192 515 caractères capturaient presque exclusivement
// l'infobox (linéarisée par Readability en tête d'extraction) — sur les 16
// questions produites, AUCUN "supporting_claim" ne citait une phrase de
// prose, tous étaient des fragments du type "Sultan • c. 1299–1323/4 (first)
// Osman I", "Government Absolute monarchy...". Le corps de l'article
// (mécanismes, transformations, rapports avec d'autres puissances...)
// n'atteignait jamais le modèle, malgré un prompt éditorial qui les demande
// pourtant explicitement (cf. lib/notion-quiz-curriculum.js).
//
// Fichier volontairement PUR (aucun réseau/DOM, aucun appel IA) : reçoit le
// texte déjà extrait par lib/url-knowledge.js (extractReadableContent, qui
// aplatit tous les espaces/retours à la ligne en un seul espace — aucune
// frontière de paragraphe ne survit à ce stade, cf. son commentaire de
// tête) et sélectionne, DÉTERMINISTIQUEMENT, un sous-ensemble de phrases
// regroupées en chunks, réparties sur toute la longueur du document plutôt
// que prises en tête. Aucun changement à extractReadableContent lui-même
// (utilisé ailleurs par l'import de connaissances par URL — modifier son
// contrat de sortie aurait un rayon d'action bien plus large que ce
// chantier) : ce module travaille sur le texte tel qu'il est déjà produit.
//
// Générique par construction (AUCUN vocabulaire d'histoire, de Wikipédia ou
// d'aucune discipline) : les signaux utilisés (densité de chiffres, densité
// de motifs "étiquette : valeur" façon infobox, complétude des phrases,
// longueur de chunk, position dans le document) s'appliquent identiquement
// à un article de sciences, d'art, de géographie ou d'économie — un texte
// sans aucun chiffre n'active simplement jamais le signal de densité
// numérique, sans jamais être pénalisé pour autant.

// Taille cible d'un chunk avant découpage — assez grand pour porter une
// idée complète (plus qu'une phrase isolée), assez petit pour permettre une
// vraie diversité de positions dans le budget final.
const TARGET_CHUNK_CHARS = 500;

// Sous ce nombre de caractères, un chunk est trop fragmentaire pour être
// évalué/sélectionné seul (il rejoint plutôt le chunk suivant lors du
// découpage) — évite qu'une phrase isolée en fin de texte devienne, par
// accident, "le meilleur chunk d'un bucket" simplement parce qu'aucun autre
// chunk n'occupe ce bucket.
const MIN_CHUNK_CHARS = 120;

// Nombre PLANCHER de positions (buckets) sur lesquelles répartir la
// sélection finale — favorise une diversité de sections sans jamais imposer
// de structure disciplinaire (définition/mécanisme/conséquence...) : la
// diversité est purement positionnelle, donc valable pour n'importe quel
// sujet. Un document dont le nombre de chunks dépasse ce plancher reçoit
// AUTANT de buckets que de chunks (cf. CHUNKS_PER_BUCKET_TARGET
// ci-dessous) — ce plancher ne s'applique donc, en pratique, qu'aux textes
// les plus courts (moins de 6 chunks, ~3000 caractères).
const DEFAULT_BUCKET_COUNT = 6;

// Correctif "sujet gigantesque" (12/09/2026, cas réel "Révolution
// française" — article Wikipédia de 191 319 caractères, 417 chunks de ~500
// caractères). Avec seulement DEFAULT_BUCKET_COUNT=6 buckets FIXES quelle
// que soit la taille du document, chaque bucket couvrait ~69 chunks
// (~33 000 caractères bruts) : plusieurs grands sous-thèmes distincts
// (ex. le débat sur le vote aux États généraux ET les Girondins/Montagnards)
// tombaient dans le MÊME bucket, qui n'en retenait alors qu'un seul —
// mesuré en conditions réelles : le curriculum obtenu couvrait le vote par
// tête et les factions, mais jamais la Bastille, la DDHC, la chute de la
// monarchie, la Terreur ou Robespierre, pourtant bien présents dans
// l'article. Pire, mesuré aussi sur "Aires urbaines" (22 405 caractères,
// bien plus modeste) : DEUX chunks consécutifs (l'un anecdotique — une
// légende d'illustration —, l'autre portant le fait central "remplacé par
// les aires d'attraction des villes depuis 2020") se disputaient le MÊME
// bucket ; le second perdait de justesse et disparaissait entièrement.
//
// CHUNKS_PER_BUCKET_TARGET=1 : un bucket par chunk — élimine cette
// compétition interne aux petits documents (chaque chunk devient son propre
// candidat, plus aucun concurrent direct ne peut l'évincer), plafonné à
// MAX_BUCKET_COUNT pour les documents les plus volumineux (borne le coût
// CPU, négligeable de toute façon : un simple passage O(chunks), aucun
// impact sur le nombre de tokens envoyés — seul budgetChars détermine ça).
// Jamais en-dessous de DEFAULT_BUCKET_COUNT. Le nombre d'extraits RETENUS
// au final reste, lui, entièrement déterminé par budgetChars (cf.
// approxSelectableCount plus bas) — augmenter la résolution des buckets
// affine QUELS passages gagnent la compétition locale, jamais COMBIEN sont
// gardés.
const CHUNKS_PER_BUCKET_TARGET = 1;
const MAX_BUCKET_COUNT = 200;

// Taille de la fenêtre d'ouverture réservée hors compétition par bucket
// (diagnostic qualité pédagogique du 13/09/2026, cas réel "Charlemagne" —
// cf. commentaire complet dans selectRepresentativeExcerpt). PETITE et FIXE
// à dessein : à TARGET_CHUNK_CHARS=500, 6 chunks représentent ~3000
// caractères bruts — l'ordre de grandeur où une source encyclopédique
// concentre typiquement son identité/définition/infobox/résumé, quel que
// soit le sujet (vérifié sur Révolution française, Charlemagne). Jamais
// proportionnelle à la taille du document (un article deux fois plus long
// n'a pas une "ouverture" deux fois plus grande) — reste donc négligeable
// face au budget total sur un grand document, tout en restant utile sur un
// document court.
const OPENING_WINDOW_CHUNKS = 6;

// Part MAXIMALE du budget total que la fenêtre d'ouverture peut consommer —
// jamais 100 % : sur un document où le début n'a structurellement rien de
// spécial (pas d'infobox/résumé, une prose homogène partout, cf. test), ce
// plafond garantit qu'il reste toujours une part significative du budget
// pour le reste du document, quelle que soit la taille absolue de
// budgetChars. 0.35 laisse une réservation réelle (largement suffisante
// pour 4-6 chunks d'ouverture sur un budget de 8000, cf. cas réel
// "Charlemagne") sans jamais dominer la sélection.
const OPENING_RESERVATION_MAX_SHARE = 0.35;

// Séparateur inséré entre deux chunks non contigus dans le texte original —
// signale explicitement au modèle qu'un saut existe (jamais une continuité
// fabriquée), cohérent avec le style déjà aplati (une seule ligne, espaces
// simples) du texte produit par extractReadableContent.
const GAP_MARKER = " […] ";

// Découpe un texte déjà "aplati" (un seul espace entre les mots, cf.
// extractReadableContent) en phrases approximatives. Volontairement simple
// (jamais un vrai tokenizer NLP) : suffisant pour regrouper ensuite les
// phrases en chunks de taille raisonnable, jamais utilisé pour autre chose
// qu'un découpage grossier.
function splitIntoSentences(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  const matches = trimmed.match(/[^.!?]+(?:[.!?]+|$)/g);
  return (matches || [trimmed]).map((s) => s.trim()).filter(Boolean);
}

// Regroupe des phrases consécutives en chunks d'environ TARGET_CHUNK_CHARS
// caractères — jamais une coupure au milieu d'une phrase. Chaque chunk
// conserve sa position d'origine (`index`, ordre de lecture) pour permettre
// ensuite une sélection diversifiée puis un réassemblage dans l'ordre du
// document.
function chunkSentences(sentences, targetChunkChars = TARGET_CHUNK_CHARS) {
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (current && candidate.length > targetChunkChars) {
      chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  // Fusionne un dernier chunk trop court avec le précédent plutôt que de le
  // laisser seul et sous-évalué (cf. MIN_CHUNK_CHARS) — jamais perdu.
  if (chunks.length > 1 && chunks[chunks.length - 1].length < MIN_CHUNK_CHARS) {
    const last = chunks.pop();
    chunks[chunks.length - 1] += ` ${last}`;
  }
  return chunks.map((text, index) => ({ text, index }));
}

// Bonus de longueur moyenne de phrase (0..1), maximal autour de 130
// caractères (prose courante) — pénalise les DEUX extrêmes : une longueur
// moyenne très faible signale des fragments répétitifs/télégraphiques
// (jamais une vraie phrase construite), une longueur moyenne très élevée
// (ou infinie, aucune ponctuation de fin de phrase du tout) signale un bloc
// sans structure de phrase — exactement le cas d'un infobox linéarisé
// ("Sultan • ... Government ... Religion ...", aucun point). Volontairement
// insensible à la langue (aucun mot-clé).
function sentenceLengthBonus(avgSentenceLength) {
  if (!Number.isFinite(avgSentenceLength) || avgSentenceLength < 20) return 0;
  const idealLength = 130;
  const distance = Math.abs(avgSentenceLength - idealLength);
  return Math.max(0, 1 - distance / 260);
}

// Score déterministe favorisant la prose réelle et pénalisant les fragments
// façon infobox — AUCUN vocabulaire spécifique à un domaine, uniquement des
// signaux structurels universels :
// - sentenceLengthBonus (récompensé) : une longueur moyenne de phrase
//   proche d'une prose normale, jamais un simple compte brut de points (qui
//   récompenserait à tort une suite de phrases très courtes et répétitives).
// - digitRatio (pénalisé) : proportion de chiffres — élevée sur une liste de
//   dates/statistiques/valeurs numériques, faible sur un texte explicatif.
// - labelValueRatio (pénalisé) : proportion de ":" et "•" — signature
//   typographique des paires étiquette/valeur (infobox, fiches techniques),
//   rare dans une prose normale.
// - length (léger bonus dans une plage raisonnable) : un chunk trop court
//   porte rarement une idée complète.
function scoreChunk(chunkText) {
  const length = chunkText.length;
  if (!length) return -Infinity;
  const digitCount = (chunkText.match(/\d/g) || []).length;
  const labelValueCount = (chunkText.match(/[:•]/g) || []).length;
  const sentenceEndCount = (chunkText.match(/[.!?](?=\s|$)/g) || []).length;
  const digitRatio = digitCount / length;
  const labelValueRatio = labelValueCount / length;
  const avgSentenceLength = length / Math.max(1, sentenceEndCount);
  const lengthBonus = Math.min(1, length / TARGET_CHUNK_CHARS) * 0.2;
  return sentenceLengthBonus(avgSentenceLength) * 4 - digitRatio * 25 - labelValueRatio * 60 + lengthBonus;
}

// Répartit les chunks en `bucketCount` tranches contiguës selon leur
// position de lecture (jamais leur score) — pure diversité positionnelle,
// donc valable pour n'importe quelle discipline sans détecter de "sections"
// explicites (que le texte aplati ne porte de toute façon plus, cf.
// commentaire de tête).
function bucketIndexFor(chunkIndex, totalChunks, bucketCount) {
  if (totalChunks <= 1) return 0;
  const ratio = chunkIndex / totalChunks;
  return Math.min(bucketCount - 1, Math.floor(ratio * bucketCount));
}

// Marqueur de renvoi de note utilisé par MediaWiki (Wikipédia — source
// prioritaire n°1 de ce pipeline, cf. buildSourceSelectionPrompt dans
// lib/web-search-grounding.js) devant CHAQUE entrée de la liste "Notes et
// références" — jamais rencontré dans une prose normale (vérifié sur
// l'article réel "Révolution française" : aucune occurrence avant le chunk
// 309/417, puis présent dans 93 des 108 chunks restants). Cette liste finale
// représentait ~26 % des caractères de cet article, SANS jamais apporter la
// moindre connaissance utile au curriculum — pire, chaque note étant une
// phrase complète, elle obtenait un score de prose comparable au corps de
// l'article (cf. scoreChunk) et gaspillait donc une part disproportionnée
// des buckets positionnels sur du pur bruit. Signal purement typographique
// (un seul caractère), jamais un mot de vocabulaire — reste dans l'esprit
// générique du fichier (aucune discipline, aucun site nommé en dur).
const REFERENCE_MARKER = "↑";

// Tronque la fin du document à partir de la première PHRASE portant ce
// marqueur — la liste de notes/bibliographie d'un article encyclopédique est
// TOUJOURS en fin de document et jamais mêlée au corps du texte (vérifié :
// zéro occurrence avant son début réel dans le cas mesuré). Opère sur les
// PHRASES, avant le regroupement en chunks (jamais après) : la dernière
// phrase du corps et la première note peuvent sinon être fusionnées par
// chunkSentences dans un même chunk (toutes deux courtes) et cette phrase de
// corps disparaîtrait alors avec la note qui la suit, perdue par la seule
// troncature du chunk entier. `firstMarked <= 0` (marqueur absent, ou
// présent dès la toute première phrase — signal qu'on ne reconnaît pas la
// structure "corps puis notes" attendue) laisse le document intact plutôt
// que de risquer de perdre tout son contenu sur un faux positif : mieux vaut
// ne rien tronquer qu'un excès de prudence coûteux.
function trimTrailingReferenceSentences(sentences) {
  const firstMarked = sentences.findIndex((s) => s.includes(REFERENCE_MARKER));
  if (firstMarked <= 0) return sentences;
  return sentences.slice(0, firstMarked);
}

// Échantillonne `count` indices régulièrement espacés parmi `total` — reflète
// la couverture de BOUT EN BOUT plutôt que les `count` premiers ou les
// `count` mieux classés : c'est cette répartition, appliquée à des candidats
// déjà triés par position (cf. selectRepresentativeExcerpt), qui garantit
// qu'un budget trop petit pour retenir tous les buckets renonce à certaines
// POSITIONS de façon uniforme plutôt qu'aux buckets les moins "prose" au
// sens de scoreChunk (biais mesuré : une frise chronologique dense en faits/
// dates perd systématiquement face à un paragraphe narratif ordinaire, alors
// que la première est souvent plus structurante pour le sujet). Ancré sur
// les DEUX extrémités (le premier indice retenu est toujours 0, le dernier
// toujours `total - 1`, jamais un espacement centré qui les évite
// systématiquement) — corrige un cas mesuré en conditions réelles ("Aires
// urbaines") où un espacement centré (`(i + 0.5) * total / count`) sautait
// EXACTEMENT le fait le plus important du document (un zonage remplacé en
// 2020, juste après l'introduction) simplement parce que `total` était un
// multiple exact de `count` : le début et la fin d'un article encyclopédique
// portent trop souvent l'information la plus structurante pour risquer de
// ne jamais les tirer.
function stratifiedIndices(total, count) {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(count) || count <= 0) return [];
  if (count >= total) return Array.from({ length: total }, (_, i) => i);
  if (count === 1) return [0];
  const indices = [];
  for (let i = 0; i < count; i += 1) indices.push(Math.round((i * (total - 1)) / (count - 1)));
  return [...new Set(indices)];
}

// Sélectionne, dans un budget de caractères donné, les chunks les plus
// informatifs d'un texte tout en les répartissant sur différentes positions
// du document — plutôt que les `budgetChars` premiers caractères pris
// naïvement en tête. Retourne { excerpt, stats } — `stats` alimente la
// télémétrie légère de server.js (section A7), jamais affichée à
// l'utilisateur.
//
// Comportement sur un texte COURT (déjà sous le budget une fois découpé) :
// retourne le texte tel quel, jamais chunké/réordonné pour rien — mêmes
// caractères, dans le même ordre, comportement indiscernable d'un simple
// `.slice(0, budgetChars)` pour ce cas (la quasi-totalité des sources hors
// grands articles encyclopédiques).
function selectRepresentativeExcerpt(text, { budgetChars, targetChunkChars = TARGET_CHUNK_CHARS, bucketCount = DEFAULT_BUCKET_COUNT } = {}) {
  const cleanText = String(text || "").trim();
  const rawChars = cleanText.length;
  if (!cleanText || !Number.isFinite(budgetChars) || budgetChars <= 0) {
    return { excerpt: "", stats: { rawChars, keptChars: 0, chunkCount: 0, keptChunkCount: 0, highDensityChunkRatio: 0 } };
  }
  if (rawChars <= budgetChars) {
    return { excerpt: cleanText, stats: { rawChars, keptChars: rawChars, chunkCount: 1, keptChunkCount: 1, highDensityChunkRatio: 0 } };
  }

  // Notes/bibliographie de fin de document (correctif "sujet gigantesque",
  // cf. commentaire de trimTrailingReferenceSentences) : jamais un candidat
  // valable, retirée AU NIVEAU DES PHRASES, AVANT le regroupement en chunks
  // et tout calcul de buckets, pour que (a) la dernière phrase du corps ne
  // soit jamais fusionnée avec la première note dans un même chunk perdu en
  // bloc, et (b) la résolution positionnelle porte entièrement sur le corps
  // réel de l'article plutôt que de gaspiller des buckets sur cette zone.
  const chunks = chunkSentences(trimTrailingReferenceSentences(splitIntoSentences(cleanText)), targetChunkChars);
  if (!chunks.length) {
    const excerpt = cleanText.slice(0, budgetChars);
    return { excerpt, stats: { rawChars, keptChars: excerpt.length, chunkCount: 0, keptChunkCount: 0, highDensityChunkRatio: 0 } };
  }

  // Résolution positionnelle affinée sur un grand document (correctif
  // "sujet gigantesque", cf. commentaire de CHUNKS_PER_BUCKET_TARGET) —
  // jamais en-dessous du bucketCount demandé par l'appelant.
  const effectiveBucketCount = Math.min(MAX_BUCKET_COUNT, Math.max(bucketCount, Math.ceil(chunks.length / CHUNKS_PER_BUCKET_TARGET)));

  const scored = chunks.map((chunk) => ({ ...chunk, score: scoreChunk(chunk.text) }));
  // Signal de diagnostic (section A7) : proportion de chunks structurellement
  // proches d'un infobox (score négatif, dominé par les pénalités) — jamais
  // affiché à l'utilisateur, seulement journalisé par server.js pour
  // diagnostiquer un futur cas "corpus = infobox".
  const highDensityChunkRatio = scored.filter((c) => c.score < 0).length / scored.length;

  // Squelette d'ouverture (diagnostic qualité pédagogique du 13/09/2026, cas
  // réel "Charlemagne") : reproduit sur le vrai article — l'infobox+intro
  // (identité, dates de règne, couronnement de 800 par Léon III, conquête du
  // royaume lombard) tient sur les tout premiers chunks, mais PLUSIEURS
  // d'entre eux (score positif chacun, donc individuellement de la vraie
  // prose) se neutralisent entre eux dès qu'ils tombent dans le MÊME bucket
  // positionnel — un seul champion par bucket (cf. plus bas) n'en retient
  // alors qu'UN SEUL, au hasard d'un écart de score de quelques dixièmes
  // (ex. mesuré : une légende de médaille à 3.57 bat de justesse la phrase
  // "il est roi des Francs à partir de 768, devient [...] roi des Lombards
  // en 774 et est couronné empereur à Rome par le pape Léon III [...] en
  // 800" à 2.21, cette dernière pénalisée par digitRatio du seul fait de
  // contenir plusieurs dates). Reconstitué à part, EN DEHORS de la
  // compétition par bucket : chaque chunk de cette petite fenêtre fixe est
  // considéré INDIVIDUELLEMENT, avec le MÊME plancher qualité que le reste
  // de l'algorithme (score strictement positif — jamais un nouveau seuil à
  // calibrer, jamais le chunk d'ouverture inclus À L'AVEUGLE quel que soit
  // son score, cf. le chunk-infobox géant à score négatif du cas réel qui
  // reste exclu). Fenêtre PETITE et FIXE (jamais proportionnelle à la
  // taille du document, jamais un mot-clé de discipline) : couvre l'ordre
  // de grandeur où une source encyclopédique concentre typiquement son
  // identité/définition/résumé initial, quel que soit le sujet.
  const openingWindowSize = Math.min(scored.length, OPENING_WINDOW_CHUNKS);
  const openingCandidates = scored
    .slice(0, openingWindowSize)
    .filter((c) => c.score > 0);
  // Plafond en PART DU BUDGET (jamais un nombre de chunks brut) : bug
  // constaté en test — sur un document synthétique dont les toutes
  // premières sections sont, structurellement, aussi bonnes que le reste
  // (aucune infobox, prose homogène partout), la fenêtre d'ouverture pouvait
  // à elle seule épuiser un PETIT budget et affamer le reste du document.
  // OPENING_RESERVATION_MAX_SHARE borne cette réservation à une fraction du
  // budget quelle que soit sa taille absolue — sans jamais dépendre du
  // score pour EXCLURE un candidat d'ouverture (ça, c'est déjà le rôle du
  // plancher qualité ci-dessus) : ici, seul un budget insuffisant fait
  // sauter des candidats, en gardant les mieux notés en priorité.
  const openingBudget = Math.floor(budgetChars * OPENING_RESERVATION_MAX_SHARE);
  const openingSkeletonChunks = [];
  let openingUsed = 0;
  for (const chunk of [...openingCandidates].sort((a, b) => b.score - a.score)) {
    const cost = chunk.text.length + (openingSkeletonChunks.length ? GAP_MARKER.length : 0);
    if (openingUsed + cost > openingBudget) continue;
    openingSkeletonChunks.push(chunk);
    openingUsed += cost;
  }
  openingSkeletonChunks.sort((a, b) => a.index - b.index);

  // Un champion par bucket de position — jamais plusieurs chunks du même
  // bucket, pour garantir la diversité positionnelle même si un seul bucket
  // concentrait par ailleurs les meilleurs scores bruts.
  const champions = new Map();
  for (const chunk of scored) {
    const bucket = bucketIndexFor(chunk.index, scored.length, effectiveBucketCount);
    const current = champions.get(bucket);
    if (!current || chunk.score > current.score) champions.set(bucket, chunk);
  }

  const allChampions = [...champions.values()];
  // Plancher qualité (jamais un fragment quasi vide/infobox choisi juste
  // parce qu'il tient dans le reliquat de budget, constaté en test — un
  // score positif signale un chunk réellement dominé par de la prose,
  // cf. scoreChunk) : n'écarte les candidats à score négatif ou nul QUE
  // s'il existe au moins un candidat correct — une source ENTIÈREMENT
  // dominée par de l'infobox (aucun candidat positif) retombe alors sur les
  // candidats bruts plutôt que sur un excerpt vide.
  const positiveCandidates = allChampions.filter((c) => c.score > 0);
  const qualified = positiveCandidates.length ? positiveCandidates : allChampions;

  // Sélection par POSITION, régulièrement espacée sur toute la plage
  // qualifiée (correctif "sujet gigantesque") — jamais par score décroissant
  // seul : un classement par score favorisait systématiquement la prose
  // narrative ordinaire au détriment de passages denses en faits/dates
  // (ex. une frise chronologique), souvent plus structurants pour le sujet
  // que ne le laisse croire leur score de "qualité de prose".
  const byPosition = [...qualified].sort((a, b) => a.index - b.index);
  const approxSelectableCount = Math.max(1, Math.floor(budgetChars / (targetChunkChars + GAP_MARKER.length)));
  const stratifiedPicks = stratifiedIndices(byPosition.length, approxSelectableCount).map((i) => byPosition[i]);

  // Fusion PRIORITAIRE du squelette d'ouverture avec la sélection
  // stratifiée habituelle — jamais un remplacement, une redistribution du
  // MÊME budget (cf. commentaire de OPENING_WINDOW_CHUNKS) : le squelette
  // passe en premier dans la boucle de remplissage ci-dessous, la
  // sélection stratifiée comble le reste tant qu'il reste de la place.
  // Dédoublonnage par `index` (jamais par référence d'objet) : un chunk
  // d'ouverture qui gagnerait de toute façon sa compétition de bucket ne
  // doit jamais être compté deux fois dans le budget.
  const seenPickIndexes = new Set();
  const picks = [];
  for (const chunk of [...openingSkeletonChunks, ...stratifiedPicks]) {
    if (seenPickIndexes.has(chunk.index)) continue;
    seenPickIndexes.add(chunk.index);
    picks.push(chunk);
  }

  const selected = [];
  let used = 0;
  const separatorCost = GAP_MARKER.length;
  // Remplissage glouton du budget : un candidat trop volumineux pour la
  // place restante est ignoré (jamais un arrêt prématuré, cf. bug constaté
  // en test — un gros champion bien classé bloquait à tort la sélection
  // d'un plus petit champion suivant qui, lui, tenait dans le budget
  // restant) ; la boucle continue tant qu'il reste des candidats et de la
  // place, même minime.
  for (const chunk of picks) {
    const cost = chunk.text.length + (selected.length ? separatorCost : 0);
    if (used + cost > budgetChars) continue; // trop grand pour la place restante : essaie un candidat suivant, plus petit
    selected.push(chunk);
    used += cost;
    if (used >= budgetChars) break;
  }
  // Filet de sécurité : aucun candidat n'a pu entrer dans le budget (budget
  // extrêmement petit) — retombe sur le meilleur chunk unique par score,
  // tronqué (seul cas où le score redevient le seul critère : il n'y a de
  // toute façon la place que pour un fragment).
  if (!selected.length) {
    const best = [...qualified].sort((a, b) => b.score - a.score)[0];
    const excerpt = best.text.slice(0, budgetChars);
    return { excerpt, stats: { rawChars, keptChars: excerpt.length, chunkCount: chunks.length, keptChunkCount: 1, highDensityChunkRatio } };
  }

  const ordered = selected.slice().sort((a, b) => a.index - b.index);
  const excerpt = ordered.map((c) => c.text).join(GAP_MARKER).slice(0, budgetChars);
  return {
    excerpt,
    stats: {
      rawChars,
      keptChars: excerpt.length,
      chunkCount: chunks.length,
      keptChunkCount: ordered.length,
      highDensityChunkRatio: Number(highDensityChunkRatio.toFixed(2))
    }
  };
}

module.exports = {
  TARGET_CHUNK_CHARS,
  MIN_CHUNK_CHARS,
  DEFAULT_BUCKET_COUNT,
  CHUNKS_PER_BUCKET_TARGET,
  MAX_BUCKET_COUNT,
  OPENING_WINDOW_CHUNKS,
  OPENING_RESERVATION_MAX_SHARE,
  REFERENCE_MARKER,
  GAP_MARKER,
  splitIntoSentences,
  chunkSentences,
  scoreChunk,
  bucketIndexFor,
  trimTrailingReferenceSentences,
  stratifiedIndices,
  selectRepresentativeExcerpt
};
