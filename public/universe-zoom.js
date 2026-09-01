// Moteur de scène + caméra pour "Ma mémoire" (public/mon-univers.js) : zoom spatial réel
// (galaxies -> systèmes solaires -> étoiles positionnés les uns DANS les autres, dans un seul
// espace de coordonnées persistant), demande du 13/08/2026 — remplace l'ancien modèle "un
// niveau = tout l'écran" (goToLevel/renderLevelNow, réinitialisant tagTrendCloud.js à chaque
// clic). Volontairement séparé de tagTrendCloud.js plutôt que d'y toucher : ce moteur partagé
// est aussi utilisé par les bulles Mnoria/Actu (public/script.js), qui n'ont rien à voir avec un
// zoom spatial et ne doivent jamais être affectées par ce chantier.
//
// Deux exports : layoutUniverseWorld (placement géométrique pur, aucun DOM) et createUniverseCamera
// (interaction caméra sur un conteneur DOM déjà peuplé par l'appelant).

// ---- Placement : recherche en spirale à l'intérieur d'un disque -----------------------------
// Même principe que l'algorithme de tagTrendCloud.js (recherche en spirale, plus grosses bulles
// en premier, repli si aucune place exacte) mais réécrit ici sans aucun couplage au DOM/à un
// conteneur : les bornes sont un disque explicite (cx, cy, maxR), pas container.clientWidth/Height
// — condition nécessaire pour calculer une position UNE SEULE FOIS dans un espace de coordonnées
// persistant plutôt qu'à chaque rendu.
function packCirclesInDisk(items, cx, cy, maxR, opts = {}) {
  const minRatio = opts.minRatio ?? 0.16;
  const maxRatio = opts.maxRatio ?? 0.38;
  const fillRatio = opts.fillRatio ?? 0.62;
  // Écart minimum forcé entre deux cercles voisins (au-delà du -2px de tolérance déjà présent
  // dans le test de collision plus bas) — 0 par défaut (comportement inchangé), demande du
  // 13/08/2026 pour les systèmes solaires ("écarte les solars des uns des autres"), trop
  // proches/collés les uns aux autres dans leur galaxie.
  const gap = opts.gap ?? 0;
  if (!items.length) return [];

  const weights = items.map((it) => Math.max(0, Number(it.weight) || 0));
  const maxWeight = Math.max(...weights, 1e-6);
  const normalized = weights.map((w) => 0.35 + 0.65 * Math.pow(w / maxWeight, 0.6));

  let sizeScale = 1;
  const hasFixedVisualRadii = items.every((item) => Number.isFinite(item.visualRadius) && item.visualRadius > 0);
  const baseRadii = () => normalized.map((w, index) => hasFixedVisualRadii
    ? items[index].visualRadius
    : sizeScale * (minRatio + (maxRatio - minRatio) * w) * maxR);

  // Réduit l'échelle globale si la somme des aires dépasse l'aire utile du disque — même
  // logique que computeAutoScale (tagTrendCloud.js) mais ciblant un disque plutôt qu'un
  // rectangle de conteneur.
  const usableArea = Math.PI * maxR * maxR * fillRatio;
  const totalArea = () => baseRadii().reduce((sum, r) => sum + Math.PI * r * r, 0);
  if (!hasFixedVisualRadii && totalArea() > usableArea) {
    sizeScale = Math.sqrt(usableArea / totalArea());
    sizeScale = Math.max(sizeScale, 0.4);
  }

  const order = items.map((_, i) => i).sort((a, b) => normalized[b] - normalized[a]);
  const golden = 137.5;

  function tryPlace(radii) {
    const placed = [];
    const positions = new Array(items.length);
    for (let k = 0; k < order.length; k += 1) {
      const i = order[k];
      const r = radii[i];
      const collisionR = Math.max(r, Number(items[i].collisionRadius) || r);
      const prefAngle = (k * golden) % 360;
      let best = null;
      for (let dist = 0; dist <= maxR - collisionR + 1 && !best; dist += Math.max(2, maxR * 0.012)) {
        for (let step = 0; step < 24 && !best; step += 1) {
          const angle = ((prefAngle + (step % 2 === 0 ? step / 2 : -((step + 1) / 2)) * 22) * Math.PI) / 180;
          const x = cx + Math.cos(angle) * dist;
          const y = cy + Math.sin(angle) * dist;
          if (Math.hypot(x - cx, y - cy) + collisionR > maxR) continue;
          const collides = placed.some((p) => Math.hypot(x - p.x, y - p.y) < collisionR + p.collisionR + gap);
          if (!collides) best = { x, y };
        }
      }
      if (!best && opts.allowCenterFallback !== false) {
        // Repli : le centre du disque minimise la distance aux bords, toujours dans les
        // bornes (rare — disque très encombré après réduction d'échelle).
        best = { x: cx, y: cy };
      }
      if (!best) return null;
      placed.push({ x: best.x, y: best.y, r, collisionR });
      positions[i] = { x: best.x, y: best.y, r, collisionR };
    }
    return positions;
  }

  let radii = baseRadii();
  let positions = tryPlace(radii);
  // Filet de sécurité : si le repli au centre a dû être utilisé plusieurs fois (paquet très
  // dense), réduit encore l'échelle et retente, jusqu'à 4 fois — même esprit que la boucle de
  // computeAutoScale, jamais plus qu'un nombre borné d'essais.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!positions) break;
    const centerFallbacks = positions.filter((p) => p.x === cx && p.y === cy).length;
    if (centerFallbacks <= 1) break;
    sizeScale *= 0.88;
    radii = baseRadii();
    positions = tryPlace(radii);
  }

  return positions;
}

