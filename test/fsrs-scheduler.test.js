"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { reviewMemoryItem, DEFAULT_REQUEST_RETENTION } = require("../lib/spaced-repetition/fsrs-scheduler");

test("DEFAULT_REQUEST_RETENTION est un taux de rappel plausible", () => {
  assert.ok(DEFAULT_REQUEST_RETENTION > 0 && DEFAULT_REQUEST_RETENTION <= 1);
});

test("première review d'un MemoryItem (currentState null) : elapsedDays est null", () => {
  const now = new Date("2026-08-16T10:00:00Z");
  const { nextState, elapsedDays, schedulerModelId } = reviewMemoryItem({ currentState: null, rating: "Good", now });

  assert.equal(elapsedDays, null);
  assert.ok(schedulerModelId.startsWith("ts-fsrs@"));
  assert.ok(nextState.due instanceof Date);
  assert.ok(nextState.due.getTime() > now.getTime());
  assert.equal(nextState.reps, 1);
  assert.equal(nextState.lapses, 0);
  assert.ok(["Learning", "Review"].includes(nextState.state));
});

test("une deuxième review calcule elapsedDays à partir des timestamps réels", () => {
  const first = new Date("2026-08-16T10:00:00Z");
  const { nextState: afterFirst } = reviewMemoryItem({ currentState: null, rating: "Good", now: first });

  const second = new Date("2026-08-19T10:00:00Z"); // 3 jours plus tard, à l'heure près
  const { elapsedDays } = reviewMemoryItem({ currentState: afterFirst, rating: "Good", now: second });

  assert.equal(elapsedDays, 3);
});

test("Again après une série de Good renvoie l'item en Relearning avec un lapse de plus", () => {
  const t0 = new Date("2026-08-01T09:00:00Z");
  let state = reviewMemoryItem({ currentState: null, rating: "Good", now: t0 }).nextState;
  const t1 = new Date("2026-08-05T09:00:00Z");
  state = reviewMemoryItem({ currentState: state, rating: "Good", now: t1 }).nextState;

  const lapsesBefore = state.lapses;
  const t2 = new Date("2026-08-15T09:00:00Z");
  const { nextState } = reviewMemoryItem({ currentState: state, rating: "Again", now: t2 });

  assert.equal(nextState.lapses, lapsesBefore + 1);
  assert.equal(nextState.state, "Relearning");
});

test("Easy programme une échéance plus lointaine que Hard pour la même review", () => {
  const now = new Date("2026-08-16T10:00:00Z");
  const easy = reviewMemoryItem({ currentState: null, rating: "Easy", now }).nextState;
  const hard = reviewMemoryItem({ currentState: null, rating: "Hard", now }).nextState;

  assert.ok(easy.due.getTime() >= hard.due.getTime());
});

test("un rating invalide est rejeté", () => {
  assert.throws(
    () => reviewMemoryItem({ currentState: null, rating: "Moyen", now: new Date() }),
    /rating invalide/
  );
});

test("un state invalide dans currentState est rejeté", () => {
  const now = new Date("2026-08-16T10:00:00Z");
  const bogusState = {
    due: now,
    stability: 1,
    difficulty: 5,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 1,
    lapses: 0,
    state: "Archived",
    lastReviewAt: now
  };
  assert.throws(
    () => reviewMemoryItem({ currentState: bogusState, rating: "Good", now }),
    /state invalide/
  );
});
