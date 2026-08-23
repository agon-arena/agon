"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCanvas } = require("canvas");
const {
  PDF_KNOWLEDGE_MODEL,
  PDF_MAX_BYTES,
  knowledgeLimitForPageCount,
  decodePdfDataUrl,
  extractPdfPages,
  buildPdfBlocks,
  deduplicatePdfKnowledge,
  analyzePdfKnowledge,
  createPdfAnalysisToken,
  verifyPdfAnalysisToken
} = require("../lib/pdf-knowledge");

test("le plafond PDF est adaptatif aux bornes demandées", () => {
  assert.equal(knowledgeLimitForPageCount(1), 20);
  assert.equal(knowledgeLimitForPageCount(5), 20);
  assert.equal(knowledgeLimitForPageCount(6), 40);
  assert.equal(knowledgeLimitForPageCount(15), 40);
  assert.equal(knowledgeLimitForPageCount(16), 60);
  assert.equal(knowledgeLimitForPageCount(30), 60);
  assert.equal(knowledgeLimitForPageCount(31), 100);
  assert.equal(knowledgeLimitForPageCount(100), 100);
});

test("le dataUrl exige application/pdf, une signature PDF et la limite de taille", () => {
  const valid = Buffer.from("%PDF-1.7\nmock");
  assert.deepEqual(decodePdfDataUrl(`data:application/pdf;base64,${valid.toString("base64")}`, "application/pdf"), valid);
  assert.throws(() => decodePdfDataUrl(`data:application/pdf;base64,${valid.toString("base64")}`, "image/png"), /doit être un PDF/);
  const fake = Buffer.from("not a pdf");
  assert.throws(() => decodePdfDataUrl(`data:application/pdf;base64,${fake.toString("base64")}`, "application/pdf"), /n'est pas un PDF/);
  const oversized = Buffer.alloc(PDF_MAX_BYTES + 1, 0x20);
  oversized.write("%PDF-");
  assert.throws(() => decodePdfDataUrl(`data:application/pdf;base64,${oversized.toString("base64")}`, "application/pdf"), /maximum/);
});

test("PDF.js ouvre réellement un PDF simple en mémoire sans fichier temporaire", async () => {
  const canvas = createCanvas(500, 300, "pdf");
  const context = canvas.getContext("2d");
  context.font = "18px sans-serif";
  context.fillText("La photosynthèse utilise l'énergie lumineuse.", 24, 60);
  const extracted = await extractPdfPages(canvas.toBuffer("application/pdf"));
  assert.equal(extracted.pageCount, 1);
  assert.equal(extracted.pages.length, 1);
});

test("les pages sont regroupées en plusieurs blocs bornés", () => {
  const blocks = buildPdfBlocks([
    { pageNumber: 1, text: "A".repeat(80) },
    { pageNumber: 2, text: "B".repeat(80) },
    { pageNumber: 3, text: "C".repeat(80) }
  ], 150);
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks.map((block) => block.startPage), [1, 2, 3]);
});

test("l'analyse sélectionne chaque bloc avec gpt-4o-mini puis déduplique globalement", async () => {
  const calls = [];
  const result = await analyzePdfKnowledge({
    buffer: Buffer.from("ignored"),
    extractPages: async () => ({
      pageCount: 6,
      sourceTitle: "Cours",
      pages: [{ pageNumber: 1, text: "A".repeat(9000) }, { pageNumber: 2, text: "B".repeat(9000) }]
    }),
    callOpenAI: async (messages, opts) => {
      calls.push({ messages, opts });
      return JSON.stringify({ knowledge: [{ knowledge: "Fait unique.", evidence: "preuve" }] });
    }
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.opts.model === PDF_KNOWLEDGE_MODEL && call.opts.feature === "pdf_knowledge_select"));
  assert.equal(result.maxKnowledge, 40);
  assert.equal(result.knowledge.length, 1);
});

test("un PDF texte simple est accepté par le pipeline", async () => {
  const result = await analyzePdfKnowledge({
    buffer: Buffer.from("ignored"),
    extractPages: async () => ({ pageCount: 1, sourceTitle: "Biologie", pages: [{ pageNumber: 1, text: "La photosynthèse utilise l'énergie lumineuse pour produire de la matière organique." }] }),
    callOpenAI: async () => JSON.stringify({ knowledge: [{ knowledge: "La photosynthèse utilise l'énergie lumineuse pour produire de la matière organique.", evidence: "utilise l'énergie lumineuse" }] })
  });
  assert.equal(result.status, "ok");
  assert.equal(result.pageCount, 1);
  assert.equal(result.knowledge.length, 1);
});

test("knowledge vide est valide et un PDF sans texte retourne scan_not_supported sans IA", async () => {
  let calls = 0;
  const result = await analyzePdfKnowledge({
    buffer: Buffer.from("ignored"),
    extractPages: async () => ({ pageCount: 2, sourceTitle: null, pages: [{ pageNumber: 1, text: "" }, { pageNumber: 2, text: " " }] }),
    callOpenAI: async () => { calls += 1; return "{}"; }
  });
  assert.equal(result.status, "scan_not_supported");
  assert.deepEqual(result.knowledge, []);
  assert.equal(calls, 0);

  const empty = await analyzePdfKnowledge({
    buffer: Buffer.from("ignored"),
    extractPages: async () => ({ pageCount: 1, sourceTitle: null, pages: [{ pageNumber: 1, text: "Texte exploitable suffisamment long pour être analysé sans connaissance utile." }] }),
    callOpenAI: async () => JSON.stringify({ knowledge: [] })
  });
  assert.equal(empty.status, "ok");
  assert.deepEqual(empty.knowledge, []);
});

test("la déduplication est textuelle normalisée et conserve l'ordre", () => {
  assert.deepEqual(deduplicatePdfKnowledge([
    { knowledge: "Énée est un héros.", evidence: "A" },
    { knowledge: "enee est un heros", evidence: "B" },
    { knowledge: "Le Latium est une région.", evidence: "C" }
  ], 10).map((item) => item.knowledge), ["Énée est un héros.", "Le Latium est une région."]);
});

test("le jeton signé protège le plafond serveur et expire", () => {
  const secret = "test-secret";
  const token = createPdfAnalysisToken({ pageCount: 16, maxKnowledge: 60 }, secret, 1_000);
  assert.equal(verifyPdfAnalysisToken(token, secret, 2_000).maxKnowledge, 60);
  assert.throws(() => verifyPdfAnalysisToken(token + "x", secret, 2_000), /invalide/);
  assert.throws(() => verifyPdfAnalysisToken(token, secret, 3 * 60 * 60 * 1000), /expiré/);
});
