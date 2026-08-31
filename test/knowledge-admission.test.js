"use strict";

// Couvre lib/knowledge-admission.js (extrait de server.js le 17/08/2026,
// implémentation de l'audit du pipeline mnésique) — fonctions pures de
// construction de prompt et de décision, jamais l'appel IA lui-même (hors de
// portée d'un test unitaire déterministe). Ce que ces tests verrouillent :
// le contenu EXACT des consignes envoyées au modèle (ex. "jamais ordre si
// pas de séquence réelle"), et le comportement déterministe des fonctions de
// décision (applyKnowledgeVerificationDecisions). Ils ne peuvent pas prouver
// que le modèle suit ces consignes — seulement qu'elles sont bien posées.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildKnowledgeAdmissionPrompt,
  buildQuestionsFromKnowledgePrompt,
  buildFicheAndKnowledgeAdmissionPrompt,
  buildKnowledgeVerificationPrompt,
  applyKnowledgeVerificationDecisions,
  sanitizeImageSearchQuery
} = require("../lib/knowledge-admission");

function knowledge(overrides = {}) {
  return {
    fact: "Fait par défaut.",
    importance: "high",
    certainty: "high",
    sequential: false,
    clearBoundary: false,
    ...overrides
  };
}

// ---- buildKnowledgeAdmissionPrompt (Éclairages/Histoire, "grounded") ----

test("buildKnowledgeAdmissionPrompt : demande de ne jamais chercher un nombre donné de connaissances", () => {
  const prompt = buildKnowledgeAdmissionPrompt("Texte source.", null);
  assert.match(prompt, /ne cherche JAMAIS à atteindre un nombre donné de connaissances/i);
  assert.match(prompt, /"knowledge":\[\]/);
});

test("buildKnowledgeAdmissionPrompt : exige importance ET certainty à high/medium, jamais low", () => {
  const prompt = buildKnowledgeAdmissionPrompt("Texte source.", null);
  assert.match(prompt, /"importance" et "certainty" doivent toutes deux valoir "high" ou "medium"/);
});

test("buildKnowledgeAdmissionPrompt : le texte source fourni est bien inclus tel quel", () => {
  const prompt = buildKnowledgeAdmissionPrompt("id:evt-42 | Ce jour dans l'Histoire | contenu unique XYZ", null);
  assert.match(prompt, /id:evt-42/);
  assert.match(prompt, /contenu unique XYZ/);
});

test("buildKnowledgeAdmissionPrompt : interdit d'admettre une connaissance liée à l'actualité du jour (contexte interne)", () => {
  const prompt = buildKnowledgeAdmissionPrompt("Texte source.", null);
  assert.match(prompt, /Interdiction absolue d'admettre une connaissance liée à l'actualité du jour/);
});

test("buildKnowledgeAdmissionPrompt : demande les signaux sequential/clearBoundary pour piloter le format en aval", () => {
  const prompt = buildKnowledgeAdmissionPrompt("Texte source.", null);
  assert.match(prompt, /"sequential"/);
  assert.match(prompt, /"clearBoundary"/);
});

