"use strict";

const crypto = require("crypto");
const {
  SELECTION_RULE_LINES,
  CALIBRATION_EXAMPLES,
  isMetaDocumentReference
} = require("./photo-knowledge");
const { splitTextAtBoundaries, truncateAtTextBoundary } = require("./text-boundaries");

const PDF_KNOWLEDGE_MODEL = "gpt-4o-mini";
const PDF_MAX_BYTES = 20 * 1024 * 1024;
const PDF_MAX_PAGES = 100;
const PDF_BLOCK_MAX_CHARS = 14_000;
const PDF_ANALYSIS_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

function knowledgeLimitForPageCount(pageCount) {
  const count = Number(pageCount);
  if (!Number.isInteger(count) || count < 1) throw new Error("Nombre de pages PDF invalide.");
  if (count <= 5) return 20;
  if (count <= 15) return 40;
  if (count <= 30) return 60;
  return 100;
}

function decodePdfDataUrl(dataUrl, mimeType) {
  if (mimeType !== "application/pdf") throw Object.assign(new Error("Le fichier doit être un PDF."), { code: "invalid_mime" });
  const match = /^data:application\/pdf;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(String(dataUrl || ""));
  if (!match) throw Object.assign(new Error("Données PDF invalides."), { code: "invalid_pdf" });
  const buffer = Buffer.from(match[1].replace(/\s/g, ""), "base64");
  if (!buffer.length || buffer.length > PDF_MAX_BYTES) {
    throw Object.assign(new Error(`Le PDF doit faire au maximum ${PDF_MAX_BYTES / 1024 / 1024} Mo.`), { code: "pdf_too_large" });
  }
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw Object.assign(new Error("Le contenu du fichier n'est pas un PDF valide."), { code: "invalid_pdf" });
  }
  return buffer;
}

function normalizePageText(items) {
  return (Array.isArray(items) ? items : []).map((item) => String(item?.str || "")).join(" ").replace(/\s+/g, " ").trim();
}

async function extractPdfPages(buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true, useSystemFonts: true });
  const document = await loadingTask.promise;
  try {
    if (document.numPages > PDF_MAX_PAGES) {
      throw Object.assign(new Error(`Ce PDF contient ${document.numPages} pages. La limite V1 est de ${PDF_MAX_PAGES} pages.`), { code: "pdf_too_long", pageCount: document.numPages });
    }
    let sourceTitle = null;
    try {
      const metadata = await document.getMetadata();
      sourceTitle = String(metadata?.info?.Title || "").trim().replace(/\s+/g, " ").slice(0, 160) || null;
    } catch (error) {}
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push({ pageNumber, text: normalizePageText(content.items) });
      page.cleanup();
    }
    return { pageCount: document.numPages, sourceTitle, pages };
  } finally {
    await document.destroy();
  }
}

function hasUsablePdfText(pages) {
  const text = (pages || []).map((page) => page.text || "").join(" ").replace(/\s+/g, "").trim();
  return text.length >= 40;
}

function buildPdfBlocks(pages, maxChars = PDF_BLOCK_MAX_CHARS) {
  const blocks = [];
  let current = null;
  for (const page of (pages || [])) {
    const text = String(page?.text || "").trim();
    if (!text) continue;
    const pageNumber = Number(page.pageNumber);
    // Une page très dense est elle-même découpée : aucun prompt ne reçoit
    // silencieusement une page entière dépassant la taille de bloc.
    for (const fragment of splitTextAtBoundaries(text, Math.max(1, maxChars - 32), 300)) {
      if (!current || current.text.length + fragment.length + 24 > maxChars) {
        current = { startPage: pageNumber, endPage: pageNumber, text: "" };
        blocks.push(current);
      }
      current.endPage = pageNumber;
      current.text += `${current.text ? "\n\n" : ""}[Page ${pageNumber}]\n${fragment}`;
    }
  }
  return blocks;
}

