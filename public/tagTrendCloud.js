function getBubbleSizeClass(index, trendItem = null) {
  const weight = Number(trendItem?.sizeWeight);
  if (Number.isFinite(weight)) {
    if (weight >= 0.72 || index === 0) return "agon-tag-bubble-large";
    if (weight >= 0.38) return "agon-tag-bubble-medium";
    return "agon-tag-bubble-small";
  }

  if (index <= 2) return "agon-tag-bubble-large";
  if (index <= 5) return "agon-tag-bubble-medium";
  return "agon-tag-bubble-small";
}

const MAX_TAG_TREND_BUBBLES = 10;

// Source unique de vérité pour la taille d'une bulle en pixels, avant facteur d'échelle global.
// Utilisée à la fois pour l'affichage visuel (--agon-tag-bubble-size) et pour le placement.
function computeBubblePxSize(index, trendItem, isMobile) {
  const weight = Number(trendItem?.sizeWeight);
  if (Number.isFinite(weight)) {
    const clamped = Math.max(0, Math.min(1, weight));
    const amplified = Math.pow(clamped, 1.75);
    const minSize = isMobile ? 58 : 70;
    const maxSize = index === 0
      ? (isMobile ? 155 : 185)
      : (isMobile ? 132 : 162);
    return Math.round(minSize + ((maxSize - minSize) * amplified));
  }
  // Fallback aligné sur les tailles par défaut des classes CSS
  const sizeClass = getBubbleSizeClass(index);
  if (sizeClass === "agon-tag-bubble-large") return index === 1 ? (isMobile ? 153 : 176) : (isMobile ? 128 : 153);
  if (sizeClass === "agon-tag-bubble-medium") return isMobile ? 110 : 128;
  return isMobile ? 72 : 86;
}

// Facteur d'échelle uniforme pour que toutes les bulles tiennent dans la zone utile.
// Retourne 1.0 si elles tiennent déjà, sinon réduit proportionnellement (min 0.45).
function computeAutoScale(baseSizes, containerW, containerH, frameTop, frameBottomInset) {
  const usableH = Math.max(0, containerH - frameTop - frameBottomInset);
  const usableArea = containerW * usableH * 0.70;
  if (usableArea <= 0) return 1;
  const totalBubbleArea = baseSizes.reduce((sum, s) => sum + Math.PI * (s / 2) * (s / 2), 0);
  if (totalBubbleArea <= usableArea) return 1;
  return Math.max(0.45, Math.sqrt(usableArea / totalBubbleArea));
}

function getTrendMeta(trend) {
  const value = Number.isFinite(Number(trend)) ? Math.round(Number(trend)) : 0;
  if (value > 0) return { className: "agon-tag-trend-up",     label: `▲ +${value}%` };
  if (value < 0) return { className: "agon-tag-trend-down",   label: `▼ ${value}%` };
  return              { className: "agon-tag-trend-neutral", label: "= 0%" };
}

function getWordLengthClass(word) {
  const len = word.length;
  if (len <= 5)  return "agon-tag-word-short";
  if (len <= 9)  return "agon-tag-word-medium";
  if (len <= 13) return "agon-tag-word-long";
  return "agon-tag-word-xlong";
}

function clearTagTrendCloud(container) {
  container.innerHTML = "";
  const parentSection = container.closest("section");
  if (parentSection) parentSection.hidden = true;
}

