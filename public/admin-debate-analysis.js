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
      .ada-wrap { margin: 16px 0 4px; display: flex; flex-direction: column; align-items: center; }
      @media (max-width: 768px) { .ada-wrap { margin-bottom: 18px; } }
      .ada-trigger-btn, .ada-countdown-badge, .ada-countdown-ready {
        animation-play-state: paused;
      }
      .ada-trigger-btn.is-visible, .ada-countdown-badge.is-visible, .ada-countdown-ready.is-visible {
        animation-play-state: running;
      }
      .ada-trigger-btn {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 11px 28px; border-radius: 999px; border: 3px solid #111;
        background: linear-gradient(120deg, #fff 15%, #b0b0b0 50%, #fff 85%);
        background-size: 300% 100%;
        color: #111; font-size: 14px; font-weight: 700; letter-spacing: .03em;
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
      .ada-panel {
        margin-top: 10px; border: 1px solid #c7d2fe; border-radius: 10px;
        background: #f5f3ff; overflow: hidden; display: none;
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
        padding: 12px 14px; font-size: 13px; line-height: 1.65; color: #1e1b4b;
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
      .ada-date {
        font-size: 11px; color: #6b7280; font-style: italic;
        margin-bottom: 10px; padding-bottom: 8px;
        border-bottom: 1px solid #e5e7eb;
      }
      .ada-loading { color: #6366f1; font-style: italic; }
      .ada-error   { color: #b91c1c; }
      .ada-empty   { color: #6b7280; font-style: italic; }
      .ada-countdown-badge {
        display: inline-flex; align-items: center;
        padding: 3px 12px; border-radius: 999px;
        background: linear-gradient(120deg, #fff 25%, #c8c8c8 50%, #fff 75%);
        background-size: 300% 100%;
        border: 3px solid #111;
        font-size: 10px; font-weight: 600; color: #111;
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
        font-size: 10px; font-weight: 600; color: #111;
        white-space: nowrap;
        animation: adaBadgeShine 2.4s ease-in-out infinite;
      }
      #debate-ai-countdown-slot {
        display: flex; justify-content: center;
        margin-top: 6px;
      }
      .ada-scoring-report { padding: 4px 0; }
      .ada-r-h1 { font-size: 15px; font-weight: 800; color: #312e81; margin: 6px 0 14px; }
      .ada-r-h2 { font-size: 13px; font-weight: 700; color: #3730a3; margin: 18px 0 8px; border-bottom: 1px solid #c7d2fe; padding-bottom: 4px; }
      .ada-r-h3 { font-size: 12px; font-weight: 700; color: #4338ca; margin: 12px 0 6px; }
      .ada-bar-row { margin: 4px 0 10px; }
      .ada-bar-label { display: flex; justify-content: space-between; font-size: 11px; color: #374151; margin-bottom: 3px; font-weight: 600; }
      .ada-bar-pct { color: #6366f1; font-weight: 700; flex-shrink: 0; margin-left: 8px; }
      .ada-bar-wrap { height: 10px; background: #e5e7eb; border-radius: 5px; overflow: hidden; }
      .ada-bar-fill { height: 100%; background: linear-gradient(90deg, #6366f1, #818cf8); border-radius: 5px; }
      .ada-r-table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 6px 0 12px; }
      .ada-r-table th { background: #e0e7ff; color: #3730a3; font-weight: 700; padding: 5px 8px; border: 1px solid #c7d2fe; text-align: left; }
      .ada-r-table td { padding: 5px 8px; border: 1px solid #e5e7eb; color: #1e1b4b; vertical-align: top; }
      .ada-r-sep { border: none; border-top: 1px solid #e0e7ff; margin: 14px 0; }
      .ada-r-p { font-size: 12px; line-height: 1.6; color: #1e1b4b; margin: 4px 0 6px; }
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

  function renderScoringReport(raw) {
    const lines = String(raw || '').split('\n');
    let html = '<div class="ada-scoring-report">';
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Multi-line: table rows starting with |
      if (trimmed.startsWith('|')) {
        let headerCells = null;
        let bodyRows = [];
        let firstData = true;
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          const row = lines[i].trim();
          i++;
          if (/^\|[\s\-:|]+\|$/.test(row)) continue; // separator row
          const cells = row.split('|').slice(1, -1).map(function (c) { return c.trim(); });
          if (firstData) { headerCells = cells; firstData = false; }
          else bodyRows.push(cells);
        }
        html += '<table class="ada-r-table">';
        if (headerCells) {
          html += '<tr>' + headerCells.map(function (c) { return '<th>' + md(c) + '</th>'; }).join('') + '</tr>';
        }
        bodyRows.forEach(function (r) {
          html += '<tr>' + r.map(function (c) { return '<td>' + md(c) + '</td>'; }).join('') + '</tr>';
        });
        html += '</table>';
        continue; // i already advanced inside inner loop
      }

      // Single-line cases — all advance i by 1
      if (trimmed.startsWith('# ')) {
        html += '<div class="ada-r-h1">' + md(trimmed.slice(2)) + '</div>';
      } else if (trimmed.startsWith('## ')) {
        html += '<div class="ada-r-h2">' + md(trimmed.slice(3)) + '</div>';
      } else if (trimmed.startsWith('### ')) {
        html += '<div class="ada-r-h3">' + md(trimmed.slice(4)) + '</div>';
      } else if (trimmed === '---' || trimmed === '***') {
        html += '<hr class="ada-r-sep">';
      } else if (/[█░]/.test(trimmed) && /\d+\s*%/.test(trimmed)) {
        const m = trimmed.match(/^(.*?)\s*[█░]+\s*(\d+)\s*%\s*$/);
        if (m) {
          const label = m[1].replace(/\*\*/g, '').trim();
          const pct = Math.min(100, Math.max(0, parseInt(m[2], 10)));
          html += '<div class="ada-bar-row">' +
            '<div class="ada-bar-label"><span>' + esc(label) + '</span><span class="ada-bar-pct">' + pct + '%</span></div>' +
            '<div class="ada-bar-wrap"><div class="ada-bar-fill" style="width:' + pct + '%"></div></div>' +
            '</div>';
        } else {
          html += '<p class="ada-r-p">' + md(trimmed) + '</p>';
        }
      } else if (trimmed) {
        html += '<p class="ada-r-p">' + md(trimmed) + '</p>';
      }
      i++;
    }

    html += '</div>';
    return html;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return date + ' à ' + time;
  }

  // ── Fetch stored analysis ────────────────────────────────────────────
  async function openReport(debateId) {
    const panel    = document.getElementById('ada-panel');
    const body     = document.getElementById('ada-body');
    const useAnim  = typeof showAiAnalysisAnimation === 'function';

    panel.style.display = 'block';
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
          body.innerHTML = header + renderScoringReport(json.raw);
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
      body.innerHTML = `<div class="ada-date">Analyse générée le ${esc(fmtDate(now))}</div>` +
        renderScoringReport(json.raw || '');
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
        slot.innerHTML = '<span class="ada-countdown-ready" style="cursor:pointer;" title="Voir l\'analyse">✦ Analyse IA disponible</span>';
        slot.querySelector('.ada-countdown-ready').addEventListener('click', () => {
          const target = document.getElementById('debate-ai-analysis-slot');
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Ouvrir et charger l'analyse après le scroll
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
            slot.innerHTML = '<span class="ada-countdown-ready">✦ Analyse IA disponible</span>';
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

    // Countdown : toujours lancé (slot dans le bloc titre, indépendant du bouton)
    initCountdown(debateId);

    const slot = document.getElementById('debate-ai-analysis-slot');
    if (!slot) return;

    // Admins : bouton toujours visible pour déclencher/regénérer
    if (isAdmin()) {
      const adminFooter = `
        <div class="ada-panel-footer">
          <button type="button" id="ada-regen-btn" class="ada-regen-btn">Regénérer</button>
        </div>`;

      slot.innerHTML = `
        <div class="ada-wrap">
          <button type="button" id="ada-trigger-btn" class="ada-trigger-btn">✦ Analyse et arbitrage IA</button>
          <div id="ada-panel" class="ada-panel">
            <div class="ada-panel-header">
              <span class="ada-panel-title">Analyse et arbitrage IA</span>
              <button type="button" id="ada-close-btn" class="ada-close-btn" title="Fermer">✕</button>
            </div>
            <div id="ada-body" class="ada-body"></div>
            ${adminFooter}
          </div>
        </div>`;

      document.getElementById('ada-trigger-btn').addEventListener('click', () => regenerate(debateId));
      document.getElementById('ada-close-btn').addEventListener('click', () => {
        document.getElementById('ada-panel').style.display = 'none';
      });
      document.getElementById('ada-regen-btn').addEventListener('click', () => regenerate(debateId));
      observeAnimated();
      return;
    }

    // Non-admin : bouton affiché uniquement si analyse disponible
    try {
      const r    = await fetch('/api/debates/' + debateId + '/analysis');
      const json = await r.json().catch(() => ({}));
      if (!r.ok || !json.raw) return;
    } catch (_) { return; }

    slot.innerHTML = `
      <div class="ada-wrap">
        <button type="button" id="ada-trigger-btn" class="ada-trigger-btn">✦ Analyse et arbitrage IA</button>
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