function buildPdfSelectionPrompt(block, sourceTitle, maxKnowledge) {
  return [
    "Tu sélectionnes des connaissances à partir d'un bloc de texte extrait localement d'un PDF. Tu te bases UNIQUEMENT sur ce texte : aucun savoir extérieur, aucune supposition.",
    sourceTitle ? `Titre PDF : ${sourceTitle}` : "Aucun titre PDF fiable.",
    `Pages du bloc : ${block.startPage} à ${block.endPage}.`,
    "", "Texte extrait :", '"""', block.text, '"""', "",
    ...SELECTION_RULE_LINES,
    "", "Exemples de calibrage :",
    ...CALIBRATION_EXAMPLES.flatMap((ex) => [`- ${ex.text} → ${ex.verdict}`, ...(ex.forbidden || []).map((value) => `  Interdit : ${value}`)]),
    "",
    `Retourne au maximum ${maxKnowledge} connaissances pour ce bloc. C'est un plafond, jamais un objectif. knowledge: [] est valide et préférable à une connaissance forcée.`,
    "Pour chaque connaissance, donne une evidence très courte copiée du bloc.",
    "Réponds uniquement en JSON strict :",
    '{"knowledge":[{"knowledge":"phrase factuelle courte et autonome","evidence":"courte preuve textuelle"}]}'
  ].join("\n");
}

function normalizeFactKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function deduplicatePdfKnowledge(items, limit) {
  const seen = new Set();
  const result = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    const knowledge = truncateAtTextBoundary(item?.knowledge, 500);
    const key = normalizeFactKey(knowledge);
    if (!knowledge || !key || seen.has(key) || isMetaDocumentReference(knowledge)) continue;
    seen.add(key);
    result.push({ knowledge, evidence: String(item?.evidence || "").trim().replace(/\s+/g, " ").slice(0, 280) || null });
    if (result.length >= limit) break;
  }
  return result;
}

async function analyzePdfKnowledge({ buffer, callOpenAI, extractPages = extractPdfPages }) {
  const extracted = await extractPages(buffer);
  if (extracted.pageCount > PDF_MAX_PAGES) throw Object.assign(new Error(`La limite V1 est de ${PDF_MAX_PAGES} pages.`), { code: "pdf_too_long" });
  const maxKnowledge = knowledgeLimitForPageCount(extracted.pageCount);
  if (!hasUsablePdfText(extracted.pages)) {
    return { status: "scan_not_supported", sourceTitle: extracted.sourceTitle || null, pageCount: extracted.pageCount, maxKnowledge, blockCount: 0, knowledge: [] };
  }
  const blocks = buildPdfBlocks(extracted.pages);
  const candidates = [];
  for (const block of blocks) {
    const content = await callOpenAI([{ role: "user", content: buildPdfSelectionPrompt(block, extracted.sourceTitle, Math.min(20, maxKnowledge)) }], {
      model: PDF_KNOWLEDGE_MODEL,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
      timeoutMs: 60_000,
      feature: "pdf_knowledge_select"
    });
    let parsed;
    try { parsed = JSON.parse(typeof content === "string" ? content : content?.content || ""); }
    catch (error) { throw new Error("Réponse de sélection PDF non-JSON."); }
    candidates.push(...(Array.isArray(parsed.knowledge) ? parsed.knowledge : []));
  }
  return {
    status: "ok",
    sourceTitle: extracted.sourceTitle || null,
    pageCount: extracted.pageCount,
    maxKnowledge,
    blockCount: blocks.length,
    knowledge: deduplicatePdfKnowledge(candidates, maxKnowledge)
  };
}

function createPdfAnalysisToken(payload, secret, now = Date.now()) {
  if (!secret) throw new Error("Secret de signature PDF manquant.");
  const encoded = Buffer.from(JSON.stringify({ pageCount: payload.pageCount, maxKnowledge: payload.maxKnowledge, issuedAt: now })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyPdfAnalysisToken(token, secret, now = Date.now()) {
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature || !secret) throw new Error("Jeton d'analyse PDF invalide.");
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error("Jeton d'analyse PDF invalide.");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!Number.isInteger(payload.pageCount) || payload.maxKnowledge !== knowledgeLimitForPageCount(payload.pageCount) || now - payload.issuedAt > PDF_ANALYSIS_TOKEN_TTL_MS || payload.issuedAt > now + 60_000) {
    throw new Error("Jeton d'analyse PDF expiré ou invalide.");
  }
  return payload;
}

module.exports = {
  PDF_KNOWLEDGE_MODEL,
  PDF_MAX_BYTES,
  PDF_MAX_PAGES,
  knowledgeLimitForPageCount,
  decodePdfDataUrl,
  extractPdfPages,
  hasUsablePdfText,
  buildPdfBlocks,
  buildPdfSelectionPrompt,
  deduplicatePdfKnowledge,
  analyzePdfKnowledge,
  createPdfAnalysisToken,
  verifyPdfAnalysisToken
};
