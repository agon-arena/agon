// Moteur de classification Galaxy/Solar/Star — refonte du 16/08/2026 (diagnostic
// "Atlas Mnoria" : dieux romains classés en Arts au lieu d'Histoire, Solar
// "Empire inca précolombien" créé alors que "Temps modernes" existait déjà).
//
// Fonctions PURES uniquement (aucun accès réseau/DB, aucun appel IA) — la
// résolution IA et les requêtes Supabase restent dans server.js
// (classifyCultureGeneraleCategoryWithAI / resolveCultureGeneraleSolarSystemWithAI),
// ce module ne porte que la partie testable sans IA :
//   - filtrage du périmètre utilisateur (jamais la taxonomie d'un autre user) ;
//   - séparation stricte knowledge/news (un Solar "news" n'est jamais candidat) ;
//   - validation du contrat MATCH/CREATE renvoyé par l'IA ;
//   - gate déterministe avant toute création (nom, longueur, doublon, quasi-
//     redite du Subject).
//
// Principe : MATCH d'abord (parmi l'existant SEULEMENT), CREATE en exception
// explicite — jamais les deux dans la même décision IA (cf. rapport de design
// du 16/08/2026, section "séparer match et création").

const MAX_GALAXIES_PER_CALL = 20;
const MAX_SOLAR_NAME_WORDS = 5;
const MAX_SOLAR_NAME_CHARS = 60;

// ── Périmètre utilisateur (§1/§2/§29 du plan) ──────────────────────────────
// `activations` = lignes user_solar_activations déjà chargées pour CET
// utilisateur uniquement (jamais un fetch global) : { solarSystemId, galaxy }.
// `allSolars` = catalogue canonique complet (solar_systems, scope=knowledge).
// Ne renvoie QUE les solars canoniques que cet utilisateur a réellement
// activés — jamais un solar d'un autre utilisateur, même dans la même galaxy.
function filterUserActiveSolars(allSolars, activations, galaxy) {
  const activeIds = new Set((activations || []).map((a) => Number(a.solarSystemId)));
  return (allSolars || [])
    .filter((s) => isKnowledgeCandidate(s))
    .filter((s) => !galaxy || s.galaxy === galaxy)
    .filter((s) => activeIds.has(Number(s.id)));
}

// Étoiles déjà actives chez CET utilisateur uniquement (jamais celles d'un
// autre utilisateur, même sous le même Solar) — cf. correctif du 16/08/2026 :
// resolveCultureGeneraleStarWithAI présentait auparavant TOUTES les étoiles
// existantes d'un Solar, quel que soit l'utilisateur qui les avait créées.
// `starActivations` = étoiles déjà rencontrées par cet utilisateur, dérivées
// de user_article_acquisitions.star_id (aucune table dédiée nécessaire, ce
// lien existe déjà). Ne restreint PAS le court-circuit déterministe "même
// Subject déjà connu" (identité, pas similarité) — uniquement les candidats
// proposés à l'IA pour juger si un Subject NOUVEAU ressemble à une étoile
// EXISTANTE.
function filterUserActiveStars(allStars, starActivations, solarSystemId) {
  const activeIds = new Set((starActivations || []).map((a) => Number(a.starId)));
  return (allStars || [])
    .filter((s) => !solarSystemId || Number(s.solarSystemId) === Number(solarSystemId))
    .filter((s) => activeIds.has(Number(s.id)));
}

// Galaxies "actives" chez cet utilisateur = dérivées de ses solars actifs,
// jamais stockées séparément (cf. design : l'activation d'une Galaxy est un
// sous-produit de l'activation d'un Solar, pas une table à part).
function userActiveGalaxies(allSolars, activations) {
  const activeIds = new Set((activations || []).map((a) => Number(a.solarSystemId)));
  const galaxies = new Set();
  for (const s of allSolars || []) {
    if (isKnowledgeCandidate(s) && activeIds.has(Number(s.id))) galaxies.add(s.galaxy);
  }
  return [...galaxies];
}

