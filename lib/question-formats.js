// Extrait de server.js le 16/08/2026 (audit pédagogique des QCM) pour
// pouvoir tester ces fonctions unitairement — elles sont pures (aucun accès
// réseau/DB), portent la validation ET la correction déterministe des 7
// formats de question, et n'avaient jusqu'ici jamais pu être testées en
// isolation (server.js démarre tout le serveur Express à l'import). La
// construction des prompts IA (QUESTION_FORMAT_DEFS et consorts) reste dans
// server.js : ce fichier ne couvre que la structure des données, jamais la
// génération.

// VARIANT_FIELD_NAMES : réutilisée telle quelle (jamais redéfinie en double)
// pour reconstruire l'enveloppe à plat d'une question après filtrage de ses
// variantes, cf. filterVariantsByKnowledgeConstraints plus bas — même
// contrat que lib/spaced-repetition/question-variant.js
// resolveActiveQuestionVariant. Aucune dépendance circulaire : ce module-là
// ne requiert jamais lib/question-formats.js.
const { VARIANT_FIELD_NAMES } = require("./spaced-repetition/question-variant");
const {
  normalizeComparisonText,
  validateQuestionQuality,
  validateQuestionBatchQuality,
  validateFinalShuffledQuestion
} = require("./qcm-quality");
// Utilisé uniquement par deriveLegacyKnowledgeTargetId (chantier "Mémoriser/
// Non mémorisée", 07/09/2026) — hash déterministe, jamais un besoin
// cryptographique réel.
const crypto = require("crypto");

// Un corpus plus court ne constitue pas un véritable master Expert : il ne
// doit ni être mutualisé entre niveaux, ni figer une génération incomplète.
// Ce seuil laisse une marge aux rejets qualité par rapport à la cible de 20.
const MIN_MASTER_QUESTIONS = 15;

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
// "vrai_faux" (et tout format binaire équivalent oui/non, correct/incorrect)
// est INTERDIT (audit pédagogique du 16/08/2026, section 5) : ~50% de
// réussite au hasard structurel, aucune valeur de mesure de la mémorisation
// réelle. Retiré de cet ensemble le 16/08/2026. Depuis la chaîne V2, tout
// type inconnu est rejeté explicitement (plus aucune coercition silencieuse
// vers qcm) et un QCM impose toujours 4 options. Les MemoryItems
// vrai_faux déjà en base (jamais retouchés) restent lisibles et corrigeables
// tels quels : ce module ne revalide jamais du contenu déjà stocké, seulement
// les sorties IA fraîches (cf. server.js, validateQuestionItemCore).
const QUESTION_TYPES = new Set(["qcm", "texte_a_trous", "association", "intrus", "qcm_multi", "ordre"]);
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
  // V2 qualité : un type inconnu n'est plus transformé silencieusement en
  // QCM. La validation structurée est exécutée avant tout mélange d'options
  // afin que ses motifs décrivent fidèlement la sortie brute du modèle.
  const quality = validateQuestionQuality(item);
  if (!quality.valid) return null;
  const questionType = item.type;
  const question = String(item?.question || "").trim();
  const explanation = String(item?.explanation || "").trim();
  if (!question) return null;

  if (questionType === "association") {
    const pairs = validateAssociationPairs(item?.pairs);
    if (!pairs) return null;
    const finalQuestion = { type: questionType, question, pairs, correctIndex: CUSTOM_GRADED_CORRECT_INDEX, explanation };
    return validateFinalShuffledQuestion(item, finalQuestion).valid ? finalQuestion : null;
  }

  if (questionType === "qcm_multi") {
    const validated = validateQcmMultiOptions(item?.options, item?.correctIndexes);
    if (!validated) return null;
    const shuffled = shuffleOptionsPreservingCorrectIndexes(validated.options, validated.correctIndexes);
    const finalQuestion = { type: questionType, question, options: shuffled.options, correctIndexes: shuffled.correctIndexes, correctIndex: CUSTOM_GRADED_CORRECT_INDEX, explanation };
    return validateFinalShuffledQuestion(item, finalQuestion).valid ? finalQuestion : null;
  }

  if (questionType === "ordre") {
    const items = validateOrderItems(item?.items);
    if (!items) return null;
    const finalQuestion = { type: questionType, question, items, correctIndex: CUSTOM_GRADED_CORRECT_INDEX, explanation };
    return validateFinalShuffledQuestion(item, finalQuestion).valid ? finalQuestion : null;
  }

  const options = Array.isArray(item?.options) ? item.options.map((o) => String(o || "").trim()).filter(Boolean) : [];
  const correctIndex = Number(item?.correctIndex);
  // qcm/texte_a_trous/intrus : toujours 4 options. Fixé à 4 (jamais 2) depuis
  // le retrait de vrai_faux : une tentative de contournement ("qcm" avec
  // seulement 2 options déguisées en affirmation à trancher) échoue
  // mécaniquement ici plutôt que d'être
  // acceptée comme un format à 2 options valide.
  const expectedLength = 4;
  if (options.length !== expectedLength) return null;
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= expectedLength) return null;
  if (questionType === "texte_a_trous" && !question.includes(FILL_BLANK_MARKER)) return null;
  const shuffled = shuffleOptionsPreservingCorrectIndex(options, correctIndex);
  const finalQuestion = { type: questionType, question, options: shuffled.options, correctIndex: shuffled.correctIndex, explanation };
  return validateFinalShuffledQuestion(item, finalQuestion).valid ? finalQuestion : null;
}

