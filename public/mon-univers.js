// Page "Mon univers" : zoom spatial réel (demande du 13/08/2026) — galaxies, systèmes solaires
// et étoiles sont positionnés une seule fois dans un même espace de coordonnées persistant
// (cf. /universe-zoom.js, layoutUniverseWorld), et une caméra (pan/zoom continu, molette,
// pincement, glisser-déposer) parcourt cette scène plutôt que de remplacer tout l'écran à
// chaque clic. Remplace l'ancien modèle "un niveau = tout l'écran" qui réutilisait
// tagTrendCloud.js (recalculait les positions à chaque clic, sans mémoire spatiale entre
// niveaux) — tagTrendCloud.js n'est plus utilisé ici, jamais touché : il reste utilisé tel
// quel par les bulles Agôn/Actu (public/script.js), sans rapport avec ce chantier.
// Volontairement léger — pas de chargement de script.js (qui alourdirait la page pour un seul
// besoin : getKey(), reproduite ici à l'identique, cf. script.js getKey()/lsGet()).
import { layoutUniverseWorld, createUniverseCamera } from "/universe-zoom.js?v=20260813-pan-clamped";

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

// Saturation commune, luminosité des 3 arrêts du dégradé — jamais recalculée par galaxie.
// Système solaire nettement plus lumineux que l'étoile : le système reste le conteneur visuel
// de ses étoiles dans le nouveau modèle imbriqué, l'étoile une simple bulle satellite à
// l'intérieur.
const GALAXY_GRADIENT_LEVELS = {
  galaxy: [82, 72, 60],
  solarSystem: [95, 91, 85],
  star: [76, 66, 54]
};
// fadeEdge : les 2 derniers arrêts perdent progressivement leur opacité au lieu de rester
// pleins jusqu'à 100% — sans lui, même en retirant le contour, le dégradé plein s'arrêtait net
// à la même place, donnant l'impression d'une "rupture".
function bubbleBackgroundFor(galaxyName, level, fadeEdge = false) {
  const hue = hueForGalaxy(galaxyName);
  const stops = GALAXY_GRADIENT_LEVELS[level];
  const s = 12;
  const tail = fadeEdge
    ? `hsla(${hue}, ${s}%, ${stops[1]}%, 0.75) 78%, hsla(${hue}, ${s}%, ${stops[2]}%, 0.35) 90%, hsla(${hue}, ${s}%, ${stops[2]}%, 0) 100%`
    : `hsl(${hue} ${s}% ${stops[2]}%) 100%`;
  // closest-side (seulement quand fadeEdge) : sans mot-clé de taille, un radial-gradient prend
  // par défaut farthest-corner, bien au-delà du bord réellement visible (coupé par
  // border-radius:50%) — closest-side cale 100% exactement sur le bord visible.
  // circle (pas ellipse) centré à 50%/50% quand fadeEdge : garantit un rayon identique dans
  // toutes les directions, donc un alpha 0 pile sur le bord partout.
  const shape = fadeEdge ? "circle closest-side at 50% 50%" : "ellipse at 38% 32%";
  return `radial-gradient(${shape}, rgba(255,255,255,1) 0%, hsl(${hue} ${s}% ${stops[0]}%) 40%, hsl(${hue} ${s}% ${stops[1]}%) 70%, ${tail})`;
}

// "À classer" (aucune galaxie à colorer) : même bleuté que le dégradé par défaut de
// .agon-tag-bubble, avec le même fondu en alpha vers le bord que les autres niveaux.
const UNCLASSIFIED_BUBBLE_BACKGROUND = `radial-gradient(circle closest-side at 50% 50%, rgba(255,255,255,1) 0%, rgba(235,242,255,1) 40%, rgba(210,225,248,0.85) 70%, rgba(185,208,240,0.35) 88%, rgba(185,208,240,0) 100%)`;

// Bulles galaxie : rendu "nœud de neurone" très lumineux plutôt qu'un simple disque pastel —
// cœur très brillant + fines lignes rayonnantes façon synapses/dendrites, halo qui déborde du
// cercle (cf. .agon-tag-bubble-galaxy, style.css). Le dégradé de base (bubbleBackgroundFor)
// reste identique en dessous pour garder la même teinte que les systèmes/étoiles filles ; ces
// couches viennent seulement s'ajouter par-dessus.

function pointsToPathD(points) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
}

// Découpe chaque ligne en paliers de largeur décroissante (base épaisse près du centre ->
// pointe fine en bout de queue) — un <path> SVG a une seule stroke-width fixe sur toute sa
// longueur, impossible de la faire varier autrement qu'en dessinant plusieurs segments avec des
// largeurs différentes. Chevauchement d'1 point entre segments consécutifs : sans lui, une
// micro-coupure apparaîtrait à chaque jonction.
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

// Points d'une "synapse" (ligne rayonnant depuis le centre) : angle fixe (angle d'or) et
// longueur variée selon l'angle lui-même (déterministe, jamais Math.random, pour un rendu
// stable). Léger arc plutôt qu'une ligne parfaitement droite, pour une allure de dendrite qui
// ondule légèrement plutôt qu'un trait au cordeau.
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

// Nœud de neurone : synapses rayonnantes émanant d'un cœur très lumineux (cf. galaxyBubbleVisual
// juste en dessous, qui superpose ce cœur par-dessus).
function neuronLinesBackground(hue) {
  const linePointSets = buildNeuronLinePoints(hue);
  const stroke = `hsl(${hue}, 20%, 85%)`;
  // Opacités réduites d'~30% (demande du 13/08/2026, "réduire l'intensité
  // lumineuse des galaxies") : 0.3/0.47/0.68 → 0.2/0.32/0.46, même structure
  // (couleurs/rayons de flou inchangés) pour garder le même dessin de
  // synapses, juste moins lumineux.
  const outerGlowPaths = linePointSets
    .map((points) => buildTaperedPathSegments(points, 20, 0.25, 5, `stroke="${stroke}" stroke-linecap="round" opacity="0.2" filter="url(#neuronGlowOuter)"`))
    .join("");
  const innerGlowPaths = linePointSets
    .map((points) => buildTaperedPathSegments(points, 12, 0.25, 5, `stroke="${stroke}" stroke-linecap="round" opacity="0.32" filter="url(#neuronGlowInner)"`))
    .join("");
  const coreStroke = `hsl(${hue}, 10%, 97%)`;
  const corePaths = linePointSets
    .map((points) => buildTaperedPathSegments(points, 6, 0.2, 5, `stroke="${coreStroke}" stroke-linecap="round" opacity="0.46" filter="url(#neuronGlowCore)"`))
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><defs>`
    + `<filter id="neuronGlowOuter" x="-90%" y="-90%" width="280%" height="280%"><feGaussianBlur stdDeviation="5.5"/></filter>`
    + `<filter id="neuronGlowInner" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.8"/></filter>`
    + `<filter id="neuronGlowCore" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.4"/></filter>`
    + `</defs>${outerGlowPaths}${innerGlowPaths}${corePaths}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") center / 45% 45% no-repeat`;
}

function galaxyBubbleVisual(galaxyName) {
  const hue = hueForGalaxy(galaxyName);
  const lines = neuronLinesBackground(hue);
  // Cœur et halo également réduits d'~30% (demande du 13/08/2026) — alpha du
  // centre blanc et de la teinte de fin de dégradé abaissés, glowColor (repris
  // par .agon-tag-bubble-galaxy::before, style.css) idem.
  const core = `radial-gradient(ellipse 24% 24% at 50% 50%, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.55) 26%, hsl(${hue} 22% 90%) 50%, hsla(${hue}, 20%, 85%, 0.2) 68%, transparent 84%)`;
  return {
    background: `${core}, ${lines}`,
    glowColor: `hsla(${hue}, 25%, 85%, 0.5)`
  };
}

