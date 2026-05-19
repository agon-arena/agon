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
  const trendH  = trendEl ? trendEl.offsetHeight + 1 : 0;

  // Padding-top dynamique : juste 1px de dégagement sous le badge
  label.style.paddingTop = trendH + "px";
  label.style.paddingBottom = trendH + "px";

  const availW = bubble.clientWidth * 0.82;
  const availH = bubble.clientHeight - trendH * 2 - 6;

  // Ajuster la taille de base pour que le label tienne dans la bulle
  let size = 52;
  label.style.fontSize = size + "px";

  let iter = 0;
  while (iter++ < 80 && size > 6 && (label.scrollWidth > availW || label.scrollHeight > availH)) {
    size -= 0.5;
    label.style.fontSize = size + "px";
  }
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

    bubble.append(trendSpan, label);
    container.appendChild(bubble);
  });

  const centerBtn = document.createElement("button");
  centerBtn.type = "button";
  centerBtn.className = "agon-tag-center-btn";
  centerBtn.innerHTML = `<span>TOUT</span><span>VOIR</span>`;
  centerBtn.addEventListener("click", () => {
    const firstBand = document.querySelector(".theme-row-section");
    if (firstBand) {
      firstBand.scrollIntoView({ behavior: "smooth", block: "start" });
    }
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
      const left = bubbleRect.right - containerRect.left - trendRect.width + 4;
      const top  = bubbleRect.top  - containerRect.top  - trendRect.height / 2 + 10;
      trend.style.position = "absolute";
      trend.style.left = left + "px";
      trend.style.top  = top  + "px";
      trend.style.right = "auto";
      container.appendChild(trend);
    });
  });
}

export { renderTagTrendCloud };
