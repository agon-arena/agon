"use strict";

// Extrait de server.js le 17/08/2026 (renforcement des liens entre
// connaissances de "Ma mémoire") pour pouvoir tester unitairement les
// parties déterministes du pipeline liens/QCM "Comprendre" — la détection
// sémantique elle-même (pertinence d'un lien, nombre de questions
// nécessaires) reste un appel IA dans server.js, jamais reproduite ici :
// ce fichier ne couvre que la mécanique programmatique autour d'elle
// (parsing/validation de sa réponse, ordre canonique de stockage,
// assemblage d'une session de révision), toutes des fonctions pures.

// Identité canonique d'une notion, indépendante du niveau ou de la date de
// génération — même paire que eclairage_type/eclairage_source_id dans
// user_article_acquisitions.
function cultureGeneraleNotionKey(sourceType, sourceId) {
  return `${sourceType}::${sourceId}`;
}

// Ordre canonique (indépendant du sens de création A→B ou B→A) pour ne
// jamais stocker deux fois le même lien — la contrainte UNIQUE
// (type_a,source_id_a,type_b,source_id_b) protège contre une course entre
// deux créations simultanées, mais seulement si l'ordre est déterministe.
function canonicalNotionLinkPair(typeA, idA, nameA, typeB, idB, nameB) {
  const keyA = cultureGeneraleNotionKey(typeA, idA);
  const keyB = cultureGeneraleNotionKey(typeB, idB);
  return keyA < keyB
    ? { typeA, idA, nameA, typeB, idB, nameB }
    : { typeA: typeB, idA: idB, nameA: nameB, typeB: typeA, idB: idA, nameB: nameA };
}

// Valide/déduplique les liens bruts renvoyés par l'IA contre la liste réelle
// des candidats transmis dans le prompt. Ne juge JAMAIS la pertinence
// sémantique d'un lien (c'est le rôle exclusif du prompt et du modèle) —
// seulement sa conformité mécanique : la clé existe vraiment parmi les
// candidats, un libellé est présent, pas de doublon, au maximum `maxLinks`.
function selectValidNotionLinks(rawLinks, candidateByKey, maxLinks = 3) {
  const seenRelated = new Set();
  const validLinks = [];
  for (const rawLink of Array.isArray(rawLinks) ? rawLinks : []) {
    const relatedKey = String(rawLink?.related_key || "").trim();
    const label = String(rawLink?.label || "").trim().slice(0, 60);
    const match = candidateByKey.get(relatedKey);
    if (!match || !label || seenRelated.has(relatedKey)) continue;
    seenRelated.add(relatedKey);
    validLinks.push({ match, label });
    if (validLinks.length >= maxLinks) break;
  }
  return validLinks;
}

// Assemble une session de révision "Comprendre" en tournant entre les
// banques de questions disponibles (une banque = les questions d'un lien).
// Une banque ne contenant qu'UNE SEULE question reste pleinement éligible :
// un lien fort mais simple à comprendre ne doit jamais être exclu de la
// session faute d'atteindre un quota artificiel de questions.
function assembleComprehensionSession(banks, maxQuestions = 6) {
  const eligibleBanks = (Array.isArray(banks) ? banks : []).filter(
    (bank) => Array.isArray(bank) && bank.length >= 1
  );
  const session = [];
  for (let questionIndex = 0; session.length < maxQuestions; questionIndex += 1) {
    let added = false;
    for (const bank of eligibleBanks) {
      if (bank[questionIndex]) {
        session.push(bank[questionIndex]);
        added = true;
        if (session.length >= maxQuestions) break;
      }
    }
    if (!added) break;
  }
  return session;
}

module.exports = {
  cultureGeneraleNotionKey,
  canonicalNotionLinkPair,
  selectValidNotionLinks,
  assembleComprehensionSession
};
