"use strict";

// Niveau 2 de déduplication des recherches IA "sujet libre" (audit du
// 24/08/2026) — jamais d'appel IA ici, uniquement du texte déterministe.
// Le niveau 1 (clé exacte normalizeCustomTopicKey côté server.js) reste
// inchangé et prioritaire ; ce module n'intervient qu'en repli, quand aucun
// slot exact n'a été trouvé.
//
// Principe de sécurité (jamais assoupli) : un mot structurant (cause vs
// conséquence, date vs personnage...) qui diverge entre deux sujets bloque
// tout rapprochement, quel que soit le score de similarité par ailleurs —
// un faux négatif (génération inutile) est acceptable, un faux positif
// (mauvais QCM servi) ne l'est pas. En cas d'ambiguïté : pas de match.

// Volontairement dupliquée depuis la normalisation de
// normalizeCustomTopicKey (server.js) plutôt que partagée : le niveau 1 ne
// doit jamais dépendre de ce module, pour ne courir aucun risque de
// régression sur le chemin déjà en production même si ce fichier évolue.
function normalizeTopicText(topic) {
  return String(topic || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Mots-outils français réellement non sémantiques (articles, prépositions
// courantes, pronoms, tournures interrogatives). Volontairement générique et
// non ajustée aux exemples de test, pour ne pas surapprendre sur un seul
// corpus — cf. rapport de diagnostic du 24/08/2026.
const STOPWORDS = new Set(
  `le la les l un une des du de d au aux et ou a en sur pour avec sans dans
   par que qui quoi quel quelle quels quelles qu est ce cette ces son sa ses
   sont ete etaient c ca cela leur leurs nous vous ils elles on`
    .trim()
    .split(/\s+/)
);

// Mots qui changent l'intention pédagogique du sujet — liste validée lors du
// diagnostic (24/08/2026), formes accent-strippées pour matcher les tokens
// déjà normalisés. À compléter prudemment si un nouveau cas ambigu apparaît
// en usage réel — jamais retirer une entrée sans preuve qu'elle est inoffensive.
const STRUCTURAL_WORDS = new Set([
  "cause", "causes",
  "consequence", "consequences",
  "date", "dates",
  "chronologie",
  "personnage", "personnages",
  "definition",
  "fonctionnement",
  "exemple", "exemples",
  "avantage", "avantages",
  "inconvenient", "inconvenients",
  "comparaison",
  "difference", "differences",
  "role", "roles",
  "etape", "etapes",
  "origine", "origines",
  "effet", "effets",
  "caracteristique", "caracteristiques"
]);

// Tolérance de quasi-inclusion (§4 du diagnostic) : au-delà de 1 token de
// contenu d'écart entre les deux sujets, on ne matche plus — un 2e mot
// différent peut porter un sens qu'aucune liste de mots structurants ne
// couvrira jamais exhaustivement.
const MAX_EXTRA_CONTENT_TOKENS = 1;
const MIN_JACCARD_SCORE = 0.75;

function tokenize(normalizedText) {
  return normalizedText.split(" ").filter(Boolean);
}

function contentTokens(topic) {
  return tokenize(normalizeTopicText(topic)).filter((t) => !STOPWORDS.has(t));
}

function structuralWordsOf(tokens) {
  return new Set(tokens.filter((t) => STRUCTURAL_WORDS.has(t)));
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function jaccard(a, b) {
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

// Cœur de la décision. Prend deux sujets bruts (texte tel que tapé), jamais
// pré-normalisés par l'appelant — la normalisation et le retrait des
// stopwords sont toujours faits ici, au même endroit, pour ne jamais risquer
// une comparaison entre représentations incohérentes.
function isSafeTopicEquivalent(topicA, topicB) {
  const tokensA = contentTokens(topicA);
  const tokensB = contentTokens(topicB);

  // Sujet réduit à des mots-outils (rare, déjà filtré en amont par la
  // validation de longueur du sujet côté route) : jamais de match par
  // défaut plutôt que de traiter un ensemble vide comme "compatible avec tout".
  if (!tokensA.length || !tokensB.length) return false;

  const structA = structuralWordsOf(tokensA);
  const structB = structuralWordsOf(tokensB);
  if (!setsEqual(structA, structB)) return false; // gate binaire, jamais pondéré

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  const extraTokens = [...smaller].filter((t) => !larger.has(t)).length;
  if (extraTokens > MAX_EXTRA_CONTENT_TOKENS) return false;

  return jaccard(setA, setB) >= MIN_JACCARD_SCORE;
}

// candidates : sujets déjà générés à comparer, chacun { slot, level, topicText }.
// Ne fait aucun accès réseau/DB — l'appelant (server.js) est responsable de
// charger les candidats (même niveau uniquement, cf. §8 du chantier) et de
// leur fournir le texte de recherche d'origine (searchTopic/sourceName).
// Isolé ainsi pour rester remplaçable plus tard par un index inversé
// PostgreSQL ou pg_trgm sans toucher à la logique de décision elle-même.
function findEquivalentCustomTopic(topic, candidates) {
  for (const candidate of candidates || []) {
    if (!candidate || !candidate.topicText) continue;
    if (isSafeTopicEquivalent(topic, candidate.topicText)) return candidate;
  }
  return null;
}

// Un slot "sujet libre" a la forme notion:custom:{16 hex}[:{level}] (cf.
// server.js, POST /api/users/notion-quizzes/custom). Isolé ici pour rester
// pur/testable — server.js s'en sert pour filtrer les candidats du niveau 2
// au même niveau pédagogique que la recherche en cours (§8 du chantier :
// jamais de substitution entre niveaux différents).
const CUSTOM_TOPIC_SLOT_PREFIX = "notion:custom:";
const CUSTOM_TOPIC_SLOT_ID_LENGTH = 16;

function parseCustomTopicSlotLevel(slot) {
  const value = String(slot || "");
  if (!value.startsWith(CUSTOM_TOPIC_SLOT_PREFIX)) return undefined;
  const rest = value.slice(CUSTOM_TOPIC_SLOT_PREFIX.length + CUSTOM_TOPIC_SLOT_ID_LENGTH);
  if (!rest) return null;
  return rest.startsWith(":") ? rest.slice(1) : undefined;
}

module.exports = {
  STOPWORDS,
  STRUCTURAL_WORDS,
  normalizeTopicText,
  contentTokens,
  structuralWordsOf,
  isSafeTopicEquivalent,
  findEquivalentCustomTopic,
  parseCustomTopicSlotLevel
};
