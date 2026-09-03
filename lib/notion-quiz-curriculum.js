"use strict";

// Génération progressive du pipeline QCM — Phase 1 (02/09/2026), taille
// FLEXIBLE (02/09/2026, suite — "le nombre de connaissances utiles
// détermine la taille du parcours, les niveaux sont des proportions du
// curriculum, jamais des quotas fixes"). Plan pédagogique de 15 à 20
// connaissances, choisi et vérifié AVANT toute rédaction de fiche et toute
// génération de question — objectif : pouvoir servir un premier bloc
// "elementary" (dont la taille dépend elle-même du curriculum réel) sans
// attendre les 15-20 questions du master complet.
//
// Fichier volontairement PUR (aucun réseau, aucun appel IA), même principe
// que lib/knowledge-admission.js / lib/web-search-grounding.js : construit
// les prompts, parse/valide des réponses IA déjà reçues. L'orchestration
// réelle (appels _callOpenAI, boucle de réparation) reste dans server.js
// (resolveProgressiveCurriculum).
//
// Principe central (INCHANGÉ depuis la version à quota fixe, juste
// généralisé) : le "level" d'une connaissance n'est JAMAIS décidé par le
// modèle — toujours dérivé, côté code, de sa position (`order`) une fois le
// curriculum final normalisé et de la taille totale N. `computeCurriculum
// Split(N)` calcule cette proportion 25 % elementary / 25 % deepening /
// 50 % expert (avec un plancher de 4 par petit niveau) ; `levelForOrder`
// applique cette proportion à une position donnée.

const { lexicalSimilarity } = require("./qcm-quality");
const { normalizeFactText } = require("./question-formats");

// Bornes du curriculum (remplacent l'ancien total fixe de 20). Le principe
// demandé : "ne complète jamais artificiellement le curriculum avec des
// connaissances faibles ou répétitives juste pour atteindre 20" — 20 reste
// un plafond souhaitable, jamais un plancher obligatoire ; 15 reste le
// minimum en dessous duquel un apprentissage progressif est jugé trop pauvre
// (échec propre CURRICULUM_INCOMPLETE, cf. server.js).
const MIN_PROGRESSIVE_CURRICULUM = 15;
const MAX_PROGRESSIVE_CURRICULUM = 20;

// Plancher par petit niveau (elementary/deepening) pour éviter un bloc trop
// court même sur un curriculum réduit à 15 — jamais appliqué à "expert", qui
// reçoit toujours le reste. Pour tout N dans [MIN_PROGRESSIVE_CURRICULUM,
// MAX_PROGRESSIVE_CURRICULUM] (le seul domaine réellement utilisé par
// resolveProgressiveCurriculum, qui échoue proprement avant d'appeler cette
// fonction si le curriculum final a moins de MIN_PROGRESSIVE_CURRICULUM
// éléments), ce plancher ne modifie jamais le résultat de l'arrondi simple
// ci-dessous — il ne sert que de garde-fou défensif.
const MIN_LEVEL_SIZE = 4;

// Recouvrement lexical au-delà duquel deux knowledgeTarget sont jugés "quasi
// équivalents" (demande explicite : "aucune connaissance dupliquée ou quasi
// équivalente"). Même fonction que REORDERED_DUPLICATE_OPTION
// (lib/qcm-quality.js, seuil 0.82) mais légèrement plus bas : deux
// knowledgeTarget sont des phrases ENTIÈRES comparées entre elles (jamais
// deux options d'une même question), un recouvrement élevé y est donc un
// signal de redite plus souvent réel qu'un hasard lexical.
const NEAR_DUPLICATE_THRESHOLD = 0.75;