// ---- État local : un seul appel API, puis un seul calcul de scène (jamais recalculé à la
// navigation, seule la caméra bouge) ----
let universeData = null;
let worldLayout = null; // { galaxies, solarSystems, stars, worldRadius } — cf. layoutUniverseWorld
let camera = null;
let worldEl = null;
let viewportEl = null;
// Couche des libellés, EN DEHORS de worldEl (jamais affectée par son transform:scale) — un
// libellé positionné en coordonnées écran (left/top recalculés à chaque frame de caméra, cf.
// onCameraChange) plutôt qu'un contre-scale CSS (transform:scale(1/cam-scale)) imbriqué dans un
// monde déjà mis à l'échelle : ce contre-scale imbriqué produisait un texte flou à fort zoom
// (le compositeur recompose un bitmap agrandi puis rétréci au lieu de re-rasteriser le texte à
// sa taille finale) — signalé le 13/08/2026 par capture d'écran, très net à ×20-40.
let labelsOverlayEl = null;
// Recalcule sizeUniverseBackground() au redimensionnement du cadre (rotation mobile, fenêtre
// redimensionnée) : sa taille en dur (px) ne suit sinon plus le cadre réel, cf. mountUniverse.
let universeBgResizeObserver = null;
const labelElByNodeId = new Map();
// Traits connecteurs étoile -> système solaire (demande du 13/08/2026) : enfants de worldEl
// (pas de la couche des libellés), donc mis à l'échelle avec la scène comme les bulles — pas
// besoin d'une précision de rendu façon texte, une ligne reste lisible même mise à l'échelle.
const connectorElByNodeId = new Map();
const nodeById = new Map(); // id (cf. layoutUniverseWorld) -> nœud positionné, reconstruit à chaque scène

// Repli sur #agon-tag-trends-cloud (bulles "Ma mémoire" embarquées sur l'accueil, même cadre
// que Bulles Actu/Bulles Agôn) — la page /mon-univers autonome a bien son propre
// #agon-universe-cloud, jamais affecté par ce repli.
const cloudEl = document.getElementById("agon-universe-cloud") || document.getElementById("agon-tag-trends-cloud");
const breadcrumbEl = document.getElementById("universe-breadcrumb");
const statusEl = document.getElementById("universe-status");
const backBtn = document.getElementById("universe-back-btn");

function getGalaxyByName(name) {
  return (universeData?.galaxies || []).find((g) => g.name === name) || null;
}
function getSolarSystemById(galaxy, id) {
  return (galaxy?.solarSystems || []).find((s) => String(s.id) === String(id)) || null;
}

// ---- Seuils de révélation : une bulle système/étoile n'apparaît (et ne devient cliquable) que
// lorsque SON PROPRE rayon à l'écran dépasse REVEAL_PX_SELF ET que son PARENT DIRECT a déjà cédé
// la place à ses enfants (cf. childrenCanShow, plus bas — dérivé du même REVEAL_PX_SELF, jamais
// un seuil indépendant sur le rayon du parent lui-même : cf. son commentaire pour la raison).
// Hiérarchie stricte à 3 niveaux demandée explicitement (13/08/2026) : sans le filtre par
// parent, un jeu de données avec peu d'éléments par niveau pouvait faire franchir le seuil de
// taille aux 3 niveaux en même temps dès la vue d'ensemble — les étoiles, peintes en dernier
// donc par-dessus, masquaient alors visuellement galaxies/systèmes en dessous.
const REVEAL_PX_SELF = 30; // rayon à l'écran minimum pour qu'une bulle système/étoile s'affiche

// Dimensions réelles de public/universe-bg.jpg (1536x1024, vérifié via `sips`) — nécessaires pour
// reproduire à la main le calcul de "background-size: cover" (cf. sizeUniverseBackground). Fixe
// : ne varie que si le fichier image est remplacé (bumper alors aussi son ?v=).
const UNIVERSE_BG_NATURAL_W = 1536;
const UNIVERSE_BG_NATURAL_H = 1024;

// .universe-zoom-background est volontairement bien plus grand que le cadre visible (cf.
// style.css, inset:-150%) pour absorber le panoramique sans jamais révéler son propre bord.
// Problème : "background-size: cover" pur se recalcule sur CETTE boîte agrandie, pas sur le
// cadre — l'image apparaissait alors bien plus zoomée qu'avant (signalé le 13/08/2026, capture
// d'écran, à deux reprises : une 1ère fois avec cover sur la boîte agrandie, une 2e avec
// background-size:100vw/100vh — plus grand que le cadre lui-même, donc encore trop zoomé). On
// calcule donc ICI, à la main, la taille que "cover" donnerait pour une boîte de la taille RÉELLE
// du cadre (viewportEl, pas la boîte agrandie), puis on pose cette taille en dur (px) sur la
// boîte agrandie : le rendu au repos est alors identique pixel pour pixel à l'ancien fond fixe
// (#agon-universe-cloud::after). Retourne ces dimensions (plutôt que de les garder locales) :
// camera.setBackgroundSize (universe-zoom.js) en a besoin pour plafonner le panoramique pile là
// où ce fond cesse de couvrir le cadre (demande du 13/08/2026, "le déplacement doit s'arrêter au
// bord du cadre" — jamais de zone vide ni de reprise en tuile visible).
function sizeUniverseBackground(backgroundEl, viewportEl) {
  const frameW = viewportEl.clientWidth;
  const frameH = viewportEl.clientHeight;
  if (!frameW || !frameH) return null;
  const coverScale = Math.max(frameW / UNIVERSE_BG_NATURAL_W, frameH / UNIVERSE_BG_NATURAL_H);
  const renderedW = Math.ceil(UNIVERSE_BG_NATURAL_W * coverScale);
  const renderedH = Math.ceil(UNIVERSE_BG_NATURAL_H * coverScale);
  backgroundEl.style.backgroundSize = `${renderedW}px ${renderedH}px`;
  return { renderedW, renderedH };
}

// Rayon à l'écran visé, pour le plus gros enfant d'un nœud, une fois ce nœud ciblé par un clic
// (focusOn) — comfortablement au-dessus de REVEAL_PX_SELF pour qu'il apparaisse net, pas
// seulement pile au seuil. Cibler "remplir le cadre à X%" (essayé d'abord) ne suffisait pas :
// un nœud à beaucoup d'enfants (le disque se subdivise davantage) peut remplir le cadre sans
// qu'aucun enfant individuel ne dépasse le seuil de révélation — constaté le 13/08/2026, cadre
// rempli d'un flou uni après un clic, alors que le nœud ciblé lui-même était bien assez zoomé.
// Cibler explicitement le plus gros enfant (node.maxChildR, posé après layoutUniverseWorld,
// cf. mountUniverse) garantit qu'au moins lui devient net, quelle que soit la répartition.
const FOCUS_CHILD_TARGET_PX = 58;

// Pour un système solaire, ses étoiles gravitent maintenant EN ORBITE autour de lui (satellites,
// cf. packSatellitesAroundPoint, universe-zoom.js) plutôt qu'emboîtées dans son propre disque —
// le cadrage doit donc AUSSI garantir que l'anneau entier (node.orbitRadius) tient dans le
// cadre, pas seulement que les étoiles elles-mêmes sont assez grandes (sinon l'orbite déborde
// du cadre visible une fois zoomé). Le plus petit des deux facteurs de zoom l'emporte : jamais
// plus zoomé que ce que l'orbite peut encore contenir.
const FOCUS_ORBIT_FIT_PX = 165;

function focusScaleFor(node) {
  const targetR = node.maxChildR || node.r * 0.3;
  const legibilityScale = FOCUS_CHILD_TARGET_PX / targetR;
  if (!node.orbitRadius) return legibilityScale;
  const fitScale = FOCUS_ORBIT_FIT_PX / node.orbitRadius;
  return Math.min(legibilityScale, fitScale);
}

function pluralize(n, word) { return `${n} ${word}${n > 1 ? "s" : ""}`; }

function ariaLabelFor(kind, node) {
  if (kind === "galaxy") return `Ouvrir la galaxie ${node.name}, ${pluralize(node.ref.solarSystems.length, "système solaire")}`;
  if (kind === "solarSystem") return `Ouvrir le système solaire ${node.name}, ${pluralize(node.ref.stars.length, "étoile")}`;
  if (kind === "star") return `Voir la liste de ${pluralize(node.ref.articleCount, "article")} sous ${node.name}`;
  if (kind === "unclassified") return `Ouvrir le groupe À classer, ${pluralize(node.ref.length, "article")}`;
  return node.name;
}

