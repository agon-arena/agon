// Modèle conceptuel de la mémorisation Mnoria (audit du 12/08/2026 + refonte
// FSRS du 13/08/2026). Toute la couche lib/spaced-repetition/ raisonne en
// ces trois termes — jamais en "débat", "sourceDebateId" ou "question.id"
// bruts, qui restent des détails d'implémentation du reste de server.js.
//
// SUBJECT (le "sujet"/la "connaissance", ex. une notion d'Éclairages, un
//   événement de "Ce jour dans l'Histoire", un sujet libre saisi dans "Mes
//   apprentissages"). Un Subject ne possède JAMAIS d'état FSRS en propre —
//   uniquement une progression AGRÉGÉE dérivée de ses MemoryItems (cf.
//   invariant D du prompt, tâche #13). Aujourd'hui représenté par le couple
//   (sourceType, sourceDebateId[, level]) porté par chaque question générée
//   (cf. buildNotionQuestions, buildCustomTopicQuiz), et par le `slot` du
//   daily_quiz correspondant pour les QCM de notion/sujet libre
//   ("notion:{sourceType}:{sourceId}[:{level}]"). sourceDebateId reste donc
//   TOUJOURS le Subject, jamais un MemoryItem, y compris quand son nom prête
//   à confusion pour les notions qui ne sont pas des débats.
//
// MEMORY ITEM (l'unité testée, celle qui porte l'état FSRS). Un Subject
//   possède N MemoryItems. En V1, UN MemoryItem = UN objet question tel que
//   généré aujourd'hui (le tableau `questions` d'une ligne daily_quiz), quel
//   que soit son format — y compris les formats composites (association,
//   ordre, qcm_multi, intrus) : ils ne sont PAS décomposés en plusieurs
//   MemoryItems pour l'instant (cf. section 6 du prompt FSRS). Un
//   utilisateur possède exactement UNE ligne memory_item_fsrs_states par
//   MemoryItem, jamais par Subject ni par QuestionVariant.
//
// QUESTION VARIANT (une formulation d'un MemoryItem). Depuis la refonte du
//   16/08/2026, jusqu'à TROIS par MemoryItem — un tableau `variants` de 1 à 3
//   formulations d'une même connaissance (direct/inverse/contextuel), jamais
//   3 par obligation (cf. lib/spaced-repetition/question-variant.js). Les 749
//   MemoryItems antérieurs à cette refonte gardent leur forme historique
//   (question de base + `altVariant` optionnel, au plus 2 formulations) :
//   getQuestionVariants() normalise les deux formes vers un même tableau,
//   jamais réécrite en base. Quelle que soit la forme, toutes les variantes
//   d'un MemoryItem partagent le MÊME état FSRS — jamais deux états distincts
//   pour la même connaissance juste reformulée. resolveActiveQuestionVariant()
//   choisit la formulation à afficher (rotation qui évite la répétition
//   immédiate, cf. selectVariantIndex), c'est un détail d'affichage, jamais un
//   signal pour le scheduler.
//
// IDENTITÉ STABLE D'UN MEMORY ITEM
//   Les ids de question actuels sont POSITIONNELS et NON stables :
//   `notion:${sourceType}:${sourceId}-${level}-q${index+1}` (et équivalents
//   pour buildCustomTopicQuiz/buildEnumerableCustomTopicQuiz) — une
//   régénération, un changement de niveau ou un réordonnancement produirait
//   un id différent à contenu identique. On ne peut donc PAS utiliser
//   question.id seul comme clé stable inter-générations.
//
//   En pratique, le contenu d'un (quiz_date, slot) donné n'est généré
//   qu'UNE SEULE FOIS et relu ensuite tel quel (cf. POST
//   /api/users/notion-quizzes : vérifie l'existence de la ligne daily_quiz
//   avant tout appel IA, jamais de double génération pour la même notion le
//   même jour). Le triplet (quiz_date, slot, question.id) reste donc stable
//   pour toute la durée de vie de cette ligne daily_quiz, y compris pour le
//   QCM quotidien tournant (slot "morning"/"evening", régénéré chaque jour
//   avec un nouveau quiz_date).
//
//   Clé naturelle retenue pour memory_items.natural_key :
//   `${slot}::${quizDate}::${questionId}`
//
//   Ce que cette clé assume SCIEMMENT, par respect de l'invariant "pas de
//   fusion automatique" (section 1 du prompt FSRS) :
//   - Le même sourceDebateId (même connaissance réelle) réapparaissant dans
//     le QCM quotidien tournant à des dates différentes engendre un NOUVEAU
//     MemoryItem à chaque apparition (nouveau quiz_date, nouveau
//     question.id) — pas de fusion avec ses apparitions précédentes, même
//     si la question posée est en substance identique. C'est un doublon
//     assumé, pas un bug.
//   - Si un même Subject (même slot) engendrait un jour une deuxième ligne
//     daily_quiz sous un quiz_date différent (cas non observé en usage
//     normal aujourd'hui : le client réutilise le quiz_date existant via
//     user_notion_quizzes plutôt que d'en régénérer un), ses questions
//     formeraient elles aussi de nouveaux MemoryItems distincts plutôt que
//     d'être fusionnées avec les précédentes.
//   Nous préférons ces doublons à une fusion incorrecte de deux souvenirs
//   différents.
function buildMemoryItemNaturalKey({ slot, quizDate, questionId }) {
  const normalizedSlot = String(slot || "").trim();
  const normalizedQuizDate = String(quizDate || "").trim();
  const normalizedQuestionId = String(questionId || "").trim();
  if (!normalizedSlot || !normalizedQuizDate || !normalizedQuestionId) {
    throw new Error("buildMemoryItemNaturalKey: slot, quizDate et questionId sont requis.");
  }
  return `${normalizedSlot}::${normalizedQuizDate}::${normalizedQuestionId}`;
}

module.exports = {
  buildMemoryItemNaturalKey
};
