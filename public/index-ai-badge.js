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
        0%,100% { box-shadow: 0 0 8px 2px rgba(255,255,255,.2), 0 2px 6px rgba(0,0,0,.4); transform: scale(1); }
        50%     { box-shadow: 0 0 18px 6px rgba(255,255,255,.45), 0 4px 12px rgba(0,0,0,.3); transform: scale(1.05); }
      }
      .ai-card-badge {
        display: flex; justify-content: center;
        margin: 4px 0 6px;
        grid-column: 1 / -1;
      }
      .ai-card-badge-inner {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 3px 10px; border-radius: 999px;
        font-size: 10px; font-weight: 600; color: #fff;
        white-space: nowrap; cursor: default;
        background: #111; border: 2px solid #fff;
        animation: aiCardShine 2.4s ease-in-out infinite;
        animation-play-state: paused;
      }
      .ai-card-badge-inner.is-visible {
        animation-play-state: running;
      }
      .ai-card-badge-inner.ai-card-badge-countdown {
        background: #111; color: #fff;
        border: 2px solid #fff;
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
    function tick() {
      var secs = Math.max(0, Math.round((targetMs - Date.now()) / 1000));
      if (secs <= 0) {
        inner.className = 'ai-card-badge-inner';
        inner.textContent = '✦ Analyse et arbitrage IA';
      } else {
        inner.textContent = '⏳ ' + String(secs).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' s';
      }
    }
    tick();
    setInterval(tick, 1000);
  }

  function injectBadges() {
    if (!_statuses) return;
    document.querySelectorAll('.debate-card[data-debate-id]').forEach(function (card) {
      if (card.querySelector('.ai-card-badge')) return;
      var id = card.getAttribute('data-debate-id');
      var entry = _statuses[id];
      if (!entry) return;

      var wrap = document.createElement('div');
      wrap.className = 'ai-card-badge';
      var inner = document.createElement('span');

      if (entry.status === 'ready') {
        inner.className = 'ai-card-badge-inner';
        inner.textContent = '✦ Analyse et arbitrage IA';
      } else if (entry.scheduledAt) {
        inner.className = 'ai-card-badge-inner ai-card-badge-countdown';
        startCountdown(inner, new Date(entry.scheduledAt).getTime());
      } else {
        return; // pas de scheduledAt → rien à afficher
      }

      wrap.appendChild(inner);
      _observer.observe(inner);
      var footer = card.querySelector('.debate-card-footer-actions');
      if (footer) {
        card.insertBefore(wrap, footer);
      } else {
        card.appendChild(wrap);
      }
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
