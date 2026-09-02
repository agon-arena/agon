"use strict";

// Extrait de server.js le 17/08/2026 (implémentation de l'audit du pipeline
// mnésique, cf. lib/question-formats.js pour le même principe déjà appliqué
// le 16/08/2026) — server.js démarre tout le serveur Express à l'import et
// ne peut donc pas être testé unitairement ; ces fonctions sont pures
// (aucun accès réseau/DB, aucun appel IA — seulement de la construction de
// texte et de la logique de décision déterministe) et méritaient donc
// d'être isolées ici pour être réellement testées (cf. test/
// knowledge-admission.test.js).
//
// Principe général verrouillé par ces fonctions : VRAI → CERTAIN → LIÉ AU
// SUJET → IMPORTANT → MÉMORISABLE → QUESTION, jamais l'inverse (jamais une
// connaissance choisie ou déformée parce qu'un format de question la rendait
// facile à poser). server.js orchestre l'appel IA autour de ces fonctions
// (cf. buildNotionQuestions, generateNotionLevelQuiz) ; ce fichier ne fait
// que construire les prompts et interpréter les décisions, jamais l'appel
// réseau lui-même.

// ── Sélection des connaissances (admission), séparée de la génération des
// questions ── Avant ce correctif, une seule et même passe IA décidait à la
// fois QUOI retenir ET comment le questionner (l'ancien
// buildCultureGeneraleQuizPrompt de server.js) — un fait "facile à
// questionner" pouvait ainsi devenir une "connaissance" simplement parce
// qu'il se prêtait bien à un format, jamais parce qu'il le méritait
// vraiment (cas réel documenté par l'audit : une pseudo-séquence "remets
// dans l'ordre" inventée sur la théorie de l'espace public de Habermas, qui
// n'a rien de séquentiel). Cette fonction ne produit QUE la liste des
// connaissances dignes d'être mémorisées durablement — jamais d'options, de
// distracteurs, de format, ni de correctIndex, ce travail revenant
// entièrement à buildQuestionsFromKnowledgePrompt plus bas, qui ne peut plus
// tester que ce que celle-ci a admis.
// Mode "grounded" uniquement (Éclairages/Histoire, texte source réel fourni
// via `sourceText`) : le contrôle "cette connaissance est-elle soutenue par
// le texte ?" est donc intégré à ce même appel plutôt qu'une passe séparée
// (contrairement au sujet libre, sans texte source, cf.
// buildFicheAndKnowledgeAdmissionPrompt + buildKnowledgeVerificationPrompt
// plus bas) — le texte source est immédiatement disponible dans ce même
// prompt, une vérification croisée dans un second appel n'apporterait ici
// aucune robustesse supplémentaire réelle pour un coût IA doublé.
function buildKnowledgeAdmissionPrompt(sourceText, levelInstruction) {
  return [
    `Tu prépares la matière d'un futur QCM de culture générale en français, mais tu ne rédiges PAS encore de questions : tu sélectionnes uniquement les CONNAISSANCES qui méritent réellement d'être mémorisées durablement, à partir de l'élément fourni plus bas — un événement "Ce jour dans l'Histoire" ou un éclairage (une actualité du jour éclairée par un précédent historique, un concept philosophique, un mécanisme sociologique, un concept transversal, une citation d'auteur, une œuvre d'art ou un mot latin).`,
    "",
    "Pour chaque fait candidat, évalue silencieusement chacun de ces critères avant de l'admettre :",
    "- VÉRACITÉ ET SOUTIEN PAR LA SOURCE : le fait doit être clairement soutenu par le texte fourni plus bas, jamais déduit, extrapolé ou complété depuis tes connaissances générales. En cas de doute sur son exactitude telle qu'écrite (chiffre, date, nom), rejette-le plutôt que de l'admettre avec une formulation floue.",
    "- CERTITUDE : ne transforme jamais une hypothèse, un débat, une interprétation ou une attribution incertaine en vérité absolue. Une interprétation peut être admise UNIQUEMENT si elle est clairement attribuée (\"selon X\", \"dans cette théorie\") et réellement centrale au sujet — jamais présentée comme un fait neutre.",
    "- RELATION DIRECTE AU SUJET : le fait doit concerner réellement le sujet lui-même — pas seulement la même époque, le même lieu, le même domaine, ou un contexte périphérique qui l'entoure sans le caractériser. Interdiction absolue d'admettre une connaissance liée à l'actualité du jour évoquée dans le texte (le \"mécanisme commun\" ou la \"différence essentielle\" ne sont qu'un contexte interne, jamais une matière à connaissance).",
    "- IMPORTANCE : la connaissance doit être structurante. Question à te poser : une personne cultivée aurait-elle réellement intérêt à conserver cette information dans plusieurs années ? Si non, rejette-la.",
    "- DISTINCTIVITÉ : le fait doit aider à caractériser ou comprendre CE sujet précisément. S'il pourrait être remplacé par des dizaines de détails similaires sans changer la compréhension du sujet, il est probablement trop faible.",
    "- STABILITÉ : évite ce qui deviendra vite obsolète (poste actuel, classement actuel, chiffre mouvant, statistique temporaire) — sauf si le caractère daté constitue précisément la connaissance elle-même (ex. la date d'un événement historique).",
    "- GRANULARITÉ : ni trop vague, ni microscopique — une connaissance doit former une unité mentale utile et autonome, compréhensible seule.",
    "- POUVOIR EXPLICATIF : privilégie ce qui aide à comprendre ce que c'est, qui c'est, pourquoi c'est important, ce qui s'est passé, les principales causes/conséquences, la contribution essentielle, l'œuvre majeure, la caractéristique distinctive.",
    "",
    "Sois particulièrement prudent avec des formulations telles que \"premier\", \"dernier\", \"seul\", \"unique\", \"toujours\", \"jamais\", \"principal\", \"exactement\", \"cause\", \"provoque\", \"est responsable de\" : elles exigent un niveau de certitude élevé. En cas de doute, reformule plus prudemment (\"l'un des...\", \"parmi les...\") si le fait reste utile ainsi, sinon rejette-le entièrement.",
    "",
    "IMPORTANT — ne cherche JAMAIS à atteindre un nombre donné de connaissances. Un tableau contenant peu d'éléments, voire aucun, est parfaitement normal. Si rien dans ce texte ne mérite réellement une mémorisation durable, réponds {\"knowledge\":[]} plutôt que de produire une connaissance faible, anecdotique, secondaire ou artificiellement découpée juste pour remplir. La qualité prime toujours sur la quantité.",
    ...(levelInstruction ? [`Niveau demandé (influence l'exigence de sélectivité, jamais le nombre à atteindre) : ${levelInstruction}`] : []),
    "",
    "Pour un élément \"Ce jour dans l'Histoire\" : les faits candidats portent sur l'événement lui-même — jamais un détail insignifiant (dates exactes au jour près, chiffres secondaires).",
    "Pour un élément d'éclairage : les faits candidats portent UNIQUEMENT sur l'événement/concept/citation/œuvre lui-même — jamais un simple détail anecdotique.",
    "Pour un élément \"citation du jour\" : le texte exact de la citation, son auteur et son contexte tels que fournis peuvent être admis, jamais modifiés.",
    "Pour un élément \"mot latin du jour\" dont la provenance est \"traduction composée pour l'occasion\" : n'admets JAMAIS de connaissance le présentant comme une expression ancienne, un proverbe ou une citation historique — seule sa grammaire (cas, déclinaison, conjugaison, sens des mots) peut être admise.",
    "",
    "Pour chaque connaissance admise, indique aussi deux signaux qui serviront ensuite à choisir un format de question adapté (jamais l'inverse) :",
    "- \"sequential\" (booléen) : true UNIQUEMENT si ce fait décrit une vraie séquence objective et établie (étapes historiques attestées, processus réel, ordre chronologique, procédure structurée) ET que le texte fourni donne assez d'indications explicites (dates, \"avant\"/\"après\"/\"puis\"...) pour établir avec certitude l'ordre RÉEL des étapes — jamais seulement l'ordre dans lequel le texte les mentionne, qui peut différer de leur chronologie réelle (narration, ordre de collecte de l'information...). False dans tous les autres cas, y compris pour un concept ou une théorie qu'on pourrait artificiellement présenter comme une suite d'étapes, ou pour une séquence réelle mais dont le texte ne permet pas de reconstituer l'ordre exact avec certitude.",
    "- \"clearBoundary\" (booléen) : true UNIQUEMENT si on peut construire une proposition clairement et objectivement FAUSSE dans le cadre précis de cette connaissance (utile pour un futur format \"intrus\") — false si la frontière dépend d'une interprétation, d'un niveau de généralité discutable, ou reste floue.",
    "",
    "Réponds uniquement en JSON strict, sous la forme {\"knowledge\":[{\"fact\":\"phrase factuelle courte et autonome\",\"importance\":\"high|medium|low\",\"certainty\":\"high|medium|low\",\"sequential\":true|false,\"clearBoundary\":true|false}]} — n'inclus QUE les connaissances qui passent tous les critères ci-dessus ; \"importance\" et \"certainty\" doivent toutes deux valoir \"high\" ou \"medium\" pour être admise (jamais \"low\" sur l'un des deux : dans ce cas, ne l'inclus simplement pas).",
    "",
    "Élément à analyser :",
    sourceText
  ].join("\n");
}