// ---- Décorations : calculées une seule fois par nœud lors du montage (positions déjà connues
// en coordonnées monde, contrairement à l'ancien modèle qui devait relire le DOM après coup) ----

// Lunes autour d'une galaxie (demande du 13/08/2026) : leur nombre correspond EXACTEMENT au
// nombre de systèmes solaires qu'elle contient (pas une décoration purement aléatoire comme les
// lunes/scintillements des étoiles plus bas) — même principe que addMiniStarsAroundSolarSystem
// juste en dessous (nombre réel plutôt que suggéré), mais sans plancher/plafond : l'utilisateur a
// explicitement demandé la correspondance exacte ("18 solars = 18 lunes"), jamais arrondie.
function addMoonsAroundGalaxy(galaxy) {
  const count = galaxy.ref.solarSystems.length;
  for (let m = 0; m < count; m += 1) {
    const angle = (m / count) * Math.PI * 2 + (galaxy.x + galaxy.y) * 0.01;
    const dist = galaxy.r + 14 + Math.random() * 20;
    const moonSize = 8 + Math.random() * 6;
    const moon = document.createElement("span");
    moon.className = "universe-galaxy-moon";
    // galaxyId : lu par onCameraChange pour masquer ces lunes dès que les systèmes solaires de
    // LEUR galaxie deviennent visibles (demande du 13/08/2026, "quand je vois les solars, je ne
    // veux plus voir ces lunes") — même bascule is-revealed que la bulle galaxie elle-même
    // (childrenCanShow), pour rester synchronisé avec elle plutôt que de suivre un seuil propre.
    moon.dataset.galaxyId = galaxy.id;
    moon.style.left = Math.round(galaxy.x + Math.cos(angle) * dist - moonSize / 2) + "px";
    moon.style.top = Math.round(galaxy.y + Math.sin(angle) * dist - moonSize / 2) + "px";
    moon.style.width = moonSize + "px";
    moon.style.height = moonSize + "px";
    // --moon-twinkle (pas opacity directement) : opacity est le mécanisme de révélation
    // is-revealed ci-dessous (cf. style.css), un inline opacity l'aurait court-circuité (une
    // propriété posée en style inline gagne toujours sur une règle de classe).
    moon.style.setProperty("--moon-twinkle", String(0.75 + Math.random() * 0.25));
    worldEl.appendChild(moon);
  }
}

const MINI_STAR_MIN = 2;
const MINI_STAR_MAX = 10;

function addMiniStarsAroundSolarSystem(system) {
  const count = Math.max(MINI_STAR_MIN, Math.min(MINI_STAR_MAX, system.ref.stars.length));
  for (let s = 0; s < count; s += 1) {
    const angle = (s / count) * Math.PI * 2 + (system.x + system.y) * 0.01;
    const dist = system.r + 10 + Math.random() * 16;
    const dotSize = 10 + Math.random() * 8;
    const dot = document.createElement("span");
    dot.className = "universe-mini-star";
    dot.style.left = Math.round(system.x + Math.cos(angle) * dist - dotSize / 2) + "px";
    dot.style.top = Math.round(system.y + Math.sin(angle) * dist - dotSize / 2) + "px";
    dot.style.width = dotSize + "px";
    dot.style.height = dotSize + "px";
    dot.style.opacity = String(0.7 + Math.random() * 0.3);
    worldEl.appendChild(dot);
  }
}

const STAR_SPARKLE_CHANCE = 0.22;

// Lunes ternes autour des étoiles retirées (demande du 13/08/2026, "point noir qui apparait sur
// la bulle solar dès que l'étoile apparait, je n'en veux pas") : leur dégradé bleu-gris foncé
// (#4a5a68), pensé comme une sphère ombrée discrète à taille fixe, devenait un gros disque sombre
// bien visible une fois mis à l'échelle avec le reste de la scène (même mécanisme que les bulles,
// volontaire pour elles mais pas prévu ici) — repéré au moment même où les étoiles satellites se
// révèlent, puisque montées en même temps qu'elles (cf. worldLayout.stars.forEach, ci-dessous).
function addSparklesAroundStar(star) {
  if (Math.random() <= STAR_SPARKLE_CHANCE) {
    const angle = Math.random() * Math.PI * 2;
    const dist = star.r + 14 + Math.random() * 14;
    const sparkleSize = 10 + Math.random() * 6;
    const sparkle = document.createElement("span");
    sparkle.className = "universe-star-sparkle";
    sparkle.style.left = Math.round(star.x + Math.cos(angle) * dist - sparkleSize / 2) + "px";
    sparkle.style.top = Math.round(star.y + Math.sin(angle) * dist - sparkleSize / 2) + "px";
    sparkle.style.width = sparkleSize + "px";
    sparkle.style.height = sparkleSize + "px";
    worldEl.appendChild(sparkle);
  }
}

// ---- Construction d'une bulle (élément DOM) pour un nœud positionné ----
function createBubbleEl(kind, node, background, glowColor, extraClass) {
  // <div role="button"> plutôt qu'un vrai <button> : un <button> impose une taille minimale
  // intrinsèque (~16px, liée à padding+border même sous box-sizing:border-box) qui écrase une
  // largeur/hauteur explicite plus petite — confirmé empiriquement le 13/08/2026, un <button>
  // nu avec style.width="6px" calcule quand même 16px, alors qu'un <div> respecte la valeur
  // demandée. Comme les coordonnées "monde" (avant zoom caméra) sont souvent bien en-dessous de
  // 16px pour une étoile, ce plancher gonflait la taille RÉELLE à l'écran une fois le zoom de
  // la caméra appliqué (jusqu'à remplir tout le cadre). tabindex + gestion clavier (Entrée/
  // Espace) reproduisent l'activation native d'un bouton, perdue avec <div>.
  const btn = document.createElement("div");
  btn.setAttribute("role", "button");
  btn.tabIndex = 0;
  btn.className = `agon-tag-bubble universe-zoom-bubble${extraClass ? " " + extraClass : ""}`;
  btn.dataset.kind = kind;
  btn.dataset.nodeId = node.id;
  btn.style.left = (node.x - node.r) + "px";
  btn.style.top = (node.y - node.r) + "px";
  // .agon-tag-bubble ne fixe pas width/height elle-même (ça vient normalement de
  // .agon-tag-bubble-large/-medium/-small, un système de paliers propre à tagTrendCloud.js,
  // non utilisé ici) : posé directement en inline, une taille continue plutôt que 3 paliers.
  btn.style.width = node.r * 2 + "px";
  btn.style.height = node.r * 2 + "px";
  btn.style.setProperty("--agon-tag-bubble-size", node.r * 2 + "px");
  if (background) btn.style.background = background;
  if (glowColor) btn.style.setProperty("--agon-tag-bubble-glow", glowColor);
  btn.setAttribute("aria-label", ariaLabelFor(kind, node));
  btn.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      btn.click();
    }
  });

  // Libellé dans la couche à part (labelsOverlayEl), jamais enfant de btn : cf. le commentaire
  // sur labelsOverlayEl plus haut (texte flou évité). Positionné en coordonnées écran par
  // onCameraChange, pas ici (la caméra n'a pas encore de position tant que le montage n'est pas
  // terminé) — masqué par défaut (is-revealed ajouté par onCameraChange au premier calcul).
  const label = document.createElement("span");
  label.className = `universe-zoom-bubble-label${kind === "star" ? " universe-zoom-bubble-label-star" : ""}`;
  label.textContent = node.name;
  labelsOverlayEl.appendChild(label);
  labelElByNodeId.set(node.id, label);

  worldEl.appendChild(btn);
  return btn;
}

// ---- Montage complet de la scène (une seule fois par chargement de données) ----
function destroyUniverseScene() {
  camera = null;
  if (universeBgResizeObserver) universeBgResizeObserver.disconnect();
  universeBgResizeObserver = null;
  if (viewportEl) viewportEl.remove();
  viewportEl = null;
  worldEl = null;
  labelsOverlayEl = null;
  labelElByNodeId.clear();
  connectorElByNodeId.clear();
  nodeById.clear();
}

