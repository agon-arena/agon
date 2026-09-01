"use strict";

// V2 du moteur "À apprendre ensuite" (mission du 27/08/2026) : couche
// COMPLÉMENTAIRE, jamais un remplacement de la V1. N'intervient que lorsque
// le catalogue Mnoria n'offre pas assez de bons candidats CONNECTÉS au
// graphe de l'utilisateur (cf. engine.js qualitySignal) — jamais pour
// remplir artificiellement un limit, jamais sur un profil quasi vide.
//
// Fichier volontairement PUR (aucun accès réseau/Supabase, aucun appel IA
// ici — cf. test/learn-next-no-ai-calls.test.js) : construit le contexte et
// le prompt, valide/nettoie une réponse déjà reçue. L'appel HTTP réel vers
// Le fournisseur IA reste dans server.js, qui réutilise le helper JSON-mode déjà utilisé ailleurs dans le projet
// (même helper que le reste du projet) — jamais un deuxième client IA.

const crypto = require("crypto");
const { isSafeTopicEquivalent } = require("../topic-dedup");

// ── Déclenchement (revue du 30/08/2026) ─────────────────────────────────────
// "V1 suffisante" = elle a déjà rempli toutes les places demandées avec des
// candidats réellement pertinents (isGoodCandidate, cf. engine.js) — l'appelant
// (server.js) calcule `neededCount = cible - recommendations.length` et ne
// sollicite l'IA que si des places restent vides. "Profil quasi vide" reste un
// vrai cas particulier : à 0 acquisition (coldStart), aucun LLM ne peut
// légitimement déduire un trou pédagogique plutôt qu'inventer — V1 (mode
// découverte) reste alors seule. Dès qu'il existe au moins une acquisition,
// en revanche, rien n'empêche plus l'IA de compléter (l'ancien plancher de 4
// acquisitions ne se justifiait plus une fois le calcul du "besoin" exact).
function shouldTriggerFallback({ neededCount, coldStart }, config) {
  if (!config.AI_FALLBACK_ENABLED) return false;
  if (coldStart) return false;
  if (!(neededCount > 0)) return false;
  return true;
}

// Catégorie de maîtrise envoyée au LLM (section 12 : jamais la retrievability
// exacte, qui n'apporte rien au prompt et complique inutilement le format —
// une catégorie grossière suffit à faire la différence entre un acquis
// solide et un acquis encore fragile).
function retrievabilityToMasteryLabel(retrievability) {
  if (typeof retrievability !== "number" || !Number.isFinite(retrievability)) return "medium";
  if (retrievability >= 0.75) return "solid";
  if (retrievability >= 0.45) return "medium";
  return "fragile";
}

// ── Construction du contexte compact (section 3) ────────────────────────────
// acquisitions : [{ key, name, solarSystemId }], déjà limité aux types
// partageables par l'appelant (server.js) — jamais un import personnel ou un
// quiz "comprendre" dans ce qui nourrit un contexte potentiellement mutualisé
// entre utilisateurs (cf. gap_signature ci-dessous).
function selectSeedTopics(acquisitions, masteryByKey, solarNamesById, config) {
  return acquisitions
    .map((a) => ({
      key: a.key,
      name: a.name,
      solarName: a.solarSystemId ? (solarNamesById.get(a.solarSystemId) || null) : null,
      retrievability: masteryByKey.has(a.key) ? masteryByKey.get(a.key) : null
    }))
    .filter((t) => t.name)
    .sort((a, b) => (b.retrievability ?? 0) - (a.retrievability ?? 0))
    .slice(0, config.AI_FALLBACK_SEED_TOPIC_LIMIT)
    .map((t) => ({ ...t, masteryLabel: retrievabilityToMasteryLabel(t.retrievability) }));
}

