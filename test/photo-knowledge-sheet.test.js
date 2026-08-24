"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  PHOTO_KNOWLEDGE_SHEET_MODEL,
  buildPhotoDocumentImportId,
  buildMinimalPhotoSourceDetail,
  buildPhotoKnowledgeSheetPrompt,
  generatePhotoKnowledgeSheet
} = require("../lib/photo-knowledge-sheet");

test("l'identifiant commun est stable pour le même import final et change si un fait change", () => {
  const original = buildPhotoDocumentImportId("Virgile", ["Fait A", "Fait B"]);
  assert.equal(original, buildPhotoDocumentImportId(" Virgile ", ["Fait A", "Fait B"]));
  assert.notEqual(original, buildPhotoDocumentImportId("Virgile", ["Fait A modifié", "Fait B"]));
  assert.notEqual(
    buildPhotoDocumentImportId("Virgile", ["Fait A"], "https://example.test/a"),
    buildPhotoDocumentImportId("Virgile", ["Fait A"], "https://example.test/b")
  );
});

test("le prompt ne contient que le titre et les connaissances finales", () => {
  const prompt = buildPhotoKnowledgeSheetPrompt("Titre détecté", ["Fait édité", "Fait ajouté manuellement"]);
  assert.match(prompt, /Fait édité/);
  assert.match(prompt, /Fait ajouté manuellement/);
  assert.doesNotMatch(prompt, /Fait supprimé/);
  assert.match(prompt, /N'utilise aucune culture générale extérieure/);
});

test("la fiche IA conserve mot pour mot les notions finales et n'ajoute jamais d'image", async () => {
  const calls = [];
  const result = await generatePhotoKnowledgeSheet({
    sourceTitle: "Virgile et L'Énéide",
    knowledge: ["Connaissance éditée.", "Connaissance manuelle."],
    callOpenAI: async (messages, opts) => {
      calls.push({ messages, opts });
      return JSON.stringify({
        title: "Virgile et L'Énéide",
        synthesis: "Le document rassemble deux repères validés.",
        contextSections: []
      });
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.model, PHOTO_KNOWLEDGE_SHEET_MODEL);
  assert.equal(calls[0].opts.feature, "photo_knowledge_sheet");
  assert.equal(result.usedFallback, false);
  assert.equal(result.sourceDetail.image, null);
  assert.deepEqual(
    result.sourceDetail.sections.filter((section) => section.text.startsWith("• ")).map((section) => section.text),
    ["• Connaissance éditée.", "• Connaissance manuelle."]
  );
});

test("un échec IA produit une fiche globale minimale sans perdre les faits", async () => {
  const facts = ["Fait conservé.", "Autre fait conservé."];
  const result = await generatePhotoKnowledgeSheet({
    sourceTitle: null,
    knowledge: facts,
    callOpenAI: async () => { throw new Error("mock failure"); }
  });

  assert.equal(result.usedFallback, true);
  assert.equal(result.sourceDetail.image, null);
  assert.deepEqual(
    result.sourceDetail.sections.filter((section) => section.text.startsWith("• ")).map((section) => section.text),
    facts.map((fact) => `• ${fact}`)
  );
});

test("la fiche minimale porte le même identifiant documentaire et toutes les notions", () => {
  const facts = ["A", "B", "C"];
  const importId = buildPhotoDocumentImportId("Document", facts);
  const detail = buildMinimalPhotoSourceDetail("Document", facts, importId);
  assert.equal(detail.documentImportId, importId);
  assert.equal(detail.documentTitle, "Document");
  assert.equal(detail.image, null);
  assert.equal(detail.sections.filter((section) => section.text.startsWith("• ")).length, 3);
});

test("le câblage serveur partage la fiche mais conserve un slot et une question par fait", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(source, /const documentImportId = buildPhotoDocumentImportId\(sourceTitle, finalKnowledge, sourceUrl\)/);
  assert.match(source, /const slot = `notion:\$\{sourceType\}:\$\{documentImportId\}:\$\{item\.id\}`/);
  assert.match(source, /sourceDetail: sharedSourceDetail/);
  assert.match(source, /id: `notion:\$\{sourceType\}:\$\{documentImportId\}:\$\{id\}-q1`/);
  assert.match(source, /sourceDebateId: id/);
});

test("photo et manuel utilisent la même orchestration avec deux provenances explicites", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(source, /addValidatedKnowledgeImport\(\{ body: req\.body, sourceType: "photo_import"/);
  assert.match(source, /addValidatedKnowledgeImport\(\{ body: req\.body, sourceType: "manual_import"/);
});

test("le mode manuel garde un titre facultatif et une fiche sans image", async () => {
  const result = await generatePhotoKnowledgeSheet({
    sourceTitle: "Révolution française",
    sourceType: "manual_import",
    knowledge: ["La République est proclamée en septembre 1792."],
    callOpenAI: async () => { throw new Error("mock failure"); }
  });
  assert.equal(result.usedFallback, true);
  assert.equal(result.sourceDetail.documentTitle, "Révolution française");
  assert.equal(result.sourceDetail.meta, "Thème renseigné manuellement");
  assert.equal(result.sourceDetail.image, null);
});

test("la fiche PDF réutilise la fiche globale, sans image et avec son instrumentation", async () => {
  const calls = [];
  const result = await generatePhotoKnowledgeSheet({
    sourceTitle: "Cours PDF",
    sourceType: "pdf_import",
    knowledge: ["Fait PDF validé."],
    callOpenAI: async (messages, opts) => {
      calls.push({ messages, opts });
      return JSON.stringify({ title: "Cours PDF", synthesis: "Une synthèse ancrée.", contextSections: [] });
    }
  });
  assert.equal(calls[0].opts.feature, "pdf_knowledge_sheet");
  assert.equal(result.sourceDetail.meta, "Document PDF importé");
  assert.equal(result.sourceDetail.image, null);
  assert.equal(result.sourceDetail.sections.find((section) => section.text.startsWith("• ")).text, "• Fait PDF validé.");
});

test("la fiche texte conserve les faits validés et utilise sa feature dédiée", async () => {
  const calls = [];
  const result = await generatePhotoKnowledgeSheet({
    sourceTitle: "Biologie",
    sourceType: "text_import",
    knowledge: ["Fait texte validé."],
    callOpenAI: async (messages, opts) => {
      calls.push({ messages, opts });
      return JSON.stringify({ title: "Biologie", synthesis: "Une synthèse ancrée.", contextSections: [] });
    }
  });
  assert.equal(calls[0].opts.feature, "text_knowledge_sheet");
  assert.equal(result.sourceDetail.meta, "Texte importé");
  assert.equal(result.sourceDetail.image, null);
  assert.equal(result.sourceDetail.sections.find((section) => section.text.startsWith("• ")).text, "• Fait texte validé.");
});

test("la fiche URL conserve uniquement l'URL finale, les faits et aucune image", async () => {
  const result = await generatePhotoKnowledgeSheet({
    sourceTitle: "Page pédagogique",
    sourceType: "url_import",
    sourceUrl: "https://example.test/final",
    knowledge: ["Fait web validé."],
    callOpenAI: async (messages, opts) => JSON.stringify({ title: "Page pédagogique", synthesis: "Synthèse ancrée.", contextSections: [] })
  });
  assert.equal(result.sourceDetail.sourceUrl, "https://example.test/final");
  assert.equal(result.sourceDetail.meta, "Page web importée");
  assert.equal(result.sourceDetail.image, null);
  assert.equal(result.sourceDetail.sections.find((section) => section.text.startsWith("• ")).text, "• Fait web validé.");
});

test("la fiche YouTube conserve la provenance, la chaîne, la durée et aucune image", async () => {
  const result = await generatePhotoKnowledgeSheet({
    sourceTitle: "Cours filmé",
    sourceType: "youtube_import",
    sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    sourceMeta: { sourceAuthor: "Chaîne pédagogique", durationSeconds: 1800 },
    knowledge: ["Fait validé mot pour mot."],
    callOpenAI: async () => JSON.stringify({ title: "Cours filmé", synthesis: "Synthèse ancrée.", contextSections: [] })
  });
  assert.equal(result.sourceDetail.meta, "Vidéo YouTube importée");
  assert.equal(result.sourceDetail.sourceAuthor, "Chaîne pédagogique");
  assert.equal(result.sourceDetail.durationSeconds, 1800);
  assert.equal(result.sourceDetail.image, null);
  assert.equal(result.sourceDetail.sections.find((section) => section.text.startsWith("• ")).text, "• Fait validé mot pour mot.");
});

test("l'éditeur partagé bascule vers la route manuelle sans sauvegarde anticipée", () => {
  const view = fs.readFileSync(path.join(__dirname, "..", "views", "photo-knowledge.html"), "utf8");
  assert.match(view, /window\.location\.pathname === "\/manual-knowledge"/);
  for (const route of ["manual", "pdf", "text", "url", "youtube", "photo"]) {
    assert.match(view, new RegExp(`/api/${route}-knowledge/add`));
  }
  assert.match(view, /pk-manual-title-input/);
  assert.match(view, /if \(count >= currentMaxKnowledge\)/);
  assert.match(view, /if \(selected\.length > currentMaxKnowledge\)/);
  assert.doesNotMatch(view, /fetch\("\/api\/manual-knowledge\/add"[\s\S]*appendKnowledgeRow/);
});
