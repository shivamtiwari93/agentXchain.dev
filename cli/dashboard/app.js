/**
 * Dashboard app — router, data fetching, and component mounting.
 *
 * Loaded as an ES module from index.html. Fetches state from the bridge
 * server API and delegates rendering to view components.
 */

import { render as renderTimeline } from './components/timeline.js';
import { render as renderLedger } from './components/ledger.js';
import { render as renderHooks } from './components/hooks.js';
import { render as renderBlocked } from './components/blocked.js';
import { render as renderGate } from './components/gate.js';
import { render as renderInitiative } from './components/initiative.js';
import { render as renderCrossRepo } from './components/cross-repo.js';
import { render as renderBlockers } from './components/blockers.js';
import { render as renderArtifacts } from './components/artifacts.js';

const VIEWS = {
  timeline: { fetch: ['state', 'continuity', 'history', 'audit', 'annotations', 'connectors'], render: renderTimeline },
  ledger: { fetch: ['ledger'], render: renderLedger },
  hooks: { fetch: ['audit', 'annotations'], render: renderHooks },
  blocked: { fetch: ['state', 'audit', 'coordinatorState', 'coordinatorAudit'], render: renderBlocked },
  gate: { fetch: ['state', 'history', 'coordinatorState', 'coordinatorHistory', 'coordinatorBarriers'], render: renderGate },
  initiative: { fetch: ['coordinatorState', 'coordinatorBarriers', 'barrierLedger', 'coordinatorBlockers'], render: renderInitiative },
  'cross-repo': { fetch: ['coordinatorState', 'coordinatorHistory'], render: renderCrossRepo },
  blockers: { fetch: ['coordinatorBlockers'], render: renderBlockers },
  artifacts: { fetch: ['workflowKitArtifacts'], render: renderArtifacts },
};

const API_MAP = {
  state: '/api/state',
  continuity: '/api/continuity',
  history: '/api/history',
  ledger: '/api/ledger',
  audit: '/api/hooks/audit',
  annotations: '/api/hooks/annotations',
  coordinatorState: '/api/coordinator/state',
  coordinatorHistory: '/api/coordinator/history',
  coordinatorBarriers: '/api/coordinator/barriers',
  barrierLedger: '/api/coordinator/barrier-ledger',
  coordinatorAudit: '/api/coordinator/hooks/audit',
  coordinatorBlockers: '/api/coordinator/blockers',
  workflowKitArtifacts: '/api/workflow-kit-artifacts',
  connectors: '/api/connectors',
};

const viewState = {
  ledger: {
    agent: 'all',
    query: '',
    phase: 'all',
    dateFrom: '',
    dateTo: '',
  },
  hooks: {
    phase: 'all',
    verdict: 'all',
    hookName: 'all',
  },
};

let activeViewName = null;
let activeViewData = null;
let dashboardSession = null;
let actionInFlight = false;

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchData(keys) {
  const results = {};
  await Promise.all(keys.map(async (key) => {
    try {
      const res = await fetch(API_MAP[key]);
      results[key] = res.ok ? await res.json() : null;
    } catch {
      results[key] = null;
    }
  }));
  return results;
}

async function loadSession() {
  try {
    const res = await fetch('/api/session');
    dashboardSession = res.ok ? await res.json() : null;
  } catch {
    dashboardSession = null;
  }
}

function currentView() {
  return (location.hash || '#timeline').slice(1);
}

async function pickInitialView() {
  if (location.hash) {
    return currentView();
  }

  const [stateResult, coordinatorResult] = await Promise.all([
    fetchData(['state']).catch(() => ({ state: null })),
    fetchData(['coordinatorState']).catch(() => ({ coordinatorState: null })),
  ]);

  if (!stateResult.state && coordinatorResult.coordinatorState) {
    location.hash = '#initiative';
    return 'initiative';
  }

  return currentView();
}

function buildRenderData(viewName, data) {
  if (viewName === 'ledger') {
    return {
      ...data,
      filter: viewState.ledger,
    };
  }
  if (viewName === 'hooks') {
    return {
      ...data,
      filter: viewState.hooks,
    };
  }
  return data;
}

function renderView(viewName, data) {
  const container = document.getElementById('view-container');
  const view = VIEWS[viewName];
  if (!view) {
    container.innerHTML = `<div class="placeholder"><h2>Unknown View</h2><p>View "${escapeHtml(viewName)}" not found.</p></div>`;
    return;
  }

  container.innerHTML = view.render(buildRenderData(viewName, data));
}

function setActionBanner(message, tone = 'info') {
  const banner = document.getElementById('action-banner');
  if (!banner) return;

  if (!message) {
    banner.textContent = '';
    banner.className = 'action-banner';
    return;
  }

  banner.textContent = message;
  banner.className = `action-banner visible ${tone === 'error' ? 'error' : tone === 'success' ? 'success' : ''}`.trim();
}

async function loadView(viewName, { refresh = true } = {}) {
  const view = VIEWS[viewName];
  if (!view) {
    renderView(viewName, null);
    return;
  }

  const shouldRefetch = refresh || activeViewName !== viewName || !activeViewData;
  activeViewName = viewName;
  if (shouldRefetch) {
    activeViewData = await fetchData(view.fetch);
  }

  renderView(viewName, activeViewData);
}

