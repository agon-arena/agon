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

// Nombre de positions (buckets) sur lesquelles répartir la sélection finale
// — favorise une diversité de sections sans jamais imposer de structure
// disciplinaire (définition/mécanisme/conséquence...) : la diversité est
// purement positionnelle, donc valable pour n'importe quel sujet.
const DEFAULT_BUCKET_COUNT = 6;

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

  const chunks = chunkSentences(splitIntoSentences(cleanText), targetChunkChars);
  if (!chunks.length) {
    const excerpt = cleanText.slice(0, budgetChars);
    return { excerpt, stats: { rawChars, keptChars: excerpt.length, chunkCount: 0, keptChunkCount: 0, highDensityChunkRatio: 0 } };
  }

  const scored = chunks.map((chunk) => ({ ...chunk, score: scoreChunk(chunk.text) }));
  // Signal de diagnostic (section A7) : proportion de chunks structurellement
  // proches d'un infobox (score négatif, dominé par les pénalités) — jamais
  // affiché à l'utilisateur, seulement journalisé par server.js pour
  // diagnostiquer un futur cas "corpus = infobox".
  const highDensityChunkRatio = scored.filter((c) => c.score < 0).length / scored.length;

  // Un champion par bucket de position — jamais plusieurs chunks du même
  // bucket, pour garantir la diversité positionnelle même si un seul bucket
  // concentrait par ailleurs les meilleurs scores bruts.
  const champions = new Map();
  for (const chunk of scored) {
    const bucket = bucketIndexFor(chunk.index, scored.length, bucketCount);
    const current = champions.get(bucket);
    if (!current || chunk.score > current.score) champions.set(bucket, chunk);
  }

  // Sélection par score décroissant jusqu'à épuisement du budget (jamais un
  // ordre de position à ce stade — seul le réassemblage final respecte
  // l'ordre de lecture, cf. plus bas).
  const rankedCandidates = [...champions.values()].sort((a, b) => b.score - a.score);
  // Plancher qualité (jamais un fragment quasi vide/infobox choisi juste
  // parce qu'il tient dans le reliquat de budget, constaté en test — un
  // score positif signale un chunk réellement dominé par de la prose,
  // cf. scoreChunk) : n'écarte les candidats à score négatif ou nul QUE
  // s'il existe au moins un candidat correct — une source ENTIÈREMENT
  // dominée par de l'infobox (aucun candidat positif) retombe alors sur les
  // candidats bruts plutôt que sur un excerpt vide.
  const positiveCandidates = rankedCandidates.filter((c) => c.score > 0);
  const candidates = positiveCandidates.length ? positiveCandidates : rankedCandidates;
  const selected = [];
  let used = 0;
  const separatorCost = GAP_MARKER.length;
  // Remplissage glouton du budget : un candidat trop volumineux pour la
  // place restante est ignoré (jamais un arrêt prématuré, cf. bug constaté
  // en test — un gros champion bien classé bloquait à tort la sélection
  // d'un plus petit champion suivant qui, lui, tenait dans le budget
  // restant) ; la boucle continue tant qu'il reste des candidats et de la
  // place, même minime.
  for (const chunk of candidates) {
    const cost = chunk.text.length + (selected.length ? separatorCost : 0);
    if (used + cost > budgetChars) continue; // trop grand pour la place restante : essaie un candidat suivant, plus petit
    selected.push(chunk);
    used += cost;
    if (used >= budgetChars) break;
  }
  // Filet de sécurité : aucun candidat n'a pu entrer dans le budget (budget
  // extrêmement petit) — retombe sur le meilleur chunk unique, tronqué.
  if (!selected.length) {
    const best = candidates[0];
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
  GAP_MARKER,
  splitIntoSentences,
  chunkSentences,
  scoreChunk,
  bucketIndexFor,
  selectRepresentativeExcerpt
};
