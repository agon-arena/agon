"use strict";

// Corpus de test + grille d'évaluation manuelle pour scripts/test-photo-knowledge.js.
// Ne fait AUCUN appel réseau et ne modifie EN RIEN la logique de sélection du
// script principal (ce fichier ne l'importe même pas) — un simple aide-mémoire
// pour lancer les tests réels un par un, une fois le crédit OpenAI disponible,
// et remplir le rapport à la main. Fichier autonome, supprimable sans impact.
//
// Usage :
//   node scripts/test-photo-knowledge.corpus.js
//     → liste les cas du corpus + rappelle la grille d'évaluation complète.
//   node scripts/test-photo-knowledge.corpus.js <id-du-cas>
//     → affiche le détail d'un cas précis + un gabarit de résultat vierge
//       (ligne de tableau + détail par connaissance) à remplir après avoir
//       lancé le vrai test avec scripts/test-photo-knowledge.js.

// Corpus volontairement sans "vérité absolue" (cf. demande) : `expectedKnowledge`
// et `mustReject` sont des repères humains de calibration, pas une liste
// exhaustive à cocher automatiquement. `imagePath: null` = aucune image adaptée
// trouvée dans le dépôt pour cette catégorie — à fournir avant de lancer ce cas.
const CORPUS = [
  {
    id: "cours-dense",
    type: "Cours scolaire dense",
    imagePath: null,
    description: "Page de cours avec plusieurs notions (définitions, dates, mécanismes).",
    expectedCount: "plusieurs (ex. 6 à 15 selon densité réelle)",
    expectedKnowledge: [],
    mustReject: [
      "reformulation de chaque phrase en carte isolée",
      "répétitions d'une même notion sous plusieurs formulations"
    ],
    notes: "Cas prioritaire pour vérifier qu'une sélection 'exigeante' ne dérive pas vers 'presque vide' sur un contenu réellement dense. Aucune image adaptée dans le dépôt : fournir une vraie photo de cours avant de lancer ce cas."
  },
  {
    id: "manuel",
    type: "Page de manuel",
    imagePath: null,
    description: "Page de manuel scolaire ou universitaire (texte imprimé structuré).",
    expectedCount: "quelques-unes à plusieurs selon la densité réelle de la page",
    expectedKnowledge: [],
    mustReject: [
      "exercices ou consignes pédagogiques traités comme des connaissances",
      "légendes d'illustration sans contenu factuel propre"
    ],
    notes: "Aucune image adaptée dans le dépôt : fournir une vraie photo de manuel avant de lancer ce cas."
  },
  {
    id: "bd-fiction",
    type: "BD / contenu narratif",
    imagePath: "/Users/kevinbruyat/Downloads/WhatsApp Image 2026-08-21 at 17.37.37.jpeg",
    description: "Page de bande dessinée jeunesse (dialogue autour d'un aspirateur ancien détourné en 'recrache-miettes').",
    expectedCount: "0 (jusqu'à 1 si un élément est jugé réellement autonome — déjà discutable)",
    expectedKnowledge: [],
    mustReject: [
      "« Les appareils antiménagers sont des objets du quotidien. » — généralisation observée lors d'un test précédent (rapports A.4/A.5)",
      "« Cet aspirateur souffle d'énormes nuages de poussière. » présentée comme un fait général",
      "toute reformulation généralisant un objet ou une scène de fiction"
    ],
    notes: "Cas de référence pour la règle anti-généralisation du prompt : responsable d'une régression déjà corrigée. Bon marqueur de non-régression."
  },
  {
    id: "manuscrit-crepes",
    type: "Texte manuscrit",
    imagePath: "/Users/kevinbruyat/Downloads/WhatsApp Image 2026-08-21 at 17.39.17.jpeg",
    description: "Rédaction manuscrite d'élève sur la préparation de crêpes pour un carnaval, à partir d'une consigne imprimée.",
    expectedCount: "0 (aucune connaissance à portée générale identifiée dans ce texte)",
    expectedKnowledge: [],
    mustReject: [
      "« La classe a préparé des crêpes pour le carnaval. » retenue comme connaissance générale",
      "« Les crêpes sont traditionnellement préparées lors des carnavals. » (généralisation)",
      "toute connaissance produite si le texte est mal orienté (cf. note ci-dessous, pas un vrai résultat de sélection)"
    ],
    notes: "ATTENTION ORIENTATION : ce fichier n'a pas de métadonnée EXIF (confirmé lors d'un test précédent) — sharp().rotate() ne le redresse pas. Vérifier visuellement l'image avant le test ; si le texte apparaît pivoté, pré-pivoter manuellement le fichier avant de le passer au script, sans quoi ce cas teste surtout l'abstention du filtre 1 (lecture), pas le filtre 2 (sélection)."
  },
  {
    id: "actualite-capture",
    type: "Capture d'actualité",
    imagePath: "screenshot-alaune.png",
    description: "Capture d'écran de la page d'accueil (4 cartes d'actualité titrées + chapô, plus éléments d'interface).",
    expectedCount: "0 à 4, selon l'exigence réellement appliquée sur la valeur durable d'une actualité éphémère",
    expectedKnowledge: [
      "Incendie en Gironde entraînant des évacuations",
      "Inscription de sites du Débarquement/Languedoc au patrimoine mondial Unesco",
      "Attentat à la Gay Pride de Berlin",
      "Tour de France 2026, dernière étape"
    ],
    mustReject: [
      "éléments d'interface (boutons, badges 'IA : ...', 'Nouveau', 'Voir plus', 'Entrer dans l'arène')",
      "cartes partiellement visibles/coupées de la section du bas de l'écran",
      "généralisations du type « les incendies peuvent provoquer d'importants dégâts »"
    ],
    notes: "Cas volontairement ambigu : sert à vérifier si le filtre 'valeur de mémorisation' discrimine vraiment l'éphémère, ou se contente du grounding. Ne pas considérer 4/4 comme automatiquement un bon résultat — évaluer chaque item individuellement plutôt que le compte global."
  },
  {
    id: "document-pauvre",
    type: "Document pauvre en connaissances mémorisables",
    imagePath: "public/images/historical-events/08-09-world-1945-nagasaki.jpg",
    description: "Photographie historique sans texte lisible (cas extrême : absence totale de texte, pas seulement un contenu trivial).",
    expectedCount: "0",
    expectedKnowledge: [],
    mustReject: [
      "toute connaissance inventée à partir du sujet supposé de la photo (le modèle ne voit pas le nom du fichier)"
    ],
    notes: "Déjà testé avec une version antérieure du prompt : knowledge: [] obtenu. Sert surtout de garde-fou de non-régression plutôt que de vrai test de sélection fine — un cas 'texte présent mais trivial' resterait à ajouter séparément si une photo appropriée est fournie."
  }
];