// ── Génération des questions à partir des SEULES connaissances déjà admises
// ── Remplace l'ancien buildCultureGeneraleQuizPrompt (qui sélectionnait et
// questionnait en un seul appel) et sert désormais aussi bien Éclairages/
// Histoire (includeVariants=false côté appelant, comportement identique à
// avant sur ce point précis) que le sujet libre/notion de débat avec niveau
// (includeVariants=true, cf. buildFicheAndKnowledgeAdmissionPrompt plus
// bas) — un seul générateur de questions, jamais deux versions à maintenir
// en parallèle pour la même règle "ne teste que ce qui est admis".
// `formatBlockLines` : déjà construit par l'appelant (server.js
// buildQuestionFormatsPromptBlock, qui reste là-bas — dépend de constantes/
// helpers propres à server.js) plutôt que reconstruit ici, pour garder
// cette fonction pure et testable sans dépendre de tout server.js.
//
// Identifiant par connaissance (audit coût import photo, 24/08/2026) : si
// UN SEUL élément de `admittedKnowledge` porte un champ `id`, chaque
// connaissance affiche désormais le sien entre crochets et le modèle doit le
// recopier tel quel dans `sourceIdField` — permet de batcher plusieurs
// connaissances SANS PARTAGER le même sourceId (cf. buildImportedKnowledgeQuestionsBatch
// dans server.js, qui donne un id propre à chaque fait importé). Strictement
// rétrocompatible : sans `id` sur les éléments (tous les appelants existants
// à ce jour), la sortie de cette fonction est inchangée au caractère près —
// c'est le même `sourceId` unique pour toutes les questions, comme avant.
function buildQuestionsFromKnowledgePrompt(sourceIdField, sourceId, admittedKnowledge, levelInstruction, formatBlockLines) {
  const hasPerKnowledgeIds = admittedKnowledge.some((k) => k.id != null);
  // Repli défensif k.id ?? sourceId (jamais la chaîne "undefined") : tous les
  // appelants actuels posent `id` sur soit AUCUN soit TOUS les éléments,
  // jamais un mélange — mais un futur appelant mixte ne doit jamais produire
  // un `[sourceId="undefined"]` littéral dans le prompt.
  const knowledgeLines = admittedKnowledge
    .map((k, i) => `${i + 1}. ${hasPerKnowledgeIds ? `[${sourceIdField}="${k.id ?? sourceId}"] ` : ""}${k.fact} ${k.sequential ? "[séquence réelle : \"ordre\" envisageable]" : "[PAS de séquence réelle : jamais \"ordre\"]"} ${k.clearBoundary ? "[frontière nette : \"intrus\" envisageable]" : "[frontière floue : jamais \"intrus\"]"}`)
    .join("\n");
  return [
    "Tu écris un QCM de culture générale en français. Les connaissances numérotées plus bas ont déjà été sélectionnées comme dignes d'être mémorisées durablement — ton seul travail ici est de les transformer en bonnes questions, jamais d'en choisir, reformuler le sens, ou en inventer de nouvelles.",
    "Règles strictes :",
    "- Chaque question doit tester EXACTEMENT une connaissance de la liste ci-dessous — jamais une dérive vers un autre fait, jamais un détail périphérique absent de cette liste, même pour construire un distracteur ou un intrus.",
    // Renforcement du 02/09/2026 (audit QCM "Stalinisme", daily_quiz.id=358) :
    // la règle ci-dessus interdisait déjà de "dériver" vers le CONTENU d'une
    // autre connaissance, mais jamais explicitement de réutiliser le NOM, la
    // date ou le libellé d'une autre connaissance de la même liste comme
    // simple mauvaise option — un distracteur peut alors rester
    // techniquement "sur cette connaissance-ci" tout en étant, dans les
    // faits, la réponse (ou la date, ou le nom) d'une AUTRE question du même
    // lot, ce qui la rend éliminable par reconnaissance plutôt que par la
    // connaissance testée. Cas réels observés : "En 1924"/"22 juin
    // 1941"/"février 1956" utilisés comme distracteurs de la question sur la
    // mort de Staline alors que ce sont les dates exactes testées par
    // d'autres questions du même lot ; "Le Goulag"/"le Parti communiste
    // soviétique" utilisés comme distracteurs de la question sur le NKVD
    // alors que ce sont les réponses d'autres questions du même lot.
    "- Un distracteur ne doit JAMAIS reprendre le nom, le label, la date ou la formulation caractéristique d'une AUTRE connaissance de cette liste, ni la réponse correcte d'une autre question que tu écris dans ce même lot — même si ce nom/cette date/ce libellé est parfaitement exact. Un lecteur ne doit jamais pouvoir éliminer ce distracteur simplement en reconnaissant \"c'est la réponse d'une autre question de ce QCM\" plutôt qu'en raisonnant sur la connaissance testée ICI. Invente plutôt, pour CE distracteur, une erreur plausible mais fictive ou une confusion vraisemblable directement sur le concept de CETTE question précise (une date proche mais fausse pour ce fait-ci, une attribution plausible mais erronée pour ce fait-ci) — jamais un emprunt à une autre connaissance de la liste.",
    "- Le champ \"knowledgeTarget\" doit reprendre EXACTEMENT le texte du fait numéroté qu'elle teste, sans le reformuler.",
    "- Au maximum une question par connaissance de la liste — jamais plus. Si une connaissance ne se prête vraiment à aucune question sérieuse sans se répéter ou sans trahir une des règles ci-dessous, tu peux l'omettre : produire moins de questions que de connaissances admises est un comportement normal et attendu, jamais une erreur à corriger en forçant une question.",
    "- N'utilise le format \"ordre\" QUE sur une connaissance marquée [séquence réelle] ci-dessous — jamais sur une connaissance marquée [PAS de séquence réelle], même en inventant une suite d'étapes plausible : ce serait fabriquer une connaissance qui n'existe pas plutôt que tester celle qui a été admise.",
    "- N'utilise le format \"intrus\" QUE sur une connaissance marquée [frontière nette] ci-dessous — jamais sur une connaissance marquée [frontière floue].",
    "- Pour les formats à options, les options doivent être clairement distinctes les unes des autres, dans leur sens comme dans leur formulation. N'écris JAMAIS deux options qui ne diffèrent que par un mot ou un sujet interchangeable dans une phrase par ailleurs identique.",
    "- Formule chaque question et chaque option dans un français naturel et directement compréhensible, jamais un copié-collé télégraphique.",
    "- Pour le format \"qcm\", jamais de question fermée oui/non ni de formulation binaire équivalente (interdit sous toute forme, cf. plus bas) — reformule toujours en question à 4 options distinctes.",
    "- Difficulté grand public, formulation neutre, sans jugement de valeur.",
    ...(levelInstruction ? [`- ${levelInstruction}`] : []),
    "",
    ...formatBlockLines,
    "",
    hasPerKnowledgeIds
      ? `Connaissances admises à transformer en questions — chacune indique déjà son propre "${sourceIdField}" entre crochets ci-dessous : reprends-le EXACTEMENT tel quel (jamais une valeur inventée, arrondie ou recopiée d'une autre ligne) dans le champ "${sourceIdField}" de la question qui la teste :`
      : `Connaissances admises à transformer en questions (${sourceIdField}:"${sourceId}" pour chacune) :`,
    knowledgeLines
  ].join("\n");
}

