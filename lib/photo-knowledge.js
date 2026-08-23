"use strict";

// Logique réutilisable du pipeline "import de connaissances par photo"
// (extraite le 22/08/2026 de scripts/test-photo-knowledge.js, qui l'utilise
// désormais via ce module au lieu de dupliquer les prompts). Fonctions pures
// + orchestration réseau via un `callOpenAI(messages, opts)` injecté par
// l'appelant — ni Supabase, ni FSRS, ni écriture disque ici. server.js
// fournit `(messages, opts) => _callOpenAI(apiKey, messages, opts)` ; le
// script de test fournit son propre petit wrapper fetch (cf. ce fichier),
// pour les mêmes raisons qu'avant : importer server.js démarrerait Supabase
// et app.listen(), bien trop lourd pour un script isolé.
//
// PHOTO → transcribeImage() (lecture stricte, avec image)
//       → si readability "retake" : ARRÊT, aucun 2e appel, knowledge: []
//       → si readability "ok" : selectKnowledgeFromTranscription()
//         (sélection, texte seul, SANS image)
//
// Décision produit conservée (cf. rapports précédents) : gpt-4.1-mini par
// défaut, aucun fallback, aucune sauvegarde automatique — ce module ne fait
// qu'analyser une photo et retourner des connaissances PROPOSÉES.

const sharp = require("sharp");

const PHOTO_KNOWLEDGE_MODEL = "gpt-4.1-mini";

const MIME_BY_EXTENSION = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};

// Types acceptés en amont (route serveur ET script) — dérivés de la même
// table que MIME_BY_EXTENSION pour n'avoir qu'une seule source de vérité.
const ACCEPTED_PHOTO_MIME_TYPES = Array.from(new Set(Object.values(MIME_BY_EXTENSION)));

// ── ÉTAPE 1 — Transcription stricte (avec image) ────────────────────────────
const TRANSCRIPTION_INTRO = "Tu retranscris strictement le texte visible dans cette photographie (cours, notes, article, roman, bande dessinée, document manuscrit ou imprimé quelconque). Tu ne sélectionnes AUCUNE connaissance, tu n'expliques pas le document, tu ne le résumes pas, tu ne complètes rien et tu ne corriges rien : ta seule tâche est de transcrire ce qui est réellement lisible.";

const TRANSCRIPTION_RULES_LINES = [
  "RÈGLE FONDAMENTALE — ne devine JAMAIS un mot ou un sens à partir de ce qui te semblerait logique dans le contexte, même si une hypothèse te paraît très probable :",
  "- Si un mot ou un passage est ambigu ou pourrait correspondre à plusieurs lectures plausibles, note-le \"[incertain: ta meilleure hypothèse ?]\" plutôt que de trancher silencieusement pour une seule lecture.",
  "- Si un passage est totalement illisible (flou, masqué, orientation, écriture indéchiffrable), note \"[illisible]\" à cet endroit plutôt que de l'omettre silencieusement ou de le deviner.",
  "- Une écriture manuscrite n'est PAS automatiquement illisible : si elle est clairement lisible, transcris-la normalement, mot pour mot. Seuls les mots réellement ambigus doivent être marqués.",
  "- Ratures et corrections : ne reconstruis jamais artificiellement une \"version finale\" propre. Conserve ce qui est réellement visible (y compris un mot barré si tu peux encore le lire) et marque les ambiguïtés que ces ratures introduisent.",
  "- Formules et équations : préserve la notation aussi fidèlement que possible (signe, exposant, indice, fraction, racine, variable, parenthèse, opérateur). N'invente et ne complète jamais un élément mathématique incertain — marque-le \"[incertain: ...]\" ou \"[illisible]\" plutôt que de le compléter.",
  "",
  "DÉCISION \"readability\" — doit correspondre exactement aux incertitudes que tu viens d'écrire dans ta propre transcription, jamais à une déclaration abstraite de confiance :",
  "- \"ok\" : ta transcription est suffisamment fiable dans les zones susceptibles de contenir des connaissances utiles (des \"[illisible]\"/\"[incertain: ...]\" isolés sur des détails secondaires n'empêchent pas \"ok\").",
  "- \"retake\" : des éléments importants de ta transcription sont \"[illisible]\" ou \"[incertain: ...]\", une partie essentielle du document est masquée, ou la transcription dans son ensemble est trop incertaine pour servir de base fiable à une mémorisation."
];

