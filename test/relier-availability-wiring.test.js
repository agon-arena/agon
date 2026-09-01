"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

test("Relier est disponible seulement s'il reste une question du jour sans réponse", () => {
  const helperStart = server.indexOf("async function hasPendingCultureGeneraleComprehensionQuestions(");
  const helperEnd = server.indexOf("async function fetchCultureGeneraleComprehensionQuestions(", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = server.slice(helperStart, helperEnd);
  assert.match(helper, /daily_quiz_answers/);
  assert.match(helper, /answeredIds/);
  assert.match(helper, /return questionIds\.some\(\(questionId\) => !answeredIds\.has\(questionId\)\)/);

  const statusStart = server.indexOf('app.get("/api/daily-quiz/status"');
  const statusEnd = server.indexOf('app.get("/api/daily-quiz/today"', statusStart);
  const statusRoute = server.slice(statusStart, statusEnd);
  assert.match(statusRoute, /hasPendingCultureGeneraleComprehensionQuestions\(voterKey, todayKey\)/);
  assert.doesNotMatch(statusRoute, /hasCultureGeneraleComprehensionLinks/);
});

test("un nouveau lien sans banque de questions garde Relier disponible", () => {
  assert.match(
    server,
    /selectedSlots\.some\(\(slot\) => !latestBankBySlot\.has\(slot\)\)\) return true;/
  );
});

test("le rappel quotidien n'annonce pas Relier lorsque sa série est déjà terminée", () => {
  const digestStart = server.indexOf("async function sendLearningDigestNotifications(");
  const digestEnd = server.indexOf("function scheduleLearningDigestNotifications", digestStart);
  const digest = server.slice(digestStart, digestEnd);
  assert.match(digest, /hasPendingCultureGeneraleComprehensionQuestions\(legacyKey, todayKey\)/);
});
