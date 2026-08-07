// Page "Mon univers" : réutilise le moteur de bulles existant (tagTrendCloud.js), jamais
// dupliqué. Volontairement léger — pas de chargement de script.js (qui alourdirait la page
// pour un seul besoin : getKey(), reproduite ici à l'identique, cf. script.js getKey()/lsGet()).
import { renderTagTrendCloud } from "/tagTrendCloud.js?v=20260807-orbitlastonly1";

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
// première version) mais nettement désaturé (32% contre 68% à l'origine) pour éviter le rendu
// "bonbon" criard — corrigé une première fois vers des tons sombres façon "planète"
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
  const s = 32;
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
  const shape = fadeEdge ? "ellipse closest-side" : "ellipse";
  return `radial-gradient(${shape} at 38% 32%, rgba(255,255,255,1) 0%, hsl(${hue} ${s}% ${stops[0]}%) 40%, hsl(${hue} ${s}% ${stops[1]}%) 70%, ${tail})`;
}

// Bulles galaxie (niveau racine uniquement) : rendu "vraie galaxie" plutôt qu'un simple disque
// pastel — cœur lumineux superposé, très légères stries en spirale, halo qui déborde du cercle
// (cf. .agon-tag-bubble-galaxy, style.css). Le dégradé de base (bubbleBackgroundFor) reste
// identique en dessous pour garder la même teinte que les systèmes/étoiles filles ; ces
// couches viennent seulement s'ajouter par-dessus (demande du 06/08/2026).
function galaxyBubbleVisual(galaxyName) {
  const hue = hueForGalaxy(galaxyName);
  // fadeEdge=true (demande du 07/08/2026, "enlève les contours et mets des contours
  // progressifs") : même correctif que les étoiles/le soleil — le calque de base s'estompe
  // en alpha jusqu'au bord du cercle au lieu de finir en couleur pleine, cf. bubbleBackgroundFor.
  const base = bubbleBackgroundFor(galaxyName, "galaxy", true);
  const core = `radial-gradient(circle at 50% 46%, rgba(255,255,255,0.95) 0%, hsl(${hue} 45% 88%) 16%, transparent 46%)`;
  const spiral = `repeating-conic-gradient(from 15deg at 50% 50%, hsla(${hue}, 40%, 96%, 0.16) 0deg 3deg, hsla(${hue}, 40%, 96%, 0) 3deg 24deg)`;
  return {
    background: `${spiral}, ${core}, ${base}`,
    glowColor: `hsla(${hue}, 55%, 72%, 0.55)`
  };
}

// ---- État local : un seul appel API, tout le reste se déduit de navPath ----
let universeData = null;
let navPath = []; // [] = galaxies ; [galaxyName] = systèmes ; [galaxyName, solarSystemId] = étoiles
let currentLevelItems = []; // objets métier dans le même ordre que les bulles actuellement affichées
const UNCLASSIFIED_KEY = "__unclassified__"; // sentinelle locale, jamais envoyée à l'API ni stockée

const cloudEl = document.getElementById("agon-universe-cloud");
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
  return `radial-gradient(circle closest-side, #000 0%, #030304 20%, hsla(${hue},75%,60%,0.9) 36%, hsla(${hue},70%,55%,0.5) 49%, hsla(${hue},65%,50%,0) 100%)`;
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
  return `radial-gradient(circle closest-side, #fff 0%, #fff6d8 10%, hsl(42, 100%, 72%) 22%, hsla(${hue}, 70%, 62%, 0.95) 40%, hsla(${hue}, 68%, 60%, 0.85) 65%, hsla(${hue}, 60%, 50%, 0) 100%)`;
}

// ---- Construit les objets métier du niveau courant (déduit de navPath, aucun appel réseau) ----
function buildLevelItems() {
  if (!navPath.length) {
    const items = universeData.galaxies.map((g) => ({
      universeType: "galaxy",
      label: g.name,
      rawWeight: g.solarSystems.length, // taille = richesse en systèmes solaires, pas le total d'articles
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
      bubbleGlowColor = `hsla(${hueForGalaxy(currentGalaxyName)}, 55%, 85%, 0.6)`;
      bubbleExtraClass = "agon-tag-bubble-solarsystem";
    } else if (item.universeType === "star" && currentGalaxyName) {
      bubbleBackground = bubbleBackgroundFor(currentGalaxyName, "star", true);
      bubbleExtraClass = "agon-tag-bubble-star";
    }
    return { tag: item.label, sizeWeight: weights[i], subjectId: "", bubbleBackground, bubbleGlowColor, bubbleExtraClass };
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
      // Taille/opacité relevées (demande du 07/08/2026 : invisibles à taille normale, noyées
      // dans la poussière du fond étoilé) — nettement plus grosses et plus opaques que les
      // flocons de fond (cf. #agon-universe-cloud::after) pour rester repérables comme des
      // satellites du système plutôt que comme du simple décor de fond.
      const dotSize = 4.5 + Math.random() * 4;
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
    clearTimeout(miniStarResizeTimer);
    miniStarResizeTimer = setTimeout(() => drawMiniStarsForSystems(currentLevelItems), 180);
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
      drawMiniStarsForSystems(items);
      cloudEl.classList.remove("universe-cloud--transitioning");
    }, items.length, centerLabel, bubbleGap);
  } catch (error) {
    console.warn("[mon-univers] rendu du nuage interrompu :", error.message);
    cloudEl.classList.remove("universe-cloud--transitioning");
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

// Clic intercepté au niveau du conteneur (jamais sur document) + stopPropagation : empêche le
// listener global de public/script.js (.agon-tag-bubble -> handleBubbleTagClick, spécifique aux
// débats) de voir cet événement. Les bulles créées par renderTagTrendCloud sont de vrais
// <button> : Entrée et Espace déclenchent déjà nativement ce même "click", aucun code clavier
// supplémentaire nécessaire.
cloudEl.addEventListener("click", (event) => {
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
  if (kind === "none") {
    statusEl.hidden = true;
    cloudEl.hidden = false;
    return;
  }

  cloudEl.hidden = true;
  statusEl.hidden = false;
  statusEl.innerHTML = "";

  if (kind === "loading") {
    statusEl.textContent = "Chargement de ton univers…";
  } else if (kind === "empty") {
    const p = document.createElement("p");
    p.innerHTML = "Ton univers est encore vide.<br>Réponds correctement aux QCM d'actualité pour faire apparaître tes premières étoiles.";
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
  breadcrumbEl.innerHTML = "";
  backBtn.classList.remove("is-visible");
  showStatus("loading");

  const isDemo = new URLSearchParams(location.search).get("demo") === "1";
  if (isDemo) {
    universeData = buildDemoUniverseData();
    navPath = [];
    renderLevelNow();
    return;
  }

  try {
    const response = await fetch(`/api/users/intellectual-universe?legacyKey=${encodeURIComponent(getKey())}`);
    if (!response.ok) throw new Error("http " + response.status);
    universeData = await response.json();
  } catch (error) {
    console.warn("[mon-univers] chargement échoué :", error.message);
    showStatus("error");
    return;
  }

  if (isUniverseEmpty(universeData)) {
    showStatus("empty");
    return;
  }

  navPath = [];
  renderLevelNow();
}

loadUniverse();
