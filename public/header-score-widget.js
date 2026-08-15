(function initStandaloneHeaderScoreWidget() {
  "use strict";

  // Toutes les pages du bandeau doivent utiliser exactement le même ancrage
  // autour du logo. Quelques anciens templates plaçaient encore l'image
  // directement dans .home-brand-block, ce qui décalait le compteur.
  function ensureUniformBrandAnchor() {
    var topbar = document.querySelector(".topbar.topbar--mnoria-uniform");
    var logo = topbar && topbar.querySelector(".home-logo");
    if (!topbar || !logo) return null;
    var brandMain = logo.closest(".home-brand-main");
    if (!brandMain) {
      brandMain = document.createElement("div");
      brandMain.className = "home-brand-main";
      logo.parentNode.insertBefore(brandMain, logo);
      brandMain.appendChild(logo);
    }
    return brandMain;
  }

  // Compteur de santé numérique commun à TOUS les bandeaux. Il est créé ici,
  // avant le script principal, afin que les pages légères (notamment Histoire)
  // et les pages complètes utilisent le même DOM, la même police et les mêmes
  // coordonnées. Le script principal conserve seulement son ancien fallback.
  function renderUniversalTimeWidget(brandMain) {
    if (!brandMain || document.querySelector(".agon-time-widget")) return;

    var style = document.createElement("style");
    style.id = "agon-universal-time-widget-styles";
    style.textContent =
      ".topbar--mnoria-uniform .home-brand-main.agon-time-widget-anchor{position:relative!important;overflow:visible!important}" +
      ".agon-time-widget-logo-overlay{position:absolute;top:4px;left:50%;z-index:18;transform:translateX(-50%);max-width:min(220px,calc(100vw - 40px))}" +
      ".agon-time-widget{display:inline-flex;align-items:center;gap:6px;margin:0;padding:4px 12px;border:0;border-radius:999px;background:transparent;color:#111827;font:700 11px/1 Arial,Helvetica,sans-serif!important;letter-spacing:normal;white-space:nowrap;cursor:pointer;box-sizing:border-box}" +
      ".agon-time-widget i{color:#9cc3f0;font-size:10px}" +
      ".agon-time-widget-warning{color:#d64545}" +
      ".agon-time-widget-warning i{color:#d64545}" +
      ".agon-time-widget-blinking{animation:agonUniversalTimeBlink .4s ease-in-out 3}" +
      "@keyframes agonUniversalTimeBlink{0%,100%{opacity:1}50%{opacity:.15}}" +
      "@media(max-width:768px){.agon-time-widget-logo-overlay{top:-3px}}" +
      ".agon-time-explanation-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;background:rgba(0,0,0,.55);font-family:Arial,Helvetica,sans-serif;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}" +
      ".agon-time-explanation{width:min(100%,430px);padding:30px 24px 22px;box-sizing:border-box;border:1px solid #dbeafe;border-radius:24px;background:linear-gradient(180deg,#fff 0%,#f8fafc 100%);box-shadow:0 24px 60px rgba(15,23,42,.22),0 8px 24px rgba(59,130,246,.1);color:#111827;text-align:center}" +
      ".agon-time-explanation h3{margin:0 0 20px;font-size:28px;line-height:1.2;font-weight:800}" +
      ".agon-time-explanation p{margin:0 0 18px;color:#4b5563;font-size:14px;line-height:1.55}" +
      ".agon-time-explanation button{display:flex;align-items:center;justify-content:center;width:100%;padding:12px 18px;border:0;border-radius:999px;background:#111827;color:#fff;font:700 15px/1 Arial,Helvetica,sans-serif;cursor:pointer}";
    document.head.appendChild(style);

    var widget = document.createElement("button");
    widget.type = "button";
    widget.className = "agon-time-widget agon-time-widget-logo-overlay";
    widget.setAttribute("aria-label", "Temps passé sur agôn aujourd'hui");
    widget.innerHTML = '<i class="fa-regular fa-clock" aria-hidden="true"></i><span></span>';
    brandMain.classList.add("agon-time-widget-anchor");
    brandMain.appendChild(widget);

    var elapsedKey = "agon_time_widget_daily_v2";
    var limitSeconds = 60 * 60;
    var warningSeconds = 10 * 60;
    function getParisDayKey() {
      try {
        var parts = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
        var values = {};
        parts.forEach(function (part) { values[part.type] = part.value; });
        return values.year + "-" + values.month + "-" + values.day;
      } catch (e) {
        var now = new Date();
        return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
      }
    }
    var activeDayKey = getParisDayKey();
    function readStoredElapsed() {
      try {
        var stored = JSON.parse(localStorage.getItem(elapsedKey) || "null");
        var elapsedMs = Number(stored && stored.elapsedMs);
        return stored && stored.dayKey === activeDayKey && Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
      } catch (e) { return 0; }
    }
    var baseElapsedMs = readStoredElapsed();
    var resumedAt = Date.now();
    var running = !document.hidden;
    function currentElapsedMs() { return baseElapsedMs + (running ? Date.now() - resumedAt : 0); }
    function persistElapsed() {
      var elapsedMs = Math.max(currentElapsedMs(), readStoredElapsed());
      try { localStorage.setItem(elapsedKey, JSON.stringify({ dayKey: activeDayKey, elapsedMs: elapsedMs })); } catch (e) {}
      return elapsedMs;
    }
    function resetIfNewDay() {
      var todayKey = getParisDayKey();
      if (todayKey === activeDayKey) return;
      activeDayKey = todayKey;
      baseElapsedMs = 0;
      resumedAt = Date.now();
      try { localStorage.setItem(elapsedKey, JSON.stringify({ dayKey: activeDayKey, elapsedMs: 0 })); } catch (e) {}
    }
    function pause() {
      if (!running) return;
      baseElapsedMs += Date.now() - resumedAt;
      running = false;
      baseElapsedMs = persistElapsed();
    }
    function resume() {
      if (running) return;
      resetIfNewDay();
      baseElapsedMs = Math.max(baseElapsedMs, readStoredElapsed());
      resumedAt = Date.now();
      running = true;
    }
    document.addEventListener("visibilitychange", function () { document.hidden ? pause() : resume(); });
    window.addEventListener("blur", pause);
    window.addEventListener("focus", resume);
    window.addEventListener("pagehide", pause);

    var expired = false;
    var visible = true;
    var blinkActive = false;
    function maybeBlink() {
      var shouldBlink = expired && visible;
      if (shouldBlink && !blinkActive) {
        widget.classList.remove("agon-time-widget-blinking");
        void widget.offsetWidth;
        widget.classList.add("agon-time-widget-blinking");
      }
      blinkActive = shouldBlink;
    }
    function tick() {
      resetIfNewDay();
      var remaining = Math.max(0, limitSeconds - Math.floor(currentElapsedMs() / 1000));
      expired = remaining <= 0;
      widget.querySelector("span").textContent = expired
        ? "Attention à ta santé numérique !"
        : String(Math.floor(remaining / 60)).padStart(2, "0") + ":" + String(remaining % 60).padStart(2, "0");
      widget.classList.toggle("agon-time-widget-warning", remaining <= warningSeconds);
      widget.classList.toggle("agon-time-widget-expired", expired);
      maybeBlink();
      if (running) persistElapsed();
    }
    tick();
    window.setInterval(tick, 1000);

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = !!(entries[0] && entries[0].isIntersecting);
        maybeBlink();
      }).observe(widget);
    }

    widget.addEventListener("click", function () {
      var existing = document.querySelector(".agon-time-explanation-overlay");
      if (existing) existing.remove();
      var overlay = document.createElement("div");
      overlay.className = "agon-time-explanation-overlay";
      overlay.innerHTML = '<div class="agon-time-explanation"><h3><i class="fa-regular fa-clock"></i> Temps passé</h3><p>Pour rester en bonne santé numérique, il est conseillé de ne pas rester plus de 60 minutes par jour sur les réseaux et plateformes comme agôn. Ce compteur ne bloque rien, c\'est juste un repère.</p><button type="button">Compris</button></div>';
      function close() { overlay.remove(); }
      overlay.addEventListener("click", function (event) { if (event.target === overlay) close(); });
      overlay.querySelector("button").addEventListener("click", close);
      document.body.appendChild(overlay);
    });
  }

  function ensureUniversalMenuStyles() {
    if (document.getElementById("mnoria-universal-menu-styles")) return;
    var style = document.createElement("style");
    style.id = "mnoria-universal-menu-styles";
    style.textContent =
      ".mnoria-universal-menu-wrap{position:absolute;left:12px;top:50%;transform:translateY(-50%);z-index:10005}" +
      ".mnoria-universal-menu-toggle{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;margin:0;padding:0;border:1px solid #d1d5db;border-radius:12px;background:#e9ebec;color:#374151;font-size:18px;cursor:pointer}" +
      ".mnoria-universal-menu-toggle:hover,.mnoria-universal-menu-toggle:focus-visible{background:#fff;outline:none}" +
      ".mnoria-universal-menu-panel{position:fixed;z-index:300010;display:none;gap:0;width:min(230px,calc(100vw - 20px));max-height:calc(100dvh - 24px);overflow-y:auto;padding:5px;border:1px solid rgba(17,24,39,.14);border-radius:14px;background:#fff;box-shadow:0 18px 38px rgba(15,23,42,.22);box-sizing:border-box}" +
      ".mnoria-universal-menu-panel.is-open{display:grid}" +
      ".mnoria-universal-menu-item{display:flex;align-items:center;gap:7px;width:100%;padding:6px 9px;border:0;border-radius:9px;background:#fff;color:#1f2937;font:inherit;font-size:13px;font-weight:700;line-height:1.15;text-align:left;text-decoration:none;cursor:pointer;box-sizing:border-box}" +
      ".mnoria-universal-menu-item:hover,.mnoria-universal-menu-item:focus-visible{background:#f3f4f6;outline:none}" +
      ".mnoria-universal-menu-item i{width:16px;flex:0 0 16px;text-align:center;font-size:14px}" +
      "@media(display-mode:standalone) and (max-width:768px){.mnoria-universal-menu-wrap{top:calc(49px + env(safe-area-inset-top,0px))}}" +
      "body.mnoria-universal-menu-open .topbar{z-index:300000!important;overflow:visible!important}";
    document.head.appendChild(style);
  }

  function ensureUniversalHamburgerMenu() {
    var topbar = document.querySelector(".topbar.topbar--mnoria-uniform");
    var topbarInner = topbar && topbar.querySelector(".topbar-inner");
    if (!topbar || !topbarInner || topbar.querySelector(".home-topbar-menu-toggle") || topbar.querySelector(".mnoria-universal-menu-toggle")) return;

    ensureUniversalMenuStyles();
    var wrap = document.createElement("div");
    wrap.className = "mnoria-universal-menu-wrap";
    wrap.innerHTML =
      '<button type="button" class="mnoria-universal-menu-toggle" aria-label="Ouvrir le menu" aria-expanded="false"><i class="fa-solid fa-bars" aria-hidden="true"></i></button>' +
      '<nav class="mnoria-universal-menu-panel" aria-label="Menu du bandeau">' +
        '<a class="mnoria-universal-menu-item" href="/"><i class="fa-regular fa-compass"></i><span>Explorer les arènes</span></a>' +
        '<a class="mnoria-universal-menu-item" href="/create"><i class="fa-solid fa-plus"></i><span>Ouvrir une arène</span></a>' +
        '<a class="mnoria-universal-menu-item" href="/notifications"><i class="fa-regular fa-bell"></i><span>Notifications</span></a>' +
        '<button type="button" class="mnoria-universal-menu-item" data-mnoria-alerts><i class="fa-regular fa-bell"></i><span>Activer les alertes</span></button>' +
        '<a class="mnoria-universal-menu-item" href="/apprentissage"><i class="fa-solid fa-list-check"></i><span>Apprentissages</span></a>' +
        '<a class="mnoria-universal-menu-item" href="/contributions"><i class="fa-solid fa-chart-line"></i><span>Scores et contributions</span></a>' +
        '<a class="mnoria-universal-menu-item" href="/meilleures-idees"><i class="fa-solid fa-trophy"></i><span>Meilleures idées</span></a>' +
        '<a class="mnoria-universal-menu-item" href="/historical-events-test"><i class="fa-solid fa-clock-rotate-left"></i><span>Ce jour dans l’Histoire</span></a>' +
        '<a class="mnoria-universal-menu-item" href="/eclairages"><i class="fa-solid fa-landmark"></i><span>Éclairages</span></a>' +
        '<a class="mnoria-universal-menu-item" href="/about"><i class="fa-regular fa-circle-question"></i><span>À propos</span></a>' +
        '<a class="mnoria-universal-menu-item" href="/contact"><i class="fa-regular fa-envelope"></i><span>Contact</span></a>' +
      '</nav>';
    // Directement sous .topbar : certaines pages masquent volontairement tous
    // les enfants de .topbar-inner sauf le logo (Ouvrir, Apprentissages…).
    topbar.appendChild(wrap);

    var toggle = wrap.querySelector(".mnoria-universal-menu-toggle");
    var panel = wrap.querySelector(".mnoria-universal-menu-panel");
    var close = function () {
      panel.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      document.body.classList.remove("mnoria-universal-menu-open");
    };
    var open = function () {
      var rect = toggle.getBoundingClientRect();
      panel.style.top = Math.min(rect.bottom + 8, window.innerHeight - 20) + "px";
      panel.style.left = "8px";
      panel.style.right = "auto";
      panel.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      document.body.classList.add("mnoria-universal-menu-open");
    };
    toggle.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      panel.classList.contains("is-open") ? close() : open();
    });
    panel.addEventListener("click", function (event) { event.stopPropagation(); });
    panel.querySelectorAll("a").forEach(function (link) {
      if (window.self !== window.top) link.target = "_top";
      link.addEventListener("click", close);
    });
    var alertsButton = panel.querySelector("[data-mnoria-alerts]");
    alertsButton.addEventListener("click", function () {
      close();
      if (typeof window.handlePushMenuClick === "function") window.handlePushMenuClick();
      else if (window.self !== window.top) window.top.location.href = "/notifications";
      else window.location.href = "/notifications";
    });
    document.addEventListener("click", close);
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") close(); });
    window.addEventListener("resize", function () { if (panel.classList.contains("is-open")) open(); }, { passive: true });
  }

  function readLocal(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function writeLocal(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (e) {}
  }

  function getUserKey() {
    var key = readLocal("key");
    if (!key) {
      key = Math.random().toString(36);
      writeLocal("key", key);
    }
    return key;
  }

  function numberOrNull(value) {
    if (value === null || value === undefined) return null;
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatPercent(value) {
    if (value === null) return "";
    return Number(value).toLocaleString("fr-FR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1
    });
  }

  function render(scores) {
    if (document.querySelector(".agon-user-score-widget")) return;
    var brandMain = document.querySelector(".topbar--mnoria-uniform .home-brand-main");
    if (!brandMain) return;

    var rhetor = numberOrNull(scores && scores.votesScore);
    var logos = numberOrNull(scores && scores.notesScore);
    var gnosis = numberOrNull(scores && scores.gnosisScore);
    if (rhetor === null && logos === null && gnosis === null) return;

    var widget = document.createElement("a");
    widget.className = "agon-user-score-widget agon-user-score-widget-triple agon-user-score-widget-logo-overlay";
    widget.href = "/contributions";
    if (window.self !== window.top) widget.target = "_top";
    widget.setAttribute("aria-label", "Mes scores");
    widget.innerHTML = [
      '<i class="fa-solid fa-bolt"></i>Top ' + formatPercent(rhetor) + '% (Rhetor)',
      '<i class="agon-logos-icon" aria-hidden="true"><svg viewBox="2 0 21 21" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 11a1 1 0 0 1 1 1a2 2 0 0 1-2 2a3 3 0 0 1-3-3a4 4 0 0 1 4-4a5 5 0 0 1 5 5a6 6 0 0 1-6 6a7 7 0 0 1-7-7a8 8 0 0 1 8-8a9 9 0 0 1 9 9"/></svg></i>' + formatPercent(logos) + '% (Logos)',
      '<i class="fa-solid fa-brain"></i>' + formatPercent(gnosis) + '% (Gnosis)'
    ].join(' <span class="agon-user-score-separator">-</span> ');

    brandMain.classList.add("agon-user-score-anchor");
    brandMain.appendChild(widget);
  }

  var uniformBrandMain = ensureUniformBrandAnchor();
  ensureUniversalHamburgerMenu();
  renderUniversalTimeWidget(uniformBrandMain);

  // Les pages qui chargent script.min.js utilisent le widget complet (détail
  // des scores + compteur de temps). Ce petit fichier ne prend le relais que
  // sur la page historique isolée afin d'éviter un second appel API.
  if (document.querySelector('script[src*="/script.min.js"]')) return;

  var key = getUserKey();
  fetch("/api/my-score?key=" + encodeURIComponent(key), { cache: "no-store" })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (scores) { if (scores) render(scores); })
    .catch(function () {});
})();
