"use strict";

// Scoring contextuel des sources web pour le grounding (demande du 31/08/2026,
// "Fiabilisation intelligente des sources Brave"). Un résultat bien classé
// par Brave n'est pas nécessairement une bonne source pédagogique/factuelle
// (cas réel observé : pour "Durée légale du travail en France", Brave classe
// un blog commercial SaaS (esperoo.fr) devant legifrance.gouv.fr) — ce
// module ré-ordonne les candidats selon la pertinence/autorité/spécialisation
// AVANT que l'IA de sélection (lib/web-search-grounding.js) ne tranche.
//
// Fichier volontairement PUR (aucun accès réseau, aucun appel IA) : toutes
// les fonctions ne dépendent que de leurs arguments, testables sans réseau
// (cf. test/source-scoring.test.js). AUCUN appel IA supplémentaire n'est
// introduit ici — le "topicContext" (registre d'autorités + heuristique de
// fraîcheur) est calculé par simple recoupement lexical déterministe, jamais
// par un modèle qui classifierait le sujet.
//
// Principe central (jamais violé) : le domaine seul ne suffit JAMAIS à
// décider — un domaine du registre ne reçoit son bonus d'autorité QUE si ses
// "tags" (son domaine de compétence) recoupent lexicalement le sujet
// demandé. Un site gouvernemental listé pour la santé ne reçoit donc aucun
// bonus d'autorité particulier sur un sujet d'astronomie.

// ── Normalisation / tokenisation (générique, jamais spécifique à un sujet) ──

const STOPWORDS = new Set([
  "le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "en", "au", "aux",
  "ce", "cette", "ces", "son", "sa", "ses", "leur", "leurs", "que", "qui", "quoi",
  "dans", "pour", "par", "sur", "sous", "avec", "sans", "vers", "chez", "entre",
  "est", "sont", "être", "avoir", "fait", "faire", "comment", "quel", "quelle",
  "quels", "quelles", "the", "and", "for", "with", "from", "this", "that", "are",
  "is", "of", "to", "in", "on", "a", "an"
]);

