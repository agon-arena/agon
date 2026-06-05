(function () {
  'use strict';

  var _statuses = null;
  var _stylesInjected = false;
  var _observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      e.target.classList.toggle('is-visible', e.isIntersecting);
    });
  }, { threshold: 0.1 });

  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    var el = document.createElement('style');
    el.textContent = `
      @keyframes aiCardShine {
        0%   { filter: drop-shadow(0 0 3px rgba(0,0,0,.2));  transform: translateX(-50%) scale(1);    background-position: 100% 0; }
        50%  { filter: drop-shadow(0 0 12px rgba(0,0,0,.5)); transform: translateX(-50%) scale(1.05); background-position:   0% 0; }
        100% { filter: drop-shadow(0 0 3px rgba(0,0,0,.2));  transform: translateX(-50%) scale(1);    background-position: 100% 0; }
      }
      .ai-card-badge-inner {
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        z-index: 50;
        display: inline-flex; align-items: center; gap: 4px;
        padding: 2px 6px; border-radius: 999px;
        font-size: 9px; font-weight: 600; color: #111;
        white-space: nowrap; cursor: default;
        background: linear-gradient(120deg, #fff 25%, #c8c8c8 50%, #fff 75%);
        background-size: 300% 100%;
        border: 2px solid #111;
        animation: aiCardShine 2.4s ease-in-out infinite;
        animation-play-state: paused;
      }
      .ai-card-badge-inner.is-visible {
        animation-play-state: running;
      }
      .ai-card-badge-inner.ai-card-badge-countdown {
        background: linear-gradient(120deg, #fff 25%, #c8c8c8 50%, #fff 75%);
        background-size: 300% 100%;
        color: #111;
        border: 2px solid #111;
      }
    `;
    document.head.appendChild(el);
  }

  async function fetchStatuses() {
    try {
      var r = await fetch('/api/debates/analysis-statuses');
      _statuses = r.ok ? await r.json() : {};
    } catch (_) {
      _statuses = {};
    }
  }

  function startCountdown(inner, targetMs) {
    var timer = null;
    var done = false;

    function cleanup() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      document.removeEventListener('visibilitychange', tick);
    }

    function render() {
      var secs = Math.max(0, Math.round((targetMs - Date.now()) / 1000));
      if (secs <= 0) {
        done = true;
        cleanup();
        inner.className = 'ai-card-badge-inner';
        inner.innerHTML = '<img src="/sablier2-64.png" alt="" style="width:15px;height:15px;vertical-align:middle;margin-right:4px;">Analyse et arbitrage IA';
        return;
      }
      inner.textContent = 'IA : ' + String(secs).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }

    function tick() {
      if (!inner.isConnected) {
        cleanup();
        return;
      }
      if (document.hidden || !inner.classList.contains('is-visible')) return;
      render();
    }

    render();
    if (done) return;
    timer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick, { passive: true });
  }

  function injectBadges() {
    if (!_statuses) return;
    document.querySelectorAll('.debate-card[data-debate-id]').forEach(function (card) {
      if (card.querySelector('.ai-card-badge-inner')) return;
      var id = card.getAttribute('data-debate-id');
      var entry = _statuses[id];
      if (!entry) return;

      var inner = document.createElement('span');

      if (entry.status === 'ready') {
        inner.className = 'ai-card-badge-inner';
        inner.innerHTML = '<img src="/sablier2-64.png" alt="" style="width:15px;height:15px;vertical-align:middle;margin-right:4px;">Analyse et arbitrage IA';
      } else if (entry.scheduledAt) {
        inner.className = 'ai-card-badge-inner ai-card-badge-countdown';
        startCountdown(inner, new Date(entry.scheduledAt).getTime());
      } else {
        return; // pas de scheduledAt → rien à afficher
      }

      _observer.observe(inner);

      var topBadges = card.querySelector('.debate-card-top-badges');
      if (!topBadges) {
        topBadges = document.createElement('div');
        topBadges.className = 'debate-card-top-badges';
        card.insertBefore(topBadges, card.firstChild);
      }
      topBadges.appendChild(inner);
    });
  }

  function init() {
    injectStyles();
    fetchStatuses().then(injectBadges);

    var target = document.getElementById('debates-list') || document.body;
    var observer = new MutationObserver(injectBadges);
    observer.observe(target, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
