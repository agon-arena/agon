(function () {
  'use strict';

  var MIN_MS    = 5000;
  var FADE_MS   = 450;
  var _showAt   = 0;
  var _injected = false;
  var _showToken = 0;
  var _sablierImg = null;
  var _sablierPromise = null;

  function preloadSablier() {
    if (_sablierPromise) return _sablierPromise;
    _sablierImg = new Image();
    _sablierImg.decoding = 'sync';
    _sablierImg.src = '/sablier.png';
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

  function injectStyles() {
    if (_injected) return;
    _injected = true;
    var el = document.createElement('style');
    el.textContent = `
      #aala-overlay {
        position: fixed; inset: 0; z-index: 9998;
        overflow: hidden;
        display: flex; align-items: center; justify-content: center;
        background: radial-gradient(circle at center, #243038 0%, #101820 55%, #05070a 100%);
        opacity: 1;
        transition: opacity ${FADE_MS}ms ease;
      }
      #aala-overlay.is-hiding { opacity: 0; pointer-events: none; }

      /* Sablier centré, toujours au-dessus */
      .aala-sablier {
        position: absolute; top: 50%; left: 50%;
        width: 86px; height: 86px;
        z-index: 3;
        animation: aala-spin-pulse 5s linear infinite;
        pointer-events: none;
      }

      /* Cerveaux positionnés au centre de l'overlay */
      .aala-brain {
        position: absolute; top: 50%; left: 50%;
        z-index: 1;
        pointer-events: none; user-select: none;
        line-height: 1; text-align: center;
        background: transparent;
        mix-blend-mode: screen;
      }

      /* ── Anneau extérieur : part du coin de l'écran ── */
      .aala-far {
        margin-top: -22px; margin-left: -22px;
        width: 44px; height: 44px; font-size: 38px;
        animation: aala-spiral-far 9s linear infinite;
      }
      .aala-far-1 { animation-delay:  0s; }
      .aala-far-2 { animation-delay: -3s; }
      .aala-far-3 { animation-delay: -6s; }

      /* ── Anneau intermédiaire ── */
      .aala-mid {
        margin-top: -17px; margin-left: -17px;
        width: 34px; height: 34px; font-size: 28px;
        animation: aala-spiral-mid 7s linear infinite;
      }
      .aala-mid-1 { animation-delay: -0.5s; }
      .aala-mid-2 { animation-delay: -2.83s; }
      .aala-mid-3 { animation-delay: -5.17s; }

      /* ── Anneau intérieur ── */
      .aala-near {
        margin-top: -12px; margin-left: -12px;
        width: 24px; height: 24px; font-size: 20px;
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
        4%   { opacity: 0.85; }
        28%  { transform: rotate(130deg) translateX(420px) scale(1.2);  opacity: 0.8;  }
        55%  { transform: rotate(270deg) translateX(180px) scale(0.7);  opacity: 0.55; }
        80%  { transform: rotate(390deg) translateX(45px)  scale(0.28); opacity: 0.2;  }
        100% { transform: rotate(460deg) translateX(0px)   scale(0);    opacity: 0;    }
      }

      @keyframes aala-spiral-mid {
        0%   { transform: rotate(0deg)   translateX(450px) scale(1.3);  opacity: 0;    }
        5%   { opacity: 0.8; }
        28%  { transform: rotate(130deg) translateX(290px) scale(1.0);  opacity: 0.75; }
        55%  { transform: rotate(270deg) translateX(120px) scale(0.6);  opacity: 0.5;  }
        80%  { transform: rotate(390deg) translateX(28px)  scale(0.22); opacity: 0.15; }
        100% { transform: rotate(460deg) translateX(0px)   scale(0);    opacity: 0;    }
      }

      @keyframes aala-spiral-near {
        0%   { transform: rotate(0deg)   translateX(280px) scale(1.0);  opacity: 0;    }
        6%   { opacity: 0.75; }
        28%  { transform: rotate(130deg) translateX(175px) scale(0.8);  opacity: 0.7;  }
        55%  { transform: rotate(270deg) translateX(72px)  scale(0.5);  opacity: 0.45; }
        80%  { transform: rotate(390deg) translateX(16px)  scale(0.18); opacity: 0.12; }
        100% { transform: rotate(460deg) translateX(0px)   scale(0);    opacity: 0;    }
      }
    `;
    document.head.appendChild(el);
  }

  function buildOverlay() {
    var sablier = _sablierImg || document.createElement('img');
    sablier.className = 'aala-sablier';
    sablier.src = '/sablier.png';
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
    var token = ++_showToken;

    var existing = document.getElementById('aala-overlay');
    if (existing) existing.parentNode.removeChild(existing);

    preloadSablier().then(function () {
      if (token !== _showToken) return;
      _showAt = Date.now();
      document.body.appendChild(buildOverlay());
    });
  }

  function hideAiAnalysisAnimation(callback) {
    var overlay = document.getElementById('aala-overlay');
    if (!overlay) {
      _showToken++;
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
          if (callback) callback();
        }, FADE_MS);
      } else {
        if (callback) callback();
      }
    }, remaining);
  }

  window.showAiAnalysisAnimation = showAiAnalysisAnimation;
  window.hideAiAnalysisAnimation = hideAiAnalysisAnimation;
  preloadSablier();
})();
