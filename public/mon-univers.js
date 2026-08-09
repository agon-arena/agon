// Page "Mon univers" : réutilise le moteur de bulles existant (tagTrendCloud.js), jamais
// dupliqué. Volontairement léger — pas de chargement de script.js (qui alourdirait la page
// pour un seul besoin : getKey(), reproduite ici à l'identique, cf. script.js getKey()/lsGet()).
import { renderTagTrendCloud } from "/tagTrendCloud.js?v=20260809-memory-empty-caption";

// ---- Identité anonyme : même logique exacte que script.js, aucune nouvelle convention ----
function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, String(val)); } catch {} }

function getKey() {
  let k = lsGet("key");
  if (!k) {
    k = Math.random().toString(36);
    lsSet("key", k);
  }
  return k;
}

// ---- Couleur par galaxie : une teinte fixe par galaxie (jamais blanc/bleu/rouge, déjà pris par
// les nuages de tags existants — général blanc-bleuté, "Droite" bleu, "Gauche" rouge, cf.
// style.css .agon-tag-bubble / .agon-cloud-political-right / .agon-cloud-political-left), la
// même teinte pour tous les niveaux (galaxie -> système solaire -> étoile) mais de plus en plus
// claire à mesure qu'on zoome, pour garder un repère visuel de profondeur. Deux arcs de teintes
// hors zones réservées (rouge ~340-20°, bleu ~200-250°) : 25-181° (chaud, catégories concrètes)
// et 256-334° (violet/rose, catégories plus abstraites) — répartition à pas régulier (~13°),
// jamais recalculée dynamiquement (stable d'une visite à l'autre, mêmes noms de galaxie que
// getOpinionArticleGalaxy côté serveur, cf. server.js).
const GALAXY_HUE_BY_NAME = {
  "Sport": 25,
  "Histoire": 38,
  "Économie - emploi": 51,
  "Loisirs": 64,
  "Espace jeunes": 77,
  "Climat - environnement": 90,
  "Vie personnelle - modes de vie": 103,
  "Santé - bien-être": 116,
  "Société - éducation": 129,
  "Sciences sociales": 142,
  "Sciences - technologie": 155,
  "Culture": 168,
  "Langues": 181,
  "Philosophie": 256,
  "Politique": 269,
  "Justice - faits divers": 282,
  "Arts": 295,
  "International": 308,
  "Lettres": 321,
  "Médias - divertissements": 334
};
// Filet de sécurité si une galaxie future n'est pas dans la table ci-dessus (nouvelle catégorie
// côté serveur non répercutée ici) : teinte dérivée du nom, toujours hors zones réservées.
function hueForGalaxy(name) {
  const known = GALAXY_HUE_BY_NAME[name];
  if (known !== undefined) return known;
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const span = 181 - 25 + (334 - 256); // longueur cumulée des deux arcs autorisés
  let offset = hash % span;
  return offset <= (181 - 25) ? 25 + offset : 256 + (offset - (181 - 25));
}

// Saturation commune, luminosité des 3 arrêts du dégradé (40%/70%/100%, cf. structure existante
// de .agon-tag-bubble) — jamais recalculée par galaxie. Pastel sobre : clair (comme la toute
// première version) mais nettement désaturé (18% contre 68% à l'origine, encore abaissé depuis
// 32% le 07/08/2026 — "couleurs moins criardes et plus pastel") pour éviter le rendu "bonbon"
// criard — corrigé une première fois vers des tons sombres façon "planète"
// (06/08/2026), jugés finalement trop sombres. Système solaire nettement plus lumineux que
// l'étoile (demande du 06/08/2026, inversé par rapport à l'ordre "de plus en plus clair en
// zoomant" d'avant) : le système est la bulle centrale/hub, l'étoile une simple bulle satellite
// — cf. aussi le halo dédié .agon-tag-bubble-solarsystem (style.css) pour accentuer l'écart.
const GALAXY_GRADIENT_LEVELS = {
  galaxy: [82, 72, 60],
  solarSystem: [95, 91, 85],
  star: [76, 66, 54]
};
// fadeEdge (étoiles uniquement, demande du 07/08/2026) : les 2 derniers arrêts perdent
// progressivement leur opacité au lieu de rester pleins jusqu'à 100% — sans lui, même en
// retirant le contour (.agon-tag-bubble-star, style.css), le dégradé plein s'arrêtait net à la
// même place, donnant l'impression d'une "rupture" à peine moins visible qu'un vrai contour.
// Plusieurs paliers d'opacité (pas juste un dernier arrêt à alpha 0) : un seul palier créait un
// "coude" perceptible à l'endroit où l'estompage commençait (le fondu du soleil, même souci,
// cf. sunVisual) — ici étalé sur 3 arrêts pour une courbe plus progressive.
function bubbleBackgroundFor(galaxyName, level, fadeEdge = false) {
  const hue = hueForGalaxy(galaxyName);
  const stops = GALAXY_GRADIENT_LEVELS[level];
  const s = 12;
  const tail = fadeEdge
    ? `hsla(${hue}, ${s}%, ${stops[1]}%, 0.75) 78%, hsla(${hue}, ${s}%, ${stops[2]}%, 0.35) 90%, hsla(${hue}, ${s}%, ${stops[2]}%, 0) 100%`
    : `hsl(${hue} ${s}% ${stops[2]}%) 100%`;
  // closest-side (seulement quand fadeEdge) : sans mot-clé de taille, un radial-gradient prend
  // par défaut farthest-corner — pour un cercle de rayon R inscrit dans une boîte carrée, ça
  // place 100% du dégradé au coin (R×√2), bien au-delà du bord réellement visible (coupé par
  // border-radius:50% à R, soit seulement ~71% du dégradé). Résultat sans closest-side : le
  // dernier arrêt (alpha 0) n'était jamais atteint à l'endroit où la bulle est coupée, donc
  // encore ~55% d'opacité pile à la découpe — rupture nette malgré le dégradé (confirmé par
  // capture d'écran le 07/08/2026). closest-side cale 100% exactement sur le bord visible. Le
  // dégradé par défaut (non fadeEdge, systèmes/galaxies) garde farthest-corner : il finit sur
  // une couleur pleine de toute façon, aucune raison de changer un rendu déjà validé.
  // circle (pas ellipse) centré à 50%/50% quand fadeEdge : une ellipse hors-centre (38%/32%,
  // gardée pour le rendu "planète éclairée" par défaut) calcule closest-side indépendamment sur
  // chaque axe depuis un point qui n'est PAS le centre — la distance au bord réel du cercle
  // varie donc selon la direction, et le dégradé ne finissait toujours pas exactement sur le
  // bord visible dans toutes les directions (contour encore net par endroits, confirmé par
  // retour direct le 07/08/2026). Un cercle centré garantit un rayon identique dans toutes les
  // directions, donc un alpha 0 pile sur le bord partout, sans exception.
  const shape = fadeEdge ? "circle closest-side at 50% 50%" : "ellipse at 38% 32%";
  return `radial-gradient(${shape}, rgba(255,255,255,1) 0%, hsl(${hue} ${s}% ${stops[0]}%) 40%, hsl(${hue} ${s}% ${stops[1]}%) 70%, ${tail})`;
}

