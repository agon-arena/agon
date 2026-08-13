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
import { layoutUniverseWorld, createUniverseCamera } from "/universe-zoom.js?v=20260813-real-zoom";

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
  const core = `radial-gradient(ellipse 24% 24% at 50% 50%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.78) 26%, hsl(${hue} 22% 90%) 50%, hsla(${hue}, 20%, 85%, 0.3) 68%, transparent 84%)`;
  return {
    background: `${core}, ${lines}`,
    glowColor: `hsla(${hue}, 25%, 85%, 0.72)`
  };
}

// ---- État local : un seul appel API, puis un seul calcul de scène (jamais recalculé à la
// navigation, seule la caméra bouge) ----
let universeData = null;
let worldLayout = null; // { galaxies, solarSystems, stars, worldRadius } — cf. layoutUniverseWorld
let camera = null;
let worldEl = null;
let viewportEl = null;
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

// ---- Seuils de révélation : une bulle n'apparaît (et ne devient cliquable) que lorsque son
// rayon À L'ÉCRAN dépasse ce seuil — pas de dépendance à "quel niveau est ouvert" (il n'y a plus
// de niveau, juste une caméra continue) : exactement comme un zoom de carte, une bulle plus
// grosse/plus riche se révèle avant une petite, indépendamment d'où pointe la caméra.
const REVEAL_PX_SELF = 30; // rayon à l'écran minimum pour qu'une bulle système/étoile s'affiche
const CHILD_HINT_PX = 118; // rayon à l'écran à partir duquel un système commence à laisser deviner ses étoiles (indicatif, la révélation réelle suit REVEAL_PX_SELF ci-dessus)

