// Généralise le modèle base+altVariant (2 formulations max) vers 1 à 3
// "variants" par MemoryItem (refonte du 16/08/2026, section "jusqu'à 3
// variantes pertinentes"). Reste l'unique source de vérité pour la
// résolution de contenu ET pour le libellé loggué dans
// memory_review_events.question_variant — server.js importe les deux
// fonctions ci-dessous plutôt que de dupliquer la logique (contrairement à
// l'ancien modèle 2-variantes, où dupliquer une simple parité était
// acceptable ; l'algorithme anti-répétition ci-dessous ne l'est plus).
//
// COMPATIBILITÉ : un objet question stocké dans daily_quiz.questions garde
// TOUJOURS ses champs "de contenu" (type/question/options/correctIndex/...)
// à plat, à la racine — ce sont ceux de la variante PRINCIPALE
// (variants[0]). C'est ce que lisent stripQuestionForClient et GET
// /notion-quizzes/fiche à la première exposition, SANS jamais appeler ce
// module (comportement inchangé depuis l'introduction d'altVariant). Un
// objet peut en plus porter :
//   - `variants` (nouveau modèle) : tableau de 1 à 3 objets {type, question,
//     options/pairs/items, correctIndex(es), explanation, selfContained,
//     retrievalMode?}, variants[0] dupliquant exactement les champs à plat.
//   - `altVariant` (ancien modèle, 749 MemoryItems existants) : un unique
//     objet de même forme qu'un variant, jamais retouché.
// Les deux ne coexistent jamais sur un même objet (variants prend le pas si
// présent) ; getQuestionVariants() normalise les deux vers un même tableau.
const VARIANT_FIELD_NAMES = [
  "type", "question", "options", "correctIndex", "correctIndexes",
  "pairs", "items", "explanation", "selfContained", "retrievalMode"
];

function pickVariantFields(obj) {
  const out = {};
  if (!obj) return out;
  for (const key of VARIANT_FIELD_NAMES) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

// Retourne toujours un tableau d'au moins 1 élément — jamais vide, jamais
// null (une question stockée a toujours au moins ses champs de base).
function getQuestionVariants(question) {
  if (Array.isArray(question?.variants) && question.variants.length) {
    return question.variants;
  }
  const altVariant = question?.altVariant;
  const baseVariant = pickVariantFields(question);
  return altVariant ? [baseVariant, pickVariantFields(altVariant)] : [baseVariant];
}

// Hash de chaîne non cryptographique (déterministe, pas de dépendance) —
// sert uniquement à répartir le choix de variante, jamais un usage sécurisé.
function simpleStringHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function hashedCandidate(seed, step, variantCount) {
  return simpleStringHash(`${seed}:${step}`) % variantCount;
}

// n = nombre de reviews déjà effectuées AVANT celle en cours
// (memory_item_fsrs_states.reps au moment de servir/corriger, cf. les deux
// points d'appel dans server.js). n<=0 -> variante principale (index 0),
// jamais autre chose : c'est la variante déjà montrée à la toute première
// exposition (avant même que cette fonction soit appelée une seule fois).
//
// Pour variantCount=2, le résultat est TOUJOURS 0,1,0,1,0,1... quel que soit
// le hash : avec seulement 2 choix, "différent du précédent" détermine la
// suite de façon unique — comportement strictement identique à l'ancienne
// alternance par parité (garantie structurelle, pas empirique).
//
// Pour variantCount=3, le hash choisit entre les deux variantes valides
// restantes à chaque étape (jamais la dernière montrée) : ni répétition
// immédiate, ni cycle rigide A→B→C→A→B→C parfaitement prévisible.
//
// Volontairement O(n) (boucle, pas de récursion) : n reste petit en
// pratique (nombre de reviews d'un MemoryItem) et la garantie de correction
// (le "previous" utilisé à chaque étape est la vraie sélection précédente,
// pas une approximation) prime sur une micro-optimisation O(1) hasardeuse.
function selectVariantIndex(seed, n, variantCount) {
  if (variantCount <= 1) return 0;
  if (!Number.isFinite(n) || n <= 0) return 0;
  let previous = 0;
  let current = 0;
  for (let step = 1; step <= n; step++) {
    const candidate = hashedCandidate(seed, step, variantCount);
    current = candidate === previous ? (candidate + 1) % variantCount : candidate;
    previous = current;
  }
  return current;
}

// Résout le contenu affiché/corrigé pour une review donnée. Toujours appelé
// avec le même (question.id, reviewCount) au SERVICE (GET repasses) et à la
// CORRECTION (POST /answer, qui relit ces mêmes repasses avant d'enregistrer
// la réponse) : reviewCount vient à chaque fois du même
// memory_item_fsrs_states.reps pas encore mis à jour par cette réponse, donc
// les deux calculs tombent toujours sur la même variante.
function resolveActiveQuestionVariant(question, reviewCount) {
  const variants = getQuestionVariants(question);
  if (variants.length <= 1) return question;
  const index = selectVariantIndex(question?.id, reviewCount, variants.length);
  const envelope = { ...question };
  for (const key of VARIANT_FIELD_NAMES) delete envelope[key];
  delete envelope.variants;
  delete envelope.altVariant;
  return { ...envelope, ...variants[index] };
}

// Libellé consigné dans memory_review_events.question_variant — "v0"/"v1"/
// "v2" (généralise "base"/"alt"), pour les statistiques par variante.
function resolveQuestionVariantLabel(question, reviewCount) {
  const variants = getQuestionVariants(question);
  if (variants.length <= 1) return "v0";
  const index = selectVariantIndex(question?.id, reviewCount, variants.length);
  return `v${index}`;
}

module.exports = {
  VARIANT_FIELD_NAMES,
  getQuestionVariants,
  selectVariantIndex,
  resolveActiveQuestionVariant,
  resolveQuestionVariantLabel
};
