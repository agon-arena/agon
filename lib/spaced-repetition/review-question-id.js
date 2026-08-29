"use strict";

function parseCultureGeneraleReviewRef(questionId) {
  const match = /^cgreview-(.+?)(?:::r\d+)?$/.exec(String(questionId || ""));
  return match ? match[1] : null;
}

function buildCultureGeneraleReviewQuestionId(questionId, reps) {
  const ref = String(questionId || "").trim();
  const reviewNumber = Math.max(0, Number.parseInt(reps, 10) || 0);
  return `cgreview-${ref}::r${reviewNumber}`;
}

module.exports = {
  buildCultureGeneraleReviewQuestionId,
  parseCultureGeneraleReviewRef
};
