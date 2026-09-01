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

function normalizeImportParentTitle(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function genericImportParentTitle(sourceType) {
  if (sourceType === "photo_import") return "Document photographié";
  if (sourceType === "pdf_import") return "Document PDF importé";
  if (sourceType === "text_import") return "Texte importé";
  if (sourceType === "manual_import") return "Apprentissage personnalisé";
  if (sourceType === "url_import") return "Page web importée";
  if (sourceType === "youtube_import") return "Vidéo YouTube importée";
  return "Connaissances importées";
}

// Défense légère seulement : le prompt reste responsable de la qualité
// linguistique. On bloque les sorties manifestement cassées sans tenter de
// « comprendre » le français ni de réécrire le titre côté serveur.
function isValidImportParentTitle(title, knowledge) {
  const normalized = normalizeImportParentTitle(title);
  if (!normalized || normalized.length > 120) return false;
  const facts = normalizeKnowledgeList(knowledge);
  if (normalized.length > 60 && facts.some((fact) => normalizeImportParentTitle(fact).toLowerCase() === normalized.toLowerCase())) {
    return false;
  }
  const separatorCount = (normalized.match(/[,;]/g) || []).length;
  if (separatorCount >= 3) return false;
  return true;
}

function buildImportParentTitleFallback(sourceTitle, knowledge, sourceType) {
  const metadataTitle = normalizeImportParentTitle(sourceTitle);
  if (isValidImportParentTitle(metadataTitle, knowledge)) return metadataTitle;
  return genericImportParentTitle(sourceType);
}

function buildMinimalPhotoSourceDetail(sourceTitle, knowledge, documentImportId, sourceType = "photo_import", sourceUrl = null, sourceMeta = null) {
  const facts = normalizeKnowledgeList(knowledge);
  const cleanTitle = normalizeImportParentTitle(sourceTitle);
  const documentTitle = buildImportParentTitleFallback(cleanTitle, facts, sourceType);
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
      ? `${titleOriginLabel(sourceType)} : « ${String(sourceTitle).trim().slice(0, 160)} ». Utilise-le seulement s'il décrit réellement l'ensemble des connaissances ; sinon synthétise leur thème commun.`
      : `${["manual_import", "text_import"].includes(sourceType) ? "Aucun titre ou thème n'a été renseigné" : "Aucun titre fiable n'a été détecté"} : synthétise le thème commun des connaissances.`,
    "Le champ title est le nom visible de l'apprentissage parent, partagé par toutes les questions du QCM.",
    "Rédige title comme une synthèse brève, explicite, naturelle et immédiatement compréhensible hors contexte, avec une terminologie française standard.",
    "Préfère un groupe nominal de 3 à 8 mots et vise 60 caractères maximum, sauf nécessité exceptionnelle. Ne tronque jamais un titre pour respecter cette longueur.",
    "Le titre doit représenter l'ensemble du QCM : ne recopie jamais arbitrairement un fait individuel, même s'il apparaît en premier.",
    "N'énumère pas les personnes, institutions, dates ou sous-thèmes et évite les formulations scolaires ou artificielles comme « Quelques notions sur… ».",
    "Évite les titres vagues comme « Histoire » ou « Politique ». Le titre de l'apprentissage n'est ni une Star taxonomique ni un Solar System et ne doit pas reprendre mécaniquement leur nom.",
    "Exemples de bons titres : « Hitler et le régime nazi », « La photosynthèse », « Les causes de la Révolution française », « L'inflation et ses mécanismes ».",
    "Exemples à éviter : « Hitler devient chancelier le 30 janvier 1933 » pour un QCM sur tout le régime ; « Hitler, NSDAP, Gestapo, SS et lois de Nuremberg » ; une phrase longue décrivant toutes les étapes du contenu.",
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
  const generatedTitle = normalizeImportParentTitle(parsed?.title);
  const title = isValidImportParentTitle(generatedTitle, facts)
    ? generatedTitle
    : buildImportParentTitleFallback(sourceTitle, facts, sourceType);
  const synthesis = String(parsed?.synthesis || "").trim().replace(/\s+/g, " ").slice(0, 1200);
  if (!title || !synthesis) throw new Error("Fiche photo IA incomplète.");

  const contextSections = (Array.isArray(parsed?.contextSections) ? parsed.contextSections : [])
    .map((section) => ({
      label: String(section?.label || "").trim().replace(/\s+/g, " ").slice(0, 80),
      text: String(section?.text || "").trim().replace(/\s+/g, " ").slice(0, 900)
    }))
    .filter((section) => section.label && section.text)
    .slice(0, 3);

  const cleanSourceTitle = normalizeImportParentTitle(sourceTitle);
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
  normalizeImportParentTitle,
  isValidImportParentTitle,
  buildImportParentTitleFallback,
  buildMinimalPhotoSourceDetail,
  buildPhotoKnowledgeSheetPrompt,
  parseGeneratedPhotoSourceDetail,
  generatePhotoKnowledgeSheet
};
