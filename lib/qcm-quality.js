"use strict";

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

function hasDoubleNegation(text) {
  const normalized = normalizeComparisonText(text);
  const negatives = normalized.match(/\b(?:ne|n'|pas|plus|jamais|aucun|aucune|ni)\b/g) || [];
  return negatives.length >= 3 || /\bne\b[^?.!]{0,80}\bpas\b[^?.!]{0,80}\b(?:aucun|jamais|ni)\b/.test(normalized);
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

  if (SINGLE_CHOICE_TYPES.has(type)) {
    const rawOptions = Array.isArray(item?.options) ? item.options : [];
    if (rawOptions.length !== 4) reasons.push(reason("INVALID_OPTION_COUNT", "Quatre options exactement sont requises.", ["options"]));
    const optionsText = rawOptions.map((value) => String(value == null ? "" : value).trim());
    if (optionsText.some((value) => !value)) reasons.push(reason("EMPTY_OPTION", "Une option est vide.", ["options"]));
    if (normalizedDuplicates(optionsText).length) reasons.push(reason("DUPLICATE_OPTIONS", "Deux options sont équivalentes après normalisation.", ["options"]));
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

  while (candidates.length) {
    // Inclut les acceptées précédentes comme références de déduplication,
    // mais ne les rejuge jamais : seules les décisions correspondant aux
    // nouveaux candidats du cycle sont prises en compte.
    const deterministic = validateQuestionBatchQuality([...accepted, ...candidates], options.validationOptions);
    const cycleDecisions = deterministic.decisions.slice(accepted.length);
    const cycleRejected = cycleDecisions.filter((entry) => !entry.valid);
    deterministicRejectedCount += cycleRejected.length;
    let cycleAccepted = cycleDecisions.filter((entry) => entry.valid).map((entry) => entry.question);
    let rejected = cycleRejected.map((entry) => ({
      question: entry.question,
      reasons: entry.reasons
    }));

    if (semanticReviewEnabled && cycleAccepted.length) {
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
    }

    if (technicalFailure) break;

    accepted.push(...cycleAccepted);
    rejectionHistory.push(...rejected);
    unresolvedRejected = rejected;
    if (!rejected.length || cycles >= maxRetries || typeof regenerate !== "function") break;
    cycles += 1;
    candidates = await regenerate({ rejected, accepted: accepted.slice(), attempt: cycles });
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
      technicalFailure
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
