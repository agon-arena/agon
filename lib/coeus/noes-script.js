"use strict";

const { buildMemoryItemNaturalKey } = require("../spaced-repetition/memory-model");

const NOES_QUESTION_MAX_LENGTH = 160;
const NOES_ANSWER_MAX_LENGTH = 220;

// Point fondamental de la mission Noès (26/08/2026) : Noès NE DOIT PAS
// réutiliser directement les questions du QCM (souvent un format QCM/texte à
// trous conçu pour être LU, pas ENTENDU). La source est `knowledgeTarget` —
// la phrase factuelle atomique que l'IA elle-même a écrite avant de générer
// chaque question (cf. lib/knowledge-admission.js,
// buildQuestionsFromKnowledgePrompt, server.js ~13458) — déjà validée et
// stockée sur chaque question de daily_quiz.questions.
//
// Une question sans knowledgeTarget (contenu générée avant l'introduction de
// ce champ, cf. son commentaire dans lib/question-formats.js) est
// SIMPLEMENT EXCLUE du script Noès plutôt que reconstruite depuis la
// question QCM elle-même — un batch peut donc légitimement contenir moins de
// 5 connaissances exploitables. C'est un choix de sûreté, pas un bug : mieux
// vaut un lot plus court qu'une entorse au principe "jamais le QCM tel
// quel".
function buildNoesScriptItemsFromQuestions({ slot, quizDate, questions }) {
  const facts = [];
  const knowledgeIds = [];
  for (const question of Array.isArray(questions) ? questions : []) {
    const knowledgeTarget = typeof question?.knowledgeTarget === "string" ? question.knowledgeTarget.trim() : "";
    if (!knowledgeTarget) continue;
    facts.push(knowledgeTarget);
    knowledgeIds.push(buildMemoryItemNaturalKey({ slot, quizDate, questionId: question.id }));
  }
  return { facts, knowledgeIds };
}

// Les connaissances sont numérotées LOCALEMENT (1., 2., ...) pour le prompt
// plutôt que d'exposer leur natural_key (longue, opaque) au modèle : le
// mapping vers knowledge_id se fait ensuite côté serveur, par position
// (cf. validateNoesScriptResponse) — élimine tout risque que l'IA recopie
// mal un identifiant long.
function buildNoesScriptPrompt(facts) {
  const lines = facts.map((fact, index) => `${index + 1}. ${fact}`).join("\n");
  return [
    "Tu prépares le script oral d'un avatar vidéo (Noès) qui pose une question à l'utilisateur puis, après une pause de réflexion, lui donne la réponse — jamais un QCM, jamais de choix A/B/C/D.",
    "",
    "Voici une liste de connaissances factuelles, chacune numérotée :",
    lines,
    "",
    "Pour CHAQUE connaissance numérotée, rédige :",
    "- \"question\" : une question courte et naturelle à l'oral (comme si Noès la posait à voix haute), qui teste UNIQUEMENT cette connaissance, sans jamais donner la réponse dans la question elle-même.",
    "- \"answer\" : la réponse courte (quelques mots à une phrase brève), directement dérivée du texte de la connaissance, sans reformuler ni ajouter d'information absente du texte source.",
    "",
    "Règles impératives :",
    "- Une seule information principale par question (jamais deux dates, deux chiffres ou deux faits indépendants dans la même question).",
    "- N'invente jamais un fait qui ne figure pas explicitement dans le texte de la connaissance numérotée.",
    "- Jamais de format QCM, jamais d'options, jamais \"vrai ou faux\".",
    "- La réponse doit rester compréhensible seule, sans réentendre la question.",
    `Réponds uniquement en JSON strict, sous la forme {"items":[{"index":1,"question":"...","answer":"..."}, ...]}, avec exactement une entrée par connaissance numérotée ci-dessus, dans le même ordre.`
  ].join("\n");
}

// Validation serveur stricte (mission §"Génération du script Noès") :
// - le tableau retourné doit avoir EXACTEMENT une entrée par connaissance
//   envoyée, dans le même ordre (le mapping vers knowledge_id se fait par
//   position, jamais en faisant confiance à un champ "index" recopié) ;
// - question/answer non vides, bornées en longueur ;
// - rejet défensif si le modèle a malgré tout renvoyé un format QCM
//   (options/correctIndex), même si le prompt l'interdit explicitement.
function validateNoesScriptResponse(parsed, knowledgeIds) {
  const rawItems = Array.isArray(parsed?.items) ? parsed.items : null;
  if (!rawItems || rawItems.length !== knowledgeIds.length) return null;

  const result = [];
  for (let i = 0; i < knowledgeIds.length; i += 1) {
    const raw = rawItems[i];
    if (!raw || typeof raw !== "object") return null;
    if (Array.isArray(raw.options) || raw.correctIndex !== undefined || Array.isArray(raw.correctIndexes)) return null;

    const question = typeof raw.question === "string" ? raw.question.trim() : "";
    const answer = typeof raw.answer === "string" ? raw.answer.trim() : "";
    if (!question || !answer) return null;
    if (question.length > NOES_QUESTION_MAX_LENGTH || answer.length > NOES_ANSWER_MAX_LENGTH) return null;

    result.push({ knowledgeId: knowledgeIds[i], question, answer });
  }
  return result;
}

module.exports = {
  NOES_QUESTION_MAX_LENGTH,
  NOES_ANSWER_MAX_LENGTH,
  buildNoesScriptItemsFromQuestions,
  buildNoesScriptPrompt,
  validateNoesScriptResponse
};
