// Page "Mon univers" : zoom spatial réel (demande du 13/08/2026) — galaxies, systèmes solaires
// et étoiles sont positionnés une seule fois dans un même espace de coordonnées persistant
// (cf. /universe-zoom.js, layoutUniverseWorld), et une caméra (pan/zoom continu, molette,
// pincement, glisser-déposer) parcourt cette scène plutôt que de remplacer tout l'écran à
// chaque clic. Remplace l'ancien modèle "un niveau = tout l'écran" qui réutilisait
// tagTrendCloud.js (recalculait les positions à chaque clic, sans mémoire spatiale entre
// niveaux) — tagTrendCloud.js n'est plus utilisé ici, jamais touché : il reste utilisé tel
// quel par les bulles Mnoria/Actu (public/script.js), sans rapport avec ce chantier.
// Volontairement léger — pas de chargement de script.js (qui alourdirait la page pour un seul
// besoin : getKey(), reproduite ici à l'identique, cf. script.js getKey()/lsGet()).
import {
  layoutUniverseWorld,
  computeUniverseWorldBounds,
  focusScaleForUniverseNode,
  createUniverseCamera
} from "/universe-zoom.js?v=20260901-solar-group-envelopes";

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
// style.css .mnoria-tag-bubble / .mnoria-cloud-political-right / .mnoria-cloud-political-left), la
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
  const span = 181 - 25 + (334 - 256);
  let offset = hash % span;
  return offset <= (181 - 25) ? 25 + offset : 256 + (offset - (181 - 25));
}

// Même principe que le hash de hueForGalaxy ci-dessus (jamais Math.random(), pour un rendu
// stable entre deux visites) : dérive une valeur déterministe dans [0,1) à partir d'une chaîne
// de départ. Utilisé par addMoonsAroundGalaxy pour un jitter d'angle/rayon reproductible plutôt
// qu'un placement parfaitement régulier (demande du 17/08/2026, "pas de manière régulière et
// symétrique").
function stableUnitFromString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return (hash % 100000) / 100000;
}

// Saturation commune, luminosité des 3 arrêts du dégradé — jamais recalculée par galaxie.
// Le solar reprend désormais les mêmes niveaux colorés perceptibles que sa galaxie : des
// luminosités trop proches du blanc donnaient auparavant l'impression d'une saturation moindre.
const GALAXY_GRADIENT_LEVELS = {
  galaxy: [82, 72, 60],
  solarSystem: [80, 68, 58],
  star: [76, 66, 54]
};
// Teinte volontairement douce, mais assez présente pour rester identifiable sur le fond Mnoria
// très lumineux. Cette saturation est commune à toute la hiérarchie d'une thématique.
const THEME_SATURATION = 30;
// fadeEdge : les 2 derniers arrêts perdent progressivement leur opacité au lieu de rester
// pleins jusqu'à 100% — sans lui, même en retirant le contour, le dégradé plein s'arrêtait net
// à la même place, donnant l'impression d'une "rupture".
function bubbleBackgroundFor(galaxyName, level, fadeEdge = false) {
  const hue = hueForGalaxy(galaxyName);
  const stops = GALAXY_GRADIENT_LEVELS[level];
  const s = THEME_SATURATION;
  const centerLightness = level === "solarSystem" ? 93 : 97;
  const tail = fadeEdge
    ? `hsla(${hue}, ${s}%, ${stops[1]}%, 0.75) 78%, hsla(${hue}, ${s}%, ${stops[2]}%, 0.35) 90%, hsla(${hue}, ${s}%, ${stops[2]}%, 0) 100%`
    : `hsl(${hue} ${s}% ${stops[2]}%) 100%`;
  // closest-side (seulement quand fadeEdge) : sans mot-clé de taille, un radial-gradient prend
  // par défaut farthest-corner, bien au-delà du bord réellement visible (coupé par
  // border-radius:50%) — closest-side cale 100% exactement sur le bord visible.
  // circle (pas ellipse) centré à 50%/50% quand fadeEdge : garantit un rayon identique dans
  // toutes les directions, donc un alpha 0 pile sur le bord partout.
  const shape = fadeEdge ? "circle closest-side at 50% 50%" : "ellipse at 38% 32%";
  return `radial-gradient(${shape}, rgba(255,255,255,1) 0%, hsl(${hue} ${s}% ${centerLightness}%) 14%, hsl(${hue} ${s}% ${stops[0]}%) 34%, hsl(${hue} ${s}% ${stops[1]}%) 68%, ${tail})`;
}

// "À classer" (aucune galaxie à colorer) : même bleuté que le dégradé par défaut de
// .mnoria-tag-bubble, avec le même fondu en alpha vers le bord que les autres niveaux.
const UNCLASSIFIED_BUBBLE_BACKGROUND = `radial-gradient(circle closest-side at 50% 50%, rgba(255,255,255,1) 0%, rgba(235,242,255,1) 40%, rgba(210,225,248,0.85) 70%, rgba(185,208,240,0.35) 88%, rgba(185,208,240,0) 100%)`;

// Bulles galaxie : rendu "nœud de neurone" très lumineux plutôt qu'un simple disque pastel —
// cœur très brillant + fines lignes rayonnantes façon synapses/dendrites, halo qui déborde du
// cercle (cf. .mnoria-tag-bubble-galaxy, style.css). Le dégradé de base (bubbleBackgroundFor)
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
  const stroke = `hsl(${hue}, ${THEME_SATURATION}%, 85%)`;
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
  const coreStroke = `hsl(${hue}, 15%, 97%)`;
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
  // par .mnoria-tag-bubble-galaxy::before, style.css) idem.
  const core = `radial-gradient(ellipse 24% 24% at 50% 50%, rgba(255,255,255,0.72) 0%, hsl(${hue} ${THEME_SATURATION}% 93%) 12%, hsl(${hue} ${THEME_SATURATION}% 80%) 36%, hsla(${hue}, ${THEME_SATURATION}%, 68%, 0.68) 66%, transparent 86%)`;
  return {
    background: `${core}, ${lines}`,
    glowColor: `hsla(${hue}, 36%, 72%, 0.76)`
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
let linksOverlayEl = null;
// Recalcule les dimensions CSS de la tuile 4K au redimensionnement/changement de densité
// d'écran (rotation mobile, passage d'un écran Retina à un autre), cf. mountUniverse.
let universeBgResizeObserver = null;
const labelElByNodeId = new Map();
// Traits connecteurs étoile -> système solaire (demande du 13/08/2026) : enfants de worldEl
// (pas de la couche des libellés), donc mis à l'échelle avec la scène comme les bulles — pas
// besoin d'une précision de rendu façon texte, une ligne reste lisible même mise à l'échelle.
const connectorElByNodeId = new Map();
// Liens sémantiques entre connaissances, déclinés aux trois niveaux (galaxie, solar, étoile).
// Contrairement aux connecteurs radiaux étoile -> solar ci-dessus, une relation peut traverser
// tout le monde : elle est conservée par paire et ne devient visible que lorsque SES DEUX
// extrémités du niveau concerné le sont.
const knowledgeLinkEls = [];
const nodeById = new Map(); // id (cf. layoutUniverseWorld) -> nœud positionné, reconstruit à chaque scène
// Isolation étoile<->étoile (demande du 17/08/2026) : Set des 2 ids d'étoiles à garder visibles
// après un double-clic sur leur lien, ou null en vue normale — cf. createKnowledgeLinkEl,
// onCameraChange.
let isolatedStarPair = null;
let isolationInfoEl = null;
let moonLinkEl = null;

// Centralise le passage isolé <-> normal (demande du 17/08/2026, petite fenêtre avec les noms
// des 2 étoiles + rappel "clique n'importe où pour tout faire réapparaître") : tous les points
// d'entrée (double-clic sur le lien, clic sur zone vide) passent par ici plutôt que de manipuler
// isolatedStarPair et ce panneau séparément à chaque endroit.
function setIsolatedStarPair(pair, fromNode, toNode, fromArticle, fromStarRef, toArticle, toStarRef) {
  isolatedStarPair = pair;
  if (isolationInfoEl) {
    if (pair && fromNode && toNode) {
      isolationInfoEl.innerHTML = "";
      const names = document.createElement("p");
      names.className = "universe-isolation-info-names";
      names.textContent = fromNode.name + " ↔ " + toNode.name;
      const hint = document.createElement("p");
      hint.className = "universe-isolation-info-hint";
      hint.textContent = "Ferme cette fenêtre, puis double-clique n’importe où pour tout faire réapparaître.";
      isolationInfoEl.append(names, hint);

      // Accès direct aux deux fiches connaissance à l'origine de ce lien (demande du 03/09/2026,
      // "je voudrais que les deux fiches issues des deux connaissances apparaissent aussi sur
      // cette fenêtre") : ouvre le panneau fiche existant (même showKnowledgeSheet/starPanelEl que
      // le clic normal sur une étoile) plutôt que de dupliquer le rendu d'une fiche complète (image,
      // sections, questions) dans cette petite fenêtre de 280px — trop à l'étroit pour deux fiches.
      // Le panneau fiche (z-index 2000) recouvre cette fenêtre d'isolement sans la fermer : à sa
      // fermeture, on revient donc naturellement ici (toujours isolé sur ces 2 étoiles).
      // Horodatage d'ouverture : un tap/clic fantôme peut être livré par Safari iOS juste après
      // le double-tap/clic prolongé qui vient d'ouvrir cette fenêtre (le bouton apparaît alors
      // pile sous le doigt, puisque la fenêtre est centrée à l'écran) — sans ce garde-fou, ce clic
      // fantôme ouvrait directement une fiche sans que l'utilisateur n'ait rien touché (demande du
      // 03/09/2026, "parfois ça ouvre aussi directement une fiche ... rien qu'en cliquant sur le
      // lien"). Même fenêtre de 400ms que la détection de double-tap ci-dessus : un vrai tap
      // délibéré sur ce bouton arrive forcément après.
      const shownAt = Date.now();
      const fichesRow = document.createElement("div");
      fichesRow.className = "universe-isolation-info-fiches";
      [[fromArticle, fromStarRef], [toArticle, toStarRef]].forEach(([article, starRef]) => {
        if (!article || !starRef) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "universe-isolation-info-fiche-btn";
        btn.innerHTML = '<i class="fa-solid fa-file-lines" aria-hidden="true"></i><span></span>';
        btn.querySelector("span").textContent = article.title || "Voir la fiche";
        btn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (Date.now() - shownAt < 400) return;
          document.body.classList.add("universe-star-panel-open");
          starPanelEl.hidden = false;
          showKnowledgeSheet(article, starRef, true);
        });
        fichesRow.appendChild(btn);
      });
      if (fichesRow.children.length) isolationInfoEl.append(fichesRow);

      const dismissBtn = document.createElement("button");
      dismissBtn.type = "button";
      dismissBtn.className = "universe-isolation-info-dismiss";
      dismissBtn.textContent = "J’ai compris";
      // stopPropagation : sans ça, ce clic bulle jusqu'au listener document ci-dessous, qui —
      // une fois le panneau fermé par CE MÊME clic — verrait aussitôt isolationInfoEl.hidden et
      // sortirait de l'isolement dans la foulée, au lieu de se contenter de fermer la fenêtre.
      dismissBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        isolationInfoEl.hidden = true;
      });
      isolationInfoEl.append(dismissBtn);
      isolationInfoEl.hidden = false;
    } else {
      isolationInfoEl.hidden = true;
    }
  }
  camera?.refresh();
}

// HUD de navigation : un seul SVG très léger, indépendant du monde transformé. Il affiche
// uniquement les galaxies, la position de la caméra et l'emprise du viewport.
const MINIMAP_VIEWBOX_W = 128;
const MINIMAP_VIEWBOX_H = 92;
const MINIMAP_PADDING = 6;
let minimapEl = null;
let minimapSvgEl = null;
let minimapViewportRectEl = null;
let minimapPositionEl = null;
let minimapZoomControlsEl = null;
let minimapZoomInBtn = null;
let minimapZoomOutBtn = null;
let minimapBounds = null;
let minimapActiveGalaxyId = null;
let minimapClipIdCounter = 0;
const minimapMarkerByNodeId = new Map();

// Repli sur #mnoria-tag-trends-cloud (bulles "Ma mémoire" embarquées sur l'accueil, même cadre
// que Bulles Actu/Bulles Mnoria) — la page /mon-univers autonome a bien son propre
// #mnoria-universe-cloud, jamais affecté par ce repli.
const cloudEl = document.getElementById("mnoria-universe-cloud") || document.getElementById("mnoria-tag-trends-cloud");
const breadcrumbEl = document.getElementById("universe-breadcrumb");
const statusEl = document.getElementById("universe-status");
const backBtn = document.getElementById("universe-back-btn");

