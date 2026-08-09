// Page "Mon univers" : réutilise le moteur de bulles existant (tagTrendCloud.js), jamais
// dupliqué. Volontairement léger — pas de chargement de script.js (qui alourdirait la page
// pour un seul besoin : getKey(), reproduite ici à l'identique, cf. script.js getKey()/lsGet()).
import { renderTagTrendCloud } from "/tagTrendCloud.js?v=20260808-satellites6";

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

// Bulles galaxie (niveau racine uniquement) : rendu "vraie galaxie" plutôt qu'un simple disque
// pastel — cœur lumineux superposé, très légères stries en spirale, halo qui déborde du cercle
// (cf. .agon-tag-bubble-galaxy, style.css). Le dégradé de base (bubbleBackgroundFor) reste
// identique en dessous pour garder la même teinte que les systèmes/étoiles filles ; ces
// couches viennent seulement s'ajouter par-dessus (demande du 06/08/2026).
// Bras spiralés (spirale logarithmique, 2 bras opposés à 180°, ~1.15 tour, rayon 6→47 sur un
// viewBox 0 0 100 100) — géométrie fixe, réutilisée pour toutes les galaxies ; seule la couleur
// du trait change (teinte de la galaxie), cf. spiralArmsBackground juste en dessous.
// Enroulement resserré (1.85 tour contre 1.15, demande du 07/08/2026 "plus enroulés") — même
// rayon 6→47 qu'avant (donc même distance max au centre : le halo autour reste dans la marge de
// sécurité déjà calculée pour le cadrage à 72%, cf. spiralArmsBackground plus bas), juste une
// croissance plus douce (1.4 au lieu de 1.7) pour un enroulement régulier sur ces tours en plus.
// Aplatissement (squashY ≈0.55) directement injecté dans les coordonnées Y du tracé — demande du
// 07/08/2026 ("les spirales ne semblent pas ovales", après un premier essai qui aplatissait
// seulement via background-size CSS non-uniforme sur l'ensemble du SVG, cf. ancien historique) :
// à cette échelle, la courbe elle-même restait perceptiblement compacte/ronde à l'œil malgré
// l'ellipse mathématiquement correcte — coder l'aplatissement directement dans le tracé (plutôt
// que de compter sur un scale CSS après coup) rend la forme ovale sans ambiguïté, quel que soit
// l'étirement/le flou appliqués ensuite. Mêmes 1.85 tour, rayon 6→47 en X qu'avant.
// Géométrie circulaire (pas de squash injecté dans les coordonnées) : l'aplatissement se fait
// via l'étirement CSS non-uniforme du SVG (background-size + preserveAspectRatio="none", cf.
// spiralArmsBackground plus bas) — un essai précédent injectait le squash directement dans ces
// coordonnées, mais ça compressait aussi les halos flous (stroke-width/flou NON squashés, eux)
// les uns contre les autres verticalement, fusionnant les bras en un blob indistinct (retour du
// 07/08/2026, "on ne voit plus les bras"). L'étirement CSS après coup squash tout uniformément
// (tracé ET halos), donc les proportions entre les deux restent cohérentes.
const SPIRAL_ARM_PATHS = [
  "M 56.0 50.0 L 56.2 51.5 L 56.1 53.0 L 55.5 54.6 L 54.5 56.1 L 53.2 57.4 L 51.5 58.3 L 49.5 58.9 L 47.3 59.0 L 45.1 58.5 L 42.9 57.5 L 41.0 56.0 L 39.3 53.9 L 38.2 51.4 L 37.6 48.6 L 37.8 45.6 L 38.6 42.6 L 40.2 39.7 L 42.5 37.2 L 45.5 35.2 L 49.0 34.0 L 52.8 33.5 L 56.8 34.0 L 60.8 35.4 L 64.4 37.8 L 67.5 41.1 L 69.8 45.2 L 71.2 49.9 L 71.4 54.9 L 70.4 60.1 L 68.2 65.1 L 64.8 69.6 L 60.3 73.3 L 54.8 76.0 L 48.6 77.3 L 42.1 77.2 L 35.5 75.5 L 29.3 72.3 L 23.9 67.5 L 19.5 61.4 L 16.6 54.2 L 15.3 46.3 L 16.0 38.0 L 18.6 29.8 L 23.2 22.2 L 29.7 15.7 L 37.8 10.6 L 47.1 7.5 L 57.2 6.6 L 67.5 8.0 L 77.6 12.0",
  "M 44.0 50.0 L 43.8 48.5 L 43.9 47.0 L 44.5 45.4 L 45.5 43.9 L 46.8 42.6 L 48.5 41.7 L 50.5 41.1 L 52.7 41.0 L 54.9 41.5 L 57.1 42.5 L 59.0 44.0 L 60.7 46.1 L 61.8 48.6 L 62.4 51.4 L 62.2 54.4 L 61.4 57.4 L 59.8 60.3 L 57.5 62.8 L 54.5 64.8 L 51.0 66.0 L 47.2 66.5 L 43.2 66.0 L 39.2 64.6 L 35.6 62.2 L 32.5 58.9 L 30.2 54.8 L 28.8 50.1 L 28.6 45.1 L 29.6 39.9 L 31.8 34.9 L 35.2 30.4 L 39.7 26.7 L 45.2 24.0 L 51.4 22.7 L 57.9 22.8 L 64.5 24.5 L 70.7 27.7 L 76.1 32.5 L 80.5 38.6 L 83.4 45.8 L 84.7 53.7 L 84.0 62.0 L 81.4 70.2 L 76.8 77.8 L 70.3 84.3 L 62.2 89.4 L 52.9 92.5 L 42.8 93.4 L 32.5 92.0 L 22.4 88.0"
];

