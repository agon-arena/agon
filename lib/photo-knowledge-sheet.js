"use strict";

// Fiche documentaire TEXTUELLE créée après validation humaine des faits.
// Aucun octet d'image ni transcription n'entre dans ce module : les seules
// sources factuelles autorisées sont le titre détecté et les connaissances
// finales (éditées/supprimées/ajoutées) reçues par la route d'écriture.

const crypto = require("crypto");

const PHOTO_KNOWLEDGE_SHEET_MODEL = "gpt-4o-mini";

function normalizeKnowledgeList(knowledge) {
  return (Array.isArray(knowledge) ? knowledge : [])
    .map((fact) => String(fact || "").trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

function buildPhotoDocumentImportId(sourceTitle, knowledge, sourceIdentity = null) {
  const normalizedTitle = String(sourceTitle || "").trim().toLowerCase().replace(/\s+/g, " ");
  const normalizedFacts = normalizeKnowledgeList(knowledge).map((fact) => fact.toLowerCase());
  const identityPayload = { title: normalizedTitle, knowledge: normalizedFacts };
  const normalizedSourceIdentity = String(sourceIdentity || "").trim();
  // Conserve exactement l'ancien hash pour les imports sans URL déjà stockés.
  if (normalizedSourceIdentity) identityPayload.sourceIdentity = normalizedSourceIdentity;
  return crypto.createHash("sha1")
    .update(JSON.stringify(identityPayload))
    .digest("hex")
    .slice(0, 20);
}

function buildNotionsSections(facts) {
  return facts.map((fact, index) => ({
    label: index === 0 ? "Notions à retenir" : null,
    // Le marqueur est purement visuel. Le texte du fait reste recopié
    // exactement depuis la validation utilisateur, jamais depuis l'IA.
    text: `• ${fact}`
  }));
}

function importOriginMeta(sourceType, hasTitle) {
  if (sourceType === "manual_import") return hasTitle ? "Thème renseigné manuellement" : "Ajout manuel";
  if (sourceType === "pdf_import") return hasTitle ? "Document PDF importé" : "Import PDF";
  if (sourceType === "text_import") return hasTitle ? "Texte importé" : "Import texte";
  if (sourceType === "url_import") return hasTitle ? "Page web importée" : "Import web";
  if (sourceType === "youtube_import") return hasTitle ? "Vidéo YouTube importée" : "Import YouTube";
  return hasTitle ? "Document importé depuis une photo" : "Import personnel";
}

function titleOriginLabel(sourceType, short = false) {
  if (sourceType === "manual_import") return short ? "Thème renseigné" : "Thème facultatif renseigné par l'utilisateur";
  if (sourceType === "text_import") return short ? "Titre ou thème renseigné" : "Titre ou thème facultatif fourni par l'utilisateur";
  return short ? "Titre détecté" : "Titre détecté sur le document";
}

function buildMinimalPhotoSourceDetail(sourceTitle, knowledge, documentImportId, sourceType = "photo_import", sourceUrl = null, sourceMeta = null) {
  const facts = normalizeKnowledgeList(knowledge);
  const cleanTitle = String(sourceTitle || "").trim().replace(/\s+/g, " ").slice(0, 160);
  const documentTitle = cleanTitle || (facts[0] ? facts[0].slice(0, 120) : "Document importé");
  return {
    documentImportId,
    documentTitle,
    meta: importOriginMeta(sourceType, Boolean(cleanTitle)),
    sections: [
      {
        label: "Synthèse",
        text: "Cette fiche regroupe les connaissances validées à partir du document importé."
      },
      ...buildNotionsSections(facts)
    ],
    image: null,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(sourceMeta?.sourceAuthor ? { sourceAuthor: sourceMeta.sourceAuthor } : {}),
    ...(sourceMeta?.durationSeconds ? { durationSeconds: sourceMeta.durationSeconds } : {})
  };
}

function buildPhotoKnowledgeSheetPrompt(sourceTitle, knowledge, sourceType = "photo_import") {
  const facts = normalizeKnowledgeList(knowledge);
  return [
    "Tu rédiges une fiche documentaire courte en français à partir de connaissances déjà validées par l'utilisateur.",
    "Ces connaissances sont IMMUTABLES : tu ne dois ni les corriger, ni les enrichir, ni en déduire de nouveaux faits.",
    "N'utilise aucune culture générale extérieure. Toute affirmation factuelle de la synthèse ou du contexte doit être directement justifiée par les connaissances fournies.",
    "Tu peux uniquement organiser, relier et expliquer ce que ces phrases disent déjà explicitement. Si un contexte utile exigerait une information absente, ne crée pas cette section.",
    "Ne produis jamais de section pour remplir. Pour une ou deux connaissances simples, une synthèse très courte et aucun contexte supplémentaire sont normaux.",
    "Le tableau exact des notions sera ajouté ensuite par le serveur : ne le recopie pas dans synthesis/contextSections.",
    sourceTitle
      ? `${titleOriginLabel(sourceType)} : « ${String(sourceTitle).trim().slice(0, 160)} ». Utilise-le comme titre seulement s'il décrit réellement l'ensemble des connaissances ; sinon propose un titre court strictement dérivé d'elles.`
      : `${["manual_import", "text_import"].includes(sourceType) ? "Aucun titre ou thème n'a été renseigné" : "Aucun titre fiable n'a été détecté"} : propose un titre court strictement dérivé des connaissances.`,
    "",
    "Connaissances finales validées :",
    ...facts.map((fact, index) => `${index + 1}. ${fact}`),
    "",
    "Réponds uniquement en JSON strict sous la forme :",
    '{"title":"titre court","synthesis":"2 à 5 phrases maximum, moins si le contenu est simple","contextSections":[{"label":"intitulé court","text":"petit paragraphe strictement ancré"}]}'
  ].join("\n");
}

function parseGeneratedPhotoSourceDetail(rawContent, sourceTitle, knowledge, documentImportId, sourceType = "photo_import", sourceUrl = null, sourceMeta = null) {
  const facts = normalizeKnowledgeList(knowledge);
  const parsed = JSON.parse(rawContent);
  const title = String(parsed?.title || "").trim().replace(/\s+/g, " ").slice(0, 160);
  const synthesis = String(parsed?.synthesis || "").trim().replace(/\s+/g, " ").slice(0, 1200);
  if (!title || !synthesis) throw new Error("Fiche photo IA incomplète.");

  const contextSections = (Array.isArray(parsed?.contextSections) ? parsed.contextSections : [])
    .map((section) => ({
      label: String(section?.label || "").trim().replace(/\s+/g, " ").slice(0, 80),
      text: String(section?.text || "").trim().replace(/\s+/g, " ").slice(0, 900)
    }))
    .filter((section) => section.label && section.text)
    .slice(0, 3);

  const cleanSourceTitle = String(sourceTitle || "").trim().replace(/\s+/g, " ").slice(0, 160);
  return {
    documentImportId,
    documentTitle: title,
    meta: cleanSourceTitle && cleanSourceTitle !== title
      ? `${titleOriginLabel(sourceType, true)} : ${cleanSourceTitle}`
      : importOriginMeta(sourceType, Boolean(cleanSourceTitle)),
    sections: [
      { label: "Synthèse", text: synthesis },
      ...buildNotionsSections(facts),
      ...contextSections
    ],
    // Règle produit absolue : ni recherche d'illustration, ni photo originale.
    image: null,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(sourceMeta?.sourceAuthor ? { sourceAuthor: sourceMeta.sourceAuthor } : {}),
    ...(sourceMeta?.durationSeconds ? { durationSeconds: sourceMeta.durationSeconds } : {})
  };
}

async function generatePhotoKnowledgeSheet({ sourceTitle, knowledge, callOpenAI, sourceType = "photo_import", sourceUrl = null, sourceMeta = null }) {
  const facts = normalizeKnowledgeList(knowledge);
  const documentImportId = buildPhotoDocumentImportId(sourceTitle, facts, sourceUrl);
  const fallback = buildMinimalPhotoSourceDetail(sourceTitle, facts, documentImportId, sourceType, sourceUrl, sourceMeta);
  if (!facts.length || typeof callOpenAI !== "function") {
    return { sourceDetail: fallback, usedFallback: true };
  }

  try {
    const content = await callOpenAI([{
      role: "user",
      content: buildPhotoKnowledgeSheetPrompt(sourceTitle, facts, sourceType)
    }], {
      model: PHOTO_KNOWLEDGE_SHEET_MODEL,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
      feature: sourceType === "pdf_import"
        ? "pdf_knowledge_sheet"
        : (sourceType === "text_import" ? "text_knowledge_sheet" : (sourceType === "url_import" ? "url_knowledge_sheet" : (sourceType === "youtube_import" ? "youtube_knowledge_sheet" : "photo_knowledge_sheet")))
    });
    return {
      sourceDetail: parseGeneratedPhotoSourceDetail(content, sourceTitle, facts, documentImportId, sourceType, sourceUrl, sourceMeta),
      usedFallback: false
    };
  } catch (error) {
    return { sourceDetail: fallback, usedFallback: true, error };
  }
}

module.exports = {
  PHOTO_KNOWLEDGE_SHEET_MODEL,
  normalizeKnowledgeList,
  buildPhotoDocumentImportId,
  buildMinimalPhotoSourceDetail,
  buildPhotoKnowledgeSheetPrompt,
  parseGeneratedPhotoSourceDetail,
  generatePhotoKnowledgeSheet
};