// Texture définitive fournie pour "Ma mémoire". À l'échelle caméra 1, une dimension CSS divisée
// par devicePixelRatio ferait correspondre un pixel source à un pixel physique sur les écrans
// Retina/HiDPI ; le zoom de la caméra reste ensuite un zoom visuel normal du même asset.
// MNORIA_TEXTURE_DISPLAY_SCALE réduit cette correspondance 1:1 (demande du 01/09/2026, "le fond
// de ma mémoire est trop zoomé") : le cadre étant petit face à la texture 4K, un mappage pixel
// pour pixel n'affichait qu'un fragment agrandi de la nébuleuse au lieu d'un vrai ciel étoilé
// large. 0.6 rétrécit la tuile affichée d'autant, donc le motif se répète plus tôt et paraît
// plus éloigné/dézoomé, sans toucher au zoom de la scène elle-même (bulles, seuils de
// révélation) ni au plafond de grossissement du fond (BACKGROUND_MAX_VISUAL_SCALE,
// universe-zoom.js).
const MNORIA_TEXTURE_DISPLAY_SCALE = 0.6;
// WebP lossy (qualité 82, cf. audit "egress Ma mémoire" du 16/08/2026) remplace le PNG source
// (mnoria_master_4K_seamless_infini.png, conservé sur disque comme master) : -90,6% de poids
// (12,0 Mo -> 1,13 Mo) pour une différence visuelle imperceptible même sur les zones les plus
// exigeantes (champ d'étoiles à fort contraste, vérifié par crops 500×500 comparés pixel à
// pixel). Mêmes dimensions natives (3840×2560), donc aucun changement des calculs de
// zoom/tuilage ci-dessous. Cohérent avec le reste du projet, qui sert déjà tous ses visuels en
// WebP sans repli PNG (cf. /visuels/*.webp, server.js resized.webp) — pas de <picture>/fallback
// nécessaire. Ne réduit PAS l'empreinte mémoire décodée pendant le rendu (même bitmap brut une
// fois décodé, quel que soit le format source) : gain réseau/disque uniquement, distinct du
// correctif "gel du fond pendant un geste" (cf. universe-zoom.js) qui vise lui la mémoire/GPU.
const MNORIA_TEXTURE_NATURAL_W = 3840;
const MNORIA_TEXTURE_NATURAL_H = 2560;
const MNORIA_TEXTURE_URL = "/mnoria_master_4K_seamless_infini.webp?v=20260816-webp-lossy";
let mnoriaTextureReadyPromise = null;

function ensureMnoriaTextureReady() {
  if (mnoriaTextureReadyPromise) return mnoriaTextureReadyPromise;
  mnoriaTextureReadyPromise = new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.fetchPriority = "high";
    image.onload = () => {
      if (typeof image.decode === "function") {
        image.decode().catch(() => {}).finally(() => resolve(true));
      } else {
        resolve(true);
      }
    };
    // Une erreur réseau ne doit pas bloquer la navigation : le fond sombre CSS reste le filet
    // de sécurité, mais aucun dérivé compressé de moindre qualité n'est substitué.
    image.onerror = () => resolve(false);
    image.src = MNORIA_TEXTURE_URL;
  });
  return mnoriaTextureReadyPromise;
}

function syncMnoriaTileMetrics() {
  // Plancher à 2 (pas 1) : sur un moniteur de bureau standard (dpr 1), diviser par 1 seul
  // donnait une tuile 2× plus grande que sur un écran portable Retina (dpr 2, cf. formule
  // ci-dessous) — le fond paraissait donc bien plus zoomé sur bureau (demande du 04/09/2026,
  // "je veux que cela soit moins zoomé [en bureau]"). En traitant tout dpr < 2 comme 2, les
  // écrans standards reprennent la même tuile (donc le même zoom apparent) que les écrans
  // HiDPI, sans rien changer pour ces derniers.
  const dpr = Math.max(2, Number(window.devicePixelRatio) || 1);
  const width = (MNORIA_TEXTURE_NATURAL_W * MNORIA_TEXTURE_DISPLAY_SCALE) / dpr;
  const height = (MNORIA_TEXTURE_NATURAL_H * MNORIA_TEXTURE_DISPLAY_SCALE) / dpr;
  cloudEl?.style.setProperty("--mnoria-tile-width", `${width}px`);
  cloudEl?.style.setProperty("--mnoria-tile-height", `${height}px`);
  return { width, height };
}

// Le module est évalué dès l'entrée dans "Ma mémoire", avant même la réponse API : le fond
// fixe de secours (::after) profite donc lui aussi immédiatement de la bonne densité Retina.
syncMnoriaTileMetrics();
ensureMnoriaTextureReady();

function getGalaxyByName(name) {
  return (universeData?.galaxies || []).find((g) => g.name === name) || null;
}
function getSolarSystemById(galaxy, id) {
  return (galaxy?.solarSystems || []).find((s) => String(s.id) === String(id)) || null;
}

// ---- Seuils de révélation : un système n'apparaît que lorsque son rayon à l'écran dépasse
// REVEAL_PX_SELF et que sa galaxie a cédé la place. Les étoiles utilisent un seuil plus précoce
// dédié : d'abord minuscules, elles grandissent ensuite naturellement avec le zoom.
// Hiérarchie stricte à 3 niveaux demandée explicitement (13/08/2026) : sans le filtre par
// parent, un jeu de données avec peu d'éléments par niveau pouvait faire franchir le seuil de
// taille aux 3 niveaux en même temps dès la vue d'ensemble — les étoiles, peintes en dernier
// donc par-dessus, masquaient alors visuellement galaxies/systèmes en dessous.
const REVEAL_PX_SELF = 30; // rayon minimum d'un système, et taille d'étoile considérée mature
// Les étoiles commencent leur apparition bien avant leur taille de lecture définitive : elles
// sont d'abord de minuscules points, puis le zoom du monde les fait grandir continûment.
const STAR_REVEAL_PX = 6;
const STAR_LABEL_REVEAL_PX = 18;

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
  return focusScaleForUniverseNode(node, FOCUS_CHILD_TARGET_PX, FOCUS_ORBIT_FIT_PX);
}

function pluralize(n, word) { return `${n} ${word}${n > 1 ? "s" : ""}`; }

function ariaLabelFor(kind, node) {
  if (kind === "galaxy") return `Ouvrir la galaxie ${node.name}, ${pluralize(node.ref.solarSystems.length, "système solaire")}`;
  if (kind === "solarSystem") return `Ouvrir le système solaire ${node.name}, ${pluralize(node.ref.stars.length, "étoile")}`;
  if (kind === "star") return `Voir la liste de ${pluralize(node.ref.articleCount, "article")} sous ${node.name}`;
  if (kind === "unclassified") return `Ouvrir le groupe À classer, ${pluralize(node.ref.length, "article")}`;
  return node.name;
}

// ---- Indicateurs et décorations calculés une seule fois par nœud lors du montage ------------

