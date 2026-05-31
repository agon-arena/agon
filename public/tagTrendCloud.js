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

const MAX_TAG_TREND_BUBBLES = 12;

function getBubbleVisualSize(index, trendItem = null) {
  const weight = Number(trendItem?.sizeWeight);
  if (!Number.isFinite(weight)) return "";

  const clamped = Math.max(0, Math.min(1, weight));
  const amplified = Math.pow(clamped, 1.75);
  const isMobile = window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
  const minSize = isMobile ? 64 : 80;
  const maxSize = index === 0
    ? (isMobile ? 170 : 220)
    : (isMobile ? 150 : 200);

  return Math.round(minSize + ((maxSize - minSize) * amplified)) + "px";
}

function getTrendMeta(trend) {
  const value = Number.isFinite(Number(trend)) ? Math.round(Number(trend)) : 0;
  if (value > 0) return { className: "agon-tag-trend-up",     label: `▲ +${value}%` };
  if (value < 0) return { className: "agon-tag-trend-down",   label: `▼ ${value}%` };
  return              { className: "agon-tag-trend-neutral", label: "— 0%" };
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

  // Le badge est dans le flux, juste au-dessus du texte, au centre de la bulle.
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
  const isNarrow = window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
  const frameTopRaw = getComputedStyle(container).getPropertyValue("--bubble-frame-top").trim();
  const frameTop = parseFloat(frameTopRaw) || 55;
  const frameBottomInset = 78;
  const centerY = (frameTop + (containerH - frameBottomInset)) / 2;

  const centerBtnEl = container.querySelector(".agon-tag-center-btn");
  if (centerBtnEl) centerBtnEl.style.top = Math.round(centerY) + "px";

  const margin = isMobile ? 3 : 10;
  const btnRadius = 24;
  const preferredAngles = [-8, 194, 88, 270, 142, 42, 232, 316, 118, 292, 166, 12];

  // Obstacles déjà placés (bouton central inclus)
  const placed = [{ x: centerX, y: centerY, r: btnRadius }];

  bubbles.forEach((bubble, index) => {
    const inlineSize = bubble.style.getPropertyValue("--agon-tag-bubble-size");
    let size;
    if (inlineSize) {
      size = parseFloat(inlineSize);
    } else if (bubble.classList.contains("agon-tag-bubble-large")) {
      size = bubble.classList.contains("agon-tag-pos-1") ? (isNarrow ? 168 : 216) : (isNarrow ? 146 : 194);
    } else if (bubble.classList.contains("agon-tag-bubble-medium")) {
      size = isNarrow ? 118 : 158;
    } else {
      size = isNarrow ? 82 : 106;
    }
    if (!size || !Number.isFinite(size)) size = 80;
    const r = size / 2;
    const prefAngle = (preferredAngles[index] ?? (index * 137.5)) * Math.PI / 180;
    const minX = r + margin, maxX = containerW - r - margin;
    const minY = r + margin, maxY = containerH - r - margin;

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
          if (Math.hypot(cx - p.x, cy - p.y) < r + p.r - 10) { valid = false; break; }
        }
        if (valid) { fx = cx; fy = cy; }
      }
    }

    if (fx === null) {
      fx = Math.min(maxX, Math.max(minX, centerX + Math.cos(prefAngle) * (btnRadius + r)));
      fy = Math.min(maxY, Math.max(minY, centerY + Math.sin(prefAngle) * (btnRadius + r)));
    }

    placed.push({ x: fx, y: fy, r });
    bubble.style.left = Math.round(fx - r) + "px";
    bubble.style.top  = Math.round(fy - r) + "px";
    bubble.style.right = "auto";
  });
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

  // Overlays de texte déjà rendus (z-index 40, au-dessus des badges z-index 10)
  const overlayRects = [...container.querySelectorAll(".agon-tag-label-overlay")].map(el => {
    const r = el.getBoundingClientRect();
    return { l: r.left - containerRect.left, t: r.top - containerRect.top, r: r.right - containerRect.left, b: r.bottom - containerRect.top };
  });

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

  allBubbles.forEach((bubble, idx) => {
    const trend = bubble.querySelector(".agon-tag-trend");
    if (!trend) return;

    const geo = bubbleGeo[idx];

    container.appendChild(trend);
    trend.style.position = "absolute";
    trend.style.left = "0px";
    trend.style.top  = "0px";
    trend.style.right = "auto";

    const tw = trend.offsetWidth  || 32;
    const th = trend.offsetHeight || 14;

    // Centre du badge à ~85 % du rayon depuis le centre de la bulle
    const d = Math.max(geo.r * 0.72, geo.r - th / 2 - 4);

    function scoreAngle(angleDeg) {
      const rad = angleDeg * Math.PI / 180;
      const cx = geo.cx + Math.cos(rad) * d;
      const cy = geo.cy + Math.sin(rad) * d;
      const l = cx - tw / 2, t = cy - th / 2;
      const r = l + tw,      b = t + th;

      if (l < 1 || t < 1 || r > cW - 1 || b > cH - 1) return -9999;

      let s = 0;

      // Préférer le sommet (-90°)
      s -= Math.abs(angleDeg + 90) * 2;

      // Pénalité : badge profond dans une autre bulle
      for (let i = 0; i < bubbleGeo.length; i++) {
        if (i === idx) continue;
        const ob = bubbleGeo[i];
        const bCx = (l + r) / 2, bCy = (t + b) / 2;
        const dist = Math.hypot(bCx - ob.cx, bCy - ob.cy);
        if (dist < ob.r - 10) s -= 300;
        else if (dist < ob.r)  s -= 60 * (ob.r - dist);
      }

      // Pénalité : chevauchement avec overlay de texte (z-index 40 > badge z-index 10)
      for (const or of overlayRects) {
        if (rectsOverlap(l, t, r, b, or.l, or.t, or.r, or.b)) {
          const ow = Math.min(r, or.r) - Math.max(l, or.l);
          const oh = Math.min(b, or.b) - Math.max(t, or.t);
          s -= ow * oh * 10;
        }
      }

      // Pénalité : chevauchement avec badge déjà placé
      for (const pb of placed) {
        if (rectsOverlap(l, t, r, b, pb.l, pb.t, pb.r, pb.b)) {
          const ow = Math.min(r, pb.r) - Math.max(l, pb.l);
          const oh = Math.min(b, pb.b) - Math.max(t, pb.t);
          s -= ow * oh * 15;
        }
      }

      // Blocage absolu : bouton central
      if (cbtnR && rectsOverlap(l, t, r, b, cbtnR.l, cbtnR.t, cbtnR.r, cbtnR.b)) {
        return -9999;
      }

      return s;
    }

    let bestAngle = ANGLES[0];
    let bestScore = -Infinity;
    for (const a of ANGLES) {
      const s = scoreAngle(a);
      if (s > bestScore) { bestScore = s; bestAngle = a; }
    }

    const rad = bestAngle * Math.PI / 180;
    const finalCx = geo.cx + Math.cos(rad) * d;
    const finalCy = geo.cy + Math.sin(rad) * d;
    const finalL = Math.round(finalCx - tw / 2);
    const finalT = Math.round(finalCy - th / 2);

    trend.style.left = finalL + "px";
    trend.style.top  = finalT + "px";

    placed.push({ l: finalL, t: finalT, r: finalL + tw, b: finalT + th });
  });
}

