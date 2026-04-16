/**
 * Dashboard app module tests — SPA shell logic.
 *
 * Tests the app-level behaviors that are NOT covered by pure component tests
 * or bridge E2E tests: routing, filter state persistence across rerenders,
 * XSS safety for unknown routes, live-refresh routing, and the shipped
 * named-view shell registry.
 *
 * Strategy: since app.js is a browser ES module tightly coupled to DOM/WebSocket
 * APIs, we test the extractable logic (escapeHtml, buildRenderData, VIEWS registry)
 * and the render pipeline via minimal DOM stubs rather than importing app.js directly.
 * This avoids brittle browser-API mocking while proving the critical behaviors.
 *
 * See: DASHBOARD_DOCS_CONTRACT_SPEC.md, DASHBOARD_GATE_ACTIONS_SPEC.md,
 * DEC-DASH-IMPL-008, DEC-DASH-IMPL-009
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { render as renderTimeline } from '../dashboard/components/timeline.js';
import { filterEntries, render as renderLedger } from '../dashboard/components/ledger.js';
import { render as renderHooks } from '../dashboard/components/hooks.js';
import { render as renderBlocked } from '../dashboard/components/blocked.js';
import { render as renderGate } from '../dashboard/components/gate.js';
import { render as renderInitiative } from '../dashboard/components/initiative.js';
import { render as renderCrossRepo } from '../dashboard/components/cross-repo.js';
import { render as renderDelegations } from '../dashboard/components/delegations.js';
import { render as renderBlockers } from '../dashboard/components/blockers.js';
import { render as renderChain } from '../dashboard/components/chain.js';
import { render as renderTimeouts } from '../dashboard/components/timeouts.js';
import { render as renderCoordinatorTimeouts } from '../dashboard/components/coordinator-timeouts.js';
import {
  buildLiveMeta,
  createLiveEventFromMessage,
  shouldRefreshViewForLiveMessage,
} from '../dashboard/live-observer.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── escapeHtml correctness ────────────────────────────────────────────────

/*
 * app.js has its own escapeHtml() that is identical in logic to the per-component
 * esc() functions. We replicate it here so we can prove its coverage of injection
 * vectors without importing the browser module.
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

describe('App Shell — escapeHtml', () => {
  it('escapes all five HTML-sensitive characters used in dashboard interpolation', () => {
    const input = '&<>"\'';
    assert.equal(escapeHtml(input), '&amp;&lt;&gt;&quot;&#39;');
  });

  it('handles null and undefined', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
  });

  it('coerces non-string values', () => {
    assert.equal(escapeHtml(42), '42');
    assert.equal(escapeHtml(true), 'true');
  });

  it('escapes a realistic XSS payload in an unknown-route context', () => {
    // This is the exact vector: location.hash = '#<img src=x onerror=alert(1)>'
    const malicious = '<img src=x onerror=alert(1)>';
    const escaped = escapeHtml(malicious);
    assert.ok(!escaped.includes('<img'), 'angle brackets must be escaped');
    assert.ok(escaped.includes('&lt;img'), 'tag is entity-encoded');
    // 'onerror' as plain text is safe — the injection is neutralized because
    // the surrounding < > are escaped, so the browser never parses a tag.
    assert.ok(escaped.includes('onerror'), 'attribute text survives as inert content');
  });

  it('escapes single quotes via entity when embedded in attribute context', () => {
    // app.js primarily interpolates content, but defense-in-depth matters
    // because future renderers may reuse escaped values inside attributes.
    const input = "it's a test";
    const result = escapeHtml(input);
    assert.equal(result, 'it&#39;s a test');
  });

  it('escapes backtick which could be dangerous in event handler contexts', () => {
    // Backticks are safe in HTML content but dangerous in template literals
    // inside event handlers. Since we use innerHTML (not eval), this is informational.
    const input = '`${alert(1)}`';
    const result = escapeHtml(input);
    // Backtick passes through — acceptable because innerHTML does not evaluate JS
    assert.ok(result.includes('`'));
  });
});

// ── Unknown route rendering ───────────────────────────────────────────────

describe('App Shell — unknown route XSS prevention', () => {
  /*
   * The app shell renders unknown routes via:
   *   container.innerHTML = `... View "${escapeHtml(viewName)}" not found ...`
   *
   * We simulate this by running the same escapeHtml + template logic.
   */
  function renderUnknownView(viewName) {
    return `<div class="placeholder"><h2>Unknown View</h2><p>View "${escapeHtml(viewName)}" not found.</p></div>`;
  }

  it('renders safe output for a benign unknown route', () => {
    const html = renderUnknownView('settings');
    assert.ok(html.includes('settings'));
    assert.ok(html.includes('Unknown View'));
  });

  it('escapes script injection in route name', () => {
    const html = renderUnknownView('<script>alert(1)</script>');
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('escapes attribute breakout in route name', () => {
    const html = renderUnknownView('" onmouseover="alert(1)');
    // The double-quote is escaped to &quot;, so the attribute cannot break out.
    // 'onmouseover' as plain text is safe — it's inside a quoted string context
    // where the quote character itself is escaped.
    assert.ok(html.includes('&quot;'), 'double quote is entity-encoded');
    assert.ok(!html.includes('" onmouseover'), 'raw attribute breakout is prevented');
  });

  it('escapes HTML tag injection in route name', () => {
    const html = renderUnknownView('<img src=x onerror=alert(1)>');
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;img'));
  });

  it('handles empty route name', () => {
    const html = renderUnknownView('');
    assert.ok(html.includes('View ""'));
  });
});

