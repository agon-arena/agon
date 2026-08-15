// Moteur de scène + caméra pour "Ma mémoire" (public/mon-univers.js) : zoom spatial réel
// (galaxies -> systèmes solaires -> étoiles positionnés les uns DANS les autres, dans un seul
// espace de coordonnées persistant), demande du 13/08/2026 — remplace l'ancien modèle "un
// niveau = tout l'écran" (goToLevel/renderLevelNow, réinitialisant tagTrendCloud.js à chaque
// clic). Volontairement séparé de tagTrendCloud.js plutôt que d'y toucher : ce moteur partagé
// est aussi utilisé par les bulles Agôn/Actu (public/script.js), qui n'ont rien à voir avec un
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
  const baseRadii = () => normalized.map((w) => sizeScale * (minRatio + (maxRatio - minRatio) * w) * maxR);

  // Réduit l'échelle globale si la somme des aires dépasse l'aire utile du disque — même
  // logique que computeAutoScale (tagTrendCloud.js) mais ciblant un disque plutôt qu'un
  // rectangle de conteneur.
  const usableArea = Math.PI * maxR * maxR * fillRatio;
  const totalArea = () => baseRadii().reduce((sum, r) => sum + Math.PI * r * r, 0);
  if (totalArea() > usableArea) {
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
      const prefAngle = (k * golden) % 360;
      let best = null;
      for (let dist = 0; dist <= maxR - r + 1 && !best; dist += Math.max(2, maxR * 0.012)) {
        for (let step = 0; step < 24 && !best; step += 1) {
          const angle = ((prefAngle + (step % 2 === 0 ? step / 2 : -((step + 1) / 2)) * 22) * Math.PI) / 180;
          const x = cx + Math.cos(angle) * dist;
          const y = cy + Math.sin(angle) * dist;
          if (Math.hypot(x - cx, y - cy) + r > maxR) continue;
          const collides = placed.some((p) => Math.hypot(x - p.x, y - p.y) < r + p.r - 2 + gap);
          if (!collides) best = { x, y };
        }
      }
      if (!best) {
        // Repli : le centre du disque minimise la distance aux bords, toujours dans les
        // bornes (rare — disque très encombré après réduction d'échelle).
        best = { x: cx, y: cy };
      }
      placed.push({ x: best.x, y: best.y, r });
      positions[i] = { x: best.x, y: best.y, r };
    }
    return positions;
  }

  let radii = baseRadii();
  let positions = tryPlace(radii);
  // Filet de sécurité : si le repli au centre a dû être utilisé plusieurs fois (paquet très
  // dense), réduit encore l'échelle et retente, jusqu'à 4 fois — même esprit que la boucle de
  // computeAutoScale, jamais plus qu'un nombre borné d'essais.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const centerFallbacks = positions.filter((p) => p.x === cx && p.y === cy).length;
    if (centerFallbacks <= 1) break;
    sizeScale *= 0.88;
    radii = baseRadii();
    positions = tryPlace(radii);
  }

  return positions;
}