// ── WebSocket connection ──────────────────────────────────────────────────

let ws = null;
let reconnectDelay = 1000;

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  const statusDot = document.getElementById('ws-status');
  const statusLabel = document.getElementById('ws-label');

  ws.onopen = () => {
    statusDot.classList.remove('disconnected');
    statusLabel.textContent = 'Connected';
    reconnectDelay = 1000;
    loadView(currentView());
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'invalidate') {
        loadView(currentView());
      }
    } catch {}
  };

  ws.onclose = () => {
    statusDot.classList.add('disconnected');
    statusLabel.textContent = 'Disconnected';
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      connect();
    }, reconnectDelay);
  };

  ws.onerror = () => ws.close();
}

// ── Router ─────────────────────────────────────────────────────────────────

function updateNav() {
  const view = currentView();
  document.querySelectorAll('nav a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === '#' + view);
  });
}

window.addEventListener('hashchange', () => {
  updateNav();
  loadView(currentView());
});

document.addEventListener('input', (event) => {
  const view = currentView();
  if (!activeViewData) return;

  const control = event.target?.dataset?.viewControl;
  if (!control) return;

  if (view === 'ledger') {
    if (control === 'ledger-query') {
      viewState.ledger.query = event.target.value;
      renderView('ledger', activeViewData);
    } else if (control === 'ledger-date-from') {
      viewState.ledger.dateFrom = event.target.value;
      renderView('ledger', activeViewData);
    } else if (control === 'ledger-date-to') {
      viewState.ledger.dateTo = event.target.value;
      renderView('ledger', activeViewData);
    }
  }
});

document.addEventListener('change', (event) => {
  const view = currentView();
  if (!activeViewData) return;

  const control = event.target?.dataset?.viewControl;
  if (!control) return;

  if (view === 'ledger') {
    if (control === 'ledger-agent') {
      viewState.ledger.agent = event.target.value;
      renderView('ledger', activeViewData);
    } else if (control === 'ledger-phase') {
      viewState.ledger.phase = event.target.value;
      renderView('ledger', activeViewData);
    } else if (control === 'ledger-date-from') {
      viewState.ledger.dateFrom = event.target.value;
      renderView('ledger', activeViewData);
    } else if (control === 'ledger-date-to') {
      viewState.ledger.dateTo = event.target.value;
      renderView('ledger', activeViewData);
    }
  }

  if (view === 'hooks') {
    if (control === 'hooks-phase') {
      viewState.hooks.phase = event.target.value;
      renderView('hooks', activeViewData);
    } else if (control === 'hooks-verdict') {
      viewState.hooks.verdict = event.target.value;
      renderView('hooks', activeViewData);
    } else if (control === 'hooks-hookname') {
      viewState.hooks.hookName = event.target.value;
      renderView('hooks', activeViewData);
    }
  }
});

// ── Turn expand toggle ──────────────────────────────────────────────────

document.addEventListener('click', (event) => {
  const turnCard = event.target.closest('[data-turn-expand]');
  if (!turnCard) return;
  // Don't toggle if clicking inside the detail panel itself
  if (event.target.closest('.turn-detail-panel')) return;
  turnCard.toggleAttribute('data-expanded');
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-dashboard-action="approve-gate"]');
  if (!button) return;

  event.preventDefault();
  if (actionInFlight) return;

  if (!dashboardSession?.mutation_token) {
    setActionBanner('Dashboard action token unavailable. Reload the page and try again.', 'error');
    return;
  }

  const originalLabel = button.textContent;
  const pendingLabel = button.dataset.actionLabel || 'Approve Gate';
  actionInFlight = true;
  button.disabled = true;
  button.textContent = `${pendingLabel}...`;
  setActionBanner('Submitting gate approval...', 'info');

  try {
    const res = await fetch('/api/actions/approve-gate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AgentXchain-Token': dashboardSession.mutation_token,
      },
      body: JSON.stringify({}),
    });
    const payload = await res.json().catch(() => ({
      ok: false,
      error: `Dashboard action failed with HTTP ${res.status}.`,
    }));

    if (!res.ok || payload.ok === false) {
      setActionBanner(payload.error || `Dashboard action failed with HTTP ${res.status}.`, 'error');
      return;
    }

    setActionBanner(payload.message || 'Gate approved.', 'success');
    await loadView(currentView());
  } catch (error) {
    setActionBanner(error?.message || 'Dashboard action failed.', 'error');
  } finally {
    actionInFlight = false;
    button.disabled = false;
    button.textContent = originalLabel;
  }
});

// ── Copy to clipboard ────────────────────────────────────────────────────

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-copy]');
  if (!target) return;

  const text = target.getAttribute('data-copy');
  if (!text) return;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      target.classList.add('copied');
      target.setAttribute('data-copied', 'Copied!');
      setTimeout(() => {
        target.classList.remove('copied');
        target.removeAttribute('data-copied');
      }, 1500);
    }).catch(() => {
      fallbackSelect(target);
    });
  } else {
    fallbackSelect(target);
  }
});

function fallbackSelect(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// ── Init ───────────────────────────────────────────────────────────────────

Promise.all([pickInitialView(), loadSession()]).finally(() => {
  updateNav();
  connect();
});