// Lunes INFORMATIVES de la vue galaxie : une lune exacte par système solaire, jamais de lune
// ajoutée au hasard. Leur position est entièrement déterministe (jamais Math.random(), cf.
// stableUnitFromString) mais volontairement irrégulière — chaque lune reçoit un léger jitter
// d'angle et de rayon, propre à son anneau, plutôt qu'un placement parfaitement régulier et
// symétrique (demande du 17/08/2026). Le jitter reste borné assez strictement pour ne jamais
// remettre en cause les deux invariants existants : aucune collision entre lunes d'un même
// anneau, et aucun débordement sur le territoire d'une galaxie voisine (cf. mémoire
// project_galaxy_moon_spacing — les lunes restent bornées dans leur propre galaxy.r). Si une
// galaxie contient trop de systèmes pour un seul anneau sans chevauchement, les suivants
// occupent automatiquement un anneau plus éloigné.
function addMoonsAroundGalaxy(galaxy) {
  const systems = galaxy.ref.solarSystems;
  if (!systems.length) return;

  // Taille suffisamment lisible dès la vue d'ensemble : à 6px et avec un z-index négatif,
  // ces repères se confondaient avec les étoiles du fond et donnaient l'impression de
  // n'apparaître qu'après le zoom sur les systèmes solaires.
  const moonSize = Math.max(8, Math.min(11, galaxy.r * 0.13));
  // 8 -> 2px d'écart entre deux lunes du même anneau (demande du 17/08/2026, "s'agglomérer") :
  // serrées les unes contre les autres, seul un nouvel anneau (plus loin) prend le relais si la
  // capacité du premier est dépassée (ringCapacity plus bas, inchangé dans son principe).
  const spacing = moonSize + 2;
  // Toucher le cercle exact (galaxy.r) ne suffisait pas (demande du 17/08/2026, "toujours trop
  // loin") : la bulle galaxie a un halo lumineux qui déborde largement de ce cercle
  // (.mnoria-tag-bubble-galaxy::before, inset:-26px, style.css) — visuellement, le bord de la
  // galaxie perçu par l'œil est bien au-delà de galaxy.r. On rentre donc les lunes DANS cette
  // zone de halo plutôt que de s'arrêter au cercle mathématique.
  // -14 -> -22 -> -30 (demande du 17/08/2026, "rapproche encore" répétée) : toujours plus
  // profondément dans le halo. Plancher (moonSize) pour les petites galaxies : évite un rayon
  // nul/négatif qui empilerait les lunes sur le centre au lieu de les garder en couronne autour
  // de la bulle.
  const firstRadius = Math.max(moonSize, galaxy.r - 30 + moonSize / 2);
  // Phase stable dérivée du nom : évite que toutes les galaxies alignent leurs premières lunes
  // sur le même axe sans introduire le moindre Math.random() ni mouvement entre deux visites.
  const hue = hueForGalaxy(galaxy.name);
  const phase = (hue * Math.PI) / 180;
  let systemIndex = 0;
  let ringIndex = 0;

  while (systemIndex < systems.length) {
    const radialDistance = firstRadius + ringIndex * spacing;
    // Capacité calculée sur un espacement 30% plus large que le minimum strict (spacing) : cette
    // marge est ce qui absorbe le jitter d'angle ci-dessous sans jamais faire se toucher deux
    // lunes voisines, même dans le pire cas (les deux jitrées l'une vers l'autre au maximum).
    const ringSlotSpacing = spacing * 1.3;
    const ringCapacity = Math.max(6, Math.floor((Math.PI * 2 * radialDistance) / ringSlotSpacing));
    const ringCount = Math.min(ringCapacity, systems.length - systemIndex);
    const ringOffset = ringIndex % 2 ? Math.PI / ringCount : 0;
    const slotAngleWidth = (Math.PI * 2) / ringCount;

    for (let slot = 0; slot < ringCount; slot += 1) {
      const system = systems[systemIndex];
      const baseAngle = phase + ringOffset + slot * slotAngleWidth;
      // Jitter borné à 30% de la demi-largeur du créneau de chaque côté : dans le pire cas (deux
      // voisines jitrées l'une vers l'autre), il reste toujours la marge de ringSlotSpacing
      // ci-dessus entre elles. Rayon jitré indépendamment, dans une plage plus généreuse (peut
      // légèrement mordre sur l'anneau voisin) : aucun risque de collision, seul l'angle rapproche
      // deux lunes entre elles.
      const angleJitter = (stableUnitFromString(`${system.id}:angle`) - 0.5) * slotAngleWidth * 0.3;
      const radiusJitter = (stableUnitFromString(`${system.id}:radius`) - 0.5) * spacing * 0.7;
      const angle = baseAngle + angleJitter;
      const moonRadialDistance = radialDistance + radiusJitter;
      const moon = document.createElement("span");
      moon.className = "universe-galaxy-moon";
      // Teintées comme leur galaxie plutôt qu'en or/crème fixe (demande du 17/08/2026) — même
      // hue que cette galaxie (hueForGalaxy), lu par le dégradé/halo en CSS.
      moon.style.setProperty("--moon-hue", String(hue));
      moon.dataset.solarSystemId = String(system.id);
      moon.setAttribute("aria-hidden", "true");
      // galaxyId : lu par onCameraChange pour masquer ces lunes dès que les systèmes solaires de
      // LEUR galaxie deviennent visibles (demande du 13/08/2026, "quand je vois les solars, je ne
      // veux plus voir ces lunes") — même bascule is-revealed que la bulle galaxie elle-même
      // (childrenCanShow), pour rester synchronisé avec elle plutôt que de suivre un seuil propre.
      moon.dataset.galaxyId = galaxy.id;
      moon.style.left = Math.round(galaxy.x + Math.cos(angle) * moonRadialDistance - moonSize / 2) + "px";
      moon.style.top = Math.round(galaxy.y + Math.sin(angle) * moonRadialDistance - moonSize / 2) + "px";
      moon.style.width = moonSize + "px";
      moon.style.height = moonSize + "px";
      worldEl.appendChild(moon);
      systemIndex += 1;
    }
    ringIndex += 1;
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
  btn.className = `mnoria-tag-bubble universe-zoom-bubble${extraClass ? " " + extraClass : ""}`;
  btn.dataset.kind = kind;
  btn.dataset.nodeId = node.id;
  if (Number.isFinite(node.themeHue)) btn.dataset.themeHue = String(node.themeHue);
  btn.style.left = (node.x - node.r) + "px";
  btn.style.top = (node.y - node.r) + "px";
  // .mnoria-tag-bubble ne fixe pas width/height elle-même (ça vient normalement de
  // .mnoria-tag-bubble-large/-medium/-small, un système de paliers propre à tagTrendCloud.js,
  // non utilisé ici) : posé directement en inline, une taille continue plutôt que 3 paliers.
  btn.style.width = node.r * 2 + "px";
  btn.style.height = node.r * 2 + "px";
  btn.style.setProperty("--mnoria-tag-bubble-size", node.r * 2 + "px");
  if (background) btn.style.background = background;
  if (glowColor) btn.style.setProperty("--mnoria-tag-bubble-glow", glowColor);
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
  // Modificateur par niveau, du plus petit au plus grand (étoile < système < galaxie, demande
  // du 16/08/2026, "bien les distinguer") — un seul à la fois, cf. style.css pour les tailles.
  const labelLevelClass = kind === "star" ? " universe-zoom-bubble-label-star"
    : kind === "solarSystem" ? " universe-zoom-bubble-label-solar"
    : kind === "galaxy" ? " universe-zoom-bubble-label-galaxy"
    : "";
  label.className = `universe-zoom-bubble-label${labelLevelClass}`;
  label.textContent = node.name;
  labelsOverlayEl.appendChild(label);
  labelElByNodeId.set(node.id, label);

  worldEl.appendChild(btn);
  return btn;
}

// ---- Petite minimap / radar cosmique --------------------------------------------------------

function computeUniverseMinimapBounds() {
  const nodes = [
    ...(worldLayout?.galaxies || []),
    ...(worldLayout?.solarSystems || []),
    ...(worldLayout?.stars || [])
  ];
  if (!nodes.length) return { minX: -1, maxX: 1, minY: -1, maxY: 1 };

  let { minX, maxX, minY, maxY } = computeUniverseWorldBounds(worldLayout);

  const fallbackSpan = Math.max(2, (worldLayout?.worldRadius || 1) * 2);
  let width = Math.max(1, maxX - minX);
  let height = Math.max(1, maxY - minY);
  const marginX = Math.max(width * 0.14, fallbackSpan * 0.06);
  const marginY = Math.max(height * 0.14, fallbackSpan * 0.06);
  minX -= marginX;
  maxX += marginX;
  minY -= marginY;
  maxY += marginY;
  width = maxX - minX;
  height = maxY - minY;

  // Agrandit l'axe le plus court pour conserver les proportions monde dans le petit radar.
  // Aucun étirement artificiel : les distances relatives restent donc lisibles.
  const mapAspect = (MINIMAP_VIEWBOX_W - MINIMAP_PADDING * 2) / (MINIMAP_VIEWBOX_H - MINIMAP_PADDING * 2);
  const worldAspect = width / height;
  if (worldAspect > mapAspect) {
    const targetHeight = width / mapAspect;
    const extra = (targetHeight - height) / 2;
    minY -= extra;
    maxY += extra;
  } else {
    const targetWidth = height * mapAspect;
    const extra = (targetWidth - width) / 2;
    minX -= extra;
    maxX += extra;
  }

  return { minX, maxX, minY, maxY };
}

function worldToMinimap(worldX, worldY) {
  if (!minimapBounds) return { x: MINIMAP_VIEWBOX_W / 2, y: MINIMAP_VIEWBOX_H / 2 };
  const innerW = MINIMAP_VIEWBOX_W - MINIMAP_PADDING * 2;
  const innerH = MINIMAP_VIEWBOX_H - MINIMAP_PADDING * 2;
  return {
    x: MINIMAP_PADDING + ((worldX - minimapBounds.minX) / (minimapBounds.maxX - minimapBounds.minX)) * innerW,
    y: MINIMAP_PADDING + ((worldY - minimapBounds.minY) / (minimapBounds.maxY - minimapBounds.minY)) * innerH
  };
}

function minimapToWorld(mapX, mapY) {
  if (!minimapBounds) return { x: 0, y: 0 };
  const innerW = MINIMAP_VIEWBOX_W - MINIMAP_PADDING * 2;
  const innerH = MINIMAP_VIEWBOX_H - MINIMAP_PADDING * 2;
  const normalizedX = Math.min(1, Math.max(0, (mapX - MINIMAP_PADDING) / innerW));
  const normalizedY = Math.min(1, Math.max(0, (mapY - MINIMAP_PADDING) / innerH));
  return {
    x: minimapBounds.minX + normalizedX * (minimapBounds.maxX - minimapBounds.minX),
    y: minimapBounds.minY + normalizedY * (minimapBounds.maxY - minimapBounds.minY)
  };
}

function updateUniverseMinimap(state) {
  if (!minimapEl || !minimapViewportRectEl || !minimapPositionEl || !minimapBounds || !viewportEl) return;

  const scaleLimits = camera?.getScaleLimits?.();
  if (scaleLimits) {
    const epsilon = Math.max(0.0001, scaleLimits.maxScale * 0.00001);
    if (minimapZoomOutBtn) minimapZoomOutBtn.hidden = state.scale <= scaleLimits.minScale + epsilon;
    if (minimapZoomInBtn) minimapZoomInBtn.hidden = state.scale >= scaleLimits.maxScale - epsilon;
    if (minimapZoomControlsEl) {
      minimapZoomControlsEl.hidden = !!(minimapZoomOutBtn?.hidden && minimapZoomInBtn?.hidden);
    }
  }

  const halfWorldW = viewportEl.clientWidth / (2 * state.scale);
  const halfWorldH = viewportEl.clientHeight / (2 * state.scale);
  const viewportStart = worldToMinimap(state.x - halfWorldW, state.y - halfWorldH);
  const viewportEnd = worldToMinimap(state.x + halfWorldW, state.y + halfWorldH);
  minimapViewportRectEl.setAttribute("x", String(Math.min(viewportStart.x, viewportEnd.x)));
  minimapViewportRectEl.setAttribute("y", String(Math.min(viewportStart.y, viewportEnd.y)));
  minimapViewportRectEl.setAttribute("width", String(Math.max(2.5, Math.abs(viewportEnd.x - viewportStart.x))));
  minimapViewportRectEl.setAttribute("height", String(Math.max(2.5, Math.abs(viewportEnd.y - viewportStart.y))));

  const cameraPoint = worldToMinimap(state.x, state.y);
  const clampedX = Math.min(MINIMAP_VIEWBOX_W - MINIMAP_PADDING, Math.max(MINIMAP_PADDING, cameraPoint.x));
  const clampedY = Math.min(MINIMAP_VIEWBOX_H - MINIMAP_PADDING, Math.max(MINIMAP_PADDING, cameraPoint.y));
  minimapPositionEl.setAttribute("cx", String(clampedX));
  minimapPositionEl.setAttribute("cy", String(clampedY));
  minimapPositionEl.classList.toggle("is-outside", clampedX !== cameraPoint.x || clampedY !== cameraPoint.y);

  // Repère de zone stable : une nouvelle galaxie ne devient active que si elle est nettement
  // plus proche (22 %) que la précédente, afin d'éviter un clignotement aux frontières.
  const galaxies = worldLayout?.galaxies || [];
  let nearest = null;
  galaxies.forEach((galaxy) => {
    const distance = Math.hypot(state.x - galaxy.x, state.y - galaxy.y);
    if (!nearest || distance < nearest.distance) nearest = { galaxy, distance };
  });
  const currentGalaxy = galaxies.find((galaxy) => galaxy.id === minimapActiveGalaxyId);
  const currentDistance = currentGalaxy ? Math.hypot(state.x - currentGalaxy.x, state.y - currentGalaxy.y) : Infinity;
  if (nearest && (!currentGalaxy || nearest.galaxy.id === currentGalaxy.id || nearest.distance < currentDistance * 0.78)) {
    minimapActiveGalaxyId = nearest.galaxy.id;
  }
  minimapMarkerByNodeId.forEach((marker, nodeId) => {
    marker.classList.toggle("is-current", nodeId === minimapActiveGalaxyId);
  });
  const activeGalaxy = galaxies.find((galaxy) => galaxy.id === minimapActiveGalaxyId);
  minimapEl.setAttribute("aria-label", activeGalaxy
    ? `Repère spatial de Ma mémoire, zone ${activeGalaxy.name}`
    : "Repère spatial de Ma mémoire");
}

function createUniverseMinimap() {
  if (!viewportEl || !worldLayout) return;
  const svgNs = "http://www.w3.org/2000/svg";
  minimapBounds = computeUniverseMinimapBounds();
  minimapMarkerByNodeId.clear();
  minimapActiveGalaxyId = null;

  minimapEl = document.createElement("div");
  minimapEl.className = "universe-minimap";
  minimapEl.setAttribute("role", "group");
  minimapEl.setAttribute("aria-label", "Repère spatial de Ma mémoire");
  minimapEl.dataset.minX = String(minimapBounds.minX);
  minimapEl.dataset.maxX = String(minimapBounds.maxX);
  minimapEl.dataset.minY = String(minimapBounds.minY);
  minimapEl.dataset.maxY = String(minimapBounds.maxY);

  minimapSvgEl = document.createElementNS(svgNs, "svg");
  minimapSvgEl.classList.add("universe-minimap__map");
  minimapSvgEl.setAttribute("viewBox", `0 0 ${MINIMAP_VIEWBOX_W} ${MINIMAP_VIEWBOX_H}`);
  minimapSvgEl.setAttribute("aria-label", "Carte des grandes thématiques");
  minimapSvgEl.setAttribute("role", "group");

  const clipId = `universe-minimap-clip-${++minimapClipIdCounter}`;
  const defs = document.createElementNS(svgNs, "defs");
  const clipPath = document.createElementNS(svgNs, "clipPath");
  clipPath.id = clipId;
  const clipRect = document.createElementNS(svgNs, "rect");
  clipRect.setAttribute("x", String(MINIMAP_PADDING));
  clipRect.setAttribute("y", String(MINIMAP_PADDING));
  clipRect.setAttribute("width", String(MINIMAP_VIEWBOX_W - MINIMAP_PADDING * 2));
  clipRect.setAttribute("height", String(MINIMAP_VIEWBOX_H - MINIMAP_PADDING * 2));
  clipRect.setAttribute("rx", "6");
  clipPath.appendChild(clipRect);
  defs.appendChild(clipPath);
  minimapSvgEl.appendChild(defs);

  const field = document.createElementNS(svgNs, "rect");
  field.classList.add("universe-minimap__field");
  field.setAttribute("x", String(MINIMAP_PADDING));
  field.setAttribute("y", String(MINIMAP_PADDING));
  field.setAttribute("width", String(MINIMAP_VIEWBOX_W - MINIMAP_PADDING * 2));
  field.setAttribute("height", String(MINIMAP_VIEWBOX_H - MINIMAP_PADDING * 2));
  field.setAttribute("rx", "6");
  minimapSvgEl.appendChild(field);

  const markerLayer = document.createElementNS(svgNs, "g");
  markerLayer.setAttribute("clip-path", `url(#${clipId})`);
  (worldLayout.galaxies || []).forEach((galaxy) => {
    const point = worldToMinimap(galaxy.x, galaxy.y);
    const marker = document.createElementNS(svgNs, "g");
    marker.classList.add("universe-minimap__marker");
    marker.dataset.nodeId = galaxy.id;
    marker.setAttribute("role", "button");
    marker.setAttribute("tabindex", "0");
    marker.setAttribute("aria-label", `Centrer sur ${galaxy.name}`);
    marker.style.setProperty("--universe-minimap-hue", String(galaxy.themeHue ?? hueForGalaxy(galaxy.name)));
    marker.setAttribute("transform", `translate(${point.x} ${point.y})`);

    const hitArea = document.createElementNS(svgNs, "circle");
    hitArea.classList.add("universe-minimap__marker-hit");
    hitArea.setAttribute("r", "7");
    const dot = document.createElementNS(svgNs, "circle");
    dot.classList.add("universe-minimap__marker-dot");
    dot.setAttribute("r", String(2.8 + Math.min(1.4, Math.log1p(Math.max(1, galaxy.weight || 1)) * 0.16)));
    const title = document.createElementNS(svgNs, "title");
    title.textContent = galaxy.name;
    marker.append(hitArea, dot, title);
    marker.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      const currentScale = camera?.getState().scale || 1;
      camera?.setState({ x: galaxy.x, y: galaxy.y, scale: currentScale }, true);
    });
    markerLayer.appendChild(marker);
    minimapMarkerByNodeId.set(galaxy.id, marker);
  });
  minimapSvgEl.appendChild(markerLayer);

  minimapViewportRectEl = document.createElementNS(svgNs, "rect");
  minimapViewportRectEl.classList.add("universe-minimap__viewport");
  minimapViewportRectEl.setAttribute("clip-path", `url(#${clipId})`);
  minimapViewportRectEl.setAttribute("rx", "1.5");
  minimapSvgEl.appendChild(minimapViewportRectEl);

  minimapPositionEl = document.createElementNS(svgNs, "circle");
  minimapPositionEl.classList.add("universe-minimap__position");
  minimapPositionEl.setAttribute("r", "1.8");
  minimapSvgEl.appendChild(minimapPositionEl);

  const recenterBtn = document.createElement("button");
  recenterBtn.type = "button";
  recenterBtn.className = "universe-minimap__recenter";
  recenterBtn.setAttribute("aria-label", "Recentrer Ma mémoire");
  recenterBtn.title = "Recentrer";
  recenterBtn.textContent = "◎";
  recenterBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    zoomToRoot();
  });

  minimapZoomControlsEl = document.createElement("div");
  minimapZoomControlsEl.className = "universe-minimap__zoom-controls";
  minimapZoomControlsEl.setAttribute("role", "group");
  minimapZoomControlsEl.setAttribute("aria-label", "Contrôles de zoom de Ma mémoire");

  const createZoomButton = (direction) => {
    const isZoomIn = direction === "in";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `universe-minimap__zoom-button universe-minimap__zoom-button--${direction}`;
    button.setAttribute("aria-label", isZoomIn ? "Zoomer dans Ma mémoire" : "Dézoomer dans Ma mémoire");
    button.title = isZoomIn ? "Zoomer" : "Dézoomer";
    button.textContent = isZoomIn ? "+" : "−";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      camera?.zoomBy(isZoomIn ? 1.45 : 1 / 1.45, true);
    });
    return button;
  };
  minimapZoomOutBtn = createZoomButton("out");
  minimapZoomInBtn = createZoomButton("in");
  // Position visuelle fixée en CSS (--in à gauche, --out à droite, cf. style.css), pas par
  // l'ordre DOM : chaque bouton garde sa place même quand l'autre se masque en butée de zoom
  // min/max (demande du 17/08/2026, "doivent toujours rester à la même place"). L'ordre
  // d'ajout ici ne pilote donc plus que l'ordre de tabulation clavier.
  minimapZoomControlsEl.append(minimapZoomInBtn, minimapZoomOutBtn);

  let dragState = null;
  const eventToMapPoint = (event) => {
    const rect = minimapSvgEl.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * MINIMAP_VIEWBOX_W,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * MINIMAP_VIEWBOX_H
    };
  };
  minimapSvgEl.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    minimapSvgEl.setPointerCapture(event.pointerId);
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      nodeId: event.target.closest?.("[data-node-id]")?.dataset.nodeId || null
    };
  });
  minimapSvgEl.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) > 3) dragState.moved = true;
    if (!dragState.moved) return;
    const point = eventToMapPoint(event);
    const worldPoint = minimapToWorld(point.x, point.y);
    camera?.setState({ x: worldPoint.x, y: worldPoint.y }, false);
  });
  const finishMinimapPointer = (event, cancelled = false) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (!cancelled && !dragState.moved) {
      const node = dragState.nodeId ? nodeById.get(dragState.nodeId) : null;
      if (node) {
        camera?.setState({ x: node.x, y: node.y }, true);
      } else {
        const point = eventToMapPoint(event);
        const worldPoint = minimapToWorld(point.x, point.y);
        camera?.setState({ x: worldPoint.x, y: worldPoint.y }, true);
      }
    }
    if (minimapSvgEl.hasPointerCapture?.(event.pointerId)) minimapSvgEl.releasePointerCapture(event.pointerId);
    dragState = null;
  };
  minimapSvgEl.addEventListener("pointerup", (event) => finishMinimapPointer(event));
  minimapSvgEl.addEventListener("pointercancel", (event) => finishMinimapPointer(event, true));
  minimapSvgEl.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  minimapEl.addEventListener("pointerdown", (event) => event.stopPropagation());
  minimapEl.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
  ["gesturestart", "gesturechange", "gestureend"].forEach((type) => {
    minimapEl.addEventListener(type, (event) => event.stopPropagation());
  });
  minimapZoomControlsEl.addEventListener("pointerdown", (event) => event.stopPropagation());
  minimapZoomControlsEl.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
  ["gesturestart", "gesturechange", "gestureend"].forEach((type) => {
    minimapZoomControlsEl.addEventListener(type, (event) => event.stopPropagation());
  });

  // Dans le PETIT cadre repère (minimapEl), pas dans le grand cadre principal (demande du
  // 17/08/2026, "tu les avais mis en haut du grand cadre !!! moi je veux du tout petit cadre de
  // repère") — enfant de minimapEl plutôt que sibling posé sur toute la largeur de viewportEl.
  // Au-dessus du petit cadre repère, pas à l'intérieur (demande du 17/08/2026, reprise après un
  // premier essai posé en interne) : sibling de minimapEl plutôt qu'enfant, positionné en CSS
  // pour s'aligner sur sa largeur/son bord droit juste au-dessus (cf. style.css).
  // Revenu à l'intérieur du petit cadre repère (demande du 17/08/2026) : positionné au-dessus
  // (bottom:110px, sibling de minimapEl) faisait disparaître les boutons dès que le cadre
  // n'était pas assez haut — overflow:hidden sur viewportEl (cf. style.css) les coupait. La
  // hauteur du cadre étant trop variable cette session pour fiabiliser un offset absolu, on
  // reste sur un placement garanti toujours visible : à l'intérieur du petit cadre lui-même.
  // Au-dessus du petit cadre repère, EN DEHORS de lui (demande du 17/08/2026, insistance après
  // 2 essais) : sibling de viewportEl, enfant direct de cloudEl (#mnoria-universe-cloud /
  // #mnoria-tag-trends-cloud) plutôt que de viewportEl ou minimapEl — ces deux derniers ont
  // overflow:hidden (cf. style.css), qui coupait les boutons dès qu'ils sortaient de leurs
  // limites ("ils ont disparu"). cloudEl a overflow:visible : peints même si l'estimation
  // d'offset n'est pas pixel-parfaite, jamais invisibles.
  minimapEl.append(minimapSvgEl, recenterBtn);
  viewportEl.append(minimapEl);
  cloudEl.appendChild(minimapZoomControlsEl);

  // Petit panneau d'isolement (demande du 17/08/2026) : noms des 2 étoiles + rappel "clique
  // n'importe où". Enfant de cloudEl (overflow:visible, cf. commentaire ci-dessus sur les
  // boutons de zoom) plutôt que de viewportEl, pour ne jamais être coupé si le cadre est bas.
  isolationInfoEl = document.createElement("div");
  isolationInfoEl.className = "universe-isolation-info";
  isolationInfoEl.hidden = true;
  cloudEl.appendChild(isolationInfoEl);

  // Trait entre les 2 lunes des systèmes solaires isolés (demande du 17/08/2026) — même couche
  // écran que les liens de connaissance (cf. leur commentaire sur le flou à fort zoom), jamais
  // dans worldEl.
  moonLinkEl = document.createElement("div");
  moonLinkEl.className = "universe-knowledge-link universe-moon-link";
  // Hors boucle knowledgeLinkEls (cf. onCameraChange) : jamais recalculés par elle, donc posés
  // une fois ici plutôt que par frame (ce trait ponctuel n'a pas besoin de varier avec le zoom,
  // déjà en coordonnées écran réelles via getBoundingClientRect).
  moonLinkEl.style.height = "2px";
  moonLinkEl.style.backgroundSize = "12px 100%";
  moonLinkEl.style.boxShadow = "0 0 1px rgba(151, 224, 255, 1), 0 0 2px rgba(105, 205, 255, 0.85)";
  linksOverlayEl.appendChild(moonLinkEl);
}