// Répartition 25 % elementary / 25 % deepening / 50 % expert d'un curriculum
// de N connaissances. Convention d'arrondi choisie (documentée et vérifiée
// pour tout N de 15 à 20, cf. test/notion-quiz-curriculum.test.js) :
//   elementary = max(MIN_LEVEL_SIZE, round(N * 0.25))
//   deepening  = max(MIN_LEVEL_SIZE, round((N - elementary) / 3))
//   expert     = N - elementary - deepening
// `deepening` est calculé comme UN TIERS du reste après elementary (jamais
// N * 0.25 directement) parce que deepening et expert se partagent ce reste
// dans un rapport 25:50, soit exactement 1:2 — un tiers du reste pour
// deepening reproduit donc fidèlement le ratio 25/25/50 même quand les
// arrondis de l'élémentaire décalent légèrement le total restant. C'est ce
// choix, et seulement lui, qui reproduit exactement la table attendue
// (15→4/4/7, 16→4/4/8, 17→4/4/9, 18→5/4/9, 19→5/5/9, 20→5/5/10) plutôt qu'un
// double round(N*0.25) naïf pour elementary ET deepening (qui donnerait par
// exemple 5/5/8 pour N=18 au lieu de 5/4/9).
function computeCurriculumSplit(total) {
  const n = Number(total);
  if (!Number.isInteger(n) || n <= 0) return { elementary: 0, deepening: 0, expert: 0 };
  const elementary = Math.max(MIN_LEVEL_SIZE, Math.round(n * 0.25));
  const deepening = Math.max(MIN_LEVEL_SIZE, Math.round((n - elementary) / 3));
  const expert = Math.max(0, n - elementary - deepening);
  return { elementary, deepening, expert };
}

// Niveau attendu pour la position `order` (1..total) d'un curriculum déjà
// normalisé (order contigu 1..N, cf. normalizeCurriculumOrder) — SEULE
// source de vérité du niveau, jamais un champ "level" renvoyé par l'IA.
function levelForOrder(order, total) {
  const split = computeCurriculumSplit(total);
  if (!Number.isInteger(order) || order < 1 || order > total) return null;
  if (order <= split.elementary) return "elementary";
  if (order <= split.elementary + split.deepening) return "deepening";
  return "expert";
}