// ── Sujet libre / notion de débat avec niveau : fiche + connaissances
// candidates en un seul appel ── Ce pipeline n'avait JUSQU'AU 31/08/2026
// AUCUN texte source externe — contrairement à Éclairages/Histoire
// (buildKnowledgeAdmissionPrompt), la fiche elle-même était rédigée par le
// modèle à partir du seul nom du sujet. C'était le pipeline le plus fragile
// identifié par l'audit (aucun grounding externe). `groundingText`
// (optionnel, résolu par server.js via resolveWebSearchGrounding + Brave
// Search + lib/web-search-grounding.js, cf. son commentaire de tête) comble
// ce manque quand une recherche web a effectivement trouvé des sources
// pertinentes ET fiables sur CE sujet — sinon (recherche infructueuse,
// BRAVE_SEARCH_API_KEY absente, échec réseau) reste `null`, comportement
// strictement identique à avant. Cette fonction ne rédige donc QUE la fiche
// + une liste de connaissances CANDIDATES qu'elle en extrait (jamais de
// questions ici) : l'admission définitive passe ensuite par une SECONDE
// passe IA indépendante et conservatrice (cf. buildKnowledgeVerificationPrompt,
// à qui `groundingText` est également transmis) avant que
// buildQuestionsFromKnowledgePrompt ne les transforme en questions.
// Important, à ne jamais perdre de vue : la seconde passe améliore la
// robustesse (un second regard, plus prudent, sur les mêmes candidats) mais
// ne constituait PAS, à elle seule, un grounding externe réel — sans
// `groundingText`, rien ne vérifie ces faits contre une source indépendante
// du modèle lui-même.
function buildFicheAndKnowledgeAdmissionPrompt(subject, contextHint, levelConfig, requireValidation, groundingText = null) {
  // `target` (demande du 01/09/2026, "corriger le sous-remplissage du corpus
  // master") : jusqu'ici récupéré nulle part ici alors que levelConfig est
  // désormais TOUJOURS MASTER_GENERATION_DEPTH_CONFIG (cf. server.js) — le
  // modèle n'avait donc aucune idée du nombre de connaissances "jusqu'à"
  // souhaitable et s'arrêtait souvent bien plus tôt que la matière ne
  // l'aurait permis. Relayé tel quel (jamais une valeur dupliquée en dur
  // ici) dans le paragraphe IMPORTANT ci-dessous.
  const { instruction, sectionsRange, lengthHint, target } = levelConfig;
  const lines = [`Tu es un rédacteur pédagogique francophone. Un visiteur veut mémoriser ce sujet : "${subject}".`];
  if (contextHint) lines.push(`Contexte d'origine (pour t'aider à cerner le sujet, mais la fiche doit rester une présentation autonome et complète du sujet lui-même, pas un résumé de ce contexte) : ${contextHint}`);
  if (groundingText) {
    lines.push("");
    lines.push("Voici de VRAIES sources web trouvées sur ce sujet précis (extraits de pages réelles, jugées pertinentes et fiables) — base la fiche PRINCIPALEMENT dessus. N'utilise ta propre mémoire que pour du contexte général, de la reformulation ou des connaissances de base incontestables (ex. dates/définitions extrêmement connues) — jamais pour un fait précis, chiffré ou spécifique qui n'apparaît dans aucune des sources ci-dessous : écarte-le plutôt que de l'inventer.");
    lines.push(groundingText);
  }
  lines.push("");
  if (requireValidation) {
    lines.push("Étape 1 : vérifie que ce sujet désigne bien un sujet de connaissance réel et sérieux (fait historique, scientifique, culturel, géographique, technique, etc.) sur lequel on peut écrire une fiche factuelle vérifiable. Refuse (valid:false) s'il est vide, absurde, injurieux, dangereux, illégal, à caractère sexuel, ou trop vague/générique pour donner une fiche précise (ex. \"tout\", \"la vie\").");
    lines.push("Si le sujet n'est pas valide, réponds uniquement : {\"valid\":false,\"reason\":\"phrase courte en français expliquant pourquoi, destinée à être affichée à l'utilisateur\"}");
    lines.push("");
    lines.push("Étape 2 : si le sujet est valide, rédige :");
  } else {
    lines.push("Rédige :");
  }
  lines.push("1. Une fiche de mémorisation synthétique et strictement factuelle en français (esprit fiche de révision : dense, claire, sans blabla, aucune approximation présentée comme un fait établi, aucune invention).");
  lines.push("2. À partir de cette fiche, une liste des CONNAISSANCES qui méritent réellement d'être mémorisées durablement — jamais de questions, d'options ni de format à ce stade, uniquement les faits eux-mêmes. Pour chaque fait candidat, évalue silencieusement :");
  lines.push("   - VÉRACITÉ ET CERTITUDE : le fait doit être correct et suffisamment établi. Ne transforme jamais une hypothèse, un débat ou une interprétation en vérité absolue — une interprétation ne peut être admise QUE clairement attribuée (\"selon X\", \"dans cette théorie\") et réellement centrale. En cas de doute réel, écarte le fait plutôt que de risquer une erreur présentée comme certaine.");
  lines.push("   - RELATION DIRECTE AU SUJET : pas seulement la même époque, le même lieu ou un contexte périphérique.");
  lines.push("   - IMPORTANCE : une personne cultivée aurait-elle réellement intérêt à conserver cette information dans plusieurs années ? Si non, écarte-la.");
  lines.push("   - DISTINCTIVITÉ : le fait doit aider à caractériser CE sujet précisément, jamais un détail interchangeable avec des dizaines d'autres.");
  lines.push("   - STABILITÉ : évite ce qui deviendra vite obsolète (poste actuel, classement actuel, chiffre mouvant), sauf si le caractère daté est précisément la connaissance elle-même.");
  lines.push("   - GRANULARITÉ : ni trop vague, ni microscopique — une unité mentale autonome et utile.");
  lines.push("   Sois particulièrement prudent avec \"premier\", \"dernier\", \"seul\", \"unique\", \"toujours\", \"jamais\", \"principal\", \"exactement\", \"cause\", \"provoque\", \"est responsable de\" : reformule plus prudemment si besoin, ou écarte le fait.");
  lines.push("3. Priorité à l'utilité, jamais au simple effet : un fait étonnant ou peu connu est un vrai plus s'il est réellement vrai et structurant, mais ne remplace jamais un fait utile par un détail choisi seulement parce qu'il est original.");
  if (instruction) lines.push(`4. ${instruction}`);
  lines.push("");
  // Corrige un sous-remplissage constaté en production (demande du
  // 01/09/2026) : l'ancienne formulation ("ne cherche JAMAIS à atteindre un
  // nombre donné... une liste courte, voire vide, est parfaitement normale")
  // poussait le modèle à s'arrêter dès qu'il jugeait avoir "assez" de
  // matière, y compris sur des sujets manifestement riches où beaucoup
  // d'angles importants restaient inexplorés. `target` (toujours fourni :
  // levelConfig est désormais MASTER_GENERATION_DEPTH_CONFIG, cf. son
  // commentaire dans server.js) sert de plafond SOUHAITABLE explicite —
  // jamais un minimum : le repli sans nombre ci-dessous couvre uniquement le
  // cas défensif où `target` serait absent.
  if (Number.isFinite(target) && target > 0) {
    lines.push(`IMPORTANT — si ce sujet est réellement riche, vise jusqu'à environ ${target} connaissances distinctes, utiles et non redondantes : avant de conclure que la matière est épuisée, passe en revue les différents aspects vraiment importants du sujet (origine et contexte, dates ou étapes clés, acteurs ou institutions concernés, notions ou principes fondamentaux, mécanismes de fonctionnement, chiffres ou exemples précis, controverses ou nuances, conséquences, limites, postérité...) pour t'assurer de ne pas t'arrêter prématurément sur un sous-ensemble partiel du sujet. Ce chiffre reste un plafond souhaitable quand le sujet le permet, JAMAIS un quota obligatoire ni un minimum à atteindre à tout prix : n'ajoute jamais un fait secondaire, redondant, anecdotique, hors-sujet ou artificiellement découpé en plusieurs connaissances uniquement pour s'en approcher. Si le sujet n'offre légitimement pas assez de matière solide et distincte, une liste plus courte — voire vide — reste parfaitement normale : la qualité et la pertinence priment toujours sur la quantité.`);
  } else {
    lines.push("IMPORTANT — ne cherche JAMAIS à atteindre un nombre donné de connaissances candidates. Une liste courte, voire vide, est parfaitement normale si le sujet n'offre pas plus de matière solide — la qualité prime toujours sur la quantité.");
  }
  lines.push("");
  lines.push("Champs de la fiche :");
  lines.push("- \"sourceName\" : nom court et correctement capitalisé du sujet (ex. \"Guerre de Cent Ans\", \"Photosynthèse\") — reformule si la saisie de départ est une question ou une phrase (ex. \"c'est quoi la photosynthèse\" → \"Photosynthèse\"), jamais recopiée telle quelle dans ce cas.");
  lines.push("- \"meta\" : une ligne courte de repères (dates, lieu, auteur...) si pertinent, sinon null.");
  lines.push(`- "sections" : ${sectionsRange} blocs {"label": string ou null, "text": string} — la fiche ${lengthHint}`);
  lines.push(`- "imageSearchQuery" : une courte requête factuelle (3 à 8 mots, en français si le sujet s'y prête, sinon dans la langue la plus pertinente) permettant de retrouver une photographie ou illustration éditoriale pertinente pour CE sujet sur Wikipédia — jamais une requête qui donnerait la réponse à une future question sur ce sujet, jamais de texte de réponse écrit en toutes lettres dans la requête (ex. pour "quelle est la capitale du Burundi ?", écris "Burundi paysage" ou "Burundi", jamais "Gitega"). Réponds null si le sujet ne se prête pas à une illustration pertinente (notion abstraite, concept mathématique, sujet pour lequel toute image serait artificielle ou trompeuse) — pas d'image vaut toujours mieux qu'une image forcée ou qui trahit la réponse.`);
  lines.push("");
  lines.push("Champs de chaque connaissance candidate (tableau \"knowledge\") — mêmes signaux qu'un contrôle qualité, utiles pour choisir ensuite un format de question adapté SANS jamais déformer le fait pour le faire rentrer dans un format :");
  lines.push("- \"fact\" : phrase factuelle courte et autonome.");
  lines.push("- \"importance\"/\"certainty\" : \"high\"|\"medium\"|\"low\" chacun (\"low\" sur l'un des deux = à ne pas inclure du tout).");
  lines.push("- \"sequential\" (booléen) : true UNIQUEMENT si ce fait décrit une vraie séquence objective et établie (étapes attestées, processus réel, chronologie) ET que son ordre RÉEL peut être établi avec certitude (dates, \"avant\"/\"après\"/\"puis\"...) — jamais seulement l'ordre dans lequel les étapes te viennent à l'esprit ou sont mentionnées dans une source, qui peut différer de leur chronologie réelle. False sinon, y compris pour un concept qu'on pourrait artificiellement présenter comme une suite d'étapes.");
  lines.push("- \"clearBoundary\" (booléen) : true UNIQUEMENT si on peut construire une proposition clairement et objectivement FAUSSE dans le cadre précis de ce fait — false si la frontière dépend d'une interprétation ou reste floue.");
  lines.push("");
  lines.push(`Réponds uniquement en JSON strict, sans aucun texte autour${requireValidation ? ", sous l'une de ces deux formes exactement :\n- Sujet refusé : {\"valid\":false,\"reason\":\"...\"}\n- Sujet accepté : {\"valid\":true,\"sourceName\":\"...\",\"meta\":\"...\"|null,\"sections\":[{\"label\":\"...\"|null,\"text\":\"...\"}],\"imageSearchQuery\":\"...\"|null,\"knowledge\":[{\"fact\":\"...\",\"importance\":\"high|medium|low\",\"certainty\":\"high|medium|low\",\"sequential\":true|false,\"clearBoundary\":true|false}]}" : `, sous cette forme exactement : {"sourceName":"...","meta":"..."|null,"sections":[{"label":"..."|null,"text":"..."}],"imageSearchQuery":"..."|null,"knowledge":[{"fact":"...","importance":"high|medium|low","certainty":"high|medium|low","sequential":true|false,"clearBoundary":true|false}]}`}`);
  return lines.join("\n");
}