function revealScaleFor(node) {
  return REVEAL_PX_SELF / node.r;
}
// Seuil visé par un clic (focusOn) : assez zoomé pour que les enfants soient confortablement
// lisibles, pas seulement au ras du seuil de révélation.
function focusScaleFor(node) {
  return (CHILD_HINT_PX * 1.7) / node.r;
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

const STAR_MOON_CHANCE = 0.35;
const STAR_SPARKLE_CHANCE = 0.22;

function addMoonsAndSparklesAroundStar(star) {
  if (Math.random() <= STAR_MOON_CHANCE) {
    const moonCount = Math.random() < 0.28 ? 2 : 1;
    for (let m = 0; m < moonCount; m += 1) {
      const angle = Math.random() * Math.PI * 2;
      const dist = star.r + 9 + Math.random() * 9;
      const moonSize = 3.5 + Math.random() * 3;
      const moon = document.createElement("span");
      moon.className = "universe-star-moon";
      moon.style.left = Math.round(star.x + Math.cos(angle) * dist - moonSize / 2) + "px";
      moon.style.top = Math.round(star.y + Math.sin(angle) * dist - moonSize / 2) + "px";
      moon.style.width = moonSize + "px";
      moon.style.height = moonSize + "px";
      worldEl.appendChild(moon);
    }
  }
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
  const btn = document.createElement("button");
  btn.type = "button";
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

  const label = document.createElement("span");
  label.className = "universe-zoom-bubble-label";
  label.textContent = node.name;
  btn.appendChild(label);

  worldEl.appendChild(btn);
  return btn;
}

// ---- Montage complet de la scène (une seule fois par chargement de données) ----
function destroyUniverseScene() {
  camera = null;
  if (viewportEl) viewportEl.remove();
  viewportEl = null;
  worldEl = null;
  nodeById.clear();
}

function mountUniverse() {
  destroyUniverseScene();

  viewportEl = document.createElement("div");
  viewportEl.className = "universe-zoom-viewport";
  worldEl = document.createElement("div");
  worldEl.className = "universe-zoom-world";
  viewportEl.appendChild(worldEl);
  cloudEl.appendChild(viewportEl);

  // Rayon du monde dérivé de la taille réelle du cadre au montage : scale=1 (vue d'ensemble)
  // montre alors tout de suite toutes les galaxies confortablement.
  const vw = viewportEl.clientWidth || 390;
  const vh = viewportEl.clientHeight || 460;
  const worldRadius = Math.min(vw, vh) * 0.46;

  worldLayout = layoutUniverseWorld(universeData.galaxies, worldRadius);

  worldLayout.galaxies.forEach((g) => {
    const visual = galaxyBubbleVisual(g.name);
    const el = createBubbleEl("galaxy", g, visual.background, visual.glowColor, "agon-tag-bubble-galaxy");
    el.classList.add("is-revealed"); // toujours visibles, jamais soumises au seuil de révélation
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
    addMoonsAndSparklesAroundStar(star);
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

  const maxChildRevealScale = worldLayout.solarSystems.length
    ? Math.max(...worldLayout.solarSystems.map((s) => focusScaleFor(s)))
    : (worldLayout.galaxies.length ? Math.max(...worldLayout.galaxies.map((g) => focusScaleFor(g))) : 4);

  camera = createUniverseCamera({
    viewportEl,
    worldEl,
    minScale: 1,
    maxScale: Math.max(6, maxChildRevealScale * 1.6),
    onChange: onCameraChange
  });
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
function onCameraChange(state) {
  document.documentElement.style.setProperty("--universe-cam-scale", String(state.scale));

  worldEl.querySelectorAll(".universe-zoom-bubble").forEach((el) => {
    if (el.dataset.kind === "galaxy") return; // toujours révélées
    const node = nodeById.get(el.dataset.nodeId);
    if (!node) return;
    const revealed = node.r * state.scale >= REVEAL_PX_SELF;
    el.classList.toggle("is-revealed", revealed);
  });

  renderBreadcrumb(computeFocusInfo(state));
}

// Nœud "englobant" le centre courant de la caméra (le plus profond dont le cercle contient le
// point caméra ET qui est réellement révélé à l'écran) — sert au fil d'Ariane et au bouton
// retour, dérivé de la caméra plutôt que d'un état de navigation séparé.
function computeFocusInfo(state) {
  let galaxy = null;
  for (const g of worldLayout.galaxies) {
    if (Math.hypot(state.x - g.x, state.y - g.y) <= g.r && g.r * state.scale >= CHILD_HINT_PX) { galaxy = g; break; }
  }
  if (!galaxy) return { galaxy: null, solarSystem: null };
  let solarSystem = null;
  for (const s of worldLayout.solarSystems) {
    if (s.galaxyId !== galaxy.id) continue;
    if (Math.hypot(state.x - s.x, state.y - s.y) <= s.r && s.r * state.scale >= CHILD_HINT_PX) { solarSystem = s; break; }
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
      '<p style="margin:0;font-family:Oswald,Impact,Arial Narrow,sans-serif;font-size:clamp(20px,4.5vw,27px);font-weight:600;line-height:1.2;letter-spacing:.01em;color:#f4f7f8;text-shadow:0 2px 8px rgba(0,0,0,.4);">Ton réseau neuronal artificiel de la mémoire est encore vide.</p>' +
      '<span style="display:block;width:54px;height:1px;margin:18px auto;background:linear-gradient(90deg,transparent,rgba(201,220,229,.8),transparent);"></span>' +
      '<p style="margin:0;font:600 clamp(14px,2.9vw,16px)/1.5 Arial,Helvetica,sans-serif;color:#f2f6f8;text-shadow:0 1px 3px rgba(0,0,0,.72);">Commence la mémorisation en cliquant sur <a href="/apprentissage" class="universe-empty-learning-link" aria-label="Ouvrir Mes apprentissages" style="display:inline-block;margin:0 2px;padding:2px 8px;border:1px solid rgba(201,220,229,.48);border-radius:999px;background:rgba(201,220,229,.18);color:#ffffff;font-weight:800;text-decoration:none;pointer-events:auto;cursor:pointer;">Apprentissage</a> (bandeau du bas)&nbsp;: ton réseau neuronal commencera sa formation.</p>' +
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
  showStatus("loading");

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
    showStatus("error");
    return;
  }

  if (modeToken !== window._agonCloudModeToken) return;

  if (isUniverseEmpty(universeData)) {
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