function stablePhaseDegrees(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 4294967296) * 360;
}

function packFixedGroupsWithGrowth(items, initialRadius, opts = {}) {
  const growthFactor = opts.growthFactor ?? 1.22;
  const maxAttempts = opts.maxAttempts ?? 18;
  let logicalRadius = Math.max(initialRadius, ...items.map((item) => Number(item.collisionRadius) || 0), 1);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const positions = packCirclesInDisk(items, 0, 0, logicalRadius, {
      gap: opts.gap ?? 0,
      allowCenterFallback: false
    });
    if (positions) return { positions, logicalRadius, attempts: attempt + 1 };
    logicalRadius *= growthFactor;
  }
  throw new Error(`Universe layout: unable to pack ${items.length} groups without overlap after ${maxAttempts} attempts`);
}

// Place des "satellites" en orbite AUTOUR d'un point (pas emboîtés dans un disque comme
// packCirclesInDisk). Le placement occupe autant d'anneaux radiaux que nécessaire : une étoile
// ne peut jamais recouvrir une étoile déjà placée ni aucun système solaire, même si ces nœuds
// appartiennent à un autre solar/une autre galaxie. L'espace monde étant infini, un anneau plus
// extérieur finit toujours par offrir une place sans devoir réduire les étoiles.
function packSatellitesAroundPoint(items, cx, cy, orbitRadius, opts = {}) {
  if (!items.length) return [];

  // Taille basée sur sizeBasis (le rayon du système solaire lui-même), PAS sur orbitRadius —
  // sans cette distinction, écarter l'orbite (orbitRadius plus grand, demande du 13/08/2026)
  // grossissait aussi la taille des étoiles dans les mêmes proportions (taille = ratio ×
  // orbitRadius), les rendant presque aussi grosses que leur système solaire et les faisant
  // apparaître prématurément (constaté le 13/08/2026 par capture d'écran : étoiles déjà
  // visibles au simple zoom galaxie, sans avoir cliqué sur ce système précis) — écarter (la
  // distance) et grossir (la taille) doivent rester deux réglages indépendants.
  const sizeBasis = opts.sizeBasis ?? orbitRadius;

  const maxRatio = opts.maxRatio ?? 0.4;
  const minRatio = opts.minRatio ?? 0.18;
  const maxAbs = Math.max(0.001, maxRatio * sizeBasis);
  const minAbs = Math.min(minRatio * sizeBasis, maxAbs);

  const weights = items.map((it) => Math.max(0, Number(it.weight) || 0));
  const maxWeight = Math.max(...weights, 1e-6);
  const normalized = weights.map((w) => 0.35 + 0.65 * Math.pow(w / maxWeight, 0.6));
  const radii = normalized.map((weight) => minAbs + (maxAbs - minAbs) * weight);
  const maxStarRadius = Math.max(...radii, 0.001);

  // Marge réelle entre les disques, en coordonnées monde. Elle s'agrandit donc avec le zoom
  // comme les nœuds eux-mêmes et reste perceptible à tous les niveaux de caméra.
  const gap = opts.gap ?? Math.max(0.8, sizeBasis * 0.12);
  const slotSpacing = maxStarRadius * 2 + gap;
  const firstOrbit = Math.max(orbitRadius, sizeBasis + maxStarRadius + gap);
  const ringSpacing = Math.max(slotSpacing, sizeBasis * 0.45);
  const phase = ((Number(opts.phaseDegrees) || 15) * Math.PI) / 180;
  const fixedObstacles = Array.isArray(opts.obstacles) ? opts.obstacles : [];
  // Tableau partagé par tous les solars : chaque étoile validée devient immédiatement un
  // obstacle pour celles qui seront placées ensuite, y compris dans un autre système.
  const occupied = Array.isArray(opts.occupied) ? opts.occupied : [];

  function collides(x, y, r) {
    const overlaps = (other) => (
      other && Number.isFinite(other.x) && Number.isFinite(other.y) && Number.isFinite(other.r)
      && Math.hypot(x - other.x, y - other.y) < r + other.r + gap
    );
    return fixedObstacles.some(overlaps) || occupied.some(overlaps);
  }

  const positions = new Array(items.length);
  // Les grosses étoiles choisissent d'abord leur place ; les petites remplissent ensuite les
  // intervalles disponibles. L'ordre de sortie reste néanmoins celui des données d'origine.
  const order = items.map((_, index) => index).sort((a, b) => radii[b] - radii[a]);
  const goldenFraction = 0.6180339887498949;

  order.forEach((itemIndex, orderIndex) => {
    const r = radii[itemIndex];
    let best = null;
    // Limite très généreuse : normalement les premiers anneaux suffisent. Le repli situé juste
    // après garantit quand même une terminaison déterministe pour un jeu pathologique.
    const maxRingAttempts = Math.max(24, items.length + Math.ceil((fixedObstacles.length + occupied.length) / 4));

    for (let ringIndex = 0; ringIndex < maxRingAttempts && !best; ringIndex += 1) {
      const radialDistance = firstOrbit + ringIndex * ringSpacing;
      const ringCapacity = Math.max(6, Math.floor((Math.PI * 2 * radialDistance) / slotSpacing));
      // Point de départ en nombre d'or : les premières étoiles ne se tassent pas toutes dans le
      // même quadrant. Les anneaux impairs sont aussi déphasés d'un demi-cran.
      const startSlot = Math.floor(
        ((orderIndex * goldenFraction + (ringIndex % 2) * 0.5 / ringCapacity) % 1) * ringCapacity
      );

      for (let step = 0; step < ringCapacity && !best; step += 1) {
        const slot = (startSlot + step) % ringCapacity;
        const angle = phase + ((slot + (ringIndex % 2 ? 0.5 : 0)) / ringCapacity) * Math.PI * 2;
        const x = cx + Math.cos(angle) * radialDistance;
        const y = cy + Math.sin(angle) * radialDistance;
        if (!collides(x, y, r)) best = { x, y, r };
      }
    }

    if (!best) {
      // Espace infini : avance encore radialement sur un rayon stable jusqu'à sortir de toutes
      // les emprises déjà occupées. Toutes les emprises sont des disques finis : le parcours
      // termine donc nécessairement, sans repli susceptible de réintroduire un chevauchement.
      // Ce chemin n'est atteint que pour des volumes extrêmes.
      const angle = phase + orderIndex * goldenFraction * Math.PI * 2;
      let radialDistance = firstOrbit + maxRingAttempts * ringSpacing;
      while (!best) {
        const x = cx + Math.cos(angle) * radialDistance;
        const y = cy + Math.sin(angle) * radialDistance;
        if (!collides(x, y, r)) {
          best = { x, y, r };
          break;
        }
        radialDistance += ringSpacing;
      }
    }

    positions[itemIndex] = best;
    occupied.push(best);
  });

  return positions;
}

