function getBubbleSizeClass(index) {
  if (index <= 2) return "agon-tag-bubble-large";
  if (index <= 5) return "agon-tag-bubble-medium";
  return "agon-tag-bubble-small";
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

  // Le badge est dans le flux, juste au-dessus du texte, au centre de la bulle.
  label.style.paddingTop = "0px";
  label.style.paddingBottom = "0px";
  label.style.maxWidth = Math.round(bubbleW * 1.04) + "px";

  const availW = bubbleW * 1.04;
  const availH = Math.max(16, bubbleH - trendH - 10);

  let low = Math.max(10, bubbleW * 0.13);
  let high = Math.min(82, Math.max(22, bubbleW * 0.48));

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
    overlay.style.maxWidth = label.style.maxWidth || getComputedStyle(label).maxWidth;
    container.appendChild(overlay);
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

  trends.slice(0, 12).forEach((trendItem, index) => {
    const tag = String(trendItem?.tag || "").trim();
    if (!tag) return;

    const trendMeta = getTrendMeta(trendItem?.trend);
    const bubble = document.createElement("button");
    bubble.className = [
      "agon-tag-bubble",
      getBubbleSizeClass(index),
      `agon-tag-pos-${index}`
    ].join(" ");
    bubble.type = "button";

    const trendSpan = document.createElement("span");
    trendSpan.className = `agon-tag-trend ${trendMeta.className}`;
    trendSpan.textContent = trendMeta.label;

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

    bubble.append(flashWrap, trendSpan, label);
    container.appendChild(bubble);
  });

  const centerBtn = document.createElement("button");
  centerBtn.type = "button";
  centerBtn.className = "agon-tag-center-btn";
  centerBtn.innerHTML = `<span>TOUT</span><span>VOIR</span>`;
  centerBtn.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("agon:tag-trends-show-agon"));
  });
  container.appendChild(centerBtn);

  requestAnimationFrame(() => {
    container.querySelectorAll(".agon-tag-bubble").forEach(fitLabelInBubble);

    const containerRect = container.getBoundingClientRect();
    container.querySelectorAll(".agon-tag-bubble").forEach(bubble => {
      const trend = bubble.querySelector(".agon-tag-trend");
      if (!trend) return;
      const bubbleRect = bubble.getBoundingClientRect();
      const trendRect = trend.getBoundingClientRect();
      const isCentered = bubble.classList.contains("agon-tag-pos-6") || bubble.classList.contains("agon-tag-pos-9");
      const left = isCentered
        ? bubbleRect.left - containerRect.left + (bubbleRect.width - trendRect.width) / 2
        : bubbleRect.right - containerRect.left - trendRect.width + 4;
      const top  = bubbleRect.top  - containerRect.top  - trendRect.height / 2 + 10;
      trend.style.position = "absolute";
      trend.style.left = left + "px";
      trend.style.top  = top  + "px";
      trend.style.right = "auto";
      container.appendChild(trend);
    });

    renderLabelOverlays(container);
  });
}

export { renderTagTrendCloud };