function fitLabelInBubble(bubble) {
  const label = bubble.querySelector(".agon-tag-label");
  if (!label) return;

  const trendEl = bubble.querySelector(".agon-tag-trend");
  const trendH = trendEl ? trendEl.offsetHeight + 3 : 0;
  const bubbleW = bubble.clientWidth || 0;
  const bubbleH = bubble.clientHeight || 0;
  const wordCount = Math.max(1, label.querySelectorAll(".agon-tag-word").length);
  const labelText = getTagTextFromLabel(label);
  const charCount = labelText.replace(/\s+/g, "").length;
  const lengthFactor = charCount >= 22 ? 0.72 : charCount >= 16 ? 0.82 : charCount >= 11 ? 0.92 : 1;
  const wordFactor = wordCount >= 4 ? 0.27 : wordCount === 3 ? 0.32 : wordCount === 2 ? 0.38 : 0.46;

  label.style.paddingTop = "0px";
  label.style.paddingBottom = "0px";
  label.style.lineHeight = wordCount >= 2 ? "1.08" : "1.03";
  label.style.maxWidth = Math.round(bubbleW * 0.92) + "px";

  const availW = bubbleW * 0.92;
  const availH = Math.max(16, bubbleH - trendH - 18);

  let low = Math.max(8, Math.min(12, bubbleW * 0.1));
  let high = Math.min(56, Math.max(14, bubbleW * wordFactor * lengthFactor));

  for (let iter = 0; iter < 24; iter += 1) {
    const mid = (low + high) / 2;
    label.style.fontSize = mid + "px";
    if (label.scrollWidth <= availW && label.scrollHeight <= availH) {
      low = mid;
    } else {
      high = mid;
    }
  }

  label.style.fontSize = Math.max(10, Math.floor(low * 10) / 10) + "px";
}

function getTagTextFromLabel(label) {
  const words = label?.querySelectorAll(".agon-tag-word");
  return words?.length
    ? Array.from(words).map(w => w.textContent.trim()).join(" ").trim()
    : (label?.textContent.trim() || "");
}

function renderLabelOverlays(container) {
  container.querySelectorAll(".agon-tag-label-overlay").forEach(el => el.remove());

  const containerRect = container.getBoundingClientRect();
  container.querySelectorAll(".agon-tag-bubble").forEach(bubble => {
    const label = bubble.querySelector(".agon-tag-label");
    if (!label) return;

    const tag = getTagTextFromLabel(label);
    const labelRect = label.getBoundingClientRect();
    const overlay = label.cloneNode(true);
    overlay.classList.add("agon-tag-label-overlay");
    if (bubble.classList.contains("agon-tag-bubble-active")) {
      overlay.classList.add("agon-tag-label-overlay-active");
    }
    overlay.dataset.tag = tag.toLowerCase();
    overlay.style.position = "absolute";
    overlay.style.left = (labelRect.left - containerRect.left) + "px";
    overlay.style.top = (labelRect.top - containerRect.top) + "px";
    overlay.style.width = labelRect.width + "px";
    overlay.style.height = labelRect.height + "px";
    overlay.style.fontSize = label.style.fontSize || getComputedStyle(label).fontSize;
    overlay.style.lineHeight = label.style.lineHeight || getComputedStyle(label).lineHeight;
    overlay.style.maxWidth = label.style.maxWidth || getComputedStyle(label).maxWidth;
    container.appendChild(overlay);
  });

  resolveLabelOverlayCollisions(container);
}

function getOverlayTextRect(overlay) {
  const words = [...overlay.querySelectorAll(".agon-tag-word")];
  const rects = words.length ? words.map((word) => word.getBoundingClientRect()) : [overlay.getBoundingClientRect()];
  const visibleRects = rects.filter((rect) => rect.width > 0 && rect.height > 0);
  if (!visibleRects.length) return overlay.getBoundingClientRect();

  return {
    left: Math.min(...visibleRects.map((rect) => rect.left)),
    top: Math.min(...visibleRects.map((rect) => rect.top)),
    right: Math.max(...visibleRects.map((rect) => rect.right)),
    bottom: Math.max(...visibleRects.map((rect) => rect.bottom))
  };
}

function getRectOverlapArea(a, b) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}

function isMobileTagCloud() {
  return window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
}

function rectToContainerSpace(rect, containerRect, padding = 0) {
  return {
    l: rect.left - containerRect.left - padding,
    t: rect.top - containerRect.top - padding,
    r: rect.right - containerRect.left + padding,
    b: rect.bottom - containerRect.top + padding
  };
}

