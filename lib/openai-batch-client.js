"use strict";

// Client bas niveau pour l'API Batch d'OpenAI (chantier "pré-génération en
// avance des sujets IA proposés", 07/09/2026). Volontairement PUR côté
// réseau : `fetchImpl` est toujours injecté par l'appelant (jamais un
// `fetch()` global ici) — permet de tester intégralement ce module sans
// jamais toucher au réseau (cf. test/openai-batch-client.test.js). Aucune
// dépendance à server.js/Supabase : ce fichier ne connaît rien du pipeline
// progressif, seulement le protocole HTTP de l'API Batch elle-même.

const OPENAI_FILES_URL = "https://api.openai.com/v1/files";
const OPENAI_BATCHES_URL = "https://api.openai.com/v1/batches";

// Statuts terminaux d'un Batch OpenAI — au-delà, plus aucune évolution
// possible sans le resoumettre. "in_progress"/"validating"/"finalizing"/
// "cancelling" restent tous des statuts D'ATTENTE (le scheduler ne doit rien
// faire de plus qu'attendre le prochain cycle de poll).
const TERMINAL_BATCH_STATUSES = new Set(["completed", "failed", "expired", "cancelled"]);

// Une ligne de requête Batch — même contrat (model/messages/temperature/
// response_format) que le corps envoyé par _callOpenAI en mode synchrone
// (server.js) : le contenu produit ne doit JAMAIS différer entre les deux
// chemins, seul le transport change. `customId` est déterministe côté
// appelant (cf. server.js : "<queueId>:<callKey>:<occurrence>").
function buildBatchRequestLine({ customId, model, messages, temperature, responseFormat, maxCompletionTokens }) {
  if (!customId) throw new Error("buildBatchRequestLine: customId requis.");
  if (!model) throw new Error("buildBatchRequestLine: model requis.");
  if (!Array.isArray(messages) || !messages.length) throw new Error("buildBatchRequestLine: messages requis.");
  return {
    custom_id: customId,
    method: "POST",
    url: "/v1/chat/completions",
    body: {
      model,
      messages,
      ...(temperature != null ? { temperature } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
      ...(maxCompletionTokens != null ? { max_completion_tokens: maxCompletionTokens } : {})
    }
  };
}

// JSONL : une ligne JSON par requête, jamais un tableau — format exigé tel
// quel par l'API Batch OpenAI pour le fichier d'entrée.
function buildBatchJsonl(lines) {
  return lines.map((line) => JSON.stringify(line)).join("\n");
}

async function uploadBatchInputFile(fetchImpl, apiKey, jsonlContent) {
  const form = new FormData();
  form.append("purpose", "batch");
  form.append("file", new Blob([jsonlContent], { type: "application/jsonl" }), "batch_input.jsonl");
  const res = await fetchImpl(OPENAI_FILES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(body || "Échec upload fichier Batch."), { status: res.status });
  }
  const data = await res.json();
  return data.id;
}

async function createBatch(fetchImpl, apiKey, inputFileId, { completionWindow = "24h", metadata } = {}) {
  const res = await fetchImpl(OPENAI_BATCHES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      input_file_id: inputFileId,
      endpoint: "/v1/chat/completions",
      completion_window: completionWindow,
      ...(metadata ? { metadata } : {})
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(body || "Échec création Batch."), { status: res.status });
  }
  return res.json();
}

// Combine upload + création — un seul point d'appel pour "soumets ces N
// requêtes comme un nouveau Batch", jamais dupliqué côté appelant.
async function submitBatch(fetchImpl, apiKey, requestLines, options = {}) {
  const jsonl = buildBatchJsonl(requestLines);
  const inputFileId = await uploadBatchInputFile(fetchImpl, apiKey, jsonl);
  const batch = await createBatch(fetchImpl, apiKey, inputFileId, options);
  return { batchId: batch.id, inputFileId, status: batch.status };
}

async function retrieveBatch(fetchImpl, apiKey, batchId) {
  const res = await fetchImpl(`${OPENAI_BATCHES_URL}/${batchId}`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(body || "Échec lecture statut Batch."), { status: res.status });
  }
  return res.json();
}

async function downloadFileContent(fetchImpl, apiKey, fileId) {
  const res = await fetchImpl(`${OPENAI_FILES_URL}/${fileId}/content`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(body || "Échec téléchargement fichier Batch."), { status: res.status });
  }
  return res.text();
}

// Parse le fichier de sortie (une ligne JSON par requête, ORDRE NON garanti
// par OpenAI — jamais supposé ici) et retourne une Map custom_id -> résultat,
// pour un accès direct par l'appelant plutôt qu'une recherche linéaire.
// Une erreur PAR REQUÊTE (jamais un échec global) : `error_file_id` (erreurs
// de format au niveau ligne) n'est pas traité ici — l'appelant peut le passer
// à cette même fonction séparément si besoin, le format des lignes d'erreur
// suit le même schéma {custom_id, error}.
function parseBatchOutputJsonl(jsonlText) {
  const resultsByCustomId = new Map();
  const lines = String(jsonlText || "").split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const customId = parsed.custom_id;
    if (!customId) continue;
    if (parsed.error) {
      resultsByCustomId.set(customId, { ok: false, error: parsed.error.message || JSON.stringify(parsed.error) });
      continue;
    }
    const body = parsed.response?.body;
    const statusCode = parsed.response?.status_code;
    if (statusCode && statusCode >= 400) {
      resultsByCustomId.set(customId, { ok: false, error: body?.error?.message || `HTTP ${statusCode}` });
      continue;
    }
    const content = body?.choices?.[0]?.message?.content;
    if (!content) {
      resultsByCustomId.set(customId, { ok: false, error: "Réponse Batch sans contenu." });
      continue;
    }
    resultsByCustomId.set(customId, { ok: true, content, usage: body?.usage || null });
  }
  return resultsByCustomId;
}

module.exports = {
  TERMINAL_BATCH_STATUSES,
  buildBatchRequestLine,
  buildBatchJsonl,
  uploadBatchInputFile,
  createBatch,
  submitBatch,
  retrieveBatch,
  downloadFileContent,
  parseBatchOutputJsonl
};