// Rallonge la queue de chaque bras (demande du 07/08/2026 : "allonger et affiner la queue du
// bras") — plutôt que de recalculer toute la spirale (formule d'origine inconnue, uniquement les
// coordonnées figées ci-dessus), on prolonge localement à partir des 3 derniers points : vitesse
// + accélération (différences finies), l'accélération amortie à chaque pas (×0.3) pour que la
// courbure se détende vite. Testé avec un amortissement plus faible et un facteur d'étirement en
// plus (×1.05/pas) : le rayon max explosait (+112% avec 6 points, vérifié numériquement) — au
// bout de la queue, le tracé progresse presque tangentiellement au cercle, donc même une
// direction "figée" continue de s'éloigner du centre à mesure qu'elle avance en ligne droite.
// Seulement 2 points ajoutés, aucun étirement de vitesse : le rayon max ne grandit plus que
// d'environ 18% (mesuré), compensé par une réduction proportionnelle du background-size plus bas
// pour ne jamais dépasser la marge de sécurité déjà établie (évite de retomber dans le bug de
// coupe nette déjà corrigé). Calculé une seule fois au chargement (géométrie fixe, seule la
// teinte varie par galaxie).
function extendSpiralTail(points, extraCount) {
  const extended = points.map((p) => [...p]);
  const n = extended.length;
  let v = [extended[n - 1][0] - extended[n - 2][0], extended[n - 1][1] - extended[n - 2][1]];
  let a = [
    v[0] - (extended[n - 2][0] - extended[n - 3][0]),
    v[1] - (extended[n - 2][1] - extended[n - 3][1])
  ];
  let cur = extended[n - 1];
  for (let i = 0; i < extraCount; i += 1) {
    a = [a[0] * 0.3, a[1] * 0.3];
    v = [v[0] + a[0], v[1] + a[1]];
    cur = [cur[0] + v[0], cur[1] + v[1]];
    extended.push(cur);
  }
  return extended;
}

function parseSpiralPoints(d) {
  const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const points = [];
  for (let i = 0; i < nums.length; i += 2) points.push([nums[i], nums[i + 1]]);
  return points;
}

function pointsToPathD(points) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
}

