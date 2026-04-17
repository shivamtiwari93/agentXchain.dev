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
import { render as renderDelegations } from './components/delegations.js';
import { render as renderBlockers } from './components/blockers.js';
import { render as renderArtifacts } from './components/artifacts.js';
import { render as renderMission } from './components/mission.js';
import { render as renderChain } from './components/chain.js';
import { render as renderRunHistory } from './components/run-history.js';
import { render as renderTimeouts } from './components/timeouts.js';
import { render as renderCoordinatorTimeouts } from './components/coordinator-timeouts.js';
import {
  buildLiveMeta,
  createLiveEventFromMessage,
  shouldRefreshViewForLiveMessage,
} from './live-observer.js';

const VIEWS = {
  timeline: { fetch: ['state', 'continuity', 'history', 'events', 'audit', 'annotations', 'connectors', 'coordinatorAudit', 'coordinatorAnnotations'], render: renderTimeline },
  delegations: { fetch: ['state', 'history'], render: renderDelegations },
  ledger: { fetch: ['state', 'ledger', 'coordinatorState', 'coordinatorLedger', 'repoDecisionsSummary'], render: renderLedger },
  hooks: { fetch: ['audit', 'annotations', 'coordinatorAudit', 'coordinatorAnnotations'], render: renderHooks },
  blocked: { fetch: ['state', 'audit', 'coordinatorState', 'coordinatorAudit', 'coordinatorBlockers', 'coordinatorRepoStatusRows', 'gateActions'], render: renderBlocked },
  gate: { fetch: ['state', 'history', 'coordinatorState', 'coordinatorHistory', 'coordinatorBarriers', 'gateActions'], render: renderGate },
  initiative: { fetch: ['coordinatorState', 'coordinatorBarriers', 'barrierLedger', 'coordinatorBlockers', 'coordinatorRepoStatusRows'], render: renderInitiative },
  'cross-repo': { fetch: ['coordinatorState', 'coordinatorHistory'], render: renderCrossRepo },
  blockers: { fetch: ['coordinatorBlockers'], render: renderBlockers },
  artifacts: { fetch: ['workflowKitArtifacts'], render: renderArtifacts },
  mission: { fetch: ['missions', 'plans'], render: renderMission },
  chain: { fetch: ['chainReports'], render: renderChain },
  'run-history': { fetch: ['runHistory'], render: renderRunHistory },
  timeouts: { fetch: ['timeouts'], render: renderTimeouts },
  'coordinator-timeouts': { fetch: ['coordinatorTimeouts'], render: renderCoordinatorTimeouts },
};