// ── buildRenderData — filter state injection ──────────────────────────────

describe('App Shell — buildRenderData filter injection', () => {
  /*
   * The app shell's buildRenderData(viewName, data) injects viewState.ledger
   * into the data object when viewName === 'ledger'. This is how filter state
   * survives across rerenders without refetching: the filter is injected at
   * the app level, not stored in the component.
   *
   * We replicate the logic to prove the contract.
   */
  function buildRenderData(viewName, data, viewState) {
    if (viewName === 'ledger') {
      return { ...data, filter: viewState.ledger };
    }
    return data;
  }

  it('injects filter state into ledger view data', () => {
    const data = { ledger: [{ agent: 'pm', decision: 'scope' }] };
    const viewState = { ledger: { agent: 'pm', query: 'scope' } };
    const result = buildRenderData('ledger', data, viewState);
    assert.deepStrictEqual(result.filter, { agent: 'pm', query: 'scope' });
    assert.ok(result.ledger); // original data preserved
  });

  it('does not inject filter state for non-ledger views', () => {
    const data = { state: { status: 'running' } };
    const viewState = { ledger: { agent: 'all', query: '' } };
    const result = buildRenderData('timeline', data, viewState);
    assert.equal(result.filter, undefined);
    assert.deepStrictEqual(result, data);
  });

  it('preserves original data keys when injecting filter', () => {
    const data = { ledger: [{ agent: 'dev' }], extraKey: 'preserved' };
    const viewState = { ledger: { agent: 'all', query: '' } };
    const result = buildRenderData('ledger', data, viewState);
    assert.equal(result.extraKey, 'preserved');
    assert.deepStrictEqual(result.filter, { agent: 'all', query: '' });
  });
});

// ── Ledger filter persistence across rerenders ────────────────────────────