// "À classer" et ses articles (aucune galaxie à colorer, cf. buildTrendsForItems) : même bleuté
// que le dégradé par défaut de .agon-tag-bubble (cf. style.css), mais avec le même fondu en
// alpha vers le bord que les autres niveaux — demande du 07/08/2026 ("plus de contours nettes,
// je veux contours dégradés"), ces deux types étaient restés sur le rendu par défaut (contour
// dur inclus) alors que tous les autres niveaux avaient déjà été corrigés.
const UNCLASSIFIED_BUBBLE_BACKGROUND = `radial-gradient(circle closest-side at 50% 50%, rgba(255,255,255,1) 0%, rgba(235,242,255,1) 40%, rgba(210,225,248,0.85) 70%, rgba(185,208,240,0.35) 88%, rgba(185,208,240,0) 100%)`;

// Liaison étoile → système solaire : reprend la teinte dont l'étoile hérite déjà.
// Le dégradé reste lumineux près du soleil et s'adoucit à l'approche de l'étoile.
function starConnectorBackgroundFor(galaxyName) {
  const hue = hueForGalaxy(galaxyName);
  return `linear-gradient(to right, hsla(${hue}, 12%, 76%, 0.95), hsla(${hue}, 12%, 54%, 0.78))`;
}

// Bulles galaxie (niveau racine uniquement) : rendu "nœud de neurone" très lumineux plutôt qu'un
// simple disque pastel — cœur très brillant + fines lignes rayonnantes façon synapses/dendrites,
// halo qui déborde du cercle (cf. .agon-tag-bubble-galaxy, style.css). Remplace l'ancien visuel
// "galaxie spiralée" (demande du 09/08/2026, "supprimer le visuel galaxie et le remplacer par un
// visuel de nœud de neurone très brillant"). Le dégradé de base (bubbleBackgroundFor) reste
// identique en dessous pour garder la même teinte que les systèmes/étoiles filles ; ces couches
// viennent seulement s'ajouter par-dessus.

function pointsToPathD(points) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
}

// Découpe chaque ligne en paliers de largeur décroissante (base épaisse près du
// centre → pointe fine en bout de queue, demande du 07/08/2026 "que l'extrémité devienne plus
// fin") — un <path> SVG a une seule stroke-width fixe sur toute sa longueur, impossible de la
// faire varier autrement qu'en dessinant plusieurs segments avec des largeurs différentes.
// Chevauchement d'1 point entre segments consécutifs : sans lui, une micro-coupure apparaîtrait
// à chaque jonction (stroke-linecap="round" comble l'écart si les segments se touchent pile).
function buildTaperedPathSegments(points, baseWidth, tipFactor, segmentCount, attrs) {
  const segLen = Math.ceil((points.length - 1) / segmentCount);
  let out = "";
  for (let s = 0; s < segmentCount; s += 1) {
    const start = s * segLen;
    const end = Math.min(points.length - 1, start + segLen);
    if (start >= points.length - 1) break;
    const segPoints = points.slice(start, end + 1);
    const t = s / (segmentCount - 1);
    const width = baseWidth * (1 - t * (1 - tipFactor));
    out += `<path d="${pointsToPathD(segPoints)}" fill="none" stroke-width="${width.toFixed(2)}" ${attrs}/>`;
  }
  return out;
}

// Points d'une "synapse" (ligne rayonnant depuis le centre) : angle fixe (réparti en angle d'or,
// même principe que les satellites Agôn, cf. tagTrendCloud.js AGON_SATELLITE_GOLDEN_ANGLE — non
// réutilisé directement, module séparé, mais même logique) et longueur variée selon l'angle lui-
// même (déterministe, jamais Math.random, pour un rendu stable d'un re-render à l'autre) — pas de
// coordonnées à la main comme l'ancienne spirale, chaque nœud calcule sa propre géométrie. Léger
// arc (composante perpendiculaire en sin(t·π)) plutôt qu'une ligne parfaitement droite, pour une
// allure de dendrite qui ondule légèrement plutôt qu'un trait au cordeau.
const NEURON_LINE_COUNT = 7;
const NEURON_GOLDEN_ANGLE = 137.508;

function buildNeuronLinePoints(seed) {
  const phase = (seed * 53) % 360;
  const sets = [];
  for (let i = 0; i < NEURON_LINE_COUNT; i += 1) {
    const angleDeg = phase + i * NEURON_GOLDEN_ANGLE;
    const angleRad = (angleDeg * Math.PI) / 180;
    const length = 30 + Math.abs(Math.sin(angleRad * 2.3)) * 16;
    const steps = 6;
    const line = [];
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const bend = Math.sin(t * Math.PI) * 3.5;
      const dist = 5 + t * length;
      const x = 50 + Math.cos(angleRad) * dist + Math.cos(angleRad + Math.PI / 2) * bend;
      const y = 50 + Math.sin(angleRad) * dist + Math.sin(angleRad + Math.PI / 2) * bend;
      line.push([x, y]);
    }
    sets.push(line);
  }
  return sets;
}

// Nœud de neurone : synapses rayonnantes (même moteur de rendu que l'ancienne spirale — segments
// effilés + triple flou SVG, cf. buildTaperedPathSegments juste au-dessus — pour la même qualité
// de lueur diffuse plutôt qu'un trait net) émanant d'un cœur très lumineux (cf. galaxyBubbleVisual
// juste en dessous, qui superpose ce cœur par-dessus).
function neuronLinesBackground(hue) {
  const linePointSets = buildNeuronLinePoints(hue);
  const stroke = `hsl(${hue}, 20%, 85%)`;
  // Opacités légèrement réduites (demande du 09/08/2026, "les nœuds doivent être légèrement moins
  // brillants") : 0.4/0.6/0.85 → 0.3/0.47/0.68.
  const outerGlowPaths = linePointSets
    .map((points) => buildTaperedPathSegments(points, 20, 0.25, 5, `stroke="${stroke}" stroke-linecap="round" opacity="0.3" filter="url(#neuronGlowOuter)"`))
    .join("");
  const innerGlowPaths = linePointSets
    .map((points) => buildTaperedPathSegments(points, 12, 0.25, 5, `stroke="${stroke}" stroke-linecap="round" opacity="0.47" filter="url(#neuronGlowInner)"`))
    .join("");
  const coreStroke = `hsl(${hue}, 10%, 97%)`;
  const corePaths = linePointSets
    .map((points) => buildTaperedPathSegments(points, 6, 0.2, 5, `stroke="${coreStroke}" stroke-linecap="round" opacity="0.68" filter="url(#neuronGlowCore)"`))
    .join("");
  // preserveAspectRatio="none" : cf. commentaire équivalent conservé sur bubbleBackgroundFor plus
  // haut — sans lui, le SVG garde son ratio 1:1 par défaut au lieu de remplir le rectangle donné
  // par background-size.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><defs>`
    + `<filter id="neuronGlowOuter" x="-90%" y="-90%" width="280%" height="280%"><feGaussianBlur stdDeviation="5.5"/></filter>`
    + `<filter id="neuronGlowInner" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.8"/></filter>`
    + `<filter id="neuronGlowCore" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.4"/></filter>`
    + `</defs>${outerGlowPaths}${innerGlowPaths}${corePaths}</svg>`;
  // 45% (pas 74%, demande du 09/08/2026 "le nœud de neurone doit être plus petit") : la géométrie
  // interne (angles/longueurs des synapses) reste inchangée, seule la taille d'affichage du SVG
  // dans la bulle est réduite — reste bien à l'intérieur du cercle (marge de sécurité déjà large
  // à 74%, donc à plus forte raison ici).
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") center / 45% 45% no-repeat`;
}

