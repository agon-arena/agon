"use strict";

const crypto = require("crypto");
const { YoutubeTranscript } = require("youtube-transcript");
const { SELECTION_RULE_LINES, CALIBRATION_EXAMPLES, isMetaDocumentReference } = require("./photo-knowledge");
const { truncateAtTextBoundary } = require("./text-boundaries");

const YOUTUBE_KNOWLEDGE_MODEL = "gpt-4o-mini";
const YOUTUBE_MAX_DURATION_SECONDS = 2 * 60 * 60;
const YOUTUBE_MAX_TRANSCRIPT_CHARS = 180_000;
const YOUTUBE_BLOCK_MAX_CHARS = 14_000;
const YOUTUBE_ANALYSIS_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

class YoutubeKnowledgeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function parseYoutubeVideoUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl || "").trim()); }
  catch (error) { throw new YoutubeKnowledgeError("invalid_url", "URL YouTube invalide."); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new YoutubeKnowledgeError("invalid_url", "URL YouTube invalide.");
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let videoId = null;
  if (["youtube.com", "m.youtube.com"].includes(host)) {
    if (parsed.pathname === "/watch") videoId = parsed.searchParams.get("v");
    else {
      const match = /^\/shorts\/([^/?#]+)\/?$/.exec(parsed.pathname);
      if (match) videoId = match[1];
    }
  } else if (host === "youtu.be") {
    const match = /^\/([^/?#]+)\/?$/.exec(parsed.pathname);
    if (match) videoId = match[1];
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ""))) {
    throw new YoutubeKnowledgeError("invalid_url", "Colle le lien d'une seule vidéo YouTube, sans playlist ni chaîne.");
  }
  return { videoId, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}` };
}

function decodeTranscriptText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\[(?:music|musique|applause|applaudissements|laughter|rires|silence)\]/gi, " ")
    .replace(/\s+/g, " ").trim();
}

function normalizeTranscript(segments) {
  const cleaned = [];
  let previous = "";
  for (const segment of (Array.isArray(segments) ? segments : [])) {
    const text = decodeTranscriptText(segment?.text);
    if (!text || text === previous) continue;
    previous = text;
    cleaned.push({ text, offset: Math.max(0, Number(segment?.offset) || 0), duration: Math.max(0, Number(segment?.duration) || 0) });
  }
  const durationSeconds = cleaned.reduce((max, item) => Math.max(max, item.offset + item.duration), 0);
  return { segments: cleaned, durationSeconds: Math.ceil(durationSeconds), text: cleaned.map((item) => item.text).join(" ") };
}

function knowledgeLimitForYoutube(durationSeconds, transcriptChars = 0) {
  const duration = Number(durationSeconds);
  if (duration > 0) {
    if (duration <= 10 * 60) return 20;
    if (duration <= 30 * 60) return 40;
    if (duration <= 60 * 60) return 60;
    return 100;
  }
  const chars = Number(transcriptChars) || 0;
  if (chars <= 15_000) return 20;
  if (chars <= 45_000) return 40;
  if (chars <= 90_000) return 60;
  return 100;
}

function buildYoutubeBlocks(segments, maxChars = YOUTUBE_BLOCK_MAX_CHARS) {
  const blocks = [];
  let current = null;
  let previousTail = [];
  for (const segment of (segments || [])) {
    const text = String(segment?.text || "").trim();
    if (!text) continue;
    if (!current || current.text.length + text.length + 1 > maxChars) {
      const candidates = previousTail.filter((item) => item.text).slice(-2);
      let overlap = [];
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const proposed = candidates.slice(index);
        if (proposed.map((item) => item.text).join(" ").length + text.length + 1 <= maxChars) overlap = proposed;
      }
      const overlapText = overlap.map((item) => item.text).join(" ");
      current = {
        startSeconds: Math.floor(Number(overlap[0]?.offset ?? segment.offset) || 0),
        endSeconds: 0,
        text: overlapText
      };
      blocks.push(current);
    }
    current.text += `${current.text ? " " : ""}${text}`;
    current.endSeconds = Math.ceil((Number(segment.offset) || 0) + (Number(segment.duration) || 0));
    previousTail.push({ text, offset: segment.offset });
    if (previousTail.length > 2) previousTail.shift();
  }
  return blocks;
}

function buildYoutubeSelectionPrompt(block, sourceTitle, maxKnowledge) {
  return [
    "Tu sélectionnes des connaissances à partir d'un bloc de transcription YouTube. Tu te bases UNIQUEMENT sur cette transcription : aucun savoir extérieur, aucune supposition.",
    sourceTitle ? `Titre de la vidéo : ${sourceTitle}` : "Titre de la vidéo indisponible.",
    `Passage approximatif : ${block.startSeconds}s à ${block.endSeconds}s.`,
    "", "Transcription :", '"""', block.text, '"""', "",
    ...SELECTION_RULE_LINES,
    "", "Exemples de calibrage :",
    ...CALIBRATION_EXAMPLES.flatMap((example) => [`- ${example.text} → ${example.verdict}`, ...(example.forbidden || []).map((value) => `  Interdit : ${value}`)]),
    "",
    `Retourne au maximum ${maxKnowledge} connaissances pour ce bloc. C'est un plafond, jamais un objectif. knowledge: [] est valide.`,
    "Pour chaque connaissance, donne une evidence très courte copiée exactement de la transcription.",
    "Réponds uniquement en JSON strict :",
    '{"knowledge":[{"knowledge":"phrase factuelle courte et autonome","evidence":"courte preuve textuelle"}]}'
  ].join("\n");
}

function normalizeFactKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function deduplicateYoutubeKnowledge(items, limit) {
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

async function fetchYoutubeMetadata(canonicalUrl, fetchImpl = global.fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  timeout.unref?.();
  try {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
    const response = await fetchImpl(endpoint, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (response.status === 401 || response.status === 403 || response.status === 404) throw new YoutubeKnowledgeError("video_unavailable", "Cette vidéo n'est pas disponible publiquement.");
    if (!response.ok) return { sourceTitle: null, author: null };
    const data = await response.json();
    return {
      sourceTitle: String(data?.title || "").trim().replace(/\s+/g, " ").slice(0, 160) || null,
      author: String(data?.author_name || "").trim().replace(/\s+/g, " ").slice(0, 160) || null
    };
  } catch (error) {
    if (error instanceof YoutubeKnowledgeError) throw error;
    return { sourceTitle: null, author: null };
  } finally { clearTimeout(timeout); }
}

async function defaultFetchTranscript(canonicalUrl) {
  try { return await YoutubeTranscript.fetchTranscript(canonicalUrl); }
  catch (error) {
    const message = String(error?.message || "");
    if (/no longer available/i.test(message)) throw new YoutubeKnowledgeError("video_unavailable", "Cette vidéo n'est pas disponible publiquement.");
    if (/disabled|no transcripts|transcript/i.test(message)) throw new YoutubeKnowledgeError("transcript_not_available", "Aucune transcription publique exploitable n'est disponible pour cette vidéo.");
    throw new YoutubeKnowledgeError("service_error", "Impossible de récupérer la transcription YouTube pour le moment.");
  }
}

async function analyzeYoutubeKnowledge({ url, callOpenAI, fetchTranscript = defaultFetchTranscript, fetchMetadata = fetchYoutubeMetadata }) {
  const parsedUrl = parseYoutubeVideoUrl(url);
  const [rawTranscript, metadata] = await Promise.all([fetchTranscript(parsedUrl.canonicalUrl), fetchMetadata(parsedUrl.canonicalUrl)]);
  const transcript = normalizeTranscript(rawTranscript);
  if (!transcript.segments.length) throw new YoutubeKnowledgeError("transcript_not_available", "Aucune transcription publique exploitable n'est disponible pour cette vidéo.");
  if (transcript.text.length < 40) throw new YoutubeKnowledgeError("content_not_exploitable", "La transcription disponible ne contient pas assez de texte exploitable.");
  if (transcript.durationSeconds > YOUTUBE_MAX_DURATION_SECONDS) throw new YoutubeKnowledgeError("video_too_long", "Cette vidéo dépasse la limite V1 de 2 heures.");
  if (transcript.text.length > YOUTUBE_MAX_TRANSCRIPT_CHARS) throw new YoutubeKnowledgeError("video_too_long", "La transcription est trop longue pour la limite V1. Choisis une vidéo plus courte.");
  const maxKnowledge = knowledgeLimitForYoutube(transcript.durationSeconds, transcript.text.length);
  const blocks = buildYoutubeBlocks(transcript.segments);
  if (!blocks.length) throw new YoutubeKnowledgeError("content_not_exploitable", "La transcription ne contient pas de texte exploitable.");
  const candidates = [];
  for (const block of blocks) {
    const content = await callOpenAI([{ role: "user", content: buildYoutubeSelectionPrompt(block, metadata.sourceTitle, Math.min(20, maxKnowledge)) }], {
      model: YOUTUBE_KNOWLEDGE_MODEL, temperature: 0.2, responseFormat: { type: "json_object" }, timeoutMs: 60_000, feature: "youtube_knowledge_select"
    });
    let selected;
    try { selected = JSON.parse(typeof content === "string" ? content : content?.content || ""); }
    catch (error) { throw new YoutubeKnowledgeError("service_error", "Réponse de sélection YouTube invalide."); }
    candidates.push(...(Array.isArray(selected?.knowledge) ? selected.knowledge : []));
  }
  return {
    status: "ok", sourceTitle: metadata.sourceTitle, sourceUrl: parsedUrl.canonicalUrl, author: metadata.author,
    durationSeconds: transcript.durationSeconds || null, maxKnowledge, blockCount: blocks.length,
    knowledge: deduplicateYoutubeKnowledge(candidates, maxKnowledge)
  };
}

function createYoutubeAnalysisToken(payload, secret, now = Date.now()) {
  if (!secret) throw new Error("Secret de signature YouTube manquant.");
  const protectedPayload = {
    sourceTitle: payload.sourceTitle || null, sourceUrl: payload.sourceUrl, sourceAuthor: payload.author || null,
    durationSeconds: payload.durationSeconds || null, maxKnowledge: payload.maxKnowledge, issuedAt: now
  };
  const encoded = Buffer.from(JSON.stringify(protectedPayload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyYoutubeAnalysisToken(token, secret, now = Date.now()) {
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature || !secret) throw new Error("Jeton d'analyse YouTube invalide.");
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error("Jeton d'analyse YouTube invalide.");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  parseYoutubeVideoUrl(payload.sourceUrl);
  if (![20, 40, 60, 100].includes(payload.maxKnowledge) || !Number.isFinite(payload.issuedAt) || now - payload.issuedAt > YOUTUBE_ANALYSIS_TOKEN_TTL_MS || payload.issuedAt > now + 60_000) {
    throw new Error("Jeton d'analyse YouTube expiré ou invalide.");
  }
  return payload;
}

module.exports = {
  YOUTUBE_KNOWLEDGE_MODEL, YOUTUBE_MAX_DURATION_SECONDS, YOUTUBE_MAX_TRANSCRIPT_CHARS, YoutubeKnowledgeError,
  parseYoutubeVideoUrl, normalizeTranscript, knowledgeLimitForYoutube, buildYoutubeBlocks, buildYoutubeSelectionPrompt,
  deduplicateYoutubeKnowledge, fetchYoutubeMetadata, analyzeYoutubeKnowledge, createYoutubeAnalysisToken, verifyYoutubeAnalysisToken
};