const API_MAP = {
  state: '/api/state',
  continuity: '/api/continuity',
  history: '/api/history',
  ledger: '/api/ledger',
  repoDecisionsSummary: '/api/repo-decisions-summary',
  coordinatorLedger: '/api/coordinator/ledger',
  audit: '/api/hooks/audit',
  annotations: '/api/hooks/annotations',
  coordinatorState: '/api/coordinator/state',
  coordinatorHistory: '/api/coordinator/history',
  coordinatorBarriers: '/api/coordinator/barriers',
  barrierLedger: '/api/coordinator/barrier-ledger',
  coordinatorAudit: '/api/coordinator/hooks/audit',
  coordinatorAnnotations: '/api/coordinator/hooks/annotations',
  coordinatorBlockers: '/api/coordinator/blockers',
  coordinatorRepoStatusRows: '/api/coordinator/repo-status',
  workflowKitArtifacts: '/api/workflow-kit-artifacts',
  missions: '/api/missions',
  plans: '/api/plans',
  chainReports: '/api/chain-reports',
  connectors: '/api/connectors',
  runHistory: '/api/run-history',
  timeouts: '/api/timeouts',
  coordinatorTimeouts: '/api/coordinator/timeouts',
  gateActions: '/api/gate-actions',
  events: '/api/events?type=turn_conflicted&limit=10',
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
const DASHBOARD_POLL_INTERVAL_MS = 60 * 1000;

let activeViewName = null;
let activeViewData = null;
let dashboardSession = null;
let actionInFlight = false;
let pollInFlight = false;
let pollTimer = null;
const liveObserverState = {
  connected: false,
  lastRefreshAt: null,
  lastRunEvent: null,
  lastCoordinatorEvent: null,
};

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
  const liveMeta = (viewName === 'timeline' || viewName === 'timeouts')
    ? buildLiveMeta({
      connected: liveObserverState.connected,
      lastRefreshAt: liveObserverState.lastRefreshAt,
      lastEvent: liveObserverState.lastRunEvent,
      scope: 'run',
    })
    : viewName === 'cross-repo'
      ? buildLiveMeta({
        connected: liveObserverState.connected,
        lastRefreshAt: liveObserverState.lastRefreshAt,
        lastEvent: liveObserverState.lastCoordinatorEvent,
        scope: 'coordinator',
      })
      : null;

  if (viewName === 'ledger') {
    return {
      ...data,
      filter: viewState.ledger,
      liveMeta,
    };
  }
  if (viewName === 'hooks') {
    return {
      ...data,
      filter: viewState.hooks,
      liveMeta,
    };
  }
  return {
    ...data,
    liveMeta,
  };
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

function formatActionErrorMessage(payload, status) {
  if (!payload || typeof payload !== 'object') {
    return `Dashboard action failed with HTTP ${status}.`;
  }

  const parts = [];
  if (typeof payload.error === 'string' && payload.error.trim()) {
    parts.push(payload.error.trim());
  } else {
    parts.push(`Dashboard action failed with HTTP ${status}.`);
  }

  const detail = payload.recovery_summary?.detail;
  if (typeof detail === 'string' && detail.trim()) {
    parts.push(detail.trim());
  }

  const nextAction = payload.next_actions?.[0]?.command || payload.next_action || null;
  if (typeof nextAction === 'string' && nextAction.trim()) {
    parts.push(`Next: ${nextAction.trim()}`);
  }

  return parts.join(' ');
}

function formatActionSuccessMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'Gate approved.';
  }

  const parts = [];
  if (typeof payload.message === 'string' && payload.message.trim()) {
    parts.push(payload.message.trim());
  } else {
    parts.push('Gate approved.');
  }

  const nextAction = payload.next_actions?.[0]?.command || payload.next_action || null;
  if (typeof nextAction === 'string' && nextAction.trim()) {
    parts.push(`Next: ${nextAction.trim()}`);
  }

  return parts.join(' ');
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
    liveObserverState.lastRefreshAt = new Date().toISOString();
  }

  renderView(viewName, activeViewData);
}

function rerenderActiveView() {
  if (!activeViewName) return;
  renderView(activeViewName, activeViewData);
}

async function pollDashboard({ refreshView = false } = {}) {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    await fetch('/api/poll', { cache: 'no-store' });
    if (refreshView) {
      await loadView(currentView());
    }
  } catch {
    // Best-effort heartbeat only
  } finally {
    pollInFlight = false;
  }
}

function startDashboardPolling() {
  if (pollTimer) return;

  const tick = () => {
    if (document.visibilityState === 'hidden') return;
    if (actionInFlight) return;
    void pollDashboard({ refreshView: true });
  };

  pollTimer = setInterval(tick, DASHBOARD_POLL_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void pollDashboard({ refreshView: true });
    }
  });
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
    liveObserverState.connected = true;
    void pollDashboard().finally(() => {
      loadView(currentView());
    });
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'event') {
        liveObserverState.lastRunEvent = createLiveEventFromMessage(msg);
        rerenderActiveView();
        return;
      }

      if (msg.type === 'coordinator_event') {
        liveObserverState.lastCoordinatorEvent = createLiveEventFromMessage(msg);
        if (shouldRefreshViewForLiveMessage(currentView(), msg.type)) {
          loadView(currentView());
        } else {
          rerenderActiveView();
        }
        return;
      }

      if (shouldRefreshViewForLiveMessage(currentView(), msg.type)) {
        loadView(currentView());
      }
    } catch {}
  };

  ws.onclose = () => {
    statusDot.classList.add('disconnected');
    statusLabel.textContent = 'Disconnected';
    liveObserverState.connected = false;
    rerenderActiveView();
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
      setActionBanner(formatActionErrorMessage(payload, res.status), 'error');
      return;
    }

    setActionBanner(formatActionSuccessMessage(payload), 'success');
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
  startDashboardPolling();
  connect();
});
