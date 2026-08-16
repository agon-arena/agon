// Seul fichier de tout le projet qui importe "ts-fsrs" directement. Le
// reste de server.js et du reste de lib/spaced-repetition/ ne manipule que
// des objets simples (le "shape" mémory_item_fsrs_states ci-dessous) —
// migrer vers un autre modèle FSRS (cf. lib/spaced-repetition/scheduler-version.js)
// ou une autre librairie ne devrait jamais toucher qu'à ce fichier.
const { fsrs, generatorParameters, createEmptyCard, Rating, State } = require("ts-fsrs");
const { SCHEDULER_MODEL_ID } = require("./scheduler-version");

// Rétention désirée : seule config centralisée du taux de rappel visé
// (probabilité qu'une révision soit encore réussie à l'échéance). Toute
// autre partie du code qui a besoin de cette valeur (rapports, tests) doit
// importer DEFAULT_REQUEST_RETENTION d'ici plutôt que la redéfinir.
const DEFAULT_REQUEST_RETENTION = 0.9;

const scheduler = fsrs(generatorParameters({ request_retention: DEFAULT_REQUEST_RETENTION }));

const VALID_RATINGS = new Set(["Again", "Hard", "Good", "Easy"]);
const VALID_STATES = new Set(["New", "Learning", "Review", "Relearning"]);

// "shape" partagé avec la ligne memory_item_fsrs_states (moins les colonnes
// d'identité user_id/memory_item_id) : due (Date), stability, difficulty,
// scheduledDays, learningSteps, reps, lapses, state (string), lastReviewAt
// (Date|null). Les dates sont toujours des objets Date en mémoire — la
// conversion TIMESTAMPTZ <-> Date est laissée à l'appelant (couche
// Supabase), jamais à ce fichier.
function toCardInput(state) {
  if (!state) return null;
  if (!VALID_STATES.has(state.state)) {
    throw new Error(`fsrs-scheduler: state invalide "${state.state}".`);
  }
  return {
    due: state.due,
    stability: state.stability,
    difficulty: state.difficulty,
    scheduled_days: state.scheduledDays,
    learning_steps: state.learningSteps,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state,
    last_review: state.lastReviewAt || undefined
  };
}

function fromCard(card) {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: State[card.state],
    lastReviewAt: card.last_review || null
  };
}

// Applique une review à un MemoryItem pour un utilisateur.
// currentState : null si c'est la toute première review de ce MemoryItem
//   pour cet utilisateur (une carte FSRS "New" est créée à la volée), sinon
//   le "shape" ci-dessus lu depuis memory_item_fsrs_states.
// rating : "Again" | "Hard" | "Good" | "Easy" — déjà résolu par
//   mapMnoriaReviewToFsrsRating (cf. rating-mapper.js), jamais recalculé ici.
// now : Date exacte de la review (jamais tronquée à la journée — cf.
//   scheduler-version.js).
// Retourne { nextState, elapsedDays, schedulerModelId } :
//   - nextState : nouveau "shape" à upsert dans memory_item_fsrs_states.
//   - elapsedDays : jours écoulés depuis la dernière review (nombre
//     fractionnaire calculé à partir des timestamps réels, jamais lu d'un
//     champ interne ts-fsrs déprécié), null pour une première review.
//   - schedulerModelId : à consigner tel quel sur la ligne
//     memory_item_fsrs_states ET sur l'événement memory_review_events.
function reviewMemoryItem({ currentState, rating, now }) {
  if (!VALID_RATINGS.has(rating)) {
    throw new Error(`fsrs-scheduler: rating invalide "${rating}".`);
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("fsrs-scheduler: now doit être une Date valide.");
  }

  const cardInput = toCardInput(currentState) || createEmptyCard(now);
  const result = scheduler.next(cardInput, now, Rating[rating]);

  const elapsedDays = currentState?.lastReviewAt
    ? (now.getTime() - new Date(currentState.lastReviewAt).getTime()) / (24 * 60 * 60 * 1000)
    : null;

  return {
    nextState: fromCard(result.card),
    elapsedDays,
    schedulerModelId: SCHEDULER_MODEL_ID
  };
}

module.exports = {
  DEFAULT_REQUEST_RETENTION,
  reviewMemoryItem
};