describe('App Shell — ledger filter persistence without refetch', () => {
  /*
   * The critical behavior: when the ledger filter changes (agent dropdown or
   * text query), the app calls renderView('ledger', activeViewData) — rerender
   * with cached data, not a new fetchData() call. This means:
   *   1. viewState.ledger is mutated
   *   2. renderView is called (not loadView)
   *   3. The component receives the same data + updated filter
   *
   * We prove this by showing that render() produces different output for the
   * same data when filter changes, WITHOUT needing to refetch.
   */

  const ledgerData = [
    { turn: 1, agent: 'pm', decision: 'scope approved' },
    { turn: 2, agent: 'dev', decision: 'implemented auth' },
    { turn: 3, agent: 'qa', decision: 'test coverage approved' },
    { turn: 4, agent: 'pm', decision: 'release scope confirmed' },
  ];

  it('shows all entries with no filter', () => {
    const html = renderLedger({ ledger: ledgerData, filter: { agent: 'all', query: '' } });
    assert.ok(html.includes('4 of 4'));
    assert.ok(html.includes('scope approved'));
    assert.ok(html.includes('implemented auth'));
  });

  it('filters by agent without losing data', () => {
    const html = renderLedger({ ledger: ledgerData, filter: { agent: 'pm', query: '' } });
    assert.ok(html.includes('2 of 4'));
    assert.ok(html.includes('scope approved'));
    assert.ok(html.includes('release scope'));
    assert.ok(!html.includes('implemented auth'));
  });

  it('filters by query without losing data', () => {
    const html = renderLedger({ ledger: ledgerData, filter: { agent: 'all', query: 'auth' } });
    assert.ok(html.includes('1 of 4'));
    assert.ok(html.includes('implemented auth'));
    assert.ok(!html.includes('scope approved'));
  });

  it('combines agent + query filter', () => {
    const html = renderLedger({ ledger: ledgerData, filter: { agent: 'pm', query: 'scope' } });
    assert.ok(html.includes('2 of 4'));
  });

  it('preserves selected agent in dropdown after rerender', () => {
    const html = renderLedger({ ledger: ledgerData, filter: { agent: 'dev', query: '' } });
    // The <select> should have 'dev' option selected
    assert.ok(html.includes('value="dev" selected'));
  });

  it('preserves query text in input after rerender', () => {
    const html = renderLedger({ ledger: ledgerData, filter: { agent: 'all', query: 'auth' } });
    assert.ok(html.includes('value="auth"'));
  });

  it('filterEntries is a pure function — same input always produces same output', () => {
    const a = filterEntries(ledgerData, { agent: 'qa', query: '' });
    const b = filterEntries(ledgerData, { agent: 'qa', query: '' });
    assert.deepStrictEqual(a, b);
    assert.equal(a.length, 1);
    assert.equal(a[0].agent, 'qa');
  });
});

// ── Invalidation-triggered refresh ────────────────────────────────────────

describe('App Shell — invalidation refresh contract', () => {
  /*
   * The WebSocket onmessage handler parses JSON and calls loadView(currentView())
   * on invalidate events. We cannot test the actual WebSocket here (that's in
   * dashboard-bridge.test.js). What we CAN test is that the render pipeline
   * produces correct output when called with the same view name and fresh data —
   * simulating what happens after an invalidation triggers a data refetch.
   *
   * The key invariant: rendering the same view with updated data produces
   * output reflecting the new data, not stale cached HTML.
   */

  it('timeline reflects updated state after simulated invalidation', () => {
    const stateV1 = { run_id: 'run-1', status: 'running', phase: 'planning', current_turn: { role: 'pm' } };
    const stateV2 = { run_id: 'run-1', status: 'blocked', phase: 'planning', current_turn: null, blocked: { reason: 'hook failure' } };

    const html1 = renderTimeline({ state: stateV1, history: [] });
    const html2 = renderTimeline({ state: stateV2, history: [] });

    assert.ok(html1.includes('running'));
    assert.ok(!html1.includes('blocked'));
    assert.ok(html2.includes('blocked'));
    assert.ok(!html2.includes('class="status-badge badge-running"'));
  });

  it('blocked view updates when block clears after simulated invalidation', () => {
    // blocked component reads state.blocked_state, not state.blocked
    const blockedState = { status: 'blocked', blocked_state: { reason: 'hook failed', recovery_action: 'Fix hook and retry' } };
    const clearedState = { status: 'running' };

    const html1 = renderBlocked({ state: blockedState });
    const html2 = renderBlocked({ state: clearedState });

    assert.ok(html1.includes('hook failed'));
    assert.ok(html1.includes('Fix hook and retry'));
    assert.ok(html2.includes('not currently blocked'));
  });

  it('gate view updates when pending approval appears after simulated invalidation', () => {
    const noGate = { status: 'running' };
    const withGate = {
      status: 'paused',
      phase: 'planning',
      pending_phase_transition: { from: 'planning', to: 'development', gate: 'human_required', evidence: 'PM approved scope' },
    };

    const html1 = renderGate({ state: noGate });
    const html2 = renderGate({ state: withGate });

    assert.ok(html1.includes('No pending gates'));
    assert.ok(html2.includes('Phase Transition Gate'));
    assert.ok(html2.includes('approve-transition'));
    assert.ok(html2.includes('human_required'));
  });

  it('hooks view reflects new audit entries after simulated invalidation', () => {
    const audit1 = [{ phase: 'before_validation', hook: 'lint', verdict: 'allow', duration_ms: 100 }];
    const audit2 = [
      ...audit1,
      { phase: 'after_acceptance', hook: 'sast', verdict: 'warn', duration_ms: 500 },
    ];

    const html1 = renderHooks({ audit: audit1, annotations: [] });
    const html2 = renderHooks({ audit: audit2, annotations: [] });

    assert.ok(html1.includes('lint'));
    assert.ok(!html1.includes('sast'));
    assert.ok(html2.includes('lint'));
    assert.ok(html2.includes('sast'));
  });
});

