"use strict";

// Vérification de clarté/identité du sujet (demande du 06/09/2026, incident
// réel "Baudouin de Hainaut" : la recherche de sources a ramené à la fois le
// diplomate du XIIIe siècle et Baudouin IV de Hainaut, comte du XIIe siècle,
// et Luna a rédigé une fiche unique mélangeant les deux personnages).
//
// Principe : jamais un nouveau critic, jamais un nouvel appel IA dédié —
// cette vérification est un CHAMP SUPPLÉMENTAIRE demandé dans la réponse
// JSON d'un appel Luna qui lit déjà les sources avant de rédiger
// (buildCurriculumPrompt pour le pipeline progressif, buildFicheAndKnowledge
// AdmissionPrompt pour le pipeline legacy) — jamais une passe séparée. Voir
// leurs commentaires respectifs pour le point d'intégration exact.
//
// Fichier volontairement PUR (aucun réseau, aucun appel IA), même principe
// que lib/knowledge-admission.js / lib/web-search-grounding.js : construit
// le morceau de prompt partagé et interprète une réponse déjà reçue.
//
// Conservateur par construction (demande explicite : "ne pas surdétecter") :
// toute réponse malformée, absente, ou dont les candidats ne sont pas
// exploitables retombe sur "valid" plutôt que de bloquer une génération —
// jamais l'inverse. Un sujet large ou à plusieurs facettes reste "valid" ;
// seule la certitude que les sources mélangent plusieurs référents
// RÉELLEMENT distincts doit produire "ambiguous".

// 2 à 4 candidats maximum (demande explicite) : assez pour couvrir les cas
// réels (homonymes, sens multiples d'un même mot) sans jamais transformer la
// désambiguïsation en questionnaire à choix multiples.
const MIN_TOPIC_VALIDATION_CANDIDATES = 2;
const MAX_TOPIC_VALIDATION_CANDIDATES = 4;

function sanitizeShortText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

// Bloc d'instructions partagé, injecté tel quel dans les deux prompts
// concernés — jamais dupliqué/reformulé différemment d'un appelant à
// l'autre, pour ne jamais faire dériver leur comportement l'un de l'autre.
// `hasSources` : true quand un vrai texte de sources web (groundingText/
// identifiedSourcesBlock) est injecté juste au-dessus dans le même prompt —
// la vérification porte alors PRINCIPALEMENT sur la cohérence de CES
// sources (cf. demande : "la décision ne doit pas être basée uniquement sur
// le texte saisi par l'utilisateur"), jamais seulement sur les connaissances
// propres du modèle quand elles sont disponibles.
function buildTopicValidationInstructions(subject, hasSources) {
  return [
    "",
    `Avant toute chose : vérifie que "${subject}" désigne un référent UNIQUE et non ambigu, ${hasSources ? "au vu des sources ci-dessus" : "au vu de tes connaissances (aucune source externe fiable n'a été trouvée pour ce sujet)"}.`,
    "Cherche spécifiquement des signaux de CONFUSION ENTRE PLUSIEURS RÉFÉRENTS DISTINCTS partageant un nom identique ou très proche : des personnes différentes (homonymes), des dates ou périodes incompatibles, des fonctions/titres contradictoires, des lieux incompatibles, des événements qui appartiennent manifestement à des sujets différents, des concepts différents partageant le même terme, des œuvres/lieux/organisations distincts portant un nom identique ou très proche.",
    "Un simple désaccord documentaire sur UN MÊME référent (une nuance, une date qui diverge légèrement, une formulation différente entre deux sources) n'est PAS une ambiguïté. Un sujet vaste, avec plusieurs sous-thèmes, plusieurs facettes ou plusieurs périodes abordées, n'est PAS non plus une ambiguïté. Seule la certitude que plusieurs référents RÉELLEMENT DISTINCTS sont mélangés doit déclencher \"ambiguous\" — en cas de doute réel, réponds toujours \"valid\".",
    "S'il existe un référent dominant clair malgré une homonymie apparente (ex. \"Napoléon\" → Napoléon Ier), réponds \"valid\" (tu peux normaliser l'intitulé dans \"normalizedTopic\", sinon laisse-le à null).",
    "Si et seulement si tu es réellement certain que plusieurs référents distincts sont mélangés, réponds \"ambiguous\" avec 2 à 4 candidats maximum : pour chacun, un \"label\" court (le nom exact de ce référent précis) et une \"description\" très courte permettant à un utilisateur de comprendre immédiatement la différence avec les autres candidats.",
    "Si le statut est \"ambiguous\", NE RÉDIGE RIEN D'AUTRE : réponds uniquement l'objet JSON topicValidation tel que décrit plus bas, sans fiche, sans plan pédagogique, sans connaissances, sans aucun autre champ.",
    "Si le statut est \"valid\" mais qu'une des sources fournies concerne manifestement un AUTRE référent que celui retenu (un homonyme), ignore purement et simplement cette source pour la suite : ne mélange jamais dans un même contenu des faits provenant de référents différents."
  ];
}

