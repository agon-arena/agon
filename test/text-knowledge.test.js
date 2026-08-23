"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  TEXT_KNOWLEDGE_MODEL,
  TEXT_KNOWLEDGE_MAX_CHARS,
  validateTextKnowledgePayload,
  buildTextKnowledgePrompt,
  normalizeTextKnowledge,
  analyzeTextKnowledge
} = require("../lib/text-knowledge");

test("un texte simple et son titre facultatif sont validés sans troncature", () => {
  assert.deepEqual(validateTextKnowledgePayload({ text: "  La Terre tourne autour du Soleil.  ", sourceTitle: " Astronomie " }), {
    text: "La Terre tourne autour du Soleil.",
    sourceTitle: "Astronomie"
  });
  assert.equal(validateTextKnowledgePayload({ text: "Texte valide", sourceTitle: "" }).sourceTitle, null);
});

test("les mauvais payloads et la limite de 50 000 caractères sont refusés", () => {
  assert.throws(() => validateTextKnowledgePayload(null), /Payload invalide/);
  assert.throws(() => validateTextKnowledgePayload({ text: 42 }), /obligatoire/);
  assert.throws(() => validateTextKnowledgePayload({ text: "ok" }), /trop court/);
  assert.throws(() => validateTextKnowledgePayload({ text: "Texte valide", sourceTitle: {} }), /titre doit être un texte/);
  assert.equal(validateTextKnowledgePayload({ text: "A".repeat(TEXT_KNOWLEDGE_MAX_CHARS) }).text.length, TEXT_KNOWLEDGE_MAX_CHARS);
  assert.throws(() => validateTextKnowledgePayload({ text: "A".repeat(TEXT_KNOWLEDGE_MAX_CHARS + 1) }), /dépasse/);
});

test("le prompt réutilise les règles strictes et accepte knowledge vide", () => {
  const prompt = buildTextKnowledgePrompt("Premier paragraphe.\n\nSecond paragraphe.", null);
  assert.match(prompt, /GROUNDING EXACT/);
  assert.match(prompt, /knowledge: \[\]/);
  assert.match(prompt, /maximum 20 connaissances/);
  assert.match(prompt, /Premier paragraphe/);
});

test("l'analyse utilise gpt-4o-mini, la feature dédiée et respecte le titre utilisateur", async () => {
  const calls = [];
  const result = await analyzeTextKnowledge({
    text: "La photosynthèse utilise l'énergie lumineuse.",
    sourceTitle: "Biologie",
    callOpenAI: async (messages, opts) => {
      calls.push({ messages, opts });
      return JSON.stringify({ sourceTitle: "Titre IA ignoré", knowledge: [{ knowledge: "La photosynthèse utilise l'énergie lumineuse.", evidence: "utilise l'énergie lumineuse" }] });
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.model, TEXT_KNOWLEDGE_MODEL);
  assert.equal(calls[0].opts.feature, "text_knowledge_select");
  assert.equal(result.sourceTitle, "Biologie");
  assert.equal(result.knowledge.length, 1);
});

test("un titre peut être détecté et knowledge: [] reste un succès", async () => {
  const result = await analyzeTextKnowledge({
    text: "Texte sans connaissance mémorisable.",
    sourceTitle: null,
    callOpenAI: async () => JSON.stringify({ sourceTitle: "Notes", knowledge: [] })
  });
  assert.equal(result.sourceTitle, "Notes");
  assert.deepEqual(result.knowledge, []);
});

test("la normalisation déduplique et impose vingt connaissances", () => {
  const items = [
    { knowledge: "Énée est un héros.", evidence: "A" },
    { knowledge: "enee est un heros", evidence: "B" },
    ...Array.from({ length: 25 }, (_, index) => ({ knowledge: `Fait distinct ${index}.`, evidence: "preuve" }))
  ];
  const result = normalizeTextKnowledge(items);
  assert.equal(result.length, 20);
  assert.equal(result[0].knowledge, "Énée est un héros.");
});

test("le serveur et l'éditeur raccordent text_import sans écriture dans la route d'analyse", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const view = fs.readFileSync(path.join(__dirname, "..", "views", "photo-knowledge.html"), "utf8");
  assert.match(server, /app\.post\("\/api\/text-knowledge\/analyze"/);
  assert.match(server, /app\.post\("\/api\/text-knowledge\/add"/);
  assert.match(server, /sourceType: "text_import"/);
  const analysisRoute = server.slice(server.indexOf('app.post("/api/text-knowledge/analyze"'), server.indexOf("// ÉCRITURE séparée"));
  assert.doesNotMatch(analysisRoute, /\.from\(|insert\(|upsert\(|MemoryItem|FSRS/);
  assert.match(view, /window\.location\.pathname === "\/text-knowledge"/);
  assert.match(view, /maxlength="160"/);
  assert.doesNotMatch(view, /id="pk-source-text-input"[^>]*maxlength/);
  assert.match(view, /count > 50000/);
  assert.match(view, /"\/api\/text-knowledge\/analyze"/);
  assert.match(view, /"\/api\/text-knowledge\/add"/);
});