function galaxyBubbleVisual(galaxyName) {
  const hue = hueForGalaxy(galaxyName);
  const lines = neuronLinesBackground(hue);
  // Cœur TRÈS lumineux (demande du 09/08/2026, "nœud de neurone très brillant") : quasi blanc pur,
  // contrairement au petit cœur discret de l'ancien visuel galaxie — évoque le corps cellulaire du
  // neurone d'où rayonnent les synapses. Taille réduite (42% → 24%, demande du 09/08/2026 "le
  // nœud de neurone doit être plus petit") : les pourcentages des arrêts de couleur (26/50/68/84%)
  // restent relatifs au rayon de CE dégradé, donc la même courbe de luminosité, juste ramassée sur
  // une zone plus petite. ellipse (pas circle) : les pourcentages de rayon ne sont valides en CSS
  // que sur ellipse, valeurs quasi égales pour rester circulaire.
  // Alphas légèrement réduits (demande du 09/08/2026, "légèrement moins brillants") : 1/0.92 →
  // 0.85/0.78.
  const core = `radial-gradient(ellipse 24% 24% at 50% 50%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.78) 26%, hsl(${hue} 22% 90%) 50%, hsla(${hue}, 20%, 85%, 0.3) 68%, transparent 84%)`;
  return {
    background: `${core}, ${lines}`,
    // Halo ::before (style.css .agon-tag-bubble-galaxy::before, --agon-tag-bubble-glow) : alpha
    // ramené 0.85 → 0.72, un peu moins brillant qu'avant tout en restant plus lumineux que
    // l'ancien visuel galaxie (0.7).
    glowColor: `hsla(${hue}, 25%, 85%, 0.72)`
  };
}

// ---- État local : un seul appel API, tout le reste se déduit de navPath ----
let universeData = null;
let navPath = []; // [] = galaxies ; [galaxyName] = systèmes ; [galaxyName, solarSystemId] = étoiles
let currentLevelItems = []; // objets métier dans le même ordre que les bulles actuellement affichées
const UNCLASSIFIED_KEY = "__unclassified__"; // sentinelle locale, jamais envoyée à l'API ni stockée

// Repli sur #agon-tag-trends-cloud (demande du 08/08/2026 : bulles "Ma mémoire" directement
// sur l'accueil, embarquées dans le même cadre que Bulles Actu/Bulles Agôn plutôt que sur une
// page à part) — la page /mon-univers autonome a bien son propre #agon-universe-cloud, jamais
// affecté par ce repli.
const cloudEl = document.getElementById("agon-universe-cloud") || document.getElementById("agon-tag-trends-cloud");
const breadcrumbEl = document.getElementById("universe-breadcrumb");
const statusEl = document.getElementById("universe-status");
const backBtn = document.getElementById("universe-back-btn");

// ---- Normalisation des poids (0..1) avant de les confier au moteur existant ----
// Le moteur (computeBubblePxSize) amplifie déjà la différence via une courbe (^1.75) — cette
// fonction ne fait que fournir une plage raisonnable en entrée : jamais un poids si bas que la
// bulle devient illisible, jamais un poids si haut qu'une bulle écrase toutes les autres, et un
// palier commun si tout le monde a le même poids (ex. les étoiles, poids brut uniforme).
// Plancher remonté (0.30 → 0.42, 06/08/2026) : à 0.30, computeBubblePxSize (courbe ^1.75)
// produit une bulle proche de son minimum (83px desktop) — trop peu de place pour
// fitLabelInBubble (tagTrendCloud.js, inchangé) sur un libellé de 3-4 mots (ex. "Espace et
// technologies spatiales"), qui retombe alors sur une police minuscule pour tenir.
const UNIVERSE_MIN_WEIGHT = 0.42;
const UNIVERSE_MAX_WEIGHT = 0.95;

function normalizeUniverseWeights(items, getRawWeight, minWeight = UNIVERSE_MIN_WEIGHT, maxWeight = UNIVERSE_MAX_WEIGHT) {
  const raws = items.map((item) => Math.max(0, Number(getRawWeight(item)) || 0));
  const max = raws.length ? Math.max(...raws) : 0;
  const min = raws.length ? Math.min(...raws) : 0;
  if (max === min) {
    const common = (minWeight + maxWeight) / 2;
    return items.map(() => common);
  }
  return raws.map((raw) => minWeight + ((raw - min) / (max - min)) * (maxWeight - minWeight));
}

function getGalaxyByName(name) {
  return (universeData?.galaxies || []).find((g) => g.name === name) || null;
}

// Centre "trou noir" (niveau systèmes solaires d'une galaxie, demande du 07/08/2026 : la bulle
// centrale ne doit plus ressembler à une bulle pastel comme les autres) : cœur noir + anneau
// (disque d'accrétion) teinté selon la galaxie ouverte, même hue que galaxyBubbleVisual/
// bubbleBackgroundFor pour rester cohérent d'un niveau à l'autre. glowColor alimente le halo
// (box-shadow, cf. .agon-tag-center-btn-blackhole, style.css) posé via renderTagTrendCloud.
function blackHoleVisual(galaxyName) {
  const hue = hueForGalaxy(galaxyName);
  // Même correctif que sunVisual juste en dessous, même raison : un seul dégradé continu
  // (cœur noir + halo), posé en entier sur ::before (plus grand que le cercle du bouton), pas
  // deux calques séparés (fond du bouton + halo à part) — deux courbes indépendantes ne se
  // raccordent jamais pile, un anneau restait visible à leur jonction (demande du 07/08/2026,
  // "fais la même chose pour les bulles trous noirs" après le même correctif sur le soleil).
  // Saturation abaissée (75/70/65% → 30/28/25%, demande du 07/08/2026 "couleurs plus pastel").
  return `radial-gradient(circle closest-side, #000 0%, #030304 20%, hsla(${hue},20%,60%,0.9) 36%, hsla(${hue},18%,55%,0.5) 49%, hsla(${hue},16%,50%,0) 100%)`;
}
function getSolarSystemById(galaxy, id) {
  return (galaxy?.solarSystems || []).find((s) => String(s.id) === String(id)) || null;
}

// Centre "soleil" (niveau étoiles d'un système solaire, demande du 07/08/2026, même logique que
// blackHoleVisual pour le niveau au-dessus) : cœur blanc-jaune rayonnant + fines aigrettes de
// lumière, teinté par la galaxie (hue) pour rester cohérent d'un niveau à l'autre. glowColor
// alimente le halo chaud (box-shadow, cf. .agon-tag-center-btn-sun, style.css).
function sunVisual(galaxyName) {
  const hue = hueForGalaxy(galaxyName);
  // Un seul dégradé continu couvrant TOUTE la zone visible (cœur + halo), posé sur ::before —
  // pas deux dégradés séparés (fond du bouton + halo) : recaler deux courbes indépendantes
  // l'une sur l'autre pour qu'elles se raccordent pile ne marche jamais vraiment (confirmé deux
  // fois par capture d'écran le 07/08/2026 — un anneau restait visible à leur jonction, même une
  // fois chacune "fondue" de son côté). Un seul gradient élimine le problème à la racine : plus
  // de jonction du tout, juste une courbe qui descend jusqu'à alpha 0. closest-side sur la boîte
  // du halo (::before, cf. style.css, plus grande que le cercle du bouton lui-même) : 100% du
  // dégradé tombe exactement sur son bord à elle, jamais au-delà.
  // Saturation abaissée sur la partie teintée par galaxie (70/68/60% → 30/28/25%, demande du
  // 07/08/2026 "couleurs plus pastel") — le cœur blanc-doré (hsl(42,100%,72%)) reste inchangé,
  // il n'est pas teinté par galaxie et n'a jamais été signalé comme criard.
  // Blanc très lumineux (pas jaune) : demande du 07/08/2026 "au lieu du jaune actuel, met du
  // blanc très lumineux" — les 3 premiers arrêts (cœur + halo proche) restent blanc pur au lieu
  // de descendre vers #fff6d8 (crème) puis hsl(42,100%,72%) (jaune doré) ; seule la teinte de la
  // galaxie prend le relais plus loin (40%+), inchangée.
  return `radial-gradient(circle closest-side, #fff 0%, #fff 10%, #fff 22%, hsla(${hue}, 20%, 62%, 0.95) 40%, hsla(${hue}, 18%, 60%, 0.85) 65%, hsla(${hue}, 16%, 50%, 0) 100%)`;
}