// ---- Montage complet de la scène (une seule fois par chargement de données) ----
function destroyUniverseScene() {
  camera = null;
  if (universeBgResizeObserver) universeBgResizeObserver.disconnect();
  universeBgResizeObserver = null;
  if (viewportEl) viewportEl.remove();
  viewportEl = null;
  // Enfant direct de cloudEl désormais, pas de viewportEl (cf. mountUniverse) : jamais retiré
  // par viewportEl.remove() ci-dessus, resterait orphelin en double au remontage suivant.
  if (minimapZoomControlsEl) minimapZoomControlsEl.remove();
  if (isolationInfoEl) isolationInfoEl.remove();
  isolationInfoEl = null;
  moonLinkEl = null; // enfant de linksOverlayEl, déjà retiré par viewportEl.remove() ci-dessus
  isolatedStarPair = null;
  worldEl = null;
  labelsOverlayEl = null;
  linksOverlayEl = null;
  minimapEl = null;
  minimapSvgEl = null;
  minimapViewportRectEl = null;
  minimapPositionEl = null;
  minimapZoomControlsEl = null;
  minimapZoomInBtn = null;
  minimapZoomOutBtn = null;
  minimapBounds = null;
  minimapActiveGalaxyId = null;
  minimapMarkerByNodeId.clear();
  labelElByNodeId.clear();
  connectorElByNodeId.clear();
  knowledgeLinkEls.length = 0;
  nodeById.clear();
}

// Trait lumineux reliant une étoile à son système solaire (satellite, cf.
// packSatellitesAroundPoint, universe-zoom.js) — un simple <div> tourné/étiré entre les deux
// points, dans l'espace "monde" (enfant de worldEl, mis à l'échelle avec le reste de la scène).
// Épaisseur visée à l'écran (px), quel que soit le niveau de zoom — cf. onCameraChange, qui pose
// height = CONNECTOR_SCREEN_PX / state.scale à chaque frame (jamais une valeur fixe posée ici à
// la création : un enfant de worldEl voit sa taille multipliée par state.scale comme le reste de
// la scène, cf. son commentaire).
// 2 -> 3px (demande du 16/08/2026, "toujours pas assez visible, légèrement plus gros") : reste
// nettement plus fin que les connecteurs de liens intellectuels (screenThickness jusqu'à 3.35px
// dans onCameraChange), juste un cran plus épais qu'avant.
const CONNECTOR_SCREEN_PX = 3;

// toRadius (rayon "monde" de l'étoile d'arrivée) raccourcit le trait pour qu'il s'arrête à sa
// bordure plutôt qu'à son centre (demande du 17/08/2026) — jamais le départ (le système solaire
// reste l'ancrage visuel, cf. son point lumineux).
function createConnectorEl(fromX, fromY, toX, toY, toRadius = 0) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const fullLength = Math.hypot(dx, dy);
  const length = Math.max(0, fullLength - toRadius);
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

function knowledgeNodeKey(sourceType, sourceId) {
  return `${String(sourceType || "").trim()}::${String(sourceId || "").trim()}`;
}

// Tirets bleutés lumineux entre deux étoiles reliées intellectuellement. Posés dans
// labelsOverlayEl (coordonnées ÉCRAN, comme les libellés), pas dans le monde transformé
// (worldEl) : un enfant de worldEl est rendu minuscule puis agrandi par transform:scale à
// fort zoom, ce qui le floute (même cause que le texte flou déjà documentée pour les
// libellés, signalé à nouveau le 17/08/2026 pour ces traits — "pas nettes... surtout zoomé").
// Repositionnés à chaque frame de caméra dans onCameraChange, jamais ici (la caméra n'a pas
// encore de position tant que le montage n'est pas terminé).
function createKnowledgeLinkEl(level, fromNode, toNode, articleLink) {
  const el = document.createElement("div");
  el.className = "universe-knowledge-link";
  // Double-clic pour isoler la paire (restauré le 17/08/2026 : confirmé fonctionnel — seule la
  // zone cliquable élargie, ::before de +12px, débordait sur les étoiles adjacentes et cassait
  // leur propre clic ; retirée, jamais réintroduite). Le conteneur reste pointer-events:none
  // (cf. style.css) : seul ce trait précis, sur son propre tracé exact, redevient cliquable.
  if (level === "star") {
    el.style.pointerEvents = "auto";
    el.style.cursor = "pointer";
    // Retrouve les 2 connaissances précises (pas juste les étoiles qui les contiennent, qui
    // peuvent en regrouper plusieurs) à l'origine de CE lien, pour permettre d'ouvrir directement
    // leurs fiches depuis la fenêtre d'isolement (cf. setIsolatedStarPair, demande du 03/09/2026).
    const fromStarRef = fromNode.ref;
    const toStarRef = toNode.ref;
    const fromArticle = (fromStarRef?.articles || []).find(
      (a) => a.sourceType === articleLink?.typeA && String(a.sourceDebateId) === String(articleLink?.sourceIdA)
    );
    const toArticle = (toStarRef?.articles || []).find(
      (a) => a.sourceType === articleLink?.typeB && String(a.sourceDebateId) === String(articleLink?.sourceIdB)
    );
    const toggleIsolation = () => {
      const alreadyIsolated = isolatedStarPair
        && isolatedStarPair.has(fromNode.id) && isolatedStarPair.has(toNode.id);
      setIsolatedStarPair(
        alreadyIsolated ? null : new Set([fromNode.id, toNode.id]),
        fromNode, toNode,
        fromArticle, fromStarRef,
        toArticle, toStarRef
      );
    };
    el.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleIsolation();
    });
    let lastTapAt = 0;
    el.addEventListener("pointerup", (event) => {
      // Sans ce clear, le minuteur de clic prolongé démarré par CE MÊME appui (pointerdown
      // ci-dessous) restait actif après un relâchement normal — il finissait par se déclencher
      // ~500ms plus tard, alors qu'un double-tap l'avait déjà basculé entre-temps, refermant la
      // fenêtre juste après son ouverture (demande du 03/09/2026, corrigé avec le bug ci-dessous).
      clearLongPressTimer();
      if (longPressFired) { longPressFired = false; return; } // déjà déclenché par le pointerdown ci-dessous
      if (event.pointerType !== "touch") return;
      const now = Date.now();
      if (now - lastTapAt < 400) {
        event.preventDefault();
        event.stopPropagation();
        toggleIsolation();
        lastTapAt = 0;
      } else {
        lastTapAt = now;
      }
    });
    // Clic prolongé (souris ou tactile), en plus du double-clic/double-tap ci-dessus (demande du
    // 03/09/2026) : maintenir le pointeur sur le trait pendant LONG_PRESS_MS bascule l'isolement
    // sans attendre un second clic. Un déplacement (pointermove au-delà d'une petite tolérance),
    // un relâchement prématuré ou une sortie du trait annule le minuteur — appui bref normal,
    // laissé au double-clic/double-tap existant.
    const LONG_PRESS_MS = 500;
    const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
    let longPressTimer = null;
    let longPressFired = false;
    let longPressStartX = 0;
    let longPressStartY = 0;
    const clearLongPressTimer = () => {
      if (longPressTimer) clearTimeout(longPressTimer);
      longPressTimer = null;
    };
    el.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      // Sans ce preventDefault, Safari iOS lance en parallèle sa propre sélection de
      // texte/callout ("Copier", loupe) sur l'appui maintenu — cf. -webkit-touch-callout/
      // user-select:none déjà posés en CSS (style.css), qui seuls ne suffisaient pas à eux seuls
      // sur certaines versions (demande du 03/09/2026, "ça sélectionne le cadre").
      event.preventDefault();
      clearLongPressTimer();
      longPressFired = false;
      longPressStartX = event.clientX;
      longPressStartY = event.clientY;
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        longPressFired = true;
        toggleIsolation();
      }, LONG_PRESS_MS);
    });
    el.addEventListener("pointermove", (event) => {
      if (!longPressTimer) return;
      const dx = event.clientX - longPressStartX;
      const dy = event.clientY - longPressStartY;
      if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE_PX) clearLongPressTimer();
    });
    el.addEventListener("pointerleave", clearLongPressTimer);
    el.addEventListener("pointercancel", clearLongPressTimer);
    el.addEventListener("contextmenu", (event) => event.preventDefault());
  }
  linksOverlayEl.appendChild(el);
  const linkState = { el, level, fromNodeId: fromNode.id, toNodeId: toNode.id, count: 1 };
  knowledgeLinkEls.push(linkState);
  return linkState;
}