// §1 de la vérification finale du 16/08/2026 : le court-circuit "placement
// déjà connu" (0 appel IA) ne doit jamais reprendre le placement résolu
// UNIQUEMENT par un autre utilisateur — sinon un Solar/Star propre à User B
// s'imposerait à User A sans qu'il passe par sa propre décision MATCH. Cette
// fonction construit les critères de la requête plutôt que de les laisser
// écrits en ligne dans server.js, pour que l'absence du filtre user_id soit
// un test qui échoue ici, jamais une régression silencieuse découverte plus
// tard. Renvoie null (donc : aucune requête, aucun court-circuit) si
// n'importe quel élément d'identité manque.
function buildKnownPlacementLookup(sourceType, sourceDebateId, userId) {
  const type = String(sourceType || "").trim();
  const debateId = String(sourceDebateId || "").trim();
  if (!type || !debateId || !userId) return null;
  return { eclairage_type: type, eclairage_source_id: debateId, user_id: userId };
}

// ── Isolation news/knowledge (§21/§22, révisé le 16/08/2026 pour le scope
// "both") ───────────────────────────────────────────────────────────────
// 4 valeurs possibles pour taxonomy_scope : "knowledge", "news", "both"
// (référencé par les deux pipelines — mesuré réellement : 9 solars sur 245),
// "unknown" (jamais résolu). Un Solar "both" EST un candidat knowledge
// valide (il est réellement utilisé par le pipeline connaissances, le
// masquer serait une régression, cf. vérification finale §2) — seul
// "unknown" reste exclu tant qu'il n'est pas résolu. Ne JAMAIS traiter
// silencieusement "both" comme "knowledge" en écriture (la distinction reste
// visible) ni comme "unknown" en lecture (il resterait invisible alors qu'il
// est réellement utilisé) : ces deux fonctions sont la SEULE porte d'entrée
// pour cette décision, jamais un `=== "knowledge"` dupliqué ailleurs.
function isKnowledgeCandidate(solar) {
  const scope = solar?.taxonomyScope;
  return scope === "knowledge" || scope === "both";
}

function isNewsCandidate(solar) {
  const scope = solar?.taxonomyScope;
  return scope === "news" || scope === "both";
}

// ── Validation du contrat MATCH renvoyé par l'IA ───────────────────────────
// Ne fait JAMAIS confiance à une sortie libre : décision reconnue + id
// appartenant réellement aux candidats fournis, sinon rejet (jamais un id
// halluciné). confidence bornée [0,1], jamais utilisée seule pour décider
// (cf. §12 : ce n'est pas une probabilité calibrée).
function parseMatchDecision(raw, candidateIds) {
  if (!raw || typeof raw !== "object") return null;
  const idSet = new Set((candidateIds || []).map((id) => Number(id)));
  const confidence = Number.isFinite(Number(raw.confidence)) ? Math.max(0, Math.min(1, Number(raw.confidence))) : null;

  if (raw.decision === "existing") {
    const id = Number(raw.id);
    if (!Number.isInteger(id) || !idSet.has(id)) return null;
    return { decision: "existing", id, confidence };
  }
  if (raw.decision === "no_match") {
    const bestId = raw.bestExistingId != null ? Number(raw.bestExistingId) : null;
    if (bestId != null && (!Number.isInteger(bestId) || !idSet.has(bestId))) return null;
    return { decision: "no_match", bestExistingId: bestId, confidence };
  }
  return null;
}

// ── Validation du contrat de CRÉATION (2e appel, exception) ───────────────
function parseCreationDecision(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.noExistingMatch !== true) return null; // le modèle doit confirmer explicitement l'absence de match
  const name = String(raw.name || "").trim();
  const description = String(raw.description || "").trim();
  if (!name || !description) return null;
  return { name, description: description.slice(0, 240) };
}

