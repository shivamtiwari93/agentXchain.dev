/**
 * Dashboard timeout status tests.
 *
 * Tests the computed /api/timeouts endpoint and the timeouts view component.
 * Server module: readTimeoutStatus() — reads config, evaluates live timeouts,
 * extracts persisted ledger events.
 * Frontend: render() — pure HTML from API data.
 *
 * See: TIMEOUT_DASHBOARD_SURFACE_SPEC.md
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { render } from '../dashboard/components/timeouts.js';

// ── Frontend render tests ─────────────────────────────────────────────────

describe('Timeouts View — render', () => {
  it('renders placeholder when data is null', () => {
    const html = render({ timeouts: null });
    assert.ok(html.includes('Timeouts'));
    assert.ok(html.includes('No timeout data available'));
  });

  it('renders error state with hint', () => {
    const html = render({
      timeouts: {
        ok: false,
        code: 'state_missing',
        error: 'Run state not found.',
      },
    });
    assert.ok(html.includes('Run state not found'));
    assert.ok(html.includes('agentxchain init --governed'));
  });

  it('renders not-configured placeholder', () => {
    const html = render({
      timeouts: {
        ok: true,
        configured: false,
        config: null,
        live: null,
        events: [],
      },
    });
    assert.ok(html.includes('No <code>timeouts</code> configured'));
    assert.ok(html.includes('agentxchain.json'));
  });

  it('renders config table with global limits', () => {
    const html = render({
      timeouts: {
        ok: true,
        configured: true,
        config: {
          per_turn_minutes: 30,
          per_phase_minutes: 120,
          per_run_minutes: 480,
          action: 'escalate',
          phase_overrides: [],
        },
        live: { exceeded: [], warnings: [] },
        events: [],
      },
    });
    assert.ok(html.includes('Timeout Configuration'));
    assert.ok(html.includes('Per-Turn'));
    assert.ok(html.includes('30m'));
    assert.ok(html.includes('Per-Phase'));
    assert.ok(html.includes('120m'));
    assert.ok(html.includes('Per-Run'));
    assert.ok(html.includes('480m'));
    assert.ok(html.includes('escalate'));
    assert.ok(html.includes('configured'));
  });

  it('renders per-phase routing overrides', () => {
    const html = render({
      timeouts: {
        ok: true,
        configured: true,
        config: {
          per_phase_minutes: 120,
          per_turn_minutes: null,
          per_run_minutes: null,
          action: 'escalate',
          phase_overrides: [
            { phase: 'qa', limit_minutes: 60, action: 'skip_phase' },
          ],
        },
        live: { exceeded: [], warnings: [] },
        events: [],
      },
    });
    assert.ok(html.includes('qa'));
    assert.ok(html.includes('60m'));
    assert.ok(html.includes('skip_phase'));
  });

  it('renders exceeded items in live pressure with red indicator', () => {
    const html = render({
      timeouts: {
        ok: true,
        configured: true,
        config: {
          per_turn_minutes: 30,
          per_phase_minutes: null,
          per_run_minutes: null,
          action: 'escalate',
          phase_overrides: [],
        },
        live: {
          exceeded: [
            {
              scope: 'turn',
              limit_minutes: 30,
              elapsed_minutes: 45,
              exceeded_by_minutes: 15,
              action: 'escalate',
            },
          ],
          warnings: [],
        },
        events: [],
      },
    });
    assert.ok(html.includes('EXCEEDED'));
    assert.ok(html.includes('45m'));
    assert.ok(html.includes('30m'));
    assert.ok(html.includes('15m'));
    assert.ok(html.includes('var(--red)'));
  });

  it('renders warning items in live pressure with yellow indicator', () => {
    const html = render({
      timeouts: {
        ok: true,
        configured: true,
        config: {
          per_phase_minutes: 120,
          per_turn_minutes: null,
          per_run_minutes: null,
          action: 'warn',
          phase_overrides: [],
        },
        live: {
          exceeded: [],
          warnings: [
            {
              scope: 'phase',
              phase: 'implementation',
              limit_minutes: 120,
              elapsed_minutes: 130,
              exceeded_by_minutes: 10,
              action: 'warn',
            },
          ],
        },
        events: [],
      },
    });
    assert.ok(html.includes('WARNING'));
    assert.ok(html.includes('implementation'));
    assert.ok(html.includes('130m'));
    assert.ok(html.includes('var(--yellow)'));
  });

  it('renders green message when live pressure has no exceeded or warnings', () => {
    const html = render({
      timeouts: {
        ok: true,
        configured: true,
        config: {
          per_turn_minutes: 30,
          per_phase_minutes: null,
          per_run_minutes: null,
          action: 'escalate',
          phase_overrides: [],
        },
        live: { exceeded: [], warnings: [] },
        events: [],
      },
    });
    assert.ok(html.includes('No timeouts exceeded'));
    assert.ok(html.includes('var(--green)'));
  });

  it('renders persisted timeout events from ledger', () => {
    const html = render({
      timeouts: {
        ok: true,
        configured: true,
        config: {
          per_turn_minutes: 30,
          per_phase_minutes: null,
          per_run_minutes: null,
          action: 'escalate',
          phase_overrides: [],
        },
        live: { exceeded: [], warnings: [] },
        events: [
          {
            type: 'timeout_warning',
            scope: 'turn',
            phase: 'planning',
            turn_id: 'turn_abc',
            limit_minutes: 30,
            elapsed_minutes: 35,
            exceeded_by_minutes: 5,
            action: 'warn',
            timestamp: '2026-04-11T01:00:00Z',
          },
          {
            type: 'timeout',
            scope: 'phase',
            phase: 'implementation',
            turn_id: 'turn_def',
            limit_minutes: 120,
            elapsed_minutes: 150,
            exceeded_by_minutes: 30,
            action: 'escalate',
            timestamp: '2026-04-11T02:00:00Z',
          },
        ],
      },
    });
    assert.ok(html.includes('Timeout Events'));
    assert.ok(html.includes('turn_abc'));
    assert.ok(html.includes('turn_def'));
    assert.ok(html.includes('planning'));
    assert.ok(html.includes('implementation'));
    assert.ok(html.includes('2 events recorded'));
  });

  it('renders empty events placeholder', () => {
    const html = render({
      timeouts: {
        ok: true,
        configured: true,
        config: {
          per_turn_minutes: 30,
          per_phase_minutes: null,
          per_run_minutes: null,
          action: 'escalate',
          phase_overrides: [],
        },
        live: { exceeded: [], warnings: [] },
        events: [],
      },
    });
    assert.ok(html.includes('No timeout events recorded'));
  });

  it('renders all four timeout event types', () => {
    const html = render({
      timeouts: {
        ok: true,
        configured: true,
        config: {
          per_phase_minutes: 60,
          per_turn_minutes: null,
          per_run_minutes: null,
          action: 'escalate',
          phase_overrides: [],
        },
        live: { exceeded: [], warnings: [] },
        events: [
          { type: 'timeout', scope: 'phase', phase: 'a', turn_id: 't1', limit_minutes: 60, elapsed_minutes: 70, exceeded_by_minutes: 10, action: 'escalate', timestamp: '2026-04-11T01:00:00Z' },
          { type: 'timeout_warning', scope: 'turn', phase: 'b', turn_id: 't2', limit_minutes: 30, elapsed_minutes: 35, exceeded_by_minutes: 5, action: 'warn', timestamp: '2026-04-11T01:01:00Z' },
          { type: 'timeout_skip', scope: 'phase', phase: 'c', turn_id: 't3', limit_minutes: 60, elapsed_minutes: 65, exceeded_by_minutes: 5, action: 'skip_phase', timestamp: '2026-04-11T01:02:00Z' },
          { type: 'timeout_skip_failed', scope: 'phase', phase: 'd', turn_id: 't4', limit_minutes: 60, elapsed_minutes: 80, exceeded_by_minutes: 20, action: 'skip_phase', timestamp: '2026-04-11T01:03:00Z' },
        ],
      },
    });
    assert.ok(html.includes('exceeded'));
    assert.ok(html.includes('warning'));
    assert.ok(html.includes('skipped'));
    assert.ok(html.includes('skip failed'));
  });
});

// ── Dashboard wiring tests ────────────────────────────────────────────────

describe('Timeouts Dashboard — wiring', () => {
  it('app.js includes timeouts view with correct fetch key', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const appPath = join(import.meta.dirname, '..', 'dashboard', 'app.js');
    const appContent = readFileSync(appPath, 'utf8');

    // View registration
    assert.ok(appContent.includes("timeouts:"), 'VIEWS must include timeouts key');
    assert.ok(appContent.includes("fetch: ['timeouts']"), 'timeouts view must fetch timeouts key');
    assert.ok(appContent.includes('renderTimeouts'), 'timeouts view must use renderTimeouts');

    // API mapping
    assert.ok(appContent.includes("timeouts: '/api/timeouts'"), 'API_MAP must include timeouts');
  });

  it('index.html nav includes Timeouts link', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const htmlPath = join(import.meta.dirname, '..', 'dashboard', 'index.html');
    const htmlContent = readFileSync(htmlPath, 'utf8');

    assert.ok(htmlContent.includes('href="#timeouts"'), 'nav must include timeouts link');
    assert.ok(htmlContent.includes('>Timeouts<'), 'nav must show Timeouts label');
  });

  it('bridge server imports and routes /api/timeouts', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const serverPath = join(import.meta.dirname, '..', 'src', 'lib', 'dashboard', 'bridge-server.js');
    const serverContent = readFileSync(serverPath, 'utf8');

    assert.ok(serverContent.includes("import { readTimeoutStatus }"), 'bridge-server must import readTimeoutStatus');
    assert.ok(serverContent.includes("'/api/timeouts'"), 'bridge-server must route /api/timeouts');
  });
});