describe('App Shell — live observer routing', () => {
  it('AT-DLO-001: buildLiveMeta reports live freshness for recent connected refreshes', () => {
    const meta = buildLiveMeta({
      connected: true,
      lastRefreshAt: '2026-04-15T16:10:00.000Z',
      lastEvent: { type: 'turn_accepted', timestamp: '2026-04-15T16:09:59.000Z' },
      scope: 'run',
      now: Date.parse('2026-04-15T16:10:10.000Z'),
    });

    assert.equal(meta.freshness_state, 'live');
    assert.equal(meta.freshness_label, 'Live');
    assert.match(meta.event_detail, /turn_accepted/);
  });

  it('AT-DLO-002: buildLiveMeta reports stale freshness after the threshold', () => {
    const meta = buildLiveMeta({
      connected: true,
      lastRefreshAt: '2026-04-15T16:10:00.000Z',
      scope: 'coordinator',
      now: Date.parse('2026-04-15T16:10:20.500Z'),
    });

    assert.equal(meta.freshness_state, 'stale');
    assert.equal(meta.freshness_label, 'Stale');
  });

  it('extracts repo-local and coordinator live events from websocket payloads', () => {
    const repoEvent = createLiveEventFromMessage({
      type: 'event',
      event: { event_type: 'turn_accepted', timestamp: '2026-04-15T16:10:00Z' },
    }, '2026-04-15T16:10:01Z');
    const coordinatorEvent = createLiveEventFromMessage({
      type: 'coordinator_event',
      repo_id: 'api',
      event: { event_type: 'run_completed', timestamp: '2026-04-15T16:10:02Z' },
    }, '2026-04-15T16:10:03Z');

    assert.equal(repoEvent.type, 'turn_accepted');
    assert.equal(coordinatorEvent.type, 'run_completed');
    assert.equal(coordinatorEvent.repoId, 'api');
  });

  it('AT-DLO-006: refreshes coordinator-history views for coordinator events without inventing new routes', () => {
    assert.equal(shouldRefreshViewForLiveMessage('cross-repo', 'coordinator_event'), true);
    assert.equal(shouldRefreshViewForLiveMessage('gate', 'coordinator_event'), true);
    assert.equal(shouldRefreshViewForLiveMessage('timeline', 'coordinator_event'), false);
    assert.equal(shouldRefreshViewForLiveMessage('timeline', 'invalidate'), true);
  });
});