// ---- Construit les objets métier du niveau courant (déduit de navPath, aucun appel réseau) ----
function buildLevelItems() {
  if (!navPath.length) {
    const items = universeData.galaxies.map((g) => ({
      universeType: "galaxy",
      label: g.name,
      // Systèmes ET étoiles (demande du 07/08/2026 "plus il y a d'éléments dans la galaxie,
      // solar ET étoile, plus elle va être grosse") — avant, seul le nombre de systèmes solaires
      // comptait (g.solarSystems.length), une galaxie à 2 systèmes très riches en étoiles n'était
      // pas plus grosse qu'une galaxie à 2 systèmes vides. La police suit déjà automatiquement
      // (fitLabelInBubble, tagTrendCloud.js, calcule la taille du texte à partir de la largeur
      // réelle de la bulle) : aucun changement nécessaire de ce côté, juste ce poids d'entrée.
      rawWeight: g.solarSystems.length + g.solarSystems.reduce((sum, s) => sum + s.stars.length, 0),
      ref: g
    }));
    if (universeData.unclassified.length) {
      items.push({
        universeType: "unclassifiedGroup",
        label: "À classer",
        rawWeight: universeData.unclassified.length,
        ref: universeData.unclassified
      });
    }
    return items;
  }

  if (navPath[0] === UNCLASSIFIED_KEY) {
    return universeData.unclassified.map((article) => ({ universeType: "article", label: article.title || "Article", rawWeight: 1, ref: article }));
  }

  const galaxy = getGalaxyByName(navPath[0]);
  if (!galaxy) return [];

  // Navigation en 3 clics (revenu en arrière le 07/08/2026 : les étoiles affichées aux côtés de
  // leur système, essayées la veille, sont retirées) : une galaxie ouverte montre uniquement
  // ses systèmes ; les étoiles n'apparaissent qu'après un clic sur le système concerné (cf.
  // handleItemActivate, navPath peut de nouveau atteindre 2 niveaux de profondeur).
  if (navPath.length === 1) {
    return galaxy.solarSystems.map((s) => ({
      universeType: "solarSystem",
      label: s.name,
      rawWeight: s.stars.length,
      ref: s
    }));
  }

  const solarSystem = getSolarSystemById(galaxy, navPath[1]);
  if (!solarSystem) return [];
  return solarSystem.stars.map((star) => ({ universeType: "star", label: star.name, rawWeight: star.articleCount, ref: star }));
}

// Couleur de bulle pour l'item courant, selon son niveau dans navPath — null pour les galaxies
// elles-mêmes au niveau racine (chacune porte sa propre teinte, cf. galaxyBubbleBackgroundFor
// plus bas) et pour "À classer"/les articles non classés (aucune galaxie à colorer).
function galaxyNameForCurrentLevel() {
  if (!navPath.length || navPath[0] === UNCLASSIFIED_KEY) return null;
  return navPath[0];
}

// Adapte chaque item métier au format attendu par renderTagTrendCloud. subjectId volontairement
// toujours vide : le laisser vide (jamais détourné) évite toute interaction avec le code Agôn
// existant (handleBubbleTagClick, cf. gestion du clic plus bas). dataset.bubbleIndex, déjà posé
// par le moteur pour son propre usage interne, sert ici à retrouver l'objet métier après coup.
// bubbleBackground : une teinte par galaxie, la même à travers les 3 niveaux de zoom mais de
// plus en plus claire (cf. bubbleBackgroundFor) — absent (undefined) pour "À classer" et les
// articles non classés, qui gardent le dégradé par défaut de .agon-tag-bubble.
function buildTrendsForItems(items) {
  // Un seul type d'item par niveau désormais (galaxies+"À classer" à la racine, systèmes seuls
  // dans une galaxie, étoiles seules dans un système, cf. buildLevelItems) : plus besoin de
  // séparer étoiles/systèmes dans deux plages de poids distinctes, ni de connectToIndex vers un
  // système précis — chaque bulle fille se relie simplement au centre courant (cf.
  // renderTagTrendCloud / drawOrbitLines, tagTrendCloud.js).
  const weights = normalizeUniverseWeights(items, (item) => item.rawWeight);

  const currentGalaxyName = galaxyNameForCurrentLevel();
  return items.map((item, i) => {
    let bubbleBackground;
    let bubbleGlowColor;
    let bubbleExtraClass;
    if (item.universeType === "galaxy") {
      const visual = galaxyBubbleVisual(item.ref.name);
      bubbleBackground = visual.background;
      bubbleGlowColor = visual.glowColor;
      bubbleExtraClass = "agon-tag-bubble-galaxy";
    } else if (item.universeType === "solarSystem" && currentGalaxyName) {
      bubbleBackground = bubbleBackgroundFor(currentGalaxyName, "solarSystem", true);
      // Saturation abaissée (55% → 26%, demande du 07/08/2026 "couleurs plus pastel").
      bubbleGlowColor = `hsla(${hueForGalaxy(currentGalaxyName)}, 18%, 85%, 0.6)`;
      bubbleExtraClass = "agon-tag-bubble-solarsystem";
    } else if (item.universeType === "star" && currentGalaxyName) {
      bubbleBackground = bubbleBackgroundFor(currentGalaxyName, "star", true);
      bubbleExtraClass = "agon-tag-bubble-star";
    } else if (item.universeType === "unclassifiedGroup" || item.universeType === "article") {
      // "À classer" et ses articles : aucune galaxie à colorer, gardent le dégradé bleuté par
      // défaut de .agon-tag-bubble — mais avec le même traitement contour/fondu que les autres
      // niveaux (demande du 07/08/2026 : plus AUCUNE bulle de "Ma mémoire" avec un contour net).
      bubbleBackground = UNCLASSIFIED_BUBBLE_BACKGROUND;
      bubbleExtraClass = "agon-tag-bubble-unclassified";
    }
    const orbitLineBackground = item.universeType === "star" && currentGalaxyName
      ? starConnectorBackgroundFor(currentGalaxyName)
      : undefined;
    return { tag: item.label, sizeWeight: weights[i], subjectId: "", bubbleBackground, bubbleGlowColor, bubbleExtraClass, orbitLineBackground };
  });
}

function pluralize(n, word) { return `${n} ${word}${n > 1 ? "s" : ""}`; }

function ariaLabelFor(item) {
  if (item.universeType === "galaxy") return `Ouvrir la galaxie ${item.label}, ${pluralize(item.ref.solarSystems.length, "système solaire")}`;
  if (item.universeType === "unclassifiedGroup") return `Ouvrir le groupe À classer, ${pluralize(item.ref.length, "article")}`;
  if (item.universeType === "solarSystem") return `Ouvrir le système solaire ${item.label}, ${pluralize(item.ref.stars.length, "étoile")}`;
  if (item.universeType === "star") return `Voir la liste de ${pluralize(item.ref.articleCount, "article")} sous ${item.label}`;
  if (item.universeType === "article") return `Ouvrir l'article ${item.label}`;
  return item.label;
}