// ── Grille d'évaluation manuelle (remplie à la main après chaque appel réel, jamais calculée automatiquement) ──
const CRITERIA = [
  {
    key: "grounding", label: "Grounding exact",
    question: "Cette connaissance est-elle explicitement soutenue par le document ?",
    scale: { 2: "clairement et directement présente", 1: "présente mais reformulation légèrement discutable", 0: "ajout, extrapolation ou généralisation absente du document (problème sérieux)" }
  },
  {
    key: "autonomie", label: "Autonomie",
    question: "La connaissance peut-elle être comprise et mémorisée sans relire tout le document ?",
    scale: { 2: "parfaitement autonome", 1: "compréhensible mais dépend encore légèrement du contexte", 0: "trop contextuelle ou ambiguë" }
  },
  {
    key: "valeur", label: "Valeur de mémorisation",
    question: "Est-ce réellement une information qui mérite d'être mémorisée ?",
    scale: { 2: "clairement pertinente à retenir", 1: "acceptable mais secondaire", 0: "anecdotique, décorative, triviale ou sans intérêt durable" }
  },
  {
    key: "fidelite", label: "Fidélité de formulation",
    question: "La reformulation conserve-t-elle exactement le sens du document sans enrichissement artificiel ?",
    scale: { 2: "fidèle", 1: "légère reformulation discutable mais sans changement important", 0: "généralisation, causalité, relation, propriété ou catégorie ajoutée" }
  }
];