function selectDominantBranches(acquisitions, solarNamesById, config) {
  const counts = new Map();
  for (const a of acquisitions) {
    if (!a.solarSystemId) continue;
    counts.set(a.solarSystemId, (counts.get(a.solarSystemId) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, config.AI_FALLBACK_DOMINANT_BRANCHES_LIMIT)
    .map(([solarId]) => solarNamesById.get(solarId))
    .filter(Boolean);
}

// Signature déterministe d'une "zone du graphe" — sert à la fois de clé de
// mutualisation (deux utilisateurs avec le même noyau d'acquis solides
// réutilisent la même proposition, cf. section 2/7) et à ne jamais faire
// dépendre le cache d'un ordre de calcul. Basée UNIQUEMENT sur les clés
// (type::sourceId) des seed topics — jamais une info personnelle (jamais
// legacyKey/userId, cf. section 12).
function computeGapSignature(seedTopics) {
  const keys = [...new Set(seedTopics.map((t) => t.key))].sort();
  return crypto.createHash("sha256").update(keys.join("|")).digest("hex").slice(0, 32);
}

// Objet de contexte compact — jamais un dump de mémoire (section 3) : bornes
// strictes déjà appliquées à la sélection (seed topics/branches/candidats
// existants), plus une garde de taille totale par sécurité.
function buildFallbackContext({ seedTopics, dominantBranches, existingCandidateNames }, config) {
  const context = {
    seedTopics: seedTopics.map((t) => ({ name: t.name, masteryLabel: t.masteryLabel, branch: t.solarName })),
    dominantBranches,
    existingCandidateNames: (existingCandidateNames || []).slice(0, config.AI_FALLBACK_EXISTING_CANDIDATES_LIMIT)
  };
  let serialized = JSON.stringify(context);
  // Garde-fou dur (section 3 : "pas de dump complet") : si malgré les
  // plafonds déjà appliqués à la sélection le contexte dépasse la taille
  // maximale (noms de connaissances exceptionnellement longs), retire les
  // entrées les moins prioritaires (fin de chaque liste) jusqu'à rentrer
  // dans la limite plutôt que d'envoyer un prompt surdimensionné.
  while (serialized.length > config.AI_FALLBACK_CONTEXT_MAX_CHARS) {
    if (context.existingCandidateNames.length > 0) context.existingCandidateNames.pop();
    else if (context.dominantBranches.length > 1) context.dominantBranches.pop();
    else if (context.seedTopics.length > 2) context.seedTopics.pop();
    else break;
    serialized = JSON.stringify(context);
  }
  return context;
}

// ── Prompt (section 5) ───────────────────────────────────────────────────
function buildFallbackPrompt(context, config) {
  const seedLines = context.seedTopics
    .map((t) => `- ${t.name} (maîtrise: ${t.masteryLabel}${t.branch ? `, branche: ${t.branch}` : ""})`)
    .join("\n") || "(aucun)";
  const branchLines = context.dominantBranches.length ? context.dominantBranches.join(", ") : "(aucune identifiée)";
  const avoidLines = context.existingCandidateNames.length
    ? context.existingCandidateNames.map((n) => `- ${n}`).join("\n")
    : "(aucun)";

  // Profil encore pauvre (revue du 30/08/2026, point 4 de la demande) : avec
  // très peu de connaissances maîtrisées, un "pont" ou un "prolongement"
  // précis prétendrait une personnalisation que les données ne permettent pas
  // réellement. On ne baisse pas le nombre de propositions pour autant — on
  // réoriente juste la priorité vers les critères 3/4 déjà listés plus bas
  // (notion structurante, découverte adjacente), plus sûrs sur un signal faible.
  const thinProfileNote = context.seedTopics.length < 3
    ? [
        "",
        "ATTENTION, profil encore limité (très peu de connaissances maîtrisées listées ci-dessus) : ne prétends PAS à une personnalisation fine que ce signal réduit ne permet pas. Privilégie une notion structurante ou une découverte pertinente (critères 3 et 4 ci-dessous) plutôt qu'un pont ou un prolongement qui forcerait un lien ténu avec la ou les seules connaissances listées."
      ].join("\n")
    : "";

  return [
    "Réponds uniquement en JSON valide.",
    "Mnoria est une application de mémorisation par QCM. Pour un utilisateur donné, nous cherchons la prochaine connaissance ayant le PLUS DE VALEUR PÉDAGOGIQUE pour lui — pas un sujet au hasard, pas le plus populaire, mais celui qui prolonge le mieux ce qu'il maîtrise déjà.",
    "Voici ce que cet utilisateur maîtrise déjà (connaissances les plus solides, avec leur niveau de maîtrise et leur branche thématique) :",
    seedLines,
    "",
    `Ses branches thématiques dominantes : ${branchLines}`,
    thinProfileNote,
    "",
    "Le catalogue actuel de Mnoria n'a PAS trouvé de candidat suffisamment pertinent pour cet utilisateur en dehors de ceux-ci (ne propose surtout rien d'équivalent à cette liste) :",
    avoidLines,
    "",
    "Propose au maximum 3 NOUVEAUX sujets d'apprentissage, dans cet ordre de priorité :",
    "1. un sujet qui permet de RELIER plusieurs de ses connaissances déjà maîtrisées, idéalement dans des branches différentes ;",
    "2. un prolongement naturel situé juste au-delà de ce qu'il connaît déjà ;",
    "3. une notion structurante qui lui manque manifestement ;",
    "4. une ouverture pertinente vers un domaine adjacent à ses branches dominantes.",
    "N'ÉCARTE ces critères stricts sous AUCUN prétexte :",
    "- jamais un sujet déjà connu de l'utilisateur ou équivalent à un sujet déjà listé ci-dessus ;",
    "- jamais une simple reformulation d'un des sujets déjà maîtrisés ;",
    "- jamais un détail extrêmement spécialisé ou une sous-partie trop pointue sans lien clair avec ses connaissances — une formulation assez large reste préférable à un sujet trop pointu ;",
    "- jamais une simple anecdote (trivia) sans valeur d'apprentissage réelle ;",
    "- jamais un sujet qui suppose une connaissance manifestement absente de la liste ci-dessus ;",
    "- jamais un sujet choisi uniquement parce qu'il serait populaire ou tendance — uniquement sa pertinence pour CET utilisateur précis.",
    "Si tu ne trouves aucun sujet qui remplit vraiment ces critères, retourne un tableau `proposals` vide plutôt qu'un sujet approximatif.",
    "",
    "Pour chaque proposition, fournis :",
    "- title : titre court du sujet, formulé de façon plutôt générale qu'hyper spécifique (jamais une question, jamais une phrase complète) ;",
    "- reason : 1 phrase concrète expliquant en quoi ce sujet relie/prolonge SPÉCIFIQUEMENT les connaissances citées (jamais une généralité) ;",
    "- related_known_topics : les noms EXACTS (recopiés tels quels ci-dessus) des connaissances déjà maîtrisées auxquelles ce sujet se relie ;",
    "- suggested_theme : le domaine général du sujet (ex. \"Histoire\", \"Sciences\"), quelques mots ;",
    `- difficulty : "elementaire", "avance" ou "expert" selon la profondeur naturelle du sujet ;`,
    `- proposal_type : "bridge" si le sujet relie au moins 2 branches différentes listées ci-dessus, "continuity" s'il prolonge une seule connaissance/branche, "discovery" s'il ouvre un domaine adjacent nouveau.`,
    "",
    'Format obligatoire : {"proposals":[{"title":"...","reason":"...","related_known_topics":["..."],"suggested_theme":"...","difficulty":"...","proposal_type":"..."}]}'
  ].join("\n");
}

// ── Validation stricte de la réponse IA (jamais de confiance aveugle) ──────
function sanitizeProposal(raw, context, config) {
  const title = String(raw?.title || "").trim().replace(/\s+/g, " ").slice(0, config.AI_FALLBACK_MAX_TITLE_LENGTH);
  if (title.length < 3) return null;
  const reason = String(raw?.reason || "").trim().replace(/\s+/g, " ").slice(0, config.AI_FALLBACK_MAX_REASON_LENGTH);
  if (!reason) return null;

  const knownNames = new Set(context.seedTopics.map((t) => t.name));
  const relatedKnownTopics = (Array.isArray(raw?.related_known_topics) ? raw.related_known_topics : [])
    .map((n) => String(n || "").trim())
    .filter((n) => knownNames.has(n))
    .slice(0, 4);

  const suggestedTheme = String(raw?.suggested_theme || "").trim().slice(0, config.AI_FALLBACK_MAX_THEME_LENGTH) || null;
  const difficulty = config.AI_FALLBACK_ALLOWED_DIFFICULTIES.includes(raw?.difficulty) ? raw.difficulty : "avance";
  const proposalType = config.AI_FALLBACK_ALLOWED_PROPOSAL_TYPES.includes(raw?.proposal_type) ? raw.proposal_type : "continuity";

  return { title, reason, relatedKnownTopics, suggestedTheme, difficulty, proposalType };
}

// rawContent : la chaîne JSON brute retournée par le LLM (déjà extraite par
// l'appelant, cf. le helper JSON-mode déjà utilisé ailleurs dans le projet) — jamais parsée ailleurs.
// N'écarte JAMAIS la fonction en cas d'échec : un JSON invalide/vide donne
// simplement un tableau vide (best-effort, cf. section 15 de la mission).
function parseFallbackProposals(rawContent, context, config) {
  if (!rawContent) return [];
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return [];
  }
  const rawProposals = Array.isArray(parsed?.proposals) ? parsed.proposals : [];
  const seenTitles = new Set();
  const proposals = [];
  for (const raw of rawProposals) {
    const proposal = sanitizeProposal(raw, context, config);
    if (!proposal) continue;
    const dedupeKey = proposal.title.toLowerCase();
    if (seenTitles.has(dedupeKey)) continue;
    seenTitles.add(dedupeKey);
    proposals.push(proposal);
    if (proposals.length >= config.AI_FALLBACK_MAX_PROPOSALS) break;
  }
  return proposals;
}

// ── Déduplication contre le catalogue existant (section 6) ─────────────────
// existingTopics : [{ name, slot, quizDate }] déjà générés (n'importe quel
// sujet libre "notion:custom:*", cf. server.js) — récupéré par l'appelant
// (une seule fois, jamais par proposition) ; réutilise isSafeTopicEquivalent
// tel quel, jamais une nouvelle heuristique de similarité.
function matchExistingTopic(proposalTitle, existingTopics) {
  for (const existing of existingTopics) {
    if (existing.name && isSafeTopicEquivalent(proposalTitle, existing.name)) return existing;
  }
  return null;
}

// Sépare les propositions IA en "à réutiliser" (un sujet quasi identique
// existe déjà dans le catalogue — jamais une nouvelle génération, cf. section
// 6) et "réellement nouvelles" (rien d'équivalent, à afficher comme
// proposition de création, cf. section 4/8).
function resolveProposalsAgainstCatalog(proposals, existingTopics) {
  const resolved = [];
  for (const proposal of proposals) {
    const match = matchExistingTopic(proposal.title, existingTopics);
    if (match) {
      resolved.push({ ...proposal, isNew: false, existingSlot: match.slot, existingQuizDate: match.quizDate, existingName: match.name });
    } else {
      resolved.push({ ...proposal, isNew: true });
    }
  }
  return resolved;
}

// Exclusion contre les places déjà occupées par le catalogue DANS CETTE
// RÉPONSE PRÉCISE (point 5 de la revue du 30/08/2026) — complémentaire à
// resolveProposalsAgainstCatalog (qui compare au catalogue global "notion:custom:*")
// et à l'avoid-list déjà envoyée au LLM dans le prompt (existingCandidateNames) :
// filet de sécurité final avant troncature à `neededCount`, jamais une nouvelle
// heuristique de similarité (réutilise isSafeTopicEquivalent tel quel).
function excludeAlreadyPicked(resolved, pickedNames) {
  if (!pickedNames || !pickedNames.length) return resolved;
  return resolved.filter((proposal) => {
    const title = proposal.isNew ? proposal.title : proposal.existingName;
    return !pickedNames.some((name) => name && title && isSafeTopicEquivalent(title, name));
  });
}

module.exports = {
  shouldTriggerFallback,
  retrievabilityToMasteryLabel,
  selectSeedTopics,
  selectDominantBranches,
  computeGapSignature,
  buildFallbackContext,
  buildFallbackPrompt,
  parseFallbackProposals,
  matchExistingTopic,
  resolveProposalsAgainstCatalog,
  excludeAlreadyPicked
};
