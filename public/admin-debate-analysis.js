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
        margin-top: 10px; border: 1px solid #c7d2fe; border-radius: 12px;
        background: #f5f3ff; overflow: hidden; display: none; width: 100%;
      }
      .ada-panel-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 9px 14px; background: #e0e7ff; border-bottom: 1px solid #c7d2fe;
      }
      .ada-panel-title { font-size: 13px; font-weight: 700; color: #3730a3; }
      .ada-close-btn {
        background: none; border: none; font-size: 14px; color: #6366f1;
        cursor: pointer; line-height: 1; padding: 2px 4px;
      }
      .ada-close-btn:hover { color: #1e1b4b; }
      .ada-body {
        padding: 14px 14px 18px; font-size: 15px; line-height: 1.7; color: #1e1b4b;
      }
      .ada-panel-footer {
        padding: 8px 14px; border-top: 1px solid #c7d2fe; background: #e0e7ff;
        display: flex; justify-content: flex-end;
      }
      .ada-regen-btn {
        font-size: 11px; padding: 4px 10px; border-radius: 6px;
        border: 1px solid #6366f1; background: #fff; color: #4338ca;
        cursor: pointer; font-weight: 600;
      }
      .ada-regen-btn:hover { background: #6366f1; color: #fff; }
      .ada-regen-btn:disabled { opacity: .55; cursor: default; }

      /* ── Meta ── */
      .ada-date {
        font-size: 12px; color: #6b7280; font-style: italic;
        margin-bottom: 14px; padding-bottom: 10px;
        border-bottom: 1px solid #e5e7eb;
      }
      .ada-loading { color: #6366f1; font-style: italic; }
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
        display: inline-flex; align-items: center; gap: 4px;
        margin: 4px auto 0; padding: 3px 12px; border-radius: 999px;
        background: linear-gradient(120deg, #fff 25%, #c8c8c8 50%, #fff 75%);
        background-size: 300% 100%;
        border: 3px solid #111;
        font-size: 11px; font-weight: 600; color: #111;
        white-space: nowrap;
        animation: adaBadgeShine 2.4s ease-in-out infinite;
      }
      @media (min-width: 769px) {
        .ada-countdown-badge,
        .ada-countdown-ready {
          font-size: 14px;
        }
      }
      #debate-ai-countdown-slot {
        display: flex; justify-content: center;
        margin-top: 1px;
      }

      /* ── Report container ── */
      .ada-scoring-report { padding: 2px 0; }
      .ada-report { max-width: 760px; margin: 0 auto; }

      /* ── Verdict card ── */
      .ada-verdict-card {
        background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%);
        border-radius: 14px; padding: 20px 20px 16px;
        margin: 4px 0 22px;
        color: #fff; box-shadow: 0 4px 24px rgba(99,102,241,.3);
      }
      .ada-verdict-eyebrow {
        font-size: 10px; font-weight: 700; letter-spacing: .12em;
        text-transform: uppercase; opacity: .65; margin-bottom: 6px;
      }
      .ada-verdict-winner {
        font-size: 19px; font-weight: 800; line-height: 1.35;
        margin: 0 0 14px; color: #e0e7ff;
      }
      .ada-verdict-scores-row {
        display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px;
      }
      .ada-verdict-score-a {
        font-size: 30px; font-weight: 900; color: #818cf8; line-height: 1;
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
      .ada-combined-bar-label-a { color: #6366f1; }
      .ada-combined-bar-label-b { color: #6b7280; text-align: right; }
      .ada-verdict-card .ada-combined-bar-label-a { color: #a5b4fc; }
      .ada-verdict-card .ada-combined-bar-label-b { color: rgba(255,255,255,.45); }
      .ada-combined-bar-track {
        height: 12px; border-radius: 6px; overflow: hidden;
        display: flex; background: #e5e7eb;
      }
      .ada-verdict-card .ada-combined-bar-track { background: rgba(255,255,255,.15); }
      .ada-combined-bar-seg-a {
        height: 100%; background: linear-gradient(90deg, #4338ca, #6366f1);
        border-radius: 6px 0 0 6px; min-width: 2px;
        transition: width .6s ease;
      }
      .ada-verdict-card .ada-combined-bar-seg-a {
        background: linear-gradient(90deg, #818cf8, #a5b4fc);
      }
      .ada-combined-bar-seg-b {
        height: 100%; background: #d1d5db; border-radius: 0 6px 6px 0; flex: 1;
      }
      .ada-verdict-card .ada-combined-bar-seg-b { background: rgba(255,255,255,.2); }

      /* ── Section header ── */
      .ada-section-h2 {
        display: flex; align-items: center; gap: 8px;
        font-size: 15px; font-weight: 800; color: #1e1b4b;
        margin: 24px 0 12px; padding-bottom: 7px;
        border-bottom: 2px solid #e0e7ff;
      }
      .ada-section-icon { font-size: 15px; line-height: 1; }

      /* ── Criterion card ── */
      .ada-criterion-card {
        border: 1px solid #e0e7ff; border-radius: 10px;
        padding: 13px 15px; margin: 0 0 10px;
        background: #fafbff;
      }
      .ada-criterion-header {
        display: flex; align-items: center; gap: 7px; margin-bottom: 10px;
      }
      .ada-criterion-icon { font-size: 15px; line-height: 1; }
      .ada-criterion-title { font-size: 14px; font-weight: 700; color: #312e81; }
      .ada-criterion-arrow {
        font-size: 14px; line-height: 1.6; color: #374151; margin-top: 8px;
      }
      .ada-criterion-arrow::before { content: '→ '; color: #6366f1; font-weight: 700; }

      /* ── Responsive card tables ── */
      .ada-card-table { width: 100%; margin: 0 0 4px; }
      .ada-card-table-row {
        display: grid; gap: 8px; padding: 10px 0;
        border-bottom: 1px solid #ede9fe; font-size: 14px; line-height: 1.55;
        color: #1e1b4b;
      }
      .ada-card-table-row:last-child { border-bottom: none; }
      .ada-card-table-head {
        font-size: 11px; font-weight: 700; color: #6366f1;
        letter-spacing: .06em; text-transform: uppercase;
        padding-bottom: 6px; border-bottom: 1px solid #e0e7ff;
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
        .ada-card-table-row > *:first-child { font-weight: 700; color: #3730a3; }
      }

      /* ── Phrase finale ── */
      .ada-finale {
        margin: 20px 0 8px;
        padding: 14px 16px;
        background: #f0f4ff;
        border-left: 4px solid #6366f1;
        border-radius: 0 10px 10px 0;
        font-size: 15px; line-height: 1.7; color: #1e1b4b; font-style: italic;
      }
      .ada-finale-label {
        font-style: normal; font-weight: 700; font-size: 10px;
        color: #6366f1; letter-spacing: .08em; text-transform: uppercase;
        display: block; margin-bottom: 6px;
      }

      /* ── Visual refresh: calmer palette, richer hierarchy ── */
      .ada-wrap {
        margin: 18px auto 8px;
        width: min(100%, 920px);
      }
      .ada-trigger-btn {
        position: relative;
        overflow: hidden;
        border: 1px solid rgba(232,232,232,.28);
        background: linear-gradient(135deg, #243038, #31424a);
        color: #f3f6f4;
        box-shadow:
          0 12px 30px rgba(0,0,0,.26),
          0 0 0 3px rgba(244,198,107,.08),
          0 0 22px rgba(244,198,107,.18),
          inset 0 1px 0 rgba(255,255,255,.28);
        letter-spacing: .02em;
        animation: adaBreath 3.2s ease-in-out infinite;
      }
      .ada-trigger-btn::before {
        content: '';
        position: absolute;
        inset: -70% auto -70% -42%;
        width: 42%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,.95), rgba(244,198,107,.72), transparent);
        transform: rotate(19deg) translateX(-170%);
        animation: adaTriggerGlint 2.35s ease-in-out infinite;
        pointer-events: none;
      }
      .ada-trigger-btn::after {
        content: '';
        position: absolute;
        inset: 3px;
        border-radius: inherit;
        border: 1px solid rgba(244,198,107,.38);
        box-shadow: inset 0 0 14px rgba(244,198,107,.14);
        opacity: .9;
        pointer-events: none;
      }
      .ada-trigger-btn:hover {
        filter: none;
        transform: translateY(-2px);
        box-shadow:
          0 16px 38px rgba(0,0,0,.32),
          0 0 0 5px rgba(244,198,107,.16),
          0 0 34px rgba(244,198,107,.36);
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
        border: 1px solid rgba(232,232,232,.18);
        border-radius: 16px;
        background: linear-gradient(180deg, #eef3f0 0%, #dfe8e6 100%);
        box-shadow: 0 24px 70px rgba(0,0,0,.28);
      }
      .ada-panel-header {
        background: linear-gradient(135deg, #243038 0%, #31424a 72%, #5a4a2f 100%);
        border-bottom: 1px solid rgba(244,198,107,.34);
        padding: 12px 16px;
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
        border-radius: 999px;
        transition: background .18s ease, color .18s ease, transform .18s ease;
      }
      .ada-close-btn:hover {
        background: rgba(244,198,107,.15);
        color: #fff;
        transform: rotate(8deg);
      }
      .ada-body {
        color: #18252c;
        font-size: 20px;
        line-height: 1.58;
        padding: 18px clamp(14px, 3vw, 24px) 24px;
      }
      .ada-date {
        color: #4d6268;
        text-align: center;
        border-bottom: 1px solid rgba(36,48,56,.18);
      }
      .ada-date::before {
        content: '🕰️ ';
        font-style: normal;
      }
      .ada-scoring-report {
        animation: adaReportRise .42s ease both;
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
          radial-gradient(circle at 20% 0%, rgba(244,198,107,.24), transparent 34%),
          linear-gradient(135deg, #243038 0%, #31424a 54%, #1b252b 100%);
        border: 1px solid rgba(244,198,107,.24);
        border-radius: 16px;
        box-shadow: 0 18px 44px rgba(17,24,29,.35);
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
      }
      .ada-verdict-winner {
        color: #f3f6f4;
        font-size: clamp(20px, 3vw, 28px);
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
        font-size: 18px;
      }
      .ada-verdict-expl,
      .ada-verdict-prudence {
        color: rgba(243,246,244,.86);
      }
      .ada-combined-bar-label-a,
      .ada-combined-bar-label-b,
      .ada-verdict-card .ada-combined-bar-label-a,
      .ada-verdict-card .ada-combined-bar-label-b {
        color: #243038;
      }
      .ada-combined-bar-labels {
        font-size: 14px;
        line-height: 1.25;
        gap: 12px;
      }
      .ada-verdict-card .ada-combined-bar-label-a,
      .ada-verdict-card .ada-combined-bar-label-b {
        color: rgba(243,246,244,.82);
      }
      .ada-combined-bar-track {
        height: 14px;
        border-radius: 999px;
        background: rgba(36,48,56,.15);
        box-shadow: inset 0 1px 3px rgba(0,0,0,.14);
      }
      .ada-combined-bar-seg-a {
        border-radius: 999px 0 0 999px;
        background: linear-gradient(90deg, #243038, #4d6268);
        animation: adaBarGrow .7s ease-out both;
      }
      .ada-verdict-card .ada-combined-bar-seg-a {
        background: linear-gradient(90deg, #f4d18a, #f7faf8);
      }
      .ada-combined-bar-seg-b {
        border-radius: 0 999px 999px 0;
        background: rgba(36,48,56,.22);
      }
      @keyframes adaBarGrow {
        from { width: 0; }
      }
      .ada-section-h2 {
        justify-content: center;
        text-align: center;
        color: #243038;
        border-bottom: 1px solid rgba(36,48,56,.18);
        margin-top: 28px;
        letter-spacing: .02em;
      }
      .ada-section-icon {
        filter: drop-shadow(0 2px 4px rgba(0,0,0,.12));
      }
      .ada-criterion-card {
        background: rgba(255,255,255,.62);
        border: 1px solid rgba(36,48,56,.12);
        border-radius: 14px;
        box-shadow: 0 10px 24px rgba(36,48,56,.08);
        transition: transform .18s ease, box-shadow .18s ease;
      }
      .ada-criterion-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 14px 30px rgba(36,48,56,.12);
      }
      .ada-criterion-header {
        justify-content: center;
        text-align: center;
      }
      .ada-criterion-title {
        color: #243038;
      }
      .ada-criterion-arrow {
        text-align: center;
        color: #283941;
        font-size: 18px;
      }
      .ada-criterion-arrow::before {
        content: '💡 ';
        color: #5a4a2f;
      }
      .ada-card-table-row {
        color: #22323a;
        border-bottom: 1px solid rgba(36,48,56,.12);
        font-size: 18px;
      }
      .ada-card-table-head {
        color: #5a4a2f;
        border-bottom: 1px solid rgba(36,48,56,.18);
      }
      .ada-finale {
        text-align: center;
        background: linear-gradient(135deg, rgba(244,198,107,.18), rgba(255,255,255,.62));
        border-left: 0;
        border: 1px solid rgba(90,74,47,.22);
        border-radius: 14px;
        color: #243038;
        box-shadow: 0 10px 26px rgba(36,48,56,.1);
        font-size: 20px;
      }
      .ada-finale-label {
        color: #5a4a2f;
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
        border-radius: 999px;
      }
      .ada-regen-btn:hover {
        background: #243038;
        color: #f3f6f4;
      }
      /* ── New-format argument cards ── */
      .ada-arg-card { border: 1px solid #e0e7ff; border-radius: 10px; padding: 12px 14px; margin: 0 0 10px; background: #fafbff; }
      .ada-arg-excluded { opacity: .6; }
      .ada-arg-excluded-label { margin-left: auto; font-size: 10px; font-weight: 600; color: #9ca3af; letter-spacing: .04em; text-transform: uppercase; }
      .ada-arg-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .ada-arg-score { font-size: 20px; font-weight: 900; line-height: 1; }
      .ada-arg-score small { font-size: 11px; font-weight: 600; opacity: .6; }
      .ada-arg-cat { font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 999px; }
      .ada-cat-excellent { color: #4338ca; background: #ede9fe; }
      .ada-cat-bon       { color: #15803d; background: #dcfce7; }
      .ada-cat-moyen     { color: #b45309; background: #fef9c3; }
      .ada-cat-faible    { color: #b91c1c; background: #fee2e2; }
      .ada-arg-text { font-size: 14px; color: #374151; margin-bottom: 7px; font-style: italic; line-height: 1.5; }
      .ada-arg-breakdown { font-size: 12px; color: #6b7280; margin-bottom: 6px; }
      .ada-arg-expl { font-size: 13px; color: #374151; line-height: 1.55; margin-bottom: 6px; }
      .ada-arg-list { margin: 4px 0 4px 16px; padding: 0; font-size: 13px; line-height: 1.5; }
      .ada-arg-strengths li { color: #15803d; }
      .ada-arg-weaknesses li { color: #b91c1c; }
      .ada-arg-source { font-size: 12px; margin-top: 6px; padding: 4px 8px; border-radius: 6px; }
      .ada-arg-source-ok   { background: #f0fdf4; color: #15803d; }
      .ada-arg-source-none { background: #f9fafb; color: #9ca3af; }
      .ada-camp-section { margin-bottom: 28px; }
      .ada-camp-stats { font-size: 12px; color: #6b7280; margin: -6px 0 12px; }
      .ada-dup-section { border-top: 1px dashed #c7d2fe; padding-top: 10px; margin-top: 10px; }
      .ada-dup-title { font-size: 11px; font-weight: 700; color: #6366f1; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
      .ada-dup-group { font-size: 12px; color: #374151; margin-bottom: 4px; padding: 4px 10px; background: #ede9fe; border-radius: 6px; }

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
        .ada-body {
          font-size: 21px;
        }
        .ada-verdict-expl,
        .ada-criterion-arrow,
        .ada-card-table-row {
          font-size: 19px;
        }
        .ada-combined-bar-labels {
          font-size: 16px;
        }
        .ada-verdict-winner {
          font-size: clamp(24px, 3.3vw, 32px);
        }
        .ada-finale {
          font-size: 21px;
        }
      }
    `;
    const el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
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

  function renderNewAnalysis(d) {
    const CAT_CSS = { excellent: 'ada-cat-excellent', bon: 'ada-cat-bon', moyen: 'ada-cat-moyen', faible: 'ada-cat-faible' };
    const CAT_LABEL = { excellent: 'excellent', bon: 'bon', moyen: 'moyen', faible: 'faible' };

    function catBadge(cat, score) {
      const cls = CAT_CSS[cat] || 'ada-cat-faible';
      return `<span class="ada-arg-score ${cls}">${score}<small>/100</small></span><span class="ada-arg-cat ${cls}">${CAT_LABEL[cat] || cat}</span>`;
    }

    function argCard(a) {
      const scoreOut = a.scores_without_sources ? Number(a.scores_without_sources.total_without_sources || 0) : 0;
      const strengthsHtml = (a.strengths || []).length
        ? '<ul class="ada-arg-list ada-arg-strengths">' + a.strengths.map(s => `<li>${esc(s)}</li>`).join('') + '</ul>' : '';
      const weaknessesHtml = (a.weaknesses || []).length
        ? '<ul class="ada-arg-list ada-arg-weaknesses">' + a.weaknesses.map(s => `<li>${esc(s)}</li>`).join('') + '</ul>' : '';
      const sourceHtml = a.has_url_source
        ? `<div class="ada-arg-source ada-arg-source-ok">Source : ${esc(a.source_level || '')} — ${esc(a.source_explanation || '')}</div>`
        : `<div class="ada-arg-source ada-arg-source-none">Aucune source URL fournie</div>`;
      const excluded = a.category === 'faible' || a.category === 'moyen';
      return `<div class="ada-arg-card${excluded ? ' ada-arg-excluded' : ''}">
        <div class="ada-arg-header">${catBadge(a.category, a.final_score)}${excluded ? '<span class="ada-arg-excluded-label">non compté dans le verdict</span>' : ''}</div>
        <div class="ada-arg-text">${esc(a.argumentText)}</div>
        <div class="ada-arg-breakdown">Fond : ${scoreOut}/80 · Sources : ${a.source_score || 0}/20</div>
        ${a.short_explanation ? `<div class="ada-arg-expl">${esc(a.short_explanation)}</div>` : ''}
        ${strengthsHtml}${weaknessesHtml}
        ${sourceHtml}
      </div>`;
    }

    function dupGroups(groups) {
      if (!groups || !groups.length) return '';
      return '<div class="ada-dup-section"><div class="ada-dup-title">♊ Doublons regroupés</div>' +
        groups.map(g => `<div class="ada-dup-group">${esc(g.sharedIdea || '')} — ${(g.mergedArgumentIds || []).length} arguments fusionnés</div>`).join('') +
        '</div>';
    }

    function campSection(camp, campData) {
      const args = campData.effectiveArguments || [];
      if (!args.length) return `<div class="ada-empty">Aucun argument pour ${esc(campData.label)}.</div>`;
      const qe = campData.goodExcellentCount || 0;
      const avg = campData.weightedAverage || 0;
      return `<div class="ada-camp-section">
        <div class="ada-section-h2"><span class="ada-section-icon">${camp === 'A' ? '🔵' : '🔴'}</span> ${esc(campData.label)}</div>
        <div class="ada-camp-stats">${qe} argument${qe > 1 ? 's' : ''} bon${qe > 1 ? 's' : ''}/excellent${qe > 1 ? 's' : ''} · moyenne pondérée : ${avg}/100</div>
        ${args.map(argCard).join('')}
        ${dupGroups(campData.duplicateGroups)}
      </div>`;
    }

    let out = '<div class="ada-scoring-report"><div class="ada-report">';

    // Verdict card
    const v = d.verdict;
    if (v && !d.isOpen) {
      const confCls = v.confidence === 'forte' ? 'ada-conf-forte' : v.confidence === 'moyenne' ? 'ada-conf-moyenne' : 'ada-conf-faible';
      out += `<div class="ada-verdict-card">
        <div class="ada-verdict-eyebrow">⚖️ Verdict argumentatif</div>
        <div class="ada-verdict-winner">${esc(v.winnerLabel)}</div>
        <div class="ada-verdict-scores-row">
          <span class="ada-verdict-score-a">${v.scoreA}</span>
          <span class="ada-verdict-vs">vs</span>
          <span class="ada-verdict-score-b">${v.scoreB}</span>
        </div>
        <div class="ada-verdict-confidence ${confCls}">Confiance : ${esc(v.confidence)}</div>
        ${v.winner !== 'egalite' && v.winner !== 'indeterminate'
          ? renderCombinedBar(d.positionA, v.scoreA, d.positionB, v.scoreB) : ''}
        ${v.caveat ? `<div class="ada-verdict-expl">${esc(v.caveat)}</div>` : ''}
        ${v.note   ? `<div class="ada-verdict-note">${esc(v.note)}</div>`   : ''}
        <div class="ada-verdict-prudence">Ce résultat est provisoire : il évalue la robustesse des arguments présents dans ce débat, pas une vérité définitive.</div>
      </div>`;
    }

    // Camp sections
    out += campSection('A', d.camps.A);
    if (!d.isOpen && d.camps.B) out += campSection('B', d.camps.B);

    // Scoring report (critères + conclusion)
    const sr = d.scoringReport;
    if (sr && (sr.criteria || sr.conclusion)) {
      if (sr.criteria && sr.criteria.length) {
        out += '<div class="ada-section-h2"><span class="ada-section-icon">📊</span> Évaluation par critère</div>';
        for (const c of sr.criteria) {
          const sA = Math.min(100, Math.max(0, Number(c.scoreA) || 0));
          const sB = Math.min(100, Math.max(0, Number(c.scoreB) || 0));
          out += '<div class="ada-criterion-card">' +
            '<div class="ada-criterion-header">' +
              '<span class="ada-criterion-icon">' + _criterionIcon(c.name) + '</span>' +
              '<span class="ada-criterion-title">' + esc(c.name) + '</span>' +
            '</div>' +
            renderCombinedBar(d.positionA, sA, d.positionB, sB) +
          '</div>';
        }
      }
      if (sr.conclusion) {
        out += '<div class="ada-finale">' +
          '<span class="ada-finale-label">✍️ Conclusion</span>' +
          md(sr.conclusion) +
        '</div>';
      }
    }

    out += '</div></div>';
    return out;
  }

  function _criterionIcon(name) {
    const n = String(name || '').toLowerCase();
    if (n.includes('question'))    return '📊';
    if (n.includes('solidit'))     return '🧠';
    if (n.includes('source'))      return '🔍';
    if (n.includes('objection'))   return '🛡️';
    if (n.includes('conviction'))  return '🎯';
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
        '<div class="ada-verdict-prudence">Ce résultat est provisoire : il évalue la robustesse des arguments présents dans ce débat, pas une vérité définitive.</div>' +
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

  // ── Fetch stored analysis ────────────────────────────────────────────
  async function openReport(debateId) {
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
      const r    = await fetch('/api/debates/' + debateId + '/analysis');
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        applyContent = () => { body.innerHTML = `<span class="ada-error">Erreur : ${esc(json.error || r.statusText)}</span>`; };
      } else if (json.raw) {
        applyContent = () => {
          const header = json.generatedAt
            ? `<div class="ada-date">Analyse générée le ${esc(fmtDate(json.generatedAt))}</div>`
            : '';
          let parsed = null;
          try { parsed = JSON.parse(json.raw); } catch (_) {}
          body.innerHTML = header + (parsed && parsed.version === 2
            ? renderNewAnalysis(parsed)
            : renderScoringReport(json.raw));
        };
      } else if (json.status === 'scheduled' || json.status === 'generating') {
        applyContent = () => { body.innerHTML = '<span class="ada-empty">Analyse IA en préparation — disponible prochainement.</span>'; };
      } else if (json.status === 'failed') {
        applyContent = () => { body.innerHTML = '<span class="ada-error">La génération de l\'analyse a échoué.</span>'; };
      } else {
        applyContent = () => { body.innerHTML = '<span class="ada-empty">Aucune analyse disponible pour ce débat.</span>'; };
      }
    } catch (err) {
      applyContent = () => { body.innerHTML = `<span class="ada-error">Erreur : ${esc(err.message)}</span>`; };
    }

    if (useAnim) hideAiAnalysisAnimation(applyContent);
    else applyContent();
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
        return;
      }
      const now = new Date().toISOString();
      let parsedRegen = null;
      try { parsedRegen = JSON.parse(json.raw || ''); } catch (_) {}
      body.innerHTML = `<div class="ada-date">Analyse générée le ${esc(fmtDate(now))}</div>` +
        (parsedRegen && parsedRegen.version === 2
          ? renderNewAnalysis(parsedRegen)
          : renderScoringReport(json.raw || ''));
    } catch (err) {
      body.innerHTML = `<span class="ada-error">Erreur : ${esc(err.message)}</span>`;
    } finally {
      if (regenBtn) { regenBtn.disabled = false; regenBtn.textContent = 'Regénérer'; }
    }
  }

  // ── Countdown ────────────────────────────────────────────────────────
  async function initCountdown(debateId) {
    const slot = document.getElementById('debate-ai-countdown-slot');
    if (!slot) return;

    try {
      const r    = await fetch('/api/debates/' + debateId + '/analysis');
      const json = await r.json().catch(() => ({}));
      if (!r.ok) return;

      if (json.raw || json.status === 'ready') {
        slot.innerHTML = '<span class="ada-countdown-ready" style="cursor:pointer;" title="Voir l\'analyse">✨ Analyse IA disponible</span>';
        slot.querySelector('.ada-countdown-ready').addEventListener('click', () => {
          const target = document.getElementById('debate-ai-analysis-slot');
          scrollToAnalysisElement(target);
          setTimeout(() => {
            const triggerBtn = document.getElementById('ada-trigger-btn');
            if (triggerBtn) triggerBtn.click();
          }, 400);
        });
        observeAnimated(slot);
        return;
      }

      if ((json.status === 'scheduled' || json.status === 'generating') && json.scheduledAt) {
        const target = new Date(json.scheduledAt).getTime();
        const badge  = document.createElement('span');
        badge.className = 'ada-countdown-badge';
        slot.appendChild(badge);
        _visObs.observe(badge);

        const tick = () => {
          const secs = Math.max(0, Math.round((target - Date.now()) / 1000));
          if (secs <= 0) {
            slot.innerHTML = '<span class="ada-countdown-ready">✨ Analyse IA disponible</span>';
          } else {
            badge.textContent = 'Analyse IA dans : ' + String(secs).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' secondes';
            setTimeout(tick, 1000);
          }
        };
        tick();
      }
    } catch (_) {}
  }

  // ── Init ─────────────────────────────────────────────────────────────
  async function init() {
    const debateId = getDebateId();
    if (!debateId) return;

    injectStyles();

    initCountdown(debateId);

    const slot = document.getElementById('debate-ai-analysis-slot');
    if (!slot) return;

    if (isAdmin()) {
      const adminFooter = `
        <div class="ada-panel-footer">
          <button type="button" id="ada-regen-btn" class="ada-regen-btn">Regénérer</button>
        </div>`;

      slot.innerHTML = `
        <div class="ada-wrap">
          <button type="button" id="ada-trigger-btn" class="ada-trigger-btn">✨ Analyse et arbitrage IA</button>
          <div id="ada-panel" class="ada-panel">
            <div class="ada-panel-header">
              <span class="ada-panel-title">Analyse et arbitrage IA</span>
              <button type="button" id="ada-close-btn" class="ada-close-btn" title="Fermer">✕</button>
            </div>
            <div id="ada-body" class="ada-body"></div>
            ${adminFooter}
          </div>
        </div>`;

      document.getElementById('ada-trigger-btn').addEventListener('click', () => openReport(debateId));
      document.getElementById('ada-close-btn').addEventListener('click', () => {
        document.getElementById('ada-panel').style.display = 'none';
      });
      document.getElementById('ada-regen-btn').addEventListener('click', () => regenerate(debateId));
      observeAnimated();
      return;
    }

    try {
      const r    = await fetch('/api/debates/' + debateId + '/analysis');
      const json = await r.json().catch(() => ({}));
      if (!r.ok || !json.raw) return;
    } catch (_) { return; }

    slot.innerHTML = `
      <div class="ada-wrap">
        <button type="button" id="ada-trigger-btn" class="ada-trigger-btn">✨ Analyse et arbitrage IA</button>
        <div id="ada-panel" class="ada-panel">
          <div class="ada-panel-header">
            <span class="ada-panel-title">Analyse et arbitrage IA</span>
            <button type="button" id="ada-close-btn" class="ada-close-btn" title="Fermer">✕</button>
          </div>
          <div id="ada-body" class="ada-body"></div>
        </div>
      </div>`;

    document.getElementById('ada-trigger-btn').addEventListener('click', () => openReport(debateId));
    document.getElementById('ada-close-btn').addEventListener('click', () => {
      document.getElementById('ada-panel').style.display = 'none';
    });
    observeAnimated();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