const CRITICAL_ERROR_LABELS = [
  "HALLUCINATION", "GENERALISATION", "INFERENCE_NON_EXPLICITE",
  "ANECDOTE", "DOUBLON", "TROP_CONTEXTUEL", "CONNAISSANCE_IMPORTANTE_OMISE"
];

// Verdict global par document (pas par connaissance) — logique volontairement
// conservatrice (cf. demande) : un défaut de grounding pèse plus lourd qu'un
// défaut de couverture.
const VERDICT_RULES = [
  { verdict: "PASS", description: "Aucune hallucination, aucune généralisation importante, sélection globalement pertinente, nombre de connaissances raisonnable (ni sur-découpage, ni remplissage artificiel vers 20)." },
  { verdict: "À RECALIBRER", description: "Sélection globalement bonne, quelques connaissances trop faibles ou quelques omissions, mais aucun défaut majeur de grounding." },
  { verdict: "FAIL", description: "Hallucination, généralisation importante, nombreuses connaissances anecdotiques, incapacité manifeste à dire non (jamais []), ou sélection trop éloignée du document." }
];

function printCriteria() {
  console.log("=== Grille d'évaluation (4 critères, 0 à 2 chacun, par connaissance) ===\n");
  for (const c of CRITERIA) {
    console.log(`${c.label} — ${c.question}`);
    for (const score of [2, 1, 0]) console.log(`  ${score} = ${c.scale[score]}`);
    console.log("");
  }
  console.log(`Erreurs critiques (cumulables par connaissance) : ${CRITICAL_ERROR_LABELS.join(", ")}\n`);
  console.log("Verdict global par document :");
  for (const v of VERDICT_RULES) console.log(`  ${v.verdict} — ${v.description}`);
}

function printResultTemplate(testCase) {
  console.log(`\n=== Gabarit de résultat — ${testCase.id} (${testCase.type}) ===`);
  console.log(`Commande : node scripts/test-photo-knowledge.js "${testCase.imagePath || "<chemin de l'image — aucune fournie pour ce cas>"}"`);
  console.log(`Attendu (repère humain, pas une vérité absolue) : ${testCase.expectedCount}`);
  if (testCase.expectedKnowledge.length) console.log(`Connaissances espérées : ${testCase.expectedKnowledge.join(" | ")}`);
  if (testCase.mustReject.length) console.log(`À rejeter impérativement : ${testCase.mustReject.join(" | ")}`);
  if (testCase.notes) console.log(`Notes : ${testCase.notes}`);

  console.log("\nLigne à ajouter au tableau de résultats :");
  console.log(`| ${testCase.id} | # sélectionnées : ___ | Grounding : ___ | Autonomie : ___ | Valeur : ___ | Fidélité : ___ | Erreurs critiques : ___ | Verdict : ___ |`);

  console.log("\nDétail par connaissance (dupliquer ce bloc pour chaque connaissance retournée) :");
  console.log("- connaissance : \"...\"");
  console.log("  evidence : \"...\"");
  console.log("  grounding : __/2   autonomie : __/2   valeur : __/2   fidélité : __/2");
  console.log("  erreurs critiques : []");
  console.log("  commentaire : \"\"");
}

function main() {
  const requestedId = process.argv[2];
  if (!requestedId) {
    console.log(`Corpus de test (${CORPUS.length} cas) :\n`);
    for (const c of CORPUS) {
      console.log(`- ${c.id} [${c.type}] : ${c.imagePath || "AUCUNE IMAGE — à fournir"}`);
    }
    console.log("\nUsage : node scripts/test-photo-knowledge.corpus.js <id-du-cas>  (détail du cas + gabarit de résultat)\n");
    printCriteria();
    return;
  }
  const testCase = CORPUS.find((c) => c.id === requestedId);
  if (!testCase) {
    console.error(`Cas inconnu : "${requestedId}". Cas disponibles : ${CORPUS.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }
  printResultTemplate(testCase);
}

main();

module.exports = { CORPUS, CRITERIA, CRITICAL_ERROR_LABELS, VERDICT_RULES };