function getReadableTextRects(container, containerRect) {
  const padding = isMobileTagCloud() ? 10 : 3;
  const rects = [];

  container.querySelectorAll(".agon-tag-label-overlay").forEach((overlay) => {
    const wordRects = [...overlay.querySelectorAll(".agon-tag-word")]
      .map((word) => word.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);

    if (wordRects.length) {
      const unionRect = {
        left: Math.min(...wordRects.map((rect) => rect.left)),
        top: Math.min(...wordRects.map((rect) => rect.top)),
        right: Math.max(...wordRects.map((rect) => rect.right)),
        bottom: Math.max(...wordRects.map((rect) => rect.bottom))
      };
      rects.push(rectToContainerSpace(unionRect, containerRect, padding));
      return;
    }

    const overlayRect = overlay.getBoundingClientRect();
    if (overlayRect.width > 0 && overlayRect.height > 0) {
      rects.push(rectToContainerSpace(overlayRect, containerRect, padding));
    }
  });

  return rects;
}

function shrinkOverlayText(overlay, factor = 0.9) {
  const currentSize = parseFloat(overlay.style.fontSize || getComputedStyle(overlay).fontSize || "12");
  const nextSize = Math.max(8, currentSize * factor);
  if (nextSize >= currentSize - 0.1) return false;
  overlay.style.fontSize = nextSize.toFixed(1) + "px";
  return true;
}

function resolveLabelOverlayCollisions(container) {
  const overlays = [...container.querySelectorAll(".agon-tag-label-overlay")];
  if (overlays.length < 2) return;

  for (let pass = 0; pass < 12; pass += 1) {
    let changed = false;
    const rects = overlays.map(getOverlayTextRect);

    for (let i = 0; i < overlays.length; i += 1) {
      for (let j = i + 1; j < overlays.length; j += 1) {
        const overlapArea = getRectOverlapArea(rects[i], rects[j]);
        if (overlapArea <= 8) continue;

        changed = shrinkOverlayText(overlays[i]) || changed;
        changed = shrinkOverlayText(overlays[j]) || changed;
      }
    }

    if (!changed) break;
  }

  const centerBtn = container.querySelector(".agon-tag-center-btn");
  if (!centerBtn) return;
  const centerRect = centerBtn.getBoundingClientRect();
  for (let pass = 0; pass < 14; pass += 1) {
    let changed = false;
    overlays.forEach((overlay) => {
      const overlapArea = getRectOverlapArea(getOverlayTextRect(overlay), centerRect);
      if (overlapArea <= 2) return;
      changed = shrinkOverlayText(overlay, 0.86) || changed;
    });
    if (!changed) break;
  }
}