function applyAriaLabels(items) {
  cloudEl.querySelectorAll(".agon-tag-bubble").forEach((bubble) => {
    const item = items[Number(bubble.dataset.bubbleIndex)];
    if (item) bubble.setAttribute("aria-label", ariaLabelFor(item));
  });
}

// Centre du nuage pour le niveau courant : null au niveau racine et pour "À classer" (bulles
// serrées les unes aux autres, sans trou central, cf. renderTagTrendCloud centerLabel). Niveau
// systèmes solaires (navPath = [galaxie]) : centre "trou noir" plutôt qu'une bulle pastel comme
// les autres (demande du 07/08/2026) — cf. blackHoleVisual. Niveau étoiles (navPath = [galaxie,
// systemId]) : centre = le système solaire lui-même, rendu "soleil" (cf. sunVisual, même demande),
// pour que ses étoiles gravitent visuellement autour d'un vrai astre lumineux.
function centerLabelForCurrentLevel() {
  if (!navPath.length || navPath[0] === UNCLASSIFIED_KEY) return null;
  if (navPath.length >= 2) {
    const solarSystem = getSolarSystemById(getGalaxyByName(navPath[0]), navPath[1]);
    // Pas de `background` ici : le bouton lui-même reste transparent, tout le rendu (cœur +
    // halo, un seul dégradé continu) est posé sur son ::before via --center-glow-color (cf.
    // tagTrendCloud.js/style.css .agon-tag-center-btn-sun) — voir sunVisual pour le pourquoi.
    return { label: solarSystem?.name || "Système", sun: true, glowColor: sunVisual(navPath[0]) };
  }
  // Même principe que ci-dessus (voir blackHoleVisual) : pas de `background`, tout passe par
  // --center-glow-color sur ::before (.agon-tag-center-btn-blackhole, style.css).
  return { label: navPath[0], blackHole: true, glowColor: blackHoleVisual(navPath[0]) };
}

// ---- Poussière d'étoiles autour des bulles système (niveau systèmes uniquement, demande du
// 07/08/2026) : petits points sans nom, en couronne autour de chaque bulle système, dont le
// nombre dépend du nombre d'étoiles qu'il contient (item.ref.stars.length) — jamais interactifs,
// jamais gérés par tagTrendCloud.js (générique) : une simple couche décorative ajoutée par-dessus
// une fois le placement des bulles terminé (positions déjà finalisées, mêmes coordonnées que
// drawOrbitLines). Bornée (2 à 10) pour rester lisible même pour un système à 1 ou à 40 étoiles.
const MINI_STAR_MIN = 2;
const MINI_STAR_MAX = 10;

function clearMiniStars() {
  cloudEl.querySelectorAll(".universe-mini-star").forEach((el) => el.remove());
}

// Obstacle "trou noir" (centre personnalisé du niveau systèmes, cf. tagTrendCloud.js
// applyCompactBubbleLayout — même calcul de centerX/centerY/rayon reproduit ici à l'identique)
// : sert à écarter la poussière d'étoiles d'un système trop proche du centre pour qu'aucun
// point ne se retrouve superposé au trou noir (demande du 07/08/2026).
function getCenterObstacle() {
  const centerBtnEl = cloudEl.querySelector(".agon-tag-center-btn-custom");
  const r = centerBtnEl ? (parseFloat(centerBtnEl.dataset.centerRadius) || 0) : 0;
  if (!centerBtnEl || !r) return null;
  const containerW = cloudEl.clientWidth || 0;
  const containerH = cloudEl.clientHeight || 0;
  if (!containerW || !containerH) return null;
  const frameTopRaw = getComputedStyle(cloudEl).getPropertyValue("--bubble-frame-top").trim();
  const frameTop = parseFloat(frameTopRaw) || 55;
  const isMobile = window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
  const frameBottomInset = isMobile ? 78 : 23;
  return {
    x: containerW / 2,
    y: (frameTop + (containerH - frameBottomInset)) / 2,
    r
  };
}

function drawMiniStarsForSystems(items) {
  clearMiniStars();
  // Uniquement au niveau systèmes (navPath = [galaxie]) : au niveau galaxies/étoiles/articles,
  // ces bulles ne sont pas des systèmes solaires, rien à faire graviter autour.
  if (navPath.length !== 1 || navPath[0] === UNCLASSIFIED_KEY) return;

  const centerObstacle = getCenterObstacle();
  const bubbles = [...cloudEl.querySelectorAll(".agon-tag-bubble")];
  items.forEach((item, i) => {
    if (item.universeType !== "solarSystem") return;
    const bubble = bubbles[i];
    if (!bubble) return;
    const size = parseFloat(bubble.style.getPropertyValue("--agon-tag-bubble-size")) || 0;
    const left = parseFloat(bubble.style.left);
    const top = parseFloat(bubble.style.top);
    if (!size || Number.isNaN(left) || Number.isNaN(top)) return;
    const r = size / 2;
    const cx = left + r;
    const cy = top + r;

    const count = Math.max(MINI_STAR_MIN, Math.min(MINI_STAR_MAX, item.ref.stars.length));
    for (let s = 0; s < count; s += 1) {
      // Décalage par système (i * 0.7 rad) pour que deux systèmes voisins n'affichent jamais
      // leurs points strictement alignés les uns sur les autres.
      const angle = (s / count) * Math.PI * 2 + i * 0.7;
      const dist = r + 10 + Math.random() * 16;
      // Taille encore relevée (demande du 08/08/2026, "beaucoup plus grosses/lumineuses") —
      // déjà montée une première fois le 07/08/2026 (2-4.5px → 4.5-8.5px, invisibles à taille
      // normale) ; cette 2e passe double encore la plage.
      const dotSize = 10 + Math.random() * 8;
      let dotX = cx + Math.cos(angle) * dist;
      let dotY = cy + Math.sin(angle) * dist;

      // Système placé près du trou noir (obstacle central) : un point tiré côté centre peut
      // tomber dessus. On le repousse radialement (depuis le trou noir, pas depuis le système)
      // juste hors de son rayon plutôt que de le supprimer, pour garder le même nombre de points.
      if (centerObstacle) {
        const dxCenter = dotX - centerObstacle.x;
        const dyCenter = dotY - centerObstacle.y;
        const distToCenter = Math.hypot(dxCenter, dyCenter);
        const minDist = centerObstacle.r + dotSize / 2 + 6;
        if (distToCenter < minDist) {
          const angleFromCenter = distToCenter > 0.01 ? Math.atan2(dyCenter, dxCenter) : angle;
          dotX = centerObstacle.x + Math.cos(angleFromCenter) * minDist;
          dotY = centerObstacle.y + Math.sin(angleFromCenter) * minDist;
        }
      }

      const dot = document.createElement("span");
      dot.className = "universe-mini-star";
      dot.style.left = Math.round(dotX - dotSize / 2) + "px";
      dot.style.top = Math.round(dotY - dotSize / 2) + "px";
      dot.style.width = dotSize + "px";
      dot.style.height = dotSize + "px";
      dot.style.opacity = String(0.7 + Math.random() * 0.3);
      cloudEl.appendChild(dot);
    }
  });
}