function buildTranscriptionPrompt() {
  return [
    TRANSCRIPTION_INTRO,
    "",
    ...TRANSCRIPTION_RULES_LINES,
    "",
    "Réponds uniquement en JSON strict, sans aucun texte autour, sous cette forme exacte :",
    '{"readability": "ok ou retake", "sourceTitle": "titre du document si visible, sinon null", "transcription": "texte transcrit, avec [illisible] et [incertain: ...] aux emplacements concernés"}'
  ].join("\n");
}

// ── ÉTAPE 2 — Sélection des connaissances (texte seul, aucune image) ───────
const SELECTION_RULE_LINES = [
  "FILTRE — SÉLECTION EXIGEANTE, JAMAIS D'ENRICHISSEMENT :",
  "- Principe directeur : ton travail n'est pas de transformer le texte transcrit en connaissances intéressantes, mais de découvrir celles qui y sont DÉJÀ explicitement présentes, telles quelles. \"knowledge\": [] est un résultat pleinement réussi si le texte n'en contient aucune — moins de connaissances vaut toujours mieux que des connaissances artificiellement améliorées.",
  "- RÈGLE FONDAMENTALE : ne transforme JAMAIS une information contextuelle en connaissance plus générale afin de lui donner artificiellement de la valeur. Une connaissance doit être explicitement affirmée par le texte transcrit, littéralement ou avec un sens directement équivalent. Une reformulation fidèle (même sens, plus claire ou plus concise) est autorisée ; une généralisation ne l'est JAMAIS — n'ajoute aucune propriété, relation, catégorie ou causalité absente du texte, même pour \"sauver\" un candidat par ailleurs trop faible : rejette-le plutôt que de l'enrichir.",
  "- N'UTILISE JAMAIS un passage marqué \"[illisible]\" ou \"[incertain: ...]\" comme fondement d'une connaissance : ce que la transcription elle-même signale comme incertain ne peut jamais devenir une connaissance certaine.",
  "- INTERDICTION DES MÉTA-ÉNONCÉS : être grounded ne suffit pas. La simple présence ou mention d'un terme dans le texte n'est jamais une connaissance à elle seule — rejette toute formulation qui se contente de dire que le texte mentionne, évoque ou parle d'un terme (ex. « X est mentionné. », « Le texte mentionne X. », « Le document parle de X. », « X apparaît dans le texte. »). Un terme, nom, concept ou objet isolé n'est retenu QUE si le texte fournit à son sujet une information substantielle et mémorisable (définition, propriété, relation, fait, date, cause, conséquence, distinction...) ; sinon → REJET.",
  "- NE JAMAIS RÉATTRIBUER LE SUJET EN FUSIONNANT DES PROPOSITIONS : lors d'une reformulation ou d'une compression, ne fusionne jamais deux propositions si cela modifie le sujet logique d'une propriété, d'une relation, d'une comparaison, d'une cause, d'une conséquence ou d'une action. Une reformulation doit conserver exactement qui fait quoi, qui possède quelle propriété, qui est comparé à quoi, quelle cause produit quelle conséquence, quel élément est relié à quel autre. Si une phrase source contient plusieurs propositions ou plusieurs sujets, préfère produire deux connaissances séparées, ou n'en retenir qu'une, plutôt que les fusionner en une formulation ambiguë ou incorrecte. En cas de doute sur le référent d'un pronom, d'un participe, d'une proposition subordonnée ou d'une comparaison : rejette, ou conserve une formulation plus proche du texte source.",
  "- Une connaissance n'est retenue que si les trois conditions suivantes sont TOUTES réunies (grille interne de décision, à NE PAS retourner dans le JSON) :",
  "  1) GROUNDING EXACT — le texte transcrit affirme-t-il réellement cette idée, littéralement ou avec un sens strictement équivalent ? Si l'admettre demande une déduction, une généralisation, une connaissance externe, une interprétation non explicite, ou l'ajout d'une propriété/relation/catégorie/causalité non affirmée → REJET. En cas de doute → REJET.",
  "  2) AUTONOMIE — la connaissance doit pouvoir être comprise et mémorisée sans avoir besoin de relire tout le texte. Une reformulation est autorisée pour la rendre autonome, mais jamais une généralisation qui lui donnerait artificiellement une portée plus large. Si elle n'est autonome qu'après généralisation → REJET.",
  "  3) VALEUR DE MÉMORISATION — l'information présente-t-elle un intérêt réel à retenir au-delà de la simple compréhension immédiate du texte (fait important, date significative, définition, concept, relation, mécanisme, cause/conséquence explicitement exprimée, idée forte, propriété importante, distinction utile, information culturelle/scientifique/historique/conceptuelle) ? Si l'intérêt est anecdotique, décoratif, trop dépendant du contexte, répétitif, ou n'apparaît qu'après extrapolation → REJET.",
  "- Le type de document (roman, BD, actualité, cours...) n'est jamais en lui-même un motif d'exclusion ou d'admission.",
  "- N'admets jamais deux connaissances qui disent essentiellement la même chose."
];