// Trait lumineux reliant une étoile à son système solaire (satellite, cf.
// packSatellitesAroundPoint, universe-zoom.js) — un simple <div> tourné/étiré entre les deux
// points, dans l'espace "monde" (enfant de worldEl, mis à l'échelle avec le reste de la scène).
// Épaisseur visée à l'écran (px), quel que soit le niveau de zoom — cf. onCameraChange, qui pose
// height = CONNECTOR_SCREEN_PX / state.scale à chaque frame (jamais une valeur fixe posée ici à
// la création : un enfant de worldEl voit sa taille multipliée par state.scale comme le reste de
// la scène, cf. son commentaire).
const CONNECTOR_SCREEN_PX = 2;

function createConnectorEl(fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const el = document.createElement("div");
  el.className = "universe-zoom-connector";
  el.style.left = fromX + "px";
  el.style.top = fromY + "px";
  el.style.width = length + "px";
  el.style.transform = `rotate(${angle}deg)`;
  worldEl.appendChild(el);
  return el;
}

function mountUniverse() {
  destroyUniverseScene();

  viewportEl = document.createElement("div");
  viewportEl.className = "universe-zoom-viewport";
  // Fond étoilé zoomable (demande du 13/08/2026, "que le fond s'avance aussi") : posé AVANT
  // worldEl (donc dessous), à l'intérieur de viewportEl pour profiter de son overflow:hidden
  // (le cadre décoratif existant, #agon-universe-cloud::after, reste fixe — non affecté, cette
  // couche vient juste se superposer par-dessus). Mis à l'échelle via --universe-cam-scale (CSS),
  // pas manipulé en JS ici.
  const backgroundEl = document.createElement("div");
  backgroundEl.className = "universe-zoom-background";
  worldEl = document.createElement("div");
  worldEl.className = "universe-zoom-world";
  // Sibling de worldEl (pas un enfant) : reste en dehors de son transform:scale, cf. le
  // commentaire sur labelsOverlayEl plus haut.
  labelsOverlayEl = document.createElement("div");
  labelsOverlayEl.className = "universe-zoom-labels-overlay";
  viewportEl.appendChild(backgroundEl);
  viewportEl.appendChild(worldEl);
  viewportEl.appendChild(labelsOverlayEl);
  cloudEl.appendChild(viewportEl);
  let lastBgSize = sizeUniverseBackground(backgroundEl, viewportEl);
  if (universeBgResizeObserver) universeBgResizeObserver.disconnect();
  universeBgResizeObserver = new ResizeObserver(() => {
    lastBgSize = sizeUniverseBackground(backgroundEl, viewportEl);
    if (lastBgSize && camera) camera.setBackgroundSize(lastBgSize.renderedW, lastBgSize.renderedH);
  });
  universeBgResizeObserver.observe(viewportEl);

  // Rayon du monde dérivé de la taille réelle du cadre au montage : scale=1 (vue d'ensemble)
  // montre alors tout de suite toutes les galaxies confortablement.
  const vw = viewportEl.clientWidth || 390;
  const vh = viewportEl.clientHeight || 460;
  const worldRadius = Math.min(vw, vh) * 0.46;

  worldLayout = layoutUniverseWorld(universeData.galaxies, worldRadius);

  // maxChildR : le rayon du plus gros enfant direct de chaque galaxie/système, posé après coup
  // (layoutUniverseWorld ne le calcule pas lui-même) — sert de cible à focusScaleFor pour
  // garantir qu'au moins un enfant devienne net après un clic, quelle que soit la répartition
  // des tailles à l'intérieur du disque.
  const maxChildRByGalaxy = new Map();
  worldLayout.solarSystems.forEach((s) => {
    maxChildRByGalaxy.set(s.galaxyId, Math.max(maxChildRByGalaxy.get(s.galaxyId) || 0, s.r));
  });
  worldLayout.galaxies.forEach((g) => { g.maxChildR = maxChildRByGalaxy.get(g.id) || g.r * 0.3; });

  const maxChildRBySystem = new Map();
  worldLayout.stars.forEach((star) => {
    maxChildRBySystem.set(star.solarSystemId, Math.max(maxChildRBySystem.get(star.solarSystemId) || 0, star.r));
  });
  worldLayout.solarSystems.forEach((s) => { s.maxChildR = maxChildRBySystem.get(s.id) || s.r * 0.3; });

  worldLayout.galaxies.forEach((g) => {
    const visual = galaxyBubbleVisual(g.name);
    const el = createBubbleEl("galaxy", g, visual.background, visual.glowColor, "agon-tag-bubble-galaxy");
    el.classList.add("is-revealed"); // toujours visibles, jamais soumises au seuil de révélation
    addMoonsAroundGalaxy(g);
    nodeById.set(g.id, g);
  });

  worldLayout.solarSystems.forEach((s) => {
    const hue = hueForGalaxy(getGalaxyNameFromId(s.galaxyId));
    createBubbleEl(
      "solarSystem",
      s,
      bubbleBackgroundFor(getGalaxyNameFromId(s.galaxyId), "solarSystem", true),
      `hsla(${hue}, 18%, 85%, 0.6)`,
      "agon-tag-bubble-solarsystem"
    );
    addMiniStarsAroundSolarSystem(s);
    nodeById.set(s.id, s);
  });

  worldLayout.stars.forEach((star) => {
    createBubbleEl(
      "star",
      star,
      bubbleBackgroundFor(getGalaxyNameFromId(star.galaxyId), "star", true),
      null,
      "agon-tag-bubble-star"
    );
    addSparklesAroundStar(star);
    const parentSystem = nodeById.get(star.solarSystemId);
    if (parentSystem) {
      connectorElByNodeId.set(star.id, createConnectorEl(parentSystem.x, parentSystem.y, star.x, star.y));
    }
    nodeById.set(star.id, star);
  });

  // "À classer" : une bulle de plus au niveau racine, positionnée comme une galaxie
  // supplémentaire (packée dans le même disque), ouvre directement le panneau liste (comme une
  // étoile) plutôt qu'un niveau de zoom supplémentaire — ces articles n'ont ni système ni
  // étoile à explorer en dessous.
  let unclassifiedNode = null;
  if (universeData.unclassified.length) {
    const extra = Math.min(worldRadius * 0.3, 70);
    const angle = Math.PI * 0.72;
    unclassifiedNode = {
      id: "unclassified",
      name: "À classer",
      x: Math.cos(angle) * worldRadius * 0.78,
      y: Math.sin(angle) * worldRadius * 0.78,
      r: extra,
      ref: universeData.unclassified
    };
    createBubbleEl("unclassified", unclassifiedNode, UNCLASSIFIED_BUBBLE_BACKGROUND, null, "agon-tag-bubble-unclassified");
    nodeById.set(unclassifiedNode.id, unclassifiedNode);
  }

  // Plafond dérivé de la révélation réelle des étoiles plutôt qu'une valeur fixe arbitraire —
  // demande du 13/08/2026, resserrée le même jour ("une fois que les étoiles apparaissent, le
  // zoom ne puisse plus aller plus loin") : le plafond correspond au moment où le plus gros
  // enfant de chaque système franchit REVEAL_PX_SELF (son seuil d'apparition, cf.
  // childrenCanShow), pas un objectif de confort au-delà (essayé d'abord avec focusScaleFor,
  // qui vise 58px — trop de marge, on pouvait continuer à zoomer après l'apparition). 85e
  // centile (pas le max ni la moyenne) : un seul système avec très peu d'étoiles peut avoir un
  // rayon minuscule, poussant SON seuil très haut — un plafond aligné sur le max, essayé
  // d'abord, laissait alors quelques crans de molette suffire à dépasser toute zone utile pour
  // les AUTRES systèmes et à se retrouver "dans" une bulle sans plus rien voir (constaté le
  // 13/08/2026). Marge de 1.05x seulement (pas 1.15x) : juste de quoi laisser l'étoile
  // fraîchement apparue finir son fondu, pas au point de pouvoir zoomer beaucoup plus loin.
  const systemRevealScales = worldLayout.solarSystems
    .map((s) => REVEAL_PX_SELF / (s.maxChildR || s.r * 0.3))
    .sort((a, b) => a - b);
  const percentileScale = systemRevealScales.length
    ? systemRevealScales[Math.floor(systemRevealScales.length * 0.85)] ?? systemRevealScales[systemRevealScales.length - 1]
    : 12;
  const maxScale = Math.min(35, Math.max(8, percentileScale * 1.05));

  camera = createUniverseCamera({
    viewportEl,
    worldEl,
    backgroundEl,
    minScale: 1,
    maxScale,
    onChange: onCameraChange
  });
  if (lastBgSize) camera.setBackgroundSize(lastBgSize.renderedW, lastBgSize.renderedH);
  camera.setState({ x: 0, y: 0, scale: 1 }, false);
  onCameraChange(camera.getState());
}

