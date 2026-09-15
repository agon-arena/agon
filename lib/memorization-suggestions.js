"use strict";

// Sélection déterministe des connaissances à proposer en mémorisation à la
// fin d'un parcours QCM progressif (demande du 12/09/2026, "à la fin d'un QCM
// Mnoria, proposer jusqu'à 2 connaissances qui ont réellement posé
// problème"). Pure et locale : aucun accès réseau/DB, aucun appel IA — la
// fonction ci-dessous ne fait QUE choisir parmi des entrées déjà résolues,
// que l'appelant construit depuis daily_quiz_answers + daily_quiz.questions
// (cf. server.js computeMemorizationSuggestionsForQuiz). Jamais de niveau
// "inventé" : une entrée n'existe ici QUE si l'utilisateur a réellement
// répondu à cette question.
//
// États de ressenti existants dans le code (cf. server.js POST
// /api/daily-quiz/answer, colonne daily_quiz_answers.difficulty) : exactement
// "facile" / "moyen" / "difficile", ou null (réponse sans ressenti soumis —
// ancien client, "Renforcement" pas encore mis à jour à l'époque, jamais une
// absence de sens particulière). Spécification exacte du 13/09/2026 : 3
// niveaux de priorité positifs par palier de niveau — ratée, puis
// réussie+difficile, puis réussie+moyen — et exclut explicitement
// réussie+facile (et réussie+null, jamais un signal de fragilité). D'où
// l'ordre strict en 9 paliers : Élémentaire ratée → Élémentaire difficile →
// Élémentaire moyen → Avancé ratée → Avancé difficile → Avancé moyen →
// Expert ratée → Expert difficile → Expert moyen — seul un niveau réellement
// atteint (cf. commentaire de selectMemorizationSuggestions) fournit des
// candidats pour ses 3 paliers.
const PROGRESSIVE_LEVEL_ORDER = ["elementaire", "avance", "expert"];
const MAX_MEMORIZATION_SUGGESTIONS = 6;

// `answeredEntries`: tableau d'objets { knowledgeTargetId, level, correct, difficulty }
// — un élément par question RÉELLEMENT répondue (jamais une question non
// répondue, jamais un niveau non atteint : c'est à l'appelant de ne fournir
// que ça). `level` doit valoir l'une des 3 valeurs de PROGRESSIVE_LEVEL_ORDER
// pour être prise en compte — toute autre valeur (master legacy/import sans
// curriculum, level absent) n'est jamais rattachée à un niveau ici et ne peut
// donc jamais être proposée par cette fonction.
// Retourne un tableau de knowledgeTargetId (jamais plus de
// MAX_MEMORIZATION_SUGGESTIONS, jamais un doublon), dans l'ordre de priorité
// exact demandé.
function selectMemorizationSuggestions(answeredEntries) {
  const entries = Array.isArray(answeredEntries) ? answeredEntries : [];
  const suggestions = [];
  const alreadySuggested = new Set();

  for (const level of PROGRESSIVE_LEVEL_ORDER) {
    if (suggestions.length >= MAX_MEMORIZATION_SUGGESTIONS) break;

    const levelEntries = entries.filter((e) => e && e.level === level && e.knowledgeTargetId);
    if (!levelEntries.length) continue; // niveau jamais atteint (ou sans connaissance résoluble) : jamais inventé ici

    // Dédoublonnage PAR CONNAISSANCE avant tout classement (jamais par
    // question) : si plusieurs questions répondues pointent vers le même
    // knowledgeTargetId, "le pire signal gagne" — une seule question ratée
    // suffit à classer la connaissance "ratée", même si une autre question
    // de cette même connaissance a par ailleurs été réussie facilement.
    const stateByKnowledgeTarget = new Map();
    for (const e of levelEntries) {
      const failed = e.correct === false;
      const hardButCorrect = e.correct === true && e.difficulty === "difficile";
      const mediumButCorrect = e.correct === true && e.difficulty === "moyen";
      const existing = stateByKnowledgeTarget.get(e.knowledgeTargetId);
      if (!existing) {
        stateByKnowledgeTarget.set(e.knowledgeTargetId, { failed, hardButCorrect, mediumButCorrect });
      } else {
        existing.failed = existing.failed || failed;
        existing.hardButCorrect = existing.hardButCorrect || hardButCorrect;
        existing.mediumButCorrect = existing.mediumButCorrect || mediumButCorrect;
      }
    }

    const failedIds = [];
    const hardButCorrectIds = [];
    const mediumButCorrectIds = [];
    for (const [knowledgeTargetId, state] of stateByKnowledgeTarget.entries()) {
      if (alreadySuggested.has(knowledgeTargetId)) continue; // déjà retenue à un niveau précédent (ne devrait pas arriver en pratique, défensif)
      if (state.failed) failedIds.push(knowledgeTargetId);
      else if (state.hardButCorrect) hardButCorrectIds.push(knowledgeTargetId);
      else if (state.mediumButCorrect) mediumButCorrectIds.push(knowledgeTargetId);
      // sinon (réussie + facile/null) : jamais proposée, cf. commentaire de tête.
    }

    for (const knowledgeTargetId of [...failedIds, ...hardButCorrectIds, ...mediumButCorrectIds]) {
      if (suggestions.length >= MAX_MEMORIZATION_SUGGESTIONS) break;
      suggestions.push(knowledgeTargetId);
      alreadySuggested.add(knowledgeTargetId);
    }
  }

  return suggestions;
}

module.exports = {
  selectMemorizationSuggestions,
  MAX_MEMORIZATION_SUGGESTIONS,
  PROGRESSIVE_LEVEL_ORDER
};
