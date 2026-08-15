(function initStandaloneHeaderScoreWidget() {
  "use strict";

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

  ensureUniversalHamburgerMenu();

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