const CALIBRATION_EXAMPLES = [
  { text: "« Nous avons mangé des crêpes pendant le carnaval. »", verdict: "rejeté (contextuel, sans valeur de mémorisation autonome)", forbidden: ["« Les crêpes sont traditionnellement consommées pendant les carnavals. » (généralisation non affirmée par le document)"] },
  { text: "« J'ai passé l'aspirateur car il y avait de la poussière. »", verdict: "rejeté", forbidden: ["« Les aspirateurs servent à éliminer la poussière. » (généralisation non affirmée par le document)"] },
  { text: "« L'incendie a détruit trois maisons. »", verdict: "rejeté (fait ponctuel, sans portée générale exprimée par le document)", forbidden: ["« Les incendies peuvent provoquer d'importants dégâts matériels. » (généralisation non affirmée par le document)"] },
  { text: "« Les appareils antiménagers » (simple mention, aucune propriété affirmée)", verdict: "rejeté (rien n'est réellement affirmé à leur sujet)", forbidden: ["« Les appareils antiménagers sont des objets du quotidien. » (propriété non affirmée par le document)", "« Les appareils antiménagers sont mentionnés. » (méta-énoncé sur le document, pas une connaissance)"] },
  { text: "« La prise de la Bastille a lieu le 14 juillet 1789. »", verdict: "retenu (fait historique explicite, autonome, valeur de mémorisation forte)" },
  { text: "« La photosynthèse utilise l'énergie lumineuse pour produire de la matière organique. »", verdict: "retenu (principe scientifique explicite, autonome, valeur de mémorisation forte)" },
  { text: "« Cette terre sera le Latium, faisant d'Énée l'ancêtre du peuple romain. »", verdict: "peut être scindé en deux connaissances distinctes : « La terre recherchée par Énée est le Latium. » et « Énée est présenté comme l'ancêtre du peuple romain. »", forbidden: ["« Le Latium est l'ancêtre du peuple romain. » (propriété réattribuée au mauvais sujet par fusion des deux propositions)"] },
  { text: "« Quand nous écrivons le premier livre, nous sommes comme le petit garçon qui prépare une chorégraphie dans sa chambre. »", verdict: "« L'auteur qui écrit son premier livre est comparé au petit garçon qui prépare seul une chorégraphie. »", forbidden: ["« La littérature fonctionne comme un petit garçon. » (comparaison réattribuée au mauvais sujet par fusion des deux propositions)"] }
];

