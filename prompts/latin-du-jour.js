"use strict";

// Prompt du "Mot latin du jour". Isolé du reste du backend pour pouvoir être
// relu/ajusté sans toucher à lib/latin-du-jour.js (qui ne fait qu'orchestrer
// génération + validation + stockage).
//
// Rubrique choisie en écho à l'actualité du jour (comme les autres rubriques
// Éclairages), avec une présentation simple : un mot ou une courte
// expression latine, sa traduction littérale, son sens/usage, et un petit
// paragraphe qui rend explicite le lien avec l'actualité — pas les 4
// sections complètes des rubriques "rapprochement" (concept/mécanisme/
// pensée/parallèle).
//
// Historique de conception (utile pour ne pas régresser) :
// - v1 : l'IA devait reconnaître/inventer une expression latine. Résultat
//   réel (04/08/2026) : elle a inventé un pseudo-proverbe plausible
//   ("Fulmen in clausula") ET une fausse origine historique.
// - v2 : ajout de phrase_origin (article/attested/composed) pour au moins
//   être honnête sur la provenance quand l'IA compose elle-même.
// - v3 (actuelle) : découverte que chaque arène "open" du bot de veille se
//   termine déjà, dans debates.content, par une formule latine propre à cet
//   article (ex. "Fulgura in itinere" pour des randonneurs foudroyés en
//   chemin), suivie d'une signature — extraite côté serveur par
//   extractDebateContentLatinMotto (cf. server.js, getPublishedTopicsForDate)
//   et transmise ici via topic.latinMotto. Le vrai rôle de cette rubrique
//   n'est donc PAS de faire deviner une expression par l'IA : c'est de
//   choisir, parmi les formules déjà présentes dans les articles du jour,
//   celle qui vaut le plus la peine d'être expliquée, et d'en faire un cours
//   de grammaire. "attested"/"composed" ne sont plus qu'un repli pour le cas
//   rare où aucun sujet fourni n'a de formule officielle détectée.
//
// Volet pédagogique (grammar_breakdown) : contrairement aux autres
// rubriques, l'objectif n'est pas seulement d'éclairer l'actualité mais
// aussi d'apprendre un peu de latin — décomposition mot par mot avec nature
// grammaticale, forme précise (cas/déclinaison, personne/mode/temps/
// conjugaison) et sens littéral, écrite pour quelqu'un qui n'a jamais fait
// de latin.

const MAX_LATIN_HINT = 1;

const PHRASE_ORIGIN_VALUES = ["article", "attested", "composed"];

const RESPONSE_SCHEMA_HINT = `Format de réponse strict — un unique objet JSON, sans texte avant ni après, sans balises Markdown (pas de \`\`\`), sous l'une des deux formes suivantes.

Si un mot ou une expression latine pertinente est possible, en écho à l'un des sujets fournis :
{
  "status": "published",
  "latins": [
    {
      "current_topic_id": "identifiant du sujet choisi, recopié exactement tel que fourni",
      "latin_phrase": "le mot ou la courte expression en latin",
      "phrase_origin": "un des trois exactement : \\"article\\" (formule latine officielle fournie pour ce sujet, recopiée EXACTEMENT), \\"attested\\" (expression latine réelle et bien connue que tu es sûr de reconnaître — uniquement si le sujet n'a PAS de formule officielle fournie), \\"composed\\" (traduction latine que tu composes toi-même — uniquement si le sujet n'a PAS de formule officielle fournie et qu'aucune expression attestée ne convient)",
      "literal_translation": "traduction littérale en français",
      "explanation": "explique le sens de l'expression et de ses mots. Si phrase_origin est \\"attested\\" et que tu connais son origine réelle avec certitude (auteur antique, domaine juridique/scientifique/religieux/philosophique), donne-la. Sinon (article ou composed) : n'invente AUCUNE origine historique — dis simplement ce que signifie l'expression, éventuellement (pour \\"composed\\" uniquement) qu'elle est composée pour l'occasion. 2 à 4 phrases.",
      "news_connection": "un petit paragraphe (2 à 3 phrases) qui rend explicite le lien avec le sujet d'actualité choisi : nomme le sujet et explique en quoi cette expression y fait écho ou le traduit",
      "grammar_breakdown": [
        {
          "word": "le mot latin exact, tel qu'il apparaît dans l'expression",
          "note": "nature grammaticale + forme précise (cas et déclinaison pour un nom/adjectif/pronom ; personne, mode, temps et conjugaison pour un verbe) + sens littéral de ce mot seul, en une phrase courte, avec les termes techniques toujours brièvement expliqués entre parenthèses pour un lecteur qui n'a jamais fait de latin"
        }
      ],
      "sources": [
        { "title": "string", "author": "string|null", "publisher": "string|null", "year": "string|null", "url": "string ou null — voir règle URL ci-dessous" }
      ]
      // "sources" est secondaire, et n'a de sens que pour phrase_origin "attested" : un seul titre général que tu connais suffit, un tableau vide [] est tout à fait acceptable (et systématique pour "article"/"composed").
    }
  ]
}

Le tableau "grammar_breakdown" est le cœur pédagogique de cette rubrique — un lecteur qui ne connaît pas le latin doit apprendre quelque chose de concret sur sa grammaire (conjugaison, déclinaison, cas) en le lisant, pas juste retenir une traduction toute faite.

Si aucune expression latine ne peut être produite avec confiance pour l'un des sujets fournis :
{
  "status": "insufficient",
  "reason": "explication brève du refus"
}`;