// Place des "satellites" en orbite AUTOUR d'un point (pas emboîtés dans un disque comme
// packCirclesInDisk) — demande du 13/08/2026 : les étoiles doivent apparaître comme des petits
// points lumineux autour du point du système solaire, pas empilées à l'intérieur de son propre
// cercle. Répartition à angle régulier (pas en spirale golden-angle comme packCirclesInDisk :
// un anneau régulier lit mieux comme "des satellites en orbite" qu'un nuage dispersé).
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

  // Rayon plafonné (en absolu, pas en ratio de sizeBasis) pour qu'aucun satellite ne touche son
  // voisin sur l'anneau, quel que soit leur nombre — ils se touchaient/chevauchaient dès que
  // plusieurs étoiles partageaient le même système. Distance entre deux satellites voisins
  // espacés régulièrement = 2·orbitRadius·sin(π/N) ; pour ne jamais se toucher (au rayon
  // maximal des deux), il faut rayon ≤ orbitRadius·sin(π/N) — 0.8 de marge de sécurité en plus
  // pour un vrai espace visible, pas juste "ne se touchent pas pile".
  const geometricMaxAbs = items.length > 1 ? orbitRadius * Math.sin(Math.PI / items.length) * 0.8 : sizeBasis * 0.5;
  const maxRatio = opts.maxRatio ?? 0.4;
  const minRatio = opts.minRatio ?? 0.18;
  const maxAbs = Math.min(maxRatio * sizeBasis, geometricMaxAbs);
  const minAbs = Math.min(minRatio * sizeBasis, maxAbs * 0.6);

  const weights = items.map((it) => Math.max(0, Number(it.weight) || 0));
  const maxWeight = Math.max(...weights, 1e-6);
  const normalized = weights.map((w) => 0.35 + 0.65 * Math.pow(w / maxWeight, 0.6));

  return items.map((_, i) => {
    const angle = ((i / items.length) * 360 + 15) * (Math.PI / 180); // +15° : jamais pile à droite du centre
    const r = minAbs + (maxAbs - minAbs) * normalized[i];
    return {
      x: cx + Math.cos(angle) * orbitRadius,
      y: cy + Math.sin(angle) * orbitRadius,
      r
    };
  });
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

  const outGalaxies = [];
  const outSolarSystems = [];
  const outStars = [];

  galaxies.forEach((g, gi) => {
    const gp = galaxyPositions[gi];
    const galaxyNode = { id: `galaxy:${g.name}`, name: g.name, x: gp.x, y: gp.y, r: gp.r, weight: galaxyItems[gi].weight, ref: g };
    outGalaxies.push(galaxyNode);

    const systemItems = g.solarSystems.map((s) => ({ weight: s.articleCount || 1, ref: s }));
    // gap + fillRatio réduit (0.6 -> 0.48) : les systèmes solaires d'une même galaxie
    // apparaissaient trop collés/proches les uns des autres (demande du 13/08/2026, "écarte les
    // solars des uns des autres") — un fillRatio plus bas force le calcul d'échelle globale à
    // rétrécir davantage les systèmes pour laisser plus de vide entre eux, le gap ajoute une
    // marge minimale garantie même sans ce rétrécissement (peu d'éléments, pas de compétition
    // d'aire).
    const systemPositions = packCirclesInDisk(systemItems, gp.x, gp.y, gp.r * 0.8, {
      minRatio: 0.18,
      maxRatio: 0.4,
      fillRatio: 0.48,
      gap: gp.r * 0.1
    });

    g.solarSystems.forEach((s, si) => {
      const sp = systemPositions[si];
      // orbitRadius : rayon de l'anneau où gravitent les étoiles de ce système (satellites,
      // cf. packSatellitesAroundPoint) — au-delà de son propre cercle (1.6x, pas 1.25x : plus
      // d'écart entre le point solaire et ses satellites, demande du 13/08/2026), pas emboîté
      // dedans. Conservé sur le nœud (pas seulement local à cette fonction) : mon-univers.js
      // s'en sert pour cadrer la caméra de sorte que TOUTE l'orbite tienne dans le cadre au
      // clic (cf. focusScaleFor), pas seulement la taille des étoiles elles-mêmes.
      const orbitRadius = sp.r * 1.6;
      const systemNode = {
        id: `solarSystem:${g.name}:${s.id}`,
        name: s.name,
        x: sp.x,
        y: sp.y,
        r: sp.r,
        orbitRadius,
        weight: systemItems[si].weight,
        galaxyId: galaxyNode.id,
        ref: s
      };
      outSolarSystems.push(systemNode);

      const starItems = s.stars.map((star) => ({ weight: star.articleCount || 1, ref: star }));
      const starPositions = packSatellitesAroundPoint(starItems, sp.x, sp.y, orbitRadius, {
        sizeBasis: sp.r,
        minRatio: 0.18,
        maxRatio: 0.4
      });

      s.stars.forEach((star, sti) => {
        const stp = starPositions[sti];
        outStars.push({
          id: `star:${g.name}:${s.id}:${star.id}`,
          name: star.name,
          x: stp.x,
          y: stp.y,
          r: stp.r,
          weight: starItems[sti].weight,
          solarSystemId: systemNode.id,
          galaxyId: galaxyNode.id,
          ref: star
        });
      });
    });
  });

  return { galaxies: outGalaxies, solarSystems: outSolarSystems, stars: outStars, worldRadius };
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

  function apply() {
    const vw = viewportEl.clientWidth;
    const vh = viewportEl.clientHeight;
    const tx = vw / 2 - state.x * state.scale;
    const ty = vh / 2 - state.y * state.scale;
    worldEl.style.transform = `translate(${tx}px, ${ty}px) scale(${state.scale})`;
    // Le fond réagit uniquement au zoom de la scène, mais son facteur visuel est plafonné pour
    // ne plus agrandir les pixels du PNG jusqu'à ×8/×35. background-repeat assure toujours la
    // continuité dans les quatre directions sans créer de grille d'images dans le DOM.
    if (backgroundEl) {
      const backgroundScale = getBackgroundVisualScale(state.scale);
      const tileW = backgroundTileWidth * backgroundScale;
      const tileH = backgroundTileHeight * backgroundScale;
      const positionX = vw / 2 - state.x * backgroundScale - tileW / 2;
      const positionY = vh / 2 - state.y * backgroundScale - tileH / 2;
      backgroundEl.style.backgroundSize = `${tileW}px ${tileH}px`;
      backgroundEl.style.backgroundPosition = `${positionX}px ${positionY}px`;
    }
    // Curseur "main" uniquement quand le panoramique est réellement possible (state.scale >
    // minScale, cf. le pointermove plus bas) — jamais à la vue d'ensemble, où glisser ne fait
    // rien (indice visuel cohérent avec le comportement réel).
    viewportEl.classList.toggle("universe-zoom-can-pan", state.scale > minScale);
  }

  function scheduleChange() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      onChange?.(state);
    });
  }

  function setState(next, animate = false) {
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
    apply();
    scheduleChange();
  }

  // Zoom SUR PLACE : seul le scale change, x/y restent tels quels — jamais de recentrage sur le
  // curseur/point de pincement (essayé d'abord, cf. git blame) : la demande du 13/08/2026 est
  // justement qu'aucun geste de zoom ne déplace jamais la scène, "les galaxies restent fixes,
  // comme accrochées au fond".
  function zoomInPlace(factor) {
    const newScale = Math.min(maxScale, Math.max(minScale, state.scale * factor));
    setState({ scale: newScale }, false);
  }

  function focusOn(node, targetScale) {
    setState({ x: node.x, y: node.y, scale: targetScale }, true);
  }

  function zoomOutTo(scale) {
    setState({ ...state, scale: Math.min(state.scale, scale) }, true);
  }

  // ---- Molette (desktop) ----
  // 0.0009 (pas 0.0016, trop sensible : quelques crans suffisaient à dépasser toute la plage
  // utile et à se retrouver "dans" une bulle sans plus rien voir, constaté le 13/08/2026) —
  // zoom plus progressif, contrôlable sur toute la plage min/max. zoomInPlace (pas de suivi du
  // curseur) : demande du 13/08/2026, jamais de déplacement de la scène par un geste de zoom.
  viewportEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomInPlace(Math.exp(-e.deltaY * 0.0009));
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
    zoomInPlace(e.scale / gestureLastScale);
    gestureLastScale = e.scale;
  });
  viewportEl.addEventListener("gestureend", (e) => {
    e.preventDefault();
  });

  // ---- Pointer Events : un doigt/clic-glisser = panoramique, deux doigts = pincement ----------
  // Panoramique actif UNIQUEMENT une fois zoomé au-delà de la vue d'ensemble (state.scale >
  // minScale) — demande du 13/08/2026, en deux temps : d'abord "les galaxies restent fixes à
  // la vue d'ensemble, je ne peux pas aller à droite/gauche" (panoramique retiré), puis "une
  // fois que je zoome, je veux pouvoir aller dans toutes les directions" (panoramique remis,
  // mais seulement une fois zoomé — sinon on retombe dans le premier problème signalé). Le
  // pincement à deux doigts, lui, reste un zoom sur place à tout niveau (jamais de panoramique
  // via son point médian, cf. zoomInPlace).
  const activePointers = new Map();
  let dragLastPoint = null;
  let pinchStartDist = null;

  function midpoint() {
    const pts = [...activePointers.values()];
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }
  function distance() {
    const pts = [...activePointers.values()];
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  viewportEl.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, a")) return;
    viewportEl.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 1) {
      dragLastPoint = { x: e.clientX, y: e.clientY };
    } else if (activePointers.size === 2) {
      dragLastPoint = null;
      pinchStartDist = distance();
    }
  });

  viewportEl.addEventListener("pointermove", (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 1 && dragLastPoint) {
      if (state.scale > minScale) {
        const dx = e.clientX - dragLastPoint.x;
        const dy = e.clientY - dragLastPoint.y;
        setState({ x: state.x - dx / state.scale, y: state.y - dy / state.scale }, false);
      }
      dragLastPoint = { x: e.clientX, y: e.clientY };
    } else if (activePointers.size === 2) {
      const dist = distance();
      if (pinchStartDist) {
        zoomInPlace(dist / pinchStartDist);
        pinchStartDist = dist;
      }
    }
  });

  function releasePointer(e) {
    activePointers.delete(e.pointerId);
    if (activePointers.size === 1) {
      const [pt] = activePointers.values();
      dragLastPoint = { x: pt.x, y: pt.y };
      pinchStartDist = null;
    } else if (activePointers.size === 0) {
      dragLastPoint = null;
      pinchStartDist = null;
    }
  }
  viewportEl.addEventListener("pointerup", releasePointer);
  viewportEl.addEventListener("pointercancel", releasePointer);

  apply();

  return {
    getState: () => state,
    setState,
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

export { layoutUniverseWorld, createUniverseCamera };