test("buildKnowledgeAdmissionPrompt : le niveau, quand fourni, influence la sélectivité mais jamais un nombre à atteindre", () => {
  const prompt = buildKnowledgeAdmissionPrompt("Texte source.", "Niveau élémentaire : ne retiens que l'essentiel.");
  assert.match(prompt, /Niveau élémentaire : ne retiens que l'essentiel\./);
  assert.match(prompt, /jamais le nombre à atteindre/);
});

// ---- buildQuestionsFromKnowledgePrompt : le format s'adapte à la connaissance ----

test('buildQuestionsFromKnowledgePrompt : régression Habermas — une connaissance non séquentielle interdit "ordre"', () => {
  const habermas = knowledge({
    fact: "Selon Habermas, la théorie de l'espace public décrit un lieu de formation de l'opinion publique.",
    sequential: false,
    clearBoundary: false
  });
  const prompt = buildQuestionsFromKnowledgePrompt("sourceId", "notion:mecanisme:2862", [habermas], null, ["=== Formats de question possibles ==="]);
  assert.match(prompt, /1\. .*\[PAS de séquence réelle : jamais "ordre"\]/);
  assert.match(prompt, /N'utilise le format "ordre" QUE sur une connaissance marquée \[séquence réelle\]/);
  assert.match(prompt, /jamais sur une connaissance marquée \[PAS de séquence réelle\], même en inventant une suite d'étapes plausible/);
});

test('buildQuestionsFromKnowledgePrompt : une connaissance séquentielle autorise "ordre"', () => {
  const sequentialFact = knowledge({
    fact: "La Révolution française se déroule en plusieurs phases : Assemblée constituante, Convention, Directoire.",
    sequential: true
  });
  const prompt = buildQuestionsFromKnowledgePrompt("sourceId", "notion:histoire:1", [sequentialFact], null, []);
  assert.match(prompt, /1\. .*\[séquence réelle : "ordre" envisageable\]/);
});

test('buildQuestionsFromKnowledgePrompt : clearBoundary=false interdit "intrus"', () => {
  const fuzzy = knowledge({ fact: "Fait aux frontières discutables.", clearBoundary: false });
  const prompt = buildQuestionsFromKnowledgePrompt("sourceId", "id1", [fuzzy], null, []);
  assert.match(prompt, /1\. .*\[frontière floue : jamais "intrus"\]/);
  assert.match(prompt, /N'utilise le format "intrus" QUE sur une connaissance marquée \[frontière nette\]/);
});

test('buildQuestionsFromKnowledgePrompt : clearBoundary=true autorise "intrus"', () => {
  const clear = knowledge({ fact: "Fait aux frontières nettes.", clearBoundary: true });
  const prompt = buildQuestionsFromKnowledgePrompt("sourceId", "id1", [clear], null, []);
  assert.match(prompt, /1\. .*\[frontière nette : "intrus" envisageable\]/);
});

test("buildQuestionsFromKnowledgePrompt : knowledgeTarget doit reprendre EXACTEMENT le fait, jamais le reformuler", () => {
  const prompt = buildQuestionsFromKnowledgePrompt("sourceId", "id1", [knowledge()], null, []);
  assert.match(prompt, /doit reprendre EXACTEMENT le texte du fait numéroté qu'elle teste, sans le reformuler/);
});

test("buildQuestionsFromKnowledgePrompt : interdit d'introduire une nouvelle connaissance ou un détail périphérique", () => {
  const prompt = buildQuestionsFromKnowledgePrompt("sourceId", "id1", [knowledge()], null, []);
  assert.match(prompt, /jamais une dérive vers un autre fait, jamais un détail périphérique absent de cette liste/);
});

test("buildQuestionsFromKnowledgePrompt : au maximum une question par connaissance, moins est un comportement normal", () => {
  const prompt = buildQuestionsFromKnowledgePrompt("sourceId", "id1", [knowledge(), knowledge({ fact: "Second fait." })], null, []);
  assert.match(prompt, /Au maximum une question par connaissance de la liste/);
  assert.match(prompt, /produire moins de questions que de connaissances admises est un comportement normal et attendu/);
});

test("buildQuestionsFromKnowledgePrompt : toutes les connaissances admises apparaissent, numérotées", () => {
  const items = [knowledge({ fact: "Fait A." }), knowledge({ fact: "Fait B." }), knowledge({ fact: "Fait C." })];
  const prompt = buildQuestionsFromKnowledgePrompt("sourceId", "id1", items, null, []);
  assert.match(prompt, /1\. Fait A\./);
  assert.match(prompt, /2\. Fait B\./);
  assert.match(prompt, /3\. Fait C\./);
});

test("buildQuestionsFromKnowledgePrompt : intègre le bloc de formats fourni par l'appelant, jamais reconstruit ici", () => {
  const marker = "=== MARQUEUR-DE-TEST-FORMAT-BLOCK ===";
  const prompt = buildQuestionsFromKnowledgePrompt("sourceId", "id1", [knowledge()], null, [marker]);
  assert.match(prompt, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("buildQuestionsFromKnowledgePrompt : une seule connaissance admise produit un prompt valide (cas 1 connaissance)", () => {
  const prompt = buildQuestionsFromKnowledgePrompt("sourceId", "id1", [knowledge({ fact: "Unique fait solide." })], null, []);
  assert.match(prompt, /1\. Unique fait solide\./);
  assert.doesNotMatch(prompt, /2\./);
});

// ---- buildFicheAndKnowledgeAdmissionPrompt (sujet libre, "ungrounded") ----

const LEVEL_CONFIG = {
  target: 10,
  instruction: null,
  sectionsRange: "2 à 4",
  lengthHint: "reste concise."
};

test("buildFicheAndKnowledgeAdmissionPrompt : ne demande jamais de questions, seulement une fiche + des connaissances candidates", () => {
  const prompt = buildFicheAndKnowledgeAdmissionPrompt("Photosynthèse", null, LEVEL_CONFIG, false);
  assert.match(prompt, /jamais de questions, d'options ni de format à ce stade/);
  assert.doesNotMatch(prompt, /"correctIndex"/);
});

test("buildFicheAndKnowledgeAdmissionPrompt : sans requireValidation, rédige directement (pas d'étape de refus)", () => {
  const prompt = buildFicheAndKnowledgeAdmissionPrompt("Photosynthèse", null, LEVEL_CONFIG, false);
  assert.doesNotMatch(prompt, /valid:false/);
  assert.match(prompt, /^Tu es un rédacteur pédagogique francophone\./);
});

test("buildFicheAndKnowledgeAdmissionPrompt : avec requireValidation, prévoit le refus explicite d'un sujet non sérieux", () => {
  const prompt = buildFicheAndKnowledgeAdmissionPrompt("n'importe quoi", null, LEVEL_CONFIG, true);
  assert.match(prompt, /Refuse \(valid:false\)/);
  assert.match(prompt, /"valid":false,"reason":"\.\.\."/);
});

test("buildFicheAndKnowledgeAdmissionPrompt : jamais de quota de connaissances candidates à atteindre", () => {
  const prompt = buildFicheAndKnowledgeAdmissionPrompt("Photosynthèse", null, LEVEL_CONFIG, false);
  assert.match(prompt, /ne cherche JAMAIS à atteindre un nombre donné de connaissances candidates/i);
});

test("buildFicheAndKnowledgeAdmissionPrompt : le contextHint est inclus sans borner le sujet", () => {
  const prompt = buildFicheAndKnowledgeAdmissionPrompt("Guerre de Cent Ans", "mentionnée dans un débat sur la diplomatie", LEVEL_CONFIG, false);
  assert.match(prompt, /mentionnée dans un débat sur la diplomatie/);
  assert.match(prompt, /présentation autonome et complète du sujet lui-même/);
});

test("buildFicheAndKnowledgeAdmissionPrompt : demande imageSearchQuery, une requête courte qui ne révèle jamais la réponse", () => {
  const prompt = buildFicheAndKnowledgeAdmissionPrompt("Burundi", null, LEVEL_CONFIG, false);
  assert.match(prompt, /"imageSearchQuery"/);
  assert.match(prompt, /jamais une requête qui donnerait la réponse à une future question/);
  assert.match(prompt, /"Gitega"/); // exemple explicite de ce qu'il ne faut jamais faire.
});

test("buildFicheAndKnowledgeAdmissionPrompt : imageSearchQuery peut valoir null pour un sujet peu illustrable", () => {
  const prompt = buildFicheAndKnowledgeAdmissionPrompt("Théorème de Pythagore", null, LEVEL_CONFIG, false);
  assert.match(prompt, /Réponds null si le sujet ne se prête pas à une illustration pertinente/);
});

test("buildFicheAndKnowledgeAdmissionPrompt : imageSearchQuery apparaît dans les deux formes du schéma JSON final (avec et sans validation)", () => {
  const withValidation = buildFicheAndKnowledgeAdmissionPrompt("Sujet", null, LEVEL_CONFIG, true);
  const withoutValidation = buildFicheAndKnowledgeAdmissionPrompt("Sujet", null, LEVEL_CONFIG, false);
  assert.match(withValidation, /"imageSearchQuery":"\.\.\."\|null/);
  assert.match(withoutValidation, /"imageSearchQuery":"\.\.\."\|null/);
});

// ---- buildFicheAndKnowledgeAdmissionPrompt : grounding web optionnel (31/08/2026) ----

test("buildFicheAndKnowledgeAdmissionPrompt : sans groundingText, comportement strictement identique à avant (rien sur des sources web)", () => {
  const prompt = buildFicheAndKnowledgeAdmissionPrompt("Photosynthèse", null, LEVEL_CONFIG, false);
  assert.doesNotMatch(prompt, /VRAIES sources web/);
});

test("buildFicheAndKnowledgeAdmissionPrompt : avec groundingText, l'injecte et impose de s'y fonder en priorité", () => {
  const prompt = buildFicheAndKnowledgeAdmissionPrompt("Avalanche glaciaire", null, LEVEL_CONFIG, false, "[Source 1 — fr.wikipedia.org] Avalanche\nContenu réel extrait.");
  assert.match(prompt, /VRAIES sources web/);
  assert.match(prompt, /Contenu réel extrait\./);
  assert.match(prompt, /écarte-le plutôt que de l'inventer/);
});

// ---- sanitizeImageSearchQuery : validation structurelle, sans jamais planter ----

test("sanitizeImageSearchQuery : une chaîne valide est conservée telle quelle (trim)", () => {
  assert.equal(sanitizeImageSearchQuery("  Aldo Moro Italy 1970s  "), "Aldo Moro Italy 1970s");
});

test("sanitizeImageSearchQuery : null/undefined/absent renvoie null", () => {
  assert.equal(sanitizeImageSearchQuery(null), null);
  assert.equal(sanitizeImageSearchQuery(undefined), null);
});

test("sanitizeImageSearchQuery : chaîne vide ou uniquement des espaces renvoie null", () => {
  assert.equal(sanitizeImageSearchQuery(""), null);
  assert.equal(sanitizeImageSearchQuery("   "), null);
});

test("sanitizeImageSearchQuery : tronque au-delà de 150 caractères plutôt que de rejeter", () => {
  const long = "a".repeat(300);
  const result = sanitizeImageSearchQuery(long);
  assert.equal(result.length, 150);
});

test("sanitizeImageSearchQuery : une valeur non-string (nombre, objet) ne plante pas", () => {
  assert.equal(sanitizeImageSearchQuery(42), "42");
  assert.equal(sanitizeImageSearchQuery({}), "[object Object]");
});

// ---- buildKnowledgeVerificationPrompt : passe indépendante, batchée, conservatrice ----

test("buildKnowledgeVerificationPrompt : liste TOUTES les connaissances candidates dans un seul prompt (batché, pas un appel par connaissance)", () => {
  const candidates = [
    knowledge({ fact: "Fait 1." }),
    knowledge({ fact: "Fait 2." }),
    knowledge({ fact: "Fait 3." })
  ];
  const prompt = buildKnowledgeVerificationPrompt(candidates, "Sujet test");
  assert.match(prompt, /0\. Fait 1\./);
  assert.match(prompt, /1\. Fait 2\./);
  assert.match(prompt, /2\. Fait 3\./);
});

test("buildKnowledgeVerificationPrompt : consigne explicitement conservatrice (rejet en cas de doute)", () => {
  const prompt = buildKnowledgeVerificationPrompt([knowledge()], "Sujet test");
  assert.match(prompt, /En cas de doute réel, rejette plutôt que d'accepter/);
});

test("buildKnowledgeVerificationPrompt : rejette explicitement formulation trop absolue, interprétation non attribuée, fait périphérique, importance insuffisante, information instable", () => {
  const prompt = buildKnowledgeVerificationPrompt([knowledge()], "Sujet test");
  assert.match(prompt, /formulation est trop absolue/);
  assert.match(prompt, /interprétation.*présentée comme un fait neutre, sans attribution explicite/);
  assert.match(prompt, /périphérique au sujet/);
  assert.match(prompt, /importance est insuffisante/);
  assert.match(prompt, /devenir rapidement obsolète/);
});

test("buildKnowledgeVerificationPrompt : n'autorise ni ajout ni reformulation, seulement accept/reject", () => {
  const prompt = buildKnowledgeVerificationPrompt([knowledge()], "Sujet test");
  assert.match(prompt, /N'ajoute et ne reformule aucun fait : uniquement accept\/reject/);
});

test("buildKnowledgeVerificationPrompt : ne prétend jamais constituer une preuve/un grounding externe (limite documentée dans le code, jamais dans le prompt lui-même envoyé au modèle — mais vérifiable ici que le prompt reste un jugement, pas une recherche)", () => {
  const prompt = buildKnowledgeVerificationPrompt([knowledge()], "Sujet test");
  assert.doesNotMatch(prompt, /recherche (web|internet)/i);
  assert.doesNotMatch(prompt, /source externe vérifiée/i);
});

// ---- buildKnowledgeVerificationPrompt : grounding web optionnel (31/08/2026) ----

test("buildKnowledgeVerificationPrompt : sans groundingText, comportement strictement identique à avant (aucune mention de sources)", () => {
  const prompt = buildKnowledgeVerificationPrompt([knowledge()], "Sujet test");
  assert.doesNotMatch(prompt, /Sources ayant servi/);
});

test("buildKnowledgeVerificationPrompt : avec groundingText, ajoute un critère de rejet si le fait n'est pas soutenu par les sources, sans retirer les critères existants", () => {
  const prompt = buildKnowledgeVerificationPrompt([knowledge()], "Sujet test", "[Source 1 — exemple.com] Titre\nExtrait réel.");
  assert.match(prompt, /n'est PAS clairement soutenue par les sources ci-dessous/);
  assert.match(prompt, /Sources ayant servi à rédiger cette liste/);
  assert.match(prompt, /Extrait réel\./);
  assert.match(prompt, /formulation est trop absolue/); // critères existants toujours présents
});

// ---- applyKnowledgeVerificationDecisions : conservateur par construction ----

test("applyKnowledgeVerificationDecisions : accept:true à un index valide conserve le candidat", () => {
  const candidates = [knowledge({ fact: "A" }), knowledge({ fact: "B" })];
  const accepted = applyKnowledgeVerificationDecisions(candidates, [
    { index: 0, accept: true },
    { index: 1, accept: false }
  ]);
  assert.deepEqual(accepted.map((c) => c.fact), ["A"]);
});

test("applyKnowledgeVerificationDecisions : un index absent de la réponse est rejeté (jamais admis par défaut)", () => {
  const candidates = [knowledge({ fact: "A" }), knowledge({ fact: "B" })];
  const accepted = applyKnowledgeVerificationDecisions(candidates, [{ index: 0, accept: true }]);
  assert.deepEqual(accepted.map((c) => c.fact), ["A"]);
});

test("applyKnowledgeVerificationDecisions : accept non strictement true (chaîne, 1, null...) est rejeté", () => {
  const candidates = [knowledge({ fact: "A" }), knowledge({ fact: "B" }), knowledge({ fact: "C" })];
  const accepted = applyKnowledgeVerificationDecisions(candidates, [
    { index: 0, accept: "true" },
    { index: 1, accept: 1 },
    { index: 2, accept: null }
  ]);
  assert.deepEqual(accepted, []);
});

test("applyKnowledgeVerificationDecisions : une réponse totalement malformée (pas un tableau) rejette tout, sans planter", () => {
  const candidates = [knowledge({ fact: "A" })];
  assert.deepEqual(applyKnowledgeVerificationDecisions(candidates, null), []);
  assert.deepEqual(applyKnowledgeVerificationDecisions(candidates, undefined), []);
  assert.deepEqual(applyKnowledgeVerificationDecisions(candidates, "pas un tableau"), []);
  assert.deepEqual(applyKnowledgeVerificationDecisions(candidates, {}), []);
});

test("applyKnowledgeVerificationDecisions : 0 connaissance candidate en entrée donne 0 en sortie, sans crash", () => {
  assert.deepEqual(applyKnowledgeVerificationDecisions([], [{ index: 0, accept: true }]), []);
});

test("applyKnowledgeVerificationDecisions : toutes acceptées explicitement conserve tout", () => {
  const candidates = [knowledge({ fact: "A" }), knowledge({ fact: "B" })];
  const accepted = applyKnowledgeVerificationDecisions(candidates, [
    { index: 0, accept: true },
    { index: 1, accept: true }
  ]);
  assert.equal(accepted.length, 2);
});