function normalizeTaxonomyName(value) {
  return String(value || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Gate serveur avant toute création (§15/§16) ────────────────────────────
// Ce que le code PEUT vérifier déterministement — la cohérence sémantique
// profonde ("aucun solar existant ne convient vraiment") reste portée par
// l'appel IA de validation, jamais par ce gate seul (cf. §16 : une seule
// heuristique de granularité ne suffit pas).
//
// Retourne { ok:true } ou { ok:false, reason } — jamais une exception,
// jamais une création silencieuse.
function validateTaxonomyCreationCandidate({ name, galaxy, existingSolarNames, subjectName, requireNoExistingMatch }) {
  if (requireNoExistingMatch === false) {
    return { ok: false, reason: "creation_without_no_match" }; // §13 : jamais de création hors NO_MATCH
  }
  const trimmed = String(name || "").trim();
  if (!trimmed) return { ok: false, reason: "empty_name" };
  if (trimmed.length > MAX_SOLAR_NAME_CHARS) return { ok: false, reason: "name_too_long" };
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount > MAX_SOLAR_NAME_WORDS) return { ok: false, reason: "too_many_words" };
  if (!galaxy) return { ok: false, reason: "missing_galaxy" };

  const normalized = normalizeTaxonomyName(trimmed);
  if (!normalized) return { ok: false, reason: "empty_name" };

  // Doublon exact/quasi exact avec un solar déjà actif chez cet utilisateur
  // dans cette galaxy — la dédup lexicale n'a jamais besoin de l'IA.
  const existingNormalized = new Set((existingSolarNames || []).map(normalizeTaxonomyName));
  if (existingNormalized.has(normalized)) return { ok: false, reason: "duplicate_of_existing" };

  // Filet anti-redite du Subject (§16 : imparfait par nature, complémentaire
  // de la validation IA — jamais la seule ligne de défense).
  //
  // CORRIGÉ le 17/08/2026 (Phase 5, génération réelle) : la première version
  // rejetait dès que TOUS les mots du Solar apparaissaient aussi dans le
  // Subject — ex. Solar "Panthéon romain" rejeté pour le Subject "Dieux du
  // panthéon romain et leurs attributs", alors que "Panthéon romain" est
  // exactement le bon nom de Solar (large, durable, réutilisable pour
  // d'autres connaissances sur d'autres dieux). Un Solar topiquement lié au
  // Subject est NORMAL et ATTENDU — seul un Solar qui reproduit la QUASI-
  // TOTALITÉ du Subject (rien de plus large qu'un simple sous-ensemble de
  // mots partagés) est le signe d'une redite. Le test devient donc : le
  // Solar doit couvrir une GRANDE MAJORITÉ des mots significatifs du Subject
  // (pas seulement en être un sous-ensemble) pour être rejeté — un Solar
  // sensiblement plus court que le Subject (cas normal d'une catégorie large)
  // ne déclenche plus ce filet.
  if (subjectName) {
    const subjectWords = normalizeTaxonomyName(subjectName).split(" ").filter((w) => w.length > 2);
    const subjectWordSet = new Set(subjectWords);
    const nameWords = normalized.split(" ").filter((w) => w.length > 2);
    const isSubset = nameWords.length > 0 && nameWords.every((w) => subjectWordSet.has(w));
    const coverage = subjectWordSet.size > 0 ? nameWords.length / subjectWordSet.size : 0;
    if (isSubset && coverage >= 0.6) {
      return { ok: false, reason: "restates_subject" };
    }
  }

  return { ok: true };
}

// ── Résolution déterministe de Star (§3 de la vérification finale du
// 16/08/2026 : fusionner Star dans les appels Galaxy/Solar sans dépasser
// 0/1/2 appels IA au total, sans renvoyer à l'IA la liste des étoiles
// existantes — ce qui romprait la scalabilité déjà prouvée au point 8
// précédent). L'IA propose un libellé de Star (avec les mêmes règles de
// qualité qu'avant : plus large qu'un fait atomique, jamais une redite du
// Solar) ; le serveur décide ENSUITE, déterministement, si ce libellé
// correspond à une étoile déjà connue de cet utilisateur sous ce Solar.
//
// Compromis assumé (documenté, pas silencieux) : une vraie reformulation
// sémantique éloignée du libellé (ex. "Directoire" proposé pour une étoile
// existante nommée différemment mais synonyme) peut ne pas être reconnue —
// l'ancien appel IA dédié la détectait mieux. Accepté pour tenir l'objectif
// de coût ; le risque réel est limité par (a) le nombre d'étoiles par Solar
// observé en pratique (max 7 sur les données réelles), (b) une consigne de
// prompt demandant une terminologie standard plutôt qu'une reformulation
// personnelle. Comparaison normalisée + inclusion de mots (accents/casse/
// ponctuation/ordre des mots neutralisés) — pas une simple égalité stricte.
function matchExistingStarByLabel(proposedLabel, existingStars) {
  const proposed = normalizeTaxonomyName(proposedLabel);
  if (!proposed) return null;
  const proposedWords = new Set(proposed.split(" ").filter(Boolean));
  for (const star of existingStars || []) {
    const candidate = normalizeTaxonomyName(star.name);
    if (!candidate) continue;
    if (candidate === proposed) return star.id;
    const candidateWords = new Set(candidate.split(" ").filter(Boolean));
    const [shorter, longer] = proposedWords.size <= candidateWords.size
      ? [proposedWords, candidateWords]
      : [candidateWords, proposedWords];
    if (shorter.size > 0 && [...shorter].every((w) => longer.has(w))) return star.id;
  }
  return null;
}

// Généralise la règle "l'étoile ne doit jamais reprendre les mots du système
// solaire" (durcie le 10/08/2026 après un bug réel — étoile "Révolution
// française" sous le solar "Révolution française & Empire") en fonction pure
// testable, réutilisable aussi bien pour un Solar existant que pour un Solar
// tout juste créé par l'appel de création.
function isNameRestatementOfParent(name, parentName) {
  const words = normalizeTaxonomyName(name).split(" ").filter((w) => w.length > 2);
  const parentWords = new Set(normalizeTaxonomyName(parentName).split(" ").filter((w) => w.length > 2));
  return words.length > 0 && words.every((w) => parentWords.has(w));
}

// Gate déterministe sur le libellé de Star proposé par l'IA — mêmes bornes
// que pour un Solar (longueur/nombre de mots) + non-redite du Solar parent.
// Ne vérifie PAS la "largeur" sémantique de l'étoile (durablement réutilisable
// pour plusieurs contenus) : c'était déjà, avant cette refonte, une consigne
// de prompt jamais vérifiée par du code — aucune régression introduite ici.
function validateStarLabelCandidate({ label, solarName }) {
  const trimmed = String(label || "").trim();
  if (!trimmed) return { ok: false, reason: "empty_label" };
  if (trimmed.length > MAX_SOLAR_NAME_CHARS) return { ok: false, reason: "label_too_long" };
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount > MAX_SOLAR_NAME_WORDS) return { ok: false, reason: "too_many_words" };
  if (solarName && isNameRestatementOfParent(trimmed, solarName)) return { ok: false, reason: "restates_solar" };
  return { ok: true };
}