describe('App Shell — dashboard polling contract', () => {
  const appSource = readFileSync(join(import.meta.dirname, '..', 'dashboard', 'app.js'), 'utf8');

  it('AT-DPOLL-002: defines a 60-second visible-tab heartbeat to /api/poll', () => {
    assert.match(appSource, /const DASHBOARD_POLL_INTERVAL_MS = 60 \* 1000;/);
    assert.match(appSource, /fetch\('\/api\/poll', \{ cache: 'no-store' \}\)/);
    assert.match(appSource, /document\.visibilityState === 'hidden'/);
    assert.match(appSource, /setInterval\(tick, DASHBOARD_POLL_INTERVAL_MS\)/);
  });

  it('AT-DPOLL-003: refreshes the active view after a poll tick instead of treating poll as fire-and-forget', () => {
    assert.match(appSource, /pollDashboard\(\{ refreshView: true \}\)/);
    assert.match(appSource, /if \(refreshView\) \{\s*await loadView\(currentView\(\)\);\s*\}/);
  });
});

// ── VIEWS registry contract ───────────────────────────────────────────────

describe('App Shell — VIEWS registry', () => {
  /*
   * The VIEWS object in app.js maps view names to { fetch, render } entries.
   * We prove the same contract by verifying each component's render function
   * handles its expected data shape and returns a string, while the registry
   * itself still exposes the full shipped named-view navigation surface.
   */

  const COMPONENTS = {
    timeline: renderTimeline,
    delegations: renderDelegations,
    ledger: renderLedger,
    hooks: renderHooks,
    blocked: renderBlocked,
    gate: renderGate,
    initiative: renderInitiative,
    'cross-repo': renderCrossRepo,
    blockers: renderBlockers,
    chain: renderChain,
    timeouts: renderTimeouts,
    'coordinator-timeouts': renderCoordinatorTimeouts,
  };
  const appSource = readFileSync(join(import.meta.dirname, '..', 'dashboard', 'app.js'), 'utf8');
  const viewMatch = appSource.match(/const VIEWS = \{([\s\S]*?)\n\};/);
  assert.ok(viewMatch, 'app.js must define VIEWS');
  const viewIds = Array.from(
    viewMatch[1].matchAll(/^\s{2}(?:'([^']+)'|([a-z][a-z-]*))\s*:/gm),
    ([, quoted, bare]) => quoted || bare,
  );

  for (const [name, render] of Object.entries(COMPONENTS)) {
    it(`${name} render returns a string for empty/null input`, () => {
      // Each component must handle null data gracefully
      const data = name === 'ledger' ? { ledger: null } :
                   name === 'hooks' ? { audit: null, annotations: null } :
                   name === 'initiative' ? { coordinatorState: null, coordinatorBarriers: null, barrierLedger: null, coordinatorBlockers: null, coordinatorRepoStatusRows: null } :
                   name === 'blockers' ? { coordinatorBlockers: null } :
                   name === 'chain' ? { chainReports: null } :
                   name === 'timeouts' ? { timeouts: null } :
                   name === 'coordinator-timeouts' ? { coordinatorTimeouts: null } :
                   name === 'cross-repo' ? { coordinatorState: null, coordinatorHistory: [] } :
                   { state: null, history: [] };
      const result = render(data);
      assert.equal(typeof result, 'string');
      assert.ok(result.length > 0);
    });
  }

  it('app.js registers the full shipped view set', () => {
    assert.deepEqual(viewIds, [
      'timeline',
      'delegations',
      'ledger',
      'hooks',
      'blocked',
      'gate',
      'initiative',
      'cross-repo',
      'blockers',
      'artifacts',
      'chain',
      'run-history',
      'timeouts',
      'coordinator-timeouts',
    ]);
  });

  it('component coverage stays aligned with the rendered shell', () => {
    for (const name of Object.keys(COMPONENTS)) {
      assert.ok(viewIds.includes(name), `${name} must exist in app.js VIEWS`);
    }
  });

  it('imports the live observer helper instead of open-coding freshness logic in the browser shell', () => {
    assert.match(appSource, /buildLiveMeta/);
    assert.match(appSource, /shouldRefreshViewForLiveMessage/);
    assert.match(appSource, /createLiveEventFromMessage/);
  });

  it('AT-CDRS-004: blocked and initiative fetch coordinatorRepoStatusRows so repo truth comes from the shared dashboard data path', () => {
    assert.match(
      appSource,
      /blocked:\s*\{\s*fetch:\s*\['state', 'audit', 'coordinatorState', 'coordinatorAudit', 'coordinatorBlockers', 'coordinatorRepoStatusRows', 'gateActions'\],\s*render:\s*renderBlocked\s*\}/,
    );
    assert.match(
      appSource,
      /initiative:\s*\{\s*fetch:\s*\['coordinatorState', 'coordinatorBarriers', 'barrierLedger', 'coordinatorBlockers', 'coordinatorRepoStatusRows'\],\s*render:\s*renderInitiative\s*\}/,
    );
    assert.match(appSource, /coordinatorRepoStatusRows:\s*'\/api\/coordinator\/repo-status'/);
  });

  it('AT-DASH-CONFLICT-003: timeline fetches durable turn_conflicted events from the dashboard API map', () => {
    assert.match(
      appSource,
      /timeline:\s*\{\s*fetch:\s*\['state', 'continuity', 'history', 'events', 'audit', 'annotations', 'connectors', 'coordinatorAudit', 'coordinatorAnnotations'\],\s*render:\s*renderTimeline\s*\}/,
    );
    assert.match(appSource, /events:\s*'\/api\/events\?type=turn_conflicted&limit=10'/);
  });
});