function applyCompactBubbleLayout(container) {
  const bubbles = [...container.querySelectorAll(".agon-tag-bubble")];
  if (!bubbles.length) return;

  const containerW = Math.round(container.getBoundingClientRect().width) || container.clientWidth || 390;
  const containerH = Math.round(container.getBoundingClientRect().height) || container.clientHeight || 548;
  const centerX = containerW / 2;
  const isMobile = window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
  const frameTopRaw = getComputedStyle(container).getPropertyValue("--bubble-frame-top").trim();
  const frameTop = parseFloat(frameTopRaw) || 55;
  const frameBottomInset = isMobile ? 78 : 23;
  const centerY = (frameTop + (containerH - frameBottomInset)) / 2;

  const centerBtnEl = container.querySelector(".agon-tag-center-btn");
  if (centerBtnEl) centerBtnEl.style.top = Math.round(centerY) + "px";

  // Lire les tailles de base stockées au moment du rendu
  const baseSizes = bubbles.map(b => parseFloat(b.dataset.bubbleBaseSize) || 80);

  // Calculer le facteur d'échelle global pour que toutes les bulles rentrent
  const autoScale = computeAutoScale(baseSizes, containerW, containerH, frameTop, frameBottomInset);

  const margin = isMobile ? 4 : 6;
  const btnRadius = 24;
  const preferredAngles = [-8, 194, 88, 270, 142, 42, 232, 316, 118, 292, 166, 12];
  const maxAllowedOverlap = 4;

  function measureMaxBubbleOverlap(placedBubbles) {
    let maxOverlap = 0;
    for (let i = 0; i < placedBubbles.length; i += 1) {
      for (let j = i + 1; j < placedBubbles.length; j += 1) {
        const a = placedBubbles[i];
        const b = placedBubbles[j];
        const gap = Math.hypot(a.x - b.x, a.y - b.y) - (a.r + b.r);
        if (gap < 0) maxOverlap = Math.max(maxOverlap, -gap);
      }
    }
    return maxOverlap;
  }

  function placeBubblesWithScale(scale) {
    // Appliquer les tailles mises à l'échelle : même valeur pour l'affichage et le placement
    const scaledSizes = baseSizes.map((base, i) => {
      const scaled = Math.max(48, Math.round(base * scale));
      bubbles[i].style.setProperty("--agon-tag-bubble-size", scaled + "px");
      return scaled;
    });

    // Obstacles déjà placés (bouton central inclus)
    const placed = [{ x: centerX, y: centerY, r: btnRadius }];
    const placedBubbles = [];
    const placementItems = bubbles
      .map((bubble, index) => ({ bubble, index, size: scaledSizes[index] }))
      .sort((a, b) => (b.size - a.size) || (a.index - b.index));

    placementItems.forEach(({ bubble, index, size }) => {
      const r = size / 2;
      const prefAngle = (preferredAngles[index] ?? (index * 137.5)) * Math.PI / 180;

      // Limites strictes : le centre de la bulle doit rester suffisamment loin des bords
      // pour que la bulle entière reste dans la zone utile du conteneur
      const minX = r + margin;
      const maxX = containerW - r - margin;
      const minY = frameTop + r + margin;
      const maxY = containerH - frameBottomInset - r - margin;

      if (minX > maxX || minY > maxY) {
        // Zone trop petite pour cette bulle : la centrer et passer à la suivante
        const cx = centerX;
        const cy = Math.min(Math.max(centerY, minY > maxY ? (minY + maxY) / 2 : minY), maxY > minY ? maxY : centerY);
        placed.push({ x: cx, y: cy, r });
        placedBubbles.push({ x: cx, y: cy, r });
        bubble.style.left = Math.round(cx - r) + "px";
        bubble.style.top  = Math.round(cy - r) + "px";
        bubble.style.right = "auto";
        return;
      }

      let fx = null, fy = null;
      const maxDist = Math.hypot(containerW, containerH);

      // Recherche spirale : distance croissante depuis le centre, angle alterné autour de la direction préférée
      for (let dist = btnRadius + r; dist <= maxDist && fx === null; dist += 3) {
        const steps = Math.max(72, Math.round(2 * Math.PI * dist / 4));
        for (let step = 0; step < steps && fx === null; step++) {
          const dAngle = step % 2 === 0
            ? (step / 2) * (2 * Math.PI / steps)
            : -Math.ceil(step / 2) * (2 * Math.PI / steps);
          const angle = prefAngle + dAngle;
          const cx = centerX + Math.cos(angle) * dist;
          const cy = centerY + Math.sin(angle) * dist;
          if (cx < minX || cx > maxX || cy < minY || cy > maxY) continue;
          let valid = true;
          for (const p of placed) {
            if (Math.hypot(cx - p.x, cy - p.y) < r + p.r - 4) { valid = false; break; }
          }
          if (valid) { fx = cx; fy = cy; }
        }
      }

      if (fx === null) {
        // Fallback : scan coarser, pick position with minimum total overlap
        let bestOverlap = Infinity;
        for (let dist2 = btnRadius + r; dist2 <= maxDist * 0.8 && bestOverlap > 0; dist2 += 8) {
          const steps2 = Math.max(24, Math.round(2 * Math.PI * dist2 / 10));
          for (let step2 = 0; step2 < steps2; step2++) {
            const angle2 = prefAngle + step2 * (2 * Math.PI / steps2);
            const cx2 = centerX + Math.cos(angle2) * dist2;
            const cy2 = centerY + Math.sin(angle2) * dist2;
            if (cx2 < minX || cx2 > maxX || cy2 < minY || cy2 > maxY) continue;
            let totalOverlap = 0;
            for (const p of placed) {
              const gap = Math.hypot(cx2 - p.x, cy2 - p.y) - (r + p.r);
              if (gap < 0) totalOverlap -= gap;
            }
            if (totalOverlap < bestOverlap) { bestOverlap = totalOverlap; fx = cx2; fy = cy2; }
          }
        }
        if (fx === null) {
          fx = Math.min(maxX, Math.max(minX, centerX + Math.cos(prefAngle) * (btnRadius + r + 20)));
          fy = Math.min(maxY, Math.max(minY, centerY + Math.sin(prefAngle) * (btnRadius + r + 20)));
        }
      }

      placed.push({ x: fx, y: fy, r });
      placedBubbles.push({ x: fx, y: fy, r });
      bubble.style.left = Math.round(fx - r) + "px";
      bubble.style.top  = Math.round(fy - r) + "px";
      bubble.style.right = "auto";
    });

    return measureMaxBubbleOverlap(placedBubbles);
  }

  let scale = autoScale;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const maxOverlap = placeBubblesWithScale(scale);
    if (maxOverlap <= maxAllowedOverlap) break;

    const nextScale = Math.max(0.45, scale * 0.94);
    if (nextScale === scale) break;
    scale = nextScale;
  }
}