// ── Passe de vérification indépendante, sujet libre uniquement ── Un appel
// SÉPARÉ de celui qui a rédigé la fiche et proposé les candidats ci-dessus
// — jamais le même appel qui s'auto-évaluerait. Volontairement
// conservatrice : en cas de doute, le candidat est rejeté. Batché (toutes
// les connaissances candidates d'UN sujet en un seul appel, jamais un appel
// par connaissance) pour ne pas faire exploser le coût IA.
// Répété ici pour ne jamais l'oublier dans le code comme dans les
// commentaires : SANS `groundingText`, cette passe ne prouve toujours pas la
// véracité du fait par une source externe — c'est un second jugement IA, pas
// un fait-checking. AVEC `groundingText` (mêmes vraies sources web que celles
// transmises à buildFicheAndKnowledgeAdmissionPrompt, cf. son commentaire),
// un vrai contrôle contre une source indépendante devient possible et est
// ajouté comme critère de rejet supplémentaire ci-dessous — jamais un
// remplacement des critères existants, qui restent tous appliqués.
function buildKnowledgeVerificationPrompt(candidates, subjectLabel, groundingText = null) {
  const lines = candidates.map((c, i) => `${i}. ${c.fact}`).join("\n");
  return [
    `Un premier passage a proposé les connaissances candidates ci-dessous pour le sujet "${subjectLabel}", à admettre ou non dans un système de mémorisation de longue durée. Ton rôle ici est de les rejuger de façon INDÉPENDANTE et volontairement STRICTE — tu n'es pas l'auteur de cette liste, tu la contrôles.`,
    "",
    "Rejette (accept:false) une connaissance candidate si :",
    "- tu as le moindre doute factuel sur son exactitude ;",
    "- sa formulation est trop absolue (\"le premier\", \"le seul\", \"toujours\", \"la cause principale\"...) au regard de ce que l'on peut réellement établir avec certitude sur ce sujet ;",
    "- elle relève d'une interprétation, d'un débat ou d'une école de pensée présentée comme un fait neutre, sans attribution explicite ;",
    "- elle est périphérique au sujet (contexte, détail biographique accessoire, élément qui ne caractérise pas vraiment le sujet) ;",
    "- son importance est insuffisante pour mériter une mémorisation de plusieurs mois ou années ;",
    "- elle risque de devenir rapidement obsolète (sauf si la date/le caractère temporel est précisément ce qui doit être retenu)."
      + (groundingText ? " ;\n- elle n'est PAS clairement soutenue par les sources ci-dessous, même si elle te semble par ailleurs plausible de mémoire." : ""),
    "",
    "N'accepte (accept:true) QUE les connaissances qui passent clairement tous ces contrôles. En cas de doute réel, rejette plutôt que d'accepter — mieux vaut une liste plus courte qu'une connaissance douteuse mémorisée pendant des mois. N'ajoute et ne reformule aucun fait : uniquement accept/reject sur chaque candidat tel que fourni.",
    "",
    "Connaissances candidates (index puis fait) :",
    lines,
    ...(groundingText ? ["", "Sources ayant servi à rédiger cette liste, à utiliser comme référence pour ce contrôle :", groundingText] : []),
    "",
    'Réponds uniquement en JSON strict, sous la forme {"decisions":[{"index":0,"accept":true|false,"reason":"raison technique courte, interne, jamais affichée à l\'utilisateur"}]} — un objet par candidat ci-dessus, dans le même ordre.'
  ].join("\n");
}

