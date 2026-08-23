// Gradation légère de l'aide à la récupération (audit pédagogique du
// 16/08/2026, section "gradation de l'aide") — décide COMBIEN d'aide montrer
// avant la réponse, jamais QUAND revoir (ça reste FSRS, cf. fsrs-scheduler.js,
// jamais touché ici). Fonction pure, lecture seule d'un état FSRS déjà
// calculé : n'importe jamais ts-fsrs, ne modifie jamais stability/difficulty/
// due_at, ne crée aucun état par variante — un seul helpLevel par MemoryItem,
// dérivé de son unique état FSRS partagé par toutes ses variantes.
//
// Volontairement pas un score continu ni un modèle adaptatif (IRT/BKT/PEST
// explicitement exclus par la demande) : une règle à 2 branches, sur les deux
// signaux déjà présents dans memory_item_fsrs_states qui capturent le mieux
// la solidité d'une connaissance sans calcul supplémentaire :
// - `state` distingue d'abord ce qui est structurellement fragile (New :
//   jamais revu ; Learning/Relearning : pas encore graduée vers un rythme de
//   révision espacée, y compris juste après un oubli) — toujours "guided",
//   quelle que soit la valeur de stability à ce stade transitoire.
// - `stability` (jours) ne départage "intermediate" vs "strong_recall" que
//   pour les items en state "Review" : plus stability est grand, plus le
//   prochain oubli est lointain, donc plus la connaissance est consolidée.
const HELP_LEVELS = ["guided", "intermediate", "strong_recall"];

// Seuils regroupés ici (jamais dispersés côté serveur ou front) pour rester
// facilement ajustables sans toucher à la logique de dérivation ni à l'UI.
const HELP_LEVEL_CONFIG = {
  // États FSRS jamais assez consolidés pour réduire l'aide, quelle que soit
  // stability (cf. ts-fsrs State : New/Learning/Relearning/Review).
  fragileStates: new Set(["New", "Learning", "Relearning"]),
  // stability (jours) à partir duquel une connaissance en "Review" est jugée
  // bien établie -> "strong_recall". En dessous -> "intermediate". Valeur
  // ronde (3 semaines) choisie comme un premier seuil raisonnable, pas issue
  // d'une calibration empirique — à ajuster ici seul si besoin.
  strongRecallMinStabilityDays: 21
};

// `fsrsState` : le même "shape" que memory_item_fsrs_states/fsrs-scheduler.js
// ({ state, stability, ... }), ou null/undefined si aucun état n'existe
// encore pour ce MemoryItem (jamais réviséé, ou anciennes données
// incomplètes) — fallback "guided" dans tous les cas ambigus, jamais une
// exception : donner le plus d'aide possible est toujours un choix sûr,
// jamais un blocage.
function deriveHelpLevel(fsrsState) {
  if (!fsrsState || typeof fsrsState.state !== "string") return "guided";
  if (HELP_LEVEL_CONFIG.fragileStates.has(fsrsState.state)) return "guided";
  if (fsrsState.state !== "Review") return "guided";
  const stability = fsrsState.stability;
  if (typeof stability !== "number" || !Number.isFinite(stability)) return "guided";
  return stability >= HELP_LEVEL_CONFIG.strongRecallMinStabilityDays ? "strong_recall" : "intermediate";
}

module.exports = {
  HELP_LEVELS,
  HELP_LEVEL_CONFIG,
  deriveHelpLevel
};
