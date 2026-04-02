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

const VIEWS = {
  timeline: { fetch: ['state', 'history'], render: renderTimeline },
  ledger: { fetch: ['ledger'], render: renderLedger },
  hooks: { fetch: ['audit', 'annotations'], render: renderHooks },
  blocked: { fetch: ['state', 'audit', 'coordinatorState', 'coordinatorAudit'], render: renderBlocked },
  gate: { fetch: ['state', 'history', 'coordinatorState', 'coordinatorHistory', 'coordinatorBarriers'], render: renderGate },
  initiative: { fetch: ['coordinatorState', 'coordinatorBarriers', 'barrierLedger'], render: renderInitiative },
  'cross-repo': { fetch: ['coordinatorState', 'coordinatorHistory'], render: renderCrossRepo },
};

const API_MAP = {
  state: '/api/state',
  history: '/api/history',
  ledger: '/api/ledger',
  audit: '/api/hooks/audit',
  annotations: '/api/hooks/annotations',
  coordinatorState: '/api/coordinator/state',
  coordinatorHistory: '/api/coordinator/history',
  coordinatorBarriers: '/api/coordinator/barriers',
  barrierLedger: '/api/coordinator/barrier-ledger',
  coordinatorAudit: '/api/coordinator/hooks/audit',
};

const viewState = {
  ledger: {
    agent: 'all',
    query: '',
  },
};

let activeViewName = null;
let activeViewData = null;

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
  if (currentView() !== 'ledger' || !activeViewData) {
    return;
  }

  if (event.target?.dataset?.viewControl === 'ledger-query') {
    viewState.ledger.query = event.target.value;
    renderView('ledger', activeViewData);
  }
});

document.addEventListener('change', (event) => {
  if (currentView() !== 'ledger' || !activeViewData) {
    return;
  }

  if (event.target?.dataset?.viewControl === 'ledger-agent') {
    viewState.ledger.agent = event.target.value;
    renderView('ledger', activeViewData);
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

pickInitialView().finally(() => {
  updateNav();
  connect();
});