// Redessine la poussière d'étoiles après un redimensionnement (le ResizeObserver interne de
// tagTrendCloud.js recalcule alors les positions des bulles système, cf. layoutTagTrendCloud) —
// délai (180ms) volontairement supérieur au sien (120ms, cf. tagTrendCloud.js) pour repartir des
// positions déjà réactualisées plutôt que des anciennes.
if (typeof ResizeObserver !== "undefined") {
  let miniStarResizeTimer = null;
  new ResizeObserver(() => {
    if (!isMemoireEmbedActive()) return;
    clearTimeout(miniStarResizeTimer);
    miniStarResizeTimer = setTimeout(() => drawMiniStarsForSystems(currentLevelItems), 180);
  }).observe(cloudEl);
}

// ---- Petites lunes en orbite autour de certaines étoiles (autre décoration subtile, demande du
// 07/08/2026 : "met d'autres décorations subtiles en mode étoile") : 1 ou 2 disques ombrés
// (cf. .universe-star-moon, style.css), plus près de la bulle que l'anneau — un vrai système
// planète/lune/anneau peut avoir les deux à la fois, jamais géré par tagTrendCloud.js.
const STAR_MOON_CHANCE = 0.35;

function clearStarMoons() {
  cloudEl.querySelectorAll(".universe-star-moon").forEach((el) => el.remove());
}

function drawMoonsForStars(items) {
  clearStarMoons();
  if (navPath.length !== 2) return;

  const bubbles = [...cloudEl.querySelectorAll(".agon-tag-bubble")];
  items.forEach((item, i) => {
    if (item.universeType !== "star") return;
    if (Math.random() > STAR_MOON_CHANCE) return;
    const bubble = bubbles[i];
    if (!bubble) return;
    const size = parseFloat(bubble.style.getPropertyValue("--agon-tag-bubble-size")) || 0;
    const left = parseFloat(bubble.style.left);
    const top = parseFloat(bubble.style.top);
    if (!size || Number.isNaN(left) || Number.isNaN(top)) return;
    const r = size / 2;
    const cx = left + r;
    const cy = top + r;

    const moonCount = Math.random() < 0.28 ? 2 : 1;
    for (let m = 0; m < moonCount; m += 1) {
      const angle = Math.random() * Math.PI * 2;
      const dist = r + 9 + Math.random() * 9;
      const moonSize = 3.5 + Math.random() * 3;
      const moon = document.createElement("span");
      moon.className = "universe-star-moon";
      moon.style.left = Math.round(cx + Math.cos(angle) * dist - moonSize / 2) + "px";
      moon.style.top = Math.round(cy + Math.sin(angle) * dist - moonSize / 2) + "px";
      moon.style.width = moonSize + "px";
      moon.style.height = moonSize + "px";
      cloudEl.appendChild(moon);
    }
  });
}

// ---- Scintillements ponctuels près de quelques étoiles (dernière décoration subtile, même
// demande) : petit éclat en croix (façon étoile filante/reflet d'objectif), très discret, sur
// une minorité d'étoiles seulement pour ne jamais surcharger la vue.
const STAR_SPARKLE_CHANCE = 0.22;

function clearStarSparkles() {
  cloudEl.querySelectorAll(".universe-star-sparkle").forEach((el) => el.remove());
}

function drawSparklesForStars(items) {
  clearStarSparkles();
  if (navPath.length !== 2) return;

  const bubbles = [...cloudEl.querySelectorAll(".agon-tag-bubble")];
  items.forEach((item, i) => {
    if (item.universeType !== "star") return;
    if (Math.random() > STAR_SPARKLE_CHANCE) return;
    const bubble = bubbles[i];
    if (!bubble) return;
    const size = parseFloat(bubble.style.getPropertyValue("--agon-tag-bubble-size")) || 0;
    const left = parseFloat(bubble.style.left);
    const top = parseFloat(bubble.style.top);
    if (!size || Number.isNaN(left) || Number.isNaN(top)) return;
    const r = size / 2;
    const cx = left + r;
    const cy = top + r;

    const angle = Math.random() * Math.PI * 2;
    const dist = r + 14 + Math.random() * 14;
    const sparkleSize = 10 + Math.random() * 6;
    const sparkle = document.createElement("span");
    sparkle.className = "universe-star-sparkle";
    sparkle.style.left = Math.round(cx + Math.cos(angle) * dist - sparkleSize / 2) + "px";
    sparkle.style.top = Math.round(cy + Math.sin(angle) * dist - sparkleSize / 2) + "px";
    sparkle.style.width = sparkleSize + "px";
    sparkle.style.height = sparkleSize + "px";
    cloudEl.appendChild(sparkle);
  });
}

if (typeof ResizeObserver !== "undefined") {
  let starDecorResizeTimer = null;
  new ResizeObserver(() => {
    if (!isMemoireEmbedActive()) return;
    clearTimeout(starDecorResizeTimer);
    starDecorResizeTimer = setTimeout(() => {
      drawMoonsForStars(currentLevelItems);
      drawSparklesForStars(currentLevelItems);
    }, 180);
  }).observe(cloudEl);
}

// ---- Rendu du niveau courant : réutilise renderTagTrendCloud tel quel (placement compact,
// anti-collision, auto-scale, labels — rien de tout ça n'est réimplémenté ici). maxBubbles =
// items.length : aucune galaxie/système/étoile tronquée silencieusement. ----
function renderLevelNow() {
  const items = buildLevelItems();
  currentLevelItems = items;
  renderBreadcrumb();
  updateBackButtonVisibility();

  if (!items.length) {
    // Cas défensif (ex. galaxie disparue entre deux navigations locales) : retombe au niveau
    // galaxies plutôt que d'afficher un écran vide sans issue.
    if (navPath.length) { navPath = []; renderLevelNow(); return; }
    showStatus("empty");
    return;
  }
  showStatus("none");

  const trends = buildTrendsForItems(items);
  const centerLabel = centerLabelForCurrentLevel();
  // Espacement supplémentaire : au niveau galaxies (racine) pour laisser voir le fond étoilé
  // entre les bulles, cf. renderTagTrendCloud bubbleGap (demande du 06/08/2026) — et au niveau
  // étoiles (centre "soleil" uniquement, pas le "trou noir" des systèmes, demande du 07/08/2026 :
  // le trait de liaison ne concerne que la dernière étape) pour garder un vrai espace visible
  // entre le soleil et ses étoiles. Sans cet espace (bubbleGap=0), le placement laisse les bulles
  // quasiment toucher le centre (tolérance de -4px, cf. placeBubbleNear) et le trait, trop court,
  // est alors filtré par drawOrbitLines (lineLength <= 4).
  const bubbleGap = !navPath.length ? 16 : (centerLabel?.sun ? 14 : 0);
  try {
    renderTagTrendCloud(cloudEl, trends, () => {
      applyAriaLabels(items);
      // try/catch dédié : une couche décorative qui plante ici (ex. variable manquante) ne doit
      // jamais empêcher le retrait de universe-cloud--transitioning juste en dessous, sinon tout
      // le nuage reste bloqué à opacity:0 — confirmé le 07/08/2026 ("je ne vois plus d'étoiles du
      // tout"), causé par un bug dans une décoration qui empêchait ce retrait.
      try {
        drawMiniStarsForSystems(items);
        drawMoonsForStars(items);
        drawSparklesForStars(items);
      } catch (error) {
        console.warn("[mon-univers] décorations interrompues :", error.message);
      }
      cloudEl.classList.remove("universe-cloud--transitioning");
      if (isMemoireEmbedActive()) window.__agonHideBubbleCloudLoadingSpinner?.();
    }, items.length, centerLabel, bubbleGap);
  } catch (error) {
    console.warn("[mon-univers] rendu du nuage interrompu :", error.message);
    cloudEl.classList.remove("universe-cloud--transitioning");
    if (isMemoireEmbedActive()) window.__agonHideBubbleCloudLoadingSpinner?.();
  }
}