function stripDiacritics(str) {
  return String(str || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Mots significatifs ≥3 caractères, hors stopwords génériques — jamais une
// liste de mots-clés propre à un domaine (histoire/santé/droit...), juste un
// filtre linguistique générique réutilisable pour n'importe quel sujet.
function tokenize(text) {
  return stripDiacritics(String(text || ""))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

// Fraction des tokens de `needleTokens` retrouvés dans `haystackText` — mesure
// de recouvrement générique (jamais un classifieur de sujet). Toujours
// appelée avec les tokens du SUJET en `needleTokens` (jamais l'inverse) :
// mesure "quelle part du sujet est couverte par ce texte", que le haystack
// soit un titre/description (pertinence) ou la liste de tags d'une entrée du
// registre (recoupement d'autorité) — une entrée à beaucoup de tags ne doit
// jamais être artificiellement diluée simplement parce qu'elle en a plus
// qu'une autre.
function overlapFraction(needleTokens, haystackText) {
  if (!needleTokens.length) return 0;
  const haystackTokens = new Set(tokenize(haystackText));
  const matched = needleTokens.filter((t) => haystackTokens.has(t)).length;
  return matched / needleTokens.length;
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

// ── Registre d'autorités : BONUS contextuel, jamais une whitelist (section 5
// de la demande). Chaque entrée est indexée par domaine mais son bonus ne
// s'applique QUE si `tags` recoupe lexicalement le sujet (cf. authorityScore
// plus bas) — un domaine du registre absent des résultats, ou présent mais
// hors-sujet, ne bloque ni n'avantage jamais rien. Volontairement un point de
// départ modeste, pas exhaustif : une excellente source absente d'ici reste
// scorable via les heuristiques structurelles génériques (TLD institutionnel,
// spécialisation, qualité éditoriale) — jamais réduite à zéro faute de figurer
// dans cette liste.
const AUTHORITY_REGISTRY = [
  { domain: "insee.fr", label: "INSEE", weight: 0.95, primary: true,
    tags: ["statistique", "statistiques", "demographie", "population", "recensement", "menage", "chomage", "inflation", "pib", "economie francaise", "natalite", "esperance de vie"] },
  { domain: "legifrance.gouv.fr", label: "Légifrance", weight: 0.95, primary: true,
    tags: ["loi", "lois", "code du travail", "code civil", "code penal", "decret", "ordonnance", "droit francais", "juridique", "legal", "article de loi", "constitution"] },
  { domain: "service-public.fr", label: "Service-Public.fr", weight: 0.85, primary: true,
    tags: ["demarche administrative", "droit francais", "administration francaise", "duree legale", "droit du travail", "service public", "reglementation"] },
  { domain: "service-public.gouv.fr", label: "Service-Public.fr", weight: 0.85, primary: true,
    tags: ["demarche administrative", "droit francais", "administration francaise", "duree legale", "droit du travail", "service public", "reglementation"] },
  { domain: "travail-emploi.gouv.fr", label: "Ministère du Travail", weight: 0.85, primary: true,
    tags: ["droit du travail", "duree legale", "duree du travail", "code du travail", "emploi", "salarie", "employeur", "convention collective"] },
  { domain: "code.travail.gouv.fr", label: "Code du travail numérique", weight: 0.85, primary: true,
    tags: ["droit du travail", "duree legale", "duree du travail", "code du travail", "emploi", "salarie", "employeur"] },
  { domain: "eur-lex.europa.eu", label: "EUR-Lex", weight: 0.9, primary: true,
    tags: ["directive europeenne", "reglement europeen", "droit europeen", "union europeenne", "traite", "legislation europeenne"] },
  { domain: "who.int", label: "OMS", weight: 0.9, primary: true,
    tags: ["sante", "maladie", "epidemie", "vaccination", "organisation mondiale de la sante", "hygiene", "prevention", "virus", "pandemie"] },
  { domain: "has-sante.fr", label: "HAS", weight: 0.85, primary: true,
    tags: ["recommandation medicale", "sante", "haute autorite de sante", "traitement", "soins", "medicament", "bonne pratique"] },
  { domain: "inserm.fr", label: "Inserm", weight: 0.85, primary: true,
    tags: ["recherche medicale", "biomedical", "maladie", "sante", "etude scientifique", "recherche biomedicale"] },
  { domain: "santepubliquefrance.fr", label: "Santé publique France", weight: 0.85, primary: true,
    tags: ["sante publique", "epidemiologie", "prevention", "hygiene", "maladie", "vaccination", "lavage des mains"] },
  { domain: "ameli.fr", label: "Assurance Maladie (Ameli)", weight: 0.8, primary: true,
    tags: ["sante", "maladie", "remboursement", "prevention", "hygiene", "soins", "medecin"] },
  { domain: "sante.fr", label: "Ministère de la Santé (sante.fr)", weight: 0.8, primary: true,
    tags: ["sante", "maladie", "prevention", "hygiene", "vaccination", "soins", "medecin", "lavage des mains"] },
  { domain: "nasa.gov", label: "NASA", weight: 0.9, primary: true,
    tags: ["espace", "astronomie", "mission spatiale", "planete", "fusee", "exploration spatiale", "mars", "systeme solaire", "atmosphere"] },
  { domain: "esa.int", label: "ESA", weight: 0.85, primary: true,
    tags: ["espace", "astronomie", "agence spatiale europeenne", "mission spatiale", "planete", "systeme solaire"] },
  { domain: "ipcc.ch", label: "GIEC / IPCC", weight: 0.9, primary: true,
    tags: ["climat", "rechauffement climatique", "giec", "changement climatique", "gaz a effet de serre"] },
  { domain: "meteofrance.fr", label: "Météo-France", weight: 0.75, primary: true,
    tags: ["meteo", "climat", "temperature", "precipitations", "phenomene meteorologique"] },
  { domain: "bnf.fr", label: "BnF", weight: 0.8, primary: true,
    tags: ["histoire", "patrimoine", "archives", "manuscrit", "bibliotheque", "document historique"] },
  { domain: "inrap.fr", label: "INRAP", weight: 0.8, primary: true,
    tags: ["archeologie", "fouille archeologique", "patrimoine archeologique", "site archeologique"] },
  { domain: "persee.fr", label: "Persée", weight: 0.75, primary: false,
    tags: ["recherche academique", "sciences humaines", "publication scientifique", "revue academique", "article scientifique", "historiographie", "histoire", "antiquite", "archeologie"] },
  { domain: "cairn.info", label: "Cairn.info", weight: 0.7, primary: false,
    tags: ["recherche academique", "sciences humaines", "revue academique", "publication scientifique", "histoire", "sociologie"] },
  { domain: "eurostat.ec.europa.eu", label: "Eurostat", weight: 0.85, primary: true,
    tags: ["statistique europeenne", "union europeenne", "demographie europeenne", "economie europeenne"] },
  { domain: "cnrs.fr", label: "CNRS", weight: 0.8, primary: false,
    tags: ["recherche scientifique", "science", "laboratoire de recherche", "decouverte scientifique"] },
  { domain: "louvre.fr", label: "Musée du Louvre", weight: 0.8, primary: true,
    tags: ["art", "peinture", "sculpture", "musee", "histoire de l'art", "oeuvre d'art"] },
  { domain: "musee-orsay.fr", label: "Musée d'Orsay", weight: 0.8, primary: true,
    tags: ["art", "peinture", "impressionnisme", "musee", "histoire de l'art", "oeuvre d'art", "xixe siecle"] },
  { domain: "grandpalais.fr", label: "Grand Palais", weight: 0.75, primary: true,
    tags: ["art", "peinture", "exposition", "musee", "histoire de l'art"] },
  { domain: "citedelarchitecture.fr", label: "Cité de l'architecture", weight: 0.7, primary: true,
    tags: ["architecture", "patrimoine", "musee", "urbanisme"] },

  // Ajouts "hiérarchie d'autorité des sources" (demande du 14/09/2026, cas
  // réel "constructivisme russe" — Wikipédia reprise telle quelle alors
  // qu'une source muséale majeure formulait la même information de façon
  // bien plus prudente). Mêmes principes que le registre existant ci-dessus
  // (bonus CONTEXTUEL, jamais une whitelist absolue — n'agit que si les tags
  // recoupent le sujet) : art/musées majeurs, organisations internationales,
  // santé publique, droit constitutionnel, archives/audiovisuel — catégories
  // explicitement citées par la demande, jamais limitées à cette liste (cf.
  // isInstitutionalDomain plus bas pour la reconnaissance générique
  // gouvernementale/internationale/muséale hors registre nommé, et
  // ACADEMIC_GENERIC_DOMAIN_PATTERN pour les domaines universitaires
  // génériques .edu/.ac.xx, niveau A par défaut depuis le 14/09/2026).
  { domain: "moma.org", label: "MoMA", weight: 0.85, primary: true,
    tags: ["art", "art moderne", "art contemporain", "peinture", "sculpture", "musee", "histoire de l'art"] },
  { domain: "metmuseum.org", label: "Metropolitan Museum of Art", weight: 0.85, primary: true,
    tags: ["art", "musee", "histoire de l'art", "peinture", "sculpture", "antiquite"] },
  { domain: "tate.org.uk", label: "Tate", weight: 0.85, primary: true,
    tags: ["art", "art moderne", "art contemporain", "peinture", "sculpture", "musee", "histoire de l'art"] },
  { domain: "centrepompidou.fr", label: "Centre Pompidou", weight: 0.8, primary: true,
    tags: ["art", "art moderne", "art contemporain", "peinture", "sculpture", "musee", "histoire de l'art"] },
  { domain: "archives-nationales.culture.gouv.fr", label: "Archives nationales", weight: 0.8, primary: true,
    tags: ["histoire", "archives", "patrimoine", "document historique"] },
  { domain: "ina.fr", label: "INA", weight: 0.75, primary: true,
    tags: ["audiovisuel", "television", "radio", "archives audiovisuelles", "cinema", "media"] },
  { domain: "un.org", label: "ONU", weight: 0.85, primary: true,
    tags: ["organisation internationale", "nations unies", "droit international", "diplomatie", "developpement"] },
  { domain: "worldbank.org", label: "Banque mondiale", weight: 0.85, primary: true,
    tags: ["economie", "developpement", "pauvrete", "statistique economique mondiale", "financement du developpement"] },
  { domain: "imf.org", label: "FMI", weight: 0.85, primary: true,
    tags: ["economie", "politique monetaire", "finance internationale", "crise economique", "balance des paiements"] },
  { domain: "oecd.org", label: "OCDE", weight: 0.85, primary: true,
    tags: ["economie", "statistique economique", "politique publique", "pays developpes", "comparaison internationale"] },
  { domain: "nih.gov", label: "NIH", weight: 0.85, primary: true,
    tags: ["sante", "recherche medicale", "biomedical", "institut national de la sante", "etude clinique"] },
  { domain: "cdc.gov", label: "CDC", weight: 0.85, primary: true,
    tags: ["sante publique", "epidemiologie", "maladie", "prevention", "vaccination"] },
  { domain: "conseil-constitutionnel.fr", label: "Conseil constitutionnel", weight: 0.85, primary: true,
    tags: ["droit constitutionnel", "constitution", "droit francais", "juridique", "controle de constitutionnalite"] }
];

// ── Hiérarchie d'autorité des sources (demande du 14/09/2026, ajustée le
// même jour — Larousse déplacé en B, domaines .edu/.ac.xx génériques
// déplacés en A par défaut, cf. ACADEMIC_GENERIC_DOMAIN_PATTERN plus bas) ──
// Réutilise le registre ci-dessus (niveau A+ curé) et le motif institutionnel
// générique plus bas (niveau A+ générique, désormais limité à
// gouvernemental/international/muséal) — deux niveaux supplémentaires,
// jamais gagnés par recoupement de tags car structurellement généralistes
// (une encyclopédie de référence ou Wikipédia n'a pas UN domaine de
// compétence, par construction) :
// - Niveau A : encyclopédies/références académiques ou spécialisées de tout
//   premier plan (Britannica, Universalis, Our World in Data — Stanford
//   Encyclopedia of Philosophy y arrive aussi, via le motif académique
//   générique .edu ci-dessous, jamais dégradée sous A) — bonus significatif,
//   toujours sous le plafond d'une autorité A+ confirmée. Larousse EXCLU
//   volontairement (ajustement du 14/09/2026) : dictionnaire/encyclopédie
//   grand public, moins spécialisé que les autres références de ce niveau —
//   retombe au niveau B par défaut (aucune entrée nécessaire, B est le repli
//   neutre).
// - Niveau C : Wikipédia et ses miroirs directs — reste une source valide et
//   souvent complémentaire précieuse (jamais supprimée, cf. sections 6/7 de
//   la demande), mais un bonus d'autorité volontairement modeste : c'est
//   précisément le problème diagnostiqué (une formulation catégorique
//   Wikipédia reprise telle quelle faute de hiérarchie entre les sources).
const LEVEL_A_REFERENCE_DOMAINS = new Set([
  "britannica.com", "universalis.fr", "ourworldindata.org"
]);
const LEVEL_C_ENCYCLOPEDIA_DOMAINS = new Set(["wikipedia.org", "wikiwand.com"]);

function domainInSet(domain, set) {
  if (!domain) return false;
  return set.has(domain) || [...set].some((d) => domain.endsWith(`.${d}`));
}

// Rétro-compatibilité : ancien nom (avant l'introduction des deux niveaux
// distincts A/C ci-dessus), désormais leur union — comportement de détection
// "source tertiaire générale" inchangé pour tout code qui s'appuierait encore
// dessus.
const TERTIARY_REFERENCE_DOMAINS = new Set([...LEVEL_A_REFERENCE_DOMAINS, ...LEVEL_C_ENCYCLOPEDIA_DOMAINS]);

// TLD/domaines à consonance institutionnelle générique — un signal faible
// mais réel même hors registre nommé (ex. travail-emploi.gouv.fr n'a pas
// forcément d'entrée dédiée mais reste structurellement institutionnel).
// N'inclut PLUS .edu/.ac.xx (ajustement du 14/09/2026) : un domaine
// universitaire générique n'est pas automatiquement A+ — cf.
// ACADEMIC_GENERIC_DOMAIN_PATTERN ci-dessous (niveau A par défaut). Un
// domaine .edu/.ac.xx précis ne redevient A+ que s'il figure explicitement
// dans AUTHORITY_REGISTRY (tags-gated) ou via l'autorité contextuelle
// inférée (inferContextualAuthority, plafonnée sous une autorité confirmée).
const INSTITUTIONAL_DOMAIN_PATTERN = /(^|\.)(gouv\.fr|gov|int|europa\.eu|museum)$/;

// Domaines universitaires génériques (ajustement du 14/09/2026) : niveau A
// par défaut, jamais A+ automatique — un simple TLD .edu/.ac.xx ne garantit
// pas la même autorité structurelle qu'un domaine gouvernemental/
// international/muséal (n'importe quel établissement peut en détenir un).
// Stanford Encyclopedia of Philosophy (plato.stanford.edu) reste ainsi au
// minimum A via ce motif, sans dépendre d'une entrée nommée.
const ACADEMIC_GENERIC_DOMAIN_PATTERN = /(^|\.)edu$|(^|\.)ac\.[a-z]{2}$/;

// Marqueurs linguistiques génériques de fraîcheur requise — jamais une
// catégorie de sujet, uniquement des tournures qui, dans N'IMPORTE QUEL
// sujet, indiquent qu'on interroge un état PRÉSENT plutôt qu'un fait stable
// (section 2, temporalité : "population française actuelle" doit être frais,
// "Alexandre le Grand" ne doit jamais être pénalisé pour son ancienneté).
const FRESHNESS_MARKER_PATTERN = /\b(actuel|actuelle|actuellement|aujourd|en ce moment|derni[eè]re?s?|recent|recente|maintenant|cette annee|ce mois)\b/i;

// Motifs de titre "putaclic" génériques (jamais un jugement sur UN site
// précis) — signal négatif faible, jamais disqualifiant à lui seul.
const CLICKBAIT_TITLE_PATTERN = /\b(vous ne (devinerez|croirez) jamais|incroyable|choquant|top\s?\d+|\d+\s+(choses|astuces|secrets))\b/i;

// ── Autorité contextuelle HORS registre (V2, demande du 31/08/2026) ────────
// Détecte qu'un domaine INCONNU du registre est probablement une institution
// directement compétente pour le sujet, SANS jamais devenir une nouvelle
// whitelist déguisée : jamais "domaine contient X → bonus", toujours PLUSIEURS
// signaux concordants (section 2 de la demande). Trois catégories de signal :
// (a) vocabulaire générique d'institution (musée, mémorial, archives...) —
//     un simple type d'organisation, jamais spécifique à un sujet ;
// (b) le NOM DE DOMAINE lui-même reprend un mot significatif du sujet (ex.
//     "memorial-verdun.fr" pour "La bataille de Verdun") — plus fort qu'un
//     simple recoupement dans le titre/description, car un domaine construit
//     autour du nom exact de l'entité suggère un site dédié ;
// (c) cohérence éditoriale : le titre/description recoupent fortement le
//     sujet (pas seulement le nom en passant).
// Un marqueur commercial/touristique (blog, boutique, tours, avis...) annule
// TOUT bonus, quel que soit le nombre de signaux positifs — piège explicite
// de la demande : "best-verdun-tours-blog.com" ne doit jamais être traité
// comme "memorial-verdun.fr" simplement parce que "verdun" apparaît dans les
// deux domaines.
const INSTITUTION_MARKER_PATTERN = /\b(musee|musée|memorial|mémorial|archive|archives|bibliotheque|bibliothèque|universite|université|institut|laboratoire|observatoire|fondation|conservatoire|academie|académie|societe savante|société savante|centre de recherche|museum|library|foundation|research center|research institute)\b/i;

const COMMERCIAL_OR_TOURISM_MARKER_PATTERN = /\b(blog|boutique|shop|store|tours?|voyage|billet|billetterie|reservation|réservation|avis|comparatif|meilleur(e)?s?|top\s?\d+|guide touristique|forfait|promo|promotion|soldes|magasin|hotel|hôtel|restaurant)\b/i;

// Découpe un nom de domaine en tokens exploitables (retire le TLD/les
// préfixes techniques courants) — ex. "memorial-verdun.fr" → ["memorial","verdun"].
function domainNameTokens(domain) {
  const withoutTld = String(domain || "").replace(/\.(fr|com|org|net|info|eu|gov|edu|int)(\.[a-z]{2})?$/i, "");
  return tokenize(withoutTld.replace(/[.-]/g, " "));
}

// Retourne TOUJOURS un objet (jamais null, pour rester simple à consommer) :
// score nul et hints nuls quand moins de 2 signaux concordants sont réunis,
// ou quand un marqueur commercial/touristique est détecté (veto total).
function inferContextualAuthority(candidate, topicContext) {
  const domain = candidate.domain || "";
  const combinedText = `${candidate.title || ""} ${candidate.description || ""} ${(candidate.extraSnippets || []).join(" ")}`;
  const domainText = domainNameTokens(domain).join(" ");

  const noSignal = { score: 0, primarySourceHint: 0, specializationHint: 0, editorialQualityHint: 0, reasons: [], penaltyReasons: [] };

  if (COMMERCIAL_OR_TOURISM_MARKER_PATTERN.test(`${domain} ${candidate.title || ""}`)) {
    return { ...noSignal, penaltyReasons: ["marqueur commercial/touristique détecté : aucune autorité contextuelle inférée"] };
  }

  const hasInstitutionMarker = INSTITUTION_MARKER_PATTERN.test(`${domainText} ${combinedText}`);
  const domainTokens = domainNameTokens(domain);
  const hasDomainSubjectTie = domainTokens.some((t) => topicContext.subjectTokens.includes(t));
  const editorialOverlap = overlapFraction(topicContext.subjectTokens, combinedText);
  const hasEditorialCoherence = editorialOverlap >= 0.35;

  const signals = [];
  if (hasInstitutionMarker) signals.push("institution spécialisée directement liée au sujet");
  if (hasDomainSubjectTie) signals.push("domaine et titre fortement concordants");
  if (hasEditorialCoherence) signals.push("contenu éditorial cohérent avec le sujet");

  if (signals.length < 2) {
    // Cas explicitement documenté par la demande : un domaine qui reprend un
    // mot du sujet SANS aucun autre signal ne doit jamais devenir une
    // autorité — rapporté comme signal négatif lisible, jamais silencieux.
    if (hasDomainSubjectTie && !hasInstitutionMarker && !hasEditorialCoherence) {
      return { ...noSignal, penaltyReasons: ["domaine lexicalement lié au sujet mais type d'organisation non identifiable"] };
    }
    return noSignal;
  }

  // Score modéré, volontairement plafonné SOUS une autorité confirmée du
  // registre (weight jusqu'à 0.95) — une inférence reste moins certaine
  // qu'une entrée curée manuellement (section 3 : "une autorité connue du
  // registre reste un signal fort").
  const score = signals.length >= 3 ? 0.65 : 0.5;
  return {
    score,
    primarySourceHint: signals.length >= 3 ? 0.55 : 0.4,
    specializationHint: signals.length >= 3 ? 0.75 : 0.6,
    editorialQualityHint: 0.7,
    reasons: signals,
    penaltyReasons: []
  };
}

function extractRegistryMatch(domain) {
  if (!domain) return null;
  return AUTHORITY_REGISTRY.find((entry) => domain === entry.domain || domain.endsWith(`.${entry.domain}`)) || null;
}

// ── topicContext : calculé UNE FOIS par sujet, jamais par candidat — aucun
// appel IA (section 4 de la demande : "éviter autant que possible un nouvel
// appel IA coûteux"). Le recoupement avec le registre reste un simple calcul
// lexical déterministe, jamais une classification par un modèle.
function buildTopicContext(subject) {
  const subjectTokens = tokenize(subject);
  const freshnessLikely = FRESHNESS_MARKER_PATTERN.test(String(subject || ""));
  const matchingAuthorities = AUTHORITY_REGISTRY
    .map((entry) => ({ entry, tagOverlap: overlapFraction(subjectTokens, entry.tags.join(" ")) }))
    .filter((m) => m.tagOverlap > 0)
    .sort((a, b) => b.tagOverlap - a.tagOverlap);
  return { subjectTokens, freshnessLikely, matchingAuthorities };
}

// ── Poids : la fraîcheur ne compte significativement QUE si le sujet
// l'exige (section 2, temporalité) — jamais un poids fixe qui pénaliserait
// une page ancienne mais toujours valide sur un sujet stable.
function resolveWeights(freshnessLikely) {
  return freshnessLikely
    ? { relevance: 0.28, authority: 0.22, primarySource: 0.12, specialization: 0.08, editorial: 0.15, freshness: 0.15 }
    : { relevance: 0.32, authority: 0.26, primarySource: 0.14, specialization: 0.10, editorial: 0.16, freshness: 0.02 };
}

function scoreFreshness(candidate, freshnessLikely) {
  if (!freshnessLikely) return { score: 0.5, note: "fraîcheur non déterminante pour ce sujet" };
  const pageAge = candidate.pageAge ? new Date(candidate.pageAge) : null;
  if (!pageAge || Number.isNaN(pageAge.getTime())) return { score: 0.5, note: "date de publication inconnue" };
  const ageDays = (Date.now() - pageAge.getTime()) / 86_400_000;
  const score = clamp01(1 - ageDays / 365);
  return { score, note: `${Math.max(0, Math.round(ageDays))} jour(s)` };
}

// ── Fonction centrale, déterministe et testable (section 3 de la demande).
// Ne décide jamais seule (l'IA de sélection garde la main derrière, cf.
// lib/web-search-grounding.js) — sert à ORDONNER/FILTRER en amont, avec une
// justification lisible (section 13, observabilité).
function scoreSourceForTopic(candidate, topicContext) {
  const { subjectTokens, freshnessLikely, matchingAuthorities } = topicContext;
  const domain = candidate.domain || "";
  const haystack = `${candidate.title || ""} ${candidate.description || ""} ${(candidate.extraSnippets || []).join(" ")}`;

  const relevanceScore = clamp01(overlapFraction(subjectTokens, haystack));

  const registryEntry = extractRegistryMatch(domain);
  const isInstitutionalDomain = INSTITUTIONAL_DOMAIN_PATTERN.test(domain);
  const isAcademicGenericDomain = ACADEMIC_GENERIC_DOMAIN_PATTERN.test(domain);
  const isLevelAReference = domainInSet(domain, LEVEL_A_REFERENCE_DOMAINS);
  const isLevelCEncyclopedia = domainInSet(domain, LEVEL_C_ENCYCLOPEDIA_DOMAINS);

  let authorityScore = 0.1;
  let primarySourceScore = 0.1;
  let specializationScore = 0.35;
  let editorialQualityScore = 0.45;
  const reasons = [];
  const penaltyReasons = [];

  if (registryEntry) {
    const tagOverlap = overlapFraction(subjectTokens, registryEntry.tags.join(" "));
    if (tagOverlap > 0) {
      authorityScore = clamp01(registryEntry.weight * (0.55 + 0.45 * tagOverlap));
      primarySourceScore = registryEntry.primary ? clamp01(0.7 + 0.25 * tagOverlap) : clamp01(0.3 + 0.2 * tagOverlap);
      specializationScore = tagOverlap >= 0.4 ? 0.92 : 0.65;
      editorialQualityScore = 0.9;
      reasons.push(`autorité reconnue pour ce domaine (${registryEntry.label}, recoupement ${Math.round(tagOverlap * 100)}%)`);
      if (registryEntry.primary) reasons.push("source primaire/officielle pour ce type de sujet");
    } else {
      // Domaine du registre mais AUCUN recoupement thématique : jamais un
      // bonus d'autorité plein — évite exactement le piège cité en section 3
      // (un site gouvernemental hors-sujet ne doit pas dépasser une source
      // vraiment spécialisée).
      authorityScore = registryEntry.weight * 0.15;
      editorialQualityScore = 0.6;
      penaltyReasons.push(`domaine reconnu (${registryEntry.label}) mais hors de son domaine de compétence pour ce sujet précis`);
    }
  } else if (isInstitutionalDomain) {
    // Niveau A+ générique (section 2 de la demande : "prévoir une logique
    // permettant de reconnaître des catégories fiables" au-delà de la seule
    // liste curée ci-dessus) — TLD structurellement institutionnel
    // (gouvernemental/international/muséal ; PLUS .edu/.ac.xx depuis
    // l'ajustement du 14/09/2026, cf. isAcademicGenericDomain ci-dessous) :
    // un signal fort même hors registre nommé, volontairement au-dessus des
    // encyclopédies de référence (niveau A) et très au-dessus de Wikipédia
    // (niveau C).
    authorityScore = 0.62;
    primarySourceScore = 0.5;
    editorialQualityScore = 0.75;
    reasons.push("domaine institutionnel générique (gouvernemental/international/muséal) — niveau A+ générique");
  } else if (isAcademicGenericDomain || isLevelAReference) {
    // Niveau A : encyclopédies/références académiques ou spécialisées de
    // premier plan (Britannica, Universalis, Our World in Data) ET, depuis
    // l'ajustement du 14/09/2026, tout domaine universitaire générique
    // (.edu/.ac.xx) — un simple TLD universitaire n'est plus automatiquement
    // A+ (n'importe quel établissement peut en détenir un), mais reste un
    // signal réel de sérieux éditorial. Stanford Encyclopedia of Philosophy
    // (plato.stanford.edu) atterrit ainsi au minimum A par ce motif, sans
    // entrée nommée nécessaire. Bonus significatif, jamais aussi fort qu'une
    // autorité A+ confirmée (registre curé ou institutionnel générique
    // ci-dessus).
    authorityScore = 0.55;
    primarySourceScore = 0.15;
    specializationScore = 0.3;
    editorialQualityScore = 0.8;
    reasons.push(isAcademicGenericDomain && !isLevelAReference
      ? "domaine universitaire générique (.edu/.ac.xx) — niveau A par défaut"
      : "encyclopédie ou référence académique/spécialisée de premier plan (niveau A)");
  } else if (isLevelCEncyclopedia) {
    // Niveau C (Wikipédia et ses miroirs) : reste une source valide et
    // souvent complémentaire précieuse — JAMAIS supprimée (sections 6/7 de
    // la demande) — mais un bonus d'autorité volontairement modeste : c'est
    // précisément le problème diagnostiqué (cas réel "constructivisme
    // russe" — une formulation catégorique reprise telle quelle faute de
    // hiérarchie entre les sources).
    // Calibré pour rester nettement sous les niveaux A+/A ci-dessus tout en
    // évitant de faire chuter Wikipédia sous MIN_QUALITY_THRESHOLD dans le
    // cas courant où elle reste la SEULE source disponible (section 6/7 de
    // la demande, Cas 4 — "le système ne doit pas échouer") : à 0.25, une
    // page par ailleurs pertinente mais avec un recoupement lexical imparfait
    // (synonyme, tournure différente...) repassait sous le seuil — 0.35
    // conserve une marge réaliste tout en restant loin des niveaux A+/A.
    authorityScore = 0.35;
    primarySourceScore = 0.1;
    specializationScore = 0.2;
    editorialQualityScore = 0.7;
    reasons.push("encyclopédie généraliste collaborative (niveau C) — utile en complément, jamais prioritaire face à une source A+/A pertinente");
  }

  // Autorité contextuelle HORS registre (V2, section 1/3 de la demande) :
  // toujours calculée pour rester observable (cf. selectionReason), mais
  // n'AUGMENTE jamais artificiellement une autorité déjà mieux établie —
  // combinée par simple maximum, jamais une addition qui doublerait un
  // même signal ni un remplacement des branches ci-dessus. Une autorité
  // confirmée du registre reste donc toujours au moins aussi forte qu'une
  // autorité seulement inférée (plafond 0.65 < weight de registre jusqu'à 0.95).
  const contextual = inferContextualAuthority(candidate, topicContext);
  if (contextual.score > authorityScore) {
    authorityScore = contextual.score;
    reasons.push(...contextual.reasons);
  }
  primarySourceScore = Math.max(primarySourceScore, contextual.primarySourceHint);
  specializationScore = Math.max(specializationScore, contextual.specializationHint);
  editorialQualityScore = Math.max(editorialQualityScore, contextual.editorialQualityHint);
  penaltyReasons.push(...contextual.penaltyReasons);

  const descriptionLength = String(candidate.description || "").trim().length;
  if (descriptionLength < 20) {
    editorialQualityScore -= 0.15;
    penaltyReasons.push("description absente ou très courte");
  }
  if (CLICKBAIT_TITLE_PATTERN.test(String(candidate.title || ""))) {
    editorialQualityScore -= 0.2;
    penaltyReasons.push("titre à consonance putaclic");
  }
  editorialQualityScore = clamp01(editorialQualityScore);

  const freshness = scoreFreshness(candidate, freshnessLikely);

  const weights = resolveWeights(freshnessLikely);
  const finalScore = clamp01(
    weights.relevance * relevanceScore +
    weights.authority * authorityScore +
    weights.primarySource * primarySourceScore +
    weights.specialization * specializationScore +
    weights.editorial * editorialQualityScore +
    weights.freshness * freshness.score
  );

  if (relevanceScore < 0.15) penaltyReasons.push("faible recoupement lexical avec le sujet demandé");

  return {
    domain,
    url: candidate.url,
    title: candidate.title,
    finalScore: Math.round(finalScore * 100),
    relevanceScore: Math.round(relevanceScore * 100),
    authorityScore: Math.round(authorityScore * 100),
    primarySourceScore: Math.round(primarySourceScore * 100),
    specializationScore: Math.round(specializationScore * 100),
    editorialQualityScore: Math.round(editorialQualityScore * 100),
    freshnessScore: Math.round(freshness.score * 100),
    contextualAuthorityScore: Math.round(contextual.score * 100),
    matchedAuthority: registryEntry ? registryEntry.label : (contextual.score > 0 ? "autorité contextuelle inférée" : null),
    reasons,
    penaltyReasons,
    // selectionReason : format lisible pour les logs (section 13) — jamais
    // affiché à l'utilisateur, uniquement pour le diagnostic/tests.
    selectionReason: [...reasons.map((r) => `+ ${r}`), ...penaltyReasons.map((r) => `- ${r}`)].join(" ; ") || "aucun signal particulier"
  };
}

// Trie les candidats par finalScore décroissant (stable pour les ex-aequo,
// préserve alors l'ordre déjà appliqué par filterCandidateSources, cf.
// lib/web-search-grounding.js — notamment la priorité Wikipédia déjà en
// place à égalité de score).
function rankCandidates(candidates, topicContext) {
  return candidates
    .map((c) => ({ ...c, score: scoreSourceForTopic(c, topicContext) }))
    .sort((a, b) => b.score.finalScore - a.score.finalScore);
}

// Seuil minimal (section 10 : "ne pas forcer une mauvaise source") — sous ce
// score, un candidat n'est même pas soumis au jugement de l'IA de sélection.
// Calibré le 31/08/2026 sur un corpus réel de 40 sujets/20 domaines
// (scripts/calibrate-source-threshold.js) : à 30, 44 sources "faibles"
// (score <40) passaient encore le filtre pour un gain de couverture NUL —
// les 40/40 sujets du corpus restaient déjà tous "groundés" (au moins un
// candidat exploitable) avec un seuil de 40, y compris les sujets de la vie
// quotidienne (poêle en inox, conservation du pain) et les sujets obscurs.
// Relevé à 40 : élimine ces 44 sources faibles sans perdre AUCUNE couverture
// sur le corpus testé (toujours 40/40). Un seuil contextuel (plus strict/
// plus souple selon le type de sujet) a été envisagé mais écarté : les
// données ne montrent aucun sujet, y compris "vie quotidienne", qui aurait
// bénéficié d'un seuil plus bas que 40 — pas de sophistication sans preuve
// de bénéfice réel (cf. rapport du 31/08/2026).
const MIN_QUALITY_THRESHOLD = 40;

function filterByMinQuality(rankedCandidates, threshold = MIN_QUALITY_THRESHOLD) {
  return rankedCandidates.filter((c) => c.score.finalScore >= threshold);
}

// Score au-delà duquel le meilleur candidat actuel est jugé "déjà assez bon"
// — sous ce seuil, ça vaut la peine de chercher mieux (retry) ; au-dessus,
// une recherche complémentaire n'apporterait qu'un gain marginal pour un
// coût Brave supplémentaire inutile (section 16, "ne pas faire exploser le
// coût"). Distinct de MIN_QUALITY_THRESHOLD : celui-ci décide si on a DE QUOI
// travailler, GOOD_ENOUGH_THRESHOLD décide si ça vaut la peine de chercher
// MIEUX. Calibré empiriquement (cf. scripts/test-source-scoring-real.js) :
// assez haut pour déclencher la relance sur "Composition de l'atmosphère de
// Mars" (Wikipédia/Universalis seuls, à 60, sans la NASA) ou "Les
// caractéristiques de l'impressionnisme" (sans le Musée d'Orsay, à 64),
// assez bas pour ne JAMAIS relancer quand une autorité déjà pertinente et
// bien notée est présente (ex. l'INSEE à 66 pour "Population française
// actuelle" ne déclenche pas de relance vers service-public.fr, redondant).
const GOOD_ENOUGH_THRESHOLD = 65;

// ── Retry ciblé (section 10/11) : cherche UNE autorité du registre dont les
// tags recoupent significativement le sujet et qui n'est pas déjà
// représentée parmi les candidats actuels — sert à construire une requête
// Brave complémentaire ciblée (site:<domaine>), jamais une boucle non bornée
// (un seul essai, cf. server.js resolveWebSearchGrounding). Le seuil de
// recoupement (0.25) est volontairement plus permissif que
// GOOD_ENOUGH_THRESHOLD sur le score final : mieux vaut tenter une relance
// qui échoue (aucun résultat exploitable pour ce site précis, sans coût
// caché au-delà de l'appel Brave) que manquer une autorité clairement
// compétente pour ce sujet.
function findBestUnrepresentedAuthority(topicContext, existingDomains) {
  const existing = new Set(existingDomains || []);
  const best = topicContext.matchingAuthorities.find((m) => !existing.has(m.entry.domain) && m.tagOverlap >= 0.25);
  return best ? best.entry : null;
}

// Décide si une relance Brave ciblée vaut la peine (section 10 : "fixe un
// nombre maximum raisonnable de tentatives" — ici au plus UNE) : seulement
// si le meilleur candidat actuel n'est pas déjà solide ET qu'une autorité
// du registre clairement compétente pour ce sujet manque encore à l'appel.
// Retourne l'entrée de registre à cibler, ou null si aucune relance n'est
// justifiée (candidat déjà bon, ou aucune autorité connue à chercher).
function shouldAttemptAuthorityRetry(rankedCandidates, topicContext) {
  const bestScore = rankedCandidates[0]?.score.finalScore ?? 0;
  if (bestScore >= GOOD_ENOUGH_THRESHOLD) return null;
  return findBestUnrepresentedAuthority(topicContext, rankedCandidates.map((c) => c.domain));
}

// ── Étiquette d'autorité lisible A+/A/B/C (section 2 de la demande) ────────
// Fonction UNIQUEMENT descriptive, jamais utilisée dans le calcul du score
// lui-même (scoreSourceForTopic ci-dessus reste la seule autorité de
// classement) — sert à étiqueter chaque source dans le texte transmis au
// modèle de rédaction (lib/web-search-grounding.js buildGroundingText) pour
// qu'il sache reconnaître, SANS appel IA supplémentaire, qu'une affirmation
// catégorique venant uniquement d'une source de niveau C (Wikipédia) mérite
// davantage de prudence qu'une affirmation corroborée par une source A+/A
// (sections 5/6 de la demande). "B" est le repli par défaut : aucune
// détection positive nécessaire (presse/sites éducatifs non listés restent
// simplement non pénalisés, jamais un jugement de qualité porté à leur place).
function classifyDomainAuthorityTier(domain) {
  if (!domain) return "B";
  if (extractRegistryMatch(domain) || INSTITUTIONAL_DOMAIN_PATTERN.test(domain)) return "A+";
  if (ACADEMIC_GENERIC_DOMAIN_PATTERN.test(domain) || domainInSet(domain, LEVEL_A_REFERENCE_DOMAINS)) return "A";
  if (domainInSet(domain, LEVEL_C_ENCYCLOPEDIA_DOMAINS)) return "C";
  return "B";
}

module.exports = {
  AUTHORITY_REGISTRY,
  TERTIARY_REFERENCE_DOMAINS,
  LEVEL_A_REFERENCE_DOMAINS,
  LEVEL_C_ENCYCLOPEDIA_DOMAINS,
  INSTITUTIONAL_DOMAIN_PATTERN,
  ACADEMIC_GENERIC_DOMAIN_PATTERN,
  FRESHNESS_MARKER_PATTERN,
  INSTITUTION_MARKER_PATTERN,
  COMMERCIAL_OR_TOURISM_MARKER_PATTERN,
  MIN_QUALITY_THRESHOLD,
  GOOD_ENOUGH_THRESHOLD,
  tokenize,
  overlapFraction,
  domainNameTokens,
  domainInSet,
  buildTopicContext,
  inferContextualAuthority,
  scoreSourceForTopic,
  classifyDomainAuthorityTier,
  rankCandidates,
  filterByMinQuality,
  findBestUnrepresentedAuthority,
  shouldAttemptAuthorityRetry
};
