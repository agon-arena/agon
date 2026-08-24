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
// réelle. Retiré de cet ensemble le 16/08/2026 — un item qui en réclame le
// type retombe sur "qcm" via la coercition ci-dessous, ce qui impose
// mécaniquement 4 options (jamais 2), donc rejette toute tentative de
// contournement plutôt que de l'accepter silencieusement. Les MemoryItems
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
  // qcm/texte_a_trous/intrus : toujours 4 options. Fixé à 4 (jamais 2) depuis
  // le retrait de vrai_faux : une tentative de contournement (type inconnu
  // coercé en "qcm", ou "qcm" avec seulement 2 options déguisées en
  // affirmation à trancher) échoue mécaniquement ici plutôt que d'être
  // acceptée comme un format à 2 options valide.
  const expectedLength = 4;
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
  validateKnowledgeCandidates,
  filterQuestionsToAdmittedKnowledge,
  filterVariantsByKnowledgeConstraints,
  normalizeFactText,
  reconcileKnowledgeBatchResults,
  isAssociationAnswerFullyCorrect,
  isQcmMultiAnswerFullyCorrect,
  isOrderAnswerFullyCorrect,
  gradeQuizSubmissionOptionIndex
};