// Validation d'une question ÉDITÉE À LA MAIN par un utilisateur (cf.
// POST /api/users/notion-quizzes/edit-questions, server.js) — délibérément
// séparée de validateQuestionItemCoreBase/validateQuestionQuality
// (lib/qcm-quality.js) : ces dernières portent des heuristiques pensées pour
// juger une sortie IA fraîche (double négation interdite, "oui/non déguisé",
// explication obligatoire...) qui n'ont pas lieu de bloquer un utilisateur
// corrigeant son propre contenu déjà validé une première fois. Seule la
// structure (nombre d'options, bornes de l'index correct, champs non vides)
// est vérifiée ici. Ne mélange jamais les options : l'utilisateur choisit
// lui-même où placer sa bonne réponse.
function validateEditedQuestionStructure(item, { isNewQuestion = false } = {}) {
  const type = item?.type;
  if (isNewQuestion && type !== "qcm") return null;
  const question = String(item?.question || "").trim().slice(0, 500);
  const explanation = String(item?.explanation || "").trim().slice(0, 500);
  if (!question) return null;

  if (type === "association") {
    const pairs = validateAssociationPairs(item?.pairs);
    if (!pairs) return null;
    return { type, question, pairs, correctIndex: CUSTOM_GRADED_CORRECT_INDEX, explanation };
  }

  if (type === "qcm_multi") {
    const validated = validateQcmMultiOptions(item?.options, item?.correctIndexes);
    if (!validated) return null;
    return { type, question, options: validated.options, correctIndexes: validated.correctIndexes, correctIndex: CUSTOM_GRADED_CORRECT_INDEX, explanation };
  }

  if (type === "ordre") {
    const items = validateOrderItems(item?.items);
    if (!items) return null;
    return { type, question, items, correctIndex: CUSTOM_GRADED_CORRECT_INDEX, explanation };
  }

  // qcm / texte_a_trous / intrus (4 options) et le legacy vrai_faux (2
  // options, jamais proposable en ajout — cf. isNewQuestion ci-dessus, un
  // type inconnu autre que ceux listés est de toute façon rejeté par
  // expectedLength qui ne vaudra jamais la vraie longueur soumise).
  if (!["qcm", "texte_a_trous", "intrus", "vrai_faux"].includes(type)) return null;
  const options = Array.isArray(item?.options) ? item.options.map((o) => String(o || "").trim().slice(0, 200)).filter(Boolean) : [];
  const correctIndex = Number(item?.correctIndex);
  const expectedLength = type === "vrai_faux" ? 2 : 4;
  if (options.length !== expectedLength) return null;
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= expectedLength) return null;
  if (type === "texte_a_trous" && !question.includes(FILL_BLANK_MARKER)) return null;
  return { type, question, options, correctIndex, explanation };
}

// Champs propres au pipeline de génération/qualité IA (rang pédagogique
// inter-niveaux, formulations alternatives calées sur le texte pré-édition)
// sans plus aucun sens une fois le contenu devenu une édition manuelle
// mono-niveau — jamais reconduits sur une nouvelle question ajoutée à la main.
const AI_PIPELINE_ONLY_FIELDS = ["pedagogicalRank", "variants", "altVariant", "knowledgeTarget", "supporting_claim", "source_ids", "selfContained", "retrievalMode"];

// Fusionne le tableau de questions soumis par le client avec les questions
// ORIGINALES de la ligne daily_quiz visée — jamais l'inverse. Le client ne
// reçoit jamais (cf. GET /fiche) sourceType/sourceDebateId/sourceName/
// sourceDetail/sourceThemes/sourcePlacement/level par question : ces champs
// ne peuvent donc venir QUE de l'original, jamais d'une valeur soumise, sous
// peine qu'un client forge un sourceDebateId qui pollue le suivi FSRS/"Mes
// acquis" (indexé par sourceDebateId, cf. server.js). Retourne null si une
// question échoue sa validation structurelle ou si le résultat est vide.
//
// `forceNewIds` (true uniquement lors de la toute première bifurcation
// master partagé -> copie privée, jamais lors d'une mise à jour en place
// d'une copie déjà privée) : régénère l'id de TOUTE question, y compris
// celles simplement éditées qui, sans ça, garderaient l'id du master.
// Nécessaire car daily_quiz_answers (qui détermine "déjà répondu" pour
// GET /api/daily-quiz/today) n'a AUCUNE colonne slot — seulement
// (quiz_date, voter_key, question_id). Si la copie forkée est créée le même
// jour que le master (cas courant), garder le même id sur une question
// éditée aurait fait apparaître l'ancienne réponse (donnée sur l'ancien
// texte/les anciennes options) comme valable sur la version modifiée, en
// l'excluant à tort de "Refaire le parcours d'apprentissage" — demande du
// 03/09/2026, "il faudrait que les questions modifiées soient prises en
// compte quand on recommence le qcm, et comptent pour le FSRS". memory_items
// (FSRS), lui, est déjà scopé par slot — seul daily_quiz_answers imposait ce
// contournement.
function mergeEditedQuestionsPayload(originalQuestions, submittedQuestions, { newIdPrefix, forceNewIds = false } = {}) {
  if (!Array.isArray(originalQuestions) || !originalQuestions.length) return null;
  if (!Array.isArray(submittedQuestions)) return null;

  const originalById = new Map();
  for (const q of originalQuestions) if (q?.id) originalById.set(String(q.id), q);
  const templateMeta = { ...originalQuestions[0] };
  for (const field of AI_PIPELINE_ONLY_FIELDS) delete templateMeta[field];
  // Champs core retirés du gabarit de métadonnées : ils viennent toujours de
  // la soumission (édition) ou sont recalculés (ajout), jamais recopiés tels
  // quels depuis originalQuestions[0].
  delete templateMeta.id;
  delete templateMeta.type;
  delete templateMeta.question;
  delete templateMeta.explanation;
  delete templateMeta.options;
  delete templateMeta.correctIndex;
  delete templateMeta.correctIndexes;
  delete templateMeta.pairs;
  delete templateMeta.items;

  const result = [];
  let newQuestionCounter = 0;
  for (const submitted of submittedQuestions) {
    const submittedId = submitted?.id ? String(submitted.id) : null;
    const original = submittedId ? originalById.get(submittedId) : null;
    const isNewQuestion = !original;

    const structural = validateEditedQuestionStructure(
      isNewQuestion ? submitted : { ...submitted, type: original.type },
      { isNewQuestion }
    );
    if (!structural) return null;

    if (isNewQuestion) {
      newQuestionCounter += 1;
      result.push({ ...templateMeta, ...structural, id: `${newIdPrefix}:q-${newQuestionCounter}-${Date.now().toString(36)}` });
    } else if (forceNewIds) {
      newQuestionCounter += 1;
      const originalMeta = { ...original };
      for (const field of ["type", "question", "explanation", "options", "correctIndex", "correctIndexes", "pairs", "items"]) delete originalMeta[field];
      result.push({ ...originalMeta, ...structural, id: `${newIdPrefix}:q-${newQuestionCounter}-${Date.now().toString(36)}` });
    } else {
      const originalMeta = { ...original };
      for (const field of ["type", "question", "explanation", "options", "correctIndex", "correctIndexes", "pairs", "items"]) delete originalMeta[field];
      result.push({ ...originalMeta, ...structural, id: original.id });
    }
  }
  if (!result.length) return null;
  return result;
}

