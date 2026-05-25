(function () {
  'use strict';

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
      .ada-wrap { margin: 12px 0 4px; }
      .ada-trigger-btn {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 7px 14px; border-radius: 8px; border: 1px solid #6366f1;
        background: #eef2ff; color: #4338ca; font-size: 13px; font-weight: 600;
        cursor: pointer; transition: background .15s, color .15s;
      }
      .ada-trigger-btn:hover  { background: #6366f1; color: #fff; }
      .ada-trigger-btn:disabled { opacity: .55; cursor: default; }
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
        max-height: 560px; overflow-y: auto; white-space: pre-wrap;
      }
      .ada-loading { color: #6366f1; font-style: italic; }
      .ada-error   { color: #b91c1c; }
    `;
    const el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ── Fetch debate data ────────────────────────────────────────────────
  async function fetchDebateData(debateId) {
    const r = await fetch('/api/debates/' + debateId);
    if (!r.ok) throw new Error('Impossible de charger les données du débat.');
    return r.json();
  }

  function buildPayload(data) {
    const debate   = data.debate || {};
    const argsA    = Array.isArray(data.optionA) ? data.optionA : [];
    const argsB    = Array.isArray(data.optionB) ? data.optionB : [];
    const comments = data.commentsByArgument && typeof data.commentsByArgument === 'object'
      ? Object.values(data.commentsByArgument).flat()
      : [];
    return {
      question:   debate.question || '',
      positionA:  debate.option_a || '',
      positionB:  debate.option_b || '',
      content:    debate.content  || '',
      argumentsA: argsA.map((a) => ({ text: a.text || a.content || '' })),
      argumentsB: argsB.map((a) => ({ text: a.text || a.content || '' })),
      comments:   comments.map((c) => ({ text: c.text || c.content || '', stance: c.stance || '' }))
    };
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Run analysis ─────────────────────────────────────────────────────
  async function runAnalysis(debateId) {
    const btn   = document.getElementById('ada-trigger-btn');
    const panel = document.getElementById('ada-panel');
    const body  = document.getElementById('ada-body');

    btn.disabled = true;
    btn.textContent = 'Analyse en cours…';
    panel.style.display = 'block';
    body.innerHTML = '<span class="ada-loading">Chargement des données…</span>';

    try {
      const data    = await fetchDebateData(debateId);
      const payload = buildPayload(data);

      body.innerHTML = '<span class="ada-loading">Analyse IA en cours…</span>';

      const r = await fetch('/api/admin/analyze-debate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': getAdminToken() },
        body:    JSON.stringify(payload)
      });

      const json = await r.json().catch(() => ({}));

      if (!r.ok) {
        body.innerHTML = `<span class="ada-error">Erreur : ${esc(json.error || r.statusText)}</span>`;
        return;
      }

      body.style.whiteSpace = 'pre-wrap';
      body.textContent = json.raw || '(réponse vide)';
    } catch (err) {
      body.innerHTML = `<span class="ada-error">Erreur : ${esc(err.message)}</span>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Analyser le débat';
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────
  function init() {
    if (!isAdmin()) return;

    const debateId = getDebateId();
    if (!debateId) return;

    const slot = document.getElementById('debate-ai-analysis-slot');
    if (!slot) return;

    injectStyles();

    slot.innerHTML = `
      <div class="ada-wrap">
        <button type="button" id="ada-trigger-btn" class="ada-trigger-btn">Analyser le débat</button>
        <div id="ada-panel" class="ada-panel">
          <div class="ada-panel-header">
            <span class="ada-panel-title">Analyse IA du débat</span>
            <button type="button" id="ada-close-btn" class="ada-close-btn" title="Fermer">✕</button>
          </div>
          <div id="ada-body" class="ada-body"></div>
        </div>
      </div>`;
    slot.style.display = '';

    document.getElementById('ada-trigger-btn').addEventListener('click', () => runAnalysis(debateId));
    document.getElementById('ada-close-btn').addEventListener('click', () => {
      document.getElementById('ada-panel').style.display = 'none';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