// Garde-fou de rédaction (demande du 06/09/2026, section "même lorsque
// status = valid") : à injecter tel quel dans tout prompt de RÉDACTION de
// paragraphe qui reçoit encore le texte brut des sources (buildElementaryFichePrompt/
// buildProgressiveContinuationFichePrompt, pipeline progressif) — même quand
// l'identité du sujet a déjà été validée en amont (curriculum_generation),
// ces appels restent exposés au texte COMPLET des sources, y compris
// d'éventuels passages concernant un autre référent que celui retenu. Jamais
// un second appel IA, jamais une seconde vérification structurée : une seule
// phrase de rappel, au même endroit où le texte des sources est déjà injecté.
function buildSourceMixingGuardRailLine() {
  return "Attention : si une phrase ou un passage de ces sources concerne manifestement un AUTRE référent que le sujet exact traité ici (un homonyme, une personne, un lieu ou un événement différent portant un nom identique ou très proche), ignore-le purement et simplement — ne mélange jamais dans ce texte des faits provenant de référents différents.";
}

// Exemple JSON à coller tel quel dans la consigne de sortie de chaque
// appelant (jamais reformulé différemment d'un prompt à l'autre).
const TOPIC_VALIDATION_AMBIGUOUS_JSON_EXAMPLE =
  '{"topicValidation":{"status":"ambiguous","reason":"phrase courte en français expliquant l\'ambiguïté, destinée à être affichée à l\'utilisateur","candidates":[{"label":"...","description":"..."},{"label":"...","description":"..."}]}}';

// Interprète le champ `topicValidation` d'une réponse déjà parsée en JSON.
// Conservateur par construction : absent, malformé, statut inconnu, ou
// moins de deux candidats réellement exploitables (label ET description non
// vides) → "valid" sans aucun candidat, jamais un blocage sur une réponse
// mal formée. `subject` n'est utilisé que par l'appelant pour ses logs.
function parseTopicValidationField(raw) {
  const status = sanitizeShortText(raw?.status, 20).toLowerCase();
  if (status !== "ambiguous") {
    return { status: "valid", normalizedTopic: sanitizeShortText(raw?.normalizedTopic, 150) || null, reason: null, candidates: [] };
  }
  const rawCandidates = Array.isArray(raw?.candidates) ? raw.candidates : [];
  const candidates = [];
  for (const c of rawCandidates) {
    const label = sanitizeShortText(c?.label, 120);
    const description = sanitizeShortText(c?.description, 200);
    if (!label || !description) continue;
    candidates.push({ label, description });
    if (candidates.length >= MAX_TOPIC_VALIDATION_CANDIDATES) break;
  }
  if (candidates.length < MIN_TOPIC_VALIDATION_CANDIDATES) {
    // Une "ambiguïté" sans au moins deux candidats exploitables n'offre
    // aucun choix réel à proposer à l'utilisateur — jamais bloquer sur ce
    // cas, retombe simplement sur "valid" (comme une réponse mal formée).
    return { status: "valid", normalizedTopic: null, reason: null, candidates: [] };
  }
  return {
    status: "ambiguous",
    normalizedTopic: null,
    reason: sanitizeShortText(raw?.reason, 300) || null,
    candidates
  };
}

module.exports = {
  MIN_TOPIC_VALIDATION_CANDIDATES,
  MAX_TOPIC_VALIDATION_CANDIDATES,
  buildTopicValidationInstructions,
  buildSourceMixingGuardRailLine,
  TOPIC_VALIDATION_AMBIGUOUS_JSON_EXAMPLE,
  parseTopicValidationField
};