// ---- Layout complet : galaxies -> systèmes solaires -> étoiles, un seul espace persistant ---
// `universeData` : même forme que la réponse de GET /api/users/intellectual-universe
// (cf. server.js /api/users/intellectual-universe, mon-univers.js universeData). `worldRadius`
// est choisi par l'appelant (typiquement dérivé de la taille du viewport au chargement).
function layoutUniverseWorld(galaxies, worldRadius) {
  const galaxyItems = galaxies.map((g) => ({
    weight: g.solarSystems.reduce((sum, s) => sum + s.articleCount, 0) || 1,
    ref: g
  }));
  const galaxyPositions = packCirclesInDisk(galaxyItems, 0, 0, worldRadius, {
    minRatio: 0.14,
    maxRatio: 0.34,
    fillRatio: 0.58
  });

  // Première passe locale : les rayons visuels restent ceux du moteur historique, mais chaque
  // Solar réserve désormais l'enveloppe de son soleil, de ses étoiles et de marges bornées.
  const galaxyDrafts = galaxies.map((g, gi) => {
    const visualGalaxyRadius = galaxyPositions[gi].r;
    const systemItems = g.solarSystems.map((s) => ({ weight: s.articleCount || 1, ref: s }));
    const radiusProbe = packCirclesInDisk(systemItems, 0, 0, visualGalaxyRadius * 0.8, {
      minRatio: 0.18, maxRatio: 0.4, fillRatio: 0.48, gap: visualGalaxyRadius * 0.1
    });

    const systems = g.solarSystems.map((solarSystem, si) => {
      const visualRadius = radiusProbe[si].r;
      const nominalOrbit = visualRadius * 1.6;
      const starItems = solarSystem.stars.map((star) => ({ weight: star.articleCount || 1, ref: star }));
      const localStars = packSatellitesAroundPoint(starItems, 0, 0, nominalOrbit, {
        sizeBasis: visualRadius,
        minRatio: 0.18,
        maxRatio: 0.4,
        gap: Math.max(0.8, visualRadius * 0.12),
        phaseDegrees: stablePhaseDegrees(`${g.name}:${solarSystem.id}`),
        obstacles: [{ x: 0, y: 0, r: visualRadius }],
        occupied: []
      });
      const contentRadius = localStars.reduce(
        (extent, star) => Math.max(extent, Math.hypot(star.x, star.y) + star.r),
        visualRadius
      );
      const labelMargin = Math.min(visualRadius * 0.25, Math.max(0.8, visualRadius * 0.2));
      const safetyMargin = Math.max(0.8, visualRadius * 0.2);
      return {
        solarSystem,
        starItems,
        localStars,
        visualRadius,
        contentRadius,
        labelMargin,
        safetyMargin,
        effectiveRadius: contentRadius + labelMargin + safetyMargin
      };
    });

    const interGroupGap = Math.max(0.8, visualGalaxyRadius * 0.04);
    const packed = packFixedGroupsWithGrowth(
      systems.map((system) => ({
        weight: system.solarSystem.articleCount || 1,
        visualRadius: system.visualRadius,
        collisionRadius: system.effectiveRadius
      })),
      visualGalaxyRadius * 0.8,
      { gap: interGroupGap }
    );
    systems.forEach((system, index) => { system.localCenter = packed.positions[index]; });
    const contentRadius = systems.reduce(
      (extent, system) => Math.max(extent, Math.hypot(system.localCenter.x, system.localCenter.y) + system.effectiveRadius),
      visualGalaxyRadius
    );
    return { g, gi, visualRadius: visualGalaxyRadius, systems, contentRadius, logicalRadius: packed.logicalRadius, interGroupGap };
  });

  // Même protection au niveau supérieur : une galaxie garde son disque visuel historique, tandis
  // que son rayon de collision agrégé peut grandir avec ses groupes Solar.
  const galaxyGap = Math.max(0.8, worldRadius * 0.025);
  const packedGalaxies = packFixedGroupsWithGrowth(
    galaxyDrafts.map((draft) => ({
      weight: galaxyItems[draft.gi].weight,
      visualRadius: draft.visualRadius,
      collisionRadius: draft.contentRadius
    })),
    worldRadius,
    { gap: galaxyGap }
  );

  const outGalaxies = [];
  const outSolarSystems = [];
  const outStars = [];
  galaxyDrafts.forEach((draft, draftIndex) => {
    const center = packedGalaxies.positions[draftIndex];
    const galaxyNode = {
      id: `galaxy:${draft.g.name}`, name: draft.g.name, x: center.x, y: center.y,
      r: draft.visualRadius, contentRadius: draft.contentRadius, logicalRadius: draft.logicalRadius,
      weight: galaxyItems[draft.gi].weight, ref: draft.g
    };
    outGalaxies.push(galaxyNode);
    draft.systems.forEach((draftSystem) => {
      const x = center.x + draftSystem.localCenter.x;
      const y = center.y + draftSystem.localCenter.y;
      const systemNode = {
        id: `solarSystem:${draft.g.name}:${draftSystem.solarSystem.id}`,
        name: draftSystem.solarSystem.name,
        x, y, r: draftSystem.visualRadius,
        visualRadius: draftSystem.visualRadius,
        contentRadius: draftSystem.contentRadius,
        effectiveSolarRadius: draftSystem.effectiveRadius,
        labelMargin: draftSystem.labelMargin,
        safetyMargin: draftSystem.safetyMargin,
        orbitRadius: draftSystem.contentRadius,
        weight: draftSystem.solarSystem.articleCount || 1,
        galaxyId: galaxyNode.id,
        ref: draftSystem.solarSystem
      };
      outSolarSystems.push(systemNode);
      draftSystem.solarSystem.stars.forEach((star, starIndex) => {
        const local = draftSystem.localStars[starIndex];
        outStars.push({
          id: `star:${draft.g.name}:${draftSystem.solarSystem.id}:${star.id}`,
          name: star.name, x: x + local.x, y: y + local.y, r: local.r,
          weight: draftSystem.starItems[starIndex].weight,
          solarSystemId: systemNode.id, galaxyId: galaxyNode.id, ref: star
        });
      });
    });
  });

  // Validation explicite : aucun fallback au centre ni dépassement silencieux n'est accepté.
  for (let i = 0; i < outSolarSystems.length; i += 1) {
    for (let j = i + 1; j < outSolarSystems.length; j += 1) {
      const a = outSolarSystems[i];
      const b = outSolarSystems[j];
      const sameGalaxyGap = a.galaxyId === b.galaxyId
        ? galaxyDrafts.find((draft) => `galaxy:${draft.g.name}` === a.galaxyId).interGroupGap
        : galaxyGap;
      if (Math.hypot(a.x - b.x, a.y - b.y) + 1e-7 < a.effectiveSolarRadius + b.effectiveSolarRadius + sameGalaxyGap) {
        throw new Error(`Universe layout: Solar envelopes overlap (${a.id}, ${b.id})`);
      }
    }
  }

  // Le contrôle global historique est conservé comme invariant final, sans repousser les étoiles
  // hors de l'enveloppe qui vient d'être réservée.
  const solarById = new Map(outSolarSystems.map((solar) => [solar.id, solar]));
  for (let i = 0; i < outStars.length; i += 1) {
    const a = outStars[i];
    const parentA = solarById.get(a.solarSystemId);
    const starGapA = Math.max(0.8, (parentA?.r || 0) * 0.12);
    outSolarSystems.forEach((solar) => {
      if (solar.id === a.solarSystemId) return;
      if (Math.hypot(a.x - solar.x, a.y - solar.y) + 1e-7 < a.r + solar.r + starGapA) {
        throw new Error(`Universe layout: star overlaps a foreign Solar (${a.id}, ${solar.id})`);
      }
    });
    for (let j = i + 1; j < outStars.length; j += 1) {
      const b = outStars[j];
      const parentB = solarById.get(b.solarSystemId);
      const pairGap = Math.max(starGapA, Math.max(0.8, (parentB?.r || 0) * 0.12));
      if (Math.hypot(a.x - b.x, a.y - b.y) + 1e-7 < a.r + b.r + pairGap) {
        throw new Error(`Universe layout: stars overlap (${a.id}, ${b.id})`);
      }
    }
  }

  return {
    galaxies: outGalaxies,
    solarSystems: outSolarSystems,
    stars: outStars,
    worldRadius: packedGalaxies.logicalRadius
  };
}