// Zoom léger (opacity/scale, cf. style.css #agon-universe-cloud.universe-cloud--transitioning)
// avant de vider et re-rendre les bulles du niveau suivant.
function goToLevel(newPath) {
  hideStarPanel();
  cloudEl.classList.add("universe-cloud--transitioning");
  window.setTimeout(() => {
    navPath = newPath;
    renderLevelNow();
  }, 160);
}

function handleItemActivate(item) {
  if (item.universeType === "galaxy") { goToLevel([item.ref.name]); return; }
  if (item.universeType === "unclassifiedGroup") { goToLevel([UNCLASSIFIED_KEY]); return; }
  // Clic sur un système solaire : zoome sur ses étoiles (navPath = [galaxie, systemId]),
  // cf. buildLevelItems. navPath[0] est déjà la galaxie courante à ce niveau.
  if (item.universeType === "solarSystem") { goToLevel([navPath[0], item.ref.id]); return; }
  // Une étoile ne zoome jamais sur un niveau de bulles supplémentaire : elle peut regrouper
  // plusieurs articles (ex. "Tour de France 2026"), affichés dans un panneau liste simple.
  if (item.universeType === "star") { showStarPanel(item.ref); return; }
  if (item.universeType === "article") {
    const url = item.ref.url;
    if (url && /^https?:\/\//i.test(String(url))) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    // URL absente/invalide : aucune action, jamais d'erreur visible pour l'utilisateur.
  }
}

// ---- Panneau liste (niveau étoile) ----
const starPanelEl = document.getElementById("universe-star-panel");
const starPanelTitleEl = document.getElementById("universe-star-panel-title");
const starPanelListEl = document.getElementById("universe-star-panel-list");
const starPanelCloseBtn = document.getElementById("universe-star-panel-close");
const starPanelBackdropEl = document.getElementById("universe-star-panel-backdrop");

function formatAcquiredAt(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function showStarPanel(star) {
  starPanelTitleEl.textContent = star.name || "Étoile";
  starPanelListEl.innerHTML = "";

  (star.articles || []).forEach((article) => {
    const hasUrl = article.url && /^https?:\/\//i.test(String(article.url));
    const el = document.createElement(hasUrl ? "a" : "span");
    el.className = "universe-star-panel__item";
    if (hasUrl) {
      el.href = article.url;
      el.target = "_blank";
      el.rel = "noopener noreferrer";
    }

    const title = document.createElement("p");
    title.className = "universe-star-panel__item-title";
    title.textContent = article.title || "Article";
    el.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "universe-star-panel__item-meta";
    const metaParts = [article.source, formatAcquiredAt(article.acquiredAt)].filter(Boolean);
    metaParts.forEach((part) => {
      const span = document.createElement("span");
      span.textContent = part;
      meta.appendChild(span);
    });
    if (metaParts.length) el.appendChild(meta);

    starPanelListEl.appendChild(el);
  });

  starPanelEl.hidden = false;
}

function hideStarPanel() {
  starPanelEl.hidden = true;
}

starPanelCloseBtn.addEventListener("click", hideStarPanel);
starPanelBackdropEl.addEventListener("click", hideStarPanel);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !starPanelEl.hidden) hideStarPanel();
});

// #agon-memoire-embed-before n'existe QUE sur l'accueil (embed "Ma mémoire", demande du
// 08/08/2026) : absent sur la page /mon-univers autonome (donc toujours "actif" là-bas). Sur
// l'accueil, ce même #agon-tag-trends-cloud est PARTAGÉ avec Bulles Actu/Bulles Agôn (cf.
// cloudEl plus haut, repli sur #agon-tag-trends-cloud) — sans cette vérification, le listener
// posé une seule fois ci-dessous resterait actif pour toujours après une seule visite en mode
// "Ma mémoire", et stopPropagation() empêcherait alors les clics sur les vraies bulles Actu/Agôn
// d'atteindre le listener global de script.js (plus aucune bulle Actu/Agôn cliquable).
function isMemoireEmbedActive() {
  const marker = document.getElementById("agon-memoire-embed-before");
  return !marker || !marker.hidden;
}

// Clic intercepté au niveau du conteneur (jamais sur document) + stopPropagation : empêche le
// listener global de public/script.js (.agon-tag-bubble -> handleBubbleTagClick, spécifique aux
// débats) de voir cet événement. Les bulles créées par renderTagTrendCloud sont de vrais
// <button> : Entrée et Espace déclenchent déjà nativement ce même "click", aucun code clavier
// supplémentaire nécessaire.
cloudEl.addEventListener("click", (event) => {
  if (!isMemoireEmbedActive()) return;
  const bubble = event.target.closest(".agon-tag-bubble");
  if (!bubble) return;
  event.stopPropagation();
  const item = currentLevelItems[Number(bubble.dataset.bubbleIndex)];
  if (item) handleItemActivate(item);
});

