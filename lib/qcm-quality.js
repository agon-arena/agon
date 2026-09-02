"use strict";

// require() en tête, jamais circulaire dans ce sens : lib/question-grounding-validation.js
// duplique volontairement normalizeComparisonText plutôt que de la
// réimporter d'ici (cf. son commentaire de tête) pour ne jamais créer de
// cycle qcm-quality.js <-> question-grounding-validation.js.
const { validateQuestionGrounding } = require("./question-grounding-validation");

const ALLOWED_TYPES = new Set(["qcm", "texte_a_trous", "association", "intrus", "qcm_multi", "ordre"]);
const SINGLE_CHOICE_TYPES = new Set(["qcm", "texte_a_trous", "intrus"]);
const FORBIDDEN_ANSWER_PATTERNS = [
  /\btoutes?\s+les\s+r[ée]ponses?\b/i,
  /\baucune\s+(?:de\s+ces\s+)?r[ée]ponses?\b/i
];

function normalizeComparisonText(value) {
  return String(value == null ? "" : value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/[’‘‛`´]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .trim()
    .toLowerCase()
    .replace(/^[\s"'.,;:!?()[\]{}—–-]+|[\s"'.,;:!?()[\]{}—–-]+$/g, "")
    .replace(/\s+/g, " ");
}

function reason(code, message, fields = []) {
  return { code, message, fields };
}

function normalizedDuplicates(values) {
  const seen = new Map();
  const duplicates = [];
  values.forEach((value, index) => {
    const key = normalizeComparisonText(value);
    if (!key) return;
    if (seen.has(key)) duplicates.push([seen.get(key), index]);
    else seen.set(key, index);
  });
  return duplicates;
}

function tokenSet(value) {
  return new Set(normalizeComparisonText(value).split(/[^a-z0-9]+/).filter((token) => token.length > 2));
}

function lexicalSimilarity(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / Math.max(left.size, right.size);
}

// Proportion des mots de `shortSet` retrouvés dans `longSet` (jamais
// l'inverse) — contrairement à lexicalSimilarity (symétrique, pensée pour
// comparer deux textes de longueur comparable), cette mesure sert à comparer
// une option COURTE (un distracteur) à un texte LONG (un knowledgeTarget ou
// une autre réponse correcte, souvent une phrase complète) : un Jaccard
// symétrique classique écraserait presque toujours ce cas à une valeur
// proche de 0 même quand le distracteur reprend intégralement l'autre texte,
// simplement parce que le texte long porte beaucoup plus de mots distincts.
function tokenContainment(shortSet, longSet) {
  if (!shortSet.size) return 0;
  let intersection = 0;
  for (const token of shortSet) if (longSet.has(token)) intersection += 1;
  return intersection / shortSet.size;
}

// REORDERED_DUPLICATE_OPTION (audit QCM "Stalinisme", 02/09/2026 —
// daily_quiz.id=358) : deux options peuvent être des chaînes très
// différentes (donc invisibles à DUPLICATE_OPTIONS, qui ne compare que des
// chaînes normalisées égales) tout en énonçant EXACTEMENT le même ensemble
// de faits dans un ordre de phrase différent — cas réel : "Lénine meurt en
// 1924, Staline devient secrétaire général en 1922, puis il consolide son
// pouvoir à la fin des années 1920" vs "Il devient secrétaire général en
// 1922, Lénine meurt en 1924, puis Staline consolide son pouvoir à la fin
// des années 1920". lexicalSimilarity (sac de mots, ordre ignoré) vaut 1
// pour cette paire réelle.
// Seuil et garde-fou volontairement conservateurs (mesurés sur le cas réel
// ET sur un contre-exemple proche mais légitimement distinct) :
// - REORDERED_OPTION_SIMILARITY_THRESHOLD=0.82 : deux options développées
//   mais réellement différentes (ex. "Le premier plan quinquennal, lancé en
//   1928, donne la priorité à l'industrie lourde" vs "Le second plan
//   quinquennal, lancé en 1933, poursuit la priorité donnée à l'industrie
//   lourde") mesurent 0.6 — largement sous ce seuil, jamais faussement
//   rejetées.
// - REORDERED_OPTION_MIN_TOKENS=4 : ignore les options courtes/étiquettes
//   (ex. "Le NKVD", "Le Goulag") où un sac de mots de 1-2 tokens n'a aucune
//   valeur diagnostique sur un simple "réordonnancement" — ces options
//   restent couvertes par DUPLICATE_OPTIONS (égalité stricte) et par
//   CROSS_QUESTION_ANSWER_REUSE (repris plus bas) pour le recyclage
//   inter-questions, jamais par ce contrôle-ci.
// Limite assumée et documentée (jamais corrigée ici, hors périmètre V1) :
// un sac de mots ne distingue pas un simple réordonnancement (mêmes faits,
// même attribution) d'une réattribution factuelle (ex. dates permutées
// entre les deux mêmes événements) — les deux cas partagent exactement le
// même sac de mots et déclenchent donc tous deux ce contrôle. C'est un
// comportement assumé : dans les deux cas, l'option interrogée mélange les
// mêmes éléments lexicaux qu'une autre option de la même question, ce qui
// suffit à rendre la question mal conçue (cf. rapport d'audit, risques de
// faux positifs).
const REORDERED_OPTION_SIMILARITY_THRESHOLD = 0.82;
const REORDERED_OPTION_MIN_TOKENS = 4;

function hasReorderedDuplicateOptionPair(optionsText) {
  const sets = optionsText.map((text) => tokenSet(text));
  for (let i = 0; i < optionsText.length; i += 1) {
    if (sets[i].size < REORDERED_OPTION_MIN_TOKENS) continue;
    for (let j = i + 1; j < optionsText.length; j += 1) {
      if (sets[j].size < REORDERED_OPTION_MIN_TOKENS) continue;
      if (lexicalSimilarity(optionsText[i], optionsText[j]) >= REORDERED_OPTION_SIMILARITY_THRESHOLD) return true;
    }
  }
  return false;
}

function hasDoubleNegation(text) {
  const normalized = normalizeComparisonText(text);
  const negatives = normalized.match(/\b(?:ne|n'|pas|plus|jamais|aucun|aucune|ni)\b/g) || [];
  return negatives.length >= 3 || /\bne\b[^?.!]{0,80}\bpas\b[^?.!]{0,80}\b(?:aucun|jamais|ni)\b/.test(normalized);
}

// UNNECESSARY_NEGATION (correctif du 01/09/2026, suite à l'audit qualité
// rédactionnelle des QCM — cas réel "Parmi ces groupes, lequel n'était PAS
// exclu à l'origine de l'application de la Déclaration des droits de
// l'homme et du citoyen ?", un "intrus" qui passait tous les contrôles
// existants malgré une formulation scolaire). Volontairement DISTINCT de
// hasDoubleNegation ci-dessus (qui détecte l'EMPILEMENT de plusieurs
// négateurs) : ici, une négation UNIQUE mais rendue artificiellement lourde
// par deux signaux précis et étroits, choisis pour rester peu susceptibles
// de faux positifs :
// (a) un "PAS" tapé en capitales dans l'énoncé brut — jamais nécessaire
//     dans une question bien formulée, toujours un artifice pour forcer
//     l'attention du lecteur plutôt qu'une exigence de la connaissance ;
// (b) une négation ("ne"/"n'" ... "pas") immédiatement suivie, à courte
//     distance, d'un concept déjà négatif (exclu, interdit, absent, banni,
//     manquant) — oblige le lecteur à lever une double négation implicite
//     (négation de "exclu" = inclusion) sans jamais poser directement la
//     question sur ce que cette double négation désigne réellement.
// Liste de concepts VOLONTAIREMENT minimale et fermée : ne couvre QUE les
// cas concrets documentés par l'audit, jamais un filtre lexical large sur
// toute occurrence de "ne"/"n'"/"pas" — cf. test/question-formats.test.js
// ("intrus : une formulation négative légitime... reste acceptée") et les
// 235 questions "intrus" réelles (81 % du format, cf. rapport §8) qui
// utilisent légitimement "n'est pas"/"n'a pas" en minuscules SANS concept
// négatif imbriqué : elles ne doivent SURTOUT PAS être rejetées
// mécaniquement par ce contrôle.
const NEGATION_ON_NEGATIVE_CONCEPT_RE = /\bn['’]?[a-z]*\s+(?:[a-z]+\s+){0,2}pas\b[^?.!]{0,40}?\b(?:exclu(?:e|s|es)?|interdit(?:e|s|es)?|absent(?:e|s|es)?|banni(?:e|s|es)?|manquant(?:e|s|es)?)\b/;

function hasUnnecessaryNegation(text) {
  const raw = String(text == null ? "" : text);
  if (/\bPAS\b/.test(raw)) return true;
  return NEGATION_ON_NEGATIVE_CONCEPT_RE.test(normalizeComparisonText(raw));
}

function looksLikeArtificialYesNo(question, options) {
  if (!Array.isArray(options) || options.length !== 4) return false;
  const normalizedOptions = options.map(normalizeComparisonText);
  const yesNoWords = new Set(["oui", "non", "vrai", "faux", "correct", "incorrect"]);
  const yesNoCount = normalizedOptions.filter((option) => yesNoWords.has(option) || /^(?:oui|non|vrai|faux)\b/.test(option)).length;
  return yesNoCount >= 2 || /^(?:est-ce que|vrai ou faux|oui ou non)\b/i.test(String(question || "").trim());
}

function validateQuestionQuality(item, options = {}) {
  const reasons = [];
  const type = item?.type;
  const question = String(item?.question || "").trim();
  const explanation = String(item?.explanation || "").trim();
  if (!ALLOWED_TYPES.has(type)) reasons.push(reason("UNKNOWN_TYPE", "Type de question inconnu.", ["type"]));
  if (question.length < 8) reasons.push(reason("QUESTION_TOO_SHORT", "La question est vide ou trop courte.", ["question"]));
  if (!explanation) reasons.push(reason("MISSING_EXPLANATION", "Une explication est obligatoire.", ["explanation"]));
  if (FORBIDDEN_ANSWER_PATTERNS.some((pattern) => pattern.test(question))) {
    reasons.push(reason("FORBIDDEN_WORDING", "La formulation emploie une réponse globale interdite.", ["question"]));
  }
  if (hasDoubleNegation(question)) reasons.push(reason("DOUBLE_NEGATION", "La question contient une double négation risquée.", ["question"]));
  if (hasUnnecessaryNegation(question)) reasons.push(reason("UNNECESSARY_NEGATION", "La question emploie une négation artificiellement lourde (« PAS » en capitales, ou négation d'un concept déjà négatif comme « exclu »/« interdit »/« absent ») alors qu'une formulation directe est probablement possible.", ["question"]));

  if (SINGLE_CHOICE_TYPES.has(type)) {
    const rawOptions = Array.isArray(item?.options) ? item.options : [];
    if (rawOptions.length !== 4) reasons.push(reason("INVALID_OPTION_COUNT", "Quatre options exactement sont requises.", ["options"]));
    const optionsText = rawOptions.map((value) => String(value == null ? "" : value).trim());
    if (optionsText.some((value) => !value)) reasons.push(reason("EMPTY_OPTION", "Une option est vide.", ["options"]));
    if (normalizedDuplicates(optionsText).length) reasons.push(reason("DUPLICATE_OPTIONS", "Deux options sont équivalentes après normalisation.", ["options"]));
    if (hasReorderedDuplicateOptionPair(optionsText)) reasons.push(reason("REORDERED_DUPLICATE_OPTION", "Deux options développent essentiellement les mêmes mots/faits, seulement réordonnés — elles ne sont pas discriminantes l'une de l'autre.", ["options"]));
    if (optionsText.some((value) => FORBIDDEN_ANSWER_PATTERNS.some((pattern) => pattern.test(value)))) {
      reasons.push(reason("FORBIDDEN_OPTION", "Une option globale interdite est présente.", ["options"]));
    }
    const correctIndex = Number(item?.correctIndex);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= rawOptions.length) {
      reasons.push(reason("INVALID_CORRECT_INDEX", "correctIndex est absent ou hors limites.", ["correctIndex"]));
    } else if (!optionsText[correctIndex]) {
      reasons.push(reason("EMPTY_CORRECT_OPTION", "L’option marquée correcte est vide.", ["correctIndex", "options"]));
    }
    if (type === "texte_a_trous" && (question.match(/___/g) || []).length !== 1) {
      reasons.push(reason("INVALID_FILL_BLANK_MARKER", "Le texte à trous doit contenir exactement un marqueur ___.", ["question"]));
    }
    if (type === "texte_a_trous" && /\b(?:un|une|le|la|les|des|du)\s+___/i.test(question) && optionsText.some((option) => /^(?:un|une|le|la|les|des|du)\b/i.test(option))) {
      reasons.push(reason("GRAMMATICAL_OPTION_MISMATCH", "Le déterminant présent avant le trou est répété par au moins une option.", ["question", "options"]));
    }
    if (looksLikeArtificialYesNo(question, optionsText)) reasons.push(reason("ARTIFICIAL_YES_NO", "Une question binaire ne doit pas être déguisée en QCM.", ["question", "options"]));
  } else if (type === "qcm_multi") {
    const rawOptions = Array.isArray(item?.options) ? item.options : [];
    const optionsText = rawOptions.map((value) => String(value == null ? "" : value).trim());
    if (rawOptions.length < 4 || rawOptions.length > 5) reasons.push(reason("INVALID_OPTION_COUNT", "Le QCM multiple exige quatre ou cinq options.", ["options"]));
    if (optionsText.some((value) => !value)) reasons.push(reason("EMPTY_OPTION", "Une option est vide.", ["options"]));
    if (normalizedDuplicates(optionsText).length) reasons.push(reason("DUPLICATE_OPTIONS", "Deux options sont équivalentes après normalisation.", ["options"]));
    if (hasReorderedDuplicateOptionPair(optionsText)) reasons.push(reason("REORDERED_DUPLICATE_OPTION", "Deux options développent essentiellement les mêmes mots/faits, seulement réordonnés — elles ne sont pas discriminantes l'une de l'autre.", ["options"]));
    const rawIndexes = Array.isArray(item?.correctIndexes) ? item.correctIndexes : [];
    const indexes = rawIndexes.map(Number);
    if (new Set(indexes).size !== indexes.length) reasons.push(reason("DUPLICATE_CORRECT_INDEXES", "correctIndexes contient un doublon.", ["correctIndexes"]));
    if (indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= rawOptions.length)) reasons.push(reason("INVALID_CORRECT_INDEXES", "Un index correct est hors limites.", ["correctIndexes"]));
    if (indexes.length < 2) reasons.push(reason("TOO_FEW_CORRECT_OPTIONS", "Au moins deux réponses doivent être correctes.", ["correctIndexes"]));
    if (rawOptions.length && indexes.length >= rawOptions.length) reasons.push(reason("ALL_OPTIONS_CORRECT", "Toutes les options ne peuvent pas être correctes.", ["correctIndexes"]));
  } else if (type === "association") {
    const pairs = Array.isArray(item?.pairs) ? item.pairs : [];
    if (pairs.length < 3 || pairs.length > 4) reasons.push(reason("INVALID_PAIR_COUNT", "L’association exige trois ou quatre paires.", ["pairs"]));
    const lefts = pairs.map((pair) => String(pair?.left || "").trim());
    const rights = pairs.map((pair) => String(pair?.right || "").trim());
    if (lefts.some((value) => !value) || rights.some((value) => !value)) reasons.push(reason("EMPTY_ASSOCIATION_VALUE", "Une valeur d’association est vide.", ["pairs"]));
    if (normalizedDuplicates(lefts).length || normalizedDuplicates(rights).length) reasons.push(reason("AMBIGUOUS_ASSOCIATION", "Une association contient des éléments équivalents.", ["pairs"]));
  } else if (type === "ordre") {
    const items = Array.isArray(item?.items) ? item.items.map((value) => String(value || "").trim()) : [];
    if (items.length < 3 || items.length > 4) reasons.push(reason("INVALID_ORDER_COUNT", "L’ordre exige trois ou quatre éléments.", ["items"]));
    if (items.some((value) => !value)) reasons.push(reason("EMPTY_ORDER_ITEM", "Un élément de séquence est vide.", ["items"]));
    if (normalizedDuplicates(items).length) reasons.push(reason("DUPLICATE_ORDER_ITEMS", "La séquence contient des éléments équivalents.", ["items"]));
  }

  if (options.requireKnowledgeTarget && !String(item?.knowledgeTarget || "").trim()) {
    reasons.push(reason("MISSING_KNOWLEDGE_TARGET", "knowledgeTarget est obligatoire.", ["knowledgeTarget"]));
  }
  return { valid: reasons.length === 0, reasons };
}

function getQuestionVariants(question) {
  return Array.isArray(question?.variants) && question.variants.length ? question.variants : [question];
}

function getPrimaryQuestionVariant(question) {
  return getQuestionVariants(question)[0] || question;
}

function questionOptionsSignature(question) {
  const primary = getPrimaryQuestionVariant(question);
  const values = Array.isArray(primary?.options) ? primary.options.map(normalizeComparisonText).sort() : [];
  return values.join("|");
}

// ── CROSS_QUESTION_ANSWER_REUSE (audit QCM "Stalinisme", 02/09/2026 —
// daily_quiz.id=358) : une mauvaise option qui reprend, quasi telle quelle,
// la réponse correcte OU le knowledgeTarget d'une AUTRE question du même lot
// permet de l'éliminer par simple reconnaissance ("c'est la réponse d'une
// autre question du QCM"), jamais par la connaissance réellement testée ici.
// Cas réels observés dans ce QCM : la question "date de la mort de Staline"
// propose comme distracteurs "22 juin 1941"/"1924"/"février 1956", qui sont
// chacun le knowledgeTarget EXACT d'une autre question du même lot
// (respectivement l'invasion de l'URSS, la mort de Lénine, le rapport
// secret de Khrouchtchev) — éliminables sans connaître la date de la mort
// de Staline elle-même.
function correctAnswerTexts(question) {
  const primary = getPrimaryQuestionVariant(question);
  if (!primary) return [];
  const rawOptions = Array.isArray(primary.options) ? primary.options : [];
  if (primary.type === "qcm_multi") {
    const indexes = Array.isArray(primary.correctIndexes) ? primary.correctIndexes.map(Number) : [];
    return indexes.map((index) => rawOptions[index]).filter((value) => value != null && String(value).trim());
  }
  if (SINGLE_CHOICE_TYPES.has(primary.type)) {
    const index = Number(primary.correctIndex);
    return Number.isInteger(index) && rawOptions[index] != null ? [rawOptions[index]] : [];
  }
  return [];
}

function wrongOptionTexts(question) {
  const primary = getPrimaryQuestionVariant(question);
  if (!primary) return [];
  const rawOptions = Array.isArray(primary.options) ? primary.options : [];
  const optionsText = rawOptions.map((value) => String(value == null ? "" : value).trim());
  if (primary.type === "qcm_multi") {
    const correctIndexes = new Set((Array.isArray(primary.correctIndexes) ? primary.correctIndexes : []).map(Number));
    return optionsText.filter((_, index) => !correctIndexes.has(index));
  }
  if (SINGLE_CHOICE_TYPES.has(primary.type)) {
    const correctIndex = Number(primary.correctIndex);
    return optionsText.filter((_, index) => index !== correctIndex);
  }
  return [];
}

// Une seule et unique exception au plancher normal de 2 tokens
// (CROSS_QUESTION_REUSE_MIN_TOKENS) : un distracteur réduit à une simple
// année isolée (ex. "En 1924") reste un signal fort et peu ambigu dans un
// contexte historique — contrairement à un mot générique isolé (ex.
// "parti"), qui reste, lui, toujours ignoré par le plancher normal.
function isSoleSignificantToken(token) {
  return /^[0-9]{3,4}$/.test(token);
}

// Seuils volontairement conservateurs, mesurés sur le QCM réel qui a motivé
// ce contrôle ET sur des contre-exemples thématiquement proches mais
// légitimement distincts (cf. rapport, "risques de faux positifs") :
// - CROSS_QUESTION_REUSE_CONTAINMENT_THRESHOLD=0.8 : les reprises réelles
//   auditées mesurent toutes 0.875 à 1 (containment) ; un distracteur
//   seulement voisin thématiquement (ex. "Le Parti communiste soviétique"
//   comme mauvaise option pour "quelle institution est la police
//   politique ?", face au knowledgeTarget d'une question distincte sur le
//   "monopole politique du Parti communiste") mesure 0.67 — sous le seuil,
//   jamais faussement rejeté.
// - CROSS_QUESTION_REUSE_MIN_TOKENS=2 : un seul mot générique partagé
//   (ex. "pouvoir", "parti") ne suffit jamais seul — cf. isSoleSignificantToken
//   ci-dessus pour l'unique exception documentée (une année isolée).
const CROSS_QUESTION_REUSE_CONTAINMENT_THRESHOLD = 0.8;
const CROSS_QUESTION_REUSE_MIN_TOKENS = 2;

function isEligibleForCrossQuestionCheck(optionTokens) {
  if (optionTokens.size >= CROSS_QUESTION_REUSE_MIN_TOKENS) return true;
  if (optionTokens.size !== 1) return false;
  const [onlyToken] = optionTokens;
  return isSoleSignificantToken(onlyToken);
}

function validateQuestionBatchQuality(questions, options = {}) {
  const decisions = (Array.isArray(questions) ? questions : []).map((question, index) => ({
    index,
    question,
    valid: true,
    reasons: []
  }));
  for (const decision of decisions) {
    const variants = getQuestionVariants(decision.question);
    variants.forEach((variant, variantIndex) => {
      const result = validateQuestionQuality(variant, options);
      for (const entry of result.reasons) decision.reasons.push({ ...entry, variantIndex });
    });
    for (let i = 0; i < variants.length; i += 1) {
      for (let j = i + 1; j < variants.length; j += 1) {
        const same = normalizeComparisonText(variants[i]?.question) === normalizeComparisonText(variants[j]?.question);
        const similar = lexicalSimilarity(variants[i]?.question, variants[j]?.question) >= 0.92;
        const sameOptions = questionOptionsSignature(variants[i]) && questionOptionsSignature(variants[i]) === questionOptionsSignature(variants[j]);
        if (same || (similar && sameOptions)) {
          decision.reasons.push(reason("DUPLICATE_VARIANT", "Deux variantes interrogent la connaissance de façon quasi identique.", ["variants"]));
          break;
        }
      }
    }
    decision.valid = decision.reasons.length === 0;
  }
  for (let i = 0; i < decisions.length; i += 1) {
    for (let j = i + 1; j < decisions.length; j += 1) {
      const left = getPrimaryQuestionVariant(decisions[i].question);
      const right = getPrimaryQuestionVariant(decisions[j].question);
      const same = normalizeComparisonText(left?.question) === normalizeComparisonText(right?.question);
      // Seuil volontairement abaissé uniquement lorsque l'ensemble complet
      // des options est identique : ce second signal fort évite de confondre
      // deux questions voisines mais réellement distinctes.
      const verySimilar = lexicalSimilarity(left?.question, right?.question) >= 0.80;
      const sameOptions = questionOptionsSignature(left) && questionOptionsSignature(left) === questionOptionsSignature(right);
      if (same || (verySimilar && sameOptions)) {
        decisions[j].reasons.push(reason("DUPLICATE_QUESTION", "Cette question duplique une autre question du lot.", ["question"]));
        decisions[j].valid = false;
      }
    }
  }
  // CROSS_QUESTION_ANSWER_REUSE : jamais appliqué en rétroactif sur `other`
  // (la question "source" du recyclage) — seule `decision` (celle dont on
  // examine les mauvaises options) peut être invalidée ici, exactement comme
  // DUPLICATE_QUESTION ci-dessus ne pénalise jamais l'entrée la plus
  // ancienne d'une paire dupliquée. C'est ce qui garantit qu'une question
  // déjà acceptée lors d'un cycle précédent n'est jamais rejugée (cf.
  // runQuestionQualityPipeline, qui ne relit que `decisions.slice(accepted.length)`).
  for (const decision of decisions) {
    const wrongOptions = wrongOptionTexts(decision.question);
    if (!wrongOptions.length) continue;
    const reused = wrongOptions.some((optionText) => {
      const optionTokens = tokenSet(optionText);
      if (!isEligibleForCrossQuestionCheck(optionTokens)) return false;
      return decisions.some((other) => {
        if (other === decision) return false;
        const otherTexts = [...correctAnswerTexts(other.question)];
        const knowledgeTarget = other.question?.knowledgeTarget;
        if (knowledgeTarget) otherTexts.push(knowledgeTarget);
        return otherTexts.some((otherText) => tokenContainment(optionTokens, tokenSet(otherText)) >= CROSS_QUESTION_REUSE_CONTAINMENT_THRESHOLD);
      });
    });
    if (reused) {
      decision.reasons.push(reason("CROSS_QUESTION_ANSWER_REUSE", "Une mauvaise option reprend quasiment la réponse correcte ou la connaissance ciblée d'une autre question du même lot — éliminable par reconnaissance, pas par la connaissance testée ici.", ["options"]));
      decision.valid = false;
    }
  }
  return {
    valid: decisions.every((decision) => decision.valid),
    accepted: decisions.filter((decision) => decision.valid).map((decision) => decision.question),
    rejected: decisions.filter((decision) => !decision.valid),
    decisions
  };
}

// Verrou après transformation mécanique (shuffle). `before` est la variante
// brute déjà validée et critiquée ; `after` est la variante réellement prête
// à être stockée. On ne réévalue pas ici la sémantique : on prouve que le
// mélange a conservé la ou les réponses correctes et un contrat structurel
// cohérent. Association et ordre ne sont pas mélangés à ce stade et restent
// sous la responsabilité de leurs validateurs mécaniques spécialisés.
function validateFinalShuffledQuestion(before, after) {
  const reasons = [];
  const structural = validateQuestionQuality(after);
  reasons.push(...structural.reasons);
  if (SINGLE_CHOICE_TYPES.has(before?.type) && SINGLE_CHOICE_TYPES.has(after?.type)) {
    const beforeOptions = Array.isArray(before.options) ? before.options : [];
    const afterOptions = Array.isArray(after.options) ? after.options : [];
    const expected = normalizeComparisonText(beforeOptions[Number(before.correctIndex)]);
    const actual = normalizeComparisonText(afterOptions[Number(after.correctIndex)]);
    if (!expected || actual !== expected) reasons.push(reason("POST_SHUFFLE_CORRECT_INDEX_MISMATCH", "Le mélange n’a pas conservé la bonne réponse.", ["options", "correctIndex"]));
    const expectedOccurrences = afterOptions.filter((option) => normalizeComparisonText(option) === expected).length;
    if (expected && expectedOccurrences !== 1) reasons.push(reason("POST_SHUFFLE_CORRECT_OPTION_NOT_UNIQUE", "La bonne réponse n’est plus unique après mélange.", ["options"]));
  } else if (before?.type === "qcm_multi" && after?.type === "qcm_multi") {
    const beforeOptions = Array.isArray(before.options) ? before.options : [];
    const afterOptions = Array.isArray(after.options) ? after.options : [];
    const expected = (before.correctIndexes || []).map((index) => normalizeComparisonText(beforeOptions[Number(index)])).sort();
    const actual = (after.correctIndexes || []).map((index) => normalizeComparisonText(afterOptions[Number(index)])).sort();
    if (expected.length !== actual.length || expected.some((value, index) => value !== actual[index])) {
      reasons.push(reason("POST_SHUFFLE_CORRECT_INDEXES_MISMATCH", "Le mélange n’a pas conservé l’ensemble des bonnes réponses.", ["options", "correctIndexes"]));
    }
  } else if (before?.type !== after?.type) {
    reasons.push(reason("POST_TRANSFORM_TYPE_CHANGED", "Le type a changé pendant la transformation finale.", ["type"]));
  }
  return { valid: reasons.length === 0, reasons };
}

function parseSemanticReviews(payload, expectedIds) {
  const ids = new Set(expectedIds);
  if (!payload || !Array.isArray(payload.reviews)) return { valid: false, reviews: [], errorCode: "CRITIC_INVALID_RESPONSE" };
  const byId = new Map();
  let protocolInvalid = false;
  for (const raw of payload.reviews) {
    const id = String(raw?.id || "");
    if (!ids.has(id) || byId.has(id) || !["accept", "reject"].includes(raw?.verdict)) { protocolInvalid = true; continue; }
    if (!Array.isArray(raw?.expectedCorrectIndexes) || typeof raw?.targetsKnowledge !== "boolean" || typeof raw?.groundedInSource !== "boolean") { protocolInvalid = true; continue; }
    const reasonCodes = Array.isArray(raw.reasonCodes) ? raw.reasonCodes.map(String).filter(Boolean).slice(0, 8) : [];
    if (raw.verdict === "reject" && !reasonCodes.length) { protocolInvalid = true; continue; }
    byId.set(id, {
      id,
      verdict: raw.verdict,
      reasonCodes,
      expectedCorrectIndexes: Array.isArray(raw.expectedCorrectIndexes) ? raw.expectedCorrectIndexes.map(Number).filter(Number.isInteger) : [],
      targetsKnowledge: raw.targetsKnowledge === true,
      groundedInSource: raw.groundedInSource === true,
      usesBothKnowledgeSides: raw.usesBothKnowledgeSides === true,
      comment: String(raw.comment || "").trim().slice(0, 300)
    });
  }
  if (protocolInvalid || byId.size !== ids.size || payload.reviews.length !== expectedIds.length) {
    return { valid: false, reviews: [], errorCode: "CRITIC_INCOMPLETE_RESPONSE" };
  }
  return { valid: true, reviews: expectedIds.map((id) => byId.get(id)) };
}

function buildSemanticReviewPrompt(entries, context = {}) {
  const safeEntries = entries.map((entry) => ({
    id: entry.id,
    sourceId: entry.sourceId || null,
    knowledgeTarget: entry.knowledgeTarget || null,
    sourceExcerpt: entry.sourceExcerpt || null,
    question: entry.question,
    options: entry.options,
    correctIndex: entry.correctIndex,
    correctIndexes: entry.correctIndexes,
    pairs: entry.pairs,
    items: entry.items,
    explanation: entry.explanation,
    type: entry.type,
    variants: Array.isArray(entry.variants) ? entry.variants : undefined
  }));
  return [
    "Tu es la barrière qualité finale de QCM pédagogiques. Évalue chaque question indépendamment et refuse au moindre doute sérieux.",
    "Vérifie clarté autonome, correspondance exacte à knowledgeTarget, exactitude de la réponse marquée, unicité des réponses correctes, distracteurs incontestablement faux, cohérence grammaticale, fidélité au passage source, absence d’information inventée et cohérence de l’explication.",
    "Refuse toute question vague ou déictique qui ne nomme pas clairement son objet (par exemple « Quelle proposition est correcte ? », « Lequel est vrai ? »), même si les options permettraient de deviner le sujet.",
    // Distracteurs plausibles (demande du 01/09/2026, suite à l'audit QCM du
    // 31/08/2026 — cas réel "rhétorique antique" : un distracteur anachronique
    // et hors-catégorie, incontestablement faux mais trivialement éliminable
    // sans connaître le sujet, avait traversé tout le pipeline). « Incontestablement
    // faux » restait le SEUL critère de distracteur avant cet ajout — jamais un
    // critère de plausibilité/homogénéité, alors que buildQuestionFormatsPromptBlock
    // (server.js) demande déjà cette homogénéité à la génération, sans qu'aucune
    // couche ne la vérifie ensuite. Exclut explicitement "intrus" (son principe
    // même est qu'une option diffère des 3 autres) pour ne jamais casser ce format.
    "Distracteurs plausibles (pour \"qcm\"/\"texte_a_trous\"/\"qcm_multi\" UNIQUEMENT — jamais pour \"intrus\", où la différence délibérée d'une option EST le principe même du format) : refuse tout distracteur trop facilement identifiable comme faux SANS connaître le sujet, notamment s'il appartient à une catégorie manifestement différente de la bonne réponse et des autres options (ex. un concept moderne mêlé à des éléments antiques, un lieu isolé au milieu de noms de personnes, une unité incohérente), ou trahit une rupture évidente de registre, d'époque ou de nature. « Incontestablement faux » ne suffit jamais seul à accepter un distracteur : un distracteur peut être faux tout en restant un piège trop facile, éliminable par simple bon sens catégoriel plutôt que par connaissance réelle du sujet — refuse alors avec le code IMPLAUSIBLE_DISTRACTOR (trop facilement identifiable sans connaître la réponse) ou CATEGORY_MISMATCH (nature manifestement différente des autres options).",
    // CATEGORY_MISMATCH par écho de domaine du stem (renforcement du
    // 02/09/2026, audit QCM "Stalinisme" — cas réel : stem "Quelle
    // transformation POLITIQUE caractérise le stalinisme ?" avec une option
    // politique correcte et trois distracteurs HISTORIQUEMENT VRAIS mais
    // économique/agricole/culturel ; ou stem "Quel terme désigne
    // l'INSTITUTION administrant les camps ?" avec une seule option qui est
    // effectivement une institution, les 3 autres étant un événement et une
    // doctrine artistique). Distinct du cas déjà couvert ci-dessus (un
    // distracteur individuellement faux et hors-sujet) : ici, CHAQUE
    // distracteur est un fait individuellement vrai sur le même sujet
    // général — le défaut n'est pas leur véracité mais leur catégorie,
    // trahie par le vocabulaire même du stem.
    "CATEGORY_MISMATCH — cas du distracteur vrai mais hors catégorie : un distracteur peut être historiquement/factuellement exact et porter sur le même sujet général tout en restant un mauvais distracteur, si sa NATURE ne correspond pas à ce que le stem demande explicitement. Si le stem nomme une catégorie précise (une institution, une transformation POLITIQUE, un phénomène économique, une doctrine...), vérifie que les 4 options appartiennent TOUTES à cette même catégorie avant de juger leur exactitude : si le stem demande une institution, les 4 options doivent être plausiblement des institutions (jamais un événement ou une doctrine artistique mêlés à de vraies institutions) ; si le stem demande une transformation politique, ne propose jamais trois transformations économiques/agricoles/culturelles qui rendent l'unique option politique évidente par simple appariement du mot du stem au domaine de l'option. Refuse avec CATEGORY_MISMATCH même si chaque distracteur pris isolément est individuellement vrai.",
    "Pouvoir discriminant global (pour qcm/texte_a_trous/qcm_multi) : compare le stem, knowledgeTarget, la bonne réponse ET l'ensemble des options, pas chaque distracteur isolément. Si une personne qui ne maîtrise pas knowledgeTarget peut raisonnablement sélectionner la bonne réponse principalement par simple élimination, bon sens, indices contextuels ou faiblesse relative des alternatives, refuse avec GUESSABLE_WITHOUT_KNOWLEDGE. Refuse avec WEAK_DISTRACTOR_SET si un seul distracteur décoratif, trop éloigné, hors période/contexte, ou un ensemble de forces très inégales réduit significativement la valeur du QCM. Le seuil n'est pas la perfection stylistique : rejette seulement si le défaut facilite réellement la réponse sans la connaissance.",
    // GUESSABLE_WITHOUT_KNOWLEDGE — canaux explicites (renforcement du
    // 02/09/2026, audit QCM "Stalinisme") : la formulation précédente
    // ("élimination, bon sens, indices contextuels, faiblesse relative")
    // restait vraie mais trop générale pour être appliquée de façon fiable
    // aux cas réels observés (type grammatical d'une seule option
    // correspondant au nom demandé par le stem ; portée logique du stem
    // excluant mécaniquement 3 options sur 4). Liste fermée de canaux à
    // vérifier explicitement, en complément — jamais en remplacement — du
    // test global déjà demandé ci-dessus.
    "GUESSABLE_WITHOUT_KNOWLEDGE — canaux à vérifier explicitement avant d'accepter : la bonne réponse est-elle trouvable (1) par son seul TYPE GRAMMATICAL OU SÉMANTIQUE (ex. le stem demande un nom d'institution et une seule option en est une, les autres étant un événement/une doctrine/un lieu) ; (2) par un mot du stem repris tel quel ou en écho direct dans une seule option (vocabulaire du stem qui désigne déjà la catégorie de la bonne réponse) ; (3) par la SEULE PORTÉE LOGIQUE du stem, indépendamment du sujet précis (ex. un stem qui décrit une action accomplie PAR un acteur envers plusieurs entités EXTERNES exclut logiquement, sans aucune connaissance du sujet, toute option qui replacerait l'action à l'intérieur de cet acteur lui-même) ; (4) par élimination des trois distracteurs restants sans connaître réellement le sujet (chacun individuellement invraisemblable, incohérent ou hors-catégorie pour d'autres raisons que knowledgeTarget) ? Si l'un de ces quatre canaux permet, à lui seul, de trouver la bonne réponse, refuse avec GUESSABLE_WITHOUT_KNOWLEDGE — même si aucun distracteur pris isolément n'est absurde.",
    "Force relative des options : exige une catégorie sémantique cohérente lorsque pertinente, une époque et un contexte compatibles, un registre et un niveau de précision comparables, et des longueurs grossièrement comparables sans imposer d'égalité mécanique. Si la bonne réponse se distingue nettement par sa longueur, sa précision, son registre, son vocabulaire repris de knowledgeTarget ou sa formulation techniquement plus complète, refuse avec ANSWER_SALIENCE. Aucune réponse correcte « premium » face à trois options vagues.",
    "Ambiguïté et fabrication : un bon distracteur est plausible mais faux dans le contexte. Si une option est raisonnablement défendable comme une réponse correcte, refuse avec AMBIGUOUS_DISTRACTOR. Si une option est un pseudo-concept, une institution inexistante, une combinaison arbitraire, une causalité fantaisiste ou une formulation visiblement fabriquée pour remplir le choix, refuse avec ARTIFICIAL_DISTRACTOR. Continue d'utiliser IMPLAUSIBLE_DISTRACTOR et CATEGORY_MISMATCH pour leurs cas plus directs, sans multiplier les codes pour un même défaut.",
    // AMBIGUOUS_DISTRACTOR — comparaison pairwise explicite (renforcement du
    // 02/09/2026, audit QCM "Stalinisme" — cas réel exact : deux options
    // contenaient toutes deux "1922 → secrétaire général", "1924 → mort de
    // Lénine" et "fin des années 1920 → consolidation du pouvoir", dans un
    // ordre de phrase différent). La phrase précédente ("une option
    // raisonnablement défendable comme réponse correcte") évalue chaque
    // option ISOLÉMENT ; elle ne demande jamais explicitement de comparer
    // les options ENTRE ELLES pour détecter deux formulations du même
    // contenu — ajout ciblé sur ce point précis.
    "AMBIGUOUS_DISTRACTOR — comparaison pairwise obligatoire : compare aussi chaque option aux AUTRES options de la même question (pas seulement à la bonne réponse). Si deux options expriment essentiellement le même ensemble de faits ou la même relation, même avec un ordre différent, une paraphrase, un réarrangement syntaxique ou un changement superficiel de formulation (ex. deux options qui énoncent toutes deux \"1922 → devient secrétaire général\", \"1924 → mort de Lénine\" et \"fin des années 1920 → consolidation du pouvoir\", uniquement dans un ordre de phrase différent), refuse avec AMBIGUOUS_DISTRACTOR : la question ne peut alors plus avoir une unique réponse correcte identifiable avec certitude, quel que soit l'index marqué comme correct.",
    "Format intrus — contrôle spécifique : l'exemption ci-dessus porte UNIQUEMENT sur la différence de catégorie inhérente au format, jamais sur sa valeur pédagogique. Demande si l'intrus est identifiable sans connaître le point commun testé. Refuse avec GUESSABLE_WITHOUT_KNOWLEDGE si sa différence ressort par simple lecture, opposition de ton ou de polarité, rupture évidente d'époque, de registre ou de nature. Ne pénalise jamais un vrai intrus simplement parce qu'une option possède une propriété différente : par exemple, distinguer une planète tellurique d'une planète gazeuse parmi des planètes comparables est légitime lorsque cette propriété doit réellement être connue.",
    "Portée de la question : compare le périmètre du stem à knowledgeTarget et, si présent, sourceExcerpt. Si le stem ou la réponse transforme un fait partiel ou contextualisé en règle générale, ou omet une période, un territoire, un groupe concerné ou une situation indispensables, refuse avec OVERGENERALIZED_QUESTION. Une formulation moins élégante mais fidèle et non ambiguë peut rester acceptée.",
    // Qualité rédactionnelle (correctif du 01/09/2026, suite à l'audit
    // formulation QCM — cas réel "Parmi ces groupes, lequel n'était PAS
    // exclu à l'origine de l'application de la Déclaration des droits de
    // l'homme et du citoyen ?", qui passait tous les critères ci-dessus
    // malgré une formulation scolaire et une négation superflue). Distinct
    // des critères de grounding/plausibilité déjà présents : une question
    // peut être parfaitement grounded, avec un correctIndex exact et des
    // distracteurs homogènes, et rester rédactionnellement médiocre — ce
    // bloc évalue CETTE dimension séparément, jamais un substitut aux
    // critères factuels ci-dessus. Seuil volontairement le même que les
    // autres critères de cette liste (doute sérieux et réel, jamais la
    // perfection stylistique) pour ne pas multiplier les régénérations.
    "Qualité rédactionnelle (pour la question ET pour chaque option) : vérifie le français naturel, la simplicité syntaxique, une formulation directement compréhensible comme on la poserait à l'oral dans un contexte pédagogique, l'homogénéité grammaticale et de registre entre les options, l'absence d'expression artificielle fabriquée uniquement pour remplir un choix (ex. un groupe nominal grammaticalement bancal ou peu idiomatique). N'utilise JAMAIS ce critère pour pénaliser une option courte, nominale ou télégraphique en soi — seule la maladresse réelle de formulation compte, jamais la brièveté ou le style factuel.",
    "Négation évitable : refuse avec UNNECESSARY_NEGATION toute question dont la négation (« lequel n'est pas », « laquelle n'a pas », « sauf », « excepté », « incorrect », « PAS » en capitales, négation empilée sur un concept déjà négatif comme « n'était pas exclu », « n'est pas interdit ») pourrait être remplacée par une formulation affirmative aussi claire et testant la même connaissance. N'utilise JAMAIS ce code lorsque la négation est intrinsèquement nécessaire à la connaissance testée (ex. une question portant réellement sur une absence, une exception ou une interdiction, sans équivalent affirmatif aussi direct) — dans ce cas la question reste acceptable, y compris pour un intrus dont le point commun est naturellement négatif.",
    "Maladresse rédactionnelle : refuse avec AWKWARD_WORDING toute question ou option grammaticalement correcte mais artificiellement scolaire, lourde à décoder, ou peu naturelle en français — jamais pour une simple préférence stylistique ou une formulation seulement moins élégante qu'une autre.",
    context.isComprehension ? "Mode Comprendre : accepte seulement si la question mobilise réellement les deux connaissances et teste explicitement leur relation ; refuse si un seul côté suffit." : "",
    context.hasIndependentSource === false ? "Aucune source documentaire indépendante n’est disponible : ne traite pas knowledgeTarget comme une preuve externe." : "",
    'Réponds uniquement en JSON strict : {"reviews":[{"id":"...","verdict":"accept|reject","reasonCodes":["..."],"expectedCorrectIndexes":[0],"targetsKnowledge":true|false,"groundedInSource":true|false,"usesBothKnowledgeSides":true|false,"comment":"justification courte"}]}. Tous les ids doivent apparaître exactement une fois.',
    JSON.stringify({ questions: safeEntries })
  ].filter(Boolean).join("\n\n");
}

function aggregateReasonCodes(rejected) {
  const counts = {};
  for (const rejection of rejected || []) {
    for (const entry of rejection.reasons || []) counts[entry.code] = (counts[entry.code] || 0) + 1;
  }
  return counts;
}

function defaultQuestionId(question, index) {
  return `qv2-${String(question?.sourceId || question?.sourceDebateId || "source")}-${index + 1}`;
}

function toReviewEntry(question, id, context) {
  const sourceId = String(question?.sourceId || question?.sourceDebateId || "");
  const sourceExcerpt = typeof context.sourceExcerptFor === "function"
    ? context.sourceExcerptFor(sourceId, question)
    : (context.sourceExcerpt || null);
  return { id, sourceId, sourceExcerpt, ...question };
}

function markedCorrectIndexes(question) {
  if (question?.type === "qcm_multi") return (question.correctIndexes || []).map(Number).sort((a, b) => a - b);
  if (SINGLE_CHOICE_TYPES.has(question?.type)) return [Number(question.correctIndex)];
  return [];
}

function sameIndexes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function runQuestionQualityPipeline(rawQuestions, options = {}) {
  const maxRetries = Math.max(0, Math.min(2, Number(options.maxRetries ?? 2)));
  const maxTechnicalRetries = Math.max(0, Math.min(3, Number(options.maxTechnicalRetries ?? 2)));
  const technicalBackoff = typeof options.technicalBackoff === "function"
    ? options.technicalBackoff
    : (attempt) => new Promise((resolve) => setTimeout(resolve, Math.min(2_000, 250 * (2 ** (attempt - 1)))));
  const semanticReviewEnabled = options.semanticReviewEnabled !== false;
  const reviewSemantic = options.reviewSemantic;
  const regenerate = options.regenerate;
  const accepted = [];
  const rejectionHistory = [];
  let candidates = Array.isArray(rawQuestions) ? rawQuestions.slice() : [];
  let cycles = 0;
  let deterministicRejectedCount = 0;
  let semanticRejectedCount = 0;
  let criticErrorCode = null;
  let criticTechnicalAttempts = 0;
  let criticTechnicalRetries = 0;
  let technicalFailure = false;
  let unresolvedRejected = [];

  // Métriques de grounding (V3.1, 31/08/2026 — "observabilité du grounding
  // QCM") : noms délibérément préfixés "grounding" et jamais "verified"/
  // "true" (section 16 de la demande) — ces compteurs disent seulement "le
  // validateur V3 n'a rien détecté d'anormal", jamais "ce fait est
  // scientifiquement garanti vrai". Purement additifs : aucune structure
  // existante n'est modifiée, ces compteurs restent à leurs valeurs neutres
  // (0/false) pour tout appelant qui ne fournit pas options.groundingSources
  // (comportement des autres pipelines strictement inchangé).
  const groundingEnabled = !!options.groundingSources;
  let groundingCandidatesFirstPass = 0;
  let groundingRejectedFirstPass = 0;
  let groundingRejectedTotal = 0;
  let groundingRegenerationTriggerCount = 0;

  // pendingRegenerationMs (V1 latence, cf. audit) : timing de l'appel
  // regenerate() qui a produit les `candidates` de CE tour de boucle —
  // capturé à la fin du tour précédent, consommé par options.onCycle
  // ci-dessous puis remis à null. `null` au tout premier tour (aucune
  // régénération n'a encore eu lieu).
  let pendingRegenerationMs = null;
  while (candidates.length) {
    const questionsIn = candidates.length;
    // Inclut les acceptées précédentes comme références de déduplication,
    // mais ne les rejuge jamais : seules les décisions correspondant aux
    // nouveaux candidats du cycle sont prises en compte.
    const deterministic = validateQuestionBatchQuality([...accepted, ...candidates], options.validationOptions);
    const cycleDecisions = deterministic.decisions.slice(accepted.length);

    // Traçabilité aux sources (V3, 31/08/2026) : passe déterministe
    // supplémentaire, avant la critique sémantique (jamais après — inutile
    // de payer un appel IA sur une question déjà structurellement non
    // traçable). `options.groundingSources` (Map ou objet SOURCE_N ->
    // {text,...}) n'est fourni QUE par generateNotionLevelQuiz quand un
    // grounding web a réellement été trouvé — absent, cette passe est un
    // pur no-op (comportement strictement inchangé pour tous les autres
    // appelants). Ne rejuge jamais une décision déjà invalide (déterministe
    // classique prioritaire) — seulement les candidats qui, sinon,
    // passeraient tels quels.
    let cycleGroundingRejectedCount = 0;
    if (options.groundingSources) {
      for (const decision of cycleDecisions) {
        if (!decision.valid) continue;
        if (cycles === 0) groundingCandidatesFirstPass += 1;
        const grounding = validateQuestionGrounding(decision.question, options.groundingSources);
        if (!grounding.ok) {
          decision.reasons.push(reason(`GROUNDING_${grounding.reason.toUpperCase()}`, grounding.detail));
          decision.valid = false;
          cycleGroundingRejectedCount += 1;
        }
      }
      groundingRejectedTotal += cycleGroundingRejectedCount;
      if (cycles === 0) groundingRejectedFirstPass += cycleGroundingRejectedCount;
    }

    const cycleRejected = cycleDecisions.filter((entry) => !entry.valid);
    deterministicRejectedCount += cycleRejected.length;
    let cycleAccepted = cycleDecisions.filter((entry) => entry.valid).map((entry) => entry.question);
    // deterministicAccepted (V1 latence, cf. audit) : nombre de candidats
    // encore en lice après le contrôle déterministe/grounding mais AVANT le
    // critique sémantique — remonté uniquement via options.onCycle ci-dessous,
    // jamais utilisé pour une décision.
    const deterministicAccepted = cycleAccepted.length;
    let rejected = cycleRejected.map((entry) => ({
      question: entry.question,
      reasons: entry.reasons
    }));

    // reviewMs (V1 latence) : null tant qu'aucune critique sémantique n'a
    // réellement eu lieu ce cycle (semanticReviewEnabled=false ou aucun
    // candidat structurellement valide) — jamais confondu avec "0 ms".
    let reviewMs = null;
    if (semanticReviewEnabled && cycleAccepted.length) {
      const reviewStartedAt = Date.now();
      const descriptors = [];
      cycleAccepted.forEach((question, questionIndex) => {
        const parentId = defaultQuestionId(question, accepted.length + questionIndex);
        getQuestionVariants(question).forEach((variant, variantIndex) => {
          descriptors.push({
            id: `${parentId}-v${variantIndex + 1}`,
            questionIndex,
            variant,
            parent: question
          });
        });
      });
      const ids = descriptors.map((descriptor) => descriptor.id);
      let parsedReviews;
      const reviewRequest = {
        entries: descriptors.map((descriptor) => toReviewEntry({
          ...descriptor.variant,
          sourceId: descriptor.parent?.sourceId || descriptor.parent?.sourceDebateId,
          knowledgeTarget: descriptor.parent?.knowledgeTarget
        }, descriptor.id, options.context || {})),
        context: options.context || {}
      };
      // Les pannes de transport/HTTP et les réponses de protocole invalides
      // ne disent rien sur la qualité des questions. On rejoue donc exactement
      // le même lot auprès du critique, sans appeler le générateur ni modifier
      // les candidats. Les cycles sémantiques restent un budget indépendant.
      for (let technicalAttempt = 0; technicalAttempt <= maxTechnicalRetries; technicalAttempt += 1) {
        criticTechnicalAttempts += 1;
        try {
          if (typeof reviewSemantic !== "function") throw Object.assign(new Error("Critique sémantique indisponible."), { code: "CRITIC_UNAVAILABLE" });
          const payload = await reviewSemantic(reviewRequest);
          parsedReviews = parseSemanticReviews(payload, ids);
        } catch (error) {
          parsedReviews = { valid: false, errorCode: error?.code || "CRITIC_ERROR", reviews: [] };
        }
        if (parsedReviews.valid) break;
        criticErrorCode = parsedReviews.errorCode;
        if (technicalAttempt >= maxTechnicalRetries) break;
        criticTechnicalRetries += 1;
        await technicalBackoff(technicalAttempt + 1);
      }
      if (!parsedReviews.valid) {
        criticErrorCode = parsedReviews.errorCode;
        technicalFailure = true;
        rejectionHistory.push(...cycleAccepted.map((question) => ({
          question,
          reasons: [reason(criticErrorCode, "La critique sémantique n’a pas produit un verdict complet après les reprises techniques.")]
        })));
        accepted.length = 0;
        break;
      } else {
        const retained = [];
        const reviewsByQuestion = new Map();
        parsedReviews.reviews.forEach((review, index) => {
          const descriptor = descriptors[index];
          if (!reviewsByQuestion.has(descriptor.questionIndex)) reviewsByQuestion.set(descriptor.questionIndex, []);
          reviewsByQuestion.get(descriptor.questionIndex).push({ review, descriptor });
        });
        cycleAccepted.forEach((question, questionIndex) => {
          const requiresGrounding = options.context?.hasIndependentSource !== false;
          const requiresBoth = options.context?.isComprehension === true;
          const grouped = reviewsByQuestion.get(questionIndex) || [];
          const failed = grouped.find(({ review, descriptor }) => {
            const marked = markedCorrectIndexes(descriptor.variant);
            const criticIndexes = review.expectedCorrectIndexes.slice().sort((a, b) => a - b);
            const indexesCoherent = !marked.length || (criticIndexes.length > 0 && sameIndexes(marked, criticIndexes));
            return review.verdict !== "accept" || !review.targetsKnowledge ||
              (requiresGrounding && !review.groundedInSource) || (requiresBoth && !review.usesBothKnowledgeSides) || !indexesCoherent;
          });
          if (!failed) retained.push(question);
          else {
            semanticRejectedCount += 1;
            const { review, descriptor } = failed;
            const marked = markedCorrectIndexes(descriptor.variant);
            const criticIndexes = review.expectedCorrectIndexes.slice().sort((a, b) => a - b);
            const codes = review.reasonCodes.length ? review.reasonCodes : [
              !review.targetsKnowledge ? "OFF_KNOWLEDGE_TARGET" :
                (requiresBoth && !review.usesBothKnowledgeSides ? "COMPREHENSION_ONE_SIDED" :
                  (requiresGrounding && !review.groundedInSource ? "NOT_GROUNDED_IN_SOURCE" :
                    (marked.length && !sameIndexes(marked, criticIndexes) ? "CRITIC_CORRECT_INDEX_MISMATCH" : "SEMANTIC_REJECT")))
            ];
            rejected.push({ question, reasons: codes.map((code) => reason(code, review.comment || "Question refusée par la critique sémantique.")) });
          }
        });
        cycleAccepted = retained;
      }
      reviewMs = Date.now() - reviewStartedAt;
    }

    if (technicalFailure) break;

    accepted.push(...cycleAccepted);
    rejectionHistory.push(...rejected);
    unresolvedRejected = rejected;

    // Instrumentation par cycle (V1 latence, cf. audit) : un seul point de
    // mesure, jamais une décision — aucun early stop ici (hors périmètre V1,
    // cf. section 7 de la demande, MIN_MASTER_QUESTIONS reste un seuil
    // d'acceptabilité, jamais une cible d'arrêt). Best-effort et silencieux
    // par construction (même philosophie que recordAiUsage/imagePromise
    // ailleurs dans le pipeline) : une panne de télémétrie ne doit jamais
    // interrompre ni modifier une génération réelle.
    if (typeof options.onCycle === "function") {
      try {
        options.onCycle({
          cycleIndex: cycles,
          questionsIn,
          deterministicAccepted,
          semanticAccepted: cycleAccepted.length,
          rejected: rejected.length,
          cumulativeAccepted: accepted.length,
          reviewMs,
          regenerationMs: pendingRegenerationMs
        });
      } catch (_) {
        // jamais bloquant ni remonté — cf. commentaire ci-dessus
      }
    }
    pendingRegenerationMs = null;

    if (!rejected.length || cycles >= maxRetries || typeof regenerate !== "function") break;
    // Combien de régénérations sont déclenchées À CAUSE du grounding
    // spécifiquement (item 10/11 de la demande — "davantage de rejets peut
    // entraîner davantage d'appels de régénération") : un item peut cumuler
    // plusieurs motifs de rejet (grounding ET structurel) — compté ici s'il
    // porte AU MOINS un code GROUNDING_*, jamais un double comptage par motif.
    groundingRegenerationTriggerCount += rejected.filter((entry) => entry.reasons.some((r) => r.code.startsWith("GROUNDING_"))).length;
    cycles += 1;
    const regenStartedAt = Date.now();
    candidates = await regenerate({ rejected, accepted: accepted.slice(), attempt: cycles });
    pendingRegenerationMs = Date.now() - regenStartedAt;
    if (!Array.isArray(candidates)) candidates = [];
  }

  return {
    accepted,
    rejected: rejectionHistory,
    metrics: {
      generated: Array.isArray(rawQuestions) ? rawQuestions.length : 0,
      deterministicRejected: deterministicRejectedCount,
      semanticRejected: semanticRejectedCount,
      regenerationCycles: cycles,
      finalAccepted: accepted.length,
      reasonCounts: aggregateReasonCodes(rejectionHistory),
      // L'historique ci-dessus mesure le travail effectué. Cette valeur ne contient que les
      // motifs encore présents au dernier cycle et constitue donc le diagnostic d'échec réel.
      unresolvedReasonCounts: aggregateReasonCodes(unresolvedRejected),
      criticErrorCode,
      criticTechnicalAttempts,
      criticTechnicalRetries,
      technicalFailure,
      // Grounding (V3.1, 31/08/2026) : neutre (false/0) quand
      // options.groundingSources n'est pas fourni — jamais confondre "0
      // rejet" avec "le contrôle n'a pas tourné du tout".
      groundingEnabled,
      groundingCandidatesFirstPass,
      groundingRejectedFirstPass,
      groundingAcceptedFirstPass: Math.max(0, groundingCandidatesFirstPass - groundingRejectedFirstPass),
      groundingRejectedTotal,
      groundingRegenerationTriggerCount,
      // "Échoue définitivement pour grounding" : parmi les motifs encore
      // présents au tout dernier cycle (unresolvedRejected, déjà calculé
      // ci-dessus pour unresolvedReasonCounts), combien portent un code
      // GROUNDING_*.
      groundingFailedFinal: unresolvedRejected.filter((entry) => entry.reasons.some((r) => r.code.startsWith("GROUNDING_"))).length,
      // Approximation assumée (l'architecture ne trace pas la lignée exacte
      // d'un item à travers une régénération, cf. rapport) : parmi les
      // régénérations déclenchées pour motif de grounding, celles qui ne
      // sont PAS restées définitivement rejetées sont comptées comme
      // "récupérées" — jamais une preuve que LA MÊME connaissance a été
      // corrigée, seulement que ce budget de régénération n'a pas fini en
      // échec sec.
      groundingAcceptedAfterRegeneration: Math.max(
        0,
        groundingRegenerationTriggerCount - unresolvedRejected.filter((entry) => entry.reasons.some((r) => r.code.startsWith("GROUNDING_"))).length
      )
    }
  };
}

module.exports = {
  ALLOWED_TYPES,
  normalizeComparisonText,
  lexicalSimilarity,
  validateQuestionQuality,
  validateQuestionBatchQuality,
  validateFinalShuffledQuestion,
  parseSemanticReviews,
  buildSemanticReviewPrompt,
  aggregateReasonCodes,
  runQuestionQualityPipeline
};
