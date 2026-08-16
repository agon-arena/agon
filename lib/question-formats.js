// Extrait de server.js le 16/08/2026 (audit pédagogique des QCM) pour
// pouvoir tester ces fonctions unitairement — elles sont pures (aucun accès
// réseau/DB), portent la validation ET la correction déterministe des 7
// formats de question, et n'avaient jusqu'ici jamais pu être testées en
// isolation (server.js démarre tout le serveur Express à l'import). La
// construction des prompts IA (QUESTION_FORMAT_DEFS et consorts) reste dans
// server.js : ce fichier ne couvre que la structure des données, jamais la
// génération.

function shuffleArray(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Les modèles ont un biais de position bien connu (la bonne réponse se
// retrouve trop souvent en première position) : constaté en pratique sur ce
// projet (un lot généré où les 5 questions "qcm" avaient toutes
// correctIndex:0). Demander à l'IA de varier la position dans le prompt ne
// suffit pas à corriger ce biais de façon fiable — on mélange donc
// nous-mêmes l'ordre des options après validation, en se basant sur les
// index (pas sur le texte) pour rester correct même si deux options ont un
// texte identique.
function shuffleOptionsPreservingCorrectIndex(options, correctIndex) {
  const shuffledPositions = shuffleArray(options.map((_, i) => i));
  return {
    options: shuffledPositions.map((originalIndex) => options[originalIndex]),
    correctIndex: shuffledPositions.indexOf(correctIndex)
  };
}

// Types de questions QCM possibles (indépendant du `type` de rubrique
// source utilisé ailleurs — ex. formatEclairagesItemForPrompt distingue
// parallele/pensee/mecanisme/concept/citation, un concept totalement
// différent — d'où le nom "questionType" dans ce qui suit, jamais "type"
// seul, pour ne pas confondre les deux dans les fonctions qui touchent aux
// deux à la fois).
const QUESTION_TYPES = new Set(["qcm", "vrai_faux", "texte_a_trous", "association", "intrus", "qcm_multi", "ordre"]);
// Marqueur du "trou" dans une question de type texte_a_trous — identique
// dans le prompt, le validateur et le rendu client.
const FILL_BLANK_MARKER = "___";
// "association"/"qcm_multi"/"ordre" n'ont pas de correctIndex fourni par
// l'IA (pas un choix unique parmi des options, mais un appariement, un choix
// multiple ou un ordre) : on réutilise la colonne existante
// daily_quiz_answers.option_index comme indicateur binaire "l'utilisateur a-
// t-il tout réussi", jamais comme un vrai index d'option. Sentinelle fixe
// plutôt que dérivée, pour que toute la chaîne de lecture existante
// (computeUserScores, getDailyQuizStats, GET /results) continue de
// fonctionner sans changement : il suffit de comparer ce même 1 des deux
// côtés, quel que soit lequel des 3 formats est en jeu.
const CUSTOM_GRADED_CORRECT_INDEX = 1;

// Valide les 3-4 paires {left,right} d'une question "association" : chaînes
// non vides et raisonnablement courtes, aucun doublon ni côté gauche ni
// côté droit (un doublon rendrait l'appariement ambigu côté client).
function validateAssociationPairs(rawPairs) {
  if (!Array.isArray(rawPairs)) return null;
  const pairs = [];
  const seenLefts = new Set();
  const seenRights = new Set();
  for (const raw of rawPairs) {
    const left = String(raw?.left || "").trim();
    const right = String(raw?.right || "").trim();
    if (!left || !right || left.length > 200 || right.length > 300) return null;
    const leftKey = left.toLowerCase();
    const rightKey = right.toLowerCase();
    if (seenLefts.has(leftKey) || seenRights.has(rightKey)) return null;
    seenLefts.add(leftKey);
    seenRights.add(rightKey);
    pairs.push({ left, right });
  }
  if (pairs.length < 3 || pairs.length > 4) return null;
  return pairs;
}

// Valide les options + correctIndexes (2 bonnes réponses ou plus, jamais
// toutes) d'une question "qcm_multi" — choix multiple parmi 4-5 options.
function validateQcmMultiOptions(rawOptions, rawCorrectIndexes) {
  const options = Array.isArray(rawOptions) ? rawOptions.map((o) => String(o || "").trim()).filter(Boolean) : [];
  if (options.length < 4 || options.length > 5) return null;
  const correctIndexes = Array.isArray(rawCorrectIndexes) ? [...new Set(rawCorrectIndexes.map((n) => Number(n)))] : [];
  if (correctIndexes.length < 2 || correctIndexes.length >= options.length) return null;
  if (correctIndexes.some((i) => !Number.isInteger(i) || i < 0 || i >= options.length)) return null;
  return { options, correctIndexes };
}

// Mélange les options d'une question "qcm_multi" en réindexant correctIndexes
// en conséquence — variante à plusieurs bonnes réponses de
// shuffleOptionsPreservingCorrectIndex.
function shuffleOptionsPreservingCorrectIndexes(options, correctIndexes) {
  const shuffledPositions = shuffleArray(options.map((_, i) => i));
  const correctSet = new Set(correctIndexes);
  const newCorrectIndexes = [];
  shuffledPositions.forEach((originalIndex, newIndex) => {
    if (correctSet.has(originalIndex)) newCorrectIndexes.push(newIndex);
  });
  return {
    options: shuffledPositions.map((originalIndex) => options[originalIndex]),
    correctIndexes: newCorrectIndexes
  };
}

// Valide les 3-4 éléments d'une question "ordre" — fournis par l'IA dans
// leur ordre correct, mélangés seulement à l'affichage (cf. stripQuestionForClient).
function validateOrderItems(rawItems) {
  if (!Array.isArray(rawItems)) return null;
  const items = [];
  const seen = new Set();
  for (const raw of rawItems) {
    const text = String(raw || "").trim();
    if (!text || text.length > 200) return null;
    const key = text.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    items.push(text);
  }
  if (items.length < 3 || items.length > 4) return null;
  return items;
}

// Normalise et valide les champs communs aux formats de question — la
// logique de dédup par source (sourceDebateId/sourceId, un ou plusieurs par
// source selon l'appelant) reste propre à validateNarrativeQuizQuestions
// (server.js), qui appelle ce helper puis y ajoute cette vérification. Une
// réponse de forme inconnue/invalide renvoie null, jamais une exception
// (traitée comme une question ignorée par l'appelant).
function validateQuestionItemCoreBase(item) {
  const questionType = QUESTION_TYPES.has(item?.type) ? item.type : "qcm";
  const question = String(item?.question || "").trim();
  const explanation = String(item?.explanation || "").trim();
  if (!question) return null;

  if (questionType === "association") {
    const pairs = validateAssociationPairs(item?.pairs);
    if (!pairs) return null;
    return { type: questionType, question, pairs, correctIndex: CUSTOM_GRADED_CORRECT_INDEX, explanation };
  }

  if (questionType === "qcm_multi") {
    const validated = validateQcmMultiOptions(item?.options, item?.correctIndexes);
    if (!validated) return null;
    const shuffled = shuffleOptionsPreservingCorrectIndexes(validated.options, validated.correctIndexes);
    return { type: questionType, question, options: shuffled.options, correctIndexes: shuffled.correctIndexes, correctIndex: CUSTOM_GRADED_CORRECT_INDEX, explanation };
  }

  if (questionType === "ordre") {
    const items = validateOrderItems(item?.items);
    if (!items) return null;
    return { type: questionType, question, items, correctIndex: CUSTOM_GRADED_CORRECT_INDEX, explanation };
  }

  const options = Array.isArray(item?.options) ? item.options.map((o) => String(o || "").trim()).filter(Boolean) : [];
  const correctIndex = Number(item?.correctIndex);
  // qcm/texte_a_trous/intrus : 4 options, comme avant l'introduction des
  // autres formats. vrai_faux : exactement 2 (ex. ["Vrai","Faux"]).
  const expectedLength = questionType === "vrai_faux" ? 2 : 4;
  if (options.length !== expectedLength) return null;
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= expectedLength) return null;
  if (questionType === "texte_a_trous" && !question.includes(FILL_BLANK_MARKER)) return null;
  const shuffled = shuffleOptionsPreservingCorrectIndex(options, correctIndex);
  return { type: questionType, question, options: shuffled.options, correctIndex: shuffled.correctIndex, explanation };
}

// Formats autorisés pour un altVariant (cf. buildQuestionFormatsPromptBlock
// dans server.js, includeAltVariant) : uniquement des formats autonomes
// autour d'un seul fait — jamais association/intrus/qcm_multi/ordre, qui ont
// besoin d'éléments supplémentaires qu'une simple reformulation ne peut
// fournir.
const ALT_VARIANT_ALLOWED_TYPES = new Set(["qcm", "vrai_faux", "texte_a_trous"]);

function validateAltVariant(rawAltVariant, primaryType) {
  if (!rawAltVariant || typeof rawAltVariant !== "object") return null;
  if (!ALT_VARIANT_ALLOWED_TYPES.has(rawAltVariant.type) || rawAltVariant.type === primaryType) return null;
  const core = validateQuestionItemCoreBase(rawAltVariant);
  if (!core || !ALT_VARIANT_ALLOWED_TYPES.has(core.type)) return null;
  // selfContained propre à cette variante (cf. validateQuestionItemCore) :
  // sa formulation peut être répondable sans les propositions même si la
  // question principale ne l'est pas, ou inversement — jamais hérité.
  return { ...core, selfContained: rawAltVariant?.selfContained === true };
}

// ── Jusqu'à 3 variantes par MemoryItem (refonte du 16/08/2026) ────────────
// Généralise altVariant (1 formulation secondaire max) à un tableau
// `variants` de 1 à 3 formulations d'UNE MÊME connaissance — jamais 3 par
// obligation (cf. lib/spaced-repetition/question-variant.js pour la
// sélection/rotation à la lecture, indépendante de ce validateur).
const MAX_VARIANTS_PER_QUESTION = 3;
// Modes de récupération distincts (jamais un identifiant métier, jamais lu
// par FSRS ni par natural_key) : direct (fait -> réponse), inverse (réponse
// -> fait, dans un sens qui reste non ambigu), contextuel (mise en situation
// sans reformuler juste la question). Volontairement restreint à ces 3 —
// n'ajoute pas de sous-catégories qui se chevauchent (cause/conséquence,
// terme/définition... sont déjà "direct" ou "inverse" selon le sens testé).
const VALID_RETRIEVAL_MODES = new Set(["direct", "inverse", "contextual"]);
// Seule la variante PRINCIPALE (variants[0]) peut être un format composite
// (association/qcm_multi/ordre/intrus) : ces formats encodent déjà toute la
// structure de la connaissance (un ensemble, une séquence, une catégorie) —
// les reformuler sous un autre angle n'a pas de sens et risquerait de
// tester une connaissance différente. Une variante secondaire reste
// obligatoirement un format autonome autour d'un seul fait, comme l'exigeait
// déjà ALT_VARIANT_ALLOWED_TYPES pour l'ancien altVariant.
const SECONDARY_VARIANT_ALLOWED_TYPES = ALT_VARIANT_ALLOWED_TYPES;

function attachVariantExtras(core, raw) {
  const retrievalMode = VALID_RETRIEVAL_MODES.has(raw?.retrievalMode) ? raw.retrievalMode : undefined;
  return { ...core, selfContained: raw?.selfContained === true, ...(retrievalMode ? { retrievalMode } : {}) };
}

// Valide le tableau `variants` d'une question — TOLÉRANT par variante
// plutôt que tout-ou-rien (revu le 16/08/2026 après observation réelle :
// l'IA ajoutait régulièrement, malgré la consigne du prompt, une 2e
// variante composite alors que la 1re l'était déjà — chaque variante
// individuellement valide, mais l'ensemble violant la règle de position).
// Rejeter le tableau ENTIER dans ce cas jetait aussi la variante principale,
// parfaitement valide seule — perte sèche d'un bon MemoryItem à cause d'un
// compagnon superflu. Chaque variante candidate est donc validée
// indépendamment ; une variante individuellement invalide, mal placée
// (composite hors position 0, ou ajoutée après une position 0 déjà
// composite) ou strictement dupliquée est simplement IGNORÉE plutôt que de
// faire échouer les autres — jamais d'exception, jamais un objet
// partiellement corrompu conservé. Seul un tableau qui ne laisse RIEN de
// valide après filtrage renvoie null.
function validateVariantsArray(rawVariants) {
  if (!Array.isArray(rawVariants) || !rawVariants.length) return null;
  const kept = [];
  const seen = new Set();
  for (const raw of rawVariants) {
    if (kept.length >= MAX_VARIANTS_PER_QUESTION) break;
    const core = validateQuestionItemCoreBase(raw);
    if (!core) continue;
    const isComposite = !SECONDARY_VARIANT_ALLOWED_TYPES.has(core.type);
    if (kept.length > 0 && isComposite) continue; // composite hors position 0
    if (kept.length > 0 && !SECONDARY_VARIANT_ALLOWED_TYPES.has(kept[0].type)) continue; // position 0 déjà composite : aucune autre admise
    const dedupeKey = `${core.type}::${core.question.trim().toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    kept.push(attachVariantExtras(core, raw));
  }
  return kept.length ? kept : null;
}

// Point d'entrée public. Deux formes acceptées en entrée :
// - nouvelle (demandée par le prompt actuel, cf. server.js
//   buildQuestionFormatsPromptBlock) : `variants` = tableau de 1 à 3
//   formulations. La variante principale (variants[0]) est aussi dupliquée
//   à plat à la racine de l'objet retourné — c'est ce que lisent
//   stripQuestionForClient/GET-fiche à la première exposition, qui
//   n'appellent jamais lib/spaced-repetition/question-variant.js.
// - ancienne (749 MemoryItems existants, jamais réécrits) : question à plat
//   + `altVariant` optionnel. Conservée en repli défensif seulement — la
//   génération actuelle ne produit plus cette forme, mais une réponse IA qui
//   n'aurait pas suivi la nouvelle consigne reste gérée plutôt que rejetée
//   en bloc.
// `knowledgeTarget` (optionnel, jamais un identifiant, jamais utilisé pour
// fusionner/dédupliquer) : la connaissance atomique que doivent tester
// TOUTES les variantes, écrite par l'IA elle-même avant de générer le
// contenu (garde-fou de génération, cf. section 11/12 de la refonte) — pas
// vérifiée sémantiquement ici (impossible en JS déterministe), seulement
// bornée en longueur.
function validateQuestionItemCore(item) {
  const knowledgeTarget = typeof item?.knowledgeTarget === "string" && item.knowledgeTarget.trim()
    ? item.knowledgeTarget.trim().slice(0, 300)
    : null;

  if (Array.isArray(item?.variants)) {
    const variants = validateVariantsArray(item.variants);
    if (!variants) return null;
    return { ...variants[0], variants, ...(knowledgeTarget ? { knowledgeTarget } : {}) };
  }

  const core = validateQuestionItemCoreBase(item);
  if (!core) return null;
  const altVariant = validateAltVariant(item?.altVariant, core.type);
  return {
    ...core,
    selfContained: item?.selfContained === true,
    ...(altVariant ? { altVariant } : {}),
    ...(knowledgeTarget ? { knowledgeTarget } : {})
  };
}

// ── Correction déterministe (jamais d'appel IA à la correction) ───────────

function isAssociationAnswerFullyCorrect(submittedPairs, correctPairs) {
  if (!Array.isArray(submittedPairs) || submittedPairs.length !== correctPairs.length) return false;
  const correctByLeft = new Map(correctPairs.map((p) => [p.left, p.right]));
  const seenLefts = new Set();
  for (const raw of submittedPairs) {
    const left = String(raw?.left || "").trim();
    const right = String(raw?.right || "").trim();
    if (!left || !right || seenLefts.has(left) || !correctByLeft.has(left)) return false;
    seenLefts.add(left);
    if (correctByLeft.get(left) !== right) return false;
  }
  return seenLefts.size === correctPairs.length;
}

// "qcm_multi" : correct seulement si l'ensemble des index cochés correspond
// exactement à question.correctIndexes (ni oubli, ni ajout en trop).
function isQcmMultiAnswerFullyCorrect(submittedIndexes, correctIndexes) {
  if (!Array.isArray(submittedIndexes)) return false;
  const submittedSet = new Set(submittedIndexes.map((n) => Number(n)));
  if (submittedSet.size !== submittedIndexes.length) return false;
  const correctSet = new Set(correctIndexes);
  if (submittedSet.size !== correctSet.size) return false;
  for (const i of submittedSet) if (!correctSet.has(i)) return false;
  return true;
}

// "ordre" : correct seulement si la séquence soumise correspond exactement,
// terme à terme, à question.items (l'ordre fourni par l'IA).
function isOrderAnswerFullyCorrect(submittedItems, correctItems) {
  if (!Array.isArray(submittedItems) || submittedItems.length !== correctItems.length) return false;
  for (let i = 0; i < correctItems.length; i++) {
    if (String(submittedItems[i] || "").trim() !== correctItems[i]) return false;
  }
  return true;
}

// Traduit une soumission brute (optionIndex simple, ou associationAnswer/
// optionIndexes/orderedItems selon le type) en l'index 0/CUSTOM_GRADED_CORRECT_INDEX
// stocké dans daily_quiz_answers.option_index — factorisé entre POST /answer
// (persiste) et POST /practice-answer (ne persiste jamais) pour que les deux
// routes gradent toujours de façon identique. Retourne null si la
// soumission est invalide (jamais 0, qui est une réponse fausse valide).
function gradeQuizSubmissionOptionIndex(question, body) {
  const questionType = question.type || "qcm";
  if (questionType === "association") {
    return isAssociationAnswerFullyCorrect(body?.associationAnswer, question.pairs || []) ? CUSTOM_GRADED_CORRECT_INDEX : 0;
  }
  if (questionType === "qcm_multi") {
    return isQcmMultiAnswerFullyCorrect(body?.optionIndexes, question.correctIndexes || []) ? CUSTOM_GRADED_CORRECT_INDEX : 0;
  }
  if (questionType === "ordre") {
    return isOrderAnswerFullyCorrect(body?.orderedItems, question.items || []) ? CUSTOM_GRADED_CORRECT_INDEX : 0;
  }
  const optionIndex = Number(body?.optionIndex);
  const maxIndex = (Array.isArray(question.options) ? question.options.length : 4) - 1;
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > maxIndex) return null;
  return optionIndex;
}

module.exports = {
  QUESTION_TYPES,
  FILL_BLANK_MARKER,
  CUSTOM_GRADED_CORRECT_INDEX,
  ALT_VARIANT_ALLOWED_TYPES,
  MAX_VARIANTS_PER_QUESTION,
  VALID_RETRIEVAL_MODES,
  shuffleArray,
  shuffleOptionsPreservingCorrectIndex,
  shuffleOptionsPreservingCorrectIndexes,
  validateAssociationPairs,
  validateQcmMultiOptions,
  validateOrderItems,
  validateQuestionItemCoreBase,
  validateAltVariant,
  validateVariantsArray,
  validateQuestionItemCore,
  isAssociationAnswerFullyCorrect,
  isQcmMultiAnswerFullyCorrect,
  isOrderAnswerFullyCorrect,
  gradeQuizSubmissionOptionIndex
};
