const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('Expert generation uses the shared minimum for a reusable master', () => {
  assert.match(server, /target: 20, max: 22, min: MIN_MASTER_QUESTIONS/);
  assert.match(server, /parsedCandidate\.candidates\.length >= min/);
});

test('an incomplete stored master is replaced after a successful regeneration', () => {
  assert.match(server, /async function resolveMasterInsertConflict\(/);
  assert.match(server, /if \(isMasterEligibleQuiz\(raceRow\?\.questions\)\)/);
  const callers = server.match(/return resolveMasterInsertConflict\(masterSlot, questions, quizDate\);/g) || [];
  assert.equal(callers.length, 2);
  assert.match(server, /\.update\(\{ questions, source_debate_ids: \[\] \}\)/);
});
