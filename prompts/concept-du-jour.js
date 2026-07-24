"use strict";

// Prompt du "Concept du jour". Isolé du reste du backend pour pouvoir être
// relu/ajusté sans toucher à lib/concept-du-jour.js (qui ne fait
// qu'orchestrer génération + validation + stockage). Jumeau de
// prompts/mecanisme-sociologique.js, adapté à un principe plus large :
// n'importe quel concept transversal et rigoureux (psychologie, sociologie,
// rhétorique, économie, science politique, philosophie, sciences) plutôt
// qu'un seul domaine sociologique.

const MAX_CONCEPTS_HINT = 1;

const DOMAIN_EXAMPLES = [
  [
    "psychologie",
    "🧠 Psychologie",
    ["Biais cognitifs", "Effet témoin", "Dissonance cognitive", "Réactance psychologique", "Illusion de contrôle", "Effet de simple exposition"]
  ],
  [
    "sociologie",
    "👥 Sociologie",
    ["Panique morale", "Bouc émissaire", "Spirale du silence", "Fenêtre d'Overton", "Capital social", "Conformisme", "Identité sociale", "Chambre d'écho"]
  ],
  [
    "rhetorique",
    "⚖️ Rhétorique et argumentation",
    ["Homme de paille", "Faux dilemme", "Appel à l'émotion", "Pente glissante", "Whataboutism", "Cherry picking", "Argument d'autorité", "Généralisation hâtive"]
  ],
  [
    "economie",
    "📈 Économie",
    ["Tragédie des communs", "Externalités", "Incitations", "Risque moral", "Coût irrécupérable", "Coût d'opportunité", "Biens publics"]
  ],
  [
    "science_politique",
    "🏛 Science politique",
    ["Capture réglementaire", "Séparation des pouvoirs", "État de droit", "Populisme", "Clientélisme", "Soft power", "Hard power"]
  ],
  [
    "philosophie",
    "📚 Philosophie",
    ["Contrat social", "Principe de précaution", "Utilitarisme", "Déontologie", "Vertu", "Tolérance", "Responsabilité"]
  ],
  [
    "sciences",
    "🔬 Sciences",
    ["Corrélation ≠ causalité", "Incertitude", "Consensus scientifique", "Effet rebond", "Risque relatif / risque absolu"]
  ]
];

const DOMAIN_SLUGS = DOMAIN_EXAMPLES.map(([slug]) => slug);
const DOMAIN_LABELS = {
  psychologie: "Psychologie",
  sociologie: "Sociologie",
  rhetorique: "Rhétorique et argumentation",
  economie: "Économie",
  science_politique: "Science politique",
  philosophie: "Philosophie",
  sciences: "Sciences"
};

function formatDomainExamples() {
  return DOMAIN_EXAMPLES
    .map(([slug, label, examples]) => `- "${slug}" (${label}) — exemples : ${examples.join(", ")}`)
    .join("\n");
}