function positionTrendBadges(container) {
  const containerRect = container.getBoundingClientRect();
  const cW = container.clientWidth;
  const cH = container.clientHeight;

  const allBubbles = [...container.querySelectorAll(".agon-tag-bubble")];

  const bubbleGeo = allBubbles.map(b => {
    const br = b.getBoundingClientRect();
    return {
      cx: br.left - containerRect.left + br.width / 2,
      cy: br.top  - containerRect.top  + br.height / 2,
      r:  br.width / 2
    };
  });

  // Zones de lecture des tags. Sur mobile, la marge est volontairement plus large :
  // un badge ne doit jamais masquer un mot, même visuellement avec l'ombre du texte.
  const overlayRects = getReadableTextRects(container, containerRect);

  const cbtn = container.querySelector(".agon-tag-center-btn");
  const cbtnR = cbtn ? (() => {
    const r = cbtn.getBoundingClientRect();
    return { l: r.left - containerRect.left - 4, t: r.top - containerRect.top - 4, r: r.right - containerRect.left + 4, b: r.bottom - containerRect.top + 4 };
  })() : null;

  const placed = [];

  // Angles candidats : sommet en priorité, puis expansion symétrique vers les côtés
  const ANGLES = [-90, -105, -75, -120, -60, -135, -45, -150, -30, 180, 0, 150, 30];

  function rectsOverlap(al, at, ar, ab, bl, bt, br, bb) {
    return al < br && ar > bl && at < bb && ab > bt;
  }

  function getOverlapArea(al, at, ar, ab, bl, bt, br, bb) {
    if (!rectsOverlap(al, at, ar, ab, bl, bt, br, bb)) return 0;
    return (Math.min(ar, br) - Math.max(al, bl)) * (Math.min(ab, bb) - Math.max(at, bt));
  }

  allBubbles.forEach((bubble, idx) => {
    const trend = bubble.querySelector(".agon-tag-trend")
      || container.querySelector(`.agon-tag-trend[data-bubble-index="${bubble.dataset.bubbleIndex || idx}"]`);
    if (!trend) return;

    const geo = bubbleGeo[idx];

    container.appendChild(trend);
    trend.style.position = "absolute";
    trend.style.left = "0px";
    trend.style.top  = "0px";
    trend.style.right = "auto";
    trend.style.zIndex = "30";
    trend.style.display = "";

    const trendRect = trend.getBoundingClientRect();
    const tw = trendRect.width  || trend.offsetWidth  || 32;
    const th = trendRect.height || trend.offsetHeight || 14;

    const allowedBubbleOverlap = 6;
    const preferredOutsideDistance = Math.max(
      geo.r + th / 2 - allowedBubbleOverlap,
      geo.r * 0.82
    );
    const maxOutsideDistance = geo.r + th * (isMobileTagCloud() ? 3.2 : 2.4) + (isMobileTagCloud() ? 42 : 28);
    const distanceCandidates = [];
    for (let d = preferredOutsideDistance; d <= maxOutsideDistance; d += 3) {
      distanceCandidates.push(d);
    }
    distanceCandidates.push(maxOutsideDistance);
    const angleCandidates = Array.from(new Set([
      ...ANGLES,
      ...Array.from({ length: isMobileTagCloud() ? 48 : 24 }, (_, i) => -180 + i * (isMobileTagCloud() ? 7.5 : 15))
    ]));

    function scoreCandidate(angleDeg, distance) {
      const rad = angleDeg * Math.PI / 180;
      const cx = geo.cx + Math.cos(rad) * distance;
      const cy = geo.cy + Math.sin(rad) * distance;
      const l = cx - tw / 2, t = cy - th / 2;
      const r = l + tw,      b = t + th;

      const bleed = isMobileTagCloud() ? 18 : 4;
      if (l < -bleed || t < -bleed || r > cW + bleed || b > cH + bleed) return null;

      let s = 0;

      // Préférer le sommet (-90°)
      s -= Math.max(0, distance - preferredOutsideDistance) * 12;
      s -= Math.abs(angleDeg + 90) * 0.8;

      // Pénalité : badge profond dans une autre bulle
      for (let i = 0; i < bubbleGeo.length; i++) {
        if (i === idx) continue;
        const ob = bubbleGeo[i];
        const bCx = (l + r) / 2, bCy = (t + b) / 2;
        const dist = Math.hypot(bCx - ob.cx, bCy - ob.cy);
        if (dist < ob.r - 10) s -= 300;
        else if (dist < ob.r)  s -= 60 * (ob.r - dist);
      }

      let textOverlapArea = 0;

      // Blocage lisibilité : un badge ne doit pas recouvrir le texte d'une bulle.
      for (const or of overlayRects) {
        textOverlapArea += getOverlapArea(l, t, r, b, or.l, or.t, or.r, or.b);
      }

      // Pénalité : chevauchement avec badge déjà placé
      for (const pb of placed) {
        s -= getOverlapArea(l, t, r, b, pb.l, pb.t, pb.r, pb.b) * 15;
      }

      // Blocage absolu : bouton central
      if (cbtnR && rectsOverlap(l, t, r, b, cbtnR.l, cbtnR.t, cbtnR.r, cbtnR.b)) {
        return null;
      }

      return { score: s, textOverlapArea, l, t, r, b };
    }

    let bestReadable = null;
    for (const distance of distanceCandidates) {
      for (const angle of angleCandidates) {
        const candidate = scoreCandidate(angle, distance);
        if (!candidate) continue;
        if (candidate.textOverlapArea > 0) continue;
        if (!bestReadable || candidate.score > bestReadable.score) {
          bestReadable = candidate;
        }
      }
    }

    const best = bestReadable;
    if (!best) {
      trend.style.display = "none";
      return;
    }

    trend.style.display = "";
    const finalL = Math.round(best.l);
    const finalT = Math.round(best.t);

    trend.style.left = finalL + "px";
    trend.style.top  = finalT + "px";

    placed.push({ l: finalL, t: finalT, r: finalL + tw, b: finalT + th });
  });
}