// `identifiedSourcesBlock` (V1 evidence grounding, 03/09/2026, cf. audit
// read-only du même jour — "déplacer la preuve en amont") : optionnel,
// bloc SOURCE_1/SOURCE_2/... avec texte réel (lib/web-search-grounding.js
// formatIdentifiedSourcesBlock), jamais fourni par l'appelant legacy. Absent
// (comportement de TOUS les appelants avant ce paramètre), le prompt produit
// reste identique au caractère près — seul server.js resolveProgressiveCurriculum
// le fournit désormais, UNIQUEMENT quand grounding.identifiedSources existe
// réellement (bloc Elementary progressif grounded, périmètre strict de cette
// V1 — jamais le pipeline legacy/master, qui ne fournit jamais ce paramètre).
// Quand fourni, remplace ENTIÈREMENT `groundingText` dans le prompt (même
// contenu, sous une forme citable par identifiant stable) : demande en plus
// à chaque connaissance retenue un "source_id" + "evidence_text" — un
// extrait copié TEXTUELLEMENT, jamais une paraphrase, jamais une invention.
function buildCurriculumPrompt(subject, contextHint, groundingText = null, identifiedSourcesBlock = null) {
  const lines = [
    `Tu prépares le PLAN PÉDAGOGIQUE d'un futur parcours d'apprentissage sur : "${subject}".`,
    "Ton seul travail ici est de choisir QUELLES connaissances méritent d'être apprises et de les ORDONNER pédagogiquement — jamais de rédiger de fiche, jamais de questions à ce stade.",
    contextHint ? `Contexte d'origine (pour cerner le sujet, sans le résumer) : ${contextHint}` : null
  ];
  if (identifiedSourcesBlock) {
    lines.push("");
    lines.push("Voici les sources web réellement trouvées sur ce sujet, chacune identifiée par un identifiant stable (SOURCE_1, SOURCE_2...) — fonde ton choix PRINCIPALEMENT dessus. N'utilise ta mémoire que pour du contexte général ou des connaissances de base incontestables — jamais pour un fait précis absent de ces sources.");
    lines.push(identifiedSourcesBlock);
  } else if (groundingText) {
    lines.push("");
    lines.push("Voici de VRAIES sources web trouvées sur ce sujet — fonde ton choix PRINCIPALEMENT dessus. N'utilise ta mémoire que pour du contexte général ou des connaissances de base incontestables — jamais pour un fait précis absent de ces sources.");
    lines.push(groundingText);
  }
  lines.push(
    "",
    "Choisis ENTRE 15 ET 20 connaissances — privilégie la QUALITÉ et une bonne couverture du sujet plutôt qu'un nombre fixe : vise 20 quand le sujet le permet naturellement, mais accepte-en moins (15 au minimum) si le sujet n'offre pas légitimement plus de connaissances vraiment distinctes et solides.",
    "N'invente jamais une connaissance faible, obscure ou redondante uniquement pour atteindre un total plus élevé, et ne découpe jamais artificiellement une même connaissance en plusieurs entrées pour gonfler le compte.",
    "Chaque connaissance doit être une CIBLE D'APPRENTISSAGE précise (un fait, une relation, une définition) suffisamment ciblée pour produire une bonne question — jamais un thème vague, jamais un simple mot-clé.",
    "Aucune connaissance ne doit se recouper avec une autre, même partiellement — chaque \"knowledgeTarget\" doit apporter une information réellement distincte des autres. Ceci vaut aussi entre deux formulations différentes du MÊME fait : deux définitions ou deux descriptions d'un même mécanisme, même écrites avec des mots différents, ne comptent jamais comme deux connaissances distinctes — seule une information factuelle nouvelle justifie une entrée séparée.",
    "ORDONNE la liste du socle le plus indispensable vers les connaissances les plus avancées : les toutes premières doivent être ce qu'il faut absolument savoir pour une première compréhension correcte du sujet, les dernières les nuances, controverses, mécanismes précis ou détails les plus spécialisés — une vraie progression de difficulté CROISSANTE, jamais un ordre arbitraire. Tu n'as PAS à indiquer toi-même quelles connaissances sont \"elementary\", \"deepening\" ou \"expert\" : ce découpage sera calculé automatiquement à partir de ton ordre et du nombre total de connaissances retenues."
  );
  if (identifiedSourcesBlock) {
    lines.push(
      "",
      "Pour CHAQUE connaissance retenue, fournis également la PREUVE textuelle exacte d'où elle vient :",
      "- \"source_id\" : l'identifiant EXACT (SOURCE_1, SOURCE_2...) d'UNE des sources ci-dessus qui contient réellement cette information — jamais un identifiant inventé ou absent de la liste.",
      "- \"evidence_text\" : un extrait COURT COPIÉ TEXTUELLEMENT (jamais paraphrasé, jamais reformulé, jamais résumé) depuis le texte de cette source, contenant suffisamment d'information pour soutenir réellement \"knowledgeTarget\". Ce n'est jamais une reformulation pédagogique : c'est une citation exacte, mot pour mot, telle qu'elle apparaît dans la source.",
      "N'invente jamais une citation qui n'existe pas littéralement dans la source citée — si tu ne trouves pas de passage réel qui soutient une connaissance par ailleurs valable, n'inclus simplement pas cette connaissance plutôt que de citer une preuve fabriquée.",
      "",
      'Réponds uniquement en JSON strict, sous la forme {"curriculum":[{"id":"k1","knowledgeTarget":"phrase factuelle courte et autonome","order":1,"source_id":"SOURCE_1","evidence_text":"extrait exact copié depuis SOURCE_1"}, ...]} — un objet par connaissance choisie (entre 15 et 20 au total), id de "k1" à "kN", order de 1 à N dans le même ordre pédagogique croissant.'
    );
  } else {
    lines.push(
      "",
      'Réponds uniquement en JSON strict, sous la forme {"curriculum":[{"id":"k1","knowledgeTarget":"phrase factuelle courte et autonome","order":1}, ...]} — un objet par connaissance choisie (entre 15 et 20 au total), id de "k1" à "kN", order de 1 à N dans le même ordre pédagogique croissant.'
    );
  }
  return lines.filter((line) => line !== null).join("\n");
}