// Formats autorisés pour un altVariant (cf. buildQuestionFormatsPromptBlock
// dans server.js, includeAltVariant) : uniquement des formats autonomes
// autour d'un seul fait — jamais association/intrus/qcm_multi/ordre, qui ont
// besoin d'éléments supplémentaires qu'une simple reformulation ne peut
// fournir. "vrai_faux" retiré le 16/08/2026 (section 5, interdiction
// absolue) — ne reste jamais l'un des deux seuls formats autonomes possibles
// pour une reformulation.
const ALT_VARIANT_ALLOWED_TYPES = new Set(["qcm", "texte_a_trous"]);

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
    const dedupeKey = `${core.type}::${normalizeComparisonText(core.question)}`;
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
// `supporting_claim`/`source_ids` (V3, 31/08/2026 — "traçabilité factuelle
// des QCM par traçabilité aux sources") : mêmes principes que
// `knowledgeTarget" juste au-dessus — portés par le modèle, jamais un
// identifiant, jamais utilisés ici pour fusionner/dédupliquer. Seule une
// validation STRUCTURELLE légère a sa place ici (bornes de longueur/type) ;
// la vérification que l'affirmation est réellement soutenue par les
// sources citées est le rôle de lib/question-grounding-validation.js
// (validateQuestionGrounding), appelée en amont dans le pipeline qualité
// (lib/qcm-quality.js) — jamais dupliquée ici.
function extractGroundingFields(item) {
  const claim = typeof item?.supporting_claim === "string" ? item.supporting_claim.trim().slice(0, 500) : null;
  const sourceIds = Array.isArray(item?.source_ids)
    ? item.source_ids.filter((id) => typeof id === "string" && id).slice(0, 10)
    : null;
  const fields = {};
  if (claim) fields.supporting_claim = claim;
  if (sourceIds && sourceIds.length) fields.source_ids = sourceIds;
  return fields;
}

function validateQuestionItemCore(item) {
  const knowledgeTarget = typeof item?.knowledgeTarget === "string" && item.knowledgeTarget.trim()
    ? item.knowledgeTarget.trim().slice(0, 300)
    : null;
  const groundingFields = extractGroundingFields(item);

  if (Array.isArray(item?.variants)) {
    const variants = validateVariantsArray(item.variants);
    if (!variants) return null;
    return { ...variants[0], variants, ...(knowledgeTarget ? { knowledgeTarget } : {}), ...groundingFields };
  }

  const core = validateQuestionItemCoreBase(item);
  if (!core) return null;
  const altVariant = validateAltVariant(item?.altVariant, core.type);
  return {
    ...core,
    selfContained: item?.selfContained === true,
    ...(altVariant ? { altVariant } : {}),
    ...(knowledgeTarget ? { knowledgeTarget } : {}),
    ...groundingFields
  };
}

// Version structurée destinée à l'orchestrateur V2 et aux métriques. Le
// validateur historique ci-dessus conserve son contrat null|question pour
// ne pas casser les appelants et les anciens QCM déjà stockés.
function inspectGeneratedQuestionBatch(rawQuestions, options) {
  return validateQuestionBatchQuality(rawQuestions, options);
}

// "low" jamais admis, sur "importance" comme "certainty" (cf. server.js
// buildKnowledgeAdmissionPrompt : déjà demandé au prompt de ne pas les
// inclure — filtré ici aussi en repli, pour une réponse IA qui n'aurait pas
// suivi la consigne).
const KNOWLEDGE_ADMISSION_LEVELS = new Set(["high", "medium"]);

// Validation structurelle des connaissances candidates émises par l'étape
// d'admission (server.js buildKnowledgeAdmissionPrompt/
// buildFicheAndKnowledgeAdmissionPrompt — demande du 17/08/2026, audit du
// pipeline mnésique : sélectionner les connaissances AVANT de générer des
// questions, jamais l'inverse). Comme validateQuestionItemCore ci-dessus,
// jamais de vérification sémantique ici (impossible en JS déterministe) —
// uniquement la forme : bornes de longueur, valeurs d'énumération
// autorisées, dédoublonnage par texte normalisé (un même fait répété deux
// fois par l'IA ne doit pas produire deux "connaissances" distinctes).
function validateKnowledgeCandidates(raw, { max = 20 } = {}) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const valid = [];
  for (const item of raw) {
    const fact = typeof item?.fact === "string" ? item.fact.trim().slice(0, 400) : "";
    if (!fact) continue;
    if (!KNOWLEDGE_ADMISSION_LEVELS.has(item?.importance) || !KNOWLEDGE_ADMISSION_LEVELS.has(item?.certainty)) continue;
    const key = fact.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push({
      fact,
      importance: item.importance,
      certainty: item.certainty,
      sequential: item?.sequential === true,
      clearBoundary: item?.clearBoundary === true
    });
    if (valid.length >= max) break;
  }
  return valid;
}

