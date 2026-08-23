"use strict";

// Script de test manuel pour le pipeline "import de connaissances par photo".
// Toute la logique réutilisable (prompts, orchestration 2 étapes, filtre
// méta-énoncé, normalisation sharp) vit désormais dans lib/photo-knowledge.js
// (extraction du 22/08/2026) — ce fichier ne fait plus que : lire l'image
// locale, fournir un petit wrapper HTTP OpenAI, et afficher le résultat.
// Fichier autonome, supprimable sans impact sur le reste de Mnoria.
//
// Ne réutilise pas _callOpenAI (server.js) directement pour l'appel réseau :
// server.js crée le client Supabase et démarre app.listen() dès son
// chargement, ce qui en ferait un import beaucoup trop lourd (et risqué)
// pour un script isolé. Le petit wrapper ci-dessous se contente du strict
// nécessaire (pas de retry/backoff, contrairement à _callOpenAI) : suffisant
// pour un test manuel ponctuel.
//
// Usage : node scripts/test-photo-knowledge.js chemin/vers/photo.jpg

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  PHOTO_KNOWLEDGE_MODEL,
  MIME_BY_EXTENSION,
  buildAnalysisDataUrl,
  analyzePhotoKnowledge
} = require("../lib/photo-knowledge");

async function callOpenAI(apiKey, messages, opts = {}) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
    body: JSON.stringify({
      model: opts.model || PHOTO_KNOWLEDGE_MODEL,
      temperature: opts.temperature ?? 0.2,
      ...(opts.responseFormat ? { response_format: opts.responseFormat } : {}),
      messages
    }),
    signal: AbortSignal.timeout(opts.timeoutMs || 180_000)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Erreur OpenAI (${response.status}) : ${body}`);
  }

  const data = await response.json();
  return { content: data?.choices?.[0]?.message?.content || "", usage: data?.usage || null };
}

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.error("Usage : node scripts/test-photo-knowledge.js chemin/vers/photo.jpg");
    process.exit(1);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY manquant dans .env");
    process.exit(1);
  }

  const resolvedPath = path.resolve(imagePath);
  const mimeType = MIME_BY_EXTENSION[path.extname(resolvedPath).toLowerCase()];
  if (!mimeType) {
    console.error("Extension non supportée (attendu : .jpg, .jpeg, .png ou .webp).");
    process.exit(1);
  }

  const buffer = fs.readFileSync(resolvedPath);
  const { dataUrl, exifOrientation } = await buildAnalysisDataUrl(buffer, mimeType);

  console.log(`[test-photo-knowledge] image=${resolvedPath} (${(buffer.length / 1024).toFixed(0)} Ko) modèle=${PHOTO_KNOWLEDGE_MODEL} exifOrientation=${exifOrientation ?? "absente"}`);

  const result = await analyzePhotoKnowledge({
    dataUrl,
    callOpenAI: (messages, opts) => callOpenAI(apiKey, messages, opts)
  });

  const { usage, ...publicResult } = result;
  console.log(JSON.stringify(publicResult, null, 2));
  if (usage?.step1) console.log(`[test-photo-knowledge] étape 1 — tokens : prompt(image+texte)=${usage.step1.prompt_tokens} completion=${usage.step1.completion_tokens} total=${usage.step1.total_tokens}`);
  if (usage?.step2) console.log(`[test-photo-knowledge] étape 2 — tokens : prompt(texte)=${usage.step2.prompt_tokens} completion=${usage.step2.completion_tokens} total=${usage.step2.total_tokens}`);
  console.log(`\n[test-photo-knowledge] readability=${result.readability} — ${result.knowledge.length} connaissance(s) retenue(s).`);
}

main().catch((error) => {
  console.error("[test-photo-knowledge] échec :", error.message);
  process.exit(1);
});