function formatTopicsForPrompt(topics) {
  return topics
    .map((topic, index) => {
      const lines = [
        `${index + 1}. id:${topic.id}`,
        `   Titre : ${String(topic.title || "").trim()}`,
        `   Résumé : ${String(topic.summary || "").trim()}`
      ];
      if (topic.category) lines.push(`   Catégorie : ${String(topic.category).trim()}`);
      lines.push(
        topic.latinMotto
          ? `   Formule latine OFFICIELLE de cet article, à reprendre EXACTEMENT si tu choisis ce sujet (phrase_origin: "article") : ${topic.latinMotto}`
          : "   Aucune formule latine officielle détectée pour cet article (repli possible sur \"attested\"/\"composed\" si tu choisis ce sujet)."
      );
      return lines.join("\n");
    })
    .join("\n\n");
}

// recentPhrases : expressions déjà utilisées durant les 7 derniers jours sur
// cette rubrique (cf. lib/eclairages-recent-usage.js) — à ne pas reproposer,
// même si un sujet du jour s'y prêterait bien à nouveau.
function formatRecentPhrasesForPrompt(recentPhrases) {
  if (!Array.isArray(recentPhrases) || !recentPhrases.length) return "";
  const list = [...new Set(recentPhrases)].map((phrase) => `- ${phrase}`).join("\n");
  return [
    "",
    "=== EXPRESSIONS DÉJÀ UTILISÉES RÉCEMMENT — NE PAS LES CHOISIR À NOUVEAU ===",
    "Les expressions suivantes ont déjà été retenues dans cette rubrique au cours des 7 derniers jours. Même si l'une d'elles ferait un excellent écho à un sujet du jour, tu dois en choisir une AUTRE — cherche une résonance différente plutôt que de répéter l'un de ces choix :",
    list
  ].join("\n");
}