function getGalaxyNameFromId(galaxyId) {
  const node = nodeById.get(galaxyId);
  return node ? node.name : null;
}

// ---- Réaction au changement de caméra : révèle/masque les bulles selon leur taille à l'écran,
// contre-scale les libellés pour qu'ils restent lisibles à tout niveau de zoom, met à jour le
// fil d'Ariane. rAF-throttled côté caméra (cf. universe-zoom.js) : jamais plus d'une fois par
// frame pendant un geste continu.
// Un nœud cède la place à ses enfants exactement quand SON PLUS GROS enfant devient assez
// grand à l'écran pour s'afficher (REVEAL_PX_SELF) — jamais un seuil indépendant sur le rayon
// du PARENT lui-même. Un seuil indépendant (essayé d'abord, PARENT_REVEAL_PX fixe) pouvait se
// déclencher AVANT qu'aucun enfant n'ait individuellement atteint sa propre taille de
// révélation — sur un grand écran (cadre plus grand, donc rayons "monde" plus grands pour un
// même jeu de données), un nœud avec beaucoup d'enfants (donc chacun plus petit) passait ce
// seuil tout en gardant des enfants encore trop petits pour apparaître : le nœud disparaissait
// (fondu croisé) SANS qu'aucun enfant ne le remplace, laissant un vide — constaté le 13/08/2026
// ("apparaît furtivement et disparaît", capture d'écran : fil d'Ariane montrant une galaxie
// "ouverte" dès l'arrivée sur le site, sans aucun zoom, cadre pourtant vide). Lier les deux
// événements (le parent cède / un enfant apparaît) au MÊME calcul élimine ce vide par
// construction.
function childrenCanShow(node, scale) {
  return (node.maxChildR || 0) * scale >= REVEAL_PX_SELF;
}

function onCameraChange(state) {
  document.documentElement.style.setProperty("--universe-cam-scale", String(state.scale));

  const vw = viewportEl.clientWidth;
  const vh = viewportEl.clientHeight;

  worldEl.querySelectorAll(".universe-zoom-bubble").forEach((el) => {
    const kind = el.dataset.kind;
    const nodeId = el.dataset.nodeId;
    const node = nodeById.get(nodeId);
    if (!node) return;
    const label = labelElByNodeId.get(nodeId);

    let revealed;
    if (kind === "unclassified") {
      revealed = true; // toujours révélé
    } else if (kind === "galaxy") {
      revealed = !childrenCanShow(node, state.scale);
    } else {
      // Hiérarchie stricte à 3 niveaux (systèmes/étoiles) : un système/une étoile ne se révèle
      // jamais seul(e) sur sa seule taille à l'écran — il faut AUSSI que son parent direct ait
      // déjà cédé la place (même calcul childrenCanShow que celui qui masque ce parent, jamais
      // de seuil indépendant qui risquerait de désynchroniser les deux).
      // Contrairement à la galaxie (qui s'efface entièrement au profit de ses systèmes), un
      // système solaire reste affiché même une fois ses étoiles satellites visibles (demande du
      // 13/08/2026) : les étoiles gravitent AUTOUR de son point lumineux (cf.
      // packSatellitesAroundPoint, universe-zoom.js), qui sert d'ancrage visuel et doit rester —
      // jamais de fondu croisé à ce niveau-là, uniquement au niveau galaxie -> système.
      const parentId = kind === "solarSystem" ? node.galaxyId : node.solarSystemId;
      const parent = nodeById.get(parentId);
      const parentCeded = parent && childrenCanShow(parent, state.scale);
      const selfRevealed = node.r * state.scale >= REVEAL_PX_SELF;
      revealed = parentCeded && selfRevealed;
    }

    // Position écran du libellé (couche à part, cf. labelsOverlayEl) — recalculée à chaque
    // frame de caméra à partir des coordonnées "monde" du nœud, jamais via un contre-scale CSS
    // imbriqué dans le monde transformé (texte flou à fort zoom, cf. son commentaire).
    if (label) {
      label.style.left = (vw / 2 + (node.x - state.x) * state.scale) + "px";
      label.style.top = (vh / 2 + (node.y - state.y) * state.scale) + "px";
      label.classList.toggle("is-revealed", revealed);
    }
    // Trait connecteur (étoiles uniquement, cf. createConnectorEl) : même état que l'étoile
    // elle-même, jamais affiché seul ni en avance sur elle. Épaisseur RECALCULÉE ici à chaque
    // frame (CONNECTOR_SCREEN_PX / state.scale), pas fixée une fois pour toutes à la création :
    // un enfant de worldEl voit sa taille multipliée par state.scale comme tout le reste de la
    // scène — même une épaisseur "proportionnelle au système" (essayé d'abord) continue de
    // grossir avec le zoom sans jamais se stabiliser, tant que la caméra n'a pas atteint son
    // maxScale global. Diviser par state.scale ici annule exactement cette multiplication :
    // l'épaisseur RENDUE reste ~constante à l'écran, quel que soit le niveau de zoom.
    const connector = connectorElByNodeId.get(nodeId);
    if (connector) {
      connector.style.height = Math.max(0.4, CONNECTOR_SCREEN_PX / state.scale) + "px";
      connector.classList.toggle("is-revealed", revealed);
    }

    el.classList.toggle("is-revealed", revealed);
  });

  // Lunes décoratives des galaxies (cf. addMoonsAroundGalaxy) : mêmes règles is-revealed que la
  // bulle galaxie elle-même (childrenCanShow) — s'effacent dès que ses systèmes solaires
  // deviennent visibles, plutôt qu'un seuil propre qui risquerait de se désynchroniser d'elle.
  worldEl.querySelectorAll(".universe-galaxy-moon").forEach((el) => {
    const node = nodeById.get(el.dataset.galaxyId);
    if (!node) return;
    el.classList.toggle("is-revealed", !childrenCanShow(node, state.scale));
  });

  renderBreadcrumb(computeFocusInfo(state));
}

// Nœud "englobant" le centre courant de la caméra (le plus profond qui a cédé la place à ses
// enfants ET dont le point caméra reste dans son cercle) — sert au fil d'Ariane et au bouton
// retour, dérivé de la caméra plutôt que d'un état de navigation séparé. Même calcul
// (childrenCanShow) que la révélation elle-même : jamais de fil d'Ariane "en avance" sur ce qui
// est réellement affiché.
function computeFocusInfo(state) {
  let galaxy = null;
  for (const g of worldLayout.galaxies) {
    if (Math.hypot(state.x - g.x, state.y - g.y) <= g.r && childrenCanShow(g, state.scale)) { galaxy = g; break; }
  }
  if (!galaxy) return { galaxy: null, solarSystem: null };
  let solarSystem = null;
  for (const s of worldLayout.solarSystems) {
    if (s.galaxyId !== galaxy.id) continue;
    if (Math.hypot(state.x - s.x, state.y - s.y) <= s.r && childrenCanShow(s, state.scale)) { solarSystem = s; break; }
  }
  return { galaxy, solarSystem };
}

// ---- Clic (délégué sur document, un seul listener pour toute la durée de vie du module —
// worldEl est recréé à chaque loadUniverse(), inutile de re-brancher un listener à chaque fois) ----
document.addEventListener("click", (event) => {
  if (!isMemoireEmbedActive() || !worldEl) return;
  const bubble = event.target.closest(".universe-zoom-bubble");
  if (!bubble || !worldEl.contains(bubble)) return;
  if (!bubble.classList.contains("is-revealed")) return; // pas encore assez zoomé pour être "cliquable"
  event.stopPropagation();
  const node = nodeById.get(bubble.dataset.nodeId);
  if (!node) return;
  const kind = bubble.dataset.kind;
  if (kind === "galaxy" || kind === "solarSystem") {
    camera.focusOn(node, focusScaleFor(node));
  } else if (kind === "star") {
    showStarPanel(node.ref);
  } else if (kind === "unclassified") {
    showStarPanel({ name: "À classer", articles: node.ref });
  }
});

