"use strict";

// Prompt de l'"Œuvre d'art du jour". Isolé du reste du backend pour pouvoir
// être relu/ajusté sans toucher à lib/oeuvre-art-du-jour.js (qui ne fait
// qu'orchestrer génération + validation + stockage).
//
// Jumelle de citation-du-jour dans son principe (choisie en écho à
// l'actualité du jour, présentation volontairement simple — pas de section
// expliquant le rapprochement avec l'actu), adaptée au domaine des arts
// visuels : peinture, sculpture, photographie, etc.
//
// Garde-fou éditorial renforcé propre à cette rubrique : contrairement à un
// concept ou un mécanisme (qui peut être reformulé sans risque), attribuer
// une œuvre au mauvais artiste ou décrire une œuvre inexistante est une
// désinformation directe — le refus ("insufficient") doit rester le
// réflexe par défaut dès le moindre doute, et l'authenticité prime toujours
// sur la pertinence du lien avec l'actualité (jamais l'inverse).

const MAX_OEUVRES_HINT = 1;

const RESPONSE_SCHEMA_HINT = `Format de réponse strict — un unique objet JSON, sans texte avant ni après, sans balises Markdown (pas de \`\`\`), sous l'une des deux formes suivantes.

Si tu disposes d'une œuvre réelle et bien documentée, en écho à l'un des sujets fournis :
{
  "status": "published",
  "oeuvres": [
    {
      "current_topic_id": "identifiant du sujet choisi, recopié exactement tel que fourni",
      "artwork_title": "titre exact de l'œuvre",
      "artist_name": "nom de l'artiste",
      "artwork_date": "date ou période de création (ex: \\"1889\\", \\"vers 1503-1506\\", \\"XVIIe siècle\\")",
      "artwork_description": "description de l'œuvre elle-même : ce qu'elle représente, sa technique/son style, ce qui la rend notable, 2 à 4 phrases",
      "artist_presentation": "brève présentation de l'artiste (qui il/elle est, pourquoi il/elle est connu(e)), 2 à 4 phrases",
      "sources": [
        { "title": "string", "author": "string|null", "publisher": "string|null", "year": "string|null", "url": "string ou null — voir règle URL ci-dessous" }
      ]
      // "sources" est secondaire : un seul titre général que tu connais suffit, pas besoin d'être exhaustif ni précis sur auteur/éditeur/année si tu n'en es pas sûr — un tableau vide [] est tout à fait acceptable.
    }
  ]
}

Si aucune œuvre réelle et vraiment sûre ne fait écho à l'un des sujets fournis :
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

function buildOeuvreArtDuJourPrompt(topics) {
  if (!Array.isArray(topics) || !topics.length) {
    throw new Error("buildOeuvreArtDuJourPrompt: la liste de sujets ne peut pas être vide.");
  }

  return [
    "Tu es un rédacteur cultivé et rigoureux qui prépare la rubrique \"Œuvre d'art du jour\" du site Agôn : elle présente une œuvre d'art réelle (peinture, sculpture, photographie, etc.), du passé ou contemporaine, choisie en écho à l'actualité du jour, avec une brève présentation de l'œuvre et de son artiste.",
    "",
    "Voici jusqu'à 10 sujets d'actualité publiés aujourd'hui sur Agôn :",
    "",
    formatTopicsForPrompt(topics),
    "",
    "=== RÈGLE ABSOLUE — Authenticité avant tout, prioritaire sur le lien avec l'actualité ===",
    "Attribuer une œuvre au mauvais artiste, inventer une œuvre qui n'existe pas, ou inventer son titre/sa date exacte est une désinformation directe : c'est la pire erreur possible pour cette rubrique, bien pire qu'un jour sans œuvre publiée, et bien pire qu'un lien un peu lâche avec l'actualité.",
    "Ne retiens QUE une œuvre réelle et bien documentée que tu connais avec un niveau de confiance élevé (artiste, titre, date) — privilégie les œuvres célèbres et largement documentées (dans un musée connu, largement reproduites) plutôt que des œuvres obscures ou incertaines. Ne déforme jamais la description d'une œuvre réelle et ne force jamais son sens pour la faire coller artificiellement à un sujet : si le rapprochement est trop tiré par les cheveux, ne retiens pas ce sujet-là.",
    "PIÈGE FRÉQUENT À ÉVITER ABSOLUMENT : ne \"construis\" jamais une œuvre plausible en combinant un artiste réel et prolifique (illustrateur, peintre de scènes de genre, photographe de presse, etc.) avec un titre/sujet qui semble coller à l'actualité du jour. Un artiste connu pour un certain style ne veut pas dire qu'une œuvre précise correspondant exactement au sujet du jour existe réellement dans son catalogue — c'est le mécanisme d'hallucination le plus courant sur cette rubrique. Avant de répondre, demande-toi concrètement : \"dans quel musée, quelle collection ou quelle publication précise ai-je vu reproduite cette œuvre, sous ce titre exact ?\" Si tu ne peux pas répondre à cette question avec une œuvre précise que tu as réellement rencontrée (pas seulement \"le style de cet artiste correspondrait bien\"), réponds \"insufficient\".",
    "Si tu as le moindre doute sur l'existence de l'œuvre, son titre exact, sa date ou son attribution, choisis \"insufficient\" plutôt que de prendre le risque — même si cela signifie qu'aucune œuvre n'est publiée aujourd'hui.",
    "\"insufficient\" doit être fréquent plutôt que rare ici, à la différence des autres rubriques : le défaut est le refus, pas la publication.",
    "",
    "=== Choisir le sujet ===",
    "Parcours les sujets ci-dessus et cherche, pour chacun, si une œuvre d'art réelle et bien connue de toi ferait écho à son thème — une résonance thématique, visuelle, morale ou historique suffit, pas besoin d'un lien littéral. Choisis un seul sujet, celui pour lequel le rapprochement est le plus naturel et le moins forcé. Si aucun sujet ne se prête à une œuvre dont tu es vraiment sûr, réponds \"insufficient\".",
    "",
    "=== Ce qu'il faut produire ===",
    "Pour le sujet retenu : le titre exact de l'œuvre, son artiste, sa date ou période de création, une description de l'œuvre elle-même (ce qu'elle représente, sa technique/son style, ce qui la rend notable), et une présentation brève de l'artiste (qui il/elle est, pourquoi il/elle est connu(e), en 2 à 4 phrases).",
    "Ne mentionne PAS le sujet d'actualité ni le rapprochement dans le texte produit : la description de l'œuvre et la présentation de l'artiste doivent se suffire à elles-mêmes, sans aucune référence à l'actualité du jour — seul le champ \"current_topic_id\" indique le sujet choisi.",
    "",
    "=== RÈGLES ÉDITORIALES OBLIGATOIRES ===",
    "- N'invente jamais un titre, un artiste, une date ou un détail de l'œuvre. Si tu n'es pas certain d'un détail précis (date exacte, lieu de conservation), reste général plutôt que d'inventer un détail.",
    "- RÈGLE URL (stricte) : tu n'as accès à aucune recherche documentaire réelle. Le champ \"url\" de chaque source doit TOUJOURS valoir null — n'invente jamais une URL, même une URL qui te semble plausible. Une url non nulle sera automatiquement rejetée.",
    "- Pour le titre, l'auteur, l'éditeur/organisme et l'année de chaque source : ne les indique que si tu es raisonnablement sûr du fait. Une référence incertaine doit être omise du tableau \"sources\" plutôt que devinée.",
    "- Reste compréhensible pour un lecteur non spécialiste en histoire de l'art.",
    "- Ton sobre, informatif, non sensationnaliste — pas de dramatisation, pas de point d'exclamation.",
    "",
    RESPONSE_SCHEMA_HINT
  ].join("\n");
}

module.exports = { buildOeuvreArtDuJourPrompt, MAX_OEUVRES_HINT };