function layoutTagTrendCloud(container) {
  applyCompactBubbleLayout(container);
  container.querySelectorAll(".agon-tag-bubble").forEach(fitLabelInBubble);
  renderLabelOverlays(container);
  positionTrendBadges(container);
}

function renderTagTrendCloud(container, trends, onReady) {
  if (!container) return;

  if (!Array.isArray(trends) || !trends.length) {
    clearTagTrendCloud(container);
    return;
  }

  const parentSection = container.closest("section");
  if (parentSection) parentSection.hidden = false;

  container.innerHTML = "";

  const isMobile = window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
  const POS_ORDER = [1, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

  trends.slice(0, MAX_TAG_TREND_BUBBLES).forEach((trendItem, index) => {
    const tag = String(trendItem?.tag || "").trim();
    if (!tag) return;

    const trendValue = Number(trendItem?.trend);
    const trendMeta = getTrendMeta(trendValue);
    const bubble = document.createElement("button");
    bubble.className = [
      "agon-tag-bubble",
      getBubbleSizeClass(index, trendItem),
      `agon-tag-pos-${POS_ORDER[index] ?? index}`
    ].join(" ");

    // Taille de base calculée (sans facteur d'échelle) — stockée en data-attribute
    // pour que applyCompactBubbleLayout puisse la relire et calculer l'échelle globale.
    const basePxSize = computeBubblePxSize(index, trendItem, isMobile);
    bubble.dataset.bubbleBaseSize = basePxSize;
    bubble.dataset.bubbleIndex = String(index);
    bubble.dataset.tag = tag;
    bubble.dataset.subjectId = String(trendItem?.subjectId || "").trim();
    bubble.style.setProperty("--agon-tag-bubble-size", basePxSize + "px");

    bubble.type = "button";

    const label = document.createElement("span");
    label.className = "agon-tag-label";

    tag.split(/\s+/).filter(Boolean).forEach(word => {
      const wordSpan = document.createElement("span");
      wordSpan.className = `agon-tag-word ${getWordLengthClass(word)}`;
      wordSpan.textContent = word.toUpperCase();
      label.appendChild(wordSpan);
    });

    const flashWrap = document.createElement("span");
    flashWrap.className = "agon-tag-bubble-flash";

    const trendSpan = document.createElement("span");
    trendSpan.className = `agon-tag-trend ${trendMeta.className}`;
    trendSpan.dataset.bubbleIndex = String(index);
    trendSpan.dataset.tag = tag;
    trendSpan.dataset.subjectId = String(trendItem?.subjectId || "").trim();
    trendSpan.textContent = trendMeta.label;
    bubble.append(flashWrap, trendSpan, label);
    container.appendChild(bubble);
  });

  const centerBtn = document.createElement("button");
  centerBtn.type = "button";
  centerBtn.className = "agon-tag-center-btn";
  centerBtn.innerHTML = `<span>À LA</span><span>UNE</span>`;
  centerBtn.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("agon:tag-trends-show-agon"));
  });
  container.appendChild(centerBtn);

  container.style.visibility = "hidden";

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      layoutTagTrendCloud(container);
      container.style.visibility = "";
      if (onReady) onReady();

      if (document.fonts?.ready) {
        document.fonts.ready.then(() => {
          if (!container.isConnected || !container.querySelector(".agon-tag-bubble")) return;
          layoutTagTrendCloud(container);
        }).catch(() => {});
      }
    });
  });

  // Relance le layout si la fenêtre est redimensionnée
  if (!container._cloudResizeObserver) {
    let _resizeTimer = null;
    container._cloudResizeObserver = new ResizeObserver(() => {
      clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(() => {
        if (!container.querySelectorAll('.agon-tag-bubble').length) return;
        layoutTagTrendCloud(container);
      }, 120);
    });
    container._cloudResizeObserver.observe(container);
  }
}

export { renderTagTrendCloud };