// ---- Fil d'Ariane ----
function renderBreadcrumb() {
  breadcrumbEl.innerHTML = "";
  const crumbs = [{ label: "Ma mémoire", path: [] }];

  if (navPath[0] === UNCLASSIFIED_KEY) {
    crumbs.push({ label: "À classer", path: [UNCLASSIFIED_KEY] });
  } else if (navPath.length >= 1) {
    crumbs.push({ label: navPath[0], path: [navPath[0]] });
    if (navPath.length >= 2) {
      const solarSystem = getSolarSystemById(getGalaxyByName(navPath[0]), navPath[1]);
      crumbs.push({ label: solarSystem?.name || "Système solaire", path: [navPath[0], navPath[1]] });
    }
  }

  crumbs.forEach((crumb, i) => {
    const isLast = i === crumbs.length - 1;
    if (isLast) {
      const span = document.createElement("span");
      span.className = "universe-breadcrumb__item universe-breadcrumb__item--current";
      span.textContent = crumb.label;
      span.setAttribute("aria-current", "page");
      breadcrumbEl.appendChild(span);
      return;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "universe-breadcrumb__item";
    btn.textContent = crumb.label;
    btn.addEventListener("click", () => goToLevel(crumb.path));
    breadcrumbEl.appendChild(btn);
    const sep = document.createElement("span");
    sep.className = "universe-breadcrumb__sep";
    sep.textContent = "›";
    sep.setAttribute("aria-hidden", "true");
    breadcrumbEl.appendChild(sep);
  });
}

function updateBackButtonVisibility() {
  backBtn.classList.toggle("is-visible", navPath.length > 0);
}
backBtn.addEventListener("click", () => {
  if (!navPath.length) return;
  goToLevel(navPath.slice(0, -1));
});

// ---- États de page ----
function showStatus(kind) {
  // Sur l'accueil uniquement, la légende sous le sélecteur répète inutilement le rôle du
  // message d'état lorsque l'univers est vide. On la masque dans cet état précis, puis on la
  // réaffiche dès qu'un niveau peut être rendu (ou si le chargement échoue). La page autonome
  // /mon-univers n'a pas ce marqueur ni cette légende partagée.
  const embeddedMarker = document.getElementById("agon-memoire-embed-before");
  const embeddedCaption = embeddedMarker
    ? document.querySelector("#agon-tag-trends-section .agon-tag-trends-caption")
    : null;
  if (embeddedCaption && kind === "empty") embeddedCaption.hidden = true;
  if (embeddedCaption && (kind === "none" || kind === "error")) embeddedCaption.hidden = false;

  if (kind === "none") {
    statusEl.hidden = true;
    cloudEl.hidden = false;
    return;
  }

  // "loading"/"empty" gardent le cadre visible (fond/bordure décorative, cf.
  // .agon-memoire-frame.agon-tag-trends-cloud::before/::after) dès le clic sur "Ma mémoire",
  // plutôt que d'attendre la fin du chargement (fetch + import du module) pour l'afficher —
  // demande du 09/08/2026, "le cadre et le fond ne sont plus là directement, ils arrivent
  // furtivement après. Je veux qu'ils soient là directement". Seul "error" masque encore le
  // cloud (rien à montrer dans le cadre dans ce cas, le message d'erreur suffit).
  cloudEl.hidden = kind === "error";
  statusEl.hidden = false;
  statusEl.innerHTML = "";

  if (kind === "loading") {
    // Sur l'accueil, le sablier dans le cadre remplace ce texte pour reproduire exactement
    // le chargement Bulles Actu/Agôn. La page /mon-univers autonome garde son texte habituel.
    if (document.getElementById("agon-memoire-embed-before")) {
      statusEl.hidden = true;
      return;
    }
    statusEl.textContent = "Chargement de ton univers…";
  } else if (kind === "empty") {
    const p = document.createElement("p");
    p.innerHTML = "Ton univers est encore vide.<br>Réponds correctement au QCM Culture Générale pour faire apparaître tes premières étoiles.";
    statusEl.appendChild(p);
  } else if (kind === "error") {
    const p = document.createElement("p");
    p.textContent = "Impossible de charger ton univers pour le moment.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "universe-status__retry";
    retry.textContent = "Réessayer";
    retry.addEventListener("click", loadUniverse);
    statusEl.append(p, retry);
  }

  if (kind === "empty" || kind === "error") {
    if (isMemoireEmbedActive()) window.__agonHideBubbleCloudLoadingSpinner?.();
  }
}

function isUniverseEmpty(data) {
  return (!data?.galaxies || !data.galaxies.length) && (!data?.unclassified || !data.unclassified.length);
}

// ---- Jeu de données de démonstration (?demo=1 dans l'URL) : reproduit à la demande sans
// dépendre d'un historique de QCM réel (donc testable en navigation privée, sans les
// complications de cache/identité anonyme d'une vraie session) — inclut volontairement des noms
// très courts ("Kairos") et très longs ("Philosophie et sciences sociales") au même niveau pour
// stress-tester le placement des bulles. Jamais chargé sans ce paramètre explicite, aucune
// incidence sur le comportement normal.
function buildDemoUniverseData() {
  const demoArticle = (title) => ({ title, url: "https://example.com/" + encodeURIComponent(title) });
  const demoStar = (name, articleCount) => ({
    name,
    articleCount,
    articles: Array.from({ length: articleCount }, (_, i) => demoArticle(name + " — article " + (i + 1)))
  });
  return {
    galaxies: [
      {
        name: "Philosophie",
        solarSystems: [
          {
            id: "demo-1",
            name: "Philosophie et sciences sociales",
            stars: [demoStar("Kairos", 3), demoStar("Éthique appliquée", 5), demoStar("Phénoménologie du quotidien", 2)]
          },
          {
            id: "demo-2",
            name: "Kairos",
            stars: [demoStar("Stoïcisme", 4), demoStar("Le temps qui presse", 2)]
          }
        ]
      },
      {
        name: "Sciences - technologie",
        solarSystems: [
          {
            id: "demo-3",
            name: "Espace et technologies spatiales",
            stars: [
              demoStar("22° sans clim", 6),
              demoStar("Fusée", 1),
              demoStar("Satellites basse orbite", 2),
              demoStar("Exploration martienne", 3),
              demoStar("IA", 8)
            ]
          },
          { id: "demo-4", name: "IA", stars: [demoStar("Modèles de langage", 5), demoStar("Robots", 2)] }
        ]
      },
      {
        name: "Histoire",
        solarSystems: [
          { id: "demo-5", name: "Antiquité", stars: [demoStar("Rome", 4), demoStar("Grèce", 3)] }
        ]
      }
    ],
    unclassified: [demoArticle("Article non classé exemple")]
  };
}

// ---- Chargement (un seul appel, jamais relancé au changement de niveau) ----
async function loadUniverse() {
  // Jeton partagé avec script.js (toggleAgonCloud/setPoliticalCloudGroup/setMemoireCloudMode) :
  // si l'utilisateur repart sur Bulles Actu/Agôn pendant que ce fetch est encore en vol (réseau
  // lent), window._agonCloudModeToken aura changé à la résolution ci-dessous — sans cette
  // vérification, le rendu de "Ma mémoire" arrivait en retard et écrasait les bulles
  // Actu/Agôn déjà affichées entre-temps sur le conteneur partagé (demande du 09/08/2026,
  // "ça mélange encore les univers des trois bulles", "ça le fait parfois mais pas tout le
  // temps" — confirme une course, pas un bug systématique).
  const modeToken = window._agonCloudModeToken;

  breadcrumbEl.innerHTML = "";
  backBtn.classList.remove("is-visible");
  showStatus("loading");

  const isDemo = new URLSearchParams(location.search).get("demo") === "1";
  if (isDemo) {
    universeData = buildDemoUniverseData();
    navPath = [];
    if (modeToken !== window._agonCloudModeToken) return;
    renderLevelNow();
    return;
  }

  try {
    const response = await fetch(`/api/users/intellectual-universe?legacyKey=${encodeURIComponent(getKey())}`);
    if (!response.ok) throw new Error("http " + response.status);
    universeData = await response.json();
  } catch (error) {
    console.warn("[mon-univers] chargement échoué :", error.message);
    if (modeToken !== window._agonCloudModeToken) return;
    showStatus("error");
    return;
  }

  if (modeToken !== window._agonCloudModeToken) return;

  if (isUniverseEmpty(universeData)) {
    showStatus("empty");
    return;
  }

  navPath = [];
  renderLevelNow();
}

loadUniverse();

// Ré-exécuté par script.js (setMemoireCloudMode) à chaque retour sur "Ma mémoire" après le
// tout premier passage : l'import dynamique n'évalue ce module qu'une seule fois (mis en cache
// via _memoireModuleLoadPromise), donc le loadUniverse() ci-dessus, en haut de fichier, ne
// s'exécute lui aussi qu'une seule fois — sans cet export, repasser sur "Ma mémoire" après être
// allé sur Bulles Actu/Agôn laissait leurs bulles (avec leurs propres satellites) telles quelles
// à l'écran au lieu de les remplacer par les bulles galaxies/systèmes/étoiles (demande du
// 09/08/2026, "ça mélange tout").
// Reclique sur l'onglet "Ma mémoire" (script.js) alors qu'on y est déjà, à un niveau profond
// (galaxie/système) : ramène à la racine (galaxies), comme un clic sur le premier crumb du fil
// d'Ariane (cf. renderBreadcrumb, crumbs[0] = {label:"Ma mémoire", path:[]}) — demande du
// 09/08/2026. Rien si déjà à la racine (évite une transition vide).
function resetToRoot() {
  if (navPath.length) goToLevel([]);
}

export { loadUniverse as reinitMemoireEmbed, resetToRoot };
