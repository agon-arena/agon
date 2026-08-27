"use strict";

const crypto = require("node:crypto");

function normalizeForHash(text) {
  return String(text || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// video_hash = sha256(items ordonnés + voice + avatar + pipeline_version +
// durée de pause) — cf. rapport d'audit du 26/08/2026, section 5.
//
// Deux utilisateurs demandant exactement le même batch (mêmes connaissances,
// dans le même ordre, avec la même voix/avatar/version de pipeline/durée de
// pause) obtiennent le MÊME hash, donc la MÊME ligne noes_videos — c'est ce
// qui permet la mutualisation d'une vidéo entre tous les utilisateurs plutôt
// que d'en générer une par utilisateur. À l'inverse :
// - une question ou une réponse modifiée change le hash (nouvelle vidéo) ;
// - un ordre de batch différent change le hash (d'où l'exigence de batching
//   CANONIQUE et déterministe, cf. lib/coeus/noes-batch.js — jamais une
//   sélection heuristique) ;
// - un changement de voix/avatar/moteur de rendu se répercute via
//   pipelineVersion, une constante versionnée à incrémenter DÉLIBÉRÉMENT
//   (cf. server.js, NOES_PIPELINE_VERSION) plutôt qu'un hash de composants
//   individuels que l'API du worker n'expose pas requête par requête.
function computeNoesVideoHash({ items, voice, avatar, pipelineVersion, thinkingPauseSeconds }) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("computeNoesVideoHash: items est requis et non vide.");
  }
  const normalizedItems = items.map((item) => ({
    id: String(item?.knowledgeId || ""),
    q: normalizeForHash(item?.question),
    a: normalizeForHash(item?.answer)
  }));
  const payload = JSON.stringify({
    items: normalizedItems,
    voice: String(voice || ""),
    avatar: String(avatar || ""),
    pipelineVersion: String(pipelineVersion || ""),
    thinkingPauseSeconds: Number(thinkingPauseSeconds) || 0
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

module.exports = { computeNoesVideoHash };