function normalizeFactText(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Garde-fou structurel (demande du 17/08/2026, section 12/2 : "aucun nouveau
// knowledgeTarget ne doit apparaître spontanément au moment de fabriquer les
// questions") — vient S'AJOUTER à la consigne de prompt (server.js
// buildQuestionsFromKnowledgePrompt : "reprends EXACTEMENT le texte du fait"),
// jamais s'y substituer : une question dont le knowledgeTarget ne correspond
// à AUCUNE connaissance admise (absent, mal recopié, ou inventé) est
// retirée ici plutôt que silencieusement conservée en confiance dans le
// prompt seul. Comparaison texte normalisé (casse/espaces), jamais
// sémantique (hors de portée déterministe, même limite que knowledgeTarget
// partout ailleurs dans ce fichier).
function filterQuestionsToAdmittedKnowledge(questions, admittedKnowledge) {
  const admittedKeys = new Set(admittedKnowledge.map((k) => normalizeFactText(k.fact)));
  return questions.filter((q) => admittedKeys.has(normalizeFactText(q.knowledgeTarget)));
}

function isVariantAllowedByKnowledgeConstraints(variant, matchedKnowledge) {
  if (variant?.type === "ordre" && matchedKnowledge.sequential !== true) return false;
  if (variant?.type === "intrus" && matchedKnowledge.clearBoundary !== true) return false;
  return true;
}

function pickFields(obj, fields) {
  const out = {};
  for (const key of fields) if (obj?.[key] !== undefined) out[key] = obj[key];
  return out;
}

// Garde-fou PROGRAMMATIQUE côté serveur (demande du 17/08/2026, second
// mini-patch) : sequential/clearBoundary sont envoyés au modèle comme
// consigne de prompt (server.js buildQuestionsFromKnowledgePrompt), jamais
// comme une garantie — cette fonction fait respecter ces deux signaux
// indépendamment du respect du prompt par le modèle. Une variante "ordre"
// sur une connaissance dont "sequential" n'est pas strictement `true`, ou
// une variante "intrus" sur une connaissance dont "clearBoundary" n'est pas
// strictement `true`, est retirée ICI, après coup — jamais seulement
// dissuadée en amont. C'est le correctif direct du cas Habermas de l'audit :
// même si le modèle génère quand même "ordre" pour un concept non
// séquentiel, cette variante ne peut plus atteindre daily_quiz.questions.
//
// Réutilise EXACTEMENT le même appariement texte normalisé que
// filterQuestionsToAdmittedKnowledge (jamais une seconde logique de
// correspondance) — appelée juste après elle, sur des questions dont le
// knowledgeTarget est donc déjà garanti correspondre à une connaissance
// admise. Si aucune correspondance n'est trouvée malgré tout (défensif,
// ne devrait pas arriver après filterQuestionsToAdmittedKnowledge), la
// question est laissée inchangée : ce filtre est hors de son périmètre pour
// elle, pas une raison de la rejeter lui-même.
//
// Ne fabrique JAMAIS de variante de remplacement : une question dont TOUTES
// les variantes sont retirées est simplement exclue du résultat (même
// philosophie de rejet silencieux que filterQuestionsToAdmittedKnowledge/
// validateKnowledgeCandidates — moins de contenu qu'espéré est un résultat
// normal, jamais une raison de compenser artificiellement). Si seule
// variants[0] est retirée, la variante suivante restante devient la
// nouvelle variants[0] et ses champs sont reflatés à la racine de l'objet
// (même contrat que lib/spaced-repetition/question-variant.js
// resolveActiveQuestionVariant, qui lit toujours ces champs à plat pour la
// toute première exposition) — jamais de trou dans le tableau.
//
// Nouvelle génération UNIQUEMENT : à appeler juste après
// validateNarrativeQuizQuestions/filterQuestionsToAdmittedKnowledge, avant
// stockage. Ne touche jamais un objet déjà lu depuis daily_quiz existant —
// un "ordre"/"intrus" déjà en base avant ce correctif n'est jamais retouché
// rétroactivement.
function filterVariantsByKnowledgeConstraints(questions, admittedKnowledge) {
  const byNormalizedFact = new Map(admittedKnowledge.map((k) => [normalizeFactText(k.fact), k]));
  const result = [];
  for (const question of questions) {
    const matched = byNormalizedFact.get(normalizeFactText(question?.knowledgeTarget));
    if (!matched) {
      result.push(question);
      continue;
    }
    const hasVariantsArray = Array.isArray(question.variants) && question.variants.length > 0;
    const sourceVariants = hasVariantsArray ? question.variants : [pickFields(question, VARIANT_FIELD_NAMES)];
    const kept = sourceVariants.filter((v) => isVariantAllowedByKnowledgeConstraints(v, matched));
    if (!kept.length) continue; // question entière rejetée, jamais de variante de remplacement fabriquée
    if (kept.length === sourceVariants.length) {
      result.push(question); // rien filtré, objet inchangé
      continue;
    }
    const envelope = { ...question };
    for (const key of VARIANT_FIELD_NAMES) delete envelope[key];
    result.push({
      ...envelope,
      ...kept[0],
      ...(hasVariantsArray ? { variants: kept } : {})
    });
  }
  return result;
}

// Réconciliation d'une génération BATCHÉE (plusieurs connaissances dans le
// même appel IA, cf. server.js buildImportedKnowledgeQuestionsBatch — audit
// coût import photo, 24/08/2026) contre les connaissances qui devaient
// chacune produire au plus une question. Prend en entrée des questions déjà
// passées par validateNarrativeQuizQuestions (donc `sourceDebateId` déjà
// posé et déjà garanti être un id demandé, cf. server.js) puis par
// filterQuestionsToAdmittedKnowledge/filterVariantsByKnowledgeConstraints —
// ne fait ICI qu'une dernière vérification, spécifique au batch : l'id
// renvoyé pour une question doit correspondre à UNE connaissance du batch ET
// son "knowledgeTarget" doit correspondre AU FAIT DE CETTE CONNAISSANCE
// PRÉCISE (pas seulement à une connaissance quelconque du lot, déjà garanti
// plus haut) — sinon la question est ignorée ici plutôt que risquée d'être
// associée à la mauvaise connaissance. `admittedKnowledge` : tableau
// {id, fact, ...} — chaque élément DOIT porter un `id` (cf. server.js,
// admittedKnowledge du batch, jamais du chemin à un seul id partagé).
// Retourne { resultsById: Map<id, question>, missingIds: string[] } — toute
// connaissance sans question valide (absente de la réponse IA, id inconnu,
// doublon, ou knowledgeTarget désynchronisé) ressort dans `missingIds`,
// jamais silencieusement perdue : c'est à l'appelant de décider du repli
// (cf. server.js, repli individuel ciblé sur ces seules connaissances).
function reconcileKnowledgeBatchResults(validatedQuestions, admittedKnowledge) {
  const knowledgeById = new Map(admittedKnowledge.map((k) => [k.id, k]));
  const resultsById = new Map();
  for (const question of validatedQuestions) {
    const knowledgeForId = knowledgeById.get(question?.sourceDebateId);
    if (!knowledgeForId) continue; // id inconnu (déjà filtré en amont normalement, défensif ici)
    if (normalizeFactText(question.knowledgeTarget) !== normalizeFactText(knowledgeForId.fact)) continue; // connaissance/id désynchronisés
    if (resultsById.has(question.sourceDebateId)) continue; // doublon : seule la première question conservée
    resultsById.set(question.sourceDebateId, question);
  }
  const missingIds = admittedKnowledge.map((k) => k.id).filter((id) => !resultsById.has(id));
  return { resultsById, missingIds };
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

// ── V4.0 (demande du 01/09/2026 — "corpus maître de 20 questions,
// découplage generationDepth/requestedLevel") ──────────────────────────────
// L'audit du 31/08/2026 a montré qu'importance/certainty existent déjà à
// l'admission (validateKnowledgeCandidates ci-dessus) mais disparaissent
// avant le stockage des questions — aucune métadonnée n'existait pour
// distinguer "les 5 plus fondamentales" du reste. Chemin délibérément
// minimal (section 3 de la demande) : réutilise le signal importance déjà
// produit et vérifié, JAMAIS un nouveau scoring, JAMAIS l'ordre de
// génération, JAMAIS la position après régénération, JAMAIS la difficulté
// des distracteurs.
//
// "high" avant "medium" (seules valeurs possibles à ce stade —
// validateKnowledgeCandidates n'admet jamais "low"). Tri STABLE au sein d'un
// même palier d'importance : l'ordre relatif conservé est l'ordre
// d'ADMISSION d'origine (jamais mélangé, jamais alphabétique). Le
// tie-breaker explicite sur l'index d'origine rend le résultat déterministe
// indépendamment de toute garantie de stabilité du moteur JS.
const IMPORTANCE_RANK_ORDER = { high: 0, medium: 1 };

function rankAdmittedKnowledge(admittedKnowledge) {
  const withOriginalIndex = (Array.isArray(admittedKnowledge) ? admittedKnowledge : []).map((k, index) => ({ knowledge: k, index }));
  withOriginalIndex.sort((a, b) => {
    const rankA = IMPORTANCE_RANK_ORDER[a.knowledge?.importance] ?? 1;
    const rankB = IMPORTANCE_RANK_ORDER[b.knowledge?.importance] ?? 1;
    if (rankA !== rankB) return rankA - rankB;
    return a.index - b.index;
  });
  return withOriginalIndex.map((entry, position) => ({ ...entry.knowledge, pedagogicalRank: position + 1 }));
}

// Rattache pedagogicalRank à chaque question finale via son knowledgeTarget
// — même appariement texte normalisé que filterQuestionsToAdmittedKnowledge/
// filterVariantsByKnowledgeConstraints ci-dessus, jamais une seconde logique
// de correspondance. JAMAIS via la position dans le tableau `questions`, qui
// peut ne plus correspondre à l'ordre d'admission après régénération ciblée
// ou expansion des sources (V3.2, lib/grounding-source-expansion.js) : une
// question régénérée pour la MÊME connaissance récupère donc AUTOMATIQUEMENT
// le même rang que celle qu'elle remplace, jamais un rang recalculé à partir
// de sa nouvelle position (les remplacements sont ajoutés en fin de tableau,
// cf. lib/qcm-quality.js runQuestionQualityPipeline). Une question dont le
// knowledgeTarget ne correspond à AUCUNE connaissance classée (ne devrait
// pas arriver après filterQuestionsToAdmittedKnowledge, défensif) reste sans
// pedagogicalRank plutôt que d'en inventer un.
// knowledgeTargetId (chantier "Mémoriser/Non mémorisée" par connaissance,
// 06/09/2026) : persisté ICI, au même moment et par le même appariement texte
// normalisé que pedagogicalRank — jamais une seconde logique de
// correspondance. `k.id` provient du curriculum (daily_quiz.curriculum[].id,
// ex. "k3", cf. lib/notion-quiz-curriculum.js) quand l'appelant le fournit
// (pipeline progressif) ; absent pour le master V4.0 legacy
// (rankAdmittedKnowledge, aucune notion de curriculum/id stable) — dans ce
// cas la question garde `knowledgeTargetId` absent, JAMAIS une valeur
// inventée (cf. resolveLegacyQuestionKnowledgeTargetId pour le fallback
// texte réservé à la LECTURE d'un master ancien qui n'a jamais eu ce champ).
function attachPedagogicalRanks(questions, rankedKnowledge) {
  const byFact = new Map((Array.isArray(rankedKnowledge) ? rankedKnowledge : [])
    .map((k) => [normalizeFactText(k.fact), { pedagogicalRank: k.pedagogicalRank, knowledgeTargetId: k.id || null }]));
  return (Array.isArray(questions) ? questions : []).map((question) => {
    const match = byFact.get(normalizeFactText(question?.knowledgeTarget));
    if (!match || !Number.isInteger(match.pedagogicalRank)) return question;
    return {
      ...question,
      pedagogicalRank: match.pedagogicalRank,
      ...(match.knowledgeTargetId ? { knowledgeTargetId: match.knowledgeTargetId } : {})
    };
  });
}

// Id dérivé pour un master SANS AUCUN curriculum (masters V4.0/legacy —
// rankAdmittedKnowledge : Éclairages, Ce jour dans l'Histoire, imports
// photo/PDF/texte/URL/YouTube, débats-notion, anciens sujets libres
// antérieurs à la génération progressive — cf. audit du 07/09/2026, "92% du
// contenu réel n'a pas de curriculum, le contrôle n'apparaissait donc
// presque jamais"). Hash déterministe de normalizeFactText(knowledgeTarget)
// — jamais un id "au hasard" : il ne peut changer que si le texte de la
// connaissance change, ce qui n'arrive jamais après génération (une
// question n'est jamais réécrite en place, seulement remplacée en fin de
// tableau lors d'une régénération ciblée, qui reprend alors le MÊME
// knowledgeTarget donc le MÊME hash). Préfixe "f" (jamais "k", réservé aux
// ids de curriculum) : distingue visuellement les deux origines, sans
// signification fonctionnelle au-delà. Scopé par l'appelant via
// (subject_type, subject_source_id) dans la clé de préférence — deux
// masters différents produisant le même hash ne collisionnent donc jamais
// réellement.
function deriveLegacyKnowledgeTargetId(knowledgeTarget) {
  const key = normalizeFactText(knowledgeTarget);
  if (!key) return null;
  return "f" + crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);
}

// Fallback LECTURE SEULE pour un master généré AVANT le champ
// question.knowledgeTargetId (06/09/2026, étendu le 07/09/2026) : résout un
// id stable pour une question ancienne, jamais par invention arbitraire.
//
// Deux cas selon que ce master a un curriculum ou non (cf. daily_quiz.curriculum,
// seul le pipeline progressif "sujet libre" en produit un) :
// - curriculum PRÉSENT : appariement texte normalisé contre ses entrées.
//   Règle stricte (diagnostic du 06/09/2026, point 19) : exactement UNE
//   correspondance -> son id ; 0 ou PLUSIEURS -> null, jamais un choix
//   arbitraire (un curriculum peut légitimement contenir deux
//   knowledgeTarget quasi identiques après une réparation ratée — mieux
//   vaut ne pas proposer le contrôle que de le brancher sur la mauvaise
//   connaissance).
// - curriculum ABSENT (master V4.0/legacy, aucune liste à comparer) : id
//   dérivé directement du texte de CETTE question (deriveLegacyKnowledgeTargetId)
//   — c'est la majorité réelle du contenu (cf. audit du 07/09/2026), sans
//   ce fallback le contrôle de mémorisation n'apparaîtrait quasiment jamais
//   en usage réel.
//
// Pure, aucun accès réseau : l'appelant fournit déjà `curriculum`
// (daily_quiz.curriculum, éventuellement null) et la question déjà lue.
function resolveLegacyQuestionKnowledgeTargetId(question, curriculum) {
  if (question?.knowledgeTargetId) return question.knowledgeTargetId;
  const list = Array.isArray(curriculum) ? curriculum : [];
  if (list.length) {
    const key = normalizeFactText(question?.knowledgeTarget);
    if (!key) return null; // curriculum réel à comparer, mais rien à comparer -> jamais un choix arbitraire
    const matches = list.filter((k) => normalizeFactText(k?.knowledgeTarget) === key);
    return matches.length === 1 ? (matches[0].id || null) : null;
  }
  // Pas de curriculum ET pas de question.knowledgeTarget (contenu très
  // ancien, antérieur à ce champ — ex. certaines questions "Ce jour dans
  // l'Histoire" d'avant le 17/08/2026, constaté en audit réel le 07/09/2026) :
  // repli sur le texte de la question elle-même. Ce format n'a jamais
  // regroupé plusieurs questions sous une même connaissance (une question =
  // un fait, jamais de variantes multiples pour ce pipeline), donc dériver
  // depuis `question.question` reste fidèle à "un id par connaissance",
  // jamais une régression vers "un id par question" pour le contenu qui,
  // lui, a de vraies variantes (curriculum présent ou knowledgeTarget posé).
  return deriveLegacyKnowledgeTargetId(question?.knowledgeTarget || question?.question);
}

// Sélection de service par niveau (section 8 de la demande) — fonction PURE,
// jamais de mutation du tableau reçu, jamais de réordonnancement physique du
// master (celui-ci reste toujours stocké tel quel côté appelant, cf.
// server.js). Rétrocompatibilité stricte (section 9) : un quiz SANS AUCUN
// pedagogicalRank (legacy, généré avant le 01/09/2026 — Éclairages/Histoire/
// Comprendre/imports, ou tout quiz notion/custom antérieur à cette version)
// est renvoyé strictement INCHANGÉ, quel que soit `maxQuestions` — jamais de
// tentative de deviner rétroactivement un classement, jamais de backfill.
//
// `maxQuestions` : le plafond déjà résolu par l'appelant (typiquement
// NOTION_QUIZ_LEVELS[level].target côté server.js — jamais un nombre
// dupliqué ici, section 8 : "utiliser les vraies constantes existantes").
// Valeur non finie (absente/null/NaN) = aucun plafond, renvoie le master
// complet MAIS toujours trié par rang (utile notamment pour Noès, cf.
// server.js triggerAutomaticNoesVideo, qui a besoin de l'ordre pédagogique
// sans nécessairement vouloir un sous-ensemble tronqué).
//
// Questions sans pedagogicalRank mêlées à des questions classées (cas
// défensif, ne devrait pas arriver pour un master V4.0 où chaque question
// admise reçoit un rang) : les classées passent toujours en premier, triées
// par rang ; les non classées suivent, jamais prioritaires ni mélangées
// avant une question réellement classée.
function selectQuestionsForRequestedLevel(questions, maxQuestions) {
  const list = Array.isArray(questions) ? questions : [];
  if (!list.length) return list;
  const hasAnyRank = list.some((q) => Number.isInteger(q?.pedagogicalRank));
  if (!hasAnyRank) return list;

  const ranked = [];
  const unranked = [];
  for (const q of list) {
    if (Number.isInteger(q?.pedagogicalRank)) ranked.push(q);
    else unranked.push(q);
  }
  ranked.sort((a, b) => a.pedagogicalRank - b.pedagogicalRank);
  const ordered = [...ranked, ...unranked];
  const cap = Number.isFinite(maxQuestions) && maxQuestions >= 0 ? maxQuestions : ordered.length;
  return ordered.slice(0, cap);
}

// ── Plafond de niveau progressif (Phase 2.2, 04/09/2026, "une question ne
// doit jamais dépasser le niveau pédagogique visible") ── Extrait un bug
// réel constaté en production : selectQuestionsForRequestedLevel ci-dessus
// ne tranche QUE par rang + compte fixe (`maxQuestions`), jamais par niveau
// propre de chaque question — correct pour le legacy (les 20 questions du
// master sont TOUJOURS générées en une seule passe, aucun trou possible),
// mais incorrect pour le progressif : le bloc Élémentaire peut être servi
// avec MOINS que NOTION_QUIZ_LEVELS.elementaire.target questions (4/5 est
// même le cas courant, jamais seulement "dégradé"), et la continuation
// ajoute ensuite des questions Approfondi/Expert au MÊME tableau — une
// relecture ultérieure du niveau Élémentaire pouvait alors combler le
// compte fixe avec la première question Approfondi disponible par rang
// (cas réel : une question sur le "Corpus juris civilis", absent de la
// fiche Élémentaire visible, servie parmi les questions Élémentaires d'un
// apprentissage sur Justinien).
//
// PROGRESSIVE_LEVEL_ORDER dupliqué volontairement depuis server.js (même
// principe que normalizeComparisonText entre lib/qcm-quality.js et
// lib/question-grounding-validation.js) : ce fichier reste PUR (aucune
// dépendance vers server.js, testable en isolation) — jamais une seconde
// source de vérité qui pourrait diverger, les 3 valeurs ("elementaire",
// "avance", "expert") sont figées et partagées avec NOTION_QUIZ_LEVELS
// (server.js) depuis la toute première version du pipeline progressif.
const PROGRESSIVE_LEVEL_ORDER = ["elementaire", "avance", "expert"];

// `progressiveStatus` : la valeur persistée sur la ligne daily_quiz
// (NULL pour tout master legacy, jamais autre chose — cf. migration
// data/migration-daily-quiz-progressive.sql). C'EST le seul signal fiable
// distinguant les deux régimes : `question.level` en legacy n'est PAS un
// tag de difficulté par connaissance, c'est le niveau de LA REQUÊTE qui a
// déclenché la génération des 20 questions (identique sur toutes) — le
// filtrer par valeur casserait la mutualisation inter-niveaux legacy (un
// master généré via une requête "Expert" ne renverrait plus rien pour une
// requête "Élémentaire"). D'où ce garde-fou en toute première ligne,
// NON NÉGOCIABLE : `!progressiveStatus` retourne `questions` strictement
// inchangé, jamais un caractère différent du comportement historique.
//
// `effectiveLevel` non reconnu (absent, mal formé) : repli sûr, aucun
// filtrage — ne JAMAIS risquer de vider un master progressif légitime par
// excès de prudence sur un niveau qu'on ne sait pas interpréter.
//
// Question progressive dont `.level` est absent/non reconnu (ne devrait
// jamais arriver — chaque bloc du pipeline le pose systématiquement, cf.
// server.js generateProgressiveLevelBlock) : traitée comme le niveau le
// PLUS élevé (Expert) — jamais un contournement silencieux de ce garde-fou
// vers un niveau inférieur, mais jamais perdue définitivement non plus
// (redevient visible dès que la lecture cumule jusqu'à Expert).
function restrictQuestionsToProgressiveLevelCeiling(questions, effectiveLevel, progressiveStatus) {
  const list = Array.isArray(questions) ? questions : [];
  if (!progressiveStatus) return questions;
  const ceilingRank = PROGRESSIVE_LEVEL_ORDER.indexOf(effectiveLevel);
  if (ceilingRank < 0) return questions;
  return list.filter((q) => {
    const rank = PROGRESSIVE_LEVEL_ORDER.indexOf(q?.level);
    return rank < 0 ? ceilingRank >= PROGRESSIVE_LEVEL_ORDER.length - 1 : rank <= ceilingRank;
  });
}

// V4.1 (01/09/2026, "mutualisation inter-niveaux du master QCM") : seul
// signal robuste distinguant un vrai master (V4.0+, profondeur toujours
// générée au niveau expert puis servie par sous-ensemble, cf.
// MASTER_GENERATION_DEPTH_CONFIG côté server.js) d'un QCM antérieur à V4.0
// (taille fixe par niveau, jamais mutualisable entre niveaux) — pedagogicalRank
// n'existe que sur les questions produites par attachPedagogicalRanks
// ci-dessus, jamais sur un ancien quiz. Utilisé côté server.js pour décider
// si un daily_quiz déjà en base peut être réutilisé comme master partagé
// pour une requête à un AUTRE niveau, quel que soit le format de son slot
// (nu ou encore suffixé ":niveau" pour un master généré avant cette version).
// MIN_ELEMENTARY_READY_QUESTIONS (qualité > quantité, 03/09/2026 — audit
// réel "Bouddhisme tibétain", 3/5 validées ayant fait échouer tout le bloc) :
// le bloc élémentaire n'a plus besoin d'UNE question par connaissance
// "elementary" du curriculum (4 ou 5 selon sa taille) pour devenir
// `elementary_ready` — 4 questions RÉELLEMENT validées suffisent, même si le
// curriculum en portait 5. Jamais l'inverse : en dessous de ce plancher,
// toujours pas prêt. Choisi égal à MIN_LEVEL_SIZE (lib/notion-quiz-curriculum.js)
// — le plancher elementary du curriculum ne descend jamais sous 4, donc ce
// seuil reste toujours atteignable par construction. Aucun critère de
// VALIDATION d'une question n'est modifié par cette constante : elle décide
// uniquement quand le bloc peut être servi, jamais ce qu'est une bonne
// question.
const MIN_ELEMENTARY_READY_QUESTIONS = 4;

// ── Sur-génération initiale du bloc élémentaire (03/09/2026, audit latence
// réel "Empire carolingien" — 70% du temps de génération passait dans des
// cycles de targeted_regeneration séquentiels, souvent sans gain net une
// fois le rendement du premier lot déjà faible). Plutôt que de générer un
// seul candidat par connaissance elementary (4-5) puis d'enchaîner des
// cycles de régénération coûteux à chaque rejet, le tout premier appel
// elementary_question_generation demande directement un POOL plus large de
// candidats (ELEMENTARY_INITIAL_CANDIDATE_POOL_SIZE) — plusieurs candidats
// INDÉPENDANTS peuvent alors couvrir la même connaissance, augmentant la
// probabilité que MIN_ELEMENTARY_READY_QUESTIONS connaissances DISTINCTES
// soient validées dès ce premier lot, sans jamais assouplir un seul critère
// de validation (mêmes validateurs déterministes, même critique sémantique,
// cf. server.js generateElementaryBlock). 8 candidats ne veut jamais dire 8
// connaissances : le curriculum elementary reste 4-5 connaissances — cf.
// selectOneQuestionPerKnowledgeTarget plus bas, qui ramène toujours le bloc
// servi à au plus une question par connaissance distincte.
const ELEMENTARY_INITIAL_CANDIDATE_POOL_SIZE = 8;

// Répartition déterministe de `poolSize` candidats sur `targetCount`
// connaissances : un candidat de base par connaissance, puis le surplus
// distribué en tournant depuis la première connaissance (ordre du
// curriculum, jamais aléatoire ni concentré sur une seule connaissance) —
// ex. targetCount=5, poolSize=8 => [2,2,2,1,1] ; targetCount=4, poolSize=8
// => [2,2,2,2]. Si targetCount>=poolSize (ne devrait jamais arriver en
// pratique : le curriculum elementary reste toujours entre 4 et 5, cf.
// MIN_LEVEL_SIZE dans lib/notion-quiz-curriculum.js), aucun surplus à
// distribuer : un candidat par connaissance, comportement strictement
// identique à avant ce chantier.
function computeElementaryCandidateDistribution(targetCount, poolSize = ELEMENTARY_INITIAL_CANDIDATE_POOL_SIZE) {
  const count = Math.max(0, Math.trunc(Number(targetCount) || 0));
  if (!count) return [];
  const counts = new Array(count).fill(1);
  let extra = Math.max(0, Math.trunc(Number(poolSize) || 0) - count);
  let cursor = 0;
  while (extra > 0) {
    counts[cursor % count] += 1;
    cursor += 1;
    extra -= 1;
  }
  return counts;
}

// Consolidation finale du bloc élémentaire (jamais pendant la génération
// elle-même, seulement une fois tous les cycles/V3.2 terminés) : au maximum
// une question par knowledgeTarget distinct, la PREMIÈRE validée dans
// l'ordre d'acceptation (première passe avant toute régénération ciblée) —
// jamais un choix arbitraire ou "la meilleure des deux". Comparaison texte
// normalisé, exactement la même que filterQuestionsToAdmittedKnowledge/
// filterVariantsByKnowledgeConstraints ci-dessus (jamais une seconde logique
// d'appariement). Une question dont knowledgeTarget est vide/absent est
// toujours écartée ici (ne peut de toute façon jamais être rattachée à une
// connaissance du curriculum).
function selectOneQuestionPerKnowledgeTarget(questions) {
  const seen = new Set();
  const result = [];
  for (const question of Array.isArray(questions) ? questions : []) {
    const key = normalizeFactText(question?.knowledgeTarget);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(question);
  }
  return result;
}

// `context.progressiveStatus`/`context.curriculum` (génération progressive,
// Phase 1, 02/09/2026 ; taille FLEXIBLE du curriculum, 02/09/2026 suite ;
// seuil découplé du nombre de connaissances elementary, 03/09/2026 suite) :
// un bloc progressif légitimement PARTIEL (4 questions même si le curriculum
// porte 5 connaissances elementary, progressive_status="elementary_ready")
// reste éligible dès qu'il atteint MIN_ELEMENTARY_READY_QUESTIONS — jamais
// jusqu'à devoir couvrir TOUTES les connaissances de son propre niveau, et
// jamais le seuil global MIN_MASTER_QUESTIONS=15, qui ne décrit qu'un master
// complet. Le plafond (jamais exigé au-delà de ce que le curriculum peut
// réellement fournir) reste le nombre d'items du niveau concerné — d'où le
// `Math.min` ci-dessous. La présence de pedagogicalRank reste exigée dans
// tous les cas, sans exception : un bloc progressif reçoit le sien depuis
// l'`order` de son curriculum (cf. server.js ensureProgressiveElementary
// Generated, attachPedagogicalRanks). Absent (comportement de tout appelant
// existant, `context` non fourni), le comportement reste au caractère près
// celui d'avant ce correctif.
const PROGRESSIVE_MASTER_MIN_FALLBACK = { elementary_ready: MIN_ELEMENTARY_READY_QUESTIONS, deepening_ready: 10 };

// Fallback UNIQUEMENT défensif : `curriculum` est toujours écrit en même
// temps que `progressive_status` par ensureProgressiveElementaryGenerated,
// donc ce cas ("statut progressif sans curriculum") ne devrait jamais se
// produire en pratique — il ne sert qu'à ne jamais faire planter un appelant
// face à une ligne corrompue ou partiellement migrée.
function progressiveEligibilityMinimum(progressiveStatus, curriculum) {
  if (progressiveStatus === "ready") return MIN_MASTER_QUESTIONS;
  const list = Array.isArray(curriculum) ? curriculum : [];
  if (progressiveStatus === "elementary_ready") {
    const count = list.filter((item) => item?.level === "elementary").length;
    return count > 0 ? Math.min(MIN_ELEMENTARY_READY_QUESTIONS, count) : PROGRESSIVE_MASTER_MIN_FALLBACK.elementary_ready;
  }
  if (progressiveStatus === "deepening_ready") {
    const count = list.filter((item) => item?.level === "elementary" || item?.level === "deepening").length;
    return count > 0 ? count : PROGRESSIVE_MASTER_MIN_FALLBACK.deepening_ready;
  }
  return null;
}

function isMasterEligibleQuiz(questions, context = {}) {
  const list = Array.isArray(questions) ? questions : [];
  if (!list.length || !list.every((question) => Number.isInteger(question?.pedagogicalRank))) return false;
  const progressiveMin = context?.progressiveStatus ? progressiveEligibilityMinimum(context.progressiveStatus, context.curriculum) : null;
  if (progressiveMin != null) return list.length >= progressiveMin;
  return list.length >= MIN_MASTER_QUESTIONS;
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
  validateEditedQuestionStructure,
  mergeEditedQuestionsPayload,
  validateAltVariant,
  validateVariantsArray,
  validateQuestionItemCore,
  extractGroundingFields,
  inspectGeneratedQuestionBatch,
  validateKnowledgeCandidates,
  filterQuestionsToAdmittedKnowledge,
  filterVariantsByKnowledgeConstraints,
  normalizeFactText,
  reconcileKnowledgeBatchResults,
  isAssociationAnswerFullyCorrect,
  isQcmMultiAnswerFullyCorrect,
  isOrderAnswerFullyCorrect,
  gradeQuizSubmissionOptionIndex,
  rankAdmittedKnowledge,
  attachPedagogicalRanks,
  resolveLegacyQuestionKnowledgeTargetId,
  deriveLegacyKnowledgeTargetId,
  selectQuestionsForRequestedLevel,
  restrictQuestionsToProgressiveLevelCeiling,
  PROGRESSIVE_LEVEL_ORDER,
  isMasterEligibleQuiz,
  MIN_MASTER_QUESTIONS,
  MIN_ELEMENTARY_READY_QUESTIONS,
  ELEMENTARY_INITIAL_CANDIDATE_POOL_SIZE,
  computeElementaryCandidateDistribution,
  selectOneQuestionPerKnowledgeTarget
};
