"use strict";

// Prompt de la "Citation du jour". Isolé du reste du backend pour pouvoir
// être relu/ajusté sans toucher à lib/citation-du-jour.js (qui ne fait
// qu'orchestrer génération + validation + stockage).
//
// Rubrique choisie en écho à l'actualité du jour (comme les autres
// rubriques Éclairages), avec une présentation qui reste volontairement
// simple : pas des 4 sections complètes des autres rubriques ("ce que dit
// cette citation"/"ce qui fait écho"/"la limite du rapprochement"/
// "conclusion"), juste un unique petit paragraphe (news_connection) qui
// rend le lien avec l'actualité explicite pour le lecteur.
//
// Garde-fou éditorial renforcé propre aux citations : contrairement à un
// concept ou un mécanisme (qui peut être reformulé sans risque), une
// citation fausse ou mal attribuée à un auteur réel est une désinformation
// directe — le refus ("insufficient") doit rester le réflexe par défaut dès
// le moindre doute, et l'authenticité prime toujours sur la pertinence du
// lien avec l'actualité (jamais l'inverse).

const MAX_CITATIONS_HINT = 1;

const RESPONSE_SCHEMA_HINT = `Format de réponse strict — un unique objet JSON, sans texte avant ni après, sans balises Markdown (pas de \`\`\`), sous l'une des deux formes suivantes.

Si tu disposes d'une citation authentique dont tu es sûr, en écho à l'un des sujets fournis :
{
  "status": "published",
  "citations": [
    {
      "current_topic_id": "identifiant du sujet choisi, recopié exactement tel que fourni",
      "quote_text": "texte exact de la citation (traduite en français si l'original est dans une autre langue, en préservant fidèlement le sens — jamais paraphrasée)",
      "quote_author": "nom de l'auteur de la citation",
      "quote_origin": "contexte précis mais court de la citation : ouvrage, discours, interview, année si tu la connais",
      "author_presentation": "brève présentation de l'auteur et de son œuvre (qui il/elle est, pourquoi il/elle est connu(e)), 2 à 4 phrases",
      "news_connection": "un petit paragraphe (2 à 3 phrases) qui rend explicite le lien avec le sujet d'actualité choisi : nomme le sujet et explique en quoi la citation y fait écho — SANS analyse approfondie ni limite du rapprochement, juste de quoi comprendre pourquoi cette citation a été choisie aujourd'hui",
      "sources": [
        { "title": "string", "author": "string|null", "publisher": "string|null", "year": "string|null", "url": "string ou null — voir règle URL ci-dessous" }
      ]
      // "sources" est secondaire : un seul titre général que tu connais suffit, pas besoin d'être exhaustif ni précis sur auteur/éditeur/année si tu n'en es pas sûr — un tableau vide [] est tout à fait acceptable.
    }
  ]
}

Si aucune citation authentique et vraiment sûre ne fait écho à l'un des sujets fournis :
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
      return lines.join("\n");
    })
    .join("\n\n");
}

function buildCitationDuJourPrompt(topics) {
  if (!Array.isArray(topics) || !topics.length) {
    throw new Error("buildCitationDuJourPrompt: la liste de sujets ne peut pas être vide.");
  }

  return [
    "Tu es un rédacteur cultivé et rigoureux qui prépare la rubrique \"Citation du jour\" du site Agôn : elle présente une citation authentique d'un auteur célèbre (écrivain, philosophe, scientifique, homme ou femme politique, etc.), du passé ou contemporain, choisie en écho à l'actualité du jour, avec une brève présentation de l'auteur et de son œuvre.",
    "",
    "Voici jusqu'à 10 sujets d'actualité publiés aujourd'hui sur Agôn :",
    "",
    formatTopicsForPrompt(topics),
    "",
    "=== RÈGLE ABSOLUE — Authenticité avant tout, prioritaire sur le lien avec l'actualité ===",
    "Une fausse citation ou une citation mal attribuée est une désinformation directe visant une personne réelle : c'est la pire erreur possible pour cette rubrique, bien pire qu'un jour sans citation publiée, et bien pire qu'un lien un peu lâche avec l'actualité.",
    "N'utilise QUE une citation que tu connais avec un niveau de confiance élevé, mot pour mot ou très proche du mot pour mot — jamais une citation \"probable\", \"qui sonne juste\", ou que tu ne fais que \"penser\" attribuable à quelqu'un. Ne déforme jamais une citation authentique et ne force jamais son sens pour la faire coller artificiellement à un sujet : si le rapprochement est trop tiré par les cheveux, ne retiens pas ce sujet-là.",
    "Si tu as le moindre doute sur l'exactitude du texte ou sur l'attribution à l'auteur, choisis \"insufficient\" plutôt que de prendre le risque — même si cela signifie qu'aucune citation n'est publiée aujourd'hui.",
    "\"insufficient\" doit être fréquent plutôt que rare ici, à la différence des autres rubriques : le défaut est le refus, pas la publication.",
    "",
    "=== Choisir le sujet ===",
    "Parcours les sujets ci-dessus et cherche, pour chacun, si une citation authentique et bien connue de toi ferait écho à son thème — une résonance thématique, morale ou historique suffit, pas besoin d'un lien littéral. Choisis un seul sujet, celui pour lequel le rapprochement est le plus naturel et le moins forcé. Si aucun sujet ne se prête à une citation dont tu es vraiment sûr, réponds \"insufficient\".",
    "",
    "=== Ce qu'il faut produire ===",
    "Pour le sujet retenu : une seule citation, avec le texte exact, son auteur, l'origine précise (ouvrage, discours, année si tu la connais), une présentation brève de l'auteur (qui il/elle est, pourquoi il/elle est connu(e), en 2 à 4 phrases), et un petit paragraphe (\"news_connection\", 2 à 3 phrases) qui nomme le sujet d'actualité choisi et explique simplement en quoi la citation y fait écho.",
    "\"news_connection\" doit rester court et clair, pas une analyse : une ou deux phrases suffisent souvent à dire quel est le sujet et pourquoi la citation résonne avec lui. Ne force jamais ce paragraphe à sembler plus pertinent que le rapprochement ne l'est réellement — reste honnête sur le caractère plus ou moins direct du lien.",
    "",
    "=== RÈGLES ÉDITORIALES OBLIGATOIRES ===",
    "- N'invente jamais un mot de la citation, jamais l'auteur, jamais le contexte. Si tu n'es pas certain d'un détail précis (date exacte, ouvrage exact), reste général plutôt que d'inventer un détail.",
    "- RÈGLE URL (stricte) : tu n'as accès à aucune recherche documentaire réelle. Le champ \"url\" de chaque source doit TOUJOURS valoir null — n'invente jamais une URL, même une URL qui te semble plausible. Une url non nulle sera automatiquement rejetée.",
    "- Pour le titre, l'auteur, l'éditeur/organisme et l'année de chaque source : ne les indique que si tu es raisonnablement sûr du fait. Une référence incertaine doit être omise du tableau \"sources\" plutôt que devinée.",
    "- Reste compréhensible pour un lecteur non spécialiste.",
    "- Ton sobre, informatif, non sensationnaliste — pas de dramatisation, pas de point d'exclamation.",
    "",
    RESPONSE_SCHEMA_HINT
  ].join("\n");
}

module.exports = { buildCitationDuJourPrompt, MAX_CITATIONS_HINT };
