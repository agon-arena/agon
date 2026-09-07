"use strict";

// Identité globale d'un sujet libre ("Mes apprentissages", recherche libre) —
// extrait de server.js (07/09/2026, chantier "pré-génération en avance des
// sujets IA proposés") pour être réutilisable SANS dupliquer/diverger : la
// pré-génération (lib/notion-quiz-pregeneration-queue.js) doit calculer
// EXACTEMENT le même normalizedKey/masterSlot que la route
// POST /api/users/notion-quizzes/custom/progressive (server.js), sans quoi un
// sujet pré-généré et un sujet créé par un utilisateur pourraient obtenir
// deux identités différentes pour le même contenu conceptuel — l'inverse
// exact de l'objectif du chantier ("UN SUJET = UN MASTER UNIQUE").
//
// Fonction PURE, aucune dépendance à Supabase/server.js — server.js
// `require()` désormais ce fichier plutôt que de garder sa propre copie.

const crypto = require("crypto");

// Clé de slot dérivée du texte tapé plutôt que d'un id fourni par le client
// (aucun id stable n'existe pour un sujet libre) : deux visiteurs tapant le
// même sujet à la casse/aux accents/à la ponctuation près rejoignent ainsi le
// même QCM déjà généré au lieu d'en régénérer un.
function normalizeCustomTopicKey(topic) {
  const normalized = String(topic || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 16);
}

// Identité de MASTER : un slot nu (sans suffixe ":niveau"), indépendant du
// niveau réellement demandé — un même sujet/une même notion partage UN SEUL
// corpus maître quel que soit le niveau qui l'a déclenché.
function buildCustomTopicMasterSlot(id) {
  return `notion:custom:${id}`;
}

module.exports = { normalizeCustomTopicKey, buildCustomTopicMasterSlot };
