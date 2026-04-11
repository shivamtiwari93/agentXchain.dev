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
import { mkdirSync, rmSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { loadProjectContext } from '../src/lib/config.js';
import { initializeGovernedRun } from '../src/lib/governed-state.js';
import { readTimeoutStatus } from '../src/lib/dashboard/timeout-status.js';
import { render } from '../dashboard/components/timeouts.js';

function tempDir() {
  const dir = join(tmpdir(), `axc-timeouts-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeRepo(root, { projectId, timeouts = null, routing = null }) {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: projectId, name: projectId, default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: ['echo', '{prompt}'],
        prompt_transport: 'argv',
      },
    },
    routing: routing || {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
      qa: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    gates: {},
    ...(timeouts ? { timeouts } : {}),
  });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: projectId,
    run_id: null,
    status: 'idle',
    phase: 'implementation',
    active_turns: {},
    turn_sequence: 0,
    accepted_count: 0,
    rejected_count: 0,
    blocked_on: null,
    blocked_reason: null,
    next_recommended_role: null,
  });

  const context = loadProjectContext(root);
  const initResult = initializeGovernedRun(root, context.config);
  assert.equal(initResult.ok, true, `repo ${projectId} must initialize`);
}

// ── Server module tests ───────────────────────────────────────────────────

describe('Timeouts — readTimeoutStatus', () => {
  it('returns configured false when no timeouts are configured', () => {
    const workspace = tempDir();
    try {
      writeRepo(workspace, { projectId: 'not-configured' });
      const result = readTimeoutStatus(workspace);
      assert.equal(result.ok, true);
      assert.equal(result.status, 200);
      assert.equal(result.body.configured, false);
      assert.equal(result.body.config, null);
      assert.equal(result.body.live, null);
      assert.deepEqual(result.body.events, []);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('returns live phase and per-turn timeout pressure with turn identity', () => {
    const workspace = tempDir();
    try {
      writeRepo(workspace, {
        projectId: 'active-timeouts',
        timeouts: {
          per_turn_minutes: 30,
          per_phase_minutes: 60,
          action: 'warn',
        },
      });

      const statePath = join(workspace, '.agentxchain', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      state.status = 'active';
      state.phase = 'implementation';
      state.created_at = new Date(Date.now() - (4 * 60 * 60 * 1000)).toISOString();
      state.phase_entered_at = new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString();
      state.turn_sequence = 1;
      state.active_turns = {
        turn_timeout_001: {
          turn_id: 'turn_timeout_001',
          assigned_role: 'dev',
          status: 'active',
          runtime_id: 'local-dev',
          attempt: 1,
          assigned_sequence: 1,
          assigned_at: new Date(Date.now() - (75 * 60 * 1000)).toISOString(),
          started_at: new Date(Date.now() - (75 * 60 * 1000)).toISOString(),
        },
      };
      writeJson(statePath, state);

      appendFileSync(
        join(workspace, '.agentxchain', 'decision-ledger.jsonl'),
        JSON.stringify({
          type: 'timeout_warning',
          scope: 'turn',
          phase: 'implementation',
          turn_id: 'turn_timeout_001',
          limit_minutes: 30,
          elapsed_minutes: 75,
          exceeded_by_minutes: 45,
          action: 'warn',
          timestamp: '2026-04-11T01:00:00Z',
        }) + '\n',
      );

      const result = readTimeoutStatus(workspace);
      assert.equal(result.ok, true);
      assert.equal(result.status, 200);
      assert.equal(result.body.configured, true);
      assert.ok(result.body.live.warnings.some((item) => item.scope === 'phase'));
      const turnWarning = result.body.live.warnings.find((item) => item.scope === 'turn');
      assert.ok(turnWarning, 'turn timeout pressure must be present');
      assert.equal(turnWarning.turn_id, 'turn_timeout_001');
      assert.equal(turnWarning.role_id, 'dev');
      assert.equal(turnWarning.phase, 'implementation');
      assert.equal(result.body.events.length, 1);
      assert.equal(result.body.events[0].turn_id, 'turn_timeout_001');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('returns empty live arrays for blocked runs while preserving timeout events', () => {
    const workspace = tempDir();
    try {
      writeRepo(workspace, {
        projectId: 'blocked-timeouts',
        timeouts: {
          per_turn_minutes: 30,
          action: 'escalate',
        },
      });

      const statePath = join(workspace, '.agentxchain', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      state.status = 'blocked';
      state.blocked_on = 'timeout:turn';
      state.blocked_reason = {
        category: 'timeout',
        blocked_at: new Date().toISOString(),
        turn_id: 'turn_timeout_002',
        recovery: {
          typed_reason: 'timeout',
          owner: 'operator',
          recovery_action: 'agentxchain resume',
          turn_retained: true,
          detail: 'Turn timeout',
        },
      };
      state.active_turns = {
        turn_timeout_002: {
          turn_id: 'turn_timeout_002',
          assigned_role: 'dev',
          status: 'active',
          runtime_id: 'local-dev',
          attempt: 1,
          assigned_sequence: 1,
        },
      };
      writeJson(statePath, state);

      appendFileSync(
        join(workspace, '.agentxchain', 'decision-ledger.jsonl'),
        JSON.stringify({
          type: 'timeout',
          scope: 'turn',
          phase: 'implementation',
          turn_id: 'turn_timeout_002',
          limit_minutes: 30,
          elapsed_minutes: 50,
          exceeded_by_minutes: 20,
          action: 'escalate',
          timestamp: '2026-04-11T02:00:00Z',
        }) + '\n',
      );

      const result = readTimeoutStatus(workspace);
      assert.equal(result.ok, true);
      assert.deepEqual(result.body.live, { exceeded: [], warnings: [] });
      assert.equal(result.body.events.length, 1);
      assert.equal(result.body.events[0].type, 'timeout');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('returns state_missing when governed state is absent', () => {
    const workspace = tempDir();
    try {
      writeRepo(workspace, {
        projectId: 'missing-state',
        timeouts: { per_turn_minutes: 30, action: 'warn' },
      });
      rmSync(join(workspace, '.agentxchain', 'state.json'));

      const result = readTimeoutStatus(workspace);
      assert.equal(result.ok, false);
      assert.equal(result.status, 404);
      assert.equal(result.body.code, 'state_missing');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

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
              phase: 'implementation',
              turn_id: 'turn_live_001',
              role_id: 'dev',
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
    assert.ok(html.includes('turn_live_001'));
    assert.ok(html.includes('(dev)'));
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