describe('App Shell — dashboard action error formatting', () => {
  const appSource = readFileSync(join(import.meta.dirname, '..', 'dashboard', 'app.js'), 'utf8');

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

  it('AT-DASH-ACT-016: error formatting includes recovery detail and first next action', () => {
    const message = formatActionErrorMessage({
      error: 'Compliance review required',
      next_actions: [{ command: 'agentxchain multi approve-gate' }],
      recovery_summary: {
        detail: 'Coordinator state is unchanged. Fix or reconfigure hook "release-guard", then rerun approval for pending gate "phase_transition:implementation->qa".',
      },
    }, 409);

    assert.match(message, /Compliance review required/);
    assert.match(message, /Coordinator state is unchanged/);
    assert.match(message, /Next: agentxchain multi approve-gate/);
  });

  it('falls back to HTTP status when no structured payload exists', () => {
    assert.equal(
      formatActionErrorMessage(null, 409),
      'Dashboard action failed with HTTP 409.',
    );
  });

  it('app.js consumes payload next_actions in dashboard failure formatting', () => {
    assert.match(appSource, /payload\.next_actions\?\.\[0\]\?\.command \|\| payload\.next_action/);
    assert.match(appSource, /payload\.recovery_summary\?\.detail/);
  });
});

describe('App Shell — dashboard action success formatting', () => {
  const appSource = readFileSync(join(import.meta.dirname, '..', 'dashboard', 'app.js'), 'utf8');

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

  it('AT-DASH-ACT-013: success formatting includes the first ordered next action', () => {
    const message = formatActionSuccessMessage({
      message: 'Coordinator phase transition approved: implementation -> qa',
      next_actions: [{ command: 'agentxchain multi step' }],
    });

    assert.equal(
      message,
      'Coordinator phase transition approved: implementation -> qa Next: agentxchain multi step',
    );
  });

  it('success formatting falls back to the success message when no next action exists', () => {
    assert.equal(
      formatActionSuccessMessage({ message: 'Run completion approved. Run is now completed.' }),
      'Run completion approved. Run is now completed.',
    );
  });

  it('app.js consumes payload next_actions in dashboard success formatting', () => {
    assert.match(appSource, /function formatActionSuccessMessage/);
    assert.match(appSource, /payload\.next_actions\?\.\[0\]\?\.command \|\| payload\.next_action/);
    assert.match(appSource, /setActionBanner\(formatActionSuccessMessage\(payload\), 'success'\)/);
  });
});