function renderTagTrendCloud(container, trends) {
  if (!container) return;

  if (!Array.isArray(trends) || !trends.length) {
    clearTagTrendCloud(container);
    return;
  }

  const parentSection = container.closest("section");
  if (parentSection) parentSection.hidden = false;

  container.innerHTML = "";

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
    const visualSize = getBubbleVisualSize(index, trendItem);
    if (visualSize) {
      bubble.style.setProperty("--agon-tag-bubble-size", visualSize);
    }
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

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      applyCompactBubbleLayout(container);
      container.querySelectorAll(".agon-tag-bubble").forEach(fitLabelInBubble);
      renderLabelOverlays(container);
      positionTrendBadges(container);
    });
  });

  // Relance le layout si la fenêtre est redimensionnée
  if (!container._cloudResizeObserver) {
    let _resizeTimer = null;
    container._cloudResizeObserver = new ResizeObserver(() => {
      clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(() => {
        if (!container.querySelectorAll('.agon-tag-bubble').length) return;
        applyCompactBubbleLayout(container);
        container.querySelectorAll('.agon-tag-bubble').forEach(fitLabelInBubble);
        renderLabelOverlays(container);
        positionTrendBadges(container);
      }, 120);
    });
    container._cloudResizeObserver.observe(container);
  }
}

export { renderTagTrendCloud };