const RESPONSE_SCHEMA_HINT = `Format de réponse strict — un unique objet JSON, sans texte avant ni après, sans balises Markdown (pas de \`\`\`), sous l'une des deux formes suivantes.

Si un concept sérieux est possible, choisis UNIQUEMENT le sujet le plus pertinent parmi ceux fournis (un seul, jamais plusieurs) :
{
  "status": "published",
  "concepts": [
    {
      "current_topic_id": "identifiant du sujet choisi, recopié exactement tel que fourni",
      "current_topic_title": "titre du sujet choisi",
      "current_topic_summary": "résumé très bref de l'actualité",
      "concept_domain": "un des slugs suivants exactement : ${DOMAIN_SLUGS.map((s) => `\\"${s}\\"`).join(", ")}",
      "concept_name": "nom du concept",
      "concept_originator": "penseur, chercheur, école de pensée ou tradition associée au concept (peut être un courant ou une tradition plutôt qu'une seule personne si c'est plus exact, ex: \\"l'école autrichienne\\", \\"la rhétorique classique\\")",
      "concept_origin": "contexte ou époque d'apparition du concept",
      "concept_explanation": "explication claire et accessible du concept",
      "shared_mechanism": "ce qui, dans l'actualité, fait vraiment écho au concept",
      "essential_difference": "la limite de l'analogie : où le concept cesse de bien s'appliquer",
      "conclusion": "conclusion prudente sur la portée et les limites du rapprochement",
      "sources": [
        { "title": "string", "author": "string|null", "publisher": "string|null", "year": "string|null", "url": "string ou null — voir règle URL ci-dessous" }
      ]
      // "sources" est secondaire : un seul titre général que tu connais suffit, pas besoin d'être exhaustif ni précis sur auteur/éditeur/année si tu n'en es pas sûr — un tableau vide [] est tout à fait acceptable et ne doit jamais te faire hésiter à inclure ce concept si le rapprochement lui-même est solide.
    }
  ]
}

Si aucun rapprochement conceptuel sérieux n'est possible parmi les sujets fournis :
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

function buildConceptDuJourPrompt(topics) {
  if (!Array.isArray(topics) || !topics.length) {
    throw new Error("buildConceptDuJourPrompt: la liste de sujets ne peut pas être vide.");
  }

  return [
    "Tu es un rédacteur généraliste, rigoureux et cultivé, qui prépare la rubrique \"Concept du jour\" du site Agôn : elle éclaire un événement d'actualité par un concept transversal solide, tiré de la psychologie, de la sociologie, de la rhétorique/argumentation, de l'économie, de la science politique, de la philosophie ou des sciences.",
    "",
    "Voici jusqu'à 10 sujets d'actualité publiés aujourd'hui sur Agôn :",
    "",
    formatTopicsForPrompt(topics),
    "",
    "=== Domaines possibles (7), avec des exemples de concepts — LISTE NON EXHAUSTIVE ===",
    formatDomainExamples(),
    "",
    "Ces exemples ne sont que des illustrations pour cadrer le niveau d'exigence attendu : tu peux tout à fait choisir un autre concept sérieux et bien établi, dans n'importe lequel de ces 7 domaines, s'il éclaire mieux le sujet retenu — tu n'es pas limité à cette liste.",
    "",
    "=== ÉTAPE 1 — Choisir les sujets qui s'y prêtent vraiment ===",
    "Pour CHAQUE sujet, mobilise activement et sérieusement tes connaissances réelles dans ces 7 domaines avant de conclure quoi que ce soit — beaucoup de sujets qui semblent purement factuels ont en réalité un concept solide derrière eux (ex. une décision publique contestée par ceux-là mêmes qui l'appliquent → le risque moral en économie ; un débat qui se polarise en ligne → la chambre d'écho ou la spirale du silence ; une annonce présentée comme un choix entre deux seules options → le faux dilemme en rhétorique). Ne t'arrête pas à la première impression : cherche vraiment, sur chaque sujet, dans plusieurs domaines si besoin.",
    "Puis évalue chaque piste trouvée selon ces critères :",
    "- intérêt du rapprochement pour un lecteur non spécialiste ;",
    "- existence d'un concept réellement établi que tu connais avec une confiance raisonnable (pas une vague association d'idées, et pas un concept inventé) ;",
    "- précision du mécanisme réellement comparable entre le concept et l'actualité ;",
    "- risque de rapprochement abusif, plaqué ou artificiel ;",
    "- test de spécificité : ce concept est-il vraiment le plus précis pour ce mécanisme, ou un autre concept tout aussi connu collerait-il presque aussi bien ? Si oui, c'est probablement un rapprochement trop générique.",
    "",
    "Un sujet ne suffit PAS à justifier un concept simplement parce qu'il évoque vaguement une idée générale (\"la politique\", \"l'économie\", \"les médias\") : il faut un concept précis, nommé, dont le mécanisme éclaire vraiment ce qui se joue dans l'actualité — pas une association superficielle de vocabulaire.",
    "",
    "=== IMPORTANT — UN SEUL concept, le plus pertinent ===",
    "Choisis un seul sujet parmi ceux fournis : celui pour lequel le rapprochement conceptuel est le plus solide et le plus précis, d'après les critères ci-dessus (en particulier le test de spécificité). Ne publie JAMAIS plusieurs concepts le même jour, même si plusieurs sujets te semblent s'y prêter — s'il y a plusieurs bons candidats, tranche et ne retiens que le meilleur. Le domaine du concept retenu est libre (l'un des 7 ci-dessus) : ne cherche pas à faire tourner les domaines d'un jour à l'autre, choisis uniquement le meilleur rapprochement possible aujourd'hui.",
    "\"insufficient\" doit rester rare : ne l'utilise que si, après avoir vraiment cherché sur chacun des sujets et dans plusieurs domaines, aucun ne présente de concept que tu connais avec confiance — pas par défaut ou par prudence excessive.",
    "",
    "=== ÉTAPE 2 — Produire le concept retenu ===",
    "Pour le sujet retenu, rédige une fiche contenant : un résumé très bref de l'actualité, le domaine du concept (un des 7 slugs), le nom du concept, le penseur/chercheur/courant qui lui est associé, le contexte ou l'époque d'apparition du concept, une explication claire du concept, ce qui dans l'actualité y fait écho, la limite de l'analogie, une conclusion prudente, et les sources disponibles.",
    "Le texte principal (explication du concept + ce qui fait écho + limite de l'analogie + conclusion) doit faire environ 80 à 120 mots, hors sources.",
    "",
    "=== RÈGLES ÉDITORIALES OBLIGATOIRES ===",
    "- N'invente aucun concept, aucune citation, aucun auteur. Si tu n'es pas certain d'un fait précis (date, attribution exacte), n'écris pas de sources plutôt que d'en inventer une.",
    "- RÈGLE URL (stricte) : tu n'as accès à aucune recherche documentaire réelle. Le champ \"url\" de chaque source doit valoir null, SAUF s'il s'agit d'une des URL listées explicitement ci-dessus pour l'actu concernée (recopiée exactement telle quelle). N'invente jamais une URL vers un livre, une encyclopédie, un article ou un site — même une URL qui te semble plausible. Une url inventée sera automatiquement rejetée.",
    "- Pour le titre, l'auteur, l'éditeur/organisme et l'année de chaque source : ne les indique que si tu es raisonnablement sûr du fait. Une référence incertaine doit être omise du tableau \"sources\" plutôt que devinée.",
    "- Évite toute analogie avec le nazisme, les génocides ou les crimes de masse, sauf si le sujet d'actualité lui-même porte explicitement sur ce thème.",
    "- La conclusion doit préciser clairement les limites du rapprochement, pas seulement ce qui rend le concept pertinent.",
    "- Reste compréhensible pour un lecteur non spécialiste — évite le jargon non expliqué.",
    "- Ton sobre, informatif, non sensationnaliste — pas de dramatisation, pas de point d'exclamation.",
    "",
    RESPONSE_SCHEMA_HINT
  ].join("\n");
}

module.exports = { buildConceptDuJourPrompt, MAX_CONCEPTS_HINT, DOMAIN_SLUGS, DOMAIN_LABELS };
