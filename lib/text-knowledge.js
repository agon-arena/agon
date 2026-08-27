"use strict";

const {
  SELECTION_RULE_LINES,
  CALIBRATION_EXAMPLES,
  isMetaDocumentReference
} = require("./photo-knowledge");
const { truncateAtTextBoundary } = require("./text-boundaries");

const TEXT_KNOWLEDGE_MODEL = "gpt-4o-mini";
const TEXT_KNOWLEDGE_MAX_CHARS = 50_000;
const TEXT_KNOWLEDGE_MAX_ITEMS = 20;

function validateTextKnowledgePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw Object.assign(new Error("Payload invalide."), { code: "invalid_payload" });
  }
  if (typeof payload.text !== "string") {
    throw Object.assign(new Error("Le texte est obligatoire."), { code: "invalid_text" });
  }
  if (payload.sourceTitle != null && typeof payload.sourceTitle !== "string") {
    throw Object.assign(new Error("Le titre doit être un texte."), { code: "invalid_payload" });
  }
  const text = payload.text.trim();
  if (text.length < 3) throw Object.assign(new Error("Le texte est trop court."), { code: "invalid_text" });
  if (text.length > TEXT_KNOWLEDGE_MAX_CHARS) {
    throw Object.assign(new Error(`Le texte dépasse ${TEXT_KNOWLEDGE_MAX_CHARS.toLocaleString("fr-FR")} caractères. Réduis-le ou découpe-le en plusieurs imports.`), { code: "text_too_long" });
  }
  const sourceTitle = String(payload.sourceTitle || "").trim().replace(/\s+/g, " ").slice(0, 160) || null;
  return { text, sourceTitle };
}

function buildTextKnowledgePrompt(text, sourceTitle) {
  return [
    "Tu sélectionnes des connaissances directement à partir d'un texte collé par l'utilisateur. Tu te bases UNIQUEMENT sur ce texte : aucun savoir extérieur, aucune supposition.",
    sourceTitle ? `Titre ou thème fourni : ${sourceTitle}` : "Aucun titre ou thème fourni. Propose sourceTitle uniquement si un titre court est directement justifié par le texte ; sinon retourne null.",
    "", "Texte collé :", '"""', text, '"""', "",
    ...SELECTION_RULE_LINES,
    "", "Exemples de calibrage :",
    ...CALIBRATION_EXAMPLES.flatMap((example) => [`- ${example.text} → ${example.verdict}`, ...(example.forbidden || []).map((value) => `  Interdit : ${value}`)]),
    "",
    `Retourne au maximum ${TEXT_KNOWLEDGE_MAX_ITEMS} connaissances. C'est un plafond, jamais un objectif. knowledge: [] est un résultat valide.`,
    "Pour chaque connaissance, donne une evidence courte copiée exactement du texte collé.",
    "Réponds uniquement en JSON strict :",
    '{"sourceTitle":"titre court ou null","knowledge":[{"knowledge":"phrase factuelle courte et autonome","evidence":"courte preuve exacte"}]}'
  ].join("\n");
}

function normalizeKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeTextKnowledge(items) {
  const seen = new Set();
  const result = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    const knowledge = truncateAtTextBoundary(item?.knowledge, 500);
    const key = normalizeKey(knowledge);
    if (!knowledge || !key || seen.has(key) || isMetaDocumentReference(knowledge)) continue;
    seen.add(key);
    result.push({
      knowledge,
      evidence: String(item?.evidence || "").trim().replace(/\s+/g, " ").slice(0, 280) || null
    });
    if (result.length >= TEXT_KNOWLEDGE_MAX_ITEMS) break;
  }
  return result;
}

async function analyzeTextKnowledge({ text, sourceTitle, callOpenAI, feature = "text_knowledge_select" }) {
  const content = await callOpenAI([{ role: "user", content: buildTextKnowledgePrompt(text, sourceTitle) }], {
    model: TEXT_KNOWLEDGE_MODEL,
    temperature: 0.2,
    responseFormat: { type: "json_object" },
    timeoutMs: 60_000,
    feature
  });
  let parsed;
  try { parsed = JSON.parse(typeof content === "string" ? content : content?.content || ""); }
  catch (error) { throw new Error("Réponse de sélection texte non-JSON."); }
  const detectedTitle = String(parsed?.sourceTitle || "").trim().replace(/\s+/g, " ").slice(0, 160) || null;
  return {
    sourceTitle: sourceTitle || detectedTitle,
    knowledge: normalizeTextKnowledge(parsed?.knowledge)
  };
}

module.exports = {
  TEXT_KNOWLEDGE_MODEL,
  TEXT_KNOWLEDGE_MAX_CHARS,
  TEXT_KNOWLEDGE_MAX_ITEMS,
  validateTextKnowledgePayload,
  buildTextKnowledgePrompt,
  normalizeTextKnowledge,
  analyzeTextKnowledge
};
