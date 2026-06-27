(function () {
  function initPoliticalGauge(debate, optionA, optionB) {
    const container = document.getElementById("political-gauge-container");
    if (!container) return;
    container.innerHTML = "";

    const po = debate && debate.political_orientation;
    if (!po || !po.isPolitical) return;

    const posAOrientation = String(po.positionA || "").toLowerCase();
    const leftCount = posAOrientation === "left"
      ? (optionA || []).length
      : (optionB || []).length;
    const rightCount = posAOrientation === "left"
      ? (optionB || []).length
      : (optionA || []).length;
    const total = leftCount + rightCount;
    const leftPct = total === 0 ? 50 : Math.round((leftCount / total) * 100);
    const rightPct = total === 0 ? 50 : 100 - leftPct;
    const diff = (rightPct - leftPct) / 100;
    const sign = diff >= 0 ? 1 : -1;
    const needleAngle = Math.round(sign * Math.pow(Math.abs(diff), 0.65) * 85);

    const wrap = document.createElement("div");
    wrap.className = "political-gauge-wrap";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "political-gauge-btn";
    btn.innerHTML = '<span class="political-gauge-btn-icon" aria-hidden="true">⌁</span><span>Voir l’équilibre gauche / droite</span>';

    const panel = document.createElement("div");
    panel.className = "political-gauge-panel";
    panel.hidden = true;
    panel.innerHTML = `
      <p class="political-gauge-title">Orientation des idées publiées</p>
      <p class="political-gauge-subtitle">Ce Baromètre d’orientation politique indique la répartition des idées selon l’axe politique de l’arène.</p>
      <div class="political-gauge-meter" aria-label="Baromètre d’orientation politique gauche droite">
        <div class="political-gauge-arc">
          <span class="political-gauge-arc-left"></span>
          <span class="political-gauge-arc-right"></span>
          <span class="political-gauge-arc-center"></span>
          <span class="political-gauge-tick political-gauge-tick-1"></span>
          <span class="political-gauge-tick political-gauge-tick-2"></span>
          <span class="political-gauge-tick political-gauge-tick-3"></span>
          <span class="political-gauge-tick political-gauge-tick-4"></span>
        </div>
        <div class="political-gauge-needle" style="--gauge-angle:${needleAngle}deg"></div>
        <div class="political-gauge-pivot"></div>
      </div>
      <div class="political-gauge-labels">
        <span class="political-gauge-label-left">Idées<br>plutôt de gauche ${leftPct} %</span>
        <span class="political-gauge-label-right">Idées<br>plutôt de droite ${rightPct} %</span>
      </div>
    `;

    btn.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
      btn.classList.toggle("political-gauge-btn-open", !panel.hidden);
      btn.innerHTML = panel.hidden
        ? '<span class="political-gauge-btn-icon" aria-hidden="true">⌁</span><span>Voir l’équilibre gauche / droite</span>'
        : '<span class="political-gauge-btn-icon" aria-hidden="true">⌁</span><span>Masquer l’équilibre gauche / droite</span>';
    });

    wrap.appendChild(btn);
    wrap.appendChild(panel);
    container.appendChild(wrap);
  }

  window.initPoliticalGauge = initPoliticalGauge;
})();