function buildLatinDuJourPrompt(topics, recentPhrases) {
  if (!Array.isArray(topics) || !topics.length) {
    throw new Error("buildLatinDuJourPrompt: la liste de sujets ne peut pas être vide.");
  }

  return [
    "Tu es un rédacteur cultivé et rigoureux qui prépare la rubrique \"Mot latin du jour\" du site Agôn : elle présente un mot ou une courte expression en latin, avec sa traduction et une brève explication de son sens et de son usage.",
    "",
    "Voici jusqu'à 10 sujets d'actualité publiés aujourd'hui sur Agôn :",
    "",
    formatTopicsForPrompt(topics),
    formatRecentPhrasesForPrompt(recentPhrases),
    "",
    "=== RÈGLE PRINCIPALE — Reprendre la formule officielle de l'article ===",
    "Chaque article d'actualité ci-dessus se termine, dans sa version originale, par sa propre formule latine (indiquée sur la ligne \"Formule latine OFFICIELLE de cet article\" quand elle est fournie). C'EST CETTE FORMULE qu'il faut choisir en priorité, quasiment toujours : choisis le sujet dont la formule officielle te semble la plus intéressante à expliquer et dont le lien avec l'actualité est le plus clair, puis recopie sa formule EXACTEMENT, lettre pour lettre, dans \"latin_phrase\", avec \"phrase_origin\": \"article\". Ne la modifie jamais, ne la paraphrase jamais, ne la remplace jamais par une autre expression même si tu en connais une qui te semblerait mieux convenir : le principe de cette rubrique est de faire découvrir la formule propre à CET article précis, pas d'en choisir une autre.",
    "",
    "=== Repli (seulement si AUCUN sujet fourni n'a de formule officielle) ===",
    "1. \"attested\" — Si tu connais avec un niveau de confiance élevé une expression latine RÉELLEMENT ATTESTÉE (locution juridique ou scientifique courante, proverbe, maxime, formule historique passée dans l'usage) qui fait vraiment écho à l'un des sujets, tu peux l'utiliser.",
    "2. \"composed\" — Sinon, compose toi-même une courte expression latine (2 à 5 mots), grammaticalement correcte, qui traduit ou résume directement un fait central de l'un des sujets — comme un exercice de traduction, pas une citation. Choisis des mots latins classiques et courants pour que la traduction reste fiable.",
    "",
    "=== RÈGLE — Honnêteté sur l'origine avant tout ===",
    "L'erreur la plus grave possible ici est de présenter une expression composée par toi comme si elle était une expression ancienne réellement attestée, ou de lui inventer une fausse origine historique/un faux auteur. Le champ \"phrase_origin\" doit toujours refléter honnêtement le cas réel, et le champ \"explanation\" ne doit jamais raconter l'histoire d'une expression qui n'existe pas.",
    "Pour \"attested\" uniquement : n'utilise QUE une expression que tu reconnais avec un niveau de confiance élevé, avec une traduction exacte. Au moindre doute sur son authenticité réelle, utilise \"composed\" à la place plutôt que de prendre le risque.",
    "\"insufficient\" doit rester rare : avec une formule officielle fournie pour la quasi-totalité des sujets, il ne devrait quasiment jamais être nécessaire d'y recourir.",
    "",
    "=== Ce qu'il faut produire ===",
    "Pour le sujet retenu : l'expression latine, son phrase_origin, sa traduction littérale, une explication adaptée au cas (voir le format de réponse ci-dessous pour le détail exact selon phrase_origin, en 2 à 4 phrases), un petit paragraphe (\"news_connection\", 2 à 3 phrases) qui nomme le sujet d'actualité choisi et explique simplement en quoi l'expression y fait écho ou le traduit, et une décomposition grammaticale (\"grammar_breakdown\", voir ci-dessous).",
    "\"news_connection\" doit rester court et clair, pas une analyse : une ou deux phrases suffisent souvent à dire quel est le sujet et pourquoi l'expression résonne avec lui ou le traduit.",
    "",
    "=== Volet pédagogique — apprendre un peu de latin (\"grammar_breakdown\") ===",
    "Le but de cette rubrique n'est pas seulement d'éclairer l'actualité mais aussi d'apprendre quelque chose de concret sur la grammaire latine à chaque fois. Décompose l'expression mot par mot (un élément du tableau par mot significatif — tu peux ignorer un mot totalement vide de sens comme une simple conjonction si elle n'apporte rien, mais dans une expression courte, décompose en général TOUS les mots) :",
    "- Pour un nom, un adjectif, un pronom : indique son cas (nominatif, accusatif, génitif, datif, ablatif, vocatif) et sa déclinaison, puis son sens littéral. Explique brièvement le rôle de ce cas dans la phrase (ex. \"à l'ablatif, un cas qui n'existe pas en français : ici il indique le moyen, traduit par « par » ou « avec »\").",
    "- Pour un verbe : indique sa personne, son mode (indicatif, impératif, subjonctif, infinitif...), son temps, sa conjugaison, et son infinitif de référence, puis son sens littéral.",
    "- Pour une préposition, un adverbe ou une conjonction : indique sa nature et son sens, brièvement.",
    "N'utilise JAMAIS un terme technique (cas, déclinaison, conjugaison, mode...) sans l'expliquer en quelques mots la première fois qu'il apparaît : le lecteur type n'a jamais fait de latin. Reste concret et bref pour chaque mot (une phrase ou deux), pas un cours de grammaire complet.",
    "Si l'expression ne fait qu'un seul mot, décompose quand même ce mot (déclinaison ou conjugaison, cas ou personne/mode/temps).",
    "",
    "=== RÈGLES ÉDITORIALES OBLIGATOIRES ===",
    "- N'invente jamais une fausse origine historique/un faux auteur pour une expression composée — dis simplement qu'elle est composée pour l'occasion. N'invente jamais un mot latin, une traduction ou une origine que tu ne connais pas avec certitude : reste général plutôt que d'inventer un détail précis (auteur exact, époque exacte).",
    "- L'analyse grammaticale (grammar_breakdown) doit toujours être exacte, jamais approximative — y compris pour la formule officielle d'un article, que tu dois analyser avec la même rigueur qu'une expression que tu composerais toi-même.",
    "- RÈGLE URL (stricte) : tu n'as accès à aucune recherche documentaire réelle. Le champ \"url\" de chaque source doit TOUJOURS valoir null — n'invente jamais une URL, même une URL qui te semble plausible. Une url non nulle sera automatiquement rejetée.",
    "- Pour le titre, l'auteur, l'éditeur/organisme et l'année de chaque source : ne les indique que si tu es raisonnablement sûr du fait. Une référence incertaine doit être omise du tableau \"sources\" plutôt que devinée.",
    "- Reste compréhensible pour un lecteur non spécialiste, qui ne connaît pas le latin.",
    "- Ton sobre, informatif, non sensationnaliste — pas de dramatisation, pas de point d'exclamation.",
    "",
    RESPONSE_SCHEMA_HINT
  ].join("\n");
}

module.exports = { buildLatinDuJourPrompt, MAX_LATIN_HINT, PHRASE_ORIGIN_VALUES };
