"use strict";

// Découplage fiche/QCM (10/09/2026) : la fiche pédagogique suit le contenu
// réellement disponible dans le master partagé (progressive_status), tandis
// que les questions/corrigés continuent de suivre le niveau personnel du
// parcours utilisateur. Ce test verrouille le câblage serveur sans lancer
// Express ni Supabase.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

function ficheRouteBody() {
  const routeIndex = SERVER_SOURCE.indexOf('app.get("/api/users/notion-quizzes/fiche"');
  assert.ok(routeIndex > 0);
  const nextRouteIndex = SERVER_SOURCE.indexOf("\napp.get(", routeIndex + 10);
  return SERVER_SOURCE.slice(routeIndex, nextRouteIndex > 0 ? nextRouteIndex : routeIndex + 10000);
}

test("la route /fiche nomme explicitement le niveau QCM `questionServingLevel`, utilisé uniquement pour les questions/corrigés", () => {
  const routeBody = ficheRouteBody();
  assert.match(routeBody, /const questionServingLevel = persistedLevel \|\| requestedLevel \|\| rawQuestions\[0\]\?\.level \|\| null;/);
  assert.match(routeBody, /const levelCeiledQuestions = restrictQuestionsToProgressiveLevelCeiling\(rawQuestions, questionServingLevel, progressiveStatus\);/);
  assert.match(routeBody, /questions = selectQuestionsForRequestedLevel\(levelCeiledQuestions, NOTION_QUIZ_LEVELS\[questionServingLevel\]\?\.target\);/);
  assert.match(routeBody, /level: questionServingLevel,/);
});

test("la route /fiche dérive ficheLevel depuis progressive_status, jamais depuis requested_level ou target_level", () => {
  const routeBody = ficheRouteBody();
  assert.match(SERVER_SOURCE, /const FICHE_LEVEL_FOR_PROGRESSIVE_STATUS = \{ elementary_ready: "elementaire", deepening_ready: "avance", ready: "expert" \};/);
  assert.match(routeBody, /const ficheAvailableLevel = FICHE_LEVEL_FOR_PROGRESSIVE_STATUS\[progressiveStatus\] \|\| null;/);
  assert.match(routeBody, /const ficheAvailableLevelRank = progressiveLevelRank\(ficheAvailableLevel\);/);
  assert.match(routeBody, /ficheLevel: ficheAvailableLevel,/);
  assert.match(routeBody, /progressiveStatus,/);
});

test("les sections de fiche sont filtrées au maximum par ficheAvailableLevelRank, jamais par le niveau QCM utilisateur", () => {
  const routeBody = ficheRouteBody();
  const sourceDetailIndex = routeBody.indexOf("const sourceDetailForResponse = fullSourceDetail ? {");
  assert.ok(sourceDetailIndex > 0);
  const sourceDetailBlock = routeBody.slice(sourceDetailIndex, routeBody.indexOf("\n    } : null;", sourceDetailIndex) + 12);
  assert.match(sourceDetailBlock, /sections: \(fullSourceDetail\.sections \|\| \[\]\)\.filter\(\(s\) => \{/);
  assert.match(sourceDetailBlock, /if \(!progressiveStatus \|\| ficheAvailableLevelRank < 0\) return true;/);
  assert.match(sourceDetailBlock, /return sectionRank < 0 \|\| sectionRank <= ficheAvailableLevelRank;/);
  assert.doesNotMatch(sourceDetailBlock, /questionServingLevel|requestedLevel|persistedLevel|targetLevel/);
});

test("les knowledgeTargets de fiche suivent le niveau disponible du master, pas le niveau QCM servi", () => {
  const routeBody = ficheRouteBody();
  const curriculumIndex = routeBody.indexOf("const visibleCurriculum = hasCurriculum");
  assert.ok(curriculumIndex > 0);
  const curriculumBlock = routeBody.slice(curriculumIndex, routeBody.indexOf("\n        })", curriculumIndex) + 12);
  assert.match(curriculumBlock, /if \(!progressiveStatus \|\| ficheAvailableLevelRank < 0\) return true;/);
  assert.match(curriculumBlock, /return rank < 0 \|\| rank <= ficheAvailableLevelRank;/);
  assert.doesNotMatch(curriculumBlock, /questionServingLevel|requestedLevel|persistedLevel|targetLevel/);
  assert.match(routeBody, /const legacyKnowledgeTargets = hasCurriculum \? \[\] : rawQuestions\.reduce/);
});

test("les questions renvoyées à la fiche exposent leur niveau fiable : curriculum par knowledgeTargetId d'abord, q.level explicite ensuite", () => {
  const routeBody = ficheRouteBody();
  assert.match(routeBody, /const curriculumQuestionLevelById = new Map/);
  assert.match(routeBody, /const curriculumLevel = q\.knowledgeTargetId \? curriculumQuestionLevelById\.get\(q\.knowledgeTargetId\) : null;/);
  assert.match(routeBody, /const explicitQuestionLevel = progressiveLevelRank\(q\.level\) >= 0 \? q\.level : null;/);
  assert.match(routeBody, /const displayLevel = curriculumLevel \|\| explicitQuestionLevel \|\| null;/);
  assert.match(routeBody, /level: displayLevel,/);
  assert.match(routeBody, /knowledgeTargetId: q\.knowledgeTargetId \|\| null/);
});
