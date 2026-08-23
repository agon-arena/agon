// Jauge de charge d'apprentissage (demande du 17/08/2026) — anticipe si le
// rythme de mémorisation en cours va produire un embouteillage de repasses
// dans les jours qui viennent, jamais QUAND revoir une carte précise (ça
// reste FSRS, cf. fsrs-scheduler.js, jamais touché ici). Fonction pure,
// lecture seule d'un comptage déjà agrégé : n'importe jamais ts-fsrs, ne
// modifie aucun état FSRS, ne choisit jamais quelle carte montrer.
//
// Le plafond quotidien de repasses injectées (cf. server.js
// DAILY_QUIZ_ACQUIS_REVIEW_MAX_PER_DAY) absorbe déjà un pic isolé un jour
// donné : ce qui dépasse ce plafond glisse simplement au lendemain (les
// cartes restent "dues", pas de recalcul de date). Un simple pic brut par
// jour peut donc mentir dans les deux sens — un jour à 30 suivi de jours
// calmes s'absorbe tout seul en 1-2 jours, alors qu'une suite de jours
// légèrement au-dessus du plafond (ex. 22-23) construit un vrai retard qui
// grossit. On simule donc ce report en cascade jour après jour plutôt que
// de comparer un pic brut au plafond.

const DEFAULT_PROJECTION_DAYS = 14;

// Paliers sur le ratio (charge la pire journée simulée / plafond quotidien).
// Regroupés ici (jamais dispersés côté serveur ou front) pour rester
// facilement ajustables sans toucher à la logique de simulation.
const LOAD_LEVELS = ["calm", "moderate", "busy", "overloaded"];
const LOAD_LEVEL_THRESHOLDS = {
  moderate: 0.5,   // ratio >= 0.5 -> "moderate"
  busy: 1.0,       // ratio >= 1.0 -> "busy" (la pire journée dépasse le plafond)
  overloaded: 1.75 // ratio >= 1.75 -> "overloaded"
};

function levelFromRatio(ratio) {
  if (ratio >= LOAD_LEVEL_THRESHOLDS.overloaded) return "overloaded";
  if (ratio >= LOAD_LEVEL_THRESHOLDS.busy) return "busy";
  if (ratio >= LOAD_LEVEL_THRESHOLDS.moderate) return "moderate";
  return "calm";
}

// `dueCountsByDay` : tableau de longueur N (jour 0 = aujourd'hui inclus, donc
// déjà en retard éventuel + nouvelles échéances du jour ; jour i = nouvelles
// échéances du jour i uniquement, i >= 1) — jamais négatif, jamais un
// décompte cumulé côté appelant (la cascade est simulée ici, pas en amont).
// `cap` : plafond quotidien réellement appliqué (cf.
// DAILY_QUIZ_ACQUIS_REVIEW_MAX_PER_DAY), doit être > 0.
//
// Retourne { level, ratio, peakDayIndex, peakLoad, backlogByDay } :
//   - peakLoad : la charge totale (report cumulé + nouvelles échéances) de la
//     pire journée simulée dans la fenêtre.
//   - peakDayIndex : son indice (0 = aujourd'hui).
//   - ratio : peakLoad / cap, la seule valeur dont dépend `level`.
//   - backlogByDay : le report non absorbé à la fin de chaque jour, utile
//     pour un graphe/historique, jamais nécessaire pour dériver `level` seul.
function computeLearningLoadGauge(dueCountsByDay, cap) {
  const counts = Array.isArray(dueCountsByDay) ? dueCountsByDay.map((n) => Math.max(0, Number(n) || 0)) : [];
  const dailyCap = Number(cap);
  if (!Number.isFinite(dailyCap) || dailyCap <= 0) {
    throw new Error("computeLearningLoadGauge: cap doit être un nombre positif.");
  }
  if (!counts.length) {
    return { level: "calm", ratio: 0, peakDayIndex: -1, peakLoad: 0, backlogByDay: [] };
  }

  let backlog = 0;
  let peakLoad = 0;
  let peakDayIndex = 0;
  const backlogByDay = [];
  for (let day = 0; day < counts.length; day++) {
    const totalLoad = backlog + counts[day];
    if (totalLoad > peakLoad) {
      peakLoad = totalLoad;
      peakDayIndex = day;
    }
    backlog = Math.max(0, totalLoad - dailyCap);
    backlogByDay.push(backlog);
  }

  const ratio = peakLoad / dailyCap;
  return { level: levelFromRatio(ratio), ratio, peakDayIndex, peakLoad, backlogByDay };
}

module.exports = {
  DEFAULT_PROJECTION_DAYS,
  LOAD_LEVELS,
  LOAD_LEVEL_THRESHOLDS,
  computeLearningLoadGauge
};
