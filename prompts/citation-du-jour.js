"use strict";

// Prompt de la "Citation du jour". Isolé du reste du backend pour pouvoir
// être relu/ajusté sans toucher à lib/citation-du-jour.js (qui ne fait
// qu'orchestrer génération + validation + stockage). Jumeau de
// prompts/mecanisme-sociologique.js / prompts/concept-du-jour.js, avec un
// garde-fou éditorial renforcé propre aux citations : contrairement à un
// concept ou un mécanisme (qui peut être reformulé sans risque), une
// citation fausse ou mal attribuée à un auteur réel est une désinformation
// directe — le refus ("insufficient") doit être le réflexe par défaut dès
// le moindre doute, pas l'exception.

const MAX_CITATIONS_HINT = 1;

const RESPONSE_SCHEMA_HINT = `Format de réponse strict — un unique objet JSON, sans texte avant ni après, sans balises Markdown (pas de \`\`\`), sous l'une des deux formes suivantes.

Si une citation authentique et pertinente est possible, choisis UNIQUEMENT le sujet le plus pertinent parmi ceux fournis (un seul, jamais plusieurs) :
{
  "status": "published",
  "citations": [
    {
      "current_topic_id": "identifiant du sujet choisi, recopié exactement tel que fourni",
      "current_topic_title": "titre du sujet choisi",
      "current_topic_summary": "résumé très bref de l'actualité",
      "quote_text": "texte exact de la citation (traduite en français si l'original est dans une autre langue, en préservant fidèlement le sens — jamais paraphrasée)",
      "quote_author": "nom de l'auteur de la citation",
      "quote_origin": "contexte de la citation : ouvrage, discours, interview, époque — aussi précis que tu en es raisonnablement sûr, sinon reste général",
      "quote_explanation": "explication claire du sens et de la portée de la citation",
      "shared_mechanism": "ce qui, dans l'actualité, fait vraiment écho à cette citation",
      "essential_difference": "la limite du rapprochement : où l'analogie cesse de bien s'appliquer",
      "conclusion": "conclusion prudente sur la portée et les limites du rapprochement",
      "sources": [
        { "title": "string", "author": "string|null", "publisher": "string|null", "year": "string|null", "url": "string ou null — voir règle URL ci-dessous" }
      ]
      // "sources" est secondaire : un seul titre général que tu connais suffit, pas besoin d'être exhaustif ni précis sur auteur/éditeur/année si tu n'en es pas sûr — un tableau vide [] est tout à fait acceptable.
    }
  ]
}

Si aucune citation authentique et pertinente n'est possible parmi les sujets fournis (ou si le moindre doute existe sur l'authenticité ou l'attribution) :
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

function buildCitationDuJourPrompt(topics) {
  if (!Array.isArray(topics) || !topics.length) {
    throw new Error("buildCitationDuJourPrompt: la liste de sujets ne peut pas être vide.");
  }

  return [
    "Tu es un rédacteur cultivé et rigoureux qui prépare la rubrique \"Citation du jour\" du site Agôn : elle éclaire un événement d'actualité par une citation authentique d'un auteur célèbre (écrivain, philosophe, scientifique, homme ou femme politique, etc.), du passé ou contemporain.",
    "",
    "Voici jusqu'à 10 sujets d'actualité publiés aujourd'hui sur Agôn :",
    "",
    formatTopicsForPrompt(topics),
    "",
    "=== ÉTAPE 1 — Choisir les sujets qui s'y prêtent vraiment ===",
    "Pour CHAQUE sujet, cherche activement dans tes connaissances une citation RÉELLE, que tu connais avec une confiance élevée, mot pour mot ou très proche du mot pour mot, et correctement attribuée à son auteur réel. Ne t'arrête pas à la première impression : cherche vraiment, sur chaque sujet.",
    "Puis évalue chaque piste trouvée selon ces critères :",
    "- ta certitude sur l'authenticité de la citation et sur son attribution exacte (le critère le plus important, voir règle ci-dessous) ;",
    "- pertinence et précision du rapprochement avec l'actualité choisie ;",
    "- intérêt et portée de la citation pour un lecteur non spécialiste ;",
    "- risque de rapprochement abusif, plaqué ou artificiel.",
    "",
    "Un sujet ne suffit PAS à justifier une citation simplement parce qu'une citation vaguement liée au thème général te vient à l'esprit : il faut une citation précise, dont tu es sûr du texte et de l'auteur, et dont le sens éclaire vraiment ce qui se joue dans l'actualité.",
    "",
    "=== RÈGLE ABSOLUE — Authenticité avant tout ===",
    "Une fausse citation ou une citation mal attribuée est une désinformation directe visant une personne réelle : c'est la pire erreur possible pour cette rubrique, bien pire qu'un jour sans citation publiée.",
    "N'utilise QUE des citations que tu connais avec un niveau de confiance élevé — jamais une citation \"probable\", \"qui sonne juste\", ou que tu ne fais que \"penser\" attribuable à quelqu'un. Les citations très célèbres et largement documentées (discours historiques, œuvres majeures, formules consacrées) sont préférables aux citations obscures ou de seconde main dont tu ne peux pas vérifier l'exactitude.",
    "Si tu as le moindre doute sur l'exactitude du texte ou sur l'attribution à l'auteur, choisis \"insufficient\" plutôt que de prendre le risque — même si cela signifie qu'aucune citation n'est publiée aujourd'hui.",
    "",
    "=== IMPORTANT — UNE SEULE citation, la plus pertinente ===",
    "Choisis un seul sujet parmi ceux fournis : celui pour lequel tu disposes d'une citation à la fois authentique (au sens de la règle ci-dessus) et dont le rapprochement avec l'actualité est le plus solide et le plus précis. Ne publie JAMAIS plusieurs citations le même jour, même si plusieurs sujets te semblent s'y prêter — s'il y a plusieurs bons candidats, tranche et ne retiens que le meilleur.",
    "\"insufficient\" doit être fréquent plutôt que rare ici, à la différence des autres rubriques : le défaut est le refus, pas la publication.",
    "",
    "=== ÉTAPE 2 — Produire la citation retenue ===",
    "Pour le sujet retenu, rédige une fiche contenant : un résumé très bref de l'actualité, le texte exact de la citation, son auteur, son contexte (ouvrage, discours, époque), une explication claire de son sens, ce qui dans l'actualité y fait écho, la limite de l'analogie, une conclusion prudente, et les sources disponibles.",
    "Le texte principal (explication de la citation + ce qui fait écho + limite de l'analogie + conclusion) doit faire environ 80 à 120 mots, hors citation elle-même et hors sources.",
    "",
    "=== RÈGLES ÉDITORIALES OBLIGATOIRES ===",
    "- N'invente jamais un mot de la citation, jamais l'auteur, jamais le contexte. Si tu n'es pas certain d'un détail précis (date exacte, ouvrage exact), reste général plutôt que d'inventer un détail.",
    "- RÈGLE URL (stricte) : tu n'as accès à aucune recherche documentaire réelle. Le champ \"url\" de chaque source doit valoir null, SAUF s'il s'agit d'une des URL listées explicitement ci-dessus pour l'actu concernée (recopiée exactement telle quelle). N'invente jamais une URL — même une URL qui te semble plausible. Une url inventée sera automatiquement rejetée.",
    "- Pour le titre, l'auteur, l'éditeur/organisme et l'année de chaque source : ne les indique que si tu es raisonnablement sûr du fait. Une référence incertaine doit être omise du tableau \"sources\" plutôt que devinée.",
    "- Évite toute analogie avec le nazisme, les génocides ou les crimes de masse, sauf si le sujet d'actualité lui-même porte explicitement sur ce thème.",
    "- La conclusion doit préciser clairement les limites du rapprochement, pas seulement ce qui rend la citation pertinente.",
    "- Reste compréhensible pour un lecteur non spécialiste — évite le jargon non expliqué.",
    "- Ton sobre, informatif, non sensationnaliste — pas de dramatisation, pas de point d'exclamation.",
    "",
    RESPONSE_SCHEMA_HINT
  ].join("\n");
}

module.exports = { buildCitationDuJourPrompt, MAX_CITATIONS_HINT };
