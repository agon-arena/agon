(function () {
  'use strict';

  // ── Visibility observer ─────────────────────────────────────────────
  const _visObs = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      e.target.classList.toggle('is-visible', e.isIntersecting);
    });
  }, { threshold: 0.1 });

  function observeAnimated(root) {
    (root || document).querySelectorAll(
      '.ada-trigger-btn, .ada-countdown-badge, .ada-countdown-ready'
    ).forEach(function (el) { _visObs.observe(el); });
  }

  // ── Auth ────────────────────────────────────────────────────────────
  function getAdminToken() {
    try { return localStorage.getItem('admin_token') || ''; } catch { return ''; }
  }
  function isAdmin() { return !!getAdminToken(); }
  function getDebateId() {
    try { return new URLSearchParams(location.search).get('id') || ''; } catch { return ''; }
  }

  const ANALYSIS_FETCH_CACHE_TTL = 60 * 1000;
  const analysisFetchCache = new Map();

  // Grille de notation de la dernière analyse rendue (utilisée par le modal
  // "Comment Agôn évalue les idées" pour afficher le barème personnalisé
  // réellement appliqué, au lieu de toujours montrer la grille générique.
  let lastScoringGrid = null;

  async function fetchStoredAnalysis(debateId, options = {}) {
    const key = String(debateId || '').trim();
    if (!key) throw new Error('Arène introuvable.');

    const cached = analysisFetchCache.get(key);
    if (!options.force && cached && Date.now() - cached.savedAt < ANALYSIS_FETCH_CACHE_TTL) {
      if (cached.promise) return cached.promise;
      if (cached.result) return cached.result;
    }

    const clientKey = (typeof getKey === 'function') ? getKey() : '';
    const adminHeaders = (typeof debateOwnerHeaders === 'function') ? debateOwnerHeaders() : {};
    const promise = fetch('/api/debates/' + key + '/analysis' + (clientKey ? '?key=' + encodeURIComponent(clientKey) : ''), { headers: adminHeaders })
      .then(async function (response) {
        const json = await response.json().catch(() => ({}));
        return {
          r: {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText
          },
          json
        };
      })
      .then(function (result) {
        analysisFetchCache.set(key, { savedAt: Date.now(), result });
        return result;
      })
      .catch(function (error) {
        analysisFetchCache.delete(key);
        throw error;
      });

    analysisFetchCache.set(key, { savedAt: Date.now(), promise });
    return promise;
  }

  function rememberStoredAnalysis(debateId, json) {
    const key = String(debateId || '').trim();
    if (!key) return;
    analysisFetchCache.set(key, {
      savedAt: Date.now(),
      result: {
        r: { ok: true, status: 200, statusText: 'OK' },
        json: json || {}
      }
    });
  }

  // ── Styles ──────────────────────────────────────────────────────────
  function injectStyles() {
    const css = `
      /* ── Wrapper & trigger ── */
      .ada-wrap { margin: 16px 0 4px; display: flex; flex-direction: column; align-items: center; }
      @media (max-width: 768px) { .ada-wrap { margin-bottom: 18px; } }
      .ada-trigger-btn, .ada-countdown-badge, .ada-countdown-ready {
        animation-play-state: paused;
      }
      .ada-trigger-btn::before,
      .ada-countdown-ready::after {
        animation-play-state: paused;
      }
      .ada-trigger-btn.is-visible, .ada-countdown-badge.is-visible, .ada-countdown-ready.is-visible {
        animation-play-state: running;
      }
      .ada-trigger-btn.is-visible::before,
      .ada-countdown-ready.is-visible::after {
        animation-play-state: running;
      }
      .ada-trigger-btn {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 11px 28px; border-radius: 999px; border: 3px solid #111;
        background: linear-gradient(120deg, #fff 15%, #b0b0b0 50%, #fff 85%);
        background-size: 300% 100%;
        font-size: 14px; font-weight: 700; letter-spacing: .03em;
        cursor: pointer;
        animation: adaShine 1.8s ease-in-out infinite;
        transition: filter .2s, transform .15s;
        will-change: transform, filter, background-position;
      }
      .ada-trigger-btn:hover {
        filter: drop-shadow(0 0 16px rgba(0,0,0,.55));
        transform: translateY(-1px);
      }
      .ada-trigger-btn:disabled { opacity: .55; cursor: default; animation: none; }
      @keyframes adaShine {
        0%   { filter: drop-shadow(0 0 4px rgba(0,0,0,.2));  transform: scale(1);    background-position: 100% 0; }
        50%  { filter: drop-shadow(0 0 22px rgba(0,0,0,.65)) drop-shadow(0 0 8px rgba(0,0,0,.3)); transform: scale(1.07); background-position: 0% 0; }
        100% { filter: drop-shadow(0 0 4px rgba(0,0,0,.2));  transform: scale(1);    background-position: 100% 0; }
      }

      /* ── Panel shell ── */
      .ada-panel {
        margin-top: 10px; border: 1px solid rgba(36,48,56,.16); border-radius: 12px;
        background: #eef3f0; overflow: hidden; display: none; width: 100%;
      }
      .ada-panel-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 9px 14px; background: #dfe8e6; border-bottom: 1px solid rgba(36,48,56,.16);
      }
      .ada-panel-title { font-size: 13px; font-weight: 700; color: #243038; }
      .ada-close-btn {
        background: none; border: none; font-size: 14px; color: #4d6268;
        cursor: pointer; line-height: 1; padding: 2px 4px;
      }
      .ada-close-btn:hover { color: #243038; }
      .ada-body {
        padding: 14px 14px 18px; font-size: 15px; line-height: 1.7; color: #243038;
      }
      .ada-panel-footer {
        padding: 8px 14px; border-top: 1px solid rgba(36,48,56,.16); background: #dfe8e6;
        display: flex; justify-content: flex-end;
      }
      .ada-regen-btn {
        font-size: 11px; padding: 4px 10px; border-radius: 6px;
        border: 1px solid #4d6268; background: #fff; color: #243038;
        cursor: pointer; font-weight: 600;
      }
      .ada-regen-btn:hover { background: #243038; color: #f3f6f4; }
      .ada-regen-btn:disabled { opacity: .55; cursor: default; }
      .ada-regen-btn-under-trigger { margin-top: 8px; }
      .ada-collapse-wrap {
        padding: 6px 14px 16px; display: flex; justify-content: center;
      }
      .ada-collapse-btn {
        display: inline-flex; align-items: center; justify-content: center;
        min-height: 38px; padding: 8px 18px;
        border: 1px solid rgba(36,48,56,.18); border-radius: 999px;
        background: transparent; color: #4d6268;
        font-family: inherit; font-size: 13px; font-weight: 600;
        cursor: pointer; transition: background .15s, color .15s, border-color .15s;
      }
      .ada-collapse-btn:hover { background: rgba(36,48,56,.08); color: #243038; }

      /* ── Meta ── */
      .ada-date {
        font-size: 12px; color: #6b7280; font-style: italic;
        margin-bottom: 14px; padding-bottom: 10px;
        border-bottom: 1px solid #e5e7eb;
      }
      .ada-loading { color: #4d6268; font-style: italic; }
      .ada-error   { color: #b91c1c; }
      .ada-empty   { color: #6b7280; font-style: italic; }

      /* ── Countdown ── */
      .ada-countdown-badge {
        display: inline-flex; align-items: center;
        padding: 3px 12px; border-radius: 999px;
        background: linear-gradient(120deg, #fff 25%, #c8c8c8 50%, #fff 75%);
        background-size: 300% 100%;
        border: 3px solid #111;
        font-size: 11px; font-weight: 600; color: #111;
        white-space: nowrap;
        animation: adaBadgeShine 2.4s ease-in-out infinite;
      }
      @keyframes adaBadgeShine {
        0%   { filter: drop-shadow(0 0 3px rgba(0,0,0,.2));  transform: scale(1);    background-position: 100% 0; }
        50%  { filter: drop-shadow(0 0 12px rgba(0,0,0,.5)); transform: scale(1.05); background-position:   0% 0; }
        100% { filter: drop-shadow(0 0 3px rgba(0,0,0,.2));  transform: scale(1);    background-position: 100% 0; }
      }
      .ada-countdown-ready {
        display: inline-flex; align-items: center; gap: 3px;
        margin: 4px auto 0; padding: 2px 9px; border-radius: 999px;
        background: linear-gradient(120deg, #fff 25%, #c8c8c8 50%, #fff 75%);
        background-size: 300% 100%;
        border: 2px solid #111;
        font-size: 10px; font-weight: 600; color: #111;
        white-space: nowrap;
        animation: adaBadgeShine 2.4s ease-in-out infinite;
      }
      @media (min-width: 769px) {
        .ada-countdown-badge,
        .ada-countdown-ready {
          font-size: 14px;
        }
      }
      .ada-countdown-progress {
        display: inline-flex; align-items: center;
        padding: 0 6px;
        font-size: 11px; font-weight: 500; color: #111827;
        white-space: nowrap; font-style: italic; line-height: 1.3;
      }
      @media (min-width: 769px) {
        .ada-countdown-progress { font-size: 12px; }
      }
      #debate-ai-countdown-slot {
        display: flex; justify-content: center; flex-wrap: wrap; gap: 6px;
        margin: 7px 0 0;
        min-height: 0;
      }
      #debate-ai-progress-slot {
        display: flex; justify-content: center; flex-wrap: wrap; gap: 6px;
        margin: 2px 0 -6px;
        min-height: 0;
      }

      /* ── Report container ── */
      .ada-scoring-report { padding: 2px 0; }
      .ada-report { max-width: 760px; margin: 0 auto; }

      /* ── Verdict card ── */
      .ada-verdict-card {
        background: linear-gradient(135deg, #243038 0%, #31424a 100%);
        border-radius: 14px; padding: 20px 20px 16px;
        margin: 4px 0 22px;
        color: #fff; box-shadow: 0 4px 24px rgba(36,48,56,.28);
      }
      .ada-verdict-eyebrow {
        font-size: 10px; font-weight: 700; letter-spacing: .12em;
        text-transform: uppercase; opacity: .65; margin-bottom: 6px;
      }
      .ada-verdict-winner {
        font-size: 19px; font-weight: 800; line-height: 1.35;
        margin: 0 0 14px; color: #f3f6f4;
      }
      .ada-verdict-scores-row {
        display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px;
      }
      .ada-verdict-score-a {
        font-size: 30px; font-weight: 900; color: #f4d18a; line-height: 1;
      }
      .ada-verdict-score-b {
        font-size: 30px; font-weight: 900; opacity: .45; line-height: 1;
      }
      .ada-verdict-vs {
        font-size: 11px; opacity: .45; font-weight: 600; align-self: center;
      }
      .ada-verdict-confidence {
        display: inline-block; padding: 3px 10px; border-radius: 999px;
        font-size: 10px; font-weight: 700; letter-spacing: .04em;
        margin-bottom: 14px;
      }
      .ada-conf-faible  { background: rgba(239,68,68,.25);  border: 1px solid rgba(239,68,68,.4);  color: #fca5a5; }
      .ada-conf-moyenne { background: rgba(234,179,8,.25);   border: 1px solid rgba(234,179,8,.4);   color: #fde68a; }
      .ada-conf-forte   { background: rgba(34,197,94,.25);   border: 1px solid rgba(34,197,94,.4);   color: #86efac; }
      .ada-verdict-expl {
        font-size: 14px; line-height: 1.65; opacity: .85; margin-bottom: 14px;
      }
      .ada-verdict-note {
        font-size: 13px; opacity: .8; line-height: 1.55; margin-bottom: 10px;
      }
      .ada-verdict-prudence {
        font-size: 13px; opacity: .65; font-style: italic; line-height: 1.55;
        border-top: 1px solid rgba(255,255,255,.15); padding-top: 10px;
      }

      /* ── Combined bar ── */
      .ada-combined-bar { margin: 8px 0 12px; }
      .ada-combined-bar-labels {
        display: flex; justify-content: space-between;
        font-size: 11px; font-weight: 700; margin-bottom: 5px;
      }
      .ada-combined-bar-label-a { color: #516776; }
      .ada-combined-bar-label-b { color: #AEC0CC; text-align: right; }
      .ada-verdict-card .ada-combined-bar-label-a { color: #a0c6d4; }
      .ada-verdict-card .ada-combined-bar-label-b { color: #AEC0CC; }
      .ada-combined-bar-track {
        height: 12px; border-radius: 6px; overflow: hidden;
        display: flex; background: #e5e7eb;
      }
      .ada-verdict-card .ada-combined-bar-track { background: rgba(255,255,255,.15); }
      .ada-combined-bar-seg-a {
        height: 100%; background: linear-gradient(90deg, #516776, #a0c6d4);
        border-radius: 6px 0 0 6px; min-width: 2px;
        transition: width .6s ease;
      }
      .ada-verdict-card .ada-combined-bar-seg-a {
        background: linear-gradient(90deg, #516776, #a0c6d4);
      }
      .ada-combined-bar-seg-b {
        height: 100%; background: #AEC0CC; border-radius: 0 6px 6px 0; flex: 1;
      }
      .ada-verdict-card .ada-combined-bar-seg-b { background: #AEC0CC; }

      /* ── Section header ── */
      .ada-section-h2 {
        display: flex; align-items: center; gap: 8px;
        font-size: 15px; font-weight: 800; color: #243038;
        margin: 24px 0 12px; padding-bottom: 7px;
        border-bottom: 2px solid rgba(36,48,56,.14);
      }
      .ada-section-icon { font-size: 15px; line-height: 1; }

      /* ── Criterion card ── */
      .ada-criterion-card {
        border: 1px solid rgba(36,48,56,.12); border-radius: 10px;
        padding: 13px 15px; margin: 0 0 10px;
        background: rgba(255,255,255,.66);
      }
      .ada-criterion-header {
        display: flex; align-items: center; gap: 7px; margin-bottom: 10px;
      }
      .ada-criterion-icon { font-size: 15px; line-height: 1; }
      .ada-criterion-title { font-size: 14px; font-weight: 700; color: #243038; }
      .ada-criterion-arrow {
        font-size: 14px; line-height: 1.6; color: #374151; margin-top: 8px;
      }
      .ada-criterion-arrow::before { content: '→ '; color: #4d6268; font-weight: 700; }

      /* ── Responsive card tables ── */
      .ada-card-table { width: 100%; margin: 0 0 4px; }
      .ada-card-table-row {
        display: grid; gap: 8px; padding: 10px 0;
        border-bottom: 1px solid rgba(36,48,56,.1); font-size: 14px; line-height: 1.55;
        color: #243038;
      }
      .ada-card-table-row:last-child { border-bottom: none; }
      .ada-card-table-head {
        font-size: 11px; font-weight: 700; color: #5a4a2f;
        letter-spacing: .06em; text-transform: uppercase;
        padding-bottom: 6px; border-bottom: 1px solid rgba(36,48,56,.12);
        margin-bottom: 2px;
      }
      .ada-card-table-3col .ada-card-table-row { grid-template-columns: 1fr 2fr 2fr; }
      .ada-card-table-2col .ada-card-table-row { grid-template-columns: 1fr 2fr; }
      .ada-card-table-3col .ada-card-table-head { grid-template-columns: 1fr 2fr 2fr; display: grid; gap: 8px; }
      .ada-card-table-2col .ada-card-table-head { grid-template-columns: 1fr 2fr; display: grid; gap: 8px; }
      @media (max-width: 560px) {
        .ada-card-table-3col .ada-card-table-row,
        .ada-card-table-2col .ada-card-table-row { grid-template-columns: 1fr; gap: 3px; }
        .ada-card-table-3col .ada-card-table-head,
        .ada-card-table-2col .ada-card-table-head { display: none; }
        .ada-card-table-row > *:first-child { font-weight: 700; color: #243038; }
      }

      /* ── Phrase finale ── */
      .ada-finale {
        margin: 20px 0 8px;
        padding: 14px 16px;
        background: #eef3f0;
        border-left: 4px solid #5a4a2f;
        border-radius: 0 10px 10px 0;
        font-size: 15px; line-height: 1.7; color: #243038; font-style: italic;
      }
      .ada-finale-label {
        font-style: normal; font-weight: 700; font-size: 10px;
        color: #5a4a2f; letter-spacing: .08em; text-transform: uppercase;
        display: block; margin-bottom: 6px;
      }
      /* ── Popularity vs Robustness section — badges de type d'écart (sur .ada-arg-cat) ── */
      .ada-pop-type-weak    { background: #fff0dd; color: #9a5200; }
      .ada-pop-type-average { background: #fff8e0; color: #7a5a00; }
      .ada-pop-type-robust  { background: #e0f5ea; color: #1a6240; }
      .ada-pop-type-both    { background: #ddeeff; color: #1a4070; }

      /* ── Popularity vs Robustness — intro (icônes voix / cerveau au lieu de l'ampoule générique) ── */
      .ada-criterion-arrow.ada-pop-intro::before { content: none; }
      .ada-pop-intro-icon {
        color: #5a4a2f;
        margin-right: 3px;
      }

      /* ── Popularity vs Robustness — cadre unique (constat + analyse par position) ── */
      .ada-pop-summary-card {
        margin: 20px 0 8px;
        padding: 16px 18px;
        background: linear-gradient(135deg, rgba(244,198,107,.22), rgba(255,255,255,.72));
        border: 1px solid rgba(90,74,47,.22);
        border-radius: 16px;
        box-shadow: 0 10px 26px rgba(36,48,56,.1);
        color: #243038;
      }
      .ada-pop-summary-card .ada-finale-label { text-align: center; }
      .ada-pop-main-finding {
        text-align: center;
        font-style: italic;
        font-size: 18px;
        line-height: 1.55;
        margin-bottom: 14px;
      }
      .ada-pop-divider {
        height: 1px;
        margin: 0 0 14px;
        background: rgba(90,74,47,.18);
      }
      .ada-pop-position-row + .ada-pop-position-row {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px dashed rgba(90,74,47,.2);
      }
      .ada-pop-position-text {
        font-size: 15px;
        line-height: 1.55;
      }

      .ada-paste-excluded-notice {
        margin: 0 0 14px;
        padding: 9px 14px;
        background: #f5f0e8;
        border-left: 3px solid #b08d57;
        border-radius: 0 8px 8px 0;
        font-size: 13px; line-height: 1.5; color: #6b5426;
      }
      .ada-camp-summary-stats {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        margin: 4px 0 14px;
        text-align: center;
      }
      .ada-camp-summary-line {
        font-size: 13px;
        font-weight: 500;
        line-height: 1.35;
        color: #64747a;
        margin: 0;
      }

      /* ── Visual refresh: calmer palette, richer hierarchy ── */
      .ada-wrap {
        margin: 14px auto 6px;
        width: min(100%, 920px);
      }
      .ada-trigger-btn {
        position: relative;
        overflow: hidden;
        min-height: 31px;
        padding: 6px 18px;
        border: 1px solid rgba(244,198,107,.55);
        border-radius: 999px;
        background: linear-gradient(120deg, #1a272e 0%, #2d4250 40%, #f4d18a 50%, #2d4250 60%, #1a272e 100%);
        background-size: 300% 100%;
        color: #f3f6f4;
        font-size: 13px;
        font-weight: 800;
        letter-spacing: .04em;
        box-shadow:
          0 0 0 2px rgba(244,198,107,.35),
          0 6px 22px rgba(0,0,0,.35),
          0 0 28px rgba(244,198,107,.28);
        animation: adaTriggerShine 2.2s ease-in-out infinite;
      }
      @keyframes adaTriggerShine {
        0%   { background-position: 100% 0; box-shadow: 0 0 0 2px rgba(244,198,107,.25), 0 6px 18px rgba(0,0,0,.3), 0 0 18px rgba(244,198,107,.18); }
        50%  { background-position:   0% 0; box-shadow: 0 0 0 3px rgba(244,198,107,.65), 0 8px 26px rgba(0,0,0,.38), 0 0 40px rgba(244,198,107,.55); }
        100% { background-position: 100% 0; box-shadow: 0 0 0 2px rgba(244,198,107,.25), 0 6px 18px rgba(0,0,0,.3), 0 0 18px rgba(244,198,107,.18); }
      }
      .ada-trigger-btn::before {
        content: '';
        position: absolute;
        inset: -60% auto -60% -30%;
        width: 35%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,.85), rgba(244,198,107,.7), transparent);
        transform: rotate(18deg) translateX(-200%);
        animation: adaTriggerGlint 2.2s ease-in-out infinite;
        pointer-events: none;
      }
      .ada-trigger-btn::after {
        content: '';
        position: absolute;
        inset: 2px;
        border-radius: inherit;
        border: 1px solid rgba(244,198,107,.45);
        pointer-events: none;
      }
      .ada-trigger-btn:hover {
        filter: none;
        transform: translateY(-2px);
        box-shadow:
          0 0 0 3px rgba(244,198,107,.55),
          0 10px 30px rgba(0,0,0,.4),
          0 0 50px rgba(244,198,107,.6);
      }
      @keyframes adaTriggerGlint {
        0%, 20% { transform: rotate(19deg) translateX(-190%); opacity: 0; }
        34% { opacity: 1; }
        58%, 100% { transform: rotate(19deg) translateX(430%); opacity: 0; }
      }
      @keyframes adaBreath {
        0%, 100% { transform: translateY(0) scale(1); }
        50% { transform: translateY(-1px) scale(1.025); }
      }
      .ada-panel {
        border: 1px solid rgba(36,48,56,.18);
        border-radius: 18px;
        background:
          linear-gradient(180deg, rgba(255,255,255,.56) 0%, rgba(238,243,240,.88) 28%, #dfe8e6 100%);
        box-shadow: 0 24px 70px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.5);
      }
      .ada-panel-header {
        background: linear-gradient(135deg, #243038 0%, #31424a 72%, #5a4a2f 100%);
        border-bottom: 1px solid rgba(244,198,107,.34);
        padding: 11px 15px;
      }
      .ada-panel-title {
        color: #f3f6f4;
        font-size: 14px;
        letter-spacing: .03em;
      }
      .ada-panel-title::before {
        content: '🧭 ';
      }
      .ada-close-btn {
        color: #f4d18a;
        width: 28px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        font-size: 13px;
        transition: background .18s ease, color .18s ease, transform .18s ease;
      }
      .ada-close-btn:hover {
        background: rgba(244,198,107,.15);
        color: #fff;
        transform: rotate(8deg);
      }
      .ada-body {
        color: #18252c;
        font-size: 18px;
        line-height: 1.58;
        padding: 16px clamp(14px, 2.6vw, 24px) 22px;
      }
      .ada-date {
        color: #f3f6f4;
        text-align: center;
        border-bottom: 1px solid rgba(36,48,56,.18);
        margin-bottom: 10px;
        padding-bottom: 7px;
        font-size: 14px;
      }
      .ada-date::before {
        content: '🕰️ ';
        font-style: normal;
      }
      .ada-scoring-report {
        animation: adaReportRise .42s ease both;
      }
      .ada-report {
        max-width: 820px;
        width: 100%;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      @keyframes adaReportRise {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .ada-verdict-card {
        position: relative;
        overflow: hidden;
        text-align: center;
        background:
          linear-gradient(135deg, #243038 0%, #31424a 54%, #1b252b 100%);
        border: 1px solid rgba(244,198,107,.34);
        border-radius: 18px;
        padding: 18px 18px 15px;
        margin-bottom: 10px;
        box-shadow: 0 14px 34px rgba(17,24,29,.32);
      }
      .ada-verdict-card::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(110deg, transparent 0%, rgba(255,255,255,.11) 42%, transparent 58%);
        transform: translateX(-120%);
        animation: adaPanelGlint 5.8s ease-in-out infinite;
        pointer-events: none;
      }
      @keyframes adaPanelGlint {
        0%, 62% { transform: translateX(-120%); }
        78%, 100% { transform: translateX(120%); }
      }
      .ada-verdict-eyebrow {
        color: #f4d18a;
        opacity: 1;
        margin-bottom: 6px;
        font-size: 13px;
        font-weight: 800;
        letter-spacing: .08em;
        text-transform: uppercase;
      }
      .ada-verdict-winner {
        color: #f3f6f4;
        font-size: clamp(22px, 3vw, 30px);
        line-height: 1.16;
        font-weight: 850;
        margin-bottom: 8px;
      }
      .ada-verdict-scores-row {
        justify-content: center;
      }
      .ada-verdict-score-a,
      .ada-verdict-score-b {
        color: #f4d18a;
        opacity: 1;
      }
      .ada-verdict-vs {
        color: rgba(243,246,244,.7);
        opacity: 1;
      }
      .ada-verdict-confidence {
        background: rgba(232,232,232,.1);
        color: #f3f6f4;
        border: 1px solid rgba(232,232,232,.18);
      }
      .ada-conf-faible { color: #ffc7b8; }
      .ada-conf-moyenne { color: #f4d18a; }
      .ada-conf-forte { color: #a7f3d0; }
      .ada-verdict-expl {
        font-size: 17px;
        line-height: 1.55;
        max-width: 680px;
        margin-top: 8px;
        margin-left: auto;
        margin-right: auto;
      }
      .ada-verdict-expl,
      .ada-verdict-prudence {
        color: rgba(243,246,244,.86);
      }
      .ada-verdict-note {
        color: rgba(243,246,244,.74);
        font-size: 15px;
        line-height: 1.48;
        max-width: 680px;
        margin-top: 6px;
        margin-left: auto;
        margin-right: auto;
      }
      .ada-verdict-prudence {
        font-size: 14px;
        line-height: 1.42;
        padding-top: 8px;
        margin-top: 8px;
      }
      .ada-combined-bar-label-a,
      .ada-combined-bar-label-b,
      .ada-verdict-card .ada-combined-bar-label-a,
      .ada-verdict-card .ada-combined-bar-label-b {
        color: #243038;
      }
      .ada-combined-bar-label-a {
        color: var(--color-a, #516776);
      }
      .ada-combined-bar-label-b {
        color: var(--color-b, #AEC0CC);
      }
      .ada-combined-bar-labels {
        font-size: 18px;
        line-height: 1.25;
        gap: 10px;
      }
      .ada-verdict-card .ada-combined-bar-label-a,
      .ada-verdict-card .ada-combined-bar-label-b {
        color: rgba(243,246,244,.82);
      }
      .ada-verdict-card .ada-combined-bar-label-a {
        color: #a0c6d4;
      }
      .ada-verdict-card .ada-combined-bar-label-b {
        color: #AEC0CC;
      }
      .ada-combined-bar-track {
        height: 14px;
        border-radius: 999px;
        background: rgba(36,48,56,.15);
        box-shadow: inset 0 1px 3px rgba(0,0,0,.14);
      }
      .ada-combined-bar-seg-a {
        border-radius: 999px 0 0 999px;
        background: linear-gradient(90deg, var(--color-a, #516776), #a0c6d4);
        animation: adaBarGrow .7s ease-out both;
      }
      .ada-verdict-card .ada-combined-bar-seg-a {
        background: linear-gradient(90deg, var(--color-a, #516776), #a0c6d4);
      }
      .ada-combined-bar-seg-b {
        border-radius: 0 999px 999px 0;
        background: var(--color-b, #AEC0CC);
      }
      @keyframes adaBarGrow {
        from { width: 0; }
      }
      .ada-section-h2 {
        justify-content: center;
        text-align: center;
        color: #f3f6f4;
        border: none;
        border-radius: 999px;
        background: linear-gradient(135deg, #243038 0%, #31424a 100%);
        margin: 22px auto 12px;
        padding: 9px 22px;
        width: fit-content;
        max-width: 100%;
        letter-spacing: .04em;
        text-transform: uppercase;
        font-size: 12px;
        font-weight: 900;
        box-shadow: 0 6px 18px rgba(36,48,56,.22);
      }
      .ada-section-icon {
        filter: drop-shadow(0 2px 4px rgba(0,0,0,.2));
      }
      summary.ada-section-h2 {
        cursor: pointer;
        list-style: none;
      }
      summary.ada-section-h2::-webkit-details-marker {
        display: none;
      }
      summary.ada-section-h2::after {
        content: '⌄';
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        border-radius: 999px;
        background: rgba(255,255,255,.18);
        color: inherit;
        font-size: 12px;
        line-height: 1;
        transition: transform .18s ease;
      }
      details[open] > summary.ada-section-h2::after {
        transform: rotate(180deg);
      }
      .ada-camp-title {
        border: 0;
        border-radius: 6px;
        color: #f3f6f4;
        text-shadow: 0 1px 2px rgba(0,0,0,.65), 0 0 4px rgba(0,0,0,.45);
        margin: 4px 0;
        width: 100%;
        box-sizing: border-box;
        box-shadow: 0 7px 18px rgba(36,48,56,.12);
        text-transform: none;
        letter-spacing: .01em;
        font-size: 16px;
      }
      .ada-camp-title-a {
        background: linear-gradient(135deg, rgba(81,103,118,.5), rgba(111,141,157,.5));
      }
      .ada-camp-title-b {
        background: linear-gradient(135deg, rgba(174,192,204,.65), rgba(213,224,230,.65));
      }
      .ada-camp-title .ada-section-icon {
        display: none;
      }
      .ada-criterion-card {
        background: linear-gradient(180deg, rgba(255,255,255,.76), rgba(247,250,248,.68));
        border: 1px solid rgba(36,48,56,.12);
        border-radius: 14px;
        padding: 12px 14px;
        box-shadow: 0 7px 18px rgba(36,48,56,.07);
        transition: transform .18s ease, box-shadow .18s ease;
      }
      .ada-criterion-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 22px rgba(36,48,56,.1);
      }
      .ada-criterion-header {
        justify-content: center;
        text-align: center;
      }
      .ada-criterion-title {
        color: #243038;
        font-size: 17px;
        font-weight: 850;
        letter-spacing: .02em;
      }
      .ada-criterion-arrow {
        text-align: center;
        color: #283941;
        font-size: 16px;
        line-height: 1.5;
        background: rgba(36,48,56,.05);
        border-radius: 12px;
        padding: 8px 10px;
      }
      .ada-criterion-arrow::before {
        content: '💡 ';
        color: #5a4a2f;
      }
      .ada-card-table {
        overflow: hidden;
        border: 1px solid rgba(36,48,56,.12);
        border-radius: 14px;
        background: rgba(255,255,255,.5);
        box-shadow: 0 8px 18px rgba(36,48,56,.06);
      }
      .ada-card-table-row {
        color: #22323a;
        border-bottom: 1px solid rgba(36,48,56,.12);
        font-size: 15px;
        line-height: 1.5;
        padding: 9px 12px;
      }
      .ada-card-table-head {
        color: #5a4a2f;
        border-bottom: 1px solid rgba(36,48,56,.18);
        background: rgba(244,198,107,.12);
        font-size: 12px;
        font-weight: 850;
        letter-spacing: .04em;
        text-transform: uppercase;
        padding: 8px 12px;
      }
      .ada-finale {
        text-align: center;
        background: linear-gradient(135deg, rgba(244,198,107,.22), rgba(255,255,255,.72));
        border-left: 0;
        border: 1px solid rgba(90,74,47,.22);
        border-radius: 16px;
        color: #243038;
        box-shadow: 0 10px 26px rgba(36,48,56,.1);
        font-size: 18px;
        line-height: 1.55;
        padding: 14px 16px;
      }
      .ada-finale-label {
        display: block;
        margin-bottom: 5px;
        color: #5a4a2f;
        font-size: 12px;
        letter-spacing: .08em;
      }
      .ada-loading,
      .ada-empty {
        display: block;
        text-align: center;
        color: #4d6268;
      }
      .ada-loading::before { content: '⏳ '; }
      .ada-empty::before { content: '🫧 '; }
      .ada-error {
        display: block;
        text-align: center;
      }
      .ada-error::before { content: '⚠️ '; }
      .ada-countdown-badge,
      .ada-countdown-ready {
        position: relative;
        overflow: hidden;
        border: 1px solid rgba(232,232,232,.28);
        background: linear-gradient(135deg, #243038, #31424a);
        color: #f3f6f4;
        box-shadow: 0 8px 18px rgba(0,0,0,.22);
        animation: adaBreath 3.4s ease-in-out infinite;
      }
      .ada-countdown-ready::after {
        content: '';
        position: absolute;
        top: -55%;
        bottom: -55%;
        left: -45%;
        width: 34%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,.72), transparent);
        transform: rotate(18deg) translateX(-160%);
        animation: adaBadgeGlint 3.6s ease-in-out infinite;
        pointer-events: none;
      }
      .ada-countdown-ready:hover {
        transform: translateY(-1px);
        box-shadow: 0 10px 24px rgba(0,0,0,.28), 0 0 0 4px rgba(244,198,107,.12);
      }
      @keyframes adaBadgeGlint {
        0%, 38% { transform: rotate(18deg) translateX(-160%); opacity: 0; }
        48% { opacity: .9; }
        66%, 100% { transform: rotate(18deg) translateX(360%); opacity: 0; }
      }
      .ada-regen-btn {
        border-color: rgba(36,48,56,.3);
        color: #243038;
        border-radius: 8px;
        padding: 4px 9px;
        font-size: 11px;
        box-shadow: none;
      }
      .ada-regen-btn:hover {
        background: #243038;
        color: #f3f6f4;
      }
      /* ── Verdict gauge ── */
      .ada-gauge-meter {
        position: relative; width: min(100%, 290px); aspect-ratio: 2/1;
        margin: 8px auto 1px; overflow: hidden;
      }
      .ada-gauge-arc {
        position: absolute; inset: 0;
        border-radius: 290px 290px 0 0; overflow: hidden;
        background: linear-gradient(90deg, #516776 0%, #a0c6d4 44%, rgba(255,255,255,.24) 50%, #e8f3f7 56%, #AEC0CC 100%);
        box-shadow: inset 0 4px 10px rgba(255,255,255,.18), inset 0 -8px 18px rgba(0,0,0,.35);
      }
      .ada-gauge-arc::after {
        content: ''; position: absolute;
        left: 12%; right: 12%; bottom: -2px; height: 74%;
        border-radius: 260px 260px 0 0;
        background: linear-gradient(180deg, #2e3f48 0%, #243038 100%);
        box-shadow: inset 0 4px 12px rgba(0,0,0,.25);
      }
      .ada-gauge-tick {
        position: absolute; bottom: 10px; width: 1px; height: 8px;
        background: rgba(255,255,255,.28); z-index: 1; transform-origin: bottom center;
      }
      .ada-gauge-tick-center { width: 2px; height: 13px; background: rgba(255,255,255,.45); }
      .ada-gauge-needle {
        position: absolute; left: 50%; bottom: 4px;
        width: 4px; height: 76%;
        border-radius: 999px 999px 2px 2px;
        background: linear-gradient(180deg, #f7faf8 0%, #AEC0CC 54%, #516776 100%);
        box-shadow: 0 2px 8px rgba(0,0,0,.45);
        transform: translateX(-50%) rotate(var(--ada-gauge-angle, 0deg));
        transform-origin: 50% calc(100% - 4px);
        transition: transform .65s cubic-bezier(.2,.8,.2,1);
        z-index: 3;
      }
      .ada-gauge-needle::before {
        content: ''; position: absolute; left: 50%; top: -6px;
        width: 0; height: 0;
        border-left: 6px solid transparent; border-right: 6px solid transparent;
        border-bottom: 11px solid #f7faf8;
        transform: translateX(-50%);
      }
      .ada-gauge-pivot {
        position: absolute; left: 50%; bottom: 0;
        width: 22px; height: 22px; border-radius: 50%;
        background: radial-gradient(circle at 35% 35%, rgba(255,255,255,.92) 0%, #AEC0CC 36%, #516776 38%, #243038 100%);
        box-shadow: 0 2px 8px rgba(0,0,0,.45);
        transform: translateX(-50%); z-index: 4;
      }
      .ada-gauge-labels {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
        align-items: start;
        gap: 12px;
        margin: 5px 0 10px;
        padding: 9px 0 0;
        border-top: 1px solid rgba(243,246,244,.16);
      }
      .ada-gauge-label-a { color: #a0c6d4; text-align: left; }
      .ada-gauge-label-b { color: #AEC0CC; text-align: right; }
      .ada-gauge-label-a,
      .ada-gauge-label-b {
        min-width: 0;
        overflow-wrap: anywhere;
        white-space: normal;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.28;
      }
      .ada-gauge-position-text {
        display: block;
      }
      .ada-gauge-label-divider {
        width: 1px;
        min-height: 44px;
        margin-top: 1px;
        background: linear-gradient(180deg, transparent, rgba(243,246,244,.34), transparent);
      }
      .ada-gauge-score {
        display: block;
        margin-top: 4px;
        color: #f3f6f4;
        font-size: 22px;
        font-weight: 900;
        line-height: 1;
      }
      .ada-gauge-score small { font-size: 12px; font-weight: 650; opacity: .55; }

      /* ── New-format argument cards ── */
      .ada-arg-card { border: 1px solid rgba(36,48,56,.12); border-radius: 12px; padding: 10px 12px; margin: 0 0 8px; background: rgba(255,255,255,.66); box-shadow: 0 5px 14px rgba(36,48,56,.05); }
      .ada-arg-excluded { opacity: .6; }
      .ada-arg-excluded-label { margin-left: auto; font-size: 10px; font-weight: 600; color: #9ca3af; letter-spacing: .04em; text-transform: uppercase; }
      .ada-arg-rank { font-size: 12px; font-weight: 700; color: #6b7280; background: #f3f4f6; border-radius: 999px; padding: 2px 8px; }
      .ada-arg-header { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; }
      .ada-arg-score { font-size: 20px; font-weight: 900; line-height: 1; color: #243038; }
      .ada-arg-score small { font-size: 11px; font-weight: 650; opacity: .58; }
      .ada-arg-cat { font-size: 12px; font-weight: 800; padding: 3px 9px; border-radius: 999px; }
      .ada-cat-excellent { color: #243038; background: #dfe8e6; }
      .ada-cat-bon       { color: #15803d; background: #dcfce7; }
      .ada-cat-moyen     { color: #b45309; background: #fef9c3; }
      .ada-cat-faible    { color: #b91c1c; background: #fee2e2; }
      .ada-arg-text { font-size: 17px; color: #243038; margin-bottom: 6px; font-style: italic; line-height: 1.48; }
      .ada-arg-breakdown { font-size: 13px; color: #64747a; margin-bottom: 5px; }
      .ada-arg-expl { font-size: 15px; color: #37484f; line-height: 1.5; margin-bottom: 5px; }
      .ada-arg-list { margin: 4px 0 4px 18px; padding: 0; font-size: 15px; line-height: 1.48; }
      .ada-arg-strengths li { color: #15803d; }
      .ada-arg-weaknesses li { color: #b91c1c; }
      .ada-arg-source { font-size: 13px; margin-top: 5px; padding: 5px 8px; border-radius: 7px; }
      .ada-arg-source-ok   { background: #f0fdf4; color: #15803d; }
      .ada-arg-source-none { background: #f9fafb; color: #9ca3af; }
      .ada-camp-section { margin-bottom: 8px; }
      .ada-args-details {
        margin-top: 6px;
      }
      .ada-criterion-details + .ada-criterion-details {
        margin-top: 0;
      }
      .ada-args-summary {
        list-style: none;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        width: fit-content;
        max-width: 100%;
        margin: 0 auto 8px;
        padding: 6px 10px;
        border: 1px solid rgba(36,48,56,.16);
        border-radius: 9px;
        background: rgba(255,255,255,.62);
        color: #243038;
        font-size: 14px;
        font-weight: 750;
        cursor: pointer;
        box-shadow: 0 3px 8px rgba(36,48,56,.05);
      }
      .ada-args-summary::-webkit-details-marker {
        display: none;
      }
      .ada-args-summary::after {
        content: '⌄';
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        border-radius: 999px;
        background: rgba(36,48,56,.1);
        color: #243038;
        font-size: 12px;
        line-height: 1;
        transition: transform .18s ease;
      }
      .ada-args-details[open] .ada-args-summary::after {
        transform: rotate(180deg);
      }
      .ada-args-list {
        animation: adaReportRise .28s ease both;
        margin: 0;
        padding: 0;
      }
      .ada-args-details > :not(summary) {
        margin-left: 0;
        padding-left: 0;
      }
      .ada-arg-card.ada-arg-extra-hidden {
        display: none;
      }
      .ada-load-more-wrap {
        display: flex;
        justify-content: center;
        gap: 8px;
        margin: 2px 0 8px;
      }
      .ada-load-more-btn {
        border: 1px solid rgba(36,48,56,.14);
        border-radius: 999px;
        background: rgba(255,255,255,.48);
        color: #4d6268;
        cursor: pointer;
        font-size: 12px;
        font-weight: 750;
        line-height: 1;
        padding: 6px 11px;
        transition: background .16s ease, color .16s ease, border-color .16s ease;
      }
      .ada-load-more-btn:hover {
        background: rgba(255,255,255,.72);
        border-color: rgba(36,48,56,.24);
        color: #243038;
      }
      .ada-load-more-btn.is-collapse {
        color: #64747a;
      }
      .ada-summary-details {
        margin-top: 6px;
      }
      .ada-summary-list {
        animation: adaReportRise .28s ease both;
      }
      .ada-summary-card { border: 1px solid rgba(36,48,56,.12); border-radius: 12px; padding: 10px 12px; margin: 0 0 8px; background: rgba(255,255,255,.66); box-shadow: 0 5px 14px rgba(36,48,56,.05); }
      .ada-summary-label { font-size: 14px; font-weight: 850; color: #243038; margin-bottom: 5px; }
      .ada-summary-section-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; margin: 6px 0 3px; }
      .ada-summary-strengths-title { color: #15803d; }
      .ada-summary-weaknesses-title { color: #b91c1c; }
      .ada-dup-section {
        margin: 7px 0 6px;
        padding: 8px 10px;
        border: 1px dashed rgba(90,74,47,.34);
        border-radius: 10px;
        background: rgba(244,198,107,.12);
      }
      .ada-dup-title { font-size: 12px; font-weight: 800; color: #5a4a2f; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 5px; }
      .ada-dup-group { font-size: 13px; color: #374151; margin-bottom: 4px; padding: 5px 8px; background: rgba(255,255,255,.58); border-radius: 7px; }

      @media (prefers-reduced-motion: reduce) {
        .ada-trigger-btn,
        .ada-countdown-badge,
        .ada-countdown-ready,
        .ada-scoring-report,
        .ada-combined-bar-seg-a,
        .ada-verdict-card::after,
        .ada-countdown-ready::after,
        .ada-trigger-btn::before {
          animation: none !important;
        }
        .ada-criterion-card,
        .ada-trigger-btn {
          transition: none !important;
        }
      }
      @media (min-width: 769px) {
        /* ── Mise en page camps ── */
        .ada-camp-title {
          width: fit-content; min-width: 200px; max-width: 80%;
          margin: 4px auto; padding: 10px 28px;
        }
        /* ── Corps du panel ── */
        .ada-body               { font-size: 22px; }
        .ada-date               { font-size: 16px; }
        /* ── Cartes arguments ── */
        .ada-arg-text           { font-size: 21px; }
        .ada-arg-breakdown      { font-size: 17px; }
        .ada-arg-expl           { font-size: 19px; }
        .ada-arg-list           { font-size: 18px; }
        .ada-arg-source         { font-size: 16px; }
        .ada-arg-score          { font-size: 28px; }
        .ada-arg-score small    { font-size: 15px; }
        .ada-arg-cat            { font-size: 15px; }
        .ada-arg-excluded-label { font-size: 13px; }
        /* ── Stats de camp ── */
        .ada-camp-summary-line  { font-size: 17px; }
        /* ── Critères ── */
        .ada-criterion-title    { font-size: 18px; }
        .ada-criterion-arrow    { font-size: 19px; }
        .ada-combined-bar-labels { font-size: 18px; }
        /* ── Verdict (sauf winner déjà grand) ── */
        .ada-verdict-winner     { font-size: clamp(24px, 3.2vw, 32px); }
        .ada-verdict-eyebrow    { font-size: 13px; }
        .ada-verdict-confidence { font-size: 13px; padding: 5px 14px; }
        .ada-verdict-expl       { font-size: 18px; }
        .ada-verdict-note       { font-size: 17px; }
        .ada-verdict-prudence   { font-size: 15px; }
        /* ── Jauge ── */
        .ada-gauge-label-a,
        .ada-gauge-label-b      { font-size: 16px; }
        .ada-gauge-score        { font-size: 30px; }
        .ada-gauge-score small  { font-size: 15px; }
        /* ── Synthèse & doublons ── */
        .ada-summary-label           { font-size: 18px; }
        .ada-summary-section-title   { font-size: 13px; }
        .ada-dup-group               { font-size: 17px; }
        /* ── Menus déroulants ── */
        .ada-args-summary       { font-size: 14px; }
        /* ── Conclusion & finale ── */
        .ada-finale             { font-size: 21px; }
        .ada-pop-main-finding   { font-size: 21px; }
        .ada-pop-position-text  { font-size: 16px; }
        /* ── Modal barème ── */
        .ada-bareme-modal       { font-size: 18px; }
        .ada-bareme-modal h2    { font-size: 23px; }
        .ada-bareme-modal h3    { font-size: 15px; }
      }
      @media (max-width: 560px) {
        .ada-card-table-row > *:first-child {
          color: #243038;
        }
        .ada-body {
          font-size: 16px;
          padding: 14px 12px 18px;
        }
        .ada-arg-text {
          font-size: 16px;
        }
        .ada-verdict-expl,
        .ada-criterion-arrow,
        .ada-finale,
        .ada-pop-main-finding {
          font-size: 15px;
        }
        .ada-pop-position-text {
          font-size: 14px;
        }
        .ada-pop-summary-card {
          padding: 13px 14px;
        }
      }
    `;
    const el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);

    // ── CSS modal barème ──
    const mCss = document.createElement('style');
    mCss.textContent = `
      .ada-bareme-overlay {
        position: fixed; inset: 0; z-index: 400000;
        background: rgba(18,24,28,.72); backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
        animation: adaFadeIn .2s ease;
      }
      @keyframes adaFadeIn { from { opacity:0 } to { opacity:1 } }
      .ada-bareme-modal {
        background: #f4f7f5;
        border-radius: 16px;
        max-width: 680px; width: 100%;
        max-height: 88vh;
        overflow-y: auto;
        padding: 28px 28px 32px;
        box-shadow: 0 24px 60px rgba(18,24,28,.38);
        position: relative;
        font-size: 15px; line-height: 1.7; color: #243038;
      }
      .ada-bareme-close {
        position: sticky; top: 0; float: right;
        background: #243038; color: #f3f6f4;
        border: none; border-radius: 999px;
        width: 32px; height: 32px; font-size: 18px;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        margin: -4px -4px 12px 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,.2);
      }
      .ada-bareme-modal h2 { font-size: 18px; font-weight: 900; margin: 0 0 12px; color: #243038; }
      .ada-bareme-modal h3 { font-size: 14px; font-weight: 800; margin: 20px 0 8px; color: #243038; text-transform: uppercase; letter-spacing: .04em; }
      .ada-bareme-modal p  { margin: 0 0 10px; }
      .ada-bareme-modal ul { margin: 6px 0 10px 18px; padding: 0; }
      .ada-bareme-modal li { margin-bottom: 6px; }
      .ada-bareme-modal strong { font-weight: 800; }
      .ada-bareme-modal .ada-bareme-rule {
        background: rgba(36,48,56,.06); border-radius: 10px;
        padding: 10px 14px; margin: 6px 0 10px;
        font-size: 14px; line-height: 1.6;
      }
      @media (max-width: 560px) {
        .ada-bareme-modal { padding: 20px 16px 24px; font-size: 14px; }
      }
    `;
    document.head.appendChild(mCss);
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function md(s) {
    return esc(s)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
  }

  // ── New-format renderer (version 2 JSON) ────────────────────────────

  function renderNewAnalysis(d, popularityHtml) {
    lastScoringGrid = (d && d.scoringGrid && typeof d.scoringGrid === 'object') ? d.scoringGrid : null;
    const CAT_CSS = { excellent: 'ada-cat-excellent', bon: 'ada-cat-bon', moyen: 'ada-cat-moyen', faible: 'ada-cat-faible' };
    const CAT_LABEL = { excellent: 'excellent', bon: 'bon', moyen: 'moyen', faible: 'faible' };
    const DEFAULT_CRITERIA = {
      open: [
        { key: 'pertinence', label: 'Pertinence par rapport au sujet', max: 20 },
        { key: 'clarity',    label: 'Clarté', max: 15 },
        { key: 'reasoning',  label: 'Solidité ou justification', max: 25 },
        { key: 'precision',  label: "Apport à l'arène", max: 25 },
        { key: 'nuance',     label: 'Nuance', max: 10 },
        { key: 'tone',       label: 'Ton', max: 5 }
      ],
      position: [
        { key: 'pertinence', label: 'Pertinence par rapport à la question', max: 20 },
        { key: 'clarity',    label: 'Clarté de la thèse', max: 15 },
        { key: 'reasoning',  label: 'Qualité du raisonnement', max: 30 },
        { key: 'precision',  label: 'Précision / mécanisme concret', max: 20 },
        { key: 'nuance',     label: 'Nuance et prise en compte des limites', max: 10 },
        { key: 'tone',       label: "Qualité de l'arène / ton", max: 5 }
      ]
    };

    function catBadge(cat, score) {
      const cls = CAT_CSS[cat] || 'ada-cat-faible';
      return `<span class="ada-arg-score ${cls}">${score}<small>/100</small></span><span class="ada-arg-cat ${cls}">${CAT_LABEL[cat] || cat}</span>`;
    }

    function duplicateGroupsForArgument(groups, argumentId) {
      const targetId = String(argumentId || '').trim();
      if (!targetId || !Array.isArray(groups)) return [];
      return groups.filter((group) => {
        const representativeId = String(group?.representativeArgumentId || '').trim();
        if (representativeId === targetId) return true;
        const mergedIds = Array.isArray(group?.mergedArgumentIds) ? group.mergedArgumentIds : [];
        return mergedIds.some((id) => String(id || '').trim() === targetId);
      });
    }

    function dupGroups(groups) {
      if (!groups || !groups.length) return '';
      return '<div class="ada-dup-section"><div class="ada-dup-title">♊ Doublons regroupés</div>' +
        groups.map((group) => {
          const mergedCount = Array.isArray(group?.mergedArgumentIds) ? group.mergedArgumentIds.length : 0;
          return `<div class="ada-dup-group">${esc(group?.sharedIdea || '')} — ${mergedCount} argument${mergedCount > 1 ? 's' : ''} fusionné${mergedCount > 1 ? 's' : ''}</div>`;
        }).join('') +
        '</div>';
    }

    function customRubricReportHtml(report) {
      if (!report || !Array.isArray(report.criteria) || !report.criteria.length) return '';
      const criteriaHtml = report.criteria.map((criterion) => {
        const label = String(criterion?.label || '').trim();
        if (!label) return '';
        const score = Number(criterion?.score);
        const max = Number(criterion?.max);
        const status = String(criterion?.status || '').trim();
        const justification = String(criterion?.justification || '').trim();
        const scoreText = Number.isFinite(score) && Number.isFinite(max) && max > 0
          ? ` — ${score}/${max}`
          : (Number.isFinite(score) ? ` — ${score} pts` : '');
        return `<li><strong>${esc(label)}</strong>${esc(scoreText)}${status ? ` — ${esc(status)}` : ''}${justification ? `<br><span>${esc(justification)}</span>` : ''}</li>`;
      }).filter(Boolean).join('');
      const totalScore = Number(report.totalScore);
      const maxScore = Number(report.maxScore || 100);
      const totalHtml = Number.isFinite(totalScore)
        ? `<div class="ada-arg-expl">Total : ${totalScore}/${Number.isFinite(maxScore) ? maxScore : 100}</div>`
        : '';
      return '<div class="ada-dup-section"><div class="ada-dup-title">Détail du barème</div>' +
        '<ul class="ada-arg-list">' + criteriaHtml + '</ul>' +
        totalHtml +
        '</div>';
    }

    function defaultRubricReportHtml(a, isOpen) {
      const scores = a && a.scores_without_sources && typeof a.scores_without_sources === 'object'
        ? a.scores_without_sources
        : null;
      if (!scores) return '';
      const criteria = isOpen ? DEFAULT_CRITERIA.open : DEFAULT_CRITERIA.position;
      const criteriaHtml = criteria.map((criterion) => {
        const score = Number(scores[criterion.key]);
        if (!Number.isFinite(score)) return '';
        return `<li><strong>${esc(criterion.label)}</strong> — ${score}/${criterion.max}</li>`;
      }).filter(Boolean).join('');
      if (!criteriaHtml) return '';
      const qualityScore = Number(scores.total_without_sources);
      const sourceScore = Number(a.source_score || 0);
      const totalHtml = Number.isFinite(qualityScore)
        ? `<div class="ada-arg-expl">Total qualité : ${qualityScore}/100${sourceScore > 0 ? ` · Bonus source : +${sourceScore} pts` : ''} · Score final : ${a.final_score}/100</div>`
        : '';
      return '<div class="ada-dup-section"><div class="ada-dup-title">Détail du barème</div>' +
        '<ul class="ada-arg-list">' + criteriaHtml + '</ul>' +
        totalHtml +
        '</div>';
    }

    function argCard(a, duplicateGroups = [], isExtraHidden = false, isOpen = false, rankPos = null, rankTotal = null) {
      const scoreOut = a.scores_without_sources ? Number(a.scores_without_sources.total_without_sources || 0) : 0;
      const customReport = a.custom_rubric_report && typeof a.custom_rubric_report === 'object' ? a.custom_rubric_report : null;
      const strengthsHtml = (a.strengths || []).length
        ? '<ul class="ada-arg-list ada-arg-strengths">' + a.strengths.map(s => `<li>${esc(s)}</li>`).join('') + '</ul>' : '';
      const weaknessesHtml = (a.weaknesses || []).length
        ? '<ul class="ada-arg-list ada-arg-weaknesses">' + a.weaknesses.map(s => `<li>${esc(s)}</li>`).join('') + '</ul>' : '';
      const sourceHtml = customReport ? '' : (a.has_url_source
        ? `<div class="ada-arg-source ada-arg-source-ok">Source : ${esc(a.source_level || '')} — ${esc(a.source_explanation || '')}</div>`
        : `<div class="ada-arg-source ada-arg-source-none">Aucune source URL fournie</div>`);
      const breakdownHtml = customReport
        ? `<div class="ada-arg-breakdown">Barème personnalisé : ${a.final_score}/100</div>`
        : `<div class="ada-arg-breakdown">Qualité argumentative : ${scoreOut}/100 · Bonus source : +${a.source_score || 0} pts, score final plafonné à 100</div>`;
      const excluded = a.category === 'faible' || a.category === 'moyen';
      // Le badge affiche la catégorie du score final (cohérente avec le nombre /100 montré
      // juste à côté) — `a.category`, basé sur la qualité hors sources, ne sert qu'au
      // poids dans le verdict (voir `excluded` ci-dessus) et resterait trompeur ici.
      const badgeCategory = a.final_category || a.category;
      return `<div class="ada-arg-card${excluded ? ' ada-arg-excluded' : ''}${isExtraHidden ? ' ada-arg-extra-hidden' : ''}">
        <div class="ada-arg-header">${catBadge(badgeCategory, a.final_score)}${rankPos !== null && rankTotal > 1 ? `<span class="ada-arg-rank">${rankPos} / ${rankTotal}</span>` : ''}${excluded && !isOpen ? '<span class="ada-arg-excluded-label">non compté dans le verdict</span>' : ''}</div>
        <div class="ada-arg-text">"${esc(a.argumentText)}"</div>
        ${dupGroups(duplicateGroups)}
        ${breakdownHtml}
        ${a.short_explanation ? `<div class="ada-arg-expl">${esc(a.short_explanation)}</div>` : ''}
        ${a.final_score_note ? `<div class="ada-arg-expl">${esc(a.final_score_note)}</div>` : ''}
        ${customReport ? customRubricReportHtml(customReport) : defaultRubricReportHtml(a, isOpen)}
        ${strengthsHtml}${weaknessesHtml}
        ${sourceHtml}
      </div>`;
    }

    function campSection(camp, campData, pasteExcluded, isOpen) {
      const rawArgs = campData.effectiveArguments || [];
      if (!rawArgs.length) return `<div class="ada-empty">Aucune idée pour ${esc(campData.label)}.</div>`;
      const args = [...rawArgs].sort((a, b) => (b.final_score || 0) - (a.final_score || 0));
      const rankTotal = args.length;
      const qe = campData.goodExcellentCount || 0;
      const avg = campData.weightedAverage || 0;
      const pe = Number(pasteExcluded || 0);
      const wk = args.filter(a => a.category === 'faible' || a.category === 'moyen').length;
      const duplicateGroups = Array.isArray(campData.duplicateGroups) ? campData.duplicateGroups : [];
      const visibleLimit = 5;
      const hasMoreArgs = args.length > visibleLimit;
      return `<div class="ada-camp-section">
        ${!isOpen ? `<div class="ada-section-h2 ada-camp-title ada-camp-title-${camp.toLowerCase()}"><span class="ada-section-icon" aria-hidden="true"></span>${esc(campData.label)}</div>` : ''}
        <div class="ada-camp-summary-stats">
          ${isOpen ? `<div class="ada-camp-summary-line">${args.length} idée${args.length > 1 ? 's' : ''} unique${args.length > 1 ? 's' : ''} évaluée${args.length > 1 ? 's' : ''}</div>` : ''}
          ${!isOpen ? `<div class="ada-camp-summary-line">${qe} idée${qe > 1 ? 's' : ''} retenue${qe > 1 ? 's' : ''} (bonne/excellente) · moyenne pondérée : ${avg}/100</div>` : ''}
          ${!isOpen && wk > 0 ? `<div class="ada-camp-summary-line">${wk} idée${wk > 1 ? 's' : ''} faible${wk > 1 ? 's' : ''} détectée${wk > 1 ? 's' : ''}</div>` : ''}
          ${pe > 0 ? `<div class="ada-camp-summary-line">${pe} idée${pe > 1 ? 's' : ''} copié-collée${pe > 1 ? 's' : ''} exclue${pe > 1 ? 's' : ''} de l'analyse</div>` : ''}
        </div>
        <details class="ada-args-details">
          <summary class="ada-args-summary">Voir les ${args.length} idée${args.length > 1 ? 's' : ''} évaluée${args.length > 1 ? 's' : ''}</summary>
          <div class="ada-args-list">
            ${args.map((arg, index) => argCard(arg, duplicateGroupsForArgument(duplicateGroups, arg.argumentId), index >= visibleLimit, isOpen, index + 1, rankTotal)).join('')}
            <div class="ada-load-more-wrap">
              ${hasMoreArgs ? '<button type="button" class="ada-load-more-btn" data-ada-expanded="0">Charger plus d\'idées</button>' : ''}
              <button type="button" class="ada-load-more-btn ada-panel-close-btn" data-ada-close-panel="1">Masquer</button>
            </div>
          </div>
        </details>
      </div>`;
    }

    let out = '<div class="ada-scoring-report"><div class="ada-report">';

    // Verdict card
    const v = d.verdict;
    if (v && !d.isOpen) {
      const confCls = v.confidence === 'forte' ? 'ada-conf-forte' : v.confidence === 'moyenne' ? 'ada-conf-moyenne' : 'ada-conf-faible';
      out += '<div class="ada-verdict-card">' +
        '<div class="ada-verdict-eyebrow">⚖️ Verdict argumentatif</div>' +
        renderVerdictGauge(v, d.positionA, d.positionB) +
        '<div class="ada-verdict-winner">' + esc(v.winnerLabel) + '</div>' +
        '<div class="ada-verdict-confidence ' + confCls + '">Confiance : ' + esc(v.confidence) + '</div>' +
        (v.caveat ? '<div class="ada-verdict-expl">'  + esc(v.caveat) + '</div>' : '') +
        (v.note   ? '<div class="ada-verdict-note">'  + esc(v.note)   + '</div>' : '') +
        '<div class="ada-verdict-prudence">Ce résultat est provisoire : il évalue la robustesse des arguments présents dans cette arène, pas une vérité définitive.</div>' +
        '<div class="ada-verdict-prudence" style="margin-top:5px;">Le barème d\'évaluation détaillé est disponible <span class="ada-bareme-link" data-ada-bareme="1" style="text-decoration:underline;cursor:pointer;opacity:.85;">en cliquant ici</span>.</div>' +
      '</div>';
    }

    // Scoring report (critères)
    const sr = d.scoringReport;
    if (sr && sr.criteria && sr.criteria.length) {
      let critOut = '';
      for (const c of sr.criteria) {
        const sA = Math.min(100, Math.max(0, Number(c.scoreA) || 0));
        const sB = Math.min(100, Math.max(0, Number(c.scoreB) || 0));
        critOut += '<details class="ada-args-details ada-criterion-details">' +
          '<summary class="ada-args-summary">' +
            '<span>' + _criterionIcon(c.name) + '</span> ' + esc(c.name) +
          '</summary>' +
          '<div class="ada-args-list">' +
            '<div class="ada-criterion-card">' +
              renderCombinedBar(d.positionA, sA, d.positionB, sB) +
              (c.explanation ? '<div class="ada-criterion-arrow">' + md(c.explanation) + '</div>' : '') +
            '</div>' +
          '</div>' +
        '</details>';
      }
      out += '<details class="ada-args-details">' +
        '<summary class="ada-section-h2"><span class="ada-section-icon">📊</span> Évaluation par critère</summary>' +
        '<div class="ada-args-list">' + critOut + '</div>' +
      '</details>';
    }

    // Camp sections
    const b = d.budget;
    out += '<details class="ada-args-details">' +
      '<summary class="ada-section-h2"><span class="ada-section-icon">🧠</span> Évaluation individuelle des idées</summary>' +
      '<div class="ada-args-list">' +
        campSection('A', d.camps.A, b && b.pasteExcludedA, d.isOpen) +
        (!d.isOpen && d.camps.B ? campSection('B', d.camps.B, b && b.pasteExcludedB, false) : '') +
      '</div>' +
    '</details>';

    // Bottom sections (synthèse) — la conclusion est rendue après la section Popularité, tout en bas
    if (sr) {
      const cs = sr.campSummaries;
      if (cs && (cs.A || cs.B)) {
        let summaryOut = '';
        ['A', 'B'].forEach(function(side) {
          const camp = cs[side];
          if (!camp) return;
          const hasContent = (camp.strengths && camp.strengths.length) || (camp.weaknesses && camp.weaknesses.length);
          if (!hasContent) return;
          summaryOut += '<div class="ada-summary-card">' +
            '<div class="ada-summary-label">' + esc(camp.label) + '</div>';
          if (camp.strengths && camp.strengths.length) {
            summaryOut += '<div class="ada-summary-section-title ada-summary-strengths-title">Points forts</div>' +
              '<ul class="ada-arg-list ada-arg-strengths">' +
              camp.strengths.map(function(s){ return '<li>' + md(s) + '</li>'; }).join('') +
              '</ul>';
          }
          if (camp.weaknesses && camp.weaknesses.length) {
            summaryOut += '<div class="ada-summary-section-title ada-summary-weaknesses-title">Points faibles</div>' +
              '<ul class="ada-arg-list ada-arg-weaknesses">' +
              camp.weaknesses.map(function(w){ return '<li>' + md(w) + '</li>'; }).join('') +
              '</ul>';
          }
          summaryOut += '</div>';
        });
        if (summaryOut) {
          out += '<details class="ada-summary-details">' +
            '<summary class="ada-section-h2"><span class="ada-section-icon">📋</span> Synthèse par camp</summary>' +
            '<div class="ada-summary-list">' + summaryOut + '</div>' +
          '</details>';
        }
      }
    }

    out += '</div></div>';

    // Section Popularité vs robustesse — placée avant la conclusion pour que celle-ci reste tout en bas
    if (popularityHtml) out += popularityHtml;

    // Conclusion — toujours la toute dernière chose affichée dans le rapport
    if (sr && sr.conclusion) {
      out += '<div class="ada-scoring-report"><div class="ada-report">' +
        '<div class="ada-finale">' +
          '<span class="ada-finale-label">✍️ Conclusion</span>' +
          md(sr.conclusion) +
        '</div>' +
      '</div></div>';
    }

    return out;
  }

  function renderVerdictGauge(v, posA, posB) {
    const sA = Number(v.scoreA) || 0;
    const sB = Number(v.scoreB) || 0;
    const total = sA + sB;
    const pctA  = total === 0 ? 50 : sA / total * 100;
    const pctB  = total === 0 ? 50 : 100 - pctA;
    const angle = Math.round(((pctB - pctA) / 100) * 74);
    const label = (s) => esc(s);
    const ticks = [
      { side: 'left', pct: '18%',  deg: -28 },
      { side: 'left', pct: '30%',  deg: -18 },
      { side: 'left', pct: '40%',  deg:  -8 },
      { side: 'left', pct: '50%',  deg:   0, center: true },
      { side: 'right', pct: '40%', deg:   8 },
      { side: 'right', pct: '30%', deg:  18 },
      { side: 'right', pct: '18%', deg:  28 },
    ].map(t => {
      const pos = t.side === 'left' ? `left:${t.pct}` : `right:${t.pct}`;
      const rot = t.deg !== 0 ? `;transform:rotate(${t.deg}deg)` : '';
      const cls = t.center ? ' ada-gauge-tick-center' : '';
      return `<span class="ada-gauge-tick${cls}" style="${pos}${rot}"></span>`;
    }).join('');
    return (
      '<div class="ada-gauge-meter">' +
        '<div class="ada-gauge-arc">' + ticks + '</div>' +
        '<div class="ada-gauge-needle" style="--ada-gauge-angle:' + angle + 'deg"></div>' +
        '<div class="ada-gauge-pivot"></div>' +
      '</div>' +
      '<div class="ada-gauge-labels">' +
        '<div class="ada-gauge-label-a"><span class="ada-gauge-position-text">' + label(posA) + '</span><span class="ada-gauge-score">' + sA + '<small>/100</small></span></div>' +
        '<span class="ada-gauge-label-divider" aria-hidden="true"></span>' +
        '<div class="ada-gauge-label-b"><span class="ada-gauge-position-text">' + label(posB) + '</span><span class="ada-gauge-score">' + sB + '<small>/100</small></span></div>' +
      '</div>'
    );
  }

  function _criterionIcon(name) {
    const n = String(name || '').toLowerCase();
    if (n.includes('pertinence'))             return '🎯';
    if (n.includes('clart'))                  return '💡';
    if (n.includes('raisonnement'))           return '🧠';
    if (n.includes('nuance') || n.includes('objection')) return '🛡️';
    if (n.includes('ton'))                    return '🤝';
    return '📊';
  }

  // ── Render helpers ──────────────────────────────────────────────────

  function renderCombinedBar(labelA, scoreA, labelB, scoreB) {
    const a = Math.min(100, Math.max(0, scoreA));
    return (
      '<div class="ada-combined-bar">' +
        '<div class="ada-combined-bar-labels">' +
          '<span class="ada-combined-bar-label-a">' + esc(labelA) + ' ' + a + '%</span>' +
          '<span class="ada-combined-bar-label-b">' + Math.min(100, Math.max(0, scoreB)) + '% ' + esc(labelB) + '</span>' +
        '</div>' +
        '<div class="ada-combined-bar-track">' +
          '<div class="ada-combined-bar-seg-a" style="width:' + a + '%"></div>' +
          '<div class="ada-combined-bar-seg-b"></div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderSourcesTable(header, rows) {
    const cols = header ? header.length : (rows[0] ? rows[0].length : 2);
    const cls = cols >= 3 ? 'ada-card-table-3col' : 'ada-card-table-2col';
    let h = '<div class="ada-card-table ' + cls + '">';
    if (header) {
      h += '<div class="ada-card-table-head">' +
        header.map(function(c){ return '<span>' + esc(c) + '</span>'; }).join('') +
      '</div>';
    }
    rows.forEach(function(r) {
      h += '<div class="ada-card-table-row">' +
        r.map(function(c){ return '<span>' + md(c) + '</span>'; }).join('') +
      '</div>';
    });
    h += '</div>';
    return h;
  }

  const CRIT_ICONS = {
    'réponse': '📊',
    'solidité': '🧠',
    'sources': '🔍',
    'objections': '🛡️',
    'conviction': '🎯',
  };

  function getCritIcon(title) {
    const t = title.toLowerCase();
    for (const k in CRIT_ICONS) {
      if (t.indexOf(k) !== -1) return CRIT_ICONS[k];
    }
    return '📊';
  }

  function parseCombinedScore(trimmed) {
    // "[A label] X % | [B label] Y %"
    const m = trimmed.match(/^(.*?)\s+(\d+)\s*%\s*\|\s*(.*?)\s+(\d+)\s*%/);
    if (m) return { labelA: m[1].trim(), scoreA: parseInt(m[2], 10), labelB: m[3].trim(), scoreB: parseInt(m[4], 10) };
    return null;
  }

  // ── Main parser ─────────────────────────────────────────────────────

  function renderScoringReport(raw) {
    const lines = String(raw || '').split('\n');
    let out = '<div class="ada-scoring-report"><div class="ada-report">';

    let section = null;

    // Verdict state
    let vWinner = '', vConfiance = '', vScoreA = 0, vScoreB = 0;
    let vLabelA = '', vLabelB = '', vExplLines = [], vInVerdict = false;

    // Criterion state
    let cTitle = '', cIcon = '', cLabelA = '', cLabelB = '';
    let cScoreA = 0, cScoreB = 0, cArrow = '', cInCard = false;

    // Table state
    let tHeader = null, tRows = [];

    function flushVerdict() {
      if (!vInVerdict) return;
      vInVerdict = false;
      const confLow = vConfiance.toLowerCase();
      const confCls = confLow.indexOf('forte') !== -1 ? 'ada-conf-forte'
                    : confLow.indexOf('moyenne') !== -1 ? 'ada-conf-moyenne'
                    : 'ada-conf-faible';
      out += '<div class="ada-verdict-card">' +
        '<div class="ada-verdict-eyebrow">⚖️ Verdict argumentatif</div>' +
        '<div class="ada-verdict-winner">' + esc(vWinner) + '</div>' +
        '<div class="ada-verdict-scores-row">' +
          '<span class="ada-verdict-score-a">' + vScoreA + '%</span>' +
          '<span class="ada-verdict-vs">vs</span>' +
          '<span class="ada-verdict-score-b">' + vScoreB + '%</span>' +
        '</div>' +
        (vConfiance ? '<div class="ada-verdict-confidence ' + confCls + '">Confiance : ' + esc(vConfiance) + '</div>' : '') +
        (vLabelA && vLabelB ? renderCombinedBar(vLabelA, vScoreA, vLabelB, vScoreB) : '') +
        (vExplLines.length ? '<div class="ada-verdict-expl">' + vExplLines.map(md).join(' ') + '</div>' : '') +
        '<div class="ada-verdict-prudence">Ce résultat est provisoire : il évalue la robustesse des arguments présents dans cette arène, pas une vérité définitive.</div>' +
      '</div>';
    }

    function flushCriterion() {
      if (!cInCard) return;
      cInCard = false;
      out += '<div class="ada-criterion-card">' +
        '<div class="ada-criterion-header">' +
          '<span class="ada-criterion-icon">' + cIcon + '</span>' +
          '<span class="ada-criterion-title">' + esc(cTitle) + '</span>' +
        '</div>' +
        (cLabelA && cLabelB ? renderCombinedBar(cLabelA, cScoreA, cLabelB, cScoreB) : '') +
        (cArrow ? '<div class="ada-criterion-arrow">' + md(cArrow) + '</div>' : '') +
      '</div>';
    }

    function flushTable() {
      if (!tRows.length) return;
      out += renderSourcesTable(tHeader, tRows);
      tHeader = null; tRows = [];
    }

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const t = line.trim();

      // ── Major section headings ──────────────────────────
      if (t === '# Verdict argumentatif') {
        section = 'verdict';
        vInVerdict = true; vWinner = ''; vConfiance = '';
        vScoreA = 0; vScoreB = 0; vLabelA = ''; vLabelB = ''; vExplLines = [];
        i++; continue;
      }

      if (t.indexOf('## Position gagnante') === 0) {
        const colon = t.indexOf(':');
        if (colon !== -1) vWinner = t.slice(colon + 1).trim();
        i++; continue;
      }

      if (t.indexOf('## Barres d') === 0) {
        flushVerdict();
        out += '<div class="ada-section-h2"><span class="ada-section-icon">📊</span> Barres d\'évaluation</div>';
        section = 'barres';
        i++; continue;
      }

      if (t === '## Lecture des sources') {
        flushVerdict();
        flushCriterion();
        out += '<div class="ada-section-h2"><span class="ada-section-icon">📚</span> Lecture des sources</div>';
        section = 'sources';
        tHeader = null; tRows = [];
        i++; continue;
      }

      if (t.indexOf('## Ce qui manque') === 0) {
        flushTable();
        out += '<div class="ada-section-h2"><span class="ada-section-icon">🧩</span> Ce qui manque pour trancher mieux</div>';
        section = 'manque';
        tHeader = null; tRows = [];
        i++; continue;
      }

      if (t === '## Phrase finale') {
        flushTable();
        section = 'finale';
        i++; continue;
      }

      // ── Separators ─────────────────────────────────────
      if (t === '---' || t === '***') {
        if (section === 'verdict') { flushVerdict(); section = null; }
        i++; continue;
      }

      // ── Verdict section ─────────────────────────────────
      if (section === 'verdict') {
        // **Score global : X % / Y %**
        const sgm = t.match(/Score global\s*:\s*(\d+)\s*%\s*\/\s*(\d+)\s*%/);
        if (sgm) { vScoreA = parseInt(sgm[1], 10); vScoreB = parseInt(sgm[2], 10); i++; continue; }
        // **Confiance : ...**
        const cfm = t.match(/Confiance\s*:\s*(.+)/);
        if (cfm) { vConfiance = cfm[1].replace(/\*\*/g, '').trim(); i++; continue; }
        // Score line "[A] X % | [B] Y %"
        const sc = parseCombinedScore(t);
        if (sc && !vLabelA) {
          vLabelA = sc.labelA; vLabelB = sc.labelB;
          if (!vScoreA) { vScoreA = sc.scoreA; vScoreB = sc.scoreB; }
          i++; continue;
        }
        // Bar line (skip — data already extracted)
        if (/[█░]/.test(t)) { i++; continue; }
        // Explanation text (non-empty, not a heading)
        if (t && t[0] !== '#' && t[0] !== '|') {
          const clean = t.replace(/^\*\*|\*\*$/g, '').trim();
          if (clean) vExplLines.push(clean);
        }
        i++; continue;
      }

      // ── Barres section ──────────────────────────────────
      if (section === 'barres') {
        if (t.indexOf('### ') === 0) {
          flushCriterion();
          cTitle = t.slice(4).trim();
          cIcon = getCritIcon(cTitle);
          cLabelA = ''; cLabelB = ''; cScoreA = 0; cScoreB = 0; cArrow = '';
          cInCard = true;
          i++; continue;
        }
        if (cInCard) {
          // Score line
          const sc = parseCombinedScore(t);
          if (sc) { cLabelA = sc.labelA; cLabelB = sc.labelB; cScoreA = sc.scoreA; cScoreB = sc.scoreB; i++; continue; }
          // Bar line (skip)
          if (/[█░]/.test(t)) { i++; continue; }
          // "| Lecture rapide |" table → extract body text
          if (t === '| Lecture rapide |' || t.toLowerCase().indexOf('lecture rapide') !== -1 && t[0] === '|') {
            i++; // skip separator |---|
            if (i < lines.length && /^\|[\s\-:]+\|/.test(lines[i].trim())) i++;
            if (i < lines.length && lines[i].trim()[0] === '|') {
              const cells = lines[i].trim().split('|').slice(1, -1).map(function(c){ return c.trim(); });
              if (cells[0]) cArrow = cells[0];
              i++;
            }
            continue;
          }
        }
        i++; continue;
      }

      // ── Sources / manque tables ─────────────────────────
      if (section === 'sources' || section === 'manque') {
        if (t[0] === '|') {
          if (/^\|[\s\-:]+\|/.test(t)) { i++; continue; } // separator row
          const cells = t.split('|').slice(1, -1).map(function(c){ return c.trim(); });
          if (!tHeader) tHeader = cells;
          else tRows.push(cells);
        }
        i++; continue;
      }

      // ── Phrase finale ────────────────────────────────────
      if (section === 'finale') {
        if (t && t[0] !== '#' && t !== '---') {
          out += '<div class="ada-finale">' +
            '<span class="ada-finale-label">✍️ Conclusion</span>' +
            md(t) +
          '</div>';
          section = null;
        }
        i++; continue;
      }

      i++;
    }

    // Flush any pending state
    flushVerdict();
    flushCriterion();
    flushTable();

    out += '</div></div>';
    return out;
  }

  function renderPopularityAnalysis(pop, analysis) {
    if (!pop || pop.version !== 2) return '';

    if (pop.hasEnoughData === false) {
      const totalArgs = Number(pop.totalArgs || 0);
      const totalVotes = Number(pop.totalVotes || 0);
      let message = "Analyse indisponible : il faut au moins deux idées effectivement notées pour comparer popularité et robustesse argumentative.";
      if (pop.reason === 'no_scored_arguments') {
        message = "Analyse indisponible : aucune idée n'a encore été effectivement notée par l'IA pour cette arène.";
      }
      const details = [];
      if (pop.reason === 'not_enough_scored_arguments') details.push(totalArgs + ' idée' + (totalArgs > 1 ? 's' : '') + ' notée' + (totalArgs > 1 ? 's' : ''));
      if (totalVotes > 0) details.push(totalVotes + ' voix détectée' + (totalVotes > 1 ? 's' : ''));
      return '<div class="ada-scoring-report"><div class="ada-report">' +
        '<div class="ada-section-h2"><span class="ada-section-icon">⚡</span> Popularité vs robustesse argumentative</div>' +
        '<div class="ada-empty">' + esc(message) + (details.length ? '<br><small>' + esc(details.join(' · ')) + '</small>' : '') + '</div>' +
      '</div></div>';
    }

    let out = '<div class="ada-scoring-report"><div class="ada-report">';

    // Badge de label d'écart — couleur dérivée du statut argumentatif (code déterministe)
    const GAP_BADGE_CLS = {
      weak:      'ada-pop-type-weak',
      average:   'ada-pop-type-average',
      robust:    'ada-pop-type-robust',
      excellent: 'ada-pop-type-both'
    };
    // Robustness display (server-side enum → display label + CSS)
    const ROBUST_DISPLAY = {
      excellent: { label: 'excellent',  cls: 'ada-cat-excellent' },
      robust:    { label: 'robuste',    cls: 'ada-cat-bon'       },
      average:   { label: 'moyen',      cls: 'ada-cat-moyen'     },
      weak:      { label: 'faible',     cls: 'ada-cat-faible'    }
    };

    // Carte d'écart — un item de l'une des deux listes (entièrement déterministe côté code)
    function renderGapCard(gap) {
      const badgeCls = GAP_BADGE_CLS[gap.robustness] || '';
      const robust   = ROBUST_DISPLAY[gap.robustness] || { label: gap.robustness || '', cls: '' };
      let html = '<div class="ada-arg-card">';
      html += '<div class="ada-arg-header">';
      if (gap.label) html += '<span class="ada-arg-cat ' + badgeCls + '">' + esc(gap.label) + '</span>';
      html += '<span class="ada-arg-cat ' + robust.cls + '">' + esc(robust.label) + '</span>';
      html += '</div>';
      if (gap.argumentText) html += '<div class="ada-arg-text">"' + esc(gap.argumentText) + '"</div>';
      const meta = [];
      if (gap.votes !== undefined) meta.push(gap.votes + ' voix');
      if (gap.score !== undefined) meta.push(gap.score + '/100');
      if (meta.length) html += '<div class="ada-arg-breakdown">' + meta.join(' · ') + '</div>';
      html += '</div>';
      return html;
    }

    // Sous-section titrée — n'est rendue que si la liste contient au moins un élément
    function renderGapSection(title, list) {
      if (!list.length) return '';
      let html = '<div class="ada-summary-section-title">' + esc(title) + '</div>';
      list.forEach(function(gap) { html += renderGapCard(gap); });
      return html;
    }

    const isOpen = analysis && analysis.isOpen;
    const labelA = isOpen ? 'Contributions' : ((analysis && analysis.camps && analysis.camps.A && analysis.camps.A.label) || (analysis && analysis.positionA) || 'Camp A');
    const labelB = isOpen ? '' : ((analysis && analysis.camps && analysis.camps.B && analysis.camps.B.label) || (analysis && analysis.positionB) || 'Camp B');

    let inner = '';

    // Bloc d'introduction — même style que les explications de critère, icônes voix/cerveau au lieu de l'ampoule générique
    inner += '<div class="ada-criterion-arrow ada-pop-intro">' +
      '<i class="fa-solid fa-check-to-slot ada-pop-intro-icon" aria-hidden="true"></i> ' +
      'Les voix indiquent quelles idées convainquent le plus les utilisateurs. La note argumentative indique quelles idées sont les plus solides sur le plan du raisonnement <span aria-hidden="true">🧠</span>. Ces deux résultats ne mesurent pas la même chose.<br><br>⚠️ Il est important de noter que la popularité d\'un argument ne garantit pas sa validité ou sa solidité argumentative.' +
    '</div>';

    // Constat + analyse par position — un seul cadre commun (sous-parties distinguées par titres/séparateurs internes)
    const hasMainFinding = !!pop.mainFinding;
    const hasCampA       = !!pop.campAObservation;
    const hasCampB       = !isOpen && !!pop.campBObservation;
    const hasByPosition  = hasCampA || hasCampB;

    if (hasMainFinding || hasByPosition) {
      let card = '';
      if (hasMainFinding) {
        card += '<span class="ada-finale-label">Constat principal</span>' +
                '<div class="ada-pop-main-finding">' + esc(pop.mainFinding) + '</div>';
      }
      if (hasMainFinding && hasByPosition) {
        card += '<div class="ada-pop-divider"></div>';
      }
      if (hasByPosition) {
        if (hasCampA) {
          card += '<div class="ada-pop-position-row">' +
                    '<span class="ada-finale-label">' + esc(labelA) + '</span>' +
                    '<div class="ada-pop-position-text">' + esc(pop.campAObservation) + '</div>' +
                  '</div>';
        }
        if (hasCampB) {
          card += '<div class="ada-pop-position-row">' +
                    '<span class="ada-finale-label">' + esc(labelB) + '</span>' +
                    '<div class="ada-pop-position-text">' + esc(pop.campBObservation) + '</div>' +
                  '</div>';
        }
      }
      inner += '<div class="ada-pop-summary-card">' + card + '</div>';
    }

    // Deux listes distinctes — entièrement calculées et plafonnées côté code (jamais par l'IA)
    const popularButWeakOrAverage = Array.isArray(pop.popularButWeakOrAverage) ? pop.popularButWeakOrAverage : [];
    const robustButUnsupported    = Array.isArray(pop.robustButUnsupported)    ? pop.robustButUnsupported    : [];

    if (popularButWeakOrAverage.length === 0 && robustButUnsupported.length === 0) {
      inner += '<div class="ada-empty">Aucun écart vraiment significatif entre adhésion et solidité argumentative ne ressort clairement des données disponibles.</div>';
    } else {
      inner += renderGapSection('Populaires, mais faibles ou moyens argumentativement', popularButWeakOrAverage);
      inner += renderGapSection('Peu populaires, mais robustes argumentativement', robustButUnsupported);
    }

    out += '<details class="ada-args-details">' +
      '<summary class="ada-section-h2"><span class="ada-section-icon">⚡</span> Popularité vs robustesse argumentative</summary>' +
      '<div class="ada-args-list">' +
        inner +
        '<div class="ada-load-more-wrap"><button type="button" class="ada-load-more-btn ada-panel-close-btn" data-ada-close-panel="1">Masquer</button></div>' +
      '</div>' +
    '</details>';

    out += '</div></div>';
    return out;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return date + ' à ' + time;
  }

  function scrollToAnalysisElement(element) {
    if (!element) return;
    const offset = window.matchMedia('(max-width: 768px)').matches ? 160 : 24;
    const top = element.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  function bindLoadMoreArguments(root) {
    if (!root || root.dataset.adaLoadMoreBound === '1') return;
    root.dataset.adaLoadMoreBound = '1';
    root.addEventListener('click', function (event) {
      const btn = event.target.closest('.ada-load-more-btn');
      if (!btn || !root.contains(btn)) return;
      const list = btn.closest('.ada-args-list');
      if (!list) return;
      const isExpanded = btn.dataset.adaExpanded === '1';
      if (isExpanded) {
        list.querySelectorAll('.ada-arg-card:nth-of-type(n+6)').forEach(function (card) {
          card.classList.add('ada-arg-extra-hidden');
        });
        btn.dataset.adaExpanded = '0';
        btn.classList.remove('is-collapse');
        btn.textContent = 'Charger plus d\'idées';
        scrollToAnalysisElement(btn.closest('.ada-args-details') || list);
        return;
      }
      list.querySelectorAll('.ada-arg-extra-hidden').forEach(function (card) {
        card.classList.remove('ada-arg-extra-hidden');
      });
      btn.dataset.adaExpanded = '1';
      btn.style.display = 'none';
    });
  }

  // ── Fetch stored analysis ────────────────────────────────────────────
  async function openReport(debateId, prefetched, opts = {}) {
    const panel    = document.getElementById('ada-panel');
    const body     = document.getElementById('ada-body');
    const useAnim  = typeof showAiAnalysisAnimation === 'function';

    panel.style.display = 'block';
    scrollToAnalysisElement(panel);
    body.innerHTML = '';
    if (useAnim) showAiAnalysisAnimation();
    else body.innerHTML = '<span class="ada-loading">Chargement…</span>';

    let applyContent;
    try {
      let r, json;
      if (prefetched) {
        ({ r, json } = prefetched);
      } else {
        ({ r, json } = await fetchStoredAnalysis(debateId));
      }
      if (!r.ok) {
        applyContent = () => { body.innerHTML = `<span class="ada-error">Erreur : ${esc(json.error || r.statusText)}</span>`; };
      } else if (json.raw) {
        applyContent = () => {
          const header = json.generatedAt
            ? `<div class="ada-date">Analyse générée le ${esc(fmtDate(json.generatedAt))}</div>`
            : '';
          let parsed = null;
          try { parsed = JSON.parse(json.raw); } catch (_) {}
          let popularityParsed = null;
          try { if (json.popularityRaw) popularityParsed = JSON.parse(json.popularityRaw); } catch (_) {}
          body.innerHTML = header + (parsed && parsed.version === 2
            ? renderNewAnalysis(parsed, popularityParsed ? renderPopularityAnalysis(popularityParsed, parsed) : '')
            : renderScoringReport(json.raw));
          bindLoadMoreArguments(body);
        };
      } else if (json.status === 'scheduled' || json.status === 'generating') {
        applyContent = () => { body.innerHTML = '<span class="ada-empty">Analyse IA en préparation — disponible prochainement.</span>'; };
      } else if (json.status === 'failed') {
        applyContent = () => { body.innerHTML = '<span class="ada-error">La génération de l\'analyse a échoué.</span>'; };
      } else {
        if (isAdmin()) {
          applyContent = () => {
            body.innerHTML = '<span class="ada-empty">Aucune analyse disponible pour cette arène.</span>'
              + '<div style="margin-top:14px;"><button type="button" id="ada-generate-now-btn" style="padding:8px 18px;background:#111;color:#fff;border:none;border-radius:8px;font:inherit;font-size:13px;cursor:pointer;">Générer l\'analyse IA maintenant</button></div>';
            const genBtn = body.querySelector('#ada-generate-now-btn');
            if (genBtn) genBtn.addEventListener('click', () => regenerate(debateId));
          };
        } else {
          applyContent = () => { body.innerHTML = '<span class="ada-empty">Aucune analyse disponible pour cette arène.</span>'; };
        }
      }
    } catch (err) {
      applyContent = () => { body.innerHTML = `<span class="ada-error">Erreur : ${esc(err.message)}</span>`; };
    }

    const finalize = () => {
      applyContent();
      // Notification "arbitrage IA disponible" : c'est ici, une fois le rapport
      // réellement visible, qu'on masque l'overlay de transition côté script.js
      // (cf. pendingAiReportNotificationTransition) — pas avant.
      if (opts.fromNotification && typeof window.hideNotificationTransitionOverlay === 'function') {
        window.hideNotificationTransitionOverlay();
      }
    };

    if (useAnim) hideAiAnalysisAnimation(finalize);
    else finalize();
  }

  // ── Regenerate analysis (admin only) ────────────────────────────────
  async function regenerate(debateId) {
    const regenBtn = document.getElementById('ada-regen-btn');
    const panel    = document.getElementById('ada-panel');
    const body     = document.getElementById('ada-body');

    if (panel) panel.style.display = 'block';
    if (regenBtn) { regenBtn.disabled = true; regenBtn.textContent = 'Génération…'; }
    body.innerHTML = '<span class="ada-loading">Analyse IA en cours… (peut prendre 30s)</span>';

    try {
      const r    = await fetch('/api/admin/analyze-debate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': getAdminToken() },
        body:    JSON.stringify({ debateId })
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        body.innerHTML = `<span class="ada-error">Erreur : ${esc(json.error || r.statusText)}</span>`;
        return false;
      }
      rememberStoredAnalysis(debateId, json);
      const now = new Date().toISOString();
      let parsedRegen = null;
      try { parsedRegen = JSON.parse(json.raw || ''); } catch (_) {}
      let popularityRegen = null;
      try { if (json.popularityRaw) popularityRegen = JSON.parse(json.popularityRaw); } catch (_) {}
      body.innerHTML = `<div class="ada-date">Analyse générée le ${esc(fmtDate(now))}</div>` +
        (parsedRegen && parsedRegen.version === 2
          ? renderNewAnalysis(parsedRegen, popularityRegen ? renderPopularityAnalysis(popularityRegen, parsedRegen) : '')
          : renderScoringReport(json.raw || ''));
      bindLoadMoreArguments(body);
      return true;
    } catch (err) {
      body.innerHTML = `<span class="ada-error">Erreur : ${esc(err.message)}</span>`;
      return false;
    } finally {
      if (regenBtn) { regenBtn.disabled = false; regenBtn.textContent = 'Regénérer'; }
    }
  }

  // ── Countdown ────────────────────────────────────────────────────────
  async function initCountdown(debateId) {
    const slot = document.getElementById('debate-ai-countdown-slot');
    const progressSlot = document.getElementById('debate-ai-progress-slot') || slot;
    if (!slot && !progressSlot) return;
    if (slot) slot.innerHTML = '';
    if (progressSlot && progressSlot !== slot) progressSlot.innerHTML = '';

    try {
      const { r, json } = await fetchStoredAnalysis(debateId);
      if (!r.ok) return;

      const hasPending = (json.status === 'scheduled' || json.status === 'generating') && !!json.scheduledAt;
      // Une régénération peut être programmée alors qu'un rapport précédent existe
      // déjà (cf. _scheduleAnalysisIfNeeded côté serveur) : dans ce cas, seul le
      // compte à rebours est affiché ici — le rapport existant reste consultable
      // via le bouton "Voir le rapport" du bloc d'analyse, pas via ce badge.
      const hasReady = !hasPending && !!(json.raw || json.status === 'ready');

      if (hasReady) {
        const readyBadge = document.createElement('span');
        readyBadge.className = 'ada-countdown-ready';
        readyBadge.style.cursor = 'pointer';
        readyBadge.title = "Voir l'analyse";
        readyBadge.innerHTML = '<img src="/sablier2-64.png" alt="" style="width:16px;height:16px;vertical-align:middle;margin-right:4px;">Analyse IA disponible';
        readyBadge.addEventListener('click', () => {
          const target = document.getElementById('debate-ai-analysis-slot');
          scrollToAnalysisElement(target);
          setTimeout(() => {
            const triggerBtn = document.getElementById('ada-trigger-btn');
            if (triggerBtn) triggerBtn.click();
          }, 400);
        });
        if (slot) slot.appendChild(readyBadge);
      }

      if (hasPending) {
        const target = new Date(json.scheduledAt).getTime();
        const badge  = document.createElement('span');
        badge.className = 'ada-countdown-badge';
        if (slot) slot.appendChild(badge);
        _visObs.observe(badge);

        const tick = () => {
          const secs = Math.max(0, Math.round((target - Date.now()) / 1000));
          if (secs <= 0) {
            badge.textContent = 'Mise à jour de l\'analyse en cours…';
          } else {
            badge.textContent = 'Prochaine analyse dans : ' + String(secs).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' secondes';
            setTimeout(tick, 1000);
          }
        };
        tick();
      }

      if (!hasPending && Number.isFinite(json.contributionsRemaining) && json.contributionsRemaining > 0) {
        const n = json.contributionsRemaining;
        const grid = json.scoringGrid || null;
        const progress = document.createElement('span');
        progress.className = 'ada-countdown-progress';
        progress.style.cursor = 'pointer';
        progress.title = "Comment l'IA évalue les contributions";
        progress.textContent = `Encore ${n} contribution${n > 1 ? 's' : ''} avant ${hasReady ? 'la prochaine analyse IA' : "le lancement de l'analyse IA"}`;
        // Avant la 1re analyse, aucun barème stabilisé n'existe : on utilise la
        // config réelle de l'arène (libre vs à position) renvoyée par le serveur,
        // plutôt que lastScoringGrid qui ne reflète qu'un rapport déjà généré.
        progress.addEventListener('click', () => { if (grid) lastScoringGrid = grid; _openBaremeModal(); });
        if (progressSlot) progressSlot.appendChild(progress);
      }

      if (slot) observeAnimated(slot);
      if (progressSlot && progressSlot !== slot) observeAnimated(progressSlot);
    } catch (_) {}
  }

  // ── Init ─────────────────────────────────────────────────────────────
  function _baremeCriteriaSectionHtml() {
    const grid = lastScoringGrid;
    const isCustom = grid && grid.scoringMode === 'custom';
    const isOpenType = !isCustom && grid && grid.type === 'open';

    if (isOpenType) {
      return `<h3>2. Chaque idée distincte est notée sur 100</h3>
      <p>Cette arène est libre (sans camps opposés) : chaque idée conservée reçoit une note de qualité argumentative sur 100. Si une URL est fournie, elle peut ajouter un bonus source jusqu'à +10 points, mais le score final reste toujours plafonné à 100.</p>
      <ul>
        <li><strong>Pertinence par rapport au sujet : 20 points</strong><br>L'idée répond-elle vraiment au sujet posé ?</li>
        <li><strong>Clarté : 15 points</strong><br>L'idée est-elle compréhensible et bien formulée ?</li>
        <li><strong>Solidité ou justification : 25 points</strong><br>L'idée est-elle logique, cohérente et bien étayée ?</li>
        <li><strong>Apport à l'arène : 25 points</strong><br>L'idée apporte-t-elle un éclairage ou un élément nouveau au débat ?</li>
        <li><strong>Nuance : 10 points</strong><br>L'idée reconnaît-elle les risques, objections ou limites ?</li>
        <li><strong>Ton : 5 points</strong><br>L'idée reste-t-elle constructive, sans insulte ni attaque ?</li>
        <li><strong>Sources (URL fournie) : jusqu'à 10 points</strong><br>Une source fiable et pertinente renforce la crédibilité, mais ne remplace jamais la qualité du raisonnement.</li>
      </ul>
      <div class="ada-bareme-rule"><strong>Total qualité argumentative : 100 points · Bonus source possible : jusqu'à +10 points · Score final plafonné à 100.</strong></div>`;
    }

    if (!isCustom) {
      return `<h3>2. Chaque idée distincte est notée sur 100</h3>
      <p>Chaque idée conservée reçoit une note de qualité argumentative sur 100. Si une URL est fournie, elle peut ajouter un bonus source jusqu'à +10 points, mais le score final reste toujours plafonné à 100.</p>
      <ul>
        <li><strong>Pertinence par rapport à la question : 20 points</strong><br>L'idée répond-elle vraiment à la question posée ?</li>
        <li><strong>Clarté de la thèse : 15 points</strong><br>L'idée est-elle compréhensible et bien formulée ?</li>
        <li><strong>Qualité du raisonnement : 25 points</strong><br>L'idée est-elle logique, cohérente et bien construite ?</li>
        <li><strong>Précision / mécanisme concret : 15 points</strong><br>L'idée donne-t-elle un mécanisme, un exemple ou une conséquence précise ?</li>
        <li><strong>Nuance et prise en compte des limites : 10 points</strong><br>L'idée reconnaît-elle les risques, objections ou limites ?</li>
        <li><strong>Ton : 5 points</strong><br>L'idée reste-t-elle constructive, sans insulte ni attaque ?</li>
        <li><strong>Sources (URL fournie) : jusqu'à 10 points</strong><br>Une source fiable et pertinente renforce la crédibilité, mais ne remplace jamais la qualité du raisonnement.</li>
      </ul>
      <div class="ada-bareme-rule"><strong>Total qualité argumentative : 100 points · Bonus source possible : jusqu'à +10 points · Score final plafonné à 100.</strong></div>`;
    }

    if (grid.axisHidden) {
      return `<h3>2. Cette arène utilise un barème personnalisé</h3>
      <p>Le créateur de cette arène a défini une orientation propre, mais a choisi de ne pas la dévoiler publiquement. Agôn applique malgré tout cette orientation, stabilisée en un barème unique sur 100 points, à toutes les contributions de l'arène — sans la grille générique ni le bonus source habituel.</p>
      <div class="ada-bareme-rule"><strong>Total : 100 points · Score final = total obtenu sur le barème personnalisé, sans bonus source séparé.</strong></div>`;
    }

    const orientation = esc(grid.axisSource || '');
    const ruleLines = String(grid.customRubric || '')
      .split('\n')
      .map((line) => line.replace(/^[-•]\s*/, '').trim())
      .filter(Boolean)
      .map((line) => `<li>${esc(line)}</li>`)
      .join('');
    return `<h3>2. Cette arène utilise un barème personnalisé</h3>
      <p>Le créateur de cette arène a défini une orientation propre${orientation ? ` : <strong>« ${orientation} »</strong>` : ''}. Agôn a stabilisé cette orientation en un barème unique, sur 100 points, appliqué à l'identique à toutes les contributions de l'arène — sans la grille générique ni le bonus source habituel.</p>
      ${ruleLines ? `<ul>${ruleLines}</ul>` : ''}
      <div class="ada-bareme-rule"><strong>Total : 100 points · Score final = total obtenu sur le barème personnalisé, sans bonus source séparé.</strong></div>`;
  }

  function _openBaremeModal() {
    // Une arène libre n'a pas de camps : aucun verdict comparatif n'y est calculé
    // (cf. `!d.isOpen` qui masque la carte verdict dans renderNewAnalysis) — les
    // idées y sont seulement notées et classées individuellement.
    const isOpenArena = !!(lastScoringGrid && lastScoringGrid.type === 'open');

    const overlay = document.createElement('div');
    overlay.className = 'ada-bareme-overlay';
    overlay.innerHTML = `<div class="ada-bareme-modal">
      <button class="ada-bareme-close" aria-label="Fermer">✕</button>
      <h2>Comment Agôn évalue les idées ?</h2>
      <p>${isOpenArena
        ? "Agôn ne cherche pas à dire qui a « raison » de manière absolue. Il indique seulement quelles idées sont, dans cette arène libre, les plus solides argumentativement."
        : "Agôn ne cherche pas à dire qui a « raison » de manière absolue. Il indique seulement quel camp présente, dans une arène donnée, les idées les plus solides."}</p>
      <p><strong>L'analyse IA n'évalue pas la vérité absolue d'une opinion. Elle évalue la qualité argumentative des contributions selon des critères publics — c'est une analyse contestable, pas un verdict de vérité.</strong></p>

      <h3>1. Les doublons sont regroupés</h3>
      <p>${isOpenArena
        ? "Avant la notation, Agôn repère les idées qui défendent la même idée avec la même justification principale. Quand plusieurs idées sont de vrais doublons, elles sont regroupées. Cela évite qu'une idée paraisse plus soutenue simplement parce qu'elle est répétée plusieurs fois."
        : "Avant la notation, Agôn repère les idées qui défendent la même idée avec la même justification principale. Quand plusieurs idées sont de vrais doublons, elles sont regroupées. Cela évite qu'un camp soit avantagé simplement parce qu'une même idée est répétée plusieurs fois."}</p>

      ${_baremeCriteriaSectionHtml()}

      <h3>3. Les idées sont classées par niveau</h3>
      <ul>
        <li><strong>0 à 49 : idée faible</strong> — peu pertinente, confuse, très fragile ou essentiellement émotionnelle.</li>
        <li><strong>50 à 69 : idée moyenne</strong> — contient une idée compréhensible, mais incomplète, peu étayée ou trop approximative.</li>
        <li><strong>70 à 84 : bonne idée</strong> — claire, pertinente et raisonnablement solide.</li>
        <li><strong>85 à 100 : excellente idée</strong> — très solide, bien construite, nuancée et bien appuyée.</li>
      </ul>

      ${(lastScoringGrid && lastScoringGrid.scoringMode === 'custom') ? '' : `<h3>4. Les sources renforcent, elles ne remplacent pas</h3>
      <p>Quand une idée contient une URL, Agôn évalue la qualité de la source et peut ajouter jusqu'à 10 points. Une source fiable et directement liée à l'argument améliore le score, mais une idée mal raisonnée reste pénalisée même avec un excellent lien. À l'inverse, une idée sans URL peut atteindre 100 si elle est claire, logique et bien construite.</p>`}

      ${isOpenArena ? `
      <h3>5. Les idées sont classées, sans camps ni verdict</h3>
      <p>Une arène libre n'oppose pas deux camps : il n'y a donc pas de verdict global. Chaque idée est simplement classée selon son propre score, de la plus solide à la plus faible.</p>

      <h3>En résumé</h3>
      <p>Agôn valorise la qualité de chaque idée plutôt que la quantité brute. Les répétitions sont regroupées, chaque idée est notée selon un barème transparent, et les idées sont classées du score le plus élevé au plus faible — sans comparaison entre camps.</p>
      ` : `
      <h3>5. Seules les bonnes et excellentes idées comptent pour le verdict</h3>
      <p>Les idées faibles et moyennes peuvent apparaître dans l'analyse, mais elles ne participent pas au calcul du verdict final.</p>
      <div class="ada-bareme-rule">
        bonne idée = coefficient 1<br>
        excellente idée = coefficient 2<br>
        idée faible ou moyenne = coefficient 0
      </div>

      <h3>6. Agôn calcule le score de chaque camp</h3>
      <p>Pour chaque camp, Agôn calcule une moyenne pondérée des bonnes et excellentes idées. Les excellentes comptent double. Le camp qui obtient le meilleur score est désigné comme ayant l'avantage.</p>

      <h3>7. Une réserve est ajoutée si l'arène est déséquilibrée</h3>
      <p>Si un camp a plus du double d'idées solides que l'autre, le résultat est affiché avec prudence. Un camp peut avoir une excellente idée isolée face à de nombreuses bonnes idées dans l'autre camp — Agôn signale alors que le résultat doit être interprété prudemment.</p>

      <h3>8. Ce que signifie le verdict</h3>
      <p>Le verdict ne signifie pas que le camp gagnant a forcément raison. Il signifie seulement que, parmi les contributions analysées, ce camp présente en moyenne les idées distinctes les plus solides selon le barème d'Agôn.</p>

      <h3>En résumé</h3>
      <p>Agôn valorise la qualité des idées plutôt que la quantité brute. Les répétitions sont regroupées, chaque idée est notée selon un barème transparent, les idées faibles ne pèsent pas dans le verdict, et les excellentes idées sont davantage valorisées. Lorsque la comparaison entre les camps est trop déséquilibrée, Agôn l'indique clairement.</p>
      `}
    </div>`;

    const panelCloseBtn = document.getElementById('ada-close-btn');
    if (panelCloseBtn) panelCloseBtn.style.visibility = 'hidden';

    // Masquer la flèche de fermeture iframe dans le document parent
    const _syncParent = (open) => {
      if (window.parent !== window) {
        try { window.parent.postMessage({ type: 'agon:argument-form-visibility', open }, '*'); } catch (_) {}
      }
    };
    _syncParent(true);

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (panelCloseBtn) panelCloseBtn.style.visibility = '';
      _syncParent(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    overlay.querySelector('.ada-bareme-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  }

  async function init() {
    const debateId = getDebateId();
    if (!debateId) return;

    const wantsReport = new URLSearchParams(location.search).get('highlight') === 'ai-report';

    injectStyles();

    // Délégation clic sur le lien barème (présent dans le rapport dynamique)
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-ada-bareme]')) _openBaremeModal();
      if (e.target.closest('[data-ada-close-panel]')) {
        const details = e.target.closest('details');
        if (details) {
          details.removeAttribute('open');
          details.open = false;
          const target = details.querySelector('summary') || details;
          const isMobile = window.matchMedia('(max-width: 768px)').matches;
          const offset = isMobile ? 420 : 320;
          const targetTop = Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset);
          const startTop = window.scrollY;
          const distance = targetTop - startTop;
          const duration = isMobile ? 900 : 700;
          const startTime = performance.now();
          const ease = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
          (function step(now) {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            window.scrollTo(0, startTop + distance * ease(progress));
            if (progress < 1) requestAnimationFrame(step);
          })(startTime);
        }
      }
    });

    initCountdown(debateId);

    const slot = document.getElementById('debate-ai-analysis-slot');
    if (!slot) return;

    const closeReportPanel = () => {
      document.getElementById('ada-panel').style.display = 'none';
      document.querySelectorAll('#ada-panel details').forEach(d => { d.removeAttribute('open'); d.open = false; });
      scrollToAnalysisElement(document.getElementById('ada-trigger-btn'));
    };

    const collapseFooter = `
        <div class="ada-collapse-wrap">
          <button type="button" id="ada-collapse-btn" class="ada-collapse-btn">Masquer l’analyse IA</button>
        </div>`;

    let hasReport = false;
    try {
      const { r, json } = await fetchStoredAnalysis(debateId);
      hasReport = r.ok && !!json.raw;
    } catch (_) {}

    const triggerLabel = hasReport ? 'Analyse et arbitrage IA' : 'Générer rapport IA';
    const regenBtnHtml = hasReport ? '<button type="button" id="ada-regen-btn" class="ada-regen-btn ada-regen-btn-under-trigger">Regénérer</button>' : '';

    slot.innerHTML = `
      <div class="ada-wrap">
        <button type="button" id="ada-trigger-btn" class="ada-trigger-btn"><img src="/sablier2-64.png" alt="" style="width:28px;height:28px;vertical-align:middle;margin-right:6px;">${triggerLabel}</button>
        ${regenBtnHtml}
        <div id="ada-panel" class="ada-panel">
          <div class="ada-panel-header">
            <span class="ada-panel-title">Analyse et arbitrage IA</span>
            <button type="button" id="ada-close-btn" class="ada-close-btn" title="Fermer">✕</button>
          </div>
          <div id="ada-body" class="ada-body"></div>
          ${collapseFooter}
        </div>
      </div>`;

    // La génération (coûteuse, appels OpenAI) reste protégée par le mot de passe
    // admin côté serveur (requireAdmin sur /api/admin/analyze-debate) — mais le
    // bouton est visible pour tous : si le visiteur n'est pas encore admin, on lui
    // demande le mot de passe au clic plutôt que de masquer le bouton. La simple
    // consultation d'un rapport déjà généré (openReport) reste libre, sans mot de passe.
    async function ensureAdminForGeneration() {
      if (isAdmin()) return true;
      if (typeof window.adminLogin === 'function') await window.adminLogin();
      return isAdmin();
    }

    const triggerBtn = document.getElementById('ada-trigger-btn');
    const bindRegenBtn = () => {
      const btn = document.getElementById('ada-regen-btn');
      if (btn) btn.addEventListener('click', async () => {
        if (!(await ensureAdminForGeneration())) return;
        regenerate(debateId);
      });
    };
    bindRegenBtn();

    triggerBtn.addEventListener('click', async () => {
      if (hasReport) {
        openReport(debateId);
        return;
      }
      if (!(await ensureAdminForGeneration())) return;
      const ok = await regenerate(debateId);
      if (ok) {
        hasReport = true;
        triggerBtn.innerHTML = '<img src="/sablier2-64.png" alt="" style="width:28px;height:28px;vertical-align:middle;margin-right:6px;">Analyse et arbitrage IA';
        triggerBtn.insertAdjacentHTML('afterend', '<button type="button" id="ada-regen-btn" class="ada-regen-btn ada-regen-btn-under-trigger">Regénérer</button>');
        bindRegenBtn();
      }
    });
    document.getElementById('ada-close-btn').addEventListener('click', closeReportPanel);
    document.getElementById('ada-collapse-btn').addEventListener('click', closeReportPanel);
    observeAnimated();
    if (wantsReport && hasReport) openReport(debateId, undefined, { fromNotification: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
