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
  // Génération progressive (Phase 1, 02/09/2026 ; taille FLEXIBLE, 02/09/2026
  // suite) : isMasterEligibleQuiz reçoit aussi progressive_status ET
  // curriculum pour juger équitablement un bloc progressif légitimement
  // partiel — cf. lib/question-formats.js, comportement legacy strictement
  // inchangé quand progressive_status est absent (NULL).
  assert.match(server, /if \(isMasterEligibleQuiz\(raceRow\?\.questions, \{ progressiveStatus: raceRow\?\.progressive_status, curriculum: raceRow\?\.curriculum \}\)\)/);
  const callers = server.match(/return resolveMasterInsertConflict\(masterSlot, questions, quizDate\);/g) || [];
  assert.equal(callers.length, 2);
  // Le payload d'update est désormais construit dynamiquement
  // (updatePayload) pour pouvoir y ajouter curriculum/progressive_status
  // UNIQUEMENT quand un appelant progressif les fournit — le cas legacy
  // (extra={}) écrit toujours exactement { questions, source_debate_ids: [] }.
  assert.match(server, /const updatePayload = \{ questions, source_debate_ids: \[\] \};/);
  assert.match(server, /\.update\(updatePayload\)/);
});
