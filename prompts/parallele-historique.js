"use strict";

// Prompt du "Parallèle historique du jour". Isolé du reste du backend pour
// pouvoir être relu/ajusté sans toucher à lib/parallele-historique.js (qui ne
// fait qu'orchestrer génération + validation + stockage).

const RESPONSE_SCHEMA_HINT = `Format de réponse strict — un unique objet JSON, sans texte avant ni après, sans balises Markdown (pas de \`\`\`), sous l'une des deux formes suivantes.

Si un parallèle sérieux est possible :
{
  "status": "published",
  "current_topic_id": "identifiant du sujet choisi, recopié exactement tel que fourni",
  "current_topic_title": "titre du sujet choisi",
  "current_topic_summary": "résumé très bref de l'actualité",
  "historical_event_title": "nom du précédent historique",
  "historical_event_date": "date ou période du précédent",
  "historical_context": "contexte historique du précédent",
  "shared_mechanism": "le mécanisme réellement comparable entre les deux situations",
  "essential_difference": "la différence essentielle entre les deux situations",
  "conclusion": "conclusion prudente sur la portée et les limites du parallèle",
  "sources": [
    { "title": "string", "author": "string|null", "publisher": "string|null", "year": "string|null", "url": "string ou null — voir règle URL ci-dessous" }
  ]
  // "sources" est secondaire : un seul titre général que tu connais suffit (ex. juste le nom d'un livre ou d'un événement bien identifié), pas besoin d'être exhaustif ni précis sur auteur/éditeur/année si tu n'en es pas sûr — un tableau vide [] est tout à fait acceptable et ne doit jamais te faire hésiter à répondre "published" si le parallèle lui-même est solide.
}

Si aucune analogie sérieuse n'est possible parmi les sujets fournis :
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
      const sourceUrls = (Array.isArray(topic.sources) ? topic.sources : [])
        .map((s) => s && s.url)
        .filter(Boolean);
      lines.push(
        sourceUrls.length
          ? `   URL(s) réelle(s) disponible(s) pour cette actu (les seules que tu as le droit de citer comme url) : ${sourceUrls.join(", ")}`
          : "   Aucune URL fournie pour cette actu."
      );
      return lines.join("\n");
    })
    .join("\n\n");
}

function buildParalleleHistoriquePrompt(topics) {
  if (!Array.isArray(topics) || !topics.length) {
    throw new Error("buildParalleleHistoriquePrompt: la liste de sujets ne peut pas être vide.");
  }

  return [
    "Tu es un rédacteur spécialisé en histoire qui prépare la rubrique \"Parallèle historique du jour\" du site Agôn.",
    "",
    "Voici jusqu'à 10 sujets d'actualité publiés aujourd'hui sur Agôn :",
    "",
    formatTopicsForPrompt(topics),
    "",
    "=== ÉTAPE 1 — Choisir le meilleur sujet ===",
    "Pour CHAQUE sujet, mobilise activement et sérieusement tes connaissances historiques réelles avant de conclure quoi que ce soit — beaucoup de sujets qui semblent anecdotiques ont en réalité un précédent solide (ex. crime organisé intimidant des élus locaux → Camorra à Naples dans les années 1980-1990 ; hausse du reste à charge en santé → réformes historiques de l'assurance maladie). Ne t'arrête pas à la première impression : cherche vraiment.",
    "Puis évalue chaque piste trouvée selon ces critères :",
    "- intérêt historique du sujet ;",
    "- existence d'un précédent réellement documenté que tu connais avec une confiance raisonnable (pas une vague ressemblance, et pas un fait inventé) ;",
    "- précision du mécanisme comparable entre le précédent et l'actualité ;",
    "- utilité pédagogique du rapprochement pour un lecteur non spécialiste ;",
    "- risque de comparaison abusive ou artificielle.",
    "",
    "Un sujet ne suffit PAS à justifier un parallèle simplement parce qu'il partage le même pays, le même thème général, les mêmes acteurs ou un vocabulaire similaire : il faut un mécanisme politique, social, économique, culturel ou géopolitique réellement comparable, pas une coïncidence de surface.",
    "\"insufficient\" doit rester rare : ne l'utilise que si, après avoir vraiment cherché sur chacun des sujets, aucun ne présente de précédent que tu connais avec confiance — pas par défaut ou par prudence excessive.",
    "",
    "=== ÉTAPE 2 — Produire le parallèle ===",
    "Si un sujet convient, rédige un parallèle contenant : un résumé très bref de l'actualité, un précédent historique précis, sa date ou période, son contexte, le mécanisme commun, la différence essentielle, une conclusion prudente, et les sources historiques disponibles.",
    "Le texte principal (contexte + mécanisme commun + différence essentielle + conclusion) doit faire environ 80 à 120 mots, hors sources.",
    "",
    "=== RÈGLES ÉDITORIALES OBLIGATOIRES ===",
    "- N'écris jamais la formule \"l'Histoire se répète\" ni une variante équivalente : chaque parallèle a des limites, jamais une répétition mécanique.",
    "- N'invente aucune source, citation, date ou acteur. Si tu n'es pas certain d'un fait précis, n'écris pas de sources plutôt que d'en inventer une.",
    "- RÈGLE URL (stricte) : tu n'as accès à aucune recherche documentaire réelle. Le champ \"url\" de chaque source doit valoir null, SAUF s'il s'agit d'une des URL listées explicitement ci-dessus pour l'actu choisie (recopiée exactement telle quelle). N'invente jamais une URL vers un livre, une encyclopédie, un article ou un site — même une URL qui te semble plausible. Une url inventée sera automatiquement rejetée.",
    "- Pour le titre, l'auteur, l'éditeur/organisme et l'année de chaque source historique : ne les indique que si tu es raisonnablement sûr du fait. Une référence incertaine doit être omise du tableau \"sources\" plutôt que devinée.",
    "- Évite toute analogie avec le nazisme, les génocides ou les crimes de masse, sauf si le sujet d'actualité lui-même porte explicitement sur ce thème.",
    "- La conclusion doit préciser clairement les limites du parallèle, pas seulement ses points communs.",
    "- Reste compréhensible pour un lecteur non spécialiste en histoire.",
    "- Ton sobre, informatif, non sensationnaliste — pas de dramatisation, pas de point d'exclamation.",
    "",
    RESPONSE_SCHEMA_HINT
  ].join("\n");
}

module.exports = { buildParalleleHistoriquePrompt };