function buildSelectionFromTranscriptionPrompt(transcription, sourceTitle) {
  return [
    "Voici la transcription stricte d'un document, produite à l'étape précédente par lecture de la photographie d'origine. Ta tâche : identifier les CONNAISSANCES qui méritent réellement d'être mémorisées, en te basant UNIQUEMENT sur ce texte transcrit — tu n'as PAS accès à l'image d'origine.",
    sourceTitle ? `Titre détecté à l'étape précédente : ${sourceTitle}` : "Aucun titre détecté à l'étape précédente.",
    "",
    "Transcription :",
    "\"\"\"",
    transcription,
    "\"\"\"",
    "",
    ...SELECTION_RULE_LINES,
    "",
    "Exemples de calibrage (courts, indicatifs, pas une liste exhaustive de cas) :",
    ...CALIBRATION_EXAMPLES.flatMap((ex) => [
      `- ${ex.text} → ${ex.verdict}`,
      ...(ex.forbidden || []).map((f) => `  Interdit malgré tout : ${f}`)
    ]),
    "",
    "IMPORTANT — n'essaie JAMAIS d'atteindre un nombre donné de connaissances, et ne confonds jamais cet exercice avec un résumé du texte : il est parfaitement normal, même pour un texte de plusieurs paragraphes, de ne retenir aucune connaissance (\"knowledge\": []). Le bon nombre dépend uniquement du contenu réel : 0, 1, 3, 8, 14... jusqu'à 20 maximum. En cas d'hésitation entre retenir et écarter une information secondaire, écarte-la — la qualité de la sélection prime toujours sur la quantité.",
    "",
    "Pour chaque connaissance retenue, fournis une \"evidence\" : une très courte citation ou quelques mots-clés tirés DIRECTEMENT de la transcription ci-dessus (jamais de l'image d'origine), permettant de vérifier que cette connaissance provient bien du texte transcrit. L'evidence sert uniquement à la vérification du grounding, jamais à justifier pourquoi l'information est importante — pas de longs extraits.",
    "",
    "Réponds uniquement en JSON strict, sans aucun texte autour, sous cette forme exacte :",
    '{"knowledge": [{"knowledge": "phrase factuelle courte et autonome", "evidence": "courte preuve tirée de la transcription"}]}'
  ].join("\n");
}

// Garde-fou post-hoc, minimal et déterministe (cf. rapports précédents) : le
// prompt de l'étape 2 interdit déjà explicitement les méta-énoncés ("X est
// mentionné") mais le modèle les reproduit malgré tout dans certains cas
// observés en test. Volontairement étroit — aucun NLP, aucun second appel IA
// — ne cible QUE les constructions où le document/texte/la page est
// littéralement le sujet, ou une construction terminale "X est/sont
// mentionné(e)(s)/évoqué(e)(s)" / "X apparaît/apparaissent dans le
// document/texte/la page". C'est le SEUL filtre post-hoc conservé : aucun
// autre garde-fou de type "détection d'hallucination après coup" n'est
// ajouté — le problème de fiabilité de lecture est traité en amont, à
// l'étape 1, pas par une regex sur le contenu des connaissances.
const META_DOCUMENT_REFERENCE_PATTERNS = [
  /^(le document|le texte|la page)\s+(mentionne|évoque|parle\s+de\S*)/i,
  /\b(est|sont)\s+(mentionné|mentionnée|mentionnés|mentionnées|évoqué|évoquée|évoqués|évoquées)\s*\.?\s*$/i,
  /\b(apparaît|apparaissent)\s+dans\s+(le document|le texte|la page)\b/i
];

function isMetaDocumentReference(text) {
  const value = String(text || "").trim();
  return META_DOCUMENT_REFERENCE_PATTERNS.some((pattern) => pattern.test(value));
}

// Auto-orientation (cf. hallucination observée sur une photo mal orientée) :
// sharp().rotate() sans argument respecte l'orientation EXIF quand le
// téléphone l'a renseignée, sans détection ni heuristique ajoutée ici. Si
// l'EXIF ne dit rien, l'image ressort inchangée (comportement documenté de
// sharp) — jamais d'OCR ni de second appel IA pour deviner l'orientation.
// Pipeline sharp inchangé par rapport au prototype de script.
async function buildAnalysisDataUrl(buffer, mimeType) {
  const exifOrientation = (await sharp(buffer).metadata()).orientation || null;
  const normalizedBuffer = await sharp(buffer).rotate().toBuffer();
  const dataUrl = `data:${mimeType};base64,${normalizedBuffer.toString("base64")}`;
  return { dataUrl, exifOrientation };
}