// Conservateur par construction : un index absent de la réponse, mal formé,
// ou dont "accept" n'est pas strictement `true`, est rejeté — jamais admis
// par défaut (cf. buildKnowledgeVerificationPrompt, "en cas de doute réel,
// rejette").
function applyKnowledgeVerificationDecisions(candidates, rawDecisions) {
  const acceptedIndexes = new Set();
  if (Array.isArray(rawDecisions)) {
    for (const d of rawDecisions) {
      const idx = Number(d?.index);
      if (Number.isInteger(idx) && d?.accept === true) acceptedIndexes.add(idx);
    }
  }
  return candidates.filter((_, i) => acceptedIndexes.has(i));
}

// Validation structurelle de la seule chose que le modèle nous doit sur ce
// terrain (§2 du cahier des charges "image sur les connaissances") : une
// courte chaîne, ou explicitement null/absente — jamais autre chose qui
// atteindrait telle quelle lib/knowledge-image-search.js. Une chaîne vide
// après trim est traitée comme "pas de requête" plutôt que rejetée, un
// modèle répondant "" étant équivalent à null en pratique.
function sanitizeImageSearchQuery(raw) {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value) return null;
  return value.slice(0, 150);
}

module.exports = {
  buildKnowledgeAdmissionPrompt,
  buildQuestionsFromKnowledgePrompt,
  buildFicheAndKnowledgeAdmissionPrompt,
  buildKnowledgeVerificationPrompt,
  applyKnowledgeVerificationDecisions,
  sanitizeImageSearchQuery
};
