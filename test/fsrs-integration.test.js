"use strict";

// Tests d'intégration de la couche FSRS (section 32 du prompt de refonte,
// 13-16/08/2026) qui ne rentrent pas dans un seul module unitaire : ils
// exercent ensemble lib/spaced-repetition/memory-model.js,
// lib/spaced-repetition/rating-mapper.js et
// lib/spaced-repetition/fsrs-scheduler.js, sans base de données (uniquement
// des fonctions pures/en mémoire) — le bout-en-bout réel (vraies requêtes
// HTTP + Supabase) a été vérifié manuellement le 16/08/2026 (création d'un
// MemoryItem, repasse due, réponse correcte, alternance de variante,
// avancée de due_at), rejoué ici sous forme de règles automatisées.
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMemoryItemNaturalKey } = require("../lib/spaced-repetition/memory-model");
const { reviewMemoryItem } = require("../lib/spaced-repetition/fsrs-scheduler");
const { mapMnoriaReviewToFsrsRating } = require("../lib/spaced-repetition/rating-mapper");

test("changement de niveau : même sujet, niveaux différents -> MemoryItems distincts", () => {
  const elementaire = buildMemoryItemNaturalKey({ slot: "notion:histoire:abc:elementaire", quizDate: "2026-08-10", questionId: "notion:histoire:abc-elementaire-q1" });
  const expert = buildMemoryItemNaturalKey({ slot: "notion:histoire:abc:expert", quizDate: "2026-08-10", questionId: "notion:histoire:abc-expert-q1" });
  assert.notEqual(elementaire, expert);
});

test("session multi-sujets : réviser un MemoryItem n'affecte pas l'état d'un autre", () => {
  const t0 = new Date("2026-08-01T09:00:00Z");
  const t1 = new Date("2026-08-05T09:00:00Z");

  // Deux MemoryItems indépendants, mêmes deux premières reviews (Good, Good)
  // pour atteindre l'état "Review" avant de les faire diverger — un "Again"
  // pendant l'apprentissage initial (état "Learning") n'est pas un lapse au
  // sens FSRS, seul l'oubli d'une carte déjà en "Review" en est un.
  let stateA = reviewMemoryItem({ currentState: null, rating: "Good", now: t0 }).nextState;
  stateA = reviewMemoryItem({ currentState: stateA, rating: "Good", now: t1 }).nextState;
  let stateB = reviewMemoryItem({ currentState: null, rating: "Good", now: t0 }).nextState;
  stateB = reviewMemoryItem({ currentState: stateB, rating: "Good", now: t1 }).nextState;
  assert.deepEqual(
    { stability: stateA.stability, difficulty: stateA.difficulty, state: stateA.state },
    { stability: stateB.stability, difficulty: stateB.difficulty, state: stateB.state }
  );

  // A échoue ensuite, B réussit : leurs trajectoires doivent diverger, sans
  // qu'aucun des deux n'influence l'autre (pas d'état partagé).
  const later = new Date("2026-08-20T10:00:00Z");
  const resultA = reviewMemoryItem({ currentState: stateA, rating: "Again", now: later });
  const resultB = reviewMemoryItem({ currentState: stateB, rating: "Easy", now: later });

  assert.equal(resultA.nextState.lapses, 1);
  assert.equal(resultB.nextState.lapses, 0);
  assert.notEqual(resultA.nextState.state, resultB.nextState.state);
  // stateB (jamais retouché par resultA) doit être resté intact.
  assert.equal(stateB.lapses, 0);
});

test("historique conservé : rejouer 3 reviews successives produit 3 étapes distinctes, jamais écrasées l'une par l'autre", () => {
  const t0 = new Date("2026-08-01T09:00:00Z");
  const t1 = new Date("2026-08-04T09:00:00Z");
  const t2 = new Date("2026-08-10T09:00:00Z");

  const step1 = reviewMemoryItem({ currentState: null, rating: mapMnoriaReviewToFsrsRating({ isCorrect: true, perceivedDifficulty: "moyen" }), now: t0 });
  const step2 = reviewMemoryItem({ currentState: step1.nextState, rating: mapMnoriaReviewToFsrsRating({ isCorrect: false, perceivedDifficulty: null }), now: t1 });
  const step3 = reviewMemoryItem({ currentState: step2.nextState, rating: mapMnoriaReviewToFsrsRating({ isCorrect: true, perceivedDifficulty: "facile" }), now: t2 });

  const dueDates = [step1.nextState.due.getTime(), step2.nextState.due.getTime(), step3.nextState.due.getTime()];
  const uniqueDueDates = new Set(dueDates);
  assert.equal(uniqueDueDates.size, 3, "chaque étape doit produire sa propre échéance, aucune ne doit coïncider par écrasement");
  assert.equal(step1.elapsedDays, null);
  assert.equal(step2.elapsedDays, 3);
  assert.equal(step3.elapsedDays, 6);
  // Échec pendant l'apprentissage initial (encore "Learning" après une seule
  // review) : pas encore un lapse au sens FSRS, réservé à l'oubli d'une
  // carte déjà passée en "Review" (cf. test "session multi-sujets" pour ce
  // cas). reps avance à chaque review, échouée ou non.
  assert.equal(step2.nextState.lapses, 0);
  assert.equal(step3.nextState.reps, 3);
});

test("nouvelle connaissance jamais vue : première review toujours en partant de zéro (reps=0 -> 1, lapses=0)", () => {
  const { nextState } = reviewMemoryItem({ currentState: null, rating: "Good", now: new Date("2026-08-16T10:00:00Z") });
  assert.equal(nextState.reps, 1);
  assert.equal(nextState.lapses, 0);
});
