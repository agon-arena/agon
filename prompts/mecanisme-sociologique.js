"use strict";

// Prompt du "Mécanisme sociologique du jour". Isolé du reste du backend pour
// pouvoir être relu/ajusté sans toucher à lib/mecanisme-sociologique.js (qui
// ne fait qu'orchestrer génération + validation + stockage).

const MAX_MECANISMES_HINT = 1;

const RESPONSE_SCHEMA_HINT = `Format de réponse strict — un unique objet JSON, sans texte avant ni après, sans balises Markdown (pas de \`\`\`), sous l'une des deux formes suivantes.

Si un mécanisme sérieux est possible, choisis UNIQUEMENT le sujet le plus pertinent parmi ceux fournis (un seul, jamais plusieurs) :
{
  "status": "published",
  "mecanismes": [
    {
      "current_topic_id": "identifiant du sujet choisi, recopié exactement tel que fourni",
      "current_topic_title": "titre du sujet choisi",
      "current_topic_summary": "résumé très bref de l'actualité",
      "sociological_concept": "nom du concept ou du mécanisme sociologique",
      "sociologist_name": "sociologue ou courant/école associé (ex: \\"Pierre Bourdieu\\", \\"l'École de Chicago\\")",
      "concept_origin": "contexte ou époque d'apparition du concept",
      "concept_explanation": "explication claire et accessible du concept",
      "shared_mechanism": "ce qui, dans l'actualité, fait vraiment écho au concept",
      "essential_difference": "la limite de l'analogie : où le concept cesse de bien s'appliquer",
      "conclusion": "conclusion prudente sur la portée et les limites du rapprochement",
      "sources": [
        { "title": "string", "author": "string|null", "publisher": "string|null", "year": "string|null", "url": "string ou null — voir règle URL ci-dessous" }
      ]
      // "sources" est secondaire : un seul titre général que tu connais suffit, pas besoin d'être exhaustif ni précis sur auteur/éditeur/année si tu n'en es pas sûr — un tableau vide [] est tout à fait acceptable et ne doit jamais te faire hésiter à inclure ce mécanisme si le rapprochement lui-même est solide.
    }
  ]
}

Si aucun rapprochement sociologique sérieux n'est possible parmi les sujets fournis :
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

// recentConcepts : concepts sociologiques déjà utilisés durant les 7
// derniers jours sur cette rubrique (cf. lib/eclairages-recent-usage.js) —
// à ne pas reproposer, même si un sujet du jour s'y prêterait bien à nouveau.
function formatRecentConceptsForPrompt(recentConcepts) {
  if (!Array.isArray(recentConcepts) || !recentConcepts.length) return "";
  const list = [...new Set(recentConcepts)].map((concept) => `- ${concept}`).join("\n");
  return [
    "",
    "=== CONCEPTS DÉJÀ UTILISÉS RÉCEMMENT — NE PAS LES CHOISIR À NOUVEAU ===",
    "Les concepts suivants ont déjà été utilisés dans cette rubrique au cours des 7 derniers jours. Même si l'un d'eux ferait un excellent écho à un sujet du jour, tu dois choisir un AUTRE concept — cherche un rapprochement différent plutôt que de répéter l'un de ces choix :",
    list
  ].join("\n");
}

function buildMecanismeSociologiquePrompt(topics, recentConcepts) {
  if (!Array.isArray(topics) || !topics.length) {
    throw new Error("buildMecanismeSociologiquePrompt: la liste de sujets ne peut pas être vide.");
  }

  return [
    "Tu es un rédacteur spécialisé en sociologie qui prépare la rubrique \"Mécanisme sociologique du jour\" du site Agôn.",
    "",
    "Voici jusqu'à 10 sujets d'actualité publiés aujourd'hui sur Agôn :",
    "",
    formatTopicsForPrompt(topics),
    formatRecentConceptsForPrompt(recentConcepts),
    "",
    "=== ÉTAPE 1 — Choisir les sujets qui s'y prêtent vraiment ===",
    "Pour CHAQUE sujet, mobilise activement et sérieusement tes connaissances sociologiques réelles avant de conclure quoi que ce soit — beaucoup de sujets qui semblent purement factuels ont en réalité un mécanisme sociologique solide derrière eux (ex. un fait divers qui déclenche une vague d'indignation médiatique → le bouc émissaire chez René Girard ou la panique morale chez Stanley Cohen ; des inégalités scolaires persistantes → la reproduction sociale chez Pierre Bourdieu ; une rumeur qui se propage en ligne → la construction sociale de la déviance). Ne t'arrête pas à la première impression : cherche vraiment, sur chaque sujet.",
    "Puis évalue chaque piste trouvée selon ces critères :",
    "- intérêt sociologique du sujet ;",
    "- existence d'un concept ou d'un mécanisme réellement établi que tu connais avec une confiance raisonnable (pas une vague association d'idées, et pas un concept inventé) ;",
    "- précision du mécanisme réellement comparable entre le concept et l'actualité ;",
    "- utilité pédagogique du rapprochement pour un lecteur non spécialiste en sociologie ;",
    "- risque de rapprochement abusif, plaqué ou artificiel ;",
    "- test de spécificité : ce concept est-il vraiment le plus précis pour ce mécanisme, ou un autre concept tout aussi connu collerait-il presque aussi bien ? Si oui, c'est probablement un rapprochement trop générique. Exemple concret : une catastrophe naturelle largement médiatisée relève plus précisément de la \"société du risque\" (Ulrich Beck) que de la \"panique morale\" (Stanley Cohen), qui vise une réaction disproportionnée face à une déviance perçue, pas une catastrophe elle-même.",
    "",
    "Un sujet ne suffit PAS à justifier un mécanisme simplement parce qu'il évoque vaguement un fait social (\"la société\", \"les inégalités\", \"les médias\") : il faut un concept précis, nommé, dont le mécanisme éclaire vraiment ce qui se joue dans l'actualité — pas une association superficielle de vocabulaire.",
    "",
    `=== IMPORTANT — UN SEUL mécanisme, le plus pertinent ===`,
    "Choisis un seul sujet parmi ceux fournis : celui pour lequel le rapprochement sociologique est le plus solide et le plus précis, d'après les critères ci-dessus (en particulier le test de spécificité). Ne publie JAMAIS plusieurs mécanismes le même jour, même si plusieurs sujets te semblent s'y prêter — s'il y a plusieurs bons candidats, tranche et ne retiens que le meilleur.",
    "\"insufficient\" doit rester rare : ne l'utilise que si, après avoir vraiment cherché sur chacun des sujets, aucun ne présente de concept que tu connais avec confiance — pas par défaut ou par prudence excessive.",
    "",
    "=== ÉTAPE 2 — Produire le mécanisme retenu ===",
    "Pour le sujet retenu, rédige un mécanisme contenant : un résumé très bref de l'actualité, le nom du concept sociologique, le sociologue ou courant/école qui lui est associé, le contexte ou l'époque d'apparition du concept, une explication claire du concept, ce qui dans l'actualité y fait écho, la limite de l'analogie, une conclusion prudente, et les sources disponibles.",
    "Le texte principal (explication du concept + ce qui fait écho + limite de l'analogie + conclusion) doit faire environ 80 à 120 mots, hors sources.",
    "",
    "=== RÈGLES ÉDITORIALES OBLIGATOIRES ===",
    "- N'invente aucun concept, aucune citation, aucun auteur. Si tu n'es pas certain d'un fait précis (date, attribution exacte), n'écris pas de sources plutôt que d'en inventer une.",
    "- RÈGLE URL (stricte) : tu n'as accès à aucune recherche documentaire réelle. Le champ \"url\" de chaque source doit valoir null, SAUF s'il s'agit d'une des URL listées explicitement ci-dessus pour l'actu concernée (recopiée exactement telle quelle). N'invente jamais une URL vers un livre, une encyclopédie, un article ou un site — même une URL qui te semble plausible. Une url inventée sera automatiquement rejetée.",
    "- Pour le titre, l'auteur, l'éditeur/organisme et l'année de chaque source : ne les indique que si tu es raisonnablement sûr du fait. Une référence incertaine doit être omise du tableau \"sources\" plutôt que devinée.",
    "- Évite toute analogie avec le nazisme, les génocides ou les crimes de masse, sauf si le sujet d'actualité lui-même porte explicitement sur ce thème.",
    "- La conclusion doit préciser clairement les limites du rapprochement, pas seulement ce qui rend le concept pertinent.",
    "- Reste compréhensible pour un lecteur non spécialiste en sociologie — évite le jargon non expliqué.",
    "- Ton sobre, informatif, non sensationnaliste — pas de dramatisation, pas de point d'exclamation.",
    "",
    RESPONSE_SCHEMA_HINT
  ].join("\n");
}

module.exports = { buildMecanismeSociologiquePrompt, MAX_MECANISMES_HINT };