// 2 points de plus (~+18% de rayon max, mesuré) : modeste, pour rester dans la marge de sécurité
// déjà établie (background-size réduit en conséquence juste en dessous, spiralArmsBackground)
// plutôt que de risquer de retomber dans le bug de coupe nette déjà corrigé (cf. commentaires sur
// bubbleBackgroundFor plus haut).
const SPIRAL_ARM_TAIL_EXTRA = 2;
const SPIRAL_ARM_POINTS = SPIRAL_ARM_PATHS.map((d) => extendSpiralTail(parseSpiralPoints(d), SPIRAL_ARM_TAIL_EXTRA));

// Découpe chaque bras (déjà rallongé) en paliers de largeur décroissante (base épaisse près du
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

function spiralArmsBackground(hue) {
  // 24% (pas 55%) : demande du 07/08/2026, couleurs moins criardes/plus pastel, cohérent avec le
  // même abaissement de saturation sur bubbleBackgroundFor (s) juste au-dessus.
  const stroke = `hsl(${hue}, 16%, 80%)`;
  // Halo autour de chaque bras (demande du 07/08/2026) : un flou SVG (feGaussianBlur) plutôt
  // qu'un simple trait large à faible alpha — un trait large seul aurait juste épaissi le bras
  // (bord encore net), alors qu'un flou dégrade réellement l'alpha vers l'extérieur, comme un
  // vrai halo lumineux. Trois paliers, TOUS flous (large/très faible, moyen/modérée, serré/plus
  // opaque) — le dernier palier (le "trait net" d'origine, sans filtre) a été retiré : même flou,
  // même sans halo autour, il gardait un bord net à lui seul, ce qui donnait l'impression qu'il
  // n'y avait pas de dégradé du tout ("les bras sont trop nettes, les contours ne devraient pas
  // être visibles", retour du 07/08/2026). Ici même le palier le plus serré reste flou (stdDeviation
  // 1.3, léger) : aucune arête nette nulle part sur le bras, juste une bande qui rayonne. Dessinés
  // D'ABORD (donc EN DESSOUS, cf. ordre de peinture SVG), du plus large/faible au plus serré/
  // opaque. x/y/width/height élargis sur chaque <filter> : la région de flou par défaut
  // (-10%/-10%/120%/120% du bbox du trait) aurait coupé le flou en biseau sur les bords.
  // Chaque bras dessiné en 5 segments de largeur décroissante (tipFactor 0.3 : la pointe finit à
  // 30% de la largeur de base) plutôt qu'un seul <path> à largeur fixe — cf.
  // buildTaperedPathSegments juste au-dessus pour le pourquoi.
  // Halos ravivés (opacité relevée) : demande du 07/08/2026 "rajoute un aspect lumineux dans la
  // spirale, afin que les spirales soient moins visibles" — l'objectif n'est plus une ligne nette
  // qui ressort (essai précédent), mais l'inverse : un flou global plus lumineux qui adoucit le
  // tracé jusqu'à ce qu'il se lise comme une lueur diffuse plutôt qu'un trait dessiné.
  const outerGlowPaths = SPIRAL_ARM_POINTS
    .map((points) => buildTaperedPathSegments(points, 24, 0.3, 5, `stroke="${stroke}" stroke-linecap="round" opacity="0.34" filter="url(#armGlowOuter)"`))
    .join("");
  const innerGlowPaths = SPIRAL_ARM_POINTS
    .map((points) => buildTaperedPathSegments(points, 16, 0.3, 5, `stroke="${stroke}" stroke-linecap="round" opacity="0.5" filter="url(#armGlowInner)"`))
    .join("");
  // Cœur reblanchi mais désormais lui aussi flou (stdDeviation du filtre relevée juste plus bas,
  // 1.3 → 2.6) et moins opaque (0.92 → 0.6) — le précédent réglage (quasi net, quasi opaque)
  // faisait ressortir une ligne nette "colonne vertébrale" pour répondre à un souci de visibilité
  // ("les galaxies n'apparaissent plus"), mais cette même netteté est maintenant jugée trop
  // graphique/tracée ("moins visibles" en tant que trait) — le compromis : rester assez clair
  // pour ne pas redisparaître dans le fond, mais assez flou pour fusionner avec son propre halo
  // en une lueur, pas une ligne.
  const coreStroke = `hsl(${hue}, 10%, 94%)`;
  const corePaths = SPIRAL_ARM_POINTS
    .map((points) => buildTaperedPathSegments(points, 10, 0.3, 5, `stroke="${coreStroke}" stroke-linecap="round" opacity="0.6" filter="url(#armGlowCore)"`))
    .join("");
  // preserveAspectRatio="none" (essentiel) : sans lui, un <svg> utilisé en background-image
  // GARDE son ratio 1:1 par défaut (xMidYMid meet) même si background-size demande un ratio
  // différent — le SVG est juste réduit pour tenir dans la plus petite dimension, centré, JAMAIS
  // étiré, ce qui explique pourquoi le squash CSS précédent n'avait visuellement aucun effet
  // ("rien n'a changé" — retour du 07/08/2026, confirmé par test isolé). Avec ce mot-clé, le SVG
  // est bien étiré pour remplir exactement le rectangle donné par background-size.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><defs>`
    + `<filter id="armGlowOuter" x="-90%" y="-90%" width="280%" height="280%"><feGaussianBlur stdDeviation="6.0"/></filter>`
    + `<filter id="armGlowInner" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3.4"/></filter>`
    + `<filter id="armGlowCore" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.6"/></filter>`
    + `</defs>${outerGlowPaths}${innerGlowPaths}${corePaths}</svg>`;
  // 68% (pas 90%) : le point le plus excentré des tracés est à ~47 unités du centre (50,50) sur
  // les 50 que compte le cercle inscrit dans la boîte 100×100 — le halo autour des bras (glow
  // outer : stroke-width 22 + flou stdDeviation 4.5, donc un rayon visuel ajouté d'environ
  // 11+13 ≈ 24 unités au-delà du tracé) dépasse largement ce cercle avant même d'avoir fini de
  // s'estomper. Le bord du HALO (pas juste du trait) se retrouvait alors tranché net par le
  // border-radius:50% de la bulle — "sur les bras extérieurs, les contours restent nettes",
  // retour du 07/08/2026 : 90% suffisait pour le trait seul (ancien souci, déjà réglé) mais pas
  // pour ce halo bien plus large ajouté depuis. 68% ramène tout (trait + les 3 paliers de flou)
  // confortablement à l'intérieur du cercle, flou compris.
  // 72% en largeur (contre 68%, demande du 07/08/2026 "agrandit les bras spiralés") mais 54% en
  // hauteur (pas 72% des deux côtés) : aplatit légèrement le disque en ellipse, pour une allure
  // de galaxie vue de biais plutôt qu'un cercle parfait vu de face ("rends-les légèrement plus
  // ovales", même demande) — même rayon max (47) que le calcul de marge de sécurité du halo,
  // toujours respecté puisque l'aplatissement ne fait que RÉDUIRE l'étendue verticale.
  // 40% en hauteur (contre 54%) : ovale plus marqué (demande du 07/08/2026 "les galaxies doivent
  // avoir une forme plus ovale") — même ratio (~0.55 contre ~0.75) que le halo (::before,
  // style.css) et le cœur (galaxyBubbleVisual) pour rester alignés.
  // 30% en hauteur (contre 40%) : ovale encore plus marqué, spécifiquement sur la courbe des bras
  // elle-même — demande du 07/08/2026 "les spirales aussi doivent être plus ovales" (le halo
  // autour l'était déjà, mais la courbe visible des bras restait proportionnellement moins
  // aplatie, trop petite dans le halo pour que l'effet se voie autant).
  // Échelle UNIFORME (70% 70%, pas un scale X/Y différent) : l'aplatissement est désormais dans
  // le tracé lui-même (SPIRAL_ARM_PATHS, squashY intégré) — un scale non-uniforme en plus ici
  // écraserait une deuxième fois, dans le mauvais sens visuel (retour à un rendu presque rond,
  // confirmé par capture le 07/08/2026). Marge de sécurité X (rayon max 47 + halo) inchangée ;
  // marge Y bien plus large qu'avant puisque le tracé est déjà resserré en hauteur.
  // 72% en largeur, 40% en hauteur (ratio ~0.55, même proportion que le halo ::before,
  // style.css) : maintenant réellement appliqué grâce à preserveAspectRatio="none" ci-dessus.
  // 61% / 34% (pas 72% / 40%) : la queue rallongée (SPIRAL_ARM_TAIL_EXTRA, extendSpiralTail
  // ci-dessus) pousse le rayon max d'environ 47 à 55 unités (+18%, mesuré) — sans compenser,
  // cette pointe plus longue aurait dépassé la marge de sécurité et se serait fait trancher net
  // par le cercle de la bulle. Réduit ici dans la même proportion (×0.848) pour que le rayon
  // visuel final reste identique à avant l'allongement, malgré la queue plus longue en interne.
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") center / 61% 34% no-repeat`;
}