// ---- Fil d'Ariane ----
function renderBreadcrumb(focusInfo) {
  breadcrumbEl.innerHTML = "";
  const crumbs = [{ label: "Ma mémoire", action: () => zoomToRoot() }];
  if (focusInfo.galaxy) crumbs.push({ label: focusInfo.galaxy.name, action: () => camera.focusOn(focusInfo.galaxy, focusScaleFor(focusInfo.galaxy)) });
  if (focusInfo.solarSystem) crumbs.push({ label: focusInfo.solarSystem.name, action: () => camera.focusOn(focusInfo.solarSystem, focusScaleFor(focusInfo.solarSystem)) });

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
    btn.addEventListener("click", crumb.action);
    breadcrumbEl.appendChild(btn);
    const sep = document.createElement("span");
    sep.className = "universe-breadcrumb__sep";
    sep.textContent = "›";
    sep.setAttribute("aria-hidden", "true");
    breadcrumbEl.appendChild(sep);
  });

  updateBackButtonVisibility(crumbs.length > 1);
}

function zoomToRoot() {
  camera?.setState({ x: 0, y: 0, scale: 1 }, true);
}

function updateBackButtonVisibility(hasCrumbs) {
  backBtn.classList.toggle("is-visible", !!hasCrumbs);
}
backBtn.addEventListener("click", () => {
  if (!camera) return;
  const info = computeFocusInfo(camera.getState());
  if (info.solarSystem) {
    camera.focusOn(info.galaxy, focusScaleFor(info.galaxy));
  } else if (info.galaxy) {
    zoomToRoot();
  }
});

// ---- Panneau liste (niveau étoile) ----
const starPanelEl = document.getElementById("universe-star-panel");
const starPanelTitleEl = document.getElementById("universe-star-panel-title");
const starPanelListEl = document.getElementById("universe-star-panel-list");
const starPanelCloseBtn = document.getElementById("universe-star-panel-close");
const starPanelBackdropEl = document.getElementById("universe-star-panel-backdrop");
const starPanelBoxEl = starPanelEl?.querySelector(".universe-star-panel__box");
let starPanelScrollHintEl = null;
let starPanelResizeObserver = null;
let starKnowledgeRequestToken = 0;

const STAR_KNOWLEDGE_SOURCE_META = {
  histoire: { icon: "fa-clock-rotate-left", label: "Ce jour dans l'Histoire" },
  parallele: { icon: "fa-landmark", label: "Parallèle historique" },
  pensee: { icon: "fa-brain", label: "Pensée philosophique" },
  mecanisme: { icon: "fa-people-group", label: "Mécanisme sociologique" },
  concept: { icon: "fa-shapes", label: "Concept du jour" },
  citation: { icon: "fa-quote-left", label: "Citation du jour" },
  oeuvre: { icon: "fa-palette", label: "Œuvre d'art du jour" },
  latin: { icon: "fa-scroll", label: "Mot latin du jour" }
};

// Sur l'accueil, le panneau est déclaré dans #agon-tag-trends-section, qui crée son
// propre contexte d'empilement (z-index:1). Le dock blanc peut alors passer devant
// malgré le z-index du panneau. Le rattacher au body lui rend un vrai calque plein
// écran, comme les fiches blanches de "Mes acquis".
if (starPanelEl && starPanelEl.parentElement !== document.body) {
  document.body.appendChild(starPanelEl);
}

function updateStarPanelScrollHint() {
  if (!starPanelScrollHintEl || !starPanelListEl || starPanelEl.hidden) {
    starPanelScrollHintEl?.classList.add("is-hidden");
    return;
  }
  const hasOverflow = starPanelListEl.scrollHeight > starPanelListEl.clientHeight + 2;
  const atBottom = starPanelListEl.scrollTop + starPanelListEl.clientHeight >= starPanelListEl.scrollHeight - 4;
  starPanelScrollHintEl.classList.toggle("is-hidden", !hasOverflow || atBottom);
}

function refreshStarPanelScrollHint() {
  requestAnimationFrame(() => requestAnimationFrame(updateStarPanelScrollHint));
}

// Même repère que les autres fiches blanches : le titre reste fixe, seule la liste
// défile, et le dégradé « suite ↓ » n'apparaît que lorsqu'il reste du contenu dessous.
if (starPanelBoxEl && starPanelListEl) {
  starPanelScrollHintEl = document.createElement("div");
  starPanelScrollHintEl.className = "scroll-fade-hint universe-star-panel__scroll-hint is-hidden";
  starPanelScrollHintEl.style.setProperty("--scroll-fade-color", "#ffffff");
  starPanelScrollHintEl.innerHTML = '<span class="scroll-fade-hint-text">suite <span aria-hidden="true">↓</span></span>';
  starPanelBoxEl.appendChild(starPanelScrollHintEl);

  starPanelScrollHintEl.querySelector(".scroll-fade-hint-text")?.addEventListener("click", (event) => {
    event.stopPropagation();
    starPanelListEl.scrollBy({ top: starPanelListEl.clientHeight * 0.8, behavior: "smooth" });
  });
  starPanelListEl.addEventListener("scroll", updateStarPanelScrollHint, { passive: true });
  window.addEventListener("resize", refreshStarPanelScrollHint, { passive: true });
  if (typeof ResizeObserver === "function") {
    starPanelResizeObserver = new ResizeObserver(refreshStarPanelScrollHint);
    starPanelResizeObserver.observe(starPanelBoxEl);
    starPanelResizeObserver.observe(starPanelListEl);
  }
}