// Parsing permissif et déterministe : un item malformé (knowledgeTarget
// vide, order hors [1, MAX_PROGRESSIVE_CURRICULUM], id/order en double) est
// silencieusement écarté plutôt que de faire échouer tout le curriculum —
// c'est précisément le rôle de la réparation ciblée (cf. missingCurriculum
// Count) de combler un manque. AUCUN champ "level" dans la forme parsée :
// même si le modèle en renvoie un, il n'est jamais lu ni conservé ici — le
// niveau final n'existe qu'après normalizeCurriculumOrder +
// assignCurriculumLevels, une fois la taille définitive du curriculum
// connue.
// source_id/evidence_text (V1 evidence grounding, 03/09/2026) : capturés
// UNIQUEMENT quand les DEUX sont des chaînes non vides — jamais l'un sans
// l'autre (une preuve sans source citable, ou une source sans preuve, n'a
// aucune valeur). Rétrocompatible au caractère près : un item sans ces deux
// champs (TOUS les appelants avant ce paramètre, et tout appel sans
// identifiedSourcesBlock) produit exactement {id, knowledgeTarget, order}
// comme avant, jamais de champs supplémentaires à undefined/null qui
// changeraient la forme de l'objet.
function parseCurriculumItems(raw) {
  if (!Array.isArray(raw)) return [];
  const items = [];
  const seenIds = new Set();
  const seenOrders = new Set();
  for (const entry of raw) {
    const id = typeof entry?.id === "string" ? entry.id.trim().slice(0, 20) : "";
    const knowledgeTarget = typeof entry?.knowledgeTarget === "string" ? entry.knowledgeTarget.trim().slice(0, 400) : "";
    const order = Number(entry?.order);
    if (!id || !knowledgeTarget) continue;
    if (!Number.isInteger(order) || order < 1 || order > MAX_PROGRESSIVE_CURRICULUM) continue;
    if (seenIds.has(id) || seenOrders.has(order)) continue;
    seenIds.add(id);
    seenOrders.add(order);
    const item = { id, knowledgeTarget, order };
    const sourceId = typeof entry?.source_id === "string" ? entry.source_id.trim().slice(0, 20) : "";
    const evidenceText = typeof entry?.evidence_text === "string" ? entry.evidence_text.trim().slice(0, 500) : "";
    if (sourceId && evidenceText) {
      item.source_id = sourceId;
      item.evidence_text = evidenceText;
    }
    items.push(item);
  }
  return items.sort((a, b) => a.order - b.order);
}