function galaxyBubbleVisual(galaxyName) {
  const hue = hueForGalaxy(galaxyName);
  // "Enlève les bulles, uniquement des spirales galactiques" (demande du 07/08/2026, 2e passe :
  // un premier essai gardait un halo diffus qui remplissait tout le cercle et se lisait encore
  // comme une "bulle") : plus aucun disque, même diffus — seuls les bras spiralés (teintés par
  // galaxie, posés ici plutôt qu'en ::after CSS statique pour pouvoir varier leur couleur) et un
  // petit cœur lumineux serré près du centre. Rien d'autre ne remplit le cercle : le fond étoilé
  // du cadre reste visible partout entre les bras, comme sur une vraie photo de galaxie.
  const arms = spiralArmsBackground(hue);
  // ellipse (pas circle) : demande du 07/08/2026 "rends-les légèrement plus ovales pour
  // l'apparence d'une galaxie" — un vrai disque galactique n'est vu que rarement pile de face,
  // l'aplatir légèrement évoque une galaxie vue de biais, plus reconnaissable qu'un cercle
  // parfait. Mêmes proportions que le squash appliqué à spiralArmsBackground/le halo (::before,
  // style.css) pour que cœur/bras/halo restent alignés visuellement.
  // 24% (pas 55%) : couleurs moins criardes/plus pastel (demande du 07/08/2026), même
  // abaissement que spiralArmsBackground/bubbleBackgroundFor juste au-dessus.
  const core = `radial-gradient(ellipse 30% 13% at 50% 50%, rgba(255,255,255,0.95) 0%, hsl(${hue} 16% 85%) 14%, transparent 30%)`;
  return {
    background: `${core}, ${arms}`,
    // Alpha relevé (0.55 → 0.7, demande du 07/08/2026 "dégradé très fort autour des spirales") :
    // alimente le halo ::before (style.css .agon-tag-bubble-galaxy::before, --agon-tag-bubble-glow).
    // Saturation abaissée (55% → 26%) même jour, demande séparée "couleurs plus pastel".
    glowColor: `hsla(${hue}, 18%, 72%, 0.7)`
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

// Ré-exécuté par script.js (setMemoireCloudMode) à chaque retour sur "Ma mémoire" après le
// tout premier passage : l'import dynamique n'évalue ce module qu'une seule fois (mis en cache
// via _memoireModuleLoadPromise), donc le loadUniverse() ci-dessus, en haut de fichier, ne
// s'exécute lui aussi qu'une seule fois — sans cet export, repasser sur "Ma mémoire" après être
// allé sur Bulles Actu/Agôn laissait leurs bulles (avec leurs propres satellites) telles quelles
// à l'écran au lieu de les remplacer par les bulles galaxies/systèmes/étoiles (demande du
// 09/08/2026, "ça mélange tout").
export { loadUniverse as reinitMemoireEmbed };