function computeUniverseWorldBounds(layout) {
  const nodes = [
    ...(layout?.galaxies || []),
    ...(layout?.solarSystems || []),
    ...(layout?.stars || [])
  ];
  if (!nodes.length) return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  return nodes.reduce((bounds, node) => {
    const radius = Math.max(0, Number(node.r) || 0);
    bounds.minX = Math.min(bounds.minX, node.x - radius);
    bounds.maxX = Math.max(bounds.maxX, node.x + radius);
    bounds.minY = Math.min(bounds.minY, node.y - radius);
    bounds.maxY = Math.max(bounds.maxY, node.y + radius);
    return bounds;
  }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}

function focusScaleForUniverseNode(node, childTargetPx = 58, orbitFitPx = 165) {
  const targetR = node.maxChildR || node.r * 0.3;
  const legibilityScale = childTargetPx / targetR;
  if (!node.orbitRadius) return legibilityScale;
  return Math.min(legibilityScale, orbitFitPx / node.orbitRadius);
}

// ---- Caméra : zoom continu sur #universe-world à l'intérieur de #universe-viewport ------------
// État { x, y, scale } : (x,y) = point du monde actuellement au CENTRE du viewport, scale =
// facteur de zoom (1 = vue d'ensemble telle que dimensionnée par worldRadius au chargement).
// Le fond est une texture répétée dans le même espace logique. Il ne possède donc plus de bord
// à utiliser comme limite de panoramique : x/y peuvent être positifs ou négatifs et s'étendre
// aussi loin que les coordonnées numériques du navigateur le permettent.
function createUniverseCamera({
  viewportEl,
  worldEl,
  backgroundEl,
  backgroundTileWidth = 3840,
  backgroundTileHeight = 2560,
  minScale = 1,
  maxScale = 40,
  onChange
}) {
  let state = { x: 0, y: 0, scale: minScale };
  let raf = null;
  // Le conteneur autonome /mon-univers occupe toute la page. Dans cette vue seulement, la
  // molette/trackpad explore donc directement la mémoire avec une inertie légère. Le nuage
  // embarqué dans l'accueil conserve exactement son scroll de page historique.
  const isFullPageUniverse = Boolean(viewportEl.closest("#mnoria-universe-cloud"));

  // La texture ne change d'échelle que lorsque la scène zoome, mais son grossissement physique
  // reste très faible : à +15 % maximum, le PNG 4K conserve sa finesse même lorsque les objets
  // interactifs atteignent ×8 ou davantage. La progression logarithmique évite un saut visuel.
  const BACKGROUND_MAX_VISUAL_SCALE = 1.15;

  function getBackgroundVisualScale(sceneScale) {
    const scaleRange = Math.max(1, maxScale / minScale);
    if (scaleRange === 1) return 1;
    const progress = Math.log(Math.max(minScale, sceneScale) / minScale) / Math.log(scaleRange);
    return 1 + Math.min(1, Math.max(0, progress)) * (BACKGROUND_MAX_VISUAL_SCALE - 1);
  }

  function setBackgroundTileSize(width, height) {
    if (Number.isFinite(width) && width > 0) backgroundTileWidth = width;
    if (Number.isFinite(height) && height > 0) backgroundTileHeight = height;
  }

  // skipBackground (audit "refresh mobile sur Ma mémoire" du 16/08/2026) : le fond est une
  // texture 4K (3840×2560, ~39 Mo décodés) tuilée à l'infini via background-repeat — recalculer
  // background-size/background-position à CHAQUE pointermove (jusqu'à 60-120/s pendant un pan ou
  // un pincement tactile) force le compositeur à re-rastériser cette tuile en continu. Sur iOS,
  // ce coût GPU/mémoire soutenu pendant tout un geste est un déclencheur plausible du kill mémoire
  // WebKit qui redémarre ensuite la PWA (perçu comme un "rafraîchissement spontané"). Le monde
  // (worldEl, un simple transform sur des nœuds normaux) continue lui à se repeindre à chaque
  // frame, coût négligeable en comparaison — seul le fond est concerné par ce gel.
  function apply(options = {}) {
    const vw = viewportEl.clientWidth;
    const vh = viewportEl.clientHeight;
    const tx = vw / 2 - state.x * state.scale;
    const ty = vh / 2 - state.y * state.scale;
    worldEl.style.transform = `translate(${tx}px, ${ty}px) scale(${state.scale})`;
    // Le fond réagit uniquement au zoom de la scène, mais son facteur visuel est plafonné pour
    // ne plus agrandir les pixels du PNG jusqu'à ×8/×35. background-repeat assure toujours la
    // continuité dans les quatre directions sans créer de grille d'images dans le DOM.
    if (backgroundEl && !options.skipBackground) {
      const backgroundScale = getBackgroundVisualScale(state.scale);
      const tileW = backgroundTileWidth * backgroundScale;
      const tileH = backgroundTileHeight * backgroundScale;
      const positionX = vw / 2 - state.x * backgroundScale - tileW / 2;
      const positionY = vh / 2 - state.y * backgroundScale - tileH / 2;
      backgroundEl.style.backgroundSize = `${tileW}px ${tileH}px`;
      backgroundEl.style.backgroundPosition = `${positionX}px ${positionY}px`;
    }
    // Le panoramique est disponible à tous les niveaux, y compris à la vue d'ensemble : le
    // fond Mnoria est infini et l'utilisateur doit pouvoir explorer immédiatement sans être
    // obligé d'effectuer d'abord un zoom artificiel.
    viewportEl.classList.add("universe-zoom-can-pan");
  }

  function scheduleChange() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      onChange?.(state);
    });
  }

  function setState(next, animate = false, options = {}) {
    state = { ...state, ...next };
    state.scale = Math.min(maxScale, Math.max(minScale, state.scale));
    if (animate) {
      worldEl.style.transition = "transform 550ms cubic-bezier(.2,.7,.3,1)";
      const clearTransition = () => { worldEl.style.transition = ""; worldEl.removeEventListener("transitionend", clearTransition); };
      worldEl.addEventListener("transitionend", clearTransition);
      if (backgroundEl) {
        backgroundEl.style.transition = "background-position 550ms cubic-bezier(.2,.7,.3,1), background-size 550ms cubic-bezier(.2,.7,.3,1)";
        const clearBackgroundTransition = () => {
          backgroundEl.style.transition = "";
          backgroundEl.removeEventListener("transitionend", clearBackgroundTransition);
        };
        backgroundEl.addEventListener("transitionend", clearBackgroundTransition);
      }
    } else {
      worldEl.style.transition = "";
      if (backgroundEl) backgroundEl.style.transition = "";
    }
    apply(options);
    scheduleChange();
  }

  // syncBackgroundNow : force un dernier calcul du fond (jamais sauté) sur l'état courant — appelé
  // au RELÂCHEMENT d'un geste qui a gelé le fond pendant son déroulement (cf. skipBackground
  // ci-dessus), pour que le fond rattrape exactement la position/l'échelle finales plutôt que de
  // rester figé sur sa dernière valeur intermédiaire.
  function syncBackgroundNow() {
    apply();
  }

  // Zoom SUR PLACE : seul le scale change, x/y restent tels quels — jamais de recentrage sur le
  // curseur/point de pincement (essayé d'abord, cf. git blame) : la demande du 13/08/2026 est
  // justement qu'aucun geste de zoom ne déplace jamais la scène, "les galaxies restent fixes,
  // comme accrochées au fond".
  function zoomInPlace(factor, options = {}) {
    const newScale = Math.min(maxScale, Math.max(minScale, state.scale * factor));
    setState({ scale: newScale }, false, options);
  }

  function focusOn(node, targetScale) {
    setState({ x: node.x, y: node.y, scale: targetScale }, true);
  }

  function zoomOutTo(scale) {
    setState({ ...state, scale: Math.min(state.scale, scale) }, true);
  }

  // ---- Molette (desktop) ----
  // Dans la mémoire embarquée, une molette ordinaire appartient toujours à la PAGE. Dans la
  // page autonome, elle déplace la scène avec une décélération courte : les impulsions d'une
  // molette deviennent continues et les petits deltas d'un trackpad restent naturels.
  let wheelPanX = 0;
  let wheelPanY = 0;
  let wheelPanRaf = null;

  function animateFullPageWheelPan() {
    const stepX = wheelPanX * 0.24;
    const stepY = wheelPanY * 0.24;
    wheelPanX -= stepX;
    wheelPanY -= stepY;
    setState({
      x: state.x + stepX / state.scale,
      y: state.y + stepY / state.scale
    }, false, { skipBackground: true });

    if (Math.abs(wheelPanX) < 0.15 && Math.abs(wheelPanY) < 0.15) {
      wheelPanX = 0;
      wheelPanY = 0;
      wheelPanRaf = null;
      syncBackgroundNow();
      return;
    }
    wheelPanRaf = requestAnimationFrame(animateFullPageWheelPan);
  }

  viewportEl.addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomInPlace(Math.exp(-e.deltaY * 0.0009));
      return;
    }
    if (!isFullPageUniverse) return;

    e.preventDefault();
    const deltaUnit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? viewportEl.clientHeight : 1);
    wheelPanX += e.deltaX * deltaUnit;
    wheelPanY += e.deltaY * deltaUnit;
    if (!wheelPanRaf) wheelPanRaf = requestAnimationFrame(animateFullPageWheelPan);
  }, { passive: false });

  // ---- Pincement trackpad Mac dans Safari ----
  // Chrome/Edge sur Mac traduisent déjà le pincement en wheel+ctrlKey (géré juste au-dessus),
  // mais Safari déclenche à la place gesturestart/gesturechange/gestureend (API legacy propre à
  // WebKit, jamais wheel+ctrlKey pour ce geste précis) — sans ces écouteurs, pincer sur le
  // trackpad dans Safari ne faisait rien du tout (constaté le 13/08/2026). event.scale est
  // cumulé depuis gesturestart, jamais un delta : gestureLastScale retient la valeur précédente
  // pour en tirer un facteur incrémental. no-zoom.js bloque déjà le zoom natif de la page sur
  // ces mêmes événements (document, sans stopPropagation) : ces écouteurs, posés sur
  // viewportEl, se déclenchent avant lui dans l'ordre de bouillonnement et pilotent la caméra à
  // la place.
  let gestureLastScale = 1;
  viewportEl.addEventListener("gesturestart", (e) => {
    e.preventDefault();
    gestureLastScale = e.scale;
  });
  viewportEl.addEventListener("gesturechange", (e) => {
    e.preventDefault();
    zoomInPlace(e.scale / gestureLastScale, { skipBackground: true });
    gestureLastScale = e.scale;
  });
  viewportEl.addEventListener("gestureend", (e) => {
    e.preventDefault();
    syncBackgroundNow();
  });

  // ---- Pointer Events : geste vertical = page, geste dirigé = mémoire ------------------------
  // À un doigt, une intention verticale est laissée au scroll natif de la page ; une intention
  // horizontale/diagonale déplace la scène. À la souris, le glisser conserve le panoramique
  // direct. Deux doigts déplacent le point médian dans la mémoire et conservent le pincement de
  // zoom : c'est le geste volontaire requis pour explorer verticalement la scène elle-même.
  const activePointers = new Map();
  let dragLastPoint = null;
  let dragStartPoint = null;
  let singlePointerIntent = null;
  let pinchStartDist = null;
  let pinchLastMidpoint = null;

  function midpoint() {
    const pts = [...activePointers.values()];
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }
  function distance() {
    const pts = [...activePointers.values()];
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  viewportEl.addEventListener("pointerdown", (e) => {
    // .universe-knowledge-link : sans cette exclusion, setPointerCapture ci-dessous redirige
    // les événements souris suivants (dont le dblclick synthétisé) vers viewportEl plutôt que
    // le trait lui-même.
    if (e.target.closest("button, a, .universe-knowledge-link")) return;
    // Les écrans tactiles possèdent déjà une capture implicite. Ne pas forcer
    // setPointerCapture dans ce cas laisse surtout WebKit prendre en charge le
    // pan-y natif de la page (avec son inertie), sans relais JS saccadé.
    if (e.pointerType !== "touch" && e.pointerType !== "pen") {
      viewportEl.setPointerCapture(e.pointerId);
    }
    activePointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      pointerType: e.pointerType || "mouse"
    });
    if (activePointers.size === 1) {
      dragLastPoint = { x: e.clientX, y: e.clientY };
      dragStartPoint = { x: e.clientX, y: e.clientY };
      singlePointerIntent = (e.pointerType === "touch" || e.pointerType === "pen") ? null : "memory-pan";
    } else if (activePointers.size === 2) {
      dragLastPoint = null;
      dragStartPoint = null;
      singlePointerIntent = null;
      pinchStartDist = distance();
      pinchLastMidpoint = midpoint();
    }
  });

  viewportEl.addEventListener("pointermove", (e) => {
    if (!activePointers.has(e.pointerId)) return;
    const previousPointer = activePointers.get(e.pointerId);
    activePointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      pointerType: previousPointer.pointerType
    });

    if (activePointers.size === 1 && dragLastPoint) {
      const dx = e.clientX - dragLastPoint.x;
      const dy = e.clientY - dragLastPoint.y;
      const isTouchLike = previousPointer.pointerType === "touch" || previousPointer.pointerType === "pen";
      if (isTouchLike && !singlePointerIntent && dragStartPoint) {
        const totalDx = e.clientX - dragStartPoint.x;
        const totalDy = e.clientY - dragStartPoint.y;
        // Attend quelques pixels avant de verrouiller le geste : les petites
        // oscillations du doigt ne déplacent ni la page ni la mémoire.
        if (Math.hypot(totalDx, totalDy) < 8) return;
        singlePointerIntent = isFullPageUniverse
          ? "memory-pan"
          : (Math.abs(totalDy) > Math.abs(totalDx) * 1.15 ? "page-scroll" : "memory-pan");
      }
      if (singlePointerIntent === "page-scroll") {
        // Aucun preventDefault, aucun scrollBy : `touch-action: pan-y` confie
        // intégralement le geste au navigateur, donc déplacement continu et
        // inertie native même en standalone iOS.
        dragLastPoint = { x: e.clientX, y: e.clientY };
        return;
      }
      if (e.cancelable) e.preventDefault();
      // skipBackground : geste tactile/souris en cours (cf. commentaire sur apply() plus haut) —
      // le fond ne rattrape sa position exacte qu'au relâchement (releasePointer, syncBackgroundNow).
      setState({ x: state.x - dx / state.scale, y: state.y - dy / state.scale }, false, { skipBackground: true });
      dragLastPoint = { x: e.clientX, y: e.clientY };
    } else if (activePointers.size === 2) {
      // Deux doigts constituent le geste « prononcé » pour déplacer verticalement la mémoire.
      // Le déplacement du point médian pilote le panoramique tandis que la variation de leur
      // distance conserve le pincement de zoom existant.
      const nextMidpoint = midpoint();
      if (pinchLastMidpoint) {
        const dx = nextMidpoint.x - pinchLastMidpoint.x;
        const dy = nextMidpoint.y - pinchLastMidpoint.y;
        setState({ x: state.x - dx / state.scale, y: state.y - dy / state.scale }, false, { skipBackground: true });
      }
      pinchLastMidpoint = nextMidpoint;
      const dist = distance();
      if (pinchStartDist) {
        zoomInPlace(dist / pinchStartDist, { skipBackground: true });
        pinchStartDist = dist;
      }
    }
  });

  function releasePointer(e) {
    activePointers.delete(e.pointerId);
    if (activePointers.size === 1) {
      const [pt] = activePointers.values();
      dragLastPoint = { x: pt.x, y: pt.y };
      dragStartPoint = { x: pt.x, y: pt.y };
      singlePointerIntent = null;
      pinchStartDist = null;
      pinchLastMidpoint = null;
    } else if (activePointers.size === 0) {
      dragLastPoint = null;
      dragStartPoint = null;
      singlePointerIntent = null;
      pinchStartDist = null;
      pinchLastMidpoint = null;
    }
    // Fin d'un geste (relâchement d'un doigt, qu'il en reste un autre actif ou plus aucun) : le
    // fond, gelé pendant tout geste tactile/souris (cf. skipBackground ci-dessus), rattrape ici sa
    // position/échelle exactes correspondant à l'état final — jamais laissé sur une valeur
    // intermédiaire périmée.
    syncBackgroundNow();
  }
  viewportEl.addEventListener("pointerup", releasePointer);
  viewportEl.addEventListener("pointercancel", releasePointer);

  apply();

  return {
    getState: () => state,
    getScaleLimits: () => ({ minScale, maxScale }),
    setState,
    zoomBy(factor, animate = true) {
      const numericFactor = Number(factor);
      if (!Number.isFinite(numericFactor) || numericFactor <= 0) return;
      setState({ scale: state.scale * numericFactor }, animate);
    },
    focusOn,
    zoomOutTo,
    setBackgroundTileSize,
    refresh() {
      apply();
      scheduleChange();
    },
    destroy() {
      // Pas de removeEventListener détaillé (le conteneur est recréé côté appelant à chaque
      // ré-init, cf. mon-univers.js loadUniverse) — documenté pour un futur ajout si besoin.
    }
  };
}

export {
  layoutUniverseWorld,
  computeUniverseWorldBounds,
  focusScaleForUniverseNode,
  createUniverseCamera
};
