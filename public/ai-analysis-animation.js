(function () {
  'use strict';

  var MIN_MS    = 5000;
  var FADE_MS   = 450;
  var _showAt   = 0;
  var _injected = false;
  var _showToken = 0;
  var _showPromise = null;
  var _sablierImg = null;
  var _sablierPromise = null;
  var _bgImg = null;
  var _bgPromise = null;
  var _viewportBound = false;

  function getViewportHeight() {
    var vvHeight = window.visualViewport && window.visualViewport.height;
    return Math.ceil(Math.max(
      vvHeight || 0,
      window.innerHeight || 0,
      document.documentElement.clientHeight || 0
    ));
  }

  function syncOverlayViewportSize() {
    var overlay = document.getElementById('aala-overlay');
    if (!overlay) return;
    var height = getViewportHeight();
    if (height) overlay.style.setProperty('--aala-vvh', height + 'px');
  }

  function bindViewportSync() {
    if (_viewportBound) return;
    _viewportBound = true;
    window.addEventListener('resize', syncOverlayViewportSize, { passive: true });
    window.addEventListener('orientationchange', syncOverlayViewportSize, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncOverlayViewportSize, { passive: true });
      window.visualViewport.addEventListener('scroll', syncOverlayViewportSize, { passive: true });
    }
  }

  function preloadSablier() {
    if (_sablierPromise) return _sablierPromise;
    _sablierImg = new Image();
    _sablierImg.decoding = 'sync';
    _sablierImg.src = '/sablier3-256.png';
    _sablierPromise = new Promise(function (resolve) {
      function done() {
        if (_sablierImg && typeof _sablierImg.decode === 'function') {
          _sablierImg.decode().then(resolve).catch(resolve);
        } else {
          resolve();
        }
      }
      if (_sablierImg.complete && _sablierImg.naturalWidth) done();
      else {
        _sablierImg.onload = done;
        _sablierImg.onerror = resolve;
      }
    });
    return _sablierPromise;
  }

  function preloadBackground() {
    if (_bgPromise) return _bgPromise;
    _bgImg = new Image();
    _bgImg.decoding = 'sync';
    _bgImg.src = '/visuels/fondanimation.webp';
    _bgPromise = new Promise(function (resolve) {
      function done() {
        if (_bgImg && typeof _bgImg.decode === 'function') {
          _bgImg.decode().then(resolve).catch(resolve);
        } else {
          resolve();
        }
      }
      if (_bgImg.complete && _bgImg.naturalWidth) done();
      else {
        _bgImg.onload = done;
        _bgImg.onerror = resolve;
      }
    });
    return _bgPromise;
  }

  function injectStyles() {
    if (_injected) return;
    _injected = true;
    var el = document.createElement('style');
    el.textContent = `
      #aala-overlay {
        --aala-bottom-bleed: 0px;
        position: fixed; top: 0; right: 0; bottom: 0 !important; left: 0; z-index: 100000;
        width: 100vw;
        height: var(--aala-vvh, 100vh);
        min-height: var(--aala-vvh, 100vh);
        --aala-center-y: calc(var(--aala-vvh, 100vh) / 2);
        overflow: hidden;
        display: flex; align-items: center; justify-content: center;
        background: #06161e url("/visuels/fondanimation.webp") center center / cover no-repeat;
        opacity: 1;
        transition: opacity ${FADE_MS}ms ease;
        overscroll-behavior: none;
        touch-action: none;
        transform: translateZ(0);
        will-change: opacity;
        isolation: isolate;
      }
      @supports (height: 100dvh) {
        #aala-overlay {
          height: var(--aala-vvh, 100dvh);
          min-height: var(--aala-vvh, 100dvh);
        }
      }
      #aala-overlay::before {
        content: "";
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        min-height: 100%;
        z-index: 0;
        pointer-events: none;
        background: url("/visuels/fondanimation.webp") center center / cover no-repeat;
        transform: translateZ(0);
      }
      #aala-overlay.is-hiding { opacity: 0; pointer-events: none; }

      html.aala-overlay-active,
      html.aala-overlay-active body {
        background: #06161e url("/visuels/fondanimation.webp") center center / cover no-repeat !important;
        overflow: hidden !important;
      }

      /* Sablier centré, toujours au-dessus */
      .aala-sablier {
        position: absolute; top: var(--aala-center-y, 50vh); left: 50%;
        width: 140px; height: 140px;
        z-index: 4;
        animation: aala-spin-pulse 5s linear infinite;
        pointer-events: none;
        filter:
          drop-shadow(0 0 6px rgba(255,255,255,0.95))
          drop-shadow(0 0 16px rgba(255,255,255,0.75))
          drop-shadow(0 0 32px rgba(200,220,255,0.55))
          drop-shadow(0 0 55px rgba(180,210,255,0.35))
          drop-shadow(0 0 80px rgba(160,195,255,0.18));
      }
      @media (max-width: 768px) {
        .aala-sablier {
          filter:
            drop-shadow(0 0 5px rgba(255,255,255,0.9))
            drop-shadow(0 0 14px rgba(255,255,255,0.65))
            drop-shadow(0 0 26px rgba(200,220,255,0.4));
        }
      }

      /* Cerveaux positionnés au centre de l'overlay */
      .aala-brain {
        position: absolute; top: var(--aala-center-y, 50vh); left: 50%;
        z-index: 2;
        pointer-events: none; user-select: none;
        line-height: 1; text-align: center;
        background: transparent;
        mix-blend-mode: normal;
        opacity: 0.94;
        filter:
          drop-shadow(0 0 4px rgba(255,255,255,0.85))
          drop-shadow(0 0 11px rgba(255,180,220,0.48))
          drop-shadow(0 0 18px rgba(150,205,255,0.30))
          saturate(1.18)
          contrast(1.06);
        text-shadow: 0 0 10px rgba(255,255,255,0.5);
      }

      /* ── Anneau extérieur : part du coin de l'écran ── */
      .aala-far {
        margin-top: -34px; margin-left: -34px;
        width: 68px; height: 68px; font-size: 58px;
        animation: aala-spiral-far 9s linear infinite;
      }
      .aala-far-1 { animation-delay:  0s; }
      .aala-far-2 { animation-delay: -3s; }
      .aala-far-3 { animation-delay: -6s; }

      /* ── Anneau intermédiaire ── */
      .aala-mid {
        margin-top: -26px; margin-left: -26px;
        width: 52px; height: 52px; font-size: 44px;
        animation: aala-spiral-mid 7s linear infinite;
      }
      .aala-mid-1 { animation-delay: -0.5s; }
      .aala-mid-2 { animation-delay: -2.83s; }
      .aala-mid-3 { animation-delay: -5.17s; }

      /* ── Anneau intérieur ── */
      .aala-near {
        margin-top: -19px; margin-left: -19px;
        width: 38px; height: 38px; font-size: 32px;
        animation: aala-spiral-near 5s linear infinite;
      }
      .aala-near-1 { animation-delay: -0.25s; }
      .aala-near-2 { animation-delay: -1.92s; }
      .aala-near-3 { animation-delay: -3.58s; }

      /* Label en bas */
      .aala-label {
        position: absolute; bottom: 14%; left: 0; right: 0;
        text-align: center;
        font-size: 13px; font-style: italic;
        color: rgba(255,255,255,0.45); letter-spacing: .04em;
        pointer-events: none;
      }

      @keyframes aala-spin-pulse {
        0%    { transform: translate(-50%, -50%) rotate(0deg)   scale(1);    }
        12.5% { transform: translate(-50%, -50%) rotate(45deg)  scale(1.08); }
        25%   { transform: translate(-50%, -50%) rotate(90deg)  scale(1);    }
        37.5% { transform: translate(-50%, -50%) rotate(135deg) scale(1.08); }
        50%   { transform: translate(-50%, -50%) rotate(180deg) scale(1);    }
        62.5% { transform: translate(-50%, -50%) rotate(225deg) scale(1.08); }
        75%   { transform: translate(-50%, -50%) rotate(270deg) scale(1);    }
        87.5% { transform: translate(-50%, -50%) rotate(315deg) scale(1.08); }
        100%  { transform: translate(-50%, -50%) rotate(360deg) scale(1);    }
      }

      /* Spirale depuis les coins (rayon 650px → 0) */
      @keyframes aala-spiral-far {
        0%   { transform: rotate(0deg)   translateX(650px) scale(1.6);  opacity: 0;    }
        4%   { opacity: 0.96; }
        28%  { transform: rotate(130deg) translateX(420px) scale(1.2);  opacity: 0.92; }
        55%  { transform: rotate(270deg) translateX(180px) scale(0.7);  opacity: 0.78; }
        80%  { transform: rotate(390deg) translateX(45px)  scale(0.28); opacity: 0.36; }
        100% { transform: rotate(460deg) translateX(0px)   scale(0);    opacity: 0;    }
      }

      @keyframes aala-spiral-mid {
        0%   { transform: rotate(0deg)   translateX(450px) scale(1.3);  opacity: 0;    }
        5%   { opacity: 0.92; }
        28%  { transform: rotate(130deg) translateX(290px) scale(1.0);  opacity: 0.86; }
        55%  { transform: rotate(270deg) translateX(120px) scale(0.6);  opacity: 0.68; }
        80%  { transform: rotate(390deg) translateX(28px)  scale(0.22); opacity: 0.30; }
        100% { transform: rotate(460deg) translateX(0px)   scale(0);    opacity: 0;    }
      }

      @keyframes aala-spiral-near {
        0%   { transform: rotate(0deg)   translateX(280px) scale(1.0);  opacity: 0;    }
        6%   { opacity: 0.88; }
        28%  { transform: rotate(130deg) translateX(175px) scale(0.8);  opacity: 0.82; }
        55%  { transform: rotate(270deg) translateX(72px)  scale(0.5);  opacity: 0.60; }
        80%  { transform: rotate(390deg) translateX(16px)  scale(0.18); opacity: 0.25; }
        100% { transform: rotate(460deg) translateX(0px)   scale(0);    opacity: 0;    }
      }
    `;
    document.head.appendChild(el);
  }

  function buildOverlay() {
    var sablier = _sablierImg || document.createElement('img');
    sablier.className = 'aala-sablier';
    sablier.src = '/sablier3-256.png';
    sablier.alt = '';
    sablier.decoding = 'sync';

    var overlay = document.createElement('div');
    overlay.id = 'aala-overlay';
    overlay.innerHTML =
      '<div class="aala-brain aala-far  aala-far-1">🧠</div>' +
      '<div class="aala-brain aala-far  aala-far-2">🧠</div>' +
      '<div class="aala-brain aala-far  aala-far-3">🧠</div>' +
      '<div class="aala-brain aala-mid  aala-mid-1">🧠</div>' +
      '<div class="aala-brain aala-mid  aala-mid-2">🧠</div>' +
      '<div class="aala-brain aala-mid  aala-mid-3">🧠</div>' +
      '<div class="aala-brain aala-near aala-near-1">🧠</div>' +
      '<div class="aala-brain aala-near aala-near-2">🧠</div>' +
      '<div class="aala-brain aala-near aala-near-3">🧠</div>' +
      '';
    overlay.insertBefore(sablier, overlay.querySelector('.aala-label'));
    return overlay;
  }

  function showAiAnalysisAnimation() {
    injectStyles();
    bindViewportSync();
    var token = ++_showToken;

    var existing = document.getElementById('aala-overlay');
    if (existing) existing.parentNode.removeChild(existing);

    _showPromise = Promise.all([preloadSablier(), preloadBackground()]).then(function () {
      if (token !== _showToken) return;
      _showAt = Date.now();
      document.documentElement.classList.add('aala-overlay-active');
      document.body.appendChild(buildOverlay());
      syncOverlayViewportSize();
      requestAnimationFrame(syncOverlayViewportSize);
      setTimeout(syncOverlayViewportSize, 120);
      try { window.parent.postMessage({ type: 'agon:ai-loading-animation-visibility', open: true }, '*'); } catch (e) {}
    });
  }

  function hideAiAnalysisAnimation(callback) {
    var token = _showToken;

    var doHide = function () {
      if (token !== _showToken) {
        if (callback) callback();
        return;
      }

      var overlay = document.getElementById('aala-overlay');
      if (!overlay) {
        _showToken++;
        document.documentElement.classList.remove('aala-overlay-active');
        if (callback) callback();
        return;
      }

      var elapsed   = Date.now() - _showAt;
      var remaining = Math.max(0, MIN_MS - elapsed);

      setTimeout(function () {
        overlay = document.getElementById('aala-overlay');
        if (overlay) {
          overlay.classList.add('is-hiding');
          setTimeout(function () {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            document.documentElement.classList.remove('aala-overlay-active');
            try { window.parent.postMessage({ type: 'agon:ai-loading-animation-visibility', open: false }, '*'); } catch (e) {}
            if (callback) callback();
          }, FADE_MS);
        } else {
          document.documentElement.classList.remove('aala-overlay-active');
          if (callback) callback();
        }
      }, remaining);
    };

    if (_showPromise) {
      _showPromise.then(doHide);
    } else {
      doHide();
    }
  }

  window.showAiAnalysisAnimation = showAiAnalysisAnimation;
  window.hideAiAnalysisAnimation = hideAiAnalysisAnimation;
  preloadSablier();
  preloadBackground();
})();