// ── Backfill user_solar_activations (point 4 de la vérification finale du
// 16/08/2026) ──────────────────────────────────────────────────────────
// Reproduit en JS pur — donc testable sans DB — exactement la logique du
// INSERT...SELECT de data/migration-user-solar-activations.sql : une
// activation par (user_id, solar_system_id) distinct, déduite de
// user_article_acquisitions (seule source de vérité qui trace, PAR
// UTILISATEUR, quel Solar a réellement été atteint). Déterministe,
// idempotent (même entrée -> même sortie), jamais d'invention pour une
// ligne sans solar_system_id résolu.
function computeSolarActivationsFromAcquisitions(acquisitions) {
  const seen = new Map(); // "user::solar" -> { userId, solarSystemId, activatedAt }
  let unresolved = 0;
  for (const row of acquisitions || []) {
    if (row.solarSystemId == null || row.userId == null) { unresolved++; continue; }
    const key = `${row.userId}::${row.solarSystemId}`;
    const existing = seen.get(key);
    if (!existing || (row.acquiredAt && row.acquiredAt < existing.activatedAt)) {
      seen.set(key, { userId: row.userId, solarSystemId: row.solarSystemId, activatedAt: row.acquiredAt || existing?.activatedAt || null });
    }
  }
  const activations = [...seen.values()];
  return {
    activations,
    usersConcerned: new Set(activations.map((a) => a.userId)).size,
    duplicatesAvoided: (acquisitions || []).length - unresolved - activations.length,
    unresolved
  };
}

module.exports = {
  MAX_GALAXIES_PER_CALL,
  MAX_SOLAR_NAME_WORDS,
  MAX_SOLAR_NAME_CHARS,
  filterUserActiveSolars,
  filterUserActiveStars,
  userActiveGalaxies,
  buildKnownPlacementLookup,
  isKnowledgeCandidate,
  isNewsCandidate,
  parseMatchDecision,
  parseCreationDecision,
  matchExistingStarByLabel,
  isNameRestatementOfParent,
  validateStarLabelCandidate,
  normalizeTaxonomyName,
  validateTaxonomyCreationCandidate,
  computeSolarActivationsFromAcquisitions
};
