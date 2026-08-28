"use strict";

const ERROR_DEFINITIONS = Object.freeze({
  AI_CONFIG_MISSING: { status: 503, message: "Le service IA n’est pas configuré pour le moment." },
  AI_TIMEOUT: { status: 504, message: "La génération a pris trop de temps. Réessaie dans quelques instants." },
  AI_UNAVAILABLE: { status: 503, message: "Le service IA est temporairement indisponible. Réessaie dans quelques instants." },
  CONTENT_UNUSABLE: { status: 422, message: "Le contenu généré n’a pas pu être exploité. Essaie de préciser le sujet." },
  KNOWLEDGE_REJECTED: { status: 422, message: "Aucune connaissance suffisamment fiable et importante n’a été trouvée sur ce sujet." },
  QCM_UNUSABLE: { status: 422, message: "La fiche a été créée, mais ses questions n’ont pas pu être validées. Réessaie ou précise le sujet." },
  STORAGE_TEMPORARY: { status: 503, message: "L’apprentissage n’a pas pu être enregistré pour le moment. Réessaie dans quelques instants." },
  INTERNAL_ERROR: { status: 500, message: "Une erreur inattendue a interrompu la génération. Réessaie dans quelques instants." }
});

function isTimeoutError(error) {
  const text = `${error?.name || ""} ${error?.code || ""} ${error?.message || ""}`;
  return /AbortError|TimeoutError|timeout|timed out/i.test(text);
}

function classifyAiError(error) {
  if (isTimeoutError(error)) return "AI_TIMEOUT";
  return "AI_UNAVAILABLE";
}

function generationFailure(code, stage, details = {}) {
  const safeCode = ERROR_DEFINITIONS[code] ? code : "INTERNAL_ERROR";
  return { error: "failed", code: safeCode, stage, ...details };
}

function publicGenerationError(code, reason) {
  const safeCode = ERROR_DEFINITIONS[code] ? code : "INTERNAL_ERROR";
  const definition = ERROR_DEFINITIONS[safeCode];
  const safeReason = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 300) : null;
  return {
    status: definition.status,
    body: { ok: false, code: safeCode, error: safeReason || definition.message }
  };
}

module.exports = {
  ERROR_DEFINITIONS,
  classifyAiError,
  generationFailure,
  publicGenerationError
};