function mountUniverse() {
  destroyUniverseScene();

  viewportEl = document.createElement("div");
  viewportEl.className = "universe-zoom-viewport";
  // Fond infini zoomable : une seule couche sous worldEl, remplie par la texture PNG seamless
  // répétée par le moteur CSS. Aucun <img> ni grille de tuiles DOM n'est créé, même si le monde
  // s'étend très loin. La caméra met uniquement à jour background-position/background-size.
  const backgroundEl = document.createElement("div");
  backgroundEl.className = "universe-zoom-background";
  worldEl = document.createElement("div");
  worldEl.className = "universe-zoom-world";
  // Couche dédiée aux liens de connaissance, INSÉRÉE AVANT worldEl (demande du 17/08/2026, "ne
  // doivent passer par-dessus aucun élément") : ni z-index ni transform explicites sur elle ni
  // sur worldEl, donc l'ordre du DOM seul détermine l'empilement — ici toujours EN DESSOUS de
  // toutes les bulles/moons/connecteurs de worldEl. Coordonnées écran comme labelsOverlayEl
  // (jamais enfant de worldEl, cf. son commentaire), pour la même raison : éviter le flou à fort
  // zoom d'un élément fin mis à l'échelle.
  linksOverlayEl = document.createElement("div");
  linksOverlayEl.className = "universe-zoom-links-overlay";
  // Sibling de worldEl (pas un enfant) : reste en dehors de son transform:scale, cf. le
  // commentaire sur labelsOverlayEl plus haut.
  labelsOverlayEl = document.createElement("div");
  labelsOverlayEl.className = "universe-zoom-labels-overlay";
  viewportEl.appendChild(backgroundEl);
  viewportEl.appendChild(linksOverlayEl);
  viewportEl.appendChild(worldEl);
  viewportEl.appendChild(labelsOverlayEl);
  cloudEl.appendChild(viewportEl);

  // Sur l'accueil uniquement, le bouton plein écran appartient directement au cadre étoilé.
  // Le placer dans le fil d'Ariane le rendait invisible dans les configurations où ce bandeau
  // est masqué ou déplacé. Ici il partage le contexte d'empilement de la scène et reste donc
  // toujours visible, indépendamment du niveau de navigation affiché.
  if (cloudEl.id === "mnoria-tag-trends-cloud") {
    cloudEl.querySelector("#mnoria-memory-fullpage-btn")?.remove();
    const fullPageButton = document.createElement("a");
    fullPageButton.id = "mnoria-memory-fullpage-btn";
    fullPageButton.className = "mnoria-memory-fullpage-btn";
    fullPageButton.href = "/mon-univers";
    fullPageButton.setAttribute("aria-label", "Ouvrir Ma mémoire sur toute la page");
    fullPageButton.innerHTML = '<i class="fa-solid fa-expand" aria-hidden="true"></i><span>Plein écran</span>';
    // /mon-univers rejoint le système d'iframe modale (demande du 03/09/2026) : ouvre la
    // scène déjà chargée dans le modal parent plutôt que de renaviguer entièrement.
    fullPageButton.addEventListener("click", (event) => {
      event.preventDefault();
      if (typeof window.openDebateIframeModal === "function") window.openDebateIframeModal("/mon-univers");
      else window.location.href = "/mon-univers";
    });
    cloudEl.appendChild(fullPageButton);
  }
  let backgroundTileMetrics = syncMnoriaTileMetrics();
  if (universeBgResizeObserver) universeBgResizeObserver.disconnect();
  universeBgResizeObserver = new ResizeObserver(() => {
    backgroundTileMetrics = syncMnoriaTileMetrics();
    if (camera) {
      camera.setBackgroundTileSize(backgroundTileMetrics.width, backgroundTileMetrics.height);
      camera.refresh();
    }
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

  // Un article acquis connaît son identité stable type + sourceDebateId. Elle permet de
  // retrouver l'étoile qui le contient, y compris si plusieurs connaissances ont été regroupées
  // dans une même étoile par la classification. Une relation interne à une seule étoile n'est
  // pas dessinée : ses deux extrémités occupent déjà le même point visuel.
  const starNodeByKnowledgeKey = new Map();
  worldLayout.stars.forEach((star) => {
    (star.ref?.articles || []).forEach((article) => {
      const key = knowledgeNodeKey(article.sourceType, article.sourceDebateId);
      if (key !== "::") starNodeByKnowledgeKey.set(key, star);
    });
  });
  const galaxyNodeById = new Map(worldLayout.galaxies.map((node) => [node.id, node]));
  const solarNodeById = new Map(worldLayout.solarSystems.map((node) => [node.id, node]));
  const renderedKnowledgePairs = new Map();
  (universeData.knowledgeLinks || []).forEach((link) => {
    const fromStar = starNodeByKnowledgeKey.get(knowledgeNodeKey(link.typeA, link.sourceIdA));
    const toStar = starNodeByKnowledgeKey.get(knowledgeNodeKey(link.typeB, link.sourceIdB));
    if (!fromStar || !toStar) return;

    const pairsByLevel = [
      ["galaxy", galaxyNodeById.get(fromStar.galaxyId), galaxyNodeById.get(toStar.galaxyId)],
      ["solarSystem", solarNodeById.get(fromStar.solarSystemId), solarNodeById.get(toStar.solarSystemId)],
      ["star", fromStar, toStar]
    ];
    pairsByLevel.forEach(([level, fromNode, toNode]) => {
      if (!fromNode || !toNode || fromNode.id === toNode.id) return;
      const pairKey = `${level}:${[fromNode.id, toNode.id].sort().join("|")}`;
      const existingLink = renderedKnowledgePairs.get(pairKey);
      if (existingLink) {
        // Plusieurs relations intellectuelles peuvent converger vers les mêmes objets parents
        // (notamment plusieurs paires d'étoiles appartenant aux deux mêmes solars/galaxies).
        // Une seule ligne est conservée ; son épaisseur exprimera ce nombre dans le rendu.
        existingLink.count += 1;
        return;
      }
      renderedKnowledgePairs.set(pairKey, createKnowledgeLinkEl(level, fromNode, toNode, level === "star" ? link : null));
    });
  });

  worldLayout.galaxies.forEach((g) => {
    g.themeHue = hueForGalaxy(g.name);
    const visual = galaxyBubbleVisual(g.name);
    const el = createBubbleEl("galaxy", g, visual.background, visual.glowColor, "mnoria-tag-bubble-galaxy");
    el.classList.add("is-revealed"); // toujours visibles, jamais soumises au seuil de révélation
    addMoonsAroundGalaxy(g);
    nodeById.set(g.id, g);
  });

  worldLayout.solarSystems.forEach((s) => {
    const hue = hueForGalaxy(getGalaxyNameFromId(s.galaxyId));
    s.themeHue = hue;
    // Plus de glowColor (demande du 16/08/2026, "taches colorées floues qui ne servent à
    // rien" en mode solar) : ce halo (.mnoria-tag-bubble-solarsystem::before, style.css)
    // débordait largement du cercle réel et se lisait comme un flou sans forme, surtout sur
    // des systèmes petits/rapprochés — retiré, cf. style.css.
    createBubbleEl(
      "solarSystem",
      s,
      bubbleBackgroundFor(getGalaxyNameFromId(s.galaxyId), "solarSystem", true),
      null,
      "mnoria-tag-bubble-solarsystem"
    );
    nodeById.set(s.id, s);
  });

  worldLayout.stars.forEach((star) => {
    star.themeHue = hueForGalaxy(getGalaxyNameFromId(star.galaxyId));
    createBubbleEl(
      "star",
      star,
      bubbleBackgroundFor(getGalaxyNameFromId(star.galaxyId), "star", true),
      null,
      "mnoria-tag-bubble-star"
    );
    const parentSystem = nodeById.get(star.solarSystemId);
    if (parentSystem) {
      connectorElByNodeId.set(star.id, createConnectorEl(parentSystem.x, parentSystem.y, star.x, star.y, star.r));
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
    createBubbleEl("unclassified", unclassifiedNode, UNCLASSIFIED_BUBBLE_BACKGROUND, null, "mnoria-tag-bubble-unclassified");
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
    backgroundTileWidth: backgroundTileMetrics.width,
    backgroundTileHeight: backgroundTileMetrics.height,
    minScale: 1,
    maxScale,
    onChange: onCameraChange
  });
  createUniverseMinimap();
  camera.setState({ x: 0, y: 0, scale: 1 }, false);
  onCameraChange(camera.getState());
}

// Le montage DOM ci-dessus est synchrone, mais WebKit standalone peut différer d'une ou deux
// images la peinture de ce monde assez lourd (dégradés, halos, lunes et libellés). Retirer le
// sablier immédiatement après mountUniverse() révélait alors brièvement le seul fond étoilé,
// avant que les galaxies deviennent visibles. Attend une vraie galaxie racine peinte à pleine
// opacité, puis une image supplémentaire, sans jamais bloquer indéfiniment la navigation.
function waitForUniverseRootPaint(modeToken) {
  const startedAt = performance.now();
  const maxWaitMs = 15000;
  let textureSettled = false;
  ensureMnoriaTextureReady().then(() => { textureSettled = true; });

  return new Promise((resolve) => {
    const finishAfterPaint = () => requestAnimationFrame(() => resolve(true));
    const check = () => {
      // L'utilisateur a déjà quitté "Ma mémoire" : ce rendu périmé ne doit surtout pas retirer
      // le sablier du nouveau mode qui a pris le relais sur le même conteneur partagé.
      if (modeToken !== window._mnoriaCloudModeToken || !isMemoireEmbedActive()) {
        resolve(false);
        return;
      }

      const rootBubbles = cloudEl.querySelectorAll(
        '.universe-zoom-bubble[data-kind="galaxy"].is-revealed, ' +
        '.universe-zoom-bubble[data-kind="unclassified"].is-revealed'
      );
      const rootIsPainted = Array.from(rootBubbles).some((bubble) => {
        const rect = bubble.getBoundingClientRect();
        const opacity = parseFloat(getComputedStyle(bubble).opacity || "0");
        return rect.width > 0 && rect.height > 0 && opacity >= 0.98;
      });

      const section = document.getElementById("mnoria-tag-trends-section");
      const frameIsVisible = Boolean(
        cloudEl && !cloudEl.hidden &&
        (!section || (!section.hidden && getComputedStyle(section).visibility !== "hidden")) &&
        cloudEl.getBoundingClientRect().width > 0 &&
        cloudEl.getBoundingClientRect().height > 0
      );

      if (rootIsPainted && textureSettled && frameIsVisible) {
        finishAfterPaint();
        return;
      }
      if (performance.now() - startedAt >= maxWaitMs) {
        // Filet de sécurité : une bizarrerie de style ne doit jamais laisser le sablier bloqué.
        resolve(true);
        return;
      }
      requestAnimationFrame(check);
    };

    requestAnimationFrame(check);
  });
}

// mountUniverse() mesure la taille du cadre UNE SEULE FOIS (worldRadius, cf. son commentaire)
// pour calculer toute la disposition des galaxies — jamais recalculée ensuite (le
// ResizeObserver du fond ne corrige que la texture, pas le layout). Si le cadre est encore en
// transition CSS (#mnoria-universe-cloud/.mnoria-memoire-frame, transform 0.16s) au moment du
// montage — plausible juste après connexion desktop —, la disposition se cale sur une taille
// pas encore définitive : la caméra recadre ensuite sur la bonne taille, d'où un saut visible
// "zoomé puis dézoomé" (demande du 17/08/2026). On attend ici que la taille du cadre arrête de
// bouger (2 frames identiques d'affilée) avant de monter la scène, plutôt que de corriger après
// coup. 400ms de filet : largement au-dessus des 160ms de transition connus, jamais de blocage
// indéfini si le cadre ne se stabilise jamais pour une raison imprévue.
function waitForContainerSizeStable(el, maxWaitMs = 400) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let lastW = -1;
    let lastH = -1;
    let stableFrames = 0;
    const check = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0 && w === lastW && h === lastH) {
        stableFrames += 1;
        if (stableFrames >= 2) { resolve(); return; }
      } else {
        stableFrames = 0;
        lastW = w;
        lastH = h;
      }
      if (performance.now() - startedAt >= maxWaitMs) { resolve(); return; }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

// Demande du 30/08/2026 ("page intermédiaire avec sablier... le temps que le cadre se
// mette bien") : en standalone mobile à froid, --mnoria-home-trends-section-top (qui pilote
// la hauteur du cadre "Ma mémoire", cf. style.css) met un instant à se commiter pour de bon
// (script.js, syncMnoriaHomeTrendsSectionMinHeight — mesures provisoires documentées le
// 12/08/2026). waitForContainerSizeStable seul pouvait déclarer le cadre "stable" sur ce
// plateau transitoire (2 lectures identiques de clientWidth/Height) AVANT que ce commit n'ait
// eu lieu, montant alors les bulles sur une taille qui allait encore changer. window.__mnoria
// HomeTrendsSectionTopReady (posé par script.js, true par défaut hors standalone mobile) sert
// de signal indépendant : le sablier reste affiché tant qu'il n'est pas passé à true.
function waitForHomeTrendsSectionTopReady(maxWaitMs = 800) {
  return new Promise((resolve) => {
    if (window.__mnoriaHomeTrendsSectionTopReady) { resolve(); return; }
    const startedAt = performance.now();
    const check = () => {
      if (window.__mnoriaHomeTrendsSectionTopReady || performance.now() - startedAt >= maxWaitMs) { resolve(); return; }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

async function mountUniverseAndHideSpinnerWhenReady(modeToken) {
  await waitForHomeTrendsSectionTopReady();
  if (modeToken !== window._mnoriaCloudModeToken) return;
  await waitForContainerSizeStable(cloudEl);
  if (modeToken !== window._mnoriaCloudModeToken) return;
  mountUniverse();
  if (typeof window.__mnoriaHideBubbleCloudLoadingSpinner !== "function") return;
  const ready = await waitForUniverseRootPaint(modeToken);
  if (!ready || modeToken !== window._mnoriaCloudModeToken || !isMemoireEmbedActive()) return;
  window.__mnoriaHideBubbleCloudLoadingSpinner();
  window.dispatchEvent(new Event("mnoria:memoire-content-ready"));
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
  const revealedNodeIdsByLevel = {
    galaxy: new Set(),
    solarSystem: new Set(),
    star: new Set()
  };

  // Anti-chevauchement des étiquettes (demande du 17/08/2026, "les noms ne doivent jamais se
  // superposer") : chaque nœud pousse ici sa candidature (label + priorité) plutôt que de
  // basculer .is-revealed directement dans la boucle ci-dessous — la résolution des collisions
  // (comparaison des rectangles réels de chaque étiquette) n'a lieu qu'une fois TOUTES les
  // positions/tailles connues, cf. plus bas après cette boucle.
  const labelCandidates = [];
  const LABEL_LEVEL_PRIORITY = { galaxy: 0, unclassified: 0, solarSystem: 1, star: 2 };

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
      // Isolation étendue à TOUTES les galaxies, y compris celles des étoiles isolées
      // (demande du 17/08/2026, "même les concernées") — contrairement aux solars, aucune
      // galaxie ne reste comme ancrage.
      if (isolatedStarPair) revealed = false;
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
      if (kind === "star") {
        // Une étoile ne peut jamais précéder son système : on reproduit exactement les deux
        // conditions qui rendent le solar parent visible (galaxie déjà ouverte + solar assez
        // grand), puis on applique seulement le petit seuil progressif propre à l'étoile.
        const parentGalaxy = parent && nodeById.get(parent.galaxyId);
        const parentSolarVisible = parent && parentGalaxy
          && childrenCanShow(parentGalaxy, state.scale)
          && parent.r * state.scale >= REVEAL_PX_SELF;
        const selfReady = node.r * state.scale >= STAR_REVEAL_PX;
        revealed = parentSolarVisible && selfReady;
        // Isolation double-clic sur un lien étoile<->étoile (demande du 17/08/2026) : toute
        // autre étoile disparaît tant qu'une paire est isolée — cf. isolatedStarPair, posé par
        // createKnowledgeLinkEl. Les solars non parents des étoiles isolées disparaissent aussi
        // (cf. plus bas) ; galaxies non affectées. Connecteurs : même `revealed` que l'étoile.
        // Les 2 étoiles isolées, elles, restent affichées quel que soit le zoom (demande du
        // 17/08/2026, "le plus simple... les étoiles ne disparaissent jamais même en
        // dézoomant à fond") — remplace entièrement le calcul normal ci-dessus pour elles.
        if (isolatedStarPair) revealed = isolatedStarPair.has(nodeId);
      } else {
        const parentCeded = parent && childrenCanShow(parent, state.scale);
        const selfRevealed = node.r * state.scale >= REVEAL_PX_SELF;
        revealed = parentCeded && selfRevealed;
        // Isolation étendue aux solars (demande du 17/08/2026) : un solar parent d'une étoile
        // isolée reste TOUJOURS affiché, quel que soit le zoom — comme l'étoile elle-même
        // (remplace entièrement le calcul normal ci-dessus, pas seulement en cas contraire) : à
        // fond dézoomé, il rétrécit juste avec le reste de la scène plutôt que de disparaître
        // ("ne fais pas disparaître les solars... rends-les juste plus petits"). Un solar non
        // concerné, lui, disparaît toujours normalement.
        if (kind === "solarSystem" && isolatedStarPair) {
          const isParentOfIsolatedStar = [...isolatedStarPair].some((starId) => {
            const starNode = nodeById.get(starId);
            return starNode && starNode.solarSystemId === nodeId;
          });
          revealed = isParentOfIsolatedStar;
        }
      }
    }

    // Position écran du libellé (couche à part, cf. labelsOverlayEl) — recalculée à chaque
    // frame de caméra à partir des coordonnées "monde" du nœud, jamais via un contre-scale CSS
    // imbriqué dans le monde transformé (texte flou à fort zoom, cf. son commentaire).
    if (label) {
      label.style.left = (vw / 2 + (node.x - state.x) * state.scale) + "px";
      label.style.top = (vh / 2 + (node.y - state.y) * state.scale) + "px";
      const labelRevealed = revealed && (kind !== "star" || node.r * state.scale >= STAR_LABEL_REVEAL_PX);
      labelCandidates.push({ label, labelRevealed, priority: LABEL_LEVEL_PRIORITY[kind] ?? 3 });
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
      // Le connecteur relie l'étoile à son solar : il doit disparaître en même temps que CE
      // solar, pas seulement suivre l'étoile (demande du 17/08/2026) — utile désormais qu'une
      // étoile isolée reste affichée même très dézoomée, quand son solar, lui, a disparu.
      // revealedNodeIdsByLevel.solarSystem est déjà rempli à ce stade : les bulles solar
      // précèdent toujours les étoiles dans le DOM (cf. mountUniverse, ordre de création).
      const parentSolarRevealed = revealedNodeIdsByLevel.solarSystem.has(node.solarSystemId);
      connector.classList.toggle("is-revealed", revealed && parentSolarRevealed);
    }

    if (revealedNodeIdsByLevel[kind] && revealed) revealedNodeIdsByLevel[kind].add(nodeId);

    el.classList.toggle("is-revealed", revealed);
  });

  // Résolution des collisions : priorité galaxie/non-classé > solar > étoile (LABEL_LEVEL_PRIORITY
  // ci-dessus), puis ordre de parcours pour deux étiquettes de même priorité. getBoundingClientRect
  // est lu ici SEULEMENT (aucune écriture géométrique intercalée avant la fin de cette boucle,
  // seul .is-revealed — une opacité, jamais de reflow — est posé au fil de l'eau) : un seul batch
  // de layout pour tous les candidats plutôt qu'un reflow par étiquette. rejectedLabels regroupe
  // les étiquettes déjà écartées cette frame pour ne jamais leur laisser .is-revealed d'une frame
  // précédente.
  const acceptedRects = [];
  const rejectedLabels = new Set(labelCandidates.map((c) => c.label));
  const OVERLAP_PADDING_PX = 3;
  labelCandidates
    .filter((c) => c.labelRevealed)
    .sort((a, b) => a.priority - b.priority)
    .forEach(({ label }) => {
      const rect = label.getBoundingClientRect();
      const collides = acceptedRects.some((accepted) =>
        rect.left < accepted.right + OVERLAP_PADDING_PX
        && rect.right + OVERLAP_PADDING_PX > accepted.left
        && rect.top < accepted.bottom + OVERLAP_PADDING_PX
        && rect.bottom + OVERLAP_PADDING_PX > accepted.top
      );
      if (collides) return; // reste dans rejectedLabels : masqué cette frame
      acceptedRects.push(rect);
      rejectedLabels.delete(label);
    });
  labelCandidates.forEach(({ label, labelRevealed }) => {
    label.classList.toggle("is-revealed", labelRevealed && !rejectedLabels.has(label));
  });

  // Un seul niveau de liens actif à la fois (demande du 16/08/2026) : le niveau le plus profond
  // actuellement révélé gagne. Nécessaire car côté nœuds, un solar reste volontairement visible
  // une fois ses étoiles satellites apparues (cf. commentaire plus haut, "ancrage visuel" —
  // comportement des NŒUDS inchangé par cette tâche) — sans cette règle dédiée aux LIENS, les
  // traits solar<->solar restaient donc affichés en même temps que les traits star<->star dès
  // qu'on descendait au niveau étoiles, et pareil pour galaxy<->galaxy dès qu'un solar apparaît
  // pendant qu'une autre galaxie encore non dézoomée reste affichée en arrière-plan.
  const activeLinkLevel = revealedNodeIdsByLevel.star.size
    ? "star"
    : (revealedNodeIdsByLevel.solarSystem.size ? "solarSystem" : "galaxy");

  // Une relation ne flotte jamais seule dans le vide : à chaque profondeur, elle apparaît
  // uniquement lorsque les deux galaxies, les deux solars ou les deux étoiles concernés sont
  // visibles. Repositionnés en coordonnées ÉCRAN ici (comme les libellés, cf.
  // createKnowledgeLinkEl) plutôt que via transform:scale du monde — plus de flou à fort zoom
  // (demande du 17/08/2026), et l'épaisseur/le halo sont déjà en pixels écran réels, plus
  // besoin de les contre-dimensionner par state.scale.
  knowledgeLinkEls.forEach(({ el, level, fromNodeId, toNodeId, count }) => {
    // Niveau inactif : réellement exclu du rendu (display:none via cette classe, cf. style.css),
    // pas seulement rendu transparent — évite tout chevauchement visuel entre deux échelles de
    // liens et épargne le calcul ci-dessous pour les liens qu'on ne montre pas.
    if (level !== activeLinkLevel) {
      el.classList.remove("is-revealed");
      el.classList.add("is-inactive-link-level");
      return;
    }
    el.classList.remove("is-inactive-link-level");
    const revealedIds = revealedNodeIdsByLevel[level];
    const revealed = revealedIds?.has(fromNodeId) && revealedIds.has(toNodeId);
    if (revealed) {
      const fromNode = nodeById.get(fromNodeId);
      const toNode = nodeById.get(toNodeId);
      if (fromNode && toNode) {
        const fromScreenX = vw / 2 + (fromNode.x - state.x) * state.scale;
        const fromScreenY = vh / 2 + (fromNode.y - state.y) * state.scale;
        const toScreenX = vw / 2 + (toNode.x - state.x) * state.scale;
        const toScreenY = vh / 2 + (toNode.y - state.y) * state.scale;
        const dx = toScreenX - fromScreenX;
        const dy = toScreenY - fromScreenY;
        const distance = Math.hypot(dx, dy);
        // S'arrête à la bordure des bulles, pas à leur centre (demande du 17/08/2026) : recule
        // chaque extrémité de son propre rayon écran (node.r * state.scale).
        const ux = distance > 0 ? dx / distance : 0;
        const uy = distance > 0 ? dy / distance : 0;
        // Niveau galaxie seulement : le halo lumineux décoratif (.mnoria-tag-bubble-galaxy::before,
        // inset:-26px) déborde largement du cercle réel (node.r), qui sert seul au rognage
        // ci-dessus — le trait s'arrêtait donc pile sur ce cercle plein, bien avant ce halo, et
        // semblait ne jamais atteindre visuellement la galaxie (demande du 17/08/2026, "pas assez
        // longs, ils s'arrêtent avant les galaxies"). Un rayon de rognage réduit à ce niveau
        // laisse le trait prolonger dans le halo plutôt que de s'arrêter net au cercle plein.
        const GALAXY_LINK_TRIM_RATIO = 0.3;
        const trimRatio = level === "galaxy" ? GALAXY_LINK_TRIM_RATIO : 1;
        const fromRadiusPx = (fromNode.r || 0) * state.scale * trimRatio;
        const toRadiusPx = (toNode.r || 0) * state.scale * trimRatio;
        const startX = fromScreenX + ux * fromRadiusPx;
        const startY = fromScreenY + uy * fromRadiusPx;
        const trimmedLength = Math.max(0, distance - fromRadiusPx - toRadiusPx);
        el.style.left = startX + "px";
        el.style.top = startY + "px";
        el.style.width = trimmedLength + "px";
        el.style.transform = `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`;
      }
    }
    // +0,5px par relation supplémentaire, plafonné à 3,6px — déjà en pixels écran réels
    // (labelsOverlayEl n'est jamais mis à l'échelle par la caméra, contrairement à worldEl).
    const screenThickness = Math.min(3.6, 1.7 + Math.max(0, count - 1) * 0.5);
    el.style.height = screenThickness + "px";
    el.style.backgroundSize = "12px 100%";
    el.style.boxShadow = "0 0 1px rgba(151, 224, 255, 1), 0 0 2px rgba(105, 205, 255, 0.85)";
    el.classList.toggle("is-revealed", revealed);
  });

  // Lunes informatives des galaxies (une par système, cf. addMoonsAroundGalaxy) : elles
  // appartiennent strictement au niveau « galaxies ». Le précédent calcul par galaxie pouvait
  // laisser les lunes d'une galaxie visibles alors que les systèmes d'une autre avaient déjà
  // franchi leur seuil. Dès qu'UN solar est réellement affiché, toutes les lunes disparaissent
  // afin qu'aucun niveau ne se mélange visuellement.
  const anySolarSystemVisible = Array.from(
    worldEl.querySelectorAll('.universe-zoom-bubble[data-kind="solarSystem"]')
  ).some((el) => el.classList.contains("is-revealed"));
  const moonSolarSystemIdByEl = new Map();
  worldEl.querySelectorAll(".universe-galaxy-moon").forEach((el) => {
    const node = nodeById.get(el.dataset.galaxyId);
    if (!node) return;
    // Pendant l'isolement, toutes les lunes disparaissent (demande du 17/08/2026, "faire
    // disparaître la petite lune... des galaxies pas concernées") : à ce niveau de zoom (assez
    // profond pour voir des solars/étoiles), aucune lune n'a plus lieu d'apparaître, isolement
    // ou pas — mais en dézoomant PENDANT un isolement, la logique normale ci-dessous les
    // réaffichait quand même, sans savoir qu'une isolation était en cours.
    const revealed = !isolatedStarPair && !anySolarSystemVisible && !childrenCanShow(node, state.scale);
    el.classList.toggle("is-revealed", revealed);
    if (revealed) moonSolarSystemIdByEl.set(el.dataset.solarSystemId, el);
  });

  // Trait entre les 2 lunes des systèmes solaires dont sont issues les étoiles isolées
  // (demande du 17/08/2026) : visible seulement si l'isolement est actif ET que les lunes
  // elles-mêmes sont visibles (donc jamais en même temps que les solars/étoiles, cf. logique
  // ci-dessus — les deux se relaient plutôt que de se superposer). Repris du même principe que
  // les liens de connaissance (couche écran, cf. createKnowledgeLinkEl) mais positionné via les
  // rects réels des lunes (déjà en coordonnées écran), plus simple que refaire le calcul monde
  // -> écran pour un unique trait ponctuel.
  if (moonLinkEl) {
    let moonLinkVisible = false;
    if (isolatedStarPair && isolatedStarPair.size === 2) {
      const solarSystemIds = [...isolatedStarPair].map((starId) => nodeById.get(starId)?.solarSystemId);
      const [fromMoon, toMoon] = solarSystemIds.map((id) => moonSolarSystemIdByEl.get(id));
      if (fromMoon && toMoon && fromMoon !== toMoon) {
        const fromRect = fromMoon.getBoundingClientRect();
        const toRect = toMoon.getBoundingClientRect();
        const viewportRect = viewportEl.getBoundingClientRect();
        const fromX = fromRect.left + fromRect.width / 2 - viewportRect.left;
        const fromY = fromRect.top + fromRect.height / 2 - viewportRect.top;
        const toX = toRect.left + toRect.width / 2 - viewportRect.left;
        const toY = toRect.top + toRect.height / 2 - viewportRect.top;
        const dx = toX - fromX;
        const dy = toY - fromY;
        moonLinkEl.style.left = fromX + "px";
        moonLinkEl.style.top = fromY + "px";
        moonLinkEl.style.width = Math.hypot(dx, dy) + "px";
        moonLinkEl.style.transform = `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`;
        moonLinkVisible = true;
      }
    }
    moonLinkEl.classList.toggle("is-revealed", moonLinkVisible);
  }

  updateUniverseMinimap(state);
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
// Sortie de l'isolement au DOUBLE-clic désormais (demande du 17/08/2026, "non pas un simple
// clique comme c'est le cas") — plus le simple clic ci-dessous, qui doit rester réservé à
// l'ouverture des fiches/le focus sur une bulle, même pendant un isolement. Toujours gardée
// derrière la fermeture du panneau (isolationInfoEl.hidden), et hors interface
// (minicarte/zoom/fil d'Ariane), pour les mêmes raisons que précédemment.
document.addEventListener("dblclick", (event) => {
  if (!isMemoireEmbedActive() || !worldEl) return;
  if (isolatedStarPair && isolationInfoEl?.hidden
      && !event.target.closest(".universe-minimap, .universe-minimap__zoom-controls, #universe-breadcrumb")) {
    event.preventDefault();
    event.stopPropagation();
    setIsolatedStarPair(null);
  }
});

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
  // « Ma mémoire » ne sert de repère que lorsqu'on est descendu d'au moins un niveau
  // (ex. "Ma mémoire › Histoire") : à la racine, sans galaxie ouverte, le fil d'Ariane
  // reste vide plutôt que d'afficher "Ma mémoire" seul.
  const crumbs = focusInfo.galaxy ? [{ label: "Ma mémoire", action: () => zoomToRoot() }] : [];
  if (focusInfo.galaxy) crumbs.push({ label: focusInfo.galaxy.name, action: () => camera.focusOn(focusInfo.galaxy, focusScaleFor(focusInfo.galaxy)) });
  if (focusInfo.solarSystem) crumbs.push({ label: focusInfo.solarSystem.name, action: () => camera.focusOn(focusInfo.solarSystem, focusScaleFor(focusInfo.solarSystem)) });
  // À la racine, « Ma mémoire » reste volontairement grisé. Dès qu'un
  // niveau est ouvert, cette classe permet de mettre uniquement le dernier
  // élément en blanc (galaxie, puis solar), jamais les niveaux précédents.
  breadcrumbEl.classList.toggle("universe-breadcrumb--nested", crumbs.length > 1);

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
  latin: { icon: "fa-scroll", label: "Mot latin du jour" },
  photo_import: { icon: "fa-camera", label: "Document importé" },
  manual_import: { icon: "fa-pen", label: "Ajout manuel" },
  pdf_import: { icon: "fa-file-pdf", label: "Document PDF" },
  text_import: { icon: "fa-align-left", label: "Texte importé" },
  url_import: { icon: "fa-link", label: "Page web" },
  youtube_import: { icon: "fa-brands fa-youtube", label: "Vidéo YouTube" }
};

// Sur l'accueil, le panneau est déclaré dans #mnoria-tag-trends-section, qui crée son
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

// Relations très pertinentes détectées au moment de la première bonne
// réponse. Placées entre l'explication et le QCM, comme dans la fiche ouverte
// depuis "Mes apprentissages". Chaque relation mène à la fiche complète de
// l'autre connaissance acquise.
function appendKnowledgeLinks(parent, links, star) {
  if (!Array.isArray(links) || !links.length) return;
  const heading = document.createElement("h3");
  heading.className = "qcm-fiche-section-label";
  heading.textContent = "Les liens";
  parent.appendChild(heading);

  const list = document.createElement("div");
  list.className = "qcm-fiche-links";
  links.forEach((link) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "qcm-fiche-link-item";
    const label = document.createElement("span");
    label.className = "qcm-fiche-link-label";
    label.textContent = link.label || "Connaissance reliée";
    const name = document.createElement("span");
    name.className = "qcm-fiche-link-name";
    name.textContent = link.name || "Voir la fiche";
    // Ces deux <span> n'ont aucune mise en forme dédiée sur cette page (contrairement à
    // qcm-du-jour.html, qui les stylise en display:block) : sans séparateur explicite entre
    // les deux nœuds de texte, ils s'affichaient collés l'un à l'autre, ex. "...romainDieux
    // Romains" (demande du 17/08/2026, "un tiret au lieu de coller les mots").
    const separator = document.createElement("span");
    separator.className = "qcm-fiche-link-sep";
    separator.textContent = " – ";
    button.append(label, separator, name);
    button.addEventListener("click", () => showLinkedKnowledgeSheet(link, star));
    list.appendChild(button);
  });
  parent.appendChild(list);
}

function renderKnowledgeSheet(article, star, fullFiche, loading = false, hideBackButton = false) {
  const detail = fullFiche?.sourceDetail || article.sourceDetail || {};
  starPanelTitleEl.textContent = fullFiche?.label || article.title || "Fiche connaissance";
  starPanelListEl.innerHTML = "";

  const sheet = document.createElement("li");
  sheet.className = "universe-star-panel__knowledge-sheet";

  // Masqué quand la fiche est ouverte directement depuis la fenêtre d'isolement d'un lien entre 2
  // étoiles (cf. setIsolatedStarPair) : "Retour aux connaissances" y ramènerait vers la liste des
  // connaissances d'UNE SEULE des 2 étoiles isolées, sans rapport avec ce qui a ouvert cette fiche
  // — demande du 03/09/2026, "je ne veux pas que la fiche ait le bouton retour ... lorsque j'ouvre
  // la fiche depuis cette fenêtre avec les liens".
  if (!hideBackButton) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "universe-star-panel__knowledge-back";
    back.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>Retour aux connaissances</span>';
    back.addEventListener("click", () => showStarPanel(star));
    sheet.appendChild(back);
  }

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

  if (/^https?:\/\//i.test(String(detail.sourceUrl || ""))) {
    const sourceLink = document.createElement("a");
    sourceLink.className = "qcm-fiche-meta";
    sourceLink.href = detail.sourceUrl;
    sourceLink.target = "_blank";
    sourceLink.rel = "noopener noreferrer";
    sourceLink.textContent = "Voir la page source";
    sheet.appendChild(sourceLink);
  }
  if (detail.sourceAuthor) {
    const sourceAuthor = document.createElement("p");
    sourceAuthor.className = "qcm-fiche-meta";
    sourceAuthor.textContent = `Chaîne : ${detail.sourceAuthor}${detail.durationSeconds ? ` · ${Math.ceil(Number(detail.durationSeconds) / 60)} min` : ""}`;
    sheet.appendChild(sourceAuthor);
  }

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

  appendKnowledgeLinks(sheet, fullFiche?.links, star);

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

async function showKnowledgeSheet(article, star, hideBackButton = false) {
  const requestToken = ++starKnowledgeRequestToken;
  const hasFullFiche = article.quizSlot && article.quizDate;
  renderKnowledgeSheet(article, star, null, hasFullFiche, hideBackButton);
  if (!hasFullFiche) return;

  try {
    const params = new URLSearchParams({ slot: article.quizSlot, date: article.quizDate, legacyKey: getKey() });
    const response = await fetch(`/api/users/notion-quizzes/fiche?${params.toString()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "Fiche indisponible");
    if (requestToken !== starKnowledgeRequestToken || starPanelEl.hidden) return;
    renderKnowledgeSheet(article, star, data, false, hideBackButton);
  } catch (error) {
    if (requestToken !== starKnowledgeRequestToken || starPanelEl.hidden) return;
    console.warn("[mon-univers] fiche QCM complète indisponible :", error.message);
    renderKnowledgeSheet(article, star, null, false, hideBackButton);
  }
}

async function showLinkedKnowledgeSheet(link, star) {
  const requestToken = ++starKnowledgeRequestToken;
  const fallbackArticle = {
    title: link?.name || "Connaissance reliée",
    sourceType: link?.type || null,
    sourceDetail: { meta: null, sections: [] }
  };
  renderKnowledgeSheet(fallbackArticle, star, null, true);
  try {
    const params = new URLSearchParams({
      linkType: String(link?.type || ""),
      linkSourceId: String(link?.sourceId || ""),
      legacyKey: getKey()
    });
    const response = await fetch(`/api/users/notion-quizzes/fiche?${params.toString()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "Fiche indisponible");
    if (requestToken !== starKnowledgeRequestToken || starPanelEl.hidden) return;
    renderKnowledgeSheet({ ...fallbackArticle, title: data.label || fallbackArticle.title }, star, data, false);
  } catch (error) {
    if (requestToken !== starKnowledgeRequestToken || starPanelEl.hidden) return;
    console.warn("[mon-univers] fiche liée indisponible :", error.message);
    renderKnowledgeSheet(fallbackArticle, star, null, false);
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

// #mnoria-memoire-embed-before n'existe QUE sur l'accueil (embed "Ma mémoire") : absent sur la
// page /mon-univers autonome (donc toujours "actif" là-bas). Sur l'accueil, ce même
// #mnoria-tag-trends-cloud est PARTAGÉ avec Bulles Actu/Bulles Mnoria (cf. cloudEl plus haut) —
// sans cette vérification, les clics posés sur worldEl resteraient actifs pour toujours après
// une seule visite en mode "Ma mémoire", et stopPropagation() empêcherait alors les clics sur
// les vraies bulles Actu/Mnoria d'atteindre le listener global de script.js.
function isMemoireEmbedActive() {
  const marker = document.getElementById("mnoria-memoire-embed-before");
  return !marker || !marker.hidden;
}

// ---- États de page ----
function showStatus(kind) {
  cloudEl.querySelector(".universe-empty-overlay")?.remove();

  // Sur l'accueil uniquement, la légende sous le sélecteur répète inutilement le rôle du
  // message d'état lorsque l'univers est vide. On la masque dans cet état précis, puis on la
  // réaffiche uniquement dès qu'un niveau contenant des éléments peut être rendu. La page autonome
  // /mon-univers n'a pas ce marqueur ni cette légende partagée.
  const embeddedMarker = document.getElementById("mnoria-memoire-embed-before");
  const embeddedCaption = embeddedMarker
    ? document.querySelector("#mnoria-tag-trends-section .mnoria-tag-trends-caption")
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
    // le chargement Bulles Actu/Mnoria. La page /mon-univers autonome garde son texte habituel.
    if (document.getElementById("mnoria-memoire-embed-before")) {
      statusEl.hidden = true;
      return;
    }
    statusEl.textContent = "Chargement de ta mémoire…";
  } else if (kind === "empty") {
    statusEl.hidden = true;
    const message = document.createElement("div");
    // La classe générique d'overlay permet aussi au changement de mode
    // Actu/Mnoria de retirer ce message avec les anciens labels du nuage.
    message.className = "mnoria-tag-label-overlay universe-empty-overlay";
    message.style.cssText = "position:absolute;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:clamp(20px,6vw,46px);text-align:center;color:#fff;pointer-events:none;opacity:1;visibility:visible;transform:none;";
    message.innerHTML = '<div style="width:min(100%,520px);box-sizing:border-box;padding:clamp(22px,5vw,34px);border:1px solid rgba(255,255,255,.2);border-radius:22px;background:linear-gradient(145deg,rgba(18,29,38,.88),rgba(27,42,52,.76));box-shadow:0 18px 48px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.08);">' +
      '<div style="width:48px;height:48px;margin:0 auto 15px;border:1px solid rgba(255,255,255,.24);border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.08);box-shadow:0 0 24px rgba(160,198,212,.18);"><i class="fa-solid fa-diagram-project" style="font-size:19px;color:#c9dce5;"></i></div>' +
      '<p style="margin:0;font-family:Oswald,Impact,Arial Narrow,sans-serif;font-size:clamp(20px,4.5vw,27px);font-weight:600;line-height:1.2;letter-spacing:.01em;color:#f4f7f8;text-shadow:0 2px 8px rgba(0,0,0,.4);">Le réseau mnésique artificiel de ta mémoire est encore vide.</p>' +
      '<span style="display:block;width:54px;height:1px;margin:18px auto;background:linear-gradient(90deg,transparent,rgba(201,220,229,.8),transparent);"></span>' +
      '<p style="margin:0;font:600 clamp(14px,2.9vw,16px)/1.5 Oswald,Impact,Arial Narrow,sans-serif;color:#f2f6f8;text-shadow:0 1px 3px rgba(0,0,0,.72);">Commence la mémorisation en cliquant sur <a href="/apprentissage" class="universe-empty-learning-link" aria-label="Ouvrir Mes apprentissages" style="display:inline-block;margin:0 2px;padding:2px 8px;border:1px solid rgba(201,220,229,.48);border-radius:999px;background:rgba(201,220,229,.18);color:#ffffff;font-weight:800;text-decoration:none;pointer-events:auto;cursor:pointer;">Apprentissages</a> (bandeau du bas)&nbsp;: le réseau mnésique artificiel de ta mémoire commencera sa formation.</p>' +
      '</div>';
    const learningLink = message.querySelector(".universe-empty-learning-link");
    learningLink?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (window.self !== window.top) {
        window.parent.postMessage({
          type: "mnoria:open-page-in-parent-modal",
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
    // Même langage typographique que le titre de l'état "vide" juste au-dessus
    // (Oswald 600) — cohérent avec les autres écrans techniques Mnoria harmonisés
    // (showIndexLoadErrorState, script.js) plutôt que le texte générique hérité de
    // .universe-status.
    p.style.cssText = "font-family:Oswald,Impact,'Arial Narrow',sans-serif;font-weight:600;letter-spacing:.01em;";
    p.textContent = "Impossible de charger ta mémoire pour le moment.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "universe-status__retry";
    retry.textContent = "Réessayer";
    retry.addEventListener("click", loadUniverse);
    statusEl.append(p, retry);
  }

  if (kind === "empty" || kind === "error") {
    if (isMemoireEmbedActive()) window.__mnoriaHideBubbleCloudLoadingSpinner?.();
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

// Le clic "Plein écran" (bouton .mnoria-memory-fullpage-btn, accueil → /mon-univers) déclenche
// une vraie navigation top-level : ce module est réévalué de zéro et refaisait jusqu'ici le même
// appel réseau que celui qui venait tout juste de remplir la scène embarquée, avec un sablier au
// passage (demande du 03/09/2026, "je veux que le plein écran s'ouvre immédiatement"). Mémorise
// donc aussi les données complètes (pas seulement la confirmation "vide" ci-dessus) pendant
// quelques minutes dans sessionStorage, qui survit à cette navigation dans le même onglet : la
// scène peut ainsi être montée dès l'évaluation du module, sans attendre le réseau.
const UNIVERSE_DATA_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

function getUniverseDataCacheKey() {
  return `mnoriaUniverseData:${getKey()}`;
}

function readCachedUniverseData() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(getUniverseDataCacheKey()) || "null");
    if (!cached || !Number.isFinite(cached.at) || Date.now() - cached.at > UNIVERSE_DATA_CACHE_MAX_AGE_MS) return null;
    return cached.data || null;
  } catch {
    return null;
  }
}

function cacheUniverseData(data) {
  try {
    sessionStorage.setItem(getUniverseDataCacheKey(), JSON.stringify({ data, at: Date.now() }));
  } catch {}
}

function getUniverseEmptyCacheKey() {
  return `mnoriaUniverseEmpty:${getKey()}`;
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

// Le rate limiter serveur (bucket "users" partagé par IP, 30 req/60s, cf. server.js
// rateLimit) est mutualisé entre tous les endpoints /api/users/* — un aller-retour rapide
// Ma mémoire → Communauté → Ma mémoire (chacun refaisant plusieurs appels de ce bucket)
// peut suffire à le dépasser. Un 429 y est donc transitoire, pas une vraie panne : une
// seule nouvelle tentative après un court délai suffit, plutôt que de masquer le cadre "Ma
// mémoire" pour un pic passager (constaté le 02/09/2026 via diagnostic, "http 429").
async function fetchIntellectualUniverseWithRetry(modeToken, retriesLeft) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UNIVERSE_FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`/api/users/intellectual-universe?legacyKey=${encodeURIComponent(getKey())}`, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
  if (response.status === 429 && retriesLeft > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (modeToken !== window._mnoriaCloudModeToken) throw new Error("http 429");
    return fetchIntellectualUniverseWithRetry(modeToken, retriesLeft - 1);
  }
  if (!response.ok) throw new Error("http " + response.status);
  return response.json();
}

// ---- Chargement (un seul appel réseau, jamais relancé à la navigation dans la scène) ----
async function loadUniverse() {
  // Jeton partagé avec script.js (toggleMnoriaCloud/setPoliticalCloudGroup/setMemoireCloudMode) :
  // si l'utilisateur repart sur Bulles Actu/Mnoria pendant que ce fetch est encore en vol (réseau
  // lent), window._mnoriaCloudModeToken aura changé à la résolution ci-dessous — sans cette
  // vérification, le rendu de "Ma mémoire" arrivait en retard et écrasait les bulles
  // Actu/Mnoria déjà affichées entre-temps sur le conteneur partagé.
  const modeToken = window._mnoriaCloudModeToken;

  // Cadre de l'accueil (mnoria-tag-trends-cloud, cf. syncMobileCloudFrameHeight dans script.js) :
  // son calage se verrouille une seule fois au premier calcul réussi, potentiellement pendant un
  // AUTRE mode (Actu/Communauté) — mountUniverse() (plus bas, via mountUniverseAndHideSpinnerWhenReady)
  // mesure ensuite la taille du cadre UNE SEULE FOIS pour figer toute la disposition des
  // galaxies, jamais recalculée après (cf. son commentaire). Un ancien correctif (demande du
  // 17/08/2026) redéclenchait ce recalage APRÈS le montage plutôt qu'avant — le cadre changeait
  // alors parfois de taille juste après que les bulles aient déjà été positionnées pour l'ancienne
  // taille, les laissant décalées/agglutinées dans un coin (constaté le 26/08/2026 au switch
  // Communauté→Ma mémoire, confirmé par mesures réelles). Redéclenché ICI, AVANT tout montage :
  // mountUniverseAndHideSpinnerWhenReady attend déjà que la taille du cadre soit stable
  // (waitForContainerSizeStable) avant de monter, donc ce recalage a le temps de se terminer et de
  // se stabiliser avant que quoi que ce soit ne lise sa taille.
  if (typeof window.syncCloudSectionHeight === "function") {
    window._mobileCloudFrameLocked = false;
    window.syncCloudSectionHeight(true);
  }

  destroyUniverseScene();
  breadcrumbEl.innerHTML = "";
  backBtn.classList.remove("is-visible");

  const isDemo = new URLSearchParams(location.search).get("demo") === "1";
  if (isDemo) {
    universeData = buildDemoUniverseData();
    if (modeToken !== window._mnoriaCloudModeToken) return;
    showStatus("none");
    await mountUniverseAndHideSpinnerWhenReady(modeToken);
    return;
  }

  // Ouverture instantanée depuis un cache tout frais (typiquement le "Plein écran" juste après
  // la scène embarquée de l'accueil) : monte directement, puis rafraîchit le cache en tâche de
  // fond pour la prochaine fois, sans jamais retoucher la scène déjà montée à partir de lui.
  const cachedUniverseData = readCachedUniverseData();
  if (cachedUniverseData) {
    universeData = cachedUniverseData;
    if (modeToken !== window._mnoriaCloudModeToken) return;
    const emptyUniverse = isUniverseEmpty(universeData);
    if (emptyUniverse) {
      showStatus("empty");
      window.dispatchEvent(new Event("mnoria:memoire-content-ready"));
    } else {
      showStatus("none");
      await mountUniverseAndHideSpinnerWhenReady(modeToken);
    }
    fetchIntellectualUniverseWithRetry(modeToken, 1).then(cacheUniverseData).catch(() => {});
    return;
  }

  const showedCachedEmpty = hasFreshEmptyUniverseCache();
  showStatus(showedCachedEmpty ? "empty" : "loading");

  try {
    universeData = await fetchIntellectualUniverseWithRetry(modeToken, 1);
    cacheUniverseData(universeData);
  } catch (error) {
    console.warn("[mon-univers] chargement échoué :", error.message);
    if (modeToken !== window._mnoriaCloudModeToken) return;
    // Si un état vide récent est déjà visible, une panne réseau momentanée ne doit pas le
    // remplacer par une erreur ni faire réapparaître un chargement long. La prochaine entrée
    // relancera de toute façon une vérification fraîche.
    if (!showedCachedEmpty) showStatus("error");
    window.dispatchEvent(new Event("mnoria:memoire-content-ready"));
    return;
  }

  if (modeToken !== window._mnoriaCloudModeToken) return;

  const emptyUniverse = isUniverseEmpty(universeData);
  cacheUniverseEmptyState(emptyUniverse);
  if (emptyUniverse) {
    showStatus("empty");
    window.dispatchEvent(new Event("mnoria:memoire-content-ready"));
    return;
  }

  showStatus("none");
  await mountUniverseAndHideSpinnerWhenReady(modeToken);
}

loadUniverse();

// Ré-exécuté par script.js (setMemoireCloudMode) à chaque retour sur "Ma mémoire" après le
// tout premier passage : l'import dynamique n'évalue ce module qu'une seule fois (mis en cache
// via _memoireModuleLoadPromise), donc le loadUniverse() ci-dessus, en haut de fichier, ne
// s'exécute lui aussi qu'une seule fois — sans cet export, repasser sur "Ma mémoire" après être
// allé sur Bulles Actu/Mnoria laissait leurs bulles telles quelles à l'écran au lieu de les
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