// Toutes les paires de connaissances jugées identiques ou quasi équivalentes
// — comparaison EXACTE (après normalisation) d'abord, puis recouvrement
// lexical (cf. NEAR_DUPLICATE_THRESHOLD). O(n²) sur au plus 20 éléments :
// négligeable.
function findNearDuplicates(list) {
  const pairs = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      const sameNormalized = normalizeFactText(a.knowledgeTarget) === normalizeFactText(b.knowledgeTarget);
      if (sameNormalized || lexicalSimilarity(a.knowledgeTarget, b.knowledgeTarget) >= NEAR_DUPLICATE_THRESHOLD) {
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

// Renormalise le curriculum ADMIS (déjà filtré aux connaissances acceptées,
// triées dans leur ordre pédagogique d'origine — y compris les ajouts de
// réparation, placés après les items d'origine, cf. server.js) : comble tout
// "trou" laissé par un rejet en réassignant id=k1..kN et order=1..N de façon
// strictement séquentielle. Pure, sans effet de bord — ne calcule PAS
// encore le niveau (cf. assignCurriculumLevels, appelée seulement après :
// le niveau dépend de la taille finale N, connue uniquement une fois cette
// normalisation faite).
// Spread de l'item AVANT id/order (V1 evidence grounding, 03/09/2026) :
// préserve source_id/evidence_text quand présents, jamais une reconstruction
// champ par champ qui les aurait silencieusement perdus en route. Aucun
// changement pour un item sans ces champs (comportement historique) : le
// spread d'un objet {id, knowledgeTarget, order} suivi de {id, order}
// écrasés produit exactement le même résultat qu'avant, au caractère près.
function normalizeCurriculumOrder(items) {
  const sorted = [...(Array.isArray(items) ? items : [])].sort((a, b) => a.order - b.order);
  return sorted.map((item, index) => ({ ...item, id: `k${index + 1}`, order: index + 1 }));
}

// Attache le niveau final à un curriculum déjà normalisé (order contigu
// 1..N) — dérivé exclusivement de la taille totale et de la position, via
// levelForOrder/computeCurriculumSplit. Jamais du champ "level" du modèle.
function assignCurriculumLevels(items) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  return list.map((item) => ({ ...item, level: levelForOrder(item.order, total) }));
}

// Un curriculum FINAL (normalisé + niveaux attachés) est complet quand : sa
// taille est dans [MIN_PROGRESSIVE_CURRICULUM, MAX_PROGRESSIVE_CURRICULUM],
// sa répartition par niveau correspond exactement à computeCurriculumSplit
// de sa propre taille (garanti par construction si le curriculum vient
// d'assignCurriculumLevels, revérifié explicitement pour rester robuste à
// un appelant qui passerait un curriculum construit autrement), et aucune
// quasi-équivalence ne subsiste entre deux connaissances.
function validateCurriculumComplete(curriculum) {
  const list = Array.isArray(curriculum) ? curriculum : [];
  const errors = [];
  if (list.length < MIN_PROGRESSIVE_CURRICULUM || list.length > MAX_PROGRESSIVE_CURRICULUM) {
    errors.push(`${list.length} connaissance(s), hors bornes [${MIN_PROGRESSIVE_CURRICULUM}-${MAX_PROGRESSIVE_CURRICULUM}]`);
  } else {
    const expectedSplit = computeCurriculumSplit(list.length);
    for (const [level, expectedCount] of Object.entries(expectedSplit)) {
      const count = list.filter((item) => item.level === level).length;
      if (count !== expectedCount) errors.push(`niveau "${level}" : ${count}/${expectedCount}`);
    }
  }
  for (const [a, b] of findNearDuplicates(list)) {
    errors.push(`connaissances quasi équivalentes : "${a.id}" et "${b.id}"`);
  }
  return { valid: errors.length === 0, errors };
}

// Nombre de connaissances qu'il manque pour atteindre une CIBLE donnée —
// jamais pour revenir à un quota supérieur déjà satisfait. Si le curriculum
// admis est déjà >= `target`, le résultat est 0 : aucune réparation n'est
// déclenchée. `target` par défaut = MIN_PROGRESSIVE_CURRICULUM (comportement
// historique inchangé pour tout appelant qui ne le précise pas, cf.
// server.js resolveProgressiveCurriculum) — un second appelant (vérification
// scindée elementary-only, 03/09/2026, cf. server.js) le passe explicitement
// pour cibler le nombre de connaissances elementary attendues, jamais 15.
function missingCurriculumCount(acceptedCount, target = MIN_PROGRESSIVE_CURRICULUM) {
  return Math.max(0, (Number(target) || 0) - (Number(acceptedCount) || 0));
}

// `identifiedSourcesBlock` : même principe et même périmètre strict que
// buildCurriculumPrompt ci-dessus (jamais fourni hors bloc Elementary
// progressif grounded) — un ajout de réparation doit lui aussi porter sa
// preuve, jamais un bypass silencieux de l'exigence d'evidence_text pour ce
// seul mécanisme.
function buildCurriculumRepairPrompt(subject, contextHint, neededCount, existingKnowledge, groundingText = null, identifiedSourcesBlock = null) {
  const existingList = (existingKnowledge || []).map((k) => `- ${k.knowledgeTarget}`).join("\n") || "(aucune)";
  const lines = [
    `Le plan pédagogique sur "${subject}" ne contient pour l'instant pas assez de connaissances validées — il en manque ${neededCount} pour atteindre le minimum requis pour un apprentissage suffisamment riche.`,
    contextHint ? `Contexte d'origine : ${contextHint}` : null
  ];
  if (identifiedSourcesBlock) {
    lines.push("", "Sources disponibles pour ce sujet, chacune identifiée par un identifiant stable (SOURCE_1, SOURCE_2...) :", identifiedSourcesBlock);
  } else if (groundingText) {
    lines.push("", "Sources disponibles pour ce sujet :", groundingText);
  }
  lines.push(
    "",
    "Connaissances DÉJÀ VALIDÉES (ne les reproduis jamais, ni littéralement ni en substance) :",
    existingList,
    "",
    `Propose EXACTEMENT ${neededCount} NOUVELLE(S) connaissance(s), réellement distincte(s) de celles déjà validées ci-dessus et distinctes entre elles — jamais une reformulation, jamais un détail secondaire choisi seulement pour remplir le compte.`
  );
  if (identifiedSourcesBlock) {
    lines.push(
      "",
      "Pour CHAQUE nouvelle connaissance, fournis également :",
      "- \"source_id\" : l'identifiant EXACT (SOURCE_1, SOURCE_2...) d'UNE des sources ci-dessus qui contient réellement cette information.",
      "- \"evidence_text\" : un extrait COURT COPIÉ TEXTUELLEMENT (jamais paraphrasé, jamais inventé) depuis cette source, soutenant réellement la connaissance.",
      "",
      `Réponds uniquement en JSON strict, sous la forme {"additions":[{"knowledgeTarget":"...","source_id":"SOURCE_1","evidence_text":"..."}]} — exactement ${neededCount} objet(s).`
    );
  } else {
    lines.push(
      "",
      `Réponds uniquement en JSON strict, sous la forme {"additions":[{"knowledgeTarget":"..."}]} — exactement ${neededCount} objet(s).`
    );
  }
  return lines.filter((line) => line !== null).join("\n");
}

// Conservateur par construction (même philosophie qu'applyKnowledgeVerification
// Decisions, lib/knowledge-admission.js) : au plus `neededCount` ajouts sont
// retenus (les suivants sont ignorés plutôt que de dépasser ce qui a été
// demandé), un ajout mal formé ou vide est écarté, et deux ajouts identiques
// (après normalisation) entre eux ne sont jamais retenus tous les deux —
// même si l'éviction de quasi-doublons globale (cf. server.js) rattrape de
// toute façon ce cas, autant ne jamais le laisser passer ici.
// source_id/evidence_text : même règle que parseCurriculumItems (les deux
// ensemble ou aucun des deux) — rétrocompatible au caractère près pour tout
// appel sans identifiedSourcesBlock.
function parseCurriculumRepairAdditions(raw, neededCount) {
  const limit = Math.max(0, Number(neededCount) || 0);
  const list = Array.isArray(raw) ? raw : [];
  const results = [];
  const seen = new Set();
  for (const entry of list) {
    if (results.length >= limit) break;
    const knowledgeTarget = typeof entry?.knowledgeTarget === "string" ? entry.knowledgeTarget.trim().slice(0, 400) : "";
    if (!knowledgeTarget) continue;
    const key = normalizeFactText(knowledgeTarget);
    if (seen.has(key)) continue;
    seen.add(key);
    const addition = { knowledgeTarget };
    const sourceId = typeof entry?.source_id === "string" ? entry.source_id.trim().slice(0, 20) : "";
    const evidenceText = typeof entry?.evidence_text === "string" ? entry.evidence_text.trim().slice(0, 500) : "";
    if (sourceId && evidenceText) {
      addition.source_id = sourceId;
      addition.evidence_text = evidenceText;
    }
    results.push(addition);
  }
  return results;
}

// Concatène simplement les ajouts de réparation (déjà munis d'un `order`
// temporaire par server.js, au-delà du max courant — cf.
// resolveProgressiveCurriculum) à la liste courante — jamais de fusion par
// position ou par id, jamais de perte : chaque connaissance déjà acceptée
// reste présente telle quelle.
function mergeCurriculumAdditions(items, additions) {
  return [...(Array.isArray(items) ? items : []), ...(Array.isArray(additions) ? additions : [])];
}

function selectCurriculumLevel(curriculum, level) {
  return (Array.isArray(curriculum) ? curriculum : [])
    .filter((item) => item.level === level)
    .sort((a, b) => a.order - b.order);
}

module.exports = {
  MIN_PROGRESSIVE_CURRICULUM,
  MAX_PROGRESSIVE_CURRICULUM,
  MIN_LEVEL_SIZE,
  NEAR_DUPLICATE_THRESHOLD,
  computeCurriculumSplit,
  levelForOrder,
  buildCurriculumPrompt,
  parseCurriculumItems,
  findNearDuplicates,
  normalizeCurriculumOrder,
  assignCurriculumLevels,
  validateCurriculumComplete,
  missingCurriculumCount,
  buildCurriculumRepairPrompt,
  parseCurriculumRepairAdditions,
  mergeCurriculumAdditions,
  selectCurriculumLevel
};