function formatAcquiredAt(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function showStarPanel(star) {
  starKnowledgeRequestToken += 1;
  starPanelTitleEl.textContent = star.name || "Étoile";
  starPanelListEl.innerHTML = "";
  starPanelListEl.scrollTop = 0;

  (star.articles || []).forEach((article) => {
    const hasFiche = (article.quizSlot && article.quizDate) ||
      (Array.isArray(article.sourceDetail?.sections) && article.sourceDetail.sections.length > 0);
    const hasUrl = article.url && /^https?:\/\//i.test(String(article.url));
    const el = document.createElement(hasFiche ? "button" : (hasUrl ? "a" : "span"));
    el.className = "universe-star-panel__item";
    if (hasFiche) {
      el.type = "button";
      el.setAttribute("aria-label", `Ouvrir la fiche connaissance ${article.title || ""}`.trim());
      el.addEventListener("click", () => showKnowledgeSheet(article, star));
    } else if (hasUrl) {
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

  document.body.classList.add("universe-star-panel-open");
  starPanelEl.hidden = false;
  refreshStarPanelScrollHint();
}

function appendKnowledgeSheetText(parent, className, text) {
  const value = String(text || "").trim();
  if (!value) return;
  const el = document.createElement("p");
  el.className = className;
  el.textContent = value;
  parent.appendChild(el);
}

function appendKnowledgeCorrectedQuestion(parent, question, index) {
  const item = document.createElement("div");
  item.className = "qcm-fiche-corrige-item";

  appendKnowledgeSheetText(item, "qcm-fiche-corrige-num", `Question ${index + 1}`);
  appendKnowledgeSheetText(item, "qcm-fiche-corrige-question", question.question);

  const type = question.type || "qcm";
  const ordered = type === "ordre";
  const list = document.createElement(ordered ? "ol" : "ul");
  list.className = `qcm-fiche-corrige-list${ordered ? " qcm-fiche-corrige-ordered" : ""}`;

  if (type === "association") {
    (question.pairs || []).forEach((pair) => {
      const li = document.createElement("li");
      li.className = "is-correct";
      li.textContent = `${pair.left || ""} → ${pair.right || ""}`;
      list.appendChild(li);
    });
  } else if (ordered) {
    (question.items || []).forEach((value) => {
      const li = document.createElement("li");
      li.className = "is-correct";
      li.textContent = value;
      list.appendChild(li);
    });
  } else {
    const correctIndexes = type === "qcm_multi"
      ? new Set(question.correctIndexes || [])
      : new Set([Number(question.correctIndex)]);
    (question.options || []).forEach((value, optionIndex) => {
      const li = document.createElement("li");
      if (correctIndexes.has(optionIndex)) li.className = "is-correct";
      li.textContent = value;
      list.appendChild(li);
    });
  }
  if (list.children.length) item.appendChild(list);
  appendKnowledgeSheetText(item, "qcm-fiche-corrige-explanation", question.explanation);
  parent.appendChild(item);
}

function renderKnowledgeSheet(article, star, fullFiche, loading = false) {
  const detail = fullFiche?.sourceDetail || article.sourceDetail || {};
  starPanelTitleEl.textContent = fullFiche?.label || article.title || "Fiche connaissance";
  starPanelListEl.innerHTML = "";

  const sheet = document.createElement("li");
  sheet.className = "universe-star-panel__knowledge-sheet";

  const back = document.createElement("button");
  back.type = "button";
  back.className = "universe-star-panel__knowledge-back";
  back.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>Retour aux connaissances</span>';
  back.addEventListener("click", () => showStarPanel(star));
  sheet.appendChild(back);

  const sourceMeta = STAR_KNOWLEDGE_SOURCE_META[fullFiche?.sourceType || article.sourceType] || {
    icon: "fa-book-open",
    label: article.source || "Culture générale"
  };
  const rubric = document.createElement("p");
  rubric.className = "qcm-fiche-rubric";
  rubric.innerHTML = `<i class="fa-solid ${sourceMeta.icon}" aria-hidden="true"></i>`;
  rubric.appendChild(document.createTextNode(` ${sourceMeta.label}`));
  sheet.appendChild(rubric);

  const themes = Array.isArray(fullFiche?.themes) ? fullFiche.themes.filter(Boolean) : [];
  if (themes.length) {
    const themeList = document.createElement("div");
    themeList.className = "qcm-mesqcm-themes";
    themes.forEach((theme) => {
      const tag = document.createElement("span");
      tag.className = "qcm-mesqcm-theme-tag";
      tag.textContent = theme;
      themeList.appendChild(tag);
    });
    sheet.appendChild(themeList);
  }

  appendKnowledgeSheetText(sheet, "qcm-fiche-meta", detail.meta);

  if (detail.image?.url) {
    const figure = document.createElement("figure");
    figure.className = "qcm-fiche-image";
    const image = document.createElement("img");
    image.src = detail.image.url;
    image.alt = article.title || "Illustration de la connaissance";
    image.loading = "lazy";
    image.addEventListener("load", refreshStarPanelScrollHint, { once: true });
    image.addEventListener("error", () => {
      figure.remove();
      refreshStarPanelScrollHint();
    }, { once: true });
    figure.appendChild(image);
    const caption = document.createElement("figcaption");
    const captionText = `Image : ${detail.image.credit || (detail.image.source === "press" ? "source de l'actualité" : "Wikipedia")}`;
    if (detail.image.pageUrl) {
      const link = document.createElement("a");
      link.href = detail.image.pageUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = captionText;
      caption.appendChild(link);
    } else {
      caption.textContent = captionText;
    }
    figure.appendChild(caption);
    sheet.appendChild(figure);
  }

  (detail.sections || []).forEach((section) => {
    if (section.label) {
      const heading = document.createElement("h3");
      heading.className = "qcm-fiche-section-label";
      heading.textContent = section.label;
      sheet.appendChild(heading);
    }
    appendKnowledgeSheetText(sheet, "qcm-fiche-explanation", section.text);
  });

  if (loading) {
    appendKnowledgeSheetText(sheet, "universe-star-panel__knowledge-loading", "Chargement de l’image et du QCM…");
  } else if (Array.isArray(fullFiche?.questions) && fullFiche.questions.length) {
    const questionsTitle = document.createElement("h3");
    questionsTitle.className = "qcm-fiche-section-label";
    questionsTitle.textContent = "Questions et réponses";
    sheet.appendChild(questionsTitle);
    fullFiche.questions.forEach((question, index) => appendKnowledgeCorrectedQuestion(sheet, question, index));
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "qcm-fiche-bottom-close";
  close.textContent = "Fermer";
  close.addEventListener("click", hideStarPanel);
  sheet.appendChild(close);

  starPanelListEl.appendChild(sheet);
  starPanelListEl.scrollTop = 0;
  refreshStarPanelScrollHint();
}

async function showKnowledgeSheet(article, star) {
  const requestToken = ++starKnowledgeRequestToken;
  const hasFullFiche = article.quizSlot && article.quizDate;
  renderKnowledgeSheet(article, star, null, hasFullFiche);
  if (!hasFullFiche) return;

  try {
    const params = new URLSearchParams({ slot: article.quizSlot, date: article.quizDate });
    const response = await fetch(`/api/users/notion-quizzes/fiche?${params.toString()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "Fiche indisponible");
    if (requestToken !== starKnowledgeRequestToken || starPanelEl.hidden) return;
    renderKnowledgeSheet(article, star, data, false);
  } catch (error) {
    if (requestToken !== starKnowledgeRequestToken || starPanelEl.hidden) return;
    console.warn("[mon-univers] fiche QCM complète indisponible :", error.message);
    renderKnowledgeSheet(article, star, null, false);
  }
}

function hideStarPanel() {
  starKnowledgeRequestToken += 1;
  starPanelEl.hidden = true;
  starPanelScrollHintEl?.classList.add("is-hidden");
  document.body.classList.remove("universe-star-panel-open");
}

starPanelCloseBtn.addEventListener("click", hideStarPanel);
starPanelBackdropEl.addEventListener("click", hideStarPanel);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !starPanelEl.hidden) hideStarPanel();
});

// #agon-memoire-embed-before n'existe QUE sur l'accueil (embed "Ma mémoire") : absent sur la
// page /mon-univers autonome (donc toujours "actif" là-bas). Sur l'accueil, ce même
// #agon-tag-trends-cloud est PARTAGÉ avec Bulles Actu/Bulles Agôn (cf. cloudEl plus haut) —
// sans cette vérification, les clics posés sur worldEl resteraient actifs pour toujours après
// une seule visite en mode "Ma mémoire", et stopPropagation() empêcherait alors les clics sur
// les vraies bulles Actu/Agôn d'atteindre le listener global de script.js.
function isMemoireEmbedActive() {
  const marker = document.getElementById("agon-memoire-embed-before");
  return !marker || !marker.hidden;
}

// ---- États de page ----
function showStatus(kind) {
  cloudEl.querySelector(".universe-empty-overlay")?.remove();

  // Sur l'accueil uniquement, la légende sous le sélecteur répète inutilement le rôle du
  // message d'état lorsque l'univers est vide. On la masque dans cet état précis, puis on la
  // réaffiche uniquement dès qu'un niveau contenant des éléments peut être rendu. La page autonome
  // /mon-univers n'a pas ce marqueur ni cette légende partagée.
  const embeddedMarker = document.getElementById("agon-memoire-embed-before");
  const embeddedCaption = embeddedMarker
    ? document.querySelector("#agon-tag-trends-section .agon-tag-trends-caption")
    : null;
  if (embeddedCaption && kind === "empty") embeddedCaption.hidden = true;
  if (embeddedCaption && kind === "none") embeddedCaption.hidden = false;
  if (embeddedCaption && (kind === "loading" || kind === "empty" || kind === "error")) embeddedCaption.hidden = true;

  if (kind === "none") {
    statusEl.hidden = true;
    cloudEl.hidden = false;
    return;
  }

  // "loading"/"empty" gardent le cadre visible (fond/bordure décorative) dès le clic sur "Ma
  // mémoire", plutôt que d'attendre la fin du chargement pour l'afficher. Seul "error" masque
  // encore le cloud (rien à montrer dans le cadre dans ce cas, le message d'erreur suffit).
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
    statusEl.hidden = true;
    const message = document.createElement("div");
    // La classe générique d'overlay permet aussi au changement de mode
    // Actu/Agôn de retirer ce message avec les anciens labels du nuage.
    message.className = "agon-tag-label-overlay universe-empty-overlay";
    message.style.cssText = "position:absolute;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:clamp(20px,6vw,46px);text-align:center;color:#fff;pointer-events:none;opacity:1;visibility:visible;transform:none;";
    message.innerHTML = '<div style="width:min(100%,520px);box-sizing:border-box;padding:clamp(22px,5vw,34px);border:1px solid rgba(255,255,255,.2);border-radius:22px;background:linear-gradient(145deg,rgba(18,29,38,.88),rgba(27,42,52,.76));box-shadow:0 18px 48px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.08);">' +
      '<div style="width:48px;height:48px;margin:0 auto 15px;border:1px solid rgba(255,255,255,.24);border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.08);box-shadow:0 0 24px rgba(160,198,212,.18);"><i class="fa-solid fa-diagram-project" style="font-size:19px;color:#c9dce5;"></i></div>' +
      '<p style="margin:0;font-family:Oswald,Impact,Arial Narrow,sans-serif;font-size:clamp(20px,4.5vw,27px);font-weight:600;line-height:1.2;letter-spacing:.01em;color:#f4f7f8;text-shadow:0 2px 8px rgba(0,0,0,.4);">Le réseau mnésique artificiel de ta mémoire est encore vide.</p>' +
      '<span style="display:block;width:54px;height:1px;margin:18px auto;background:linear-gradient(90deg,transparent,rgba(201,220,229,.8),transparent);"></span>' +
      '<p style="margin:0;font:600 clamp(14px,2.9vw,16px)/1.5 Arial,Helvetica,sans-serif;color:#f2f6f8;text-shadow:0 1px 3px rgba(0,0,0,.72);">Commence la mémorisation en cliquant sur <a href="/apprentissage" class="universe-empty-learning-link" aria-label="Ouvrir Mes apprentissages" style="display:inline-block;margin:0 2px;padding:2px 8px;border:1px solid rgba(201,220,229,.48);border-radius:999px;background:rgba(201,220,229,.18);color:#ffffff;font-weight:800;text-decoration:none;pointer-events:auto;cursor:pointer;">Apprentissages</a> (bandeau du bas)&nbsp;: le réseau mnésique artificiel de ta mémoire commencera sa formation.</p>' +
      '</div>';
    const learningLink = message.querySelector(".universe-empty-learning-link");
    learningLink?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (window.self !== window.top) {
        window.parent.postMessage({
          type: "agon:open-page-in-parent-modal",
          url: "/apprentissage",
          returnUrl: `${location.pathname}${location.search}${location.hash}`
        }, "*");
        return;
      }
      if (typeof window.openDebateIframeModal === "function") {
        window.openDebateIframeModal("/apprentissage");
        return;
      }
      window.location.assign("/apprentissage");
    });
    cloudEl.appendChild(message);
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

// Filet contre un fetch qui reste en attente indéfiniment (même raison que le service
// worker, cf. service-worker.js NAVIGATION_FETCH_TIMEOUT_MS : un réveil du téléphone en
// 4G/5G, ou ici plus spécifiquement un lancement à froid de la PWA standalone dont le
// réseau met plus longtemps à se stabiliser qu'un onglet Safari déjà actif, peut laisser
// ce fetch sans réponse ni erreur — sans lui, "Ma mémoire" restait bloquée en chargement
// perpétuel, seulement en standalone, jamais en navigateur mobile classique déjà "chaud".
const UNIVERSE_FETCH_TIMEOUT_MS = 12000;

// L'état vide varie rarement d'un affichage à l'autre, mais l'appel Supabase qui le confirme
// peut prendre plusieurs secondes au réveil d'une PWA standalone. Mémorise seulement cette
// confirmation (jamais les données complètes) pendant quelques minutes : au retour sur
// "Ma mémoire" ou après un refresh dans le même onglet, le message vide peut ainsi être peint
// dès l'évaluation du module, pendant que la requête fraîche vérifie silencieusement l'état.
// La page QCM supprime explicitement cette entrée dès qu'une bonne réponse peut créer la
// première acquisition, afin de ne pas faire clignoter un ancien état vide devant les bulles.
const UNIVERSE_EMPTY_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

function getUniverseEmptyCacheKey() {
  return `agonUniverseEmpty:${getKey()}`;
}

function hasFreshEmptyUniverseCache() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(getUniverseEmptyCacheKey()) || "null");
    return cached?.empty === true
      && Number.isFinite(cached.at)
      && Date.now() - cached.at <= UNIVERSE_EMPTY_CACHE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function cacheUniverseEmptyState(empty) {
  try {
    const key = getUniverseEmptyCacheKey();
    if (empty) sessionStorage.setItem(key, JSON.stringify({ empty: true, at: Date.now() }));
    else sessionStorage.removeItem(key);
  } catch {}
}

// ---- Chargement (un seul appel réseau, jamais relancé à la navigation dans la scène) ----
async function loadUniverse() {
  // Jeton partagé avec script.js (toggleAgonCloud/setPoliticalCloudGroup/setMemoireCloudMode) :
  // si l'utilisateur repart sur Bulles Actu/Agôn pendant que ce fetch est encore en vol (réseau
  // lent), window._agonCloudModeToken aura changé à la résolution ci-dessous — sans cette
  // vérification, le rendu de "Ma mémoire" arrivait en retard et écrasait les bulles
  // Actu/Agôn déjà affichées entre-temps sur le conteneur partagé.
  const modeToken = window._agonCloudModeToken;

  destroyUniverseScene();
  breadcrumbEl.innerHTML = "";
  backBtn.classList.remove("is-visible");
  const showedCachedEmpty = hasFreshEmptyUniverseCache();
  showStatus(showedCachedEmpty ? "empty" : "loading");

  const isDemo = new URLSearchParams(location.search).get("demo") === "1";
  if (isDemo) {
    universeData = buildDemoUniverseData();
    if (modeToken !== window._agonCloudModeToken) return;
    showStatus("none");
    mountUniverse();
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UNIVERSE_FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(`/api/users/intellectual-universe?legacyKey=${encodeURIComponent(getKey())}`, { cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) throw new Error("http " + response.status);
    universeData = await response.json();
  } catch (error) {
    console.warn("[mon-univers] chargement échoué :", error.message);
    if (modeToken !== window._agonCloudModeToken) return;
    // Si un état vide récent est déjà visible, une panne réseau momentanée ne doit pas le
    // remplacer par une erreur ni faire réapparaître un chargement long. La prochaine entrée
    // relancera de toute façon une vérification fraîche.
    if (!showedCachedEmpty) showStatus("error");
    return;
  }

  if (modeToken !== window._agonCloudModeToken) return;

  const emptyUniverse = isUniverseEmpty(universeData);
  cacheUniverseEmptyState(emptyUniverse);
  if (emptyUniverse) {
    showStatus("empty");
    return;
  }

  showStatus("none");
  mountUniverse();
  if (isMemoireEmbedActive()) window.__agonHideBubbleCloudLoadingSpinner?.();
}

loadUniverse();

// Ré-exécuté par script.js (setMemoireCloudMode) à chaque retour sur "Ma mémoire" après le
// tout premier passage : l'import dynamique n'évalue ce module qu'une seule fois (mis en cache
// via _memoireModuleLoadPromise), donc le loadUniverse() ci-dessus, en haut de fichier, ne
// s'exécute lui aussi qu'une seule fois — sans cet export, repasser sur "Ma mémoire" après être
// allé sur Bulles Actu/Agôn laissait leurs bulles telles quelles à l'écran au lieu de les
// remplacer par la scène "Ma mémoire". destroyUniverseScene() (en tout début de loadUniverse)
// évite d'empiler des scènes/caméras à chaque retour.
// Reclique sur l'onglet "Ma mémoire" (script.js) alors qu'on y est déjà : ramène la caméra à la
// vue d'ensemble, comme un clic sur le premier crumb du fil d'Ariane. Rien si déjà à la racine.
function resetToRoot() {
  if (!camera) return;
  const state = camera.getState();
  if (state.x !== 0 || state.y !== 0 || state.scale !== 1) zoomToRoot();
}

export { loadUniverse as reinitMemoireEmbed, resetToRoot };
