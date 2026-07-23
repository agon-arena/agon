"use strict";

// Construit l'URL locale publique d'une image d'événement historique à
// partir de image_filename, sans jamais faire confiance à la valeur brute.
// Aucun accès disque ici : uniquement de la validation de nom de fichier.
// public/ est servi tel quel par Express (cf. server.js, express.static
// "public"), donc public/images/historical-events/x.jpg est joignable en
// "/images/historical-events/x.jpg".

const IMAGE_BASE_PATH = "/images/historical-events";

// Nom de fichier "à plat" uniquement : lettres/chiffres/._- , une extension
// image classique en fin de chaîne. Ce pattern à lui seul interdit déjà tout
// "/", "\" et donc tout "..", mais les vérifications explicites ci-dessous
// gardent l'intention lisible et servent de filet en cas de modification
// future du pattern.
const SAFE_FILENAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}\.(jpg|jpeg|png|webp|avif|gif)$/i;

function isSafeImageFilename(filename) {
  if (typeof filename !== "string") return false;
  const value = filename;
  if (!value || value !== value.trim()) return false;
  if (value.includes("..")) return false;
  if (value.includes("/") || value.includes("\\")) return false;
  if (value.startsWith(".")) return false;
  if (value.includes(":")) return false; // écarte notamment "C:\..." et autres schémas.
  if (/[\x00-\x1f]/.test(value)) return false; // caractères de contrôle.
  return SAFE_FILENAME_PATTERN.test(value);
}

function buildLocalImageUrl(filename) {
  if (!isSafeImageFilename(filename)) return null;
  return `${IMAGE_BASE_PATH}/${filename}`;
}

module.exports = { buildLocalImageUrl, isSafeImageFilename, IMAGE_BASE_PATH };