// `callOpenAI(messages, opts)` est injecté par l'appelant : côté serveur,
// `(messages, opts) => _callOpenAI(apiKey, messages, opts)` (retourne une
// simple chaîne) ; côté script de test, un petit wrapper fetch local
// (retourne { content, usage }). Les deux formes sont acceptées ici.
function extractContent(result) {
  if (typeof result === "string") return result;
  return result?.content || "";
}

async function transcribeImage(callOpenAI, dataUrl) {
  const messages = [{
    role: "user",
    content: [
      { type: "text", text: buildTranscriptionPrompt() },
      { type: "image_url", image_url: { url: dataUrl, detail: "high" } }
    ]
  }];
  const result = await callOpenAI(messages, {
    model: PHOTO_KNOWLEDGE_MODEL,
    temperature: 0.2,
    responseFormat: { type: "json_object" },
    timeoutMs: 90_000,
    feature: "photo_reading"
  });
  return { content: extractContent(result), usage: result?.usage || null };
}

async function selectKnowledgeFromTranscription(callOpenAI, transcription, sourceTitle) {
  const messages = [{ role: "user", content: buildSelectionFromTranscriptionPrompt(transcription, sourceTitle) }];
  const result = await callOpenAI(messages, {
    model: PHOTO_KNOWLEDGE_MODEL,
    temperature: 0.2,
    responseFormat: { type: "json_object" },
    timeoutMs: 60_000,
    feature: "photo_knowledge_selection"
  });
  return { content: extractContent(result), usage: result?.usage || null };
}

// Orchestration complète des 2 étapes (demande du 22/08/2026) : un seul point
// d'entrée pour la route serveur ET pour le script de test, afin de ne
// dupliquer ni les prompts ni la logique de STOP-sur-retake.
//
// STOP obligatoire : readability "retake" dès la transcription bloque tout,
// y compris l'appel de l'étape 2 — aucune connaissance ne doit jamais être
// construite sur une lecture incertaine, et on évite au passage un deuxième
// appel inutile.
async function analyzePhotoKnowledge({ dataUrl, callOpenAI }) {
  if (typeof callOpenAI !== "function") throw new Error("callOpenAI manquant.");
  if (!dataUrl) throw new Error("dataUrl manquant.");

  const step1 = await transcribeImage(callOpenAI, dataUrl);
  let step1Parsed;
  try {
    step1Parsed = JSON.parse(step1.content);
  } catch (error) {
    throw new Error("Réponse étape 1 (transcription) non-JSON.");
  }

  // Normalisation minimale : le modèle répond parfois la chaîne littérale
  // "null" au lieu de la valeur JSON null quand aucun titre n'est visible.
  if (step1Parsed.sourceTitle === "null") step1Parsed.sourceTitle = null;
  const sourceTitle = step1Parsed.sourceTitle ?? null;

  if (step1Parsed.readability !== "ok") {
    return {
      readability: "retake",
      sourceTitle,
      knowledge: [],
      usage: { step1: step1.usage, step2: null }
    };
  }

  const step2 = await selectKnowledgeFromTranscription(callOpenAI, step1Parsed.transcription || "", sourceTitle);
  let step2Parsed;
  try {
    step2Parsed = JSON.parse(step2.content);
  } catch (error) {
    throw new Error("Réponse étape 2 (sélection) non-JSON.");
  }

  const rawKnowledge = Array.isArray(step2Parsed.knowledge) ? step2Parsed.knowledge : [];
  const knowledge = rawKnowledge.filter((k) => !isMetaDocumentReference(k?.knowledge));

  return {
    readability: "ok",
    sourceTitle,
    knowledge,
    usage: { step1: step1.usage, step2: step2.usage }
  };
}

module.exports = {
  PHOTO_KNOWLEDGE_MODEL,
  MIME_BY_EXTENSION,
  ACCEPTED_PHOTO_MIME_TYPES,
  buildTranscriptionPrompt,
  buildSelectionFromTranscriptionPrompt,
  SELECTION_RULE_LINES,
  CALIBRATION_EXAMPLES,
  isMetaDocumentReference,
  buildAnalysisDataUrl,
  transcribeImage,
  selectKnowledgeFromTranscription,
  analyzePhotoKnowledge
};
